import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { Dishware, Meal, NutritionTargetsResponse } from "@app/shared";
import { App } from "../../src/App";
import type { TextStore } from "../../src/screens/food/outbox";
import type { Ask, AskInit } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

// ROADMAP 32b-ii-b: the rings' own numbers, and saved dishes, on the Food tab.
//
// The worst thing (the plan's line): own calories the safety rules forbid shown as if they were in
// use; or one person's dish seen or changed by another (the server's test, nutrition.dishOnce).

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();

const PLAN = { kcal: 2300, bmr: 1600, tdee: 2300, proteinG: 120, carbsG: 280, fatG: 75, noCalorieCut: false };
const OWN = { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 };
const targets = (over: Partial<NutritionTargetsResponse> = {}): NutritionTargetsResponse => ({
  targets: PLAN,
  missing: [],
  targetWrongSide: false,
  source: "app",
  appTargets: PLAN,
  own: null,
  ownHeld: null,
  ...over,
});

const OATS = {
  canonical: "oats_rolled",
  name: "Oats, rolled",
  kcal: 379,
  proteinG: 13.2,
  carbsG: 67.7,
  fatG: 6.5,
  fiberG: 10.1,
  serving: 40,
  unit: "g",
  source: "usda",
  measures: [
    { id: "g", name: "g", grams: 1 },
    { id: "usda-1", name: "cup", grams: 81 },
  ],
  startsAt: { measure: "usda-1", amount: 1 },
};
const item = (grams: number, kcal: number, measure: { id: string; name: string; amount: number }) => ({
  name: "Oats, rolled",
  canonical: "oats_rolled",
  gramsPoint: grams,
  gramsRange: [grams, grams],
  portionSource: measure.id === "dish" ? "user_dishware" : "default",
  nutritionSource: "usda",
  kcalPoint: kcal,
  kcalLow: kcal,
  kcalHigh: kcal,
  proteinG: 10,
  carbsG: 50,
  fatG: 5,
  measure,
});
const totals = (kcal: number) => ({ kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 10, carbsG: 50, fatG: 5 });
const dish = (id: string, label: string, containerClass = "cereal_bowl", volumeMl = 375): Dishware => ({
  id,
  label,
  containerClass,
  volumeMl,
  foodHint: null,
  createdAt: "2026-10-29T08:00:00.000Z",
});
const BOWL = dish("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "My blue bowl");

interface State {
  targets: NutritionTargetsResponse;
  /** How a save of the daily numbers answers; by default as the server does with no rule against it. */
  put?: (body: Record<string, unknown>) => Reply;
  dishes: Dishware[];
  /** A dish's save has no signal. */
  dishLost?: boolean;
  meals: Meal[];
  mealLost?: boolean;
}

type Sent = { method: string; path: string; body: Record<string, unknown> | undefined };

function server(state: State) {
  const base = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/nutrition/foods": () => ({ status: 200, body: { items: [OATS] } }),
    "/v1/nutrition/foods/recent": () => ({ status: 200, body: { items: [] } }),
  });
  const sent: Sent[] = [];
  const answer = (reply: Reply) => ({ ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) });
  const priced = (body: { items: Record<string, unknown>[] }) => {
    const items = body.items.map((i) => {
      if (typeof i.dishwareId === "string") {
        const d = state.dishes.find((x) => x.id === i.dishwareId);
        if (d === undefined) return null;
        const grams = Math.round(d.volumeMl * Number(i.fillLevel) * 0.4);
        return item(grams, Math.round(grams * 3.79), { id: "dish", name: d.label, amount: Number(i.fillLevel) });
      }
      if (i.from !== undefined && i.canonical === undefined) return state.meals[0]?.items[Number(i.from)] ?? null;
      return item(81, 307, { id: "usda-1", name: "cup", amount: 1 });
    });
    return items.includes(null)
      ? refusal(400, "unknown_dishware", "Dishware not found.")
      : { status: 200, body: { items, totals: totals(items.reduce((n, i) => n + (i?.kcalPoint ?? 0), 0)) } };
  };
  const ask: Ask = async (url: string, init: AskInit) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    const body = init.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>);
    const dishId = /^\/v1\/nutrition\/dishware\/([0-9a-f-]{36})$/.exec(path)?.[1];
    const mealId = /^\/v1\/nutrition\/meals\/([0-9a-f-]{36})(\/measures|\/preview)?$/.exec(path);
    const mine = path === "/v1/nutrition/targets" || path === "/v1/nutrition/dishware" || dishId !== undefined || path.startsWith("/v1/nutrition/meals");
    if (!mine) return base.ask(url, init);
    sent.push({ method, path, body });
    if (path === "/v1/nutrition/targets") {
      if (method === "GET") return answer({ status: 200, body: state.targets });
      if (body === undefined) return answer(refusal(400, "validation_error", "body"));
      const put = state.put?.(body);
      if (put !== undefined) return answer(put);
      const own = body.source === "own" ? { kcal: Number(body.kcal), proteinG: Number(body.proteinG), carbsG: Number(body.carbsG), fatG: Number(body.fatG) } : state.targets.own;
      state.targets =
        body.source === "own" && own !== null
          ? targets({ source: "own", own, targets: { ...PLAN, ...own } })
          : targets({ own });
      return answer({ status: 200, body: state.targets });
    }
    if (path === "/v1/nutrition/dishware") {
      if (method === "GET") return answer({ status: 200, body: { items: state.dishes, nextCursor: null } });
      if (state.dishLost === true) return lost() as never;
      const id = String(body?.id);
      const known = state.dishes.find((d) => d.id === id);
      if (known !== undefined) return answer({ status: 200, body: { dishware: known } });
      const made = dish(id, String(body?.label), String(body?.containerClass), Number(body?.volumeMl));
      state.dishes = [made, ...state.dishes];
      return answer({ status: 201, body: { dishware: made } });
    }
    if (dishId !== undefined) {
      const at = state.dishes.findIndex((d) => d.id === dishId);
      const had = state.dishes[at];
      if (had === undefined) return answer(refusal(404, "not_found", "Not found"));
      if (method === "DELETE") {
        state.dishes = state.dishes.filter((d) => d.id !== dishId);
        return answer({ status: 204, body: undefined });
      }
      const renamed = { ...had, label: String(body?.label) };
      state.dishes = state.dishes.map((d) => (d.id === dishId ? renamed : d));
      return answer({ status: 200, body: { dishware: renamed } });
    }
    if (path === "/v1/nutrition/meals/preview") return answer(priced(body as { items: Record<string, unknown>[] }));
    if (mealId !== null && mealId[2] === "/measures") return answer({ status: 200, body: { measures: (state.meals[0]?.items ?? []).map(() => OATS.measures) } });
    if (mealId !== null && mealId[2] === "/preview") return answer(priced(body as { items: Record<string, unknown>[] }));
    if (method === "POST" && path === "/v1/nutrition/meals") {
      if (state.mealLost === true) return lost() as never;
      const p = priced(body as { items: Record<string, unknown>[] });
      if (p.status !== 200) return answer(p);
      const b = body as { id: string; mealName: string; takenAt: string; mealType: Meal["mealType"] };
      const out = p.body as { items: Meal["items"]; totals: Meal["totals"] };
      const meal: Meal = { id: b.id, takenAt: b.takenAt, mealType: b.mealType, mealName: b.mealName, items: out.items, totals: out.totals, confirmed: true, origin: "manual", portionSource: "default", nutritionSources: ["usda"], calcVersion: 1, itemsVersion: "v1" };
      state.meals = [meal, ...state.meals];
      return answer({ status: 201, body: { meal } });
    }
    if (method === "PATCH" && mealId !== null) {
      const p = priced(body as { items: Record<string, unknown>[] });
      if (p.status !== 200) return answer(p);
      const out = p.body as { items: Meal["items"]; totals: Meal["totals"] };
      const meal = state.meals[0];
      if (meal === undefined) return answer(refusal(404, "not_found", "Not found"));
      const now = { ...meal, items: out.items, totals: out.totals, itemsVersion: "v2" };
      state.meals = [now];
      return answer({ status: 200, body: { meal: now } });
    }
    return answer({ status: 200, body: { items: state.meals, nextCursor: null } });
  };
  return { ask, sent };
}

