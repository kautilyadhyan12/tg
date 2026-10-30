// ROADMAP Stage 5 33b-iii-a — the rows of the packaged-food lists, read from real rows of the real
// files (`test/fixtures/packaged`, cut from the downloads of 2026-10-30, contributors' names blanked).
import { createReadStream, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MORE_NOT_KNOWN, type MoreNutrients } from "@app/shared";
import { allergenWords, numbersFit, packagedFoodOf, usdaServing, type OffRow, type PackagedRow, type RowResult } from "../src/modules/nutrition/packagedRows.js";
import { judgeDailyFile, linesOf, PackagedFileRefused, readDailyFile } from "../src/modules/nutrition/packagedSync.js";
import { offRowsOfFile, usdaRowsOfDir } from "../tools/packaged-files.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "packaged");

async function all(rows: AsyncIterable<RowResult>): Promise<RowResult[]> {
  const out: RowResult[] = [];
  for await (const row of rows) out.push(row);
  return out;
}
const kept = (rows: readonly RowResult[]): Map<string, OffRow> => new Map(rows.flatMap((r) => ("row" in r ? [[r.row.code, r.row] as const] : [])));

const off = await all(offRowsOfFile(join(FIXTURES, "off-products.tsv")));
const offKept = kept(off);
const row = (code: string): OffRow => {
  const found = offKept.get(code);
  if (found === undefined) throw new Error(`${code} was not kept`);
  return found;
};

describe("the worst thing: a person told a pack is clear, or shown another product's numbers", () => {
  it("never writes a store's own code, a misread one or a product with no calories into the list", () => {
    for (const code of ["00000758", "00001816", "00002523", "20000165", "0200024010652", "12345678", "8901719255168", "8901058005578"]) {
      expect(offKept.has(code), code).toBe(false);
    }
  });

  it("keeps each product's own numbers and allergens, as the real file gives them", () => {
    expect(row("3017620422003")).toMatchObject({ name: "Nutella", kcal: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9, allergens: ["milk", "nuts", "soybeans"], traces: [] });
    expect(row("7622210449283")).toMatchObject({ allergens: ["eggs", "gluten", "milk", "soybeans"], traces: ["eggs"], servingSize: "20g" });
    expect(row("8901262010016")).toMatchObject({ name: "Amul Pasteurized Butter", allergens: ["milk"] });
    expect(row("8901058005851").traces).toEqual(["gluten", "milk", "soybeans"]);
  });

  it("an empty list is carried as empty, with nothing added: it says nothing about the food", () => {
    // Takis' ingredients name soy and milk, and its list is empty: 5.7% of such US products are.
    expect(row("8412600017975")).toMatchObject({ allergens: [], traces: [] });
    const food = packagedFoodOf(row("8412600017975"), null);
    expect(food?.allergens).toEqual([]);
    expect(food?.mayContain).toEqual([]);
  });

  it("a real barcode's reply is that product's and no other's, whichever list holds it", () => {
    const a = packagedFoodOf(row("3017620422003"), null);
    const b = packagedFoodOf(row("7622210449283"), null);
    expect(a?.food).toMatchObject({ canonical: "pack_3017620422003", kcal: 539 });
    expect(b?.food).toMatchObject({ canonical: "pack_7622210449283", kcal: 467 });
  });
});

describe("what the real file holds", () => {
  it("reads every row whole: a line separator inside a row does not cut it in two", () => {
    // 27 products; Node's readline would make one of them two, and the second half is no product.
    expect(off).toHaveLength(27);
    const text = readFileSync(join(FIXTURES, "off-products.tsv"), "utf8");
    expect(text.includes(String.fromCharCode(0x2028))).toBe(true);
  });

  it.each([
    ["00000758", "store_only", "a Sainsbury's cauliflower"],
    ["00001816", "store_only", "a Trader Joe's bread"],
    ["20000165", "store_only", "a Lidl brand's prunes"],
    ["0200024010652", "store_only", "a store's own nougat"],
    ["12345678", "bad_code", "the junk product 'Ror'"],
    ["8901719255168", "no_calories", "Parle-G: on the list with no numbers"],
    ["8901058005578", "no_name", "a Maggi with no name"],
    ["0010300337256", "out_of_bounds", "cashews at 2,389 kcal: kilojoules typed as calories"],
    ["0000111301201", "out_of_bounds", "a spread at 4,590 kcal"],
  ])("%s is not kept: %s, %s", (code) => {
    expect(offKept.has(code)).toBe(false);
  });

  it("counts why, by the reason the row was refused", () => {
    const refusals = off.flatMap((r) => ("refused" in r ? [r.refused] : []));
    expect(refusals.filter((r) => r === "store_only")).toHaveLength(5);
    expect(refusals.filter((r) => r === "bad_code")).toHaveLength(1);
    expect(refusals).toContain("no_calories");
    expect(refusals).toContain("no_name");
    expect(refusals.filter((r) => r === "out_of_bounds")).toHaveLength(2);
  });

  it("a stated 0 is a real figure: Coca-Cola Zero, Dasani, Tata Salt and Bisleri are kept", () => {
    for (const code of ["0049000040869", "0049000026566", "8904043901015", "8906017290040"]) expect(row(code).kcal, code).toBe(0);
    expect(packagedFoodOf(row("0049000040869"), null)?.check).toBe("fine");
  });

  it("calories far from what the protein, carbs and fat come to read as not adding up", () => {
    // Smoked trout "707 kcal": its kilojoules typed as calories, and its macros come to 168.
    expect(row("0002000012151").numbersFit).toBe(false);
    expect(packagedFoodOf(row("0002000012151"), null)?.check).toBe("doesnt_add_up");
    expect(row("3017620422003").numbersFit).toBe(true);
  });
});

