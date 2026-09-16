// ROADMAP 7a-iv-a — the measure picker's pure rules: what it offers, where a food
// starts, how − and + move an amount, what it sends, and how a saved item reads;
// and ROADMAP 7a-iv-b — a scanned row still where it started, and a measure that
// keeps what a dish weighed.
import { describe, expect, it } from 'vitest';
import {
  FILL_CHOICES,
  MAX_AMOUNT,
  amountRefusal,
  amountStep,
  choiceLabel,
  chosenItemFor,
  comesToUnderAGram,
  isStartingValue,
  itemText,
  pickerChoices,
  startingValue,
  steppedAmount,
  valueForChoice,
  valueKeepingGrams,
} from './measures';

const apple = {
  canonical: 'apple', name: 'Apple', serving: 180, unit: 'apple', source: 'curated',
  measures: [
    { id: 'serving', name: 'apple', grams: 180 },
    { id: 'usda-4', name: 'medium (3" dia)', grams: 182 },
    { id: 'g', name: 'g', grams: 1 },
    { id: 'oz', name: 'oz', grams: 28.349523125 },
  ],
  startsAt: { measure: 'serving', amount: 1 },
};
const bowl = { id: 'd-1', label: 'My blue bowl', volumeMl: 360 };

describe('what the picker offers', () => {
  it("lists the food's own measures, then the saved dishes", () => {
    const choices = pickerChoices(apple, [bowl]);
    expect(choices.map((c) => [c.key, c.kind])).toEqual([
      ['serving', 'measure'], ['usda-4', 'measure'], ['g', 'measure'], ['oz', 'measure'], ['dish:d-1', 'dish'],
    ]);
    expect(choices.map(choiceLabel)).toEqual(['apple · 180 g', 'medium (3" dia) · 182 g', 'g', 'oz · 28.35 g', 'My blue bowl · 360 ml']);
  });

  it('offers grams alone for a food that came with no measures', () => {
    expect(pickerChoices({ canonical: 'x', serving: 30 }, undefined).map((c) => c.key)).toEqual(['g']);
    expect(pickerChoices({ canonical: 'x', measures: [] }, null).map((c) => c.key)).toEqual(['g']);
  });
});

describe('where a picked food starts', () => {
  it('at the measure and amount the server named', () => {
    expect(startingValue(apple)).toEqual({ key: 'serving', amount: '1' });
    // Never simply the first measure: wherever in the list the named one is.
    expect(startingValue({ ...apple, startsAt: { measure: 'usda-4', amount: 2 } })).toEqual({ key: 'usda-4', amount: '2' });
    expect(startingValue({ ...apple, startsAt: { measure: 'g', amount: 100 } })).toEqual({ key: 'g', amount: '100' });
    expect(startingValue({ ...apple, startsAt: { measure: 'oz', amount: 1.5 } })).toEqual({ key: 'oz', amount: '1.5' });
  });

  it('at its first measure once, or its serving in grams, where the server named none it has', () => {
    expect(startingValue({ ...apple, startsAt: { measure: 'usda-99', amount: 1 } })).toEqual({ key: 'serving', amount: '1' });
    expect(startingValue({ canonical: 'x', serving: 30 })).toEqual({ key: 'g', amount: '30' });
    expect(startingValue({ canonical: 'x' })).toEqual({ key: 'g', amount: '100' });
  });

  it('a dish starts with no fill picked, grams at what the item weighed, any other measure at one', () => {
    const choices = pickerChoices(apple, [bowl]);
    const by = (key) => choices.find((c) => c.key === key);
    expect(valueForChoice(by('dish:d-1'), 273)).toEqual({ key: 'dish:d-1', amount: '' });
    expect(valueForChoice(by('g'), 273.4)).toEqual({ key: 'g', amount: '273' });
    expect(valueForChoice(by('g'), null)).toEqual({ key: 'g', amount: '100' });
    expect(valueForChoice(by('g'), 20_000)).toEqual({ key: 'g', amount: String(MAX_AMOUNT) });
    expect(valueForChoice(by('usda-4'), 273)).toEqual({ key: 'usda-4', amount: '1' });
    expect(valueForChoice(undefined, 273)).toBeNull();
  });
});

