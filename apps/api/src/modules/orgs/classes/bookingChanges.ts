// WHAT HAPPENS TO BOOKINGS WHEN SOMETHING ELSE CHANGES (spec Part 3 §13.4; ROADMAP
// 17c-ii-a): a freed place handed to the waitlist, a class staff cancelled or removed, a
// class made bigger, a member who left, a membership staff cancelled (17c-iii).
//
// Every function here runs inside the caller's transaction, under the gym's row lock,
// which the caller has taken. A pack's class is given back in the same transaction as the
// booking that stops being charged for it, and a booking already ended is not found again,
// so each class comes back once however often a change arrives.
import type { Sql, TransactionSql } from "postgres";
import { CLASS_CHECKIN_BEFORE_MINUTES, MEMBERSHIP_BOOKINGS_ENDING_SHOWN, type PtSessionsEnding, bookingTime, handsOverNow, pickCover, type Cover, type HeldCover } from "@app/shared";
import { chargePack, givePackClassesBack } from "../memberships/heldRepo.js";
import { endLeaversPlaces } from "../events/places.js";
import { endSessionsOf, sessionsEndingFor } from "../pt/changes.js";
import * as repo from "./bookingsRepo.js";

export const pick = (ctx: Pick<repo.ClassContext, "session" | "gymHasTypes">, held: readonly HeldCover[]): Cover =>
  pickCover({ gymHasTypes: ctx.gymHasTypes, openGym: ctx.session.openGym, classDay: ctx.session.localDate, held });

export interface Move {
  waiter: repo.Waiter;
  entryId: string | null;
  cover: Extract<Cover, { ok: true }>;
}

export interface HandOverPlan {
  moves: Move[];
  /** The waiters' memberships by record, as they stand once the moves are made. */
  covers: Map<string, HeldCover[]>;
}

/** Whether the class has a free place that goes to its waitlist by itself at this moment. */
export function handsOverTo(ctx: repo.ClassContext, now: Date): boolean {
  const time = bookingTime(now.getTime(), ctx.session.startsAt.getTime(), ctx.settings);
  return ctx.counts.waitlisted > 0 && handsOverNow({ time, cancelled: ctx.session.cancelled, places: ctx.session.places, booked: ctx.counts.booked });
}

/** Who the class's free places go to, from its waitlist and the memberships of the
 *  people on it, both read already: the first in line who may book, and so on down the
 *  line. Somebody who may not is passed over and keeps their place. `covers` is changed as
 *  places are given. */
export function planHandOver(ctx: repo.ClassContext, now: Date, waiters: readonly repo.Waiter[], covers: Map<string, HeldCover[]>): HandOverPlan {
  const time = bookingTime(now.getTime(), ctx.session.startsAt.getTime(), ctx.settings);
  let booked = ctx.counts.booked;
  const free = () => handsOverNow({ time, cancelled: ctx.session.cancelled, places: ctx.session.places, booked });
  const moves: Move[] = [];
  for (const waiter of waiters) {
    if (!free()) break;
    if (waiter.booker === null) continue;
    const { entryId } = waiter.booker;
    const cover = pick(ctx, entryId === null ? [] : (covers.get(entryId) ?? []));
    if (!cover.ok) continue;
    moves.push({ waiter, entryId, cover });
    booked += 1;
    // One reading serves the whole line, so what this person takes is taken off it: two
    // accounts on one record do not both use its last booking of the week, or its last class.
    if (entryId !== null && cover.membershipId !== null) {
      const { membershipId, chargePack: pack } = cover;
      covers.set(
        entryId,
        (covers.get(entryId) ?? []).map((h) => {
          if (h.id !== membershipId) return h;
          if (!pack) return { ...h, used: h.used + 1 };
          return { ...h, membership: { ...h.membership, classesLeft: (h.membership.classesLeft ?? 1) - 1 } };
        }),
      );
    }
  }
  return { moves, covers };
}

/** Who the class's free places go to at this moment, while the rule says a free place
 *  goes to the waitlist by itself. It reads and changes nothing, in three statements
 *  whatever the waitlist's length. */
export async function handOverPlan(sql: Sql | TransactionSql, gymId: string, ctx: repo.ClassContext, now: Date): Promise<HandOverPlan> {
  if (!handsOverTo(ctx, now)) return { moves: [], covers: new Map() };
  const waiters = await repo.waitlistOf(sql, gymId, ctx.session.id);
  const entryIds = ctx.gymHasTypes ? waiters.flatMap((w) => w.booker?.entryId ?? []) : [];
  return planHandOver(ctx, now, waiters, await repo.coversOf(sql, gymId, entryIds, ctx.session));
}

