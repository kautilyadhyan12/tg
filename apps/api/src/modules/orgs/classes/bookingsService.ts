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
  CLASS_BOOKINGS_ENDING_PAGE,
  CLASS_BOOKINGS_LATE_SHOWN,
  CLASS_BOOKING_HOLDS_PLACE,
  CLASS_BOOKING_WORDS,
  CLASS_LATE_CANCEL_ERROR,
  CLASS_MARK_WORDS,
  MEMBER_CLASSES_MAX,
  addDays,
  bookingTime,
  classBookingSettingsResponseSchema,
  classBookingViewSchema,
  classBookingsEndingResponseSchema,
  classSessionBookingsResponseSchema,
  decideBook,
  decideCancel,
  decideClassMark,
  memberClassesResponseSchema,
  type BookClassRequest,
  type BookingTime,
  type ClassBookRefusal,
  type BookingSettingsBody,
  type ClassBookingSettingsResponse,
  type ClassBookingView,
  type ClassBookingsEndingQuery,
  type ClassBookingsEndingResponse,
  type ClassSessionBookingsResponse,
  type Cover,
  type HeldCover,
  type MemberClassesQuery,
  type MarkClassBookingRequest,
  type MemberClassesResponse,
  type StaffClassBooking,
} from "@app/shared";
import { getOrgById, getStaffAuthority, gymHasLivePlan, insertAudit, isLiveMember, lockOrgRow, type OrgRow } from "../repo.js";
import { OrgsError, holdsPrivilege, requirePrivilege, requireWritableGym, requireWritablePrivilege } from "../service.js";
import { dayInTz } from "../../gamification/streak.js";
import { fullName } from "../leaderboard/rank.js";
import { chargePack, givePackClassBack } from "../memberships/heldRepo.js";
import { handOver, handOverComing, handOverPlan, handsOverTo, pick, planHandOver, type HandOverPlan } from "./bookingChanges.js";
import { handOverComingEvents } from "../events/places.js";
import * as repo from "./bookingsRepo.js";
import { endingPerson } from "./service.js";

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
export async function requireMember(deps: Pick<BookingsDeps, "sql">, gymId: string, userId: string): Promise<OrgRow> {
  const [org, member, live] = await Promise.all([
    getOrgById(deps.sql, gymId),
    isLiveMember(deps.sql, gymId, userId),
    gymHasLivePlan(deps.sql, gymId),
  ]);
  if (org === null || !member || !live) throw notFound();
  return org;
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
  if (!ctx.gymHasTypes || entryId === null) return pick(ctx, []);
  return pick(ctx, (await repo.coversOf(sql, gymId, [entryId], ctx.session)).get(entryId) ?? []);
}

const mineOf = (ctx: repo.BookingContext): "booked" | "waitlisted" | null =>
  ctx.latest?.status === "booked" || ctx.latest?.status === "waitlisted" ? ctx.latest.status : null;

/** What a cancel is asked about. A place a check-in marked came before the class starts
 *  is still the booked place it was: theirs to cancel by the usual rule, free or late. */
const cancellable = (ctx: repo.BookingContext, time: BookingTime): "booked" | "waitlisted" | null =>
  ctx.latest?.status === "attended" && time.phase !== "started" ? "booked" : mineOf(ctx);

/** One class as this person sees it now. Somebody who stopped being a member in the
 *  instant after their booking was made is still answered, with nothing they can do. */
async function viewOf(deps: Pick<BookingsDeps, "sql" | "now">, gymId: string, sessionId: string, userId: string): Promise<ClassBookingView> {
  const ctx = await repo.contextOf(deps.sql, gymId, sessionId, userId, false);
  if (ctx === null) throw classNotFound();
  const now = deps.now();
  return classBookingViewSchema.parse(
    await viewFrom(deps.sql, gymId, ctx, userId, now, {
      cover: (entryId) => coverFor(deps.sql, gymId, ctx, entryId),
      plan: () => handOverPlan(deps.sql, gymId, ctx, now),
    }),
  );
}

/** The view of one class from what was read about it, for the caller to parse. `read`:
 *  which membership covers this person for it, and who its free places are about to be
 *  handed to, each read now or already. */
