// ROADMAP 7a-iv-g — changing a food already logged (RULINGS 2026-09-17), through
// the routes a person uses: a logged food's amount changed by one of its measures,
// the person's own numbers typed for it and grown or shrunk with its amount, taken
// away again, a food removed, a scanned estimate typed over and brought back, a
// packaged product no longer in the cache kept or typed over, and a stranger kept
// out of every one of them.
//
// The foods are our list's homemade roti and paneer, both from the UK's CoFID and
// citing no USDA entry, so their measures are the same on a machine with the whole
// USDA table and one without it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { z } from "zod";
import { mealMeasuresResponseSchema, mealPreviewSchema, mealSchema, type Meal, type MealItem } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { CURATED_FOODS } from "../src/modules/nutrition/foods.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import * as repo from "../src/modules/nutrition/repo.js";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn(), httpIntegration: vi.fn() }));
vi.mock("@sentry/node", () => sentry);

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "edit7a-safe-test-password-1"; // gitleaks:allow
const env = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "edit7a-test-secret-0123456789abcdef-3232", // gitleaks:allow
  LOG_LEVEL: "error",
  GROQ_API_KEY: "edit7a-fake-provider-key", // gitleaks:allow
};

const food = (start: string) => {
  const found = CURATED_FOODS.find((f) => f.name.startsWith(start));
  if (found === undefined) throw new Error(`${start} is on the list`);
  return found;
};
const ROTI = food("Roti / Chapati (homemade");
const PANEER = food("Paneer");
const CHANA = food("Chana masala");

/** Every search sent to Open Food Facts, which holds nothing here: a packaged
 *  product's canonical past its day in the cache is found nowhere, and no route
 *  that changes or opens a logged food may search for it by its canonical (the
 *  review of PR #83, L1). */
const searches: string[] = [];
const recordingPackaged: FoodSearchProvider = { search: (query) => { searches.push(query); return Promise.resolve([]); } };

/** A saved item as the server writes one, for the rows no route can make by itself
 *  here: a scan's estimate, and a packaged product no longer in the cache. */
const savedItem = (canonical: string, name: string, grams: number, per100g: { kcal: number; proteinG: number; carbsG: number; fatG: number }, source: "estimate" | "openfoodfacts"): MealItem => ({
  name, canonical, gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", nutritionSource: source,
  kcalPoint: Math.round((per100g.kcal * grams) / 100), kcalLow: Math.round((per100g.kcal * grams) / 100), kcalHigh: Math.round((per100g.kcal * grams) / 100),
  proteinG: Math.round(per100g.proteinG * grams) / 100, carbsG: Math.round(per100g.carbsG * grams) / 100, fatG: Math.round(per100g.fatG * grams) / 100,
  ...(source === "estimate" ? { per100g } : {}),
});

