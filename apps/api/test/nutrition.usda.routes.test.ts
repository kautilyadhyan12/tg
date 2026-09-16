// ROADMAP 7a-iii-a — a USDA food through the routes a person actually uses:
// searched, added by grams, saved, and unreadable by anyone else.
//
// The fixture rows are keyed above 90,000,000 and carry the nonsense word
// "zqxroute", so this file finds its own foods whether or not the machine has
// had `tools/import-usda.ts` run against it (see usda.table.test.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { FoodReference, FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { importUsda } from "../tools/usda-table.js";
import { USDA_NUTRIENTS, type UsdaEntry, type UsdaNutrient } from "../tools/usda-files.js";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), httpIntegration: vi.fn() }));
vi.mock("@sentry/node", () => sentry);

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "usda7a-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "usda7a-test-secret-0123456789abcdef-32", // gitleaks:allow
  LOG_LEVEL: "error",
  GROQ_API_KEY: "usda7a-fake-provider-key", // gitleaks:allow
};

const FIRST_ID = 90_000_201;
const LAST_ID = 90_000_299;
const CANONICAL = "usda_fndds_90000201";

/** The fixture food's own numbers per 100 g — deliberately not round, so
 *  "× grams ÷ 100" is a real check rather than one any scale would pass. */
const PER_100G = { kcal: 213, proteinG: 11.5, carbsG: 27.3, fatG: 6.4, fiberG: 2.1 } as const;

const fixture = (fdcId: number, description: string): UsdaEntry => {
  const figures = new Map<UsdaNutrient, number | null>();
  // Every other nutrient gets its own distinct value, so a column read back from
  // the wrong one would show.
  for (const [at, n] of USDA_NUTRIENTS.entries()) figures.set(n.key, at + 1);
  figures.set("kcal", PER_100G.kcal);
  figures.set("proteinG", PER_100G.proteinG);
  figures.set("carbsG", PER_100G.carbsG);
  figures.set("fatG", PER_100G.fatG);
  figures.set("fiberG", PER_100G.fiberG);
  return { fdcId, description, figures, portions: [{ seqNum: 1, amount: null, unit: "1 cup", gramWeight: 240 }] };
};

/** A packaged-product provider that says which queries reached it — a usda_*
 *  canonical must never be one of them. */
function recordingOff(): FoodSearchProvider & { asked: string[] } {
  const product: FoodReference = {
    canonical: "off_zqxroute", name: "Zqxroute bottled coffee", kcal: 44, proteinG: 1, carbsG: 8,
    fatG: 1, fiberG: 0, serving: 250, unit: "bottle", source: "openfoodfacts",
  };
  return { asked: [], search(query) { this.asked.push(query); return Promise.resolve([product]); } };
}

