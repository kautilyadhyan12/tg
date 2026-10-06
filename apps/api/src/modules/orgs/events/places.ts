// "I'M COMING" ON A GYM'S EVENT (spec Part 3 §15.4; ROADMAP 19c-ii).
//
// The worst thing this could do to a real person: tell two people they have the last
// place, and one is turned away at the door. So "I'm coming" and "Can't come" each run as
// one transaction under the gym's lock and the event's row; what happens is decided by the
// class booking rule in `@app/shared` (`decideComing`, `decideNotComing`) on what is read
// inside that; and a request's key is kept on its place, so the same request again
// changes nothing.
//
// A member's routes answer the 404 of a gym that does not exist to anybody who is not a
// live app member of a gym on a live plan. Who is coming is read, and a person taken off,
// by staff holding `posts.manage`, as the event itself is.
import type { Sql, TransactionSql } from "postgres";
import {
  GYM_EVENT_COMING_WORDS,
  GYM_EVENT_PEOPLE_SHOWN,
  GYM_EVENT_WORDS,
  bookingTime,
  decideComing,
  decideNotComing,
  eventGoing,
  eventHandsOverNow,
  eventRefusal,
  gymEventPeopleResponseSchema,
  type ClassBookingSettings,
  type ComeToEventRequest,
  type GymEventComingRefusal,
  type GymEventGoing,
  type GymEventPeopleResponse,
  type GymEventPerson,
} from "@app/shared";
import { getOrgById, gymHasLivePlan, insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import type { Line } from "../classes/bookingsService.js";
import { fullName } from "../leaderboard/rank.js";
import { lockGym } from "../memberList/repo.js";
import { isLiveMember } from "../posts/repo.js";
import * as repo from "./placesRepo.js";

export interface PlacesDeps {
  sql: Sql;
  now: () => Date;
  /** This server's line of place writes (`createLine`). */
  inLine: Line;
}

/** The route's rate limit, asked after membership: false when it has already answered
 *  429. A signed-in stranger's 404 is therefore never counted, as on every gym page's
 *  routes: counting it would let ten strangers on a gym's wi-fi use up its members' hour. */
export type Limit = () => Promise<boolean>;

const TICK = "posts.manage";

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const eventNotFound = (): OrgsError => new OrgsError(404, "event_not_found", GYM_EVENT_WORDS.not_found);
const refusal = (reason: GymEventComingRefusal): OrgsError => new OrgsError(409, reason, GYM_EVENT_COMING_WORDS[reason]);

/** A live app member of a gym that is open and on a live plan; 404 for everybody else. */
async function requireMember(deps: Pick<PlacesDeps, "sql">, gymId: string, userId: string): Promise<void> {
  const [org, member, live] = await Promise.all([getOrgById(deps.sql, gymId), isLiveMember(deps.sql, gymId, userId), gymHasLivePlan(deps.sql, gymId)]);
  if (org === null || org.status !== "active" || !member || !live) throw notFound();
}

const mineOf = (ctx: repo.PlaceContext): "coming" | "waitlisted" | null => (ctx.latest === null || ctx.latest.status === "cancelled" ? null : ctx.latest.status);

const placeInput = (ctx: repo.PlaceContext, now: Date) => ({
  nowMs: now.getTime(),
  startsAtMs: ctx.event.startsAt.getTime(),
  cancelled: ctx.event.cancelled,
  places: ctx.event.places,
  coming: ctx.counts.coming,
  waitlisted: ctx.counts.waitlisted,
  settings: ctx.settings,
});

/** FREE PLACES GO TO THE WAITLIST, the first in line first, while the rule says a free
 *  place goes to it by itself. Somebody no longer a member is passed over and keeps their
 *  place in line. Under the gym's lock and the event's. Answers how many were moved in. */
async function handOver(tx: TransactionSql, gymId: string, ctx: repo.PlaceContext, now: Date): Promise<number> {
  if (!eventHandsOverNow(placeInput(ctx, now))) return 0;
  const free = ctx.event.places === null ? Infinity : ctx.event.places - ctx.counts.coming;
  const moves: { placeId: string; entryId: string | null }[] = [];
  for (const waiter of await repo.waitlistOf(tx, gymId, ctx.event.id)) {
    if (moves.length >= free) break;
    if (!waiter.member) continue;
    moves.push({ placeId: waiter.placeId, entryId: waiter.entryId });
  }
  await repo.moveInMany(tx, gymId, moves, now);
  return moves.length;
}

/** As `handOver`, for an event whose places, time or cancelling staff just changed, or
 *  whose people left. The caller holds the gym's lock. */
export async function handOverEvent(tx: TransactionSql, gymId: string, eventId: string, now: Date): Promise<number> {
  const ctx = await repo.contextOf(tx, gymId, eventId, null, true);
  return ctx === null ? 0 : await handOver(tx, gymId, ctx, now);
}

/** Every coming event of the gym with a waitlist: the gym changed its hand-over time. */
export async function handOverComingEvents(tx: TransactionSql, gymId: string, now: Date): Promise<number> {
  let moved = 0;
  for (const id of await repo.eventsWithWaitlist(tx, gymId, now, null)) moved += await handOverEvent(tx, gymId, id, now);
  return moved;
}

/** THESE PEOPLE HAVE LEFT THE GYM (removed by staff, or their account deleted): their
 *  places at events that have not started end, and each place they held goes to the
 *  event's waitlist by the usual rule. The caller holds the gym's lock. */
export async function endLeaversPlaces(tx: TransactionSql, gymId: string, userIds: readonly string[], at: Date): Promise<void> {
  const freed = await repo.endPlacesOf(tx, gymId, userIds, at);
  for (const id of await repo.eventsWithWaitlist(tx, gymId, at, freed)) await handOverEvent(tx, gymId, id, at);
}

/** How many people are coming to an event, counted with its row held: what a change to its
 *  places is judged against. */
export async function comingCount(tx: TransactionSql, gymId: string, eventId: string): Promise<number> {
  return (await repo.countsOf(tx, gymId, [eventId])).get(eventId)?.coming ?? 0;
}

export const countsOf = repo.countsOf;

/** What one member reads about each of these events' places. Three statements, however
 *  many events. */
export async function goingFor(
  sql: Sql,
  gymId: string,
  userId: string,
  events: readonly { id: string; startsAt: Date; places: number | null; cancelled: boolean }[],
  now: Date,
): Promise<Map<string, GymEventGoing>> {
  const ids = events.map((e) => e.id);
  const [settings, counts, mine] = await Promise.all([repo.settingsOf(sql, gymId), repo.countsOf(sql, gymId, ids), repo.minesOf(sql, gymId, userId, ids)]);
  if (settings === null) throw notFound();
  return new Map(events.map((e) => [e.id, goingOf(e, settings, counts.get(e.id), mine.get(e.id), now)]));
}

function goingOf(
  event: { startsAt: Date; places: number | null; cancelled: boolean },
  settings: ClassBookingSettings,
  counts: repo.EventCounts | undefined,
  mine: repo.MyPlace | undefined,
  now: Date,
): GymEventGoing {
  return eventGoing({
    nowMs: now.getTime(),
    startsAtMs: event.startsAt.getTime(),
    cancelled: event.cancelled,
    places: event.places,
    coming: counts?.coming ?? 0,
    waitlisted: counts?.waitlisted ?? 0,
    settings,
    mine: mine?.status ?? null,
    waitlistPlace: mine?.waitlistPlace ?? null,
  });
}

/** "I'm coming", "Join the waitlist", and the claim of a freed place. Answers true, or
 *  null when the limit has answered. */
export async function come(deps: PlacesDeps, userId: string, gymId: string, eventId: string, req: ComeToEventRequest, limit: Limit): Promise<true | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;

  // A "no" needs no lock: only a place GIVEN has to be decided under it, so a full event
  // never makes the gym's other bookings wait.
  const [seen, sent] = await Promise.all([repo.contextOf(deps.sql, gymId, eventId, userId, false), repo.byKey(deps.sql, gymId, req.requestKey)]);
  // A member is sent the events that have not ended, and no other.
  if (seen === null || seen.event.endsAt.getTime() <= deps.now().getTime()) throw eventNotFound();
  if (seen.member === null) throw notFound();
  if (sent === null) {
    const first = decideComing({ ...placeInput(seen, deps.now()), mine: mineOf(seen), joinWaitlist: req.joinWaitlist });
    if (first.kind === "refuse") throw refusal(eventRefusal(first.reason, seen.settings.waitlistMax));
  }

  // A refusal is carried out of the transaction, so a place handed over inside it is kept.
  const refused = await deps.inLine(gymId, () =>
    deps.sql.begin(async (tx): Promise<OrgsError | null> => {
      await lockGym(tx, gymId);
      let ctx = await repo.contextOf(tx, gymId, eventId, userId, true);
      if (ctx === null) return eventNotFound();

      // The same request again: the place it made stands as it is now, and nothing is added.
      const again = await repo.byKey(tx, gymId, req.requestKey);
      if (again !== null) {
        if (again.userId === userId && again.eventId === eventId) return null;
        return new OrgsError(409, "request_reused", GYM_EVENT_COMING_WORDS.request_reused);
      }
      if (ctx.member === null) return notFound();
      const now = deps.now();
      // The waitlist first: outside the hand-over time a free place is the first in line's.
      if ((await handOver(tx, gymId, ctx, now)) > 0) {
        ctx = await repo.contextOf(tx, gymId, eventId, userId, false);
        if (ctx === null || ctx.member === null) throw new Error("an event or its member went while both were held");
      }
      const { member, latest } = ctx;
      const decision = decideComing({ ...placeInput(ctx, now), mine: mineOf(ctx), joinWaitlist: req.joinWaitlist });
      switch (decision.kind) {
        case "already":
          return null;
        case "refuse":
          return refusal(eventRefusal(decision.reason, ctx.settings.waitlistMax));
        case "waitlist":
          await repo.insertPlace(tx, { gymId, eventId, userId, entryId: member.entryId, requestKey: req.requestKey, status: "waitlisted", now });
          return null;
        case "book":
          if (decision.fromWaitlist && latest !== null) {
            await repo.moveIn(tx, { gymId, placeId: latest.id, entryId: member.entryId, claimKey: req.requestKey, now });
          } else {
            await repo.insertPlace(tx, { gymId, eventId, userId, entryId: member.entryId, requestKey: req.requestKey, status: "coming", now });
          }
          return null;
      }
    }),
  );
  if (refused !== null) throw refused;
  return true;
}

