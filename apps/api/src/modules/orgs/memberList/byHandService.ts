// KEEPING THE LIST BY HAND — Part 3 §9.9, §11.6; ROADMAP Stage 2 item 3a-iv.
//
// One person's page; add, change, take off, put back, delete a former record for
// good; join two records; put an app member on the list; and "Remove all" for the
// members the list no longer holds or never held.
//
// Gates in CLAUDE.md §4's order: privilege (and a live plan, for a write), then the
// rate limit, then the handler. Every write is one transaction holding the gym's
// row — the lock the confirm and the join door take — and every statement inside
// it uses `tx`: the API's pool is one connection.
import {
  isLargeMemberListChange,
  MEMBER_LIST_BY_HAND_WORDS,
  MEMBER_LIST_ENTRIES_PAGE,
  MEMBER_LIST_MAX_EDITED_FIELDS,
  MEMBER_LIST_MAX_NAME_CHARS,
  type MemberListEntryDeleted,
  type MemberListEntryDetail,
  type MemberListEntryInput,
  type MemberListEntryOutcome,
  type MemberListEntryPatch,
  type MemberListEntryWritten,
  type MemberListRemoveUnlistedRequest,
  type MemberListUnlistedGroup,
  type MemberListUnlistedPage,
  type MemberListUnlistedQuery,
} from "@app/shared";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import { bustEntitlements } from "../../entitlements/service.js";
import { withdrawForAccounts, withdrawForAddress } from "../invites/join.js";
import { invitationsOf, inviteEntryInTx, readyToSend } from "../invites/service.js";
import type { InviteSettings } from "../invites/settings.js";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { applyTyped, EMPTY_VALUES, mergeValues, type EntryValues, type TypedContext } from "./byHand.js";
import { tidyCell } from "./cells.js";
import { cut, identityKey } from "./fields.js";
import { withoutCardNumbers } from "./neverKeep.js";
import { readCountry } from "./phone.js";
import * as repo from "./repo.js";
import type { MemberListDeps } from "./service.js";
import { unlistedDigest, unlistedGroup, unlistedPage } from "./unlisted.js";

type Sql = MemberListDeps["sql"];

const notFound = (): OrgsError => new OrgsError(404, "entry_not_found", MEMBER_LIST_BY_HAND_WORDS.entry_not_found);

/** One person's page, read on `sql` (the pool, or the caller's transaction). */
async function detailOf(
  sql: Sql | TransactionSql,
  gymId: string,
  entry: repo.StoredEntry,
  settings: InviteSettings | null,
): Promise<MemberListEntryDetail> {
  const [fields, reached, invitation] = await Promise.all([
    repo.listFields(sql, gymId),
    repo.membersAgainstList(sql, gymId, { email: entry.values.email, phone: entry.values.phone, entryIds: [entry.id] }),
    invitationsOf(sql, settings, gymId, [{ email: entry.values.email }]),
  ]);
  // A member belongs to this record when §9.7's match takes them to it: the current
  // record for a current one, the former match for a former one.
  const mine = reached.filter((member) => (entry.formerAt === null ? member.entryId : member.formerEntryId) === entry.id);
  const visits = await repo.memberVisits(
    sql,
    gymId,
    mine.map((member) => member.userId),
  );
  const { values } = entry;
  return {
    entryId: entry.id,
    fullName: values.fullName,
    email: values.email,
    phone: values.phone,
    memberNumber: values.memberNumber,
    status: values.status,
    membershipType: values.membershipType,
    joinedOn: values.joinedOn,
    endsOn: values.endsOn,
    endsOnKind: values.endsOnKind,
    paymentStatus: values.paymentStatus,
    dateOfBirth: values.dateOfBirth,
    formerAt: entry.formerAt?.toISOString() ?? null,
    source: entry.source,
    inApp: mine.length > 0,
    invitation: invitation[0] ?? null,
    extra: fields.map((field) => ({ key: field.key, label: field.label, value: values.extra[field.key] ?? "" })),
    handEdited: entry.handEdited,
    members: visits.map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      joinedAt: row.joinedAt.toISOString(),
      visits: row.visits,
      lastVisitOn: row.lastVisitOn,
    })),
  };
}

