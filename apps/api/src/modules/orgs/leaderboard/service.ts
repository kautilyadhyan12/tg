// THE MEMBERS' LEADERBOARD (spec Part 3 §15.5; ROADMAP 19a). Only a live app member of
// the gym reads it; anybody else gets the same 404 as a gym that does not exist.
import type { Sql } from "postgres";
import {
  leaderboardCountedResponseSchema,
  leaderboardProfileResponseSchema,
  leaderboardResponseSchema,
  leaderboardVisibilitySchema,
  type LeaderboardBoard,
  type LeaderboardCircle,
  type LeaderboardCountedResponse,
  type LeaderboardPeriod,
  type LeaderboardProfileResponse,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type LeaderboardVisibility,
} from "@app/shared";
import { OrgsError } from "../service.js";
import { addDays, isWeek, mondayOf, periodRange, streakWeeks, weekDays } from "./periods.js";
import { hiddenReason, isAutomaticName, rankBoard, shownName, type Board, type BoardPerson } from "./rank.js";
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
  const week = isWeek(period) && from !== null ? weekDays(from) : null;
  const input = { gymId, at, today, from, to, viewerId, withDays: week !== null };
  const rows = id === "gym_days" ? await repo.gymDaysBoard(deps.sql, input) : await repo.workoutDaysBoard(deps.sql, input);
  const people: BoardPerson[] = rows.map((r) => ({ ...r, circles: week === null ? null : dayCircles(r.days, week) }));
  return { id, board: rankBoard(people, viewerId), from, to, circleDays: week, period };
}

async function buildStreak(deps: LeaderboardDeps, gymId: string, viewerId: string, { at, today }: At): Promise<Built> {
  const weeks = streakWeeks(today);
  const sinceWeek = weeks[0] ?? today;
  const { rows, gymWeeks } = await repo.streakBoard(deps.sql, { gymId, at, today, sinceWeek, viewerId });
  const active = new Set(gymWeeks);
  const people: BoardPerson[] = rows.map((r) => ({ ...r, circles: weekCircles(r.weeks, active, weeks) }));
  return { id: "streak", board: rankBoard(people, viewerId), from: null, to: today, circleDays: weeks, period: null };
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
  // A lapsed gym's members see no board; Gym days and Streak only while the gym checks
  // in. Workout days needs no check-in.
  const needsCheckIn = query.board !== "workout_days";
  const status = !gym.live ? "paused" : needsCheckIn && !gym.checkingIn ? "no_checkins" : built.board.status;
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
  // Gym days and Streak only while the gym checks people in, as on the board itself.
  const built = await Promise.all([
    ...(gym.checkingIn ? [buildDays(deps, "gym_days", gymId, userId, at, period)] : []),
    buildDays(deps, "workout_days", gymId, userId, at, period),
    ...(gym.checkingIn ? [buildStreak(deps, gymId, userId, at)] : []),
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
