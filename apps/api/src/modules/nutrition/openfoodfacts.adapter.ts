// How a packaged product's label reads, and the shape of a food. Nothing here asks anybody: the lists are
// our own copy (`packagedSearch.ts`).
import { MAX_ITEM_GRAMS, type MoreNutrients, type NutritionSource } from "@app/shared";

/** `fiberG` is null where a food's table or label has no figure. `more` is the
 *  ten further figures per 100 g (ROADMAP 34a): a packaged product carries what
 *  the lists hold of its label; a table food's are read when it is priced (`withMore`, service.ts). */
export interface FoodReference { canonical: string; name: string; kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number | null; serving: number; unit: string; source: NutritionSource; more?: MoreNutrients | undefined; pack?: { grams: number; volume: boolean } | undefined;
  /** A packaged product whose numbers a meal scan must not take on its own: the person is shown nothing to check them by. */
  doubtful?: true | undefined; }
export interface FoodSearchProvider { search(query: string, limit: number): Promise<FoodReference[]>; }
/** A label's figure, or null where the label gives none: a missing figure is never a zero. */
const given = (v: unknown): number | null => typeof v === "number" ? (Number.isFinite(v) ? v : null) : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
/** The most 100 g of any food holds of each figure, in the unit it is kept in:
 *  the weight itself for the four in grams, and for the rest just above the
 *  highest in the USDA table (measured 2026-10-13: sodium 38,758 mg, table salt;
 *  potassium 16,500; calcium 7,364; iron 123.6; magnesium 781; vitamin D 250 µg).
 *  Open Food Facts is typed in by volunteers, so a figure past these is a slip of
 *  the unit and reads as not known. A figure typed too LOW cannot be told. */
const LABEL_MOST: Record<keyof MoreNutrients, number> = { fiberG: 100, sugarsG: 100, satFatG: 100, unsatFatG: 100, sodiumMg: 40_000, potassiumMg: 17_000, calciumMg: 7_500, ironMg: 125, magnesiumMg: 800, vitaminDUg: 250 };
/** Sodium is 1 part in 2.5 of salt by weight (EU Regulation 1169/2011, Annex I). */
const SALT_PER_SODIUM = 2.5;
/** A product's ten further figures per 100 g. Open Food Facts keeps every
 *  `_100g` figure in GRAMS whatever unit the label prints, so sodium and the
 *  minerals are turned to milligrams and vitamin D to micrograms here, once. A
 *  label that gives salt and no sodium gives its sodium by the rule above, and
 *  unsaturated fat is known only where the label gives both kinds. */
export function labelMore(n: Record<string, unknown>): MoreNutrients {
  const salt = given(n["salt_100g"]);
  const mono = given(n["monounsaturated-fat_100g"]);
  const poly = given(n["polyunsaturated-fat_100g"]);
  const grams: MoreNutrients = {
    fiberG: given(n["fiber_100g"]), sugarsG: given(n["sugars_100g"]), satFatG: given(n["saturated-fat_100g"]),
    unsatFatG: mono === null || poly === null ? null : mono + poly,
    sodiumMg: given(n["sodium_100g"]) ?? (salt === null ? null : salt / SALT_PER_SODIUM),
    potassiumMg: given(n["potassium_100g"]), calciumMg: given(n["calcium_100g"]), ironMg: given(n["iron_100g"]),
    magnesiumMg: given(n["magnesium_100g"]), vitaminDUg: given(n["vitamin-d_100g"]),
  };
  const kept = (key: keyof MoreNutrients, perGram: number): number | null => {
    const g = grams[key];
    if (g === null) return null;
    const v = g * perGram;
    return v >= 0 && v <= LABEL_MOST[key] ? Math.round(v * 1000) / 1000 : null;
  };
  return {
    fiberG: kept("fiberG", 1), sugarsG: kept("sugarsG", 1), satFatG: kept("satFatG", 1), unsatFatG: kept("unsatFatG", 1),
    sodiumMg: kept("sodiumMg", 1000), potassiumMg: kept("potassiumMg", 1000), calciumMg: kept("calciumMg", 1000),
    ironMg: kept("ironMg", 1000), magnesiumMg: kept("magnesiumMg", 1000), vitaminDUg: kept("vitaminDUg", 1_000_000),
  };
}
const first = (v: string | string[] | undefined): string => Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
/** A product's name with its brand, so two brands' jars never read alike
 *  ("Peanut butter · Happy Shopper"; RULINGS 2026-09-14). The first brand of a
 *  list is used, and a brand the name already holds is not repeated. */
