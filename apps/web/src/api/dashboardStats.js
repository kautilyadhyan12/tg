// The Dashboard's figures, off the OLD backend and onto the NEW /v1 API.
//
// WHAT THIS REPLACES. `workoutService.getStats()` was one old-backend call
// (`GET /workouts/stats`) returning six figures, a 7-day activity map and the
// last five workouts in a single envelope. It has no new-API twin and never
// needed one: three endpoints that already exist carry all of it.
//
//   totals + streak   → GET /v1/progress/overview?period=all
//   this week + dots  → GET /v1/progress/trend?period=7d
//   recent workouts   → GET /v1/workouts?limit=6
//
// The OWED line said the weekly count "has no home". It has one: the trend
// endpoint reports how many workouts fell on each DAY, so the week's count is
// the sum of this week's days and the lit dots are the same days with a
// non-zero count. ONE read answers both, which is round 10 F1's rule
// (`gamificationApi.js` weekDates' old JSDoc) satisfied by construction rather
// than by two fields agreeing: the caption and the picture cannot disagree
// about a week when neither has its own source.
//
// EVERY FIELD IS READ ON ITS OWN, never behind an envelope gate — round 4 F2's
// rule, carried over verbatim from the reader this file retires. A 200 whose
// body is missing a field must produce NULL for that field and a real value for
// the others; `?? 0` appears nowhere and an unknown reaches the screen as the em
// dash. The one thing that changed is which server is being distrusted, and the
// new one is not trusted any further than the old one was: it is still external
// input (R2.3).
//
// NOT Zod, deliberately, and for a DIFFERENT reason than the old readers gave.
// Theirs was "these shapes die at P2.8". These do not die — but `@app/shared`'s
// `progressOverviewSchema` demands `avgFormScore`, `longestStreak` and
// `consistencyPct`, none of which this screen renders, so a strict parse would
// blank a Dashboard the server had answered perfectly because of a field it
// never shows. That is `readCalendarSession`'s reasoning (workoutHistory.js:121)
// and the same answer applies: read per field, and let a contract-drift test
// feed a schema-valid payload through and fail if a NAME moves.
import { readCalendarSession, readWorkoutPage, localDateKey } from './workoutHistory';

const finite = (v) => (Number.isFinite(v) ? v : null);

/** `GET /v1/progress/overview` → the three stat tiles and the streak.
 *
 *  `period=all` is what the caller must ask for, because these tiles say "all
 *  time". On a plan with a history limit the server clamps that window and
 *  reports the limit in `limitedToDays` — which is why this reader hands it
 *  back rather than dropping it. A total captioned "all time" that covers 90
 *  days is DECISIONS :598's defect, one screen over. */
export function readDashboardOverview(data) {
  const o = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  const ms = finite(o?.totalDurationMs);
  return {
    totalWorkouts: finite(o?.totalWorkouts),
    totalCalories: finite(o?.totalKcal),
    currentStreak: finite(o?.currentStreak),
    // BOTH derived from the milliseconds, never one from the other. The old
    // payload carried whole MINUTES and the hours figure was computed from
    // them; chaining the two roundings makes the big number disagree with the
    // small one beneath it at the last digit, which is two answers about one
    // measurement. `:4182`'s lesson is about a per-workout duration and does
    // not bite a lifetime total — a total really is minutes-shaped — but the
    // double rounding is a separate defect and this is where it would start.
    totalMinutes: ms === null ? null : Math.round(ms / 60_000),
    totalHours: ms === null ? null : Math.round(ms / 360_000) / 10,
    limitedToDays: finite(o?.limitedToDays),
  };
}

/** `GET /v1/progress/trend?period=7d` → `{ byDate, limitedToDays }`, or NULL
 *  when the response is not a trend at all.
 *
 *  NULL IS UNKNOWN AND AN EMPTY MAP IS A FACT. The endpoint returns only the
 *  days that HAVE workouts (`getDailyTrend`'s `GROUP BY day`, repo.ts:354-359),
 *  so an absent day means zero and a missing `points` array means we were not
 *  told. Collapsing those two is round 4 F3's defect — seven unlit dots reading
 *  "you trained on none of these days" when nobody knows.
 *
 *  `date` arrives as `YYYY-MM-DD` in the USER'S OWN timezone, bucketed by
 *  Postgres from `users.timezone`. That is why the week's keys below are LOCAL
 *  and not UTC. */
