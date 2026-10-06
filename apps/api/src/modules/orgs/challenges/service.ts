// A GYM'S CHALLENGES (spec Part 3 §15.6; ROADMAP 19d-i).
//
// The worst thing this could do to a real person: show somebody who chose Hide me, or
// somebody the gym removed, to another member — in a challenge's places, in its count of
// who joined, or in its count of who reached the target. So a challenge's places come from
// the leaderboard's own function (`rankBoard`), which takes hidden people out before a
// place is given; every other number a member is sent about other people is counted from
// the people `hiddenReason` lets them see; and only a live app member of the gym now is
// ever counted at all.
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  GYM_CHALLENGES_CURRENT_MAX,
  GYM_CHALLENGES_PAST_SHOWN,
  GYM_CHALLENGE_PODIUM,
  GYM_CHALLENGE_WORDS,
  LEADERBOARD_STAFF_PAGE,
  challengeCan,
  challengeSaveProblem,
  challengeState,
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
  type LeaderboardRow,
  type MemberGymChallenge,
  type StaffGymChallenge,
  type StaffGymChallengeBoardResponse,
  type StaffGymChallengeRow,
  type StaffGymChallengesResponse,
} from "@app/shared";
import { getOrgById, insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { gymToday } from "../events/repo.js";
import { fullName, hiddenReason, rankBoard, rankStaffBoard, type BoardPerson } from "../leaderboard/rank.js";
import * as boards from "../leaderboard/repo.js";
import { lockGym } from "../memberList/repo.js";
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

interface Counted {
  /** Every live app member of the gym now. */
  facts: Map<string, boards.MemberFacts>;
  /** Each started challenge's numbers: person → counted days. */
  values: Map<string, Map<string, number>>;
  /** The asker's own counted days in each. */
  myDays: Map<string, string[]>;
  /** Who joined each challenge people join. */
  joined: Map<string, Set<string>>;
}

/** One read of everything the challenges' boards are made of: the leaderboard's own count
 *  over each challenge's dates. A cancelled challenge and one not started count nothing. */
async function countFor(deps: ChallengesDeps, read: Read, rows: readonly repo.ChallengeRow[], daysOf: string | null): Promise<Counted> {
  const counting = rows.filter((row) => !row.cancelled && row.startsOn <= read.gym.today);
  const ranges = (counts: repo.ChallengeRow["counts"]): boards.DayRange[] =>
    counting.filter((row) => row.counts === counts).map((row) => ({ id: row.id, from: row.startsOn, to: row.endsOn }));
  const input = { gymId: read.gymId, at: read.at, today: read.gym.today, daysOf };
  const [facts, pairs, gymDays, workoutDays] = await Promise.all([
    boards.allMemberFacts(deps.sql, read.gymId, read.at),
    repo.joinedPairs(deps.sql, read.gymId, rows.filter((row) => row.who === "joined").map((row) => row.id)),
    boards.gymDaysInRanges(deps.sql, { ...input, ranges: ranges("gym_days") }),
    boards.workoutDaysInRanges(deps.sql, { ...input, ranges: ranges("workout_days") }),
  ]);
  const values = new Map<string, Map<string, number>>();
  const myDays = new Map<string, string[]>();
  for (const r of [...gymDays, ...workoutDays]) {
    const of = values.get(r.rangeId) ?? new Map<string, number>();
    of.set(r.userId, r.value);
    values.set(r.rangeId, of);
    if (r.userId === daysOf) myDays.set(r.rangeId, r.days);
  }
  const joined = new Map<string, Set<string>>();
  for (const pair of pairs) {
    const of = joined.get(pair.challengeId) ?? new Set<string>();
    of.add(pair.userId);
    joined.set(pair.challengeId, of);
  }
  return { facts: new Map(facts.map((f) => [f.userId, f])), values, myDays, joined };
}

const person = (facts: boards.MemberFacts, value: number): BoardPerson => ({ ...facts, value, circles: null });

/** Who joined a challenge people join; null for everyone's. */
const joinedOf = (row: repo.ChallengeRow, counted: Counted): Set<string> | null =>
  row.who === "joined" ? (counted.joined.get(row.id) ?? new Set<string>()) : null;

/** The people in a challenge with a number in it: live app members of the gym now, and
 *  for a challenge people join, only the ones who joined. */
function peopleOf(row: repo.ChallengeRow, counted: Counted): BoardPerson[] {
  const joined = joinedOf(row, counted);
  const people: BoardPerson[] = [];
  for (const [userId, value] of counted.values.get(row.id) ?? []) {
    const facts = counted.facts.get(userId);
    if (facts === undefined || (joined !== null && !joined.has(userId))) continue;
    people.push(person(facts, value));
  }
  return people;
}

const reachedBy = (row: repo.ChallengeRow, value: number): boolean => row.target !== null && value >= row.target;

const sentRow = (row: repo.ChallengeRow, r: LeaderboardRow): GymChallengeRow => ({
  userId: r.userId,
  name: r.name,
  initials: r.initials,
  place: r.place,
  value: r.value,
  reached: reachedBy(row, r.value),
  isMe: r.isMe,
});

interface MemberView {
  challenge: MemberGymChallenge;
  /** The whole board, the first hundred: what the board's own read sends. */
  rows: GymChallengeRow[];
}

/** A challenge as one member reads it. Nothing here about other people is computed from
 *  somebody they may not see. */
function memberView(row: repo.ChallengeRow, today: string, counted: Counted, viewerId: string): MemberView {
  const base = shaped(row, today);
  const joined = joinedOf(row, counted);
  const iJoined = joined?.has(viewerId) ?? false;
  const can = challengeCan({ who: row.who, cancelled: row.cancelled, state: base.state, joined: iJoined });
  // The people who joined that this member may count: nobody hidden, and themselves.
  const joinedCount =
    joined === null
      ? null
      : [...joined].filter((userId) => {
          const facts = counted.facts.get(userId);
          return facts !== undefined && (userId === viewerId || hiddenReason(person(facts, 1)) === null);
        }).length;
  const none = { status: "not_started" as const, ranked: 0, top: [], reached: null };
  // A cancelled challenge has no board and no line of anybody's.
  if (row.cancelled) return { challenge: { ...base, joined: iJoined, can, joinedCount, board: none, me: null }, rows: [] };

  const inIt = joined === null || iJoined;
  const people = base.state === "coming" ? [] : peopleOf(row, counted);
  const viewer = counted.facts.get(viewerId);
  // In it, they have a line of their own even at nothing.
  if (inIt && viewer !== undefined && !people.some((p) => p.userId === viewerId)) people.push(person(viewer, 0));
  const board = rankBoard(people, viewerId);
  const shown = base.state !== "coming" && board.status === "shown";
  const seen = people.filter((p) => p.value > 0 && hiddenReason(p) === null);
  const rows = shown ? board.rows.map((r) => sentRow(row, r)) : [];
  const challenge: MemberGymChallenge = {
    ...base,
    joined: iJoined,
    can,
    joinedCount,
    board: {
      status: base.state === "coming" ? "not_started" : board.status,
      ranked: shown ? board.ranked : 0,
      top: rows.slice(0, GYM_CHALLENGE_PODIUM),
      reached: shown && row.target !== null ? seen.filter((p) => reachedBy(row, p.value)).length : null,
    },
    me: inIt
      ? {
          value: board.me.value,
          place: shown ? board.me.place : null,
          hidden: board.me.hidden,
          toNextPlace: shown ? board.me.toNextPlace : null,
          nextPlace: shown ? board.me.nextPlace : null,
          reached: reachedBy(row, board.me.value),
          days: counted.myDays.get(row.id) ?? [],
        }
      : null,
  };
  return { challenge, rows };
}

// ── MEMBERS ──

/** The gym and the asker, for a live app member of it; 404 for everybody else. `paused`:
 *  the gym is closed or on no plan, and its members are shown no challenge. */
async function forMember(deps: ChallengesDeps, gymId: string, userId: string): Promise<Read & { now: Date; paused: boolean }> {
  const now = deps.now();
  const [org, gym, me] = await Promise.all([
    getOrgById(deps.sql, gymId),
    boards.boardGym(deps.sql, gymId, now),
    boards.memberFacts(deps.sql, gymId, userId, now.toISOString()),
  ]);
  if (org === null || gym === null || me === null) throw notFound();
  return { gymId, gym, at: now.toISOString(), now, paused: !(org.status === "active" && gym.live) };
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
    challenges: rows.map((row) => memberView(row, read.gym.today, counted, userId).challenge),
  });
}

