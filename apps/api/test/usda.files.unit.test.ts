// ROADMAP 7a-iii-a — the USDA release readers and the row a food becomes, on a
// few lines of CSV rather than the 40 MB archives. No network, no database.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  download,
  usdaMeasureName,
  usdaServing,
  usdaTableFromCsv,
  USDA_NUTRIENTS,
  type UsdaPortion,
} from "../tools/usda-files.js";
import { databaseUrlFrom } from "../tools/import-usda-args.js";
import { usdaSearchText, usdaWords } from "../src/modules/nutrition/usdaWords.js";
import { usdaFoodRow } from "../tools/usda-table.js";

const FOOD_HEADER = `"fdc_id","data_type","description","food_category_id","publication_date"`;
const NUTRIENT_HEADER = `"id","fdc_id","nutrient_id","amount","data_points","derivation_id","min","max","median","footnote","min_year_acquired"`;
const PORTION_HEADER = `"id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight","data_points","footnote","min_year_acquired"`;

const csv = (food: string[], nutrient: string[], portion: string[]) => ({
  food: [FOOD_HEADER, ...food].join("\n"),
  nutrient: [NUTRIENT_HEADER, ...nutrient].join("\n"),
  portion: [PORTION_HEADER, ...portion].join("\n"),
});

/** One line of each release's `food_nutrient.csv`, giving every one of the
 *  seventeen figures a DIFFERENT value, so a nutrient wired to the wrong column
 *  cannot pass: energy is 1, protein 2, and so on down the list. */
const everyNutrientLine = (fdcId: number, release: "sr_legacy" | "fndds"): string[] =>
  USDA_NUTRIENTS.map(
    (n, at) => `"${String(9000 + at)}","${String(fdcId)}","${release === "fndds" ? n.fndds : n.sr}","${String(at + 1)}","","","","","","",""`,
  );

