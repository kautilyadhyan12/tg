// BOOKING A CLASS, AND ITS WAITLIST (spec Part 3 §13.4; ROADMAP 17c-i).
//
// The worst thing this could do to a real person: tell two people "You're booked" for the
// last place, or take a class off somebody's pack for a booking they never got. So Book
// and Cancel each run as one transaction under the gym's lock and the class's row; what
// happens is decided by the one rule in `@app/shared` (`decideBook`, `decideCancel`) on
// what is read inside that; and a request's key is kept on its booking, so the same
// request again changes nothing.
//
// A member's routes answer the 404 of a gym that does not exist to anybody who is not a
// live app member of a gym on a live plan. The staff list needs `schedule.manage`, or to
// be the class's own coach.
import type { Sql, TransactionSql } from "postgres";
import {
  CLASS_BOOKINGS_LATE_SHOWN,
  CLASS_BOOKING_HOLDS_PLACE,
  CLASS_BOOKING_WORDS,
  CLASS_LATE_CANCEL_ERROR,
  bookingTime,
  classBookingViewSchema,
  classSessionBookingsResponseSchema,
  decideBook,
  decideCancel,
  handsOverNow,
  pickCover,
  type BookClassRequest,
  type ClassBookRefusal,
  type ClassBookingView,
  type ClassSessionBookingsResponse,
  type Cover,
  type StaffClassBooking,
} from "@app/shared";
import { getOrgById, getStaffAuthority, gymHasLivePlan, isLiveMember, lockOrgRow } from "../repo.js";
import { OrgsError, holdsPrivilege } from "../service.js";
import { fullName } from "../leaderboard/rank.js";
import { chargePack, givePackClassBack } from "../memberships/heldRepo.js";
import * as repo from "./bookingsRepo.js";

export interface BookingsDeps {
  sql: Sql;
  now: () => Date;
  /** This server's line of booking writes (`createLine`). */
  inLine: Line;
}

/** The route's rate limit, asked after membership: false when it has already answered 429. */
export type Limit = () => Promise<boolean>;

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const classNotFound = (): OrgsError => new OrgsError(404, "class_not_found", CLASS_BOOKING_WORDS.class_not_found);

/** A live app member of a gym on a live plan; 404 for everybody else. */
async function requireMember(deps: Pick<BookingsDeps, "sql">, gymId: string, userId: string): Promise<void> {
  const [org, member, live] = await Promise.all([
    getOrgById(deps.sql, gymId),
    isLiveMember(deps.sql, gymId, userId),
    gymHasLivePlan(deps.sql, gymId),
  ]);
  if (org === null || !member || !live) throw notFound();
}

const STATUS: Record<ClassBookRefusal, number> = {
  class_cancelled: 409,
  class_started: 409,
  not_open_yet: 409,
  no_membership: 403,
  not_covered: 403,
  limit_week: 409,
  limit_month: 409,
  class_full: 409,
  waitlist_full: 409,
};

/** One booking write a gym at a time in this process. The database's lock is what makes a
 *  booking safe, across every server; this only keeps the requests waiting for that lock
 *  from each holding one of the api's few database connections while they wait, which
 *  kept every other gym waiting (`tools/measure-bookings-cost.ts`). */
export type Line = <T>(gymId: string, work: () => Promise<T>) => Promise<T>;
/** One line a server: made where the routes are registered, never shared between two. */
export function createLine(): Line {
  const lines = new Map<string, Promise<void>>();
  return async (gymId, work) => {
    const mine = (lines.get(gymId) ?? Promise.resolve()).then(work);
    const tail = mine.then(
      () => undefined,
      () => undefined,
    );
    lines.set(gymId, tail);
    try {
      return await mine;
    } finally {
      if (lines.get(gymId) === tail) lines.delete(gymId);
    }
  };
}

/** Which membership covers a person for a class, by the rule. */
async function coverFor(
  sql: Sql | TransactionSql,
  gymId: string,
  ctx: Pick<repo.BookingContext, "session" | "gymHasTypes">,
  entryId: string | null,
): Promise<Cover> {
  const held = ctx.gymHasTypes && entryId !== null ? await repo.coversOf(sql, gymId, entryId, ctx.session) : [];
  return pickCover({ gymHasTypes: ctx.gymHasTypes, openGym: ctx.session.openGym, classDay: ctx.session.localDate, held });
}

const mineOf = (ctx: repo.BookingContext): "booked" | "waitlisted" | null =>
  ctx.latest?.status === "booked" || ctx.latest?.status === "waitlisted" ? ctx.latest.status : null;

