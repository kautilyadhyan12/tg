// How much a whole pack holds, read from the size printed on the list ("400 g", "4 x 125 g"), for the
// whole pack as an amount (ROADMAP Stage 5 33b-iii-b). The size is typed by volunteers, so the rule is
// structural: every weight in it must come to one total, and anything left over that is not a word of
// a net weight means the size is not understood, and no whole pack is offered.
import { MAX_ITEM_GRAMS } from "@app/shared";

const GRAMS_PER_UNIT: Readonly<Record<string, number>> = {
  g: 1, gr: 1, grs: 1, gram: 1, grams: 1, gramm: 1, gramme: 1, grammes: 1, "г": 1, "гр": 1,
  kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, "кг": 1000,
  ml: 1, mls: 1, "мл": 1, cl: 10, dl: 100,
  l: 1000, lt: 1000, ltr: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000, "л": 1000,
  oz: 28.35, "fl oz": 29.57, lb: 453.6, lbs: 453.6,
};
const WEIGHT = /(?<![\p{L}\d.,])(?:(\d{1,3})\s*[x×*]\s*)?(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz|\p{L}+)\.?(?![\p{L}\d])/gu;
/** Words of a net weight, in the languages the list holds most of. Any other word stops the rule. */
const NET_WORDS = new Set(["net", "netto", "neto", "nett", "wt", "weight", "poids", "e", "℮", "contents", "contenu"]);
/** Two ways of writing one pack, in ounces and grams, as a label rounds them. */
const AGREE_WITHIN = 0.05;

function numberOf(text: string): number | null {
  // "1.000 g" is a kilogram in Germany and a gram with three decimals nowhere, but "1,500 g" is read
  // both ways: a separator before exactly three digits is not guessed at.
  if (/[.,]\d{3}$/.test(text)) return null;
  return Number(text.replace(",", "."));
}

/** The grams (or millilitres, which the lists count alike) of a whole pack, or null. */
export function packGrams(quantity: string | null | undefined): number | null {
  if (quantity === null || quantity === undefined) return null;
  const text = quantity.toLowerCase().slice(0, 60);
  const totals: number[] = [];
  const left = text.replace(WEIGHT, (whole: string, times: string | undefined, amount: string, unit: string) => {
    const per = GRAMS_PER_UNIT[unit.replace(/\./g, "").replace(/\s+/g, " ")];
    const value = numberOf(amount);
    if (per === undefined) return whole;
    // A number not understood leaves the pack not understood.
    totals.push(value === null ? Number.NaN : value * per * Number(times ?? "1"));
    return " ";
  });
  if (totals.some(Number.isNaN)) return null;
  const first = totals[0];
  if (first === undefined) return null;
  const words = left.split(/[^\p{L}\p{N}℮]+/u).filter((w) => w !== "");
  if (words.some((w) => !NET_WORDS.has(w))) return null;
  if (totals.some((t) => Math.abs(t - first) > first * AGREE_WITHIN)) return null;
  const grams = Math.round(first * 10) / 10;
  return grams >= 1 && grams <= MAX_ITEM_GRAMS ? grams : null;
}
