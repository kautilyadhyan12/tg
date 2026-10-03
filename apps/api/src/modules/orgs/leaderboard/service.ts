// THE MEMBERS' LEADERBOARD (spec Part 3 §15.5; ROADMAP 19a-i). Only a live app member of
// the gym reads it; anybody else gets the same 404 as a gym that does not exist.
import type { Sql } from "postgres";
import {
  leaderboardCountedResponseSchema,
  leaderboardProfileResponseSchema,
  leaderboardResponseSchema,
  leaderboardVisibilitySchema,
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
import { hiddenReason, rankBoard, shownName, type Board, type BoardPerson } from "./rank.js";
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
  const me = await repo.memberFacts(deps.sql, gymId, userId, gym.today);
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
  board: Board;
  from: string | null;
  to: string;
  circleDays: string[] | null;
  period: LeaderboardPeriod | null;
}

async function buildGymDays(deps: LeaderboardDeps, gymId: string, viewerId: string, today: string, period: LeaderboardPeriod): Promise<Built> {
  const { from, to } = periodRange(today, period);
  const week = isWeek(period) && from !== null ? weekDays(from) : null;
  const rows = await repo.gymDaysBoard(deps.sql, { gymId, today, from, to, viewerId, withDays: week !== null });
  const people: BoardPerson[] = rows.map((r) => ({ ...r, circles: week === null ? null : dayCircles(r.days, week) }));
  return { board: rankBoard(people, viewerId), from, to, circleDays: week, period };
}

async function buildStreak(deps: LeaderboardDeps, gymId: string, viewerId: string, today: string): Promise<Built> {
  const weeks = streakWeeks(today);
  const sinceWeek = weeks[0] ?? today;
  const { rows, gymWeeks } = await repo.streakBoard(deps.sql, { gymId, today, sinceWeek, viewerId });
  const active = new Set(gymWeeks);
  const people: BoardPerson[] = rows.map((r) => ({ ...r, circles: weekCircles(r.weeks, active, weeks) }));
  return { board: rankBoard(people, viewerId), from: null, to: today, circleDays: weeks, period: null };
}

export async function getLeaderboard(
  deps: LeaderboardDeps,
  viewerId: string,
  gymId: string,
  query: LeaderboardQuery,
): Promise<LeaderboardResponse> {
  const now = deps.now();
  const gym = await gymForMember(deps, gymId, viewerId, now);
  const built =
    query.board === "streak"
      ? await buildStreak(deps, gymId, viewerId, gym.today)
      : await buildGymDays(deps, gymId, viewerId, gym.today, query.period);
  // A lapsed gym's members see no board; Gym days and Streak only while the gym checks in.
  const status = !gym.live ? "paused" : !gym.checkingIn ? "no_checkins" : built.board.status;
  const showing = status === "shown";
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
    me: showing ? built.board.me : { ...built.board.me, place: null, toNextPlace: null, nextPlace: null },
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
    const { mine, gym: gymWeeks } = await repo.ownWeeks(deps.sql, { gymId, userId: viewerId, today: gym.today });
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
      weeks,
    });
  }

  const { from, to } = periodRange(gym.today, query.period);
  const visits = await repo.ownVisits(deps.sql, { gymId, userId: viewerId, today: gym.today, from, to });
  const days: LeaderboardCountedResponse["days"] = [];
  const notCounted: LeaderboardCountedResponse["notCounted"] = [];
  for (const v of visits) {
    if (v.method === "manual" || v.method === "qr") {
      notCounted.push({ day: v.day, at: v.markedAt.toISOString(), why: v.method === "manual" ? "own_tap" : "app_code" });
      continue;
    }
    const visit = { at: v.markedAt.toISOString(), how: v.method === "staff" ? "staff" : "desk", by: v.by } as const;
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
    weeks: [],
  });
}

/** A person's places on every board members see. Nothing for anyone hidden or not a
 *  live app member: the same 404 as a gym that does not exist. */
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
  const person = await repo.memberFacts(deps.sql, gymId, userId, gym.today);
  if (person === null) throw notFound();
  const named = shownName(person);
  if (named === null || (userId !== viewerId && hiddenReason({ ...person, value: 1, circles: null }) !== null)) {
    throw notFound();
  }
  const [days, streak] = await Promise.all([
    buildGymDays(deps, gymId, userId, gym.today, period),
    buildStreak(deps, gymId, userId, gym.today),
  ]);
  const placeOn = (built: Built) => ({
    board: built.period === null ? ("streak" as const) : ("gym_days" as const),
    period: built.period,
    place: gym.checkingIn && built.board.status === "shown" ? built.board.me.place : null,
    value: built.board.me.value,
  });
  return leaderboardProfileResponseSchema.parse({
    userId,
    name: named.name,
    initials: named.initials,
    boards: [placeOn(days), placeOn(streak)],
  });
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
