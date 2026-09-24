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
// the focus event, the Try-again button, and the ONE place the console changes
// its own list from the inside — creating a gym (`NewGym`). That third one is
// not a nicety: this card's first build had only the first two, reasoning that
// the only way into the console is the login page and every entry is therefore
// a fresh page session — which is true of entering it and says nothing about
// what happens once you are in. An owner who made a gym was told it was not
// theirs.
import { orgService, errorText } from '../../api/orgsApi';
import { getUserId } from '../../utils/storage';

/** The shape every reader sees. `status` is the only thing that decides which
 *  arm a screen draws, so the four are named rather than inferred from which
 *  fields happen to be null — that inference is how a failed read comes to be
 *  drawn as an empty one. */
const IDLE = Object.freeze({ status: 'idle', orgs: null, error: null, forUserId: null });

let state = IDLE;
let inFlight = null;
/** Who the in-flight read was started for. A read answers "which gyms does THIS
 *  person run?", so it is only ever shareable with that person — see `load`. */
let inFlightUserId = null;
/** Bumped by `resetConsoleOrgs`, so an answer already on its way back cannot
 *  land in a store that has since been emptied. The user stamp (rule 3) is what
 *  protects a real sign-out; this protects a deliberate reset. */
let generation = 0;
const listeners = new Set();
/** The subset of `listeners` that asked for the focus re-read — see
 *  `subscribeConsoleOrgs`. The member app's subscriber is deliberately not in
 *  here (T3 round 1 C/H-3). */
const watchers = new Set();
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

/** `watch: false` SUBSCRIBES TO THE ANSWER WITHOUT ASKING FOR THE FOCUS
 *  RE-READ, and it exists because the member app now reads this store.
 *
 *  **T3 round 1 C/H-3.** `subscribeConsoleOrgs` started the window watch for
 *  every subscriber, so putting `My Gyms` in the member `Sidebar` — which
 *  `AppLayout` keeps mounted on every member screen — turned :16331's
 *  refresh-on-focus into an app-wide behaviour for MEMBERS: measured at 1 read
 *  on mount and 4 after three focus events, all day, on every screen. The
 *  console's version is sized for the handful of staff who open a console; a
 *  gym's members are hundreds of people behind ONE NAT'd address, and
 *  `/v1/orgs/mine` has only the global 300/minute that `trustProxy` keys to
 *  `req.ip` — the same shape as the per-IP mark limit :28649 had to raise.
 *
 *  **The console's behaviour is UNCHANGED**: it passes nothing and still
 *  watches. Stopping is now keyed on the WATCHERS rather than on all
 *  listeners, so a quiet member subscriber can never hold the listeners open
 *  after the last console screen has gone, nor tear them off one that is still
 *  there. */
export function subscribeConsoleOrgs(listener, { watch = true } = {}) {
  listeners.add(listener);
  if (watch) {
    watchers.add(listener);
    startWatching();
  }
  return () => {
    listeners.delete(listener);
    watchers.delete(listener);
    if (watchers.size === 0) stopWatching();
  };
}

