// Co-owners (ROADMAP Stage 2 item 4b-i): the gym's owner asks one of its staff to be a
// co-owner, and the person asked accepts or declines. Every write takes the gym's row lock
// first, as every change to who runs a gym does (`addStaff`, `removeStaff`, `claimSeat`),
// so a request, its answer and a change to the person's staff row happen one at a time.
//
// THE RULE THIS FILE HOLDS: nobody becomes an owner unless the gym's own owner asked them,
// while they were on its staff, and they themselves pressed Accept before the request ended.
import type { Sql, TransactionSql } from "postgres";
import { GRACE_EXPIRED, type PayProvider } from "../../billing/repo.js";
import { insertAudit, lockOrgRow } from "../repo.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// A WAITING REQUEST, in every reader below: pending, its time not run out, and the person
// still holding the very staff row they were asked on (`staff_since`), not yet an owner.
// Written out in each statement rather than shared, as the staff readers are (R3.8); the
// tests drive the Staff tab, the Overview and Accept over the same cases.

/** The gym's own owner. */
export async function gymOwnerId(sql: Sql | TransactionSql, gymId: string): Promise<string | null> {
  const rows = await sql<{ owner_user_id: string }[]>`SELECT owner_user_id FROM gyms WHERE id = ${gymId}`;
  return rows[0]?.owner_user_id ?? null;
}

/** Somebody on this gym's staff at this address (a live account), or null. */
export async function staffAtAddress(sql: Sql, gymId: string, email: string): Promise<{ userId: string; role: string } | null> {
  const rows = await sql<{ user_id: string; role: string }[]>`
    SELECT s.user_id, s.role FROM gym_staff s JOIN users u ON u.id = s.user_id
    WHERE s.gym_id = ${gymId} AND u.email = ${email} AND u.status = 'active'
    LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : { userId: row.user_id, role: row.role };
}

/** The requests waiting at this gym, by the person asked: when each ends. */
export async function waitingRequests(sql: Sql, gymId: string, now: Date): Promise<Map<string, Date>> {
  const rows = await sql<{ user_id: string; expires_at: Date }[]>`
    SELECT r.user_id, r.expires_at FROM gym_co_owner_requests r
    WHERE r.gym_id = ${gymId} AND r.state = 'pending' AND r.expires_at > ${now}
      AND EXISTS (SELECT 1 FROM gym_staff s
                  WHERE s.gym_id = r.gym_id AND s.user_id = r.user_id AND s.created_at = r.staff_since AND s.role <> 'owner')`;
  return new Map(rows.map((r) => [r.user_id, r.expires_at]));
}

/** A request that no longer counts (its time ran out, or the staff row it was sent on is
 *  gone) is closed, so a new one can be sent. */
async function endStale(tx: TransactionSql, gymId: string, userId: string, now: Date): Promise<void> {
  await tx`
    UPDATE gym_co_owner_requests r
    SET state = CASE WHEN r.expires_at <= ${now} THEN 'expired' ELSE 'cancelled' END,
        answered_at = LEAST(r.expires_at, ${now})
    WHERE r.gym_id = ${gymId} AND r.user_id = ${userId} AND r.state = 'pending'
      AND (r.expires_at <= ${now}
           OR NOT EXISTS (SELECT 1 FROM gym_staff s
                          WHERE s.gym_id = r.gym_id AND s.user_id = r.user_id AND s.created_at = r.staff_since AND s.role <> 'owner'))`;
}

export type SendOutcome =
  | {
      kind: "sent";
      requestId: string;
      expiresAt: Date;
      /** For the email: the address of the person asked (null for an account with none). */
      email: string | null;
      gymName: string;
      gymSlug: string;
      ownerName: string;
    }
  | { kind: "owner_only" }
  | { kind: "not_staff" }
  | { kind: "already_owner" }
  | { kind: "already_requested" };

export async function sendRequest(
  sql: Sql,
  input: { gymId: string; userId: string; actorUserId: string; now: Date; days: number },
): Promise<SendOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const gyms = await tx<{ owner_user_id: string; name: string; slug: string; owner_name: string }[]>`
      SELECT g.owner_user_id, g.name, g.slug, u.display_name AS owner_name
      FROM gyms g JOIN users u ON u.id = g.owner_user_id
      WHERE g.id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined || gym.owner_user_id !== input.actorUserId) return { kind: "owner_only" };

    const staff = await tx<{ role: string; email: string | null }[]>`
      SELECT s.role, u.email FROM gym_staff s JOIN users u ON u.id = s.user_id
      WHERE s.gym_id = ${input.gymId} AND s.user_id = ${input.userId} AND u.status = 'active'`;
    const target = staff[0];
    if (target === undefined) return { kind: "not_staff" };
    if (target.role === "owner") return { kind: "already_owner" };

    await endStale(tx, input.gymId, input.userId, input.now);
    const waiting = await tx`
      SELECT 1 FROM gym_co_owner_requests
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId} AND state = 'pending'`;
    if (waiting.length > 0) return { kind: "already_requested" };

    const expiresAt = new Date(input.now.getTime() + input.days * DAY_MS);
    const made = await tx<{ id: string }[]>`
      INSERT INTO gym_co_owner_requests (gym_id, user_id, requested_by, staff_since, created_at, expires_at)
      VALUES (${input.gymId}, ${input.userId}, ${input.actorUserId},
              (SELECT created_at FROM gym_staff WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}),
              ${input.now}, ${expiresAt})
      RETURNING id`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.co_owner_requested",
      targetType: "gym_staff",
      targetId: input.userId,
      meta: { requestId: made[0]?.id ?? null },
    });
    const requestId = made[0]?.id;
    if (requestId === undefined) throw new Error("the co-owner request was not written");
    return { kind: "sent", requestId, expiresAt, email: target.email, gymName: gym.name, gymSlug: gym.slug, ownerName: gym.owner_name };
  });
}

