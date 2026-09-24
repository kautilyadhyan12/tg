// Part 4 §8 seeds — plans rows and feature_flags.
//
// Prices, member limits, trial lengths and scan allowances are Kd's, from
// RULINGS (Pricing, trials and money; 2026-09-22 and 2026-09-23), not Part 5
// §1's superseded table. Every number here is a ruling; none is derived from
// another. Entitlements keep Part 4 §3.3's canonical shape.
// Idempotent: upsert on plans.code / feature_flags.key — running twice is a no-op.
// Exercises = the full Part 2 §6 catalog (58) from @app/shared's reviewed
// table; definitions / achievements seeds land with their own tasks.
import { desc, eq, inArray } from "drizzle-orm";
import { CATALOG_58, GYM_TRIAL_DAYS, exerciseDefinitionSchema, exerciseNameKey } from "@app/shared";
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
  // 20/day — Kd, DECISIONS :17366 §1.
  meal_scan: { window: "day", limit: 20 },
  route_gen: { window: "day", limit: 2 },
  history_days: -1,
  programs: "all",
  global_leaderboards: true,
  share_watermark: false,
} as const;

/** What a MEMBER of a paying gym gets. **One difference from the paid consumer
 *  block and one only: 7 scans a day instead of 20** (Kd, RULINGS 2026-09-15,
 *  raised from the 5 of :17366 §1 when the gym price book was rebuilt to cover
 *  every member scanning 7 times a day at the scanner's measured cost; 20/day
 *  for gym members puts bands underwater, because an individual pays ~$10 a
 *  head and a gym far less). **The gap is an UPSELL, not a defect**:
 *  `mergeEntitlements` hands a member who also buys the individual plan the
 *  better of the two, which is the reason to buy. Nothing else is on record as
 *  differing, so nothing else differs (R0.2). */
const gymMemberEntitlements = {
  ...proEntitlements,
  meal_scan: { window: "day", limit: 7 },
} as const;

const freeEntitlements = {
  exercises: { mode: "tier", tier: "T1" },
  coach: { window: "month", limit: 5 },
  // One meal photo a day without a subscription (Kd, RULINGS 2026-09-22: "PER
  // DAY 1 MEAL"; was 2).
  meal_scan: { window: "day", limit: 1 },
  route_gen: { window: "month", limit: 2 },
  history_days: 90, // read-gate, not deletion (Part 4 §0.2)
  programs: "starter",
  global_leaderboards: false, // v1 §9.1: free = view + gym boards
  share_watermark: true,
} as const;

type PlanSeed = typeof plans.$inferInsert;

// An individual has no trial (Kd, RULINGS 2026-09-22): the free plan is the
// way in, and the $10 plan starts paid.
const CONSUMER_TRIAL_DAYS = 0;

// Prices in integer minor units (R6.1) — $79 is 7900, ₹7,500 is 750000. No
// float ever touches money.
const consumerRows: PlanSeed[] = [
  {
    code: "free",
    audience: "consumer",
    nameKey: "plan.free",
    priceMinor: 0,
    currency: "USD",
    interval: "month",
    trialDays: 0,
    rank: 0,
    entitlements: freeEntitlements,
  },
  {
    code: "pro_us_m",
    audience: "consumer",
    nameKey: "plan.pro_us_m",
    // $10 a month in every country (Kd, RULINGS 2026-09-22: "10 dollar worldwide").
    priceMinor: 1000,
    currency: "USD",
    interval: "month",
    trialDays: CONSUMER_TRIAL_DAYS,
    rank: 10,
    entitlements: proEntitlements,
  },
  {
    code: "pro_us_y",
    audience: "consumer",
    nameKey: "plan.pro_us_y",
    priceMinor: 11000, // $110/yr = $10 × 11, one month free (Kd, 2026-08-25)
    currency: "USD",
    interval: "year",
    trialDays: CONSUMER_TRIAL_DAYS,
    rank: 10,
    entitlements: proEntitlements,
  },
];

