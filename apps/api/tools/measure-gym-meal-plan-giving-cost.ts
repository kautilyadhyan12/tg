// What giving a gym's meal plans costs at full size (ROADMAP Stage 2 24a-ii; CLAUDE.md §4 "Cost at
// full size"). Gyms of 200, 2,000 and 10,000 people: half hold Gold Monthly, a third carry a tag, and
// five plans are given to everybody, to Gold Monthly, to the tag, and to 50 people ticked. Measured for
// what staff and members do: the Plans list, a plan's Who gets it, the box before Give to everybody,
// Give to 500 people ticked, a person's page, and a member's own read. Two numbers each: total, and
// how long the api's one thread is busy and answers nobody.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-gym-meal-plan-giving-cost.ts
//
// LOCAL DATABASES ONLY: it writes gyms, their lists and plans, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import * as giving from "../src/modules/nutrition/gymMealPlanGivingService.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-gym-meal-plan-giving-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const SIZES = process.env["SIZES"] === undefined ? [200, 2000, 10000] : process.env["SIZES"].split(",").map(Number);
const RUNS = 7;
const PLAN = "zz_meal_giving_cost";
const PREFIX = "meal-giving-cost-";
const yes = () => Promise.resolve(true);

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM gym_meal_plans WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_entry_tags WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_tags WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

interface Gym { id: string; owner: string; member: string; entryIds: string[]; plans: string[] }

async function seedGym(people: number): Promise<Gym> {
  const owner = randomUUID();
  const member = randomUUID();
  await sql`INSERT INTO users (id, email, display_name) VALUES (${owner}, ${`${PREFIX}${owner}@example.com`}, 'Cost Owner'), (${member}, ${`${PREFIX}${member}@example.com`}, 'Cost Member')`;
  const id = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, country, owner_user_id) VALUES (${id}, ${PREFIX + id}, 'Cost Gym', 'Europe/London', 'GB', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
  await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const gold = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
    VALUES (${gold}, ${id}, 'Gold Monthly', 'recurring', 4999, 'GBP', 1, 'month', 'all_classes')`;
  const records = Array.from({ length: people }, (_, i) => ({
    id: randomUUID(),
    gym_id: id,
    full_name: `Person${String(i)} Cost`,
    email: `${PREFIX}p${String(i)}-${id}@example.com`,
    identity_key: createHash("sha256").update(`${id}-${String(i)}`).digest("hex"),
    source: "typed",
    // A third more from the old file's word, as an import leaves them.
    membership_type: i % 6 === 1 ? "Gold Monthly" : null,
  }));
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  const ids = records.map((r) => r.id);
  const half = ids.filter((_, i) => i % 2 === 0);
  await sql`
    INSERT INTO gym_held_memberships (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, renews, paid_periods)
    SELECT ${id}, e, ${gold}, gen_random_uuid(), 'recurring', 4999, 'GBP', 1, 'month', (now() - interval '40 days')::date, 'active', true, 3
    FROM unnest(${half}::uuid[]) AS e`;
  const tag = randomUUID();
  await sql`INSERT INTO gym_member_tags (id, gym_id, name) VALUES (${tag}, ${id}, 'Beginners')`;
  await sql`INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id) SELECT ${id}, e, ${tag} FROM unnest(${ids.filter((_, i) => i % 3 === 0)}::uuid[]) AS e`;
  await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${id}, ${member}, now() - interval '30 days', ${ids[0] ?? null})`;
  const plans = Array.from({ length: 5 }, () => randomUUID());
  for (const [at, p] of plans.entries()) {
    await sql`INSERT INTO gym_meal_plans (id, gym_id, name, days, written_by_user_id) VALUES (${p}, ${id}, ${`Plan ${String(at)}`}, '[[],[],[],[],[],[],[]]'::jsonb, ${owner})`;
  }
  const deps = { sql };
  await giving.giveToGroup(deps, owner, id, plans[0] ?? "", { kind: "everyone" }, yes);
  await giving.giveToGroup(deps, owner, id, plans[1] ?? "", { kind: "membership_type", membershipTypeId: gold }, yes);
  await giving.giveToGroup(deps, owner, id, plans[2] ?? "", { kind: "tag", tagId: tag }, yes);
  await giving.giveToRecords(deps, owner, id, plans[3] ?? "", ids.slice(0, 50));
  return { id, owner, member, entryIds: ids, plans };
}

async function time(fn: () => Promise<unknown>): Promise<{ wall: number; js: number }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  await fn();
  const wall = performance.now() - start;
  return { wall, js: performance.eventLoopUtilization(before).active };
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number) => `${ms.toFixed(1)} ms`;

await cleanup();
await sql`
  INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
  VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
console.log(`cpu ${String(cpus()[0]?.speed ?? 0)} MHz; ${String(RUNS)} runs each, the median`);
try {
  for (const size of SIZES) {
    const gym = await seedGym(size);
    await sql`ANALYZE gym_member_list_entries`;
    await sql`ANALYZE gym_held_memberships`;
    await sql`ANALYZE gym_meal_plan_audiences`;
    const deps = { sql };
    const ticked = gym.entryIds.slice(100, 600);
    const steps: [string, () => Promise<unknown>][] = [
      ["the Plans list", () => giving.listGymMealPlans(deps, gym.owner, gym.id, yes)],
      ["a plan's Who gets it", () => giving.givenOf(deps, gym.owner, gym.id, gym.plans[3] ?? "", yes)],
      ["the box before Give to everybody", () => giving.previewGiveToGroup(deps, gym.owner, gym.id, gym.plans[4] ?? "", { kind: "everyone" }, yes)],
      ["the box before Give to 500 ticked", () => giving.previewGiveToRecords(deps, gym.id, gym.plans[4] ?? "", ticked)],
      ["Give to 500 ticked", () => giving.giveToRecords(deps, gym.owner, gym.id, gym.plans[4] ?? "", ticked)],
      ["a person's page", () => giving.planForRecord(deps, gym.owner, gym.id, gym.entryIds[7] ?? "", yes)],
      ["a member's own read (the phone)", () => giving.myGymMealPlan(deps, gym.member, gym.id, yes)],
    ];
    console.log(`\na gym of ${size.toLocaleString("en")}`);
    for (const [name, fn] of steps) {
      await fn();
      const runs: { wall: number; js: number }[] = [];
      for (let i = 0; i < RUNS; i++) runs.push(await time(fn));
      console.log(`  ${name.padEnd(38)} total ${fmt(median(runs.map((r) => r.wall)))} · thread busy ${fmt(median(runs.map((r) => r.js)))}`);
    }
  }
} finally {
  if (process.env["KEEP"] === undefined) await cleanup();
  await sql.end({ timeout: 5 });
}
