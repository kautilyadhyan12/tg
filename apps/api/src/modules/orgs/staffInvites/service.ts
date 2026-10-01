// Staff invited by email (Part 3 §10.3; ROADMAP 4a-i).
//
// THE OWNER'S SIDE: invite an address as manager or trainer, see what is waiting, cancel.
// The reply to an invitation is the same whether or not the address has an account: no
// query here asks the users table about it, except whether it is somebody already IN
// this gym (a member is appointed at once, as before; staff is refused), which the owner
// can read on Members and Staff anyway.
//
// THE INVITED PERSON'S SIDE: an invitation opens only for the account that has PROVED
// the address it was sent to, in a sign-in session begun after that proof (`accountAddress`,
// as a member invitation does, `invites/join.ts`). It is looked up by that exact address
// and nothing else, so a forwarded email, a second account, a Gmail address spelled with
// other dots, an Apple relay address or another gym's invitation id all find nothing.
// Accept writes a staff row with the role's starting ticks and NO membership.
import {
  STAFF_INVITE_DAYS,
  STAFF_INVITE_EMAILS_PER_ADDRESS_WEEK,
  STAFF_INVITE_EMAILS_PER_DAY,
  STAFF_INVITE_RESENDS_MAX,
  STAFF_INVITE_WORDS,
  withArticle,
  STAFF_INVITES_OPEN_MAX,
  STAFF_ROLES_MAX,
  OWNER_ONLY_PRIVILEGES,
  RESERVED_STAFF_ROLE_NAMES,
  orgPrivilegeSchema,
  orgRoleSchema,
  orgTypeSchema,
  orgWords,
  staffInviteSchema,
  type AcceptStaffInvitationResponse,
  type CancelStaffInviteResponse,
  type CreateStaffInviteRequest,
  type CreateStaffRoleRequest,
  type StaffRole,
  type StaffRolesResponse,
  type CreateStaffInviteResponse,
  type DeclineStaffInvitationResponse,
  type MyStaffInvitationsResponse,
  type ResendStaffInviteResponse,
  type StaffInvitesResponse,
} from "@app/shared";
import type { Sql } from "postgres";
import { accountAddress } from "../../auth/service.js";
import * as orgRepo from "../repo.js";
import { canonicalPrivileges, defaultPrivilegesFor, OrgsError, requirePrivilege, requireWritablePrivilege, toOrgStaff } from "../service.js";
import { emailHmac } from "../invites/address.js";
import { suppressionsFor } from "../invites/repo.js";
import type { InviteSettings } from "../invites/settings.js";
import * as repo from "./repo.js";