function files(): () => TextStore {
  let kept: string | null = null;
  return () => ({
    read: () => Promise.resolve(kept),
    write: (text) => {
      kept = text;
      return Promise.resolve();
    },
  });
}

async function openFood(state: State) {
  const s = server(state);
  await render(<App extra={extra} ask={s.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={files()} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
  return s;
}

const puts = (s: ReturnType<typeof server>) => s.sent.filter((a) => a.method === "PUT");
const dishPosts = (s: ReturnType<typeof server>) => s.sent.filter((a) => a.method === "POST" && a.path === "/v1/nutrition/dishware");

async function changeNumbers() {
  await fireEvent.press(await screen.findByRole("button", { name: "Change your daily numbers" }));
}

/** Search for oats in Breakfast's add box and pick it. */
async function pickOats() {
  await fireEvent.press(await screen.findByRole("button", { name: "Add to Breakfast" }));
  await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
  await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 379 kcal per 100 g, USDA" }));
}

describe("the worst thing: own calories the safety rules forbid are never shown as in use", () => {
  it("numbers the server refuses are said in the box, and the rings stay on the app's plan", async () => {
    const state: State = {
      targets: targets(),
      dishes: [],
      meals: [],
      put: (body) => (body.source === "own" ? refusal(400, "own_targets_below_floor", "Daily calories cannot go below 1,200 kcal.") : { status: 500, body: {} }),
    };
    const s = await openFood(state);
    expect(await screen.findByLabelText("Calories, 0 of 2,300 kcal")).toBeTruthy();
    await changeNumbers();
    await fireEvent.press(screen.getByRole("button", { name: "My own. Set your own numbers" }));
    // "My own" starts from the app's numbers.
    expect(screen.getByLabelText("Calories (kcal)").props.value).toBe("2300");
    await fireEvent.changeText(screen.getByLabelText("Calories (kcal)"), "900");
    await fireEvent.press(screen.getByRole("button", { name: "Use my numbers" }));
    expect(await screen.findByText("Daily calories cannot go below 1,200 kcal.")).toBeTruthy();
    expect(puts(s)).toHaveLength(1);
    expect(puts(s)[0]?.body).toEqual({ source: "own", kcal: 900, proteinG: 120, carbsG: 280, fatG: 75 });
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("Calories, 0 of 2,300 kcal")).toBeTruthy();
    expect(screen.queryByLabelText(/Calories, 0 of 900 kcal/)).toBeNull();
    expect(screen.queryByText("These are your own daily numbers.")).toBeNull();
    expect(screen.queryByText("Now using your own numbers.")).toBeNull();
  });

  it("own numbers the server holds back are kept, and the rings show the plan's with the reason", async () => {
    const held = { ...PLAN, noCalorieCut: true };
    await openFood({
      targets: targets({ targets: held, appTargets: held, own: { kcal: 1500, proteinG: 100, carbsG: 150, fatG: 50 }, ownHeld: { code: "no_cut_below_maintenance", maintenanceKcal: 2300, reasons: ["under_18"] } }),
      dishes: [],
      meals: [],
    });
    expect(await screen.findByLabelText("Calories, 0 of 2,300 kcal")).toBeTruthy();
    expect(screen.getByText("Your plan holds no calorie cut now, so your own calories can’t be used below 2,300 kcal a day, what keeps your weight.")).toBeTruthy();
    expect(screen.queryByText("These are your own daily numbers.")).toBeNull();
    expect(screen.queryByLabelText(/of 1,500 kcal/)).toBeNull();
  });
});

describe("the daily numbers", () => {
  it("uses the person's own numbers once the server has them, and says so on the card", async () => {
    const state: State = { targets: targets(), dishes: [], meals: [] };
    const s = await openFood(state);
    await changeNumbers();
    await fireEvent.press(screen.getByRole("button", { name: "My own. Set your own numbers" }));
    await fireEvent.changeText(screen.getByLabelText("Calories (kcal)"), "2000");
    await fireEvent.changeText(screen.getByLabelText("Protein (g)"), "150");
    await fireEvent.changeText(screen.getByLabelText("Carbs (g)"), "200");
    await fireEvent.changeText(screen.getByLabelText("Fat (g)"), "60");
    expect(screen.getByText("Your protein, carbs and fat come to 1,940 kcal. They don’t have to match your calories.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Use my numbers" }));
    expect(await screen.findByText("Now using your own numbers.")).toBeTruthy();
    expect(puts(s)[0]?.body).toEqual({ source: "own", ...OWN });
    expect(screen.getByLabelText("Calories, 0 of 2,000 kcal")).toBeTruthy();
    expect(screen.getByText("These are your own daily numbers.")).toBeTruthy();
  });

  it("switches back to the app's plan and keeps the person's own numbers", async () => {
    const state: State = { targets: targets({ source: "own", own: OWN, targets: { ...PLAN, ...OWN } }), dishes: [], meals: [] };
    const s = await openFood(state);
    expect(await screen.findByLabelText("Calories, 0 of 2,000 kcal")).toBeTruthy();
    await changeNumbers();
    await fireEvent.press(screen.getByRole("button", { name: "App’s plan. 2,300 kcal · Protein 120 g · Carbs 280 g · Fat 75 g" }));
    await fireEvent.press(screen.getByRole("button", { name: "Use the app’s plan" }));
    expect(await screen.findByText("Now using the app’s plan.")).toBeTruthy();
    expect(puts(s)[0]?.body).toEqual({ source: "app" });
    expect(screen.getByLabelText("Calories, 0 of 2,300 kcal")).toBeTruthy();
    await changeNumbers();
    expect(screen.getByRole("button", { name: "My own. 2,000 kcal · Protein 150 g · Carbs 200 g · Fat 60 g" })).toBeTruthy();
  });

  it("with no signal says so and changes nothing", async () => {
    const s = await openFood({ targets: targets(), dishes: [], meals: [], put: () => lost() });
    await changeNumbers();
    await fireEvent.press(screen.getByRole("button", { name: "My own. Set your own numbers" }));
    await fireEvent.press(screen.getByRole("button", { name: "Use my numbers" }));
    expect(await screen.findByText("No connection. Try again.")).toBeTruthy();
    expect(puts(s)).toHaveLength(1);
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("Calories, 0 of 2,300 kcal")).toBeTruthy();
  });
});

