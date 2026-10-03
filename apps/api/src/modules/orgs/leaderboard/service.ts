// THE MEMBERS' LEADERBOARD (spec Part 3 §15.5; ROADMAP 19a). Only a live app member of
// the gym reads it; anybody else gets the same 404 as a gym that does not exist.
import type { Sql } from "postgres";
import {
  leaderboardCountedResponseSchema,
  leaderboardProfileResponseSchema,
  leaderboardResponseSchema,
  leaderboardVisibilitySchema,
  LEADERBOARD_STAFF_PAGE,
  staffLeaderboardCountedResponseSchema,
  staffLeaderboardProfileResponseSchema,
  staffLeaderboardResponseSchema,
  type LeaderboardBoard,
  type LeaderboardCircle,
  type LeaderboardCountedResponse,
  type LeaderboardPeriod,
  type LeaderboardProfileResponse,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type LeaderboardStatus,
  type LeaderboardVisibility,
  type StaffLeaderboardCountedResponse,
  type StaffLeaderboardProfileResponse,
  type StaffLeaderboardQuery,
  type StaffLeaderboardResponse,
} from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { addDays, isWeek, mondayOf, periodRange, streakWeeks, weekDays } from "./periods.js";
import {
  fullName,
  hiddenReason,
  isAutomaticName,
  rankBoard,
  rankStaffBoard,
  shownName,
  staffPlace,
  type Board,
  type BoardPerson,
} from "./rank.js";
import * as repo from "./repo.js";

export interface LeaderboardDeps {
  sql: Sql;
  /** The clock: "today" in the gym's zone is worked out from it. */
  now: () => Date;
}

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");

/** The gym, for a live app member of it; 404 for everybody else. */
async function gymForMember(deps: LeaderboardDeps, gymId: string, userId: string, now: Date): Promise<repo.BoardGym> {
  const gym = await repo.boardGym(deps.sql, gymId, now);
  if (gym === null) throw notFound();
  const me = await repo.memberFacts(deps.sql, gymId, userId, now.toISOString());
  if (me === null) throw notFound();
  return gym;
}

function dayCircles(days: readonly string[], week: readonly string[]): LeaderboardCircle[] {
  const set = new Set(days);
  return week.map((d) => (set.has(d) ? "yes" : "no"));
}

function weekCircles(mine: readonly string[], gymWeeks: ReadonlySet<string>, weeks: readonly string[]): LeaderboardCircle[] {
  const set = new Set(mine);
  const thisWeek = weeks[weeks.length - 1];
  return weeks.map((wk) => {
    if (set.has(wk)) return "yes";
    if (wk === thisWeek) return "open";
    return gymWeeks.has(wk) ? "no" : "skipped";
  });
}

interface Built {
  id: LeaderboardBoard;
  /** Every live member the read returned, before anybody is hidden. */
  people: BoardPerson[];
  board: Board;
  from: string | null;
  to: string;
  circleDays: string[] | null;
  period: LeaderboardPeriod | null;
}

interface At {
  /** The instant of the read, and the gym's own date at it. */
  at: string;
  today: string;
}

type DayBoard = Exclude<LeaderboardBoard, "streak">;

async function buildDays(deps: LeaderboardDeps, id: DayBoard, gymId: string, viewerId: string, { at, today }: At, period: LeaderboardPeriod): Promise<Built> {
  const { from, to } = periodRange(today, period);
  const read = id === "gym_days" ? repo.gymDaysBoard : repo.workoutDaysBoard;
  // The seven marks beside a name are one week, Monday to Sunday: the period's own on a
  // week view, where they add up to the number; this week on a month or all time, read
  // beside the board, so every period draws the same row (Kd, RULINGS 2026-10-04).
  const own = isWeek(period) && from !== null;
  const shown = own ? { from, to } : periodRange(today, "this_week");
  const week = weekDays(shown.from ?? mondayOf(today));
  const [rows, thisWeek] = await Promise.all([
    read(deps.sql, { gymId, at, today, from, to, viewerId, withDays: own }),
    own ? null : read(deps.sql, { gymId, at, today, from: shown.from, to: shown.to, viewerId, withDays: true }),
  ]);
  const weekOf = thisWeek === null ? null : new Map(thisWeek.map((r) => [r.userId, r.days]));
  const people: BoardPerson[] = rows.map((r) => ({
    ...r,
    circles: dayCircles(weekOf === null ? r.days : (weekOf.get(r.userId) ?? []), week),
  }));
  return { id, people, board: rankBoard(people, viewerId), from, to, circleDays: week, period };
}

