// The admin page (ROADMAP Stage 2 item 14a-i; Kd, 2026-11-07 and 2026-11-08): Kd's own page, on
// the website only, listing the people who use the app and setting one person's meal scans or route
// plans a day. Only what running the app needs: never a health answer, a weight, a photo or a run.
import { z } from "zod";
import { meteredWindowSchema } from "./entitlements.js";

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
