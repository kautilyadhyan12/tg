// WHAT THE MEMBERS LIST SAYS ABOUT A PERSON'S MEMBERSHIP — Part 3 §13.2, §18.2; ROADMAP
// Stage 2 item 23a-i.
//
// The list has four columns about a membership: Status, Membership, Renews or ends, and
// Payment. A gym's own file fills them with its own words. A membership given in the app
// is not one of those words, so this is the ONE rule that says what the four columns
// show for a person who holds memberships here. The list's rows, its Filter, its counts
// and its download all read it, and a person's page words a membership the same way.
//
// Pure: the memberships, the gym's own day and what the list's word names are passed in.
import { z } from "zod";
import {
  HELD_LIVE_MAX,
  heldMembershipFacts,
  heldMembershipShownSchema,
  shownRenewal,
  type HeldMembership,
  type HeldMembershipFacts,
  type HeldMembershipShown,
} from "./heldMemberships.js";

/** The word for each state of a held membership, on the list and on a person's page. */
export const HELD_STATUS_WORDS: Readonly<Record<HeldMembershipShown, string>> = {
  upcoming: "Not started",
  active: "Active",
  frozen: "Frozen",
  ended: "Ended",
  cancelled: "Cancelled",
};

/** The Payment column's words, which are also the Filter's choices. "Payment due" is
 *  money owed today; a payment whose day has not come is "Not due yet", so nobody who
 *  owes nothing is found under the word staff chase people by. */
export const HELD_PAYMENT_WORDS = { due: "Payment due", later: "Not due yet", paid: "Paid", free: "Free" } as const;

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const heldOnListSchema = z
  .object({
    status: heldMembershipShownSchema,
    /** Each membership's name once, the one the row names first. */
    memberships: z.array(z.string().min(1)).min(1).max(HELD_LIVE_MAX),
    /** The first membership's day: when it renews, ends or starts, since when it is
     *  frozen, or when it ended. `on` is null for one that ended with no day to print
     *  (a pack used up before its last day). Null where there is nothing to say. */
    day: z
      .object({ what: z.enum(["renews", "ends", "starts", "frozen", "ended", "cancelled"]), on: daySchema.nullable() })
      .strict()
      .nullable(),
    /** `due` where ANY membership in use is owed today, since the earliest day (null
     *  where none of them says a day); else `later` where one has a payment whose day
     *  has not come, on the nearest such day; else `paid`; `free` where there is nothing
     *  to pay. Null once every membership is over. */
    payment: z
      .discriminatedUnion("state", [
        z.object({ state: z.literal("due"), since: daySchema.nullable() }).strict(),
        z.object({ state: z.literal("later"), on: daySchema }).strict(),
        z.object({ state: z.literal("paid") }).strict(),
        z.object({ state: z.literal("free") }).strict(),
      ])
      .nullable(),
  })
  .strict();
export type HeldOnList = z.infer<typeof heldOnListSchema>;

export interface HeldForList {
  /** Any value that tells two of a person's memberships apart; the last word on order. */
  id: string;
  /** The type's name now. */
  typeName: string;
  fromList: boolean;
  membership: HeldMembership;
}

type Seen = HeldForList & { view: HeldMembershipFacts };

const IN_USE_ORDER: Partial<Record<HeldMembershipShown, number>> = { active: 0, frozen: 1, upcoming: 2 };

/** Newest start first, then the id, so the same memberships always read the same. */
const newestFirst = (a: Seen, b: Seen): number =>
  a.membership.startsOn < b.membership.startsOn ? 1 : a.membership.startsOn > b.membership.startsOn ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Which membership a row names first: one running before one frozen before one still to
 *  start; a membership before a class pack, which is bought on top of one; then the newest. */
function nameOrder(a: Seen, b: Seen): number {
  const status = (IN_USE_ORDER[a.view.status] ?? 0) - (IN_USE_ORDER[b.view.status] ?? 0);
  if (status !== 0) return status;
  const pack = Number(a.membership.kind === "pack") - Number(b.membership.kind === "pack");
  return pack !== 0 ? pack : newestFirst(a, b);
}

function dayOf(m: Seen, today: string): HeldOnList["day"] {
  const { status, endsOn } = m.view;
  if (status === "cancelled") return { what: "cancelled", on: endsOn };
  // A pack used up before its last day ended on a day nobody stored.
  if (status === "ended") return { what: "ended", on: endsOn !== null && endsOn <= today ? endsOn : null };
  if (status === "frozen") return { what: "frozen", on: m.membership.frozenOn };
  if (status === "upcoming") return { what: "starts", on: m.membership.startsOn };
  // One taken from the gym's list keeps the list's own day (`shownRenewal`); a free
  // repeating one has nothing paid up to that day, so no renewal day is printed.
  const renewsOn = !m.fromList ? m.view.renewsOn : m.membership.kind === "recurring" && m.membership.free ? null : shownRenewal(m.view);
  if (renewsOn !== null) return { what: "renews", on: renewsOn };
  return endsOn === null ? null : { what: "ends", on: endsOn };
}

