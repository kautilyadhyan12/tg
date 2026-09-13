// The wizard's pure half. The tables are pinned to the shared enums, so a
// value the server accepts cannot be missing from a screen; every value a
// screen can send is pinned to the server's own request contract.
import process from 'node:process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  CURRENT_DISCLAIMER_VERSION,
  DISCLAIMER_WORDINGS,
  dayActivitySchema,
  dietSchema,
  equipmentSchema,
  fitnessGoalSchema,
  fitnessLevelSchema,
  genderSchema,
  missingPlanInputSchema,
  missingSetupAnswerSchema,
  MUSCLE_GAIN_PACE,
  patchOnboardingRequestSchema,
  planFlagSchema,
  planNumbersSchema,
  planPaceSchema,
  weightGoalSchema,
} from '@app/shared';
import * as m from './onboardingModel';
import {
  Barbell,
  DIET_ICONS,
  EQUIPMENT_ICONS,
  GOAL_ICONS,
  LEVEL_ICONS,
  OneLegBalance,
  PullUpBar,
  SideStretch,
  STEP_ICONS,
  WEIGHT_GOAL_ICONS,
} from './onboardingIcons';

const accepts = (body) => patchOnboardingRequestSchema.safeParse(body).success;
const values = (table) => table.map((row) => row.value).sort();

/** Screen 8's answer is not one of the wizard's own: the page lays the health
 *  screening beside them as `health` (4b-i), so these fixtures carry it too. */
const NO_HEALTH_ANSWER = { answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null };
const HEALTH_ANSWERED = { answered: true, hasCondition: false, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: '2026-09-12T09:00:00.000Z' };

const EMPTY = {
  displayName: 'Kd', weightGoal: null, fitnessGoals: [], age: null, gender: null, heightCm: null, weightKg: null,
  targetWeightKg: null, pace: null, dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null,
  trainingDays: null, sessionMinutes: null, availableEquipment: [], diet: null, mealsPerDay: null,
  onboardingCompleted: false, updatedAt: null,
  health: NO_HEALTH_ANSWER,
};
const ALL = {
  ...EMPTY, weightGoal: 'lose', age: 30, gender: 'female', heightCm: 165, weightKg: 70, targetWeightKg: 65,
  pace: 'steady', dayActivity: 'sitting', fitnessLevel: 'beginner', trainingDays: 3, sessionMinutes: 45,
  availableEquipment: ['dumbbells'], diet: 'non_vegetarian', mealsPerDay: 3, health: HEALTH_ANSWERED,
};

describe('what the screens offer is exactly what the server accepts', () => {
  it('every choice table holds the shared enum, no more and no less', () => {
    expect(values(m.WEIGHT_GOALS)).toEqual([...weightGoalSchema.options].sort());
    expect(values(m.GOALS)).toEqual([...fitnessGoalSchema.options].sort());
    expect(values(m.GENDERS)).toEqual([...genderSchema.options].sort());
    expect(values(m.PACES)).toEqual([...planPaceSchema.options].sort());
    expect(values(m.DAYS)).toEqual([...dayActivitySchema.options].sort());
    expect(values(m.LEVELS)).toEqual([...fitnessLevelSchema.options].sort());
    expect(values(m.EQUIPMENT)).toEqual([...equipmentSchema.options].sort());
    expect(values(m.DIETS)).toEqual([...dietSchema.options].sort());
  });

  it('screen 9 offers Kd\'s four diets in his order, and every meal count the server takes', () => {
    // RULINGS 2026-09-10. The words are the person's, the values the server's.
    expect(m.DIETS.map((d) => d.value)).toEqual([...dietSchema.options]);
    expect(m.DIETS.map((d) => d.label)).toEqual(['Vegetarian', 'Vegetarian with eggs', 'Non-vegetarian', 'Vegan']);
    for (const d of m.DIETS) expect(accepts({ diet: d.value }), d.value).toBe(true);
    for (const n of m.MEALS_PER_DAY) expect(accepts({ mealsPerDay: n }), String(n)).toBe(true);
    // Both ends of the rail are offered, so no answer the server takes is
    // unreachable on the screen.
    expect(m.MEALS_PER_DAY).toEqual([2, 3, 4, 5, 6]);
    expect(accepts({ mealsPerDay: Math.min(...m.MEALS_PER_DAY) - 1 })).toBe(false);
    expect(accepts({ mealsPerDay: Math.max(...m.MEALS_PER_DAY) + 1 })).toBe(false);
  });

  it("screen 1 words the two questions as the goals ruling does, and screen 7 offers a gym (RULINGS 2026-09-10)", () => {
    expect(m.WEIGHT_GOALS.map((g) => g.label)).toEqual(['Lose weight', 'Keep my weight', 'Gain weight']);
    expect(m.GOALS.map((g) => g.label)).toEqual([
      'Build muscle',
      'Get stronger',
      'Get fitter',
      'Endurance and running',
      'Flexibility',
      'Posture',
      'Better balance',
      'Stress relief',
      'Stay healthy',
    ]);
    // Kd, at 4a-iv's click-through: "the bracket everything there not needed".
    expect(m.EQUIPMENT.at(-1)).toEqual({ value: 'gym', label: 'A gym' });
  });

  it('every weight choice, goal, level and kind of equipment has a line icon, and nothing else does', () => {
    const covered = (icons, options) => {
      expect(Object.keys(icons).sort()).toEqual([...options].sort());
      for (const icon of Object.values(icons)) expect(icon).toBeTruthy();
    };
    covered(WEIGHT_GOAL_ICONS, weightGoalSchema.options);
    covered(GOAL_ICONS, fitnessGoalSchema.options);
    covered(LEVEL_ICONS, fitnessLevelSchema.options);
    covered(EQUIPMENT_ICONS, equipmentSchema.options);
    covered(DIET_ICONS, dietSchema.options);
    // Every screen, the plan screen included, on the step bar and the plan's rows.
    covered(STEP_ICONS, m.SCREENS.map((s) => s.id));
  });

  it('draws its own icons where the library has none that fits, in the line style of the rest (Kd, 2026-09-10)', () => {
    expect(GOAL_ICONS.flexibility).toBe(SideStretch);
    expect(EQUIPMENT_ICONS.pull_up_bar).toBe(PullUpBar);
    expect(GOAL_ICONS.strength).toBe(Barbell);
    expect(GOAL_ICONS.balance).toBe(OneLegBalance);
    for (const Icon of [SideStretch, PullUpBar, Barbell, OneLegBalance]) {
      const svg = renderToStaticMarkup(createElement(Icon));
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('fill="none"');
      expect(svg).toContain('stroke-linecap="round"');
      expect(svg.match(/<(path|circle|rect)\b/g)?.length ?? 0).toBeGreaterThan(3);
    }
  });

  it('every day count and session length on screen 6 is one the server takes', () => {
    for (const n of m.TRAINING_DAYS) expect(accepts({ trainingDays: n }), String(n)).toBe(true);
    for (const n of m.SESSION_MINUTES) expect(accepts({ sessionMinutes: n }), String(n)).toBe(true);
  });

  it('every answer a refused finish can name has words and a screen that asks it', () => {
    // The finish's list, not the plan's: it carries the health question and
    // screen 9's two as well (4b-i, 4b-ii), and a key the screen cannot put a
    // name or a screen to would send the person looking for something that is
    // not there.
    const keys = [...missingSetupAnswerSchema.options].sort();
    // Which is the plan's own list plus those three, and not the other way
    // round: the plan itself is never missing any of them.
    for (const key of m.SETUP_ONLY_ANSWERS) expect([...missingPlanInputSchema.options], key).not.toContain(key);
    expect(keys).toEqual([...missingPlanInputSchema.options, ...m.SETUP_ONLY_ANSWERS].sort());
    expect(Object.keys(m.MISSING_LABELS).sort()).toEqual(keys);
    expect(Object.keys(m.SCREEN_OF_MISSING).sort()).toEqual(keys);
    const ids = m.SCREENS.map((s) => s.id);
    for (const id of Object.values(m.SCREEN_OF_MISSING)) expect(ids).toContain(id);
  });
});

