// What 18a-ii costs at full size (CLAUDE.md §4 "Cost at full size"). The launch shape, 20
// gyms of 200 people, and one gym of 2,000 beside them; every person holds one repeating
// membership with one bill open and unpaid, so the Members list's new read of open bills
// has the most it can ever find. Measured:
//   - the new read alone (the open bills of a whole gym), which every list read now adds,
//     and beside it everything the list works out for a whole gym, the new read included;
//   - one page of the Members list, the list filtered to "Payment due", and the list's
//     counts, for the gym of 2,000; and a page for all 21 gyms at one moment;
//   - a person's page with its bills, one bill cancelled, one refund noted.
// Two numbers each: total, and how long the api's one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-member-refunds-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists and memberships, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { createMemoryRedis } from "../src/redis.js";
import { readEntries, readList } from "../src/modules/orgs/memberList/service.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { listBillFacts } from "../src/modules/orgs/memberships/billsSql.js";
import { heldOnListOf } from "../src/modules/orgs/memberships/onList.js";
import { cancelMemberBill, getHeldMemberships, noteMemberRefund, recordMemberPayment } from "../src/modules/orgs/memberships/heldService.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-member-refunds-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 10 });
const GYMS = 20;
const PEOPLE = 200;
const BIG = 2000;
const RUNS = 20;
const PLAN = "zz_refunds_cost";
const PREFIX = "refunds-cost-";

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
  // Given 10 days ago and never paid: one bill each, open and due.
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
    SELECT ${id}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 4999, 'GBP', 1, 'month', current_date - 10, 'active', 0, true
    FROM gym_member_list_entries e WHERE e.gym_id = ${id}`;
  return { id, owner };
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
const log = { info: () => undefined, error: (obj: object) => { console.error("a gym failed", obj); } };
const opened = await openDueBills({ sql, log }, { gymIds: [...gyms.map((g) => g.id), big.id] });
await sql`VACUUM ANALYZE gym_held_memberships`;
await sql`VACUUM ANALYZE gym_member_bills`;
console.log(
  `${String(GYMS)} gyms of ${String(PEOPLE)} and one of ${String(BIG)}, ${String(opened.opened)} bills open and unpaid; cpu ${String(cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each`,
);

const now = new Date();
const today = now.toISOString().slice(0, 10);
const listDeps = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => now };
const heldDeps = { sql, now: () => now };
const yes = () => Promise.resolve(true);
const someone = async (paid: number): Promise<{ id: string; entry_id: string }> => {
  const [m] = await sql<{ id: string; entry_id: string }[]>`
    SELECT h.id, h.entry_id FROM gym_held_memberships h
    WHERE h.gym_id = ${big.id} AND h.paid_periods = ${paid}
      AND NOT EXISTS (SELECT 1 FROM gym_member_bills b WHERE b.held_membership_id = h.id AND b.status IN ('void', 'refunded'))
    ORDER BY random() LIMIT 1`;
  if (m === undefined) throw new Error("nobody left to measure with");
  return m;
};

const calls: [string, () => Promise<unknown>][] = [
  [`the new read alone: the bills the list reads, the gym of ${String(BIG)}`, () => listBillFacts(sql, big.id, today, null)],
  [`the new read alone: the bills the list reads, a gym of ${String(PEOPLE)}`, () => listBillFacts(sql, gyms[0]?.id ?? "", today, null)],
  [`everybody's answer for the list, all its reads, the gym of ${String(BIG)}`, () => heldOnListOf(sql, big.id, today, null)],
  [`one page of Members, the gym of ${String(BIG)}`, () => readEntries(listDeps, big.owner, big.id, {}, yes)],
  [`Members filtered to Payment due, the gym of ${String(BIG)}`, () => readEntries(listDeps, big.owner, big.id, { paymentStatus: "payment due" }, yes)],
  [`the list's counts (Filter), the gym of ${String(BIG)}`, () => readList(listDeps, big.owner, big.id, yes)],
  [`one page of Members, a gym of ${String(PEOPLE)}`, () => readEntries(listDeps, gyms[0]?.owner ?? "", gyms[0]?.id ?? "", {}, yes)],
  [`one page of Members, all ${String(GYMS + 1)} gyms at one moment`, () => Promise.all([...gyms, big].map((g) => readEntries(listDeps, g.owner, g.id, {}, yes)))],
  [
    "read a person's page, with its bill",
    async () => {
      const m = await someone(0);
      return getHeldMemberships(heldDeps, big.owner, big.id, m.entry_id);
    },
  ],
  [
    "cancel a bill (a new person each time)",
    async () => {
      const m = await someone(0);
      const [bill] = await sql<{ id: string }[]>`SELECT id FROM gym_member_bills WHERE held_membership_id = ${m.id} AND status = 'open'`;
      return cancelMemberBill(heldDeps, big.owner, big.id, m.entry_id, m.id, bill?.id ?? "", { reason: "not_charging" });
    },
  ],
];

const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
const report = async (name: string, call: () => Promise<unknown>): Promise<void> => {
  await call();
  const walls: number[] = [];
  const jss: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = await time(call);
    walls.push(t.wall);
    jss.push(t.js);
  }
  console.log(`${name.padEnd(58)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
};
for (const [name, call] of calls) await report(name, call);

// A refund needs a payment: paid here outside the clock, then the refund alone is timed.
const paid: { id: string; entry_id: string; payment: string }[] = [];
for (let i = 0; i <= RUNS; i++) {
  const m = await someone(0);
  const page = await recordMemberPayment(heldDeps, big.owner, big.id, m.entry_id, m.id, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" });
  const payment = page.memberships.find((x) => x.id === m.id)?.billing?.bills[0]?.payments[0]?.id ?? "";
  paid.push({ ...m, payment });
}
await report("note a refund (a new payment each time)", async () => {
  const m = paid.pop();
  if (m === undefined) throw new Error("no payment left to refund");
  return noteMemberRefund(heldDeps, big.owner, big.id, m.entry_id, m.id, m.payment, { requestKey: randomUUID(), amountMinor: 2000, method: "cash", reason: "other" });
});
delay.disable();
console.log(`longest single stall of the thread during all of it: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
