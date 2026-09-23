// Press Invite (Part 3 §9.12, §11.5; ROADMAP 3b-i-a): who an Invite would reach, the
// press itself, one person invited, and one person's invitation sent again at their
// request. Nothing here sends an email; it queues one, and the worker sends it.
//
// Gates in CLAUDE.md §4's order: privilege (and a live plan, for a write), then the
// gym's readiness to send (invitations switched on, a postal address), then the rate
// limit, then the handler. Every write is one transaction holding the gym's row, the
// lock every change to the list takes, so the group a press counts cannot move before
// it is queued.
import {
  MEMBER_INVITE_AGAIN_PER_GYM_DAY,
  MEMBER_INVITE_AGAIN_PER_PERSON,
  MEMBER_INVITE_AGAIN_PERSON_DAYS,
  MEMBER_INVITE_WORDS,
  MEMBER_LIST_BY_HAND_WORDS,
  type MemberInviteBlocked,
  type MemberInviteOne,
  type MemberInvitePreview,
  type MemberInvitePreviewQuery,
  type MemberInviteRefusal,
  type MemberInviteRequest,
  type MemberInviteSkipped,
  type MemberInvited,
  type MemberListInvitation,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { gymHasLivePlan, insertAudit } from "../repo.js";
import * as listRepo from "../memberList/repo.js";
import type { MemberListDeps } from "../memberList/service.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { emailHmac, isSharedAddress } from "./address.js";
import { addressInApp } from "./inApp.js";
import * as repo from "./repo.js";
import type { InviteSettings } from "./settings.js";

type SqlOrTx = Sql | TransactionSql;

const refuse = (status: number, code: MemberInviteRefusal): OrgsError => new OrgsError(status, code, MEMBER_INVITE_WORDS[code]);

/** The press's own refusal: the group moved since the preview. */
export class InviteChanged extends Error {
  constructor(readonly preview: MemberInvitePreview) {
    super("invite_changed");
  }
}

/** A word filter as `GET /entries` folds it: case and spaces down, "" kept. */
const folded = (asked: string | string[] | undefined): string[] | null => {
  if (asked === undefined) return null;
  const words = Array.isArray(asked) ? asked : [asked];
  return [...new Set(words.map((word) => word.trim().toLowerCase()))];
};

const filtersOf = (query: MemberInvitePreviewQuery): repo.WordFilters => ({
  statuses: folded(query.status),
  membershipTypes: folded(query.membershipType),
  paymentStatuses: folded(query.paymentStatus),
});

interface Group {
  reach: { hmac: string; email: string }[];
  skipped: MemberInviteSkipped;
}

/** Who of the filtered group an Invite would queue, and why each of the rest is left
 *  out — each person under the first reason that applies, in the order the counts are
 *  listed. Two people sharing one address are one invitation: the first in the list's
 *  order is reached and the others count as already invited. */
async function workOutGroup(sql: SqlOrTx, settings: InviteSettings, gymId: string, filters: repo.WordFilters): Promise<Group> {
  const candidates = await repo.inviteCandidates(sql, gymId, filters);
  const members = await listRepo.membersAgainstList(sql, gymId);
  const inAppEntryIds = members.flatMap((member) => (member.entryId === null ? [] : [member.entryId]));
  // An address is in the app when ANY current entry holding it is matched to a member,
  // not only an entry inside this group: a household's second entry must not invite
  // the member the first one already is.
  const inAppAddresses = await repo.emailsOfEntries(sql, gymId, inAppEntryIds);
  const withEmail = candidates.flatMap((candidate) =>
    candidate.email === null ? [] : [{ email: candidate.email, hmac: emailHmac(settings.hmacKey, candidate.email) }],
  );
  const hmacs = withEmail.map((person) => person.hmac);
  const [invites, suppressions] = await Promise.all([
    repo.invitesFor(sql, gymId, hmacs),
    repo.suppressionsFor(sql, gymId, hmacs),
  ]);
  const skipped: MemberInviteSkipped = { noEmail: 0, inApp: 0, alreadyInvited: 0, unsubscribed: 0, bounced: 0, sharedAddress: 0 };
  const reach: Group["reach"] = [];
  const taken = new Set<string>();
  let next = 0;
  for (const candidate of candidates) {
    if (candidate.email === null) {
      skipped.noEmail += 1;
      continue;
    }
    const person = withEmail[next++];
    if (person === undefined) throw new Error("an address fell out of the invite group");
    const invite = invites.get(person.hmac);
    if (inAppAddresses.has(person.email.toLowerCase())) skipped.inApp += 1;
    else if ((invite !== undefined && repo.alreadyInvited(invite)) || taken.has(person.hmac)) skipped.alreadyInvited += 1;
    else if (suppressions.get(person.hmac) === "bounced") skipped.bounced += 1;
    else if (suppressions.has(person.hmac)) skipped.unsubscribed += 1;
    else if (isSharedAddress(person.email)) skipped.sharedAddress += 1;
    else {
      reach.push(person);
      taken.add(person.hmac);
    }
  }
  return { reach, skipped };
}

/** Why this gym cannot send at all yet, or null. */
async function blockedFor(sql: SqlOrTx, settings: InviteSettings | null, gymId: string, status: string): Promise<MemberInviteBlocked | null> {
  if (settings === null || settings.sender === null) return "invites_off";
  if (status !== "active") return "gym_archived";
  if (!(await gymHasLivePlan(sql, gymId))) return "gym_not_on_plan";
  if ((await repo.gymPostalAddress(sql, gymId)) === null) return "no_postal_address";
  if (await repo.gymInvitesStopped(sql, gymId)) return "sending_stopped";
  return null;
}

/** Sending switched on, a postal address, and not stopped: what every write needs first. */
export async function readyToSend(deps: MemberListDeps, gymId: string): Promise<InviteSettings> {
  const settings = deps.invites ?? null;
  if (settings === null || settings.sender === null) throw refuse(503, "invites_off");
  if ((await repo.gymPostalAddress(deps.sql, gymId)) === null) throw refuse(409, "no_postal_address");
  if (await repo.gymInvitesStopped(deps.sql, gymId)) throw refuse(409, "sending_stopped");
  return settings;
}

/** What an Invite with these filters would do now (§9.12's count on the button). */
export async function previewInvite(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  query: MemberInvitePreviewQuery,
  limit: () => Promise<boolean>,
): Promise<MemberInvitePreview | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const settings = deps.invites ?? null;
  const state = await listRepo.listState(deps.sql, gymId);
  const blocked = await blockedFor(deps.sql, settings, gymId, org.status);
  if (settings === null) {
    return {
      version: state?.version ?? 0,
      reach: 0,
      skipped: { noEmail: 0, inApp: 0, alreadyInvited: 0, unsubscribed: 0, bounced: 0, sharedAddress: 0 },
      blocked,
    };
  }
  const group = await workOutGroup(deps.sql, settings, gymId, filtersOf(query));
  return { version: state?.version ?? 0, reach: group.reach.length, skipped: group.skipped, blocked };
}

