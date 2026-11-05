// THE REGISTER — Part 3 §14.3; ROADMAP Stage 2 item 18b-i.
//
// The desk's Sell screen: a gym's products, its tax, and each sale. A sale is what staff
// say they were handed; the app holds nobody's money. Every amount is whole minor units
// of the gym's currency and is worked out by the server (`saleAmounts`); the screen sends
// back the total it showed, and a sale whose total has since changed is refused.
//
// A membership is sold by giving it as paid (`heldMemberships.ts`, `memberBills.ts`): its
// bill and payment are the notebook's, and no row of this file's is written for it.
import { z } from "zod";
import { gymDiscountSchema } from "./discounts.js";
import { chargebackSeenSchema } from "./chargebacks.js";
import { cardRefundOpenSchema, memberPaymentByHandSchema, memberPaymentMethodSchema, receiptNumberSchema, salePaymentMethodSchema } from "./memberBills.js";
import { MEMBERSHIP_PRICE_MINOR_MAX, SALES_TAX_PCM_MAX } from "./memberships.js";
import { isRealDay } from "./discounts.js";
import { saleRefundSchema } from "./saleRefunds.js";
import { VISIBLE_TEXT } from "./visibleText.js";
import { supportedCountrySchema, type SupportedCountry } from "./orgs.js";

export const PRODUCT_NAME_MAX = 80;
/** How many products a gym can have on sale at once. */
export const PRODUCTS_MAX = 200;
export const PRODUCT_ARCHIVED_PAGE = 50;
export const PRODUCT_STOCK_MAX = 100_000;
export const SALE_QUANTITY_MAX = 99;
/** How many products one sale can hold (18q): each is a line of its own. */
export const SALE_LINES_MAX = 20;
/** How many of a day's sales the Sell page lists, newest first. */
export const SALES_SHOWN = 100;
/** How many of a person's purchases their page lists, newest first. */
export const PURCHASES_SHOWN = 20;
export const SALE_PEOPLE_FOUND = 8;

/** The thousandths of a percent in a whole: 100% is 100,000. */
const PCM_WHOLE = 100_000;
/** How many named tax rates a gym can have (18b-iii). */
export const TAX_RATES_MAX = 10;
export const TAX_NAME_MAX = 30;

/** Whether a country's shelf prices already hold the tax. In the United States and
 *  Canada sales tax is added at the till; where VAT or GST is charged the price shown is
 *  the price paid. What a gym starts on until it picks for itself. */
export function taxIncludedForCountry(country: string | null): boolean {
  const code = country === null ? "" : country.trim().toUpperCase();
  return code !== "US" && code !== "CA";
}

/** The tax a business in each country charges, by the name its tax office uses (18b-iv):
 *  what the tax box suggests, never a rate. A total Record, so a country added to the list
 *  without its tax name does not compile. */
const COUNTRY_TAX_NAME: Readonly<Record<SupportedCountry, string>> = {
  US: "Sales tax",
  GB: "VAT",
  IE: "VAT",
  FR: "VAT",
  ES: "VAT",
  IN: "GST",
  AU: "GST",
  CA: "GST",
  JP: "Consumption tax",
};

/** The tax name a gym in this country is offered; null with no country, or one not served. */
export function taxNameForCountry(country: string | null): string | null {
  if (country === null) return null;
  const parsed = supportedCountrySchema.safeParse(country.trim().toUpperCase());
  return parsed.success ? COUNTRY_TAX_NAME[parsed.data] : null;
}

/** A typed rate as thousandths of a percent, or null where it is not plainly a rate:
 *  digits and at most one point, no more than three decimals, no more than the cap. */
