// ADD MEMBER FINDS THE PERSON IN LEADS (ROADMAP 20e-ii-b-i; spec Part 3 §16.3).
//
// Somebody added on Members who is a lead not yet joined, by email or phone, is marked
// Joined as the new record, so a friend a member invited is followed from the link to their
// membership. The join rule's own test decides who is the same person (`joinRule.ts`): the
// same email or phone AND the same name. A shared contact with another name is a different
// person until staff tick that it is not (a mother and her son on one address).
import type { TransactionSql } from "postgres";
import { fold } from "../memberList/fields.js";
import { insertAudit } from "../repo.js";
import * as repo from "./repo.js";

/** The lead to show, or join, for these details: the one with the name typed, else the one
 *  with the email, else the one with the phone. */
export function leadForDetails(typed: { fullName: string }, leads: readonly repo.OpenLead[]): { lead: repo.OpenLead; sameName: boolean } | null {
  const name = fold(typed.fullName);
  const same = name === "" ? undefined : leads.find((lead) => fold(lead.fullName) === name);
  if (same !== undefined) return { lead: same, sameName: true };
  const first = leads[0];
  return first === undefined ? null : { lead: first, sameName: false };
}

/** Inside Add member's transaction, under the gym's lock: the lead marked Joined as the new
 *  record. `leadId` is the lead staff were shown and ticked; without it only a lead with the
 *  same name is joined. Null where none is. */
export async function joinLeadOnAdd(
  tx: TransactionSql,
  input: {
    gymId: string;
    entryId: string;
    values: { fullName: string; email: string | null; phone: string | null };
    leadId: string | null;
    userId: string;
    at: Date;
  },
): Promise<{ id: string; fullName: string } | null> {
  const leads = await repo.openLeadsSharingContact(tx, input.gymId, input.values);
  const found = leadForDetails(input.values, leads);
  // Staff were shown one lead: only that one, while it still shares the email or phone. A
  // lead with the same name is the same person whether or not the screen said so.
  const lead = input.leadId !== null ? leads.find((l) => l.id === input.leadId) : found?.sameName === true ? found.lead : undefined;
  if (lead === undefined) return null;
  if (!(await repo.markLeadJoined(tx, input.gymId, lead.id, input.entryId, input.at))) return null;
  await insertAudit(tx, {
    actorUserId: input.userId,
    gymId: input.gymId,
    action: "org.lead_joined",
    targetType: "lead",
    targetId: lead.id,
    meta: { outcome: "add_member", entryId: input.entryId },
  });
  return { id: lead.id, fullName: lead.fullName };
}
