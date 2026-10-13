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
import { memberPaymentByHandSchema, memberPaymentMethodSchema } from "./memberBills.js";
import { MEMBERSHIP_PRICE_MINOR_MAX } from "./memberships.js";
import { VISIBLE_TEXT } from "./visibleText.js";

export const PRODUCT_NAME_MAX = 80;
/** How many products a gym can have on sale at once. */
export const PRODUCTS_MAX = 200;
export const PRODUCT_ARCHIVED_PAGE = 50;
export const PRODUCT_STOCK_MAX = 100_000;
export const SALE_QUANTITY_MAX = 99;
/** How many of a day's sales the Sell page lists, newest first. */
export const SALES_SHOWN = 100;
/** How many of a person's purchases their page lists, newest first. */
export const PURCHASES_SHOWN = 20;
export const SALE_PEOPLE_FOUND = 8;

/** A tax rate in hundredths of a percent: 825 is 8.25%. 0 is no tax. */
export const SALES_TAX_BP_MAX = 3000;

/** Whether a country's shelf prices already hold the tax. In the United States and
 *  Canada sales tax is added at the till; where VAT or GST is charged the price shown is
 *  the price paid. What a gym starts on until it picks for itself. */
export function taxIncludedForCountry(country: string | null): boolean {
  const code = country === null ? "" : country.trim().toUpperCase();
  return code !== "US" && code !== "CA";
}

/** A typed rate as hundredths of a percent, or null where it is not plainly a rate:
 *  digits and at most one point, no more than two decimals, no more than the cap. */
export function taxRateToBp(text: string): number | null {
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const bp = Number(match[1] ?? "0") * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return bp <= SALES_TAX_BP_MAX ? bp : null;
}

