// The worker's half of what comes back (Part 3 §9.12; ROADMAP 3b-i-b). Each Resend
// report the webhook kept is checked against Resend's own record of the email, then
// written: the email's result, a suppression, and the gym's standing.
//
// A lead's follow-up the app sent for the gym (§16.3; ROADMAP 20c-v-b) is acted on the
// same way and counts toward the same standing; a complaint about one also takes that
// lead's "Happy to hear from us" tick off, as its Stop link does.
//
// Everything here is safe to run twice: a result only moves to a more serious one, a
// suppression is kept once, and only the run that stops a gym tells the operator.
import { INVITE_SEND_TAG, LEAD_SEND_TAG, type MemberInviteEmailResult } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import type { EmailRecordReader } from "../../../email/resend.js";
import * as webhooks from "../../webhooks/repo.js";
import * as leadRepo from "../leads/emailsRepo.js";
import * as listRepo from "../memberList/repo.js";
import { insertAudit } from "../repo.js";
import { emailHmac } from "./address.js";
import * as repo from "./repo.js";
import { confirm, effectOf, judgeGym, replacesResult, type StopReason } from "./standing.js";

export const INVITE_RESULTS = {
  /** Reports one run takes. */
  perRun: 200,
  leaseMs: 5 * 60 * 1000,
  /** A report Resend's record does not yet agree with is asked about again, then given up. */
  retryAfterMs: [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000],
  maxTries: 8,
  /** Waiting on anything else — the email's own row, Resend unreachable or its rate —
   *  asks again this often and spends no try. */
  waitMs: 5 * 60_000,
  /** A report still unsettled after a week is given up. The sender stops trying an
   *  email after 20 hours, so its row has an outcome long before this. */
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  /** Resend's API allows ten requests a second for the whole account; sending takes five. */
  gapMs: 250,
  keepDays: 90,
} as const;

export interface StoppedGym {
  gymId: string;
  gymName: string;
  reason: StopReason;
  sent: number;
  bounced: number;
}

export interface ResultsDeps {
  sql: Sql;
  log: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
  reader: EmailRecordReader;
  /** The key addresses are kept under: a complaint unticks a lead only while it is still
   *  at the address the email went to. */
  hmacKey: Buffer;
  /** Tell the operator a gym was stopped (the "have a look" list). Never throws. */
  tellOperator: (stopped: StoppedGym) => Promise<void>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Only these reports (Svix ids), for a test that shares its database with other
   *  suites; production passes nothing. */
  eventIds?: readonly string[];
}

export interface ResultsRun {
  applied: number;
  ignored: number;
  deferred: number;
  givenUp: number;
  stopped: number;
  /** Resend refused to show an email: the key cannot read emails. The run stopped. */
  denied: boolean;
  forgotten: number;
}

export async function processInviteResults(deps: ResultsDeps): Promise<ResultsRun> {
  const run: ResultsRun = { applied: 0, ignored: 0, deferred: 0, givenUp: 0, stopped: 0, denied: false, forgotten: 0 };
  for (let taken = 0; taken < INVITE_RESULTS.perRun; taken++) {
    const event = await webhooks.claimDueEvent(deps.sql, deps.now(), INVITE_RESULTS.leaseMs, deps.eventIds ?? null);
    if (event === null) break;
    const outcome = await processOne(deps, event);
    if (outcome === "denied") {
      run.denied = true;
      break;
    }
    if (outcome === "stopped") {
      run.applied += 1;
      run.stopped += 1;
    } else run[outcome] += 1;
  }
  const keepSince = new Date(deps.now().getTime() - INVITE_RESULTS.keepDays * 24 * 60 * 60 * 1000);
  run.forgotten = await webhooks.forgetOldResendEvents(deps.sql, keepSince, 1000);
  return run;
}

type Outcome = "applied" | "ignored" | "deferred" | "givenUp" | "stopped" | "denied";

