// What the person's recent foods cost at the largest a meal list gets (ROADMAP 32b-ii-a): a person
// whose newest 60 meals each hold 30 foods, the most a meal may. Times the database's read and,
// apart from it, the parse and pick that run in the server itself, which is the time it answers
// nobody else. Run on a local database only, with nothing else using it:
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/measure-recent-foods-cost.ts
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { mealItemSchema, type MealItem } from "@app/shared";
import { RECENT_MEALS_READ, recentFoods } from "../src/modules/nutrition/recentFoods.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("DATABASE_URL must be a local database");
const sql = postgres(url, { prepare: false, max: 2 });
const EMAIL = "recent-cost@example.com";

const item = (n: number): MealItem => ({
  name: `Food ${String(n)}`, canonical: `food_${String(n)}`, gramsPoint: 100, gramsRange: [100, 100], portionSource: "default",
  nutritionSource: "usda", kcalPoint: 150, kcalLow: 150, kcalHigh: 150, proteinG: 5, carbsG: 20, fatG: 4,
  measure: { id: "usda-1", name: "cup", amount: 1 },
  more: { fiberG: 1, sugarsG: 1, satFatG: 1, unsatFatG: 1, sodiumMg: 1, potassiumMg: 1, calciumMg: 1, ironMg: 1, magnesiumMg: 1, vitaminDUg: 1 },
});

async function main(): Promise<void> {
  await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email = ${EMAIL})`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${EMAIL}, 'x', 'Recent cost') RETURNING id`;
  if (user === undefined) throw new Error("no user");
  // 200 meals, the newest 60 of which are read; every meal's 30 foods are the same food, the worst
  // case for the pick: it must read every one of them to find ten different foods.
  for (let m = 0; m < 200; m += 1) {
    const items = Array.from({ length: 30 }, () => item(m % 3));
    await sql`
      INSERT INTO meal_logs (id, user_id, taken_at, meal_name, items, kcal_point, kcal_low, kcal_high,
                             protein_g, carbs_g, fat_g, origin, portion_source, nutrition_sources, calc_version)
      VALUES (${randomUUID()}, ${user.id}, now() - make_interval(mins => ${m}), 'Cost meal', ${sql.json(items)},
              4500, 4500, 4500, 150, 600, 120, 'manual', 'default', ${["usda"]}, 1)`;
  }
  // The database's read is waited for; the parse and the pick run in the server itself and answer
  // nobody else while they run. Each timed apart, as the route does them.
  const rounds: { read: number; parse: number; pick: number }[] = [];
  for (let r = 0; r < 20; r += 1) {
    const t0 = performance.now();
    const rows = await sql<{ items: unknown }[]>`
      SELECT items FROM meal_logs WHERE user_id = ${user.id} ORDER BY taken_at DESC, id DESC LIMIT ${RECENT_MEALS_READ}`;
    const t1 = performance.now();
    const meals = rows.map((row) => ({ items: mealItemSchema.array().parse(row.items) }));
    const t2 = performance.now();
    recentFoods(meals);
    const t3 = performance.now();
    rounds.push({ read: t1 - t0, parse: t2 - t1, pick: t3 - t2 });
  }
  const plan = await sql`
    EXPLAIN ANALYZE SELECT items FROM meal_logs WHERE user_id = ${user.id} ORDER BY taken_at DESC, id DESC LIMIT ${RECENT_MEALS_READ}`;
  const sorted = (k: "read" | "parse" | "pick") => rounds.map((x) => x[k]).sort((a, b) => a - b);
  const median = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? Number.NaN;
  console.log(`database read ms: median ${median(sorted("read")).toFixed(2)}, worst ${(sorted("read").at(-1) ?? 0).toFixed(2)}`);
  console.log(`parse in the server ms: median ${median(sorted("parse")).toFixed(2)}, worst ${(sorted("parse").at(-1) ?? 0).toFixed(2)}`);
  console.log(`pick ms: median ${median(sorted("pick")).toFixed(3)}, worst ${(sorted("pick").at(-1) ?? 0).toFixed(3)}`);
  for (const row of plan) console.log(String(Object.values(row)[0]));
  await sql`DELETE FROM meal_logs WHERE user_id = ${user.id}`;
  await sql`DELETE FROM users WHERE id = ${user.id}`;
  await sql.end({ timeout: 5 });
}

void main();
