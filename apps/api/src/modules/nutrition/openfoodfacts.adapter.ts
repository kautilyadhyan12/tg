// Salvage port of usda.py: this is OpenFoodFacts, despite the old name.
import { z } from "zod";

export interface FoodReference { canonical: string; name: string; kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; serving: number; unit: string; source: "curated" | "openfoodfacts"; }
export interface FoodSearchProvider { search(query: string, limit: number): Promise<FoodReference[]>; }
const productSchema = z.object({ code: z.union([z.string(), z.number()]).optional(), product_name: z.union([z.string(), z.array(z.string())]).optional(), generic_name: z.union([z.string(), z.array(z.string())]).optional(), brands: z.union([z.string(), z.array(z.string())]).optional(), serving_size: z.string().optional(), nutriments: z.record(z.unknown()).optional() }).passthrough();
const searchSchema = z.object({ hits: z.array(productSchema).optional(), products: z.array(productSchema).optional() }).passthrough();
const num = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && Number.isFinite(Number(v)) ? Number(v) : 0;
const first = (v: string | string[] | undefined): string => Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
const canonicalize = (v: string): string => v.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "");
function mapProduct(p: z.infer<typeof productSchema>): FoodReference | null {
  const name = first(p.product_name) || first(p.generic_name); if (name.trim() === "") return null;
  const n = p.nutriments ?? {}; let kcal = num(n["energy-kcal_100g"]); if (kcal === 0) kcal = num(n["energy_100g"]) / 4.184; if (kcal <= 0) return null;
  const proteinG = num(n["proteins_100g"]), carbsG = num(n["carbohydrates_100g"]), fatG = num(n["fat_100g"]), fiberG = num(n["fiber_100g"]);
  // Physical per-100g bounds (T3 manual-off-foods: OFF is crowd-edited; a
  // prank 10^9-kcal product must not enter the pipeline): pure fat is
  // 884 kcal/100g, and no macro can exceed 100 g per 100 g.
  if (kcal > 1000 || proteinG > 100 || carbsG > 100 || fatG > 100 || fiberG > 100) return null;
  const servingMatch = /([\d.]+)\s*(g|ml|oz|cup|tbsp|tsp)/i.exec(p.serving_size ?? "");
  // Canonical is UNIQUE per product via the OFF barcode (T3: name-slug
  // canonicals collide across products and let one entry overwrite another —
  // preview and save could then use different macros). Code-less products
  // fall back to the name slug (rare; first-wins caching guards those).
  const code = p.code === undefined ? "" : canonicalize(String(p.code));
  return { canonical: code === "" ? `off_${canonicalize(name)}` : `off_${code}`, name: name.slice(0, 80), kcal, proteinG, carbsG, fatG, fiberG, serving: servingMatch === null ? 100 : Number(servingMatch[1]), unit: servingMatch?.[2]?.toLowerCase() ?? "g", source: "openfoodfacts" };
}
export function createOpenFoodFactsProvider(fetchImpl: typeof fetch = fetch): FoodSearchProvider {
  return { async search(query, limit) {
    const urls = [new URL("https://search.openfoodfacts.org/search"), new URL("https://world.openfoodfacts.org/cgi/search.pl")];
    urls[0]?.searchParams.set("q", query); urls[0]?.searchParams.set("page_size", String(limit)); urls[0]?.searchParams.set("fields", "code,product_name,brands,serving_size,nutriments,generic_name");
    urls[1]?.searchParams.set("search_terms", query); urls[1]?.searchParams.set("search_simple", "1"); urls[1]?.searchParams.set("action", "process"); urls[1]?.searchParams.set("json", "1"); urls[1]?.searchParams.set("page_size", String(limit));
    for (const url of urls) { try { const response = await fetchImpl(url, { headers: { "user-agent": "AIHomeGym/1.0" } }); if (!response.ok) continue; const parsed = searchSchema.safeParse(await response.json()); if (!parsed.success) continue; const foods = (parsed.data.hits ?? parsed.data.products ?? []).map(mapProduct).filter((v): v is FoodReference => v !== null).slice(0, limit); if (foods.length > 0) return foods; } catch { /* defined degrade: try fallback, then empty */ } }
    return [];
  } };
}
