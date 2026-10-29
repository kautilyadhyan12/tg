// ROADMAP Stage 5 32b-ii-b (Kd's click-through: "the options are bizarre and will need someone to have
// a scientific degree"; "I was not able to select quantity like number of apples") — a measure's name
// in a shopper's words, and a food starting at a count of it. The cases are USDA's own rows as the
// loaded table holds them (2026-10-29, `tools/measure-names-sweep.ts`, and the foods' portions read
// from `usda_food_portions`), and names the rules have never seen.
import { describe, expect, it } from "vitest";
import { isCountMeasure } from "@app/shared";
import { foodMeasures, plainMeasureName, startingMeasure, usdaMeasureName, type MeasureSource, type UsdaPortion } from "../src/modules/nutrition/measures.js";

describe("a measure's name in a shopper's words", () => {
  it.each([
    // Sizes in inches go: the picker shows the grams beside every measure.
    ['large (3-1/4" dia)', "large"],
    ['medium (7" to 7-7/8" long)', "medium"],
    ['extra small (less than 6" long)', "extra small"],
    ['personal size pizza (5-7" diameter)', "personal size pizza"],
    ['piece (1/8 of 9" dia)', "piece"],
    ['slice (4-1/4" x 4-1/4" x 1/16")', "slice"],
    ["can (303 x 406)", "can"],
    ['regular or 6" submarine', "regular or 6-inch submarine"],
    // Survey codes.
    ["NLEA serving", "serving"],
    ["NLEA Serving", "serving"],
    ["0.75 cup (1 NLEA serving)", "0.75 cup"],
    ["cherry (NLEA serving)", "cherry"],
    ["cup, NFS", "cup"],
    ["fl oz (NFS)", "fl oz"],
    ["pretzel, NS as to size", "pretzel"],
    ["avocado, NS as to Florida or California", "avocado"],
    ["piece, cooked, excluding refuse", "piece, cooked"],
    // A bracket that says the name again, or the one serving.
    ["3 oz (3 oz)", "3 oz"],
    ["3 oz ( 1 serving )", "3 oz"],
    ["slice 1 serving", "slice"],
    // A yield note on a cooked piece only says where its weight came from.
    ["wing (yield after cooking, bone removed)", "wing"],
    ["thin slice (yield after cooking)", "thin slice"],
    // What stays as it is: words people read on a label.
    ["can (12 fl oz)", "can (12 fl oz)"],
    ["fl oz (no ice)", "fl oz (no ice)"],
    ["cup, chopped", "cup, chopped"],
    ["half cup", "half cup"],
    ["slice cooked", "slice cooked"],
    ["miniature/bite size", "miniature/bite size"],
    // A cheese's cube.
    ["cubic inch", "cube"],
    ["cubic inch, boneless, cooked", "cube, boneless, cooked"],
    // Never seen by the rules: their shapes decide.
    ['wrap (10" dia)', "wrap"],
    ["katori (NFS)", "katori"],
    ["bowl (12 fl oz)", "bowl (12 fl oz)"],
    ["roti, NS as to size", "roti"],
    ["sachet", "sachet"],
  ])("%s reads %s", (name, plain) => {
    expect(plainMeasureName(name)).toBe(plain);
  });

  it.each([
    // A raw amount that yields a cooked weight: its grams are not of the thing it names.
    "oz yields",
    "oz, dry, yields",
    "package (10 oz) yields",
    "unit (yield from 1 lb ready-to-cook…)",
    "unit, cooked (yield from 1 lb raw meat)",
    "oz, raw (yield after cooking)",
    "cup in shell, edible yield",
    "lemon yields",
    // A weight the grams already offer.
    "56 grams 1 serving",
    // By area or length.
    "surface inch",
    "linear inch",
    "surface inch, Belgian waffle",
    // Never seen.
    "packet makes, yields 2 cups",
  ])("%s is left out", (name) => {
    expect(plainMeasureName(name)).toBeNull();
  });

  it("tells a count from a weight or a volume", () => {
    for (const name of ["apple", "slice cooked", "large", "serving", "half breast, bone and skin removed", "cube", "leaf outer", "2 biscuits"]) expect(isCountMeasure(name), name).toBe(true);
    for (const name of ["cup", "cup, shredded", "half cup", "3 oz", "oz", "fl oz", "tbsp", "2 tbsp", "tablespoon", "tsp", "lb", "g", "ml", "quart"]) expect(isCountMeasure(name), name).toBe(false);
  });
});