/** While the rule says a free place goes to the waitlist by itself, the first in line who
 *  may book is given it, and so on down the line. Under the gym's lock and the class's.
 *  Answers how many were moved in. */
async function handOver(tx: TransactionSql, gymId: string, ctx: repo.BookingContext, now: Date): Promise<number> {
  const time = bookingTime(now.getTime(), ctx.session.startsAt.getTime(), ctx.settings);
  let booked = ctx.counts.booked;
  const free = () => handsOverNow({ time, cancelled: ctx.session.cancelled, places: ctx.session.places, booked });
  if (ctx.counts.waitlisted === 0 || !free()) return 0;
  let moved = 0;
  for (const waiting of await repo.waitlistOf(tx, gymId, ctx.session.id)) {
    if (!free()) break;
    const booker = await repo.bookerOf(tx, gymId, waiting.userId);
    if (booker === null) continue;
    const cover = await coverFor(tx, gymId, ctx, booker.entryId);
    if (!cover.ok) continue;
    if (cover.chargePack && cover.membershipId !== null && !(await chargePack(tx, gymId, cover.membershipId, now))) {
      throw new Error("a pack the rule chose had no class left");
    }
    await repo.moveIn(tx, {
      gymId,
      bookingId: waiting.id,
      entryId: booker.entryId,
      heldMembershipId: cover.membershipId,
      packCharged: cover.chargePack,
      now,
    });
    booked += 1;
    moved += 1;
  }
  return moved;
}

/** One class as this person sees it now. */
async function viewOf(deps: Pick<BookingsDeps, "sql" | "now">, gymId: string, sessionId: string, userId: string): Promise<ClassBookingView> {
  const ctx = await repo.contextOf(deps.sql, gymId, sessionId, userId, false);
  if (ctx === null) throw classNotFound();
  if (ctx.booker === null) throw notFound();
  const { session, settings, counts, latest } = ctx;
  const time = bookingTime(deps.now().getTime(), session.startsAt.getTime(), settings);
  const mine = mineOf(ctx);
  const cover = await coverFor(deps.sql, gymId, ctx, ctx.booker.entryId);
  const ask = (joinWaitlist: boolean) =>
    decideBook({ time, cancelled: session.cancelled, places: session.places, ...counts, waitlistMax: settings.waitlistMax, mine, joinWaitlist, cover });
  const book = ask(false);
  const wait = ask(true);
  const cancel = decideCancel({ time, cancelled: session.cancelled, mine, packCharged: latest?.packCharged ?? false, lateOk: true });
  const startsAt = session.startsAt.getTime();
  return classBookingViewSchema.parse({
    sessionId: session.id,
    className: session.className,
    localDate: session.localDate,
    localStartMinute: session.localStartMinute,
    timezone: settings.timezone,
    startsAt: session.startsAt.toISOString(),
    minutes: session.minutes,
    cancelled: session.cancelled,
    places: session.places,
    booked: counts.booked,
    waitlisted: counts.waitlisted,
    opensAt: new Date(startsAt - settings.opensDays * 24 * 60 * 60_000).toISOString(),
    freeCancelUntil: new Date(startsAt - settings.freeCancelMinutes * 60_000).toISOString(),
    mine:
      latest === null
        ? null
        : {
            status: latest.status,
            waitlistPlace: latest.status === "waitlisted" ? await repo.waitlistPlace(deps.sql, gymId, sessionId, latest.seq) : null,
            packCharged: latest.packCharged,
          },
    can: {
      book: book.kind === "book" && !book.fromWaitlist,
      joinWaitlist: wait.kind === "waitlist",
      claim: book.kind === "book" && book.fromWaitlist,
      cancel: cancel.kind === "cancel" ? (cancel.status === "cancelled" ? "free" : "late") : null,
      why: wait.kind === "refuse" ? wait.reason : null,
    },
  });
}

export async function getBooking(deps: Pick<BookingsDeps, "sql" | "now">, userId: string, gymId: string, sessionId: string, limit: Limit): Promise<ClassBookingView | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  return await viewOf(deps, gymId, sessionId, userId);
}

