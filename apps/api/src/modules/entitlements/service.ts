// P2.4 — the keystone (v1 §6.1): effectivePlan(userId). "Nothing else in the
// codebase is allowed to reason about billing" (v1 §8) — every gate, quota,
// library filter, and history window calls THIS. Cached in Redis 60s, busted
// on billing/membership events (§4.1); the cache adapter fails soft, so a
// Redis outage degrades to per-request DB resolution, never an error.
import type { Sql } from "postgres";
import { z } from "zod";
import { entitlementsSchema, type Entitlements, type EntitlementsMe } from "@app/shared";
import type { RedisLike } from "../../redis.js";
import * as repo from "./repo.js";

export interface EntitlementsDeps {
  sql: Sql;
  redis: RedisLike;
}

const CACHE_TTL_S = 60; // §4.1: "cache Redis 60 s"
const cacheKey = (userId: string) => `ent:${userId}`;

type Source = EntitlementsMe["source"];

/** Feature blocks a higher-rank candidate replaces WHOLESALE; per-key
 *  max/OR only between EQUAL-rank candidates (DECISIONS P2.4 GAP-1 — raw
 *  numeric max across day-vs-month windows is meaningless). */
function mergeEqualRank(a: Entitlements, b: Entitlements): Entitlements {
  const metered = (
    x: Entitlements["coach"],
    y: Entitlements["coach"],
  ): Entitlements["coach"] => {
    if (x.window === y.window) return { window: x.window, limit: Math.max(x.limit, y.limit) };
    return x.window === "day" ? x : y; // day-window plans are the generous tier
  };
  return {
    exercises: a.exercises.mode === "all" || b.exercises.mode === "all" ? { mode: "all" } : a.exercises,
    coach: metered(a.coach, b.coach),
    meal_scan: metered(a.meal_scan, b.meal_scan),
    route_gen: metered(a.route_gen, b.route_gen),
    history_days:
      a.history_days === -1 || b.history_days === -1
        ? -1
        : Math.max(a.history_days, b.history_days),
    programs: a.programs === "all" || b.programs === "all" ? "all" : "starter",
    global_leaderboards: a.global_leaderboards || b.global_leaderboards,
    share_watermark: a.share_watermark && b.share_watermark, // no-watermark wins
  };
}

/** Pure §4.1 merge: free base, overlay the highest-rank candidates. Exported
 *  for the unit suite. */
export function mergeEntitlements(
  freeDoc: unknown,
  candidates: repo.CandidateRow[],
): { entitlements: Entitlements; source: Source } {
  const free = entitlementsSchema.parse(freeDoc ?? {});
  if (candidates.length === 0) return { entitlements: free, source: "free" };
  const topRank = Math.max(...candidates.map((c) => c.rank));
  const top = candidates.filter((c) => c.rank === topRank);
  let merged: Entitlements | null = null;
  let source: Source = "free";
  for (const c of top) {
    const doc = c.entitlements ?? c.memberEntitlements ?? {};
    const parsed = entitlementsSchema.parse(doc); // defaults fill gaps with free values (R6.5)
    merged = merged === null ? parsed : mergeEqualRank(merged, parsed);
    // Own subscription wins the label on ties (display hint only, R3.1).
    if (c.entitlements !== null) source = "own_subscription";
    else if (source !== "own_subscription") source = "gym_membership";
  }
  return { entitlements: merged ?? free, source };
}

const cachedSchema = z.object({
  entitlements: entitlementsSchema,
  source: z.enum(["free", "own_subscription", "gym_membership"]),
});

export async function getEntitlements(
  deps: EntitlementsDeps,
  userId: string,
): Promise<EntitlementsMe> {
  const hit = await deps.redis.get(cacheKey(userId));
  if (hit !== null) {
    const parsed = cachedSchema.safeParse(JSON.parse(hit)); // cache = external input (R2.3)
    if (parsed.success) return parsed.data;
  }
  const [freeDoc, candidates] = await Promise.all([
    repo.getFreePlanDoc(deps.sql),
    repo.getCandidates(deps.sql, userId),
  ]);
  const resolved = mergeEntitlements(freeDoc, candidates);
  await deps.redis.setex(cacheKey(userId), CACHE_TTL_S, JSON.stringify(resolved));
  return resolved;
}

/** §4.1/§10 bust seam — call on ANY billing or membership change. Today's
 *  callers: account deletion (memberships close); P3/gyms add the rest. */
export async function bustEntitlements(redis: RedisLike, userId: string): Promise<void> {
  await redis.del(cacheKey(userId));
}
