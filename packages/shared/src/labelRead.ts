// A pack's nutrition label read from a photo (ROADMAP Stage 5 33b-iii-c): what the model writes, and
// which of the label's columns is the product's. Only vision.adapter.ts reads a provider's reply.
import { z } from "zod";

/** A number as Luna copies it: a number, or the label's own text ("5g", "493kcal", "3,5 g", "<1 g",
 *  "1,533 kJ"). A comma before exactly three digits separates thousands; any other is a decimal point.
 *  "<1 g" reads as 1, what is printed. A percentage, a word or anything else is not printed, never 0. */
export function printedAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const found = /^\s*(?:<|less than\s+)?\s*(\d+(?:[.,]\d+)?)\s*(?:g|mg|ml|kcal|kj|cal|calories)?\s*$/i.exec(value);
  const digits = found?.[1];
  if (digits === undefined) return null;
  const clean = /,\d{3}$/.test(digits) ? digits.replace(",", "") : digits.replace(",", ".");
  // Milligrams are not grams: a figure printed in mg is not the figure asked for.
  return /mg\s*$/i.test(value) ? null : Number(clean);
}
const printedNumber = z.preprocess(printedAmount, z.number().nullable());
const wordList = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((w): w is string => typeof w === "string" && w.trim() !== "").map((w) => w.trim().slice(0, 60)).slice(0, 30) : []),
  z.array(z.string()),
);

export const labelColumnSchema = z.object({
  per: z.preprocess((v) => (v === "100g" || v === "100ml" || v === "serving" ? v : "other"), z.enum(["100g", "100ml", "serving", "other"])),
  serving_amount: printedNumber,
  serving_unit: z.preprocess((v) => (v === "g" || v === "ml" ? v : null), z.enum(["g", "ml"]).nullable()),
  prepared: z.preprocess((v) => v === true, z.boolean()),
  kcal: printedNumber,
  kj: printedNumber,
  protein_g: printedNumber,
  carbs_g: printedNumber,
  fat_g: printedNumber,
});
export type LabelColumn = z.infer<typeof labelColumnSchema>;

export const labelEvidenceSchema = z.object({
  is_nutrition_label: z.boolean(),
  name: z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 80) : null), z.string().nullable()),
  columns: z.array(labelColumnSchema).max(8),
  contains: wordList,
  may_contain: wordList,
  photo_quality: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["good", "poor"])),
});
export type LabelEvidence = z.infer<typeof labelEvidenceSchema>;

/** What the label says, on the one basis the person is asked to check. */
export interface LabelPanel {
  /** Whether the numbers are as printed for 100 g or ml, or for one serving. */
  per: "100" | "serving";
  unit: "g" | "ml";
  /** The amount those numbers are for: 100, or the serving's. */
  amount: number;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  /** The serving printed, where one is, on either basis. */
  servingAmount: number | null;
  /** The calories came from the kJ printed, since no kcal was. */
  kcalFromKj: boolean;
}

const KJ_PER_KCAL = 4.184;

const kcalOf = (column: LabelColumn): number | null => column.kcal ?? (column.kj === null ? null : Math.round(column.kj / KJ_PER_KCAL));

/** The column to show: as sold, never as prepared, because the pack in the hand is what the barcode
 *  names; 100 g over a serving, because a serving's size is what most often misreads. A serving with
 *  no size printed cannot be used. Null where nothing printed can be: the photo is asked for again. */
export function panelOfLabel(evidence: Pick<LabelEvidence, "columns">): LabelPanel | null {
  const sold = evidence.columns.filter((c) => !c.prepared && kcalOf(c) !== null);
  const hundred = sold.find((c) => c.per === "100g" || c.per === "100ml");
  const serving = sold.find((c) => c.per === "serving" && c.serving_amount !== null && c.serving_amount > 0);
  const servingAmount = serving?.serving_amount ?? null;
  const chosen = hundred ?? serving;
  const kcal = chosen === undefined ? null : kcalOf(chosen);
  if (chosen === undefined || kcal === null) return null;
  const isHundred = chosen === hundred;
  return {
    per: isHundred ? "100" : "serving",
    unit: chosen.per === "100ml" || chosen.serving_unit === "ml" ? "ml" : "g",
    amount: isHundred ? 100 : (servingAmount ?? 100),
    kcal,
    proteinG: chosen.protein_g,
    carbsG: chosen.carbs_g,
    fatG: chosen.fat_g,
    servingAmount,
    kcalFromKj: chosen.kcal === null,
  };
}

// ── The routes (the phone's side of the read, the save and the count) ────────

const labelAmount = z.number().nonnegative().max(10_000);
const allergenWords = z.array(z.string().trim().min(1).max(60)).max(30);

/** What a read gives the person to check. Nothing of it is kept until they save. */
export const labelDraftSchema = z.object({
  name: z.string().nullable(),
  per: z.enum(["100", "serving"]),
  unit: z.enum(["g", "ml"]),
  amount: z.number().positive(),
  kcal: z.number().nonnegative(),
  proteinG: z.number().nonnegative().nullable(),
  carbsG: z.number().nonnegative().nullable(),
  fatG: z.number().nonnegative().nullable(),
  servingAmount: z.number().positive().nullable(),
  contains: z.array(z.string()),
  mayContain: z.array(z.string()),
  /** `part_missing`, a number could not be read; `doesnt_add_up`, its calories are far from its protein, carbs and fat. */
  check: z.enum(["fine", "part_missing", "doesnt_add_up"]),
}).strict();
export type LabelDraft = z.infer<typeof labelDraftSchema>;

/** The person's checked numbers, for `amount` of the food. `code` is the pack's barcode, or null where
 *  the label was read with none. */
export const labelFoodSaveSchema = z.object({
  code: z.string().regex(/^\d{8,14}$/).nullable(),
  name: z.string().trim().min(1).max(80),
  unit: z.enum(["g", "ml"]),
  amount: z.number().positive().max(10_000),
  kcal: labelAmount,
  proteinG: labelAmount,
  carbsG: labelAmount,
  fatG: labelAmount,
  servingAmount: z.number().positive().max(10_000).nullable(),
  contains: allergenWords,
  mayContain: allergenWords,
}).strict();
export type LabelFoodSave = z.infer<typeof labelFoodSaveSchema>;

export const labelFoodParamSchema = z.object({ id: z.string().uuid() }).strict();

/** How many photo scans a person has left. `left` is null where the count cannot be read: nothing is said then. */
export const photoScansLeftSchema = z.object({
  window: z.enum(["day", "month"]),
  limit: z.number().int().nonnegative(),
  left: z.number().int().nonnegative().nullable(),
}).strict();
export type PhotoScansLeft = z.infer<typeof photoScansLeftSchema>;
