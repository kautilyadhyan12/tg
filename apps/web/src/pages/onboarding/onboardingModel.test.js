// The wizard's pure half. The tables are pinned to the shared enums, so a
// value the server accepts cannot be missing from a screen; every value a
// screen can send is pinned to the server's own request contract.
import process from 'node:process';
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  dayActivitySchema,
  equipmentSchema,
  fitnessGoalSchema,
  fitnessLevelSchema,
  genderSchema,
  missingPlanInputSchema,
  patchOnboardingRequestSchema,
  planFlagSchema,
  planPaceSchema,
} from '@app/shared';
import * as m from './onboardingModel';

const accepts = (body) => patchOnboardingRequestSchema.safeParse(body).success;
const values = (table) => table.map((row) => row.value).sort();

const EMPTY = {
  mainGoal: null, age: null, gender: null, heightCm: null, weightKg: null, targetWeightKg: null, pace: null,
  dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null, trainingDays: null,
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

  it('counts screen 5 answered on the self-rating alone: the two checks may be skipped', () => {
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

describe('typed answers', () => {
  it('age: 16 and over, whole years, empty clears', () => {
    expect(m.parseAge('30')).toEqual({ value: 30, error: null });
    expect(m.parseAge(' 16 ')).toEqual({ value: 16, error: null });
    expect(m.parseAge('15').error).toBe('This app is for people aged 16 and over.');
    expect(m.parseAge('121').value).toBeNull();
    expect(m.parseAge('30.5').value).toBeNull();
    expect(m.parseAge('')).toEqual({ value: null, error: null });
  });

  it('weight: pounds become kilograms to two decimals, and a comma is a decimal point', () => {
    expect(m.parseWeight('154', 'imperial')).toEqual({ value: 69.85, error: null });
    expect(m.parseWeight('70,5', 'metric')).toEqual({ value: 70.5, error: null });
    expect(m.parseWeight('seventy', 'metric').value).toBeNull();
    expect(m.parseWeight('0', 'metric').value).toBeNull();
    expect(m.parseWeight('1000', 'metric').value).toBeNull();
    for (const text of ['154', '70.123', '0.01', '999.99']) {
      const { value } = m.parseWeight(text, 'imperial');
      if (value !== null) expect(accepts({ weightKg: value }), text).toBe(true);
    }
  });

  it('height: feet and inches become centimetres the server takes', () => {
    expect(m.parseHeight({ ft: '5', inch: '9' }, 'imperial')).toEqual({ value: 175.26, error: null });
    expect(m.parseHeight({ ft: '6', inch: '' }, 'imperial')).toEqual({ value: 182.88, error: null });
    expect(m.parseHeight({ ft: '5', inch: '12' }, 'imperial').error).toBe('Inches must be under 12.');
    expect(m.parseHeight({ ft: '', inch: '9' }, 'imperial').value).toBeNull();
    expect(m.parseHeight({ cm: '165' }, 'metric')).toEqual({ value: 165, error: null });
    expect(m.parseHeight({ cm: '49' }, 'metric').value).toBeNull();
    expect(accepts({ heightCm: 175.26 })).toBe(true);
  });

  it('a stored value shows in the units on screen, and reads back as itself', () => {
    expect(m.heightText(165, 'imperial')).toEqual({ cm: '', ft: '5', inch: '5' });
    expect(m.heightText(182.88, 'imperial')).toEqual({ cm: '', ft: '6', inch: '0' });
    expect(m.heightText(175.26, 'metric')).toEqual({ cm: '175.26', ft: '', inch: '' });
    expect(m.weightText(69.85, 'imperial')).toBe('154');
    expect(m.weightText(70.25, 'metric')).toBe('70.25');
    expect(m.weightText(null, 'metric')).toBe('');
    for (const cm of [150, 165, 175.26, 190.5]) {
      expect(m.parseHeight(m.heightText(cm, 'metric'), 'metric').value).toBe(cm);
    }
  });

  it('starts in pounds and feet for a US browser, kilograms and centimetres elsewhere', () => {
    expect(m.defaultUnits('en-US')).toBe('imperial');
    expect(m.defaultUnits('en-GB')).toBe('metric');
    expect(m.defaultUnits('hi-IN')).toBe('metric');
    expect(m.defaultUnits(undefined)).toBe('metric');
  });
});

describe('the plan panel says what the server said', () => {
  const plan = {
    restingBurnKcal: 1420, dailyBurnKcal: 1817, targetKcal: 1267, dailyChangeKcal: -550,
    proteinG: 140, carbsG: 98, fatG: 35, plannedTargetKg: 65, daysToTarget: 70, finishDate: '2026-11-19', flags: [],
  };

  afterEach(() => {
    process.env.TZ = 'Asia/Kolkata';
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

  it('shows the plan screen disclaimer word for word', () => {
    expect(m.PLAN_DISCLAIMER).toMatch(/^These numbers are general guidance, not medical advice\./);
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
