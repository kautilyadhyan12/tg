// The published daily amounts the ten further figures are read beside (ROADMAP Stage 5 34b; 7a-v).
// A reference, never a target the app sets: nothing is worked out from them.
//
// Dietary Reference Intakes, the same tables in the US and Canada, as Health Canada prints them
// (canada.ca, "Dietary reference intakes tables", elements page modified 2025-11-19): fibre,
// potassium, calcium, iron, magnesium, vitamin D by age and sex; sodium's 2,300 mg is the amount
// that lowers chronic disease risk. An 18-year-old reads the 14-18 row; the app is for 18 and over.
// US FDA Daily Values (fda.gov, "Daily Value on the Nutrition and Supplement Facts Labels"): saturated
// fat, which the Reference Intakes give no number for, and the whole set for somebody whose age or
// sex the tables cannot be read by. Total sugars and unsaturated fat have no published amount.
import { z } from "zod";
import type { Gender } from "./users.js";
import type { MoreNutrient } from "./nutrition.js";

/** "about": an amount to reach. "most": an amount not to go over. */
export const dailyAmountSchema = z.object({ kind: z.enum(["about", "most"]), amount: z.number().positive() }).strict();
export type DailyAmount = z.infer<typeof dailyAmountSchema>;
const amountOrNone = dailyAmountSchema.nullable();

export const dailyAmountsResponseSchema = z
  .object({
    /** Who the amounts are for ("women aged 31 to 50"); null where they are the labels' Daily Values. */
    forWhom: z.string().min(1).nullable(),
    amounts: z
      .object({
        fiberG: amountOrNone, sugarsG: amountOrNone, satFatG: amountOrNone, unsatFatG: amountOrNone, sodiumMg: amountOrNone,
        potassiumMg: amountOrNone, calciumMg: amountOrNone, ironMg: amountOrNone, magnesiumMg: amountOrNone, vitaminDUg: amountOrNone,
      })
      .strict(),
  })
  .strict();
export type DailyAmountsResponse = z.infer<typeof dailyAmountsResponseSchema>;

type Row = readonly [fiberG: number, calciumMg: number, ironMg: number, magnesiumMg: number, potassiumMg: number, vitaminDUg: number];
type Band = { upTo: number; words: string; row: Row };

const MEN: readonly Band[] = [
  { upTo: 18, words: "aged 18", row: [38, 1300, 11, 410, 3000, 15] },
  { upTo: 30, words: "aged 19 to 30", row: [38, 1000, 8, 400, 3400, 15] },
  { upTo: 50, words: "aged 31 to 50", row: [38, 1000, 8, 420, 3400, 15] },
  { upTo: 70, words: "aged 51 to 70", row: [30, 1000, 8, 420, 3400, 15] },
  { upTo: Infinity, words: "aged 71 and over", row: [30, 1200, 8, 420, 3400, 20] },
];
const WOMEN: readonly Band[] = [
  { upTo: 18, words: "aged 18", row: [26, 1300, 15, 360, 2300, 15] },
  { upTo: 30, words: "aged 19 to 30", row: [25, 1000, 18, 310, 2600, 15] },
  { upTo: 50, words: "aged 31 to 50", row: [25, 1000, 18, 320, 2600, 15] },
  { upTo: 70, words: "aged 51 to 70", row: [21, 1200, 8, 320, 2600, 15] },
  { upTo: Infinity, words: "aged 71 and over", row: [21, 1200, 8, 320, 2600, 20] },
];
const LABEL_DAILY_VALUES: Row = [28, 1300, 18, 420, 4700, 20];

const answer = (forWhom: string | null, [fiber, calcium, iron, magnesium, potassium, vitaminD]: Row): DailyAmountsResponse => {
  const about = (amount: number): DailyAmount => ({ kind: "about", amount });
  const amounts: Record<MoreNutrient, DailyAmount | null> = {
    fiberG: about(fiber), sugarsG: null, satFatG: { kind: "most", amount: 20 }, unsatFatG: null, sodiumMg: { kind: "most", amount: 2300 },
    potassiumMg: about(potassium), calciumMg: about(calcium), ironMg: about(iron), magnesiumMg: about(magnesium), vitaminDUg: about(vitaminD),
  };
  return { forWhom, amounts };
};

/** The amounts for a person's age and gender answers. The tables are by sex, so "other", "prefer not
 *  to say", an unanswered age or gender, or an age kept from before the app was 18 and over reads the labels' Daily Values, never a guessed sex's row. */
export function dailyAmountsFor(age: number | null, gender: Gender | null): DailyAmountsResponse {
  if (age === null || age < 18 || (gender !== "male" && gender !== "female")) return answer(null, LABEL_DAILY_VALUES);
  const bands = gender === "male" ? MEN : WOMEN;
  const band = bands.find((b) => age <= b.upTo);
  // Infinity closes both lists; an age that is not a number finds no band.
  if (band === undefined) return answer(null, LABEL_DAILY_VALUES);
  return answer(`${gender === "male" ? "men" : "women"} ${band.words}`, band.row);
}
