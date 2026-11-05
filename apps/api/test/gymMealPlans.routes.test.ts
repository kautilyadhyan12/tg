// THE MEAL PLANS A GYM GIVES ITS MEMBERS — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 24a-i; spec Part 6 §16.6.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): one
// gym's meal plan read, changed or deleted by another gym's staff, by its own staff without the
// Plans tick, by a member, or by nobody signed in.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  FOOD_ALLERGY_CAUTION, GYM_MEAL_PLANS_MOST, dietPlanResponseSchema, foodSearchResponseSchema, gymMealPlanResponseSchema,
  gymMealPlansResponseSchema, mealMeasuresResponseSchema, type GymMealPlanResponse,
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
  JWT_SECRET: "gym-meal-plans-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};
const noExternal: FoodSearchProvider = { search: () => Promise.resolve([]) };

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface CreatedOrg { org: { id: string }; joinCode: { code: string } }
interface Person { userId: string; email: string; cookies: Cookies }
type Res = { statusCode: number; body: string };

const T = 240_000;
const LIVE_PLAN = "zz_gym_meal_plans";

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const DAL = { name: "Mum's dal", grams: 250, own: { proteinG: 12.3, carbsG: 30.1, fatG: 7.7 } };
const MONDAY = [
  { mealType: "breakfast", items: [{ canonical: "banana", grams: 118 }] },
  { mealType: "lunch", items: [{ canonical: "rice", grams: 180 }, DAL] },
];