export interface StaffInviteDeps {
  sql: Sql;
  /** Null when invitation emails are switched off: nobody can be invited. */
  invites: InviteSettings | null;
  now: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Who is asking: their user id and the sign-in session their access token belongs to. */
export interface Caller {
  id: string;
  familyId: string | null;
}

// ── The owner's side ─────────────────────────────────────────────────────────

export async function createStaffInvite(
  deps: StaffInviteDeps,
  userId: string,
  gymId: string,
  input: CreateStaffInviteRequest,
): Promise<CreateStaffInviteResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "staff.manage");
  const words = orgWords(org.orgType);
  // One of the gym's own roles: its name is shown in place of the role, which is a
  // trainer's underneath; the ticks are what the console obeys (RULINGS 2026-10-01).
  const ownRole = input.roleId === undefined ? null : await repo.roleById(deps.sql, gymId, input.roleId);
  if (input.roleId !== undefined && ownRole === null) throw new OrgsError(404, "role_not_found", STAFF_INVITE_WORDS.role_not_found);
  const role = ownRole === null ? input.role : "trainer";
  const roleName = ownRole?.name ?? null;
  // The ticks the owner chose on the form (Kd, 2026-10-01), else the role's own.
  const privileges =
    input.privileges !== undefined
      ? canonicalPrivileges(input.privileges)
      : ownRole !== null
        ? canonicalPrivileges(ownRole.privileges.flatMap((p) => { const known = orgPrivilegeSchema.safeParse(p); return known.success ? [known.data] : []; }))
        : defaultPrivilegesFor(input.role);
  if (privileges.some((privilege) => OWNER_ONLY_PRIVILEGES.includes(privilege))) {
    throw new OrgsError(409, "owner_only_privilege", STAFF_INVITE_WORDS.owner_only_privilege);
  }

  // Somebody already in the gym is appointed at once (RULINGS 2026-09-21).
  const appointed = await orgRepo.addStaff(deps.sql, {
    gymId,
    email: input.email,
    role,
    privileges,
    roleName,
    actorUserId: userId,
  });
  switch (appointed.kind) {
    case "added":
      return { outcome: "added", staff: toOrgStaff(appointed.staff, userId) };
    case "already_staff":
      throw alreadyStaff(appointed.staff.displayName, appointed.staff.role, appointed.staff.roleName, org.orgType);
    case "not_a_member":
      break;
  }

  const settings = deps.invites;
  if (settings?.sender == null) throw new OrgsError(409, "sending_off", STAFF_INVITE_WORDS.sending_off);
  const at = deps.now();
  const invite = await deps.sql.begin(async (tx) => {
    await orgRepo.lockOrgRow(tx, gymId);
    const staff = await repo.staffNameAt(tx, gymId, input.email);
    if (staff !== null) throw alreadyStaff(staff.displayName, staff.role, staff.roleName, org.orgType);
    const open = await repo.lockOpenInviteFor(tx, gymId, input.email);
    if (open !== null && open.state === "pending" && open.expiresAt.getTime() > at.getTime()) {
      throw new OrgsError(409, "already_invited", STAFF_INVITE_WORDS.already_invited(open.email));
    }
    const counts = await repo.inviteCounts(tx, {
      gymId,
      email: input.email,
      now: at,
      dayAgo: new Date(at.getTime() - DAY_MS),
      weekAgo: new Date(at.getTime() - 7 * DAY_MS),
    });
    if (counts.waiting >= STAFF_INVITES_OPEN_MAX) throw new OrgsError(409, "too_many_open", STAFF_INVITE_WORDS.too_many_open);
    if (counts.sentToday >= STAFF_INVITE_EMAILS_PER_DAY) throw new OrgsError(429, "too_many_today", STAFF_INVITE_WORDS.too_many_today);
    if (counts.sentToAddress >= STAFF_INVITE_EMAILS_PER_ADDRESS_WEEK) {
      throw new OrgsError(429, "too_many_to_address", STAFF_INVITE_WORDS.too_many_to_address(input.email));
    }
    // An ended or declined invitation to this address is replaced by this one.
    if (open !== null) await repo.clearInvite(tx, gymId, open.id, at);
    const written = await repo.insertInvite(tx, {
      gymId,
      email: input.email,
      role,
      privileges,
      roleName,
      invitedBy: userId,
      at,
      expiresAt: new Date(at.getTime() + STAFF_INVITE_DAYS * DAY_MS),
      emailHmac: emailHmac(settings.hmacKey, input.email),
    });
    await orgRepo.insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.staff_invited",
      targetType: "staff_invite",
      targetId: written.id,
      meta: { role, roleName, privileges },
    });
    return written;
  });

  return {
    outcome: "invited",
    invite: staffInviteSchema.parse({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      privileges: invite.privileges,
      roleName: invite.roleName,
      invitedAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      state: "waiting",
      declinedAt: null,
      emailStatus: "sending",
      emailReason: null,
      lastSentAt: invite.createdAt.toISOString(),
      resendsLeft: STAFF_INVITE_RESENDS_MAX,
    }),
  };

  function alreadyStaff(displayName: string, role: string, roleName: string | null, orgType: unknown): OrgsError {
    const word = roleName ?? (role === "manager" ? "manager" : orgWords(orgType).coach);
    return new OrgsError(
      409,
      "already_staff",
      role === "owner"
        ? `That person owns this ${words.it}.`
        : `${displayName} is already ${withArticle(word)} here. Change what they can do instead of inviting them again.`,
    );
  }
}

export async function listStaffInvites(deps: StaffInviteDeps, userId: string, gymId: string): Promise<StaffInvitesResponse> {
  await requirePrivilege(deps, gymId, userId, "staff.manage");
  return { invites: await repo.listOpenInvites(deps.sql, gymId, deps.now()) };
}

/** Cancel a waiting invitation, or take an ended or declined one off the list. Its email,
 *  if still queued, is stopped by the worker's own check. */
export async function cancelStaffInvite(
  deps: StaffInviteDeps,
  userId: string,
  gymId: string,
  inviteId: string,
): Promise<CancelStaffInviteResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "staff.manage");
  const at = deps.now();
  const found = await deps.sql.begin(async (tx) => {
    await orgRepo.lockOrgRow(tx, gymId);
    const invite = await repo.lockOpenInvite(tx, gymId, inviteId);
    if (invite === null) return false;
    if (invite.state === "pending") await repo.answerInvite(tx, { gymId, inviteId, state: "cancelled", by: userId, at });
    else await repo.clearInvite(tx, gymId, inviteId, at);
    await orgRepo.insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.staff_invite_cancelled",
      targetType: "staff_invite",
      targetId: inviteId,
      meta: { was: invite.state },
    });
    return true;
  });
  if (!found) throw new OrgsError(404, "invite_not_found", STAFF_INVITE_WORDS.invite_not_found);
  return { status: "cancelled" };
}

