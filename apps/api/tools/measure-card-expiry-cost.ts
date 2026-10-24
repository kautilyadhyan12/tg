// What the reminder before a card expires costs at full size (ROADMAP 18d-iii-c; CLAUDE.md §4 "Cost at
// full size"). The launch shape, 20 gyms of 200 people, and one gym of 2,000 beside them, every gym on
// Square in Chicago with the reminders switched on; every person holds a renewing membership and a card
// on file that runs out this month: the most one month can ever have to send. Measured:
//   - the worker's queue, every minute: when every card is due, when all are written (every other
//     minute of the month), and on a day nobody's card runs out;
//   - one minute of the sender, its run's worth of emails;
//   - the Bills box of the gym of 2,000, listing all 2,000 cards;
//   - a person's Card on file, with its reminder.
// Two numbers each: total, and how long the one thread is busy and answers nobody. The queue and the
// sender are the worker's thread; the box and the card are the api's.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm --filter api exec tsx tools/measure-card-expiry-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists, memberships and cards, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { getBillSettings } from "../src/modules/orgs/memberships/heldService.js";
import { sendDueCardExpiryNotices } from "../src/modules/orgs/payments/cardExpiry.js";
import { queueDueNotices } from "../src/modules/orgs/payments/cardExpiryRepo.js";
import { staffView } from "../src/modules/orgs/payments/cards.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { getOrgById } from "../src/modules/orgs/repo.js";
import { fakeSquare } from "../test/fakeSquareTerminal.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-card-expiry-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 9;
const PLAN = "zz_expiry_cost";
const PREFIX = "expiry-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_card_expiry_notices WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_payment_connections WHERE gym_id IN (${gyms})`;
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
}

async function seedGym(people: number, n: number, exp: { month: number; year: number }): Promise<Gym> {
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const id = randomUUID();
  await sql`
    INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id, card_expiry_reminders)
    VALUES (${id}, ${PREFIX + id}, 'Cost Gym', 'America/Chicago', 'US', ${owner}, true)`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const merchant = `MEXP${String(n)}`;
  await sql`
    INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency, location_id, location_name,
                                         access_token, refresh_token, access_expires_at, refresh_due_at, connected_by, connected_at, scopes)
    VALUES (${id}, 'square', 'production', 'connected', ${merchant}, 'Cost Gym', 'US', 'USD', ${`L${merchant}`}, 'Main',
            'unused', 'unused', now() + interval '30 days', now() + interval '6 days', ${owner}, now(), '{}'::text[])`;
  const typeId = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${typeId}, ${id}, 'Gold Weekly', 'recurring', 2500, 'USD', 1, 'week', 'all_classes')`;
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
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 2500, 'USD', 1, 'week', (now() AT TIME ZONE 'America/Chicago')::date - 7, 'active', 1, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  const agreements = records.map((r) => ({
    id: randomUUID(),
    gym_id: id,
    entry_id: r.id,
    words: "I agree that Cost Gym may save this card and charge it for my membership.",
    screen: "desk",
    brand: "VISA",
    last4: "1111",
    agreed_at: new Date(),
  }));
  for (let i = 0; i < agreements.length; i += 1000) await sql`INSERT INTO gym_card_agreements ${sql(agreements.slice(i, i + 1000))}`;
  const saved = records.map((r, i) => ({
    gym_id: id,
    entry_id: r.id,
    environment: "production",
    account_id: merchant,
    customer_id: `CUST${randomUUID().slice(0, 8)}`,
    card_id: `ccof:${randomUUID()}`,
    brand: "VISA",
    last4: "1111",
    exp_month: exp.month,
    exp_year: exp.year,
    saved_from: "desk",
    agreement_id: agreements[i]?.id ?? "",
    saved_at: new Date(),
    updated_at: new Date(),
  }));
  for (let i = 0; i < saved.length; i += 1000) await sql`INSERT INTO gym_member_cards ${sql(saved.slice(i, i + 1000))}`;
  return { id, owner, first: records[0]?.id ?? "" };
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
const many = (name: string, ts: { wall: number; js: number }[]) => {
  console.log(`${name.padEnd(60)} total median ${fmt(median(ts.map((t) => t.wall)))} (worst ${fmt(Math.max(...ts.map((t) => t.wall)))}) · thread busy median ${fmt(median(ts.map((t) => t.js)))}`);
};

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
// Noon in Chicago today, and the month there.
const [noon] = await sql<{ at: Date; month: number; year: number }[]>`
  SELECT ((now() AT TIME ZONE 'America/Chicago')::date + time '12:00') AT TIME ZONE 'America/Chicago' AS at,
         extract(month FROM now() AT TIME ZONE 'America/Chicago')::int AS month, extract(year FROM now() AT TIME ZONE 'America/Chicago')::int AS year`;
if (noon === undefined) throw new Error("no clock");
const clock = noon.at;
const thisMonth = { month: noon.month, year: noon.year };
const gyms: Gym[] = [];
for (let i = 0; i < GYMS; i++) gyms.push(await seedGym(PEOPLE, i, thisMonth));
const big = await seedGym(BIG, GYMS, thisMonth);
for (const table of ["gym_member_cards", "gym_held_memberships", "gym_member_list_entries", "gym_member_payers"]) await sql.unsafe(`VACUUM ANALYZE ${table}`);
const all = [...gyms.map((g) => g.id), big.id];
const total = GYMS * PEOPLE + BIG;
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}, reminders on, every card running out this month; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
const queue = () => queueDueNotices(sql, { environment: "production", now: clock, gymIds: all });

let written = 0;
const firstQueue = await time(async () => {
  written = await queue();
});
many(`the queue's first minute, writing all ${String(total)}`, [firstQueue]);
console.log(`${"written".padEnd(60)} ${String(written)}`);
await sql`VACUUM ANALYZE gym_card_expiry_notices`;
const queueDone: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) queueDone.push(await time(queue));
many("the queue, every one already written (every other minute)", queueDone);

