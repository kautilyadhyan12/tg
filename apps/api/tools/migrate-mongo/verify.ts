// P2.7b — §7 verification gates (:911-914). Row counts must match ±0, and a
// sampled bcrypt spot-check proves hashes migrated intact (byte-identical +
// valid bcrypt format). The full "20 sampled logins verify" needs plaintext
// creds we don't hold; the equality+format check is the automatable proxy.
import type { Sql } from "postgres";
import type { MongoReader } from "./mongo.js";
import { uuidv5 } from "./uuid5.js";
import { transformWorkout } from "./collections/workouts.js";
import { transformMeal } from "./collections/meals.js";
import { transformBody } from "./collections/body.js";
import { transformCoach } from "./collections/coach.js";
import { transformRun, transformRoute } from "./collections/running.js";

export interface CountGate {
  collection: string;
  mongo: number;
  pg: number;
  ok: boolean;
}

/** users count gate: mongo users == pg users carrying a legacy_mongo_id. */
export async function verifyUsersCount(mongo: MongoReader, sql: Sql): Promise<CountGate> {
  const mongoCount = await mongo.count("users");
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE legacy_mongo_id IS NOT NULL`;
  const pg = rows[0]?.n ?? 0;
  return { collection: "users", mongo: mongoCount, pg, ok: mongoCount === pg };
}

export interface HashSpotCheck {
  sampled: number;
  intact: number;
  ok: boolean;
}

/** Sample legacy users with a password; assert the migrated hash is byte-equal
 *  to the source and still a valid bcrypt string ($2a/$2b/$2y). */
export async function verifyBcrypt(mongo: MongoReader, sql: Sql, sampleSize = 20): Promise<HashSpotCheck> {
  const samples: { id: string; password: string }[] = [];
  await mongo.each("users", (doc) => {
    if (samples.length >= sampleSize) return;
    const pw = doc["password"];
    if (typeof pw === "string" && pw.length > 0 && typeof doc["_id"] === "string") {
      samples.push({ id: uuidv5(doc["_id"]), password: pw });
    }
  });
  let intact = 0;
  for (const s of samples) {
    const rows = await sql<{ password_hash: string | null }[]>`SELECT password_hash FROM users WHERE id = ${s.id}`;
    const stored = rows[0]?.password_hash ?? "";
    if (stored === s.password && /^\$2[aby]\$/.test(stored)) intact += 1;
  }
  // A set with no password users (all-OAuth) is vacuously OK — the gate must
  // not fail for having nothing to sample (T3 finding 5).
  return { sampled: samples.length, intact, ok: intact === samples.length };
}

// ── P2.7c workouts gates ────────────────────────────────────────────────────

export interface WorkoutsVerification {
  workouts: CountGate; // mongo = MIGRATABLE sessions (Mongo − skipped); pg = matched by UUIDv5 id
  sets: CountGate; // mongo = Σ prescribed sets over RESOLVABLE names; pg = rows on migrated workouts
  streaks: CountGate; // mongo = migrated users with ≥1 workout; pg = streaks rows for them
  ok: boolean;
}

/** Streams Mongo ONCE, re-derives expected via the tested pure transform
 *  (verifies the DB WRITE path, not just the transform), and compares to PG.
 *  The workouts gate is honest w.r.t. fail-soft skipping: a session the
 *  transform rejects (null) is excluded from `mongo`, so `pg === mongo` holds
 *  when nothing skipped, and any insert error surfaces as `pg < mongo`
 *  (Kd correction). `idBySlug` is the same map the run used. */
export async function verifyWorkouts(
  mongo: MongoReader,
  sql: Sql,
  idBySlug: ReadonlyMap<string, string>,
): Promise<WorkoutsVerification> {
  const workoutIds: string[] = [];
  const userIds = new Set<string>();
  let expectedSets = 0;
  await mongo.each("workout_sessions", (doc) => {
    const row = transformWorkout(doc, idBySlug);
    if (row === null) return;
    workoutIds.push(row.id);
    userIds.add(row.userId);
    expectedSets += row.setsCount;
  });
  const uids = [...userIds];
  const [w] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workouts WHERE id = ANY(${workoutIds})`;
  const [s] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM workout_sets WHERE workout_id = ANY(${workoutIds})`;
  const [st] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM streaks WHERE user_id = ANY(${uids})`;
  const workouts: CountGate = { collection: "workouts", mongo: workoutIds.length, pg: w?.n ?? 0, ok: (w?.n ?? 0) === workoutIds.length };
  const sets: CountGate = { collection: "workout_sets", mongo: expectedSets, pg: s?.n ?? 0, ok: (s?.n ?? 0) === expectedSets };
  const streaks: CountGate = { collection: "streaks", mongo: uids.length, pg: st?.n ?? 0, ok: (st?.n ?? 0) === uids.length };
  return { workouts, sets, streaks, ok: workouts.ok && sets.ok && streaks.ok };
}

