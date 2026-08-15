// RENDER tests for the XP/level display and the Dashboard's old-backend figures.
//
// WHY THIS FILE EXISTS (round 4 F1). The protection for this card was, for four
// T3 rounds, a battery of regexes reading source TEXT in gamificationApi.test.js.
// It was defeated ten times. Every bypass was an ordinary-looking edit:
//
//   round 2  `{xp ? xp.level : 1}`            — a spelling the pattern missed
//   round 3  a string containing `/*`         — the comment-stripper ate the file
//            and the negative assertions passed VACUOUSLY
//   round 3  a component receiving `xp` as a PROP — never in the scanned set
//   round 3  `toMatch(/oldReady/)`            — a presence check one surviving
//            use satisfied for a whole file
//   round 3  literal 0x08 bytes for `\b`      — regexes that could never match
//   round 4  `const { level = 1 } = xp ?? {}` — a destructure has no `.` or `[`
//   round 4  a contradiction appended to the regex — no positive control existed
//   round 4  `if (oldFailed) return null`     — an arbitrary new boolean name
//   round 4  poison moved BELOW the last helper call — the anchor never fired
//
// The pattern is not that the regexes were bad. It is that source text has
// unbounded spellings for the same rendered output, so the guard can only ever
// enumerate the attacks someone already thought of. These tests assert on the
// RENDERED DOM instead, which has exactly one question: did a number nobody
// knows reach the screen? Every bypass above fails here, and so does the
// eleventh nobody has thought of — that is the whole point of the change.
//
// The source guard STAYS (it is cheap, and it catches re-introductions at the
// spelling level early), but it is no longer the protection of record.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Only the NETWORK functions are mocked. readXpView / readStatsView /
// readOverviewView / orUnknown / formatLevel — every piece of logic that decides
// whether a number is knowable — is the REAL implementation, because that logic
// is precisely what is under test. Mocking the whole module would test the mock.
vi.mock('../api/gamificationApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    gamificationService: {
      getMe:          vi.fn(),
      getOverview:    vi.fn(),
      getBadges:      vi.fn(),
      getLeaderboard: vi.fn(),
    },
  };
});
vi.mock('../api/workoutApi', () => ({
  workoutService: { getHistory: vi.fn(), getSummary: vi.fn() },
}));
// The Dashboard's figures moved off the old backend's single `getStats`
// envelope onto three new-API reads. Mocking the NETWORK functions only, as
// above: `readDashboardOverview` / `readWeekActivity` / `readRecentWorkouts`
// are the real implementations, because deciding whether a number is knowable
// is precisely what is under test.
vi.mock('../api/progressApi', () => ({
  progressService: { getOverview: vi.fn(), getCaloriesTrend: vi.fn() },
}));
// PostWorkout re-kicks the offline sync queue while it waits for a workout to
// reach the server (the 404-retry path). Mocked so these tests never depend on
// VITE_API_URL or on axios — the retry BEHAVIOUR is asserted through
// getSummary's call count, which is the observable that matters.
vi.mock('../sync/syncClient', () => ({
  flushSyncQueue: vi.fn(() => Promise.resolve()),
  // Defaults to TRUE — "this browser is still waiting to send this workout" —
  // because that is the state the retry path exists for. The test that proves a
  // STRANGER'S link does not get the waiting treatment overrides it to false.
  isAwaitingSync: vi.fn(() => true),
}));
// PostWorkout imports both at module scope. html2canvas touches canvas APIs
// jsdom does not implement, and the toast is a side effect, not a claim under
// test — neither is exercised by any assertion below.
vi.mock('html2canvas', () => ({ default: vi.fn() }));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../api/recommendationApi', () => ({
  recommendationService: { getRecommendations: vi.fn() },
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { displayName: 'Kd Test' } }),
}));
vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (fn) => fn() }),
}));

const { gamificationService } = await import('../api/gamificationApi');
const { workoutService }      = await import('../api/workoutApi');
const { progressService }     = await import('../api/progressApi');
// The REAL tint ladder, not a copy of its value: an assertion that hard-codes
// the colour string passes just as happily against a second, drifted ladder.
const { FORM_NEUTRAL }        = await import('../api/workoutHistory');
const { isAwaitingSync, flushSyncQueue } = await import('../sync/syncClient');
const { recommendationService } = await import('../api/recommendationApi');
// The toast is normally a side effect and not a claim under test (see the mock
// above) — but for the empty-200 case it IS the claim: the page's only honest
// response to "the summary did not arrive" is to say so, and today it says
// nothing at all. So this one assertion needs the mock's call log.
const toast = (await import('react-hot-toast')).default;

const Dashboard         = (await import('./Dashboard')).default;
const Achievements      = (await import('./Achievements')).default;
const GamificationStrip = (await import('../components/dashboard/GamificationStrip')).default;
const PostWorkout       = (await import('./PostWorkout')).default;
const Sidebar           = (await import('../components/common/Sidebar')).default;

/** A real /v1/gamification/me `xp` block. Level THREE deliberately: "Level 1" is
 *  the fabricated value this whole card exists to delete, so it must never be
 *  the same string as the true one, or a passing test proves nothing. */
/** CORRECTED 2026-07-27 (PostWorkout T3, F6): this block was labelled "a real
 *  /v1/gamification/me xp block" and was not one. `xpForNext: 248` is LEVEL 2's
 *  span; at level 3 the server sends 374, because xpForLevel(3)=348 and
 *  xpForLevel(4)=722 (xp.ts `xpProgress`, and DECISIONS' own "levels cost 100,
 *  248, 374"). progressPct and nextLevelAt were wrong with it. Recomputed from
 *  the real functions for total 578: 578−348 = 230 in level, span 374,
 *  round(230/374*100*10)/10 = 61.5, next at 722.
 *
 *  **THE CORROBORATION THIS COMMENT ORIGINALLY CITED WAS ITSELF WRONG** (T3
 *  round 2). It said `gamificationApi.test.js`'s fixture "already carried the
 *  right shape". That fixture is `total: 330, level: 3, xpInLevel: 52` — and
 *  330 is LEVEL 2 on this curve, since xpForLevel(3) = 348. It is an impossible
 *  block of exactly the class this correction deletes; two of its six fields
 *  happening to match is coincidence, not corroboration. Fixing the class
 *  stopped at the file this card had open. That fixture is NOT corrected here
 *  (different card's file, R1.1) — it is on OWED. */
const XP_LEVEL_3 = {
  xp: {
    level: 3, total: 578, xpInLevel: 230, xpForNext: 374,
    progressPct: 61.5, nextLevelAt: 722,
  },
};

const DEAD = () => Promise.reject(new Error('ECONNREFUSED'));
/** Accepts the connection and never answers — mlApi sets no timeout, so this is
 *  a PERMANENT state, not a transient one. Round 4 F7's scenario. */
const HANGS = () => new Promise(() => {});

const renderPage = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** The Dashboard's THREE reads, all failing. Named because every test below
 *  that is about one of them still has to say what the other two did — three
 *  independent requests is the whole reason round 7 F1 exists, so a helper that
 *  hid them would be hiding the thing under test. */
const dashboardDead = () => {
  progressService.getOverview.mockImplementation(DEAD);
  progressService.getCaloriesTrend.mockImplementation(DEAD);
  workoutService.getHistory.mockImplementation(DEAD);
};
/** `GET /v1/progress/overview?period=all`. Fields omitted on purpose stay
 *  omitted — these fixtures exist to prove an absent field does not become 0. */
const overviewOk = (body) => progressService.getOverview.mockResolvedValue({ data: body });
/** `GET /v1/progress/trend?period=7d`. The endpoint returns ONLY days that have
 *  workouts, so a day absent from `points` is a real zero. */
const weekOk = (points, limitedToDays = null) =>
  progressService.getCaloriesTrend.mockResolvedValue({ data: { points, limitedToDays } });
/** `GET /v1/workouts?limit=6`. */
const historyOk = (items) =>
  workoutService.getHistory.mockResolvedValue({ data: { items, nextCursor: null, limitedToDays: null } });
/** A schema-valid `workoutListItemSchema` row. Every field the contract
 *  requires is present, so a test that omits one is omitting it deliberately —
 *  and if a field NAME moves in `@app/shared`, the rows stop reading and the
 *  Recent Workouts assertions go red rather than silently drawing dashes. */
const listRow = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  startedAt: '2026-07-25T10:00:00Z',
  platform: 'web', setsCount: 2, totalReps: 20,
  avgFormScore: 88, durationMs: 187_000, kcalPoint: 42,
  kcalCalcVersion: 3, qualityFlags: [],
  ...over,
});

/** ROUND 8 F6 — the instruments the dash FLOORS are replaced by.
 *
 *  `getAllByText('—').length >= 3` is a floor with slack: five sites render the
 *  dash in the old-backend-dead fixture, so any TWO of them could start printing
 *  a fabricated number and the count still passed. The reviewer proved it by
 *  reintroducing `?? 0` at four render sites — Total Workouts, Calories Burned,
 *  This week and Your Rank — with all 75 tests green. MUT-21 is round 4 F2
 *  verbatim ("0 workouts / 0h / 0 kcal printed as fact"), i.e. the exact defect
 *  this card exists to delete, alive again and invisible.
 *
 *  A count cannot say WHICH site went numeric. These name the site.
 *
 *  `getByText` THROWS when its anchor is absent or ambiguous, so neither helper
 *  can pass vacuously: deleting a stat card fails the test that reads it, which
 *  is the "a vanishing site is still caught" half of the DECISIONS 2026-07-28
 *  ruling on floors (identity + an exact count, at PostWorkout's share card). */
/** Dashboard's LOCAL StatCard renders value → label → sub as siblings, so the
 *  label is the anchor and the value is the node before it. */
const statValue = (label) => screen.getByText(label).previousElementSibling.textContent;
/** The three tiles in the Experience Points card render only value → sub: their
 *  `label` is the React key and never reaches the DOM, so the SUB is the anchor. */
const tileValue = (sub) => screen.getByText(sub).previousElementSibling.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  recommendationService.getRecommendations.mockImplementation(DEAD);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
/** ROUND 8 F1 — the consumer where the ORIGINAL bug lived, mounted by no test.
 *
 *  `user?.level || 1` in Sidebar rendered a fabricated "Level 1" for every user
 *  on this branch; deleting it is why this card exists. It then survived every
 *  protection the card built, for two independent reasons, and each was a claim
 *  the repo made and did not hold:
 *
 *    · the source guard's FIELD_READ requires a `.` or `[` after `xp`, and
 *      `(xp ?? { level: 1 }).level` has neither — documented bypass #6;
 *    · this file imported Dashboard, Achievements, GamificationStrip and
 *      PostWorkout. NOT Sidebar. The one component the card was opened for had
 *      zero DOM coverage, so MUT-28 reintroduced the fabrication with all 75
 *      tests green.
 *
 *  Sidebar needs no new fixture: useAuth, useTransition and the router are
 *  already mocked or provided at the top of this file, and useXp is the REAL
 *  hook reading the mocked gamificationService. */
