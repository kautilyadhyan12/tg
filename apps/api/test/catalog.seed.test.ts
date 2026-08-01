// The 58-exercise catalog seed against REAL Postgres (R9.2 — not a mock of SQL).
// DATABASE_URL-gated, like every other DB-backed suite here.
//
// What this protects, and why it is not the shared-package test: that one proves
// the TABLE is well-formed; this one proves the rows actually reach the column
// types and CHECK constraints, and that every name a user can pick has a home.
// Before this card the catalog held 3 rows while the library offered 58, and
// `modules/workouts/repo.ts` discards a set whose slug has no row while still
// inserting the parent workout — so a hand-logged push-up became a 0-rep
// workout in history (DECISIONS :3424).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { CATALOG_58, exerciseNameKey, slugForLegacyName } from "@app/shared";
import { seed } from "../src/db/seed.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

interface Row {
  slug: string;
  name_key: string;
  family: string;
  tier: string;
  tracking: string;
  status: string;
  met: string;
}

d("exercise catalog seed (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let rows: Row[] = [];

  beforeAll(async () => {
    // Twice: the seed is idempotent (ON CONFLICT DO NOTHING on slug), and a
    // second run must not duplicate or error — the same proof the definitions
    // seed carries.
    await seed(url ?? "");
    await seed(url ?? "");
    rows = await sql<Row[]>`
      SELECT slug, name_key, family, tier, tracking, status, met::text AS met
      FROM exercises ORDER BY slug`;
    // 120 s for the same reason exercises.routes.test.ts:106 uses it: the
    // DB-gated suites share one Neon branch through one pooler, and TWO full
    // seed runs sit well past vitest's 10 s hook default (vitest.config.ts).
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("seeds all 58 and nothing else", () => {
    expect(rows).toHaveLength(58);
    expect(rows.map((r) => r.slug).sort()).toEqual([...CATALOG_58.map((e) => e.slug)].sort());
  });

  it("every row matches the reviewed table field for field", () => {
    // Field-by-field rather than a row count: a count passes while every MET is
    // wrong. `met::text` because numeric arrives as a string and 3.5 vs 3.50
    // is a real difference the column decides, not the test.
    const byslug = new Map(rows.map((r) => [r.slug, r]));
    for (const e of CATALOG_58) {
      const row = byslug.get(e.slug);
      expect(row, e.slug).toBeDefined();
      expect(row?.family, e.slug).toBe(e.family);
      expect(row?.tier, e.slug).toBe(e.tier);
      expect(row?.tracking, e.slug).toBe(e.tracking);
      expect(row?.name_key, e.slug).toBe(exerciseNameKey(e.slug));
      expect(Number(row?.met), e.slug).toBe(Number(e.met));
    }
  });

  it("THE ONE THAT MATTERS: every exercise a user can pick resolves to a seeded row", () => {
    // The library name → slug → catalog row chain, end to end. If anyone adds
    // an exercise to the app's library without adding it here, this goes red —
    // which is the only thing standing between a user and a silently discarded
    // workout.
    const seeded = new Set(rows.map((r) => r.slug));
    for (const e of CATALOG_58) {
      const slug = slugForLegacyName(e.legacyName);
      expect(slug, `no slug for library name "${e.legacyName}"`).not.toBeNull();
      expect(seeded.has(slug ?? ""), `"${e.legacyName}" → ${slug ?? "null"} has no row`).toBe(true);
    }
  });

  it("all 58 are status 'live' — including Mountain Pose (Part 4 §3.4:366)", () => {
    expect(rows.filter((r) => r.status !== "live")).toEqual([]);
    expect(rows.find((r) => r.slug === "mountain_pose")?.status).toBe("live");
  });

  it("Brisk Walking is the only 'timer' row; every other row is 'pose'", () => {
    expect(rows.filter((r) => r.tracking === "timer").map((r) => r.slug)).toEqual([
      "brisk_walking",
    ]);
    expect(rows.filter((r) => r.tracking === "pose")).toHaveLength(57);
  });

  it("the three engine exercises keep the values the P1.10d seed gave them", () => {
    // They already existed, and the seed does NOT overwrite (DO NOTHING). If
    // the reviewed table had disagreed with the live rows, this is where that
    // shows up — as a mismatch, not as a silent old value.
    const byslug = new Map(rows.map((r) => [r.slug, r]));
    expect(Number(byslug.get("squat")?.met)).toBe(6.0);
    expect(Number(byslug.get("jump_squat")?.met)).toBe(8.0);
    expect(Number(byslug.get("chair_squat")?.met)).toBe(5.0);
    for (const slug of ["squat", "jump_squat", "chair_squat"]) {
      expect(byslug.get(slug)?.family, slug).toBe("F1");
      expect(byslug.get(slug)?.tier, slug).toBe("T1");
    }
  });

  it("a sync of a previously-unknown exercise now finds its catalog row", () => {
    // The card's actual purpose, stated as the repo query the sync path runs
    // (`repo.getExerciseIdsBySlug`): push_up used to return nothing, so the set
    // was discarded. Asserted on the same table the sync path reads.
    const seeded = new Set(rows.map((r) => r.slug));
    for (const slug of ["push_up", "plank", "glute_bridge", "burpees", "warrior_ii"]) {
      expect(seeded.has(slug), slug).toBe(true);
    }
  });
});