// ── P2.7d meals + body gates ────────────────────────────────────────────────

export interface NutritionVerification {
  meals: CountGate; // mongo = MIGRATABLE meals (transform-accepted); pg = rows carrying a legacy_mongo_id
  body: CountGate;
  ok: boolean;
}

/** Both target tables carry `legacy_mongo_id`, so migrated rows are isolable
 *  directly (nutrition-module inserts leave it NULL). Expected = transform-
 *  accepted count (honest w.r.t. fail-soft skipping); insert errors surface as
 *  pg < mongo. */
export async function verifyNutrition(mongo: MongoReader, sql: Sql): Promise<NutritionVerification> {
  let expectedMeals = 0;
  await mongo.each("meal_logs", (doc) => {
    if (transformMeal(doc) !== null) expectedMeals += 1;
  });
  let expectedBody = 0;
  await mongo.each("body_measurements", (doc) => {
    if (transformBody(doc) !== null) expectedBody += 1;
  });
  const [m] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM meal_logs WHERE legacy_mongo_id IS NOT NULL`;
  const [b] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM body_measurements WHERE legacy_mongo_id IS NOT NULL`;
  const meals: CountGate = { collection: "meal_logs", mongo: expectedMeals, pg: m?.n ?? 0, ok: (m?.n ?? 0) === expectedMeals };
  const body: CountGate = { collection: "body_measurements", mongo: expectedBody, pg: b?.n ?? 0, ok: (b?.n ?? 0) === expectedBody };
  return { meals, body, ok: meals.ok && body.ok };
}

// ── P2.7e coach + running gates ─────────────────────────────────────────────

export interface CoachRunningVerification {
  threads: CountGate;
  messages: CountGate;
  runs: CountGate;
  routes: CountGate;
  ok: boolean;
}

/** Threads/runs/routes carry legacy_mongo_id; coach_messages does not, so its
 *  migrated rows are counted via membership in migrated threads. Expected is
 *  re-derived through the tested transforms (verifies the write path). */
export async function verifyCoachRunning(mongo: MongoReader, sql: Sql): Promise<CoachRunningVerification> {
  let expectedThreads = 0;
  let expectedMessages = 0;
  await mongo.each("coach_conversations", (doc) => {
    const d = transformCoach(doc);
    if (d === null) return;
    expectedThreads += 1;
    expectedMessages += d.messages.length;
  });
  let expectedRuns = 0;
  await mongo.each("running_sessions", (doc) => {
    if (transformRun(doc) !== null) expectedRuns += 1;
  });
  let expectedRoutes = 0;
  await mongo.each("running_routes", (doc) => {
    if (transformRoute(doc) !== null) expectedRoutes += 1;
  });

  const [t] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM coach_threads WHERE legacy_mongo_id IS NOT NULL`;
  const [msg] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM coach_messages
    WHERE thread_id IN (SELECT id FROM coach_threads WHERE legacy_mongo_id IS NOT NULL)`;
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM runs WHERE legacy_mongo_id IS NOT NULL`;
  const [sr] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM saved_routes WHERE legacy_mongo_id IS NOT NULL`;

  const threads: CountGate = { collection: "coach_threads", mongo: expectedThreads, pg: t?.n ?? 0, ok: (t?.n ?? 0) === expectedThreads };
  const messages: CountGate = { collection: "coach_messages", mongo: expectedMessages, pg: msg?.n ?? 0, ok: (msg?.n ?? 0) === expectedMessages };
  const runs: CountGate = { collection: "runs", mongo: expectedRuns, pg: r?.n ?? 0, ok: (r?.n ?? 0) === expectedRuns };
  const routes: CountGate = { collection: "saved_routes", mongo: expectedRoutes, pg: sr?.n ?? 0, ok: (sr?.n ?? 0) === expectedRoutes };
  return { threads, messages, runs, routes, ok: threads.ok && messages.ok && runs.ok && routes.ok };
}
