// Staff invitations' rows (Part 3 §10.3; ROADMAP 4a-i). Every query names the gym, or
// the caller's own proved address for the invited person's side.
import type { Sql, TransactionSql } from "postgres";
import { staffInviteEmailReasonSchema, type StaffInvite, type StaffInviteEmailReason } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

/** The most invitations the owner's list shows. */
export const STAFF_INVITES_LISTED = 100;

export type StaffInviteState = "pending" | "accepted" | "declined" | "cancelled";
export type InviteRole = "manager" | "trainer";

export interface StaffInviteRow {
  id: string;
  gymId: string;
  email: string;
  role: InviteRole;
  privileges: string[];
  roleName: string | null;
  createdAt: Date;
  expiresAt: Date;
  state: StaffInviteState;
}

interface RawInvite {
  id: string;
  gym_id: string;
  email: string;
  role: string;
  privileges: string[];
  role_name: string | null;
  created_at: Date;
  expires_at: Date;
  state: string;
}

const toRole = (role: string, id: string): InviteRole => {
  if (role === "manager" || role === "trainer") return role;
  throw new Error(`staff invitation ${id} holds a role that no longer parses`);
};

const toState = (state: string, id: string): StaffInviteState => {
  if (state === "pending" || state === "accepted" || state === "declined" || state === "cancelled") return state;
  throw new Error(`staff invitation ${id} holds a state that no longer parses`);
};

const toInvite = (row: RawInvite): StaffInviteRow => ({
  id: row.id,
  gymId: row.gym_id,
  email: row.email,
  role: toRole(row.role, row.id),
  privileges: row.privileges,
  roleName: row.role_name,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  state: toState(row.state, row.id),
});

/** The open invitation to this address at this gym (pending or declined, not cleared),
 *  locked; ended or not. At most one, by the open unique index. */
export async function lockOpenInviteFor(tx: TransactionSql, gymId: string, email: string): Promise<StaffInviteRow | null> {
  const rows = await tx<RawInvite[]>`
    SELECT id, gym_id, email::text AS email, role, privileges, role_name, created_at, expires_at, state
    FROM gym_staff_invites
    WHERE gym_id = ${gymId} AND email = ${email}
      AND state IN ('pending','declined') AND cleared_at IS NULL
    FOR UPDATE`;
  const row = rows[0];
  return row === undefined ? null : toInvite(row);
}

/** Take an ended or declined invitation off the owner's list. */
export async function clearInvite(tx: TransactionSql, gymId: string, inviteId: string, at: Date): Promise<void> {
  await tx`
    UPDATE gym_staff_invites SET cleared_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${inviteId} AND state IN ('pending','declined') AND cleared_at IS NULL`;
}

/** Whether this address is the account of somebody who already runs this gym: the
 *  owner, or staff the console lets in (`getStaffAuthority`'s rule). Only this gym's
 *  staff are looked at, so it says nothing about whether the address has an account. */
