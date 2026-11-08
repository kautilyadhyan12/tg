// The admin page (ROADMAP Stage 2 item 14a-i; Kd, 2026-11-07 and 2026-11-08): Kd's own page, on
// the website only, listing the people who use the app and setting one person's meal scans or route
// plans a day. Only what running the app needs: never a health answer, a weight, a photo or a run.
import { z } from "zod";
import { meteredWindowSchema } from "./entitlements.js";
import { timeZoneNameSchema } from "./appMinutes.js";
import { calendarDaySchema } from "./plan.js";

/** The most Kd can set a day, either feature: a guard against a typing slip, not a plan. */
export const ADMIN_LIMIT_MAX = 100;

/** The features he sets: a meal scan (a meal photo or a pack's label) and a run's route plan. */
export const adminLimitFeatureSchema = z.enum(["meal_scan", "route_gen"]);
export type AdminLimitFeature = z.infer<typeof adminLimitFeatureSchema>;

/** Where the next page starts: the last row's sign-up instant in microseconds, and its id. */
export const adminPeopleCursorSchema = z.string().regex(/^\d{1,17}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const adminPeopleQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    after: adminPeopleCursorSchema.optional(),
  })
  .strict();
export type AdminPeopleQuery = z.infer<typeof adminPeopleQuerySchema>;

/** What a person gets of one feature now, and whether that is Kd's number. */
export const adminAllowanceSchema = z
  .object({ window: meteredWindowSchema, limit: z.number().int().nonnegative(), yours: z.boolean() })
  .strict();
export type AdminAllowance = z.infer<typeof adminAllowanceSchema>;

export const adminPersonSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    signedUpAt: z.string().datetime(),
    lastSeenAt: z.string().datetime().nullable(),
    /** The $10 plan, monthly or yearly, when they bought it themselves. */
    ownPlan: z.enum(["month", "year"]).nullable(),
    /** The gyms whose live plan they get, by name. */
    gyms: z.array(z.string()),
    mealScans: adminAllowanceSchema,
    routePlans: adminAllowanceSchema,
  })
  .strict();
export type AdminPerson = z.infer<typeof adminPersonSchema>;

export const adminPeopleResponseSchema = z
  .object({ people: z.array(adminPersonSchema), next: adminPeopleCursorSchema.nullable() })
  .strict();
export type AdminPeopleResponse = z.infer<typeof adminPeopleResponseSchema>;

/** Set, or with null take back, one feature's number for these people. */
export const adminSetLimitsRequestSchema = z
  .object({
    userIds: z
      .array(z.string().uuid())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, { message: "each person once" }),
    feature: adminLimitFeatureSchema,
    perDay: z.number().int().min(0).max(ADMIN_LIMIT_MAX).nullable(),
  })
  .strict();
export type AdminSetLimitsRequest = z.infer<typeof adminSetLimitsRequestSchema>;

/** What the press did: changed, already so, or not a person using the app (none, or deleted). */
export const adminSetLimitsResponseSchema = z
  .object({ changed: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(), notFound: z.number().int().nonnegative() })
  .strict();
export type AdminSetLimitsResponse = z.infer<typeof adminSetLimitsResponseSchema>;

/** The admin door (Kd, 2026-11-08): a fresh sign-in code, then his own password; open 12 hours. */
export const ADMIN_PASSWORD_MIN = 12;
export const ADMIN_DOOR_HOURS = 12;
/** How long after a sign-in its code still counts as fresh at the door. */
export const ADMIN_FRESH_MINUTES = 10;

export const adminPasswordRequestSchema = z.object({ password: z.string().min(ADMIN_PASSWORD_MIN).max(200) }).strict();
export type AdminPasswordRequest = z.infer<typeof adminPasswordRequestSchema>;

/** Where the admin account stands at the door: whether a password is made yet, whether the door
 *  is open (and until when), and whether its sign-in is fresh enough to open it. */
