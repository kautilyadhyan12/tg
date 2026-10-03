// What the leaderboard costs at full size (ROADMAP 19a; CLAUDE.md §4 "Cost at full size").
// One gym of 2,100 live app members (the biggest; --members= for another size) with three years of desk visits and app workouts; every board and period
// read as a member reads it, the console's "On a roll", and the console's Leaderboard page
// as its owner reads it (19a-iii: everyone, a page of a hundred), and staff adding and removing a visit (19a-iv). Half the members have a record on
// the gym's list and a tenth of their visits name only the record, so the by-record path is
// timed too. Two numbers each, over several runs:
//   - db: how long the read takes (it holds one of the pool's connections meanwhile);
//   - js: how long the server's one thread is busy and answers nobody (parsing the rows,
//     ranking, checking the reply).
//
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_b'
//   corepack pnpm --filter api exec tsx tools/measure-leaderboard-cost.ts [--members=200] [--keep]
//
// --keep leaves the gym in place (for EXPLAIN); the next run removes it first.
//
// LOCAL DATABASES ONLY: it writes a gym, 2,100 accounts, ~650,000 visits and as many
// workouts, and removes them.
import { createHash, randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { LEADERBOARD_PERIODS, type LeaderboardQuery } from "@app/shared";
import {
  getLeaderboard,
  getMyCounted,
  getProfile,
  getStaffCounted,
  getStaffLeaderboard,
  getStaffProfile,
} from "../src/modules/orgs/leaderboard/service.js";
import { addVisit, removeVisit } from "../src/modules/orgs/checkin/service.js";
import { getGymRegulars } from "../src/modules/orgs/repo.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("measure-leaderboard-cost: DATABASE_URL must be a local database");
  process.exit(2);
}
const sql = postgres(url, { prepare: false, max: 4 });
const membersArg = process.argv.find((a) => a.startsWith("--members="));
const MEMBERS = membersArg === undefined ? 2100 : Number(membersArg.slice("--members=".length));
const YEARS = 3;
const RUNS = process.argv.includes("--keep") ? 1 : 5;
const PLAN = "zz_lb_cost";
const PREFIX = "lb-cost-";

async function cleanup(): Promise<void> {
  const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
  await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance_removed WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
  await sql`DELETE FROM gyms WHERE slug LIKE ${PREFIX + "%"}`;
  await sql`DELETE FROM workouts WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${PREFIX + "%@example.com"})`;
  await sql`DELETE FROM streaks WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${PREFIX + "%@example.com"})`;
  await sql`DELETE FROM user_achievements WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${PREFIX + "%@example.com"})`;
  await sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%@example.com"}`;
  await sql`DELETE FROM plans WHERE code = ${PLAN}`;
}

