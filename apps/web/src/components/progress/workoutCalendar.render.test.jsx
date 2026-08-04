// RENDER tests for the repointed workout calendar.
//
// These assert on the DOM rather than on source text, for the reason recorded
// in `pages/xpDisplay.render.test.jsx`: source guards have unbounded spellings
// to enumerate and were defeated ten times, while the rendered output has one
// question — did a number nobody knows reach the screen?
//
// THE CONTROL COMES FIRST and is the test that matters most here. This card
// replaces confident zeros with an em dash, and the one outcome it must NOT
// have is dashing out figures the backend really sent. No unknown-state test
// can catch that; only a healthy-state assertion on real numbers can.
//
// Only the NETWORK is mocked. `api/workoutHistory` — the page-walk, the local
// day key, every decision about what is knowable — runs for real, because that
// logic is exactly what is under test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UNKNOWN } from '../../api/gamificationApi';
import { FORM_NEUTRAL } from '../../api/workoutHistory';
import { workoutService } from '../../api/workoutApi';
import WorkoutCalendar from './WorkoutCalendar';

vi.mock('../../api/workoutApi', () => ({
  workoutService: { getHistory: vi.fn(), getWorkout: vi.fn() },
}));

const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth(); // 0-based, the month the calendar opens on

/** 09:00 LOCAL on the given day of the currently-displayed month. */
const dayIso = (d, h = 9) => new Date(Y, M, d, h).toISOString();

function item(over = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    startedAt: dayIso(15),
    platform: 'web',
    setsCount: 4,
    totalReps: 40,
    avgFormScore: 88,
    durationMs: 1_800_000,
    kcalPoint: 210,
    kcalCalcVersion: 1,
    qualityFlags: [],
    ...over,
  };
}

const pageOf = (items, limitedToDays = null) => ({
  data: { items, nextCursor: null, limitedToDays },
});

/** The month-summary line, in EITHER of its states — the count when the month
 *  was read, the "unavailable" wording when it was not. Scoped to the <p> so an
 *  ancestor's text cannot satisfy it (the whole-document-sweep trap, round 1 F1). */
const activeDays = () =>
  screen.getByText(
    (_, el) => el?.tagName === 'P' && /active days this month/i.test(el.textContent || ''),
  );

/** No jest-dom in this package (vitest.config.js registers no setup file), so
 *  enabled-ness is read off the element rather than via `toBeEnabled`. */
const dayCell = (n) => screen.getByRole('button', { name: String(n) });

/** jsdom rewrites `style.color` into its own canonical spelling (`#f87171`
 *  reads back as `rgb(248, 113, 113)`). Push the expected value through the
 *  SAME normalisation instead of hardcoding jsdom's output format, which is an
 *  implementation detail of the DOM library rather than of this screen. */
const asRendered = (css) => {
  const probe = document.createElement('div');
  probe.style.color = css;
  return probe.style.color;
};

/** The icon inside the stat tile carrying `label`. The tint is the whole point
 *  of the assertion below: `formColor` is unit-tested, but nothing proved the
 *  SCREEN routes a score through it — the one-of-N shape this repo has shipped
 *  four times (OWED, round 7 F2). */
const statIcon = (label) => {
  const tile = screen.getByText(label).parentElement;
  const svg = tile?.querySelector('svg');
  if (!svg) throw new Error(`no icon found in the "${label}" stat tile`);
  return svg;
};

beforeEach(() => {
  vi.clearAllMocks();
  workoutService.getWorkout.mockResolvedValue({ data: { sets: [] } });
});
afterEach(cleanup);

describe('the healthy month — THE CONTROL', () => {
  it('draws the real day and the real count, dashing nothing out', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([item()]));
    render(<WorkoutCalendar />);

    await waitFor(() => expect(activeDays().textContent).toMatch(/^1\s+active days this month$/));
    // The 15th is a button because it has a workout; a blank day is disabled.
    expect(dayCell(15).disabled).toBe(false);
    expect(screen.queryByText(/Couldn’t load|Couldn't load/)).toBeNull();
  });

  it('shows the real numbers in the day panel', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([item()]));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));

    fireEvent.click(dayCell(15));

    expect(await screen.findByText('30m 0s')).toBeTruthy();
    expect(screen.getByText('210')).toBeTruthy();
    expect(screen.getByText('88%')).toBeTruthy();
    expect(screen.queryByText(UNKNOWN)).toBeNull();
  });
});

