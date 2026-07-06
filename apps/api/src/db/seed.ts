// Part 4 §8 seeds — plans rows (prices: Part 5 §1 verbatim; entitlements:
// Part 4 §3.3 canonical shape + v1 §9.1 free/pro values) and feature_flags.
// Idempotent: upsert on plans.code / feature_flags.key — running twice is a no-op.
// Exercises / definitions / achievements seeds land with their own tasks
// (need Part 2 §6 catalog, ported constants, badges.py port).
import { createDb } from "./index.js";
import { featureFlags, plans } from "./schema/index.js";

// Part 4 §3.3 canonical entitlements JSON — every key present, defaults explicit.
const proEntitlements = {
  exercises: { mode: "all" },
  coach: { window: "day", limit: 30 },
  meal_scan: { window: "day", limit: 8 },
  route_gen: { window: "day", limit: 5 },
  history_days: -1,
  programs: "all",
  global_leaderboards: true,
  share_watermark: false,
} as const;

const freeEntitlements = {
  exercises: { mode: "tier", tier: "T1" },
  coach: { window: "month", limit: 5 },
  meal_scan: { window: "month", limit: 3 },
  route_gen: { window: "month", limit: 2 },
  history_days: 90, // read-gate, not deletion (Part 4 §0.2)
  programs: "starter",
  global_leaderboards: false, // v1 §9.1: free = view + gym boards
  share_watermark: true,
} as const;

type PlanSeed = typeof plans.$inferInsert;

// Prices in integer minor units (R6.1). Sources: Part 5 §1.1–1.2 tables.
const planRows: PlanSeed[] = [
  {
    code: "free",
    audience: "consumer",
    nameKey: "plan.free",
    priceMinor: 0,
    currency: "INR",
    interval: "month",
    trialDays: 0,
    rank: 0,
    entitlements: freeEntitlements,
  },
  {
    code: "pro_in_m",
    audience: "consumer",
    nameKey: "plan.pro_in_m",
    priceMinor: 14900, // ₹149/mo
    currency: "INR",
    interval: "month",
    trialDays: 0,
    rank: 10,
    entitlements: proEntitlements,
  },
  {
    code: "pro_in_y",
    audience: "consumer",
    nameKey: "plan.pro_in_y",
    priceMinor: 99900, // ₹999/yr
    currency: "INR",
    interval: "year",
    trialDays: 0,
    rank: 10,
    entitlements: proEntitlements,
  },
  {
    code: "pro_us_m",
    audience: "consumer",
    nameKey: "plan.pro_us_m",
    priceMinor: 399, // $3.99/mo
    currency: "USD",
    interval: "month",
    trialDays: 0,
    rank: 10,
    entitlements: proEntitlements,
  },
  {
    code: "pro_us_y",
    audience: "consumer",
    nameKey: "plan.pro_us_y",
    priceMinor: 2999, // $29.99/yr
    currency: "USD",
    interval: "year",
    trialDays: 0,
    rank: 10,
    entitlements: proEntitlements,
  },
  // Org plans — INR monthly book (Part 5 §1.2). entitlements = console
  // features: shape not yet specified by the spec, seeded {} (every consumer
  // of entitlements reads with defaults); member_entitlements = Pro block.
  {
    code: "org_micro",
    audience: "org",
    orgTypes: ["gym", "studio"],
    nameKey: "plan.org_micro",
    priceMinor: 99900, // ₹999/mo
    currency: "INR",
    interval: "month",
    seatCap: 25,
    trialDays: 7,
    rank: 10,
    entitlements: {},
    memberEntitlements: proEntitlements,
  },
  {
    code: "org_micro_clinic",
    audience: "org",
    orgTypes: ["clinic"],
    nameKey: "plan.org_micro_clinic",
    priceMinor: 149900, // ₹1,499/mo
    currency: "INR",
    interval: "month",
    seatCap: 25,
    trialDays: 7,
    rank: 10,
    entitlements: {},
    memberEntitlements: proEntitlements,
  },
  {
    code: "org_starter",
    audience: "org",
    nameKey: "plan.org_starter",
    priceMinor: 149900, // ₹1,499/mo
    currency: "INR",
    interval: "month",
    seatCap: 100,
    trialDays: 7,
    rank: 10,
    entitlements: {},
    memberEntitlements: proEntitlements,
  },
  {
    code: "org_standard",
    audience: "org",
    nameKey: "plan.org_standard",
    priceMinor: 199900, // ₹1,999/mo
    currency: "INR",
    interval: "month",
    seatCap: 150,
    trialDays: 7,
    rank: 10,
    entitlements: {},
    memberEntitlements: proEntitlements,
  },
  {
    code: "org_growth",
    audience: "org",
    nameKey: "plan.org_growth",
    priceMinor: 349900, // ₹3,499/mo
    currency: "INR",
    interval: "month",
    seatCap: 400,
    trialDays: 7,
    rank: 10,
    entitlements: {},
    memberEntitlements: proEntitlements,
  },
  {
    code: "org_scale",
    audience: "org",
    nameKey: "plan.org_scale",
    priceMinor: 499900, // ₹4,999/mo → custom
    currency: "INR",
    interval: "month",
    seatCap: null, // 400+ — capless until custom pricing
    trialDays: 7,
    rank: 10,
    entitlements: {},
    memberEntitlements: proEntitlements,
  },
];

// Part 4 §8: feature_flags seed — {data_backend, engine_rollout, beta_definitions}.
const flagRows = [
  { key: "data_backend", rules: {} },
  { key: "engine_rollout", rules: {} },
  { key: "beta_definitions", rules: {} },
];

export async function seed(databaseUrl: string): Promise<void> {
  const db = createDb(databaseUrl);
  for (const row of planRows) {
    await db
      .insert(plans)
      .values(row)
      .onConflictDoUpdate({
        target: plans.code,
        set: {
          audience: row.audience,
          orgTypes: row.orgTypes ?? null,
          nameKey: row.nameKey,
          priceMinor: row.priceMinor,
          currency: row.currency,
          interval: row.interval,
          seatCap: row.seatCap ?? null,
          trialDays: row.trialDays,
          rank: row.rank,
          entitlements: row.entitlements,
          memberEntitlements: row.memberEntitlements ?? null,
          active: true,
        },
      });
  }
  for (const flag of flagRows) {
    await db.insert(featureFlags).values(flag).onConflictDoNothing();
  }
}

// CLI entry: pnpm --filter api seed  (DATABASE_URL required)
const invokedDirectly = process.argv[1]?.endsWith("seed.js") === true || process.argv[1]?.endsWith("seed.ts") === true;
if (invokedDirectly) {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL is required to seed");
  }
  await seed(url);
  process.exit(0);
}
