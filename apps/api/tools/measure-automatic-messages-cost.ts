// What the automatic messages cost at full size (ROADMAP 20b-i, 20b-ii; CLAUDE.md §4 "Cost
// at full size"). One gym of 2,000 beside 19 gyms of 200, everybody on the list with a date
// of birth, a year of check-ins every other day, and 20 messages already sent each.
// Everybody holds a monthly membership a year old with its twelve bills: eleven paid, and
// this month's still open for one person in four.
//
// The sender runs four times an hour. Three numbers matter: the usual run, which reads
// only who joined lately; the day's first run for a gym, which reads everybody in it; and
// the worst run, all 2,000 of the big gym due We miss you at once, which is the one time
// that gym's row is held. Each as how long it takes and how long its one thread is busy.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-automatic-messages-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms and their members, and removes them.
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import os from "node:os";
import postgres from "postgres";
import { gymMoney, membershipFactsByPerson } from "../src/modules/orgs/messages/membershipsRepo.js";
import { sendDueMessages } from "../src/modules/orgs/messages/send.js";
import { getMessageSettings } from "../src/modules/orgs/messages/settings.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-automatic-messages-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10 });
const SMALL_GYMS = 19;
const SMALL = 200;
const BIG = 2000;
const RUNS = 20;
const PREFIX = "auto-cost-";
const PLAN = "zz_auto_cost";
/** How far back the sender reads a bill's due date with no grace period: 3 + 30 days. */
const BILL_DAYS = 33;
/** Noon in London, where every gym here is: daytime, so the job sends. */
const NOW = new Date("2031-06-10T11:00:00Z");
const TODAY = "2031-06-10";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  // By the plan, so a run that was stopped half-way leaves nothing this one trips on.
  await sql`DELETE FROM subscriptions WHERE plan_id IN (SELECT id FROM plans WHERE code = ${PLAN})`;
  await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

