import { useEffect, useSyncExternalStore } from 'react';
import {
  consoleOrgsSnapshot,
  ensureConsoleOrgs,
  refreshConsoleOrgs,
  subscribeConsoleOrgs,
} from '../pages/console/consoleOrgs';
import { memberOrgs } from '../components/gym/gymMembershipView';

// "WHICH GYMS AM I A MEMBER OF?" — the member app's own question, answered from
// the same kept answer the console reads.
//
// **THIS IS NOT A CROSSING AND MUST NOT BE READ AS ONE.** Kd's ruling of
// 2026-08-19 (:11616) shut the two shortcuts BETWEEN the member app and the gym
// console — a link somebody clicks — and the login page's two doors are still
// the only way across in either direction. This shares a STORE, not a door:
// `/v1/orgs/mine` answers one question for both surfaces, and two stores asking
// it would be two requests and two chances to disagree about the same list.
//
// The store lives under `pages/console/` because that is where it was first
// written, and moving it is a rename across every console screen (R1.1) rather
// than part of this card.
//
// IT INHERITS THE STORE'S FOUR RULES, and rule 3 is the one that matters most
// here: the kept answer is stamped with the user it was fetched for, so the
// next person to sign in at a shared browser never sees the previous member's
// gyms. That guarantee is worth more than a second implementation of it would
// be (:1239).

/** Every gym this person is a MEMBER of — the gate on Kd's ruling of
 *  2026-09-02: the section appears once a gym has approved them, and staff of a
 *  gym they do not belong to are not members of it.
 *
 *  `loading` covers `idle` too: nothing has asked yet, which from a screen's
 *  point of view is indistinguishable from a read in flight, and drawing "you
 *  are not in a gym" during either would be the empty-vs-failed defect wearing
 *  a third hat. */
export function useMyGyms() {
  const snapshot = useSyncExternalStore(subscribeConsoleOrgs, consoleOrgsSnapshot);

  // ON MOUNT ONLY, and `snapshot.status` is deliberately NOT a dependency —
  // `ensure` asks again after a failure, so a status dependency loops the app
  // against the server for ever. That defect survived the store's own unit
  // tests once already (`useConsoleOrg`, which carries the full account).
  useEffect(() => {
    ensureConsoleOrgs();
  }, []);

  return {
    loading: snapshot.status === 'idle' || snapshot.status === 'loading',
    error: snapshot.status === 'failed' ? snapshot.error : null,
    gyms: snapshot.status === 'ready' ? memberOrgs(snapshot.orgs) : [],
    reload,
  };
}

/** Try again — a foreground read, so the shell's nav item and the screen
 *  recover together on one press. */
function reload() {
  refreshConsoleOrgs();
}