describe('how − and + move an amount', () => {
  const grams = { kind: 'measure', id: 'g' };
  const medium = { kind: 'measure', id: 'usda-4' };

  it('by ten grams, or half of any other measure', () => {
    expect(amountStep(grams)).toBe(10);
    expect(amountStep(medium)).toBe(0.5);
  });

  it.each([
    // [typed, measure, direction, next]
    ['1', medium, 1, '1.5'], ['1.5', medium, -1, '1'], ['0.5', medium, -1, '0.5'],
    ['1.3', medium, 1, '1.5'], ['1.3', medium, -1, '1'], // onto the step's grid
    ['0.25', medium, 1, '0.5'], ['0.25', medium, -1, '0.25'], // a smaller typed amount stays
    ['', medium, 1, '0.5'], ['abc', medium, -1, '0.5'], // no amount: one step
    ['147', grams, 1, '150'], ['147', grams, -1, '140'], ['150', grams, 1, '160'], ['5', grams, -1, '5'],
    [String(MAX_AMOUNT), grams, 1, String(MAX_AMOUNT)],
  ])('%j %o %i → %j', (typed, choice, direction, next) => {
    expect(steppedAmount(typed, choice, direction)).toBe(next);
  });
});

describe('what the picker sends', () => {
  const choices = pickerChoices(apple, [bowl]);
  const by = (key) => choices.find((c) => c.key === key);

  it("a measure and how many, a dish and how full, or nothing while there is no amount", () => {
    expect(chosenItemFor('apple', by('usda-4'), '1.5')).toEqual({ canonical: 'apple', measure: 'usda-4', amount: 1.5 });
    expect(chosenItemFor('apple', by('dish:d-1'), '0.75')).toEqual({ canonical: 'apple', dishwareId: 'd-1', fillLevel: 0.75 });
    for (const typed of ['', '0', '-1', 'abc', undefined]) {
      expect(chosenItemFor('apple', by('usda-4'), typed), String(typed)).toBeNull();
    }
    // A dish is never more than full, and nothing past the contract's bound is sent.
    expect(chosenItemFor('apple', by('dish:d-1'), '1.25')).toBeNull();
    expect(chosenItemFor('apple', by('g'), String(MAX_AMOUNT + 1))).toBeNull();
    expect(chosenItemFor('apple', null, '1')).toBeNull();
    expect(chosenItemFor('', by('g'), '1')).toBeNull();
  });

  it('a dish is filled a quarter at a time, never assumed full', () => {
    expect(FILL_CHOICES.map((f) => f.value)).toEqual([0.25, 0.5, 0.75, 1]);
  });
});

describe('an amount that comes to less than a gram', () => {
  const nut = { kind: 'measure', id: 'usda-1', name: 'nut', grams: 1.2 };
  const grams = { kind: 'measure', id: 'g', name: 'g', grams: 1 };

  // The server weighs to the whole gram: 0.4 g is nothing, 0.5 g rounds to 1 g.
  it.each([
    [grams, '0.4', true],
    [grams, '0.49', true],
    [grams, '0.5', false],
    [grams, '1', false],
    [nut, '0.25', true],
    [nut, '0.42', false],
    [nut, '0', false],
    [nut, '', false],
    [nut, 'abc', false],
  ])('%o × %s: %s', (choice, typed, under) => {
    expect(comesToUnderAGram(choice, typed)).toBe(under);
  });

  it('is never judged for a dish, whose grams are the server’s alone', () => {
    expect(comesToUnderAGram(pickerChoices(apple, [bowl]).at(-1), '0.25')).toBe(false);
    expect(comesToUnderAGram(null, '0.1')).toBe(false);
  });
});

describe('what a refused amount says', () => {
  const refusal = (error, status = 400) => ({ response: { status, data: { error } } });

  it.each([
    ['portion_out_of_range', 'That amount is too small or too large to log — pick another amount.'],
    ['unknown_measure', "That measure isn't one of this food's — pick one from the list."],
    ['unknown_food', null],
    ['invalid_scan', null],
  ])('%s: %j', (code, text) => {
    expect(amountRefusal(refusal(code))).toBe(text);
  });

  it('says nothing of its own for a failure with no reply', () => {
    expect(amountRefusal(new Error('Network Error'))).toBeNull();
    expect(amountRefusal(undefined)).toBeNull();
  });
});

