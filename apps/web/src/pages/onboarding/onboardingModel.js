// Onboarding v2 (ROADMAP Stage 1 items 4a-ii to 4c): the wizard's pure half.
// What each screen asks, when a screen counts as answered, the wheels and
// their units, the words the plan panel and the plan screen use, and the save
// queue. Every NUMBER of the plan is the server's (GET/PATCH
// /v1/users/me/onboarding); nothing here computes a plan.
import {
  ADULT_AGE,
  CHECK_FIRST_OPTIONS,
  MUSCLE_GAIN_PACE,
  ORG_TYPES_PHRASE,
  PACE_KG_PER_WEEK,
  healthyWeightFloorKg,
  versionFor,
} from '@app/shared';
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

/** Screen 9's diet, in the order RULINGS 2026-09-10 names them. Each line says
 *  what the meal suggestions may offer, because that is the whole of what this
 *  answer does — nothing here changes a calorie. */
export const DIETS = [
  { value: 'vegetarian',     label: 'Vegetarian',            desc: 'No meat or fish. Milk and dairy are fine' },
  { value: 'vegetarian_eggs', label: 'Vegetarian with eggs', desc: 'No meat or fish. Eggs and dairy are fine' },
  { value: 'non_vegetarian', label: 'Non-vegetarian',        desc: 'Anything — meat, fish, eggs and dairy' },
  { value: 'vegan',          label: 'Vegan',                 desc: 'No animal food at all' },
];

/** How many sittings the day's food is split across. Two is a real answer and
 *  six is as many as a day is ever planned in (the shared rail). */
export const MEALS_PER_DAY = [2, 3, 4, 5, 6];

// ── The screens, and which of them a person still has to answer ─────────────

export const SCREENS = [
  { id: 'goal',      title: 'Your goal',     desc: 'Pick one from the top row, and any of the rest' },
  { id: 'about',     title: 'About you',     desc: 'The numbers your plan is built on' },
  { id: 'target',    title: 'Your target',   desc: 'Where you are heading, and how fast' },
  { id: 'day',       title: 'Your day',      desc: 'How active you are outside workouts' },
  { id: 'training',  title: 'Your training', desc: 'Where you are starting from' },
  { id: 'week',      title: 'Your week',     desc: 'How often, and for how long' },
  { id: 'equipment', title: 'Equipment',     desc: 'What you have to train with' },
  { id: 'health',    title: 'Health',        desc: 'One question, so your plan is careful' },
  { id: 'food',      title: 'Food',          desc: 'What you eat, so meals can be suggested' },
  { id: 'code',      title: 'Your code',     desc: `Only if a ${ORG_TYPES_PHRASE} gave you one` },
  { id: 'plan',      title: 'Your plan',     desc: 'Check it, adjust anything, then finish' },
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

/** The screens in the order this person meets them. `codeFirst` is for someone
 *  who came from a poster link with its code (ROADMAP 4b-ii-b): "Your code"
 *  moves to the front, so they can ask to join before the questions, and the
 *  count stays the same. */
export const visibleScreens = (answers, { codeFirst = false } = {}) => {
  const shown = SCREENS.filter((s) => s.id !== 'target' || asksTarget(answers.weightGoal));
  return codeFirst ? [...shown.filter((s) => s.id === 'code'), ...shown.filter((s) => s.id !== 'code')] : shown;
};

const answered = (v) => v !== null && v !== undefined;

/** A screen is answered when every question it asks has an answer. Screen 1's
 *  goals may be none (any number, RULINGS 2026-09-10) and screen 5's push-ups
 *  and plank may be "Not sure", so there only the weight choice and the
 *  self-rating count.
 *
 *  Screen 8's answer is NOT one of the wizard's answers: the health screening
 *  is its own table behind its own route (3b), so the page lays what it holds
 *  onto this object as `health`. `answered` there is the server's own word for
 *  "this person has saved the screening once" — a yes with no "Check first"
 *  chosen is never stored, so it can never read as answered.
 *
 *  Screen 11, the gym code, asks nothing that can be left open: most people
 *  have no code, and a person who has one may apply now, later in Settings, or
 *  never. So it is always answered — Continue and Finish are never held by it —
 *  and the server's finish check has no word for it either (`@app/shared`
 *  `missingSetupAnswerSchema`). It is a screen, not a question.
 *
 *  The last screen, your plan (4c), asks nothing either: it shows what every
 *  other screen answered. So it counts as answered exactly when they all are —
 *  which makes it where a person with every answer in lands, and the one screen
 *  the step bar reaches only then. */
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
    case 'health':    return a.health?.answered === true;
    case 'food':      return answered(a.diet) && answered(a.mealsPerDay);
    case 'code':      return true;
    case 'plan':      return visibleScreens(a).every((s) => s.id === 'plan' || screenAnswered(s.id, a));
    default:          return false;
  }
}

