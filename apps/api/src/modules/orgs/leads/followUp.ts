// When a lead's next follow-up email is due (spec Part 3 §16.3; ROADMAP 20c-ii;
// RULINGS 2026-09-27). The gym sends the three from its own mailbox; the app only
// says which lead is due one, and on which of the gym's days. Pure.
//
// The first is due on the day "Happy to hear from us" was ticked, the second 3 days
// after the first was sent, the third 4 days after the second: day 0, 3 and 7 when
// each goes on its day. Only a New lead with the tick is ever due, so moving the
// status, taking the tick off or changing the email stops them.
import { LEAD_FOLLOW_UPS, type LeadStatus } from "@app/shared";

/** Days from the one before: the first counts from the tick. */
const GAP_DAYS = [0, 3, 4] as const;

export interface FollowUpFacts {
  status: LeadStatus;
  /** The lead said yes to email at its current address. */
  ticked: boolean;
  /** How many staff have marked as sent. */
  sent: number;
  /** The gym's day of the tick, and of the last one sent (YYYY-MM-DD). */
  tickDay: string | null;
  lastSentDay: string | null;
}

function addDays(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The gym's day the next one is due, or null when none is. */
export function followUpDueOn(facts: FollowUpFacts): string | null {
  if (facts.status !== "new" || !facts.ticked) return null;
  if (!Number.isInteger(facts.sent) || facts.sent < 0 || facts.sent >= LEAD_FOLLOW_UPS) return null;
  const gap = GAP_DAYS[facts.sent];
  const from = facts.sent === 0 ? facts.tickDay : facts.lastSentDay;
  if (gap === undefined || from === null) return null;
  return addDays(from, gap);
}