/** How many people one press writes in one transaction. The api has one database
 *  connection, so a press of ten thousand in one transaction would hold every other
 *  request for as long as it took; written in batches, other requests are answered in
 *  between (measured in spec §9.12's notes). */
export const INVITE_PRESS_BATCH = 500;

/** Press Invite: queue the first email for everybody the preview counted, if the list
 *  and the count are still the ones staff saw.
 *
 *  The group is worked out one statement at a time; the first batch is written under
 *  the gym's lock after the list's version is checked again, so a list changed since the
 *  group was read is refused; the rest follow in batches of their own. An address
 *  another press invited in between is left alone by the unique key and counted as
 *  already invited, so nobody is queued twice however the presses interleave. */
export async function pressInvite(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: MemberInviteRequest,
  limit: () => Promise<boolean>,
): Promise<MemberInvited | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const settings = await readyToSend(deps, gymId);
  if (!(await limit())) return null;
  const at = deps.now();
  const filters = filtersOf(request);
  const changed = async (): Promise<InviteChanged> => {
    const version = (await listRepo.listState(deps.sql, gymId))?.version ?? 0;
    const group = await workOutGroup(deps.sql, settings, gymId, filters);
    return new InviteChanged({ version, reach: group.reach.length, skipped: group.skipped, blocked: null });
  };

  const version = (await listRepo.listState(deps.sql, gymId))?.version ?? 0;
  const group = await workOutGroup(deps.sql, settings, gymId, filters);
  if (version !== request.version || group.reach.length !== request.expectedCount) {
    throw new InviteChanged({ version, reach: group.reach.length, skipped: group.skipped, blocked: null });
  }
  await deps.afterInviteGroupRead?.();
  const batches: (typeof group.reach)[] = [];
  for (let from = 0; from < group.reach.length; from += INVITE_PRESS_BATCH) {
    batches.push(group.reach.slice(from, from + INVITE_PRESS_BATCH));
  }
  const first = await deps.sql.begin(async (tx) => {
    await listRepo.lockGym(tx, gymId);
    if (((await listRepo.listState(tx, gymId))?.version ?? 0) !== version) return null;
    const queued = await repo.queueFirst(tx, gymId, batches[0] ?? [], at);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_invited",
      targetType: "member_list",
      targetId: gymId,
      meta: {
        reach: String(group.reach.length),
        version: String(version),
        noEmail: String(group.skipped.noEmail),
        inApp: String(group.skipped.inApp),
        alreadyInvited: String(group.skipped.alreadyInvited),
        unsubscribed: String(group.skipped.unsubscribed),
        bounced: String(group.skipped.bounced),
        sharedAddress: String(group.skipped.sharedAddress),
      },
    });
    return queued;
  });
  if (first === null) throw await changed();
  let queued = first;
  for (const batch of batches.slice(1)) queued += await repo.queueFirst(deps.sql, gymId, batch, at);
  return {
    queued,
    skipped: { ...group.skipped, alreadyInvited: group.skipped.alreadyInvited + group.reach.length - queued },
    version,
  };
}

