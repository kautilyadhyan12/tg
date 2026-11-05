// WHICH OF THE GYM'S MEAL PLANS A PERSON GETS (ROADMAP Stage 2 24a-ii; spec Part 6 §16.6). Pure: the
// groups a plan is given to and what the list knows of each person in, the plan each one gets out.
//
// A person on the list (a current record) is reached by Everybody, by each membership type they are
// in, by each tag they hold, and by being ticked themselves; of what reaches them they get the plan
// given last. Every read of who gets what (the member's own, a person's page, the Plans list, a plan's
// Given to, the box before Give) asks this one rule.
import { heldMembershipFacts, type HeldMembership } from "@app/shared";

export type AudienceKind = "everyone" | "membership_type" | "tag" | "member";

export interface Given {
  audienceId: string;
  planId: string;
  kind: AudienceKind;
  /** The type's, tag's or record's id for those kinds; null for Everybody. */
  target: string | null;
  givenAt: Date;
}

export interface PersonFacts {
  entryId: string;
  tagIds: readonly string[];
  /** The membership types they are in today (`typesOf`). */
  typeIds: ReadonlySet<string>;
}

/** The groups of the gym that reach this person. */
export function reaching(given: readonly Given[], person: PersonFacts): Given[] {
  const tags = new Set(person.tagIds);
  return given.filter((g) =>
    g.kind === "everyone" ||
    (g.kind === "member" && g.target === person.entryId) ||
    (g.kind === "tag" && g.target !== null && tags.has(g.target)) ||
    (g.kind === "membership_type" && g.target !== null && person.typeIds.has(g.target)),
  );
}

/** The group given last; two given at one instant, the larger id, so one answer always. */
export function newest(given: readonly Given[]): Given | null {
  let best: Given | null = null;
  for (const g of given) {
    const t = g.givenAt.getTime();
    if (best === null || t > best.givenAt.getTime() || (t === best.givenAt.getTime() && g.audienceId > best.audienceId)) best = g;
  }
  return best;
}

/** What each person gets; somebody nothing reaches is not in the answer. */
export function pickAll(given: readonly Given[], people: readonly PersonFacts[]): Map<string, Given> {
  const out = new Map<string, Given>();
  for (const p of people) {
    const got = newest(reaching(given, p));
    if (got !== null) out.set(p.entryId, got);
  }
  return out;
}

export interface TypeFacts {
  /** Their memberships stored as in use, each with its type. */
  held: readonly { typeId: string; membership: HeldMembership }[];
  /** The type the list's own word for them names (its link, else a live type of that name), and
   *  whether they ever held that type here; null with no word or none it names. */
  word: { typeId: string; everHeld: boolean } | null;
}

/** The membership types a person is in on `today`, as the Members list reads them (`heldOnList`):
 *  each membership running or frozen today; with nothing in use (running, frozen or still to start),
 *  the type the list's word names, unless they held that one here and it is over. */
export function typesOf(facts: TypeFacts, today: string): Set<string> {
  const types = new Set<string>();
  let inUse = false;
  for (const h of facts.held) {
    const { status } = heldMembershipFacts(h.membership, today);
    if (status === "active" || status === "frozen") types.add(h.typeId);
    if (status === "active" || status === "frozen" || status === "upcoming") inUse = true;
  }
  if (!inUse && facts.word !== null && !facts.word.everHeld) types.add(facts.word.typeId);
  return types;
}