/** 825 → "8.25", 2000 → "20": the inverse of `taxRateToBp`. */
export function bpToTaxRateText(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const rest = bp % 100;
  if (rest === 0) return String(whole);
  return `${String(whole)}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

export interface SaleAmounts {
  /** The price before tax. */
  netMinor: number;
  taxMinor: number;
  /** What the person pays. */
  totalMinor: number;
}

export type SaleAmountsResult = ({ ok: true } & SaleAmounts) | { ok: false; reason: "not_an_amount" | "too_much" };

/** WHAT ONE SALE COMES TO. Whole-number arithmetic throughout, the tax rounded to the
 *  nearest minor unit (a half goes up).
 *
 *  Tax on top: the price is before tax, and the tax is added. Tax in the price: the price
 *  is what the person pays, and the tax is the part of it that is tax. Either way the
 *  three numbers add up: `netMinor + taxMinor === totalMinor`. */
export function saleAmounts(input: {
  unitPriceMinor: number;
  quantity: number;
  /** Whether tax is charged on this product at all. */
  taxed: boolean;
  taxBp: number;
  taxIncluded: boolean;
}): SaleAmountsResult {
  const { unitPriceMinor, quantity, taxBp } = input;
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 1) return { ok: false, reason: "not_an_amount" };
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > SALE_QUANTITY_MAX) return { ok: false, reason: "not_an_amount" };
  if (!Number.isSafeInteger(taxBp) || taxBp < 0 || taxBp > SALES_TAX_BP_MAX) return { ok: false, reason: "not_an_amount" };
  const listed = unitPriceMinor * quantity;
  const rate = input.taxed ? taxBp : 0;
  let amounts: SaleAmounts;
  if (rate === 0) {
    amounts = { netMinor: listed, taxMinor: 0, totalMinor: listed };
  } else if (input.taxIncluded) {
    const taxMinor = Math.floor((2 * listed * rate + (10_000 + rate)) / (2 * (10_000 + rate)));
    amounts = { netMinor: listed - taxMinor, taxMinor, totalMinor: listed };
  } else {
    const taxMinor = Math.floor((listed * rate + 5_000) / 10_000);
    amounts = { netMinor: listed, taxMinor, totalMinor: listed + taxMinor };
  }
  if (amounts.totalMinor > MEMBERSHIP_PRICE_MINOR_MAX) return { ok: false, reason: "too_much" };
  return { ok: true, ...amounts };
}

// ── The wire ────────────────────────────────────────────────────────────────

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minorSchema = z.number().int().min(0).max(MEMBERSHIP_PRICE_MINOR_MAX);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const taxBpSchema = z.number().int().min(0).max(SALES_TAX_BP_MAX);
/** Trimmed, one line, nothing hidden: a product's name is printed on a receipt (18g). */
const productNameSchema = z.string().trim().min(1).max(PRODUCT_NAME_MAX).regex(VISIBLE_TEXT);
const stockSchema = z.number().int().min(0).max(PRODUCT_STOCK_MAX);

export const gymProductSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    priceMinor: minorSchema,
    currency: currencySchema,
    /** Whether the gym's tax is charged on it. */
    taxed: z.boolean(),
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
    taxed: z.boolean(),
    stock: stockSchema.nullable(),
  })
  .strict();
export type SaveGymProductRequest = z.infer<typeof saveGymProductRequestSchema>;

/** `updatedAt` is the product as the form read it: a sale or another change since then
 *  refuses the save, so a stock count never goes back to an older number. */
export const updateGymProductRequestSchema = saveGymProductRequestSchema.extend({ updatedAt: z.string().datetime() }).strict();
export type UpdateGymProductRequest = z.infer<typeof updateGymProductRequestSchema>;

export const salesTaxSchema = z.object({ bp: taxBpSchema, included: z.boolean() }).strict();
export type SalesTax = z.infer<typeof salesTaxSchema>;

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
    taxBp: taxBpSchema,
    taxIncluded: z.boolean(),
    currency: currencySchema,
    method: memberPaymentByHandSchema,
    /** The gym's own day, and the instant. */
    soldOn: daySchema,
    soldAt: z.string().datetime(),
    /** The member of staff who sold it; null where they have since left the app. */
    by: z.string().nullable(),
    /** Who bought it; null for a walk-in. */
    person: z.object({ entryId: z.string().uuid(), name: z.string() }).strict().nullable(),
    /** Staff took the sale back: kept, and counted in nothing. */
    undone: z.boolean(),
    /** Whether it can still be taken back: a sale of the gym's own today. */
    canUndo: z.boolean(),
  })
  .strict();
export type GymSale = z.infer<typeof gymSaleSchema>;

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
    person: z.object({ entryId: z.string().uuid(), name: z.string() }).strict(),
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
    card_at_desk: z.number().int().min(0),
    bank_transfer: z.number().int().min(0),
    link: z.number().int().min(0),
    company: z.number().int().min(0),
    refundedMinor: z.number().int().min(0),
    otherCurrency: z.number().int().min(0),
  })
  .strict();
export type SaleTotals = z.infer<typeof saleTotalsSchema>;

/** The Sell page: what there is to sell, the gym's tax, and today's sales. */
export const sellPageResponseSchema = z
  .object({
    /** null where the gym's country has no money to price in. */
    currency: currencySchema.nullable(),
    today: daySchema,
    tax: salesTaxSchema,
    products: z.array(gymProductSchema),
    archived: z.array(gymProductSchema),
    archivedTotal: z.number().int().min(0),
    /** May record a sale and take one back (`billing.members`). */
    canSell: z.boolean(),
    /** May change the products and the tax (`memberships.manage`). */
    canManage: z.boolean(),
    /** Today's sales, newest first: empty for a reader who cannot record a sale, with the
     *  totals at nothing, since a sale names who bought it. */
    sales: z.array(gymSaleSchema),
    salesNotShown: z.number().int().min(0),
    /** Membership payments recorded today, newest first; null for a reader who cannot
     *  record payments. */
    payments: z.array(dayPaymentSchema).nullable(),
    paymentsNotShown: z.number().int().min(0),
    /** Today's takings, added up. */
    totals: saleTotalsSchema,
  })
  .strict();
export type SellPageResponse = z.infer<typeof sellPageResponseSchema>;

/** `requestKey` is made by the screen once a form: the same key twice is one sale.
 *  `totalMinor` is the total the screen showed: a sale that would now come to anything
 *  else is refused. `entryId` null is a walk-in. */
export const sellProductRequestSchema = z
  .object({
    requestKey: z.string().uuid(),
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(SALE_QUANTITY_MAX),
    entryId: z.string().uuid().nullable(),
    method: memberPaymentByHandSchema,
    totalMinor: z.number().int().min(1).max(MEMBERSHIP_PRICE_MINOR_MAX),
  })
  .strict();
export type SellProductRequest = z.infer<typeof sellProductRequestSchema>;

export const sellProductResponseSchema = z.object({ saleId: z.string().uuid(), register: sellPageResponseSchema }).strict();
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
  request_reused: "That form was already used for another sale. Nothing was sold: start the sale again.",
  sale_not_found: "That sale was not found.",
  sale_not_today: "Only a sale made today can be undone here.",
  no_currency: "Set your country in Settings before adding a product.",
  name_taken: "You already have a product with this name. Pick another name.",
  changed: "This product changed while you had it open, or one was sold. Nothing was saved: check it and try again.",
  no_selling: "Selling isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.",
  no_managing: "Changing products and tax isn't part of your role. Ask the owner to turn on \"Change membership types and prices\" for you.",
} as const;

/** A product priced in a money the gym no longer uses (it changed its country): it is
 *  not sold until its price is saved again, so a day's total is never two moneys added. */
export function productCurrencyWords(name: string, was: string, now: string | null): string {
  if (now === null) return `${name} is priced in ${was}, and your country is not set. Nothing was sold: set your country in Settings first.`;
  return `${name} is priced in ${was}, and you now sell in ${now}. Nothing was sold: open ${name} under Products and save its price in ${now}.`;
}

/** How many are left, said to staff who asked for more. */
export function outOfStockWords(name: string, left: number): string {
  if (left === 0) return `${name} is out of stock. Nothing was sold. If you have more, change the stock count under Products.`;
  return `Only ${String(left)} of ${name} left in stock. Nothing was sold. Sell ${String(left)} or fewer, or change the stock count under Products.`;
}
