// ROADMAP 7a-iii-a — writing the two USDA releases into `usda_foods` and
// `usda_food_portions`. Separate from `import-usda.ts` so the tests can drive
// the upsert with a handful of rows without running that script.
//
// EVERY WRITE IS AN UPSERT KEYED BY USDA'S OWN `fdc_id`, AND A ROW THAT WOULD
// NOT CHANGE IS NOT WRITTEN: the `IS DISTINCT FROM` guard on each `DO UPDATE`
// means a second run reports nothing changed and leaves no dead tuples behind.
// That is what makes the tool safe to re-run against any environment.
import type { Sql, TransactionSql } from "postgres";
// The word rule the SEARCH BOX folds a typed query with, so `first_word` and
// `word_count` are stored in exactly the shape the search looks them up in.
import { usdaWords } from "../src/modules/nutrition/usdaWords.js";
import { usdaServing, USDA_NUTRIENTS, type UsdaEntry, type UsdaRelease } from "./usda-files.js";

/** The seventeen nutrient columns, per 100 g, null where the release has no
 *  measured figure. */
type UsdaFigures = Record<(typeof USDA_NUTRIENTS)[number]["column"], number | null>;

export type UsdaFoodRow = UsdaFigures & {
  fdc_id: number;
  release: UsdaRelease;
  description: string;
  first_word: string;
  word_count: number;
  serving_grams: number;
  serving_unit: string;
};

export interface UsdaPortionRow {
  fdc_id: number;
  seq_num: number;
  amount: number | null;
  unit: string;
  gram_weight: number;
}

const FOOD_COLUMNS: (keyof UsdaFoodRow)[] = [
  "fdc_id",
  "release",
  "description",
  "first_word",
  "word_count",
  ...USDA_NUTRIENTS.map((n) => n.column),
  "serving_grams",
  "serving_unit",
];

const PORTION_COLUMNS: (keyof UsdaPortionRow)[] = ["fdc_id", "seq_num", "amount", "unit", "gram_weight"];

/** Each release's own numbering mapped to its column, written out rather than
 *  derived so a reviewer can check that every nutrient lands where it belongs;
 *  `UsdaFigures` makes a missing or misspelt column a type error. */
const figuresOf = (entry: UsdaEntry): UsdaFigures => ({
  kcal: entry.figures.get("kcal") ?? null,
  protein_g: entry.figures.get("proteinG") ?? null,
  carbs_g: entry.figures.get("carbsG") ?? null,
  fat_g: entry.figures.get("fatG") ?? null,
  fiber_g: entry.figures.get("fiberG") ?? null,
  sugars_g: entry.figures.get("sugarsG") ?? null,
  sat_fat_g: entry.figures.get("satFatG") ?? null,
  mono_fat_g: entry.figures.get("monoFatG") ?? null,
  poly_fat_g: entry.figures.get("polyFatG") ?? null,
  cholesterol_mg: entry.figures.get("cholesterolMg") ?? null,
  sodium_mg: entry.figures.get("sodiumMg") ?? null,
  potassium_mg: entry.figures.get("potassiumMg") ?? null,
  calcium_mg: entry.figures.get("calciumMg") ?? null,
  iron_mg: entry.figures.get("ironMg") ?? null,
  magnesium_mg: entry.figures.get("magnesiumMg") ?? null,
  vitamin_d_ug: entry.figures.get("vitaminDUg") ?? null,
  vitamin_c_mg: entry.figures.get("vitaminCMg") ?? null,
});

/** The row a food becomes, or null for a description with no word in it at all
 *  — `first_word` and the search index would both be empty, so it is skipped
 *  and counted rather than stored as a food nobody can ever find. */
export function usdaFoodRow(release: UsdaRelease, entry: UsdaEntry): UsdaFoodRow | null {
  const words = usdaWords(entry.description);
  const firstWord = words[0];
  if (firstWord === undefined) return null;
  const serving = usdaServing(entry.portions);
  return {
    ...figuresOf(entry),
    fdc_id: entry.fdcId,
    release,
    description: entry.description,
    first_word: firstWord,
    word_count: words.length,
    serving_grams: serving.grams,
    serving_unit: serving.unit,
  };
}