export async function staffNameAt(tx: SqlOrTx, gymId: string, email: string): Promise<{ displayName: string; role: string } | null> {
  const rows = await tx<{ display_name: string; role: string }[]>`
    SELECT u.display_name, s.role
    FROM gym_staff s
    JOIN users u ON u.id = s.user_id
    JOIN gyms g ON g.id = s.gym_id
    WHERE s.gym_id = ${gymId}
      AND u.email = ${email}
      AND u.status = 'active'
      AND (
        g.owner_user_id = s.user_id
        OR EXISTS (
          SELECT 1 FROM gym_members m
          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at IS NULL
        )
        OR NOT EXISTS (
          SELECT 1 FROM gym_members m
          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at >= s.created_at
        )
      )
    LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : { displayName: row.display_name, role: row.role };
}

/** Counts that decide whether the gym may invite now. */
export async function inviteCounts(
  tx: SqlOrTx,
  input: { gymId: string; email: string; now: Date; dayAgo: Date; weekAgo: Date },
): Promise<{ waiting: number; sentToday: number; sentToAddress: number }> {
  const rows = await tx<{ waiting: number; sent_today: number; sent_to_address: number }[]>`
    SELECT
      (SELECT count(*)::int FROM gym_staff_invites
        WHERE gym_id = ${input.gymId} AND state = 'pending' AND cleared_at IS NULL AND expires_at > ${input.now}) AS waiting,
      (SELECT count(*)::int FROM gym_staff_invite_sends
        WHERE gym_id = ${input.gymId} AND created_at > ${input.dayAgo}) AS sent_today,
      (SELECT count(*)::int FROM gym_staff_invite_sends s
        JOIN gym_staff_invites i ON i.id = s.invite_id AND i.gym_id = s.gym_id
        WHERE s.gym_id = ${input.gymId} AND i.email = ${input.email} AND s.created_at > ${input.weekAgo}) AS sent_to_address`;
  const row = rows[0];
  return { waiting: row?.waiting ?? 0, sentToday: row?.sent_today ?? 0, sentToAddress: row?.sent_to_address ?? 0 };
}

/** Write the invitation and queue its email, in the caller's transaction. */
export async function insertInvite(
  tx: TransactionSql,
  input: {
    gymId: string;
    email: string;
    role: InviteRole;
    privileges: readonly string[];
    roleName: string | null;
    invitedBy: string;
    at: Date;
    expiresAt: Date;
  },
): Promise<StaffInviteRow> {
  const rows = await tx<RawInvite[]>`
    INSERT INTO gym_staff_invites (gym_id, email, role, privileges, role_name, invited_by, created_at, expires_at)
    VALUES (${input.gymId}, ${input.email}, ${input.role}, ${[...input.privileges]}, ${input.roleName}, ${input.invitedBy}, ${input.at}, ${input.expiresAt})
    RETURNING id, gym_id, email::text AS email, role, privileges, role_name, created_at, expires_at, state`;
  const row = rows[0];
  if (row === undefined) throw new Error("INSERT INTO gym_staff_invites returned no row");
  await tx`
    INSERT INTO gym_staff_invite_sends (gym_id, invite_id, email, not_before, created_at)
    VALUES (${input.gymId}, ${row.id}, ${input.email}, ${input.at}, ${input.at})`;
  return toInvite(row);
}

/** The owner's list: the newest open invitations (at most `STAFF_INVITES_LISTED`) with
 *  their latest email. At most 20 wait at once; the rest are ended or declined ones
 *  the owner has not taken off. */
export async function listOpenInvites(sql: SqlOrTx, gymId: string, now: Date): Promise<StaffInvite[]> {
  const rows = await sql<
    (RawInvite & { answered_at: Date | null; send_state: string | null; send_reason: string | null })[]
  >`
    SELECT i.id, i.gym_id, i.email::text AS email, i.role, i.privileges, i.role_name, i.created_at, i.expires_at, i.state, i.answered_at,
           s.state AS send_state, s.reason AS send_reason
    FROM gym_staff_invites i
    LEFT JOIN LATERAL (
      SELECT x.state, x.reason FROM gym_staff_invite_sends x
      WHERE x.gym_id = i.gym_id AND x.invite_id = i.id
      ORDER BY x.created_at DESC, x.id DESC
      LIMIT 1
    ) s ON true
    WHERE i.gym_id = ${gymId} AND i.state IN ('pending','declined') AND i.cleared_at IS NULL
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ${STAFF_INVITES_LISTED}`;
  return rows.map((row) => {
    const invite = toInvite(row);
    const reason: StaffInviteEmailReason | null = row.send_reason === null ? null : staffInviteEmailReasonSchema.parse(row.send_reason);
    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      privileges: invite.privileges,
      roleName: invite.roleName,
      invitedAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      state: invite.state === "declined" ? "declined" : invite.expiresAt.getTime() <= now.getTime() ? "ended" : "waiting",
      declinedAt: invite.state === "declined" && row.answered_at !== null ? row.answered_at.toISOString() : null,
      emailStatus: row.send_state === "sent" ? "sent" : row.send_state === "skipped" || row.send_state === "failed" ? "not_sent" : "sending",
      emailReason: row.send_state === "skipped" || row.send_state === "failed" ? reason : null,
    };
  });
}

/** One open invitation of this gym, locked. */
export async function lockOpenInvite(tx: TransactionSql, gymId: string, inviteId: string): Promise<StaffInviteRow | null> {
  const rows = await tx<RawInvite[]>`
    SELECT id, gym_id, email::text AS email, role, privileges, role_name, created_at, expires_at, state
    FROM gym_staff_invites
    WHERE gym_id = ${gymId} AND id = ${inviteId} AND state IN ('pending','declined') AND cleared_at IS NULL
    FOR UPDATE`;
  const row = rows[0];
  return row === undefined ? null : toInvite(row);
}

/** Answer an open invitation: accepted, declined or cancelled, by whom. */
export async function answerInvite(
  tx: TransactionSql,
  input: { gymId: string; inviteId: string; state: "accepted" | "declined" | "cancelled"; by: string; at: Date },
): Promise<void> {
  await tx`
    UPDATE gym_staff_invites SET state = ${input.state}, answered_at = ${input.at}, answered_by = ${input.by}
    WHERE gym_id = ${input.gymId} AND id = ${input.inviteId}`;
}

/** Every staff invitation of a closed gym, inside the transaction that archives it. */
export async function deleteStaffInvitesForGym(tx: TransactionSql, gymId: string): Promise<void> {
  await tx`DELETE FROM gym_staff_invites WHERE gym_id = ${gymId}`;
}

// ── The invited person's side ────────────────────────────────────────────────

export interface MyInviteRow extends StaffInviteRow {
  gymName: string;
  gymCity: string | null;
  orgType: string;
  invitedBy: string | null;
}

/** Open invitations to exactly this address that have not ended, at gyms still open. */
export async function invitesForAddress(sql: SqlOrTx, email: string, now: Date): Promise<MyInviteRow[]> {
  const rows = await sql<(RawInvite & { gym_name: string; gym_city: string | null; org_type: string; invited_by: string | null })[]>`
    SELECT i.id, i.gym_id, i.email::text AS email, i.role, i.privileges, i.role_name, i.created_at, i.expires_at, i.state,
           g.name AS gym_name, g.city AS gym_city, g.org_type, u.display_name AS invited_by
    FROM gym_staff_invites i
    JOIN gyms g ON g.id = i.gym_id
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.email = ${email}
      AND i.state IN ('pending','declined') AND i.cleared_at IS NULL
      AND i.expires_at > ${now}
      AND g.status = 'active'
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT 50`;
  return rows.map((row) => ({
    ...toInvite(row),
    gymName: row.gym_name,
    gymCity: row.gym_city,
    orgType: row.org_type,
    invitedBy: row.invited_by,
  }));
}

/** The gym of an invitation to exactly this address that is open, or that this same
 *  person accepted (a second Accept); null for any other id. */
export async function inviteGymFor(sql: SqlOrTx, input: { inviteId: string; email: string; userId: string }): Promise<string | null> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT gym_id FROM gym_staff_invites
    WHERE id = ${input.inviteId} AND email = ${input.email}
      AND ((state IN ('pending','declined') AND cleared_at IS NULL) OR (state = 'accepted' AND answered_by = ${input.userId}))`;
  return rows[0]?.gym_id ?? null;
}

