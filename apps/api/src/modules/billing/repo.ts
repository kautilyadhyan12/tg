// A gym paying us: its checkouts, its paid subscription and its size changes (ROADMAP
// Stage 3 items 1a, 1c-i, 1c-ii, 1c-iii and, for an Indian gym through Razorpay, 1d-i).
// Every checkout is read with its gym in the WHERE; a Paddle or Razorpay subscription is
// placed on a gym only through a checkout row our server wrote.
import { GYM_TRIAL_MEMBERS, type PaddleSubscription } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { insertAudit, lockOrgRow } from "../orgs/repo.js";
import { decide, type Decision, type LocalStatus, type Snapshot } from "./machine.js";
import { upgradeCharge } from "./razorpayPlan.js";

type SqlOrTx = Sql | TransactionSql;

/** `cancel_reason` of a paid plan whose grace ran out while Paddle still retries. */
export const GRACE_EXPIRED = "grace_expired";
/** `cancel_reason` of a free trial ended because the gym paid during it (1c-ii). */
export const TRIAL_SUBSCRIBED = "subscribed";


/** `approved` and `dropped` are a smaller size's through Razorpay (1d-iii-b): its window approved
 *  and waiting on the gym's plan, then no longer waiting and ended at Razorpay. */
export type CheckoutState = "creating" | "open" | "superseded" | "failed" | "paid" | "approved" | "dropped";

/** Whether a checkout that replaces a plan is for a bigger or a smaller size. */
export type SizeDirection = "bigger" | "smaller";

/** Who a gym pays through: Razorpay for an Indian gym, Paddle for every other. */
export type PayProvider = "paddle" | "razorpay";

export interface CheckoutRow {
  id: string;
  gymId: string;
  planCode: string;
  state: CheckoutState;
  provider: PayProvider;
  /** Paddle: the transaction. Razorpay: the subscription our server created. */
  providerRef: string | null;
  /** The plan it sold. */
  planId: string;
  /** A bigger size (1d-iii-a): the gym's plan it replaces once paid, null for a first plan. */
  replacesRowId: string | null;
  /** When the replaced plan's paid month began: with `startsAt`, the month a bigger size is priced in. */
  periodStart: Date | null;
  /** When the replaced plan's paid month ends: the new price is first charged then. */
  startsAt: Date | null;
  /** The rest of this month's difference, taken as the window is paid; null when none. */
  upfrontMinor: number | null;
  /** Bigger or smaller, for a checkout that replaces a plan; null for a first plan. */
  direction: SizeDirection | null;
}

interface RawCheckout {
  id: string;
  gym_id: string;
  plan_id: string;
  plan_code: string;
  state: string;
  provider: string;
  provider_ref: string | null;
  replaces_subscription_id: string | null;
  period_start: Date | null;
  starts_at: Date | null;
  upfront_minor: number | null;
  size_direction: string | null;
}

const STATES: readonly CheckoutState[] = ["creating", "open", "superseded", "failed", "paid", "approved", "dropped"];
const DIRECTIONS: readonly SizeDirection[] = ["bigger", "smaller"];
const PROVIDERS: readonly PayProvider[] = ["paddle", "razorpay"];

function toCheckout(raw: RawCheckout): CheckoutRow {
  const state = STATES.find((s) => s === raw.state);
  if (state === undefined) throw new Error(`unknown checkout state ${raw.state}`);
  const provider = PROVIDERS.find((p) => p === raw.provider);
  if (provider === undefined) throw new Error(`unknown checkout provider ${raw.provider}`);
  const direction = raw.size_direction === null ? null : (DIRECTIONS.find((d) => d === raw.size_direction) ?? null);
  if (raw.size_direction !== null && direction === null) throw new Error(`unknown size direction ${raw.size_direction}`);
  return {
    id: raw.id,
    gymId: raw.gym_id,
    planCode: raw.plan_code,
    state,
    provider,
    providerRef: raw.provider_ref,
    planId: raw.plan_id,
    replacesRowId: raw.replaces_subscription_id,
    periodStart: raw.period_start,
    startsAt: raw.starts_at,
    upfrontMinor: raw.upfront_minor,
    direction,
  };
}

/** The members a gym is paying for: every live membership, the owner's and staff's
 *  included (§10.4). The same count as `claimSeat`'s cap and `listOrgsForUser`'s meter
 *  (orgs/repo.ts). */
export async function seatsUsed(sql: SqlOrTx, gymId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_members m
    WHERE m.gym_id = ${gymId} AND m.removed_at IS NULL`;
  return rows[0]?.n ?? 0;
}

export type BeginCheckoutOutcome =
  | {
      kind: "created";
      checkout: CheckoutRow;
      /** Paddle's price (`pri_…`), or Razorpay's plan (`plan_…`). */
      providerPriceId: string;
      priceMinor: number;
      currency: string;
      /** The checkouts this press replaced, still open at their provider: the caller closes each. */
      superseded: { provider: PayProvider; ref: string }[];
    }
  | { kind: "replay"; checkout: CheckoutRow }
  | { kind: "key_reused" }
  | { kind: "already_subscribed" }
  | { kind: "payment_overdue" }
  | { kind: "no_such_plan" }
  | { kind: "plan_too_small"; seatCap: number; seatsUsed: number }
  | { kind: "not_set_up" }
  | { kind: "org_archived" }
  | { kind: "not_found" };

/** Start a checkout for one plan: under the gym's lock, so two presses at once cannot
 *  both pass the checks, and any checkout still open for this gym is superseded (its
 *  Paddle transaction is cancelled by the caller) so only one can be paid. Every checkout
 *  charges now, in the gym's own free trial too: paying ends the trial and opens the plan's
 *  full size (Kd, RULINGS 2026-09-30). */
export async function beginCheckout(
  sql: Sql,
  input: { gymId: string; userId: string; planCode: string; idempotencyKey: string; currency: string; provider: PayProvider },
): Promise<BeginCheckoutOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const gyms = await tx<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined) return { kind: "not_found" };
    if (gym.status !== "active") return { kind: "org_archived" };

    const earlier = await tx<RawCheckout[]>`
      SELECT c.id, c.gym_id, c.plan_id, p.code AS plan_code, c.state, c.provider, c.provider_ref,
             c.replaces_subscription_id, c.period_start, c.starts_at, c.upfront_minor, c.size_direction
      FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
      WHERE c.gym_id = ${input.gymId} AND c.idempotency_key = ${input.idempotencyKey}`;
    const replay = earlier[0];
    if (replay !== undefined) {
      return replay.plan_code === input.planCode ? { kind: "replay", checkout: toCheckout(replay) } : { kind: "key_reused" };
    }

    const live = await tx<{ status: string; provider: string; trial_ends_at: Date | null }[]>`
      SELECT status, provider, trial_ends_at FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId}
        AND status IN ('trialing','active','past_due')`;
    const current = live[0];
    // The gym's own free trial may be paid for now, and ends when that payment lands; anything
    // else live is a plan already chosen.
    if (current !== undefined && !isLocalTrial(current)) return { kind: "already_subscribed" };
    // An unpaid plan its provider still retries: paying it there opens it, a second plan would double it.
    const overdue = await tx`
      SELECT 1 FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND cancel_reason = ${GRACE_EXPIRED}
      LIMIT 1`;
    if (overdue.length > 0) return { kind: "payment_overdue" };

    const plans = await tx<
      { id: string; seat_cap: number | null; paddle_price_id: string | null; razorpay_plan_id: string | null; price_minor: number; currency: string }[]
    >`
      SELECT id, seat_cap, paddle_price_id, razorpay_plan_id, price_minor, currency FROM plans
      WHERE code = ${input.planCode} AND audience = 'org' AND active = true
        AND interval = 'month' AND currency = ${input.currency}`;
    const plan = plans[0];
    if (plan === undefined) return { kind: "no_such_plan" };
    const used = await seatsUsed(tx, input.gymId);
    if (plan.seat_cap !== null && used > plan.seat_cap) return { kind: "plan_too_small", seatCap: plan.seat_cap, seatsUsed: used };
    const providerPriceId = input.provider === "razorpay" ? plan.razorpay_plan_id : plan.paddle_price_id;
    if (providerPriceId === null) return { kind: "not_set_up" };

    const superseded = await tx<{ provider: string; provider_ref: string | null }[]>`
      UPDATE billing_checkouts SET state = 'superseded', updated_at = now()
      WHERE gym_id = ${input.gymId} AND state IN ('creating','open')
      RETURNING provider, provider_ref`;
    const inserted = await tx<RawCheckout[]>`
      INSERT INTO billing_checkouts (gym_id, plan_id, created_by, idempotency_key, provider)
      VALUES (${input.gymId}, ${plan.id}, ${input.userId}, ${input.idempotencyKey}, ${input.provider})
      RETURNING id, gym_id, plan_id, ${input.planCode}::text AS plan_code, state, provider, provider_ref,
                replaces_subscription_id, period_start, starts_at, upfront_minor, size_direction`;
    const row = inserted[0];
    if (row === undefined) throw new Error("checkout insert returned no row");
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: "billing.checkout_started",
      targetType: "billing_checkout",
      targetId: row.id,
      meta: { plan: input.planCode, provider: input.provider },
    });
    return {
      kind: "created",
      checkout: toCheckout(row),
      providerPriceId,
      priceMinor: plan.price_minor,
      currency: plan.currency,
      superseded: superseded.flatMap((s) => {
        const provider = PROVIDERS.find((p) => p === s.provider);
        return s.provider_ref === null || provider === undefined ? [] : [{ provider, ref: s.provider_ref }];
      }),
    };
  });
}

/** The checkout now has its Paddle transaction or Razorpay subscription. False when another
 *  press superseded it meanwhile: the caller cancels what it just made. */
export async function openCheckout(
  sql: SqlOrTx,
  input: { checkoutId: string; gymId: string; transactionId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE billing_checkouts SET state = 'open', provider_ref = ${input.transactionId}, updated_at = now()
    WHERE id = ${input.checkoutId} AND gym_id = ${input.gymId} AND state = 'creating'
    RETURNING id`;
  return rows.length === 1;
}

export async function failCheckout(sql: SqlOrTx, input: { checkoutId: string; gymId: string }): Promise<void> {
  await sql`
    UPDATE billing_checkouts SET state = 'failed', updated_at = now()
    WHERE id = ${input.checkoutId} AND gym_id = ${input.gymId} AND state = 'creating'`;
}

export async function getCheckout(sql: SqlOrTx, input: { checkoutId: string; gymId: string }): Promise<CheckoutRow | null> {
  const rows = await sql<RawCheckout[]>`
    SELECT c.id, c.gym_id, c.plan_id, p.code AS plan_code, c.state, c.provider, c.provider_ref,
             c.replaces_subscription_id, c.period_start, c.starts_at, c.upfront_minor, c.size_direction
    FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
    WHERE c.id = ${input.checkoutId} AND c.gym_id = ${input.gymId}`;
  const row = rows[0];
  return row === undefined ? null : toCheckout(row);
}

/** The checkout an earlier press with this key made for this gym, if any. */
export async function checkoutForKey(sql: SqlOrTx, input: { gymId: string; idempotencyKey: string }): Promise<CheckoutRow | null> {
  const rows = await sql<RawCheckout[]>`
    SELECT c.id, c.gym_id, c.plan_id, p.code AS plan_code, c.state, c.provider, c.provider_ref,
           c.replaces_subscription_id, c.period_start, c.starts_at, c.upfront_minor, c.size_direction
    FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
    WHERE c.gym_id = ${input.gymId} AND c.idempotency_key = ${input.idempotencyKey}`;
  const row = rows[0];
  return row === undefined ? null : toCheckout(row);
}

/** The checkout our server created this Razorpay subscription for, in whatever state:
 *  where the subscription's gym comes from. */
export async function checkoutForRazorpaySubscription(sql: SqlOrTx, subscriptionId: string): Promise<CheckoutRow | null> {
  const rows = await sql<RawCheckout[]>`
    SELECT c.id, c.gym_id, c.plan_id, p.code AS plan_code, c.state, c.provider, c.provider_ref,
             c.replaces_subscription_id, c.period_start, c.starts_at, c.upfront_minor, c.size_direction
    FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
    WHERE c.provider = 'razorpay' AND c.provider_ref = ${subscriptionId}`;
  const row = rows[0];
  return row === undefined ? null : toCheckout(row);
}

/** Who pays for the gym, as the payment window is told (Kd, RULINGS 2026-09-29 and 2026-09-30):
 *  its owner's email, the mobile given for its payments (`+91…`) and the gym's country, each
 *  null when there is none. */
export async function gymPayer(
  sql: SqlOrTx,
  gymId: string,
): Promise<{ email: string | null; mobile: string | null; country: string | null }> {
  const rows = await sql<{ email: string | null; billing_mobile: string | null; country: string | null }[]>`
    SELECT u.email, g.billing_mobile, g.country FROM gyms g LEFT JOIN users u ON u.id = g.owner_user_id
    WHERE g.id = ${gymId}`;
  return { email: rows[0]?.email ?? null, mobile: rows[0]?.billing_mobile ?? null, country: rows[0]?.country ?? null };
}