async function processOne(deps: ResultsDeps, event: webhooks.ClaimedEvent): Promise<Outcome> {
  const payload = event.payload;
  if (payload === null) {
    await webhooks.finishEvent(deps.sql, event, "failed", deps.now());
    deps.log.warn({ event: "invite.result_unreadable", webhookEventId: event.id }, "a kept Resend report no longer parses");
    return "givenUp";
  }
  const later = (ms: number) => new Date(deps.now().getTime() + ms);
  if (deps.now().getTime() - event.receivedAt.getTime() >= INVITE_RESULTS.maxAgeMs) {
    await webhooks.finishEvent(deps.sql, event, "failed", deps.now());
    deps.log.warn({ event: "invite.result_expired", webhookEventId: event.id, type: payload.type }, "a Resend report could not be settled in a week");
    return "givenUp";
  }
  // Only invitations and lead follow-ups are acted on; a sign-in code's report is not ours
  // to judge.
  const send = await reportedSend(deps.sql, payload);
  if (send === null) {
    await webhooks.finishEvent(deps.sql, event, "done", deps.now());
    return "ignored";
  }
  // The sender is still sending it, or trying again after an unclear answer: the report
  // waits for the row to say how it ended.
  if (send.state === "queued" || send.state === "sending") {
    await webhooks.deferEvent(deps.sql, event, later(INVITE_RESULTS.waitMs), false);
    return "deferred";
  }
  const wentAfterAll = send.state === "failed" && send.reason === "send_unknown";
  const otherEmail = send.state === "sent" && send.providerId !== null && send.providerId !== payload.emailId;
  if ((send.state !== "sent" && !wentAfterAll) || otherEmail) {
    await webhooks.finishEvent(deps.sql, event, "done", deps.now());
    deps.log.warn({ event: "invite.result_mismatch", webhookEventId: event.id, sendId: send.id }, "a Resend report names an email that did not go");
    return "ignored";
  }

  const record = await deps.reader.read(payload.emailId);
  await deps.sleep(INVITE_RESULTS.gapMs);
  if (record.kind === "denied") {
    deps.log.error(
      { event: "invite.result_denied", status: record.status },
      "Resend would not show an email: its API key needs Full access to confirm reports",
    );
    await webhooks.deferEvent(deps.sql, event, later(15 * 60_000), false);
    return "denied";
  }
  if (record.kind === "unavailable") {
    await webhooks.deferEvent(deps.sql, event, later(INVITE_RESULTS.waitMs), false);
    return "deferred";
  }
  // A tagged report must be about the email Resend holds under that tag.
  const tagName = send.kind === "invite" ? INVITE_SEND_TAG : LEAD_SEND_TAG;
  const tagValue = send.kind === "invite" ? payload.sendId : payload.leadSendId;
  const tagAgrees =
    record.kind === "found" && (tagValue === null || record.tags.some((tag) => tag.name === tagName && tag.value === tagValue));
  const confirmation = record.kind === "found" && tagAgrees ? confirm(payload.type, record.lastEvent) : "disagrees";
  if (confirmation !== "agrees") {
    if (event.tries + 1 >= INVITE_RESULTS.maxTries) {
      await webhooks.finishEvent(deps.sql, event, "failed", deps.now());
      deps.log.warn(
        {
          event: "invite.result_unconfirmed",
          webhookEventId: event.id,
          type: payload.type,
          record: record.kind === "found" ? record.lastEvent : record.kind,
        },
        "Resend's record never agreed with a report; it was not acted on",
      );
      return "givenUp";
    }
    const wait = INVITE_RESULTS.retryAfterMs[Math.min(event.tries, INVITE_RESULTS.retryAfterMs.length - 1)] ?? 60_000;
    await webhooks.deferEvent(deps.sql, event, later(wait), true);
    return "deferred";
  }

  const effect = effectOf(payload);
  const at = deps.now();
  // Before the gym's lock, in its own transaction, as the Stop link does it: the lead is
  // never locked after the gym's row. Twice is once.
  if (send.kind === "lead" && effect.suppress === "complained") await untickComplainedLead(deps, send, at);
  const rows = send.kind === "invite" ? inviteRows : leadRows;
  const done = await deps.sql
    .begin(async (tx) => {
      await listRepo.lockGym(tx, send.gymId);
      // Only a report that the email reached a mail server shows it went: Resend's
      // "failed" and its own refusal say it never left, so the row keeps "couldn't confirm".
      if (wentAfterAll && effect.result !== "failed" && effect.result !== "refused") {
        await rows.markWentAfterAll(tx, send.gymId, send.id, payload.emailId);
      }
      const current = await rows.forResult(tx, send.gymId, send.id);
      if (current === null) return { mine: await webhooks.finishEvent(tx, event, "done", at), stopped: null };
      if (replacesResult(effect.result, current.result)) await rows.setResult(tx, send.gymId, send.id, effect.result, at);
      if (effect.suppress === "bounced" || effect.suppress === "refused") await repo.suppressEveryGym(tx, current.hmac, effect.suppress);
      if (effect.suppress === "complained") await repo.suppressForGym(tx, send.gymId, current.hmac, "complained");
      // An email to a lead the gym's page ticked counts apart, and can pause only such
      // emails, never the gym's invitations: anybody can type an address into the page
      // (the security pass over 20c; Kd, RULINGS 2026-09-30).
      if (send.kind === "lead" && send.fromPage) {
        const pageReason = judgeGym(await repo.pageCounts(tx, send.gymId));
        if (pageReason !== null && (await repo.stopPageEmails(tx, send.gymId, pageReason, at))) {
          deps.log.warn({ event: "lead.page_emails_stopped", gymId: send.gymId, reason: pageReason }, "a gym's emails to leads from its page were paused");
        }
        if (!(await webhooks.finishEvent(tx, event, "done", at))) throw new LeaseLost();
        return { mine: true, stopped: null };
      }
      const counts = await repo.gymCounts(tx, send.gymId);
      const reason = judgeGym(counts);
      const stopped = reason !== null && (await repo.stopGym(tx, send.gymId, reason, at)) ? { reason, counts } : null;
      // Another run took this report over while it waited: its own run writes it.
      if (!(await webhooks.finishEvent(tx, event, "done", at))) throw new LeaseLost();
      return { mine: true, stopped };
    })
    .catch((err: unknown) => {
      if (err instanceof LeaseLost) return { mine: false, stopped: null };
      throw err;
    });
  if (!done.mine) return "ignored";
  if (done.stopped === null) return "applied";
  const name = (await repo.gymName(deps.sql, send.gymId)) ?? "";
  deps.log.warn(
    { event: "invite.gym_stopped", gymId: send.gymId, reason: done.stopped.reason, sent: done.stopped.counts.sent, bounced: done.stopped.counts.bounced },
    "a gym's emails through the app were stopped",
  );
  await deps.tellOperator({
    gymId: send.gymId,
    gymName: name,
    reason: done.stopped.reason,
    sent: done.stopped.counts.sent,
    bounced: done.stopped.counts.bounced,
  });
  return "stopped";
}
class LeaseLost extends Error {}

