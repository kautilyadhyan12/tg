// A REMINDER BEFORE A RENEWAL OR A MINIMUM TERM'S END (ROADMAP 18v-iv; Kd, 2026-11-04,
// `rulings/2026-11-04-18v-iv.md`). A repeating line of the price list may ask for an email so many days before
// every renewal, or before its minimum term ends. Once a gym's day, from 8 in the morning there, the worker
// writes the reminders due, one a membership and occasion, to whoever pays for it; then it sends them, one at a
// time, through the invitations' sender, after the card expiry emails each minute.
//
// THE WORST THING here is an email telling somebody a charge is coming when none is, or naming the wrong day or
// amount, or another person's membership. So the check before each email reads the membership again under a
// hold (a cancel, a freeze or a payment waits), works the ONE rule out again (`renewalReminderNext`), and sends
// only where it names the same occasion, the same day and the same thing, to the same payer at the same address.
// A service email about their membership, as the card expiry email is: neither the app's daily cap nor an
// unsubscribe from the gym's other emails holds it. An address that bounced or was refused anywhere never.
import {
  authEmailSchema,
  cardName,
  everyWords,
  heldMembershipView,
  leadFirstName,
  leadGreeting,
  renewalReminderDue,
  renewalReminderNext,
  renewalReminderWords,
  type RenewalReminderPreviewResponse,
  type RenewalReminderSetting,
  type RenewalReminderStatus,
} from "@app/shared";
import type { Sql } from "postgres";
import type { InviteEmail, InviteTransport } from "../../../email/resend.js";
import { memberInviteFrom, renewalReminderEmail } from "../../../email/templates.js";
import { emailHmac } from "../invites/address.js";
import { cleanGymText, GYM_TEXT_IN_EMAIL_CHARS, gymNameForEmail } from "../invites/gymText.js";
import { INVITE_SENDING } from "../invites/sender.js";
import type { InviteSender, InviteSettings } from "../invites/settings.js";
import * as repo from "./renewalRemindersRepo.js";

/** The tag the email carries: its row in `gym_renewal_reminders`. */
export const RENEWAL_REMINDER_SEND_TAG = "renewal_reminder_send";

export interface RenewalReminderDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };
  settings: InviteSettings;
  sender: InviteSender;
  transport: InviteTransport;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Only these gyms' emails, for a test that shares its database; production passes nothing. */
  gymIds?: readonly string[];
}

export interface RenewalReminderRun {
  queued: number;
  sent: number;
  skipped: number;
  dropped: number;
  failed: number;
  retried: number;
  stoppedByProvider: boolean;
}

const RETRY_AFTER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

type Tally = "sent" | "skipped" | "dropped" | "failed" | "retried";

/** WHAT HAPPENS TO ONE MEMBERSHIP'S REMINDER on `today`, as the line's box and a person's page say it, from the
 *  rule and what was written. `blocked`: its payer's address bounced or was refused. */
export function reminderStatus(held: repo.RemindedHeld, today: string, written: readonly repo.ReminderWritten[], blocked: boolean): RenewalReminderStatus {
  const plan = renewalReminderNext(held.row.membership, held.setting, today);
  if (plan.kind === "none") return { state: plan.reason, on: null, aboutOn: null };
  const { occasion, sendOn, aboutOn } = plan.next;
  const row = written.find((w) => w.heldId === held.row.id && w.occasion === occasion);
  if (row !== undefined) {
    // The day the email named, which a freeze since may have moved (round one, L1): the screen says what was sent.
    if (row.state === "sent") return { state: "sent", on: row.on, aboutOn: row.aboutOn };
    if (row.state === "queued" || row.state === "sending") return { state: "sending", on: null, aboutOn };
    return { state: row.reason === "address_blocked" ? "address_blocked" : "not_sent", on: null, aboutOn };
  }
  if (held.skipped !== null) return { state: held.skipped, on: null, aboutOn };
  if (held.payerEmail === null || !authEmailSchema.safeParse(held.payerEmail).success) return { state: "no_email", on: null, aboutOn };
  if (blocked) return { state: "address_blocked", on: null, aboutOn };
  return { state: "will_send", on: sendOn > today ? sendOn : today, aboutOn };
}

