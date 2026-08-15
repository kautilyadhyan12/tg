// Unit tests for the Dashboard's new-API readers.
//
// These carry over, one for one, the properties the retired `readStatsView`
// suite asserted — a partial 200 fabricates nothing, a real zero is not an
// unknown, an unusable shape is NULL — because the repoint changes which
// server is being distrusted and nothing about how much.
//
// Two of them are NEW and neither existed for the old reader: the day key is
// pinned in a NON-UTC zone (under UTC the local and UTC spellings are identical
// by definition, so the assertion would be inert — the :4267 F2 trap), and the
// duration/hours conversions are pinned on values that are NOT round numbers of
// minutes, because a fixture of 1_800_000 ms is what let :4182's rounding defect
// through a whole suite.
import { afterEach, describe, expect, it } from 'vitest';
import {
  activeDayCount, readDashboardOverview, readRecentWorkouts, readWeekActivity,
  weekOfDates, weekWorkoutCount,
} from './dashboardStats';

describe('readDashboardOverview — per field, so a partial 200 fabricates nothing', () => {
  it('an empty object yields all nulls, never zeros', () => {
    const o = readDashboardOverview({});
    expect(o.totalWorkouts).toBeNull();
    expect(o.totalCalories).toBeNull();
    expect(o.currentStreak).toBeNull();
    expect(o.totalMinutes).toBeNull();
    expect(o.totalHours).toBeNull();
    expect(o.limitedToDays).toBeNull();
  });

  it('a SUBSET arrives usable while the rest stay unknown — round 4 F2', () => {
    const o = readDashboardOverview({ totalWorkouts: 12, currentStreak: 0 });
    expect(o.totalWorkouts).toBe(12);
    expect(o.currentStreak).toBe(0); // a real zero is not an unknown
    expect(o.totalCalories).toBeNull();
    expect(o.totalMinutes).toBeNull();
  });

  it('a non-object body is unknown, not a crash', () => {
    for (const bad of [null, undefined, 'nope', 42, []]) {
      expect(readDashboardOverview(bad).totalWorkouts).toBeNull();
    }
  });

  it('minutes and hours are BOTH derived from the milliseconds', () => {
    // 1 h 5 m 30 s. Deliberately not a round number of minutes: a fixture like
    // 1_800_000 cannot tell a correct conversion from several wrong ones, which
    // is how :4182's rounding defect crossed a whole suite.
    const o = readDashboardOverview({ totalDurationMs: 3_930_000 });
    expect(o.totalMinutes).toBe(66); // 65.5 min → 66
    expect(o.totalHours).toBe(1.1); // 1.0917 h → 1.1
  });

  it('hours does NOT come from the rounded minutes — the chaining control', () => {
    // 62.5 minutes. Rounding to minutes FIRST gives 63, and 63/60 to one
    // decimal is 1.1; straight from the milliseconds it is 1.0417 h → 1.0.
    // The old page chained exactly this way, so the big number and the small
    // one beneath it could disagree — two answers about one measurement.
    // This is the only fixture in the file where the two methods split, and
    // without it `totalHours` could be re-derived from `totalMinutes` with
    // every other assertion here still green.
    const o = readDashboardOverview({ totalDurationMs: 3_750_000 });
    expect(o.totalMinutes).toBe(63);
    expect(o.totalHours).toBe(1);
    expect(o.totalHours).not.toBe(1.1);
  });

  it('carries the plan window through, because the caption needs it', () => {
    expect(readDashboardOverview({ limitedToDays: 90 }).limitedToDays).toBe(90);
    expect(readDashboardOverview({ limitedToDays: null }).limitedToDays).toBeNull();
  });
});

