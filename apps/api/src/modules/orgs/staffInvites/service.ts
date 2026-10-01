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
  STAFF_INVITE_WORDS,
  STAFF_INVITES_OPEN_MAX,
  orgRoleSchema,
  orgTypeSchema,
  orgWords,
  staffInviteSchema,
  type AcceptStaffInvitationResponse,
  type CancelStaffInviteResponse,
  type CreateStaffInviteRequest,
  type CreateStaffInviteResponse,
  type DeclineStaffInvitationResponse,
  type MyStaffInvitationsResponse,
  type StaffInvitesResponse,
} from "@app/shared";
import type { Sql } from "postgres";
import { accountAddress } from "../../auth/service.js";
import * as orgRepo from "../repo.js";
import { defaultPrivilegesFor, OrgsError, requirePrivilege, requireWritablePrivilege, toOrgStaff } from "../service.js";
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

  // Somebody already in the gym is appointed at once (RULINGS 2026-09-21).
  const appointed = await orgRepo.addStaff(deps.sql, {
    gymId,
    email: input.email,
    role: input.role,
    privileges: defaultPrivilegesFor(input.role),
    actorUserId: userId,
  });
  switch (appointed.kind) {
    case "added":
      return { outcome: "added", staff: toOrgStaff(appointed.staff, userId) };
    case "already_staff":
      throw alreadyStaff(appointed.staff.displayName, appointed.staff.role, org.orgType);
    case "not_a_member":
      break;
  }

  if (deps.invites?.sender == null) throw new OrgsError(409, "sending_off", STAFF_INVITE_WORDS.sending_off);
  const at = deps.now();
  const invite = await deps.sql.begin(async (tx) => {
    await orgRepo.lockOrgRow(tx, gymId);
    const staff = await repo.staffNameAt(tx, gymId, input.email);
    if (staff !== null) throw alreadyStaff(staff.displayName, staff.role, org.orgType);
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
      role: input.role,
      invitedBy: userId,
      at,
      expiresAt: new Date(at.getTime() + STAFF_INVITE_DAYS * DAY_MS),
    });
    await orgRepo.insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.staff_invited",
      targetType: "staff_invite",
      targetId: written.id,
      meta: { role: input.role },
    });
    return written;
  });

  return {
    outcome: "invited",
    invite: staffInviteSchema.parse({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      invitedAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      state: "waiting",
      declinedAt: null,
      emailStatus: "sending",
      emailReason: null,
    }),
  };

  function alreadyStaff(displayName: string, role: string, orgType: unknown): OrgsError {
    return new OrgsError(
      409,
      "already_staff",
      role === "owner"
        ? `That person owns this ${words.it}.`
        : `${displayName} is already ${role === "manager" ? "a manager" : `a ${orgWords(orgType).coach}`} here. Change their role instead of inviting them again.`,
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
      if (existing === null || !existing.counts) return { kind: "none" };
      return { kind: "already_staff", org, role: toRole(existing.role) };
    }
    if (invite.expiresAt.getTime() <= at.getTime()) return { kind: "ended", org };
    if (existing !== null && existing.counts) {
      await repo.answerInvite(tx, { gymId, inviteId, state: "accepted", by: caller.id, at });
      return { kind: "already_staff", org, role: toRole(existing.role) };
    }
    const privileges = defaultPrivilegesFor(invite.role);
    await repo.writeStaff(tx, { gymId, userId: caller.id, role: invite.role, privileges, at });
    await repo.answerInvite(tx, { gymId, inviteId, state: "accepted", by: caller.id, at });
    await orgRepo.insertAudit(tx, {
      actorUserId: caller.id,
      gymId,
      action: "org.staff_invite_accepted",
      targetType: "gym_staff",
      targetId: caller.id,
      meta: { invitationId: inviteId, role: invite.role, privileges },
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
