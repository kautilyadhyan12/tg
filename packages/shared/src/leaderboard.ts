// The gym's leaderboard (spec Part 3 §15.5; ROADMAP 19a). Each board ranks ONE fact the
// desk, staff or the app recorded; equal numbers share a place (1, 2, 2, 4).
import { z } from "zod";

export const LEADERBOARD_BOARDS = ["gym_days", "workout_days", "streak"] as const;
export type LeaderboardBoard = (typeof LEADERBOARD_BOARDS)[number];

/** The two day boards' periods, in the gym's time zone. The Streak has none: it ranks now. */
export const LEADERBOARD_PERIODS = ["this_week", "last_week", "this_month", "last_month", "all_time"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

/** No board until this many people are on it. */
export const LEADERBOARD_MIN_PEOPLE = 3;
/** Members see this many rows, and their own place below them. */
export const LEADERBOARD_TOP = 100;
/** Gym days and Streak show to members only while the gym has checked somebody in this recently. */
export const LEADERBOARD_CHECKIN_DAYS = 30;
/** A workout counts when it reached the server within this many days of its start. */
export const LEADERBOARD_WORKOUT_SAVE_DAYS = 7;
/** A phone's clock may run this far ahead: a workout saved longer than this before its own
 *  start never counts. */
export const LEADERBOARD_WORKOUT_EARLY_MINUTES = 60;

/** Why a workout is not a workout day. saved_early: it reached the server more than an
 *  hour before its own start, and never counts · future: its start is still ahead ·
 *  before_joining: it started before the person joined this gym · no_sets: no set with a
 *  rep or a hold was saved · saved_late: it reached the server more than seven days after
 *  it started. */
export const LEADERBOARD_WORKOUT_NOT_COUNTED = ["saved_early", "future", "before_joining", "no_sets", "saved_late"] as const;
export type LeaderboardWorkoutNotCounted = (typeof LEADERBOARD_WORKOUT_NOT_COUNTED)[number];

/** Why a person is not ranked. Taken out before places are given, so no gap shows them. */
export const LEADERBOARD_HIDDEN_REASONS = ["staff", "taken_off", "hide_me", "under_18", "no_name"] as const;
export type LeaderboardHiddenReason = (typeof LEADERBOARD_HIDDEN_REASONS)[number];

/** shown: the rows · too_few: fewer than three people on it · no_checkins: the gym has
 *  checked nobody in for 30 days (Gym days and Streak only) · paused: the gym's plan has
 *  lapsed · switched_off: the gym switched this board off for its members. */
export const LEADERBOARD_STATUSES = ["shown", "too_few", "no_checkins", "paused", "switched_off"] as const;
export type LeaderboardStatus = (typeof LEADERBOARD_STATUSES)[number];

/** One circle: a day on a week view of a day board, or a week on the Streak (oldest first,
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
    /** That next place up, which ties make more than one above their own (4th → 2nd). */
    nextPlace: z.number().int().min(1).nullable(),
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
    /** The boards the gym has switched off for its members. */
    boardsOff: z.array(z.enum(LEADERBOARD_BOARDS)),
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

/** One counted workout, for the person's own list. */
export const leaderboardWorkoutSchema = z
  .object({
    at: z.string().datetime(),
    /** Who counted its reps: the camera, the person, or some sets each; null when the
     *  sets do not say. */
    countedBy: z.enum(["camera", "you", "both"]).nullable(),
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
    /** Workout days: each counted day, newest first. */
    workoutDays: z.array(z.object({ day, workouts: z.array(leaderboardWorkoutSchema).min(1) }).strict()),
    /** Workout days: a workout in the period that did not count, with why. A `saved_late`
     *  one reached the server more than `daysLate` whole days after its start. */
    workoutsNotCounted: z.array(
      z
        .object({
          day,
          at: z.string().datetime(),
          why: z.enum(LEADERBOARD_WORKOUT_NOT_COUNTED),
          daysLate: z.number().int().min(1).nullable(),
        })
        .strict(),
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

// ── THE BOARD IN THE CONSOLE (19a-iii) ──
// Staff holding `leaderboard.manage` see everyone, full names, the hidden with the reason.

/** Rows on one page of the staff board. */
export const LEADERBOARD_STAFF_PAGE = 100;

export const staffLeaderboardQuerySchema = z
  .object({
    board: z.enum(LEADERBOARD_BOARDS),
    period: z.enum(LEADERBOARD_PERIODS).default("this_week"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type StaffLeaderboardQuery = z.infer<typeof staffLeaderboardQuerySchema>;

export const staffLeaderboardRowSchema = z
  .object({
    userId: z.string().uuid(),
    /** The full name, or null when the person has typed none and their record has none. */
    name: z.string().nullable(),
    initials: z.string(),
    /** The place members see them in; null for anyone hidden from members. */
    place: z.number().int().min(1).nullable(),
    value: z.number().int().min(1),
    circles: z.array(leaderboardCircleSchema).length(7).nullable(),
    /** Why members do not see this person, or null when they do. */
    hidden: z.enum(LEADERBOARD_HIDDEN_REASONS).nullable(),
  })
  .strict();
export type StaffLeaderboardRow = z.infer<typeof staffLeaderboardRowSchema>;

export const staffLeaderboardResponseSchema = z
  .object({
    gymId: z.string().uuid(),
    gymName: z.string(),
    timezone: z.string(),
    board: z.enum(LEADERBOARD_BOARDS),
    period: z.enum(LEADERBOARD_PERIODS).nullable(),
    from: day.nullable(),
    to: day,
    circleDays: z.array(day).length(7).nullable(),
    /** What the gym's members see of THIS board and period right now, and so why it is not
     *  showing. */
    memberStatus: z.enum(LEADERBOARD_STATUSES),
    /** The gym's plan is live; it counted a visit in the last 30 days. With `boardsOff`,
     *  why any other board is not showing. */
    live: z.boolean(),
    checkingIn: z.boolean(),
    boardsOff: z.array(z.enum(LEADERBOARD_BOARDS)),
    /** People members see on this board. */
    ranked: z.number().int().min(0),
    /** Everyone with a number on it, the hidden included. */
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pages: z.number().int().min(1),
    rows: z.array(staffLeaderboardRowSchema).max(LEADERBOARD_STAFF_PAGE),
    /** People on the gym's list who are not in the app, so are on no board. */
    notInApp: z.number().int().min(0),
    asOf: z.string().datetime(),
  })
  .strict();
export type StaffLeaderboardResponse = z.infer<typeof staffLeaderboardResponseSchema>;

/** One person, for staff: their place on every board, hidden or not. */
export const staffLeaderboardProfileResponseSchema = z
  .object({
    userId: z.string().uuid(),
    name: z.string().nullable(),
    initials: z.string(),
    hidden: z.enum(LEADERBOARD_HIDDEN_REASONS).nullable(),
    /** Staff took them off the board; another reason may be the one shown. */
    takenOff: z.boolean(),
    isStaff: z.boolean(),
    /** Their record on the gym's list, when they have one. */
    entryId: z.string().uuid().nullable(),
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
export type StaffLeaderboardProfileResponse = z.infer<typeof staffLeaderboardProfileResponseSchema>;

/** What counted for anyone, for staff. A workout is a date and nothing else: staff never
 *  see what the workout was or when in the day it was done. */
export const staffLeaderboardCountedResponseSchema = z
  .object({
    userId: z.string().uuid(),
    gymName: z.string(),
    timezone: z.string(),
    board: z.enum(LEADERBOARD_BOARDS),
    period: z.enum(LEADERBOARD_PERIODS).nullable(),
    from: day.nullable(),
    to: day,
    value: z.number().int().min(0),
    days: z.array(z.object({ day, visits: z.array(leaderboardVisitSchema).min(1) }).strict()),
    notCounted: z.array(
      z.object({ day, at: z.string().datetime(), why: z.enum(["own_tap", "app_code"]) }).strict(),
    ),
    workoutDays: z.array(z.object({ day, workouts: z.number().int().min(1) }).strict()),
    workoutsNotCounted: z.array(
      z
        .object({ day, why: z.enum(LEADERBOARD_WORKOUT_NOT_COUNTED), daysLate: z.number().int().min(1).nullable() })
        .strict(),
    ),
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
export type StaffLeaderboardCountedResponse = z.infer<typeof staffLeaderboardCountedResponseSchema>;

export const setLeaderboardTakenOffRequestSchema = z.object({ takenOff: z.boolean() }).strict();
export const leaderboardTakenOffResponseSchema = z.object({ takenOff: z.boolean() }).strict();

/** Which boards the gym's members do NOT see. */
export const setLeaderboardBoardsRequestSchema = z
  .object({ off: z.array(z.enum(LEADERBOARD_BOARDS)).max(LEADERBOARD_BOARDS.length) })
  .strict();
export const leaderboardBoardsResponseSchema = z.object({ boardsOff: z.array(z.enum(LEADERBOARD_BOARDS)) }).strict();
