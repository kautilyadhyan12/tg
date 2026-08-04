// P2.8 web repoint (workout calendar card). These tests pin the four things a
// later edit could quietly undo:
//   · a FAILED read resolves to null and is never a month with no days in it;
//   · unknown numbers stay null and render as the em dash, never `0m`/`0%`;
//   · the day key is the viewer's LOCAL day, not `iso.split('T')[0]`;
//   · the walk stops, and SAYS it stopped, instead of drawing a short month.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workoutListItemSchema } from '@app/shared';
import authApi from './authApi';
import mlApi from './mlApi';
import { UNKNOWN } from './gamificationApi';
import { workoutService } from './workoutApi';
import {
  HISTORY_MAX_PAGES, HISTORY_PAGE_LIMIT, FORM_NEUTRAL,
  exerciseLabel, fetchMonth, formatDuration, formatFormScore, formatKcal,
  formColor, localDateKey, monthClamp, readCalendarSession, readWorkoutExercises,
  readWorkoutPage,
} from './workoutHistory';

/** Records what an axios instance was actually asked for. Copied from
 *  `gamificationApi.test.js` — the repoint guard has to see the CLIENT, and a
 *  test that mocks `workoutApi` (as the render suite must) cannot. */
function recordRequests(api) {
  const seen = [];
  api.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, params: config.params });
    return { data: {}, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
}

afterEach(() => {
  authApi.defaults.adapter = undefined;
  mlApi.defaults.adapter = undefined;
  vi.unstubAllGlobals();
});

// THE REPOINT GUARD. Added after the mutation harness caught the hole: M18
// reverted `getHistory` to `mlApi.get('/workouts')` and all 46 tests stayed
// GREEN, because the render suite mocks the whole client module and the unit
// suite never touched it. A repoint nothing asserts is a repoint the next edit
// silently undoes. Same shape as the `getPredictions` guard in
// progressApi.test.js and the leaderboard one in gamificationApi.test.js.
describe('the repoint itself', () => {
  it('history and detail ride the NEW cookie client on /v1', async () => {
    const newSeen = recordRequests(authApi);
    const oldSeen = recordRequests(mlApi);
    await workoutService.getHistory({ limit: 100 });
    await workoutService.getWorkout('w-1');
    expect(newSeen).toEqual([
      { url: '/v1/workouts', method: 'get', params: { limit: 100 } },
      { url: '/v1/workouts/w-1', method: 'get', params: undefined },
    ]);
    expect(oldSeen).toEqual([]);
  });

  it('the surfaces with NO new-API home STILL ride the old client', async () => {
    // Not tidiness — the NO-REMOVAL rule (CLAUDE.md MIGRATION STANCE). A
    // regression here means someone "finished" the repoint by deleting a
    // feature. mlApi's request interceptor reads localStorage (browser-only;
    // it dies at P2.8), so stub it for the node env.
    vi.stubGlobal('localStorage', { getItem: () => null });
    const oldSeen = recordRequests(mlApi);
    const newSeen = recordRequests(authApi);
    await workoutService.getStats();
    await workoutService.getSummary('w-1');
    await workoutService.getTemplates();
    expect(oldSeen.map((s) => s.url)).toEqual([
      '/workouts/stats',
      '/workouts/w-1/summary',
      '/workouts/templates',
    ]);
    expect(newSeen).toEqual([]);
  });
});

