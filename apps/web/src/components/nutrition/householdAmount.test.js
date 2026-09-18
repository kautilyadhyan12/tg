// ROADMAP 7a-iv-h — a photo row's grams said in the food's own cup, or its spoon
// (Kd, RULINGS 2026-09-17): which measure is read, and every step of the rounding.
import { describe, expect, it } from 'vitest';
import { cupsInWords, householdAmount, householdVolume, photoGramsMark } from './householdAmount';

const GRAMS = { id: 'g', name: 'g', grams: 1 };
const OUNCES = { id: 'oz', name: 'oz', grams: 28.349523125 };
const m = (name, grams, id = `usda-${name}`) => ({ id, name, grams });
/** A food's measures as the server sends them: its own, then grams and ounces. */
const food = (...measures) => [...measures, GRAMS, OUNCES];

describe('which measure a row is said in', () => {
  it.each([
    // [what, measures, grams, words]
    ['its own cup', food(m('cup', 158)), 260, 'about 1 and a half cups'],
    ['its own half cup, as half a cup', food(m('half cup', 90)), 90, 'about half a cup'],
    ['its own cup over an earlier cup with words', food(m('cup, sliced', 150), m('cup', 200)), 200, 'about 1 cup'],
    ['its own cup over an earlier cup of a size', food(m('cup (8 fl oz)', 237), m('cup', 480)), 240, 'about half a cup'],
    ['its own cup over an earlier spoon', food(m('tbsp', 13.7), m('cup', 220)), 110, 'about half a cup'],
    ['a cup with words over an earlier spoon', food(m('tbsp', 20), m('cup, sliced', 150)), 75, 'about half a cup, sliced'],
    ['our list\'s own serving named "cup"', food(m('cup', 248, 'serving')), 248, 'about 1 cup'],
    // A cup that says only its size or a serving is a plain cup.
    ['a cup of a size', food(m('cup (8 fl oz)', 237)), 237, 'about 1 cup'],
    ['a cup with USDA\'s NFS', food(m('cup, NFS', 200)), 100, 'about half a cup'],
    ['a counted cup, per cup', food(m('0.75 cup (1 NLEA serving)', 30)), 40, 'about 1 cup'],
    ['a counted cup in a fraction', food(m('serving 1/2 cup', 120)), 240, 'about 1 cup'],
    ['a survey serving of a cup, bracketed', food(m('serving (1 cup)', 200)), 200, 'about 1 cup'],
    ['a plain cup of a size before an earlier cup with words', food(m('cup, mashed', 225), m('cup (1" pieces)', 150)), 150, 'about 1 cup'],
    // Only cups with words: the first, its words kept (a cup of mashed banana is not of sliced).
    ['the first cup with words', food(m('cup, mashed', 225), m('cup, sliced', 150)), 60, 'about a quarter cup, mashed'],
    ['words with no comma', food(m('cup slices', 109)), 55, 'about half a cup, slices'],
    ['every word kept', food(m('cup, cooked, diced', 140)), 140, 'about 1 cup, cooked, diced'],
    ['a size, a cross-reference and NFS dropped from the words', food(m('cup, 1/2" pieces, From 19211, NFS, chopped', 100)), 50, 'about half a cup, chopped'],
    ['words in a bracket kept, a figure in one dropped', food(m('cup (not packed)', 200)), 200, 'about 1 cup, not packed'],
    ['a bracket with a figure and words after it', food(m('0.25 cup, raw (equivalent to 1 large…)', 50)), 200, 'about 1 cup, raw'],
    ['the cup, in spoons, for a small amount', food(m('cup, whole', 143)), 10, 'about 1 tablespoon, whole'],
    // A cup that weighs something else is no cup of the food as eaten.
    ['a dry cup that yields: skipped for a spoon', food(m('cup, dry, yields', 185), m('tbsp', 12)), 24, 'about 2 tablespoons'],
    ['a cup of what is left after the bone: skipped', food(m('cup (yield after bone removed)', 140)), 140, null],
    // Only spoons.
    ['its own tablespoon', food(m('tbsp', 20)), 30, 'about 1 and a half tablespoons'],
    ['a counted tablespoon, per tablespoon', food(m('2 tbsp', 32)), 42, 'about 2 and a half tablespoons'],
    ['a teaspoon', food(m('tsp', 5)), 10, 'about 2 teaspoons'],
    ['a spoon written out', food(m('tablespoon', 15)), 15, 'about 1 tablespoon'],
    ['a plain spoon before an earlier spoon with words', food(m('tbsp, heaping', 20), m('tsp', 5)), 15, 'about 1 tablespoon'],
    ['a spoon with words', food(m('tbsp, melted', 14)), 28, 'about 2 tablespoons, melted'],
    ['a spoon, in cups, for a large amount', food(m('tbsp', 20)), 320, 'about 1 cup'],
    // Nothing to say it in: grams alone.
    ['pieces only', food(m('slice', 8), m('strip', 12)), 24, null],
    ['grams and ounces only (a scan\'s estimate)', food(), 220, null],
    ['a cupcake is no cup', food(m('cupcake', 60), m('regular cupcake', 45)), 60, null],
    ['a drink size is no cup', food(m('12 fl oz cup', 355), m('espresso cup (2 fl oz)', 60)), 120, null],
    ['a cup that weighs nothing', food(m('cup', 0)), 100, null],
    ['no measures at all', undefined, 100, null],
  ])('%s', (_, measures, grams, words) => {
    expect(householdAmount(measures, grams)).toBe(words);
  });

  it('says nothing where no grams are known', () => {
    for (const grams of [0, -5, null, undefined, Number.NaN, 'abc']) {
      expect(householdAmount(food(m('cup', 158)), grams), String(grams)).toBeNull();
    }
  });

  it('reads a cup as sixteen tablespoons and forty-eight teaspoons', () => {
    expect(householdVolume([m('cup', 240)]).gramsPerCup).toBe(240);
    expect(householdVolume([m('tbsp', 15)]).gramsPerCup).toBe(240);
    expect(householdVolume([m('tsp', 5)]).gramsPerCup).toBe(240);
    expect(householdVolume([m('half cup', 120)]).gramsPerCup).toBe(240);
    expect(householdVolume([m('2 tbsp', 30)]).gramsPerCup).toBe(240);
  });
});

