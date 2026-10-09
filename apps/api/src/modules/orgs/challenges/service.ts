// A GYM'S CHALLENGES (spec Part 3 §15.6; ROADMAP 19d-i).
//
// The worst thing this could do to a real person: show somebody who chose Hide me, or
// somebody the gym removed, to another member — in a challenge's places, in its count of
// who joined, or in its count of who reached the target. So who is hidden and under what
// name a person is shown are the leaderboard's own rules (`hiddenReason`, `shownName`);
// hidden people are taken out before a place is given (`place.ts`); every number a member
// is sent about other people is counted from the people left; and only a live app member
// of the gym now is ever counted at all.
//
// In teams (19d-ii-a) the same holds: a hidden person is in no list of a team's people, is
// not counted among them, and their number is not in the team's number that anybody else
// reads, so nobody can work it out from the total (`teamSums`, `teamBoardFor`).
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  GYM_CHALLENGES_CURRENT_MAX,
  GYM_CHALLENGES_PAST_SHOWN,
  GYM_CHALLENGE_PODIUM,
  GYM_CHALLENGE_SCORE_MAX,
  GYM_CHALLENGE_TEAMMATES_SHOWN,
  GYM_CHALLENGE_WORDS,
  LEADERBOARD_STAFF_PAGE,
  LEADERBOARD_TOP,
  challengeCan,
  challengeSaveProblem,
  challengeState,
  challengeTakesNumbers,
  challengeTakesTeams,
  placeTeams,
  gymChallengeBoardResponseSchema,
  gymChallengesResponseSchema,
  memberGymChallengeSchema,
  staffGymChallengeBoardResponseSchema,
  staffGymChallengeSchema,
  staffGymChallengesResponseSchema,
  type AddGymChallengeRequest,
  type ChangeGymChallengeRequest,
  type GymChallenge,
  type GymChallengeBoardResponse,
  type GymChallengeRow,
  type GymChallengeSaveProblem,
  type GymChallengeState,
  type GymChallengesResponse,
  type LeaderboardHiddenReason,
  type MemberGymChallenge,
  type MemberTeamBoard,
  type SetChallengeScoresRequest,
  type SetChallengeTeamPeopleRequest,
  type StaffGymChallenge,
  type StaffGymChallengeBoardResponse,
  type StaffGymChallengeRow,
  type StaffGymChallengesResponse,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { gymToday } from "../events/repo.js";
import { fullName, hiddenReason, rankStaffBoard, shownName, type BoardPerson } from "../leaderboard/rank.js";
import * as boards from "../leaderboard/repo.js";
import { lockGym } from "../memberList/repo.js";
import { placeEntrants, type Entrant } from "./place.js";
import * as repo from "./repo.js";

export interface ChallengesDeps {
  sql: Sql;
  /** The clock: "today" on the gym's calendar is worked out from it. */
  now: () => Date;
}

/** The route's rate limit, asked after who is asking: false when it has already answered 429. */
export type Limit = () => Promise<boolean>;

/** A challenge ranks the gym's people: the staff who run its leaderboard make them. */
const TICK = "leaderboard.manage";

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const challengeNotFound = (): OrgsError => new OrgsError(404, "challenge_not_found", GYM_CHALLENGE_WORDS.not_found);

const SAVE_STATUS: Record<GymChallengeSaveProblem, { status: number; code: string }> = {
  ended: { status: 409, code: "challenge_ended" },
  started_locked: { status: 409, code: "challenge_started" },
  starts_too_early: { status: 400, code: "challenge_starts_too_early" },
  starts_too_far: { status: 400, code: "challenge_starts_too_far" },
  ends_before_today: { status: 400, code: "challenge_ends_before_today" },
};

function refused(problem: GymChallengeSaveProblem): OrgsError {
  return new OrgsError(SAVE_STATUS[problem].status, SAVE_STATUS[problem].code, GYM_CHALLENGE_WORDS[problem]);
}

function shaped(row: repo.ChallengeRow, today: string): GymChallenge {
  return {
    id: row.id,
    name: row.name,
    details: row.details,
    prize: row.prize,
    counts: row.counts,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    target: row.target,
    who: row.who,
    unit: row.unit,
    lowestWins: row.lowestWins,
    teams: row.teams,
    cancelled: row.cancelled,
    state: challengeState(row, today),
  };
}

const STATE_ORDER: Record<GymChallengeState, number> = { running: 0, coming: 1, ended: 2 };

/** Running first, the soonest to end first; then coming, the soonest to start first; then
 *  ended, the newest first. */
function inOrder(rows: readonly repo.ChallengeRow[], today: string): repo.ChallengeRow[] {
  const key = (row: repo.ChallengeRow): [number, string] => {
    const state = challengeState(row, today);
    return [STATE_ORDER[state], state === "coming" ? row.startsOn : row.endsOn];
  };
  return [...rows].sort((a, b) => {
    const [stateA, dayA] = key(a);
    const [stateB, dayB] = key(b);
    if (stateA !== stateB) return stateA - stateB;
    if (dayA !== dayB) return stateA === STATE_ORDER.ended ? (dayA < dayB ? 1 : -1) : dayA < dayB ? -1 : 1;
    return a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1;
  });
}

// ── WHAT IS COUNTED ──

interface Read {
  gymId: string;
  gym: boards.BoardGym;
  /** The instant of the read. */
  at: string;
}

