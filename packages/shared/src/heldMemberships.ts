// A PERSON'S MEMBERSHIP — Part 3 §13.2; ROADMAP Stage 2 item 17a-ii.
//
// A gym's record of a person holds memberships, each given from one line of the
// price list (`memberships.ts`). This file is the ONE rule that says what a held
// membership is on a given day: `heldMembershipView` reads it, `moveHeldMembership`
// changes it. Both are pure: the day is passed in (the gym's own, from the server's
// clock), and nothing here reads a clock.
//
// Days are 'YYYY-MM-DD' calendar days with no time and no zone.
//
// What is stored, and what is worked out:
//   `frozenDays`   how many days it has been frozen, in all. Periods are counted from
//                  the start day in the type's own unit, and these days are added
//                  AFTER that, so every later date moves by exactly the days frozen
//                  (moving the start instead loses days at a month's end). One taken
//                  from the gym's list (`linkHeldMembership`) also counts here the
//                  days its list's day sits past the type's own term;
//   `giftDays`     free days given by Refer a friend (20e-ii-b-ii-b), added to period
//   `giftFrom`     `giftFrom` and every one after it: the end of the period the member
//                  is in, or of what they have paid, moves later, and nothing before it
//                  moves. Once a later gift finds that period begun, they are folded
//                  into `frozenDays` (`addGiftDays`);
//   `paidPeriods`  how many periods are marked paid. A repeating membership is paid
//                  up to the start of that period; any other kind has one period;
//   `paidFloor`    the count it was given with for the periods before it was given:
//                  a mark is never taken back below it;
//   `renews`       false once staff cancelled a repeating membership at the end of
//                  what is paid;
//   the end day, the renewal day and what is owed are worked out from those.
import { z } from "zod";
import {
  membershipKindSchema,
  membershipTermUnitSchema,
  type MembershipKind,
  type MembershipTermUnit,
} from "./memberships.js";
import { confirmPtSessionsField } from "./ptSessionsEnding.js";
import { MEMBERSHIP_PAYMENTS, gymDiscountSchema } from "./discounts.js";
import { friendGiftSchema } from "./friendGift.js";
import { GIFT_DAYS_MAX, memberGiftSchema } from "./memberGift.js";
import { memberBillingSchema, memberPaymentByHandSchema } from "./memberBills.js";

export const HELD_MEMBERSHIP_STATUSES = ["active", "frozen", "ended", "cancelled"] as const;
export const heldMembershipStatusSchema = z.enum(HELD_MEMBERSHIP_STATUSES);
export type HeldMembershipStatus = z.infer<typeof heldMembershipStatusSchema>;

/** What a screen shows: the stored four, and `upcoming` for one that has not started. */
export const HELD_MEMBERSHIP_SHOWN = ["upcoming", ...HELD_MEMBERSHIP_STATUSES] as const;
export const heldMembershipShownSchema = z.enum(HELD_MEMBERSHIP_SHOWN);
export type HeldMembershipShown = z.infer<typeof heldMembershipShownSchema>;

/** How many memberships one record can have running, frozen or still to start. */
export const HELD_LIVE_MAX = 20;
/** How many of the ones that are over a page shows, newest first. A regular buying a day
 *  pass a visit has hundreds. */
export const HELD_EARLIER_PAGE = 30;
/** How far ahead of today a repeating membership can be marked paid. */
export const HELD_PAID_AHEAD_MAX = 12;
export const HELD_START_MIN = "2000-01-01";
/** A start day at most this many days after today. */
export const HELD_START_AHEAD_DAYS = 366;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_A_DAY = 86_400_000;

/** The digits of `day` from `from` up to `to` as a number; -1 where one is not a digit. */
function digits(day: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = day.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return -1;
    n = n * 10 + c;
  }
  return n;
}

/** The year, month and day of a 'YYYY-MM-DD' text, or null where it is not written so.
 *  Read by position: a list of a gym's people asks this of every membership on it. */
