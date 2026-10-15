// A GYM'S CHALLENGES (spec Part 3 §15.6; ROADMAP 19d-i). The gym's staff set one up: a
// name, dates, what is counted, and how it is won. Its board is the leaderboard's own
// count (§15.5) over the challenge's dates and its people, so the two never disagree.
//
// A challenge's dates are days on the gym's own calendar, first and last both counted.
import { z } from "zod";
import {
  CHALLENGE_COUNTED_BY,
  CHALLENGE_COUNTED_HOW,
  CHALLENGE_ID_PATTERN,
  CHALLENGE_PRINTS,
  challengeSubject,
  kindOnTheList,
  kindPerDay,
  kindWins,
  type ChallengeCountedBy,
} from "./challengeSubjects.js";
import { classDaySchema } from "./classes.js";
import { eventNameIsSeen } from "./gymEvents.js";
import { LEADERBOARD_HIDDEN_REASONS, LEADERBOARD_STAFF_PAGE, LEADERBOARD_TOP } from "./leaderboard.js";
import { postLength } from "./postBasics.js";

/** Who is in it: every member in the app, or the people who join. */
export const GYM_CHALLENGE_WHO = ["everyone", "joined"] as const;
export type GymChallengeWho = (typeof GYM_CHALLENGE_WHO)[number];

/** Alone, or in teams: "staff" put people in them, or "members" pick their own
 *  (ROADMAP 19d-ii-a). */
export const GYM_CHALLENGE_TEAMS = ["none", "staff", "members"] as const;
export type GymChallengeTeams = (typeof GYM_CHALLENGE_TEAMS)[number];
export const GYM_CHALLENGE_TEAMS_MIN = 2;
export const GYM_CHALLENGE_TEAMS_MAX = 8;
export const GYM_CHALLENGE_TEAM_NAME_MAX = 40;
/** The teammates named on a member's card, the leading ones first; the rest are counted. */
export const GYM_CHALLENGE_TEAMMATES_SHOWN = 10;
/** How many people one save of who is in which team carries. */
export const GYM_CHALLENGE_TEAM_PEOPLE_A_SAVE = 200;

export const GYM_CHALLENGE_NAME_MAX = 80;
export const GYM_CHALLENGE_DETAILS_MAX = 500;
export const GYM_CHALLENGE_PRIZE_MAX = 120;
/** How many of the library's exercises one challenge is about (one until 19d-iii-c). */
export const GYM_CHALLENGE_EXERCISES_MAX = 1;
/** An exercise's slug, as the library keeps it. */
const EXERCISE_SLUG_PATTERN = /^[a-z][a-z0-9_]{0,59}$/u;
/** The gym's own word for what it counts: "push-ups", "kilometres". */
export const GYM_CHALLENGE_UNIT_MAX = 30;
/** The largest number staff may type for a person, and the largest target of the gym's own count. */
export const GYM_CHALLENGE_SCORE_MAX = 1_000_000;
/** How many people's numbers one save carries. */
export const GYM_CHALLENGE_SCORES_A_SAVE = 200;
/** The longest a challenge runs, first day to last, both counted. */
export const GYM_CHALLENGE_MAX_DAYS = 366;
/** How far ahead of the gym's today a challenge may start. */
export const GYM_CHALLENGE_MAX_DAYS_AHEAD = 365;
/** How far back a new challenge may start: the days since then already count. */
export const GYM_CHALLENGE_MAX_DAYS_BACK = 31;
/** The most challenges a gym keeps that have not ended. With `GYM_CHALLENGES_ENDED_SHOWN`
 *  it bounds what one read of the members' list costs (`tools/measure-challenges-cost.ts`). */
export const GYM_CHALLENGES_CURRENT_MAX = 6;
/** Members see an ended challenge's result for this many days, the newest few of them. */
export const GYM_CHALLENGE_ENDED_DAYS = 14;
export const GYM_CHALLENGES_ENDED_SHOWN = 3;
/** Members see a cancelled challenge, marked, for this many days after it was cancelled. */
export const GYM_CHALLENGE_CANCELLED_DAYS = 7;
/** The ended challenges staff are sent, newest first. */
export const GYM_CHALLENGES_PAST_SHOWN = 50;
/** The places drawn on a challenge's card: gold, silver, bronze. */
export const GYM_CHALLENGE_PODIUM = 3;

const NUL = String.fromCharCode(0);

