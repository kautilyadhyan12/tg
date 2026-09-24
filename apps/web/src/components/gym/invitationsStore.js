import { orgService } from '../../api/orgsApi';

// What is waiting for the signed-in address (Part 3 §10.2), read once per visit for
// the screen after "Before you start", and "Not now" for the rest of the visit. Keyed
// by account, so a second person signing in on the same tab is asked afresh.

const LATER_KEY = 'aihg_invitations_later';

let kept = { userId: null, request: null, result: null };

/** The invitations for this account: the kept read, or a new one when `fresh`. */
export function loadInvitations(userId, { fresh = false } = {}) {
  if (fresh || kept.userId !== userId || kept.request === null) {
    // Inside a promise, so even a call that throws at once is a failed read.
    const request = Promise.resolve()
      .then(() => orgService.getInvitations())
      .then((res) => res.data);
    kept = { userId, request, result: null };
    request.then(
      (data) => {
        if (kept.request === request) kept = { ...kept, result: data };
      },
      () => {
        // A failed read is not kept: the next screen asks again.
        if (kept.request === request) kept = { userId: null, request: null, result: null };
      },
    );
  }
  return kept.request;
}

/** The invitations still to answer for this account, from the kept read; null when
 *  there is no finished read to answer from. */
export function waitingNow(userId) {
  if (kept.userId !== userId || kept.result === null) return null;
  return kept.result.invitations.filter((invitation) => invitation.state === 'pending');
}

/** An answer changed what is waiting: the next reader asks the server. */
export function forgetInvitations() {
  kept = { userId: null, request: null, result: null };
}

// Kept here as well as in the tab's storage: with storage blocked, "Not now" still holds
// until the page is reloaded.
let notNowFor = null;

export function saidNotNow(userId) {
  if (notNowFor === userId) return true;
  try {
    return window.sessionStorage.getItem(LATER_KEY) === userId;
  } catch {
    return false;
  }
}

/** Sign-out: nothing read or answered here carries over to the next sign-in. */
export function resetInvitations() {
  forgetInvitations();
  notNowFor = null;
  try {
    window.sessionStorage.removeItem(LATER_KEY);
  } catch {
    // Storage blocked: nothing was kept in it.
  }
}

export function sayNotNow(userId) {
  notNowFor = userId;
  try {
    window.sessionStorage.setItem(LATER_KEY, userId);
  } catch {
    // Storage blocked: the answer lasts until the page is reloaded.
  }
}
