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
  forgetJoinCode,
  landingRoute,
  readDoor,
  readJoinCode,
  rememberDoor,
  rememberJoinCode,
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

// Join codes are switched off (ROADMAP 3c; spec Part 3 §10.6): a code an older
// visit left in this browser no longer steers anybody anywhere.
describe('landingRoute ignores a poster code kept by an older visit', () => {
  const done = { onboardingCompleted: true };

  it('sends someone already set up to the dashboard, never to the join page', () => {
    expect(landingRoute(done, MEMBER_DOOR, 'K7QM2X')).toBe('/dashboard');
    expect(landingRoute(done, null, 'K7QM2X')).toBe('/dashboard');
    expect(landingRoute({}, MEMBER_DOOR, 'K7QM2X')).toBe('/dashboard');
  });

  it('sends someone not set up into setup, and the gym door to the console', () => {
    expect(landingRoute({ onboardingCompleted: false }, MEMBER_DOOR, 'K7QM2X')).toBe('/onboarding');
    expect(landingRoute(done, GYM_DOOR, 'K7QM2X')).toBe('/console');
  });

  it('is not handed the kept code by sign-in, the Google return or the signed-in redirect', () => {
    for (const file of ['./Login.jsx', './googleSuccessRoute.js', '../components/common/ProtectedRoute.jsx', './Onboarding.jsx']) {
      expect(read(file), file).not.toMatch(/readJoinCode|joinPageFor|rememberJoinCode/);
    }
  });
});

describe('the poster code survives the trip through sign-in', () => {
  it('keeps a code in capitals and reads it back', () => {
    const store = fakeStore();
    expect(rememberJoinCode(' k7q-m2x ', store)).toBe(true);
    expect(readJoinCode(store)).toBe('K7QM2X');
  });

  it('lets a newer poster replace an older one', () => {
    const store = fakeStore();
    rememberJoinCode('AAAAAA', store);
    rememberJoinCode('K7QM2X', store);
    expect(readJoinCode(store)).toBe('K7QM2X');
  });

  it('keeps nothing that is not a code', () => {
    const store = fakeStore();
    for (const bad of [null, undefined, '', 'K7QM2', 'CALL US NOW', 'K7QM2I', 42]) {
      expect(rememberJoinCode(bad, store)).toBe(false);
    }
    expect(store.size()).toBe(0);
  });

  // The newest link is the one the person means. An older code left behind
  // would be named on the sign-in page and land them on it.
  it('drops an earlier code when a newer link carries no code, or none that is a code', () => {
    for (const bad of [null, undefined, '', 'not a code', 'K7QM2I']) {
      const store = fakeStore();
      rememberJoinCode('AAAAAA', store);
      expect(rememberJoinCode(bad, store)).toBe(false);
      expect(readJoinCode(store)).toBeNull();
      expect(store.size()).toBe(0);
    }
  });

  it('drops an earlier code when this browser will not store the newer one', () => {
    const store = fakeStore({ aihg_join_code: 'AAAAAA' });
    const full = { ...store, setItem: () => { throw new Error('quota'); } };
    expect(rememberJoinCode('K7QM2X', full)).toBe(false);
    expect(readJoinCode(store)).toBeNull();
  });

  it('reads a stored value that is not a code as no code', () => {
    expect(readJoinCode(fakeStore({ aihg_join_code: 'Call 555 0100' }))).toBeNull();
    expect(readJoinCode(fakeStore({ aihg_join_code: '' }))).toBeNull();
    expect(readJoinCode(fakeStore())).toBeNull();
  });

  it('forgets the code when asked', () => {
    const store = fakeStore();
    rememberJoinCode('K7QM2X', store);
    expect(forgetJoinCode(store)).toBe(true);
    expect(readJoinCode(store)).toBeNull();
  });

  it('reports rather than throws when the browser has no usable storage', () => {
    expect(readJoinCode()).toBeNull();
    expect(rememberJoinCode('K7QM2X')).toBe(false);
    expect(forgetJoinCode()).toBe(false);

    const denied = throwingStore();
    expect(rememberJoinCode('K7QM2X', denied)).toBe(false);
    expect(readJoinCode(denied)).toBeNull();
    expect(forgetJoinCode(denied)).toBe(false);
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
    // Settings route landed (2026-08-22), 5 → 6 when the Attendance section
    // landed (2026-09-02, :28107), 6 → 7 when Classes landed (2026-09-22,
    // ROADMAP 17b-i), 7 → 8 with Leads (20c-i), 8 → 9 with the phone's More
    // (R1), 9 → 10 with Members who need review (5b-v-d-iv) and 10 → 11 with Possible
    // duplicates (5b-iv-a), 11 → 12 with the Leaderboard (19a-iii), 12 → 13 with Updates (19b-i), 13 → 14 with Personal training (17e-i), 14 → 15 with Events (19c-i), 15 → 16 with Challenges (19d-i) 16 → 17 with Memberships (23c-i) and 17 → 18 with Reports (21a-i), and moving it is the correct response to adding a route —
    // the loop below is the guarantee, this number is only the proof that the
    // loop saw everything.
    expect(consoleRoutes.length).toBe(18);
    for (const route of consoleRoutes) {
      expect(route).toContain('requireOnboarding={false}');
    }
  });

  it('opts every console route out of the sign-up note, and no training route', () => {
    // The note is the training side's (Kd, 2026-09-14: *"it should show to
    // someone who trains not to someone who create organisation"*). A console
    // route without the opt-out puts it in front of a gym owner; the same
    // opt-out on any other route lets a person train without it.
    const src = read('../App.jsx').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const consoleRoutes = src.match(
      /path="\/console[^"]*"[\s\S]{0,120}?<ProtectedRoute([^>]*)>/g,
    ) ?? [];
    expect(consoleRoutes.length).toBe(18);
    for (const route of consoleRoutes) {
      expect(route).toContain('requireSignUpNote={false}');
    }
    expect(src.match(/requireSignUpNote=\{false\}/g) ?? []).toHaveLength(consoleRoutes.length);
  });

  it('opts every console route out of "You\'re invited", and of the training routes only the invitations page', () => {
    // An invitation is to the member app (Part 3 §10.2): the console must never stop an
    // owner with one, and a training route that opted out would let a person set up
    // without being asked. The invitations page shows them itself.
    const src = read('../App.jsx').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const consoleRoutes = src.match(
      /path="\/console[^"]*"[\s\S]{0,120}?<ProtectedRoute([^>]*)>/g,
    ) ?? [];
    expect(consoleRoutes.length).toBe(18);
    for (const route of consoleRoutes) {
      expect(route).toContain('requireInvitations={false}');
    }
    const invitationsRoute = src.match(/path="\/invitations"[\s\S]{0,120}?<ProtectedRoute([^>]*)>/g) ?? [];
    expect(invitationsRoute).toHaveLength(1);
    expect(invitationsRoute[0]).toContain('requireInvitations={false}');
    expect(src.match(/requireInvitations=\{false\}/g) ?? []).toHaveLength(consoleRoutes.length + 1);
  });

  it('clears the door on sign-out, so a shared browser does not inherit one', () => {
    const src = read('../context/AuthContext.jsx');
    expect(src).toMatch(/forgetDoor\(\)/);
  });
});