function parts(day: string): [number, number, number] | null {
  if (day.length !== 10 || day.charCodeAt(4) !== 45 || day.charCodeAt(7) !== 45) return null;
  const y = digits(day, 0, 4);
  const m = digits(day, 5, 7);
  const d = digits(day, 8, 10);
  return y < 0 || m < 0 || d < 0 ? null : [y, m, d];
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");
const dayOf = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

/** The days in a month; `month` is 1 to 12. */
function monthLength(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether the text is a day the calendar has: "2026-02-30" is not. */
export function isCalendarDay(day: string): boolean {
  const p = parts(day);
  if (p === null) return false;
  const [y, m, d] = p;
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= monthLength(y, m);
}

/** A day as a count of days, for arithmetic. */
function ordinal(day: string): number {
  const p = parts(day);
  if (p === null) throw new Error(`not a day: ${day}`);
  return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / MS_A_DAY);
}

function fromOrdinal(n: number): string {
  const d = new Date(n * MS_A_DAY);
  return dayOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(day: string, days: number): string {
  return fromOrdinal(ordinal(day) + days);
}

/** `to` minus `from`, in days. */
export function daysBetween(from: string, to: string): number {
  return ordinal(to) - ordinal(from);
}

/** The same day of the month so many months on; where that month is shorter, its
 *  last day (31 Jan + 1 month is 28 Feb, or 29 Feb in a leap year). */
function addMonths(day: string, months: number): string {
  const p = parts(day);
  if (p === null) throw new Error(`not a day: ${day}`);
  const index = p[0] * 12 + (p[1] - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return dayOf(year, month, Math.min(p[2], monthLength(year, month)));
}

/** The day `periods` terms after `anchor`. Always counted from the anchor, never from
 *  the period before: 31 Jan, 28 Feb, 31 Mar, not 31 Jan, 28 Feb, 28 Mar. */
export function addTerms(anchor: string, count: number, unit: MembershipTermUnit, periods: number): string {
  const n = count * periods;
  switch (unit) {
    case "day":
      return addDays(anchor, n);
    case "week":
      return addDays(anchor, 7 * n);
    case "month":
      return addMonths(anchor, n);
    case "year":
      return addMonths(anchor, 12 * n);
  }
}

/** What is kept about one held membership. The term is the type's as it was when the
 *  membership was given: a later change to the type moves nobody's dates. */
export interface HeldMembership {
  kind: MembershipKind;
  termCount: number | null;
  termUnit: MembershipTermUnit | null;
  packClasses: number | null;
  packDays: number | null;
  /** Nothing to pay: the type's price was 0 when it was given. */
  free: boolean;
  startsOn: string;
  frozenDays: number;
  /** Refer a friend's free days, added to period `giftFrom` and every later one. */
  giftDays: number;
  giftFrom: number;
  status: HeldMembershipStatus;
  frozenOn: string | null;
  cancelledOn: string | null;
  paidPeriods: number;
  paidFloor: number;
  renews: boolean;
  classesLeft: number | null;
}

function term(m: HeldMembership): { count: number; unit: MembershipTermUnit } {
  if (m.kind === "pack") {
    if (m.packDays === null) throw new Error("a pack without its days");
    return { count: m.packDays, unit: "day" };
  }
  if (m.termCount === null || m.termUnit === null) throw new Error("a membership without its term");
  return { count: m.termCount, unit: m.termUnit };
}

/** The first day of period `index` (0 is the first). */
export function periodStart(m: HeldMembership, index: number): string {
  const t = term(m);
  return addDays(addTerms(m.startsOn, t.count, t.unit, index), m.frozenDays + (index >= m.giftFrom ? m.giftDays : 0));
}

/** Which period `day` falls in: 0 for the first, and 0 for a day before it starts. */
export function periodIndex(m: HeldMembership, day: string): number {
  // The day as it would be had it never been frozen nor given days, so the first guess is
  // never too high: periods are counted from the start.
  const at = addDays(day, -m.frozenDays - m.giftDays);
  const t = term(m);
  // A first guess that is never too high, then forward to the period holding the day. A day
  // before the start is in none yet, and reads as the first.
  let index = 0;
  if (at > m.startsOn) {
    const a = parts(m.startsOn);
    const d = parts(at);
    if (a === null || d === null) throw new Error("not a day");
    if (t.unit === "day" || t.unit === "week") {
      index = Math.floor(daysBetween(m.startsOn, at) / ((t.unit === "week" ? 7 : 1) * t.count));
    } else {
      const months = (d[0] - a[0]) * 12 + (d[1] - a[1]) - 1;
      index = Math.max(0, Math.floor(months / ((t.unit === "year" ? 12 : 1) * t.count)));
    }
  }
  while (periodStart(m, index + 1) <= day) index += 1;
  return index;
}

/** The day a repeating membership is paid up to: the first day not paid for. */
function paidUntil(m: HeldMembership): string {
  return periodStart(m, m.paidPeriods);
}

/** The last day it runs, or null for a repeating membership that goes on renewing. */
function lastDay(m: HeldMembership): string | null {
  if (m.kind === "recurring") return m.renews ? null : addDays(paidUntil(m), -1);
  return addDays(periodStart(m, 1), -1);
}

/** The clock alone: an active membership past its last day, or a pack with no class
 *  left, has ended. Nothing else moves by itself. */
function settle(m: HeldMembership, today: string): HeldMembership {
  if (m.status !== "active") return m;
  const last = lastDay(m);
  const over = (last !== null && today > last) || (m.kind === "pack" && m.classesLeft === 0);
  return over ? { ...m, status: "ended" } : m;
}

export const heldMembershipViewSchema = z
  .object({
    status: heldMembershipShownSchema,
    /** The last day it runs: set for one that ends, null for one that renews and for
     *  one frozen (its dates move a day for every day frozen). */
    endsOn: z.string().nullable(),
    /** The next renewal of a repeating membership that renews; null while frozen. */
    renewsOn: z.string().nullable(),
    /** What is owed, or null where there is nothing to pay or it is over. `since` is
     *  the day the payment fell due; `until` the day a repeating one is paid up to. */
    payment: z
      .discriminatedUnion("state", [
        z.object({ state: z.literal("paid"), until: z.string().nullable() }).strict(),
        z.object({ state: z.literal("due"), since: z.string().nullable() }).strict(),
      ])
      .nullable(),
    can: z
      .object({
        freeze: z.boolean(),
        unfreeze: z.boolean(),
        cancel: z.boolean(),
        /** The last day it would run if cancelled at the end of what is paid. */
        cancelAtPeriodEnd: z.string().nullable(),
        /** Mark paid: the count it moves to, and for a repeating one the day paid up to. */
        markPaid: z.object({ paidPeriods: z.number().int(), until: z.string().nullable() }).strict().nullable(),
        /** Take the last mark back. */
        undoPaid: z.object({ paidPeriods: z.number().int() }).strict().nullable(),
      })
      .strict(),
  })
  .strict();
export type HeldMembershipView = z.infer<typeof heldMembershipViewSchema>;

/** A membership's state, its dates and what is owed: `heldMembershipView` without what
 *  staff can do to it. A list of many people reads this alone. */
export type HeldMembershipFacts = Pick<HeldMembershipView, "status" | "endsOn" | "renewsOn" | "payment">;

/** What both readings of a membership the clock has been applied to work from. */
interface Settled {
  facts: HeldMembershipFacts;
  frozen: boolean;
  /** The day its dates are read on: a frozen membership's stand still at the day it was frozen. */
  asOf: string;
  upcoming: boolean;
  recurring: boolean;
  /** The day a repeating one is paid up to. */
  until: string | null;
}

function settled(m: HeldMembership, today: string): Settled {
  const frozen = m.status === "frozen";
  const asOf = frozen && m.frozenOn !== null ? m.frozenOn : today;
  const upcoming = !frozen && today < m.startsOn;
  const recurring = m.kind === "recurring";
  if (m.status === "ended" || m.status === "cancelled") {
    const last = lastDay(m);
    const facts = { status: m.status, endsOn: m.status === "cancelled" ? m.cancelledOn : last, renewsOn: null, payment: null };
    return { facts, frozen, asOf, upcoming, recurring, until: null };
  }
  const until = recurring ? paidUntil(m) : null;

  let payment: HeldMembershipView["payment"] = null;
  if (!m.free) {
    if (recurring && until !== null) {
      // Nothing marked paid is owing, from the start day where that is still to come.
      payment =
        until > asOf && m.paidPeriods > 0
          ? { state: "paid", until: frozen ? null : until }
          : { state: "due", since: frozen ? null : until };
    } else {
      payment = m.paidPeriods >= 1 ? { state: "paid", until: null } : { state: "due", since: frozen ? null : m.startsOn };
    }
  }
  const facts: HeldMembershipFacts = {
    status: upcoming ? "upcoming" : m.status,
    endsOn: frozen ? null : lastDay(m),
    renewsOn: frozen || !recurring || !m.renews ? null : periodStart(m, periodIndex(m, today) + 1),
    payment,
  };
  return { facts, frozen, asOf, upcoming, recurring, until };
}

/** What a held membership is on `today`, the gym's own day, without what staff can do. */
export function heldMembershipFacts(stored: HeldMembership, today: string): HeldMembershipFacts {
  return settled(settle(stored, today), today).facts;
}

/** Whether two memberships of ONE type would run at once for one person: both still in
 *  use on `today`, and neither over before the other starts. A frozen one, and a
 *  repeating one that renews, have no last day. Two class packs are never asked here: a
 *  second pack bought before the first runs out is an ordinary sale. */
export function sameTypeTwice(a: HeldMembership, b: HeldMembership, today: string): boolean {
  if (a.kind === "pack" || b.kind === "pack") return false;
  const [fa, fb] = [heldMembershipFacts(a, today), heldMembershipFacts(b, today)];
  const over = (status: string): boolean => status === "ended" || status === "cancelled";
  if (over(fa.status) || over(fb.status)) return false;
  return (fa.endsOn === null || fa.endsOn >= b.startsOn) && (fb.endsOn === null || fb.endsOn >= a.startsOn);
}

/** What a held membership is on `today`, the gym's own day. */
export function heldMembershipView(stored: HeldMembership, today: string): HeldMembershipView {
  const m = settle(stored, today);
  const { facts, frozen, asOf, upcoming, recurring, until } = settled(m, today);
  if (m.status === "ended" || m.status === "cancelled") {
    return { ...facts, can: { freeze: false, unfreeze: false, cancel: false, cancelAtPeriodEnd: null, markPaid: null, undoPaid: null } };
  }

  let markPaid: HeldMembershipView["can"]["markPaid"] = null;
  let undoPaid: HeldMembershipView["can"]["undoPaid"] = null;
  if (!m.free) {
    if (recurring) {
      // One that will not renew takes no further payment, and its end day stands on
      // what is paid, so a mark is not taken back either.
      if (m.renews) {
        const next = m.paidPeriods + 1;
        if (next <= periodIndex(m, asOf) + 1 + HELD_PAID_AHEAD_MAX) {
          markPaid = { paidPeriods: next, until: frozen ? null : periodStart(m, next) };
        }
        if (m.paidPeriods > m.paidFloor) undoPaid = { paidPeriods: m.paidPeriods - 1 };
      }
    } else if (m.paidPeriods === 0) {
      markPaid = { paidPeriods: 1, until: null };
    } else {
      undoPaid = { paidPeriods: 0 };
    }
  }

  return {
    ...facts,
    can: {
      freeze: m.status === "active" && !upcoming,
      unfreeze: frozen,
      cancel: true,
      cancelAtPeriodEnd:
        m.status === "active" && recurring && m.renews && m.paidPeriods > 0 && until !== null && until > today
          ? addDays(until, -1)
          : null,
      markPaid,
      undoPaid,
    },
  };
}

export type HeldMembershipEvent =
  | { type: "freeze" }
  | { type: "unfreeze" }
  /** `period_end`: a repeating membership runs to the end of what is paid, then stops. */
  | { type: "cancel"; when: "today" | "period_end" }
  /** The count of paid periods to move to: one more, or one fewer. */
  | { type: "paid"; paidPeriods: number };

export type HeldMembershipMove =
  /** `changed` false: it was already so, and nothing is to be written. */
  | { ok: true; membership: HeldMembership; changed: boolean }
  | { ok: false; reason: "not_allowed" };

/** THE ONE TRANSITION (CLAUDE.md §4, Money). The clock is applied first, so an
 *  event meets the membership as it is today; an event that asks for what is already
 *  so answers `changed: false`, so the same request arriving twice changes it once. */
export function moveHeldMembership(stored: HeldMembership, event: HeldMembershipEvent, today: string): HeldMembershipMove {
  const m = settle(stored, today);
  const settled = m !== stored;
  const same: HeldMembershipMove = { ok: true, membership: m, changed: settled };
  const refused: HeldMembershipMove = { ok: false, reason: "not_allowed" };
  const view = heldMembershipView(m, today);

  switch (event.type) {
    case "freeze":
      if (m.status === "frozen") return same;
      if (!view.can.freeze) return refused;
      return { ok: true, membership: { ...m, status: "frozen", frozenOn: today }, changed: true };

    case "unfreeze": {
      if (m.status === "active") return same;
      if (m.status !== "frozen" || m.frozenOn === null) return refused;
      // Every day frozen is given back: each later date moves by exactly that many days.
      const days = Math.max(0, daysBetween(m.frozenOn, today));
      return {
        ok: true,
        membership: { ...m, status: "active", frozenOn: null, frozenDays: m.frozenDays + days },
        changed: true,
      };
    }

    case "cancel":
      if (event.when === "period_end") {
        if (m.status === "active" && m.kind === "recurring" && !m.renews) return same;
        if (view.can.cancelAtPeriodEnd === null) return refused;
        return { ok: true, membership: { ...m, renews: false }, changed: true };
      }
      if (m.status === "cancelled") return same;
      if (!view.can.cancel) return refused;
      return { ok: true, membership: { ...m, status: "cancelled", frozenOn: null, cancelledOn: today }, changed: true };

    case "paid":
      if (event.paidPeriods === m.paidPeriods && (m.status === "active" || m.status === "frozen")) return same;
      if (view.can.markPaid?.paidPeriods === event.paidPeriods || view.can.undoPaid?.paidPeriods === event.paidPeriods) {
        return { ok: true, membership: { ...m, paidPeriods: event.paidPeriods }, changed: true };
      }
      return refused;
  }
}

/** What a type has to hold for a membership to be worked out from it. */
export interface HeldMembershipTerms {
  kind: MembershipKind;
  termCount: number | null;
  termUnit: MembershipTermUnit | null;
  packClasses: number | null;
  packDays: number | null;
  priceMinor: number;
}

export type GiveHeldMembership =
  | { ok: true; membership: HeldMembership }
  | { ok: false; reason: "start_out_of_range" | "already_over" };

/** A membership as it is when staff give it: the type's term, a start day, and whether
 *  it is paid. `paid` on a repeating membership that started earlier means paid up to
 *  the end of the period today falls in; unpaid, that period is the one owed. */
export function giveHeldMembership(type: HeldMembershipTerms, startsOn: string, paid: boolean, today: string): GiveHeldMembership {
  if (!isCalendarDay(startsOn) || startsOn < HELD_START_MIN || startsOn > addDays(today, HELD_START_AHEAD_DAYS)) {
    return { ok: false, reason: "start_out_of_range" };
  }
  const base: HeldMembership = {
    kind: type.kind,
    termCount: type.termCount,
    termUnit: type.termUnit,
    packClasses: type.packClasses,
    packDays: type.packDays,
    free: type.priceMinor === 0,
    startsOn,
    frozenDays: 0,
    giftDays: 0,
    giftFrom: 0,
    status: "active",
    frozenOn: null,
    cancelledOn: null,
    paidPeriods: 0,
    paidFloor: 0,
    renews: type.kind === "recurring",
    classesLeft: type.kind === "pack" ? type.packClasses : null,
  };
  const free = base.free;
  const current = type.kind === "recurring" ? periodIndex(base, today) : 0;
  // The periods before it was given are not this app's to ask about: they count as paid,
  // and no mark is taken back into them.
  const paidFloor = free ? 0 : current;
  const membership = { ...base, paidFloor, paidPeriods: free ? 0 : current + (paid ? 1 : 0) };
  if (settle(membership, today).status === "ended") return { ok: false, reason: "already_over" };
  return { ok: true, membership };
}

// ── A membership taken from the gym's own list (§13.2; ROADMAP 17a-iii) ─────────

/** What a gym's list says about a person's membership: its end-or-renewal day, and
 *  which of the two the gym's own heading called it. */
export interface ListMembershipDates {
  endsOn: string | null;
  endsOnKind: "ends" | "renews" | null;
}

/** A list's day further ahead than this is not taken. */
export const LINK_DAY_AHEAD_DAYS = 5 * 366;
/** How many periods back a start is looked for. Weekly, five years ahead, is 261. */
const LINK_PERIODS_MAX = 600;

/** Whether the list's day settles what is paid: `settled` (paid up, or nothing to
 *  pay), `due` (its renewal day has passed), or `ask` (the list does not say, so
 *  staff do). */
export type LinkGroup = "settled" | "due" | "ask";

export type LinkedHeldMembership =
  | { ok: true; membership: HeldMembership; group: LinkGroup }
  | { ok: false; reason: "ended_in_list" | "day_out_of_range" };

/** A membership as it is when a list's word is linked to a type: THE LIST'S DAY IS
 *  KEPT. "Renews 14 Nov" is the first day not paid for; "Ends 31 Dec" is the last
 *  day covered, so the first day not covered is the day after.
 *
 *  A repeating membership is paid up to that day; where that day has passed it owes
 *  from the period today falls in, never for the periods before it. Any other kind runs through that day, and whether it is paid is staff's
 *  answer (`paid`), as it is where the list has no day at all: such a membership
 *  starts today. A start day is worked back from the list's day and is never after
 *  today, so nobody on the list is given a membership that has not started. */
export function linkHeldMembership(
  type: HeldMembershipTerms,
  dates: ListMembershipDates,
  paid: boolean,
  today: string,
): LinkedHeldMembership {
  const free = type.priceMinor === 0;
  if (dates.endsOn === null) {
    const made = giveHeldMembership(type, today, paid, today);
    if (!made.ok) return { ok: false, reason: "day_out_of_range" };
    return { ok: true, membership: made.membership, group: free ? "settled" : "ask" };
  }
  if (!isCalendarDay(dates.endsOn)) return { ok: false, reason: "day_out_of_range" };
  // The first day the list does not cover.
  const edge = dates.endsOnKind === "renews" ? dates.endsOn : addDays(dates.endsOn, 1);
  if (edge <= HELD_START_MIN || edge > addDays(today, LINK_DAY_AHEAD_DAYS)) return { ok: false, reason: "day_out_of_range" };

  const base: HeldMembership = {
    kind: type.kind,
    termCount: type.termCount,
    termUnit: type.termUnit,
    packClasses: type.packClasses,
    packDays: type.packDays,
    free,
    startsOn: today,
    frozenDays: 0,
    giftDays: 0,
    giftFrom: 0,
    status: "active",
    frozenOn: null,
    cancelledOn: null,
    paidPeriods: 0,
    paidFloor: 0,
    renews: type.kind === "recurring",
    classesLeft: type.kind === "pack" ? type.packClasses : null,
  };
  const t = term(base);

  if (type.kind !== "recurring") {
    if (edge <= today) return { ok: false, reason: "ended_in_list" };
    // One term back from the list's day, and no later than today. Where the type's
    // own term does not reach the list's day from there, the days between are added
    // after it, as frozen days are.
    const back = addTerms(edge, t.count, t.unit, -1);
    const startsOn = back > today ? today : back;
    if (startsOn < HELD_START_MIN) return { ok: false, reason: "day_out_of_range" };
    const frozenDays = daysBetween(addTerms(startsOn, t.count, t.unit, 1), edge);
    const membership = { ...base, startsOn, frozenDays, paidPeriods: !free && paid ? 1 : 0 };
    return { ok: true, membership, group: free ? "settled" : "ask" };
  }

  // Repeating: a start day so many whole periods before the list's day, so each
  // renewal after it falls on the list's day of the month (31 Mar, 30 Apr, 31 May).
  // A month's end can cut the way back short (one month before 31 Mar is 28 Feb, and
  // one month on from that is 28 Mar), so the first start that comes back to the
  // list's day exactly is the one taken.
  let found: { startsOn: string; periods: number; frozenDays: number } | null = null;
  let nearest: { startsOn: string; periods: number; frozenDays: number } | null = null;
  for (let periods = 1; periods <= LINK_PERIODS_MAX && found === null; periods += 1) {
    const startsOn = addTerms(edge, t.count, t.unit, -periods);
    if (startsOn > today) continue;
    const short = daysBetween(addTerms(startsOn, t.count, t.unit, periods), edge);
    if (short === 0) found = { startsOn, periods, frozenDays: 0 };
    else nearest ??= { startsOn, periods, frozenDays: short };
  }
  const at = found ?? nearest;
  // No start a hand-given membership could not have either.
  if (at === null || at.startsOn < HELD_START_MIN) return { ok: false, reason: "day_out_of_range" };
  const listed = {
    ...base,
    startsOn: at.startsOn,
    frozenDays: at.frozenDays,
    paidPeriods: free ? 0 : at.periods,
    // Every period up to the list's day is the list's own fact, not a mark staff made:
    // none of them can be taken back.
    paidFloor: free ? 0 : at.periods,
  };
  // Where the list's day has passed, the periods between it and the one today falls in
  // were the gym's other software's to ask about, not this app's (Kd, RULINGS 2026-10-10):
  // the person owes from the period they are in now, as one given by hand does.
  const current = free ? 0 : periodIndex(listed, today);
  const membership = current > listed.paidPeriods ? { ...listed, paidPeriods: current, paidFloor: current } : listed;
  return { ok: true, membership, group: free || edge > today ? "settled" : "due" };
}

/** The renewal day a screen prints for a repeating membership taken from the list: the
 *  LIST's day. A person paid further ahead than one period (a year paid on a type set up
 *  as monthly) renews in the rule every period, and owes nothing until the list's day,
 *  which is the day they are paid up to: that is the day shown while it is the later. */
export function shownRenewal(view: Pick<HeldMembershipView, "renewsOn" | "payment">): string | null {
  const until = view.payment !== null && view.payment.state === "paid" ? view.payment.until : null;
  return until !== null && view.renewsOn !== null && until > view.renewsOn ? until : view.renewsOn;
}

// ── Refer a friend's free days (§16.3; ROADMAP 20e-ii-b-ii-b) ────────────────


/** The day a membership's dates are read on: a frozen one's stand still at its freeze. */
const asOfDay = (m: HeldMembership, today: string): string => (m.status === "frozen" && m.frozenOn !== null ? m.frozenOn : today);

/** FREE DAYS ADDED to a membership the person pays for and still has: at the end of the
 *  period they are in now, or of what they have paid where that is further on, so the next
 *  renewal (or the last day) moves later by `days` and nothing already begun moves. Days
 *  given earlier whose period has not begun take these with them. Days given earlier whose
 *  period has begun are folded into `frozenDays`, which moves only periods already over and
 *  paid for. `from` is the period the days go before. Null where none can be given: a free
 *  one, one that is over, or one whose earlier free days and what is paid no longer meet
 *  (paid on past where those days wait, or still owed for a period from before them), where
 *  one place for both would move a period paid for or owed. */
export function addGiftDays(stored: HeldMembership, days: number, today: string): { membership: HeldMembership; from: number } | null {
  if (!Number.isInteger(days) || days < 1 || days > GIFT_DAYS_MAX) return null;
  const m = settle(stored, today);
  if (m.free || m.status === "ended" || m.status === "cancelled") return null;
  const now = periodIndex(m, asOfDay(m, today));
  const from = m.kind === "recurring" ? Math.max(now + 1, m.paidPeriods) : 1;
  if (m.giftDays > 0 && m.giftFrom > now) {
    // Earlier days not begun take these only where both belong: what is paid may have moved
    // since, either way (round one, H1).
    return m.giftFrom === from ? { membership: { ...m, giftDays: m.giftDays + days }, from } : null;
  }
  if (m.giftDays > 0 && m.paidPeriods < m.giftFrom) return null;
  return { membership: { ...m, frozenDays: m.frozenDays + m.giftDays, giftDays: days, giftFrom: from }, from };
}

/** FREE DAYS TAKEN BACK (the friend's payment voided or refunded in full): only while the
 *  person has not reached the first of them, and only where they still go before `from`.
 *  Once they are in them, or the membership is over, they stay: null. */
export function takeBackGiftDays(stored: HeldMembership, days: number, from: number, today: string): HeldMembership | null {
  const m = settle(stored, today);
  if (m.status === "ended" || m.status === "cancelled") return null;
  if (m.giftFrom !== from || m.giftDays < days) return null;
  if (asOfDay(m, today) >= addDays(periodStart(m, from), -m.giftDays)) return null;
  return { ...m, giftDays: m.giftDays - days };
}

/** Free days on a membership cancelled before the first of them: nobody had any of them, so
 *  the gift can be taken back with the membership left as it is (the data-integrity pass
 *  over item 20, L3). */
export function giftDaysNeverReached(stored: HeldMembership, days: number, from: number, today: string): boolean {
  const m = settle(stored, today);
  if (m.status !== "cancelled" || m.cancelledOn === null) return false;
  if (m.giftFrom !== from || m.giftDays < days) return false;
  return m.cancelledOn < addDays(periodStart(m, from), -m.giftDays);
}

/** The day a membership given free days next renews on, or ends on, as the member is told;
 *  null while it is frozen, whose dates move when it is unfrozen. */
export function giftDaysNextDay(m: HeldMembership, from: number): { renews: boolean; day: string } | null {
  if (m.status === "frozen") return null;
  if (m.kind === "recurring" && m.renews) return { renews: true, day: periodStart(m, from) };
  const last = lastDay(m);
  return last === null ? null : { renews: false, day: last };
}

/** Which of a person's memberships free days go on: of those that can take them, the one
 *  whose next date (its renewal, else its last day) comes first; a frozen one after those;
 *  then the one that started first. Null where none can. */
export function giftDaysTarget<T extends { id: string; membership: HeldMembership }>(rows: readonly T[], today: string): T | null {
  const next = (m: HeldMembership): string => {
    const facts = heldMembershipFacts(m, today);
    return facts.renewsOn ?? facts.endsOn ?? "9999-12-31";
  };
  const can = rows.filter((r) => addGiftDays(r.membership, 1, today) !== null);
  can.sort(
    (a, b) =>
      (next(a.membership) < next(b.membership) ? -1 : next(a.membership) > next(b.membership) ? 1 : 0) ||
      (a.membership.startsOn < b.membership.startsOn ? -1 : a.membership.startsOn > b.membership.startsOn ? 1 : 0) ||
      (a.id < b.id ? -1 : 1),
  );
  return can[0] ?? null;
}

// ── The wire ────────────────────────────────────────────────────────────────

const daySchema = z.string().regex(DAY);

/** A tax rate as a membership charges it: its name and percentage. */
export const heldTaxSchema = z.object({ name: z.string(), bp: z.number().int().min(1).max(3000) }).strict();
export type HeldTax = z.infer<typeof heldTaxSchema>;

/** One held membership, as the console reads it. `typeName` is the type's name now;
 *  the price and the term are the type's as they were when it was given. */
export const heldMembershipSchema = z
  .object({
    id: z.string().uuid(),
    typeId: z.string().uuid(),
    typeName: z.string(),
    kind: membershipKindSchema,
    priceMinor: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
    termCount: z.number().int().nullable(),
    termUnit: membershipTermUnitSchema.nullable(),
    packClasses: z.number().int().nullable(),
    packDays: z.number().int().nullable(),
    startsOn: daySchema,
    frozenOn: daySchema.nullable(),
    classesLeft: z.number().int().min(0).nullable(),
    /** Taken from the gym's own list (17a-iii): its start day was worked back from the
     *  list's day, so a screen does not print it as the day the person started. */
    fromList: z.boolean(),
    /** The newest period counted as paid was settled by a bill staff cancelled, not by a
     *  payment (18a-ii): the page says nothing is owed for it, never that it was paid. */
    notCharged: z.boolean(),
    /** Everything paid for the newest period counted as paid was given back (18a-ii): the
     *  page says "Refunded" for it, never "Paid". The days are kept (RULINGS 2026-10-10). */
    refundedInFull: z.boolean(),
    /** The discount it was given with (18b-ii-b), as it was then: what came off each
     *  discounted payment and which those are. With "every", `priceMinor` is already the
     *  price after it; with "first", `priceMinor` is the full price of every later period. */
    discount: z
      .object({ name: z.string(), offMinor: z.number().int().min(1), payments: z.enum(MEMBERSHIP_PAYMENTS) })
      .strict()
      .nullable(),
    /** Refer a friend's free days added to it (20e-ii-b-ii-b), and the friend each was for
     *  inviting (by the gym's list; null where that record is gone). Its dates already hold them. */
    freeDays: z
      .array(z.object({ days: z.number().int().min(1).max(GIFT_DAYS_MAX), friendName: z.string().min(1).nullable() }).strict())
      .default([]),
    /** The tax rate it was sold with, as the rate is now (18b-iii): every bill opened from
     *  here on charges it. Null for no tax. */
    tax: heldTaxSchema.nullable(),
    view: heldMembershipViewSchema,
    /** Change membership (18x): the one it was changed from, by its type's name now. */
    changedFrom: z.object({ typeName: z.string(), stopped: z.boolean().default(false) }).strict().nullable().default(null),
    /** The one it was changed to, while that one stands, and the day it starts. */
    changedTo: z.object({ typeName: z.string(), startsOn: daySchema }).strict().nullable().default(null),
    /** Its bills and payments (18a-i); null for a reader without the `billing.members` tick. */
    billing: memberBillingSchema.nullable(),
  })
  .strict();
export type HeldMembershipItem = z.infer<typeof heldMembershipSchema>;

/** A type on the price list that can be given, with what the Add form works its dates
 *  out from. */
export const heldMembershipTypeChoiceSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    kind: membershipKindSchema,
    priceMinor: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
    termCount: z.number().int().nullable(),
    termUnit: membershipTermUnitSchema.nullable(),
    packClasses: z.number().int().nullable(),
    packDays: z.number().int().nullable(),
    /** The tax rate its bills charge (18b-iii); null for no tax. */
    tax: heldTaxSchema.nullable(),
    /** Charged on the first bill (18t); 0 for none. */
    joiningFeeMinor: z.number().int().min(0).default(0),
  })
  .strict();
export type HeldMembershipTypeChoice = z.infer<typeof heldMembershipTypeChoiceSchema>;

/** What the gym's own member list says this person's membership is (17a-iii): the name
 *  as the list wrote it, its end-or-renewal day, and how that name stands with the price
 *  list. `type` is the live type the name is (one staff said it is, or a type of that
 *  very name), null where it is not set up; `held` is whether this person has, or has
 *  had, that type. A person's page says it in the Memberships box, so the box never
 *  reads "No membership yet" beside a list that names one. */
export const listedMembershipSchema = z
  .object({
    word: z.string().min(1),
    endsOn: daySchema.nullable(),
    endsOnKind: z.enum(["ends", "renews"]).nullable(),
    type: z.object({ id: z.string().uuid(), name: z.string() }).strict().nullable(),
    /** The list's name is that type's own name, as the server folds both. */
    ownName: z.boolean(),
    held: z.boolean(),
  })
  .strict();
export type ListedMembership = z.infer<typeof listedMembershipSchema>;

/** A record's memberships. `today` is the gym's own day, the one every date here was
 *  worked out on; `past` is true for a past member, whose memberships are not in use.
 *  `memberships` holds every one in use and the newest of the ones that are over;
 *  `earlierNotShown` counts the older ones left out. `types` are the gym's live types.
 *  `listed` is what the member list says their membership is, null where it says
 *  nothing or the person is a past member. */
export const heldMembershipsResponseSchema = z
  .object({
    today: daySchema,
    past: z.boolean(),
    memberships: z.array(heldMembershipSchema),
    earlierNotShown: z.number().int().min(0),
    types: z.array(heldMembershipTypeChoiceSchema),
    listed: listedMembershipSchema.nullable(),
    /** Whether this reader may record payments (`billing.members`). */
    canBill: z.boolean(),
    /** The gym's discounts in use that are for memberships (18b-ii-b), for the Add form. */
    discounts: z.array(gymDiscountSchema),
    /** Refer a friend's gift where this person is a friend a member invited and has not had
     *  it (20e-ii-b-i): filled in on the Add form, with Remove. Null otherwise. */
    friendGift: friendGiftSchema.nullable().default(null),
    /** This person's own Refer a friend gift, for inviting a friend who joined and paid, where
     *  it is waiting (20e-ii-b-ii-a): filled in on the Add form, with Remove. Null otherwise. */
    memberGift: memberGiftSchema.nullable().default(null),
    /** Their gift off products waiting at Sell, said beside the one above (20e-ii-b-ii-b,
     *  round one L3): Add membership never fills it in. Null otherwise. */
    memberGiftAtSell: memberGiftSchema.nullable().default(null),
    /** Whether the gym's prices already hold the tax, or it is added on top (18b-iii). */
    taxIncluded: z.boolean(),
  })
  .strict();
export type HeldMembershipsResponse = z.infer<typeof heldMembershipsResponseSchema>;

/** Give a membership. `requestKey` is made by the screen once a form: the same key
 *  arriving twice gives one membership, and one payment where it was paid. */
export const giveHeldMembershipRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    typeId: z.string().uuid(),
    startsOn: daySchema,
    paid: z.boolean(),
    /** How they paid, where `paid` is true and the type has a price (18a-i). */
    method: memberPaymentByHandSchema.optional(),
    /** The price the screen showed, where it showed one (the Sell page, 18b-i): a type
     *  whose price is now anything else is not given. */
    priceMinor: z.number().int().min(0).max(99_999_999).optional(),
    /** The gym's discount it is given with (18b-ii-b), and what the screen showed coming
     *  off: worked out again on the server, and nothing is given where it comes to
     *  anything else. Sent with `priceMinor`. */
    discountId: z.string().uuid().optional(),
    discountMinor: z.number().int().min(1).max(99_999_999).optional(),
    /** What the screen showed the first bill comes to, tax and discount in (18b-iii): a
     *  membership whose first bill now comes to anything else is not given. Sent with
     *  `priceMinor`. */
    totalMinor: z.number().int().min(0).max(99_999_999).optional(),
    /** The person's own Refer a friend gift filled in (20e-ii-b-ii-a), and what the screen
     *  showed it takes off the first bill: worked out again on the server. Sent with
     *  `priceMinor`. */
    memberGiftId: z.string().uuid().optional(),
    memberGiftMinor: z.number().int().min(1).max(99_999_999).optional(),
    /** The type's joining fee the screen showed and charges on the first bill (18t): a type
     *  whose fee is now anything else is not given. 0 is the fee left off, which only
     *  somebody who records payments may choose. Sent with `priceMinor` wherever the type
     *  has a fee; left out, the screen showed none, and a type with one is not given. */
    joiningFeeMinor: z.number().int().min(0).max(99_999_999).optional(),
  })
  .strict()
  .refine((v) => (v.discountId === undefined) === (v.discountMinor === undefined) && (v.discountId === undefined || v.priceMinor !== undefined), {
    message: "discount_needs_price",
  })
  .refine((v) => (v.memberGiftId === undefined) === (v.memberGiftMinor === undefined) && (v.memberGiftId === undefined || v.priceMinor !== undefined), {
    message: "member_gift_needs_price",
  })
  .refine((v) => v.totalMinor === undefined || v.priceMinor !== undefined, { message: "total_needs_price" })
  .refine((v) => v.joiningFeeMinor === undefined || v.priceMinor !== undefined, { message: "joining_fee_needs_price" });