/** One challenge a member is sent, read fresh; 404 for one they are not. */
async function oneForMember(deps: ChallengesDeps, read: Read & { now: Date; paused: boolean }, challengeId: string, userId: string): Promise<MemberView> {
  if (read.paused) throw challengeNotFound();
  const row = await repo.memberChallenge(deps.sql, read.gymId, challengeId, read.gym.today, read.now);
  if (row === null) throw challengeNotFound();
  return memberView(row, read.gym.today, await countFor(deps, read, [row], userId), userId);
}

/** A challenge's whole board: the first hundred, and the asker's own line. */
export async function getBoard(deps: ChallengesDeps, userId: string, gymId: string, challengeId: string, limit: Limit): Promise<GymChallengeBoardResponse | null> {
  const read = await forMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const view = await oneForMember(deps, read, challengeId, userId);
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
  const view = memberView(row, read.gym.today, await countFor(deps, read, [row], userId), userId);
  return memberGymChallengeSchema.parse(view.challenge);
}

// ── STAFF HOLDING `leaderboard.manage` ──

async function staffChallenge(deps: ChallengesDeps, gymId: string, challengeId: string): Promise<StaffGymChallenge> {
  const [row, today, counts] = await Promise.all([
    repo.challengeById(deps.sql, gymId, challengeId),
    gymToday(deps.sql, gymId, deps.now()),
    repo.joinedCounts(deps.sql, gymId, [challengeId]),
  ]);
  if (row === null || today === null) throw challengeNotFound();
  return staffGymChallengeSchema.parse({ ...shaped(row, today), joinedCount: row.who === "joined" ? (counts.get(row.id) ?? 0) : null });
}

