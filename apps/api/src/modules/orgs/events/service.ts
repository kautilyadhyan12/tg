// A GYM'S EVENTS (spec Part 3 §15.4; ROADMAP 19c-i).
//
// The worst thing this could do to a real person: show a gym's event or its poster to
// somebody outside that gym, or keep a poster with the place it was photographed inside
// it. So an event and its poster are read only by a live app member of that gym on a live
// plan, or by its staff holding `posts.manage`, everybody else getting the 404 of a gym
// that does not exist; and a poster goes through `cleanPhoto` before it is stored.
import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  GYM_EVENTS_COMING_MAX,
  GYM_EVENTS_PAST_SHOWN,
  GYM_EVENT_COMING_WORDS,
  GYM_EVENT_MAX_DAYS_AHEAD,
  GYM_EVENT_POSTER_MAX_BYTES,
  GYM_EVENT_WORDS,
  gymEventsResponseSchema,
  memberGymEventSchema,
  staffGymEventSchema,
  staffGymEventsResponseSchema,
  type AddGymEventRequest,
  type ChangeGymEventRequest,
  type GymEvent,
  type GymEventsResponse,
  type MemberGymEvent,
  type StaffGymEvent,
  type StaffGymEventsResponse,
} from "@app/shared";
import { getOrgById, gymHasLivePlan, insertAudit } from "../repo.js";
import { OrgsError, holdsPrivilege, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { cleanPhoto } from "../gymPage/photoBytes.js";
import { eventPosterKey, type PhotoStore } from "../gymPage/photoStore.js";
import { PHOTO_PROBLEM_STATUS, type PhotoFile } from "../gymPage/service.js";
import { lockGym } from "../memberList/repo.js";
import { removeListed } from "../posts/photoFiles.js";
import { isLiveMember, queueFiles, unqueueFiles } from "../posts/repo.js";
import { comingCount, countsOf, goingFor, handOverEvent } from "./places.js";
import * as repo from "./repo.js";

export interface EventsDeps {
  sql: Sql;
  now: () => Date;
  photos: PhotoStore;
  /** A file left behind after its row went is said here, never thrown at the person. */
  log: { warn: (obj: object, msg: string) => void };
}

/** The route's rate limit, asked after the tick: false when it has already answered 429. */
export type Limit = () => Promise<boolean>;

/** Events are the gym's announcements: the staff who post its Updates make them. */
const TICK = "posts.manage";

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const eventNotFound = (): OrgsError => new OrgsError(404, "event_not_found", GYM_EVENT_WORDS.not_found);
const posterNotFound = (): OrgsError => new OrgsError(404, "poster_not_found", GYM_EVENT_WORDS.poster_not_found);

/** An event as it is sent. Not checked here: a list's own response check reads every one. */
function shaped(row: repo.EventRow): GymEvent {
  return {
    id: row.id,
    name: row.name,
    details: row.details,
    place: row.place,
    startsOn: row.startsOn,
    startMinute: row.startMinute,
    endsOn: row.endsOn,
    endMinute: row.endMinute,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    places: row.places,
    cancelled: row.cancelled,
    poster: row.poster === null ? null : { id: row.poster.id, width: row.poster.width, height: row.poster.height },
  };
}

/** The gym is open and on a trial or a paid plan: its members see its page. */
async function gymIsLive(sql: Sql, gymId: string, status: string): Promise<boolean> {
  return status === "active" && (await gymHasLivePlan(sql, gymId));
}

/** The gym's coming events for a live app member of it; 404 for everybody else. */
export async function getEvents(deps: Pick<EventsDeps, "sql" | "now">, userId: string, gymId: string, limit: Limit): Promise<GymEventsResponse | null> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await isLiveMember(deps.sql, gymId, userId))) throw notFound();
  if (!(await limit())) return null;
  const now = deps.now();
  const today = await repo.gymToday(deps.sql, gymId, now);
  if (today === null) throw notFound();
  const head = { gymId, gymName: org.name, timezone: org.timezone, today };
  if (!(await gymIsLive(deps.sql, gymId, org.status))) return gymEventsResponseSchema.parse({ ...head, status: "paused", events: [] });
  const rows = await repo.comingEvents(deps.sql, gymId, now, GYM_EVENTS_COMING_MAX);
  const going = await goingFor(deps.sql, gymId, userId, rows, now);
  return gymEventsResponseSchema.parse({ ...head, status: "shown", events: rows.map((row) => ({ ...shaped(row), going: going.get(row.id) })) });
}