export const usdaPortionRows = (entry: UsdaEntry): UsdaPortionRow[] =>
  entry.portions.map((p) => ({
    fdc_id: entry.fdcId,
    seq_num: p.seqNum,
    amount: p.amount,
    unit: p.unit,
    gram_weight: p.gramWeight,
  }));

// Postgres takes at most 65,535 parameters in one statement: 24 columns × 1,000
// foods is 24,000, and 5 × 2,000 is 10,000.
const FOOD_CHUNK = 1000;
const PORTION_CHUNK = 2000;

const chunks = <T>(rows: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let at = 0; at < rows.length; at += size) out.push(rows.slice(at, at + size));
  return out;
};

/** Upserts foods and returns how many rows the database actually changed. */
export async function upsertUsdaFoods(sql: TransactionSql, rows: readonly UsdaFoodRow[]): Promise<number> {
  let changed = 0;
  for (const chunk of chunks(rows, FOOD_CHUNK)) {
    const written = await sql<{ fdc_id: number }[]>`
      INSERT INTO usda_foods ${sql(chunk, ...FOOD_COLUMNS)}
      ON CONFLICT (fdc_id) DO UPDATE SET
        release = excluded.release,
        description = excluded.description,
        first_word = excluded.first_word,
        word_count = excluded.word_count,
        kcal = excluded.kcal,
        protein_g = excluded.protein_g,
        carbs_g = excluded.carbs_g,
        fat_g = excluded.fat_g,
        fiber_g = excluded.fiber_g,
        sugars_g = excluded.sugars_g,
        sat_fat_g = excluded.sat_fat_g,
        mono_fat_g = excluded.mono_fat_g,
        poly_fat_g = excluded.poly_fat_g,
        cholesterol_mg = excluded.cholesterol_mg,
        sodium_mg = excluded.sodium_mg,
        potassium_mg = excluded.potassium_mg,
        calcium_mg = excluded.calcium_mg,
        iron_mg = excluded.iron_mg,
        magnesium_mg = excluded.magnesium_mg,
        vitamin_d_ug = excluded.vitamin_d_ug,
        vitamin_c_mg = excluded.vitamin_c_mg,
        serving_grams = excluded.serving_grams,
        serving_unit = excluded.serving_unit
      WHERE (
        usda_foods.release, usda_foods.description, usda_foods.first_word, usda_foods.word_count,
        usda_foods.kcal, usda_foods.protein_g, usda_foods.carbs_g, usda_foods.fat_g, usda_foods.fiber_g,
        usda_foods.sugars_g, usda_foods.sat_fat_g, usda_foods.mono_fat_g, usda_foods.poly_fat_g,
        usda_foods.cholesterol_mg, usda_foods.sodium_mg, usda_foods.potassium_mg, usda_foods.calcium_mg,
        usda_foods.iron_mg, usda_foods.magnesium_mg, usda_foods.vitamin_d_ug, usda_foods.vitamin_c_mg,
        usda_foods.serving_grams, usda_foods.serving_unit
      ) IS DISTINCT FROM (
        excluded.release, excluded.description, excluded.first_word, excluded.word_count,
        excluded.kcal, excluded.protein_g, excluded.carbs_g, excluded.fat_g, excluded.fiber_g,
        excluded.sugars_g, excluded.sat_fat_g, excluded.mono_fat_g, excluded.poly_fat_g,
        excluded.cholesterol_mg, excluded.sodium_mg, excluded.potassium_mg, excluded.calcium_mg,
        excluded.iron_mg, excluded.magnesium_mg, excluded.vitamin_d_ug, excluded.vitamin_c_mg,
        excluded.serving_grams, excluded.serving_unit
      )
      RETURNING fdc_id`;
    changed += written.length;
  }
  return changed;
}