describe("numbersFit, a table over every class", () => {
  it.each([
    ["Nutella's label", 539, 6.3, 57.5, 30.9, 0, true],
    ["a beer: its calories are from its alcohol", 43, 0.4, 3.5, 0, 4, true],
    ["a beer with no alcohol figure: told to check the pack, which does no harm", 43, 0.4, 3.5, 0, null, false],
    ["kilojoules typed as calories", 707, 23, 0.6, 8.2, null, false],
    ["macros all zero with real calories", 300, 0, 0, 0, null, false],
    ["0 kcal with real macros", 0, 20, 0, 0, null, false],
    ["0 kcal, 0 macros: water", 0, 0, 0, 0, null, true],
    ["a figure missing: said apart, not here", 300, null, 40, 10, null, true],
    ["within the slack on a small food", 12, 0, 0, 0, null, true],
    ["just inside the share", 100, 0, 18, 0, null, true],
    ["just outside the share", 100, 0, 17, 0, null, false],
  ])("%s", (_name, kcal, protein, carbs, fat, alcohol, fits) => {
    expect(numbersFit(kcal, protein, carbs, fat, alcohol)).toBe(fits);
  });
});

describe("allergenWords, from outside the code", () => {
  it.each<[string, string[], string[]]>([
    ["the download's words", ["milk", "nuts", "soybeans"], ["milk", "nuts", "soybeans"]],
    ["the daily file's tags", ["en:milk", "en:soybeans"], ["milk", "soybeans"]],
    ["a tag in another language, kept and never dropped", ["fr:arachide", "de:sellerie"], ["arachide", "sellerie"]],
    ["a word no list has heard of", ["en:lupin-flour"], ["lupin flour"]],
    ["none is no allergen", ["en:none"], []],
    ["the same twice", ["en:milk", "milk"], ["milk"]],
    ["empty pieces of a split", ["", " "], []],
    ["characters that would break the database's array", ['mi"lk', "wh\\ey", "soy{a}"], ["milk", "whey", "soya"]],
  ])("%s", (_name, tags, words) => {
    expect(allergenWords(tags)).toEqual(words);
  });
});

const plain = (over: Partial<PackagedRow>): PackagedRow => ({ code: "3017620422003", name: "A", kcal: 500, proteinG: 10, carbsG: 50, fatG: 30, more: MORE_NOT_KNOWN, servingSize: null, quantity: null, numbersFit: true, ...over });
const withLists = (over: Partial<OffRow>): OffRow => ({ ...plain(over), allergens: over.allergens ?? ["milk"], traces: over.traces ?? ["nuts"] });

describe("packagedFoodOf: which list's numbers a person sees, every class", () => {
  it.each<[string, Partial<OffRow> | null, Partial<PackagedRow> | null, "openfoodfacts" | "usda", number, string, boolean]>([
    ["only Open Food Facts", {}, null, "openfoodfacts", 500, "fine", true],
    ["only USDA: it has no allergens to give", null, {}, "usda", 500, "fine", false],
    ["both agree: Open Food Facts', with its allergens", { kcal: 500 }, { kcal: 520 }, "openfoodfacts", 500, "fine", true],
    ["exactly a fifth apart still agree", { kcal: 400 }, { kcal: 500 }, "openfoodfacts", 400, "fine", true],
    ["both agree, Open Food Facts' does not add up: USDA's", { kcal: 500, numbersFit: false }, { kcal: 520 }, "usda", 520, "fine", true],
    ["both agree, neither adds up: said", { kcal: 500, numbersFit: false }, { kcal: 520, numbersFit: false }, "openfoodfacts", 500, "doesnt_add_up", true],
    ["apart: the maker's label via USDA, and said", { kcal: 900 }, { kcal: 300 }, "usda", 300, "lists_differ", true],
    ["apart, one at zero", { kcal: 0 }, { kcal: 120 }, "usda", 120, "lists_differ", true],
    ["both zero: no difference", { kcal: 0 }, { kcal: 0 }, "openfoodfacts", 0, "fine", true],
    ["a macro missing: said", { proteinG: null }, null, "openfoodfacts", 500, "part_missing", true],
    ["a macro missing at 0 kcal: water needs none", { kcal: 0, proteinG: null, carbsG: null, fatG: null }, null, "openfoodfacts", 0, "fine", true],
  ])("%s", (_name, offOver, usdaOver, source, kcal, check, hasAllergens) => {
    const got = packagedFoodOf(offOver === null ? null : withLists(offOver), usdaOver === null ? null : plain(usdaOver));
    expect(got?.food.source).toBe(source);
    expect(got?.food.kcal).toBe(kcal);
    expect(got?.check).toBe(check);
    expect(got?.allergens).toEqual(hasAllergens ? ["milk"] : []);
  });

  it("neither list: nothing, never a guess", () => {
    expect(packagedFoodOf(null, null)).toBeNull();
  });

  it("a missing macro is 0 in the price and said to be missing, never silently a zero", () => {
    const got = packagedFoodOf(withLists({ proteinG: null }), null);
    expect(got?.food.proteinG).toBe(0);
    expect(got?.check).toBe("part_missing");
  });
});