/** One event as the member who just said "I'm coming" or "Can't come" reads it now. */
export async function memberEvent(deps: Pick<EventsDeps, "sql" | "now">, userId: string, gymId: string, eventId: string): Promise<MemberGymEvent> {
  const row = await repo.eventById(deps.sql, gymId, eventId);
  if (row === null) throw eventNotFound();
  const going = await goingFor(deps.sql, gymId, userId, [row], deps.now());
  return memberGymEventSchema.parse({ ...shaped(row), going: going.get(row.id) });
}

/** The gym's events, coming and ended, for its staff holding the tick. */
export async function getStaffEvents(deps: Pick<EventsDeps, "sql" | "now">, staffId: string, gymId: string, limit: Limit): Promise<StaffGymEventsResponse | null> {
  const { org } = await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const now = deps.now();
  const [coming, past, pastTotal, today] = await Promise.all([
    repo.comingEvents(deps.sql, gymId, now, GYM_EVENTS_COMING_MAX),
    repo.pastEvents(deps.sql, gymId, now, GYM_EVENTS_PAST_SHOWN),
    repo.countPast(deps.sql, gymId, now),
    repo.gymToday(deps.sql, gymId, now),
  ]);
  if (today === null) throw notFound();
  const counts = await countsOf(deps.sql, gymId, [...coming, ...past].map((row) => row.id));
  const counted = (row: repo.EventRow) => ({ ...shaped(row), coming: counts.get(row.id)?.coming ?? 0, waiting: counts.get(row.id)?.waitlisted ?? 0 });
  return staffGymEventsResponseSchema.parse({
    gymId,
    gymName: org.name,
    timezone: org.timezone,
    today,
    coming: coming.map(counted),
    past: past.map(counted),
    pastTotal,
  });
}

/** Staff who may make and change events at a gym that can be changed; anybody else is
 *  refused as every staff write here refuses them. The routes ask it before they read a
 *  body that may hold a poster. */
export async function requireEventStaff(deps: Pick<EventsDeps, "sql">, staffId: string, gymId: string): Promise<void> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
}

/** Removes the files of those of `keys` still listed to remove. One that will not go stays
 *  listed and is tried again by the nightly run; it is said here, never thrown at the person. */
async function removeFiles(deps: Pick<EventsDeps, "sql" | "photos" | "log">, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const left = await removeListed(deps, keys, true);
    if (left > 0) deps.log.warn({ event: "gym_event.poster_left_behind", count: left }, "a removed poster's file could not be deleted; it will be tried again");
  } catch (err) {
    deps.log.warn({ event: "gym_event.poster_left_behind", err }, "a removed poster's file could not be deleted; it will be tried again");
  }
}

/** The poster as it will be kept, its bytes beside it; a picture that cannot be kept is refused. */
function readPoster(gymId: string, base64: string): repo.EventPoster & { bytes: Uint8Array } {
  const read = cleanPhoto(new Uint8Array(Buffer.from(base64, "base64")), GYM_EVENT_POSTER_MAX_BYTES);
  if (!read.ok) {
    const problem = PHOTO_PROBLEM_STATUS[read.problem];
    throw new OrgsError(400, problem.code, GYM_EVENT_WORDS.poster(read.problem === "too_big" ? GYM_EVENT_WORDS.poster_too_big : problem.message));
  }
  const id = randomUUID();
  return { id, storageKey: eventPosterKey(gymId, id, read.type), contentType: read.type, byteSize: read.bytes.length, width: read.width, height: read.height, bytes: read.bytes };
}

/** The instants of an event's days and times on the gym's clock, refused where the end is
 *  not after the start (the clocks changing can do it to times that read in order), has
 *  already passed, or the start is more than two years away. */
async function instantsFor(sql: Sql | TransactionSql, gymId: string, times: repo.EventTimes, now: Date): Promise<{ startsAt: Date; endsAt: Date }> {
  const at = await repo.instantsOf(sql, gymId, times, now);
  if (at === null) throw notFound();
  if (at.endsAt.getTime() <= at.startsAt.getTime()) throw new OrgsError(400, "event_ends_before_start", GYM_EVENT_WORDS.ends_before_start);
  if (at.endsAt.getTime() <= now.getTime()) throw new OrgsError(400, "event_already_ended", GYM_EVENT_WORDS.already_ended);
  if (at.daysAhead > GYM_EVENT_MAX_DAYS_AHEAD) throw new OrgsError(400, "event_too_far", GYM_EVENT_WORDS.too_far);
  return { startsAt: at.startsAt, endsAt: at.endsAt };
}