/** Makes these foods' household measures exactly the ones given: a measure the
 *  release no longer lists is removed, the rest upserted by (food, seq_num).
 *  Returns how many rows the database actually changed. */
export async function replaceUsdaPortions(
  sql: TransactionSql,
  fdcIds: readonly number[],
  rows: readonly UsdaPortionRow[],
): Promise<number> {
  if (fdcIds.length === 0) return 0;
  const gone = await sql<{ fdc_id: number }[]>`
    DELETE FROM usda_food_portions p
    WHERE p.fdc_id = ANY(${[...fdcIds]}::int[])
      AND NOT EXISTS (
        SELECT 1 FROM unnest(${rows.map((r) => r.fdc_id)}::int[], ${rows.map((r) => r.seq_num)}::int[]) AS v(fdc_id, seq_num)
        WHERE v.fdc_id = p.fdc_id AND v.seq_num = p.seq_num)
    RETURNING p.fdc_id`;
  let changed = gone.length;
  for (const chunk of chunks(rows, PORTION_CHUNK)) {
    const written = await sql<{ fdc_id: number }[]>`
      INSERT INTO usda_food_portions ${sql(chunk, ...PORTION_COLUMNS)}
      ON CONFLICT (fdc_id, seq_num) DO UPDATE SET
        amount = excluded.amount, unit = excluded.unit, gram_weight = excluded.gram_weight
      WHERE (usda_food_portions.amount, usda_food_portions.unit, usda_food_portions.gram_weight)
        IS DISTINCT FROM (excluded.amount, excluded.unit, excluded.gram_weight)
      RETURNING fdc_id`;
    changed += written.length;
  }
  return changed;
}

export interface UsdaReleaseReport {
  release: UsdaRelease;
  foods: number;
  portions: number;
  changed: number;
  /** Descriptions with no word in them — none in either published release. */
  skipped: number;
}

export interface UsdaImportReport {
  perRelease: UsdaReleaseReport[];
  foods: number;
  changed: number;
  /** Foods already in the table that this run did not write. They are LEFT
   *  ALONE, never deleted: a saved meal may name one, and a meal's food must
   *  not vanish because USDA retired an entry. */
  stale: number;
}

/** Writes every release given, in ONE transaction: either the whole table moves
 *  to this pair of releases or none of it does. */
export async function importUsda(
  sql: Sql,
  releases: readonly (readonly [UsdaRelease, Iterable<UsdaEntry>])[],
): Promise<UsdaImportReport> {
  return sql.begin(async (tx) => {
    const perRelease: UsdaReleaseReport[] = [];
    const written: number[] = [];
    for (const [release, entries] of releases) {
      const report: UsdaReleaseReport = { release, foods: 0, portions: 0, changed: 0, skipped: 0 };
      for (const chunk of chunks([...entries], FOOD_CHUNK)) {
        const rows: UsdaFoodRow[] = [];
        const portions: UsdaPortionRow[] = [];
        for (const entry of chunk) {
          const row = usdaFoodRow(release, entry);
          if (row === null) report.skipped += 1;
          else {
            rows.push(row);
            portions.push(...usdaPortionRows(entry));
          }
        }
        const ids = rows.map((r) => r.fdc_id);
        // Foods first: a portion points at one.
        report.changed += await upsertUsdaFoods(tx, rows);
        report.changed += await replaceUsdaPortions(tx, ids, portions);
        report.foods += rows.length;
        report.portions += portions.length;
        written.push(...ids);
      }
      perRelease.push(report);
    }
    const [stale] = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM usda_foods WHERE fdc_id <> ALL(${written}::int[])`;
    return {
      perRelease,
      foods: perRelease.reduce((n, r) => n + r.foods, 0),
      changed: perRelease.reduce((n, r) => n + r.changed, 0),
      stale: Number(stale?.count ?? 0),
    };
  });
}
