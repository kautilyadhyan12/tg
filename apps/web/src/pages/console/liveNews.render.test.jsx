// The console's open line (ROADMAP Stage 4 item 18): one line a gym for the whole tab, read as the
// server writes it, closed off screen, opened again on screen and when the server ends it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/authApi', () => ({ refreshSession: vi.fn() }));

const { refreshSession } = await import('../../api/authApi');
const { configureLive, listenLive, msToGymMidnight } = await import('./liveNews');
const { LIVE_WORDS } = await import('@app/shared');

const BASE = 'http://api.test';
const GYM = '00000000-0000-4000-8000-0000000000a1';
const OTHER_GYM = '00000000-0000-4000-8000-0000000000b2';
const MAYA = '00000000-0000-4000-8000-0000000000c3';

let screenState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => screenState });
const setScreen = (state) => {
  screenState = state;
  document.dispatchEvent(new Event('visibilitychange'));
};

/** Each request the page makes, and a way to write on its line or end it. */
let calls = [];
let answers = [];
const encoder = new TextEncoder();
function fakeFetch(url, init) {
  const call = { url, init, aborted: false, write: null, end: null };
  calls.push(call);
  init.signal.addEventListener('abort', () => {
    call.aborted = true;
    try {
      call.stream?.error(new Error('aborted'));
    } catch {
      // Already closed.
    }
  });
  const next = answers.shift() ?? { status: 200 };
  if (next.throws === true) return Promise.reject(new TypeError('Failed to fetch'));
  if (next.status !== 200) {
    return Promise.resolve({
      status: next.status,
      ok: false,
      body: null,
      headers: new Headers(next.headers ?? {}),
      json: () => (next.json === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(next.json)),
    });
  }
  const body = new ReadableStream({
    start(controller) {
      call.stream = controller;
      call.write = (text) => controller.enqueue(encoder.encode(text));
      call.end = () => controller.close();
    },
  });
  return Promise.resolve({ status: 200, ok: true, body, headers: new Headers({ 'content-type': 'text/event-stream' }) });
}
const frame = (message) => `data: ${JSON.stringify(message)}\n\n`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 3_000) {
  const by = Date.now() + ms;
  while (!check()) {
    if (Date.now() > by) throw new Error('waited too long');
    await pause(10);
  }
}
const open = (gymId) => calls.filter((c) => c.url === `${BASE}/v1/orgs/${gymId}/live` && !c.aborted);

beforeEach(() => {
  calls = [];
  answers = [];
  screenState = 'visible';
  refreshSession.mockReset();
  // A tab off screen keeps its line 100 ms here (a minute in the console).
  configureLive({ on: true, base: BASE, fetch: fakeFetch, hiddenMs: 100 });
});
afterEach(() => {
  configureLive({ on: false });
});