describe('which screens a person sees, and where they land', () => {
  it('asks for a target and a pace only when the weight choice moves the weight, whatever goals are ticked', () => {
    const ids = (a) => m.visibleScreens(a).map((s) => s.id);
    expect(ids({ ...EMPTY, weightGoal: 'lose' })).toContain('target');
    expect(ids({ ...EMPTY, weightGoal: 'gain' })).toContain('target');
    expect(ids({ ...EMPTY, weightGoal: 'maintain' })).not.toContain('target');
    // Building muscle is not gaining weight (RULINGS 2026-09-11): ticked beside
    // keeping the weight, it asks for no target.
    expect(ids({ ...EMPTY, weightGoal: 'maintain', fitnessGoals: ['muscle_gain'] })).not.toContain('target');
    // Before the weight choice is made the step count does not jump when it is.
    expect(ids(EMPTY)).toHaveLength(11);
    expect(ids({ ...EMPTY, fitnessGoals: ['muscle_gain'] })).toHaveLength(11);
  });

  it('counts screen 1 answered on the weight choice alone: the goals beside it may be none', () => {
    expect(m.screenAnswered('goal', { ...EMPTY, weightGoal: 'maintain' })).toBe(true);
    expect(m.screenAnswered('goal', { ...EMPTY, fitnessGoals: ['muscle_gain', 'strength'] })).toBe(false);
  });

  it('lands on the first screen still unanswered, and on the last once all are', () => {
    expect(m.firstOpenScreen(EMPTY)).toBe('goal');
    // Where the people who picked Build muscle before 4a-iv land (RULINGS 2026-09-11).
    expect(m.firstOpenScreen({ ...ALL, weightGoal: null, fitnessGoals: ['muscle_gain'] })).toBe('goal');
    expect(m.firstOpenScreen({ ...EMPTY, weightGoal: 'lose', age: 30, gender: 'female', heightCm: 165, weightKg: 70 })).toBe('target');
    expect(m.firstOpenScreen({ ...EMPTY, weightGoal: 'maintain', age: 30, gender: 'female', heightCm: 165, weightKg: 70 })).toBe('day');
    // Screen 5's two checks may be "Not sure", so they never hold anyone: with
    // everything else in, this person lands on the last screen, their plan.
    expect(m.firstOpenScreen({ ...ALL, pushUpsMax: null, plankHoldSeconds: null })).toBe('plan');
    expect(m.firstOpenScreen({ ...ALL, availableEquipment: [] })).toBe('equipment');
    // Screen 8 is a screen like any other to the landing rule: unanswered, it
    // is where a person with everything else in lands. So is screen 9.
    expect(m.firstOpenScreen({ ...ALL, health: NO_HEALTH_ANSWER })).toBe('health');
    expect(m.firstOpenScreen({ ...ALL, diet: null })).toBe('food');
    expect(m.firstOpenScreen({ ...ALL, mealsPerDay: null })).toBe('food');
  });

  it('counts screen 9 answered only when BOTH food answers are given', () => {
    expect(m.screenAnswered('food', ALL)).toBe(true);
    expect(m.screenAnswered('food', { ...ALL, diet: null })).toBe(false);
    expect(m.screenAnswered('food', { ...ALL, mealsPerDay: null })).toBe(false);
    expect(m.screenAnswered('food', EMPTY)).toBe(false);
  });

  it('never holds anyone on screen 11: the gym code asks nothing', () => {
    // Most people have no code, and one who has may apply now, in Settings, or
    // never — so this screen is answered whatever the person has done.
    expect(m.screenAnswered('code', EMPTY)).toBe(true);
    expect(m.screenAnswered('code', ALL)).toBe(true);
    // …which is why the step bar can always reach it once everything before it
    // is answered. A person with every answer in lands one screen on, on the plan.
    expect([...m.reachableScreens(ALL)]).toContain('code');
    expect(m.firstOpenScreen(ALL)).toBe('plan');
    // And the server has no word for it either: nothing can be missing for it.
    expect([...missingSetupAnswerSchema.options]).not.toContain('code');
    expect(Object.values(m.SCREEN_OF_MISSING)).not.toContain('code');
  });

  it('names the food answers as open before any refusal, and drops each one as it is given', () => {
    // The plan's `missing` never carries them, so this is the only thing that
    // can put them in the sentence above Finish (4b-ii).
    expect(m.openSetupAnswers([], EMPTY)).toEqual(['health', 'diet', 'mealsPerDay']);
    expect(m.openSetupAnswers([], { ...ALL, diet: null })).toEqual(['diet']);
    expect(m.openSetupAnswers([], ALL)).toEqual([]);
    // The plan's own list keeps its place, in front, and is not touched.
    expect(m.openSetupAnswers(['age', 'weightKg'], { ...ALL, mealsPerDay: null })).toEqual(['age', 'weightKg', 'mealsPerDay']);
    // A refusal that named one is answered by giving it: the server's own word
    // is dropped rather than repeated, so the sentence stops naming it at once.
    expect(m.openSetupAnswers(['health', 'diet', 'mealsPerDay'], ALL)).toEqual([]);
    expect(m.openSetupAnswers(['diet'], { ...ALL, mealsPerDay: null })).toEqual(['mealsPerDay']);
    // Every one of them has words, so the sentence can never print a key.
    for (const key of m.SETUP_ONLY_ANSWERS) expect(m.MISSING_LABELS[key], key).toBeTruthy();
    expect(m.missingText(m.openSetupAnswers([], EMPTY))).toBe('the health question, your diet and how many meals a day');
  });

  it('counts screen 8 answered only once the server has stored the answer', () => {
    // A yes with no "Check first" is never stored, so it can never read as
    // answered: the contract refuses it (RULINGS 2026-09-09).
    expect(m.screenAnswered('health', { ...ALL, health: HEALTH_ANSWERED })).toBe(true);
    expect(m.screenAnswered('health', { ...ALL, health: NO_HEALTH_ANSWER })).toBe(false);
    expect(m.screenAnswered('health', { ...ALL, health: null })).toBe(false);
    expect(m.screenAnswered('health', ALL)).toBe(true);
  });

  it('lets the step bar reach every screen up to the first unanswered one, and none past it', () => {
    expect([...m.reachableScreens(EMPTY)]).toEqual(['goal']);
    expect([...m.reachableScreens({ ...EMPTY, weightGoal: 'maintain' })]).toEqual(['goal', 'about']);
    expect([...m.reachableScreens(ALL)]).toEqual(m.visibleScreens(ALL).map((s) => s.id));
    const gap = m.reachableScreens({ ...ALL, dayActivity: null });
    expect(gap.has('day')).toBe(true);
    expect(gap.has('training')).toBe(false);
    expect(gap.has('equipment')).toBe(false);
  });

  it('puts "Your code" first for a poster code, keeping the count, and lands and reaches in that order', () => {
    const codeFirst = { codeFirst: true };
    const ids = (a, order) => m.visibleScreens(a, order).map((s) => s.id);
    expect(ids(EMPTY, codeFirst)).toEqual(['code', ...ids(EMPTY).filter((id) => id !== 'code')]);
    expect(ids(EMPTY, codeFirst)).toHaveLength(ids(EMPTY).length);
    expect(ids({ ...EMPTY, weightGoal: 'maintain' }, codeFirst)).toEqual(
      ['code', ...ids({ ...EMPTY, weightGoal: 'maintain' }).filter((id) => id !== 'code')],
    );
    // Without a poster, nothing moves.
    expect(ids(EMPTY, { codeFirst: false })).toEqual(ids(EMPTY));
    // "Your code" never holds anyone, so its Continue goes to the first open
    // question — the last screen, your plan, once every one is answered.
    expect(m.firstOpenScreen(EMPTY, codeFirst)).toBe('goal');
    expect(m.firstOpenScreen({ ...ALL, availableEquipment: [] }, codeFirst)).toBe('equipment');
    expect(m.firstOpenScreen(ALL, codeFirst)).toBe('plan');
    expect([...m.reachableScreens(EMPTY, codeFirst)]).toEqual(['code', 'goal']);
    expect([...m.reachableScreens(ALL, codeFirst)]).toEqual(ids(ALL, codeFirst));
  });

  it('counts the plan screen answered exactly when every screen before it is, so it is reached last and landed on only then', () => {
    expect(m.SCREENS.at(-1).id).toBe('plan');
    expect(m.screenAnswered('plan', ALL)).toBe(true);
    // Keeping the weight asks no target, and the plan does not wait for one.
    expect(m.screenAnswered('plan', { ...ALL, weightGoal: 'maintain', targetWeightKg: null, pace: null })).toBe(true);
    for (const open of [{ dayActivity: null }, { availableEquipment: [] }, { health: NO_HEALTH_ANSWER }, { mealsPerDay: null }, { targetWeightKg: 80 }]) {
      expect(m.screenAnswered('plan', { ...ALL, ...open }), JSON.stringify(open)).toBe(false);
      expect([...m.reachableScreens({ ...ALL, ...open })], JSON.stringify(open)).not.toContain('plan');
    }
    // Push-ups and plank may be "Not sure" there too.
    expect(m.screenAnswered('plan', { ...ALL, pushUpsMax: null, plankHoldSeconds: null })).toBe(true);
    expect(m.reachableScreens(ALL).has('plan')).toBe(true);
    // With a poster's code first, the plan stays last.
    expect(m.visibleScreens(ALL, { codeFirst: true }).at(-1).id).toBe('plan');
  });

  it('counts screen 5 answered on the self-rating alone: push-ups and plank may be "Not sure"', () => {
    expect(m.screenAnswered('training', { ...EMPTY, fitnessLevel: 'beginner' })).toBe(true);
    expect(m.screenAnswered('training', { ...EMPTY, pushUpsMax: 10, plankHoldSeconds: 30 })).toBe(false);
  });

  it('names what is missing in words, and passes an unknown key through rather than dropping it', () => {
    expect(m.missingText(['health'])).toBe('the health question');
    expect(m.missingText(['dayActivity'])).toBe('your day');
    expect(m.missingText(['trainingDays', 'sessionMinutes'])).toBe('training days a week and session length');
    expect(m.missingText(['age', 'gender', 'somethingNew'])).toBe('your age, your gender and somethingNew');
  });
});