/** Write the reminders that are due, then send what is due, up to one run's worth. Safe to run twice at once. */
export async function sendDueRenewalReminders(deps: RenewalReminderDeps): Promise<RenewalReminderRun> {
  const run: RenewalReminderRun = { queued: 0, sent: 0, skipped: 0, dropped: 0, failed: 0, retried: 0, stoppedByProvider: false };
  if (deps.settings.paused) return run;
  run.queued = await queueDueRenewalReminders(deps);
  for (let taken = 0; taken < INVITE_SENDING.perRun; taken++) {
    const claim = await repo.claimNext(deps.sql, { now: deps.now(), leaseMs: INVITE_SENDING.leaseMs, gymIds: deps.gymIds ?? null });
    if (claim === null) break;
    const outcome = await sendOne(deps, claim);
    if (outcome === "stop") {
      run.retried += 1;
      run.stoppedByProvider = true;
      break;
    }
    run[outcome] += 1;
    if (outcome === "sent") await deps.sleep(INVITE_SENDING.gapMs);
  }
  return run;
}

/** Once a gym's day: write each reminder due today, for a payer with an address that can be sent to. */
export async function queueDueRenewalReminders(deps: Pick<RenewalReminderDeps, "sql" | "now" | "gymIds">): Promise<number> {
  const now = deps.now();
  let queued = 0;
  for (const gym of await repo.gymsToCheck(deps.sql, { now, gymIds: deps.gymIds ?? null })) {
    const held = await repo.remindedHeld(deps.sql, { gymId: gym.gymId });
    const due: repo.QueuedReminder[] = [];
    for (const one of held) {
      if (one.skipped !== null || one.payerEmail === null || !authEmailSchema.safeParse(one.payerEmail).success) continue;
      const plan = renewalReminderNext(one.row.membership, one.setting, gym.today);
      if (!renewalReminderDue(plan, gym.today)) continue;
      due.push({ gymId: gym.gymId, heldId: one.row.id, entryId: one.payerEntryId, occasion: plan.next.occasion, what: plan.next.what, aboutOn: plan.next.aboutOn, email: one.payerEmail });
    }
    queued += await repo.queueReminders(deps.sql, due, now);
    await repo.markChecked(deps.sql, gym.gymId, now);
  }
  return queued;
}

/** What the email says, read under the hold; null where it is no longer due as it was written. */
interface Letter {
  held: repo.RemindedHeld;
  today: string;
}

