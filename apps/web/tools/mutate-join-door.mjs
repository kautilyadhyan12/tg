/**
 * Mutation audit — THE JOIN DOOR'S TWO SCREENS: the member's code box and the
 * gym's waiting list (plus Remove, which Kd ruled in when he saw that a
 * confirmed member could not be removed by anybody).
 * Run from the repo root: `node apps/web/tools/mutate-join-door.mjs`
 *
 * WHY THESE GUARANTEES AND NOT OTHERS (:5857 rule 4a — the audit is scoped by
 * severity). This is a WEB packet: it changes no server behaviour of its own,
 * so there are no database mutants here and the whole sweep runs in minutes.
 * The server half's guarantees are audited in `apps/api/tools/mutate-orgs.mjs`
 * (O42–O47). What is left is exactly 4a's columns:
 *   · A PROMISE THE PRODUCT MAKES IN WRITING — Part 3 §2.4's visibility sheet,
 *     which the join screen MUST show and whose list is the promise itself
 *     (J1, J2)
 *   · PRIVACY — a field the endpoint does not send reaching an applicant's row
 *     in front of a gym (J14)
 *   · CONSENT — a record stamped for somebody who never gave one (J3)
 *   · NUMBERS A USER SEES — "3 people waiting" taken off one page of a cursor
 *     walk instead of the server's exact count (J10, J21, J22)
 *   · ON SCREEN AND FALSE — a failed read drawn as an empty one, a stale
 *     refusal outliving the membership that followed it, a server's own
 *     sentence replaced by a local rewrite, somebody told they are waiting when
 *     they are already in (J5, J6, J8, J12)
 *   · A TAP DOING SOMETHING ELSE — Refuse wired to confirm, Remove firing
 *     without its question, a confirm that never reaches the roster (J13, J15,
 *     J16, J18)
 *   · A CONTROL THE SERVER WILL REFUSE — the queue drawn for a trainer, Remove
 *     drawn beside the owner's own seat (J11, J17)
 *   · THE WIRE — DELETE quietly becoming POST, and the empty JSON body the two
 *     taps need; both invisible to every server test, because `fastify.inject`
 *     never sends a CORS preflight and never omits a body the client omits
 *     (J19, J20)
 *
 * Deliberately NOT mutated, per the same rule: wording, layout, icon choices,
 * the panel's uppercase-as-you-type cosmetic, and comments.
 *
 * **FOUR ANCHORS IN THIS TABLE HAD ROTTED AND THE WHOLE HARNESS WAS ABORTING —
 * found 2026-08-30, fixed then, and worth reading before adding a row.** J6,
 * J10, J14 and J17 had all been left behind by ordinary refactors in the files
 * they point at: `removed: 0` joining `RANK` with Kd's removal ruling (:12660),
 * the read-only card splitting "confirm the ones you recognise" onto its own
 * conditional (:24141 §3d), the applicant's name being wrapped in a truncating
 * span, and `member.complimentary` becoming `seatIsFree(member)` (:14956).
 *
 * **THE PART THAT MATTERS IS WHAT THAT COST: this harness ABORTS on the first
 * dead anchor, before a byte is written — so it has produced NO VERDICT AT ALL
 * since 2026-08-20.** Every card since that touched these files shipped without
 * this table saying anything, and nothing reported it, because an abort looks
 * like a broken tool rather than an unguarded guarantee. It is :23711 §3's O79
 * one level up: there a single row was inert inside a subset, here the whole
 * table was.
 *
 * The re-aims are at the SAME call sites (:15770), never at whichever line
 * looked closest, and each is noted at its row. Three of the four are now
 * ONE-LINE anchors, which is the shape that survives a prop or a wrapper moving
 * (:24141's S15/C81/C82, :17676's CRLF hazard).
 *
 * **The pre-check below asks "does this match?", never "does this match ONCE?"**
 * — `String.replace` takes the first hit, so a two-match anchor silently mutates
 * a line the row does not name. This table was checked for that on 2026-08-30
 * (31 rows, 0 multi-match); `mutate-orgs.mjs` has five and its own `OWED.md`
 * line.
 *
 * The class fixes are inherited, not relearned (:4855, :5199, :5748, :6277,
 * :9509): anchors that match nothing ABORT · a target outside TARGETS ABORTS ·
 * a run with no test tally ABORTS · an unmutated CONTROL must report GREEN
 * through this same path before any verdict is believed · restores are
 * sha256-verified after EVERY mutant · a RUNNER fault is not a RED and is
 * raised AFTER the restore · substrings are replaced through a utf8
 * read/write, never `sed -i` (CRLF, :4267) · every `-t` filter is ASCII, so a
 * curly apostrophe in a test name cannot make a filter match nothing.
 *
 * NO MUTANT IS EXPECTED ALIVE.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const GYM_VIEW_SUITE = 'src/components/gym/gymMembershipView.test.js';
const GYM_RENDER_SUITE = 'src/components/gym/joinGym.render.test.jsx';
const CONSOLE_SUITE = 'src/pages/console/console.render.test.jsx';
const CONSOLE_VIEW_SUITE = 'src/pages/console/consoleView.test.js';
const API_SUITE = 'src/api/orgsApi.test.js';

const TARGETS = {
  sheet: { file: resolve(ROOT, 'apps/web/src/components/gym/OrgVisibilitySheet.jsx') },
  panel: { file: resolve(ROOT, 'apps/web/src/components/gym/JoinGymPanel.jsx') },
  card: { file: resolve(ROOT, 'apps/web/src/components/gym/GymMembershipCard.jsx') },
  gymview: { file: resolve(ROOT, 'apps/web/src/components/gym/gymMembershipView.js') },
  queue: { file: resolve(ROOT, 'apps/web/src/pages/console/ApplicationsQueue.jsx') },
  members: { file: resolve(ROOT, 'apps/web/src/pages/console/Members.jsx') },
  overview: { file: resolve(ROOT, 'apps/web/src/pages/console/Overview.jsx') },
  consoleview: { file: resolve(ROOT, 'apps/web/src/pages/console/consoleView.js') },
  api: { file: resolve(ROOT, 'apps/web/src/api/orgsApi.js') },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'J1',
    target: 'sheet',
    suite: GYM_RENDER_SUITE,
    why: "THE PROMISE ITSELF (Part 3 §2.4): a line disappears from the never-sees list, so the app tells a member less than the boundary the product actually keeps — and the one it drops is the run routes",
    expect: 'SHEET BEFORE ANYTHING IS TYPED',
    from: "  'Where you ran — your routes on the map',\n",
    to: '',
  },
  {
    id: 'J2',
    target: 'panel',
    suite: GYM_RENDER_SUITE,
    why: "HARD SPEC REQUIREMENT: the sheet is not shown on the join screen at all. §2.4 names this disclosure as one of the three things that make the boundary real, and joining would still work perfectly without it — no other test in this repo would notice",
    expect: 'SHEET BEFORE ANYTHING IS TYPED',
    from: '      <OrgVisibilitySheet />\n    </form>',
    to: '    </form>',
  },
  {
    id: 'J3',
    target: 'panel',
    suite: GYM_RENDER_SUITE,
    why: 'CONSENT NOBODY GAVE: the client always sends `consent: true`, stamping a record — for a clinic, the DPDP/GDPR consent record — on somebody who was never asked. The defect this module shipped once already, on the owner\'s own silent seat',
    expect: 'applies with the typed code and reports WAITING',
    from: '      const body = consentAsked ? { code: code.trim(), consent: true } : { code: code.trim() };',
    to: '      const body = { code: code.trim(), consent: true };',
  },
  {
    id: 'J4',
    target: 'panel',
    suite: GYM_RENDER_SUITE,
    why: 'ON SCREEN AND FALSE: somebody who is already a member is told they have "asked to join" and must wait — the app inventing a wait that is not happening',
    expect: 'tells somebody already in the gym that they are already in',
    from: "  if (result !== null && result.outcome === 'already_member') {",
    to: "  if (result !== null && result.outcome === 'already_member' && false) {",
  },
  {
    id: 'J5',
    target: 'panel',
    suite: GYM_RENDER_SUITE,
    why: "THE SERVER'S ANSWER THROWN AWAY: every refusal becomes one generic sentence, so \"that code has been paused, ask the gym for a current one\" reads as \"please try again\" — advice that cannot work",
    expect: "prints the SERVER's sentence on a refusal",
    from: '      setError(errorText(err, "We couldn\'t send your request. Please try again."));',
    to: '      setError("We couldn\'t send your request. Please try again.");',
  },
  {
    id: 'J6',
    target: 'gymview',
    suite: GYM_VIEW_SUITE,
    why: 'ON SCREEN AND FALSE: a refusal from last Tuesday outranks the membership that followed it, so a person training at the gym is told the gym did not confirm them',
    // RE-AIMED 2026-08-30. `removed: 0` joined RANK with Kd's removal ruling
    // (:12660, commit 8b19775) and this anchor was never moved — see the note on
    // the four dead rows at the head of this file. Same call site, ranks
    // unchanged; `removed` is carried through both sides so the mutation is
    // still only about the three it names.
    expect: 'MEMBERSHIP OUTRANKS A STALE REFUSAL',
    from: 'const RANK = { member: 3, waiting: 2, refused: 1, expired: 1, removed: 0 };',
    to: 'const RANK = { member: 1, waiting: 2, refused: 3, expired: 3, removed: 0 };',
  },
  {
    id: 'J7',
    target: 'gymview',
    suite: GYM_VIEW_SUITE,
    why: 'FABRICATED FACT: a gym the person merely STAFFS is reported as one they are a member of — "You are a member of Iron House" about a membership that does not exist',
    expect: 'ignores an org the person is not a member of',
    from: "    if (org?.isMember !== true) continue;",
    to: "    if (org?.isMember !== true && false) continue;",
  },
  {
    id: 'J8',
    target: 'gymview',
    suite: GYM_VIEW_SUITE,
    why: 'A GUESS INSTEAD OF SILENCE: a status this client does not understand is drawn as "waiting", so a cancelled or confirmed row becomes a wait that is not happening',
    expect: 'DROPS a row it cannot describe truthfully',
    from: "  if (status === 'expired') return 'expired';\n  return null;",
    to: "  if (status === 'expired') return 'expired';\n  return 'waiting';",
  },
  {
    id: 'J9',
    target: 'card',
    suite: GYM_RENDER_SUITE,
    why: "THE CONFIRMATION NOBODY SEES: the membership read is dropped, so the waiting card simply vanishes when the gym says yes and the app never tells the person they got in — confirmed applications are absent from the other endpoint by design",
    expect: 'says they are IN once the gym confirms them',
    from: "            orgs: orgsOutcome.status === 'fulfilled' ? orgsOutcome.value.data?.orgs : null,",
    to: '            orgs: null,',
  },
  {
    id: 'J10',
    target: 'queue',
    suite: CONSOLE_SUITE,
    why: 'A WRONG NUMBER IN FRONT OF A GYM OWNER: the count is taken off this PAGE instead of the server\'s exact figure, so 90 people waiting reads as "1 person waiting"',
    // RE-AIMED 2026-08-30. The read-only card (:24141 §3d) split "confirm the
    // ones you recognise" onto its own conditional, because it instructs a front
    // desk to press a button a lapsed gym's server refuses — so this anchor's
    // second half went. Same call site, and now ONE line, which moves only when
    // the count itself does.
    expect: 'exact count, never this page',
    from: '          {waitingCountLabel(state.pendingCount)}',
    to: '          {waitingCountLabel(state.items.length)}',
  },
  {
    id: 'J11',
    target: 'queue',
    suite: CONSOLE_SUITE,
    // THIS MUTANT SURVIVED TWICE AND BOTH SURVIVALS WERE THE FINDING, not a
    // missing test. The first aim was this same line, and it lived because a
    // 403 also emptied the queue, so the empty-state check below returned null
    // anyway. The second aim was the error SUPPRESSION in the catch — and that
    // lived because this line returned first. **Two guards, each unfalsifiable
    // because the other one held.** :5104 F5's shape twice over, in code
    // written the same hour.
    //
    // Fixed in the SOURCE rather than by hunting a third anchor: the refusal is
    // now recorded like any other failure and this line is the only thing that
    // hides it, so deleting it prints "Your role doesn't allow that" at a
    // trainer and the test goes red.
    why: "A REFUSAL SHOWN TO SOMEBODY WHO DID NOT ASK: a trainer's 403 is drawn on the Members screen as a red error card, so a person doing their job is told off by a screen they opened to read a roster they are entitled to",
    expect: 'DRAWS NO SECTION for a trainer',
    from: '  if (state.forbidden) return null;',
    to: '  if (state.forbidden && false) return null;',
  },
  {
    id: 'J12',
    target: 'queue',
    suite: CONSOLE_SUITE,
    why: 'THE RECURRING CLASS, on the surface that decides whether real members get in: a FAILED read is drawn as an EMPTY queue, so a gym with people waiting is told nobody is',
    expect: 'NEVER draws an empty queue over a failed read',
    from: '  if (state.error !== null) return <ConsoleFailed message={state.error} onRetry={refresh} />;',
    to: '  if (state.error !== null) return null;',
  },
  {
    id: 'J13',
    target: 'queue',
    suite: CONSOLE_SUITE,
    why: 'THE TAP LOOKS LIKE IT DID NOTHING: a confirmed person never reaches the roster below, so the owner taps Confirm, the row vanishes and nobody appears — the state where a reload is the only way to believe it worked',
    expect: 'the row goes, the count drops',
    // Re-anchored when the call gained its `changesRoster` guard — a refusal
    // adds nobody to the roster, so re-reading it there would flash a loading
    // state under a tap that changed nothing.
    from: '      if (changesRoster) onRosterChanged();',
    to: '      if (false) onRosterChanged();',
  },
  {
    id: 'J14',
    target: 'queue',
    suite: CONSOLE_SUITE,
    why: 'PRIVACY, Part 3 §2.4: a field the endpoint does not send reaches an applicant row — and a person who is only WAITING is even less the gym\'s business than a member',
    // RE-AIMED 2026-08-30. The name was wrapped in a truncating span when the
    // queue gained its clock columns; the anchor kept the bare expression. Same
    // call site.
    expect: "shows an applicant's four facts",
    from: '          <span className="truncate">{applicant.displayName}</span>',
    to: '          <span className="truncate">{applicant.displayName} {applicant.email}</span>',
  },
  {
    id: 'J15',
    target: 'queue',
    suite: CONSOLE_SUITE,
    why: 'THE WORST TAP IN THE PACKET: "Not this person" is wired to CONFIRM, so refusing a stranger admits them to the gym instead',
    expect: 'does not confirm them by accident',
    // Re-anchored with J13, when the call gained its `changesRoster` argument.
    // The whole-table pre-check ABORTED the run rather than reporting this as
    // ALIVE, which is the only reason it is a re-anchor and not a false "this
    // guarantee has no test" for the next chat to chase (:5199's class fix,
    // earning its keep for the fifth recorded time).
    from: '          onReject={() => decide(a.id, () => orgService.rejectApplication(gymId, a.id), false)}',
    to: '          onReject={() => decide(a.id, () => orgService.confirmApplication(gymId, a.id), false)}',
  },
  {
    id: 'J16',
    target: 'members',
    suite: CONSOLE_SUITE,
    why: "REMOVAL WITHOUT ITS QUESTION (Part 3 §4.3 specifies a confirm sheet): one mis-tap on a phone ends somebody's membership and takes the gym's features off them",
    expect: 'asks before it removes',
    from: '        onClick={() => setAsking(true)}',
    to: '        onClick={onRemove}',
  },
  {
    id: 'J17',
    target: 'members',
    suite: CONSOLE_SUITE,
    why: "A CONTROL THE SERVER WILL REFUSE: Remove is drawn beside the owner's own complimentary seat, where the server answers 409 — a live refusal wearing a working button's clothes",
    // RE-AIMED 2026-08-30. The guard became `seatIsFree(member)` at :14956/:15093
    // — Kd's own finding that anybody holding the keys costs the gym nothing and
    // looked on this screen exactly like somebody who does — and the anchor still
    // named the raw flag. Same call site, same branch.
    expect: 'offers NO remove control beside the owner',
    from: '      {seatIsFree(member) ? (',
    to: '      {seatIsFree(member) && false ? (',
  },
  {
    id: 'J18',
    target: 'members',
    suite: CONSOLE_SUITE,
    why: 'A REFUSAL REPORTED AS SUCCESS: a removal the server turned down re-reads the roster as though it had worked, so the person stays on the list with no explanation and the owner believes they are gone',
    expect: 'keeps the person on screen when the server refuses',
    from: '      setRemoveError(errorText(err, "We couldn\'t remove them. Please try again."));',
    to: '      reloadRoster();',
  },
  {
    id: 'J19',
    target: 'api',
    suite: API_SUITE,
    why: 'THE WIRE: DELETE quietly becomes POST. Every server test would still pass — `fastify.inject` sends no CORS preflight — and the button would be dead in a real browser, which is exactly how the Card-4 bug shipped behind 250 green tests',
    expect: 'hits the join-door surface',
    from: '      authApi.delete(`/v1/orgs/${gymId}/members/${userId}`),',
    to: '      authApi.post(`/v1/orgs/${gymId}/members/${userId}`),',
  },
  {
    id: 'J20',
    target: 'api',
    suite: API_SUITE,
    why: 'THE WIRE, second half: confirm stops sending `{}`, and Fastify refuses a POST that declares JSON and carries nothing — the front desk taps Confirm and gets a 400 on a route whose own tests all pass',
    expect: 'on confirm and reject',
    from: '      authApi.post(`/v1/orgs/${gymId}/applications/${applicationId}/confirm`, {}),',
    to: '      authApi.post(`/v1/orgs/${gymId}/applications/${applicationId}/confirm`),',
  },
  {
    id: 'J21',
    target: 'consoleview',
    suite: CONSOLE_VIEW_SUITE,
    why: 'A CLAIM MADE WITHOUT EVIDENCE: an unreadable count is printed as "0 people waiting" rather than withheld, so a console that could not ask says nobody is there',
    expect: 'refuses to state a number it was not given',
    from: "  if (typeof pendingCount !== 'number' || !Number.isFinite(pendingCount)) return null;",
    to: '  if (false) return null;',
  },
  {
    id: 'J23',
    target: 'panel',
    suite: GYM_RENDER_SUITE,
    why: 'CONSENT CARRIED ACROSS: the box stays ticked when the code is edited, so an agreement given about one organisation is sent to a different one — the fabricated-consent defect, one step removed',
    expect: 'forgets the consent question when the code is edited',
    from: '            setConsentAsked(false);\n            setConsentGiven(false);',
    to: '            void 0;',
  },
  {
    id: 'J24',
    target: 'queue',
    suite: CONSOLE_SUITE,
    why: 'A TAP IMPLYING SOMETHING MOVED: refusing somebody re-reads the member list, which flashes a loading state under a list that did not change',
    expect: 'does not confirm them by accident',
    from: '          onReject={() => decide(a.id, () => orgService.rejectApplication(gymId, a.id), false)}',
    to: '          onReject={() => decide(a.id, () => orgService.rejectApplication(gymId, a.id), true)}',
  },
  {
    id: 'J22',
    target: 'overview',
    suite: CONSOLE_SUITE,
    why: "THE REMINDER THAT IS NOT ONE: the owner's home screen counts the ROWS IT ASKED FOR rather than the queue, and it asks for one — so ninety people waiting reads as one",
    expect: 'puts the number waiting where an owner cannot miss it',
    from: '          ? (waitingOutcome.value.data?.pendingCount ?? null)',
    to: '          ? (waitingOutcome.value.data?.items?.length ?? null)',
  },

  // ── WAITING ON A GYM WITH NO PLAN (Kd 2026-08-29, :24141 §1) ──────────────
  //
  // Every row here is 4a's "a number or a state a user can see, and it is
  // wrong": a person told to walk up to a front desk that cannot let them in, a
  // countdown to a deadline nothing will act on, or the mirror image — a held
  // sentence shown to somebody waiting on a gym that is paying perfectly well.
  // **PAIRED IN BOTH DIRECTIONS ON PURPOSE** (:7104's PG1), and the second
  // direction is the worse defect, because that gym is a customer.
  {
    id: 'J25',
    target: 'gymview',
    suite: GYM_VIEW_SUITE,
    why: "THE THREE-STATE RULE INVERTED: only an explicit `true` counts as yes, so an api older than this bundle — which sends NOTHING, and whose field the shared schema defaults to null — reads as a held gym. Every person waiting on a healthy gym during a web-newer-than-api window is told it has stopped taking members. `null` means 'we could not ask', never 'no' (C97, :23711)",
    expect: 'treats a MISSING answer as yes',
    from: '      orgCanConfirm: app?.orgCanConfirm === false ? false : true,',
    to: '      orgCanConfirm: app?.orgCanConfirm === true ? true : false,',
  },
  {
    id: 'J26',
    target: 'gymview',
    suite: GYM_VIEW_SUITE,
    why: "THE SERVER'S ANSWER NEVER REACHES THE ROW: the field is dropped in the mapper, so `held` is false for every application and the card goes on promising a tap at the front desk that answers 409. The lock is deleted at its source rather than at the screen",
    expect: 'carries an explicit NO from the server onto the waiting row',
    from: '      orgCanConfirm: app?.orgCanConfirm === false ? false : true,',
    to: '',
  },
  {
    id: 'J27',
    target: 'card',
    suite: GYM_RENDER_SUITE,
    why: 'ON SCREEN AND FALSE: the held state never fires, so a person waiting on a gym that cannot confirm anybody is told "one tap at the front desk" — a tap the server refuses (:23711) — and is counted down to a deadline the sweep no longer acts on',
    expect: 'says the request is being HELD',
    from: '  const held = row.orgCanConfirm === false;',
    to: '  const held = false;',
  },
  {
    id: 'J28',
    target: 'card',
    suite: GYM_RENDER_SUITE,
    why: 'THE OTHER DIRECTION, AND THE WORSE ONE: the held state fires for EVERYBODY, so somebody waiting on a gym that is paying perfectly well is told it cannot take new members and their countdown disappears. A lock whose only tested failure is "it did not fire" is satisfied by one permanently shut',
    expect: 'is the ordinary card again on a gym that IS on a plan',
    from: '  const held = row.orgCanConfirm === false;',
    to: '  const held = true;',
  },
  {
    id: 'J29',
    target: 'card',
    suite: GYM_RENDER_SUITE,
    why: 'A DEADLINE THAT WILL NOT ARRIVE: the countdown comes back on a held row, so the screen says "Expires in 11 days" about a request the sweep is deliberately holding — and tells them to enter the code again after a date that will pass with nothing happening',
    expect: 'does NOT count down to a deadline that will not arrive',
    from: '        {!held && expiring !== null ? (',
    to: '        {expiring !== null ? (',
  },
  {
    id: 'J30',
    target: 'card',
    suite: GYM_RENDER_SUITE,
    why: "A PROMISE WITH NO CODE BEHIND IT: the held sentence grows the reassurance nobody can keep. Nothing in this product can put a lapsed gym back on a plan, and a held request whose deadline has passed still needs the PAYMENT card to survive the first sweep after one does — so 'they'll confirm you once they're back' is :5807's class, one card early",
    expect: 'promises nothing about being let in later',
    from: "it won't run out while that's the case.",
    to: "it won't run out, and they'll confirm you once they're back.",
  },
  {
    id: 'J31',
    target: 'card',
    suite: GYM_RENDER_SUITE,
    why: "KD'S RULING DELETED AT THE SCREEN: the reminder button disappears on a held row, which is the refusal he ruled FIRST and then reversed himself on one message later — it strands the person with no action at all, and the mark really does land on a queue the gym can still read",
    expect: 'it is the one thing this person can still do',
    from: '        {state.sent === null && row.applicationId !== null ? (',
    to: '        {state.sent === null && row.applicationId !== null && !held ? (',
  },
  {
    id: 'J32',
    target: 'panel',
    suite: GYM_RENDER_SUITE,
    why: "ON SCREEN AND FALSE ON THE ROUTE MOST PEOPLE ARRIVE ON: the join screen goes back to 'ask them now — it takes one tap' for a gym whose Confirm answers 409. `/org/join` draws this panel and NOTHING else — the dashboard card that says the same thing is not on that route — so this sentence is wrong with no second screen to correct it. It is the defect the card was HALF-fixing until the join door was checked",
    expect: 'tells somebody applying to a gym with no plan that their request is HELD',
    from: "            {held ? (\n              <p className=\"text-sm mt-1\" style={{ color: 'rgba(255,255,255,0.75)' }}>",
    to: "            {false ? (\n              <p className=\"text-sm mt-1\" style={{ color: 'rgba(255,255,255,0.75)' }}>",
  },
  {
    id: 'J33',
    target: 'panel',
    suite: GYM_RENDER_SUITE,
    why: "THE OTHER DIRECTION, AND THE WORSE ONE: the held sentence fires for EVERY applicant, so somebody joining a gym that is paying perfectly well is told it cannot take new members. `null` — which is what an api older than this bundle sends — must read as YES, never as no (C97's rule, :23711)",
    // Anchored on the HOISTED CONST, which is the one place the question is
    // asked. Both paragraphs then read `{held ? (`, so an anchor on either of
    // them matches twice and `String.replace` would silently take the first —
    // the multi-match hazard this card filed an `OWED.md` line about. Hoisting
    // was the fix in the SOURCE (:17676's precedent), not a workaround here.
    expect: 'treats a MISSING answer as the ordinary screen',
    from: '    const held = result.application?.orgCanConfirm === false;',
    to: '    const held = result.application?.orgCanConfirm !== true;',
  },
  {
    id: 'J34',
    target: 'panel',
    suite: GYM_RENDER_SUITE,
    why: "A CONTRADICTION IN THE READER'S OWN WORDS: 'Nothing is on hold' comes back directly under 'your request is being held'. One is about their app and the other about their request, and nobody reads a confirmation card carefully enough to make that distinction — it also re-dangles 'your gym's extras switch on the moment they confirm you' off an event that cannot happen yet",
    expect: 'tells somebody applying to a gym with no plan that their request is HELD',
    from: "            {held ? (\n              <p className=\"text-sm mt-2\" style={{ color: 'rgba(255,255,255,0.55)' }}>",
    to: "            {false ? (\n              <p className=\"text-sm mt-2\" style={{ color: 'rgba(255,255,255,0.55)' }}>",
  },
];

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

// Checked for the WHOLE table before a byte is written (:5199).
for (const m of MUTANTS) {
  if (!Object.hasOwn(TARGETS, m.target)) {
    abort(`${m.id}: names target '${m.target}', which is not in TARGETS. Nothing has been written yet.`);
  }
  if (/[^\x20-\x7e]/.test(m.expect)) {
    abort(`${m.id}: its -t filter is not ASCII. A curly apostrophe here matches no test and the mutant would look ALIVE.`);
  }
}

const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [k, { sha: sha(t.file), text: readFileSync(t.file, 'utf8') }]),
);

// EVERY ANCHOR IS CHECKED FOR THE WHOLE TABLE BEFORE A BYTE IS WRITTEN. A no-op
// mutation reports as ALIVE, and the honest reading of ALIVE is "this guarantee
// has no test" — so an anchor that has silently stopped matching sends the next
// chat hunting a hole that was never there (:5199, :8610, and twice more since).
for (const m of MUTANTS) {
  const original = originals.get(m.target);
  if (!original.text.includes(m.from)) {
    abort(
      `${m.id}: its anchor matches nothing in '${m.target}'. Nothing has been written yet. ` +
      `Re-anchor it against the current file — a no-op mutation reports as ALIVE, which reads as "this guarantee has no test".`,
    );
  }
}

const STRIP_ANSI = new RegExp(String.fromCharCode(27) + String.raw`\[[0-9;]*m`, 'g');
const tallied = (out) => {
  const clean = out.replace(STRIP_ANSI, '');
  return /Tests\s+(?:\d+ failed \| )?\d+ (?:passed|failed)/.test(clean) && !/No test files found/.test(clean);
};

const run = (suite, filter) => {
  try {
    const out = execSync(
      `corepack pnpm --filter web exec vitest run ${suite} -t ${JSON.stringify(filter)}`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
    return { out, failed: false, fault: null };
  } catch (e) {
    if (typeof e.status === 'number' && e.status !== 0) {
      return { out: `${e.stdout || ''}${e.stderr || ''}`, failed: true, fault: null };
    }
    return { out: '', failed: false, fault: `${e.code || ''} ${e.message}` };
  }
};

// THE CONTROL (:9509): every (suite, filter) pair this sweep will use must
// report GREEN and must produce a tally BEFORE anything is mutated. A filter
// matching no test would otherwise make its mutant look ALIVE.
console.log('control (unmutated) — every filter must be GREEN and must tally ...');
const pairs = [];
const seenPairs = new Set();
for (const m of MUTANTS) {
  const key = `${m.suite} :: ${m.expect}`;
  if (seenPairs.has(key)) continue;
  seenPairs.add(key);
  pairs.push({ suite: m.suite, filter: m.expect });
}
for (const { suite, filter } of pairs) {
  const { out, failed, fault } = run(suite, filter);
  if (fault !== null) abort(`control for ${JSON.stringify(filter)}: the RUNNER failed — ${fault}`);
  if (!tallied(out)) abort(`control for ${JSON.stringify(filter)}: no test tally. That filter matches no test, so its mutants would prove nothing.`);
  if (failed) abort(`control for ${JSON.stringify(filter)}: RED before any mutation. Every verdict below would be meaningless.`);
  console.log(`  control GREEN  ${filter}`);
}
console.log('control complete\n');

const results = [];
for (const m of MUTANTS) {
  const target = TARGETS[m.target];
  const original = originals.get(m.target);
  const mutated = original.text.replace(m.from, m.to);
  if (mutated === original.text) {
    abort(`${m.id}: its anchor matched nothing at apply time. Re-anchor it against the current file.`);
  }
  writeFileSync(target.file, mutated);

  const { out, failed, fault } = run(m.suite, m.expect);

  // Restore FIRST, always (:5199).
  writeFileSync(target.file, original.text);
  if (fault !== null) {
    if (sha(target.file) !== original.sha) abort(`${m.id}: the runner failed AND the restore did not reproduce the original bytes — fix the tree by hand.`);
    abort(`${m.id}: the RUNNER itself failed, which is NOT a test result — ${fault}`);
  }
  if (sha(target.file) !== original.sha) {
    abort(`${m.id}: the restore did NOT reproduce the original bytes. The working tree is dirty — fix it before running anything else.`);
  }
  if (!tallied(out)) abort(`${m.id}: the run produced no test tally, so it proves nothing.`);

  const verdict = failed ? 'RED' : 'ALIVE';
  results.push({ ...m, verdict, ok: verdict === 'RED' });
  console.log(`${m.id.padEnd(4)} ${verdict.padEnd(5)} ${verdict === 'RED' ? 'as expected' : 'UNEXPECTED'}  ${m.why}`);
}

const bad = results.filter((r) => !r.ok);
console.log('\n--- summary ---');
console.log(
  `${results.length} mutants · ${results.filter((r) => r.verdict === 'RED').length} RED · ` +
  `${results.filter((r) => r.verdict === 'ALIVE').length} ALIVE (0 expected) · 0 never ran`,
);
console.log('restore verified byte-exact (sha256) after every mutant');
if (bad.length) {
  console.error(`\n${bad.length} mutant(s) survived: ${bad.map((b) => b.id).join(', ')}`);
  process.exit(1);
}
console.log('every mutant matched its expectation');
