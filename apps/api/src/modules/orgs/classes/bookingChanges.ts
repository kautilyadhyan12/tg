// WHAT HAPPENS TO BOOKINGS WHEN SOMETHING ELSE CHANGES (spec Part 3 §13.4; ROADMAP
// 17c-ii-a): a freed place handed to the waitlist, a class staff cancelled or removed, a
// class made bigger, a member who left.
//
// Every function here runs inside the caller's transaction, under the gym's row lock,
// which the caller has taken. A pack's class is given back in the same transaction as the
// booking that stops being charged for it, and a booking already ended is not found again,
// so each class comes back once however often a change arrives.
import type { Sql, TransactionSql } from "postgres";
import { bookingTime, handsOverNow, pickCover, type Cover, type HeldCover } from "@app/shared";
import { chargePack, givePackClassesBack } from "../memberships/heldRepo.js";
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
  const freed = [...new Set(ended.filter((b) => b.was === "booked").map((b) => b.sessionId))];
  await handOverClasses(tx, gymId, freed, at);
  const waiting = ended.filter((b) => b.was === "waitlisted").length;
  return { booked: ended.length - waiting, waiting, packClasses };
}
