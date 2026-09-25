// A gym paying us: its checkouts, its paid subscription and its size changes (ROADMAP
// Stage 3 items 1a, 1c-i, 1c-ii and 1c-iii).
// Every checkout is read with its gym in the WHERE; a Paddle subscription is placed on
// a gym only through a checkout row our server wrote.
import type { PaddleSubscription } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { insertAudit, lockOrgRow } from "../orgs/repo.js";
import { decide, type Decision, type LocalStatus, type Snapshot } from "./machine.js";

type SqlOrTx = Sql | TransactionSql;

/** `cancel_reason` of a paid plan whose grace ran out while Paddle still retries. */
export const GRACE_EXPIRED = "grace_expired";
/** `cancel_reason` of a free trial ended because the gym paid during it (1c-ii). */
export const TRIAL_SUBSCRIBED = "subscribed";

/** A trial checkout is sold only while this much of the gym's own trial is left; with less,
 *  the checkout charges at once. */
export const TRIAL_CHECKOUT_MIN_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CheckoutState = "creating" | "open" | "superseded" | "failed" | "paid";

export interface CheckoutRow {
  id: string;
  gymId: string;
  planCode: string;
  state: CheckoutState;
  providerRef: string | null;
}

interface RawCheckout {
  id: string;
  gym_id: string;
  plan_code: string;
  state: string;
  provider_ref: string | null;
}

const STATES: readonly CheckoutState[] = ["creating", "open", "superseded", "failed", "paid"];

function toCheckout(raw: RawCheckout): CheckoutRow {
  const state = STATES.find((s) => s === raw.state);
  if (state === undefined) throw new Error(`unknown checkout state ${raw.state}`);
  return { id: raw.id, gymId: raw.gym_id, planCode: raw.plan_code, state, providerRef: raw.provider_ref };
}

/** The members a gym is paying for: live, not complimentary, not staff. The same
 *  conditions as `claimSeat`'s cap and `listOrgsForUser`'s meter (orgs/repo.ts). */