async function detailAfter(deps: MemberListDeps, gymId: string, entryId: string): Promise<MemberListEntryDetail> {
  const entry = await repo.entryFor(deps.sql, gymId, entryId);
  if (entry === null) throw notFound();
  return await detailOf(deps.sql, gymId, entry, deps.invites ?? null);
}

async function typedContext(tx: TransactionSql, gymId: string, country: string | null): Promise<TypedContext> {
  const fields = await repo.listFields(tx, gymId);
  return { country: readCountry(country), fields: new Map(fields.map((field) => [field.key, field.label])) };
}

/** Thrown inside a write's transaction to roll it back: the write would leave app
 *  members reached by no current record, and the request carried no tick. */
class LeavesList extends Error {
  constructor(
    readonly members: number,
    readonly by: "change" | "merge",
  ) {
    super("leaves_list");
  }
}

/** The paid-seat members §9.7 matches to this record now: the people who read "on your
 *  list" because of it. A former record reaches nobody. */
async function membersOf(tx: TransactionSql, gymId: string, entry: repo.StoredEntry): Promise<string[]> {
  if (entry.formerAt !== null) return [];
  const reached = await repo.membersAgainstList(tx, gymId, { email: entry.values.email, phone: entry.values.phone, entryIds: [entry.id] });
  return reached.filter((member) => member.seatCounted && member.entryId === entry.id).map((member) => member.userId);
}

/** How many of `userIds` no current record reaches any more, asked after the write and
 *  inside the same transaction, by the same match every read uses. */
async function leftOff(
  tx: TransactionSql,
  gymId: string,
  contact: EntryValues,
  entryIds: readonly string[],
  userIds: readonly string[],
): Promise<number> {
  if (userIds.length === 0) return 0;
  const after = await repo.membersAgainstList(tx, gymId, { email: contact.email, phone: contact.phone, entryIds });
  const listed = new Set(after.filter((member) => member.onList).map((member) => member.userId));
  return userIds.filter((userId) => !listed.has(userId)).length;
}

/** The contacts of every record that is current, before or after a change. */
const currentContacts = (...records: { values: EntryValues; current: boolean }[]) =>
  records.filter((record) => record.current).map((record) => ({ email: record.values.email, phone: record.values.phone }));

const listVersion = async (tx: TransactionSql, gymId: string): Promise<number> => (await repo.listState(tx, gymId))?.version ?? 0;

export async function readEntry(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  limit: () => Promise<boolean>,
): Promise<MemberListEntryDetail | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  return await detailAfter(deps, gymId, entryId);
}

export type WriteAnswer =
  | { kind: "written"; status: 200 | 201; written: MemberListEntryWritten }
  /** The change would make this record the same person as another one, current or
   *  former. */
  | { kind: "already_on_list"; entryId: string; former: boolean }
  /** The write would leave this many app members reached by no record. */
  | { kind: "leaves_list"; members: number; by: "change" | "merge" }
  | { kind: "rate_limited" };

/** A write's transaction, with a `LeavesList` refusal turned into its answer. */
async function guarded<T>(run: () => Promise<T>): Promise<T | { kind: "leaves_list"; members: number; by: "change" | "merge" }> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof LeavesList) return { kind: "leaves_list", members: err.members, by: err.by };
    throw err;
  }
}

interface Done {
  outcome: MemberListEntryOutcome;
  entryId: string;
  version: number;
  /** "Add and invite": what happened to the invitation. */
  invited?: "queued" | "already_invited";
}

async function finish(deps: MemberListDeps, gymId: string, done: Done): Promise<WriteAnswer> {
  const entry = await detailAfter(deps, gymId, done.entryId);
  const written: MemberListEntryWritten = { outcome: done.outcome, entry, version: done.version };
  if (done.invited !== undefined) {
    if (entry.invitation === null) throw new Error("an invited entry has no invitation");
    written.invite = { outcome: done.invited, invitation: entry.invitation };
  }
  return { kind: "written", status: done.outcome === "added" ? 201 : 200, written };
}

/** Put a person on the list whose key nobody holds, or bring back the FORMER record
 *  that holds it. Shared by "Add member" and "put an app member on the list". */