/** One entry, checked for an invitation of either kind. Throws the refusal. */
async function inviteable(
  tx: TransactionSql,
  settings: InviteSettings,
  gymId: string,
  entryId: string,
): Promise<{ email: string; hmac: string; invite: repo.InviteRow | null }> {
  const entry = await listRepo.entryFor(tx, gymId, entryId);
  if (entry === null) throw new OrgsError(404, "entry_not_found", MEMBER_LIST_BY_HAND_WORDS.entry_not_found);
  if (entry.formerAt !== null) throw refuse(409, "not_on_list");
  const email = entry.values.email;
  if (email === null) throw refuse(409, "no_email");
  if (await addressInApp(tx, gymId, email, await repo.addressHolders(tx, gymId, email))) throw refuse(409, "in_app");
  const hmac = emailHmac(settings.hmacKey, email);
  const invite = (await repo.invitesFor(tx, gymId, [hmac])).get(hmac) ?? null;
  return { email, hmac, invite };
}

/** Refuse an address the gym may not email: unsubscribed, bounced or shared. */
async function mayEmail(tx: TransactionSql, gymId: string, email: string, hmac: string): Promise<void> {
  const suppressed = (await repo.suppressionsFor(tx, gymId, [hmac])).get(hmac);
  if (suppressed === "bounced") throw refuse(409, "bounced");
  if (suppressed !== undefined) throw refuse(409, "unsubscribed");
  if (isSharedAddress(email)) throw refuse(409, "shared_address");
}

/** Invite one person, inside the caller's transaction (which holds the gym's lock).
 *  An address already invited is not invited again: the answer says so. */
export async function inviteEntryInTx(
  tx: TransactionSql,
  settings: InviteSettings,
  input: { gymId: string; entryId: string; userId: string; at: Date },
): Promise<{ outcome: "queued" | "already_invited"; hmac: string }> {
  const { email, hmac, invite } = await inviteable(tx, settings, input.gymId, input.entryId);
  if (invite !== null && repo.alreadyInvited(invite)) return { outcome: "already_invited", hmac };
  await mayEmail(tx, input.gymId, email, hmac);
  const queued = await repo.queueFirst(tx, input.gymId, [{ hmac, email }], input.at);
  if (queued !== 1) throw new Error("a one-person invite queued nothing under the gym's lock");
  await insertAudit(tx, {
    actorUserId: input.userId,
    gymId: input.gymId,
    action: "org.member_list_entry_invited",
    targetType: "member_list_entry",
    targetId: input.entryId,
    meta: {},
  });
  return { outcome: "queued", hmac };
}

