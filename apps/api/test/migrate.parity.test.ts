// P2.7f — pure test for the per-user parity comparison (the §7 deep gate's
// core). The DB-touching verifyParity is exercised by the migration PROVE
// (run.ts --verify-only); this locks the mismatch-detection logic.
import { describe, expect, it } from "vitest";
import { comparePerUser } from "../tools/migrate-mongo/verify.js";

describe("comparePerUser", () => {
  it("returns no mismatch when every user's counts are equal", () => {
    const mongo = new Map([["u1", 3], ["u2", 5]]);
    const pg = new Map([["u1", 3], ["u2", 5]]);
    expect(comparePerUser("workouts", mongo, pg)).toEqual([]);
  });

  it("flags a user whose counts differ (a mis-attributed row that keeps the total)", () => {
    // total is 8 on both sides, but u1/u2 are swapped by one → caught per-user
    const mongo = new Map([["u1", 3], ["u2", 5]]);
    const pg = new Map([["u1", 4], ["u2", 4]]);
    const out = comparePerUser("workouts", mongo, pg);
    expect(out).toEqual([
      { entity: "workouts", userId: "u1", mongo: 3, pg: 4 },
      { entity: "workouts", userId: "u2", mongo: 5, pg: 4 },
    ]);
  });

  it("treats a user missing on one side as count 0", () => {
    const mongo = new Map([["u1", 2]]);
    const pg = new Map<string, number>();
    expect(comparePerUser("meals", mongo, pg)).toEqual([{ entity: "meals", userId: "u1", mongo: 2, pg: 0 }]);

    const pgExtra = new Map([["u9", 1]]);
    expect(comparePerUser("runs", new Map<string, number>(), pgExtra)).toEqual([
      { entity: "runs", userId: "u9", mongo: 0, pg: 1 },
    ]);
  });

  it("stamps the entity name so mixed mismatches are attributable", () => {
    const out = comparePerUser("coach_messages", new Map([["u1", 1]]), new Map([["u1", 2]]));
    expect(out[0]?.entity).toBe("coach_messages");
  });
});