/** Claim this request's email: false when the same person was emailed by a request of this
 *  gym's in the last day, so Send and Cancel pressed over and over send one email. */
export async function claimEmail(sql: Sql, input: { gymId: string; userId: string; requestId: string; now: Date }): Promise<boolean> {
  const dayAgo = new Date(input.now.getTime() - DAY_MS);
  const rows = await sql`
    UPDATE gym_co_owner_requests r SET emailed_at = ${input.now}
    WHERE r.id = ${input.requestId} AND r.gym_id = ${input.gymId}
      AND NOT EXISTS (SELECT 1 FROM gym_co_owner_requests o
                      WHERE o.gym_id = r.gym_id AND o.user_id = ${input.userId} AND o.emailed_at > ${dayAgo})
    RETURNING r.id`;
  return rows.length > 0;
}

export type CancelOutcome = { kind: "cancelled" } | { kind: "owner_only" } | { kind: "no_request" };

export async function cancelRequest(
  sql: Sql,
  input: { gymId: string; userId: string; actorUserId: string; now: Date },
): Promise<CancelOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const gyms = await tx<{ owner_user_id: string }[]>`SELECT owner_user_id FROM gyms WHERE id = ${input.gymId}`;
    if (gyms[0]?.owner_user_id !== input.actorUserId) return { kind: "owner_only" };
    await endStale(tx, input.gymId, input.userId, input.now);
    const ended = await tx<{ id: string }[]>`
      UPDATE gym_co_owner_requests SET state = 'cancelled', answered_at = ${input.now}
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId} AND state = 'pending'
      RETURNING id`;
    const request = ended[0];
    if (request === undefined) return { kind: "no_request" };
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.co_owner_request_cancelled",
      targetType: "gym_staff",
      targetId: input.userId,
      meta: { requestId: request.id },
    });
    return { kind: "cancelled" };
  });
}

/** The caller's own request waiting at this gym, asked by the gym's owner as it is now. */
export async function myRequest(
  sql: Sql,
  input: { gymId: string; userId: string; now: Date },
): Promise<{ id: string; ownerName: string; expiresAt: Date } | null> {
  const rows = await sql<{ id: string; owner_name: string; expires_at: Date }[]>`
    SELECT r.id, u.display_name AS owner_name, r.expires_at
    FROM gym_co_owner_requests r
    JOIN gyms g ON g.id = r.gym_id
    JOIN users u ON u.id = g.owner_user_id
    WHERE r.gym_id = ${input.gymId} AND r.user_id = ${input.userId}
      AND r.state = 'pending' AND r.expires_at > ${input.now}
      AND r.requested_by = g.owner_user_id
      AND EXISTS (SELECT 1 FROM gym_staff s
                  WHERE s.gym_id = r.gym_id AND s.user_id = r.user_id AND s.created_at = r.staff_since AND s.role <> 'owner')`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, ownerName: row.owner_name, expiresAt: row.expires_at };
}

export type AnswerOutcome = { kind: "accepted" } | { kind: "declined" } | { kind: "not_found" } | { kind: "request_gone" };

/** Accept or Decline, by the person asked and nobody else: the request is found only with
 *  the caller's own id in the WHERE. Accepting asks again, under the lock, everything that
 *  made the request fair: it waits, its time has not run out, the person who asked is
 *  still the gym's owner, and the person asked is still on its staff and not an owner. */
