// Fills one packaged-food list from its rows (ROADMAP Stage 5 33b-iii-a): the rows into a staging table,
// then one transaction that writes what changed and removes what the file no longer holds. Members keep
// reading the old rows until it commits, and a second run writes nothing.
import { OFF_LIST_LOCK } from "../src/modules/nutrition/packagedRepo.js";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { Sql } from "postgres";
import type { RowResult, WrittenRow } from "../src/modules/nutrition/packagedRows.js";
import { noRefusals, type Refusals } from "./packaged-files.js";

const SHARED = ["search_text", "code", "name", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sat_fat_g", "unsat_fat_g", "sodium_mg", "potassium_mg", "calcium_mg", "iron_mg", "magnesium_mg", "vitamin_d_ug", "serving_size", "quantity", "numbers_fit"] as const;
const OFF_ONLY = ["allergens", "traces", "listed_as_typed", "scans"] as const;

/** A list smaller than this share of what is there is a bad file, not a smaller world. */
const LEAST_SHARE_OF_CURRENT = 0.5;

export class PackagedListRefused extends Error {}

/** A value for COPY's text format. */
const cell = (value: string | number | boolean | null): string => {
  if (value === null) return String.raw`\N`;
  if (typeof value === "boolean") return value ? "t" : "f";
  if (typeof value === "number") return String(value);
  return value.replaceAll("\\", "\\\\").replaceAll("\t", " ").replaceAll("\n", " ").replaceAll("\r", " ");
};
/** `allergenLists` leaves letters, marks, digits and spaces only, so no word needs escaping. */
const textArray = (words: readonly string[]): string => `{${words.map((word) => `"${word}"`).join(",")}}`;

const lineOf = (row: WrittenRow, withAllergens: boolean): string => {
  const shared = [row.searchText, row.code, row.name, row.kcal, row.proteinG, row.carbsG, row.fatG, row.more.fiberG, row.more.sugarsG, row.more.satFatG, row.more.unsatFatG, row.more.sodiumMg, row.more.potassiumMg, row.more.calciumMg, row.more.ironMg, row.more.magnesiumMg, row.more.vitaminDUg, row.servingSize, row.quantity, row.numbersFit].map(cell);
  return `${[...shared, ...(withAllergens ? [textArray(row.allergens), textArray(row.traces), textArray(row.listedAsTyped), String(row.scans)] : [])].join("\t")}\n`;
};

export interface ListReport {
  read: number;
  kept: number;
  refused: Refusals;
  written: number;
  removed: number;
}

export async function fillPackagedList(sql: Sql, table: "off_products" | "usda_branded_products", rows: AsyncIterable<RowResult>, markUpTo?: Date): Promise<ListReport> {
  const withAllergens = table === "off_products";
  const columns = [...SHARED, ...(withAllergens ? OFF_ONLY : [])];
  const list = sql(columns);
  const stage = sql(`${table}_stage`);
  const target = sql(table);
  const refused = noRefusals();
  let read = 0;
  async function* lines(): AsyncGenerator<string> {
    for await (const result of rows) {
      read++;
      if ("row" in result) yield lineOf(result.row, withAllergens);
      else refused[result.refused]++;
    }
  }
  const reserved = await sql.reserve();
  try {
    await reserved`BEGIN`;
    if (withAllergens) {
      const [free] = await reserved<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${OFF_LIST_LOCK}) AS ok`;
      if (free?.ok !== true) throw new PackagedListRefused("The nightly update is applying a file. Try again in a few minutes.");
    }
    await reserved`CREATE TEMP TABLE ${stage} (LIKE ${target} INCLUDING DEFAULTS) ON COMMIT DROP`;
    // The same code twice in a file (two ways of writing it): the last one stands.
    await reserved`ALTER TABLE ${stage} ADD COLUMN at bigserial`;
    const copy = await reserved`COPY ${stage} (${list}) FROM STDIN`.writable();
    await pipeline(Readable.from(lines()), copy);
    const [counts] = await reserved<{ kept: string; current: string }[]>`
      SELECT (SELECT count(DISTINCT code) FROM ${stage}) AS kept, (SELECT count(*) FROM ${target}) AS current`;
    const kept = Number(counts?.kept ?? 0);
    const current = Number(counts?.current ?? 0);
    if (kept < current * LEAST_SHARE_OF_CURRENT) throw new PackagedListRefused(`The file holds ${String(kept)} products and the list ${String(current)}: nothing was changed.`);
    const updates = columns.filter((c) => c !== "code");
    const written = await reserved`
      INSERT INTO ${target} (${list})
        SELECT DISTINCT ON (code) ${list} FROM ${stage} ORDER BY code, at DESC
      ON CONFLICT (code) DO UPDATE SET ${reserved.unsafe(updates.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", "))}
      WHERE (${reserved.unsafe(updates.map((c) => `${table}."${c}"`).join(", "))}) IS DISTINCT FROM (${reserved.unsafe(updates.map((c) => `EXCLUDED."${c}"`).join(", "))})
      RETURNING code`;
    const removed = await reserved`DELETE FROM ${target} t WHERE NOT EXISTS (SELECT 1 FROM ${stage} s WHERE s.code = t.code) RETURNING code`;
    // In the same commit as the rows: a load with no mark would leave the days after it marked as done.
    if (markUpTo !== undefined) {
      await recordFullLoad(reserved, markUpTo);
    }
    await reserved`COMMIT`;
    return { read, kept, refused, written: written.length, removed: removed.length };
  } catch (err) {
    await reserved`ROLLBACK`.catch(() => undefined);
    throw err;
  } finally {
    reserved.release();
  }
}

/** A load marks the list as loaded up to a day before its download was made, not before the import
 *  ran, and forgets the days after that, so the nightly update applies again the days the download might
 *  not hold: left marked as done, an older download would stay as it is. It also undoes a wrong far-off
 *  date from their list. Applying a day twice leaves the same rows. */
const markSeconds = (downloadMade: Date): number => Math.floor(downloadMade.getTime() / 1000) - 24 * 3600;

export async function recordFullLoad(sql: Sql, downloadMade: Date): Promise<void> {
  const seconds = markSeconds(downloadMade);
  await sql`DELETE FROM off_daily_files WHERE to_second > ${seconds}`;
  await sql`INSERT INTO off_daily_files (name, to_second, products, written, removed) VALUES (${`full_${downloadMade.toISOString()}`}, ${seconds}, 0, 0, 0) ON CONFLICT (name) DO UPDATE SET to_second = EXCLUDED.to_second`;
}

/** Whether the nightly files still reach back to a download of this date: if not, days would be lost. */
export const downloadStillCovered = (downloadMade: Date, oldestListedFrom: number): boolean => markSeconds(downloadMade) >= oldestListedFrom;
