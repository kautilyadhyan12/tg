// WHICH MEMBER RECORD A JOINED LEAD IS (ROADMAP 20c-i).
//
// A record that shares the lead's email or phone AND has the lead's name is the same
// person, and the lead is linked to it. A shared contact with another name is not
// proof: a mother and her son on one address are two people (3a-vi's same-name rule),
// so staff are shown the records and choose. A record taken off the list is never
// linked by itself either: choosing it puts it back. Nobody shares the contact: a new
// record is made from the lead.
import { fold } from "../memberList/fields.js";

export interface LeadContact {
  fullName: string;
  email: string | null;
  phone: string | null;
}

export interface ListRecord {
  entryId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  former: boolean;
}

export type JoinDecision =
  | { kind: "link"; entryId: string }
  | { kind: "add" }
  | { kind: "choose"; candidates: ListRecord[] };

/** Emails are compared as the list stores them: case does not tell two apart. */
function sameEmail(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

export function sharesContact(lead: LeadContact, record: ListRecord): boolean {
  return sameEmail(lead.email, record.email) || (lead.phone !== null && lead.phone === record.phone);
}

export function leadJoinDecision(lead: LeadContact, records: readonly ListRecord[]): JoinDecision {
  const shared = records.filter((record) => sharesContact(lead, record));
  if (shared.length === 0) return { kind: "add" };
  const name = fold(lead.fullName);
  const same = shared.filter((record) => !record.former && name !== "" && fold(record.fullName) === name);
  const only = same.length === 1 ? same[0] : undefined;
  if (only !== undefined) return { kind: "link", entryId: only.entryId };
  return { kind: "choose", candidates: shared };
}