export async function answerRequest(
  sql: Sql,
  input: { gymId: string; requestId: string; userId: string; accept: boolean; ownerPrivileges: readonly string[]; now: Date },
): Promise<AnswerOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const rows = await tx<{ state: string; expires_at: Date; requested_by: string | null; owner_user_id: string }[]>`
      SELECT r.state, r.expires_at, r.requested_by, g.owner_user_id
      FROM gym_co_owner_requests r JOIN gyms g ON g.id = r.gym_id
      WHERE r.id = ${input.requestId} AND r.gym_id = ${input.gymId} AND r.user_id = ${input.userId}`;
    const request = rows[0];
    if (request === undefined) return { kind: "not_found" };
    if (request.state === "accepted" && input.accept) {
      const still = await tx`SELECT 1 FROM gym_staff WHERE gym_id = ${input.gymId} AND user_id = ${input.userId} AND role = 'owner'`;
      return still.length > 0 ? { kind: "accepted" } : { kind: "request_gone" };
    }
    if (request.state !== "pending") return { kind: "request_gone" };
    if (request.expires_at.getTime() <= input.now.getTime()) {
      await endStale(tx, input.gymId, input.userId, input.now);
      return { kind: "request_gone" };
    }

    if (!input.accept) {
      await tx`UPDATE gym_co_owner_requests SET state = 'declined', answered_at = ${input.now} WHERE id = ${input.requestId}`;
      await insertAudit(tx, {
        actorUserId: input.userId,
        gymId: input.gymId,
        action: "org.co_owner_request_declined",
        targetType: "gym_staff",
        targetId: input.userId,
        meta: { requestId: input.requestId },
      });
      return { kind: "declined" };
    }

    // The same staff row they were asked on: one removed and made again is a new appointment.
    const staff = await tx<{ role: string }[]>`
      SELECT s.role FROM gym_staff s JOIN users u ON u.id = s.user_id
      WHERE s.gym_id = ${input.gymId} AND s.user_id = ${input.userId} AND u.status = 'active'
        AND s.created_at = (SELECT staff_since FROM gym_co_owner_requests WHERE id = ${input.requestId})
      FOR UPDATE OF s`;
    const row = staff[0];
    if (request.requested_by !== request.owner_user_id || row === undefined || row.role === "owner") {
      await tx`UPDATE gym_co_owner_requests SET state = 'cancelled', answered_at = ${input.now} WHERE id = ${input.requestId}`;
      return { kind: "request_gone" };
    }

    await tx`
      UPDATE gym_staff SET role = 'owner', role_name = NULL, privileges = ${[...input.ownerPrivileges]}
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;
    await tx`UPDATE gym_co_owner_requests SET state = 'accepted', answered_at = ${input.now} WHERE id = ${input.requestId}`;
    await insertAudit(tx, {
      actorUserId: input.userId,
      gymId: input.gymId,
      action: "org.co_owner_accepted",
      targetType: "gym_staff",
      targetId: input.userId,
      meta: { requestId: input.requestId, from: row.role, privileges: [...input.ownerPrivileges] },
    });
    return { kind: "accepted" };
  });
}

// ── The owner hands the gym to a co-owner (ROADMAP Stage 2 items 4b-ii and 4b-iii-a) ────────
//
// THE RULE THESE HOLD: the gym's owner changes only when its owner asked one of its
// co-owners, while they were a co-owner on that same staff row, and that co-owner themselves
// pressed Accept before the request ended. The old owner's staff row stays an owner's, so from
// then they are a co-owner.
//
// A gym paying through Paddle (4b-iii-a) moves only once Paddle has saved the new owner's card
// on its plan, through the card window Accept opened for them; the plan's payer then moves to
// them. The old owner is never left paying for a gym they no longer own.

// A WAITING REQUEST, in every reader below: pending, in date, sent by the gym's owner as it
// is now, to somebody still a co-owner on the staff row they were asked on.

/** What the gym's plan means for a hand-over. `paddle`: its new owner adds their card first.
 *  The others stop it for now: a plan paid through Razorpay (4b-iii-b), money owed (a plan
 *  past due, or one whose grace ended and may still be collected), or a plan set to end. */
export type HandOverPlan =
  | { kind: "none" }
  | { kind: "paddle"; subscriptionRef: string }
  | { kind: "paid_plan" }
  | { kind: "plan_overdue" }
  | { kind: "plan_ending" };

async function planForHandOver(tx: Sql | TransactionSql, gymId: string): Promise<HandOverPlan> {
  const rows = await tx<{ provider: string; status: string; provider_ref: string | null; cancel_at_period_end: boolean; cancel_reason: string | null }[]>`
    SELECT provider, status, provider_ref, cancel_at_period_end, cancel_reason FROM subscriptions
    WHERE owner_type = 'gym' AND owner_id = ${gymId} AND provider NOT IN ('none','pilot')
      AND (status IN ('trialing','active','past_due') OR (status = 'expired' AND cancel_reason = ${GRACE_EXPIRED}))
    ORDER BY created_at DESC`;
  if (rows.length === 0) return { kind: "none" };
  if (rows.some((r) => r.provider !== "paddle")) return { kind: "paid_plan" };
  if (rows.some((r) => r.status === "past_due" || r.status === "expired")) return { kind: "plan_overdue" };
  const live = rows[0];
  // One plan a gym; two at once is never handed over on a guess.
  if (rows.length !== 1 || live === undefined || live.provider_ref === null) return { kind: "paid_plan" };
  if (live.cancel_at_period_end) return { kind: "plan_ending" };
  return { kind: "paddle", subscriptionRef: live.provider_ref };
}

/** For the Staff tab: what the gym's plan means for a hand-over. */
export async function gymHandOverPlan(sql: Sql, gymId: string): Promise<HandOverPlan> {
  return await planForHandOver(sql, gymId);
}

/** The request waiting at this gym, if any: who was asked, when it ends, and whether they
 *  pressed Accept and Paddle's card window is open for them. */
export async function waitingOwnerRequest(sql: Sql, gymId: string, now: Date): Promise<{ userId: string; expiresAt: Date; addingCard: boolean } | null> {
  const rows = await sql<{ user_id: string; expires_at: Date; adding_card: boolean }[]>`
    SELECT r.user_id, r.expires_at, (r.card_txn_ref IS NOT NULL AND r.card_closed_at IS NULL) AS adding_card
    FROM gym_owner_requests r JOIN gyms g ON g.id = r.gym_id
    WHERE r.gym_id = ${gymId} AND r.state = 'pending'
      -- Past its date with its card window still open: waiting until the worker shuts the window.
      AND (r.expires_at > ${now} OR (r.card_txn_ref IS NOT NULL AND r.card_closed_at IS NULL))
      AND r.requested_by = g.owner_user_id
      AND EXISTS (SELECT 1 FROM gym_staff s
                  WHERE s.gym_id = r.gym_id AND s.user_id = r.user_id AND s.created_at = r.staff_since
                    AND s.role = 'owner' AND s.user_id <> g.owner_user_id)`;
  const row = rows[0];
  return row === undefined ? null : { userId: row.user_id, expiresAt: row.expires_at, addingCard: row.adding_card };
}

/** A card window still open for this person at this gym: while it is, the owner cannot change
 *  or remove them (the doors refuse), and only Cancel request ends it. */
export async function cardWindowOpenFor(tx: Sql | TransactionSql, gymId: string, userId: string): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM gym_owner_requests
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND state = 'pending'
      AND card_txn_ref IS NOT NULL AND card_closed_at IS NULL`;
  return rows.length > 0;
}

