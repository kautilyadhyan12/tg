// ROADMAP Stage 5 33b-iii-c. The worst thing: a misread number (kJ as kcal, a serving as 100 g, a %
// Daily Value as grams) saved and shown again on every scan. Cases are what real labels print.
import { describe, expect, it } from "vitest";
import { allergensFrom, labelEvidenceSchema, mealVisionEvidenceSchema, panelOfLabel, printedAmount, type LabelColumn } from "../src/index.js";

const column = (over: Partial<LabelColumn>): LabelColumn => ({ per: "100g", serving_amount: null, serving_unit: null, prepared: false, kcal: null, kj: null, protein_g: null, carbs_g: null, fat_g: null, ...over });

describe("a number as a label prints it", () => {
  it.each([
    [493, "kcal", 493], ["493", "kcal", 493], ["493kcal", "kcal", 493], ["1,200 kcal", "kcal", 1200], ["1533 kJ", "kj", 1533], ["1,533 kJ", "kj", 1533], ["1.533 kJ", "kj", 1533],
    ["5g", "g", 5], ["5 g", "g", 5], ["3,5 g", "g", 3.5], ["3.5g", "g", 3.5], ["0,500 g", "g", 0.5], ["12,500", "g", 12.5], ["<1 g", "g", 1], ["< 0.5g", "g", 0.5], ["less than 1g", "g", 1], [0, "g", 0], ["0g", "g", 0],
    ["15 ml", "amount", 15], ["39 g", "amount", 39],
  ] as const)("%s as %s reads as %s", (text, kind, read) => { expect(printedAmount(text, kind)).toBe(read); });

  it.each([
    ["16%", "g"], ["9 %", "g"], ["trace", "g"], ["N/A", "g"], ["", "g"], [null, "g"], [undefined, "g"], [-3, "g"], [Number.NaN, "g"], ["105 mg", "g"], ["about 5", "g"], [true, "g"], [[5], "g"], ["12 oz", "g"],
    ["1533 kJ", "kcal"], ["5 kcal", "g"], ["120 ml", "g"], ["2 tbsp", "amount"], ["359 kcal", "kj"],
  ] as const)("%s in the slot for %s is not printed, never 0", (text, kind) => { expect(printedAmount(text, kind)).toBeNull(); });

  it("a slot the model filled badly does not lose the label, and Luna's text numbers are read", () => {
    // Her real reply on a real label, 2026-10-31: numbers as text.
    const real = labelEvidenceSchema.parse({ is_nutrition_label: true, name: null, columns: [{ per: "100g", serving_amount: null, serving_unit: null, prepared: false, kcal: "493", kj: null, protein_g: "5g", carbs_g: "71g", fat_g: "21g" }], contains: [], may_contain: [], photo_quality: "good" });
    expect(panelOfLabel(real)).toMatchObject({ kcal: 493, proteinG: 5, carbsG: 71, fatG: 21 });
    const parsed = labelEvidenceSchema.parse({ is_nutrition_label: true, name: "", columns: [{ per: "per pack", kcal: "16%", protein_g: "5g" }], contains: 3, may_contain: [3, "nuts"], photo_quality: "GOOD" });
    expect(parsed.name).toBeNull();
    expect(parsed.columns[0]).toMatchObject({ per: "other", kcal: null, protein_g: 5 });
    expect(parsed.contains).toEqual([]);
    expect(parsed.may_contain).toEqual(["nuts"]);
  });
});

describe("allergens: the worst thing, one read and then lost", () => {
  it.each([
    ["a line for a list", "Milk, Soy, Peanuts", ["Milk", "Soy", "Peanuts"]],
    ["one long item", ["Contains: wheat flour, soy lecithin, whey (milk), almonds, cashews, walnuts, pistachios, peanuts"], ["wheat flour", "soy lecithin", "whey (milk)", "almonds", "cashews", "walnuts", "pistachios", "peanuts"]],
    ["semicolons", ["Milk; Egg"], ["Milk", "Egg"]],
    ["the same twice", ["Milk", "Milk"], ["Milk"]],
    ["nothing", [], []],
    ["not words", 7, []],
  ])("%s", (_name, given, read) => { expect(allergensFrom(given)).toEqual(read); });

  it("one unbroken word past the longest is carried over in pieces, so nothing is lost", () => {
    const long = Array.from({ length: 300 }, (_, i) => String(i % 10)).join("").replace(/(.{7})/g, (m, _p, at: number) => m + String.fromCharCode(97 + (at % 26)));
    const read = allergensFrom([`milk ${long} soy`]);
    expect(read.join("")).toContain(long);
    expect(read.join(" ")).toContain("soy");
    expect(read.every((w) => w.length <= 120)).toBe(true);
  });

  it("a word past the longest is split, whole, so nothing is lost", () => {
    const long = Array.from({ length: 40 }, (_, i) => `ingredient${String(i)}`).join(" ");
    const read = allergensFrom([long]);
    expect(read.join(" ")).toBe(long);
    expect(read.every((w) => w.length <= 120)).toBe(true);
  });
});

