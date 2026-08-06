// The post-workout summary's WORDS — meal ideas, stretch suggestions and
// personal-record labels.
//
// A VERBATIM PORT of `backend-ml/app/routers/workouts.py:598-639`, the old
// backend's `get_workout_summary`. Kd approved porting it as-is on 2026-08-06,
// having been told the spec names no home for either feature: a grep over
// `docs/spec` for "meal suggestion", "stretch" and "post-workout" returns MET
// values and a share-card flow, and nothing that specifies this. Under R0.2 the
// options were "port what exists" or "invent"; under the no-removal rule
// dropping it was never one. So: nothing here is authored, re-worded or
// improved. The bands, the thresholds, the muscle names and the strings are the
// Python file's, in the Python file's order.
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
import { EXERCISE_CONTENT, type MealSuggestion } from "@app/shared";

/** workouts.py:600-615 — three calorie bands, in the source's order. The
 *  thresholds are `> 400` and `> 200` on the workout's kcal figure. */
export function mealSuggestionsFor(caloriesBurned: number | null): MealSuggestion[] {
  // Python read `session.get("calories_burned", 0)`, so an absent figure took
  // the lowest band rather than producing no suggestions. NULL is that case.
  const kcal = caloriesBurned ?? 0;
  if (kcal > 400) {
    return [
      { meal: "Protein shake + banana", timing: "Within 30 mins" },
      { meal: "Grilled chicken + rice + vegetables", timing: "Within 2 hours" },
      { meal: "Greek yogurt with berries", timing: "1 hour before bed" },
    ];
  }
  if (kcal > 200) {
    return [
      { meal: "Protein shake or chocolate milk", timing: "Within 30 mins" },
      { meal: "Eggs + whole grain toast + avocado", timing: "Within 2 hours" },
    ];
  }
  return [
    { meal: "Banana + peanut butter", timing: "Within 30 mins" },
    { meal: "Light salad with grilled protein", timing: "Within 2 hours" },
  ];
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
