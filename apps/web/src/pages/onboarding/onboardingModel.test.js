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
  equipmentSchema,
  fitnessGoalSchema,
  fitnessLevelSchema,
  genderSchema,
  missingPlanInputSchema,
  patchOnboardingRequestSchema,
  planFlagSchema,
  planNumbersSchema,
  planPaceSchema,
} from '@app/shared';
import * as m from './onboardingModel';
import { EQUIPMENT_ICONS, GOAL_ICONS, LEVEL_ICONS, PullUpBar, SideStretch } from './onboardingIcons';

const accepts = (body) => patchOnboardingRequestSchema.safeParse(body).success;
const values = (table) => table.map((row) => row.value).sort();

const EMPTY = {
  displayName: 'Kd', mainGoal: null, age: null, gender: null, heightCm: null, weightKg: null, targetWeightKg: null,
  pace: null, dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null, trainingDays: null,
  sessionMinutes: null, availableEquipment: [], onboardingCompleted: false, updatedAt: null,
};
const ALL = {
  ...EMPTY, mainGoal: 'weight_loss', age: 30, gender: 'female', heightCm: 165, weightKg: 70, targetWeightKg: 65,
  pace: 'steady', dayActivity: 'sitting', fitnessLevel: 'beginner', trainingDays: 3, sessionMinutes: 45,
  availableEquipment: ['dumbbells'],
};

describe('what the screens offer is exactly what the server accepts', () => {
  it('every choice table holds the shared enum, no more and no less', () => {
    expect(values(m.GOALS)).toEqual([...fitnessGoalSchema.options].sort());
    expect(values(m.GENDERS)).toEqual([...genderSchema.options].sort());
    expect(values(m.PACES)).toEqual([...planPaceSchema.options].sort());
    expect(values(m.DAYS)).toEqual([...dayActivitySchema.options].sort());
    expect(values(m.LEVELS)).toEqual([...fitnessLevelSchema.options].sort());
    expect(values(m.EQUIPMENT)).toEqual([...equipmentSchema.options].sort());
  });

  it('every goal, level and kind of equipment has a line icon, and nothing else does', () => {
    const covered = (icons, options) => {
      expect(Object.keys(icons).sort()).toEqual([...options].sort());
      for (const icon of Object.values(icons)) expect(icon).toBeTruthy();
    };
    covered(GOAL_ICONS, fitnessGoalSchema.options);
    covered(LEVEL_ICONS, fitnessLevelSchema.options);
    covered(EQUIPMENT_ICONS, equipmentSchema.options);
  });

  it('draws its own flexibility and pull-up bar icons, in the line style of the rest (Kd, 2026-09-10)', () => {
    expect(GOAL_ICONS.flexibility).toBe(SideStretch);
    expect(EQUIPMENT_ICONS.pull_up_bar).toBe(PullUpBar);
    for (const Icon of [SideStretch, PullUpBar]) {
      const svg = renderToStaticMarkup(createElement(Icon));
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('fill="none"');
      expect(svg).toContain('stroke-linecap="round"');
      expect(svg.match(/<(path|circle)\b/g)?.length ?? 0).toBeGreaterThan(3);
    }
  });

  it('every day count and session length on screen 6 is one the server takes', () => {
    for (const n of m.TRAINING_DAYS) expect(accepts({ trainingDays: n }), String(n)).toBe(true);
    for (const n of m.SESSION_MINUTES) expect(accepts({ sessionMinutes: n }), String(n)).toBe(true);
  });

  it('every answer the plan can be missing has words and a screen that asks it', () => {
    const keys = [...missingPlanInputSchema.options].sort();
    expect(Object.keys(m.MISSING_LABELS).sort()).toEqual(keys);
    expect(Object.keys(m.SCREEN_OF_MISSING).sort()).toEqual(keys);
    const ids = m.SCREENS.map((s) => s.id);
    for (const id of Object.values(m.SCREEN_OF_MISSING)) expect(ids).toContain(id);
  });
});

