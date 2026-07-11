// P2.3 — streak state machine (Part 7 §3), PURE: dates in, new state out.
// Persistence is repo.ts's job; the day-close sweep is replaced by lazy
// reconciliation with identical stored outcomes (DECISIONS P2.3 GAP-5).
// Day = calendar day in the user's timezone (§3.1); fallback 'UTC' while
// users.timezone is null (GAP-3).

export interface StreakState {
  current: number;
  longest: number;
  /** 'YYYY-MM-DD' in the user's timezone; null = never active. */
  lastActivityDate: string | null;
  freezesAvailable: number;
}

export const EMPTY_STREAK: StreakState = {
  current: 0,
  longest: 0,
  lastActivityDate: null,
  freezesAvailable: 0,
};

/** §3.2: earn 1 per 7 consecutive active days, bank cap 3. `current` is the
 *  consecutive-active-day counter the schema affords (Part 4 §3.8 has no
 *  separate counter), so earning fires when current hits a multiple of 7. */
export const FREEZE_EARN_EVERY = 7;
export const FREEZE_CAP = 3;

/** IANA zone the runtime actually knows, else 'UTC' — a user-supplied
 *  string must never throw out of date math (or SQL). */
export function safeTimeZone(tz: string | null): string {
  if (tz === null || tz === "") return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Calendar day of an instant in a timezone, as 'YYYY-MM-DD' (en-CA locale
 *  emits exactly that shape). */
export function dayInTz(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Whole days from a to b (positive when b is later). Both 'YYYY-MM-DD'. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function addDays(day: string, n: number): string {
  const d = new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** §3.2 auto-spend, lazily: cover fully-missed days (strictly between
 *  lastActivityDate and today — today itself is still open, matching the
 *  day-CLOSE sweep semantics) with banked freezes. A covered day advances
 *  lastActivityDate (that is how "this miss was already paid for" is stored —
 *  the schema has no spend ledger). Not enough freezes → streak resets to 0;
 *  the remaining bank is NOT confiscated (spec is silent; freezes are
 *  earn-only property, and §3.3 bans loss-moment punishment). */
export function reconcile(state: StreakState, today: string): StreakState {
  if (state.lastActivityDate === null || state.current === 0) return state;
  const gap = dayDiff(state.lastActivityDate, today);
  if (gap <= 1) return state; // yesterday/today/future-skew: nothing missed yet
  const missed = gap - 1;
  if (state.freezesAvailable >= missed) {
    return {
      ...state,
      freezesAvailable: state.freezesAvailable - missed,
      lastActivityDate: addDays(state.lastActivityDate, missed),
    };
  }
  return { ...state, current: 0 };
}

/** ≥1 synced qualifying session on `day` (§3.1). Older-than-last days
 *  (offline backfill) are a no-op — history can't retroactively grow a
 *  streak the user already lost. */
export function recordActivity(state: StreakState, day: string): StreakState {
  const s = reconcile(state, day);
  if (s.lastActivityDate !== null && dayDiff(s.lastActivityDate, day) <= 0) return s;
  const consecutive =
    s.current > 0 && s.lastActivityDate !== null && dayDiff(s.lastActivityDate, day) === 1;
  const current = consecutive ? s.current + 1 : 1;
  const earned = current % FREEZE_EARN_EVERY === 0 ? 1 : 0;
  return {
    current,
    longest: Math.max(s.longest, current),
    lastActivityDate: day,
    freezesAvailable: Math.min(FREEZE_CAP, s.freezesAvailable + earned),
  };
}
