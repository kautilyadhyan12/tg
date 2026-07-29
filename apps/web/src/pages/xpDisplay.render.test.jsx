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
  workoutService: { getStats: vi.fn(), getSummary: vi.fn() },
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
const { recommendationService } = await import('../api/recommendationApi');

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
  it('old backend DEAD, XP ready: shows the true level and dashes for the rest', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockImplementation(DEAD);

    const { container } = renderPage(<Dashboard />);

    // The true level, from the new API.
    await waitFor(() => expect(screen.getAllByText(/Level 3/).length).toBeGreaterThan(0));

    // THE HEADLINE ASSERTION. Round 4 F2's mutation restored "Level 1 / 0 XP
    // earned" on the stat card via a destructure; it passed the source guard.
    // It cannot pass this.
    expect(screen.queryByText(/Level 1\b/)).toBeNull();
    expect(screen.queryByText(/0 XP earned/)).toBeNull();

    // The six old-backend figures are UNKNOWN, not zero.
    expect(screen.queryByText('0 minutes')).toBeNull();
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

  it('a 200 carrying {stats:{}} still shows dashes — round 4 F2', async () => {
    // The exact payload F2 named: the ENVELOPE arrived, so `Boolean(stats.stats)`
    // was true, and six sites then read absent fields with `?? 0`.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockResolvedValue({ data: { stats: {} } });

    const { container } = renderPage(<Dashboard />);

    await waitFor(() => expect(screen.getAllByText(/Level 3/).length).toBeGreaterThan(0));
    expect(screen.queryByText('0 minutes')).toBeNull();
    expect(screen.queryByText(/0 of 7 days active/)).toBeNull();
    expect(screen.getByText('Weekly activity unavailable')).toBeTruthy();

    // ROUND 8 F6, and this fixture is where it bites hardest: the ENVELOPE
    // arrived, so a `?? 0` on any absent field reads as a real server zero.
    expect(statValue('Total Workouts')).toBe('—');
    expect(statValue('Hours Trained')).toBe('—');
    expect(statValue('Calories Burned')).toBe('—');
    expect(tileValue('workouts')).toBe('—');
    expect(tileValue('days')).toBe('—');
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it('a PARTIAL 200 fabricates nothing for the missing fields', async () => {
    // total_minutes and total_calories absent — the subset case F2 called out.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockResolvedValue({
      data: { stats: { total_workouts: 12, weekly_workouts: 2 }, activity: {} },
    });

    renderPage(<Dashboard />);

    // The KNOWN field renders its caption. (The stat number itself is not
    // asserted here: StatCard animates it from 0 via requestAnimationFrame, so
    // its intermediate value is a timing artefact, not a claim.)
    await waitFor(() => expect(screen.getByText('2 of 7 days active')).toBeTruthy());
    // The two ABSENT fields must NOT have become zeros.
    expect(screen.queryByText('0 minutes')).toBeNull();
    expect(screen.queryByText('kcal total')).toBeTruthy();

    // ROUND 8 F6, by identity. NO whole-document zero sweep in THIS test: the
    // known `total_workouts: 12` is a number, so StatCard animates it from 0
    // and a bare "0" is a legitimate frame of that sweep, not a fabrication.
    // The absent fields are strings ('—') and never animate.
    expect(statValue('Hours Trained')).toBe('—');
    expect(statValue('Calories Burned')).toBe('—');
    expect(tileValue('days')).toBe('—');
    // THE CONTROL, and it is the one that stops "everything is a dash" from
    // passing: a field the server DID send still renders its real value. The
    // tiles render {value} directly, so unlike StatCard there is no animation
    // to race here.
    expect(tileValue('workouts')).toBe('2');
  });

  it('XP read fails too: no level is invented anywhere', async () => {
    gamificationService.getMe.mockImplementation(DEAD);
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockImplementation(DEAD);

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

  it('a recent workout with only an id and a date fabricates nothing — round 5 F3', async () => {
    // `recent_workouts` was the one list readStatsView passed through unparsed,
    // and three sites then rendered `|| 0`: "0 min · 0 kcal · 0% form", with the
    // unknown accuracy painted RED by the <60 branch.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockResolvedValue({
      data: {
        stats: { total_workouts: 3 },
        recent_workouts: [{ id: 'w1', completed_at: '2026-07-25T10:00:00Z' }],
      },
    });

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Workout Session')).toBeTruthy());

    const text = container.textContent;
    expect(text).not.toMatch(/0 min/);
    expect(text).not.toMatch(/0 kcal/);
    expect(text).not.toMatch(/0% form/);
    expect(text).toMatch(/— min/);
    expect(text).toMatch(/— kcal/);
    expect(text).toMatch(/—% form/);
  });

  it('the week caption and the dots agree — round 5 F8', async () => {
    // weeklyWorkouts known + activity unknown used to print "3 of 7 days
    // active" beside seven dashed UNKNOWN dots.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockResolvedValue({
      data: { stats: { weekly_workouts: 3 } },   // no `activity`
    });

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Weekly activity unavailable')).toBeTruthy());
    expect(screen.queryByText('3 of 7 days active')).toBeNull();
    expect(container.querySelectorAll('[title="Activity unavailable"]').length).toBe(7);
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
    workoutService.getStats.mockResolvedValue({
      data: { stats: { total_workouts: 3 }, activity: {} },   // no weekly_workouts
    });

    const { container } = renderPage(<Dashboard />);
    await waitFor(() => expect(screen.getAllByText(/Level 3/).length).toBeGreaterThan(0));

    // The week ARRIVED, so nothing may claim it did not.
    expect(screen.queryByText('Weekly activity unavailable')).toBeNull();
    expect(container.querySelectorAll('[title="Activity unavailable"]').length).toBe(0);
    // …and the count's own unknown is a dash, not a suppressed caption and not
    // a zero. `formatCount` is what makes both true from one read.
    expect(screen.getByText('— of 7 days active')).toBeTruthy();
    expect(screen.queryByText(/\bnull of 7\b/)).toBeNull();
    expect(screen.queryByText('0 of 7 days active')).toBeNull();
  });

  it('the week strip claims nothing when activity is unknown — round 4 F3', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockImplementation(DEAD);

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
    // WeekStrip and its caption branched on `stats.activity === null` ALONE, so
    // loading and failed were one answer. mlApi sets no timeout, so against a
    // hung old backend the page claimed a failed read PERMANENTLY — a caption
    // plus seven "Activity unavailable" tooltips during a perfectly healthy
    // in-flight request. `oldPayloadState` is the tested function for exactly
    // this shape and round 7 applied it to recentState and recsState on this
    // page while leaving the third read on two states.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockImplementation(HANGS);

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

    // The sibling pane, reading the SAME hung request, already got this right —
    // the two must not disagree about one request.
    expect(screen.getByText('Loading recent workouts…')).toBeTruthy();
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
    workoutService.getStats.mockImplementation(DEAD);
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
    workoutService.getStats.mockImplementation(DEAD);
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
    workoutService.getStats.mockResolvedValue({ data: { stats: { total_workouts: 3 } } });
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
    workoutService.getStats.mockImplementation(HANGS);
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
    expect(iconTile.style.background).not.toBe('');
    expect(iconTile.style.border).not.toBe('');

    const pill = screen.getAllByText('—').find((el) => el.className.includes('rounded-full'));
    expect(pill.style.background).not.toBe('');
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
      expect(pill.style.background).not.toBe('');
      const iconTile = card.querySelector('.rounded-2xl');
      expect(iconTile.style.background).not.toBe('');
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
const SUMMARY = {
  session_id: 's1',
  duration_minutes: 35,
  active_seconds: 900,
  calories_burned: 280,
  form_accuracy: 88,
  exercises_count: 3,
  completed_at: '2026-07-27T10:00:00Z',
  personal_records: [],
  xp_earned: 70,
  current_level: 7,
  current_xp: 578,
  current_streak: 3,
  meal_suggestions: [],
  stretches: [],
  exercises: [],
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

/** PostWorkout reads `:sessionId` with useParams, so it needs a real route —
 *  without one the id is undefined and the page redirects instead of rendering. */
const renderPostWorkout = () =>
  render(
    <MemoryRouter initialEntries={['/workout/summary/s1']}>
      <Routes>
        <Route path="/workout/summary/:sessionId" element={<PostWorkout />} />
      </Routes>
    </MemoryRouter>,
  );

describe('PostWorkout — the last copy of the hardcoded-100 XP curve', () => {
  // 10s test budget: the bar assertion below waits out framer-motion's own
  // delay(0.8)+duration(1), and vitest's DEFAULT is 5s — with the default, a
  // failing bar reports "Test timed out in 5000ms" instead of the actual width
  // mismatch. A timeout is not a result (the DPDP card's recorded lesson): it
  // reads as flaky infrastructure and hides the assertion that did the work.
  it('renders the server curve, never `total % 100`', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: { summary: SUMMARY } });

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
  }, 10000);

  it('XP read fails: dashes, and the rest of the page survives', async () => {
    gamificationService.getMe.mockImplementation(DEAD);
    workoutService.getSummary.mockResolvedValue({ data: { summary: SUMMARY } });

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
  }, 10000);   // waits out the animation window, same reason as the test above

  it('a summary with no xp_earned reads "—", never "+0"', async () => {
    // R2.3 on the one summary field this card touches. `+0` would claim the
    // workout earned nothing, which is a different statement from "we were not
    // told" — the standing rule, applied to the delta.
    const { xp_earned, ...noXpEarned } = SUMMARY;   // eslint-disable-line no-unused-vars
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    workoutService.getSummary.mockResolvedValue({ data: { summary: noXpEarned } });

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
  });
});