describe('the open line', () => {
  it('is one line a gym, with the sign-in cookie; each part hears its own gym only, and the first ready is not news', async () => {
    const first = [];
    const second = [];
    const other = [];
    const stops = [listenLive(GYM, (m) => first.push(m)), listenLive(GYM, (m) => second.push(m)), listenLive(OTHER_GYM, (m) => other.push(m))];
    await until(() => calls.length === 2);
    expect(open(GYM)).toHaveLength(1);
    expect(open(GYM)[0].init.credentials).toBe('include');
    const line = open(GYM)[0];
    line.write(frame({ what: 'ready' }));
    line.write(frame({ what: 'memberships', entryId: MAYA }));
    await until(() => first.length === 1 && second.length === 1);
    expect(first).toEqual([{ what: 'memberships', entryId: MAYA }]);
    expect(second).toEqual(first);
    expect(other).toEqual([]);
    stops.forEach((stop) => stop());
  });

  it('skips the heartbeat and anything that is not news, even split across reads', async () => {
    const heard = [];
    const stop = listenLive(GYM, (m) => heard.push(m));
    await until(() => calls.length === 1);
    const line = calls[0];
    line.write(frame({ what: 'ready' }));
    line.write(': still here\n\n');
    line.write('data: not json\n\n');
    line.write(frame({ what: 'memberships', entryId: 'not-an-id' }));
    line.write(frame({ what: 'memberships', entryId: MAYA, fullName: 'Maya Patel' }));
    line.write(frame({ what: 'payments' }));
    const whole = frame({ what: 'memberships', entryId: MAYA });
    line.write(whole.slice(0, 12));
    line.write(whole.slice(12));
    await until(() => heard.length === 1);
    await pause(50);
    expect(heard).toEqual([{ what: 'memberships', entryId: MAYA }]);
    stop();
  });

  it('closes a while after going off screen; back on screen the page reads again at once and a new line opens', async () => {
    const heard = [];
    const stop = listenLive(GYM, (m) => heard.push(m));
    await until(() => calls.length === 1);
    calls[0].write(frame({ what: 'ready' }));
    await pause(20);
    setScreen('hidden');
    expect(calls[0].aborted).toBe(false);
    await until(() => calls[0].aborted, 1_000);
    await pause(50);
    expect(calls).toHaveLength(1);
    setScreen('visible');
    expect(heard).toEqual([{ what: 'cameBack' }]);
    await until(() => calls.length === 2);
    calls[1].write(frame({ what: 'ready' }));
    await until(() => heard.length === 2);
    expect(heard).toEqual([{ what: 'cameBack' }, { what: 'ready' }]);
    stop();
  });

  it('a window covered for a moment, or a quick switch of tab, keeps its line and reads nothing', async () => {
    const heard = [];
    const stop = listenLive(GYM, (m) => heard.push(m));
    await until(() => calls.length === 1);
    calls[0].write(frame({ what: 'ready' }));
    await pause(20);
    setScreen('hidden');
    await pause(30);
    setScreen('visible');
    await pause(200);
    expect([calls.length, calls[0].aborted, heard]).toEqual([1, false, []]);
    // News that came while it was covered is still heard.
    calls[0].write(frame({ what: 'memberships', entryId: MAYA }));
    await until(() => heard.length === 1);
    stop();
  });

  it('a part that joins a line already open reads again when that line comes back', async () => {
    const first = [];
    const later = [];
    const stopFirst = listenLive(GYM, (m) => first.push(m));
    await until(() => calls.length === 1);
    calls[0].write(frame({ what: 'ready' }));
    await pause(20);
    const stopLater = listenLive(GYM, (m) => later.push(m));
    expect(calls).toHaveLength(1);
    setScreen('hidden');
    await until(() => calls[0].aborted, 1_000);
    setScreen('visible');
    await until(() => calls.length === 2);
    calls[1].write(frame({ what: 'ready' }));
    await until(() => later.length === 2 && first.length === 2);
    expect(later).toEqual([{ what: 'cameBack' }, { what: 'ready' }]);
    stopFirst();
    stopLater();
  });

  it('opens again within a few seconds, at a moment of its own, when the server ends a line that lived a while', async () => {
    const stop = listenLive(GYM, () => {});
    await until(() => calls.length === 1);
    calls[0].write(frame({ what: 'ready' }));
    await pause(2_100);
    calls[0].end();
    await until(() => calls.length === 2, 3_500);
    stop();
  });

  it('refreshes the sign-in once when the server asks, then opens; asked again, it stops', async () => {
    answers = [{ status: 401 }, { status: 200 }];
    refreshSession.mockResolvedValue({});
    const stop = listenLive(GYM, () => {});
    await until(() => calls.length === 2);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    stop();

    calls = [];
    answers = [{ status: 401 }, { status: 401 }];
    const again = listenLive(OTHER_GYM, () => {});
    await until(() => calls.length === 2);
    await pause(1_500);
    expect(calls).toHaveLength(2);
    again();
  });

  it('a sign-in that cannot be refreshed, or a gym where they are not staff, is not asked again', async () => {
    answers = [{ status: 401 }];
    refreshSession.mockRejectedValue(new Error('gone'));
    const stop = listenLive(GYM, () => {});
    await until(() => calls.length === 1);
    await pause(1_500);
    expect(calls).toHaveLength(1);
    stop();

    calls = [];
    answers = [{ status: 404 }];
    const notStaff = listenLive(OTHER_GYM, () => {});
    await until(() => calls.length === 1);
    await pause(1_500);
    expect(calls).toHaveLength(1);
    notStaff();
  });

  it('a busy server is asked again after the wait it names, and the page is told why it has no line until then', async () => {
    answers = [{ status: 503, headers: { 'retry-after': '1' } }, { status: 200 }];
    const heard = [];
    const stop = listenLive(GYM, (m) => heard.push(m));
    await until(() => calls.length === 1);
    await pause(500);
    expect(calls).toHaveLength(1);
    expect(heard).toEqual([{ what: 'refused', message: LIVE_WORDS.lines_full }]);
    await until(() => calls.length === 2, 2_000);
    stop();
  });

  it('a server error, a proxy with no server behind it, or no network at all: the page is told it has no line, each time, until the line opens', async () => {
    answers = [{ status: 500 }, { status: 502 }, { throws: true }, { status: 200 }];
    const heard = [];
    const stop = listenLive(GYM, (m) => heard.push(m));
    await until(() => heard.length === 3, 12_000);
    expect(heard).toEqual([
      { what: 'refused', message: LIVE_WORDS.unreachable },
      { what: 'refused', message: LIVE_WORDS.unreachable },
      { what: 'refused', message: LIVE_WORDS.unreachable },
    ]);
    // The fourth try opens the line, and nothing more is said.
    await until(() => calls.length === 4, 12_000);
    await pause(50);
    expect(heard).toHaveLength(3);
    stop();
  }, 30_000);

  it("a line refused in the server's own words says them, and staff coming back to the tab read again", async () => {
    answers = [{ status: 429, json: { error: 'too_many_lines', message: LIVE_WORDS.too_many_lines } }];
    const heard = [];
    const stop = listenLive(GYM, (m) => heard.push(m));
    await until(() => heard.length === 1);
    expect(heard).toEqual([{ what: 'refused', message: LIVE_WORDS.too_many_lines }]);
    setScreen('hidden');
    setScreen('visible');
    expect(heard.at(-1)).toEqual({ what: 'cameBack' });
    stop();
  });

  it('closes a moment after the last part stops listening, keeps it for a part that comes straight back, and never opens while switched off', async () => {
    const stopA = listenLive(GYM, () => {});
    const stopB = listenLive(GYM, () => {});
    await until(() => calls.length === 1);
    stopA();
    stopB();
    // Another page of the console listening at once keeps the same line.
    const next = listenLive(GYM, () => {});
    await pause(2_300);
    expect(calls).toHaveLength(1);
    expect(calls[0].aborted).toBe(false);
    next();
    expect(calls[0].aborted).toBe(false);
    await until(() => calls[0].aborted, 3_000);

    configureLive({ on: false });
    calls = [];
    const off = listenLive(GYM, () => {});
    await pause(50);
    expect(calls).toHaveLength(0);
    off();
  });
});

