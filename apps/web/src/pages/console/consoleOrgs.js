// THE CONSOLE'S ONE ANSWER TO "WHO AM I HERE, AND WHAT MAY I DO?"
//
// Every console screen needs the caller's own row for this gym — the name to
// print, and the privileges every gate on the screen asks about. Until this
// module existed each screen asked `/v1/orgs/mine` for itself, in an effect
// keyed `[orgSlug, attempt]`, which had two consequences a person could feel:
//
//   · A SCREEN THAT WAS ALREADY OPEN NEVER ASKED AGAIN. An owner ticking a
//     power on or off for somebody sitting at the next desk changed nothing on
//     that person's screen until they pressed F5 — and worse, the app went on
//     drawing controls their role no longer carried. Nothing was ever REACHABLE
//     that should not be (the server decides every request — R3.3, and
//     `requirePrivilege` is where that lives), but the screen was telling them
//     something untrue, and a stale tab is also how a browser check comes to
//     "prove" a defect fixed that is not (:16095's near-miss).
//   · THE SAME QUESTION WAS ASKED TWICE PER SCREEN — once by `ConsoleLayout`,
//     which needs the privileges to decide the nav, and once by the screen
//     inside it — and again on every move between Gym, Members and Settings.
//
// One change closes both: ask once, keep the answer, and re-read when the
// window regains focus. `refetchOnWindowFocus: true` is the DEFAULT in TanStack
// Query, which is the evidence that this is the ordinary behaviour rather than
// a nicety (DECISIONS :16095). We hand-rolled the hook, so we inherited no such
// default — and this is that default, not that library: adding a dependency to
// get one event listener is not the trade R1.4 has in mind.
//
// FOUR RULES, and each one is here because its opposite is a defect:
//
//   1. A BACKGROUND RE-READ NEVER SHOWS A SPINNER. `loading` is published only
//      when somebody is waiting on purpose — a first read, or the Try-again
//      button. Otherwise every alt-tab would blank a working console.
//   2. A BACKGROUND RE-READ THAT FAILS CHANGES NOTHING. The kept answer stays
//      on screen. Blanking a working screen because a re-check we started
//      dropped its connection would be a self-inflicted version of the
//      empty-vs-failed defect this console has already shipped once.
//   3. THE ANSWER IS STAMPED WITH THE USER IT WAS FETCHED FOR, and a reader
//      whose id no longer matches gets `IDLE` — never the previous account's
//      gyms. A gym's front desk is a SHARED BROWSER: the same shape closed at
//      :618 T3 F1 (a module-level flag that outlived a sign-out) and in the
//      per-user storage keys this reads its id from. Stamping it here rather
//      than clearing it from `logout()` is deliberate — a guarantee that
//      depends on a second file remembering to call something is a guarantee
//      waiting for the day somebody adds a third sign-out path (:1239).
//   4. A SUCCESSFUL RE-READ REPLACES THE ANSWER WHOLE, `notFound` included. If
//      the gym has dropped off the caller's list — they were removed from staff
//      while the tab sat open — the screen must say so rather than go on
//      drawing a console for a gym that is no longer theirs.
//
// Opening a screen uses the kept answer and does NOT re-read. The re-read is
// the focus event and the Try-again button; that is what makes moving between
// the console's screens cost nothing at all.
import { orgService, errorText } from '../../api/orgsApi';
import { getUserId } from '../../utils/storage';

/** The shape every reader sees. `status` is the only thing that decides which
 *  arm a screen draws, so the four are named rather than inferred from which
 *  fields happen to be null — that inference is how a failed read comes to be
 *  drawn as an empty one. */
const IDLE = Object.freeze({ status: 'idle', orgs: null, error: null, forUserId: null });

let state = IDLE;
let inFlight = null;
/** Bumped by `resetConsoleOrgs`, so an answer already on its way back cannot
 *  land in a store that has since been emptied. The user stamp (rule 3) is what
 *  protects a real sign-out; this protects a deliberate reset. */
let generation = 0;
const listeners = new Set();
let watching = false;

