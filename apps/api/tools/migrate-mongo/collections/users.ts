// P2.7b — users stage. Transforms the merged legacy `users` doc (auth + ml +
// onboarding in one collection — DATA-VERIFIED, INVENTORY.md §1) into a `users`
// row. Credentials preserved (bcrypt), profile mapped, onboarding fields dropped
// (no target columns). Gamification (streaks/user_achievements) is NOT written
// here — §7:882-884 recomputes it from migrated workout history, a later stage.
import { z } from "zod";
import type { Sql } from "postgres";
import { uuidv5 } from "../uuid5.js";
import { weightToKg } from "../weight.js";

// Boundary parse (R2.3): only the fields the transform reads; `_id` is the
// reader-normalized hex string. Unknown keys pass through and are ignored.
const legacyUserSchema = z
  .object({
    _id: z.string().min(1),
    // Lenient: a cosmetically-malformed email must NOT discard the whole user
    // (and its bcrypt credentials) — the email is stored as-is / nulled, never
    // fatal to the row (T3 finding 4). citext has no format CHECK.
    email: z.string().nullish(),
    password: z.string().nullish(),
    fullName: z.string().nullish(),
    weight: z.unknown().optional(),
    lastLogin: z.union([z.date(), z.string()]).nullish(),
  })
  .passthrough();

/** Legacy timestamp → Date, or null when unparseable (an Invalid Date would
 *  abort the whole run at insert — T3 finding 3). */
function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface UserRow {
  id: string;
  email: string | null;
  passwordHash: string | null;
  hashAlgo: "bcrypt" | null;
  displayName: string;
  weightKg: number | null;
  lastActiveAt: Date | null;
  legacyMongoId: string;
}

function fallbackDisplayName(fullName: string | null | undefined, email: string | null): string {
  const trimmed = fullName?.trim();
  if (trimmed !== undefined && trimmed !== "") return trimmed;
  const local = email === null ? undefined : email.split("@")[0];
  if (local !== undefined && local !== "") return local;
  return "Member"; // display_name is NOT NULL; never fabricate identity beyond this
}

/** Pure transform — null when the doc is too malformed to migrate (caller logs). */
export function transformUser(doc: unknown): UserRow | null {
  const parsed = legacyUserSchema.safeParse(doc);
  if (!parsed.success) return null;
  const u = parsed.data;
  const email = typeof u.email === "string" && u.email.trim() !== "" ? u.email : null;
  const passwordHash = u.password ?? null;
  return {
    id: uuidv5(u._id),
    email,
    passwordHash,
    hashAlgo: passwordHash === null ? null : "bcrypt", // legacy hashes are bcrypt (DECISIONS)
    displayName: fallbackDisplayName(u.fullName, email),
    weightKg: weightToKg(u.weight),
    lastActiveAt: toDate(u.lastLogin),
    legacyMongoId: u._id,
  };
}

/** Idempotent insert. ON CONFLICT is targeted on (id) so a RE-RUN is the
 *  intended no-op (id = UUIDv5(_id) is stable). A genuine email collision (a
 *  different _id, same email) is NOT swallowed here — it raises 23505, which
 *  run.ts logs per-row as a real reconciliation event, never a silent drop
 *  (T3 finding 2). Returns rows inserted (0 on a re-run). */
export async function insertUser(sql: Sql, r: UserRow): Promise<number> {
  const res = await sql`
    INSERT INTO users (id, email, password_hash, hash_algo, display_name, weight_kg, last_active_at, legacy_mongo_id)
    VALUES (${r.id}, ${r.email}, ${r.passwordHash}, ${r.hashAlgo}, ${r.displayName},
            ${r.weightKg}, ${r.lastActiveAt}, ${r.legacyMongoId})
    ON CONFLICT (id) DO NOTHING`;
  return res.count;
}
