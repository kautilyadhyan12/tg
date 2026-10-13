import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { VisionEvidence } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createIoRedis, createMemoryRedis, type RedisLike } from "../src/redis.js";
import type { VisionProvider, VisionResult } from "../src/modules/nutrition/vision.adapter.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";

// A meal saved under the phone's own id (ROADMAP 32a): the same meal sent twice is
// kept once, and an id that is somebody else's meal reads and changes nothing.

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
// The photo is taken once by a script in Redis; where the real one is given, it is the one used.
const redisUrl = process.env["TEST_REDIS_URL"];
const PASSWORD = "p32a-safe-test-password-1"; // gitleaks:allow
const env = { NODE_ENV: "test", DATABASE_URL: url ?? "", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "p32a-test-secret-0123456789abcdef-32", LOG_LEVEL: "error", GROQ_API_KEY: "p32a-fake-provider-key" }; // gitleaks:allow
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
const jpeg = (() => { const bytes = Buffer.alloc(1200, 1); bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; return bytes.toString("base64"); })();

interface MealBody { meal: { id: string; mealName: string; origin: string; totals: { kcalPoint: number }; items: { canonical: string; gramsPoint: number }[] } }

d("a meal saved under the phone's own id (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  let redis: RedisLike | undefined;
  let alice = { userId: "", access: "" };
  let bob = { userId: "", access: "" };
  const api = (): App => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST", path: string, access: string, body?: unknown) =>
    api().inject({ method, url: path, cookies: access === "" ? {} : { accessToken: access }, headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
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
    redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
    for (let tries = 0; (await redis.incrWithTtl(`p32a-ready:${randomUUID()}`, 30)) === null; tries++) {
      if (tries === 100) throw new Error("the Redis at TEST_REDIS_URL never connected");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    app = await buildApp(loadConfig(env), { redis, nutrition: { visionProvider: vision, foodSearchProvider: noExternal } });
    alice = await session("p32a-alice@example.com");
    bob = await session("p32a-bob@example.com");
    // A free account scans once a day; these two scan all through the file.
    for (const id of [alice.userId, bob.userId]) await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) SELECT 'user', ${id}, id, 'active', 'pilot' FROM plans WHERE code='pro_us_m'`;
  }, 60_000);
  // Each test starts with no meals, whatever the one before it left.
  afterEach(async () => { await sql`DELETE FROM meal_logs WHERE user_id IN (${alice.userId}, ${bob.userId})`; });
  afterAll(async () => { if (app !== undefined) await app.close(); await wipe(); await sql.end({ timeout: 5 }); });

  it("an id that is somebody else's meal reads nothing and changes nothing, typed or from a photo", async () => {
    const id = randomUUID();
    const first = await inject("POST", "/v1/nutrition/meals", alice.access, typed(id, "Alice's lunch"));
    expect(first.statusCode, first.body).toBe(201);
    const before = await sql`SELECT * FROM meal_logs WHERE id = ${id}`;

    const typedTry = await inject("POST", "/v1/nutrition/meals", bob.access, typed(id, "Bob's lunch", 400));
    expect(typedTry.statusCode).toBe(404);
    expect(typedTry.body).not.toContain("Alice");
    expect(typedTry.body).not.toContain("dal_lentil_curry");

    const bobScan = await scan(bob.access);
    const photoTry = await inject("POST", "/v1/nutrition/meals", bob.access, photo(id, bobScan));
    expect(photoTry.statusCode).toBe(404);
    expect(photoTry.body).not.toContain("Alice");

    expect(await sql`SELECT * FROM meal_logs WHERE id = ${id}`).toEqual(before);
    expect(await rowsOf(bob.userId)).toHaveLength(0);
    expect((await inject("GET", `/v1/nutrition/meals/${id}`, bob.access)).statusCode).toBe(404);
    // Bob's photo is still his to save, under an id of his own.
    const kept = await inject("POST", "/v1/nutrition/meals", bob.access, photo(randomUUID(), bobScan));
    expect(kept.statusCode, kept.body).toBe(201);
  }, 30_000);

  it("the same typed meal sent twice is one meal, and the second answer is the first", async () => {
    const id = randomUUID();
    const body = typed(id);
    const first = await inject("POST", "/v1/nutrition/meals", alice.access, body);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<MealBody>().meal.id).toBe(id);
    const again = await inject("POST", "/v1/nutrition/meals", alice.access, body);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json<MealBody>()).toEqual(first.json<MealBody>());
    const rows = await rowsOf(alice.userId);
    expect(rows.map((r) => r.id)).toEqual([id]);
    const list = await inject("GET", "/v1/nutrition/meals?limit=50", alice.access);
    const kcal = list.json<{ items: { totals: { kcalPoint: number } }[] }>().items.reduce((sum, m) => sum + m.totals.kcalPoint, 0);
    expect(kcal).toBe(first.json<MealBody>().meal.totals.kcalPoint);
  }, 30_000);

  it("the same typed meal sent five times at the same instant is one meal: one 201, four 200", async () => {
    const body = typed(randomUUID());
    const replies = await Promise.all([1, 2, 3, 4, 5].map(() => inject("POST", "/v1/nutrition/meals", alice.access, body)));
    expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(replies.map((r) => JSON.stringify(r.json<MealBody>()))).size).toBe(1);
    expect(await rowsOf(alice.userId)).toHaveLength(1);
  }, 30_000);

  it("the same id with different food keeps the meal as it was first saved", async () => {
    const id = randomUUID();
    const first = await inject("POST", "/v1/nutrition/meals", alice.access, typed(id, "Lunch", 150));
    const other = await inject("POST", "/v1/nutrition/meals", alice.access, typed(id, "Dinner", 500));
    expect(other.statusCode).toBe(200);
    expect(other.json<MealBody>()).toEqual(first.json<MealBody>());
    expect((await rowsOf(alice.userId)).map((r) => r.meal_name)).toEqual(["Lunch"]);
  }, 30_000);

  it("the same photo meal sent twice is one meal, though its photo can be saved only once", async () => {
    const id = randomUUID();
    const body = photo(id, await scan(alice.access), 120);
    const first = await inject("POST", "/v1/nutrition/meals", alice.access, body);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json<MealBody>().meal.origin).toBe("photo");
    const again = await inject("POST", "/v1/nutrition/meals", alice.access, body);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json<MealBody>()).toEqual(first.json<MealBody>());
    expect(await rowsOf(alice.userId)).toHaveLength(1);
    const corrections = await sql`SELECT 1 FROM meal_log_corrections WHERE meal_log_id = ${id}`;
    expect(corrections.length).toBeLessThanOrEqual(1);
  }, 30_000);

  it("the same photo meal sent five times at the same instant is one meal: one 201, four 200", async () => {
    const id = randomUUID();
    const body = photo(id, await scan(alice.access));
    const replies = await Promise.all([1, 2, 3, 4, 5].map(() => inject("POST", "/v1/nutrition/meals", alice.access, body)));
    expect(replies.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(replies.map((r) => JSON.stringify(r.json<MealBody>()))).size).toBe(1);
    expect((await rowsOf(alice.userId)).map((r) => r.id)).toEqual([id]);
  }, 30_000);

  it("one photo under two ids is still one meal: the second is refused and leaves nothing", async () => {
    const s = await scan(alice.access);
    const replies = await Promise.all([randomUUID(), randomUUID()].map((id) => inject("POST", "/v1/nutrition/meals", alice.access, photo(id, s))));
    expect(replies.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    expect(await rowsOf(alice.userId)).toHaveLength(1);
  }, 30_000);

  it("a photo that cannot be saved leaves no meal under the id, so the id can be used again", async () => {
    const id = randomUUID();
    const dead = await inject("POST", "/v1/nutrition/meals", alice.access, { id, scanToken: "x".repeat(40), takenAt: new Date().toISOString(), items: [{ canonical: "dal_lentil_curry", grams: 100 }] });
    expect(dead.statusCode).toBe(400);
    expect(await rowsOf(alice.userId)).toHaveLength(0);
    expect((await inject("POST", "/v1/nutrition/meals", alice.access, typed(id))).statusCode).toBe(201);
  }, 30_000);

  it("an id that is not an id is refused, nobody signed in is refused, and a meal with no id is saved each time as before", async () => {
    expect((await inject("POST", "/v1/nutrition/meals", alice.access, typed("not-an-id"))).statusCode).toBe(400);
    expect((await inject("POST", "/v1/nutrition/meals", alice.access, { ...typed(randomUUID()), smuggled: true })).statusCode).toBe(400);
    expect((await inject("POST", "/v1/nutrition/meals", "", typed(randomUUID()))).statusCode).toBe(401);
    expect(await rowsOf(alice.userId)).toHaveLength(0);
    const body = typed(undefined);
    expect((await inject("POST", "/v1/nutrition/meals", alice.access, body)).statusCode).toBe(201);
    expect((await inject("POST", "/v1/nutrition/meals", alice.access, body)).statusCode).toBe(201);
    expect(await rowsOf(alice.userId)).toHaveLength(2);
  }, 30_000);
});
