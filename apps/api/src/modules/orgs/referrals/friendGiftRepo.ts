// Refer a friend's friend's gift in the database (ROADMAP 20e-ii-b-i; spec Part 3 §16.3).
//
// The worst thing this could do to a real person: give the gift to somebody nobody invited,
// or give it twice. So a record is an invited friend only through a lead of the SAME gym that
// came by a member's link and was joined to that record; the gift is given once, on a
// membership or a desk sale that still stands; and somebody already on Members before they
// were invited (with a membership or without) is not offered it. Every statement names its gym.
import type { Sql, TransactionSql } from "postgres";
import { friendGiftState, referralGiftLive, referralGiftWords, type LeadFriendGift } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { referralDiscounts, type DiscountRow } from "../register/discountsRepo.js";
import { settingsFor } from "./repo.js";

type SqlOrTx = Sql | TransactionSql;

export interface FriendGiftRow {
  entryId: string;
  /** The lead that joined them (the earliest, where two were joined to one record). */
  leadId: string;
  /** The member who invited them; null where that account is gone. */
  referredBy: string | null;
  /** On Members, or holding a membership, before they were invited. */
  memberBefore: boolean;
  /** What the gift was given on, first; null while it has not been. */
  given: { on: string; at: Date } | null;
  /** The first membership the business's gift as it is now could have gone on, added since
   *  the invite and since the gift was last changed, without it: its type, when, and the staff
   *  who added it (null where their account is gone, or nobody is on record). A free one, one
   *  the gift is not for, or one it would take everything or nothing off is never counted. */
  skipped: { on: string; at: Date; by: string | null } | null;
}

interface DbRow {
  entry_id: string;
  lead_id: string;
  referred_by: string | null;
  member_before: boolean;
  given_on: string | null;
  given_at: Date | null;
  skipped_on: string | null;
  skipped_at: Date | null;
  skipped_by: string | null;
}

/** The records among `entryIds` that a lead of this gym joined after coming by a member's
 *  invite link (the earliest such lead, where two were joined to one record). */
export async function friendGiftRows(sql: SqlOrTx, gymId: string, entryIds: readonly string[]): Promise<FriendGiftRow[]> {
  if (entryIds.length === 0) return [];
  const rows = await sql<DbRow[]>`
    SELECT DISTINCT ON (l.entry_id)
           l.entry_id, l.id AS lead_id, l.referred_by,
           (EXISTS (
              SELECT 1 FROM gym_member_list_entries e
              WHERE e.gym_id = l.gym_id AND e.id = l.entry_id AND e.created_at < l.referred_at
            ) OR EXISTS (
              SELECT 1 FROM gym_held_memberships h
              WHERE h.gym_id = l.gym_id AND h.entry_id = l.entry_id AND h.created_at < l.referred_at
            )) AS member_before,
           given.on_what AS given_on, given.at AS given_at,
           skipped.on_what AS skipped_on, skipped.at AS skipped_at, skipped.by AS skipped_by
    FROM gym_leads l
    LEFT JOIN LATERAL (
      -- Who added it is the gym's own record of the membership being given.
      SELECT t.name AS on_what, h.created_at AS at,
             (SELECT u.display_name FROM audit_log a JOIN users u ON u.id = a.actor_user_id AND u.status = 'active'
              WHERE a.gym_id = h.gym_id AND a.action = 'org.held_membership_given' AND a.target_id = h.id::text
              ORDER BY a.at LIMIT 1) AS by
      FROM gym_held_memberships h
      JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
      JOIN gyms gy ON gy.id = h.gym_id
      JOIN gym_referral_settings s ON s.gym_id = h.gym_id
      JOIN gym_discounts g ON g.gym_id = s.gym_id AND g.id = s.friend_discount_id AND g.for_memberships
      WHERE h.gym_id = l.gym_id AND h.entry_id = l.entry_id
        AND h.created_at >= l.referred_at AND h.created_at >= g.updated_at
        AND NOT EXISTS (SELECT 1 FROM gym_discounts d WHERE d.gym_id = h.gym_id AND d.id = h.discount_id AND d.referral_gift)
        -- Only one the gift could have gone on that day: paid, of a type it is for, and not
        -- taking everything off (an amount as large as the price).
        AND h.price_minor + CASE WHEN h.discount_payments = 'every' THEN h.discount_minor ELSE 0 END > 0
        AND (g.all_membership_types OR EXISTS (
              SELECT 1 FROM gym_discount_membership_types m
              WHERE m.gym_id = g.gym_id AND m.discount_id = g.id AND m.membership_type_id = h.membership_type_id))
        AND (g.kind = 'percent' OR (g.currency = h.currency
              AND g.amount_minor < h.price_minor + CASE WHEN h.discount_payments = 'every' THEN h.discount_minor ELSE 0 END))
        AND (g.starts_on IS NULL OR g.starts_on <= (h.created_at AT TIME ZONE gy.timezone)::date)
        AND (g.ends_on IS NULL OR g.ends_on >= (h.created_at AT TIME ZONE gy.timezone)::date)
      ORDER BY h.created_at, h.id LIMIT 1
    ) skipped ON true
    LEFT JOIN LATERAL (
      SELECT x.on_what, x.at FROM (
        SELECT t.name AS on_what, h.created_at AS at
        FROM gym_held_memberships h
        JOIN gym_discounts d ON d.gym_id = h.gym_id AND d.id = h.discount_id AND d.referral_gift
        JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
        WHERE h.gym_id = l.gym_id AND h.entry_id = l.entry_id
        UNION ALL
        SELECT s.item_name, s.created_at
        FROM gym_sales s
        JOIN gym_discounts d ON d.gym_id = s.gym_id AND d.id = s.discount_id AND d.referral_gift
        WHERE s.gym_id = l.gym_id AND s.entry_id = l.entry_id AND s.undone_at IS NULL
      ) x
      ORDER BY x.at LIMIT 1
    ) given ON true
    WHERE l.gym_id = ${gymId} AND l.entry_id = ANY(${[...new Set(entryIds)]}::uuid[])
      AND l.status = 'joined' AND l.referred_at IS NOT NULL
    ORDER BY l.entry_id, l.referred_at, l.id`;
  return rows.map((r) => ({
    entryId: r.entry_id,
    leadId: r.lead_id,
    referredBy: r.referred_by,
    memberBefore: r.member_before,
    given: r.given_on === null || r.given_at === null ? null : { on: r.given_on, at: r.given_at },
    skipped: r.skipped_on === null || r.skipped_at === null ? null : { on: r.skipped_on, at: r.skipped_at, by: r.skipped_by },
  }));
}