export function taxRateToPcm(text: string): number | null {
  const match = /^(\d{1,2})(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (match === null) return null;
  const pcm = Number(match[1] ?? "0") * 1000 + Number((match[2] ?? "").padEnd(3, "0") || "0");
  return pcm <= SALES_TAX_PCM_MAX ? pcm : null;
}

/** 9975 → "9.975", 8250 → "8.25", 20000 → "20": the inverse of `taxRateToPcm`. */
export function pcmToTaxRateText(pcm: number): string {
  const whole = Math.trunc(pcm / 1000);
  const rest = pcm % 1000;
  if (rest === 0) return String(whole);
  return `${String(whole)}.${String(rest).padStart(3, "0").replace(/0+$/, "")}`;
}

export interface SaleAmounts {
  /** The price before tax. */
  netMinor: number;
  /** All of its tax: `taxParts` added up. */
  taxMinor: number;
  /** Each rate's tax, in the order the rates were given (18b-v-a). */
  taxParts: number[];
  /** What the person pays. */
  totalMinor: number;
}

export type SaleAmountsResult = ({ ok: true } & SaleAmounts) | { ok: false; reason: "not_an_amount" | "too_much" | "nothing_to_pay" };

/** The tax a bill is opened with: the rate's name and percentage as they are that day, and
 *  whether the gym's prices hold it. */
export interface TaxApplied {
  name: string;
  pcm: number;
  included: boolean;
}

/** WHAT ONE SALE COMES TO. Whole-number arithmetic throughout, each tax rounded to the
 *  nearest minor unit (a half goes up).
 *
 *  Tax on top: the price is before tax, and each rate's tax is worked out on that price on
 *  its own, never tax on tax (as Revenu Québec has GST and QST worked out since 2013), and
 *  added. Tax in the price: the price is what the person pays; the tax inside it is worked
 *  out at all the rates together, and shared between them in proportion, each part within
 *  a minor unit of its exact share, the units left over going to the largest remainders
 *  (the first rate where two are equal). Either way the numbers add up:
 *  `netMinor + taxMinor === totalMinor`, and `taxParts` add up to `taxMinor`.
 *
 *  A discount comes off the price as the gym lists it (before tax where tax is added, with
 *  it where it is included), and the tax is worked out on what is left. A sale has to
 *  leave something to pay. */
export function saleAmounts(input: {
  unitPriceMinor: number;
  quantity: number;
  /** Each rate charged on it, thousandths of a percent; empty for no tax. */
  taxPcms: readonly number[];
  taxIncluded: boolean;
  /** What a discount takes off the price times how many (`discountOff`); 0 for none. */
  discountMinor?: number;
}): SaleAmountsResult {
  const { unitPriceMinor, quantity, taxPcms } = input;
  const discountMinor = input.discountMinor ?? 0;
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 1) return { ok: false, reason: "not_an_amount" };
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > SALE_QUANTITY_MAX) return { ok: false, reason: "not_an_amount" };
  if (taxPcms.length > TAX_RATES_MAX || taxPcms.some((p) => !Number.isSafeInteger(p) || p < 1 || p > SALES_TAX_PCM_MAX)) return { ok: false, reason: "not_an_amount" };
  const together = taxPcms.reduce((n, p) => n + p, 0);
  if (together > SALES_TAX_PCM_MAX) return { ok: false, reason: "not_an_amount" };
  const full = unitPriceMinor * quantity;
  if (!Number.isSafeInteger(discountMinor) || discountMinor < 0 || discountMinor > full) return { ok: false, reason: "not_an_amount" };
  const listed = full - discountMinor;
  if (listed < 1) return { ok: false, reason: "nothing_to_pay" };
  let amounts: SaleAmounts;
  if (together === 0) {
    amounts = { netMinor: listed, taxMinor: 0, taxParts: [], totalMinor: listed };
  } else if (input.taxIncluded) {
    const taxMinor = Math.floor((2 * listed * together + (PCM_WHOLE + together)) / (2 * (PCM_WHOLE + together)));
    amounts = { netMinor: listed - taxMinor, taxMinor, taxParts: shareTax(taxMinor, taxPcms), totalMinor: listed };
  } else {
    const taxParts = taxPcms.map((p) => Math.floor((listed * p + PCM_WHOLE / 2) / PCM_WHOLE));
    const taxMinor = taxParts.reduce((n, m) => n + m, 0);
    amounts = { netMinor: listed, taxMinor, taxParts, totalMinor: listed + taxMinor };
  }
  if (amounts.totalMinor > MEMBERSHIP_PRICE_MINOR_MAX) return { ok: false, reason: "too_much" };
  return { ok: true, ...amounts };
}

/** The tax inside a price shared between its rates in proportion: each part its exact share
 *  rounded down, then one more unit to each of the largest remainders until the parts add up
 *  to `taxMinor`. */
function shareTax(taxMinor: number, pcms: readonly number[]): number[] {
  const together = pcms.reduce((n, p) => n + p, 0);
  const parts = pcms.map((p) => Math.floor((taxMinor * p) / together));
  let left = taxMinor - parts.reduce((n, m) => n + m, 0);
  const byRemainder = pcms.map((p, i) => ({ i, rest: (taxMinor * p) % together })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left === 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    left -= 1;
  }
  return parts;
}