export const adminDoorStateSchema = z
  .object({ passwordSet: z.boolean(), open: z.boolean(), openUntil: z.string().datetime().nullable(), fresh: z.boolean() })
  .strict();
export type AdminDoorState = z.infer<typeof adminDoorStateSchema>;

// ── Each person's days (ROADMAP Stage 2 item 14a-ii) ─────────────────────────
// Each day is the person's own, in their phone's time zone; somebody whose phone has sent none yet is
// read in the admin's own time zone, which the page sends. Cost is in micro-dollars, whole numbers.

/** How many days a person's page shows at a time, and how many people a day's page. */
export const ADMIN_DAYS_PAGE = 30;
export const ADMIN_DAY_PEOPLE_PAGE = 50;

export const adminPersonDaysQuerySchema = z
  .object({
    /** The admin's own time zone, for a person whose phone has sent none. */
    zone: timeZoneNameSchema,
    /** The days before this one; absent, the days up to the person's today. */
    before: calendarDaySchema.optional(),
    /** The zone the first page was read in (its `zone`), so every page of one list is cut in the
     *  same zone even after the person's phone sends from another. */
    dayZone: timeZoneNameSchema.optional(),
  })
  .strict();
export type AdminPersonDaysQuery = z.infer<typeof adminPersonDaysQuerySchema>;

export const adminDayNumbersSchema = z
  .object({
    /** Null: their phone had not counted time in the app yet on that day. */
    minutes: z.number().int().nonnegative().nullable(),
    mealScans: z.number().int().nonnegative(),
    routePlans: z.number().int().nonnegative(),
    costMicro: z.number().int().nonnegative(),
  })
  .strict();
export type AdminDayNumbers = z.infer<typeof adminDayNumbersSchema>;

export const adminPersonDaySchema = adminDayNumbersSchema.extend({ day: calendarDaySchema }).strict();
export type AdminPersonDay = z.infer<typeof adminPersonDaySchema>;

export const adminPersonDaysResponseSchema = z
  .object({
    person: z.object({ id: z.string().uuid(), name: z.string(), email: z.string().nullable() }).strict(),
    /** The time zone the days are read in, and whether it is their phone's (else the admin's). */
    zone: z.string(),
    zoneFromPhone: z.boolean(),
    /** Their today, in that zone. */
    today: calendarDaySchema,
    /** Newest first, from their today (or the day before `before`) back to their sign-up day. */
    days: z.array(adminPersonDaySchema),
    /** The `before` of the next, earlier page; null at their sign-up day. */
    next: calendarDaySchema.nullable(),
  })
  .strict();
export type AdminPersonDaysResponse = z.infer<typeof adminPersonDaysResponseSchema>;

export const adminDayQuerySchema = z
  .object({
    zone: timeZoneNameSchema,
    /** How many people of the day's list to skip: the last page's `next`. */
    from: z.string().regex(/^\d{1,6}$/).optional(),
  })
  .strict();
export type AdminDayQuery = z.infer<typeof adminDayQuerySchema>;

export const adminDayPersonSchema = adminDayNumbersSchema
  .extend({ id: z.string().uuid(), name: z.string(), email: z.string().nullable() })
  .strict();
export type AdminDayPerson = z.infer<typeof adminDayPersonSchema>;

export const adminDayResponseSchema = z
  .object({
    day: calendarDaySchema,
    /** Everyone who used the app that day: time in the app, a scan, a route plan or a cost. */
    totals: z
      .object({
        people: z.number().int().nonnegative(),
        minutes: z.number().int().nonnegative(),
        mealScans: z.number().int().nonnegative(),
        routePlans: z.number().int().nonnegative(),
        costMicro: z.number().int().nonnegative(),
      })
      .strict(),
    /** Most time in the app first, then most meal scans, route plans and cost. */
    people: z.array(adminDayPersonSchema),
    next: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type AdminDayResponse = z.infer<typeof adminDayResponseSchema>;