/** The plan's payer is changing at Paddle: a card window open for the person asked, or a
 *  hand-over whose payer has not moved yet. Paddle's own page waits until it is done. */
export async function payerChanging(sql: Sql | TransactionSql, gymId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM gym_owner_requests
    WHERE gym_id = ${gymId} AND card_txn_ref IS NOT NULL
      AND ((state = 'pending' AND card_closed_at IS NULL) OR (state = 'accepted' AND payer_moved_at IS NULL))`;
  return rows.length > 0;
}

/** The gym's request that no longer counts is closed, so a new one can be sent. One whose card
 *  window is still open is left for the worker, which points the window back first. */
async function endStaleOwnerRequest(tx: TransactionSql, gymId: string, now: Date): Promise<void> {
  await tx`
    UPDATE gym_owner_requests r
    SET state = CASE WHEN r.expires_at <= ${now} THEN 'expired' ELSE 'cancelled' END,
        answered_at = LEAST(r.expires_at, ${now})
    FROM gyms g
    WHERE g.id = r.gym_id AND r.gym_id = ${gymId} AND r.state = 'pending'
      AND (r.card_txn_ref IS NULL OR r.card_closed_at IS NOT NULL)
      AND (r.expires_at <= ${now}
           OR r.requested_by IS DISTINCT FROM g.owner_user_id
           OR NOT EXISTS (SELECT 1 FROM gym_staff s
                          WHERE s.gym_id = r.gym_id AND s.user_id = r.user_id AND s.created_at = r.staff_since
                            AND s.role = 'owner' AND s.user_id <> g.owner_user_id))`;
}

export type SendOwnerOutcome =
  | { kind: "sent"; requestId: string; expiresAt: Date; email: string | null; gymName: string; gymSlug: string; ownerName: string }
  | { kind: "owner_only" }
  | { kind: "not_staff" }
  | { kind: "not_co_owner" }
  | { kind: "paid_plan" }
  | { kind: "plan_overdue" }
  | { kind: "plan_ending" }
  /** The last hand-over's payer is still moving at Paddle (or a card window is open). */
  | { kind: "payer_moving" }
  | { kind: "already_requested" };

export async function sendOwnerRequest(
  sql: Sql,
  input: { gymId: string; userId: string; actorUserId: string; now: Date; days: number },
): Promise<SendOwnerOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const gyms = await tx<{ owner_user_id: string; name: string; slug: string; owner_name: string }[]>`
      SELECT g.owner_user_id, g.name, g.slug, u.display_name AS owner_name
      FROM gyms g JOIN users u ON u.id = g.owner_user_id
      WHERE g.id = ${input.gymId}`;
    const gym = gyms[0];
    if (gym === undefined || gym.owner_user_id !== input.actorUserId) return { kind: "owner_only" };

    const staff = await tx<{ role: string; email: string | null }[]>`
      SELECT s.role, u.email FROM gym_staff s JOIN users u ON u.id = s.user_id
      WHERE s.gym_id = ${input.gymId} AND s.user_id = ${input.userId} AND u.status = 'active'`;
    const target = staff[0];
    if (target === undefined) return { kind: "not_staff" };
    if (target.role !== "owner" || input.userId === gym.owner_user_id) return { kind: "not_co_owner" };
    const plan = await planForHandOver(tx, input.gymId);
    if (plan.kind !== "none" && plan.kind !== "paddle") return { kind: plan.kind };
    // A second hand-over waits until the last one's payer has moved: its retry would otherwise
    // move the payer back to the person in the middle.
    if (await payerChanging(tx, input.gymId)) return { kind: "payer_moving" };

    await endStaleOwnerRequest(tx, input.gymId, input.now);
    const waiting = await tx`SELECT 1 FROM gym_owner_requests WHERE gym_id = ${input.gymId} AND state = 'pending'`;
    if (waiting.length > 0) return { kind: "already_requested" };

    const expiresAt = new Date(input.now.getTime() + input.days * DAY_MS);
    const made = await tx<{ id: string }[]>`
      INSERT INTO gym_owner_requests (gym_id, user_id, requested_by, staff_since, created_at, expires_at)
      VALUES (${input.gymId}, ${input.userId}, ${input.actorUserId},
              (SELECT created_at FROM gym_staff WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}),
              ${input.now}, ${expiresAt})
      RETURNING id`;
    const requestId = made[0]?.id;
    if (requestId === undefined) throw new Error("the owner request was not written");
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.owner_requested",
      targetType: "gym_staff",
      targetId: input.userId,
      meta: { requestId },
    });
    return { kind: "sent", requestId, expiresAt, email: target.email, gymName: gym.name, gymSlug: gym.slug, ownerName: gym.owner_name };
  });
}

/** Claim this request's email: false when the same person was emailed by one of this gym's
 *  owner requests in the last day, so Send and Cancel pressed over and over send one email. */
export async function claimOwnerEmail(sql: Sql, input: { gymId: string; userId: string; requestId: string; now: Date }): Promise<boolean> {
  const dayAgo = new Date(input.now.getTime() - DAY_MS);
  const rows = await sql`
    UPDATE gym_owner_requests r SET emailed_at = ${input.now}
    WHERE r.id = ${input.requestId} AND r.gym_id = ${input.gymId}
      AND NOT EXISTS (SELECT 1 FROM gym_owner_requests o
                      WHERE o.gym_id = r.gym_id AND o.user_id = ${input.userId} AND o.emailed_at > ${dayAgo})
    RETURNING r.id`;
  return rows.length > 0;
}

/** The card window of a request, as stored. */
export interface CardWindowRow {
  requestId: string;
  gymId: string;
  userId: string;
  state: string;
  subscriptionRef: string;
  txnRef: string;
  customerRef: string;
  addressRef: string;
  openedAt: Date;
  closedAt: Date | null;
  payerMovedAt: Date | null;
}

type RawCardWindow = {
  id: string;
  gym_id: string;
  user_id: string;
  state: string;
  card_subscription_ref: string | null;
  card_txn_ref: string | null;
  card_customer_ref: string | null;
  card_address_ref: string | null;
  card_opened_at: Date | null;
  card_closed_at: Date | null;
  payer_moved_at: Date | null;
};

function toCardWindow(r: RawCardWindow): CardWindowRow | null {
  if (r.card_subscription_ref === null || r.card_txn_ref === null || r.card_customer_ref === null || r.card_address_ref === null || r.card_opened_at === null) {
    return null;
  }
  return {
    requestId: r.id,
    gymId: r.gym_id,
    userId: r.user_id,
    state: r.state,
    subscriptionRef: r.card_subscription_ref,
    txnRef: r.card_txn_ref,
    customerRef: r.card_customer_ref,
    addressRef: r.card_address_ref,
    openedAt: r.card_opened_at,
    closedAt: r.card_closed_at,
    payerMovedAt: r.payer_moved_at,
  };
}


/** The owner's waiting request to this person with its card window still open, if any. */
export async function openCardWindowTo(sql: Sql, gymId: string, userId: string): Promise<CardWindowRow | null> {
  const rows = await sql<RawCardWindow[]>`
    SELECT id, gym_id, user_id, state, card_subscription_ref, card_txn_ref, card_customer_ref, card_address_ref, card_opened_at, card_closed_at, payer_moved_at FROM gym_owner_requests
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND state = 'pending'
      AND card_txn_ref IS NOT NULL AND card_closed_at IS NULL`;
  const row = rows[0];
  return row === undefined ? null : toCardWindow(row);
}

/** One request's card window, read by the person it was sent to and nobody else. */
export async function cardWindowOf(sql: Sql, input: { gymId: string; requestId: string; userId: string }): Promise<CardWindowRow | null> {
  const rows = await sql<RawCardWindow[]>`
    SELECT id, gym_id, user_id, state, card_subscription_ref, card_txn_ref, card_customer_ref, card_address_ref, card_opened_at, card_closed_at, payer_moved_at FROM gym_owner_requests
    WHERE id = ${input.requestId} AND gym_id = ${input.gymId} AND user_id = ${input.userId}`;
  const row = rows[0];
  return row === undefined ? null : toCardWindow(row);
}

/** The card windows the worker still has something to do with, oldest first: open ones (to
 *  finish, or to point back once their request has ended), and payers still to move. */
export async function cardWork(sql: Sql, limit: number): Promise<CardWindowRow[]> {
  const rows = await sql<RawCardWindow[]>`
    SELECT id, gym_id, user_id, state, card_subscription_ref, card_txn_ref, card_customer_ref, card_address_ref, card_opened_at, card_closed_at, payer_moved_at FROM gym_owner_requests
    WHERE card_txn_ref IS NOT NULL AND (card_closed_at IS NULL OR (state = 'accepted' AND payer_moved_at IS NULL))
    -- In no fixed order: a row Paddle keeps refusing never holds the others back.
    ORDER BY random()
    LIMIT ${limit}`;
  return rows.flatMap((r) => {
    const row = toCardWindow(r);
    return row === null ? [] : [row];
  });
}

export async function cancelOwnerRequest(
  sql: Sql,
  input: { gymId: string; userId: string; actorUserId: string; now: Date; cardOpenedAt: Date | null },
): Promise<CancelOutcome | { kind: "card_reopened" }> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    if ((await gymOwnerId(tx, input.gymId)) !== input.actorUserId) return { kind: "owner_only" };
    await endStaleOwnerRequest(tx, input.gymId, input.now);
    // A card window is cancelled only as it stood when it was pointed back: Accept pressed again
    // meanwhile opened it once more, and it is pointed back again first.
    const open = await tx<{ card_opened_at: Date | null }[]>`
      SELECT card_opened_at FROM gym_owner_requests
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId} AND state = 'pending'
        AND card_txn_ref IS NOT NULL AND card_closed_at IS NULL`;
    const window = open[0];
    if (window !== undefined && window.card_opened_at?.getTime() !== input.cardOpenedAt?.getTime()) return { kind: "card_reopened" };
    const ended = await tx<{ id: string }[]>`
      UPDATE gym_owner_requests
      SET state = 'cancelled', answered_at = ${input.now},
          card_closed_at = CASE WHEN card_txn_ref IS NULL THEN NULL ELSE ${input.now}::timestamptz END
      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId} AND state = 'pending'
      RETURNING id`;
    const request = ended[0];
    if (request === undefined) return { kind: "no_request" };
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.owner_request_cancelled",
      targetType: "gym_staff",
      targetId: input.userId,
      meta: { requestId: request.id },
    });
    return { kind: "cancelled" };
  });
}

/** The caller's own request to be this gym's owner, waiting. */
export async function myOwnerRequest(
  sql: Sql,
  input: { gymId: string; userId: string; now: Date },
): Promise<{ id: string; ownerName: string; expiresAt: Date } | null> {
  const rows = await sql<{ id: string; owner_name: string; expires_at: Date }[]>`
    SELECT r.id, u.display_name AS owner_name, r.expires_at
    FROM gym_owner_requests r
    JOIN gyms g ON g.id = r.gym_id
    JOIN users u ON u.id = g.owner_user_id
    WHERE r.gym_id = ${input.gymId} AND r.user_id = ${input.userId}
      AND r.state = 'pending' AND r.expires_at > ${input.now}
      AND r.requested_by = g.owner_user_id
      AND EXISTS (SELECT 1 FROM gym_staff s
                  WHERE s.gym_id = r.gym_id AND s.user_id = r.user_id AND s.created_at = r.staff_since
                    AND s.role = 'owner' AND s.user_id <> g.owner_user_id)`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, ownerName: row.owner_name, expiresAt: row.expires_at };
}

export type AnswerOwnerOutcome =
  | Exclude<AnswerOutcome, { kind: "accepted" }>
  | { kind: "paid_plan" }
  | { kind: "plan_overdue" }
  | { kind: "plan_ending" }
  /** The gym pays through Paddle: nothing moved; their card window is opened next. `stored`:
   *  the Paddle customer and address an earlier Accept of this request already made. */
  | { kind: "card_needed"; subscriptionRef: string; email: string | null; country: string | null; stored: { customerRef: string; addressRef: string } | null }
  /** `closed`: the payment windows Accept closed that the payment company holds, to cancel there. */
  | { kind: "accepted"; closed: { provider: PayProvider; ref: string }[] };

/** The request as it stands, under the gym's lock, or null once it does not: still pending,
 *  sent by the gym's owner as it is now, to somebody still a co-owner on the staff row they
 *  were asked on, with a live account. Time is the caller's question. */
async function standingRequest(
  tx: TransactionSql,
  input: { gymId: string; requestId: string; userId: string },
): Promise<{ owner: string; expiresAt: Date; state: string } | null> {
  const rows = await tx<{ state: string; expires_at: Date; requested_by: string | null; owner_user_id: string }[]>`
    SELECT r.state, r.expires_at, r.requested_by, g.owner_user_id
    FROM gym_owner_requests r JOIN gyms g ON g.id = r.gym_id
    WHERE r.id = ${input.requestId} AND r.gym_id = ${input.gymId} AND r.user_id = ${input.userId}`;
  const request = rows[0];
  if (request === undefined || request.state !== "pending") return null;
  const staff = await tx<{ role: string }[]>`
    SELECT s.role FROM gym_staff s JOIN users u ON u.id = s.user_id
    WHERE s.gym_id = ${input.gymId} AND s.user_id = ${input.userId} AND u.status = 'active'
      AND s.created_at = (SELECT staff_since FROM gym_owner_requests WHERE id = ${input.requestId})
    FOR UPDATE OF s`;
  const row = staff[0];
  const owner = request.owner_user_id;
  if (request.requested_by !== owner || row === undefined || row.role !== "owner" || owner === input.userId) return null;
  return { owner, expiresAt: request.expires_at, state: request.state };
}

/** Accept or Decline, by the person asked and nobody else: the request is found only with
 *  the caller's own id in the WHERE. Accepting asks again, under the gym's lock, everything
 *  that made the request fair. A gym with no paid plan then moves at once; one paying through
 *  Paddle moves nothing here, and is answered `card_needed`. */
export async function answerOwnerRequest(
  sql: Sql,
  input: {
    gymId: string;
    requestId: string;
    userId: string;
    accept: boolean;
    ownerPrivileges: readonly string[];
    now: Date;
    /** Decline: the card window the service pointed back first, as it stood then. */
    cardOpenedAt?: Date | null;
  },
): Promise<AnswerOwnerOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const rows = await tx<{
      state: string;
      expires_at: Date;
      owner_user_id: string;
      card_customer_ref: string | null;
      card_address_ref: string | null;
      card_closed_at: Date | null;
    }[]>`
      SELECT r.state, r.expires_at, g.owner_user_id, r.card_customer_ref, r.card_address_ref, r.card_closed_at
      FROM gym_owner_requests r JOIN gyms g ON g.id = r.gym_id
      WHERE r.id = ${input.requestId} AND r.gym_id = ${input.gymId} AND r.user_id = ${input.userId}`;
    const request = rows[0];
    if (request === undefined) return { kind: "not_found" };
    if (request.state === "accepted" && input.accept) {
      return request.owner_user_id === input.userId ? { kind: "accepted", closed: [] } : { kind: "request_gone" };
    }
    if (request.state !== "pending") return { kind: "request_gone" };
    if (request.expires_at.getTime() <= input.now.getTime()) {
      await endStaleOwnerRequest(tx, input.gymId, input.now);
      return { kind: "request_gone" };
    }

    if (!input.accept) {
      // The service pointed an open card window back first; one opened again since is left
      // open for the worker, which points it back before anything else.
      await tx`
        UPDATE gym_owner_requests
        SET state = 'declined', answered_at = ${input.now},
            card_closed_at = CASE WHEN card_txn_ref IS NOT NULL AND card_closed_at IS NULL AND card_opened_at = ${input.cardOpenedAt ?? null}::timestamptz
                                  THEN ${input.now}::timestamptz ELSE card_closed_at END
        WHERE id = ${input.requestId}`;
      await insertAudit(tx, {
        actorUserId: input.userId,
        gymId: input.gymId,
        action: "org.owner_request_declined",
        targetType: "gym_staff",
        targetId: input.userId,
        meta: { requestId: input.requestId },
      });
      return { kind: "declined" };
    }

    const standing = await standingRequest(tx, input);
    if (standing === null) {
      await tx`
        UPDATE gym_owner_requests SET state = 'cancelled', answered_at = ${input.now}
        WHERE id = ${input.requestId} AND (card_txn_ref IS NULL OR card_closed_at IS NOT NULL)`;
      return { kind: "request_gone" };
    }
    const plan = await planForHandOver(tx, input.gymId);
    if (plan.kind === "paddle") {
      const people = await tx<{ email: string | null; country: string | null }[]>`
        SELECT u.email, g.country FROM users u, gyms g WHERE u.id = ${input.userId} AND g.id = ${input.gymId}`;
      const stored =
        request.card_customer_ref !== null && request.card_address_ref !== null
          ? { customerRef: request.card_customer_ref, addressRef: request.card_address_ref }
          : null;
      return { kind: "card_needed", subscriptionRef: plan.subscriptionRef, email: people[0]?.email ?? null, country: people[0]?.country ?? null, stored };
    }
    if (plan.kind !== "none") return { kind: plan.kind };

    const closed = await moveOwner(tx, { ...input, oldOwner: standing.owner, paid: null });
    return { kind: "accepted", closed };
  });
}

/** The hand-over itself, under the gym's lock with the request re-checked: moves the gym's
 *  owner by a statement that names the owner who asked, gives the new owner the owner's usual
 *  ticks, and closes what only the old owner's word opened: the co-owner requests and co-owner
 *  invitations still waiting, and any payment window still open. Answers those windows. */
async function moveOwner(
  tx: TransactionSql,
  input: { gymId: string; requestId: string; userId: string; ownerPrivileges: readonly string[]; now: Date; oldOwner: string; paid: { subscriptionRef: string } | null },
): Promise<{ provider: PayProvider; ref: string }[]> {
  const moved = await tx`
    UPDATE gyms SET owner_user_id = ${input.userId}
    WHERE id = ${input.gymId} AND owner_user_id = ${input.oldOwner}
    RETURNING id`;
  if (moved.length !== 1) throw new Error("the gym's owner changed under its lock");
  // A payment window still open is closed, as a newer press closes it (`beginCheckout`): paid
  // after this, it is set aside as a duplicate and refunded, never the gym's plan, so the old
  // owner never pays for the new owner's gym. Both checkout writers hold this same lock.
  const closed = await tx<{ id: string; provider: PayProvider; provider_ref: string | null }[]>`
    UPDATE billing_checkouts SET state = 'superseded', updated_at = now()
    WHERE gym_id = ${input.gymId} AND state IN ('creating','open')
    RETURNING id, provider, provider_ref`;
  await tx`
    UPDATE gym_staff SET privileges = ${[...input.ownerPrivileges]}
    WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;
  await tx`
    UPDATE gym_owner_requests
    SET state = 'accepted', answered_at = ${input.now},
        card_closed_at = CASE WHEN card_txn_ref IS NULL THEN NULL ELSE ${input.now}::timestamptz END
    WHERE id = ${input.requestId}`;
  await tx`
    UPDATE gym_co_owner_requests SET state = 'cancelled', answered_at = ${input.now}
    WHERE gym_id = ${input.gymId} AND state = 'pending'`;
  await tx`
    UPDATE gym_staff_invites SET state = 'cancelled', answered_at = ${input.now}, answered_by = ${input.userId}
    WHERE gym_id = ${input.gymId} AND role = 'owner' AND state IN ('pending','declined') AND cleared_at IS NULL`;
  await insertAudit(tx, {
    actorUserId: input.userId,
    gymId: input.gymId,
    action: "org.owner_handed_over",
    targetType: "gym",
    targetId: input.gymId,
    meta: {
      requestId: input.requestId,
      from: input.oldOwner,
      to: input.userId,
      closedCheckouts: closed.map((c) => c.id),
      ...(input.paid === null ? {} : { paidBy: "paddle", subscription: input.paid.subscriptionRef }),
    },
  });
  // A window still being made has no reference yet: the press making it cancels it itself
  // when it finds it closed (`markCheckoutOpen`).
  return closed.flatMap((c) => (c.provider_ref === null ? [] : [{ provider: c.provider, ref: c.provider_ref }]));
}

