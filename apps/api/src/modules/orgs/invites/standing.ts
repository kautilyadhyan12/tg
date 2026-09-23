// What Resend's reports mean for a gym's invitations (Part 3 §9.12; ROADMAP 3b-i-b).
// Pure: each rule takes the facts read that moment and answers.
//
// - A report is acted on only when Resend's own record of the email agrees with it.
// - A hard bounce, or an address Resend itself refuses, keeps the address from every
//   gym's invitations; a complaint from that gym's. Only a hard bounce counts against
//   the gym that sent it.
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

/** What a confirmed report does to the email, and which suppression it writes:
 *  `bounced` and `refused` for every gym, `complained` for the email's gym. */
export interface ReportEffect {
  result: MemberInviteEmailResult;
  suppress: "bounced" | "refused" | "complained" | null;
}

export function effectOf(event: StoredResendEvent): ReportEffect {
  switch (event.type) {
    case "email.delivered":
      return { result: "delivered", suppress: null };
    case "email.bounced":
      // Resend's own list, which a bounce or a complaint about ANY of the account's email
      // puts an address on ("Email suppressions", resend.com/docs): no gym can reach it,
      // but it says nothing against this gym's list.
      if (event.bounceSubType?.toLowerCase() === "suppressed") return { result: "refused", suppress: "refused" };
      // Resend's bounced event is a permanent rejection; a bounce it types otherwise
      // ("Transient", "Undetermined") did not arrive but says nothing about the address.
      return event.bounceType === null || event.bounceType.toLowerCase() === "permanent"
        ? { result: "bounced", suppress: "bounced" }
        : { result: "failed", suppress: null };
    case "email.suppressed":
      return { result: "refused", suppress: "refused" };
    case "email.complained":
      return { result: "complained", suppress: "complained" };
    case "email.failed":
      return { result: "failed", suppress: null };
  }
}

/** Resend's events before any result: its record has not caught up yet. */
const BEFORE_RESULT = ["queued", "scheduled", "sent", "delivery_delayed"];

/** For each report, the `last_event` values that confirm it, and those that may come
 *  before it (asked again later). Anything else contradicts it. An open or a click can
 *  come after a complaint and replace it as the last event, and a bounce can follow a
 *  delivery. */
const CONFIRMATION: Readonly<Record<StoredResendEvent["type"], { agrees: readonly string[]; before: readonly string[] }>> = {
  "email.delivered": { agrees: ["delivered", "opened", "clicked", "complained", "bounced"], before: BEFORE_RESULT },
  "email.complained": { agrees: ["complained", "opened", "clicked"], before: [...BEFORE_RESULT, "delivered"] },
  "email.bounced": { agrees: ["bounced", "suppressed"], before: [...BEFORE_RESULT, "delivered"] },
  "email.suppressed": { agrees: ["suppressed", "bounced"], before: BEFORE_RESULT },
  "email.failed": { agrees: ["failed"], before: BEFORE_RESULT },
};

export type Confirmation = "agrees" | "not_yet" | "disagrees";

export function confirm(type: StoredResendEvent["type"], lastEvent: string): Confirmation {
  const rule = CONFIRMATION[type];
  if (rule.agrees.includes(lastEvent)) return "agrees";
  return rule.before.includes(lastEvent) ? "not_yet" : "disagrees";
}

const RANK: Readonly<Record<MemberInviteEmailResult, number>> = { delivered: 0, failed: 1, refused: 2, bounced: 3, complained: 4 };

/** An email keeps its most serious result: a delivery reported after a bounce, or a
 *  report that arrives twice, changes nothing. */
export const replacesResult = (next: MemberInviteEmailResult, current: MemberInviteEmailResult | null): boolean =>
  current === null || RANK[next] > RANK[current];

export interface GymCounts {
  /** Emails sent since the gym's counts start, less those Resend refused to deliver. */
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