/** WHAT ONE MEMBERSHIP BILL COMES TO (18b-iii): its price, after any discount, with the tax
 *  of the rate its membership was sold with, by `saleAmounts`' own arithmetic. The bill's
 *  amount is `totalMinor`, what the person pays; `taxMinor` is the part of it that is tax. */
export function billAmounts(listedMinor: number, tax: TaxApplied | null): SaleAmountsResult {
  return saleAmounts({ unitPriceMinor: listedMinor, quantity: 1, taxPcms: tax === null ? [] : [tax.pcm], taxIncluded: tax?.included ?? false });
}

// ── The wire ────────────────────────────────────────────────────────────────

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(MEMBERSHIP_PRICE_MINOR_MAX);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
/** A named rate's percentage: a rate of 0 is no rate, and is "No tax" instead. */
const ratePcmSchema = z.number().int().min(1).max(SALES_TAX_PCM_MAX);
/** Trimmed, one line, nothing hidden: a tax's name is printed on a bill and a receipt. */
const taxNameSchema = z.string().trim().min(1).max(TAX_NAME_MAX).regex(VISIBLE_TEXT);
/** Trimmed, one line, nothing hidden: a product's name is printed on a receipt (18g). */
const productNameSchema = z.string().trim().min(1).max(PRODUCT_NAME_MAX).regex(VISIBLE_TEXT);
const stockSchema = z.number().int().min(0).max(PRODUCT_STOCK_MAX);

export const gymProductSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    priceMinor: minorSchema,
    currency: currencySchema,
    /** The gym's tax rates charged on it, in the order they were picked; empty for no tax (18b-v-a). */
    taxRateIds: z.array(z.string().uuid()).max(TAX_RATES_MAX),
    /** How many are left; null where the gym does not count it. */
    stock: stockSchema.nullable(),
    archivedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type GymProduct = z.infer<typeof gymProductSchema>;

export const saveGymProductRequestSchema = z
  .object({
    name: productNameSchema,
    priceMinor: z.number().int().min(1).max(MEMBERSHIP_PRICE_MINOR_MAX),
    /** The gym's rates it charges, each once; together at most 30% (checked on the server). */
    taxRateIds: z
      .array(z.string().uuid())
      .max(TAX_RATES_MAX)
      .refine((ids) => new Set(ids).size === ids.length, "rate_twice"),
    stock: stockSchema.nullable(),
  })
  .strict();
export type SaveGymProductRequest = z.infer<typeof saveGymProductRequestSchema>;

/** `updatedAt` is the product as the form read it: a sale or another change since then
 *  refuses the save, so a stock count never goes back to an older number. */
export const updateGymProductRequestSchema = saveGymProductRequestSchema.extend({ updatedAt: z.string().datetime() }).strict();
export type UpdateGymProductRequest = z.infer<typeof updateGymProductRequestSchema>;

/** One of the gym's named tax rates (18b-iii), with what charges it: so the screen can say
 *  what a change reaches before it is made, and why one in use cannot be removed. */
export const gymTaxRateSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    pcm: ratePcmSchema,
    /** Products on sale that charge it. */
    products: z.number().int().min(0),
    /** Membership types on the price list that charge it. */
    membershipTypes: z.number().int().min(0),
    /** Memberships people hold, not yet over, whose bills charge it. */
    memberships: z.number().int().min(0),
  })
  .strict();
export type GymTaxRate = z.infer<typeof gymTaxRateSchema>;

/** The gym's tax: its rates, by name, and whether its prices already hold the tax or it is
 *  added on top. One way for the whole gym, as a country charges it. */
export const salesTaxSchema = z.object({ included: z.boolean(), rates: z.array(gymTaxRateSchema).max(TAX_RATES_MAX) }).strict();
export type SalesTax = z.infer<typeof salesTaxSchema>;

/** Whether the gym's prices hold the tax. */
export const taxModeRequestSchema = z.object({ included: z.boolean() }).strict();
export type TaxModeRequest = z.infer<typeof taxModeRequestSchema>;

export const saveTaxRateRequestSchema = z.object({ name: taxNameSchema, pcm: ratePcmSchema }).strict();
export type SaveTaxRateRequest = z.infer<typeof saveTaxRateRequestSchema>;