/** A USDA row as the table holds it: SR Legacy's amount in its own column. */
const row = (seqNum: number, amount: number, unit: string, gramWeight: number): UsdaPortion => ({ seqNum, amount, unit, gramWeight });
/** A food of our list served by 100 g, with its cited entry's rows. */
const ours = (portions: UsdaPortion[]): MeasureSource => ({ serving: 100, unit: "g", portions, ownServing: true });
/** A USDA food: its serving is its first row, by construction. */
const usda = (portions: UsdaPortion[]): MeasureSource => {
  const first = portions[0];
  return { serving: first?.gramWeight ?? 100, unit: first === undefined ? "g" : usdaMeasureName(first), portions, ownServing: false };
};
const startName = (source: MeasureSource): string => {
  const measures = foodMeasures(source);
  const start = startingMeasure(source, measures);
  const measure = measures.find((m) => m.id === start.measure);
  return `${String(start.amount)} ${measure?.name ?? "?"} · ${String(measure?.grams ?? 0)} g`;
};

describe("where a food starts: at a count of it where it has one (USDA's own rows, 2026-10-29)", () => {
  it.each([
    // Our list's foods served by 100 g, which started at 100 grams.
    ["bacon (SR 167914)", ours([row(1, 3, "oz", 85), row(2, 1, "slice cooked", 8.1)]), "1 slice cooked · 8.1 g"],
    ["lettuce (SR 169249): a leaf, never the whole 360 g head", ours([row(1, 1, "cup shredded", 36), row(2, 1, "head", 360), row(3, 1, "leaf inner", 4.8), row(4, 1, "leaf outer", 24)]), "1 leaf outer · 24 g"],
    ["avocado (SR 171705)", ours([row(1, 1, "cup, cubes", 150), row(2, 1, "cup, pureed", 230), row(3, 1, "cup, sliced", 146), row(4, 1, "avocado, NS as to Florida or California", 201), row(5, 1, "NLEA Serving", 50)]), "1 avocado · 201 g"],
    ["chicken breast (SR 171477): no recipe unit", ours([row(1, 1, "cup, chopped or diced", 140), row(2, 1, "unit (yield from 1 lb ready-to-cook chicken)", 52), row(3, 0.5, "breast, bone and skin removed", 86)]), "1 half breast, bone and skin removed · 86 g"],
    ["scrambled eggs (SR 172187)", ours([row(1, 1, "large", 61), row(2, 1, "tbsp", 13.7), row(3, 1, "cup", 220)]), "1 large · 61 g"],
    ["white rice (SR 168878): no count, so a cup", ours([row(1, 1, "cup", 158)]), "1 cup · 158 g"],
    ["a food weighed only by the ounce: its grams", ours([row(1, 3, "oz", 85)]), "100 g · 1 g"],
    ["paneer: no measure at all, its grams", ours([]), "100 g · 1 g"],
    // A USDA food whose first row is a cup.
    ["apples, raw (SR 171688)", usda([row(1, 1, "cup, quartered or chopped", 125), row(2, 1, "cup slices", 109), row(3, 1, 'large (3-1/4" dia)', 223), row(4, 1, 'medium (3" dia)', 182)]), "1 large · 223 g"],
    // Never a whole package: frozen greens served by a third of a cup.
    ["frozen greens", usda([row(1, 0.33, "cup", 67), row(2, 1, "package (10 oz)", 284)]), "1 0.33 cup · 67 g"],
    // A USDA food whose first row is a count stays there.
    ["banana, raw", usda([row(1, 1, "banana", 126), row(2, 1, "slice", 6), row(3, 1, "cup", 150)]), "1 banana · 126 g"],
  ])("%s", (_, source, expected) => {
    expect(startName(source)).toBe(expected);
  });

  it("keeps our list's own serving, a cup or an ounce, as the measure it is eaten by", () => {
    // Milk on our list is served by the cup, which USDA's cup of 244 g takes the place of.
    expect(startName({ serving: 240, unit: "cup", portions: [row(1, 1, "cup", 244), row(2, 1, "bottle", 290)], ownServing: true })).toBe("1 cup · 244 g");
    // A crust served by the ounce is not its 183 g crust.
    expect(startName({ serving: 28.35, unit: "oz", portions: [row(1, 1, "crust", 183)], ownServing: true })).toBe("1 oz · 28.349523125 g");
  });
});
