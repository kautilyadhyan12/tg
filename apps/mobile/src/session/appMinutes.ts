import { APP_MINUTES_DAYS_MAX, APP_MINUTES_KEEP_DAYS, appMinutesResponseSchema, type AppMinutesDay } from "@app/shared";
import type { TextStore } from "../screens/food/outbox";
import { dayIn } from "../screens/gym/visitsView";
import type { Session } from "./session";

// The minutes the app is open on screen each day (ROADMAP Stage 5 21f), sent to Stage 2 14a-ii's
// `POST /v1/me/app-minutes`. Each day is counted on the person's own calendar, in the phone's time
// zone, kept in that person's own file and sent as its total so far: the server keeps the higher
// total, so a day sent twice changes nothing. A day leaves the file only once the server has taken
// it, and today is kept to go on counting.

/** The longest stretch counted at once. The app counts every minute while it is on screen; a longer
 *  gap means the phone slept without telling it, and that time was not spent in the app. */
export const STRETCH_MOST_MS = 90_000;
/** How often the open app counts and saves. */
export const TICK_MS = 60_000;
/** How often the open app sends; it also sends on opening and on leaving. */
export const SEND_EVERY_MS = 10 * 60_000;

interface KeptDay {
  day: string;
  zone: string;
  /** Seconds, so a part minute is never lost between two stretches. */
  seconds: number;
}

/** What the server said: taken (every day sent is settled), or not now (no answer, a refusal). */
export type MinutesSendResult = "taken" | "later";

export interface MinuteCounterOptions {
  store: TextStore;
  /** Sends as the file's owner, and only while they are the person signed in: "later" otherwise. */
  send: (days: AppMinutesDay[]) => Promise<MinutesSendResult>;
  now: () => number;
  /** The phone's time zone now; null when it does not say (counted in UTC). */
  zone: () => string | null;
}

export interface MinuteCounter {
  /** Reads the file. Nothing is counted or written before it. */
  start: () => Promise<void>;
  /** The app is on screen from now. */
  opened: () => void;
  /** Counts up to now and keeps counting; sends when one is due. */
  tick: () => Promise<void>;
  /** The app has left the screen: counts up to now, saves, and sends unless told not to (a sign-out). */
  closed: (sendToo?: boolean) => Promise<void>;
  send: () => Promise<void>;
  /** The days as they are, for a test or a look. */
  days: () => readonly KeptDay[];
}

/** The days a file holds, each read on its own; anything it cannot read is left out. */
export function readMinutesFile(text: string | null): KeptDay[] {
  if (text === null || text === "") return [];
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof raw !== "object" || raw === null) return [];
  const list: unknown = Reflect.get(raw, "days");
  if (!Array.isArray(list)) return [];
  const out: KeptDay[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const day: unknown = Reflect.get(item, "day");
    const zone: unknown = Reflect.get(item, "zone");
    const seconds: unknown = Reflect.get(item, "seconds");
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (typeof zone !== "string" || zone === "" || zone.length > 64) continue;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) continue;
    if (out.some((d) => d.day === day)) continue;
    out.push({ day, zone, seconds: Math.min(seconds, 86_400) });
  }
  return out;
}

const minutesOf = (seconds: number): number => Math.min(1440, Math.floor(seconds / 60));