/** WHAT CHARGES ONE RATE, set in one press (18b-iii): the gym's membership types, or its
 *  products, that charge it, every one of them. One of that kind on the list now charges
 *  this rate; one not on it that charged this rate no longer does. A type that charged
 *  another rate and is on the list charges this one instead; a product keeps its other
 *  rates and charges this one as well (18b-v-a). */
export const chargeTaxRateRequestSchema = z
  .object({
    use: z.enum(["memberships", "products"]),
    ids: z.array(z.string().uuid()).max(200),
  })
  .strict();
export type ChargeTaxRateRequest = z.infer<typeof chargeTaxRateRequestSchema>;

/** Why staff voided a sale (18o): picked, never typed. */
export const SALE_VOID_REASONS = ["mistake", "wrong_item", "returned", "other"] as const;
export const saleVoidReasonSchema = z.enum(SALE_VOID_REASONS);
export type SaleVoidReason = z.infer<typeof saleVoidReasonSchema>;

export const SALE_VOID_REASON_WORDS: Readonly<Record<SaleVoidReason, string>> = {
  mistake: "Recorded by mistake",
  wrong_item: "Wrong product or quantity",
  returned: "Brought back",
  other: "Something else",
};

/** One tax a sale line was sold with (18b-v-a). `name` is null for a sale made before a
 *  gym's rates had names. */
export const saleTaxSchema = z.object({ name: z.string().nullable(), pcm: ratePcmSchema, minor: minorSchema }).strict();
export type SaleTax = z.infer<typeof saleTaxSchema>;

export const gymSaleSchema = z
  .object({
    id: z.string().uuid(),
    /** The product as it was named and priced when it was sold. */
    itemName: z.string(),
    quantity: z.number().int().min(1).max(SALE_QUANTITY_MAX),
    unitPriceMinor: minorSchema,
    netMinor: minorSchema,
    taxMinor: minorSchema,
    totalMinor: minorSchema,
    /** Each tax it was sold with, by its name and rate then, and how much (18b-v-a); empty
     *  where none was charged. `minor` adds up to `taxMinor`. */
    taxes: z.array(saleTaxSchema).max(TAX_RATES_MAX),
    taxIncluded: z.boolean(),
    /** The discount it was sold with, as it was named then, and what it took off; null and
     *  0 where there was none. */
    discountName: z.string().nullable(),
    discountMinor: minorSchema,
    /** Where that discount was a member's Refer a friend gift (20e-ii-b-ii-a): the friend they
     *  invited, by the gym's list; null otherwise, or where that record is gone. */
    giftFor: z.string().nullable().default(null),
    currency: currencySchema,
    method: salePaymentMethodSchema,
    /** The gym's own day, and the instant. */
    soldOn: daySchema,
    soldAt: z.string().datetime(),
    /** The member of staff who sold it; null where they have since left the app. */
    by: z.string().nullable(),
    /** Who bought it; null for a walk-in, or for somebody whose record was deleted for good
     *  since (`personDeleted`). */
    person: z.object({ entryId: z.string().uuid(), name: z.string() }).strict().nullable(),
    personDeleted: z.boolean(),
    /** Staff voided the sale: kept, and counted in nothing. */
    undone: z.boolean(),
    /** Who voided it, on the gym's own day, and why (18o); null while it stands. The reason
     *  is null for one voided before reasons were kept. */
    voided: z.object({ reason: saleVoidReasonSchema.nullable(), on: daySchema, by: z.string().nullable() }).strict().nullable(),
    /** Whether it can still be voided: a sale of the gym's own today with no refund standing. */
    canUndo: z.boolean(),
    /** Its refunds, oldest first, voided ones too (18p). */
    refunds: z.array(saleRefundSchema).default([]),
    /** What the refunds that stand gave back. */
    refundedMinor: minorSchema.default(0),
    /** It took from the product's stock count, so a refund can put some back on the shelf. */
    stockCounted: z.boolean().default(false),
    /** Whether money can still be given back for it: it stands, and not all of it went back. */
    canRefund: z.boolean().default(false),
    /** It can go back to the card through Square (18d-iv-b-ii): `canRefund`, on a sale paid on the Terminal. */
    toCard: z.boolean().default(false),
    /** A refund to the card Square has not answered: `lost`, never answered, so it is checked in Square. */
    cardRefund: cardRefundOpenSchema.nullable().default(null),
    /** The chargebacks on the payment (18d-iv-e-i), on the sale's first line, for staff who may sell. */
    chargebacks: z.array(chargebackSeenSchema).default([]),
    /** Refunded in Square, or a chargeback lost (18d-iv-e-ii-b), with no product said (18d-iv-d-ii), on the sale's first line: staff choose, and the money counts from then. */
    toPlace: z.array(z.object({ pressId: z.string().uuid(), chargeback: z.boolean().default(false), amountMinor: minorSchema, on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), room: z.array(z.object({ saleId: z.string().uuid(), minor: minorSchema }).strict()) }).strict()).default([]),
    /** Its product, to open from the sale. */
    productId: z.string().uuid().nullable().default(null),
    /** Its receipt's number, the gym's own (18g-i): every line of one sale has the same. */
    receiptNumber: receiptNumberSchema,
    /** Its place in its sale, from 1 (18q). Who bought it, how it was paid, its day and
     *  whether it was voided are the whole sale's, the same on each of its lines. */
    lineNo: z.number().int().min(1).max(SALE_LINES_MAX).default(1),
  })
  .strict();
