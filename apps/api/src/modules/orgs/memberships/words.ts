// Who gets a type when one of the list's words is linked to it (spec Part 3 §13.2;
// ROADMAP 17a-iii). Pure: the preview and the link itself both ask this, so the box
// and the press cannot disagree about one person.
import {
  HELD_LIVE_MAX,
  linkHeldMembership,
  type HeldMembership,
  type HeldMembershipTerms,
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
  /** How many memberships they have in use today. */
  inUse: number;
}

export interface PlacedPerson {
  person: WordPerson;
  group: MembershipLinkGroup;
  /** The membership they would be given; null for the groups that are given none. */
  membership: HeldMembership | null;
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
    // Never a second one of the same type: pressing Link again gives nobody two.
    if (person.heldType) return { person, group: "has", membership: null };
    if (person.inUse >= HELD_LIVE_MAX) return { person, group: "full", membership: null };
    const made = linkHeldMembership(type, { endsOn: person.endsOn, endsOnKind: person.endsOnKind }, paid, today);
    if (!made.ok) return { person, group: made.reason === "ended_in_list" ? "ended" : "day", membership: null };
    return { person, group: made.group, membership: made.membership };
  });
}
