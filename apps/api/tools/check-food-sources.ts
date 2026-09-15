// Checks every number in the curated food list against the table entry each food
// cites (src/modules/nutrition/foods.ts). The three public tables, about 14 MB,
// are downloaded once into a cache folder; each food whose kcal, protein,
// carbohydrate, fat or fibre differs from its entry is printed, and the run
// fails if any does. Not run in CI: it needs the network.
//
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts --list          every food beside its entry's own name
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts --cache=<dir>   default: the system temp folder
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { CURATED_FOODS } from "../src/modules/nutrition/foods.js";

type Figure = "kcal" | "proteinG" | "carbsG" | "fatG" | "fiberG";
const FIGURES: readonly Figure[] = ["kcal", "proteinG", "carbsG", "fatG", "fiberG"];

interface Entry {
  description: string;
  figures: Map<Figure, number | null>;
}

const fail = (message: string): never => {
  throw new Error(message);
};

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function download(url: string, file: string, cache: string): Promise<Buffer> {
  const path = join(cache, file);
  if (!existsSync(path)) {
    console.log(`downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) fail(`download failed (${String(response.status)}): ${url}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  return readFileSync(path);
}

/** The files of a zip archive whose names pass `wanted`, inflated. It reads the
 *  central directory; the archives here are far below ZIP64 sizes. */
function unzip(archive: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  let end = -1;
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 65_557); at--) {
    if (archive.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end === -1) fail("not a zip archive");
  const files = new Map<string, Buffer>();
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (archive.readUInt32LE(at) !== 0x02014b50) fail("damaged zip directory");
    const method = archive.readUInt16LE(at + 10);
    const size = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const skip = nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.toString("utf8", at + 46, at + 46 + nameLength);
    at += 46 + skip;
    if (!wanted(name)) continue;
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + size);
    if (method === 8) files.set(name, inflateRawSync(data));
    else if (method === 0) files.set(name, Buffer.from(data));
    else fail(`zip method ${String(method)} for ${name}`);
  }
  return files;
}

