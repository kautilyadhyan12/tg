// The health and consent calls: what goes on the wire, and what is let through.
//
// The consent body is the one this module BUILDS rather than passes on, and it
// is legal proof — the row the server writes carries the wording it holds for
// the version named here (RULINGS 2026-09-07). Every screen mocks this module
// wholesale, so without this file the line that names the version, and the clip
// that keeps the build inside the contract's 40 characters, are never run.
import { afterEach, describe, expect, it } from 'vitest';
import { CURRENT_DISCLAIMER_VERSION, consentPurposeSchema, recordConsentRequestSchema } from '@app/shared';
import authApi from './authApi';
import { APP_VERSION, consentService, healthService } from './healthApi';

const ANSWERED = {
  answered: true, hasCondition: true, checkFirst: 'not_yet', safeMode: true, noCalorieCut: true,
  updatedAt: '2026-09-12T09:00:00.000Z',
};
const CONSENT = {
  id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', purpose: 'health_step', wordingVersion: 'v2',
  wording: 'w', appVersion: 'web-dev', recordedAt: '2026-09-12T09:00:00.000Z',
};

function answerWith(body) {
  const seen = [];
  authApi.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, data: config.data });
    return { data: body, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
}

afterEach(() => {
  authApi.defaults.adapter = undefined;
});

describe('healthService', () => {
  it('reads and replaces the screening on its own route, sending only the two answers', async () => {
    const seen = answerWith({ healthScreening: ANSWERED });
    const read = await healthService.get();
    await healthService.put({ hasCondition: true, checkFirst: 'not_yet' });
    expect(seen.map((r) => [r.method, r.url])).toEqual([
      ['get', '/v1/users/me/health-screening'],
      ['put', '/v1/users/me/health-screening'],
    ]);
    // Nothing specific is ever sent — there is no field for it (RULINGS 2026-09-09).
    expect(JSON.parse(seen[1].data)).toEqual({ hasCondition: true, checkFirst: 'not_yet' });
    expect(read.data.healthScreening).toEqual(ANSWERED);
  });

  it('refuses a reply that does not match the contract, rather than putting it on a screen', async () => {
    // Safe mode true beside a "cleared" answer is a contradiction the shared
    // contract refuses; a screen must never render it as an answer.
    answerWith({ healthScreening: { ...ANSWERED, checkFirst: 'cleared' } });
    await expect(healthService.get()).rejects.toMatchObject({ isContractError: true });
    answerWith({ healthScreening: null });
    await expect(healthService.put({ hasCondition: false })).rejects.toMatchObject({ isContractError: true });
  });
});

describe('consentService', () => {
  it('names the screen and the version the screen is showing, and a build the contract accepts', async () => {
    const seen = answerWith({ consent: CONSENT });
    await consentService.record('health_step');
    expect(seen[0].method).toBe('post');
    expect(seen[0].url).toBe('/v1/users/me/consents');
    const body = JSON.parse(seen[0].data);
    // THE VERSION IS THE ONE THE SCREENS SHOW. A row recorded against any other
    // version would be proof of words this build never put in front of anyone.
    expect(body).toEqual({
      purpose: 'health_step',
      wordingVersion: CURRENT_DISCLAIMER_VERSION.health_step,
      appVersion: APP_VERSION,
    });
    // And the server takes it: the same object it parses the body through.
    expect(recordConsentRequestSchema.safeParse(body).success).toBe(true);
  });

  it('builds a body the server takes for every screen that carries a disclaimer', async () => {
    const seen = answerWith({ consent: CONSENT });
    for (const purpose of consentPurposeSchema.options) await consentService.record(purpose);
    for (const [i, purpose] of consentPurposeSchema.options.entries()) {
      const body = JSON.parse(seen[i].data);
      expect(body.purpose, purpose).toBe(purpose);
      expect(body.wordingVersion, purpose).toBe(CURRENT_DISCLAIMER_VERSION[purpose]);
      expect(recordConsentRequestSchema.safeParse(body).success, purpose).toBe(true);
    }
  });

  it('sends a build the contract can hold: never empty, never over its 40 characters', () => {
    // The version comes from the build (`VITE_APP_VERSION`), which nobody here
    // controls, so it is clipped rather than trusted: a longer one would be a
    // 400 on the tap that records the person's agreement.
    expect(APP_VERSION.length).toBeGreaterThan(0);
    expect(APP_VERSION.length).toBeLessThanOrEqual(40);
    expect(recordConsentRequestSchema.safeParse({
      purpose: 'health_step', wordingVersion: 'v2', appVersion: APP_VERSION,
    }).success).toBe(true);
  });
});