/** The same invitation, locked, still to exactly this address, and open or accepted by
 *  this same person. */
export async function lockInviteFor(
  tx: TransactionSql,
  input: { gymId: string; inviteId: string; email: string; userId: string },
): Promise<StaffInviteRow | null> {
  const rows = await tx<RawInvite[]>`
    SELECT id, gym_id, email::text AS email, role, privileges, role_name, created_at, expires_at, state
    FROM gym_staff_invites
    WHERE gym_id = ${input.gymId} AND id = ${input.inviteId} AND email = ${input.email}
      AND ((state IN ('pending','declined') AND cleared_at IS NULL) OR (state = 'accepted' AND answered_by = ${input.userId}))
    FOR UPDATE`;
  const row = rows[0];
  return row === undefined ? null : toInvite(row);
}

/** This person's staff row here, and whether the console lets them in by it. */
export async function staffRowOf(
  tx: SqlOrTx,
  gymId: string,
  userId: string,
): Promise<{ role: string; counts: boolean } | null> {
  const rows = await tx<{ role: string; counts: boolean }[]>`
    SELECT s.role,
           (g.owner_user_id = s.user_id
            OR EXISTS (
              SELECT 1 FROM gym_members m
              WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at IS NULL)
            OR NOT EXISTS (
              SELECT 1 FROM gym_members m
              WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at >= s.created_at)
           ) AS counts
    FROM gym_staff s JOIN gyms g ON g.id = s.gym_id
    WHERE s.gym_id = ${gymId} AND s.user_id = ${userId}`;
  return rows[0] ?? null;
}

