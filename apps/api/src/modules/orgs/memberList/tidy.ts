// TIDYING UP MEMBERS WHOSE MEMBERSHIP IS OVER (ROADMAP 21c-iii; RULINGS 2026-10-11; spec
// Part 3 §16.9.6). A sign atop Members counts the current members whose last membership
// here has ended or been cancelled; it opens the list on only those people, and staff move
// them to Past members, renew them, or keep them on the list. Nothing is done by itself.
//
// Who the sign counts is who Reports counts as left among the people still on the list
// (`memberships/over.ts`), apart from two kinds of people. Anybody who still owes on a
// bill: staff settle or cancel it on their page first, so nobody who owes is swept away
// with the rest. And anybody staff chose to keep: kept with the membership that was over
// then, so a later membership that ends is counted again.
import type { Sql, TransactionSql } from "postgres";
import type { MemberListKeepListedRequest, MemberListKeptListed } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import type { HeldShown, LeftWith } from "../memberships/onList.js";
import { heldAndOverIn, overNow } from "../memberships/over.js";
import { insertAudits } from "../repo.js";
import { requireWritablePrivilege } from "../service.js";
import * as repo from "./repo.js";
import { selectedIds } from "./selection.js";
import type { MemberListDeps } from "./service.js";

/** Whether the sign's list can hold this person at all: over, and owing nothing. */
export const canBeTidied = (left: LeftWith | undefined): left is LeftWith => left !== undefined && !left.owes;

/** Of the people who are over, those the sign counts: nobody who still owes, and nobody
 *  kept on the list with this very membership. Pure. */
export function tidyIdsFrom(over: ReadonlyMap<string, LeftWith>, kept: ReadonlyMap<string, string>): string[] {
  return [...over].flatMap(([id, left]) => (!canBeTidied(left) || kept.get(id) === left.heldId ? [] : [id]));
}

/** Of the people who are over, those left off the sign's list because they still owe: the
 *  people who come onto it once the bill is settled. Nobody kept on the list with this very
 *  membership is among them, since settling would not bring them back. Pure. */
export function owingIdsFrom(over: ReadonlyMap<string, LeftWith>, kept: ReadonlyMap<string, string>): string[] {
  return [...over].flatMap(([id, left]) => (left.owes && kept.get(id) !== left.heldId ? [id] : []));
}

/** The list's rows for every current record, the people the sign counts and the people
 *  left off it because they owe, read at one moment. `today` is the gym's own day. */
export async function heldAndTidyOf(sql: Sql, gymId: string, today: string): Promise<{ held: Map<string, HeldShown>; tidy: string[]; owing: string[] }> {
  return await sql.begin("isolation level repeatable read read only", async (tx) => {
    const { held, over } = await heldAndOverIn(tx, gymId, today, null);
    if (over.size === 0) return { held, tidy: [], owing: [] };
    const kept = await repo.keptListed(tx, gymId);
    return { held, tidy: tidyIdsFrom(over, kept), owing: owingIdsFrom(over, kept) };
  });
}

/** The people left off the sign's list because they still owe. */
export async function overOwingIdsOf(sql: Sql | TransactionSql, gymId: string, today: string): Promise<string[]> {
  const over = await overNow(sql, gymId, today, null);
  return over.size === 0 ? [] : owingIdsFrom(over, await repo.keptListed(sql, gymId));
}

/** The people the sign counts. */
export async function tidyIdsOf(sql: Sql | TransactionSql, gymId: string, today: string): Promise<string[]> {
  const over = await overNow(sql, gymId, today, null);
  return over.size === 0 ? [] : tidyIdsFrom(over, await repo.keptListed(sql, gymId));
}

/** "KEEP ON LIST" for the people selected. Under the gym's lock, each of them the sign's
 *  list can hold is kept with the membership that is over now. Somebody kept already is
 *  counted in `already`; anybody else selected (removed, given a membership, owing, another
 *  gym's) in `notOver`. Pressed twice, the second press changes nothing. Null when the
 *  rate limit has answered. */
export async function keepListed(
  deps: MemberListDeps,
  userId: string,
  gymId: string,
  request: MemberListKeepListedRequest,
  limit: () => Promise<boolean>,
): Promise<MemberListKeptListed | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection);
  const at = deps.now();
  const today = dayInTz(at, org.timezone);
  return await deps.sql.begin(async (tx) => {
    await repo.lockGym(tx, gymId);
    const over = await overNow(tx, gymId, today, ids);
    const had = await repo.keptListed(tx, gymId);
    const mine = [...over].filter(([, left]) => canBeTidied(left));
    const fresh = mine.flatMap(([id, left]) => (had.get(id) === left.heldId ? [] : [{ id, heldId: left.heldId }]));
    const already = mine.length - fresh.length;
    const written = await repo.setKeptListed(tx, gymId, fresh);
    if (written.length !== fresh.length) {
      throw new Error(`keep-on-list wrote ${String(written.length)} records where the rule chose ${String(fresh.length)}`);
    }
    // A row a record, as Remove writes: who took whom off the sign.
    await insertAudits(
      tx,
      written.map((id) => ({ actorUserId: userId, gymId, action: "org.member_list_entry_kept_listed", targetType: "member_list_entry", targetId: id, meta: {} })),
    );
    return { kept: written.length, already, notOver: ids.length - written.length - already };
  });
}
