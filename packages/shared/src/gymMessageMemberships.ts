// WHAT THE MESSAGE RULE READS OF A PERSON'S MEMBERSHIPS AND BILLS (spec Part 3 §16.2;
// ROADMAP 20b-ii).
//
// The worst thing this could do to a real person: "Your payment is overdue" to somebody who
// owes nothing. So a bill is handed to the rule only where it is open, its membership is in
// use today, and the gym asks for that membership's money in the app; anything else about a
// person's money is left out here, before the rule counts a day. Pure: the day is the
// gym's own, passed in.
import type { GymMessageEnding, GymMessageFacts } from "./gymMessages.js";
import { heldMembershipFacts, type HeldMembership, type HeldMembershipFacts } from "./heldMemberships.js";

/** One membership on the record a person holds alone. */
export interface HeldForMessages {
  id: string;
  membership: HeldMembership;
  /** The gym asks for this membership's money in the app: staff gave it by hand here, or a
   *  payment for it was recorded here. One taken from the gym's own list with no payment
   *  here is paid for in the gym's other software, whatever its bills here read. */
  billedHere: boolean;
}
/** One bill of such a membership. `open`: nothing settled it (not paid, not cancelled, not
 *  refunded). */
export interface BillForMessages {
  id: string;
  membershipId: string;
  dueOn: string;
  open: boolean;
}

export type MembershipMessageFacts = Pick<GymMessageFacts["person"], "trial" | "ending" | "bills">;
export const NO_MEMBERSHIP_FACTS: MembershipMessageFacts = { trial: null, ending: null, bills: [] };

/** A membership as it is on `today`, or null for one the rule cannot read (a row with no
 *  term): garbage in is no decision, never a wrong one. */
function factsOf(m: HeldMembership, today: string): HeldMembershipFacts | null {
  try {
    return heldMembershipFacts(m, today);
  } catch {
    return null;
  }
}

/** The trial a person is on, the membership of theirs that is ending, and the bills they
 *  can be told are overdue.
 *
 *  - Only a membership that is RUNNING today is read for any of the three: not one frozen,
 *    cancelled, over, or still to start.
 *  - `trial`: the newest-started trial. `next` where any other membership of theirs is in
 *    use (running, frozen or still to start).
 *  - `ending`: one that is no trial and has a last day (one time, a pack, or a repeating
 *    one set to stop), unless another of its sort is in use and runs past that day: a pack
 *    carries on a pack, a membership a membership. The soonest, where there are two.
 *  - `bills`: the open bills of the running memberships that have a price and are
 *    `billedHere`. */
export function membershipMessageFacts(held: readonly HeldForMessages[], bills: readonly BillForMessages[], today: string): MembershipMessageFacts {
  const read = held.flatMap((h) => {
    const facts = factsOf(h.membership, today);
    return facts === null ? [] : [{ ...h, facts }];
  });
  const inUse = read.filter((h) => h.facts.status === "active" || h.facts.status === "frozen" || h.facts.status === "upcoming");
  const running = read.filter((h) => h.facts.status === "active");

  const trials = running
    .filter((h) => h.membership.kind === "trial" && h.facts.endsOn !== null)
    .sort((a, b) => (a.membership.startsOn === b.membership.startsOn ? a.id.localeCompare(b.id) : a.membership.startsOn < b.membership.startsOn ? 1 : -1));
  const onTrial = trials[0];
  const trial =
    onTrial === undefined || onTrial.facts.endsOn === null
      ? null
      : { id: onTrial.id, startsOn: onTrial.membership.startsOn, endsOn: onTrial.facts.endsOn, next: inUse.some((h) => h.id !== onTrial.id) };

  const isPack = (m: HeldMembership): boolean => m.kind === "pack";
  const whatOf = (m: HeldMembership): GymMessageEnding => (m.kind === "pack" ? "pack" : m.kind === "recurring" ? "stopping" : "membership");
  const paidFor = inUse.filter((h) => h.membership.kind !== "trial");
  const ends = running
    .flatMap((h) =>
      h.membership.kind === "trial" || h.facts.endsOn === null || h.facts.endsOn < today
        ? []
        : [{ id: h.id, startsOn: h.membership.startsOn, endsOn: h.facts.endsOn, what: whatOf(h.membership), pack: isPack(h.membership) }],
    )
    .filter((e) => !paidFor.some((h) => h.id !== e.id && isPack(h.membership) === e.pack && (h.facts.endsOn === null || h.facts.endsOn > e.endsOn)))
    .sort((a, b) => (a.endsOn === b.endsOn ? a.id.localeCompare(b.id) : a.endsOn < b.endsOn ? -1 : 1))
    .map(({ id, startsOn, endsOn, what }) => ({ id, startsOn, endsOn, what }));

  const billed = new Set(running.filter((h) => !h.membership.free && h.billedHere).map((h) => h.id));
  return {
    trial,
    ending: ends[0] ?? null,
    bills: bills.filter((b) => b.open && billed.has(b.membershipId)).map((b) => ({ id: b.id, dueOn: b.dueOn, paid: false })),
  };
}
