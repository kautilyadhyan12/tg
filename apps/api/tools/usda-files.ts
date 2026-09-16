// The USDA FoodData Central releases, read from their published CSV zips.
// Two tools read them and this file is the only reader: `check-food-sources.ts`
// checks the curated list's numbers against the entry each food cites, and
// `import-usda.ts` fills the `usda_foods` table (ROADMAP 7a-iii-a).
//
// The data is public domain, CC0 1.0 (RULINGS 2026-09-16): no fee, no API key,
// two files downloaded once and cached.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

export const fail = (message: string): never => {
  throw new Error(message);
};

/** The two releases. SR Legacy's `food_nutrient.csv` names a nutrient by its
 *  FDC id (1008 energy); the survey release reuses the same column for the
 *  nutrient NUMBER (208 energy), which is why each figure carries both.
 *
 *  `sha256` is the digest this tool was built against: measured 2026-09-16 on the
 *  two files as downloaded that day. It is NOT a checksum USDA publishes — its
 *  download page shows none (read 2026-09-16) — so it pins these tools to the
 *  bytes they were built and tested on, which is a weaker promise than a
 *  publisher's signature and is written as one. It is checked on every read,
 *  download or cache alike: the cache is a folder in the machine's shared temp
 *  directory and `import-usda.ts` is a tool an operator points at PRODUCTION, so
 *  bytes nobody vouched for must never become 13,225 food rows. A release that
 *  fails it stops the run with the file's name — USDA publishes a dated file and
 *  does not rewrite it, so a mismatch is a damaged download, a tampered cache, or
 *  a new release that a card must adopt on purpose. */
export const USDA_RELEASES = {
  sr_legacy: {
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
    file: "usda-sr-legacy-2018-04.zip",
    sha256: "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0",
    /** The citation prefix the curated list writes for this release. */
    citation: "usda-sr",
  },
  fndds: {
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip",
    file: "usda-fndds-2024-10-31.zip",
    sha256: "5ccc25ec2777a8982fbb61378a42f415316173eb11e48c9a8ba4cb19f5a4f29c",
    citation: "usda-fndds",
  },
} as const;
export type UsdaRelease = keyof typeof USDA_RELEASES;
/** Both releases, in the order the importer writes them. */
export const USDA_RELEASE_ORDER: readonly UsdaRelease[] = ["sr_legacy", "fndds"];

/** Every figure the table carries, per 100 g, in the order 7a-iii-a's columns
 *  take: the five the curated list cites first, then the twelve 7a-v shows.
 *  `key` is the field on an `Entry`; `sr` and `fndds` are the two releases'
 *  numbering of the same nutrient. Units are USDA's own (kcal, g, mg, µg). */
export const USDA_NUTRIENTS = [
  { key: "kcal", sr: "1008", fndds: "208", column: "kcal" },
  { key: "proteinG", sr: "1003", fndds: "203", column: "protein_g" },
  { key: "carbsG", sr: "1005", fndds: "205", column: "carbs_g" },
  { key: "fatG", sr: "1004", fndds: "204", column: "fat_g" },
  { key: "fiberG", sr: "1079", fndds: "291", column: "fiber_g" },
  { key: "sugarsG", sr: "2000", fndds: "269", column: "sugars_g" },
  { key: "satFatG", sr: "1258", fndds: "606", column: "sat_fat_g" },
  { key: "monoFatG", sr: "1292", fndds: "645", column: "mono_fat_g" },
  { key: "polyFatG", sr: "1293", fndds: "646", column: "poly_fat_g" },
  { key: "cholesterolMg", sr: "1253", fndds: "601", column: "cholesterol_mg" },
  { key: "sodiumMg", sr: "1093", fndds: "307", column: "sodium_mg" },
  { key: "potassiumMg", sr: "1092", fndds: "306", column: "potassium_mg" },
  { key: "calciumMg", sr: "1087", fndds: "301", column: "calcium_mg" },
  { key: "ironMg", sr: "1089", fndds: "303", column: "iron_mg" },
  { key: "magnesiumMg", sr: "1090", fndds: "304", column: "magnesium_mg" },
  { key: "vitaminDUg", sr: "1114", fndds: "328", column: "vitamin_d_ug" },
  { key: "vitaminCMg", sr: "1162", fndds: "401", column: "vitamin_c_mg" },
] as const;
export type UsdaNutrient = (typeof USDA_NUTRIENTS)[number]["key"];

/** A household measure of one food: "1 cup · 246 g". `amount` is the release's
 *  own number where it gives one (SR) and null where the measure's text carries
 *  it instead (FNDDS's "1 cup"). */
export interface UsdaPortion {
  seqNum: number;
  amount: number | null;
  unit: string;
  gramWeight: number;
}

export interface UsdaEntry {
  fdcId: number;
  description: string;
  figures: Map<UsdaNutrient, number | null>;
  portions: UsdaPortion[];
}