/** Which of our rupee plans a Razorpay plan is: only by the id `tools/razorpay-plans.ts` recorded. */
export async function planForRazorpayPlan(sql: SqlOrTx, razorpayPlanId: string): Promise<{ id: string } | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM plans WHERE razorpay_plan_id = ${razorpayPlanId} AND audience = 'org'`;
  return rows[0] ?? null;
}

/** Our checkouts among these Paddle transactions: where a subscription's gym comes from. */
export async function checkoutsForTransactions(sql: SqlOrTx, transactionIds: readonly string[]): Promise<CheckoutRow[]> {
  if (transactionIds.length === 0) return [];
  const rows = await sql<RawCheckout[]>`
    SELECT c.id, c.gym_id, c.plan_id, p.code AS plan_code, c.state, c.provider, c.provider_ref,
             c.replaces_subscription_id, c.period_start, c.starts_at, c.upfront_minor, c.size_direction
    FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
    WHERE c.provider = 'paddle' AND c.provider_ref = ANY(${[...transactionIds]}::text[])
    ORDER BY c.created_at, c.id`;
  return rows.map(toCheckout);
}

/** The member limit of the gym's own free trial: its latest one's (the trial's own limit, or
 *  its plan's for a trial started before it had one), or the trial band of its price list
 *  (the smallest plan with a trial, as starting a trial picks it) at the trial's limit. */
async function freeTrialSeatCap(tx: SqlOrTx, gymId: string): Promise<number | null> {
  const own = await tx<{ seat_cap: number | null }[]>`
    SELECT LEAST(p.seat_cap, s.trial_seat_cap) AS seat_cap FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.owner_type = 'gym' AND s.owner_id = ${gymId}
      AND s.provider IN ('none','pilot') AND s.trial_ends_at IS NOT NULL
    ORDER BY s.created_at DESC
    LIMIT 1`;
  if (own[0] !== undefined) return own[0].seat_cap;
  const band = await tx<{ seat_cap: number | null }[]>`
    SELECT LEAST(p.seat_cap, ${GYM_TRIAL_MEMBERS}::int) AS seat_cap FROM plans p JOIN gyms g ON g.id = ${gymId}
    WHERE p.audience = 'org' AND p.currency = g.currency_display AND p.active = true
      AND p.interval = 'month' AND p.trial_days > 0
    ORDER BY p.seat_cap ASC NULLS LAST, p.price_minor ASC
    LIMIT 1`;
  return band[0]?.seat_cap ?? null;
}

/** When the gym's own free trial ends, or null if it never had one: a Paddle trial it paid
 *  for may not run past it (1c-ii round one, H2). */
export async function ownTrialEnd(sql: SqlOrTx, gymId: string): Promise<Date | null> {
  const rows = await sql<{ trial_ends_at: Date }[]>`
    SELECT trial_ends_at FROM subscriptions
    WHERE owner_type = 'gym' AND owner_id = ${gymId}
      AND provider IN ('none','pilot') AND trial_ends_at IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1`;
  return rows[0]?.trial_ends_at ?? null;
}

/** The gym's own free trial (no card, nobody charging), as opposed to a Paddle trial. */
function isLocalTrial(row: { status: string; provider: string }): boolean {
  return row.status === "trialing" && (row.provider === "none" || row.provider === "pilot");
}

type PaddleItem = PaddleSubscription["items"][number];

/** Which of our plans a Paddle subscription's one item is: a catalogue price by its id, or
 *  a trial checkout's own price (only our API key can make one) by the plan code it
 *  carries, and only at exactly that plan's amount, currency and month. */
export async function planForPaddleItem(sql: SqlOrTx, item: PaddleItem): Promise<{ id: string } | null> {
  const byId = await sql<{ id: string }[]>`
    SELECT id FROM plans WHERE paddle_price_id = ${item.price.id} AND audience = 'org'`;
  if (byId[0] !== undefined) return byId[0];
  const price = item.price;
  const code = price.custom_data?.["plan_code"];
  if (price.type !== "custom" || typeof code !== "string" || price.unit_price === undefined) return null;
  if (price.billing_cycle?.interval !== "month" || price.billing_cycle.frequency !== 1) return null;
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM plans
    WHERE code = ${code} AND audience = 'org' AND interval = 'month' AND paddle_price_id IS NOT NULL
      AND price_minor::text = ${price.unit_price.amount} AND currency = ${price.unit_price.currency_code}`;
  return rows[0] ?? null;
}

export interface PaddleRow {
  id: string;
  gymId: string;
  status: LocalStatus;
  cancelReason: string | null;
  /** When the plan stopped being the gym's; null while live. */
  endedAt: Date | null;
  /** Set to end when the month paid for ends (`currentPeriodEnd`). */
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  /** When the cancel went to Razorpay (an overdue plan's: when Cancel was pressed). */
  cancelSentAt: Date | null;
}

export async function findPaddleSubscription(sql: SqlOrTx, subscriptionId: string): Promise<PaddleRow | null> {
  return await findProviderSubscription(sql, "paddle", subscriptionId);
}

/** The gym's row for one subscription at its provider, if our server placed it. */
export async function findProviderSubscription(sql: SqlOrTx, provider: PayProvider, subscriptionId: string): Promise<PaddleRow | null> {
  const rows = await sql<
    {
      id: string;
      owner_id: string;
      status: LocalStatus;
      cancel_reason: string | null;
      ended_at: Date | null;
      cancel_at_period_end: boolean;
      current_period_end: Date | null;
      cancel_sent_at: Date | null;
    }[]
  >`
    SELECT id, owner_id, status, cancel_reason, ended_at, cancel_at_period_end, current_period_end, cancel_sent_at FROM subscriptions
    WHERE provider = ${provider} AND provider_ref = ${subscriptionId} AND owner_type = 'gym'`;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        gymId: row.owner_id,
        status: row.status,
        cancelReason: row.cancel_reason,
        endedAt: row.ended_at,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        currentPeriodEnd: row.current_period_end,
        cancelSentAt: row.cancel_sent_at,
      };
}

export interface ApplyOutcome {
  decision: Decision;
  /** The row this subscription is, when there is one after the write. */
  rowId: string | null;
  /** The row was set aside as a duplicate, now or before: cancel and refund at Paddle. */
  duplicate: boolean;
  /** The gym's plan this one took the place of (a bigger size, 1d-iii-a), ended in this write:
   *  the caller cancels it at Razorpay. */
  replaced: { rowId: string; subscriptionRef: string } | null;
}

/** Write the provider's record of one subscription onto the gym, through the one rule.
 *  Under the gym's lock (the subscription-writer lock) and in one transaction with its
 *  audit row, so the live-plan check and the write cannot be split by another writer. */