export async function seatsUsed(sql: SqlOrTx, gymId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_members m
    WHERE m.gym_id = ${gymId} AND m.removed_at IS NULL
      AND m.complimentary = false
      AND NOT EXISTS (
        SELECT 1 FROM gym_staff s
        WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)`;
  return rows[0]?.n ?? 0;
}

export type BeginCheckoutOutcome =
  | {
      kind: "created";
      checkout: CheckoutRow;
      priceId: string;
      priceMinor: number;
      currency: string;
      superseded: string[];
      /** During the gym's own free trial: the whole days left, rounded up (Paddle's trial
       *  counts days), so the first payment falls when the trial ends. */
      trialDays: number | null;
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
 *  Paddle transaction is cancelled by the caller) so only one can be paid. */
export async function beginCheckout(
  sql: Sql,
  input: { gymId: string; userId: string; planCode: string; idempotencyKey: string; currency: string; now: Date },
): Promise<BeginCheckoutOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const gyms = await tx<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined) return { kind: "not_found" };
    if (gym.status !== "active") return { kind: "org_archived" };

    const earlier = await tx<RawCheckout[]>`
      SELECT c.id, c.gym_id, p.code AS plan_code, c.state, c.provider_ref
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
    // The gym's own free trial may be paid for now, charged when it ends (Kd, RULINGS
    // 2026-09-25); anything else live is a plan already chosen.
    if (current !== undefined && !isLocalTrial(current)) return { kind: "already_subscribed" };
    const trialEnd = current?.trial_ends_at ?? null;
    const trialLeftMs = trialEnd === null ? 0 : trialEnd.getTime() - input.now.getTime();
    const trialDays = trialLeftMs >= TRIAL_CHECKOUT_MIN_MS ? Math.ceil(trialLeftMs / DAY_MS) : null;
    // An unpaid plan Paddle still retries: a new card there pays it, a second plan would double it.
    const overdue = await tx`
      SELECT 1 FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND cancel_reason = ${GRACE_EXPIRED}
      LIMIT 1`;
    if (overdue.length > 0) return { kind: "payment_overdue" };

    const plans = await tx<{ id: string; seat_cap: number | null; paddle_price_id: string | null; price_minor: number; currency: string }[]>`
      SELECT id, seat_cap, paddle_price_id, price_minor, currency FROM plans
      WHERE code = ${input.planCode} AND audience = 'org' AND active = true
        AND interval = 'month' AND currency = ${input.currency}`;
    const plan = plans[0];
    if (plan === undefined) return { kind: "no_such_plan" };
    const used = await seatsUsed(tx, input.gymId);
    if (plan.seat_cap !== null && used > plan.seat_cap) return { kind: "plan_too_small", seatCap: plan.seat_cap, seatsUsed: used };
    if (plan.paddle_price_id === null) return { kind: "not_set_up" };

    const superseded = await tx<{ provider_ref: string | null }[]>`
      UPDATE billing_checkouts SET state = 'superseded', updated_at = now()
      WHERE gym_id = ${input.gymId} AND state IN ('creating','open')
      RETURNING provider_ref`;
    const inserted = await tx<RawCheckout[]>`
      INSERT INTO billing_checkouts (gym_id, plan_id, created_by, idempotency_key, provider, trial_ends_at)
      VALUES (${input.gymId}, ${plan.id}, ${input.userId}, ${input.idempotencyKey}, 'paddle',
              ${trialDays === null ? null : trialEnd})
      RETURNING id, gym_id, ${input.planCode}::text AS plan_code, state, provider_ref`;
    const row = inserted[0];
    if (row === undefined) throw new Error("checkout insert returned no row");
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: "billing.checkout_started",
      targetType: "billing_checkout",
      targetId: row.id,
      meta: { plan: input.planCode, ...(trialDays === null ? {} : { trialDays: String(trialDays) }) },
    });
    return {
      kind: "created",
      checkout: toCheckout(row),
      priceId: plan.paddle_price_id,
      priceMinor: plan.price_minor,
      currency: plan.currency,
      superseded: superseded.flatMap((s) => (s.provider_ref === null ? [] : [s.provider_ref])),
      trialDays,
    };
  });
}

/** The checkout now has its Paddle transaction. False when another press superseded it
 *  meanwhile: the caller cancels the transaction it just made. */
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
    SELECT c.id, c.gym_id, p.code AS plan_code, c.state, c.provider_ref
    FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
    WHERE c.id = ${input.checkoutId} AND c.gym_id = ${input.gymId}`;
  const row = rows[0];
  return row === undefined ? null : toCheckout(row);
}

/** Our checkouts among these Paddle transactions: where a subscription's gym comes from. */
export async function checkoutsForTransactions(sql: SqlOrTx, transactionIds: readonly string[]): Promise<CheckoutRow[]> {
  if (transactionIds.length === 0) return [];
  const rows = await sql<RawCheckout[]>`
    SELECT c.id, c.gym_id, p.code AS plan_code, c.state, c.provider_ref
    FROM billing_checkouts c JOIN plans p ON p.id = c.plan_id
    WHERE c.provider = 'paddle' AND c.provider_ref = ANY(${[...transactionIds]}::text[])
    ORDER BY c.created_at, c.id`;
  return rows.map(toCheckout);
}

/** The member limit of the gym's own free trial: its latest one's plan, or the trial band
 *  of its price list (the smallest plan with a trial, as starting a trial picks it). */
async function freeTrialSeatCap(tx: SqlOrTx, gymId: string): Promise<number | null> {
  const own = await tx<{ seat_cap: number | null }[]>`
    SELECT p.seat_cap FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.owner_type = 'gym' AND s.owner_id = ${gymId}
      AND s.provider IN ('none','pilot') AND s.trial_ends_at IS NOT NULL
    ORDER BY s.created_at DESC
    LIMIT 1`;
  if (own[0] !== undefined) return own[0].seat_cap;
  const band = await tx<{ seat_cap: number | null }[]>`
    SELECT p.seat_cap FROM plans p JOIN gyms g ON g.id = ${gymId}
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
}