/** Send again (ROADMAP 4a-ii): the same invitation's email once more, and 7 more days
 *  from now, at most `STAFF_INVITE_RESENDS_MAX` times. Waiting, ended or declined alike.
 *  Under the gym's lock: the gym's caps as for a new invitation, an address that bounced
 *  or complained is refused here rather than skipped by the worker, and a second press
 *  while the last email is still to go sends nothing. */
export async function resendStaffInvite(
  deps: StaffInviteDeps,
  userId: string,
  gymId: string,
  inviteId: string,
): Promise<ResendStaffInviteResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "staff.manage");
  const settings = deps.invites;
  if (settings?.sender == null) throw new OrgsError(409, "sending_off", STAFF_INVITE_WORDS.sending_off);
  const at = deps.now();
  await deps.sql.begin(async (tx) => {
    await orgRepo.lockOrgRow(tx, gymId);
    const invite = await repo.lockOpenInvite(tx, gymId, inviteId);
    if (invite === null) throw new OrgsError(404, "invite_not_found", STAFF_INVITE_WORDS.invite_not_found);
    const sends = await repo.sendsOf(tx, gymId, inviteId);
    if (sends.waiting) throw new OrgsError(409, "still_sending", STAFF_INVITE_WORDS.still_sending);
    if (repo.resendsLeft(sends.count) === 0) throw new OrgsError(409, "resends_used", STAFF_INVITE_WORDS.resends_used(invite.email));
    const hmac = emailHmac(settings.hmacKey, invite.email);
    const blocked = (await suppressionsFor(tx, gymId, [hmac])).get(hmac);
    if (blocked !== undefined) throw new OrgsError(409, "address_blocked", STAFF_INVITE_WORDS.address_blocked(invite.email, blocked));
    const counts = await repo.inviteCounts(tx, {
      gymId,
      email: invite.email,
      now: at,
      dayAgo: new Date(at.getTime() - DAY_MS),
      weekAgo: new Date(at.getTime() - 7 * DAY_MS),
    });
    const waitingNow = invite.state === "pending" && invite.expiresAt.getTime() > at.getTime();
    if (!waitingNow && counts.waiting >= STAFF_INVITES_OPEN_MAX) throw new OrgsError(409, "too_many_open", STAFF_INVITE_WORDS.too_many_open);
    if (counts.sentToday >= STAFF_INVITE_EMAILS_PER_DAY) throw new OrgsError(429, "too_many_today", STAFF_INVITE_WORDS.too_many_today);
    if (counts.sentToAddress >= STAFF_INVITE_EMAILS_PER_ADDRESS_WEEK) {
      throw new OrgsError(429, "too_many_to_address", STAFF_INVITE_WORDS.too_many_to_address(invite.email));
    }
    await repo.resendInvite(tx, {
      gymId,
      inviteId,
      email: invite.email,
      emailHmac: hmac,
      at,
      expiresAt: new Date(at.getTime() + STAFF_INVITE_DAYS * DAY_MS),
    });
    await orgRepo.insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.staff_invite_resent",
      targetType: "staff_invite",
      targetId: inviteId,
      meta: { was: waitingNow ? "waiting" : invite.state === "declined" ? "declined" : "ended" },
    });
  });
  const [view] = await repo.listOpenInvites(deps.sql, gymId, at, inviteId);
  if (view === undefined) throw new OrgsError(404, "invite_not_found", STAFF_INVITE_WORDS.invite_not_found);
  return { invite: view };
}

// ── The gym's own roles (Kd, RULINGS 2026-10-01) ─────────────────────────────

export async function listStaffRoles(deps: StaffInviteDeps, userId: string, gymId: string): Promise<StaffRolesResponse> {
  await requirePrivilege(deps, gymId, userId, "staff.manage");
  return { roles: await repo.listRoles(deps.sql, gymId) };
}