describe('the rounding, in words a kitchen says', () => {
  const TSP = 1 / 48;
  const TBSP = 1 / 16;
  it.each([
    // Nothing: no amount, or under half a teaspoon.
    [0, null], [-1, null], [Number.NaN, null], [0.49 * TSP, null],
    // Teaspoons, in halves, under a tablespoon.
    [0.5 * TSP, 'half a teaspoon'], [0.74 * TSP, 'half a teaspoon'], [0.75 * TSP, '1 teaspoon'],
    [1.25 * TSP, '1 and a half teaspoons'], [1.75 * TSP, '2 teaspoons'], [2 * TSP, '2 teaspoons'], [2.74 * TSP, '2 and a half teaspoons'],
    [2.75 * TSP, '1 tablespoon'], // three teaspoons are a tablespoon
    // Tablespoons, in halves, under a quarter cup.
    [1 * TBSP, '1 tablespoon'], [1.24 * TBSP, '1 tablespoon'], [1.25 * TBSP, '1 and a half tablespoons'],
    [2 * TBSP, '2 tablespoons'], [3.74 * TBSP, '3 and a half tablespoons'],
    [3.75 * TBSP, 'a quarter cup'], // four tablespoons are a quarter cup
    // Quarters under a cup.
    [0.25, 'a quarter cup'], [0.374, 'a quarter cup'], [0.375, 'half a cup'], [0.5, 'half a cup'],
    [0.624, 'half a cup'], [0.625, 'three quarters of a cup'], [0.874, 'three quarters of a cup'],
    // Halves from a cup up.
    [0.875, '1 cup'], [1.24, '1 cup'], [1.25, '1 and a half cups'], [2, '2 cups'], [2.5, '2 and a half cups'],
    [40.2, '40 cups'],
  ])('%f cups → %j', (cups, words) => {
    expect(cupsInWords(cups)).toBe(words);
  });

  it('never writes a fraction sign or a decimal', () => {
    for (let grams = 1; grams <= 2000; grams++) {
      const words = householdAmount(food(m('cup', 158)), grams);
      if (words !== null) expect(words, String(grams)).not.toMatch(/[¼½¾⅓⅔]|\d\.\d/);
    }
  });

  it('is never more than a third away from the grams it says', () => {
    for (let grams = 1; grams <= 2000; grams++) {
      const cups = grams / 240;
      const words = cupsInWords(cups);
      if (words !== null) expect(Math.abs(roundedCups(words) - cups) / cups, `${grams} g: ${words}`).toBeLessThanOrEqual(1 / 3 + 1e-9);
    }
  });

  it('never says a smaller amount for more grams, across the units', () => {
    let last = -1;
    for (let grams = 1; grams <= 2000; grams++) {
      const words = cupsInWords(grams / 240);
      if (words === null) continue;
      const said = roundedCups(words);
      expect(said, `${grams} g: ${words}`).toBeGreaterThanOrEqual(last);
      last = said;
    }
  });
});

/** What a phrase says, back in cups. */
function roundedCups(words) {
  const unit = /teaspoon/.test(words) ? 1 / 48 : /tablespoon/.test(words) ? 1 / 16 : 1;
  const quarters = { 'a quarter cup': 0.25, 'half a cup': 0.5, 'three quarters of a cup': 0.75 };
  if (words in quarters) return quarters[words];
  if (/^half a /.test(words)) return 0.5 * unit;
  const [, whole, half] = /^(\d+)( and a half)?/.exec(words);
  return (Number(whole) + (half ? 0.5 : 0)) * unit;
}

describe("a photo row's line at the photo's grams", () => {
  it('says the grams, then the cup where the food has one, then that it is an estimate', () => {
    expect(photoGramsMark(food(m('cup', 158)), 260)).toBe('~260 g · about 1 and a half cups · estimate');
    expect(photoGramsMark(food(m('slice', 8)), 24)).toBe('~24 g · estimate');
    expect(photoGramsMark(food(m('cup', 128)), 1)).toBe('~1 g · estimate'); // too little to say in a spoon
  });
});
