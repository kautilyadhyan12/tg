// ROADMAP Stage 5 32b-ii-a — a change to a meal made on the phone is sent with an id of its own
// until the server answers, so the same change sent twice is made once; and the person's recent
// foods, their own only. Through the routes a person uses, on the real Postgres.
//
// The worst thing (the plan's line): a change made with no signal is lost, or it writes over a
// newer one, and the day's totals are wrong; or somebody else's foods are in Recent.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { mealSchema, recentFoodsResponseSchema, type Meal } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { CURATED_FOODS } from "../src/modules/nutrition/foods.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "chg32b-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "chg32b-test-secret-0123456789abcdef-3232", // gitleaks:allow
  LOG_LEVEL: "error",
};

const food = (start: string) => {
  const found = CURATED_FOODS.find((f) => f.name.startsWith(start));
  if (found === undefined) throw new Error(`${start} is on the list`);
  return found;
};
const ROTI = food("Roti / Chapati (homemade");
const PANEER = food("Paneer");
const CHANA = food("Chana masala");
const noPackaged: FoodSearchProvider = { search: () => Promise.resolve([]) };

d("a meal's change sent twice, and recent foods (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let alice = "";
  let bob = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, access: string, body?: unknown) =>
    api().inject({
      method, url: path,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const session = async (email: string): Promise<string> => {
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Change fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const mealOf = (body: string): Meal => mealSchema.parse(z.object({ meal: z.unknown() }).parse(JSON.parse(body)).meal);
  const log = async (access: string, items: unknown[], minutesAgo: number, mealName = "Change fixture meal"): Promise<Meal> => {
    const takenAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const res = await inject("POST", "/v1/nutrition/meals", access, { mealName, takenAt, items });
    expect(res.statusCode, res.body).toBe(201);
    return mealOf(res.body);
  };
  const now = async (id: string, access = alice): Promise<Meal> => mealOf((await inject("GET", `/v1/nutrition/meals/${id}`, access)).body);
  const corrections = async (id: string): Promise<string[]> =>
    (await sql<{ field: string }[]>`SELECT field FROM meal_log_corrections WHERE meal_log_id = ${id} ORDER BY created_at, id`).map((r) => r.field);
  const recent = async (access: string) => {
    const res = await inject("GET", "/v1/nutrition/foods/recent", access);
    expect(res.statusCode, res.body).toBe(200);
    return recentFoodsResponseSchema.parse(res.json()).items;
  };
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'chg32b-%@example.com')`;
    await sql`DELETE FROM meal_removed_ids WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'chg32b-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'chg32b-%@example.com'`;
  };

  beforeAll(async () => {
    await clean();
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { foodSearchProvider: noPackaged } });
    alice = await session("chg32b-alice@example.com");
    bob = await session("chg32b-bob@example.com");
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    await sql.end({ timeout: 5 });
  });

  it("the worst thing: a change to a meal's foods sent twice is made once, and never over a newer change", async () => {
    const meal = await log(alice, [{ canonical: ROTI.canonical, measure: "serving", amount: 2 }, { canonical: PANEER.canonical, grams: 100 }], 30);
    const changeId = randomUUID();
    const change = { items: [{ canonical: ROTI.canonical, measure: "serving", amount: 3, from: 0 }, { from: 1 }], itemsVersion: meal.itemsVersion, changeId };
    const first = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, change);
    expect(first.statusCode, first.body).toBe(200);
    // The phone heard nothing and sends it again: the meal as it is, not 409 and not made twice.
    const again = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, change);
    expect(again.statusCode, again.body).toBe(200);
    expect(mealOf(again.body)).toEqual(mealOf(first.body));
    expect(await corrections(meal.id)).toEqual(["items"]);

    // The browser then changes the meal; the phone's old change, sent once more, writes nothing.
    const changed = await now(meal.id);
    const browser = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { mealName: "Renamed in the browser", items: [{ from: 1 }], itemsVersion: changed.itemsVersion });
    expect(browser.statusCode, browser.body).toBe(200);
    const late = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, change);
    expect(late.statusCode, late.body).toBe(200);
    expect(mealOf(late.body)).toEqual(mealOf(browser.body));
    const rename = { mealName: "Renamed on the phone", changeId: randomUUID() };
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, rename)).statusCode).toBe(200);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { mealName: "Renamed in the browser again" })).statusCode).toBe(200);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, rename)).statusCode).toBe(200);
    expect((await now(meal.id)).mealName).toBe("Renamed in the browser again");
    // One correction row a field for each change made: the phone's two, the browser's two; none for a change sent again.
    expect((await corrections(meal.id)).sort()).toEqual(["items", "items", "meal_name", "meal_name", "meal_name"]);
  }, 60_000);

  it("makes a change sent twice at the same moment once", async () => {
    for (let round = 0; round < 4; round += 1) {
      const meal = await log(alice, [{ canonical: ROTI.canonical, grams: 40 }, { canonical: PANEER.canonical, grams: 100 }], 20);
      const change = { mealType: "dinner", items: [{ canonical: ROTI.canonical, grams: 80, from: 0 }], itemsVersion: meal.itemsVersion, changeId: randomUUID() };
      const both = await Promise.all([1, 2].map(() => inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, change)));
      expect(both.map((r) => r.statusCode), both.map((r) => r.body).join(" | ")).toEqual([200, 200]);
      const [a, b] = both.map((r) => mealOf(r.body));
      expect(a).toEqual(b);
      expect(a?.items.map((i) => i.gramsPoint)).toEqual([80]);
      expect(await corrections(meal.id)).toEqual(["items"]);
    }
  }, 60_000);

  it("still refuses a different change made from an older state of the foods", async () => {
    const meal = await log(alice, [{ canonical: ROTI.canonical, grams: 40 }], 10);
    const first = { items: [{ canonical: ROTI.canonical, grams: 60, from: 0 }], itemsVersion: meal.itemsVersion, changeId: randomUUID() };
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, first)).statusCode).toBe(200);
    const other = { ...first, changeId: randomUUID() };
    const res = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, other);
    expect([res.statusCode, z.object({ error: z.string() }).parse(res.json()).error]).toEqual([409, "meal_changed"]);
  }, 60_000);

  it("refuses a change that says nothing but its id, or an id that is not one", async () => {
    const meal = await log(alice, [{ canonical: ROTI.canonical, grams: 40 }], 5);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { changeId: randomUUID() })).statusCode).toBe(400);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { mealName: "x", changeId: "not-an-id" })).statusCode).toBe(400);
    expect((await now(meal.id)).mealName).toBe("Change fixture meal");
  }, 60_000);

  it("keeps a stranger out: Bob's change under Alice's meal and Alice's change id makes nothing", async () => {
    const meal = await log(alice, [{ canonical: ROTI.canonical, grams: 40 }], 5);
    const changeId = randomUUID();
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { mealName: "Alice's lunch", changeId })).statusCode).toBe(200);
    // Bob holds her meal's id and her change's id: 404 both ways, and her meal is as she left it.
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, bob, { mealName: "Alice's lunch", changeId })).statusCode).toBe(404);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, bob, { mealName: "Bob's now", changeId: randomUUID() })).statusCode).toBe(404);
    expect((await now(meal.id)).mealName).toBe("Alice's lunch");
    // A meal removed is not found, so the phone's change to it is done with.
    expect((await inject("DELETE", `/v1/nutrition/meals/${meal.id}`, alice)).statusCode).toBe(204);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { mealName: "Gone", changeId: randomUUID() })).statusCode).toBe(404);
  }, 60_000);

  it("lists the person's own last different foods, newest first, at the amount last had", async () => {
    await clean();
    alice = await session("chg32b-alice@example.com");
    bob = await session("chg32b-bob@example.com");
    expect(await recent(alice)).toEqual([]);
    await log(alice, [{ canonical: ROTI.canonical, measure: "serving", amount: 2 }, { canonical: PANEER.canonical, grams: 150 }], 300);
    await log(alice, [{ canonical: ROTI.canonical, measure: "serving", amount: 3 }], 120);
    const gone = await log(alice, [{ canonical: CHANA.canonical, grams: 200 }], 60);
    await log(bob, [{ canonical: CHANA.canonical, grams: 250 }], 10);

    const before = await recent(alice);
    expect(before.map((f) => [f.canonical, f.add])).toEqual([
      [CHANA.canonical, { measure: "g", amount: 200 }],
      [ROTI.canonical, { measure: "serving", amount: 3 }],
      [PANEER.canonical, { measure: "g", amount: 150 }],
    ]);
    expect(before[1]?.item.measure).toEqual({ id: "serving", name: "roti", amount: 3 });
    // Each comes with its own measures, so it opens in the measure picker.
    expect(before[1]?.measures.map((m) => m.id)).toContain("serving");
    expect(before.every((f) => f.measures.some((m) => m.id === "g"))).toBe(true);
    // A removed meal's foods are no longer recent; Bob's chana is never Alice's.
    expect((await inject("DELETE", `/v1/nutrition/meals/${gone.id}`, alice)).statusCode).toBe(204);
    expect((await recent(alice)).map((f) => f.canonical)).toEqual([ROTI.canonical, PANEER.canonical]);
    expect((await recent(bob)).map((f) => [f.canonical, f.add])).toEqual([[CHANA.canonical, { measure: "g", amount: 250 }]]);
    expect((await inject("GET", "/v1/nutrition/foods/recent", "")).statusCode).toBe(401);
  }, 60_000);

  it("leaves out a food no table has any more: added again, nothing would price it", async () => {
    const [bobRow] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'chg32b-bob@example.com'`;
    const gone = [{
      name: "A food nobody has now", canonical: "chg32b_no_such_food", gramsPoint: 100, gramsRange: [100, 100], portionSource: "default",
      nutritionSource: "curated", kcalPoint: 100, kcalLow: 100, kcalHigh: 100, proteinG: 1, carbsG: 1, fatG: 1,
    }];
    await sql`
      INSERT INTO meal_logs (user_id, taken_at, meal_name, items, kcal_point, kcal_low, kcal_high, protein_g, carbs_g, fat_g,
                             origin, portion_source, nutrition_sources, calc_version)
      VALUES (${bobRow?.id ?? ""}, now(), 'Gone', ${sql.json(gone)}, 100, 100, 100, 1, 1, 1, 'manual', 'default', ${["curated"]}, 1)`;
    expect((await recent(bob)).map((f) => f.canonical)).toEqual([CHANA.canonical]);
  }, 60_000);
});
