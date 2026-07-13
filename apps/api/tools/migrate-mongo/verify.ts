// P2.7b — §7 verification gates (:911-914). Row counts must match ±0, and a
// sampled bcrypt spot-check proves hashes migrated intact (byte-identical +
// valid bcrypt format). The full "20 sampled logins verify" needs plaintext
// creds we don't hold; the equality+format check is the automatable proxy.
import type { Sql } from "postgres";
import type { MongoReader } from "./mongo.js";
import { uuidv5 } from "./uuid5.js";

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