async function view(sql: SqlOrTx, gymId: string, hmac: string): Promise<MemberListInvitation> {
  const found = (await repo.invitationViews(sql, gymId, [hmac])).get(hmac);
  if (found === undefined) throw new Error("an invitation vanished after it was written");
  return found;
}

/** Invite one person from their page. */
export async function inviteOne(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  limit: () => Promise<boolean>,
): Promise<MemberInviteOne | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const settings = await readyToSend(deps, gymId);
  if (!(await limit())) return null;
  const at = deps.now();
  const done = await deps.sql.begin(async (tx) => {
    await listRepo.lockGym(tx, gymId);
    return await inviteEntryInTx(tx, settings, { gymId, entryId, userId, at });
  });
  return { outcome: done.outcome, invitation: await view(deps.sql, gymId, done.hmac) };
}

/** Send one person's invitation again because they asked (§9.12, RULINGS 2026-09-21):
 *  never in bulk, never on a timer, 3 times a person in 30 days and 20 a gym a day. */
export async function inviteAgain(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  limit: () => Promise<boolean>,
): Promise<MemberInviteOne | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const settings = await readyToSend(deps, gymId);
  if (!(await limit())) return null;
  const at = deps.now();
  const done = await deps.sql.begin(async (tx) => {
    await listRepo.lockGym(tx, gymId);
    const { email, hmac, invite } = await inviteable(tx, settings, gymId, entryId);
    if (invite === null) throw refuse(409, "not_invited");
    if (invite.state === "accepted") throw refuse(409, "already_joined");
    await mayEmail(tx, gymId, email, hmac);
    // A second press while the first email is still to go sends nothing more.
    if (await repo.hasOpenSend(tx, gymId, invite.id)) return { outcome: "already_queued" as const, hmac };
    const usage = await repo.againUsage(tx, gymId, invite.id, at, MEMBER_INVITE_AGAIN_PERSON_DAYS);
    if (usage.person >= MEMBER_INVITE_AGAIN_PER_PERSON) throw refuse(429, "again_person_limit");
    if (usage.gym >= MEMBER_INVITE_AGAIN_PER_GYM_DAY) throw refuse(429, "again_gym_limit");
    await repo.queueAgain(tx, gymId, invite.id, email, at);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_invite_sent_again",
      targetType: "member_list_entry",
      targetId: entryId,
      meta: {},
    });
    return { outcome: "queued" as const, hmac };
  });
  return { outcome: done.outcome, invitation: await view(deps.sql, gymId, done.hmac) };
}

/** The invitation of each of these entries' addresses, for a page of the list or one
 *  person's page. */
export async function invitationsOf(
  sql: SqlOrTx,
  settings: InviteSettings | null,
  gymId: string,
  entries: readonly { email: string | null }[],
): Promise<(MemberListInvitation | null)[]> {
  if (settings === null) return entries.map(() => null);
  const hmacs = entries.map((entry) => (entry.email === null ? null : emailHmac(settings.hmacKey, entry.email)));
  const views = await repo.invitationViews(
    sql,
    gymId,
    hmacs.flatMap((hmac) => (hmac === null ? [] : [hmac])),
  );
  return hmacs.map((hmac) => (hmac === null ? null : (views.get(hmac) ?? null)));
}

/** The entry ids whose address's invitation is in `state`, or, for `not_invited`, the
 *  ids whose address has an invitation — to be left out. Every entry with an address
 *  is hashed, so this is only asked when the filter is. */
export async function entriesByInvitation(
  sql: SqlOrTx,
  settings: InviteSettings | null,
  gymId: string,
  wanted: "not_invited" | "pending" | "accepted" | "declined" | "withdrawn",
): Promise<{ ids: string[]; include: boolean }> {
  if (settings === null) return { ids: [], include: wanted !== "not_invited" };
  const [addresses, invites] = await Promise.all([repo.entryAddresses(sql, gymId), repo.allInvites(sql, gymId)]);
  const ids: string[] = [];
  for (const entry of addresses) {
    const state = invites.get(emailHmac(settings.hmacKey, entry.email));
    if (state === undefined) continue;
    if (wanted === "not_invited" || state === wanted) ids.push(entry.entryId);
  }
  return { ids, include: wanted !== "not_invited" };
}
