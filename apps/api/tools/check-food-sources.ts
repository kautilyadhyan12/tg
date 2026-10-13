// Checks every number in the curated food list against the table entry each food
// cites (src/modules/nutrition/foods.ts). The three public tables, about 14 MB,
// are downloaded once into a cache folder; each food whose kcal, protein,
// carbohydrate, fat or fibre differs from its entry is printed, and the run
// fails if any does. Not run in CI: it needs the network.
//
// It also holds test/fixtures/usda-sr-food-groups.json to the download: USDA's own
// description and food group of every SR Legacy entry the list cites, which
// nutrition.foods.diet.unit.test.ts checks each food's diet against.
//
// The USDA zip and CSV readers live in `usda-files.ts`, which the USDA importer
// reads the same two releases with (ROADMAP 7a-iii-a); the CoFID workbook is
// this tool's alone.
//
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts --list          every food beside its entry's own name
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts --cache=<dir>   default: the system temp folder
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts --write-groups  write the food groups file again, after the list grew
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CURATED_FOODS, PIECE_ENTRIES } from "../src/modules/nutrition/foods.js";
import { foodMeasures } from "../src/modules/nutrition/measures.js";
import {
  defaultCache,
  download,
  fail,
  unzip,
  usdaFoodGroups,
  usdaTable,
  USDA_RELEASES,
  type UsdaNutrient,
} from "./usda-files.js";

/** The five figures the curated list copies. `usda-files.ts` reads twelve more
 *  for the food table; this tool compares only what a curated row carries. */
type Figure = Extract<UsdaNutrient, "kcal" | "proteinG" | "carbsG" | "fatG" | "fiberG">;
const FIGURES: readonly Figure[] = ["kcal", "proteinG", "carbsG", "fatG", "fiberG"];

interface Entry {
  description: string;
  figures: Map<UsdaNutrient, number | null>;
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
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
    const figures = new Map<UsdaNutrient, number | null>([
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

const GROUPS_ABOUT =
  "USDA FoodData Central, SR Legacy (April 2018, public domain): the description and the food group of every entry our food list cites, by FDC id, as USDA's own food.csv and food_category.csv give them. Written by tools/check-food-sources.ts --write-groups, which also fails when this file differs from the download; never edited by hand.";

const cache = arg("cache") ?? defaultCache();
const usdaZip = async (release: keyof typeof USDA_RELEASES): Promise<Buffer> => {
  const { url, file, sha256 } = USDA_RELEASES[release];
  return download(url, file, cache, sha256);
};
const srLegacyZip = await usdaZip("sr_legacy");
const srLegacy = usdaTable(srLegacyZip, "sr_legacy");
const fndds = usdaTable(await usdaZip("fndds"), "fndds");
const cofid = cofidTable(
  await download(
    "https://assets.publishing.service.gov.uk/media/60538b91e90e07527df82ae4/McCance_Widdowsons_Composition_of_Foods_Integrated_Dataset_2021..xlsx",
    "uk-cofid-2021.xlsx",
    cache,
  ),
);

/** The entry a citation points at. USDA is keyed by its numeric FDC id, CoFID by
 *  its "AC-nnn" food code. */
const lookup = (table: string, id: string): Entry | undefined => {
  if (table === USDA_RELEASES.sr_legacy.citation) return srLegacy.get(Number(id));
  if (table === USDA_RELEASES.fndds.citation) return fndds.get(Number(id));
  if (table === "uk-cofid") return cofid.get(id);
  return undefined;
};

const differences: string[] = [];
const perTable = new Map<string, number>();
for (const food of CURATED_FOODS) {
  const [table = "", id = ""] = food.citation.split(":");
  perTable.set(table, (perTable.get(table) ?? 0) + 1);
  const entry = lookup(table, id);
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

// USDA's description and food group of every SR Legacy entry cited.
const groups = usdaFoodGroups(srLegacyZip);
const cited: Record<string, [string, string]> = {};
for (const food of CURATED_FOODS) {
  const [table = "", id = ""] = food.citation.split(":");
  if (table !== USDA_RELEASES.sr_legacy.citation) continue;
  const entry = srLegacy.get(Number(id));
  const group = groups.get(Number(id));
  if (entry !== undefined && group !== undefined) cited[id] = [entry.description, group];
  else differences.push(`${food.name}: ${food.citation} has no food group`);
}
const groupsPath = join(import.meta.dirname, "..", "test", "fixtures", "usda-sr-food-groups.json");
const groupsFile = `${JSON.stringify({ about: GROUPS_ABOUT, foods: cited }, null, 1)}\n`;
if (process.argv.includes("--write-groups")) writeFileSync(groupsPath, groupsFile);
else if (readFileSync(groupsPath, "utf8").replaceAll("\r\n", "\n") !== groupsFile) {
  differences.push("test/fixtures/usda-sr-food-groups.json is not what the download gives: run this tool with --write-groups");
}

// A food that borrows its pieces: the entry is in the survey release and still gives a measure the cited one lacks.
for (const [canonical, fdcId] of PIECE_ENTRIES) {
  const food = CURATED_FOODS.find((f) => f.canonical === canonical);
  const entry = fndds.get(fdcId);
  const citedId = Number(food?.citation.split(":")[1]);
  const citedEntry = srLegacy.get(citedId) ?? fndds.get(citedId);
  if (food === undefined || entry === undefined || citedEntry === undefined) {
    differences.push(`${canonical}: its pieces' entry ${String(fdcId)} or the food itself is missing`);
    continue;
  }
  const measures = foodMeasures({ serving: food.serving, unit: food.unit, ownServing: true, portions: citedEntry.portions, pieces: entry.portions });
  const pieces = measures.filter((m) => m.id.startsWith("piece-") && m.grams <= 30);
  if (pieces.length === 0) differences.push(`${food.name}: ${String(fdcId)} ("${entry.description}") gives no piece of 30 g or less`);
  else if (process.argv.includes("--list")) console.log(`${food.name}  ·  pieces from ${String(fdcId)}  ·  ${entry.description}: ${pieces.map((m) => `${m.name} ${String(m.grams)} g`).join(", ")}`);
}

for (const line of differences) console.log(line);
const counts = [...perTable].map(([table, n]) => `${table} ${String(n)}`).join(", ");
console.log(`${String(CURATED_FOODS.length)} foods checked (${counts}): ${differences.length === 0 ? "every number matches its table entry" : `${String(differences.length)} differences`}`);
if (differences.length > 0) process.exitCode = 1;