describe("a name cut to fit", () => {
  it("never leaves half an emoji, which the database refuses", () => {
    const parsed = labelEvidenceSchema.parse({ is_nutrition_label: true, name: `${"x".repeat(79)}\u{1F36A}y`, columns: [], contains: [], may_contain: [], photo_quality: "good" });
    expect(parsed.name).toBe(`${"x".repeat(79)}\u{1F36A}`);
    const meal = mealVisionEvidenceSchema.parse({ meal_name: "m", items: [[`${"x".repeat(199)}\u{1F36A}y`, "h", null, null, null, null, null, null]], unknown_items: [], photo_quality: "good" });
    expect(JSON.stringify(meal.items[0])).toContain(`${"x".repeat(199)}\u{1F36A}`);
  });
});

describe("which column is the product's", () => {
  it("per 100 g beats a serving, and the serving is kept", () => {
    const panel = panelOfLabel({ columns: [column({ per: "serving", serving_amount: 70, serving_unit: "g", kcal: 299, protein_g: 5.6, carbs_g: 44.5, fat_g: 11 }), column({ kcal: 427, protein_g: 8, carbs_g: 63.5, fat_g: 15.7 })] });
    expect(panel).toMatchObject({ per: "100", amount: 100, kcal: 427, proteinG: 8, servingAmount: 70 });
  });

  it("a US panel is its serving, by the serving's size", () => {
    expect(panelOfLabel({ columns: [column({ per: "serving", serving_amount: 39, serving_unit: "g", kcal: 170, carbs_g: 27, fat_g: 6 })] })).toMatchObject({ per: "serving", amount: 39, unit: "g", kcal: 170, proteinG: null });
  });

  it("a serving with no size printed is no use, never taken as 100 g", () => {
    expect(panelOfLabel({ columns: [column({ per: "serving", kcal: 170 })] })).toBeNull();
    expect(panelOfLabel({ columns: [column({ per: "serving", serving_amount: 0, kcal: 170 })] })).toBeNull();
  });

  it("as sold beats as prepared, and only prepared is no answer", () => {
    expect(panelOfLabel({ columns: [column({ prepared: true, kcal: 90 }), column({ kcal: 380 })] })?.kcal).toBe(380);
    expect(panelOfLabel({ columns: [column({ prepared: true, kcal: 90 })] })).toBeNull();
  });

  it("kcal printed is never replaced by kJ, and kJ alone is turned into kcal and says so", () => {
    expect(panelOfLabel({ columns: [column({ kcal: 365, kj: 1533 })] })).toMatchObject({ kcal: 365, kcalFromKj: false });
    expect(panelOfLabel({ columns: [column({ kj: 1533 })] })).toMatchObject({ kcal: 366, kcalFromKj: true });
  });

  it("a column for something else, no calories, or no columns: the photo is asked for again", () => {
    expect(panelOfLabel({ columns: [column({ per: "other", kcal: 198 })] })).toBeNull();
    expect(panelOfLabel({ columns: [column({ protein_g: 5 })] })).toBeNull();
    expect(panelOfLabel({ columns: [] })).toBeNull();
  });

  it("ml stays ml", () => {
    expect(panelOfLabel({ columns: [column({ per: "100ml", kcal: 42 })] })).toMatchObject({ unit: "ml", amount: 100 });
    expect(panelOfLabel({ columns: [column({ per: "serving", serving_amount: 15, serving_unit: "ml", kcal: 120 })] })).toMatchObject({ unit: "ml", amount: 15 });
  });
});
