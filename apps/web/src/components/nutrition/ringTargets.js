// ROADMAP 7a-iv-e — the words and sums behind the switch over the macro rings.
// Apart from the component (RingNumbers.jsx) so both can be read and tested on
// their own, as `measures.js` sits apart from MeasurePicker — and named for the
// targets rather than the component, since a file differing only in case is the
// same file on Windows and the default export vanishes into the helpers.

/** What the three macros come to in calories — said beside the calories box,
 *  never enforced: the four numbers are the person's, and a box that rewrites
 *  one of them as you type another is a box that fights you. */
export const macroKcal = (v) => v.proteinG * 4 + v.carbsG * 4 + v.fatG * 9;

/** Why stored, picked numbers are not the ones on the rings, in the person's
 *  words. Every branch names the number that would let them back in — the
 *  SERVER decides which one holds (nutrition/targets.ts `ownTargetsHeld`); this
 *  only says it. */
export function holdText(held) {
  if (held === null || held === undefined) return null;
  if (held.code === 'below_floor') {
    return `Your own calories are below the app's floor of ${held.floorKcal} kcal, so the rings are on the app's plan.`;
  }
  if (held.code === 'no_cut_below_maintenance') {
    return `Your plan holds no calorie cut now, so your own calories cannot be below ${held.maintenanceKcal} kcal — what keeps your weight. The rings are on the app's plan until you change them.`;
  }
  if (held.code === 'plan_incomplete') {
    return 'Your own numbers are waiting: answer the setup questions and they come back.';
  }
  // A reason this build does not know the words for is still a reason the rings
  // are not on the person's numbers, and saying nothing would be the lie.
  return "Your own numbers are on hold, so the rings are on the app's plan.";
}
