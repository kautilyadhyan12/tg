// The onboarding calls: what goes on the wire, and what is let through.
import { afterEach, describe, expect, it } from 'vitest';
import authApi from './authApi';
import { onboardingParams, onboardingService, refusedFinish } from './onboardingApi';
import { detectTimezone } from './userApi';

const EMPTY = {
  mainGoal: null, age: null, gender: null, heightCm: null, weightKg: null, targetWeightKg: null, pace: null,
  dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null, trainingDays: null,
  sessionMinutes: null, availableEquipment: [], onboardingCompleted: false, updatedAt: null,
};
const CORE = ['goal', 'age', 'gender', 'heightCm', 'weightKg', 'dayActivity', 'trainingDays', 'sessionMinutes'];

function answerWith(body) {
  const seen = [];
  authApi.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, params: config.params, data: config.data });
    return { data: body, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
}

afterEach(() => {
  authApi.defaults.adapter = undefined;
});

describe('onboardingService', () => {
  it('reads and saves with the device zone, and never sends a day', async () => {
    const seen = answerWith({ answers: EMPTY, plan: null, missing: CORE });
    await onboardingService.get();
    await onboardingService.patch({ mainGoal: 'posture' });
    // Whatever the browser reports, word for word (ICU may name the pinned
    // Asia/Kolkata by its older name, which the server knows too).
    const zone = detectTimezone();
    expect(typeof zone === 'string' && zone.length > 0).toBe(true);
    expect(seen.map((r) => [r.method, r.url, r.params])).toEqual([
      ['get', '/v1/users/me/onboarding', { timeZone: zone }],
      ['patch', '/v1/users/me/onboarding', { timeZone: zone }],
    ]);
    expect(JSON.parse(seen[1].data)).toEqual({ mainGoal: 'posture' });
  });

  it('sends no zone at all when the browser cannot say one', () => {
    expect(onboardingParams(null)).toEqual({});
    expect(onboardingParams('   ')).toEqual({});
    expect(onboardingParams(' Europe/Paris ')).toEqual({ timeZone: 'Europe/Paris' });
  });

  it('refuses a reply that breaks the contract instead of drawing it', async () => {
    // A plan AND a missing list at once is the one state the contract rules out.
    answerWith({ answers: EMPTY, plan: null, missing: [] });
    await expect(onboardingService.get()).rejects.toMatchObject({ isContractError: true });
  });
});

describe('refusedFinish', () => {
  const refusal = (status, data) => ({ response: { status, data } });
  it('reads the questions a refused finish names, and nothing else', () => {
    const body = { error: 'onboarding_incomplete', message: 'Answer every question before you finish.', requestId: 'r1', missing: ['dayActivity'] };
    expect(refusedFinish(refusal(409, body))).toEqual(['dayActivity']);
    expect(refusedFinish(refusal(409, { ...body, missing: [] }))).toBeNull();
    expect(refusedFinish(refusal(409, { error: 'something_else' }))).toBeNull();
    expect(refusedFinish(refusal(500, body))).toBeNull();
    expect(refusedFinish(new Error('Network Error'))).toBeNull();
  });
});
