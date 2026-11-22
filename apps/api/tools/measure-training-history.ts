// What a person's history and records cost at full size (spec Part 2 §13.5, job 61b; CLAUDE.md §4, "Cost
// at full size"). Against the LOCAL database, with the api's own pool of 10 connections:
//   - one heavy person: six workouts a week for five years (1,560 workouts), each of 30 sets of the three
//     Library exercises (46,800 sets), weighted;
//   - beside them, the rest of the launch shape (20 gyms of 200): 3,999 people of 20 workouts of 10 sets,
//     so the database chooses its way as it would with everybody's sets in the table.
// For each read the heavy person makes (a month, the calendar's year (64a-v), a day, their newest workout with its new records against
// everything before it, and one exercise's records with its last seven times (63c)), it measures the median time of a read and the
// longest the server's process went without answering anybody while it ran. Everybody it makes is
// removed after. Run from apps/api:
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_ex2'; corepack pnpm exec tsx tools/measure-training-history.ts
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { createMemoryRedis } from "../src/redis.js";
import { historyDay, historyMonth, historyRange, historyWorkout, recordsOf } from "../src/modules/training/history.js";
import * as repo from "../src/modules/training/historyRepo.js";
import { exerciseRecords, recentBests, unitAndDone } from "../src/modules/training/records.js";

const RUNS = 7;
const OTHERS = 3999;
const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("set DATABASE_URL to a LOCAL database");

const sql = postgres(url, { prepare: false, max: 10 });
const redis = createMemoryRedis();
const deps = { sql, redis };
const TAG = "measure-history-";

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};
const ms = (x: number): string => `${x.toFixed(1)} ms`;

async function clear(): Promise<void> {
  const mine = sql`SELECT id FROM users WHERE email LIKE ${`${TAG}%@example.com`}`;
  await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
  await sql`DELETE FROM users WHERE email LIKE ${`${TAG}%@example.com`}`;
}

/** `people` people from number `from`, each with `workouts` workouts of `sets` sets, one a day apart
 *  from five years ago (six a week for the heavy one). */
async function make(from: number, people: number, workouts: number, sets: number): Promise<void> {
  const emails = Array.from({ length: people }, (_, i) => `${TAG}${String(from + i)}@example.com`);
  await sql`INSERT INTO users (email, display_name) SELECT e, 'Measured' FROM unnest(${emails}::text[]) e`;
  await sql`
    INSERT INTO workouts (id, user_id, started_at, ended_at, platform, engine_version, sets_count, total_reps, duration_ms, name, time_zone, started_from)
    SELECT gen_random_uuid(), u.id, t.at, t.at + interval '1 hour', 'android', '1.0.0', ${sets}, 0, 3600000, 'Measured', 'Asia/Calcutta', 'none'
    FROM users u CROSS JOIN LATERAL (
      SELECT now() - interval '5 years' + (g * interval '1 day' * 7 / 6) AS at FROM generate_series(1, ${workouts}) g) t
    WHERE u.email = ANY(${emails}::text[])`;
  await sql`
    INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, mode, reps, hold_ms, duration_ms,
                              engine_version, definition_version, counted, measured_in, target, weight_grams, rest_seconds)
    SELECT w.id, w.user_id, x.id, w.started_at, g, 'log_only',
           CASE WHEN x.slug = 'plank' THEN 0 ELSE 5 + (g % 8) END,
           CASE WHEN x.slug = 'plank' THEN (30 + (g * 7 + extract(doy FROM w.started_at)::int) % 90) * 1000 END,
           40000, NULL, NULL, 'hand',
           CASE WHEN x.slug = 'plank' THEN 'time' ELSE 'reps' END, 10,
           CASE WHEN x.slug = 'plank' THEN NULL ELSE 20000 + ((g * 13 + extract(doy FROM w.started_at)::int) % 100) * 1000 END, 60
    FROM workouts w
    JOIN users u ON u.id = w.user_id AND u.email = ANY(${emails}::text[])
    CROSS JOIN generate_series(0, ${sets - 1}) g
    JOIN exercises x ON x.slug = (ARRAY['squat', 'barbell_curl', 'plank'])[g % 3 + 1]`;
}

