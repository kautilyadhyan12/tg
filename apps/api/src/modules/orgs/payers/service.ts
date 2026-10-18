// WHO PAYS FOR A PERSON ON A GYM'S LIST (spec Part 3 §14.2; ROADMAP 18i).
//
// Reading it needs `members.confirm`, the tick the person's page itself needs: the desk
// sees who to ask for the money. Changing it needs `billing.members` through
// `requireWritablePrivilege`, as recording a payment does. Every write takes the gym's lock
// (the one a join of two records takes), so two staff linking at one instant cannot make a
// payer who is also paid for, or a payer of more than `PAYS_FOR_MAX`.
import type { Sql } from "postgres";
import {
  MEMBER_LIST_BY_HAND_WORDS,
  MEMBER_PAYER_WORDS,
  PAYS_FOR_MAX,
  memberPayersResponseSchema,
  type MemberPayersResponse,
} from "@app/shared";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { gymHasLivePlan, insertAudit } from "../repo.js";
import { lockGym } from "../memberList/repo.js";
import * as repo from "./repo.js";

export interface PayersDeps {
  sql: Sql;
}

const BILLING = "billing.members";
const notFound = (): OrgsError => new OrgsError(404, "entry_not_found", MEMBER_LIST_BY_HAND_WORDS.entry_not_found);

async function read(sql: Sql, gymId: string, entryId: string, canChange: boolean): Promise<MemberPayersResponse> {
  const [paidBy, paysFor, selfInApp] = await Promise.all([repo.payerOf(sql, gymId, entryId), repo.paidForBy(sql, gymId, entryId), repo.inApp(sql, gymId, entryId)]);
  return memberPayersResponseSchema.parse({ paidBy, paysFor, selfInApp, canChange });
}

export async function getPayers(deps: PayersDeps, userId: string, gymId: string, entryId: string): Promise<MemberPayersResponse> {
  const { privileges } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await repo.entryExists(deps.sql, gymId, entryId))) throw notFound();
  const canChange = privileges.includes(BILLING) && (await gymHasLivePlan(deps.sql, gymId));
  return await read(deps.sql, gymId, entryId, canChange);
}

export async function setPayer(deps: PayersDeps, userId: string, gymId: string, entryId: string, payerEntryId: string): Promise<MemberPayersResponse> {
  await requireWritablePrivilege(deps, gymId, userId, BILLING);
  if (entryId === payerEntryId) throw new OrgsError(400, "payer_self", MEMBER_PAYER_WORDS.payer_self);
  await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    if (!(await repo.entryExists(tx, gymId, entryId))) throw notFound();
    if (!(await repo.entryExists(tx, gymId, payerEntryId))) throw new OrgsError(404, "payer_not_found", MEMBER_PAYER_WORDS.payer_not_found);
    if ((await repo.payerOf(tx, gymId, payerEntryId)) !== null) throw new OrgsError(409, "payer_is_paid_for", MEMBER_PAYER_WORDS.payer_is_paid_for);
    if ((await repo.paysForCount(tx, gymId, entryId)) > 0) throw new OrgsError(409, "pays_for_others", MEMBER_PAYER_WORDS.pays_for_others);
    const before = await repo.payerOf(tx, gymId, entryId);
    // The same payer again changes nothing and writes no note.
    if (before?.entryId === payerEntryId) return;
    if ((await repo.paysForCount(tx, gymId, payerEntryId)) >= PAYS_FOR_MAX) throw new OrgsError(409, "pays_for_full", MEMBER_PAYER_WORDS.pays_for_full);
    await repo.setPayer(tx, gymId, entryId, payerEntryId, userId);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_payer_set",
      targetType: "member_list_entry",
      targetId: entryId,
      // Ids, never names: Staff activity looks the payer up as it is read, so a record deleted
      // for good is named by no note.
      meta: { payerEntryId, previousPayerEntryId: before?.entryId ?? null },
    });
  });
  return await read(deps.sql, gymId, entryId, true);
}

export async function removePayer(deps: PayersDeps, userId: string, gymId: string, entryId: string): Promise<MemberPayersResponse> {
  await requireWritablePrivilege(deps, gymId, userId, BILLING);
  await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    if (!(await repo.entryExists(tx, gymId, entryId))) throw notFound();
    const before = await repo.payerOf(tx, gymId, entryId);
    // Pressed twice, removed once.
    if (before === null || !(await repo.removePayer(tx, gymId, entryId))) return;
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.member_payer_removed",
      targetType: "member_list_entry",
      targetId: entryId,
      meta: { previousPayerEntryId: before.entryId },
    });
  });
  return await read(deps.sql, gymId, entryId, true);
}
