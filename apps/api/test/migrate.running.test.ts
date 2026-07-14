// P2.7e — pure transform tests for the running stage (no DB/Mongo).
import { describe, expect, it } from "vitest";
import { transformRun, transformRoute } from "../tools/migrate-mongo/collections/running.js";
import { uuidv5 } from "../tools/migrate-mongo/uuid5.js";

const mid = "6a36f8d2e5a6aa387a50df80";
const uid = "6a0d468a98494b5b25602e8e";

describe("transformRun", () => {
  it("converts units, JSON-passes the polyline, keeps kcal (calc_version handled at insert)", () => {
    const row = transformRun({
      _id: mid,
      user_id: uid,
      started_at: "2026-06-20T20:32:18.616Z",
      duration_min: 30,
      distance_km: 5,
      calories_burned: 250,
      path: [[26.7, 94.1], [26.8, 94.2]],
      splits: [{ km: 1, s: 300 }],
    });
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(row.id).toBe(uuidv5(mid));
    expect(row.userId).toBe(uuidv5(uid));
    expect(row.durationS).toBe(30 * 60);
    expect(row.distanceM).toBe(5000);
    expect(row.kcalPoint).toBe(250);
    expect(row.polyline).toBe(JSON.stringify([[26.7, 94.1], [26.8, 94.2]]));
    expect(row.splits).toEqual([{ km: 1, s: 300 }]);
    expect(row.legacyMongoId).toBe(mid);
  });

  it("GAP-H: missing duration/calories/splits → 0 / null / null (never fabricated)", () => {
    const row = transformRun({ _id: mid, user_id: uid, started_at: "2026-06-20T20:32:18Z", distance_km: 0 });
    expect(row?.durationS).toBe(0);
    expect(row?.distanceM).toBe(0);
    expect(row?.kcalPoint).toBeNull();
    expect(row?.splits).toBeNull();
    expect(row?.polyline).toBeNull();
  });

  it("missing/invalid started_at → null (NOT NULL column)", () => {
    expect(transformRun({ _id: mid, user_id: uid })).toBeNull();
    expect(transformRun({ _id: mid, user_id: uid, started_at: "nope" })).toBeNull();
  });
});

describe("transformRoute", () => {
  const rid = "6a36f8c0e5a6aa387a50df7f";
  it("maps label→name, JSON-passes coords→polyline, converts distance", () => {
    const row = transformRoute({
      _id: rid,
      user_id: uid,
      label: "Best match",
      coords: [[26.71, 94.17], [26.72, 94.18]],
      distance_km: 2.8,
    });
    expect(row?.name).toBe("Best match");
    expect(row?.polyline).toBe(JSON.stringify([[26.71, 94.17], [26.72, 94.18]]));
    expect(row?.distanceM).toBe(2800);
    expect(row?.legacyMongoId).toBe(rid);
  });

  it("missing label → 'Legacy route'; empty/missing coords → null (polyline NOT NULL)", () => {
    expect(transformRoute({ _id: rid, user_id: uid, coords: [[1, 2]] })?.name).toBe("Legacy route");
    expect(transformRoute({ _id: rid, user_id: uid, coords: [] })).toBeNull();
    expect(transformRoute({ _id: rid, user_id: uid })).toBeNull();
  });
});
