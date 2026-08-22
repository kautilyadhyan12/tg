// The login door — the decision, the memory of it, and the two call sites that
// no render harness can reach.
//
// Runs under NODE (no `sessionStorage`), which is deliberate: every helper takes
// its store as an argument, so the fakes below exercise the real branches
// without dragging the module into jsdom. The "no store at all" case is not a
// fixture here — it is the environment these tests run in.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  GYM_DOOR,
  MEMBER_DOOR,
  forgetDoor,
  landingRoute,
  readDoor,
  rememberDoor,
} from './landingRoute';

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

/** A stand-in for `sessionStorage`: same three methods, string values only. */
const fakeStore = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
};

/** A browser in private mode: the property is there and every use throws. */
const throwingStore = () => ({
  getItem: () => {
    throw new Error('storage denied');
  },
  setItem: () => {
    throw new Error('storage denied');
  },
  removeItem: () => {
    throw new Error('storage denied');
  },
});

// ── Where a person lands ────────────────────────────────────────────────────

describe('landingRoute picks the screen the door promised', () => {
  const done = { onboardingCompleted: true };

  it('sends the gym door to the console and the member door to the app', () => {
    expect(landingRoute(done, GYM_DOOR)).toBe('/console');
    expect(landingRoute(done, MEMBER_DOOR)).toBe('/dashboard');
  });

  it('sends the gym door to the console even for somebody who runs no gym yet', () => {
    // /console is the create-a-gym front door. Checking staff status first would
    // strand the brand-new owner this door exists for.
    expect(landingRoute(done, GYM_DOOR)).toBe('/console');
  });

  it('gates the MEMBER door on the questionnaire, and NOT the gym door', () => {
    const newAccount = { onboardingCompleted: false };
    // Kd amendment 2026-08-19: the questionnaire collects fitness data the
    // console never uses, so a brand-new gym owner reaches their business
    // screens without it — and meets the wizard the moment they cross into the
    // member app, which ProtectedRoute still walls.
    expect(landingRoute(newAccount, MEMBER_DOOR)).toBe('/onboarding');
    expect(landingRoute(newAccount, GYM_DOOR)).toBe('/console');
  });

  it('fails open when the onboarding flag is missing, and still honours the door', () => {
    // A profile read that blipped must not trap somebody in a wizard they have
    // already finished (matches ProtectedRoute).
    expect(landingRoute({}, GYM_DOOR)).toBe('/console');
    expect(landingRoute({}, MEMBER_DOOR)).toBe('/dashboard');
    expect(landingRoute(undefined, GYM_DOOR)).toBe('/console');
  });

  it('treats no door and an unrecognised door as the member app', () => {
    expect(landingRoute(done, null)).toBe('/dashboard');
    expect(landingRoute(done, undefined)).toBe('/dashboard');
    expect(landingRoute(done, 'owner')).toBe('/dashboard');
    expect(landingRoute(done, '/console')).toBe('/dashboard');
  });
});

// ── Remembering it across a reload ──────────────────────────────────────────

describe('the door survives a reload', () => {
  it('round-trips both doors', () => {
    const store = fakeStore();
    expect(rememberDoor(GYM_DOOR, store)).toBe(true);
    expect(readDoor(store)).toBe(GYM_DOOR);
    expect(rememberDoor(MEMBER_DOOR, store)).toBe(true);
    expect(readDoor(store)).toBe(MEMBER_DOOR);
  });

  it('reads a stored value that is not a door as NO door', () => {
    // THE ASSERTION THIS TEST EXISTS FOR. A stale value from an older build, or
    // one typed into devtools, must land in the member app rather than route
    // somebody to a screen nobody chose.
    expect(readDoor(fakeStore({ aihg_login_door: 'admin' }))).toBeNull();
    expect(readDoor(fakeStore({ aihg_login_door: '' }))).toBeNull();
    expect(readDoor(fakeStore({ aihg_login_door: '/console' }))).toBeNull();
    expect(readDoor(fakeStore())).toBeNull();
  });

  it('refuses to write anything that is not a door', () => {
    const store = fakeStore();
    expect(rememberDoor('admin', store)).toBe(false);
    expect(rememberDoor(null, store)).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('forgets the door when asked', () => {
    const store = fakeStore();
    rememberDoor(GYM_DOOR, store);
    expect(forgetDoor(store)).toBe(true);
    expect(readDoor(store)).toBeNull();
  });

  it('reports rather than throws when the browser has no usable storage', () => {
    // Two environments in one test: node itself (no sessionStorage — the default
    // store), and a private-mode browser that throws on every use.
    expect(readDoor()).toBeNull();
    expect(rememberDoor(GYM_DOOR)).toBe(false);
    expect(forgetDoor()).toBe(false);

    const denied = throwingStore();
    expect(rememberDoor(GYM_DOOR, denied)).toBe(false);
    expect(readDoor(denied)).toBeNull();
    expect(forgetDoor(denied)).toBe(false);
  });
});

// ── The two call sites no render harness reaches ────────────────────────────
//
// SOURCE ASSERTIONS, and they are the WEAKER kind on purpose — a guard that
// reads source can be spelled around, which this project has measured (ten
// bypasses across four rounds, `vitest.config.js`). They are here because the
// alternative is no guard at all: `App.jsx` is the route table and `AuthContext`
// has had zero test coverage since :618's T3 F5. Both behaviours are checked in
// a real browser by the card's smoke; these stop a later edit quietly undoing
// them between smokes.

describe('the console routes and sign-out honour the amendment', () => {
  it('opts every console route out of the onboarding requirement', () => {
    // The defect this pins: ProtectedRoute's default bounces an un-onboarded
    // account into the wizard, so a console route WITHOUT the opt-out puts the
    // questionnaire back in front of a brand-new gym owner — undoing Kd's
    // 2026-08-19 amendment one route at a time as routes are added or edited.
    const src = read('../App.jsx');
    const consoleRoutes = src.match(
      /path="\/console[^"]*"[\s\S]{0,120}?<ProtectedRoute([^>]*)>/g,
    ) ?? [];
    // The COUNT is what keeps this honest: without it a regex that silently
    // stopped matching would pass over an empty list. It moved 4 → 5 when the
    // Settings route landed (2026-08-22), and moving it is the correct response
    // to adding a route — the loop below is the guarantee, this number is only
    // the proof that the loop saw everything.
    expect(consoleRoutes.length).toBe(5);
    for (const route of consoleRoutes) {
      expect(route).toContain('requireOnboarding={false}');
    }
  });

  it('clears the door on sign-out, so a shared browser does not inherit one', () => {
    const src = read('../context/AuthContext.jsx');
    expect(src).toMatch(/forgetDoor\(\)/);
  });
});