/** A row the server could really send, valid against the SHARED contract. */
function validItem(over = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    startedAt: '2026-07-15T09:00:00.000Z',
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

const page = (items, nextCursor = null, limitedToDays = null) => ({
  items, nextCursor, limitedToDays,
});

describe('localDateKey', () => {
  // Constructed from LOCAL components, so the expectation holds in any zone.
  // In a zone with a non-zero offset at least one of these two instants falls
  // on a different UTC day, which is what makes them a real guard against
  // `iso.split('T')[0]`. On a UTC machine neither crosses and the pair cannot
  // distinguish the two implementations — stated rather than papered over.
  it('buckets an early-morning workout on its local day', () => {
    expect(localDateKey(new Date(2026, 6, 15, 1, 0).toISOString())).toBe('2026-07-15');
  });

  it('buckets a late-evening workout on its local day', () => {
    expect(localDateKey(new Date(2026, 6, 15, 23, 0).toISOString())).toBe('2026-07-15');
  });

  it('pads month and day', () => {
    expect(localDateKey(new Date(2026, 0, 5, 12, 0).toISOString())).toBe('2026-01-05');
  });

  it('returns null for anything unreadable', () => {
    for (const bad of [null, undefined, '', '   ', 'not-a-date', 42, {}, []]) {
      expect(localDateKey(bad)).toBeNull();
    }
  });
});

describe('readWorkoutPage', () => {
  it('reads a real page', () => {
    expect(readWorkoutPage(page([validItem()], 'c1', 90))).toEqual({
      items: [validItem()], nextCursor: 'c1', limitedToDays: 90,
    });
  });

  it('is null when the body is not a page', () => {
    for (const bad of [null, undefined, 'items', 42, [], {}, { items: 'nope' }]) {
      expect(readWorkoutPage(bad)).toBeNull();
    }
  });

  it('treats a non-string cursor and a non-numeric limit as absent, not as values', () => {
    const p = readWorkoutPage({ items: [], nextCursor: 7, limitedToDays: 'ninety' });
    expect(p).toEqual({ items: [], nextCursor: null, limitedToDays: null });
  });
});

describe('readCalendarSession', () => {
  it('reads every field the calendar draws', () => {
    expect(readCalendarSession(validItem())).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      startedAt: '2026-07-15T09:00:00.000Z',
      durationMinutes: 30,
      kcal: 210,
      formScore: 88,
    });
  });

  // THE CONTRACT-DRIFT GUARD. The reader deliberately reads per field rather
  // than through `workoutListItemSchema.safeParse` (see its comment), so this
  // is what catches a renamed field in @app/shared: the row is validated by
  // the real schema first, then must survive the reader with nothing unknown.
  it('reads a schema-valid item with no field left unknown', () => {
    const parsed = workoutListItemSchema.parse(validItem());
    const session = readCalendarSession(parsed);
    expect(session).not.toBeNull();
    for (const [key, value] of Object.entries(session)) {
      expect(value, `${key} went unknown — a shared field name may have moved`).not.toBeNull();
    }
  });

  it('is null without an id or a readable start time — the row cannot be placed', () => {
    expect(readCalendarSession(validItem({ id: null }))).toBeNull();
    expect(readCalendarSession(validItem({ id: '   ' }))).toBeNull();
    expect(readCalendarSession(validItem({ startedAt: undefined }))).toBeNull();
    expect(readCalendarSession(validItem({ startedAt: 'yesterday' }))).toBeNull();
    for (const bad of [null, undefined, 'row', 7, []]) {
      expect(readCalendarSession(bad)).toBeNull();
    }
  });

  it('keeps unknown stats NULL instead of zero — the whole point of the card', () => {
    const s = readCalendarSession(
      validItem({ durationMs: null, kcalPoint: null, avgFormScore: null }),
    );
    expect(s.durationMinutes).toBeNull();
    expect(s.kcal).toBeNull();
    expect(s.formScore).toBeNull();
  });

  it('does not turn a real zero into an unknown', () => {
    const s = readCalendarSession(validItem({ durationMs: 0, kcalPoint: 0, avgFormScore: 0 }));
    expect(s).toMatchObject({ durationMinutes: 0, kcal: 0, formScore: 0 });
  });
});

describe('exerciseLabel', () => {
  it('titles a slug without inventing a name', () => {
    expect(exerciseLabel('barbell_squat')).toBe('Barbell Squat');
    expect(exerciseLabel('jump-squat')).toBe('Jump Squat');
    expect(exerciseLabel('squat')).toBe('Squat');
  });

  it('is null for anything that is not a slug', () => {
    for (const bad of [null, undefined, '', '  ', 12, {}]) {
      expect(exerciseLabel(bad)).toBeNull();
    }
  });
});

describe('readWorkoutExercises', () => {
  const detail = (slugs) => ({ sets: slugs.map((s, i) => ({ setIndex: i, exerciseSlug: s })) });

  it('counts DISTINCT exercises and previews the first five', () => {
    const r = readWorkoutExercises(
      detail(['squat', 'squat', 'push_up', 'lunge', 'plank', 'burpee', 'crunch']),
    );
    expect(r.total).toBe(6);
    expect(r.names).toEqual(['Squat', 'Push Up', 'Lunge', 'Plank', 'Burpee']);
  });

  it('skips unreadable set rows rather than throwing', () => {
    const r = readWorkoutExercises({ sets: [null, 'x', { exerciseSlug: 42 }, { exerciseSlug: 'squat' }] });
    expect(r).toEqual({ names: ['Squat'], total: 1 });
  });

  it('is null when there is no set list at all', () => {
    for (const bad of [null, undefined, {}, { sets: 'squat' }, []]) {
      expect(readWorkoutExercises(bad)).toBeNull();
    }
  });
});

describe('monthClamp', () => {
  const now = new Date(2026, 6, 31, 12, 0); // 31 July 2026, local

  it('is silent when the plan window covers the whole month', () => {
    expect(monthClamp({ month: 7, year: 2026 }, 90, now)).toBeNull();
    expect(monthClamp({ month: 7, year: 2026 }, null, now)).toBeNull();
    expect(monthClamp({ month: 7, year: 2026 }, 0, now)).toBeNull();
  });

  it('flags a month that is entirely outside the window', () => {
    expect(monthClamp({ month: 1, year: 2026 }, 90, now)).toEqual({ days: 90, whole: true });
  });

  it('flags a month the window cuts into', () => {
    // 90 days back from 31 Jul 2026 lands inside May.
    expect(monthClamp({ month: 5, year: 2026 }, 90, now)).toEqual({ days: 90, whole: false });
  });

  it('never guesses from a non-numeric window or month', () => {
    expect(monthClamp({ month: 5, year: 2026 }, 'ninety', now)).toBeNull();
    expect(monthClamp({ month: NaN, year: 2026 }, 90, now)).toBeNull();
  });
});

