// ROADMAP 7a-iv-e — the words and sums behind the switch over the macro rings.
// Apart from the component (RingNumbers.jsx) so both can be read and tested on
// their own, as `measures.js` sits apart from MeasurePicker — and named for the
// targets rather than the component, since a file differing only in case is the
// same file on Windows and the default export vanishes into the helpers.

/** What the three macros come to in calories — said beside the calories box,
 *  never enforced: the four numbers are the person's, and a box that rewrites
 *  one of them as you type another is a box that fights you. */
export const macroKcal = (v) => v.proteinG * 4 + v.carbsG * 4 + v.fatG * 9;

/** A calorie figure written as "1,940 kcal" in every browser: the words around
 *  it are English, and the server's refusal beside it writes "1,940" too, so a
 *  German "1.940" here would print one number two ways on one screen. */
export const kcalText = (n) => `${n.toLocaleString('en-US')} kcal`;

/** Why the person's stored numbers cannot feed the rings today, in their words.
 *  The server says so whether they picked the numbers or left them behind
 *  "App's plan", so every line here must be true either way: none says WHY the
 *  rings are on the app's plan, only what stops these numbers. Every branch
 *  names the number that would let them in — the SERVER decides which one
 *  holds (nutrition/targets.ts `ownTargetsHeld`); this only says it. */
export function holdText(held) {
  if (held === null || held === undefined) return null;
  if (held.code === 'below_floor') {
    return `The rings cannot use your own calories below the app's floor of ${kcalText(held.floorKcal)}.`;
  }
  if (held.code === 'no_cut_below_maintenance') {
    return `Your plan holds no calorie cut now, so the rings cannot use your own calories below ${kcalText(held.maintenanceKcal)} — what keeps your weight.`;
  }
  if (held.code === 'plan_incomplete') {
    return 'Your own numbers are kept: answer the setup questions to use them.';
  }
  // A reason this build does not know the words for is still a reason the
  // numbers cannot be used, and saying nothing would be the lie.
  return 'The rings cannot use your own numbers just now.';
}
