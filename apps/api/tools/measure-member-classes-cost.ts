// What a member's list of classes costs at full size (ROADMAP 17d; CLAUDE.md §4 "Cost at
// full size"; spec Part 3 §13.7). One gym of 2,100 members (--people= for another size),
// each on its list with a class pack and a membership of 3 bookings a week, and a busy
// week: 20 classes a day for 7 days in 10 kinds of class, every class of 30 full, 20
// waiting on every other one. The reader is booked on 5 and waiting on 5.
// Measured: one member's week, the same member's later week, and THE BURST: 200 members
// opening the list at the same instant through ten database connections, as the api has.
// Then the same again with one place freed on every class, so every other class has a
// free place and 20 people waiting whom the list must plan for (--no-freed leaves it out).
// The numbers that matter are how long the server's one thread answers nobody, and how
// long another gym's request waits for a connection while it runs.
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm --filter api exec tsx tools/measure-member-classes-cost.ts [--people=200] [--keep]
//
// LOCAL DATABASES ONLY: it writes a gym, its people and their bookings, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { getMemberClasses } from "../src/modules/orgs/classes/bookingsService.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-member-classes-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
let statements = 0;
// Ten connections, as the api talks to the database on (ROADMAP Stage 4 item 11).
const sql = postgres(url, { prepare: false, max: 10, debug: () => void statements++ });
const peopleArg = process.argv.find((a) => a.startsWith("--people="));
const PEOPLE = peopleArg === undefined ? 2100 : Number(peopleArg.slice("--people=".length));
const RUNS = 7;
const BURST = 200;
const KINDS = 10;
const PLAN = "zz_member_classes_cost";
const PREFIX = "member-classes-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_class_types WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

async function seed(): Promise<{ gymId: string; people: string[] }> {
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
  const packType = randomUUID();
  const limitedType = randomUUID();
  await sql`
    INSERT INTO gym_membership_types (id, gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, bookings_limit, bookings_period)
    VALUES (${packType}, ${gymId}, '500 classes', 'pack', 9000, 'GBP', NULL, NULL, 500, 365, 'all_classes', NULL, NULL),
           (${limitedType}, ${gymId}, '3 a week', 'recurring', 4000, 'GBP', 1, 'month', NULL, NULL, 'limited', 3, 'week')`;

  const people = Array.from({ length: PEOPLE }, () => randomUUID());
  const users = people.map((id, i) => ({ id, email: `${PREFIX}${String(i)}-${id}@example.com`, display_name: `Person${String(i)} Cost` }));
  const entries = people.map((id, i) => ({
    id: randomUUID(),
    gym_id: gymId,
    full_name: `Person${String(i)} Cost`,
    email: `${PREFIX}l-${String(i)}-${id}@example.com`,
    identity_key: createHash("sha256").update(id).digest("hex"),
    source: "typed",
  }));
  for (let i = 0; i < people.length; i += 1000) {
    await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
    await sql`INSERT INTO gym_member_list_entries ${sql(entries.slice(i, i + 1000))}`;
    await sql`INSERT INTO gym_members ${sql(people.slice(i, i + 1000).map((id, k) => ({ gym_id: gymId, user_id: id, joined_at: new Date("2026-01-01T00:00:00Z"), entry_id: entries[i + k]?.id ?? null })))}`;
  }
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days, classes_left, starts_on, status, renews)
    SELECT ${gymId}, e.id, ${packType}, gen_random_uuid(), 'pack', 9000, 'GBP', 500, 365, 400, current_date - 10, 'active', false
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId}`;
  await sql`
    INSERT INTO gym_held_memberships
      (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, renews)
    SELECT ${gymId}, e.id, ${limitedType}, gen_random_uuid(), 'recurring', 4000, 'GBP', 1, 'month', current_date - 10, 'active', true
    FROM gym_member_list_entries e WHERE e.gym_id = ${gymId}`;

  // Eight weeks of timetable, 20 classes a day from 06:00 on the half hour, in ten kinds.
  const kinds = Array.from({ length: KINDS }, (_, i) => ({ id: randomUUID(), gym_id: gymId, name: `Class ${String(i + 1)}`, minutes: 45, places: 30, colour: "blue" }));
  await sql`INSERT INTO gym_class_types ${sql(kinds)}`;
  await sql`
    INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places)
    SELECT ${gymId}, (${kinds.map((k) => k.id)}::uuid[])[1 + (slot % ${KINDS})], day::date, 360 + slot * 30,
           ((day::date + make_interval(mins => 360 + slot * 30)) AT TIME ZONE 'Europe/London'), 45, 30
    FROM generate_series(current_date + 1, current_date + 56, interval '1 day') AS day, generate_series(0, 19) AS slot`;
  // Every class full, in the order of its people; 20 more waiting on every other class.
  await sql`
    INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
    SELECT ${gymId}, s.id, m.user_id, m.entry_id, h.id, CASE WHEN p.i < 30 THEN 'booked' ELSE 'waitlisted' END, p.i < 30, gen_random_uuid(),
           CASE WHEN p.i < 30 THEN now() END
    FROM (SELECT id, row_number() OVER (ORDER BY starts_at, id) AS k FROM gym_class_sessions WHERE gym_id = ${gymId}) s
    CROSS JOIN generate_series(0, 49) AS p(i)
    JOIN (SELECT user_id, entry_id, row_number() OVER (ORDER BY user_id) - 1 AS r FROM gym_members WHERE gym_id = ${gymId}) m
      ON m.r = (s.k * 37 + p.i) % ${Math.max(60, PEOPLE - 250)} + 250
    JOIN gym_held_memberships h ON h.gym_id = ${gymId} AND h.entry_id = m.entry_id AND h.kind = 'pack'
    WHERE p.i < 30 OR s.k % 2 = 0`;
  for (const table of ["users", "gym_members", "gym_member_list_entries", "gym_class_types", "gym_class_sessions", "gym_class_bookings", "gym_held_memberships", "gym_membership_types"]) {
    await sql`VACUUM ANALYZE ${sql(table)}`;
  }
  // The people who read (the first 250, in the order the join above numbered them) hold no
  // place yet: the reader waits on five classes of the coming week.
  const readers = (await sql<{ user_id: string }[]>`SELECT user_id FROM gym_members WHERE gym_id = ${gymId} ORDER BY user_id LIMIT 250`).map((r) => r.user_id);
  const reader = readers[0] ?? "";
  await sql`
    INSERT INTO gym_class_bookings (gym_id, session_id, user_id, status, request_key)
    SELECT ${gymId}, s.id, ${reader}, 'waitlisted', gen_random_uuid()
    FROM (SELECT id FROM gym_class_sessions WHERE gym_id = ${gymId} ORDER BY starts_at, id LIMIT 5) s`;
  return { gymId, people: readers };
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;
const yes = () => Promise.resolve(true);

await cleanup();
const s = await seed();
const [counts] = await sql<{ classes: number; bookings: number }[]>`
  SELECT (SELECT count(*)::int FROM gym_class_sessions WHERE gym_id = ${s.gymId}) AS classes,
         (SELECT count(*)::int FROM gym_class_bookings WHERE gym_id = ${s.gymId}) AS bookings`;
const mhz = await import("node:os").then((os) => os.cpus()[0]?.speed ?? 0);
console.log(`one gym: ${String(PEOPLE)} members, each with a pack and a 3-a-week membership; ${String(counts?.classes ?? -1)} classes, ${String(counts?.bookings ?? -1)} bookings; cpu ${String(mhz)} MHz; ${String(RUNS)} runs each`);

const deps = { sql, now: () => new Date() };
const reader = s.people[0] ?? "";
const delay = monitorEventLoopDelay({ resolution: 1 });
const shapes = process.argv.includes("--no-freed") ? ["every class full"] : ["every class full", "one place freed on every class"];
for (const shape of shapes) {
if (shape !== "every class full") await sql`UPDATE gym_class_sessions SET places = 31 WHERE gym_id = ${s.gymId}`;
console.log(`── ${shape} ──`);
for (const week of shape === "every class full" ? [0, 1, 7] : [0]) {
  const first = await getMemberClasses(deps, reader, s.gymId, { week }, yes);
  const walls: number[] = [];
  const jss: number[] = [];
  const stalls: number[] = [];
  let asked = 0;
  for (let i = 0; i < RUNS; i++) {
    statements = 0;
    delay.reset();
    delay.enable();
    const before = performance.eventLoopUtilization();
    const start = performance.now();
    await getMemberClasses(deps, reader, s.gymId, { week }, yes);
    walls.push(performance.now() - start);
    jss.push(performance.eventLoopUtilization(before).active);
    delay.disable();
    stalls.push(delay.max / 1e6);
    asked = statements;
  }
  console.log(
    `a member's week ${String(week)}: ${String(first?.classes.length ?? -1)} classes, ${String(asked)} statements · total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))}) · longest stall median ${fmt(median(stalls))} (worst ${fmt(Math.max(...stalls))})`,
  );
}