/** The plan carried out, under the gym's lock and the class's. Answers how many were
 *  moved in. */
export async function handOver(tx: TransactionSql, gymId: string, ctx: repo.ClassContext, now: Date): Promise<number> {
  let moved = 0;
  for (const { waiter, entryId, cover } of (await handOverPlan(tx, gymId, ctx, now)).moves) {
    if (cover.chargePack && cover.membershipId !== null && !(await chargePack(tx, gymId, cover.membershipId, now))) {
      throw new Error("a pack the plan chose had no class left");
    }
    await repo.moveIn(tx, {
      gymId,
      bookingId: waiter.bookingId,
      entryId,
      heldMembershipId: cover.membershipId,
      packCharged: cover.chargePack,
      claimKey: null,
      now,
    });
    moved += 1;
  }
  return moved;
}

/** Free places in these classes go to their waitlists, as a cancel's freed place does: a
 *  class made bigger, or one whose booked people left. Only a class with somebody waiting
 *  is read. Answers how many people were moved in. */
export async function handOverClasses(tx: TransactionSql, gymId: string, sessionIds: readonly string[], now: Date): Promise<number> {
  let moved = 0;
  for (const id of await repo.classesWithWaitlist(tx, gymId, sessionIds)) {
    const ctx = await repo.classContext(tx, gymId, id);
    if (ctx !== null) moved += await handOver(tx, gymId, ctx, now);
  }
  return moved;
}

/** THESE CLASSES WERE CHANGED, perhaps to a new time. A place a check-in marked came
 *  before the start is booked again where the class now starts more than the hour away
 *  (17f); then free places go to the waitlists. */
export async function classesChanged(tx: TransactionSql, gymId: string, sessionIds: readonly string[], now: Date): Promise<number> {
  await repo.putBackToBooked(tx, gymId, { moved: sessionIds, beforeMinutes: CLASS_CHECKIN_BEFORE_MINUTES }, now);
  return await handOverClasses(tx, gymId, sessionIds, now);
}

/** As `handOverClasses`, for every coming class of the gym with a waitlist: the gym
 *  changed its hand-over time. */
export async function handOverComing(tx: TransactionSql, gymId: string, now: Date): Promise<number> {
  let moved = 0;
  for (const id of await repo.comingClassesWithWaitlist(tx, gymId, now)) {
    const ctx = await repo.classContext(tx, gymId, id);
    if (ctx !== null) moved += await handOver(tx, gymId, ctx, now);
  }
  return moved;
}

async function giveBack(tx: TransactionSql, gymId: string, ended: readonly repo.EndedBooking[], now: Date): Promise<number> {
  const back = new Map<string, number>();
  for (const { packMembershipId } of ended) {
    if (packMembershipId !== null) back.set(packMembershipId, (back.get(packMembershipId) ?? 0) + 1);
  }
  await givePackClassesBack(tx, gymId, back, now);
  return [...back.values()].reduce((a, b) => a + b, 0);
}

export interface BookingsEnded {
  /** People who held a place, and people who were waiting. */
  booked: number;
  waiting: number;
  /** Classes given back to packs. */
  packClasses: number;
  /** A membership's cancel: the personal training sessions ended with it, and how many of
   *  them went back to a pack. */
  ptSessions?: number;
  ptPackSessions?: number;
}

/** THESE CLASSES WILL NOT RUN: staff cancelled them (`remove` false, the bookings stay
 *  as cancelled) or removed them from the calendar (`remove` true, the bookings go with
 *  the class). Everybody's booking ends and every pack charged for one has its class
 *  back, a late cancel's too: nobody pays for a class the gym did not run. */
export async function endClassBookings(
  tx: TransactionSql,
  gymId: string,
  sessionIds: readonly string[],
  now: Date,
  opts: { remove: boolean },
): Promise<BookingsEnded> {
  const ended = await repo.endBookings(tx, gymId, { classes: sessionIds }, now);
  const packClasses = await giveBack(tx, gymId, ended, now);
  if (opts.remove) await repo.deleteBookingsOf(tx, gymId, sessionIds);
  const waiting = ended.filter((b) => b.was === "waitlisted").length;
  const late = ended.filter((b) => b.was === "late_cancelled").length;
  return { booked: ended.length - waiting - late, waiting, packClasses };
}

/** THESE PEOPLE HAVE LEFT THE GYM (removed by staff, or their account deleted): their
 *  bookings of classes that have not started end, their packs have those classes back,
 *  and each place they held goes to the class's waitlist by the usual rule. `now` null:
 *  the database's own clock, which is what stamped their leaving. */
