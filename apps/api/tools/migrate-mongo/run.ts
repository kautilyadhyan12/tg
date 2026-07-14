// P2.7b/c — migration CLI. `tsx tools/migrate-mongo/run.ts [--apply]`.
//   default (dry-run): read Mongo, transform, report counts — writes NOTHING.
//   --apply: idempotent upsert into Postgres (ON CONFLICT DO NOTHING) + verify.
// Env (parsed once, R2.3 spirit): MONGO_URI, DATABASE_URL. Standalone tool —
// its own entrypoint, not the API boot path. Secrets never printed.
// Stages run in FK order: users → workouts(+sets) → gamification recompute →
// meals → body(+weight refresh) → meal gamification → coach(threads+messages)
// → runs → saved_routes (run_schedules deferred, GAP-G).
// PRECONDITION for --apply: target DB seeded (exercises + achievements are FK
// targets) — `tsx src/db/seed.ts` (idempotent).
import { z } from "zod";
import { connectMongo } from "./mongo.js";
import { connectPg } from "./pg.js";
import { insertUser, transformUser } from "./collections/users.js";
import { insertWorkout, loadExerciseIds, transformWorkout } from "./collections/workouts.js";
import { insertMeal, transformMeal } from "./collections/meals.js";
import { insertBody, refreshUserWeight, transformBody } from "./collections/body.js";
import { insertCoach, transformCoach } from "./collections/coach.js";
import { insertRoute, insertRun, transformRoute, transformRun } from "./collections/running.js";
import { verifyBcrypt, verifyCoachRunning, verifyNutrition, verifyUsersCount, verifyWorkouts } from "./verify.js";
import { onMealLogged, onWorkoutSynced } from "../../src/modules/gamification/service.js";

