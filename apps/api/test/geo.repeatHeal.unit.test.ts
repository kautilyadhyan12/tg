// A run sent again (37o, round one H4): its streak, badges and XP are worked out again, and whatever that work does the
// answer is the run's own row. Before, a fault in that work made every repeat of a stored run fail, and the phone, after
// ten minutes, called a run that is in Your runs "couldn't be saved".
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";

const heal = vi.fn<() => Promise<unknown>>();
vi.mock("../src/modules/gamification/service.js", () => ({ onWorkoutSynced: () => heal() }));
vi.mock("../src/modules/users/service.js", () => ({
  getUserSyncContext: () => Promise.resolve({ timezone: "Asia/Kolkata", weightKg: 70 }),
  getUserPlanAndCutRules: () => Promise.resolve(null),
}));
const row = {
  id: "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", startedAt: new Date("2026-11-27T05:00:00Z"), name: "Morning Run", effort: null, note: null,
  distanceM: 1200, movingS: 420, elapsedS: 430, leftOutM: 0, leftOutS: 0, kcal: 90, splits: null, polyline: null, climbM: null, heart: null,
};
vi.mock("../src/modules/geo/repo.js", () => ({
  getSavedRun: () => Promise.resolve(row),
  wasRunRemoved: () => Promise.resolve(false),
}));

const { savedRunIfAny } = await import("../src/modules/geo/service.js");

describe("a run sent again", () => {
  const logged: unknown[] = [];
  const deps = { sql: {} as Sql, log: { error: (o: unknown) => logged.push(o) } };
  beforeEach(() => {
    heal.mockReset();
    logged.length = 0;
  });

  it("is answered from its row when the streak, badges and XP work fails, and the failure is logged with the person's id only", async () => {
    heal.mockRejectedValue(new TypeError("a broken badge row"));
    const answer = await savedRunIfAny(deps, "7b0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6a", row.id);
    expect(answer).not.toBeNull();
    expect(answer).not.toBe("removed");
    expect(answer).toMatchObject({ id: row.id, name: "Morning Run", distanceM: 1200 });
    expect(heal).toHaveBeenCalledTimes(1);
    expect(logged).toEqual([{ event: "geo.run_repeat_heal_failed", userId: "7b0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6a", errName: "TypeError" }]);
  });

  it("works them out again when it can, and logs nothing", async () => {
    heal.mockResolvedValue({ current: 1 });
    expect(await savedRunIfAny(deps, "7b0c8a52-6f0e-4d59-9a3c-1f2e3d4c5b6a", row.id)).toMatchObject({ id: row.id });
    expect(heal).toHaveBeenCalledTimes(1);
    expect(logged).toEqual([]);
  });
});
