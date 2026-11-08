// P2.4 — quota middleware, generalizing quotas.py (v1 §6.1: "limits read
// from plan entitlements; Redis atomic counters; fail-open/closed per
// feature (keep your philosophy verbatim)"). Ported doctrine (quotas.py:7-11):
//   · cheap features fail OPEN when Redis is down — availability wins,
//     worst case a few dollars (the chat coach was the one; deleted
//     2026-10-15, so none does today);
//   · expensive features (meal_scan vision, route_gen ORS) fail CLOSED —
//     an unmetered hour of these is the actual bankruptcy scenario.
// Increment-before-run (quotas.py:43-46): one atomic Redis op counts the use
// before the work runs; a use refused over the limit is taken off again, and a
// route whose work then fails through no fault of the person's gives the use
// back with refundQuota (Part 8 §5.3).
// Keys per v1 §7.2: quota:{feature}:{user}:{yyyymmdd} (day) / :{yyyymm}
// (month); quotas stay UTC (Part 4 §3.1 note).
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { MeteredFeatureName, MeteredWindow } from "./schemas.js";
import type { RedisLike } from "../../redis.js";
import { getEntitlements } from "../entitlements/service.js";
import { recordUse, unrecordUse } from "./repo.js";

// quotas.py:8-11 policy, verbatim.
const FAIL_OPEN: Record<MeteredFeatureName, boolean> = {
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

/** A use counted for a request: its Redis key, and its row in metered_uses (ROADMAP 14a-ii). */
export interface CountedUse {
  key: string;
  useId: string;
}

/** preHandler factory — MUST be listed after app.authenticate (R3.3 order:
 *  authn → … → entitlement → quota). Wired to the meal and route routes. `onCounted` hears the use a
 *  request counted, for refundUse. Each counted use is also written down with when (metered_uses), so
 *  the admin page reads it day by day; a use that cannot be written down is not counted either. */
export function requireQuota(
  feature: MeteredFeatureName,
  deps: QuotaDeps,
  onCounted?: (req: FastifyRequest, use: CountedUse) => void,
) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const userId = req.authUser?.id;
    if (userId === undefined) throw new Error("requireQuota must run after app.authenticate");
    const now = (deps.now ?? (() => new Date()))();

    const { entitlements } = await getEntitlements(deps, userId);
    const { window, limit } = entitlements[feature];

    const key = quotaKey(feature, userId, window, now);
    const count = await deps.redis.incrWithTtl(key, window === "day" ? DAY_TTL_S : MONTH_TTL_S);

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
      // A refused try leaves the count as it found it, so a use given back later
      // (refundQuota) can be used again.
      if ((await deps.redis.decrIfPositive(key)) !== true) {
        req.log.warn({ event: "quota.refusal_not_uncounted", feature, userId }, "a refused use stayed counted");
      }
      await reply.status(429).send({
        error: "quota_exceeded",
        message: `You've used all ${String(limit)} ${feature} uses for this ${window}.`,
        resetsAt: resetsAt(window, now),
        requestId: req.id,
      });
      return;
    }
    let useId: string;
    try {
      useId = await recordUse(deps.sql, feature, userId, now);
    } catch (err) {
      await deps.redis.decrIfPositive(key);
      throw err;
    }
    onCounted?.(req, { key, useId });
  };
}

/** Gives back one use counted under `key` (the key requireQuota's onCounted
 *  heard): work that failed through no fault of the person's costs them nothing
 *  (Part 8 §5.3, "no quota consumed on failures"). The counter keeps its window
 *  and never goes below zero, and a window that has ended is not brought back.
 *  false = nothing given back (Redis down, or nothing left counted). */
export async function refundQuota(redis: RedisLike, key: string): Promise<boolean> {
  return (await redis.decrIfPositive(key)) === true;
}

/** Gives back a counted use (refundQuota) and, once it is given back, takes its row out of
 *  metered_uses: the admin page counts what the person's limit counts. The use is given back
 *  whether or not its row goes: a row that could not be taken out is logged, never a failed scan's
 *  own answer turned into a fault. */
export async function refundUse(
  deps: { sql: Sql; redis: RedisLike; log: { warn: (obj: object, msg: string) => void } },
  userId: string,
  use: CountedUse,
): Promise<boolean> {
  if (!(await refundQuota(deps.redis, use.key))) return false;
  try {
    await unrecordUse(deps.sql, userId, use.useId);
  } catch (err) {
    deps.log.warn({ event: "quota.unrecord_failed", userId, err }, "a use given back is still written down");
  }
  return true;
}

/** How many uses a person has left of what their plan allows, read without counting one. Null where
 *  the count cannot be read: an empty read is no use yet, unless Redis itself does not answer. */
export async function quotaLeft(
  feature: MeteredFeatureName,
  deps: QuotaDeps,
  userId: string,
): Promise<{ window: MeteredWindow; limit: number; left: number | null }> {
  const now = (deps.now ?? (() => new Date()))();
  const { entitlements } = await getEntitlements(deps, userId);
  const { window, limit } = entitlements[feature];
  const held = await deps.redis.get(quotaKey(feature, userId, window, now));
  if (held === null && !(await deps.redis.setex(`quota:reachable:${userId}`, 60, "1"))) return { window, limit, left: null };
  const used = held === null ? 0 : Number(held);
  return { window, limit, left: Number.isSafeInteger(used) ? Math.max(0, limit - used) : null };
}
