// What a person's memberships cost at full size (ROADMAP 17a-ii; CLAUDE.md §4 "Cost at
// full size"). One gym of 2,100 people on its list (--people= for another size), each
// holding three memberships and one of them holding years of earlier ones; a person's
// memberships read as staff read them, one given, and one changed. Two numbers each,
// over several runs:
//   - total: how long the call takes (a write holds the gym's row for that long, so the
//     gym's other writes wait behind it);
//   - js: how long the server's one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-held-memberships-cost.ts [--people=200]
//
// LOCAL DATABASES ONLY: it writes a gym, its list and their memberships, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { HELD_EARLIER_PAGE } from "@app/shared";
import { getHeldMemberships, giveHeldMembership, moveHeldMembership } from "../src/modules/orgs/memberships/heldService.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-held-memberships-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RUNS = 9;
const PLAN = "zz_held_cost";
const PREFIX = "held-cost-";

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

async function seed(): Promise<{ gymId: string; owner: string; typeId: string; typical: string; fullest: string }> {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const owner = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner')`;
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const typeId = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${typeId}, ${gymId}, 'Gold Monthly', 'recurring', 4999, 'GBP', 1, 'month', 'all_classes')`;
  const records = Array.from({ length: PEOPLE }, (_, i) => {
    const id = randomUUID();
    return {
      id,
      gym_id: gymId,
      full_name: `Person${String(i)} Cost`,
      email: `${PREFIX}${String(i)}-${id}@example.com`,
      identity_key: createHash("sha256").update(id).digest("hex"),
      source: "typed",
    };
  });
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  const typical = records[1]?.id ?? "";
  const fullest = records[0]?.id ?? "";
  // Three each: one running, two that are over. The first person holds more earlier ones than a page shows.
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit,
       starts_on, anchor_on, status, cancelled_on, paid_periods, renews)
    SELECT ${gymId}, e.id, ${typeId}, gen_random_uuid(), 'recurring', 4999, 'GBP', 1, 'month',
           current_date - (n * 200), current_date - (n * 200),
           CASE WHEN n = 0 THEN 'active' ELSE 'cancelled' END,
           CASE WHEN n = 0 THEN NULL ELSE current_date - (n * 200) + 90 END, 1, true
    FROM gym_member_list_entries e
    CROSS JOIN generate_series(0, ${HELD_EARLIER_PAGE + 20}) AS n
    WHERE e.gym_id = ${gymId} AND (n < 3 OR e.id = ${fullest})`;
  await sql`VACUUM ANALYZE gym_held_memberships`;
  return { gymId, owner, typeId, typical, fullest };
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
const { gymId, owner, typeId, typical, fullest } = await seed();
const rows = await sql<{ n: string }[]>`SELECT count(*) AS n FROM gym_held_memberships WHERE gym_id = ${gymId}`;
const mhz = await import("node:os").then((os) => os.cpus()[0]?.speed ?? 0);
console.log(`one gym: ${String(PEOPLE)} people on its list, ${rows[0]?.n ?? "?"} memberships; cpu ${String(mhz)} MHz; ${String(RUNS)} runs each`);

const deps = { sql, now: () => new Date() };
const today = new Date().toISOString().slice(0, 10);
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
let paid = 1;
const calls: [string, () => Promise<unknown>][] = [
  ["read a person's 3 memberships", () => getHeldMemberships(deps, owner, gymId, typical)],
  [`read a person's ${String(HELD_EARLIER_PAGE + 21)} memberships`, () => getHeldMemberships(deps, owner, gymId, fullest)],
  [
    "give a membership",
    async () => {
      const person = await sql<{ id: string }[]>`
        SELECT e.id FROM gym_member_list_entries e
        WHERE e.gym_id = ${gymId} AND e.id NOT IN (${typical}, ${fullest})
        ORDER BY random() LIMIT 1`;
      return giveHeldMembership(deps, owner, gymId, person[0]?.id ?? "", { requestKey: randomUUID(), typeId, startsOn: today, paid: true });
    },
  ],
  [
    "mark one paid",
    async () => {
      const [m] = await sql<{ id: string }[]>`
        SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${typical} AND status = 'active'`;
      paid += 1;
      return moveHeldMembership(deps, owner, gymId, typical, m?.id ?? "", { type: "paid", paidPeriods: paid });
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
  console.log(`${name.padEnd(31)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}
delay.disable();
console.log(`longest single stall of the thread during all calls: ${fmt(delay.max / 1e6)}`);

await cleanup();
await sql.end({ timeout: 5 });