/** A live app member of the gym, as a board needs them: their name and why members do not
 *  see them, each worked out once a read by the leaderboard's own rule. */
interface Member {
  facts: boards.MemberFacts;
  hidden: LeaderboardHiddenReason | null;
  shown: { name: string; initials: string } | null;
}

/** One kind's read: each live member with a counted day, and their number in each of that
 *  kind's challenges. */
interface Numbers {
  rows: { member: Member; counts: number[] }[];
  /** The asker's own numbers, when they have a counted day; and those days, oldest first. */
  mine: number[] | null;
  days: string[];
}

interface Counted {
  /** Every live app member of the gym now. */
  members: Map<string, Member>;
  /** Where each started challenge's numbers are: its kind's read, and its place in it. */
  numbers: Map<string, { of: Numbers; at: number }>;
  /** Who joined each challenge people join, of the live app members. */
  joined: Map<string, Set<Member>>;
  /** Each challenge's teams in the gym's order, and which team each person is in. */
  teams: Map<string, repo.TeamRow[]>;
  teamOf: Map<string, Map<string, string>>;
  /** `valuesIn`, kept for the read: a challenge in teams asks for it more than once. */
  values: Map<string, Map<Member, number>>;
}

const person = (facts: boards.MemberFacts, value: number): BoardPerson => ({ ...facts, value, circles: null });

/** One read of everything the challenges' boards are made of: the leaderboard's own count
 *  over each challenge's dates. A cancelled challenge and one not started count nothing. */
async function countFor(deps: ChallengesDeps, read: Read, rows: readonly repo.ChallengeRow[], daysOf: string | null): Promise<Counted> {
  const counting = rows.filter((row) => !row.cancelled && row.startsOn <= read.gym.today);
  const ofKind = (counts: repo.ChallengeRow["counts"]): repo.ChallengeRow[] => counting.filter((row) => row.counts === counts);
  const ranges = (kind: readonly repo.ChallengeRow[]): boards.DayRange[] => kind.map((row) => ({ from: row.startsOn, to: row.endsOn }));
  const gymKind = ofKind("gym_days");
  const workoutKind = ofKind("workout_days");
  const input = { gymId: read.gymId, at: read.at, today: read.gym.today, daysOf };
  const ownKind = ofKind("own");
  const inTeams = rows.filter((row) => row.teams !== "none").map((row) => row.id);
  const [facts, joinedIds, gymDays, workoutDays, typed, teams, teamOf] = await Promise.all([
    boards.allMemberFacts(deps.sql, read.gymId, read.at),
    repo.joinedBy(deps.sql, read.gymId, rows.filter((row) => row.who === "joined").map((row) => row.id)),
    boards.gymDaysInRanges(deps.sql, { ...input, ranges: ranges(gymKind) }),
    boards.workoutDaysInRanges(deps.sql, { ...input, ranges: ranges(workoutKind) }),
    repo.scoresOf(deps.sql, read.gymId, ownKind.map((row) => row.id)),
    repo.teamsOf(deps.sql, read.gymId, inTeams),
    repo.teamPeopleOf(deps.sql, read.gymId, inTeams),
  ]);
  const members = new Map<string, Member>();
  for (const f of facts) members.set(f.userId, { facts: f, hidden: hiddenReason(person(f, 1)), shown: shownName(f) });
  const numbers = new Map<string, { of: Numbers; at: number }>();
  for (const [kind, counts] of [[gymKind, gymDays], [workoutKind, workoutDays]] as const) {
    // Only a live app member of the gym now is counted: anybody else's days are dropped here.
    const of: Numbers = { rows: [], mine: null, days: counts.days };
    for (const row of counts.rows) {
      const member = members.get(row.userId);
      if (member === undefined) continue;
      of.rows.push({ member, counts: row.counts });
      if (row.userId === daysOf) of.mine = row.counts;
    }
    kind.forEach((row, at) => numbers.set(row.id, { of, at }));
  }
  // The gym's own count: each person's number is the one staff typed.
  for (const row of ownKind) {
    const of: Numbers = { rows: [], mine: null, days: [] };
    for (const score of typed.get(row.id) ?? []) {
      const member = members.get(score.userId);
      if (member === undefined) continue;
      of.rows.push({ member, counts: [score.value] });
      if (score.userId === daysOf) of.mine = [score.value];
    }
    numbers.set(row.id, { of, at: 0 });
  }
  const joined = new Map<string, Set<Member>>();
  for (const [challengeId, userIds] of joinedIds) {
    const of = new Set<Member>();
    for (const userId of userIds) {
      const member = members.get(userId);
      if (member !== undefined) of.add(member);
    }
    joined.set(challengeId, of);
  }
  return { members, numbers, joined, teams, teamOf, values: new Map() };
}

/** Who joined a challenge people join; null for everyone's. */
const joinedOf = (row: repo.ChallengeRow, counted: Counted): Set<Member> | null =>
  row.who === "joined" ? (counted.joined.get(row.id) ?? new Set<Member>()) : null;

/** Where the lowest number wins, a number is turned round before places are given, so
 *  the smallest is the largest, and turned back before it is sent. */
const TURN = GYM_CHALLENGE_SCORE_MAX + 1;
const turned = (row: repo.ChallengeRow, value: number): number => (row.lowestWins && value > 0 ? TURN - value : value);

/** The people in a challenge with a number in it, each with that number as it is kept:
 *  live app members of the gym now, and for a challenge people join, only the ones who joined. */
