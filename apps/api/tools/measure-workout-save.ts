// What saving a workout costs at full size (spec Part 2 §13.5 and §13.9, job 61a; CLAUDE.md §4, "Cost
// at full size"). Against the LOCAL database, with the api's own pool of 10 connections, it measures:
//   - what one save holds the server for, answering nobody else: reading its text and checking it, and
//     the heart rate's sums. For a usual save (20 sets, an hour of heart rate) and the biggest the
//     server takes (200 sets, 12 hours of heart rate a second);
//   - 200 people saving at the same instant: the whole time, each save's own time, and the longest the
//     server's process went without answering anybody meanwhile.
// The people it makes are removed after. Run from apps/api:
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_ex2'; corepack pnpm exec tsx tools/measure-workout-save.ts
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import { heartSums, workoutSaveSchema, type WorkoutSave } from "@app/shared";
import { saveWorkout } from "../src/modules/training/service.js";

const PEOPLE = 200;
const RUNS = 5;

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("set DATABASE_URL to a LOCAL database");

/** Thirteen hours ago, so even the 12-hour workout has ended. */
const START = Date.now() - 13 * 3_600_000;
const iso = (ms: number) => new Date(START + ms).toISOString();

function body(sets: number, heartSeconds: number, lengthMs: number): WorkoutSave {
  const kinds = ["squat", "barbell_curl", "plank"] as const;
  return {
    workoutId: randomUUID(),
    name: "Measured workout",
    startedAt: iso(0),
    endedAt: iso(lengthMs),
    timeZone: "Asia/Kolkata",
    startedFrom: "saved",
    effort: 3,
    heart: Array.from({ length: heartSeconds }, (_, i): [number, number] => [i * 1000, 100 + (i % 60)]),
    platform: "android",
    appVersion: "1.0.0",
    sets: Array.from({ length: sets }, (_, i) => {
      const exercise = kinds[i % 3] ?? "squat";
      return exercise === "plank"
        ? { exercise, position: i, measuredIn: "time" as const, target: 30, done: 30, weightGrams: null, restSeconds: 60, durationMs: 30_000, counted: "timer" as const }
        : { exercise, position: i, measuredIn: "reps" as const, target: 10, done: 10, weightGrams: exercise === "barbell_curl" ? 20_000 : null, restSeconds: 60, durationMs: 40_000, counted: "hand" as const };
    }),
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};
const ms = (x: number): string => `${x.toFixed(1)} ms`;

/** Reading the text, checking it and the heart rate's sums: what the server does with no database. */
function held(text: string): number {
  const t0 = performance.now();
  const parsed = workoutSaveSchema.parse(JSON.parse(text));
  heartSums(parsed.heart, [], Date.parse(parsed.endedAt) - Date.parse(parsed.startedAt));
  return performance.now() - t0;
}

const sql = postgres(url, { prepare: false, max: 10, onnotice: () => undefined });
const emails = sql`SELECT id FROM users WHERE email LIKE 'measure-save-%@example.com'`;
const clear = async () => {
  await sql`DELETE FROM user_achievements WHERE user_id IN (${emails})`;
  await sql`DELETE FROM user_xp WHERE user_id IN (${emails})`;
  await sql`DELETE FROM streaks WHERE user_id IN (${emails})`;
  await sql`DELETE FROM workouts WHERE user_id IN (${emails})`;
  await sql`DELETE FROM users WHERE email LIKE 'measure-save-%@example.com'`;
};

try {
  for (const [label, text] of [
    ["usual save: 20 sets, an hour of heart rate", JSON.stringify(body(20, 3600, 2 * 3_600_000))],
    ["biggest save: 200 sets, 12 hours of heart rate", JSON.stringify(body(200, 12 * 3600, 12 * 3_600_000))],
  ] as const) {
    held(text); // the first run warms the code up
    const runs = Array.from({ length: RUNS }, () => held(text));
    console.log(`${label}: ${String(Math.round(text.length / 1024))} KB, holds the server ${ms(median(runs))} (median of ${String(RUNS)})`);
  }

  await clear();
  const ids = await sql<{ id: string }[]>`
    INSERT INTO users (email, display_name)
    SELECT 'measure-save-' || g || '@example.com', 'Measure Save' FROM generate_series(1, ${PEOPLE}) g RETURNING id`;
  const deps = { sql, now: () => new Date() };
  await saveWorkout(deps, ids[0]?.id ?? "", body(20, 3600, 2 * 3_600_000)); // warm-up, not counted

  const loop = monitorEventLoopDelay({ resolution: 1 });
  const each: number[] = [];
  loop.enable();
  const t0 = performance.now();
  await Promise.all(
    ids.slice(1).map(async ({ id }) => {
      const s0 = performance.now();
      const input = workoutSaveSchema.parse(JSON.parse(JSON.stringify(body(20, 3600, 2 * 3_600_000))));
      await saveWorkout(deps, id, input);
      each.push(performance.now() - s0);
    }),
  );
  const whole = performance.now() - t0;
  loop.disable();
  console.log(
    `${String(PEOPLE - 1)} people saving at the same instant: ${ms(whole)} in all; each save ${ms(median(each))} (median), ${ms(Math.max(...each))} the longest; ` +
      `the server answered nobody for at most ${ms(loop.max / 1e6)} at a time`,
  );
} finally {
  await clear();
  await sql.end();
}