describe('a failed read is not an empty month', () => {
  it('says it could not load, and never claims 0 active days', async () => {
    workoutService.getHistory.mockRejectedValue(new Error('offline'));
    render(<WorkoutCalendar />);

    await waitFor(() =>
      expect(screen.getByText(/Couldn’t load your workout history|Couldn't load your workout history/)).toBeTruthy(),
    );
    expect(activeDays().textContent).toMatch(/unavailable/i);
    expect(activeDays().textContent).not.toMatch(/\b0\b/);
  });

  it('retries on demand and recovers', async () => {
    workoutService.getHistory.mockRejectedValueOnce(new Error('offline'));
    workoutService.getHistory.mockResolvedValue(pageOf([item()]));
    render(<WorkoutCalendar />);

    const retry = await screen.findByRole('button', { name: /try again/i });
    fireEvent.click(retry);

    await waitFor(() => expect(activeDays().textContent).toMatch(/^1\s+active days this month$/));
  });

  it('does not draw a part-month when a LATER page fails', async () => {
    workoutService.getHistory.mockResolvedValueOnce({
      data: { items: [item({ startedAt: dayIso(28) })], nextCursor: 'c1', limitedToDays: null },
    });
    workoutService.getHistory.mockRejectedValueOnce(new Error('offline'));
    render(<WorkoutCalendar />);

    await waitFor(() =>
      expect(screen.getByText(/Couldn’t load your workout history|Couldn't load your workout history/)).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: '28' })).toBeNull();
  });
});

describe('unknown values', () => {
  it('renders the em dash for every unknown stat, never 0m / 0 / 0%', async () => {
    workoutService.getHistory.mockResolvedValue(
      pageOf([item({ durationMs: null, kcalPoint: null, avgFormScore: null })]),
    );
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));

    fireEvent.click(dayCell(15));

    await waitFor(() => expect(screen.getAllByText(UNKNOWN).length).toBe(3));
    expect(screen.queryByText('0m')).toBeNull();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('counts rows it could not read instead of dropping them silently', async () => {
    workoutService.getHistory.mockResolvedValue(
      pageOf([item(), item({ id: null }), item({ startedAt: 'sometime' })]),
    );
    render(<WorkoutCalendar />);

    await waitFor(() =>
      expect(screen.getByText(/2 workouts couldn’t be read|2 workouts couldn't be read/)).toBeTruthy(),
    );
  });
});

describe('a HAND-COUNTED workout — the shape this screen was built before', () => {
  // The web write path landed 2026-08-02, the DAY AFTER this calendar was
  // built, so not one fixture above carries a hand-counted workout's shape:
  // real duration, real calories, and `avgFormScore: null` because nothing
  // ever measured the user's form. A log-only set cannot carry a score at all
  // — migration 0009's CHECK constraint forbids it — so this is the ordinary
  // state of every hand-counted day, not an error state.
  //
  // THE RISK IS NOT THE DASH. It is that the two figures the server really did
  // send get dashed out beside it, which is this card's central defect class
  // pointing the other way.
  const handCounted = (over = {}) => item({ avgFormScore: null, ...over });

  it('keeps the real duration and calories, dashing ONLY the form score', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([handCounted()]));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));

    fireEvent.click(dayCell(15));

    expect(await screen.findByText('30m 0s')).toBeTruthy();
    expect(screen.getByText('210')).toBeTruthy();
    // EXACTLY one — not "at least one". A floor here would pass while duration
    // and calories were dashed out too (round 8 F6's lesson: `>= 3` had two
    // dashes of slack and hid four fabrications).
    expect(screen.getAllByText(UNKNOWN)).toHaveLength(1);
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('tints an unscored form neutrally, never the low-score red', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([handCounted()]));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));

    fireEvent.click(dayCell(15));
    await screen.findByText('30m 0s');

    // "We did not measure this" must not read as "you did badly".
    expect(statIcon('Form').style.color).toBe(asRendered(FORM_NEUTRAL));
    expect(statIcon('Form').style.color).not.toBe(asRendered('#f87171'));
  });

  it('THE CONTROL for the tint — a real score still colours by its value', async () => {
    // Without this, hardcoding the neutral tint would pass the test above.
    workoutService.getHistory.mockResolvedValue(pageOf([item({ avgFormScore: 88 })]));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));

    fireEvent.click(dayCell(15));
    await screen.findByText('88%');

    expect(statIcon('Form').style.color).toBe(asRendered('#4ade80'));
    expect(statIcon('Form').style.color).not.toBe(asRendered(FORM_NEUTRAL));
  });

  it('still names its exercises — the slug is there whatever counted the reps', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([handCounted()]));
    workoutService.getWorkout.mockResolvedValue({
      data: {
        sets: [
          { exerciseSlug: 'push_up', mode: 'log_only' },
          { exerciseSlug: 'lunge', mode: 'log_only' },
        ],
      },
    });
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));

    fireEvent.click(dayCell(15));

    expect(await screen.findByText('Push Up')).toBeTruthy();
    expect(screen.getByText('Lunge')).toBeTruthy();
    expect(screen.getByText(/Exercises · 2 total/)).toBeTruthy();
  });

  it('places a MIXED workout on the calendar exactly once', async () => {
    // Camera-graded squats plus hand-tapped press-ups is ONE workout, one row,
    // one day — the smoke's step 7 shape. A second cell here would mean the
    // reader had split it on something.
    workoutService.getHistory.mockResolvedValue(pageOf([item({ avgFormScore: 83 })]));
    workoutService.getWorkout.mockResolvedValue({
      data: {
        sets: [
          { exerciseSlug: 'squat', mode: 'engine' },
          { exerciseSlug: 'push_up', mode: 'log_only' },
        ],
      },
    });
    render(<WorkoutCalendar />);

    await waitFor(() => expect(activeDays().textContent).toMatch(/^1\s+active days this month$/));
    fireEvent.click(dayCell(15));

    expect(await screen.findByText('83%')).toBeTruthy();
    expect(screen.getByText(/Exercises · 2 total/)).toBeTruthy();
    expect(screen.queryByText(/Session 2/)).toBeNull();
  });
});