d("the meal plans a gym gives its members (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'gmplans-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_meal_plans WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM diet_plans WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'gmplans-t-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'gmplans-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => send("PUT", path, cookies, payload);

  const makeUser = async (local: string): Promise<Person> => {
    const email = `gmplans-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Sam ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${created.org.id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };
  const join = async (org: CreatedOrg, owner: Person, person: Person) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode, applied.body).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner.cookies)).statusCode).toBe(200);
  };
  const makeStaff = async (org: CreatedOrg, owner: Person, person: Person, role: "manager" | "trainer", ticks?: string[]) => {
    await join(org, owner, person);
    await proveAddress(sql, person.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role }, owner.cookies)).statusCode).toBe(201);
    if (ticks !== undefined) {
      const res = await put(`/v1/orgs/${org.org.id}/staff/${person.userId}/privileges`, { privileges: ticks }, owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
    }
  };

  const plansUrl = (gymId: string) => `/v1/orgs/${gymId}/meal-plans`;
  const planUrl = (gymId: string, planId: string) => `${plansUrl(gymId)}/${planId}`;
  const dayUrl = (gymId: string, planId: string, day: number) => `${planUrl(gymId, planId)}/days/${String(day)}`;
  const parsed = (res: Res): GymMealPlanResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return gymMealPlanResponseSchema.parse(JSON.parse(res.body));
  };
  const errorOf = (res: Res) => (JSON.parse(res.body) as { error: string }).error;
  const create = async (gymId: string, cookies: Cookies, name: string, id: string = randomUUID()) =>
    parsed(await post(plansUrl(gymId), { id, name }, cookies));
  const putDay = (gymId: string, planId: string, day: number, cookies: Cookies, meals: unknown, version?: string, changeId: string = randomUUID()) =>
    put(dayUrl(gymId, planId, day), { changeId, meals, ...(version === undefined ? {} : { version }) }, cookies);
  const stored = async (planId: string) => {
    const [row] = await sql<{ name: string; days: unknown; updated_at: Date }[]>`SELECT name, days, updated_at FROM gym_meal_plans WHERE id = ${planId}`;
    return row;
  };

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

  it("a gym's meal plan is read, changed and deleted by its own staff with the Plans tick alone", { timeout: T }, async () => {
    const owner = await makeUser("w-owner");
    const iron = await makeGym(owner, "Plans Iron House");
    const manager = await makeUser("w-manager");
    await makeStaff(iron, owner, manager, "manager");
    const member = await makeUser("w-member");
    await join(iron, owner, member);
    const nextDoor = await makeUser("w-nextdoor");
    const other = await makeGym(nextDoor, "Plans Next Door");
    const theirTrainer = await makeUser("w-their-trainer");
    await makeStaff(other, nextDoor, theirTrainer, "trainer", ["members.read", "plans.manage"]);

    const plan = await create(iron.org.id, owner.cookies, "Lean week");
    parsed(await putDay(iron.org.id, plan.id, 1, owner.cookies, MONDAY));
    const before = await stored(plan.id);
    const gymId = iron.org.id;
    const monday = plan.days[0]?.version;

    // Every door, by everybody who must not pass it.
    const doors = (cookies: Cookies) => [
      send("GET", plansUrl(gymId), cookies),
      send("GET", planUrl(gymId, plan.id), cookies),
      send("PATCH", planUrl(gymId, plan.id), cookies, { name: "Taken over" }),
      putDay(gymId, plan.id, 1, cookies, [], monday),
      send("GET", `${dayUrl(gymId, plan.id, 1)}/meals/0/measures`, cookies),
      send("DELETE", planUrl(gymId, plan.id), cookies),
      post(plansUrl(gymId), { id: randomUUID(), name: "Sneaked in" }, cookies),
    ];
    for (const [who, cookies, codes] of [
      ["another gym's owner", nextDoor.cookies, [404]],
      ["another gym's staff with the tick", theirTrainer.cookies, [404]],
      ["a member of this gym", member.cookies, [404]],
      ["a manager of this gym without the tick", manager.cookies, [403]],
      ["nobody signed in", {}, [401]],
    ] as const) {
      for (const res of await Promise.all(doors(cookies))) {
        expect(codes, `${who}: ${res.body}`).toContain(res.statusCode);
        expect(res.body, who).not.toContain("Lean week");
        expect(res.body, who).not.toContain("Mum's dal");
      }
    }

    // Another gym's staff naming this plan under their own gym find nothing, and change nothing.
    for (const cookies of [nextDoor.cookies, theirTrainer.cookies]) {
      for (const res of await Promise.all([
        send("GET", planUrl(other.org.id, plan.id), cookies),
        send("PATCH", planUrl(other.org.id, plan.id), cookies, { name: "Taken over" }),
        putDay(other.org.id, plan.id, 1, cookies, [], monday),
        send("GET", `${dayUrl(other.org.id, plan.id, 1)}/meals/0/measures`, cookies),
      ])) {
        expect(res.statusCode, res.body).toBe(404);
        expect(errorOf(res)).toBe("plan_not_found");
      }
      // Deleting it there says it is gone; it is not.
      expect((await send("DELETE", planUrl(other.org.id, plan.id), cookies)).statusCode).toBe(204);
      // A new plan of theirs under this plan's id is refused, never laid over it.
      const taken = await post(plansUrl(other.org.id), { id: plan.id, name: "Same id" }, cookies);
      expect(taken.statusCode, taken.body).toBe(404);
    }
    const theirs = gymMealPlansResponseSchema.parse(JSON.parse((await send("GET", plansUrl(other.org.id), nextDoor.cookies)).body));
    expect(theirs.plans).toEqual([]);

    const after = await stored(plan.id);
    expect(after).toEqual(before);
    const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_meal_plans WHERE gym_id = ${gymId}`;
    expect(count?.n).toBe(1);
  });

  it("the owner holds the Plans tick by default, and a trainer given it writes, changes and deletes", { timeout: T }, async () => {
    const owner = await makeUser("t-owner");
    const gym = await makeGym(owner, "Plans Tick Gym");
    const trainer = await makeUser("t-trainer");
    await makeStaff(gym, owner, trainer, "trainer");
    // A trainer starts without it.
    expect((await send("GET", plansUrl(gym.org.id), trainer.cookies)).statusCode).toBe(403);
    const staff = JSON.parse((await send("GET", `/v1/orgs/${gym.org.id}/staff`, owner.cookies)).body) as { staff: { userId: string; privileges?: string[] }[] };
    expect(staff.staff.find((s) => s.userId === owner.userId)?.privileges).toContain("plans.manage");
    expect(staff.staff.find((s) => s.userId === trainer.userId)?.privileges).not.toContain("plans.manage");

    const ticked = await put(`/v1/orgs/${gym.org.id}/staff/${trainer.userId}/privileges`, { privileges: ["members.read", "plans.manage"] }, owner.cookies);
    expect(ticked.statusCode, ticked.body).toBe(200);
    const plan = await create(gym.org.id, trainer.cookies, "Bulk week");
    expect(plan.writtenBy).toBe("Sam t-trainer");
    const changed = parsed(await putDay(gym.org.id, plan.id, 3, owner.cookies, MONDAY));
    expect(changed.writtenBy).toBe("Sam t-trainer");
    expect(changed.changedBy).toBe("Sam t-owner");
    const renamed = parsed(await send("PATCH", planUrl(gym.org.id, plan.id), trainer.cookies, { name: "Bulk week 2" }));
    expect(renamed.name).toBe("Bulk week 2");
    expect((await send("DELETE", planUrl(gym.org.id, plan.id), trainer.cookies)).statusCode).toBe(204);
    expect((await send("GET", planUrl(gym.org.id, plan.id), owner.cookies)).statusCode).toBe(404);
  });

  it("a day saves and reads back at the numbers the same foods have in a person's own meal plan", { timeout: T }, async () => {
    const owner = await makeUser("n-owner");
    const gym = await makeGym(owner, "Plans Numbers Gym");
    const plan = await create(gym.org.id, owner.cookies, "Week one");
    expect(plan.days.every((d) => d.meals.length === 0)).toBe(true);
    expect(plan.caution).toBe(FOOD_ALLERGY_CAUTION);

    // Two bananas by the food's own measure, as the search offers it.
    const search = foodSearchResponseSchema.parse(JSON.parse((await send("GET", "/v1/nutrition/foods?q=banana", owner.cookies)).body));
    const banana = search.items.find((f) => f.canonical === "banana");
    if (banana === undefined) throw new Error("the search found no banana");
    const piece = banana.measures.find((m) => m.id !== "g" && m.id !== "oz") ?? banana.measures[0];
    if (piece === undefined) throw new Error("banana has no measure");
    const meals = [...MONDAY, { mealType: "snack", items: [{ canonical: "banana", measure: piece.id, amount: 2 }] }];
    const gymDay = parsed(await putDay(gym.org.id, plan.id, 2, owner.cookies, meals)).days[1];

    // The owner's own plan, the same day: the same foods at the same numbers.
    const own = await put("/v1/nutrition/diet-plan/days/2", { changeId: randomUUID(), meals }, owner.cookies);
    expect(own.statusCode, own.body).toBe(200);
    const ownDay = dietPlanResponseSchema.parse(JSON.parse(own.body)).days[1];
    expect(gymDay?.meals.map((m) => ({ mealType: m.mealType, items: m.items, totals: m.totals })))
      .toEqual(ownDay?.meals.map((m) => ({ mealType: m.mealType, items: m.items, totals: m.totals })));
    expect(gymDay?.planned).toEqual(ownDay?.planned);
    expect(gymDay?.meals[2]?.items[0]?.gramsPoint).toBeCloseTo(piece.grams * 2, 0);
    expect(gymDay?.meals[1]?.items[1]?.name).toBe("Mum's dal");

    // Read again, the plan is as saved; the list counts its meals.
    const again = parsed(await send("GET", planUrl(gym.org.id, plan.id), owner.cookies));
    expect(again.days[1]).toEqual(gymDay);
    const list = gymMealPlansResponseSchema.parse(JSON.parse((await send("GET", plansUrl(gym.org.id), owner.cookies)).body));
    expect(list.plans.map((p) => [p.name, p.meals])).toEqual([["Week one", 3]]);

    // Each food of a meal with its measures, to change its amount.
    const measures = mealMeasuresResponseSchema.parse(JSON.parse((await send("GET", `${dayUrl(gym.org.id, plan.id, 2)}/meals/1/measures`, owner.cookies)).body));
    expect(measures.measures).toHaveLength(2);
    expect((await send("GET", `${dayUrl(gym.org.id, plan.id, 2)}/meals/5/measures`, owner.cookies)).statusCode).toBe(404);
  });

  it("a plan or a change sent twice is made once, and a day changed since is never laid over", { timeout: T }, async () => {
    const owner = await makeUser("o-owner");
    const gym = await makeGym(owner, "Plans Once Gym");
    const id = randomUUID();
    const [a, b] = await Promise.all([post(plansUrl(gym.org.id), { id, name: "Twice" }, owner.cookies), post(plansUrl(gym.org.id), { id, name: "Twice" }, owner.cookies)]);
    expect([parsed(a).id, parsed(b).id]).toEqual([id, id]);
    const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_meal_plans WHERE gym_id = ${gym.org.id}`;
    expect(count?.n).toBe(1);

    const changeId = randomUUID();
    const first = parsed(await putDay(gym.org.id, id, 1, owner.cookies, MONDAY, undefined, changeId));
    // The same change sent again with other foods is the change already made.
    const repeat = parsed(await putDay(gym.org.id, id, 1, owner.cookies, [], undefined, changeId));
    expect(repeat.days[0]).toEqual(first.days[0]);

    // Two staff open Monday; the second save, from the older copy, is refused.
    const opened = first.days[0]?.version;
    parsed(await putDay(gym.org.id, id, 1, owner.cookies, [MONDAY[0]], opened));
    const late = await putDay(gym.org.id, id, 1, owner.cookies, [], opened);
    expect(late.statusCode, late.body).toBe(409);
    expect(errorOf(late)).toBe("plan_changed");
    const now = parsed(await send("GET", planUrl(gym.org.id, id), owner.cookies));
    expect(now.days[0]?.meals.map((m) => m.mealType)).toEqual(["breakfast"]);
  });

  it("refuses what cannot go in a gym's plan, a name already used, and a gym at its most", { timeout: T }, async () => {
    const owner = await makeUser("r-owner");
    const gym = await makeGym(owner, "Plans Refusals Gym");
    const plan = await create(gym.org.id, owner.cookies, "Cut week");
    for (const [why, meals, code, error] of [
      ["a food weighed in a member's own dish", [{ mealType: "lunch", items: [{ canonical: "rice", dishwareId: randomUUID(), fillLevel: 0.5 }] }], 400, "validation_error"],
      ["a food from the writer's own scanned label", [{ mealType: "lunch", items: [{ canonical: `label_${randomUUID()}`, grams: 50 }] }], 400, "label_food"],
      ["a food no list holds", [{ mealType: "lunch", items: [{ canonical: "usda_sr_999999999", grams: 50 }] }], 400, "unknown_food"],
      ["nine meals in a day", Array.from({ length: 9 }, () => MONDAY[0]), 400, "validation_error"],
      ["a meal with no food", [{ mealType: "lunch", items: [] }], 400, "validation_error"],
    ] as const) {
      const res = await putDay(gym.org.id, plan.id, 1, owner.cookies, meals);
      expect(res.statusCode, `${why}: ${res.body}`).toBe(code);
      expect(errorOf(res), why).toBe(error);
    }
    expect((await stored(plan.id))?.days).toEqual([[], [], [], [], [], [], []]);
    expect((await put(dayUrl(gym.org.id, plan.id, 8), { changeId: randomUUID(), meals: [] }, owner.cookies)).statusCode).toBe(400);

    // One name for one plan, whatever its capitals.
    const same = await post(plansUrl(gym.org.id), { id: randomUUID(), name: "cut WEEK" }, owner.cookies);
    expect(same.statusCode, same.body).toBe(409);
    expect(errorOf(same)).toBe("name_taken");
    const second = await create(gym.org.id, owner.cookies, "Maintain");
    const renamed = await send("PATCH", planUrl(gym.org.id, second.id), owner.cookies, { name: "Cut Week" });
    expect(renamed.statusCode, renamed.body).toBe(409);
    expect((await post(plansUrl(gym.org.id), { id: randomUUID(), name: " " }, owner.cookies)).statusCode).toBe(400);
    expect((await post(plansUrl(gym.org.id), { id: randomUUID(), name: "x".repeat(61) }, owner.cookies)).statusCode).toBe(400);

    // A gym keeps at most its number of plans.
    const week = sql.json([[], [], [], [], [], [], []]);
    for (let n = 2; n < GYM_MEAL_PLANS_MOST; n++) {
      await sql`INSERT INTO gym_meal_plans (id, gym_id, name, days) VALUES (${randomUUID()}, ${gym.org.id}, ${`Plan ${String(n)}`}, ${week})`;
    }
    const full = await post(plansUrl(gym.org.id), { id: randomUUID(), name: "One more" }, owner.cookies);
    expect(full.statusCode, full.body).toBe(409);
    expect(errorOf(full)).toBe("too_many");
    const listed = gymMealPlansResponseSchema.parse(JSON.parse((await send("GET", plansUrl(gym.org.id), owner.cookies)).body));
    expect(listed.plans).toHaveLength(GYM_MEAL_PLANS_MOST);
  });
});