describe('readWeekActivity — an empty map is a fact, a missing one is not', () => {
  it('a trend response becomes a date→count map', () => {
    const w = readWeekActivity({
      points: [
        { date: '2026-08-10', kcal: 120, workouts: 2 },
        { date: '2026-08-12', kcal: 60, workouts: 1 },
      ],
      limitedToDays: null,
    });
    expect(w.byDate).toEqual({ '2026-08-10': 2, '2026-08-12': 1 });
  });

  it('a 200 with NO points array is UNKNOWN — round 4 F3', () => {
    // Not `{}`. Seven unlit dots read as "you trained on none of these days",
    // which is seven claims about a week nobody told us about.
    expect(readWeekActivity({})).toBeNull();
    expect(readWeekActivity({ points: 'soon' })).toBeNull();
    expect(readWeekActivity(null)).toBeNull();
    expect(readWeekActivity([])).toBeNull();
  });

  it('an EMPTY points array is a real, knowable zero week', () => {
    const w = readWeekActivity({ points: [], limitedToDays: null });
    expect(w).not.toBeNull();
    expect(w.byDate).toEqual({});
  });

  it('an unusable point is skipped without poisoning the rest', () => {
    const w = readWeekActivity({
      points: [
        null,
        { date: '', workouts: 3 },
        { date: '2026-08-10', workouts: 'two' },
        { date: '2026-08-11', workouts: 4 },
      ],
    });
    expect(w.byDate).toEqual({ '2026-08-11': 4 });
  });
});

describe('weekOfDates — the key is the day the SERVER buckets by', () => {
  const ORIGINAL_TZ = globalThis.process.env.TZ;
  afterEach(() => { globalThis.process.env.TZ = ORIGINAL_TZ; });

  it('the key is the LOCAL day, not the UTC one — the repoint fix', () => {
    globalThis.process.env.TZ = 'Asia/Kolkata';
    // 20:30Z on Tue 28 Jul is 02:00 IST on WEDNESDAY 29 Jul — the window where
    // the two spellings disagree, and the window the old UTC key was wrong in.
    const instant = new Date('2026-07-28T20:30:00Z');
    // POSITIVE CONTROL, load-bearing: if this runtime ignored the TZ switch,
    // local would equal UTC and every assertion below would pass vacuously.
    // That is exactly how the old defect survived 90 tests.
    expect(instant.getDate(), 'TZ switch did not take effect').toBe(29);

    const w = weekOfDates(instant);
    expect(w.map((d) => d.day)).toEqual([27, 28, 29, 30, 31, 1, 2]);
    // THE ASSERTION THIS CARD ADDS. The retired helper returned '2026-07-26'
    // here — Sunday's UTC date for Monday's local one — because it serialised
    // with `toISOString()`. The server buckets in the user's own timezone, so
    // that key matched nothing and the flames sat one cell to the left for the
    // first five and a half hours of every IST day.
    expect(w[0].key).toBe('2026-07-27');
    expect(w.map((d) => d.key)).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29',
      '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
    ]);
    // …and key and printed day now name the SAME day, which is the property
    // that was broken rather than either half on its own.
    expect(w.map((d) => Number(d.key.slice(-2)))).toEqual(w.map((d) => d.day));
  });

  it('a zone WEST of Greenwich too — the other side of the same defect', () => {
    globalThis.process.env.TZ = 'America/New_York';
    // 02:00Z Wed 29 Jul is 22:00 Tue 28 Jul in New York: here the UTC key ran
    // AHEAD of local, so the old helper's error had the opposite sign. A test
    // in one direction only would not have caught a fix that overshot.
    const instant = new Date('2026-07-29T02:00:00Z');
    expect(instant.getDate(), 'TZ switch did not take effect').toBe(28);
    const w = weekOfDates(instant);
    expect(w.map((d) => d.day)).toEqual([27, 28, 29, 30, 31, 1, 2]);
    expect(w[0].key).toBe('2026-07-27');
    expect(w.map((d) => Number(d.key.slice(-2)))).toEqual(w.map((d) => d.day));
  });

  it('is seven consecutive days starting MONDAY, across a month end', () => {
    globalThis.process.env.TZ = 'Asia/Kolkata';
    const w = weekOfDates(new Date('2026-07-30T06:00:00Z')); // Thu 30 Jul IST
    expect(w).toHaveLength(7);
    expect(w.map((d) => d.day)).toEqual([27, 28, 29, 30, 31, 1, 2]);
    expect(new Date(`${w[0].key}T00:00:00Z`).getUTCDay()).toBe(1); // Monday
    for (let i = 1; i < 7; i++) {
      const prev = new Date(`${w[i - 1].key}T00:00:00Z`).getTime();
      const cur = new Date(`${w[i].key}T00:00:00Z`).getTime();
      expect(cur - prev, `gap between ${w[i - 1].key} and ${w[i].key}`).toBe(86_400_000);
    }
  });
});

