// WHERE A PERSON LANDS AFTER SIGNING IN — one decision, in one place.
//
// Kd ruled TWO DOORS, ONE ACCOUNT (DECISIONS 2026-08-18): the login page offers
// "I'm a member" or "I run a gym", the email and password are IDENTICAL either
// way, and the choice decides only which screen you land on. Nothing in the
// schema gains a "user type" — `gym_staff` already answers "does this person
// run a gym", and the same person is deliberately BOTH: Part 3 §4.0 step 6
// makes an owner member #1 of their own gym, complimentary and not seat-counted,
// so the demo works on their own phone. Separate ACCOUNTS would mean a gym owner
// cannot use their own app without logging out.
//
// FOUR PLACES decided where you land before this file existed — Login's submit,
// the Google OAuth landing, `PublicRoute`'s already-signed-in redirect, and the
// last line of the onboarding wizard. A door honoured by one of them is a door
// that works sometimes, which is worse than no door at all. They all ask this
// function now (:1239 — fix the class, not the case).
//
// THE QUESTIONNAIRE IS THE MEMBER APP'S GATE, NOT THE ACCOUNT'S (Kd amendment,
// 2026-08-19, mid-smoke — reversing this card's own first draft, which forced
// the wizard on both doors): "a gym owner needs gym management, later if want
// to login as member then onboarding should come." The wizard collects fitness
// data — age, height, weight, goals, a medical question — and the console uses
// none of it, so a gym owner goes STRAIGHT to their console and meets the
// wizard only when they cross into the member app. This does not weaken the
// gate: `ProtectedRoute` still guards every member screen, so an un-onboarded
// owner lands in the wizard the moment they enter the member app through the
// MEMBER DOOR — the gate moved to where the data it collects is used. (Until
// 2026-08-19 the crossing was a "Back to the app" link inside the console; Kd
// removed it that day — :11616 — so signing out and choosing the other door is
// now the only way in, and the gate sits on the same screens either way.) It is
// also the better
// privacy shape: health questions are not put to someone running a business
// until they choose to train.

import { linkedJoinCodeSchema } from '@app/shared';

export const MEMBER_DOOR = 'member';
export const GYM_DOOR = 'gym';

// `sessionStorage`, not `localStorage`: a door is a choice about THIS sign-in,
// not a saved setting. It has to survive a full page RELOAD — "Continue with
// Google" leaves the site entirely and comes back, and the onboarding wizard is
// several screens later — so it cannot live in React state alone. It is cleared
// on sign-out, so the next person at a shared front-desk browser starts at their
// own door rather than inheriting one.
const DOOR_KEY = 'aihg_login_door';

/** The tab's session store, or null when the environment has none.
 *
 *  NEVER assume one exists. These helpers are unit-tested under node, which has
 *  no `sessionStorage` at all, and a browser in private mode can expose the
 *  property and then THROW on use — so the property is read inside a `try` and
 *  probed for the method it is about to be asked for. The store is also
 *  injectable at every call site below, which is what keeps the tests in node
 *  instead of dragging this whole module into jsdom (:6856's precedent went the
 *  other way and paid for it).
 */
function defaultStore() {
  try {
    const store = globalThis.sessionStorage;
    return store != null && typeof store.getItem === 'function' ? store : null;
  } catch {
    return null;
  }
}

/** Record the door the person pressed. Returns whether it actually stuck.
 *
 *  A storage failure must never stop somebody signing in, so this reports
 *  rather than throws — and the ordinary password path does not depend on it at
 *  all: `Login` passes its own state straight to `landingRoute`. What a failure
 *  here costs is the HOP — a Google round trip or the onboarding wizard — where
 *  React state is gone and this is the only memory of the choice.
 *
 *  A value that is not one of the two doors is refused rather than written: the
 *  reader below would ignore it anyway, and storing it would leave a value in
 *  the browser that looks meaningful and is not.
 */
export function rememberDoor(door, store = defaultStore()) {
  if (door !== MEMBER_DOOR && door !== GYM_DOOR) return false;
  if (store === null) return false;
  try {
    store.setItem(DOOR_KEY, door);
    return true;
  } catch {
    return false;
  }
}