/** Any payment owed today makes the person's payment due: a row never reads "Paid" for
 *  somebody who owes on one of the memberships they hold. One whose day has not come (a
 *  membership still to start, not paid) is not owed yet, and never reads "Payment due". */
function paymentOf(inUse: readonly Seen[], today: string): NonNullable<HeldOnList["payment"]> {
  const due = inUse.flatMap((m) => (m.view.payment?.state === "due" ? [m.view.payment.since] : []));
  const owed = due.filter((since) => since === null || since <= today);
  if (owed.length > 0) {
    const days = owed.filter((day): day is string => day !== null).sort();
    return { state: "due", since: days[0] ?? null };
  }
  const later = due.filter((day): day is string => day !== null).sort()[0];
  if (later !== undefined) return { state: "later", on: later };
  return inUse.some((m) => m.view.payment?.state === "paid") ? { state: "paid" } : { state: "free" };
}

/** The day a membership that is over finished: the day it was cancelled, which is stored
 *  and counts as it stands; else its last day. A pack used up before its last day finished
 *  on a day nobody stored, so its start day stands in: the earliest it can have been. */
function finishedOn(m: Seen, today: string): string {
  const { status, endsOn } = m.view;
  if (endsOn !== null && (status === "cancelled" || endsOn <= today)) return endsOn;
  return m.membership.startsOn;
}

/** Which of the ones that are over a row names: the one that finished last; a membership
 *  before a pack that finished the same day; then the newest. `overForList` in the api
 *  picks each record's one stored row by this same order. */
const finishedLast =
  (today: string) =>
  (a: Seen, b: Seen): number => {
    const [x, y] = [finishedOn(a, today), finishedOn(b, today)];
    if (x !== y) return x < y ? 1 : -1;
    const pack = Number(a.membership.kind === "pack") - Number(b.membership.kind === "pack");
    return pack !== 0 ? pack : newestFirst(a, b);
  };

const fold = (name: string): string => name.trim().toLowerCase();

function names(list: readonly string[]): string[] {
  const seen = new Set<string>();
  return list.filter((name) => {
    const key = fold(name);
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What the list's four columns show for somebody who holds, or has held, memberships
 *  here; null where the gym's own words show instead.
 *
 *  `held`: every membership of theirs in use, and the ones that are over. `listedUnheld`:
 *  the membership name the gym's own list gives them, where it names something they do
 *  not hold and never have (not set up, or not added); null otherwise.
 *
 *  1. Something in use (running, frozen or still to start): the app's own facts, and
 *     only those. A name on their record from the gym's old file is not a second
 *     membership; their own page still shows it.
 *  2. Nothing in use and the list names a membership they never had here: the list's words.
 *  3. Nothing in use otherwise: the one that finished last, "Ended" or "Cancelled",
 *     whenever it started (`finishedLast`).
 *  4. Nothing held at all: the list's words. */
export function heldOnList(input: { held: readonly HeldForList[]; listedUnheld: string | null; today: string }): HeldOnList | null {
  const seen: Seen[] = input.held.map((m) => ({ ...m, view: heldMembershipFacts(m.membership, input.today) }));
  const inUse = seen.filter((m) => IN_USE_ORDER[m.view.status] !== undefined).sort(nameOrder);
  const first = inUse[0];
  if (first !== undefined) {
    return {
      status: first.view.status,
      memberships: names(inUse.map((m) => m.typeName)).slice(0, HELD_LIVE_MAX),
      day: dayOf(first, input.today),
      payment: paymentOf(inUse, input.today),
    };
  }
  if (input.listedUnheld !== null) return null;
  const last = [...seen].sort(finishedLast(input.today))[0];
  if (last === undefined) return null;
  return { status: last.view.status, memberships: [last.typeName], day: dayOf(last, input.today), payment: null };
}

/** A row's Membership cell: the first name, and how many more ("Gold Monthly +1"). */
export function heldNamesLine(memberships: readonly string[]): string {
  const [first, ...rest] = memberships;
  if (first === undefined) return "";
  return rest.length === 0 ? first : `${first} +${String(rest.length)}`;
}

/** The same facts as the list's own kinds of word: what the Filter offers and matches,
 *  what the counts count and what the download writes. */
export function heldListWords(shown: HeldOnList): { status: string; memberships: string[]; payment: string | null } {
  return {
    status: HELD_STATUS_WORDS[shown.status],
    memberships: shown.memberships,
    payment: shown.payment === null ? null : HELD_PAYMENT_WORDS[shown.payment.state],
  };
}
