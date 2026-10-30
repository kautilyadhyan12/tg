// ROADMAP Stage 5 33b-iii-a — our own copy of the packaged-food lists. Mirrors migration
// `0177_packaged_products.sql` 1:1.
//
// PUBLIC DATA, NO OWNER, NO TENANCY, as `usda_foods` is. The two lists stay in two tables: Open Food
// Facts' licence (ODbL 1.0, section 4.5) asks nothing of independent databases kept beside it, and
// nothing a member makes is ever written here. `apps/api/tools/import-packaged-foods.ts` and the
// nightly update (`modules/nutrition/packagedSync.ts`) are the only writers.
import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

const productColumns = {
  /** As Open Food Facts writes it (`classifyBarcode`): leading zeros kept, so a text. */
  code: text("code").primaryKey(),
  /** The product's name with its brand, ready to show. */
  name: text("name").notNull(),
  // Per 100 g or 100 ml. NULL is "the label does not say", never a zero. A stated 0 is a real figure:
  // Coca-Cola Zero and water.
  kcal: real("kcal").notNull(),
  proteinG: real("protein_g"),
  carbsG: real("carbs_g"),
  fatG: real("fat_g"),
  fiberG: real("fiber_g"),
  sugarsG: real("sugars_g"),
  satFatG: real("sat_fat_g"),
  unsatFatG: real("unsat_fat_g"),
  sodiumMg: real("sodium_mg"),
  potassiumMg: real("potassium_mg"),
  calciumMg: real("calcium_mg"),
  ironMg: real("iron_mg"),
  magnesiumMg: real("magnesium_mg"),
  vitaminDUg: real("vitamin_d_ug"),
  /** The label's serving, as it prints it ("1 bottle (65 ml)"), or null. */
  servingSize: text("serving_size"),
  /** The pack's own size, as it prints it ("400 g"), or null. */
  quantity: text("quantity"),
  /** false: its calories are far from what its protein, carbs, fat and alcohol come to. */
  numbersFit: boolean("numbers_fit").notNull(),
};

export const offProducts = pgTable(
  "off_products",
  {
    ...productColumns,
    /** The allergens and "may contain" Open Food Facts lists, in plain words. Empty says nothing
     *  about the food: most products have neither. */
    allergens: text("allergens").array().notNull(),
    traces: text("traces").array().notNull(),
  },
  (t) => [check("off_products_kcal_check", sql`${t.kcal} >= 0 AND ${t.kcal} <= 1000`)],
);

export const usdaBrandedProducts = pgTable(
  "usda_branded_products",
  productColumns,
  (t) => [check("usda_branded_products_kcal_check", sql`${t.kcal} >= 0 AND ${t.kcal} <= 1000`)],
);

/** Each of Open Food Facts' daily files once applied: the nightly update reads this, so a second run
 *  of a night changes nothing. */
export const offDailyFiles = pgTable("off_daily_files", {
  name: text("name").primaryKey(),
  /** The second the file runs to, from its name. */
  toSecond: integer("to_second").notNull(),
  products: integer("products").notNull(),
  written: integer("written").notNull(),
  removed: integer("removed").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});