/** Make a role: a name and its ticks, offered on the invite form from then on. */
export async function createStaffRole(
  deps: StaffInviteDeps,
  userId: string,
  gymId: string,
  input: CreateStaffRoleRequest,
): Promise<{ role: StaffRole }> {
  await requireWritablePrivilege(deps, gymId, userId, "staff.manage");
  const privileges = canonicalPrivileges(input.privileges);
  if (privileges.some((privilege) => OWNER_ONLY_PRIVILEGES.includes(privilege))) {
    throw new OrgsError(409, "owner_only_privilege", STAFF_INVITE_WORDS.owner_only_privilege);
  }
  if ((RESERVED_STAFF_ROLE_NAMES as readonly string[]).includes(input.name.toLowerCase())) {
    throw new OrgsError(409, "role_name_reserved", STAFF_INVITE_WORDS.role_name_reserved(input.name));
  }
  const role = await deps.sql.begin(async (tx) => {
    await orgRepo.lockOrgRow(tx, gymId);
    if ((await repo.countRoles(tx, gymId)) >= STAFF_ROLES_MAX) throw new OrgsError(409, "too_many_roles", STAFF_INVITE_WORDS.too_many_roles);
    const made = await repo.insertRole(tx, { gymId, name: input.name, privileges, by: userId, at: deps.now() });
    if (made === null) throw new OrgsError(409, "role_name_taken", STAFF_INVITE_WORDS.role_name_taken(input.name));
    await orgRepo.insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.staff_role_created",
      targetType: "staff_role",
      targetId: made.id,
      meta: { name: made.name, privileges },
    });
    return made;
  });
  return { role };
}

/** Delete a role. Nobody loses anything: staff and invitations keep its name and ticks. */
export async function deleteStaffRole(deps: StaffInviteDeps, userId: string, gymId: string, roleId: string): Promise<{ status: "deleted" }> {
  await requireWritablePrivilege(deps, gymId, userId, "staff.manage");
  const name = await deps.sql.begin(async (tx) => {
    await orgRepo.lockOrgRow(tx, gymId);
    const gone = await repo.deleteRole(tx, gymId, roleId);
    if (gone !== null) {
      await orgRepo.insertAudit(tx, {
        actorUserId: userId,
        gymId,
        action: "org.staff_role_deleted",
        targetType: "staff_role",
        targetId: roleId,
        meta: { name: gone },
      });
    }
    return gone;
  });
  if (name === null) throw new OrgsError(404, "role_not_found", STAFF_INVITE_WORDS.role_not_found);
  return { status: "deleted" };
}

// ── The invited person's side ────────────────────────────────────────────────

interface Address {
  email: string;
  /** This sign-in has proved the address. */
  proved: boolean;
}

async function callerAddress(sql: Sql, caller: Caller): Promise<Address | null> {
  const account = await accountAddress(sql, caller.id, caller.familyId);
  if (account === null) return null;
  return { email: account.email, proved: account.provedForSession };
}

/** The address an answer may be given for: proved by this sign-in, or refused. */
async function answerableAddress(sql: Sql, caller: Caller): Promise<string> {
  const address = await callerAddress(sql, caller);
  if (address === null) throw new OrgsError(404, "no_invitation", STAFF_INVITE_WORDS.invite_not_found);
  if (!address.proved) throw new OrgsError(403, "address_not_proved", STAFF_INVITE_WORDS.address_not_proved(address.email));
  return address.email;
}

export async function myStaffInvitations(deps: StaffInviteDeps, caller: Caller): Promise<MyStaffInvitationsResponse> {
  const address = await callerAddress(deps.sql, caller);
  if (address === null) return { address: "", addressProved: true, invitations: [] };
  if (!address.proved) return { address: address.email, addressProved: false, invitations: [] };
  const rows = await repo.invitesForAddress(deps.sql, address.email, deps.now());
  return {
    address: address.email,
    addressProved: true,
    invitations: rows.map((row) => ({
      id: row.id,
      role: row.role,
      privileges: row.privileges,
      roleName: row.roleName,
      gym: { id: row.gymId, name: row.gymName, city: row.gymCity, orgType: orgTypeSchema.parse(row.orgType) },
      invitedBy: row.invitedBy,
      expiresAt: row.expiresAt.toISOString(),
      state: row.state === "declined" ? "declined" : "pending",
    })),
  };
}

const toRole = (role: string): "owner" | "manager" | "trainer" => orgRoleSchema.parse(role);

type AcceptOutcome =
  | { kind: "none" }
  | { kind: "ended"; org: orgRepo.OrgRow }
  | { kind: "accepted" | "already_staff"; org: orgRepo.OrgRow; role: "owner" | "manager" | "trainer" };

/** Accept: everything that decides it is checked again under the gym's lock. A declined
 *  invitation may still be accepted while it has not ended (a mis-tap). */
