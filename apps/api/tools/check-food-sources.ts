// Checks every number in the curated food list against the table entry each food
// cites (src/modules/nutrition/foods.ts). The three public tables, about 14 MB,
// are downloaded once into a cache folder; each food whose kcal, protein,
// carbohydrate, fat or fibre differs from its entry is printed, and the run
// fails if any does. Not run in CI: it needs the network.
//
// It also holds three files in test/fixtures to the download, which
// nutrition.foods.diet.unit.test.ts checks each food's diet against: USDA's own
// description and food group of every SR Legacy entry the list cites
// (usda-sr-food-groups.json), what USDA makes every survey entry it cites from
// (usda-fndds-ingredients.json), and CoFID's name and note for every entry of its
// own (uk-cofid-names.json).
//
// The USDA zip and CSV readers live in `usda-files.ts`, which the USDA importer
// reads the same two releases with (ROADMAP 7a-iii-a); the CoFID workbook's is
// `cofid-file.ts`.
//
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts --list          every food beside its entry's own name
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts --cache=<dir>   default: the system temp folder
//   corepack pnpm --filter api exec tsx tools/check-food-sources.ts --write-groups  write the three fixture files again, after the list grew
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CURATED_FOODS, PIECE_ENTRIES } from "../src/modules/nutrition/foods.js";
import { foodMeasures } from "../src/modules/nutrition/measures.js";
import { COFID_URL, cofidTable } from "./cofid-file.js";
import {
  defaultCache,
  download,
  usdaFoodGroups,
  usdaIngredients,
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

/** A fixture file's text: what it is, then its foods by id, in id order. */
const fixture = (about: string, foods: Record<string, unknown>): string =>
  `${JSON.stringify({ about, foods: Object.fromEntries(Object.entries(foods).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) }, null, 1)}\n`;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const INGREDIENTS_ABOUT =
  "USDA FoodData Central, FNDDS 2021-2023 survey foods (October 2024, public domain): the description of every survey entry our food list cites, by FDC id, and what USDA makes it from, as its input_food.csv lists them: each ingredient's description and its SR Legacy food group, empty where the ingredient is not in that release. An ingredient that is itself a survey food is read down to its own ingredients. Written by tools/check-food-sources.ts --write-groups, which also fails when this file differs from the download; never edited by hand.";
const COFID_ABOUT =
  "UK McCance and Widdowson's Composition of Foods Integrated Dataset (2021, Open Government Licence): the food name and the description of every entry our food list cites, by food code, as the workbook's Proximates sheet gives them. Written by tools/check-food-sources.ts --write-groups, which also fails when this file differs from the download; never edited by hand.";
const GROUPS_ABOUT =
  "USDA FoodData Central, SR Legacy (April 2018, public domain): the description and the food group of every entry our food list cites, by FDC id, as USDA's own food.csv and food_category.csv give them. Written by tools/check-food-sources.ts --write-groups, which also fails when this file differs from the download; never edited by hand.";

const cache = arg("cache") ?? defaultCache();
const usdaZip = async (release: keyof typeof USDA_RELEASES): Promise<Buffer> => {
  const { url, file, sha256 } = USDA_RELEASES[release];
  return download(url, file, cache, sha256);
};
const srLegacyZip = await usdaZip("sr_legacy");
const srLegacy = usdaTable(srLegacyZip, "sr_legacy");
const fnddsZip = await usdaZip("fndds");
const fndds = usdaTable(fnddsZip, "fndds");
const cofid = cofidTable(await download(COFID_URL, "uk-cofid-2021.xlsx", cache));

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

// What USDA makes every survey entry cited from, and CoFID's own words for each of its entries.
const ingredients = usdaIngredients(fnddsZip, srLegacyZip);
const made: Record<string, [string, (readonly [string, string])[]]> = {};
const named: Record<string, [string, string]> = {};
for (const food of CURATED_FOODS) {
  const [table = "", id = ""] = food.citation.split(":");
  if (table === USDA_RELEASES.fndds.citation) {
    const entry = fndds.get(Number(id));
    const list = ingredients.get(Number(id));
    if (entry !== undefined && list !== undefined && list.length > 0) made[id] = [entry.description, list];
    else differences.push(`${food.name}: ${food.citation} has no ingredients`);
  } else if (table === "uk-cofid") {
    const entry = cofid.get(id);
    if (entry !== undefined) named[id] = [entry.description, entry.note];
  }
}

for (const [file, text] of [
  ["usda-sr-food-groups.json", fixture(GROUPS_ABOUT, cited)],
  ["usda-fndds-ingredients.json", fixture(INGREDIENTS_ABOUT, made)],
  ["uk-cofid-names.json", fixture(COFID_ABOUT, named)],
] as const) {
  const path = join(import.meta.dirname, "..", "test", "fixtures", file);
  if (process.argv.includes("--write-groups")) writeFileSync(path, text);
  else if (!existsSync(path) || readFileSync(path, "utf8").replaceAll("\r\n", "\n") !== text) {
    differences.push(`test/fixtures/${file} is not what the download gives: run this tool with --write-groups`);
  }
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
