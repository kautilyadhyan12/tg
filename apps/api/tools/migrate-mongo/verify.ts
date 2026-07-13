// P2.7b — §7 verification gates (:911-914). Row counts must match ±0, and a
// sampled bcrypt spot-check proves hashes migrated intact (byte-identical +
// valid bcrypt format). The full "20 sampled logins verify" needs plaintext
// creds we don't hold; the equality+format check is the automatable proxy.
import type { Sql } from "postgres";
import type { MongoReader } from "./mongo.js";
import { uuidv5 } from "./uuid5.js";
import { transformWorkout } from "./collections/workouts.js";

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