async function staffEvent(deps: Pick<EventsDeps, "sql">, gymId: string, eventId: string): Promise<StaffGymEvent> {
  const [row, counts] = await Promise.all([repo.eventById(deps.sql, gymId, eventId), countsOf(deps.sql, gymId, [eventId])]);
  if (row === null) throw eventNotFound();
  return staffGymEventSchema.parse({ ...shaped(row), coming: counts.get(eventId)?.coming ?? 0, waiting: counts.get(eventId)?.waitlisted ?? 0 });
}

/** A new event. Sent twice under one key (a reply lost on the way back), it is one event. */
export async function addEvent(deps: EventsDeps, staffId: string, gymId: string, body: AddGymEventRequest): Promise<StaffGymEvent> {
  await requireEventStaff(deps, staffId, gymId);
  const kept = await repo.eventIdByKey(deps.sql, gymId, body.eventKey);
  if (kept !== null) return await staffEvent(deps, gymId, kept);
  const at = deps.now();
  const instants = await instantsFor(deps.sql, gymId, body, at);
  const poster = body.poster === undefined ? null : readPoster(gymId, body.poster);
  const keys = poster === null ? [] : [poster.storageKey];
  const id = randomUUID();
  let made: boolean;
  // Listed to remove before the file is written, and taken off the list in the step that
  // keeps the event: whatever stops in between, a file with no event is found and removed,
  // and a kept event's poster never is.
  await queueFiles(deps.sql, keys);
  try {
    if (poster !== null) await deps.photos.put(poster.storageKey, poster.bytes);
    made = await deps.sql.begin(async (tx) => {
      // The gym held: two events added at once are counted one after the other.
      await lockGym(tx, gymId);
      if ((await repo.eventIdByKey(tx, gymId, body.eventKey)) !== null) return false;
      if ((await repo.countComing(tx, gymId, at)) >= GYM_EVENTS_COMING_MAX) throw new OrgsError(409, "events_full", GYM_EVENT_WORDS.full);
      if (!(await repo.insertEvent(tx, gymId, { id, ...body, ...instants }, poster, staffId, at))) return false;
      await unqueueFiles(tx, keys);
      await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.event_added", targetType: "event", targetId: id, meta: { poster: String(poster !== null) } });
      return true;
    });
  } catch (err) {
    await removeFiles(deps, keys);
    throw err;
  }
  if (made) return await staffEvent(deps, gymId, id);
  await removeFiles(deps, keys);
  const first = await repo.eventIdByKey(deps.sql, gymId, body.eventKey);
  if (first === null) throw eventNotFound();
  return await staffEvent(deps, gymId, first);
}

/** Staff take the poster off an event that has ended; nothing else of it changes. */
async function removeEndedPoster(deps: EventsDeps, staffId: string, gymId: string, eventId: string, at: Date): Promise<StaffGymEvent> {
  const dropped = await deps.sql.begin(async (tx) => {
    const row = await repo.lockEvent(tx, gymId, eventId);
    if (row === null) throw eventNotFound();
    if (row.poster === null) return [];
    await repo.clearPoster(tx, gymId, eventId, at);
    await queueFiles(tx, [row.poster.storageKey]);
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.event_changed", targetType: "event", targetId: eventId, meta: { poster: "removed" } });
    return [row.poster.storageKey];
  });
  await removeFiles(deps, dropped);
  return await staffEvent(deps, gymId, eventId);
}

/** Staff change an event that has not ended: its words, its times, its poster. Of one
 *  that has ended only the poster can change, and only by being taken off (a person in
 *  it may ask). */
