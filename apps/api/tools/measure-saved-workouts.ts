// What a person's saved workouts cost at full size (spec Part 2 §13.5, job 61c; CLAUDE.md §4, "Cost at
// full size"). Against the LOCAL database, with the api's own pool of 10 connections:
//   - one person at the limit: 50 saved workouts of 200 sets each (10,000 sets), the most the app allows
//     (49 while a new one is saved);
//   - beside them, the rest of the launch shape (20 gyms of 200): 3,999 people of 5 saved workouts of 10
//     sets, so the database chooses its way as it would with everybody's in the tables.
// For each thing the person does (the list, one saved workout, a new one, a change, a delete), and for the
// publish's question of which exercises a saved workout names, it measures the median time and the longest
// the server's process went without answering anybody while it ran; then 200 people saving at the same
// instant. Everybody it makes is removed after. Run from apps/api:
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_ex2'; corepack pnpm exec tsx tools/measure-saved-workouts.ts
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import postgres from "postgres";
import type { PlannedExercise, SavedWorkoutWrite } from "@app/shared";
import { namedBySavedSets } from "../src/modules/library/repo.js";
import { deleteSaved, listSaved, readSaved, writeSaved } from "../src/modules/training/saved.js";

const RUNS = 7;
const OTHERS = 3999;
const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("set DATABASE_URL to a LOCAL database");

const sql = postgres(url, { prepare: false, max: 10 });
const deps = { sql, now: () => new Date() };
const TAG = "measure-saved-";

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};
const ms = (x: number): string => `${x.toFixed(1)} ms`;

async function clear(): Promise<void> {
  const mine = sql`SELECT id FROM users WHERE email LIKE ${`${TAG}%@example.com`}`;
  await sql`DELETE FROM saved_workouts WHERE user_id IN (${mine})`;
  await sql`DELETE FROM saved_workout_removed_ids WHERE user_id IN (${mine})`;
  await sql`DELETE FROM users WHERE email LIKE ${`${TAG}%@example.com`}`;
}

/** `people` people from number `from`, each with `saved` saved workouts of `sets` sets of three exercises. */
async function make(from: number, people: number, saved: number, sets: number): Promise<void> {
  const emails = Array.from({ length: people }, (_, i) => `${TAG}${String(from + i)}@example.com`);
  await sql`INSERT INTO users (email, display_name) SELECT e, 'Measured' FROM unnest(${emails}::text[]) e`;
  await sql`
    INSERT INTO saved_workouts (id, user_id, name, edited_at)
    SELECT gen_random_uuid(), u.id, 'Measured ' || g, now() - make_interval(mins => g)
    FROM users u CROSS JOIN generate_series(1, ${saved}) g WHERE u.email = ANY(${emails}::text[])`;
  await sql`
    INSERT INTO saved_workout_sets (saved_workout_id, exercise_place, set_place, exercise_id, measured_in, target, weight_grams, rest_seconds)
    SELECT w.id, g / 4, g % 4, x.id, CASE WHEN x.slug = 'plank' THEN 'time' ELSE 'reps' END, 10,
           CASE WHEN x.slug = 'plank' THEN NULL ELSE 20000 END, 60
    FROM saved_workouts w
    JOIN users u ON u.id = w.user_id AND u.email = ANY(${emails}::text[])
    CROSS JOIN generate_series(0, ${sets - 1}) g
    JOIN exercises x ON x.slug = (ARRAY['squat', 'barbell_curl', 'plank'])[(g / 4) % 3 + 1]`;
}

/** The biggest saved workout: 50 exercises of 4 sets. */
const biggest = (name: string, editedAt: string): SavedWorkoutWrite => ({
  name,
  editedAt,
  exercises: Array.from({ length: 50 }, (_, i): PlannedExercise => {
    const slug = (["squat", "barbell_curl", "plank"] as const)[i % 3] ?? "squat";
    return { exercise: slug, measuredIn: slug === "plank" ? "time" : "reps", sets: Array.from({ length: 4 }, () => ({ target: 10, weightGrams: slug === "plank" ? null : 20000, restSeconds: 60 })) };
  }),
});