export type GymSale = z.infer<typeof gymSaleSchema>;

/** ONE SALE AS STAFF SEE IT (18q): its lines, in the order they were rung up, and what it
 *  came to. A list of lines from the server is made into sales here, the newest first as
 *  the list had them, so every screen draws a sale the same way. */
export interface SaleBasket<S extends GymSale = GymSale> {
  receiptNumber: number;
  /** The first line, which carries what is the whole sale's. */
  first: S;
  lines: S[];
  totalMinor: number;
  taxMinor: number;
  discountMinor: number;
  /** What the refunds that stand on its lines gave back. */
  refundedMinor: number;
}

export function saleBaskets<S extends GymSale>(sales: readonly S[]): SaleBasket<S>[] {
  const byNumber = new Map<number, S[]>();
  for (const sale of sales) {
    const lines = byNumber.get(sale.receiptNumber);
    if (lines === undefined) byNumber.set(sale.receiptNumber, [sale]);
    else lines.push(sale);
  }
  const baskets: SaleBasket<S>[] = [];
  for (const [receiptNumber, unsorted] of byNumber) {
    const lines = [...unsorted].sort((a, b) => a.lineNo - b.lineNo);
    const first = lines[0];
    if (first === undefined) continue;
    const sum = (pick: (s: S) => number): number => lines.reduce((n, s) => n + pick(s), 0);
    baskets.push({
      receiptNumber,
      first,
      lines,
      totalMinor: sum((s) => s.totalMinor),
      taxMinor: sum((s) => s.taxMinor),
      discountMinor: sum((s) => s.discountMinor),
      refundedMinor: sum((s) => s.refundedMinor),
    });
  }
  return baskets;
}

export const voidSaleRequestSchema = z.object({ reason: saleVoidReasonSchema }).strict();
export type VoidSaleRequest = z.infer<typeof voidSaleRequestSchema>;

/** A payment for a membership recorded today, here or on the person's page: the
 *  notebook's own row (`memberBills.ts`), listed so the day's takings are whole. */
export const dayPaymentSchema = z
  .object({
    id: z.string().uuid(),
    /** The membership it was for, by the name it was sold under. */
    typeName: z.string(),
    amountMinor: minorSchema,
    currency: currencySchema,
    method: memberPaymentMethodSchema,
    paidAt: z.string().datetime(),
    by: z.string().nullable(),
    /** Who paid; null where their record was deleted for good since (18m): the payment
     *  stays in the day's takings, with no name. */
    person: z.object({ entryId: z.string().uuid(), name: z.string() }).strict().nullable(),
    /** Its receipt's number, the gym's own (18g-i). */
    receiptNumber: receiptNumberSchema,
    /** A late cancel, no-show or freeze fee rather than the membership itself (18q-ii). */
    kind: z.enum(["membership", "fee"]),
  })
  .strict();
export type DayPayment = z.infer<typeof dayPaymentSchema>;

/** The day's takings in the gym's own money: product sales that stand and membership
 *  payments that stand, together, by how each was paid. Refunds noted today are said
 *  beside the total, never taken off it. A sale or payment taken in another money (the
 *  gym changed its country) is in no sum here: `otherCurrency` says how many there are. */