function valuesIn(row: repo.ChallengeRow, counted: Counted): Map<Member, number> {
  const kept = counted.values.get(row.id);
  if (kept !== undefined) return kept;
  const joined = joinedOf(row, counted);
  const numbers = counted.numbers.get(row.id);
  const values = new Map<Member, number>();
  counted.values.set(row.id, values);
  if (numbers === undefined) return values;
  for (const { member, counts } of numbers.of.rows) {
    const value = counts[numbers.at] ?? 0;
    if (value === 0 || (joined !== null && !joined.has(member))) continue;
    values.set(member, value);
  }
  return values;
}

function entrantsOf(row: repo.ChallengeRow, counted: Counted): Entrant[] {
  const entrants: Entrant[] = [];
  for (const [member, value] of valuesIn(row, counted)) {
    entrants.push({ userId: member.facts.userId, value: turned(row, value), hidden: member.hidden, shown: member.shown });
  }
  return entrants;
}

/** The number ONE PERSON has to reach. In teams the target is the team's, so nobody has one. */
const soloTarget = (row: repo.ChallengeRow): number | null => (row.teams === "none" ? row.target : null);
const reachedBy = (row: repo.ChallengeRow, value: number): boolean => {
  const target = soloTarget(row);
  return target !== null && value >= target;
};

// ── TEAMS ──

/** Members see a person: not hidden, and with a name to show. `placeEntrants` leaves out
 *  exactly the people this is false for. */
const seen = (member: Member): boolean => member.hidden === null && member.shown !== null;

interface TeamSum {
  /** People in it members may count; `viewer` is counted in their own while hidden. */
  people: number;
  /** Everyone in it, the hidden too: for staff. */
  all: number;
  /** The numbers of the people members may see, added together. Nobody hidden is in it. */
  value: number;
}

