// Square's merges followed (ROADMAP 18d-iii-b-ii-b-ii-a; spec Part 3 §14.8; rulings/2026-10-26-18d-iii-b-ii-b-ii-a.md).
//
// Square merges customers into a new one with a new id: the business in its Dashboard, or Square by itself, which
// cannot be switched off (Square's developer forum). The old customers are deleted. Square's message about each
// (`customer.deleted`, kept since 18d-ii) is the doorbell; RetrieveCustomer of the old id, which answers the new
// customer ("If you call RetrieveCustomer using the ID of customer A or B, the Customers API returns customer C",
// Customers API, read 2026-10-26), is the fact. At each gym that holds the old customer: a card saved on it is
// charged as the new one's; the one record whose name is the new customer's keeps it; any other record linked to
// the old customer or the new one is separated from it, and a card of theirs saved there no longer says whose the
// customer is.
//
// THE WORST THING is a merge of two people followed: Sam, whose card was saved on his mum Pat's email, merged by
// Square into "Pat Smith" (a merge keeps the older customer's details), and moved onto her customer. A record keeps
// the merged customer only by the name (`followMerged`).
import type { SquareCustomer } from "@app/shared";
import { lockGym } from "../memberList/repo.js";
import type { PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import * as merges from "./squareMergesRepo.js";
import { followMerged } from "./squareMembersPlan.js";

export interface MergeFollowed {
  gymId: string;
  /** The record that keeps the merged customer, if one does. */
  kept: string | null;
  separated: string[];
  cards: number;
}

/** Square answered `fromId` with another customer, `to`: the merge followed at every gym that holds the old one.
 *  Safe to run twice: each step reads what is there now, under the gym's lock. */
export async function followMerge(deps: PaymentsDeps, square: SquareSettings, accountId: string, fromId: string, to: SquareCustomer): Promise<MergeFollowed[]> {
  const environment = square.environment;
  const now = deps.now();
  const followed: MergeFollowed[] = [];
  for (const gymId of await merges.holdersOf(deps.sql, { environment, accountId, customerId: fromId })) {
    const done = await deps.sql.begin(async (tx) => {
      await lockGym(tx, gymId);
      const cards = await merges.moveCards(tx, { gymId, environment, accountId, fromId, toId: to.id });
      const records = await merges.linkedTo(tx, { gymId, environment, accountId, customerIds: [fromId, to.id] });
      const { keep, separate } = followMerged(records, { givenName: to.given_name ?? null, familyName: to.family_name ?? null });
      if (keep !== null) await merges.keepMerged(tx, { gymId, environment, accountId, entryId: keep, fromId, toId: to.id, now });
      await merges.unlink(tx, { gymId, environment, accountId, entryIds: separate, customerIds: [fromId, to.id], now });
      return { gymId, kept: keep, separated: separate, cards };
    });
    deps.log.info(
      { event: "square.customer_merge_followed", gymId, kept: done.kept !== null, separated: done.separated.length, cards: done.cards },
      "a merge in Square was followed",
    );
    followed.push(done);
  }
  return followed;
}
