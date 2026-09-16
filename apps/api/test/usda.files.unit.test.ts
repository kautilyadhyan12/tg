// ROADMAP 7a-iii-a — the USDA release readers and the row a food becomes, on a
// few lines of CSV rather than the 40 MB archives. No network, no database.
import { describe, expect, it } from "vitest";
import {
  usdaMeasureName,
  usdaServing,
  usdaTableFromCsv,
  usdaWords,
  USDA_NUTRIENTS,
  type UsdaPortion,
} from "../tools/usda-files.js";
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
  ])("%o is called %s", (given, expected) => {
    expect(usdaMeasureName(given)).toBe(expected);
  });

  it("is the first measure with a gram weight, else 100 g by the gram", () => {
    expect(usdaServing([portion(1, "cup", 158), { seqNum: 2, amount: 1, unit: "oz", gramWeight: 28 }])).toEqual({ grams: 158, unit: "cup" });
    expect(usdaServing([])).toEqual({ grams: 100, unit: "g" });
  });

  it("a measure nobody could read is cut to 40 characters, never left to overflow the screen", () => {
    // SR Legacy's longest first measure is 74 characters (measured 2026-09-16).
    const long = usdaMeasureName(portion(1, "serving serving size varied from 1 to 3 enchiladas and a half"));
    expect(long.length).toBe(40);
    expect(long).toBe("serving serving size varied from 1 to 3 ");
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

  it("carries the description's first word, its word count and its serving", () => {
    const row = usdaFoodRow("fndds", entry("Milk, whole, 3.25% milkfat", "fndds"));
    expect(row?.first_word).toBe("milk");
    expect(row?.word_count).toBe(usdaWords("Milk, whole, 3.25% milkfat").length);
    expect(row?.description).toBe("Milk, whole, 3.25% milkfat");
    expect(row?.release).toBe("fndds");
    expect(row?.serving_grams).toBe(158);
    expect(row?.serving_unit).toBe("cup");
  });

  it("folds accents the way the food list folds a name", () => {
    expect(usdaWords("Crème fraîche, cultured")).toEqual(["creme", "fraiche", "cultured"]);
  });

  it("skips a description with no word in it, rather than storing a food nobody can find", () => {
    expect(usdaFoodRow("sr_legacy", { fdcId: 1, description: "- , -", figures: new Map(), portions: [] })).toBeNull();
  });
});