/** Each of the challenge's teams with the people in it who are in the challenge now. */
function teamSums(row: repo.ChallengeRow, counted: Counted, viewer: Member | undefined): Map<string, TeamSum> {
  const sums = new Map<string, TeamSum>();
  for (const team of counted.teams.get(row.id) ?? []) sums.set(team.id, { people: 0, all: 0, value: 0 });
  const joined = joinedOf(row, counted);
  const values = valuesIn(row, counted);
  for (const [userId, teamId] of counted.teamOf.get(row.id) ?? []) {
    const member = counted.members.get(userId);
    const sum = sums.get(teamId);
    if (member === undefined || sum === undefined || (joined !== null && !joined.has(member))) continue;
    sum.all += 1;
    if (seen(member) || member === viewer) sum.people += 1;
    if (seen(member)) sum.value += values.get(member) ?? 0;
  }
  return sums;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A challenge's teams as one member reads them. `shown`: the people's board is shown (three
 *  people have a number); until it is, no team has a number either, since a small team's
 *  number is one person's. `inIt`: the member is in the challenge. */
function teamBoardFor(row: repo.ChallengeRow, state: GymChallengeState, counted: Counted, viewerId: string, inIt: boolean, shown: boolean): MemberTeamBoard | null {
  if (row.teams === "none") return null;
  if (row.cancelled) return { status: "not_started", rows: [], mine: null };
  const viewer = counted.members.get(viewerId);
  const teamOf = counted.teamOf.get(row.id) ?? new Map<string, string>();
  const myTeam = inIt && viewer !== undefined ? (teamOf.get(viewerId) ?? null) : null;
  const sums = teamSums(row, counted, inIt ? viewer : undefined);
  const teams = counted.teams.get(row.id) ?? [];
  const totals = teams.map((team) => ({ id: team.id, value: shown ? (sums.get(team.id)?.value ?? 0) : 0 }));
  const places = placeTeams(totals, row.lowestWins);
  const rows = teams.map((team, at) => {
    const value = totals[at]?.value ?? 0;
    return {
      id: team.id,
      name: team.name,
      people: sums.get(team.id)?.people ?? 0,
      value,
      place: places.get(team.id) ?? null,
      reached: row.target !== null && value >= row.target,
      isMine: team.id === myTeam,
    };
  });
  let mine: MemberTeamBoard["mine"] = null;
  if (myTeam !== null && viewer !== undefined && sums.has(myTeam)) {
    const values = valuesIn(row, counted);
    const me = { userId: viewerId, name: viewer.shown?.name ?? "You", initials: viewer.shown?.initials ?? "", value: values.get(viewer) ?? 0, isMe: true };
    // Teammates are named only with a number of their own, as the people's board names
    // people: somebody staff put in a team who has done nothing is named to nobody.
    const mates: typeof me[] = [];
    if (shown) {
      const joined = joinedOf(row, counted);
      for (const [userId, teamId] of teamOf) {
        const member = counted.members.get(userId);
        if (teamId !== myTeam || userId === viewerId || member === undefined || member.shown === null || !seen(member)) continue;
        const value = values.get(member) ?? 0;
        if (value === 0 || (joined !== null && !joined.has(member))) continue;
        mates.push({ userId, name: member.shown.name, initials: member.shown.initials, value, isMe: false });
      }
    }
    const people = [...mates, me].sort((a, b) => (row.lowestWins ? Number(a.value === 0) - Number(b.value === 0) || a.value - b.value : b.value - a.value) || byText(a.name, b.name) || byText(a.userId, b.userId));
    const top = people.slice(0, GYM_CHALLENGE_TEAMMATES_SHOWN);
    const listed = top.includes(me) ? top : [...top, me];
    mine = { teamId: myTeam, people: listed, more: people.length - listed.length, counted: seen(viewer) };
  }
  return { status: state === "coming" ? "not_started" : shown ? "shown" : "too_few", rows, mine };
}

interface MemberView {
  challenge: MemberGymChallenge;
  /** The board's first rows, as many as were asked for. */
  rows: GymChallengeRow[];
}

/** A challenge as one member reads it, with the first `limit` rows of its board. Nothing
 *  here about other people is computed from somebody they may not see. */
function memberView(row: repo.ChallengeRow, today: string, counted: Counted, viewerId: string, limit: number): MemberView {
  const base = shaped(row, today);
  const joined = joinedOf(row, counted);
  const viewer = counted.members.get(viewerId);
  const iJoined = viewer !== undefined && (joined?.has(viewer) ?? false);
  const hasTeam = counted.teamOf.get(row.id)?.has(viewerId) ?? false;
  const can = challengeCan({ who: row.who, cancelled: row.cancelled, state: base.state, joined: iJoined, teams: row.teams, hasTeam });
  // The people who joined that this member may count: nobody hidden, and themselves.
  let joinedCount: number | null = null;
  if (joined !== null) {
    joinedCount = 0;
    for (const member of joined) {
      if (member === viewer || member.hidden === null) joinedCount += 1;
    }
  }
  const none = { status: "not_started" as const, ranked: 0, top: [], leaders: 0, reached: null };
  // A cancelled challenge has no board and no line of anybody's.
  const inIt = joined === null || iJoined;
  if (row.cancelled) {
    return { challenge: { ...base, joined: iJoined, can, joinedCount, teamBoard: teamBoardFor(row, base.state, counted, viewerId, inIt, false), board: none, me: null }, rows: [] };
  }

  const entrants = base.state === "coming" ? [] : entrantsOf(row, counted);
  const numbers = counted.numbers.get(row.id);
  // In it, they have a line of their own even at nothing.
  if (inIt && viewer !== undefined && (numbers?.of.mine?.[numbers.at] ?? 0) === 0) {
    entrants.push({ userId: viewerId, value: 0, hidden: viewer.hidden, shown: viewer.shown });
  }
  // `placeEntrants` leaves hidden people out before it counts: every number below is of
  // the people members may see.
  const places = placeEntrants(entrants, viewerId, Math.max(limit, GYM_CHALLENGE_PODIUM), soloTarget(row));
  const shown = base.state !== "coming" && places.status === "shown";
  const rows: GymChallengeRow[] = shown ? places.top.map((p) => ({ ...p, value: turned(row, p.value), reached: reachedBy(row, turned(row, p.value)) })) : [];
  const myValue = turned(row, places.me.value);
  const challenge: MemberGymChallenge = {
    ...base,
    joined: iJoined,
    can,
    joinedCount,
    teamBoard: teamBoardFor(row, base.state, counted, viewerId, inIt, shown),
    board: {
      status: base.state === "coming" ? "not_started" : places.status,
      ranked: shown ? places.ranked : 0,
      top: rows.slice(0, GYM_CHALLENGE_PODIUM),
      leaders: shown ? places.leaders : 0,
      reached: shown ? places.reached : null,
    },
    me: inIt
      ? {
          value: myValue,
          place: shown ? places.me.place : null,
          hidden: places.me.hidden,
          toNextPlace: shown ? places.me.toNextPlace : null,
          nextPlace: shown ? places.me.nextPlace : null,
          reached: reachedBy(row, myValue),
          days: numbers === undefined ? [] : numbers.of.days.filter((day) => day >= row.startsOn && day <= row.endsOn),
        }
      : null,
  };
  return { challenge, rows: rows.slice(0, limit) };
}

// ── MEMBERS ──

/** The gym and the asker, for a live app member of it; 404 for everybody else. `paused`:
 *  the gym is closed or on no plan, and its members are shown no challenge. */
async function forMember(deps: ChallengesDeps, gymId: string, userId: string): Promise<Read & { now: Date; paused: boolean }> {
  const now = deps.now();
  const [gate, gym] = await Promise.all([repo.memberGate(deps.sql, gymId, userId), boards.boardGym(deps.sql, gymId, now)]);
  if (gate === null || gym === null || !gate.member) throw notFound();
  return { gymId, gym, at: now.toISOString(), now, paused: !(gate.status === "active" && gym.live) };
}

/** The gym's challenges for a live app member of it; 404 for everybody else. */
export async function getChallenges(deps: ChallengesDeps, userId: string, gymId: string, limit: Limit): Promise<GymChallengesResponse | null> {
  const read = await forMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const head = { gymId, gymName: read.gym.name, timezone: read.gym.timezone, today: read.gym.today, checkingIn: read.gym.checkingIn, asOf: read.at };
  if (read.paused) return gymChallengesResponseSchema.parse({ ...head, status: "paused", challenges: [] });
  const rows = inOrder(await repo.memberChallenges(deps.sql, gymId, read.gym.today, read.now), read.gym.today);
  if (rows.length === 0) return gymChallengesResponseSchema.parse({ ...head, status: "shown", challenges: [] });
  const counted = await countFor(deps, read, rows, userId);
  return gymChallengesResponseSchema.parse({
    ...head,
    status: "shown",
    challenges: rows.map((row) => memberView(row, read.gym.today, counted, userId, GYM_CHALLENGE_PODIUM).challenge),
  });
}

/** One challenge a member is sent, read fresh; 404 for one they are not. */
async function oneForMember(deps: ChallengesDeps, read: Read & { now: Date; paused: boolean }, challengeId: string, userId: string, limit: number): Promise<MemberView> {
  if (read.paused) throw challengeNotFound();
  const row = await repo.memberChallenge(deps.sql, read.gymId, challengeId, read.gym.today, read.now);
  if (row === null) throw challengeNotFound();
  return memberView(row, read.gym.today, await countFor(deps, read, [row], userId), userId, limit);
}

/** A challenge's whole board: the first hundred, and the asker's own line. */
export async function getBoard(deps: ChallengesDeps, userId: string, gymId: string, challengeId: string, limit: Limit): Promise<GymChallengeBoardResponse | null> {
  const read = await forMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const view = await oneForMember(deps, read, challengeId, userId, LEADERBOARD_TOP);
  return gymChallengeBoardResponseSchema.parse({
    challengeId,
    status: view.challenge.board.status,
    ranked: view.challenge.board.ranked,
    rows: view.rows,
    me: view.challenge.me,
    asOf: read.at,
  });
}

/** Join a challenge people join, or leave it. Asked twice, it is done once. Answers the
 *  challenge as the member reads it now. */
export async function setJoined(
  deps: ChallengesDeps,
  userId: string,
  gymId: string,
  challengeId: string,
  joined: boolean,
  limit: Limit,
): Promise<MemberGymChallenge | null> {
  const read = await forMember(deps, gymId, userId);
  if (!(await limit())) return null;
  if (read.paused) throw challengeNotFound();
  const row = await repo.memberChallenge(deps.sql, gymId, challengeId, read.gym.today, read.now);
  if (row === null) throw challengeNotFound();
  if (row.who !== "joined") throw new OrgsError(409, "challenge_everyone", GYM_CHALLENGE_WORDS.join_everyone);
  if (row.cancelled) throw new OrgsError(409, "challenge_cancelled", GYM_CHALLENGE_WORDS.cancelled);
  if (challengeState(row, read.gym.today) === "ended") throw new OrgsError(409, "challenge_ended", GYM_CHALLENGE_WORDS.join_ended);
  if (joined) await repo.join(deps.sql, gymId, challengeId, userId, read.now);
  else await repo.leave(deps.sql, gymId, challengeId, userId);
  const view = memberView(row, read.gym.today, await countFor(deps, read, [row], userId), userId, GYM_CHALLENGE_PODIUM);
  return memberGymChallengeSchema.parse(view.challenge);
}

/** A member picks their team, where members pick. Picked twice, it is one pick. Until the
 *  first day they may pick another; after it a first pick still stands, and a change is
 *  refused. For a challenge people join, picking a team joins it. */
export async function pickTeam(deps: ChallengesDeps, userId: string, gymId: string, challengeId: string, teamId: string, limit: Limit): Promise<MemberGymChallenge | null> {
  const read = await forMember(deps, gymId, userId);
  if (!(await limit())) return null;
  if (read.paused) throw challengeNotFound();
  // Whether a member is sent this challenge at all, by the list's own rule.
  if ((await repo.memberChallenge(deps.sql, gymId, challengeId, read.gym.today, read.now)) === null) throw challengeNotFound();
  const row = await deps.sql.begin(async (tx) => {
    // Held against staff changing its dates or its teams while this is decided.
    const held = await repo.shareChallenge(tx, gymId, challengeId);
    if (held === null) throw challengeNotFound();
    if (held.teams === "none") throw new OrgsError(409, "challenge_no_teams", GYM_CHALLENGE_WORDS.teams_none);
    if (held.teams === "staff") throw new OrgsError(409, "challenge_teams_staff", GYM_CHALLENGE_WORDS.teams_staff);
    if (held.cancelled) throw new OrgsError(409, "challenge_cancelled", GYM_CHALLENGE_WORDS.cancelled);
    const state = challengeState(held, read.gym.today);
    if (state === "ended") throw new OrgsError(409, "challenge_ended", GYM_CHALLENGE_WORDS.join_ended);
    const teams = (await repo.teamsOf(tx, gymId, [challengeId])).get(challengeId) ?? [];
    if (!teams.some((team) => team.id === teamId)) throw new OrgsError(409, "challenge_team_gone", GYM_CHALLENGE_WORDS.team_gone);
    if (!(await repo.pickTeam(tx, gymId, challengeId, userId, teamId, state === "coming", read.now))) {
      throw new OrgsError(409, "challenge_team_locked", GYM_CHALLENGE_WORDS.team_locked);
    }
    if (held.who === "joined") await repo.join(tx, gymId, challengeId, userId, read.now);
    return held;
  });
  const view = memberView(row, read.gym.today, await countFor(deps, read, [row], userId), userId, GYM_CHALLENGE_PODIUM);
  return memberGymChallengeSchema.parse(view.challenge);
}

// ── STAFF HOLDING `leaderboard.manage` ──

/** A challenge's teams as staff are sent them, with everyone in each; no numbers. */
async function staffTeams(deps: ChallengesDeps, gymId: string, rows: readonly repo.ChallengeRow[]): Promise<(row: repo.ChallengeRow) => StaffGymChallenge["teamList"]> {
  const ids = rows.filter((row) => row.teams !== "none").map((row) => row.id);
  const [teams, sizes] = await Promise.all([repo.teamsOf(deps.sql, gymId, ids), repo.teamSizes(deps.sql, gymId, ids)]);
  return (row) => (teams.get(row.id) ?? []).map((team) => ({ id: team.id, name: team.name, people: sizes.get(team.id) ?? 0, value: null, place: null }));
}

async function staffChallenge(deps: ChallengesDeps, gymId: string, challengeId: string): Promise<StaffGymChallenge> {
  const [row, today, counts] = await Promise.all([
    repo.challengeById(deps.sql, gymId, challengeId),
    gymToday(deps.sql, gymId, deps.now()),
    repo.joinedCounts(deps.sql, gymId, [challengeId]),
  ]);
  if (row === null || today === null) throw challengeNotFound();
  const teamList = (await staffTeams(deps, gymId, [row]))(row);
  return staffGymChallengeSchema.parse({ ...shaped(row, today), joinedCount: row.who === "joined" ? (counts.get(row.id) ?? 0) : null, top: [], withNumber: null, teamList });
}

/** The gym's challenges, current and ended, for its staff holding the tick. */
export async function getStaffChallenges(deps: ChallengesDeps, staffId: string, gymId: string, limit: Limit): Promise<StaffGymChallengesResponse | null> {
  const { org } = await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const now = deps.now();
  const gym = await boards.boardGym(deps.sql, gymId, now);
  if (gym === null) throw notFound();
  const [current, past, pastTotal, inApp] = await Promise.all([
    repo.currentChallenges(deps.sql, gymId, gym.today),
    repo.pastChallenges(deps.sql, gymId, gym.today, GYM_CHALLENGES_PAST_SHOWN),
    repo.countPast(deps.sql, gymId, gym.today),
    repo.inAppCount(deps.sql, gymId),
  ]);
  const counts = await repo.joinedCounts(deps.sql, gymId, [...current, ...past].filter((row) => row.who === "joined").map((row) => row.id));
  // The card of a challenge that has not ended carries its first three and how many have a
  // number: one read for all of them (six at most).
  const counted = current.length === 0 ? null : await countFor(deps, { gymId, gym, at: now.toISOString() }, current, null);
  const teamsOf = await staffTeams(deps, gymId, [...current, ...past]);
  const leading = (row: repo.ChallengeRow): Pick<StaffGymChallenge, "top" | "withNumber" | "teamList"> => {
    if (counted === null || row.cancelled || challengeState(row, gym.today) === "coming") return { top: [], withNumber: null, teamList: teamsOf(row) };
    const entrants = entrantsOf(row, counted);
    // Placed as members see them (nobody hidden), under the full name staff read.
    const named = entrants.map((e) => {
      const full = fullName(counted.members.get(e.userId)?.facts ?? { displayName: "", email: null, recordName: null });
      return { ...e, shown: e.hidden === null && full.name !== null ? { name: full.name, initials: full.initials } : null };
    });
    const places = placeEntrants(named, "", GYM_CHALLENGE_PODIUM, soloTarget(row));
    // Each team's number and place as members see them: none while they see no board.
    const sums = teamSums(row, counted, undefined);
    const teamPlaces = placeTeams([...sums].map(([id, sum]) => ({ id, value: sum.value })), row.lowestWins);
    const teamList = teamsOf(row).map((team) => (places.status === "shown" ? { ...team, value: sums.get(team.id)?.value ?? 0, place: teamPlaces.get(team.id) ?? null } : team));
    return { top: places.top.map((p) => ({ userId: p.userId, name: p.name, initials: p.initials, place: p.place, value: turned(row, p.value) })), withNumber: entrants.length, teamList };
  };
  const sent = (row: repo.ChallengeRow): StaffGymChallenge => ({
    ...shaped(row, gym.today),
    joinedCount: row.who === "joined" ? (counts.get(row.id) ?? 0) : null,
    top: [],
    withNumber: null,
    teamList: teamsOf(row),
  });
  const sentCurrent = (row: repo.ChallengeRow): StaffGymChallenge => ({ ...sent(row), ...leading(row) });
  return staffGymChallengesResponseSchema.parse({
    gymId,
    gymName: org.name,
    timezone: org.timezone,
    today: gym.today,
    checkingIn: gym.checkingIn,
    inApp,
    current: inOrder(current, gym.today).map(sentCurrent),
    past: past.map(sent),
    pastTotal,
  });
}

const byName = (a: string | null, b: string | null): number => Number(a === null) - Number(b === null) || ((a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0);

/** A challenge's board for staff: everyone with a number, the hidden with the reason; for
 *  a challenge people join, everyone who joined, at 0 too; and for the gym's own count or
 *  a challenge in teams, everyone in it, so each person has a row to be put in a team on. */
export async function getStaffBoard(
  deps: ChallengesDeps,
  staffId: string,
  gymId: string,
  challengeId: string,
  page: number,
  limit: Limit,
): Promise<StaffGymChallengeBoardResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const now = deps.now();
  const [gym, row] = await Promise.all([boards.boardGym(deps.sql, gymId, now), repo.challengeById(deps.sql, gymId, challengeId)]);
  if (gym === null) throw notFound();
  if (row === null) throw challengeNotFound();
  const counted = await countFor(deps, { gymId, gym, at: now.toISOString() }, [row], null);
  const started = challengeState(row, gym.today) !== "coming" && !row.cancelled;
  const people = started
    ? entrantsOf(row, counted).flatMap((e) => {
        const member = counted.members.get(e.userId);
        return member === undefined ? [] : [person(member.facts, e.value)];
      })
    : [];
  const staff = rankStaffBoard(people);
  // A place is the place MEMBERS see: while they see no board, nobody has one.
  const shown = started && staff.status === "shown";
  const teamOf = counted.teamOf.get(row.id) ?? new Map<string, string>();
  const numbered: StaffGymChallengeRow[] = staff.rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    initials: r.initials,
    place: shown ? r.place : null,
    value: turned(row, r.value),
    hidden: r.hidden,
    reached: reachedBy(row, turned(row, r.value)),
    teamId: teamOf.get(r.userId) ?? null,
  }));
  const has = new Set(numbered.map((r) => r.userId));
  // At 0: everyone who joined; and for the gym's own count everyone in it, so staff have
  // each person's row to type a number in.
  const atNothing = joinedOf(row, counted) ?? (row.counts === "own" || row.teams !== "none" ? counted.members.values() : []);
  const waiting: StaffGymChallengeRow[] = [...atNothing]
    .flatMap((member) => {
      const userId = member.facts.userId;
      if (has.has(userId)) return [];
      const named = fullName(member.facts);
      return [{ userId, name: named.name, initials: named.initials, place: null, value: 0, hidden: member.hidden, reached: false, teamId: teamOf.get(userId) ?? null }];
    })
    .sort((a, b) => byName(a.name, b.name) || (a.userId < b.userId ? -1 : 1));
  const rows = [...numbered, ...waiting];
  const pages = Math.max(1, Math.ceil(rows.length / LEADERBOARD_STAFF_PAGE));
  const at = Math.min(page, pages);
  return staffGymChallengeBoardResponseSchema.parse({
    challengeId,
    memberStatus: !started ? "not_started" : staff.status,
    ranked: shown ? staff.ranked : 0,
    total: rows.length,
    hidden: rows.filter((r) => r.hidden !== null).length,
    reached: soloTarget(row) === null ? null : numbered.filter((r) => r.reached).length,
    page: at,
    pages,
    rows: rows.slice((at - 1) * LEADERBOARD_STAFF_PAGE, at * LEADERBOARD_STAFF_PAGE),
    asOf: now.toISOString(),
  });
}

