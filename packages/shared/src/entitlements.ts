// P2.4 — the canonical entitlements JSON (Part 4 §3.3): "the only shape the
// quota middleware and repos read; every key has a default so old plan rows
// survive new features". Defaults are the FREE values from the §3.3 seed
// notes (coach 5/month, meal 3/month, routes 2/month, history 90, starter
// program, watermark on, T1 exercises, no global boards).
import { z } from "zod";

export const meteredWindowSchema = z.enum(["day", "month"]);
export type MeteredWindow = z.infer<typeof meteredWindowSchema>;

const meteredFeatureSchema = z
  .object({ window: meteredWindowSchema, limit: z.number().int().nonnegative() })
  .strict();
export type MeteredFeature = z.infer<typeof meteredFeatureSchema>;

const exercisesEntitlementSchema = z.union([
  z.object({ mode: z.literal("all") }).strict(),
  z.object({ mode: z.literal("tier"), tier: z.string().min(1) }).strict(),
]);
export type ExercisesEntitlement = z.infer<typeof exercisesEntitlementSchema>;

/** Parsed with .default() per key — a plan row missing keys yields free-tier
 *  behavior for those keys, never a crash (R6.5). */
export const entitlementsSchema = z.object({
  exercises: exercisesEntitlementSchema.default({ mode: "tier", tier: "T1" }),
  coach: meteredFeatureSchema.default({ window: "month", limit: 5 }),
  meal_scan: meteredFeatureSchema.default({ window: "month", limit: 3 }),
  route_gen: meteredFeatureSchema.default({ window: "month", limit: 2 }),
  history_days: z.number().int().default(90), // -1 = unlimited
  programs: z.enum(["starter", "all"]).default("starter"),
  global_leaderboards: z.boolean().default(false),
  share_watermark: z.boolean().default(true),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

export const METERED_FEATURES = ["coach", "meal_scan", "route_gen"] as const;
export type MeteredFeatureName = (typeof METERED_FEATURES)[number];

/** GET /v1/entitlements/me (DECISIONS P2.4 GAP-3). */
export const entitlementsMeSchema = z.object({
  entitlements: entitlementsSchema,
  /** Highest-rank source that granted them (display hint, R3.1). */
  source: z.enum(["free", "own_subscription", "gym_membership"]),
});
export type EntitlementsMe = z.infer<typeof entitlementsMeSchema>;
