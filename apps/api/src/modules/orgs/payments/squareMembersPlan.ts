// Who each member is in the gym's Square customer list (ROADMAP 18d-iii-b-ii-b-i): linked to a customer
// Square already has, added as a customer of their own, or left out for the owner to sort out first.
//
// THE WORST THING is a member linked to somebody else's customer: a child on a parent's email linked to
// the parent, so the parent's payments wait on the child's bill and the parent's Square profile becomes
// the child's. So a member is linked only to a customer with the same email or the same phone AND the same
// name, where exactly one such customer could be them and they are the only one here it could be. Square's
// own rule is to look by email and phone before adding ("Customer API Best Practices", read 2026-10-26);
// the name is our own guard on top of it, never a way in: a name alone links nobody (RULINGS 2026-09-28:
// "a name proves nothing"), as a phone never joins two different names in `memberList/samePerson.ts`.
//
// - A customer whose reference id is this record's id is the one the app made for it earlier (its answer
//   lost): linked. One whose reference id is another record of this gym's is that record's, nobody else's.
// - A customer already linked to a record of this gym (a card saved, a member added) is that record's.
// - Same email or phone and the same name: the one customer, if it could be nobody else here, is linked.
//   Two or more such customers (Square's own duplicates): left out until they are merged in Square. One
//   customer two members here could be (two records of one person): left out until they are joined here.
// - Otherwise a customer of their own is added, even where Square has somebody with the same email under
//   another name (Sam on his mum Pat's email): never linked to them.
//
// "The same name": the words of the shorter name each one of the longer's, in any order, at least two of
// them (or both one word, the same), and no generation word (Jr, Sr, III) on one side only. "LEE/AMY L" and
// "Amy L. Lee" are Amy Lee; "Amy" alone, "A Lee", "Bob" for Robert and "Pat Smith" for Sam Smith are not;
// "John Smith" is not "John Smith Jr". A customer with no given or family name has no name.
//
// Pure: the same members and customers in give the same plan out.
import type { CountryCode } from "libphonenumber-js/max";
import { nameParts } from "../invites/nameCheck.js";
import { readPhone } from "../memberList/phone.js";

/** A current record of the gym not yet linked in this Square account. `phone`: E.164, as the list keeps it. */
export interface PlanMember {
  entryId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
}

/** A customer in the gym's Square, as far as telling who they are: `phone` in E.164 or null, as read by
 *  `squarePhone`; `email` as Square has it (compared folded). */
export interface PlanCustomer {
  id: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  referenceId: string | null;
}

export type MemberPlan =
  /** The customer the app made for this record before. */
  | { kind: "ours"; customerId: string }
  | { kind: "link"; customerId: string; by: "email" | "phone" }
  | { kind: "add" }
  | { kind: "several_customers"; customerIds: string[] }
  | { kind: "several_people"; customerId: string; entryIds: string[] };

export interface PlanAround {
  /** Square customers already linked to a record of this gym in this account. */
  taken: ReadonlySet<string>;
  /** Every record id of this gym, current or past: a reference id among them is that record's customer. */
  recordIds: ReadonlySet<string>;
}

/** Generation words: "John Smith" and "John Smith Jr" are two people, father and son. */
const GENERATIONS = new Set(["jr", "sr", "ii", "iii", "iv", "junior", "senior"]);

/** The same name, as above. */
export function sameNameForSquare(squareName: { givenName: string | null; familyName: string | null }, recordName: string): boolean {
  const square = [...nameParts(squareName.givenName ?? ""), ...nameParts(squareName.familyName ?? "")];
  const record = nameParts(recordName);
  if (square.length === 0 || record.length === 0) return false;
  const generation = (words: readonly string[]) => words.filter((w) => GENERATIONS.has(w)).sort().join(" ");
  if (generation(square) !== generation(record)) return false;
  const [shorter, longer] = square.length <= record.length ? [square, record] : [record, square];
  if (shorter.length < 2 && longer.length !== 1) return false;
  const free = [...longer];
  for (const word of shorter) {
    const at = free.indexOf(word);
    if (at < 0) return false;
    free.splice(at, 1);
  }
  return true;
}

/** A phone as Square keeps it ("(212) 555-4240", "+1 212-555-4240") read as the list read its own: by the
 *  list's phone reader with the gym's country (`memberList/phone.ts`), so both sides are one form. Null for
 *  none, or one it cannot read. */
export function squarePhone(phone: string | null | undefined, country: CountryCode | null): string | null {
  const text = (phone ?? "").trim();
  return text === "" ? null : readPhone(text, country).e164;
}

/** An email as compared: trimmed, lower case; null for none. */
export function squareEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/** Each member's plan, by record id. Customers are found by their email, phone and reference through maps,
 *  so a gym of 2,000 against a Square of thousands is read once each, never every member against every
 *  customer. */
export function squareMembersPlan(members: readonly PlanMember[], customers: readonly PlanCustomer[], around: PlanAround): Map<string, MemberPlan> {
  const plans = new Map<string, MemberPlan>();
  const byEmail = new Map<string, PlanCustomer[]>();
  const byPhone = new Map<string, PlanCustomer[]>();
  const ourFor = new Map<string, PlanCustomer[]>();
  const add = (map: Map<string, PlanCustomer[]>, key: string, c: PlanCustomer) => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [c]);
    else list.push(c);
  };
  for (const c of customers) {
    if (around.taken.has(c.id)) continue;
    // A customer the app made for a record of this gym is that record's, nobody else's.
    if (c.referenceId !== null && around.recordIds.has(c.referenceId)) {
      add(ourFor, c.referenceId, c);
      continue;
    }
    const email = squareEmail(c.email);
    if (email !== null) add(byEmail, email, c);
    if (c.phone !== null) add(byPhone, c.phone, c);
  }

  // The customers each member could be: the app's own for them first, else by contact and name.
  const could = new Map<string, PlanCustomer[]>();
  for (const m of members) {
    const first = [...(ourFor.get(m.entryId) ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    if (first !== undefined) {
      plans.set(m.entryId, { kind: "ours", customerId: first.id });
      continue;
    }
    const email = squareEmail(m.email);
    const seen = new Map<string, PlanCustomer>();
    for (const c of [...(email === null ? [] : (byEmail.get(email) ?? [])), ...(m.phone === null ? [] : (byPhone.get(m.phone) ?? []))]) {
      if (!seen.has(c.id) && sameNameForSquare(c, m.fullName)) seen.set(c.id, c);
    }
    could.set(m.entryId, [...seen.values()]);
  }
  // Who else here each customer could be.
  const claimants = new Map<string, string[]>();
  for (const [entryId, found] of could) {
    for (const c of found) claimants.set(c.id, [...(claimants.get(c.id) ?? []), entryId]);
  }
  for (const m of members) {
    const found = could.get(m.entryId);
    if (found === undefined) continue;
    const only = found[0];
    if (only === undefined) {
      plans.set(m.entryId, { kind: "add" });
    } else if (found.length > 1) {
      plans.set(m.entryId, { kind: "several_customers", customerIds: found.map((c) => c.id).sort() });
    } else {
      const people = claimants.get(only.id) ?? [];
      plans.set(
        m.entryId,
        people.length > 1
          ? { kind: "several_people", customerId: only.id, entryIds: [...people].sort() }
          : { kind: "link", customerId: only.id, by: squareEmail(m.email) !== null && squareEmail(only.email) === squareEmail(m.email) ? "email" : "phone" },
      );
    }
  }
  return plans;
}
