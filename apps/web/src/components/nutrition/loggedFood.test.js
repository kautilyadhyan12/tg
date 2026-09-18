// ROADMAP 7a-iv-g — the box a logged food opens in: the typed numbers it sends, and
// what each refusal of an edit says.
import { describe, expect, it } from 'vitest';
import { mealItemSourceSchema } from '@app/shared';
import { SOURCE_WORDS, editRefusal, ownNumbersFrom } from './loggedFood';

const refused = (error, message) => Object.assign(new Error('400'), { response: { status: 400, data: { error, ...(message ? { message } : {}) } } });

describe('the numbers a person types', () => {
  it('are sent as numbers where all three are amounts', () => {
    expect(ownNumbersFrom({ proteinG: '30', carbsG: '0', fatG: '2.5' })).toEqual({ proteinG: 30, carbsG: 0, fatG: 2.5 });
    expect(ownNumbersFrom({ proteinG: '10000', carbsG: '0', fatG: '0' })).toEqual({ proteinG: 10000, carbsG: 0, fatG: 0 });
  });

  it('are no numbers while any is empty, not a number, below nothing, or past one item of a meal', () => {
    for (const text of [
      { proteinG: '', carbsG: '1', fatG: '1' },
      { proteinG: '  ', carbsG: '1', fatG: '1' },
      { proteinG: '12abc', carbsG: '1', fatG: '1' },
      { proteinG: '1', carbsG: '-1', fatG: '1' },
      { proteinG: '1', carbsG: '1', fatG: '10001' },
      { proteinG: '1', carbsG: '1' },
      null,
    ]) expect(ownNumbersFrom(text), JSON.stringify(text)).toBeNull();
  });
});

describe('what a refused edit says', () => {
  it("says numbers heavier than the food in the server's words, which name the grams", () => {
    expect(editRefusal(refused('own_numbers_too_heavy', "Protein, carbs and fat together can't weigh more than the food itself (150 g)."))).toBe(
      "Protein, carbs and fat together can't weigh more than the food itself (150 g).",
    );
    expect(editRefusal(refused('own_numbers_too_heavy'))).toBe("Protein, carbs and fat together can't weigh more than the food itself.");
  });

  it('says a dish gone, a food no table has, and a meal changed elsewhere, each in its own words', () => {
    expect(editRefusal(refused('unknown_dishware'))).toBe('That dish is no longer saved — pick another measure.');
    expect(editRefusal(refused('unknown_food'))).toBe("This food can't be looked up any more — type your own numbers for it, or remove it.");
    expect(editRefusal(refused('meal_changed'))).toBe('This meal was changed somewhere else. Close this and open it again.');
  });

  it("says an amount refused as the amount, and nothing of its own for a failure that isn't the edit's", () => {
    expect(editRefusal(refused('portion_out_of_range'))).toBe('That amount is too small or too large to log — pick another amount.');
    expect(editRefusal(refused('unknown_measure'))).toBe("That measure isn't one of this food's — pick one from the list.");
    expect(editRefusal(new Error('Network Error'))).toBeNull();
    expect(editRefusal(refused('validation_error'))).toBeNull();
  });
});

describe('where a food’s numbers come from', () => {
  it('has words for every source a saved item can have, as the contract lists them', () => {
    expect(Object.keys(SOURCE_WORDS).sort()).toEqual([...mealItemSourceSchema.options].sort());
  });
});
