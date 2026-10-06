// THE LEADERBOARD'S READS (spec Part 3 §15.5). Fresh, never stored: one query a board,
// worked out from the visits and workouts each time it opens.
import type { PendingQuery, Row, Sql, TransactionSql } from "postgres";
import { LEADERBOARD_BOARDS, LEADERBOARD_CHECKIN_DAYS, type LeaderboardBoard, type LeaderboardWorkoutNotCounted } from "@app/shared";
import { membersAgainstList } from "../memberList/repo.js";
import { countedDays, gymWeeks, removedVisitsWithOwner, streaks, visitsWithOwner } from "./visits.js";
import { countedWorkoutDays, memberWorkouts } from "./workouts.js";

type SqlOrTx = Sql | TransactionSql;

export interface BoardGym {
  name: string;
  timezone: string;
  today: string;
  /** The gym's plan is live (trialing, active or past due). */
  live: boolean;
  /** The gym counted a visit in the last 30 days. */
  checkingIn: boolean;
  /** The boards the gym switched off for its members. */
  boardsOff: LeaderboardBoard[];
}

/** The stored names, in the boards' own order; anything else is dropped. */
const asBoards = (stored: readonly string[]): LeaderboardBoard[] => LEADERBOARD_BOARDS.filter((b) => stored.includes(b));

/** The gym, its own today at `now`, and whether its members may see a board. */
export async function boardGym(sql: SqlOrTx, gymId: string, now: Date): Promise<BoardGym | null> {
  const rows = await sql<{ name: string; timezone: string; today: string; live: boolean; checking_in: boolean; boards_off: string[] }[]>`
    WITH g AS (
      SELECT id, name, timezone, leaderboard_boards_off AS boards_off,
             (${now.toISOString()}::timestamptz AT TIME ZONE timezone)::date AS today
      FROM gyms WHERE id = ${gymId}
    )
    SELECT g.name, g.timezone, g.today::text AS today, g.boards_off,
           EXISTS (
             SELECT 1 FROM subscriptions s
             WHERE s.owner_type = 'gym' AND s.owner_id = g.id AND s.status IN ('trialing','active','past_due')
           ) AS live,
           EXISTS (
             SELECT 1 FROM gym_attendance a
             WHERE a.gym_id = g.id AND a.method IN ('pass','key_tag','staff')
               AND a.day > g.today - ${LEADERBOARD_CHECKIN_DAYS}::int AND a.day <= g.today
           ) AS checking_in
    FROM g`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    name: row.name,
    timezone: row.timezone,
    today: row.today,
    live: row.live,
    checkingIn: row.checking_in,
    boardsOff: asBoards(row.boards_off),
  };
}

/** A live app member of the gym and the facts that decide whether and how they are shown. */
export interface MemberFacts {
  userId: string;
  displayName: string;
  email: string | null;
  recordName: string | null;
  /** Their record on the gym's list, while it is a current one. */
  entryId: string | null;
  isStaff: boolean;
  takenOff: boolean;
  hideMe: boolean;
  /** Under 18 by the age they gave or the record's date of birth, and not chosen Show me. */
  under18: boolean;
}

interface RawFacts {
  user_id: string;
  display_name: string;
  email: string | null;
  record_name: string | null;
  entry_id: string | null;
  is_staff: boolean;
  taken_off: boolean;
  hide_me: boolean;
  under_18: boolean;
}

const toFacts = (r: RawFacts): MemberFacts => ({
  userId: r.user_id,
  displayName: r.display_name,
  email: r.email,
  recordName: r.record_name,
  entryId: r.entry_id,
  isStaff: r.is_staff,
  takenOff: r.taken_off,
  hideMe: r.hide_me,
  under18: r.under_18,
});

