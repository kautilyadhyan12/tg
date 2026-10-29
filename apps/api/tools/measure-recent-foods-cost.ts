// What the person's previously logged foods cost at the largest a meal list gets (ROADMAP 32b-ii-a):
// a person whose newest 60 meals each hold 30 foods, the most a meal may, ten of them different
// foods, our list's and USDA's. Calls the real route through the app and reports its time and how
// much of it the server spent answering nobody else (the event loop's busy time), as each of the
// ten foods' measures is read too. Run on a local database only, with nothing else using it:
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/measure-recent-foods-cost.ts
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { recentFoodsResponseSchema, type MealItem } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { CURATED_FOODS } from "../src/modules/nutrition/foods.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("DATABASE_URL must be a local database");
const sql = postgres(url, { prepare: false, max: 2 });
const EMAIL = "recent-cost@example.com";
const PASSWORD = "recent-cost-password-1"; // gitleaks:allow

const canonicals = [
  ...CURATED_FOODS.slice(0, 6).map((f) => f.canonical),
  "usda_sr_167512", "usda_sr_167513", "usda_sr_167514", "usda_sr_167515",
];
const item = (canonical: string): MealItem => ({
  name: canonical, canonical, gramsPoint: 100, gramsRange: [100, 100], portionSource: "default",
  nutritionSource: canonical.startsWith("usda_") ? "usda" : "curated", kcalPoint: 150, kcalLow: 150, kcalHigh: 150, proteinG: 5, carbsG: 20, fatG: 4,
  measure: { id: "g", name: "g", amount: 100 },
  more: { fiberG: 1, sugarsG: 1, satFatG: 1, unsatFatG: 1, sodiumMg: 1, potassiumMg: 1, calciumMg: 1, ironMg: 1, magnesiumMg: 1, vitaminDUg: 1 },
});

async function main(): Promise<void> {
  const clean = async () => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email = ${EMAIL})`;
    await sql`DELETE FROM users WHERE email = ${EMAIL}`;
  };
  await clean();
  const env = { NODE_ENV: "test", DATABASE_URL: url, WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "recent-cost-secret-0123456789abcdef-32", LOG_LEVEL: "error" }; // gitleaks:allow
  const app = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { foodSearchProvider: { search: () => Promise.resolve([]) } } });
  await app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: EMAIL, password: PASSWORD, displayName: "Recent cost" } });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: EMAIL, password: PASSWORD } });
  const access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${EMAIL}`;
  if (user === undefined || access === "") throw new Error("no user");
  // 200 meals, the newest 60 of which are read; each meal's 30 foods are one food, so the pick reads
  // all 1,800 of them to find the ten different ones.
  for (let m = 0; m < 200; m += 1) {
    const items = Array.from({ length: 30 }, () => item(canonicals[m % canonicals.length] ?? "oats"));
    await sql`
      INSERT INTO meal_logs (id, user_id, taken_at, meal_name, items, kcal_point, kcal_low, kcal_high,
                             protein_g, carbs_g, fat_g, origin, portion_source, nutrition_sources, calc_version)
      VALUES (${randomUUID()}, ${user.id}, now() - make_interval(mins => ${m}), 'Cost meal', ${sql.json(items)},
              4500, 4500, 4500, 150, 600, 120, 'manual', 'default', ${["usda"]}, 1)`;
  }
  const rounds: { wall: number; busy: number; foods: number }[] = [];
  for (let r = 0; r < 21; r += 1) {
    const before = performance.eventLoopUtilization();
    const t0 = performance.now();
    const res = await app.inject({ method: "GET", url: "/v1/nutrition/foods/recent", cookies: { accessToken: access } });
    const wall = performance.now() - t0;
    const used = performance.eventLoopUtilization(before);
    const foods = recentFoodsResponseSchema.parse(res.json()).items.length;
    if (r > 0) rounds.push({ wall, busy: used.active, foods });
  }
  const sorted = (k: "wall" | "busy") => rounds.map((x) => x[k]).sort((a, b) => a - b);
  const median = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? Number.NaN;
  console.log(`foods listed: ${String(rounds[0]?.foods ?? 0)}`);
  console.log(`route ms: median ${median(sorted("wall")).toFixed(2)}, worst ${(sorted("wall").at(-1) ?? 0).toFixed(2)}`);
  console.log(`server busy ms: median ${median(sorted("busy")).toFixed(2)}, worst ${(sorted("busy").at(-1) ?? 0).toFixed(2)}`);
  await app.close();
  await clean();
  await sql.end({ timeout: 5 });
}

void main();
