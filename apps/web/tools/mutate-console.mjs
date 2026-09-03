/**
 * Mutation audit — the gym console's screens.
 * Run from the repo root: `node apps/web/tools/mutate-console.mjs`
 *
 * WHY THESE GUARANTEES AND NOT OTHERS (:5857 rule 4a — the audit is scoped by
 * severity). This is the WEB half of the console card: it changes no server
 * behaviour, so under 4a there are no database mutants here at all and the
 * whole sweep runs in minutes. What is left is exactly 4a's own columns:
 *   · OWNERSHIP — is a gym you merely BELONG to listed as one you run, and can
 *     a member's row carry something Part 3 §2.4 forbids a gym from seeing
 *     (C1, C2)
 *   · NUMBERS A USER SEES — a member count taken off one page of a cursor
 *     walk, and the owner's own complimentary seat counted as somebody who
 *     joined (C3, C4)
 *   · ON SCREEN AND FALSE — a dead join code printed under "share this with
 *     your members", a country offered that the server will refuse, an offline
 *     failure reported as something the server said, and — twice, because it is
 *     the shape this project has shipped before — a FAILED read drawn as an
 *     EMPTY one (C5, C6, C7, C8, C9)
 *   · DATA A USER IS LOOKING AT — the roster rows already on screen being wiped
 *     by a failure to fetch the NEXT page (C10)
 *   · SAVES — the gym's timezone silently becoming somebody else's, which is
 *     written into the org row once and decides its day boundaries forever
 *     (C11)
 *
 * Deliberately NOT mutated, per the same rule: wording, layout, the rail-vs-tabs
 * breakpoint, icon choices, comments, and the org-type hint text.
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

const VIEW_SUITE = 'src/pages/console/consoleView.test.js';
const CODES_VIEW_SUITE = 'src/pages/console/codesView.test.js';
const RENDER_SUITE = 'src/pages/console/console.render.test.jsx';
const API_SUITE = 'src/api/orgsApi.test.js';
const STAFF_VIEW_SUITE = 'src/pages/console/staffView.test.js';
const SETTINGS_SUITE = 'src/pages/console/settings.render.test.jsx';
const STORE_SUITE = 'src/pages/console/consoleOrgs.test.js';
const GYMVIEW_SUITE = 'src/pages/console/gymDetailsView.test.js';
const BILLING_VIEW_SUITE = 'src/pages/console/billingView.test.js';
const TRIAL_SUITE = 'src/pages/console/trial.render.test.jsx';
/** The prompt an owner cannot skip (Kd, :22215/:22697), added 2026-08-28 with
 *  the modal that replaced the Overview's trial button. */
const PROMPT_SUITE = 'src/pages/console/planPrompt.render.test.jsx';
/** The class guard: one gym, then the other, asking whether anything on screen
 *  is still about the first. Four Critical/High findings have lived on that
 *  journey and nothing watched it until 2026-08-28. */
const GYM_SWITCH_SUITE = 'src/pages/console/gymSwitch.render.test.jsx';
/** The lapsed gym's console (Kd, :23711), added 2026-08-29. Its cases are all
 *  PAIRED — a control greyed on a gym with no plan, and the same control live on
 *  a gym that is paying — because a lock whose only tested failure is "it did
 *  not fire" is satisfied by a console permanently shut (:7104's PG1). */
const READ_ONLY_SUITE = 'src/pages/console/readOnlyConsole.render.test.jsx';

/** OPENING HOURS (Kd :26624, :26684, :26736), added 2026-09-01 with the web
 *  half. THREE suites because the feature has three readers and a mutant is a
 *  claim about ONE call site (:15770): the view file decides WHAT is sent and
 *  what is wrong with a week, the panel decides what an OWNER sees, and the
 *  note decides what a MEMBER sees — and the member's half is where `unset`
 *  becoming "Closed" would reach every gym in the database at once. */
const HOURS_VIEW_SUITE = 'src/pages/console/hoursView.test.js';
const HOURS_PANEL_SUITE = 'src/components/console/openingHours.render.test.jsx';
const HOURS_NOTE_SUITE = 'src/components/gym/gymHours.render.test.jsx';

/** THE GYM'S NUMBERS, added 2026-09-03. The render suite is the console's own
 *  (`RENDER_SUITE` above) because the numbers are a pane on a screen that
 *  already had one, not a screen of their own. */
const OVERVIEW_VIEW_SUITE = 'src/pages/console/overviewView.test.js';
const ATTENDANCE_VIEW_SUITE = 'src/pages/console/attendanceView.test.js';