async function placeOnList(
  tx: TransactionSql,
  input: { gymId: string; userId: string; at: Date; values: EntryValues; source: "typed" | "member"; revive: (stored: repo.StoredEntry) => EntryValues },
): Promise<Done> {
  const { gymId, values, at } = input;
  const key = identityKey(values);
  const holder = await repo.entryHolding(tx, gymId, key);
  if (holder !== null && !holder.former) return { outcome: "already_on_list", entryId: holder.id, version: await listVersion(tx, gymId) };

  let entryId: string;
  let written: EntryValues;
  if (holder === null) {
    written = values;
    entryId = await repo.insertEntry(tx, gymId, values, key, input.source);
  } else {
    const stored = await repo.entryFor(tx, gymId, holder.id);
    if (stored === null) throw new Error(`member-list entry ${holder.id} vanished under the gym's lock`);
    written = input.revive(stored);
    entryId = holder.id;
    await repo.writeEntry(tx, gymId, entryId, { values: written, identityKey: key, handEdited: stored.handEdited, formerAt: null });
  }
  await repo.stampListedByContact(tx, gymId, currentContacts({ values: written, current: true }), [entryId], at);
  const version = await repo.bumpListVersion(tx, gymId);
  await insertAudit(tx, {
    actorUserId: input.userId,
    gymId,
    action: "org.member_list_entry_added",
    targetType: "member_list_entry",
    targetId: entryId,
    meta: { source: input.source, ...(holder === null ? {} : { revived: "true" }) },
  });
  return { outcome: holder === null ? "added" : "revived", entryId, version };
}

/** "Add member" (§11.6), and "Add and invite" (§9.12) when `input.invite` is set: both
 *  in one transaction, so a person who cannot be invited is not added either and the
 *  answer says why. */
export async function addEntry(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  input: MemberListEntryInput,
  limit: () => Promise<boolean>,
): Promise<WriteAnswer> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  const settings = input.invite === true ? await readyToSend(deps, gymId) : null;
  if (!(await limit())) return { kind: "rate_limited" };
  const at = deps.now();
  const done = await deps.sql.begin(async (tx) => {
    await repo.lockGym(tx, gymId);
    const context = await typedContext(tx, gymId, org.country);
    const applied = applyTyped(EMPTY_VALUES, input, context);
    if (!applied.ok) throw new OrgsError(400, applied.refusal.code, applied.refusal.message);
    const placed = await placeOnList(tx, {
      gymId,
      userId,
      at,
      values: applied.values,
      source: "typed",
      // A former record coming back takes what staff typed on top of what it held.
      revive: (stored) => {
        const again = applyTyped(stored.values, input, context);
        if (!again.ok) throw new OrgsError(400, again.refusal.code, again.refusal.message);
        return again.values;
      },
    });
    // Somebody already on the list is shown, not invited: the screen offers Invite on
    // that record.
    if (settings === null || placed.outcome === "already_on_list") return placed;
    const invited = await inviteEntryInTx(tx, settings, { gymId, entryId: placed.entryId, userId, at });
    return { ...placed, invited: invited.outcome };
  });
  return await finish(deps, gymId, done);
}

/** A lead who joined (ROADMAP 20c-i), inside the caller's transaction and under the
 *  gym's lock. `entryId` is the record staff or the join rule said is this person: kept
 *  as it is, or put back when it was taken off. Null makes a NEW record from the lead's
 *  details: a record already holding exactly those details is never linked or put back
 *  in its place (staff said none of the records shown is this person), and `held`
 *  names it. */