export type StoreCardOutcome = { kind: "stored"; replaced: string | null } | { kind: "request_gone" };

/** Keep the card window Accept opened, under the gym's lock with everything asked again: the
 *  request still waiting and in date, and the gym still on that same Paddle plan. `replaced`:
 *  an earlier window of this request Paddle no longer answers, to point back. */
export async function storeCardWindow(
  sql: Sql,
  input: { gymId: string; requestId: string; userId: string; subscriptionRef: string; txnRef: string; customerRef: string; addressRef: string; now: Date },
): Promise<StoreCardOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const standing = await standingRequest(tx, input);
    if (standing === null || standing.expiresAt.getTime() <= input.now.getTime()) return { kind: "request_gone" };
    const plan = await planForHandOver(tx, input.gymId);
    if (plan.kind !== "paddle" || plan.subscriptionRef !== input.subscriptionRef) return { kind: "request_gone" };
    const before = await tx<{ card_txn_ref: string | null; card_closed_at: Date | null }[]>`
      SELECT card_txn_ref, card_closed_at FROM gym_owner_requests WHERE id = ${input.requestId}`;
    const was = before[0];
    await tx`
      UPDATE gym_owner_requests
      SET card_subscription_ref = ${input.subscriptionRef}, card_txn_ref = ${input.txnRef},
          card_customer_ref = ${input.customerRef}, card_address_ref = ${input.addressRef},
          card_opened_at = ${input.now}, card_closed_at = NULL
      WHERE id = ${input.requestId}`;
    const replaced = was?.card_txn_ref !== null && was?.card_txn_ref !== undefined && was.card_txn_ref !== input.txnRef && was.card_closed_at === null ? was.card_txn_ref : null;
    return { kind: "stored", replaced };
  });
}