export const saleTotalsSchema = z
  .object({
    /** Product sales that stand. */
    count: z.number().int().min(0),
    /** Membership payments that stand. */
    payments: z.number().int().min(0),
    totalMinor: z.number().int().min(0),
    /** The tax inside the product sales. */
    taxMinor: z.number().int().min(0),
    cash: z.number().int().min(0),
    upi: z.number().int().min(0),
    card_at_desk: z.number().int().min(0),
    bank_transfer: z.number().int().min(0),
    link: z.number().int().min(0),
    company: z.number().int().min(0),
    terminal: z.number().int().min(0),
    refundedMinor: z.number().int().min(0),
    /** What discounts took off the product sales that stand. */
    discountMinor: z.number().int().min(0),
    otherCurrency: z.number().int().min(0),
  })
  .strict();
export type SaleTotals = z.infer<typeof saleTotalsSchema>;

/** One kind's share of the day (18q-ii): product sales, membership payments (class packs and
 *  drop-ins among them), or late cancel, no-show and freeze fees. Worked out like `totals`:
 *  what stands, in the gym's own money, by how it was paid; the three add up to `totals`. */
export const kindTotalsSchema = z
  .object({
    /** Sales or payments that stand. */
    count: z.number().int().min(0),
    totalMinor: z.number().int().min(0),
    cash: z.number().int().min(0),
    upi: z.number().int().min(0),
    card_at_desk: z.number().int().min(0),
    bank_transfer: z.number().int().min(0),
    link: z.number().int().min(0),
    company: z.number().int().min(0),
    terminal: z.number().int().min(0),
    refundedMinor: z.number().int().min(0),
    otherCurrency: z.number().int().min(0),
    /** Earlier ones of this kind the list leaves out. */
    notShown: z.number().int().min(0),
  })
  .strict();
export type KindTotals = z.infer<typeof kindTotalsSchema>;

/** The Sell page: what there is to sell, the gym's tax, and today's sales. */
export const sellPageResponseSchema = z
  .object({
    /** null where the gym's country has no money to price in. */
    currency: currencySchema.nullable(),
    today: daySchema,
    /** The day whose sales and payments are listed: today, or an earlier day staff picked (18p). */
    day: daySchema,
    tax: salesTaxSchema,
    products: z.array(gymProductSchema),
    archived: z.array(gymProductSchema),
    archivedTotal: z.number().int().min(0),
    /** The gym's discounts that are not archived, by name. */
    discounts: z.array(gymDiscountSchema),
    archivedDiscounts: z.array(gymDiscountSchema),
    archivedDiscountsTotal: z.number().int().min(0),
    /** The gym's membership types on its price list, by name: what a discount can be
     *  limited to (18b-ii-b). */
    membershipTypes: z.array(
      z
        .object({
          id: z.string().uuid(),
          name: z.string(),
          /** The tax rate its bills charge (18b-iii); null for none. */
          taxRateId: z.string().uuid().nullable(),
          /** Free: it opens no bill, so it charges no tax. */
          free: z.boolean(),
        })
        .strict(),
    ),
    /** May record a sale and take one back (`billing.members`). */
    canSell: z.boolean(),
    /** May change the products and the tax (`memberships.manage`). */
    canManage: z.boolean(),
    /** Today's sales, newest first: empty for a reader who cannot record a sale, with the
     *  totals at nothing, since a sale names who bought it. */
    sales: z.array(gymSaleSchema),
    salesNotShown: z.number().int().min(0),
    /** Membership payments and fees recorded today, newest first: the newest of each kind
     *  (`SALES_SHOWN` apiece); null for a reader who cannot record payments. */
    payments: z.array(dayPaymentSchema).nullable(),
    paymentsNotShown: z.number().int().min(0),
    /** Today's takings, added up. */
    totals: saleTotalsSchema,
    /** The same, for each kind (18q-ii). */
    kinds: z.object({ products: kindTotalsSchema, memberships: kindTotalsSchema, fees: kindTotalsSchema }).strict(),
  })
  .strict();
export type SellPageResponse = z.infer<typeof sellPageResponseSchema>;

/** The Sell page for an earlier day: its sales and payments, to find one to refund (18p). */
export const sellPageQuerySchema = z
  .object({ day: z.string().refine((d) => isRealDay(d) && d >= "2000-01-01", "not_a_day").optional() })
  .strict();

const saleTotalSchema = z.number().int().min(1).max(MEMBERSHIP_PRICE_MINOR_MAX);
/** The buyer's own Refer a friend gift filled in (20e-ii-b-ii-a), in place of a discount, and
 *  what the screen showed it takes off: worked out again on the server. */