d("changing a food already logged (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 4 });
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let alice = "";
  let bob = "";
  let aliceId = "";

  const api = () => { if (app === undefined) throw new Error("beforeAll did not run"); return app; };
  const inject = (method: "GET" | "POST" | "PATCH", path: string, access: string, body?: unknown) =>
    api().inject({
      method, url: path,
      cookies: access === "" ? {} : { accessToken: access },
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }),
    });
  const session = async (email: string): Promise<string> => {
    await inject("POST", "/v1/auth/register", "", { email, password: PASSWORD, displayName: "Edit fixture" });
    const login = await inject("POST", "/v1/auth/login", "", { email, password: PASSWORD });
    return login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
  };
  const mealOf = (body: string): Meal => mealSchema.parse(z.object({ meal: z.unknown() }).parse(JSON.parse(body)).meal);
  const errorOf = (res: { statusCode: number; json: () => unknown }): [number, string] =>
    [res.statusCode, z.object({ error: z.string() }).parse(res.json()).error];
  const manual = async (items: unknown[]): Promise<Meal> => {
    const res = await inject("POST", "/v1/nutrition/meals", alice, { mealName: "Edit fixture meal", takenAt: new Date().toISOString(), items });
    expect(res.statusCode, res.body).toBe(201);
    return mealOf(res.body);
  };
  /** The meal's items as a screen reads them now: the version its edit sends back. */
  const readAt = async (id: string, access = alice): Promise<string> =>
    mealOf((await inject("GET", `/v1/nutrition/meals/${id}`, access)).body).itemsVersion;
  /** The edit, made from the meal as it is, previewed first, then saved: the
   *  preview must be what is saved. */
  const edit = async (id: string, items: unknown[]): Promise<Meal> => {
    const itemsVersion = await readAt(id);
    const preview = await inject("POST", `/v1/nutrition/meals/${id}/preview`, alice, { items, itemsVersion });
    expect(preview.statusCode, preview.body).toBe(200);
    const saved = await inject("PATCH", `/v1/nutrition/meals/${id}`, alice, { items, itemsVersion });
    expect(saved.statusCode, saved.body).toBe(200);
    const meal = mealOf(saved.body);
    expect(mealPreviewSchema.parse(preview.json())).toEqual({ items: meal.items, totals: meal.totals });
    return meal;
  };
  /** An edit made from the meal as it is, the answer not checked. */
  const send = async (method: "POST" | "PATCH", id: string, items: unknown[], access = alice) =>
    inject(method, method === "POST" ? `/v1/nutrition/meals/${id}/preview` : `/v1/nutrition/meals/${id}`, access, { items, itemsVersion: await readAt(id) });
  /** What a person reads of each food: its numbers and where they are from. */
  const read = (meal: Meal) => meal.items.map((i) => [i.canonical, i.gramsPoint, i.kcalPoint, i.proteinG, i.carbsG, i.fatG, i.nutritionSource]);
  const clean = async (): Promise<void> => {
    await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'edit7a-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'edit7a-%@example.com'`;
  };

  beforeAll(async () => {
    await clean();
    app = await buildApp(loadConfig(env), { redis: createMemoryRedis(), nutrition: { foodSearchProvider: recordingPackaged } });
    alice = await session("edit7a-alice@example.com");
    bob = await session("edit7a-bob@example.com");
    const [row] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = 'edit7a-alice@example.com'`;
    aliceId = row?.id ?? "";
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    await clean();
    await sql.end({ timeout: 5 });
  });

  it("changes a logged food's amount by one of its measures and keeps the others exactly as saved", async () => {
    const meal = await manual([{ canonical: ROTI.canonical, measure: "serving", amount: 2 }, { canonical: PANEER.canonical, grams: 150 }]);
    const [, paneer] = meal.items;
    // Three rotis of 40 g: 120 g at 202 kcal per 100 g, 242 kcal.
    const changed = await edit(meal.id, [{ canonical: ROTI.canonical, measure: "serving", amount: 3, from: 0 }, { from: 1 }]);
    expect(read(changed)[0]).toEqual([ROTI.canonical, 120, 242, 8.8, 52.4, 1.2, "curated"]);
    expect(changed.items[0]?.measure).toEqual({ id: "serving", name: "roti", amount: 3 });
    expect(changed.items[1]).toEqual(paneer);
    expect(changed.totals.kcalPoint).toBe(242 + (paneer?.kcalPoint ?? Number.NaN));

    // By the gram, the measure is gone: the item holds grams now.
    const grams = await edit(meal.id, [{ canonical: ROTI.canonical, grams: 60, from: 0 }, { from: 1 }]);
    expect([grams.items[0]?.gramsPoint, grams.items[0]?.kcalPoint, grams.items[0]?.measure]).toEqual([60, 121, undefined]);

    // A measure the food does not have, or an amount no item may weigh, is refused.
    expect(errorOf(await send("PATCH", meal.id, [{ canonical: PANEER.canonical, measure: "serving", amount: 1, from: 1 }]))).toEqual([400, "unknown_measure"]);
    expect(errorOf(await send("POST", meal.id, [{ canonical: ROTI.canonical, measure: "serving", amount: 300, from: 0 }]))).toEqual([400, "portion_out_of_range"]);
  }, 60_000);

  it("takes the person's own numbers, works out their calories, grows them with the amount, and gives them back", async () => {
    const meal = await manual([{ canonical: ROTI.canonical, measure: "serving", amount: 1 }, { canonical: PANEER.canonical, grams: 150 }]);
    const [roti] = meal.items;

    // A label's numbers for 150 g: 30 g protein, 3 g carbs, 20 g fat — 120 + 12 + 180 kcal.
    const typed = await edit(meal.id, [{ from: 0 }, { canonical: PANEER.canonical, grams: 150, from: 1, own: { proteinG: 30, carbsG: 3, fatG: 20 } }]);
    expect(read(typed)[1]).toEqual([PANEER.canonical, 150, 312, 30, 3, 20, "own"]);
    const figures = typed.items[1]?.per100g;
    for (const [key, value] of [["kcal", 208], ["proteinG", 20], ["carbsG", 2], ["fatG", 40 / 3]] as const) expect(figures?.[key], key).toBeCloseTo(value, 9);
    expect(typed.items[1]?.scanEstimate).toBeUndefined();
    expect(typed.items[0]).toEqual(roti);
    expect(typed.nutritionSources.sort()).toEqual(["curated", "own"]);

    // Twice the amount, the numbers left out: twice the numbers, still the person's.
    const doubled = await edit(meal.id, [{ from: 0 }, { canonical: PANEER.canonical, grams: 300, from: 1 }]);
    expect(read(doubled)[1]).toEqual([PANEER.canonical, 300, 624, 60, 6, 40, "own"]);

    // Another food changed beside it, or a food added: the numbers stay the person's.
    const added = await edit(meal.id, [{ canonical: ROTI.canonical, measure: "serving", amount: 2, from: 0 }, { from: 1 }, { canonical: food("Chana masala").canonical, measure: "serving", amount: 1 }]);
    expect(read(added)[1]).toEqual(read(doubled)[1]);
    expect(added.items.map((i) => i.nutritionSource)).toEqual(["curated", "own", "curated"]);

    // The unnamed old way of sending the meal back keeps them too, by the item's place.
    const resent = await edit(meal.id, added.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })));
    expect(read(resent)).toEqual(read(added));

    // New numbers typed over them, for the amount as it is now.
    const retyped = await edit(meal.id, [{ from: 0 }, { canonical: PANEER.canonical, grams: 300, from: 1, own: { proteinG: 45, carbsG: 0, fatG: 30 } }, { from: 2 }]);
    expect(read(retyped)[1]).toEqual([PANEER.canonical, 300, 450, 45, 0, 30, "own"]);

    // Taken away: the food list's numbers for 300 g of paneer, 328 kcal per 100 g.
    const back = await edit(meal.id, [{ from: 0 }, { canonical: PANEER.canonical, grams: 300, from: 1, own: null }, { from: 2 }]);
    expect(read(back)[1]).toEqual([PANEER.canonical, 300, 984, 78, 2.7, 73.5, "curated"]);
    expect(back.items[1]?.per100g).toBeUndefined();

    // Numbers heavier than the food itself are no numbers.
    const heavy = await send("PATCH", meal.id, [{ canonical: PANEER.canonical, grams: 150, from: 1, own: { proteinG: 100, carbsG: 40, fatG: 20 } }]);
    expect(errorOf(heavy)).toEqual([400, "own_numbers_too_heavy"]);
    expect(z.object({ message: z.string() }).parse(heavy.json()).message).toBe("Protein, carbs and fat together can't weigh more than the food itself (150 g).");
    const unchanged = await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice);
    expect(read(mealOf(unchanged.body))).toEqual(read(back));
  }, 60_000);

  it("removes a food from a meal, and keeps one food's twin apart from it", async () => {
    const meal = await manual([{ canonical: ROTI.canonical, measure: "serving", amount: 1 }, { canonical: PANEER.canonical, grams: 100 }, { canonical: ROTI.canonical, measure: "serving", amount: 2 }]);
    // Own numbers on the SECOND roti only.
    const typed = await edit(meal.id, [{ from: 0 }, { from: 1 }, { canonical: ROTI.canonical, measure: "serving", amount: 2, from: 2, own: { proteinG: 10, carbsG: 30, fatG: 4 } }]);
    expect(typed.items.map((i) => i.nutritionSource)).toEqual(["curated", "curated", "own"]);

    // The first roti removed: the one left is the person's, at its two rotis.
    const removed = await edit(meal.id, [{ from: 1 }, { from: 2 }]);
    expect(read(removed)).toEqual([read(typed)[1], read(typed)[2]]);
    expect(removed.totals.kcalPoint).toBe((typed.items[1]?.kcalPoint ?? 0) + (typed.items[2]?.kcalPoint ?? 0));

    // Changing the amount of the remaining roti grows the person's numbers with it.
    const three = await edit(meal.id, [{ from: 0 }, { canonical: ROTI.canonical, measure: "serving", amount: 3, from: 1 }]);
    // 40 + 120 + 36 = 196 kcal for two rotis; three are 294.
    expect(read(three)[1]).toEqual([ROTI.canonical, 120, 294, 15, 45, 6, "own"]);
  }, 60_000);

  it("refuses every edit made from the meal as it was before a food was added in another tab, and keeps that food", async () => {
    const meal = await manual([{ canonical: ROTI.canonical, grams: 40 }, { canonical: PANEER.canonical, grams: 100 }]);
    const tabA = meal.itemsVersion;
    // Tab B adds chana masala.
    const tabB = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items: [{ from: 0 }, { from: 1 }, { canonical: CHANA.canonical, grams: 200 }], itemsVersion: tabA });
    expect(tabB.statusCode, tabB.body).toBe(200);
    const withChana = mealOf(tabB.body);
    expect(withChana.items.map((i) => i.canonical)).toEqual([ROTI.canonical, PANEER.canonical, CHANA.canonical]);
    expect(withChana.itemsVersion).not.toBe(tabA);

    // Tab A still shows two foods: its change, its remove, its add and the old
    // unnamed resend are each refused, saved or previewed.
    for (const items of [
      [{ canonical: ROTI.canonical, grams: 80, from: 0 }, { from: 1 }],
      [{ from: 0 }],
      [{ from: 0 }, { from: 1 }, { canonical: ROTI.canonical, grams: 10 }],
      [{ canonical: ROTI.canonical, grams: 40 }, { canonical: PANEER.canonical, grams: 100 }],
    ]) {
      expect(errorOf(await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items, itemsVersion: tabA })), JSON.stringify(items)).toEqual([409, "meal_changed"]);
      expect(errorOf(await inject("POST", `/v1/nutrition/meals/${meal.id}/preview`, alice, { items, itemsVersion: tabA })), JSON.stringify(items)).toEqual([409, "meal_changed"]);
    }
    const now = mealOf((await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice)).body);
    expect(now.items).toEqual(withChana.items);
    expect(now.itemsVersion).toBe(withChana.itemsVersion);

    // A rename, a new time or a label from tab A sends no items, and keeps tab B's.
    const renamed = await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { mealName: "Renamed in tab A", mealType: "lunch" });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(mealOf(renamed.body).items).toEqual(withChana.items);
  }, 60_000);

  it("lets through only one of two edits sent at the same moment, and checks the items under the row's lock", async () => {
    for (let round = 0; round < 5; round += 1) {
      const meal = await manual([{ canonical: ROTI.canonical, grams: 40 }, { canonical: PANEER.canonical, grams: 100 }]);
      const both = await Promise.all([
        inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items: [{ canonical: ROTI.canonical, grams: 80, from: 0 }, { from: 1 }], itemsVersion: meal.itemsVersion }),
        inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items: [{ from: 0 }], itemsVersion: meal.itemsVersion }),
      ]);
      expect(both.map((r) => r.statusCode).sort(), both.map((r) => r.body).join(" | ")).toEqual([200, 409]);
      const winner = both.find((r) => r.statusCode === 200);
      expect(read(mealOf((await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice)).body))).toEqual(read(mealOf(winner?.body ?? "")));
    }

    // Under the lock itself: items worked out from any other state write nothing,
    // and a patch with no items keeps the items the row holds.
    const meal = await manual([{ canonical: ROTI.canonical, grams: 40 }]);
    const moved = await edit(meal.id, [{ canonical: ROTI.canonical, grams: 60, from: 0 }]);
    await expect(repo.updateMeal(sql, aliceId, meal.id, { items: { items: meal.items, readAt: meal.itemsVersion } })).rejects.toBeInstanceOf(repo.MealChangedError);
    const renamed = await repo.updateMeal(sql, aliceId, meal.id, { mealName: "Renamed" });
    expect(renamed?.items).toEqual(moved.items);
    expect(renamed?.mealName).toBe("Renamed");
  }, 60_000);

  it("refuses places that name no item or another food, and an edit that says nothing of what it read", async () => {
    const meal = await manual([{ canonical: ROTI.canonical, grams: 40 }, { canonical: PANEER.canonical, grams: 100 }]);
    expect(errorOf(await send("PATCH", meal.id, [{ from: 2 }]))).toEqual([409, "meal_changed"]);
    expect(errorOf(await send("PATCH", meal.id, [{ canonical: PANEER.canonical, grams: 50, from: 0 }]))).toEqual([409, "meal_changed"]);
    expect(errorOf(await send("POST", meal.id, [{ from: 5 }]))).toEqual([409, "meal_changed"]);
    expect(errorOf(await send("PATCH", meal.id, [{ from: 0 }, { from: 0 }]))).toEqual([400, "validation_error"]);
    expect(errorOf(await send("POST", meal.id, []))).toEqual([400, "validation_error"]);
    expect(errorOf(await send("POST", meal.id, [{ from: 0, grams: 10 }]))).toEqual([400, "validation_error"]);
    // Items with no version, or a version with no items: no edit.
    expect(errorOf(await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items: [{ from: 0 }] }))).toEqual([400, "validation_error"]);
    expect(errorOf(await inject("POST", `/v1/nutrition/meals/${meal.id}/preview`, alice, { items: [{ from: 0 }] }))).toEqual([400, "validation_error"]);
    expect(errorOf(await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { itemsVersion: meal.itemsVersion }))).toEqual([400, "validation_error"]);
    // A version no state of the items ever had.
    expect(errorOf(await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, alice, { items: [{ from: 0 }, { from: 1 }], itemsVersion: "not-a-version" }))).toEqual([409, "meal_changed"]);
    // Nothing was changed by any of them.
    expect(read(mealOf((await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice)).body))).toEqual(read(meal));
  }, 60_000);

  it("types over a scanned estimate and brings the estimate back; a packaged product no longer found is kept, or typed over", async () => {
    const estimate = { kcal: 250, proteinG: 5, carbsG: 30, fatG: 12 };
    const row = await repo.createMeal(sql, aliceId, {
      takenAt: new Date(), mealType: null, mealName: "Scanned fixture", origin: "photo",
      items: [
        savedItem("est_zqxedit_fritter", "Zqxedit fritter", 100, estimate, "estimate"),
        savedItem("off_zqxedit_gone", "Zqxedit bar · Brand", 50, { kcal: 400, proteinG: 10, carbsG: 60, fatG: 14 }, "openfoodfacts"),
        { ...savedItem("est_zqxedit_other", "Zqxedit dip", 30, { kcal: 100, proteinG: 2, carbsG: 8, fatG: 7 }, "estimate") },
      ],
    });
    const [fritter, bar, dip] = row.items;
    searches.length = 0;

    // Each food's measures: an estimate, and a product no longer found, by grams and ounces.
    const measures = await inject("GET", `/v1/nutrition/meals/${row.id}/measures`, alice);
    expect(measures.statusCode, measures.body).toBe(200);
    expect(mealMeasuresResponseSchema.parse(measures.json()).measures.map((m) => m.map((x) => x.id))).toEqual([["g", "oz"], ["g", "oz"], ["g", "oz"]]);

    // The estimate's amount changed: priced by the figures the item carries.
    const grown = await edit(row.id, [{ canonical: "est_zqxedit_fritter", grams: 200, from: 0 }, { from: 1 }, { from: 2 }]);
    expect(read(grown)[0]).toEqual(["est_zqxedit_fritter", 200, 500, 10, 60, 24, "estimate"]);
    expect(grown.items[1]).toEqual(bar);

    // Typed over: the person's numbers, and the scan's estimate kept.
    const typed = await edit(row.id, [{ canonical: "est_zqxedit_fritter", grams: 200, from: 0, own: { proteinG: 8, carbsG: 50, fatG: 20 } }, { from: 1 }, { from: 2 }]);
    expect(read(typed)[0]).toEqual(["est_zqxedit_fritter", 200, 412, 8, 50, 20, "own"]);
    expect(typed.items[0]?.scanEstimate).toEqual(estimate);
    // Its amount changed, still the person's, the estimate still kept.
    const halved = await edit(row.id, [{ canonical: "est_zqxedit_fritter", grams: 100, from: 0 }, { from: 1 }, { from: 2 }]);
    expect(read(halved)[0]).toEqual(["est_zqxedit_fritter", 100, 206, 4, 25, 10, "own"]);
    expect(halved.items[0]?.scanEstimate).toEqual(estimate);
    // Taken away: the scan's estimate at the amount it holds now.
    const back = await edit(row.id, [{ canonical: "est_zqxedit_fritter", grams: 100, from: 0, own: null }, { from: 1 }, { from: 2 }]);
    expect(back.items[0]).toEqual({ ...fritter, measure: undefined });
    expect(back.items[0]?.scanEstimate).toBeUndefined();

    // The product no longer found: its amount cannot be priced again by a table...
    expect(errorOf(await send("POST", row.id, [{ from: 0 }, { canonical: "off_zqxedit_gone", grams: 100, from: 1 }, { from: 2 }]))).toEqual([400, "unknown_food"]);
    // ...but typed over, it is weighed by the gram and priced by the person's numbers,
    const ownBar = await edit(row.id, [{ from: 0 }, { canonical: "off_zqxedit_gone", grams: 50, from: 1, own: { proteinG: 6, carbsG: 30, fatG: 8 } }, { from: 2 }]);
    expect(read(ownBar)[1]).toEqual(["off_zqxedit_gone", 50, 216, 6, 30, 8, "own"]);
    expect(ownBar.items[1]?.name).toBe("Zqxedit bar · Brand");
    // and then grown with its amount, with no table asked.
    const twoBars = await edit(row.id, [{ from: 0 }, { canonical: "off_zqxedit_gone", grams: 100, from: 1 }, { from: 2 }]);
    expect(read(twoBars)[1]).toEqual(["off_zqxedit_gone", 100, 432, 12, 60, 16, "own"]);
    // Taking the numbers away asks the table, which has nothing: refused, not guessed.
    expect(errorOf(await send("PATCH", row.id, [{ from: 0 }, { canonical: "off_zqxedit_gone", grams: 100, from: 1, own: null }, { from: 2 }]))).toEqual([400, "unknown_food"]);
    // A food the scan estimated is never a food new to a meal: nothing is priced by
    // a name a request sends.
    expect(errorOf(await send("PATCH", row.id, [{ from: 0 }, { from: 1 }, { from: 2 }, { canonical: "est_zqxedit_fritter", grams: 100, own: { proteinG: 1, carbsG: 1, fatG: 1 } }]))).toEqual([400, "unknown_food"]);
    expect(dip).toBeDefined();
    // Not one of the opens, previews and saves above searched Open Food Facts for
    // the product by its canonical, which could only find another product.
    expect((await inject("GET", `/v1/nutrition/meals/${row.id}/measures`, alice)).statusCode).toBe(200);
    expect(searches).toEqual([]);
  }, 60_000);

  it("gives each food of a meal its measures", async () => {
    const meal = await manual([{ canonical: ROTI.canonical, grams: 40 }, { canonical: PANEER.canonical, grams: 100 }]);
    const res = await inject("GET", `/v1/nutrition/meals/${meal.id}/measures`, alice);
    expect(res.statusCode, res.body).toBe(200);
    const ounce = 28.349523125;
    expect(mealMeasuresResponseSchema.parse(res.json()).measures).toEqual([
      [{ id: "serving", name: "roti", grams: 40 }, { id: "g", name: "g", grams: 1 }, { id: "oz", name: "oz", grams: ounce }],
      // Paneer is served by 100 g, which grams already are.
      [{ id: "g", name: "g", grams: 1 }, { id: "oz", name: "oz", grams: ounce }],
    ]);
  }, 60_000);

  it("keeps a stranger out of every route that changes or reads a logged food", async () => {
    const meal = await manual([{ canonical: ROTI.canonical, grams: 40 }]);
    // Bob holds Alice's meal's id and the version her screen read.
    const change = { items: [{ canonical: ROTI.canonical, grams: 80, from: 0, own: { proteinG: 1, carbsG: 1, fatG: 1 } }], itemsVersion: meal.itemsVersion };
    expect((await inject("POST", `/v1/nutrition/meals/${meal.id}/preview`, bob, change)).statusCode).toBe(404);
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}/measures`, bob)).statusCode).toBe(404);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, bob, change)).statusCode).toBe(404);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, bob, { items: [{ from: 0 }], itemsVersion: meal.itemsVersion })).statusCode).toBe(404);
    expect((await inject("PATCH", `/v1/nutrition/meals/${meal.id}`, bob, { mealName: "Bob's now" })).statusCode).toBe(404);
    expect((await inject("POST", `/v1/nutrition/meals/${meal.id}/preview`, "", change)).statusCode).toBe(401);
    expect((await inject("GET", `/v1/nutrition/meals/${meal.id}/measures`, "")).statusCode).toBe(401);
    expect((await inject("GET", "/v1/nutrition/meals/not-a-meal/measures", alice)).statusCode).toBe(404);
    expect((await inject("POST", "/v1/nutrition/meals/not-a-meal/preview", alice, change)).statusCode).toBe(404);
    // Alice's meal is as she saved it.
    expect(read(mealOf((await inject("GET", `/v1/nutrition/meals/${meal.id}`, alice)).body))).toEqual(read(meal));
  }, 60_000);
});
