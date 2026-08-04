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
// Only the NETWORK is mocked. `api/workoutHistory` — the month request, the
// local day key, every decision about what is knowable — runs for real, because
// that logic is exactly what is under test.
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

    const notice = await screen.findByText(/Your plan shows the last 7 days/);
    // WHICH ARM, not merely that the notice appeared. `monthClamp` is unit-
    // tested both ways but nothing asserted that the SCREEN routes the two
    // cases to different sentences, so flipping the ternary passed (T3 round 2,
    // F3). This assertion and the straddling one below are a PAIR: either alone
    // is satisfied by hardcoding the other's copy.
    expect(notice.textContent).toMatch(/so this month isn’t shown/);
    expect(notice.textContent).not.toMatch(/the earlier part/);
    expect(screen.getByText(/Older workouts are still saved/)).toBeTruthy();
  });

  it('says only the EARLIER part is missing when the window cuts into the month', async () => {
    // A window whose floor lands MID-WAY through the month being viewed,
    // whatever today's date is: aim at the 15th of last month and derive the
    // day count from that, rather than hardcoding a number that only straddles
    // on some days of some months.
    const midLastMonth = new Date(Y, M - 1, 15, 12).getTime();
    const days = Math.ceil((Date.now() - midLastMonth) / 86400000);
    workoutService.getHistory.mockResolvedValue(pageOf([], days));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(activeDays()).toBeTruthy());

    fireEvent.click(screen.getAllByRole('button')[0]);   // back one month

    const notice = await screen.findByText(/Your plan shows the last/);
    expect(notice.textContent).toMatch(/the earlier part of this month isn’t shown/);
  });

  it('stays silent when the window covers the month', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([item()], null));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));
    expect(screen.queryByText(/Your plan shows the last/)).toBeNull();
  });
});

