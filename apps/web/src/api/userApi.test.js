// Card 6 (web repoint) — userService on the new /v1 API. Pins: the wizard→
// contract mapper (unit conversion + 2dp rounding for multipleOf(0.01), the
// sessionDuration→sessionDurationMin rename, empty medical→null, .strict()-safe
// key set), the exact request shapes for the 4 calls, and the usage guard that
// the OLD mlApi backend is gone from this module.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import authApi from './authApi';
import { heightToCm, weightToKg, convertHeight, convertWeight, toFitnessProfilePayload, userService } from './userApi';

function recordRequests(api) {
  const seen = [];
  api.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, params: config.params, data: config.data });
    return { data: {}, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
}

afterEach(() => {
  authApi.defaults.adapter = undefined;
});

describe('userService repoint (Card 6)', () => {
  // ── Unit conversion (feeds Mifflin-St Jeor; must round to the contract's 2dp) ──
  it('heightToCm: cm passthrough, ft→cm rounded 2dp, invalid→null', () => {
    expect(heightToCm('175', 'cm')).toBe(175);
    expect(heightToCm('5.9', 'ft')).toBe(179.83);   // 5.9 × 30.48 = 179.832
    expect(heightToCm('', 'cm')).toBe(null);
    expect(heightToCm(undefined, 'ft')).toBe(null);
  });

  it('weightToKg: kg passthrough, lbs→kg rounded 2dp, invalid→null', () => {
    expect(weightToKg('70', 'kg')).toBe(70);
    expect(weightToKg('154', 'lbs')).toBe(69.85);   // 154 × 0.453592 = 69.853168
    expect(weightToKg('', 'kg')).toBe(null);
    expect(weightToKg('abc', 'lbs')).toBe(null);
  });

  // ── Unit-switch conversion (the "175 cm read as 175 ft = 5334 cm" 400 bug) ────
  it('convertHeight re-expresses the same height when the unit switches', () => {
    // 175 cm → switch to ft → ~5.74 ft (NOT left as 175, which would be 5334 cm)
    expect(convertHeight('175', 'ft')).toBe('5.74');   // 175 / 30.48 = 5.741…
    // 5.74 ft → switch to cm → back to ~175
    expect(convertHeight('5.74', 'cm')).toBe('174.96'); // 5.74 × 30.48
    // and the round-trip stays inside the API's 50–300 cm bound
    expect(Number(convertHeight('175', 'ft')) * 30.48).toBeLessThan(300);
    // blank / non-numeric passes through untouched (no NaN written to the box)
    expect(convertHeight('', 'ft')).toBe('');
    expect(convertHeight('abc', 'cm')).toBe('abc');
  });

  it('convertWeight re-expresses the same weight when the unit switches', () => {
    expect(convertWeight('70', 'lbs')).toBe('154.32');  // 70 / 0.453592
    expect(convertWeight('154', 'kg')).toBe('69.85');   // 154 × 0.453592
    expect(convertWeight('', 'lbs')).toBe('');
  });

  // ── The full wizard→profile payload ──────────────────────────────────────────
  it('toFitnessProfilePayload maps every field, converts units, and never leaks weight', () => {
    const form = {
      age: '28', gender: 'male',
      heightValue: '5.9', heightUnit: 'ft',
      weightValue: '154', weightUnit: 'lbs',   // weight goes to PATCH /v1/users/me, NOT here
      targetWeightValue: '150',
      fitnessLevel: 'intermediate', exerciseFrequency: 4,
      medicalConditions: '  none  ',
      fitnessGoals: ['muscle_gain', 'endurance'],
      availableEquipment: ['dumbbells'],
      sessionDuration: 45, preferredWorkoutTime: 'evening',
    };
    const out = toFitnessProfilePayload(form);
    expect(out).toEqual({
      age: 28,
      gender: 'male',
      heightCm: 179.83,
      targetWeightKg: 68.04,          // 150 lbs × 0.453592 = 68.0388
      fitnessLevel: 'intermediate',
      fitnessGoals: ['muscle_gain', 'endurance'],
      exerciseFrequency: 4,
      availableEquipment: ['dumbbells'],
      sessionDurationMin: 45,         // renamed from sessionDuration
      preferredWorkoutTime: 'evening',
      medicalConditions: 'none',      // trimmed
    });
    // weight is NEVER in the fitness-profile body (users.weight_kg owns it).
    expect('weightKg' in out).toBe(false);
    expect('weight' in out).toBe(false);
    // no onboardingCompleted here — the caller adds it (kept out of the mapper
    // so a future Settings edit can reuse it without flipping the gate).
    expect('onboardingCompleted' in out).toBe(false);
  });

  it('empty / whitespace medicalConditions and a missing target weight become null', () => {
    const base = {
      age: '30', gender: 'female', heightValue: '165', heightUnit: 'cm',
      fitnessLevel: 'beginner', exerciseFrequency: 3, fitnessGoals: [],
      availableEquipment: [], sessionDuration: 30, preferredWorkoutTime: 'morning',
    };
    expect(toFitnessProfilePayload({ ...base, medicalConditions: '   ' }).medicalConditions).toBe(null);
    expect(toFitnessProfilePayload({ ...base, medicalConditions: undefined }).medicalConditions).toBe(null);
    // targetWeightValue absent → targetWeightKg null (nullable in the contract).
    expect(toFitnessProfilePayload(base).targetWeightKg).toBe(null);
  });

  it('the payload holds ONLY the contract keys (.strict() body — no stray wizard fields)', () => {
    const out = toFitnessProfilePayload({
      age: '20', gender: 'other', heightValue: '180', heightUnit: 'cm',
      weightValue: '80', weightUnit: 'kg', targetWeightValue: '78',
      fitnessLevel: 'advanced', exerciseFrequency: 5,
      fitnessGoals: ['weight_loss'], availableEquipment: ['none'],
      sessionDuration: 60, preferredWorkoutTime: 'afternoon', medicalConditions: 'asthma',
    });
    expect(Object.keys(out).sort()).toEqual([
      'age', 'availableEquipment', 'exerciseFrequency', 'fitnessGoals', 'fitnessLevel',
      'gender', 'heightCm', 'medicalConditions', 'preferredWorkoutTime',
      'sessionDurationMin', 'targetWeightKg',
    ]);
  });

  // ── The 4 calls hit the right /v1 surface ────────────────────────────────────
  it('the service methods hit the /v1/users/me surface', async () => {
    const seen = recordRequests(authApi);
    await userService.getProfile();
    await userService.updateProfile({ weightKg: 69.85 });
    await userService.getFitnessProfile();
    await userService.putFitnessProfile({ age: 28, onboardingCompleted: true });
    expect(seen[0]).toMatchObject({ url: '/v1/users/me', method: 'get' });
    expect(seen[1]).toMatchObject({ url: '/v1/users/me', method: 'patch' });
    expect(JSON.parse(seen[1].data)).toEqual({ weightKg: 69.85 });
    expect(seen[2]).toMatchObject({ url: '/v1/users/me/fitness-profile', method: 'get' });
    expect(seen[3]).toMatchObject({ url: '/v1/users/me/fitness-profile', method: 'put' });
    expect(JSON.parse(seen[3].data)).toEqual({ age: 28, onboardingCompleted: true });
  });

  it('the module no longer touches the OLD mlApi backend', () => {
    const src = readFileSync(fileURLToPath(new URL('./userApi.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/mlApi/);
    expect(src).not.toMatch(/VITE_ML_API_URL/);
    expect(src).not.toMatch(/fetch\s*\(/);
    expect(src).not.toMatch(/localStorage\s*[.[]/);
  });
});
