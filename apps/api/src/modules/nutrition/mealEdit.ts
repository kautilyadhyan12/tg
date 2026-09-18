// ROADMAP 7a-iv-g — changing a food already logged (RULINGS 2026-09-17). The rules
// an edit of a saved meal turns on, pure so each is one table test: which state of
// the items it was made from, which of the saved items each edited item is, and
// the person's own numbers per 100 g.
import { createHash } from "node:crypto";
import type { MealEditItem, MealItem, OwnNumbers, Per100g } from "@app/shared";

/** A fingerprint of a meal's items: equal exactly when the items are, so an edit
 *  that sends back the one it read was made from the items as they are now. The
 *  items are always the contract's parse of the stored row, so one list always
 *  writes the same way. */
export function itemsVersion(items: readonly MealItem[]): string {
  return createHash("sha256").update(JSON.stringify(items)).digest("base64url").slice(0, 22);
}

/** Which saved item each edit is, `[i]` for `edits[i]`: its place in `saved`, or
 *  null for a food new to the meal. The whole answer is null where an edit names a
 *  saved item that is not there, or that is another food: the meal changed after
 *  the screen read it, and no item is guessed.
 *
 *  An edit that names its item (`from`) is that item, and those claim theirs first,
 *  so an edit that names none never takes one of them. An edit that names none is
 *  the item in its own place where that is the same food and no earlier edit is it,
 *  else the first of that food no edit is, else new — a meal can hold one food
 *  twice, each with its own amount and numbers, and no item is ever two edits. */
export function savedPlaces(
  saved: readonly { canonical: string }[],
  edits: readonly MealEditItem[],
): (number | null)[] | null {
  const claimed = new Set<number>();
  for (const edit of edits) {
    if (edit.from === undefined) continue;
    const item = saved[edit.from];
    if (item === undefined || ("canonical" in edit && edit.canonical !== item.canonical)) return null;
    claimed.add(edit.from);
  }
  return edits.map((edit, at) => {
    if (edit.from !== undefined) return edit.from;
    if (!("canonical" in edit)) return null;
    const same = (place: number): boolean => saved[place]?.canonical === edit.canonical && !claimed.has(place);
    const place = same(at) ? at : saved.findIndex((_, p) => same(p));
    if (place === -1) return null;
    claimed.add(place);
    return place;
  });
}

/** The general Atwater factors: kcal in a gram of protein, of carbohydrate, of fat. */
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const;

/** The person's own protein, carbs and fat for `grams` of a food, as figures per
 *  100 g of it, its calories worked out from them (`KCAL_PER_GRAM`), so the four
 *  always agree. Null where together they weigh more than the food: no food does,
 *  and figures past 100 g per 100 g are no figures. */
export function ownPer100g(own: OwnNumbers, grams: number): Per100g | null {
  if (!(grams > 0) || own.proteinG + own.carbsG + own.fatG > grams) return null;
  const kcal = KCAL_PER_GRAM.protein * own.proteinG + KCAL_PER_GRAM.carbs * own.carbsG + KCAL_PER_GRAM.fat * own.fatG;
  // Divided before multiplied, and held to the contract's bounds: at a sum equal
  // to the grams the other order can come out a hair past 100 (0.69 g of 0.69 g).
  const per = (value: number, most: number): number => Math.min(most, (value / grams) * 100);
  return { kcal: per(kcal, 900), proteinG: per(own.proteinG, 100), carbsG: per(own.carbsG, 100), fatG: per(own.fatG, 100) };
}
