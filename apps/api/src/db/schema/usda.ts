// ROADMAP 7a-iii-a — the USDA FoodData Central food table. Mirrors migration
// `0031_usda_foods.sql` 1:1.
//
// PUBLIC DATA, NO OWNER, NO TENANCY (RULINGS 2026-09-16: FoodData Central is
// public domain, CC0 1.0). These are the only rows here that belong to nobody:
// there is no user_id, so there is no tenancy WHERE to get wrong.
// `apps/api/tools/import-usda.ts` is the only writer.
import { sql } from "drizzle-orm";
import { check, customType, doublePrecision, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

/** Postgres' full-text type. The column is GENERATED from `search_text`, so it
 *  can never drift from the words it indexes, and nothing writes it by hand. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

export const usdaFoods = pgTable(
  "usda_foods",
  {
    /** USDA's own id, unique across both releases — SR Legacy runs from 167512,
     *  the survey release from 2705383 — so it is the importer's upsert key. */
    fdcId: integer("fdc_id").primaryKey(),
    release: text("release").notNull(), // sr_legacy | fndds
    description: text("description").notNull(),
    /** The description as the search reads it, accents folded and in lower case
     *  (`usdaSearchText`, which reads a typed query too). The index is built
     *  from this, never from `description`. */
    searchText: text("search_text").notNull(),
    /** The description's first word, for 7a-iii-b's matching rung. */
    firstWord: text("first_word").notNull(),
    /** How many words the description has — the search shows the fewest first. */
    wordCount: integer("word_count").notNull(),
    // Seventeen nutrients per 100 g in USDA's own units. NULL is "the release
    // does not measure this", never a zero (0031's note).
    kcal: doublePrecision("kcal"),
    proteinG: doublePrecision("protein_g"),
    carbsG: doublePrecision("carbs_g"),
    fatG: doublePrecision("fat_g"),
    fiberG: doublePrecision("fiber_g"),
    sugarsG: doublePrecision("sugars_g"),
    satFatG: doublePrecision("sat_fat_g"),
    monoFatG: doublePrecision("mono_fat_g"),
    polyFatG: doublePrecision("poly_fat_g"),
    cholesterolMg: doublePrecision("cholesterol_mg"),
    sodiumMg: doublePrecision("sodium_mg"),
    potassiumMg: doublePrecision("potassium_mg"),
    calciumMg: doublePrecision("calcium_mg"),
    ironMg: doublePrecision("iron_mg"),
    magnesiumMg: doublePrecision("magnesium_mg"),
    vitaminDUg: doublePrecision("vitamin_d_ug"),
    vitaminCMg: doublePrecision("vitamin_c_mg"),
    /** The first household measure with a gram weight, else 100 g by the gram —
     *  never null, because the food search's contract gives every food one. */
    servingGrams: doublePrecision("serving_grams").notNull(),
    servingUnit: text("serving_unit").notNull(),
    search: tsvector("search").generatedAlwaysAs(sql`to_tsvector('english', "search_text")`),
  },
  (t) => [
    check("usda_foods_release_check", sql`${t.release} IN ('sr_legacy', 'fndds')`),
    check("usda_foods_word_count_check", sql`${t.wordCount} > 0`),
    check("usda_foods_serving_grams_check", sql`${t.servingGrams} > 0`),
    index("usda_foods_search_idx").using("gin", t.search),
  ],
);

export const usdaFoodPortions = pgTable(
  "usda_food_portions",
  {
    fdcId: integer("fdc_id")
      .notNull()
      .references(() => usdaFoods.fdcId, { onDelete: "cascade" }),
    /** USDA's own ordering. The survey release does not write its rows in it. */
    seqNum: integer("seq_num").notNull(),
    /** The release's own number where it gives one (SR Legacy), NULL where the
     *  measure's text carries it instead (the survey release's "1 cup"). */
    amount: doublePrecision("amount"),
    unit: text("unit").notNull(),
    gramWeight: doublePrecision("gram_weight").notNull(),
  },
  (t) => [
    primaryKey({ name: "usda_food_portions_pkey", columns: [t.fdcId, t.seqNum] }),
    check("usda_food_portions_gram_weight_check", sql`${t.gramWeight} > 0`),
  ],
);
