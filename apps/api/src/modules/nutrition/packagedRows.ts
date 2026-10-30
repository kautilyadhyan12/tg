// What one row of the packaged-food lists becomes (ROADMAP Stage 5 33b-iii-a), and what a person is
// told about a code both lists may hold. Pure: the importer, the nightly update and the lookup share it.
import { classifyBarcode, offProductSchema, type MoreNutrients, type NutritionSource, type OffDailyLine, type OffProduct, type PackagedCheck } from "@app/shared";
import { labelMore, servingOf, withBrand, type FoodReference } from "./openfoodfacts.adapter.js";

export interface PackagedRow {
  code: string;
  name: string;
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  more: MoreNutrients;
  servingSize: string | null;
  quantity: string | null;
  numbersFit: boolean;
}
export interface OffRow extends PackagedRow {
  allergens: string[];
  traces: string[];
}
export type RowRefusal = "bad_code" | "store_only" | "not_a_food" | "no_name" | "no_calories" | "out_of_bounds";
export type RowResult = { row: OffRow } | { refused: RowRefusal; code: string | null };

/** What the file's text may hold and a database or a screen may not: control characters (one real row
 *  has a NUL in the middle of its ingredients) and the line separators. */
const clean = (text: string): string => text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));
const round = (value: number, places: number): number => Number(value.toFixed(places));
const figure = (figures: Record<string, number>, name: string): number | null => figures[name] ?? null;

/** A tag or a word of Open Food Facts' list in plain words: "en:milk" and "milk" are "milk", and a word
 *  no list has heard of is kept, not dropped. "none" is no allergen: the list is simply empty. */
export function allergenWords(tags: readonly string[]): string[] {
  const words = tags.map((tag) =>
    clean(tag.replace(/^[a-z]{2}:/i, ""))
      .replace(/[^\p{L}\p{N} -]+/gu, "")
      .replaceAll("-", " ")
      .toLowerCase()
      .trim()
      .slice(0, 40),
  );
  return [...new Set(words)].filter((word) => word !== "" && word !== "none").slice(0, 30);
}

/** How far a label's calories may be from what its protein, carbs, fat and alcohol come to (4, 4, 9
 *  and 7 kcal a gram) before it says to check the pack. Measured on the real lists, 2026-10-30: 3.2%
 *  of Open Food Facts' and 1.9% of USDA's are further apart than this. */
const FIT_KCAL = 15;
const FIT_SHARE = 0.3;
export function numbersFit(kcal: number, protein: number | null, carbs: number | null, fat: number | null, alcohol: number | null): boolean {
  if (protein === null || carbs === null || fat === null) return true; // missing, which is said apart
  const worked = 4 * protein + 4 * carbs + 9 * fat + 7 * (alcohol ?? 0);
  const apart = Math.abs(kcal - worked);
  return apart <= FIT_KCAL || apart / Math.max(kcal, worked, 1) <= FIT_SHARE;
}

/** One product of either file, or why it is not kept. Blank is never a zero: a stated 0 kcal is
 *  Coca-Cola Zero, kept; no figure at all is not a food we can price. */
export function offRowOf(product: OffProduct): RowResult {
  const kind = classifyBarcode(product.code);
  if (kind.kind === "bad") return { refused: "bad_code", code: null };
  if (kind.kind === "store_only" || kind.kind === "not_a_food") return { refused: kind.kind, code: null };
  const code = kind.code;
  const rawName = clean(first(product.name)) || clean(first(product.genericName));
  if (rawName === "") return { refused: "no_name", code };
  const f = product.figures;
  const stated = figure(f, "energy-kcal_100g");
  const joules = figure(f, "energy_100g");
  const kcalRaw = stated !== null && stated !== 0 ? stated : joules !== null ? joules / 4.184 : stated;
  if (kcalRaw === null) return { refused: "no_calories", code };
  const kcal = round(kcalRaw, 1);
  const protein = figure(f, "proteins_100g");
  const carbs = figure(f, "carbohydrates_100g");
  const fat = figure(f, "fat_100g");
  const fiber = figure(f, "fiber_100g");
  // Physical bounds: pure fat is 884 kcal per 100 g, and nothing holds more than 100 g of anything in 100 g.
  if (kcal < 0 || kcal > 1000 || [protein, carbs, fat, fiber].some((v) => v !== null && (v < 0 || v > 100))) return { refused: "out_of_bounds", code };
  const quantity = clean(product.quantity ?? "").slice(0, 40);
  const serving = clean(product.servingSize ?? "").slice(0, 60);
  return {
    row: {
      code,
      name: withBrand(rawName, clean(first(product.brands))),
      kcal,
      proteinG: protein === null ? null : round(protein, 3),
      carbsG: carbs === null ? null : round(carbs, 3),
      fatG: fat === null ? null : round(fat, 3),
      more: labelMore(f),
      servingSize: serving === "" ? null : serving,
      quantity: quantity === "" ? null : quantity,
      numbersFit: numbersFit(kcal, protein, carbs, fat, figure(f, "alcohol_100g")),
      allergens: allergenWords(product.allergens),
      traces: allergenWords(product.traces),
    },
  };
}

