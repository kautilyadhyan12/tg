import { isPackagedCanonical, MORE_NUTRIENTS, sumMoreNutrients, type DailyAmountsResponse, type MealItem, type MoreNutrient } from "@app/shared";

// The ten further figures as a list reads them (ROADMAP Stage 5 34b). A figure a food does not give
// is never read as 0: the total carries a *, and one line names the foods.

const FIGURE_NAMES: Readonly<Record<MoreNutrient, { name: string; unit: string }>> = {
  fiberG: { name: "Fibre", unit: "g" },
  sugarsG: { name: "Total sugars", unit: "g" },
  satFatG: { name: "Saturated fat", unit: "g" },
  unsatFatG: { name: "Unsaturated fat", unit: "g" },
  sodiumMg: { name: "Sodium", unit: "mg" },
  potassiumMg: { name: "Potassium", unit: "mg" },
  calciumMg: { name: "Calcium", unit: "mg" },
  ironMg: { name: "Iron", unit: "mg" },
  magnesiumMg: { name: "Magnesium", unit: "mg" },
  vitaminDUg: { name: "Vitamin D", unit: "mcg" },
};

export const FIGURES_LINK = "Nutrients";

/** "2,300" and "11.9": the thousands marked, and a figure's own decimal kept. */
const amountWords = (n: number): string => {
  const [whole = "0", part] = String(n).split(".");
  const marked = whole.replace(/\B(?=(\d{3})+$)/g, ",");
  return part === undefined ? marked : `${marked}.${part}`;
};

export interface FigureLine {
  key: MoreNutrient;
  name: string;
  value: string;
  /** Under the value: the published amount beside it. */
  note: string | null;
  /** The amount as a share of the published one (0.64 for 64 %); null where either is not there. */
  share: number | null;
  /** The published amount is a most to stay under (sodium, saturated fat), not one to reach. */
  limit: boolean;
}

/** `partial`: meals of the day whose foods are not here yet, so even a figure every food here gives
 *  is not the whole of it. */
export function figureLines(items: readonly Pick<MealItem, "more">[], partial: boolean, amounts: DailyAmountsResponse["amounts"] | null): FigureLine[] {
  const totals = sumMoreNutrients(items);
  return MORE_NUTRIENTS.map((key) => {
    const { name, unit } = FIGURE_NAMES[key];
    const { amount, notKnown } = totals[key];
    const none = items.length === 0 || notKnown === items.length;
    const incomplete = partial || notKnown > 0;
    const daily = amounts?.[key] ?? null;
    return {
      key,
      name,
      value: none ? "No data" : `${amountWords(amount)} ${unit}${incomplete ? "*" : ""}`,
      note: daily === null ? null : `${daily.kind === "most" ? "Limit" : "Recommended"} ${amountWords(daily.amount)} ${unit}`,
      share: none || daily === null || !(daily.amount > 0) ? null : amount / daily.amount,
      limit: daily?.kind === "most",
    };
  });
}

/** A nutrient's picture is filled to its share of the published amount (32c-ii-a, the pantry), never
 *  past full; the words beside it say the whole share, 130 % included. */
export const jarFill = (share: number | null): number => (share === null || !Number.isFinite(share) ? 0 : Math.min(1, Math.max(0, share)));
export const shareWords = (share: number | null): string | null => (share === null || !Number.isFinite(share) ? null : `${String(Math.round(share * 100))}%`);

/** Which foods hold totals back, where a total adds up some foods and not others. Null where no total
 *  does: a row reading No data already says it. */
export function missingFoodsWords(items: readonly Pick<MealItem, "name" | "seenAs" | "more">[]): string | null {
  const totals = sumMoreNutrients(items);
  const starred = MORE_NUTRIENTS.filter((key) => totals[key].notKnown > 0 && totals[key].notKnown < items.length);
  if (starred.length === 0) return null;
  const names = [...new Set(items.filter((i) => starred.some((key) => (i.more?.[key] ?? null) === null)).map((i) => i.seenAs ?? i.name))];
  const [first, second, third] = names;
  const who =
    names.length === 1
      ? (first ?? "")
      : names.length === 2
        ? `${first ?? ""} and ${second ?? ""}`
        : names.length === 3
          ? `${first ?? ""}, ${second ?? ""} and ${third ?? ""}`
          : `${first ?? ""}, ${second ?? ""} and ${String(names.length - 2)} more`;
  return `* Some data is missing for ${who}.`;
}

/** A packaged product gave at least one of the figures on the list: what is shown is its label's. */
export const figuresFromALabel = (items: readonly Pick<MealItem, "canonical" | "nutritionSource" | "more">[]): boolean =>
  items.some(
    (i) =>
      (i.nutritionSource === "openfoodfacts" || isPackagedCanonical(i.canonical)) &&
      MORE_NUTRIENTS.some((key) => (i.more?.[key] ?? null) !== null),
  );