export async function acceptStaffInvitation(
  deps: StaffInviteDeps,
  caller: Caller,
  inviteId: string,
): Promise<AcceptStaffInvitationResponse> {
  const email = await answerableAddress(deps.sql, caller);
  const gymId = await repo.inviteGymFor(deps.sql, { inviteId, email, userId: caller.id });
  if (gymId === null) throw new OrgsError(404, "no_invitation", STAFF_INVITE_WORDS.no_invitation(email));
  const at = deps.now();
  const outcome = await deps.sql.begin(async (tx): Promise<AcceptOutcome> => {
    const org = await orgRepo.lockOrg(tx, gymId);
    if (org === null || org.status !== "active") return { kind: "none" };
    const invite = await repo.lockInviteFor(tx, { gymId, inviteId, email, userId: caller.id });
    if (invite === null) return { kind: "none" };
    const existing = await repo.staffRowOf(tx, gymId, caller.id);
    // A second Accept: still staff by it, or it opens nothing.
    if (invite.state === "accepted") {
      if (existing === null) return { kind: "none" };
      return { kind: "already_staff", org, role: toRole(existing.role) };
    }
    if (invite.expiresAt.getTime() <= at.getTime()) return { kind: "ended", org };
    if (existing !== null) {
      await repo.answerInvite(tx, { gymId, inviteId, state: "accepted", by: caller.id, at });
      return { kind: "already_staff", org, role: toRole(existing.role) };
    }
    // Exactly what the owner ticked when inviting.
    const privileges = invite.privileges;
    await repo.writeStaff(tx, { gymId, userId: caller.id, role: invite.role, privileges, roleName: invite.roleName, at });
    await repo.answerInvite(tx, { gymId, inviteId, state: "accepted", by: caller.id, at });
    await orgRepo.insertAudit(tx, {
      actorUserId: caller.id,
      gymId,
      action: "org.staff_invite_accepted",
      targetType: "gym_staff",
      targetId: caller.id,
      meta: { invitationId: inviteId, role: invite.role, roleName: invite.roleName, privileges },
    });
    return { kind: "accepted", org, role: invite.role };
  });
  switch (outcome.kind) {
    case "none":
      throw new OrgsError(404, "no_invitation", STAFF_INVITE_WORDS.no_invitation(email));
    case "ended":
      throw new OrgsError(409, "invitation_ended", STAFF_INVITE_WORDS.ended(outcome.org.name));
    case "accepted":
    case "already_staff":
      return {
        outcome: outcome.kind,
        role: outcome.role,
        gym: { id: outcome.org.id, slug: outcome.org.slug, name: outcome.org.name, orgType: outcome.org.orgType },
      };
  }
}

/** No thanks. The owner sees it on Settings → Staff. */
export async function declineStaffInvitation(
  deps: StaffInviteDeps,
  caller: Caller,
  inviteId: string,
): Promise<DeclineStaffInvitationResponse> {
  const email = await answerableAddress(deps.sql, caller);
  const gymId = await repo.inviteGymFor(deps.sql, { inviteId, email, userId: caller.id });
  if (gymId === null) throw new OrgsError(404, "no_invitation", STAFF_INVITE_WORDS.no_invitation(email));
  const at = deps.now();
  const outcome = await deps.sql.begin(async (tx): Promise<{ kind: "none" | "declined" } | { kind: "ended"; gymName: string }> => {
    const org = await orgRepo.lockOrg(tx, gymId);
    if (org === null || org.status !== "active") return { kind: "none" };
    const invite = await repo.lockInviteFor(tx, { gymId, inviteId, email, userId: caller.id });
    if (invite === null || invite.state === "accepted") return { kind: "none" };
    if (invite.expiresAt.getTime() <= at.getTime()) return { kind: "ended", gymName: org.name };
    if (invite.state === "declined") return { kind: "declined" };
    await repo.answerInvite(tx, { gymId, inviteId, state: "declined", by: caller.id, at });
    await orgRepo.insertAudit(tx, {
      actorUserId: caller.id,
      gymId,
      action: "org.staff_invite_declined",
      targetType: "staff_invite",
      targetId: inviteId,
      meta: { role: invite.role },
    });
    return { kind: "declined" };
  });
  if (outcome.kind === "none") throw new OrgsError(404, "no_invitation", STAFF_INVITE_WORDS.no_invitation(email));
  if (outcome.kind === "ended") throw new OrgsError(409, "invitation_ended", STAFF_INVITE_WORDS.ended(outcome.gymName));
  return { state: "declined" };
}