/** Where a returning person lands: the first screen still unanswered, or the
 *  last one when every screen has its answer. "Your code" is always answered,
 *  so with it first this is where its Continue goes on to. */
export function firstOpenScreen(answers, order = {}) {
  const screens = visibleScreens(answers, order);
  return (screens.find((s) => !screenAnswered(s.id, answers)) ?? screens[screens.length - 1]).id;
}

/** Where the step bar may jump: every screen up to the first one still
 *  unanswered. A screen past that would skip a question. */
export function reachableScreens(answers, order = {}) {
  const screens = visibleScreens(answers, order);
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
  health: 'health',
  diet: 'food',
  mealsPerDay: 'food',
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
  health: 'the health question',
  diet: 'your diet',
  mealsPerDay: 'how many meals a day',
};

/** The answers SETUP needs that the PLAN's own missing list can never carry, in
 *  screen order: the health question (screen 8, its own table behind its own
 *  route) and screen 9's two food answers. A plan is a number, and it is
 *  worked out without all three — so a save's `missing` never names them, and
 *  only a refused finish does (`missingSetupAnswerSchema`, @app/shared). */
export const SETUP_ONLY_ANSWERS = ['health', 'diet', 'mealsPerDay'];

const setupOnlyAnswered = (key, a) => (key === 'health' ? screenAnswered('health', a) : answered(a[key]));

/** What still stands between this person and Finish: what the server said the
 *  PLAN is missing, plus whichever of the three above this screen can see are
 *  still open. Any of the three the server named are dropped from its list
 *  first and re-added only while they are unanswered, so one answered since a
 *  refusal stops being named the moment it is given. */
export function openSetupAnswers(serverOpen, answers) {
  const fromPlan = serverOpen.filter((k) => !SETUP_ONLY_ANSWERS.includes(k));
  return [...fromPlan, ...SETUP_ONLY_ANSWERS.filter((k) => !setupOnlyAnswered(k, answers))];
}

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

// ── Screen 3: a target under the lowest healthy weight is said as it is
//    picked, and can still be picked (Kd, 2026-09-14) ──────────────────────

/** The lowest healthy weight for these answers' height, age and gender, in
 *  kilograms to one decimal — the shared rule the plan maths runs to — or null
 *  until all three are answered. */
export function healthyFloorKg(a) {
  if (!answered(a.heightCm) || !answered(a.age) || !answered(a.gender)) return null;
  return healthyWeightFloorKg(a.heightCm, a.age, versionFor(a.gender));
}

/** The number a weight reads on a wheel: its row, in the units on show. */
export const rowValue = (kg, units) => {
  const { whole, tenth } = weightParts(kg, units);
  return whole + tenth / 10;
};

/** Whether a weight that reads `shown` on screen, in the units on show — a
 *  wheel's row, or the number typed in Settings' box — reads under `floorKg` as
 *  the screens name it (`weightLabel`). The plan compares kilograms, and a
 *  target a hair under the floor can read the same as it (111.1 lb is stored as
 *  50.39 kg, under the 50.4 kg that reads 111.1 lb): the plan then runs to the
 *  floor, which reads as the target, so there is nothing true to say. */
export function readsBelow(shown, floorKg, units) {
  if (!answered(shown) || !answered(floorKg)) return false;
  return Math.round(shown * 100) < Math.round(labelValue(floorKg, units) * 100);
}

/** The flag's sentence, on screen 3 and in the plan panel alike. */
export const belowHealthyText = (floorKg, units) =>
  `Your target is below the lowest healthy weight for your height, ${weightLabel(floorKg, units)}.`;

/** Screen 3's line under the target wheel (and Settings' under its box), or
 *  null when there is nothing to say: a "Lose weight" target on the right side
 *  of the weight that is under the lowest healthy weight in kilograms, as the
 *  plan judges it, AND reads under it on screen. `shown` holds the numbers the
 *  screen shows, in the units on show: by default the wheels' rows; Settings
 *  passes the numbers typed. What the line says the plan does holds whatever
 *  else the plan holds — under 18, a yes to the health question and the calorie
 *  floor can each stop the cut, and none of them takes anyone under that weight. */
export function healthyTargetLine(direction, a, units, shown = {}) {
  if (direction !== 'lose' || !answered(a.weightKg) || !answered(a.targetWeightKg)) return null;
  if (targetWrongSide(direction, a.targetWeightKg, a.weightKg)) return null;
  const floorKg = healthyFloorKg(a);
  if (floorKg === null || !(a.targetWeightKg < floorKg)) return null;
  if (!readsBelow(shown.target ?? rowValue(a.targetWeightKg, units), floorKg, units)) return null;
  const first = belowHealthyText(floorKg, units);
  // The plan runs down to the floor only from a weight above it, in kilograms.
  if (floorKg < a.weightKg) return `${first} Your plan will not take you below it.`;
  const weightShownNow = shown.weight ?? rowValue(a.weightKg, units);
  const already = readsBelow(weightShownNow, floorKg, units) ? 'You already weigh less' : 'You are already at it';
  return `${first} ${already}, so your plan will not lower your weight.`;
}

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