export function withBrand(name: string, brands: string | string[] | undefined): string {
  const plain = name.trim();
  const brand = (first(brands).split(",")[0] ?? "").trim().slice(0, 30);
  if (brand === "" || plain.toLowerCase().includes(brand.toLowerCase())) return plain.slice(0, 80);
  return `${plain.slice(0, 80 - brand.length - 3)} · ${brand}`;
}
const METRIC = /(\d+(?:[.,]\d+)?)\s*(grams?|gr|g|ml|cl)(?!\p{L})/u;
const FLUID_OUNCES = /(\d+(?:[.,]\d+)?)\s*fl\.?\s*oz(?!\p{L})/u;
const OUNCES = /(\d+(?:[.,]\d+)?)\s*oz(?!\p{L})/u;
const NAMED = /^(\d+(?:\.\d+)?|\d+\/\d+|½|one|an?) (\p{L}+(?: \p{L}+)*)$/u;
const GRAMS_PER = { g: 1, ml: 1, cl: 10, "fl oz": 29.5735, oz: 28.3495 } as const;
export const NO_LABEL = { grams: 100, unit: "g" } as const;

/** A packaged product's serving, from its label: the grams or millilitres it
 *  gives (a drink's millilitres weigh as grams; centilitres and ounces are
 *  converted), by the pack or measure it names beside them, so "1 bottle (65 ml)"
 *  is a 65 g bottle, "1 oz (28 g)" 28 g by the ounce, "2 tbsp (32 g)" 32 g by two
 *  spoonfuls and "30 g" 30 g by the gram. The label's pack is then one of the
 *  product's measures (measures.ts), so a photo's count of three bottles can start
 *  its row at three of them. A label giving no weight, or more than one item of a
 *  meal may weigh, is read as no label: 100 g by the gram. */
export function servingOf(label: string | undefined): { grams: number; unit: string } {
  const text = (label ?? "").toLowerCase().slice(0, 120);
  const metric = METRIC.exec(text);
  const found = metric ?? FLUID_OUNCES.exec(text) ?? OUNCES.exec(text);
  if (found === null) return NO_LABEL;
  const measure = metric === null ? (found[0].includes("fl") ? "fl oz" : "oz") : metric[2] === "cl" ? "cl" : metric[2] === "ml" ? "ml" : "g";
  const grams = Math.round(Number((found[1] ?? "").replace(",", ".")) * GRAMS_PER[measure] * 10) / 10;
  if (!(grams > 0 && grams <= MAX_ITEM_GRAMS)) return NO_LABEL;
  const rest = `${text.slice(0, found.index)} ${text.slice(found.index + found[0].length)}`.replaceAll(/[^\p{L}\d./½ ]+/gu, " ").replaceAll(/\s+/g, " ").trim();
  const named = NAMED.exec(rest);
  const amount = named?.[1];
  const words = named?.[2];
  if (amount === undefined || words === undefined) return { grams, unit: measure === "cl" ? "ml" : measure };
  if (["1", "1.0", "one", "a", "an"].includes(amount)) return { grams, unit: words.slice(0, 40) };
  if (["0.5", "1/2", "½"].includes(amount)) return { grams, unit: `half ${words}`.slice(0, 40) };
  return { grams, unit: `${amount} ${words}`.slice(0, 40) };
}
