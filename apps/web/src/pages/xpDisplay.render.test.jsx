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
import { MemoryRouter } from 'react-router-dom';

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
  workoutService: { getStats: vi.fn() },
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

/** A real /v1/gamification/me `xp` block. Level THREE deliberately: "Level 1" is
 *  the fabricated value this whole card exists to delete, so it must never be
 *  the same string as the true one, or a passing test proves nothing. */
const XP_LEVEL_3 = {
  xp: {
    level: 3, total: 578, xpInLevel: 230, xpForNext: 248,
    progressPct: 92.7, nextLevelAt: 596,
  },
};

const DEAD = () => Promise.reject(new Error('ECONNREFUSED'));
/** Accepts the connection and never answers — mlApi sets no timeout, so this is
 *  a PERMANENT state, not a transient one. Round 4 F7's scenario. */
const HANGS = () => new Promise(() => {});

const renderPage = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

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
describe('Dashboard — a real level never sits beside fabricated figures', () => {
  it('old backend DEAD, XP ready: shows the true level and dashes for the rest', async () => {
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockImplementation(DEAD);

    renderPage(<Dashboard />);

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
    // Dashes are present where the numbers would be.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('a 200 carrying {stats:{}} still shows dashes — round 4 F2', async () => {
    // The exact payload F2 named: the ENVELOPE arrived, so `Boolean(stats.stats)`
    // was true, and six sites then read absent fields with `?? 0`.
    gamificationService.getMe.mockResolvedValue({ data: XP_LEVEL_3 });
    gamificationService.getOverview.mockImplementation(DEAD);
    gamificationService.getLeaderboard.mockImplementation(DEAD);
    workoutService.getStats.mockResolvedValue({ data: { stats: {} } });

    renderPage(<Dashboard />);

    await waitFor(() => expect(screen.getAllByText(/Level 3/).length).toBeGreaterThan(0));
    expect(screen.queryByText('0 minutes')).toBeNull();
    expect(screen.queryByText(/0 of 7 days active/)).toBeNull();
    expect(screen.getByText('Weekly activity unavailable')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
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
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
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

    expect(container.textContent).not.toMatch(/advanced/i);
    expect(container.textContent).toMatch(/— kcal\/min/);
    // The difficulty pill reads as unknown rather than as a real level.
    const pill = screen.getAllByText('—').find((el) => el.className.includes('rounded-full'));
    expect(pill).toBeTruthy();
    expect(pill.style.color).not.toContain('248');   // not the red branch
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