export async function endLeaversBookings(tx: TransactionSql, gymId: string, userIds: readonly string[], now: Date | null): Promise<BookingsEnded> {
  if (userIds.length === 0) return { booked: 0, waiting: 0, packClasses: 0 };
  let at = now;
  if (at === null) {
    const [clock] = await tx<{ now: Date }[]>`SELECT now() AS now`;
    if (clock === undefined) throw new Error("the database gave no time");
    at = clock.now;
  }
  const ended = await repo.endBookings(tx, gymId, { people: userIds, now: at }, at);
  const packClasses = await giveBack(tx, gymId, ended, at);
  const freed = [...new Set(ended.filter((b) => b.was === "booked" || b.was === "attended").map((b) => b.sessionId))];
  await handOverClasses(tx, gymId, freed, at);
  // Their places at the gym's events end with them (19c-ii).
  await endLeaversPlaces(tx, gymId, userIds, at);
  const waiting = ended.filter((b) => b.was === "waitlisted").length;
  return { booked: ended.length - waiting, waiting, packClasses };
}

/** THESE RECORDS HAVE COME OFF THE GYM'S LIST: the class bookings made on them that have
 *  not started end, their packs have those classes back, and each place goes to the
 *  class's waitlist. For somebody whose app ends too, `endLeaversBookings` finds nothing
 *  left; this is what reaches staff who train here and anybody the list cannot say is
 *  certainly this record's. */
export async function endRecordsBookings(tx: TransactionSql, gymId: string, entryIds: readonly string[], now: Date): Promise<BookingsEnded> {
  const ended = await repo.endBookings(tx, gymId, { records: entryIds, now }, now);
  const packClasses = await giveBack(tx, gymId, ended, now);
  const freed = [...new Set(ended.filter((b) => b.was === "booked" || b.was === "attended").map((b) => b.sessionId))];
  await handOverClasses(tx, gymId, freed, now);
  const waiting = ended.filter((b) => b.was === "waitlisted").length;
  return { booked: ended.length - waiting, waiting, packClasses };
}

/** The bookings a change would end, as the 409 that asks first carries them. */
export interface HasBookings {
  kind: "has_bookings";
  ending: repo.EndingCounts & { people: repo.EndingPersonRow[]; ptSessions?: PtSessionsEnding };
}

/** What the screen was told a membership's cancel would end: the mark of the class
 *  bookings, and the mark of the personal training sessions. */
export interface MembershipEndConfirmed {
  bookings: string | null;
  ptSessions: string | null;
}

/** The question a membership's cancel must have answered first: null when no class place
 *  and no personal training session is booked on it, or when `confirmed` is the classes'
 *  number and the sessions' mark as worked out here, under the gym's lock. Asked before
 *  the cancel's first write. */
export async function membershipBookingsAsk(
  tx: TransactionSql,
  gymId: string,
  scope: repo.MembershipScope,
  confirmed: MembershipEndConfirmed,
): Promise<HasBookings | null> {
  const counts = await repo.endingCounts(tx, gymId, scope);
  const sessions = await sessionsEndingFor(tx, gymId, { membership: scope.membership, afterDay: scope.afterDay }, scope.now);
  const classesAnswered = counts.booked === 0 || counts.mark === confirmed.bookings;
  const sessionsAnswered = sessions === null || sessions.mark === confirmed.ptSessions;
  if (classesAnswered && sessionsAnswered) return null;
  return {
    kind: "has_bookings",
    ending: {
      ...counts,
      people: counts.booked === 0 ? [] : await repo.endingPeople(tx, gymId, scope, null, MEMBERSHIP_BOOKINGS_ENDING_SHOWN),
      ...(sessions === null ? {} : { ptSessions: sessions }),
    },
  };
}

/** STAFF CANCELLED THIS MEMBERSHIP: the places booked on it end, a pack has those classes
 *  back, and each place goes to the class's waitlist by the usual rule. A place the person
 *  booked on another membership is not on this one and stays. The personal training
 *  sessions booked on it end the same way (17e-iv-a). */
export async function endMembershipBookings(tx: TransactionSql, gymId: string, scope: repo.MembershipScope, now: Date): Promise<BookingsEnded> {
  const ended = await repo.endBookings(tx, gymId, scope, now);
  const packClasses = await giveBack(tx, gymId, ended, now);
  await handOverClasses(tx, gymId, [...new Set(ended.map((b) => b.sessionId))], now);
  const pt = await endSessionsOf(tx, gymId, { membership: scope.membership, afterDay: scope.afterDay }, scope.now);
  return { booked: ended.length, waiting: 0, packClasses, ptSessions: pt.sessions, ptPackSessions: pt.packSessions };
}
