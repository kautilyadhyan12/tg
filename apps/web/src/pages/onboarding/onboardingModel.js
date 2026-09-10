// Onboarding v2, screens 1–7 (ROADMAP Stage 1 item 4a-ii): the wizard's pure
// half. What each screen asks, when a screen counts as answered, the words the
// plan panel uses, units, and the save queue. Every NUMBER on screen is the
// server's (GET/PATCH /v1/users/me/onboarding); nothing here computes a plan.
import { PACE_KG_PER_WEEK, PLAN_GOAL_BY_MAIN_GOAL } from '@app/shared';
import { KG_PER_LB } from '../../api/userApi';

// ── What the screens offer (each table's values are the shared enum's, pinned
//    by the test so a value added on the server cannot go missing here) ──────

export const GOALS = [
  { value: 'weight_loss',     label: 'Lose weight' },
  { value: 'muscle_gain',     label: 'Build muscle' },
  { value: 'general_fitness', label: 'Get fitter' },
  { value: 'flexibility',     label: 'Flexibility' },
  { value: 'endurance',       label: 'Endurance and running' },
  { value: 'posture',         label: 'Posture' },
  { value: 'stress_relief',   label: 'Stress relief' },
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
];

// ── The screens, and which of them a person still has to answer ─────────────

export const SCREENS = [
  { id: 'goal',      title: 'Your goal',     desc: 'The one thing you want most' },
  { id: 'about',     title: 'About you',     desc: 'The numbers your plan is built on' },
  { id: 'target',    title: 'Your target',   desc: 'Where you are heading, and how fast' },
  { id: 'day',       title: 'Your day',      desc: 'How active you are outside workouts' },
  { id: 'training',  title: 'Your training', desc: 'Where you are starting from' },
  { id: 'week',      title: 'Your week',     desc: 'How often, and for how long' },
  { id: 'equipment', title: 'Equipment',     desc: 'What you have to train with' },
];

/** The direction the calorie maths works in — the shared table, never derived
 *  again here. Null until a goal is picked. */
export const directionOf = (mainGoal) =>
  mainGoal === null || mainGoal === undefined ? null : PLAN_GOAL_BY_MAIN_GOAL[mainGoal] ?? null;

/** Only a goal that moves the weight asks for a target and a pace. Before a
 *  goal is picked the target screen stays in the list, so the step count does
 *  not jump when "Lose weight" is chosen. */
export const asksTarget = (mainGoal) => directionOf(mainGoal) !== 'maintain';

export const visibleScreens = (answers) =>
  SCREENS.filter((s) => s.id !== 'target' || asksTarget(answers.mainGoal));

const has = (v) => v !== null && v !== undefined;

/** A screen is answered when every question it asks has an answer. Screen 5's
 *  two checks may be skipped ("I'll rate myself", RULINGS 2026-09-09), so only
 *  the self-rating counts there. */
export function screenAnswered(id, a) {
  switch (id) {
    case 'goal':      return has(a.mainGoal);
    case 'about':     return has(a.age) && has(a.gender) && has(a.heightCm) && has(a.weightKg);
    case 'target':    return !asksTarget(a.mainGoal) || (has(a.targetWeightKg) && has(a.pace));
    case 'day':       return has(a.dayActivity);
    case 'training':  return has(a.fitnessLevel);
    case 'week':      return has(a.trainingDays) && has(a.sessionMinutes);
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
  goal: 'your goal',
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

// ── Typed answers (age, height, weight) and units ───────────────────────────

const CM_PER_IN = 2.54;
const round = (n, dp) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
const norm = (text) => String(text ?? '').trim().replace(',', '.');
const NUMBER = /^\d+(\.\d+)?$/;

/** Pounds and feet where the browser says the person is in the US (or one of
 *  the two other countries that weigh in pounds); kilograms and centimetres
 *  everywhere else. Only the starting position of a switch that is on screen. */
export function defaultUnits(language) {
  return typeof language === 'string' && /-(US|LR|MM)$/i.test(language) ? 'imperial' : 'metric';
}

/** Each typed answer parses to `{ value, error }`. Empty text is `null`: the
 *  answer is cleared, never guessed. Values are rounded to the two decimals
 *  the server stores. */
export function parseAge(text) {
  const t = norm(text);
  if (t === '') return { value: null, error: null };
  if (!/^\d{1,3}$/.test(t)) return { value: null, error: 'Type your age in years, like 30.' };
  const n = Number(t);
  if (n < 16) return { value: null, error: 'This app is for people aged 16 and over.' };
  if (n > 120) return { value: null, error: 'Enter an age from 16 to 120.' };
  return { value: n, error: null };
}

export function parseWeight(text, units) {
  const t = norm(text);
  if (t === '') return { value: null, error: null };
  if (!NUMBER.test(t)) {
    return { value: null, error: `Type a number, like ${units === 'imperial' ? '154' : '70'}.` };
  }
  const kg = round(units === 'imperial' ? Number(t) * KG_PER_LB : Number(t), 2);
  if (kg <= 0 || kg >= 1000) return { value: null, error: 'That weight looks wrong. Check the number.' };
  return { value: kg, error: null };
}

export function parseHeight(parts, units) {
  if (units !== 'imperial') {
    const t = norm(parts.cm);
    if (t === '') return { value: null, error: null };
    if (!NUMBER.test(t)) return { value: null, error: 'Type your height in centimetres, like 170.' };
    const cm = round(Number(t), 2);
    return cm < 50 || cm > 300
      ? { value: null, error: 'Enter a height from 50 to 300 cm.' }
      : { value: cm, error: null };
  }
  const ft = norm(parts.ft);
  const inch = norm(parts.inch);
  if (ft === '' && inch === '') return { value: null, error: null };
  if (!/^\d$/.test(ft) || (inch !== '' && !NUMBER.test(inch))) {
    return { value: null, error: 'Type your height in feet and inches, like 5 ft 9 in.' };
  }
  const inches = inch === '' ? 0 : Number(inch);
  if (inches >= 12) return { value: null, error: 'Inches must be under 12.' };
  const cm = round((Number(ft) * 12 + inches) * CM_PER_IN, 2);
  return cm < 50 || cm > 300
    ? { value: null, error: 'That height looks wrong. Check the feet and inches.' }
    : { value: cm, error: null };
}

/** The box's text for a stored value, in the units on screen. */
export function weightText(kg, units) {
  if (kg === null || kg === undefined) return '';
  return String(units === 'imperial' ? round(kg / KG_PER_LB, 1) : round(kg, 2));
}

export function heightText(cm, units) {
  if (cm === null || cm === undefined) return { cm: '', ft: '', inch: '' };
  if (units !== 'imperial') return { cm: String(round(cm, 2)), ft: '', inch: '' };
  const totalIn = cm / CM_PER_IN;
  let ft = Math.floor(totalIn / 12);
  let inch = round(totalIn - ft * 12, 1);
  if (inch >= 12) {
    ft += 1;
    inch = round(inch - 12, 1);
  }
  return { cm: '', ft: String(ft), inch: String(inch) };
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