async function buildStreak(deps: LeaderboardDeps, gymId: string, viewerId: string, { at, today }: At): Promise<Built> {
  const weeks = streakWeeks(today);
  const sinceWeek = weeks[0] ?? today;
  const { rows, gymWeeks } = await repo.streakBoard(deps.sql, { gymId, at, today, sinceWeek, viewerId });
  const active = new Set(gymWeeks);
  const people: BoardPerson[] = rows.map((r) => ({ ...r, circles: weekCircles(r.weeks, active, weeks) }));
  return { id: "streak", people, board: rankBoard(people, viewerId), from: null, to: today, circleDays: weeks, period: null };
}

/** What the gym's MEMBERS see of a board: a lapsed gym's see none; then the gym's own
 *  switch; Gym days and Streak only while the gym checks people in (Workout days needs no
 *  check-in); then the board's own three-people rule. */
function memberStatus(gym: repo.BoardGym, board: LeaderboardBoard, built: Board["status"]): LeaderboardStatus {
  if (!gym.live) return "paused";
  if (gym.boardsOff.includes(board)) return "switched_off";
  if (board !== "workout_days" && !gym.checkingIn) return "no_checkins";
  return built;
}

export async function getLeaderboard(
  deps: LeaderboardDeps,
  viewerId: string,
  gymId: string,
  query: LeaderboardQuery,
): Promise<LeaderboardResponse> {
  const now = deps.now();
  const gym = await gymForMember(deps, gymId, viewerId, now);
  const at: At = { at: now.toISOString(), today: gym.today };
  const built =
    query.board === "streak" ? await buildStreak(deps, gymId, viewerId, at) : await buildDays(deps, query.board, gymId, viewerId, at, query.period);
  const status = memberStatus(gym, query.board, built.board.status);
  const showing = status === "shown";
  // A streak skips the gym's silent weeks, so at a gym that stopped checking in it would
  // never end: there, nobody has one.
  const dormant = query.board === "streak" && !gym.checkingIn;
  const me = dormant ? { ...built.board.me, value: 0 } : built.board.me;
  return leaderboardResponseSchema.parse({
    gymId,
    gymName: gym.name,
    timezone: gym.timezone,
    board: query.board,
    period: built.period,
    from: built.from,
    to: built.to,
    circleDays: built.circleDays,
    status,
    boardsOff: gym.boardsOff,
    ranked: showing ? built.board.ranked : 0,
    rows: showing ? built.board.rows : [],
    me: showing ? me : { ...me, place: null, toNextPlace: null, nextPlace: null },
    asOf: now.toISOString(),
  });
}

/** What counted for the viewer's own number on one board. */
export async function getMyCounted(
  deps: LeaderboardDeps,
  viewerId: string,
  gymId: string,
  query: LeaderboardQuery,
): Promise<LeaderboardCountedResponse> {
  const now = deps.now();
  const gym = await gymForMember(deps, gymId, viewerId, now);
  return countedFor(deps, gym, gymId, viewerId, query, now);
}

/** What counted for one live member's number on one board: the person's own read, and
 *  staff's of anyone. */