const TARGETS = {
  view: { file: resolve(ROOT, 'apps/web/src/pages/console/consoleView.js') },
  api: { file: resolve(ROOT, 'apps/web/src/api/orgsApi.js') },
  home: { file: resolve(ROOT, 'apps/web/src/pages/console/ConsoleHome.jsx') },
  members: { file: resolve(ROOT, 'apps/web/src/pages/console/Members.jsx') },
  newgym: { file: resolve(ROOT, 'apps/web/src/pages/console/NewGym.jsx') },
  overview: { file: resolve(ROOT, 'apps/web/src/pages/console/Overview.jsx') },
  codesview: { file: resolve(ROOT, 'apps/web/src/pages/console/codesView.js') },
  codespanel: { file: resolve(ROOT, 'apps/web/src/components/console/JoinCodesPanel.jsx') },
  queue: { file: resolve(ROOT, 'apps/web/src/pages/console/ApplicationsQueue.jsx') },
  staffview: { file: resolve(ROOT, 'apps/web/src/pages/console/staffView.js') },
  // The console's ONE kept answer to "what may I do here?", and the hooks that
  // read it. Both are targets because a mutant is a claim about one call site
  // (:15007's S16): the store decides WHAT is kept and the hooks decide WHEN it
  // is asked for, and the loop this card shipped and fixed lived in the second.
  orgstore: { file: resolve(ROOT, 'apps/web/src/pages/console/consoleOrgs.js') },
  orghook: { file: resolve(ROOT, 'apps/web/src/pages/console/useConsoleOrg.js') },
  staffpanel: { file: resolve(ROOT, 'apps/web/src/components/console/StaffPanel.jsx') },
  settings: { file: resolve(ROOT, 'apps/web/src/pages/console/Settings.jsx') },
  // The gym-details form, added 2026-08-26 with the web half of
  // `PATCH /v1/orgs/:gymId`. TWO targets for one feature, because a mutant is a
  // claim about ONE call site (:15770): the view file decides WHAT is sent and
  // the panel decides WHEN and what happens afterwards.
  gymview: { file: resolve(ROOT, 'apps/web/src/pages/console/gymDetailsView.js') },
  gympanel: { file: resolve(ROOT, 'apps/web/src/components/console/GymDetailsPanel.jsx') },
  // The console's shared chrome, and a target since 2026-08-26: `ConsoleSection`
  // decides whether a whole section of Settings is on screen at all.
  states: { file: resolve(ROOT, 'apps/web/src/components/console/ConsoleStates.jsx') },
  // CRLF — every anchor aimed at this file must be ONE line. A two-line anchor
  // written with `\n` matches nothing here and the mutant reports ALIVE, whose
  // honest reading is "this guarantee has no test" (:4267, four harnesses).
  layout: { file: resolve(ROOT, 'apps/web/src/components/console/ConsoleLayout.jsx') },
  // The trial, the banner and the meter, added 2026-08-27 with the web half of
  // `POST /v1/orgs/:gymId/trial`. THREE targets for one feature, because a
  // mutant is a claim about ONE call site (:15770): the view file decides WHICH
  // state a gym is in, the card decides what happens when the button is
  // pressed, and the banner decides whether the answer reaches a screen at all.
  billingview: { file: resolve(ROOT, 'apps/web/src/pages/console/billingView.js') },
  trialcard: { file: resolve(ROOT, 'apps/web/src/components/console/TrialCard.jsx') },
  banner: { file: resolve(ROOT, 'apps/web/src/components/console/ConsoleBanner.jsx') },
  // THE PROMPT AN OWNER CANNOT SKIP, added 2026-08-28 (Kd, :22215/:22697). It is
  // the console's highest-stakes surface in BOTH directions and the mutants
  // below say so: it must appear for a gym with no plan, and it must NOT appear
  // over anybody it would seal out of their own console. CRLF, like every file
  // here — one-line anchors only.
  planmodal: { file: resolve(ROOT, 'apps/web/src/components/console/PlanModal.jsx') },
  // WHEN WE'RE OPEN (Kd :26624 and its two addenda), added 2026-09-01.
  hoursview: { file: resolve(ROOT, 'apps/web/src/pages/console/hoursView.js') },
  hourspanel: { file: resolve(ROOT, 'apps/web/src/components/console/OpeningHoursPanel.jsx') },
  hoursnote: { file: resolve(ROOT, 'apps/web/src/components/gym/GymHoursNote.jsx') },
  attendanceview: { file: resolve(ROOT, 'apps/web/src/pages/console/attendanceView.js') },
  // THE GYM'S NUMBERS (Kd :29961 ruling 1 - the tiles count VISITS, not
  // workouts), added 2026-09-03 with the web half. TWO targets for one feature,
  // because a mutant is a claim about ONE call site (:15770): the view file
  // decides WHICH sentence and WHERE a bar goes, and the panel decides what
  // reaches a screen at all.
  overviewview: { file: resolve(ROOT, 'apps/web/src/pages/console/overviewView.js') },
  overviewnumbers: { file: resolve(ROOT, 'apps/web/src/components/console/OverviewNumbers.jsx') },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'C1',
    target: 'view',
    suite: RENDER_SUITE,
    why: 'OWNERSHIP: a gym the caller merely BELONGS to is listed as one they run, and every screen behind it answers 404 — a door onto an error',
    expect: 'lists the gyms the caller staffs',
    from: "  return (orgs ?? []).filter((o) => o?.staffRole != null);",
    to: "  return orgs ?? [];",
  },
  {
    id: 'C2',
    target: 'members',
    suite: RENDER_SUITE,
    why: "PRIVACY, Part 3 §2.4: a field the endpoint does not send reaches the roster row — the exact edit that breaks the org-visibility promise",
    expect: 'four facts AND NOTHING ELSE',
    from: '          {member.displayName}',
    to: '          {member.displayName} {member.email}',
  },
  {
    id: 'C3',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'NUMBER ON SCREEN: one page of a cursor walk is printed as the member count, so a gym with hundreds of members reads "50 members"',
    expect: 'prints a bound when there are more pages',
    from: "  if (page.nextCursor != null) return `${n}+ members`;",
    to: "  if (page.nextCursor != null && false) return `${n}+ members`;",
  },
  {
    id: 'C4',
    target: 'view',
    suite: VIEW_SUITE,
    why: "NUMBER ON SCREEN: the owner's own complimentary seat counts as somebody who joined, so a brand-new gym stops saying nobody has",
    expect: 'complimentary seat as somebody who joined',
    from: "  return page.items.filter((m) => m?.complimentary !== true).length;",
    to: "  return page.items.length;",
  },
  {
    id: 'C5',
    target: 'view',
    suite: RENDER_SUITE,
    why: 'ON SCREEN AND FALSE: a paused code reads as live, so the console tells an owner to share a code the join path will refuse',
    expect: 'refuses to invite anyone with a code the server will turn away',
    from: "  if (code.paused) return { live: false, reason: 'paused', label: 'Paused' };",
    to: "  if (code.paused && false) return { live: false, reason: 'paused', label: 'Paused' };",
  },
  {
    id: 'C6',
    target: 'view',
    suite: RENDER_SUITE,
    why: "BLOCKED FROM FINISHING: the country picker stops being the server's own list, so an owner picks a country and org-create then refuses them",
    expect: 'offers only countries the server is open in',
    from: "  return SUPPORTED_COUNTRIES.map((value) => ({ value, label: name(value) })).sort((a, b) =>",
    to: "  return [...SUPPORTED_COUNTRIES, 'AU'].map((value) => ({ value, label: name(value) })).sort((a, b) =>",
  },
  {
    id: 'C7',
    target: 'api',
    suite: API_SUITE,
    why: 'ON SCREEN AND FALSE: an offline request is reported as something the server said, when nothing reached the server at all',
    expect: 'never reports an offline request as something the server said',
    from: "  if (err?.response === undefined) {",
    to: "  if (err?.response === undefined && err === null) {",
  },
  {
    id: 'C8',
    // RE-ANCHORED AND RE-TARGETED, `home` → `orgstore`. The line this named was
    // `ConsoleHome`'s own `catch`, and the shared-answer card deleted it: the
    // failure is decided once, in the store, for every console screen. The
    // GUARANTEE is unchanged and so is the test that carries it — what moved is
    // the file that can break it. Left aimed at the old line it would have
    // matched nothing, and a no-op mutation reports ALIVE, whose honest reading
    // is "this guarantee has no test" (:5199).
    target: 'orgstore',
    suite: RENDER_SUITE,
    why: 'ON SCREEN AND FALSE: a FAILED read draws the EMPTY state, so an owner of three gyms whose connection blipped is told they run none',
    expect: 'with a way out',
    from: '        error: errorText(err, "We couldn\'t load your gyms."),',
    to: '        error: null,',
  },
  {
    id: 'C9',
    target: 'members',
    suite: RENDER_SUITE,
    why: 'ON SCREEN AND FALSE, same shape one screen over: a failed roster read draws "nobody has joined yet" at a gym that is full',
    expect: 'roster is empty when the read failed',
    from: "        setState({ loading: false, error: message, items: [], nextCursor: null });",
    to: "        setState({ loading: false, error: null, items: [], nextCursor: null });",
  },
  {
    id: 'C10',
    target: 'members',
    suite: RENDER_SUITE,
    why: 'DATA IN FRONT OF THE USER: a failure to fetch the NEXT page wipes the rows already on screen',
    expect: 'keeps the rows already on screen when the NEXT page fails',
    from: '      setState((prev) => ({ ...prev, error: errorText(err, "We couldn\'t load any more.") }));',
    to: '      setState({ loading: false, error: errorText(err, "We couldn\'t load any more."), items: [], nextCursor: null });',
  },
  {
    id: 'C11',
    target: 'view',
    suite: VIEW_SUITE,
    why: "SAVES: the detected zone stops being injected, so a runtime that calls the user's zone by its other alias silently sets the gym up in somebody else's day boundaries — written once, permanent",
    expect: 'injects a detected zone the runtime does not list',
    from: "  if (typeof detected === 'string' && detected !== '' && !zones.includes(detected)) {",
    to: "  if (typeof detected === 'string' && detected !== '' && zones.includes(detected)) {",
  },

  // ── T3 round 1's fixes, each restored so its regression test is MEASURED red
  //    rather than asserted to be (:5348 rule 3) ───────────────────────────
  {
    id: 'C12',
    target: 'newgym',
    suite: RENDER_SUITE,
    why: 'C/H-1 RESTORED: the wizard preselects the United States again, so an owner in India who types a name and presses Create gets a gym billed in USD — permanently, since no settings route exists',
    expect: 'does NOT preselect a country',
    from: "  const [country, setCountry] = useState('');",
    to: "  const [country, setCountry] = useState('US');",
  },
  {
    id: 'C13',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'L-4 RESTORED: the console shows the OLDEST code rather than the first live one, so a rotated gym keeps handing out the retired code',
    expect: 'picks the first LIVE one',
    from: "  return list.find((c) => codeState(c, now).live) ?? list[0] ?? null;",
    to: "  return list[0] ?? null;",
  },
  {
    id: 'C14',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'L-5 RESTORED: a brand-new gym reads "1 member" directly above "nobody has joined yet" — two true sentences that contradict each other on screen',
    expect: 'names the one membership as yours',
    // RE-ANCHORED after round 2's Low-3 rewrote this function. The old anchor
    // named a line that no longer exists, and the harness aborted at APPLY time
    // — 13 mutants into a run. Second anchor drift caused by my own fix in two
    // rounds (O21 was the first), which is what moved the whole-table pre-check
    // below from the api harness into this one.
    from: "  return isViewersOwnSeat ? '1 member (you)' : label;",
    to: "  return label;",
  },
  {
    id: 'C15',
    target: 'view',
    suite: VIEW_SUITE,
    why: "L-6 RESTORED: the database's own vocabulary is printed on a page a gym owner reads (`owner`, `gym`)",
    expect: 'labels org types and roles',
    from: "  return Object.hasOwn(ROLE_WORDS, role ?? '') ? ROLE_WORDS[role] : (role ?? '');",
    to: "  return role ?? '';",
  },
  {
    id: 'C16',
    target: 'api',
    suite: API_SUITE,
    why: 'L-7 RESTORED: a 200 whose body does not match the contract is accepted, so a malformed success becomes an empty list and then a confident false sentence on screen',
    expect: 'rejects a mine response with no orgs',
    from: "  if (!parsed.success) throw contractError(what);",
    to: "  if (!parsed.success && false) throw contractError(what);",
  },
  {
    id: 'C17',
    target: 'overview',
    suite: RENDER_SUITE,
    why: "L-3 RESTORED: the two independently-authorised reads share one fate again, so a trainer the API deliberately grants the code to loses the whole screen to the roster's 403",
    expect: 'keeps the half that works when only ONE of the two reads is refused',
    from: "        codesOutcome.status === 'fulfilled'",
    to: "        codesOutcome.status === 'fulfilled' && membersOutcome.status === 'fulfilled'",
  },

  // ── T3 round 2's fixes ─────────────────────────────────────────────────
  {
    id: 'C18',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'ROUND 2 Low-3 RESTORED: "(you)" is INFERRED from the seat being complimentary rather than checked against the viewer, so the day a manager can open this screen it tells them the owner\'s seat is theirs',
    expect: 'only about the person actually reading it',
    from: "    typeof viewerUserId === 'string' &&\n    only.userId === viewerUserId;",
    to: "    true;",
  },
  {
    id: 'C19',
    target: 'view',
    suite: VIEW_SUITE,
    why: "ROUND 2's OWN NEAR-MISS RESTORED: the truncation guard goes, so a page-of-one out of a roster of hundreds reads \"1 member (you)\" — a wrong number, and the defect this round's rewrite actually shipped before an existing test caught it",
    expect: 'leaves every other case exactly as it was',
    from: "  const whole = page?.nextCursor == null;",
    to: "  const whole = true;",
  },
  {
    // RE-TARGETED `overview` -> `api` when T3 round 2's L-5 moved `isRetryable`
    // into `orgsApi.js` (three copies of one rule, one of them the precedent the
    // other two cited). The GUARANTEE is unchanged and so is the mutation; only
    // the file holding the line moved. The whole-table pre-check ABORTED the
    // sweep on the stale anchor before a byte was written — a no-op mutation
    // would have reported ALIVE, whose honest reading is "this guarantee has no
    // test" (:10726's class, and the fifth time on this branch that a fix of
    // mine moved an anchor).
    id: 'C20',
    target: 'api',
    suite: RENDER_SUITE,
    why: 'ROUND 2 Low-4 RESTORED: a permanent 403 is offered a Try again that can never succeed',
    expect: 'no retry on a refusal that retrying can never fix',
    // RE-AIMED 2026-08-29 at the SAME call site (:15770), never at whichever
    // line looked closest. `isRetryable` was one `return` until the read-only
    // card gave it a second permanent case, and this row is the 403 half — the
    // guarantee it has always carried. **The whole-table pre-check caught the
    // drift before a byte was written**, which is :23128's standing rule
    // earning itself again: a fix moves anchors that nothing in its diff
    // mentions. C118/C119 below are the 409 half and anchor the other line.
    from: "  if (errorStatus(err) === 403) return false;",
    to: "  if (false) return false;",
  },
  {
    // THE SAME LINE, THE OTHER CALLER. Sharing the predicate means one edit now
    // reaches two screens, so it needs two observers: C20 above is the gym
    // Overview's panes, this is the Staff panel's action errors (T3 round 2 L-3,
    // whose gate was observed by nothing at all until that round). Identical
    // mutation, different suite — a mutant is a claim about a CALL SITE, and
    // de-duplicating the rule did not merge the two guarantees.
    id: 'S16',
    target: 'api',
    suite: SETTINGS_SUITE,
    why: 'ON SCREEN AND FALSE: the Staff panel offers Try again over a permanent 403 and over a half-done removal it cannot finish — a button promising to redo something it does not do',
    expect: 'offers NO Try again over a permanent 403',
    // Re-aimed with C20 above, same reason and same call site.
    from: "  if (errorStatus(err) === 403) return false;",
    to: "  if (false) return false;",
  },
  {
    id: 'C21',
    target: 'overview',
    suite: RENDER_SUITE,
    why: 'ROUND 2 Low-4 RESTORED, second half: both reads failing the same way stack two identical error cards with two Try again buttons',
    expect: 'shows ONE error, not two, when both reads fail the same way',
    from: "      {!members.loading && members.error !== null && members.error !== codes.error ? (",
    to: "      {!members.loading && members.error !== null ? (",
  },

  // ── C22–C27: MANAGING JOIN CODES ────────────────────────────────────────
  //
  // Scoped by :5857 rule 4a. This is a web card, so there are NO database
  // mutants and the sweep runs in minutes. What earns a mutant here is what
  // rule 1a calls Critical/High: a control offered to somebody the server will
  // refuse, a DATE a user sees that is wrong, and a change that silently
  // destroys a setting the owner never saw.
  {
    // RE-ANCHORED AND RE-AIMED, T3 round 1 C/H-1. Both halves moved (:11846):
    // the gate no longer reads a role, and the test that names the guarantee was
    // renamed with it. The OLD mutant widened the role list; the sharp mutation
    // now is reading the WRONG TICK — `codes.invite` is one line away in §2.2,
    // every trainer holds it, and swapping them hands the whole default roster
    // the controls while looking entirely reasonable in the diff.
    id: 'C22',
    target: 'codesview',
    suite: CODES_VIEW_SUITE,
    why: 'PRIVILEGE ON SCREEN: the gate reads `codes.invite` instead of `codes.manage`, so every DEFAULT trainer is drawn code controls the server answers 403 to — the console offering a person a control it knows they will be told off for',
    expect: 'still refuses the default trainer, who holds Invite and not management',
    from: "  return Array.isArray(privileges) && privileges.includes('codes.manage');",
    to: "  return Array.isArray(privileges) && privileges.includes('codes.invite');",
  },
  {
    // THE OTHER DIRECTION, and it is the defect the round was actually convened
    // for. C22 catches the gate opening too WIDE; nothing caught it staying shut
    // over a tick that was granted — which is what shipped.
    id: 'C39',
    target: 'codesview',
    suite: CODES_VIEW_SUITE,
    why: 'THE ROUND-1 CRITICAL ITSELF: the gate goes back to asking the job title, so an owner who ticks `codes.manage` onto a trainer buys them a power with no button anywhere — stored, allowed by the server, and invisible',
    expect: 'asks for the POWER, so a trainer who was GIVEN it is allowed',
    from: "  return Array.isArray(privileges) && privileges.includes('codes.manage');",
    to: "  return privileges === 'owner' || privileges === 'manager';",
  },
  {
    id: 'C40',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'THE SAME CRITICAL AT THE OTHER DOOR: Remove goes back to the job title, so `members.remove` ticked onto a trainer reaches no button — its sibling had no direct test at all before this round, which is how one of the two was missed',
    expect: 'asks for the POWER, so a trainer who was GIVEN it is allowed',
    from: "  return Array.isArray(privileges) && privileges.includes('members.remove');",
    to: "  return privileges === 'owner' || privileges === 'manager';",
  },
  {
    // THE DEPLOY WINDOW. Absent and empty are DIFFERENT answers and this is the
    // only thing that says so: fall back on an empty array and an owner who has
    // just narrowed somebody to nothing hands it all straight back.
    id: 'C41',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'A DELIBERATE SET IS OVERRULED: an EMPTY privileges array is treated as "ask the role", so a person an owner narrowed to nothing gets their whole role template back — the one direction a permissions screen must never move on its own',
    expect: 'treats an EMPTY array as a real answer',
    from: '  if (Array.isArray(org?.privileges)) return org.privileges;',
    to: '  if (Array.isArray(org?.privileges) && org.privileges.length > 0) return org.privileges;',
  },
  {
    id: 'C42',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'THE WEB-NEWER-THAN-API WINDOW: an ABSENT privileges field falls back to NOTHING instead of the role, so the moment the web deploys ahead of the api every real manager loses their controls — the failure `.optional()` exists to prevent, arriving through the fallback instead of the parser',
    expect: 'falls back to the ROLE when the field is absent',
    from: '  return ROLE_PRIVILEGES[org?.staffRole] ?? [];',
    to: '  return [];',
  },
  {
    id: 'C23',
    target: 'codesview',
    suite: CODES_VIEW_SUITE,
    why: 'A DATE A USER SEES: the end date becomes the START of the chosen day, so a code an owner set to work THROUGH the 31st dies at the beginning of it — up to a full day early, and in the wrong timezone as well',
    expect: 'sends the END of the chosen day',
    from: '  const at = new Date(year, month - 1, day, 23, 59, 59, 0);',
    to: '  const at = new Date(year, month - 1, day, 0, 0, 0, 0);',
  },
  {
    id: 'C24',
    target: 'codesview',
    suite: CODES_VIEW_SUITE,
    why: 'FALSE ON SCREEN: an unread code list reports as "full", so the New code button vanishes for a gym whose request merely blipped',
    expect: 'is null when the list could not be read',
    from: '  if (!Array.isArray(codes)) return null;',
    to: '  if (!Array.isArray(codes)) return true;',
  },
  {
    id: 'C25',
    target: 'codesview',
    suite: CODES_VIEW_SUITE,
    why: 'A NUMBER A USER SEES: a code whose count could not be read prints "Nobody is using this code yet" — a claim about other people built out of a missing field',
    expect: 'says nothing about a count it does not have',
    from: '? code.joined : null;',
    to: '? code.joined : 0;',
  },
  {
    id: 'C26',
    target: 'codespanel',
    suite: RENDER_SUITE,
    why: "DATA LOSS: the pause switch starts sending the restrictions too, so switching a code off silently clears an end date and a join limit the owner set elsewhere and this control never showed them",
    expect: 'sending ONLY the pause',
    from: "            onPause={() => run(() => orgService.updateCode(gymId, code.code, { paused: true }))}",
    to: "            onPause={() => run(() => orgService.updateCode(gymId, code.code, { paused: true, expiresAt: null, maxUses: null }))}",
  },
  {
    id: 'C27',
    target: 'codespanel',
    suite: RENDER_SUITE,
    why: 'FALSE ON SCREEN: the panel stops re-reading after a change, so a code an owner just switched off still reads as working until they reload — the screen and the server disagree about the door of the owner’s own gym',
    expect: 're-reads the codes after a change',
    from: '      await onChanged();',
    to: '      void 0;',
  },

  // ── C28–C32: THE COUNT'S MEANING, TAPS INSTEAD OF TYPING, AND REMOVAL ────
  //
  // From Kd's smoke of 2026-08-21. Each row is 4a's "a number a user sees and is
  // FALSE" or a control that would be drawn where the server refuses it; the
  // wording of the confirmation sentences is Low and is not mutated.
  {
    id: 'C28',
    target: 'codesview',
    suite: CODES_VIEW_SUITE,
    why: 'A NUMBER A USER SEES (:5807): the summary reads the server\'s lifetime CLAIM tally instead of the people who are in, which is exactly the "2 people have joined with it" Kd was shown over a code one person had used',
    expect: 'says IS IN rather than HAS JOINED',
    from: '    typeof code.joined === \'number\' && Number.isFinite(code.joined) ? code.joined : null;',
    to: '    typeof code.uses === \'number\' && Number.isFinite(code.uses) ? code.uses : null;',
  },
  {
    id: 'C29',
    target: 'view',
    suite: VIEW_SUITE,
    why: 'FALSE ON SCREEN: the "Fully used" chip is decided on a count the server no longer enforces against, so a code with places free reads as full — and the owner replaces a code that was working',
    expect: 'calls a used-up code dead at the cap',
    from: '  if (code.maxUses != null && code.joined >= code.maxUses) {',
    to: '  if (code.maxUses != null && code.uses >= code.maxUses) {',
  },
  {
    id: 'C30',
    target: 'codesview',
    suite: CODES_VIEW_SUITE,
    why: "A VALUE THE SERVER WOULD REFUSE: stepping below the smallest limit yields 0 instead of clearing it, so a tap sends a limit the server answers 400 to — the fat-fingered value taking typing away was meant to make impossible",
    expect: 'never produces a value parseLimit would refuse',
    from: '  if (next < 1) return \'\';',
    to: '  if (next < 0) return \'\';',
  },
  {
    id: 'C31',
    target: 'codesview',
    suite: CODES_VIEW_SUITE,
    why: 'A CONTROL THE SERVER REFUSES: Remove is offered on a code that still WORKS, so an owner taps it and reads a 409 — and, if the server ever agreed, a live door would vanish from the only list that watches it',
    expect: 'refuses a WORKING code',
    from: "  return state.reason === 'paused' || state.reason === 'expired';",
    to: '  return true;',
  },
  {
    id: 'C32',
    target: 'codespanel',
    suite: RENDER_SUITE,
    why: 'DATA LOSS BY MISTAKE: removal stops asking first, so one tap on a row takes a code off the list with no chance to say no — the confirmation Replace has for the same reason',
    expect: 'asks before removing a code',
    from: '              onClick={() => setConfirmingRemove(true)}',
    to: '              onClick={() => onRemove()}',
  },

  // ── C33–C35: THE LIMITS EDITOR, WHICH NO MUTANT AND NO TEST REACHED ─────
  //
  // T3 L-1 found it by deleting `expiresAt` from the save and watching 101 tests
  // stay green. C26 already guarded the PAUSE switch against exactly this class
  // (a control silently dropping a field it displayed) and the sibling control
  // beside it had nothing. That is what a mutant row is for.
  {
    id: 'C33',
    target: 'codespanel',
    suite: RENDER_SUITE,
    why: "DATA LOSS: the limits editor stops sending the end date it DISPLAYED, so an owner who clears the date to mean 'never expires' saves a change that silently keeps the old expiry — C26's class on the control C26 does not cover",
    expect: 'sends BOTH fields from the Limits editor',
    // The condition INVERTED rather than the statement deleted: a first draft
    // wrote `if (false)` before a `const`, which is a SyntaxError, and the
    // harness aborted on "no test tally" rather than reporting a false RED. A
    // mutant has to be code that RUNS and is wrong, not code that fails to load.
    from: '    if (!untouchedAndPast) patch.expiresAt = endIso;',
    to: '    if (untouchedAndPast) patch.expiresAt = endIso;',
  },
  {
    id: 'C34',
    target: 'codespanel',
    suite: RENDER_SUITE,
    why: "THE OWNER'S TYPING: the editor closes before the change lands, so a refusal — a limit below the people already in — throws away what they set and leaves them re-opening the form to find out what it was",
    expect: 'keeps the editor open and the typing when the server refuses',
    from: '      const ok = await onSaveLimits(patch);\n      if (ok) setEditing(false);',
    to: '      await onSaveLimits(patch);\n      setEditing(false);',
  },
  {
    id: 'C35',
    target: 'codespanel',
    suite: RENDER_SUITE,
    why: "A REFUSAL ABOUT A FIELD NOBODY TOUCHED: an expired code's old date is sent back untouched, so the server refuses the owner's LIMIT change with 'that end date has already passed' — about a box they never went near",
    // ASCII only: the test's own title carries a curly apostrophe and the
    // harness refuses such a filter outright, because `-t` would match nothing
    // and the mutant would report ALIVE for a reason that is not about the code.
    expect: 'does not resend an expired code',
    from: '    if (!untouchedAndPast) patch.expiresAt = endIso;',
    to: '    patch.expiresAt = endIso;',
  },

  // ── S1–S11: THE STAFF SECTION ───────────────────────────────────────────
  //
  // The web half of Part 3 §4.7. Still no server behaviour and therefore still
  // no database mutants (:5857 rule 4a); the columns these sit in are
  //   · AUTHORITY — who is shown the keys to a gym, and whose row gets a
  //     control the server would refuse (S1, S2, S9, S11)
  //   · DATA LOSS / A DESTRUCTIVE ACT NOBODY CHOSE — Kd's removal ruling
  //     reaching the network in the wrong order, or with the choice ignored
  //     (S5, S6), and the half-done state being swallowed (S7)
  //   · A FALSE THING A USER SEES — "0 people run this gym" off a failed read,
  //     a failed read drawn as a list with controls over it, and the join-code
  //     sentence that stopped being true (S3, S4, S8)
  //   · MONEY-ADJACENT — the form defaulting to the LARGER grant (S10)
  //
  // NOT mutated, per the same rule: the confirmation wording, the role hints,
  // the layout, the icons, the "(you)" chip's styling.
  //
  // Every anchor here is ONE LINE. `ConsoleLayout.jsx` is CRLF and the other two
  // are LF, so a multi-line anchor would work in one file and silently match
  // nothing in the other.
  {
    id: 'S1',
    target: 'staffview',
    suite: STAFF_VIEW_SUITE,
    why: 'AUTHORITY: the third gate of the class T3 round 1 called Critical reads the WRONG TICK — `members.read`, which every staff role holds — so a manager is shown the list of who holds the keys to the gym, and the server, which gates the READ with `staff.manage` too, answers their request with a 404',
    expect: 'is NOT a manager or a trainer',
    from: "  return Array.isArray(privileges) && privileges.includes('staff.manage');",
    to: "  return Array.isArray(privileges) && privileges.includes('members.read');",
  },
  {
    id: 'S2',
    target: 'staffview',
    suite: STAFF_VIEW_SUITE,
    why: "AUTHORITY: the OWNER's row gets controls, so an owner taps Remove on themselves and reads `last_owner` — a button whose only outcome is a refusal, over the one row that can never change",
    expect: 'gives NONE to the owner',
    from: "  return person?.role === 'manager' || person?.role === 'trainer';",
    to: '  return person?.role != null;',
  },
  {
    id: 'S3',
    target: 'staffview',
    suite: STAFF_VIEW_SUITE,
    why: 'A NUMBER A USER SEES AND IS FALSE: a staff list that could not be read prints "0 people run this gym" — which is never true of any gym, because a gym always has its owner',
    expect: 'says NOTHING when the list could not be read',
    from: '  if (!Array.isArray(staff)) return null;',
    to: "  if (!Array.isArray(staff)) return '0 people run this gym';",
  },
  {
    id: 'S4',
    target: 'staffview',
    suite: STAFF_VIEW_SUITE,
    why: 'FALSE ON SCREEN, AND IT IS THE SENTENCE THE RECORD ASKED FOR: the server card promised the web half would explain that promoting somebody makes a join code\'s count fall by one. T3 round 1 removed the `complimentary` write that made it true, so printing it now states something the product does not do',
    expect: 'does NOT claim the number beside a join code moves',
    from: `  "Staff don't use up one of your paid member seats.";`,
    to: "  'Making somebody staff makes the number beside your join code drop by one.';",
  },
  {
    id: 'S5',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: "DATA LOSS BY SILENCE: the membership is ended before the keys are taken back, which the server refuses with 409 `member_is_staff` — so the owner is told the person is out of the gym and they are still in it, with the keys",
    expect: 'keys FIRST',
    from: '      await orgService.removeStaff(gymId, person.userId);',
    to: '      await orgService.removeMember(gymId, person.userId);',
  },
  {
    id: 'S6',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: "A DESTRUCTIVE ACT NOBODY CHOSE: the owner's choice is ignored and every removal also ends the membership, so 'just take the keys' throws somebody out of the gym and takes the gym's features with them — the exact outcome Kd's two-button question exists to let an owner avoid",
    expect: 'JUST THE KEYS ends the staff row',
    from: '    if (alsoRemoveFromGym) {',
    to: '    if (true) {',
  },
  {
    // T3 C/H-2. The MIDDLE stage's Cancel was reachable by no test at all: the
    // reviewer pointed it at `onRemove(true)` — Cancel ending a membership — and
    // all 195 console tests stayed GREEN. S12 guards the stage EXISTING; this
    // guards its Cancel doing nothing, which is a different claim.
    id: 'S13',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: "A DESTRUCTIVE ACT FROM THE BUTTON THAT MEANS NO: Cancel at the choose-an-outcome stage ends the person's membership instead of backing out — the worst possible direction for a mis-wired control, and it was covered by nothing until T3 found it",
    expect: 'CANCEL at the choosing stage fires nothing',
    // TWO LINES, and it has to be: `onClick={() => setStage(null)}` on its own
    // appears TWICE in this file (this Cancel and the last stage's), so a
    // one-line anchor would hit the right one only BY POSITION — :14493's
    // recorded hazard, which the whole-table pre-check cannot detect. The
    // className differs between the two and is what makes the pair unique.
    //
    // The newline comes from `String.fromCharCode(10)` and NOT from an escape
    // in the source: writing this row twice put a REAL line break inside the
    // string literal and `node --check` refused the file both times (:9111's
    // recorded class fix, incurred again by the chat that cited it). Safe as a
    // multi-line anchor because StaffPanel.jsx is LF — measured, 0 CRLF —
    // while ConsoleLayout is the CRLF file the one-line rule above exists for.
    from: `          onClick={() => setStage(null)}${String.fromCharCode(10)}          className="text-xs rounded-lg px-3 py-1.5 self-start sm:self-end"`,
    to: `          onClick={() => onRemove(true)}${String.fromCharCode(10)}          className="text-xs rounded-lg px-3 py-1.5 self-start sm:self-end"`,
  },
  {
    // T3 C/H-1. The trainer hint promised a STUDIO's trainer the member list,
    // which `listOrgMembers` refuses with 403 `trainer_scope_unavailable`. This
    // mutant makes the hint unconditional again — the shipped defect exactly.
    id: 'S14',
    target: 'staffview',
    suite: STAFF_VIEW_SUITE,
    why: "FALSE ON SCREEN: a STUDIO owner is told their trainer can see the member list, and the server turns that trainer away — the owner appoints somebody for a job the app has just promised on its behalf",
    expect: 'does NOT promise a STUDIO trainer the member list',
    from: "      orgType === 'gym'",
    to: "      orgType !== null",
  },
  {
    // T3 C/H-1's other half, and the S11 class again: the helper can be right
    // while the SCREEN never passes it the org type.
    //
    // THIS ROW SURVIVED ITS FIRST RUN AND THE FILTER WAS WHY — :11846's lesson,
    // incurred by the chat that quoted it. Dropping the prop makes `orgType`
    // undefined, which the helper treats as NOT-a-gym, so EVERY org now reads
    // the studio sentence. The studio test therefore still PASSES; the test that
    // fails is the GYM one, and the filter was pointed at the studio. A mutant
    // has two halves — the anchor says what breaks, the filter says what should
    // notice — and only the anchor was right.
    //
    // Keep the pair together: the studio test proves the helper is consulted at
    // all, this mutant proves the SCREEN feeds it the real type.
    id: 'S15',
    target: 'settings',
    suite: SETTINGS_SUITE,
    why: 'FALSE ON SCREEN, THROUGH A DROPPED PROP: the Staff panel is never told what kind of org this is, so `staffRoleChoices` falls to its refusing default and every GYM owner is told their trainer cannot see the member list — a correct helper bypassed entirely by the screen that renders it',
    expect: 'tells a GYM owner their trainer CAN see it',
    // RE-ANCHORED 2026-08-26 (gym-details card). `Settings.jsx` now resolves
    // `viewerPrivileges(org)` ONCE into a local, because two sections read it,
    // so the old inline call is gone from this line. The whole-table pre-check
    // ABORTED the sweep before a byte was written — seventh time on this branch
    // that guard has paid for itself — and the mutant was re-measured RED rather
    // than assumed to still work.
    // RE-ANCHORED AGAIN 2026-08-26 by round 3's `key` fix, which is on this same
    // line. Third time this mutant's anchor has moved on this branch; the
    // whole-table pre-check ABORTED before a byte was written each time, and it
    // is re-measured RED rather than assumed. **C82 is its neighbour on the same
    // line and they guard different things** — this one that the ORG TYPE
    // reaches the panel, C82 that the panel is thrown away when the gym changes.
    // (That sentence named C81 until 2026-08-27; C81 is the same guarantee on
    // the GYM-DETAILS panel one line above, not on this one.)
    //
    // RE-ANCHORED A FOURTH TIME 2026-08-27, AND THIS ONE WAS NOT CAUGHT AT THE
    // TIME. Round 4's fix (`af27965`) prefixed both panel keys — `staff-${…}`
    // and `gym-${…}` — which moved this anchor, C81's and C82's all at once, and
    // none of the three was re-aimed. Measured on the trial card, with
    // `Settings.jsx` byte-identical to HEAD: all THREE matched ZERO times, so
    // the whole-table pre-check has been aborting every sweep since, and the
    // guarantees these carry — including round 3's own Critical/High — have had
    // no mutant behind them for two commits. Round 5 shipped on a SUBSET run,
    // which is why nothing noticed. Re-aimed at the SAME call sites, never at
    // whichever line looked closest (:15770), and each re-measured RED.
    //
    // RE-ANCHORED A FIFTH TIME 2026-08-29 by the read-only card, which gave both
    // panels a `readOnly` prop and so broke each mount onto its own lines. The
    // anchors are now ONE PROP each rather than a whole element, which is the
    // shape that stops this recurring: a prop line moves only when that prop
    // moves. **Caught by the whole-table pre-check before a byte was written**,
    // and re-measured RED rather than assumed — the fourth re-anchor above is
    // the one that was NOT caught, and it cost two commits of no coverage.
    from: '          orgType={org.orgType}',
    to: '          orgType={undefined}',
  },
  {
    // KD FOUND THIS ONE IN A BROWSER, WHICH IS WHY IT IS HERE. The control used
    // to have two stages, so picking an outcome DID it — he read the two options
    // as a menu and reported the missing confirmation. Nothing in the suite
    // could see it: every removal test simply clicked through, and a mutation
    // harness can only delete a guard that EXISTS. This mutant restores that
    // shape, so the third stage cannot be quietly removed again.
    id: 'S12',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: 'A DESTRUCTIVE ACT WITH NO LAST CHANCE: picking "remove from the gym too" fires immediately instead of asking, so one mis-tap on a menu of two options ends somebody\'s membership with no way to back out — the defect Kd found in his own smoke',
    expect: 'does NOTHING until the last tap',
    from: '          onClick={() => setStage(true)}',
    to: '          onClick={() => onRemove(true)}',
  },
  {
    id: 'S7',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: 'A HALF-DONE CHANGE REPORTED AS NOTHING: the keys came back and the membership did not, and the notice goes to the add-form field instead of the screen — so it is rendered nowhere and the owner believes somebody is out of their gym who is still in it',
    expect: 'SAYS SO when the keys came back but the membership did not',
    // RE-ANCHORED 2026-08-23 by the uniqueness guard added above, on its FIRST
    // run — and this row is why that guard is worth having. `        setActionError(`
    // matched TWICE: here, and inside the add form's Cancel, whose sixteen-space
    // `setActionError(null)` CONTAINS the eight-space anchor. It was ambiguous at
    // HEAD too (measured both ways: 2 before this card and 2 after), so it is
    // pre-existing debt rather than something a card broke — the api harness's
    // O88 in a different file. It happened to land on the right line BY POSITION,
    // which is exactly the property :14493 said a pre-check cannot verify.
    // Now anchored on the notice's own first line, which appears once.
    // Re-measured RED after re-aiming (:8610 — a re-aimed mutant is unproven).
    from: '        setActionError({\n          message:\n            `${person.displayName} no longer runs your gym',
    to: '        setFieldError({\n          message:\n            `${person.displayName} no longer runs your gym',
  },
  {
    id: 'S8',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: 'A FAILED READ DRAWN AS A LIST: the rows and "Add someone" render over an unreadable staff list, so an owner is invited to hand out keys without being able to see who already holds them',
    expect: 'NEVER draws a failed read as a gym with no staff',
    // TWO LINES, AND THE SECOND ONE IS WHY. The count label eight lines above is
    // guarded by the identical condition at a deeper indent, so the one-line
    // anchor is a substring of THAT line too and `String.replace` — which takes
    // the first match — would have mutated the header while this row's name said
    // it was testing the list. That is :14493's O85/O86 exactly, caught here by
    // looking rather than by a sweep, because the pre-check can ask "does this
    // match?" and cannot ask "does this match ONCE?".
    from: '      {!state.loading && state.error === null ? (\n        <div className="flex flex-col gap-3">',
    to: '      {!state.loading ? (\n        <div className="flex flex-col gap-3">',
  },
  {
    id: 'S9',
    target: 'layout',
    suite: SETTINGS_SUITE,
    why: 'A TAB THAT ANSWERS NOTHING: Settings is drawn for every role, so a manager and a trainer get a nav item whose only screen tells them they may not be there',
    expect: 'is NOT drawn for a manager',
    // RE-ANCHORED 2026-08-26 (gym-details card): the tab's condition became
    // `settingsIsReachable`, because Settings grew a second section gated on a
    // second privilege. The whole-table pre-check ABORTED before a byte was
    // written; re-measured RED rather than assumed. **It stays aimed at "drawn
    // for EVERYBODY" and C63 is its sibling aimed at "drawn for too FEW"** — a
    // gate has two failure directions and a mutant that only opens it is
    // satisfied by a door that is simply shut (:7104's PG1).
    from: '        ...(settingsIsReachable(viewerPrivileges(org))',
    to: '        ...(true',
  },
  {
    id: 'S10',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: "AUTHORITY BY DEFAULT: the add form opens on the LARGER grant, so an owner who does not read the two options hands somebody the power to remove members and replace join codes when they meant to add a trainer",
    expect: 'starts on the SMALLER grant',
    from: "  const [role, setRole] = useState('trainer');",
    to: "  const [role, setRole] = useState('manager');",
  },
  {
    // SURVIVED ITS FIRST RUN, and the survival was the finding rather than a
    // hole in the code: `Settings.jsx` checks `canManageStaff` BEFORE it mounts
    // this panel, so for a manager the component never exists and its own guard
    // could not be observed from the screen. The filter below now also matches a
    // test that mounts the panel DIRECTLY ("…when the viewer is not the owner"),
    // which is the case that isolates the guard. Re-measured RED after that
    // test landed — the ANCHOR never moved, only what could notice it (:11846:
    // a mutant has two halves).
    id: 'S11',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: 'AUTHORITY: the panel asks for the staff list whatever the role, so a manager\'s Settings screen fires an owner-only read the server answers 404 — the request a non-owner should never make',
    expect: 'asks the server NOTHING about staff',
    from: '    if (!allowed || gymId === null) return undefined;',
    to: '    if (gymId === null) return undefined;',
  },
  // WHICH PLACES ON THE ROSTER COST THE GYM MONEY (:14953). Three rows, because
  // the guarantee passes through three hands — the screen choosing what to ask,
  // the helper reading the server's answer, and the helper's fallback for an API
  // too old to give one. A mutant is a claim about ONE call site (:15007's S16),
  // so merging these into one would leave two of the three unobserved.
  {
    id: 'C36',
    target: 'members',
    suite: RENDER_SUITE,
    why: "KD'S FINDING ITSELF: the roster goes back to reading the old flag, so a trainer is drawn as somebody occupying a paid place — the gym has not been charged for them since :14401 and the screen says otherwise",
    expect: 'badges a staff member',
    from: '      {seatIsFree(member) ? (',
    to: '      {member.complimentary ? (',
  },
  {
    id: 'C37',
    target: 'view',
    suite: VIEW_SUITE,
    why: "ON SCREEN AND FALSE: the helper ignores the server's answer and falls through to the old flag every time, which is the pre-card behaviour wearing the new code's clothes — the badge would be right for the owner and wrong for everybody holding the keys",
    expect: 'believes the server OVER the old flag',
    from: "  if (typeof member.takesSeat === 'boolean') return member.takesSeat === false;",
    to: "  if (typeof member.takesSeat === 'boolean' && false) return member.takesSeat === false;",
  },
  {
    id: 'C38',
    target: 'view',
    suite: VIEW_SUITE,
    why: "THE EXPAND-THEN-CONTRACT WINDOW (:12660): the fallback is deleted, so against an API older than this build EVERY badge vanishes — including the owner's — and each of those rows gains a Remove button the server refuses. The field is optional precisely so this window is survivable",
    expect: 'falls back to the old flag when the server sent no answer',
    from: '  return member.complimentary === true;',
    to: '  return false;',
  },

  // ── S17–S22: THE PER-STAFF TICK BOXES ───────────────────────────────────
  //
  // Scoped by :5857 rule 4a. A web card, so no database mutants — and what
  // earns a row here is exactly 4a's own columns:
  //   · AUTHORITY — a box offered that hands somebody the keys to the gym
  //     (S17), and the owner's own row becoming editable (S22)
  //   · DATA LOSS — a save that strips a permission nobody saw (S18), and a
  //     role change that resets the ticks with no question asked (S21)
  //   · ON SCREEN AND FALSE — a colleague drawn as able to do nothing (S19),
  //     or as able to do what their ROLE gives rather than what they hold (S20)
  //
  // Deliberately NOT mutated: the wording of the six labels and hints, the
  // order they are drawn in, the disabled state of the Save button.
  {
    id: 'S17',
    target: 'staffview',
    suite: STAFF_VIEW_SUITE,
    why: "AUTHORITY, and it is DECISIONS :15534's C/H-1 arriving on a screen: the owner-only filter goes, so an owner is offered a Manage staff box for a MANAGER. The server refuses it (409 owner_only_privilege) — and the escalation that refusal exists to stop ended with the owner 403'd on their own member list, unable to undo it",
    expect: 'NEVER offers "Manage staff" for a manager',
    from: "  if (role === 'owner') return PRIVILEGE_COPY.map((choice) => ({ ...choice }));",
    to: "  if (role !== null) return PRIVILEGE_COPY.map((choice) => ({ ...choice }));",
  },
  {
    id: 'S18',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: 'DATA LOSS, and the kind nobody sees: the save stops carrying the ticks this build has no words for, so an owner ticking ONE box silently strips a permission that was never on their screen. The whole set is what gets written, so what is left out is what is taken away — and OWED.md already schedules a billing tick, which is exactly such a box',
    expect: 'is carried through the save unchanged',
    from: '              const saved = await onSave([...ticked, ...unknownPrivileges(person)]);',
    to: '              const saved = await onSave([...ticked]);',
  },
  {
    id: 'S19',
    target: 'staffview',
    suite: STAFF_VIEW_SUITE,
    why: 'ON SCREEN AND FALSE (:5807): the fallback for a row the server sent no permissions for is deleted, so against an API older than this build every colleague is drawn with NOTHING ticked — a claim that they can do nothing, which is false, and an owner "correcting" it would save that falsehood into the database. The field is optional precisely so this window is survivable (:12660)',
    expect: 'falls back to what the ROLE grants when the server sent no set',
    from: '    : (ROLE_PRIVILEGES[person?.role] ?? []);',
    to: '    : [];',
  },
  {
    id: 'S20',
    target: 'staffview',
    suite: STAFF_VIEW_SUITE,
    why: "ON SCREEN AND FALSE: the row ignores the set the server actually holds and always draws the ROLE's template, so every hand-tuned person is shown boxes that are not theirs — and the first Save writes the template over what the owner had set. It is the pre-ticks screen wearing the new code's clothes",
    expect: 'uses the set the SERVER sent for this person, not their role',
    from: '  const held = Array.isArray(person?.privileges)\n    ? person.privileges',
    to: '  const held = Array.isArray(person?.privileges)\n    ? (ROLE_PRIVILEGES[person?.role] ?? [])',
  },
  {
    id: 'S21',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: "DATA LOSS WITH NO WARNING (T3 :15534 Low-6): the question disappears and the first tap changes the role — which RESETS that person's ticks to the new role's defaults. An owner who had hand-tuned somebody loses that work, or for somebody they had narrowed hands MORE back, with nothing on screen having said so",
    expect: 'ASKS before changing a role, and does nothing on the first tap',
    from: '        onClick={() => setAsking(true)}',
    to: '        onClick={onConfirm}',
  },
  {
    id: 'S22',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: "AUTHORITY: the owner's own row becomes editable, so a gym's owner can tick away their own access on the one row nothing else on this screen can repair — and the two the server locks (last_owner_locked) would fail on save while the rest would succeed, leaving an owner who cannot read their own roster",
    expect: 'are shown, and cannot be changed from this screen',
    // RE-ANCHORED 2026-08-29: the read-only card gave `PrivilegesControl` a
    // second lock (the GYM has no plan) and RENAMED this local from `readOnly`
    // to `ownerRow`, because two things called read-only in one component — one
    // about a PERSON, one about the GYM — is a trap. **The guarantee is
    // unchanged and so is the call site** (:15770); only the name moved.
    // C117 is the new row that watches the two locks not being confused.
    from: "  const ownerRow = person.role === 'owner';",
    to: '  const ownerRow = false;',
  },

  // ── C43–C50: THE CONSOLE'S ONE KEPT ANSWER, RE-CHECKED ON FOCUS ──────────
  //
  // Scoped by :5857 rule 4a. A web card, so no database mutants — and the rows
  // are 4a's own columns:
  //   · ON SCREEN AND FALSE (:5807) — a power taken away going on being drawn
  //     because the window's return is not noticed, on either of the two events
  //     that mean "you are back" (C43, C44)
  //   · DATA IN FRONT OF THE USER — a re-check WE started, failing, wiping the
  //     screen the person is reading (C45)
  //   · OWNERSHIP — the next account on a gym's shared front-desk browser
  //     reading the last one's gyms (C46)
  //   · BLOCKED FROM FINISHING — a spinner over a working screen every time the
  //     window comes back (C47), and a screen that can never leave one because
  //     a failure re-arms its own read for ever (C49, C50)
  //   · The speed half, which is the other thing Kd asked for (C48)
  //
  // Deliberately NOT mutated: the wording of the failure sentence, and the
  // decision to keep asking on a mount after a FAILED answer — that one is a
  // judgement about when to retry, not a guarantee.
  {
    id: 'C43',
    target: 'orgstore',
    suite: RENDER_SUITE,
    why: 'ON SCREEN AND FALSE (:5807): the window coming back to the front is no longer noticed, so a power an owner took away goes on being drawn until the person presses F5 — the defect this card exists to close, and the one Kd felt',
    expect: 'a power taken away reaches a screen that is already open',
    from: "  window.addEventListener('focus', consoleOrgsRegainedFocus);",
    to: "  window.addEventListener('blur', consoleOrgsRegainedFocus);",
  },
  {
    id: 'C44',
    target: 'orgstore',
    suite: RENDER_SUITE,
    why: 'THE SAME DEFECT THROUGH THE OTHER DOOR, and it is a separate row because it is a separate event: switching tabs never fires `focus` on the window, so with only C43 covered a person who works in tabs would keep the stale screen',
    expect: 'counts the TAB coming back to the front',
    from: "  document.addEventListener('visibilitychange', handleVisibilityChange);",
    to: "  document.addEventListener('blur', handleVisibilityChange);",
  },
  {
    id: 'C45',
    target: 'orgstore',
    suite: RENDER_SUITE,
    why: "DATA IN FRONT OF THE USER: a background re-check that fails takes the screen away — a roster and its controls replaced by an error card because a request nobody asked for dropped its connection. Self-inflicted, and this project's most repeated defect (a failed read drawn as an empty one) arriving from the inside",
    expect: 'leaves a working screen ALONE when the re-check fails',
    from: "      if (background && state.status === 'ready' && state.forUserId === forUserId) return;",
    to: "      if (background && state.status === 'ready' && state.forUserId === forUserId && false) return;",
  },
  {
    id: 'C46',
    target: 'orgstore',
    suite: STORE_SUITE,
    why: "OWNERSHIP, on a gym's SHARED FRONT-DESK BROWSER: the kept answer stops being stamped with the person it was fetched for, so the next account signed in on that machine reads the last one's gyms and the powers that went with them. The same shape as the module-level flag that outlived a sign-out at :618 T3 F1",
    expect: 'never hands the next account',
    from: '  return state.forUserId === getUserId() ? state : IDLE;',
    to: '  return state;',
  },
  {
    id: 'C47',
    target: 'orgstore',
    suite: STORE_SUITE,
    why: 'BLOCKED FROM FINISHING: every re-check publishes a spinner, so the console blanks and redraws each time a person clicks back into the window — which is exactly what makes an app feel broken, and would make this whole card a downgrade',
    expect: 'replaces the answer WHOLE and never shows a spinner',
    from: "  if (!background) publish({ status: 'loading', orgs: null, error: null, forUserId });",
    to: "  publish({ status: 'loading', orgs: null, error: null, forUserId });",
  },
  {
    id: 'C48',
    target: 'orgstore',
    suite: RENDER_SUITE,
    why: 'THE SPEED HALF, which is half of what this card is for: a kept answer stops being used, so every screen asks again — the shell and the screen inside it on every page, over a database in Singapore at ~92 ms a question',
    // RE-AIMED, and it SURVIVED first — the anchor was always right and the
    // FILTER was wrong (:11846's two halves, the half this repo keeps recording
    // last). It named "asked ONCE for the shell and the screen inside it", which
    // CANNOT notice this mutation: both of those mount together, so the second
    // ensure lands while the first read is still in flight and the `loading` arm
    // this mutation leaves standing dedupes it anyway. The arm being deleted is
    // the `ready` one, and what depends on it is the NEXT screen — so the test
    // that can see it is the one about opening a second screen.
    expect: 'is not asked again when the next screen opens',
    from: "  if (snapshot.status === 'ready' || snapshot.status === 'loading') return;",
    to: "  if (snapshot.status === 'loading') return;",
  },
  {
    id: 'C49',
    target: 'orghook',
    suite: RENDER_SUITE,
    why: "THE LOOP THIS CARD SHIPPED AND FIXED, restored: the screen's read is re-armed by its own answer, so a failed read asks again, fails again, and the person watches a spinner for ever while the app hammers the server. Every test in the store's own suite stayed green under it — the screen is where it can be seen",
    expect: 'a reply this screen cannot read is a FAILURE',
    from: '  }, [wanted]);',
    to: '  }, [wanted, snapshot.status]);',
  },
  {
    id: 'C50',
    target: 'orghook',
    suite: RENDER_SUITE,
    why: 'THE SAME LOOP AT THE OTHER CALL SITE — "your gyms" reads the same store through its own hook, and a mutant is a claim about ONE of them (:15007 S16). Written out separately because one fix reaching two hooks is exactly what nobody checks',
    expect: 'NEVER says that when the read failed',
    from: '  }, []);',
    to: '  }, [snapshot.status]);',
  },
  // ── The T3 round that found what the eight above could not ────────────────
  //
  // C43–C50 mutate the store's rules and the hooks' timing, and all eight are
  // honest. What none of them could see is the console changing its OWN list
  // from the inside: the card reasoned that the only way IN is the login page,
  // which is true of ENTERING the console and says nothing about what happens
  // once you are in it. Creating a gym is the one flow that does, and an owner
  // who made one was told it was not theirs.
  {
    id: 'C51',
    target: 'newgym',
    suite: RENDER_SUITE,
    why: 'ON SCREEN AND FALSE (:5807), and it is the card\'s worst: the console is never told a gym was created, so "Go to your gym" lands on "we couldn\'t find a gym you run at this address" and "Your gyms" tells somebody who has just made their first gym that they don\'t run one. Nothing but F5 or a window-focus event clears it, and clicking a link inside the window is neither',
    expect: 'a gym you have just made',
    from: '      refreshConsoleOrgs();',
    to: '      void refreshConsoleOrgs;',
  },
  {
    id: 'C52',
    target: 'orgstore',
    suite: STORE_SUITE,
    why: "BLOCKED FROM FINISHING, on a gym's SHARED FRONT-DESK BROWSER: a read already on its way is shared with WHOEVER asks next, not only the person it was started for. `u1`'s hanging read is handed to `u2`, comes back stamped `u1`, and rule 3 correctly empties it — so `u2`'s console has nothing and no way to ask again, the mount effect having already run and the focus re-check returning early on an empty store. Only reloading the page recovers it",
    expect: 'asks for the next person',
    from: '  if (inFlight && inFlightUserId === forUserId) return inFlight;',
    to: '  if (inFlight) return inFlight;',
  },
  {
    id: 'C53',
    target: 'orgstore',
    suite: STORE_SUITE,
    // ONE LINE, after round 2 taught this the hard way TWICE. It was a four-line
    // anchor; L-1 deleted one of those lines, so it was re-cut to three — and
    // that ABORTED TOO, because `git checkout --` had meanwhile rewritten the
    // file from LF to CRLF and a `\n` anchor matches nothing in a CRLF file.
    // **THE CRLF NOTE ON `layout` IS NOT ABOUT THAT FILE. It is about any file
    // git has touched on this machine** — which is every file, eventually. The
    // fix is not a cleverer anchor: `consoleOrgs.js` now names the step
    // (`forgetTheReadInTheAir`) so ONE line can carry the guarantee.
    // Both aborts are the pre-check doing its job — a no-op mutation would
    // otherwise have reported ALIVE, i.e. "this guarantee has no test".
    why: "ON SCREEN AND FALSE (:5807), C51's other half and the reason `NewGym` calling refresh is not the whole fix: a read asked for ON PURPOSE waits on one that was already in the air. A background re-check begun a moment BEFORE a gym was created cannot know about that gym, so the owner is told their brand-new gym does not exist — the same defect as C51, moved from certain to occasional, which is the version nobody would reproduce",
    // RE-ANCHORED 2026-08-26, ON THE SAME CALL SITE — not re-aimed at another
    // one. `refreshConsoleOrgsAfterChange` calls `forgetTheReadInTheAir` too, so
    // this anchor started matching TWICE and the uniqueness guard aborted the
    // sweep. **The pre-check counts SUBSTRINGS, so a trailing note on the other
    // line alone did not disambiguate** — the shorter line is contained in the
    // longer one. Both call sites now carry their own note, which is a fact
    // about the SOURCE (:17676: when no single line expresses a guarantee, that
    // is what has to change). C66 is this mutant's sibling on the save path.
    expect: 'never answers a person who asked ON PURPOSE',
    from: '  forgetTheReadInTheAir(); // one request PER PRESS, and it must be a fresh one',
    to: '  void forgetTheReadInTheAir; // one request PER PRESS, and it must be a fresh one',
  },
  {
    id: 'C54',
    target: 'orgstore',
    suite: STORE_SUITE,
    // T3 ROUND 2, L-2. Until this row the in-flight SHARE — the guard this whole
    // design turns on — had no instrument but C49, **whose signal is a HANG, not
    // a RED**: a sweep that aborts reads as "the harness is broken" rather than
    // "the app is", which is exactly how it was nearly missed. :5348 rule 5 wants
    // a permanent guard for a class that has already recurred, and :16388's loop
    // is that class.
    why: 'THE APP ASKS THE SERVER THE SAME QUESTION ONCE PER PASS INSTEAD OF ONCE PER FLIGHT. Sharing is permanently disabled, so every caller that asks while a read is already on its way opens another — and this card has already shipped a caller that asks in a LOOP (:16388), where the difference is one request per in-flight window against one per pass, at the server, for ever',
    expect: 'lets the window coming back JOIN a read',
    from: '  inFlightUserId = forUserId;',
    to: '  inFlightUserId = null;',
  },

  // ── A GYM CAN FIX ITS OWN DETAILS (2026-08-26, the web half) ─────────────
  //
  // The route shipped that morning with no caller. What this form can do wrong
  // is 4a's own columns twice over: move a gym's day boundary by accident
  // (SAVES — `gyms.timezone` is what the rollup worker asks and it is written
  // once), and put a PAYING gym's currency on the table every time somebody
  // corrects a typo (MONEY). Wording, layout and the two hint sentences are
  // deliberately NOT mutated.
  {
    id: 'C55',
    target: 'gymview',
    suite: GYMVIEW_SUITE,
    why: "MONEY, and it is round 1's C/H-1 arriving from the client side: the form stops sending a DIFF and puts the country on the wire whenever it has one. A gym on a subscription is refused with 409 `currency_locked` the moment the country it sends resolves to a different currency, so every rename by a paying gym becomes a refusal — and the server's own first version refused a whole save merely for MENTIONING the country (:19656)",
    expect: 'renames a gym WITHOUT mentioning its country',
    from: "  if (country !== '' && country !== storedCountry) patch.country = country;",
    to: "  if (country !== '') patch.country = country;",
  },
  {
    id: 'C56',
    target: 'gymview',
    suite: GYMVIEW_SUITE,
    why: "SAVES, and it is the worst thing this screen could do: the picker stops carrying the gym's OWN zone, so a runtime that calls that zone by its other alias offers a list without it and the box selects somebody else's. An owner who opened Settings to fix a typo in the name MOVES THE GYM'S DAY BOUNDARY by saving — `gyms.timezone` is the only thing the rollup worker consults, and :10402 measured the alias gap on this very machine",
    // RE-ANCHORED 2026-08-26 by T3 round 2's C/H-1 fix, which made this function
    // take as many zones as the caller needs present rather than exactly one.
    // The whole-table pre-check ABORTED before a byte was written; re-measured
    // RED rather than assumed. **C79 is its sibling at the CALL SITE** — this
    // one says the helper injects, that one says the panel asks for the right
    // zones, and round 2's Critical/High was entirely in the second (:15770).
    expect: 'OWN zone even when the runtime does not list it',
    from: "    if (held !== '' && !zones.includes(held) && !missing.includes(held)) missing.push(held);",
    to: "    if (held !== '' && zones.includes(held) && !missing.includes(held)) missing.push(held);",
  },
  {
    id: 'C57',
    target: 'gymview',
    suite: GYMVIEW_SUITE,
    why: "ON SCREEN AND FALSE (:5807) through a 500: the country stops being upper-cased, so a lower-case code fails the column's own CHECK as a 23514 — the server answers an error where an owner should see their country saved. It also makes `us` read as a change from `US`, which sends a country nobody altered straight into the currency lock",
    expect: 'upper-cases the country',
    from: "  const country = (draft?.country ?? '').trim().toUpperCase();",
    to: "  const country = (draft?.country ?? '').trim();",
  },
  {
    id: 'C58',
    target: 'gymview',
    suite: GYMVIEW_SUITE,
    why: "DATA: clearing the city sends an empty STRING instead of `null`, so the gym's city becomes `''` rather than nothing. The column is nullable and every reader treats null as absent; an empty string is a value that reads as absent everywhere except where somebody counts it",
    expect: 'clears a city with null',
    from: "  const nextCity = typedCity === '' ? null : typedCity;",
    to: '  const nextCity = typedCity;',
  },
  {
    id: 'C59',
    target: 'gymview',
    suite: GYMVIEW_SUITE,
    why: 'ON SCREEN AND FALSE (:5807): the comparison stops trimming while the server still trims on the way in, so a trailing space typed into the name box lights Save up for a save that stores nothing — a button promising a change the database will not make, and a "Saved." over bytes that never moved',
    expect: 'treats a trailing space as no change',
    from: "  const name = (draft?.name ?? '').trim();",
    to: "  const name = (draft?.name ?? '');",
  },
  {
    id: 'C60',
    target: 'gymview',
    suite: GYMVIEW_SUITE,
    why: "OWNERSHIP: the form's gate asks for `staff.manage` instead of the privilege Kd ruled for this. It was offered as the cheap option at the plan gate and recommended AGAINST on :13803's precedent — two rows that mean different things get different privileges, or one tick silently widens the other's power. Under this, everybody who can manage staff can also change the gym's billing country",
    expect: 'is NOT satisfied by the power to manage staff',
    from: "  return Array.isArray(privileges) && privileges.includes('org.manage');",
    to: "  return Array.isArray(privileges) && privileges.includes('staff.manage');",
  },
  {
    id: 'C61',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    why: "ON SCREEN AND FALSE (:5807), C51's shape one card later: the console is never told the gym changed, so the shell's rail, \"Your gyms\" and the Overview header all keep the OLD name until the next window focus — the app showing an owner a name it has itself just been told is wrong",
    expect: 'makes the rest of the console re-read the gym after a save',
    from: '      refreshConsoleOrgsAfterChange();',
    to: '      void refreshConsoleOrgsAfterChange;',
  },
  {
    id: 'C62',
    target: 'orgstore',
    suite: STORE_SUITE,
    why: 'BLOCKED FROM FINISHING: the re-read after a save publishes `loading`, so saving a gym\'s name blanks the very screen the owner is looking at — Settings goes to "Loading your gym…" and takes the Staff section, its open tick boxes and any half-finished removal down with it, over a read nobody is waiting for',
    expect: 'NEVER publishes a spinner',
    from: '  void load({ background: true }); // nobody is waiting on this read',
    to: '  void load({ background: false }); // nobody is waiting on this read',
  },
  {
    id: 'C63',
    target: 'layout',
    suite: SETTINGS_SUITE,
    why: "ON SCREEN AND FALSE (:5807) plus BLOCKED FROM FINISHING: the Settings tab narrows back to staff-management alone, so a manager an owner has ticked `org.manage` across to holds a real power with NO TAB anywhere — and typing the address lands them on \"Only the gym's owner can change these settings\", which is untrue about them. :16095's Critical/High, where the console asked the job title while the server asked the tick",
    expect: 'gives that manager the Settings TAB',
    from: '  return canManageStaff(privileges) || canManageOrg(privileges);',
    to: '  return canManageStaff(privileges);',
  },
  {
    id: 'C64',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    why: 'ON SCREEN AND FALSE (:5807): every gym is told we do not have its country on record, including the ones whose country we hold and are billing on. The sentence exists for the pre-`0014` rows where it is TRUE; said to everybody it is a claim about the database that is wrong for every gym created since',
    expect: 'is NOT said about a gym whose country we do hold',
    from: "  const countryOnRecord = typeof org?.country === 'string' && org.country.trim() !== '';",
    to: '  const countryOnRecord = false;',
  },
  {
    id: 'C65',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    why: "BLOCKED FROM FINISHING, and this is the defect the card's own tests found before a reviewer could: the sentence explaining an empty name is never computed, so an owner who clears the name box sees a dead Save button and NO reason for it. There is nothing to SEND about a cleared name, so the patch is empty and the button is correctly disabled — which is exactly why the explanation cannot live on the click",
    expect: 'says an empty name is wrong straight away',
    from: '  const problem = gymDetailsProblem(draft);',
    to: '  const problem = null;',
  },
  {
    // C53'S SIBLING, AND WRITING IT WAS THE POINT (:19366's O20/O122, :15770).
    // `refreshConsoleOrgsAfterChange` calls `forgetTheReadInTheAir` too, so
    // C53's one-line anchor started matching TWICE and the uniqueness guard
    // (:15259 L-2) ABORTED the sweep before a byte was written. **Re-aiming C53
    // at the new copy would have been the wrong fix**: a mutant is a claim about
    // ONE call site, and a control that looks covered because a mutant was
    // written for its sibling is :14174 L-1 verbatim. C53 keeps the Try-again /
    // create-a-gym path; this one is the save path, and the two lines now differ
    // by a trailing note so each can be named.
    id: 'C66',
    target: 'orgstore',
    suite: STORE_SUITE,
    why: "ON SCREEN AND FALSE (:5807): the re-read after a save WAITS ON a read that was already in the air — one begun a moment before the save, which cannot know about it. So a second after storing the new name the console publishes the OLD one, and the owner watches their save undo itself. C53's defect at the save door instead of the create door",
    expect: 'does NOT let a read started before the save answer it',
    from: '  forgetTheReadInTheAir(); // a read begun before the save cannot answer it',
    to: '  void forgetTheReadInTheAir;  // a read begun before the save cannot answer it',
  },

  // ── SETTINGS' SECTIONS OPEN WHEN YOU TAP THEM (2026-08-26, Kd's call) ────
  //
  // Five rows for one small control, and the reason is that a collapsing screen
  // has exactly three ways to lie: it can refuse to collapse (the change buys
  // nothing), it can hide something the owner needed to see, or it can hide a
  // failure nobody asked for. Two of the five are the SAME guarantee at the
  // component and at the call site, because a mutant is a claim about ONE call
  // site (:15770).
  {
    id: 'C67',
    target: 'states',
    suite: SETTINGS_SUITE,
    why: "THE CHANGE BUYS NOTHING: every section is permanently open, so Settings is the long list Kd asked to be rid of and the tap does nothing. Silent — the screen looks like it did before the card, which is exactly the kind of no-op a green suite would otherwise wave through",
    expect: 'both start CLOSED',
    from: '  const isOpen = open || forceOpen;',
    to: '  const isOpen = true;',
  },
  {
    id: 'C68',
    target: 'states',
    suite: SETTINGS_SUITE,
    why: "SILENCE OVER A FAILURE (:12660): `forceOpen` is ignored, so a section whose data failed to load stays SHUT over its own error card. The staff list is read on mount whether the section is open or not, so the read fails while nobody is looking and the screen says NOTHING AT ALL — worse than the error, and the one thing no reviewer, test or mutant flags unless something is aimed at it",
    expect: 'OPENS ITSELF when the staff list fails',
    from: '  const isOpen = open || forceOpen;',
    to: '  const isOpen = open;',
  },
  {
    id: 'C69',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: 'C68 AT THE CALL SITE, and it fails the same way from the other end: the panel stops ASKING to be opened on a failure, so the component-level guard has nothing to act on. Kept separate from C68 because a mutant is a claim about one call site (:15770) — the component can be right while the caller never uses it',
    expect: 'OPENS ITSELF when the staff list fails',
    from: '      forceOpen={!state.loading && state.error !== null}',
    to: '      forceOpen={false}',
  },
  {
    id: 'C70',
    target: 'staffpanel',
    suite: SETTINGS_SUITE,
    why: "THE CHANGE MAKES THE SCREEN WORSE THAN THE WALL IT REPLACED: the staff count comes off the closed heading, so an owner has to OPEN a section to learn something the heading used to tell them at a glance. Collapsing is only an improvement while the closed row still says something",
    expect: 'keeps the staff count readable while the section is shut',
    from: '      aside={countLabel}',
    to: '      aside={null}',
  },
  {
    // C71 WAS WRITTEN HERE FIRST AND CAME BACK ALIVE, and the survival was the
    // finding rather than a missing test. It deleted the panel's own
    // `!state.loading && state.error === null ?` guard on the count — and
    // changed NOTHING observable, because on both of those paths `state.staff`
    // is `[]` and `staffCountLabel([])` is already null. **Two guards, either
    // one sufficient, therefore neither falsifiable** — :12343's J11 shape, and
    // fixed the way that entry fixed it: in the SOURCE, so one line does the
    // work. The panel now passes the label straight through and THIS is where
    // the guarantee lives, so this is where its mutant belongs (:15770).
    id: 'C71',
    target: 'staffview',
    suite: STAFF_VIEW_SUITE,
    why: 'ON SCREEN AND FALSE (:5807): the empty-list guard goes, so a staff list that could not be read prints "0 people run this gym" on the Settings heading — never a true sentence about a gym, which always has its owner. It is one empty array away at any time, and since the sections collapse it is the ONLY thing the closed row says',
    // AND THE FILTER WAS WRONG ON THE FIRST TRY, which is the half this repo
    // keeps recording last (:11846 — the anchor says what breaks, the FILTER
    // says what should notice). It named "says NOTHING when the list could not
    // be read", which drives `null`/`undefined`/a string and never an EMPTY
    // ARRAY — the only input this mutation changes — so it came back ALIVE a
    // second time against a test that could not see it. The empty case has its
    // own test, added by :15007's round 2 for this exact reason, and that is the
    // one named here.
    expect: 'says NOTHING for an EMPTY list either',
    from: '  if (n === 0) return null;',
    to: '  if (n === -1) return null;',
  },

  // ── T3 ROUND 1'S FIVE FIXES, each restored so its test is MEASURED red
  //    rather than asserted to be (:5348 rule 3) ─────────────────────────────
  {
    id: 'C72',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    why: "C/H-1 RESTORED: the form stops following the gym row, so a rename made in another tab (or by the other owner at a shared front desk) leaves these boxes holding the OLD name and time zone under a heading two lines up showing the NEW one — and Save, which compares against the LIVE row, switches itself on with no keystroke and offers to put the stale values back. `gyms.timezone` is the only thing the rollup worker consults, so that revert MOVES THE GYM'S DAY",
    expect: 'FOLLOWS the gym while the form is untouched',
    from: '  if (!sameGymDetails(fresh, lastOrgSeen)) {',
    to: '  if (false) {',
  },
  {
    id: 'C73',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    why: "THE OTHER DIRECTION, AND IT IS DATA LOSS: the untouched test is deleted, so the form follows the row ALWAYS — and the kept answer is re-read on every window focus, so an owner who alt-tabs mid-edit comes back to their typing REPLACED by the stored values. A gate has two failure directions and C72 alone is satisfied by a form that clobbers everything (:7104's PG1)",
    expect: 'LEAVES A TOUCHED FORM ALONE',
    from: '    const untouched = sameGymDetails(draft, lastOrgSeen);',
    to: '    const untouched = true;',
  },
  {
    id: 'C74',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    // RE-ANCHORED AND RE-FILTERED BY ROUND 2, AND THE RE-FILTER IS THE POINT.
    // Round 2's fix also asks the picker for the zone the GYM holds — which
    // covers every UNTOUCHED form, because there the two are equal. So this
    // mutant's old test could no longer see it, and re-anchoring alone would
    // have left it ALIVE for a true reason (:11846: the anchor says what breaks,
    // the FILTER says what should notice). The displayed zone earns its place in
    // exactly one case and the new test drives it: a TOUCHED form, which does not
    // follow, over a gym whose zone has moved on underneath it.
    why: "SAVES: the picker stops being asked for the value the box is DISPLAYING, so a form somebody has typed in — which deliberately does not follow the gym — is left showing a zone that is no longer in the list, and the select falls to blank-or-first. Silently moving a gym's day boundary is the one permanent thing this screen must be incapable of",
    expect: 'holds the zone the box is showing even when the gym has moved on',
    from: '    () => timezoneChoices(detected, draft.timezone, org?.timezone),',
    to: '    () => timezoneChoices(detected, org?.timezone),',
  },
  {
    // AIMED AT THE WRONG FIX I NEARLY SHIPPED, the way O126 is aimed at the
    // reviewer's rejected one-liner (:19656). The first version of C/H-1's fix
    // moved `lastOrgSeen` here too; this restores that, and the test it breaks
    // is the one that held a re-read open and caught it.
    id: 'C75',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    why: "ON SCREEN AND FALSE (:5807): the save also moves the row the form is judged against, so for as long as the follow-up read is in flight the STALE prop drags the freshly-saved values back to the pre-save ones — and if that read then FAILS, the store keeps its old answer by design and the boxes show the pre-save row FOR EVER over a save that landed",
    expect: 'does NOT blank the screen while that re-read happens',
    from: '      setDraft(gymDetailsDraft(res.data?.org));',
    to: '      setDraft(gymDetailsDraft(res.data?.org));\n      setLastOrgSeen(gymDetailsDraft(res.data?.org));',
  },
  {
    id: 'C76',
    target: 'states',
    suite: SETTINGS_SUITE,
    why: 'BLOCKED FROM FINISHING (T3 Low-1): the latch goes, so pressing **Try again** clears the error, which clears `forceOpen`, which SHUTS THE SECTION UNDER THE CLICK — spinner included, since the loading arm lives in the body that was just unmounted. Everything vanishes and the button reads as broken',
    expect: 'STAYS OPEN through a Try again',
    from: '  if (forceOpen && !open) setOpen(true);',
    to: '  if (false) setOpen(true);',
  },
  {
    id: 'C77',
    target: 'states',
    suite: SETTINGS_SUITE,
    why: 'ACCESSIBILITY (T3 Low-3): a closed row points `aria-controls` at a body that has been UNMOUNTED, so a screen reader is promised an element to move to and there is none. Closed means gone here, not hidden, which is what makes the dangling reference real rather than pedantic',
    expect: 'points at its body only while the body exists',
    from: '        aria-controls={isOpen ? bodyId : undefined}',
    to: '        aria-controls={bodyId}',
  },
  {
    id: 'C78',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    why: 'TWO REQUESTS FOR ONE ACT (T3 Low-2): the in-flight guard goes and ENTER submits the form without going through the disabled button, so two quick presses send two saves. Harmless in itself — PATCH, idempotent, and a no-op writes no audit row — and still the app asking twice for something a person asked once',
    expect: 'sends ONE request however many times the form is submitted',
    // RE-ANCHORED 2026-08-29: the read-only card added `|| readOnly` to this
    // same guard (C116 is the row that watches THAT half). The mutation is
    // unchanged — it still deletes `saving` and nothing else, so this row still
    // measures the in-flight guarantee alone.
    from: '    if (problem !== null || patch === null || saving || readOnly) return;',
    to: '    if (problem !== null || patch === null || readOnly) return;',
  },

  // ── T3 ROUND 2's TWO FIXES ───────────────────────────────────────────────
  {
    // C56'S SIBLING AT THE CALL SITE, and round 2's Critical/High lived entirely
    // here rather than in the helper (:15770 — a mutant is a claim about ONE
    // call site). C56 says "the helper injects a zone the runtime does not
    // list"; this says "the panel asks it for the right zones", and round 1's
    // fix satisfied the first while breaking the second.
    id: 'C79',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    why: "SAVES, and it is round 1's own fix doing it: the picker is asked only for the zone it is DISPLAYING, so the zone the gym actually HOLDS leaves the list the instant an owner selects anything else — with no way back short of leaving the screen. Measured on this machine: 418 zones enumerated, `Asia/Calcutta` present and `Asia/Kolkata` absent, plus Kiev/Kyiv, Rangoon/Yangon, Godthab/Nuuk. An owner who opens the dropdown to look has silently lost the ability to put their gym's day back",
    expect: 'own zone selectable after the owner picks a different one',
    from: '    () => timezoneChoices(detected, draft.timezone, org?.timezone),',
    to: '    () => timezoneChoices(detected, draft.timezone),',
  },
  {
    id: 'C80',
    target: 'gympanel',
    suite: SETTINGS_SUITE,
    why: 'ON SCREEN AND FALSE (:5807), T3 round 2 Low-1: the follow block swaps what is in the boxes and leaves "Saved." standing, so a confirmation sits beside values the owner never saved — a claim about bytes that are no longer on screen, which is the rule this same file states for every keystroke',
    expect: 'takes "Saved." down when the boxes are replaced',
    from: '      setSaved(false);',
    to: '      void 0;',
  },

  // ── T3 ROUND 3's FIXES ───────────────────────────────────────────────────
  {
    id: 'C81',
    target: 'settings',
    suite: SETTINGS_SUITE,
    why: "DATA CORRUPTION ON THE WRONG GYM: the gym-details panel is no longer thrown away when the gym changes, so it keeps a TOUCHED draft across a move between two gyms' Settings — `/console/:orgSlug/settings` is ONE route and does not remount. Gym A's typing then sits under gym B, over gym B's own untouched city, and one Save writes all of it to gym B's id INCLUDING THE TIME ZONE, moving the day boundary of a gym the owner was not editing. Not an IDOR — the server rightly authorises it, because gym B is a gym this owner manages",
    expect: 'carries NOTHING from one gym onto another',
    // RE-ANCHORED 2026-08-27 — round 4's key PREFIX moved this line and nothing
    // re-aimed it; measured matching zero times. See S15's note for the full
    // account: three anchors moved in one commit and all three were missed.
    // RE-ANCHORED AGAIN 2026-08-29 with S15 and C82 — the read-only card broke
    // both panel mounts onto their own lines. Anchored on the KEY LINE alone
    // now, which is the thing this mutant deletes, and `key={undefined}` is how
    // React reads "no key at all".
    from: '          key={`gym-${org.id}`}',
    to: '          key={undefined}',
  },
  {
    // THE CLASS HALF, and it was found by probing for the sibling rather than by
    // the review — which named only the gym-details panel. :1239: fixing the
    // instance and leaving the class is what this repo has recorded five times.
    id: 'C82',
    target: 'settings',
    suite: SETTINGS_SUITE,
    why: "ON SCREEN AND FALSE (:5807) ON A DIFFERENT GYM: the staff panel keeps its fetched list across a gym change, so gym A's staff rows sit under gym B for as long as gym B's read is in flight. Worse than a stale list — a row's controls act on the CURRENT `gymId` with the OLD person's id, so a Remove aimed at somebody visible is sent against a gym they do not staff",
    expect: 'carries NO staff list from one gym onto another',
    // RE-ANCHORED 2026-08-27 for the same reason as S15 and C81 — round 4's key
    // prefix, three anchors, none re-aimed. The prefix is part of the anchor on
    // purpose: it is the very thing this mutant deletes.
    // Re-anchored with S15 and C81, 2026-08-29, same cause and same shape.
    from: '          key={`staff-${org.id}`}',
    to: '          key={undefined}',
  },
  {
    // ROUND 3's Low-1: the test this mutant belongs to COULD NOT FAIL until this
    // round fixed its fixture. It mocked the runtime list as `['Europe/Paris']`
    // and asked for `Europe/Paris` + `Asia/Kolkata`, so only ONE zone was ever
    // missing — and a helper keeping just the last missing one passed. Measured:
    // the whole web suite, 1232/1232, stayed green with round 2's variadic
    // guarantee broken. Two simultaneously-missing zones is the only shape that
    // tells the two implementations apart (:4267 F2's class).
    id: 'C83',
    target: 'gymview',
    suite: GYMVIEW_SUITE,
    why: "SAVES: the picker keeps only the LAST zone it was asked for, so whenever the gym's stored zone and the zone on screen are BOTH ones this runtime does not enumerate, one of them silently leaves the list — and round 2's whole variadic guarantee, which exists to stop a gym's day boundary moving, is back to the single-zone behaviour it was written to replace",
    expect: 'keeps EVERY zone it is asked for',
    from: '  return missing.length === 0 ? zones : [...missing, ...zones];',
    to: '  return missing.length === 0 ? zones : [missing[missing.length - 1], ...zones];',
  },
  // ── THE TRIAL, THE BANNER AND THE SEAT METER (C86–C91) ────────────────────
  //
  // Every row here is 4a's "numbers a user sees" or "can another person see it",
  // and each one is a sentence or a figure this console would print while being
  // wrong about it — which :5807 calls Critical/High on sight.
  {
    id: 'C86',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: "FALSE ON SCREEN: the banner asks whether a trial END DATE exists instead of whether the gym is TRIALLING. `trial_ends_at` is never cleared when a subscription leaves that status, so a gym that has been PAYING for a year is shown a countdown off the date its old trial ran out — the exact misread the shared schema warns about in as many words",
    expect: 'asks the STATUS, not whether an end date exists',
    from: "  return org?.subscription?.status === 'trialing';",
    to: '  return org?.subscription?.trialEndsAt != null;',
  },
  {
    id: 'C87',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: 'FALSE ON SCREEN: the trial countdown floors elapsed milliseconds instead of comparing local calendar days, so "3 days left" appears at 3 days and 1 hour and the amber notice arrives a DAY LATE — the defect four review rounds found in four separate functions of `joinClock.js`, arriving in the first file to be written after that rule',
    expect: 'does not round a few hours up into a whole day',
    from: '  return calendarDaysBetween(now, at.getTime());',
    to: '  return Math.floor((at.getTime() - now) / 86400000);',
  },
  {
    id: 'C88',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: 'FALSE ON SCREEN: an unknown seat cap becomes a zero, so a gym on no plan and a capless band both read "0 of 0 places used" — a meter drawn over a number nobody computed, at a gym nothing is actually limiting',
    expect: 'is null for every unknown',
    // RE-AIMED before it ever shipped. Its first anchor was a `typeof` guard
    // sitting ABOVE the finite check, and it came back ALIVE because the two
    // covered the same case — so the mutation changed nothing observable and
    // said nothing about the guarantee. The redundant line was deleted from the
    // SOURCE (:17676) and this now points at the one line that decides.
    from: '  if (!Number.isFinite(cap) || !Number.isFinite(used) || cap <= 0) return null;',
    to: '  if (false) return null;',
  },
  {
    id: 'C89',
    target: 'trialcard',
    suite: TRIAL_SUITE,
    why: "PRIVILEGE: the trial button is drawn for anybody who can reach the console, so a TRAINER is offered a control the server answers 403 to — §2.2's Billing row is the owner's alone by default, and a greyed or dead control over a live refusal is the defect that row's own rules warn about",
    expect: 'not drawn at all for somebody without the billing tick',
    from: '  if (!canManageBilling(viewerPrivileges(org))) return null;',
    to: '  if (false) return null;',
  },
  {
    id: 'C90',
    target: 'orgstore',
    suite: PROMPT_SUITE,
    // RE-AIMED 2026-08-28, AT THE SAME GUARANTEE IN ITS NEW HOME (:13336's
    // instruction, :15770's standard). It used to anchor on `TrialCard`'s
    // `justStarted` — the server's own answer to the Overview's trial button,
    // held against a failed re-read. Kd ruled that button deleted (:22921 §1)
    // and the fact moved into the store, because the prompt that now starts a
    // trial UNMOUNTS when an owner walks out through "Your gyms", so a fact kept
    // in the component would not survive the journey. The guarantee is
    // unchanged and the stakes went UP: it is no longer a card saying the wrong
    // thing, it is an unclosable prompt reappearing over a gym that is trialling.
    why: "SEALED OUT AFTER A SUCCESSFUL ACTION: the server's own answer to the trial press stops being written into the kept gym row, so a background re-read that FAILS leaves the console believing the gym is still on nothing — and the prompt that cannot be closed comes straight back over a gym that IS trialling, with its own button the only way out",
    expect: 'STAYS GONE when the background re-read never confirms it',
    from: '    orgs: state.orgs.map((o) => (o?.id === gymId ? { ...o, subscription } : o)),',
    to: '    orgs: state.orgs,',
  },
  {
    id: 'C91',
    target: 'banner',
    suite: TRIAL_SUITE,
    why: "SILENCE WHERE IT MATTERS MOST: the banner honours a dismissal on EVERY state rather than only the dismissible one, so the amber \"your trial ends on the 3rd\" notice can be closed and stays closed — §4.2 makes that state not dismissible precisely because it is the last thing an owner sees before their members lose the gym's features",
    // RE-FILTERED before it ever shipped. It first named the test that checks
    // the amber banner has no dismiss BUTTON — which nothing stores a dismissal
    // for, so the mutation had no observable subject and came back ALIVE against
    // correct code. :11846's two halves, and it was the FILTER half again: the
    // anchor said what breaks, and the filter named a test that could not
    // notice. Now pointed at the test that PLANTS the record.
    expect: 'with a dismissal already stored against it',
    from: '    banner.dismissible &&\n    gymId !== null &&',
    to: '    gymId !== null &&',
  },

  // ── WALKING BETWEEN TWO GYMS (C92–C95) ────────────────────────────────────
  //
  // C93 and C94 are the fifth and sixth `key` this console has needed for one
  // class — a panel holding state across a gym change — and the first two aimed
  // at the JOURNEY rather than at a component. Their suite is
  // `gymSwitch.render.test.jsx`, which exists for that class alone.
  //
  // **EVERY FILTER HERE IS ASCII ON PURPOSE.** The harness refuses a non-ASCII
  // `-t` (:10402), and the test names in that file carry curly apostrophes, so
  // each `expect` is an ASCII SUBSTRING of the name rather than the name.
  {
    id: 'C92',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: 'FALSE ON SCREEN: a cap of zero stops being refused, so a gym whose plan admits nobody reads "0 of 0 places used — your gym is full" — a meter drawn over a number nobody computed, and the `full` arm firing at a gym that has no limit at all',
    // C88 above mutates this SAME line wholesale; this one deletes ONLY the
    // `cap <= 0` clause, which is the half nothing could falsify. The two are
    // different claims about one line, which is why both exist: C88 asks
    // whether the guard runs, C92 asks whether this part of it decides anything.
    expect: 'refuses a cap of zero or less',
    from: '  if (!Number.isFinite(cap) || !Number.isFinite(used) || cap <= 0) return null;',
    to: '  if (!Number.isFinite(cap) || !Number.isFinite(used)) return null;',
  },
  {
    id: 'C93',
    target: 'layout',
    suite: GYM_SWITCH_SUITE,
    // RE-AIMED 2026-08-28, AND THE OLD SUBJECT NO LONGER EXISTS — which is why
    // it moved rather than being deleted. It anchored on `<TrialCard key={org.id}
    // …>`, whose key protected the card's `justStarted` state; Kd's ruling
    // (:22921 §1) removed the button and with it every piece of state that card
    // held, so mutating that key now changes nothing observable and the mutant
    // would come back ALIVE against perfectly correct code — C88's shape.
    // :17676's standard is to ask whether the guarantee is OBSERVABLE before
    // assuming a test is missing: this one MOVED, to the console's newest
    // stateful panel. The key on the card stays (a fix round carries only its
    // fix, :5348 rule 6) and is now belt-and-braces, which `Overview.jsx` says.
    why: "MONEY ON SCREEN THAT IS NOT ABOUT THE GYM NAMED ABOVE IT: the unskippable prompt stops being keyed to its gym, and the shell does not remount between two gyms — so an owner walking from gym A to gym B sees gym B's prompt still holding GYM A'S PRICE LIST while gym B's own read is in flight",
    // ASCII and unique among this file's test names — "does not show gym A"
    // alone would match three of them (:10402's non-ASCII rule, :14840's
    // filter-half rule).
    expect: 'prices under gym B',
    from: '        key={`plan-modal:${org?.id ?? \'no-gym\'}`}',
    to: '        key="plan-modal"',
  },
  {
    id: 'C94',
    target: 'layout',
    suite: GYM_SWITCH_SUITE,
    // ONE LINE, because `ConsoleLayout.jsx` is CRLF — see this file's own note
    // on the `layout` target.
    why: "SILENCE WHERE IT MATTERS: the banner stops being keyed to its gym, so dismissing one gym's trial notice for the day also silences the OTHER gym's — a deadline an owner is never shown, on a surface whose whole purpose is to reach them before their members lose the gym's features",
    expect: 'does not let a banner dismissed on gym A',
    from: "        <ConsoleBanner key={org?.id ?? 'no-gym'} org={org} />",
    to: '        <ConsoleBanner org={org} />',
  },
  {
    id: 'C95',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: 'FALSE ON SCREEN: the meter\'s sentence stops saying a full gym is full, so the banner and the roster header both report "300 of 300 places used." while the door is turning people away and nothing on screen says why — the screen and the door disagreeing, which is the defect the seat meter exists to prevent',
    // Aimed at the FULL arm because that is the clause this round de-duplicated:
    // it was written out twice, in this file and in `Members.jsx`, with nothing
    // keeping the copies equal. What this CANNOT see is somebody re-inlining an
    // IDENTICAL copy at a call site — stated rather than implied.
    expect: 'is the sentence itself, asserted as a literal',
    from: '    ? `${meter.used} of ${meter.cap} places used — your gym is full, so nobody else can join yet.`',
    to: '    ? `${meter.used} of ${meter.cap} places used.`',
  },

  // ── THE PROMPT AN OWNER CANNOT SKIP (C96–C101) ────────────────────────────
  //
  // Kd's ruling of 2026-08-28 (:22215, :22697), and the first surface in this
  // console that can lock somebody out of their own gym. **The rows below run in
  // BOTH directions on purpose**, because this component has two opposite
  // failures and only one of them looks like a bug from the inside:
  //
  //   · IT FAILS TO APPEAR — a gym goes on using a console it has not paid for,
  //     which is the hole the ruling exists to close (C98's opposite, C99).
  //   · IT APPEARS OVER THE WRONG PERSON — a trainer who cannot pay, a paying
  //     gym, or an owner whose server is simply too old to say whether their
  //     trial is spent. **That is somebody SEALED OUT of their own console with
  //     no way past**, and it is why `planPromptFor` draws nothing on an unknown
  //     (C96, C97, C98).
  //
  // A guard whose only failure mode ever tested is "it did not fire" is
  // satisfied by a door that is permanently shut (:7104's PG1), and behind an
  // unclosable prompt that door is somebody's business.
  {
    id: 'C96',
    target: 'billingview',
    suite: PROMPT_SUITE,
    why: "SEALED OUT: the prompt stops asking whether the viewer can pay, so a TRAINER who opens the console meets a prompt they cannot close, whose only button is a trial the server answers 403 to — Kd ruled 2026-08-28 that it stops only whoever holds `billing.manage`, because blocking somebody who cannot subscribe is a brick wall aimed at the wrong person",
    expect: 'does not stop a trainer',
    from: '  if (!canManageBilling(viewerPrivileges(org))) return null;',
    to: '  if (false) return null;',
  },
  {
    id: 'C97',
    target: 'billingview',
    suite: PROMPT_SUITE,
    why: "SEALED OUT ON A GUESS, AND THIS IS THE ONE THE SCHEMA WARNS ABOUT IN AS MANY WORDS: `ownerTrialUsed` null means \"we could not ask\" — a non-staff caller, or an api older than this bundle — and treating it as \"has not trialled\" draws an unclosable prompt over an owner during any web-newer-than-api deploy",
    expect: 'never said whether the trial is spent',
    from: "  if (org?.ownerTrialUsed === false) return 'trial';",
    to: "  if (org?.ownerTrialUsed !== true) return 'trial';",
  },
  {
    id: 'C98',
    target: 'billingview',
    suite: PROMPT_SUITE,
    why: 'SEALED OUT OF A CONSOLE THEY PAY FOR: the prompt stops checking whether the gym is on a live plan, so a trialling — and one day a PAYING — gym is covered by a prompt demanding it subscribe, with no way to dismiss it',
    expect: 'does not stop a gym that is already trialling',
    from: '  if (hasLivePlan(org)) return null;',
    to: '  if (false) return null;',
  },
  {
    id: 'C99',
    target: 'billingview',
    suite: PROMPT_SUITE,
    why: "BLOCKED WITH A BUTTON THAT CANNOT WORK: an owner whose one free trial is spent is shown the TRIAL arm instead of the price list, so the only control on an unclosable prompt is one the server answers 409 `trial_already_used` to — the exact false promise :22341 §7 reported and this card closes",
    expect: 'once the sweep has ended its trial',
    from: "  if (org?.ownerTrialUsed === true) return 'subscribe';",
    to: "  if (org?.ownerTrialUsed === true) return 'trial';",
  },
  {
    id: 'C100',
    target: 'planmodal',
    suite: PROMPT_SUITE,
    why: 'FALSE ON SCREEN: a price read that FAILED is drawn as an empty price book, so a gym owner whose connection blipped is told this product has no plans for their gym — the empty-vs-failed defect this console has already shipped once, arriving on the one screen a gym owner cannot leave',
    expect: 'does NOT draw a failed price read',
    from: '            {!plans.loading && plans.error === null && plans.list !== null ? (',
    to: '            {!plans.loading && (plans.list ?? []).length === 0 ? (',
  },
  {
    id: 'C101',
    target: 'planmodal',
    suite: PROMPT_SUITE,
    // WHAT THIS PROVES, STATED NARROWLY BECAUSE IT IS EASY TO OVERCLAIM: that
    // the suite NOTICES A CLOSE CONTROL APPEARING on this prompt. It does not
    // prove the prompt is unclosable in general — "cannot be closed" is a set of
    // ABSENCES (no X, no Escape handler, no click-outside), and an absence has
    // no line to mutate. The Escape and backdrop halves are driven directly by
    // the test instead. This is the half a future edit is most likely to add
    // back, because a dialog with a close button looks like good manners.
    why: "THE RULING UNDONE IN ONE LINE: a close control appears on the prompt Kd ruled unskippable, so the owner it exists for taps it away and goes on using a console for a gym that is not a customer — the dismissible card he rejected, wearing the modal's clothes",
    expect: 'CANNOT BE CLOSED',
    from: "        <h2 id={titleId} className=\"text-xl font-bold\" style={{ color: '#fff' }}>",
    to: "        <button type=\"button\" onClick={() => setBusy(false)}>Close</button><h2 id={titleId} className=\"text-xl font-bold\" style={{ color: '#fff' }}>",
  },
  {
    id: 'C102',
    target: 'newgym',
    suite: PROMPT_SUITE,
    // KD FOUND THIS ONE IN A BROWSER, at the smoke, and no test existed for it
    // — the defect was that the prompt arrived one CLICK too late. :5348 rule 5
    // says a class found by a person gets an automated check, and rule 3 says a
    // fix ships with a test that fails without it. Both are this row and the
    // case it names, measured RED against the unfixed screen before shipping.
    why: "A GYM ON NO PLAN HANDS OUT ITS JOIN CODE: the unskippable prompt stops covering the screen a gym is CREATED on, so the first thing a new owner sees is their code under \"Give this code to your members\" — the exact state :22215 exists to remove — and the prompt only arrives after they click through to the gym",
    expect: 'is COVERED by the prompt',
    from: '        <PlanModal org={createdOrg} onSignOut={signOut} signingOut={signingOut} />',
    to: '',
  },

  // ── T3 ROUND 1's FIXES (C103–C106) ────────────────────────────────────────
  //
  // Four guarantees the round created, each on its own call site (:15770). The
  // first two are one feature — focus must MOVE into the dialog and must STAY
  // there — and a single mutant covering both would not say which half failed.
  {
    id: 'C103',
    target: 'planmodal',
    suite: PROMPT_SUITE,
    why: "THE RULING HOLDS FOR A MOUSE AND NOT A KEYBOARD: Tab stops being contained, so focus walks out of the prompt into the rail's links, the phone tab bar and — on the gym-created screen — the join code's live Copy button, every one of them invisible behind a 94%-opaque overlay with the focus ring hidden and Enter still working. It is the smoke sheet's own step 2 made false for anybody not using a mouse",
    expect: 'CONTAINS THE KEYBOARD',
    from: '        onKeyDown={keepFocusInside}',
    to: '',
  },
  {
    id: 'C104',
    target: 'planmodal',
    suite: PROMPT_SUITE,
    why: 'THE OTHER HALF OF THE SAME GUARANTEE, and it fails silently rather than loudly: focus is never MOVED into the dialog, so it stays on whatever the screen behind had — the first Tab then continues from there, through the covered screen, and a screen reader is still reading the page the prompt is supposed to have taken over',
    expect: 'CONTAINS THE KEYBOARD',
    from: '    dialogRef.current?.focus();',
    to: '',
  },
  {
    id: 'C105',
    target: 'newgym',
    suite: PROMPT_SUITE,
    why: "KD'S OWN DEFECT, IN THE WINDOW THE FIX FOR IT LEFT OPEN: the cover over the gym-created screen goes, so the join code and its live Copy button are on screen for the whole round trip while the console asks what this gym is on — and PERMANENTLY if that read fails, since the prompt cannot draw without an answer",
    expect: 'KEEPS the code covered',
    from: '        {createdOrg === null ? <SettingUpCover /> : null}',
    to: '',
  },
  {
    id: 'C106',
    target: 'trialcard',
    suite: PROMPT_SUITE,
    why: "BLOCKED WITH NOTHING ON SCREEN TO EXPLAIN IT: the sentence for an api too old to say whether this owner's trial is spent disappears, so during a web-newer-than-api deploy the prompt refuses to draw (correctly — it cannot be closed) and the card draws nothing either. The owner gets a blank space where a trial button used to be, with no way to start one and nothing saying why",
    expect: 'SAYS SO in that window',
    from: "    return typeof org?.ownerTrialUsed !== 'boolean' ? (",
    to: '    return false ? (',
  },

  // ── THE LAPSED GYM'S CONSOLE GOES READ-ONLY (web half), 2026-08-29 ────────
  //
  // Kd's ruling (:23711): a gym with no live plan can still SEE everything and
  // change nothing, and it stops EVERY member of staff. The server has refused
  // twelve write doors since `4320ac5`; these rows are about the SCREENS, where
  // the failure until today was a live button whose press is a 409 with no
  // sentence saying why.
  //
  // **EVERY ROW BELOW RUNS IN ONE OF TWO DIRECTIONS AND BOTH ARE REPRESENTED,
  // because this guard has two opposite failures and only one of them looks
  // like a bug from the inside** (:7104's PG1):
  //   · IT LEAKS — a lapsed gym keeps a live control (C107, C109, C111, C113,
  //     C114, C116)
  //   · IT FIRES TOO WIDE — a PAYING gym, or one whose state we could not read,
  //     has its console taken away (C108, C110)
  // The second is the worse defect, because that gym is a customer.
  {
    id: 'C107',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: 'LEAK: the lock stops asking for a definite answer and greys out on anything truthy, so `null` — which means "we could not ask", never "locked" (C97\'s rule) — takes a PAYING gym\'s console away during any web-newer-than-api window',
    expect: 'does NOT lock on false, on null, on a missing field',
    from: '  return org?.consoleReadOnly === true;',
    to: '  return org?.consoleReadOnly !== false;',
  },
  {
    id: 'C108',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: "FIRES TOO WIDE, the other direction: the lock is derived from the subscription instead of the server's own answer, so a trainer — who is never told about the plan — sees a paying gym's whole console greyed out",
    expect: 'is NOT derived from the subscription',
    from: '  return org?.consoleReadOnly === true;',
    to: '  return !hasLivePlan(org);',
  },
  {
    id: 'C109',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: "LEAK: §4.2's read-only row never reaches the banner machine, so a lapsed gym's staff meet greyed controls with nothing at the top of any screen saying the gym has no plan",
    // ASCII, and the guard above is what caught the first draft of this line:
    // the test's own name carries `§4.2’s`, whose curly apostrophe would have
    // matched no test and reported the mutant ALIVE.
    expect: 'red and undismissable',
    from: '  if (consoleIsReadOnly(org)) {',
    to: '  if (false) {',
  },
  {
    id: 'C110',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: 'FIRES TOO WIDE: the banner drops its definite-answer test, so a red "this gym has no plan" is drawn over a gym whose state the api was simply too old to report',
    expect: 'is NOT drawn on a false or an unknown',
    from: '  if (consoleIsReadOnly(org)) {',
    to: '  if (org?.consoleReadOnly !== false) {',
  },
  {
    id: 'C111',
    target: 'codespanel',
    suite: READ_ONLY_SUITE,
    why: 'LEAK: a lapsed gym can still mint a join code — a code handed out by a gym whose Confirm answers 409, so whoever types it waits in a queue nobody can clear',
    expect: 'cannot be minted, paused, replaced or removed',
    from: '          disabled={busy || readOnly || full === true}',
    to: '          disabled={busy || full === true}',
  },
  {
    id: 'C112',
    target: 'codespanel',
    suite: READ_ONLY_SUITE,
    why: 'THE SENTENCE GOES: the controls are greyed and nothing beside them says why, which is the "greyed control that states nothing" defect §2.2\'s own rules warn about — the banner is at the top of the page and these buttons are not',
    expect: 'cannot be minted, paused, replaced or removed',
    from: '      {readOnly ? (\n        <p className="text-xs mb-3" style={{ color: \'rgba(255,255,255,0.45)\' }}>',
    to: '      {false ? (\n        <p className="text-xs mb-3" style={{ color: \'rgba(255,255,255,0.45)\' }}>',
  },
  {
    id: 'C113',
    target: 'queue',
    suite: READ_ONLY_SUITE,
    why: "LEAK: the front desk of a lapsed gym is still told to \"confirm the ones you recognise\" and the tap is still live — the console instructing somebody to press a button the server refuses, over people it cannot let in",
    expect: 'says nobody can be let in',
    from: "          {readOnly ? null : ' — confirm the ones you recognise.'}",
    to: "          {' — confirm the ones you recognise.'}",
  },
  {
    id: 'C114',
    target: 'queue',
    suite: READ_ONLY_SUITE,
    why: 'LEAK: Confirm stays live on a lapsed gym, which is the exact 409 this card exists to stop a person walking into',
    expect: 'greys BOTH taps',
    from: '          disabled={busy || readOnly}\n          className="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"',
    to: '          disabled={busy}\n          className="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"',
  },
  {
    id: 'C115',
    target: 'queue',
    suite: READ_ONLY_SUITE,
    why: ":23928's Low-5, the one thing this card owes the PEOPLE rather than the staff: the queue stops saying nobody can be let in, so applicants sit in a list the console never explains",
    expect: 'says nobody can be let in',
    from: '        {readOnly ? (\n          <p className="text-xs mt-1" style={{ color: \'#ef4444\' }}>',
    to: '        {false ? (\n          <p className="text-xs mt-1" style={{ color: \'#ef4444\' }}>',
  },
  {
    id: 'C116',
    target: 'gympanel',
    suite: READ_ONLY_SUITE,
    why: "LEAK THROUGH THE ONE DOOR THAT IS NOT A BUTTON: the submit guard goes, so pressing ENTER in the name box of a lapsed gym still fires the PATCH and meets the server's 409 — the greyed Save button is not the door on this screen",
    // **THIS ROW SURVIVED TWICE, ONCE FOR EACH HALF OF :11846's PAIR, and the
    // second half is the one this repo keeps recording last** (:21580's C91,
    // :22921's O148, :23711's O155). First the TEST was missing — the case named
    // "cannot be saved" only ever asserted the BUTTON is disabled, which a form
    // submitting on ENTER walks straight past. Then, with the observer written,
    // this filter still named the OLD test and the mutant came back ALIVE a
    // second time. Pointed at the case that actually submits the form.
    expect: 'which the greyed button cannot stop',
    from: '    if (problem !== null || patch === null || saving || readOnly) return;',
    to: '    if (problem !== null || patch === null || saving) return;',
  },
  {
    id: 'C117',
    target: 'staffpanel',
    suite: READ_ONLY_SUITE,
    why: "TWO LOCKS CONFUSED IN ONE COMPONENT: the owner-row lock is swapped for the gym's read-only state, so on a PAYING gym the owner's own ticks — which no gym may ever edit, or it can be left with nobody able to hand out the keys — become editable",
    expect: 'which is a different lock',
    from: '  const ownerRow = person.role === \'owner\';',
    to: '  const ownerRow = readOnly;',
  },
  {
    id: 'C118',
    target: 'api',
    suite: API_SUITE,
    why: ':23928\'s Low-6: "Try again" is offered on the permanent 409 a lapsed gym answers, so a manager presses a button that can never succeed however many times they press it',
    expect: 'offers no retry on the two refusals',
    from: '  return code === null || !PERMANENT_ERROR_CODES.includes(code);',
    to: '  return true;',
  },
  {
    id: 'C119',
    target: 'api',
    suite: API_SUITE,
    why: 'THE FIX\'S OWN HAZARD, in the direction that costs more: the retry is taken away from everything but a definite retryable code, so an OFFLINE failure — no status, no body — loses its button and a dropped connection reads as a permanent refusal',
    expect: 'OFFLINE still offers the button',
    from: '  return code === null || !PERMANENT_ERROR_CODES.includes(code);',
    to: '  return code !== null && !PERMANENT_ERROR_CODES.includes(code);',
  },

  // ── T3 ROUND 1's Critical/High — the commit control behind each opener ──────
  //
  // **THE ROWS ABOVE MUTATE THE OPENERS AND WERE STRUCTURALLY BLIND TO THESE.**
  // C111/C114/C116 all point at a control a CLOSED panel draws, and every test
  // that observes them renders a gym that is already lapsed — so no row in this
  // table could see that Save, Replace it, Remove it and Make the code carried
  // `busy` alone. Their observers are the five cases under "a step already open
  // when the gym lapses", which open the step while the gym is PAYING and then
  // drive a real `focus` event, because that is the journey the app itself walks
  // (`consoleOrgs` re-reads on focus; nothing here remounts on a plan change).
  //
  // Each anchor is a PROP LINE plus the one line above it that names the action,
  // which is what keeps it unique in a file with nine `disabled={busy ||
  // readOnly}` sites (:15770, :23128 — an anchor that matches twice lands on
  // whichever comes first).
  {
    id: 'C120',
    target: 'codespanel',
    suite: READ_ONLY_SUITE,
    why: 'LEAK: the limits editor Save goes back to `busy` alone, so a gym that lapses while somebody is editing a code keeps a live Save under the note saying nothing can be changed',
    expect: 'greys the limits editor',
    from: '              onClick={save}\n              disabled={busy || readOnly}',
    to: '              onClick={save}\n              disabled={busy}',
  },
  {
    id: 'C121',
    target: 'codespanel',
    suite: READ_ONLY_SUITE,
    why: 'LEAK, and the destructive one: "Replace it" stays live inside an open confirm step, so the press that turns away everybody holding the old code is offered by a console that has just said it can change nothing',
    expect: 'greys Replace it',
    from: '                onRotate();\n              }}\n              disabled={busy || readOnly}',
    to: '                onRotate();\n              }}\n              disabled={busy}',
  },
  {
    id: 'C122',
    target: 'codespanel',
    suite: READ_ONLY_SUITE,
    why: 'LEAK: "Remove it" stays live inside an open confirm step on a lapsed gym',
    expect: 'greys Remove it',
    from: '                setConfirmingRemove(false);\n                onRemove();\n              }}\n              disabled={busy || readOnly}',
    to: '                setConfirmingRemove(false);\n                onRemove();\n              }}\n              disabled={busy}',
  },
  {
    id: 'C123',
    target: 'codespanel',
    suite: READ_ONLY_SUITE,
    why: 'LEAK: "Make the code" stays live inside an open new-code form, minting against a gym the server refuses',
    expect: 'greys Make the code',
    from: '              onClick={create}\n              disabled={busy || readOnly}',
    to: '              onClick={create}\n              disabled={busy}',
  },
  {
    id: 'C124',
    target: 'codespanel',
    suite: READ_ONLY_SUITE,
    why: 'The FIELDS are their own surface: the limits editor keeps live date and maximum boxes on a lapsed gym, so somebody types a change that has nowhere to go',
    expect: 'greys the limits editor',
    from: '            disabled={busy || readOnly}\n            idPrefix={`edit-${code.code}`}',
    to: '            disabled={busy}\n            idPrefix={`edit-${code.code}`}',
  },
  {
    id: 'C125',
    target: 'codespanel',
    suite: READ_ONLY_SUITE,
    why: 'The same surface on the new-code form: live boxes above a button that cannot be pressed',
    expect: 'greys Make the code',
    from: '            disabled={busy || readOnly}\n            idPrefix="new-code"',
    to: '            disabled={busy}\n            idPrefix="new-code"',
  },
  {
    id: 'C126',
    target: 'staffpanel',
    suite: READ_ONLY_SUITE,
    why: 'LEAK: the add-staff form keeps a live Add on a lapsed gym. NOT REACHABLE BY A USER TODAY — the section is gated on `staff.manage`, owner-only, and an owner of a lapsed gym meets PlanModal instead of Settings (:23257) — so this row and its test are the record that the guard exists before the door opens, never evidence that anybody met it',
    expect: 'greys the add-staff form',
    from: '          onClick={onAdd}\n          disabled={busy || readOnly}',
    to: '          onClick={onAdd}\n          disabled={busy}',
  },
  {
    id: 'C127',
    target: 'staffpanel',
    suite: READ_ONLY_SUITE,
    why: 'The add-staff email box stays typeable on a lapsed gym — same unreachability caveat as C126',
    expect: 'greys the add-staff form',
    from: '          value={email}\n          disabled={busy || readOnly}',
    to: '          value={email}\n          disabled={busy}',
  },
  {
    id: 'C128',
    target: 'staffpanel',
    suite: READ_ONLY_SUITE,
    why: 'The add-staff role buttons stay pressable on a lapsed gym — same unreachability caveat as C126',
    expect: 'greys the add-staff form',
    from: '              aria-checked={role === choice.value}\n              disabled={busy || readOnly}',
    to: '              aria-checked={role === choice.value}\n              disabled={busy}',
  },

  // ── THE WAITING QUEUE'S SENTENCE (Kd 2026-08-29, :24141 §1) ───────────────
  //
  // **THIS CONSTANT HAD NO MUTANT UNTIL 2026-08-30, AND THAT WAS RIGHT AT THE
  // TIME.** Card A shipped it as one sentence whose second half was deliberately
  // MISSING, guarded by two tests asserting an absence — and an absence has no
  // behaviour to mutate. The hold is built now, so the sentence makes a PROMISE,
  // and a promise is a thing that can be deleted or overreached. Both directions
  // below.
  {
    id: 'C129',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: "KD'S RULING VANISHES FROM THE CONSOLE: the queue tells a front desk that nobody can be let in and stops there, so the manager of a lapsed gym has no way to know the people waiting are being held rather than quietly timing out. It is the half of the ruling this screen owns, and deleting it leaves the other half saying it alone",
    expect: 'promises the waiting people keep their place',
    from: "  'Nobody can be let in until this gym is on a plan. The people waiting keep their place.';",
    to: "  'Nobody can be let in until this gym is on a plan.';",
  },
  {
    id: 'C130',
    target: 'billingview',
    suite: BILLING_VIEW_SUITE,
    why: "A PROMISE ONE CARD EARLY: the sentence grows into 'we will confirm them once you are back'. Nothing in this product can put a lapsed gym back on a plan, and a held request whose deadline has already passed needs the PAYMENT card to survive the first sweep after one does — so the console would be promising a front desk an outcome no code produces (:5807), which is exactly what Card A refused to write before the behaviour existed",
    expect: 'does NOT promise the gym will confirm them later',
    from: "The people waiting keep their place.';",
    // **THE REPLACEMENT CARRIES NO APOSTROPHE, AND THAT IS NOT STYLE.** The
    // constant is a SINGLE-QUOTED JS string, so a `we'll` in the replacement
    // closes it early, the file stops parsing, vitest emits no tally and the
    // harness ABORTS — which is what happened on this row's first run. :21157's
    // class (`node --check` catching a raw newline in a mutant string), arriving
    // through quoting rather than through a newline.
    to: "The people waiting keep their place, and we will confirm them once you are back.';",
  },
  {
    id: 'C131',
    target: 'queue',
    suite: READ_ONLY_SUITE,
    why: "T3 ROUND 1's Critical/High ON THE HELD-APPLICATION CARD, MADE PERMANENT: the applicant countdown returns to the lapsed gym's own queue. `Expires in 11 days` and `Due to expire` are both FALSE once the expiry's `gymOnPlan` guard holds the row, and they render ONE LINE under `READ_ONLY_QUEUE_NOTE` — 'The people waiting keep their place.' — contradicting it in the same viewport (:5807). The card removed this countdown from the applicant's OWN screen and left it here, so the guard belongs on the surface that was missed, not only on the one that was fixed",
    expect: 'drops every applicant countdown on a lapsed gym, in BOTH directions',
    from: 'const expiring = readOnly ? null : expiresInLabel(applicant.expiresAt);',
    to: 'const expiring = expiresInLabel(applicant.expiresAt);',
  },
  // ---------------------------------------------------------------------
  // OPENING HOURS, WEB HALF (Kd :26624, :26684, :26736), added 2026-09-01.
  // Every row is in rule 4a's always-mutated columns: a number or state a
  // MEMBER can see and could see FALSELY, a gym blocked from saying something
  // true, or a write reaching a door that refuses it. Nothing here mutates
  // wording, layout or a comment.
  // ---------------------------------------------------------------------
  {
    id: 'C132',
    target: 'hoursnote',
    suite: HOURS_NOTE_SUITE,
    why: "THE DEFECT THIS WHOLE FEATURE WAS DESIGNED AROUND, and it would reach EVERY GYM IN THE DATABASE on the day it shipped: the mode gate goes, so a gym that has never filled the section in is drawn from its ROWS — of which it has none — and its members are told their gym is Closed every day of the week. `unset` and `shut every day` are byte-identical from the rows alone, which is why Kd's :26736 made the third state physical and why this is the first assertion in the note's suite (:5807)",
    expect: "draws NOTHING",
    from: "  if (hours.mode !== 'open_24h' && hours.mode !== 'scheduled') return null;",
    to: "  if (hours.mode === undefined) return null;",
  },
  {
    id: 'C133',
    target: 'hoursnote',
    suite: HOURS_NOTE_SUITE,
    why: "A MEMBER WALKS TO A LOCKED DOOR: the dated closure stops winning over the weekly pattern, so a gym that typed `Closed today - Holi` still shows its ordinary Wednesday hours. Kd ruled these are TWO MECHANISMS and that the dated one overrides (:26684 3); collapsing them is the exact conflation that ruling exists to prevent, and the member is the one who pays for it",
    expect: "dated closure WINS",
    from: "  const closedToday = (hours.closures ?? []).find((c) => c.day === today) ?? null;",
    to: "  const closedToday = null;",
  },
  {
    id: 'C134',
    target: 'hoursnote',
    suite: HOURS_NOTE_SUITE,
    why: "TRAP #8 ON A MEMBER-FACING SURFACE: the weekday is taken from the BROWSER instead of the gym, so a member on the other side of the date line is shown yesterday's or tomorrow's opening times as today's. Every UTC-ish fixture agrees with the browser, which is why the note's suite runs a UTC+14 gym at 23:30 UTC and this row is aimed at it",
    expect: "shows TODAY from the GYM's zone",
    from: "  const today = gymToday(hours.timezone);",
    to: "  const today = gymToday(undefined);",
  },
  {
    id: 'C135',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: ":26736's SENTENCE, INVERTED AT ITS SOURCE: the summary for a gym that has not answered becomes the one for a gym that is shut every day. It is the console half of C132 and it is worth its own row because an OWNER reads this line on a closed heading before opening anything — so a gym that has never been asked would be told, on its own settings screen, that it is closed (:5807)",
    expect: "three DIFFERENT answers",
    from: "  return \"You haven't said when your gym is open. Members aren't shown anything about opening times until you do.\";",
    to: "  return 'Your gym is closed every day of the week.';",
  },
  {
    id: 'C136',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "A GYM IS BLOCKED FROM SAYING SOMETHING TRUE (:5807's second half): the overlap comparison goes from strict to inclusive, so two sessions that merely TOUCH - 10:00-12:00 then 12:00-14:00, an ordinary timetable with a break in its numbering - are refused as overlapping. The card names this boundary as risk 4, and it is the direction a reviewer is least likely to check because the refusal LOOKS like the guard working",
    expect: "ACCEPTS touching",
    from: "      if (current.opens < previous.closes) {",
    to: "      if (current.opens <= previous.closes) {",
  },
  {
    id: 'C137',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "THE OVERLAP CHECK TURNS OFF FOR EVERY REAL SCREEN: the sort before the neighbour comparison goes, so an owner who adds a 6am session after a 2pm one - which is every screen anybody would build, including this one - has their overlaps waved through. The server sorts too, so nothing corrupt is stored; what breaks is the owner being told BEFORE the request instead of by a 400 afterwards",
    expect: "sorts sessions",
    from: "    parsed.sort((a, b) => a.opens - b.opens);",
    to: "    parsed.slice();",
  },
  {
    id: 'C138',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "THE GYM CLOSES ON THE WRONG DAY: the ISO conversion returns the JS number, so Sunday becomes 0 instead of 7 and every weekday after it is off by one against a wire and a database that both count 1-7. This is the card's own risk 2, and this function is the ONLY conversion in the app - which is what makes one mutant enough to guard it",
    expect: "maps a calendar date to ISO",
    from: "  return js === 0 ? 7 : js;",
    to: "  return js;",
  },
  {
    // RE-ANCHORED 2026-09-01 when the clock ruling threaded `clockFormat`
    // through `hoursProblem`. The pre-check ABORTED rather than reporting a
    // false ALIVE, which is :5199's class doing its job — and the guarantee is
    // unchanged: `unset` must never become a sendable request.
    id: 'C139',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "A REQUEST THE SERVER WILL REFUSE, BUILT BY THE CLIENT: `unset` becomes sendable, so a gym that has answered can try to un-answer. The server's union does not admit it, so the owner meets a 400 for pressing a button the screen offered them - and the reason `unset` is unsettable at all is that un-answering would silently remove information the gym's members can already see",
    expect: "NEVER builds a request",
    from: "  if (draft?.mode !== 'scheduled') return null;\n  if (hoursProblem(draft, '24h') !== null) return null;",
    to: "  if (draft?.mode === 'unset') return { mode: 'unset' };\n  if (hoursProblem(draft, '24h') !== null) return null;",
  },
  {
    id: 'C140',
    target: 'hourspanel',
    suite: HOURS_PANEL_SUITE,
    why: "A LAPSED GYM CAN STILL SAVE: `readOnly` leaves the save gate, so a gym with no live plan fires the request and meets the server's 409. Kd ruled the console read-only for EVERY member of staff (:23711), and this panel is a form - so the button being grey is not the whole of the fix, which is the recorded reason `GymDetailsPanel` carries the same guard inside its submit handler",
    expect: "already typed when the plan lapsed",
    from: "  const canSave = allowed && !readOnly && !saving && request !== null && problem === null && touched;",
    to: "  const canSave = allowed && !saving && request !== null && problem === null && touched;",
  },
  {
    id: 'C141',
    target: 'hourspanel',
    suite: HOURS_PANEL_SUITE,
    why: "A SAVE THAT WORKED LOOKS LIKE A SAVE THAT FAILED - the carry-forward T3 round 1 left for this half. The write has no date window on purpose (a gym typing last night's closure in at 1am is telling the truth late) while the READ is today-forward and horizon-capped, so such a closure is genuinely saved and genuinely absent from the reply. Without this sentence the screen re-renders the reply, the date is not in it, and the owner reasonably concludes nothing happened (:5807 arriving through a correct server)",
    expect: "SAYS SO when a save succeeds",
    from: "      setClosureNotice(closureAbsentReason(closureDay, today));",
    to: "      setClosureNotice(null);",
  },
  // ---------------------------------------------------------------------
  // KD'S FIVE CHANGES AT THE SCREEN, 2026-09-01 — dropdowns instead of typing,
  // both clocks with the GYM choosing, a calendar for the date, "same every
  // day", and each weekday folding on its own. Every row below is in rule 4a's
  // always-mutated columns: something a member or an owner SEES and could see
  // falsely, or a control that destroys a timetable.
  // ---------------------------------------------------------------------
  {
    id: 'C142',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "A GYM IS SHOWN A CLOCK IT DID NOT CHOOSE (Kd, 2026-09-01: the gym picks 4 or 16): the label ignores the gym's answer and everything falls back to 24-hour. It is the console AND every member's card at once, because both read one function - and it is silent, because 16:00 is a perfectly well-formed time to anyone who can read it",
    expect: "speaks the GYM's clock",
    from: "  if (clockFormat !== '12h') return `${String(h).padStart(2, '0')}:${mm}`;",
    to: "  return `${String(h).padStart(2, \"0\")}:${mm}`;",
  },
  {
    id: 'C143',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "THE MINUTE LIST COLLAPSES, so the 5:30 Kd named as a case - and every half-hour opening any real gym has - simply is not offered. He asked for `_ _ : _ _` with a step fine enough to say what a gym actually means; a list of two entries is the typing he wanted rid of, with no box left to type into",
    expect: "five-minute steps",
    from: "  return Array.from({ length: 60 / MINUTE_STEP }, (_, i) => {",
    to: "  return Array.from({ length: 2 }, (_, i) => {",
  },
  {
    id: 'C144',
    target: 'hourspanel',
    suite: HOURS_PANEL_SUITE,
    why: "THE PICKER BECOMES UNUSABLE, AND THIS IS THE DEFECT THE REWRITE ACTUALLY SHIPPED: the three boxes stop holding their own half-finished state and derive everything from the stored string, which cannot express \"the hour is 6 and the minute is not chosen yet\". Picking the hour then produces an empty string and the box snaps straight back to `--` - neither box holds what you picked, and no time can be entered at all. It is invisible to any test that sets both boxes in one go, which is why the one aimed here drives them SEPARATELY, as a person does",
    expect: "HOLDS a half-finished time",
    from: "  const [parts, setParts] = useState(() => splitClock(value, clockFormat));",
    to: "  const parts = splitClock(value, clockFormat);\n  const setParts = () => {};",
  },
  {
    id: 'C145',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "\"USE THESE TIMES EVERY DAY\" SHARES ROWS INSTEAD OF COPYING THEM, so every day of the week points at ONE object: editing Tuesday afterwards silently rewrites Monday, Wednesday and the rest. Kd's own instruction was that a gym copies once and then changes a particular day by hand, which is the exact sequence this breaks - and it breaks it INVISIBLY, since the screen looks right until the second edit",
    expect: "copies rather than shares",
    // RE-ANCHORED by T3 round 1's C/H-1 fix, which added the fresh id and moved
    // the source day out of the map — and RE-MEASURED rather than assumed
    // (:8610). The subject is unchanged: `to` still shares one array across the
    // week, which is the defect this row has always been about.
    from: "        : { ...day, sessions: source.sessions.map((s) => ({ ...s, id: mintSessionId() })) },",
    to: "        : { ...day, sessions: source.sessions },",
  },
  {
    id: 'C146',
    target: 'hourspanel',
    suite: HOURS_PANEL_SUITE,
    why: "THE DAYS BECOME AN ACCORDION, WHICH IS THE SHAPE KD RULED AGAINST IN AS MANY WORDS: opening Tuesday folds Monday away. His sentence was \"clicking other day should not undo the drop\", and an owner copying one day's times into another by eye now cannot see both at once - which is the whole reason the fold exists",
    expect: "opening Tuesday does NOT close Monday",
    from: "      if (next.has(weekday)) next.delete(weekday);",
    to: "      next.clear();\n      if (current.has(weekday)) return next;",
  },
  {
    id: 'C147',
    target: 'hourspanel',
    suite: HOURS_PANEL_SUITE,
    why: "A DESTRUCTIVE BUTTON APPEARS ON AN EMPTY DAY: \"use these times every day\" is offered where there are no times, so one click copies NOTHING onto all seven and wipes the gym's whole week - under a label that promises a convenience. The guard is the only thing between an owner exploring the screen and losing a timetable they just typed",
    expect: "only offers it on a day with times",
    from: "                              {sessions.length > 0 ? (",
    to: "                              {true ? (",
  },
  {
    id: 'C148',
    target: 'hoursnote',
    suite: HOURS_NOTE_SUITE,
    why: "A MEMBER READS A DIFFERENT CLOCK FROM THEIR OWN GYM: the card ignores the gym's choice and prints 24-hour whatever the owner picked. It is the reason the setting lives on the GYM row rather than in a browser - one gym, one clock - and a member told 16:00 by a gym whose console says 4:00 PM has two answers about the same Monday",
    expect: "reads on the GYM's clock",
    from: "  const clockFormat = hours.clockFormat ?? '24h';",
    to: "  const clockFormat = '24h';",
  },
  // ---------------------------------------------------------------------
  // T3 ROUND 1 ON THE WEB HALF, 2026-09-01 — two Critical/High, and the row
  // below each one is the permanent guard :5348 rule 5 requires. Both are in
  // rule 4a's always-mutated columns: a time a MEMBER is shown and a gym
  // PUBLISHES, and a control that destroys a timetable.
  //
  // THE THIRD ROW HERE IS A HOLE THE REVIEW FOUND RATHER THAN A DEFECT: the X
  // that deletes a time row had no test and no mutant of any kind — the one
  // control on this screen that destroys something was the one nothing watched.
  // ---------------------------------------------------------------------
  {
    id: 'C149',
    target: 'hourspanel',
    suite: HOURS_PANEL_SUITE,
    why: "THE GYM PUBLISHES A TIME NOBODY TYPED - T3 round 1's C/H-1, made permanent. The rows go back to being identified by their POSITION, so deleting one does not delete a row: it hands the next row's data to the deleted row's still-mounted boxes. Those boxes hold their own half-finished state (:27333) and re-read the row only when its stored string CHANGES - and two half-finished rows both store the empty string, so nothing changes and nothing re-reads. Measured before the fix: pick 9 on row 1, 7 on row 2, delete row 1, finish the row, and the gym saves opensMinute 540 - 09:00 - for a row somebody set to 7, which every member is then shown (:5807)",
    expect: "removing a time row",
    from: "                              <div key={session.id} className=\"flex flex-wrap items-center gap-2 mb-2\">",
    to: "                              <div key={index} className=\"flex flex-wrap items-center gap-2 mb-2\">",
  },
  {
    id: 'C150',
    target: 'hoursnote',
    suite: HOURS_NOTE_SUITE,
    why: "A MEMBER IS TOLD THE GYM IS OPEN ON A DAY IT DECLARED SHUT - T3 round 1's C/H-2, made permanent. The dated closure stops reaching the WEEK LIST while still winning in the headline, so the card reads `Closed today - Holi` and then prints today's ordinary hours three lines below it, in the brighter colour that marks today. C133 next door already describes this failure in its own words and could not see this half of it, because the only test watching it looked at the headline. Kd's :26684 3 says the dated closure wins over the pattern - in every place the pattern is drawn, not merely in the first one",
    expect: "ANYWHERE on the card",
    from: "                  {weekday.iso === todayIso && closedToday !== null",
    to: "                  {false && weekday.iso === todayIso && closedToday !== null",
  },
  {
    id: 'C151',
    target: 'hourspanel',
    suite: HOURS_PANEL_SUITE,
    why: "THE X BUTTON STOPS DELETING ANYTHING, and this row exists because T3 round 1 found that NOTHING in this repo watched it - no test, no mutant. An owner who adds a row by mistake, or whose gym drops a session, cannot take it off the timetable: the click is swallowed, the row stays, and the only sign is that the screen does not change. It is the one control on this screen that destroys something, which is exactly the column rule 4a says is never left unmutated. RE-ANCHORED by T3 round 2's L-4 (:13336), which moved this line from a POSITION to the row's own id; the subject is unchanged and it was re-measured RED on the new line rather than assumed",
    expect: "takes the row away",
    from: "          : { ...day, sessions: day.sessions.filter((s) => s.id !== id) },",
    to: "          : day,",
  },
  {
    id: 'C152',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "C/H-1 DOWN THE SECOND PATH: a copied row keeps the identity of the row it overwrote, so the form's boxes do not re-read it. A day holding a half-typed 9 goes on showing 9 after `use these times every day` has replaced it with somebody else's 6 - the same defect as C149 arriving through the convenience button rather than through the delete. It shares a line with C145 and guards the opposite half of it: C145 says the rows are COPIED, this says each copy is a NEW ROW",
    // The two filters here are deliberately not case-variants of one phrase: a
    // `-t` that differs from its neighbour only in capitals is one careless
    // rename away from matching the wrong test, or none.
    expect: "every copied row",
    from: "        : { ...day, sessions: source.sessions.map((s) => ({ ...s, id: mintSessionId() })) },",
    to: "        : { ...day, sessions: source.sessions.map((s) => ({ ...s })) },",
  },
  {
    id: 'C153',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "THE ROWS THE SERVER SENDS ARRIVE WITHOUT IDENTITIES, so every row the gym already has is told apart by its position again - C149's defect, at its source, for the timetable an owner opens rather than the rows they add in the session. It also puts a null key on every row, and T3 round 2's L-2 corrected what this row used to claim about that: MEASURED under this exact mutation, a day holding two or more rows makes React report `Encountered two children with the same key, null` twice and `test-setup.js` turns that into a FAILED run - so the duplicate-key guard does see this. What it cannot see is a week of single-row days, where the null keys land in different day lists and React never warns at all, which is why the unit test below is the observer and the guard is not",
    expect: "stops one row wearing another",
    from: "        id: mintSessionId(),",
    to: "        id: null,",
  },
  {
    id: 'C154',
    target: 'hoursview',
    suite: HOURS_VIEW_SUITE,
    why: "THE CLOSURE DATE GOES BACK TO BEING RESOLVED THROUGH A ZONE. A closure is the GYM's calendar date with no instant in it, and `new Date('2026-09-20')` is UTC midnight - so a locale formatter prints the 19th to every member west of the gym, which is trap #8 landing on the one surface this feature kept it off throughout. **THE HONEST LIMIT, because a mutant that overstates itself is worse than none: this suite pins Asia/Kolkata (+05:30), where UTC midnight is the SAME day, so the DAY SHIFT itself is not observable here and only the FORMAT is.** What this row therefore guards is that the label is not produced by a locale formatter at all - which is what makes the shift impossible - and the day-shift half would need a fixture in the Americas",
    expect: "spells it out with the weekday",
    from: "  return `${short} ${String(Number(date))} ${MONTH_SHORT[Number(month) - 1]} ${year}`;",
    to: "  return parsed.toLocaleDateString();",
  },

  {
    id: 'C155',
    target: 'overviewview',
    suite: OVERVIEW_VIEW_SUITE,
    why: "THE SCREEN WORKS THE PERCENTAGE OUT ITSELF instead of drawing the one the server counted. Ruling 14's only load-bearing requirement (:27992 section 3): every figure on a console screen is counted in SQL over the whole gym, and a client that divides is one rounding rule away from disagreeing with every other surface that ever prints adoption. The fixture is deliberately one no honest gym produces - 12 of 28 is 43 per cent and the server says 77 - which is :29250 section 3's shape and the only reason this is observable at all",
    expect: "reads the percentage the server computed and never divides",
    from: "  const pct = month?.adoptionPct;",
    to: "  const pct = count(month?.members) === 0 ? null : Math.round((count(month?.visitors) * 100) / count(month?.members));",
  },
  {
    id: 'C156',
    target: 'overviewview',
    suite: OVERVIEW_VIEW_SUITE,
    why: "THE ARROW TRAVELS ALONE. week.visits is this gym-week SO FAR and prevVisits is the WHOLE of the week before, so on a Tuesday a bare up-or-down arrow compares two days against seven and tells a healthy gym it is collapsing - :5807 on its face, a number on screen that is wrong. The requirement is the card's (section 4b) and it got there because the server half's review found it living only in a comment in packages/shared, which is not somewhere the screen's author reads",
    expect: "never hands back a direction without a sentence naming both ends",
    from: "  return { direction, text: `so far, against ${visitsLabel(prev)} in the whole of last week` };",
    to: "  return { direction, text: '' };",
  },
  {
    id: 'C157',
    target: 'overviewview',
    suite: OVERVIEW_VIEW_SUITE,
    why: "THE EMPTY STATE MAKES A CLAIM ABOUT ALL TIME OFF A PAYLOAD THAT COVERS EIGHT WEEKS. :8343 is this project's recorded cost of exactly that - a sentence about a history the server was never asked about - and the false case here is a gym that was busy nine weeks ago and quiet since, told nobody has ever come",
    expect: "names the window it can actually see",
    from: "  return `Nobody has marked attendance in the last ${OVERVIEW_WEEKS} weeks.`;",
    to: "  return 'Nobody has marked attendance yet.';",
  },
  {
    id: 'C158',
    target: 'overviewview',
    suite: OVERVIEW_VIEW_SUITE,
    why: "A GYM WHOSE BUTTON IS OFF IS TOLD NOBODY CAME. Two different situations with two different next moves collapse into one sentence, and the one it picks points the owner at their members when the answer is the switch in Settings - emptyDayReason's rule one screen over, where the same three-way distinction is already load-bearing",
    expect: "points at the switch when the switch is what is stopping them",
    from: "  if (manualAttendanceEnabled === false) {",
    to: "  if (false) {",
  },
  {
    id: 'C159',
    target: 'overviewview',
    suite: OVERVIEW_VIEW_SUITE,
    why: "A TRUE NUMBER IS HIDDEN TO HONOUR AN EMPTY-STATE RULE. month.members counts CURRENT non-complimentary members, so a gym whose only seat is the owner's complimentary one reads zero - and if that owner has marked themselves in, two people came today is TRUE. Asking the members question first draws nothing over a gym that has something to say, which is the empty-state defect pointed the other way",
    expect: "draws the numbers for a gym with no members but somebody through the door",
    from: "  if (hasAnyActivity(overview)) return 'ready';",
    to: "  if (count(overview?.tiles?.month?.members) === 0) return 'no-members';",
  },
  {
    id: 'C160',
    target: 'overviewview',
    suite: OVERVIEW_VIEW_SUITE,
    why: "THE UNFINISHED WEEK STOPS SAYING SO. The last bar is this week SO FAR and is short because the week is not over; a chart whose final column is always the runt teaches an owner to read a weekly collapse that is not there - the same defect as the bare arrow one panel up, and the reason the bar's own sentence says which one it is",
    expect: "marks the newest bucket as this week, and only that one",
    from: "      isCurrent: index === rows.length - 1,",
    to: "      isCurrent: false,",
  },
  {
    id: 'C161',
    target: 'overviewview',
    suite: OVERVIEW_VIEW_SUITE,
    why: "THE TWO SERIES GET THEIR OWN SCALES AND THE PEOPLE LINE RIDES ABOVE THE VISITS BARS. visitors is a DISTINCT count over the rows visits counts, so it can never exceed them - a picture showing more people than visits is one that cannot happen, and it is exactly what an independently-scaled line draws on a week where members came twice",
    expect: "keeps the people line on or under the visits bars",
    from: "      cy: CHART_HEIGHT - Math.round((visitors / max) * CHART_HEIGHT * CHART_CEILING),",
    to: "      cy: CHART_HEIGHT - Math.round((visitors / Math.max(1, ...rows.map((w) => count(w?.visitors)))) * CHART_HEIGHT * CHART_CEILING),",
  },
  {
    id: 'C162',
    target: 'overviewview',
    suite: OVERVIEW_VIEW_SUITE,
    why: "THE AXIS LABEL GOES BACK TO BEING RESOLVED THROUGH A ZONE. A gym's Monday is a calendar date with no instant in it, and new Date of a bare YYYY-MM-DD is UTC midnight - so a locale formatter prints the previous day to every reader west of the gym. Trap number 8, and C154 is the same mutation on the closure label one file over: this one IS observable as a day shift, because the test asserts the first of a month",
    expect: "writes a gym Monday the way a person does",
    from: "  return `${String(Number(date))} ${name}`;",
    to: "  return new Date(weekStart).toLocaleDateString();",
  },
  {
    id: 'C163',
    target: 'overviewnumbers',
    suite: RENDER_SUITE,
    why: "THE PANEL DIVIDES INSTEAD OF DRAWING. C155's defect at the other call site (:15770 - a mutant is a claim about ONE call site): the view file could be perfect and the screen still print its own arithmetic. Same fixture, same tell - 43 per cent appears where the server said 77",
    expect: "draws the figures the server sent",
    from: "          <Tile label=\"Last 30 days\" value={`${adoption.pct}%`} note={adoption.text} />",
    to: "          <Tile label=\"Last 30 days\" value={`${Math.round((tiles.month.visitors * 100) / tiles.month.members)}%`} note={adoption.text} />",
  },
  {
    id: 'C164',
    target: 'overviewnumbers',
    suite: RENDER_SUITE,
    why: "A GYM WITH MEMBERS AND NOBODY THROUGH THE DOOR FALLS THROUGH TO THE TILES AND READS 0 people beside 0 per cent. We have no data and the answer is zero are different sentences, and printing the second for the first is the defect :8267 was raised on and :26736 caught one card ago before it shipped",
    expect: "tells a gym with members and no visits that nobody has come",
    from: "  if (state === 'nobody') {",
    to: "  if (false) {",
  },
  {
    id: 'C165',
    target: 'overview',
    suite: RENDER_SUITE,
    why: "A FAILED NUMBERS READ GOES SILENT. The pane draws nothing and says nothing, so an owner whose connection dropped simply has no numbers and no way to ask for them again - :12660 is the citation and it is the anti-silence rule: no reviewer, test or mutant flags an ABSENT sentence, a person does",
    expect: "offers a Try again when the numbers fail on their own",
    from: "        <ConsoleFailed message={overview.error} onRetry={retry} />",
    to: "        null",
  },
  {
    id: 'C166',
    target: 'overview',
    suite: RENDER_SUITE,
    why: "A TRAINER THEIR GYM REFUSED IS SHOWN A RED CARD AND A Try again ON EVERY VISIT TO THEIR OWN HOME SCREEN. The read is gated on attendance.read, which is default-on for all three roles and one an owner may UNTICK (:28107 section 2), so this 403 is reachable by a real person - and isRetryable already knows a 403 is permanent, which is what stops a button being offered that cannot work",
    expect: "takes the numbers away from a trainer their gym refused",
    from: "      {!overview.loading && overview.error !== null && overview.retryable",
    to: "      {!overview.loading && overview.error !== null && true",
  },
  {
    id: 'C167',
    target: 'overviewview',
    suite: RENDER_SUITE,
    why: "TWO TRUE NUMBERS GO BACK TO COMPOSING A FALSE IMPRESSION. Found on Kd's own console 2026-09-03: Today said 1 person while Last 30 days said 0 per cent, 0 of 2 members came - correct, because the visitor held a complimentary owner's seat that the share excludes at both ends, and unreadable as anything but a screen contradicting itself. The shared contract named this exact pairing before the screen existed. :5807's test is not is it on screen, it is is it on screen AND wrong, and an arrangement of true figures can be",
    expect: "explains itself when somebody came and the members share did not move",
    from: "  const cameRecently = count(tiles?.today?.visitors) > 0 || count(tiles?.week?.visitors) > 0;",
    to: "  const cameRecently = false;",
  },
  {
    id: 'C168',
    target: 'overviewview',
    suite: RENDER_SUITE,
    why: "THE EXPLANATION APPEARS OVER A GYM WITH NOTHING TO EXPLAIN. A note about free seats printed under a share that a counted member DID move is noise pointing at a discrepancy the owner cannot see - the same failure as an empty state firing on a screen that is not empty, and the reason this sentence is conditional rather than permanent",
    expect: "does not explain a gap that is not there",
    from: "  if (count(tiles?.month?.visitors) > 0) return null;",
    to: "  if (false) return null;",
  },

  {
    id: 'C172',
    target: 'overviewview',
    suite: RENDER_SUITE,
    why: "THE NAMES COUNT THE PAGE. hiddenPeopleCount stops reading the server's whole-day total and answers from the rows on screen, so a gym of four hundred reads five - Kd's ruling 14 and the exact breakage :27992 section 3 names, arriving on the surface that was built to answer his how can gym even get a correct information from it",
    expect: "keeps the count the server sent above a preview",
    from: "  const all = count(totals?.people);\n  const on = Array.isArray(shown) ? shown.length : 0;\n  return all > on ? all - on : 0;",
    to: "  const on = Array.isArray(shown) ? shown.length : 0;\n  return on;",
  },
  {
    id: 'C173',
    target: 'overviewnumbers',
    suite: RENDER_SUITE,
    why: "THE NUMBERS BECOME A DEAD END AGAIN. Kd's how can gym even get a correct information from it: a count an owner cannot open is useless, and the whole day - names, times, an exceptions filter - has been one click away on the Attendance screen since :29250 with nothing pointing at it. RE-AIMED, NOT ALLOW-LISTED (:15770): the first version deleted the chevron beside the word, which is DECORATION - it changes neither the accessible name nor the href, so the mutant was ALIVE for a reason with nothing to do with the guarantee. It now breaks the DESTINATION, which is the guarantee",
    expect: "is a way in to the full day, not a dead end",
    from: "  const attendanceHref = `/console/${orgSlug}/attendance`;",
    to: "  const attendanceHref = `/console/${orgSlug}`;",
  },
  {
    id: 'C174',
    target: 'overviewnumbers',
    suite: RENDER_SUITE,
    why: "A PERSON WHO CAME TWICE READS AS ONE VISIT. Only the first chip is drawn, so came two times again at this time - Kd's own words for what he wanted - silently becomes a single arrival, and the day's totals above it stop agreeing with the rows beneath",
    expect: "shows somebody who came twice as twice",
    from: "        {chips.map((chip, i) => (",
    to: "        {chips.slice(0, 1).map((chip, i) => (",
  },
  {
    id: 'C175',
    target: 'overviewnumbers',
    suite: RENDER_SUITE,
    why: "A FAILED DAY READ TAKES THE NUMBERS DOWN WITH IT. The names are a PREVIEW of a screen one click away and their absence is deliberate silence; making the whole panel depend on them means a blipped list costs an owner every figure on their home screen, which is the collapse-the-outcomes defect :10596's L-3 split these reads to prevent",
    expect: "loses the names and keeps every number",
    from: "  if (state === 'none' || state === 'no-members') return null;",
    to: "  if (state === 'none' || state === 'no-members' || day === null) return null;",
  },
  {
    id: 'C176',
    target: 'overviewview',
    suite: OVERVIEW_VIEW_SUITE,
    why: "THE TILE GOES BACK TO LEADING WITH VISITS INSTEAD OF PEOPLE. Kd asked for it should be like this many people came, so the headline figure is the count of PEOPLE and the visits count is the caption - swapping them puts a bigger number in front of an owner that answers a question they did not ask, and on a day where three people came six times it reads as six people",
    expect: "leads with the people count",
    from: "    value: people,",
    to: "    value: visits,",
  },
  {
    id: 'C177',
    target: 'attendanceview',
    suite: ATTENDANCE_VIEW_SUITE,
    why: "SOMEBODY WHO CAME ONCE IS LABELLED visited 1 times. Kd asked for besides people say A visited 2 times, and the label exists to mark the EXCEPTION - printing it on every ordinary member is noise on the row it was added to make legible, and it gets the grammar wrong on the screen an owner opens every morning",
    expect: "says nothing at all for somebody who came once",
    from: "  return visits > 1 ? `visited ${visits} times` : '';",
    to: "  return `visited ${visits} times`;",
  },
  {
    id: 'C178',
    target: 'overviewnumbers',
    suite: RENDER_SUITE,
    why: "THE CHART DISAPPEARS FOR A GYM IN ITS FIRST WEEK — WHICH IS THE MISTAKE THIS MUTANT EXISTS TO RE-INTRODUCE, AND IT WAS MINE. Kd asked whether the chart was CORRECT and I answered by deleting it in exactly this state; he corrected it: did not asked the chart to be removed but just asked to be correct accurate and beautiful. The no-removal rule is absolute. The flat columns are TRUE and this week bar is real, so the collecting sentence explains them rather than replacing them",
    expect: "says it is still collecting",
    from: "      {geometry === null ? null : (",
    to: "      {geometry === null || collecting ? null : (",
  },
  {
    id: 'C179',
    target: 'states',
    suite: RENDER_SUITE,
    why: "A SECTION THAT STARTS OPEN CAN NEVER BE CLOSED AGAIN - the defect Kd found by clicking on 2026-09-03: the drop down is not working i clcik here bu it does not open close. isOpen is open OR forceOpen, so pinning it true makes the tap flip a flag the OR immediately overrides. defaultOpen seeds the state instead; seeding from false again makes the prop inert and both attendance lists arrive CLOSED, and a case that only checked the section ARRIVES open would pass under it, which is exactly how it shipped",
    expect: "lets an owner fold the names away",
    from: "  const [open, setOpen] = useState(defaultOpen);",
    to: "  const [open, setOpen] = useState(false);",
  },
];

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