async function measure(name: string, read: () => Promise<unknown>): Promise<void> {
  await read(); // warm
  const times: number[] = [];
  let blocked = 0;
  let bytes = 0;
  for (let i = 0; i < RUNS; i++) {
    const loop = monitorEventLoopDelay({ resolution: 1 });
    loop.enable();
    const t0 = performance.now();
    const out = await read();
    bytes = JSON.stringify(out).length; // the reply's text, as Fastify sends it
    times.push(performance.now() - t0);
    loop.disable();
    blocked = Math.max(blocked, loop.max / 1e6);
  }
  console.log(`${name.padEnd(46)} median ${ms(median(times)).padStart(9)} · answering nobody at most ${ms(blocked).padStart(8)} · ${String(Math.round(bytes / 1024))} KB`);
}

async function main(): Promise<void> {
  await clear();
  const t0 = performance.now();
  await make(0, 1, 1560, 30);
  for (let from = 1; from <= OTHERS; from += 1000) await make(from, Math.min(1000, OTHERS - from + 1), 20, 10);
  await sql`ANALYZE workouts`;
  await sql`ANALYZE workout_sets`;
  const [heavy] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${`${TAG}0@example.com`}`;
  if (heavy === undefined) throw new Error("no heavy person");
  const counts = await sql<{ workouts: number; sets: number }[]>`
    SELECT (SELECT count(*)::int FROM workouts WHERE user_id = ${heavy.id}) AS workouts,
           (SELECT count(*)::int FROM workout_sets WHERE user_id = ${heavy.id}) AS sets`;
  const all = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workout_sets`;
  console.log(`made in ${ms(performance.now() - t0)}: the heavy person ${JSON.stringify(counts[0])}; ${String(all[0]?.n)} sets in the table`);

  const [newest] = await sql<{ id: string; day: string }[]>`
    SELECT id, to_char(started_at AT TIME ZONE 'Asia/Calcutta', 'YYYY-MM-DD') AS day FROM workouts WHERE user_id = ${heavy.id} ORDER BY started_at DESC LIMIT 1`;
  if (newest === undefined) throw new Error("no workout");
  await measure("a month", () => historyMonth(deps, heavy.id, newest.day.slice(0, 7)));
  // The calendar's year (64a-v): a free plan's, read back 90 days, and a plan with no limit's, all 365 days.
  const yearFrom = new Date(Date.parse(`${newest.day}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10);
  await measure("the calendar's year, a free plan's 90 days", () => historyRange(deps, heavy.id, yearFrom, newest.day));
  await measure("the calendar's year, all 365 days", () => repo.rangeDays(sql, heavy.id, yearFrom, newest.day, "UTC", null));
  await measure("a day", () => historyDay(deps, heavy.id, newest.day));
  await measure("the newest workout, new records vs 5 years", () => historyWorkout(deps, heavy.id, newest.id));
  await measure("squat's records, a free plan's 90 days", () => recordsOf(deps, heavy.id, "squat"));
  // A plan with no limit reads all five years: the same reads, with no floor.
  const [squat] = await sql<{ id: string }[]>`SELECT id FROM exercises WHERE slug = 'squat'`;
  if (squat === undefined) throw new Error("no squat");
  await measure("squat's records, all five years", async () => {
    const window = { before: null, floor: null };
    const [rows, sums, latest] = await Promise.all([
      repo.recordCandidates(sql, heavy.id, [squat.id], window),
      repo.liftedByWorkout(sql, heavy.id, [squat.id], window),
      repo.recentSets(sql, heavy.id, squat.id, null, 7),
    ]);
    const fact = (r: repo.FactRow) => ({ workoutId: r.workout_id, startedAt: r.started_at.toISOString(), exercise: r.slug, position: r.set_index, ...unitAndDone(r.measured_in, r.reps, r.hold_ms), weightGrams: r.weight_grams });
    const records = exerciseRecords(rows.map(fact), sums.map((s) => ({ workoutId: s.workout_id, startedAt: s.started_at.toISOString(), exercise: s.slug, grams: s.grams })));
    return { ...records, recent: recentBests(latest.map(fact)) };
  });

  const explain = await sql<{ "QUERY PLAN": string }[]>`
    EXPLAIN (ANALYZE, BUFFERS) SELECT s.weight_grams FROM workout_sets s JOIN workouts w ON w.id = s.workout_id AND w.user_id = ${heavy.id}
    WHERE s.user_id = ${heavy.id} AND s.exercise_id = (SELECT id FROM exercises WHERE slug = 'squat')`;
  console.log(explain.map((r) => r["QUERY PLAN"]).join("\n"));
}

main()
  .finally(async () => {
    await clear();
    await sql.end();
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
