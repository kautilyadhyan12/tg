import type { MoreNutrient } from "@app/shared";
import { jarFill } from "./figures";

// The Nutrients pantry's fill levels (32c-ii-a), apart from the pictures so a test can read them.

/** Where the fill's top lies for a share of 0, 0.05, 0.1 … 1 of each picture's AREA, so a quarter of a
 *  cheese holds a quarter of it, never a quarter of its height (round one, H2). Measured in headless Edge
 *  on 2026-11-14: each body drawn at 20 times its size and the level found below which that share of its
 *  dots lies. A shape changed in NutrientJar.tsx is measured again. */
export const LEVELS: Readonly<Record<MoreNutrient, readonly number[]>> = {
  fiberG: [46, 38.8, 31.8, 28.7, 27.2, 25.9, 24.7, 23.5, 22.1, 20.6, 19.3, 18, 16.6, 15.1, 13.8, 12.5, 11.1, 9.9, 8.7, 6.6, 2.4],
  sugarsG: [43, 37.9, 35.8, 34.2, 32.7, 31.3, 29.8, 28.4, 26.9, 25.5, 24, 22.5, 21.1, 19.6, 18.2, 16.7, 15.3, 13.8, 12.2, 10.1, 5],
  satFatG: [38, 37.2, 36.4, 35.5, 34.7, 33.8, 32.9, 31.9, 31, 30, 28.9, 27.9, 26.8, 25.6, 24.3, 23, 21.7, 20.2, 18.5, 16.3, 11],
  unsatFatG: [44, 40.9, 38.9, 37.3, 35.8, 34.3, 32.9, 31.5, 30.2, 28.8, 27.5, 26.1, 24.7, 23.2, 21.6, 20, 18.1, 16.1, 13.8, 10.9, 4.1],
  sodiumMg: [44, 42, 40.3, 38.5, 36.8, 35.1, 33.3, 31.6, 29.9, 28.1, 26.4, 24.7, 23, 21.2, 19.4, 17.4, 15.5, 13.6, 11.6, 9.3, 6],
  potassiumMg: [44, 38.9, 37.8, 37, 36.2, 35.4, 34.8, 34.1, 33.4, 32.8, 32.1, 31.1, 29.5, 27.5, 25.1, 22.5, 19.7, 16.6, 13.2, 9.8, 6],
  calciumMg: [46, 43.8, 42, 40.1, 38.3, 36.4, 34.6, 32.7, 30.9, 29, 27.2, 25.4, 23.5, 21.7, 19.8, 18, 16.1, 14, 11.3, 7.7, 4],
  ironMg: [45, 39.7, 37.1, 35, 33.1, 31.3, 29.6, 28, 26.4, 24.9, 23.4, 21.9, 20.3, 18.8, 17.3, 15.7, 14.2, 12.5, 10.7, 8.7, 5.6],
  magnesiumMg: [44, 40.4, 38.3, 36.4, 34.6, 33, 31.4, 29.9, 28.4, 26.9, 25.4, 24, 22.5, 20.9, 19.4, 17.7, 16, 14.1, 12, 9.4, 4],
  vitaminDUg: [46, 38.8, 35.8, 32.1, 30.4, 29, 27.8, 26.6, 25.4, 24.7, 24, 23.3, 22.6, 21.4, 20.2, 19, 17.6, 15.9, 12.2, 9.2, 2],
};

/** Where the fill's top lies, for a fill from 0 (empty) to 1 (full): between two measured shares, a
 *  straight line. */
export const fillLevel = (key: MoreNutrient, fill: number): number => {
  const levels = LEVELS[key];
  const at = Math.min(1, Math.max(0, fill)) * (levels.length - 1);
  const low = Math.floor(at);
  const from = levels[low] ?? 0;
  const to = levels[Math.min(levels.length - 1, low + 1)] ?? from;
  return from + (to - from) * (at - low);
};

/** The fill as drawn: its level and the swell of its wave; none at all for no share or a share of 0. The
 *  wave's crest and trough are equal, so it holds what a flat top would; near the foot it is no taller than
 *  the fill under it, so a little never shows as more (round one, H2). */
export function fillTop(key: MoreNutrient, share: number | null): { level: number; swell: number } | null {
  const fill = jarFill(share);
  if (share === null || fill <= 0) return null;
  const level = fillLevel(key, fill);
  return { level, swell: Math.min(2.6, 2 * (fillLevel(key, 0) - level)) };
}
