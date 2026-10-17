// Co-owners (ROADMAP Stage 2 item 4b-i): the gym's owner asks one of its staff to be a
// co-owner, and the person asked accepts or declines. Every write takes the gym's row lock
// first, as every change to who runs a gym does (`addStaff`, `removeStaff`, `claimSeat`),
// so a request, its answer and a change to the person's staff row happen one at a time.
//
// THE RULE THIS FILE HOLDS: nobody becomes an owner unless the gym's own owner asked them,
// while they were on its staff, and they themselves pressed Accept before the request ended.
import type { Sql, TransactionSql } from "postgres";
import type { PayProvider } from "../../billing/repo.js";
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

// ── The owner hands the gym to a co-owner (ROADMAP Stage 2 item 4b-ii) ────────────────────
//
// THE RULE THESE HOLD: the gym's owner changes only when its owner asked one of its
// co-owners, while they were a co-owner on that same staff row and the gym was on no paid
// plan, and that co-owner themselves pressed Accept before the request ended. The old owner's
// staff row stays an owner's, so from then they are a co-owner.

// A WAITING REQUEST, in every reader below: pending, in date, sent by the gym's owner as it
// is now, to somebody still a co-owner on the staff row they were asked on.

/** The gym is on a plan somebody pays for at Paddle or Razorpay, live or still being paid. */
async function onPaidPlan(tx: Sql | TransactionSql, gymId: string): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM subscriptions
    WHERE owner_type = 'gym' AND owner_id = ${gymId}
      AND provider NOT IN ('none','pilot') AND status IN ('trialing','active','past_due')
    LIMIT 1`;
  return rows.length > 0;
}

/** For the Staff tab: whether the gym is on a paid plan. */
export async function gymOnPaidPlan(sql: Sql, gymId: string): Promise<boolean> {
  return await onPaidPlan(sql, gymId);
}

/** The request waiting at this gym, if any: who was asked, and when it ends. */
export async function waitingOwnerRequest(sql: Sql, gymId: string, now: Date): Promise<{ userId: string; expiresAt: Date } | null> {
  const rows = await sql<{ user_id: string; expires_at: Date }[]>`
    SELECT r.user_id, r.expires_at FROM gym_owner_requests r JOIN gyms g ON g.id = r.gym_id
    WHERE r.gym_id = ${gymId} AND r.state = 'pending' AND r.expires_at > ${now}
      AND r.requested_by = g.owner_user_id
      AND EXISTS (SELECT 1 FROM gym_staff s
                  WHERE s.gym_id = r.gym_id AND s.user_id = r.user_id AND s.created_at = r.staff_since
                    AND s.role = 'owner' AND s.user_id <> g.owner_user_id)`;
  const row = rows[0];
  return row === undefined ? null : { userId: row.user_id, expiresAt: row.expires_at };
}

/** The gym's request that no longer counts is closed, so a new one can be sent. */
async function endStaleOwnerRequest(tx: TransactionSql, gymId: string, now: Date): Promise<void> {
  await tx`
    UPDATE gym_owner_requests r
    SET state = CASE WHEN r.expires_at <= ${now} THEN 'expired' ELSE 'cancelled' END,
        answered_at = LEAST(r.expires_at, ${now})
    FROM gyms g
    WHERE g.id = r.gym_id AND r.gym_id = ${gymId} AND r.state = 'pending'
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
    if (await onPaidPlan(tx, input.gymId)) return { kind: "paid_plan" };

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

export async function cancelOwnerRequest(
  sql: Sql,
  input: { gymId: string; userId: string; actorUserId: string; now: Date },
): Promise<CancelOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    if ((await gymOwnerId(tx, input.gymId)) !== input.actorUserId) return { kind: "owner_only" };
    await endStaleOwnerRequest(tx, input.gymId, input.now);
    const ended = await tx<{ id: string }[]>`
      UPDATE gym_owner_requests SET state = 'cancelled', answered_at = ${input.now}
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
  /** `closed`: the payment windows Accept closed that the payment company holds, to cancel there. */
  | { kind: "accepted"; closed: { provider: PayProvider; ref: string }[] };

/** Accept or Decline, by the person asked and nobody else: the request is found only with
 *  the caller's own id in the WHERE. Accepting asks again, under the gym's lock, everything
 *  that made the request fair, then moves the gym's owner by a statement that names the owner
 *  who asked, gives the new owner the owner's usual ticks, and closes what only the old
 *  owner's word opened: the co-owner requests and co-owner invitations still waiting. */
export async function answerOwnerRequest(
  sql: Sql,
  input: { gymId: string; requestId: string; userId: string; accept: boolean; ownerPrivileges: readonly string[]; now: Date },
): Promise<AnswerOwnerOutcome> {
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, input.gymId);
    const rows = await tx<{ state: string; expires_at: Date; requested_by: string | null; owner_user_id: string }[]>`
      SELECT r.state, r.expires_at, r.requested_by, g.owner_user_id
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
      await tx`UPDATE gym_owner_requests SET state = 'declined', answered_at = ${input.now} WHERE id = ${input.requestId}`;
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

    // Still a co-owner on the same staff row they were asked on, with a live account.
    const staff = await tx<{ role: string }[]>`
      SELECT s.role FROM gym_staff s JOIN users u ON u.id = s.user_id
      WHERE s.gym_id = ${input.gymId} AND s.user_id = ${input.userId} AND u.status = 'active'
        AND s.created_at = (SELECT staff_since FROM gym_owner_requests WHERE id = ${input.requestId})
      FOR UPDATE OF s`;
    const row = staff[0];
    const oldOwner = request.owner_user_id;
    if (request.requested_by !== oldOwner || row === undefined || row.role !== "owner" || oldOwner === input.userId) {
      await tx`UPDATE gym_owner_requests SET state = 'cancelled', answered_at = ${input.now} WHERE id = ${input.requestId}`;
      return { kind: "request_gone" };
    }
    if (await onPaidPlan(tx, input.gymId)) {
      await tx`UPDATE gym_owner_requests SET state = 'cancelled', answered_at = ${input.now} WHERE id = ${input.requestId}`;
      return { kind: "paid_plan" };
    }

    const moved = await tx`
      UPDATE gyms SET owner_user_id = ${input.userId}
      WHERE id = ${input.gymId} AND owner_user_id = ${oldOwner}
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
    await tx`UPDATE gym_owner_requests SET state = 'accepted', answered_at = ${input.now} WHERE id = ${input.requestId}`;
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
      meta: { requestId: input.requestId, from: oldOwner, to: input.userId, closedCheckouts: closed.map((c) => c.id) },
    });
    // A window still being made has no reference yet: the press making it cancels it itself
    // when it finds it closed (`markCheckoutOpen`).
    return { kind: "accepted", closed: closed.flatMap((c) => (c.provider_ref === null ? [] : [{ provider: c.provider, ref: c.provider_ref }])) };
  });
}
