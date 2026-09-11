// Onboarding v2, screens 1–7 (ROADMAP Stage 1 item 4a-ii): the wizard's pure
// half. What each screen asks, when a screen counts as answered, the wheels
// and their units, the words the plan panel uses, and the save queue. Every
// NUMBER of the plan is the server's (GET/PATCH /v1/users/me/onboarding);
// nothing here computes a plan.
import { PACE_KG_PER_WEEK } from '@app/shared';
import { KG_PER_LB } from '../../api/userApi';

// ── What the screens offer (each table's values are the shared enum's, pinned
//    by the test so a value added on the server cannot go missing here) ──────

/** Screen 1's weight choice: the one answer that sets the calories. */
export const WEIGHT_GOALS = [
  { value: 'lose',     label: 'Lose weight' },
  { value: 'maintain', label: 'Keep my weight' },
  { value: 'gain',     label: 'Gain weight' },
];

/** Screen 1's "also work on": any number, none of which moves the calories. */
export const GOALS = [
  { value: 'muscle_gain',     label: 'Build muscle' },
  { value: 'strength',        label: 'Get stronger' },
  { value: 'general_fitness', label: 'Get fitter' },
  { value: 'endurance',       label: 'Endurance and running' },
  { value: 'flexibility',     label: 'Flexibility' },
  { value: 'posture',         label: 'Posture' },
  { value: 'balance',         label: 'Better balance' },
  { value: 'stress_relief',   label: 'Stress relief' },
  { value: 'stay_healthy',    label: 'Stay healthy' },
];