describe('"No equipment" stands alone', () => {
  it('clears the rest when tapped, a gym included, and is cleared by anything else', () => {
    expect(m.toggleEquipment(['dumbbells', 'kettlebells'], 'none')).toEqual(['none']);
    expect(m.toggleEquipment(['gym', 'dumbbells'], 'none')).toEqual(['none']);
    expect(m.toggleEquipment(['none'], 'dumbbells')).toEqual(['dumbbells']);
    expect(m.toggleEquipment(['none'], 'gym')).toEqual(['gym']);
    expect(m.toggleEquipment(['none'], 'none')).toEqual([]);
    expect(m.toggleEquipment(['pull_up_bar'], 'dumbbells')).toEqual(['dumbbells', 'pull_up_bar']);
    // A gym beside home equipment: both are real answers.
    expect(m.toggleEquipment(['dumbbells'], 'gym')).toEqual(['dumbbells', 'gym']);
    expect(m.toggleEquipment(['dumbbells', 'pull_up_bar'], 'dumbbells')).toEqual(['pull_up_bar']);
  });

  it('never produces a set the server refuses, whatever the taps', () => {
    let set = [];
    for (const tap of ['dumbbells', 'none', 'gym', 'kettlebells', 'pull_up_bar', 'none', 'none', 'resistance_bands', 'gym', 'dumbbells']) {
      set = m.toggleEquipment(set, tap);
      expect(accepts({ availableEquipment: set }), JSON.stringify(set)).toBe(true);
    }
  });

  it('loads an old answer of "none" beside equipment as the equipment alone', () => {
    expect(accepts({ availableEquipment: ['none', 'dumbbells'] })).toBe(false);
    expect(m.cleanEquipment(['none', 'dumbbells'])).toEqual(['dumbbells']);
    expect(m.cleanEquipment(['none'])).toEqual(['none']);
    expect(m.cleanEquipment([])).toEqual([]);
  });
});

