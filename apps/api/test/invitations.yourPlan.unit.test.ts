// What a person's own plan still adds over a gym's (ROADMAP 3b-ii-b; RULINGS 2026-09-23,
// gap D): every feature × better · equal · worse, and the words the Join screen shows.
import { describe, expect, it } from "vitest";
import { entitlementsSchema, ownPlanExtraWords, yourPlanWords, type Entitlements, type OwnPlanExtra } from "@app/shared";
import { ownPlanExtras } from "../src/modules/entitlements/service.js";

/** The seed's gym-member block (`db/seed.ts`). */
const GYM: Entitlements = entitlementsSchema.parse({
  exercises: { mode: "all" },
  coach: { window: "day", limit: 30 },
  meal_scan: { window: "day", limit: 7 },
  route_gen: { window: "day", limit: 2 },
  history_days: -1,
  programs: "all",
  global_leaderboards: true,
  share_watermark: false,
});
/** The seed's $10 block: the gym's but 20 scans. */
const PRO: Entitlements = { ...GYM, meal_scan: { window: "day", limit: 20 } };
/** The seed's free block. */
const FREE: Entitlements = entitlementsSchema.parse({
  exercises: { mode: "tier", tier: "T1" },
  coach: { window: "month", limit: 5 },
  meal_scan: { window: "day", limit: 1 },
  route_gen: { window: "month", limit: 2 },
  history_days: 90,
  programs: "starter",
  global_leaderboards: false,
  share_watermark: true,
});

describe("ownPlanExtras", () => {
  it("the seed's two plans: the $10 plan adds 13 meal scans a day and nothing else", () => {
    expect(ownPlanExtras(PRO, GYM)).toEqual([{ feature: "meal_scan", own: { window: "day", limit: 20 }, gym: { window: "day", limit: 7 } }]);
  });

  it("a plan equal to the gym's, or worse in every way, adds nothing", () => {
    expect(ownPlanExtras(GYM, GYM)).toEqual([]);
    expect(ownPlanExtras(FREE, GYM)).toEqual([]);
  });

  it("the chat coach is never named, however much more the own plan gives", () => {
    expect(ownPlanExtras({ ...GYM, coach: { window: "day", limit: 999 } }, GYM)).toEqual([]);
  });

  const better: [string, Partial<Entitlements>, OwnPlanExtra["feature"], Partial<Entitlements>][] = [
    ["meal_scan: more a day", { meal_scan: { window: "day", limit: 8 } }, "meal_scan", {}],
    ["meal_scan: a day's allowance beats a month's", { meal_scan: { window: "day", limit: 1 } }, "meal_scan", { meal_scan: { window: "month", limit: 30 } }],
    ["route_gen: more a day", { route_gen: { window: "day", limit: 3 } }, "route_gen", {}],
    ["history: all of it against 90 days", { history_days: -1 }, "history", { history_days: 90 }],
    ["history: more days", { history_days: 365 }, "history", { history_days: 90 }],
    ["every exercise", { exercises: { mode: "all" } }, "all_exercises", { exercises: { mode: "tier", tier: "T1" } }],
    ["every programme", { programs: "all" }, "all_programs", { programs: "starter" }],
    ["worldwide boards", { global_leaderboards: true }, "global_leaderboards", { global_leaderboards: false }],
    ["no watermark", { share_watermark: false }, "no_watermark", { share_watermark: true }],
  ];
  it.each(better)("%s", (_name, own, feature, gym) => {
    const extras = ownPlanExtras({ ...GYM, ...own }, { ...GYM, ...gym });
    expect(extras.map((extra) => extra.feature)).toEqual([feature]);
  });

  const notBetter: [string, Partial<Entitlements>][] = [
    ["meal_scan: fewer", { meal_scan: { window: "day", limit: 6 } }],
    ["meal_scan: a month's against the gym's day", { meal_scan: { window: "month", limit: 900 } }],
    ["meal_scan: none a day", { meal_scan: { window: "day", limit: 0 } }],
    ["history: fewer days than the gym's all", { history_days: 3650 }],
  ];
  it.each(notBetter)("not an extra — %s", (_name, own) => {
    expect(ownPlanExtras({ ...GYM, ...own }, GYM)).toEqual([]);
  });
});

describe("the words", () => {
  it("an extra reads as the person counts it", () => {
    expect(ownPlanExtraWords({ feature: "meal_scan", own: { window: "day", limit: 20 }, gym: { window: "day", limit: 7 } })).toBe(
      "20 meal scans a day instead of 7",
    );
    expect(ownPlanExtraWords({ feature: "meal_scan", own: { window: "day", limit: 1 }, gym: { window: "month", limit: 30 } })).toBe(
      "1 meal scan a day instead of 30 a month",
    );
    expect(ownPlanExtraWords({ feature: "history", ownDays: null, gymDays: 90 })).toBe("all of your history instead of the last 90 days");
  });

  it("the Join screen never says the gym covers it when the person's own plan still adds something", () => {
    const told = yourPlanWords("Iron House", {
      extras: [{ feature: "meal_scan", own: { window: "day", limit: 20 }, gym: { window: "day", limit: 7 } }],
      cancelAt: "app_store",
    });
    expect(told.lead).toBe(
      "You pay for your own plan. Once you join, Iron House gives you the app's features, and your own plan still adds 20 meal scans a day instead of 7.",
    );
    expect(told.lead).not.toMatch(/everything/);
    expect(told.cancel).toBe("If you don't need that, only you can cancel it, in your phone's App Store or Google Play subscriptions.");
  });

  it("with nothing added it says so, and where to cancel", () => {
    expect(yourPlanWords("Iron House", { extras: [], cancelAt: "where_bought" })).toEqual({
      lead: "You pay for your own plan. Once you join, Iron House gives you everything your own plan does.",
      cancel: "If you no longer need it, only you can cancel it, where you bought it.",
    });
  });

  it("several extras are listed with commas and 'and'", () => {
    const { lead } = yourPlanWords("Iron House", {
      extras: [{ feature: "all_exercises" }, { feature: "all_programs" }, { feature: "no_watermark" }],
      cancelAt: "where_bought",
    });
    expect(lead).toContain("still adds every exercise, every programme and sharing without the watermark.");
  });
});