// THE BURST: 200 members open the list at the same instant.
const burstWalls: number[] = [];
const burstJs: number[] = [];
const waits: number[] = [];
const stalls: number[] = [];
const crowd = s.people.slice(1, 1 + BURST);
await new Promise((resolve) => setTimeout(resolve, 200));
for (let run = 0; run < RUNS; run++) {
  const state = { probing: true };
  let worstWait = 0;
  // Another gym's request during the burst: how long it waits for one of the ten connections.
  const probe = (async () => {
    while (state.probing) {
      const start = performance.now();
      await sql`SELECT 1`;
      worstWait = Math.max(worstWait, performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
  delay.reset();
  delay.enable();
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  await Promise.all(crowd.map((userId) => getMemberClasses(deps, userId, s.gymId, { week: 0 }, yes)));
  burstWalls.push(performance.now() - start);
  burstJs.push(performance.eventLoopUtilization(before).active);
  delay.disable();
  state.probing = false;
  await probe;
  waits.push(worstWait);
  stalls.push(delay.max / 1e6);
}
console.log(`the burst, ${String(crowd.length)} members opening the list at once:`);
console.log(`  until the last person is answered: median ${fmt(median(burstWalls))} (worst ${fmt(Math.max(...burstWalls))})`);
console.log(`  server thread busy in all: median ${fmt(median(burstJs))} (worst ${fmt(Math.max(...burstJs))})`);
console.log(`  longest single stall of the thread: median ${fmt(median(stalls))} (worst ${fmt(Math.max(...stalls))})`);
console.log(`  longest another request waited for a database connection: median ${fmt(median(waits))} (worst ${fmt(Math.max(...waits))})`);
}

if (process.argv.includes("--keep")) console.log(`kept: gym ${s.gymId}, the reader ${reader}`);
else await cleanup();
await sql.end({ timeout: 5 });
