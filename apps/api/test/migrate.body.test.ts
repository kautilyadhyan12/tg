// P2.7d — pure transform tests for the body_measurements stage (no DB/Mongo).
import { describe, expect, it } from "vitest";
import { transformBody } from "../tools/migrate-mongo/collections/body.js";
import { uuidv5 } from "../tools/migrate-mongo/uuid5.js";

const mid = "6a118f07e96bd4c428a3ce34";
const uid = "6a0d468a98494b5b25602e8e";

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: mid,
    user_id: uid,
    measured_at: "2026-05-23T11:27:03.568Z",
    weight_kg: 75,
    waist_cm: 68,
    chest_cm: 56,
    hips_cm: 67,
    left_arm_cm: 98,
    right_arm_cm: 45,
    left_thigh_cm: 89,
    right_thigh_cm: 87,
    body_fat_pct: 46,
    ...over,
  };
}

describe("transformBody", () => {
  it("maps weight + folds *_cm/body_fat_pct into metrics; deterministic id", () => {
    const row = transformBody(body());
    expect(row).not.toBeNull();
    if (row === null) return;

    expect(row.id).toBe(uuidv5(mid));
    expect(row.userId).toBe(uuidv5(uid));
    expect(row.legacyMongoId).toBe(mid);
    expect(row.weightKg).toBe(75);
    expect(row.metrics).toEqual({
      waist_cm: 68,
      chest_cm: 56,
      hips_cm: 67,
      left_arm_cm: 98,
      right_arm_cm: 45,
      left_thigh_cm: 89,
      right_thigh_cm: 87,
      body_fat_pct: 46,
    });
    // every metric is a finite nonnegative number (the read-side z.record guard)
    for (const v of Object.values(row.metrics)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("excludes absent metric fields; keeps only what's present", () => {
    const row = transformBody({ _id: mid, user_id: uid, measured_at: "2026-05-23T11:27:03Z", waist_cm: 70 });
    expect(row?.metrics).toEqual({ waist_cm: 70 });
    expect(row?.weightKg).toBeNull();
  });

  it("clamps out-of-range/invalid weight to null (numeric(5,2))", () => {
    expect(transformBody(body({ weight_kg: 1500 }))?.weightKg).toBeNull();
    expect(transformBody(body({ weight_kg: 0 }))?.weightKg).toBeNull();
    expect(transformBody(body({ weight_kg: -5 }))?.weightKg).toBeNull();
    expect(transformBody(body({ weight_kg: 75.126 }))?.weightKg).toBe(75.13); // 2dp
  });

  it("missing/invalid measured_at → null (NOT NULL column)", () => {
    expect(transformBody(body({ measured_at: null }))).toBeNull();
    expect(transformBody(body({ measured_at: "nope" }))).toBeNull();
  });
});