/** "Can't come", or leaving the waitlist. Sent again, it finds it done. */
export async function notComing(deps: PlacesDeps, userId: string, gymId: string, eventId: string, limit: Limit): Promise<true | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const refused = await deps.inLine(gymId, () =>
    deps.sql.begin(async (tx): Promise<OrgsError | null> => {
      await lockGym(tx, gymId);
      const ctx = await repo.contextOf(tx, gymId, eventId, userId, true);
      const now = deps.now();
      if (ctx === null || ctx.event.endsAt.getTime() <= now.getTime()) return eventNotFound();
      const { latest } = ctx;
      if (latest?.status === "cancelled") return null;
      const decision = decideNotComing({ ...placeInput(ctx, now), mine: mineOf(ctx) });
      if (decision.kind === "refuse") {
        if (decision.reason === "no_booking") return new OrgsError(404, "not_coming", GYM_EVENT_COMING_WORDS.not_coming);
        return new OrgsError(409, "event_started", GYM_EVENT_COMING_WORDS.cancel_started);
      }
      if (latest === null) throw new Error("a place was given up with none held");
      await repo.markCancelled(tx, gymId, latest.id, now);
      if (decision.freesPlace) await handOver(tx, gymId, { ...ctx, counts: { ...ctx.counts, coming: ctx.counts.coming - 1 } }, now);
      return null;
    }),
  );
  if (refused !== null) throw refused;
  return true;
}

