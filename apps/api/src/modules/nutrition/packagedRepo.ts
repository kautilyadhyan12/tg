// The packaged-food lists' reads and writes (ROADMAP Stage 5 33b-iii-a). Public data, no owner: no
// tenancy WHERE to get wrong, as `usda_foods`.
import type { Sql, TransactionSql } from "postgres";
import type { OffRow, PackagedRow, WrittenRow } from "./packagedRows.js";
import { usdaSearchWords, usdaTsQuery } from "./repo.js";

const PRODUCT_COLUMNS = ["code", "name", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sat_fat_g", "unsat_fat_g", "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg", "magnesium_mg", "vitamin_d_ug", "serving_size", "quantity", "numbers_fit"] as const;
const OFF_COLUMNS = [...PRODUCT_COLUMNS, "allergens", "traces", "listed_as_typed"] as const;
const WRITTEN_COLUMNS = [...OFF_COLUMNS, "search_text", "scans"] as const;

interface ProductRecord {
  code: string;
  name: string;
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugars_g: number | null;
  sat_fat_g: number | null;
  unsat_fat_g: number | null;
  sodium_mg: number | null;
  potassium_mg: number | null;
  calcium_mg: number | null;
  iron_mg: number | null;
  magnesium_mg: number | null;
  vitamin_d_ug: number | null;
  serving_size: string | null;
  quantity: string | null;
  numbers_fit: boolean;
}

const productOf = (r: ProductRecord): PackagedRow => ({
  code: r.code,
  name: r.name,
  kcal: r.kcal,
  proteinG: r.protein_g,
  carbsG: r.carbs_g,
  fatG: r.fat_g,
  more: {
    fiberG: r.fiber_g,
    sugarsG: r.sugars_g,
    satFatG: r.sat_fat_g,
    unsatFatG: r.unsat_fat_g,
    sodiumMg: r.sodium_mg,
    potassiumMg: r.potassium_mg,
    calciumMg: r.calcium_mg,
    ironMg: r.iron_mg,
    magnesiumMg: r.magnesium_mg,
    vitaminDUg: r.vitamin_d_ug,
  },
  servingSize: r.serving_size,
  quantity: r.quantity,
  numbersFit: r.numbers_fit,
});

type OffRecord = ProductRecord & { allergens: string[]; traces: string[]; listed_as_typed: string[] };
const offOf = (r: OffRecord): OffRow => ({ ...productOf(r), allergens: r.allergens, traces: r.traces, listedAsTyped: r.listed_as_typed });

/** What each list holds for one code. Exact on the primary key: one row or none. */
export async function packagedRowsFor(sql: Sql, code: string): Promise<{ off: OffRow | null; usda: PackagedRow | null }> {
  const [offRows, usdaRows] = await Promise.all([
    sql<OffRecord[]>`SELECT ${sql(OFF_COLUMNS)} FROM off_products WHERE code = ${code}`,
    sql<ProductRecord[]>`SELECT ${sql(PRODUCT_COLUMNS)} FROM usda_branded_products WHERE code = ${code}`,
  ]);
  const off = offRows[0];
  const usda = usdaRows[0];
  return { off: off === undefined ? null : offOf(off), usda: usda === undefined ? null : productOf(usda) };
}

/** What each list holds for these codes, in one read of each: for a search's page of products. */
export async function packagedRowsForCodes(sql: Sql, codes: readonly string[]): Promise<{ off: Map<string, OffRow>; usda: Map<string, PackagedRow> }> {
  if (codes.length === 0) return { off: new Map(), usda: new Map() };
  const list = sql.array([...codes]);
  const [offRows, usdaRows] = await Promise.all([
    sql<OffRecord[]>`SELECT ${sql(OFF_COLUMNS)} FROM off_products WHERE code = ANY(${list})`,
    sql<ProductRecord[]>`SELECT ${sql(PRODUCT_COLUMNS)} FROM usda_branded_products WHERE code = ANY(${list})`,
  ]);
  return { off: new Map(offRows.map((r) => [r.code, offOf(r)])), usda: new Map(usdaRows.map((r) => [r.code, productOf(r)])) };
}

/** The codes of the products a typed search finds, best first. Every word must match, the last as the
 *  start of a word, as the USDA table's search reads them. Numbers that add up first, then a product
 *  named just what was typed, one whose name starts with it, then the most scanned.
 *
 *  The products scanned at least 3 times are asked first, by their own small index: a common word then
 *  sorts a few thousand and not ninety thousand. Only if they do not fill the page is the whole list read.
 *  One letter alone is no search. */
export async function packagedCodesFor(sql: Sql, query: string, limit: number): Promise<string[]> {
  const words = usdaSearchWords(query);
  const tsQuery = usdaTsQuery(query);
  if (tsQuery === null || limit < 1 || (words.length === 1 && (words[0]?.length ?? 0) < 2)) return [];
  const typed = words.join(" ");
  const order = sql`
    (numbers_fit AND NOT (kcal = 0 AND (protein_g IS NULL OR carbs_g IS NULL OR fat_g IS NULL))) DESC,
    (search_text = ${typed} OR search_text LIKE ${`${typed} · %`}) DESC,
    (search_text LIKE ${`${typed} %`}) DESC`;
  const popular = await sql<{ code: string }[]>`
    SELECT code FROM off_products WHERE scans >= 3 AND search @@ to_tsquery('english', ${tsQuery})
    ORDER BY ${order}, scans DESC, length(name) ASC, code ASC LIMIT ${limit}`;
  if (popular.length >= limit) return popular.map((r) => r.code);
  const rest = await sql<{ code: string }[]>`
    SELECT code FROM off_products WHERE scans < 3 AND search @@ to_tsquery('english', ${tsQuery})
    ORDER BY ${order}, scans DESC, length(name) ASC, code ASC LIMIT ${limit - popular.length}`;
  const usda = await sql<{ code: string }[]>`
    SELECT code FROM usda_branded_products WHERE search @@ to_tsquery('english', ${tsQuery})
    ORDER BY ${order}, length(name) ASC, code ASC LIMIT ${limit}`;
  return [...new Set([...popular, ...rest, ...usda].map((r) => r.code))].slice(0, limit);
}

/** Whether the list has been loaded: until it has, the nightly update has nothing to change. */
export async function offListLoaded(sql: Sql): Promise<boolean> {
  const rows = await sql<{ loaded: boolean }[]>`SELECT EXISTS (SELECT 1 FROM off_products) AS loaded`;
  return rows[0]?.loaded === true;
}

export async function appliedDailyFiles(sql: Sql): Promise<{ names: Set<string>; lastToSecond: number | null }> {
  const rows = await sql<{ name: string; to_second: number }[]>`SELECT name, to_second FROM off_daily_files`;
  return { names: new Set(rows.map((r) => r.name)), lastToSecond: rows.length === 0 ? null : Math.max(...rows.map((r) => r.to_second)) };
}

const recordOf = (row: WrittenRow): Record<string, unknown> => ({
  scans: row.scans, search_text: row.searchText,
  code: row.code, name: row.name, kcal: row.kcal, protein_g: row.proteinG, carbs_g: row.carbsG, fat_g: row.fatG,
  fiber_g: row.more.fiberG, sugars_g: row.more.sugarsG, sat_fat_g: row.more.satFatG, unsat_fat_g: row.more.unsatFatG,
  sodium_mg: row.more.sodiumMg, potassium_mg: row.more.potassiumMg, calcium_mg: row.more.calciumMg, iron_mg: row.more.ironMg,
  magnesium_mg: row.more.magnesiumMg, vitamin_d_ug: row.more.vitaminDUg, serving_size: row.servingSize, quantity: row.quantity,
  numbers_fit: row.numbersFit, allergens: row.allergens, traces: row.traces, listed_as_typed: row.listedAsTyped,
});

/** The one lock the nightly update and a full import of Open Food Facts' list share: neither runs during the other; two runs of the update may, as each file is claimed once. */
export const OFF_LIST_LOCK = 3301;
export class PackagedListBusy extends Error {}

/** One daily file, in one transaction, or nothing: the rows it changed written, the codes it took the
 *  numbers from removed, and its name recorded. A name already recorded means another run did it, and
 *  nothing is written, so two runs of a night are safe. Returns null then. */
export async function applyDailyFile(
  sql: Sql,
  file: { name: string; toSecond: number; products: number },
  rows: readonly WrittenRow[],
  removeCodes: readonly string[],
): Promise<{ written: number; removed: number } | null> {
  return await sql.begin(async (tx: TransactionSql) => {
    // A full import running: tonight's file waits for the next night, which applies it after the import.
    await tx`SET LOCAL lock_timeout = '30s'`;
    const [free] = await tx<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock_shared(${OFF_LIST_LOCK}) AS ok`;
    if (free?.ok !== true) throw new PackagedListBusy("a full import of the list is running");
    // A file whose read began before an import finished, and which that import already covers.
    const [mark] = await tx<{ to_second: string | null }[]>`SELECT max(to_second) AS to_second FROM off_daily_files WHERE name LIKE 'full\_%'`;
    if (mark?.to_second != null && file.toSecond <= Number(mark.to_second)) return null;
    const claimed = await tx`
      INSERT INTO off_daily_files (name, to_second, products, written, removed)
      VALUES (${file.name}, ${file.toSecond}, ${file.products}, 0, 0)
      ON CONFLICT (name) DO NOTHING RETURNING name`;
    if (claimed.length === 0) return null;
    const written = rows.length === 0 ? [] : await tx`
      INSERT INTO off_products AS p (${sql(WRITTEN_COLUMNS)})
        SELECT ${sql(WRITTEN_COLUMNS)} FROM jsonb_populate_recordset(NULL::off_products, ${JSON.stringify(rows.map(recordOf))}::text::jsonb) ORDER BY code
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name, kcal = EXCLUDED.kcal, protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
        fiber_g = EXCLUDED.fiber_g, sugars_g = EXCLUDED.sugars_g, sat_fat_g = EXCLUDED.sat_fat_g, unsat_fat_g = EXCLUDED.unsat_fat_g,
        sodium_mg = EXCLUDED.sodium_mg, potassium_mg = EXCLUDED.potassium_mg, calcium_mg = EXCLUDED.calcium_mg, iron_mg = EXCLUDED.iron_mg,
        magnesium_mg = EXCLUDED.magnesium_mg, vitamin_d_ug = EXCLUDED.vitamin_d_ug, serving_size = EXCLUDED.serving_size, quantity = EXCLUDED.quantity,
        numbers_fit = EXCLUDED.numbers_fit, allergens = EXCLUDED.allergens, traces = EXCLUDED.traces, listed_as_typed = EXCLUDED.listed_as_typed,
        search_text = EXCLUDED.search_text, scans = GREATEST(p.scans, EXCLUDED.scans)
      RETURNING code`;
    const removed = removeCodes.length === 0 ? [] : await tx`DELETE FROM off_products WHERE code = ANY(${tx.array([...removeCodes])}) RETURNING code`;
    await tx`UPDATE off_daily_files SET written = ${written.length}, removed = ${removed.length} WHERE name = ${file.name}`;
    return { written: written.length, removed: removed.length };
  });
}