await cleanup();
// Whatever happens below, the gyms and their members are removed.
try {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;

  const makeGym = async (people: number): Promise<string> => {
    const gymId = randomUUID();
    await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'trialing', 'pilot')`;
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
    const rows = Array.from({ length: people }, (_, i) => ({ id: randomUUID(), entry: randomUUID(), i }));
    await sql`INSERT INTO users ${sql(rows.map((p) => ({ id: p.id, email: `${PREFIX}m-${p.id}@example.com`, display_name: `Person${String(p.i)} Cost` })))}`;
    // A date of birth each, a different day for each of the first 9,000 or so.
    await sql`
      INSERT INTO gym_member_list_entries ${sql(
        rows.map((p) => ({
          id: p.entry,
          gym_id: gymId,
          full_name: `Person${String(p.i)} Cost`,
          email: `${PREFIX}r-${p.id}@example.com`,
          identity_key: p.id.replace(/-/g, "").padEnd(64, "0"),
          source: "typed",
          date_of_birth: new Date(Date.UTC(1975, 0, 1) + p.i * 86_400_000).toISOString().slice(0, 10),
        })),
      )}`;
    await sql`INSERT INTO gym_members ${sql(rows.map((p) => ({ gym_id: gymId, user_id: p.id, entry_id: p.entry, joined_at: new Date(NOW.getTime() - 400 * 86_400_000) })))}`;
    // A year of check-ins every other day, up to today or yesterday.
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
      SELECT ${gymId}, m.user_id, m.entry_id, ${owner}, ${TODAY}::date - d, 'staff', 'hours_unset', 'hours_unset', (${TODAY}::date - d) + interval '9 hours'
      FROM (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) AS n FROM gym_members WHERE gym_id = ${gymId}) m
      CROSS JOIN generate_series(0, 364) AS d
      WHERE (m.n + d) % 2 = 0`;
    // Twenty automatic messages each, already sent over the year.
    await sql`
      INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
      SELECT ${gymId}, m.user_id, 'miss_you', 'absent:old-' || k, 'We hope to see you soon.', ${TODAY}::date - (k * 15 + 20),
             ${NOW}::timestamptz - (k * 15 + 20) * interval '1 day', ${NOW}::timestamptz - (k * 15 - 10) * interval '1 day'
      FROM gym_members m CROSS JOIN generate_series(1, 20) AS k
      WHERE m.gym_id = ${gymId}`;
    // A monthly membership each, begun eleven months ago on one of 28 days, so this
    // month's period began up to 27 days back; twelve bills each, this month's open for
    // one in four, and a payment for every bill that is paid.
    const typeId = randomUUID();
    await sql`
      INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
      VALUES (${typeId}, ${gymId}, 'Monthly', 'recurring', 4999, 'GBP', 1, 'month', 'all_classes')`;
    await sql`
      INSERT INTO gym_held_memberships (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, paid_periods, renews)
      SELECT ${gymId}, m.entry_id, ${typeId}, gen_random_uuid(), 'recurring', 4999, 'GBP', 1, 'month',
             ((${TODAY}::date - (m.n % 28)::int) - interval '11 months')::date, CASE WHEN m.n % 4 = 0 THEN 11 ELSE 12 END, true
      FROM (SELECT entry_id, row_number() OVER (ORDER BY user_id) AS n FROM gym_members WHERE gym_id = ${gymId}) m`;
    await sql`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, status)
      SELECT ${gymId}, h.id, k, 4999, 'GBP', (h.starts_on + k * interval '1 month')::date, CASE WHEN k < h.paid_periods THEN 'paid' ELSE 'open' END
      FROM gym_held_memberships h CROSS JOIN generate_series(0, 11) AS k
      WHERE h.gym_id = ${gymId}`;
    await sql`
      WITH base AS (SELECT receipts_issued AS b FROM gyms WHERE id = ${gymId}),
      ins AS (
        INSERT INTO gym_member_payments (gym_id, bill_id, amount_minor, currency, method, request_key, paid_on, recorded_by, receipt_number)
        SELECT ${gymId}, b.id, 4999, 'GBP', 'cash', gen_random_uuid(), b.due_on, ${owner}, base.b + row_number() OVER ()
        FROM gym_member_bills b, base WHERE b.gym_id = ${gymId} AND b.status = 'paid'
        RETURNING 1)
      UPDATE gyms SET receipts_issued = receipts_issued + (SELECT count(*) FROM ins) WHERE id = ${gymId}`;
    return gymId;
  };

  const small: string[] = [];
  for (let g = 0; g < SMALL_GYMS; g++) small.push(await makeGym(SMALL));
  const big = await makeGym(BIG);
  const gymIds = [...small, big];
  for (const table of ["gym_members", "users", "gyms", "gym_attendance", "gym_member_list_entries", "gym_member_messages", "gym_held_memberships", "gym_member_bills", "gym_member_payments"]) {
    await sql`ANALYZE ${sql(table)}`;
  }
  const counted = await sql<{ visits: number; messages: number; bills: number; open: number; payments: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_attendance WHERE gym_id = ANY(${gymIds}::uuid[])) AS visits,
           (SELECT count(*)::int FROM gym_member_messages WHERE gym_id = ANY(${gymIds}::uuid[])) AS messages,
           (SELECT count(*)::int FROM gym_member_bills WHERE gym_id = ANY(${gymIds}::uuid[])) AS bills,
           (SELECT count(*)::int FROM gym_member_bills WHERE gym_id = ANY(${gymIds}::uuid[]) AND status = 'open') AS open,
           (SELECT count(*)::int FROM gym_member_payments WHERE gym_id = ANY(${gymIds}::uuid[])) AS payments`;

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  /** One timed run: how long, how long the thread was busy, and its longest stall. */
  const once = async (run: () => Promise<unknown>): Promise<{ wall: number; busy: number; stall: number }> => {
    delay.reset();
    delay.enable();
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    await run();
    const wall = performance.now() - start;
    delay.disable();
    return { wall, busy: performance.eventLoopUtilization(before).active, stall: delay.max / 1e6 };
  };
  const line = (name: string, runs: { wall: number; busy: number; stall: number }[]): void => {
    console.log(
      `  ${name.padEnd(64)} total median ${fmt(median(runs.map((r) => r.wall)))} (worst ${fmt(Math.max(...runs.map((r) => r.wall)))}) · thread busy median ${fmt(median(runs.map((r) => r.busy)))} (worst ${fmt(Math.max(...runs.map((r) => r.busy)))}) · longest stall ${fmt(Math.max(...runs.map((r) => r.stall)))}`,
    );
  };
  const measure = async (name: string, run: () => Promise<unknown>, times: number = RUNS): Promise<void> => {
    const runs = [];
    // The first run warms the connections and is not counted.
    for (let i = 0; i < times + 1; i++) {
      const r = await once(run);
      if (i > 0) runs.push(r);
    }
    line(name, runs);
  };

  const cpu = os.cpus()[0];
  console.log(
    `measure-automatic-messages-cost: ${String(SMALL_GYMS)} gyms of ${String(SMALL)} and one of ${String(BIG)} · ${String(counted[0]?.visits ?? 0)} check-ins · ${String(counted[0]?.messages ?? 0)} messages already sent · ${String(counted[0]?.bills ?? 0)} bills (${String(counted[0]?.open ?? 0)} open) · ${String(counted[0]?.payments ?? 0)} payments · ${cpu?.model ?? "?"} at ${String(cpu?.speed ?? 0)} MHz · ${String(RUNS)} runs each`,
  );

  const log = { info: () => undefined, error: () => undefined };
  const nothing = async (ids: readonly string[]): Promise<void> => {
    const sent = await sendDueMessages({ sql, log }, { now: NOW, gymIds: ids });
    if (sent.sent !== 0) throw new Error("a run with nothing to send sent something");
  };
  /** The day's first run: everybody in these gyms is read. */
  const wholeDay = (ids: readonly string[]) => async (): Promise<void> => {
    await sql`DELETE FROM gym_message_days WHERE gym_id = ANY(${[...ids]}::uuid[])`;
    await nothing(ids);
  };
  const first = await sendDueMessages({ sql, log }, { now: NOW, gymIds });
  const kinds = await sql<{ kind: string; n: number }[]>`
    SELECT kind, count(*)::int AS n FROM gym_member_messages WHERE gym_id = ANY(${gymIds}::uuid[]) AND gym_day = ${TODAY}::date GROUP BY kind ORDER BY kind`;
  console.log(`  the first run sent ${String(first.sent)}: ${kinds.map((k) => `${k.kind} ${String(k.n)}`).join(", ")}`);
  await measure("the usual run, four times an hour: all 20 gyms, nobody new", () => nothing(gymIds));
  await measure(`the day's first run, everybody read: one gym of ${String(SMALL)}`, wholeDay(small.slice(0, 1)), 10);
  await measure(`the day's first run, everybody read: the gym of ${String(BIG)}`, wholeDay([big]), 5);
  await measure("the day's first run for all 20 gyms in one run (one time zone)", wholeDay(gymIds), 3);
  await measure("a run at night: all 20 gyms asleep", async () => {
    const sent = await sendDueMessages({ sql, log }, { now: new Date("2031-06-10T01:00:00Z"), gymIds });
    if (sent.sent !== 0) throw new Error("a night run sent something");
  });

  await measure(`the read of memberships and bills alone: the gym of ${String(BIG)}`, async () => {
    const [facts, money] = [await membershipFactsByPerson(sql, big, TODAY, BILL_DAYS), await gymMoney(sql, big, TODAY)];
    if (facts.size !== BIG || !money.takesPayments) throw new Error(`the membership read is wrong: ${String(facts.size)} people`);
  });
  await measure(`the read of memberships and bills alone: one gym of ${String(SMALL)}`, async () => {
    const facts = await membershipFactsByPerson(sql, small[0] ?? "", TODAY, BILL_DAYS);
    if (facts.size !== SMALL) throw new Error("the membership read is wrong");
  });

  // A gym whose bills nobody settles: three more years of open bills on every membership of
  // the big gym. The read looks no further back than a notice can go, so it does not grow.
  await sql`
    INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, status)
    SELECT ${big}, h.id, 100 + k, 4999, 'GBP', (h.starts_on - (k + 1) * interval '1 month')::date, 'open'
    FROM gym_held_memberships h CROSS JOIN generate_series(0, 35) AS k
    WHERE h.gym_id = ${big}`;
  await sql`ANALYZE gym_member_bills`;
  const unsettled = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_bills WHERE gym_id = ${big} AND status = 'open'`;
  await measure(`the same read with ${String(unsettled[0]?.n ?? 0)} open bills nobody settled: the gym of ${String(BIG)}`, async () => {
    const facts = await membershipFactsByPerson(sql, big, TODAY, BILL_DAYS);
    if (facts.size !== BIG) throw new Error("the membership read is wrong");
  });
  await sql`DELETE FROM gym_member_bills WHERE gym_id = ${big} AND period_index >= 100`;

  const deps = { sql, now: () => NOW };
  await measure(`the Settings box read: the gym of ${String(BIG)}`, async () => {
    const got = await getMessageSettings(deps, owner, big, () => Promise.resolve(true));
    if (got === null || !got.checkIn || !got.payments || !got.priceList) throw new Error("the settings read is wrong");
  });

  // The worst run. Twelve days on, with the big gym's desk still in use by somebody not in
  // the app and none of its members back: every one of them is due We miss you at once.
  const desk = randomUUID();
  await sql`
    INSERT INTO gym_member_list_entries (id, gym_id, full_name, email, identity_key, source)
    VALUES (${desk}, ${big}, 'Desk Regular', ${`${PREFIX}desk@example.com`}, ${desk.replace(/-/g, "").padEnd(64, "0")}, 'typed')`;
  await sql`
    INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
    SELECT ${big}, NULL, ${desk}, ${owner}, ${TODAY}::date + d, 'staff', 'hours_unset', 'hours_unset', (${TODAY}::date + d) + interval '9 hours'
    FROM generate_series(1, 12) AS d`;
  const later = new Date(NOW.getTime() + 12 * 86_400_000);
  await sql`DELETE FROM gym_message_days WHERE gym_id = ${big}`;
  const worst = await once(async () => {
    const sent = await sendDueMessages({ sql, log }, { now: later, gymIds: [big] });
    // A birthday that day goes first for a few; everybody gets one message.
    if (sent.sent !== BIG) throw new Error(`expected ${String(BIG)} sent, got ${String(sent.sent)}`);
  });
  line(`the worst run: all ${String(BIG)} of one gym sent a message at once`, [worst]);
  await measure("that run again: everybody already has theirs", async () => {
    const sent = await sendDueMessages({ sql, log }, { now: new Date(later.getTime() + 900_000), gymIds: [big] });
    if (sent.sent !== 0) throw new Error("a second run sent something");
  });
} finally {
  await cleanup();
  await sql.end({ timeout: 5 });
}
