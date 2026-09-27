// WHO FROM A LEADS FILE IS ADDED (ROADMAP 20c-iii). One pure rule, table-tested.
//
// - Already one of the gym's leads (the same email or the same phone): left as they
//   are. A lead's status, notes and tick are staff's work; a file never overwrites it.
// - On the member list now, with the same name AND the same email or phone: already a
//   member, not added. A shared address with ANOTHER name is not proof — a mother and
//   her son on one address are two people (the Joined rule's own test, `joinRule.ts`),
//   so the son is added, and Joined asks later which record he is. A record taken off
//   the list is a past member, who may well be a lead again, so it stops nobody.
// - Everyone else is added — one lead per email and one per phone, as a gym's leads
//   are kept: a later row with an email or phone an added row already has is "twice in
//   the file". Checked AFTER the two above, so a son whose mother is a member (and so
//   not added) is added on the address they share.
import { createHash } from "node:crypto";
import type { LeadFileRow } from "@app/shared";
import { fold } from "../memberList/fields.js";

export interface KnownLead {
  email: string | null;
  phone: string | null;
}

export interface KnownMember {
  fullName: string;
  email: string | null;
  phone: string | null;
}

export interface LeadFilePlan {
  add: LeadFileRow[];
  alreadyLead: LeadFileRow[];
  alreadyMember: LeadFileRow[];
  /** Each with the name of the added person whose email or phone it repeats. */
  twiceInFile: { row: LeadFileRow; sameAs: string }[];
}

const lower = (email: string | null): string | null => (email === null ? null : email.toLowerCase());

export function leadFilePlan(rows: readonly LeadFileRow[], leads: readonly KnownLead[], members: readonly KnownMember[]): LeadFilePlan {
  const leadEmails = new Set<string>();
  const leadPhones = new Set<string>();
  for (const lead of leads) {
    const email = lower(lead.email);
    if (email !== null) leadEmails.add(email);
    if (lead.phone !== null) leadPhones.add(lead.phone);
  }
  // Each member's name under each of their contacts, so a row is checked against the
  // records that share ITS contact only.
  const namesByContact = new Map<string, Set<string>>();
  const note = (key: string, name: string): void => {
    const names = namesByContact.get(key);
    if (names === undefined) namesByContact.set(key, new Set([name]));
    else names.add(name);
  };
  for (const member of members) {
    const name = fold(member.fullName);
    if (name === "") continue;
    const email = lower(member.email);
    if (email !== null) note(`e:${email}`, name);
    if (member.phone !== null) note(`p:${member.phone}`, name);
  }

  const plan: LeadFilePlan = { add: [], alreadyLead: [], alreadyMember: [], twiceInFile: [] };
  const addedEmails = new Map<string, string>();
  const addedPhones = new Map<string, string>();
  for (const row of rows) {
    const email = lower(row.email);
    if ((email !== null && leadEmails.has(email)) || (row.phone !== null && leadPhones.has(row.phone))) {
      plan.alreadyLead.push(row);
      continue;
    }
    const name = fold(row.fullName);
    const sameName = (key: string): boolean => namesByContact.get(key)?.has(name) === true;
    if (name !== "" && ((email !== null && sameName(`e:${email}`)) || (row.phone !== null && sameName(`p:${row.phone}`)))) {
      plan.alreadyMember.push(row);
      continue;
    }
    const sameAs = (email === null ? undefined : addedEmails.get(email)) ?? (row.phone === null ? undefined : addedPhones.get(row.phone));
    if (sameAs !== undefined) {
      plan.twiceInFile.push({ row, sameAs });
      continue;
    }
    if (email !== null) addedEmails.set(email, row.fullName);
    if (row.phone !== null) addedPhones.set(row.phone, row.fullName);
    plan.add.push(row);
  }
  return plan;
}

/** What names the leads to be added, exactly: every field that is written, in order.
 *  The check screen is given it and Add sends it back, so what is added is what was
 *  shown — a changed file, mapping, lead list or member list gives another. */
export function planKey(add: readonly LeadFileRow[]): string {
  const hash = createHash("sha256");
  for (const row of add) hash.update(JSON.stringify([row.fullName, row.email, row.phone, row.source, row.notes]));
  return hash.digest("hex");
}