/** The email a report names: an invitation or a lead's follow-up, by its tag, or else by
 *  Resend's id among the emails that went. */
type ReportedSend = (repo.ReportedSend & { kind: "invite" }) | (leadRepo.ReportedLeadSend & { kind: "lead" });

async function reportedSend(sql: Sql, payload: webhooks.StoredResendEvent): Promise<ReportedSend | null> {
  const providerId = payload.emailId;
  if (payload.sendId !== null || payload.leadSendId === null) {
    const invite = await repo.sendForReport(sql, { sendId: payload.sendId, providerId });
    if (invite !== null) return { ...invite, kind: "invite" };
    // A report tagged as an invitation is about that invitation or nothing.
    if (payload.sendId !== null) return null;
  }
  const lead = await leadRepo.leadSendForReport(sql, { leadSendId: payload.leadSendId, providerId });
  return lead === null ? null : { ...lead, kind: "lead" };
}

/** The writes a confirmed report makes, for each kind of email. */
interface ResultRows {
  markWentAfterAll: (tx: TransactionSql, gymId: string, sendId: string, providerId: string) => Promise<void>;
  forResult: (tx: TransactionSql, gymId: string, sendId: string) => Promise<{ result: MemberInviteEmailResult | null; hmac: string } | null>;
  setResult: (tx: TransactionSql, gymId: string, sendId: string, result: MemberInviteEmailResult, at: Date) => Promise<void>;
}
const inviteRows: ResultRows = { markWentAfterAll: repo.markWentAfterAll, forResult: repo.sendForResult, setResult: repo.setResult };
const leadRows: ResultRows = {
  markWentAfterAll: leadRepo.markLeadWentAfterAll,
  forResult: leadRepo.leadSendForResult,
  setResult: leadRepo.setLeadResult,
};

/** A lead who marked the app's follow-up as spam: their tick comes off if it is still at
 *  the address the email went to, so the panel says they asked to stop. */
async function untickComplainedLead(deps: ResultsDeps, send: leadRepo.ReportedLeadSend, at: Date): Promise<void> {
  await deps.sql.begin(async (tx) => {
    const row = await leadRepo.sendForStop(tx, send.id);
    if (row === null || row.gymId !== send.gymId || row.leadId === null) return;
    const lead = await leadRepo.lockLeadForStop(tx, send.gymId, row.leadId);
    if (lead === null || lead.email === null || lead.emailOkAt === null || emailHmac(deps.hmacKey, lead.email) !== row.hmac) return;
    await leadRepo.untickLead(tx, send.gymId, row.leadId, at);
    await insertAudit(tx, {
      actorUserId: null,
      gymId: send.gymId,
      action: "org.lead_complained",
      targetType: "lead",
      targetId: row.leadId,
      meta: {},
    });
  });
}
