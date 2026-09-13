// The post-workout summary's WORDS — meal ideas, stretch suggestions and
// personal-record labels.
//
// Ported from `backend-ml/app/routers/workouts.py:598-639`, the old backend's
// `get_workout_summary`. Kd approved porting it as-is on 2026-08-06, having
// been told the spec names no home for either feature: a grep over `docs/spec`
// for "meal suggestion", "stretch" and "post-workout" returns MET values and a
// share-card flow, and nothing that specifies this. The stretches, the record
// labels, the muscle names, the calorie bands and their thresholds are still
// the Python file's, in the Python file's order.
//
// THE MEAL IDEAS ARE NO LONGER A VERBATIM PORT (RULINGS 2026-08-06, amended
// 2026-09-13). They follow the diet screen 9 stores (RULINGS 2026-09-10), so a
// vegan is never offered the chicken: where a diet rules an idea's food out,
// that food alone is swapped for one it allows. And their words are the
// market's: every timing counts from the workout (never "before bed" on a
// post-workout card), and the foods are what the US, Canada and Europe eat,
// never rice first. The seven lines and their swaps are written out on ROADMAP
// 4b-ii.
//
// WHY STRINGS AND NOT MESSAGE KEYS. v1 §14 wants message keys so hi/as is a
// translation task. These are English strings because that is what ships today
// and what the old screen renders; converting them to keys is the same
// translation task the exercise library's copy already carries (DECISIONS
// :4945), and it now has its own OWED line rather than being half-done here.
//
// WHY IT LIVES IN THE API AND NOT IN THE CLIENT. The selection depends on the
// workout's calories and its muscle groups, both of which are server-side facts
// (R3.1). The old backend chose server-side too; a client that picked its own
// meal ideas from a number it computed itself is the class of thing this
// project keeps deleting.
import { EXERCISE_CONTENT, type Diet, type MealSuggestion } from "@app/shared";

/** The diets as a ladder, each allowing everything the one below it does and
 *  one thing more (`dietSchema`): vegan, then dairy, then eggs, then meat and
 *  fish. */
const DIET_LADDER: Record<Diet, number> = { vegan: 0, vegetarian: 1, vegetarian_eggs: 2, non_vegetarian: 3 };

/** One meal idea. `meal` is eaten as it is by `fitsFrom` and every diet above
 *  it; `swap` is the same idea for the diets below, with only the food they
 *  rule out changed. An idea every diet can eat has none. */
interface MealIdea {
  meal: string;
  timing: string;
  fitsFrom: Diet;
  swap: string | null;
}

/** Three calorie bands, as workouts.py:600-615 had them. The thresholds are
 *  `> 400` and `> 200` on the workout's kcal figure; the words are RULINGS
 *  2026-09-13's. */
const HIGH_BAND: readonly MealIdea[] = [
  { meal: "Protein shake + banana", timing: "Within 30 mins", fitsFrom: "vegetarian", swap: "Plant protein shake + banana" },
  { meal: "Grilled chicken + potatoes + vegetables", timing: "Within 2 hours", fitsFrom: "non_vegetarian", swap: "Grilled tofu + potatoes + vegetables" },
  { meal: "Greek yogurt with berries", timing: "Later today", fitsFrom: "vegetarian", swap: "Soy yogurt with berries" },
];
const MIDDLE_BAND: readonly MealIdea[] = [
  { meal: "Protein shake or chocolate milk", timing: "Within 30 mins", fitsFrom: "vegetarian", swap: "Plant protein shake or soy chocolate milk" },
  { meal: "Eggs + whole grain toast + avocado", timing: "Within 2 hours", fitsFrom: "vegetarian_eggs", swap: "Tofu scramble + whole grain toast + avocado" },
];
const LOW_BAND: readonly MealIdea[] = [
  { meal: "Banana + peanut butter", timing: "Within 30 mins", fitsFrom: "vegan", swap: null },
  { meal: "Light salad with grilled protein", timing: "Within 2 hours", fitsFrom: "non_vegetarian", swap: "Light salad with chickpeas" },
];

/** Every idea, for the test that holds each to the ladder. */
export const MEAL_IDEA_BANDS = { high: HIGH_BAND, middle: MIDDLE_BAND, low: LOW_BAND } as const;

/** The workout's band of ideas, in the words the person's diet allows.
 *
 *  NO DIET ANSWER READS AS THE STRICTEST DIET, so every idea is one anybody
 *  can eat: a guessed "non-vegetarian" is the one guess that would put meat in
 *  front of a vegetarian (RULINGS 2026-07-15: unanswered is never a default). */