export async function applySnapshot(
  sql: Sql,
  input: {
    gymId: string;
    provider: PayProvider;
    subscriptionId: string;
    customerId: string | null;
    snapshot: Snapshot;
    checkoutId: string | null;
    now: Date;
    /** A bigger (1d-iii-a) or smaller (1d-iii-b) size's checkout: the gym's plan it takes the place
     *  of, and the end of that plan's paid month as it was when the window was opened. A smaller
     *  size (`afterRenewal`) also takes the place of that plan once it has renewed past that end
     *  (the worker was down past the day), or failed to: the plan is then cut back to that end,
     *  so the month it charged after it is refunded (`razorpayCancelOutcome`). */
    replaces?: { rowId: string; periodEnd: Date; afterRenewal?: boolean } | null;
  },
): Promise<ApplyOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const rows = await tx<
      {
        id: string;
        owner_id: string;
        status: LocalStatus;
        provider_updated_at: Date | null;
        plan_id: string;
        current_period_end: Date | null;
        cancel_at_period_end: boolean;
        cancel_reason: string | null;
      }[]
    >`
      SELECT id, owner_id, status, provider_updated_at, plan_id, current_period_end,
             cancel_at_period_end, cancel_reason
      FROM subscriptions
      WHERE provider = ${input.provider} AND provider_ref = ${input.subscriptionId} AND owner_type = 'gym'
      FOR UPDATE`;
    const existing = rows[0] ?? null;
    // A subscription placed on one gym never moves to another.
    if (existing !== null && existing.owner_id !== input.gymId) {
      return { decision: { kind: "ignore", reason: "not_ours" }, rowId: existing.id, duplicate: false, replaced: null };
    }
    const others = await tx<
      {
        id: string;
        status: string;
        provider: string;
        provider_ref: string | null;
        cancel_at_period_end: boolean;
        current_period_end: Date | null;
      }[]
    >`
      SELECT id, status, provider, provider_ref, cancel_at_period_end, current_period_end FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId}
        AND status IN ('trialing','active','past_due')
        AND (${existing?.id ?? null}::uuid IS NULL OR id <> ${existing?.id ?? null}::uuid)`;
    // The gym's own free trial gives way to the plan it paid for during it.
    const localTrial = others.find(isLocalTrial) ?? null;
    // A bigger size gives way only to the plan it was priced against, still as it was then:
    // paying, not set to end, the same month. Anything else and it is a second plan.
    const replaces = existing === null ? (input.replaces ?? null) : null;
    const replaceable =
      replaces === null
        ? null
        : (others.find(
            (o) =>
              o.id === replaces.rowId &&
              o.provider === "razorpay" &&
              o.provider_ref !== null &&
              !o.cancel_at_period_end &&
              (replaces.afterRenewal === true
                ? (o.status === "active" || o.status === "past_due") &&
                  o.current_period_end !== null &&
                  o.current_period_end.getTime() >= replaces.periodEnd.getTime()
                : o.status === "active" && o.current_period_end?.getTime() === replaces.periodEnd.getTime()),
          ) ?? null);
    // Razorpay's record never shows a cancel (1d-ii): whether a plan is set to end is our own
    // row's, read here under the lock, so an answer fetched before Cancel or Keep my plan was
    // pressed never undoes it.
    const snapshot: Snapshot =
      input.provider === "razorpay" && existing !== null
        ? { ...input.snapshot, cancelAtPeriodEnd: existing.cancel_at_period_end }
        : input.snapshot;
    const decision = decide({
      row:
        existing === null
          ? null
          : {
              status: existing.status,
              providerUpdatedAt: existing.provider_updated_at,
              planId: existing.plan_id,
              currentPeriodEnd: existing.current_period_end,
              cancelAtPeriodEnd: existing.cancel_at_period_end,
              graceEnded: existing.cancel_reason === GRACE_EXPIRED,
            },
      otherLive: others.some((o) => !isLocalTrial(o) && o.id !== replaceable?.id),
      snapshot,
    });
    const s = snapshot;
    const audit = async (rowId: string, action: string) => {
      await insertAudit(tx, {
        actorUserId: null,
        gymId: input.gymId,
        action,
        targetType: "subscription",
        targetId: rowId,
        meta: { provider: input.provider, providerStatus: s.status, via: input.provider },
      });
    };

    let rowId = existing?.id ?? null;
    let replaced: ApplyOutcome["replaced"] = null;
    if (decision.kind === "insert" || decision.kind === "duplicate") {
      const status = decision.kind === "insert" ? decision.status : "expired";
      const ended = status === "expired" ? input.now : null;
      const pastDueSince = status === "past_due" ? input.now : null;
      // A paid trial ends when Paddle takes the first payment, and keeps its free trial's
      // member limit until then (Kd, RULINGS 2026-09-25).
      const trialEndsAt = status === "trialing" ? s.currentPeriodEnd : null;
      const trialSeatCap = status === "trialing" ? await freeTrialSeatCap(tx, input.gymId) : null;
      if (localTrial !== null && status !== "expired") {
        await tx`
          UPDATE subscriptions SET status = 'expired', ended_at = ${input.now}, cancel_reason = ${TRIAL_SUBSCRIBED}
          WHERE id = ${localTrial.id} AND owner_id = ${input.gymId} AND status = 'trialing'`;
        await insertAudit(tx, {
          actorUserId: null,
          gymId: input.gymId,
          action: "billing.trial_replaced",
          targetType: "subscription",
          targetId: localTrial.id,
          meta: { provider: input.provider, via: input.provider },
        });
      }
      if (replaceable !== null && replaceable.provider_ref !== null && status !== "expired") {
        // Ended first (a gym holds one live plan), set to end so any later payment of it is
        // refunded (`razorpayCancelOutcome`); `cancel_sent_at` waits for Razorpay to have ended it.
        const until = replaces?.periodEnd ?? null;
        const ended = await tx`
          UPDATE subscriptions
          SET status = 'expired', ended_at = ${input.now}, cancel_at_period_end = true, cancel_reason = ${REPLACED},
              current_period_end = LEAST(current_period_end, ${until}::timestamptz), past_due_since = NULL,
              pending_plan_id = NULL, pending_from = NULL, pending_requested_plan_id = NULL,
              pending_held_at = NULL, pending_warned_at = NULL, pending_subscription_ref = NULL
          WHERE id = ${replaceable.id} AND owner_id = ${input.gymId} AND status IN ('active','past_due')
          RETURNING id`;
        if (ended.length !== 1) throw new Error("the replaced plan changed under the gym's lock");
        replaced = { rowId: replaceable.id, subscriptionRef: replaceable.provider_ref };
      }
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, trial_ends_at, trial_seat_cap,
                                   current_period_end, cancel_at_period_end, provider, provider_ref,
                                   provider_customer_ref, provider_updated_at, ended_at, cancel_reason,
                                   past_due_since)
        VALUES ('gym', ${input.gymId}, ${s.planId}, ${status}, ${trialEndsAt}, ${trialSeatCap},
                ${s.currentPeriodEnd}, ${s.cancelAtPeriodEnd}, ${input.provider}, ${input.subscriptionId}, ${input.customerId},
                ${s.updatedAt}, ${ended}, ${decision.kind === "duplicate" ? "duplicate" : null},
                ${pastDueSince})
        RETURNING id`;
      rowId = inserted[0]?.id ?? null;
      if (rowId === null) throw new Error("subscription insert returned no row");
      await audit(rowId, decision.kind === "duplicate" ? "billing.duplicate" : `billing.${decision.event}`);
      if (replaced !== null) {
        await insertAudit(tx, {
          actorUserId: null,
          gymId: input.gymId,
          action: "billing.size_replaced",
          targetType: "subscription",
          targetId: replaced.rowId,
          meta: { provider: input.provider, via: input.provider, by: rowId },
        });
      }
    } else if (decision.kind === "update" && existing !== null) {
      await tx`
        UPDATE subscriptions
        SET status = ${decision.status}, plan_id = ${s.planId}, current_period_end = ${s.currentPeriodEnd},
            -- Still in the paid trial: it ends the day Paddle charges.
            trial_ends_at = CASE WHEN ${decision.status} = 'trialing' THEN ${s.currentPeriodEnd}::timestamptz ELSE trial_ends_at END,
            -- A payment taken: the chosen size starts; a failed first charge keeps the trial's.
            trial_seat_cap = CASE WHEN ${decision.status} = 'active' THEN NULL ELSE trial_seat_cap END,
            cancel_at_period_end = ${s.cancelAtPeriodEnd}, provider_updated_at = ${s.updatedAt},
            provider_customer_ref = COALESCE(${input.customerId}, provider_customer_ref),
            ended_at = CASE WHEN ${decision.status} = 'expired' THEN COALESCE(ended_at, ${input.now}) ELSE NULL END,
            -- The grace counts from the first failed payment, not from each retry's.
            past_due_since = CASE WHEN ${decision.status} = 'past_due' THEN COALESCE(past_due_since, ${input.now}) ELSE NULL END,
            -- Paid again, or ended at Paddle: the grace's hold is over either way.
            cancel_reason = CASE WHEN cancel_reason = ${GRACE_EXPIRED} THEN NULL ELSE cancel_reason END,
            -- A smaller size waits until Paddle's plan changes (to it, or to a size chosen
            -- since), or the plan ends.
            pending_plan_id = CASE WHEN plan_id IS DISTINCT FROM ${s.planId}::uuid
                                     OR ${decision.status} NOT IN ('trialing','active','past_due')
                                   THEN NULL ELSE pending_plan_id END,
            pending_from = CASE WHEN plan_id IS DISTINCT FROM ${s.planId}::uuid
                                  OR ${decision.status} NOT IN ('trialing','active','past_due')
                                THEN NULL ELSE pending_from END,
            pending_requested_plan_id = CASE WHEN plan_id IS DISTINCT FROM ${s.planId}::uuid
                                               OR ${decision.status} NOT IN ('trialing','active','past_due')
                                             THEN NULL ELSE pending_requested_plan_id END,
            pending_held_at = CASE WHEN plan_id IS DISTINCT FROM ${s.planId}::uuid
                                     OR ${decision.status} NOT IN ('trialing','active','past_due')
                                   THEN NULL ELSE pending_held_at END,
            pending_warned_at = CASE WHEN plan_id IS DISTINCT FROM ${s.planId}::uuid
                                       OR ${decision.status} NOT IN ('trialing','active','past_due')
                                     THEN NULL ELSE pending_warned_at END,
            -- A smaller size approved at Razorpay stops waiting with them; the worker ends it there.
            pending_subscription_ref = CASE WHEN plan_id IS DISTINCT FROM ${s.planId}::uuid
                                              OR ${decision.status} NOT IN ('trialing','active','past_due')
                                            THEN NULL ELSE pending_subscription_ref END
        WHERE id = ${existing.id}`;
      await audit(existing.id, `billing.${decision.event}`);
    }
    if (input.checkoutId !== null && (decision.kind === "insert" || decision.kind === "duplicate")) {
      await tx`
        UPDATE billing_checkouts SET state = 'paid', updated_at = now()
        WHERE id = ${input.checkoutId} AND gym_id = ${input.gymId}`;
    }
    const duplicate = decision.kind === "duplicate" || existing?.cancel_reason === "duplicate";
    return { decision, rowId, duplicate, replaced };
  });
}

/** The gym plans sold through Paddle (every active monthly plan not in rupees), for
 *  `tools/paddle-prices.ts`. */
export async function paddlePlans(
  sql: SqlOrTx,
): Promise<{ code: string; priceMinor: number; currency: string; seatCap: number | null; paddlePriceId: string | null }[]> {
  const rows = await sql<{ code: string; price_minor: number; currency: string; seat_cap: number | null; paddle_price_id: string | null }[]>`
    SELECT code, price_minor, currency, seat_cap, paddle_price_id FROM plans
    WHERE audience = 'org' AND active = true AND interval = 'month' AND currency <> 'INR'
      AND code NOT LIKE 'zz%'
    ORDER BY seat_cap ASC NULLS LAST, code`;
  return rows.map((r) => ({ code: r.code, priceMinor: r.price_minor, currency: r.currency, seatCap: r.seat_cap, paddlePriceId: r.paddle_price_id }));
}

export async function setPaddlePriceId(sql: SqlOrTx, code: string, priceId: string): Promise<void> {
  await sql`UPDATE plans SET paddle_price_id = ${priceId} WHERE code = ${code}`;
}

/** The gym plans sold through Razorpay (every active monthly plan in rupees), for
 *  `tools/razorpay-plans.ts`. */
export async function razorpayPlans(
  sql: SqlOrTx,
): Promise<{ code: string; priceMinor: number; currency: string; seatCap: number | null; razorpayPlanId: string | null }[]> {
  const rows = await sql<{ code: string; price_minor: number; currency: string; seat_cap: number | null; razorpay_plan_id: string | null }[]>`
    SELECT code, price_minor, currency, seat_cap, razorpay_plan_id FROM plans
    WHERE audience = 'org' AND active = true AND interval = 'month' AND currency = 'INR'
      AND code NOT LIKE 'zz%'
    ORDER BY seat_cap ASC NULLS LAST, code`;
  return rows.map((r) => ({ code: r.code, priceMinor: r.price_minor, currency: r.currency, seatCap: r.seat_cap, razorpayPlanId: r.razorpay_plan_id }));
}

export async function setRazorpayPlanId(sql: SqlOrTx, code: string, planId: string): Promise<void> {
  await sql`UPDATE plans SET razorpay_plan_id = ${planId} WHERE code = ${code}`;
}

/** Paddle's trial checkouts still open after the gym's own trial ended: their window would
 *  sell a trial the gym no longer has, so the worker cancels them at Paddle. A Razorpay one
 *  needs nothing: Razorpay expires a subscription not paid by its start. */
export async function staleTrialCheckouts(sql: SqlOrTx, now: Date, limit: number): Promise<{ id: string; gymId: string; providerRef: string }[]> {
  const rows = await sql<{ id: string; gym_id: string; provider_ref: string }[]>`
    SELECT id, gym_id, provider_ref FROM billing_checkouts
    WHERE state = 'open' AND provider = 'paddle' AND trial_ends_at IS NOT NULL AND trial_ends_at <= ${now}
      AND provider_ref IS NOT NULL
    ORDER BY trial_ends_at, id
    LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, gymId: r.gym_id, providerRef: r.provider_ref }));
}

/** A checkout closed at Paddle: it can no longer be paid. */
export async function closeCheckout(sql: SqlOrTx, input: { checkoutId: string; gymId: string }): Promise<void> {
  await sql`
    UPDATE billing_checkouts SET state = 'superseded', updated_at = now()
    WHERE id = ${input.checkoutId} AND gym_id = ${input.gymId} AND state = 'open'`;
}

/** A gym's checkouts still open at Paddle: before another is started, each is asked
 *  whether it was paid meanwhile. */
export async function openCheckoutsFor(sql: SqlOrTx, gymId: string): Promise<CheckoutRow[]> {
  const rows = await sql<RawCheckout[]>`
    SELECT c.id, c.gym_id, c.plan_id, p.code AS plan_code, c.state, c.provider, c.provider_ref,
             c.replaces_subscription_id, c.period_start, c.starts_at, c.upfront_minor, c.size_direction
    FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
    WHERE c.gym_id = ${gymId} AND c.state = 'open' AND c.provider_ref IS NOT NULL
    ORDER BY c.created_at
    LIMIT 10`;
  return rows.map(toCheckout);
}

export interface ManagedPlan {
  subscriptionRef: string;
  customerRef: string;
  /** Owed money: Paddle's page should open on the card, not the overview. */
  overdue: boolean;
}

/** The gym's Paddle plan its billing staff may manage on Paddle's own page: the live
 *  one, else one whose grace ran out while Paddle still retries. Only ever this gym's. */
export async function managedPlanFor(sql: SqlOrTx, gymId: string): Promise<ManagedPlan | null> {
  const rows = await sql<{ provider_ref: string; provider_customer_ref: string; status: string; cancel_reason: string | null }[]>`
    SELECT provider_ref, provider_customer_ref, status, cancel_reason FROM subscriptions
    WHERE owner_type = 'gym' AND owner_id = ${gymId} AND provider = 'paddle'
      AND provider_ref IS NOT NULL AND provider_customer_ref IS NOT NULL
      AND (status IN ('trialing','active','past_due') OR cancel_reason = ${GRACE_EXPIRED})
    ORDER BY (status IN ('trialing','active','past_due')) DESC, created_at DESC
    LIMIT 1`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    subscriptionRef: row.provider_ref,
    customerRef: row.provider_customer_ref,
    overdue: row.status === "past_due" || row.cancel_reason === GRACE_EXPIRED,
  };
}

/** The gym's owner, for the words of a refusal: their account and the name they go by. */
export async function gymOwner(sql: SqlOrTx, gymId: string): Promise<{ userId: string; displayName: string } | null> {
  const rows = await sql<{ id: string; display_name: string }[]>`
    SELECT u.id, u.display_name FROM gyms g JOIN users u ON u.id = g.owner_user_id WHERE g.id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? null : { userId: row.id, displayName: row.display_name };
}

/** The other gyms paid by this Paddle customer. Paddle keeps one customer per email and
 *  reuses it at checkout, and its portal signs in as the whole customer, so every one of
 *  these gyms' plans, invoices and card is on the page this gym's staff would open. */
export async function otherGymsOfCustomer(sql: SqlOrTx, input: { customerRef: string; gymId: string }): Promise<string[]> {
  const rows = await sql<{ owner_id: string }[]>`
    SELECT DISTINCT owner_id FROM subscriptions
    WHERE provider = 'paddle' AND provider_customer_ref = ${input.customerRef}
      AND owner_type = 'gym' AND owner_id <> ${input.gymId}`;
  return rows.map((r) => r.owner_id);
}

/** End the grace of every paid plan past_due since before `cutoff`: its gym's members
 *  lose the plan's features and the console goes read-only until Paddle or Razorpay collects.
 *  Each row under its gym's lock, re-checked there, so a payment written meanwhile
 *  wins; running it twice changes nothing. Returns the gyms whose grace ended. */
export async function endGraces(sql: Sql, input: { cutoff: Date; now: Date; limit: number }): Promise<string[]> {
  const due = await sql<{ id: string; owner_id: string; provider: string }[]>`
    SELECT id, owner_id, provider FROM subscriptions
    WHERE status = 'past_due' AND past_due_since <= ${input.cutoff}
      AND owner_type = 'gym' AND provider IN ('paddle','razorpay')
    ORDER BY past_due_since, id
    LIMIT ${input.limit}`;
  const ended: string[] = [];
  for (const row of due) {
    const done = await sql.begin(async (tx) => {
      await lockOrgRow(tx, row.owner_id); // subscription-writer lock
      const moved = await tx<{ id: string }[]>`
        UPDATE subscriptions
        SET status = 'expired', ended_at = ${input.now}, cancel_reason = ${GRACE_EXPIRED}
        WHERE id = ${row.id} AND owner_id = ${row.owner_id} AND status = 'past_due'
          AND past_due_since <= ${input.cutoff}
        RETURNING id`;
      if (moved.length === 0) return false;
      await insertAudit(tx, {
        actorUserId: null,
        gymId: row.owner_id,
        action: "billing.grace_ended",
        targetType: "subscription",
        targetId: row.id,
        meta: { provider: row.provider },
      });
      return true;
    });
    if (done) ended.push(row.owner_id);
  }
  return ended;
}

/** `cancelled`: a payment Razorpay took for a month after the plan was set to end (1d-ii). */
export type RefundReason = "duplicate" | "unmatched" | "cancelled";

/** Write down the refunds owed for a subscription set aside, one per paid transaction.
 *  Kept once per transaction, so recording them again changes nothing. */
export async function oweRefunds(
  sql: SqlOrTx,
  input: { gymId: string | null; provider: PayProvider; subscriptionRef: string; reason: RefundReason; transactionRefs: readonly string[] },
): Promise<number> {
  let added = 0;
  for (const transactionRef of input.transactionRefs) {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO billing_refunds (gym_id, provider, subscription_ref, transaction_ref, reason)
      VALUES (${input.reason === "unmatched" ? null : input.gymId}, ${input.provider}, ${input.subscriptionRef},
              ${transactionRef}, ${input.reason})
      ON CONFLICT (provider, transaction_ref) DO NOTHING
      RETURNING id`;
    added += rows.length;
  }
  return added;
}