/** UNDER 18, ONE RULE for every board and for the Hide me switch, so the two cannot differ:
 *  the age the person gave, or a date of birth on the record of ANY gym they are a live
 *  member of (each in that gym's own date), until they choose Show me. Reads the aliases
 *  `u` (users) and `fp` (user_fitness_profiles) of the query it sits in. */
function under18(sql: SqlOrTx, at: string) {
  return sql`
    (u.leaderboard_shown_at IS NULL AND (
       coalesce(fp.age < 18, false)
       OR EXISTS (
         SELECT 1 FROM gym_members bm
         JOIN gyms bg ON bg.id = bm.gym_id
         JOIN gym_member_list_entries be ON be.gym_id = bm.gym_id AND be.id = bm.entry_id
         WHERE bm.user_id = u.id AND bm.removed_at IS NULL
           AND be.date_of_birth > ((${at}::timestamptz AT TIME ZONE bg.timezone)::date - interval '18 years')::date
       )
    ))`;
}

/** The live app members of the gym, at the instant `at`. */
function members(sql: SqlOrTx, gymId: string, at: string) {
  return sql`
    SELECT m.user_id, u.display_name, u.email::text AS email,
           nullif(btrim(e.full_name), '') AS record_name,
           CASE WHEN e.former_at IS NULL THEN e.id END AS entry_id,
           EXISTS (SELECT 1 FROM gym_staff s WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id) AS is_staff,
           m.hidden_from_boards AS taken_off,
           u.leaderboard_opt_out AS hide_me,
           ${under18(sql, at)} AS under_18
    FROM gym_members m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    LEFT JOIN user_fitness_profiles fp ON fp.user_id = m.user_id
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id
    WHERE m.gym_id = ${gymId} AND m.removed_at IS NULL`;
}

/** One person's facts, or null when they are not a live app member of the gym. */
export async function memberFacts(sql: SqlOrTx, gymId: string, userId: string, at: string): Promise<MemberFacts | null> {
  const rows = await sql<RawFacts[]>`
    SELECT * FROM (${members(sql, gymId, at)}) mem WHERE mem.user_id = ${userId}`;
  const row = rows[0];
  return row === undefined ? null : toFacts(row);
}

export interface DaysRow extends MemberFacts {
  value: number;
  /** The counted days in the period, oldest first; empty unless asked for. */
  days: string[];
}

export interface DaysBoardInput {
  gymId: string;
  at: string;
  today: string;
  from: string | null;
  to: string;
  viewerId: string;
  withDays: boolean;
}

/** A day board: `counted` is (owner_id, day), one row a counted day in the period. Every
 *  live member with at least one, and the viewer. */
async function daysBoard(sql: SqlOrTx, counted: PendingQuery<Row[]>, input: DaysBoardInput): Promise<DaysRow[]> {
  // The days themselves only for a week view's circles: all time would carry every day.
  const days = input.withDays ? sql`array_agg(d.day::text ORDER BY d.day)` : sql`NULL::text[]`;
  const rows = await sql<(RawFacts & { value: number; days: string[] | null })[]>`
    WITH per AS (
      SELECT d.owner_id, count(*)::int AS value, ${days} AS days
      FROM (${counted}) d
      GROUP BY d.owner_id
    )
    SELECT mem.*, coalesce(per.value, 0) AS value, per.days
    FROM (${members(sql, input.gymId, input.at)}) mem
    LEFT JOIN per ON per.owner_id = mem.user_id
    WHERE per.value IS NOT NULL OR mem.user_id = ${input.viewerId}`;
  return rows.map((r) => ({ ...toFacts(r), value: r.value, days: r.days ?? [] }));
}

/** Gym days in [from, to]. */
export function gymDaysBoard(sql: SqlOrTx, input: DaysBoardInput): Promise<DaysRow[]> {
  const counted = sql`
    SELECT c.owner_id, c.day FROM (${countedDays(sql, input.gymId, input.today)}) c
    WHERE c.day <= ${input.to}::date AND (${input.from}::date IS NULL OR c.day >= ${input.from}::date)`;
  return daysBoard(sql, counted, input);
}

