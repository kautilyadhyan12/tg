// ROADMAP 7a-iv-g — changing a food already logged (RULINGS 2026-09-17). Pure
// helpers the box a logged food opens in (`LoggedFoodSheet.jsx`) reads: where a
// food's numbers come from in words, the person's typed numbers as the contract
// takes them, and what a refused edit says.
import { MAX_AMOUNT, amountRefusal } from './measures';

/** Where a food's numbers come from, as the box says it under them. */
export const SOURCE_WORDS = {
  curated: 'From the food list',
  usda: 'From the food list · USDA FoodData Central',
  openfoodfacts: 'Packaged product · Open Food Facts',
  estimate: "The scan's estimate",
  own: 'Your numbers',
};

/** The three numbers a person types, in the order the box asks them. */
export const OWN_FIELDS = [
  { key: 'proteinG', label: 'Protein' },
  { key: 'carbsG', label: 'Carbs' },
  { key: 'fatG', label: 'Fat' },
];

/** The typed numbers as the contract takes them, or null while any is no amount:
 *  empty, not a number, below nothing, or past what one item of a meal may weigh. */
export function ownNumbersFrom(text) {
  const out = {};
  for (const { key } of OWN_FIELDS) {
    const raw = text?.[key];
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) return null;
    out[key] = value;
  }
  return out;
}

/** What the server's refusal of an edit says to the person, by its code, or null
 *  for a failure that says nothing about the edit (the network). Numbers heavier
 *  than the food are said in the server's own words, which name the food's grams. */
export function editRefusal(err) {
  const body = err?.response?.data;
  switch (body?.error) {
    case 'own_numbers_too_heavy':
      return typeof body.message === 'string' ? body.message : "Protein, carbs and fat together can't weigh more than the food itself.";
    case 'unknown_dishware':
      return 'That dish is no longer saved — pick another measure.';
    case 'unknown_food':
      return "This food can't be looked up any more — type your own numbers for it, or remove it.";
    case 'meal_changed':
      return 'This meal was changed somewhere else. Close this and open it again.';
    default:
      return amountRefusal(err);
  }
}
