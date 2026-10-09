// ONLINE CLASSES: a time slot's and one class's online answer (spec Part 3 §13.3;
// ROADMAP 17g). Every statement carries `gym_id`; each write runs under the gym's lock,
// as every timetable write does. The link itself is never written to the audit log.
import type { Sql } from "postgres";
import { insertAudit, lockOrgRow } from "../repo.js";

export interface OnlineInput {
  gymId: string;
  online: boolean;
  /** Null: not online, or the link is added later. */
  onlineLink: string | null;
  actorUserId: string;
  now: Date;
}

export type SlotOnlineOutcome = { kind: "ok" } | { kind: "not_found" };

/** A time slot is online or not, with its link: the time slot, and each of its classes
 *  that has not ended, except one whose own was set on its own. */
export async function setSlotOnline(sql: Sql, input: OnlineInput & { scheduleId: string }): Promise<SlotOnlineOutcome> {
  const link = input.online ? input.onlineLink : null;
  return await sql.begin(async (tx): Promise<SlotOnlineOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [slot] = await tx<{ id: string; online: boolean; online_link: string | null }[]>`
      SELECT id, online, online_link FROM gym_class_schedules
      WHERE id = ${input.scheduleId} AND gym_id = ${input.gymId} AND ended_at IS NULL
      FOR UPDATE`;
    if (slot === undefined) return { kind: "not_found" };
    await tx`
      UPDATE gym_class_schedules SET online = ${input.online}, online_link = ${link}
      WHERE id = ${input.scheduleId} AND gym_id = ${input.gymId}`;
    const classes = await tx`
      UPDATE gym_class_sessions SET online = ${input.online}, online_link = ${link}
      WHERE gym_id = ${input.gymId} AND schedule_id = ${input.scheduleId} AND NOT online_alone
        AND starts_at + make_interval(mins => minutes) > ${input.now}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.class_schedule_online_changed",
      targetType: "gym_class_schedule",
      targetId: input.scheduleId,
      meta: {
        online: `${String(slot.online)} -> ${String(input.online)}`,
        link: `${slot.online_link === null ? "none" : "set"} -> ${link === null ? "none" : link === slot.online_link ? "same" : "set"}`,
        classes: String(classes.count),
      },
    });
    return { kind: "ok" };
  });
}

export type ClassOnlineOutcome = { kind: "ok"; localDate: string } | { kind: "not_found" } | { kind: "ended" } | { kind: "cancelled" };

/** One class is online or not, with its own link, until it ends. It is then marked as
 *  set on its own, so a change to its time slot's leaves it. */
export async function setClassOnline(sql: Sql, input: OnlineInput & { sessionId: string }): Promise<ClassOnlineOutcome> {
  const link = input.online ? input.onlineLink : null;
  return await sql.begin(async (tx): Promise<ClassOnlineOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [row] = await tx<{ local_date: string; status: string; ended: boolean; online: boolean; online_link: string | null }[]>`
      SELECT local_date::text AS local_date, status, online, online_link,
             starts_at + make_interval(mins => minutes) <= ${input.now} AS ended
      FROM gym_class_sessions
      WHERE id = ${input.sessionId} AND gym_id = ${input.gymId}
      FOR UPDATE`;
    if (row === undefined) return { kind: "not_found" };
    if (row.status === "cancelled") return { kind: "cancelled" };
    if (row.ended) return { kind: "ended" };
    await tx`
      UPDATE gym_class_sessions SET online = ${input.online}, online_link = ${link}, online_alone = true
      WHERE id = ${input.sessionId} AND gym_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.class_session_online_changed",
      targetType: "gym_class_session",
      targetId: input.sessionId,
      meta: {
        online: `${String(row.online)} -> ${String(input.online)}`,
        link: `${row.online_link === null ? "none" : "set"} -> ${link === null ? "none" : link === row.online_link ? "same" : "set"}`,
      },
    });
    return { kind: "ok", localDate: row.local_date };
  });
}