export interface OwedRefund {
  id: string;
  provider: PayProvider;
  /** Paddle: a transaction (`txn_…`). Razorpay: a payment (`pay_…`). */
  transactionRef: string;
  tries: number;
  createdAt: Date;
}

/** Take the next refund that is due at one of these payment companies (the ones this server
 *  is set up for) and hold it for `leaseMs`: a second worker skips it. */
export async function claimDueRefund(sql: Sql, now: Date, leaseMs: number, providers: readonly PayProvider[]): Promise<OwedRefund | null> {
  const rows = await sql<{ id: string; provider: string; transaction_ref: string; tries: number; created_at: Date }[]>`
    WITH next AS (
      SELECT id FROM billing_refunds
      WHERE state = 'owed' AND not_before <= ${now} AND provider = ANY(${[...providers]}::text[])
      ORDER BY not_before, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE billing_refunds r
    SET not_before = ${new Date(now.getTime() + leaseMs)}, updated_at = now()
    FROM next WHERE r.id = next.id
    RETURNING r.id, r.provider, r.transaction_ref, r.tries, r.created_at`;
  const row = rows[0];
  if (row === undefined) return null;
  const provider = PROVIDERS.find((p) => p === row.provider);
  if (provider === undefined) throw new Error(`unknown refund provider ${row.provider}`);
  return { id: row.id, provider, transactionRef: row.transaction_ref, tries: row.tries, createdAt: row.created_at };
}

export async function settleRefund(sql: SqlOrTx, id: string, state: "requested" | "not_needed" | "failed"): Promise<void> {
  await sql`UPDATE billing_refunds SET state = ${state}, updated_at = now() WHERE id = ${id} AND state = 'owed'`;
}

/** Try again at `notBefore`; `countTry` when Paddle answered and refused. */
export async function deferRefund(sql: SqlOrTx, id: string, notBefore: Date, countTry: boolean): Promise<void> {
  await sql`
    UPDATE billing_refunds
    SET not_before = ${notBefore}, tries = tries + CASE WHEN ${countTry}::boolean THEN 1 ELSE 0 END, updated_at = now()
    WHERE id = ${id} AND state = 'owed'`;
}

// ── A size change: bigger (1c-ii) or smaller (1c-iii) ─────────────────────────

export interface SizeTarget {
  subscriptionRowId: string;
  subscriptionRef: string;
  /** In the paid trial: nothing is charged now, the new price when the trial ends. */
  trialing: boolean;
  /** Bigger: charged for the rest of the month at once. Smaller: never charged or credited;
   *  on a plan already paying it waits for the end of the month paid, when the members are
   *  counted (Kd, RULINGS 2026-09-25). */
  direction: "bigger" | "smaller";
  /** When the month paid ends (in a trial, when the first payment is taken). */
  periodEnd: Date | null;
  fromPlanId: string;
  toPlanId: string;
  planCode: string;
  priceId: string;
  priceMinor: number;
  currency: string;
  seatCap: number | null;
}

export type SizeTargetOutcome =
  | { kind: "ok"; target: SizeTarget }
  /** No plan paid through us: a free trial chooses one with Subscribe. */
  | { kind: "no_paid_plan"; trialing: boolean }
  /** Paid through Razorpay: its size cannot be changed here yet (ROADMAP 1d-iii). */
  | { kind: "paid_through_razorpay" }
  | { kind: "payment_overdue" }
  | { kind: "plan_ending"; endsAt: Date | null }
  | { kind: "no_such_plan" }
  | { kind: "same_size" }
  /** In a paid trial, where a smaller size is made at once: more members than it holds. */
  | { kind: "too_many_members"; seatsUsed: number; seatCap: number }
  /** The month paid has ended and its renewal is not written yet: a smaller size chosen now
   *  could not wait for a month end we know. */
  | { kind: "renewing" }
  | { kind: "not_set_up" };

/** Which plan a size change would move this gym to, or why it cannot: another size of the
 *  gym's own price list, only on a plan paid through Paddle that is in good standing and not
 *  set to end. A smaller one in a paid trial is made at once, so there the members must fit
 *  now; on a paying plan they are counted when it is due. Read with the gym in every WHERE; a
 *  caller about to act holds the gym's lock, so no member joins between the count and the
 *  change. */
export async function sizeTarget(sql: SqlOrTx, input: { gymId: string; planCode: string; now: Date }): Promise<SizeTargetOutcome> {
  const live = await sql<
    {
      id: string;
      status: string;
      provider: string;
      provider_ref: string | null;
      cancel_at_period_end: boolean;
      current_period_end: Date | null;
      plan_id: string;
      seat_cap: number | null;
      currency: string;
    }[]
  >`
    SELECT s.id, s.status, s.provider, s.provider_ref, s.cancel_at_period_end, s.current_period_end,
           s.plan_id, p.seat_cap, p.currency
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.owner_type = 'gym' AND s.owner_id = ${input.gymId}
      AND s.status IN ('trialing','active','past_due')
    LIMIT 1`;
  const row = live[0];
  if (row === undefined) {
    const overdue = await sql`
      SELECT 1 FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND cancel_reason = ${GRACE_EXPIRED}
      LIMIT 1`;
    return overdue.length > 0 ? { kind: "payment_overdue" } : { kind: "no_paid_plan", trialing: false };
  }
  if (row.provider === "razorpay") return { kind: "paid_through_razorpay" };
  if (row.provider !== "paddle" || row.provider_ref === null) return { kind: "no_paid_plan", trialing: row.status === "trialing" };
  if (row.status === "past_due") return { kind: "payment_overdue" };
  if (row.cancel_at_period_end) return { kind: "plan_ending", endsAt: row.current_period_end };

  const plans = await sql<{ id: string; code: string; seat_cap: number | null; paddle_price_id: string | null; price_minor: number; currency: string }[]>`
    SELECT id, code, seat_cap, paddle_price_id, price_minor, currency FROM plans
    WHERE code = ${input.planCode} AND audience = 'org' AND active = true
      AND interval = 'month' AND currency = ${row.currency}`;
  const plan = plans[0];
  if (plan === undefined) return { kind: "no_such_plan" };
  // Bigger means more members: a capless plan is bigger than any capped one.
  const bigger = row.seat_cap !== null && (plan.seat_cap === null || plan.seat_cap > row.seat_cap);
  const smaller = plan.seat_cap !== null && (row.seat_cap === null || plan.seat_cap < row.seat_cap);
  if (plan.id === row.plan_id || (!bigger && !smaller)) return { kind: "same_size" };
  if (smaller && row.status !== "trialing" && (row.current_period_end === null || row.current_period_end <= input.now)) {
    return { kind: "renewing" };
  }
  if (smaller && row.status === "trialing" && plan.seat_cap !== null) {
    const used = await seatsUsed(sql, input.gymId);
    if (used > plan.seat_cap) return { kind: "too_many_members", seatsUsed: used, seatCap: plan.seat_cap };
  }
  if (plan.paddle_price_id === null) return { kind: "not_set_up" };
  return {
    kind: "ok",
    target: {
      subscriptionRowId: row.id,
      subscriptionRef: row.provider_ref,
      trialing: row.status === "trialing",
      direction: bigger ? "bigger" : "smaller",
      periodEnd: row.current_period_end,
      fromPlanId: row.plan_id,
      toPlanId: plan.id,
      planCode: plan.code,
      priceId: plan.paddle_price_id,
      priceMinor: plan.price_minor,
      currency: plan.currency,
      seatCap: plan.seat_cap,
    },
  };
}

export type PlanChangeState = "pending" | "done" | "failed";

export interface PlanChangeRow {
  id: string;
  planCode: string;
  state: PlanChangeState;
  failure: string | null;
}

export type BeginPlanChangeOutcome =
  /** Recorded as pending: Paddle is to be asked now. */
  | { kind: "created"; changeId: string; target: SizeTarget }
  /** A smaller size on a plan already paying: written onto the plan, for Paddle to bill from
   *  the end of the month paid. Nothing more to ask now. */
  | { kind: "scheduled" }
  | { kind: "replay"; change: PlanChangeRow }
  | { kind: "key_reused" }
  | { kind: "in_progress" }
  | { kind: "org_archived" }
  | { kind: "not_found" }
  | { kind: "refused"; outcome: Exclude<SizeTargetOutcome, { kind: "ok" }> };

/** A change still pending after this long was cut off before it finished; the next press may
 *  go ahead, because it first asks Paddle what the subscription is now. */
export const PLAN_CHANGE_STALE_MS = 2 * 60 * 1000;

const CHANGE_STATES: readonly PlanChangeState[] = ["pending", "done", "failed"];

/** Record a size change before Paddle is asked, under the gym's lock: one pending change a gym
 *  (and a unique index behind it), and the same Idempotency-Key answers from its row. A
 *  smaller size on a paying plan is only written onto the plan here, for the worker to decide
 *  when it is due. */
