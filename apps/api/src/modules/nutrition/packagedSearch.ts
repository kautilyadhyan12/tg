// The food search's packaged products, from our own copy of the lists (ROADMAP Stage 5 33b-iii-d).
// Nothing leaves the server. Each product is priced by the rule a barcode is (`packagedFoodOf`), so a pick
// costs what it was shown at, and one listed twice shows once.
import type { Sql } from "postgres";
import type { FoodReference, FoodSearchProvider } from "./openfoodfacts.adapter.js";
import { packagedCodesFor, packagedRowsForCodes } from "./packagedRepo.js";
import { isDoubtful, packagedFoodOf } from "./packagedRows.js";

/** How many are read for each place on the page: the same product is often listed under several codes. */
const READ_PER_PLACE = 4;

export function createPackagedSearch(sql: Sql): FoodSearchProvider {
  return {
    async search(query, limit) {
      const codes = await packagedCodesFor(sql, query, limit * READ_PER_PLACE);
      const rows = await packagedRowsForCodes(sql, codes);
      const seen = new Set<string>();
      const foods: { food: FoodReference; sinks: boolean }[] = [];
      for (const code of codes) {
        const found = packagedFoodOf(rows.off.get(code) ?? null, rows.usda.get(code) ?? null);
        if (found === null) continue;
        const same = `${found.food.name.toLowerCase()}|${String(Math.round(found.food.kcal))}`;
        if (seen.has(same)) continue;
        seen.add(same);
        const sinks = isDoubtful(found);
        foods.push({ food: { ...found.food, canonical: `off_${code}`, ...(sinks || found.check === "lists_differ" ? { doubtful: true as const } : {}) }, sinks });
      }
      // The other list can put a row right, so this is decided on what will be shown, not on the row.
      return [...foods.filter((f) => !f.sinks), ...foods.filter((f) => f.sinks)].slice(0, limit).map((f) => f.food);
    },
  };
}