describe("the daily file, real lines", () => {
  const fromFixture = async () => await readDailyFile(linesOf(createReadStream(join(FIXTURES, "off-daily.jsonl")) as AsyncIterable<Buffer>));

  it("reads a product's numbers from the set their file now keeps them in", async () => {
    const read = await fromFixture();
    const byCode = new Map(read.rows.map((r) => [r.code, r]));
    expect(byCode.get("8718452980437")).toMatchObject({ kcal: 113, proteinG: 17, carbsG: 3.6, fatG: 3.3 });
    expect(byCode.get("3254550039639")?.allergens).toEqual(["milk"]);
    expect(byCode.get("8904335607090")?.kcal).toBeCloseTo(420.4, 1);
  });

  it("never reads their estimates as a label: a product with only estimates is taken off the list", async () => {
    const read = await fromFixture();
    expect(read.removeCodes).toContain("0194346516261");
    expect(read.rows.map((r) => r.code)).not.toContain("0194346516261");
    // A figure marked estimate never reaches a row, while the label's beside it do.
    const raw = readFileSync(join(FIXTURES, "off-daily.jsonl"), "utf8").trim().split(String.fromCharCode(10));
    const camembert = raw.map((l) => JSON.parse(l) as { code: string; nutrition?: { aggregated_set?: { nutrients?: Record<string, { source?: string }> } } }).find((p) => p.code === "3254550039639");
    expect(camembert?.nutrition?.aggregated_set?.nutrients?.["iron"]?.source).toBe("estimate");
    const more: MoreNutrients | undefined = read.rows.find((r) => r.code === "3254550039639")?.more;
    expect(more?.ironMg).toBeNull();
  });

  it("a product with no numbers now is taken off, a store's own code is ignored", async () => {
    const read = await fromFixture();
    expect(read.removeCodes).toContain("9556663189008");
    expect(read.removeCodes).not.toContain("23579477");
  });

  it("refuses a whole file that cannot be what they mean to send, and judges a small one as it is", () => {
    const file = (products: number, rows: number, bad = 0) => ({ products, bad, rows: Array.from({ length: rows }, () => withLists({})) });
    expect(() => { judgeDailyFile(file(6010, 4500)); }).not.toThrow();
    expect(() => { judgeDailyFile(file(6010, 100)); }).toThrow(PackagedFileRefused);
    expect(() => { judgeDailyFile(file(6010, 4500, 100)); }).toThrow(PackagedFileRefused);
    expect(() => { judgeDailyFile(file(50, 0)); }).not.toThrow();
  });
});

describe("USDA's list, real rows", () => {
  it("takes each code's newest row, and keeps its own numbers", async () => {
    const rows = kept(await all(usdaRowsOfDir(FIXTURES)));
    const swanson = rows.get("0051000198808");
    if (swanson === undefined) throw new Error("Swanson was not kept");
    // Its newest row's name, not its oldest ("SWANSON BROTH BEEF").
    expect(swanson.name.startsWith("Swanson 100% Natural Beef Broth")).toBe(true);
    expect(swanson.servingSize).toBe("1 CUP (240 mL)");
    expect(rows.get("0027000612323")?.servingSize).toBe("1 Tbsp (15 ml)");
    expect([...rows.values()].every((r) => r.allergens.length === 0)).toBe(true);
  });

  it.each([
    ["240.0", "ml", "Amount per serving", "240 ml"],
    ["15.0", "ml", "1 Tbsp (15 ml)", "1 Tbsp (15 ml)"],
    ["30.0", "g", "1 CUP (30 g)", "1 CUP (30 g)"],
    ["1.0", "oz", "1 serving", null],
    ["", "", "", null],
  ])("a serving of %s %s, %s, reads %s", (size, unit, household, read) => {
    expect(usdaServing(size, unit, household)).toBe(read);
  });
});