describe("saved dishes", () => {
  it("a dish saved with no answer is sent again under the same id, saved once, and picked", async () => {
    const state: State = { targets: targets(), dishes: [], meals: [], dishLost: true };
    const s = await openFood(state);
    await pickOats();
    await fireEvent.press(await screen.findByRole("radio", { name: "New dish" }));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Soup bowl");
    await fireEvent.press(screen.getByRole("radio", { name: "Bowl · 375 ml" }));
    // The food's own Add waits while the dish is being saved.
    expect(screen.queryByRole("button", { name: /^Add Oats, rolled/ })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Save dish" }));
    expect(await screen.findByText("No connection. Try again.")).toBeTruthy();
    delete state.dishLost;
    await fireEvent.press(screen.getByRole("button", { name: "Save dish" }));
    expect(await screen.findByRole("radio", { name: "Soup bowl · 375 ml", selected: true })).toBeTruthy();
    const sent = dishPosts(s).map((p) => p.body);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ label: "Soup bowl", containerClass: "cereal_bowl", volumeMl: 375, id: sent[0]?.id });
    expect(sent[1]?.id).toBe(sent[0]?.id);
    expect(state.dishes).toHaveLength(1);
  });

  it("weighs a food with a saved dish once how full it was is picked, and logs it with the dish", async () => {
    const state: State = { targets: targets(), dishes: [BOWL], meals: [] };
    const s = await openFood(state);
    await pickOats();
    await fireEvent.press(await screen.findByRole("radio", { name: "My blue bowl · 375 ml" }));
    expect(screen.getByText("Pick how full it was.")).toBeTruthy();
    expect(screen.queryByLabelText("Amount")).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "My blue bowl, half full" }));
    const add = await screen.findByRole("button", { name: "Add Oats, rolled · 284 kcal" });
    const previews = s.sent.filter((a) => a.path === "/v1/nutrition/meals/preview");
    expect(previews.at(-1)?.body).toEqual({ items: [{ canonical: "oats_rolled", dishwareId: BOWL.id, fillLevel: 0.5 }] });
    await fireEvent.press(add);
    expect(await screen.findByText("Oats, rolled added.")).toBeTruthy();
    await waitFor(() => {
      expect(state.meals).toHaveLength(1);
    });
    const posted = s.sent.find((a) => a.method === "POST" && a.path === "/v1/nutrition/meals");
    expect(posted?.body).toMatchObject({ items: [{ canonical: "oats_rolled", dishwareId: BOWL.id, fillLevel: 0.5 }] });
    expect(await screen.findByRole("button", { name: "Oats, rolled, 284 kcal" })).toBeTruthy();
  });

  it("changes a logged food's amount to a saved dish", async () => {
    const meal: Meal = {
      id: "33333333-3333-4333-8333-333333333333",
      takenAt: new Date().toISOString(),
      mealType: "breakfast",
      mealName: "Oats, rolled",
      items: [item(81, 307, { id: "usda-1", name: "cup", amount: 1 })] as Meal["items"],
      totals: totals(307),
      confirmed: true,
      origin: "manual",
      portionSource: "default",
      nutritionSources: ["usda"],
      calcVersion: 1,
      itemsVersion: "v1",
    };
    const state: State = { targets: targets(), dishes: [BOWL], meals: [meal] };
    const s = await openFood(state);
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Change Oats, rolled, 1 × cup · 81 g" }));
    await fireEvent.press(await screen.findByRole("radio", { name: "My blue bowl · 375 ml" }));
    await fireEvent.press(screen.getByRole("radio", { name: "My blue bowl, three quarters full" }));
    expect(await screen.findByText(/^113 g · 428 kcal/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(s.sent.some((a) => a.method === "PATCH")).toBe(true);
    });
    expect(s.sent.find((a) => a.method === "PATCH")?.body).toMatchObject({ items: [{ from: 0, canonical: "oats_rolled", dishwareId: BOWL.id, fillLevel: 0.75 }] });
  });

  it("renames a dish, and removes one only after asking", async () => {
    const SMALL = dish("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Mug", "mug", 325);
    const state: State = { targets: targets(), dishes: [BOWL, SMALL], meals: [] };
    const s = await openFood(state);
    await pickOats();
    await fireEvent.press(await screen.findByRole("button", { name: "Edit your dishes" }));
    await fireEvent.press(screen.getByRole("button", { name: "Rename My blue bowl" }));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Soup bowl");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Renamed to Soup bowl.")).toBeTruthy();
    expect(s.sent.find((a) => a.method === "PATCH")?.body).toEqual({ label: "Soup bowl" });

    await fireEvent.press(await screen.findByRole("button", { name: "Remove Mug" }));
    expect(screen.getByText("Mug comes off your dishes. Meals you logged with it keep their amounts.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Keep it" }));
    expect(s.sent.filter((a) => a.method === "DELETE")).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Remove Mug" }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove dish" }));
    expect(await screen.findByText("Mug removed.")).toBeTruthy();
    expect(s.sent.filter((a) => a.method === "DELETE").map((a) => a.path)).toEqual([`/v1/nutrition/dishware/${SMALL.id}`]);
    expect(state.dishes.map((d) => d.label)).toEqual(["Soup bowl"]);
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("radio", { name: "Soup bowl · 375 ml" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Mug · 325 ml" })).toBeNull();
  });

  it("keeps a dish that a meal waiting to be sent was weighed with", async () => {
    const state: State = { targets: targets(), dishes: [BOWL], meals: [], mealLost: true };
    const s = await openFood(state);
    await pickOats();
    await fireEvent.press(await screen.findByRole("radio", { name: "My blue bowl · 375 ml" }));
    await fireEvent.press(screen.getByRole("radio", { name: "My blue bowl, full" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Add Oats, rolled · / }));
    expect(await screen.findByText("Waiting to send")).toBeTruthy();
    await pickOats();
    await fireEvent.press(await screen.findByRole("button", { name: "Edit your dishes" }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove My blue bowl" }));
    expect(screen.getByText("A meal waiting to be sent uses My blue bowl. Go online to send it, then remove the dish.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove dish" })).toBeNull();
    expect(s.sent.filter((a) => a.method === "DELETE")).toHaveLength(0);
  });
});
