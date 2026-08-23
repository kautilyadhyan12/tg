import { useEffect, useSyncExternalStore } from 'react';
import {
  consoleOrgsSnapshot,
  ensureConsoleOrgs,
  refreshConsoleOrgs,
  subscribeConsoleOrgs,
} from './consoleOrgs';
import { findOrgBySlug, manageableOrgs } from './consoleView';

/** Resolve `/console/:orgSlug` to the org the API is keyed by.
 *
 *  Part 3 §3.1 fixes the URL scheme as `/console/:orgSlug/...`; every org route
 *  on the API takes the uuid. There is no by-slug endpoint, so the slug is
 *  matched against the caller's OWN org list — which has the useful property
 *  that a slug that does not exist and a gym the caller does not staff produce
 *  the same answer, exactly as the server's own 404-not-403 stance intends.
 *
 *  Four states, all distinguishable, because a screen that cannot tell them
 *  apart draws "you don't manage any gyms" at a gym owner whose network blipped:
 *    loading · failed (with `error` and `reload`) · notFound · resolved (`org`)
 *
 *  THE LIST ITSELF IS NO LONGER READ HERE. It lives in `consoleOrgs.js`, shared
 *  by every screen and by the shell around them, and re-read when the window
 *  regains focus. Two things follow that this hook used to get wrong:
 *  moving between the console's screens now asks the server NOTHING, and a
 *  screen that has been open a while stops drawing powers its viewer no longer
 *  holds. The four states and this hook's shape are unchanged, which is why no
 *  screen needed editing for either.
 *
 *  NO SLUG, NO QUESTION — and `loading` is the truthful answer there rather than
 *  an empty one. `ConsoleLayout` renders on `/console` and `/console/new` too,
 *  where there is no gym to resolve; it reads only `org`, so it simply draws no
 *  gym tabs. Structurally unreachable for the SCREENS: all three take the slug
 *  from the address, and react-router does not match those patterns with the
 *  segment empty. */
export function useConsoleOrg(orgSlug) {
  const wanted = typeof orgSlug !== 'string' || orgSlug === '' ? null : orgSlug;
  const snapshot = useSyncExternalStore(subscribeConsoleOrgs, consoleOrgsSnapshot);

  // ON MOUNT ONLY, and `snapshot.status` is deliberately NOT a dependency.
  //
  // IT WAS, AND IT LOOPED. `ensure` asks again after a failure, so a failed read
  // published `failed`, the status change re-ran this effect, `ensure` asked
  // again, and the screen never got past its spinner while the app hammered the
  // server for ever. It survived the store's own unit tests — nothing re-runs an
  // effect there — and the SCREEN test is what caught it: proof that a rule
  // tested one layer above the screen is not tested where it lives. After a
  // failure the way on is the Try-again button or clicking back into the window.
  useEffect(() => {
    if (wanted !== null) ensureConsoleOrgs();
  }, [wanted]);

  if (wanted === null) return NO_SLUG;

  if (snapshot.status === 'failed') {
    return { loading: false, error: snapshot.error, org: null, notFound: false, reload };
  }
  if (snapshot.status !== 'ready') {
    return { loading: true, error: null, org: null, notFound: false, reload };
  }
  const org = findOrgBySlug(snapshot.orgs, wanted);
  return { loading: false, error: null, org, notFound: org === null, reload };
}

/** "Your gyms" — the same one answer, as a list.
 *
 *  It reads the shared store for the same reason the screens do: this is the
 *  console's front door, so the answer it fetches is the one the gym screen the
 *  owner taps next is about to want. `manageableOrgs` is applied here rather
 *  than in the store — the store keeps what the server said, and each reader
 *  asks its own question of it. */
export function useConsoleOrgs() {
  const snapshot = useSyncExternalStore(subscribeConsoleOrgs, consoleOrgsSnapshot);

  // On mount only — see `useConsoleOrg` above for why the status must not be a
  // dependency here.
  useEffect(() => {
    ensureConsoleOrgs();
  }, []);

  return {
    loading: snapshot.status === 'idle' || snapshot.status === 'loading',
    error: snapshot.status === 'failed' ? snapshot.error : null,
    orgs: snapshot.status === 'ready' ? manageableOrgs(snapshot.orgs) : [],
    reload,
  };
}

/** Try again. A foreground read, so it publishes `loading` and every screen
 *  reading the store recovers together — one press fixes the shell's nav as
 *  well as the screen the button is on. */
function reload() {
  refreshConsoleOrgs();
}

const NO_SLUG = Object.freeze({
  loading: true,
  error: null,
  org: null,
  notFound: false,
  reload,
});
