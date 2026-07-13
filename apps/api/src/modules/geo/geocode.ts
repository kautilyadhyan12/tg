// P2.6b — the two-layer geocode cache (v1 §6.1 "cache is mandatory", §7.2
// `geo:{lat3}:{lng3}`). Redis LRU over the geo_cache Postgres floor, keyed on
// coords rounded to 3 decimals (≈110 m). Coords → place name (reverse
// geocoding).
//
// G1 ruling (DECISIONS 2026-07-13): this seam ships RESOLVER-LESS by design.
// It is mandated infra, not dead code — the live reverse-geocode provider and
// its public endpoint defer to P5, because v1 §12 puts route-name
// geocoding-on-save on mobile. The resolver is injected; nothing in P2.6b wires
// a live one. Exercised now by the two-layer-cache unit test with a fake
// resolver so the caching behavior is locked before a provider exists.
import type { Sql } from "postgres";
import type { RedisLike } from "../../redis.js";
import * as repo from "./repo.js";

/** A provider that names a coordinate. `provider` is stamped into geo_cache so
 *  a later cache read knows which service produced the name. */
export interface GeocodeResolver {
  readonly provider: string;
  resolve(lat: number, lng: number): Promise<string | null>;
}

// Redis is the rebuildable LRU layer (v1 §7.2); geo_cache is the persistent
// floor. A long TTL keeps hot cells warm without letting Redis be the only copy.
const GEO_REDIS_TTL_S = 30 * 24 * 60 * 60;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
export const geoRedisKey = (lat3: number, lng3: number): string => `geo:${String(lat3)}:${String(lng3)}`;

export interface GeocodeDeps {
  sql: Sql;
  redis: RedisLike;
}

/** Resolve a coordinate to a place name through Redis → geo_cache → resolver,
 *  backfilling both layers. Returns null when the resolver cannot name it (not
 *  cached — a transient failure must not poison the cache). */
export async function geocode(
  deps: GeocodeDeps,
  lat: number,
  lng: number,
  resolver: GeocodeResolver,
): Promise<string | null> {
  const lat3 = round3(lat);
  const lng3 = round3(lng);
  const rkey = geoRedisKey(lat3, lng3);

  const cachedRedis = await deps.redis.get(rkey);
  if (cachedRedis !== null) return cachedRedis;

  const stored = await repo.geoCacheGet(deps.sql, lat3, lng3);
  if (stored !== null) {
    await deps.redis.setex(rkey, GEO_REDIS_TTL_S, stored.name);
    return stored.name;
  }

  const name = await resolver.resolve(lat, lng);
  if (name === null) return null;
  await repo.geoCacheUpsert(deps.sql, lat3, lng3, name, resolver.provider);
  await deps.redis.setex(rkey, GEO_REDIS_TTL_S, name);
  return name;
}