describe('the two week numbers come off ONE map — round 10 F1', () => {
  const week = [
    { key: '2026-08-10', day: 10 }, { key: '2026-08-11', day: 11 },
    { key: '2026-08-12', day: 12 }, { key: '2026-08-13', day: 13 },
    { key: '2026-08-14', day: 14 }, { key: '2026-08-15', day: 15 },
    { key: '2026-08-16', day: 16 },
  ];
  // TWO workouts on one day, one on another, plus a day OUTSIDE the window.
  // The outside day is what stops "count the week" from passing while actually
  // counting every key in the payload — round 11's own fixture lesson.
  const byDate = { '2026-08-10': 2, '2026-08-12': 1, '2026-08-03': 5 };

  it('the tile counts WORKOUTS and the caption counts DAYS', () => {
    expect(weekWorkoutCount(byDate, week)).toBe(3);
    expect(activeDayCount(byDate, week)).toBe(2);
  });

  it('a day outside the seven is counted by NEITHER', () => {
    // If the window were ignored both would jump: 8 workouts and 3 days.
    expect(weekWorkoutCount(byDate, week)).not.toBe(8);
    expect(activeDayCount(byDate, week)).not.toBe(3);
  });

  it('a known-but-empty week is 0, and an unknown week is null', () => {
    expect(weekWorkoutCount({}, week)).toBe(0);
    expect(activeDayCount({}, week)).toBe(0);
    expect(weekWorkoutCount(null, week)).toBeNull();
    expect(activeDayCount(null, week)).toBeNull();
  });

  it('a day recorded as ZERO workouts is not an active day', () => {
    expect(activeDayCount({ '2026-08-10': 0 }, week)).toBe(0);
    expect(weekWorkoutCount({ '2026-08-10': 0 }, week)).toBe(0);
  });
});

