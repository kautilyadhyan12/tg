// The admin page's reads and writes (ROADMAP Stage 2 item 14a-i). Every person on the page is
// read here, and only what running the app needs: no health answer, weight, meal or run.
import type { Sql } from "postgres";
import type { AdminLimitFeature } from "@app/shared";

export interface PersonRow {
  id: string;
  display_name: string;
  email: string | null;
  created_at: Date;
  /** The sign-up instant in whole microseconds, for the next page's cursor. */
  created_us: string;
  last_active_at: Date | null;
  own_interval: "month" | "year" | null;
  gyms: string[];
  meal_scans_a_day: number | null;
  route_plans_a_day: number | null;
}

/** `%`, `_` and the escape itself, taken literally in a search. */
export const likeLiteral = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** One page of the people using the app, newest sign-up first. A deleted account is not one. The
 *  plan columns read the same live rows the plan check does (`entitlements/repo.ts`). */
export async function listPeople(
  sql: Sql,
  opts: { search: string | null; after: { us: string; id: string } | null; limit: number },
): Promise<PersonRow[]> {
  const pattern = opts.search === null ? null : `%${likeLiteral(opts.search)}%`;
  return await sql<PersonRow[]>`
    SELECT u.id, u.display_name, u.email::text AS email, u.created_at, u.last_active_at,
           ((extract(epoch FROM u.created_at) * 1000000)::bigint)::text AS created_us,
           (SELECT p.interval FROM subscriptions s JOIN plans p ON p.id = s.plan_id
             WHERE s.owner_type = 'user' AND s.owner_id = u.id AND s.status IN ('trialing','active','past_due')
             ORDER BY p.rank DESC, p.interval LIMIT 1) AS own_interval,
           COALESCE((SELECT array_agg(DISTINCT g.name ORDER BY g.name)
             FROM gym_members m JOIN gyms g ON g.id = m.gym_id
             WHERE m.user_id = u.id AND m.removed_at IS NULL
               AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.owner_type = 'gym' AND s.owner_id = m.gym_id
                             AND s.status IN ('trialing','active','past_due'))), '{}') AS gyms,
           l.meal_scans_a_day, l.route_plans_a_day
    FROM users u
    LEFT JOIN usage_limits l ON l.user_id = u.id
    WHERE u.status = 'active'
      AND (${pattern}::text IS NULL OR u.display_name ILIKE ${pattern} ESCAPE '\\' OR u.email::text ILIKE ${pattern} ESCAPE '\\')
      AND (${opts.after?.us ?? null}::bigint IS NULL
           OR (u.created_at, u.id) < (timestamptz 'epoch' + ${opts.after?.us ?? null}::bigint * interval '1 microsecond', ${opts.after?.id ?? null}::uuid))
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ${opts.limit}`;
}

export interface SetLimitsResult {
  changed: string[];
  unchanged: number;
  notFound: number;
}

/** Sets one feature's number a day for these people, or with null takes it back, and writes down
 *  each change with who made it. A person already so is left alone and nothing is written for
 *  them, so the same press twice changes nothing the second time. */
