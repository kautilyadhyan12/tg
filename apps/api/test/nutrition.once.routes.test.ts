import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { mealPageSchema, type VisionEvidence } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import type { VisionProvider, VisionResult } from "../src/modules/nutrition/vision.adapter.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { MEAL_PHOTO } from "./fixtures/mealPhoto.js";

// A meal saved under the phone's own id (ROADMAP 32a): the same meal sent twice is
// kept once, and an id that is somebody else's meal reads and changes nothing.

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const redisUrl = process.env["TEST_REDIS_URL"];
const PASSWORD = "p32a-safe-test-password-1"; // gitleaks:allow
const env = { NODE_ENV: "test", DATABASE_URL: url ?? "", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "p32a-test-secret-0123456789abcdef-32", LOG_LEVEL: "error" }; // gitleaks:allow
type App = Awaited<ReturnType<typeof buildApp>>;

const evidence: VisionEvidence = {
  meal_name: "Dal and roti",
  items: [
    { name: "Dal", canonical_hint: "dal", count: null, grams: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
    { name: "Roti", canonical_hint: "roti", count: 2, grams: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null },
  ],
  unknown_items: [],
  photo_quality: "good",
};
const vision: VisionProvider = { analyze: () => Promise.resolve({ evidence, tokensIn: 100, tokensOut: 200 } satisfies VisionResult) };
const noExternal: FoodSearchProvider = { search: () => Promise.resolve([]) };
const jpeg = MEAL_PHOTO;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface MealBody { meal: { id: string; mealName: string; origin: string; totals: { kcalPoint: number }; items: { canonical: string; gramsPoint: number }[] } }

/** What a test makes the photo's place in Redis do. `missNextRead`: the next read of
 *  a photo answers nothing, as a Redis that blinked does. `holdSave`: the first read
 *  goes through, every later one waits until the photo has been taken, and the send
 *  that took it is held a moment before it goes on to finish its save. */
interface PhotoPlay { missNextRead: boolean; holdSave: { reads: number; taken: Promise<void>; markTaken: () => void } | null; gone: number }

/** The photo is kept in the real Redis where one is given (its single take is a
 *  script there); sign-in's and the scanner's counts stay in memory, so running this
 *  file again and again never meets the hour's sign-in limit. */
function photoRedis(memory: RedisLike, photos: RedisLike, play: PhotoPlay): RedisLike {
  const of = (key: string): RedisLike => (key.startsWith("meal-scan:") ? photos : memory);
  return {
    incrWithTtl: (key, ttl) => memory.incrWithTtl(key, ttl),
    decrIfPositive: (key) => memory.decrIfPositive(key),
    setNx: (key, ttl, value) => of(key).setNx(key, ttl, value),
    setex: (key, ttl, value) => of(key).setex(key, ttl, value),
    del: (key) => of(key).del(key),
    async get(key) {
      if (of(key) === memory) return await memory.get(key);
      if (play.missNextRead) { play.missNextRead = false; return null; }
      if (play.holdSave !== null && ++play.holdSave.reads > 1) await play.holdSave.taken;
      return await photos.get(key);
    },
    async take(key) {
      const value = await of(key).take(key);
      if (of(key) === memory) return value;
      if (value === undefined) play.gone++;
      if (typeof value === "string" && play.holdSave !== null) { play.holdSave.markTaken(); await sleep(150); }
      return value;
    },
    async close() { await memory.close(); if (photos !== memory) await photos.close(); },
  };
}

d("a meal saved under the phone's own id (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const play: PhotoPlay = { missNextRead: false, holdSave: null, gone: 0 };
  let app: App | undefined;
  let alice = { userId: "", access: "" };
  let bob = { userId: "", access: "" };
  const api = (): App => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, access: string, body?: unknown) =>
    api().inject({ method, url: path, cookies: access === "" ? {} : { accessToken: access }, headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  const save = (access: string, body: unknown) => inject("POST", "/v1/nutrition/meals", access, body);
  async function session(email: string) {
    const reg = await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "P32a Fixture" });
    if (reg.statusCode !== 201) throw new Error(reg.body);
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return { userId: reg.json<{ userId: string }>().userId, access: login.cookies.find((c) => c.name === "accessToken")?.value ?? "" };
  }
  const mine = `(SELECT id FROM users WHERE email LIKE 'p32a-%@example.com')`;
  const wipe = async (): Promise<void> => {
    await sql.unsafe(`DELETE FROM subscriptions WHERE owner_type='user' AND owner_id IN ${mine}`);
    await sql.unsafe(`DELETE FROM meal_logs WHERE user_id IN ${mine}`);
    await sql.unsafe(`DELETE FROM api_cost_events WHERE user_id IN ${mine}`);
    await sql.unsafe(`DELETE FROM users WHERE email LIKE 'p32a-%@example.com'`);
  };
  const rowsOf = async (userId: string): Promise<{ id: string; meal_name: string; kcal_point: number }[]> =>
    await sql`SELECT id, meal_name, kcal_point FROM meal_logs WHERE user_id = ${userId} ORDER BY created_at`;
  const typed = (id: string | undefined, mealName = "Lunch dal and rice", grams = 150) => ({
    ...(id === undefined ? {} : { id }),
    mealName,
    takenAt: new Date().toISOString(),
    items: [{ canonical: "dal_lentil_curry", grams }, { canonical: "rice_white_cooked", grams: 200 }],
  });
  async function scan(access: string): Promise<{ scanToken: string; items: { canonical: string }[] }> {
    const res = await inject("POST", "/v1/nutrition/analyze-photo", access, { imageBase64: jpeg, mimeType: "image/jpeg" });
    if (res.statusCode !== 200) throw new Error(res.body);
    return res.json<{ scanToken: string; items: { canonical: string }[] }>();
  }
  const photo = (id: string | undefined, s: { scanToken: string; items: { canonical: string }[] }, grams = 100) => ({
    ...(id === undefined ? {} : { id }),
    scanToken: s.scanToken,
    takenAt: new Date().toISOString(),
    items: s.items.map((i) => ({ canonical: i.canonical, grams })),
  });

  beforeAll(async () => {
    await wipe();
    const memory = createMemoryRedis();
    const photos = redisUrl === undefined || redisUrl === "" ? memory : createIoRedis(redisUrl);
    for (let tries = 0; !(await photos.setex(`meal-scan:p32a-ready:${randomUUID()}`, 5, "1")); tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await sleep(50);
    }
    app = await buildApp(loadConfig(env), { redis: photoRedis(memory, photos, play), nutrition: { visionProvider: vision, foodSearchProvider: noExternal } });
    alice = await session("p32a-alice@example.com");
    bob = await session("p32a-bob@example.com");
    // A free account scans once a day; these two scan all through the file.
    for (const id of [alice.userId, bob.userId]) await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) SELECT 'user', ${id}, id, 'active', 'pilot' FROM plans WHERE code='pro_us_m'`;
  }, 60_000);
  // Each test starts with no meals and a plain Redis, whatever the one before it left.
  afterEach(async () => {
    play.missNextRead = false; play.holdSave = null; play.gone = 0;
    await sql`DELETE FROM meal_logs WHERE user_id IN (${alice.userId}, ${bob.userId})`;
  });
  afterAll(async () => { if (app !== undefined) await app.close(); await wipe(); await sql.end({ timeout: 5 }); });

  it("the worst thing, a save lost on the way: the same meal sent again is saved, and no other meal can take its scan", async () => {
    const id = randomUUID();
    const name = `once_fail_${id.replaceAll("-", "")}`;
    await sql.unsafe(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'database blinked'; END $$`);
    await sql.unsafe(`CREATE CONSTRAINT TRIGGER ${name} AFTER INSERT ON meal_logs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.id = '${id}') EXECUTE FUNCTION ${name}()`);
    let dropped = false;
    const drop = async (): Promise<void> => {
      if (dropped) return;
      dropped = true;
      await sql.unsafe(`DROP TRIGGER ${name} ON meal_logs`);
      await sql.unsafe(`DROP FUNCTION ${name}()`);
    };
    try {
      const s = await scan(alice.access);
      const lost = await save(alice.access, photo(id, s));
      expect(lost.statusCode).toBeGreaterThanOrEqual(500);
      await drop();
      expect((await save(alice.access, photo(randomUUID(), s))).statusCode).toBe(400);
      const again = await save(alice.access, photo(id, s));
      expect(again.statusCode, again.body).toBe(201);
      expect((await save(alice.access, photo(randomUUID(), s))).statusCode).toBe(400);
    } finally {
      await drop();
    }
  }, 30_000);

  it("an id that is somebody else's meal reads nothing and changes nothing, typed or from a photo", async () => {
    const id = randomUUID();
    const first = await save(alice.access, typed(id, "Alice's lunch"));
    expect(first.statusCode, first.body).toBe(201);
    const before = await sql`SELECT * FROM meal_logs WHERE id = ${id}`;

    const typedTry = await save(bob.access, typed(id, "Bob's lunch", 400));
    expect(typedTry.statusCode).toBe(404);
    expect(typedTry.body).not.toContain("Alice");
    expect(typedTry.body).not.toContain("dal_lentil_curry");
    // The same id in capitals is the same id.
    expect((await save(bob.access, typed(id.toUpperCase(), "Bob's lunch", 400))).statusCode).toBe(404);

    const bobScan = await scan(bob.access);
    const photoTry = await save(bob.access, photo(id, bobScan));
    expect(photoTry.statusCode).toBe(404);
    expect(photoTry.body).not.toContain("Alice");

    expect(await sql`SELECT * FROM meal_logs WHERE id = ${id}`).toEqual(before);
    expect(await rowsOf(bob.userId)).toHaveLength(0);
    expect((await inject("GET", `/v1/nutrition/meals/${id}`, bob.access)).statusCode).toBe(404);
    // Bob's photo is still his to save, under an id of his own.
    const kept = await save(bob.access, photo(randomUUID(), bobScan));
    expect(kept.statusCode, kept.body).toBe(201);
  }, 30_000);

  it("refused for somebody else's id while Redis blinks, a person still has their photo to save", async () => {
    const id = randomUUID();
    expect((await save(alice.access, typed(id, "Alice's lunch"))).statusCode).toBe(201);
    const bobScan = await scan(bob.access);
    play.missNextRead = true;
    expect((await save(bob.access, photo(id, bobScan))).statusCode).toBe(404);
    expect(play.missNextRead).toBe(false);
    const kept = await save(bob.access, photo(randomUUID(), bobScan));
    expect(kept.statusCode, kept.body).toBe(201);
    expect((await rowsOf(alice.userId)).map((r) => r.meal_name)).toEqual(["Alice's lunch"]);
  }, 30_000);

  it("two people sending one new id at the same instant: one has the meal, the other is refused and learns nothing", async () => {
    const id = randomUUID();
    const [a, b] = await Promise.all([save(alice.access, typed(id, "Alice's lunch")), save(bob.access, typed(id, "Bob's lunch"))]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 404]);
    const [winner, loser] = a.statusCode === 201 ? [alice, bob] : [bob, alice];
    const refused = a.statusCode === 404 ? a : b;
    expect(refused.body).not.toContain("lunch");
    expect((await rowsOf(winner.userId)).map((r) => r.id)).toEqual([id]);
    expect(await rowsOf(loser.userId)).toHaveLength(0);
  }, 30_000);

  it("the same typed meal sent twice is one meal, and the second answer is that meal", async () => {
    const id = randomUUID();
    const body = typed(id);
    const first = await save(alice.access, body);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<MealBody>().meal.id).toBe(id);
    const again = await save(alice.access, body);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json<MealBody>()).toEqual(first.json<MealBody>());
    const rows = await rowsOf(alice.userId);
    expect(rows.map((r) => r.id)).toEqual([id]);
    const list = await inject("GET", "/v1/nutrition/meals?limit=50", alice.access);
    expect(mealPageSchema.safeParse(list.json()).success).toBe(true);
    const kcal = list.json<{ items: { totals: { kcalPoint: number } }[] }>().items.reduce((sum, m) => sum + m.totals.kcalPoint, 0);
    expect(kcal).toBe(first.json<MealBody>().meal.totals.kcalPoint);
  }, 30_000);

  it("an id sent in capitals is kept and answered in small letters, and is the same meal either way", async () => {
    const id = randomUUID();
    const first = await save(alice.access, typed(id.toUpperCase()));
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<MealBody>().meal.id).toBe(id);
    expect((await save(alice.access, typed(id))).statusCode).toBe(200);
    expect(await rowsOf(alice.userId)).toHaveLength(1);
  }, 30_000);

  it("the same typed meal sent five times at the same instant is one meal: one 201, four 200", async () => {
    const body = typed(randomUUID());
    const replies = await Promise.all([1, 2, 3, 4, 5].map(() => save(alice.access, body)));
    expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(replies.map((r) => JSON.stringify(r.json<MealBody>()))).size).toBe(1);
    expect(await rowsOf(alice.userId)).toHaveLength(1);
  }, 30_000);

  it("the same id sent again answers with the meal as it is now: other food in the send changes nothing, a rename since is shown", async () => {
    const id = randomUUID();
    const first = await save(alice.access, typed(id, "Lunch", 150));
    const other = await save(alice.access, typed(id, "Dinner", 500));
    expect(other.statusCode).toBe(200);
    expect(other.json<MealBody>()).toEqual(first.json<MealBody>());
    expect((await inject("PATCH", `/v1/nutrition/meals/${id}`, alice.access, { mealName: "Late lunch" })).statusCode).toBe(200);
    const afterRename = await save(alice.access, typed(id, "Lunch", 150));
    expect(afterRename.statusCode).toBe(200);
    expect(afterRename.json<MealBody>().meal.mealName).toBe("Late lunch");
    expect((await rowsOf(alice.userId)).map((r) => r.meal_name)).toEqual(["Late lunch"]);
  }, 30_000);

  // As built, and 32b's to settle (ROADMAP 32b): the server keeps no list of removed ids.
  it("a removed meal stays removed: a late send of it keeps nothing, for its owner or anybody else", async () => {
    const id = randomUUID();
    const body = typed(id);
    expect((await save(alice.access, body)).statusCode).toBe(201);
    const before = (await rowsOf(alice.userId)).length;
    expect((await inject("DELETE", `/v1/nutrition/meals/${id}`, alice.access)).statusCode).toBe(204);
    const late = await save(alice.access, body);
    expect(late.statusCode, late.body).toBe(404);
    expect(await rowsOf(alice.userId)).toHaveLength(before - 1);
    expect((await save(bob.access, body)).statusCode).toBe(404);
    expect((await rowsOf(bob.userId)).some((r) => r.id === id)).toBe(false);
    // Removing it again finds nothing, as before.
    expect((await inject("DELETE", `/v1/nutrition/meals/${id}`, alice.access)).statusCode).toBe(404);
  }, 30_000);

  it("the same photo meal sent twice is one meal, though its photo can be saved only once", async () => {
    const id = randomUUID();
    const body = photo(id, await scan(alice.access), 120);
    const first = await save(alice.access, body);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<MealBody>().meal.origin).toBe("photo");
    const again = await save(alice.access, body);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json<MealBody>()).toEqual(first.json<MealBody>());
    expect(await rowsOf(alice.userId)).toHaveLength(1);
    // The amounts sent differ from the estimate, so the change is noted, once.
    expect(await sql`SELECT 1 FROM meal_log_corrections WHERE meal_log_id = ${id}`).toHaveLength(1);
  }, 30_000);

  it("the same photo meal sent five times at the same instant is one meal: one 201, four 200", async () => {
    const id = randomUUID();
    const body = photo(id, await scan(alice.access));
    const replies = await Promise.all([1, 2, 3, 4, 5].map(() => save(alice.access, body)));
    expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(replies.map((r) => JSON.stringify(r.json<MealBody>()))).size).toBe(1);
    expect((await rowsOf(alice.userId)).map((r) => r.id)).toEqual([id]);
  }, 30_000);

  it("five sends of one meal at once are one meal, each answered with it", async () => {
    const id = randomUUID();
    const body = photo(id, await scan(alice.access));
    let markTaken = (): void => undefined;
    const taken = new Promise<void>((resolve) => { markTaken = resolve; });
    play.holdSave = { reads: 0, taken, markTaken };
    const replies = await Promise.all([1, 2, 3, 4, 5].map(() => save(alice.access, body)));
    expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(replies.map((r) => JSON.stringify(r.json<MealBody>()))).size).toBe(1);
    expect((await rowsOf(alice.userId)).map((r) => r.id)).toEqual([id]);
  }, 30_000);

  it("one photo under two ids is still one meal: the second is refused and leaves nothing", async () => {
    const s = await scan(alice.access);
    const replies = await Promise.all([randomUUID(), randomUUID()].map((id) => save(alice.access, photo(id, s))));
    expect(replies.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    expect(await rowsOf(alice.userId)).toHaveLength(1);
  }, 30_000);

  it("a photo that cannot be saved leaves no meal under the id, so the id can be used again", async () => {
    const id = randomUUID();
    const dead = await save(alice.access, { id, scanToken: "x".repeat(40), takenAt: new Date().toISOString(), items: [{ canonical: "dal_lentil_curry", grams: 100 }] });
    expect(dead.statusCode).toBe(400);
    expect(await rowsOf(alice.userId)).toHaveLength(0);
    expect((await save(alice.access, typed(id))).statusCode).toBe(201);
  }, 30_000);

  it("an id that is not an id is refused, nobody signed in is refused, and a meal with no id is saved each time as before", async () => {
    expect((await save(alice.access, typed("not-an-id"))).statusCode).toBe(400);
    expect((await save(alice.access, { ...typed(randomUUID()), smuggled: true })).statusCode).toBe(400);
    expect((await save("", typed(randomUUID()))).statusCode).toBe(401);
    expect(await rowsOf(alice.userId)).toHaveLength(0);
    const body = typed(undefined);
    expect((await save(alice.access, body)).statusCode).toBe(201);
    expect((await save(alice.access, body)).statusCode).toBe(201);
    expect(await rowsOf(alice.userId)).toHaveLength(2);
  }, 30_000);
});