export type FinishCardOutcome =
  /** `closed`: the payment windows the hand-over closed, to cancel at their payment company. */
  | { kind: "accepted"; closed: { provider: PayProvider; ref: string }[] }
  /** Already the owner by this request: nothing to do. */
  | { kind: "already" }
  /** The card was saved, but the request no longer stands: nobody moved. */
  | { kind: "request_gone" };

/** The card window saved the new owner's card: the gym moves to them, under the gym's lock
 *  with the request asked again, and still on the plan the window was for. Its time is not
 *  asked: a window still open counts, and the worker points a window back before ending its
 *  request. */
export async function finishCardHandOver(
  sql: Sql,
  input: { gymId: string; requestId: string; userId: string; txnRef: string; ownerPrivileges: readonly string[]; now: Date },
): Promise<FinishCardOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const rows = await tx<{ state: string; card_txn_ref: string | null; card_subscription_ref: string | null; card_closed_at: Date | null; owner_user_id: string }[]>`
      SELECT r.state, r.card_txn_ref, r.card_subscription_ref, r.card_closed_at, g.owner_user_id
      FROM gym_owner_requests r JOIN gyms g ON g.id = r.gym_id
      WHERE r.id = ${input.requestId} AND r.gym_id = ${input.gymId} AND r.user_id = ${input.userId}`;
    const request = rows[0];
    if (request === undefined) return { kind: "request_gone" };
    if (request.state === "accepted") return request.owner_user_id === input.userId ? { kind: "already" } : { kind: "request_gone" };
    if (request.state !== "pending" || request.card_txn_ref !== input.txnRef || request.card_closed_at !== null || request.card_subscription_ref === null) {
      // Saved after its request ended: nothing more is done with this window.
      await tx`
        UPDATE gym_owner_requests SET card_closed_at = ${input.now}
        WHERE id = ${input.requestId} AND card_txn_ref = ${input.txnRef} AND card_closed_at IS NULL`;
      return { kind: "request_gone" };
    }
    const standing = await standingRequest(tx, input);
    // Paddle has saved their card on this subscription, so it now charges them: while the gym
    // still holds it in any state Paddle can charge (set to end since, past due, its grace
    // ended), the gym is theirs. Only a different plan, or the request no longer standing, stops it.
    const samePlan = await tx`
      SELECT 1 FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND provider = 'paddle' AND provider_ref = ${request.card_subscription_ref}
        AND (status IN ('trialing','active','past_due') OR (status = 'expired' AND cancel_reason = ${GRACE_EXPIRED}))`;
    if (standing === null || samePlan.length === 0) {
      await tx`
        UPDATE gym_owner_requests SET state = 'cancelled', answered_at = ${input.now}, card_closed_at = ${input.now}
        WHERE id = ${input.requestId}`;
      return { kind: "request_gone" };
    }
    const closed = await moveOwner(tx, { ...input, oldOwner: standing.owner, paid: { subscriptionRef: request.card_subscription_ref } });
    return { kind: "accepted", closed };
  });
}