const boxDeps = { sql, now: () => clock, emailKey: Buffer.alloc(32, 3) };
await getBillSettings(boxDeps, big.owner, big.id);
const boxes: { wall: number; js: number }[] = [];
let listed = 0;
for (let i = 0; i < RUNS; i++)
  boxes.push(
    await time(async () => {
      listed = (await getBillSettings(boxDeps, big.owner, big.id)).cardExpiry?.people.length ?? 0;
    }),
  );
many(`the Bills box of the gym of ${String(BIG)}, listing ${String(listed)} cards`, boxes);

const org = await getOrgById(sql, big.id);
if (org === null) throw new Error("no gym");
const square = squareSettings(
  {
    SQUARE_ENV: "production",
    SQUARE_APPLICATION_ID: "sq0idp-EXPIRYCOSTAPP1",
    SQUARE_APPLICATION_SECRET: "sq0csp-COSTSECRET", // dummy, gitleaks:allow
    PAYMENT_TOKENS_KEY: Buffer.alloc(32, 9).toString("base64"), // dummy, gitleaks:allow
    SQUARE_WEBHOOK_SIGNATURE_KEY: undefined,
    SQUARE_WEBHOOK_URL: undefined,
  },
  fakeSquare().api,
);
const cardDeps = { sql, square, log: { info: () => undefined, warn: () => undefined, error: () => undefined }, now: () => clock };
const cards: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) cards.push(await time(() => staffView(cardDeps, org, big.owner, big.first)));
many("a person's Card on file, in its last month", cards);

const minutes: { wall: number; js: number }[] = [];
let emails = 0;
for (;;) {
  let run = { sent: 0, skipped: 0, dropped: 0 };
  const t = await time(async () => {
    run = await sendDueCardExpiryNotices({
      sql,
      log: { info: () => undefined, warn: () => undefined },
      settings: { hmacKey: Buffer.alloc(32, 3), webOrigin: "http://localhost:5173", perDay: 0, paused: false, sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" } },
      sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" },
      transport: { send: () => Promise.resolve({ kind: "sent", id: `re_${randomUUID()}` }) },
      environment: "production",
      now: () => clock,
      sleep: () => Promise.resolve(),
      gymIds: all,
    });
  });
  if (run.sent + run.skipped + run.dropped === 0) break;
  emails += run.sent;
  minutes.push(t);
}
many("one minute of the sender (120 emails)", minutes);
console.log(`${"all emailed in".padEnd(60)} ${String(minutes.length)} minutes of the worker · ${String(emails)} emails`);

// A day nobody's card runs out: the cards' last month moved a year on.
await sql`UPDATE gym_member_cards SET exp_year = exp_year + 1 WHERE gym_id = ANY(${all}::uuid[])`;
await sql`VACUUM ANALYZE gym_member_cards`;
const quietDay: { wall: number; js: number }[] = [];
for (let i = 0; i < RUNS; i++) quietDay.push(await time(queue));
many("the queue on a month nobody's card runs out", quietDay);

delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
