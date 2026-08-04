// P2.8 web repoint (workout calendar card) — the workout HISTORY on the NEW
// /v1 API. Discharges the RUNBOOK/cutover.md prerequisite "Workout history
// calendar (WorkoutCalendar → workoutApi.getHistory)".
//
// FOUR THINGS THE OLD BACKEND DID THAT THE NEW ONE DOES NOT, each answered
// here rather than faked:
//
// 1. MONTH QUERIES. `/workouts/history?month=&year=` returned one month,
//    server-grouped into `by_date`. `/v1/workouts` is a keyset cursor list
//    (newest first, @app/shared `workoutListQuerySchema`) with NO date filter.
//    The month is therefore assembled here by walking pages until one lands
//    before the month starts — the Card-5d precedent (DECISIONS 2026-07-19:
//    `listMealsForDay` page-walks the same way, capped, "NO API change, no
//    date filter added"). The cap is load-bearing: a month drawn from a
//    partial walk looks EMPTY, which is a lie about days the user trained, so
//    `truncated` is returned and the page says so instead.
//
// 2. THE PLAN READ-GATE. `/v1/workouts` clamps a free plan to `limitedToDays`
//    (Part 4 §0.2 — a READ GATE, NOT deletion: seed.ts:44 says so, and
//    workouts/repo.ts:183 merely adds `AND started_at >= since`). Browse to a
//    month older than that window and the API honestly returns nothing;
//    drawing it as a blank month tells the user they never trained. `monthClamp`
//    below exists so the page can say the true thing instead. Same fact and the
//    same copy discipline as `pages/progressClamp.js` (the 2026-07-21 card).
//
// 3. DAY BUCKETING. The server used to decide which day a workout belonged to.
//    Now this file does — for DISPLAY GROUPING IN THIS CALENDAR ONLY.
//    `localDateKey` buckets by the viewer's LOCAL calendar day, which is what a
//    calendar means: an 11pm workout in Jorhat belongs to that evening, not to
//    the next UTC day. Streaks, "today" and every other day boundary stay
//    SERVER-side on `users.timezone` (DECISIONS 2026-07-21; playbook trap #8).
//    No day maths is moved into the client by this file.
//
// 4. EXERCISE NAMES. The old `/history` projected up to 5 exercise names per
//    session (workouts.py:388-393) — a LIVE feature, so the no-removal rule
//    (CLAUDE.md MIGRATION STANCE) applies. `workoutListItemSchema` carries no
//    exercise names; `workoutDetailSchema` does, as `sets[].exerciseSlug`. So
//    the chips are read from `GET /v1/workouts/:id`, fetched ONLY when a day's
//    detail panel opens — the one moment they are rendered — rather than N
//    extra requests on every month load.
//
// WHAT IS DELIBERATELY NOT CARRIED OVER: `xp_earned`. OWED.md:963 establishes
// by command that the old backend NEVER WRITES it onto a workout (the
// completion handler `$inc`s the USER total and returns it in that one
// response; the session `$set` stores it nowhere, and `/history` projects a
// field that was never written), so the block "has never rendered for anyone"
// and "the no-removal rule is therefore NOT engaged". Nothing a user has seen
// is lost here. Per-workout XP has no home in the new schema either — `user_xp`
// stores one running total per user (db/schema/game.ts:39) — so restoring it is
// a migration, not a client change, and it keeps its OWED line.

import { UNKNOWN, formatCount, secondsLabel } from './gamificationApi';

/** `workoutListQuerySchema`'s own ceiling (packages/shared/src/workouts.ts:8:
 *  `.max(100)`) — quoted, not chosen. Asking for more is a 400. */
export const HISTORY_PAGE_LIMIT = 100;

/** The walk's hard stop. 10 × 100 = 1,000 workouts scanned before a month is
 *  declared unreachable. Card 5d capped its own page-walk at 10 for the same
 *  reason: an uncapped walk on a long history is an unbounded request burst. */
export const HISTORY_MAX_PAGES = 10;

const pad2 = (n) => String(n).padStart(2, '0');

const finite = (v) => (Number.isFinite(v) ? v : null);
const text = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** The viewer's LOCAL `YYYY-MM-DD` for an ISO timestamp, or NULL when the
 *  timestamp is unreadable. NOT `iso.split('T')[0]` — that is the UTC day, and
 *  it puts every evening workout east of Greenwich on the wrong square. */
export function localDateKey(iso) {
  const s = text(iso);
  if (s === null) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** One page envelope, or NULL when the response is not a page at all.
 *
 *  NULL MEANS UNKNOWN, and the walk aborts to `null` on it rather than
 *  returning the days it had — a half-walked month rendered as a whole one is
 *  the same lie as an empty one. */
export function readWorkoutPage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!Array.isArray(data.items)) return null;
  return {
    items: data.items,
    nextCursor: text(data.nextCursor),
    limitedToDays: finite(data.limitedToDays),
  };
}

