// P2.8 web repoint (workout calendar card) — the workout HISTORY on the NEW
// /v1 API. Discharges the RUNBOOK/cutover.md prerequisite "Workout history
// calendar (WorkoutCalendar → workoutApi.getHistory)".
//
// FOUR THINGS THE OLD BACKEND DID THAT THE NEW ONE DOES NOT, each answered
// here rather than faked:
//
// 1. MONTH QUERIES. `/workouts/history?month=&year=` returned one month,
//    server-grouped into `by_date`. `/v1/workouts` is a keyset cursor list
//    (newest first, @app/shared `workoutListQuerySchema`) which since
//    2026-08-04 takes a HALF-OPEN date window — `from` inclusive, `to`
//    exclusive, absolute INSTANTS rather than calendar dates. So this file
//    ASKS FOR THE MONTH: it converts the viewer's own local month boundaries
//    to instants and sends them, and one request returns the month at any
//    depth of history. Half-open is what makes adjacent months TILE — a
//    workout at local midnight on the 1st belongs to exactly one of them.
//
//    IT DID NOT ALWAYS, and the reason the walk below still exists is the
//    reason this comment is long. Until that API card there was no date
//    filter, so the month was assembled by paging BACKWARDS FROM TODAY until a
//    page landed before the month started, capped at 10 × 100 = 1,000 rows
//    (the Card-5d precedent, DECISIONS 2026-07-19). Anyone with 1,000
//    workouts logged SINCE the month they were browsing never reached it and
//    got an EMPTY month — four sessions a week for five years, which is a real
//    user and not a hypothetical one (Kd, 2026-08-04, correcting this file's
//    own author for calling that state "unreachable").
//
//    What survives is in-month paging ONLY: a month holding more than 100
//    workouts still needs a second page. The cap survives with it, so
//    `truncated` still exists — but it now means "more than a thousand
//    workouts IN THIS ONE MONTH", a different and far rarer claim than the one
//    it used to make. It is NOT deleted for being rare. This card has already
//    been bitten once for treating "should be unreachable" as "cannot happen".
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

/** The in-month walk's hard stop. 10 × 100 = 1,000 workouts IN THE MONTH ON
 *  SCREEN before it is declared incomplete — no longer 1,000 workouts scanned
 *  on the way TO it, which is the whole of what this card changed. Kept at 10
 *  deliberately (the handover's own instruction): an uncapped walk is an
 *  unbounded request burst, and a month that could exhaust it is a month
 *  nothing else in this screen is built for either. */
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

/** Assemble one month by ASKING the API for it.
 *
 *  `fetchPage({ limit, from, to, cursor })` must resolve to the RAW page body.
 *  Injected rather than imported so this is testable without a network layer,
 *  and so the component owns the client choice.
 *
 *  `from`/`to` are the viewer's own LOCAL month boundaries converted to
 *  absolute instants — local midnight on the 1st, inclusive, to local midnight
 *  on the 1st of the next month, exclusive. The conversion happens HERE and not
 *  on the server on purpose: a calendar month is local to whoever is looking at
 *  it, and the server has no business deciding whose midnight that is. Every
 *  day boundary therefore stays exactly where it already lived — `users.timezone`
 *  server-side for streaks, the viewer's local day for this grid's GROUPING only
 *  (DECISIONS 2026-07-21; playbook trap #8). No day maths moves anywhere.
 *
 *  Resolves to NULL when the history could not be read at all — the caller must
 *  render that as "couldn't load", NEVER as an empty month. Otherwise:
 *    byDate        `{ 'YYYY-MM-DD': [session, …] }`, each day's sessions
 *                  oldest-first so "Session 1" is the day's first workout (the
 *                  old handler's `.sort("completed_at", 1)`).
 *    limitedToDays the plan window from the last page read, or null.
 *    truncated     the in-month walk hit HISTORY_MAX_PAGES and the days shown
 *                  may be incomplete. Before the API's date window this meant
 *                  something else and far more reachable: 1,000 workouts
 *                  logged BETWEEN today and the month, which drew the month
 *                  blank. That is the defect this card closed.
 *    inWindow      rows the server returned that PROVABLY belong to this month
 *                  — placed ones, plus unreadable ones whose date is readable
 *                  and inside it. It exists so the caller can tell the two
 *                  truncation causes apart, and it is deliberately CONSERVATIVE
 *                  (a row with no readable date is not counted, because it is
 *                  not known to be in this month). It can therefore under-state
 *                  the volume, never over-state it, and under-stating only
 *                  costs a vaguer sentence.
 *
 *                  WHY IT EXISTS — the T3 on d28ace5, F3, measured. `truncated`
 *                  alone does NOT mean "this month has a thousand workouts". A
 *                  server that ACCEPTS the window and mis-applies it — answering
 *                  July's request with August's rows — fills all ten pages while
 *                  the in-window filter below places NOTHING, so the screen
 *                  drew an empty grid captioned "this month has more than a
 *                  thousand workouts": the caption false in a THIRD direction,
 *                  and this time fabricating a volume out of rows that were
 *                  never this month's. Removing the early break was argued only
 *                  from "a short month with no caption"; it also turned that
 *                  silent short month into a falsely-captioned empty one, and
 *                  the argument had not covered it.
 *    unreadable    rows the reader could not place. Surfaced rather than
 *                  silently dropped: a silent drop makes "N active days" a
 *                  fabricated COUNT (the PostWorkout round-2 F5 finding). */