async function sendOne(deps: RenewalReminderDeps, claim: repo.ClaimedReminder): Promise<Tally | "stop"> {
  const now = deps.now();
  if (claim.maybeSentAt !== null && now.getTime() - claim.maybeSentAt.getTime() >= INVITE_SENDING.unknownAfterMs) {
    return await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
  }
  const email = claim.email;
  if (email === null || !authEmailSchema.safeParse(email).success) return await stop(deps, claim, "address_invalid");
  const hmac = emailHmac(deps.settings.hmacKey, email);
  const gym = await repo.gymContact(deps.sql, claim.gymId);
  const gymName = gym === null ? "" : gymNameForEmail(gym.name);
  if (gym === null || gymName === "") return await stop(deps, claim, "gym_gone");

  // The check and the mark in one hold: what is sent is what the membership is at that moment.
  const checked = await deps.sql.begin(async (tx): Promise<{ letter: Letter } | "not_due" | "lost"> => {
    await repo.holdMembership(tx, claim.gymId, claim.heldId);
    const today = await repo.gymToday(tx, claim.gymId, now);
    // The reminder this one was written by: before the minimum term ends for its term, else before every renewal.
    const when = claim.occasion === "term" ? "term_end" : "every_renewal";
    const held = (await repo.remindedHeld(tx, { gymId: claim.gymId, heldId: claim.heldId })).find((h) => h.setting.when === when);
    if (today === null || held === undefined || !stillDue(held, claim, email, today)) return "not_due";
    return (await repo.markMaybeSent(tx, claim, hmac, now)) ? { letter: { held, today } } : "lost";
  });
  if (checked === "not_due") return await notDue(deps, claim, hmac);
  if (checked === "lost") return await notDue(deps, claim, hmac);

  // The card is read for the payment the email names; none where it ends.
  const plan = renewalReminderNext(checked.letter.held.row.membership, checked.letter.held.setting, checked.letter.today);
  const periodIndex = plan.kind === "next" ? plan.next.periodIndex : null;
  const card = periodIndex === null ? null : await repo.chargedCard(deps.sql, claim.gymId, claim.heldId, periodIndex);
  const message = reminderMessage(deps, claim, email, gymName, gym, checked.letter, card);
  const result = await deps.transport.send(message);
  switch (result.kind) {
    case "sent":
      return await finish(deps, claim, { kind: "sent", providerId: result.id });
    case "not_sent": {
      deps.log.warn({ event: "renewal_reminder.send_refused", reminderId: claim.id, gymId: claim.gymId, status: result.status }, "the email service refused a renewal reminder; it waits");
      const held = await hold(deps, claim, result.status === 400 || result.status === 422 ? "provider_refused" : "provider_unavailable");
      return held === "retried" && [401, 403, 429].includes(result.status) ? "stop" : held;
    }
    case "unclear": {
      deps.log.warn({ event: "renewal_reminder.send_unclear", reminderId: claim.id, gymId: claim.gymId, status: result.status }, "a renewal reminder may not have gone; it will be tried again under the same key");
      await repo.retryReminder(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
      return "retried";
    }
  }
}

/** Still due as it was written: the line still asks, the same payer at the same address, and the rule names the
 *  same occasion, the same thing and the same day, and it is due today. */
function stillDue(held: repo.RemindedHeld, claim: repo.ClaimedReminder, email: string, today: string): boolean {
  if (held.skipped !== null || held.payerEntryId !== claim.entryId) return false;
  if (held.payerEmail === null || held.payerEmail.toLowerCase() !== email.toLowerCase()) return false;
  const plan = renewalReminderNext(held.row.membership, held.setting, today);
  return renewalReminderDue(plan, today) && plan.next.occasion === claim.occasion && plan.next.what === claim.what && plan.next.aboutOn === claim.aboutOn;
}

const retryAfter = (claim: repo.ClaimedReminder): number => RETRY_AFTER_MS[Math.min(claim.attempts - 1, RETRY_AFTER_MS.length - 1)] ?? 60_000;

/** The email's words, from the membership as it was read under the hold. */
export function reminderLines(
  gymName: string,
  gym: { contactEmail: string | null; contactPhone: string | null },
  letter: Letter,
  card: { brand: string; last4: string } | null,
): Omit<Parameters<typeof renewalReminderEmail>[0], "to"> {
  const { held, today } = letter;
  const m = held.row.membership;
  const view = heldMembershipView(m, today);
  const plan = renewalReminderNext(m, held.setting, today, view);
  if (plan.kind === "none") throw new Error("a renewal reminder's words asked for one that is not due");
  const { what, aboutOn, periodIndex } = plan.next;
  const clean = (text: string): string => cleanGymText(text, GYM_TEXT_IN_EMAIL_CHARS);
  const notice = view.notice;
  const words = renewalReminderWords({
    gymName,
    typeName: clean(held.row.typeName),
    forName: held.payerEntryId === held.entryId ? null : clean(held.holderName) || "somebody you pay for",
    what,
    aboutOn,
    amountMinor: periodIndex === null || m.free ? null : repo.renewalAmountMinor(held.row, periodIndex),
    currency: held.row.currency,
    every: m.termCount === null || m.termUnit === null ? "period" : everyWords(m.termCount, m.termUnit),
    // Named only where the app charges it by itself; never for a membership that ends.
    card: what === "ends" || card === null ? null : cardName(card).replace(" ending ", " ending in "),
    notice: notice !== null && !notice.given && view.can.noticeEnds !== null ? { days: notice.days, lastDay: view.can.noticeEnds } : null,
    endWithTermOn: what === "term_renews" ? view.can.cancelAtContractEnd : null,
    lastDay: what === "renews" && notice !== null && notice.given ? view.endsOn : null,
    // A renewal on or before the minimum term's last day cannot be stopped: the email says the term instead.
    term: what === "renews" && view.contract !== null && aboutOn <= view.contract.until ? { until: view.contract.until, ends: view.contract.then === "ends" } : null,
  });
  const contact = [gym.contactPhone === null ? null : `call ${gym.contactPhone}`, gym.contactEmail === null ? null : `email ${gym.contactEmail}`].filter((x): x is string => x !== null);
  return {
    gymName,
    greeting: leadGreeting(clean(leadFirstName(held.payerName))),
    subject: words.subject,
    lines: words.lines,
    contact: contact.length === 0 ? null : `If you have any questions, you can ${contact.join(" or ")}.`,
  };
}

function reminderMessage(
  deps: RenewalReminderDeps,
  claim: repo.ClaimedReminder,
  email: string,
  gymName: string,
  gym: { contactEmail: string | null; contactPhone: string | null },
  letter: Letter,
  card: { brand: string; last4: string } | null,
): InviteEmail {
  const message = renewalReminderEmail({ to: email, ...reminderLines(gymName, gym, letter, card) });
  return {
    ...message,
    from: deps.sender.from === null ? "" : memberInviteFrom(deps.sender.from, gymName),
    headers: {},
    idempotencyKey: `renewal-reminder-${claim.id}`,
    tags: [{ name: RENEWAL_REMINDER_SEND_TAG, value: claim.id }],
    ...(gym.contactEmail === null ? {} : { replyTo: gym.contactEmail }),
  };
}

/** No longer due as it was written (cancelled, frozen, paid ahead, switched off, another payer or address), or
 *  the address blocked. Never handed over: taken off, so it is written again if it becomes due again; a blocked
 *  address is kept as skipped. */
async function notDue(deps: RenewalReminderDeps, claim: repo.ClaimedReminder, hmac: string): Promise<Tally> {
  if (claim.maybeSentAt !== null) return await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
  if ((await repo.blockedOf(deps.sql, [hmac])).size > 0) return await finish(deps, claim, { kind: "skipped", reason: "address_blocked" });
  if (!(await repo.dropReminder(deps.sql, claim))) {
    deps.log.warn({ event: "renewal_reminder.lease_lost", reminderId: claim.id, gymId: claim.gymId }, "a renewal reminder's lease was taken over");
    return "retried";
  }
  return "dropped";
}

async function stop(deps: RenewalReminderDeps, claim: repo.ClaimedReminder, reason: string): Promise<Tally> {
  return claim.maybeSentAt === null ? await finish(deps, claim, { kind: "skipped", reason }) : await finish(deps, claim, { kind: "failed", reason: "send_unknown" });
}

async function hold(deps: RenewalReminderDeps, claim: repo.ClaimedReminder, reason: string): Promise<Tally> {
  const now = deps.now();
  if (claim.maybeSentAt === null && now.getTime() - claim.createdAt.getTime() >= INVITE_SENDING.holdMs) return await finish(deps, claim, { kind: "failed", reason });
  await repo.retryReminder(deps.sql, claim, new Date(now.getTime() + retryAfter(claim)));
  return "retried";
}

async function finish(deps: RenewalReminderDeps, claim: repo.ClaimedReminder, outcome: repo.ReminderOutcome): Promise<Tally> {
  if (!(await repo.finishReminder(deps.sql, claim, outcome, deps.now()))) {
    deps.log.warn({ event: "renewal_reminder.lease_lost", reminderId: claim.id, gymId: claim.gymId }, "a renewal reminder's lease was taken over");
    return "retried";
  }
  return outcome.kind;
}

// ── WHAT A SCREEN READS ──

/** The statuses of these memberships' reminders, each with its payer's address checked against the ones
 *  that bounced (`emailKey` null: none read as bounced). */
async function statusesOf(sql: Sql, emailKey: Buffer | null, gymId: string, held: readonly repo.RemindedHeld[], today: string): Promise<RenewalReminderStatus[]> {
  const written = await repo.remindersOf(
    sql,
    gymId,
    held.map((h) => h.row.id),
  );
  const keyOf = (h: repo.RemindedHeld): string | null =>
    emailKey === null || h.payerEmail === null || !authEmailSchema.safeParse(h.payerEmail).success ? null : emailHmac(emailKey, h.payerEmail);
  const blocked = await repo.blockedOf(
    sql,
    held.flatMap((h) => {
      const key = keyOf(h);
      return key === null ? [] : [key];
    }),
  );
  return held.map((h) => {
    const key = keyOf(h);
    return reminderStatus(h, today, written, key !== null && blocked.has(key));
  });
}

/** A person's page: each of their memberships in use whose line asks for a reminder, and what happens to it. */
export async function remindersOfRecord(
  sql: Sql,
  emailKey: Buffer | null,
  gymId: string,
  entryId: string,
  today: string,
): Promise<{ membershipId: string; when: RenewalReminderSetting["when"]; status: RenewalReminderStatus }[]> {
  const held = await repo.remindedHeld(sql, { gymId, entryId });
  const statuses = await statusesOf(sql, emailKey, gymId, held, today);
  return held.flatMap((h, i) => {
    const status = statuses[i];
    return status === undefined ? [] : [{ membershipId: h.row.id, when: h.setting.when, status }];
  });
}

/** The line's box: everybody on it now, and what this reminder would do for each, by name. */
export async function previewLine(
  sql: Sql,
  emailKey: Buffer | null,
  gymId: string,
  typeId: string,
  setting: RenewalReminderSetting,
  today: string,
): Promise<RenewalReminderPreviewResponse> {
  const held = await repo.remindedHeld(sql, { gymId, typeId, setting });
  const statuses = await statusesOf(sql, emailKey, gymId, held, today);
  return {
    people: held.flatMap((h, i) => {
      const status = statuses[i];
      return status === undefined ? [] : [{ entryId: h.entryId, name: h.holderName, paidBy: h.payerEntryId === h.entryId ? null : h.payerName, status }];
    }),
  };
}
