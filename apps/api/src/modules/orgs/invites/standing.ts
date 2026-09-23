// What Resend's reports mean for a gym's invitations (Part 3 §9.12; ROADMAP 3b-i-b).
// Pure: each rule takes the facts read that moment and answers.
//
// - A report is acted on only when Resend's own record of the email agrees with it.
// - A hard bounce keeps the address from every gym's invitations; a complaint from
//   that gym's.
// - A gym's first 50 emails go and the rest wait until all 50 have a result, or an
//   hour after the 50th went.
// - A gym stops when its hard bounces pass 2 % of what it sent (counted as if it had
//   sent at least 50, so a second bounce in the first 50 stops it), or on any complaint
//   about one of its first 100.
import type { MemberInviteEmailResult } from "@app/shared";
import type { StoredResendEvent } from "../../webhooks/repo.js";

export const INVITE_STANDING = {
  firstBatch: 50,
  firstBatchWaitMs: 60 * 60 * 1000,
  /** 2 %: a gym stops when bounced × 50 > the larger of sent and 50. */
  bounceShareOf: 50,
  complaintWindow: 100,
} as const;

/** What a confirmed report does to the email, and to whom it stops sending. */
export interface ReportEffect {
  result: MemberInviteEmailResult;
  suppress: "every_gym" | "this_gym" | null;
}

export function effectOf(event: StoredResendEvent): ReportEffect {
  switch (event.type) {
    case "email.delivered":
      return { result: "delivered", suppress: null };
    case "email.bounced":
      // Resend's bounced event is a permanent rejection; a bounce it types otherwise
      // ("Transient", "Undetermined") did not arrive but says nothing about the address.
      return event.bounceType === null || event.bounceType.toLowerCase() === "permanent"
        ? { result: "bounced", suppress: "every_gym" }
        : { result: "failed", suppress: null };
    case "email.suppressed":
      // Resend refused it because the address is on its own list: no gym can reach it.
      return { result: "bounced", suppress: "every_gym" };
    case "email.complained":
      return { result: "complained", suppress: "this_gym" };
    case "email.failed":
      return { result: "failed", suppress: null };
  }
}

/** Resend's `last_event` values that confirm each report. A later event confirms an
 *  earlier one (a complaint follows delivery). */
const CONFIRMED_BY: Readonly<Record<StoredResendEvent["type"], readonly string[]>> = {
  "email.delivered": ["delivered", "complained", "opened", "clicked"],
  "email.bounced": ["bounced"],
  "email.suppressed": ["suppressed", "bounced"],
  "email.complained": ["complained"],
  "email.failed": ["failed"],
};

/** Events that come before any result: the record has not caught up yet. */
const NOT_YET = new Set(["queued", "scheduled", "sent", "delivery_delayed"]);

export type Confirmation = "agrees" | "not_yet" | "disagrees";

export function confirm(type: StoredResendEvent["type"], lastEvent: string): Confirmation {
  if (CONFIRMED_BY[type].includes(lastEvent)) return "agrees";
  return NOT_YET.has(lastEvent) ? "not_yet" : "disagrees";
}

const RANK: Readonly<Record<MemberInviteEmailResult, number>> = { delivered: 0, failed: 1, bounced: 2, complained: 3 };

/** An email keeps its most serious result: a delivery reported after a bounce, or a
 *  report that arrives twice, changes nothing. */
export const replacesResult = (next: MemberInviteEmailResult, current: MemberInviteEmailResult | null): boolean =>
  current === null || RANK[next] > RANK[current];

export interface GymCounts {
  /** Emails sent since the gym's counts start. */
  sent: number;
  /** Of those, hard bounces. */
  bounced: number;
  /** A complaint about one of the first 100 of those. */
  complainedEarly: boolean;
}

export type StopReason = "bounces" | "complaint";

/** Should the gym's invitations stop? */
export function judgeGym(counts: GymCounts): StopReason | null {
  if (counts.complainedEarly) return "complaint";
  if (counts.bounced * INVITE_STANDING.bounceShareOf > Math.max(counts.sent, INVITE_STANDING.firstBatch)) return "bounces";
  return null;
}

export interface GateFacts {
  stopped: boolean;
  /** Emails sent since the counts start, plus those being sent now, up to the first batch. */
  sentOrSending: number;
  /** The first batch's sent emails (up to 50), how many have a result, and when the
   *  last of them went. */
  firstBatch: { sent: number; withResult: number; lastSentAt: Date | null };
}

/** May the worker take another email of this gym now? */
export function mayGymSend(facts: GateFacts, now: Date): boolean {
  if (facts.stopped) return false;
  if (facts.sentOrSending < INVITE_STANDING.firstBatch) return true;
  // The 50th has been handed over but has not finished yet.
  if (facts.firstBatch.sent < INVITE_STANDING.firstBatch || facts.firstBatch.lastSentAt === null) return false;
  if (facts.firstBatch.withResult >= INVITE_STANDING.firstBatch) return true;
  return now.getTime() - facts.firstBatch.lastSentAt.getTime() >= INVITE_STANDING.firstBatchWaitMs;
}
