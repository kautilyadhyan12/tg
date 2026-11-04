// What bills and payments cost at full size (ROADMAP 18a-i; CLAUDE.md §4 "Cost at full
// size"). The launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them; every
// person holds one repeating membership given 40 days ago, never paid and never billed, so
// the first run has the most it can ever have to do for each: move the count over the
// month nobody was asked for, and open this month's bill. Measured:
//   - the hourly run when everything is owed at once (the first run after a deploy), for
//     the 20 gyms, for one gym of 200 and for the gym of 2,000: a gym's run holds that
//     gym's row, so the gym's other writes wait that long;
//   - the run when nothing is owed, which is every other hour;
//   - a person's page read with its bills, and one payment recorded.
// Two numbers each: total, and how long the one thread is busy and answers nobody. The
// run is the worker's thread, not the api's; the read and the payment are the api's.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-member-bills-cost.ts
//
// With `BILL_DAY=1` (1 to 28) every membership is billed from that day of the month (18y), its
// first period the part month before it.
//
// Then cancel early with the early cancellation fee (18v-ii-b): one press on a person of the gym of
// 2,000, each inside a twelve-month minimum term, a new person each time.
//
// Then a cooling-off period (18v-iii): every membership holds 3 days from today, so a person's page reads the
// day they count from, and Cancel with full refund is one press on a person of the gym of 2,000.
//
// Then a fee while frozen (18z): every membership frozen 40 days ago with a fee of its own, so the
// run opens this month's fee for every person at once (more than any gym will ever have frozen),
// and every other hour opens nothing.
//
// Last, Overview's Refunds to review (18v-iii), once every person of one gym of 200 paid and was cancelled with a
// full refund (more than any gym will ever have waiting), and for the gym of 2,000.
//
// LOCAL DATABASES ONLY: it writes gyms, their lists and memberships, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { getHeldMemberships, moveHeldMembership, recordMemberPayment } from "../src/modules/orgs/memberships/heldService.js";
import { openDueFreezeFees } from "../src/modules/orgs/memberships/freezeFees.js";
import { refundsToReview } from "../src/modules/orgs/payments/refundsToReviewRepo.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-member-bills-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 9;
const PLAN = "zz_bills_cost";
const PREFIX = "bills-cost-";
const BILL_DAY = process.env["BILL_DAY"] === undefined ? null : Number(process.env["BILL_DAY"]);

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Gym {
  id: string;
  owner: string;
  first: string;
  firstMembership: string;
}

