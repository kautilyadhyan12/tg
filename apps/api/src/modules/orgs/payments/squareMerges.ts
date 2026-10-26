// Square's merges followed (ROADMAP 18d-iii-b-ii-b-ii-a; spec Part 3 §14.8; rulings/2026-10-26-18d-iii-b-ii-b-ii-a.md).
//
// Square merges customers into a new one with a new id: the business in its Dashboard (Members in Square asks the
// owner to, where Square has two customers who could be one member), or Square by itself, which cannot be switched
// off (Square's developer forum). The old customers are deleted. Square's message about each (`customer.deleted`,
// kept since 18d-ii) is the doorbell; RetrieveCustomer of the old id, which answers the new customer ("If you call
// RetrieveCustomer using the ID of customer A or B, the Customers API returns customer C", Customers API, read
// 2026-10-26), is the fact. At each gym that holds the old customer: a card saved on it is charged as the new
// one's; the one record whose name is the new customer's keeps it; any other record linked to the old customer or
// the new one is separated from it and, where the gym added its members to Square, added again by itself (left
// out if it happens twice within 30 days, so the app and Square never take turns); what a check planned or read
// about the old customer is dropped. The old id is kept with the customer it is now, so a payment taken under it
// still finds its member ("detect customer merges and store the merged IDs", Square's "Duplicated customers").
//
// THE WORST THING is a merge of two people followed: Sam, added on his mum Pat's email, merged by Square into
// "Pat Smith" (a merge keeps the older customer's details), and moved onto her customer, so her payments at the
// till land on his page. A record keeps the merged customer only by the name (`followMerged`); the merged
// customer's reference id, one of the old customers', never makes it anybody's (`squareMadeByMerge`).
import { squareMadeByMerge, type SquareCustomer } from "@app/shared";
import { lockGym } from "../memberList/repo.js";
import { readCountry } from "../memberList/phone.js";
import * as repo from "./repo.js";
import type { PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import * as merges from "./squareMergesRepo.js";
import * as members from "./squareMembersRepo.js";
import { followMerged, squarePhone } from "./squareMembersPlan.js";

export const SQUARE_MERGES = {
  /** A record separated from a merged customer again within this long is left out, not added again. */
  separatedAgainMs: 30 * 24 * 60 * 60_000,
} as const;

export interface MergeFollowed {
  gymId: string;
  /** The record that keeps the merged customer, if one does. */
  kept: string | null;
  separated: string[];
  /** Separated a second time: left out. */
  leftOut: string[];
  cards: number;
}

/** Square answered `fromId` with another customer, `to`: the merge followed at every gym that holds the old one.
 *  Safe to run twice: each step reads what is there now, under the gym's lock. */
export async function followMerge(deps: PaymentsDeps, square: SquareSettings, accountId: string, fromId: string, to: SquareCustomer): Promise<MergeFollowed[]> {
  const environment = square.environment;
  const now = deps.now();
  await merges.rememberMerge(deps.sql, { environment, accountId, fromId, toId: to.id, at: now });
  const followed: MergeFollowed[] = [];
  for (const gymId of await merges.holdersOf(deps.sql, { environment, accountId, customerId: fromId })) {
    const gym = await repo.readGym(deps.sql, gymId);
    const country = readCountry(gym?.country ?? null);
    const done = await deps.sql.begin(async (tx) => {
      await lockGym(tx, gymId);
      const cards = await merges.moveCards(tx, { gymId, environment, accountId, fromId, toId: to.id });
      const records = await merges.linkedTo(tx, { gymId, environment, accountId, customerIds: [fromId, to.id] });
      const { keep, separate } = followMerged(records, { givenName: to.given_name ?? null, familyName: to.family_name ?? null });
      if (keep !== null) await merges.keepMerged(tx, { gymId, environment, accountId, entryId: keep, fromId, toId: to.id, now });
      await merges.unlink(tx, { gymId, environment, accountId, entryIds: separate, customerIds: [fromId, to.id], now });
      await members.forgetMergedCustomer(tx, {
        gymId,
        environment,
        fromId,
        to: {
          customerId: to.id,
          givenName: to.given_name ?? null,
          familyName: to.family_name ?? null,
          email: to.email_address ?? null,
          phone: squarePhone(to.phone_number, country),
          // One of the old customers' reference ids: it says nothing of whose the merged customer is.
          referenceId: squareMadeByMerge(to) ? null : (to.reference_id ?? null),
        },
      });
      const current = new Set(records.filter((r) => r.current).map((r) => r.entryId));
      const leftOut = await members.separateFromMerged(tx, {
        gymId,
        environment,
        entryIds: separate.filter((id) => current.has(id)),
        now,
        againSince: new Date(now.getTime() - SQUARE_MERGES.separatedAgainMs),
      });
      return { gymId, kept: keep, separated: separate, leftOut, cards };
    });
    deps.log.info(
      { event: "square.customer_merge_followed", gymId, kept: done.kept !== null, separated: done.separated.length, leftOut: done.leftOut.length, cards: done.cards },
      "a merge in Square was followed",
    );
    deps.news?.tell(gymId, { what: "squareMembers" });
    followed.push(done);
  }
  return followed;
}
