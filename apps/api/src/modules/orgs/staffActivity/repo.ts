// Staff activity's reads (ROADMAP 4d). Every read names the gym in its WHERE: a note, a
// name and a worker are only ever this gym's.
import type { Sql } from "postgres";

export interface NoteRow {
  id: string;
  /** The moment to the microsecond, as the next page's cursor needs it. */
  at: string;
  day: string;
  minute: number;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
}

export interface PageAsk {
  gymId: string;
  timezone: string;
  actions: readonly string[];
  worker: string | null;
  from: string | null;
  to: string | null;
  after: { at: string; id: string } | null;
  limit: number;
}

/** One page of what staff did, newest first. `org.waiver_signed` is staff's only when it
 *  was signed at the desk; otherwise it is the member's own. */
export async function readPage(sql: Sql, ask: PageAsk): Promise<NoteRow[]> {
  const rows = await sql<
    { id: string; at: string; day: string; minute: number; actor_id: string; actor_name: string | null; action: string; target_type: string | null; target_id: string | null; meta: Record<string, unknown> | null }[]
  >`
    SELECT a.id::text AS id, to_char(a.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
           to_char(a.at AT TIME ZONE ${ask.timezone}, 'YYYY-MM-DD') AS day,
           (extract(hour FROM a.at AT TIME ZONE ${ask.timezone}) * 60 + extract(minute FROM a.at AT TIME ZONE ${ask.timezone}))::int AS minute,
           a.actor_user_id::text AS actor_id, u.display_name AS actor_name,
           a.action, a.target_type, a.target_id, a.meta
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.gym_id = ${ask.gymId}
      AND a.actor_user_id IS NOT NULL
      AND a.action = ANY(${ask.actions as string[]}::text[])
      AND (a.action <> 'org.waiver_signed' OR a.meta->>'via' = 'desk')
      ${ask.worker === null ? sql`` : sql`AND a.actor_user_id = ${ask.worker}`}
      ${ask.from === null ? sql`` : sql`AND a.at >= (${ask.from}::date)::timestamp AT TIME ZONE ${ask.timezone}`}
      ${ask.to === null ? sql`` : sql`AND a.at < ((${ask.to}::date) + 1)::timestamp AT TIME ZONE ${ask.timezone}`}
      ${
        // Sent as text: the driver would turn a timestamptz parameter into a JS Date and
        // drop the microseconds, skipping the rest of a bulk action's notes.
        ask.after === null ? sql`` : sql`AND (a.at, a.id) < (${ask.after.at}::text::timestamptz, ${ask.after.id}::text::bigint)`
      }
    -- The index's own order (audit_log_gym_at_idx), so a page reads 51 notes, not the gym's all.
    ORDER BY a.at DESC NULLS LAST, a.id DESC
    LIMIT ${ask.limit}`;
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    day: r.day,
    minute: r.minute,
    actorId: r.actor_id,
    actorName: r.actor_name ?? "",
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    meta: r.meta ?? {},
  }));
}

/** The kinds of thing a note can be about, each looked up at this gym. */
export type SubjectKind =
  | "entry"
  | "member"
  | "user"
  | "lead"
  | "invite"
  | "challenge"
  | "event"
  | "tag"
  | "code"
  | "device"
  | "schedule"
  | "session"
  | "booking"
  | "pt"
  | "visit"
  | "application";

export const SUBJECT_KINDS: readonly SubjectKind[] = [
  "entry",
  "member",
  "user",
  "lead",
  "invite",
  "challenge",
  "event",
  "tag",
  "code",
  "device",
  "schedule",
  "session",
  "booking",
  "pt",
  "visit",
  "application",
];

/** The names of everything one page is about, in one read: "<kind>:<id>" → name. A thing
 *  that is gone, or is another gym's, has no name. `users` are not a gym's own rows, so a
 *  person is named only as this gym's staff or former staff, or through its members,
 *  visits or bookings. */