describe('how a saved item reads in the meal list', () => {
  const item = (measure) => ({ name: 'Apple', gramsPoint: 273.2, ...(measure ? { measure } : {}) });

  it('by the measure it was logged by, else by its grams', () => {
    expect(itemText(item({ id: 'usda-4', name: 'medium (3" dia)', amount: 1.5 }))).toBe('Apple: 1.5 × medium (3" dia), 273g');
    expect(itemText(item({ id: 'oz', name: 'oz', amount: 2 }))).toBe('Apple: 2 oz, 273g');
    expect(itemText(item({ id: 'dish', name: 'My blue bowl', amount: 0.5 }))).toBe('Apple: 0.5 × My blue bowl, 273g');
    expect(itemText(item({ id: 'g', name: 'g', amount: 273.2 }))).toBe('Apple 273g');
    expect(itemText(item(null))).toBe('Apple 273g');
    // No float noise in an amount.
    expect(itemText(item({ id: 'serving', name: 'apple', amount: 0.1 + 0.2 }))).toBe('Apple: 0.3 × apple, 273g');
  });
});

describe('a scanned row still where the scan started it', () => {
  // A row the server started at two of its 30 g slices.
  const bread = { canonical: 'usda_fndds_1', measures: [{ id: 'usda-1', name: 'slice', grams: 30 }, { id: 'g', name: 'g', grams: 1 }], startsAt: { measure: 'usda-1', amount: 2 } };

  it('is its starting measure and amount, however the amount is written', () => {
    expect(isStartingValue(bread, { key: 'usda-1', amount: '2' })).toBe(true);
    expect(isStartingValue(bread, { key: 'usda-1', amount: '2.0' })).toBe(true);
    expect(isStartingValue(bread, { key: 'usda-1', amount: '2.5' })).toBe(false);
    expect(isStartingValue(bread, { key: 'g', amount: '2' })).toBe(false);
    expect(isStartingValue(bread, { key: 'usda-1', amount: '' })).toBe(false);
    expect(isStartingValue(bread, undefined)).toBe(false);
  });
});

describe('a measure that keeps what a dish weighed', () => {
  const [serving, medium, grams, ounce] = pickerChoices(apple, []);
  const [dish] = pickerChoices(apple, [bowl]).filter((c) => c.kind === 'dish');

  it('is the grams, or as many of the measure as weigh them, to a hundredth', () => {
    expect(valueKeepingGrams(grams, 180)).toEqual({ key: 'g', amount: '180' });
    expect(valueKeepingGrams(grams, 180.6)).toEqual({ key: 'g', amount: '181' });
    expect(valueKeepingGrams(serving, 180)).toEqual({ key: 'serving', amount: '1' });
    expect(valueKeepingGrams(medium, 273)).toEqual({ key: 'usda-4', amount: '1.5' });
    expect(valueKeepingGrams(ounce, 100)).toEqual({ key: 'oz', amount: '3.53' });
  });

  it('is nothing for a dish, whose amount is how full it was, or where nothing is weighed yet', () => {
    expect(valueKeepingGrams(dish, 180)).toBeNull();
    for (const none of [null, undefined, 0, -5, Number.NaN]) expect(valueKeepingGrams(grams, none), String(none)).toBeNull();
    expect(valueKeepingGrams(undefined, 180)).toBeNull();
  });

  it('never keeps an amount the contract would refuse, nor grams past it', () => {
    // A gram of a 5,000 g measure is 0.0002 of it: no hundredth to keep.
    expect(valueKeepingGrams({ key: 'usda-9', kind: 'measure', id: 'usda-9', name: 'whole cake', grams: 5000 }, 1)).toBeNull();
    expect(valueKeepingGrams(grams, MAX_AMOUNT + 500)).toEqual({ key: 'g', amount: String(MAX_AMOUNT) });
  });
});