export async function placeLeadInTx(
  tx: TransactionSql,
  input: {
    gymId: string;
    userId: string;
    at: Date;
    country: string | null;
    entryId: string | null;
    lead: { fullName: string; email: string | null; phone: string | null };
  },
): Promise<{ outcome: "linked" | "added" | "restored" | "held"; entryId: string }> {
  const { gymId, userId, at } = input;
  if (input.entryId !== null) {
    const stored = await repo.entryFor(tx, gymId, input.entryId);
    if (stored === null) throw notFound();
    if (stored.formerAt === null) return { outcome: "linked", entryId: stored.id };
    await setOnListIn(tx, { invites: null }, { userId, gymId, entryId: stored.id, on: true, at });
    return { outcome: "restored", entryId: stored.id };
  }
  const typed: MemberListEntryInput = { fullName: input.lead.fullName };
  if (input.lead.email !== null) typed.email = input.lead.email;
  if (input.lead.phone !== null) typed.phone = input.lead.phone;
  const context = await typedContext(tx, gymId, input.country);
  const applied = applyTyped(EMPTY_VALUES, typed, context);
  if (!applied.ok) throw new OrgsError(400, applied.refusal.code, applied.refusal.message);
  const holder = await repo.entryHolding(tx, gymId, identityKey(applied.values));
  if (holder !== null) return { outcome: "held", entryId: holder.id };
  const placed = await placeOnList(tx, {
    gymId,
    userId,
    at,
    values: applied.values,
    source: "typed",
    revive: () => {
      throw new Error("a lead's new record found a holder after the check under the same lock");
    },
  });
  if (placed.outcome !== "added") throw new Error(`a lead's new record answered ${placed.outcome}`);
  return { outcome: "added", entryId: placed.entryId };
}

/** Change one person (§11.6). Fields staff change are remembered by NAME, so a later
 *  upload asks before it writes over them (§11.4). */
export async function changeEntry(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  patch: MemberListEntryPatch,
  limit: () => Promise<boolean>,
): Promise<WriteAnswer> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  const at = deps.now();
  const done = await guarded(() => deps.sql.begin(async (tx): Promise<Done | { clash: string; former: boolean }> => {
    await repo.lockGym(tx, gymId);
    const stored = await repo.entryFor(tx, gymId, entryId);
    if (stored === null) throw notFound();
    const applied = applyTyped(stored.values, patch, await typedContext(tx, gymId, org.country));
    if (!applied.ok) throw new OrgsError(400, applied.refusal.code, applied.refusal.message);
    if (applied.edited.length === 0 && applied.identityFields.length === 0) {
      return { outcome: "unchanged", entryId, version: await listVersion(tx, gymId) };
    }
    const key = identityKey(applied.values);
    if (key !== stored.identityKey) {
      const holder = await repo.entryHolding(tx, gymId, key);
      if (holder !== null && holder.id !== entryId) return { clash: holder.id, former: holder.former };
    }
    // Only the email and the phone decide who a record reaches (§9.7).
    const contactMoved = applied.identityFields.includes("email") || applied.identityFields.includes("phone");
    const reached = contactMoved ? await membersOf(tx, gymId, stored) : [];
    const handEdited = [...new Set([...stored.handEdited, ...applied.edited])].slice(0, MEMBER_LIST_MAX_EDITED_FIELDS);
    await repo.writeEntry(tx, gymId, entryId, { values: applied.values, identityKey: key, handEdited, formerAt: stored.formerAt });
    const lost = await leftOff(tx, gymId, stored.values, [entryId], reached);
    if (lost > 0 && patch.acknowledgeLeavesList !== true) throw new LeavesList(lost, "change");
    const current = stored.formerAt === null;
    await repo.stampListedByContact(
      tx,
      gymId,
      currentContacts({ values: stored.values, current }, { values: applied.values, current }),
      current ? [entryId] : [],
      at,
    );
    const version = await repo.bumpListVersion(tx, gymId);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_entry_changed",
      targetType: "member_list_entry",
      targetId: entryId,
      meta: { fields: [...applied.identityFields, ...applied.edited], ...(lost > 0 ? { leftOffList: String(lost) } : {}) },
    });
    return { outcome: "changed", entryId, version };
  }));
  if ("kind" in done) return done;
  if ("clash" in done) return { kind: "already_on_list", entryId: done.clash, former: done.former };
  return await finish(deps, gymId, done);
}

/** Take a person off the list: their record becomes FORMER, never deleted (§11.1). */
export async function takeOff(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  limit: () => Promise<boolean>,
): Promise<WriteAnswer> {
  return await setOnList(deps, userId, gymId, entryId, false, limit);
}

/** Put a former record back on the list. */
export async function restore(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  limit: () => Promise<boolean>,
): Promise<WriteAnswer> {
  return await setOnList(deps, userId, gymId, entryId, true, limit);
}

async function setOnList(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  on: boolean,
  limit: () => Promise<boolean>,
): Promise<WriteAnswer> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  const at = deps.now();
  const done = await deps.sql.begin(async (tx): Promise<Done> => {
    await repo.lockGym(tx, gymId);
    return await setOnListIn(tx, deps, { userId, gymId, entryId, on, at });
  });
  return await finish(deps, gymId, done);
}

