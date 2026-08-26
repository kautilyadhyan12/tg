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
    from: "  return errorStatus(err) !== 403;",
    to: "  return true;",
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
    from: "  return errorStatus(err) !== 403;",
    to: "  return true;",
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
    // is re-measured RED rather than assumed. **C81 is its neighbour on the same
    // line and they guard different things** — this one that the ORG TYPE
    // reaches the panel, C81 that the panel is thrown away when the gym changes.
    from: '<StaffPanel key={org.id} gymId={org.id} privileges={privileges} orgType={org.orgType} />',
    to: '<StaffPanel key={org.id} gymId={org.id} privileges={privileges} />',
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
    from: "  const readOnly = person.role === 'owner';",
    to: '  const readOnly = false;',
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
    from: '    if (problem !== null || patch === null || saving) return;',
    to: '    if (problem !== null || patch === null) return;',
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
    from: '      {canEditGym ? <GymDetailsPanel key={org.id} org={org} privileges={privileges} /> : null}',
    to: '      {canEditGym ? <GymDetailsPanel org={org} privileges={privileges} /> : null}',
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
    from: '        <StaffPanel key={org.id} gymId={org.id} privileges={privileges} orgType={org.orgType} />',
    to: '        <StaffPanel gymId={org.id} privileges={privileges} orgType={org.orgType} />',
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
