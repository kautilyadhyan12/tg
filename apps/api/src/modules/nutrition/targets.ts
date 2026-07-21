// Nutrition targets — a verbatim port of the Mifflin-St Jeor calculator in
// backend-ml/app/routers/nutrition.py:98-179 (`calculate_targets`).
//
// Part 0 rule 4 / R5.4: every constant carries its source line. Nothing here is
// re-derived, re-tuned, or "improved" — the goldens in nutrition.unit.test.ts
// are hand-computed from these same lines.
//
// DELIBERATELY NOT PORTED:
//  · the lbs→kg (:115-118) and ft→cm (:120-123) branches — legacy Mongo stored
//    {value, unit} documents; the new API is metric-only (users.weight_kg,
//    user_fitness_profiles.height_cm), so there is no unit to inspect.
//  · the weight 70 / height 170 / age 25 / gender "male" defaults (:103-106)
//    and the `using_defaults` output flag (:178). A fabricated target renders
//    identically to a real one, which is the exact class of default the Card-7
//    F2 ruling struck down. Kd ruled (this card) that a profile missing any
//    required input yields NO targets and an honest list of what is missing.
//  · fiber_g (:176) and water_ml (:177) — command-verified: nothing in
//    apps/web/src renders a fibre or water target, so porting them would add
//    dead surface (R1.1).
//
// ROUNDING: Python's round() is half-to-even and JS Math.round is half-up —
// the measure-zero divergence class already ruled at DECISIONS 2026-07-07.
// As in the salvage, all arithmetic stays in floats and rounds ONCE at the end.

// Through the module's own seam (./schemas.js), not straight from @app/shared —
// R7.1, and the T3 round-1 fix was incomplete without it.
import {
  missingTargetInputSchema,
  nutritionTargetsResponseSchema,
  type MissingTargetInput,
  type NutritionTargets,
  type NutritionTargetsResponse,
} from "./schemas.js";

/** Days per week → activity multiplier (nutrition.py:140-141). The salvage's
 *  other map — the "1-2"/"3-4"/"5-6"/"daily" strings at :132-137 — is
 *  UNREACHABLE on new data: `user_fitness_profiles.exercise_frequency` is an
 *  integer column (identity.ts:132), so only these keys can ever arrive. */
export const ACTIVITY_BY_FREQUENCY: Readonly<Record<number, number>> = {
  1: 1.2,
  2: 1.375,
  3: 1.375,
  4: 1.55,
  5: 1.55,
  6: 1.725,
  7: 1.9,
};

/** The salvage's `.get(frequency, 1.55)` fallback (:143). Kept because R5.4
 *  requires porting it verbatim — NOT because a live bypass exists.
 *
 *  Accurately: Zod is currently the SOLE writer of `exercise_frequency`
 *  (upsertFitnessProfile ← the PUT's `.min(1).max(7).nullable()`,
 *  users.ts:141), so the fallback is defensive only. There is no DB CHECK
 *  behind it (migration 0006 declares a bare integer; the table's only CHECKs
 *  are gender/fitness_level/preferred_workout_time), so it earns its keep the
 *  day a second writer appears — degrading an out-of-range integer to the
 *  ported default instead of NaN (I6).
 *
 *  This comment has now been WRONG TWICE in opposite directions: it first
 *  claimed a DB CHECK that does not exist (T3 round 3), and the correction
 *  then claimed P2.7-migrated rows bypass Zod — also false, the migrator never
 *  writes this table at all (INVENTORY.md:45 drops the onboarding fields;
 *  collections/users.ts:80 inserts only `users` columns). T3 round 6. */
const DEFAULT_ACTIVITY = 1.55;

/** Kd ruling (this card): all five move the number materially — frequency
 *  alone swings it ~700 kcal (1.2 vs 1.9). `fitnessGoals` is NOT required: the
 *  salvage has a real no-adjustment branch (:152-153), so an empty list is an
 *  answer, not an omission.
 *
 *  DERIVED from the shared contract, never re-declared (R7.2) — the response
 *  shape lives once in packages/shared and this list must not be able to drift
 *  from the `missing[]` values the client is typed against.
 *
 *  Copied and frozen, not aliased: zod 3's `.options` getter hands back the
 *  schema's own internal array, so exporting it directly made the shared
 *  contract mutable at runtime — a consumer's `.sort()` would reorder it in
 *  place (T3 round 3 F10). */
export const REQUIRED_TARGET_INPUTS: readonly MissingTargetInput[] = Object.freeze([
  ...missingTargetInputSchema.options,
]);

export interface TargetInputs {
  age: number | null;
  gender: string | null;
  heightCm: number | null;
  weightKg: number | null;
  exerciseFrequency: number | null;
  fitnessGoals: string[];
}

// NutritionTargets / MissingTargetInput / NutritionTargetsResponse are NOT
// declared here — they are the shared contract (R7.2). TargetInputs above is
// genuinely internal: it is the calculator's INPUT, never serialized.

/** Every required input present — the shape `calculateTargets` can act on. */
export interface ResolvedTargetInputs {
  age: number;
  gender: string;
  heightCm: number;
  weightKg: number;
  exerciseFrequency: number;
  fitnessGoals: string[];
}

