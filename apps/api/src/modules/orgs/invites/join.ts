// Joining a gym by invitation (Part 3 §10.2; ROADMAP 3b-ii-a): what is waiting for the
// signed-in person's address, Join, and No thanks.
//
// THE RULE: an invitation opens only for the account that has PROVED the address it was
// sent to (a sign-in code, Google, the old verification link), and only to a live
// sign-in session begun after that proof. It is looked up by the HMAC of that address
// and nothing else, so a forwarded email, a second account, an Apple relay address or
// another gym's invitation id all find nothing. A session older than the proof may be
// somebody who set the account up under the owner's address before the owner ever
// signed in (see `auth/repo.ts`'s `recordVerifiedEmail`), so it is answered as if
// unproved.
import {
  INVITATION_WORDS,
  orgTypeSchema,
  type AcceptInvitationResponse,
  type DeclineInvitationResponse,
  type MyInvitationsResponse,
  type NotMeInvitationResponse,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import type { RedisLike } from "../../../redis.js";
import { accountAddress } from "../../auth/service.js";
import { bustEntitlements, yourPlansAt } from "../../entitlements/service.js";
import { claimSeatByInvitation, gymHasLivePlan, insertAudit, lockOrg, type OrgRow } from "../repo.js";
import { OrgsError } from "../service.js";
import { emailHmac } from "./address.js";
import * as repo from "./repo.js";
import type { InviteSettings } from "./settings.js";

export interface JoinDeps {
  sql: Sql;
  redis: RedisLike;
  invites: InviteSettings | null;
  now: () => Date;
}

/** Who is asking: their user id and the sign-in session their access token belongs to. */
export interface Caller {
  id: string;
  familyId: string | null;
}

interface Address {
  email: string;
  /** This sign-in has proved the address (or there is no account to prove). */
  proved: boolean;
  /** Null when there is nothing to look up: not proved, or invitations switched off. */
  hmac: string | null;
}

async function callerAddress(deps: JoinDeps, caller: Caller): Promise<Address> {
  const account = await accountAddress(deps.sql, caller.id, caller.familyId);
  if (account === null) return { email: "", proved: true, hmac: null };
  if (!account.provedForSession) return { email: account.email, proved: false, hmac: null };
  if (deps.invites === null) return { email: account.email, proved: true, hmac: null };
  return { email: account.email, proved: true, hmac: emailHmac(deps.invites.hmacKey, account.email) };
}

const noInvitation = (email: string): OrgsError => new OrgsError(404, "no_invitation", INVITATION_WORDS.no_invitation(email));

/** Nothing can be answered for an address this sign-in has not proved. */
function answerableHmac(address: Address): string {
  if (!address.proved) throw new OrgsError(403, "address_not_proved", INVITATION_WORDS.address_not_proved(address.email));
  if (address.hmac === null) throw noInvitation(address.email);
  return address.hmac;
}

/** What is waiting for the caller's address. */
export async function myInvitations(deps: JoinDeps, caller: Caller): Promise<MyInvitationsResponse> {
  const address = await callerAddress(deps, caller);
  if (address.hmac === null) return { address: address.email, addressProved: address.proved, invitations: [] };
  const rows = await repo.invitationsForAddress(deps.sql, { hmac: address.hmac, email: address.email, userId: caller.id });
  const plans = await yourPlansAt(
    deps.sql,
    caller.id,
    rows.flatMap((row) => (row.onPlan ? [row.gymId] : [])),
  );
  return {
    address: address.email,
    addressProved: true,
    invitations: rows.map((row) => ({
      id: row.id,
      state: row.state,
      gym: { id: row.gymId, name: row.gymName, city: row.gymCity, orgType: orgTypeSchema.parse(row.orgType) },
      canTakeMembers: row.onPlan,
      notMe: row.notMe,
      yourPlan: plans.get(row.gymId) ?? null,
    })),
  };
}

type AcceptOutcome =
  | { kind: "none" }
  | { kind: "joined" | "already_member"; org: OrgRow }
  | { kind: "full" | "not_taking"; org: OrgRow };

/** Join: the ONE tap, on "What {gym} can see". Everything that decides it is checked
 *  again under the gym's lock at the moment of the tap. */
export async function acceptInvitation(deps: JoinDeps, caller: Caller, inviteId: string): Promise<AcceptInvitationResponse> {
  const address = await callerAddress(deps, caller);
  const hmac = answerableHmac(address);
  const gymId = await repo.invitationGym(deps.sql, inviteId, hmac);
  if (gymId === null) throw noInvitation(address.email);
  const at = deps.now();

  const outcome = await deps.sql.begin(async (tx): Promise<AcceptOutcome> => {
    const org = await lockOrg(tx, gymId);
    if (org === null || org.status !== "active") return { kind: "none" };
    const invite = await repo.lockInvitation(tx, { gymId, inviteId, hmac });
    if (invite === null || invite.state === "withdrawn") return { kind: "none" };
    if (invite.state === "accepted") {
      return (await repo.isLiveMember(tx, gymId, caller.id)) ? { kind: "already_member", org } : { kind: "none" };
    }
    // The list is the gym's yes today: an address no current record holds is let in by
    // nothing, and is let in again the moment a record holds it.
    const holders = await repo.addressHolders(tx, gymId, address.email);
    if (holders.length === 0) return { kind: "none" };
    if (!(await gymHasLivePlan(tx, gymId))) return { kind: "not_taking", org };
    // A family sharing one address has several records; which of them this person is,
    // the list cannot say, so the membership is linked to none of them.
    const entryId = holders.length === 1 ? (holders[0]?.entryId ?? null) : null;
    const claim = await claimSeatByInvitation(tx, { org, userId: caller.id, entryId, at });
    if (claim.kind === "seat_cap") {
      await repo.markWaitingForPlace(tx, { gymId, inviteId: invite.id, at });
      return { kind: "full", org };
    }
    await repo.answerInvitation(tx, { gymId, inviteId: invite.id, state: "accepted", at });
    await insertAudit(tx, {
      actorUserId: caller.id,
      gymId,
      action: "org.invitation_accepted",
      targetType: "gym_member",
      targetId: claim.membership.id,
      meta: { invitationId: invite.id, via: "invitation", ...(entryId === null ? {} : { entryId }) },
    });
    return { kind: claim.kind === "joined" ? "joined" : "already_member", org };
  });

  switch (outcome.kind) {
    case "none":
      throw noInvitation(address.email);
    case "full":
      throw new OrgsError(409, "gym_full", INVITATION_WORDS.gym_full(outcome.org.name));
    case "not_taking":
      throw new OrgsError(409, "gym_not_taking_members", INVITATION_WORDS.gym_not_taking_members(outcome.org.name, outcome.org.orgType));
    case "joined":
    case "already_member":
      // The gym's member features follow the membership; the cached answer must not
      // wait out its minute.
      if (outcome.kind === "joined") await bustEntitlements(deps.redis, caller.id);
      return {
        outcome: outcome.kind,
        gym: { id: outcome.org.id, slug: outcome.org.slug, name: outcome.org.name, orgType: outcome.org.orgType },
      };
  }
}

/** No thanks. The gym sees it and sends nothing more; the person can still Join while
 *  the gym's list holds them (RULINGS 2026-09-23). */
export async function declineInvitation(deps: JoinDeps, caller: Caller, inviteId: string): Promise<DeclineInvitationResponse> {
  const address = await callerAddress(deps, caller);
  const hmac = answerableHmac(address);
  const gymId = await repo.invitationGym(deps.sql, inviteId, hmac);
  if (gymId === null) throw noInvitation(address.email);
  const at = deps.now();

  const outcome = await deps.sql.begin(async (tx): Promise<{ kind: "none" | "declined" } | { kind: "member"; org: OrgRow }> => {
    const org = await lockOrg(tx, gymId);
    if (org === null || org.status !== "active") return { kind: "none" };
    const invite = await repo.lockInvitation(tx, { gymId, inviteId, hmac });
    if (invite === null || invite.state === "withdrawn") return { kind: "none" };
    if (await repo.isLiveMember(tx, gymId, caller.id)) return { kind: "member", org };
    if (invite.state === "accepted") return { kind: "none" };
    if ((await repo.addressHolders(tx, gymId, address.email)).length === 0) return { kind: "none" };
    if (invite.state === "declined") return { kind: "declined" };
    await repo.answerInvitation(tx, { gymId, inviteId: invite.id, state: "declined", at });
    await insertAudit(tx, {
      actorUserId: caller.id,
      gymId,
      action: "org.invitation_declined",
      targetType: "gym_invite",
      targetId: invite.id,
      meta: {},
    });
    return { kind: "declined" };
  });

  if (outcome.kind === "none") throw noInvitation(address.email);
  if (outcome.kind === "member") {
    throw new OrgsError(409, "already_member", INVITATION_WORDS.already_member(outcome.org.name, outcome.org.orgType));
  }
  return { state: "declined" };
}

/** "Not me" on the Join screen (RULINGS 2026-09-23, gap A): the invitation is declined
 *  and marked, so staff check the address they have. The same checks as No thanks. */
export async function notMeInvitation(deps: JoinDeps, caller: Caller, inviteId: string): Promise<NotMeInvitationResponse> {
  const address = await callerAddress(deps, caller);
  const hmac = answerableHmac(address);
  const gymId = await repo.invitationGym(deps.sql, inviteId, hmac);
  if (gymId === null) throw noInvitation(address.email);
  const at = deps.now();

  const outcome = await deps.sql.begin(async (tx): Promise<{ kind: "none" | "done" } | { kind: "member"; org: OrgRow }> => {
    const org = await lockOrg(tx, gymId);
    if (org === null || org.status !== "active") return { kind: "none" };
    const invite = await repo.lockInvitation(tx, { gymId, inviteId, hmac });
    if (invite === null || invite.state === "withdrawn") return { kind: "none" };
    if (await repo.isLiveMember(tx, gymId, caller.id)) return { kind: "member", org };
    if (invite.state === "accepted") return { kind: "none" };
    if ((await repo.addressHolders(tx, gymId, address.email)).length === 0) return { kind: "none" };
    await recordNotMe(tx, { gymId, inviteId: invite.id, actorUserId: caller.id, via: "app", at });
    return { kind: "done" };
  });

  if (outcome.kind === "none") throw noInvitation(address.email);
  if (outcome.kind === "member") {
    throw new OrgsError(409, "already_member", INVITATION_WORDS.already_member(outcome.org.name, outcome.org.orgType));
  }
  return { state: "declined", notMe: true };
}

/** What a "Not me" link did: told the gym, had told it already, found the invitation
 *  already used to join or taken back by the gym, or found nothing. */
export type NotMeByLink =
  | { kind: "told" | "already_told" | "joined" | "withdrawn"; gymName: string }
  | { kind: "gone" };

/** "Not me" from the invitation email's link, whose MAC has proved the invitation id.
 *  Nobody is signed in, so it can only ever decline and mark: it never touches a
 *  membership, and the page it answers with names the gym and nothing else. */
export async function notMeByLink(sql: Sql, inviteId: string, at: Date): Promise<NotMeByLink> {
  const found = await repo.inviteForUnsubscribe(sql, inviteId);
  if (found === null) return { kind: "gone" };
  return await sql.begin(async (tx): Promise<NotMeByLink> => {
    const org = await lockOrg(tx, found.gymId);
    if (org === null) return { kind: "gone" };
    const invite = await repo.lockInvitationById(tx, found.gymId, inviteId);
    if (invite === null) return { kind: "gone" };
    if (invite.state === "accepted") return { kind: "joined", gymName: org.name };
    if (invite.state === "withdrawn") return { kind: "withdrawn", gymName: org.name };
    if (invite.notMe) return { kind: "already_told", gymName: org.name };
    await recordNotMe(tx, { gymId: found.gymId, inviteId, actorUserId: null, via: "email", at });
    return { kind: "told", gymName: org.name };
  });
}

async function recordNotMe(
  tx: TransactionSql,
  input: { gymId: string; inviteId: string; actorUserId: string | null; via: "app" | "email"; at: Date },
): Promise<void> {
  if (!(await repo.markNotMe(tx, { gymId: input.gymId, inviteId: input.inviteId, at: input.at }))) return;
  await insertAudit(tx, {
    actorUserId: input.actorUserId,
    gymId: input.gymId,
    action: "org.invitation_not_me",
    targetType: "gym_invite",
    targetId: input.inviteId,
    meta: { via: input.via },
  });
}

/** Withdraw the invitations of these accounts' addresses at this gym, inside the
 *  caller's transaction: staff removed them, so signing in again lets nobody back in. */
export async function withdrawForAccounts(
  tx: TransactionSql,
  settings: InviteSettings | null,
  input: { gymId: string; userIds: readonly string[]; at: Date },
): Promise<number> {
  if (settings === null || input.userIds.length === 0) return 0;
  const emails = await repo.accountAddresses(tx, input.userIds);
  return await repo.withdrawInvitations(tx, {
    gymId: input.gymId,
    hmacs: emails.map((email) => emailHmac(settings.hmacKey, email)),
    at: input.at,
  });
}

/** Withdraw the invitation of an address staff took off the list, inside the caller's
 *  transaction — unless another current record still holds it (a family sharing one
 *  address), whose person is still invited. */
export async function withdrawForAddress(
  tx: TransactionSql,
  settings: InviteSettings | null,
  input: { gymId: string; email: string | null; at: Date },
): Promise<number> {
  if (settings === null || input.email === null) return 0;
  if ((await repo.addressHolders(tx, input.gymId, input.email)).length > 0) return 0;
  return await repo.withdrawInvitations(tx, {
    gymId: input.gymId,
    hmacs: [emailHmac(settings.hmacKey, input.email)],
    at: input.at,
  });
}