/** Make this person staff with the invitation's role and that role's starting ticks. A
 *  row the console no longer lets them in by (their membership closed after it was
 *  written) is written afresh, so the invitation is the owner's yes from now. */
export async function writeStaff(
  tx: TransactionSql,
  input: { gymId: string; userId: string; role: InviteRole; privileges: readonly string[]; roleName: string | null; at: Date },
): Promise<void> {
  await tx`
    INSERT INTO gym_staff (gym_id, user_id, role, privileges, role_name, created_at)
    VALUES (${input.gymId}, ${input.userId}, ${input.role}, ${[...input.privileges]}, ${input.roleName}, ${input.at})
    ON CONFLICT (gym_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, privileges = EXCLUDED.privileges, role_name = EXCLUDED.role_name, created_at = EXCLUDED.created_at`;
}

// ── The gym's own roles (Kd, RULINGS 2026-10-01) ─────────────────────────────

export interface StaffRoleRow {
  id: string;
  name: string;
  privileges: string[];
}

/** The gym's own roles, by name. */
export async function listRoles(sql: SqlOrTx, gymId: string): Promise<StaffRoleRow[]> {
  return await sql<StaffRoleRow[]>`
    SELECT id, name::text AS name, privileges FROM gym_staff_roles
    WHERE gym_id = ${gymId}
    ORDER BY lower(name::text), id`;
}

/** One of the gym's own roles; null for any other gym's id. */
export async function roleById(sql: SqlOrTx, gymId: string, roleId: string): Promise<StaffRoleRow | null> {
  const rows = await sql<StaffRoleRow[]>`
    SELECT id, name::text AS name, privileges FROM gym_staff_roles WHERE gym_id = ${gymId} AND id = ${roleId}`;
  return rows[0] ?? null;
}

export async function countRoles(tx: SqlOrTx, gymId: string): Promise<number> {
  const rows = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_staff_roles WHERE gym_id = ${gymId}`;
  return rows[0]?.n ?? 0;
}

/** Make a role; null when the gym already has one of that name (any case). */
export async function insertRole(
  tx: TransactionSql,
  input: { gymId: string; name: string; privileges: readonly string[]; by: string; at: Date },
): Promise<StaffRoleRow | null> {
  const rows = await tx<StaffRoleRow[]>`
    INSERT INTO gym_staff_roles (gym_id, name, privileges, created_by, created_at)
    VALUES (${input.gymId}, ${input.name}, ${[...input.privileges]}, ${input.by}, ${input.at})
    ON CONFLICT (gym_id, name) DO NOTHING
    RETURNING id, name::text AS name, privileges`;
  return rows[0] ?? null;
}

/** Delete a role. Staff and invitations that have its name keep it and their ticks. */
export async function deleteRole(tx: TransactionSql, gymId: string, roleId: string): Promise<string | null> {
  const rows = await tx<{ name: string }[]>`
    DELETE FROM gym_staff_roles WHERE gym_id = ${gymId} AND id = ${roleId} RETURNING name::text AS name`;
  return rows[0]?.name ?? null;
}
