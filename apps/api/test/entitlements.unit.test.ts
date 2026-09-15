// P2.4 — PURE unit tests: §4.1 merge rule, quota key/reset math, and the
// in-memory Redis adapter semantics (fake clock — no sleeps).
import { describe, expect, it } from "vitest";
import { mergeEntitlements } from "../src/modules/entitlements/service.js";
import { quotaKey, resetsAt } from "../src/modules/quotas/service.js";
import { createMemoryRedis } from "../src/redis.js";

// The Part 4 §3.3 seed documents, as fixtures.
const FREE_DOC = {
  exercises: { mode: "tier", tier: "T1" },
  coach: { window: "month", limit: 5 },
  meal_scan: { window: "month", limit: 3 },
  route_gen: { window: "month", limit: 2 },
  history_days: 90,
  programs: "starter",
  global_leaderboards: false,
  share_watermark: true,
};
const PRO_DOC = {
  exercises: { mode: "all" },
  coach: { window: "day", limit: 30 },
  meal_scan: { window: "day", limit: 8 },
  route_gen: { window: "day", limit: 5 },
  history_days: -1,
  programs: "all",
  global_leaderboards: true,
  share_watermark: false,
};

describe("entitlements merge (Part 4 §4.1 + GAP-1)", () => {
  it("no candidates → the free document, source 'free'", () => {
    const r = mergeEntitlements(FREE_DOC, []);
    expect(r.source).toBe("free");
    expect(r.entitlements.coach).toEqual({ window: "month", limit: 5 });
    expect(r.entitlements.history_days).toBe(90);
  });

  it("own Pro replaces feature blocks wholesale (GAP-1: no cross-window max)", () => {
    const r = mergeEntitlements(FREE_DOC, [
      { rank: 10, entitlements: PRO_DOC, memberEntitlements: null },
    ]);
    expect(r.source).toBe("own_subscription");
    expect(r.entitlements.coach).toEqual({ window: "day", limit: 30 });
    expect(r.entitlements.history_days).toBe(-1);
    expect(r.entitlements.exercises).toEqual({ mode: "all" });
    expect(r.entitlements.share_watermark).toBe(false);
  });

  it("gym member_entitlements grant with source 'gym_membership'", () => {
    const r = mergeEntitlements(FREE_DOC, [
      { rank: 10, entitlements: null, memberEntitlements: PRO_DOC },
    ]);
    expect(r.source).toBe("gym_membership");
    expect(r.entitlements.meal_scan).toEqual({ window: "day", limit: 8 });
  });

  it("equal-rank tie merges per-key: max limit, OR booleans, all>tier, no-watermark wins", () => {
    const gymDoc = { ...PRO_DOC, coach: { window: "day", limit: 10 }, share_watermark: true };
    const r = mergeEntitlements(FREE_DOC, [
      { rank: 10, entitlements: PRO_DOC, memberEntitlements: null },
      { rank: 10, entitlements: null, memberEntitlements: gymDoc },
    ]);
    expect(r.source).toBe("own_subscription"); // own wins the label on ties
    expect(r.entitlements.coach.limit).toBe(30);
    expect(r.entitlements.share_watermark).toBe(false);
    expect(r.entitlements.exercises).toEqual({ mode: "all" });
  });

  it("equal-rank tie across DIFFERENT windows: the day-window block wins (GAP-1)", () => {
    const monthDoc = { ...PRO_DOC, coach: { window: "month", limit: 100 } };
    const r = mergeEntitlements(FREE_DOC, [
      { rank: 10, entitlements: PRO_DOC, memberEntitlements: null },
      { rank: 10, entitlements: monthDoc, memberEntitlements: null },
    ]);
    expect(r.entitlements.coach).toEqual({ window: "day", limit: 30 });
  });

  it("higher rank beats lower rank outright", () => {
    const r = mergeEntitlements(FREE_DOC, [
      { rank: 10, entitlements: PRO_DOC, memberEntitlements: null },
      { rank: 0, entitlements: FREE_DOC, memberEntitlements: null },
    ]);
    expect(r.entitlements.coach.limit).toBe(30);
  });

  it("sparse candidate docs fall back to free values per key (R6.5 defaults)", () => {
    const r = mergeEntitlements(FREE_DOC, [
      { rank: 10, entitlements: { history_days: -1 }, memberEntitlements: null },
    ]);
    expect(r.entitlements.history_days).toBe(-1);
    expect(r.entitlements.coach).toEqual({ window: "month", limit: 5 }); // default = free
    expect(r.entitlements.share_watermark).toBe(true);
  });
});

describe("quota key/reset math (v1 §7.2/§9.3, UTC)", () => {
  const now = new Date("2026-07-11T18:30:00Z");
  it("day and month buckets", () => {
    expect(quotaKey("coach", "u1", "day", now)).toBe("quota:coach:u1:20260711");
    expect(quotaKey("coach", "u1", "month", now)).toBe("quota:coach:u1:202607");
  });
  it("resets at next UTC midnight / first of next month", () => {
    expect(resetsAt("day", now)).toBe("2026-07-12T00:00:00.000Z");
    expect(resetsAt("month", now)).toBe("2026-08-01T00:00:00.000Z");
    expect(resetsAt("month", new Date("2026-12-05T00:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("in-memory Redis adapter", () => {
  it("incrWithTtl counts within the window and resets after expiry (fake clock)", async () => {
    let t = 1_000_000;
    const r = createMemoryRedis(() => t);
    expect(await r.incrWithTtl("k", 60)).toBe(1);
    expect(await r.incrWithTtl("k", 60)).toBe(2);
    t += 61_000; // window passed
    expect(await r.incrWithTtl("k", 60)).toBe(1);
  });
  it("decrIfPositive takes one off a live counter above zero and keeps its window; never below zero, never a counter that is gone", async () => {
    let t = 1_000_000;
    const r = createMemoryRedis(() => t);
    expect(await r.decrIfPositive("k")).toBe(false);
    expect(await r.get("k")).toBeNull();
    await r.incrWithTtl("k", 60);
    await r.incrWithTtl("k", 60);
    expect(await r.decrIfPositive("k")).toBe(true);
    expect(await r.get("k")).toBe("1");
    expect(await r.decrIfPositive("k")).toBe(true);
    expect(await r.decrIfPositive("k")).toBe(false);
    expect(await r.get("k")).toBe("0");
    t += 59_000; // still the window the first count opened
    expect(await r.incrWithTtl("k", 60)).toBe(1);
    t += 1_000; // that window has ended: nothing to take off, and nothing made
    expect(await r.decrIfPositive("k")).toBe(false);
    expect(await r.get("k")).toBeNull();
    r.down = true;
    expect(await r.decrIfPositive("k")).toBeNull();
  });
  it("down switch simulates an outage: every op degrades to null/no-op", async () => {
    const r = createMemoryRedis();
    await r.setex("k", 60, "v");
    r.down = true;
    expect(await r.incrWithTtl("k2", 60)).toBeNull();
    expect(await r.get("k")).toBeNull();
    r.down = false;
    expect(await r.get("k")).toBe("v");
  });
});
