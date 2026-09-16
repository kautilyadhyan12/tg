// ROADMAP 7a-iii-a — the USDA table against a real Postgres: the importer's
// upsert (run twice), the search box's rule, and resolving a canonical.
//
// Every row here is a FIXTURE, keyed above 90,000,000 so it can never collide
// with a real FDC id (SR Legacy runs to about 175,000 and the survey release to
// about 2,800,000), and every description carries the nonsense word
// "zqxfixture", so these tests find their own rows and nothing else whether or
// not the machine has had `tools/import-usda.ts` run against it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  searchUsdaFoods,
  usdaCanonical,
  usdaFoodByCanonical,
  usdaFoodForScan,
  usdaSearchWords,
  usdaTsQuery,
} from "../src/modules/nutrition/repo.js";
import { energySeen } from "../src/modules/nutrition/scanMatch.js";
import { importUsda } from "../tools/usda-table.js";
import { USDA_NUTRIENTS, type UsdaEntry, type UsdaNutrient, type UsdaPortion, type UsdaRelease } from "../tools/usda-files.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const FIRST_ID = 90_000_001;
const LAST_ID = 90_000_099;

/** Every figure filled, each with its own value, so a column read back from the
 *  wrong one cannot pass — except the ones a fixture says are `unmeasured`,
 *  which are the release's own "not measured" and must stay null. */
const figures = (kcal: number | null, unmeasured: readonly UsdaNutrient[] = []): Map<UsdaNutrient, number | null> => {
  const map = new Map<UsdaNutrient, number | null>();
  for (const [at, n] of USDA_NUTRIENTS.entries()) {
    map.set(n.key, unmeasured.includes(n.key) ? null : n.key === "kcal" ? kcal : at + 1);
  }
  return map;
};

const entry = (
  fdcId: number,
  description: string,
  kcal: number | null = 100,
  portions: UsdaPortion[] = [],
  unmeasured: readonly UsdaNutrient[] = [],
): UsdaEntry => ({
  fdcId,
  description,
  figures: figures(kcal, unmeasured),
  portions,
});