/** The number `weightLabel` prints for a weight. */
function labelValue(kg, units) {
  return units === 'imperial' ? round(kg / KG_PER_LB, 1) : round(kg, 2);
}

export function weightLabel(kg, units) {
  return `${labelValue(kg, units)} ${units === 'imperial' ? 'lb' : 'kg'}`;
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

/** Every sanity rule the server raised, as one plain sentence each. The
 *  healthy-weight line is said only while `targetKg`, the target on screen,
 *  reads below the floor on its wheel's row (`readsBelow`), as screen 3 says it. */
export function flagLines(plan, direction, units, targetKg = null) {
  const codes = new Set(plan.flags.map((f) => f.code));
  const lines = plan.flags.map((f) => {
    switch (f.code) {
      case 'target_wrong_direction':
        return `Your target is not ${direction === 'gain' ? 'above' : 'below'} your current weight, so this plan keeps your weight where it is.`;
      case 'target_below_healthy_weight':
        return answered(targetKg) && readsBelow(rowValue(targetKg, units), f.floorKg, units)
          ? belowHealthyText(f.floorKg, units)
          : null;
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
      case 'cut_limits_muscle_gain':
        // Kd, 2026-09-13: tell them, and keep their pace.
        return `Building muscle while losing weight: a cut of more than ${kcalText(f.limitKcal)} kcal a day mostly stops muscle growing.${
          f.suggestedPace ? ` The ${PACE_LABEL[f.suggestedPace].toLowerCase()} pace leaves room for it.` : ''
        }`;
      default:
        return null;
    }
  });
  return lines.filter((line) => line !== null);
}

/** The note under the live number on the screens that ask: the opening
 *  sentence of the plan screen's disclaimer, word for word (the test pins it to
 *  the shared wording). The plan screen shows the whole disclaimer, with the tap
 *  that records it, so the panel there leaves this out. */
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
    const muscle = plan.flags.find((f) => f.code === 'cut_limits_muscle_gain');
    steps.push({
      title: 'Your pace',
      sum: `${num(w.change.kgPerWeek)} kg a week × ${kcalText(w.change.kcalPerKg)} kcal ÷ 7 days = ${kcalText(Math.abs(w.change.kcal))} kcal a day`,
      note: `${kcalText(w.change.kcalPerKg)} kcal per kilo is the usual planning figure (Wishnofsky). Real weight change is often slower, so the date is an estimate.${
        muscle
          ? ` A review of trials that trained while eating less found that a cut of about ${kcalText(muscle.limitKcal)} kcal a day stopped the muscle training builds (Murphy and Koehler, 2022).`
          : ''
      }`,
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
const DIET_LABEL = labels(DIETS);

export const NOT_ANSWERED = 'Not answered';
/** Words on one line, " · " between them, in the order given; nothing empty. */
const joined = (parts) => parts.filter((p) => typeof p === 'string' && p !== '').join(' · ');
const equipmentText = (a) => joined(cleanEquipment(a.availableEquipment).map((e) => EQUIPMENT_LABEL[e] ?? e));

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
      return `${weightShown(weightParts(a.targetWeightKg, units), units)} · ${PACE_LABEL[a.pace]}, ${paceText(a.pace, units)}`;
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
    .filter((s) => s.id !== 'code' && s.id !== 'plan')
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

/** The mark on screen 3's pace card that leaves muscle room to grow, for
 *  someone building muscle while losing weight (Kd, 2026-09-13). The pace is
 *  the shared one the server's plan line suggests, marked only where another
 *  pace would cut more: where every pace eats the same, a mark would point at a
 *  choice that changes nothing. Once there is a plan, the server says what each
 *  pace would change a day (`dailyChangeKcalByPace`, which counts every rule
 *  that stops or shrinks a cut: under 18, a yes to the health question, the
 *  calorie floor, a target the plan cannot run to). Before there is one — the
 *  first walk, with screens 4 to 7 still to come — only the age and the health
 *  answer are known here. */
export const MUSCLE_PACE_NOTE = 'Best if you also build muscle';
export function paceNote(pace, direction, a, plan = null) {
  const buildsMuscle = Array.isArray(a.fitnessGoals) && a.fitnessGoals.includes('muscle_gain');
  const canCut = answered(a.age) && a.age >= ADULT_AGE && a.health?.hasCondition !== true;
  const byPace = plan?.dailyChangeKcalByPace ?? null;
  const cut = (p) => Math.max(0, -byPace[p]);
  const anotherCutsMore = byPace === null || PACES.some((p) => cut(p.value) > cut(MUSCLE_GAIN_PACE));
  return direction === 'lose' && buildsMuscle && canCut && anotherCutsMore && pace === MUSCLE_GAIN_PACE
    ? MUSCLE_PACE_NOTE
    : null;
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
