import { useEffect, useRef } from 'react';
import { liveMessageSchema } from '@app/shared';
import { refreshSession } from '../../api/authApi';

// LIVE UPDATES (ROADMAP Stage 4 item 18; Kd, 2026-10-24). While a console tab is on screen it keeps
// ONE open line to the server for the gym it shows, shared by every part of the page that listens.
// The server says what changed ({ what: 'memberships', entryId }) and the page reads that again
// through its normal route. Off screen the line is closed; back on screen it opens again and says
// `ready`, and a page that was already listening reads again whatever it may have missed.
//
// The server ends a line when the sign-in runs out (at most 15 minutes): it is opened again at
// once, after a refreshed sign-in if the server asks for one. A line that cannot open waits
// longer each time, up to a minute. Not staff here (404): no line, and nothing is retried.

const WAITS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];
/** A line that ends sooner than this after opening counts as a failure, so it is not opened again at once. */
const SHORT_LINE_MS = 2_000;
/** How long a line stays open after the last part of the page stops listening: going to another
 *  page of the console that listens too keeps the same line. */
const LINGER_MS = 2_000;

const settings = {
  base: import.meta.env.VITE_API_URL,
  fetch: (...args) => fetch(...args),
  // Tests switch it on, with their own server, so that no other test opens a real line.
  on: import.meta.env.MODE !== 'test',
};

/** Tests only: the address, the fetch and the switch. Also forgets every line. */
export function configureLive(next) {
  forgetAll();
  Object.assign(settings, next);
}

const lines = new Map();
let watching = false;

const onScreen = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

function watchScreen() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    for (const line of lines.values()) {
      if (onScreen()) connect(line);
      else hangUp(line);
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
  line.open = false;
  const controller = line.controller;
  line.controller = null;
  controller?.abort();
}

function forgetAll() {
  for (const line of lines.values()) hangUp(line);
  lines.clear();
}

function tryLater(line, ms) {
  if (line.controller !== null || line.wait !== null || line.listeners.size === 0) return;
  const wait = ms ?? WAITS_MS[Math.min(line.failures, WAITS_MS.length - 1)];
  line.failures += 1;
  // A little either way, so a server that restarts is not asked by every tab in the same instant.
  line.wait = setTimeout(() => {
    line.wait = null;
    connect(line);
  }, wait * (0.8 + Math.random() * 0.4));
}

function deliver(line, message) {
  for (const listener of [...line.listeners]) {
    if (message.what === 'ready') {
      // A page reads for itself when it is drawn; it reads again only for a line opened since.
      if (listener.seenReady) listener.fn(message);
      listener.seenReady = true;
    } else {
      listener.fn(message);
    }
  }
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
    tryLater(line);
    return;
  }
  if (!mine()) return;
  if (res.status === 401 && !line.refreshed) {
    line.controller = null;
    line.refreshed = true;
    try {
      await refreshSession();
    } catch {
      // The sign-in is gone; the page's own reads take the person to sign in.
      line.stopped = true;
      return;
    }
    connect(line);
    return;
  }
  if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
    line.controller = null;
    line.stopped = true;
    return;
  }
  if (!res.ok || res.body == null) {
    line.controller = null;
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
  else connect(line);
}

/** Listens to the gym's line; the answer stops listening. The line closes when nobody listens. */
export function listenLive(gymId, fn) {
  watchScreen();
  let line = lines.get(gymId);
  if (line === undefined) {
    line = { gymId, listeners: new Set(), controller: null, wait: null, linger: null, open: false, failures: 0, refreshed: false, stopped: false };
    lines.set(gymId, line);
  }
  clearTimeout(line.linger);
  line.linger = null;
  // Joining a line already open: its `ready` has gone, and the next one means it was away.
  const listener = { fn, seenReady: line.open };
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
