// THE ONE RULE for a paid subscription's state (Part 5 §3; CLAUDE.md §4 "Money"). Pure:
// given what our row says and what Paddle's own record says now, it decides what to
// write. It never reads a webhook's payload: the caller fetched `snapshot` from Paddle.
//
// Paddle's status maps onto ours: active → active, past_due → past_due, canceled and
// paused → expired (the plan grants nothing). A cancel Paddle has only SCHEDULED stays
// active with `cancelAtPeriodEnd`, because the gym has paid to the end of the month;
// our own `canceled` status is not used for a Paddle row (Part 5 §3's `canceled` would
// stop granting at once in this codebase's live set). Paddle trials are not sold.
//
// The 5-day grace (Part 5 §8): the worker moves a row past_due for 5 days to expired
// with `graceEnded`. Paddle still says past_due while it retries, and that never opens
// the row again; only a payment (active) does. Paddle ending the subscription clears
// `graceEnded`, so the gym may then Subscribe afresh.

export type LocalStatus = "trialing" | "active" | "past_due" | "canceled" | "expired";
export type ProviderStatus = "active" | "past_due" | "paused" | "canceled" | "trialing";
export type WrittenStatus = "active" | "past_due" | "expired";

export interface LocalRow {
  status: LocalStatus;
  /** Paddle's `updated_at` for the record this row was last written from. */
  providerUpdatedAt: Date | null;
  planId: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Expired by the worker at the end of the grace, while Paddle may still collect. */
  graceEnded: boolean;
}

export interface Snapshot {
  status: ProviderStatus;
  updatedAt: Date;
  planId: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export type BillingEvent =
  | "activated"
  | "payment_failed"
  | "recovered"
  | "plan_changed"
  | "cancel_scheduled"
  | "cancel_withdrawn"
  | "renewed"
  | "updated"
  | "ended"
  | "reactivated";

export type Decision =
  | { kind: "insert"; status: WrittenStatus; event: BillingEvent }
  | { kind: "update"; status: WrittenStatus; event: BillingEvent }
  /** A second live plan for a gym that already has one: cancel it at Paddle and refund it. */
  | { kind: "duplicate" }
  | { kind: "ignore"; reason: "stale" | "unchanged" | "trial_not_sold" | "not_ours" | "conflict" };

const LIVE: readonly LocalStatus[] = ["trialing", "active", "past_due"];

export function targetStatus(status: ProviderStatus): WrittenStatus | null {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "paused":
      return "expired";
    case "trialing":
      return null;
  }
}

/** `otherLive`: the gym holds a live subscription OTHER than this row. */
export function decide(input: { row: LocalRow | null; otherLive: boolean; snapshot: Snapshot }): Decision {
  const { row, otherLive, snapshot } = input;
  const target = targetStatus(snapshot.status);
  if (target === null) return { kind: "ignore", reason: "trial_not_sold" };
  if (row !== null && row.providerUpdatedAt !== null && snapshot.updatedAt.getTime() < row.providerUpdatedAt.getTime()) {
    return { kind: "ignore", reason: "stale" };
  }
  if (row !== null && (row.status === "trialing" || row.status === "canceled")) return { kind: "ignore", reason: "not_ours" };

  if (row === null) {
    if (target === "expired") return { kind: "insert", status: "expired", event: "ended" };
    return otherLive ? { kind: "duplicate" } : { kind: "insert", status: target, event: "activated" };
  }

  const rowLive = LIVE.includes(row.status);
  if (!rowLive) {
    // Paddle ended a subscription whose grace had already run out: nothing more to collect.
    if (target === "expired") return row.graceEnded ? { kind: "update", status: "expired", event: "ended" } : { kind: "ignore", reason: "unchanged" };
    // Still unpaid: an ended row opens again only on a payment.
    if (target === "past_due") return { kind: "ignore", reason: "unchanged" };
    return otherLive ? { kind: "ignore", reason: "conflict" } : { kind: "update", status: target, event: "reactivated" };
  }
  if (target === "expired") return { kind: "update", status: "expired", event: "ended" };

  const event = liveChange(row, snapshot, target);
  return event === null ? { kind: "ignore", reason: "unchanged" } : { kind: "update", status: target, event };
}

function liveChange(row: LocalRow, snapshot: Snapshot, target: WrittenStatus): BillingEvent | null {
  if (row.status === "active" && target === "past_due") return "payment_failed";
  if (row.status === "past_due" && target === "active") return "recovered";
  if (row.planId !== snapshot.planId) return "plan_changed";
  if (!row.cancelAtPeriodEnd && snapshot.cancelAtPeriodEnd) return "cancel_scheduled";
  if (row.cancelAtPeriodEnd && !snapshot.cancelAtPeriodEnd) return "cancel_withdrawn";
  const was = row.currentPeriodEnd?.getTime() ?? null;
  const now = snapshot.currentPeriodEnd?.getTime() ?? null;
  if (was !== null && now !== null && now > was) return "renewed";
  if (was !== now) return "updated";
  return null;
}