async function countedFor(
  deps: LeaderboardDeps,
  gym: repo.BoardGym,
  gymId: string,
  viewerId: string,
  query: LeaderboardQuery,
  now: Date,
): Promise<LeaderboardCountedResponse> {
  if (query.board === "streak") {
    // No streak at a gym that has stopped checking in (see getLeaderboard).
    const { mine, gym: gymWeeks } = gym.checkingIn
      ? await repo.ownWeeks(deps.sql, { gymId, userId: viewerId, today: gym.today })
      : { mine: new Map<string, number>(), gym: [] };
    const thisWeek = mondayOf(gym.today);
    const active = new Set(gymWeeks);
    const oldest = gymWeeks[gymWeeks.length - 1] ?? thisWeek;
    const weeks: LeaderboardCountedResponse["weeks"] = [];
    let value = 0;
    // Newest first, back to the gym week that broke it. A week the gym recorded nobody
    // is skipped: it neither counts nor breaks; this week stays open until it ends.
    for (let wk = thisWeek; wk >= oldest; wk = addDays(wk, -7)) {
      const days = mine.get(wk) ?? 0;
      if (days > 0) {
        weeks.push({ weekStart: wk, state: "counted", gymDays: days });
        value += 1;
      } else if (wk === thisWeek) {
        weeks.push({ weekStart: wk, state: "open", gymDays: 0 });
      } else if (!active.has(wk)) {
        weeks.push({ weekStart: wk, state: "skipped", gymDays: 0 });
      } else {
        weeks.push({ weekStart: wk, state: "missed", gymDays: 0 });
        break;
      }
    }
    return leaderboardCountedResponseSchema.parse({
      gymName: gym.name,
      timezone: gym.timezone,
      board: "streak",
      period: null,
      from: null,
      to: gym.today,
      value,
      days: [],
      notCounted: [],
      workoutDays: [],
      workoutsNotCounted: [],
      weeks,
    });
  }

  const { from, to } = periodRange(gym.today, query.period);
  if (query.board === "workout_days") {
    const workouts = await repo.ownWorkouts(deps.sql, { gymId, userId: viewerId, at: now.toISOString(), from, to });
    const workoutDays: LeaderboardCountedResponse["workoutDays"] = [];
    const workoutsNotCounted: LeaderboardCountedResponse["workoutsNotCounted"] = [];
    for (const w of workouts) {
      const at = w.startedAt.toISOString();
      if (w.why !== null) {
        workoutsNotCounted.push({ day: w.day, at, why: w.why, daysLate: w.why === "saved_late" ? w.daysToSave : null });
        continue;
      }
      const countedBy = w.camera && w.byHand ? "both" : w.camera ? "camera" : w.byHand ? "you" : null;
      const last = workoutDays[workoutDays.length - 1];
      if (last?.day === w.day) last.workouts.push({ at, countedBy });
      else workoutDays.push({ day: w.day, workouts: [{ at, countedBy }] });
    }
    return leaderboardCountedResponseSchema.parse({
      gymName: gym.name,
      timezone: gym.timezone,
      board: "workout_days",
      period: query.period,
      from,
      to,
      value: workoutDays.length,
      days: [],
      notCounted: [],
      workoutDays,
      workoutsNotCounted,
      weeks: [],
    });
  }

  const visits = await repo.ownVisits(deps.sql, { gymId, userId: viewerId, today: gym.today, from, to });
  const days: LeaderboardCountedResponse["days"] = [];
  const notCounted: LeaderboardCountedResponse["notCounted"] = [];
  for (const v of visits) {
    if (v.method === "manual" || v.method === "qr") {
      notCounted.push({ day: v.day, at: v.markedAt.toISOString(), why: v.method === "manual" ? "own_tap" : "app_code" });
      continue;
    }
    // A member of staff who never typed a name is "staff", never their address's first part.
    const by = v.method === "staff" && v.by !== null && isAutomaticName(v.by, v.byEmail) ? null : v.by;
    const visit = { at: v.markedAt.toISOString(), how: v.method === "staff" ? "staff" : "desk", by } as const;
    const last = days[days.length - 1];
    if (last?.day === v.day) last.visits.push(visit);
    else days.push({ day: v.day, visits: [visit] });
  }
  return leaderboardCountedResponseSchema.parse({
    gymName: gym.name,
    timezone: gym.timezone,
    board: "gym_days",
    period: query.period,
    from,
    to,
    value: days.length,
    days,
    notCounted,
    workoutDays: [],
    workoutsNotCounted: [],
    weeks: [],
  });
}

/** A person's places on the boards the viewer can see. Nothing for anyone hidden or not a
 *  live app member, and nothing while the gym shows no board: the same 404 as a gym that
 *  does not exist. */