export async function beginPlanChange(
  sql: Sql,
  input: { gymId: string; userId: string; planCode: string; idempotencyKey: string; now: Date },
): Promise<BeginPlanChangeOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const gyms = await tx<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined) return { kind: "not_found" };
    if (gym.status !== "active") return { kind: "org_archived" };

    const earlier = await tx<{ id: string; plan_code: string; state: string; failure: string | null }[]>`
      SELECT c.id, p.code AS plan_code, c.state, c.failure
      FROM billing_plan_changes c JOIN plans p ON p.id = c.to_plan_id
      WHERE c.gym_id = ${input.gymId} AND c.idempotency_key = ${input.idempotencyKey}`;
    const replay = earlier[0];
    if (replay !== undefined) {
      if (replay.plan_code !== input.planCode) return { kind: "key_reused" };
      const state = CHANGE_STATES.find((st) => st === replay.state);
      if (state === undefined) throw new Error(`unknown plan change state ${replay.state}`);
      return { kind: "replay", change: { id: replay.id, planCode: replay.plan_code, state, failure: replay.failure } };
    }

    const staleBefore = new Date(input.now.getTime() - PLAN_CHANGE_STALE_MS);
    await tx`
      UPDATE billing_plan_changes SET state = 'failed', failure = 'interrupted', updated_at = now()
      WHERE gym_id = ${input.gymId} AND state = 'pending' AND created_at < ${staleBefore}`;
    const pending = await tx`SELECT 1 FROM billing_plan_changes WHERE gym_id = ${input.gymId} AND state = 'pending'`;
    if (pending.length > 0) return { kind: "in_progress" };

    const found = await sizeTarget(tx, input);
    if (found.kind !== "ok") return { kind: "refused", outcome: found };
    const target = found.target;
    // A smaller size on a plan already paying waits for the end of the month paid; one in a
    // paid trial is made at Paddle now (nothing has been paid yet).
    const scheduled = target.direction === "smaller" && !target.trialing;
    if (scheduled && target.periodEnd === null) return { kind: "refused", outcome: { kind: "not_set_up" } };
    if (target.direction === "smaller") {
      // A paid trial's holds for joins at once, as it is made at Paddle now; a paying plan's
      // only when its switch begins.
      await tx`
        UPDATE subscriptions
        SET pending_plan_id = ${target.toPlanId}, pending_from = ${scheduled ? target.periodEnd : input.now},
            pending_requested_plan_id = NULL, pending_held_at = ${scheduled ? null : input.now}, pending_warned_at = NULL
        WHERE id = ${target.subscriptionRowId} AND owner_type = 'gym' AND owner_id = ${input.gymId}`;
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO billing_plan_changes (gym_id, subscription_id, from_plan_id, to_plan_id, created_by,
                                        idempotency_key, provider, state, created_at)
      VALUES (${input.gymId}, ${target.subscriptionRowId}, ${target.fromPlanId}, ${target.toPlanId},
              ${input.userId}, ${input.idempotencyKey}, 'paddle', ${scheduled ? "done" : "pending"}, ${input.now})
      RETURNING id`;
    const changeId = inserted[0]?.id;
    if (changeId === undefined) throw new Error("plan change insert returned no row");
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: scheduled ? "billing.size_change_scheduled" : "billing.size_change_started",
      targetType: "billing_plan_change",
      targetId: changeId,
      meta: { plan: input.planCode, ...(target.trialing ? { during: "trial" } : {}) },
    });
    return scheduled ? { kind: "scheduled" } : { kind: "created", changeId, target };
  });
}

/** A size change's end: done, or failed with the code the console was answered with. */
export async function finishPlanChange(
  sql: SqlOrTx,
  input: { changeId: string; gymId: string; state: "done" | "failed"; failure: string | null },
): Promise<void> {
  await sql`
    UPDATE billing_plan_changes SET state = ${input.state}, failure = ${input.failure}, updated_at = now()
    WHERE id = ${input.changeId} AND gym_id = ${input.gymId} AND state = 'pending'`;
}

/** A smaller size that was not made at Paddle: the plan's own limit again. Only that size. */
export async function dropPendingPlan(sql: SqlOrTx, input: { gymId: string; subscriptionRowId: string; planId: string }): Promise<void> {
  await sql`
    UPDATE subscriptions
    SET pending_plan_id = NULL, pending_from = NULL, pending_requested_plan_id = NULL, pending_held_at = NULL, pending_warned_at = NULL,
        pending_subscription_ref = NULL
    WHERE id = ${input.subscriptionRowId} AND owner_type = 'gym' AND owner_id = ${input.gymId}
      AND pending_plan_id = ${input.planId}`;
}

export type KeepSizeOutcome = { kind: "kept" } | { kind: "nothing_waiting" } | { kind: "in_progress" } | { kind: "org_archived" } | { kind: "not_found" };

/** "Cancel this change": the smaller size waiting is dropped, under the gym's lock, so it
 *  cannot cross the worker making it at Paddle (which holds a pending change meanwhile), or one
 *  through Razorpay already decided and taking the plan's place. A Razorpay one's approved
 *  subscription is then ended there by the worker (`strandedSmallerSizes`). */
export async function keepSize(sql: Sql, input: { gymId: string; userId: string }): Promise<KeepSizeOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const gyms = await tx<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined) return { kind: "not_found" };
    if (gym.status !== "active") return { kind: "org_archived" };
    const pending = await tx`
      SELECT 1 FROM billing_plan_changes WHERE gym_id = ${input.gymId} AND state = 'pending'
      UNION ALL
      SELECT 1 FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND status IN ('active','past_due')
        AND pending_subscription_ref IS NOT NULL AND pending_held_at IS NOT NULL`;
    if (pending.length > 0) return { kind: "in_progress" };
    const kept = await tx<{ id: string; code: string }[]>`
      UPDATE subscriptions s
      SET pending_plan_id = NULL, pending_from = NULL, pending_requested_plan_id = NULL, pending_held_at = NULL, pending_warned_at = NULL,
          pending_subscription_ref = NULL
      FROM plans p
      WHERE p.id = COALESCE(s.pending_requested_plan_id, s.pending_plan_id) AND s.owner_type = 'gym' AND s.owner_id = ${input.gymId}
        AND s.status IN ('active','past_due')
      RETURNING s.id, p.code`;
    const row = kept[0];
    if (row === undefined) return { kind: "nothing_waiting" };
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: "billing.size_change_kept",
      targetType: "subscription",
      targetId: row.id,
      meta: { dropped: row.code },
    });
    return { kind: "kept" };
  });
}

/** Plans with a smaller size due at Paddle by `until`: a paid trial's at once, a paying plan's
 *  shortly before the month paid ends (or after it, if that was missed). */
export async function duePendingPlans(sql: SqlOrTx, input: { until: Date; limit: number }): Promise<{ id: string; gymId: string }[]> {
  const rows = await sql<{ id: string; owner_id: string }[]>`
    SELECT id, owner_id FROM subscriptions
    WHERE pending_plan_id IS NOT NULL AND pending_from <= ${input.until}
      AND owner_type = 'gym' AND provider = 'paddle' AND provider_ref IS NOT NULL
      AND status IN ('trialing','active') AND cancel_at_period_end = false
    ORDER BY pending_from, id
    LIMIT ${input.limit}`;
  return rows.map((r) => ({ id: r.id, gymId: r.owner_id }));
}

export interface PendingClaim {
  changeId: string;
  subscriptionRef: string;
  trialing: boolean;
  fromPlanId: string;
  toPlanId: string;
  planCode: string;
  priceId: string;
  pendingFrom: Date;
  /** Made instead of the size asked for, which the members did not fit. */
  fitted: { askedSeatCap: number; members: number } | null;
}

export interface FittingPlan {
  id: string;
  code: string;
  seatCap: number;
  priceMinor: number;
  /** Paddle's price, or Razorpay's plan for a plan paid through Razorpay. */
  priceId: string;
}

/** The smallest size of the gym's own price list that holds `members` and is smaller than
 *  the plan it is on: where a gym with too many members for the size it asked for moves
 *  instead (Kd, RULINGS 2026-09-25). Null when nothing smaller holds them. */
export async function smallestFittingPlan(sql: SqlOrTx, input: { gymId: string; members: number }): Promise<FittingPlan | null> {
  const rows = await sql<{ id: string; code: string; seat_cap: number; price_minor: number; price_id: string }[]>`
    SELECT fp.id, fp.code, fp.seat_cap, fp.price_minor,
           CASE WHEN s.provider = 'razorpay' THEN fp.razorpay_plan_id ELSE fp.paddle_price_id END AS price_id
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    JOIN plans fp ON fp.audience = 'org' AND fp.active = true AND fp.interval = 'month'
                 AND fp.currency = p.currency
                 AND (CASE WHEN s.provider = 'razorpay' THEN fp.razorpay_plan_id ELSE fp.paddle_price_id END) IS NOT NULL
    WHERE s.owner_type = 'gym' AND s.owner_id = ${input.gymId}
      AND s.status IN ('trialing','active','past_due')
      AND fp.seat_cap IS NOT NULL AND fp.seat_cap >= ${input.members}
      AND (p.seat_cap IS NULL OR fp.seat_cap < p.seat_cap)
    ORDER BY fp.seat_cap, fp.price_minor
    LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, code: row.code, seatCap: row.seat_cap, priceMinor: row.price_minor, priceId: row.price_id };
}

export type PendingClaimOutcome =
  /** The members fit the size asked for, or a bigger one smaller than the plan: it now holds
   *  for joins, and Paddle is to be asked. */
  | { kind: "claimed"; claim: PendingClaim }
  /** No smaller size holds the members: the size asked for was dropped and the gym stays. */
  | { kind: "kept"; members: number; seatCap: number; trialing: boolean };

/** Take one plan's waiting smaller size to decide it: under the gym's lock, the members are
 *  counted. If they do not fit the size asked for, the smallest size smaller than the plan
 *  that holds them is made instead; if none does, the size is dropped and the count kept for
 *  the Plan card. Whatever is made holds for joins from now, and a pending change is
 *  recorded (so no press crosses it). At most once per `bucket` (the Idempotency-Key carries it), so a
 *  refusing Paddle is asked every few minutes, not every run. Null when there is nothing to
 *  do now. */