async function seedGym(people: number): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${id}, ${PREFIX + id}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const typeId = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${typeId}, ${id}, 'Gold Monthly', 'recurring', 4999, 'GBP', 1, 'month', 'all_classes')`;
  // Every membership taxed (18b-iii): every bill opened works its tax out.
  const rateId = randomUUID();
  await sql`INSERT INTO gym_tax_rates (id, gym_id, name, rate_bp) VALUES (${rateId}, ${id}, 'VAT', 2000)`;
  await sql`UPDATE gym_membership_types SET tax_rate_id = ${rateId} WHERE id = ${typeId}`;
  const records = Array.from({ length: people }, (_, i) => {
    const entry = randomUUID();
    return {
      id: entry,
      gym_id: id,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}${String(i)}-${entry}@example.com`,
      identity_key: createHash("sha256").update(entry).digest("hex"),
      source: "typed",
    };
  });
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  // Given 40 days ago and never paid: the first month and the one that began since are owed.
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews, tax_rate_id, tax_included)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 4999, 'GBP', 1, 'month', current_date - 40, 'active', 0, true, ${rateId}, false
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  // The first of the gym's billing days after the start, where one is set and it is not the start.
  if (BILL_DAY !== null) {
    await sql`
      UPDATE gym_held_memberships SET full_from = f.day
      FROM (SELECT (date_trunc('month', current_date - 40)::date + (${BILL_DAY}::int - 1)
                    + CASE WHEN extract(day FROM current_date - 40) < ${BILL_DAY}::int THEN interval '0' ELSE interval '1 month' END)::date AS day) f
      WHERE gym_id = ${id} AND extract(day FROM current_date - 40) <> ${BILL_DAY}::int`;
  }
  const first = records[0]?.id ?? "";
  const [m] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${id} AND entry_id = ${first}`;
  return { id, owner, first, firstMembership: m?.id ?? "" };
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;

async function time(fn: () => Promise<unknown>): Promise<{ wall: number; js: number }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  await fn();
  const wall = performance.now() - start;
  return { wall, js: performance.eventLoopUtilization(before).active };
}

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
const gyms: Gym[] = [];
for (let i = 0; i < GYMS; i++) gyms.push(await seedGym(PEOPLE));
const big = await seedGym(BIG);
await sql`VACUUM ANALYZE gym_held_memberships`;
const ids = gyms.map((g) => g.id);
const log = { info: () => undefined, error: (obj: object) => { console.error("a gym failed", obj); } };
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}, each person a count to move and a bill to open; billed from ${BILL_DAY === null ? "each start" : `day ${String(BILL_DAY)}`}; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
const line = (name: string, t: { wall: number; js: number }, more = "") =>
  { console.log(`${name.padEnd(52)} total ${fmt(t.wall)} · thread busy ${fmt(t.js)}${more}`); };

// One gym alone first: how long its row is held.
let opened = 0;
const one = await time(async () => {
  opened = (await openDueBills({ sql, log }, { gymIds: [ids[0] ?? ""] })).opened;
});
line(`the run, one gym of ${String(PEOPLE)}, everything owed`, one, ` · ${String(opened)} bills`);
const rest = await time(async () => {
  opened = (await openDueBills({ sql, log }, { gymIds: ids.slice(1) })).opened;
});
line(`the run, the other ${String(GYMS - 1)} gyms, everything owed`, rest, ` · ${String(opened)} bills`);
const bigRun = await time(async () => {
  opened = (await openDueBills({ sql, log }, { gymIds: [big.id] })).opened;
});
line(`the run, one gym of ${String(BIG)}, everything owed`, bigRun, ` · ${String(opened)} bills`);

const all = [...ids, big.id];
const idle: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) idle.push(await time(() => openDueBills({ sql, log }, { gymIds: all })));
console.log(
  `${"the run, all 21 gyms, nothing owed".padEnd(52)} total median ${fmt(median(idle.map((t) => t.wall)))} (worst ${fmt(Math.max(...idle.map((t) => t.wall)))}) · thread busy median ${fmt(median(idle.map((t) => t.js)))}`,
);

const deps = { sql, now: () => new Date() };
// A cooling-off period on every membership of the gyms of 200, counted from today (18v-iii). The gym of 2,000 is
// given its days after Cancel early is measured: inside them, that is not offered.
await sql`UPDATE gym_held_memberships SET cooling_off_days = 3, cooling_off_added = current_date WHERE gym_id = ANY(${ids}::uuid[]) AND kind = 'recurring'`;
const calls: [string, () => Promise<unknown>][] = [
  ["read a person's page, with its bill", () => getHeldMemberships(deps, gyms[0]?.owner ?? "", ids[0] ?? "", gyms[0]?.first ?? "")],
  [
    "record a payment (a new person each time)",
    async () => {
      const [m] = await sql<{ id: string; entry_id: string }[]>`
        SELECT h.id, h.entry_id FROM gym_held_memberships h
        WHERE h.gym_id = ${big.id} AND h.paid_periods = 1 ORDER BY random() LIMIT 1`;
      return recordMemberPayment(deps, big.owner, big.id, m?.entry_id ?? "", m?.id ?? "", { requestKey: randomUUID(), periodIndex: 1, amountMinor: 4999, method: "cash" });
    },
  ],
  [
    "cancel early with the fee (a new person each time)",
    async () => {
      const [m] = await sql<{ id: string; entry_id: string }[]>`
        SELECT h.id, h.entry_id FROM gym_held_memberships h
        WHERE h.gym_id = ${big.id} AND h.status = 'active' AND NOT h.left_early AND h.leave_fee_minor IS NOT NULL ORDER BY random() LIMIT 1`;
      return moveHeldMembership(deps, big.owner, big.id, m?.entry_id ?? "", m?.id ?? "", { type: "cancel", when: "leave_early" }, null, null, 0, 9900);
    },
  ],
];
const coolingCalls: [string, () => Promise<unknown>][] = [
  [
    "cancel with a full refund (a new person each time)",
    async () => {
      const [m] = await sql<{ id: string; entry_id: string }[]>`
        SELECT h.id, h.entry_id FROM gym_held_memberships h
        WHERE h.gym_id = ${big.id} AND h.status = 'active' AND NOT h.left_early AND NOT h.changed_mind
          AND NOT EXISTS (SELECT 1 FROM gym_member_bills b JOIN gym_member_payments p ON p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL
                          WHERE b.gym_id = h.gym_id AND b.held_membership_id = h.id AND b.status = 'open')
        ORDER BY random() LIMIT 1`;
      return moveHeldMembership(deps, big.owner, big.id, m?.entry_id ?? "", m?.id ?? "", { type: "cancel", when: "cooling_off" });
    },
  ],
];
// Every membership of the gym of 2,000 inside a twelve-month minimum term with a fee (18v-ii-b).
await sql`
  UPDATE gym_held_memberships SET contract_periods = 12, contract_then = 'renews', leave_fee_minor = 9900
  WHERE gym_id = ${big.id} AND kind = 'recurring'`;
async function measureAll(list: [string, () => Promise<unknown>][]): Promise<void> {
  for (const [name, call] of list) {
    await call();
    const walls: number[] = [];
    const jss: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await time(call);
      walls.push(t.wall);
      jss.push(t.js);
    }
    console.log(`${name.padEnd(52)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
  }
}
await measureAll(calls);
// Its days open: started today, as a member who has been one for 40 days has none (round one, H1).
await sql`UPDATE gym_held_memberships SET cooling_off_days = 3, cooling_off_added = current_date, starts_on = current_date WHERE gym_id = ${big.id} AND kind = 'recurring'`;
await measureAll(coolingCalls);
// Every membership frozen 40 days ago with its fee: this month's fee is owed by every person.
await sql`
  UPDATE gym_held_memberships SET status = 'frozen', frozen_on = current_date - 40, freeze_fee_minor = 1000
  WHERE gym_id = ANY(${all}::uuid[]) AND status = 'active'`;
