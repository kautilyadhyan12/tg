// The console's open line (ROADMAP Stage 4 item 18): one line a gym for the whole tab, read as the
// server writes it, closed off screen, opened again on screen and when the server ends it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/authApi', () => ({ refreshSession: vi.fn() }));

const { refreshSession } = await import('../../api/authApi');
const { configureLive, listenLive } = await import('./liveNews');

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
  if (next.status !== 200) {
    return Promise.resolve({ status: next.status, ok: false, body: null, headers: new Headers(next.headers ?? {}) });
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
  configureLive({ on: true, base: BASE, fetch: fakeFetch });
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

  it('closes off screen, and on screen again opens a new line whose ready tells the page to read again', async () => {
    const heard = [];
    const stop = listenLive(GYM, (m) => heard.push(m));
    await until(() => calls.length === 1);
    calls[0].write(frame({ what: 'ready' }));
    await pause(20);
    setScreen('hidden');
    expect(calls[0].aborted).toBe(true);
    await pause(50);
    expect(calls).toHaveLength(1);
    setScreen('visible');
    await until(() => calls.length === 2);
    calls[1].write(frame({ what: 'ready' }));
    await until(() => heard.length === 1);
    expect(heard).toEqual([{ what: 'ready' }]);
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
    setScreen('visible');
    await until(() => calls.length === 2);
    calls[1].write(frame({ what: 'ready' }));
    await until(() => later.length === 1 && first.length === 1);
    stopFirst();
    stopLater();
  });

  it('opens again at once when the server ends a line that lived a while', async () => {
    const stop = listenLive(GYM, () => {});
    await until(() => calls.length === 1);
    calls[0].write(frame({ what: 'ready' }));
    await pause(2_100);
    calls[0].end();
    await until(() => calls.length === 2, 500);
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
    const again = listenLive(GYM, () => {});
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

  it('a busy server is asked again after the wait it names', async () => {
    answers = [{ status: 503, headers: { 'retry-after': '1' } }, { status: 200 }];
    const stop = listenLive(GYM, () => {});
    await until(() => calls.length === 1);
    await pause(500);
    expect(calls).toHaveLength(1);
    await until(() => calls.length === 2, 2_000);
    stop();
  });

  it('closes when the last part stops listening, and never opens while switched off', async () => {
    const stopA = listenLive(GYM, () => {});
    const stopB = listenLive(GYM, () => {});
    await until(() => calls.length === 1);
    stopA();
    expect(calls[0].aborted).toBe(false);
    stopB();
    expect(calls[0].aborted).toBe(true);

    configureLive({ on: false });
    calls = [];
    const off = listenLive(GYM, () => {});
    await pause(50);
    expect(calls).toHaveLength(0);
    off();
  });
});
