// Packaged foods by barcode (ROADMAP Stage 5 33b-iii-a; rulings/2026-10-30-33b-iii-a.md): what a code
// on a pack is, the server's reply about it, and the shape of Open Food Facts' files.
import { z } from "zod";
import { foodSearchItemSchema, packagedCheckSchema } from "./nutrition.js";

/** GS1's check digit: the last digit is worked out from the others, so a misread digit fails. */
export function barcodeCheckDigitOk(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  const digits = Array.from(code, Number);
  const given = digits.pop();
  let sum = 0;
  for (const [at, digit] of digits.reverse().entries()) sum += digit * (at % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === given;
}

/** A UPC-E, the short code on small packs, written out as the UPC-A it stands for (GS1's table for
 *  its last digit). Looked up as printed it would land on an EAN-8 of the same digits. */
export function upcEToUpcA(upcE: string): string | null {
  if (!/^[01]\d{7}$/.test(upcE)) return null;
  const digit = (at: number): string => upcE.charAt(at);
  const [system, a, b, c, d, e, last, check] = [digit(0), digit(1), digit(2), digit(3), digit(4), digit(5), digit(6), digit(7)];
  const body =
    last === "0" || last === "1" || last === "2"
      ? `${a}${b}${last}0000${c}${d}${e}`
      : last === "3"
        ? `${a}${b}${c}00000${d}${e}`
        : last === "4"
          ? `${a}${b}${c}${d}00000${e}`
          : `${a}${b}${c}${d}${e}0000${last}`;
  const upcA = `${system}${body}${check}`;
  // Its check digit belongs to the long form, not to the eight digits printed.
  return barcodeCheckDigitOk(upcA) ? upcA : null;
}

/** A code a store or a company prints for itself (GS1's restricted prefixes): 02, 04 and 20 to 29,
 *  and the short ones that begin 0 or 2. The same number is another food elsewhere: 00002523 is a
 *  Sainsbury's peach, 00001816 a Trader Joe's bread. */
const STORE_ONLY_13 = /^(?:02|04|2\d)/;
const STORE_ONLY_8 = /^[02]/;
/** Coupons, magazines and books: not a food. */
const NOT_A_FOOD_13 = /^(?:05|97[7-9]|98|99)/;

export type BarcodeKind = { kind: "product"; code: string } | { kind: "store_only" } | { kind: "not_a_food" } | { kind: "bad" };

/** What a code is, and the one way it is written for a lookup: Open Food Facts' own rule, so a UPC-A
 *  of 12 digits and its 13-digit form are one product (its "Barcode Normalization" page). */
export function classifyBarcode(raw: string): BarcodeKind {
  if (!/^\d{8}$|^\d{12,14}$/.test(raw) || !barcodeCheckDigitOk(raw)) return { kind: "bad" };
  const bare = raw.replace(/^0+/, "");
  if (bare.length <= 7) return { kind: "store_only" };
  if (bare.length === 8) return STORE_ONLY_8.test(bare) ? { kind: "store_only" } : { kind: "product", code: bare };
  if (bare.length === 14) return { kind: "product", code: bare };
  const code = bare.padStart(13, "0");
  if (STORE_ONLY_13.test(code)) return { kind: "store_only" };
  if (NOT_A_FOOD_13.test(code)) return { kind: "not_a_food" };
  return { kind: "product", code };
}

/** The lookup's address. Digits only, so nothing else reaches a query. */
export const barcodeParamSchema = z.object({ code: z.string().regex(/^\d{8,14}$/) }).strict();

/** The reply. `allergens` and `mayContain` are words of Open Food Facts' own list of allergens: most
 *  products have neither, so an empty list says nothing about the food and must never read as safe. */
export const barcodeReplySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("found"),
    code: z.string(),
    food: foodSearchItemSchema,
    allergens: z.array(z.string()),
    mayContain: z.array(z.string()),
    /** Other words in those fields, as somebody typed them ("gluten free", "weizeneiweiß"): shown as
     *  typed, never under Contains. */
    listedAsTyped: z.array(z.string()),
    /** Whose words the three lists are, for the credit: USDA keeps none. */
    allergensFrom: z.literal("openfoodfacts").nullable(),
    check: packagedCheckSchema,
    /** Set where this is the person's own saved label, not a list's product. */
    labelId: z.string().uuid().optional(),
    /** When that label was last saved: sent back with a change to it. */
    labelSeen: z.string().optional(),
  }).strict(),
  z.object({ status: z.literal("not_found"), code: z.string() }).strict(),
  z.object({ status: z.literal("store_only") }).strict(),
  z.object({ status: z.literal("not_a_food") }).strict(),
  z.object({ status: z.literal("bad_code") }).strict(),
]);
export type BarcodeReply = z.infer<typeof barcodeReplySchema>;

/** A person's saved labels, newest first: the way back to one with no barcode. */
export const labelFoodsSchema = z.object({ items: z.array(barcodeReplySchema) }).strict();

// ── Open Food Facts' files ───────────────────────────────────────────────────

const words = z.union([z.string(), z.array(z.string())]);

/** One product, read from either file into one shape. `figures` holds each figure per 100 g in
 *  grams, under the file's own `_100g` names; a figure the label does not give is left out. */
export const offProductSchema = z.object({
  code: z.string(),
  name: words.optional(),
  genericName: words.optional(),
  brands: words.optional(),
  servingSize: z.string().optional(),
  quantity: z.string().optional(),
  allergens: z.array(z.string()),
  traces: z.array(z.string()),
  figures: z.record(z.string(), z.number()),
  /** How many people have scanned it: what the food search puts first. */
  scans: z.number().int().nonnegative().optional(),
});
export type OffProduct = z.infer<typeof offProductSchema>;

/** One figure of the daily file's per-100-g set. `source: "estimate"` is Open Food Facts' own guess
 *  from the ingredients, never the label. */
const dailyFigureSchema = z.object({ value: z.number().optional(), unit: z.string().optional(), source: z.string().optional() });

/** One line of the daily file. Its `nutriments` is empty: the numbers are in `nutrition.aggregated_set`. */
export const offDailyLineSchema = z.object({
  code: z.union([z.string(), z.number()]),
  product_name: words.nullish(),
  generic_name: words.nullish(),
  brands: words.nullish(),
  serving_size: z.string().nullish(),
  quantity: z.string().nullish(),
  allergens_tags: z.array(z.string()).nullish(),
  traces_tags: z.array(z.string()).nullish(),
  nutrition: z.object({
    aggregated_set: z.object({
      per: z.string().optional(),
      preparation: z.string().optional(),
      nutrients: z.record(z.string(), dailyFigureSchema).optional(),
    }).optional(),
  }).nullish(),
}).catchall(z.unknown());
export type OffDailyLine = z.infer<typeof offDailyLineSchema>;

/** A daily file's name, which says the seconds it runs from and to. */
export const OFF_DAILY_FILE = /^openfoodfacts_products_(\d{9,11})_(\d{9,11})\.json\.gz$/;
