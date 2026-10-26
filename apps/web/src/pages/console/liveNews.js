import { useEffect, useRef } from 'react';
import { LIVE_WORDS, liveMessageSchema } from '@app/shared';
import { refreshSession } from '../../api/authApi';

// LIVE UPDATES (ROADMAP Stage 4 item 18; Kd, 2026-10-24). While a console tab is on screen it keeps
// ONE open line to the server for the gym it shows, shared by every part of the page that listens.
// The server says what changed ({ what: 'memberships', entryId }) and the page reads that again
// through its normal route. Every `ready` is told to every listener, the line's first too: a page's
// own first read was answered before its line opened, and a change made in between is in neither.
// Off screen for a minute the line is closed; back on screen it opens again and says `ready`.
//
// The server ends a line when the sign-in runs out (at most 15 minutes): it is opened again within
// a few seconds, after a refreshed sign-in if the server asks for one (one tab at a time:
// `refreshSession`). A refresh that fails for a blip is tried again like a line that would not
// open; a sign-in that is really gone is said as `refused`, so the page checks for itself and its
// own read takes the person to sign in. A line that cannot open waits longer each time, up to a
// minute. Not staff here (404): no line, and nothing is retried.
//
// Besides the server's messages a listener hears two of this file's own: `refused` ({ message }),
// whenever the server refused the line, or it could not be opened twice in a row (the server or the
// network is down), so the page says so and checks for itself until `ready`; and `cameBack`, when the tab comes back on screen
// without a line, so the page reads again as it did before live updates.

const WAITS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
/** A line that ends sooner than this after opening counts as a failure, so it is not opened again at once. */
const SHORT_LINE_MS = 2_000;
/** A line the server ended is opened again within this, at a moment of its own: every window of
 *  the browser, and every browser when the server restarts, does not ask in the same instant. */
const REOPEN_SPREAD_MS = 3_000;
/** How long a line stays open after the last part of the page stops listening: going to another
 *  page of the console that listens too keeps the same line. */
const LINGER_MS = 2_000;

const settings = {
  base: import.meta.env.VITE_API_URL,
  fetch: (...args) => fetch(...args),
  // Tests switch it on, with their own server, so that no other test opens a real line.
  on: import.meta.env.MODE !== 'test',
  /** How long a tab off screen keeps its line: a window covered for a moment, or a quick switch of
   *  tab, does not close and open it again. */
  hiddenMs: 60_000,
};

/** Tests only: the address, the fetch, the switch and the wait off screen. Also forgets every line. */
export function configureLive(next) {
  forgetAll();
  Object.assign(settings, next);
}

const lines = new Map();
let watching = false;

const onScreen = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

function cameBack(line) {
  clearTimeout(line.hidden);
  line.hidden = null;
  if (line.open || line.stopped) return;
  // No line while it was away: the page reads again, and the line is asked for once more.
  for (const listener of [...line.listeners]) listener.fn({ what: 'cameBack' });
  clearTimeout(line.wait);
  line.wait = null;
  connect(line);
}

function watchScreen() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    for (const line of lines.values()) {
      if (onScreen()) cameBack(line);
      else if (line.hidden === null) {
        line.hidden = setTimeout(() => {
          line.hidden = null;
          if (!onScreen()) hangUp(line);
        }, settings.hiddenMs);
      }
    }
  });
  window.addEventListener('online', () => {
    for (const line of lines.values()) {
      clearTimeout(line.wait);
      line.wait = null;
      connect(line);
    }
  });
}

function hangUp(line) {
  clearTimeout(line.linger);
  line.linger = null;
  clearTimeout(line.wait);
  line.wait = null;
  clearTimeout(line.hidden);
  line.hidden = null;
  line.open = false;
  const controller = line.controller;
  line.controller = null;
  controller?.abort();
}

function forgetAll() {
  for (const line of lines.values()) hangUp(line);
  lines.clear();
}

function tryLater(line, ms, counts = true) {
  if (line.controller !== null || line.wait !== null || line.listeners.size === 0) return;
  const wait = ms ?? WAITS_MS[Math.min(line.failures, WAITS_MS.length - 1)];
  if (counts) line.failures += 1;
  // A little either way, so a server that restarts is not asked by every tab in the same instant.
  line.wait = setTimeout(
    () => {
      line.wait = null;
      connect(line);
    },
    counts ? wait * (0.8 + Math.random() * 0.4) : wait,
  );
}

function deliver(line, message) {
  for (const listener of [...line.listeners]) listener.fn(message);
}

/** The sign-in is really gone: no more lines, and the page checks for itself, so its own next read
 *  takes the person to sign in. */
function signedOut(line) {
  line.stopped = true;
  deliver(line, { what: 'refused', message: LIVE_WORDS.unreachable });
}

/** Why the server would not open the line, in its own words where it gave them. */
async function refusalWords(res) {
  try {
    const body = await res.json();
    if (typeof body?.message === 'string' && body.message !== '') return body.message;
  } catch {
    // No words of its own.
  }
  return res.status === 429 ? LIVE_WORDS.rate_limited : LIVE_WORDS.lines_full;
}