function load({ background }) {
  const forUserId = getUserId();
  // Rule 1: the spinner belongs to somebody who is waiting on purpose. Set
  // BEFORE the check below so Try again always visibly does something.
  if (!background) publish({ status: 'loading', orgs: null, error: null, forUserId });
  // A READ ALREADY ON ITS WAY IS SHARED ONLY WITH THE PERSON IT WAS STARTED
  // FOR. This line used to be a bare `if (inFlight) return inFlight`, and that
  // is what left the next person at a gym's SHARED FRONT DESK unable to
  // finish: `u1`'s read still hanging when `u2` signed in was handed to `u2` as
  // if it were theirs, came back stamped `u1`, and rule 3 correctly emptied it —
  // so `u2`'s console had nothing and NO WAY TO ASK AGAIN. The mount effect had
  // already run, and `consoleOrgsRegainedFocus` returns early on an empty store,
  // so clicking back into the window could not rescue it either. Only reloading
  // the page could (T3 C/H-2).
  //
  // THE SHARING ITSELF IS KEPT, and deleting it was tried and rejected. It is
  // what stops a caller that asks in a loop from putting one request per pass on
  // the wire: mutant C49 restores exactly such a loop — the one this card
  // shipped and fixed — and with the sharing gone it stopped being a test that
  // FAILS and became a test that never finishes. A guard whose absence hangs the
  // instrument is a guard doing real work.
  //
  // The other half of "an answer that can still answer the question" — a read
  // started BEFORE the thing being asked about — is handled by
  // `refreshConsoleOrgs` below, which discards what is in the air rather than
  // waiting on it.
  if (inFlight && inFlightUserId === forUserId) return inFlight;

  const gen = ++generation;
  inFlightUserId = forUserId;
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
        error: errorText(err, "We couldn't load your organisations."),
        forUserId,
      });
    })
    .finally(() => {
      if (gen === generation) {
        inFlight = null;
        inFlightUserId = null;
      }
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

/** SOMEBODY ASKED ON PURPOSE — the Try-again button, and the one place the
 *  console changes its own list from the inside (`NewGym`, after a gym is
 *  created). Visible by design.
 *
 *  IT DISCARDS WHAT IS IN THE AIR RATHER THAN WAITING ON IT, and that is the
 *  half of T3 C/H-1 that is not in `NewGym`. A read that was already on its way
 *  was started BEFORE the question being asked, so it cannot answer it: a
 *  background re-check begun a moment before a gym was created would come back
 *  without that gym, and telling somebody their brand-new gym does not exist is
 *  the exact defect this is fixing — it would simply have moved from certain to
 *  occasional.
 *
 *  HOW THE DISCARD ACTUALLY WORKS, corrected in round 2 (L-1) because the first
 *  version of this paragraph credited the wrong statement — the same shape as
 *  round 1's own L-1, a record describing code it had stopped matching.
 *  Forgetting the read is what does it: with `inFlight` cleared, `load`'s share
 *  check cannot return it, so `load` starts a fresh one. **`load`'s own
 *  `++generation` is then what stops the forgotten read publishing when it
 *  lands** — this function does not need to bump the generation itself, and a
 *  line here that did was deleted rather than left standing as a second
 *  explanation of a thing that only happens once. The pair is cleared together
 *  because `load` sets it together.
 *
 *  This is what "one request, and the person who pressed the button can see that
 *  it was heard" used to say. It is now one request PER PRESS, which is what a
 *  retry means. */
export function refreshConsoleOrgs() {
  forgetTheReadInTheAir(); // one request PER PRESS, and it must be a fresh one
  void load({ background: false });
}

/** THE CONSOLE CHANGED SOMETHING ABOUT A GYM AND THE KEPT ANSWER IS NOW STALE —
 *  today that is the Settings screen saving the gym's own details.
 *
 *  It is `refreshConsoleOrgs` WITHOUT THE SPINNER, and both halves of that are
 *  deliberate.
 *
 *  **Background, because nobody is waiting on this read.** A foreground refresh
 *  publishes `loading`, and every screen reading the store draws its spinner —
 *  so saving a gym's name would blank the very screen the owner is looking at,
 *  taking the Staff section and its open controls down with it. Rule 1 above
 *  says the spinner belongs to somebody who is waiting ON PURPOSE, and after a
 *  save the thing they asked for has already happened: the save's own response
 *  is what the form shows back. This read exists so the SHELL's gym name and
 *  "Your gyms" agree with it.
 *
 *  **It still forgets the read in the air, for C51/C53's reason.** A background
 *  re-check begun a moment BEFORE the save cannot know about the save, so
 *  sharing it would put the OLD name back on screen a second after the new one
 *  was stored — the "brand-new gym does not exist" defect wearing a rename's
 *  clothes. `load`'s own `++generation` then stops the forgotten read publishing
 *  when it lands.
 *
 *  A failure changes nothing on screen (rule 2), which is right here: the save
 *  LANDED, and blanking a console over a follow-up read would report a failure
 *  that did not happen. */
export function refreshConsoleOrgsAfterChange() {
  forgetTheReadInTheAir(); // a read begun before the save cannot answer it
  // The trailing note is not decoration: `void load({ background: true });` is
  // also the last line of `consoleOrgsRegainedFocus`, and an anchor that matches
  // twice lands on whichever comes first — so a mutant aimed at THIS guarantee
  // would be evidence about a different one (:15259 L-2's uniqueness guard).
  void load({ background: true }); // nobody is waiting on this read
}

/** A TRIAL JUST STARTED, AND THE SERVER'S OWN ANSWER GOES INTO THE KEPT ROW
 *  BEFORE THE RE-READ CONFIRMS IT.
 *
 *  **This is `TrialCard`'s `justStarted` moved out of a component and into the
 *  one place that answers "what is this gym on?", and the move is what the modal
 *  card forced.** Held in a component, that answer lived exactly as long as the
 *  component: the unskippable prompt is drawn from the shell and unmounts when
 *  the owner walks out through "Your gyms", so a background re-read that failed
 *  would put the prompt straight back over a gym that IS now trialling — and it
 *  cannot be closed. The plan card on the Overview is a second reader of the
 *  same fact and would have gone blank in the same window.
 *
 *  **WHY IT IS NEEDED AT ALL:** the re-read below it is a BACKGROUND read, and
 *  rule 2 above says a failed background read changes nothing on screen. That
 *  rule is right and stays — but it means the console can be left holding
 *  `subscription: null` for a gym the server has just told us is trialling.
 *  This writes the fact we were told, so the screens say the true thing whether
 *  or not the follow-up read arrives.
 *
 *  **IT PATCHES ONE GYM AND INVENTS NOTHING.** The subscription is the server's
 *  own response to the press, copied verbatim onto that gym's row; every other
 *  field and every other gym is untouched, and a successful re-read replaces the
 *  whole answer moments later (rule 4). Nothing here derives a status, a date or
 *  a seat cap.
 *
 *  Ignored unless the store holds a READY answer stamped for the person now
 *  signed in — rule 3, and the same shared-front-desk hazard: an answer patched
 *  into somebody else's kept row is the one thing worse than a stale one. */
export function applyStartedTrial(gymId, subscription) {
  if (typeof gymId !== 'string' || gymId === '' || subscription == null) return;
  const forUserId = getUserId();
  if (state.status !== 'ready' || state.forUserId !== forUserId) return;
  if (!Array.isArray(state.orgs)) return;
  publish({
    ...state,
    orgs: state.orgs.map((o) => (o?.id === gymId ? { ...o, subscription } : o)),
  });
}

/** A gym just paid: the server's own answer goes into the kept row at once, as
 *  `applyStartedTrial` does for a trial, and the console is writable again. */
export function applyPaidPlan(gymId, subscription) {
  if (typeof gymId !== 'string' || gymId === '' || subscription == null) return;
  const forUserId = getUserId();
  if (state.status !== 'ready' || state.forUserId !== forUserId) return;
  if (!Array.isArray(state.orgs)) return;
  publish({
    ...state,
    orgs: state.orgs.map((o) => (o?.id === gymId ? { ...o, subscription, consoleReadOnly: false } : o)),
  });
}
/** Written out as a named step rather than two inline assignments so that ONE
 *  line names this guarantee and a mutant can point at it (C53). `resetConsoleOrgs`
 *  deliberately does NOT call it — it also has to bump the generation, because
 *  unlike this path nothing downstream of it does. */
function forgetTheReadInTheAir() {
  inFlight = null;
  inFlightUserId = null;
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
 *  a box. Attached while the console has a WATCHING subscriber and removed with
 *  the last one.
 *
 *  **This used to say "so nothing is listening while a person is in the member
 *  app", and on 2026-09-02 that became FALSE** — the member `Sidebar` subscribed
 *  to this store for its `My Gyms` item and, through it, to these two events on
 *  every member screen. It is true again because that subscriber passes
 *  `watch: false`; the sentence is corrected rather than deleted, because what
 *  made it false is worth a later reader knowing (T3 round 1 C/H-3).
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
  inFlightUserId = null;
  publish(IDLE);
}
