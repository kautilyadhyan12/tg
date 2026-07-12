// P2.2 — users repo: the ONLY file that touches the users profile columns,
// body_measurements (GAP-2 weight history), and — until their owning modules
// exist (gyms: P3.10; notifications: P5) — the gym_members close and
// push_tokens delete that Part 4 §5.2 Day 0 requires. Auth-owned tables
// (refresh_tokens, one_time_tokens) are NEVER touched here — the users
// service goes through auth's service interface (R7.1).
// Every query is keyed by the owning userId (R3.2).
import type { Sql } from "postgres";
import type { UpdateProfileRequest } from "./schemas.js";

export interface ProfileRow {
  id: string;
  email: string | null;
  displayName: string;
  locale: string;
  units: string;
  timezone: string | null;
  weightKg: number | null;
  leaderboardOptOut: boolean;
  createdAt: Date;
}

interface ProfileDbRow {
  id: string;
  email: string | null;
  display_name: string;
  locale: string;
  units: string;
  timezone: string | null;
  weight_kg: string | null; // numeric arrives as string
  leaderboard_opt_out: boolean;
  created_at: Date;
}

const toProfile = (r: ProfileDbRow): ProfileRow => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  locale: r.locale,
  units: r.units,
  timezone: r.timezone,
  weightKg: r.weight_kg === null ? null : Number(r.weight_kg),
  leaderboardOptOut: r.leaderboard_opt_out,
  createdAt: r.created_at,
});

export async function getProfile(sql: Sql, userId: string): Promise<ProfileRow | null> {
  const rows = await sql<ProfileDbRow[]>`
    SELECT id, email, display_name, locale, units, timezone,
           weight_kg, leaderboard_opt_out, created_at
    FROM users WHERE id = ${userId} AND status = 'active'`;
  return rows[0] === undefined ? null : toProfile(rows[0]);
}

/** Applies the PATCH inside one transaction; when weightKg changes to a new
 *  non-null value, a body_measurements row is appended (GAP-2 ruling — Part 4
 *  §3.1: "history in body_measurements"). Returns null if the user is not
 *  active (deleted mid-flight). Column names come from a fixed allowlist
 *  below, never from input (R3.8). */
export async function updateProfile(
  sql: Sql,
  userId: string,
  patch: UpdateProfileRequest,
): Promise<ProfileRow | null> {
  return await sql.begin(async (tx) => {
    const prevRows = await tx<{ weight_kg: string | null }[]>`
      SELECT weight_kg FROM users
      WHERE id = ${userId} AND status = 'active' FOR UPDATE`;
    const prev = prevRows[0];
    if (prev === undefined) return null;

    // Fixed field→column map; only keys PRESENT in the parsed patch are set.
    const cols: Record<string, string | number | boolean | null> = {};
    if (patch.displayName !== undefined) cols["display_name"] = patch.displayName;
    if (patch.locale !== undefined) cols["locale"] = patch.locale;
    if (patch.units !== undefined) cols["units"] = patch.units;
    if (patch.timezone !== undefined) cols["timezone"] = patch.timezone;
    if (patch.weightKg !== undefined) cols["weight_kg"] = patch.weightKg;
    if (patch.leaderboardOptOut !== undefined) cols["leaderboard_opt_out"] = patch.leaderboardOptOut;

    const rows = await tx<ProfileDbRow[]>`
      UPDATE users SET ${tx(cols)}
      WHERE id = ${userId} AND status = 'active'
      RETURNING id, email, display_name, locale, units, timezone,
                weight_kg, leaderboard_opt_out, created_at`;
    const updated = rows[0];
    if (updated === undefined) return null;

    const prevWeight = prev.weight_kg === null ? null : Number(prev.weight_kg);
    if (
      patch.weightKg !== undefined &&
      patch.weightKg !== null &&
      patch.weightKg !== prevWeight
    ) {
      await tx`
        INSERT INTO body_measurements (user_id, measured_at, weight_kg, source)
        VALUES (${userId}, now(), ${patch.weightKg}, 'manual')`;
    }
    return toProfile(updated);
  });
}

export interface UserSyncContext {
  weightKg: number | null;
  timezone: string | null;
  displayName: string;
  units: string;
}

/** Weight (2B §2.2 calorie lever) + timezone (Part 7 §3.1 day-bucketing) for
 *  the workouts/gamification sync path; displayName/units feed the coach
 *  prompt (P2.5b GAP-1 — only stored fields). No status filter: callers are
 *  behind authenticate (active-only), and reads must not flap mid-request. */
export async function getSyncContext(sql: Sql, userId: string): Promise<UserSyncContext> {
  const rows = await sql<
    { weight_kg: string | null; timezone: string | null; display_name: string; units: string }[]
  >`
    SELECT weight_kg, timezone, display_name, units FROM users WHERE id = ${userId}`;
  const r = rows[0];
  return {
    weightKg: r?.weight_kg == null ? null : Number(r.weight_kg),
    timezone: r?.timezone ?? null,
    displayName: r?.display_name ?? "",
    units: r?.units ?? "metric",
  };
}

export interface DeletedUserRow {
  email: string | null;
  displayName: string;
}

/** Part 4 §5.2 Day 0, users-owned part, one transaction: soft-delete the row,
 *  close memberships, delete push tokens. Refresh-token revocation is the
 *  auth module's (service call, in users/service.ts). Returns null when the
 *  user was not active (already deleted → idempotent no-op). */
export async function softDeleteUser(sql: Sql, userId: string): Promise<DeletedUserRow | null> {
  return await sql.begin(async (tx) => {
    const rows = await tx<{ email: string | null; display_name: string }[]>`
      UPDATE users SET status = 'deleted', deleted_at = now()
      WHERE id = ${userId} AND status = 'active'
      RETURNING email, display_name`;
    const row = rows[0];
    if (row === undefined) return null;
    await tx`
      UPDATE gym_members SET removed_at = now()
      WHERE user_id = ${userId} AND removed_at IS NULL`;
    await tx`DELETE FROM push_tokens WHERE user_id = ${userId}`;
    return { email: row.email, displayName: row.display_name };
  });
}

/** Undo inside the 14-day window (Part 4 §5.2): only a soft-deleted row whose
 *  deleted_at is younger than 14 days flips back. The window is enforced HERE
 *  as well as by the token TTL — belt and braces. Gym memberships closed at
 *  Day 0 deliberately STAY closed (rejoin by code) — auto-reopen could exceed
 *  seat caps (DECISIONS 2026-07-11, T3 finding 4; revisit at P3.10). */
export async function restoreUser(sql: Sql, userId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE users SET status = 'active', deleted_at = NULL
    WHERE id = ${userId} AND status = 'deleted'
      AND deleted_at > now() - interval '14 days'
    RETURNING id`;
  return rows.length > 0;
}