export async function findPaddleSubscription(sql: SqlOrTx, subscriptionId: string): Promise<PaddleRow | null> {
  const rows = await sql<{ id: string; owner_id: string; status: LocalStatus; cancel_reason: string | null }[]>`
    SELECT id, owner_id, status, cancel_reason FROM subscriptions
    WHERE provider = 'paddle' AND provider_ref = ${subscriptionId} AND owner_type = 'gym'`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, gymId: row.owner_id, status: row.status, cancelReason: row.cancel_reason };
}

export interface ApplyOutcome {
  decision: Decision;
  /** The row this subscription is, when there is one after the write. */
  rowId: string | null;
  /** The row was set aside as a duplicate, now or before: cancel and refund at Paddle. */
  duplicate: boolean;
}

/** Write Paddle's record of one subscription onto the gym, through the one rule.
 *  Under the gym's lock (the subscription-writer lock) and in one transaction with its
 *  audit row, so the live-plan check and the write cannot be split by another writer. */
export async function applySnapshot(
  sql: Sql,
  input: {
    gymId: string;
    subscriptionId: string;
    customerId: string | null;
    snapshot: Snapshot;
    checkoutId: string | null;
    now: Date;
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
      WHERE provider = 'paddle' AND provider_ref = ${input.subscriptionId} AND owner_type = 'gym'
      FOR UPDATE`;
    const existing = rows[0] ?? null;
    // A subscription placed on one gym never moves to another.
    if (existing !== null && existing.owner_id !== input.gymId) {
      return { decision: { kind: "ignore", reason: "not_ours" }, rowId: existing.id, duplicate: false };
    }
    const others = await tx<{ id: string; status: string; provider: string }[]>`
      SELECT id, status, provider FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId}
        AND status IN ('trialing','active','past_due')
        AND (${existing?.id ?? null}::uuid IS NULL OR id <> ${existing?.id ?? null}::uuid)`;
    // The gym's own free trial gives way to the plan it paid for during it.
    const localTrial = others.find(isLocalTrial) ?? null;
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
      otherLive: others.some((o) => !isLocalTrial(o)),
      snapshot: input.snapshot,
    });
    const s = input.snapshot;
    const audit = async (rowId: string, action: string) => {
      await insertAudit(tx, {
        actorUserId: null,
        gymId: input.gymId,
        action,
        targetType: "subscription",
        targetId: rowId,
        meta: { provider: "paddle", paddleStatus: s.status, via: "paddle" },
      });
    };

    let rowId = existing?.id ?? null;
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
          meta: { provider: "paddle", via: "paddle" },
        });
      }
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, trial_ends_at, trial_seat_cap,
                                   current_period_end, cancel_at_period_end, provider, provider_ref,
                                   provider_customer_ref, provider_updated_at, ended_at, cancel_reason,
                                   past_due_since)
        VALUES ('gym', ${input.gymId}, ${s.planId}, ${status}, ${trialEndsAt}, ${trialSeatCap},
                ${s.currentPeriodEnd}, ${s.cancelAtPeriodEnd}, 'paddle', ${input.subscriptionId}, ${input.customerId},
                ${s.updatedAt}, ${ended}, ${decision.kind === "duplicate" ? "duplicate" : null},
                ${pastDueSince})
        RETURNING id`;
      rowId = inserted[0]?.id ?? null;
      if (rowId === null) throw new Error("subscription insert returned no row");
      await audit(rowId, decision.kind === "duplicate" ? "billing.duplicate" : `billing.${decision.event}`);
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
                                     THEN NULL ELSE pending_warned_at END
        WHERE id = ${existing.id}`;
      await audit(existing.id, `billing.${decision.event}`);
    }
    if (input.checkoutId !== null && (decision.kind === "insert" || decision.kind === "duplicate")) {
      await tx`
        UPDATE billing_checkouts SET state = 'paid', updated_at = now()
        WHERE id = ${input.checkoutId} AND gym_id = ${input.gymId}`;
    }
    const duplicate = decision.kind === "duplicate" || existing?.cancel_reason === "duplicate";
    return { decision, rowId, duplicate };
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

/** Trial checkouts still open after the gym's own trial ended: their window would sell a
 *  trial the gym no longer has, so the worker cancels them at Paddle. */
export async function staleTrialCheckouts(sql: SqlOrTx, now: Date, limit: number): Promise<{ id: string; gymId: string; providerRef: string }[]> {
  const rows = await sql<{ id: string; gym_id: string; provider_ref: string }[]>`
    SELECT id, gym_id, provider_ref FROM billing_checkouts
    WHERE state = 'open' AND trial_ends_at IS NOT NULL AND trial_ends_at <= ${now}
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
    SELECT c.id, c.gym_id, p.code AS plan_code, c.state, c.provider_ref
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
 *  lose the plan's features and the console goes read-only until Paddle collects.
 *  Each row under its gym's lock, re-checked there, so a payment written meanwhile
 *  wins; running it twice changes nothing. Returns the gyms whose grace ended. */
export async function endGraces(sql: Sql, input: { cutoff: Date; now: Date; limit: number }): Promise<string[]> {
  const due = await sql<{ id: string; owner_id: string }[]>`
    SELECT id, owner_id FROM subscriptions
    WHERE status = 'past_due' AND past_due_since <= ${input.cutoff}
      AND owner_type = 'gym' AND provider = 'paddle'
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
        meta: { provider: "paddle" },
      });
      return true;
    });
    if (done) ended.push(row.owner_id);
  }
  return ended;
}

export type RefundReason = "duplicate" | "unmatched";

/** Write down the refunds owed for a subscription set aside, one per paid transaction.
 *  Kept once per transaction, so recording them again changes nothing. */
export async function oweRefunds(
  sql: SqlOrTx,
  input: { gymId: string | null; subscriptionRef: string; reason: RefundReason; transactionRefs: readonly string[] },
): Promise<number> {
  let added = 0;
  for (const transactionRef of input.transactionRefs) {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO billing_refunds (gym_id, provider, subscription_ref, transaction_ref, reason)
      VALUES (${input.reason === "unmatched" ? null : input.gymId}, 'paddle', ${input.subscriptionRef},
              ${transactionRef}, ${input.reason})
      ON CONFLICT (provider, transaction_ref) DO NOTHING
      RETURNING id`;
    added += rows.length;
  }
  return added;
}