export async function claimPendingPlan(
  sql: Sql,
  input: { gymId: string; subscriptionRowId: string; now: Date; bucket: number },
): Promise<PendingClaimOutcome | null> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const rows = await tx<
      {
        status: string;
        provider_ref: string;
        plan_id: string;
        asked_plan_id: string;
        pending_from: Date;
        code: string;
        paddle_price_id: string | null;
        seat_cap: number | null;
      }[]
    >`
      -- The size asked for: a fallback made instead is decided afresh on every attempt.
      SELECT s.status, s.provider_ref, s.plan_id, p.id AS asked_plan_id, s.pending_from,
             p.code, p.paddle_price_id, p.seat_cap
      FROM subscriptions s JOIN plans p ON p.id = COALESCE(s.pending_requested_plan_id, s.pending_plan_id)
      WHERE s.id = ${input.subscriptionRowId} AND s.owner_type = 'gym' AND s.owner_id = ${input.gymId}
        AND s.provider = 'paddle' AND s.provider_ref IS NOT NULL
        AND s.status IN ('trialing','active') AND s.cancel_at_period_end = false`;
    const row = rows[0];
    if (row === undefined || row.paddle_price_id === null || row.seat_cap === null) return null;
    // A change cut off mid-way would otherwise hold this gym until somebody pressed again.
    await tx`
      UPDATE billing_plan_changes SET state = 'failed', failure = 'interrupted', updated_at = now()
      WHERE gym_id = ${input.gymId} AND state = 'pending'
        AND created_at < ${new Date(input.now.getTime() - PLAN_CHANGE_STALE_MS)}`;
    const pending = await tx`SELECT 1 FROM billing_plan_changes WHERE gym_id = ${input.gymId} AND state = 'pending'`;
    if (pending.length > 0) return null;
    const key = `pending:${row.pending_from.toISOString()}:${String(input.bucket)}`;
    const tried = await tx`SELECT 1 FROM billing_plan_changes WHERE gym_id = ${input.gymId} AND idempotency_key = ${key}`;
    if (tried.length > 0) return null;

    // Counted on every attempt: a failed one lets go of the hold, so members may have joined
    // since, a paid trial's included. A trial's is made at once, as its press was, so it has no
    // bigger size to fall back to: too many, and it is dropped.
    const members = await seatsUsed(tx, input.gymId);
    const trialing = row.status === "trialing";
    const fitted = members > row.seat_cap && !trialing ? await smallestFittingPlan(tx, { gymId: input.gymId, members }) : null;
    if (members > row.seat_cap && fitted === null) {
      await tx`
        UPDATE subscriptions SET pending_plan_id = NULL, pending_from = NULL, pending_requested_plan_id = NULL,
                                 pending_held_at = NULL, pending_warned_at = NULL, pending_subscription_ref = NULL
        WHERE id = ${input.subscriptionRowId} AND owner_type = 'gym' AND owner_id = ${input.gymId}`;
      const kept = await tx<{ id: string }[]>`
        INSERT INTO billing_plan_changes (gym_id, subscription_id, from_plan_id, to_plan_id, created_by,
                                          idempotency_key, provider, state, failure, members_counted, created_at)
        VALUES (${input.gymId}, ${input.subscriptionRowId}, ${row.plan_id}, ${row.asked_plan_id}, NULL,
                ${key}, 'paddle', 'failed', 'too_many_members', ${members}, ${input.now})
        RETURNING id`;
      await insertAudit(tx, {
        actorUserId: null,
        gymId: input.gymId,
        action: "billing.size_change_not_made",
        targetType: "billing_plan_change",
        targetId: kept[0]?.id ?? input.subscriptionRowId,
        meta: { plan: row.code, members: String(members) },
      });
      return { kind: "kept", members, seatCap: row.seat_cap, trialing };
    }
    const to = fitted === null ? { id: row.asked_plan_id, code: row.code, priceId: row.paddle_price_id } : { id: fitted.id, code: fitted.code, priceId: fitted.priceId };
    // What is made holds for joins until Paddle has it or the attempt fails; the size asked
    // for is kept beside it, so every later attempt and the Plan card still know it.
    await tx`
      UPDATE subscriptions
      SET pending_plan_id = ${to.id}, pending_requested_plan_id = ${fitted === null ? null : row.asked_plan_id},
          pending_held_at = COALESCE(pending_held_at, ${input.now})
      WHERE id = ${input.subscriptionRowId} AND owner_type = 'gym' AND owner_id = ${input.gymId}`;
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO billing_plan_changes (gym_id, subscription_id, from_plan_id, to_plan_id, requested_plan_id, created_by,
                                        idempotency_key, provider, members_counted, created_at)
      VALUES (${input.gymId}, ${input.subscriptionRowId}, ${row.plan_id}, ${to.id},
              ${fitted === null ? null : row.asked_plan_id}, NULL, ${key}, 'paddle', ${members}, ${input.now})
      RETURNING id`;
    const changeId = inserted[0]?.id;
    if (changeId === undefined) throw new Error("plan change insert returned no row");
    if (fitted !== null) {
      await insertAudit(tx, {
        actorUserId: null,
        gymId: input.gymId,
        action: "billing.size_change_fitted",
        targetType: "billing_plan_change",
        targetId: changeId,
        meta: { asked: row.code, made: fitted.code, members: String(members) },
      });
    }
    return {
      kind: "claimed",
      claim: {
        changeId,
        subscriptionRef: row.provider_ref,
        trialing: row.status === "trialing",
        fromPlanId: row.plan_id,
        toPlanId: to.id,
        planCode: to.code,
        priceId: to.priceId,
        pendingFrom: row.pending_from,
        fitted: fitted === null ? null : { askedSeatCap: row.seat_cap, members },
      },
    };
  });
}

/** An attempt at Paddle that did not make the smaller size: the gym keeps its whole size again
 *  until the next attempt, which recounts and holds under the gym's lock. */
export async function releaseHold(sql: SqlOrTx, input: { gymId: string; subscriptionRowId: string }): Promise<void> {
  await sql`
    UPDATE subscriptions SET pending_held_at = NULL
    WHERE id = ${input.subscriptionRowId} AND owner_type = 'gym' AND owner_id = ${input.gymId}
      AND pending_plan_id IS NOT NULL`;
}

export interface SizeWarningDue {
  subscriptionRowId: string;
  gymId: string;
}

/** Paying plans with a smaller size due within `within` whose billing staff have not been
 *  told about too many members yet, while there is still time to act (before the decision,
 *  `lead` ahead of the size's start). */
export async function dueSizeWarnings(
  sql: SqlOrTx,
  input: { provider: PayProvider; now: Date; within: number; lead: number; limit: number },
): Promise<SizeWarningDue[]> {
  const rows = await sql<{ id: string; owner_id: string }[]>`
    SELECT id, owner_id FROM subscriptions
    WHERE pending_plan_id IS NOT NULL AND pending_warned_at IS NULL AND pending_held_at IS NULL
      AND pending_from <= ${new Date(input.now.getTime() + input.within)} AND pending_from > ${new Date(input.now.getTime() + input.lead)}
      AND owner_type = 'gym' AND provider = ${input.provider} AND status = 'active' AND cancel_at_period_end = false
    ORDER BY pending_from, id
    LIMIT ${input.limit}`;
  return rows.map((r) => ({ subscriptionRowId: r.id, gymId: r.owner_id }));
}

/** What a smaller-size email says, read with the gym in the WHERE: the gym, the size it is on
 *  and the one waiting (or last not made), and the members now. */
export interface SizeNoticeFacts {
  gymName: string;
  gymSlug: string;
  orgType: string;
  timezone: string;
  members: number;
  currentSeatCap: number | null;
  currentPriceMinor: number;
  currency: string;
  targetSeatCap: number;
  targetPriceMinor: number;
  /** When the smaller size was due (a warning), or null (a size kept). */
  pendingFrom: Date | null;
  /** Through Razorpay a gym with too many members stays on its size (Kd, RULINGS 2026-10-01). */
  provider: PayProvider;
}

export async function sizeNoticeFacts(
  sql: SqlOrTx,
  input: { gymId: string; subscriptionRowId: string; targetPlan: "pending" | "last_kept" },
): Promise<SizeNoticeFacts | null> {
  const rows = await sql<
    {
      name: string;
      slug: string;
      org_type: string;
      timezone: string;
      seat_cap: number | null;
      price_minor: number;
      currency: string;
      target_seat_cap: number | null;
      target_price_minor: number | null;
      pending_from: Date | null;
      provider: string;
    }[]
  >`
    SELECT g.name, g.slug, g.org_type, g.timezone, p.seat_cap, p.price_minor, p.currency,
           tp.seat_cap AS target_seat_cap, tp.price_minor AS target_price_minor, s.pending_from, s.provider
    FROM subscriptions s
    JOIN gyms g ON g.id = s.owner_id
    JOIN plans p ON p.id = s.plan_id
    LEFT JOIN plans tp ON tp.id = CASE
      WHEN ${input.targetPlan} = 'pending' THEN COALESCE(s.pending_requested_plan_id, s.pending_plan_id)
      ELSE (SELECT c.to_plan_id FROM billing_plan_changes c
            WHERE c.gym_id = s.owner_id AND c.subscription_id = s.id
            ORDER BY c.created_at DESC LIMIT 1)
    END
    WHERE s.id = ${input.subscriptionRowId} AND s.owner_type = 'gym' AND s.owner_id = ${input.gymId}`;
  const row = rows[0];
  const provider = PROVIDERS.find((p) => p === row?.provider);
  if (row === undefined || row.target_seat_cap === null || row.target_price_minor === null || provider === undefined) return null;
  return {
    gymName: row.name,
    gymSlug: row.slug,
    orgType: row.org_type,
    timezone: row.timezone,
    members: await seatsUsed(sql, input.gymId),
    currentSeatCap: row.seat_cap,
    currentPriceMinor: row.price_minor,
    currency: row.currency,
    targetSeatCap: row.target_seat_cap,
    targetPriceMinor: row.target_price_minor,
    pendingFrom: row.pending_from,
    provider,
  };
}

/** A gym's name, console address and kind, for an email to its billing staff. */
export async function gymEmailFacts(sql: SqlOrTx, gymId: string): Promise<{ gymName: string; gymSlug: string; orgType: string } | null> {
  const rows = await sql<{ name: string; slug: string; org_type: string }[]>`SELECT name, slug, org_type FROM gyms WHERE id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? null : { gymName: row.name, gymSlug: row.slug, orgType: row.org_type };
}

/** Mark the warning sent for this choice; false when another run marked it first. Marked
 *  before it is sent, so two runs never send it twice. */
