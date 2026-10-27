// Onboarding v2 (ROADMAP Stage 1 items 4a-ii to 4c): the wizard's pure half.
// What each screen asks, when a screen counts as answered, the wheels and their
// units, the plan panel's words and the save queue live in `@app/shared`
// (setupScreens.ts, since ROADMAP Stage 5 item 14a), so the phone asks the same
// things in the same words; this file passes them on and keeps the plan
// screen's own words. Every NUMBER of the plan is the server's.
import {
  CHECK_FIRST_OPTIONS,
  DAYS,
  DIETS,
  EQUIPMENT,
  GENDERS,
  GOALS,
  LEVELS,
  PACES,
  PLACES,
  WEIGHT_GOALS,
  cleanEquipment,
  directionOf,
  heightParts,
  heightShown,
  paceText,
  plankShown,
  pushUpShown,
  targetShownRow,
  visibleScreens,
  weightParts,
  weightShown,
} from '@app/shared';

export {
  AGE_REST,
  DAYS,
  DIETS,
  EQUIPMENT,
  GENDERS,
  GOALS,
  HEIGHT_REST,
  INCHES,
  KG_PER_LB,
  LEVELS,
  MEALS_PER_DAY,
  METRIC_NOTE,
  MISSING_LABELS,
  MUSCLE_PACE_NOTE,
  PACES,
  PLACES,
  PLANK_REST,
  PLAN_NOTE,
  PUSH_UPS_REST,
  SCREENS,
  SCREEN_OF_MISSING,
  SESSION_MINUTES,
  SETUP_ONLY_ANSWERS,
  TENTHS,
  TRAINING_DAYS,
  WEIGHT_GOALS,
  WEIGHT_REST,
  WORKING_NOTE,
  ageList,
  asksTarget,
  belowHealthyText,
  changeLine,
  clampTarget,
  cleanEquipment,
  cmFromParts,
  createSaveQueue,
  dayText,
  defaultUnits,
  directionOf,
  firstOpenScreen,
  flagLines,
  healthyFloorKg,
  healthyTargetLine,
  heightCmList,
  heightFeetList,
  heightParts,
  heightShown,
  including,
  kcalText,
  kgFromParts,
  listText,
  missingText,
  openSetupAnswers,
  paceNote,
  paceText,
  plankList,
  plankShown,
  pushUpList,
  pushUpShown,
  range,
  reachableScreens,
  readsBelow,
  rowValue,
  sameValue,
  screenAnswered,
  settleEdits,
  stepIn,
  stepInches,
  targetDirection,
  targetEdge,
  targetLine,
  targetRest,
  targetRow,
  targetShownRow,
  targetShownValue,
  targetTenths,
  targetWholes,
  targetWrongSide,
  toggleEquipment,
  toggleGoal,
  togglePlace,
  visibleScreens,
  weightLabel,
  weightParts,
  weightShown,
  weightWholes,
  workingSteps,
  wrongSideText,
} from '@app/shared';

const answered = (v) => v !== null && v !== undefined;
const PACE_LABEL = Object.fromEntries(PACES.map((p) => [p.value, p.label]));

// ── The plan screen (ROADMAP 4c) ────────────────────────────────────────────
// The last screen: the number (the panel above it), the week of workouts, what
// every answer is, a way back to each screen that asked it, and the plan's own
// disclaimer. Every word here is read from the answers and the shared tables,
// never kept as a second copy.

const labels = (table) => Object.fromEntries(table.map((row) => [row.value, row.label]));
const WEIGHT_GOAL_LABEL = labels(WEIGHT_GOALS);
const GOAL_LABEL = labels(GOALS);
const GENDER_LABEL = labels(GENDERS);
const DAY_LABEL = labels(DAYS);
const LEVEL_LABEL = labels(LEVELS);
const EQUIPMENT_LABEL = labels(EQUIPMENT);
const PLACE_LABEL = labels(PLACES);
const DIET_LABEL = labels(DIETS);

export const NOT_ANSWERED = 'Not answered';
/** Words on one line, " · " between them, in the order given; nothing empty. */
const joined = (parts) => parts.filter((p) => typeof p === 'string' && p !== '').join(' · ');
const equipmentText = (a) =>
  joined([
    ...(Array.isArray(a.trainingPlaces) ? a.trainingPlaces : []).map((p) => PLACE_LABEL[p] ?? p),
    ...cleanEquipment(a.availableEquipment).map((e) => EQUIPMENT_LABEL[e] ?? e),
  ]);

