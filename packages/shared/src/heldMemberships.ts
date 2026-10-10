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
function periodStart(m: HeldMembership, index: number): string {
  const t = term(m);
  return addDays(addTerms(m.startsOn, t.count, t.unit, index), m.frozenDays);
}

/** Which period `day` falls in: 0 for the first, and 0 for a day before it starts. */
function periodIndex(m: HeldMembership, day: string): number {
  // The day as it would be had it never been frozen: periods are counted from the start.
  const at = addDays(day, -m.frozenDays);
  if (at <= m.startsOn) return 0;
  const t = term(m);
  const a = parts(m.startsOn);
  const d = parts(at);
  if (a === null || d === null) throw new Error("not a day");
  // A first guess that is never too high, then forward to the period holding the day.
  let index: number;
  if (t.unit === "day" || t.unit === "week") {
    index = Math.floor(daysBetween(m.startsOn, at) / ((t.unit === "week" ? 7 : 1) * t.count));
  } else {
    const months = (d[0] - a[0]) * 12 + (d[1] - a[1]) - 1;
    index = Math.max(0, Math.floor(months / ((t.unit === "year" ? 12 : 1) * t.count)));
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
 *  A repeating membership is paid up to that day, and owes from it where it has
 *  passed. Any other kind runs through that day, and whether it is paid is staff's
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
  const membership = {
    ...base,
    startsOn: at.startsOn,
    frozenDays: at.frozenDays,
    paidPeriods: free ? 0 : at.periods,
    // Every period up to the list's day is the list's own fact, not a mark staff made:
    // none of them can be taken back.
    paidFloor: free ? 0 : at.periods,
  };
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

// ── The wire ────────────────────────────────────────────────────────────────

const daySchema = z.string().regex(DAY);

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
    view: heldMembershipViewSchema,
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
  })
  .strict();
export type HeldMembershipsResponse = z.infer<typeof heldMembershipsResponseSchema>;

/** Give a membership. `requestKey` is made by the screen once a form: the same key
 *  arriving twice gives one membership. */
export const giveHeldMembershipRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    typeId: z.string().uuid(),
    startsOn: daySchema,
    paid: z.boolean(),
  })
  .strict();
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