/** One list item → what the calendar renders, or NULL when the row cannot be
 *  placed at all (no id to key it by, or no readable start time to bucket it
 *  into a day). A returned session may still carry nulls: those render as the
 *  em dash, never as `0m` / `0 kcal` / `0%`.
 *
 *  READ PER FIELD, not through `workoutListItemSchema.safeParse`, on purpose.
 *  The shared schema demands `platform`, `setsCount`, `totalReps`,
 *  `qualityFlags` and `kcalCalcVersion` — none of which this screen renders —
 *  so a strict parse would DROP a row the calendar could draw perfectly
 *  because of a field it never shows. Round 4 F2's lesson is the same shape
 *  from the other side: an envelope gate that asserts one thing while six
 *  sites read fields off it with `?? 0`. Contract drift is caught instead by
 *  `workoutHistory.test.js`, which feeds a schema-valid item through this
 *  function and fails if a field NAME moves. */
export function readCalendarSession(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const id = text(item.id);
  const startedAt = text(item.startedAt);
  if (id === null || startedAt === null) return null;
  if (!Number.isFinite(Date.parse(startedAt))) return null;
  const durationMs = finite(item.durationMs);
  return {
    id,
    startedAt,
    // SECONDS, not minutes. The old payload carried whole MINUTES, so the first
    // cut of this file rounded to match it — and Kd's smoke on 2026-08-04
    // showed what that does to the new payload's milliseconds: 8,491 ms and
    // 4,767 ms both printed "0m", a workout that took no time at all, while
    // 36,290 ms printed "1m", rounded UP past a minute it never reached. Four
    // sessions on screen and four false numbers, every one of them derived from
    // a duration the server had recorded perfectly well.
    //
    // WHOLE seconds, because the shared `secondsLabel` carries to "1m 60s" on
    // fractional input (its own OWED line, not this card's to fix). An unknown
    // duration stays NULL and is never rounded into a confident anything.
    durationSeconds: durationMs === null ? null : Math.round(durationMs / 1000),
    kcal: finite(item.kcalPoint),
    formScore: finite(item.avgFormScore),
  };
}

/** `slug_case` → `Slug Case`. A LABEL DERIVED FROM THE VALUE, not a name
 *  invented for it: the identifier is unchanged, only its punctuation is.
 *  Real display names (and their hi/as translations) are the exercise-content
 *  card's job — `workoutDetailSchema` carries only the slug today, and
 *  inventing a friendlier name for a slug we do not stock would be the
 *  fabrication class this project keeps deleting. */
export function exerciseLabel(slug) {
  const s = text(slug);
  if (s === null) return null;
  return s
    .split(/[_-]+/)
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** `GET /v1/workouts/:id` → the chips, or NULL when the detail carries no
 *  readable set list. `{ names, total }`: `total` counts every DISTINCT
 *  exercise in the workout, `names` is the first five — the old projection's
 *  own shape (`exercises[:5]` + `exercise_count`, workouts.py:389-391), so the
 *  "+N more" chip keeps meaning exactly what it meant. */
export function readWorkoutExercises(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!Array.isArray(data.sets)) return null;
  const seen = [];
  for (const set of data.sets) {
    if (!set || typeof set !== 'object') continue;
    const label = exerciseLabel(set.exerciseSlug);
    if (label === null) continue;
    if (!seen.includes(label)) seen.push(label);
  }
  return { names: seen.slice(0, 5), total: seen.length };
}

/** Does the plan's read-gate cut into the month being viewed?
 *
 *  `null` — it does not, draw the month normally.
 *  `{ days, whole: true }`  — the WHOLE month predates the window: the API
 *                             returns nothing for it and a blank grid would
 *                             read as "you never trained".
 *  `{ days, whole: false }` — the month straddles the boundary, so its earlier
 *                             days are missing from an otherwise real month.
 *
 *  Deliberately does NOT name the boundary DATE. The floor is the server's to
 *  compute (`workouts/repo.ts:183`); a client day-count across DST would be
 *  approximate, and an approximate date stated precisely is its own small lie.
 *  `days` is the plan's own number, quoted from the response. */
export function monthClamp({ month, year }, limitedToDays, now = new Date()) {
  const days = finite(limitedToDays);
  if (days === null || days <= 0) return null;
  if (!Number.isFinite(month) || !Number.isFinite(year)) return null;
  const floor = now.getTime() - days * 86400000;
  const monthStart = new Date(year, month - 1, 1).getTime();
  const monthEnd = new Date(year, month, 1).getTime();
  if (floor <= monthStart) return null;
  return { days, whole: floor >= monthEnd };
}