/** Workout days in [from, to]. */
export function workoutDaysBoard(sql: SqlOrTx, input: DaysBoardInput): Promise<DaysRow[]> {
  return daysBoard(sql, countedWorkoutDays(sql, input), input);
}

/** Every live app member of the gym, once: the people a challenge's board is drawn from. */
export async function allMemberFacts(sql: SqlOrTx, gymId: string, at: string): Promise<MemberFacts[]> {
  const rows = await sql<RawFacts[]>`SELECT * FROM (${members(sql, gymId, at)}) mem`;
  return rows.map(toFacts);
}

/** A span of the gym's calendar, both days counted. */
export interface DayRange {
  from: string;
  to: string;
}

/** Counted days inside several spans, from one read. */
export interface RangeCounts {
  /** One row a person with a counted day between the first span's start and the last one's
   *  end: their number in each span, in the spans' own order. */
  rows: { userId: string; counts: number[] }[];
  /** The counted days of the person asked for, oldest first; empty for nobody. */
  days: string[];
}

/** Several spans in one read (a gym's challenges, 19d-i): each person's counted days
 *  inside each span. `counted` is (owner_id, day), one row a counted day, already cut to
 *  the days from the first span's start to the last one's end. One pass over those days,
 *  a count a span, so twenty spans cost what one does. An owner who is not a live member
 *  now is the caller's to leave out. */
async function daysInRanges(sql: SqlOrTx, counted: PendingQuery<Row[]>, ranges: readonly DayRange[], daysOf: string | null): Promise<RangeCounts> {
  const counts = ranges
    .map((r) => sql`count(*) FILTER (WHERE d.day BETWEEN ${r.from}::date AND ${r.to}::date)`)
    .reduce((all, one) => sql`${all}, ${one}`);
  // As text, split here: the driver reads an array a character at a time.
  const rows = await sql<{ owner_id: string; counts: string; days: string | null }[]>`
    SELECT d.owner_id, concat_ws(',', ${counts}) AS counts,
           string_agg(d.day::text, ',') FILTER (WHERE d.owner_id = ${daysOf}::uuid) AS days
    FROM (${counted}) d
    GROUP BY d.owner_id`;
  const days = rows.find((row) => row.days !== null)?.days ?? null;
  return { rows: rows.map((row) => ({ userId: row.owner_id, counts: row.counts.split(",").map(Number) })), days: days === null ? [] : days.split(",").sort() };
}

export interface RangesInput {
  gymId: string;
  at: string;
  today: string;
  ranges: readonly DayRange[];
  /** Whose counted days are sent as well as their number. */
  daysOf: string | null;
}

const firstDay = (ranges: readonly DayRange[]): string => ranges.reduce((min, r) => (r.from < min ? r.from : min), ranges[0]?.from ?? "");
const lastDay = (ranges: readonly DayRange[]): string => ranges.reduce((max, r) => (r.to > max ? r.to : max), ranges[0]?.to ?? "");

/** Gym days inside each span: the Gym days board's own count (`countedDays`). */
export async function gymDaysInRanges(sql: SqlOrTx, input: RangesInput): Promise<RangeCounts> {
  if (input.ranges.length === 0) return { rows: [], days: [] };
  const counted = sql`
    SELECT c.owner_id, c.day FROM (${countedDays(sql, input.gymId, input.today)}) c
    WHERE c.day >= ${firstDay(input.ranges)}::date AND c.day <= ${lastDay(input.ranges)}::date`;
  return daysInRanges(sql, counted, input.ranges, input.daysOf);
}

