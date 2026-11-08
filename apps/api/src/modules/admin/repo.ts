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
    // Their rows locked, in one order: two presses at once for the same people run one after the other,
    // so each change is read and written down once.
    const found = await tx<{ id: string }[]>`SELECT id FROM users WHERE id = ANY(${ids}::uuid[]) AND status = 'active' ORDER BY id FOR UPDATE`;
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

/** When this sign-in session began (its first refresh token), and whether it is the sign-in an
 *  emailed code made: a code for the account's address used at most two seconds before the session
 *  began, with no other session of the account begun in between. A session made with a password,
 *  Google or any other way, even a moment after somebody's code sign-in, is not it (round one of
 *  14a-i, H1). null for a session that is not there. */
export async function sessionBegan(sql: Sql, userId: string, familyId: string): Promise<{ began: Date; byCode: boolean } | null> {
  const rows = await sql<{ began: Date | null; by_code: boolean | null }[]>`
    WITH fams AS (
      SELECT family_id, min(created_at) AS began FROM refresh_tokens WHERE user_id = ${userId} GROUP BY family_id
    ), mine AS (SELECT began FROM fams WHERE family_id = ${familyId})
    SELECT mine.began,
           EXISTS (
             SELECT 1 FROM sign_in_codes c JOIN users u ON u.email = c.email
             WHERE u.id = ${userId} AND c.purpose = 'sign_in' AND c.used_at IS NOT NULL
               AND c.used_at BETWEEN mine.began - interval '2 seconds' AND mine.began
               AND NOT EXISTS (SELECT 1 FROM fams WHERE fams.family_id <> ${familyId} AND fams.began BETWEEN c.used_at AND mine.began)
           ) AS by_code
    FROM mine`;
  const row = rows[0];
  return row?.began === null || row?.began === undefined ? null : { began: row.began, byCode: row.by_code === true };
}

/** The door opened, or a wrong password at it: written down with when. */
export async function auditDoor(sql: Sql, userId: string, action: "admin.door_opened" | "admin.door_wrong_password"): Promise<void> {
  await sql`INSERT INTO audit_log (actor_user_id, action, target_type, target_id) VALUES (${userId}, ${action}, 'user', ${userId})`;
}

// ── Each person's days (ROADMAP Stage 2 item 14a-ii) ─────────────────────────
// A person's day is their own, in the time zone their phone last sent with its minutes; somebody whose
// phone has sent none is read in the admin's zone. A day's meal scans and route plans are the uses
// their limit counted (metered_uses), its cost what the ledger paid for them (api_cost_events).

export interface PersonDaysRow {
  id: string;
  display_name: string;
  email: string | null;
  zone: string;
  from_phone: boolean;
  today: string;
  first_shown: string;
  day: string | null;
  minutes: number | null;
  meal: number;
  route: number;
  cost: string;
}

/** Up to `count` of one person's days, newest first, from their today (or the day before `before`)
 *  back to their sign-up day. No rows: no such person using the app. */
export async function personDays(
  sql: Sql,
  opts: { userId: string; zone: string; before: string | null; count: number; now: Date },
): Promise<PersonDaysRow[]> {
  return await sql<PersonDaysRow[]>`
    WITH p AS (
      SELECT u.id, u.display_name, u.email::text AS email, u.created_at,
             (SELECT m.zone FROM app_minutes m WHERE m.user_id = u.id ORDER BY m.day DESC LIMIT 1) AS phone_zone,
             (SELECT min(m.day) FROM app_minutes m WHERE m.user_id = u.id) AS first_day
      FROM users u WHERE u.id = ${opts.userId} AND u.status = 'active'
    ), z AS (
      SELECT p.*, COALESCE(p.phone_zone, ${opts.zone}) AS zone FROM p
    ), span AS (
      SELECT z.*, (${opts.now}::timestamptz AT TIME ZONE z.zone)::date AS today,
             (z.created_at AT TIME ZONE z.zone)::date AS first_shown
      FROM z
    ), last AS (
      SELECT span.*, LEAST(span.today, COALESCE(${opts.before}::date - 1, span.today)) AS last_day FROM span
    )
    SELECT last.id, last.display_name, last.email, last.zone, last.phone_zone IS NOT NULL AS from_phone,
           last.today::text AS today, last.first_shown::text AS first_shown, d.day::text AS day,
           CASE WHEN d.day IS NULL OR last.first_day IS NULL OR d.day < last.first_day THEN NULL
                ELSE COALESCE(m.minutes, 0)::int END AS minutes,
           COALESCE(uses.meal, 0)::int AS meal, COALESCE(uses.route, 0)::int AS route,
           COALESCE(cost.micro, 0)::bigint::text AS cost
    FROM last
    LEFT JOIN LATERAL (
      SELECT last.last_day - g AS day FROM generate_series(0, ${opts.count - 1}::int) AS g
      WHERE last.last_day - g >= last.first_shown
    ) d ON true
    LEFT JOIN app_minutes m ON m.user_id = last.id AND m.day = d.day
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE x.feature = 'meal_scan') AS meal, count(*) FILTER (WHERE x.feature = 'route_gen') AS route
      FROM metered_uses x
      WHERE x.user_id = last.id AND x.at >= (d.day::timestamp AT TIME ZONE last.zone) AND x.at < ((d.day + 1)::timestamp AT TIME ZONE last.zone)
    ) uses ON true
    LEFT JOIN LATERAL (
      SELECT sum(e.cost_micro) AS micro FROM api_cost_events e
      WHERE e.user_id = last.id AND e.at >= (d.day::timestamp AT TIME ZONE last.zone) AND e.at < ((d.day + 1)::timestamp AT TIME ZONE last.zone)
    ) cost ON true
    ORDER BY d.day DESC NULLS LAST`;
}