/** Assemble one month by walking the cursor list.
 *
 *  `fetchPage({ limit, cursor })` must resolve to the RAW page body. Injected
 *  rather than imported so the walk is testable without a network layer, and
 *  so the component owns the client choice.
 *
 *  Resolves to NULL when the history could not be read at all — the caller must
 *  render that as "couldn't load", NEVER as an empty month. Otherwise:
 *    byDate        `{ 'YYYY-MM-DD': [session, …] }`, each day's sessions
 *                  oldest-first so "Session 1" is the day's first workout (the
 *                  old handler's `.sort("completed_at", 1)`).
 *    limitedToDays the plan window from the last page read, or null.
 *    truncated     the walk hit HISTORY_MAX_PAGES with the month still not
 *                  fully behind it — the days shown may be incomplete.
 *    unreadable    rows the reader could not place. Surfaced rather than
 *                  silently dropped: a silent drop makes "N active days" a
 *                  fabricated COUNT (the PostWorkout round-2 F5 finding). */
export async function fetchMonth(fetchPage, { month, year }) {
  const monthStart = new Date(year, month - 1, 1).getTime();
  const monthEnd = new Date(year, month, 1).getTime();
  if (!Number.isFinite(monthStart) || !Number.isFinite(monthEnd)) return null;

  const byDate = {};
  let cursor;
  let pages = 0;
  let truncated = false;
  let unreadable = 0;
  let limitedToDays = null;

  for (;;) {
    if (pages >= HISTORY_MAX_PAGES) {
      truncated = true;
      break;
    }

    let raw;
    try {
      raw = await fetchPage({ limit: HISTORY_PAGE_LIMIT, cursor });
    } catch {
      return null; // the read FAILED — never the same thing as an empty month
    }
    const page = readWorkoutPage(raw);
    if (page === null) return null;
    pages += 1;
    limitedToDays = page.limitedToDays;

    let reachedStart = false;
    for (const item of page.items) {
      const session = readCalendarSession(item);
      if (session === null) {
        // T3 round 1, F1 (VISIBLE): the walk starts at TODAY and pages
        // BACKWARDS, so viewing an older month scans every NEWER month's rows
        // on the way. Counting an unreadable row from one of them made the
        // caption — "N workouts couldn't be read and are not shown" — a
        // statement about rows the user is not looking at, printed over a month
        // whose every workout was read perfectly.
        //
        // A row whose date is READABLE can be placed even when the rest of it
        // is not, so an out-of-month one is skipped exactly as its readable
        // siblings already are. A row with NO readable date cannot be excluded
        // on month, and is counted for whichever month is on screen — that
        // over-reports across months, and is the honest direction: a silent
        // drop would make "N active days" a fabricated count.
        const bad = Date.parse(text(item?.startedAt) ?? '');
        if (!Number.isFinite(bad) || (bad >= monthStart && bad < monthEnd)) {
          unreadable += 1;
        }
        continue;
      }
      const t = Date.parse(session.startedAt);
      // The list is newest-first, so the first row older than the month means
      // every remaining row is too — but keep scanning THIS page, because a
      // page may straddle the boundary.
      if (t < monthStart) {
        reachedStart = true;
        continue;
      }
      if (t >= monthEnd) continue; // a later month; keep walking backwards
      // No null guard here, and that is deliberate. `localDateKey` returns null
      // only for a non-string/blank value or one `Date.parse` rejects, and
      // `readCalendarSession` has already proven `startedAt` is neither. T3
      // round 1 found the guard that used to sit here was UNREACHABLE — and an
      // unreachable guard reads as protection while protecting nothing, the
      // same class as an assertion that cannot fail.
      const key = localDateKey(session.startedAt);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(session);
    }

    if (reachedStart) break;
    if (page.nextCursor === null) break; // end of history, month fully covered
    cursor = page.nextCursor;
  }

  for (const key of Object.keys(byDate)) {
    byDate[key].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  }

  return { byDate, limitedToDays, truncated, unreadable };
}

/** Display helpers. Each renders the em dash for an unknown rather than a
 *  confident zero — `UNKNOWN` is imported from gamificationApi so this screen
 *  cannot drift to a second glyph (the ONE-LADDER lesson, DECISIONS :2480). */
export function formatDuration(seconds) {
  return seconds === null || seconds === undefined ? UNKNOWN : secondsLabel(seconds);
}
export function formatKcal(kcal) {
  // T3 round 1, F5: this was `String(kcal)`, which printed 1240 where the
  // Dashboard's sibling printed 1,240 — two spellings of one number, the
  // one-ladder class this file already cites for UNKNOWN. It IS that sibling
  // now rather than a copy of it. Every fixture used 210, so nothing saw it.
  return formatCount(kcal);
}
export function formatFormScore(score) {
  return score === null || score === undefined ? UNKNOWN : `${score}%`;
}

/** The form-tint ladder. An UNKNOWN score gets the neutral tint, never the red
 *  one — "we don't know" must not read as "you did badly". Round 8 F5's class
 *  (an unknown badge tier painted bronze), one screen over. */
export const FORM_NEUTRAL = 'rgba(255,255,255,0.55)';
export function formColor(score) {
  if (score === null || score === undefined) return FORM_NEUTRAL;
  if (score >= 80) return '#4ade80';
  if (score >= 60) return '#FF8A1F';
  return '#f87171';
}