describe('which screens a person sees, and where they land', () => {
  it('asks for a target and a pace only when the goal moves the weight', () => {
    const ids = (a) => m.visibleScreens(a).map((s) => s.id);
    expect(ids({ ...EMPTY, mainGoal: 'weight_loss' })).toContain('target');
    expect(ids({ ...EMPTY, mainGoal: 'muscle_gain' })).toContain('target');
    for (const goal of ['general_fitness', 'flexibility', 'endurance', 'posture', 'stress_relief']) {
      expect(ids({ ...EMPTY, mainGoal: goal }), goal).not.toContain('target');
    }
    // Before a goal is picked the step count does not jump when one is.
    expect(ids(EMPTY)).toHaveLength(7);
  });

  it('lands on the first screen still unanswered, and on the last once all are', () => {
    expect(m.firstOpenScreen(EMPTY)).toBe('goal');
    expect(m.firstOpenScreen({ ...EMPTY, mainGoal: 'weight_loss', age: 30, gender: 'female', heightCm: 165, weightKg: 70 })).toBe('target');
    expect(m.firstOpenScreen({ ...EMPTY, mainGoal: 'posture', age: 30, gender: 'female', heightCm: 165, weightKg: 70 })).toBe('day');
    expect(m.firstOpenScreen({ ...ALL, pushUpsMax: null, plankHoldSeconds: null })).toBe('equipment');
    expect(m.firstOpenScreen({ ...ALL, availableEquipment: [] })).toBe('equipment');
  });

  it('lets the step bar reach every screen up to the first unanswered one, and none past it', () => {
    expect([...m.reachableScreens(EMPTY)]).toEqual(['goal']);
    expect([...m.reachableScreens({ ...EMPTY, mainGoal: 'posture' })]).toEqual(['goal', 'about']);
    expect([...m.reachableScreens(ALL)]).toEqual(m.visibleScreens(ALL).map((s) => s.id));
    const gap = m.reachableScreens({ ...ALL, dayActivity: null });
    expect(gap.has('day')).toBe(true);
    expect(gap.has('training')).toBe(false);
    expect(gap.has('equipment')).toBe(false);
  });

  it('counts screen 5 answered on the self-rating alone: push-ups and plank may be "Not sure"', () => {
    expect(m.screenAnswered('training', { ...EMPTY, fitnessLevel: 'beginner' })).toBe(true);
    expect(m.screenAnswered('training', { ...EMPTY, pushUpsMax: 10, plankHoldSeconds: 30 })).toBe(false);
  });

  it('names what is missing in words, and passes an unknown key through rather than dropping it', () => {
    expect(m.missingText(['dayActivity'])).toBe('your day');
    expect(m.missingText(['trainingDays', 'sessionMinutes'])).toBe('training days a week and session length');
    expect(m.missingText(['age', 'gender', 'somethingNew'])).toBe('your age, your gender and somethingNew');
  });
});

describe('"No equipment" stands alone', () => {
  it('clears the rest when tapped, and is cleared by anything else', () => {
    expect(m.toggleEquipment(['dumbbells', 'kettlebells'], 'none')).toEqual(['none']);
    expect(m.toggleEquipment(['none'], 'dumbbells')).toEqual(['dumbbells']);
    expect(m.toggleEquipment(['none'], 'none')).toEqual([]);
    expect(m.toggleEquipment(['pull_up_bar'], 'dumbbells')).toEqual(['dumbbells', 'pull_up_bar']);
    expect(m.toggleEquipment(['dumbbells', 'pull_up_bar'], 'dumbbells')).toEqual(['pull_up_bar']);
  });

  it('never produces a set the server refuses, whatever the taps', () => {
    let set = [];
    for (const tap of ['dumbbells', 'none', 'kettlebells', 'pull_up_bar', 'none', 'none', 'resistance_bands', 'dumbbells']) {
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
  protein: { gPerKg: 2, weightKg: 70, wantedG: 140 },
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
    const steps = m.workingSteps(plan);
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
    expect(notes['Protein']).toBe("2 g per kilo is the app's own figure for your goal.");
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
    q.save({ mainGoal: 'posture' });
    expect(await q.settled()).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(expect.any(Error), { mainGoal: 'posture' });
    fail = false;
    q.save({ mainGoal: 'posture' });
    expect(await q.settled()).toBe(true);
  });

  it('settles an edit only while it is still the value that was sent', () => {
    expect(m.settleEdits({ pace: 'steady', age: 30 }, { pace: 'steady' })).toEqual({ age: 30 });
    expect(m.settleEdits({ pace: 'brisk' }, { pace: 'steady' })).toEqual({ pace: 'brisk' });
    expect(m.settleEdits({ availableEquipment: ['dumbbells'] }, { availableEquipment: ['dumbbells'] })).toEqual({});
  });
});