export async function claimSizeWarning(sql: SqlOrTx, input: { gymId: string; subscriptionRowId: string; now: Date }): Promise<boolean> {
  const rows = await sql`
    UPDATE subscriptions SET pending_warned_at = ${input.now}
    WHERE id = ${input.subscriptionRowId} AND owner_type = 'gym' AND owner_id = ${input.gymId}
      AND pending_plan_id IS NOT NULL AND pending_warned_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

/** A gym's staff with an email: whom its billing emails may go to. Who among them may manage
 *  billing is asked of each through the same check the routes use (`holdsPrivilege`). */
export async function staffWithEmail(sql: SqlOrTx, gymId: string): Promise<{ userId: string; email: string }[]> {
  const rows = await sql<{ user_id: string; email: string }[]>`
    SELECT s.user_id, u.email FROM gym_staff s JOIN users u ON u.id = s.user_id
    WHERE s.gym_id = ${gymId} AND u.status = 'active' AND u.email IS NOT NULL
    ORDER BY u.email`;
  return rows.map((r) => ({ userId: r.user_id, email: r.email }));
}
// ── A plan paid through Razorpay, managed from the console (1d-ii) ───────────

/** The gym's plan paid through Razorpay that the console acts on: its live plan, or the one
 *  whose grace ran out while a payment is still owed (the console is read-only until it is
 *  paid). Null when the gym has neither. */
export interface RazorpayPlanRow {
  id: string;
  status: LocalStatus;
  subscriptionRef: string;
  /** Its grace ran out: the gym pays to open the console again. */
  overdue: boolean;
}

export async function razorpayPlanFor(sql: SqlOrTx, gymId: string): Promise<RazorpayPlanRow | null> {
  const rows = await sql<{ id: string; status: LocalStatus; provider_ref: string; cancel_reason: string | null }[]>`
    SELECT id, status, provider_ref, cancel_reason FROM subscriptions
    WHERE owner_type = 'gym' AND owner_id = ${gymId} AND provider = 'razorpay' AND provider_ref IS NOT NULL
      AND (status IN ('trialing','active','past_due') OR cancel_reason = ${GRACE_EXPIRED})
    ORDER BY (status IN ('trialing','active','past_due')) DESC, ended_at DESC NULLS LAST, id
    LIMIT 1`;
  const row = rows[0];
  return row === undefined
    ? null
    : { id: row.id, status: row.status, subscriptionRef: row.provider_ref, overdue: row.cancel_reason === GRACE_EXPIRED };
}

export type CancelRequestOutcome =
  /** Set to end when the paid month ends. `sendNow`: the end is already within the hours in
   *  which the cancel goes to Razorpay. */
  | { kind: "scheduled"; sendNow: boolean }
  /** Already set to end: nothing changed. */
  | { kind: "already" }
  /** A payment is overdue: the plan ends at once, nothing more charged (the caller cancels at
   *  Razorpay first, then marks it). */
  | { kind: "overdue"; rowId: string; subscriptionRef: string }
  | { kind: "not_razorpay" }
  | { kind: "no_paid_plan" }
  | { kind: "org_archived" }
  | { kind: "not_found" };

/** "Cancel plan" on a plan paid through Razorpay: set to end when the month paid for ends,
 *  under the gym's lock. Nothing is sent to Razorpay here. */
export async function requestCancel(sql: Sql, input: { gymId: string; userId: string; now: Date; leadMs: number }): Promise<CancelRequestOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const gyms = await tx<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined) return { kind: "not_found" };
    if (gym.status !== "active") return { kind: "org_archived" };
    const rows = await tx<
      { id: string; status: LocalStatus; provider: string; provider_ref: string | null; cancel_at_period_end: boolean; current_period_end: Date | null }[]
    >`
      SELECT id, status, provider, provider_ref, cancel_at_period_end, current_period_end FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND status IN ('trialing','active','past_due')
      LIMIT 1
      FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) {
      // A second press after the first ended an overdue plan finds it already done.
      const ended = await tx`
        SELECT 1 FROM subscriptions
        WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND provider = 'razorpay' AND cancel_at_period_end
          AND ended_at > ${new Date(input.now.getTime() - 10 * 60 * 1000)}`;
      return ended.length > 0 ? { kind: "already" } : { kind: "no_paid_plan" };
    }
    if (row.provider === "paddle") return { kind: "not_razorpay" };
    if (row.provider !== "razorpay" || row.provider_ref === null) return { kind: "no_paid_plan" };
    if (row.cancel_at_period_end) return { kind: "already" };
    if (row.status === "past_due") return { kind: "overdue", rowId: row.id, subscriptionRef: row.provider_ref };
    // A smaller size waiting goes with it: there is no next month to start it in. Its approved
    // subscription is ended at Razorpay by the worker (`strandedSmallerSizes`).
    await tx`
      UPDATE subscriptions
      SET cancel_at_period_end = true, pending_plan_id = NULL, pending_from = NULL, pending_requested_plan_id = NULL,
          pending_held_at = NULL, pending_warned_at = NULL, pending_subscription_ref = NULL
      WHERE id = ${row.id} AND owner_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: "billing.cancel_requested",
      targetType: "subscription",
      targetId: row.id,
      meta: { provider: "razorpay", endsAt: row.current_period_end?.toISOString() ?? null },
    });
    const sendNow = row.current_period_end === null || row.current_period_end.getTime() - input.now.getTime() <= input.leadMs;
    return { kind: "scheduled", sendNow };
  });
}

/** An overdue plan cancelled at Razorpay: marked as ended by the gym, so a payment Razorpay
 *  takes after `now` — the moment Cancel was pressed — is refunded. Its end is written from
 *  Razorpay's record by the one rule. */
export async function markCancelSent(sql: Sql, input: { gymId: string; userId: string; rowId: string; now: Date }): Promise<void> {
  await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const moved = await tx<{ id: string }[]>`
      UPDATE subscriptions SET cancel_at_period_end = true, cancel_sent_at = ${input.now}
      WHERE id = ${input.rowId} AND owner_type = 'gym' AND owner_id = ${input.gymId} AND provider = 'razorpay'
        AND cancel_sent_at IS NULL
      RETURNING id`;
    if (moved.length === 0) return;
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: "billing.cancel_requested",
      targetType: "subscription",
      targetId: input.rowId,
      meta: { provider: "razorpay", endsAt: input.now.toISOString() },
    });
  });
}

export type KeepPlanOutcome =
  | { kind: "kept" }
  /** Not set to end: nothing changed. */
  | { kind: "not_ending" }
  /** Too close to the end: the cancel is with Razorpay, or about to be. */
  | { kind: "too_late"; endsAt: Date | null }
  | { kind: "no_paid_plan" }
  | { kind: "org_archived" }
  | { kind: "not_found" };

/** "Keep my plan": a plan set to end goes on, while the cancel is still ours alone — not yet
 *  sent, and not within `leadMs` of the end, when the worker sends it. Under the gym's lock and
 *  the row's, so it cannot cross the worker claiming the same row. */
export async function keepPlan(sql: Sql, input: { gymId: string; userId: string; now: Date; leadMs: number }): Promise<KeepPlanOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const gyms = await tx<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined) return { kind: "not_found" };
    if (gym.status !== "active") return { kind: "org_archived" };
    const rows = await tx<{ id: string; cancel_at_period_end: boolean; cancel_sent_at: Date | null; current_period_end: Date | null }[]>`
      SELECT id, cancel_at_period_end, cancel_sent_at, current_period_end FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND provider = 'razorpay'
        AND status IN ('trialing','active','past_due')
      LIMIT 1
      FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) return { kind: "no_paid_plan" };
    if (!row.cancel_at_period_end) return { kind: "not_ending" };
    const end = row.current_period_end;
    if (row.cancel_sent_at !== null || end === null || end.getTime() - input.now.getTime() <= input.leadMs) {
      return { kind: "too_late", endsAt: end };
    }
    await tx`UPDATE subscriptions SET cancel_at_period_end = false WHERE id = ${row.id} AND owner_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: "billing.cancel_withdrawn",
      targetType: "subscription",
      targetId: row.id,
      meta: { provider: "razorpay" },
    });
    return { kind: "kept" };
  });
}

export interface CancelToSend {
  id: string;
  gymId: string;
  subscriptionRef: string;
  status: LocalStatus;
}

/** Plans set to end whose end is within `leadMs` (or past), claimed for sending to Razorpay:
 *  each is marked sent in the same statement, so two runs never both claim one and Keep my plan
 *  sees it gone. `gymId` narrows it to one gym (Cancel pressed close to the end). */
export async function claimCancelsToSend(sql: SqlOrTx, input: { now: Date; leadMs: number; limit: number; gymId?: string }): Promise<CancelToSend[]> {
  const until = new Date(input.now.getTime() + input.leadMs);
  const gymId = input.gymId ?? null;
  const rows = await sql<{ id: string; owner_id: string; provider_ref: string; status: LocalStatus }[]>`
    UPDATE subscriptions SET cancel_sent_at = ${input.now}
    WHERE id IN (
      SELECT id FROM subscriptions
      WHERE owner_type = 'gym' AND provider = 'razorpay' AND provider_ref IS NOT NULL
        AND cancel_at_period_end AND cancel_sent_at IS NULL
        AND status IN ('trialing','active')
        AND (current_period_end IS NULL OR current_period_end <= ${until})
        AND (${gymId}::uuid IS NULL OR owner_id = ${gymId}::uuid)
      ORDER BY current_period_end NULLS FIRST, id
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    )
      AND cancel_at_period_end AND cancel_sent_at IS NULL
    RETURNING id, owner_id, provider_ref, status`;
  return rows.map((r) => ({ id: r.id, gymId: r.owner_id, subscriptionRef: r.provider_ref, status: r.status }));
}

/** Razorpay did not take a cancel: it is claimed again on the next run. Keep my plan stays
 *  refused, as the end is within the hours it is sent in. */
export async function unclaimCancel(sql: SqlOrTx, input: { id: string; gymId: string; claimedAt: Date }): Promise<void> {
  await sql`
    UPDATE subscriptions SET cancel_sent_at = NULL
    WHERE id = ${input.id} AND owner_type = 'gym' AND owner_id = ${input.gymId} AND cancel_sent_at = ${input.claimedAt}`;
}

/** Plans set to end whose paid month is over and which are still live: read from Razorpay
 *  again, so they end even if its webhook never comes. */
export async function dueCancelEnds(sql: SqlOrTx, input: { now: Date; limit: number }): Promise<string[]> {
  const rows = await sql<{ provider_ref: string }[]>`
    SELECT provider_ref FROM subscriptions
    WHERE owner_type = 'gym' AND provider = 'razorpay' AND provider_ref IS NOT NULL
      AND cancel_at_period_end AND status IN ('trialing','active')
      AND current_period_end <= ${input.now}
    ORDER BY current_period_end, id
    LIMIT ${input.limit}`;
  return rows.map((r) => r.provider_ref);
}

/** Live plans paid through Razorpay whose month ended before `before` and which are not set to
 *  end (`dueCancelEnds` reads those): read from Razorpay again, since a plan Razorpay has
 *  stopped charging (`halted`) sends no event when its next month falls due, and a webhook can
 *  be lost. */
export async function dueRazorpayRenewals(sql: SqlOrTx, input: { before: Date; limit: number }): Promise<string[]> {
  const rows = await sql<{ provider_ref: string }[]>`
    SELECT provider_ref FROM subscriptions
    WHERE owner_type = 'gym' AND provider = 'razorpay' AND provider_ref IS NOT NULL
      AND NOT cancel_at_period_end AND status IN ('trialing','active')
      AND current_period_end <= ${input.before}
    ORDER BY current_period_end, id
    LIMIT ${input.limit}`;
  return rows.map((r) => r.provider_ref);
}

// ── A bigger (1d-iii-a) or smaller (1d-iii-b) size on a plan paid through Razorpay ─

/** `cancel_reason` of a plan a bigger or smaller size took the place of. */
export const REPLACED = "replaced";

export interface RazorpaySizeTarget {
  direction: SizeDirection;
  subscriptionRowId: string;
  subscriptionRef: string;
  /** When the month paid ends: the new size's price is first charged then. */
  periodEnd: Date;
  fromPlanId: string;
  fromPriceMinor: number;
  toPlanId: string;
  planCode: string;
  /** Razorpay's plan (`plan_…`) for the new size. */
  providerPlanId: string;
  priceMinor: number;
  currency: string;
  seatCap: number | null;
}

export type RazorpaySizeOutcome =
  | { kind: "ok"; target: RazorpaySizeTarget }
  | { kind: "no_paid_plan" }
  | { kind: "not_razorpay" }
  | { kind: "payment_overdue" }
  /** A paid trial made before 2f-i, not yet charged: its size waits for its first payment. */
  | { kind: "in_trial" }
  | { kind: "plan_ending" }
  /** The month paid ends within `renewGuardMs`, or has ended and its renewal is not written. */
  | { kind: "renewing" }
  | { kind: "no_such_plan" }
  | { kind: "same_size" }
  /** The smaller size already waiting to start. */
  | { kind: "already_waiting" }
  | { kind: "not_set_up" };

/** Which other size of its own price list this gym's Razorpay plan could move to now, or why
 *  not: only a plan paying in good standing, not set to end, with time left in its month for a
 *  window to be paid before Razorpay charges the next one. A smaller size may be chosen with
 *  more members than it holds: they are counted when it is due (Kd, RULINGS 2026-09-25). Read
 *  with the gym in every WHERE. */
export async function razorpaySizeTarget(
  sql: SqlOrTx,
  input: { gymId: string; planCode: string; now: Date; renewGuardMs: number },
): Promise<RazorpaySizeOutcome> {
  const live = await sql<
    {
      id: string;
      status: string;
      provider: string;
      provider_ref: string | null;
      cancel_at_period_end: boolean;
      current_period_end: Date | null;
      plan_id: string;
      seat_cap: number | null;
      price_minor: number;
      currency: string;
      pending_plan_id: string | null;
    }[]
  >`
    SELECT s.id, s.status, s.provider, s.provider_ref, s.cancel_at_period_end, s.current_period_end,
           s.plan_id, p.seat_cap, p.price_minor, p.currency, s.pending_plan_id
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.owner_type = 'gym' AND s.owner_id = ${input.gymId}
      AND s.status IN ('trialing','active','past_due')
    LIMIT 1`;
  const row = live[0];
  if (row === undefined) {
    const overdue = await sql`
      SELECT 1 FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND cancel_reason = ${GRACE_EXPIRED}
      LIMIT 1`;
    return overdue.length > 0 ? { kind: "payment_overdue" } : { kind: "no_paid_plan" };
  }
  if (row.provider !== "razorpay" || row.provider_ref === null) return { kind: "not_razorpay" };
  if (row.status === "past_due") return { kind: "payment_overdue" };
  if (row.status === "trialing") return { kind: "in_trial" };
  if (row.cancel_at_period_end) return { kind: "plan_ending" };

  const plans = await sql<{ id: string; code: string; seat_cap: number | null; razorpay_plan_id: string | null; price_minor: number; currency: string }[]>`
    SELECT id, code, seat_cap, razorpay_plan_id, price_minor, currency FROM plans
    WHERE code = ${input.planCode} AND audience = 'org' AND active = true
      AND interval = 'month' AND currency = ${row.currency}`;
  const plan = plans[0];
  if (plan === undefined) return { kind: "no_such_plan" };
  // Bigger means more members: a capless plan is bigger than any capped one.
  const bigger = row.seat_cap !== null && (plan.seat_cap === null || plan.seat_cap > row.seat_cap);
  const smaller = plan.seat_cap !== null && (row.seat_cap === null || plan.seat_cap < row.seat_cap);
  if (plan.id === row.plan_id || (!bigger && !smaller)) return { kind: "same_size" };
  if (smaller && plan.id === row.pending_plan_id) return { kind: "already_waiting" };
  if (row.current_period_end === null || row.current_period_end.getTime() <= input.now.getTime() + input.renewGuardMs) {
    return { kind: "renewing" };
  }
  if (plan.razorpay_plan_id === null) return { kind: "not_set_up" };
  return {
    kind: "ok",
    target: {
      direction: bigger ? "bigger" : "smaller",
      subscriptionRowId: row.id,
      subscriptionRef: row.provider_ref,
      periodEnd: row.current_period_end,
      fromPlanId: row.plan_id,
      fromPriceMinor: row.price_minor,
      toPlanId: plan.id,
      planCode: plan.code,
      providerPlanId: plan.razorpay_plan_id,
      priceMinor: plan.price_minor,
      currency: plan.currency,
      seatCap: plan.seat_cap,
    },
  };
}

export type BeginSizeCheckoutOutcome =
  | {
      kind: "created";
      checkout: CheckoutRow;
      target: RazorpaySizeTarget;
      /** The checkouts this press replaced, still open at their provider: the caller closes each. */
      superseded: { provider: PayProvider; ref: string }[];
    }
  | { kind: "replay"; checkout: CheckoutRow }
  | { kind: "key_reused" }
  | { kind: "refused"; outcome: Exclude<RazorpaySizeOutcome, { kind: "ok" }> }
  /** Razorpay's month is not the one our row holds (a renewal not yet written). */
  | { kind: "plan_changed_meanwhile" }
  | { kind: "org_archived" }
  | { kind: "not_found" };

/** Start the window for a bigger or smaller size: under the gym's lock, so the checks and the
 *  checkout are one step, and any checkout still open for this gym is superseded (the caller
 *  cancels it at its provider) so only one can be paid; a smaller size already approved is not
 *  open, and waits until another is approved. A bigger size's rest of this month's difference is
 *  priced HERE, from our own price list and the month Razorpay last charged (`periodStart`,
 *  `periodEnd`); a smaller one takes nothing now. */
export async function beginSizeCheckout(
  sql: Sql,
  input: {
    gymId: string;
    userId: string;
    planCode: string;
    idempotencyKey: string;
    now: Date;
    renewGuardMs: number;
    periodStart: Date;
    periodEnd: Date;
  },
): Promise<BeginSizeCheckoutOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const gyms = await tx<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined) return { kind: "not_found" };
    if (gym.status !== "active") return { kind: "org_archived" };

    const earlier = await tx<RawCheckout[]>`
      SELECT c.id, c.gym_id, c.plan_id, p.code AS plan_code, c.state, c.provider, c.provider_ref,
             c.replaces_subscription_id, c.period_start, c.starts_at, c.upfront_minor, c.size_direction
      FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
      WHERE c.gym_id = ${input.gymId} AND c.idempotency_key = ${input.idempotencyKey}`;
    const replay = earlier[0];
    if (replay !== undefined) {
      return replay.plan_code === input.planCode && replay.replaces_subscription_id !== null
        ? { kind: "replay", checkout: toCheckout(replay) }
        : { kind: "key_reused" };
    }

    const found = await razorpaySizeTarget(tx, input);
    if (found.kind !== "ok") return { kind: "refused", outcome: found };
    const target = found.target;
    if (target.periodEnd.getTime() !== input.periodEnd.getTime()) return { kind: "plan_changed_meanwhile" };
    const charge = upgradeCharge({
      fromMinor: target.fromPriceMinor,
      toMinor: target.priceMinor,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      now: input.now,
    });
    if (charge.kind === "month_over") return { kind: "refused", outcome: { kind: "renewing" } };
    const upfront = charge.kind === "charge" && target.direction === "bigger" ? charge.minor : null;

    const superseded = await tx<{ provider: string; provider_ref: string | null }[]>`
      UPDATE billing_checkouts SET state = 'superseded', updated_at = now()
      WHERE gym_id = ${input.gymId} AND state IN ('creating','open')
      RETURNING provider, provider_ref`;
    const inserted = await tx<RawCheckout[]>`
      INSERT INTO billing_checkouts (gym_id, plan_id, created_by, idempotency_key, provider,
                                     replaces_subscription_id, period_start, starts_at, upfront_minor, size_direction)
      VALUES (${input.gymId}, ${target.toPlanId}, ${input.userId}, ${input.idempotencyKey}, 'razorpay',
              ${target.subscriptionRowId}, ${input.periodStart}, ${target.periodEnd}, ${upfront}, ${target.direction})
      RETURNING id, gym_id, plan_id, ${input.planCode}::text AS plan_code, state, provider, provider_ref,
                replaces_subscription_id, period_start, starts_at, upfront_minor, size_direction`;
    const row = inserted[0];
    if (row === undefined) throw new Error("checkout insert returned no row");
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: "billing.size_checkout_started",
      targetType: "billing_checkout",
      targetId: row.id,
      meta: { plan: input.planCode, provider: "razorpay", direction: target.direction, upfront: upfront === null ? null : String(upfront) },
    });
    return {
      kind: "created",
      checkout: toCheckout(row),
      target,
      superseded: superseded.flatMap((s) => {
        const provider = PROVIDERS.find((p) => p === s.provider);
        return s.provider_ref === null || provider === undefined ? [] : [{ provider, ref: s.provider_ref }];
      }),
    };
  });
}

/** Razorpay has ended a replaced plan: the worker stops asking. */
export async function markReplacedCancelSent(sql: SqlOrTx, input: { gymId: string; rowId: string; now: Date }): Promise<void> {
  await sql`
    UPDATE subscriptions SET cancel_sent_at = ${input.now}
    WHERE id = ${input.rowId} AND owner_type = 'gym' AND owner_id = ${input.gymId}
      AND cancel_reason = ${REPLACED} AND cancel_sent_at IS NULL`;
}

/** Replaced plans Razorpay has not yet been seen to end: cancelled there by the worker. */
export async function replacedToCancel(sql: SqlOrTx, input: { limit: number }): Promise<{ rowId: string; gymId: string; subscriptionRef: string }[]> {
  const rows = await sql<{ id: string; owner_id: string; provider_ref: string }[]>`
    SELECT id, owner_id, provider_ref FROM subscriptions
    WHERE owner_type = 'gym' AND provider = 'razorpay' AND provider_ref IS NOT NULL
      AND cancel_reason = ${REPLACED} AND cancel_sent_at IS NULL
    ORDER BY ended_at, id
    LIMIT ${input.limit}`;
  return rows.map((r) => ({ rowId: r.id, gymId: r.owner_id, subscriptionRef: r.provider_ref }));
}

// ── A smaller size on a plan paid through Razorpay (1d-iii-b) ───────────────────

/** The smaller size waiting on a gym's live Razorpay plan: the subscription approved for it,
 *  and whether it has been decided (the members fit, and it is taking the plan's place). */
export interface RazorpayWaitingSize {
  rowId: string;
  subscriptionRef: string;
  decided: boolean;
}

export async function razorpayWaitingSize(sql: SqlOrTx, gymId: string): Promise<RazorpayWaitingSize | null> {
  const rows = await sql<{ id: string; pending_subscription_ref: string; pending_held_at: Date | null }[]>`
    SELECT id, pending_subscription_ref, pending_held_at FROM subscriptions
    WHERE owner_type = 'gym' AND owner_id = ${gymId} AND provider = 'razorpay'
      AND status IN ('trialing','active','past_due') AND pending_subscription_ref IS NOT NULL
    LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : { rowId: row.id, subscriptionRef: row.pending_subscription_ref, decided: row.pending_held_at !== null };
}