export async function setLimits(
  sql: Sql,
  actorUserId: string,
  input: { userIds: readonly string[]; feature: AdminLimitFeature; perDay: number | null },
): Promise<SetLimitsResult> {
  return await sql.begin(async (tx) => {
    const ids = [...input.userIds];
    const found = await tx<{ id: string }[]>`SELECT id FROM users WHERE id = ANY(${ids}::uuid[]) AND status = 'active'`;
    const people = found.map((r) => r.id);
    const held = await tx<{ user_id: string; meal_scans_a_day: number | null; route_plans_a_day: number | null }[]>`
      SELECT user_id, meal_scans_a_day, route_plans_a_day FROM usage_limits
      WHERE user_id = ANY(${people}::uuid[]) FOR UPDATE`;
    const before = new Map(held.map((r) => [r.user_id, input.feature === "meal_scan" ? r.meal_scans_a_day : r.route_plans_a_day]));
    const changes = people.map((id) => ({ id, from: before.get(id) ?? null })).filter((c) => c.from !== input.perDay);
    const changed = changes.map((c) => c.id);
    if (changed.length > 0) {
      if (input.perDay !== null && input.feature === "meal_scan") {
        await tx`
          INSERT INTO usage_limits (user_id, meal_scans_a_day) SELECT id, ${input.perDay} FROM unnest(${changed}::uuid[]) AS id
          ON CONFLICT (user_id) DO UPDATE SET meal_scans_a_day = EXCLUDED.meal_scans_a_day, updated_at = now()`;
      } else if (input.perDay !== null) {
        await tx`
          INSERT INTO usage_limits (user_id, route_plans_a_day) SELECT id, ${input.perDay} FROM unnest(${changed}::uuid[]) AS id
          ON CONFLICT (user_id) DO UPDATE SET route_plans_a_day = EXCLUDED.route_plans_a_day, updated_at = now()`;
      } else if (input.feature === "meal_scan") {
        // A row is never left with neither number: one holding only this one goes.
        await tx`DELETE FROM usage_limits WHERE user_id = ANY(${changed}::uuid[]) AND route_plans_a_day IS NULL`;
        await tx`UPDATE usage_limits SET meal_scans_a_day = NULL, updated_at = now() WHERE user_id = ANY(${changed}::uuid[])`;
      } else {
        await tx`DELETE FROM usage_limits WHERE user_id = ANY(${changed}::uuid[]) AND meal_scans_a_day IS NULL`;
        await tx`UPDATE usage_limits SET route_plans_a_day = NULL, updated_at = now() WHERE user_id = ANY(${changed}::uuid[])`;
      }
      await tx`
        INSERT INTO audit_log (actor_user_id, action, target_type, target_id, meta)
        SELECT ${actorUserId}, 'admin.usage_limit_set', 'user', x.id::text,
               jsonb_build_object('feature', ${input.feature}::text, 'from', x.from_n, 'to', ${input.perDay}::int)
        FROM jsonb_to_recordset(${tx.json(changes.map((c) => ({ id: c.id, from_n: c.from })))}::jsonb) AS x(id uuid, from_n int)`;
    }
    return { changed, unchanged: people.length - changed.length, notFound: ids.length - people.length };
  });
}

/** The admin door's password hash, or null before one is made. */
export async function getDoorPassword(sql: Sql, userId: string): Promise<{ hash: string; algo: "bcrypt" | "argon2id" } | null> {
  const rows = await sql<{ password_hash: string; hash_algo: "bcrypt" | "argon2id" }[]>`
    SELECT password_hash, hash_algo FROM admin_passwords WHERE user_id = ${userId}`;
  const row = rows[0];
  return row === undefined ? null : { hash: row.password_hash, algo: row.hash_algo };
}

/** Makes the first password; false when one is made already (two first presses at once: one wins). */
export async function createDoorPassword(sql: Sql, userId: string, hash: string, algo: "bcrypt" | "argon2id"): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const rows = await tx`
      INSERT INTO admin_passwords (user_id, password_hash, hash_algo) VALUES (${userId}, ${hash}, ${algo})
      ON CONFLICT (user_id) DO NOTHING RETURNING user_id`;
    if (rows.length === 0) return false;
    await tx`INSERT INTO audit_log (actor_user_id, action, target_type, target_id) VALUES (${userId}, 'admin.door_password_made', 'user', ${userId})`;
    return true;
  });
}

/** When this sign-in session began: its first refresh token. null for a session that is not live. */
export async function sessionBegan(sql: Sql, userId: string, familyId: string): Promise<Date | null> {
  const rows = await sql<{ began: Date | null }[]>`
    SELECT min(created_at) AS began FROM refresh_tokens WHERE user_id = ${userId} AND family_id = ${familyId}`;
  return rows[0]?.began ?? null;
}

/** The door opened, or a wrong password at it: written down with when. */
export async function auditDoor(sql: Sql, userId: string, action: "admin.door_opened" | "admin.door_wrong_password"): Promise<void> {
  await sql`INSERT INTO audit_log (actor_user_id, action, target_type, target_id) VALUES (${userId}, ${action}, 'user', ${userId})`;
}
