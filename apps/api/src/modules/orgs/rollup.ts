// THE GYM'S DAY GETS WRITTEN DOWN — Part 3 §3.2's rollup layer, and the first
// writer `org_daily_stats` has ever had. The table shipped in `0001_init` and
// was measured on 2026-09-02 with SIX references in `apps/api/src`, every one of
// them its own schema file, a comment, or a privacy-list entry: no writer, no
// reader, three cards' worth of screens blocked behind it.
//
// **WHAT IT DOES, IN ONE SENTENCE:** for each gym, and for each of the last few
// days that have FINISHED in that gym's own clock, it recomputes that day's
// numbers from the source tables and upserts one row.
//
// **THE DAY IS THE GYM'S DAY AND THE EXPRESSION IS THE SAME ONE ATTENDANCE
// USES.** `readAttendanceContext` stamps a visit with
// `(now() AT TIME ZONE g.timezone)::date`; every day boundary below is the same
// shape against the injected clock. That is not a style preference — trap #8 —
// it is what makes a visit's stored `day` and this job's `day` THE SAME THING by
// construction rather than by two derivations that agree until one is edited.
// :26469 §5 is the ruling that makes it matter: a gym's zone is automatic with a
// manual override, so one run closes a New York day and an Assam day each in its
// own zone.
//
// ── WHAT IT WRITES, AND UNDER WHOSE RULING ─────────────────────────────────
//
// `visits` / `visitors` — migration `0020`. Rows, and distinct people. They
// differ exactly when somebody came twice, which Kd made possible on purpose
// (:27992 §1). **`visitors` is NOT summable across days** and this file writes
// it per day only; any "different people in N days" question is a DISTINCT count
// over `gym_attendance` (:29961 §6.2).
//
// The workout-side columns — `active_members`, `workouts`, `sets`, `total_reps`,
// `minutes`, `avg_form_score`, `scored_sets` — are scoped by **:29961 ruling 2**,
// which is Kd's own sentence at :26469 §1.2 made physical: *"A workout counts
// for a gym only if the person was a member that day and was present in the
// gym"*. Two conditions, both his, neither invented. The rejected alternative
// ("only within N hours of the visit") needed a constant nobody has ruled — R0.2.
//
// **`avg_form_score` IS WRITTEN AND IS NOT ON ANY SCREEN.** Kd struck the tile
// (:26469 §1.1) and kept the column, in his own terms: it costs one expression
// and **a history nobody recorded cannot be recovered later.** Whoever builds
// Reports is its reader. Do not "clean it up".
//
// ── WHAT READS THIS TABLE, STATED PLAINLY BECAUSE TODAY THE ANSWER IS NOTHING ─
//
// The Overview's own figures are read LIVE from `gym_attendance`, not from here,
// and that is a decision with a reason rather than an oversight:
//
//   1. **A DISTINCT COUNT CANNOT BE SUMMED.** The 8-week chart's line is *"how
//      many different people came that week"*. Summing seven daily `visitors`
//      double-counts everybody who came on two of those days. The line has to be
//      a distinct count over the raw rows, and once the chart is reading raw
//      rows for its line, reading them for its bars too is one query instead of
//      two sources that can disagree at their seam.
//   2. **A NIGHTLY TABLE HAS A PARTIAL-DAY WINDOW EVERY DAY.** Any "read the
//      record for finished days" design has hours in which the most recent
//      finished day has no row yet, and a screen that renders a missing row as
//      zero is printing a false number (:5807).
//
// **So why write it at all.** Three reasons, and the first two are the ones that
// will still be true after this card: the workout-side join above is too
// expensive to run per page load and is what Reports needs; `gym_attendance` is
// on the UNRULED half of the DPDP list (`modules/privacy/tables.ts`), so the day
// Kd rules it deletable, a live-reading chart silently rewrites a gym's history
// and this aggregate is what survives; and Part 3 §3.2 specifies it. When that
// ruling lands, the chart's source moves HERE — which is what it is being
// written for.
//
// ── HOW OFTEN, AND WHY THE FILTER IS AN HOUR ───────────────────────────────
//
// Part 3 §3.2 says *"nightly at 02:00 org TZ"*, and **no single UTC time is
// 02:00 everywhere**. `worker.ts` therefore runs this HOURLY and each run rolls
// only the gyms whose own clock is in the 02:00 hour — one schedule, twenty-four
// cheap runs, every gym closed in its own zone. `--all-hours` on the by-hand tool
// ignores the filter; the tests drive it both ways in ONE fixture, because a
// filter that is silently inert passes any test that cannot produce the other
// answer (:28649).
//
// ── WHY A TRAILING WINDOW AND NOT JUST YESTERDAY ───────────────────────────
//
// **Workouts arrive from an OFFLINE QUEUE** (R10.3): a Monday workout can reach
// the server on Wednesday. A job that only ever computed yesterday would leave
// that Monday permanently under-counted with nothing anywhere to say so. Seven
// days also means a week-long worker outage heals itself on the next run rather
// than leaving a hole nobody notices. Longer gaps are the tool's `--days`.
//
// IDEMPOTENT BY CONSTRUCTION (R3.5). It RECOMPUTES rather than increments, so a
// BullMQ retry, a by-hand run and the nightly run all land on identical numbers
// — which the suite asserts by running it twice and comparing every column.
//
// This file holds the logic and OWNS NO SCHEDULE: `worker.ts` runs it and
// `tools/orgs-rollup.ts` runs it by hand — `trialSweep.ts`'s shape, and for its
// reason: the tests drive it against real Postgres with no queue anywhere near
// them.
import type { Sql } from "postgres";