describe('fetchMonth', () => {
  const july = { month: 7, year: 2026 };
  const at = (d, h = 9) => new Date(2026, 6, d, h).toISOString();

  it('groups a month by local day, oldest session first within a day', () => {
    const pages = [page([
      validItem({ id: 'b', startedAt: at(15, 18) }),
      validItem({ id: 'a', startedAt: at(15, 7) }),
      validItem({ id: 'c', startedAt: at(2) }),
    ])];
    return fetchMonth(async () => pages.shift(), july).then((r) => {
      expect(Object.keys(r.byDate).sort()).toEqual(['2026-07-02', '2026-07-15']);
      expect(r.byDate['2026-07-15'].map((s) => s.id)).toEqual(['a', 'b']);
      expect(r.truncated).toBe(false);
      expect(r.unreadable).toBe(0);
    });
  });

  it('walks pages until one lands before the month starts', async () => {
    const seen = [];
    const bodies = [
      page([validItem({ id: 'aug', startedAt: new Date(2026, 7, 3).toISOString() })], 'c1'),
      page([validItem({ id: 'jul', startedAt: at(20) })], 'c2'),
      page([validItem({ id: 'jun', startedAt: new Date(2026, 5, 28).toISOString() })], 'c3'),
      page([validItem({ id: 'never', startedAt: at(1) })], null),
    ];
    const r = await fetchMonth(async (params) => {
      seen.push(params.cursor);
      return bodies.shift();
    }, july);
    expect(seen).toEqual([undefined, 'c1', 'c2']); // stopped at the June row
    expect(Object.keys(r.byDate)).toEqual(['2026-07-20']);
  });

  it('stops at the end of history without claiming truncation', async () => {
    const r = await fetchMonth(async () => page([validItem({ startedAt: at(9) })], null), july);
    expect(r.truncated).toBe(false);
  });

  it('caps the walk and SAYS so, rather than drawing a short month', async () => {
    let calls = 0;
    const r = await fetchMonth(async () => {
      calls += 1;
      return page([validItem({ id: `x${calls}`, startedAt: at(10) })], `c${calls}`);
    }, july);
    expect(calls).toBe(HISTORY_MAX_PAGES);
    expect(r.truncated).toBe(true);
  });

  it('asks for the contract ceiling and omits the cursor on the first page', async () => {
    const seen = [];
    await fetchMonth(async (p) => { seen.push(p); return page([], null); }, july);
    expect(seen).toEqual([{ limit: HISTORY_PAGE_LIMIT, cursor: undefined }]);
    expect(HISTORY_PAGE_LIMIT).toBe(100); // shared workoutListQuerySchema's .max
  });

  it('resolves NULL when the request throws — a failure is not an empty month', async () => {
    expect(await fetchMonth(async () => { throw new Error('offline'); }, july)).toBeNull();
  });

  it('resolves NULL when the body is not a page', async () => {
    expect(await fetchMonth(async () => ({ by_date: {} }), july)).toBeNull();
  });

  it('aborts the whole walk if a LATER page fails, rather than returning a part-month', async () => {
    const bodies = [page([validItem({ startedAt: at(28) })], 'c1'), null];
    expect(await fetchMonth(async () => bodies.shift(), july)).toBeNull();
  });

  it('counts unreadable rows instead of dropping them silently', async () => {
    const r = await fetchMonth(async () => page([
      validItem({ startedAt: at(4) }),
      validItem({ id: null, startedAt: at(4) }),
      validItem({ startedAt: 'sometime' }),
    ], null), july);
    expect(r.unreadable).toBe(2);
    expect(Object.keys(r.byDate)).toEqual(['2026-07-04']);
  });

  it('carries the plan window out of the response', async () => {
    const r = await fetchMonth(async () => page([], null, 90), july);
    expect(r.limitedToDays).toBe(90);
  });
});

describe('display helpers', () => {
  it('render the em dash for unknowns, never a zero', () => {
    expect(formatDuration(null)).toBe(UNKNOWN);
    expect(formatKcal(undefined)).toBe(UNKNOWN);
    expect(formatFormScore(null)).toBe(UNKNOWN);
  });

  it('render real values, including real zeros', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatKcal(0)).toBe('0');
    expect(formatFormScore(0)).toBe('0%');
    expect(formatDuration(35)).toBe('35m');
  });

  it('tints an UNKNOWN form score neutrally, never red', () => {
    expect(formColor(null)).toBe(FORM_NEUTRAL);
    expect(formColor(undefined)).toBe(FORM_NEUTRAL);
    expect(formColor(90)).toBe('#4ade80');
    expect(formColor(70)).toBe('#FF8A1F');
    expect(formColor(10)).toBe('#f87171');
  });
});