async function measure(name: string, act: () => Promise<unknown>, after: () => Promise<void> = () => Promise.resolve()): Promise<void> {
  await act(); // warm
  await after();
  const times: number[] = [];
  let blocked = 0;
  let bytes = 0;
  for (let i = 0; i < RUNS; i++) {
    const loop = monitorEventLoopDelay({ resolution: 1 });
    loop.enable();
    const t0 = performance.now();
    const out = await act();
    times.push(performance.now() - t0);
    loop.disable();
    bytes = out === undefined ? 0 : JSON.stringify(out).length; // the reply's text, as Fastify sends it
    blocked = Math.max(blocked, loop.max / 1e6);
    await after();
  }
  console.log(`${name.padEnd(44)} median ${ms(median(times)).padStart(9)} · answering nobody at most ${ms(blocked).padStart(8)} · ${String(Math.round(bytes / 1024))} KB`);
}

async function main(): Promise<void> {
  await clear();
  const t0 = performance.now();
  await make(0, 1, 49, 200);
  for (let from = 1; from <= OTHERS; from += 1000) await make(from, Math.min(1000, OTHERS - from + 1), 5, 10);
  await sql`ANALYZE saved_workouts`;
  await sql`ANALYZE saved_workout_sets`;
  const [heavy] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${`${TAG}0@example.com`}`;
  if (heavy === undefined) throw new Error("no heavy person");
  const all = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM saved_workout_sets`;
  console.log(`made in ${ms(performance.now() - t0)}; ${String(all[0]?.n)} saved sets in the table`);

  // A new one of 200 sets, taking the person to 50; removed after each run, unmeasured.
  let made = "";
  await measure(
    "save a new one of 200 sets (49 → 50)",
    async () => {
      made = randomUUID();
      return await writeSaved(deps, heavy.id, made, biggest("New", new Date().toISOString()));
    },
    async () => {
      await sql`DELETE FROM saved_workouts WHERE id = ${made}`;
    },
  );
  const fiftieth = randomUUID();
  await writeSaved(deps, heavy.id, fiftieth, biggest("Fiftieth", new Date(Date.now() - 60_000).toISOString()));
  const counted = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM saved_workouts WHERE user_id = ${heavy.id}`;
  console.log(`the person holds ${String(counted[0]?.n)} saved workouts`);
  await measure("the list of 50, 10,000 sets", () => listSaved(deps, heavy.id));
  await measure("one saved workout of 200 sets", () => readSaved(deps, heavy.id, fiftieth));
  await measure("a change to all 200 sets", () => writeSaved(deps, heavy.id, fiftieth, biggest("Changed", new Date().toISOString())));
  // The person's 50th is deleted each run and made again after it, unmeasured.
  let gone = fiftieth;
  await measure(
    "a delete of one of 200 sets",
    async () => {
      await deleteSaved(deps, heavy.id, gone);
      return undefined;
    },
    async () => {
      gone = randomUUID();
      await writeSaved(deps, heavy.id, gone, biggest("Again", new Date().toISOString()));
    },
  );
  const libraryIds = (await sql<{ id: string }[]>`SELECT exercise_id AS id FROM library_exercises`).map((r) => r.id);
  await measure(`a publish's question, ${String(libraryIds.length)} exercises`, () => sql.begin((tx) => namedBySavedSets(tx, libraryIds)).then((s) => [...s]));

  // 200 people saving the biggest one at the same instant.
  const crowd = await sql<{ id: string }[]>`SELECT id FROM users WHERE email LIKE ${`${TAG}%@example.com`} AND email <> ${`${TAG}0@example.com`} LIMIT 200`;
  const loop = monitorEventLoopDelay({ resolution: 1 });
  loop.enable();
  const c0 = performance.now();
  await Promise.all(crowd.map((p) => writeSaved(deps, p.id, randomUUID(), biggest("Crowd", new Date().toISOString()))));
  const took = performance.now() - c0;
  loop.disable();
  console.log(`${String(crowd.length)} people saving 200 sets at once: ${ms(took)} in all · answering nobody at most ${ms(loop.max / 1e6)}`);
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