function* csvRows(text: string): Generator<string[]> {
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      yield row;
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/** A USDA FoodData Central CSV release, by FDC id. The SR Legacy files number
 *  their nutrients by id (1008 energy) and the survey files by nutrient number
 *  (208 energy). */
function usdaTable(archive: Buffer, nutrients: Readonly<Record<string, Figure>>): Map<string, Entry> {
  const files = unzip(archive, (name) => name.endsWith("/food.csv") || name.endsWith("/food_nutrient.csv"));
  const text = (suffix: string): string => {
    for (const [name, data] of files) if (name.endsWith(suffix)) return data.toString("utf8");
    return fail(`no ${suffix} in the archive`);
  };
  const table = new Map<string, Entry>();
  let header = true;
  for (const [id, , description] of csvRows(text("/food.csv"))) {
    if (header) header = false;
    else if (id !== undefined && description !== undefined) table.set(id, { description, figures: new Map() });
  }
  header = true;
  for (const [, id, nutrient, amount] of csvRows(text("/food_nutrient.csv"))) {
    if (header) {
      header = false;
      continue;
    }
    const figure = nutrient === undefined ? undefined : nutrients[nutrient];
    const entry = id === undefined ? undefined : table.get(id);
    if (figure !== undefined && entry !== undefined && amount !== undefined) entry.figures.set(figure, Number(amount));
  }
  return table;
}

const decodeXml = (s: string): string =>
  s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");

/** CoFID's "1.3 Proximates" sheet, by food code. "Tr" (trace) is 0; "N" (not
 *  measured) and an empty cell are null. Fibre is AOAC, or NSP where AOAC is null. */
function cofidTable(archive: Buffer): Map<string, Entry> {
  const files = unzip(archive, (name) => name.startsWith("xl/"));
  const xml = (name: string): string => files.get(name)?.toString("utf8") ?? fail(`no ${name} in the workbook`);
  const shared = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((si) =>
    decodeXml([...(si[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1] ?? "").join("")),
  );
  const sheetRel = /<sheet [^>]*name="1\.3 Proximates"[^>]*r:id="([^"]+)"/.exec(xml("xl/workbook.xml"))?.[1] ?? fail("no Proximates sheet");
  const rels = xml("xl/_rels/workbook.xml.rels");
  const target = [...rels.matchAll(/<Relationship [^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${sheetRel}"`));
  const sheetPath = /Target="([^"]+)"/.exec(target ?? "")?.[1] ?? fail("no Proximates sheet file");
  const rows: Map<string, string>[] = [];
  for (const rowXml of xml(`xl/${sheetPath}`).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<string, string>();
    for (const cell of (rowXml[1] ?? "").matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const column = cell[1] ?? "";
      const attributes = cell[2] ?? "";
      const inner = cell[3] ?? "";
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      if (attributes.includes('t="s"')) cells.set(column, shared[Number(value)] ?? "");
      else if (attributes.includes('t="inlineStr"')) cells.set(column, decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? ""));
      else cells.set(column, decodeXml(value ?? ""));
    }
    rows.push(cells);
  }
  const header = rows[0] ?? fail("an empty Proximates sheet");
  const column = (title: string): string => [...header].find(([, v]) => v === title)?.[0] ?? fail(`no "${title}" column`);
  const code = column("Food Code");
  const name = column("Food Name");
  const read = (row: Map<string, string>, title: string): number | null => {
    const raw = (row.get(column(title)) ?? "").trim();
    if (raw === "Tr") return 0;
    if (raw === "N" || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fail(`"${raw}" in ${title}`);
  };
  const table = new Map<string, Entry>();
  for (const row of rows.slice(1)) {
    const id = row.get(code);
    if (id === undefined || !/^\d{2}-\d+$/.test(id)) continue;
    const figures = new Map<Figure, number | null>([
      ["kcal", read(row, "Energy (kcal) (kcal)")],
      ["proteinG", read(row, "Protein (g)")],
      ["carbsG", read(row, "Carbohydrate (g)")],
      ["fatG", read(row, "Fat (g)")],
      ["fiberG", read(row, "AOAC fibre (g)") ?? read(row, "NSP (g)")],
    ]);
    table.set(id, { description: row.get(name) ?? "", figures });
  }
  return table;
}

const cache = arg("cache") ?? join(tmpdir(), "ai-home-gym-food-tables");
mkdirSync(cache, { recursive: true });
const tables = new Map<string, Map<string, Entry>>([
  [
    "usda-sr",
    usdaTable(await download("https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip", "usda-sr-legacy-2018-04.zip", cache), {
      "1008": "kcal", "1003": "proteinG", "1005": "carbsG", "1004": "fatG", "1079": "fiberG",
    }),
  ],
  [
    "usda-fndds",
    usdaTable(await download("https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip", "usda-fndds-2024-10-31.zip", cache), {
      "208": "kcal", "203": "proteinG", "205": "carbsG", "204": "fatG", "291": "fiberG",
    }),
  ],
  [
    "uk-cofid",
    cofidTable(await download("https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx", "uk-cofid-2021.xlsx", cache)),
  ],
]);

const differences: string[] = [];
const perTable = new Map<string, number>();
for (const food of CURATED_FOODS) {
  const [table = "", id = ""] = food.citation.split(":");
  perTable.set(table, (perTable.get(table) ?? 0) + 1);
  const entry = tables.get(table)?.get(id);
  if (entry === undefined) {
    differences.push(`${food.name}: ${food.citation} is not in its table`);
    continue;
  }
  for (const figure of FIGURES) {
    const expected = entry.figures.get(figure) ?? null;
    if (food[figure] !== expected) differences.push(`${food.name}: ${figure} is ${String(food[figure])}, ${food.citation} gives ${String(expected)}`);
  }
  if (process.argv.includes("--list")) console.log(`${food.name}  ·  ${food.citation}  ·  ${entry.description}`);
}

for (const line of differences) console.log(line);
const counts = [...perTable].map(([table, n]) => `${table} ${String(n)}`).join(", ");
console.log(`${String(CURATED_FOODS.length)} foods checked (${counts}): ${differences.length === 0 ? "every number matches its table entry" : `${String(differences.length)} differences`}`);
if (differences.length > 0) process.exitCode = 1;
