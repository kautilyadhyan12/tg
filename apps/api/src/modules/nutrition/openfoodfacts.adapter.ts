// Salvage port of usda.py: this is OpenFoodFacts, despite the old name.
import { z } from "zod";
import { MAX_ITEM_GRAMS } from "@app/shared";

/** `fiberG` is null where a curated food's table has no measured figure. */
export interface FoodReference { canonical: string; name: string; kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number | null; serving: number; unit: string; source: "curated" | "openfoodfacts" | "usda"; }
export interface FoodSearchProvider { search(query: string, limit: number): Promise<FoodReference[]>; }
const productSchema = z.object({ code: z.union([z.string(), z.number()]).optional(), product_name: z.union([z.string(), z.array(z.string())]).optional(), generic_name: z.union([z.string(), z.array(z.string())]).optional(), brands: z.union([z.string(), z.array(z.string())]).optional(), serving_size: z.string().optional(), nutriments: z.record(z.unknown()).optional() }).passthrough();
const searchSchema = z.object({ hits: z.array(productSchema).optional(), products: z.array(productSchema).optional() }).passthrough();
const num = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : 0;
const first = (v: string | string[] | undefined): string => Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
const canonicalize = (v: string): string => v.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "");
/** A product's name with its brand, so two brands' jars never read alike
 *  ("Peanut butter · Happy Shopper"; RULINGS 2026-09-14). The first brand of a
 *  list is used, and a brand the name already holds is not repeated. */
function withBrand(name: string, brands: string | string[] | undefined): string {
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
const NO_LABEL = { grams: 100, unit: "g" } as const;

/** A packaged product's serving, from its label: the grams or millilitres it
 *  gives (a drink's millilitres weigh as grams; centilitres and ounces are
 *  converted), by the pack or measure it names beside them, so "1 bottle (65 ml)"
 *  is a 65 g bottle, "1 oz (28 g)" 28 g by the ounce, "2 tbsp (32 g)" 32 g by two
 *  spoonfuls and "30 g" 30 g by the gram. A photo's count of bottles, cans, bars or
 *  pots then multiplies it by the pack's count rule (portion-priors.ts). A label
 *  giving no weight, or more than one item of a meal may weigh, is read as no
 *  label: 100 g by the gram. */
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

function mapProduct(p: z.infer<typeof productSchema>): FoodReference | null {
  const name = first(p.product_name) || first(p.generic_name); if (name.trim() === "") return null;
  const n = p.nutriments ?? {}; let kcal = num(n["energy-kcal_100g"]); if (kcal === 0) kcal = num(n["energy_100g"]) / 4.184; if (kcal <= 0) return null;
  const proteinG = num(n["proteins_100g"]), carbsG = num(n["carbohydrates_100g"]), fatG = num(n["fat_100g"]), fiberG = num(n["fiber_100g"]);
  // Physical per-100g bounds (T3 manual-off-foods: OFF is crowd-edited; a
  // prank 10^9-kcal product must not enter the pipeline): pure fat is
  // 884 kcal/100g, and no macro can exceed 100 g per 100 g.
  if (kcal > 1000 || proteinG > 100 || carbsG > 100 || fatG > 100 || fiberG > 100) return null;
  const serving = servingOf(p.serving_size);
  // Canonical is UNIQUE per product via the OFF barcode (T3: name-slug
  // canonicals collide across products and let one entry overwrite another —
  // preview and save could then use different macros). Code-less products
  // fall back to the slug of the name as shown, brand included, so two brands'
  // jars of one name stay two foods (rare; first-wins caching guards the rest).
  const code = p.code === undefined ? "" : canonicalize(String(p.code));
  const shown = withBrand(name, p.brands);
  return { canonical: code === "" ? `off_${canonicalize(shown)}` : `off_${code}`, name: shown, kcal, proteinG, carbsG, fatG, fiberG, serving: serving.grams, unit: serving.unit, source: "openfoodfacts" };
}
/** How long one search waits for packaged products, both addresses together.
 *  The search box's other foods answer in milliseconds and are held until this
 *  does, so a slow or silent Open Food Facts must not hold the box: over three
 *  searches it answered in 0.8 to 2.0 s, and its fallback address failed with a
 *  503 after 2.5 s (measured 2026-09-16). */
export const OFF_SEARCH_TIMEOUT_MS = 3_000;

export function createOpenFoodFactsProvider(fetchImpl: typeof fetch = fetch): FoodSearchProvider {
  return { async search(query, limit) {
    // One deadline for the whole search: the fallback address gets what is left of it, never a wait of its own.
    const deadline = AbortSignal.timeout(OFF_SEARCH_TIMEOUT_MS);
    const urls = [new URL("https://search.openfoodfacts.org/search"), new URL("https://world.openfoodfacts.org/cgi/search.pl")];
    urls[0]?.searchParams.set("q", query); urls[0]?.searchParams.set("page_size", String(limit)); urls[0]?.searchParams.set("fields", "code,product_name,brands,serving_size,nutriments,generic_name");
    urls[1]?.searchParams.set("search_terms", query); urls[1]?.searchParams.set("search_simple", "1"); urls[1]?.searchParams.set("action", "process"); urls[1]?.searchParams.set("json", "1"); urls[1]?.searchParams.set("page_size", String(limit));
    for (const url of urls) { try { const response = await fetchImpl(url, { headers: { "user-agent": "AIHomeGym/1.0" }, signal: deadline }); if (!response.ok) continue; const parsed = searchSchema.safeParse(await response.json()); if (!parsed.success) continue; const foods = (parsed.data.hits ?? parsed.data.products ?? []).map(mapProduct).filter((v): v is FoodReference => v !== null).slice(0, limit); if (foods.length > 0) return foods; } catch { /* defined degrade: try fallback, then empty */ } }
    return [];
  } };
}
