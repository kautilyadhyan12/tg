// P2.4 — the ONE Redis seam (v1 §7.2 keys live behind it). Modules depend on
// RedisLike, never on ioredis directly, so dev/test run without a Redis
// (deterministic in-memory impl) while prod uses the real one (config
// fail-fast requires REDIS_URL in production). Every method resolves null on
// backend failure instead of throwing — callers implement their own
// fail-open/fail-closed policy (v1 §9.3), a connection blip must never 500
// an unrelated route.
import { Redis } from "ioredis";

export interface RedisLike {
  /** Atomic INCR; sets `ttlSeconds` on first increment. null = backend down. */
  incrWithTtl(key: string, ttlSeconds: number): Promise<number | null>;
  /** null = missing OR backend down (callers treat both as cache miss). */
  get(key: string): Promise<string | null>;
  /** true = stored; false = backend down. */
  setex(key: string, ttlSeconds: number, value: string): Promise<boolean>;
  /** Atomic get+delete. undefined = absent, null = backend down. */
  take(key: string): Promise<string | undefined | null>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

// INCR + NX-expire in one round trip: EXPIRE ... NX only sets the TTL when
// none exists, so the counter's window never resets on later hits.
const INCR_TTL_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return c`;
const TAKE_LUA = `
local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v`;

export function createIoRedis(url: string): RedisLike {
  const client = new Redis(url, {
    maxRetriesPerRequest: 1, // fail fast; policy lives in the callers
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  client.defineCommand("incrWithTtl", { numberOfKeys: 1, lua: INCR_TTL_LUA });
  client.defineCommand("take", { numberOfKeys: 1, lua: TAKE_LUA });
  const asIncr = client as Redis & {
    incrWithTtl(key: string, ttl: string): Promise<number>;
    take(key: string): Promise<string | null>;
  };
  return {
    async incrWithTtl(key, ttlSeconds) {
      try {
        return await asIncr.incrWithTtl(key, String(ttlSeconds));
      } catch {
        return null;
      }
    },
    async get(key) {
      try {
        return await client.get(key);
      } catch {
        return null;
      }
    },
    async setex(key, ttlSeconds, value) {
      try {
        await client.setex(key, ttlSeconds, value);
        return true;
      } catch {
        return false;
      }
    },
    async take(key) {
      try {
        return (await asIncr.take(key)) ?? undefined;
      } catch {
        return null;
      }
    },
    async del(key) {
      try {
        await client.del(key);
      } catch {
        /* bust failure surfaces as a stale-≤60s read; TTL bounds it */
      }
    },
    async close() {
      await client.quit().catch(() => {
      client.disconnect();
    });
    },
  };
}

/** Deterministic in-memory impl for dev/test (and the single-instance
 *  fallback when REDIS_URL is unset outside prod). `down` simulates a Redis
 *  outage so fail-open/fail-closed paths are unit-testable. */
export function createMemoryRedis(clock: () => number = Date.now): RedisLike & { down: boolean } {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const e = store.get(key);
    if (e === undefined) return undefined;
    if (e.expiresAt <= clock()) {
      store.delete(key);
      return undefined;
    }
    return e;
  };
  return {
    down: false,
    async incrWithTtl(key, ttlSeconds) {
      if (this.down) return null;
      const e = live(key);
      if (e === undefined) {
        store.set(key, { value: "1", expiresAt: clock() + ttlSeconds * 1000 });
        return 1;
      }
      e.value = String(Number(e.value) + 1);
      return Promise.resolve(Number(e.value));
    },
    async get(key) {
      if (this.down) return null;
      return Promise.resolve(live(key)?.value ?? null);
    },
    async setex(key, ttlSeconds, value) {
      if (this.down) return false;
      store.set(key, { value, expiresAt: clock() + ttlSeconds * 1000 });
      return Promise.resolve(true);
    },
    async take(key) {
      if (this.down) return null;
      const value = live(key)?.value;
      if (value === undefined) return Promise.resolve(undefined);
      store.delete(key);
      return Promise.resolve(value);
    },
    async del(key) {
      if (this.down) return;
      store.delete(key);
      return Promise.resolve();
    },
    async close() {
      store.clear();
      return Promise.resolve();
    },
  };
}
