// Card 6 (web repoint) — userService on the new /v1 API. Pins: the wizard→
// contract mapper (unit conversion + 2dp rounding for multipleOf(0.01), the
// sessionDuration→sessionDurationMin rename, empty medical→null, .strict()-safe
// key set), the exact request shapes for the 4 calls, and the usage guard that
// the OLD mlApi backend is gone from this module.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import authApi from './authApi';
import { heightToCm, weightToKg, convertHeight, convertWeight, toFitnessProfilePayload, mergeFitnessProfile, timezoneUpdate, userService } from './userApi';

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

  // ── Card 7: read-modify-write merge (the two Settings traps) ──────────────────
  describe('mergeFitnessProfile', () => {
    const current = {
      age: 25, gender: 'male', heightCm: 175, targetWeightKg: 70,
      fitnessLevel: 'beginner', fitnessGoals: ['muscle_gain'], exerciseFrequency: 3,
      availableEquipment: ['dumbbells'], sessionDurationMin: 30,
      preferredWorkoutTime: 'morning', medicalConditions: null,
    };

    it('overrides ONLY the edited fields and preserves everything else (no wipe)', () => {
      // the "basic info" form edits age/gender/height/target only — the fitness
      // fields (level/goals/equipment/…) must survive untouched.
      const out = mergeFitnessProfile(current, { age: 26, heightCm: 178 });
      expect(out.age).toBe(26);
      expect(out.heightCm).toBe(178);
      expect(out.fitnessGoals).toEqual(['muscle_gain']);       // NOT wiped
      expect(out.availableEquipment).toEqual(['dumbbells']);   // NOT wiped
      expect(out.fitnessLevel).toBe('beginner');               // NOT wiped
      expect(out.gender).toBe('male');                         // untouched current
    });

    it('ALWAYS carries onboardingCompleted explicitly (the un-onboard trap)', () => {
      // the server sets it false when OMITTED (service.ts:142) → a Settings save
      // would kick the user to the wizard. Every merge must carry the flag.
      expect(mergeFitnessProfile({ ...current, onboardingCompleted: true }, { medicalConditions: 'asthma' })
        .onboardingCompleted).toBe(true);
      expect(mergeFitnessProfile(null, {}).onboardingCompleted).toBe(true); // unknown → safe default
    });

    it('does NOT re-onboard a user whose profile was just reset (carries false)', () => {
      // right after reset-onboarding the row is wiped and the flag is false; a
      // save landing in that window must not silently undo the reset (T3 F1).
      const justReset = { ...current, onboardingCompleted: false };
      expect(mergeFitnessProfile(justReset, { fitnessLevel: 'advanced' }).onboardingCompleted).toBe(false);
    });

    it('undefined edits keep the current value; explicit null clears that field', () => {
      expect(mergeFitnessProfile(current, { age: undefined }).age).toBe(25);   // kept
      expect(mergeFitnessProfile(current, { targetWeightKg: null }).targetWeightKg).toBe(null); // cleared
    });

    it('emits ONLY the 12 contract keys, even from the flat-merged profile (.strict() guard)', () => {
      // Production passes {...fitnessProfile, ...user} — which carries id, email,
      // displayName, weightKg, updatedAt … A naive {...current, ...edits} would
      // forward those into the .strict() PUT body and 400. This pins the key set
      // so that regression can never ship green (T3 done-gate finding).
      const flatMerged = {
        ...current,
        id: 'u-1', email: 'a@b.c', displayName: 'Nm', emailVerified: true,
        locale: 'en', units: 'metric', timezone: 'UTC', weightKg: 72,
        leaderboardOptOut: false, onboardingCompleted: true, updatedAt: '2026-07-19T00:00:00.000Z',
      };
      expect(Object.keys(mergeFitnessProfile(flatMerged, {})).sort()).toEqual([
        'age', 'availableEquipment', 'exerciseFrequency', 'fitnessGoals', 'fitnessLevel',
        'gender', 'heightCm', 'medicalConditions', 'onboardingCompleted',
        'preferredWorkoutTime', 'sessionDurationMin', 'targetWeightKg',
      ]);
    });

    it('handles a null current (never-onboarded) → all-null base + the edits', () => {
      const out = mergeFitnessProfile(null, { fitnessLevel: 'advanced' });
      expect(out.fitnessLevel).toBe('advanced');
      expect(out.age).toBe(null);
      expect(out.fitnessGoals).toEqual([]);
      expect(out.onboardingCompleted).toBe(true);
    });
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

  // ── Timezone capture ──────────────────────────────────────────────────────
  // The web never captured a timezone, so users.timezone stayed null and every
  // user bucketed as UTC (DECISIONS 2026-07-11 P2.3 GAP-3) — streaks and
  // "today" rolling over at the wrong local hour for everyone outside UTC,
  // which in a Jorhat pilot is everyone. Playbook trap #8.
  describe('timezoneUpdate', () => {
    it('returns the detected zone when the server has none', () => {
      expect(timezoneUpdate(null, 'Asia/Kolkata')).toBe('Asia/Kolkata');
    });

    it('returns null when the server already agrees — no write on every page load', () => {
      expect(timezoneUpdate('Asia/Kolkata', 'Asia/Kolkata')).toBeNull();
    });

    it('returns the new zone when the user has moved', () => {
      expect(timezoneUpdate('Europe/London', 'Asia/Kolkata')).toBe('Asia/Kolkata');
    });

    // Never write something the contract would 400 on, and never overwrite a
    // good stored value with a guess: an unreadable environment means "leave
    // it alone", not "assume UTC" (assuming is what caused the bug).
    it('writes nothing when the browser cannot tell us, or the value is unusable', () => {
      for (const bad of [undefined, null, '', '   ', 42, {}])
        expect(timezoneUpdate('Europe/London', bad)).toBeNull();
      expect(timezoneUpdate(null, 'x'.repeat(65))).toBeNull(); // schema max(64)
      expect(timezoneUpdate(null, 'x'.repeat(64))).toBe('x'.repeat(64)); // boundary
    });

    it('trims, because the contract trims and a stored " Asia/Kolkata" would loop forever', () => {
      expect(timezoneUpdate('Asia/Kolkata', '  Asia/Kolkata  ')).toBeNull();
      expect(timezoneUpdate(null, '  Asia/Kolkata  ')).toBe('Asia/Kolkata');
    });
  });
});