export async function readNames(sql: Sql, gymId: string, ids: ReadonlyMap<SubjectKind, readonly string[]>, formerStaff: readonly string[]): Promise<Map<string, string>> {
  const of = (kind: SubjectKind): string[] => [...(ids.get(kind) ?? [])];
  const rows = await sql<{ key: string; name: string | null }[]>`
    SELECT 'entry:' || e.id AS key, e.full_name AS name FROM gym_member_list_entries e
      WHERE e.gym_id = ${gymId} AND e.id = ANY(${of("entry")}::uuid[])
    UNION ALL
    SELECT 'member:' || m.id, u.display_name FROM gym_members m JOIN users u ON u.id = m.user_id
      WHERE m.gym_id = ${gymId} AND m.id = ANY(${of("member")}::uuid[])
    UNION ALL
    SELECT 'user:' || u.id, u.display_name FROM users u
      WHERE u.id = ANY(${of("user")}::uuid[])
        AND (EXISTS (SELECT 1 FROM gym_staff s WHERE s.gym_id = ${gymId} AND s.user_id = u.id)
          OR EXISTS (SELECT 1 FROM gym_members m WHERE m.gym_id = ${gymId} AND m.user_id = u.id)
          OR u.id = ANY(${formerStaff as string[]}::uuid[]))
    UNION ALL
    SELECT 'lead:' || l.id, l.full_name FROM gym_leads l
      WHERE l.gym_id = ${gymId} AND l.id = ANY(${of("lead")}::uuid[])
    UNION ALL
    SELECT 'invite:' || i.id, i.email::text FROM gym_staff_invites i
      WHERE i.gym_id = ${gymId} AND i.id = ANY(${of("invite")}::uuid[])
    UNION ALL
    SELECT 'challenge:' || c.id, c.name FROM gym_challenges c
      WHERE c.gym_id = ${gymId} AND c.id = ANY(${of("challenge")}::uuid[])
    UNION ALL
    SELECT 'event:' || v.id, v.name FROM gym_events v
      WHERE v.gym_id = ${gymId} AND v.id = ANY(${of("event")}::uuid[])
    UNION ALL
    SELECT 'tag:' || t.id, t.name FROM gym_member_tags t
      WHERE t.gym_id = ${gymId} AND t.id = ANY(${of("tag")}::uuid[])
    UNION ALL
    SELECT 'code:' || c.id, COALESCE(NULLIF(c.label, ''), c.code) FROM gym_codes c
      WHERE c.gym_id = ${gymId} AND c.id = ANY(${of("code")}::uuid[])
    UNION ALL
    SELECT 'device:' || d.id, d.name FROM gym_checkin_devices d
      WHERE d.gym_id = ${gymId} AND d.id = ANY(${of("device")}::uuid[])
    UNION ALL
    SELECT 'schedule:' || s.id, t.name FROM gym_class_schedules s JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
      WHERE s.gym_id = ${gymId} AND s.id = ANY(${of("schedule")}::uuid[])
    UNION ALL
    SELECT 'session:' || s.id, t.name FROM gym_class_sessions s JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
      WHERE s.gym_id = ${gymId} AND s.id = ANY(${of("session")}::uuid[])
    UNION ALL
    SELECT 'booking:' || b.id, COALESCE(NULLIF(e.full_name, ''), u.display_name) FROM gym_class_bookings b
      LEFT JOIN gym_member_list_entries e ON e.id = b.entry_id AND e.gym_id = b.gym_id
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.gym_id = ${gymId} AND b.id = ANY(${of("booking")}::uuid[])
    UNION ALL
    SELECT 'pt:' || p.id, e.full_name FROM gym_pt_appointments p
      JOIN gym_member_list_entries e ON e.id = p.entry_id AND e.gym_id = p.gym_id
      WHERE p.gym_id = ${gymId} AND p.id = ANY(${of("pt")}::uuid[])
    UNION ALL
    SELECT 'visit:' || v.id, COALESCE(NULLIF(e.full_name, ''), u.display_name)
      FROM (SELECT id, gym_id, entry_id, user_id FROM gym_attendance
            UNION ALL
            -- A visit staff removed is kept here, with its person (checkin/repo.ts removeVisit).
            SELECT id, gym_id, entry_id, user_id FROM gym_attendance_removed) v
      LEFT JOIN gym_member_list_entries e ON e.id = v.entry_id AND e.gym_id = v.gym_id
      LEFT JOIN users u ON u.id = v.user_id
      WHERE v.gym_id = ${gymId} AND v.id = ANY(${of("visit")}::uuid[])
    UNION ALL
    SELECT 'application:' || a.id, u.display_name FROM gym_join_applications a JOIN users u ON u.id = a.user_id
      WHERE a.gym_id = ${gymId} AND a.id = ANY(${of("application")}::uuid[])`;
  const names = new Map<string, string>();
  for (const r of rows) if (r.name !== null && r.name !== "") names.set(r.key, r.name);
  return names;
}

export interface WorkerRow {
  userId: string;
  name: string;
  current: boolean;
}

/** Everybody the worker filter offers: this gym's staff today, owner first, then anybody
 *  this gym has removed from its staff, by name. */
export async function readWorkers(sql: Sql, gymId: string): Promise<WorkerRow[]> {
  const rows = await sql<{ user_id: string; name: string; current: boolean }[]>`
    WITH former AS (
      SELECT DISTINCT a.target_id AS user_id FROM audit_log a
      WHERE a.gym_id = ${gymId} AND a.action = 'org.staff_removed'
        AND a.target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    SELECT s.user_id::text AS user_id, u.display_name AS name, true AS current, (s.role = 'owner') AS owner
      FROM gym_staff s JOIN users u ON u.id = s.user_id
      WHERE s.gym_id = ${gymId}
    UNION ALL
    SELECT u.id::text, u.display_name, false, false
      FROM former f JOIN users u ON u.id = f.user_id::uuid
      WHERE NOT EXISTS (SELECT 1 FROM gym_staff s WHERE s.gym_id = ${gymId} AND s.user_id = u.id)
    ORDER BY current DESC, owner DESC, name ASC, user_id ASC`;
  return rows.map((r) => ({ userId: r.user_id, name: r.name, current: r.current }));
}
