// Part 4 §8 seeds — plans rows and feature_flags.
//
// **PRICES ARE KD'S RULED BOOK, NOT Part 5 §1's.** That spec table is
// SUPERSEDED: DECISIONS :17366 §1 ratified a US/CA/EU book and an INR book,
// and :17902 §1a/§1b then raised bands 1-2 and rounded every boundary. Read
// both before touching a number here, and note the standing warning in each:
// **an inferred ruling is not a ruling** — bands 3-5 and the INR prices are
// what Kd left standing, and scaling them "to match" the band-1/2 raise is the
// exact failure :17366 §0 records. Entitlements keep Part 4 §3.3's canonical
// shape; the ALLOWANCES inside them are :17366 §1/§2's.
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
  // 20/day — Kd, DECISIONS :17366 §1. Also the TRIAL's allowance: :16702
  // ratified capping the unlimited trial week at 20/day precisely so the trial
  // IS the paid experience, which is why no separate trial document exists.
  meal_scan: { window: "day", limit: 20 },
  route_gen: { window: "day", limit: 2 },
  history_days: -1,
  programs: "all",
  global_leaderboards: true,
  share_watermark: false,
} as const;

/** What a MEMBER of a paying gym gets. **One difference from the paid consumer
 *  block and one only: 5 scans a day instead of 20** (Kd, :17366 §1, measured
 *  correct at §2 — 20/day for gym members puts three of five bands underwater,
 *  because an individual pays ~$10 a head and a gym ~$0.10). **The gap is an
 *  UPSELL, not a defect**: `mergeEntitlements` hands a member who also buys the
 *  individual plan the better of the two, which is the reason to buy.
 *  Nothing else is on record as differing, so nothing else differs (R0.2). */
const gymMemberEntitlements = {
  ...proEntitlements,
  meal_scan: { window: "day", limit: 5 },
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

/** The consumer trial's LENGTH — one week (Kd, :16548). The trial's ALLOWANCE
 *  needs no document of its own: :16702 capped the "unlimited" week at 20/day,
 *  which is the paid plan's own figure. Nothing reads this column yet. */
const CONSUMER_TRIAL_DAYS = 7;
/** 30 days, Kd at :16548 — **superseding the spec's 7**, which appears in
 *  `03-part3-org-console.md:236` §4.0 step 2 and `05-part5-billing.md` §6.1.
 *  A chat reading only the spec will carry the 7 forward; do not. */
const ORG_TRIAL_DAYS = 30;

// Prices in integer minor units (R6.1) — $35 is 3500, ₹1,500 is 150000. No
// float ever touches money.
const consumerRows: PlanSeed[] = [
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
    // Kd ruled "$5" for India (:17366 §1); the rupee figure was a chat
    // RECOMMENDATION there and was put to him and CONFIRMED on 2026-08-25.
    priceMinor: 44900, // ₹449/mo
    currency: "INR",
    interval: "month",
    trialDays: CONSUMER_TRIAL_DAYS,
    rank: 10,
    entitlements: proEntitlements,
  },
  {
    code: "pro_in_y",
    audience: "consumer",
    nameKey: "plan.pro_in_y",
    // ELEVEN months' money for twelve — "one month free", Kd 2026-08-25, asked
    // directly when the old ₹999/yr turned out to be cheaper than three months
    // at the new monthly price. NOT the spec's ×10 (two months free), which is
    // the ORG yearly convention and is untouched by this seed.
    priceMinor: 493900, // ₹4,939/yr = ₹449 × 11
    currency: "INR",
    interval: "year",
    trialDays: CONSUMER_TRIAL_DAYS,
    rank: 10,
    entitlements: proEntitlements,
  },
  {
    code: "pro_us_m",
    audience: "consumer",
    nameKey: "plan.pro_us_m",
    priceMinor: 1000, // $10/mo — Kd, :17366 §1 (supersedes :16702's $6.99)
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
    priceMinor: 11000, // $110/yr = $10 × 11 (one month free, as above)
    currency: "USD",
    interval: "year",
    trialDays: CONSUMER_TRIAL_DAYS,
    rank: 10,
    entitlements: proEntitlements,
  },
];

/** THE GYM BANDS, both currency books.
 *
 *  **`seatCap` IS the band boundary in code** (:17902 §4) — the same number
 *  does two jobs, and `seatCapFor` in `modules/orgs/repo.ts` reads it through
 *  the gym's live subscription to decide whether the next member gets in. That
 *  is why a price change and a boundary change are ONE edit here, and why the
 *  test asserts caps as hard as it asserts prices: the old book stayed stale
 *  through two rulings partly because nothing observed a cap.
 *
 *  **The boundaries are Kd's rounded ones** (:17902 §1b — *"299 does not make
 *  sense make it 300 then 301 to like that"*), and they move in BOTH books
 *  because a boundary is a member count, not a currency.
 *
 *  **The prices are two separate rulings and must not be reconciled with each
 *  other.** Bands 1-2 USD are :17902 §1a; bands 3-5 USD and the whole INR
 *  column are :17366 §1 and were NOT touched on 2026-08-25 — scaling them by
 *  the same ~17% would be inventing a ruling (:17366 §0). India lands near 57%
 *  of the US price with roughly half the margin, deliberately.
 *
 *  **No "custom above 2100" row is seeded.** The ruled book says "custom"
 *  there, and a plan row carrying no real price is a number waiting to be read
 *  as one; a 2101+ gym gets a row written for its own deal. */
const GYM_BANDS: { band: number; seatCap: number; usd: number; inr: number }[] = [
  //                          members       USD minor    INR minor
  { band: 1, seatCap: 300, usd: 3500, inr: 150000 }, //    0–300   $35 / ₹1,500
  { band: 2, seatCap: 500, usd: 5000, inr: 250000 }, //  301–500   $50 / ₹2,500
  { band: 3, seatCap: 1000, usd: 6900, inr: 450000 }, // 501–1000  $69 / ₹4,500
  { band: 4, seatCap: 1500, usd: 9900, inr: 650000 }, // 1001–1500 $99 / ₹6,500
  { band: 5, seatCap: 2100, usd: 12900, inr: 850000 }, // 1501–2100 $129 / ₹8,500
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
    trialDays: ORG_TRIAL_DAYS,
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
    trialDays: ORG_TRIAL_DAYS,
    rank: 10,
    entitlements: {},
    memberEntitlements: gymMemberEntitlements,
  },
]);

const planRows: PlanSeed[] = [...consumerRows, ...orgRows];

/** THE PRE-RULING ORG BOOK — switched OFF, never deleted.
 *
 *  These six carried caps of 25/25/100/150/400 and prices no ruled book has
 *  matched since 2026-08-24. They are RETIRED rather than removed because
 *  `subscriptions.plan_id` references `plans.id` under RESTRICT and history is
 *  soft-state here (R4.3) — a deleted plan row makes a past subscription
 *  unreadable, and `org_micro_clinic` in particular is the clinic tier that
 *  :10182 narrowed at the DOOR without deleting.
 *
 *  **Said plainly rather than implied: nothing reads `plans.active` today**
 *  (grep-verified across `apps/api/src`). This is bookkeeping — but it is the
 *  bookkeeping that is true, and the flag is the seam a plan picker will use. */
const RETIRED_PLAN_CODES = [
  "org_micro",
  "org_micro_clinic",
  "org_starter",
  "org_standard",
  "org_growth",
  "org_scale",
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
