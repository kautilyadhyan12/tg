// What each person's days cost at full size (ROADMAP Stage 2 item 14a-ii; CLAUDE.md §4 "Cost at full
// size"): 10,000 more people, each with 40 days of time in the app; 4,000 of them (20 gyms of 200)
// with 3 meal scans a day and their cost, 500 with a route plan a day. What they saved (14a-iii): the
// 4,000 save 2 meals from a photo and 1 by hand a day and a pack's label a week, the 500 a run a day,
// 1,000 a workout every other day, 2,000 a body measurement a week. All taken out again at the end,
// whatever happens.
//
//   DATABASE_URL=postgres://… corepack pnpm --filter api exec tsx tools/measure-admin-days-cost.ts
//
// Prints the whole read (the database and the server) and the server's own work on it (the time it
// answers nobody: its CPU time, averaged over the reads, as Windows counts CPU time in steps of about
// 15 ms), for one person's 30 days, their earlier days, and today for everyone, first and a later page.
import postgres from "postgres";
import { createMemoryRedis } from "../src/redis.js";
import { dayPeople, personDays } from "../src/modules/admin/service.js";

const url = process.env["DATABASE_URL"];
if (url === undefined || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("DATABASE_URL must be a local database");
}
// EXPLAIN=1 prints the database plan of the day's read once.
const seen: { query: string; params: unknown[] }[] = [];
const sql = postgres(url, { prepare: false, max: 10, debug: (_c, query, params: readonly unknown[]) => seen.push({ query, params: [...params] }) });

const PEOPLE = 10_000;
const DAYS = 40;
const SCANNERS = 4_000;
const RUNNERS = 500;

const median = (xs: number[]): string => {
  const s = [...xs].sort((a, b) => a - b);
  return (s[Math.floor(s.length / 2)] ?? 0).toFixed(1);
};

const cleanUp = async (): Promise<void> => {
  const mine = sql`SELECT id FROM users WHERE email LIKE 'measure-days-%@gmail.com'`;
  await sql`DELETE FROM api_cost_events WHERE user_id IN (${mine})`;
  await sql`DELETE FROM meal_logs WHERE user_id IN (${mine})`;
  await sql`DELETE FROM runs WHERE user_id IN (${mine})`;
  await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
  await sql`DELETE FROM users WHERE email LIKE 'measure-days-%@gmail.com'`;
};

