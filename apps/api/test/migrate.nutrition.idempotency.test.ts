// P2.7d — end-to-end meals + body stages against real Postgres: rows persist,
// the migrated meal item survives mealItemSchema on read-back, the whole stage
// is idempotent, the legacy profile weight becomes a typed row only when no
// imported measurement carries a weight (GAP-D), and the meal-badge recompute
// (onMealLogged) is idempotent (GAP-E). DATABASE_URL-gated; fixture prefix
// p27d-, cleaned before + after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { mealItemSchema } from "@app/shared";
import { seed } from "../src/db/seed.js";
import { currentWeightKg } from "../src/modules/nutrition/repo.js";
import { insertUser, transformUser } from "../tools/migrate-mongo/collections/users.js";
import { insertMeal, transformMeal } from "../tools/migrate-mongo/collections/meals.js";
import { insertBody, recordLegacyProfileWeight, recordLegacyProfileWeights, transformBody } from "../tools/migrate-mongo/collections/body.js";
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

  it("body migrates idempotently; the history wins over the legacy profile weight (GAP-D)", async () => {
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
    const [m] = await sql<{ metrics: Record<string, number> }[]>`SELECT metrics FROM body_measurements WHERE id = ${row.id}`;
    expect(m?.metrics).toEqual({ waist_cm: 68, body_fat_pct: 20 });

    // The legacy profile said 85, undated; the imported weigh-in says 75 on a
    // date. The history wins: no typed row is written, and the live app reads 75.
    expect(await recordLegacyProfileWeight(sql, userId, 85)).toBe(0);
    expect(await currentWeightKg(sql, userId)).toBe(75);
    expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM body_measurements WHERE user_id = ${userId} AND source = 'self_reported'`)[0]?.n).toBe(0);

    // A user whose imported measurements are ALL weightless keeps the weight
    // the legacy profile carried — and under the one-source rule (RULINGS
    // 2026-09-10) keeping it means giving it a typed row of its own, so the
    // live app's first correction to that person's history has something
    // true to fall back to. Idempotent: the second run adds no second row.
    await sql`DELETE FROM body_measurements WHERE user_id = ${userId} AND weight_kg IS NOT NULL`;
    const weightless = transformBody({
      _id: "p27d-body-weightless-0001",
      user_id: userMongoId,
      measured_at: "2026-05-24T11:27:03Z",
      waist_cm: 67,
    });
    expect(weightless).not.toBeNull();
    if (weightless === null) return;
    expect(await insertBody(sql, weightless)).toBe(1);
    expect(await recordLegacyProfileWeight(sql, userId, 80)).toBe(1);
    expect(await recordLegacyProfileWeight(sql, userId, 80)).toBe(0);
    expect(await currentWeightKg(sql, userId)).toBe(80);
    const typed = await sql<{ weight_kg: string | null }[]>`
      SELECT weight_kg FROM body_measurements WHERE user_id = ${userId} AND source = 'self_reported'`;
    expect(typed).toEqual([{ weight_kg: "80.00" }]);
  }, 60_000);

  // The body stage's last step runs for every IMPORTED user, not only the
  // owners of measurement docs: a profile weight with nothing under it is
  // exactly the one that needs its typed row; a person with no legacy weight
  // gets nothing.
  it("an imported profile weight with no measurement docs gets its typed row", async () => {
    const mongoId = "p27d-user-weight-no-docs-0001";
    const u = transformUser({ _id: mongoId, email: "p27d-w@example.com", fullName: "W User", password: "$2b$10$abcdefghijklmnopqrstuv", weight: { value: 81, unit: "kg" } });
    const none = transformUser({ _id: "p27d-user-no-weight-0001", email: "p27d-nw@example.com", fullName: "NW User", password: "$2b$10$abcdefghijklmnopqrstuv" });
    expect(u).not.toBeNull();
    expect(none).not.toBeNull();
    if (u === null || none === null) return;
    await insertUser(sql, u);
    await insertUser(sql, none);

    const legacy = new Map([[u.id, u.weightKg], [none.id, none.weightKg]]);
    expect(await recordLegacyProfileWeights(sql, legacy)).toBe(1);
    expect(await recordLegacyProfileWeights(sql, legacy)).toBe(0);
    const rows = await sql<{ weight_kg: string | null; source: string }[]>`
      SELECT weight_kg, source FROM body_measurements WHERE user_id = ${u.id}`;
    expect(rows).toEqual([{ weight_kg: "81.00", source: "self_reported" }]);
    expect(await currentWeightKg(sql, u.id)).toBe(81);
    expect(await currentWeightKg(sql, none.id)).toBeNull();
  }, 60_000);

  it("meal recompute (onMealLogged) awards first_meal exactly once (GAP-E)", async () => {
    await onMealLogged({ sql }, userId, null);
    await onMealLogged({ sql }, userId, null); // second run must not double-award

    const [ach] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM user_achievements WHERE user_id = ${userId} AND code = 'first_meal'`;
    expect(ach?.n).toBe(1);
  }, 60_000);
});