async function viewFrom(
  sql: Sql,
  gymId: string,
  ctx: repo.BookingContext,
  userId: string,
  now: Date,
  read: { cover: (entryId: string | null) => Promise<Cover>; plan: () => Promise<HandOverPlan> },
): Promise<ClassBookingView> {
  const { session, settings, counts, latest, booker } = ctx;
  const time = bookingTime(now.getTime(), session.startsAt.getTime(), settings);
  const mine = mineOf(ctx);
  // A free place the waitlist is about to be handed is taken, for everybody but the
  // person it is going to: anybody's Book would hand it over first.
  const plan = mine !== "booked" && booker !== null ? await read.plan() : null;
  const promised = plan === null ? 0 : plan.moves.filter((move) => move.waiter.userId !== userId).length;
  // Somebody waiting who is not handed a place is covered by what their record has left
  // once the people ahead have theirs.
  const left = mine === "waitlisted" && promised === plan?.moves.length && booker?.entryId != null ? plan.covers.get(booker.entryId) : undefined;
  const cover: Cover =
    booker === null ? { ok: false, reason: "no_membership" } : left !== undefined ? pick(ctx, left) : await read.cover(booker.entryId);
  const ask = (joinWaitlist: boolean) =>
    decideBook({
      time,
      cancelled: session.cancelled,
      places: session.places,
      booked: counts.booked + promised,
      waitlisted: counts.waitlisted - promised,
      waitlistMax: settings.waitlistMax,
      mine,
      joinWaitlist,
      cover,
    });
  const book = ask(false);
  const wait = ask(true);
  const cancel = decideCancel({ time, cancelled: session.cancelled, mine: cancellable(ctx, time), packCharged: latest?.packCharged ?? false, lateOk: true });
  const startsAt = session.startsAt.getTime();
  // Marked came (a check-in before the class does it) or no-show: the place is theirs
  // already, so there is nothing to book, wait for or claim.
  const marked = latest?.status === "attended" || latest?.status === "no_show";
  const member = booker !== null && !marked;
  return {
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
            waitlistPlace: latest.status === "waitlisted" ? await repo.waitlistPlace(sql, gymId, session.id, latest.seq) : null,
            packCharged: latest.packCharged,
          },
    can: {
      book: member && book.kind === "book" && !book.fromWaitlist,
      joinWaitlist: member && wait.kind === "waitlist",
      claim: member && book.kind === "book" && book.fromWaitlist,
      cancel: booker !== null && cancel.kind === "cancel" ? (cancel.status === "cancelled" ? "free" : "late") : null,
      why: member && wait.kind === "refuse" ? wait.reason : null,
    },
  };
}
export async function getBooking(deps: Pick<BookingsDeps, "sql" | "now">, userId: string, gymId: string, sessionId: string, limit: Limit): Promise<ClassBookingView | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  return await viewOf(deps, gymId, sessionId, userId);
}

/** A week of the gym's coming classes, each as one class's own read answers it. The
 *  person's memberships are read once for the whole page, not once a class, and so are the
 *  waitlists of the classes with a free place to hand over, with their people's. */