describe('the plan read-gate', () => {
  it('explains an empty old month instead of drawing a blank one', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([], 7));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(activeDays()).toBeTruthy());

    // Two months back is entirely outside a 7-day window whatever today is.
    fireEvent.click(screen.getAllByRole('button')[0]);
    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() =>
      expect(screen.getByText(/Your plan shows the last 7 days/)).toBeTruthy(),
    );
    expect(screen.getByText(/Older workouts are still saved/)).toBeTruthy();
  });

  it('stays silent when the window covers the month', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([item()], null));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));
    expect(screen.queryByText(/Your plan shows the last/)).toBeNull();
  });
});

describe('the exercise chips (a LIVE feature the old backend served)', () => {
  it('reads them from the workout detail endpoint', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([item()]));
    workoutService.getWorkout.mockResolvedValue({
      data: { sets: [{ exerciseSlug: 'barbell_squat' }, { exerciseSlug: 'push_up' }] },
    });
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));

    fireEvent.click(dayCell(15));

    expect(await screen.findByText('Barbell Squat')).toBeTruthy();
    expect(screen.getByText('Push Up')).toBeTruthy();
    expect(screen.getByText(/Exercises · 2 total/)).toBeTruthy();
  });

  it('says the read failed rather than implying the workout had none', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([item()]));
    workoutService.getWorkout.mockRejectedValue(new Error('offline'));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));

    fireEvent.click(dayCell(15));

    expect(
      await screen.findByText(/Couldn’t load this workout’s exercises|Couldn't load this workout's exercises/),
    ).toBeTruthy();
  });
});

describe('the repoint itself', () => {
  it('asks the NEW api, and asks it for the shared contract ceiling', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([]));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(workoutService.getHistory).toHaveBeenCalled());
    expect(workoutService.getHistory).toHaveBeenCalledWith({ limit: 100 });
  });
});