function publish(next) {
  state = next;
  for (const listener of listeners) listener();
}

/** What a reader gets. IDLE for anybody the kept answer was not fetched for —
 *  rule 3 — and it is the frozen constant rather than a fresh object because
 *  `useSyncExternalStore` compares snapshots by identity and would otherwise
 *  re-render for ever. */
export function consoleOrgsSnapshot() {
  return state.forUserId === getUserId() ? state : IDLE;
}

export function subscribeConsoleOrgs(listener) {
  listeners.add(listener);
  startWatching();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopWatching();
  };
}

function load({ background }) {
  const forUserId = getUserId();
  // Rule 1: the spinner belongs to somebody who is waiting on purpose. Set
  // BEFORE the in-flight check so Try again always visibly does something, even
  // when a background re-read is already on its way — one request, and the
  // person who pressed the button can see that it was heard.
  if (!background) publish({ status: 'loading', orgs: null, error: null, forUserId });
  if (inFlight) return inFlight;

  const gen = ++generation;
  inFlight = orgService
    .getMine()
    .then((res) => {
      if (gen !== generation) return;
      // Rule 4: the whole answer, so a gym that has left the list leaves the
      // screen with it.
      publish({ status: 'ready', orgs: res.data?.orgs ?? [], error: null, forUserId });
    })
    .catch((err) => {
      if (gen !== generation) return;
      // Rule 2. `state` rather than the snapshot: this asks whether the answer
      // being protected is the one THIS read was for.
      if (background && state.status === 'ready' && state.forUserId === forUserId) return;
      publish({
        status: 'failed',
        orgs: null,
        error: errorText(err, "We couldn't load your gyms."),
        forUserId,
      });
    })
    .finally(() => {
      if (gen === generation) inFlight = null;
    });
  return inFlight;
}

/** Called by every console screen as it mounts. Does NOTHING when an answer is
 *  already kept — that is the half of this card a person feels as speed — and
 *  asks again after a failure, so a fresh screen is never handed a stale error
 *  card it has no way out of. */
export function ensureConsoleOrgs() {
  const snapshot = consoleOrgsSnapshot();
  if (snapshot.status === 'ready' || snapshot.status === 'loading') return;
  void load({ background: false });
}

/** The Try-again button, and nothing else. Visible by design. */
export function refreshConsoleOrgs() {
  void load({ background: false });
}

/** The window came back to the front. IDLE means no screen has ever asked, so
 *  there is nothing to re-check and the mount will ask in a moment anyway; a
 *  FAILED answer is re-tried, because clicking back into a window is exactly
 *  when a person expects a screen to have another go.
 *
 *  EXPORTED so the store's own tests drive THE FUNCTION THE WINDOW DRIVES,
 *  rather than a copy of what it does — a guard that tests a copy of the thing
 *  it guards is a guard that cannot see it break (:12227). Nothing in the app
 *  calls it; the two listeners below do. */
export function consoleOrgsRegainedFocus() {
  if (consoleOrgsSnapshot().status === 'idle') return;
  void load({ background: true });
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') consoleOrgsRegainedFocus();
}

/** BOTH EVENTS, and they are not the same event. `visibilitychange` is the tab
 *  switch; `focus` is the other window on the same screen — which is precisely
 *  the case this card exists for, two people side by side, one of them ticking
 *  a box. Attached while the console has a subscriber and removed with the last
 *  one, so nothing is listening while a person is in the member app.
 *
 *  Guarded for the environment: the store's own tests run in node, where there
 *  is no window to listen to. */
function startWatching() {
  if (watching) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  window.addEventListener('focus', consoleOrgsRegainedFocus);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  watching = true;
}

function stopWatching() {
  if (!watching) return;
  window.removeEventListener('focus', consoleOrgsRegainedFocus);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  watching = false;
}

/** Empty the store. For tests, which share one module across a file and would
 *  otherwise read the previous test's answer. Sign-out needs no call — rule 3
 *  covers it by construction. */
export function resetConsoleOrgs() {
  generation += 1;
  inFlight = null;
  publish(IDLE);
}