export async function getMemberClasses(
  deps: Pick<BookingsDeps, "sql" | "now">,
  userId: string,
  gymId: string,
  query: MemberClassesQuery,
  limit: Limit,
): Promise<MemberClassesResponse | null> {
  const { timezone } = await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const now = deps.now();
  const from = addDays(dayInTz(now, timezone), query.week * 7);
  const to = addDays(from, 6);
  const read = await repo.comingContexts(deps.sql, gymId, userId, { now, from, to, limit: MEMBER_CLASSES_MAX + 1 });
  const contexts = read.slice(0, MEMBER_CLASSES_MAX);
  // Every class answers the same person, so the same record.
  const record = contexts.find((ctx) => ctx.gymHasTypes)?.booker?.entryId ?? null;
  const reader = record === null ? [] : [record];
  const own = await repo.coversOfClasses(deps.sql, gymId, contexts.map((ctx) => ctx.session), () => reader);
  // The classes whose free place the waitlist is about to be handed, as one class's read
  // asks it (`viewFrom`): their lines, and the memberships of the people on them.
  const handing = contexts.filter((ctx) => mineOf(ctx) !== "booked" && ctx.booker !== null && handsOverTo(ctx, now));
  const lines = await repo.waitlistsOf(deps.sql, gymId, handing.map((ctx) => ctx.session.id));
  const typed = contexts.some((ctx) => ctx.gymHasTypes);
  // Memberships are read for as many people at the head of each line as the class has
  // free places, and further down a line only where somebody at its head is passed over.
  const freeIn = (ctx: repo.BookingContext): number => (ctx.session.places === null ? Infinity : ctx.session.places - ctx.counts.booked);
  const depth = new Map(handing.map((ctx) => [ctx.session.id, freeIn(ctx)]));
  const head = (sessionId: string): repo.Waiter[] => (lines.get(sessionId) ?? []).slice(0, depth.get(sessionId));
  const plans = new Map<string, HandOverPlan>();
  for (let todo = handing; todo.length > 0; ) {
    const theirs = await repo.coversOfClasses(deps.sql, gymId, todo.map((ctx) => ctx.session), (sessionId) =>
      typed ? head(sessionId).flatMap((w) => w.booker?.entryId ?? []) : [],
    );
    const further: repo.BookingContext[] = [];
    for (const ctx of todo) {
      const { id } = ctx.session;
      const read = head(id);
      const plan = planHandOver(ctx, now, read, new Map(theirs.get(id)));
      plans.set(id, plan);
      if (plan.moves.length < freeIn(ctx) && read.length < (lines.get(id) ?? []).length) {
        depth.set(id, read.length * 2);
        further.push(ctx);
      }
    }
    todo = further;
  }
  const classes: ClassBookingView[] = [];
  for (const ctx of contexts) {
    const { id } = ctx.session;
    classes.push(
      await viewFrom(deps.sql, gymId, ctx, userId, now, {
        cover: (entryId) => Promise.resolve(pick(ctx, !ctx.gymHasTypes || entryId === null ? [] : (own.get(id)?.get(entryId) ?? []))),
        plan: () => Promise.resolve(plans.get(id) ?? { moves: [], covers: new Map<string, HeldCover[]>() }),
      }),
    );
  }
  return memberClassesResponseSchema.parse({ week: query.week, from, to, timezone, classes, more: read.length > MEMBER_CLASSES_MAX });
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
              claimKey: req.requestKey,
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
      const time = bookingTime(now.getTime(), ctx.session.startsAt.getTime(), ctx.settings);
      const decision = decideCancel({
        time,
        cancelled: ctx.session.cancelled,
        mine: cancellable(ctx, time),
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
  deps: Pick<BookingsDeps, "sql" | "now">,
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
  const opens = await holdsPrivilege(deps, gymId, staffId, "members.confirm");
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
        // What a person pays with is for staff who run the timetable, not for a coach's list.
        membership: manages ? r.membership : null,
        packCharged: manages ? r.packCharged : null,
        // The way to a person's page, for staff who may open it.
        entryId: opens ? r.entryId : null,
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
    canMark: !session.cancelled && deps.now().getTime() >= session.startsAt.getTime(),
  });
}

/** Staff mark one person's place came or no-show, once the class has started: whoever
 *  runs the timetable, and the class's own coach. The same mark again changes nothing,
 *  and a mark can be changed to the other, the one a check-in or the end of the class
 *  made too. The class stays used either way, so no pack and no limit moves. Answers the
 *  class's list as it now is. */
export async function markBooking(
  deps: Pick<BookingsDeps, "sql" | "now">,
  staffId: string,
  gymId: string,
  sessionId: string,
  bookingId: string,
  req: MarkClassBookingRequest,
  limit: Limit,
): Promise<ClassSessionBookingsResponse | null> {
  const [org, authority] = await Promise.all([getOrgById(deps.sql, gymId), getStaffAuthority(deps.sql, gymId, staffId)]);
  if (org === null || authority === null) throw notFound();
  const manages = await holdsPrivilege(deps, gymId, staffId, "schedule.manage");
  // Whose class it is decides who may mark it, so it is read before the lock.
  const seen = await repo.sessionById(deps.sql, gymId, sessionId, false);
  if (!manages && (seen === null || seen.coachUserId !== staffId)) {
    throw new OrgsError(403, "forbidden", "Your role doesn't allow that.");
  }
  await requireWritableGym(deps, org);
  if (!(await limit())) return null;
  if (seen === null) throw classNotFound();

  const refused = await deps.sql.begin(async (tx): Promise<OrgsError | null> => {
    await lockOrgRow(tx, gymId);
    const session = await repo.sessionById(tx, gymId, sessionId, true);
    if (session === null) return classNotFound();
    const booking = await repo.bookingInClass(tx, gymId, sessionId, bookingId);
    if (booking === null) return new OrgsError(404, "booking_not_found", CLASS_MARK_WORDS.booking_not_found);
    const decision = decideClassMark({
      status: booking.status,
      cancelled: session.cancelled,
      started: deps.now().getTime() >= session.startsAt.getTime(),
      to: req.status,
    });
    if (decision.kind === "already") return null;
    if (decision.kind === "refuse") return new OrgsError(409, decision.reason, CLASS_MARK_WORDS[decision.reason]);
    await repo.markAs(tx, gymId, [booking.id], req.status, ["booked", "attended", "no_show"]);
    await insertAudit(tx, {
      actorUserId: staffId,
      gymId,
      action: "org.class_booking_marked",
      targetType: "gym_class_booking",
      targetId: booking.id,
      meta: { status: req.status, was: booking.status },
    });
    return null;
  });
  if (refused !== null) throw refused;
  return await getSessionBookings(deps, staffId, gymId, sessionId, () => Promise.resolve(true));
}

