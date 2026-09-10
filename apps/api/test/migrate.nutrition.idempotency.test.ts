// P2.7d — end-to-end meals + body stages against real Postgres: rows persist,
// the migrated meal item survives mealItemSchema on read-back, the whole stage
// is idempotent, users.weight_kg is refreshed (GAP-D), and the meal-badge
// recompute (onMealLogged) is idempotent (GAP-E). DATABASE_URL-gated; fixture
// prefix p27d-, cleaned before + after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { mealItemSchema } from "@app/shared";
import { seed } from "../src/db/seed.js";
import { insertUser, transformUser } from "../tools/migrate-mongo/collections/users.js";
import { insertMeal, transformMeal } from "../tools/migrate-mongo/collections/meals.js";
import { insertBody, refreshImportedWeights, refreshUserWeight, transformBody } from "../tools/migrate-mongo/collections/body.js";
import { onMealLogged } from "../src/modules/gamification/service.js";
import { uuidv5 } from "../tools/migrate-mongo/uuid5.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

d("migration meals + body stages: persistence + idempotency + refresh (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });
  const userMongoId = "p27d-user-aaaa1111bbbb2222";
  const userId = uuidv5(userMongoId);

  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id = ${userId}`; // FK RESTRICT — before user
    await sql`DELETE FROM users WHERE legacy_mongo_id LIKE 'p27d-%'`; // cascades body, streaks, achievements
  };

  beforeAll(async () => {
    await seed(url ?? ""); // idempotent; achievements are the onMealLogged FK target
    await clean();
    const u = transformUser({ _id: userMongoId, email: "p27d-n@example.com", fullName: "N User", password: "$2b$10$abcdefghijklmnopqrstuv" });
    expect(u).not.toBeNull();
    if (u !== null) await insertUser(sql, u);
  }, 120_000);
  afterAll(async () => {
    await clean();
    await sql.end({ timeout: 5 });
  }, 30_000);

  it("meal migrates, reads back schema-valid, and is idempotent", async () => {
    const row = transformMeal({
      _id: "p27d-meal-cccc3333dddd4444",
      user_id: userMongoId,
      meal_type: "lunch",
      food_name: "Dal Rice",
      quantity: 1,
      kcal: 520,
      protein_g: 18,
      carbs_g: 80,
      fat_g: 12,
      consumed_at: "2026-05-20T12:00:00Z",
    });
    expect(row).not.toBeNull();
    if (row === null) return;

    expect(await insertMeal(sql, row)).toBe(1);
    expect(await insertMeal(sql, row)).toBe(0); // idempotent

    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM meal_logs WHERE id = ${row.id}`;
    expect(rows[0]?.n).toBe(1);

    // read-back: stored items[] must survive mealItemSchema (else the app 500s)
    const [stored] = await sql<{ items: unknown; kcal_point: number; kcal_low: number; kcal_high: number; origin: string; portion_source: string; nutrition_sources: string[]; calc_version: number }[]>`
      SELECT items, kcal_point, kcal_low, kcal_high, origin, portion_source, nutrition_sources, calc_version
      FROM meal_logs WHERE id = ${row.id}`;
    expect(() => mealItemSchema.array().parse(stored?.items)).not.toThrow();
    expect(stored?.kcal_point).toBe(520);
    expect(stored?.kcal_low).toBe(Math.round(520 * 0.7));
    expect(stored?.kcal_high).toBe(Math.round(520 * 1.3));
    expect(stored?.origin).toBe("manual");
    expect(stored?.portion_source).toBe("legacy");
    expect(stored?.nutrition_sources).toEqual(["legacy_model"]);
    expect(stored?.calc_version).toBe(0);
  }, 60_000);

  it("body migrates idempotently and refreshes users.weight_kg (GAP-D)", async () => {
    const row = transformBody({
      _id: "p27d-body-eeee5555ffff6666",
      user_id: userMongoId,
      measured_at: "2026-05-23T11:27:03Z",
      weight_kg: 75,
      waist_cm: 68,
      body_fat_pct: 20,
    });
    expect(row).not.toBeNull();
    if (row === null) return;

    expect(await insertBody(sql, row)).toBe(1);
    expect(await insertBody(sql, row)).toBe(0); // idempotent
    await refreshUserWeight(sql, userId);

    const [w] = await sql<{ weight_kg: string | null }[]>`SELECT weight_kg FROM users WHERE id = ${userId}`;
    expect(w?.weight_kg === null ? null : Number(w?.weight_kg)).toBe(75);
    const [m] = await sql<{ metrics: Record<string, number> }[]>`SELECT metrics FROM body_measurements WHERE id = ${row.id}`;
    expect(m?.metrics).toEqual({ waist_cm: 68, body_fat_pct: 20 });

    // A user whose imported measurements are ALL weightless keeps the weight
    // the users import carried — and under the one-source rule (RULINGS
    // 2026-09-10) keeping it means giving it a typed row of its own, dated
    // after everything imported, so the live app's first correction to that
    // person's history has something true to fall back to. Idempotent: the
    // second run adds no second row.
    await sql`DELETE FROM body_measurements WHERE user_id = ${userId} AND weight_kg IS NOT NULL`;
    await sql`UPDATE users SET weight_kg = 80 WHERE id = ${userId}`;
    const weightless = transformBody({
      _id: "p27d-body-weightless-0001",
      user_id: userMongoId,
      measured_at: "2026-05-24T11:27:03Z",
      waist_cm: 67,
    });
    expect(weightless).not.toBeNull();
    if (weightless === null) return;
    expect(await insertBody(sql, weightless)).toBe(1);
    await refreshUserWeight(sql, userId);
    await refreshUserWeight(sql, userId);
    const [kept] = await sql<{ weight_kg: string | null }[]>`SELECT weight_kg FROM users WHERE id = ${userId}`;
    expect(kept?.weight_kg === null ? null : Number(kept?.weight_kg)).toBe(80);
    const typed = await sql<{ weight_kg: string | null; newest: boolean }[]>`
      SELECT weight_kg, measured_at > ${weightless.measuredAt} AS newest FROM body_measurements
      WHERE user_id = ${userId} AND source = 'self_reported'`;
    expect(typed).toEqual([{ weight_kg: "80.00", newest: true }]);
  }, 60_000);

  // The body stage refreshes every IMPORTED user, not only the owners of
  // measurement docs: a profile weight with nothing under it is exactly the
  // one that needs its typed row. The empty second set is the point — the
  // stage's old set (measurement owners only) would skip this person.
  it("an imported profile weight with no measurement docs gets its typed row", async () => {
    const mongoId = "p27d-user-weight-no-docs-0001";
    const u = transformUser({ _id: mongoId, email: "p27d-w@example.com", fullName: "W User", password: "$2b$10$abcdefghijklmnopqrstuv", weight: { value: 81, unit: "kg" } });
    expect(u).not.toBeNull();
    if (u === null) return;
    await insertUser(sql, u);

    expect(await refreshImportedWeights(sql, new Set([u.id]), new Set())).toBe(1);
    expect(await refreshImportedWeights(sql, new Set([u.id]), new Set())).toBe(1);
    const rows = await sql<{ weight_kg: string | null; source: string }[]>`
      SELECT weight_kg, source FROM body_measurements WHERE user_id = ${u.id}`;
    expect(rows).toEqual([{ weight_kg: "81.00", source: "self_reported" }]);
    const [w] = await sql<{ weight_kg: string | null }[]>`SELECT weight_kg FROM users WHERE id = ${u.id}`;
    expect(w?.weight_kg).toBe("81.00");
  }, 60_000);

  it("meal recompute (onMealLogged) awards first_meal exactly once (GAP-E)", async () => {
    await onMealLogged({ sql }, userId, null);
    await onMealLogged({ sql }, userId, null); // second run must not double-award

    const [ach] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM user_achievements WHERE user_id = ${userId} AND code = 'first_meal'`;
    expect(ach?.n).toBe(1);
  }, 60_000);
});
