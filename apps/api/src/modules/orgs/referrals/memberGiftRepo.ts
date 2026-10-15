// Refer a friend's member's gift in the database (ROADMAP 20e-ii-b-ii-a; spec Part 3 §16.3).
//
// The worst thing this could do to a real person: take money off somebody else's bill, or
// give the gift twice. So a gift is given only inside the write that records the friend's
// payment or sale, under the gym's lock; only for a friend `friendGiftRows` names (a lead of
// THIS gym that came by a member's link and was joined to that record, who was not on
// Members before); only to the member whose link it was, while they are still a member and
// the offer is on; and once a friend (a unique index). It is taken off a bill or a sale only
// of the record that member's own account holds today. Every statement names its gym.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import {
  DISCOUNT_KINDS,
  GYM_MESSAGE_KEPT_DAYS,
  GYM_REFERRAL_GIFT_MESSAGE_KIND,
  memberGiftMessage,
  memberGiftOff,
  memberGiftSchema,
  memberGiftWords,
  type LeadMemberGift,
  type MemberGift,
  type MemberGiftTerms,
} from "@app/shared";
import { billOf } from "../memberships/billsSql.js";
import { insertMessages } from "../messages/repo.js";
import { insertAudit, insertAudits } from "../repo.js";
import { friendGiftRows } from "./friendGiftRepo.js";
import { settingsFor } from "./repo.js";

type SqlOrTx = Sql | TransactionSql;

/** What paid: one of the friend's membership payments, or one of their sales at the desk. */
export type GiftBy = { paymentId: string } | { saleId: string };

interface RawTerms {
  kind: string;
  percent_bp: number | null;
  amount_minor: number | null;
  currency: string | null;
}

const kindSchema = z.enum(DISCOUNT_KINDS);
// Text under a CHECK: parsed, so a kind this build does not know fails here.
const terms = (r: RawTerms): MemberGiftTerms => ({ kind: kindSchema.parse(r.kind), percentBp: r.percent_bp, amountMinor: r.amount_minor, currency: r.currency });

/** GIVES THE MEMBER'S GIFT for the friend whose payment or sale was just recorded, where
 *  everything the gift asks for holds; else nothing. Inside that write's own transaction,
 *  under the gym's lock. The member is told in their inbox, once a friend, and the gift
 *  comes off an open bill of theirs at once where one has nothing paid on it. */
export async function giveMemberGift(tx: TransactionSql, input: { gymId: string; friendEntryId: string; by: GiftBy; today: string; now: Date }): Promise<void> {
  const [friend] = await friendGiftRows(tx, input.gymId, [input.friendEntryId]);
  if (friend === undefined || friend.referredBy === null || friend.memberBefore) return;
  const [standing] = await tx<{ id: string }[]>`
    SELECT id FROM gym_referral_member_gifts
    WHERE gym_id = ${input.gymId} AND friend_entry_id = ${input.friendEntryId} AND taken_back_at IS NULL`;
  if (standing !== undefined) return;
  // Only the friend's first payment that stands gives it: a later one, made after the offer
  // gained a member's gift or after the member came back, gives nothing (round one, H1). A
  // payment voided or refunded in full does not stand, so the next one is the first again.
  const paymentId0 = "paymentId" in input.by ? input.by.paymentId : null;
  const saleId0 = "saleId" in input.by ? input.by.saleId : null;
  if ((await standingOther(tx, input.gymId, input.friendEntryId, paymentId0, saleId0)) !== undefined) return;
  const offer = await settingsFor(tx, input.gymId);
  if (!offer.on || offer.member === null) return;
  // The member who sent the link, still a member here, with a live account; never the friend
  // themselves (a member is not their own friend).
  const [inviter] = await tx<{ entry_id: string | null; gym_name: string; listed: boolean }[]>`
    SELECT m.entry_id, g.name AS gym_name,
           EXISTS (SELECT 1 FROM gym_member_list_entries e WHERE e.gym_id = m.gym_id AND e.id = m.entry_id AND e.former_at IS NULL) AS listed
    FROM gym_members m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN gyms g ON g.id = m.gym_id
    WHERE m.gym_id = ${input.gymId} AND m.user_id = ${friend.referredBy} AND m.removed_at IS NULL`;
  if (inviter === undefined || inviter.entry_id === input.friendEntryId) return;

  const gift = offer.member;
  const paymentId = "paymentId" in input.by ? input.by.paymentId : null;
  const saleId = "saleId" in input.by ? input.by.saleId : null;
  const [made] = await tx<{ id: string }[]>`
    INSERT INTO gym_referral_member_gifts
      (gym_id, friend_entry_id, lead_id, member_user_id, kind, percent_bp, amount_minor, currency, given_at, given_on, by_payment_id, by_sale_id)
    VALUES (${input.gymId}, ${input.friendEntryId}, ${friend.leadId}, ${friend.referredBy}, ${gift.kind}, ${gift.percentBp}, ${gift.amountMinor},
            ${gift.currency}, ${input.now}, ${input.today}::date, ${paymentId}, ${saleId})
    ON CONFLICT (gym_id, friend_entry_id) WHERE taken_back_at IS NULL DO NOTHING
    RETURNING id`;
  if (made === undefined) return;
  // One message a friend: a gift taken back and given again is not told twice.
  await insertMessages(
    tx,
    [
      {
        gymId: input.gymId,
        userId: friend.referredBy,
        kind: GYM_REFERRAL_GIFT_MESSAGE_KIND,
        occasion: `friend:${input.friendEntryId}`,
        body: memberGiftMessage(gift, inviter.gym_name, inviter.listed),
        link: null,
        gymDay: input.today,
      },
    ],
    input.now,
    GYM_MESSAGE_KEPT_DAYS,
  );
  await insertAudit(tx, {
    actorUserId: null,
    gymId: input.gymId,
    action: "org.referral_member_gift_given",
    targetType: "gym_referral_member_gift",
    targetId: made.id,
    meta: { friendEntryId: input.friendEntryId, ...(paymentId === null ? {} : { paymentId }), ...(saleId === null ? {} : { saleId }) },
  });
  await giftsOntoOpenBills(tx, input.gymId, input.now, made.id);
}

