// The gym's leaderboard (spec Part 3 §15.5; ROADMAP 19a-i). Each board ranks ONE fact the
// desk, staff or the app recorded; equal numbers share a place (1, 2, 2, 4).
import { z } from "zod";

export const LEADERBOARD_BOARDS = ["gym_days", "streak"] as const;
export type LeaderboardBoard = (typeof LEADERBOARD_BOARDS)[number];

/** The day boards' periods, in the gym's time zone. The Streak has none: it ranks now. */
export const LEADERBOARD_PERIODS = ["this_week", "last_week", "this_month", "last_month", "all_time"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

/** No board until this many people are on it. */
export const LEADERBOARD_MIN_PEOPLE = 3;
/** Members see this many rows, and their own place below them. */
export const LEADERBOARD_TOP = 100;
/** Gym days and Streak show to members only while the gym has checked somebody in this recently. */
export const LEADERBOARD_CHECKIN_DAYS = 30;

/** Why a person is not ranked. Taken out before places are given, so no gap shows them. */
export const LEADERBOARD_HIDDEN_REASONS = ["staff", "taken_off", "hide_me", "under_18", "no_name"] as const;
export type LeaderboardHiddenReason = (typeof LEADERBOARD_HIDDEN_REASONS)[number];

/** shown: the rows · too_few: fewer than three people on it · no_checkins: the gym has
 *  checked nobody in for 30 days · paused: the gym's plan has lapsed. */
export const LEADERBOARD_STATUSES = ["shown", "too_few", "no_checkins", "paused"] as const;
export type LeaderboardStatus = (typeof LEADERBOARD_STATUSES)[number];

/** One circle: a day on a week view of Gym days, or a week on the Streak (oldest first,
 *  this week last). `skipped` is a week the gym recorded nobody; `open` is this week before
 *  the person's first gym day in it. */
export const leaderboardCircleSchema = z.enum(["yes", "no", "skipped", "open"]);
export type LeaderboardCircle = z.infer<typeof leaderboardCircleSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const leaderboardQuerySchema = z
  .object({
    board: z.enum(LEADERBOARD_BOARDS),
    period: z.enum(LEADERBOARD_PERIODS).default("this_week"),
  })
  .strict();
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export const leaderboardPersonParamsSchema = z
  .object({ gymId: z.string().uuid(), userId: z.string().uuid() })
  .strict();

export const leaderboardProfileQuerySchema = z
  .object({ period: z.enum(LEADERBOARD_PERIODS).default("this_week") })
  .strict();

export const leaderboardRowSchema = z
  .object({
    userId: z.string().uuid(),
    /** First name and last initial: "Priya S." */
    name: z.string(),
    initials: z.string(),
    place: z.number().int().min(1),
    value: z.number().int().min(1),
    circles: z.array(leaderboardCircleSchema).length(7).nullable(),
    /** The viewer's own row. */
    isMe: z.boolean(),
  })
  .strict();
export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const leaderboardMeSchema = z
  .object({
    value: z.number().int().min(0),
    /** The place, or the place they would have while hidden; null at 0 or under three people. */
    place: z.number().int().min(1).nullable(),
    hidden: z.enum(LEADERBOARD_HIDDEN_REASONS).nullable(),
    /** How many more it takes to reach the next place up; null when first or not placed. */
    toNextPlace: z.number().int().min(1).nullable(),
    circles: z.array(leaderboardCircleSchema).length(7).nullable(),
  })
  .strict();
export type LeaderboardMe = z.infer<typeof leaderboardMeSchema>;

export const leaderboardResponseSchema = z
  .object({
    gymId: z.string().uuid(),
    gymName: z.string(),
    timezone: z.string(),
    board: z.enum(LEADERBOARD_BOARDS),
    period: z.enum(LEADERBOARD_PERIODS).nullable(),
    /** The board's dates in the gym's calendar; `from` is null for all time and the Streak. */
    from: day.nullable(),
    to: day,
    /** What each circle stands for: seven days (a week view) or seven Mondays (the Streak). */
    circleDays: z.array(day).length(7).nullable(),
    status: z.enum(LEADERBOARD_STATUSES),
    /** People on the board. */
    ranked: z.number().int().min(0),
    rows: z.array(leaderboardRowSchema).max(LEADERBOARD_TOP),
    me: leaderboardMeSchema,
    asOf: z.string().datetime(),
  })
  .strict();
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

/** What counted for the person's own number. */
export const leaderboardVisitSchema = z
  .object({
    at: z.string().datetime(),
    /** desk: a scan at the front desk; staff: a member of staff checked them in. */
    how: z.enum(["desk", "staff"]),
    /** The desk's or the staff member's name. */
    by: z.string().nullable(),
  })
  .strict();

export const leaderboardCountedResponseSchema = z
  .object({
    gymName: z.string(),
    timezone: z.string(),
    board: z.enum(LEADERBOARD_BOARDS),
    period: z.enum(LEADERBOARD_PERIODS).nullable(),
    from: day.nullable(),
    to: day,
    value: z.number().int().min(0),
    /** Gym days: each counted day, newest first. */
    days: z.array(z.object({ day, visits: z.array(leaderboardVisitSchema).min(1) }).strict()),
    /** Gym days: a visit in the period that did not count, with why. */
    notCounted: z.array(
      z.object({ day, at: z.string().datetime(), why: z.enum(["own_tap", "app_code"]) }).strict(),
    ),
    /** Streak: newest week first, back to the week that broke it. */
    weeks: z.array(
      z
        .object({
          weekStart: day,
          state: z.enum(["counted", "missed", "skipped", "open"]),
          gymDays: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type LeaderboardCountedResponse = z.infer<typeof leaderboardCountedResponseSchema>;

export const leaderboardProfileResponseSchema = z
  .object({
    userId: z.string().uuid(),
    name: z.string(),
    initials: z.string(),
    boards: z.array(
      z
        .object({
          board: z.enum(LEADERBOARD_BOARDS),
          period: z.enum(LEADERBOARD_PERIODS).nullable(),
          place: z.number().int().min(1).nullable(),
          value: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type LeaderboardProfileResponse = z.infer<typeof leaderboardProfileResponseSchema>;

/** Hide me, for every gym. `under18` says the person is hidden for their age until they
 *  choose Show me; switching Hide me off is that choice. */
export const leaderboardVisibilitySchema = z
  .object({
    hidden: z.boolean(),
    hideMe: z.boolean(),
    under18: z.boolean(),
  })
  .strict();
export type LeaderboardVisibility = z.infer<typeof leaderboardVisibilitySchema>;

export const setLeaderboardVisibilityRequestSchema = z.object({ hidden: z.boolean() }).strict();
