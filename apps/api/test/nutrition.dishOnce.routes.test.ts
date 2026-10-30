// ROADMAP Stage 5 32b-ii-b — a dish saved on the phone is sent with an id of its own until the
// server answers, so the same dish sent twice is saved once; and a person's dishes are their own.
// Through the routes a person uses, on the real Postgres.
//
// The worst thing (the plan's line): one person sees or changes another person's dish.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { STANDARD_DISHES, dishwarePageSchema, dishwareResponseSchema, mealPreviewSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { CURATED_FOODS } from "../src/modules/nutrition/foods.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "dish32b-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "dish32b-test-secret-0123456789abcdef-3232", // gitleaks:allow
  LOG_LEVEL: "error",
};
const RICE = CURATED_FOODS.find((f) => f.name.toLowerCase().startsWith("rice"));
const BOWL = { label: "My blue bowl", containerClass: "bowl", volumeMl: 500 };

d("a dish sent twice from the phone, and a person's own dishes (real Postgres)", () => {
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
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Dish fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const dishes = async (access: string) => {
    const res = await inject("GET", "/v1/nutrition/dishware", access);
    expect(res.statusCode, res.body).toBe(200);
    return dishwarePageSchema.parse(res.json()).items;
  };
  const rowsUnder = async (id: string) =>
    await sql<{ user_id: string; label: string; volume_ml: number }[]>`SELECT user_id, label, volume_ml FROM user_dishware WHERE id = ${id}`;
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM users WHERE email LIKE 'dish32b-%@example.com'`;
  };

  beforeAll(async () => {
    await clean();
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis() });
    alice = await session("dish32b-alice@example.com");
    bob = await session("dish32b-bob@example.com");
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    await sql.end({ timeout: 5 });
  });

  it("the worst thing: one person's Cup changed changes nobody else's, and each is priced by their own (Kd, 2026-10-30)", async () => {
    const cup = STANDARD_DISHES[0];
    const canonical = RICE?.canonical ?? "";
    const grams = async (access: string) => {
      const res = await inject("POST", "/v1/nutrition/meals/preview", access, { items: [{ canonical, dishwareId: cup.id, fillLevel: 1 }] });
      expect(res.statusCode, res.body).toBe(200);
      return mealPreviewSchema.parse(res.json()).items[0]?.gramsPoint ?? 0;
    };
    const everybody = await grams(bob);

    const changed = await inject("PATCH", `/v1/nutrition/dishware/${cup.id}`, alice, { volumeMl: 480 });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(dishwareResponseSchema.parse(changed.json()).dishware).toMatchObject({ id: cup.id, label: "Cup", volumeMl: 480 });
    const again = await inject("PATCH", `/v1/nutrition/dishware/${cup.id}`, alice, { label: "Big cup" });
    expect(dishwareResponseSchema.parse(again.json()).dishware).toMatchObject({ id: cup.id, label: "Big cup", volumeMl: 480 });

    expect((await dishes(alice)).filter((x) => x.id === cup.id)).toHaveLength(1);
    expect((await dishes(bob)).filter((x) => x.id === cup.id)).toHaveLength(0);
    expect(await grams(alice)).toBe(everybody * 2);
    expect(await grams(bob)).toBe(everybody);
    // The whole meal eaten from it too.
    const shared = async (access: string) => {
      const res = await inject("POST", "/v1/nutrition/meals/preview", access, { items: [{ canonical, dishwareId: cup.id, fillLevel: 1, share: 1 }] });
      expect(res.statusCode, res.body).toBe(200);
      return mealPreviewSchema.parse(res.json()).items[0]?.gramsPoint ?? 0;
    };
    expect(await shared(alice)).toBe(2 * (await shared(bob)));

    // Bob's reset finds nothing of his, and hers stays; hers puts it back, once.
    expect((await inject("DELETE", `/v1/nutrition/dishware/${cup.id}`, bob)).statusCode).toBe(404);
    expect((await dishes(alice)).find((x) => x.id === cup.id)?.volumeMl).toBe(480);
    expect((await inject("DELETE", `/v1/nutrition/dishware/${cup.id}`, alice)).statusCode).toBe(204);
    expect((await inject("DELETE", `/v1/nutrition/dishware/${cup.id}`, alice)).statusCode).toBe(404);
    expect(await grams(alice)).toBe(everybody);
  });

  it("the worst thing: somebody else's dish id saves, reads and changes nothing", async () => {
    const id = randomUUID();
    const saved = await inject("POST", "/v1/nutrition/dishware", alice, { ...BOWL, id });
    expect(saved.statusCode, saved.body).toBe(201);

    // Bob sends a save under Alice's dish's id: not found, and her dish is as it was.
    const stolen = await inject("POST", "/v1/nutrition/dishware", bob, { label: "Bob's plate", containerClass: "plate", volumeMl: 900, id });
    expect(stolen.statusCode, stolen.body).toBe(404);
    expect(stolen.body).not.toContain("My blue bowl");
    // Rename and remove by Bob: not found, nothing changed.
    expect((await inject("PATCH", `/v1/nutrition/dishware/${id}`, bob, { label: "Taken" })).statusCode).toBe(404);
    expect((await inject("DELETE", `/v1/nutrition/dishware/${id}`, bob)).statusCode).toBe(404);
    expect(await dishes(bob)).toEqual([]);
    const rows = await rowsUnder(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("My blue bowl");
    expect(rows[0]?.volume_ml).toBe(500);
    // A meal of Bob's weighed with Alice's dish is refused as an unknown dish.
    const meal = await inject("POST", "/v1/nutrition/meals/preview", bob, { items: [{ canonical: RICE?.canonical ?? "", dishwareId: id, fillLevel: 0.5 }] });
    expect(meal.statusCode, meal.body).toBe(400);
    expect(meal.body).toContain("unknown_dishware");
  });

  it("saves a dish sent twice once, and answers the second send with the dish as it is now", async () => {
    const id = randomUUID();
    const first = await inject("POST", "/v1/nutrition/dishware", alice, { label: "Big plate", containerClass: "plate", volumeMl: 900, id });
    expect(first.statusCode, first.body).toBe(201);
    // Renamed in the browser, then the phone's save arrives again: the dish as it is, unchanged.
    expect((await inject("PATCH", `/v1/nutrition/dishware/${id}`, alice, { label: "Dinner plate" })).statusCode).toBe(200);
    const again = await inject("POST", "/v1/nutrition/dishware", alice, { label: "Big plate", containerClass: "plate", volumeMl: 900, id });
    expect(again.statusCode, again.body).toBe(200);
    expect(dishwareResponseSchema.parse(again.json()).dishware).toMatchObject({ id, label: "Dinner plate", volumeMl: 900 });
    expect(await rowsUnder(id)).toHaveLength(1);
  });

  it("saves a dish sent twice at the same moment once", async () => {
    for (let round = 0; round < 4; round += 1) {
      const id = randomUUID();
      const body = { label: `Mug ${String(round)}`, containerClass: "mug", volumeMl: 300, id };
      const [a, b] = await Promise.all([inject("POST", "/v1/nutrition/dishware", alice, body), inject("POST", "/v1/nutrition/dishware", alice, body)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
      expect(await rowsUnder(id)).toHaveLength(1);
    }
  });

  it("keeps an id sent in capitals in small letters, so the two spellings are one dish", async () => {
    const id = randomUUID();
    expect((await inject("POST", "/v1/nutrition/dishware", alice, { ...BOWL, label: "Cereal bowl", id: id.toUpperCase() })).statusCode).toBe(201);
    const again = await inject("POST", "/v1/nutrition/dishware", alice, { ...BOWL, label: "Cereal bowl", id });
    expect(again.statusCode, again.body).toBe(200);
    expect(dishwareResponseSchema.parse(again.json()).dishware.id).toBe(id);
  });

  it("saves a new dish each time when no id is sent, as the browser does", async () => {
    const before = (await dishes(alice)).length;
    expect((await inject("POST", "/v1/nutrition/dishware", alice, { ...BOWL, label: "Browser bowl" })).statusCode).toBe(201);
    expect((await inject("POST", "/v1/nutrition/dishware", alice, { ...BOWL, label: "Browser bowl" })).statusCode).toBe(201);
    expect((await dishes(alice)).length).toBe(before + 2);
  });

  it("refuses an id that is no id, and a save with no session", async () => {
    const bad = await inject("POST", "/v1/nutrition/dishware", alice, { ...BOWL, id: "not-an-id" });
    expect(bad.statusCode, bad.body).toBe(400);
    expect((await inject("POST", "/v1/nutrition/dishware", "", { ...BOWL, id: randomUUID() })).statusCode).toBe(401);
  });

  it("weighs a food with a dish everybody has, for anybody, and never saves a dish under its id", async () => {
    const bowl = STANDARD_DISHES[2];
    for (const access of [alice, bob]) {
      const priced = await inject("POST", "/v1/nutrition/meals/preview", access, { items: [{ canonical: RICE?.canonical ?? "", dishwareId: bowl.id, fillLevel: 0.5 }] });
      expect(priced.statusCode, priced.body).toBe(200);
      const item = mealPreviewSchema.parse(priced.json()).items[0];
      expect(item?.measure).toEqual({ id: "dish", name: "Bowl", amount: 0.5 });
      expect(item?.gramsPoint).toBeGreaterThan(0);
    }
    // Nobody's own dish takes its id, so nobody can change what it weighs for everybody else.
    const taken = await inject("POST", "/v1/nutrition/dishware", alice, { label: "Mine now", containerClass: "bowl", volumeMl: 2000, id: bowl.id });
    expect(taken.statusCode, taken.body).toBe(400);
    expect(await rowsUnder(bowl.id)).toHaveLength(0);
    // Unchanged, it is not listed as the person's, and there is nothing of theirs to remove.
    expect((await dishes(alice)).some((d) => d.id === bowl.id)).toBe(false);
    expect((await inject("DELETE", `/v1/nutrition/dishware/${bowl.id}`, alice)).statusCode).toBe(404);
  });

  it("renames and removes the person's own dish", async () => {
    const id = randomUUID();
    expect((await inject("POST", "/v1/nutrition/dishware", alice, { ...BOWL, label: "Old name", id })).statusCode).toBe(201);
    const renamed = await inject("PATCH", `/v1/nutrition/dishware/${id}`, alice, { label: "Soup bowl" });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(dishwareResponseSchema.parse(renamed.json()).dishware.label).toBe("Soup bowl");
    expect((await inject("DELETE", `/v1/nutrition/dishware/${id}`, alice)).statusCode).toBe(204);
    expect((await dishes(alice)).some((x) => x.id === id)).toBe(false);
  });
});
