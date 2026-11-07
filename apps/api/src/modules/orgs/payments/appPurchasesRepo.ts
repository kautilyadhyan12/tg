// Buy in the app (ROADMAP 18k-iii-a): a member's page for a line of the price list, a row of `gym_app_payments` with the
// line in place of a membership (`appPaymentsRepo.ts` keeps the asking of Square). Every statement names the gym.
//
// THE ONE RULE: what Square took gives exactly the membership the member was shown, once, on their own record, and nothing
// is given without it. So the check before the page is made, and again as it is written, is Add membership's own, under
// the gym's lock and the record's: the line worked out for this reader now (`forSaleWorked`) must be what the screen showed
// (its first payment and the key of its details), the agreement read must be the newest of the line's, and nothing must
// stand in the way of giving it (`wouldRefuseGiving`). What buying gives is kept with the page (`bought`), and once Square
// says it is paid it is given by `giveHeldIn`, told exactly what the screen showed, so a line changed meanwhile gives
// nothing and the money is kept for staff to check. While a page is open the price list holds its line (`holdsLine`).
import {
  appPurchaseBoughtSchema,
  discountFits,
  forSaleWorked,
  giveHeldMembership,
  isUnder18,
  type AppPurchaseBought,
  type AppPurchaseCheck,
  type AppPurchaseGiven,
  type AppPurchaseOpen,
  type AppPurchaseSign,
  type DeskSigner,
  type ForSaleFriendGift,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { factsKeyOf } from "../agreement/factsKey.js";
import { gymContact, typeDocumentSql } from "../agreement/repo.js";
import { lockGym } from "../memberList/repo.js";
import { billDayOf } from "../memberships/billsSql.js";
import { giveHeldIn, lockedEntry, settle, wouldRefuseGiving } from "../memberships/heldRepo.js";
import { friendGiftOffer } from "../referrals/friendGift.js";
import { waitingGiftFor } from "../referrals/memberGiftRepo.js";
import { taxIncludedOf } from "../register/taxRepo.js";
import { insertAudit } from "../repo.js";
import { COLUMNS, toRow, type AppPayRow, type RawPay } from "./appPaymentsRepo.js";
import { soldInAppLine } from "./forSaleRepo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

/** What Buy read off the screen, and who pressed it. */
export interface Buying {
  gymId: string;
  entryId: string;
  typeId: string;
  amountMinor: number;
  factsKey: string;
  agreement: { agreementId: string; signer: DeskSigner; name: string } | null;
  /** The Square account's own money: a line priced in another is not sent. */
  accountCurrency: string;
  gymName: string;
  today: string;
  now: Date;
}

export type PurchasableOutcome =
  | { kind: "ok"; bought: AppPurchaseBought; currency: string }
  /** A page for this record is open: the same press's is answered instead of a second. */
  | { kind: "open"; row: AppPayRow }
  | { kind: "entry_not_found" | "changed" | "agreement_changed" | "guardian_needed" | "person_signs" | "too_many" | "currency" | "check" }
  | { kind: "already_held"; name: string };

/** The newest wording of the agreement a line asks for today, or null for none: the main agreement unless the line is
 *  ticked on another, as a membership of it is signed (`agreementForMembership`). */
async function askedWording(tx: SqlOrTx, gymId: string, typeId: string): Promise<{ id: string } | null> {
  const [row] = await tx<{ id: string }[]>`
    SELECT a.id FROM gym_membership_types t
    JOIN gym_agreements a ON a.gym_id = t.gym_id AND a.document_id = ${typeDocumentSql(tx)}
    WHERE t.gym_id = ${gymId} AND t.id = ${typeId} AND a.stopped_at IS NULL
      AND a.version = (SELECT max(x.version) FROM gym_agreements x WHERE x.gym_id = a.gym_id AND x.document_id = a.document_id)`;
  return row ?? null;
}

/** Refer a friend's gift for this record, as Add membership fills it in, where it fits this line today. */
async function friendGiftFor(tx: SqlOrTx, gymId: string, entryId: string, typeId: string, currency: string, today: string): Promise<ForSaleFriendGift | null> {
  const offer = await friendGiftOffer(tx, gymId, entryId, today);
  if (offer === null) return null;
  const d = offer.discount;
  const fits = discountFits({ ...d, archived: d.archivedAt !== null }, { today, membershipTypeId: typeId, currency });
  return fits.ok ? { id: d.id, name: d.name, kind: d.kind, percentBp: d.percentBp, amountMinor: d.amountMinor, membershipPayments: d.membershipPayments } : null;
}

/** The line as this record would buy it now, with what buying it gives; null where it is not sold in the app now. */
export async function workedFor(
  tx: SqlOrTx,
  s: { gymId: string; entryId: string | null; typeId: string; gymName: string; today: string; personName: string },
): Promise<{ worked: NonNullable<ReturnType<typeof forSaleWorked>>; m: ReturnType<typeof giveHeldMembership> } | null> {
  const line = await soldInAppLine(tx, s.gymId, s.typeId);
  if (line === null) return null;
  const [contact, billDay, taxIncluded] = await Promise.all([gymContact(tx, s.gymId), billDayOf(tx, s.gymId), taxIncludedOf(tx, s.gymId)]);
  if (taxIncluded === null) return null;
  const [friendGift, memberGift] =
    s.entryId === null
      ? [null, null]
      : await Promise.all([friendGiftFor(tx, s.gymId, s.entryId, s.typeId, line.type.currency, s.today), waitingGiftFor(tx, s.gymId, s.entryId, "membership")]);
  const worked = forSaleWorked({
    type: line.type,
    taxes: line.taxes,
    taxIncluded,
    billDay,
    today: s.today,
    gym: { name: s.gymName, ...contact },
    personName: s.personName,
    friendGift,
    memberGift: memberGift === null ? null : { id: memberGift.id, kind: memberGift.kind, percentBp: memberGift.percentBp, amountMinor: memberGift.amountMinor, currency: memberGift.currency },
  });
  if (worked === null) return null;
  return { worked, m: giveHeldMembership(line.type, s.today, false, s.today, billDay) };
}

/** The record's name and date of birth, as the agreement reads them. */
async function personOf(tx: SqlOrTx, gymId: string, entryId: string): Promise<{ fullName: string; dateOfBirth: string | null } | null> {
  const [row] = await tx<{ full_name: string; date_of_birth: string | null }[]>`
    SELECT full_name, date_of_birth::text AS date_of_birth FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ${entryId} AND former_at IS NULL`;
  return row === undefined ? null : { fullName: row.full_name.trim(), dateOfBirth: row.date_of_birth };
}

/** Whether a purchase can be made now, asked under the gym's lock and the record's: the same rules giving it will meet. */
async function purchasableIn(tx: TransactionSql, s: Buying): Promise<PurchasableOutcome> {
  const entry = await lockedEntry(tx, s.gymId, s.entryId);
  if (entry === null || entry.past) return { kind: "entry_not_found" };
  await settle(tx, s.gymId, s.entryId, s.today, s.now);
  const [open] = await tx<RawPay[]>`
    SELECT ${COLUMNS(tx)} FROM gym_app_payments a
    WHERE a.gym_id = ${s.gymId} AND a.entry_id = ${s.entryId} AND a.state = 'open' AND a.membership_type_id IS NOT NULL`;
  if (open !== undefined) return { kind: "open", row: toRow(open) };
  const person = await personOf(tx, s.gymId, s.entryId);
  if (person === null) return { kind: "entry_not_found" };
  const found = await workedFor(tx, { gymId: s.gymId, entryId: s.entryId, typeId: s.typeId, gymName: s.gymName, today: s.today, personName: person.fullName });
  if (found === null || !found.m.ok) return { kind: "changed" };
  const { item, given } = found.worked;
  // Only what the screen showed: its first payment and its details, to the character.
  if (item.firstPayment.amountMinor !== s.amountMinor || factsKeyOf(item.facts) !== s.factsKey) return { kind: "changed" };
  const asked = await askedWording(tx, s.gymId, s.typeId);
  if ((asked === null) !== (s.agreement === null)) return { kind: "agreement_changed" };
  if (asked !== null && s.agreement !== null) {
    if (asked.id !== s.agreement.agreementId) return { kind: "agreement_changed" };
    const minor = isUnder18(person.dateOfBirth, s.today);
    if (s.agreement.signer === "person" && minor === true) return { kind: "guardian_needed" };
    if (s.agreement.signer === "guardian" && minor === false) return { kind: "person_signs" };
  }
  const refused = await wouldRefuseGiving(tx, s.gymId, s.entryId, s.typeId, found.m.membership, s.today);
  if (refused === "already_held") return { kind: "already_held", name: item.name };
  if (refused === "too_many") return { kind: "too_many" };
  // An earlier page for this line that may have been paid and gave nothing is checked by the front desk first.
  const [check] = await tx<{ id: string }[]>`
    SELECT id FROM gym_app_payments
    WHERE gym_id = ${s.gymId} AND entry_id = ${s.entryId} AND membership_type_id = ${s.typeId}
      AND outcome IN ('not_recorded','gone','no_answer') AND cleared_at IS NULL
    LIMIT 1`;
  if (check !== undefined) return { kind: "check" };
  if (item.currency !== s.accountCurrency) return { kind: "currency" };
  const sign: AppPurchaseSign | null =
    asked === null || s.agreement === null ? null : { agreementId: asked.id, signer: s.agreement.signer, name: s.agreement.name, facts: item.facts, at: s.now.toISOString() };
  return { kind: "ok", bought: { ...given, sign }, currency: item.currency };
}

/** The check before Square is asked to make the page: nothing is written but what the clock had already done. */
export async function purchasable(sql: Sql, s: Buying): Promise<PurchasableOutcome> {
  return await sql.begin(async (tx) => await purchasableIn(tx, s));
}

export interface NewPurchase extends Buying {
  id: string;
  environment: SquareEnvironment;
  accountId: string;
  locationId: string;
  requestKey: string;
  openedBy: string;
  closesAt: Date;
  linkKey: string;
  linkId: string;
  orderId: string;
  url: string;
}

export type OpenPurchaseOutcome = { kind: "new"; row: AppPayRow } | Exclude<PurchasableOutcome, { kind: "ok" }> | { kind: "key_reused"; row: AppPayRow };

/** The page Square made, written once the same check passes again under the locks: anything that changed meanwhile
 *  refuses it, and the caller deletes the page at Square. What it gives is the check's own, never the screen's. */
export async function writeOpenPurchase(sql: Sql, s: NewPurchase): Promise<OpenPurchaseOutcome> {
  return await sql.begin(async (tx): Promise<OpenPurchaseOutcome> => {
    const check = await purchasableIn(tx, s);
    if (check.kind !== "ok") return check;
    const [same] = await tx<RawPay[]>`SELECT ${COLUMNS(tx)} FROM gym_app_payments a WHERE a.gym_id = ${s.gymId} AND a.request_key = ${s.requestKey}`;
    if (same !== undefined) return { kind: "key_reused", row: toRow(same) };
    await tx`
      INSERT INTO gym_app_payments (id, gym_id, entry_id, membership_type_id, bought, amount_minor, currency, environment, account_id,
                                    location_id, request_key, opened_by, opened_at, closes_at, link_key, link_id, order_id, url, state, checked_at)
      VALUES (${s.id}, ${s.gymId}, ${s.entryId}, ${s.typeId}, ${tx.json(check.bought)}, ${s.amountMinor}, ${check.currency}, ${s.environment},
              ${s.accountId}, ${s.locationId}, ${s.requestKey}, ${s.openedBy}, ${s.now}, ${s.closesAt}, ${s.linkKey}, ${s.linkId}, ${s.orderId},
              ${s.url}, 'open', ${s.now})`;
    const [written] = await tx<RawPay[]>`SELECT ${COLUMNS(tx)} FROM gym_app_payments a WHERE a.gym_id = ${s.gymId} AND a.id = ${s.id}`;
    if (written === undefined) throw new Error("a purchase page just written was not read back");
    return { kind: "new", row: toRow(written) };
  });
}

/** What a page keeps of the line bought; null where it is not a purchase, or holds a shape this build does not know. */
export function boughtOf(row: Pick<AppPayRow, "typeId" | "bought">): AppPurchaseBought | null {
  if (row.typeId === null) return null;
  const parsed = appPurchaseBoughtSchema.safeParse(row.bought);
  return parsed.success ? parsed.data : null;
}

/** One purchase, read for the account that pressed Buy. */
export async function readOwnPurchase(sql: SqlOrTx, gymId: string, userId: string, id: string): Promise<AppPayRow | null> {
  const [row] = await sql<RawPay[]>`
    SELECT ${COLUMNS(sql)} FROM gym_app_payments a
    WHERE a.gym_id = ${gymId} AND a.id = ${id} AND a.opened_by = ${userId} AND a.membership_type_id IS NOT NULL`;
  return row === undefined ? null : toRow(row);
}

/** Whether a member is buying this line in the app now: the price list holds it. Under the gym's lock, which Buy's write
 *  takes too, so a change and a page never pass each other. */
export async function holdsLine(tx: TransactionSql, gymId: string, typeId: string): Promise<boolean> {
  const [row] = await tx<{ id: string }[]>`
    SELECT id FROM gym_app_payments WHERE gym_id = ${gymId} AND membership_type_id = ${typeId} AND state = 'open' LIMIT 1`;
  return row !== undefined;
}

const payerName = (sql: SqlOrTx) => sql`
  (SELECT NULLIF(btrim(o.full_name), '') FROM gym_members gm
   JOIN gym_member_list_entries o ON o.gym_id = gm.gym_id AND o.id = gm.entry_id
   WHERE gm.gym_id = a.gym_id AND gm.user_id = a.opened_by LIMIT 1)`;

/** For staff on the person's page: the purchase page open for this record now, if any. */
export async function openPurchaseOf(sql: SqlOrTx, gymId: string, entryId: string): Promise<AppPurchaseOpen | null> {
  const [row] = await sql<{ id: string; bought: unknown; membership_type_id: string; closes_at: Date; payer_name: string | null }[]>`
    SELECT a.id, a.bought, a.membership_type_id, a.closes_at, ${payerName(sql)} AS payer_name
    FROM gym_app_payments a
    WHERE a.gym_id = ${gymId} AND a.entry_id = ${entryId} AND a.state = 'open' AND a.membership_type_id IS NOT NULL`;
  if (row === undefined) return null;
  const bought = boughtOf({ typeId: row.membership_type_id, bought: row.bought });
  return { id: row.id, typeName: bought?.typeName ?? "a membership", payerName: row.payer_name, closesAt: row.closes_at.toISOString() };
}

/** For staff on the person's page: purchases that gave nothing though Square may have taken money, not yet marked checked,
 *  the newest first. */
export async function purchaseChecksOf(sql: SqlOrTx, gymId: string, entryId: string): Promise<AppPurchaseCheck[]> {
  const rows = await sql<{ id: string; bought: unknown; membership_type_id: string; outcome: string; taken_minor: number | null; currency: string; on: string; payer_name: string | null }[]>`
    SELECT a.id, a.bought, a.membership_type_id, a.outcome, a.taken_minor, a.currency, ((a.finished_at AT TIME ZONE g.timezone)::date)::text AS on,
           ${payerName(sql)} AS payer_name
    FROM gym_app_payments a
    JOIN gyms g ON g.id = a.gym_id
    WHERE a.gym_id = ${gymId} AND a.entry_id = ${entryId} AND a.membership_type_id IS NOT NULL
      AND a.outcome IN ('not_recorded','gone','no_answer') AND a.cleared_at IS NULL
    ORDER BY a.finished_at DESC, a.id
    LIMIT 20`;
  return rows.map((r) => ({
    id: r.id,
    typeName: boughtOf({ typeId: r.membership_type_id, bought: r.bought })?.typeName ?? "a membership",
    why: r.outcome === "not_recorded" ? "taken" : "unknown",
    amountMinor: r.outcome === "not_recorded" ? r.taken_minor : null,
    currency: r.currency,
    on: r.on,
    payerName: r.payer_name,
  }));
}

/** Staff pressed Close payment page on a purchase: asked for it closed, and told to the gym's Staff activity. The id of
 *  the page, or null where none of this record is open. */
export async function staffClosePurchase(sql: Sql, s: { gymId: string; entryId: string; id: string; staffUserId: string; now: Date }): Promise<string | null> {
  return await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      UPDATE gym_app_payments SET close_wanted_at = COALESCE(close_wanted_at, ${s.now}), close_wanted_by = COALESCE(close_wanted_by, 'staff'),
             closed_by_staff = COALESCE(closed_by_staff, ${s.staffUserId})
      WHERE gym_id = ${s.gymId} AND id = ${s.id} AND entry_id = ${s.entryId} AND state = 'open' AND membership_type_id IS NOT NULL
      RETURNING id`;
    if (row === undefined) return null;
    await insertAudit(tx, { actorUserId: s.staffUserId, gymId: s.gymId, action: "org.app_payment_closed", targetType: "gym_app_payment", targetId: row.id, meta: { entryId: s.entryId } });
    return row.id;
  });
}

/** Staff marked a purchase that gave nothing as checked: it leaves the person's page, and Staff activity keeps who did. */
export async function markPurchaseChecked(sql: Sql, s: { gymId: string; entryId: string; id: string; staffUserId: string; now: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string }[]>`
      UPDATE gym_app_payments SET cleared_at = ${s.now}, cleared_by = ${s.staffUserId}
      WHERE gym_id = ${s.gymId} AND id = ${s.id} AND entry_id = ${s.entryId} AND membership_type_id IS NOT NULL
        AND outcome IN ('not_recorded','gone','no_answer') AND cleared_at IS NULL
      RETURNING id`;
    if (row === undefined) return false;
    await insertAudit(tx, { actorUserId: s.staffUserId, gymId: s.gymId, action: "org.app_purchase_checked", targetType: "gym_app_payment", targetId: row.id, meta: { entryId: s.entryId } });
    return true;
  });
}

export interface Bought {
  row: AppPayRow;
  squarePaymentId: string;
  card: { brand: string; last4: string } | null;
  taken: number | null;
  today: string;
  now: Date;
  refuse?: string;
}

/** The signature as the member gave it on Buy, written for the membership given: the wording they read, kept as signed in
 *  the app with no staff screen. Null where it was already written. */
async function signBought(tx: TransactionSql, gymId: string, membershipId: string, sign: AppPurchaseSign): Promise<string | null> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO gym_agreement_signatures (gym_id, agreement_id, held_membership_id, signer, signed_name, facts, witnessed_by, signed_at, signed_via)
    SELECT a.gym_id, a.id, ${membershipId}, ${sign.signer}, ${sign.name}, ${tx.json(sign.facts.map((fact) => ({ label: fact.label, value: fact.value })))}, NULL,
           ${new Date(sign.at)}, 'app'
    FROM gym_agreements a WHERE a.gym_id = ${gymId} AND a.id = ${sign.agreementId}
    ON CONFLICT (held_membership_id) DO NOTHING
    RETURNING id`;
  return row?.id ?? null;
}

const given = (bought: AppPurchaseBought): AppPurchaseGiven => {
  const { sign, ...rest } = bought;
  void sign;
  return rest;
};

/** Square took the money for a line bought: the membership is given as the screen showed it, its first bill paid in the
 *  app, and the agreement signed, in the same transaction that marks the page paid. Where it cannot be given exactly so,
 *  or Square took another amount, nothing is given and the page is kept as not recorded, for staff to check. Null when
 *  another request finished it first. */
export async function recordBought(sql: Sql, p: Bought): Promise<{ outcome: "paid"; membershipId: string; signed: boolean } | { outcome: "not_recorded" } | null> {
  const { row } = p;
  const typeId = row.typeId;
  if (typeId === null) throw new Error("a bill's page reached the purchase's recording");
  return await sql.begin(async (tx) => {
    // The gym's lock, then the record's, then the page: the order Add membership takes.
    await lockGym(tx, row.gymId);
    const entry = row.entryId === null ? null : await lockedEntry(tx, row.gymId, row.entryId);
    const [still] = await tx<{ id: string }[]>`SELECT id FROM gym_app_payments WHERE gym_id = ${row.gymId} AND id = ${row.id} AND state = 'open' FOR UPDATE`;
    if (still === undefined) return null;
    const bought = boughtOf(row);
    let why: string = p.refuse ?? (row.entryId === null || entry === null ? "entry_not_found" : bought === null ? "bought_unreadable" : "");
    if (why === "" && row.entryId !== null && bought !== null && bought.totalMinor === row.amountMinor) {
      const what = given(bought);
      const done = await giveHeldIn(tx, {
        gymId: row.gymId,
        entryId: row.entryId,
        typeId,
        // The page itself is the membership's and the payment's key: the same page given twice is one.
        requestKey: row.id,
        startsOn: what.startsOn,
        paid: true,
        method: "app",
        provider: { name: "square", paymentId: p.squarePaymentId },
        shownPriceMinor: what.priceMinor,
        shownTotalMinor: what.totalMinor,
        joiningFeeMinor: what.joiningFeeMinor,
        shownFullFrom: what.fullFrom,
        shownMinimumTerm: what.minimumTerm,
        shownNoticeDays: what.noticeDays,
        shownCoolingOffDays: what.coolingOffDays,
        mayWaiveJoiningFee: false,
        discount: what.discount === null ? null : { id: what.discount.id, shownOffMinor: what.discount.offMinor },
        memberGift: what.memberGift === null ? null : { id: what.memberGift.id, shownOffMinor: what.memberGift.offMinor },
        today: p.today,
        // No member of staff gave it: the member bought it (`member.app_purchase_paid` below).
        actorUserId: null,
        now: p.now,
      });
      if (done.kind === "given" && done.paymentId !== null) {
        const signed = bought.sign === null ? null : await signBought(tx, row.gymId, done.id, bought.sign);
        await tx`
          UPDATE gym_app_payments SET state = 'done', outcome = 'paid', held_membership_id = ${done.id}, square_payment_id = ${p.squarePaymentId},
                 member_payment_id = ${done.paymentId}, card_brand = ${p.card?.brand ?? null}, card_last4 = ${p.card?.last4 ?? null}, taken_minor = ${p.taken},
                 -- The signature now lives with the membership; the page keeps no name or details of it.
                 bought = bought || '{"sign":null}'::jsonb, finished_at = ${p.now}, checking_until = NULL
          WHERE gym_id = ${row.gymId} AND id = ${row.id}`;
        await insertAudit(tx, {
          actorUserId: row.openedBy,
          gymId: row.gymId,
          action: "member.app_purchase_paid",
          targetType: "gym_member_payment",
          targetId: done.paymentId,
          meta: { entryId: row.entryId, membershipId: done.id, typeId, amountMinor: String(row.amountMinor), currency: row.currency, signed: String(signed !== null) },
        });
        return { outcome: "paid" as const, membershipId: done.id, signed: signed !== null };
      }
      why = done.kind === "given" ? "no_payment" : done.kind;
    } else if (why === "") {
      why = "amount_differs";
    }
    await tx`
      UPDATE gym_app_payments SET state = 'done', outcome = 'not_recorded', square_payment_id = ${p.squarePaymentId},
             card_brand = ${p.card?.brand ?? null}, card_last4 = ${p.card?.last4 ?? null}, taken_minor = ${p.taken}, finished_at = ${p.now}, checking_until = NULL
      WHERE gym_id = ${row.gymId} AND id = ${row.id}`;
    await insertAudit(tx, {
      actorUserId: row.openedBy,
      gymId: row.gymId,
      action: "member.app_purchase_not_recorded",
      targetType: "gym_app_payment",
      targetId: row.id,
      meta: { ...(row.entryId === null ? {} : { entryId: row.entryId }), typeId, amountMinor: String(row.amountMinor), currency: row.currency, why },
    });
    return { outcome: "not_recorded" as const };
  });
}