/** The stored door, or null.
 *
 *  Anything that is not EXACTLY one of the two doors is NO door. A stale value
 *  from an older build, or one a person typed into devtools, must fall back to
 *  the member app rather than route somebody to a screen nobody chose.
 */
export function readDoor(store = defaultStore()) {
  if (store === null) return null;
  let raw;
  try {
    raw = store.getItem(DOOR_KEY);
  } catch {
    return null;
  }
  return raw === MEMBER_DOOR || raw === GYM_DOOR ? raw : null;
}

/** Forget the door. Called on sign-out, beside `resetTimezoneSync()` and for
 *  the same reason (:618 T3 F1): the second account on a shared browser must not
 *  inherit the first one's session state. */
export function forgetDoor(store = defaultStore()) {
  if (store === null) return false;
  try {
    store.removeItem(DOOR_KEY);
    return true;
  } catch {
    return false;
  }
}

// ── A poster's code, kept through sign-in and setup (ROADMAP 4b-ii-b) ───────
//
// `/org/join?code=…` needs a signed-in, set-up person, so everyone else is sent
// away from it — to sign in, or into setup — and the address with its code was
// lost on the way. The code is kept here, in the same tab store as the door and
// for the same reason: "Continue with Google" leaves the site and comes back.
// It is only ever put in a box; sending it is the person's own tap.

const JOIN_CODE_KEY = 'aihg_join_code';

/** Keep a poster link's code. Only a code the server could have made is kept
 *  (`linkedJoinCodeSchema`); a newer poster replaces an older one. Returns
 *  whether it stuck. */
export function rememberJoinCode(raw, store = defaultStore()) {
  const parsed = linkedJoinCodeSchema.safeParse(raw);
  if (!parsed.success || store === null) return false;
  try {
    store.setItem(JOIN_CODE_KEY, parsed.data);
    return true;
  } catch {
    return false;
  }
}

/** The kept code, or null. A stored value is parsed again on the way out, so
 *  one edited in the browser is no code at all. */
export function readJoinCode(store = defaultStore()) {
  if (store === null) return null;
  let raw;
  try {
    raw = store.getItem(JOIN_CODE_KEY);
  } catch {
    return null;
  }
  const parsed = linkedJoinCodeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Forget the kept code: it was sent, setup finished, it reached the join page,
 *  or the person signed out (the next person at a shared browser must not find
 *  it filled in). */
export function forgetJoinCode(store = defaultStore()) {
  if (store === null) return false;
  try {
    store.removeItem(JOIN_CODE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Where this signed-in person goes now.
 *
 *  Callers own "is there a session at all" — this answers only the destination,
 *  which is the part all four of them were spelling differently.
 *
 *  `joinCode` is a kept poster code (`readJoinCode`). Someone who has finished
 *  setup goes to the join page with it in the box; someone who has not goes to
 *  setup, which puts it first. The gym door still goes to the console.
 *
 *  THE GYM DOOR IS ANSWERED FIRST, before the onboarding check (the Kd
 *  amendment in this file's header): the wizard is the member app's gate and
 *  the console is not the member app. `ProtectedRoute` still walls every member
 *  screen, so this is a re-routing, not a bypass.
 *
 *  `=== false` and not a truthiness check, matching `ProtectedRoute`: a MISSING
 *  onboarding flag fails OPEN, because a profile read that blipped must not trap
 *  somebody in a wizard they already finished.
 *
 *  The gym door does NOT check whether the person actually runs a gym, and that
 *  is the point. `/console` is the create-a-gym front door and already says "You
 *  don't run a gym yet — create one"; gating the door on staffing one would send
 *  a brand-new owner — the exact person pressing it — into the member app
 *  instead, with no way to find the screen that makes them an owner.
 */
export function landingRoute(user, door, joinCode = null) {
  if (door === GYM_DOOR) return '/console';
  if (user?.onboardingCompleted === false) return '/onboarding';
  const code = linkedJoinCodeSchema.safeParse(joinCode);
  if (code.success) return `/org/join?code=${encodeURIComponent(code.data)}`;
  return '/dashboard';
}