/** What one screen holds, in the words that screen uses. */
export function answerValue(id, a, units) {
  switch (id) {
    case 'goal':
      // The weight choice, then the goals beside it, as screen 1's grid has them.
      if (!answered(a.weightGoal)) return NOT_ANSWERED;
      return joined([
        WEIGHT_GOAL_LABEL[a.weightGoal],
        ...(Array.isArray(a.fitnessGoals) ? a.fitnessGoals : []).map((g) => GOAL_LABEL[g] ?? g),
      ]);
    case 'about':
      return (
        joined([
          a.displayName,
          answered(a.age) ? `${a.age} years` : null,
          GENDER_LABEL[a.gender],
          answered(a.heightCm) ? heightShown(heightParts(a.heightCm, units), units) : null,
          answered(a.weightKg) ? weightShown(weightParts(a.weightKg, units), units) : null,
        ]) || NOT_ANSWERED
      );
    case 'target':
      if (!answered(a.targetWeightKg) || !answered(a.pace)) return NOT_ANSWERED;
      // On the row its wheel shows, so the plan screen and screen 3 read it alike.
      return `${weightShown(targetShownRow(directionOf(a.weightGoal), a, units), units)} · ${PACE_LABEL[a.pace]}, ${paceText(a.pace, units)}`;
    case 'day':
      return DAY_LABEL[a.dayActivity] ?? NOT_ANSWERED;
    case 'training':
      if (!answered(a.fitnessLevel)) return NOT_ANSWERED;
      return joined([
        LEVEL_LABEL[a.fitnessLevel],
        answered(a.pushUpsMax) ? pushUpShown(a.pushUpsMax) : null,
        answered(a.plankHoldSeconds) ? `${plankShown(a.plankHoldSeconds)} plank` : null,
      ]);
    case 'week':
      if (!answered(a.trainingDays) || !answered(a.sessionMinutes)) return NOT_ANSWERED;
      return `${a.trainingDays} ${a.trainingDays === 1 ? 'day' : 'days'} a week · ${a.sessionMinutes} minutes`;
    case 'equipment':
      return equipmentText(a) || NOT_ANSWERED;
    case 'health':
      if (a.health?.answered !== true) return NOT_ANSWERED;
      return a.health.hasCondition === true ? joined(['Yes', CHECK_FIRST_OPTIONS[a.health.checkFirst]?.label]) : 'No';
    case 'food':
      if (!answered(a.diet) || !answered(a.mealsPerDay)) return NOT_ANSWERED;
      return `${DIET_LABEL[a.diet] ?? a.diet} · ${a.mealsPerDay} meals a day`;
    default:
      return NOT_ANSWERED;
  }
}

/** The plan screen's rows: every screen that asks something, in the order
 *  they are met, each with what it holds. */
export const answerRows = (a, units) =>
  visibleScreens(a)
    .filter((s) => s.id !== 'gym' && s.id !== 'plan')
    .map((s) => ({ id: s.id, title: s.title, value: answerValue(s.id, a, units) }));

/** The week of workouts as the person asked for it, or null until both
 *  answers are in. It names no workout: those come with the weekly plan (6a). */
export function workoutsLine(a) {
  if (!answered(a.trainingDays) || !answered(a.sessionMinutes)) return null;
  return `${a.trainingDays} ${a.trainingDays === 1 ? 'workout' : 'workouts'} a week, ${a.sessionMinutes} minutes each`;
}

/** The level and the equipment the workouts are for: "Beginner · Dumbbells". */
export const workoutsDetail = (a) => joined([LEVEL_LABEL[a.fitnessLevel], equipmentText(a)]);

/** A yes a professional has cleared: the normal plan, and this line with it
 *  (RULINGS 2026-09-09: "a cleared person gets the normal plan plus a 'follow
 *  your professional' line"). The clearance is the person's word, never a fact
 *  the app holds, so the line says who told it. */
export const CLEARED_LINE = 'You told us a professional has cleared you. Follow their advice.';