/** A new challenge. Sent twice under one key (a reply lost on the way back), it is one. */
export async function addChallenge(deps: ChallengesDeps, staffId: string, gymId: string, body: AddGymChallengeRequest, limit: Limit): Promise<StaffGymChallenge | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  const id = randomUUID();
  await deps.sql.begin(async (tx) => {
    // The gym held: two challenges added at once are counted one after the other.
    await lockGym(tx, gymId);
    if ((await repo.challengeIdByKey(tx, gymId, body.challengeKey)) !== null) return;
    const today = await gymToday(tx, gymId, at);
    if (today === null) throw notFound();
    const problem = challengeSaveProblem({ today, before: null, next: body });
    if (problem !== null) throw refused(problem);
    if ((await repo.countCurrent(tx, gymId, today)) >= GYM_CHALLENGES_CURRENT_MAX) throw new OrgsError(409, "challenges_full", GYM_CHALLENGE_WORDS.full);
    if (!(await repo.insertChallenge(tx, gymId, { id, ...body }, staffId, at))) return;
    // Every team of a new challenge is new, whatever id was sent with it.
    await repo.setTeams(tx, gymId, id, body.teamList.map((team) => ({ id: null, name: team.name })), at);
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.challenge_added", targetType: "challenge", targetId: id, meta: { counts: body.counts, who: body.who, teams: body.teams } });
  });
  const kept = await repo.challengeIdByKey(deps.sql, gymId, body.challengeKey);
  if (kept === null) throw challengeNotFound();
  return await staffChallenge(deps, gymId, kept);
}

