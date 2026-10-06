// A GYM'S EVENTS, in the database (spec Part 3 §15.4; ROADMAP 19c-i).
// Every read and write names the gym.
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

export interface EventPoster {
  id: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
}

export interface EventRow {
  id: string;
  name: string;
  details: string;
  place: string;
  /** The gym's own clock: a day as `YYYY-MM-DD` and minutes after midnight. */
  startsOn: string;
  startMinute: number;
  endsOn: string;
  endMinute: number;
  startsAt: Date;
  endsAt: Date;
  places: number | null;
  cancelled: boolean;
  poster: EventPoster | null;
}

interface RawEvent {
  id: string;
  name: string;
  details: string;
  place: string;
  starts_on: string;
  start_minute: number;
  ends_on: string;
  end_minute: number;
  starts_at: Date;
  ends_at: Date;
  places: number | null;
  cancelled: boolean;
  poster_id: string | null;
  poster_key: string | null;
  poster_type: string | null;
  poster_bytes: number | null;
  poster_width: number | null;
  poster_height: number | null;
}

function toRow(r: RawEvent): EventRow {
  const whole =
    r.poster_id !== null && r.poster_key !== null && r.poster_type !== null && r.poster_bytes !== null && r.poster_width !== null && r.poster_height !== null;
  return {
    id: r.id,
    name: r.name,
    details: r.details,
    place: r.place,
    startsOn: r.starts_on,
    startMinute: r.start_minute,
    endsOn: r.ends_on,
    endMinute: r.end_minute,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    places: r.places,
    cancelled: r.cancelled,
    poster: whole
      ? { id: r.poster_id ?? "", storageKey: r.poster_key ?? "", contentType: r.poster_type ?? "", byteSize: r.poster_bytes ?? 0, width: r.poster_width ?? 0, height: r.poster_height ?? 0 }
      : null,
  };
}

const columns = (sql: SqlOrTx) => sql`
  e.id, e.name, e.details, e.place,
  e.starts_on::text AS starts_on, e.start_minute, e.ends_on::text AS ends_on, e.end_minute,
  e.starts_at, e.ends_at, e.places, (e.cancelled_at IS NOT NULL) AS cancelled,
  e.poster_id, e.poster_key, e.poster_type, e.poster_bytes, e.poster_width, e.poster_height`;

/** The events that have not ended, soonest first. */
export async function comingEvents(sql: SqlOrTx, gymId: string, now: Date, limit: number): Promise<EventRow[]> {
  const rows = await sql<RawEvent[]>`
    SELECT ${columns(sql)} FROM gym_events e
    WHERE e.gym_id = ${gymId} AND e.ends_at > ${now}
    ORDER BY e.starts_at, e.id
    LIMIT ${limit}`;
  return rows.map(toRow);
}

/** The events that have ended, newest first. */
export async function pastEvents(sql: SqlOrTx, gymId: string, now: Date, limit: number): Promise<EventRow[]> {
  const rows = await sql<RawEvent[]>`
    SELECT ${columns(sql)} FROM gym_events e
    WHERE e.gym_id = ${gymId} AND e.ends_at <= ${now}
    ORDER BY e.ends_at DESC, e.id
    LIMIT ${limit}`;
  return rows.map(toRow);
}

export async function countPast(sql: SqlOrTx, gymId: string, now: Date): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_events WHERE gym_id = ${gymId} AND ends_at <= ${now}`;
  return rows[0]?.n ?? 0;
}

export async function countComing(sql: SqlOrTx, gymId: string, now: Date): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_events WHERE gym_id = ${gymId} AND ends_at > ${now}`;
  return rows[0]?.n ?? 0;
}

export async function eventById(sql: SqlOrTx, gymId: string, eventId: string): Promise<EventRow | null> {
  const rows = await sql<RawEvent[]>`SELECT ${columns(sql)} FROM gym_events e WHERE e.gym_id = ${gymId} AND e.id = ${eventId}`;
  const r = rows[0];
  return r === undefined ? null : toRow(r);
}

/** The event, held until the step ends: two changes to it run one after the other. */
export async function lockEvent(tx: TransactionSql, gymId: string, eventId: string): Promise<EventRow | null> {
  const rows = await tx<RawEvent[]>`SELECT ${columns(tx)} FROM gym_events e WHERE e.gym_id = ${gymId} AND e.id = ${eventId} FOR UPDATE`;
  const r = rows[0];
  return r === undefined ? null : toRow(r);
}