export function missingTargetInputs(input: TargetInputs): MissingTargetInput[] {
  // `satisfies` makes enum COVERAGE a compile-time check. A plain
  // `input[key] === null` filter caught only the enum SHRINKING: a key added to
  // the shared enum whose TargetInputs field cannot BE null would compile,
  // never compare equal to null, and so be silently unenforced — a "required"
  // input that never blocks a target.
  //
  // The constraint asserts NULLABILITY, not a value union (T3 round 4 F1): the
  // round-3 version used `Record<MissingTargetInput, number | string | null>`,
  // which rejected its own worked example (`fitnessGoals: string[]`) by
  // array-ness while still admitting any non-nullable `string` or `number` —
  // it closed the example, not the class. `null extends TargetInputs[K]` is the
  // real question, so a non-nullable field now collapses to `never` and fails
  // the build. Probed both ways before and after.
  const required = {
    age: input.age,
    gender: input.gender,
    heightCm: input.heightCm,
    weightKg: input.weightKg,
    exerciseFrequency: input.exerciseFrequency,
  } satisfies {
    [K in MissingTargetInput]: K extends keyof TargetInputs
      ? null extends TargetInputs[K]
        ? TargetInputs[K]
        : never
      : never;
  };
  // NB the `satisfies` closes the TYPE-level shapes; a projection that
  // launders an absent value (`input.x ?? "default"` written into this
  // literal) would still satisfy it. That shape is closed by TESTS — the
  // literal-five assertion and the all-five-null case — not by the compiler.
  //
  // `== null`, not `=== null` (T3 round 5): `null extends string | null |
  // undefined` is TRUE, so the mapped type above admits an OPTIONAL field —
  // and `undefined === null` is false, so an absent value would never be
  // reported missing. Today every field arrives `?? null` from
  // users/service.ts, so nothing is broken; a sixth field added there without
  // the `?? null` would have been. Loose null-check covers both absences and
  // is the existing repo idiom (users/repo.ts:255).
  return REQUIRED_TARGET_INPUTS.filter((key) => required[key] == null);
}

export function calculateTargets(input: ResolvedTargetInputs): NutritionTargets {
  const { age, gender, heightCm, weightKg, exerciseFrequency, fitnessGoals } = input;

  // BMR, Mifflin-St Jeor (:126-129). ONLY "female" takes −161; male, other and
  // prefer_not_to_say all fall to the salvage's `else` (+5). Mifflin-St Jeor
  // defines two formulas, so inventing a third for the non-binary values would
  // be re-deriving a constant — recorded in DECISIONS rather than guessed.
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (gender === "female" ? -161 : 5);

  const tdee = bmr * (ACTIVITY_BY_FREQUENCY[exerciseFrequency] ?? DEFAULT_ACTIVITY); // :143,:145

  // Goal adjustment (:148-153): weight_loss is tested FIRST.
  const goals = new Set(fitnessGoals);
  const adjusted = goals.has("weight_loss")
    ? tdee - 400
    : goals.has("muscle_gain")
      ? tdee + 300
      : tdee;
  const kcal = Math.max(adjusted, 1200); // :155

  // Macro split (:158-167). NB the protein branch tests muscle_gain FIRST —
  // the OPPOSITE precedence to the kcal adjustment above. With both goals set
  // they disagree by design of the original: kcal cuts 400 while protein uses
  // the bulking 2.2 g/kg. Ported as-is and pinned by a unit test; "tidying" it
  // into consistency would change behaviour without a ruling (R5.4).
  const proteinPerKg = goals.has("muscle_gain") ? 2.2 : goals.has("weight_loss") ? 2.0 : 1.6;
  const proteinG = weightKg * proteinPerKg;
  const fatG = (kcal * 0.25) / 9;
  const carbsG = (kcal - proteinG * 4 - fatG * 9) / 4;

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    kcal: Math.round(kcal),
    proteinG: Math.round(proteinG),
    carbsG: Math.round(Math.max(carbsG, 50)), // :174
    fatG: Math.round(fatG),
  };
}

/** The one entry point the service uses: targets, or an honest account of what
 *  the user still has to fill in. Never both — enforced HERE by parsing through
 *  the shared contract's refine(), so every caller gets the guarantee. (T3
 *  round 3 F3: the parse used to live only in the service, while this exported,
 *  directly-unit-tested function promised an enforcement it did not perform.) */
export function resolveTargets(input: TargetInputs): NutritionTargetsResponse {
  return nutritionTargetsResponseSchema.parse(resolveTargetsUnchecked(input));
}

function resolveTargetsUnchecked(input: TargetInputs): NutritionTargetsResponse {
  // THE decision, taken once, off the derived list (T3 round 2): an earlier
  // version gated on its own hand-written null chain, which could disagree
  // with REQUIRED_TARGET_INPUTS if the shared enum ever lost a key.
  const missing = missingTargetInputs(input);
  if (missing.length > 0) return { targets: null, missing };

  const { age, gender, heightCm, weightKg, exerciseFrequency } = input;
  if (age === null || gender === null || heightCm === null || weightKg === null || exerciseFrequency === null) {
    // Unreachable while REQUIRED_TARGET_INPUTS covers every field the
    // calculator reads — this is the type bridge (R2.2 bans a cast). It also
    // alarms on enum SHRINK specifically: drop a key from the shared enum and
    // the old code would have computed a target with that null coerced to 0 —
    // a fabricated number, the one outcome this card exists to prevent. (Enum
    // GROWTH is caught earlier, at the `satisfies` in missingTargetInputs;
    // this chain does not cover it — T3 round 3 F2 corrected the overclaim.)
    // Fail loud (R1.3): a 500 beats a plausible-looking wrong calorie goal.
    throw new Error("targets: REQUIRED_TARGET_INPUTS does not cover every calculator input");
  }
  return {
    targets: calculateTargets({ age, gender, heightCm, weightKg, exerciseFrequency, fitnessGoals: input.fitnessGoals }),
    missing,
  };
}