export interface FriendGiftNow {
  row: FriendGiftRow;
  state: LeadFriendGift;
  /** The gift to fill in, where `state` is `to_give`; null otherwise. */
  discount: DiscountRow | null;
}

/** The business's friend's gift, where it can be used today. */
export async function giftToday(sql: SqlOrTx, gymId: string, today: string): Promise<DiscountRow | null> {
  const { friendDiscountId } = await settingsFor(sql, gymId);
  if (friendDiscountId === null) return null;
  const [d] = await referralDiscounts(sql, gymId, [friendDiscountId]);
  if (d === undefined || !d.referralGift) return null;
  return referralGiftLive({ ...d, archived: d.archivedAt !== null }, today) ? d : null;
}

/** Each invited friend among `entryIds`, with their gift as it stands on the gym's `today`.
 *  A record nobody invited is not in the map. */
export async function friendGiftsNow(
  sql: SqlOrTx,
  gym: { id: string; timezone: string },
  entryIds: readonly string[],
  today: string,
): Promise<Map<string, FriendGiftNow>> {
  const rows = await friendGiftRows(sql, gym.id, entryIds);
  if (rows.length === 0) return new Map();
  const gift = await giftToday(sql, gym.id, today);
  return new Map(
    rows.map((row) => {
      const state = friendGiftState({
        memberBefore: row.memberBefore,
        given: row.given === null ? null : { on: row.given.on, day: dayInTz(row.given.at, gym.timezone) },
        skipped: row.skipped === null ? null : { on: row.skipped.on, day: dayInTz(row.skipped.at, gym.timezone), by: row.skipped.by },
        gift: gift === null ? null : { forMemberships: gift.forMemberships, forProducts: gift.forProducts, words: referralGiftWords({ ...gift, archived: false }) },
      });
      return [row.entryId, { row, state, discount: state.state === "to_give" ? gift : null }];
    }),
  );
}

/** Whether `discountId` may be given to this record now: it is the business's friend's gift
 *  as it is today, and the record is an invited friend who has not had it. Asked inside the
 *  write's own transaction, under the record's lock, so two staff giving it at one instant
 *  give it once. */
export async function friendGiftOpen(tx: TransactionSql, gymId: string, entryId: string, discountId: string, today: string): Promise<boolean> {
  const now = await friendGiftsNow(tx, { id: gymId, timezone: "UTC" }, [entryId], today);
  const mine = now.get(entryId);
  return mine !== undefined && mine.discount !== null && mine.discount.id === discountId;
}