export async function changeEvent(deps: EventsDeps, staffId: string, gymId: string, eventId: string, body: ChangeGymEventRequest): Promise<StaffGymEvent> {
  await requireEventStaff(deps, staffId, gymId);
  const at = deps.now();
  // The event is asked about before its new times are judged: one that is gone or has
  // ended is said to be so, whatever the times sent.
  const before = await repo.eventById(deps.sql, gymId, eventId);
  if (before === null) throw eventNotFound();
  if (before.endsAt.getTime() <= at.getTime()) {
    if (body.poster === null) return await removeEndedPoster(deps, staffId, gymId, eventId, at);
    throw new OrgsError(409, "event_ended", GYM_EVENT_WORDS.ended);
  }
  const instants = await instantsFor(deps.sql, gymId, body, at);
  const poster = typeof body.poster === "string" ? readPoster(gymId, body.poster) : body.poster;
  const added = poster === null || poster === undefined ? [] : [poster.storageKey];
  let dropped: string[];
  await queueFiles(deps.sql, added);
  try {
    if (poster !== null && poster !== undefined) await deps.photos.put(poster.storageKey, poster.bytes);
    dropped = await deps.sql.begin(async (tx) => {
      // The gym and then the event, as every write of who is coming takes them.
      await lockGym(tx, gymId);
      const row = await repo.lockEvent(tx, gymId, eventId);
      if (row === null) throw eventNotFound();
      if (row.endsAt.getTime() <= at.getTime()) throw new OrgsError(409, "event_ended", GYM_EVENT_WORDS.ended);
      // Nobody who was told they have a place loses it to a smaller number.
      const coming = await comingCount(tx, gymId, eventId);
      if (body.places !== null && coming > body.places) throw new OrgsError(409, "event_places_below_coming", GYM_EVENT_COMING_WORDS.places_below_coming(coming));
      await repo.updateEvent(tx, gymId, eventId, { ...body, ...instants }, poster, at);
      // More places, or a later start: what is free now goes to the waitlist.
      await handOverEvent(tx, gymId, eventId, at);
      // The poster this one takes the place of: its file is listed to remove in this step.
      const old = poster !== undefined && row.poster !== null ? [row.poster.storageKey] : [];
      await queueFiles(tx, old);
      await unqueueFiles(tx, added);
      await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.event_changed", targetType: "event", targetId: eventId, meta: { poster: poster === undefined ? "kept" : poster === null ? "removed" : "new" } });
      return old;
    });
  } catch (err) {
    await removeFiles(deps, added);
    throw err;
  }
  await removeFiles(deps, dropped);
  return await staffEvent(deps, gymId, eventId);
}

/** Staff cancel an event that has not ended, or un-cancel it. A cancelled event stays on
 *  the members' list, marked, until it would have ended. */
export async function setCancelled(deps: EventsDeps, staffId: string, gymId: string, eventId: string, cancelled: boolean, limit: Limit): Promise<StaffGymEvent | null> {
  await requireEventStaff(deps, staffId, gymId);
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    const at = deps.now();
    await lockGym(tx, gymId);
    const row = await repo.lockEvent(tx, gymId, eventId);
    if (row === null) throw eventNotFound();
    if (row.endsAt.getTime() <= at.getTime()) throw new OrgsError(409, "event_ended", GYM_EVENT_WORDS.ended);
    // Asked again, it is already so: nothing is written twice.
    if (row.cancelled === cancelled) return;
    await repo.setCancelled(tx, gymId, eventId, cancelled ? at : null, at);
    // Everybody keeps their place through a cancel, so an event brought back is as it
    // was; a place given up while it was cancelled goes to the waitlist now.
    if (!cancelled) await handOverEvent(tx, gymId, eventId, at);
    await insertAudit(tx, { actorUserId: staffId, gymId, action: cancelled ? "org.event_cancelled" : "org.event_uncancelled", targetType: "event", targetId: eventId, meta: {} });
  });
  return await staffEvent(deps, gymId, eventId);
}

/** An event's poster, for a member who is sent the event or staff holding the tick. With
 *  `wantBytes` false (the reader's browser already holds it) the same checks run and
 *  "same" is the answer: it is still theirs to show. Null when the limit has answered. */
export async function getPoster(
  deps: Pick<EventsDeps, "sql" | "photos" | "now">,
  userId: string,
  gymId: string,
  eventId: string,
  posterId: string,
  wantBytes: boolean,
  limit: Limit,
): Promise<PhotoFile | "same" | null> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null) throw notFound();
  const member = (await isLiveMember(deps.sql, gymId, userId)) && (await gymIsLive(deps.sql, gymId, org.status));
  const staff = await holdsPrivilege(deps, gymId, userId, TICK);
  if (!member && !staff) throw notFound();
  if (!(await limit())) return null;
  const row = await repo.eventById(deps.sql, gymId, eventId);
  // A member is sent the poster of an event they are sent: one that has not ended.
  const sent = row !== null && (staff || row.endsAt.getTime() > deps.now().getTime());
  if (row === null || !sent || row.poster === null || row.poster.id !== posterId.toLowerCase()) throw posterNotFound();
  if (!wantBytes) return "same";
  const bytes = await deps.photos.get(row.poster.storageKey);
  if (bytes === null) throw posterNotFound();
  return { contentType: row.poster.contentType, bytes };
}