/** `setOnList`'s work, inside the caller's transaction and under its lock. */
async function setOnListIn(
  tx: TransactionSql,
  deps: Pick<MemberListDeps, "invites">,
  input: { userId: string; gymId: string; entryId: string; on: boolean; at: Date },
): Promise<Done> {
  const { userId, gymId, entryId, on, at } = input;
  const stored = await repo.entryFor(tx, gymId, entryId);
  if (stored === null) throw notFound();
  const moved = await repo.setEntryFormer(tx, gymId, entryId, on ? null : at);
  if (!moved) return { outcome: on ? "already_on_list" : "already_taken_off", entryId, version: await listVersion(tx, gymId) };
  // The members this record reached were on the list (taking off) or are now
  // (putting back); either way they have been listed.
  await repo.stampListedByContact(tx, gymId, currentContacts({ values: stored.values, current: true }), [entryId], at);
  // Taken off by staff: signing in with the address must not let them in, even if a
  // later upload holds them again, until staff send the invitation again (§10.2).
  // Putting back re-opens nothing.
  if (!on) await withdrawForAddress(tx, deps.invites ?? null, { gymId, email: stored.values.email, at });
  const version = await repo.bumpListVersion(tx, gymId);
  await insertAudit(tx, {
    actorUserId: userId,
    gymId,
    action: on ? "org.member_list_entry_restored" : "org.member_list_entry_taken_off",
    targetType: "member_list_entry",
    targetId: entryId,
    meta: {},
  });
  return { outcome: on ? "restored" : "taken_off", entryId, version };
}

/** Delete a FORMER record for good (§11.1). A current one has to be taken off first. */
export async function deleteFormer(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  entryId: string,
  limit: () => Promise<boolean>,
): Promise<MemberListEntryDeleted | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  return await deps.sql.begin(async (tx) => {
    await repo.lockGym(tx, gymId);
    const stored = await repo.entryFor(tx, gymId, entryId);
    if (stored === null) throw notFound();
    if (stored.formerAt === null) throw new OrgsError(409, "not_former", MEMBER_LIST_BY_HAND_WORDS.not_former);
    await repo.deleteEntry(tx, gymId, entryId);
    const version = await repo.bumpListVersion(tx, gymId);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_entry_deleted",
      targetType: "member_list_entry",
      targetId: entryId,
      meta: {},
    });
    return { deleted: true as const, version };
  });
}

/** Join two records of one person (PushPress's way): `goneId` is the record NOT
 *  kept, `keepId` the one that stays. The kept record keeps its own values and fills
 *  only its empty ones from the other; it is on the list if either was. */
export async function mergeEntries(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  goneId: string,
  keepId: string,
  acknowledgeLeavesList: boolean,
  limit: () => Promise<boolean>,
): Promise<WriteAnswer> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (goneId === keepId) throw new OrgsError(400, "merge_same", MEMBER_LIST_BY_HAND_WORDS.merge_same);
  if (!(await limit())) return { kind: "rate_limited" };
  const at = deps.now();
  const done = await guarded(() => deps.sql.begin(async (tx): Promise<Done> => {
    await repo.lockGym(tx, gymId);
    const [gone, keep] = await Promise.all([repo.entryFor(tx, gymId, goneId), repo.entryFor(tx, gymId, keepId)]);
    if (gone === null || keep === null) throw notFound();
    // The kept record keeps its own address and phone, so a member only the other
    // record reaches would be left off the list; asked after the write, below.
    const reached = await membersOf(tx, gymId, gone);
    const { values, filled } = mergeValues(keep.values, gone.values);
    const current = keep.formerAt === null || gone.formerAt === null;
    await repo.writeEntry(tx, gymId, keepId, {
      values,
      identityKey: keep.identityKey,
      handEdited: keep.handEdited,
      formerAt: current ? null : keep.formerAt,
    });
    // What points at the record not kept moves onto the kept one before it is deleted
    // (the reference test lists every table that does).
    await repo.moveMembershipLinks(tx, gymId, goneId, keepId);
    await repo.moveLeadLinks(tx, gymId, goneId, keepId);
    await repo.deleteEntry(tx, gymId, goneId);
    const lost = await leftOff(tx, gymId, gone.values, [keepId], reached);
    if (lost > 0 && !acknowledgeLeavesList) throw new LeavesList(lost, "merge");
    await repo.stampListedByContact(
      tx,
      gymId,
      currentContacts({ values: gone.values, current: gone.formerAt === null }, { values, current }),
      current ? [keepId] : [],
      at,
    );
    const version = await repo.bumpListVersion(tx, gymId);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_entries_merged",
      targetType: "member_list_entry",
      targetId: keepId,
      meta: { mergedEntryId: goneId, filled, ...(lost > 0 ? { leftOffList: String(lost) } : {}) },
    });
    return { outcome: "merged", entryId: keepId, version };
  }));
  if ("kind" in done) return done;
  return await finish(deps, gymId, done);
}

