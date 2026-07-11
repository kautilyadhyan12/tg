// P2.4 — quota middleware, generalizing quotas.py (v1 §6.1: "limits read
// from plan entitlements; Redis atomic counters; fail-open/closed per
// feature (keep your philosophy verbatim)"). Ported doctrine (quotas.py:7-11):
//   · cheap features (coach) fail OPEN when Redis is down — availability
//     wins, worst case a few dollars;
//   · expensive features (meal_scan vision, route_gen ORS) fail CLOSED —
//     an unmetered hour of these is the actual bankruptcy scenario.
// Increment-before-run (quotas.py:43-46): a request that fails later still
// consumed a slot — acceptable, keeps it one atomic Redis op.
// Keys per v1 §7.2: quota:{feature}:{user}:{yyyymmdd} (day) / :{yyyymm}
// (month); quotas stay UTC (Part 4 §3.1 note).
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { MeteredFeatureName, MeteredWindow } from "./schemas.js";
import type { RedisLike } from "../../redis.js";
import { getEntitlements } from "../entitlements/service.js";

// quotas.py:8-11 policy, verbatim.
const FAIL_OPEN: Record<MeteredFeatureName, boolean> = {
  coach: true,
  meal_scan: false,
  route_gen: false,
};

// quotas.py:27 — +60s slack so the key outlives its window.
const DAY_TTL_S = 24 * 60 * 60 + 60;
const MONTH_TTL_S = 32 * 24 * 60 * 60 + 60; // key embeds the month; TTL just outlives it

const pad = (n: number) => String(n).padStart(2, "0");

export function quotaKey(feature: string, userId: string, window: MeteredWindow, now: Date): string {
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const bucket = window === "day" ? `${String(y)}${m}${pad(now.getUTCDate())}` : `${String(y)}${m}`;
  return `quota:${feature}:${userId}:${bucket}`;
}

/** Next UTC reset instant for the friendly 429 (v1 §9.3: "resets tomorrow"). */
export function resetsAt(window: MeteredWindow, now: Date): string {
  const next =
    window === "day"
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return new Date(next).toISOString();
}

export interface QuotaDeps {
  sql: Sql;
  redis: RedisLike;
  /** Injectable clock: quota-window unit tests never sleep. */
  now?: () => Date;
}

/** preHandler factory — MUST be listed after app.authenticate (R3.3 order:
 *  authn → … → entitlement → quota). Wired to coach/meal/route routes when
 *  those modules land (P2.5/P2.6). */
export function requireQuota(feature: MeteredFeatureName, deps: QuotaDeps) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("requireQuota must run after app.authenticate");
    const now = (deps.now ?? (() => new Date()))();

    const { entitlements } = await getEntitlements(deps, userId);
    const { window, limit } = entitlements[feature];

    const count = await deps.redis.incrWithTtl(
      quotaKey(feature, userId, window, now),
      window === "day" ? DAY_TTL_S : MONTH_TTL_S,
    );

    if (count === null) {
      // Redis down — cannot meter (quotas.py:49-58).
      if (FAIL_OPEN[feature]) {
        req.log.warn({ event: "quota.skipped_redis_down", feature, userId }, "quota check skipped");
        return;
      }
      req.log.error({ event: "quota.refused_redis_down", feature, userId }, "quota refused");
      await reply.status(503).send({
        error: "quota_unavailable",
        message: "This feature is temporarily unavailable. Please try again in a few minutes.",
        requestId: req.id,
      });
      return;
    }

    if (count > limit) {
      await reply.status(429).send({
        error: "quota_exceeded",
        message: `You've used all ${String(limit)} ${feature} uses for this ${window}.`,
        resetsAt: resetsAt(window, now),
        requestId: req.id,
      });
    }
  };
}
