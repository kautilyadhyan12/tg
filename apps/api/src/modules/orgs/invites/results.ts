// The worker's half of what comes back (Part 3 §9.12; ROADMAP 3b-i-b). Each Resend
// report the webhook kept is checked against Resend's own record of the email, then
// written: the email's result, a suppression, and the gym's standing.
//
// Everything here is safe to run twice: a result only moves to a more serious one, a
// suppression is kept once, and only the run that stops a gym tells the operator.
import { INVITE_SEND_TAG } from "@app/shared";
import type { Sql } from "postgres";
import type { EmailRecordReader } from "../../../email/resend.js";
import * as webhooks from "../../webhooks/repo.js";
import * as listRepo from "../memberList/repo.js";
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
  /** Tell the operator a gym was stopped (the "have a look" list). Never throws. */
  tellOperator: (stopped: StoppedGym) => Promise<void>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
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
    const event = await webhooks.claimDueEvent(deps.sql, deps.now(), INVITE_RESULTS.leaseMs);
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
  // Only invitations are acted on; a sign-in code's report is not ours to judge.
  const send = await repo.sendForReport(deps.sql, { sendId: payload.sendId, providerId: payload.emailId });
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
  const tagAgrees =
    record.kind === "found" &&
    (payload.sendId === null || record.tags.some((tag) => tag.name === INVITE_SEND_TAG && tag.value === payload.sendId));
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
  const done = await deps.sql
    .begin(async (tx) => {
      await listRepo.lockGym(tx, send.gymId);
      // Only a report that the email reached a mail server shows it went: Resend's
      // "failed" and its own refusal say it never left, so the row keeps "couldn't confirm".
      if (wentAfterAll && effect.result !== "failed" && effect.result !== "refused") {
        await repo.markWentAfterAll(tx, send.gymId, send.id, payload.emailId);
      }
      const current = await repo.sendForResult(tx, send.gymId, send.id);
      if (current === null) return { mine: await webhooks.finishEvent(tx, event, "done", at), stopped: null };
      if (replacesResult(effect.result, current.result)) await repo.setResult(tx, send.gymId, send.id, effect.result, at);
      if (effect.suppress === "bounced" || effect.suppress === "refused") await repo.suppressEveryGym(tx, current.hmac, effect.suppress);
      if (effect.suppress === "complained") await repo.suppressForGym(tx, send.gymId, current.hmac, "complained");
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
    "a gym's invitations were stopped",
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