export async function getProfile(
  deps: LeaderboardDeps,
  viewerId: string,
  gymId: string,
  userId: string,
  period: LeaderboardPeriod,
): Promise<LeaderboardProfileResponse> {
  const now = deps.now();
  const gym = await gymForMember(deps, gymId, viewerId, now);
  if (!gym.live) throw notFound();
  const at: At = { at: now.toISOString(), today: gym.today };
  const person = await repo.memberFacts(deps.sql, gymId, userId, at.at);
  if (person === null) throw notFound();
  const named = shownName(person);
  if (named === null || (userId !== viewerId && hiddenReason({ ...person, value: 1, circles: null }) !== null)) {
    throw notFound();
  }
  // Gym days and Streak only while the gym checks people in, as on the board itself; and
  // never a board the gym switched off.
  const on = (board: LeaderboardBoard): boolean => !gym.boardsOff.includes(board);
  const built = await Promise.all([
    ...(gym.checkingIn && on("gym_days") ? [buildDays(deps, "gym_days", gymId, userId, at, period)] : []),
    ...(on("workout_days") ? [buildDays(deps, "workout_days", gymId, userId, at, period)] : []),
    ...(gym.checkingIn && on("streak") ? [buildStreak(deps, gymId, userId, at)] : []),
  ]);
  // Only the boards that are showing: a board withheld for too few people gives no number.
  const boards = built
    .filter((b) => b.board.status === "shown")
    .map((b) => ({ board: b.id, period: b.period, place: b.board.me.place, value: b.board.me.value }));
  if (boards.length === 0) throw notFound();
  return leaderboardProfileResponseSchema.parse({ userId, name: named.name, initials: named.initials, boards });
}

export async function getVisibility(deps: LeaderboardDeps, userId: string): Promise<LeaderboardVisibility> {
  const v = await repo.getVisibility(deps.sql, userId, deps.now());
  if (v === null) throw notFound();
  return leaderboardVisibilitySchema.parse({ hidden: v.hideMe || v.under18, hideMe: v.hideMe, under18: v.under18 });
}

export async function setVisibility(deps: LeaderboardDeps, userId: string, hidden: boolean): Promise<LeaderboardVisibility> {
  await repo.setVisibility(deps.sql, userId, hidden);
  return getVisibility(deps, userId);
}

// ── THE BOARD IN THE CONSOLE (19a-iii; spec Part 3 §15.5) ──
// Staff holding `leaderboard.manage` see everyone, full names, and what counted for
// anyone. The worst thing it could do is answer anybody else: another gym's staff, a
// member, or staff without the tick. Every function below asks the tick before it reads.

const TICK = "leaderboard.manage";

/** The route's rate limit, asked after the tick: false when it has already answered 429. */
export type Limit = () => Promise<boolean>;

const personNotFound = (): OrgsError =>
  new OrgsError(404, "person_not_found", "That person isn't in the app here any more.");

export async function getStaffLeaderboard(
  deps: LeaderboardDeps,
  staffId: string,
  gymId: string,
  query: StaffLeaderboardQuery,
  limit: Limit,
): Promise<StaffLeaderboardResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const now = deps.now();
  const gym = await repo.boardGym(deps.sql, gymId, now);
  if (gym === null) throw notFound();
  const at: At = { at: now.toISOString(), today: gym.today };
  const [built, notInApp] = await Promise.all([
    query.board === "streak" ? buildStreak(deps, gymId, staffId, at) : buildDays(deps, query.board, gymId, staffId, at, query.period),
    repo.notInAppCount(deps.sql, gymId),
  ]);
  // Nobody has a streak at a gym that has stopped checking in (see getLeaderboard).
  const dormant = query.board === "streak" && !gym.checkingIn;
  const staff = rankStaffBoard(dormant ? [] : built.people);
  const pages = Math.max(1, Math.ceil(staff.rows.length / LEADERBOARD_STAFF_PAGE));
  const page = Math.min(query.page, pages);
  return staffLeaderboardResponseSchema.parse({
    gymId,
    gymName: gym.name,
    timezone: gym.timezone,
    board: query.board,
    period: built.period,
    from: built.from,
    to: built.to,
    circleDays: built.circleDays,
    memberStatus: memberStatus(gym, query.board, staff.status),
    live: gym.live,
    checkingIn: gym.checkingIn,
    boardsOff: gym.boardsOff,
    ranked: staff.ranked,
    total: staff.rows.length,
    page,
    pages,
    rows: staff.rows.slice((page - 1) * LEADERBOARD_STAFF_PAGE, page * LEADERBOARD_STAFF_PAGE),
    notInApp,
    asOf: now.toISOString(),
  });
}

