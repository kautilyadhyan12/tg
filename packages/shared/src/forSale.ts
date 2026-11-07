// WHAT A GYM SELLS IN THE APP (ROADMAP Stage 2 item 18k-i; Kd, 2026-11-06, `rulings/2026-11-06-18k-i.md`).
//
// The lines of the price list the gym ticked "Sell in the app", as a member reads them before buying: its price, what
// they pay today and the membership agreement's own lines for it. THE ONE RULE: what the list says is what the
// membership would be if staff added it today. So each line is worked out by the very steps Add membership takes
// (`giveHeldMembership`, `billsToOpen`, `periodListedMinor`, `billAmounts`) and worded by the agreement's own
// `agreementFacts`; nothing here prices or words a membership by itself. Memberships and packs alone: a product is
// bought at the desk (Kd, 2026-11-06).
//
// BUYING IT (18k-iii-a): the line is worked out for the reader with the Refer a friend gifts Add membership fills in, the
// friend's own gift and the member's gift waiting for them, so what the list says they pay is what Square takes and what
// the membership given reads (`forSaleWorked`, whose `bought` is kept with the payment page).
import { z } from "zod";
import { membershipDiscount, type DiscountKind, type MembershipPayments } from "./discounts.js";
import { billsToOpen } from "./memberBillRules.js";
import { memberGiftOff, type MemberGiftTerms } from "./memberGift.js";
import { giveHeldMembership, heldMembershipView, periodListedMinor, type HeldTax } from "./heldMemberships.js";
import { agreementFactSchema, agreementFacts, factsKeySchema, type AgreementFact, type AgreementFactsInput } from "./membershipAgreement.js";
import {
  MEMBERSHIP_TYPES_MAX,
  canSellInApp,
  contractThenSchema,
  isDayPass,
  membershipKindSchema,
  type ContractThen,
  type MembershipKind,
  type MembershipTermUnit,
} from "./memberships.js";
import { billAmounts } from "./register.js";
import { waiverTextSchema } from "./waiver.js";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(99_999_999);

/** One line members can buy. */
export const forSaleItemSchema = z
  .object({
    typeId: z.string().uuid(),
    name: z.string().min(1),
    description: z.string().nullable(),
    kind: membershipKindSchema,
    /** A pack of 1 class for 1 day, which the gym calls a day pass. */
    dayPass: z.boolean(),
    priceMinor: minorSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    /** What they would pay today, as its first bill would be opened: the part month where the gym bills everyone on
     *  one day, the joining fee and the tax in, and the Refer a friend gifts off (18k-iii-a). `covers` is the days a
     *  repeating one's first payment is for. */
    firstPayment: z
      .object({
        amountMinor: minorSchema,
        joiningFeeMinor: minorSchema,
        part: z.boolean(),
        covers: z.object({ from: daySchema, to: daySchema }).strict().nullable(),
        dueOn: daySchema,
        /** Refer a friend's gift for the friend a member invited, as Add membership fills it in: its name and what it takes off. */
        friendGift: z.object({ name: z.string().min(1), offMinor: z.number().int().min(1) }).strict().nullable().default(null),
        /** The member's own Refer a friend gift waiting for them: what it takes off. */
        memberGiftOffMinor: minorSchema.default(0),
      })
      .strict(),
    /** It is charged again every period, until they cancel or its minimum term ends: a repeating charge. */
    repeats: z.boolean(),
    /** The membership agreement's own lines for it, in its order: the business, its price and first payment, its
     *  minimum term, early cancellation fee, renewal, notice to cancel and cooling-off period. */
    facts: z.array(agreementFactSchema).min(1),
  })
  .strict();
export type ForSaleItem = z.infer<typeof forSaleItemSchema>;

/** The agreement a line asks the member to sign as they buy it (18k-iii-a): its wording's id, its name (null for the
 *  business's main one) and its words. */
export const forSaleAgreementSchema = z
  .object({ id: z.string().uuid(), name: z.string().min(1).nullable(), version: z.number().int().min(1), text: waiverTextSchema })
  .strict();
export type ForSaleAgreement = z.infer<typeof forSaleAgreementSchema>;

