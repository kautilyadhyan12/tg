// An indoor run's words (ROADMAP Stage 5 item 37q-ii-a): where its distance is from, and what the Treadmill distance box
// says of the distance typed. Pure, so each case is tested.
import { recordSpeed, type RunDistanceFrom, type Units } from "@app/shared";
import { METRES_PER_MILE, distance, unitWord } from "./runWords";

/** The line under an indoor run's distance. */
export function indoorFromWords(from: RunDistanceFrom, steps: number, stepsOff: boolean): string {
  if (from === "treadmill") return "Indoor · from the treadmill";
  if (stepsOff || steps <= 0) return "Indoor · no steps counted";
  return "Indoor · from your steps";
}

/** What was typed in the Treadmill distance box, in metres: a number in the person's units ("5.2", "5,20"); null for
 *  nothing, nothing more than 0, or what is not a number. Up to the next whole metre: a distance is shown rounded down
 *  (`distance`), and 3.11 miles, 5,005.06 m, must read 3.11 again, never 3.10. */
export function typedMetres(text: string, units: Units): number | null {
  const plain = text.trim().replace(",", ".");
  if (!/^\d{0,4}(\.\d{0,3})?$/.test(plain) || plain === "" || plain === ".") return null;
  const value = Number(plain);
  if (!Number.isFinite(value) || value <= 0) return null;
  // Less a millionth of a metre, so 5.2 km (5,200.000000000001 m in floating point) is 5,200, not 5,201.
  return Math.ceil(value * (units === "imperial" ? METRES_PER_MILE : 1000) - 1e-6);
}

/** What the box says once a distance is typed: taken, and how far the steps had said; or why the run keeps its steps'
 *  distance, as the server judges it (`treadmillTaken`). Null with nothing typed. */
export function treadmillWords(look: { typedM: number | null; taken: boolean; stepsM: number; movingS: number; units: Units }): { text: string; good: boolean } | null {
  const { typedM, taken, stepsM, movingS, units } = look;
  if (typedM === null) return null;
  const word = unitWord(units);
  if (taken) {
    const steps = stepsM >= 10 ? ` Your steps said ${distance(stepsM, units)} ${word}.` : "";
    return { text: `Your run is ${distance(typedM, units)} ${word}, from the treadmill.${steps}`, good: true };
  }
  const keeps = `Your run keeps ${distance(stepsM, units)} ${word}.`;
  if (movingS > 0 && typedM / movingS > recordSpeed(movingS)) return { text: `That's faster than anyone has run. ${keeps}`, good: false };
  return { text: `That's far ${typedM > stepsM ? "more" : "less"} than your steps show. ${keeps}`, good: false };
}
