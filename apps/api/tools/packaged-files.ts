// Reads the two packaged-food downloads, row by row (ROADMAP Stage 5 33b-iii-a): Open Food Facts' CSV
// and USDA's three Branded Foods CSVs. The rows themselves are `modules/nutrition/packagedRows.ts`.
import { createReadStream, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createGunzip } from "node:zlib";
import { linesOf, rowOfJsonLine } from "../src/modules/nutrition/packagedSync.js";
import { classifyBarcode } from "@app/shared";
import { OFF_CSV_COLUMNS, offProductOfCsv, offRowOf, usdaRowOf, type RowRefusal, type RowResult } from "../src/modules/nutrition/packagedRows.js";

export type Refusals = Record<RowRefusal, number>;
export const noRefusals = (): Refusals => ({ bad_code: 0, store_only: 0, not_a_food: 0, no_name: 0, no_calories: 0, out_of_bounds: 0 });

/** Every row of Open Food Facts' file: the JSONL export (`.jsonl` or `.jsonl.gz`), which marks its
 *  estimates, or the smaller CSV. A CSV header without the columns read is a changed file, and a JSONL
 *  whose lines are not their shape is one too: refused before the list is touched. `.gz` is unpacked. */
export async function* offRowsOfFile(file: string): AsyncGenerator<RowResult> {
  const source = createReadStream(file, { highWaterMark: 1 << 20 });
  const stream = file.endsWith(".gz") ? source.pipe(createGunzip({ chunkSize: 1 << 20 })) : source;
  if (/\.jsonl(\.gz)?$/.test(file)) {
    let read = 0;
    let bad = 0;
    for await (const line of linesOf(stream as AsyncIterable<Buffer>)) {
      if (line.length === 0) continue;
      read++;
      const result = rowOfJsonLine(line);
      if (result === null) {
        bad++;
        if (bad > 100 && bad / read > 0.01) throw new Error("The Open Food Facts file has changed: its lines are not their shape.");
      } else yield result;
    }
    return;
  }
  let index: Map<string, number> | null = null;
  for await (const line of linesOf(stream as AsyncIterable<Buffer>)) {
    const cells = line.toString("utf8").split("\t");
    if (index === null) {
      index = new Map(cells.map((name, at) => [name.trim(), at]));
      const missing = OFF_CSV_COLUMNS.filter((name) => index?.has(name) !== true);
      if (missing.length > 0) throw new Error(`The Open Food Facts file has changed: no ${missing.join(", ")}.`);
      continue;
    }
    yield offRowOf(offProductOfCsv(index, cells));
  }
}

/** A CSV reader that allows quotes, commas and newlines inside a field. */
async function* csvRows(file: string): AsyncGenerator<string[]> {
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  for await (const chunk of createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 })) {
    const text = String(chunk);
    for (const c of text) {
      if (quoted) {
        if (c === '"') {
          quoted = false;
          afterQuote = true;
        } else field += c;
      } else if (c === '"') {
        if (afterQuote) field += '"';
        quoted = true;
        afterQuote = false;
      } else if (c === ",") {
        row.push(field);
        field = "";
        afterQuote = false;
      } else if (c === "\n") {
        row.push(field.replace(/\r$/, ""));
        field = "";
        afterQuote = false;
        yield row;
        row = [];
      } else {
        field += c;
        afterQuote = false;
      }
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    yield row;
  }
}

const NUTRIENTS: Readonly<Record<string, string>> = {
  "1008": "energy-kcal_100g", "1003": "proteins_100g", "1005": "carbohydrates_100g", "1004": "fat_100g", "1079": "fiber_100g", "2000": "sugars_100g",
  "1258": "saturated-fat_100g", "1292": "monounsaturated-fat_100g", "1293": "polyunsaturated-fat_100g", "1093": "sodium_100g", "1092": "potassium_100g",
  "1087": "calcium_100g", "1089": "iron_100g", "1090": "magnesium_100g", "1114": "vitamin-d_100g", "1018": "alcohol_100g",
};

interface Newest { fdc: string; date: string; size: string; unit: string; household: string; brand: string; name: string; figures: Record<string, number> }

/** Finds a file by name in the folder or one folder down, as USDA's zip unpacks. */
function findIn(dir: string, name: string): string {
  const direct = readdirSync(dir, { withFileTypes: true });
  const here = direct.find((e) => e.isFile() && (e.name === name || e.name === `usda-${name}`));
  if (here !== undefined) return join(dir, here.name);
  for (const folder of direct.filter((e) => e.isDirectory())) {
    const below = readdirSync(join(dir, folder.name)).find((n) => basename(n) === name);
    if (below !== undefined) return join(dir, folder.name, below);
  }
  throw new Error(`No ${name} in ${dir}.`);
}

/** Every product of USDA's Branded Foods: its file holds each code's history, and the newest row is
 *  the product. A code with a bad check digit or a store's own is refused by the row rule. */
export async function* usdaRowsOfDir(dir: string): AsyncGenerator<RowResult> {
  const newest = new Map<string, Newest>();
  const byFdc = new Map<string, Newest>();
  let head: Map<string, number> | null = null;
  for await (const r of csvRows(findIn(dir, "branded_food.csv"))) {
    if (head === null) {
      head = new Map(r.map((name, at) => [name, at]));
      continue;
    }
    const at = (name: string): string => r[head?.get(name) ?? -1] ?? "";
    const raw = at("gtin_upc").trim();
    if (raw === "") continue;
    // One product under one key, however USDA wrote it: 23,128 products are written two ways.
    const kind = classifyBarcode(raw);
    const code = kind.kind === "product" ? kind.code : raw;
    const date = at("modified_date") || at("available_date");
    const held = newest.get(code);
    if (held !== undefined && date < held.date) continue;
    if (held !== undefined) byFdc.delete(held.fdc);
    const row: Newest = { fdc: at("fdc_id"), date, size: at("serving_size"), unit: at("serving_size_unit"), household: at("household_serving_fulltext"), brand: at("brand_name"), name: at("short_description"), figures: {} };
    newest.set(code, row);
    byFdc.set(row.fdc, row);
  }
  head = null;
  for await (const r of csvRows(findIn(dir, "food.csv"))) {
    if (head === null) {
      head = new Map(r.map((name, at) => [name, at]));
      continue;
    }
    const row = byFdc.get(r[head.get("fdc_id") ?? -1] ?? "");
    const description = r[head.get("description") ?? -1] ?? "";
    if (row !== undefined && description !== "") row.name = description;
  }
  let first = true;
  for await (const line of linesOf(createReadStream(findIn(dir, "food_nutrient.csv"), { highWaterMark: 1 << 20 }) as AsyncIterable<Buffer>)) {
    if (first) {
      first = false;
      continue;
    }
    const cells = line.toString("latin1").split('","');
    const name = NUTRIENTS[cells[2] ?? ""];
    if (name === undefined) continue;
    const row = byFdc.get(cells[1] ?? "");
    const amount = Number(cells[3]);
    if (row !== undefined && Number.isFinite(amount)) row.figures[name] = amount;
  }
  for (const [code, row] of newest) yield usdaRowOf({ code, name: row.name, brand: row.brand, size: row.size, unit: row.unit, household: row.household, figures: row.figures });
}