/** Staff change a challenge that has not ended. Once it has started only its name, words,
 *  prize and last day can change (`challengeSaveProblem`). */
export async function changeChallenge(
  deps: ChallengesDeps,
  staffId: string,
  gymId: string,
  challengeId: string,
  body: ChangeGymChallengeRequest,
  limit: Limit,
): Promise<StaffGymChallenge | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const before = await repo.lockChallenge(tx, gymId, challengeId);
    const today = await gymToday(tx, gymId, at);
    if (before === null || today === null) throw challengeNotFound();
    const teamList = (await repo.teamsOf(tx, gymId, [challengeId])).get(challengeId) ?? [];
    const problem = challengeSaveProblem({ today, before: { ...before, teamList }, next: body });
    if (problem !== null) throw refused(problem);
    await repo.updateChallenge(tx, gymId, challengeId, body, at);
    // Once it has started its teams are as they were (`challengeSaveProblem`): only a
    // challenge that has not started has its teams made the ones sent.
    if (challengeState(before, today) === "coming" && !(await repo.setTeams(tx, gymId, challengeId, body.teamList, at))) {
      throw new OrgsError(409, "challenge_team_gone", GYM_CHALLENGE_WORDS.team_gone);
    }
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.challenge_changed", targetType: "challenge", targetId: challengeId, meta: {} });
  });
  return await staffChallenge(deps, gymId, challengeId);
}