export const defaultCache = (): string => join(tmpdir(), "ai-home-gym-food-tables");

/** Downloaded once into `cache` and read. `sha256`, where a caller has one, is
 *  checked on EVERY read — a file already in the cache is bytes from a shared
 *  temp folder that nothing has vouched for since — and a download is checked
 *  BEFORE it reaches the cache, so a damaged one never sits there failing every
 *  later run. It is written under a temporary name and renamed once whole, so a
 *  run killed mid-write leaves no half file under the release's name either. */
export async function download(url: string, file: string, cache: string, sha256?: string): Promise<Buffer> {
  mkdirSync(cache, { recursive: true });
  const path = join(cache, file);
  if (existsSync(path)) {
    return checked(readFileSync(path), file, sha256, `at ${path}\nDelete it to download the release again.`);
  }
  console.log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) fail(`download failed (${String(response.status)}): ${url}`);
  const bytes = checked(Buffer.from(await response.arrayBuffer()), file, sha256, `downloaded from ${url}\nNothing was cached.`);
  const partial = `${path}.partial`;
  writeFileSync(partial, bytes);
  renameSync(partial, path);
  return bytes;
}

/** `bytes`, when they are the file `sha256` names or there is no digest to check. */
function checked(bytes: Buffer, file: string, sha256: string | undefined, where: string): Buffer {
  if (sha256 === undefined) return bytes;
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got === sha256) return bytes;
  return fail(
    `${file} is not the file this tool expects.\n` +
      `  expected sha256 ${sha256}\n  found    sha256 ${got}\n` +
      `  ${where}\n` +
      "If USDA has published a new release, a card adopts it on purpose.",
  );
}

/** The files of a zip archive whose names pass `wanted`, inflated. It reads the
 *  central directory; the archives here are far below ZIP64 sizes. */
