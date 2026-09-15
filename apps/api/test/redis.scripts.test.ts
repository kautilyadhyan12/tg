// The Lua in src/redis.ts, run on a real Redis. Every route test uses the in-memory
// adapter, so without this file nothing runs the scripts production runs. It runs
// where TEST_REDIS_URL is set, which test:local does (the compose Redis); CI has no
// Redis, so there it is skipped.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { createIoRedis, type RedisLike } from "../src/redis.js";

const url = process.env["TEST_REDIS_URL"];
const d = describe.skipIf(url === undefined || url === "");

d("the scripts production runs, on a real Redis", () => {
  const prefix = `redis-scripts-test:${randomUUID()}:`;
  const keys = { ready: `${prefix}ready`, window: `${prefix}window`, counter: `${prefix}counter`, text: `${prefix}text`, taken: `${prefix}taken` };
  let seam: RedisLike | undefined;
  let raw: Redis | undefined;
  const real = (): RedisLike => { if (seam === undefined) throw new Error("beforeAll did not run"); return seam; };
  const direct = (): Redis => { if (raw === undefined) throw new Error("beforeAll did not run"); return raw; };

  beforeAll(async () => {
    raw = new Redis(url ?? "", { maxRetriesPerRequest: 1 });
    await raw.ping();
    const connecting = createIoRedis(url ?? "");
    seam = connecting;
    // The seam refuses a command until it is connected (it keeps no offline queue).
    for (let tries = 0; (await connecting.incrWithTtl(keys.ready, 60)) === null; tries++) {
      if (tries === 100) throw new Error("createIoRedis never connected to TEST_REDIS_URL");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  afterAll(async () => {
    await raw?.del(...Object.values(keys));
    raw?.disconnect();
    await seam?.close();
  });

  it("incrWithTtl counts, and sets the window on the first count only", async () => {
    expect(await real().incrWithTtl(keys.window, 90)).toBe(1);
    const opened = await direct().ttl(keys.window);
    expect(opened).toBeGreaterThan(0);
    expect(opened).toBeLessThanOrEqual(90);
    await direct().expire(keys.window, 30);
    expect(await real().incrWithTtl(keys.window, 90)).toBe(2);
    expect(await direct().ttl(keys.window)).toBeLessThanOrEqual(30);
  });

  it("decrIfPositive takes one off a live counter above zero and keeps its window; never below zero, never a counter that is gone or not a number", async () => {
    expect(await real().decrIfPositive(keys.counter)).toBe(false);
    expect(await direct().exists(keys.counter)).toBe(0);
    await real().incrWithTtl(keys.counter, 90);
    await real().incrWithTtl(keys.counter, 90);
    await direct().expire(keys.counter, 30);
    expect(await real().decrIfPositive(keys.counter)).toBe(true);
    expect(await direct().get(keys.counter)).toBe("1");
    expect(await real().decrIfPositive(keys.counter)).toBe(true);
    expect(await real().decrIfPositive(keys.counter)).toBe(false);
    expect(await direct().get(keys.counter)).toBe("0");
    const kept = await direct().ttl(keys.counter);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThanOrEqual(30);
    await direct().set(keys.text, "not a number");
    expect(await real().decrIfPositive(keys.text)).toBe(false);
    expect(await direct().get(keys.text)).toBe("not a number");
  });

  it("take reads a value once and deletes it", async () => {
    expect(await real().setex(keys.taken, 60, "1")).toBe(true);
    expect(await real().take(keys.taken)).toBe("1");
    expect(await direct().exists(keys.taken)).toBe(0);
    expect(await real().take(keys.taken)).toBeUndefined();
  });
});