/** Put one of the gym's app members on the list from their membership: their name,
 *  proved email and the phone they gave (§9.9). */
export async function putMemberOnList(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  memberUserId: string,
  limit: () => Promise<boolean>,
): Promise<WriteAnswer> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  const at = deps.now();
  const done = await deps.sql.begin(async (tx): Promise<Done> => {
    await repo.lockGym(tx, gymId);
    const contact = await repo.memberContact(tx, gymId, memberUserId);
    if (contact === null) throw new OrgsError(404, "member_not_found", MEMBER_LIST_BY_HAND_WORDS.member_not_found);
    if (contact.email === null && contact.phone === null) {
      throw new OrgsError(409, "no_contact", MEMBER_LIST_BY_HAND_WORDS.no_contact);
    }
    // Already reached by a current record: they are on the list, under that record.
    const reached = await repo.membersAgainstList(tx, gymId, { email: contact.email, phone: contact.phone });
    const self = reached.find((member) => member.userId === memberUserId);
    if (self !== undefined && self.entryId !== null) {
      return { outcome: "already_on_list", entryId: self.entryId, version: await listVersion(tx, gymId) };
    }
    // Joined with a record the gym has since taken off: that record is theirs, so it
    // comes back. A new one beside it would leave them off the list (3a-vi-b).
    if (self !== undefined && self.joinedEntryId !== null) {
      return await setOnListIn(tx, deps, { userId, gymId, entryId: self.joinedEntryId, on: true, at });
    }
    const values: EntryValues = {
      ...EMPTY_VALUES,
      fullName: cut(withoutCardNumbers(tidyCell(contact.displayName)).text, MEMBER_LIST_MAX_NAME_CHARS),
      email: contact.email,
      phone: contact.phone,
    };
    // A former record with these very details is the same person coming back; it
    // keeps what it holds.
    return await placeOnList(tx, { gymId, userId, at, values, source: "member", revive: (stored) => stored.values });
  });
  return await finish(deps, gymId, done);
}

// ── "Remove all" (§9.8, §9.9) ───────────────────────────────────────────────

const cursorSchema = z.string().uuid();

/** The members "Remove all" would remove, a page at a time, with the numbers the
 *  removal must send back. */
export async function readUnlisted(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  query: MemberListUnlistedQuery,
  limit: () => Promise<boolean>,
): Promise<MemberListUnlistedPage | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const [state, members] = await Promise.all([repo.listState(deps.sql, gymId), repo.membersAgainstList(deps.sql, gymId)]);
  // The cursor is the last person shown. Their name is read afresh, so a page resumes
  // after them in the group's order; one who has left since is a stale page.
  let cursor: { name: string; id: string } | null = null;
  if (query.cursor !== undefined) {
    const id = cursorSchema.safeParse(query.cursor);
    const last = id.success ? members.find((member) => member.userId === id.data) : undefined;
    if (last === undefined) throw new OrgsError(400, "bad_cursor", "That page of names could not be read. Open the list again.");
    cursor = { name: last.fullName, id: last.userId };
  }
  const people = unlistedGroup(members, state !== null, query.group);
  const page = unlistedPage(people, cursor, MEMBER_LIST_ENTRIES_PAGE);
  return {
    group: query.group,
    version: state?.version ?? 0,
    total: people.length,
    digest: unlistedDigest(gymId, query.group, people.map((person) => person.userId)),
    people: page.shown.map((person) => ({
      userId: person.userId,
      displayName: person.fullName,
      email: person.email,
      joinedAt: person.joinedAt.toISOString(),
    })),
    cursor: page.last?.userId ?? null,
  };
}