/** Workout days inside each span: the Workout days board's own count (`countedWorkoutDays`). */
export async function workoutDaysInRanges(sql: SqlOrTx, input: RangesInput): Promise<RangeCounts> {
  if (input.ranges.length === 0) return { rows: [], days: [] };
  const counted = countedWorkoutDays(sql, { gymId: input.gymId, at: input.at, from: firstDay(input.ranges), to: lastDay(input.ranges) });
  return daysInRanges(sql, counted, input.ranges, input.daysOf);
}

export interface StreakRow extends MemberFacts {
  value: number;
  /** The Mondays of the person's gym weeks from `sinceWeek` on. */
  weeks: string[];
}

/** The Streak for every live member with one, and for the viewer; and which of the weeks
 *  since `sinceWeek` the gym counted anybody in. */
export async function streakBoard(
  sql: SqlOrTx,
  input: { gymId: string; at: string; today: string; sinceWeek: string; viewerId: string },
): Promise<{ rows: StreakRow[]; gymWeeks: string[] }> {
  const rows = await sql<(RawFacts & { value: number; weeks: string[] | null })[]>`
    SELECT mem.*, coalesce(st.weeks, 0) AS value, st.recent AS weeks
    FROM (${members(sql, input.gymId, input.at)}) mem
    LEFT JOIN (${streaks(sql, input.gymId, input.today, input.sinceWeek)}) st ON st.owner_id = mem.user_id
    WHERE st.weeks > 0 OR mem.user_id = ${input.viewerId}`;
  const gym = await sql<{ wk: string }[]>`
    SELECT w.wk::text AS wk FROM (${gymWeeks(sql, input.gymId, input.today)}) w
    WHERE w.wk >= ${input.sinceWeek}::date`;
  return {
    rows: rows.map((r) => ({ ...toFacts(r), value: r.value, weeks: r.weeks ?? [] })),
    gymWeeks: gym.map((g) => g.wk),
  };
}

export interface OwnVisit {
  id: string;
  day: string;
  markedAt: Date;
  method: string;
  /** The desk's name, or the name of the member of staff who checked them in. */
  by: string | null;
  /** That member of staff's address, to tell a name they typed from an automatic one. */
  byEmail: string | null;
  /** The gym's date staff added it on, for a visit added on a later day. */
  addedOn: string | null;
}

/** The person's own visits in [from, to], every method, newest first. */
export async function ownVisits(
  sql: SqlOrTx,
  input: { gymId: string; userId: string; today: string; from: string | null; to: string },
): Promise<OwnVisit[]> {
  const rows = await sql<
    { id: string; day: string; marked_at: Date; method: string; by: string | null; by_email: string | null; added_on: string | null }[]
  >`
    SELECT v.id, v.day::text AS day, v.marked_at, v.method,
           CASE WHEN v.method IN ('pass','key_tag') THEN dev.name
                WHEN v.method = 'staff' THEN staff.display_name END AS by,
           CASE WHEN v.method = 'staff' THEN staff.email::text END AS by_email,
           CASE WHEN v.hours_status = 'added_later' THEN (v.marked_at AT TIME ZONE g.timezone)::date::text END AS added_on
    FROM (${visitsWithOwner(sql, input.gymId)}) v
    JOIN gyms g ON g.id = ${input.gymId}
    LEFT JOIN gym_checkin_devices dev ON dev.gym_id = ${input.gymId} AND dev.id = v.device_id
    LEFT JOIN users staff ON staff.id = v.marked_by_user_id
    WHERE v.owner_id = ${input.userId} AND v.day <= ${input.today}::date AND v.day <= ${input.to}::date
      AND (${input.from}::date IS NULL OR v.day >= ${input.from}::date)
    ORDER BY v.day DESC, v.marked_at DESC, v.id`;
  return rows.map((r) => ({
    id: r.id,
    day: r.day,
    markedAt: r.marked_at,
    method: r.method,
    by: r.by,
    byEmail: r.by_email,
    addedOn: r.added_on,
  }));
}

export interface OwnRemovedVisit {
  day: string;
  markedAt: Date;
  /** The gym's date it was removed on, and the member of staff who removed it. */
  removedOn: string;
  by: string | null;
  byEmail: string | null;
}

