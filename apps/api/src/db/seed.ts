// Part 4 §8 seeds — plans rows (prices: Part 5 §1 verbatim; entitlements:
// Part 4 §3.3 canonical shape + v1 §9.1 free/pro values) and feature_flags.
// Idempotent: upsert on plans.code / feature_flags.key — running twice is a no-op.
// Exercises = the full Part 2 §6 catalog (58) from @app/shared's reviewed
// table; definitions / achievements seeds land with their own tasks.
import { desc, eq, inArray } from "drizzle-orm";
import { CATALOG_58, exerciseDefinitionSchema, exerciseNameKey } from "@app/shared";
import squatDef from "@app/engine/definitions/squat.json" with { type: "json" };
import jumpSquatDef from "@app/engine/definitions/jump_squat.json" with { type: "json" };
import chairSquatDef from "@app/engine/definitions/chair_squat.json" with { type: "json" };
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { bundleSha256 } from "../modules/exercises/bundle.js";
import { ACHIEVEMENTS } from "../modules/gamification/badges.js";
import {
  achievements,
  definitionBundles,
  exerciseDefinitions,
  exercises,
  featureFlags,
  plans,
} from "./schema/index.js";

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
  // Kd ruling 2026-07-16 (DEVIATION from the Part 5 §1 price book's 3/month,
  // raised at the Card-5a smoke): free tier = 2 scans/day. Cost noted at the
  // ruling: ~60/month ≈ $0.10/free user at Qwen prices vs ~$0.005 before.
  meal_scan: { window: "day", limit: 2 },
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

// The full Part 2 §6 catalog — all 58, from the REVIEWED CONSTANTS TABLE in
// @app/shared (`exerciseCatalog.ts`; review artifact `docs/catalog-58.md`,
// signed off by Kd 2026-08-01). This SUPERSEDES the P1.10d minimal 3-row seed,
// whose own comment deferred the full catalog "to its owning task" — this is
// that task (DECISIONS :3424: the catalog must exist before hand-logged
// workouts can be written, because `modules/workouts/repo.ts` discards sets
// whose slug has no row and keeps the parent workout regardless).
//
// The table is imported, never restated: one copy means the API and the web
// cannot drift on what an exercise is called. `status` is left to the column
// default 'live' (Part 4 §3.4) — including Mountain Pose, per §3.4:366-369.
const exerciseRows = CATALOG_58.map((e) => ({
  slug: e.slug,
  nameKey: exerciseNameKey(e.slug),
  family: e.family,
  tier: e.tier,
  met: e.met,
  tracking: e.tracking,
}));

// Part 4 §8: feature_flags seed — {data_backend, engine_rollout, beta_definitions}.
const flagRows = [
  { key: "data_backend", rules: {} },
  { key: "engine_rollout", rules: {} },
  { key: "beta_definitions", rules: {} },
];

export async function seed(databaseUrl: string): Promise<void> {
  // Own the client so callers (tests) don't leak a connection — createDb
  // has no close seam.
  const client = postgres(databaseUrl, { prepare: false, max: 1 });
  const db = drizzle(client);
  try {
    await seedAll(db);
  } finally {
    await client.end({ timeout: 5 });
  }
}

type SeedDb = ReturnType<typeof drizzle>;

async function seedAll(db: SeedDb): Promise<void> {
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
  // ONE statement, not 58 round-trips. The row-at-a-time loop was fine for the
  // 3-row seed it was written for; at 58 it added ~50 s per seed call against
  // the shared Neon branch, and the DB-gated suites all run against that one
  // branch (vitest.config.ts) — enough extra load to time out a neighbouring
  // 5 s test. Same conflict target, same idempotency.
  await db.insert(exercises).values(exerciseRows).onConflictDoNothing({ target: exercises.slug });
  await seedDefinitions(db);
  // P2.3: achievements catalog (Part 4 §3.8 "seeded from badges.py port").
  // Upsert on code: criteria fixes propagate; earned rows are untouched.
  for (const a of ACHIEVEMENTS) {
    await db
      .insert(achievements)
      .values({ code: a.code, nameKey: a.nameKey, criteria: a.criteria, icon: a.icon })
      .onConflictDoUpdate({
        target: achievements.code,
        set: { nameKey: a.nameKey, criteria: a.criteria, icon: a.icon },
      });
  }
}

// P2.2 A2 (approved): the three P1.8b definitions, seeded 'live' with each
// document's own version field (squat is v6 after parity tuning — the bundle
// schema requires manifest version == document version, so "version 1" from
// the plan note would be incoherent for squat; the DOCUMENT is authoritative,
// verbatim from packages/engine/src/definitions — R5.7 immutability). One
// live bundle row is built from these pointers (Part 2 §9.3, Part 4 §3.4);
// idempotent: same content hash → no new bundle row.
const definitionDocs = [squatDef, jumpSquatDef, chairSquatDef].map((doc) =>
  // JSON files are external input at this boundary (R2.3).
  exerciseDefinitionSchema.parse(doc),
);

async function seedDefinitions(db: SeedDb): Promise<void> {
  const slugs = definitionDocs.map((d) => d.key);
  const exRows = await db
    .select({ id: exercises.id, slug: exercises.slug })
    .from(exercises)
    .where(inArray(exercises.slug, slugs));
  const idBySlug = new Map(exRows.map((r) => [r.slug, r.id]));

  for (const doc of definitionDocs) {
    const exerciseId = idBySlug.get(doc.key);
    if (exerciseId === undefined) throw new Error(`definitions seed: no exercises row for '${doc.key}'`);
    await db
      .insert(exerciseDefinitions)
      .values({
        exerciseId,
        version: doc.version,
        status: "live",
        definition: doc,
        minEngineVersion: doc.minEngineVersion,
        publishedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [exerciseDefinitions.exerciseId, exerciseDefinitions.version],
      });
  }

  const manifest = Object.fromEntries(definitionDocs.map((d) => [d.key, d.version]));
  const sha256 = bundleSha256({ channel: "live", manifest, definitions: definitionDocs });
  const latest = await db
    .select({ sha256: definitionBundles.sha256 })
    .from(definitionBundles)
    .where(eq(definitionBundles.channel, "live"))
    .orderBy(desc(definitionBundles.bundleVersion))
    .limit(1);
  if (latest[0]?.sha256 !== sha256) {
    await db.insert(definitionBundles).values({ channel: "live", sha256, manifest });
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