describe('readRecentWorkouts — an all-unreadable page is UNKNOWN, not empty', () => {
  const row = (over = {}) => ({
    id: '11111111-1111-4111-8111-111111111111',
    startedAt: '2026-08-10T10:00:00Z',
    platform: 'web', setsCount: 2, totalReps: 20,
    avgFormScore: 88, durationMs: 187_000, kcalPoint: 42,
    kcalCalcVersion: 3, qualityFlags: [],
    ...over,
  });

  it('a page becomes rows the pane can draw', () => {
    const { rows } = readRecentWorkouts({ items: [row()], nextCursor: null, limitedToDays: null });
    expect(rows).toHaveLength(1);
    expect(rows[0].durationSeconds).toBe(187); // seconds, never rounded minutes
    expect(rows[0].kcal).toBe(42);
    expect(rows[0].formScore).toBe(88);
  });

  it('a GENUINELY empty page is an empty list — "No workouts logged yet."', () => {
    expect(readRecentWorkouts({ items: [], nextCursor: null, limitedToDays: null }).rows)
      .toEqual([]);
  });

  it('an empty page UNDER A PLAN GATE carries the gate — it is not "none ever"', () => {
    // THE DEFECT THIS PINS. A free plan reads 90 days back (`seed.ts:44`) and
    // the server reports that window on EVERY page, empty or not
    // (`workouts/service.ts:191`). So a user whose last workout is 100 days old
    // gets `{ items: [], limitedToDays: 90 }` — and dropping the flag here
    // renders "No workouts logged yet." to someone with a real history, eight
    // while the totals tile beside it reads 0 for the same reason — round 2's
    // correction to this comment's first draft, which claimed the tile was
    // counting the hidden workouts. It is clamped by the same floor.
    //
    // It is :5104 F4 from the PLAN's side rather than the parser's: two true
    // statements — the page arrived; it holds no rows — composed into a false
    // claim about a history the server merely declined to show. `monthClamp`
    // solved the identical situation for the calendar by NAME
    // (`workoutHistory.js:200-223`).
    const out = readRecentWorkouts({ items: [], nextCursor: null, limitedToDays: 90 });
    expect(out.rows).toEqual([]);
    expect(out.limitedToDays).toBe(90);
  });

  it('the THREE people who reach an empty pane are told apart, not guessed at', () => {
    // ROUND 2's CRITICAL. The gate cannot separate the first two — everyone is
    // gated, so both send `{ items: [], limitedToDays: 90 }` — and whichever
    // sentence the pane picks from the gate alone is false for one of them.
    // The server answers it instead.
    const gated = { items: [], nextCursor: null, limitedToDays: 90 };

    // Brand-new account: nothing exists, and nothing is being withheld.
    expect(readRecentWorkouts({ ...gated, hasAnyWorkouts: false }).hasAnyWorkouts)
      .toBe(false);
    // Lapsed veteran: the history is real and the window is hiding it.
    expect(readRecentWorkouts({ ...gated, hasAnyWorkouts: true }).hasAnyWorkouts)
      .toBe(true);
    // Older server that never heard of the field: UNKNOWN, so the pane says the
    // one thing true either way rather than inventing an answer.
    expect(readRecentWorkouts(gated).hasAnyWorkouts).toBeNull();
    // …and the gate still travels with all three.
    expect(readRecentWorkouts({ ...gated, hasAnyWorkouts: false }).limitedToDays)
      .toBe(90);
  });

  it('a page with ROWS carries hasAnyWorkouts: true from the server, not from the rows', () => {
    // The server sets it true without a probe when the page is non-empty
    // (`service.ts`), so the reader must not re-derive it — two answers to one
    // question is how they come to disagree.
    const out = readRecentWorkouts({
      items: [row()], nextCursor: null, limitedToDays: 90, hasAnyWorkouts: true,
    });
    expect(out.rows).toHaveLength(1);
    expect(out.hasAnyWorkouts).toBe(true);
  });

  it('a gate of 0 or -1 is NO gate, never a window of zero days', () => {
    // `historyGate` maps unlimited to null before it leaves the server
    // (`service.ts:130`), so neither reaches a healthy client — but this reader
    // parses external input (R2.3), and "the last 0 days" is a sentence no
    // screen should be able to print. One rule, in the reader, so the pane's
    // check stays a plain null test (the ONE-LADDER lesson).
    expect(readRecentWorkouts({ items: [], nextCursor: null, limitedToDays: 0 }).limitedToDays)
      .toBeNull();
    expect(readRecentWorkouts({ items: [], nextCursor: null, limitedToDays: -1 }).limitedToDays)
      .toBeNull();
  });

  it('rows that arrived but cannot be read are UNKNOWN — :5104 F4', () => {
    // The lie this prevents: `[]` here renders "No workouts logged yet." to a
    // user who has workouts, composing two true statements (we read a page; we
    // could draw none of it) into a false claim about their history.
    const bad = readRecentWorkouts({ items: [{ nope: true }, { id: 'x' }], nextCursor: null });
    expect(bad).toBeNull();
  });

  it('a PARTLY readable page draws what it can', () => {
    const { rows } = readRecentWorkouts({ items: [row(), { nope: true }], nextCursor: null });
    expect(rows).toHaveLength(1);
  });

  it('a non-page body is unknown', () => {
    expect(readRecentWorkouts({})).toBeNull();
    expect(readRecentWorkouts(null)).toBeNull();
    expect(readRecentWorkouts({ items: 'soon' })).toBeNull();
  });

  it('a null duration/kcal/score stays null rather than becoming zero', () => {
    const { rows } = readRecentWorkouts({
      items: [row({ durationMs: null, kcalPoint: null, avgFormScore: null })],
      nextCursor: null,
    });
    expect(rows[0].durationSeconds).toBeNull();
    expect(rows[0].kcal).toBeNull();
    expect(rows[0].formScore).toBeNull();
  });
});