/** The CSV's columns the importer reads. A file without them has changed its shape, and is refused.
 *  The CSV mixes their estimates in with the labels' figures and cannot tell them apart (49 of a real
 *  day's 6,010 products), so a real server's list is loaded from the JSONL export, which marks them. */
export const OFF_CSV_COLUMNS = ["code", "product_name", "generic_name", "brands", "serving_size", "quantity", "allergens_en", "traces_en", "energy-kcal_100g", "energy_100g", "proteins_100g", "carbohydrates_100g", "fat_100g"] as const;
const CSV_FIGURES = ["energy-kcal_100g", "energy_100g", "proteins_100g", "carbohydrates_100g", "fat_100g", "fiber_100g", "sugars_100g", "saturated-fat_100g", "monounsaturated-fat_100g", "polyunsaturated-fat_100g", "salt_100g", "sodium_100g", "alcohol_100g", "potassium_100g", "calcium_100g", "iron_100g", "magnesium_100g", "vitamin-d_100g"] as const;

/** One tab-separated row of the download, under its header. */
export function offProductOfCsv(index: ReadonlyMap<string, number>, cells: readonly string[]): OffProduct {
  const cell = (name: string): string => cells[index.get(name) ?? -1] ?? "";
  const figures: Record<string, number> = {};
  for (const name of CSV_FIGURES) {
    const text = cell(name).trim();
    const value = text === "" ? Number.NaN : Number(text);
    if (Number.isFinite(value)) figures[name] = value;
  }
  return offProductSchema.parse({
    code: cell("code").trim(),
    name: cell("product_name"),
    genericName: cell("generic_name"),
    brands: cell("brands"),
    servingSize: cell("serving_size"),
    quantity: cell("quantity"),
    allergens: cell("allergens_en").split(","),
    traces: cell("traces_en").split(","),
    figures,
  });
}

const GRAMS_PER: Readonly<Record<string, number>> = { g: 1, mg: 1e-3, "µg": 1e-6, "μg": 1e-6, mcg: 1e-6, kg: 1000 };

/** One line of the daily file or the full JSONL export, in the download's shape: grams under the same
 *  `_100g` names. Its figures marked `estimate` are Open Food Facts' own guess from the ingredients and
 *  are never read. Where a label gives the food as prepared, that is the set they choose, as the CSV
 *  does (0.5% of a real day). */
export function offProductOfDaily(line: OffDailyLine): OffProduct {
  const set = line.nutrition?.aggregated_set;
  const figures: Record<string, number> = {};
  const per100 = set?.per === "100g" || set?.per === "100ml";
  if (set !== undefined && per100) {
    for (const [name, one] of Object.entries(set.nutrients ?? {})) {
      if (one.source === "estimate" || one.value === undefined) continue;
      if (name === "energy-kcal") figures["energy-kcal_100g"] = one.value;
      else if (name === "energy-kj") figures["energy_100g"] = one.value;
      else {
        const toGrams = GRAMS_PER[one.unit ?? ""];
        if (toGrams !== undefined) figures[`${name}_100g`] = one.value * toGrams;
      }
    }
  }
  return offProductSchema.parse({
    code: String(line.code).trim(),
    name: line.product_name ?? undefined,
    genericName: line.generic_name ?? undefined,
    brands: line.brands ?? undefined,
    servingSize: line.serving_size ?? undefined,
    quantity: line.quantity ?? undefined,
    allergens: line.allergens_tags ?? [],
    traces: line.traces_tags ?? [],
    figures,
  });
}