export function unzip(archive: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
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

export function* csvRows(text: string): Generator<string[]> {
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

/** A number the release states, or null where the cell is empty or not a
 *  number. A figure the table lacks is null, never a zero (ROADMAP 7a-iii-a):
 *  "no measurement" and "measured as none" are different answers. */
const figure = (raw: string | undefined): number | null => {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/** FNDDS gives every food a "Quantity not specified" row, sometimes WITH a gram
 *  weight (fdc 2705504 carries 280 g), so it cannot be dropped by its weight —
 *  it is dropped by its name. It is a survey code for "the person did not say",
 *  never a household measure anyone can picture. */
const NOT_A_MEASURE = /^(quantity not specified|not specified)$/i;

/** A household measure is named in words. A name with no letter in it ("1", ",")
 *  names nothing a person could picture, and would read as nothing once its
 *  dangling punctuation goes. Neither release has one (counted 2026-09-16). */
const NAMES_SOMETHING = /\p{L}/u;

/** One release, by FDC id, with every figure of `USDA_NUTRIENTS` and every
 *  household measure that names a real amount. Both `food_nutrient.csv` files
 *  key the nutrient in the same column; the release decides how it is numbered. */
export function usdaTable(archive: Buffer, release: UsdaRelease): Map<number, UsdaEntry> {
  const files = unzip(
    archive,
    (name) => name.endsWith("/food.csv") || name.endsWith("/food_nutrient.csv") || name.endsWith("/food_portion.csv"),
  );
  const text = (suffix: string): string => {
    for (const [name, data] of files) if (name.endsWith(suffix)) return data.toString("utf8");
    return fail(`no ${suffix} in the archive`);
  };
  return usdaTableFromCsv(
    { food: text("/food.csv"), nutrient: text("/food_nutrient.csv"), portion: text("/food_portion.csv") },
    release,
  );
}

/** The three CSVs of a release, already unzipped. Split out from `usdaTable` so
 *  the tests can feed it a few lines of each rather than a 40 MB archive. */
export interface UsdaCsv {
  food: string;
  nutrient: string;
  portion: string;
}

export function usdaTableFromCsv(csv: UsdaCsv, release: UsdaRelease): Map<number, UsdaEntry> {
  const byNumber = new Map<string, UsdaNutrient>(USDA_NUTRIENTS.map((n) => [release === "fndds" ? n.fndds : n.sr, n.key]));

  const table = new Map<number, UsdaEntry>();
  let header = true;
  for (const [id, , description] of csvRows(csv.food)) {
    if (header) {
      header = false;
      continue;
    }
    const fdcId = Number(id);
    if (!Number.isInteger(fdcId) || description === undefined || description.trim() === "") continue;
    table.set(fdcId, { fdcId, description: description.trim(), figures: new Map(), portions: [] });
  }

  header = true;
  for (const [, id, nutrient, amount] of csvRows(csv.nutrient)) {
    if (header) {
      header = false;
      continue;
    }
    const key = nutrient === undefined ? undefined : byNumber.get(nutrient);
    const entry = table.get(Number(id));
    const value = figure(amount);
    if (key !== undefined && entry !== undefined && value !== null) entry.figures.set(key, value);
  }

  header = true;
  for (const [, id, seq, amount, , description, modifier, gramWeight] of csvRows(csv.portion)) {
    if (header) {
      header = false;
      continue;
    }
    const entry = table.get(Number(id));
    const grams = figure(gramWeight);
    const seqNum = Number(seq);
    // SR Legacy writes the measure in `modifier` (its `measure_unit_id` is 9999
    // on every one of its 14,449 portions); the survey release writes it in
    // `portion_description` and puts a survey code in `modifier`.
    const unit = ((release === "fndds" ? description : modifier) ?? "").trim();
    if (entry === undefined || grams === null || grams <= 0 || !Number.isInteger(seqNum)) continue;
    if (!NAMES_SOMETHING.test(unit) || NOT_A_MEASURE.test(unit)) continue;
    entry.portions.push({ seqNum, amount: figure(amount), unit, gramWeight: grams });
  }
  // The survey release does not write its portions in `seq_num` order (fdc
  // 2705504's rows run 3, 4, 1, 2), and "the food's first measure" is the
  // release's own first, not the file's.
  for (const entry of table.values()) entry.portions.sort((a, b) => a.seqNum - b.seqNum);
  return table;
}

// ── the row a food becomes ───────────────────────────────────────────────────
// Pure, and here rather than in `import-usda.ts` so the tests can reach it
// without running that script's top-level import.

/** A measure's leading amount, where its text carries one ("1 cup", "1/2 cup"). */
const LEADING_AMOUNT = /^(\d*\.?\d+|\d+\/\d+)\s+(\S.*)$/;

/** A measure's name as the screen can hold it: at most forty characters, cut at
 *  a SPACE and never through a word. SR Legacy writes whole sentences into the
 *  column ("3 oz with bone, cooked (yield after bone and fat removed)"), and a
 *  blind cut at forty left 110 of the table's 129 longest names ending mid-word
 *  — "3 oz with bone, cooked (yield after bone" — and 19 ending in a space
 *  (counted 2026-09-16 on the loaded table). A dangling comma or bracket goes,
 *  from a short name as from a cut one, so what is left reads as words: SR
 *  Legacy's own "cup," (fdc 175258) is a cup. */
const MEASURE_NAME_MAX = 40;
const DANGLING = /[\s,;:([{-]+$/u;
const readable = (name: string): string => {
  const whole = name.trim().replace(DANGLING, "");
  if (whole.length <= MEASURE_NAME_MAX) return whole;
  const cut = whole.slice(0, MEASURE_NAME_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  // One word longer than the whole allowance has no space to cut at; it is cut
  // where it must be rather than left to overflow the screen.
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(DANGLING, "");
};

/** What one of this measure is called, by the same rule the packaged-product
 *  reader uses for a label's serving (`openfoodfacts.adapter.ts`): one of it is
 *  named by its own words ("cup"), a half is "half cup", and any other count
 *  keeps its number ("2 tbsp"). SR Legacy states the amount in its own column
 *  and the words in `modifier`; the survey release writes both together in
 *  `portion_description`, so the amount is read off the front of the text. */
export function usdaMeasureName(portion: UsdaPortion): string {
  const stated = portion.amount !== null && portion.amount > 0 ? portion.amount : null;
  const led = stated === null ? LEADING_AMOUNT.exec(portion.unit) : null;
  const fraction = led?.[1]?.split("/");
  const amount =
    stated ??
    (fraction === undefined
      ? 1
      : fraction.length === 2
        ? Number(fraction[0]) / Number(fraction[1])
        : Number(fraction[0]));
  const words = (led?.[2] ?? portion.unit).trim();
  if (words === "" || !Number.isFinite(amount) || amount <= 0) return readable(portion.unit);
  if (amount === 1) return readable(words);
  if (amount === 0.5) return readable(`half ${words}`);
  return readable(`${String(amount)} ${words}`);
}

/** A food's serving: its first household measure with a gram weight, else 100 g
 *  by the gram (ROADMAP 7a-iii-a). `portions` arrives in USDA's own `seq_num`
 *  order, which is what "first" means — not the order the file lists them in. */
export function usdaServing(portions: readonly UsdaPortion[]): { grams: number; unit: string } {
  const first = portions[0];
  return first === undefined ? { grams: 100, unit: "g" } : { grams: first.gramWeight, unit: usdaMeasureName(first) };
}

/** Both releases, downloaded (once) into `cache`, checked against their own
 *  digests and read. */
export async function loadUsdaTables(cache: string): Promise<Map<UsdaRelease, Map<number, UsdaEntry>>> {
  const loaded = new Map<UsdaRelease, Map<number, UsdaEntry>>();
  for (const release of USDA_RELEASE_ORDER) {
    const { url, file, sha256 } = USDA_RELEASES[release];
    loaded.set(release, usdaTable(await download(url, file, cache, sha256), release));
  }
  return loaded;
}
