// TIDYING UP MEMBERS WHOSE MEMBERSHIP IS OVER (ROADMAP 21c-iii; RULINGS 2026-10-11; spec
// Part 3 §16.9.6). A sign atop Members counts the current members whose last membership
// here has ended or been cancelled; it opens the list on only those people, and staff move
// them to Past members, renew them, or keep them on the list. Nothing is done by itself.
//
// Who the sign counts is who Reports counts as left among the people still on the list
// (`memberships/over.ts`), apart from anybody staff chose to keep: kept with the membership
// that was over then, so a later membership that ends is counted again.
import type { Sql, TransactionSql } from "postgres";
import type { MemberListKeepListedRequest, MemberListKeptListed } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import type { HeldShown, LeftWith } from "../memberships/onList.js";
import { heldAndOverIn, overNow } from "../memberships/over.js";
import { insertAudit } from "../repo.js";
import { requireWritablePrivilege } from "../service.js";
import * as repo from "./repo.js";
import { selectedIds } from "./selection.js";
import type { MemberListDeps } from "./service.js";

/** Of the people who are over, those the sign counts: everybody not kept on the list with
 *  this very membership. Pure. */
export function tidyIdsFrom(over: ReadonlyMap<string, LeftWith>, kept: ReadonlyMap<string, string>): string[] {
  return [...over].flatMap(([id, left]) => (kept.get(id) === left.heldId ? [] : [id]));
}

/** The list's rows for every current record, and the people the sign counts, read at one
 *  moment. `today` is the gym's own day. */
export async function heldAndTidyOf(sql: Sql, gymId: string, today: string): Promise<{ held: Map<string, HeldShown>; tidy: string[] }> {
  return await sql.begin("isolation level repeatable read read only", async (tx) => {
    const { held, over } = await heldAndOverIn(tx, gymId, today, null);
    return { held, tidy: over.size === 0 ? [] : tidyIdsFrom(over, await repo.keptListed(tx, gymId)) };
  });
}

/** The people the sign counts. */
export async function tidyIdsOf(sql: Sql | TransactionSql, gymId: string, today: string): Promise<string[]> {
  const over = await overNow(sql, gymId, today, null);
  return over.size === 0 ? [] : tidyIdsFrom(over, await repo.keptListed(sql, gymId));
}

/** "KEEP ON LIST" for the people selected. Under the gym's lock, each of them whose
 *  membership is over now is kept with that membership; anybody else selected is left as
 *  they are and counted in `notOver`. Pressed twice, the second press changes nothing.
 *  Null when the rate limit has answered. */
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
    const fresh = [...over].flatMap(([id, left]) => (had.get(id) === left.heldId ? [] : [{ id, heldId: left.heldId }]));
    const written = await repo.setKeptListed(tx, gymId, fresh);
    if (written.length !== fresh.length) {
      throw new Error(`keep-on-list wrote ${String(written.length)} records where the rule chose ${String(fresh.length)}`);
    }
    if (written.length > 0) {
      await insertAudit(tx, {
        actorUserId: userId,
        gymId,
        action: "org.member_list_kept_listed",
        targetType: "member_list",
        targetId: gymId,
        meta: { kept: String(written.length) },
      });
    }
    return { kept: written.length, notOver: ids.length - written.length };
  });
}