/** The calendar day `days` before `day`, both `YYYY-MM-DD`. */
function dayBefore(day: string, days: number): string {
  const ms = Date.parse(`${day}T00:00:00Z`) - days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function createMinuteCounter({ store, send, now, zone }: MinuteCounterOptions): MinuteCounter {
  let days: KeptDay[] = [];
  let started = false;
  let since: number | null = null;
  let lastSent = Number.NEGATIVE_INFINITY;
  let saving: Promise<void> = Promise.resolve();
  let sending: Promise<void> | null = null;

  const zoneNow = (): string => {
    const z = zone();
    return z !== null && dayIn(z, new Date(0)) !== null ? z : "UTC";
  };
  const dayAt = (ms: number, z: string): string => dayIn(z, new Date(ms)) ?? new Date(ms).toISOString().slice(0, 10);

  function add(day: string, z: string, ms: number) {
    if (ms <= 0) return;
    const kept = days.find((d) => d.day === day);
    if (kept === undefined) days.push({ day, zone: z, seconds: ms / 1000 });
    else {
      kept.seconds = Math.min(86_400, kept.seconds + ms / 1000);
      kept.zone = z;
    }
  }

  /** The time from `since` to `end`, each part on its own day: a stretch across midnight is split. */
  function count(end: number) {
    if (!started || since === null) return;
    let from = since;
    since = end;
    if (end <= from) return;
    if (end - from > STRETCH_MOST_MS) from = end - STRETCH_MOST_MS;
    const z = zoneNow();
    const first = dayAt(from, z);
    const last = dayAt(end, z);
    if (first === last) {
      add(first, z, end - from);
      return;
    }
    // The first second of the later day, found by halving the stretch.
    let lo = from;
    let hi = end;
    while (hi - lo > 1000) {
      const mid = Math.floor((lo + hi) / 2);
      if (dayAt(mid, z) === first) lo = mid;
      else hi = mid;
    }
    add(first, z, hi - from);
    add(last, z, end - hi);
  }

  /** Days too old for the server are dropped, and no more than it takes in one send are kept. */
  function trim() {
    const oldest = dayBefore(dayAt(now(), zoneNow()), APP_MINUTES_KEEP_DAYS);
    days = days.filter((d) => d.day >= oldest);
    days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    if (days.length > APP_MINUTES_DAYS_MAX) days = days.slice(days.length - APP_MINUTES_DAYS_MAX);
  }

  /** One write at a time, each the whole file as it is now. A failed write is written again by the next. */
  function keep(): Promise<void> {
    if (!started) return saving;
    saving = saving.then(async () => {
      try {
        await store.write(JSON.stringify({ version: 1, days }));
      } catch {
        // Held in memory, and written with the next count.
      }
    });
    return saving;
  }

  function sendNow(): Promise<void> {
    if (!started) return Promise.resolve();
    if (sending !== null) return sending;
    trim();
    if (days.length === 0) return Promise.resolve();
    const counted = new Map(days.map((d) => [d.day, d.seconds]));
    lastSent = now();
    const away = (async () => {
      const result = await send(days.map((d) => ({ day: d.day, minutes: minutesOf(d.seconds), zone: d.zone })));
      if (result !== "taken") return;
      // Today goes on counting; any day counted further while the send was away stays to be sent again.
      const today = dayAt(now(), zoneNow());
      days = days.filter((d) => {
        if (d.day === today) return true;
        const was = counted.get(d.day);
        return was === undefined || d.seconds > was;
      });
      await keep();
    })();
    // Cleared once it is over, never before it is set: a send that ends at once would otherwise stay "away".
    const done = away.then(
      () => undefined,
      () => undefined,
    );
    sending = done.then(() => {
      sending = null;
    });
    return sending;
  }

  return {
    start: async () => {
      if (started) return;
      let text: string | null = null;
      try {
        text = await store.read();
      } catch {
        text = null;
      }
      days = readMinutesFile(text);
      started = true;
      lastSent = now();
      trim();
    },
    opened: () => {
      since ??= now();
    },
    tick: async () => {
      count(now());
      await keep();
      if (now() - lastSent >= SEND_EVERY_MS) await sendNow();
    },
    closed: async (sendToo = true) => {
      count(now());
      since = null;
      await keep();
      if (sendToo) await sendNow();
    },
    send: sendNow,
    days: () => days.map((d) => ({ ...d })),
  };
}

/** Sends a person's days only while that same person is the one signed in. A file left by somebody
 *  who signed out stays on the phone, and is sent when they sign in again, never as anybody else. */
export function sendAsOwner(session: Pick<Session, "state" | "signedIn">, owner: string) {
  return async (days: AppMinutesDay[]): Promise<MinutesSendResult> => {
    const state = session.state();
    if (state.kind !== "in" || state.user.id !== owner) return "later";
    const answer = await session.signedIn({ method: "POST", path: "/v1/me/app-minutes", body: { days } }, appMinutesResponseSchema);
    return answer.kind === "ok" ? "taken" : "later";
  };
}
