// Settings → Follow-up emails to leads (Part 3 §16.3; ROADMAP 20c-v-a; RULINGS
// 2026-09-27): the owner's "Send them for me" switch, off until they turn it on, and
// where replies go. Read and changed with `org.manage`; a change needs a live plan.
//
// The Stop link in each email the app sends is here too: it keeps the address from every
// email of that gym through the app, and takes the lead's "Happy to hear from us" off.
import {
  LEAD_EMAIL_SETTINGS_WORDS,
  LEAD_EMAILS_PER_MONTH,
  type LeadEmailSettings,
  type UpdateLeadEmailSettingsRequest,
} from "@app/shared";
import type { Sql } from "postgres";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { lockGym } from "../memberList/repo.js";
import { emailHmac } from "../invites/address.js";
import { GYM_TEXT_IN_EMAIL_CHARS, cleanGymText, gymNameForEmail } from "../invites/gymText.js";
import { suppressForGym } from "../invites/repo.js";
import * as emailsRepo from "./emailsRepo.js";
import type { LeadsDeps } from "./service.js";

type Limit = () => Promise<boolean>;

const toSettings = (facts: emailsRepo.GymSendingFacts, sending: LeadsDeps["sending"]): LeadEmailSettings => ({
  sendForMe: facts.sendForMe,
  replyTo: facts.replyTo,
  perMonth: LEAD_EMAILS_PER_MONTH,
  usedThisMonth: facts.usedThisMonth,
  hasPostalAddress: facts.hasPostalAddress,
  stopped: facts.stopped,
  appSending: sending,
});

async function readBack(deps: LeadsDeps, gymId: string): Promise<LeadEmailSettings> {
  const facts = await emailsRepo.gymSendingFacts(deps.sql, gymId, deps.now());
  if (facts === null) throw new Error(`gym ${gymId} vanished after its privilege was checked`);
  return toSettings(facts, deps.sending);
}

export async function readEmailSettings(deps: LeadsDeps, userId: string, gymId: string, limit: Limit): Promise<LeadEmailSettings | null> {
  await requirePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  return await readBack(deps, gymId);
}

export async function writeEmailSettings(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  body: UpdateLeadEmailSettingsRequest,
  limit: Limit,
): Promise<LeadEmailSettings | null> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  // As the invitations refuse: with sending not set up, nothing could ever go. A pause
  // is the operator's for a while, so the switch may be on through it.
  if (body.sendForMe && deps.sending === "off") throw new OrgsError(503, "invites_off", LEAD_EMAIL_SETTINGS_WORDS.invites_off);
  const at = deps.now();
  await deps.sql.begin(async (tx) => {
    // The gym's lock, as its details take: a postal address cleared at the same moment
    // cannot slip past the check below.
    await lockGym(tx, gymId);
    const facts = await emailsRepo.gymSendingFacts(tx, gymId, at);
    if (facts === null) throw new Error(`gym ${gymId} vanished under its lock`);
    if (body.sendForMe) {
      if (!facts.hasPostalAddress) throw new OrgsError(409, "needs_postal_address", LEAD_EMAIL_SETTINGS_WORDS.needs_postal_address);
      if (gymNameForEmail(facts.name) === "") throw new OrgsError(409, "gym_name", LEAD_EMAIL_SETTINGS_WORDS.gym_name);
    }
    await emailsRepo.writeEmailSwitch(tx, gymId, { sendForMe: body.sendForMe, replyTo: body.replyTo }, at);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.lead_emails_changed",
      targetType: "gym",
      targetId: gymId,
      meta: { sendForMe: body.sendForMe ? "true" : "false" },
    });
  });
  return await readBack(deps, gymId);
}

/** Stop pressed in a follow-up email the app sent: the address is kept from this gym's
 *  emails through the app (invitations too), and the lead's tick comes off if it is
 *  still at that address. Twice is once. Null when the email is not known. */
export async function stopLeadEmails(
  sql: Sql,
  addressKey: Buffer,
  sendId: string,
  at: Date,
): Promise<{ gymName: string } | null> {
  const send = await emailsRepo.sendForStop(sql, sendId);
  if (send === null) return null;
  await sql.begin(async (tx) => {
    await suppressForGym(tx, send.gymId, send.hmac, "unsubscribed");
    if (send.leadId === null) return;
    const lead = await emailsRepo.lockLeadForStop(tx, send.gymId, send.leadId);
    if (lead === null || lead.email === null || lead.emailOkAt === null || emailHmac(addressKey, lead.email) !== send.hmac) return;
    await emailsRepo.untickLead(tx, send.gymId, send.leadId, at);
    await insertAudit(tx, {
      actorUserId: null,
      gymId: send.gymId,
      action: "org.lead_unsubscribed",
      targetType: "lead",
      targetId: send.leadId,
      meta: {},
    });
  });
  return { gymName: cleanGymText(send.gymName, GYM_TEXT_IN_EMAIL_CHARS) };
}