export async function eventIdByKey(sql: SqlOrTx, gymId: string, eventKey: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM gym_events WHERE gym_id = ${gymId} AND event_key = ${eventKey}`;
  return rows[0]?.id ?? null;
}

export interface EventTimes {
  startsOn: string;
  startMinute: number;
  endsOn: string;
  endMinute: number;
}

/** The instants an event's days and times are on the gym's own clock, and today's date on
 *  it. Postgres's zone database answers, per date, so a summer-time change is its to get
 *  right; a time the clocks skip reads as the hour after it. Null for no such gym. */
export async function instantsOf(sql: SqlOrTx, gymId: string, times: EventTimes, now: Date): Promise<{ startsAt: Date; endsAt: Date; today: string } | null> {
  const rows = await sql<{ starts_at: Date; ends_at: Date; today: string }[]>`
    SELECT
      ((${times.startsOn}::date + make_interval(mins => ${times.startMinute}::int)) AT TIME ZONE g.timezone) AS starts_at,
      ((${times.endsOn}::date + make_interval(mins => ${times.endMinute}::int)) AT TIME ZONE g.timezone) AS ends_at,
      ((${now}::timestamptz AT TIME ZONE g.timezone)::date)::text AS today
    FROM gyms g WHERE g.id = ${gymId}`;
  const r = rows[0];
  return r === undefined ? null : { startsAt: r.starts_at, endsAt: r.ends_at, today: r.today };
}

/** Today's date on the gym's own clock. */
export async function gymToday(sql: SqlOrTx, gymId: string, now: Date): Promise<string | null> {
  const rows = await sql<{ today: string }[]>`
    SELECT ((${now}::timestamptz AT TIME ZONE g.timezone)::date)::text AS today FROM gyms g WHERE g.id = ${gymId}`;
  return rows[0]?.today ?? null;
}

export interface EventWords {
  name: string;
  details: string;
  place: string;
  places: number | null;
}

/** Keeps a new event. False when the gym already keeps one under this key. */
export async function insertEvent(
  tx: TransactionSql,
  gymId: string,
  event: { id: string; eventKey: string } & EventWords & EventTimes & { startsAt: Date; endsAt: Date },
  poster: EventPoster | null,
  byUserId: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_events (
      id, gym_id, event_key, name, details, place,
      starts_on, start_minute, ends_on, end_minute, starts_at, ends_at, places,
      poster_id, poster_key, poster_type, poster_bytes, poster_width, poster_height,
      created_by_user_id, created_at, updated_at)
    VALUES (
      ${event.id}, ${gymId}, ${event.eventKey}, ${event.name}, ${event.details}, ${event.place},
      ${event.startsOn}::date, ${event.startMinute}, ${event.endsOn}::date, ${event.endMinute}, ${event.startsAt}, ${event.endsAt}, ${event.places},
      ${poster?.id ?? null}, ${poster?.storageKey ?? null}, ${poster?.contentType ?? null}, ${poster?.byteSize ?? null}, ${poster?.width ?? null}, ${poster?.height ?? null},
      ${byUserId}, ${at}, ${at})
    ON CONFLICT (gym_id, event_key) DO NOTHING
    RETURNING id`;
  return rows.length === 1;
}

/** Changes an event's words and times. `poster`: undefined leaves it, null takes it off. */
export async function updateEvent(
  tx: TransactionSql,
  gymId: string,
  eventId: string,
  event: EventWords & EventTimes & { startsAt: Date; endsAt: Date },
  poster: EventPoster | null | undefined,
  at: Date,
): Promise<void> {
  await tx`
    UPDATE gym_events SET
      name = ${event.name}, details = ${event.details}, place = ${event.place}, places = ${event.places},
      starts_on = ${event.startsOn}::date, start_minute = ${event.startMinute},
      ends_on = ${event.endsOn}::date, end_minute = ${event.endMinute},
      starts_at = ${event.startsAt}, ends_at = ${event.endsAt}, updated_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${eventId}`;
  if (poster === undefined) return;
  await tx`
    UPDATE gym_events SET
      poster_id = ${poster?.id ?? null}, poster_key = ${poster?.storageKey ?? null}, poster_type = ${poster?.contentType ?? null},
      poster_bytes = ${poster?.byteSize ?? null}, poster_width = ${poster?.width ?? null}, poster_height = ${poster?.height ?? null}
    WHERE gym_id = ${gymId} AND id = ${eventId}`;
}

export async function setCancelled(tx: TransactionSql, gymId: string, eventId: string, cancelledAt: Date | null, at: Date): Promise<void> {
  await tx`UPDATE gym_events SET cancelled_at = ${cancelledAt}, updated_at = ${at} WHERE gym_id = ${gymId} AND id = ${eventId}`;
}