interface RawOpenBill extends RawTerms {
  gift_id: string;
  bill_id: string;
  amount_minor_bill: number;
  tax_minor: number;
  tax_bp: number;
  tax_name: string | null;
  tax_included: boolean | null;
  bill_currency: string;
}

/** TAKES WAITING GIFTS OFF OPEN BILLS: each gift (oldest first) off the earliest open bill,
 *  with nothing paid on it, of a membership in use on the record its member's account holds
 *  today, where it fits (`memberGiftOff`). One gift a bill. The bill is opened again at its
 *  own price less the gift, with its own tax rate. Under the gym's lock, which every bill
 *  write takes first. `onlyGiftId`: the one gift just given. Answers how many were used. */
export async function giftsOntoOpenBills(tx: TransactionSql, gymId: string, now: Date, onlyGiftId: string | null = null): Promise<number> {
  const rows = await tx<RawOpenBill[]>`
    SELECT g.id AS gift_id, g.kind, g.percent_bp, g.amount_minor, g.currency,
           b.id AS bill_id, b.amount_minor AS amount_minor_bill, b.tax_minor, b.tax_bp, b.tax_name, b.tax_included, b.currency AS bill_currency
    FROM gym_referral_member_gifts g
    JOIN gym_members m ON m.gym_id = g.gym_id AND m.user_id = g.member_user_id AND m.removed_at IS NULL
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id AND e.former_at IS NULL
    JOIN gym_held_memberships h ON h.gym_id = e.gym_id AND h.entry_id = e.id AND h.status IN ('active','frozen')
    JOIN gym_member_bills b ON b.gym_id = h.gym_id AND b.held_membership_id = h.id AND b.status = 'open'
    WHERE g.gym_id = ${gymId} AND g.used_at IS NULL AND g.taken_back_at IS NULL
      AND (${onlyGiftId}::uuid IS NULL OR g.id = ${onlyGiftId}::uuid)
      AND NOT EXISTS (SELECT 1 FROM gym_member_payments p WHERE p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM gym_referral_member_gifts x WHERE x.used_bill_id = b.id)
    ORDER BY g.given_at, g.id, b.due_on, b.period_index, b.id`;
  const done = new Set<string>();
  const billsTaken = new Set<string>();
  const picks: { gift: string; bill: string; amount: number; tax: number; off: number; currency: string }[] = [];
  for (const row of rows) {
    if (done.has(row.gift_id) || billsTaken.has(row.bill_id)) continue;
    const tax = row.tax_name === null || row.tax_included === null ? null : { name: row.tax_name, bp: row.tax_bp, included: row.tax_included };
    // The bill's own price before tax: a price that held its tax is the amount itself.
    const listed = tax === null || tax.included ? row.amount_minor_bill : row.amount_minor_bill - row.tax_minor;
    const off = memberGiftOff(terms(row), listed, row.bill_currency);
    if (off === 0) continue;
    const bill = billOf(listed - off, tax);
    picks.push({ gift: row.gift_id, bill: row.bill_id, amount: bill.amountMinor, tax: bill.tax?.minor ?? 0, off, currency: row.bill_currency });
    done.add(row.gift_id);
    billsTaken.add(row.bill_id);
  }
  if (picks.length === 0) return 0;
  // One statement each, however many: a gym's hourly run holds its lock for as short a time as
  // it can (200 gifts one at a time held it 1.4 to 3.4 s; measured 2026-10-16).
  const lowered = await tx<{ id: string }[]>`
    UPDATE gym_member_bills b SET amount_minor = r.amount, tax_minor = r.tax, updated_at = ${now}
    FROM jsonb_to_recordset(${tx.json(picks)}) AS r(gift uuid, bill uuid, amount int, tax int, off int, currency text)
    WHERE b.gym_id = ${gymId} AND b.id = r.bill AND b.status = 'open'
    RETURNING b.id`;
  const marked = await tx<{ id: string }[]>`
    UPDATE gym_referral_member_gifts g
    SET used_at = ${now}, used_bill_id = r.bill, used_off_minor = r.off, used_currency = r.currency
    FROM jsonb_to_recordset(${tx.json(picks)}) AS r(gift uuid, bill uuid, amount int, tax int, off int, currency text)
    WHERE g.gym_id = ${gymId} AND g.id = r.gift AND g.used_at IS NULL AND g.taken_back_at IS NULL
    RETURNING g.id`;
  if (lowered.length !== picks.length || marked.length !== picks.length) throw new Error("a Refer a friend gift was used that was not waiting");
  await insertAudits(
    tx,
    picks.map((p) => ({
      actorUserId: null,
      gymId,
      action: "org.referral_member_gift_used",
      targetType: "gym_referral_member_gift",
      targetId: p.gift,
      meta: { billId: p.bill, offMinor: String(p.off), currency: p.currency },
    })),
  );
  return picks.length;
}