/** How long the same press, sent again, is recognised as one already applied. */
const REMOVAL_REPLAY_MS = 24 * 60 * 60 * 1000;

export type RemoveAnswer =
  | { kind: "removed"; group: MemberListUnlistedGroup; removed: number; alreadyRemoved: boolean }
  | { kind: "list_changed"; version: number; total: number; digest: string }
  | { kind: "large_change"; removing: number; of: number }
  | { kind: "rate_limited" };

/** "Remove all": every member of the group taken out of the gym in one call, as a
 *  single removal does it — the membership closed, an audit row each, their gym
 *  perks dropped at once. Refused unless the group is still exactly the one the page
 *  showed; a large removal needs the tick on this request. */
export async function removeUnlisted(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  input: MemberListRemoveUnlistedRequest,
  limit: () => Promise<boolean>,
): Promise<RemoveAnswer> {
  await requireWritablePrivilege(deps, gymId, userId, "members.remove");
  // It acts on the list's marks, so it needs the list's own tick as well.
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  const at = deps.now();
  const removedUsers: string[] = [];
  const answer = await deps.sql.begin(async (tx): Promise<RemoveAnswer> => {
    await repo.lockGym(tx, gymId);
    const [state, members] = await Promise.all([repo.listState(tx, gymId), repo.membersAgainstList(tx, gymId)]);
    const version = state?.version ?? 0;
    const people = unlistedGroup(members, state !== null, input.group);
    const ids = people.map((person) => person.userId);
    const digest = unlistedDigest(gymId, input.group, ids);
    if (version !== input.version || ids.length !== input.expectedCount || digest !== input.digest) {
      // The same press again (a retry, or the second of two staff): the set shown is gone
      // because that press removed it, so say so rather than "nobody was removed". Only
      // when the set really moved: the same set with a moved version is a list_changed.
      if (digest !== input.digest) {
        const earlier = await repo.unlistedRemovalByDigest(tx, gymId, input.group, input.digest, new Date(at.getTime() - REMOVAL_REPLAY_MS));
        if (earlier !== null) return { kind: "removed", group: input.group, removed: earlier, alreadyRemoved: true };
      }
      return { kind: "list_changed", version, total: ids.length, digest };
    }
    const seats = members.filter((member) => member.seatCounted).length;
    if (isLargeMemberListChange(ids.length, seats) && input.acknowledgeLargeChange !== true) {
      return { kind: "large_change", removing: ids.length, of: seats };
    }
    const closed = await repo.closeMemberships(tx, gymId, ids, at);
    // Under the gym's lock the set cannot move between the rule and the write, so a
    // difference is a fault of ours and nothing is committed.
    if (closed.length !== ids.length) {
      throw new Error(`remove-unlisted closed ${String(closed.length)} memberships where the rule chose ${String(ids.length)}`);
    }
    await repo.insertRemovalAudits(tx, { actorUserId: userId, gymId, group: input.group, removed: closed });
    await withdrawForAccounts(tx, deps.invites ?? null, { gymId, userIds: closed.map((row) => row.userId), at });
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_list_unlisted_removed",
      targetType: "member_list",
      targetId: gymId,
      // The digest names the set, which is how the same press sent again is recognised.
      meta: { group: input.group, removed: String(closed.length), version: String(version), digest },
    });
    removedUsers.push(...closed.map((row) => row.userId));
    return { kind: "removed", group: input.group, removed: closed.length, alreadyRemoved: false };
  });

  if (answer.kind === "removed" && !answer.alreadyRemoved && removedUsers.length > 0) {
    // After the commit, as a single removal does. A failed bust leaves the cached
    // answer to expire on its own (60 s), so it is warned about, never raised.
    const results = await Promise.allSettled(removedUsers.map((member) => bustEntitlements(deps.redis, member)));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) {
      deps.log.warn({ event: "memberlist.unlisted_bust_failed", gymId, failed }, "entitlements could not be refreshed after a removal");
    }
  }
  return answer;
}