export interface OwedRefund {
  id: string;
  transactionRef: string;
  tries: number;
  createdAt: Date;
}

/** Take the next refund that is due and hold it for `leaseMs`: a second worker skips it. */
export async function claimDueRefund(sql: Sql, now: Date, leaseMs: number): Promise<OwedRefund | null> {
  const rows = await sql<{ id: string; transaction_ref: string; tries: number; created_at: Date }[]>`
    WITH next AS (
      SELECT id FROM billing_refunds
      WHERE state = 'owed' AND not_before <= ${now}
      ORDER BY not_before, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE billing_refunds r
    SET not_before = ${new Date(now.getTime() + leaseMs)}, updated_at = now()
    FROM next WHERE r.id = next.id
    RETURNING r.id, r.transaction_ref, r.tries, r.created_at`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, transactionRef: row.transaction_ref, tries: row.tries, createdAt: row.created_at };
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
    SET pending_plan_id = NULL, pending_from = NULL, pending_requested_plan_id = NULL, pending_held_at = NULL, pending_warned_at = NULL
    WHERE id = ${input.subscriptionRowId} AND owner_type = 'gym' AND owner_id = ${input.gymId}
      AND pending_plan_id = ${input.planId}`;
}

export type KeepSizeOutcome = { kind: "kept" } | { kind: "nothing_waiting" } | { kind: "in_progress" } | { kind: "org_archived" } | { kind: "not_found" };

/** "Cancel this change": the smaller size waiting is dropped, under the gym's lock, so it
 *  cannot cross the worker making it at Paddle (which holds a pending change meanwhile). */
export async function keepSize(sql: Sql, input: { gymId: string; userId: string }): Promise<KeepSizeOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId); // subscription-writer lock
    const gyms = await tx<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined) return { kind: "not_found" };
    if (gym.status !== "active") return { kind: "org_archived" };
    const pending = await tx`SELECT 1 FROM billing_plan_changes WHERE gym_id = ${input.gymId} AND state = 'pending'`;
    if (pending.length > 0) return { kind: "in_progress" };
    const kept = await tx<{ id: string; code: string }[]>`
      UPDATE subscriptions s
      SET pending_plan_id = NULL, pending_from = NULL, pending_requested_plan_id = NULL, pending_held_at = NULL, pending_warned_at = NULL
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
  priceId: string;
}