/** Book, Join waitlist and Claim. */
export async function book(
  deps: BookingsDeps,
  userId: string,
  gymId: string,
  sessionId: string,
  req: BookClassRequest,
  limit: Limit,
): Promise<ClassBookingView | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;

  // A "no" needs no lock: what is read here was true a moment ago, and only a place GIVEN
  // has to be decided under the lock. So a full class, or a tap by somebody who may not
  // book, never makes the gym's other bookings wait.
  const [seen, sent] = await Promise.all([repo.contextOf(deps.sql, gymId, sessionId, userId, false), repo.byKey(deps.sql, gymId, req.requestKey)]);
  if (seen === null) throw classNotFound();
  if (seen.booker === null) throw notFound();
  if (sent === null) {
    const first = decideBook({
      time: bookingTime(deps.now().getTime(), seen.session.startsAt.getTime(), seen.settings),
      cancelled: seen.session.cancelled,
      places: seen.session.places,
      ...seen.counts,
      waitlistMax: seen.settings.waitlistMax,
      mine: mineOf(seen),
      joinWaitlist: req.joinWaitlist,
      cover: await coverFor(deps.sql, gymId, seen, seen.booker.entryId),
    });
    if (first.kind === "refuse") throw new OrgsError(STATUS[first.reason], first.reason, CLASS_BOOKING_WORDS[first.reason]);
  }

  // A refusal is carried out of the transaction, so a place handed over inside it is kept.
  const refused = await deps.inLine(gymId, () =>
    deps.sql.begin(async (tx): Promise<OrgsError | null> => {
      await lockOrgRow(tx, gymId);
      let ctx = await repo.contextOf(tx, gymId, sessionId, userId, true);
      if (ctx === null) return classNotFound();

      // The same request again: the booking it made stands as it is now, and nothing is added.
      const again = await repo.byKey(tx, gymId, req.requestKey);
      if (again !== null) {
        if (again.userId === userId && again.sessionId === sessionId) return null;
        return new OrgsError(409, "request_reused", CLASS_BOOKING_WORDS.request_reused);
      }
      if (ctx.booker === null) return notFound();
      const now = deps.now();
      // The waitlist first: outside the hand-over time a free place is the first in line's.
      if ((await handOver(tx, gymId, ctx, now)) > 0) {
        ctx = await repo.contextOf(tx, gymId, sessionId, userId, false);
        if (ctx === null || ctx.booker === null) throw new Error("a class or its booker went while both were held");
      }
      const { booker, latest } = ctx;
      const mine = mineOf(ctx);
      // A class they came to, or missed, is not booked a second time.
      if (latest !== null && mine === null && CLASS_BOOKING_HOLDS_PLACE.some((s) => s === latest.status)) return null;
      const decision = decideBook({
        time: bookingTime(now.getTime(), ctx.session.startsAt.getTime(), ctx.settings),
        cancelled: ctx.session.cancelled,
        places: ctx.session.places,
        ...ctx.counts,
        waitlistMax: ctx.settings.waitlistMax,
        mine,
        joinWaitlist: req.joinWaitlist,
        cover: await coverFor(tx, gymId, ctx, booker.entryId),
      });
      switch (decision.kind) {
        case "already":
          return null;
        case "refuse":
          return new OrgsError(STATUS[decision.reason], decision.reason, CLASS_BOOKING_WORDS[decision.reason]);
        case "waitlist":
          await repo.insertBooking(tx, {
            gymId,
            sessionId,
            userId,
            entryId: booker.entryId,
            requestKey: req.requestKey,
            status: "waitlisted",
            heldMembershipId: null,
            packCharged: false,
            now,
          });
          return null;
        case "book": {
          if (decision.chargePack && decision.membershipId !== null && !(await chargePack(tx, gymId, decision.membershipId, now))) {
            throw new Error("a pack the rule chose had no class left");
          }
          if (decision.fromWaitlist && latest !== null) {
            await repo.moveIn(tx, {
              gymId,
              bookingId: latest.id,
              entryId: booker.entryId,
              heldMembershipId: decision.membershipId,
              packCharged: decision.chargePack,
              now,
            });
          } else {
            await repo.insertBooking(tx, {
              gymId,
              sessionId,
              userId,
              entryId: booker.entryId,
              requestKey: req.requestKey,
              status: "booked",
              heldMembershipId: decision.membershipId,
              packCharged: decision.chargePack,
              now,
            });
          }
          return null;
        }
      }
    }),
  );
  if (refused !== null) throw refused;
  return await viewOf(deps, gymId, sessionId, userId);
}

/** The 409 a cancel answers when it is past the free time and the person has not said yes
 *  to a late cancel: `packCharged` says whether their pack keeps the class. */
export class LateCancel extends Error {
  readonly packCharged: boolean;
  constructor(packCharged: boolean) {
    super(packCharged ? CLASS_BOOKING_WORDS.late_cancel_pack : CLASS_BOOKING_WORDS.late_cancel);
    this.name = CLASS_LATE_CANCEL_ERROR;
    this.packCharged = packCharged;
  }
}