export type GiveHeldMembershipRequest = z.infer<typeof giveHeldMembershipRequestSchema>;

/** `confirmBookings`: the number of bookings the screen was told the cancel would end
 *  (409 `membership_has_bookings`), counted again under the gym's lock.
 *  `confirmPtSessions`: the `mark` of the personal training sessions it was told would end. */
export const cancelHeldMembershipRequestSchema = z
  .object({
    when: z.enum(["today", "period_end"]),
    confirmBookings: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    confirmPtSessions: confirmPtSessionsField.optional(),
  })
  .strict();
export type CancelHeldMembershipRequest = z.infer<typeof cancelHeldMembershipRequestSchema>;

export const paidHeldMembershipRequestSchema = z
  .object({ paidPeriods: z.number().int().min(0).max(100_000) })
  .strict();
export type PaidHeldMembershipRequest = z.infer<typeof paidHeldMembershipRequestSchema>;

/** Change a membership for another type (18x): today, with the credit off the new first bill,
 *  or on the next payment date. `priceMinor`, `creditMinor` and `totalMinor` are what the
 *  screen showed, worked out again on the server: nothing is changed at any other amount.
 *  `requestKey` is the new membership's, and its payment's where `paid`. */
export const changeHeldMembershipRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    typeId: z.string().uuid(),
    when: z.enum(["today", "next_payment"]),
    /** The day the screen said the new one starts: a change on any other day is refused. */
    startsOn: daySchema,
    priceMinor: z.number().int().min(0).max(99_999_999),
    creditMinor: z.number().int().min(0).max(99_999_999),
    totalMinor: z.number().int().min(0).max(99_999_999),
    paid: z.boolean(),
    method: memberPaymentByHandSchema.optional(),
    confirmBookings: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    confirmPtSessions: confirmPtSessionsField.optional(),
  })
  .strict()
  .refine((v) => v.when === "today" || v.creditMinor === 0, { message: "credit_only_today" });
export type ChangeHeldMembershipRequest = z.infer<typeof changeHeldMembershipRequestSchema>;