/** THE GYM-LOCAL HOUR A DAY IS CLOSED IN. Part 3 §3.2's *"nightly at 02:00 org
 *  TZ"*, quoted rather than recalled (Part 0 rule 4). It is operational, not a
 *  correctness choice — every boundary this file computes is a DATE — so the
 *  only thing it decides is that a gym's numbers settle while nobody is looking
 *  at them. */
export const ROLLUP_LOCAL_HOUR = 2;

/** HOW MANY FINISHED LOCAL DAYS EACH RUN RECOMPUTES. Seven, for the offline-sync
 *  and self-healing reasons in the header. Not a spec number: no § names one, and
 *  it is recorded in DECISIONS as chosen. */
export const ROLLUP_WINDOW_DAYS = 7;

export interface RollupDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void };
}

export interface RollupOptions {
  /** Injected clock, following `trialSweep.ts` and `purge.ts`. Production passes
   *  nothing. Every day boundary below is derived from it, so a test can stand
   *  at any instant and get a deterministic set of days. */
  now?: Date;
  /** Bound the run to named gyms. Omitted = every gym, which is what the
   *  nightly job wants and what production always passes.
   *
   *  **It exists because a rollup is TABLE-WIDE by nature and its own tests are
   *  not** — `trialSweep.ts`'s reasoning, inherited: `vitest` runs suites four
   *  at a time against ONE database, and an unscoped run from this suite would
   *  write rows for every gym every other suite is holding. Scoping is also what
   *  makes these tests' counts EXACT rather than "at least one". */
  gymIds?: readonly string[];
  /** Finished local days to recompute, newest first from yesterday. */
  days?: number;
  /** Ignore the local-02:00 filter and roll every gym in scope. The by-hand
   *  tool's `--all-hours`, and the backfill's only way to work at all. */
  allHours?: boolean;
}

export interface RollupResult {
  /** Rows upserted — gyms × days, minus days before a gym existed. */
  rows: number;
  /** Distinct gyms this run touched. */
  gyms: number;
}

interface WrittenRow {
  gym_id: string;
}