try {
  await cleanUp();
  const started = performance.now();
  const people = (await sql<{ id: string }[]>`
    INSERT INTO users (email, display_name, created_at)
    SELECT 'measure-days-' || i || '@gmail.com', 'Measure Days ' || i, now() - interval '60 days'
    FROM generate_series(1, ${PEOPLE}) AS i ORDER BY i RETURNING id`).map((r) => r.id);
  await sql`
    INSERT INTO app_minutes (user_id, day, minutes, zone)
    SELECT p.id, (now() AT TIME ZONE 'Asia/Kolkata')::date - d, 1 + (p.n * 7 + d) % 120, CASE WHEN p.n % 10 = 0 THEN 'Europe/London' ELSE 'Asia/Kolkata' END
    FROM unnest(${people}::uuid[]) WITH ORDINALITY AS p(id, n), generate_series(0, ${DAYS - 1}) AS d`;
  await sql`
    INSERT INTO metered_uses (user_id, feature, at)
    SELECT p.id, 'meal_scan', now() - make_interval(days => d, hours => k * 3)
    FROM unnest(${people.slice(0, SCANNERS)}::uuid[]) AS p(id), generate_series(0, ${DAYS - 1}) AS d, generate_series(1, 3) AS k
    ORDER BY 3`;
  await sql`
    INSERT INTO metered_uses (user_id, feature, at)
    SELECT p.id, 'route_gen', now() - make_interval(days => d, hours => 1)
    FROM unnest(${people.slice(SCANNERS, SCANNERS + RUNNERS)}::uuid[]) AS p(id), generate_series(0, ${DAYS - 1}) AS d`;
  // Four ledger rows a day: the photos and the second questions. Rows go in by time, as a real ledger's
  // do (its BRIN index on `at` counts on it).
  await sql`
    INSERT INTO api_cost_events (at, user_id, feature, provider, units, unit_type, cost_micro)
    SELECT now() - make_interval(days => d, hours => k), p.id, 'meal_scan', 'measure', 1000, 'tokens', 176
    FROM unnest(${people.slice(0, SCANNERS)}::uuid[]) AS p(id), generate_series(0, ${DAYS - 1}) AS d, generate_series(1, 4) AS k
    ORDER BY 1`;
  // What they saved (14a-iii), on the day it reached the server.
  await sql`
    INSERT INTO meal_logs (user_id, taken_at, meal_name, items, kcal_point, kcal_low, kcal_high, confirmed, origin, portion_source, nutrition_sources, calc_version, created_at)
    SELECT p.id, now() - make_interval(days => d, hours => k * 3), 'Measure meal', '[]'::jsonb, 500, 450, 550, true,
           CASE WHEN k = 3 THEN 'manual' ELSE 'photo' END, 'default', '{curated}', 1, now() - make_interval(days => d, hours => k * 3)
    FROM unnest(${people.slice(0, SCANNERS)}::uuid[]) AS p(id), generate_series(0, ${DAYS - 1}) AS d, generate_series(1, 3) AS k
    ORDER BY 13`;
  await sql`
    INSERT INTO member_label_foods (id, user_id, name, unit, kcal, protein_g, carbs_g, fat_g, created_at, updated_at)
    SELECT gen_random_uuid(), p.id, 'Measure pack', 'g', 400, 10, 60, 12, now() - make_interval(days => d, hours => 2), now() - make_interval(days => d, hours => 2)
    FROM unnest(${people.slice(0, SCANNERS)}::uuid[]) AS p(id), generate_series(0, ${DAYS - 1}, 7) AS d
    ORDER BY 9`;
  await sql`
    INSERT INTO runs (id, user_id, started_at, duration_s, distance_m, created_at)
    SELECT gen_random_uuid(), p.id, now() - make_interval(days => d, hours => 2), 1800, 5000, now() - make_interval(days => d, hours => 1)
    FROM unnest(${people.slice(SCANNERS, SCANNERS + RUNNERS)}::uuid[]) AS p(id), generate_series(0, ${DAYS - 1}) AS d
    ORDER BY 6`;
  await sql`
    INSERT INTO workouts (id, user_id, started_at, platform, engine_version, created_at)
    SELECT gen_random_uuid(), p.id, now() - make_interval(days => d, hours => 5), 'android', 'measure', now() - make_interval(days => d, hours => 4)
    FROM unnest(${people.slice(SCANNERS + RUNNERS, SCANNERS + RUNNERS + 1000)}::uuid[]) AS p(id), generate_series(0, ${DAYS - 1}, 2) AS d
    ORDER BY 6`;
  await sql`
    INSERT INTO body_measurements (user_id, measured_at, weight_kg, created_at)
    SELECT p.id, now() - make_interval(days => d, hours => 6), 70, now() - make_interval(days => d, hours => 6)
    FROM unnest(${people.slice(0, 2000)}::uuid[]) AS p(id), generate_series(0, ${DAYS - 1}, 7) AS d
    ORDER BY 4`;
  for (const table of ["meal_logs", "member_label_foods", "runs", "workouts", "body_measurements"]) await sql.unsafe(`ANALYZE ${table}`);
  await sql`ANALYZE app_minutes`;
  await sql`ANALYZE metered_uses`;
  await sql`ANALYZE api_cost_events`;
  const counts = await sql<{ minutes: number; uses: number; costs: number; meals: number; labels: number; runs: number; workouts: number; body: number }[]>`
    SELECT (SELECT count(*)::int FROM app_minutes) AS minutes, (SELECT count(*)::int FROM metered_uses) AS uses,
           (SELECT count(*)::int FROM api_cost_events) AS costs, (SELECT count(*)::int FROM meal_logs) AS meals,
           (SELECT count(*)::int FROM member_label_foods) AS labels, (SELECT count(*)::int FROM runs) AS runs,
           (SELECT count(*)::int FROM workouts) AS workouts, (SELECT count(*)::int FROM body_measurements) AS body`;
  console.log(`made in ${((performance.now() - started) / 1000).toFixed(0)} s; rows in this database: ${JSON.stringify(counts[0])}`);

  const deps = { sql, redis: createMemoryRedis() };
  const heavy = people[0] ?? "";
  const zone = "Asia/Kolkata";
  const today = (await sql<{ d: string }[]>`SELECT (now() AT TIME ZONE ${zone}::text)::date::text AS d`)[0]?.d ?? "";
  const firstDays = await personDays(deps, { userId: heavy, zone, dayZone: null, before: null, now: new Date() });
  const cases: { said: string; read: () => Promise<number> }[] = [
    { said: "one person's 30 days", read: async () => (await personDays(deps, { userId: heavy, zone, dayZone: null, before: null, now: new Date() }))?.days.length ?? 0 },
    { said: "their earlier days", read: async () => (await personDays(deps, { userId: heavy, zone, dayZone: null, before: firstDays?.next ?? null, now: new Date() }))?.days.length ?? 0 },
    { said: "today for everyone, first page", read: async () => (await dayPeople(deps, { day: today, zone, from: 0 })).people.length },
    { said: "today for everyone, a later page (from 5,000)", read: async () => (await dayPeople(deps, { day: today, zone, from: 5000 })).people.length },
  ];
  if (process.env["EXPLAIN"] === "1") {
    seen.length = 0;
    await dayPeople(deps, { day: today, zone, from: 0 });
    const q = seen.find((x) => x.query.includes("uses_near AS MATERIALIZED"));
    if (q !== undefined) {
      const plan = await sql.begin(async (tx) => {
        await tx`SET LOCAL jit = off`;
        return await tx.unsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN (ANALYZE, BUFFERS) ${q.query}`, q.params as never[]);
      });
      console.log(plan.map((r) => r["QUERY PLAN"]).join("\n"));
    }
    // And one person's 30 days, which 14a-iii added what they saved to.
    seen.length = 0;
    await personDays(deps, { userId: heavy, zone, dayZone: null, before: null, now: new Date() });
    const p = seen.find((x) => x.query.includes("generate_series(0,"));
    if (p !== undefined) {
      const plan = await sql.unsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN (ANALYZE, BUFFERS) ${p.query}`, p.params as never[]);
      console.log(plan.map((r) => r["QUERY PLAN"]).join("\n"));
    }
  }
  const READS = 10;
  for (const c of cases) {
    const whole: number[] = [];
    let shown = 0;
    const cpu = process.cpuUsage();
    for (let k = 0; k < READS; k++) {
      const t = performance.now();
      shown = await c.read();
      whole.push(performance.now() - t);
    }
    const used = process.cpuUsage(cpu);
    const own = (used.user + used.system) / 1000 / READS;
    console.log(`${c.said}: ${String(shown)} rows; whole read median ${median(whole)} ms; the server's own work (answering nobody) ${own.toFixed(1)} ms a read`);
  }
  const totals = await dayPeople(deps, { day: today, zone, from: 0 });
  console.log(`today's totals: ${JSON.stringify(totals.totals)}`);
} finally {
  await cleanUp();
  await sql.end();
}