/** Typed words, trimmed, counted by character as the screen counts them. */
const words = (max: number) =>
  z
    .string()
    .max(max * 2)
    .refine((text) => !text.includes(NUL), { message: "a character that cannot be kept" })
    .transform((text) => text.trim())
    .refine((text) => postLength(text) <= max, { message: "too many characters" });

/** A real calendar day of this century. */
const challengeDaySchema = classDaySchema.refine(
  (day) => {
    const at = new Date(`${day}T00:00:00Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === day && day >= "2000-01-01" && day <= "2099-12-31";
  },
  { message: "not a real date" },
);

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** How many days a challenge runs, first and last both counted. */
export function challengeLength(challenge: { startsOn: string; endsOn: string }): number {
  return dayNumber(challenge.endsOn) - dayNumber(challenge.startsOn) + 1;
}

export const GYM_CHALLENGE_STATES = ["coming", "running", "ended"] as const;
export type GymChallengeState = (typeof GYM_CHALLENGE_STATES)[number];

/** Where a challenge is on the gym's own calendar: its last day is still running. */
export function challengeState(challenge: { startsOn: string; endsOn: string }, today: string): GymChallengeState {
  if (today < challenge.startsOn) return "coming";
  return today > challenge.endsOn ? "ended" : "running";
}

const challengeFields = {
  name: words(GYM_CHALLENGE_NAME_MAX).refine(eventNameIsSeen, { message: "a name is needed" }),
  details: words(GYM_CHALLENGE_DETAILS_MAX),
  /** What the winner gets, in the gym's words; empty for none. */
  prize: words(GYM_CHALLENGE_PRIZE_MAX),
  /** What it is about, from the list (`challengeSubjects.ts`); "own": something the gym
   *  names and its staff count (a challenge held away from the app: Kd, RULINGS 2026-10-06). */
  subject: z.string().regex(CHALLENGE_ID_PATTERN),
  /** The number the app counts for it; null where the staff count. */
  measure: z.string().regex(CHALLENGE_ID_PATTERN).nullable(),
  countedBy: z.enum(CHALLENGE_COUNTED_BY),
  /** Where it is about an exercise, the one picked from the library, by slug; none otherwise.
   *  The server keeps only one the library offers. */
  exercises: z.array(z.string().regex(EXERCISE_SLUG_PATTERN)).max(GYM_CHALLENGE_EXERCISES_MAX).default([]),
  startsOn: challengeDaySchema,
  endsOn: challengeDaySchema,
  /** The number to reach, which everybody who reaches it wins; null: the most wins. */
  target: z.number().int().min(1).max(GYM_CHALLENGE_SCORE_MAX).nullable(),
  who: z.enum(GYM_CHALLENGE_WHO),
  /** Where the staff count: the gym's word for what is counted. Empty where the app counts. */
  unit: words(GYM_CHALLENGE_UNIT_MAX).default(""),
  /** With no target, where the way it is counted allows it: the lowest number wins (a
   *  fastest time the staff count). */
  lowestWins: z.boolean().default(false),
  teams: z.enum(GYM_CHALLENGE_TEAMS).default("none"),
  /** The teams, in the gym's order. `id` null: a new team; a team left out is removed. */
  teamList: z
    .array(
      z
        .object({
          id: z.string().uuid().nullable(),
          name: words(GYM_CHALLENGE_TEAM_NAME_MAX).refine(eventNameIsSeen, { message: "a name is needed" }),
        })
        .strict(),
    )
    .max(GYM_CHALLENGE_TEAMS_MAX)
    .default([]),
};

/** A team's name as two are compared: look-alike forms and capitals made one. */
export const teamNameKey = (name: string): string => name.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

interface Dated {
  subject: string;
  measure: string | null;
  countedBy: ChallengeCountedBy;
  exercises: readonly string[];
  who: GymChallengeWho;
  startsOn: string;
  endsOn: string;
  target: number | null;
  unit: string;
  lowestWins: boolean;
  teams: GymChallengeTeams;
  teamList: readonly { id: string | null; name: string }[];
}

const datesInOrder = (c: Dated): boolean => {
  const days = challengeLength(c);
  return days >= 1 && days <= GYM_CHALLENGE_MAX_DAYS;
};
/** What it is about is on the list, counted a way the list allows, and "everyone" only for
 *  a subject members are already told their gym sees. */
const onTheList = (c: Dated): boolean => kindOnTheList(c) && (c.who !== "everyone" || challengeSubject(c.subject)?.everyone === true);
/** One a day at most is counted, so a target above the challenge's days cannot be reached.
 *  A team's number is its people's added together, so a team's target is not bound by them. */
const targetInReach = (c: Dated): boolean =>
  c.target === null || (kindWins(c).includes("target") && (!kindPerDay(c) || c.teams !== "none" || !datesInOrder(c) || c.target <= challengeLength(c)));
/** Where the staff count it has the gym's word; where the app counts, none. */
const unitFits = (c: Dated): boolean => (c.countedBy === "staff" ? eventNameIsSeen(c.unit) : c.unit === "");
/** Lowest wins only where the way it is counted allows it, and never with a number to reach. */
const lowestFits = (c: Dated): boolean => !c.lowestWins || (kindWins(c).includes("lowest") && c.target === null);
/** One exercise for a subject the gym picks one for; none for anything else. */
const exercisesFit = (c: Dated): boolean =>
  challengeSubject(c.subject)?.pickExercise === true ? c.exercises.length === 1 : c.exercises.length === 0;
/** Alone: no team. In teams: two to eight, no two with one name, no team listed twice. */
const teamsFit = (c: Dated): boolean => {
  if (c.teams === "none") return c.teamList.length === 0;
  if (c.teamList.length < GYM_CHALLENGE_TEAMS_MIN) return false;
  const names = new Set(c.teamList.map((team) => teamNameKey(team.name)));
  const ids = c.teamList.flatMap((team) => (team.id === null ? [] : [team.id]));
  return names.size === c.teamList.length && new Set(ids).size === ids.length;
};

export const addGymChallengeRequestSchema = z
  .object({
    /** The browser's key for this one challenge: the same key again is the same challenge. */
    challengeKey: z.string().uuid(),
    ...challengeFields,
  })
  .strict()
  .refine(onTheList, { message: "not something a challenge can be about, counted this way", path: ["subject"] })
  .refine(datesInOrder, { message: "the last day must not be before the first", path: ["endsOn"] })
  .refine(targetInReach, { message: "the target is more than the challenge's days", path: ["target"] })
  .refine(unitFits, { message: "say what is counted", path: ["unit"] })
  .refine(lowestFits, { message: "lowest wins is for a count the staff make, with no target", path: ["lowestWins"] })
  .refine(teamsFit, { message: "two to eight teams, each with its own name", path: ["teamList"] })
  .refine(exercisesFit, { message: "one exercise from the library for a challenge about an exercise, none otherwise", path: ["exercises"] });
export type AddGymChallengeRequest = z.infer<typeof addGymChallengeRequestSchema>;

export const changeGymChallengeRequestSchema = z
  .object(challengeFields)
  .strict()
  .refine(onTheList, { message: "not something a challenge can be about, counted this way", path: ["subject"] })
  .refine(datesInOrder, { message: "the last day must not be before the first", path: ["endsOn"] })
  .refine(targetInReach, { message: "the target is more than the challenge's days", path: ["target"] })
  .refine(unitFits, { message: "say what is counted", path: ["unit"] })
  .refine(lowestFits, { message: "lowest wins is for a count the staff make, with no target", path: ["lowestWins"] })
  .refine(teamsFit, { message: "two to eight teams, each with its own name", path: ["teamList"] })
  .refine(exercisesFit, { message: "one exercise from the library for a challenge about an exercise, none otherwise", path: ["exercises"] });
export type ChangeGymChallengeRequest = z.infer<typeof changeGymChallengeRequestSchema>;

export const cancelGymChallengeRequestSchema = z.object({ cancelled: z.boolean() }).strict();

export const gymChallengeParamsSchema = z.object({ gymId: z.string().uuid(), challengeId: z.string().uuid() }).strict();

/** Staff type people's numbers for a challenge of the gym's own count. A person's number
 *  null: it is taken off. */
export const setChallengeScoresRequestSchema = z
  .object({
    scores: z
      .array(z.object({ userId: z.string().uuid(), value: z.number().int().min(0).max(GYM_CHALLENGE_SCORE_MAX).nullable() }).strict())
      .min(1)
      .max(GYM_CHALLENGE_SCORES_A_SAVE),
  })
  .strict();
export type SetChallengeScoresRequest = z.infer<typeof setChallengeScoresRequestSchema>;
export const challengeScoresResponseSchema = z.object({ saved: z.number().int().min(0) }).strict();

/** Staff put people in a team, move them, or take them out of every team (`teamId` null). */
export const setChallengeTeamPeopleRequestSchema = z
  .object({
    people: z
      .array(z.object({ userId: z.string().uuid(), teamId: z.string().uuid().nullable() }).strict())
      .min(1)
      .max(GYM_CHALLENGE_TEAM_PEOPLE_A_SAVE),
  })
  .strict();
export type SetChallengeTeamPeopleRequest = z.infer<typeof setChallengeTeamPeopleRequestSchema>;
export const challengeTeamPeopleResponseSchema = z.object({ saved: z.number().int().min(0) }).strict();

/** A member picks their team. */
export const pickChallengeTeamRequestSchema = z.object({ teamId: z.string().uuid() }).strict();

export const staffChallengeBoardQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }).strict();

// ── WHAT MAY BE SAVED ──
//
// Once a challenge has started, people are already being counted in it: what is counted,
// its first day, who is in it and its target stay as they were. Its name, words, prize
// and last day can still change. Alone or in teams, and the teams, stay too: who is in
// which team is staff's to change on the board.

export const GYM_CHALLENGE_SAVE_PROBLEMS = ["ended", "starts_too_early", "starts_too_far", "ends_before_today", "started_locked"] as const;
export type GymChallengeSaveProblem = (typeof GYM_CHALLENGE_SAVE_PROBLEMS)[number];

export interface ChallengeRules {
  subject: string;
  measure: string | null;
  countedBy: ChallengeCountedBy;
  startsOn: string;
  endsOn: string;
  target: number | null;
  who: GymChallengeWho;
  lowestWins: boolean;
  teams: GymChallengeTeams;
  /** A kept team has its id; a new one null. */
  teamList: readonly { id: string | null; name: string }[];
  /** The library's exercises it is about, by slug. */
  exercises: readonly string[];
}

const sameTeams = (a: ChallengeRules, b: ChallengeRules): boolean =>
  a.teams === b.teams && a.teamList.length === b.teamList.length && a.teamList.every((team, i) => {
    const other = b.teamList[i];
    return other !== undefined && team.id !== null && team.id === other.id && team.name === other.name;
  });

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

const dayAfter = (day: string, days: number): string => new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);

/** Why a challenge cannot be saved as sent, or null. `before`: the challenge as it is
 *  kept, null for a new one. `today`: the gym's own date. */
export function challengeSaveProblem(input: { today: string; before: ChallengeRules | null; next: ChallengeRules }): GymChallengeSaveProblem | null {
  const { today, before, next } = input;
  if (before !== null && challengeState(before, today) === "ended") return "ended";
  if (before !== null && challengeState(before, today) === "running") {
    const same = before.subject === next.subject && before.measure === next.measure && before.countedBy === next.countedBy && sameList(before.exercises, next.exercises) && before.startsOn === next.startsOn && before.who === next.who && before.target === next.target && before.lowestWins === next.lowestWins && sameTeams(before, next);
    if (!same) return "started_locked";
  } else {
    if (next.startsOn < dayAfter(today, -GYM_CHALLENGE_MAX_DAYS_BACK)) return "starts_too_early";
    if (next.startsOn > dayAfter(today, GYM_CHALLENGE_MAX_DAYS_AHEAD)) return "starts_too_far";
  }
  if (next.endsOn < today) return "ends_before_today";
  return null;
}

/** Whether staff may type numbers for a challenge they count on `today`: from
 *  its first day until members stop seeing its result (`GYM_CHALLENGE_ENDED_DAYS` after its
 *  last day), and never for a cancelled one. */
export function challengeTakesNumbers(c: { countedBy: ChallengeCountedBy; startsOn: string; endsOn: string; cancelled: boolean }, today: string): boolean {
  return c.countedBy === "staff" && !c.cancelled && today >= c.startsOn && today <= dayAfter(c.endsOn, GYM_CHALLENGE_ENDED_DAYS);
}

/** What a member can do about a challenge. Joining stays open until its last day ends:
 *  what is counted was checked at the time, so a late joiner's days since the start count. */
export function challengeCan(c: {
  who: GymChallengeWho;
  cancelled: boolean;
  state: GymChallengeState;
  joined: boolean;
  teams: GymChallengeTeams;
  /** They are in one of its teams, whether they picked it or staff put them there. */
  hasTeam: boolean;
}): { join: boolean; leave: boolean; pick: boolean } {
  const open = !c.cancelled && c.state !== "ended";
  // Their team is theirs to change until the first day; a first pick stays open after it.
  const pick = open && c.teams === "members" && (!c.hasTeam || c.state === "coming");
  // Where members pick, picking a team is how a person joins.
  const join = open && c.who === "joined" && !c.joined && !(c.teams === "members" && !c.hasTeam);
  return { join, leave: open && c.who === "joined" && c.joined, pick };
}

/** Whether staff may put people in teams on `today`: until the challenge's last day ends. */
export function challengeTakesTeams(c: { teams: GymChallengeTeams; endsOn: string; cancelled: boolean }, today: string): boolean {
  return c.teams !== "none" && !c.cancelled && today <= c.endsOn;
}

export interface TeamTotal {
  id: string;
  /** Its people's numbers added together; 0 with none. */
  value: number;
}

/** Each team's place: the highest number first (the lowest where the lowest wins), equal
 *  numbers sharing a place, and a team with no number in no place. */
export function placeTeams(teams: readonly TeamTotal[], lowestWins: boolean): Map<string, number | null> {
  const ahead = (a: number, b: number): boolean => (lowestWins ? a < b : a > b);
  const places = new Map<string, number | null>();
  for (const team of teams) {
    places.set(team.id, team.value <= 0 ? null : 1 + teams.filter((other) => other.value > 0 && ahead(other.value, team.value)).length);
  }
  return places;
}

// ── WHAT IS SENT ──

/** The words a challenge is sent with (`challengeWords`): a screen prints them and never
 *  looks its subject up, so a subject it has never heard of still reads right. */
export const challengeWordsSchema = z
  .object({
    about: z.string(),
    one: z.string(),
    many: z.string(),
    print: z.enum(CHALLENGE_PRINTS),
    how: z.enum(CHALLENGE_COUNTED_HOW),
    howLine: z.string(),
    explain: z.string(),
    perDay: z.boolean(),
  })
  .strict();

const challengeSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    details: z.string(),
    prize: z.string(),
    /** A subject this screen has never heard of is still sent: `words` say it. */
    subject: z.string(),
    measure: z.string().nullable(),
    countedBy: z.enum(CHALLENGE_COUNTED_BY),
    /** The library's exercises it is about, by slug; none for anything else. */
    exercises: z.array(z.string()),
    words: challengeWordsSchema,
    startsOn: classDaySchema,
    endsOn: classDaySchema,
    target: z.number().int().positive().nullable(),
    who: z.enum(GYM_CHALLENGE_WHO),
    /** The gym's word for what its staff count; empty where the app counts. */
    unit: z.string(),
    lowestWins: z.boolean(),
    teams: z.enum(GYM_CHALLENGE_TEAMS),
    cancelled: z.boolean(),
    /** By the gym's own date when it was read. */
    state: z.enum(GYM_CHALLENGE_STATES),
  })
  .strict();
export type GymChallenge = z.infer<typeof challengeSchema>;

/** shown: the places · too_few: fewer than three people have a number in it ·
 *  not_started: its first day has not come. */
export const GYM_CHALLENGE_BOARD_STATUSES = ["shown", "too_few", "not_started"] as const;
export type GymChallengeBoardStatus = (typeof GYM_CHALLENGE_BOARD_STATUSES)[number];

export const gymChallengeRowSchema = z
  .object({
    userId: z.string().uuid(),
    /** First name and last initial: "Priya S." */
    name: z.string(),
    initials: z.string(),
    place: z.number().int().min(1),
    value: z.number().int().min(1),
    /** They have reached the target; false where the challenge has none. */
    reached: z.boolean(),
    isMe: z.boolean(),
  })
  .strict();
export type GymChallengeRow = z.infer<typeof gymChallengeRowSchema>;

const challengeMeSchema = z
  .object({
    value: z.number().int().min(0),
    /** Their place, or the place they would have while hidden; null at 0 or with no board. */
    place: z.number().int().min(1).nullable(),
    hidden: z.enum(LEADERBOARD_HIDDEN_REASONS).nullable(),
    toNextPlace: z.number().int().min(1).nullable(),
    nextPlace: z.number().int().min(1).nullable(),
    reached: z.boolean(),
    /** Their own counted days in the challenge, oldest first: the list their number is. */
    days: z.array(classDaySchema).max(GYM_CHALLENGE_MAX_DAYS),
  })
  .strict();
export type GymChallengeMe = z.infer<typeof challengeMeSchema>;

export const gymChallengeTeamRowSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    /** People in it that this member may count: nobody hidden, and themselves. */
    people: z.number().int().min(0),
    /** Its people's numbers added together, of the people members may see; 0 while the
     *  board is not shown. */
    value: z.number().int().min(0),
    place: z.number().int().min(1).nullable(),
    /** The team has reached the target; false where the challenge has none. */
    reached: z.boolean(),
    /** Where the lowest wins: people in it members may see who have no number yet. A team
     *  has a place only at 0, or leaving somebody out would win. Always 0 otherwise. */
    waiting: z.number().int().min(0),
    isMine: z.boolean(),
  })
  .strict();
export type GymChallengeTeamRow = z.infer<typeof gymChallengeTeamRowSchema>;

/** The teams of a challenge as one member is sent them. */
const memberTeamBoardSchema = z
  .object({
    /** As the people's board: no numbers while fewer than three people have one. */
    status: z.enum(GYM_CHALLENGE_BOARD_STATUSES),
    rows: z.array(gymChallengeTeamRowSchema).max(GYM_CHALLENGE_TEAMS_MAX),
    /** Their own team: themselves, and the leading teammates members may see who have a number. */
    mine: z
      .object({
        teamId: z.string().uuid(),
        people: z
          .array(z.object({ userId: z.string().uuid(), name: z.string(), initials: z.string(), value: z.number().int().min(0), isMe: z.boolean() }).strict())
          .max(GYM_CHALLENGE_TEAMMATES_SHOWN + 1),
        /** Teammates with a number who are not listed. */
        more: z.number().int().min(0),
        /** Their own number is added to the team's; false while they are hidden from boards. */
        counted: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type MemberTeamBoard = z.infer<typeof memberTeamBoardSchema>;

/** A challenge as one member is sent it. */
export const memberGymChallengeSchema = challengeSchema
  .extend({
    /** They joined it. Always false for everyone's challenge. */
    joined: z.boolean(),
    can: z.object({ join: z.boolean(), leave: z.boolean(), pick: z.boolean() }).strict(),
    /** Null for a challenge people are in alone. */
    teamBoard: memberTeamBoardSchema.nullable(),
    /** People who have joined, as members may count them; null for everyone's challenge. */
    joinedCount: z.number().int().min(0).nullable(),
    board: z
      .object({
        status: z.enum(GYM_CHALLENGE_BOARD_STATUSES),
        /** People on the board. */
        ranked: z.number().int().min(0),
        top: z.array(gymChallengeRowSchema).max(GYM_CHALLENGE_PODIUM),
        /** People sharing first place; 0 with no board. */
        leaders: z.number().int().min(0),
        /** People who have reached the target; null with no target or no board. */
        reached: z.number().int().min(0).nullable(),
      })
      .strict(),
    /** Their own number; null while they are not in it. */
    me: challengeMeSchema.nullable(),
  })
  .strict();
export type MemberGymChallenge = z.infer<typeof memberGymChallengeSchema>;

/** The gym's challenges for a live app member of it: running ones first (the soonest to
 *  end first), then the coming, then the ones that ended in the last fortnight. */
export const gymChallengesResponseSchema = z
  .object({
    gymId: z.string().uuid(),
    gymName: z.string(),
    timezone: z.string(),
    /** Today on the gym's calendar. */
    today: classDaySchema,
    /** "paused": the gym is not on a plan, and its challenges are not shown. */
    status: z.enum(["shown", "paused"]),
    /** The gym checked somebody in at the front desk in the last 30 days: gym days are
     *  being counted. */
    checkingIn: z.boolean(),
    challenges: z.array(memberGymChallengeSchema).max(GYM_CHALLENGES_CURRENT_MAX + GYM_CHALLENGES_ENDED_SHOWN),
    asOf: z.string().datetime(),
  })
  .strict();
export type GymChallengesResponse = z.infer<typeof gymChallengesResponseSchema>;

export const memberGymChallengeResponseSchema = z.object({ challenge: memberGymChallengeSchema }).strict();
export type MemberGymChallengeResponse = z.infer<typeof memberGymChallengeResponseSchema>;

/** A challenge's whole board for a member: the first hundred, and their own line. */
export const gymChallengeBoardResponseSchema = z
  .object({
    challengeId: z.string().uuid(),
    status: z.enum(GYM_CHALLENGE_BOARD_STATUSES),
    ranked: z.number().int().min(0),
    rows: z.array(gymChallengeRowSchema).max(LEADERBOARD_TOP),
    me: challengeMeSchema.nullable(),
    asOf: z.string().datetime(),
  })
  .strict();
export type GymChallengeBoardResponse = z.infer<typeof gymChallengeBoardResponseSchema>;

// ── STAFF HOLDING `leaderboard.manage` ──

/** A challenge as staff are sent it. */
export const staffGymChallengeSchema = challengeSchema
  .extend({
    /** Everyone who has joined and is in the app here now; null for everyone's challenge. */
    joinedCount: z.number().int().min(0).nullable(),
    /** The first three as MEMBERS see them placed, by full name; empty while members see
     *  no places, and on a list that does not carry them (an ended challenge's). */
    top: z
      .array(z.object({ userId: z.string().uuid(), name: z.string(), initials: z.string(), place: z.number().int().min(1), value: z.number().int().min(1) }).strict())
      .max(GYM_CHALLENGE_PODIUM),
    /** People with a number in it, the hidden included; null where it was not counted. */
    withNumber: z.number().int().min(0).nullable(),
    /** Its teams in the gym's order; empty for a challenge people are in alone. */
    teamList: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            name: z.string(),
            /** Everyone in it who is in the challenge now, the hidden included. */
            people: z.number().int().min(0),
            /** Its number and place as MEMBERS see them; null where they were not counted
             *  or members see none. */
            value: z.number().int().min(0).nullable(),
            place: z.number().int().min(1).nullable(),
          })
          .strict(),
      )
      .max(GYM_CHALLENGE_TEAMS_MAX),
    /** Its result's post on Updates, made once when it ends; null while there is none. A
     *  post staff removed stays removed. `hidden`: five members reported it, so members are
     *  not sent it until staff keep or remove it. */
    resultPost: z.object({ postedAt: z.string().datetime(), removed: z.boolean(), hidden: z.boolean() }).strict().nullable(),
  })
  .strict();
export type StaffGymChallenge = z.infer<typeof staffGymChallengeSchema>;

export const staffGymChallengesResponseSchema = z
  .object({
    gymId: z.string().uuid(),
    gymName: z.string(),
    timezone: z.string(),
    today: classDaySchema,
    /** The gym checked somebody in at the front desk in the last 30 days. */
    checkingIn: z.boolean(),
    /** Members in the app here now: who "everyone" is. */
    inApp: z.number().int().min(0),
    /** Not ended: running first, then coming. */
    current: z.array(staffGymChallengeSchema).max(GYM_CHALLENGES_CURRENT_MAX),
    /** Ended, newest first. */
    past: z.array(staffGymChallengeSchema).max(GYM_CHALLENGES_PAST_SHOWN),
    pastTotal: z.number().int().min(0),
  })
  .strict();
export type StaffGymChallengesResponse = z.infer<typeof staffGymChallengesResponseSchema>;

export const gymChallengeResponseSchema = z.object({ challenge: staffGymChallengeSchema }).strict();
export type GymChallengeResponse = z.infer<typeof gymChallengeResponseSchema>;

export const staffGymChallengeRowSchema = z
  .object({
    userId: z.string().uuid(),
    /** The full name, or null when the person has typed none and their record has none. */
    name: z.string().nullable(),
    initials: z.string(),
    /** The place members see them in; null for anyone hidden from members, anyone at 0,
     *  and everyone while members see no board. */
    place: z.number().int().min(1).nullable(),
    /** 0: they joined and nothing has counted yet. */
    value: z.number().int().min(0),
    /** Why members do not see this person, or null when they do. */
    hidden: z.enum(LEADERBOARD_HIDDEN_REASONS).nullable(),
    reached: z.boolean(),
    /** The team they are in; null for none, and where the challenge has no teams. */
    teamId: z.string().uuid().nullable(),
  })
  .strict();
export type StaffGymChallengeRow = z.infer<typeof staffGymChallengeRowSchema>;

/** A challenge's board for staff: everyone with a number in it, and for a challenge people
 *  join, everyone who joined; the hidden with the reason. */
export const staffGymChallengeBoardResponseSchema = z
  .object({
    challengeId: z.string().uuid(),
    /** What the gym's members see of this board right now. */
    memberStatus: z.enum(GYM_CHALLENGE_BOARD_STATUSES),
    /** People members see on it. */
    ranked: z.number().int().min(0),
    /** Everyone listed, the hidden included. */
    total: z.number().int().min(0),
    /** How many of the people listed members do not see, whatever their number. */
    hidden: z.number().int().min(0),
    /** Everyone listed who has reached the target; null with no target. */
    reached: z.number().int().min(0).nullable(),
    page: z.number().int().min(1),
    pages: z.number().int().min(1),
    rows: z.array(staffGymChallengeRowSchema).max(LEADERBOARD_STAFF_PAGE),
    /** Each team's number and place as MEMBERS see them now, for a challenge in teams: the
     *  one read that carries an ended challenge's result. Empty where people are in it alone;
     *  null number and place while members see none. */
    teams: z
      .array(z.object({ id: z.string().uuid(), value: z.number().int().min(0).nullable(), place: z.number().int().min(1).nullable() }).strict())
      .max(GYM_CHALLENGE_TEAMS_MAX),
    asOf: z.string().datetime(),
  })
  .strict();
export type StaffGymChallengeBoardResponse = z.infer<typeof staffGymChallengeBoardResponseSchema>;

/** What a person reads when a challenge cannot be made, changed, joined or found. */
export const GYM_CHALLENGE_WORDS = {
  not_found: "This challenge isn't here any more.",
  ended: "This challenge has ended, so it can't be changed.",
  starts_too_early: `A new challenge can start up to ${String(GYM_CHALLENGE_MAX_DAYS_BACK)} days back. Choose a later first day.`,
  starts_too_far: "A challenge can start up to a year from today. Choose an earlier first day.",
  ends_before_today: "The last day has already passed. Choose today or a later day.",
  started_locked: "This challenge has started, so what it counts, its first day, who is in it, its target and its teams can't change now. Its name, details, prize and last day still can.",
  full: `You have ${String(GYM_CHALLENGES_CURRENT_MAX)} challenges running or coming up, which is the most allowed. Wait for one to end, then add this.`,
  cancelled: "This challenge has been cancelled.",
  join_ended: "This challenge has ended.",
  join_everyone: "Everyone is already in this challenge.",
  scores_not_own: "This challenge is counted by the app, so numbers can't be typed for it.",
  scores_not_started: "This challenge hasn't started yet. Numbers can be typed from its first day.",
  scores_person: "One of these people isn't in this challenge any more. Load the list again.",
  teams_none: "This is an individual challenge, so it has no teams.",
  teams_staff: "At this challenge the staff put people in teams, so a team can't be picked here.",
  team_gone: "That team isn't in this challenge any more. Load the page again.",
  exercise_not_offered: "That exercise isn't in the app's library any more. Pick another one.",
  pick_to_join: "Pick a team to join this challenge.",
  team_locked: "This challenge has started, so you can't change team now.",
  team_person: "One of these people isn't in this challenge any more. Load the list again.",
  team_ended: "This challenge has ended, so its teams can't be changed.",
  scores_closed: `This challenge ended more than ${String(GYM_CHALLENGE_ENDED_DAYS)} days ago, so its numbers can't be changed now.`,
} as const;

// ── WHAT THE FORM IS OFFERED (spec Part 3 §15.10.1) ──

/** What a gym's form may pick: every subject on the list with what the app can count for
 *  it, and the library's exercises, each saying whether the app can count it. Only what the
 *  app can really do is offered as counted by it. */
export const challengeSubjectsResponseSchema = z
  .object({
    subjects: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          hint: z.string(),
          pickExercise: z.boolean(),
          everyone: z.boolean(),
          staffWord: z.string(),
          /** What the app can count for it; none: only the staff can. */
          appCounts: z.array(z.object({ measure: z.string(), one: z.string(), many: z.string(), howLine: z.string() }).strict()),
        })
        .strict(),
    ),
    exercises: z.array(z.object({ slug: z.string(), name: z.string(), appCounts: z.boolean() }).strict()),
  })
  .strict();
export type ChallengeSubjectsResponse = z.infer<typeof challengeSubjectsResponseSchema>;