/** A line as the phone reads it: the line, and for buying it, the key of its details and the agreement to sign, if any. */
export const forSaleLineSchema = forSaleItemSchema
  .extend({ factsKey: factsKeySchema, agreement: forSaleAgreementSchema.nullable() })
  .strict();
export type ForSaleLine = z.infer<typeof forSaleLineSchema>;

/** Who signs an agreement for the reader's record: themselves, a parent or guardian (under 18 by the record's date of
 *  birth), or either where the record has none. */
export const forSaleSignerSchema = z.enum(["person", "guardian", "either"]);
export type ForSaleSigner = z.infer<typeof forSaleSignerSchema>;

/** The member's own list. `record`: whether the reader's account alone holds a record of the gym (`own`), holds none
 *  yet (they can buy, and are put on the list once they pay: 18k-iii-b), or shares one (they buy at the front desk). `items` is empty where the gym sells nothing in the app, or cannot take a payment through
 *  Square now. */
export const forSaleResponseSchema = z
  .object({
    gym: z.object({ name: z.string() }).strict(),
    record: z.enum(["own", "none", "shared"]),
    signer: forSaleSignerSchema.default("either"),
    items: z.array(forSaleLineSchema).max(MEMBERSHIP_TYPES_MAX),
  })
  .strict();
export type ForSaleResponse = z.infer<typeof forSaleResponseSchema>;

/** A line of the price list, as the list reads it. */
export interface ForSaleType {
  id: string;
  name: string;
  description: string | null;
  kind: MembershipKind;
  priceMinor: number;
  currency: string;
  termCount: number | null;
  termUnit: MembershipTermUnit | null;
  packClasses: number | null;
  packDays: number | null;
  joiningFeeMinor: number;
  contractPeriods: number | null;
  contractThen: ContractThen | null;
  noticeDays: number | null;
  leaveFeeMinor: number | null;
  coolingOffDays: number | null;
}

/** Refer a friend's gift for this friend (a discount of the gym's), already found to fit this line today. */
export interface ForSaleFriendGift {
  id: string;
  name: string;
  kind: DiscountKind;
  percentBp: number | null;
  amountMinor: number | null;
  membershipPayments: MembershipPayments | null;
}

export interface ForSaleInput {
  type: ForSaleType;
  /** The type's tax rates as each is now, in its order. */
  taxes: readonly HeldTax[];
  taxIncluded: boolean;
  /** The day of the month the gym bills everyone on (18y); null for none. */
  billDay: number | null;
  /** The gym's own day. */
  today: string;
  gym: AgreementFactsInput["gym"];
  /** The reader's record's name; empty where they have none of their own. */
  personName: string;
  /** Refer a friend's gift for the reader, where they are a friend a member invited (18k-iii-a). */
  friendGift?: ForSaleFriendGift | null;
  /** The reader's own Refer a friend gift waiting for them, off a membership (18k-iii-a). */
  memberGift?: (MemberGiftTerms & { id: string }) | null;
}

/** What buying the line gives, as Add membership would be told it (`giveHeldIn`'s screen values), kept with the page. */
export const appPurchaseGivenSchema = z
  .object({
    typeName: z.string().min(1),
    startsOn: daySchema,
    priceMinor: minorSchema,
    joiningFeeMinor: minorSchema,
    totalMinor: z.number().int().min(1).max(99_999_999),
    fullFrom: daySchema.nullable(),
    minimumTerm: z.object({ periods: z.number().int().min(1), then: contractThenSchema, leaveFeeMinor: minorSchema.nullable() }).strict().nullable(),
    noticeDays: z.number().int().min(0).nullable(),
    coolingOffDays: z.number().int().min(0).nullable(),
    discount: z.object({ id: z.string().uuid(), offMinor: z.number().int().min(1) }).strict().nullable(),
    memberGift: z.object({ id: z.string().uuid(), offMinor: z.number().int().min(1) }).strict().nullable(),
  })
  .strict();
export type AppPurchaseGiven = z.infer<typeof appPurchaseGivenSchema>;

/** ONE LINE AS A MEMBER READS IT, and what buying it gives: the membership as Add membership would give it today, from
 *  today, with the Refer a friend gifts it fills in; null for a line that cannot be sold in the app (a repeating one
 *  until 18k-iv, a trial, a free one) or that gives nothing today. */