describe("reading a release's CSVs", () => {
  it("SR Legacy numbers its nutrients by FDC id, the survey release by nutrient number", () => {
    const sr = usdaTableFromCsv(
      csv(
        [`"167512","sr_legacy_food","Biscuits, refrigerated dough","18","2019-04-01"`],
        // 1008 is energy in SR Legacy; 208 is energy in the survey release and
        // means nothing here, so reading it would be reading another release's
        // numbering into this one.
        [`"1","167512","1008","280","","","","","","",""`, `"2","167512","208","999","","","","","","",""`],
        [],
      ),
      "sr_legacy",
    );
    expect(sr.get(167512)?.figures.get("kcal")).toBe(280);

    const fndds = usdaTableFromCsv(
      csv(
        [`"2705384","survey_fndds_food","Milk, NFS","1004","2022-10-28"`],
        [`"1","2705384","208","61","","","","","","",""`, `"2","2705384","1008","999","","","","","","",""`],
        [],
      ),
      "fndds",
    );
    expect(fndds.get(2705384)?.figures.get("kcal")).toBe(61);
  });

  it("a figure the release does not measure is null, and a measured zero is zero", () => {
    const table = usdaTableFromCsv(
      csv(
        [`"167512","sr_legacy_food","Test food","18","2019-04-01"`],
        [
          `"1","167512","1008","280","","","","","","",""`,
          `"2","167512","1079","0","","","","","","",""`, // fibre measured as none
          `"3","167512","2000","","","","","","","",""`, // sugars: an empty cell
          `"4","167512","1258","not a number","","","","","","",""`,
        ],
        [],
      ),
      "sr_legacy",
    );
    const figures = table.get(167512)?.figures;
    expect(figures?.get("fiberG")).toBe(0);
    expect(figures?.get("sugarsG") ?? null).toBeNull();
    expect(figures?.get("satFatG") ?? null).toBeNull();
    // vitamin D was never in the file at all
    expect(figures?.get("vitaminDUg") ?? null).toBeNull();
  });

  it("SR Legacy's measure is its `modifier`, the survey release's its `portion_description`", () => {
    const sr = usdaTableFromCsv(
      csv(
        [`"167512","sr_legacy_food","Test food","18","2019-04-01"`],
        [],
        [`"81549","167512","1","1","9999","","serving","34","","",""`],
      ),
      "sr_legacy",
    );
    expect(sr.get(167512)?.portions).toEqual([{ seqNum: 1, amount: 1, unit: "serving", gramWeight: 34 }]);

    // The survey release leaves `amount` empty and puts a survey CODE in
    // `modifier` — reading that column here would store "10205" as the measure.
    const fndds = usdaTableFromCsv(
      csv(
        [`"2705383","survey_fndds_food","Test food","9602","2022-10-28"`],
        [],
        [`"290506","2705383","1","","9999","1 cup","10205","246.0","","",""`],
      ),
      "fndds",
    );
    expect(fndds.get(2705383)?.portions).toEqual([{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 246 }]);
  });

  it("portions come back in the release's own seq_num order, not the file's", () => {
    // Measured 2026-09-16: the survey release writes fdc 2705504's rows 3, 4, 1, 2.
    const table = usdaTableFromCsv(
      csv(
        [`"2705504","survey_fndds_food","Milkshake","1004","2022-10-28"`],
        [],
        [
          `"291006","2705504","3","","9999","1 cup","10205","224.0","","",""`,
          `"291004","2705504","1","","9999","1 fl oz","30000","28.0","","",""`,
          `"291005","2705504","2","","9999","1 milkshake (10 fl oz)","61459","280.0","","",""`,
        ],
      ),
      "fndds",
    );
    expect(table.get(2705504)?.portions.map((p) => p.seqNum)).toEqual([1, 2, 3]);
    expect(usdaServing(table.get(2705504)?.portions ?? [])).toEqual({ grams: 28, unit: "fl oz" });
  });

  it('"Quantity not specified" is dropped even when it carries a gram weight', () => {
    // fdc 2705504's row carries 280 g, so dropping by weight alone would keep it
    // and a food's serving would read "Quantity not specified".
    const table = usdaTableFromCsv(
      csv(
        [`"2705504","survey_fndds_food","Milkshake","1004","2022-10-28"`],
        [],
        [
          `"291007","2705504","1","","9999","Quantity not specified","90000","280.0","","",""`,
          `"291009","2705504","2","","9999","1 cup","10205","224.0","","",""`,
          `"291010","2705504","3","","9999","","90000","100.0","","",""`,
          `"291011","2705504","4","","9999","1 glass","90000","0.0","","",""`,
        ],
      ),
      "fndds",
    );
    expect(table.get(2705504)?.portions).toEqual([{ seqNum: 2, amount: null, unit: "1 cup", gramWeight: 224 }]);
  });

  it("a measure whose name holds no letter is dropped, since it would read as nothing", () => {
    const table = usdaTableFromCsv(
      csv(
        [`"167512","sr_legacy_food","Test food","18","2019-04-01"`],
        [],
        [
          `"1","167512","1","1","9999","",",","30","","",""`,
          `"2","167512","2","1","9999","","12","40","","",""`,
          `"3","167512","3","1","9999","","cup,","144","","",""`,
        ],
      ),
      "sr_legacy",
    );
    expect(table.get(167512)?.portions).toEqual([{ seqNum: 3, amount: 1, unit: "cup,", gramWeight: 144 }]);
  });
});