const memberGiftUseSchema = z.object({ id: z.string().uuid(), offMinor: saleTotalSchema }).strict().nullable().default(null);

/** One product of a sale (18q): how many, the gym's discount on it if any, and what the
 *  screen showed it comes to. */
export const saleLineRequestSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(SALE_QUANTITY_MAX),
    discountId: z.string().uuid().nullable().default(null),
    memberGift: memberGiftUseSchema,
    totalMinor: saleTotalSchema,
  })
  .strict();

const basketRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    entryId: z.string().uuid().nullable(),
    method: memberPaymentByHandSchema,
    totalMinor: saleTotalSchema,
    lines: z.array(saleLineRequestSchema).min(1).max(SALE_LINES_MAX),
  })
  .strict();

/** A sale of one product may still be sent as that product's fields alone. */
const oneProductRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(SALE_QUANTITY_MAX),
    entryId: z.string().uuid().nullable(),
    method: memberPaymentByHandSchema,
    totalMinor: saleTotalSchema,
    discountId: z.string().uuid().nullable().default(null),
    memberGift: memberGiftUseSchema,
  })
  .strict()
  .transform(({ productId, quantity, discountId, memberGift, ...sale }) => ({
    ...sale,
    lines: [{ productId, quantity, discountId, memberGift, totalMinor: sale.totalMinor }],
  }));

/** A SALE (18q): one or more products, one buyer, one payment, one receipt. `requestKey` is
 *  made by the screen once a form: the same key twice is one sale. Each line's `totalMinor`,
 *  and the sale's, are what the screen showed: a sale that would now come to anything else
 *  is refused. `entryId` null is a walk-in. A product is one line, however many of it; the
 *  buyer's own gift goes on one line, with no discount beside it. */
export const sellProductRequestSchema = z.union([basketRequestSchema, oneProductRequestSchema]).superRefine((v, ctx) => {
  basketChecks(v, ctx);
});

function basketChecks(v: { entryId: string | null; totalMinor: number; lines: readonly { productId: string; discountId: string | null; memberGift: unknown; totalMinor: number }[] }, ctx: z.RefinementCtx): void {
  const products = new Set(v.lines.map((l) => l.productId));
  if (products.size !== v.lines.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "product_twice" });
  const gifts = v.lines.filter((l) => l.memberGift !== null);
  if (gifts.length > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "member_gift_once" });
  if (gifts.some((l) => l.discountId !== null) || (gifts.length > 0 && v.entryId === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "member_gift_alone" });
  if (v.lines.reduce((n, l) => n + l.totalMinor, 0) !== v.totalMinor) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "total_not_lines" });
}
export type SellProductRequest = z.infer<typeof sellProductRequestSchema>;
export type SaleLineRequest = SellProductRequest["lines"][number];
/** The same, as a screen sends it: a line's `discountId` may be left out. */
export type SellProductRequestBody = z.input<typeof sellProductRequestSchema>;

/** Take payment on Terminal at Sell (18d-vi-b-ii): the basket as a sale by hand sends it, and the
 *  gym's Terminal it goes to in place of a payment method. */