export async function rollUpGymDays(
  deps: RollupDeps,
  opts: RollupOptions = {},
): Promise<RollupResult> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? ROLLUP_WINDOW_DAYS;
  const allHours = opts.allHours ?? false;
  // `null` means every gym: `id = ANY(NULL)` is NULL rather than false, which
  // would filter every row out, so the IS NULL test comes first — :12227's L-2,
  // and `trialSweep.ts`'s `scope` verbatim in shape.
  const scope = opts.gymIds ?? null;

  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`rollUpGymDays: days must be a positive integer, got ${String(days)}`);
  }

  const written = await deps.sql<WrittenRow[]>`
    WITH target AS (
      SELECT g.id AS gym_id,
             g.timezone,
             ((${now}::timestamptz AT TIME ZONE g.timezone)::date - offs.n) AS day,
             (((${now}::timestamptz AT TIME ZONE g.timezone)::date - offs.n)::timestamp
                AT TIME ZONE g.timezone) AS day_start,
             (((${now}::timestamptz AT TIME ZONE g.timezone)::date - offs.n + 1)::timestamp
                AT TIME ZONE g.timezone) AS day_end
      FROM gyms g
      -- FINISHED days only: the series starts at 1, so today — which is still
      -- being lived in and would be written as a partial day that looks whole —
      -- is never in it.
      CROSS JOIN generate_series(1, ${days}::int) AS offs(n)
      WHERE (${scope}::uuid[] IS NULL OR g.id = ANY(${scope}::uuid[]))
        AND (${allHours}::boolean
             OR EXTRACT(HOUR FROM (${now}::timestamptz AT TIME ZONE g.timezone))::int
                = ${ROLLUP_LOCAL_HOUR}::int)
        -- NEVER A DAY BEFORE THE GYM EXISTED. A row of zeros is a positive
        -- statement — "this day was recorded and nothing happened" — which is
        -- the whole reason an unrecorded day and an empty one must not look
        -- alike (:8267/:8343, :26736). Making that statement about a week when
        -- the gym had not been created is simply false.
        AND ((${now}::timestamptz AT TIME ZONE g.timezone)::date - offs.n)
            >= (g.created_at AT TIME ZONE g.timezone)::date
    ),
    -- WHO WAS PRESENT, ONE ROW PER PERSON PER DAY. Deduped here rather than in
    -- the joins below, and that is load-bearing: a member who came to two
    -- sessions holds TWO attendance rows for the day (Kd's ruling 12), so
    -- joining workouts through the raw table would count their sets and reps
    -- TWICE. "count(DISTINCT w.id)" would hide it for the workout count and
    -- silently double "sum(sets_count)" beside it.
    present AS (
      SELECT DISTINCT t.gym_id, t.day, a.user_id
      FROM target t
      JOIN gym_attendance a ON a.gym_id = t.gym_id AND a.day = t.day
    ),
    att AS (
      SELECT t.gym_id, t.day,
             count(*)::int AS visits,
             count(DISTINCT a.user_id)::int AS visitors
      FROM target t
      JOIN gym_attendance a ON a.gym_id = t.gym_id AND a.day = t.day
      GROUP BY t.gym_id, t.day
    ),
    -- **:29961 RULING 2, AND IT IS TWO CONDITIONS.** "present" is the second
    -- one (they were in the building). The EXISTS below is the FIRST — §2.1's
    -- membership interval, "[joined_at, removed_at)" measured against the gym's
    -- own day.
    --
    -- **IT IS REDUNDANT TODAY AND IS KEPT DELIBERATELY.** The only writer of
    -- "gym_attendance" is a member marking themselves, which already refuses a
    -- non-member — so an attendance row implies a live membership at the moment
    -- it was made. Staff marking somebody present is ruled "not now" rather than
    -- never (:27900), and that is a SECOND writer with a different actor. The
    -- ruling names both conditions; this file enforces both, and the suite
    -- proves this one by inserting a visit for somebody removed beforehand —
    -- a row the mark route could not have produced.
    counted AS (
      SELECT p.gym_id, p.day, w.id AS workout_id, w.user_id,
             w.sets_count, w.total_reps, w.duration_ms
      FROM present p
      JOIN target t ON t.gym_id = p.gym_id AND t.day = p.day
      JOIN workouts w ON w.user_id = p.user_id
        AND (w.started_at AT TIME ZONE t.timezone)::date = p.day
      -- A SEMI-JOIN AND NOT A JOIN, AND THAT IS THE WHOLE POINT.
      -- "gym_members_live_uq" is a PARTIAL unique index (WHERE removed_at IS
      -- NULL), so a person who leaves and rejoins holds TWO rows and BOTH can
      -- satisfy the interval below on the same gym-day — reachable through the
      -- console's own two buttons. A plain JOIN fans this workout out once per
      -- matching row and DOUBLES "sets", "total_reps", "minutes" and
      -- "scored_sets", while "workouts" and "active_members" stay right because
      -- they are DISTINCT counts — which is exactly what makes it invisible.
      -- :12731's L2-3, the same partial index, one table over.
      WHERE EXISTS (
        SELECT 1 FROM gym_members m
        WHERE m.gym_id = p.gym_id AND m.user_id = p.user_id
          AND m.joined_at < t.day_end
          AND (m.removed_at IS NULL OR m.removed_at > t.day_start)
      )
    ),
    wk AS (
      SELECT c.gym_id, c.day,
             count(DISTINCT c.workout_id)::int AS workouts,
             count(DISTINCT c.user_id)::int AS active_members,
             coalesce(sum(c.sets_count), 0)::int AS sets,
             coalesce(sum(c.total_reps), 0)::int AS total_reps,
             -- WHOLE MINUTES, TRUNCATED, and "duration_ms" is nullable — a
             -- workout that never reported one contributes zero rather than
             -- turning the whole day's sum into NULL.
             (coalesce(sum(c.duration_ms), 0) / 60000)::int AS minutes
      FROM counted c
      GROUP BY c.gym_id, c.day
    ),
    -- Part 3 §3.2's definition, quoted: *"mean of SetSummary.avgFormScore over
    -- scored sets in window"*. A set with no score is not a zero — it is a set
    -- nobody graded — so "IS NOT NULL" is the filter and "scored_sets" is what
    -- makes the average readable later (§3.2 suppresses it below five).
    st AS (
      SELECT c.gym_id, c.day,
             count(*)::int AS scored_sets,
             round(avg(s.avg_form_score)::numeric, 1) AS avg_form_score
      FROM counted c
      JOIN workout_sets s ON s.workout_id = c.workout_id AND s.avg_form_score IS NOT NULL
      GROUP BY c.gym_id, c.day
    ),
    mem AS (
      SELECT t.gym_id, t.day,
             count(*) FILTER (
               WHERE m.joined_at >= t.day_start AND m.joined_at < t.day_end
             )::int AS new_members,
             count(*) FILTER (
               WHERE m.removed_at >= t.day_start AND m.removed_at < t.day_end
             )::int AS removed_members
      FROM target t
      JOIN gym_members m ON m.gym_id = t.gym_id
      GROUP BY t.gym_id, t.day
    )
    INSERT INTO org_daily_stats
      (gym_id, day, visits, visitors, active_members, workouts, sets, total_reps,
       minutes, avg_form_score, scored_sets, new_members, removed_members)
    SELECT t.gym_id, t.day,
           coalesce(att.visits, 0),
           coalesce(att.visitors, 0),
           coalesce(wk.active_members, 0),
           coalesce(wk.workouts, 0),
           coalesce(wk.sets, 0),
           coalesce(wk.total_reps, 0),
           coalesce(wk.minutes, 0),
           -- NOT coalesced: NULL means "nobody was graded", and 0.0 would mean
           -- "everybody scored zero". "scored_sets" beside it is the honest 0.
           st.avg_form_score,
           coalesce(st.scored_sets, 0),
           coalesce(mem.new_members, 0),
           coalesce(mem.removed_members, 0)
    FROM target t
    LEFT JOIN att ON att.gym_id = t.gym_id AND att.day = t.day
    LEFT JOIN wk ON wk.gym_id = t.gym_id AND wk.day = t.day
    LEFT JOIN st ON st.gym_id = t.gym_id AND st.day = t.day
    LEFT JOIN mem ON mem.gym_id = t.gym_id AND mem.day = t.day
    -- RECOMPUTES, NEVER INCREMENTS (R3.5). Every column is overwritten from the
    -- source tables, so a retry, a by-hand run and the nightly run are the same
    -- run — which is also what lets the window above re-close a day whose
    -- workouts synced late.
    ON CONFLICT (gym_id, day) DO UPDATE SET
      visits = EXCLUDED.visits,
      visitors = EXCLUDED.visitors,
      active_members = EXCLUDED.active_members,
      workouts = EXCLUDED.workouts,
      sets = EXCLUDED.sets,
      total_reps = EXCLUDED.total_reps,
      minutes = EXCLUDED.minutes,
      avg_form_score = EXCLUDED.avg_form_score,
      scored_sets = EXCLUDED.scored_sets,
      new_members = EXCLUDED.new_members,
      removed_members = EXCLUDED.removed_members
    RETURNING gym_id`;

  const result: RollupResult = {
    rows: written.length,
    gyms: new Set(written.map((r) => r.gym_id)).size,
  };
  // R8.3: every background job says what it did.
  deps.log.info(
    { ...result, days, event: "orgs.rollup.finished" },
    "gym daily rollup finished",
  );
  return result;
}
