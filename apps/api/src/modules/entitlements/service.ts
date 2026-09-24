// P2.4 — the keystone (v1 §6.1): effectivePlan(userId). "Nothing else in the
// codebase is allowed to reason about billing" (v1 §8) — every gate, quota,
// library filter, and history window calls THIS. Cached in Redis 60s, busted
// on billing/membership events (§4.1); the cache adapter fails soft, so a
// Redis outage degrades to per-request DB resolution, never an error.
import type { Sql } from "postgres";
import { z } from "zod";
import { entitlementsSchema, type Entitlements, type EntitlementsMe, type OwnPlanExtra, type YourPlan } from "@app/shared";
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
    // Cache is external input (R2.3): a corrupt/old-format/manually-poked
    // value must NOT throw out of the resolver (T3 P2.4 — that would 500
    // /me, the history gate, and the coach fail-open path). Any parse or
    // schema failure is treated as a miss → DB re-resolve + re-cache below.
    let raw: unknown = null;
    try {
      raw = JSON.parse(hit);
    } catch {
      raw = null;
    }
    const parsed = cachedSchema.safeParse(raw);
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

const meterBeats = (own: Entitlements["meal_scan"], gym: Entitlements["meal_scan"]): boolean =>
  own.window === gym.window ? own.limit > gym.limit : own.window === "day" && own.limit > 0;

/** What a person's own plan gives beyond a gym's member plan — each feature where the
 *  own one is better, in the terms `mergeEqualRank` uses to call one better. The chat
 *  coach is left out: it is switched off (RULINGS 2026-08-18), so naming it would be a
 *  feature nobody can use. Pure; exported for its table test. */
export function ownPlanExtras(own: Entitlements, gym: Entitlements): OwnPlanExtra[] {
  const extras: OwnPlanExtra[] = [];
  if (meterBeats(own.meal_scan, gym.meal_scan)) extras.push({ feature: "meal_scan", own: own.meal_scan, gym: gym.meal_scan });
  if (meterBeats(own.route_gen, gym.route_gen)) extras.push({ feature: "route_gen", own: own.route_gen, gym: gym.route_gen });
  if (gym.history_days !== -1 && (own.history_days === -1 || own.history_days > gym.history_days)) {
    extras.push({ feature: "history", ownDays: own.history_days === -1 ? null : own.history_days, gymDays: gym.history_days });
  }
  if (own.exercises.mode === "all" && gym.exercises.mode !== "all") extras.push({ feature: "all_exercises" });
  if (own.programs === "all" && gym.programs !== "all") extras.push({ feature: "all_programs" });
  if (own.global_leaderboards && !gym.global_leaderboards) extras.push({ feature: "global_leaderboards" });
  if (!own.share_watermark && gym.share_watermark) extras.push({ feature: "no_watermark" });
  return extras;
}

/** For each gym, what the person's own plan still adds once they join it; null for a
 *  person with no plan of their own, and no entry for a gym with no live plan. */
export async function yourPlansAt(sql: Sql, userId: string, gymIds: readonly string[]): Promise<Map<string, YourPlan>> {
  const own = await repo.getOwnPlans(sql, userId);
  if (own.length === 0 || gymIds.length === 0) return new Map();
  const [freeDoc, gyms] = await Promise.all([repo.getFreePlanDoc(sql), repo.getGymMemberDocs(sql, gymIds)]);
  const ownMerged = mergeEntitlements(
    freeDoc,
    own.map((row) => ({ rank: row.rank, entitlements: row.entitlements ?? {}, memberEntitlements: null })),
  ).entitlements;
  const cancelAt = own.every((row) => row.provider === "revenuecat") ? "app_store" : "where_bought";
  const plans = new Map<string, YourPlan>();
  for (const [gymId, gym] of gyms) {
    const gymMerged = mergeEntitlements(freeDoc, [{ rank: gym.rank, entitlements: null, memberEntitlements: gym.memberEntitlements }]).entitlements;
    plans.set(gymId, { extras: ownPlanExtras(ownMerged, gymMerged), cancelAt });
  }
  return plans;
}

/** §4.1/§10 bust seam — call on ANY billing or membership change. Today's
 *  callers: account deletion (memberships close); P3/gyms add the rest. */
export async function bustEntitlements(redis: RedisLike, userId: string): Promise<void> {
  await redis.del(cacheKey(userId));
}
