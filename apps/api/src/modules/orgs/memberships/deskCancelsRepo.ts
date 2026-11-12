// A MEMBERSHIP CANCELLED AT THE FRONT DESK TO END ON A LATER DAY (ROADMAP 18l-ii-b; spec Part 3 §14.8, "Cancelling"): the
// row Undo cancellation reads. Written in the cancel's own transaction by the desk's step (`moveHeldIn`); every read names
// the gym in its WHERE.
import type { Sql, TransactionSql } from "postgres";
import { KEEP_WHENS, type KeepWhen } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface DeskCancelRow {
  id: string;
  heldMembershipId: string;
  /** Every way staff cancelled it, in the order they did. */
  ways: KeepWhen[];
  /** The soonest last day it was given; null where it was frozen then. */
  endsOn: string | null;
  cancelledOn: string;
  ended: { classes: number; sessions: number };
  undone: { on: string; userId: string | null } | null;
}

interface Raw {
  id: string;
  held_membership_id: string;
  ways: string[];
  ends_on: string | null;
  cancelled_on: string;
  ended_classes: number;
  ended_sessions: number;
  undone_on: string | null;
  undone_by_user_id: string | null;
}

const isWay = (w: string): w is KeepWhen => (KEEP_WHENS as readonly string[]).includes(w);

// Text under a CHECK: read back as the ways this build knows, or refused.
const shape = (r: Raw): DeskCancelRow => ({
  id: r.id,
  heldMembershipId: r.held_membership_id,
  ways: r.ways.map((w) => {
    if (!isWay(w)) throw new Error(`gym_desk_cancels holds an unknown way: ${w}`);
    return w;
  }),
  endsOn: r.ends_on,
  cancelledOn: r.cancelled_on,
  ended: { classes: r.ended_classes, sessions: r.ended_sessions },
  undone: r.undone_on === null ? null : { on: r.undone_on, userId: r.undone_by_user_id },
});

const COLUMNS = (sql: SqlOrTx) => sql`
  id, held_membership_id, ways, ends_on::text AS ends_on, cancelled_on::text AS cancelled_on, ended_classes, ended_sessions,
  undone_on::text AS undone_on, undone_by_user_id`;

/** A cancel staff made, written in its own transaction. One already open on the membership (staff ended it sooner after
 *  giving notice, or left early after ending it with the minimum term) takes the new way too, the sooner last day and the
 *  bookings it ended, so one undo puts back all of it. */
export async function recordDeskCancel(
  tx: TransactionSql,
  c: { gymId: string; membershipId: string; userId: string; when: KeepWhen; endsOn: string | null; today: string; ended: { classes: number; sessions: number }; now: Date },
): Promise<void> {
  await tx`
    INSERT INTO gym_desk_cancels AS d (gym_id, held_membership_id, user_id, ways, ends_on, cancelled_on, ended_classes, ended_sessions, created_at, updated_at)
    VALUES (${c.gymId}, ${c.membershipId}, ${c.userId}, ${[c.when]}::text[], ${c.endsOn}::date, ${c.today}::date, ${c.ended.classes}, ${c.ended.sessions}, ${c.now}, ${c.now})
    ON CONFLICT (gym_id, held_membership_id) WHERE undone_at IS NULL DO UPDATE
    SET ways = CASE WHEN EXCLUDED.ways[1] = ANY(d.ways) THEN d.ways ELSE d.ways || EXCLUDED.ways END,
        ends_on = LEAST(d.ends_on, EXCLUDED.ends_on),
        ended_classes = d.ended_classes + EXCLUDED.ended_classes,
        ended_sessions = d.ended_sessions + EXCLUDED.ended_sessions,
        user_id = EXCLUDED.user_id,
        updated_at = EXCLUDED.updated_at`;
}

/** These memberships' open desk cancels, by membership: one at most each. */
export async function openDeskCancelsOf(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Map<string, DeskCancelRow>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await sql<Raw[]>`
    SELECT ${COLUMNS(sql)} FROM gym_desk_cancels
    WHERE gym_id = ${gymId} AND held_membership_id = ANY(${[...membershipIds]}::uuid[]) AND undone_at IS NULL`;
  return new Map(rows.map((r) => [r.held_membership_id, shape(r)]));
}

/** The cancel this Undo press already undid, if it undid one. */
export async function deskCancelOfUndoRequest(sql: SqlOrTx, gymId: string, requestKey: string): Promise<DeskCancelRow | null> {
  const [row] = await sql<Raw[]>`SELECT ${COLUMNS(sql)} FROM gym_desk_cancels WHERE gym_id = ${gymId} AND undo_request_key = ${requestKey}`;
  return row === undefined ? null : shape(row);
}

/** UNDONE, in the undo's own transaction: by whom, the gym's day and the press. False where it was undone already. */
export async function markUndone(tx: TransactionSql, u: { gymId: string; id: string; userId: string; requestKey: string; today: string; now: Date }): Promise<boolean> {
  const rows = await tx`
    UPDATE gym_desk_cancels
    SET undone_at = ${u.now}, undone_on = ${u.today}::date, undone_by_user_id = ${u.userId}, undo_request_key = ${u.requestKey}, updated_at = ${u.now}
    WHERE gym_id = ${u.gymId} AND id = ${u.id} AND undone_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}
