// ROADMAP Stage 5 33b-iii-a — a pack's barcode through the route a person uses, on real Postgres. Real
// rows' numbers under test-only codes (GS1 has not given out the prefix 140), so this file finds its own
// rows whether or not the machine has the whole list loaded, and removes only them.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { barcodeReplySchema, recentFoodSchema } from "@app/shared";
import { z } from "zod";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), httpIntegration: vi.fn() }));
vi.mock("@sentry/node", () => sentry);

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "barcode33-safe-test-password-1"; // gitleaks:allow
const env = { NODE_ENV: "test", DATABASE_URL: url ?? "", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "barcode33-test-secret-0123456789abcdef", LOG_LEVEL: "error" };

const checkDigit = (body: string): string => {
  let sum = 0;
  for (const [at, digit] of Array.from(body).reverse().entries()) sum += Number(digit) * (at % 2 === 0 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
};
/** A valid 13-digit code under the unused prefix 140. */
const codeOf = (n: number): string => {
  const body = `140${String(n).padStart(9, "0")}`;
  return `${body}${checkDigit(body)}`;
};
const NUTELLA = codeOf(1);
const PRINCE = codeOf(2);
const ZERO = codeOf(3);
const NO_LIST = codeOf(4);
const APART = codeOf(5);
const USDA_ONLY = codeOf(6);
const NOT_LISTED = codeOf(7);
const LAST = codeOf(8);
/** A 12-digit code as a US pack prints it, under the same unused range: kept with a leading zero. */
const twelveDigits = (): string => {
  const body = "14000000009";
  return `${body}${checkDigit(body)}`;
};

d("a pack's barcode (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  const redis = createMemoryRedis();
  const asked: string[] = [];
  const foods: FoodSearchProvider = { search(query) { asked.push(query); return Promise.resolve([]); } };
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let alice = "";
  let bob = "";
  let aliceId = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) =>
    api().inject({
      method, url: path, remoteAddress: "203.0.113.77",
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const session = async (email: string): Promise<string> => {
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Barcode fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const look = async (code: string, access = alice) => {
    const res = await inject("GET", `/v1/nutrition/barcode/${code}`, access);
    expect(res.statusCode, res.body).toBe(200);
    return barcodeReplySchema.parse(res.json());
  };
  const found = async (code: string) => {
    const reply = await look(code);
    if (reply.status !== "found") throw new Error(`${code}: ${reply.status}`);
    return reply;
  };
  const addOff = async (code: string, row: { name: string; kcal: number; protein: number | null; carbs: number | null; fat: number | null; serving?: string; allergens?: string[]; traces?: string[]; fit?: boolean }) => {
    const record = { code, name: row.name, kcal: row.kcal, protein_g: row.protein, carbs_g: row.carbs, fat_g: row.fat, potassium_mg: 120, serving_size: row.serving ?? null, numbers_fit: row.fit ?? true, allergens: row.allergens ?? [], traces: row.traces ?? [] };
    await sql`INSERT INTO off_products SELECT * FROM jsonb_populate_recordset(NULL::off_products, ${JSON.stringify([record])}::text::jsonb) ON CONFLICT (code) DO NOTHING`;
  };
  const addUsda = async (code: string, name: string, kcal: number) => {
    await sql`INSERT INTO usda_branded_products (code, name, kcal, protein_g, carbs_g, fat_g, numbers_fit) VALUES (${code}, ${name}, ${kcal}, 1, 1, 1, true) ON CONFLICT (code) DO NOTHING`;
  };
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'barcode33-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'barcode33-%@example.com'`;
    await sql`DELETE FROM off_products WHERE code LIKE '140%' OR code LIKE '0140%' OR code IN ('00002523', '0200024010652', '12345678', '9780141026626')`;
    await sql`DELETE FROM usda_branded_products WHERE code LIKE '140%'`;
  };

  beforeAll(async () => {
    await clean();
    await addOff(NUTELLA, { name: "Nutella", kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, allergens: ["milk", "nuts", "soybeans"] });
    await addOff(PRINCE, { name: "Prince · Mondelez Schweiz GmbH", kcal: 467, protein: 6.3, carbs: 69, fat: 17, serving: "20g", allergens: ["eggs", "gluten"], traces: ["eggs"] });
    await addOff(ZERO, { name: "Coca-Cola Zero Sugar", kcal: 0, protein: 0, carbs: 0, fat: 0, serving: "1 portion (20 fl oz)" });
    await addOff(NO_LIST, { name: "Takis chips", kcal: 524, protein: 6.8, carbs: 52, fat: 32 });
    await addOff(APART, { name: "Beef broth", kcal: 90, protein: 2, carbs: 16, fat: 2, allergens: ["celery"] });
    await addUsda(APART, "Swanson Broth Beef", 8);
    await addUsda(USDA_ONLY, "Welch's Orange Juice", 46);
    await addOff(LAST, { name: "Yesterday's biscuit", kcal: 450, protein: 6, carbs: 70, fat: 16, serving: "30 g" });
    app = await buildApp(loadConfig(env), { redis, nutrition: { foodSearchProvider: foods } });
    alice = await session("barcode33-alice@example.com");
    bob = await session("barcode33-bob@example.com");
    const [row] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'barcode33-alice@example.com'`;
    aliceId = row?.id ?? "";
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("the worst thing: a scan gets that product's numbers and allergens, and no other's", async () => {
    const a = await found(NUTELLA);
    expect(a.food).toMatchObject({ canonical: `pack_${NUTELLA}`, name: "Nutella", kcal: 539, proteinG: 6.3, source: "openfoodfacts" });
    expect(a.allergens).toEqual(["milk", "nuts", "soybeans"]);
    const b = await found(PRINCE);
    expect(b.food).toMatchObject({ canonical: `pack_${PRINCE}`, kcal: 467 });
    expect(b.allergens).toEqual(["eggs", "gluten"]);
    expect(b.mayContain).toEqual(["eggs"]);
  });

  it("the worst thing: a row under a store's own, a misread or a book's code is never read", async () => {
    for (const code of ["00002523", "0200024010652", "12345678", "9780141026626"]) {
      await addOff(code, { name: "A row that must never be shown", kcal: 100, protein: 1, carbs: 1, fat: 1 });
    }
    expect(await look("00002523")).toEqual({ status: "store_only" });
    expect(await look("0200024010652")).toEqual({ status: "store_only" });
    expect(await look("12345678")).toEqual({ status: "bad_code" });
    expect(await look("9780141026626")).toEqual({ status: "not_a_food" });
  });

  it("the worst thing: an empty list stays empty, and nothing in the reply can read as safe", async () => {
    const reply = await found(NO_LIST);
    expect(reply.allergens).toEqual([]);
    expect(reply.mayContain).toEqual([]);
    expect(JSON.stringify(reply)).not.toMatch(/safe|free|none/i);
  });

  it("two lists apart: the maker's numbers, the volunteers' allergens, and told to check the pack", async () => {
    const reply = await found(APART);
    expect(reply.food).toMatchObject({ name: "Swanson Broth Beef", kcal: 8, source: "usda" });
    expect(reply.allergens).toEqual(["celery"]);
    expect(reply.check).toBe("lists_differ");
  });

  it("a product only USDA holds is found, starts at its grams and credits USDA", async () => {
    const reply = await found(USDA_ONLY);
    expect(reply.food).toMatchObject({ source: "usda", kcal: 46 });
    expect(reply.food.measures.length).toBeGreaterThan(0);
    expect(reply.allergens).toEqual([]);
  });

  it("a stated zero is found at zero: Coca-Cola Zero", async () => {
    const reply = await found(ZERO);
    expect(reply.food.kcal).toBe(0);
    expect(reply.check).toBe("fine");
  });

  it("the same pack by its 12, 13 and 14 digits is one product", async () => {
    const upc = twelveDigits();
    await addOff(`0${upc}`, { name: "A US can", kcal: 42, protein: 0, carbs: 10.6, fat: 0 });
    for (const asked of [upc, `0${upc}`, `00${upc}`]) {
      const reply = await found(asked);
      expect(reply.code).toBe(`0${upc}`);
      expect(reply.food.name).toBe("A US can");
    }
  });

  it("not on either list: not found, and nothing left this server", async () => {
    asked.length = 0;
    const fetching = vi.spyOn(globalThis, "fetch");
    expect(await look(NOT_LISTED)).toEqual({ status: "not_found", code: NOT_LISTED });
    await found(NUTELLA);
    expect(asked).toEqual([]);
    expect(fetching).not.toHaveBeenCalled();
    fetching.mockRestore();
  });

  it("a stranger gets 401, and anything but digits is refused", async () => {
    expect((await inject("GET", `/v1/nutrition/barcode/${NUTELLA}`, "")).statusCode).toBe(401);
    expect((await inject("GET", "/v1/nutrition/barcode/abc", alice)).statusCode).toBe(400);
    expect((await inject("GET", "/v1/nutrition/barcode/1234567", alice)).statusCode).toBe(400);
    expect((await inject("GET", `/v1/nutrition/barcode/${"1".repeat(15)}`, alice)).statusCode).toBe(400);
  });

  it("at one address, one person's scans never use up another's: a gym's wi-fi", async () => {
    const key = `rl:nutrition_barcode:id:${aliceId}`;
    for (let at = 0; at < 120; at++) await redis.incrWithTtl(key, 60);
    const refused = await inject("GET", `/v1/nutrition/barcode/${NUTELLA}`, alice);
    expect(refused.statusCode).toBe(429);
    expect((await inject("GET", `/v1/nutrition/barcode/${NUTELLA}`, bob)).statusCode).toBe(200);
    await redis.del(key);
  });

  it("uses none of a person's photo scans", async () => {
    await found(PRINCE);
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    expect(await redis.get(`quota:meal_scan:${aliceId}:${day}`)).toBeNull();
  });

  describe("a product past its day: nothing about it depends on a cache", () => {
    const logged = z.object({ meal: z.object({ id: z.string(), itemsVersion: z.string(), items: z.array(z.object({ canonical: z.string(), kcalPoint: z.number(), gramsPoint: z.number(), nutritionSource: z.string() })) }) });

    it.each([
      ["a scanned code", `pack_${LAST}`],
      ["the food search's name for it", `off_${LAST}`],
    ])("%s is saved, stays in Recent, and its amount can be changed", async (_name, canonical) => {
      const saved = await inject("POST", "/v1/nutrition/meals", alice, { mealName: "Biscuits", takenAt: new Date().toISOString(), items: [{ canonical, grams: 100 }] });
      expect(saved.statusCode, saved.body).toBe(201);
      const meal = logged.parse(saved.json()).meal;
      expect(meal.items[0]).toMatchObject({ canonical, kcalPoint: 450, nutritionSource: "openfoodfacts" });

      const recent = await inject("GET", "/v1/nutrition/foods/recent", alice);
      expect(recent.statusCode, recent.body).toBe(200);
      const items = z.object({ items: z.array(recentFoodSchema) }).parse(recent.json()).items;
      expect(items.map((f) => f.canonical)).toContain(canonical);

      const changed = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items: [{ canonical, grams: 200, from: 0 }], itemsVersion: meal.itemsVersion });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(logged.parse(changed.json()).meal.items[0]).toMatchObject({ kcalPoint: 900, gramsPoint: 200 });
    });

    it("a USDA-only product is priced from its own row, never read as a row of the USDA table", async () => {
      const saved = await inject("POST", "/v1/nutrition/meals", alice, { mealName: "Juice", takenAt: new Date().toISOString(), items: [{ canonical: `pack_${USDA_ONLY}`, grams: 200 }] });
      expect(saved.statusCode, saved.body).toBe(201);
      expect(logged.parse(saved.json()).meal.items[0]).toMatchObject({ kcalPoint: 92, nutritionSource: "usda" });
    });

    it("a code neither list holds is refused on a save, never priced by a guess", async () => {
      const saved = await inject("POST", "/v1/nutrition/meals", alice, { mealName: "None", takenAt: new Date().toISOString(), items: [{ canonical: `pack_${NOT_LISTED}`, grams: 100 }] });
      expect(saved.statusCode).toBe(400);
    });
  });
});
