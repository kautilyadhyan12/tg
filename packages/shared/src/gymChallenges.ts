// A GYM'S CHALLENGES (spec Part 3 §15.6; ROADMAP 19d-i). The gym's staff set one up: a
// name, dates, what is counted, and how it is won. Its board is the leaderboard's own
// count (§15.5) over the challenge's dates and its people, so the two never disagree.
//
// A challenge's dates are days on the gym's own calendar, first and last both counted.
import { z } from "zod";
import { classDaySchema } from "./classes.js";
import { eventNameIsSeen } from "./gymEvents.js";
import { LEADERBOARD_HIDDEN_REASONS, LEADERBOARD_STAFF_PAGE, LEADERBOARD_TOP } from "./leaderboard.js";
import { postLength } from "./posts.js";

/** What a challenge counts: one of the leaderboard's checked facts, one a day at most; or
 *  "own", something the gym names and counts itself, whose numbers its staff type in (a
 *  challenge held away from the app: Kd, RULINGS 2026-10-06). */
export const GYM_CHALLENGE_COUNTS = ["gym_days", "workout_days", "own"] as const;
export type GymChallengeCounts = (typeof GYM_CHALLENGE_COUNTS)[number];

/** Who is in it: every member in the app, or the people who join. */
export const GYM_CHALLENGE_WHO = ["everyone", "joined"] as const;
export type GymChallengeWho = (typeof GYM_CHALLENGE_WHO)[number];

export const GYM_CHALLENGE_NAME_MAX = 80;
export const GYM_CHALLENGE_DETAILS_MAX = 500;
export const GYM_CHALLENGE_PRIZE_MAX = 120;
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
  counts: z.enum(GYM_CHALLENGE_COUNTS),
  startsOn: challengeDaySchema,
  endsOn: challengeDaySchema,
  /** The number to reach, which everybody who reaches it wins; null: the most wins. */
  target: z.number().int().min(1).max(GYM_CHALLENGE_SCORE_MAX).nullable(),
  who: z.enum(GYM_CHALLENGE_WHO),
  /** The gym's own count only: its word for what is counted. Empty for the app's counts. */
  unit: words(GYM_CHALLENGE_UNIT_MAX).default(""),
  /** The gym's own count only, with no target: the lowest number wins (a fastest time). */
  lowestWins: z.boolean().default(false),
};

interface Dated {
  counts: GymChallengeCounts;
  startsOn: string;
  endsOn: string;
  target: number | null;
  unit: string;
  lowestWins: boolean;
}

const datesInOrder = (c: Dated): boolean => {
  const days = challengeLength(c);
  return days >= 1 && days <= GYM_CHALLENGE_MAX_DAYS;
};
/** One a day at most is counted, so a target above the challenge's days cannot be reached. */
const targetInReach = (c: Dated): boolean => c.counts === "own" || c.target === null || !datesInOrder(c) || c.target <= challengeLength(c);
/** The gym's own count has its word; the app's counts have none. */
const unitFits = (c: Dated): boolean => (c.counts === "own" ? eventNameIsSeen(c.unit) : c.unit === "");
/** Lowest wins only for the gym's own count, and never with a number to reach. */
const lowestFits = (c: Dated): boolean => !c.lowestWins || (c.counts === "own" && c.target === null);

export const addGymChallengeRequestSchema = z
  .object({
    /** The browser's key for this one challenge: the same key again is the same challenge. */
    challengeKey: z.string().uuid(),
    ...challengeFields,
  })
  .strict()
  .refine(datesInOrder, { message: "the last day must not be before the first", path: ["endsOn"] })
  .refine(targetInReach, { message: "the target is more than the challenge's days", path: ["target"] })
  .refine(unitFits, { message: "say what is counted", path: ["unit"] })
  .refine(lowestFits, { message: "lowest wins is for the gym's own count with no target", path: ["lowestWins"] });
export type AddGymChallengeRequest = z.infer<typeof addGymChallengeRequestSchema>;

export const changeGymChallengeRequestSchema = z
  .object(challengeFields)
  .strict()
  .refine(datesInOrder, { message: "the last day must not be before the first", path: ["endsOn"] })
  .refine(targetInReach, { message: "the target is more than the challenge's days", path: ["target"] })
  .refine(unitFits, { message: "say what is counted", path: ["unit"] })
  .refine(lowestFits, { message: "lowest wins is for the gym's own count with no target", path: ["lowestWins"] });
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

