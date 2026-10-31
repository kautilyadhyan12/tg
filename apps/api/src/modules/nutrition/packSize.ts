// How much a whole pack holds, read from the size printed on the list ("400 g", "4 x 125 g"), for the
// whole pack as an amount (ROADMAP Stage 5 33b-iii-b). The size is typed by volunteers, so the rule is
// structural: every weight in it must come to one total, and anything left over that is not a word of
// a net weight means the size is not understood, and no whole pack is offered.
import { MAX_ITEM_GRAMS } from "@app/shared";

const WEIGHT_UNITS: Readonly<Record<string, number>> = {
  g: 1, gr: 1, grs: 1, gram: 1, grams: 1, gramm: 1, gramme: 1, grammes: 1, "г": 1, "гр": 1,
  kg: 1000, kgs: 1000, kilo: 1000, kilos: 1000, "кг": 1000,
};
const VOLUME_UNITS: Readonly<Record<string, number>> = {
  ml: 1, mls: 1, "мл": 1, cl: 10, dl: 100,
  l: 1000, lt: 1000, ltr: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000, "л": 1000,
};
/** Printed beside the metric figure on US packs, and rounded there: the metric one is the label's. */
const IMPERIAL_UNITS: Readonly<Record<string, { per: number; volume: boolean }>> = {
  oz: { per: 28.35, volume: false }, lb: { per: 453.6, volume: false }, lbs: { per: 453.6, volume: false }, "fl oz": { per: 29.57, volume: true },
};
const WEIGHT = /(?<![\p{L}\d.,])(?:(\d{1,3})\s*[x×*]\s*)?(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz|\p{L}+)\.?(?![\p{L}\d])/gu;
/** Words of a net weight, in the languages the list holds most of. Any other word stops the rule. */
const NET_WORDS = new Set(["net", "netto", "neto", "nett", "wt", "weight", "poids", "e", "℮", "contents", "contenu"]);
/** Two ways of writing one pack, in ounces and grams, as a label rounds them. */
const AGREE_WITHIN = 0.05;

function numberOf(text: string): number {
  // "1.000 g" is a kilogram in Germany and a gram with three decimals nowhere, but "1,500 g" is read
  // both ways: a separator before exactly three digits is not guessed at.
  if (/[.,]\d{3}$/.test(text)) return Number.NaN;
  return Number(text.replace(",", "."));
}

export interface PackSize {
  /** The lists count a millilitre as a gram. */
  grams: number;
  /** Printed only as a volume, so `grams` is not a weight. */
  volume: boolean;
}

/** What a whole pack holds, or null where the size is not understood. */
export function packSize(quantity: string | null | undefined): PackSize | null {
  if (quantity === null || quantity === undefined) return null;
  const text = quantity.toLowerCase().slice(0, 60);
  const figures: { total: number; volume: boolean; metric: boolean }[] = [];
  const left = text.replace(WEIGHT, (whole: string, times: string | undefined, amount: string, written: string) => {
    const unit = written.replace(/\./g, "").replace(/\s+/g, " ");
    const count = Number(times ?? "1");
    const weight = WEIGHT_UNITS[unit];
    const volume = VOLUME_UNITS[unit];
    const imperial = IMPERIAL_UNITS[unit];
    const per = weight ?? volume ?? imperial?.per;
    if (per === undefined) return whole;
    figures.push({ total: numberOf(amount) * per * count, volume: volume !== undefined || imperial?.volume === true, metric: imperial === undefined });
    return " ";
  });
  const first = figures[0];
  if (first === undefined || figures.some((f) => Number.isNaN(f.total))) return null;
  const words = left.split(/[^\p{L}\p{N}℮]+/u).filter((w) => w !== "");
  if (words.some((w) => !NET_WORDS.has(w))) return null;
  if (figures.some((f) => Math.abs(f.total - first.total) > first.total * AGREE_WITHIN)) return null;
  const grams = Math.round((figures.find((f) => f.metric) ?? first).total * 10) / 10;
  if (!(grams >= 1 && grams <= MAX_ITEM_GRAMS)) return null;
  return { grams, volume: figures.every((f) => f.volume) };
}