export const GENDERS = [
  { value: 'female',            label: 'Female' },
  { value: 'male',              label: 'Male' },
  { value: 'other',             label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export const PACES = [
  { value: 'gentle', label: 'Gentle' },
  { value: 'steady', label: 'Steady' },
  { value: 'brisk',  label: 'Brisk' },
];

export const DAYS = [
  { value: 'sitting',     label: 'Mostly sitting',             desc: 'Desk work, driving, studying' },
  { value: 'on_feet',     label: 'On my feet some of the day', desc: 'Teaching, shop work, errands' },
  { value: 'active',      label: 'On my feet most of the day', desc: 'Nursing, waiting tables, a trade' },
  { value: 'very_active', label: 'Hard physical work',         desc: 'Building sites, farming, lifting loads' },
];

export const LEVELS = [
  { value: 'beginner',     label: 'Beginner',     desc: 'New to exercise, or back after a long break' },
  { value: 'intermediate', label: 'Intermediate', desc: 'I train regularly and know most moves' },
  { value: 'advanced',     label: 'Advanced',     desc: 'I train hard and want a push' },
];

export const TRAINING_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const SESSION_MINUTES = [15, 20, 30, 45, 60, 90];

export const EQUIPMENT = [
  { value: 'none',             label: 'No equipment' },
  { value: 'dumbbells',        label: 'Dumbbells' },
  { value: 'resistance_bands', label: 'Resistance bands' },
  { value: 'kettlebells',      label: 'Kettlebells' },
  { value: 'pull_up_bar',      label: 'Pull-up bar' },
  { value: 'gym',              label: 'A gym' },
];

// ── The screens, and which of them a person still has to answer ─────────────

export const SCREENS = [
  { id: 'goal',      title: 'Your goal',     desc: 'Pick one from the top row, and any of the rest' },
  { id: 'about',     title: 'About you',     desc: 'The numbers your plan is built on' },
  { id: 'target',    title: 'Your target',   desc: 'Where you are heading, and how fast' },
  { id: 'day',       title: 'Your day',      desc: 'How active you are outside workouts' },
  { id: 'training',  title: 'Your training', desc: 'Where you are starting from' },
  { id: 'week',      title: 'Your week',     desc: 'How often, and for how long' },
  { id: 'equipment', title: 'Equipment',     desc: 'What you have to train with' },
];

/** The direction the calorie maths works in: the weight choice itself, which
 *  is stored as that direction (RULINGS 2026-09-10). Null until it is picked. */
export const directionOf = (weightGoal) =>
  weightGoal === 'lose' || weightGoal === 'maintain' || weightGoal === 'gain' ? weightGoal : null;

/** The side a target weight must be on: 'lose' or 'gain', or null when the
 *  weight choice holds the weight or is not made yet. */
export const targetDirection = (weightGoal) => (weightGoal === 'lose' || weightGoal === 'gain' ? weightGoal : null);

/** Only a weight choice that moves the weight asks for a target and a pace.
 *  Before one is picked the target screen stays in the list, so the step
 *  count does not jump when "Lose weight" is chosen. */
export const asksTarget = (weightGoal) => directionOf(weightGoal) !== 'maintain';

export const visibleScreens = (answers) =>
  SCREENS.filter((s) => s.id !== 'target' || asksTarget(answers.weightGoal));

const answered = (v) => v !== null && v !== undefined;

/** A screen is answered when every question it asks has an answer. Screen 1's
 *  goals may be none (any number, RULINGS 2026-09-10) and screen 5's push-ups
 *  and plank may be "Not sure", so there only the weight choice and the
 *  self-rating count. */
export function screenAnswered(id, a) {
  switch (id) {
    case 'goal':      return answered(a.weightGoal);
    case 'about':     return answered(a.age) && answered(a.gender) && answered(a.heightCm) && answered(a.weightKg);
    case 'target':
      return (
        !asksTarget(a.weightGoal) ||
        (answered(a.targetWeightKg) &&
          answered(a.pace) &&
          !targetWrongSide(directionOf(a.weightGoal), a.targetWeightKg, a.weightKg))
      );
    case 'day':       return answered(a.dayActivity);
    case 'training':  return answered(a.fitnessLevel);
    case 'week':      return answered(a.trainingDays) && answered(a.sessionMinutes);
    case 'equipment': return Array.isArray(a.availableEquipment) && a.availableEquipment.length > 0;
    default:          return false;
  }
}

/** Where a returning person lands: the first screen still unanswered, or the
 *  last one when every screen has its answer. */
export function firstOpenScreen(answers) {
  const screens = visibleScreens(answers);
  return (screens.find((s) => !screenAnswered(s.id, answers)) ?? screens[screens.length - 1]).id;
}

/** Where the step bar may jump: every screen up to the first one still
 *  unanswered. A screen past that would skip a question. */
export function reachableScreens(answers) {
  const screens = visibleScreens(answers);
  const open = screens.findIndex((s) => !screenAnswered(s.id, answers));
  return new Set(screens.slice(0, open === -1 ? screens.length : open + 1).map((s) => s.id));
}

/** The screen that asks each answer the plan can be missing. */
export const SCREEN_OF_MISSING = {
  goal: 'goal',
  age: 'about',
  gender: 'about',
  heightCm: 'about',
  weightKg: 'about',
  targetWeightKg: 'target',
  pace: 'target',
  dayActivity: 'day',
  trainingDays: 'week',
  sessionMinutes: 'week',
};

export const MISSING_LABELS = {
  goal: 'your weight goal',
  age: 'your age',
  gender: 'your gender',
  heightCm: 'your height',
  weightKg: 'your weight',
  targetWeightKg: 'your target weight',
  pace: 'a pace',
  dayActivity: 'your day',
  trainingDays: 'training days a week',
  sessionMinutes: 'session length',
};

export function listText(items) {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The server's missing list in words. An unknown key passes through rather
 *  than being dropped: naming fewer answers than are needed would send the
 *  person looking for the wrong thing. */
export const missingText = (missing) => listText(missing.map((k) => MISSING_LABELS[k] ?? k));

// ── Equipment: "No equipment" stands alone ──────────────────────────────────

const EQUIPMENT_ORDER = EQUIPMENT.map((e) => e.value);
const inOrder = (set) => EQUIPMENT_ORDER.filter((v) => set.has(v));

/** One tap on screen 7. "No equipment" clears the rest, and anything else
 *  clears "No equipment": the server refuses the two together. */
export function toggleEquipment(current, value) {
  if (value === 'none') return current.includes('none') ? [] : ['none'];
  const next = new Set(current.filter((v) => v !== 'none'));
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return inOrder(next);
}

/** An answer the old form wrote may hold "none" beside real equipment, which
 *  the server now refuses. Loaded, the real equipment wins, so the screen
 *  never shows a pair it could not save. */
export function cleanEquipment(loaded) {
  const set = new Set(Array.isArray(loaded) ? loaded : []);
  if (set.has('none') && set.size > 1) set.delete('none');
  return inOrder(set);
}

// ── Screen 1's goals: any number, and nothing to untick ─────────────────────

const GOAL_ORDER = GOALS.map((g) => g.value);

/** One tap on "also work on": the goal is ticked or unticked, and the list
 *  keeps the screen's order. Nothing on it fights anything else (RULINGS
 *  2026-09-10), so no tap ever unticks another goal. */
export function toggleGoal(current, value) {
  const next = new Set(Array.isArray(current) ? current : []);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return GOAL_ORDER.filter((v) => next.has(v));
}

// ── The wheels and their units (Kd, 2026-09-10: nothing typed, nothing
//    pre-filled) ───────────────────────────────────────────────────────────
//
// Each wheel lists whole steps in the units on screen. A stored answer outside
// a list (one the old form typed) stretches the list to include it, so a
// stored answer is never shown as a different number. Until the person
// touches a wheel it rests on the row named `…_REST` here, display-only, and
// reads "Not set"; nothing is saved until it is moved.

const CM_PER_IN = 2.54;
const round = (n, dp) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const has = (v) => v !== null && v !== undefined;

/** Pounds and feet where the browser says the person is in the US (or one of
 *  the two other countries that weigh in pounds); kilograms and centimetres
 *  everywhere else. Only the starting position of a switch that is on screen. */
export function defaultUnits(language) {
  return typeof language === 'string' && /-(US|LR|MM)$/i.test(language) ? 'imperial' : 'metric';
}

export function range(from, to, step = 1) {
  const out = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

/** `list` with `value` added in order, when it is not already on it. */
export function including(list, value) {
  if (!has(value) || list.includes(value)) return list;
  return [...list, value].sort((a, b) => a - b);
}

/** Whole numbers from `from` to `to`, stretched to reach `value`. */
const stretched = (from, to, value) => (has(value) ? range(Math.min(from, value), Math.max(to, value)) : range(from, to));

/** The row a − or + tap lands on: one row along `list`, never off its ends. */
export function stepIn(list, current, by) {
  const i = list.indexOf(current);
  return list[Math.max(0, Math.min(list.length - 1, (i === -1 ? 0 : i) + by))];
}

export const AGE_REST = 30;
/** 16 to 120: the server's rails (RULINGS 2026-09-07, 16 and over). */
export const ageList = (age) => stretched(16, 120, age);

/** Weight: whole kilograms or pounds on one column, tenths on the other. */
export const WEIGHT_REST = { metric: 70, imperial: 154 };
const WEIGHT_WHOLES = { metric: [30, 250], imperial: [66, 550] };
export const TENTHS = range(0, 9);

export function weightParts(kg, units) {
  const tenths = Math.round((units === 'imperial' ? kg / KG_PER_LB : kg) * 10);
  return { whole: Math.floor(tenths / 10), tenth: tenths % 10 };
}

/** The kilograms a pair of rows means, to the two decimals the server stores. */
export function kgFromParts({ whole, tenth }, units) {
  const v = whole + tenth / 10;
  return round(units === 'imperial' ? v * KG_PER_LB : v, 2);
}

export function weightWholes(units, whole) {
  const [from, to] = WEIGHT_WHOLES[units === 'imperial' ? 'imperial' : 'metric'];
  return stretched(from, to, whole);
}

export const weightShown = ({ whole, tenth }, units) => `${whole}.${tenth} ${units === 'imperial' ? 'lb' : 'kg'}`;

// ── Screen 3: the target is always on the goal's side of the weight (Kd,
//    2026-09-11: "Lose weight" with a target above the weight was accepted
//    without a word; a contradiction must be impossible to pick) ─────────────

/** A stored target on the wrong side: at or above the weight for a loss, at
 *  or below it for a gain. The old form could store one, and a weight changed
 *  on screen 2 can put an old target there; the screen names it and stays
 *  unanswered until it is moved. */
export function targetWrongSide(direction, targetKg, weightKg) {
  if (!answered(targetKg) || !answered(weightKg)) return false;
  return direction === 'gain' ? targetKg <= weightKg : targetKg >= weightKg;
}

/** Screen 3's words for such a target, in the units on show. Settings' target
 *  box says the same, so the two never explain it differently. */
export function wrongSideText(direction, targetKg, weightKg, units) {
  const side = direction === 'gain' ? 'above' : 'below';
  const shown = (kg) => weightShown(weightParts(kg, units), units);
  return `${shown(targetKg)} is not ${side} your current ${shown(weightKg)}. Pick a weight ${side} it.`;
}

const tenthsOf = ({ whole, tenth }) => whole * 10 + tenth;
const partsOf = (tenths) => ({ whole: Math.floor(tenths / 10), tenth: tenths % 10 });

/** The rows the target wheel offers: whole units strictly on the goal's side
 *  of the current weight (in the parts of the units on screen), stretched to
 *  reach `at`, the row a stored target sits on, as the other wheels stretch. */
export function targetWholes(units, direction, weight, at = null) {
  const [from, to] = WEIGHT_WHOLES[units === 'imperial' ? 'imperial' : 'metric'];
  if (direction === 'gain') {
    const min = weight.tenth === 9 ? weight.whole + 1 : weight.whole;
    // At the top of the list the row above the weight is still offered.
    return range(min, Math.max(to, weight.whole + 1, at?.whole ?? to));
  }
  const max = weight.tenth === 0 ? weight.whole - 1 : weight.whole;
  return range(Math.min(from, max, at?.whole ?? from), max);
}

/** The tenths offered beside `whole`: all ten, except on the weight's own
 *  whole, where only the tenths past it remain. */
export function targetTenths(direction, weight, whole) {
  if (whole !== weight.whole) return TENTHS;
  return direction === 'gain' ? range(weight.tenth + 1, 9) : range(0, weight.tenth - 1);
}

/** The allowed row nearest the weight: one tenth along the goal's side. */
export const targetEdge = (direction, weight) => partsOf(tenthsOf(weight) + (direction === 'gain' ? 1 : -1));

/** Where the wheel rests while unset (and where a wrong-side target is shown
 *  from): the nearest WHOLE number on the goal's side, so a tap on "65" means
 *  65.0 and not 65 with a tenth carried over from the weight. */
export function targetRest(direction, weight) {
  if (direction === 'gain') return { whole: weight.whole + 1, tenth: 0 };
  return { whole: weight.tenth === 0 ? weight.whole - 1 : weight.whole, tenth: 0 };
}

/** A pick pulled onto the allowed side: a whole picked on the weight's own
 *  whole keeps its tenth only if that tenth is past the weight. */
export function clampTarget(direction, weight, parts) {
  const wrong = direction === 'gain' ? tenthsOf(parts) <= tenthsOf(weight) : tenthsOf(parts) >= tenthsOf(weight);
  return wrong ? targetEdge(direction, weight) : parts;
}

/** The row the wheel shows for a stored target on the goal's side: its own
 *  row, unless rounding to the units on show lands it on the weight's own row
 *  (140.0 lb and 139.9 lb are stored as 63.5 and 63.46 kg, and both read
 *  63.5 kg). Then it is the nearest row on the goal's side, so the target
 *  never reads the same as the weight and always sits on a row it offers. */
export const targetRow = (direction, weight, targetKg, units) =>
  clampTarget(direction, weight, weightParts(targetKg, units));

/** Height: whole centimetres, or feet and inches. */
export const HEIGHT_REST = { metric: { cm: 170 }, imperial: { ft: 5, inch: 7 } };
export const INCHES = range(0, 11);

export function heightParts(cm, units) {
  if (units !== 'imperial') return { cm: Math.round(cm) };
  const totalIn = Math.round(cm / CM_PER_IN);
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 };
}

export function cmFromParts(parts, units) {
  return units === 'imperial' ? round((parts.ft * 12 + parts.inch) * CM_PER_IN, 2) : parts.cm;
}

export const heightCmList = (cm) => stretched(100, 250, cm);
export const heightFeetList = (ft) => stretched(3, 8, ft);
export const heightShown = (parts, units) => (units === 'imperial' ? `${parts.ft} ft ${parts.inch} in` : `${parts.cm} cm`);

/** One inch along, carried into the feet. */
export function stepInches(parts, by) {
  const total = parts.ft * 12 + parts.inch + by;
  return { ft: Math.floor(total / 12), inch: ((total % 12) + 12) % 12 };
}

/** Screen 5: plain questions, a guess is fine (Kd, 2026-09-10). */
export const PUSH_UPS_REST = 10;
export const pushUpList = (n) => stretched(0, 100, n);
export const pushUpShown = (n) => `${n} ${n === 1 ? 'push-up' : 'push-ups'}`;

export const PLANK_REST = 30;
/** Five-second rows up to five minutes, plus any stored answer off that grid. */
export const plankList = (s) => including(range(0, 300, 5), s);
export function plankShown(s) {
  if (s < 60) return `${s} s`;
  const rest = s % 60;
  return rest === 0 ? `${s / 60} min` : `${Math.floor(s / 60)} min ${rest} s`;
}

// ── The plan panel's words ──────────────────────────────────────────────────

export const kcalText = (n) => new Intl.NumberFormat('en-US').format(n);

/** A YYYY-MM-DD day as "Mar 12, 2027". Formatted in UTC ON PURPOSE: the day is
 *  already the person's own, and reading it as a local midnight would show the
 *  day before anywhere west of Greenwich. */
export function dayText(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

export function weightLabel(kg, units) {
  return units === 'imperial' ? `${round(kg / KG_PER_LB, 1)} lb` : `${round(kg, 2)} kg`;
}

/** A pace card's rate, from the shared table the plan maths reads. */
export function paceText(pace, units) {
  const kg = PACE_KG_PER_WEEK[pace];
  return units === 'imperial' ? `about ${round(kg / KG_PER_LB, 1)} lb a week` : `about ${kg} kg a week`;
}

/** "550 less than the 1,817 you burn": the plan's two numbers, which subtract
 *  exactly to the change (plan.ts). */
export function changeLine(plan) {
  const burn = kcalText(plan.dailyBurnKcal);
  const d = plan.dailyChangeKcal;
  if (d < 0) return `${kcalText(-d)} less than the ${burn} you burn a day`;
  if (d > 0) return `${kcalText(d)} more than the ${burn} you burn a day`;
  return `The same as the ${burn} you burn a day`;
}

/** Where the plan runs to, or null when the flags say it all (the calorie floor
 *  can leave a plan that neither holds the weight nor has a date). */
export function targetLine(plan, units) {
  if (plan.daysToTarget !== null && plan.finishDate !== null) {
    return `Reach ${weightLabel(plan.plannedTargetKg, units)} around ${dayText(plan.finishDate)}.`;
  }
  if (plan.dailyChangeKcal === 0) return `Keeps your weight at ${weightLabel(plan.plannedTargetKg, units)}.`;
  return null;
}

const PACE_LABEL = Object.fromEntries(PACES.map((p) => [p.value, p.label]));
const NO_CUT_REASON = {
  under_18: 'you are under 18',
  health_answer: 'you answered yes to the health question',
  safe_mode: 'Safe mode is on',
};

/** Every sanity rule the server raised, as one plain sentence each. */
export function flagLines(plan, direction, units) {
  const codes = new Set(plan.flags.map((f) => f.code));
  const lines = plan.flags.map((f) => {
    switch (f.code) {
      case 'target_wrong_direction':
        return `Your target is not ${direction === 'gain' ? 'above' : 'below'} your current weight, so this plan keeps your weight where it is.`;
      case 'target_below_healthy_weight':
        return `Your target is below the lowest healthy weight for your height, ${weightLabel(f.floorKg, units)}.`;
      case 'pace_over_a_year':
        return f.suggestedPace
          ? `At this pace your target is more than a year away. The ${PACE_LABEL[f.suggestedPace].toLowerCase()} pace gets there within a year.`
          : 'At this pace your target is more than a year away, and no pace gets there within a year.';
      case 'calorie_floor_applied':
        return `Calories never go below ${kcalText(f.floorKcal)} a day in this app${
          direction === 'lose' && !codes.has('target_out_of_reach') ? ', so this plan is slower than the pace you picked' : ''
        }.`;
      case 'no_deficit':
        return `This plan has no calorie cut because ${listText(f.reasons.map((r) => NO_CUT_REASON[r] ?? r))}.`;
      case 'target_out_of_reach':
        return 'This target cannot be reached on these calories, so this plan keeps your weight where it is.';
      default:
        return null;
    }
  });
  return lines.filter((line) => line !== null);
}

/** The note under the live number: the opening sentence of the plan screen's
 *  disclaimer, word for word (the test pins it to the shared wording). The
 *  whole disclaimer, and the tap that records it, belong to the plan screen
 *  itself (screen 12). */
export const PLAN_NOTE = 'These numbers are general guidance, not medical advice.';

// ── "How is this worked out?" (Kd, 2026-09-10) ──────────────────────────────
// Every figure is the server's (`plan.workings`, whose sums the shared
// contract checks against the plan's own numbers); these are only its words.
// Each source is the one plan/maths.ts names, and where that file calls a
// figure its own, the screen says so: "the app's own estimate".

const num = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
const sign = (n) => (n < 0 ? '−' : '+');

const DAY_SOURCE = {
  sitting: 'the standard figure for a day spent mostly sitting',
  on_feet: "the app's own estimate for a day partly on your feet",
  active: "the app's own estimate for a day mostly on your feet",
  very_active: "the app's own estimate for a day of hard physical work",
};

export const WORKING_NOTE = 'Each step is rounded to a whole calorie or gram.';
export const METRIC_NOTE = 'The formulas work in kilograms and centimetres.';

/** Where each figure comes from: the sources plan/maths.ts names for its table.
 *  Grams per kilo, never a share of the calories (Kd, 2026-09-11). Worded for
 *  the goal, not the plan: the figure is the goal's even when the plan holds
 *  the weight (under 18, a health yes, a target out of reach). */
const MORTON =
  'the amount a review of 49 studies suggests for anyone trying to build as much muscle as they can (Morton and colleagues, 2018)';
const PROTEIN_SOURCE = {
  lose: (g) =>
    `${g} g per kilo for a weight-loss goal: sports nutrition recommends 1.4 to 2.0 g per kilo a day for people who train, and more while eating less, to keep muscle (ISSN, 2017).`,
  maintain: (g) =>
    `${g} g per kilo, inside the 1.4 to 2.0 g per kilo a day sports nutrition recommends for people who train (ISSN, 2017).`,
  gain: (g) =>
    `${g} g per kilo for a weight-gain goal: the top of the 1.6 to 2.2 g per kilo a day a review recommends for people who lift weights while eating more than they burn (Iraki and colleagues, 2019).`,
};
/** Build muscle ticked sets the figure whatever the weight choice (RULINGS
 *  2026-09-11: building muscle is not gaining weight). */
const BUILD_MUSCLE_SOURCE = (g) => `${g} g per kilo because you are building muscle: ${MORTON}.`;

/** The steps, in order, as `{ title, sum, note }`; `note` names the source.
 *  `direction` (lose · gain · maintain) picks the source of the protein
 *  figure; every number is the plan's own. */
export function workingSteps(plan, direction) {
  const w = plan.workings;
  const r = w.resting;
  const t = w.training;
  const steps = [
    {
      title: 'Resting burn',
      sum: `10 × ${num(r.weightKg)} kg + 6.25 × ${num(r.heightCm)} cm − 5 × ${r.age} years ${sign(r.constant)} ${num(Math.abs(r.constant))} = ${kcalText(r.kcal)} kcal`,
      note: `The Mifflin-St Jeor equation (1990), which the Academy of Nutrition and Dietetics recommends: ${
        r.formula === 'female' ? 'its version for women' : 'its version for men, which the app uses for every answer but Female'
      }.`,
    },
    {
      title: 'Your day',
      sum: `${kcalText(r.kcal)} × ${num(w.day.factor)} = ${kcalText(w.day.kcal)} kcal`,
      note: DAY_SOURCE[w.day.activity] ? `${num(w.day.factor)} is ${DAY_SOURCE[w.day.activity]}.` : null,
    },
    {
      title: 'Your training',
      sum: `${num(t.kcalPerKgHour)} × ${num(t.weightKg)} kg × ${num(t.trainingDays * t.sessionMinutes)} minutes ÷ 60 ÷ 7 days = ${kcalText(t.kcal)} kcal a day`,
      note: `${t.trainingDays} ${t.trainingDays === 1 ? 'session' : 'sessions'} of ${t.sessionMinutes} minutes a week. A workout burns about ${num(t.kcalPerKgHour)} kcal per kilo per hour: the app's own estimate.`,
    },
    {
      title: 'You burn',
      sum: `${kcalText(w.day.kcal)} + ${kcalText(t.kcal)} = ${kcalText(plan.dailyBurnKcal)} kcal a day`,
      note: null,
    },
  ];
  if (w.change) {
    steps.push({
      title: 'Your pace',
      sum: `${num(w.change.kgPerWeek)} kg a week × ${kcalText(w.change.kcalPerKg)} kcal ÷ 7 days = ${kcalText(Math.abs(w.change.kcal))} kcal a day`,
      note: `${kcalText(w.change.kcalPerKg)} kcal per kilo is the usual planning figure (Wishnofsky). Real weight change is often slower, so the date is an estimate.`,
    });
  }
  const floored = w.beforeFloorKcal < w.floorKcal;
  const eat = w.change
    ? `${kcalText(plan.dailyBurnKcal)} ${sign(w.change.kcal)} ${kcalText(Math.abs(w.change.kcal))} = ${kcalText(w.beforeFloorKcal)} kcal`
    : `${kcalText(w.beforeFloorKcal)} kcal`;
  let eatNote = null;
  if (floored) eatNote = `The app never sets fewer than ${kcalText(w.floorKcal)} kcal a day.`;
  else if (!w.change) eatNote = 'The same as you burn, so your weight stays where it is.';
  steps.push({
    title: 'To eat',
    sum: floored ? `${eat}, under the floor, so ${kcalText(plan.targetKcal)} kcal a day` : `${eat} a day`,
    note: eatNote,
  });
  const p = w.protein;
  const source = p.buildMuscle ? BUILD_MUSCLE_SOURCE : PROTEIN_SOURCE[direction];
  // A body heavier than the reference BMI is counted at that BMI's weight
  // (Kd, 2026-09-11), and the step says so rather than print a weight the
  // person does not recognise.
  const counted =
    p.referenceBmi === null || p.referenceBmi === undefined
      ? ''
      : `Counted on ${num(p.weightKg)} kg, the weight at a BMI of ${num(p.referenceBmi)} for your height, rather than your ${num(r.weightKg)} kg, as protein guidance for heavier bodies does (Weijs, 2025). `;
  steps.push(
    {
      title: 'Protein',
      sum:
        plan.proteinG === p.wantedG
          ? `${num(p.gPerKg)} g × ${num(p.weightKg)} kg = ${p.wantedG} g`
          : `${num(p.gPerKg)} g × ${num(p.weightKg)} kg would be ${p.wantedG} g, more than the day's calories leave room for, so ${plan.proteinG} g`,
      note: `${counted}${source ? source(num(p.gPerKg)) : `${num(p.gPerKg)} g per kilo is the app's own figure for your goal.`}`,
    },
    {
      title: 'Fat',
      sum: `${num(w.fatShare * 100)}% of ${kcalText(plan.targetKcal)} kcal ÷ 9 kcal a gram = ${plan.fatG} g`,
      note: "The app's own share.",
    },
    {
      title: 'Carbohydrates',
      sum: `The rest of the calories ÷ 4 kcal a gram = ${plan.carbsG} g`,
      note: `Never under ${w.carbsFloorG} g a day.`,
    },
  );
  if (w.finish && plan.daysToTarget !== null) {
    steps.push({
      title: 'Your finish date',
      sum: `${num(w.finish.kgToMove)} kg × ${kcalText(w.finish.kcalPerKg)} kcal ÷ ${kcalText(Math.abs(plan.dailyChangeKcal))} kcal a day = ${kcalText(plan.daysToTarget)} days`,
      note: 'Rounded up to a whole day.',
    });
  }
  return steps;
}

// ── Saving as you go ────────────────────────────────────────────────────────

export function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/** The edits still waiting once `sent` has been answered, either way: a key
 *  whose edit is still the value that was sent is settled; a key tapped again
 *  since keeps its newer value, which is still on its way. */
export function settleEdits(edits, sent) {
  const next = { ...edits };
  for (const [key, value] of Object.entries(sent)) {
    if (key in next && sameValue(next[key], value)) delete next[key];
  }
  return next;
}

/** One save on the wire at a time, in the order they were made. Taps made
 *  while one is out are merged into the next, so the last answer is always
 *  the one stored — two requests in flight could land in either order, and
 *  the screen would then show one answer while the server kept the other.
 *
 *  `settled()` resolves once everything has been answered: true when no save
 *  made or finished since the call failed. */
export function createSaveQueue({ send, onSaved, onFailed }) {
  let pending = null;
  let running = false;
  let failures = 0;
  let waiters = [];

  const pump = async () => {
    running = true;
    while (pending !== null) {
      const patch = pending;
      pending = null;
      try {
        onSaved(await send(patch), patch);
      } catch (err) {
        failures += 1;
        onFailed(err, patch);
      }
    }
    running = false;
    const done = waiters;
    waiters = [];
    for (const resolve of done) resolve(failures);
  };

  return {
    save(patch) {
      pending = { ...(pending ?? {}), ...patch };
      if (!running) void pump();
    },
    settled() {
      const before = failures;
      if (!running && pending === null) return Promise.resolve(true);
      return new Promise((resolve) => {
        waiters.push((now) => resolve(now === before));
      });
    },
  };
}
