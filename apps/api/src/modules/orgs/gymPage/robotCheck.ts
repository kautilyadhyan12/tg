// The robot check on a gym page's enquiry form: Cloudflare Turnstile (ROADMAP 20c-iv-a;
// RULINGS 2026-09-28). The page's widget gives the browser a token; the server asks
// Cloudflare's Siteverify once whether it passed. Only the token and our secret are
// sent — never the person's details or address.
//
// Outside production, with no keys set, Cloudflare's own test pair stands in: its site
// key draws a widget that always passes, and its secret accepts only that widget's
// dummy token (developers.cloudflare.com/turnstile/troubleshooting/testing, read
// 2026-09-28).
import { robotCheckReplySchema } from "@app/shared";
import type { AppConfig } from "../../../config.js";

export const TEST_SITE_KEY = "1x00000000000000000000AA";
export const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Siteverify answers in well under a second; past this the person is asked to try again. */
const TIMEOUT_MS = 5000;

export type RobotCheckAnswer = "passed" | "failed" | "unavailable";

export interface RobotCheck {
  /** Public: the widget on the page draws with it. */
  siteKey: string;
  verify(token: string): Promise<RobotCheckAnswer>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

export function createRobotCheck(
  config: Pick<AppConfig, "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY">,
  fetchImpl: FetchLike = fetch,
): RobotCheck {
  const siteKey = config.TURNSTILE_SITE_KEY ?? TEST_SITE_KEY;
  const secret = config.TURNSTILE_SECRET_KEY ?? TEST_SECRET_KEY;
  return {
    siteKey,
    async verify(token: string): Promise<RobotCheckAnswer> {
      let reply: unknown;
      try {
        const res = await fetchImpl(SITEVERIFY_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret, response: token }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return "unavailable";
        reply = await res.json();
      } catch {
        return "unavailable";
      }
      const parsed = robotCheckReplySchema.safeParse(reply);
      if (!parsed.success) return "unavailable";
      if (parsed.data.success) return "passed";
      // Cloudflare's own fault, not the person's: they may try again.
      return parsed.data["error-codes"]?.includes("internal-error") === true ? "unavailable" : "failed";
    },
  };
}