/** Cancel a booking, or leave the waitlist. A cancel sent again finds it done. */
export async function cancel(
  deps: BookingsDeps,
  userId: string,
  gymId: string,
  sessionId: string,
  lateOk: boolean,
  limit: Limit,
): Promise<ClassBookingView | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const refused = await deps.inLine(gymId, () =>
    deps.sql.begin(async (tx): Promise<OrgsError | LateCancel | null> => {
      await lockOrgRow(tx, gymId);
      const ctx = await repo.contextOf(tx, gymId, sessionId, userId, true);
      if (ctx === null) return classNotFound();
      const { latest } = ctx;
      if (latest?.status === "cancelled" || latest?.status === "late_cancelled") return null;
      const now = deps.now();
      const decision = decideCancel({
        time: bookingTime(now.getTime(), ctx.session.startsAt.getTime(), ctx.settings),
        cancelled: ctx.session.cancelled,
        mine: mineOf(ctx),
        packCharged: latest?.packCharged ?? false,
        lateOk,
      });
      if (decision.kind === "refuse") {
        if (decision.reason === "late_cancel") return new LateCancel(latest?.packCharged ?? false);
        // A class they came to or missed is over, as one that has started is.
        if (decision.reason === "class_started" || latest !== null) {
          return new OrgsError(409, "class_started", CLASS_BOOKING_WORDS.cancel_started);
        }
        return new OrgsError(404, "no_booking", CLASS_BOOKING_WORDS.no_booking);
      }
      if (latest === null) throw new Error("a cancel was decided with no booking");
      await repo.markCancelled(tx, {
        gymId,
        bookingId: latest.id,
        status: decision.status,
        packCharged: latest.packCharged && !decision.refundPack,
        now,
      });
      if (decision.refundPack && latest.heldMembershipId !== null) await givePackClassBack(tx, gymId, latest.heldMembershipId, now);
      if (decision.freesPlace) {
        await handOver(tx, gymId, { ...ctx, counts: { ...ctx.counts, booked: ctx.counts.booked - 1 } }, now);
      }
      return null;
    }),
  );
  if (refused !== null) throw refused;
  return await viewOf(deps, gymId, sessionId, userId);
}

/** A class's list for staff holding `schedule.manage`, or for the class's own coach. */
export async function getSessionBookings(
  deps: Pick<BookingsDeps, "sql">,
  staffId: string,
  gymId: string,
  sessionId: string,
  limit: Limit,
): Promise<ClassSessionBookingsResponse | null> {
  const [org, authority] = await Promise.all([getOrgById(deps.sql, gymId), getStaffAuthority(deps.sql, gymId, staffId)]);
  if (org === null || authority === null) throw notFound();
  const manages = await holdsPrivilege(deps, gymId, staffId, "schedule.manage");
  const session = await repo.sessionById(deps.sql, gymId, sessionId, false);
  if (!manages && (session === null || session.coachUserId !== staffId)) {
    throw new OrgsError(403, "forbidden", "Your role doesn't allow that.");
  }
  if (!(await limit())) return null;
  if (session === null) throw classNotFound();
  const [booked, waitlisted, late, lateTotal] = await Promise.all([
    repo.staffList(deps.sql, gymId, sessionId, CLASS_BOOKING_HOLDS_PLACE, 1000),
    repo.staffList(deps.sql, gymId, sessionId, ["waitlisted"], 1000),
    repo.staffList(deps.sql, gymId, sessionId, ["late_cancelled"], CLASS_BOOKINGS_LATE_SHOWN),
    repo.countStatus(deps.sql, gymId, sessionId, "late_cancelled"),
  ]);
  const shown = (rows: repo.StaffBookingRow[]): StaffClassBooking[] =>
    rows.map((r) => {
      const named = fullName(r);
      return {
        bookingId: r.bookingId,
        name: named.name,
        initials: named.name === null ? "" : named.initials,
        status: r.status,
        membership: r.membership,
        packCharged: r.packCharged,
        at: r.at.toISOString(),
      };
    });
  return classSessionBookingsResponseSchema.parse({
    sessionId: session.id,
    className: session.className,
    startsAt: session.startsAt.toISOString(),
    cancelled: session.cancelled,
    places: session.places,
    booked: shown(booked),
    waitlisted: shown(waitlisted),
    lateCancelled: shown(late),
    lateCancelledTotal: lateTotal,
  });
}