export function readWeekActivity(data) {
  const o = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  if (o === null || !Array.isArray(o.points)) return null;
  const byDate = {};
  for (const p of o.points) {
    if (!p || typeof p !== 'object') continue;
    const key = typeof p.date === 'string' && p.date.trim() !== '' ? p.date : null;
    const n = finite(p.workouts);
    if (key === null || n === null) continue;
    byDate[key] = (byDate[key] ?? 0) + n;
  }
  return { byDate, limitedToDays: finite(o.limitedToDays) };
}

/** The seven days the strip draws, Monday→Sunday, keyed the way the SERVER
 *  keys them.
 *
 *  THIS IS THE ONE BEHAVIOURAL CHANGE IN THE DATE AXIS, and it is a fix. The
 *  helper this replaces built its key with `toISOString()` — the UTC day of a
 *  locally-computed date — because the OLD backend bucketed by
 *  `datetime.utcnow()`. The new one buckets by the user's own timezone, so a
 *  UTC key would stop matching the payload: east of Greenwich, every key before
 *  the local morning names YESTERDAY, and the flames would sit one cell to the
 *  left for those hours. The old helper's JSDoc said this residual was "the
 *  existing OWED timezone-capture item, not this card's to fix" — it IS this
 *  card's now, because this card is what makes the server's side of it right.
 *
 *  The key goes through `localDateKey` rather than being spelled again here:
 *  the calendar already buckets workouts into local days with it, and two
 *  functions answering "which day is this instant in?" is how they come to
 *  disagree (the ONE-LADDER lesson). It takes an ISO string, so the round trip
 *  through `toISOString()` is deliberate — that string names an INSTANT, and
 *  `localDateKey` is what turns an instant back into the viewer's calendar day.
 *
 *  `day` stays the LOCAL calendar number, unchanged from round 11 F1: it is
 *  what the user's own calendar says, and it now agrees with the key by
 *  construction rather than by coincidence in one timezone. */
export function weekOfDates(today = new Date()) {
  const dayIdx = (today.getDay() + 6) % 7; // Monday = 0
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - dayIdx + i);
    out.push({ key: localDateKey(d.toISOString()), day: d.getDate() });
  }
  return out;
}

/** How many WORKOUTS fell inside the seven days on screen — the "This week"
 *  tile. Two workouts on Monday count twice, which is what the tile's own
 *  sub-label ("workouts") says it counts. */
export function weekWorkoutCount(byDate, week) {
  if (byDate === null || byDate === undefined) return null;
  return week.reduce((n, d) => n + (finite(byDate[d.key]) ?? 0), 0);
}

/** How many DAYS in those seven had any workout — the caption's number, and
 *  the count of lit dots. Same map, same seven keys, so it cannot drift from
 *  the picture beside it. */
export function activeDayCount(byDate, week) {
  if (byDate === null || byDate === undefined) return null;
  return week.filter((d) => (finite(byDate[d.key]) ?? 0) > 0).length;
}

/** `GET /v1/workouts` → the Recent Workouts rows, or NULL when we cannot say.
 *
 *  Reuses the CALENDAR's row reader, which already turns this exact payload
 *  into `{ id, startedAt, durationSeconds, kcal, formScore }` and already
 *  refuses to round a duration into minutes (the :4182 defect: 8,491 ms shown
 *  as "0m"). Two readers for one payload would be two answers about one
 *  workout, and the calendar's is the one with the mutation-audited tests.
 *
 *  AN ALL-UNREADABLE PAGE IS UNKNOWN, NOT EMPTY. If the server sent rows and
 *  not one of them could be read, returning `[]` would render "No workouts
 *  logged yet." — a definite claim about a user's history built out of our own
 *  failure to parse it. That is :5104's F4 exactly, and it is the one case
 *  where a `.filter(Boolean)` quietly composes two true statements into a lie. */
export function readRecentWorkouts(data) {
  const page = readWorkoutPage(data);
  if (page === null) return null;
  const rows = page.items.map(readCalendarSession).filter((s) => s !== null);
  if (rows.length === 0 && page.items.length > 0) return null;
  return rows;
}
