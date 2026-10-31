import { labelFoodSaveSchema, type LabelDraft, type LabelFoodSave, type PhotoScansLeft } from "@app/shared";
import type { FoundProduct } from "./barcode";
import { formatAmount } from "./measures";

// A pack's label on the phone (ROADMAP Stage 5 33b-iii-c): how many photo scans are left, what the
// check box holds as typed, and what is sent or still missing.

const windowWords = (window: PhotoScansLeft["window"]): string => (window === "day" ? "today" : "this month");
const nextWords = (window: PhotoScansLeft["window"]): string => (window === "day" ? "More tomorrow." : "More next month.");

/** "5 of 7 photo scans left today." Null where the count could not be read: nothing is said then. */
export function scansLeftWords(scans: PhotoScansLeft | null): string | null {
  if (scans === null || scans.left === null) return null;
  if (scans.left === 0) return `No photo scans left. ${nextWords(scans.window)}`;
  return `${String(scans.left)} of ${String(scans.limit)} photo scans left ${windowWords(scans.window)}.`;
}

/** Said under "Photo of the label": what it costs, before it is pressed. */
export function labelCostWords(scans: PhotoScansLeft | null): string {
  if (scans === null || scans.left === null) return "Uses 1 photo scan.";
  return `Uses 1 photo scan. ${String(scans.left)} of ${String(scans.limit)} left ${windowWords(scans.window)}.`;
}

/** Whether "Photo of the label" can be offered. A count not read does not take it away. */
export const canReadLabel = (scans: PhotoScansLeft | null): boolean => scans?.left !== 0;

/** What the check box holds, as typed. */
export interface TypedLabel {
  name: string;
  amount: string;
  unit: "g" | "ml";
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  contains: string;
  mayContain: string;
  servingAmount: number | null;
}

const shown = (n: number | null): string => (n === null ? "" : formatAmount(n));

/** A read: what was printed, and a box left empty for what could not be read, never a 0. */
export function typedFromDraft(draft: LabelDraft): TypedLabel {
  return {
    name: draft.name ?? "",
    amount: formatAmount(draft.amount),
    unit: draft.unit,
    kcal: shown(draft.kcal),
    proteinG: shown(draft.proteinG),
    carbsG: shown(draft.carbsG),
    fatG: shown(draft.fatG),
    contains: draft.contains.join(", "),
    mayContain: draft.mayContain.join(", "),
    servingAmount: draft.servingAmount,
  };
}

/** A saved label, to change: per 100 g or ml, as it is kept. */
export function typedFromProduct(product: FoundProduct): TypedLabel {
  const f = product.food;
  return {
    name: f.name,
    amount: "100",
    unit: f.unit === "ml" ? "ml" : "g",
    kcal: formatAmount(Math.round(f.kcal * 10) / 10),
    proteinG: formatAmount(Math.round(f.proteinG * 10) / 10),
    carbsG: formatAmount(Math.round(f.carbsG * 10) / 10),
    fatG: formatAmount(Math.round(f.fatG * 10) / 10),
    contains: product.allergens.join(", "),
    mayContain: product.mayContain.join(", "),
    servingAmount: f.serving,
  };
}

const number = (text: string): number | null => {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const words = (text: string): string[] => [...new Set(text.split(/[,;\n]/).map((w) => w.trim()).filter((w) => w !== ""))];

/** What is sent, or what is still missing. An empty box is never a 0: 0 is typed where the pack says 0. */
export function labelToSave(typed: TypedLabel, code: string | null): { body: LabelFoodSave } | { missing: string } {
  if (typed.name.trim() === "") return { missing: "Enter the food’s name." };
  const amount = number(typed.amount);
  if (amount === null || amount <= 0) return { missing: "Enter the amount these numbers are for." };
  const [kcal, proteinG, carbsG, fatG] = [number(typed.kcal), number(typed.proteinG), number(typed.carbsG), number(typed.fatG)];
  if (kcal === null || proteinG === null || carbsG === null || fatG === null) return { missing: "Enter calories, protein, carbs and fat from the pack." };
  const parsed = labelFoodSaveSchema.safeParse({
    code, name: typed.name.trim(), unit: typed.unit, amount, kcal, proteinG, carbsG, fatG,
    servingAmount: typed.servingAmount, contains: words(typed.contains), mayContain: words(typed.mayContain),
  });
  return parsed.success ? { body: parsed.data } : { missing: "Check the numbers and allergens against the pack." };
}