export function forSaleWorked(input: ForSaleInput): { item: ForSaleItem; given: AppPurchaseGiven } | null {
  const { type, today } = input;
  if (!canSellInApp(type)) return null;
  const given = giveHeldMembership(type, today, false, today, input.billDay);
  if (!given.ok) return null;
  const m = given.membership;
  const [due] = billsToOpen(m, today, new Set());
  if (due === undefined) return null;
  // The friend's gift, as Add membership takes a discount: off the price, kept on the membership where it is every payment.
  const fg = input.friendGift ?? null;
  const costs = fg === null ? null : membershipDiscount(fg, type);
  const discount = fg !== null && costs?.ok === true ? { id: fg.id, name: fg.name, offMinor: costs.offMinor, payments: costs.payments, heldPriceMinor: costs.heldPriceMinor, firstBillMinor: costs.firstBillMinor } : null;
  const firstPart = periodListedMinor(m, due.periodIndex, discount === null ? type.priceMinor : discount.firstBillMinor);
  // The member's own gift, off the first bill after any discount (`giveHeldIn`).
  const mg = input.memberGift ?? null;
  const giftOff = mg === null ? 0 : memberGiftOff(mg, firstPart, type.currency);
  const tax = input.taxes.length === 0 ? null : { rates: input.taxes, included: input.taxIncluded };
  const amounts = billAmounts(firstPart - giftOff + type.joiningFeeMinor, tax);
  if (!amounts.ok || amounts.totalMinor < 1) return null;
  const firstPayment = {
    amountMinor: amounts.totalMinor,
    joiningFeeMinor: type.joiningFeeMinor,
    part: due.periodIndex === 0 && m.fullFrom !== null,
    covers: due.covers,
    dueOn: due.dueOn,
    friendGift: discount === null ? null : { name: discount.name, offMinor: discount.offMinor },
    memberGiftOffMinor: giftOff,
  };
  const heldPriceMinor = discount === null ? type.priceMinor : discount.heldPriceMinor;
  const facts: AgreementFact[] = agreementFacts({
    gym: input.gym,
    personName: input.personName,
    membership: {
      typeName: type.name,
      kind: type.kind,
      priceMinor: heldPriceMinor,
      currency: type.currency,
      termCount: type.termCount,
      termUnit: type.termUnit,
      packClasses: type.packClasses,
      startsOn: m.startsOn,
      discount: discount === null ? null : { name: discount.name, offMinor: discount.offMinor, payments: discount.payments },
      taxes: [...input.taxes],
      view: heldMembershipView(m, today),
      contractPeriods: m.contractPeriods ?? null,
      fullFrom: m.fullFrom,
      leaveFeeMinor: m.leaveFeeMinor ?? null,
      coolingOffDays: m.coolingOffDays ?? null,
    },
    firstBill: firstPayment,
    taxIncluded: input.taxIncluded,
  });
  const item: ForSaleItem = {
    typeId: type.id,
    name: type.name,
    description: type.description,
    kind: type.kind,
    dayPass: isDayPass(type),
    priceMinor: type.priceMinor,
    currency: type.currency,
    firstPayment,
    repeats: type.kind === "recurring",
    facts,
  };
  return {
    item,
    given: {
      typeName: type.name,
      startsOn: m.startsOn,
      priceMinor: type.priceMinor,
      joiningFeeMinor: type.joiningFeeMinor,
      totalMinor: amounts.totalMinor,
      fullFrom: m.fullFrom,
      minimumTerm: type.contractPeriods === null || type.contractThen === null ? null : { periods: type.contractPeriods, then: type.contractThen, leaveFeeMinor: type.leaveFeeMinor },
      noticeDays: type.noticeDays,
      coolingOffDays: type.coolingOffDays,
      discount: discount === null ? null : { id: discount.id, offMinor: discount.offMinor },
      memberGift: mg === null || giftOff === 0 ? null : { id: mg.id, offMinor: giftOff },
    },
  };
}

/** One line as a member reads it, without the reader's gifts unless they are given: `forSaleWorked`'s line. */
export function forSaleItem(input: ForSaleInput): ForSaleItem | null {
  return forSaleWorked(input)?.item ?? null;
}