/** THE GYM PRICE LIST (Kd, RULINGS 2026-09-22 for the dollars and the
 *  limits, 2026-09-23 for the rupees).
 *
 *  `seatCap` IS the band's member limit (:17902 §4): `seatCapFor` in
 *  `modules/orgs/repo.ts` reads it through the gym's live subscription to decide
 *  whether the next member gets in, and a trial runs on band 1, so band 1's
 *  limit is the trial's 200.
 *
 *  Dollars for every country but India, with tax added on top at checkout (Kd,
 *  RULINGS 2026-09-24). An Indian gym sees FIXED rupee prices with no GST added:
 *  raised on 2026-09-24 so that GST, once Kd is registered, comes out of them —
 *  ₹1,000 more on the two smallest, 18 % more on the three biggest, rounded to ₹500.
 *
 *  No "more than 2,000" row is seeded: that gym is told "contact us", and a plan
 *  row with no real price is a number waiting to be read as one. */
const GYM_BANDS: { band: number; seatCap: number; usd: number; inr: number }[] = [
  //                          members       USD minor     INR minor
  { band: 1, seatCap: 200, usd: 7900, inr: 850000 }, //   up to 200  $79 / ₹8,500
  { band: 2, seatCap: 500, usd: 12900, inr: 1350000 }, // up to 500  $129 / ₹13,500
  { band: 3, seatCap: 1000, usd: 19900, inr: 2250000 }, // up to 1,000 $199 / ₹22,500
  { band: 4, seatCap: 1500, usd: 27900, inr: 3150000 }, // up to 1,500 $279 / ₹31,500
  { band: 5, seatCap: 2000, usd: 37900, inr: 4300000 }, // up to 2,000 $379 / ₹43,000
];

/** entitlements = the console's own features: Part 4 §3.3 leaves that shape
 *  unspecified, so `{}` stands (every reader takes defaults).
 *  memberEntitlements = what each member gets, per v1 §9.2.
 *  `orgTypes: null` = every org type, matching the spec's "all" column. Only
 *  `gym`, `studio` and `personal_trainer` can be created today (clinics struck
 *  at the door, :10182), so naming types here would add a second place to keep
 *  in step. */
const orgRows: PlanSeed[] = GYM_BANDS.flatMap(({ band, seatCap, usd, inr }) => [
  {
    code: `org_b${String(band)}_us_m`,
    audience: "org",
    nameKey: `plan.org_b${String(band)}_us_m`,
    priceMinor: usd,
    currency: "USD",
    interval: "month",
    seatCap,
    trialDays: GYM_TRIAL_DAYS,
    rank: 10,
    entitlements: {},
    memberEntitlements: gymMemberEntitlements,
  },
  {
    code: `org_b${String(band)}_in_m`,
    audience: "org",
    nameKey: `plan.org_b${String(band)}_in_m`,
    priceMinor: inr,
    currency: "INR",
    interval: "month",
    seatCap,
    trialDays: GYM_TRIAL_DAYS,
    rank: 10,
    entitlements: {},
    memberEntitlements: gymMemberEntitlements,
  },
]);

const planRows: PlanSeed[] = [...consumerRows, ...orgRows];

/** RETIRED PLANS — switched OFF, never deleted.
 *
 *  The first six are the pre-ruling org book (caps of 25/25/100/150/400, prices
 *  no ruled book has matched since 2026-08-24). They are retired rather than
 *  removed because `subscriptions.plan_id` references `plans.id` under RESTRICT
 *  and history is soft-state here (R4.3): a deleted plan row makes a past
 *  subscription unreadable. The gym trial and the gym price list read only
 *  `active = true` rows. */
const RETIRED_PLAN_CODES = [
  "org_micro",
  "org_micro_clinic",
  "org_starter",
  "org_standard",
  "org_growth",
  "org_scale",
  // The rupee individual plan (₹449): one individual price in every country
  // since RULINGS 2026-09-22. Switched off, never deleted, for the same reason.
  "pro_in_m",
  "pro_in_y",
] as const;

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
  // The pre-ruling org book goes dark. AFTER the upsert loop, never before: the
  // loop sets active:true on everything it touches, so the order is what makes
  // this stick. Idempotent — a second pass sets false over false.
  await db
    .update(plans)
    .set({ active: false })
    .where(inArray(plans.code, [...RETIRED_PLAN_CODES]));
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
