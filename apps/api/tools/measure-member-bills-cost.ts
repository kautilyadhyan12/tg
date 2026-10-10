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
// LOCAL DATABASES ONLY: it writes gyms, their lists and memberships, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { getHeldMemberships, recordMemberPayment } from "../src/modules/orgs/memberships/heldService.js";

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
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 4999, 'GBP', 1, 'month', current_date - 40, 'active', 0, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
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
console.log(`${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}, each person a count to move and a bill to open; cpu ${String(cpus()[0]?.speed ?? 0)} MHz`);

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
];
for (const [name, call] of calls) {
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
delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
