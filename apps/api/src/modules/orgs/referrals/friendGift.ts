// Refer a friend's friend's gift, as staff are offered it (ROADMAP 20e-ii-b-i; spec Part 3
// §16.3): filled in on a person's Add membership and at Sell, for the friend it is for, with
// Remove. The rule is `friendGiftRepo.ts`'s; the write that gives it asks it again.
import { friendGiftSchema, referralGiftWords, type FriendGift } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import type { DiscountRow } from "../register/discountsRepo.js";
import { friendGiftsNow, giftToday } from "./friendGiftRepo.js";
import { invitersFor } from "./repo.js";

const isoDiscount = (d: DiscountRow) => ({ ...d, archivedAt: d.archivedAt === null ? null : d.archivedAt.toISOString(), updatedAt: d.updatedAt.toISOString() });

/** The gift to fill in for this record on the gym's `today`, or null where there is none. */
export async function friendGiftOffer(sql: Sql | TransactionSql, gymId: string, entryId: string, today: string): Promise<FriendGift | null> {
  // The day a gift was given is not read here, so no time zone is needed for it.
  const mine = (await friendGiftsNow(sql, { id: gymId, timezone: "UTC" }, [entryId], today)).get(entryId);
  if (mine === undefined || mine.discount === null) return null;
  const by = mine.row.referredBy;
  const inviter = by === null ? undefined : (await invitersFor(sql, gymId, [by])).get(by);
  return friendGiftSchema.parse({
    discount: isoDiscount(mine.discount),
    words: referralGiftWords({ ...mine.discount, archived: false }),
    invitedBy: inviter?.name ?? null,
  });
}

/** The gift a NEW member a member invited is given (Add member, before their record exists):
 *  null where the business has none that can be used today. */
export async function friendGiftForNewFriend(sql: Sql | TransactionSql, gymId: string, referredBy: string | null, today: string): Promise<FriendGift | null> {
  const gift = await giftToday(sql, gymId, today);
  if (gift === null) return null;
  const inviter = referredBy === null ? undefined : (await invitersFor(sql, gymId, [referredBy])).get(referredBy);
  return friendGiftSchema.parse({
    discount: isoDiscount(gift),
    words: referralGiftWords({ ...gift, archived: false }),
    invitedBy: inviter?.name ?? null,
  });
}