describe("a food's serving", () => {
  const portion = (amount: number | null, unit: string, gramWeight = 50): UsdaPortion => ({ seqNum: 1, amount, unit, gramWeight });

  it.each([
    // SR Legacy states the amount in its own column.
    [portion(1, "serving"), "serving"],
    [portion(2, "enchilada"), "2 enchilada"],
    [portion(0.5, "cup"), "half cup"],
    [portion(0.25, "cake"), "0.25 cake"],
    // The survey release writes the amount into the text.
    [portion(null, "1 cup"), "cup"],
    [portion(null, "2 tbsp"), "2 tbsp"],
    [portion(null, "1 fl oz (no ice)"), "fl oz (no ice)"],
    [portion(null, "1/2 cup"), "half cup"],
    [portion(null, ".5 cup"), "half cup"],
    // Nothing to read an amount from: the text is the measure.
    [portion(null, "cup"), "cup"],
    [portion(0, "oz"), "oz"],
    // A short name loses its dangling comma as a cut one does: SR Legacy's own
    // "cup," (fdc 175258), and the same in the survey release's shape.
    [portion(1, "cup,"), "cup"],
    [portion(null, "1 cup,"), "cup"],
    [portion(2, "slices (, "), "2 slices"],
  ])("%o is called %s", (given, expected) => {
    expect(usdaMeasureName(given)).toBe(expected);
  });

  it("is the first measure with a gram weight, else 100 g by the gram", () => {
    expect(usdaServing([portion(1, "cup", 158), { seqNum: 2, amount: 1, unit: "oz", gramWeight: 28 }])).toEqual({ grams: 158, unit: "cup" });
    expect(usdaServing([])).toEqual({ grams: 100, unit: "g" });
  });

  it("a measure nobody could read is cut at a space, never through a word", () => {
    // SR Legacy's longest first measure is 74 characters (measured 2026-09-16),
    // and a blind cut at forty left 110 of the table's 129 longest names ending
    // mid-word and 19 ending in a space.
    const long = usdaMeasureName(portion(1, "serving serving size varied from 1 to 3 enchiladas and a half"));
    expect(long).toBe("serving serving size varied from 1 to 3");
    expect(long.length).toBeLessThanOrEqual(40);

    // Two of the table's own longest names, cut where the words end.
    expect(usdaMeasureName(portion(1, "3 oz with bone, cooked (yield after bone and fat removed)"))).toBe("3 oz with bone, cooked (yield after");
    expect(usdaMeasureName(portion(1, "serving (1 NLEA serving - about 4 crackers)"))).toBe("serving (1 NLEA serving - about 4");
    // A dangling comma or dash goes with the cut.
    expect(usdaMeasureName(portion(1, "slice of a very large loaf indeed, sliced thinly"))).toBe("slice of a very large loaf indeed");

    // Nothing short is touched, and nothing keeps a trailing space.
    expect(usdaMeasureName(portion(1, "cup"))).toBe("cup");
    expect(usdaMeasureName(portion(1, "piece, 4 by 3 by 1 inch"))).toBe("piece, 4 by 3 by 1 inch");

    // One word longer than the whole allowance has no space to cut at: it is cut
    // where it must be rather than left to overflow the screen.
    const unbroken = usdaMeasureName(portion(1, "a".repeat(60)));
    expect(unbroken).toBe("a".repeat(40));
  });
});