export type ApproveSmallerOutcome =
  /** Waiting on the plan from now. */
  | "approved"
  /** Already waiting: approved by another answer about the same window (the browser's and
   *  Razorpay's arrive together). */
  | "already"
  /** Not approvable: the window was closed by a newer press, or the plan changed. */
  | "refused";

/** A smaller size's window approved at Razorpay: it waits on the plan it replaces from now, in
 *  place of any smaller size approved before it (whose subscription the worker then ends). Under
 *  the gym's lock; only for the window still open, and only while that plan is as it was when
 *  the window opened — paying, not set to end, the same month, no size already decided. */
export async function approveSmallerSize(
  sql: Sql,
  input: { gymId: string; checkoutId: string; subscriptionRef: string },
): Promise<ApproveSmallerOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const checkouts = await tx<
      { state: string; plan_id: string; created_by: string | null; replaces_subscription_id: string | null; starts_at: Date | null; code: string }[]
    >`
      SELECT c.state, c.plan_id, c.created_by, c.replaces_subscription_id, c.starts_at, p.code
      FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
      WHERE c.id = ${input.checkoutId} AND c.gym_id = ${input.gymId} AND c.provider = 'razorpay'
        AND c.provider_ref = ${input.subscriptionRef} AND c.size_direction = 'smaller'
      FOR UPDATE OF c`;
    const checkout = checkouts[0];
    if (checkout?.state === "approved") {
      const waiting = await tx`
        SELECT 1 FROM subscriptions
        WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND pending_subscription_ref = ${input.subscriptionRef}
          AND status IN ('trialing','active','past_due')`;
      return waiting.length > 0 ? "already" : "refused";
    }
    if (checkout === undefined || checkout.state !== "open" || checkout.replaces_subscription_id === null || checkout.starts_at === null) return "refused";
    const moved = await tx<{ id: string }[]>`
      UPDATE subscriptions
      SET pending_plan_id = ${checkout.plan_id}, pending_from = ${checkout.starts_at}, pending_requested_plan_id = NULL,
          pending_held_at = NULL, pending_warned_at = NULL, pending_subscription_ref = ${input.subscriptionRef}
      WHERE id = ${checkout.replaces_subscription_id} AND owner_type = 'gym' AND owner_id = ${input.gymId}
        AND provider = 'razorpay' AND status = 'active' AND cancel_at_period_end = false
        AND current_period_end = ${checkout.starts_at} AND pending_held_at IS NULL
      RETURNING id`;
    if (moved.length !== 1) return "refused";
    await tx`UPDATE billing_checkouts SET state = 'approved', updated_at = now() WHERE id = ${input.checkoutId} AND gym_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: checkout.created_by,
      gymId: input.gymId,
      action: "billing.size_scheduled",
      targetType: "subscription",
      targetId: checkout.replaces_subscription_id,
      meta: { provider: "razorpay", plan: checkout.code, from: checkout.starts_at.toISOString() },
    });
    return "approved";
  });
}

/** The smaller size waiting ended at Razorpay before it took the plan's place (the gym's bank
 *  withdrew the mandate): the gym keeps its size. Only that subscription's. */
export async function dropRazorpayWaitingSize(sql: SqlOrTx, input: { gymId: string; subscriptionRef: string }): Promise<boolean> {
  const rows = await sql`
    UPDATE subscriptions
    SET pending_plan_id = NULL, pending_from = NULL, pending_requested_plan_id = NULL, pending_held_at = NULL,
        pending_warned_at = NULL, pending_subscription_ref = NULL
    WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND pending_subscription_ref = ${input.subscriptionRef}
    RETURNING id`;
  return rows.length > 0;
}

/** Plans whose smaller size through Razorpay is due by `until`: shortly before the month paid
 *  ends, or after it if that was missed. */
export async function dueRazorpaySmallerSizes(sql: SqlOrTx, input: { until: Date; limit: number }): Promise<{ id: string; gymId: string }[]> {
  const rows = await sql<{ id: string; owner_id: string }[]>`
    SELECT id, owner_id FROM subscriptions
    WHERE pending_plan_id IS NOT NULL AND pending_subscription_ref IS NOT NULL AND pending_from <= ${input.until}
      AND owner_type = 'gym' AND provider = 'razorpay' AND status IN ('active','past_due') AND cancel_at_period_end = false
    ORDER BY pending_from, id
    LIMIT ${input.limit}`;
  return rows.map((r) => ({ id: r.id, gymId: r.owner_id }));
}

export type RazorpaySizeClaim =
  /** The members fit: the smaller size holds for joins from now and takes the plan's place. */
  | { kind: "fit"; subscriptionRef: string }
  /** More members than it holds: it is dropped and the gym stays on its size (Kd, RULINGS
   *  2026-10-01). The count is kept for the Plan card and the email. */
  | { kind: "kept"; members: number; subscriptionRef: string };

/** Decide one plan's smaller size through Razorpay, under the gym's lock: the members counted
 *  once. Asked again after a decision that fit, it answers the same, so the worker finishes a
 *  replacement cut off mid-way. A plan that renewed at its own size first (the worker was down
 *  past the day) is decided the same way: the renewal is refunded when the smaller size takes
 *  its place (`applySnapshot`). Null when nothing waits. */
export async function claimRazorpaySmallerSize(sql: Sql, input: { gymId: string; rowId: string; now: Date }): Promise<RazorpaySizeClaim | null> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const rows = await tx<
      {
        plan_id: string;
        pending_plan_id: string;
        pending_from: Date;
        pending_held_at: Date | null;
        pending_subscription_ref: string;
        seat_cap: number | null;
        code: string;
      }[]
    >`
      SELECT s.plan_id, s.pending_plan_id, s.pending_from, s.pending_held_at, s.pending_subscription_ref,
             p.seat_cap, p.code
      FROM subscriptions s JOIN plans p ON p.id = s.pending_plan_id
      WHERE s.id = ${input.rowId} AND s.owner_type = 'gym' AND s.owner_id = ${input.gymId}
        AND s.provider = 'razorpay' AND s.status IN ('active','past_due') AND s.cancel_at_period_end = false
        AND s.pending_subscription_ref IS NOT NULL
      FOR UPDATE OF s`;
    const row = rows[0];
    if (row === undefined) return null;
    const ref = row.pending_subscription_ref;
    const drop = async (meta: Record<string, string>) => {
      await tx`
        UPDATE subscriptions
        SET pending_plan_id = NULL, pending_from = NULL, pending_requested_plan_id = NULL, pending_held_at = NULL,
            pending_warned_at = NULL, pending_subscription_ref = NULL
        WHERE id = ${input.rowId} AND owner_id = ${input.gymId}`;
      await insertAudit(tx, {
        actorUserId: null,
        gymId: input.gymId,
        action: "billing.size_change_not_made",
        targetType: "subscription",
        targetId: input.rowId,
        meta: { plan: row.code, ...meta },
      });
    };
    if (row.pending_held_at !== null) return { kind: "fit", subscriptionRef: ref };
    const members = await seatsUsed(tx, input.gymId);
    if (row.seat_cap !== null && members > row.seat_cap) {
      await drop({ members: String(members) });
      // What the Plan card and the email say: the size asked for, and the members counted.
      const key = "razorpay:" + ref;
      await tx`
        INSERT INTO billing_plan_changes (gym_id, subscription_id, from_plan_id, to_plan_id, created_by,
                                          idempotency_key, provider, state, failure, members_counted, created_at)
        VALUES (${input.gymId}, ${input.rowId}, ${row.plan_id}, ${row.pending_plan_id}, NULL,
                ${key}, 'razorpay', 'failed', 'too_many_members', ${members}, ${input.now})
        ON CONFLICT (gym_id, idempotency_key) DO NOTHING`;
      return { kind: "kept", members, subscriptionRef: ref };
    }
    await tx`UPDATE subscriptions SET pending_held_at = ${input.now} WHERE id = ${input.rowId} AND owner_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: null,
      gymId: input.gymId,
      action: "billing.size_change_decided",
      targetType: "subscription",
      targetId: input.rowId,
      meta: { plan: row.code, members: String(members) },
    });
    return { kind: "fit", subscriptionRef: ref };
  });
}

/** Smaller sizes approved at Razorpay that no longer wait on any plan of the gym's (cancelled,
 *  not made, another chosen, the plan ended or replaced): the worker ends each at Razorpay and
 *  refunds anything it took. */
export async function strandedSmallerSizes(
  sql: SqlOrTx,
  input: { limit: number; gymId?: string },
): Promise<{ checkoutId: string; gymId: string; subscriptionRef: string }[]> {
  const gymId = input.gymId ?? null;
  const rows = await sql<{ id: string; gym_id: string; provider_ref: string }[]>`
    SELECT c.id, c.gym_id, c.provider_ref FROM billing_checkouts c
    WHERE c.state = 'approved' AND c.provider = 'razorpay' AND c.provider_ref IS NOT NULL
      AND (${gymId}::uuid IS NULL OR c.gym_id = ${gymId}::uuid)
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.owner_type = 'gym' AND s.owner_id = c.gym_id AND s.pending_subscription_ref = c.provider_ref
          AND s.status IN ('trialing','active','past_due'))
      AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.provider = 'razorpay' AND s.provider_ref = c.provider_ref)
    ORDER BY c.updated_at, c.id
    LIMIT ${input.limit}`;
  return rows.map((r) => ({ checkoutId: r.id, gymId: r.gym_id, subscriptionRef: r.provider_ref }));
}

/** A stranded smaller size ended at Razorpay: the worker stops asking. */
export async function markSmallerDropped(sql: SqlOrTx, input: { checkoutId: string; gymId: string }): Promise<void> {
  await sql`
    UPDATE billing_checkouts SET state = 'dropped', updated_at = now()
    WHERE id = ${input.checkoutId} AND gym_id = ${input.gymId} AND state = 'approved'`;
}