/** Staff cancel a challenge that has not ended, or un-cancel it. Everybody who joined
 *  stays joined through a cancel, so one brought back is as it was. */
export async function setCancelled(
  deps: ChallengesDeps,
  staffId: string,
  gymId: string,
  challengeId: string,
  cancelled: boolean,
  limit: Limit,
): Promise<StaffGymChallenge | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const row = await repo.lockChallenge(tx, gymId, challengeId);
    const today = await gymToday(tx, gymId, at);
    if (row === null || today === null) throw challengeNotFound();
    if (challengeState(row, today) === "ended") throw refused("ended");
    // Asked again, it is already so: nothing is written twice.
    if (row.cancelled === cancelled) return;
    await repo.setCancelled(tx, gymId, challengeId, cancelled ? at : null, at);
    await insertAudit(tx, { actorUserId: staffId, gymId, action: cancelled ? "org.challenge_cancelled" : "org.challenge_uncancelled", targetType: "challenge", targetId: challengeId, meta: {} });
  });
  return await staffChallenge(deps, gymId, challengeId);
}

/** Staff type people's numbers for a challenge of the gym's own count: a number replaces
 *  the one before, null or 0 takes it off. Only for people in the challenge now. Sent
 *  twice it leaves the same numbers. */
export async function setScores(
  deps: ChallengesDeps,
  staffId: string,
  gymId: string,
  challengeId: string,
  body: SetChallengeScoresRequest,
  limit: Limit,
): Promise<{ saved: number } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  // The last number sent for a person is theirs.
  const wanted = new Map(body.scores.map((score) => [score.userId, score.value]));
  await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const row = await repo.lockChallenge(tx, gymId, challengeId);
    const today = await gymToday(tx, gymId, at);
    if (row === null || today === null) throw challengeNotFound();
    if (row.counts !== "own") throw new OrgsError(409, "challenge_not_own", GYM_CHALLENGE_WORDS.scores_not_own);
    if (row.cancelled) throw new OrgsError(409, "challenge_cancelled", GYM_CHALLENGE_WORDS.cancelled);
    if (challengeState(row, today) === "coming") throw new OrgsError(409, "challenge_not_started", GYM_CHALLENGE_WORDS.scores_not_started);
    if (!challengeTakesNumbers(row, today)) throw new OrgsError(409, "challenge_numbers_closed", GYM_CHALLENGE_WORDS.scores_closed);
    const inIt = await repo.inChallenge(tx, gymId, challengeId, row.who === "joined", [...wanted.keys()]);
    for (const userId of wanted.keys()) {
      if (!inIt.has(userId)) throw new OrgsError(409, "challenge_person_not_in", GYM_CHALLENGE_WORDS.scores_person);
    }
    // Two statements whatever the number of people: the gym's row is held meanwhile.
    const kept: { userId: string; value: number }[] = [];
    const gone: string[] = [];
    for (const [userId, value] of wanted) {
      if (value === null || value === 0) gone.push(userId);
      else kept.push({ userId, value });
    }
    await repo.putScores(tx, gymId, challengeId, kept, at);
    await repo.removeScores(tx, gymId, challengeId, gone);
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.challenge_scores_set", targetType: "challenge", targetId: challengeId, meta: { people: String(wanted.size) } });
  });
  return { saved: wanted.size };
}