/** Who is coming to an event and who is waiting, for staff holding the tick. */
export async function getPeople(deps: Pick<PlacesDeps, "sql" | "now">, staffId: string, gymId: string, eventId: string, limit: Limit): Promise<GymEventPeopleResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const ctx = await repo.contextOf(deps.sql, gymId, eventId, null, false);
  if (ctx === null) throw eventNotFound();
  const [coming, waiting] = await Promise.all([
    repo.peopleOf(deps.sql, gymId, eventId, "coming", GYM_EVENT_PEOPLE_SHOWN),
    repo.peopleOf(deps.sql, gymId, eventId, "waitlisted", GYM_EVENT_PEOPLE_SHOWN),
  ]);
  const shown = (rows: repo.PersonRow[]): GymEventPerson[] =>
    rows.map((r) => {
      const named = fullName(r);
      return { id: r.placeId, name: named.name, initials: named.name === null ? "" : named.initials, at: r.at.toISOString() };
    });
  const time = bookingTime(deps.now().getTime(), ctx.event.startsAt.getTime(), ctx.settings);
  return gymEventPeopleResponseSchema.parse({
    eventId,
    places: ctx.event.places,
    handsOver: time.handsOver && !ctx.event.cancelled,
    started: time.phase === "started",
    coming: shown(coming),
    comingTotal: ctx.counts.coming,
    waiting: shown(waiting),
    waitingTotal: ctx.counts.waitlisted,
  });
}

/** Staff take one person off an event that has not ended: their place goes to the first
 *  in line by the usual rule. Asked again, it is already so. */
export async function removePerson(deps: PlacesDeps, staffId: string, gymId: string, eventId: string, placeId: string, limit: Limit): Promise<true | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const refused = await deps.inLine(gymId, () =>
    deps.sql.begin(async (tx): Promise<OrgsError | null> => {
      await lockGym(tx, gymId);
      const ctx = await repo.contextOf(tx, gymId, eventId, null, true);
      if (ctx === null) return eventNotFound();
      const now = deps.now();
      if (ctx.event.endsAt.getTime() <= now.getTime()) return new OrgsError(409, "event_ended", GYM_EVENT_WORDS.ended);
      const place = await repo.placeById(tx, gymId, eventId, placeId);
      if (place === null) return new OrgsError(404, "person_not_found", GYM_EVENT_COMING_WORDS.person_not_found);
      if (place.status === "cancelled") return null;
      await repo.markCancelled(tx, gymId, place.id, now);
      await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.event_person_removed", targetType: "event", targetId: eventId, meta: { placeId: place.id, was: place.status } });
      if (place.status === "coming") await handOver(tx, gymId, { ...ctx, counts: { ...ctx.counts, coming: ctx.counts.coming - 1 } }, now);
      return null;
    }),
  );
  if (refused !== null) throw refused;
  return true;
}