/** One live app member of THIS gym, or 404. */
async function staffPerson(deps: LeaderboardDeps, gymId: string, userId: string, at: string): Promise<repo.MemberFacts> {
  const person = await repo.memberFacts(deps.sql, gymId, userId, at);
  if (person === null) throw personNotFound();
  return person;
}

/** Anyone's place on all three boards, hidden or not. */
export async function getStaffProfile(
  deps: LeaderboardDeps,
  staffId: string,
  gymId: string,
  userId: string,
  period: LeaderboardPeriod,
  limit: Limit,
): Promise<StaffLeaderboardProfileResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const now = deps.now();
  const gym = await repo.boardGym(deps.sql, gymId, now);
  if (gym === null) throw notFound();
  const at: At = { at: now.toISOString(), today: gym.today };
  const person = await staffPerson(deps, gymId, userId, at.at);
  const built = await Promise.all([
    buildDays(deps, "gym_days", gymId, userId, at, period),
    buildDays(deps, "workout_days", gymId, userId, at, period),
    buildStreak(deps, gymId, userId, at),
  ]);
  const boards = built.map((b) => {
    // Nobody has a streak at a gym that has stopped checking in (see getLeaderboard).
    const dormant = b.id === "streak" && !gym.checkingIn;
    return { board: b.id, period: b.period, ...staffPlace(dormant ? [] : b.people, userId) };
  });
  const named = fullName(person);
  return staffLeaderboardProfileResponseSchema.parse({
    userId,
    name: named.name,
    initials: named.initials,
    hidden: hiddenReason({ ...person, value: 1, circles: null }),
    takenOff: person.takenOff,
    isStaff: person.isStaff,
    entryId: person.entryId,
    boards,
  });
}

/** What counted for anyone. A workout is its date: never its time or what it was. */
export async function getStaffCounted(
  deps: LeaderboardDeps,
  staffId: string,
  gymId: string,
  userId: string,
  query: LeaderboardQuery,
  limit: Limit,
): Promise<StaffLeaderboardCountedResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const now = deps.now();
  const gym = await repo.boardGym(deps.sql, gymId, now);
  if (gym === null) throw notFound();
  await staffPerson(deps, gymId, userId, now.toISOString());
  const counted = await countedFor(deps, gym, gymId, userId, query, now);
  return staffLeaderboardCountedResponseSchema.parse({
    userId,
    gymName: counted.gymName,
    timezone: counted.timezone,
    board: counted.board,
    period: counted.period,
    from: counted.from,
    to: counted.to,
    value: counted.value,
    days: counted.days,
    notCounted: counted.notCounted,
    workoutDays: counted.workoutDays.map((d) => ({ day: d.day, workouts: d.workouts.length })),
    workoutsNotCounted: counted.workoutsNotCounted.map((w) => ({ day: w.day, why: w.why, daysLate: w.daysLate })),
    weeks: counted.weeks,
  });
}

/** Take a person off the gym's boards, or put them back. Their visits and workouts stay. */
export async function setTakenOff(
  deps: LeaderboardDeps,
  staffId: string,
  gymId: string,
  userId: string,
  takenOff: boolean,
  limit: Limit,
): Promise<{ takenOff: boolean } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const done = await deps.sql.begin(async (tx) => {
    const set = await repo.setTakenOff(tx, gymId, userId, takenOff);
    if (set?.changed === true) {
      await insertAudit(tx, {
        actorUserId: staffId,
        gymId,
        action: takenOff ? "leaderboard.taken_off" : "leaderboard.put_back",
        targetType: "gym_member",
        targetId: userId,
        meta: {},
      });
    }
    return set;
  });
  if (done === null) throw personNotFound();
  return { takenOff };
}

/** Which boards the gym's members do not see. */
export async function setBoardsOff(
  deps: LeaderboardDeps,
  staffId: string,
  gymId: string,
  off: readonly LeaderboardBoard[],
  limit: Limit,
): Promise<{ boardsOff: LeaderboardBoard[] } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const done = await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const set = await repo.setBoardsOff(tx, gymId, off);
    if (set !== null && set.before.join() !== set.after.join()) {
      await insertAudit(tx, {
        actorUserId: staffId,
        gymId,
        action: "leaderboard.boards_changed",
        targetType: "gym",
        targetId: gymId,
        meta: { before: set.before, after: set.after },
      });
    }
    return set;
  });
  if (done === null) throw notFound();
  return { boardsOff: done.after };
}