/** The person's visits in [from, to] that staff removed (19a-iv), newest first. */
export async function ownRemovedVisits(
  sql: SqlOrTx,
  input: { gymId: string; userId: string; today: string; from: string | null; to: string },
): Promise<OwnRemovedVisit[]> {
  const rows = await sql<{ day: string; marked_at: Date; removed_on: string; by: string | null; by_email: string | null }[]>`
    SELECT r.day::text AS day, r.marked_at, (r.removed_at AT TIME ZONE g.timezone)::date::text AS removed_on,
           staff.display_name AS by, staff.email::text AS by_email
    FROM (${removedVisitsWithOwner(sql, input.gymId)}) r
    JOIN gyms g ON g.id = ${input.gymId}
    LEFT JOIN users staff ON staff.id = r.removed_by_user_id
    WHERE r.owner_id = ${input.userId} AND r.day <= ${input.today}::date AND r.day <= ${input.to}::date
      AND (${input.from}::date IS NULL OR r.day >= ${input.from}::date)
    ORDER BY r.day DESC, r.marked_at DESC, r.id`;
  return rows.map((r) => ({ day: r.day, markedAt: r.marked_at, removedOn: r.removed_on, by: r.by, byEmail: r.by_email }));
}

export interface OwnWorkout {
  day: string;
  startedAt: Date;
  /** Null when it counted. */
  why: LeaderboardWorkoutNotCounted | null;
  /** It reached the server more than this many whole days after its start. */
  daysToSave: number;
  /** A set the camera counted, and a set the person counted. */
  camera: boolean;
  byHand: boolean;
}

/** The person's own workouts in [from, to], counted or not, newest first. All time at a
 *  gym begins when the person joined it, so it leaves out the workouts from before. */
export async function ownWorkouts(
  sql: SqlOrTx,
  input: { gymId: string; userId: string; at: string; from: string | null; to: string },
): Promise<OwnWorkout[]> {
  const rows = await sql<
    { day: string; started_at: Date; why: LeaderboardWorkoutNotCounted | null; days_to_save: number; camera: boolean; by_hand: boolean }[]
  >`
    SELECT x.day::text AS day, x.started_at, x.why,
           (ceil(extract(epoch FROM (x.created_at - x.started_at)) / 86400) - 1)::int AS days_to_save,
           coalesce(s.camera, false) AS camera, coalesce(s.by_hand, false) AS by_hand
    FROM (${memberWorkouts(sql, input)}) x
    LEFT JOIN LATERAL (
      SELECT bool_or(ws.mode = 'engine') AS camera, bool_or(ws.mode = 'log_only') AS by_hand
      FROM workout_sets ws WHERE ws.workout_id = x.id
    ) s ON true
    WHERE x.owner_id = ${input.userId}
      AND (${input.from}::date IS NOT NULL OR x.why IS DISTINCT FROM 'before_joining')
    ORDER BY x.started_at DESC, x.id`;
  return rows.map((r) => ({
    day: r.day,
    startedAt: r.started_at,
    why: r.why,
    daysToSave: r.days_to_save,
    camera: r.camera,
    byHand: r.by_hand,
  }));
}

/** The person's gym weeks (Mondays) and gym days in each, and the gym's weeks, newest first. */
export async function ownWeeks(
  sql: SqlOrTx,
  input: { gymId: string; userId: string; today: string },
): Promise<{ mine: Map<string, number>; gym: string[] }> {
  const mine = await sql<{ wk: string; days: number }[]>`
    SELECT date_trunc('week', d.day)::date::text AS wk, count(*)::int AS days
    FROM (${countedDays(sql, input.gymId, input.today)}) d
    WHERE d.owner_id = ${input.userId}
    GROUP BY 1`;
  const gym = await sql<{ wk: string }[]>`
    SELECT w.wk::text AS wk FROM (${gymWeeks(sql, input.gymId, input.today)}) w ORDER BY w.wk DESC`;
  return { mine: new Map(mine.map((m) => [m.wk, m.days])), gym: gym.map((g) => g.wk) };
}