d("a USDA food through the food routes (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  const off = recordingOff();
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let cookieA = "";
  let cookieB = "";
  let mealId = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST", path: string, access: string, body?: unknown) =>
    api().inject({
      method, url: path,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const session = async (email: string): Promise<string> => {
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "USDA fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'usda7a-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'usda7a-%@example.com'`;
    await sql`DELETE FROM usda_food_portions WHERE fdc_id BETWEEN ${FIRST_ID} AND ${LAST_ID}`;
    await sql`DELETE FROM usda_foods WHERE fdc_id BETWEEN ${FIRST_ID} AND ${LAST_ID}`;
  };

  beforeAll(async () => {
    await clean();
    await importUsda(sql, [
      [
        "fndds",
        [
          fixture(90_000_201, "Zqxroute cappuccino, whole milk"),
          // "paneer" is on the curated list too, which is how the order test
          // reaches the USDA rung with a word a person would really type.
          fixture(90_000_202, "Paneer, zqxroute style"),
        ],
      ],
    ]);
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { foodSearchProvider: off } });
    cookieA = await session("usda7a-alice@example.com");
    cookieB = await session("usda7a-bob@example.com");
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    await sql.end({ timeout: 5 });
  });

  it("finds the food, names USDA as its source, and gives it the measure USDA lists", async () => {
    const res = await inject("GET", "/v1/nutrition/foods?q=zqxroute%20cappuccino&limit=10", cookieA);
    expect(res.statusCode, res.body).toBe(200);
    const items = res.json<{ items: FoodReference[] }>().items;
    expect(items[0]).toMatchObject({
      canonical: CANONICAL,
      name: "Zqxroute cappuccino, whole milk",
      source: "usda",
      kcal: PER_100G.kcal,
      proteinG: PER_100G.proteinG,
      fiberG: PER_100G.fiberG,
      serving: 240,
      unit: "cup",
    });
  });

  /** The order Kd chose on 2026-09-16, read off the response as a list of
   *  sources. No source may appear after one that ranks below it. */
  const inOrder = (sources: readonly ("curated" | "usda" | "openfoodfacts")[]): boolean => {
    const rank = { curated: 0, usda: 1, openfoodfacts: 2 };
    return sources.every((s, at) => at === 0 || rank[sources[at - 1] ?? s] <= rank[s]);
  };
  const sourcesFor = async (query: string): Promise<("curated" | "usda" | "openfoodfacts")[]> => {
    const res = await inject("GET", `/v1/nutrition/foods?q=${encodeURIComponent(query)}&limit=10`, cookieA);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ items: FoodReference[] }>().items.map((i) => i.source);
  };

  it("puts our own list before USDA (Kd, 2026-09-16)", async () => {
    // "paneer" is on the curated list AND in a USDA fixture, so both rungs
    // answer: the curated Paneer must come first, because its numbers are the
    // ones Kd ruled on 2026-09-14 and USDA's own paneer entry is the one he
    // rejected.
    const sources = await sourcesFor("paneer");
    expect(sources).toContain("curated");
    expect(sources).toContain("usda");
    expect(sources[0]).toBe("curated");
    expect(inOrder(sources), sources.join(" ")).toBe(true);
  });

  it("puts USDA before packaged products", async () => {
    // Only the fixtures hold "zqxroute", so USDA cannot fill the page and the
    // packaged product is reached — in CI and on a machine with the whole table.
    const sources = await sourcesFor("zqxroute");
    expect(sources).toContain("usda");
    expect(sources).toContain("openfoodfacts");
    expect(sources[0]).toBe("usda");
    expect(inOrder(sources), sources.join(" ")).toBe(true);
  });

  it("saves it by grams with the table's numbers scaled, and nothing else's", async () => {
    const created = await inject("POST", "/v1/nutrition/meals", cookieA, {
      mealName: "Zqxroute morning",
      takenAt: new Date().toISOString(),
      items: [{ canonical: CANONICAL, grams: 250 }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const meal = created.json<{ meal: { id: string; origin: string; items: Record<string, unknown>[]; totals: Record<string, number> } }>().meal;
    mealId = meal.id;
    expect(meal.origin).toBe("manual");
    // 250 g of the fixture: 213 × 2.5 = 532.5 → 533 kcal; 11.5 × 2.5 = 28.75 → 28.8 g
    // of protein; 27.3 × 2.5 = 68.25 → 68.3 g of carbohydrate; 6.4 × 2.5 = 16 g of fat.
    expect(meal.items).toHaveLength(1);
    expect(meal.items[0]).toMatchObject({
      canonical: CANONICAL,
      name: "Zqxroute cappuccino, whole milk",
      nutritionSource: "usda",
      gramsPoint: 250,
      kcalPoint: 533,
      proteinG: 28.8,
      carbsG: 68.3,
      fatG: 16,
    });
    expect(meal.totals["kcalPoint"]).toBe(533);
  });

  it("reads back for its owner and 404s for anyone else", async () => {
    const mine = await inject("GET", `/v1/nutrition/meals/${mealId}`, cookieA);
    expect(mine.statusCode).toBe(200);
    expect(mine.json<{ meal: { items: { nutritionSource: string }[] } }>().meal.items[0]?.nutritionSource).toBe("usda");
    expect((await inject("GET", `/v1/nutrition/meals/${mealId}`, cookieB)).statusCode).toBe(404);
    expect((await inject("GET", `/v1/nutrition/meals/${mealId}`, "")).statusCode).toBe(401);
  });

  it("refuses a USDA canonical the table does not hold, and never asks Open Food Facts about one", async () => {
    off.asked.length = 0;
    const res = await inject("POST", "/v1/nutrition/meals", cookieA, {
      mealName: "Not a food",
      takenAt: new Date().toISOString(),
      items: [{ canonical: "usda_fndds_90000299", grams: 100 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("unknown_food");
    // Falling through would send "usda_fndds_90000299" to their search index,
    // where the top hit for it could only ever be the wrong food.
    expect(off.asked).toEqual([]);
  });
});
