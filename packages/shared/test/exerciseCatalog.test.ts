// The reviewed 58-exercise table — integrity of the TABLE ITSELF (no DB).
// Its DB counterpart is apps/api/test/catalog.seed.test.ts, which proves the
// rows actually land. Split deliberately: this half must stay runnable in the
// pure package (zero deps), so a table typo fails in milliseconds without a
// Postgres branch.
import { describe, expect, it } from "vitest";
import {
  CATALOG_58,
  exerciseNameKey,
  slugForLegacyName,
  type CatalogExercise,
} from "../src/exerciseCatalog.js";

describe("CATALOG_58 — table integrity", () => {
  it("holds exactly 58 rows (Part 2 §6:885 — 12 + 17 + 29, zero open slots)", () => {
    expect(CATALOG_58).toHaveLength(58);
    const byTier = (t: CatalogExercise["tier"]) => CATALOG_58.filter((e) => e.tier === t).length;
    expect(byTier("T1")).toBe(12);
    expect(byTier("T2")).toBe(17);
    expect(byTier("T3")).toBe(29);
  });

  it("every slug is unique — a duplicate would silently drop an exercise at seed", () => {
    // The seed upserts on slug, so two rows sharing one would insert ONE and
    // leave the other exercise with no home, which is this card's whole bug.
    const slugs = CATALOG_58.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(58);
  });

  it("every legacy name is unique — a duplicate would make the lookup ambiguous", () => {
    const names = CATALOG_58.map((e) => e.legacyName);
    expect(new Set(names).size).toBe(58);
  });

  it("slugs are lowercase snake_case (the id workouts get stored against)", () => {
    for (const e of CATALOG_58) {
      expect(e.slug, `${e.legacyName} → ${e.slug}`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("families satisfy the Part 4 §3.4 CHECK (F1..F12) — a bad one is a 23514 at seed", () => {
    for (const e of CATALOG_58) {
      expect(e.family, e.legacyName).toMatch(/^F([1-9]|1[0-2])$/);
    }
  });

  it("METs are one-decimal strings the numeric(3,1) column accepts", () => {
    // STRING, not float: 0.1 has no exact binary form, so a float literal is
    // the one way a Compendium value could drift on its way to the column.
    for (const e of CATALOG_58) {
      expect(e.met, e.legacyName).toMatch(/^\d{1,2}\.\d$/);
      expect(Number(e.met)).toBeGreaterThan(0);
      expect(Number(e.met)).toBeLessThanOrEqual(11);
    }
  });

  it("Brisk Walking is the ONLY timer row (Part 4 §3.4:370)", () => {
    const timers = CATALOG_58.filter((e) => e.tracking === "timer");
    expect(timers.map((e) => e.slug)).toEqual(["brisk_walking"]);
  });

  it("carries the two Kd-ruled rows verbatim (both F11, 2026-08-01)", () => {
    const arm = CATALOG_58.find((e) => e.slug === "arm_circles");
    const walk = CATALOG_58.find((e) => e.slug === "brisk_walking");
    expect(arm?.family).toBe("F11"); // spec said "F11/F8 hybrid"; Kd ruled F11
    expect(walk?.family).toBe("F11"); // spec gave none; column is NOT NULL
  });

  it("Mountain Pose is present — the REMOVED_EXERCISES hack dies here (Part 4 §3.4:366)", () => {
    const mp = CATALOG_58.find((e) => e.slug === "mountain_pose");
    expect(mp).toBeDefined();
    expect(mp?.tier).toBe("T3");
    expect(mp?.family).toBe("F12");
    expect(mp?.met).toBe("2.3");
  });

  it("arnold_shoulder_press is ABSENT by ruling, not by omission (Part 4 §3.4:373)", () => {
    expect(CATALOG_58.some((e) => e.slug === "arnold_shoulder_press")).toBe(false);
  });

  it("MET values match Part 2B Appendix A for the ✱-preserved calories.py rows", () => {
    // The seven the appendix marks ✱ — "value already in calories.py today,
    // preserved exactly". These are the ones a re-derivation would move.
    const expected: Record<string, string> = {
      squat: "6.0",
      chair_squat: "5.0",
      push_up: "8.0",
      lunge: "6.0",
      plank: "3.0",
      bicep_curl: "3.5",
      shoulder_press: "3.5",
    };
    for (const [slug, met] of Object.entries(expected)) {
      expect(CATALOG_58.find((e) => e.slug === slug)?.met, slug).toBe(met);
    }
  });

  it("agrees with the migration's FROZEN slug table on all 11 mapped names", () => {
    // tools/migrate-mongo/exerciseNames.ts names the slug it expects this
    // catalog to use and calls itself "the single reconciliation point". If
    // this drifts, historic legacy workouts keep getting skipped at migration
    // — silently, because a skip is quality-flagged, never an error.
    const migrationExpects = [
      "squat",
      "jump_squat",
      "chair_squat",
      "glute_bridge",
      "bicep_curl",
      "bulgarian_split_squat",
      "calf_raises",
      "bicycle_crunch",
      "arm_circles",
      "bench_press",
      "brisk_walking",
    ];
    const slugs = new Set(CATALOG_58.map((e) => e.slug));
    for (const slug of migrationExpects) expect(slugs.has(slug), slug).toBe(true);
  });
});

describe("slugForLegacyName", () => {
  it("resolves every library name in the table", () => {
    for (const e of CATALOG_58) {
      expect(slugForLegacyName(e.legacyName), e.legacyName).toBe(e.slug);
    }
  });

  it("returns null for a name outside the catalog — never a guess", () => {
    // The three that exist only in historic legacy workouts (exerciseNames.ts
    // rows 12-14). A fabricated slug here would be discarded server-side and
    // leave a 0-rep workout behind, which is the failure this card exists to
    // prevent — so null must stay null.
    expect(slugForLegacyName("Arnold Shoulder Press")).toBeNull();
    expect(slugForLegacyName("1-Arm Half-Kneeling Lat Pulldown")).toBeNull();
    expect(slugForLegacyName("1 Leg Box Squat")).toBeNull();
    expect(slugForLegacyName("")).toBeNull();
  });

  it("is EXACT match — a near-miss fails loudly instead of resolving wrong", () => {
    // No lowercase/trim fallback by design: mechanical name rules do not work
    // on this data (exerciseNames.ts:13-16 — they fail even on the seeded
    // three, because the slugs are singular and the names plural).
    expect(slugForLegacyName("squats")).toBeNull();
    expect(slugForLegacyName("SQUATS")).toBeNull();
    expect(slugForLegacyName(" Squats")).toBeNull();
    expect(slugForLegacyName("Squat")).toBeNull();
    // ...while the real name still resolves (the positive control, without
    // which every assertion above would pass on a lookup that always fails).
    expect(slugForLegacyName("Squats")).toBe("squat");
  });
});

describe("exerciseNameKey", () => {
  it("follows the DECISIONS 2026-07-10 convention (plan.<code> → exercise.<slug>)", () => {
    expect(exerciseNameKey("squat")).toBe("exercise.squat");
    expect(exerciseNameKey("worlds_greatest_stretch")).toBe("exercise.worlds_greatest_stretch");
  });
});
