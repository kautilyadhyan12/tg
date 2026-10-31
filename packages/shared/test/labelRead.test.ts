// ROADMAP Stage 5 33b-iii-c. The worst thing: a misread number (kJ as kcal, a serving as 100 g, a %
// Daily Value as grams) saved and shown again on every scan. Cases are what real labels print.
import { describe, expect, it } from "vitest";
import { labelEvidenceSchema, panelOfLabel, printedAmount, type LabelColumn } from "../src/index.js";

const column = (over: Partial<LabelColumn>): LabelColumn => ({ per: "100g", serving_amount: null, serving_unit: null, prepared: false, kcal: null, kj: null, protein_g: null, carbs_g: null, fat_g: null, ...over });

describe("a number as a label prints it", () => {
  it.each([
    [493, 493], ["493", 493], ["493kcal", 493], ["5g", 5], ["5 g", 5], ["3,5 g", 3.5], ["3.5g", 3.5], ["1,533 kJ", 1533], ["<1 g", 1], ["< 0.5g", 0.5], ["less than 1g", 1], [0, 0], ["0g", 0],
  ])("%s reads as %s", (printed, read) => { expect(printedAmount(printed)).toBe(read); });

  it.each([
    ["16%"], ["9 %"], ["trace"], ["N/A"], [""], [null], [undefined], [-3], [Number.NaN], ["105 mg"], ["about 5"], [true], [[5]], ["12 oz"],
  ])("%s is not printed, never 0", (printed) => { expect(printedAmount(printed)).toBeNull(); });

  it("a slot the model filled badly does not lose the label", () => {
    const parsed = labelEvidenceSchema.parse({ is_nutrition_label: true, name: "", columns: [{ per: "per pack", kcal: "16%", protein_g: "5g" }], contains: "milk", may_contain: [3, "nuts"], photo_quality: "GOOD" });
    expect(parsed.name).toBeNull();
    expect(parsed.columns[0]).toMatchObject({ per: "other", kcal: null, protein_g: 5 });
    expect(parsed.contains).toEqual([]);
    expect(parsed.may_contain).toEqual(["nuts"]);
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