describe("the gym's midnight", () => {
  it.each([
    ['a minute before, in London summer time', 'Europe/London', '2026-10-03T22:59:00.000Z', 60_000],
    ['just after, in Kolkata', 'Asia/Kolkata', '2026-10-07T18:30:01.000Z', 86_399_000],
    ['noon in Chicago', 'America/Chicago', '2026-10-07T17:00:00.000Z', 43_200_000],
    ['the last half second is still a second', 'UTC', '2026-10-07T23:59:59.500Z', 1_000],
    ['the reader in another zone does not matter', 'Pacific/Auckland', '2026-10-07T10:30:00.000Z', 1_800_000],
    // On the evening of a clock change the wall clock is what counts: 22:00 is two hours before midnight.
    ["the evening before London's clocks go back", 'Europe/London', '2026-10-24T21:00:00.000Z', 7_200_000],
    ["the evening before Chicago's clocks go forward", 'America/Chicago', '2027-03-14T04:00:00.000Z', 7_200_000],
  ])('%s', (_name, zone, at, wait) => {
    expect(msToGymMidnight(zone, new Date(at))).toBe(wait);
  });

  it('a zone the browser cannot read gives no wait', () => {
    expect(msToGymMidnight('Not/AZone', new Date('2026-10-07T10:00:00.000Z'))).toBeNull();
  });
});