describe('Sidebar — where the original bug lived — round 8 F1', () => {
  it('XP read fails: no level is invented in the shell', async () => {
    gamificationService.getMe.mockImplementation(DEAD);

    const { container } = renderPage(<Sidebar />);

    // Waiting on the dash rather than on a static node also lets the failed
    // read settle before the sweep runs.
    await waitFor(() => expect(screen.getByText('Level —')).toBeTruthy());

    // WHOLE-DOCUMENT, and BOTH spellings. The user card prints the level twice
    // — "Level {…}" in the flame row and a compact "L{…}" badge beside it — so
    // asserting one of them leaves the other free to fabricate.
    const text = container.textContent;
    expect(text).not.toMatch(/Level\s*\d/);
    expect(text).not.toMatch(/\bL\d/);
  });

  it('XP ready: the sidebar prints the TRUE level, at both sites', async () => {
    // THE POSITIVE CONTROL. Without it, a Sidebar that renders no level at all
    // — or whose user card was deleted outright — satisfies the test above
    // completely, and the protection becomes an assertion that cannot fail.
    // That is rounds 6 F11 and 7 F3's defect class, and Round A's F5 needed
    // exactly this control for the same reason (DECISIONS 2026-07-29).
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });

    renderPage(<Sidebar />);

    await waitFor(() => expect(screen.getByText('Level 3')).toBeTruthy());
    expect(screen.getByText('L3')).toBeTruthy();
    expect(screen.queryByText(/Level 1\b/)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Dashboard — a real level never sits beside fabricated figures', () => {
  it('every stats read DEAD, XP ready: shows the true level and dashes for the rest', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    dashboardDead();

    const { container } = renderPage(<Dashboard />);

    // The true level, from the new API.
    await waitFor(() => expect(screen.getAllByText(/Level 3/).length).toBeGreaterThan(0));

    // THE HEADLINE ASSERTION. Round 4 F2's mutation restored "Level 1 / 0 XP
    // earned" on the stat card via a destructure; it passed the source guard.
    // It cannot pass this.
    expect(screen.queryByText(/Level 1\b/)).toBeNull();
    expect(screen.queryByText(/0 XP earned/)).toBeNull();

    // Every figure is UNKNOWN, not zero.
    expect(screen.queryByText(/0 minutes/)).toBeNull();
    expect(screen.queryByText(/0 of 7 days active/)).toBeNull();
    expect(screen.getByText('Weekly activity unavailable')).toBeTruthy();

    // ROUND 8 F6: every dash site named, not counted. See statValue/tileValue.
    expect(statValue('Total Workouts')).toBe('—');
    expect(statValue('Hours Trained')).toBe('—');
    expect(statValue('Calories Burned')).toBe('—');
    expect(tileValue('workouts')).toBe('—');
    expect(tileValue('days')).toBe('—');
    // ROUND 9 F2 — the tile Round B missed. There are THREE tiles and its two
    // assertions covered two of them, so `Level` — an XP site, on the page this
    // card is about — was named by nothing. `value: xp ? formatLevel(xp) : '1'`
    // then beat all three protections at once: FIELD_READ sees no field read,
    // HELPER_CALL is satisfied because formatLevel is still called on the known
    // branch, and no render assertion read the tile. Round 8 F1's shape exactly,
    // one component over, in the file Round B was rewriting. Here XP is READY,
    // so this is the positive control; the unknown case is asserted below.
    expect(tileValue('current')).toBe('3');

    // …and a whole-document sweep, because identity assertions can only cover
    // the sites someone thought of. With the old backend dead NO old-backend
    // figure is knowable, so a bare zero anywhere on this page is a
    // fabrication — including at a site added tomorrow.
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it('a 200 carrying an EMPTY BODY still shows dashes — round 4 F2', async () => {
    // F2's payload, repointed: the response ARRIVED and carries none of the
    // fields. The old shape was `{stats:{}}` behind a `Boolean(stats.stats)`
    // envelope gate; the new one has no envelope at all, which is the point —
    // there is nothing left for a gate to be wrong about, and the only way a
    // zero reaches the screen now is somebody writing `?? 0` on purpose.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({});
    // The week read is a SEPARATE request and is still dead here, so the strip
    // must still say so — an arrived overview may not vouch for it.
    progressService.getCaloriesTrend.mockImplementation(DEAD);
    workoutService.getHistory.mockImplementation(DEAD);

    const { container } = renderPage(<Dashboard />);

    await waitFor(() => expect(screen.getAllByText(/Level 3/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/0 minutes/)).toBeNull();
    expect(screen.queryByText(/0 of 7 days active/)).toBeNull();
    await waitFor(() => expect(screen.getByText('Weekly activity unavailable')).toBeTruthy());

    // ROUND 8 F6, and this fixture is where it bites hardest: the response
    // arrived, so a `?? 0` on any absent field reads as a real server zero.
    expect(statValue('Total Workouts')).toBe('—');
    expect(statValue('Hours Trained')).toBe('—');
    expect(statValue('Calories Burned')).toBe('—');
    expect(tileValue('workouts')).toBe('—');
    expect(tileValue('days')).toBe('—');
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it('a PARTIAL 200 fabricates nothing for the missing fields', async () => {
    // `totalDurationMs` and `totalKcal` absent — the subset case F2 called out,
    // in the new payload's spelling.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 12 });
    weekOk([]); // the week ARRIVED and is genuinely empty
    workoutService.getHistory.mockImplementation(DEAD);

    renderPage(<Dashboard />);

    // An arrived-but-empty week is a real zero, not an unknown — that
    // distinction is the whole of round 4 F3 and it survives the repoint.
    // (The stat number itself is not asserted here: StatCard animates it from 0
    // via requestAnimationFrame, so its intermediate value is a timing
    // artefact, not a claim.)
    await waitFor(() => expect(screen.getByText('0 of 7 days active')).toBeTruthy());
    // The two ABSENT fields must NOT have become zeros.
    expect(screen.queryByText(/0 minutes/)).toBeNull();
    expect(screen.getByText(/kcal ·/)).toBeTruthy();

    // ROUND 8 F6, by identity. NO whole-document zero sweep in THIS test: the
    // known `totalWorkouts: 12` is a number, so StatCard animates it from 0
    // and a bare "0" is a legitimate frame of that sweep, not a fabrication.
    // The absent fields are strings ('—') and never animate.
    expect(statValue('Hours Trained')).toBe('—');
    expect(statValue('Calories Burned')).toBe('—');
    // THE STREAK is absent from this payload and must stay unknown, while the
    // week's count beside it is a KNOWN zero from a different read. Two tiles,
    // two sources, and only one of them is entitled to print a number — the
    // exact confusion round 5 F8 was about.
    expect(tileValue('days')).toBe('—');
    // THE CONTROL, and it is the one that stops "everything is a dash" from
    // passing: a field the server DID send still renders its real value. The
    // tiles render {value} directly, so unlike StatCard there is no animation
    // to race here.
    expect(tileValue('workouts')).toBe('0');
  });

  it('asks the server for the windows the screen claims', async () => {
    // FOUND BY THE MUTATION AUDIT, and nothing else here could see it. Every
    // fixture mocks the network functions, so they answer identically whatever
    // they are ASKED — a page requesting `period=30d` and captioning the answer
    // "all time" passes every other test in this file while printing a 30-day
    // total as a lifetime one. The argument IS the claim: these three calls are
    // the only thing making "all time", "of 7 days" and six rows true.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 1 });
    weekOk([]);
    historyOk([]);

    renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('No workouts logged yet.')).toBeTruthy());

    expect(progressService.getOverview).toHaveBeenCalledWith('all');
    expect(progressService.getCaloriesTrend).toHaveBeenCalledWith('7d');
    expect(workoutService.getHistory).toHaveBeenCalledWith({ limit: 6 });
  });

  it('a plan-limited total is NOT captioned "all time"', async () => {
    // DECISIONS :598's defect on the first screen a user sees. `period=all` is
    // unbounded, so a 90-day plan floor cuts it EVERY time and the server says
    // so in `limitedToDays` — which the page ignored before this card, printing
    // a 90-day total under the words "all time".
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 12, totalKcal: 900, totalDurationMs: 3_930_000, limitedToDays: 90 });
    weekOk([]);
    workoutService.getHistory.mockImplementation(DEAD);

    renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText(/last 90 days/).length).toBeGreaterThan(0));
    // All THREE tiles name the same window — one label, so a gated user cannot
    // read the truth on one tile and "all time" on the next.
    expect(screen.getAllByText(/last 90 days/).length).toBe(3);
    expect(screen.queryByText('all time')).toBeNull();
  });

  it('an UNLIMITED plan still reads "all time" — the control', async () => {
    // Without this, "never say all time" would pass and the caption would be
    // wrong in the other direction for every paying user.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 12, totalKcal: 900, totalDurationMs: 3_930_000, limitedToDays: null });
    weekOk([]);
    workoutService.getHistory.mockImplementation(DEAD);

    renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText(/all time/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/last 90 days/)).toBeNull();
    // …and the hours tile carries its own minutes figure beside it, derived
    // from the MILLISECONDS rather than chained through the rounded minutes.
    // The big number itself is NOT asserted here: `AnimatedNumber` renders
    // `Math.floor(ease * value)`, so a fractional hours figure is both animated
    // and floored on its way to the DOM. That is pre-existing and out of this
    // card (R1.1) — it has its own OWED line — but it is why this assertion
    // reads the sub-line, which is a string and never animates.
    expect(screen.getByText(/66 minutes/)).toBeTruthy();
  });

  it('XP read fails too: no level is invented anywhere', async () => {
    gamificationService.getMe.mockImplementation(DEAD);
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    dashboardDead();

    const { container } = renderPage(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/Weekly activity/)).toBeTruthy());
    expect(screen.queryByText(/Level 1\b/)).toBeNull();
    expect(screen.queryByText(/0 XP earned/)).toBeNull();
    expect(screen.queryByText(/\/100 XP/)).toBeNull(); // the hardcoded-100 curve

    // WHOLE-DOCUMENT sweep, not a per-element query. `getByText` matches one
    // element's own text, so a fabrication INTERPOLATED into a longer string
    // ("Level 1 · 0 XP · Weekly activity unavailable") slips past every query
    // above — which is exactly how round 4's strip-eating mutation (d) behaved:
    // it turned the assertions red only incidentally, by breaking up text they
    // were matching on. With nothing known, no level and no XP total may appear
    // anywhere on the page, however it was spelled or concatenated.
    const text = container.textContent;
    expect(text).not.toMatch(/Level\s*\d/);
    expect(text).not.toMatch(/\d[\d,]*\s*XP/);
    // ROUND 9 F2, the unknown half: the Level tile must dash like its two
    // siblings. `xp ? formatLevel(xp) : '1'` renders "1" here and was green.
    expect(tileValue('current')).toBe('—');
  });

  it('a recent workout with no numbers fabricates nothing — round 5 F3', async () => {
    // The list was passed through unparsed and three sites then rendered
    // `|| 0`: "0 min · 0 kcal · 0% form", with the unknown accuracy painted RED
    // by the <60 branch. The payload is `/v1/workouts` now and its three
    // nullable fields are nullable IN THE CONTRACT (`workoutListItemSchema`),
    // so this is the shape a real server sends for a hand-counted workout, not
    // a hypothetical.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 3 });
    weekOk([]);
    historyOk([listRow({ durationMs: null, kcalPoint: null, avgFormScore: null })]);

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Workout Session')).toBeTruthy());

    const text = container.textContent;
    expect(text).not.toMatch(/0 kcal/);
    expect(text).not.toMatch(/0% form/);
    expect(text).not.toMatch(/0m 0s/);
    expect(text).toMatch(/— kcal/);
    expect(text).toMatch(/— form/);
    // THE TINT, which is the half round 5 F3 was actually about: an unknown
    // score must be neutral, never the <60 red. Asserted on the element rather
    // than on the text, because the text was already right when the colour was
    // not.
    const formLine = screen.getByText(/— form/);
    // Whitespace-normalised on BOTH sides: jsdom re-serialises `rgba(a,b,c,d)`
    // with spaces after the commas, so a raw `toBe` compares the browser's
    // spelling against the source's and fails on a colour that is identical.
    const noSpace = (s) => s.replace(/\s+/g, '');
    expect(noSpace(formLine.style.color)).toBe(noSpace(FORM_NEUTRAL));
  });

  it('a recent workout renders its REAL numbers — the positive control', async () => {
    // Without this, every assertion above is satisfied by a pane that renders
    // dashes unconditionally. It also pins the unit: 187,000 ms is 3m 7s, and
    // the defect this replaces (:4182) printed exactly this shape of value as
    // "3 min" — or, at 8,491 ms, as "0 min".
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 3 });
    weekOk([]);
    historyOk([listRow()]);

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Workout Session')).toBeTruthy());

    const text = container.textContent;
    expect(text).toMatch(/3m 7s/);
    expect(text).toMatch(/42 kcal/);
    expect(text).toMatch(/88% form/);
    expect(text).not.toMatch(/3 min/);
  });

  it('a page of rows it cannot read is UNAVAILABLE, never "no workouts" — :5104 F4', async () => {
    // Two true statements — a page arrived; not one row could be drawn —
    // composed into a false claim about a user's history. The empty-list arm
    // says "No workouts logged yet.", which is a definite denial.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 3 });
    weekOk([]);
    historyOk([{ nope: true }, { id: 'not-a-row' }]);

    renderPage(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText('Recent workouts are unavailable right now.')).toBeTruthy());
    expect(screen.queryByText('No workouts logged yet.')).toBeNull();
  });

  it('a GENUINELY empty history says so — the other side of the same control', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 0 });
    weekOk([]);
    historyOk([]);

    renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('No workouts logged yet.')).toBeTruthy());
    expect(screen.queryByText('Recent workouts are unavailable right now.')).toBeNull();
  });

  it('the week caption and the dots agree — round 5 F8', async () => {
    // A known session count beside an unknown week used to print "3 of 7 days
    // active" over seven dashed UNKNOWN dots. After the repoint the count and
    // the dots have ONE source, so the two can no longer be separately known —
    // this test now proves that property rather than policing two fields, and
    // a 200 that is not a trend at all is the way to reach the unknown arm.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 3 });
    progressService.getCaloriesTrend.mockResolvedValue({ data: { limitedToDays: null } }); // no `points`
    workoutService.getHistory.mockImplementation(DEAD);

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Weekly activity unavailable')).toBeTruthy());
    expect(screen.queryByText(/of 7 days active/)).toBeNull();
    expect(container.querySelectorAll('[title="Activity unavailable"]').length).toBe(7);
    // The TILE must go unknown with them. It reads the same map, so a number
    // here beside "unavailable" there would be the two-standards defect with
    // the sources merged — which is precisely what merging them prevents.
    expect(tileValue('workouts')).toBe('—');
  });

  it('activity known but the COUNT unknown: the caption denies nothing — round 9 F4', async () => {
    // The other direction of round 5 F8, which that round's text named and its
    // test never entered. The caption required `weekState === 'ready' && count
    // !== null`; the dots require the state alone. So a payload with `activity`
    // and no `weekly_workouts` lit seven DEFINITE dots — a flame on a day the
    // user really trained — under "Weekly activity unavailable". Measured by the
    // round 9 reviewer: 4 flames, 0 unavailable tooltips, caption claiming a
    // failed read. The dots were right and the caption was wrong.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 3 });
    weekOk([]); // the week ARRIVED and is genuinely empty
    workoutService.getHistory.mockImplementation(DEAD);

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText(/Level 3/).length).toBeGreaterThan(0));

    // The week ARRIVED, so nothing may claim it did not.
    expect(screen.queryByText('Weekly activity unavailable')).toBeNull();
    expect(container.querySelectorAll('[title="Activity unavailable"]').length).toBe(0);
    // ROUND 10 F1 changed what "the count" means here, and the repoint makes it
    // structural: a week that ARRIVED and is empty is a GENUINE zero — a fact
    // the server sent, not a fabrication. Unknown now has exactly one home, the
    // arm above ("Weekly activity unavailable"), which is the honest place for
    // it once every number on this card comes off the one map the dots draw.
    expect(screen.getByText('0 of 7 days active')).toBeTruthy();
    expect(screen.queryByText(/\bnull of 7\b/)).toBeNull();
    expect(screen.queryByText(/undefined of 7/)).toBeNull();
  });

  it('the caption counts the SAME days the dots light — round 10 F1', async () => {
    // The old defect was TWO measurements: a count of SESSIONS since Monday
    // beside a picture keyed by DAY over a rolling seven days, so two sessions
    // on one day read "5 of 7 days active" over three flames, and past seven
    // sessions "10 of 7 days active", which cannot be true. Both numbers now
    // come off one response's day buckets — so this test's job changes from
    // policing two fields to proving the derivation: WORKOUTS and DAYS are
    // different numbers off the same map, and only the days reach the caption.
    //
    // ROUND 11 F4 — THE COMMENT THAT STOOD HERE OVERCLAIMED AND IS CORRECTED.
    // It said the fixture "cannot make this test agree with itself" because the
    // dates are computed here rather than imported. That was only true of a
    // DIFFERENTLY wrong helper: the fixture re-implemented the helper's
    // algorithm, `toISOString` included, so a helper wrong in the SAME way was
    // invisible to it — round 11 proved it, and the unit tests caught what this
    // one could not. THE FIXTURE IS NOW BUILT THE OTHER WAY ROUND: local
    // `getFullYear/getMonth/getDate`, which is what the SERVER's day bucketing
    // produces and what `weekOfDates` must therefore agree with. If the helper
    // regressed to a UTC key, these keys would stop matching for part of every
    // day in any non-UTC zone rather than never — still not a substitute for
    // the pinned-clock unit tests, and no longer the same wrong shape.
    const t = new Date();
    const monIdx = (t.getDay() + 6) % 7;
    const pad2 = (n) => String(n).padStart(2, '0');
    const localKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const dayKey = (offset) => {
      const d = new Date(t);
      d.setDate(t.getDate() - monIdx + offset);
      return localKey(d);
    };
    // ROUND 11: a day OUTSIDE the displayed week. Without it, "count the days in
    // this week" and "count every key in the payload" return the same number
    // for this fixture, so the caption could abandon the Mon-Sun window and
    // nothing would notice — measured, that mutant survived at 93/93. It is
    // round 10 F1's own defect (the caption counting a different set of days
    // than the dots draw) and the fixture, not the assertion, was the hole.
    const lastWeek = (() => {
      const d = new Date(t);
      d.setDate(t.getDate() - monIdx - 3);
      return localKey(d);
    })();

    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 8 });
    weekOk([
      { date: dayKey(0), kcal: 120, workouts: 4 },  // FOUR workouts…
      { date: dayKey(2), kcal: 60, workouts: 1 },   // …on TWO days this week…
      { date: lastWeek, kcal: 90, workouts: 3 },    // …plus a day OUTSIDE the window
    ]);
    workoutService.getHistory.mockImplementation(DEAD);

    renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/of 7 days active/)).toBeTruthy());

    // The WORKOUT count must never be the caption's number. ROUND 11 F2: this
    // runs BEFORE the identity assertions below, because `getByText(
    // `${litDots} of 7 days active`)` THROWS on any other value and therefore
    // dominated it — a check that cannot fail because a stricter one fails
    // first is still a check that cannot fail.
    expect(screen.queryByText('5 of 7 days active')).toBeNull();
    // …nor may it be the count INCLUDING the day outside the window.
    expect(screen.queryByText('3 of 7 days active')).toBeNull();

    // THE INVARIANT, and it is source-independent: whatever the caption says,
    // it must equal what the strip actually DREW.
    const strip = screen.getByText('Mon').closest('.flex.gap-2');
    const litDots = [...strip.querySelectorAll('div')]
      .filter((d) => d.style.background.includes('linear-gradient(135deg')).length;
    expect(litDots).toBe(2);
    expect(screen.getByText(`${litDots} of 7 days active`)).toBeTruthy();

    // ROUND 11 F2: an "impossible sentence" regex (`/([89]|[1-9]\d+) of 7/`)
    // stood here and is DELETED rather than kept as reassurance. Two reasons,
    // and the second is the interesting one: it was dominated by the identity
    // assertion above, AND its producer is now bounded — the caption counts
    // `week.filter(...)` over a SEVEN-element array, so a value above 7 is not
    // reachable by any mutation of the caption. The round 10 fix made the
    // impossibility structural, which retires the assertion written for it.
    // Keeping it would be decoration, which is what rounds 6 F11, 7 F3, 9 F3
    // and this one are all about.
    // The tile counts WORKOUTS — its own label says so — and it counts them
    // over the SAME seven days, so the day outside the window is excluded from
    // both. 4 + 1 = 5, not 8. This pair is what pins the two derivations apart:
    // a mutant that made the tile count days would read 2, and one that dropped
    // the window would read 8.
    expect(tileValue('workouts')).toBe('5');
  });

  it('the week strip claims nothing when activity is unknown — round 4 F3', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    dashboardDead();

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Weekly activity unavailable')).toBeTruthy());

    // Seven dots in their NOT-TRAINED state read as "you trained on none of
    // these days" — seven claims. Unknown gets a dashed outline instead, and
    // no dot may carry the trained fill.
    const dashed = container.querySelectorAll('[title="Activity unavailable"]');
    expect(dashed.length).toBe(7);
    for (const dot of dashed) {
      expect(dot.style.background).not.toContain('linear-gradient');
      expect(dot.style.border).toContain('dashed');
    }
  });

  it('activity IN FLIGHT is never called unavailable — round 8 F3', async () => {
    // WeekStrip and its caption branched on the map being null ALONE, so
    // loading and failed were one answer, and against a hung backend the page
    // claimed a failed read PERMANENTLY — a caption plus seven "Activity
    // unavailable" tooltips during a perfectly healthy in-flight request.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 3 });
    progressService.getCaloriesTrend.mockImplementation(HANGS);
    workoutService.getHistory.mockImplementation(HANGS);

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText(/Level 3/).length).toBeGreaterThan(0));

    // The caption speaks of a load in progress, never of a failure.
    expect(screen.getByText('Loading this week…')).toBeTruthy();
    expect(screen.queryByText('Weekly activity unavailable')).toBeNull();

    // …and so do all seven dots. A loading caption over seven "unavailable"
    // tooltips is round 5 F8's two-standards-eight-inches-apart defect again,
    // which is why the dots take the STATE and not a second null test.
    expect(container.querySelectorAll('[title="Loading activity…"]').length).toBe(7);
    expect(container.querySelectorAll('[title="Activity unavailable"]').length).toBe(0);

    // The sibling pane's own request is also hung, so it says the same thing.
    expect(screen.getByText('Loading recent workouts…')).toBeTruthy();
  });

  it('a SETTLED read is never held hostage by a hung sibling — round 7 F1', async () => {
    // THE FAILURE MODE THE SPLIT INTRODUCES, and the reason each read carries
    // its own flag. Three requests settle independently now: the totals can be
    // known while the week is still in flight. If any state borrowed another
    // read's knowability, the arrived one would be forced to wait — which is
    // round 7 F1 with the sources swapped, and nothing else in this file would
    // have caught it, because before the repoint there was only one request.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    overviewOk({ totalWorkouts: 12, totalKcal: 900, limitedToDays: null });
    progressService.getCaloriesTrend.mockImplementation(HANGS);
    historyOk([]);

    renderPage(<Dashboard />);

    // The history read ARRIVED and is empty, so it says so — while the week
    // beside it is still loading and says THAT.
    await waitFor(() => expect(screen.getByText('No workouts logged yet.')).toBeTruthy());
    expect(screen.getByText('Loading this week…')).toBeTruthy();
    // …and the totals, from a third settled request, are on screen as numbers.
    expect(statValue('Calories Burned')).not.toBe('—');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GamificationStrip — XP renders when the old backend does not', () => {
  it('old backend DEAD, XP ready: XP shows, counts do not fabricate', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<GamificationStrip />);

    await waitFor(() => expect(screen.getByText(/578/)).toBeTruthy());
    expect(screen.getByText(/Level 3/)).toBeTruthy();
    expect(screen.queryByText(/Level 1\b/)).toBeNull();
    // Round 2 ①'s fabrications: "of 0" athletes, "(0/—)" badges.
    expect(screen.queryByText('of 0')).toBeNull();
    expect(screen.queryByText(/\(0\//)).toBeNull();
    expect(screen.getByText(/Challenges are unavailable/)).toBeTruthy();

    // ROUND 8 F6 / MUT-20: `orUnknown(userRank)` reverted to `?? 0` printed a
    // rank of "0" — an athlete's position, fabricated — and every test stayed
    // green. The `of 0` assertion above reads the TOTAL, a different node; the
    // rank is the <p> immediately before it and had nothing on it at all.
    expect(screen.getByText('of —').previousElementSibling.textContent).toBe('—');
  });

  it('old backend HANGS and XP fails: the strip does not vanish forever — F7', async () => {
    // Round 4 F7: with `loading && !xp` this returned null permanently — no
    // dash, no notice, nothing at all — because `!xp` cannot tell "still
    // loading" from "failed" and mlApi never times out.
    gamificationService.getMe.mockImplementation(DEAD);
    gamificationService.getOverview.mockImplementation(HANGS);
    gamificationService.getLeaderboard.mockImplementation(HANGS);

    renderPage(<GamificationStrip />);

    await waitFor(() => expect(screen.getByText('Your Rank')).toBeTruthy());
    expect(screen.queryByText(/Level 1\b/)).toBeNull();
  });

  it('a non-array recommendations field does not blank the page — round 6 F2', async () => {
    // `res.data.recommendations || []` accepted ANY type, and `.slice().map()`
    // then threw. With no ErrorBoundary in apps/web the entire Dashboard went
    // blank — XP header included, i.e. T3 finding ① by a fourth route.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    dashboardDead();
    recommendationService.getRecommendations.mockResolvedValue({
      data: { recommendations: 'oops' },
    });

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText(/Level 3/).length).toBeGreaterThan(0));
    expect(container.textContent.length).toBeGreaterThan(0);
    expect(screen.getByText('Recommendations are unavailable right now.')).toBeTruthy();
  });

  it('a partial recommendation is neutral, not "advanced" — round 6 F3', async () => {
    // The difficulty ternary's final `else` painted an UNKNOWN difficulty red
    // and labelled it advanced; `{ex.calories_per_min}` rendered " kcal/min".
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    dashboardDead();
    recommendationService.getRecommendations.mockResolvedValue({
      data: { recommendations: [{ id: 'r1', name: 'Mystery Move' }] },
    });

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Mystery Move')).toBeTruthy());

    // ROUND 7 F3: an `expect(textContent).not.toMatch(/advanced/i)` stood here
    // and COULD NOT FAIL — the pre-fix pill was a bare `{ex.difficulty}`, which
    // React renders as nothing when undefined, and the literal "advanced"
    // appears nowhere in Dashboard.jsx. The defect was RED AND UNLABELLED, not
    // "advanced". That is round 6 F11's own ruling, violated one screen away in
    // the very commit that issued it — and the false premise then propagated
    // into two source comments, DECISIONS, OWED and the commit message. The
    // colour assertion below is the one that actually caught the live defect
    // when mutation-tested; it is now the only one here.
    expect(container.textContent).toMatch(/— kcal\/min/);
    const pill = screen.getAllByText('—').find((el) => el.className.includes('rounded-full'));
    expect(pill).toBeTruthy();
    expect(pill.style.color).not.toContain('248');   // not the red/hard branch
    expect(pill.style.color).toContain('255, 255, 255');   // the neutral one
  });

  it("a recommendation's pill agrees with itself on difficulty — round 10 F4", async () => {
    // `difficultyStyle` matches BOTH vocabularies (easy/beginner,
    // medium/intermediate); the pill's BACKGROUND ternary knew only
    // beginner/intermediate/null and fell through to the hard RED for anything
    // else. So `difficulty: 'easy'` rendered a GREEN label on a RED pill —
    // measured by round 10: bg rgba(239,68,68,0.25), color rgb(74,222,128).
    // Round 7 F2 routed the FOREGROUND through the shared helper and left the
    // background hand-rolled: one element, two vocabularies.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    dashboardDead();
    recommendationService.getRecommendations.mockResolvedValue({
      data: { recommendations: [{ id: 'r1', name: 'Easy Move', difficulty: 'easy' }] },
    });

    renderPage(<Dashboard />);
    const label = await screen.findByText('easy');

    // Both fields, one resolver: a pill may not disagree with its own label.
    expect(label.style.color).toContain('74, 222, 128');
    expect(label.style.background).toContain('74, 222, 128');
    expect(label.style.background).not.toContain('239, 68, 68');
  });

  it('recommendations IN FLIGHT are never called unavailable — round 7 F1', async () => {
    // `recsState` derived from `loading`, which only the getStats chain sets —
    // so the recommendations read could never move its own state. Stats
    // settling first while recommendations were still in flight printed
    // "Recommendations are unavailable right now.", a false denial during a
    // perfectly healthy load. Round 6 F1's rule, violated by round 6's own
    // three-state work: a state must never borrow another read's knowability.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    // The stats reads SETTLE here; the recommendations one hangs. That is the
    // point of round 7 F1 and it survives the split: a settled sibling must not
    // move the hanging read's state.
    overviewOk({ totalWorkouts: 3 });
    weekOk([]);
    historyOk([]);
    recommendationService.getRecommendations.mockImplementation(HANGS);

    renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Recommended For You')).toBeTruthy());

    expect(screen.queryByText('Recommendations are unavailable right now.')).toBeNull();
    expect(screen.getByText('Loading recommendations…')).toBeTruthy();
  });

  it('a FAILED recommendations read never says Loading forever — round 7 F1', async () => {
    // The mirror image: stats hanging (mlApi sets no timeout, so permanent)
    // with recommendations already failed printed "Loading recommendations…"
    // for ever — round 5 F1's defect, which listState exists to delete.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    // The mirror image: the stats reads HANG and the recommendations one has
    // failed. Round 5 F1's defect was this pane saying "Loading…" forever
    // because it read a state that belonged to another request.
    progressService.getOverview.mockImplementation(HANGS);
    progressService.getCaloriesTrend.mockImplementation(HANGS);
    workoutService.getHistory.mockImplementation(HANGS);
    recommendationService.getRecommendations.mockImplementation(DEAD);

    renderPage(<Dashboard />);
    await waitFor(() =>
      expect(screen.getByText('Recommendations are unavailable right now.')).toBeTruthy());
    expect(screen.queryByText('Loading recommendations…')).toBeNull();
    // And the stats half, genuinely still in flight, must NOT claim failure.
    expect(screen.queryByText('Recent workouts are unavailable right now.')).toBeNull();
  });

  it('an unknown badge tier is neutral in Latest Badges, never bronze — round 8 F5', async () => {
    // The tier ternary's final `else` was '#cd7f32', so a badge with NO tier
    // got a bronze pill and a bronze card edge while the pill printed "—".
    // Probe D of round 8 measured the same badge in both components: bronze
    // here, neutral in Achievements — one badge, two answers.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        // `earned` is present on every element, so earnedBadgeCount answers and
        // recentBadges is non-empty (round 6 F1's rule).
        badges: { all: [{ id: 'b1', name: 'Mystery Badge', earned: true }], total_count: 40 },
        challenges: { active: [] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<GamificationStrip />);
    const name = await screen.findByText('Mystery Badge');

    // The tier pill is the <p> immediately after the name <p> in the same card.
    const pill = name.nextElementSibling;
    expect(pill.textContent).toBe('—');
    expect(pill.style.color).toContain('255, 255, 255');       // neutral grey
    expect(pill.style.color).not.toContain('205, 127, 50');    // NOT bronze

    // The card edge is the second half of the same claim — a bronze border
    // around a dash says "bronze" just as loudly as the text colour does.
    const card = name.closest('.rounded-xl');
    expect(card.style.border).toContain('rgba(255, 255, 255');
    expect(card.style.border).not.toContain('205, 127, 50');
  });

  it('a leaderboard 200 missing its list does not blank the page', async () => {
    // Round 3 F1 / round 2 ③: an unguarded nested read throws in render, and
    // there is no ErrorBoundary in apps/web, so the whole page — XP included —
    // goes blank. A partial payload must degrade, never throw.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({ data: {} });
    gamificationService.getLeaderboard.mockResolvedValue({ data: {} });

    renderPage(<GamificationStrip />);

    await waitFor(() => expect(screen.getByText(/Level 3/)).toBeTruthy());
    expect(screen.queryByText('of 0')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Achievements — the three payloads are independent — round 4 F4', () => {
  const LEADERBOARD = {
    data: {
      leaderboard: [
        { user_id: 'u1', rank: 1, name: 'Asha', level: 7, badge_count: 9, xp: 4100, is_current_user: false },
        { user_id: 'u2', rank: 2, name: 'Kd',   level: 3, badge_count: 2, xp: 578,  is_current_user: true  },
      ],
      total_users: 2,
      current_user_rank: 2,
    },
  };

  it('overview FAILS, leaderboard 200s: the leaderboard is shown, not disclaimed', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockResolvedValue(LEADERBOARD);

    renderPage(<Achievements />);

    await waitFor(() => expect(screen.getByText('Failed to load achievements')).toBeTruthy());

    // The notice must not claim a payload that is sitting in state is missing.
    expect(screen.queryByText(/leaderboard are unavailable/)).toBeNull();
    expect(screen.getByText('Badges and challenges are unavailable right now.')).toBeTruthy();

    // And the tab must be reachable and populated.
    fireEvent.click(screen.getByText('Leaderboard'));
    await waitFor(() => expect(screen.getByText('Asha')).toBeTruthy());
    expect(screen.getByText('2 athletes')).toBeTruthy();
  });

  it('overview 200s, leaderboard FAILS: the tab explains itself, never blank', async () => {
    // The DECISIONS 2026-07-24 P4 dark window — a SCHEDULED state, not an edge
    // case. Previously: a clickable tab that rendered nothing at all.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: { badges: { all: [], total_count: 40 }, challenges: { active: [] } },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('Leaderboard')).toBeTruthy());

    fireEvent.click(screen.getByText('Leaderboard'));
    await waitFor(() =>
      expect(screen.getByText('The leaderboard is unavailable right now.')).toBeTruthy());
    // Not a fabricated athlete count either.
    expect(screen.queryByText('0 athletes')).toBeNull();
  });

  it('a leaderboard entry missing fields renders dashes, not "Lv undefined"', async () => {
    // Round 4 F5: `entry.level` and `entry.badge_count` were read bare, in the
    // same component where round 3 had just guarded `entry.xp`.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockResolvedValue({
      data: { leaderboard: [{ name: 'Partial' }], total_users: 1 },
    });

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('Leaderboard')).toBeTruthy());
    fireEvent.click(screen.getByText('Leaderboard'));

    await waitFor(() => expect(screen.getByText('Partial')).toBeTruthy());
    // ROUND 6 F11: this used to assert `queryByText(/undefined/)` is null,
    // which CANNOT FAIL for a bare `{expr}` — React renders undefined as
    // nothing, so the pre-fix output was "Lv  ·  badges", never
    // "Lv undefined". The assertion was vacuous by construction for exactly
    // the class it claimed to guard. Assert the DASHES that must be there.
    expect(screen.getByText(/Lv — · — badges/)).toBeTruthy();
    expect(screen.queryByText(/Lv 0\b/)).toBeNull();
  });

  it('the XP header survives a total old-backend failure', async () => {
    // T3 ①, the defect that started this card: the header read the NEW API and
    // was taken down by the OLD one's early return.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<Achievements />);

    await waitFor(() => expect(screen.getByText(/Level 3/)).toBeTruthy());
    expect(screen.getByText(/578/)).toBeTruthy();
    expect(screen.queryByText(/Level 1\b/)).toBeNull();
  });

  it('the XP read fails TOO: the header invents nothing — round 8 F2', async () => {
    // Every other test in this block resolves getMe with XP_LEVEL_3 — 13 of 13,
    // counted, not recalled — so formatLevel, formatXpTotal, formatXpFraction,
    // formatNextLevel and xpBarWidth were only ever exercised ON THIS PAGE with
    // a KNOWN block. Dashboard, GamificationStrip and PostWorkout each have an
    // XP-fails fixture; Achievements had none, and MUT-34 — the same
    // destructure that defeats FIELD_READ — rendered "Level 1" in this header
    // with all 75 tests green. The test above is its control: same page, same
    // failed old backend, XP known.
    gamificationService.getMe.mockImplementation(DEAD);
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    const { container } = renderPage(<Achievements />);
    await waitFor(() =>
      expect(screen.getByText('Failed to load achievements')).toBeTruthy());

    // WHOLE-DOCUMENT, matching the Dashboard's XP-fails test: a fabrication
    // interpolated into a longer string slips past every per-element query,
    // which is exactly how round 4's strip-eating mutation behaved.
    const text = container.textContent;
    expect(text).not.toMatch(/Level\s*\d/);

    // ROUND 9 F3 — **THE ASSERTION THAT STOOD HERE COULD NOT FAIL, and it was
    // mine.** It was `not.toMatch(/\d[\d,]*\s*XP/)`, copied from the Dashboard's
    // XP-fails test where the markup is `{formatXpFraction(xp)} XP` — digits
    // ADJACENT to "XP". This page spells it `{formatXpTotal(xp)} total XP`
    // (Achievements.jsx:512), so a digit can never sit next to "XP" at that
    // site, and with all three reads dead no badge card renders either — the
    // page's only other producer of an adjacent form. The regex had no
    // reachable producer here. Round 9 proved it: a fabricated `0 total XP`
    // AND a plausible `578 total XP` both left the suite green, while the same
    // fabrication where adjacency does hold turned it red. That is round 6
    // F11's ruling — an assertion whose stated failure mode the code cannot
    // produce is vacuous — violated in the commit whose record cites it twice.
    //
    // Identity instead, the instrument this card already chose for the floors.
    // The whole line is asserted, so the badge counts beside the total are
    // covered by the same read.
    const xpLine = screen.getByText(/total XP/).textContent.replace(/\s+/g, ' ').trim();
    expect(xpLine).toBe('— total XP · — of — badges');

    // The positive half: the header still RENDERS, as dashes. Without these a
    // header deleted outright would satisfy the sweep above.
    expect(text).toMatch(/—\/—/);
    expect(text).toMatch(/XP to Lv —/);
  });

  // ── ROUND 5 ────────────────────────────────────────────────────────────────
  // These enter states the round-4 fixtures never did: every list fixture was
  // `all: []` / `active: []`, so BadgeCard and ChallengeCard never rendered and
  // F2's boolean default survived a whole round.
  it('envelope 200s with no lists: tabs say unavailable, never "Loading" forever — F1', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({ data: {} });
    gamificationService.getLeaderboard.mockResolvedValue({ data: {} });

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText(/Level 3/)).toBeTruthy());

    // Both promises have SETTLED. Branching on the envelope put this case in
    // neither arm, so all three tabs claimed "Loading…" permanently.
    await waitFor(() =>
      expect(screen.getByText('Badges are unavailable right now.')).toBeTruthy());
    expect(screen.queryByText('Loading badges…')).toBeNull();

    fireEvent.click(screen.getByText('Challenges'));
    await waitFor(() =>
      expect(screen.getByText('Challenges are unavailable right now.')).toBeTruthy());
    expect(screen.queryByText('Loading challenges…')).toBeNull();

    fireEvent.click(screen.getByText('Leaderboard'));
    await waitFor(() =>
      expect(screen.getByText('The leaderboard is unavailable right now.')).toBeTruthy());
    expect(screen.queryByText('Loading the leaderboard…')).toBeNull();
  });

  it('a catalog that ARRIVED is never called unavailable — round 6 F1', async () => {
    // listState(oldState, earnedCount !== null) used the COUNT's knowability as
    // the LIST's, so a catalog that arrived and is on screen was classified as
    // a failed read: "Badges are unavailable right now." printed directly above
    // two rendered badge cards. Round 5's F2 fixture entered this exact state
    // and asserted nothing about the notice, so it shipped green.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        badges: {
          all: [{ id: 'b1', name: 'First Rep', tier: 'bronze', category: 'milestones', xp_reward: 10 }],
          total_count: 40,
        },
        challenges: { active: [] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('First Rep')).toBeTruthy());
    // The badge is VISIBLE, so the page may not say the badges are missing.
    expect(screen.queryByText('Badges are unavailable right now.')).toBeNull();
    expect(screen.queryByText('Loading badges…')).toBeNull();
  });

  it('a catalog with no `earned` field claims no count — F2', async () => {
    // `earned: b?.earned === true` turned unknown into "not earned", which fed
    // the count: "0 of 40 badges", "Badges (0)", and "earn your first badge"
    // shown to a user who has badges.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        badges: {
          all: [
            { id: 'b1', name: 'First Rep', tier: 'bronze', category: 'milestones', xp_reward: 10 },
            { id: 'b2', name: 'Week One', tier: 'silver', category: 'streaks', xp_reward: 25 },
          ],
          total_count: 40,
        },
        challenges: { active: [] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('First Rep')).toBeTruthy());

    expect(screen.queryByText(/0 of 40 badges/)).toBeNull();
    expect(screen.getByText(new RegExp(`— of 40 badges`))).toBeTruthy();
    // And the padlock must not appear: "locked" is a claim about an unknown.
    expect(screen.getAllByTitle('Earned state unavailable')).toHaveLength(2);
  });

  it('a fully-specified catalog still counts and renders normally', async () => {
    // The control for the test above — an honest unknown must not cost us the
    // ability to show a real count.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        badges: {
          all: [
            { id: 'b1', name: 'First Rep', tier: 'bronze', category: 'milestones', xp_reward: 10, earned: true },
            { id: 'b2', name: 'Week One', tier: 'silver', category: 'streaks', xp_reward: 25, earned: false },
          ],
          total_count: 40,
        },
        challenges: { active: [] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('First Rep')).toBeTruthy());
    expect(screen.getByText(/1 of 40 badges/)).toBeTruthy();
    expect(screen.queryByTitle('Earned state unavailable')).toBeNull();
  });

  it('a partial challenge renders dashes, not "undefined / undefined"', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        badges: { all: [], total_count: 40 },
        challenges: { active: [{ id: 'c1', name: 'Mystery Challenge' }] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('Challenges')).toBeTruthy());
    fireEvent.click(screen.getByText('Challenges'));

    await waitFor(() => expect(screen.getByText('Mystery Challenge')).toBeTruthy());
    // See the F11 note above: `/undefined/` cannot fail here. The dash is the
    // assertion that can.
    expect(screen.getByText(`${'—'} / ${'—'}`)).toBeTruthy();
    expect(screen.getByText('—%')).toBeTruthy();
  });

  it('a challenge with no difficulty is not painted hard-red — round 7 F2', async () => {
    // Round 6 F3 fixed this ternary in Dashboard and left the identical one
    // live in ChallengeCard and ChallengeRow, so "fixed as a class" was true of
    // one site in three.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        badges: { all: [], total_count: 40 },
        challenges: { active: [{ id: 'c1', name: 'Mystery Challenge', current: 1, target: 3, progress: 33 }] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('Challenges')).toBeTruthy());
    fireEvent.click(screen.getByText('Challenges'));
    await waitFor(() => expect(screen.getByText('Mystery Challenge')).toBeTruthy());

    // The difficulty pill must read "—" in neutral grey, not a hard-red blank.
    const pill = screen.getAllByText('—').find((el) => el.className.includes('rounded-full'));
    expect(pill).toBeTruthy();
    expect(pill.style.color).toContain('255, 255, 255');
    expect(pill.style.color).not.toContain('248');
  });

  it('an unknown difficulty still PAINTS its progress bar — round 9 F1', async () => {
    // THE CONCATENATION HAZARD, at the site where it is visible rather than
    // merely cosmetic. `linear-gradient(90deg, ${diffColor}, ${diffColor}cc)`
    // is a valid 8-digit hex for a known difficulty and INVALID CSS for the
    // neutral `rgba(255,255,255,0.45)`, so the whole declaration was dropped and
    // the bar rendered with NO FILL — beside a card printing "2 / 5" and "40%".
    // Round A found this hazard, wrote it into DECISIONS as a trap, invented
    // `edge` for it, and applied it to one of eight sites; this is the seven.
    //
    // Both challenges render in ONE fixture so the control is structural: if a
    // resolver ever returned neutral for everything, the known bar would stop
    // being green and this test fails on that line — the mistake Round A's F5
    // positive control was written to prevent.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        badges: { all: [], total_count: 40 },
        challenges: { active: [
          { id: 'c1', name: 'Known Diff',   difficulty: 'easy', current: 2, target: 5, progress: 40 },
          { id: 'c2', name: 'Unknown Diff',                     current: 2, target: 5, progress: 40 },
        ] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('Challenges')).toBeTruthy());
    fireEvent.click(screen.getByText('Challenges'));
    await waitFor(() => expect(screen.getByText('Unknown Diff')).toBeTruthy());

    const barOf = (name) =>
      screen.getByText(name).closest('.card-glass').querySelector('.h-full.rounded-full');

    // THE HEADLINE: the unknown bar has a fill at all. An empty string here is
    // the defect — a bar that reads as "no progress" about a number the same
    // card prints two inches away.
    const unknownBar = barOf('Unknown Diff').style.background;
    expect(unknownBar).not.toBe('');
    expect(unknownBar).toContain('255, 255, 255');   // neutral…
    expect(unknownBar).not.toContain('74, 222, 128'); // …never the easy green

    // THE CONTROL: a known difficulty is unchanged and still green.
    const knownBar = barOf('Known Diff').style.background;
    expect(knownBar).toContain('74, 222, 128');

    // The icon tile and the difficulty pill carried the same hazard. Asserted
    // DIRECTLY, not through a loop with an `if` in it: `if (x) expect(x).not
    // .toBe('')` cannot fail, which is the defect class this whole round is
    // about and which I wrote here on the first pass.
    const card = screen.getByText('Unknown Diff').closest('.card-glass');
    const iconTile = card.querySelector('.rounded-xl');
    // ROUND 10 F2: presence is not enough. `not.toBe('')` passes just as well
    // for a DEFINITE known colour, so a neutral slot set to hard-red or bronze
    // survived at 87/87 — round 8 F5's rule ("the text says unknown, the colour
    // makes a definite claim") unguarded in the fix for its own hazard.
    expect(iconTile.style.background).not.toBe('');
    expect(iconTile.style.background).toContain('255, 255, 255');
    expect(iconTile.style.border).not.toBe('');
    expect(iconTile.style.border).toContain('255, 255, 255');

    const pill = screen.getAllByText('—').find((el) => el.className.includes('rounded-full'));
    expect(pill.style.background).not.toBe('');
    expect(pill.style.background).toContain('255, 255, 255');
  });

  it('the STRIP paints an unknown difficulty too — round 9 F1, second component', async () => {
    // `${diffColor}bb` in ChallengeRow is the eighth site and the second one a
    // user can see. Asserted in its own component because "fixed at one of N
    // sites" is this card's most-repeated failure — round 8 F5 was that shape,
    // and round 9 F1 is that shape applied to round 8 F5's own fix.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        badges: { all: [], total_count: 40 },
        challenges: { active: [
          { id: 'c1', name: 'Strip Unknown', current: 2, target: 5, progress: 40 },
        ] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<GamificationStrip />);
    const name = await screen.findByText('Strip Unknown');

    const bar = name.closest('.rounded-xl').querySelector('.h-full.rounded-full');
    expect(bar.style.background).not.toBe('');
    expect(bar.style.background).toContain('255, 255, 255');
  });

  it('a badge category of `toString` does not blank the page — round 8 F4', async () => {
    // `b.category in CATEGORY_LABELS` walks the PROTOTYPE CHAIN, so `toString`
    // answered "known"; `badgesByCategory['toString']` then resolved to the
    // inherited Object.prototype.toString, which is TRUTHY, so the array was
    // never created and `.push` ran on a function. The whole page went blank —
    // XP header included — because there is no ErrorBoundary in apps/web.
    // `category` is text(b?.category): any non-empty string from the old
    // backend, i.e. external input used as an object key (R2.3). Structurally
    // round 6 F2 (non-array → .slice() → blank page), one layer in.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        badges: {
          all: [
            { id: 'b1', name: 'First Rep',   tier: 'bronze', category: 'milestones', xp_reward: 10, earned: true  },
            { id: 'b2', name: 'Proto Badge', tier: 'gold',   category: 'toString',   xp_reward: 20, earned: true  },
            { id: 'b3', name: 'Chain Badge', tier: 'silver', category: '__proto__',  xp_reward: 30, earned: false },
          ],
          total_count: 40,
        },
        challenges: { active: [] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    const { container } = renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('First Rep')).toBeTruthy());

    // The page is not blank, and the XP header — the thing this card exists to
    // render — is still on it.
    expect(container.textContent.length).toBeGreaterThan(0);
    expect(screen.getByText(/Level 3/)).toBeTruthy();

    // Round 5 F7's rule: an unlisted category falls into "Other". It must not
    // vanish from a grid whose header still counts it — the count and the grid
    // may not disagree.
    expect(screen.getByText('Proto Badge')).toBeTruthy();
    expect(screen.getByText('Chain Badge')).toBeTruthy();
    expect(screen.getByText('Other')).toBeTruthy();
    expect(screen.getByText(/2 of 40 badges/)).toBeTruthy();
  });

  it('an unknown badge tier is neutral here too — round 8 F5 / F4', async () => {
    // The other half of Probe D, so the two components cannot drift apart
    // again. It also covers `badge.tier in TIER_CONFIG`, which answered "known"
    // for `toString` and then read every style off a FUNCTION: undefined ring,
    // undefined glow, undefined colour — the known-tier path with no styling.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockResolvedValue({
      data: {
        badges: {
          all: [
            { id: 'b1', name: 'No Tier',    category: 'streaks', earned: true },
            { id: 'b2', name: 'Proto Tier', category: 'streaks', tier: 'toString', earned: true },
          ],
          total_count: 40,
        },
        challenges: { active: [] },
      },
    });
    gamificationService.getLeaderboard.mockImplementation(DEAD);

    renderPage(<Achievements />);
    await waitFor(() => expect(screen.getByText('No Tier')).toBeTruthy());

    for (const badgeName of ['No Tier', 'Proto Tier']) {
      const card = screen.getByText(badgeName).closest('.rounded-2xl');
      // An earned badge with a KNOWN tier gets that tier's ring and glow. An
      // unknown one must get neither — a bronze ring is a claim, exactly as
      // round 5 ruled a padlock is.
      expect(card.style.boxShadow).toBe('none');
      expect(card.style.border).toContain('rgba(255, 255, 255');
      expect(card.style.border).not.toContain('205, 127, 50');

      const pill = card.querySelector('.rounded-full');
      expect(pill.style.color).toContain('255, 255, 255');
      expect(pill.style.color).not.toContain('205, 127, 50');

      // ROUND 9 F1, the BadgeCard half: the icon tile was `${tier.color}15` and
      // this pill's background `${tier.color}20` — two more concatenations onto
      // a value that is `rgba(...)` in exactly this state, so both backgrounds
      // were dropped entirely. Cosmetic rather than a false claim, but it is the
      // same defect and it is asserted here so the class stays closed.
      // ROUND 10 F2, the tier half: neutrality, not just presence.
      expect(pill.style.background).not.toBe('');
      expect(pill.style.background).toContain('255, 255, 255');
      const iconTile = card.querySelector('.rounded-2xl');
      expect(iconTile.style.background).not.toBe('');
      expect(iconTile.style.background).toContain('255, 255, 255');
    }
  });

  it('old backend HANGS: no permanent "Failed to load" claim — round 3 F2', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(HANGS);
    gamificationService.getLeaderboard.mockImplementation(HANGS);

    renderPage(<Achievements />);

    // The header renders from the new API; the old read is still in flight, so
    // asserting failure would be a false claim during a healthy load.
    await waitFor(() => expect(screen.getByText(/Level 3/)).toBeTruthy());
    expect(screen.queryByText('Failed to load achievements')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/** The old backend's workout summary. The XP fields are chosen so the OLD math
 *  and the NEW source DISAGREE — that is the whole design of this fixture.
 *
 *  `current_xp: 578` is a TOTAL, so the deleted `summary.current_xp % 100` would
 *  render "78/100 XP", and `current_level: 7` would render "Level 7" / "Level 8".
 *  The new API says level 3 at 230/374 (XP_LEVEL_3). If either number were still
 *  read from this payload the assertions below would see it. A fixture where the
 *  two agree would pass with the bug live, which is the trap this project has
 *  recorded repeatedly — most recently at round 7 F3, where an assertion could
 *  not fail for the defect it named. */
// REPOINTED 2026-08-06 to the NEW API's payload: camelCase, no `summary`
// envelope, and WHOLE SECONDS instead of minutes (`workoutSummarySchema`).
// `currentLevel`/`currentXp` are still deliberately WRONG-looking numbers for
// the reason the comment above gives — they must not reach the screen.
const SUMMARY = {
  workoutId: '11111111-1111-4111-8111-111111111111',
  startedAt: '2026-07-27T10:00:00Z',
  durationSeconds: 2100, // 35 min, as the old fixture's minutes
  activeSeconds: 900,
  caloriesBurned: 280,
  formAccuracy: 88,
  exercisesCount: 3,
  personalRecords: [],
  xpEarned: 70,
  currentLevel: 7,
  currentXp: 578,
  currentStreak: 3,
  mealSuggestions: [],
  stretches: [],
};

/** The same workout with every METRIC absent — the state OWED.md:730 is about.
 *
 *  Not a hypothetical shape: the old backend's `/workouts/:id/summary` returns
 *  serialized Mongo documents with no shape contract (the same reasoning
 *  readStatsView's own JSDoc gives for `recent_workouts`), and this page ships
 *  NINE fields read bare. What it renders today, before the fix:
 *    · form_accuracy → `getFormGrade(undefined)` falls through every threshold
 *      to the final return: grade **D**, "Keep practicing", in RED. A definite
 *      bad-form verdict on a workout nobody scored — round 5 F3's defect
 *      ("an unknown accuracy painted RED by the <60 branch") one page along.
 *    · active_seconds + duration_minutes → formatTime(undefined) reaches
 *      `${Math.floor(NaN)}h ${NaN}m` = **"NaNh NaNm"**, on the page AND in the
 *      downloadable PNG.
 *    · calories_burned → **"undefined kcal"** on the page, **"NaN kcal"** in the
 *      card (the page does not round, the card does — its own OWED line).
 *    · exercises_count → React renders undefined as NOTHING, so the page tile
 *      goes BLANK while the card prints "undefined".
 *  `xp_earned` is deliberately KEPT here: it is already guarded, and a fixture
 *  that dropped it too would let a test pass on the wrong dash. */
const SUMMARY_UNSCORED = (({
  // eslint-disable-next-line no-unused-vars
  formAccuracy, caloriesBurned, exercisesCount, activeSeconds, durationSeconds,
  ...rest
}) => rest)(SUMMARY);

/** Every LIST arriving as a bare string instead of an array. Round 6 F2's class
 *  exactly, three sites along: `personal_records?.length > 0` is TRUE for a
 *  non-empty string, and `.map` on a string is not a function — so the whole
 *  page throws and blanks, and there is no ErrorBoundary anywhere in apps/web.
 *  A string is the shape to test rather than `{}`: the render already handles a
 *  string ELEMENT (`typeof record === 'string'`), which is evidence the backend
 *  does send strings here, and `{}` has no `length` so it merely hides. */
const SUMMARY_BAD_LISTS = {
  ...SUMMARY,
  personalRecords: 'Best form accuracy!',
  mealSuggestions: 'Paneer bhurji + rice',
  stretches:       'Hamstring stretch, 30s each side',
};

/** T3 F3: every other fixture carries EMPTY lists (SUMMARY, and SUMMARY_UNSCORED
 *  inherits them) or strings the reader nulls, so none of the four `.map` bodies
 *  ever executed — and those are the sites this card rewrote most heavily, having
 *  deleted an inline `typeof pr === 'string'` branch at two of them. The reviewer
 *  proved the gap by replacing all four bodies with a ReferenceError: 44/44 still
 *  GREEN.
 *
 *  ROUND 2 F4 CORRECTS THE EVIDENCE THIS COMMENT GAVE. It said the rig's `healthy`
 *  personal_records is "a bare string"; it is `['Best form accuracy!']`, an ARRAY
 *  (mock-ml-backend.mjs) — the bare string belongs to the `unscored` state. The
 *  substantive claim survives and is the reason both shapes are here: the
 *  `{icon,value,label}` shape was carried by neither the render tests nor the rig.
 *  A record is a claim (:1950), so the false half is struck rather than reworded
 *  around. */
const SUMMARY_LISTS = {
  ...SUMMARY,
  personalRecords: ['Best form accuracy!', { icon: '🔥', value: 12, label: 'reps' }],
  mealSuggestions: [{ meal: 'Paneer bhurji + rice', timing: 'within 45 min' }],
  stretches:       ['Hamstring stretch, 30s each side'],
};

/** ROUND 2 F1: NO fixture had the active figure absent with the total present,
 *  so the FALLBACK arm never executed at either surface — and three mutants lived
 *  in that hole, one of which prints a real fabrication ("NaNh NaNm total", the
 *  literal string this card exists to delete, in the HEALTHY state).
 *
 *  STILL WORTH KEEPING AFTER THE 2026-08-06 REPOINT, and the reason changed:
 *  the new API derives `activeSeconds` from the workout's own sets, and sync
 *  requires at least one set, so on real data the fallback arm is now
 *  UNREACHABLE. An unreachable arm is exactly where a defect can live forever
 *  (:5104's F1 — a gate whose false arm no test could reach was protected by
 *  nothing), so it keeps a fixture that reaches it deliberately. */
const SUMMARY_TOTAL_ONLY = (({
  // eslint-disable-next-line no-unused-vars
  activeSeconds, ...rest
}) => rest)(SUMMARY);

/** ROUND 2 F5: elements the reader could not read are PRESERVED as null (unit-
 *  pinned as `[null, null, null]`), and the length gate then opens the section —
 *  so an all-unreadable list renders N trophy rows of "—". Not a fabricated
 *  value, but a fabricated COUNT, and no render fixture reached it. Whether the
 *  reader should DROP unreadable elements instead is a Kd call on OWED; this
 *  fixture pins what the code does today either way. */
const SUMMARY_NULL_ELEMENTS = {
  ...SUMMARY,
  personalRecords: [null, {}],
  mealSuggestions: [null],
  // ROUND 3 F3: this inherited `stretches: []` from SUMMARY, so the THIRD list's
  // element path was unreached at every layer — the fixture built for unreadable
  // elements gave them to two of the three lists.
  stretches: [null, 7],
};

/** The XP bar, resolved with a LOUD failure when it cannot be found.
 *
 *  T3 round 3 F6: reading `container.querySelector('.from-yellow-500').style`
 *  directly means a pure restyle (`from-yellow-500` → `from-amber-500`, no XP
 *  change at all) fails after six seconds with a bare
 *  "TypeError: Cannot read properties of null" — an opaque result that reads as
 *  broken infrastructure, which is the exact lesson round 2 recorded about the
 *  5s budget, reintroduced one line below its own comment. Asserting the
 *  selector's cardinality first turns that into a sentence naming the cause,
 *  and also pins that the anchor stays unique. */
function xpBar(container) {
  const found = container.querySelectorAll('.from-yellow-500');
  expect(found.length, 'XP bar anchor .from-yellow-500 did not match exactly one node — restyled?').toBe(1);
  return found[0];
}

/** PostWorkout reads `:workoutId` with useParams, so it needs a real route —
 *  without one the id is undefined and the page redirects instead of rendering.
 *
 *  THE PARAM NAME IS LOAD-BEARING, not cosmetic: `useParams` keys by it, so if
 *  this route and the page ever disagree the id is `undefined` and every test
 *  here redirects to /dashboard instead of rendering. Renamed with the page on
 *  2026-08-06, when the screen started being keyed by the CLIENT-generated
 *  workout id rather than the old backend's session id.
 *
 *  T3 F4: `/dashboard` is a real route here now. Without it the empty-200 test
 *  could assert only that the TOAST fired, so deleting `navigate('/dashboard')`
 *  from the catch left the suite green — a toast floating over the blank page the
 *  test is named after. The suite's own stderr printed `No routes matched
 *  location "/dashboard"`, which is incidental output and not protection. */
const renderPostWorkout = () =>
  render(
    <MemoryRouter initialEntries={['/workout/summary/s1']}>
      <Routes>
        <Route path="/workout/summary/:workoutId" element={<PostWorkout />} />
        <Route path="/dashboard" element={<div>DASHBOARD REACHED</div>} />
      </Routes>
    </MemoryRouter>,
  );

/** The FORM bar, not the XP bar. `.from-primary-600` is a distinct Tailwind token
 *  from the XP card's `.from-primary-600/20` background, so it matches one node —
 *  and the length assertion PINS that, because a restyle making it ambiguous
 *  would otherwise leave this silently asserting the wrong element. Same shape
 *  and same reason as `xpBar` above. */
function formBar(container) {
  const found = container.querySelectorAll('.from-primary-600');
  expect(found.length, 'form bar anchor .from-primary-600 did not match exactly one node — restyled?').toBe(1);
  return found[0];
}

/** Every stat tile carrying `label`, as its VALUE text.
 *
 *  It returns BOTH surfaces on purpose: the page's tile and the share card's tile
 *  use the same labels, so a test can assert they agree. That is this card's own
 *  recorded lesson (DECISIONS :1282) — repointing only the visible card left one
 *  screen printing two different levels, and the stale one was the copy that
 *  leaves the building as a PNG.
 *
 *  **WHAT IT DOES NOT PROTECT** (T3 F6, corrected rather than overclaimed): for
 *  Calories the two surfaces have a KNOWN disagreement — the page prints the value
 *  unrounded and the card rounds it (its own OWED line; Kd ruled report-only) —
 *  and this helper cannot fail on it, because every fixture's value is the integer
 *  280. So "assert they agree" is true of the UNKNOWN state and of any fixture
 *  with a fractional value, and is vacuous for Calories as currently fixtured. The
 *  claim is narrowed here rather than the rounding changed.
 *
 *  The page renders label→value as <p> siblings; the card renders
 *  icon→value→label as <div>s, so the value sits on opposite sides. Keyed on
 *  tagName rather than DOM order, because order is an accident of layout and a
 *  reordered section would silently start reading the wrong node.
 *
 *  `getAllByText` THROWS when nothing matches, so this cannot pass vacuously: a
 *  tile that disappears fails the test that reads it, which is the "a vanishing
 *  site is still caught" half of the DECISIONS 2026-07-28 ruling on floors. */
const tileValues = (label) => screen.getAllByText(label).map((n) => (
  n.tagName === 'P' ? n.nextElementSibling.textContent : n.previousElementSibling.textContent
));

/** The PAGE's tile label node (the share card's is a <div>, the page's a <p>) —
 *  needed for the sub-line, which only the page has. `getAllByText` throws when
 *  nothing matches, and the explicit check turns "the page's tile vanished" into a
 *  named failure rather than a TypeError on undefined. */
const pageTile = (label) => {
  const node = screen.getAllByText(label).find((n) => n.tagName === 'P');
  expect(node, `no PAGE tile labelled "${label}" — did the stats grid change?`).toBeTruthy();
  return node;
};

describe('PostWorkout — the last copy of the hardcoded-100 XP curve', () => {
  // 10s test budget: the bar assertion below waits out framer-motion's own
  // delay(0.8)+duration(1), and vitest's DEFAULT is 5s — with the default, a
  // failing bar reports "Test timed out in 5000ms" instead of the actual width
  // mismatch. A timeout is not a result (the DPDP card's recorded lesson): it
  // reads as flaky infrastructure and hides the assertion that did the work.
  it('renders the server curve, never `total % 100`', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: SUMMARY });

    const { container } = renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    const text = container.textContent;

    // THE HEADLINE. The real position within the level, from the server.
    expect(text).toMatch(/230\/374 XP/);
    // The deleted maths, in both of its spellings.
    expect(text).not.toMatch(/\/100 XP/);
    expect(text).not.toMatch(/78\/100/);
    // The OLD store's level, which `current_level` would have supplied — at
    // BOTH sites: the share card is mounted off-screen whenever the preview is
    // closed (the default), so one screen cannot print two different levels.
    //
    // NO `\b` HERE, and that was a real defect (T3 F2 of this card). The row
    // renders as one run of text — "…Level 3230/374 XP…" — so with the old read
    // restored it reads "Level 7230/374", where `\b` between "7" and "2" does
    // not exist and the pattern could not fire. It matched for the share card
    // only by luck of adjacency (the next character there is an emoji). The
    // assertion was therefore blind at the very site this card is about, and
    // the mutation proved it: restoring `summary.current_level` in the row left
    // this test GREEN. Second vacuous assertion found in this one card.
    expect(text).not.toMatch(/Level [78]/);
    expect(text).toMatch(/Level 4/);

    // THE SHARE CARD'S OWN LEVEL, BY IDENTITY (T3 round 2, BLOCKING #1 — the
    // THIRD vacuous assertion in this card). This was
    // `getAllByText(/Level 3/).length >= 2`, which the PAGE satisfies on its own
    // before the card is ever reached: the "XP Earned" subtitle and the row's
    // left span are already two. Mutating ShareCard's `formatLevel` to
    // `formatNextLevel` — the PNG printing Level 4 while the page prints Level 3
    // — left the whole suite GREEN. That is the exact defect ShareCard was
    // brought into scope to prevent, and it is round 1's F1 INVERTED: there a
    // positive "—" was satisfied by the card so the page went unexamined; here a
    // positive "Level 3" was satisfied by the page so the card went unexamined.
    // Same blind spot, opposite direction, one round apart.
    const shareLevel = screen.getByText('+70 XP').nextElementSibling;
    expect(shareLevel.textContent).toBe('Level 3');
    // The count still earns its place: it catches a level site DISAPPEARING,
    // which identity checks cannot see. Exact, not a floor.
    expect(screen.getAllByText(/Level 3/).length).toBe(3);

    // THE BAR (T3 round 2, BLOCKING #2). Round 1 asserted that framer-motion
    // "never runs `animate` under jsdom — the node is width: 0px in every
    // state", and built a regex guard on that premise. IT IS FALSE, and the
    // reviewer measured it: 0px is the `initial`, and after this element's own
    // `delay: 0.8 + duration: 1` it settles at the real width. Round 1 read the
    // value ~1.8s early, because the existing waitFor resolves long before the
    // animation ends — measuring the case and calling it the class, which is
    // this project's most-recorded mistake, committed in the fix for it.
    // So round 4's standing "add a render assertion instead" was never actually
    // overridden, and here it is: the DOM, not the source text.
    // DERIVED from the fixture, not a copied literal: a hardcoded '61.5%' is a
    // duplicate of a number the fixture already owns, and this project recorded
    // that shape as a defect once already (XP round 3 F5 — "duplicating a number
    // the system DERIVES"). Changing the fixture must move this assertion with
    // it, or the test starts pinning a value nothing produces.
    await waitFor(
      () => expect(xpBar(container).style.width).toBe(`${XP_LEVEL_3.xp.progressPct}%`),
      { timeout: 6000 },
    );

    // The delta STAYS — it is this workout's, and the new API has no such field.
    expect(text).toMatch(/\+70/);
    // ROUND 3 F5: the one vocabulary, at EVERY state. It reached five of nine
    // while the record said "every state including the control" — and the four it
    // missed included both UNKNOWN-value states, which is the class the sweep
    // exists for.
    expect(text).not.toMatch(/undefined|NaN|null/);
  }, 10000);

  it('XP read fails: dashes, and the rest of the page survives', async () => {
    gamificationService.getMe.mockImplementation(DEAD);
    workoutService.getSummary.mockResolvedValue({ data: SUMMARY });

    const { container } = renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    const text = container.textContent;

    // No level is invented — not from `current_level`, not as a Level 1 default.
    // Whole-document sweep rather than per-element queries: a fabrication
    // interpolated into a longer string slips past getByText, which is exactly
    // how round 4's mutation (d) behaved.
    expect(text).not.toMatch(/Level\s*\d/);
    expect(text).not.toMatch(/\/100 XP/);
    expect(text).toMatch(/—\/— XP/);

    // THE BAR IS EMPTY WHEN NOTHING IS KNOWN (T3 round 3, BLOCKING). A bar
    // cannot render "unknown", so it renders nothing — a filled one beside
    // "—/— XP" would be a claim of progress nobody knows, on the screen shown
    // after every workout. This had NO assertion at any layer: `xpBarWidth`
    // was untested and the only bar assertion covered the known, in-range
    // case, so a mutant returning '100%' for unknown left all 229 tests green.
    // A PLAIN `waitFor` IS THE WRONG INSTRUMENT HERE, and I proved it by
    // mutating: with `xpBarWidth` returning '100%' for unknown, a
    // `waitFor(() => …toBe('0%'))` PASSED — because the bar sweeps 0 → 100%
    // and waitFor only needs ONE poll to match, which the start of the sweep
    // supplies. The unknown case is the one where start and end are the same
    // value, so "it was 0% at some instant" says nothing. Only the unit test
    // caught that mutant.
    //
    // So: wait, then assert ONCE. The wait is sized for THE MUTANT's sweep, not
    // for this path — corrected at T3 round 4 F7, which measured the honest
    // case reaching '0%' in ~110ms, because a value that never changes has no
    // animation to wait out. The 1.84s figure belongs to the KNOWN-value test.
    // What 2.4s buys is that a mutant sweeping 0 → 100% has finished before the
    // assertion runs, so it cannot be caught mid-sweep at a coincidental value.
    // It cannot pass early for a new reason either: an animation that never
    // runs leaves `width: 0px`, which fails `toBe('0%')`.
    await new Promise((r) => { setTimeout(r, 2400); });
    expect(xpBar(container).style.width).toBe('0%');

    // A failed XP read must not blank the page — there is no ErrorBoundary
    // anywhere in apps/web, and this screen's subject is the workout, not the
    // level. The summary's own figures are untouched by the XP failure.
    expect(text).toMatch(/88%/);
    expect(text).toMatch(/280 kcal/);
    expect(text).toMatch(/\+70/);
    expect(text).not.toMatch(/undefined|NaN|null/);   // round 3 F5
  }, 10000);   // waits out the animation window, same reason as the test above

  it('a summary with no xpEarned reads "—", never "+0"', async () => {
    // R2.3 on the one summary field this card touches. `+0` would claim the
    // workout earned nothing, which is a different statement from "we were not
    // told" — the standing rule, applied to the delta.
    //
    // STILL WORTH TESTING AFTER THE 2026-08-06 REPOINT, and the reason changed:
    // `xpEarned` is non-nullable in `workoutSummarySchema`, so a well-behaved
    // server always sends it and this state is now UNREACHABLE in production.
    // That is exactly when a guard rots unnoticed (:5104 F1), so the fixture
    // reaches it deliberately. NB the field is camelCase now — destructuring
    // the OLD name removed nothing, and the test then asserted "—" against a
    // payload that still carried +70. It failed loudly, which is the only
    // reason this rename was not a silently vacuous assertion.
    const { xpEarned, ...noXpEarned } = SUMMARY;   // eslint-disable-line no-unused-vars
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: noXpEarned });

    const { container } = renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    // ELEMENT-SCOPED, and the first version of this test was not — which the
    // mutation run caught before handover. Dropping the guard renders
    // `+{summary.xp_earned}` with an undefined value, and REACT RENDERS
    // undefined AS NOTHING: the output is a bare "+", never "+undefined", so
    // `not.toMatch(/\+undefined/)` could not fail for the defect it named. The
    // positive `—` assertion was worse: it was satisfied by the SHARE CARD,
    // which still had its guard, so the page's own card was never examined.
    // That is round 6 F11 / round 7 F3's class exactly, committed here and
    // caught only by mutating. Both sites are now asserted by identity.
    const pageValue = screen.getByText('experience points').previousElementSibling;
    expect(pageValue.textContent).toBe('—');          // not "+", not "+0"
    // The SHARE CARD's tile. T3 round 3 F5 was right that the comment here
    // claimed "both sites are asserted by identity" while this one is a TEXT
    // query — so the CLAIM is corrected rather than the test contorted, because
    // the test is sound and an identity anchor here is not: in this fixture the
    // level is KNOWN (only the delta is unknown), so the card's neighbouring
    // line reads "Level 3", which the page renders twice more and cannot anchor.
    // `getByText` THROWS when absent, so this cannot pass vacuously, and
    // "— XP" with the suffix is a string only the card produces — the page's own
    // delta renders as a bare "—". A scoped text query, honestly labelled.
    expect(screen.getByText('— XP').textContent).toBe('— XP');

    // The level is still known — one unknown field must not blank the others.
    expect(container.textContent).toMatch(/230\/374 XP/);
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);   // round 3 F5
  });

  // ── The unparsed-summary gap (OWED.md:730) ─────────────────────────────────
  // Deferred by Kd's ruling at this card's own plan gate ("record as OWED, fix XP
  // only", DECISIONS :1330) because the named task was the XP curve and a fourth
  // payload reader would have doubled a card on the page carrying the app's last
  // live XP defect. These four tests are that OWED line being discharged.

  it('an unscored workout reads "—" everywhere, never grade D', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: SUMMARY_UNSCORED });

    const { container } = renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    const text = container.textContent;

    // THE HEADLINE. By identity at the one site that renders them — a
    // whole-document /Keep practicing/ sweep would ALSO pass if the Form Score
    // card vanished entirely, and a test that passes when its subject is gone is
    // the vacuous-assertion class this card recorded four times.
    const label = screen.getByText('Form Score').nextElementSibling;
    const grade = screen.getByText('Form Score').parentElement.nextElementSibling;
    expect(label.textContent).toBe('Not scored');
    expect(grade.textContent).toBe('—');
    // …and the sweep as well, which catches the verdict reappearing anywhere else.
    expect(text).not.toMatch(/Keep practicing/);

    // No fabrication reached the DOM in ANY spelling. These are what catch a site
    // the assertions below do not name one by one.
    //
    // T3 F1: `/null/` was MISSING and it is the one spelling THIS card's code can
    // actually produce — the reader's unknown value is `null`, and `${null}`
    // stringifies to "null", so a raw template at any site prints "null%". The
    // reviewer proved it at the form-bar caption, which had no assertion of its
    // own: mutating it left 44/44 green while the page printed "null%" under the
    // bar. The old spellings stay because `undefined`/`NaN` are what the PRE-fix
    // code produced and a regression past the reader could reintroduce either.
    expect(text).not.toMatch(/undefined/);
    expect(text).not.toMatch(/NaN/);
    expect(text).not.toMatch(/null/);

    // …and the caption itself by identity, because a sweep only says the string is
    // absent from the whole document, never that THIS site rendered honestly.
    expect(screen.getByText('0%').nextElementSibling.textContent).toBe('—');

    // Both surfaces, by identity. The page and the PNG cannot disagree.
    expect(tileValues('Workout Time')).toEqual(['—', '—']);
    expect(tileValues('Calories')).toEqual(['— kcal', '— kcal']);
    expect(tileValues('Exercises')).toEqual(['—', '—']);
    expect(tileValues('Avg Form')).toEqual(['—']);
    expect(tileValues('Form score')).toEqual(['—']);

    // The bar cannot render "unknown", so it renders NOTHING: a filled bar beside
    // a "—" grade is a claim about form quality nobody measured. Instrument
    // copied deliberately from the XP bar's unknown case above, for the reason
    // recorded there — `waitFor` needs only ONE poll to match, and the start of
    // any sweep supplies 0%, so a mutant that sweeps 0 → 100% passes it. Wait out
    // the sweep, then assert once.
    await new Promise((r) => { setTimeout(r, 2400); });
    expect(formBar(container).style.width).toBe('0%');

    // The XP block is a SEPARATE read and is healthy — one unknown payload must
    // not blank a knowable one (round 4 F4's defect).
    expect(text).toMatch(/230\/374 XP/);
  }, 10000);

  it('a 200 with no `summary` key says so, instead of a blank white page', async () => {
    // PRE-EXISTING, and documented inside the smoke rig itself
    // (tools/mock-ml-backend.mjs:118): `setSummary(res.data.summary)` stores
    // undefined WITHOUT throwing, so the catch never runs — no toast, no
    // redirect, no text. The rig's `empty200` state serves exactly this and its
    // comment says a white screen there is the KNOWN state rather than a broken
    // rig. An absent summary is a failed read by any honest reading, so it takes
    // the page's EXISTING failure path rather than growing a second, differently
    // worded one.
    //
    // The clear is load-bearing: three tests above can call toast.error, and
    // without it this assertion would pass on one of THEIR calls while the
    // empty-200 path stayed silent. That is precisely how a vacuous assertion
    // gets written.
    toast.error.mockClear();
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: {} });

    renderPostWorkout();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load summary'));
    // T3 F4: the REDIRECT is half the claim and was unasserted, so deleting
    // `navigate('/dashboard')` from the catch left this green — a toast floating
    // over the blank page this test is named after.
    await waitFor(() => expect(screen.getByText('DASHBOARD REACHED')).toBeTruthy());
  });

  // ── the Calories tooltip explains a calculation, so it has to match it ─────
  //
  // T3 ROUND 2, C/H-1. Round 1 rewrote this sentence to describe the new
  // three-tier estimate and described only HALF of it — the half that runs when
  // the camera is grading you. THREE exercises have a definition; the other 55
  // are counted by hand, and for those the server bills the WHOLE set span at
  // the exercise's own rate, standing-there-getting-your-breath-back included
  // (`kcalPointForSetsV2`, the `logOnly` branch: it adds nothing to the idle
  // tier). So the screen told nearly every user that their standing-around had
  // been charged at a low resting rate when it had been charged at the full
  // one. The kcal number was right; the explanation flattered it.
  //
  // NOTHING ASSERTED THIS STRING BEFORE — which is exactly how a rewrite made it
  // false without one test noticing, one round after a rewrite made the Workout
  // Time tooltip false the same way. It is pinned as CLAIMS, not as a frozen
  // sentence: reword it freely, but it may not go back to describing one path as
  // though it were both.
  it('the Calories tooltip covers hand-counted sets, not just camera-graded ones', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: SUMMARY });

    renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    const tip = screen.getByText('Estimate').getAttribute('title');
    expect(tip).toBeTruthy();

    // PINNED AS A PAIRING, NOT AS VOCABULARY — T3 round 3, Low-3. Three loose
    // `toMatch`es over the whole string (/camera/, /count yourself/, /whole set/)
    // stood here and ALL THREE still passed when the two halves were SWAPPED, so
    // that the camera path billed the whole set and the hand-counted path billed
    // rep time only. Every word was still on screen, attached to the wrong path.
    // A test that survives an inversion of the very claim it is named for is
    // checking spelling, and the failure this file exists to catch is not a
    // spelling failure — it is one path being described as though it were both.
    // So each clause is located FIRST and then asked what it says.
    const clauses = tip.split(/(?<=\.)\s+/);
    const cameraClause = clauses.find((c) => /camera/i.test(c));
    const handClause = clauses.find((c) => /count yourself/i.test(c));
    expect(cameraClause).toBeTruthy();
    expect(handClause).toBeTruthy();
    // One sentence covering "both" is round 1's defect wearing a longer coat.
    expect(cameraClause).not.toBe(handClause);

    // The camera path: rep time at the exercise's rate, the remainder as rest.
    expect(cameraClause).toMatch(/rep time/i);
    expect(cameraClause).not.toMatch(/whole set/i);
    // THE HALF ROUND 1 LEFT OUT, and the case nearly every workout is actually
    // in: nothing measured when the user was moving, so the WHOLE span is billed
    // at the exercise's own rate — standing-around included.
    expect(handClause).toMatch(/whole set/i);
    expect(handClause).toMatch(/exercise/i);
  });

  // ── the workout has not reached the server yet (repoint, 2026-08-06) ────────
  // The sync queue flushes fire-and-forget, so this screen can open BEFORE the
  // workout arrives and the read 404s. That is a normal, temporary state, not a
  // failure — and the one thing it must never do is render zeros.

  it('a 404 RETRIES and then renders, rather than reporting a failure', async () => {
    toast.error.mockClear();
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    const notYet = Object.assign(new Error('not found'), { response: { status: 404 } });
    workoutService.getSummary
      .mockRejectedValueOnce(notYet)
      .mockResolvedValue({ data: SUMMARY });

    renderPostWorkout();

    // It gets there — the first answer was 404 and the page did not give up.
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy(), { timeout: 6000 });
    expect(workoutService.getSummary.mock.calls.length).toBeGreaterThanOrEqual(2);
    // And it never told the user anything was wrong, because nothing was.
    expect(toast.error).not.toHaveBeenCalled();
  }, 10000);

  it('while retrying it shows "Saving your workout…" and NO numbers', async () => {
    // THE ASSERTION THAT MATTERS ON THIS PATH. A summary screen that renders
    // "0 kcal / 0 exercises / grade D" for a workout still in the outbox is the
    // fabrication class this whole file is about — and it is what a naive
    // "treat 404 as empty" implementation produces. Pinned as an ABSENCE.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    const notYet = Object.assign(new Error('not found'), { response: { status: 404 } });
    workoutService.getSummary.mockRejectedValue(notYet);

    const { container } = renderPostWorkout();

    await waitFor(() => expect(screen.getByText('Saving your workout…')).toBeTruthy());
    const text = container.textContent;
    expect(text).not.toMatch(/kcal/);
    expect(text).not.toMatch(/Workout Complete!/);
    expect(text).not.toMatch(/undefined|NaN|null/);
  }, 10000);

  it('kicks the sync queue ONCE across all the retries, not once per retry', async () => {
    // T3 round 2, Low-4: the one-kick fix shipped with no test and no mutant, so
    // changing it back to five kicks — or to none — left every suite green.
    // Every kick sets the queue's `rerunRequested`, so five of them ask for up to
    // five extra full passes inside four seconds; and the point of the kick is to
    // cover a flush that lost its race with the navigation, which one call does.
    // Asserted as a NUMBER, so both directions of the mistake fail.
    toast.error.mockClear();
    flushSyncQueue.mockClear();
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    const notYet = Object.assign(new Error('not found'), { response: { status: 404 } });
    workoutService.getSummary.mockRejectedValue(notYet);

    renderPostWorkout();

    await waitFor(
      () => expect(toast.error).toHaveBeenCalledWith(
        "Your workout is saved and will sync when you're back online.",
      ),
      { timeout: 8000 },
    );
    // Five attempts happened…
    expect(workoutService.getSummary.mock.calls.length).toBeGreaterThan(1);
    // …and exactly one of them kicked the queue.
    expect(flushSyncQueue).toHaveBeenCalledTimes(1);
  }, 12000);

  it('a 404 that OUTLASTS the retries says the workout is SAVED, not lost', async () => {
    toast.error.mockClear();
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    const notYet = Object.assign(new Error('not found'), { response: { status: 404 } });
    workoutService.getSummary.mockRejectedValue(notYet);

    renderPostWorkout();

    // "Failed to load summary" would be the alarming lie here: the workout is
    // sitting safely in this browser's queue. Different cause, different words.
    await waitFor(
      () => expect(toast.error).toHaveBeenCalledWith(
        "Your workout is saved and will sync when you're back online.",
      ),
      { timeout: 8000 },
    );
    await waitFor(() => expect(screen.getByText('DASHBOARD REACHED')).toBeTruthy());
  }, 12000);

  // OFFLINE IS A DIFFERENT ERROR SHAPE FROM 404, AND THAT IS THE WHOLE POINT.
  // An axios failure with NO `response` is what a dropped network produces; the
  // 404 fixtures above cannot stand in for it. Kd's smoke, step 8: he went
  // offline mid-workout, finished, and got "Failed to load summary" for a
  // workout sitting safely in his outbox — because the retry keyed on the status
  // code, and offline there is no status code. Every assertion below would have
  // passed with the defect live if it had used the 404 shape.
  const offlineError = () => Object.assign(new Error('Network Error'), { request: {} });

  it('OFFLINE (no response at all) is treated as "not sent yet", not as a failure', async () => {
    toast.error.mockClear();
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary
      .mockRejectedValueOnce(offlineError())
      .mockResolvedValue({ data: SUMMARY });

    renderPostWorkout();

    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy(), { timeout: 6000 });
    expect(workoutService.getSummary.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(toast.error).not.toHaveBeenCalled();
  }, 10000);

  it('OFFLINE throughout: says the workout is SAVED, never "failed to load"', async () => {
    // The exact end state of Kd's step 8.
    toast.error.mockClear();
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockRejectedValue(offlineError());

    renderPostWorkout();

    await waitFor(() => expect(screen.getByText('Saving your workout…')).toBeTruthy());
    await waitFor(
      () => expect(toast.error).toHaveBeenCalledWith(
        "Your workout is saved and will sync when you're back online.",
      ),
      { timeout: 8000 },
    );
    expect(toast.error).not.toHaveBeenCalledWith('Failed to load summary');
    await waitFor(() => expect(screen.getByText('DASHBOARD REACHED')).toBeTruthy());
  }, 12000);

  it('OFFLINE on somebody ELSE\'S link still fails plainly — the outbox decides', async () => {
    // The two smoke findings meet here: no response AND not ours. Without the
    // outbox check this is where "your workout is saved" would be told to a
    // stranger, which is step 7's defect arriving through step 8's door.
    toast.error.mockClear();
    isAwaitingSync.mockReturnValue(false);
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockRejectedValue(offlineError());

    renderPostWorkout();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load summary'));
    expect(workoutService.getSummary).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalledWith(
      "Your workout is saved and will sync when you're back online.",
    );
    isAwaitingSync.mockReturnValue(true);
  }, 10000);

  it("SOMEBODY ELSE'S summary link is NOT treated as a workout in flight", async () => {
    // KD'S SMOKE, step 7, 2026-08-06 — and the screenshots are what caught it.
    // Signed in as a second account, pasting the first account's summary link
    // showed "Saving your workout…" and then "Your workout is saved and will
    // sync when you're back online". NOTHING LEAKED — the tenancy held, no
    // figure of the other account's was ever rendered — but every clause of
    // that sentence was false for the person reading it.
    //
    // The route cannot tell the cases apart and must not: 404 means "not synced
    // yet" OR "no such workout" OR "not yours", one answer by design so it is
    // not an existence oracle. The OUTBOX is what distinguishes them, and it is
    // per-user, so a stranger's browser says no.
    toast.error.mockClear();
    isAwaitingSync.mockReturnValue(false);
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    const notMine = Object.assign(new Error('not found'), { response: { status: 404 } });
    workoutService.getSummary.mockRejectedValue(notMine);

    renderPostWorkout();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load summary'));
    // The reassuring sentence must not appear for someone it is not true of.
    expect(toast.error).not.toHaveBeenCalledWith(
      "Your workout is saved and will sync when you're back online.",
    );
    // And it must not sit on the waiting screen either — one attempt, no retry.
    expect(workoutService.getSummary).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Saving your workout…')).toBeNull();
    await waitFor(() => expect(screen.getByText('DASHBOARD REACHED')).toBeTruthy());
    isAwaitingSync.mockReturnValue(true);
  }, 10000);

  it('a 5xx does NOT retry — it fails immediately, as before', async () => {
    // CORRECTED WORDING (T3 round 1, L-4). This said "the retry is scoped to one
    // status on purpose", which the step-8 fix made FALSE — a no-response error
    // is retried too. The retry is scoped to the "not here YET" shapes: a 404,
    // or no response at all. A server that ANSWERS with 500 has been reached and
    // has failed, so retrying it five times would turn one server fault into
    // four extra requests and a four-second stare at a spinner.
    // The test itself was right all along; only the sentence above it was wrong.
    toast.error.mockClear();
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockRejectedValue(
      Object.assign(new Error('boom'), { response: { status: 500 } }),
    );

    renderPostWorkout();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load summary'));
    expect(workoutService.getSummary).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('DASHBOARD REACHED')).toBeTruthy());
  }, 10000);

  it('falls back to total minutes, in each surface\'s own spelling', async () => {
    // ROUND 2 F1. Three mutants lived in this hole, one of them printing the
    // literal "NaNh NaNm" this card exists to delete.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: SUMMARY_TOTAL_ONLY });

    const { container } = renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    // The declared, deliberately-preserved divergence: page "35 min", card "35m".
    // Asserted as two DIFFERENT strings, so swapping either surface's formatter
    // for the other's now fails — until now they were interchangeable here.
    expect(tileValues('Workout Time')).toEqual(['35 min', '35m']);

    // With no active time there is no "total" contrast line to draw, so the
    // sub-line must be ABSENT rather than reading "— total".
    expect(pageTile('Workout Time').nextElementSibling.nextElementSibling).toBe(null);

    expect(container.textContent).not.toMatch(/undefined|NaN|null/);
  });

  it('an all-unreadable list renders rows it can label, not a fabricated count', async () => {
    // ROUND 2 F5. `readSummaryView` PRESERVES unreadable elements as null and the
    // length gate then opens the section, so N unreadable records render N trophy
    // rows of "—". Pinned as CURRENT behaviour; whether the reader should drop
    // them instead is a Kd call recorded on OWED, and this assertion moves with
    // that ruling if it lands.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: SUMMARY_NULL_ELEMENTS });

    const { container } = renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    // ROUND 3 F2: this was `>= 4` over a fixture that produces SIX — a floor with
    // two of slack, so no single site's dash could go missing. It is the shape
    // round 8 F6 deleted from three other tests, reintroduced in the fixture built
    // to catch it. EXACT now: 2 records × 2 surfaces, plus the meal's name and
    // timing. Dropping `orUnknown` at any one of the five element sites renders an
    // EMPTY row rather than a dash, which a floor cannot see and this can.
    expect(screen.getAllByText('—').length).toBe(6);
    // The point of the test: no invented CONTENT, and no crash.
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);
    expect(screen.getByText('Personal Records')).toBeTruthy();

    // ROUND 3 F3: the third list, behind the expander. Two unreadable stretches
    // add two more dashes, so the count moves — a test that only counted before
    // the click could not tell whether these rows rendered at all.
    fireEvent.click(screen.getByText('Cool Down Stretches'));
    expect(screen.getAllByText('—').length).toBe(8);
  });

  it('draws NO "total" sub-line when the total IS the active time (the shipping case)', async () => {
    // FOUND BY THE MUTATION SWEEP, not by review: M6 survived because
    // `activeSeconds` and `durationSeconds` are computed from the same stored
    // number — `repo.syncWorkout` derives a workout's `duration_ms` as the sum of
    // its set durations. Measured against the live DB: 12 of 12 workouts had them
    // exactly equal, including the ones from Kd's own smoke.
    //
    // What that printed: "31s" for Workout Time with "1 min total" beneath it and
    // a tooltip explaining that the total "includes standing between reps and
    // camera setup". There is no such gap. The MINUTE ROUNDING is what made one
    // number look like two — 31 s and round(31/60)=1 min — so the fabrication
    // was invisible at every layer that compared labels rather than values.
    //
    // No test could have caught it: the two expressions are equivalent, so no
    // input distinguishes them. That is why this pins the RENDER RULE instead.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({
      data: { ...SUMMARY, activeSeconds: 31, durationSeconds: 31 },
    });

    const { container } = renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    // The headline still reports the real figure…
    expect(tileValues('Workout Time')).toEqual(['31s', '31s']);
    // …and nothing claims a larger total beneath it.
    expect(container.textContent).not.toMatch(/total/i);
    const sub = pageTile('Workout Time').nextElementSibling.nextElementSibling;
    expect(sub === null || !/total/i.test(sub.textContent ?? '')).toBe(true);
  }, 10000);

  it('renders the LIST bodies — both record shapes, a meal, a stretch', async () => {
    // T3 F3. Every other fixture leaves these four `.map` bodies unexecuted, and
    // they are the sites this card rewrote most heavily.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: SUMMARY_LISTS });

    const { container } = renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    // The STRING shape and the {icon,value,label} shape, both composed by
    // readPersonalRecord. Each appears twice — the page's list and the share
    // card's top-three — so the count is asserted exactly, which catches either
    // surface dropping the section.
    expect(screen.getAllByText('Best form accuracy!').length).toBe(2);
    expect(screen.getAllByText('🔥 12 — reps').length).toBe(2);

    // The meal object's two fields, by identity: the timing is the node after the
    // name, so a reader that dropped `timing` cannot hide behind the name.
    const mealName = screen.getByText('Paneer bhurji + rice');
    expect(mealName.nextElementSibling.textContent).toBe('within 45 min');
    expect(container.textContent).not.toMatch(/Suggestions unavailable/);

    // The stretch body is behind the expander.
    fireEvent.click(screen.getByText('Cool Down Stretches'));
    expect(screen.getByText('Hamstring stretch, 30s each side')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Stretches unavailable/);
    // ROUND 3 F5: this is the ONLY state where all four `.map` bodies execute
    // with content, and it was one of the four missing the sweep.
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);
  });

  it('lists arriving as strings do not blank the page', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: SUMMARY_BAD_LISTS });

    const { container } = renderPostWorkout();
    // Today `personal_records.map` and `meal_suggestions.map` are called on
    // STRINGS and throw during render, so this line is the whole assertion: it
    // fails on a blank document, which is exactly what the user gets.
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    expect(container.textContent).toMatch(/88%/);          // real metrics survive
    // ROUND 2 F2: this swept `/undefined/` ALONE while the unscored test swept
    // three — so round 1's own fix for a missing spelling was applied at ONE of
    // its two sites, which is the card's most repeated shape. One vocabulary now.
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);

    // `stretches` is behind the expander, so its throw needs the click — a mount
    // assertion alone would leave that third site uncovered.
    fireEvent.click(screen.getByText('Cool Down Stretches'));
    expect(screen.getByText('Workout Complete!')).toBeTruthy();
  });

  it('a fully-scored workout still renders every real number (positive control)', async () => {
    // Without this, every assertion above could be satisfied by rendering a dash
    // unconditionally. Round 9 F2's lesson: a tile helper that covered two of
    // three sites let a fabricated Level 1 through all three protections.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: SUMMARY });

    const { container } = renderPostWorkout();
    await waitFor(() => expect(screen.getByText('Workout Complete!')).toBeTruthy());

    expect(tileValues('Workout Time')).toEqual(['15m 0s', '15m 0s']);
    expect(tileValues('Calories')).toEqual(['280 kcal', '280 kcal']);
    expect(tileValues('Exercises')).toEqual(['3', '3']);
    expect(tileValues('Avg Form')).toEqual(['88%']);
    expect(tileValues('Form score')).toEqual(['88% (A)']);

    // ROUND 2 F1: the SUB-LINE under Workout Time had no assertion at all, so
    // renaming its field printed "NaNh NaNm total" here — in the healthy state —
    // with every test green. Read as the node AFTER the value, so it also fails
    // if the sub-line vanishes.
    //
    // THIS FIXTURE KEEPS active (900s) AND total (2100s) DIFFERENT ON PURPOSE.
    // It stopped being hypothetical on 2026-08-07: the client now sends its own
    // workout timer, so the two ARE different on every real workout, and this
    // control is the shipping case rather than the future one.
    //
    // EXPECTATION CHANGED THE SAME DAY, from '35 min total' — and the reason
    // matters more than the string. The sub-line took MINUTES and rounded while
    // the figure above it is exact to the second, so Kd's smoke saw "2 min total"
    // under "1m 27s" for a workout of 1 m 44 s. Both now speak `secondsLabel`,
    // which is why this reads "35m 0s": the tile's own headline has always
    // spelled an exact 15 minutes "15m 0s", and the sub-line matching it is the
    // point. The old string was the defect, not the baseline.
    expect(pageTile('Workout Time').nextElementSibling.nextElementSibling.textContent)
      .toBe('35m 0s total');

    // ROUND 2 F2: the control swept for no fabrication spelling at ALL, which is
    // why F1's mutant was invisible to it. This is the state Kd's smoke leans on.
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);

    const label = screen.getByText('Form Score').nextElementSibling;
    const grade = screen.getByText('Form Score').parentElement.nextElementSibling;
    expect(label.textContent).toBe('Great');     // 88 → the >= 80 arm, not >= 90
    expect(grade.textContent).toBe('A');

    // THE PAGE'S OWN DELTA, BY IDENTITY — and this assertion exists because its
    // absence let a real regression through in this very commit. `xp_earned`
    // survived the snake→camel rename at ONE of its two sites, so the page card
    // read "—" for every workout while the PNG read "+70", and the whole suite
    // stayed green: test 1's `/\+70/` is a whole-document sweep the SHARE CARD
    // satisfies, and test 3's "—" is satisfied by a site that now reads undefined
    // for every workout, passing for the wrong reason. That is round 1 F1's
    // finding verbatim (a positive assertion satisfied by the card while the page
    // went unexamined) and round 7 F3's rule (an assertion whose stated failure
    // mode the code cannot produce is vacuous). It was found by grep, not by the
    // tests — which is the argument for this line.
    expect(screen.getByText('experience points').previousElementSibling.textContent).toBe('+70');

    // THE STREAK, at BOTH surfaces — T3 F2, and it is the xp_earned regression
    // one field over: renaming `currentStreak` back to `current_streak` at all
    // four sites left 44/44 GREEN while the page's pill and the card's tile both
    // silently VANISHED. A field that renders at two surfaces and is asserted at
    // neither is exactly what this card already learned once.
    expect(screen.getByText(/day streak!/).textContent).toBe('3 day streak!');
    expect(screen.getByText('Streak').previousElementSibling.textContent).toBe('3 days');

    // The form-bar caption by identity in the KNOWN state too (T3 F1's site).
    expect(screen.getByText('0%').nextElementSibling.textContent).toBe('88%');

    await waitFor(
      () => expect(formBar(container).style.width).toBe(`${SUMMARY.formAccuracy}%`),
      { timeout: 6000 },
    );
  }, 10000);
});