/** Everybody whose booking a change to the timetable would end, a page at a time, for
 *  staff holding `schedule.manage`: the list behind the box's "See all". */
export async function getEndingBookings(
  deps: Pick<BookingsDeps, "sql" | "now">,
  staffId: string,
  gymId: string,
  query: ClassBookingsEndingQuery,
  limit: Limit,
): Promise<ClassBookingsEndingResponse | null> {
  await requirePrivilege(deps, gymId, staffId, "schedule.manage");
  if (!(await limit())) return null;
  const scope: repo.EndingScope =
    query.by === "slot" ? { by: "slot", id: query.id, from: query.from ?? null } : { by: query.by, id: query.id };
  const where = { scope, now: deps.now() };
  const [counts, rows] = await Promise.all([
    repo.endingCounts(deps.sql, gymId, where),
    repo.endingPeople(deps.sql, gymId, where, query.after ?? null, CLASS_BOOKINGS_ENDING_PAGE + 1),
  ]);
  const page = rows.slice(0, CLASS_BOOKINGS_ENDING_PAGE);
  const last = page[page.length - 1];
  return classBookingsEndingResponseSchema.parse({
    ...counts,
    people: page.map(endingPerson),
    next: rows.length > CLASS_BOOKINGS_ENDING_PAGE && last !== undefined ? last.bookingId : null,
  });
}

/** The gym's four booking settings and personal training's two, for staff holding
 *  `schedule.manage`. */
export async function getBookingSettings(
  deps: Pick<BookingsDeps, "sql">,
  staffId: string,
  gymId: string,
  limit: Limit,
): Promise<ClassBookingSettingsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, "schedule.manage");
  if (!(await limit())) return null;
  const rules = await repo.readSettings(deps.sql, gymId);
  if (rules === null) throw notFound();
  return classBookingSettingsResponseSchema.parse(rules);
}

/** The settings changed. They are read at each booking, so they hold for every class
 *  from now; no booking already made is touched, and a waitlist longer than a new, lower
 *  limit keeps everybody on it. A hand-over time made shorter can make free places the
 *  waitlist's at once, so those are handed over here. Personal training's two are read at
 *  each booking and each cancel of a session, under this same lock. */
export async function setBookingSettings(
  deps: Pick<BookingsDeps, "sql" | "now">,
  staffId: string,
  gymId: string,
  body: BookingSettingsBody,
  limit: Limit,
): Promise<(ClassBookingSettingsResponse & { movedIn: number }) | null> {
  await requireWritablePrivilege(deps, gymId, staffId, "schedule.manage");
  if (!(await limit())) return null;
  const { pt, ...settings } = body;
  let movedIn = 0;
  const saved = await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const before = await repo.readSettings(tx, gymId);
    if (before === null) return null;
    const keys = ["opensDays", "freeCancelMinutes", "handoverMinutes", "waitlistMax"] as const;
    const ptKeys = ["opensDays", "freeCancelMinutes"] as const;
    const changed = keys.filter((k) => before.settings[k] !== settings[k]);
    const ptChanged = ptKeys.filter((k) => before.pt[k] !== pt[k]);
    if (changed.length === 0 && ptChanged.length === 0) return before;
    await repo.writeSettings(tx, gymId, { settings, pt });
    await insertAudit(tx, {
      actorUserId: staffId,
      gymId,
      action: "org.booking_settings_changed",
      targetType: "gym",
      targetId: gymId,
      meta: Object.fromEntries<string>([
        ...changed.map((k): [string, string] => [k, `${String(before.settings[k])} -> ${String(settings[k])}`]),
        ...ptChanged.map((k): [string, string] => [`pt.${k}`, `${String(before.pt[k])} -> ${String(pt[k])}`]),
      ]),
    });
    if (settings.handoverMinutes < before.settings.handoverMinutes) {
      movedIn = await handOverComing(tx, gymId, deps.now());
      // An event's waitlist is handed over by the same setting (19c-ii).
      movedIn += await handOverComingEvents(tx, gymId, deps.now());
    }
    return { settings, pt };
  });
  if (saved === null) throw notFound();
  return { ...classBookingSettingsResponseSchema.parse(saved), movedIn };
}