export function mealSuggestionsFor(caloriesBurned: number | null, diet: Diet | null): MealSuggestion[] {
  // Python read `session.get("calories_burned", 0)`, so an absent figure took
  // the lowest band rather than producing no suggestions. NULL is that case.
  const kcal = caloriesBurned ?? 0;
  const band = kcal > 400 ? HIGH_BAND : kcal > 200 ? MIDDLE_BAND : LOW_BAND;
  const level = diet === null ? 0 : DIET_LADDER[diet];
  return band.map((idea) => {
    if (level >= DIET_LADDER[idea.fitsFrom]) return { meal: idea.meal, timing: idea.timing };
    // Never the idea's own words in place of a missing swap: that fallback is the
    // chicken offered to a vegan this function exists to prevent.
    if (idea.swap === null) throw new Error(`meal idea "${idea.meal}" has no swap for a diet below ${idea.fitsFrom}`);
    return { meal: idea.swap, timing: idea.timing };
  });
}

/** Primary muscles of the exercises in a workout, by catalog slug.
 *
 *  The old backend read `muscles_primary` off the session's EMBEDDED exercise
 *  documents. The new API stores exercise references, not copies, so the muscle
 *  names come from `EXERCISE_CONTENT` — the same verbatim seed port the exercise
 *  library reads (DECISIONS :4945), which carries `musclesPrimary` in exactly
 *  the seed's spelling. That matters: the rules below match on those exact
 *  strings ("Quadriceps", "Glutes", …), so a re-spelled name would silently
 *  stop matching and every workout would fall through to the generic list. */
const MUSCLES_BY_SLUG = new Map<string, readonly string[]>(
  EXERCISE_CONTENT.map((e) => [e.slug, e.musclesPrimary]),
);

export function primaryMusclesFor(slugs: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const slug of slugs) {
    // A slug with no content row contributes nothing rather than throwing —
    // the catalog and the content file are proven total against each other, so
    // this is the guard for the 59th exercise, not a live path.
    for (const m of MUSCLES_BY_SLUG.get(slug) ?? []) out.add(m);
  }
  return out;
}

/** workouts.py:617-639 — muscle-group rules in the source's order, with the
 *  same fallback when none match. */
export function stretchesFor(muscleGroups: ReadonlySet<string>): string[] {
  const stretches: string[] = [];
  if (muscleGroups.has("Quadriceps") || muscleGroups.has("Glutes")) {
    stretches.push("Hip flexor stretch — 30 seconds each side");
  }
  if (muscleGroups.has("Chest") || muscleGroups.has("Shoulders")) {
    stretches.push("Chest doorway stretch — 30 seconds");
  }
  if (muscleGroups.has("Hamstrings")) {
    stretches.push("Seated hamstring stretch — 45 seconds");
  }
  if (muscleGroups.has("Abs") || muscleGroups.has("Obliques")) {
    stretches.push("Cat-cow stretch — 10 reps");
  }
  if (stretches.length === 0) {
    return [
      "Full body stretch — 5 minutes",
      "Child's pose — 30 seconds",
      "Neck rolls — 10 each direction",
    ];
  }
  return stretches;
}

/** workouts.py:562-586 — the three record labels, in the source's order.
 *
 *  THE ONE DELIBERATE DIFFERENCE FROM THE PORT, named rather than discovered
 *  later: Python re-queried "the best OTHER session" per record and used `>=`,
 *  so a TIE claimed the record for both workouts. Here the record holder is the
 *  single row `/v1/progress/records` already names (`ORDER BY … DESC, started_at
 *  DESC LIMIT 1`), so a tie is claimed by the later workout only. Reusing that
 *  one query is the point: the summary and the records screen cannot disagree
 *  about who holds a record, which two independent queries eventually would.
 *
 *  Python also required the value to be > 0 before claiming a record; that is
 *  preserved by the records query itself, which skips NULL columns, plus the
 *  explicit `value > 0` test below. */
export interface RecordHolders {
  maxKcalWorkoutId: string | null;
  longestWorkoutId: string | null;
  bestAvgFormWorkoutId: string | null;
  maxKcalValue: number | null;
  longestValue: number | null;
  bestAvgFormValue: number | null;
}

export function personalRecordsFor(workoutId: string, holders: RecordHolders): string[] {
  const records: string[] = [];
  const holds = (id: string | null, value: number | null): boolean =>
    id === workoutId && value !== null && value > 0;
  if (holds(holders.longestWorkoutId, holders.longestValue)) {
    records.push("Longest workout session!");
  }
  if (holds(holders.bestAvgFormWorkoutId, holders.bestAvgFormValue)) {
    records.push("Best form accuracy!");
  }
  if (holds(holders.maxKcalWorkoutId, holders.maxKcalValue)) {
    records.push("Most calories burned!");
  }
  return records;
}
