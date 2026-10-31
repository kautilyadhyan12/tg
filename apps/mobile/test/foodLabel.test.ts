import { describe, expect, it } from "vitest";
import type { LabelDraft } from "@app/shared";
import { canReadLabel, labelCostWords, labelToSave, scansLeftWords, typedFromDraft, typedFromProduct } from "../src/screens/food/labelRead";

const draft: LabelDraft = { name: "Noodles", per: "serving", unit: "g", amount: 39, kcal: 170, proteinG: null, carbsG: 27, fatG: 6, servingAmount: 39, contains: ["Wheat", "Milk"], mayContain: [], kcalFromKj: false, check: "part_missing" };

describe("what a read gives the person (the worst thing: a number made up, an allergen lost)", () => {
  it("a number not read is an empty box, never 0, and blocks the save until typed", () => {
    const typed = typedFromDraft(draft);
    expect(typed.proteinG).toBe("");
    expect(labelToSave(typed, null)).toEqual({ missing: "Enter calories, protein, carbs and fat from the pack." });
    expect(labelToSave({ ...typed, proteinG: "0" }, null)).toMatchObject({ body: { proteinG: 0, amount: 39, kcal: 170 } });
  });

  it("allergens read are kept, and what the person adds is kept in their words", () => {
    const typed = typedFromDraft(draft);
    expect(typed.contains).toBe("Wheat, Milk");
    expect(labelToSave({ ...typed, proteinG: "1", contains: "Wheat, Milk, Peanuts, wheat ,", mayContain: "Soy; Sesame" }, "1409999800018")).toMatchObject({
      body: { code: "1409999800018", contains: ["Wheat", "Milk", "Peanuts", "wheat"], mayContain: ["Soy", "Sesame"] },
    });
  });

  it.each([
    ["no name", { name: " " }, "Enter the food’s name."],
    ["no amount", { amount: "" }, "Enter the amount these numbers are for."],
    ["an amount of 0", { amount: "0" }, "Enter the amount these numbers are for."],
    ["no calories", { kcal: "" }, "Enter calories, protein, carbs and fat from the pack."],
    ["a word for a number", { fatG: "abc" }, "Enter calories, protein, carbs and fat from the pack."],
    ["a minus number", { fatG: "-1" }, "Enter calories, protein, carbs and fat from the pack."],
  ])("%s is said", (_name, over, words) => {
    expect(labelToSave({ ...typedFromDraft(draft), proteinG: "1", ...over }, null)).toEqual({ missing: words });
  });

  it("a comma decimal is read", () => {
    expect(labelToSave({ ...typedFromDraft(draft), proteinG: "3,5" }, null)).toMatchObject({ body: { proteinG: 3.5 } });
  });

  it("a saved label opens per 100, with its own allergens", () => {
    const typed = typedFromProduct({ status: "found", code: "", allergens: ["Milk"], mayContain: ["Nuts"], listedAsTyped: [], allergensFrom: null, check: "fine", labelId: "x", food: { canonical: "label_x", name: "Bar", kcal: 435.897, proteinG: 2.564, carbsG: 69.2, fatG: 15.4, fiberG: null, serving: 39, unit: "g", source: "label", measures: [{ id: "g", name: "g", grams: 1 }], startsAt: { measure: "g", amount: 39 }, startsKcal: 170 } } as never);
    expect(typed).toMatchObject({ amount: "100", kcal: "435.9", contains: "Milk", mayContain: "Nuts", servingAmount: 39 });
  });
});

describe("how many photo scans are left", () => {
  it.each([
    [{ window: "day", limit: 7, left: 5 }, "5 of 7 photo scans left today."],
    [{ window: "month", limit: 3, left: 2 }, "2 of 3 photo scans left this month."],
    [{ window: "day", limit: 15, left: 0 }, "No photo scans left. More tomorrow."],
    [{ window: "month", limit: 3, left: 0 }, "No photo scans left. More next month."],
    [{ window: "day", limit: 7, left: null }, null],
    [null, null],
  ] as const)("%j says %s", (scans, words) => {
    expect(scansLeftWords(scans)).toBe(words);
  });

  it("the label button says what it costs, and goes only when none are left", () => {
    expect(labelCostWords({ window: "day", limit: 7, left: 5 })).toBe("Uses 1 photo scan. 5 of 7 left today.");
    expect(labelCostWords(null)).toBe("Uses 1 photo scan.");
    expect(canReadLabel({ window: "day", limit: 7, left: 1 })).toBe(true);
    expect(canReadLabel({ window: "day", limit: 7, left: 0 })).toBe(false);
    expect(canReadLabel(null)).toBe(true);
    expect(canReadLabel({ window: "day", limit: 7, left: null })).toBe(true);
  });
});