/** The gym's challenges, current and ended, for its staff holding the tick. */
export async function getStaffChallenges(deps: ChallengesDeps, staffId: string, gymId: string, limit: Limit): Promise<StaffGymChallengesResponse | null> {
  const { org } = await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const gym = await boards.boardGym(deps.sql, gymId, deps.now());
  if (gym === null) throw notFound();
  const [current, past, pastTotal, inApp] = await Promise.all([
    repo.currentChallenges(deps.sql, gymId, gym.today),
    repo.pastChallenges(deps.sql, gymId, gym.today, GYM_CHALLENGES_PAST_SHOWN),
    repo.countPast(deps.sql, gymId, gym.today),
    repo.inAppCount(deps.sql, gymId),
  ]);
  const counts = await repo.joinedCounts(deps.sql, gymId, [...current, ...past].filter((row) => row.who === "joined").map((row) => row.id));
  const sent = (row: repo.ChallengeRow): StaffGymChallenge => ({ ...shaped(row, gym.today), joinedCount: row.who === "joined" ? (counts.get(row.id) ?? 0) : null });
  return staffGymChallengesResponseSchema.parse({
    gymId,
    gymName: org.name,
    timezone: org.timezone,
    today: gym.today,
    checkingIn: gym.checkingIn,
    inApp,
    current: inOrder(current, gym.today).map(sent),
    past: past.map(sent),
    pastTotal,
  });
}

const byName = (a: string | null, b: string | null): number => Number(a === null) - Number(b === null) || ((a ?? "") < (b ?? "") ? -1 : (a ?? "") > (b ?? "") ? 1 : 0);

/** A challenge's board for staff: everyone with a number, the hidden with the reason; and
 *  for a challenge people join, everyone who joined, at 0 too. */
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
  const people = started ? peopleOf(row, counted) : [];
  const staff = rankStaffBoard(people);
  // A place is the place MEMBERS see: while they see no board, nobody has one.
  const shown = started && staff.status === "shown";
  const numbered: StaffGymChallengeRow[] = staff.rows.map((r) => ({
    userId: r.userId,
    name: r.name,
    initials: r.initials,
    place: shown ? r.place : null,
    value: r.value,
    hidden: r.hidden,
    reached: reachedBy(row, r.value),
  }));
  const has = new Set(numbered.map((r) => r.userId));
  const waiting: StaffGymChallengeRow[] = [...(joinedOf(row, counted) ?? [])]
    .flatMap((userId) => {
      const facts = counted.facts.get(userId);
      if (facts === undefined || has.has(userId)) return [];
      const named = fullName(facts);
      return [{ userId, name: named.name, initials: named.initials, place: null, value: 0, hidden: hiddenReason(person(facts, 0)), reached: false }];
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
    reached: row.target === null ? null : numbered.filter((r) => r.reached).length,
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
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.challenge_added", targetType: "challenge", targetId: id, meta: { counts: body.counts, who: body.who } });
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
    const problem = challengeSaveProblem({ today, before, next: body });
    if (problem !== null) throw refused(problem);
    await repo.updateChallenge(tx, gymId, challengeId, body, at);
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