export const terminalSaleRequestSchema = z
  .object({
    terminalId: z.string().uuid(),
    requestKey: z.string().uuid(),
    entryId: z.string().uuid().nullable(),
    totalMinor: saleTotalSchema,
    lines: z.array(saleLineRequestSchema).min(1).max(SALE_LINES_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    basketChecks(v, ctx);
  });
export type TerminalSaleRequest = z.infer<typeof terminalSaleRequestSchema>;
export type TerminalSaleRequestBody = z.input<typeof terminalSaleRequestSchema>;

/** `saleId` is the sale's first line; every line of it has `receiptNumber`. */
export const sellProductResponseSchema = z.object({ saleId: z.string().uuid(), receiptNumber: receiptNumberSchema, register: sellPageResponseSchema }).strict();
export type SellProductResponse = z.infer<typeof sellProductResponseSchema>;

export const salePeopleQuerySchema = z.object({ query: z.string().trim().min(2).max(80) }).strict();

export const salePersonSchema = z
  .object({
    entryId: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    memberNumber: z.string().nullable(),
    /** A past member: can buy a product, and cannot be given a membership. */
    past: z.boolean(),
  })
  .strict();
export type SalePerson = z.infer<typeof salePersonSchema>;

export const salePeopleResponseSchema = z.object({ people: z.array(salePersonSchema) }).strict();
export type SalePeopleResponse = z.infer<typeof salePeopleResponseSchema>;

/** What one person has bought at the desk, newest first. */
export const memberPurchasesResponseSchema = z
  .object({ sales: z.array(gymSaleSchema), notShown: z.number().int().min(0) })
  .strict();
export type MemberPurchasesResponse = z.infer<typeof memberPurchasesResponseSchema>;

/** The server's sentences, one place for the routes and the screen's tests. */
export const REGISTER_WORDS = {
  product_not_found: "That product is no longer for sale. Pick another.",
  person_not_found: "That person was not found on your list. Pick them again, or sell to a walk-in.",
  price_changed: "The price or the tax changed while this was open. Nothing was sold: check the total and press again.",
  rate_not_found: "That tax rate was not found. Pick another, or choose No tax.",
  charged_not_found: "Something on this list was archived or removed while it was open. Nothing was saved: tick them again.",
  rate_name_taken: "You already have a tax rate with this name. Pick another name.",
  too_many_rates: `You can have ${String(TAX_RATES_MAX)} tax rates. Remove one you no longer charge first.`,
  taxed_price_too_high: "This price is too high to charge tax on. Lower the price, or choose No tax.",
  taxes_over_cap: "A product's taxes can come to 30% at most together. Untick one, or lower a rate.",
  request_reused: "That form was already used for another sale. Nothing was sold: start the sale again.",
  sale_not_found: "That sale was not found.",
  sale_not_today: "Only a sale made today can be voided here.",
  no_currency: "Set your country in Settings before adding a product.",
  name_taken: "You already have a product with this name. Pick another name.",
  changed: "This product changed while you had it open, or one was sold. Nothing was saved: check it and try again.",
  no_selling: "Selling isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.",
  no_managing: "Changing products and tax isn't part of your role. Ask the owner to turn on \"Change membership types and prices\" for you.",
} as const;

/** A product priced in a money the gym no longer uses (it changed its country): it is
 *  not sold until its price is saved again, so a day's total is never two moneys added. */
export function productCurrencyWords(name: string, was: string, now: string | null): string {
  if (now === null) return `${name} is priced in ${was}. Nothing was sold: set your country in Settings first.`;
  return `${name} is priced in ${was}, and you now sell in ${now}. Nothing was sold: open ${name} under Products and save its price in ${now}.`;
}

const counted = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** Why a tax rate was not removed: what still charges it, and what to do. */
export function taxRateInUseWords(name: string, uses: { products: number; membershipTypes: number; memberships: number }): string {
  const parts = [
    uses.products > 0 ? counted(uses.products, "product", "products") : null,
    uses.membershipTypes > 0 ? counted(uses.membershipTypes, "membership type", "membership types") : null,
    uses.memberships > 0 ? counted(uses.memberships, "member's membership", "members' memberships") : null,
  ].filter((p): p is string => p !== null);
  const list = parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
  const first = `${name} was not removed: it is charged on ${list}.`;
  const change = uses.products > 0 || uses.membershipTypes > 0 ? " Take it off them first." : "";
  const held =
    uses.memberships > 0
      ? ` A membership keeps the tax it was sold with, so ${name} can be removed once nobody holds one. You can still change its name or rate.`
      : "";
  return first + change + held;
}

/** Why a change to a rate, or to what it is charged on, was refused (18b-v-a): one product's
 *  taxes would come to more than 30% together. */
export function taxesOverCapWords(product: string): string {
  return `Nothing was saved: the taxes on ${product} would come to more than 30% together. Take a tax off ${product} first, or lower the rate.`;
}

/** A discount that takes a set amount off, or Refer a friend's gift, on more than one product
 *  of a sale (18q): it is taken off once a sale. */
export function oneLineOnlyWords(name: string): string {
  return `${name} can go on one product of a sale. Nothing was sold: leave it on one product only.`;
}

/** How many are left, said to staff who asked for more. */
export function outOfStockWords(name: string, left: number): string {
  if (left === 0) return `${name} is out of stock. Nothing was sold. If you have more, change the stock count under Products.`;
  return `Only ${String(left)} of ${name} left in stock. Nothing was sold. Sell ${String(left)} or fewer, or change the stock count under Products.`;
}