describe("screen 1's goals: any number, and no tap unticks another (RULINGS 2026-09-10)", () => {
  it("ticks and unticks one goal at a time, in the screen's order", () => {
    expect(m.toggleGoal([], 'balance')).toEqual(['balance']);
    expect(m.toggleGoal(['balance'], 'muscle_gain')).toEqual(['muscle_gain', 'balance']);
    expect(m.toggleGoal(['muscle_gain', 'balance'], 'muscle_gain')).toEqual(['balance']);
    expect(m.toggleGoal(undefined, 'strength')).toEqual(['strength']);
  });

  it('never produces a list the server refuses, whatever the taps', () => {
    const every = m.GOALS.map((g) => g.value);
    let list = [];
    for (const tap of [...every, 'muscle_gain', 'posture', 'muscle_gain', ...every]) {
      list = m.toggleGoal(list, tap);
      expect(accepts({ fitnessGoals: list }), JSON.stringify(list)).toBe(true);
    }
  });

  it('takes any of the three weight choices whatever goals are ticked: no contradiction can be picked', () => {
    for (const weightGoal of weightGoalSchema.options) {
      expect(accepts({ weightGoal, fitnessGoals: m.GOALS.map((g) => g.value) }), weightGoal).toBe(true);
    }
  });
});

describe('the wheels (Kd, 2026-09-10: nothing typed, nothing pre-filled)', () => {
  it('offer ages from 16 to 120, every one an age the server takes, and nothing younger', () => {
    const ages = m.ageList(null);
    expect([ages[0], ages[ages.length - 1]]).toEqual([16, 120]);
    for (const age of ages) expect(accepts({ age }), String(age)).toBe(true);
    expect(accepts({ age: 15 })).toBe(false);
  });

  it('weight: every pair of rows, in both units, is a weight the server takes and reads back as itself', () => {
    const bad = [];
    for (const units of ['metric', 'imperial']) {
      for (const whole of m.weightWholes(units, null)) {
        for (const tenth of m.TENTHS) {
          const kg = m.kgFromParts({ whole, tenth }, units);
          const back = m.weightParts(kg, units);
          if (!accepts({ weightKg: kg }) || back.whole !== whole || back.tenth !== tenth) bad.push(`${units} ${whole}.${tenth}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(m.kgFromParts({ whole: 154, tenth: 0 }, 'imperial')).toBe(69.85);
    expect(m.weightParts(70, 'imperial')).toEqual({ whole: 154, tenth: 3 });
    expect(m.weightShown({ whole: 70, tenth: 5 }, 'metric')).toBe('70.5 kg');
  });

  it('height: every row, centimetres or feet and inches, is a height the server takes and reads back as itself', () => {
    const bad = [];
    for (const cm of m.heightCmList(null)) {
      if (!accepts({ heightCm: cm }) || m.heightParts(cm, 'metric').cm !== cm) bad.push(`${cm} cm`);
    }
    for (const ft of m.heightFeetList(null)) {
      for (const inch of m.INCHES) {
        const cm = m.cmFromParts({ ft, inch }, 'imperial');
        const back = m.heightParts(cm, 'imperial');
        if (!accepts({ heightCm: cm }) || back.ft !== ft || back.inch !== inch) bad.push(`${ft} ft ${inch} in`);
      }
    }
    expect(bad).toEqual([]);
    expect(m.cmFromParts({ ft: 5, inch: 9 }, 'imperial')).toBe(175.26);
    expect(m.heightParts(165, 'imperial')).toEqual({ ft: 5, inch: 5 });
    expect(m.heightShown({ ft: 5, inch: 9 }, 'imperial')).toBe('5 ft 9 in');
  });

  it('screen 5: every push-up count and plank time on the wheels is one the server takes', () => {
    for (const n of m.pushUpList(null)) expect(accepts({ pushUpsMax: n }), String(n)).toBe(true);
    for (const s of m.plankList(null)) expect(accepts({ plankHoldSeconds: s }), String(s)).toBe(true);
    expect(m.plankShown(45)).toBe('45 s');
    expect(m.plankShown(60)).toBe('1 min');
    expect(m.plankShown(95)).toBe('1 min 35 s');
    expect(m.pushUpShown(1)).toBe('1 push-up');
    expect(m.pushUpShown(12)).toBe('12 push-ups');
  });

  it('a stored answer outside a list stretches the list to include it, so it is never shown as another number', () => {
    expect(m.heightCmList(60)[0]).toBe(60);
    expect(m.heightFeetList(2)[0]).toBe(2);
    expect(m.weightWholes('metric', 20)[0]).toBe(20);
    expect(m.pushUpList(250)).toContain(250);
    const plank = m.plankList(47); // an old stopwatch answer, off the five-second grid
    expect(plank.indexOf(47)).toBe(plank.indexOf(45) + 1);
  });

  it('− and + move one row and stop at the ends; an inch carries into the feet', () => {
    const ages = m.ageList(null);
    expect(m.stepIn(ages, 30, 1)).toBe(31);
    expect(m.stepIn(ages, 16, -1)).toBe(16);
    expect(m.stepIn(ages, 120, 1)).toBe(120);
    expect(m.stepIn(m.plankList(null), 30, 1)).toBe(35);
    expect(m.stepInches({ ft: 5, inch: 11 }, 1)).toEqual({ ft: 6, inch: 0 });
    expect(m.stepInches({ ft: 6, inch: 0 }, -1)).toEqual({ ft: 5, inch: 11 });
  });

  it('the target wheel offers only weights on the goal\'s side, in both units, for every weight it can show', () => {
    // Every weight the weight wheel can show × every row the target wheel then
    // offers: each row, back in kilograms, is strictly on the goal's side and
    // is a target the server takes. Nothing on the wheel can contradict the goal.
    const bad = [];
    let rows = 0;
    for (const units of ['metric', 'imperial']) {
      for (const whole of m.weightWholes(units, null)) {
        for (const tenth of m.TENTHS) {
          const weightKg = m.kgFromParts({ whole, tenth }, units);
          const weight = m.weightParts(weightKg, units);
          for (const direction of ['lose', 'gain']) {
            const wholes = m.targetWholes(units, direction, weight);
            const offered = wholes.flatMap((w) => m.targetTenths(direction, weight, w).map((t) => ({ whole: w, tenth: t })));
            for (const row of offered) {
              rows += 1;
              if (m.targetWrongSide(direction, m.kgFromParts(row, units), weightKg)) {
                bad.push(`${units} ${direction} weight ${whole}.${tenth} offered ${row.whole}.${row.tenth}`);
              }
            }
            // The two ends of what is offered are targets the server takes
            // (every row between them is a weight the weight wheel already
            // proved above).
            for (const row of [offered[0], offered[offered.length - 1]]) {
              if (!accepts({ targetWeightKg: m.kgFromParts(row, units) })) bad.push(`refused ${units} ${direction} ${row.whole}.${row.tenth}`);
            }
            // The edge and the resting row are offered, and a pick on the weight's own row is pulled onto the right side.
            for (const row of [m.targetEdge(direction, weight), m.targetRest(direction, weight)]) {
              if (!wholes.includes(row.whole) || !m.targetTenths(direction, weight, row.whole).includes(row.tenth)) bad.push(`row ${units} ${direction} ${whole}.${tenth}`);
            }
            const clamped = m.clampTarget(direction, weight, weight);
            if (m.targetWrongSide(direction, m.kgFromParts(clamped, units), weightKg)) bad.push(`clamp ${units} ${direction} ${whole}.${tenth}`);
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(rows).toBeGreaterThan(100_000);
  });

  it("names a target on the wrong side in screen 3's words, in the units on show", () => {
    expect(m.wrongSideText('lose', 83, 70, 'metric')).toBe('83.0 kg is not below your current 70.0 kg. Pick a weight below it.');
    expect(m.wrongSideText('gain', 65, 70, 'metric')).toBe('65.0 kg is not above your current 70.0 kg. Pick a weight above it.');
    expect(m.wrongSideText('gain', 65, 70, 'imperial')).toBe('143.3 lb is not above your current 154.3 lb. Pick a weight above it.');
  });

  it('a target at or past the weight is the wrong side; the screen then stays unanswered', () => {
    expect(m.targetWrongSide('lose', 83, 70)).toBe(true);
    expect(m.targetWrongSide('lose', 70, 70)).toBe(true);
    expect(m.targetWrongSide('lose', 69.9, 70)).toBe(false);
    expect(m.targetWrongSide('gain', 65, 70)).toBe(true);
    expect(m.targetWrongSide('gain', 70.1, 70)).toBe(false);
    expect(m.targetWrongSide('lose', null, 70)).toBe(false);
    expect(m.screenAnswered('target', { ...ALL, targetWeightKg: 83 })).toBe(false);
    expect(m.screenAnswered('target', { ...ALL, weightGoal: 'gain', targetWeightKg: 83 })).toBe(true);
    expect(m.screenAnswered('target', ALL)).toBe(true);
    // A weight changed on screen 2 after the target was set re-opens screen 3.
    expect(m.firstOpenScreen({ ...ALL, weightKg: 60 })).toBe('target');
    expect(m.reachableScreens({ ...ALL, weightKg: 60 }).has('day')).toBe(false);
    // The wheel itself: 70.0 kg losing offers up to 69.9; gaining from 70.1.
    expect(Math.max(...m.targetWholes('metric', 'lose', { whole: 70, tenth: 0 }))).toBe(69);
    expect(m.targetTenths('lose', { whole: 70, tenth: 3 }, 70)).toEqual([0, 1, 2]);
    expect(Math.min(...m.targetWholes('metric', 'gain', { whole: 70, tenth: 9 }))).toBe(71);
    expect(m.targetEdge('gain', { whole: 70, tenth: 9 })).toEqual({ whole: 71, tenth: 0 });
    expect(m.targetEdge('lose', { whole: 70, tenth: 0 })).toEqual({ whole: 69, tenth: 9 });
    // It rests on a whole number, so a tap on "65" is 65.0.
    expect(m.targetRest('lose', { whole: 70, tenth: 0 })).toEqual({ whole: 69, tenth: 0 });
    expect(m.targetRest('lose', { whole: 70, tenth: 3 })).toEqual({ whole: 70, tenth: 0 });
    expect(m.targetRest('gain', { whole: 70, tenth: 3 })).toEqual({ whole: 71, tenth: 0 });
  });

  it('a target stored in the other units sits on a row the wheel offers, never on the weight\'s own row', () => {
    // Every weight on the wheel of one unit, with its nearest target on each
    // side, stored in kilograms and shown in the other unit: 140.0 lb and
    // 139.9 lb are stored as 63.5 and 63.46 kg, which both read 63.5 kg.
    const bad = [];
    let sameRow = 0;
    for (const [from, to] of [['imperial', 'metric'], ['metric', 'imperial']]) {
      for (const whole of m.weightWholes(from, null)) {
        for (const tenth of m.TENTHS) {
          const weightKg = m.kgFromParts({ whole, tenth }, from);
          const weight = m.weightParts(weightKg, to);
          for (const direction of ['lose', 'gain']) {
            const targetKg = m.kgFromParts(m.targetEdge(direction, m.weightParts(weightKg, from)), from);
            const own = m.weightParts(targetKg, to);
            if (own.whole === weight.whole && own.tenth === weight.tenth) sameRow += 1;
            const row = m.targetRow(direction, weight, targetKg, to);
            const offered =
              m.targetWholes(to, direction, weight, row).includes(row.whole) &&
              m.targetTenths(direction, weight, row.whole).includes(row.tenth);
            const onWeight = row.whole === weight.whole && row.tenth === weight.tenth;
            if (m.targetWrongSide(direction, targetKg, weightKg) || !offered || onWeight) {
              bad.push(`${from} to ${to} ${direction} ${whole}.${tenth}`);
            }
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(sameRow).toBeGreaterThan(0); // the case is real: rounding does put some there
    // A stored target past the ends of the list is on the wheel too.
    expect(m.targetWholes('metric', 'lose', { whole: 70, tenth: 0 }, { whole: 25, tenth: 0 })[0]).toBe(25);
    expect(m.targetWholes('metric', 'gain', { whole: 240, tenth: 0 }, { whole: 260, tenth: 0 }).at(-1)).toBe(260);
  });

  it('starts in pounds and feet for a US browser, kilograms and centimetres elsewhere', () => {
    expect(m.defaultUnits('en-US')).toBe('imperial');
    expect(m.defaultUnits('en-GB')).toBe('metric');
    expect(m.defaultUnits('hi-IN')).toBe('metric');
    expect(m.defaultUnits(undefined)).toBe('metric');
  });
});

/** The route's golden person (users.onboarding.routes.test.ts), working and all. */
const WORKINGS = {
  resting: { formula: 'female', weightKg: 70, heightCm: 165, age: 30, constant: -161, kcal: 1420 },
  day: { activity: 'sitting', factor: 1.2, kcal: 1704 },
  training: { kcalPerKgHour: 5, weightKg: 70, trainingDays: 3, sessionMinutes: 45, kcal: 113 },
  change: { pace: 'steady', kgPerWeek: 0.5, kcalPerKg: 7700, kcal: -550 },
  beforeFloorKcal: 1267,
  floorKcal: 1200,
  protein: { gPerKg: 2, weightKg: 70, referenceBmi: null, wantedG: 140, buildMuscle: false },
  fatShare: 0.25,
  carbsFloorG: 50,
  finish: { kgToMove: 5, kcalPerKg: 7700 },
};

describe('the plan panel says what the server said', () => {
  const plan = {
    restingBurnKcal: 1420, dailyBurnKcal: 1817, targetKcal: 1267, dailyChangeKcal: -550,
    proteinG: 140, carbsG: 98, fatG: 35, plannedTargetKg: 65, daysToTarget: 70, finishDate: '2026-11-19', flags: [],
    workings: WORKINGS,
  };

  afterEach(() => {
    process.env.TZ = 'Asia/Kolkata';
  });

  it('is a plan the shared contract accepts, working included', () => {
    expect(planNumbersSchema.safeParse(plan).success).toBe(true);
  });

  it('shows the finish day as that day, even west of Greenwich', () => {
    for (const zone of ['America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Kiritimati', 'Asia/Kolkata']) {
      process.env.TZ = zone;
      expect(m.dayText('2026-11-19'), zone).toBe('Nov 19, 2026');
    }
  });

  it('subtracts in words exactly as the numbers do', () => {
    expect(m.changeLine(plan)).toBe('550 less than the 1,817 you burn a day');
    expect(m.changeLine({ ...plan, dailyChangeKcal: 550 })).toBe('550 more than the 1,817 you burn a day');
    expect(m.changeLine({ ...plan, dailyChangeKcal: 0 })).toBe('The same as the 1,817 you burn a day');
  });

  it('names the target and its date, or the weight it keeps, or nothing when the flags say it', () => {
    expect(m.targetLine(plan, 'metric')).toBe('Reach 65 kg around Nov 19, 2026.');
    expect(m.targetLine(plan, 'imperial')).toBe('Reach 143.3 lb around Nov 19, 2026.');
    expect(m.targetLine({ ...plan, daysToTarget: null, finishDate: null, dailyChangeKcal: 0, plannedTargetKg: 70 }, 'metric'))
      .toBe('Keeps your weight at 70 kg.');
    expect(m.targetLine({ ...plan, daysToTarget: null, finishDate: null, dailyChangeKcal: 40 }, 'metric')).toBeNull();
  });

  it('turns every flag the server can raise into one plain sentence', () => {
    const samples = {
      target_wrong_direction: [{ code: 'target_wrong_direction' }],
      target_below_healthy_weight: [{ code: 'target_below_healthy_weight', floorKg: 50.4 }],
      pace_over_a_year: [{ code: 'pace_over_a_year', suggestedPace: 'brisk' }, { code: 'pace_over_a_year', suggestedPace: null }],
      calorie_floor_applied: [{ code: 'calorie_floor_applied', floorKcal: 1200 }],
      no_deficit: [{ code: 'no_deficit', reasons: ['under_18', 'health_answer', 'safe_mode'] }],
      target_out_of_reach: [{ code: 'target_out_of_reach' }],
      cut_limits_muscle_gain: [
        { code: 'cut_limits_muscle_gain', limitKcal: 500, suggestedPace: 'gentle' },
        { code: 'cut_limits_muscle_gain', limitKcal: 500, suggestedPace: null },
      ],
    };
    const codes = planFlagSchema.options.map((o) => o.shape.code.value).sort();
    expect(Object.keys(samples).sort()).toEqual(codes);
    for (const flags of Object.values(samples)) {
      for (const flag of flags) {
        expect(planFlagSchema.safeParse(flag).success, flag.code).toBe(true);
        const lines = m.flagLines({ ...plan, flags: [flag] }, 'lose', 'metric');
        expect(lines, flag.code).toHaveLength(1);
        expect(lines[0], flag.code).toMatch(/\.$/);
      }
    }
    expect(m.flagLines({ ...plan, flags: samples.no_deficit }, 'lose', 'metric')).toEqual([
      'This plan has no calorie cut because you are under 18, you answered yes to the health question and Safe mode is on.',
    ]);
    expect(m.flagLines({ ...plan, flags: samples.pace_over_a_year }, 'lose', 'metric')).toEqual([
      'At this pace your target is more than a year away. The brisk pace gets there within a year.',
      'At this pace your target is more than a year away, and no pace gets there within a year.',
    ]);
    // Kd, 2026-09-13: tell them, and name the pace that leaves muscle room to grow.
    expect(m.flagLines({ ...plan, flags: samples.cut_limits_muscle_gain }, 'lose', 'metric')).toEqual([
      'Building muscle while losing weight: a cut of more than 500 kcal a day mostly stops muscle growing. The gentle pace leaves room for it.',
      'Building muscle while losing weight: a cut of more than 500 kcal a day mostly stops muscle growing.',
    ]);
    expect(m.flagLines({ ...plan, flags: samples.target_wrong_direction }, 'gain', 'metric')[0]).toMatch(/not above/);
    // "Slower than the pace you picked" is said only when the plan still moves.
    expect(m.flagLines({ ...plan, flags: samples.calorie_floor_applied }, 'lose', 'metric')[0]).toMatch(/slower/);
    expect(
      m.flagLines({ ...plan, flags: [...samples.calorie_floor_applied, { code: 'target_out_of_reach' }] }, 'lose', 'metric')[0],
    ).not.toMatch(/slower/);
  });

  it('shows the pace cards the rate the plan maths uses', () => {
    expect(m.paceText('gentle', 'metric')).toBe('about 0.25 kg a week');
    expect(m.paceText('brisk', 'imperial')).toBe('about 1.7 lb a week');
  });

  it('notes under the number the opening sentence of the plan-screen disclaimer, word for word', () => {
    const full = DISCLAIMER_WORDINGS.plan_screen[CURRENT_DISCLAIMER_VERSION.plan_screen];
    expect(full.startsWith(m.PLAN_NOTE)).toBe(true);
    expect(m.PLAN_NOTE).toBe('These numbers are general guidance, not medical advice.');
  });

  it('"How is this worked out?" prints the server\'s own steps, each sum as its numbers make it', () => {
    const steps = m.workingSteps(plan, 'lose');
    expect(steps.map((s) => [s.title, s.sum])).toEqual([
      ['Resting burn', '10 × 70 kg + 6.25 × 165 cm − 5 × 30 years − 161 = 1,420 kcal'],
      ['Your day', '1,420 × 1.2 = 1,704 kcal'],
      ['Your training', '5 × 70 kg × 135 minutes ÷ 60 ÷ 7 days = 113 kcal a day'],
      ['You burn', '1,704 + 113 = 1,817 kcal a day'],
      ['Your pace', '0.5 kg a week × 7,700 kcal ÷ 7 days = 550 kcal a day'],
      ['To eat', '1,817 − 550 = 1,267 kcal a day'],
      ['Protein', '2 g × 70 kg = 140 g'],
      ['Fat', '25% of 1,267 kcal ÷ 9 kcal a gram = 35 g'],
      ['Carbohydrates', 'The rest of the calories ÷ 4 kcal a gram = 98 g'],
      ['Your finish date', '5 kg × 7,700 kcal ÷ 550 kcal a day = 70 days'],
    ]);
    // Each source is the one plan/maths.ts names, or the app's own said plainly.
    const notes = Object.fromEntries(steps.map((s) => [s.title, s.note]));
    expect(notes['Resting burn']).toBe(
      'The Mifflin-St Jeor equation (1990), which the Academy of Nutrition and Dietetics recommends: its version for women.',
    );
    expect(notes['Your day']).toBe('1.2 is the standard figure for a day spent mostly sitting.');
    expect(notes['Your training']).toMatch(/the app's own estimate\.$/);
    expect(notes['Your pace']).toMatch(/usual planning figure \(Wishnofsky\)/);
    expect(notes['Protein']).toBe(
      '2 g per kilo for a weight-loss goal: sports nutrition recommends 1.4 to 2.0 g per kilo a day for people who train, and more while eating less, to keep muscle (ISSN, 2017).',
    );
  });

  it('names the review behind the muscle line under "Your pace", and only when the plan raised it', () => {
    const pace = (p) => m.workingSteps(p, 'lose').find((s) => s.title === 'Your pace').note;
    expect(pace(plan)).not.toMatch(/Murphy/);
    const flagged = { ...plan, flags: [{ code: 'cut_limits_muscle_gain', limitKcal: 500, suggestedPace: 'gentle' }] };
    expect(pace(flagged)).toBe(
      '7,700 kcal per kilo is the usual planning figure (Wishnofsky). Real weight change is often slower, so the date is an estimate. ' +
        'A review of trials that trained while eating less found that a cut of about 500 kcal a day stopped the muscle training builds (Murphy and Koehler, 2022).',
    );
  });

  it('never says "while losing weight" under a plan that holds the weight', () => {
    // A "Lose weight" goal whose plan has no cut (under 18, a health yes, or a
    // target out of reach): the protein figure is still the goal's, but nobody is losing.
    const held = {
      ...plan,
      targetKcal: 1817,
      dailyChangeKcal: 0,
      workings: { ...WORKINGS, change: null, beforeFloorKcal: 1817, finish: null },
    };
    const note = m.workingSteps(held, 'lose').find((s) => s.title === 'Protein').note;
    expect(note).not.toMatch(/while losing weight/);
    expect(note).toBe(
      '2 g per kilo for a weight-loss goal: sports nutrition recommends 1.4 to 2.0 g per kilo a day for people who train, and more while eating less, to keep muscle (ISSN, 2017).',
    );
  });

  it("names the source of each goal's protein figure, and the weight a heavier body is counted on", () => {
    const protein = (p, direction) => m.workingSteps(p, direction).find((s) => s.title === 'Protein');
    const withProtein = (figures, proteinG) => ({ ...plan, proteinG, workings: { ...WORKINGS, protein: { ...WORKINGS.protein, ...figures } } });
    expect(protein(withProtein({ gPerKg: 1.6, wantedG: 112 }, 112), 'maintain').note).toBe(
      '1.6 g per kilo, inside the 1.4 to 2.0 g per kilo a day sports nutrition recommends for people who train (ISSN, 2017).',
    );
    // A weight gain is worded for the weight, never as building muscle (RULINGS
    // 2026-09-11: building muscle is not gaining weight).
    expect(protein(withProtein({ gPerKg: 2.2, wantedG: 154 }, 154), 'gain').note).toBe(
      '2.2 g per kilo for a weight-gain goal: the top of the 1.6 to 2.2 g per kilo a day a review recommends for people who lift weights while eating more than they burn (Iraki and colleagues, 2019).',
    );
    // Build muscle ticked sets the figure whatever the weight choice, and says so.
    for (const direction of ['lose', 'maintain', 'gain']) {
      expect(protein(withProtein({ gPerKg: 2.2, wantedG: 154, buildMuscle: true }, 154), direction).note, direction).toBe(
        '2.2 g per kilo because you are building muscle: the amount a review of 49 studies suggests for anyone trying to build as much muscle as they can (Morton and colleagues, 2018).',
      );
    }
    // The golden woman at 100 kg: BMI 30 at 165 cm is 81.68 kg (Kd, 2026-09-11).
    const heavy = {
      ...plan,
      proteinG: 163,
      workings: {
        ...WORKINGS,
        resting: { ...WORKINGS.resting, weightKg: 100 },
        protein: { gPerKg: 2, weightKg: 81.68, referenceBmi: 30, wantedG: 163 },
      },
    };
    expect(protein(heavy, 'lose')).toEqual({
      title: 'Protein',
      sum: '2 g × 81.68 kg = 163 g',
      note:
        'Counted on 81.68 kg, the weight at a BMI of 30 for your height, rather than your 100 kg, as protein guidance for heavier bodies does (Weijs, 2025). ' +
        '2 g per kilo for a weight-loss goal: sports nutrition recommends 1.4 to 2.0 g per kilo a day for people who train, and more while eating less, to keep muscle (ISSN, 2017).',
    });
    // Without a goal to name, the figure is still said, as the app's own.
    expect(protein(plan).note).toBe("2 g per kilo is the app's own figure for your goal.");
  });

  it('names the men\'s formula for every answer but Female, and the day factors that are the app\'s own', () => {
    const men = m.workingSteps({ ...plan, workings: { ...WORKINGS, resting: { ...WORKINGS.resting, formula: 'male', constant: 5 } } })[0];
    expect(men.sum).toMatch(/− 5 × 30 years \+ 5 = /);
    expect(men.note).toMatch(/its version for men, which the app uses for every answer but Female\.$/);
    for (const [activity, factor] of [['on_feet', 1.3], ['active', 1.45], ['very_active', 1.6]]) {
      const day = m.workingSteps({ ...plan, workings: { ...WORKINGS, day: { activity, factor, kcal: 0 } } })[1];
      expect(day.note, activity).toMatch(new RegExp(`^${factor} is the app's own estimate`));
    }
  });

  it('says so when the floor stopped the cut, when protein gave way, and when the plan holds the weight', () => {
    const floored = {
      ...plan,
      targetKcal: 1200,
      workings: { ...WORKINGS, change: { ...WORKINGS.change, pace: 'brisk', kgPerWeek: 0.75, kcal: -825 }, beforeFloorKcal: 992 },
    };
    expect(m.workingSteps(floored).find((s) => s.title === 'To eat')).toEqual({
      title: 'To eat',
      sum: '1,817 − 825 = 992 kcal, under the floor, so 1,200 kcal a day',
      note: 'The app never sets fewer than 1,200 kcal a day.',
    });

    const gaveWay = { ...plan, proteinG: 120 };
    expect(m.workingSteps(gaveWay).find((s) => s.title === 'Protein').sum).toBe(
      "2 g × 70 kg would be 140 g, more than the day's calories leave room for, so 120 g",
    );

    const held = {
      ...plan,
      targetKcal: 1817,
      dailyChangeKcal: 0,
      daysToTarget: null,
      finishDate: null,
      workings: { ...WORKINGS, change: null, beforeFloorKcal: 1817, finish: null },
    };
    const steps = m.workingSteps(held);
    expect(steps.map((s) => s.title)).not.toContain('Your pace');
    expect(steps.map((s) => s.title)).not.toContain('Your finish date');
    expect(steps.find((s) => s.title === 'To eat')).toMatchObject({
      sum: '1,817 kcal a day',
      note: 'The same as you burn, so your weight stays where it is.',
    });
  });
});

describe('the plan screen (ROADMAP 4c)', () => {
  it('lists every screen that asks something, in its order, each answer in the words its screen uses', () => {
    const everything = {
      ...ALL,
      displayName: 'Kd',
      fitnessGoals: ['muscle_gain', 'posture'],
      pushUpsMax: 12,
      plankHoldSeconds: 90,
      availableEquipment: ['dumbbells', 'gym'],
      diet: 'vegetarian_eggs',
      mealsPerDay: 4,
    };
    expect(m.answerRows(everything, 'metric')).toEqual([
      { id: 'goal', title: 'Your goal', value: 'Lose weight · Build muscle · Posture' },
      { id: 'about', title: 'About you', value: 'Kd · 30 years · Female · 165 cm · 70.0 kg' },
      { id: 'target', title: 'Your target', value: '65.0 kg · Steady, about 0.5 kg a week' },
      { id: 'day', title: 'Your day', value: 'Mostly sitting' },
      { id: 'training', title: 'Your training', value: 'Beginner · 12 push-ups · 1 min 30 s plank' },
      { id: 'week', title: 'Your week', value: '3 days a week · 45 minutes' },
      { id: 'equipment', title: 'Equipment', value: 'Dumbbells · A gym' },
      { id: 'health', title: 'Health', value: 'No' },
      { id: 'food', title: 'Food', value: 'Vegetarian with eggs · 4 meals a day' },
    ]);
    // In the units on show, as the wheels show them.
    const imperial = Object.fromEntries(m.answerRows(everything, 'imperial').map((r) => [r.id, r.value]));
    expect(imperial.about).toBe('Kd · 30 years · Female · 5 ft 5 in · 154.3 lb');
    expect(imperial.target).toBe('143.3 lb · Steady, about 1.1 lb a week');
    // Keeping the weight asks no target, so there is no row for one; a skipped
    // check is left out rather than printed as nothing.
    const kept = m.answerRows({ ...everything, weightGoal: 'maintain', fitnessGoals: [], pushUpsMax: null, plankHoldSeconds: null }, 'metric');
    expect(kept.map((r) => r.id)).not.toContain('target');
    expect(kept.find((r) => r.id === 'goal').value).toBe('Keep my weight');
    expect(kept.find((r) => r.id === 'training').value).toBe('Beginner');
    // Never the gym code, and never the plan itself.
    expect(kept.map((r) => r.id)).not.toContain('code');
    expect(kept.map((r) => r.id)).not.toContain('plan');
  });

  it('says the health answer as it was given, and "Not answered" for anything open, never a blank', () => {
    const health = (screening) => m.answerValue('health', { ...ALL, health: screening }, 'metric');
    expect(health(HEALTH_ANSWERED)).toBe('No');
    expect(health({ ...HEALTH_ANSWERED, hasCondition: true, checkFirst: 'cleared', noCalorieCut: true })).toBe(
      'Yes · A professional has cleared me',
    );
    expect(health({ ...HEALTH_ANSWERED, hasCondition: true, checkFirst: 'not_yet', safeMode: true, noCalorieCut: true })).toBe('Yes · Not yet');
    expect(health(NO_HEALTH_ANSWER)).toBe(m.NOT_ANSWERED);
    // Only the weight choice given: every other row says so, and none is blank.
    const rows = m.answerRows({ ...EMPTY, weightGoal: 'lose', displayName: '' }, 'metric');
    expect(rows.map((r) => r.value)).toEqual(['Lose weight', ...Array(rows.length - 1).fill(m.NOT_ANSWERED)]);
  });

  it('puts the week of workouts in the words of the answers, and names no workout', () => {
    expect(m.workoutsLine(ALL)).toBe('3 workouts a week, 45 minutes each');
    expect(m.workoutsLine({ ...ALL, trainingDays: 1, sessionMinutes: 20 })).toBe('1 workout a week, 20 minutes each');
    expect(m.workoutsLine({ ...ALL, sessionMinutes: null })).toBeNull();
    expect(m.workoutsDetail(ALL)).toBe('Beginner · Dumbbells');
    expect(m.workoutsDetail({ ...ALL, availableEquipment: ['none'] })).toBe('Beginner · No equipment');
    expect(m.CLEARED_LINE).toBe('A professional has cleared you. Follow their advice.');
  });

  it("marks the pace that leaves muscle room to grow, only for someone losing weight with Build muscle ticked", () => {
    const muscle = ['muscle_gain', 'posture'];
    expect(m.PACES.map((p) => m.paceNote(p.value, 'lose', muscle))).toEqual(['Best if you also build muscle', null, null]);
    // The pace the server's own plan line suggests, from the one shared table.
    expect(m.PACES.map((p) => p.value).filter((p) => m.paceNote(p, 'lose', muscle))).toEqual([MUSCLE_GAIN_PACE]);
    for (const [direction, goals] of [['lose', ['posture']], ['lose', []], ['gain', muscle], ['maintain', muscle], [null, muscle]]) {
      expect(m.PACES.map((p) => m.paceNote(p.value, direction, goals)), `${direction} ${goals}`).toEqual([null, null, null]);
    }
  });
});

describe('saving as you go', () => {
  it('sends one save at a time, merges the taps made meanwhile, and the last tap wins', async () => {
    const sent = [];
    const release = [];
    const onSaved = vi.fn();
    const q = m.createSaveQueue({
      send: (patch) =>
        new Promise((resolve) => {
          sent.push(patch);
          release.push(() => resolve({ echo: patch }));
        }),
      onSaved,
      onFailed: vi.fn(),
    });
    q.save({ dayActivity: 'sitting' });
    q.save({ dayActivity: 'active' });
    q.save({ trainingDays: 3 });
    expect(sent).toEqual([{ dayActivity: 'sitting' }]);
    release[0]();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ dayActivity: 'active', trainingDays: 3 });
    const done = q.settled();
    release[1]();
    expect(await done).toBe(true);
    expect(onSaved).toHaveBeenLastCalledWith({ echo: sent[1] }, sent[1]);
  });

  it('reports a failed save to whoever is waiting, and only that once', async () => {
    const onFailed = vi.fn();
    let fail = true;
    const q = m.createSaveQueue({
      send: () => (fail ? Promise.reject(new Error('down')) : Promise.resolve({})),
      onSaved: vi.fn(),
      onFailed,
    });
    q.save({ weightGoal: 'maintain' });
    expect(await q.settled()).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(expect.any(Error), { weightGoal: 'maintain' });
    fail = false;
    q.save({ weightGoal: 'maintain' });
    expect(await q.settled()).toBe(true);
  });

  it('settles an edit only while it is still the value that was sent', () => {
    expect(m.settleEdits({ pace: 'steady', age: 30 }, { pace: 'steady' })).toEqual({ age: 30 });
    expect(m.settleEdits({ pace: 'brisk' }, { pace: 'steady' })).toEqual({ pace: 'brisk' });
    expect(m.settleEdits({ availableEquipment: ['dumbbells'] }, { availableEquipment: ['dumbbells'] })).toEqual({});
  });
});
