// The "Start here" list (ROADMAP 23b): what a gym has set up, read from its own rows,
// and the one mark it stores. Every read and the write name the gym in the WHERE.
import type { Sql, TransactionSql } from "postgres";
import type { StartHereStep } from "@app/shared";

export interface StartHereRow {
  /** `gyms.activation` as stored; the service parses it. */
  activation: unknown;
  done: Record<StartHereStep, boolean>;
}

/** What this gym has set up today, or null when there is no such gym.
 *
 *  A step is done while the thing is there: a membership type that is archived, a person
 *  who is off the list, an invitation that was cancelled or has run out, a time slot that
 *  was cancelled and a device that was switched off or never opened its link do not count. */
export async function readStartHere(sql: Sql | TransactionSql, gymId: string, now: Date): Promise<StartHereRow | null> {
  const rows = await sql<
    {
      activation: unknown;
      memberships: boolean;
      members: boolean;
      staff: boolean;
      classes: boolean;
      hours: boolean;
      front_desk: boolean;
    }[]
  >`
    SELECT g.activation,
      EXISTS (
        SELECT 1 FROM gym_membership_types t
        WHERE t.gym_id = g.id AND t.archived_at IS NULL
      ) AS memberships,
      EXISTS (
        SELECT 1 FROM gym_member_list_entries e
        WHERE e.gym_id = g.id AND e.former_at IS NULL
      ) AS members,
      (
        EXISTS (
          SELECT 1 FROM gym_staff s
          JOIN users u ON u.id = s.user_id
          WHERE s.gym_id = g.id AND s.role <> 'owner' AND u.status = 'active'
        )
        OR EXISTS (
          SELECT 1 FROM gym_staff_invites i
          WHERE i.gym_id = g.id AND i.state = 'pending' AND i.cleared_at IS NULL AND i.expires_at > ${now}
        )
      ) AS staff,
      EXISTS (
        SELECT 1 FROM gym_class_schedules s
        JOIN gym_class_types t ON t.id = s.class_type_id AND t.gym_id = s.gym_id
        WHERE s.gym_id = g.id AND s.ended_at IS NULL AND t.archived_at IS NULL
      ) AS classes,
      g.hours_mode <> 'unset' AS hours,
      EXISTS (
        SELECT 1 FROM gym_checkin_devices d
        WHERE d.gym_id = g.id AND d.switched_off_at IS NULL AND d.key_hash IS NOT NULL
      ) AS front_desk
    FROM gyms g
    WHERE g.id = ${gymId}`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    activation: row.activation,
    done: {
      memberships: row.memberships,
      members: row.members,
      staff: row.staff,
      classes: row.classes,
      hours: row.hours,
      frontDesk: row.front_desk,
    },
  };
}

/** Keep the mark beside whatever else the column holds. */
export async function writeHidden(tx: TransactionSql, gymId: string, hidden: boolean): Promise<void> {
  await tx`
    UPDATE gyms
    SET activation = (CASE WHEN jsonb_typeof(activation) = 'object' THEN activation ELSE '{}'::jsonb END)
                     || ${tx.json({ startHereHidden: hidden })}::jsonb
    WHERE id = ${gymId}`;
}
