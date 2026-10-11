// Who gets a type when one of the list's words is linked to it (spec Part 3 §13.2;
// ROADMAP 17a-iii). Pure: the preview and the link itself both ask this, so the box
// and the press cannot disagree about one person.
import { createHash } from "node:crypto";
import {
  HELD_LIVE_MAX,
  addDays,
  linkHeldMembership,
  type HeldMembership,
  type HeldMembershipTerms,
  type HeldMembershipTypeChoice,
  type MembershipLinkGroup,
} from "@app/shared";

/** One person on the list who carries the word. */
export interface WordPerson {
  entryId: string;
  fullName: string;
  endsOn: string | null;
  endsOnKind: "ends" | "renews" | null;
  /** Holds, or has held, the type the word is being linked to. */
  heldType: boolean;
  /** Of the memberships of that type they have held: staff cancelled one · one is in use
   *  today (running, frozen or still to start) · the latest last day among them, null
   *  where they have held none. */
  typeCancelled: boolean;
  typeInUse: boolean;
  typeLastDay: string | null;
  /** How many memberships they have in use today. */
  inUse: number;
}

export interface PlacedPerson {
  person: WordPerson;
  group: MembershipLinkGroup;
  /** The membership they would be given; null for the groups that are given none. */
  membership: HeldMembership | null;
  /** They held the type before and the list now gives them a later day. */
  again: boolean;
}

/** Whether somebody who has held the type is offered its next term (21c-i; spec Part 3
 *  §16.9.3): every one of theirs is over, staff cancelled none, and the list now covers a
 *  day LATER than the last day of any of them. Never a repeating type, which ends only
 *  when staff stop it. An unchanged list day is not later, so a second press gives nobody
 *  a second. */
export function offeredAgain(person: WordPerson, type: Pick<HeldMembershipTerms, "kind">): boolean {
  if (!person.heldType || type.kind === "recurring" || person.typeCancelled || person.typeInUse) return false;
  if (person.endsOn === null || person.typeLastDay === null) return false;
  const covered = person.endsOnKind === "renews" ? addDays(person.endsOn, -1) : person.endsOn;
  return covered > person.typeLastDay;
}

/** Each person's group, and the membership the list's own day gives them. `paid` is
 *  staff's answer for the people the list does not settle. */
export function placePeople(
  people: readonly WordPerson[],
  type: HeldMembershipTerms,
  paid: boolean,
  today: string,
): PlacedPerson[] {
  return people.map((person): PlacedPerson => {
    const again = offeredAgain(person, type);
    // Never a second one of the same type: pressing Link again gives nobody two.
    if (person.heldType && !again) return { person, group: "has", membership: null, again: false };
    if (person.inUse >= HELD_LIVE_MAX) return { person, group: "full", membership: null, again };
    const made = linkHeldMembership(type, { endsOn: person.endsOn, endsOnKind: person.endsOnKind }, paid, today);
    if (!made.ok) return { person, group: made.reason === "ended_in_list" ? "ended" : "day", membership: null, again };
    return { person, group: made.group, membership: made.membership, again };
  });
}

/** What a box showed, in one value: the day, the type as it stands, and each person who
 *  can get it with their name, group and list day. The press sends the preview's back;
 *  where the press works out another, somebody or something has changed since, however
 *  alike the numbers are (another person with the word, another price on the type). */
export function linkDigest(
  type: HeldMembershipTypeChoice,
  typeUpdatedAt: Date,
  placed: readonly PlacedPerson[],
  today: string,
): string {
  const people = placed
    .filter((p) => p.membership !== null)
    .map((p) => [p.person.entryId, p.group, p.person.fullName, p.person.endsOn ?? "", p.person.endsOnKind ?? ""])
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  const facts = [
    today,
    type.id,
    typeUpdatedAt.toISOString(),
    type.name,
    type.kind,
    type.priceMinor,
    type.currency,
    type.termCount,
    type.termUnit,
    type.packClasses,
    type.packDays,
    people,
  ];
  return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}