// A REPEATED ID IS AN ABORT, PORTED FROM `apps/api/tools/mutate-orgs.mjs`
// 2026-09-03 (:30094 section 3a, where it cost a real run). That harness shipped
// a duplicate id because rows were numbered from the ids at the END of the file
// and THE TABLE IS NOT IN ID ORDER — this one is not either (152 rows, highest
// id C154). Every guard in the harness stayed green: nothing failed and nothing
// was skipped, the damage was to the RECORD, since `MUTATE_ONLY=C217` would run
// two different mutants for ever and every document citing that id would be
// ambiguous with no way to tell which. :5348 rule 5 — a class found once gets a
// permanent check rather than another careful fix.
const seenIds = new Set();
for (const m of MUTANTS) {
  if (seenIds.has(m.id)) {
    abort(`${m.id} appears twice in the table. Number the new row above the HIGHEST id in use, which is not the last row of this file.`);
  }
  seenIds.add(m.id);
}

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

// EVERY ANCHOR IS CHECKED FOR THE WHOLE TABLE BEFORE A BYTE IS WRITTEN, ported
// here from `mutate-orgs.mjs` after this harness aborted at APPLY time, 13
// mutants into a run, on an anchor a fix in the SAME round had drifted.
//
// It is not about saving the 13 minutes. A no-op mutation reports as ALIVE, and
// the honest reading of ALIVE is "this guarantee has no test" — so an anchor
// that silently stops matching sends the next chat hunting a hole that was never
// there. This is the second time in two rounds that one of my own fixes moved a
// line an existing mutant named (O21 was the first), which is exactly the
// recurring CLASS that :5348 rule 5 says gets a permanent guard rather than
// another careful fix.
/** AND IT MUST MATCH EXACTLY ONCE — ported from `apps/api/tools/mutate-orgs.mjs`
 *  2026-08-23, where T3 L-2 on the badge card (:15093/:15259) added it.
 *
 *  **This harness had the "matches nothing" half and not the "matches twice"
 *  half, and the gap was NAMED before it was fixed there** — :14493 wrote it out
 *  in as many words: *"a pre-check that asks 'does this match?' cannot ask 'does
 *  this match ONCE' — worth fixing in the harness"*. The api side then hit it
 *  for real when a new 14-space line CONTAINED an existing 12-space anchor, so a
 *  mutant silently went from one match to two while three documents recorded it
 *  as verified. `String.replace` takes the FIRST occurrence, so an ambiguous
 *  mutant still lands somewhere — just not provably on the line its `why`
 *  describes, which makes its RED evidence for a claim nobody checked.
 *
 *  Fixing one harness and leaving its sibling is the "fixed the instance, left
 *  the class" defect this repo has recorded since :1239, so the guard is now in
 *  both. **There is no allow-list here and there must not be one added
 *  casually**: the api's exists only for three rows that were already ambiguous
 *  before it was written, and it may only shrink. Every one of this table's
 *  anchors matches exactly once (measured when this landed) — a row that becomes
 *  ambiguous aborts the run, which is the point. */
