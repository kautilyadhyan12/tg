// THE GYM'S MEAL PLAN ON THE PHONE — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 5 item 31g; spec Part 6 §16.6. Where the choice starts is table-tested in
// `nutrition.foodChoice.routes.test.ts`; this file proves the wiring and the gates.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): a member
// shown a plan their gym did not give them, or another gym's. The second: a day under what the person
// may eat (under what keeps the weight for a yes on the health question, or under the app's floor for
// anybody) shown with no line saying so. Under 18 holds no cut by the same rule (`lowestKcalOf`), but
// setup no longer takes an age under 18.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  DIET_LABEL_CAUTION, MY_GYM_MEAL_PLANS_PATH, dietPlanResponseSchema, nutritionTargetsResponseSchema, gymMealPlanGivenToSelectedResponseSchema, gymMealPlanResponseSchema, myGymMealPlansResponseSchema,
  type DietPlanResponse, type MyGymMealPlansResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-meal-plan-choice-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};
const noExternal: FoodSearchProvider = { search: () => Promise.resolve([]) };
const ADULT = {
  weightGoal: "maintain", age: 30, gender: "female", heightCm: 165, weightKg: 70,
  dayActivity: "sitting", trainingDays: 3, sessionMinutes: 45, diet: "non_vegetarian", mealsPerDay: 3,
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface CreatedOrg { org: { id: string } }
interface Person { userId: string; email: string; cookies: Cookies }
type Res = { statusCode: number; body: string };

const T = 240_000;
const LIVE_PLAN = "zz_gym_meal_plan_choice";
const MAIL = "gmchoice-t-";
// About 1,100 kcal: under the app's 1,200 floor for anybody.
const SMALL_DAY = [
  { mealType: "breakfast", items: [{ canonical: "banana", grams: 118 }] },
  { mealType: "lunch", items: [{ canonical: "rice", grams: 180 }] },
];

let ipCounter = 0;
const nextIp = () => `10.95.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let uniqN = 0;
const uniq = () => `${String(Date.now())}${String(uniqN++)}`;

d("the gym's meal plan on the phone (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const people = () => sql`SELECT id FROM users WHERE email LIKE ${MAIL + "%@example.com"}`;
  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (${people()})`;
  const cleanup = async () => {
    await sql`DELETE FROM recommended_choices WHERE user_id IN (${people()})`;
    await sql`DELETE FROM diet_plans WHERE user_id IN (${people()})`;
    await sql`DELETE FROM gym_meal_plans WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM users WHERE email LIKE ${MAIL + "%@example.com"}`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "PATCH", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => send("PUT", path, cookies, payload);
  const ok = (res: Res, status = 200) => {
    expect(res.statusCode, res.body).toBe(status);
    return JSON.parse(res.body) as unknown;
  };
  const errorOf = (res: Res) => (JSON.parse(res.body) as { error: string }).error;

  const makeUser = async (local: string, answers: Record<string, unknown> = ADULT): Promise<Person> => {
    const email = `${MAIL}${local}-${uniq()}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Sam ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    await proveAddress(sql, email);
    const cookies = cookieMap(login);
    const setup = await send("PATCH", "/v1/users/me/onboarding", cookies, answers);
    expect(setup.statusCode, setup.body).toBe(200);
    return { userId, email, cookies };
  };
  const makeGym = async (owner: Person, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as CreatedOrg).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return gymId;
  };
  /** A member of the gym, on a record of their own on its list. */
  const memberOf = async (gymId: string, person: Person, name: string): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, membership_type, identity_key, source)
      VALUES (${gymId}, ${name}, ${person.email}, null, encode(sha256(${`gmchoice-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    if (row === undefined) throw new Error("no record");
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gymId}, ${person.userId}, now() - interval '30 days', ${row.id})`;
    return row.id;
  };
  const writePlan = async (gymId: string, owner: Person, name: string, monday: unknown = SMALL_DAY): Promise<string> => {
    const planId = gymMealPlanResponseSchema.parse(ok(await post(`/v1/orgs/${gymId}/meal-plans`, { id: randomUUID(), name }, owner.cookies))).id;
    ok(await put(`/v1/orgs/${gymId}/meal-plans/${planId}/days/1`, { changeId: randomUUID(), meals: monday }, owner.cookies));
    return planId;
  };
  const giveTo = async (gymId: string, planId: string, owner: Person, entryIds: string[]) =>
    gymMealPlanGivenToSelectedResponseSchema.parse(
      ok(await post(`/v1/orgs/${gymId}/member-list/selected/meal-plan`, { planId, selection: { kind: "ticked", entryIds } }, owner.cookies)),
    ).given;
  const giveEverybody = async (gymId: string, planId: string, owner: Person) =>
    ok(await post(`/v1/orgs/${gymId}/meal-plans/${planId}/give`, { to: { kind: "everyone" } }, owner.cookies));
  const gymPlans = async (p: Person): Promise<MyGymMealPlansResponse> => myGymMealPlansResponseSchema.parse(ok(await get(MY_GYM_MEAL_PLANS_PATH, p.cookies)));
  const dietPlan = async (p: Person): Promise<DietPlanResponse> => dietPlanResponseSchema.parse(ok(await get("/v1/nutrition/diet-plan", p.cookies)));
  const pick = (p: Person, body: unknown) => put("/v1/nutrition/diet-plan/choice", body, p.cookies);
  const stored = async (p: Person) =>
    await sql<{ choice: string; gymId: string | null }[]>`
      SELECT choice, gym_id AS "gymId" FROM recommended_choices WHERE user_id = ${p.userId} AND kind = 'food'`;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
      nutrition: { foodSearchProvider: noExternal },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("THE WORST THING: a member is shown only the plan their own gym gave them, and picks only a gym they are in", { timeout: T }, async () => {
    const owner = await makeUser("owner");
    const iron = await makeGym(owner, "Choice Iron House");
    const ann = await makeUser("ann");
    const annRecord = await memberOf(iron, ann, "Ann Lee");
    const bob = await makeUser("bob");
    await memberOf(iron, bob, "Bob Ray");
    const nextDoor = await makeUser("nextdoor");
    const oak = await makeGym(nextDoor, "Choice Oak Gym");
    const tia = await makeUser("tia");
    await memberOf(oak, tia, "Tia Next");
    const cal = await makeUser("cal");
    const gus = await makeUser("gus");
    await memberOf(iron, gus, "Gus Old");
    await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${iron} AND user_id = ${gus.userId}`;

    const lean = await writePlan(iron, owner, "Lean week");
    expect((await giveTo(iron, lean, owner, [annRecord])).count).toBe(1);
    const oakPlan = await writePlan(oak, nextDoor, "Oak everybody");
    await giveEverybody(oak, oakPlan, nextDoor);

    // Ann: her gym, and the plan given to her, written by its owner; never Oak's.
    const annGyms = (await gymPlans(ann)).gyms;
    expect(annGyms.map((g) => [g.gymId, g.name, g.plan?.name ?? null])).toEqual([[iron, "Choice Iron House", "Lean week"]]);
    expect(annGyms[0]?.plan?.writtenBy).toBe("Sam owner");
    expect(annGyms[0]?.plan?.days[0]?.meals).toHaveLength(2);
    // Bob: the same gym, given nothing.
    expect((await gymPlans(bob)).gyms.map((g) => [g.gymId, g.plan])).toEqual([[iron, null]]);
    // Tia: only Oak's, given to everybody there.
    expect((await gymPlans(tia)).gyms.map((g) => [g.gymId, g.plan?.name ?? null])).toEqual([[oak, "Oak everybody"]]);
    // In no gym, and taken off a gym: nothing.
    expect((await gymPlans(cal)).gyms).toEqual([]);
    expect((await gymPlans(gus)).gyms).toEqual([]);
    expect((await get(MY_GYM_MEAL_PLANS_PATH)).statusCode).toBe(401);

    // Where the choice starts: the gym's plan for Ann, never for Bob, Cal or Gus.
    const annStart = await dietPlan(ann);
    expect([annStart.choice, annStart.choiceGymId]).toEqual(["gym", iron]);
    for (const p of [bob, cal, gus]) expect([(await dietPlan(p)).choice, (await dietPlan(p)).choiceGymId]).toEqual(["suggested", null]);

    // Picking a gym: only one the person is a live member of. Refused, nothing is kept.
    for (const [who, gymId] of [[ann, oak], [cal, iron], [gus, iron], [tia, iron]] as const) {
      const res = await pick(who, { choice: "gym", gymId });
      expect(res.statusCode, res.body).toBe(404);
      expect(errorOf(res)).toBe("not_member");
      expect(await stored(who)).toEqual([]);
    }
    expect((await pick(ann, { choice: "gym", gymId: randomUUID() })).statusCode).toBe(404);
    expect((await put("/v1/nutrition/diet-plan/choice", { choice: "gym", gymId: iron })).statusCode).toBe(401);
    // A gym named beside another choice, or none for the gym's: refused as the wrong shape.
    for (const body of [{ choice: "gym" }, { choice: "mine", gymId: iron }, { choice: "gym", gymId: "iron" }, { choice: "gym", gymId: iron, userId: bob.userId }]) {
      expect((await pick(ann, body)).statusCode, JSON.stringify(body)).toBe(400);
    }

    // His own gym's id in capital letters is the same gym.
    const upper = dietPlanResponseSchema.parse(ok(await pick(bob, { choice: "gym", gymId: iron.toUpperCase() })));
    expect([upper.choice, upper.choiceGymId]).toEqual(["gym", iron]);
    await pick(bob, { choice: "suggested" });

    // Bob picks his gym, which gave him nothing: kept; the phone says it hasn't given one.
    const bobPicked = dietPlanResponseSchema.parse(ok(await pick(bob, { choice: "gym", gymId: iron })));
    expect([bobPicked.choice, bobPicked.choiceGymId]).toEqual(["gym", iron]);
    expect(await stored(bob)).toEqual([{ choice: "gym", gymId: iron }]);
    // Ann picks Suggested, then her gym again: one row each time, hers only.
    await pick(ann, { choice: "suggested" });
    expect(await stored(ann)).toEqual([{ choice: "suggested", gymId: null }]);
    await pick(ann, { choice: "gym", gymId: iron });
    expect(await stored(ann)).toEqual([{ choice: "gym", gymId: iron }]);
    expect(await stored(bob)).toEqual([{ choice: "gym", gymId: iron }]);

    // Ann leaves the gym: its plan and its choice go with it, though the row stays until she picks.
    await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${iron} AND user_id = ${ann.userId}`;
    expect((await gymPlans(ann)).gyms).toEqual([]);
    const annAfter = await dietPlan(ann);
    expect([annAfter.choice, annAfter.choiceGymId]).toEqual(["suggested", null]);
  });

  it("a day under what the person may eat says so, from the gym and from their own plan, and is never changed", { timeout: T }, async () => {
    const owner = await makeUser("floor-owner");
    const gymId = await makeGym(owner, "Choice Floor Gym");
    const teen = await makeUser("heart");
    expect((await put("/v1/users/me/health-screening", { hasCondition: true, checkFirst: "cleared" }, teen.cookies)).statusCode).toBe(200);
    await memberOf(gymId, teen, "Tess Heart");
    const adult = await makeUser("adult");
    await memberOf(gymId, adult, "Ada Grown");
    // About 1,700 kcal: over the floor, under what keeps a 70 kg woman's weight.
    const middleDay = [
      { mealType: "breakfast", items: [{ canonical: "banana", grams: 600 }] },
      { mealType: "lunch", items: [{ canonical: "rice", grams: 600 }] },
      { mealType: "dinner", items: [{ canonical: "rice", grams: 300 }] },
    ];
    const plan = await writePlan(gymId, owner, "Mixed week", middleDay);
    ok(await put(`/v1/orgs/${gymId}/meal-plans/${plan}/days/2`, { changeId: randomUUID(), meals: SMALL_DAY }, owner.cookies));
    await giveEverybody(gymId, plan, owner);

    const teenDays = (await gymPlans(teen)).gyms[0]?.plan?.days ?? [];
    const adultDays = (await gymPlans(adult)).gyms[0]?.plan?.days ?? [];
    const monday = teenDays[0]?.planned.kcal ?? 0;
    expect(monday).toBeGreaterThan(1200);
    // A yes on the health question holds no cut: Monday is under what keeps their weight, and says by how much.
    const keeps = teenDays[0]?.under;
    expect(keeps?.why).toBe("keeps_weight");
    expect(keeps?.kcal ?? 0).toBeGreaterThan(monday);
    // It is the person's own daily burn, as their targets give it.
    const teenTargets = nutritionTargetsResponseSchema.parse(ok(await get("/v1/nutrition/targets", teen.cookies)));
    expect(keeps?.kcal).toBe(teenTargets.targets?.tdee);
    // The adult may eat that much: no line on Monday.
    expect(adultDays[0]?.under).toBeNull();
    // Tuesday is under the app's floor for both; a day with no meals has no line.
    expect(teenDays[1]?.planned.kcal ?? 0).toBeLessThan(1200);
    expect(adultDays[1]?.under).toEqual({ kcal: 1200, why: "floor" });
    expect(teenDays[1]?.under?.why).toBe("keeps_weight");
    expect(adultDays[2]?.under).toBeNull();
    // Never changed: each member reads the plan as the gym wrote it, meal for meal.
    const written = gymMealPlanResponseSchema.parse(ok(await get(`/v1/orgs/${gymId}/meal-plans/${plan}`, owner.cookies)));
    const asWritten = written.days.map((d) => d.meals);
    const bare = (days: typeof teenDays) => days.map((d) => d.meals.map((m) => ({ mealType: m.mealType, items: m.items, totals: m.totals })));
    expect(bare(teenDays)).toEqual(asWritten);
    expect(bare(adultDays)).toEqual(asWritten);

    // A vegetarian member: the chicken is named as not in her diet, with the label line; the meal is as written.
    const veg = await makeUser("veg", { ...ADULT, diet: "vegetarian" });
    await memberOf(gymId, veg, "Vera Green");
    ok(await put(`/v1/orgs/${gymId}/meal-plans/${plan}/days/3`, { changeId: randomUUID(), meals: [{ mealType: "dinner", items: [{ canonical: "chicken_breast_cooked", grams: 150 }] }] }, owner.cookies));
    const vegPlan = (await gymPlans(veg)).gyms[0]?.plan;
    expect(vegPlan?.labelCaution).toBe(DIET_LABEL_CAUTION);
    expect(vegPlan?.days[2]?.meals[0]?.outsideDiet).toHaveLength(1);
    expect(vegPlan?.days[2]?.meals[0]?.items[0]?.canonical).toBe("chicken_breast_cooked");
    expect(vegPlan?.days[0]?.meals.every((m) => m.outsideDiet.length === 0)).toBe(true);
    const adultPlan = (await gymPlans(adult)).gyms[0]?.plan;
    expect(adultPlan?.labelCaution).toBeNull();
    expect(adultPlan?.days[2]?.meals[0]?.outsideDiet).toEqual([]);

    // Their own plan carries the same line.
    ok(await put("/v1/nutrition/diet-plan/days/4", { changeId: randomUUID(), meals: SMALL_DAY }, adult.cookies));
    const own = await dietPlan(adult);
    expect(own.days[3]?.under).toEqual({ kcal: 1200, why: "floor" });
    expect(own.days[0]?.under).toBeNull();
  });

  it("a member of two gyms that both gave a plan starts on the one given last, and sees both", { timeout: T }, async () => {
    const ownerA = await makeUser("two-a");
    const first = await makeGym(ownerA, "Choice First Gym");
    const ownerB = await makeUser("two-b");
    const second = await makeGym(ownerB, "Choice Second Gym");
    const pat = await makeUser("pat");
    await memberOf(first, pat, "Pat Both");
    await memberOf(second, pat, "Pat Both");
    await giveEverybody(first, await writePlan(first, ownerA, "First week"), ownerA);
    await giveEverybody(second, await writePlan(second, ownerB, "Second week"), ownerB);
    const both = (await gymPlans(pat)).gyms;
    expect(both.map((g) => [g.gymId, g.plan?.name ?? null]).sort()).toEqual([[first, "First week"], [second, "Second week"]].sort());
    const start = await dietPlan(pat);
    expect([start.choice, start.choiceGymId]).toEqual(["gym", second]);
    // The first gym gives again, later: it starts there now.
    await giveEverybody(first, await writePlan(first, ownerA, "First again"), ownerA);
    const after = await dietPlan(pat);
    expect([after.choice, after.choiceGymId]).toEqual(["gym", first]);
  });
});