/** The smallest size of the gym's own price list that holds `members` and is smaller than
 *  the plan it is on: where a gym with too many members for the size it asked for moves
 *  instead (Kd, RULINGS 2026-09-25). Null when nothing smaller holds them. */
export async function smallestFittingPlan(sql: SqlOrTx, input: { gymId: string; members: number }): Promise<FittingPlan | null> {
  const rows = await sql<{ id: string; code: string; seat_cap: number; price_minor: number; paddle_price_id: string }[]>`
    SELECT fp.id, fp.code, fp.seat_cap, fp.price_minor, fp.paddle_price_id
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    JOIN plans fp ON fp.audience = 'org' AND fp.active = true AND fp.interval = 'month'
                 AND fp.currency = p.currency AND fp.paddle_price_id IS NOT NULL
    WHERE s.owner_type = 'gym' AND s.owner_id = ${input.gymId}
      AND s.status IN ('trialing','active','past_due')
      AND fp.seat_cap IS NOT NULL AND fp.seat_cap >= ${input.members}
      AND (p.seat_cap IS NULL OR fp.seat_cap < p.seat_cap)
    ORDER BY fp.seat_cap, fp.price_minor
    LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, code: row.code, seatCap: row.seat_cap, priceMinor: row.price_minor, priceId: row.paddle_price_id };
}

export type PendingClaimOutcome =
  /** The members fit the size asked for, or a bigger one smaller than the plan: it now holds
   *  for joins, and Paddle is to be asked. */
  | { kind: "claimed"; claim: PendingClaim }
  /** No smaller size holds the members: the size asked for was dropped and the gym stays. */
  | { kind: "kept"; members: number; seatCap: number };

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
                                 pending_held_at = NULL, pending_warned_at = NULL
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
      return { kind: "kept", members, seatCap: row.seat_cap };
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
export async function dueSizeWarnings(sql: SqlOrTx, input: { now: Date; within: number; lead: number; limit: number }): Promise<SizeWarningDue[]> {
  const rows = await sql<{ id: string; owner_id: string }[]>`
    SELECT id, owner_id FROM subscriptions
    WHERE pending_plan_id IS NOT NULL AND pending_warned_at IS NULL AND pending_held_at IS NULL
      AND pending_from <= ${new Date(input.now.getTime() + input.within)} AND pending_from > ${new Date(input.now.getTime() + input.lead)}
      AND owner_type = 'gym' AND provider = 'paddle' AND status = 'active' AND cancel_at_period_end = false
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
    }[]
  >`
    SELECT g.name, g.slug, g.org_type, g.timezone, p.seat_cap, p.price_minor, p.currency,
           tp.seat_cap AS target_seat_cap, tp.price_minor AS target_price_minor, s.pending_from
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
  if (row === undefined || row.target_seat_cap === null || row.target_price_minor === null) return null;
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