async function seed(): Promise<{ gymId: string; viewers: string[]; owner: string }> {
  await sql`
    INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
    VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)`;
  const users = Array.from({ length: MEMBERS }, (_, i) => ({
    id: randomUUID(),
    email: `${PREFIX}${String(i)}-${randomUUID()}@example.com`,
    display_name: `Member${String(i)} Person${String(i % 97)}`,
  }));
  for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
  const owner = users[0]?.id ?? "";
  const gymId = randomUUID();
  await sql`INSERT INTO gyms (id, slug, name, timezone, owner_user_id) VALUES (${gymId}, ${PREFIX + gymId}, 'Cost Gym', 'Asia/Kolkata', ${owner})`;
  await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${owner}, 'owner')`;
  await sql`
    INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
    VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${PLAN}), 'active', 'pilot')`;
  const device = randomUUID();
  await sql`INSERT INTO gym_checkin_devices (id, gym_id, name) VALUES (${device}, ${gymId}, 'Desk')`;
  // Every second member joined with a record on the gym's list.
  const records = users.filter((_, i) => i % 2 === 0).map((u) => ({
    id: randomUUID(),
    gym_id: gymId,
    full_name: u.display_name,
    email: u.email,
    identity_key: createHash("sha256").update(u.id).digest("hex"),
    source: "typed",
  }));
  for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
  const recordOf = new Map(records.map((r) => [r.email, r.id]));
  // Everybody joined before the three years began, so every workout is inside a membership.
  const joinedAt = new Date(Date.now() - (365 * YEARS + 30) * 86_400_000);
  const members = users.map((u) => ({ gym_id: gymId, user_id: u.id, entry_id: recordOf.get(u.email) ?? null, joined_at: joinedAt }));
  for (let i = 0; i < members.length; i += 1000) await sql`INSERT INTO gym_members ${sql(members.slice(i, i + 1000))}`;
  // Three years of visits: each member comes on about two days in seven, all in SQL.
  await sql`
    INSERT INTO gym_attendance (gym_id, user_id, entry_id, device_id, day, marked_at, method, hours_status, slot_key)
    SELECT ${gymId},
           CASE WHEN m.entry_id IS NOT NULL AND random() < 0.2 THEN NULL ELSE m.user_id END,
           m.entry_id, ${device}, d::date, d + time '18:00', 'key_tag', 'hours_unset', 'hours_unset'
    FROM gym_members m
    CROSS JOIN generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - ${365 * YEARS}::int,
                               (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') d
    WHERE m.gym_id = ${gymId} AND random() < 0.3`;
  // Three years of app workouts at the same rate, each saved forty minutes after it began.
  await sql`
    INSERT INTO workouts (id, user_id, started_at, platform, engine_version, sets_count, total_reps, created_at)
    SELECT gen_random_uuid(), m.user_id, t.at, 'android', 'cost', 3, 30, t.at + interval '40 minutes'
    FROM gym_members m
    CROSS JOIN generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - ${365 * YEARS}::int,
                               (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, interval '1 day') d
    CROSS JOIN LATERAL (SELECT (d::date + time '07:00') AT TIME ZONE 'Asia/Kolkata' AS at) t
    WHERE m.gym_id = ${gymId} AND random() < 0.3`;
  const viewers = users.slice(1, 3).map((u) => u.id);
  // The viewers' own sets, three a workout: "what counted" reads who counted each.
  await sql`
    INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, mode, reps, duration_ms)
    SELECT w.id, w.user_id, (SELECT id FROM exercises ORDER BY slug LIMIT 1), w.started_at, i, 'log_only', 10, 60000
    FROM workouts w CROSS JOIN generate_series(0, 2) i
    WHERE w.user_id = ANY(${viewers})`;
  // As autovacuum leaves a table in production: the boards' index is read alone.
  await sql`VACUUM ANALYZE gym_attendance`;
  await sql`VACUUM ANALYZE workouts`;
  await sql`VACUUM ANALYZE workout_sets`;
  return { gymId, viewers, owner };
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const fmt = (ms: number): string => `${ms.toFixed(1)} ms`;

/** Time one read: wall time, and the time the thread was busy (wall minus the time it sat
 *  idle waiting for Postgres, measured as the event loop's own utilisation). */
async function time(fn: () => Promise<unknown>): Promise<{ wall: number; js: number }> {
  const before = performance.eventLoopUtilization();
  const start = performance.now();
  await fn();
  const wall = performance.now() - start;
  const used = performance.eventLoopUtilization(before);
  return { wall, js: used.active };
}

await cleanup();
const { gymId, viewers, owner } = await seed();
const visits = await sql<{ n: string }[]>`SELECT count(*) AS n FROM gym_attendance WHERE gym_id = ${gymId}`;
const workouts = await sql<{ n: string }[]>`
  SELECT count(*) AS n FROM workouts WHERE user_id IN (SELECT user_id FROM gym_members WHERE gym_id = ${gymId})`;
const mhz = await import("node:os").then((os) => os.cpus()[0]?.speed ?? 0);
console.log(`one gym: ${String(MEMBERS)} members, ${visits[0]?.n ?? "?"} visits and ${workouts[0]?.n ?? "?"} workouts over ${String(YEARS)} years; cpu ${String(mhz)} MHz; ${String(RUNS)} runs each`);

const deps = { sql, now: () => new Date() };
const delay = monitorEventLoopDelay({ resolution: 1 });
delay.enable();
const queries: [string, () => Promise<unknown>][] = [];
for (const period of LEADERBOARD_PERIODS) {
  const q: LeaderboardQuery = { board: "gym_days", period };
  queries.push([`board gym_days ${period}`, () => getLeaderboard(deps, viewers[0] ?? "", gymId, q)]);
}
for (const period of LEADERBOARD_PERIODS) {
  const q: LeaderboardQuery = { board: "workout_days", period };
  queries.push([`board workout_days ${period}`, () => getLeaderboard(deps, viewers[0] ?? "", gymId, q)]);
}
queries.push(["board streak", () => getLeaderboard(deps, viewers[0] ?? "", gymId, { board: "streak", period: "this_week" })]);
queries.push(["what counted, all time", () => getMyCounted(deps, viewers[0] ?? "", gymId, { board: "gym_days", period: "all_time" })]);
queries.push(["what counted, workouts all time", () => getMyCounted(deps, viewers[0] ?? "", gymId, { board: "workout_days", period: "all_time" })]);
queries.push(["what counted, streak", () => getMyCounted(deps, viewers[0] ?? "", gymId, { board: "streak", period: "this_week" })]);
queries.push(["a profile", () => getProfile(deps, viewers[0] ?? "", gymId, viewers[1] ?? "", "this_week")]);
queries.push(["On a roll (console)", () => getGymRegulars(sql, { gymId })]);
// The console's Leaderboard page, as the owner reads it.
const allowed = (): Promise<boolean> => Promise.resolve(true);
for (const period of ["this_week", "this_month", "all_time"] as const) {
  queries.push([`staff gym_days ${period}`, () => getStaffLeaderboard(deps, owner, gymId, { board: "gym_days", period, page: 1 }, allowed)]);
  queries.push([`staff workout_days ${period}`, () => getStaffLeaderboard(deps, owner, gymId, { board: "workout_days", period, page: 1 }, allowed)]);
}
queries.push(["staff streak", () => getStaffLeaderboard(deps, owner, gymId, { board: "streak", period: "this_week", page: 1 }, allowed)]);
queries.push(["staff, a person", () => getStaffProfile(deps, owner, gymId, viewers[1] ?? "", "this_week", allowed)]);
queries.push(["staff, what counted all time", () => getStaffCounted(deps, owner, gymId, viewers[1] ?? "", { board: "gym_days", period: "all_time" }, allowed)]);

for (const [name, fn] of queries) {
  await fn(); // warm
  const walls: number[] = [];
  const jss: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = await time(fn);
    walls.push(t.wall);
    jss.push(t.js);
  }
  console.log(`${name.padEnd(31)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
}
// Fixing a visit (19a-iv): staff add a visit for an earlier day and remove it again, a
// different day each run. Each write also works the person's app streak out again.
{
  const checkin = {
    sql,
    redis: createMemoryRedis(),
    now: () => new Date(),
    passKey: null,
    webOrigin: "http://localhost",
    log: { warn: () => undefined },
  };
  const person = viewers[1] ?? "";
  // Days with no visit of this person's, inside the window a visit can be added for.
  const free = await sql<{ day: string }[]>`
    SELECT d.day::text AS day
    FROM (SELECT ((now() AT TIME ZONE g.timezone)::date - n) AS day FROM gyms g, generate_series(1, 60) n WHERE g.id = ${gymId}) d
    WHERE NOT EXISTS (SELECT 1 FROM gym_attendance a WHERE a.gym_id = ${gymId} AND a.user_id = ${person} AND a.day = d.day)
    ORDER BY d.day DESC
    LIMIT ${RUNS + 1}`;
  const adds: { wall: number; js: number }[] = [];
  const removes: { wall: number; js: number }[] = [];
  for (const { day } of free) {
    adds.push(await time(() => addVisit(checkin, owner, gymId, { pick: { userId: person }, day }, allowed)));
    const row = await sql<{ id: string }[]>`
      SELECT id FROM gym_attendance WHERE gym_id = ${gymId} AND user_id = ${person} AND day = ${day}::date AND hours_status = 'added_later'`;
    const visitId = row[0]?.id;
    if (visitId === undefined) throw new Error("the visit was not added");
    removes.push(await time(() => removeVisit(checkin, owner, gymId, visitId, allowed)));
  }
  // The first of each is the warm-up, as for the reads.
  for (const [name, runs] of [["staff add a visit", adds.slice(1)], ["staff remove a visit", removes.slice(1)]] as const) {
    const walls = runs.map((r) => r.wall);
    const jss = runs.map((r) => r.js);
    console.log(`${name.padEnd(31)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
  }
  queries.length = 0;
  queries.push(["what counted, after removals", () => getMyCounted(deps, person, gymId, { board: "gym_days", period: "all_time" })]);
  for (const [name, fn] of queries) {
    await fn();
    const walls: number[] = [];
    const jss: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const t = await time(fn);
      walls.push(t.wall);
      jss.push(t.js);
    }
    console.log(`${name.padEnd(31)} total median ${fmt(median(walls))} (worst ${fmt(Math.max(...walls))}) · server thread busy median ${fmt(median(jss))} (worst ${fmt(Math.max(...jss))})`);
  }
}
delay.disable();
console.log(`longest single stall of the thread during all reads: ${fmt(delay.max / 1e6)}`);
if (process.argv.includes("--keep")) console.log(`kept: gym ${gymId}, viewer ${viewers[0] ?? ""}`);
else await cleanup();
await sql.end({ timeout: 5 });
