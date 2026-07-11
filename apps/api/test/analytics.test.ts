// P0.5: analytics wrapper — dormant without a key; typed event taxonomy.
import { describe, expect, it } from "vitest";
import { createAnalytics, type AnalyticsEvent } from "../src/analytics.js";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  DATABASE_URL: "postgres://user:pw@localhost:5432/db",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "analytics-test-secret-0123456789abcd-32", // required since P2.1
};

describe("analytics", () => {
  it("no-op mode: capture and shutdown never throw without a key", async () => {
    const analytics = createAnalytics(loadConfig(baseEnv));
    expect(() => {
      analytics.capture("user-1", "workout_started", { platform: "web" });
    }).not.toThrow();
    await expect(analytics.shutdown()).resolves.toBeUndefined();
  });

  it("config defaults POSTHOG_HOST and accepts an optional key", () => {
    const c = loadConfig(baseEnv);
    expect(c.POSTHOG_HOST).toBe("https://app.posthog.com");
    expect(c.POSTHOG_API_KEY).toBeUndefined();
    const withKey = loadConfig({ ...baseEnv, POSTHOG_API_KEY: "phc_test" });
    expect(withKey.POSTHOG_API_KEY).toBe("phc_test");
  });

  it("event union covers the v1 §16 starter taxonomy (compile-time gate)", () => {
    const taxonomy: AnalyticsEvent[] = [
      "signup",
      "workout_started",
      "workout_completed",
      "exercise_completed",
      "paywall_viewed",
      "subscribe_activated",
      "coach_msg_sent",
      "meal_logged",
      "gym_code_redeemed",
      "gym_trial_started",
      "gym_converted",
      "share_card_created",
      "app_installed_from_web_prompt",
    ];
    // @ts-expect-error unknown event names must not compile — the union is closed
    const bad: AnalyticsEvent = "made_up_event";
    expect(taxonomy).toHaveLength(13);
    expect(bad).toBe("made_up_event");
  });
});