/** A card window pointed back at the plan's own payer, or found saved: nothing left to do. A
 *  request that ended with it open ends now, as `endStaleOwnerRequest` would have ended it.
 *  Only as the window stood when it was pointed back (`openedAt`). */
export async function closeCardWindow(sql: Sql, input: { requestId: string; gymId: string; openedAt: Date; now: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const done = await tx`
      UPDATE gym_owner_requests SET card_closed_at = ${input.now}
      WHERE id = ${input.requestId} AND card_closed_at IS NULL AND card_opened_at = ${input.openedAt}
      RETURNING id`;
    if (done.length === 0) return false;
    await endStaleOwnerRequest(tx, input.gymId, input.now);
    return true;
  });
}

/** Whether this request, its window open, no longer stands: ended, out of date, or its
 *  people changed. The worker then points its window back. */
export async function cardRequestEnded(sql: Sql, input: { gymId: string; requestId: string; userId: string; now: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const standing = await standingRequest(tx, input);
    return standing === null || standing.expiresAt.getTime() <= input.now.getTime();
  });
}

/** Paddle's payer moved: the gym's plan row names the new owner's customer, which Paddle's own
 *  page then signs in as. Written here, not left to the next record from Paddle: the plan rule
 *  treats a change of payer alone as no change, and keeps the old one (found in the sandbox walk). */
/** Nothing left to move: the gym has another owner since, or Paddle no longer has the plan. */
export async function endPayerMove(sql: Sql, input: { requestId: string; now: Date }): Promise<void> {
  await sql`UPDATE gym_owner_requests SET payer_moved_at = ${input.now} WHERE id = ${input.requestId} AND payer_moved_at IS NULL`;
}

export async function markPayerMoved(sql: Sql, input: { requestId: string; gymId: string; subscriptionRef: string; customerRef: string; now: Date }): Promise<void> {
  await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    await tx`
      UPDATE subscriptions SET provider_customer_ref = ${input.customerRef}
      WHERE owner_type = 'gym' AND owner_id = ${input.gymId} AND provider = 'paddle' AND provider_ref = ${input.subscriptionRef}`;
    await tx`UPDATE gym_owner_requests SET payer_moved_at = ${input.now} WHERE id = ${input.requestId} AND payer_moved_at IS NULL`;
  });
}