const envSchema = z.object({
  MONGO_URI: z.string().min(1),
  DATABASE_URL: z.string().url(),
});

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    console.error("Missing env: MONGO_URI and/or DATABASE_URL. (secrets never printed)");
    process.exit(2);
  }
  const mongo = await connectMongo(env.data.MONGO_URI);
  const sql = connectPg(env.data.DATABASE_URL);
  try {
    // ── users ────────────────────────────────────────────────────────────
    {
      let read = 0;
      let transformed = 0;
      let inserted = 0;
      let skipped = 0;
      let errors = 0;
      await mongo.each("users", async (doc) => {
        read += 1;
        const row = transformUser(doc);
        if (row === null) {
          skipped += 1;
          console.warn(`skip malformed user (mongo _id ${String(doc["_id"])})`);
          return;
        }
        transformed += 1;
        if (apply) {
          // Per-row fail-soft: a genuine unique collision (e.g. duplicate email)
          // is logged with its _id and counted, never silently dropped and never
          // aborting the whole run (T3 finding 2).
          try {
            inserted += await insertUser(sql, row);
          } catch (e) {
            errors += 1;
            console.error(`insert failed (mongo _id ${String(doc["_id"])}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
      console.log(`users: read=${String(read)} transformed=${String(transformed)} skipped=${String(skipped)} inserted=${String(inserted)} errors=${String(errors)} mode=${apply ? "apply" : "dry-run"}`);
      if (errors > 0) process.exitCode = 1;
    }

    // ── workouts (+ sets) ────────────────────────────────────────────────
    // slug→id for the SEEDED catalog only; unseeded slugs (P4) skip + flag.
    const idBySlug = await loadExerciseIds(sql);
    const affectedUsers = new Set<string>();
    {
      let read = 0;
      let transformed = 0;
      let skipped = 0;
      let inserted = 0;
      let setsInserted = 0;
      let setsSkipped = 0;
      let errors = 0;
      await mongo.each("workout_sessions", async (doc) => {
        read += 1;
        const row = transformWorkout(doc, idBySlug);
        if (row === null) {
          skipped += 1;
          console.warn(`skip unmigratable workout (mongo _id ${String(doc["_id"])}): missing/invalid started_at`);
          return;
        }
        transformed += 1;
        setsSkipped += row.skippedSets;
        affectedUsers.add(row.userId);
        if (apply) {
          try {
            const o = await insertWorkout(sql, row);
            inserted += o.workoutInserted;
            setsInserted += o.setsInserted;
          } catch (e) {
            errors += 1;
            console.error(`insert failed (mongo _id ${String(doc["_id"])}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
      console.log(`workouts: read=${String(read)} transformed=${String(transformed)} skipped=${String(skipped)} inserted=${String(inserted)} sets_inserted=${String(setsInserted)} sets_skipped(unresolved names)=${String(setsSkipped)} errors=${String(errors)} mode=${apply ? "apply" : "dry-run"}`);
      if (errors > 0) process.exitCode = 1;
    }

    // ── gamification recompute (streaks + achievements, §7:882-884) ───────
    // REUSE the sync-path hook — replays streaks from workout-day history and
    // awards achievements idempotently. UTC day-math matches legacy utcnow.
    if (apply) {
      let recomputed = 0;
      let errors = 0;
      for (const userId of affectedUsers) {
        try {
          await onWorkoutSynced({ sql }, userId, null);
          recomputed += 1;
        } catch (e) {
          errors += 1;
          console.error(`recompute failed (user ${userId}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      console.log(`gamification recompute: users=${String(recomputed)} errors=${String(errors)}`);
      if (errors > 0) process.exitCode = 1;
    }

    // ── meals ────────────────────────────────────────────────────────────
    const mealUsers = new Set<string>();
    {
      let read = 0;
      let transformed = 0;
      let skipped = 0;
      let inserted = 0;
      let errors = 0;
      await mongo.each("meal_logs", async (doc) => {
        read += 1;
        const row = transformMeal(doc);
        if (row === null) {
          skipped += 1;
          console.warn(`skip unmigratable meal (mongo _id ${String(doc["_id"])}): missing/invalid consumed_at`);
          return;
        }
        transformed += 1;
        mealUsers.add(row.userId);
        if (apply) {
          try {
            inserted += await insertMeal(sql, row);
          } catch (e) {
            errors += 1;
            console.error(`insert failed (mongo _id ${String(doc["_id"])}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
      console.log(`meals: read=${String(read)} transformed=${String(transformed)} skipped=${String(skipped)} inserted=${String(inserted)} errors=${String(errors)} mode=${apply ? "apply" : "dry-run"}`);
      if (errors > 0) process.exitCode = 1;
    }

    // ── body measurements (+ users.weight_kg refresh, GAP-D) ─────────────
    const bodyUsers = new Set<string>();
    {
      let read = 0;
      let transformed = 0;
      let skipped = 0;
      let inserted = 0;
      let errors = 0;
      await mongo.each("body_measurements", async (doc) => {
        read += 1;
        const row = transformBody(doc);
        if (row === null) {
          skipped += 1;
          console.warn(`skip unmigratable measurement (mongo _id ${String(doc["_id"])}): missing/invalid measured_at`);
          return;
        }
        transformed += 1;
        bodyUsers.add(row.userId);
        if (apply) {
          try {
            inserted += await insertBody(sql, row);
          } catch (e) {
            errors += 1;
            console.error(`insert failed (mongo _id ${String(doc["_id"])}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
      if (apply) {
        for (const userId of bodyUsers) await refreshUserWeight(sql, userId);
      }
      console.log(`body_measurements: read=${String(read)} transformed=${String(transformed)} skipped=${String(skipped)} inserted=${String(inserted)} weight_refreshed_users=${String(apply ? bodyUsers.size : 0)} errors=${String(errors)} mode=${apply ? "apply" : "dry-run"}`);
      if (errors > 0) process.exitCode = 1;
    }

    // ── meal gamification (badges, GAP-E) ────────────────────────────────
    // REUSE onMealLogged — awards meal badges (first_meal…) idempotently;
    // also lazily reconciles the user's streak to today (live-read parity).
    if (apply) {
      let recomputed = 0;
      let errors = 0;
      for (const userId of mealUsers) {
        try {
          await onMealLogged({ sql }, userId, null);
          recomputed += 1;
        } catch (e) {
          errors += 1;
          console.error(`meal recompute failed (user ${userId}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      console.log(`meal gamification: users=${String(recomputed)} errors=${String(errors)}`);
      if (errors > 0) process.exitCode = 1;
    }

    // ── coach (threads + messages) ───────────────────────────────────────
    {
      let read = 0;
      let transformed = 0;
      let skipped = 0;
      let threadsInserted = 0;
      let messagesInserted = 0;
      let errors = 0;
      await mongo.each("coach_conversations", async (doc) => {
        read += 1;
        const d = transformCoach(doc);
        if (d === null) {
          skipped += 1;
          console.warn(`skip unmigratable conversation (mongo _id ${String(doc["_id"])})`);
          return;
        }
        transformed += 1;
        if (apply) {
          try {
            const o = await insertCoach(sql, d);
            threadsInserted += o.threadInserted;
            messagesInserted += o.messagesInserted;
          } catch (e) {
            errors += 1;
            console.error(`insert failed (mongo _id ${String(doc["_id"])}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
      console.log(`coach: read=${String(read)} transformed=${String(transformed)} skipped=${String(skipped)} threads_inserted=${String(threadsInserted)} messages_inserted=${String(messagesInserted)} errors=${String(errors)} mode=${apply ? "apply" : "dry-run"}`);
      if (errors > 0) process.exitCode = 1;
    }

    // ── runs ─────────────────────────────────────────────────────────────
    {
      let read = 0;
      let transformed = 0;
      let skipped = 0;
      let inserted = 0;
      let errors = 0;
      await mongo.each("running_sessions", async (doc) => {
        read += 1;
        const row = transformRun(doc);
        if (row === null) {
          skipped += 1;
          console.warn(`skip unmigratable run (mongo _id ${String(doc["_id"])}): missing/invalid started_at`);
          return;
        }
        transformed += 1;
        if (apply) {
          try {
            inserted += await insertRun(sql, row);
          } catch (e) {
            errors += 1;
            console.error(`insert failed (mongo _id ${String(doc["_id"])}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
      console.log(`runs: read=${String(read)} transformed=${String(transformed)} skipped=${String(skipped)} inserted=${String(inserted)} errors=${String(errors)} mode=${apply ? "apply" : "dry-run"}`);
      if (errors > 0) process.exitCode = 1;
    }

    // ── saved routes ─────────────────────────────────────────────────────
    {
      let read = 0;
      let transformed = 0;
      let skipped = 0;
      let inserted = 0;
      let errors = 0;
      await mongo.each("running_routes", async (doc) => {
        read += 1;
        const row = transformRoute(doc);
        if (row === null) {
          skipped += 1;
          console.warn(`skip unmigratable route (mongo _id ${String(doc["_id"])}): missing/empty coords`);
          return;
        }
        transformed += 1;
        if (apply) {
          try {
            inserted += await insertRoute(sql, row);
          } catch (e) {
            errors += 1;
            console.error(`insert failed (mongo _id ${String(doc["_id"])}): ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
      console.log(`saved_routes: read=${String(read)} transformed=${String(transformed)} skipped=${String(skipped)} inserted=${String(inserted)} errors=${String(errors)} mode=${apply ? "apply" : "dry-run"}`);
      if (errors > 0) process.exitCode = 1;
    }

    // running_schedules DEFERRED (GAP-G): rule jsonb shape unspecified (n=1).
    console.log(`run_schedules: deferred (GAP-G — rule shape unspecified) mode=${apply ? "apply" : "dry-run"}`);

    // ── verify ────────────────────────────────────────────────────────────
    if (apply) {
      const count = await verifyUsersCount(mongo, sql);
      const bcrypt = await verifyBcrypt(mongo, sql);
      const w = await verifyWorkouts(mongo, sql, idBySlug);
      const n = await verifyNutrition(mongo, sql);
      const cr = await verifyCoachRunning(mongo, sql);
      console.log(`VERIFY users count: mongo=${String(count.mongo)} pg=${String(count.pg)} ok=${String(count.ok)}`);
      console.log(`VERIFY bcrypt: sampled=${String(bcrypt.sampled)} intact=${String(bcrypt.intact)} ok=${String(bcrypt.ok)}`);
      console.log(`VERIFY workouts: migratable=${String(w.workouts.mongo)} pg=${String(w.workouts.pg)} ok=${String(w.workouts.ok)}`);
      console.log(`VERIFY sets: expected(resolvable)=${String(w.sets.mongo)} pg=${String(w.sets.pg)} ok=${String(w.sets.ok)}`);
      console.log(`VERIFY streaks: users=${String(w.streaks.mongo)} pg=${String(w.streaks.pg)} ok=${String(w.streaks.ok)}`);
      console.log(`VERIFY meals: migratable=${String(n.meals.mongo)} pg=${String(n.meals.pg)} ok=${String(n.meals.ok)}`);
      console.log(`VERIFY body: migratable=${String(n.body.mongo)} pg=${String(n.body.pg)} ok=${String(n.body.ok)}`);
      console.log(`VERIFY coach_threads: migratable=${String(cr.threads.mongo)} pg=${String(cr.threads.pg)} ok=${String(cr.threads.ok)}`);
      console.log(`VERIFY coach_messages: expected=${String(cr.messages.mongo)} pg=${String(cr.messages.pg)} ok=${String(cr.messages.ok)}`);
      console.log(`VERIFY runs: migratable=${String(cr.runs.mongo)} pg=${String(cr.runs.pg)} ok=${String(cr.runs.ok)}`);
      console.log(`VERIFY saved_routes: migratable=${String(cr.routes.mongo)} pg=${String(cr.routes.pg)} ok=${String(cr.routes.ok)}`);
      if (!count.ok || !bcrypt.ok || !w.ok || !n.ok || !cr.ok) {
        console.error("VERIFY FAILED");
        process.exitCode = 1;
      }
    }
  } finally {
    await mongo.close();
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error("migration error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
