// Kd's own number a day on top of every kind of plan (ROADMAP Stage 2 item 14a-i): what he sets is
// what the person gets of that feature, higher or lower, until he takes it back; nothing else of
// their plan moves. Every class of case, through the same merge the plan check runs.
import { describe, expect, it } from "vitest";
import { applyOwnLimits, mergeEntitlements } from "../src/modules/entitlements/service.js";

const free = {
  exercises: { mode: "tier", tier: "T1" },
  meal_scan: { window: "month", limit: 3 },
  route_gen: { window: "month", limit: 2 },
  history_days: 90,
  programs: "starter",
  global_leaderboards: false,
  share_watermark: true,
};
const pro = { ...free, exercises: { mode: "all" }, meal_scan: { window: "day", limit: 15 }, route_gen: { window: "day", limit: 2 }, history_days: -1, programs: "all", global_leaderboards: true, share_watermark: false };
const gymMember = { ...pro, meal_scan: { window: "day", limit: 7 } };

const plans = {
  "no plan": [],
  "a gym member": [{ rank: 10, entitlements: null, memberEntitlements: gymMember }],
  "the $10 plan": [{ rank: 10, entitlements: pro, memberEntitlements: null }],
  "a gym member with the $10 plan": [
    { rank: 10, entitlements: null, memberEntitlements: gymMember },
    { rank: 10, entitlements: pro, memberEntitlements: null },
  ],
} as const;
const planScans = { "no plan": { window: "month", limit: 3 }, "a gym member": { window: "day", limit: 7 }, "the $10 plan": { window: "day", limit: 15 }, "a gym member with the $10 plan": { window: "day", limit: 15 } };
const planRoutes = { "no plan": { window: "month", limit: 2 }, "a gym member": { window: "day", limit: 2 }, "the $10 plan": { window: "day", limit: 2 }, "a gym member with the $10 plan": { window: "day", limit: 2 } };

const settings = [
  { said: "none set", own: { mealScan: null, routeGen: null } },
  { said: "15 scans", own: { mealScan: 15, routeGen: null } },
  { said: "3 scans (lower than most plans)", own: { mealScan: 3, routeGen: null } },
  { said: "0 scans", own: { mealScan: 0, routeGen: null } },
  { said: "100 scans", own: { mealScan: 100, routeGen: null } },
  { said: "5 route plans", own: { mealScan: null, routeGen: 5 } },
  { said: "0 route plans", own: { mealScan: null, routeGen: 0 } },
  { said: "both", own: { mealScan: 20, routeGen: 4 } },
] as const;

describe("Kd's own number a day, on every kind of plan", () => {
  for (const [plan, candidates] of Object.entries(plans) as [keyof typeof plans, (typeof plans)[keyof typeof plans]][]) {
    for (const { said, own } of settings) {
      it(`${plan}, ${said}`, () => {
        const merged = mergeEntitlements(free, [...candidates]);
        const got = applyOwnLimits(merged.entitlements, own);
        expect(got.meal_scan).toEqual(own.mealScan === null ? planScans[plan] : { window: "day", limit: own.mealScan });
        expect(got.route_gen).toEqual(own.routeGen === null ? planRoutes[plan] : { window: "day", limit: own.routeGen });
        // Nothing else of the plan moves.
        expect({ ...got, meal_scan: null, route_gen: null }).toEqual({ ...merged.entitlements, meal_scan: null, route_gen: null });
      });
    }
  }
});