export interface DayRow {
  id: string;
  display_name: string;
  email: string | null;
  minutes: number | null;
  meal: number;
  route: number;
  cost: string;
}

export interface DayList {
  totals: { people: number; minutes: number; meal: number; route: number; cost: string };
  page: DayRow[];
}

/** Everyone who used the app on `day`, each on their own day: time in the app, a counted scan or
 *  route plan, or a cost. The totals are over all of them; the page is `limit` of them from `from`,
 *  most time in the app first. */
export async function dayList(sql: Sql, opts: { day: string; zone: string; from: number; limit: number }): Promise<DayList> {
  // Every zone's day lies within the UTC day before and the day after it (UTC-12 to UTC+14).
  const rows = await sql<{ totals: DayList["totals"]; page: DayRow[] | null }[]>`
    WITH cand AS (
      SELECT user_id FROM app_minutes WHERE day = ${opts.day}::date
      UNION SELECT user_id FROM metered_uses
        WHERE at >= ((${opts.day}::date - 1)::timestamp AT TIME ZONE 'UTC') AND at < ((${opts.day}::date + 2)::timestamp AT TIME ZONE 'UTC')
      UNION SELECT user_id FROM api_cost_events
        WHERE user_id IS NOT NULL
          AND at >= ((${opts.day}::date - 1)::timestamp AT TIME ZONE 'UTC') AND at < ((${opts.day}::date + 2)::timestamp AT TIME ZONE 'UTC')
    ), z AS (
      SELECT u.id, u.display_name, u.email::text AS email,
             COALESCE((SELECT m.zone FROM app_minutes m WHERE m.user_id = u.id ORDER BY m.day DESC LIMIT 1), ${opts.zone}) AS zone,
             EXISTS (SELECT 1 FROM app_minutes m WHERE m.user_id = u.id AND m.day <= ${opts.day}::date) AS recorded
      FROM cand JOIN users u ON u.id = cand.user_id AND u.status = 'active'
    ), n AS (
      SELECT z.id, z.display_name, z.email,
             CASE WHEN z.recorded THEN COALESCE((SELECT m.minutes FROM app_minutes m WHERE m.user_id = z.id AND m.day = ${opts.day}::date), 0)::int END AS minutes,
             uses.meal::int AS meal, uses.route::int AS route, COALESCE(cost.micro, 0)::bigint AS cost
      FROM z
      CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE x.feature = 'meal_scan') AS meal, count(*) FILTER (WHERE x.feature = 'route_gen') AS route
        FROM metered_uses x
        WHERE x.user_id = z.id AND x.at >= (${opts.day}::date::timestamp AT TIME ZONE z.zone) AND x.at < ((${opts.day}::date + 1)::timestamp AT TIME ZONE z.zone)
      ) uses
      CROSS JOIN LATERAL (
        SELECT sum(e.cost_micro) AS micro FROM api_cost_events e
        WHERE e.user_id = z.id AND e.at >= (${opts.day}::date::timestamp AT TIME ZONE z.zone) AND e.at < ((${opts.day}::date + 1)::timestamp AT TIME ZONE z.zone)
      ) cost
    ), used AS (
      SELECT * FROM n WHERE COALESCE(n.minutes, 0) > 0 OR n.meal > 0 OR n.route > 0 OR n.cost > 0
    )
    SELECT
      (SELECT json_build_object('people', count(*)::int, 'minutes', COALESCE(sum(COALESCE(minutes, 0)), 0)::int,
                                'meal', COALESCE(sum(meal), 0)::int, 'route', COALESCE(sum(route), 0)::int,
                                'cost', COALESCE(sum(cost), 0)::bigint::text) FROM used) AS totals,
      (SELECT json_agg(json_build_object('id', p.id, 'display_name', p.display_name, 'email', p.email, 'minutes', p.minutes,
                                         'meal', p.meal, 'route', p.route, 'cost', p.cost::text) ORDER BY p.at)
       FROM (SELECT used.*, row_number() OVER (ORDER BY used.minutes DESC NULLS LAST, used.meal DESC, used.route DESC, used.cost DESC, used.id) AS at
             FROM used ORDER BY at OFFSET ${opts.from} LIMIT ${opts.limit}) p) AS page`;
  const row = rows[0];
  if (row === undefined) throw new Error("the day's totals query returned no row");
  return { totals: row.totals, page: row.page ?? [] };
}