await sql`VACUUM ANALYZE gym_held_memberships`;
for (const [name, gymIds] of [
  [`the freeze fee run, one gym of ${String(PEOPLE)}, all frozen`, [ids[0] ?? ""]],
  [`the freeze fee run, the other ${String(GYMS - 1)} gyms`, ids.slice(1)],
  [`the freeze fee run, one gym of ${String(BIG)}, all frozen`, [big.id]],
] as const) {
  let fees = 0;
  const t = await time(async () => {
    fees = (await openDueFreezeFees({ sql, log }, { gymIds })).opened;
  });
  line(name, t, ` · ${String(fees)} fees`);
}
const idleFees: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) idleFees.push(await time(() => openDueFreezeFees({ sql, log }, { gymIds: all })));
console.log(
  `${"the freeze fee run, all 21 gyms, nothing owed".padEnd(52)} total median ${fmt(median(idleFees.map((t) => t.wall)))} (worst ${fmt(Math.max(...idleFees.map((t) => t.wall)))}) · thread busy median ${fmt(median(idleFees.map((t) => t.js)))}`,
);

// Every person of one gym of 200 joins today, pays their first bill in full and is cancelled with a full refund (18v-iii).
await sql`DELETE FROM gym_member_bills WHERE gym_id = ${ids[0] ?? ""}`;
await sql`
  UPDATE gym_held_memberships SET status = 'active', frozen_on = NULL, frozen_days = 0, freeze_fee_minor = 0, starts_on = current_date,
         paid_periods = 0, paid_floor = 0, renews = true, cooling_off_days = 3, cooling_off_added = current_date
  WHERE gym_id = ${ids[0] ?? ""}`;
await openDueBills({ sql, log }, { gymIds: [ids[0] ?? ""] });
const owedBills = await sql<{ id: string; entry_id: string; period_index: number; amount_minor: number }[]>`
  SELECT h.id, h.entry_id, b.period_index, b.amount_minor FROM gym_held_memberships h
  JOIN gym_member_bills b ON b.gym_id = h.gym_id AND b.held_membership_id = h.id AND b.status = 'open' AND b.period_index IS NOT NULL
  WHERE h.gym_id = ${ids[0] ?? ""} AND h.status IN ('active', 'frozen')`;
for (const b of owedBills) {
  await recordMemberPayment(deps, gyms[0]?.owner ?? "", ids[0] ?? "", b.entry_id, b.id, { requestKey: randomUUID(), periodIndex: b.period_index, amountMinor: b.amount_minor, method: "cash" });
}
for (const id of new Set(owedBills.map((b) => b.id))) {
  const b = owedBills.find((x) => x.id === id);
  await moveHeldMembership(deps, gyms[0]?.owner ?? "", ids[0] ?? "", b?.entry_id ?? "", id, { type: "cancel", when: "cooling_off" });
}
for (const [name, gymId] of [
  [`Refunds to review, one gym of ${String(PEOPLE)}, all refunds owed`, ids[0] ?? ""],
  [`Refunds to review, one gym of ${String(BIG)}`, big.id],
] as const) {
  let count = 0;
  const walls: number[] = [];
  const jss: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = await time(async () => {
      count = (await refundsToReview(sql, gymId, true, new Date(), 0, 10)).count;
    });
    walls.push(t.wall);
    jss.push(t.js);
  }
  console.log(`${name.padEnd(52)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(jss))} · ${String(count)} rows`);
}
delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