describe("the row a food becomes", () => {
  const entry = (description: string, release: "sr_legacy" | "fndds" = "sr_legacy") => {
    const table = usdaTableFromCsv(
      csv(
        [`"167512","sr_legacy_food","${description}","18","2019-04-01"`],
        everyNutrientLine(167512, release),
        // The measure goes in the column its own release writes it in.
        [
          release === "fndds"
            ? `"1","167512","1","","9999","1 cup","10205","158","","",""`
            : `"1","167512","1","1","9999","","cup","158","","",""`,
        ],
      ),
      release,
    );
    const found = table.get(167512);
    if (found === undefined) throw new Error("fixture food missing");
    return found;
  };

  it("puts every one of the seventeen nutrients in its own column", () => {
    const row = usdaFoodRow("sr_legacy", entry("Test food"));
    // Each figure was given a different value in the fixture, so two columns
    // wired to one nutrient — or a swapped pair — cannot pass this.
    expect(USDA_NUTRIENTS.map((n) => row?.[n.column])).toEqual(USDA_NUTRIENTS.map((_, at) => at + 1));
  });

  it("carries the description's first word, its word count, its search text and its serving", () => {
    const row = usdaFoodRow("fndds", entry("Milk, whole, 3.25% milkfat", "fndds"));
    expect(row?.first_word).toBe("milk");
    // Four words — milk, whole, 3.25, milkfat — counted out rather than asked of
    // the same function that stored it.
    expect(row?.word_count).toBe(4);
    expect(row?.description).toBe("Milk, whole, 3.25% milkfat");
    expect(row?.search_text).toBe("milk, whole, 3.25% milkfat");
    expect(row?.release).toBe("fndds");
    expect(row?.serving_grams).toBe(158);
    expect(row?.serving_unit).toBe("cup");
  });

  it("stores an accented name as USDA spells it, and its search text and first word folded", () => {
    const row = usdaFoodRow("sr_legacy", entry("Jalapeño peppers, RAW"));
    // The screen shows USDA's own spelling; the index and the ranking read the fold.
    expect(row?.description).toBe("Jalapeño peppers, RAW");
    expect(row?.search_text).toBe("jalapeno peppers, raw");
    expect(row?.first_word).toBe("jalapeno");
    expect(row?.word_count).toBe(3);
  });

  it("cuts a description into words with its accents folded, and a decimal kept inside its number", () => {
    // Folded on BOTH sides of the search: the importer stores these, and the
    // search box reads a typed query with the same function.
    expect(usdaWords("Crème fraîche, cultured")).toEqual(["creme", "fraiche", "cultured"]);
    expect(usdaSearchText("Crème Fraîche, cultured")).toBe("creme fraiche, cultured");
    // An accent typed as a mark of its own (as some keyboards send it) is folded
    // before the words are cut, so it never splits its word in two.
    expect(usdaWords("crème fraîche")).toEqual(["creme", "fraiche"]);
    // A full-width letter is its letter, and a full-width sign still separates.
    expect(usdaWords("ｍｉｌｋ％ｆａｔ＆ｃｏ")).toEqual(["milk", "fat", "co"]);
    // And it indexes "3.25%" as one lexeme, 3.25 — not 3 and 25.
    expect(usdaWords("Milk, whole, 3.25% milkfat")).toEqual(["milk", "whole", "3.25", "milkfat"]);
    expect(usdaWords("Beverage, 100%, NFS")).toEqual(["beverage", "100", "nfs"]);
    // Anything that is not a letter or a digit separates, which is what keeps a
    // typed query from ever becoming a tsquery operator.
    expect(usdaWords("zqx & fix | ture:* !(no)")).toEqual(["zqx", "fix", "ture", "no"]);
    expect(usdaWords("   ")).toEqual([]);
  });

  it("reads the shapes `check-food-sources.ts` depends on: numeric ids, trimmed names, an empty amount as null", () => {
    // That checker is not run in CI (it needs the network), so the reader it
    // shares with the importer is pinned here instead.
    const table = usdaTableFromCsv(
      csv(
        [`"171287","sr_legacy_food","  Egg, whole, raw, fresh  ","100","2019-04-01"`],
        [`"1","171287","1008","143","","","","","","",""`],
        [`"81549","171287","1","","9999","","large","50","","",""`],
      ),
      "sr_legacy",
    );
    expect([...table.keys()]).toEqual([171_287]);
    expect(table.get(171_287)).toEqual({
      fdcId: 171_287,
      description: "Egg, whole, raw, fresh",
      figures: new Map([["kcal", 143]]),
      // An empty `amount` is NULL, not the 0 that `Number("")` would make of it:
      // the measure's own text carries the count instead.
      portions: [{ seqNum: 1, amount: null, unit: "large", gramWeight: 50 }],
    });
  });

  it("skips a description with no word in it, rather than storing a food nobody can find", () => {
    expect(usdaFoodRow("sr_legacy", { fdcId: 1, description: "- , -", figures: new Map(), portions: [] })).toBeNull();
  });
});