/** A name written all in capitals, as USDA's often are, in ordinary letters. */
const readableName = (name: string): string =>
  /\p{Ll}/u.test(name) ? name : name.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_all, before: string, letter: string) => `${before}${letter.toUpperCase()}`);

/** USDA's serving, as a label would print it: its household words where they hold a weight
 *  ("1 Tbsp (15 ml)"), else its grams or millilitres. */
export function usdaServing(size: string, unit: string, household: string): string | null {
  const words = clean(household);
  const read = servingOf(words);
  if (read.grams !== 100 || read.unit !== "g") return words;
  const amount = Number(size);
  return Number.isFinite(amount) && amount > 0 && (unit === "g" || unit === "ml") ? `${String(amount)} ${unit}` : null;
}

/** One USDA branded product, its figures per 100 g in USDA's own units, or why it is not kept. */
export function usdaRowOf(product: { code: string; name: string; brand: string; size: string; unit: string; household: string; figures: Readonly<Record<string, number>> }): RowResult {
  const f = product.figures;
  const inGrams: Record<string, number> = { ...f };
  // labelMore reads every figure in grams, as Open Food Facts keeps them.
  for (const name of ["sodium_100g", "potassium_100g", "calcium_100g", "iron_100g", "magnesium_100g"]) if (f[name] !== undefined) inGrams[name] = f[name] / 1000;
  if (f["vitamin-d_100g"] !== undefined) inGrams["vitamin-d_100g"] = f["vitamin-d_100g"] / 1_000_000;
  return offRowOf(
    offProductSchema.parse({
      code: product.code,
      name: readableName(product.name),
      brands: readableName(product.brand),
      servingSize: usdaServing(product.size, product.unit, product.household) ?? "",
      allergens: [],
      traces: [],
      figures: inGrams,
    }),
  );
}

/** The canonical of a packaged product by its barcode: `off_` is what the food search has always
 *  named one, `pack_` what a scanned barcode names it; both read the lists below. */
const PACKAGED_CANONICAL = /^(?:off|pack)_(\d{8,14})$/;
export const packagedCode = (canonical: string): string | null => PACKAGED_CANONICAL.exec(canonical)?.[1] ?? null;
export const isPackagedCanonical = (canonical: string): boolean => /^(?:off|pack)_/.test(canonical);

/** Two lists more than this apart on a product's calories: one is wrong, and nothing says which. Real
 *  shares, 2026-10-30: 7.0% of the 324,580 products both hold. */
const LISTS_APART = 0.2;

export interface PackagedFood {
  food: FoodReference;
  allergens: string[];
  mayContain: string[];
  check: PackagedCheck;
}

/** What a person is told about a code the lists hold. The rule is structural, never a list of words:
 *  - the lists agree: Open Food Facts' row, which has the allergens, unless its numbers do not add up
 *    and USDA's do;
 *  - they disagree: USDA's, which comes from the maker's own label (Open Food Facts' is typed by
 *    volunteers), and the person is told to check the pack;
 *  - allergens are Open Food Facts' whichever list gave the numbers. USDA keeps none. */
export function packagedFoodOf(off: OffRow | null, usda: PackagedRow | null): PackagedFood | null {
  const only = off ?? usda;
  if (only === null) return null;
  const apart = off !== null && usda !== null && Math.abs(off.kcal - usda.kcal) > LISTS_APART * Math.max(off.kcal, usda.kcal);
  const numbers: PackagedRow = off === null || usda === null ? only : apart || (!off.numbersFit && usda.numbersFit) ? usda : off;
  const source: NutritionSource = numbers === off ? "openfoodfacts" : "usda";
  const serving = servingOf(numbers.servingSize ?? undefined);
  const missing = numbers.kcal > 0 && (numbers.proteinG === null || numbers.carbsG === null || numbers.fatG === null);
  return {
    food: {
      canonical: `pack_${numbers.code}`,
      name: numbers.name,
      kcal: numbers.kcal,
      proteinG: numbers.proteinG ?? 0,
      carbsG: numbers.carbsG ?? 0,
      fatG: numbers.fatG ?? 0,
      fiberG: numbers.more.fiberG,
      serving: serving.grams,
      unit: serving.unit,
      source,
      more: numbers.more,
    },
    allergens: off?.allergens ?? [],
    mayContain: off?.traces ?? [],
    check: apart ? "lists_differ" : !numbers.numbersFit ? "doesnt_add_up" : missing ? "part_missing" : "fine",
  };
}