d("the USDA food table (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM usda_food_portions WHERE fdc_id BETWEEN ${FIRST_ID} AND ${LAST_ID}`;
    await sql`DELETE FROM usda_foods WHERE fdc_id BETWEEN ${FIRST_ID} AND ${LAST_ID}`;
  };

  /** The fixture foods the search rule is read off. The fifth member is the
   *  nutrients the release never measured for that food. */
  const CATALOG: readonly (readonly [number, UsdaRelease, string, number | null, (readonly UsdaNutrient[])?])[] = [
    [90_000_001, "fndds", "Zqxfixture, cappuccino", 27],
    [90_000_002, "sr_legacy", "Zqxfixture, cappuccino", 31],
    [90_000_003, "fndds", "Zqxfixture, cappuccino, decaffeinated, nonfat", 19],
    [90_000_004, "fndds", "Zqxfixture, tea", 2],
    // No energy figure: it cannot be priced into a meal, so it is never offered.
    [90_000_005, "fndds", "Zqxfixture, cappuccino, unmeasured", null],
    // Nor can a food with no protein, no carbohydrate or no fat figure: each of
    // the four guards gets a food of its own, so dropping any one of them shows.
    [90_000_006, "fndds", "Zqxfixture, cappuccino, noprotein", 40, ["proteinG"]],
    [90_000_007, "fndds", "Zqxfixture, cappuccino, nocarbs", 41, ["carbsG"]],
    [90_000_008, "fndds", "Zqxfixture, cappuccino, nofat", 42, ["fatG"]],
    // The plain food and the dishes made from it, for the search's order. The
    // muffin holds the lowest id and the fewest words, so it is the row that
    // rises wherever one of the three head steps goes missing.
    [90_000_010, "fndds", "Muffin, zqxplain", 53],
    [90_000_011, "fndds", "Zqxplain split", 51],
    [90_000_012, "fndds", "Zqxplain, cooked", 52],
    [90_000_013, "fndds", "Zqxplain, muffin mix", 57],
    // A name that IS the word typed, in SR Legacy, beside a longer survey-release
    // name that the release rule would otherwise put first.
    [90_000_020, "sr_legacy", "Zqxhead", 61],
    [90_000_021, "fndds", "Zqxhead split", 62],
    // Ten words, for the cap on how many of them reach the index.
    [90_000_014, "fndds", "Zqxlong alpha beta gamma delta epsilon zeta eta theta iota", 54],
    // An accent the release spells, one it does not, and a decimal in a name.
    [90_000_015, "fndds", "Zqxcrème brûlée", 55],
    [90_000_016, "fndds", "Zqxdecimal, 3.25% milkfat", 56],
    [90_000_017, "fndds", "Zqxjalapeno, raw", 58],
    // An accented head, for the order steps reading the folded name.
    [90_000_018, "fndds", "Zqxpâté spread", 59],
    [90_000_019, "fndds", "Zqxpâté, liver", 60],
    // A scan's food (ROADMAP 7a-iii-b), one row per rule; words "zqxs…", so the
    // search tests above never see them.
    // A whole description that IS the name, in SR Legacy, beside a survey-release head.
    [90_000_040, "sr_legacy", "Zqxsname", 70],
    [90_000_041, "fndds", "Zqxsname, cooked", 71],
    // A head that IS the name, in SR Legacy, beside a survey-release dish.
    [90_000_042, "sr_legacy", "Zqxshead, raw", 72],
    [90_000_043, "fndds", "Zqxshead split", 73],
    // Every word, three words each: the survey release first.
    [90_000_044, "sr_legacy", "Zqxsdish, zqxsrel, baked", 74],
    [90_000_045, "fndds", "Zqxsrel zqxsdish pie", 75],
    // Every word, one release: the fewest words, then USDA's id.
    [90_000_046, "fndds", "Zqxsfew, zqxsmore, fried, with oil", 76],
    [90_000_047, "fndds", "Zqxsfew, zqxsmore, fried", 77],
    [90_000_048, "fndds", "Zqxsfew, zqxsmore, baked", 78],
    // A dish made from the food, whose first word is another food's.
    [90_000_049, "fndds", "Bread, zqxsbanana", 79],
    // One word of two.
    [90_000_050, "fndds", "Zqxsone, raw", 80],
    // A plural and a past tense, stemmed.
    [90_000_051, "fndds", "Zqxsegg, scrambled", 81],
    // No figure to price it by.
    [90_000_052, "fndds", "Zqxsnofat, raw", 82, ["fatG"]],
    [90_000_053, "fndds", "Zqxsnokcal, raw", null],
    // One food made three ways, all heads of the same name, and a dish of it: the
    // survey release's pickled one leads by the release rule; SR Legacy's raw one
    // is the plainest of the other two, a calorie from the longer one.
    [90_000_054, "fndds", "Zqxsprep, pickled", 34],
    [90_000_055, "sr_legacy", "Zqxsprep, raw", 16],
    [90_000_056, "sr_legacy", "Zqxsprep, oriental, cooked, boiled, drained", 17],
    [90_000_057, "fndds", "Zqxsprep pie", 300],
    // Kd's pumpkin, as USDA has it: the plain cooked entry and a canned one 4 kcal
    // from it, a raw one, and a dish of it that only starts with its name.
    [90_000_058, "fndds", "Zqxsgourd, cooked", 52],
    [90_000_059, "fndds", "Zqxsgourd, canned, cooked", 56],
    [90_000_060, "sr_legacy", "Zqxsgourd, raw", 26],
    [90_000_061, "fndds", "Zqxsgourd pie", 80],
    // Mushrooms, as USDA has them: a plain pickled entry and a longer one cooked
    // with oil, 24 kcal apart.
    [90_000_062, "fndds", "Zqxsmush, pickled", 46],
    [90_000_063, "fndds", "Zqxsmush, fresh, cooked with oil", 70],
    // A food whose two ways are 30 kcal apart, and both near 600.
    [90_000_064, "fndds", "Zqxsnut, raw", 580],
    [90_000_065, "fndds", "Zqxsnut, dry roasted, with salt added", 610],
    // Two foods at the tie's edge: a long entry near the estimate, and a plain one
    // past the estimate's error by exactly 10 kcal more than it, or by 11.
    [90_000_066, "fndds", "Zqxsleaf, frozen, cooked, boiled, drained", 125],
    [90_000_067, "fndds", "Zqxsleaf, raw", 135],
    [90_000_068, "fndds", "Zqxsroot, frozen, cooked, boiled, drained", 125],
    [90_000_069, "fndds", "Zqxsroot, raw", 136],
  ];

  const load = async (): Promise<void> => {
    const byRelease = (release: UsdaRelease): UsdaEntry[] =>
      CATALOG.filter(([, r]) => r === release).map(([id, , description, kcal, unmeasured]) =>
        entry(id, description, kcal, [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }], unmeasured ?? []),
      );
    await importUsda(sql, [
      ["sr_legacy", byRelease("sr_legacy")],
      ["fndds", byRelease("fndds")],
    ]);
  };

  beforeAll(async () => {
    await clean();
    await load();
  }, 60_000);
  afterAll(async () => {
    await clean();
    await sql.end({ timeout: 5 });
  });

  const found = async (query: string, limit = 10): Promise<number[]> =>
    (await searchUsdaFoods(sql, query, limit)).map((row) => row.fdcId);

  describe("the search box's rule", () => {
    it("takes every typed word, with the last one as a prefix", async () => {
      expect(await found("zqxfixture cappuccino")).toEqual([90_000_001, 90_000_003, 90_000_002]);
      expect(await found("zqxfixture cappucc")).toEqual([90_000_001, 90_000_003, 90_000_002]);
      // "tea" is in one description only, so the other three drop out.
      expect(await found("zqxfixture tea")).toEqual([90_000_004]);
    });

    it("prefixes ONLY the last word: an earlier word must match whole", async () => {
      // If every word were a prefix this would still find the cappuccinos.
      expect(await found("cappucc zqxfixture")).toEqual([]);
      expect(await found("cappuccino zqxfixture")).toEqual([90_000_001, 90_000_003, 90_000_002]);
    });

    it("puts the survey release before SR Legacy, then the fewest-worded description", async () => {
      const rows = await searchUsdaFoods(sql, "zqxfixture cappuccino", 10);
      expect(rows.map((r) => `${r.release}/${String(r.description.split(",").length)}`)).toEqual([
        "fndds/2", // two words, the survey release
        "fndds/4", // more words, still ahead of SR Legacy
        "sr_legacy/2",
      ]);
    });

    it("never offers a food with no energy figure, which could not be priced into a meal", async () => {
      expect(await found("zqxfixture cappuccino unmeasured")).toEqual([]);
      expect((await found("zqxfixture")).includes(90_000_005)).toBe(false);
    });

    it("cannot be broken, or widened, by full-text operators someone types", async () => {
      // Every one of these would be a tsquery operator if the typed text reached
      // Postgres as a query: `!` negates, `|` is an OR that would widen the
      // search, `(` unbalanced is a syntax error, `:*` a prefix.
      for (const typed of [
        "zqxfixture & cappuccino",
        "zqxfixture | cappuccino",
        "zqxfixture <-> cappuccino",
        "zqxfixture ((( cappuccino",
        "zqxfixture:* cappuccino",
      ]) {
        expect(await found(typed), typed).toEqual([90_000_001, 90_000_003, 90_000_002]);
      }
      // `!tea` must not become "everything except tea".
      expect(await found("zqxfixture !tea")).toEqual([90_000_004]);
    });

    it("searches the words English indexes, so a stop word neither narrows nor empties it", async () => {
      // "of" and "a" are not in the index at all; a query of nothing but stop
      // words finds nothing rather than everything.
      expect(await found("zqxfixture of a cappuccino")).toEqual([90_000_001, 90_000_003, 90_000_002]);
      expect(await found("of a the")).toEqual([]);
      expect(await found("   ")).toEqual([]);
      expect(usdaTsQuery("of a the")).toBe("of & a & the:*");
      expect(usdaTsQuery("!!!")).toBeNull();
      expect(usdaSearchWords("Crème Brûlée & cake")).toEqual(["creme", "brulee", "cake"]);
    });

    it("puts the food itself above the dishes made from it, each of the three steps on its own", async () => {
      // USDA names a food "head, then qualifiers": "Zqxplain, cooked" is the
      // food, "Zqxplain split" a dish that starts with its name, "Muffin,
      // zqxplain" a muffin. All are in one release, so without the head steps
      // the fewest words and then USDA's own id decide, and each line below
      // changes if its step is taken out.
      //
      // Step 1, the head IS what was typed. Without it "Zqxplain split" (as few
      // words, a lower id) leads.
      expect(await found("zqxplain")).toEqual([90_000_012, 90_000_013, 90_000_011, 90_000_010]);
      // Its other half: a whole name that is exactly what was typed. Without it
      // the survey release's "Zqxhead split" leads, as FNDDS ranks before SR.
      expect(await found("zqxhead")).toEqual([90_000_020, 90_000_021]);
      // Step 2, the description STARTS with what was typed, half-typed as it is.
      // Without it nothing separates the four, and the muffin leads.
      expect(await found("zqxpl")).toEqual([90_000_011, 90_000_012, 90_000_013, 90_000_010]);
      // Step 3, its first word is the first word typed, where USDA puts a comma
      // between the words typed. Without it the muffin, a word shorter, leads.
      expect(await found("zqxplain muffin")).toEqual([90_000_013, 90_000_010]);
      // Typed in full, a two-word head is the food itself.
      expect(await found("zqxplain split")).toEqual([90_000_011]);
    });

    it("never offers a food missing any of the four figures a meal is priced from", async () => {
      // One food per guard: energy, protein, carbohydrate, fat.
      for (const missing of ["unmeasured", "noprotein", "nocarbs", "nofat"]) {
        expect(await found(`zqxfixture cappuccino ${missing}`), missing).toEqual([]);
      }
      expect(await found("zqxfixture cappuccino")).toEqual([90_000_001, 90_000_003, 90_000_002]);
    });

    it("takes the first ten words of a query and lets the rest go", async () => {
      const ten = "zqxlong alpha beta gamma delta epsilon zeta eta theta iota";
      expect(await found(ten)).toEqual([90_000_014]);
      // The eleventh word is in no description at all; were it searched, every
      // word having to match would leave nothing.
      expect(await found(`${ten} zqxnotaword`)).toEqual([90_000_014]);
      expect(usdaSearchWords(`${ten} zqxnotaword`)).toHaveLength(10);
    });

    it("folds accents on both sides, so neither USDA's spelling nor the person's hides a food", async () => {
      // What the release holds today: spelt plain, typed accented on a phone.
      expect(await found("zqxjalapeño")).toEqual([90_000_017]);
      expect(await found("zqxjalapeno")).toEqual([90_000_017]);
      // What a later release could hold: spelt with its accents, typed plain,
      // typed as spelt, or in capitals.
      expect(await found("zqxcreme brulee")).toEqual([90_000_015]);
      expect(await found("zqxcrème brûlée")).toEqual([90_000_015]);
      expect(await found("ZQXCRÈME BRÛLÉE")).toEqual([90_000_015]);
      // The head steps read the folded name as well: typed either way, the pâté
      // itself ranks above the spread, whose id is lower.
      expect(await found("zqxpate")).toEqual([90_000_019, 90_000_018]);
      expect(await found("zqxpâté")).toEqual([90_000_019, 90_000_018]);
    });

    it("finds a number with a decimal point in it", async () => {
      // "3.25%" is one lexeme, 3.25 — typing the description back word for
      // word has to find it.
      expect(await found("Zqxdecimal, 3.25% milkfat")).toEqual([90_000_016]);
      expect(await found("zqxdecimal 3.25")).toEqual([90_000_016]);
    });

    it("honours the limit it is given, and asks nothing of the database below one", async () => {
      expect(await found("zqxfixture cappuccino", 2)).toEqual([90_000_001, 90_000_003]);
      expect(await found("zqxfixture cappuccino", 0)).toEqual([]);
    });
  });

  describe("the USDA row a scanned food's name finds (ROADMAP 7a-iii-b)", () => {
    const scanned = async (hint: string, kcalSeen: number | null = null): Promise<[number, string] | null> => {
      const seen = kcalSeen === null ? null : energySeen({ kcal: kcalSeen, proteinG: 0, carbsG: 0, fatG: 0 });
      const found = await usdaFoodForScan(sql, hint, seen);
      return found === null ? null : [found.food.fdcId, found.match];
    };

    it("is the food itself by name first: the whole description, then its head, before any release rule", async () => {
      // SR Legacy's "Zqxsname" is the name; the survey release's "Zqxsname, cooked" is only its head.
      expect(await scanned("zqxsname")).toEqual([90_000_040, "name"]);
      // SR Legacy's head "Zqxshead, raw" before the survey release's dish "Zqxshead split".
      expect(await scanned("zqxshead")).toEqual([90_000_042, "head"]);
    });

    it("is then every word, starting with one of them: the survey release first, the fewest words, then USDA's id", async () => {
      expect(await scanned("zqxsrel zqxsdish")).toEqual([90_000_045, "words"]);
      expect(await scanned("zqxsmore zqxsfew")).toEqual([90_000_047, "words"]);
    });

    it("never is a dish that only holds the name after another food's", async () => {
      expect(await scanned("zqxsbanana")).toBeNull();
      expect(await scanned("zqxsone zqxstwo")).toBeNull();
    });

    it("stems both sides by the index's own dictionary, and folds accents", async () => {
      expect(await scanned("scrambled zqxseggs")).toEqual([90_000_051, "words"]);
      expect(await scanned("Zqxsnâme")).toEqual([90_000_040, "name"]);
    });

    it("is, among the entries the name finds equally, the plainest of those as near to the model's energy as it can tell", async () => {
      // No energy to go by: the release rule alone.
      expect(await scanned("zqxsprep")).toEqual([90_000_054, "head"]);
      // 17, good to 10: raw (16) and the oriental one (17) are as near, so the plainest, raw — not the
      // nearest; pickled (34) is 17 further, past what the estimate can tell, though the release rule puts it first.
      expect(await scanned("zqxsprep", 17)).toEqual([90_000_055, "head"]);
      // 5, good to 10: raw (16) is nearest, the oriental one (17) as near, pickled (34) not.
      expect(await scanned("zqxsprep", 5)).toEqual([90_000_055, "head"]);
      // 30: pickled (34) is nearest, and raw and the oriental one within 10 of it: the release rule, pickled.
      expect(await scanned("zqxsprep", 30)).toEqual([90_000_054, "head"]);
    });

    it("never names a way of cooking by a few kcal: a canned entry 4 kcal nearer is as near as the plain one", async () => {
      // 75, good to 22.5: the canned entry (56) is 19 off and inside a band around 75; the plain one (52) is 23 off, just outside it.
      expect(await scanned("zqxsgourd", 75)).toEqual([90_000_058, "head"]);
      // 100, good to 30: neither is near, the canned one 4 kcal nearer.
      expect(await scanned("zqxsgourd", 100)).toEqual([90_000_058, "head"]);
    });

    it("never lets an entry past the estimate's error tie with one inside it by more than 10 kcal", async () => {
      // 80, good to 24, and no entry is 80: cooked with oil (70) is 10 off, inside; pickled (46) is 34 off, outside and
      // 24 further — within 24 of the nearest, but not as near.
      expect(await scanned("zqxsmush", 80)).toEqual([90_000_063, "head"]);
      // 610, good to 183: raw (580) and roasted (610) are both inside, 30 kcal apart, so as near: the plainest, raw.
      expect(await scanned("zqxsnut", 610)).toEqual([90_000_064, "head"]);
    });

    it("ties an entry past the estimate's error with the nearest up to 10 kcal further, and not 11", async () => {
      // 100, good to 30: the frozen entry (125) is 25 off, inside. Raw at 135 is 35 off, outside the error but exactly
      // 10 further than the nearest, so as near, and the plainer wins.
      expect(await scanned("zqxsleaf", 100)).toEqual([90_000_067, "head"]);
      // Raw at 136 is 36 off, 11 further: not as near, however plain.
      expect(await scanned("zqxsroot", 100)).toEqual([90_000_068, "head"]);
    });

    it("measures the nearest within the name's own step, and never leaves that step for a nearer dish", async () => {
      // 80 is the pie's energy exactly, but the pie only starts with the name. Measured from the pie (0 off), only the
      // canned entry (24 off) would be as near; measured within the heads, the plain one (28 off) is as near too.
      expect(await scanned("zqxsgourd", 80)).toEqual([90_000_058, "head"]);
      // 300 is the pie's energy exactly: still a head, the plainest of them, pickled (34).
      expect(await scanned("zqxsprep", 300)).toEqual([90_000_054, "head"]);
    });

    it("never is a food it cannot price, and no text the model writes is an operator", async () => {
      expect(await scanned("zqxsnofat")).toBeNull();
      expect(await scanned("zqxsnokcal")).toBeNull();
      expect(await scanned("zqxsname & | ! ( ) : * <->")).toEqual([90_000_040, "name"]);
      expect(await scanned("zqxsname%")).toEqual([90_000_040, "name"]);
      expect(await scanned("&& !!")).toBeNull();
      expect(await scanned("of the")).toBeNull();
    });
  });

  describe("resolving a canonical", () => {
    it("names a food by its release and USDA's own id", () => {
      expect(usdaCanonical({ fdcId: 90_000_001, release: "fndds" })).toBe("usda_fndds_90000001");
      expect(usdaCanonical({ fdcId: 90_000_002, release: "sr_legacy" })).toBe("usda_sr_90000002");
    });

    it("finds the row, with every number the table holds", async () => {
      const row = await usdaFoodByCanonical(sql, "usda_fndds_90000001");
      expect(row?.description).toBe("Zqxfixture, cappuccino");
      expect(row?.kcal).toBe(27);
      expect(row?.servingGrams).toBe(240);
      expect(row?.servingUnit).toBe("cup");
    });

    it("refuses a canonical whose release does not match the row", async () => {
      // 90,000,001 exists, but in the survey release — naming SR Legacy must not
      // hand back the survey row.
      expect(await usdaFoodByCanonical(sql, "usda_sr_90000001")).toBeNull();
      expect(await usdaFoodByCanonical(sql, "usda_fndds_90000002")).toBeNull();
    });

    it("answers null for an unpriceable, unknown or malformed canonical", async () => {
      expect(await usdaFoodByCanonical(sql, "usda_fndds_90000005")).toBeNull();
      expect(await usdaFoodByCanonical(sql, "usda_fndds_90000099")).toBeNull();
      for (const bad of [
        "usda_xx_1", "usda_fndds_", "usda_fndds_abc", "off_123", "dal_lentil_curry",
        "usda_fndds_99999999999999",
        // Past what an `integer` column holds: it must answer null, never raise
        // "integer out of range" out of a search box.
        "usda_sr_2147483648", "usda_fndds_9999999999",
        // A canonical is one whole food, never a pattern.
        "usda_fndds_9000000%", "usda_fndds_90000001 OR 1=1",
      ]) {
        expect(await usdaFoodByCanonical(sql, bad), bad).toBeNull();
      }
    });
  });

  describe("the importer, run twice", () => {
    const snapshot = async (): Promise<readonly unknown[]> =>
      sql`SELECT * FROM usda_foods WHERE fdc_id BETWEEN ${FIRST_ID} AND ${LAST_ID} ORDER BY fdc_id`;
    const portions = async (): Promise<readonly unknown[]> =>
      sql`SELECT * FROM usda_food_portions WHERE fdc_id BETWEEN ${FIRST_ID} AND ${LAST_ID} ORDER BY fdc_id, seq_num`;

    it("changes nothing on a second run, and leaves every row identical", async () => {
      const before = await snapshot();
      const beforePortions = await portions();
      const second = await importUsda(sql, [["fndds", [entry(90_000_001, "Zqxfixture, cappuccino", 27, [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }])]]]);
      expect(second.changed).toBe(0);
      expect(second.foods).toBe(1);
      expect(await snapshot()).toEqual(before);
      expect(await portions()).toEqual(beforePortions);
    });

    it("writes exactly the row that differs, and nothing beside it", async () => {
      const changedRun = await importUsda(sql, [["fndds", [entry(90_000_001, "Zqxfixture, cappuccino, extra hot", 27, [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }])]]]);
      expect(changedRun.changed).toBe(1);
      const [row] = await sql<{ description: string; search_text: string; word_count: number; first_word: string }[]>`
        SELECT description, search_text, word_count, first_word FROM usda_foods WHERE fdc_id = ${90_000_001}`;
      expect(row?.description).toBe("Zqxfixture, cappuccino, extra hot");
      expect(row?.search_text).toBe("zqxfixture, cappuccino, extra hot");
      expect(row?.word_count).toBe(4);
      expect(row?.first_word).toBe("zqxfixture");
      // The generated search column follows the description it indexes.
      expect(await found("zqxfixture extra hot")).toEqual([90_000_001]);
      await load(); // put the catalog back for any later run
    });

    it("drops a household measure the release no longer lists", async () => {
      await importUsda(sql, [
        [
          "fndds",
          [
            entry(90_000_001, "Zqxfixture, cappuccino", 27, [
              { seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 },
              { seqNum: 2, amount: null, unit: "1 mug", gramWeight: 350 },
            ]),
          ],
        ],
      ]);
      expect((await sql<{ seq_num: number }[]>`SELECT seq_num FROM usda_food_portions WHERE fdc_id = ${90_000_001} ORDER BY seq_num`).map((r) => r.seq_num)).toEqual([1, 2]);
      const shrunk = await importUsda(sql, [["fndds", [entry(90_000_001, "Zqxfixture, cappuccino", 27, [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }])]]]);
      expect(shrunk.changed).toBe(1);
      expect((await sql<{ seq_num: number }[]>`SELECT seq_num FROM usda_food_portions WHERE fdc_id = ${90_000_001}`).map((r) => r.seq_num)).toEqual([1]);
    });

    it("takes every measure off a food the release now lists none for", async () => {
      const bare = await importUsda(sql, [["fndds", [entry(90_000_001, "Zqxfixture, cappuccino", 27, [])]]]);
      // Two rows: the measure deleted, and the food row whose serving it was.
      expect(bare.changed).toBe(2);
      expect((await sql`SELECT seq_num FROM usda_food_portions WHERE fdc_id = ${90_000_001}`).length).toBe(0);
      const [row] = await sql<{ serving_grams: number; serving_unit: string }[]>`
        SELECT serving_grams, serving_unit FROM usda_foods WHERE fdc_id = ${90_000_001}`;
      // With no household measure, a food is 100 g by the gram.
      expect(row).toEqual({ serving_grams: 100, serving_unit: "g" });
      await load();
    });

    it("leaves a food it did not write alone, rather than deleting one a saved meal may name", async () => {
      const report = await importUsda(sql, [["fndds", [entry(90_000_001, "Zqxfixture, cappuccino", 27, [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }])]]]);
      // Every other fixture row, and every real row on this machine, is stale to
      // that one-food run — and every one of them is still there.
      expect(report.stale).toBeGreaterThanOrEqual(CATALOG.length - 1);
      expect((await snapshot()).length).toBe(CATALOG.length);
    });
  });
});