/** Staff put people in a team, move them, or take them out of every team: only people in
 *  the challenge now, only into a team of this challenge, until its last day ends. Nobody
 *  who was not sent is touched. Sent twice it leaves the same teams. */
export async function setTeamPeople(
  deps: ChallengesDeps,
  staffId: string,
  gymId: string,
  challengeId: string,
  body: SetChallengeTeamPeopleRequest,
  limit: Limit,
): Promise<{ saved: number } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const at = deps.now();
  // The last team sent for a person is theirs.
  const wanted = new Map(body.people.map((person) => [person.userId, person.teamId]));
  await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const row = await repo.lockChallenge(tx, gymId, challengeId);
    const today = await gymToday(tx, gymId, at);
    if (row === null || today === null) throw challengeNotFound();
    if (row.teams === "none") throw new OrgsError(409, "challenge_no_teams", GYM_CHALLENGE_WORDS.teams_none);
    if (row.cancelled) throw new OrgsError(409, "challenge_cancelled", GYM_CHALLENGE_WORDS.cancelled);
    if (!challengeTakesTeams(row, today)) throw new OrgsError(409, "challenge_ended", GYM_CHALLENGE_WORDS.team_ended);
    const teams = new Set(((await repo.teamsOf(tx, gymId, [challengeId])).get(challengeId) ?? []).map((team) => team.id));
    for (const teamId of wanted.values()) {
      if (teamId !== null && !teams.has(teamId)) throw new OrgsError(409, "challenge_team_gone", GYM_CHALLENGE_WORDS.team_gone);
    }
    const inIt = await repo.inChallenge(tx, gymId, challengeId, row.who === "joined", [...wanted.keys()]);
    for (const userId of wanted.keys()) {
      if (!inIt.has(userId)) throw new OrgsError(409, "challenge_person_not_in", GYM_CHALLENGE_WORDS.team_person);
    }
    const kept: { userId: string; teamId: string }[] = [];
    const out: string[] = [];
    for (const [userId, teamId] of wanted) {
      if (teamId === null) out.push(userId);
      else kept.push({ userId, teamId });
    }
    await repo.putTeamPeople(tx, gymId, challengeId, kept, at);
    await repo.removeTeamPeople(tx, gymId, challengeId, out);
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.challenge_teams_set", targetType: "challenge", targetId: challengeId, meta: { people: String(wanted.size) } });
  });
  return { saved: wanted.size };
}