export async function fetchMonth(fetchPage, { month, year }) {
  const monthStart = new Date(year, month - 1, 1).getTime();
  const monthEnd = new Date(year, month, 1).getTime();
  // Load-bearing beyond the obvious: `new Date(NaN).toISOString()` THROWS, so
  // this guard is what keeps a nonsense month/year a null return rather than an
  // exception thrown out of a function whose contract is "resolves to null".
  if (!Number.isFinite(monthStart) || !Number.isFinite(monthEnd)) return null;

  const from = new Date(monthStart).toISOString();
  const to = new Date(monthEnd).toISOString();

  const byDate = {};
  let cursor;
  let pages = 0;
  let truncated = false;
  let unreadable = 0;
  let inWindow = 0;
  let limitedToDays = null;

  for (;;) {
    if (pages >= HISTORY_MAX_PAGES) {
      truncated = true;
      break;
    }

    let raw;
    try {
      raw = await fetchPage({ limit: HISTORY_PAGE_LIMIT, from, to, cursor });
    } catch {
      return null; // the read FAILED — never the same thing as an empty month
    }
    const page = readWorkoutPage(raw);
    if (page === null) return null;
    pages += 1;
    limitedToDays = page.limitedToDays;

    for (const item of page.items) {
      const session = readCalendarSession(item);
      if (session === null) {
        // T3 round 1, F1 (VISIBLE): back when the walk started at TODAY and
        // paged BACKWARDS, viewing an older month scanned every NEWER month's
        // rows on the way. Counting an unreadable row from one of them made the
        // caption — "N workouts couldn't be read and are not shown" — a
        // statement about rows the user is not looking at, printed over a month
        // whose every workout was read perfectly.
        //
        // The window makes that route unreachable: the server is now asked for
        // this month and answers with it. The test STAYS, and so does this
        // guard, because "the server no longer sends those rows" is a claim
        // about the server, and this function's caption is a claim to the user.
        // The two should not be made to depend on each other.
        //
        // A row whose date is READABLE can be placed even when the rest of it
        // is not, so an out-of-month one is skipped exactly as its readable
        // siblings already are. A row with NO readable date is counted for
        // whichever month is on screen, because there is no date to rule it OUT
        // of this month with — not because dropping it would distort the day
        // count. T3 round 2, F6 corrects that reason where it was first
        // written: an undatable row never enters `byDate` at all, so it can
        // never be one of the "N active days", and dropping it silently could
        // not have fabricated that count. What a silent drop WOULD hide is that
        // the row exists — which is the whole point of surfacing it.
        const bad = Date.parse(text(item?.startedAt) ?? '');
        const datedIntoThisMonth = Number.isFinite(bad) && bad >= monthStart && bad < monthEnd;
        if (!Number.isFinite(bad) || datedIntoThisMonth) {
          unreadable += 1;
        }
        // Counted toward the VOLUME only when its date proves it belongs here.
        // An undatable row is counted as `unreadable` (we must say it exists)
        // but never as evidence of this month's size — those are two different
        // questions and one of them is answerable.
        if (datedIntoThisMonth) inWindow += 1;
        continue;
      }
      const t = Date.parse(session.startedAt);
      // Belt and braces, and deliberately not removed as dead code. The request
      // carries the same half-open window this compares against, so a row
      // outside it means the SERVER disagreed with us — and the failure mode of
      // trusting it would be workouts painted onto squares of a month they did
      // not happen in, which is indistinguishable to the user from the app
      // inventing sessions. Cheap; keeps the grid true to its own dates.
      //
      // What DID go is the early break that used to sit here. The list is
      // newest-first, so a row older than the month once meant "every remaining
      // row is too — stop walking". Under the window no such row can arrive, so
      // the break could only ever fire on the disagreement above, and a guard
      // that stops the walk on a server bug hides it instead of showing it. The
      // walk now ends where the month ends: on a null cursor.
      if (t < monthStart || t >= monthEnd) continue;
      // No null guard here, and that is deliberate. `localDateKey` returns null
      // only for a non-string/blank value or one `Date.parse` rejects, and
      // `readCalendarSession` has already proven `startedAt` is neither. T3
      // round 1 found the guard that used to sit here was UNREACHABLE — and an
      // unreachable guard reads as protection while protecting nothing, the
      // same class as an assertion that cannot fail.
      inWindow += 1;
      const key = localDateKey(session.startedAt);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(session);
    }

    if (page.nextCursor === null) break; // end of the WINDOW: month fully read
    cursor = page.nextCursor;
  }

  for (const key of Object.keys(byDate)) {
    byDate[key].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  }

  return { byDate, limitedToDays, truncated, inWindow, unreadable };
}

/** The most rows a single month view can read: HISTORY_MAX_PAGES × the page
 *  ceiling. `truncated` with `inWindow` at this number means the month really
 *  does hold more workouts than the view can show; `truncated` with FEWER means
 *  the read stopped short for a reason we cannot name, and the caller must not
 *  claim a volume it did not see. (T3 on d28ace5, F3.) */
export const HISTORY_MAX_ROWS = HISTORY_MAX_PAGES * HISTORY_PAGE_LIMIT;

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