describe('a month too big to finish reading — TRUNCATION', () => {
  // WHAT THIS STATE MEANS NOW, and it changed with the date window: the reader
  // asks for ONE month, so filling all ten pages means this single month holds
  // more than a thousand workouts. It used to mean the month was never REACHED
  // — ten pages of rows NEWER than it, from a walk that started at today — and
  // that state drew a long-time user's old months blank. The window removed it;
  // the cap and this caption survive it (the handover's own instruction: do not
  // delete the truncation state for being rare).
  //
  // The first call resolves a WHOLE month (no next cursor); every call after it
  // hands back another page forever. So the opening month is read completely —
  // that is the control — and stepping back one month truncates.
  const wholeThenEndless = () => {
    workoutService.getHistory.mockResolvedValueOnce(pageOf([item()]));
    workoutService.getHistory.mockResolvedValue({
      data: { items: [item()], nextCursor: 'c1', limitedToDays: null },
    });
  };

  // NOTE WHAT THIS FIXTURE ACTUALLY IS, because it was mistaken for the other
  // one until the T3 on d28ace5 (F3): after stepping back a month, the endless
  // pages are dated in the month the calendar has LEFT. That is a server
  // answering the request for one month with another month's rows — the
  // DISAGREEMENT case, not a busy month — and every row is discarded by the
  // in-window filter. So it truncates with NOTHING placed, which is precisely
  // the state that must not claim a volume.
  it('reports a read that stopped short WITHOUT inventing a reason for it', async () => {
    wholeThenEndless();
    render(<WorkoutCalendar />);

    await waitFor(() => expect(activeDays().textContent).toMatch(/^1\s+active days this month$/));
    expect(screen.queryByText(/couldn’t be read all the way through/i)).toBeNull();  // the control

    fireEvent.click(screen.getAllByRole('button')[0]);   // back one month

    expect(
      await screen.findByText(/this month couldn’t be read all the way through/i),
    ).toBeTruthy();
    // An EMPTY grid must not be captioned with a volume. This is the F3 defect
    // stated as an absence: not one of these rows was this month's, so the
    // screen knows nothing about how many workouts this month holds.
    expect(screen.queryByText(/more than a thousand workouts/i)).toBeNull();
    // The superseded wording, pinned as an ABSENCE too. It was true of the walk
    // and is false of the window — nothing is read "between today and this
    // month" any more — and a caption that survives the read it described is
    // exactly the failure this file keeps recording (T3 round 2, F4).
    expect(screen.queryByText(/between today and this month/i)).toBeNull();
  });

  it('claims the volume ONLY when it counted that many of THIS month’s workouts', async () => {
    // The positive control for the test above, and the state the volume
    // sentence was written for: ten full pages, every row inside the window.
    // Without this, "never say the volume" is satisfiable by never saying it.
    //
    // TEN DISTINCT PAGES, and that is the whole correction of T3 round 2's F1.
    // As first written this used `mockResolvedValue` with a CONSTANT
    // `nextCursor: 'c1'`, so the walk read the SAME hundred rows ten times: the
    // count reached 1,000 off 100 workouts and the test passed for a reason its
    // own name denies. It was the round-1 F2 shape — a check red (or green) for
    // the wrong cause — one round later, in the test written to close F3.
    // The page is derived from the CURSOR, not from a call counter, and that is
    // not fussiness — a counter made this fixture depend on call ORDER, and the
    // effect runs twice in dev, so two interleaved walks shared it. Deriving
    // from the cursor makes each walk independent and the ids reproducible.
    //
    // ZERO-padded, and that is not fussiness either. Padding with '1' is NOT
    // injective when the number itself contains 1s: page 10 → `111111`+`10` =
    // `11111110`, which is exactly what page 0 → `1111111`+`0` produces. With
    // twenty pages served, pages 0 and 10 collided, distinct ids fell under a
    // thousand, and the test failed while the reader was computing the right
    // answer — a fixture that did not do what its own name said, which is the
    // shape this card has now hit at every level including this one.
    workoutService.getHistory.mockImplementation(async ({ cursor }) => {
      const page = cursor === undefined ? 0 : Number(String(cursor).slice(1));
      return {
        data: {
          items: Array.from({ length: 100 }, (_, i) => item({
            id: `${String(page).padStart(8, '0')}-1111-4111-8111-${String(i).padStart(12, '0')}`,
          })),
          nextCursor: `c${page + 1}`,   // ADVANCES — a stuck cursor is F2's bug
          limitedToDays: null,
        },
      };
    });
    render(<WorkoutCalendar />);

    expect(
      // A longer wait than the 1 s default, and NOT a flake workaround: this
      // fixture really does serve ten pages of a hundred rows and render a
      // thousand sessions, which is the point of it. Measured at ~1.03 s, i.e.
      // it failed the default by 30 ms while producing exactly the right answer.
      await screen.findByText(/this month has more than a thousand workouts/i, undefined, { timeout: 8000 }),
    ).toBeTruthy();
    expect(screen.queryByText(/couldn’t be read all the way through/i)).toBeNull();
    // The superseded caption is pinned as an absence HERE TOO (round 2, F3).
    // The pin in the test above cannot see this branch — under M37 that test
    // renders the vague sentence and passes — so half of ":4622's superseded
    // clause is pinned as an ABSENCE" was true of one branch only.
    expect(screen.queryByText(/between today and this month/i)).toBeNull();
  });

  it('counts a REPEATED workout once, so a stuck cursor cannot invent a volume', async () => {
    // T3 round 2, F2, measured: a server whose cursor never advances hands back
    // the same 100 rows ten times. A plain tally reached 1,000 and printed the
    // confident thousand-workout sentence over a month holding a hundred —
    // the same threat model the count was invented for, one bug over.
    const stuckPage = Array.from({ length: 100 }, (_, i) => item({
      id: `33333333-1111-4111-8111-${String(i).padStart(12, '4')}`,
    }));
    workoutService.getHistory.mockResolvedValue({
      data: { items: stuckPage, nextCursor: 'c1', limitedToDays: null },   // never advances
    });
    render(<WorkoutCalendar />);

    expect(
      await screen.findByText(/this month couldn’t be read all the way through/i),
    ).toBeTruthy();
    expect(screen.queryByText(/more than a thousand workouts/i)).toBeNull();
  });

  it('never claims a day count for a month it did not finish reading', async () => {
    // The defect this replaces (T3 round 2, F2): a bold "0 active days this
    // month" printed directly beneath a caption admitting the month may be
    // incomplete. The count is only knowable when the whole month was read.
    wholeThenEndless();
    render(<WorkoutCalendar />);

    await waitFor(() => expect(activeDays().textContent).toMatch(/^1\s+active days this month$/));

    fireEvent.click(screen.getAllByRole('button')[0]);   // back one month

    await waitFor(() => expect(activeDays().textContent).toMatch(/unavailable/i));
    expect(activeDays().textContent).not.toMatch(/\b0\b/);
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

  it('counts the ones it did not list when a workout has more than five', async () => {
    // The old backend projected `exercises[:5]` + a total, so "+N more" is a
    // LIVE feature the no-removal rule protects. Every other fixture on this
    // screen has two exercises, which is the fixture-uniformity blind spot this
    // card has now hit three times (T3 round 2, F5) — nothing had ever rendered
    // the sixth.
    workoutService.getHistory.mockResolvedValue(pageOf([item()]));
    workoutService.getWorkout.mockResolvedValue({
      data: {
        sets: ['squat', 'push_up', 'lunge', 'plank', 'burpee', 'jumping_jack']
          .map((exerciseSlug) => ({ exerciseSlug })),
      },
    });
    render(<WorkoutCalendar />);
    await waitFor(() => expect(dayCell(15).disabled).toBe(false));

    fireEvent.click(dayCell(15));

    expect(await screen.findByText('Squat')).toBeTruthy();
    expect(screen.getByText('Burpee')).toBeTruthy();      // the fifth IS named
    expect(screen.queryByText('Jumping Jack')).toBeNull(); // the sixth is not
    expect(screen.getByText('+1 more')).toBeTruthy();
    expect(screen.getByText(/Exercises · 6 total/)).toBeTruthy();
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
  it('asks the NEW api for THIS MONTH, at the shared contract ceiling', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([]));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(workoutService.getHistory).toHaveBeenCalled());
    expect(workoutService.getHistory).toHaveBeenCalledWith({
      limit: 100,
      from: new Date(Y, M, 1).toISOString(),
      to: new Date(Y, M + 1, 1).toISOString(),
    });
  });

  // THE WIRE, not the reader. `workoutHistory.test.js` proves `fetchMonth`
  // BUILDS the window; nothing there proves the screen hands it to the client —
  // and dropping it between the two is silent, because every fixture in this
  // file returns the same page whatever it is asked for. That is the M18 shape
  // exactly (a repoint all 46 tests were happy to see undone), so it is pinned
  // from both ends.
  it('carries the window when the user steps to ANOTHER month', async () => {
    workoutService.getHistory.mockResolvedValue(pageOf([]));
    render(<WorkoutCalendar />);
    await waitFor(() => expect(workoutService.getHistory).toHaveBeenCalled());

    fireEvent.click(screen.getAllByRole('button')[0]);   // back one month

    await waitFor(() => expect(workoutService.getHistory).toHaveBeenCalledWith({
      limit: 100,
      from: new Date(Y, M - 1, 1).toISOString(),
      to: new Date(Y, M, 1).toISOString(),
    }));
  });
});
