// A gym paying us: its checkouts and its paid subscription (ROADMAP Stage 3 item 1a).
// Every checkout is read with its gym in the WHERE; a Paddle subscription is placed on
// a gym only through a checkout row our server wrote.
import type { Sql, TransactionSql } from "postgres";
import { insertAudit, lockOrgRow } from "../orgs/repo.js";
import { decide, type Decision, type LocalStatus, type Snapshot } from "./machine.js";

type SqlOrTx = Sql | TransactionSql;

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
  | { kind: "created"; checkout: CheckoutRow; priceId: string; priceMinor: number; currency: string; superseded: string[] }
  | { kind: "replay"; checkout: CheckoutRow }
  | { kind: "key_reused" }
  | { kind: "trial_running" }
  | { kind: "already_subscribed" }
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
  input: { gymId: string; userId: string; planCode: string; idempotencyKey: string; currency: string },
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

    const live = await tx<{ status: string }[]>`
      SELECT status FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId}
        AND status IN ('trialing','active','past_due')`;
    const current = live[0];
    if (current !== undefined) return current.status === "trialing" ? { kind: "trial_running" } : { kind: "already_subscribed" };

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
      INSERT INTO billing_checkouts (gym_id, plan_id, created_by, idempotency_key, provider)
      VALUES (${input.gymId}, ${plan.id}, ${input.userId}, ${input.idempotencyKey}, 'paddle')
      RETURNING id, gym_id, ${input.planCode}::text AS plan_code, state, provider_ref`;
    const row = inserted[0];
    if (row === undefined) throw new Error("checkout insert returned no row");
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: "billing.checkout_started",
      targetType: "billing_checkout",
      targetId: row.id,
      meta: { plan: input.planCode },
    });
    return {
      kind: "created",
      checkout: toCheckout(row),
      priceId: plan.paddle_price_id,
      priceMinor: plan.price_minor,
      currency: plan.currency,
      superseded: superseded.flatMap((s) => (s.provider_ref === null ? [] : [s.provider_ref])),
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

export async function planForPaddlePrice(sql: SqlOrTx, priceId: string): Promise<{ id: string } | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM plans WHERE paddle_price_id = ${priceId} AND audience = 'org'`;
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
    const others = await tx<{ one: number }[]>`
      SELECT 1 AS one FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId}
        AND status IN ('trialing','active','past_due')
        AND (${existing?.id ?? null}::uuid IS NULL OR id <> ${existing?.id ?? null}::uuid)
      LIMIT 1`;
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
            },
      otherLive: others.length > 0,
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
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, current_period_end,
                                   cancel_at_period_end, provider, provider_ref,
                                   provider_customer_ref, provider_updated_at, ended_at, cancel_reason)
        VALUES ('gym', ${input.gymId}, ${s.planId}, ${status}, ${s.currentPeriodEnd},
                ${s.cancelAtPeriodEnd}, 'paddle', ${input.subscriptionId}, ${input.customerId},
                ${s.updatedAt}, ${ended}, ${decision.kind === "duplicate" ? "duplicate" : null})
        RETURNING id`;
      rowId = inserted[0]?.id ?? null;
      if (rowId === null) throw new Error("subscription insert returned no row");
      await audit(rowId, decision.kind === "duplicate" ? "billing.duplicate" : `billing.${decision.event}`);
    } else if (decision.kind === "update" && existing !== null) {
      await tx`
        UPDATE subscriptions
        SET status = ${decision.status}, plan_id = ${s.planId}, current_period_end = ${s.currentPeriodEnd},
            cancel_at_period_end = ${s.cancelAtPeriodEnd}, provider_updated_at = ${s.updatedAt},
            provider_customer_ref = COALESCE(${input.customerId}, provider_customer_ref),
            ended_at = CASE WHEN ${decision.status} = 'expired' THEN COALESCE(ended_at, ${input.now}) ELSE NULL END
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
