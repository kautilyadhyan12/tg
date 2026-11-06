// WHAT A GYM SELLS IN THE APP (ROADMAP Stage 2 item 18k-i; Kd, 2026-11-06, `rulings/2026-11-06-18k-i.md`).
//
// The lines of the price list the gym ticked "Sell in the app", as a member reads them before buying: its price, what
// they pay today and the membership agreement's own lines for it. THE ONE RULE: what the list says is what the
// membership would be if staff added it today. So each line is worked out by the very steps Add membership takes
// (`giveHeldMembership`, `billsToOpen`, `periodListedMinor`, `billAmounts`) and worded by the agreement's own
// `agreementFacts`; nothing here prices or words a membership by itself. Memberships and packs alone: a product is
// bought at the desk (Kd, 2026-11-06).
import { z } from "zod";
import { billsToOpen } from "./memberBillRules.js";
import { giveHeldMembership, heldMembershipView, periodListedMinor, type HeldTax } from "./heldMemberships.js";
import { agreementFactSchema, agreementFacts, type AgreementFact, type AgreementFactsInput } from "./membershipAgreement.js";
import { MEMBERSHIP_TYPES_MAX, canSellInApp, membershipKindSchema, type ContractThen, type MembershipKind, type MembershipTermUnit } from "./memberships.js";
import { billAmounts } from "./register.js";

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
     *  one day, the joining fee and the tax in. `covers` is the days a repeating one's first payment is for. */
    firstPayment: z
      .object({
        amountMinor: minorSchema,
        joiningFeeMinor: minorSchema,
        part: z.boolean(),
        covers: z.object({ from: daySchema, to: daySchema }).strict().nullable(),
        dueOn: daySchema,
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

/** The member's own list. `record`: whether the reader's account alone holds a record of the gym (`own`), holds none
 *  yet, or shares one. `items` is empty where the gym sells nothing in the app, or cannot take a payment through
 *  Square now. */
export const forSaleResponseSchema = z
  .object({
    gym: z.object({ name: z.string() }).strict(),
    record: z.enum(["own", "none", "shared"]),
    items: z.array(forSaleItemSchema).max(MEMBERSHIP_TYPES_MAX),
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
}

/** ONE LINE AS A MEMBER READS IT: the membership as Add membership would give it today, from today, with no discount;
 *  null for a line that cannot be sold in the app (a trial, a free one) or that gives nothing today. */
export function forSaleItem(input: ForSaleInput): ForSaleItem | null {
  const { type, today } = input;
  if (!canSellInApp(type)) return null;
  const given = giveHeldMembership(type, today, false, today, input.billDay);
  if (!given.ok) return null;
  const m = given.membership;
  const [due] = billsToOpen(m, today, new Set());
  if (due === undefined) return null;
  const tax = input.taxes.length === 0 ? null : { rates: input.taxes, included: input.taxIncluded };
  const amounts = billAmounts(periodListedMinor(m, due.periodIndex, type.priceMinor) + type.joiningFeeMinor, tax);
  if (!amounts.ok) return null;
  const firstPayment = { amountMinor: amounts.totalMinor, joiningFeeMinor: type.joiningFeeMinor, part: due.periodIndex === 0 && m.fullFrom !== null, covers: due.covers, dueOn: due.dueOn };
  const facts: AgreementFact[] = agreementFacts({
    gym: input.gym,
    personName: input.personName,
    membership: {
      typeName: type.name,
      kind: type.kind,
      priceMinor: type.priceMinor,
      currency: type.currency,
      termCount: type.termCount,
      termUnit: type.termUnit,
      packClasses: type.packClasses,
      startsOn: m.startsOn,
      discount: null,
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
  return {
    typeId: type.id,
    name: type.name,
    description: type.description,
    kind: type.kind,
    dayPass: type.kind === "pack" && type.packClasses === 1 && type.packDays === 1,
    priceMinor: type.priceMinor,
    currency: type.currency,
    firstPayment,
    repeats: type.kind === "recurring",
    facts,
  };
}
