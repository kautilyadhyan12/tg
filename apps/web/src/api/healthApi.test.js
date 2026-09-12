// The health and consent calls: what goes on the wire, and what is let through.
//
// The consent body is the one this module BUILDS rather than passes on, and it
// is legal proof — the row the server writes carries the wording it holds for
// the version named here (RULINGS 2026-09-07). Every screen mocks this module
// wholesale, so without this file the line that names the version, and the clip
// that keeps the build inside the contract's 40 characters, are never run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_DISCLAIMER_VERSION, consentPurposeSchema, recordConsentRequestSchema } from '@app/shared';
import authApi from './authApi';
import { APP_VERSION, clipVersion, consentService, healthService } from './healthApi';

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
  vi.unstubAllEnvs();
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

  it('sends a build the contract can hold, whatever the build set it to', () => {
    // The version comes from `VITE_APP_VERSION`, which nobody here controls, so
    // it is made to fit rather than trusted. THE TEST RUNS THE RULE, not the
    // one value this environment happens to produce: under vitest the variable
    // is unset, so asserting on `APP_VERSION` alone would pass with the clip
    // and the fallback both deleted.
    expect(clipVersion('1.4.2')).toBe('1.4.2');
    expect(clipVersion('x'.repeat(60))).toBe('x'.repeat(40));
    // A deploy that sets the variable to nothing is the same as not setting it:
    // the contract asks for at least one character, so a blank would be a 400
    // on the tap that records agreement and nobody could finish setup.
    expect(clipVersion('')).toBe('web-dev');
    expect(clipVersion('   ')).toBe('web-dev');
    expect(clipVersion(undefined)).toBe('web-dev');
    for (const raw of ['1.4.2', 'x'.repeat(60), '', '   ', undefined]) {
      const body = { purpose: 'health_step', wordingVersion: 'v2', appVersion: clipVersion(raw) };
      expect(recordConsentRequestSchema.safeParse(body).success, String(raw)).toBe(true);
    }
    // And what this build actually ships is one of them.
    expect(recordConsentRequestSchema.safeParse({
      purpose: 'health_step', wordingVersion: 'v2', appVersion: APP_VERSION,
    }).success).toBe(true);
  });

  it('puts the BUILD through that rule, not just anything handed to the rule', async () => {
    // The test above runs `clipVersion`; this one runs the WIRING. With the
    // variable unset under vitest, `APP_VERSION` reads 'web-dev' whether the
    // clip is there or not — so the module is re-imported with the variable
    // set, which is the only way a deploy's own value (roadmap Stage 4 item 1)
    // is ever seen here. Without the clip, an over-long or blank
    // `VITE_APP_VERSION` would 400 every disclaimer tap and nobody on that
    // build could finish setup.
    const built = async (raw) => {
      vi.stubEnv('VITE_APP_VERSION', raw);
      vi.resetModules();
      return (await import('./healthApi')).APP_VERSION;
    };
    expect(await built('1.4.2')).toBe('1.4.2');
    expect(await built('x'.repeat(60))).toBe('x'.repeat(40));
    expect(await built('')).toBe('web-dev');
    expect(await built('   ')).toBe('web-dev');
  });
});
