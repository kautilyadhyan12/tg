// web-repoint (Google half) — tests.
//  · Source assertions (the web project has no jsdom yet, per coachApi.test.js):
//    the buttons point at the NEW API and the success page carries none of the
//    old #token/localStorage/raw-setUser flow (R3.7/R3.10).
//  · Behavioral: the OAuth landing's routing decision is a pure function
//    (googleSuccessRoute), so every branch is exercised — an inverted or dropped
//    branch fails here, not only in a browser smoke (T3 finding).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { googleSuccessRoute } from './googleSuccessRoute';

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

describe('Google login buttons point at the new API', () => {
  for (const page of ['./Login.jsx', './Register.jsx']) {
    it(`${page}: navigates to /v1/auth/google, not the old backend, ungated`, () => {
      const src = read(page);
      expect(src).toMatch(/\/v1\/auth\/google/);
      expect(src).not.toMatch(/localhost:3001/);
      expect(src).not.toMatch(/GOOGLE_LOGIN_ENABLED/); // the disable gate is gone
    });
  }
});

describe('GoogleAuthSuccess uses the cookie session, not the old token flow', () => {
  const src = read('./GoogleAuthSuccess.jsx');
  it('carries no localStorage, no raw setUser, no URL-fragment token', () => {
    // Usage patterns, not prose — the header comment legitimately names the
    // removed path while documenting why it is gone (coachApi.test.js precedent).
    expect(src).not.toMatch(/localStorage\s*[.[]/);
    expect(src).not.toMatch(/setUser\s*\(/);
    expect(src).not.toMatch(/window\.location\.hash/);
    expect(src).not.toMatch(/accessToken/);
  });
});

describe('googleSuccessRoute (OAuth landing routing)', () => {
  it('still restoring the session → null (stay on the spinner)', () => {
    expect(googleSuccessRoute(null, true)).toBeNull();
    expect(googleSuccessRoute({ onboardingCompleted: false }, true)).toBeNull();
  });

  it('no session (restore failed) → login with the google error', () => {
    expect(googleSuccessRoute(null, false)).toBe('/login?error=google_failed');
  });

  it('onboarding incomplete → onboarding', () => {
    expect(googleSuccessRoute({ onboardingCompleted: false }, false)).toBe('/onboarding');
  });

  it('onboarding complete → dashboard', () => {
    expect(googleSuccessRoute({ onboardingCompleted: true }, false)).toBe('/dashboard');
  });

  it('onboarding flag absent → dashboard (fails open, like ProtectedRoute)', () => {
    expect(googleSuccessRoute({}, false)).toBe('/dashboard');
  });
});
