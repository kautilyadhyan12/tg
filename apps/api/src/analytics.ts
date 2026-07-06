// PostHog server-side analytics (v1 §16). Dormant no-op without POSTHOG_API_KEY
// (same posture as Sentry): zero cost, zero network calls until a key exists.
// Event names are the v1 §16 starter taxonomy — a closed union so modules
// cannot invent ad-hoc strings; extending it is a one-line, reviewable change.
import { PostHog } from "posthog-node";
import type { AppConfig } from "./config.js";

export type AnalyticsEvent =
  | "signup"
  | "workout_started"
  | "workout_completed"
  | "exercise_completed"
  | "paywall_viewed"
  | "subscribe_activated"
  | "coach_msg_sent"
  | "meal_logged"
  | "gym_code_redeemed"
  | "gym_trial_started"
  | "gym_converted"
  | "share_card_created"
  | "app_installed_from_web_prompt";

export interface Analytics {
  capture(distinctId: string, event: AnalyticsEvent, properties?: Record<string, unknown>): void;
  shutdown(): Promise<void>;
}

const noop: Analytics = {
  capture() {
    // dormant: no key configured
  },
  async shutdown() {
    // nothing to flush
  },
};

export function createAnalytics(config: AppConfig): Analytics {
  if (config.POSTHOG_API_KEY === undefined) {
    return noop;
  }
  const client = new PostHog(config.POSTHOG_API_KEY, { host: config.POSTHOG_HOST });
  return {
    capture(distinctId, event, properties) {
      client.capture({ distinctId, event, properties: properties ?? {} });
    },
    async shutdown() {
      await client.shutdown();
    },
  };
}