export const staffChallengeBoardQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1) }).strict();

// ── WHAT MAY BE SAVED ──
//
// Once a challenge has started, people are already being counted in it: what is counted,
// its first day, who is in it and its target stay as they were. Its name, words, prize
// and last day can still change.

export const GYM_CHALLENGE_SAVE_PROBLEMS = ["ended", "starts_too_early", "starts_too_far", "ends_before_today", "started_locked"] as const;
export type GymChallengeSaveProblem = (typeof GYM_CHALLENGE_SAVE_PROBLEMS)[number];

export interface ChallengeRules {
  counts: GymChallengeCounts;
  startsOn: string;
  endsOn: string;
  target: number | null;
  who: GymChallengeWho;
  lowestWins: boolean;
}

const dayAfter = (day: string, days: number): string => new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);

/** Why a challenge cannot be saved as sent, or null. `before`: the challenge as it is
 *  kept, null for a new one. `today`: the gym's own date. */
export function challengeSaveProblem(input: { today: string; before: ChallengeRules | null; next: ChallengeRules }): GymChallengeSaveProblem | null {
  const { today, before, next } = input;
  if (before !== null && challengeState(before, today) === "ended") return "ended";
  if (before !== null && challengeState(before, today) === "running") {
    const same = before.counts === next.counts && before.startsOn === next.startsOn && before.who === next.who && before.target === next.target && before.lowestWins === next.lowestWins;
    if (!same) return "started_locked";
  } else {
    if (next.startsOn < dayAfter(today, -GYM_CHALLENGE_MAX_DAYS_BACK)) return "starts_too_early";
    if (next.startsOn > dayAfter(today, GYM_CHALLENGE_MAX_DAYS_AHEAD)) return "starts_too_far";
  }
  if (next.endsOn < today) return "ends_before_today";
  return null;
}

/** What a member can do about a challenge. Joining stays open until its last day ends:
 *  what is counted was checked at the time, so a late joiner's days since the start count. */
export function challengeCan(c: { who: GymChallengeWho; cancelled: boolean; state: GymChallengeState; joined: boolean }): { join: boolean; leave: boolean } {
  const open = c.who === "joined" && !c.cancelled && c.state !== "ended";
  return { join: open && !c.joined, leave: open && c.joined };
}

// ── WHAT IS SENT ──

const challengeSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    details: z.string(),
    prize: z.string(),
    counts: z.enum(GYM_CHALLENGE_COUNTS),
    startsOn: classDaySchema,
    endsOn: classDaySchema,
    target: z.number().int().positive().nullable(),
    who: z.enum(GYM_CHALLENGE_WHO),
    /** The gym's word for what it counts; empty for the app's counts. */
    unit: z.string(),
    lowestWins: z.boolean(),
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

/** A challenge as one member is sent it. */
export const memberGymChallengeSchema = challengeSchema
  .extend({
    /** They joined it. Always false for everyone's challenge. */
    joined: z.boolean(),
    can: z.object({ join: z.boolean(), leave: z.boolean() }).strict(),
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
    /** Everyone listed who has reached the target; null with no target. */
    reached: z.number().int().min(0).nullable(),
    page: z.number().int().min(1),
    pages: z.number().int().min(1),
    rows: z.array(staffGymChallengeRowSchema).max(LEADERBOARD_STAFF_PAGE),
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
  started_locked: "This challenge has started, so what it counts, its first day, who is in it and its target can't change now. Its name, details, prize and last day still can.",
  full: `You have ${String(GYM_CHALLENGES_CURRENT_MAX)} challenges running or coming up, which is the most allowed. Wait for one to end, then add this.`,
  cancelled: "This challenge has been cancelled.",
  join_ended: "This challenge has ended.",
  join_everyone: "Everyone is already in this challenge.",
  scores_not_own: "This challenge is counted by the app, so numbers can't be typed for it.",
  scores_not_started: "This challenge hasn't started yet. Numbers can be typed from its first day.",
  scores_person: "One of these people isn't in this challenge any more. Load the list again.",
} as const;