async function connect(line) {
  if (!settings.on || !settings.base || line.listeners.size === 0) return;
  if (line.controller !== null || line.wait !== null || line.stopped || !onScreen()) return;
  const controller = new AbortController();
  line.controller = controller;
  const mine = () => line.controller === controller;
  let res;
  try {
    res = await settings.fetch(`${settings.base}/v1/orgs/${encodeURIComponent(line.gymId)}/live`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    });
  } catch {
    if (!mine()) return;
    line.controller = null;
    // One failed try (a blip as the line reopens) is not said; the second in a row is.
    if (line.failures >= 1) deliver(line, { what: 'refused', message: LIVE_WORDS.unreachable });
    tryLater(line);
    return;
  }
  if (!mine()) return;
  if (res.status === 401 && !line.refreshed) {
    line.controller = null;
    line.refreshed = true;
    try {
      await refreshSession();
    } catch (err) {
      if (line.controller !== null || line.listeners.size === 0) return;
      if (err?.response?.status === 401) {
        signedOut(line);
        return;
      }
      // A blip (no network, the server restarting, a 5xx or 429): asked for again, said from the
      // second failure in a row, as a line that would not open is.
      line.refreshed = false;
      if (line.failures >= 1) deliver(line, { what: 'refused', message: LIVE_WORDS.unreachable });
      tryLater(line);
      return;
    }
    connect(line);
    return;
  }
  if (res.status === 401) {
    line.controller = null;
    signedOut(line);
    return;
  }
  if (res.status === 400 || res.status === 403 || res.status === 404) {
    line.controller = null;
    line.stopped = true;
    return;
  }
  if (!res.ok || res.body == null) {
    const refused = res.status === 429 || res.status === 503;
    const words = refused ? await refusalWords(res) : line.failures >= 1 ? LIVE_WORDS.unreachable : null;
    if (!mine()) return;
    line.controller = null;
    if (words !== null) deliver(line, { what: 'refused', message: words });
    const after = Number(res.headers?.get?.('retry-after'));
    tryLater(line, Number.isFinite(after) && after > 0 ? after * 1000 : undefined);
    return;
  }

  const opened = Date.now();
  line.refreshed = false;
  line.open = true;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || !mine()) break;
      buffer += decoder.decode(value, { stream: true });
      let at = buffer.indexOf('\n\n');
      while (at >= 0) {
        const block = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        at = buffer.indexOf('\n\n');
        if (!block.startsWith('data: ')) continue;
        let parsed;
        try {
          parsed = liveMessageSchema.safeParse(JSON.parse(block.slice('data: '.length)));
        } catch {
          continue;
        }
        if (parsed.success) {
          if (parsed.data.what === 'ready') line.failures = 0;
          deliver(line, parsed.data);
        }
      }
    }
  } catch {
    // Lost on the way; opened again below.
  }
  if (!mine()) return;
  line.controller = null;
  line.open = false;
  if (Date.now() - opened < SHORT_LINE_MS) tryLater(line);
  else tryLater(line, Math.random() * REOPEN_SPREAD_MS, false);
}

/** Listens to the gym's line; the answer stops listening. The line closes when nobody listens. */
export function listenLive(gymId, fn) {
  watchScreen();
  let line = lines.get(gymId);
  if (line === undefined) {
    line = { gymId, listeners: new Set(), controller: null, wait: null, linger: null, hidden: null, open: false, failures: 0, refreshed: false, stopped: false };
    lines.set(gymId, line);
  }
  clearTimeout(line.linger);
  line.linger = null;
  const listener = { fn };
  line.listeners.add(listener);
  connect(line);
  return () => {
    line.listeners.delete(listener);
    if (line.listeners.size > 0 || line.linger !== null) return;
    line.linger = setTimeout(() => {
      line.linger = null;
      if (line.listeners.size > 0) return;
      hangUp(line);
      if (lines.get(gymId) === line) lines.delete(gymId);
    }, LINGER_MS);
  };
}

/** A page's part that shows what somebody else can change: `onMessage` hears the gym's news. */
export function useLiveNews(gymId, onMessage, active = true) {
  const latest = useRef(onMessage);
  useEffect(() => {
    latest.current = onMessage;
  });
  useEffect(() => {
    if (!active || !gymId) return undefined;
    return listenLive(gymId, (message) => latest.current(message));
  }, [gymId, active]);
}

/** How long until the gym's next midnight, so a page showing "today" or "this week" reads once as
 *  the gym's day turns, with nobody having changed anything. At least a second; null for a time
 *  zone the browser cannot read. */
export function msToGymMidnight(timezone, now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    return null;
  }
  const part = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const into = (part('hour') * 3600 + part('minute') * 60 + part('second')) * 1000 + now.getMilliseconds();
  return Math.max(1_000, 86_400_000 - into);
}