/** Marks a waiting gift used on one bill or one sale. A gift already used or taken back is a
 *  fault: every caller read it waiting under the gym's lock. */
export async function markUsed(
  tx: TransactionSql,
  input: { gymId: string; giftId: string; billId: string | null; saleId: string | null; offMinor: number; currency: string; now: Date },
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_referral_member_gifts
    SET used_at = ${input.now}, used_bill_id = ${input.billId}, used_sale_id = ${input.saleId}, used_off_minor = ${input.offMinor}, used_currency = ${input.currency}
    WHERE gym_id = ${input.gymId} AND id = ${input.giftId} AND used_at IS NULL AND taken_back_at IS NULL
    RETURNING id`;
  if (rows.length !== 1) throw new Error("a Refer a friend gift was used that was not waiting");
  await insertAudit(tx, {
    actorUserId: null,
    gymId: input.gymId,
    action: "org.referral_member_gift_used",
    targetType: "gym_referral_member_gift",
    targetId: input.giftId,
    meta: {
      ...(input.billId === null ? {} : { billId: input.billId }),
      ...(input.saleId === null ? {} : { saleId: input.saleId }),
      offMinor: String(input.offMinor),
      currency: input.currency,
    },
  });
}

interface RawWaiting extends RawTerms {
  id: string;
  friend_name: string | null;
}

/** The gift waiting for this record (the oldest), as Add membership and Sell fill it in; null
 *  for none. Only a current record its own member's live account holds. */
export async function waitingGiftFor(sql: SqlOrTx, gymId: string, entryId: string, lock = false): Promise<MemberGift | null> {
  const rows = await sql<RawWaiting[]>`
    SELECT g.id, g.kind, g.percent_bp, g.amount_minor, g.currency, NULLIF(btrim(f.full_name), '') AS friend_name
    FROM gym_referral_member_gifts g
    JOIN gym_members m ON m.gym_id = g.gym_id AND m.user_id = g.member_user_id AND m.removed_at IS NULL AND m.entry_id = ${entryId}
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id AND e.former_at IS NULL
    LEFT JOIN gym_member_list_entries f ON f.gym_id = g.gym_id AND f.id = g.friend_entry_id
    WHERE g.gym_id = ${gymId} AND g.used_at IS NULL AND g.taken_back_at IS NULL
    ORDER BY g.given_at, g.id
    LIMIT 1
    ${lock ? sql`FOR UPDATE OF g` : sql``}`;
  const r = rows[0];
  if (r === undefined) return null;
  const t = terms(r);
  return memberGiftSchema.parse({ id: r.id, ...t, words: memberGiftWords(t), friendName: r.friend_name });
}

/** The waiting gift `giftId`, held for the write that uses it, where it is this record's:
 *  null where it is not, or is no longer waiting. */
export async function lockedWaitingGift(tx: TransactionSql, gymId: string, entryId: string, giftId: string): Promise<MemberGift | null> {
  const gift = await waitingGiftFor(tx, gymId, entryId, true);
  return gift !== null && gift.id === giftId ? gift : null;
}

/** The friend's payment or sale no longer stands (voided, or refunded in full). The gift it
 *  gave now stands on another of the friend's payments or sales that does, where there is
 *  one; else, where the gift is not used yet, it is taken back. One already taken off a bill
 *  or a sale stays. Inside that write's own transaction, under the gym's lock. */
export async function friendPaymentGone(tx: TransactionSql, input: { gymId: string; by: GiftBy; why: "voided" | "refunded"; today: string; now: Date }): Promise<void> {
  const paymentId = "paymentId" in input.by ? input.by.paymentId : null;
  const saleId = "saleId" in input.by ? input.by.saleId : null;
  const [gift] = await tx<{ id: string; friend_entry_id: string | null; used: boolean }[]>`
    SELECT id, friend_entry_id, used_at IS NOT NULL AS used FROM gym_referral_member_gifts
    WHERE gym_id = ${input.gymId} AND taken_back_at IS NULL
      AND (by_payment_id = ${paymentId}::uuid OR by_sale_id = ${saleId}::uuid)
    FOR UPDATE`;
  if (gift === undefined) return;
  const other = gift.friend_entry_id === null ? undefined : await standingOther(tx, input.gymId, gift.friend_entry_id, paymentId, saleId);
  if (other !== undefined) {
    await tx`
      UPDATE gym_referral_member_gifts SET by_payment_id = ${other.paymentId}, by_sale_id = ${other.saleId}
      WHERE gym_id = ${input.gymId} AND id = ${gift.id}`;
    return;
  }
  if (gift.used) return;
  const taken = await tx<{ id: string }[]>`
    UPDATE gym_referral_member_gifts SET taken_back_at = ${input.now}, taken_back_on = ${input.today}::date, taken_back_why = ${input.why}
    WHERE gym_id = ${input.gymId} AND id = ${gift.id} AND used_at IS NULL AND taken_back_at IS NULL
    RETURNING id`;
  if (taken.length === 0) return;
  await insertAudit(tx, {
    actorUserId: null,
    gymId: input.gymId,
    action: "org.referral_member_gift_taken_back",
    targetType: "gym_referral_member_gift",
    targetId: gift.id,
    meta: { why: input.why, ...(paymentId === null ? {} : { paymentId }), ...(saleId === null ? {} : { saleId }) },
  });
}

/** Another of the friend's payments or sales that stands: a membership payment not voided
 *  and not refunded in full, or a sale not voided; the earliest. */
async function standingOther(
  tx: TransactionSql,
  gymId: string,
  friendEntryId: string,
  paymentId: string | null,
  saleId: string | null,
): Promise<{ paymentId: string | null; saleId: string | null } | undefined> {
  const [payment] = await tx<{ id: string }[]>`
    SELECT p.id FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE p.gym_id = ${gymId} AND h.entry_id = ${friendEntryId} AND p.undone_at IS NULL
      AND (${paymentId}::uuid IS NULL OR p.id <> ${paymentId}::uuid)
      AND p.amount_minor > COALESCE((SELECT sum(r.amount_minor) FROM gym_member_refunds r
                                     WHERE r.gym_id = p.gym_id AND r.payment_id = p.id AND r.undone_at IS NULL), 0)
    ORDER BY p.seq LIMIT 1`;
  if (payment !== undefined) return { paymentId: payment.id, saleId: null };
  const [sale] = await tx<{ id: string }[]>`
    SELECT id FROM gym_sales
    WHERE gym_id = ${gymId} AND entry_id = ${friendEntryId} AND undone_at IS NULL
      AND (${saleId}::uuid IS NULL OR id <> ${saleId}::uuid)
    ORDER BY seq LIMIT 1`;
  return sale === undefined ? undefined : { paymentId: null, saleId: sale.id };
}

/** A bill or a sale a gift was taken off no longer charges anybody (staff cancelled the bill,
 *  it was cancelled with its membership, or the sale was voided). Where one of the friend's
 *  payments or sales still stands, the gift waits again for the member's next payment, standing
 *  on it; where none does, it is taken back (round one, H2): a used gift stays only while it is
 *  used. Inside that write's own transaction, under the gym's lock. */
export async function giftUseUndone(tx: TransactionSql, gymId: string, on: { billIds: readonly string[] } | { saleId: string }, today: string, now: Date): Promise<void> {
  const billIds = "billIds" in on ? [...on.billIds] : [];
  const saleId = "saleId" in on ? on.saleId : null;
  if (billIds.length === 0 && saleId === null) return;
  const gifts = await tx<{ id: string; friend_entry_id: string | null; refunded: boolean }[]>`
    SELECT g.id, g.friend_entry_id,
           COALESCE(p.undone_at IS NULL AND p.amount_minor <= (SELECT COALESCE(sum(r.amount_minor), 0) FROM gym_member_refunds r
                                                              WHERE r.gym_id = p.gym_id AND r.payment_id = p.id AND r.undone_at IS NULL), false) AS refunded
    FROM gym_referral_member_gifts g
    LEFT JOIN gym_member_payments p ON p.gym_id = g.gym_id AND p.id = g.by_payment_id
    WHERE g.gym_id = ${gymId} AND (g.used_bill_id = ANY(${billIds}::uuid[]) OR g.used_sale_id = ${saleId}::uuid)
    FOR UPDATE OF g`;
  for (const gift of gifts) {
    const stands = gift.friend_entry_id === null ? undefined : await standingOther(tx, gymId, gift.friend_entry_id, null, null);
    if (stands !== undefined) {
      await tx`
        UPDATE gym_referral_member_gifts
        SET used_at = NULL, used_bill_id = NULL, used_sale_id = NULL, used_off_minor = NULL, used_currency = NULL,
            by_payment_id = ${stands.paymentId}, by_sale_id = ${stands.saleId}
        WHERE gym_id = ${gymId} AND id = ${gift.id}`;
    } else {
      await tx`
        UPDATE gym_referral_member_gifts
        SET used_at = NULL, used_bill_id = NULL, used_sale_id = NULL, used_off_minor = NULL, used_currency = NULL,
            taken_back_at = ${now}, taken_back_on = ${today}::date, taken_back_why = ${gift.refunded ? "refunded" : "voided"}
        WHERE gym_id = ${gymId} AND id = ${gift.id}`;
    }
    await insertAudit(tx, {
      actorUserId: null,
      gymId,
      action: stands === undefined ? "org.referral_member_gift_taken_back" : "org.referral_member_gift_waiting_again",
      targetType: "gym_referral_member_gift",
      targetId: gift.id,
      meta: saleId === null ? { bills: String(billIds.length) } : { saleId },
    });
  }
}

/** Two records joined: a gift given for the friend on the record not kept is the kept one's,
 *  so the friend's next payment never gives a second (once a friend). Where the kept record
 *  already has a gift standing (two members invited what were two records of one person), the
 *  other stays with the record not kept and is let go with it; one taken back always moves. */
export async function moveGiftLinks(tx: TransactionSql, gymId: string, fromEntryId: string, toEntryId: string): Promise<void> {
  await tx`
    UPDATE gym_referral_member_gifts g SET friend_entry_id = ${toEntryId}
    WHERE g.gym_id = ${gymId} AND g.friend_entry_id = ${fromEntryId}
      AND (g.taken_back_at IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM gym_referral_member_gifts k
        WHERE k.gym_id = g.gym_id AND k.friend_entry_id = ${toEntryId} AND k.taken_back_at IS NULL))`;
}

/** What a gift took off, by bill, and the friend it was for inviting (by the gym's list;
 *  null where that record is gone): the bills named that a gift was taken off. */
export async function giftsOnBills(
  sql: SqlOrTx,
  gymId: string,
  billIds: readonly string[],
): Promise<Map<string, { offMinor: number; currency: string; friendName: string | null }>> {
  if (billIds.length === 0) return new Map();
  const rows = await sql<{ used_bill_id: string; used_off_minor: number; used_currency: string; friend_name: string | null }[]>`
    SELECT g.used_bill_id, g.used_off_minor, g.used_currency, NULLIF(btrim(f.full_name), '') AS friend_name
    FROM gym_referral_member_gifts g
    LEFT JOIN gym_member_list_entries f ON f.gym_id = g.gym_id AND f.id = g.friend_entry_id
    WHERE g.gym_id = ${gymId} AND g.used_bill_id = ANY(${[...billIds]}::uuid[])`;
  return new Map(rows.map((r) => [r.used_bill_id, { offMinor: r.used_off_minor, currency: r.used_currency, friendName: r.friend_name }]));
}

interface RawLeadGift extends RawTerms {
  used_bill_type: string | null;
  used_bill_due: string | null;
  used_sale_item: string | null;
  used_sale_day: string | null;
  used: boolean;
  taken_back_why: string | null;
  taken_back_payment_day: string | null;
  member_name: string | null;
  listed: boolean;
}

const whySchema = z.enum(["voided", "refunded"]);

/** What became of the member's gift for the friend a lead joined, for the lead's page: the
 *  newest gift for that friend; null where none was given. With the member's name, by the
 *  gym's list where that record is theirs, else their app name; null where their account is
 *  gone. */
export async function leadMemberGift(sql: SqlOrTx, gymId: string, friendEntryId: string): Promise<{ gift: LeadMemberGift; memberName: string | null } | null> {
  const rows = await sql<RawLeadGift[]>`
    SELECT g.kind, g.percent_bp, g.amount_minor, g.currency,
           g.used_at IS NOT NULL AS used, t.name AS used_bill_type, b.due_on::text AS used_bill_due,
           s.item_name AS used_sale_item, s.sold_on::text AS used_sale_day,
           g.taken_back_why,
           COALESCE(gp.paid_on, gs.sold_on, g.taken_back_on)::text AS taken_back_payment_day,
           CASE WHEN u.status = 'active' THEN COALESCE(NULLIF(btrim(e.full_name), ''), u.display_name) END AS member_name,
           (e.id IS NOT NULL AND e.former_at IS NULL) AS listed
    FROM gym_referral_member_gifts g
    LEFT JOIN gym_member_bills b ON b.gym_id = g.gym_id AND b.id = g.used_bill_id
    LEFT JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    LEFT JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    LEFT JOIN gym_sales s ON s.gym_id = g.gym_id AND s.id = g.used_sale_id
    LEFT JOIN gym_member_payments gp ON gp.gym_id = g.gym_id AND gp.id = g.by_payment_id
    LEFT JOIN gym_sales gs ON gs.gym_id = g.gym_id AND gs.id = g.by_sale_id
    LEFT JOIN users u ON u.id = g.member_user_id
    LEFT JOIN gym_members m ON m.gym_id = g.gym_id AND m.user_id = g.member_user_id AND m.removed_at IS NULL
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id
    WHERE g.gym_id = ${gymId} AND g.friend_entry_id = ${friendEntryId}
    ORDER BY g.given_at DESC, g.id DESC
    LIMIT 1`;
  const r = rows[0];
  if (r === undefined) return null;
  const words = memberGiftWords(terms(r));
  let gift: LeadMemberGift;
  if (r.taken_back_why !== null) {
    gift = { state: "taken_back", words, why: whySchema.parse(r.taken_back_why), day: r.taken_back_payment_day ?? "" };
  } else if (r.used && r.used_bill_type !== null && r.used_bill_due !== null) {
    gift = { state: "used", words, on: { kind: "bill", what: r.used_bill_type, dueOn: r.used_bill_due } };
  } else if (r.used && r.used_sale_item !== null && r.used_sale_day !== null) {
    gift = { state: "used", words, on: { kind: "sale", what: r.used_sale_item, day: r.used_sale_day } };
  } else if (r.used) {
    // What it was taken off has since been deleted for good with its record: nothing to say.
    return null;
  } else if (!r.listed && r.member_name !== null) {
    // In the app, but no record of theirs on Members: no bill or sale of theirs can take it
    // until staff put them on the list (round one, H3).
    gift = { state: "waiting_no_record", words };
  } else {
    gift = { state: "waiting", words };
  }
  return { gift, memberName: r.member_name };
}