for (const m of MUTANTS) {
  const original = originals.get(m.target);
  const hits = original.text.split(m.from).length - 1;
  if (hits === 0) {
    abort(
      `${m.id}: its anchor matches nothing in '${m.target}'. Nothing has been written yet. ` +
      `Re-anchor it against the current file — a no-op mutation reports as ALIVE, which reads as "this guarantee has no test".`,
    );
  }
  if (hits > 1) {
    abort(
      `${m.id}: its anchor matches ${String(hits)} times in '${m.target}', so the mutation lands on whichever comes FIRST rather than on the line its \`why\` describes. ` +
      `Re-anchor it on text unique to that function. Nothing has been written yet.`,
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
// matching no test would otherwise make its mutant look ALIVE — which reads as
// "this guarantee has no test" and sends the next chat hunting a hole that was
// never there.
console.log('control (unmutated) — every filter must be GREEN and must tally ...');
/** `MUTATE_ONLY=S7,S17` RUNS A SUBSET — added 2026-08-23, and its absence is
 *  what made the gap worth closing.
 *
 *  **The api harness carries a comment saying the web side "has had this since
 *  :4855 F6". That is FALSE of THIS harness and was measured, not assumed**: a
 *  `MUTATE_ONLY=S7` run here was silently ignored and started a full sweep, which
 *  a ten-minute timeout then killed MID-MUTANT, leaving `consoleView.js` holding
 *  `code.paused && false` in the working tree. :4855 F6 was about
 *  `mutate-date-window`; a claim true of one web harness had been generalised to
 *  all of them, which is :2825's "an index entry you skipped is not evidence of
 *  absence" pointed the other way — a record claiming coverage that was never
 *  checked in the file it names.
 *
 *  **Why it matters beyond convenience: re-anchoring is routine here** (five
 *  recorded occurrences on this branch alone), a re-aimed mutant is unproven
 *  until re-measured (:8610), and without this flag re-measuring ONE of them
 *  costs the whole hour-long table. The cost of that is not the hour — it is the
 *  temptation to skip the re-measurement.
 *
 *  **An unknown label is FATAL, never a silent empty run** (:4855's own
 *  requirement): a typo would otherwise "pass" while mutating nothing, which is
 *  the unearned-pass shape this project has recorded six times. **The controls
 *  and both pre-checks still run over the WHOLE table** — a subset run still
 *  proves every anchor is sane — and the summary PRINTS that it is a subset, so
 *  a partial figure cannot be quoted as a complete sweep (:5199). */
const onlyRaw = process.env.MUTATE_ONLY;
const only = onlyRaw === undefined || onlyRaw.trim() === ''
  ? null
  : new Set(onlyRaw.split(',').map((s) => s.trim()).filter((s) => s !== ''));
if (only !== null) {
  const known = new Set(MUTANTS.map((m) => m.id));
  const unknown = [...only].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    abort(`MUTATE_ONLY names ${unknown.join(', ')}, which are not in the table. Nothing has been run.`);
  }
}
const SELECTED = only === null ? MUTANTS : MUTANTS.filter((m) => only.has(m.id));

// Deduped as OBJECTS rather than by splitting a joined string: every filter
// here contains spaces, so a naive split would run the control on the first
// WORD of each -- a broader filter than the mutants use, i.e. the control
// quietly checking something else.
//
// Built from SELECTED, so a one-mutant run pays for one control rather than
// sixty. The pre-checks above still cover the whole table; what narrows here is
// only how many suites are run, never how much is VERIFIED.
const pairs = [];
const seenPairs = new Set();
for (const m of SELECTED) {
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
for (const m of SELECTED) {
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
// A SUBSET SAYS SO IN ITS OWN SUMMARY (:5199). Without this line "2 mutants ·
// 2 RED" reads exactly like a complete sweep, and a later chat quoting it would
// be reporting coverage nobody ran.
if (only !== null) {
  console.log(
    `SUBSET RUN (MUTATE_ONLY=${[...only].join(',')}) — ${SELECTED.length} of ${MUTANTS.length} mutants. ` +
    `THIS IS NOT A FULL SWEEP; do not quote it as one.`,
  );
}
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