describe("the cached release files", () => {
  const cache = mkdtempSync(join(tmpdir(), "usda-cache-test-"));
  afterAll(() => {
    rmSync(cache, { recursive: true, force: true });
  });

  // The digest of "the real release", which is what these two calls agree on.
  const REAL = "b1b58a80a7f2b42cb5e8abefe89c5ba85e6dd5577cd6b78df7a5f18b5e21a7ea";

  it("reads a cached file only when its bytes are the ones the tool expects", async () => {
    writeFileSync(join(cache, "release.zip"), "the real release");
    // Nothing is downloaded: the file is already there, and it is checked anyway
    // — the cache is a folder in the machine's shared temp directory.
    const bytes = await download("https://example.invalid/never-fetched.zip", "release.zip", cache, REAL);
    expect(bytes.toString("utf8")).toBe("the real release");
  });

  it("stops the run when a cached file is not the release, rather than importing it", async () => {
    writeFileSync(join(cache, "release.zip"), "something else entirely");
    await expect(download("https://example.invalid/never-fetched.zip", "release.zip", cache, REAL)).rejects.toThrow(
      /release\.zip is not the file this tool expects/,
    );
  });

  it("takes no digest as no check, for a file that has none published", async () => {
    writeFileSync(join(cache, "other.xlsx"), "whatever this is");
    const bytes = await download("https://example.invalid/never-fetched.xlsx", "other.xlsx", cache);
    expect(bytes.toString("utf8")).toBe("whatever this is");
  });

  describe("a download", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });
    const serving = (body: string) => {
      const fetched = vi.fn(() => Promise.resolve(new Response(body, { status: 200 })));
      vi.stubGlobal("fetch", fetched);
      vi.spyOn(console, "log").mockImplementation(() => undefined);
      return fetched;
    };

    it("that is not the release is never written to the cache, so the next run downloads again", async () => {
      serving("a damaged download");
      await expect(download("https://example.invalid/release.zip", "damaged.zip", cache, REAL)).rejects.toThrow(
        /damaged\.zip is not the file this tool expects[\s\S]*Nothing was cached/,
      );
      // Neither the release's name nor a half-written file is left behind.
      expect(existsSync(join(cache, "damaged.zip"))).toBe(false);
      expect(readdirSync(cache).filter((name) => name.startsWith("damaged"))).toEqual([]);
    });

    it("that is the release is cached whole, and read from the cache after", async () => {
      const fetched = serving("the real release");
      expect((await download("https://example.invalid/release.zip", "fresh.zip", cache, REAL)).toString("utf8")).toBe("the real release");
      expect(readFileSync(join(cache, "fresh.zip"), "utf8")).toBe("the real release");
      expect(readdirSync(cache).filter((name) => name.startsWith("fresh"))).toEqual(["fresh.zip"]);
      await download("https://example.invalid/release.zip", "fresh.zip", cache, REAL);
      expect(fetched).toHaveBeenCalledTimes(1);
    });
  });
});

describe("the database `import-usda.ts` is pointed at", () => {
  const EMPTY: Record<string, string | undefined> = {};

  it("takes the address typed out", () => {
    expect(databaseUrlFrom(["node", "tool", "--database-url=postgres://a:b@host:5432/db"], EMPTY)).toEqual({
      url: "postgres://a:b@host:5432/db",
    });
  });

  it("takes the address out of the variable the command NAMES", () => {
    expect(databaseUrlFrom(["node", "tool", "--database-url-env=PROD_DATABASE_URL"], { PROD_DATABASE_URL: "postgres://named" })).toEqual({
      url: "postgres://named",
    });
  });

  it("never reads DATABASE_URL on its own — on this machine it is the real data", () => {
    expect(databaseUrlFrom(["node", "tool"], { DATABASE_URL: "postgres://the-real-neon-data" })).toEqual({ problem: "none-given" });
    expect(databaseUrlFrom(["node", "tool", "--cache=/tmp/x"], { DATABASE_URL: "postgres://the-real-neon-data" })).toEqual({
      problem: "none-given",
    });
  });

  it("stops when the variable it was told to read is empty or unset, rather than filling something else", () => {
    expect(databaseUrlFrom(["node", "tool", "--database-url-env=PROD_DATABASE_URL"], EMPTY)).toEqual({
      problem: "empty-variable",
      variable: "PROD_DATABASE_URL",
    });
    expect(
      databaseUrlFrom(["node", "tool", "--database-url-env=PROD_DATABASE_URL", "--database-url=postgres://typed"], { PROD_DATABASE_URL: "" }),
    ).toEqual({ problem: "empty-variable", variable: "PROD_DATABASE_URL" });
    expect(databaseUrlFrom(["node", "tool", "--database-url="], EMPTY)).toEqual({ problem: "none-given" });
  });
});