/** Hide me, and whether the person is hidden for their age, by the boards' own rule. */
export async function getVisibility(
  sql: SqlOrTx,
  userId: string,
  now: Date,
): Promise<{ hideMe: boolean; under18: boolean } | null> {
  const rows = await sql<{ hide_me: boolean; under_18: boolean }[]>`
    SELECT u.leaderboard_opt_out AS hide_me, ${under18(sql, now.toISOString())} AS under_18
    FROM users u LEFT JOIN user_fitness_profiles fp ON fp.user_id = u.id
    WHERE u.id = ${userId} AND u.status = 'active'`;
  const row = rows[0];
  return row === undefined ? null : { hideMe: row.hide_me, under18: row.under_18 };
}

/** Hide me on, or off; off is also an under-18's Show me. */
export async function setVisibility(sql: SqlOrTx, userId: string, hidden: boolean): Promise<void> {
  await sql`
    UPDATE users
    SET leaderboard_opt_out = ${hidden},
        leaderboard_shown_at = CASE WHEN ${hidden} THEN leaderboard_shown_at
                                    ELSE coalesce(leaderboard_shown_at, now()) END
    WHERE id = ${userId} AND status = 'active'`;
}

// ── THE BOARD IN THE CONSOLE (19a-iii) ──

/** People on the gym's list who are not in the app: on no board. Who is in the app is
 *  Members' own match (`membersAgainstList`: the record a member joined with, or the list's
 *  email), so this page and Members never give two numbers. */
export async function notInAppCount(sql: SqlOrTx, gymId: string): Promise<number> {
  const members = await membersAgainstList(sql, gymId);
  const inApp = [...new Set(members.flatMap((member) => (member.entryId === null ? [] : [member.entryId])))];
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.former_at IS NULL AND e.id <> ALL(${inApp}::uuid[])`;
  return rows[0]?.n ?? 0;
}

/** Take a live member off the gym's boards, or put them back. `null`: not a live member of
 *  this gym. `changed` is false when they were already so. */
export async function setTakenOff(
  tx: TransactionSql,
  gymId: string,
  userId: string,
  takenOff: boolean,
): Promise<{ changed: boolean } | null> {
  const rows = await tx<{ taken_off: boolean }[]>`
    SELECT m.hidden_from_boards AS taken_off
    FROM gym_members m
    JOIN users u ON u.id = m.user_id AND u.status = 'active'
    WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL
    FOR UPDATE OF m`;
  const row = rows[0];
  if (row === undefined) return null;
  if (row.taken_off === takenOff) return { changed: false };
  await tx`
    UPDATE gym_members SET hidden_from_boards = ${takenOff}
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND removed_at IS NULL`;
  return { changed: true };
}

/** One board switched off or on for members; the others stay as they are stored. Call
 *  under the gym's lock, so two switches pressed together both land. */
export async function setBoardOff(
  tx: TransactionSql,
  gymId: string,
  board: LeaderboardBoard,
  off: boolean,
): Promise<{ before: LeaderboardBoard[]; after: LeaderboardBoard[] } | null> {
  const rows = await tx<{ boards_off: string[] }[]>`
    SELECT leaderboard_boards_off AS boards_off FROM gyms WHERE id = ${gymId}`;
  const row = rows[0];
  if (row === undefined) return null;
  const before = asBoards(row.boards_off);
  const after = asBoards(off ? [...before, board] : before.filter((b) => b !== board));
  if (before.join() !== after.join()) {
    await tx`UPDATE gyms SET leaderboard_boards_off = ${after} WHERE id = ${gymId}`;
  }
  return { before, after };
}