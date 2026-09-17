// The macro rings' numbers (GET /v1/nutrition/targets). Since ROADMAP Stage 1
// item 4a-iii they ARE the plan's: the same stored answers, the same calculator
// (plan/maths.ts) and the one function the onboarding routes read too
// (users/service `getUserPlanAndCutRules`, which is their own `planOf`), so the
// app can never show two daily numbers. Since 7a-iv-e they can be the person's
// OWN numbers instead, picked
// on the switch over the rings (RULINGS 2026-09-17) — and this file is where
// the two sets are resolved into the one the rings show.
//
// The first calculator here — a port of the old nutrition.py that read the
// profile's days a week as an activity factor and cut a fixed 400 kcal (or
// added 300) — is retired with that move. Its resting burn, calorie floor and
// macro split were already the plan calculator's.
import { CALORIE_FLOOR_KCAL } from "../plan/maths.js";
import { nutritionTargetsResponseSchema } from "./schemas.js";
import type {
  NoDeficitReason,
  NutritionTargets,
  NutritionTargetsResponse,
  OwnNutritionTargets,
  OwnTargetsHeld,
  PlanNumbers,
  PlanResponse,
  RingTargetsSource,
} from "./schemas.js";

/** What a person picked over the rings, as the store holds it. */
export interface RingPick {
  source: RingTargetsSource;
  own: OwnNutritionTargets | null;
}

/** The plan as the rings' numbers, or null: the plan's own list of what is
 *  still missing, or a target on the wrong side of the weight.
 *
 *  A target on the wrong side of the weight (a loss target kept when the
 *  weight choice changed to Gain weight, or a weight that reached its target)
 *  leaves the plan holding the weight. The rings do not pass that off as the
 *  goal's number, nor call the target unanswered, since the person has one:
 *  they ask for a new one, and their link opens the target screen, which
 *  names it and offers only the goal's side (RULINGS 2026-09-11). */
function appTargetsFrom(plan: PlanNumbers | null, targetWrongSide: boolean): NutritionTargets | null {
  return plan === null || targetWrongSide
    ? null
    : {
        bmr: plan.restingBurnKcal,
        tdee: plan.dailyBurnKcal,
        kcal: plan.targetKcal,
        proteinG: plan.proteinG,
        carbsG: plan.carbsG,
        fatG: plan.fatG,
        noCalorieCut: plan.flags.some((f) => f.code === "no_deficit"),
      };
}

/** THE rule on a number a person types for themselves (ROADMAP 7a-iv-e;
 *  RULINGS 2026-09-17: "the health rules hold for typed numbers"), and the one
 *  the write and the read both run.
 *
 *  Run on EVERY READ, not only when the number is saved, because the answers
 *  under it move: the health question can be answered yes tomorrow, a birthday
 *  passes, a heavier body raises what keeps the weight. A number that was
 *  allowed in March must not go on feeding the rings in June once the rule it
 *  passed no longer holds — and the person's own numbers are never rewritten or
 *  dropped to make that true, so the hold is reported and the app's plan shows
 *  instead (`ownHeld` on the contract).
 *
 *  Two bounds, and the higher of them binds:
 *    · the app's calorie floor, which no plan of ours goes under;
 *    · what keeps the weight (the plan's daily burn) for a person whose plan
 *      holds no calorie cut at all — under 18, a yes on the health question, or
 *      Safe mode. `noCutReasons` carries those reasons for EVERY weight choice,
 *      not only a "lose" plan, which is why it is passed in rather than read
 *      off the plan's own `no_deficit` flag.
 *  Nothing else is refused: the macros are the person's to set, and the
 *  contract's rails already keep all four inside a day a body could eat. */
export function ownTargetsHeld(
  own: OwnNutritionTargets,
  plan: PlanNumbers | null,
  noCutReasons: readonly NoDeficitReason[],
): OwnTargetsHeld | null {
  // No plan, no rule to check against — and no resting burn for the rings
  // either, so the person's numbers wait for the questions to be answered.
  if (plan === null) return { code: "plan_incomplete" };
  const noCut = noCutReasons.length > 0;
  const maintenanceKcal = plan.dailyBurnKcal;
  const minKcal = Math.max(CALORIE_FLOOR_KCAL, noCut ? maintenanceKcal : 0);
  if (own.kcal >= minKcal) return null;
  return noCut && maintenanceKcal > CALORIE_FLOOR_KCAL
    ? { code: "no_cut_below_maintenance", maintenanceKcal, reasons: [...noCutReasons] }
    : { code: "below_floor", floorKcal: CALORIE_FLOOR_KCAL };
}

/** The rings' answer: both sets, which one is showing, and why the person's own
 *  is not where it is stored and picked. Parsed through the shared contract, so
 *  "a number exactly when there is no reason against one" — and "the source and
 *  the numbers agree" — hold for every caller. */
export function targetsFromPlan(
  result: PlanResponse,
  pick: RingPick = { source: "app", own: null },
  noCutReasons: readonly NoDeficitReason[] = [],
): NutritionTargetsResponse {
  const plan = result.plan;
  const targetWrongSide = plan !== null && plan.flags.some((f) => f.code === "target_wrong_direction");
  const appTargets = appTargetsFrom(plan, targetWrongSide);
  // A hold is only ever about the set the person PICKED: numbers kept behind a
  // switch that says "App's plan" are not being held back from anything.
  const picked = pick.source === "own" ? pick.own : null;
  const held = picked === null ? null : ownTargetsHeld(picked, plan, noCutReasons);
  // held === null with a picked set means the plan is there (no plan is a hold
  // of its own), so the burn figures below are always readable.
  const own = held === null ? picked : null;
  return nutritionTargetsResponseSchema.parse({
    // The picked set. A wrong-side target does not blank the rings for someone
    // showing their OWN numbers: the stale target is the app plan's business,
    // and the switch is exactly the way out of it. The plan is still read —
    // `bmr` and `tdee` are burn figures, not targets, and stay the plan's.
    targets:
      own === null || plan === null
        ? appTargets
        : {
            bmr: plan.restingBurnKcal,
            tdee: plan.dailyBurnKcal,
            kcal: own.kcal,
            proteinG: own.proteinG,
            carbsG: own.carbsG,
            fatG: own.fatG,
            noCalorieCut: plan.flags.some((f) => f.code === "no_deficit"),
          },
    missing: result.missing,
    targetWrongSide,
    source: own === null ? "app" : "own",
    appTargets,
    // Stored numbers are reported whether or not they are in use: switching to
    // the app's plan keeps them, and a held set is what the screen offers to fix.
    own: pick.own,
    ownHeld: held,
  });
}
