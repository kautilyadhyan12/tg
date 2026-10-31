// The whole pack's weight, from sizes as they stand on Open Food Facts' list (read from the 987,960
// sizes loaded in this folder's database), including words the rule has never heard of.
import { describe, expect, it } from "vitest";
import { packGrams } from "../src/modules/nutrition/packSize.js";

describe("the whole pack, from a real size", () => {
  it.each<[string, number]>([
    ["500 g", 500], ["500g", 500], ["1 kg", 1000], ["1kg", 1000], ["1 l", 1000], ["1 L", 1000], ["500ml", 500], ["16 oz", 453.6],
    ["450 gram", 450], ["380gr", 380], ["200 г", 200], ["1650 г", 1650], ["1 л", 1000], ["280мл", 280], ["1 Liter", 1000], ["1 litre", 1000], ["7.5 dl", 750],
    ["2 lbs", 907.2], ["12 fl oz", 354.8], ["1,9 L e", 1900], ["500 g e", 500], ["~90 g", 90], ["850 g,", 850],
    // Multipacks: what the whole pack holds, written either way.
    ["4 x 125g", 500], ["3 X 100 g", 300], ["2x2L", 4000], ["50 * 10 g", 500], ["6 x 33 cl", 1980],
    ["450 g (15 x 30 g)", 450], ["400 g (4 * 100 g)", 400], ["640 ml (8 x 80 ml)", 640], ["250 g(2X125 g)", 250], ["1,2 kg (8 * 150 g)", 1200],
    // Two ways of writing one weight.
    ["8 oz / 227 g", 226.8], ["14.4 oz (408 g)", 408.2], ["454 g / 16 Oz", 454], ["3.11 fl. oz 92mL", 92], ["40 cl 400g", 400],
  ])("%s holds %d g", (size, grams) => {
    expect(packGrams(size)).toBe(grams);
  });

  it.each<[string]>([
    // No unit, or a count of pieces: nothing says what it weighs.
    ["250.00"], ["60"], ["1"], ["1pcs"], ["12 pcs"], ["200 unidades"], ["1 unit"], ["per stuk"],
    // Words the rule has not heard of, in a size that does hold a weight: never guessed at.
    ["1 serving, 300g"], ["one 140g"], ["1 litro"], ["6 cans 330 ml"], ["400 g drained 240 g"],
    // Two weights that disagree.
    ["135 g, 95g net"], ["250 g, 500 g"], ["400 g (3 x 100 g)"],
    // A dose, not a food's weight; a separator that reads two ways; too much for one meal's food.
    ["0.5mg"], ["1,000 kg"], ["0.125 kg"], ["1.500 g"], ["12 x 1.5 l"], ["20 kg"], ["0 g"], [""],
  ])("%s offers no whole pack", (size) => {
    expect(packGrams(size)).toBeNull();
  });

  it("no size at all offers no whole pack", () => {
    expect(packGrams(null)).toBeNull();
    expect(packGrams(undefined)).toBeNull();
  });
});
