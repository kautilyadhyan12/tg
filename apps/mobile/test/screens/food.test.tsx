import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { Meal, NutritionTargetsResponse, RecentFood } from "@app/shared";
import { App } from "../../src/App";
import type { TextStore } from "../../src/screens/food/outbox";
import type { Ask, AskInit } from "../../src/session/calls";
import { RAVI, fakeServer, kept, lost, memoryStore, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const PLAN = { kcal: 2300, bmr: 1600, tdee: 2300, proteinG: 120, carbsG: 280, fatG: 75, noCalorieCut: false };
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
  startsKcal: 307,
};
const item = (grams: number, kcal: number) => ({
  name: "Oats, rolled",
  canonical: "oats_rolled",
  gramsPoint: grams,
  gramsRange: [grams, grams],
  portionSource: "default",
  nutritionSource: "usda",
  kcalPoint: kcal,
  kcalLow: kcal,
  kcalHigh: kcal,
  proteinG: 10.7,
  carbsG: 54.8,
  fatG: 5.3,
  measure: { id: "usda-1", name: "cup", amount: grams / 81 },
});
const totals = (kcal: number) => ({ kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 10.7, carbsG: 54.8, fatG: 5.3 });

function savedMeal(id: string, body: { mealName: string; takenAt: string; mealType?: string }): Meal {
  return {
    id,
    takenAt: body.takenAt,
    mealType: (body.mealType ?? null) as Meal["mealType"],
    mealName: body.mealName,
    items: [item(81, 307)] as Meal["items"],
    totals: totals(307),
    confirmed: true,
    origin: "manual",
    portionSource: "default",
    nutritionSources: ["usda"],
    calcVersion: 1,
    itemsVersion: "v1",
  };
}

/** The phone's file for each person, kept across a restart of the app. */
function files() {
  const kept = new Map<string, string>();
  const store = (userId: string): TextStore => ({
    read: () => Promise.resolve(kept.get(userId) ?? null),
    write: (text) => {
      kept.set(userId, text);
      return Promise.resolve();
    },
  });
  return { kept, store };
}

interface Food {
  meals: Meal[];
  targets?: NutritionTargetsResponse;
  /** How a meal's save answers; by default as the server does (32a: one meal for an id). */
  save?: (body: { id: string }) => Reply;
  /** The day's list has no answer (a flaky signal). */
  listFails?: boolean;
  /** A change to a meal: no signal (`lost`), or made and its answer lost on the way back (`made_lost`),
   *  or refused as made from an older state of the meal (`changed`). */
  patch?: "lost" | "made_lost" | "changed";
  /** Each change the server made, by its id: sent again, it is made once (0172). */
  made?: string[];
  recent?: RecentFood[];
}

type Edit = { from?: number; canonical?: string; measure?: string; amount?: number };

/** The meal's foods after an edit, priced as the server prices oats: 81 g and 307 kcal a cup. */
function edited(meal: Meal, edits: Edit[]): Meal["items"] {
  return edits.map((e) => {
    const kept = e.from === undefined ? undefined : meal.items[e.from];
    if (e.canonical === undefined && kept !== undefined) return kept;
    const cups = e.measure === "g" ? (e.amount ?? 0) / 81 : (e.amount ?? 0);
    return item(Math.round(81 * cups * 10) / 10, Math.round(307 * cups)) as Meal["items"][number];
  });
}
const sum = (items: Meal["items"]) => ({
  kcalPoint: items.reduce((n, i) => n + i.kcalPoint, 0),
  kcalLow: items.reduce((n, i) => n + i.kcalLow, 0),
  kcalHigh: items.reduce((n, i) => n + i.kcalHigh, 0),
  proteinG: items.reduce((n, i) => n + i.proteinG, 0),
  carbsG: items.reduce((n, i) => n + i.carbsG, 0),
  fatG: items.reduce((n, i) => n + i.fatG, 0),
});

/** A server holding the person's meals: GET lists them newest first, POST keeps one, DELETE removes one. */
function foodServer(food: Food, more: Record<string, Route> = {}) {
  const server = fakeServer({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/nutrition/targets": () => ({ status: 200, body: food.targets ?? targets() }),
    "/v1/nutrition/foods": ok({ items: [OATS] }),
    "/v1/nutrition/meals/preview": ok({ items: [item(81, 307)], totals: totals(307) }),
    ...more,
  });
  const ask: Ask = async (url: string, init: AskInit) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    const body = init.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>);
    const id = /^\/v1\/nutrition\/meals\/([0-9a-f-]{36})$/.exec(path)?.[1];
    const [, of, part] = /^\/v1\/nutrition\/meals\/([0-9a-f-]{36})\/(measures|preview)$/.exec(path) ?? [];
    const answer = (reply: Reply) => ({ ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) });
    if (path === "/v1/nutrition/foods/recent") {
      server.asked.push({ method, path, body, headers: init.headers ?? {} });
      return answer({ status: 200, body: { items: food.recent ?? [] } });
    }
    if (of !== undefined) {
      server.asked.push({ method, path, body, headers: init.headers ?? {} });
      const meal = food.meals.find((m) => m.id === of);
      if (meal === undefined) return answer({ status: 404, body: { error: "not_found", message: "Not found", requestId: "r" } });
      if (part === "measures") return answer({ status: 200, body: { measures: meal.items.map(() => OATS.measures) } });
      const items = edited(meal, (body as { items: Edit[] }).items);
      return answer({ status: 200, body: { items, totals: sum(items) } });
    }
    if (path !== "/v1/nutrition/meals" && id === undefined) return server.ask(url, init);
    server.asked.push({ method, path, body, headers: init.headers ?? {} });
    if (method === "PATCH" && id !== undefined && body !== undefined) {
      if (food.patch === "lost") return lost() as never;
      // As the server: only a change to the foods carries the version it was made from, so only it is refused.
      if (food.patch === "changed" && (body as { items?: unknown }).items !== undefined) return answer({ status: 409, body: { error: "meal_changed", message: "This meal has changed since it was opened. Open it again.", requestId: "r" } });
      const at = food.meals.findIndex((m) => m.id === id);
      const meal = food.meals[at];
      if (meal === undefined) return answer({ status: 404, body: { error: "not_found", message: "Not found", requestId: "r" } });
      const change = body as { changeId: string; mealName?: string; mealType?: string; takenAt?: string; items?: Edit[] };
      food.made = food.made ?? [];
      let now = meal;
      if (!food.made.includes(change.changeId)) {
        food.made.push(change.changeId);
        const items = change.items === undefined ? meal.items : edited(meal, change.items);
        now = {
          ...meal,
          mealName: change.mealName ?? meal.mealName,
          mealType: (change.mealType ?? meal.mealType) as Meal["mealType"],
          takenAt: change.takenAt ?? meal.takenAt,
          items,
          totals: sum(items),
          itemsVersion: change.items === undefined ? meal.itemsVersion : `v${String(food.made.length + 1)}`,
        };
        food.meals = food.meals.map((m, i) => (i === at ? now : m));
      }
      if (food.patch === "made_lost") return lost() as never;
      return answer({ status: 200, body: { meal: now } });
    }
    if (method === "DELETE" && id !== undefined) {
      const had = food.meals.some((m) => m.id === id);
      food.meals = food.meals.filter((m) => m.id !== id);
      return answer(had ? { status: 204, body: undefined } : { status: 404, body: { error: "not_found", message: "Not found", requestId: "r" } });
    }
    if (method === "POST" && body !== undefined) {
      const sent = body as { id: string; mealName: string; takenAt: string; mealType?: string };
      if (food.save !== undefined) {
        const reply = food.save(sent);
        if (reply.status < 300 && !food.meals.some((m) => m.id === sent.id)) food.meals = [savedMeal(sent.id, sent), ...food.meals];
        return answer(reply);
      }
      const known = food.meals.find((m) => m.id === sent.id);
      if (known !== undefined) return answer({ status: 200, body: { meal: known } });
      const meal = savedMeal(sent.id, sent);
      food.meals = [meal, ...food.meals];
      return answer({ status: 201, body: { meal } });
    }
    if (food.listFails === true) return answer({ status: 503, body: { error: "unavailable", message: "Try again.", requestId: "r" } });
    const newest = [...food.meals].sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
    return answer({ status: 200, body: { items: newest, nextCursor: null } });
  };
  return { ...server, ask };
}

async function openFood(food: Food, store = files().store, more: Record<string, Route> = {}) {
  const server = foodServer(food, more);
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={store} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
  return server;
}

const posts = (server: ReturnType<typeof foodServer>) => server.asked.filter((a) => a.method === "POST" && a.path === "/v1/nutrition/meals");
const deletes = (server: ReturnType<typeof foodServer>) => server.asked.filter((a) => a.method === "DELETE");
const patches = (server: ReturnType<typeof foodServer>) => server.asked.filter((a) => a.method === "PATCH");

/** Adds a cup of oats to Breakfast from the Food tab. */
async function addOats() {
  await fireEvent.press(await screen.findByRole("button", { name: "Add to Breakfast" }));
  await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
  await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal · 1 cup, USDA" }));
  const add = await screen.findByRole("button", { name: "Add Oats, rolled · 307 kcal" });
  await fireEvent.press(add);
  // On the meal's list; then one save keeps the meal (Kd, 2026-10-30).
  await fireEvent.press(await screen.findByRole("button", { name: "Save meal to Breakfast" }));
}

describe("the worst thing: a meal is never lost or counted twice, and no calorie cut is shown that the health rules hold back", () => {
  it("somebody whose health answer holds back a cut sees the plan's own calories and why, and no smaller number", async () => {
    const held = { ...PLAN, noCalorieCut: true };
    await openFood({ meals: [], targets: targets({ targets: held, appTargets: held }) });
    expect(await screen.findByText("Your plan has no calorie cut, so these calories keep your weight.")).toBeTruthy();
    expect(screen.getByLabelText("Calories, 0 of 2,300 kcal")).toBeTruthy();
    expect(screen.getByText(/^2,300 kcal left/)).toBeTruthy();
    // Every calorie figure on the page is the plan's own 2,300, or none eaten: never a smaller target.
    const figures = screen
      .getAllByText(/[\d,]+ kcal/)
      .flatMap((t) => String(t.props.children instanceof Array ? t.props.children.join("") : t.props.children).match(/[\d,]+(?= kcal)/g) ?? []);
    expect(figures.length).toBeGreaterThan(0);
    expect(figures.filter((n) => n !== "2,300" && n !== "0")).toEqual([]);
  });

  it("a meal logged with no signal waits on the phone, survives a restart, and is saved once when the signal is back", async () => {
    const phone = files();
    const food: Food = { meals: [], save: () => lost() };
    const first = await openFood(food, phone.store);
    await addOats();
    expect(await screen.findByText("Oats, rolled added.")).toBeTruthy();
    expect(await screen.findByText("Waiting to send")).toBeTruthy();
    await waitFor(() => {
      expect(posts(first).length).toBeGreaterThan(0);
    });
    expect(food.meals).toEqual([]);
    const waiting = JSON.parse(phone.kept.get(RAVI.id) ?? "") as { entries: { meal: { id: string } }[] };
    expect(waiting.entries).toHaveLength(1);
    const id = waiting.entries[0]?.meal.id ?? "";
    await screen.unmount();

    // The app opened again, the signal back.
    delete food.save;
    const second = await openFood(food, phone.store);
    await waitFor(() => {
      expect(food.meals.map((m) => m.id)).toEqual([id]);
    });
    expect(posts(second).map((p) => (p.body as { id: string }).id)).toEqual([id]);
    await waitFor(() => {
      expect(screen.queryByText("Waiting to send")).toBeNull();
    });
    expect(await screen.findByText("1 × cup · 81 g")).toBeTruthy();
    expect(JSON.parse(phone.kept.get(RAVI.id) ?? "")).toEqual({ version: 1, entries: [], refused: [] });
  });

  it("a meal removed while its save had no answer is removed on the server after it, and never comes back", async () => {
    const food: Food = { meals: [], save: () => lost() };
    const server = await openFood(food);
    await addOats();
    await fireEvent.press(await screen.findByRole("button", { name: /^Oats, rolled, 307 kcal, waiting to send$/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove meal" }));
    // The signal is back as the person says yes.
    delete food.save;
    await fireEvent.press(screen.getByRole("button", { name: "Remove meal" }));
    expect(await screen.findByText("Oats, rolled removed.")).toBeTruthy();
    await waitFor(() => {
      expect(deletes(server)).toHaveLength(1);
    });
    const writes = server.asked.filter((a) => a.path.startsWith("/v1/nutrition/meals") && a.method !== "GET").map((a) => a.method);
    expect(writes.at(-1)).toBe("DELETE");
    expect(writes.slice(0, -1).every((m) => m === "POST")).toBe(true);
    expect(food.meals).toEqual([]);
    expect(screen.getByText("No breakfast logged yet.")).toBeTruthy();
  });
});

describe("the day's food", () => {
  it("shows the rings against the person's numbers, what is left today, and each meal in its section", async () => {
    const now = new Date();
    const breakfast = savedMeal("11111111-1111-4111-8111-111111111111", {
      mealName: "Oats, rolled",
      takenAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30).toISOString(),
      mealType: "breakfast",
    });
    await openFood({ meals: [breakfast] });
    expect(await screen.findByLabelText("Calories, 307 of 2,300 kcal")).toBeTruthy();
    expect(screen.getByText(/^1,993 kcal left · Protein 109 g left · Carbs 225 g left · Fat 70 g left$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Oats, rolled, 307 kcal" })).toBeTruthy();
    expect(screen.getByText("No lunch logged yet.")).toBeTruthy();
  });

  it("adds a food by search and measure, sending the measure and the meal's own id", async () => {
    const server = await openFood({ meals: [] });
    await addOats();
    expect(await screen.findByText("Oats, rolled added.")).toBeTruthy();
    await waitFor(() => {
      expect(posts(server)).toHaveLength(1);
    });
    const body = posts(server)[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ mealName: "Oats, rolled", mealType: "breakfast", items: [{ canonical: "oats_rolled", measure: "usda-1", amount: 1 }] });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" })).toBeTruthy();
  });

  it("removes a meal only after asking, and says so in its section", async () => {
    const meal = savedMeal("22222222-2222-4222-8222-222222222222", { mealName: "Oats, rolled", takenAt: new Date().toISOString(), mealType: "lunch" });
    const food: Food = { meals: [meal] };
    const server = await openFood(food);
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove meal" }));
    expect(screen.getByText("Remove this meal?")).toBeTruthy();
    expect(deletes(server)).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Keep it" }));
    expect(deletes(server)).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Remove meal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove meal" }));
    expect(await screen.findByText("Oats, rolled removed.")).toBeTruthy();
    await waitFor(() => {
      expect(deletes(server).map((d) => d.path)).toEqual([`/v1/nutrition/meals/${meal.id}`]);
    });
    expect(food.meals).toEqual([]);
  });

  it("with an answer missing, names it and opens setup", async () => {
    await openFood({ meals: [], targets: targets({ targets: null, appTargets: null, missing: ["heightCm"] }) });
    expect(await screen.findByText(/^To see your daily calories and macros, answer /)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Answer now" }));
    expect(await screen.findByTestId("setup")).toBeTruthy();
  });

  it("goes back a day, where nothing can be added, and not past today", async () => {
    await openFood({ meals: [] });
    const next = await screen.findByRole("button", { name: "This is today" });
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole("button", { name: "Previous day" }));
    expect(await screen.findByText("Yesterday")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add to Breakfast" })).toBeNull();
  });
});

describe("what the numbers are, and where they come from", () => {
  it("a scanned meal's estimate says so beside the food and makes its calories about; the data's credit is named", async () => {
    const scanned = savedMeal("33333333-3333-4333-8333-333333333333", { mealName: "Lunch plate", takenAt: new Date().toISOString(), mealType: "lunch" });
    scanned.items = [{ ...scanned.items[0], nutritionSource: "estimate" } as Meal["items"][number]];
    await openFood({ meals: [scanned] });
    const row = await screen.findByRole("button", { name: "Lunch plate, about 307 kcal" });
    expect(within(row).getByText("1 × cup · 81 g · estimate")).toBeTruthy();
    expect(screen.getByText(/^about 1,993 kcal left/)).toBeTruthy();
    expect(screen.queryByText(/USDA FoodData Central/)).toBeNull();
  });

  it("a USDA food on the day carries USDA's credit, and a hand-checked food in the search reads Verified", async () => {
    const meal = savedMeal("44444444-4444-4444-8444-444444444444", { mealName: "Oats, rolled", takenAt: new Date().toISOString(), mealType: "breakfast" });
    const server = foodServer({ meals: [meal] }, { "/v1/nutrition/foods": ok({ items: [{ ...OATS, source: "curated" }] }) });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={files().store} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
    expect(await screen.findByRole("link", { name: "USDA FoodData Central" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Add to Breakfast" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
    expect(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal · 1 cup, Verified" })).toBeTruthy();
    expect(screen.queryByText(/Our list/)).toBeNull();
  });

  const pickPackaged = async (packaged: Record<string, unknown>) => {
    const server = foodServer({ meals: [] }, { "/v1/nutrition/foods": ok({ items: [{ ...OATS, source: "usda", packaged }] }) });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={files().store} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Breakfast" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal · 1 cup, USDA" }));
  };

  it("a product picked in the search says what its barcode says: why to check it, and its allergens", async () => {
    await pickPackaged({ check: "doesnt_add_up", allergens: ["milk"], mayContain: ["nuts"], listedAsTyped: [], allergensFrom: "openfoodfacts" });
    expect(await screen.findByText("These numbers don’t add up. Check the pack.")).toBeTruthy();
    expect(screen.getByText(/Milk/)).toBeTruthy();
    expect(screen.getByText(/Nuts/)).toBeTruthy();
  });

  it("a packaged product with no allergens listed never reads as safe once picked", async () => {
    await pickPackaged({ check: "fine", allergens: [], mayContain: [], listedAsTyped: [], allergensFrom: null });
    expect(await screen.findByText("No allergens listed. Check the pack.")).toBeTruthy();
  });

  it("a packaged product in the search carries Open Food Facts' licence notice", async () => {
    const server = foodServer({ meals: [] }, { "/v1/nutrition/foods": ok({ items: [{ ...OATS, source: "openfoodfacts" }] }) });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={files().store} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Breakfast" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
    expect(await screen.findByRole("link", { name: "Open Database License (ODbL)" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Food Facts" })).toBeTruthy();
  });
});

describe("picking a day", () => {
  it("opens a month, goes to the day pressed, and offers no day after today", async () => {
    await openFood({ meals: [] });
    await fireEvent.press(await screen.findByRole("button", { name: "Today, pick a day" }));
    expect(screen.getByText("Pick a day")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next month" }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole("button", { name: "Previous month" }));
    const now = new Date();
    const fifteenth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const label = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][fifteenth.getDay()] ?? ""}, 15 ${
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][fifteenth.getMonth()] ?? ""
    }`;
    await fireEvent.press(screen.getByRole("button", { name: label }));
    expect(await screen.findByRole("button", { name: `${label}, pick a day` })).toBeTruthy();
    expect(screen.queryByText("Pick a day")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add to Breakfast" })).toBeNull();
  });
});

describe("round one's findings, on the screen", () => {
  it("a meal the server has just saved stays on the day though the next read of the day fails", async () => {
    const food: Food = { meals: [] };
    await openFood(food);
    await screen.findByText("No breakfast logged yet.");
    food.listFails = true;
    await addOats();
    await waitFor(() => {
      expect(food.meals).toHaveLength(1);
    });
    expect(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" })).toBeTruthy();
    expect(screen.queryByText("Waiting to send")).toBeNull();
    expect(screen.getByLabelText("Calories, 307 of 2,300 kcal")).toBeTruthy();
  });

  it("a meal saved and then changed, before a read of the day holds either, is one row counted once", async () => {
    const food: Food = { meals: [] };
    await openFood(food);
    await screen.findByText("No breakfast logged yet.");
    food.listFails = true;
    await addOats();
    await waitFor(() => {
      expect(food.meals).toHaveLength(1);
    });
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Edit" }));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Big oats");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(food.meals[0]?.mealName).toBe("Big oats");
    });
    await waitFor(() => {
      expect(screen.queryByText("Waiting to send")).toBeNull();
    });
    expect(screen.getAllByRole("button", { name: /, 307 kcal/ }).map((b) => String(b.props.accessibilityLabel))).toEqual(["Big oats, 307 kcal"]);
    expect(screen.getByLabelText("Calories, 307 of 2,300 kcal")).toBeTruthy();
  });

  it("a meal just removed stays off the day though the next read of the day fails", async () => {
    const meal = savedMeal("55555555-5555-4555-8555-555555555555", { mealName: "Oats, rolled", takenAt: new Date().toISOString(), mealType: "lunch" });
    const food: Food = { meals: [meal] };
    await openFood(food);
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" }));
    food.listFails = true;
    await fireEvent.press(screen.getByRole("button", { name: "Remove meal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove meal" }));
    await waitFor(() => {
      expect(food.meals).toEqual([]);
    });
    expect(screen.queryByRole("button", { name: "Oats, rolled, 307 kcal" })).toBeNull();
    expect(screen.getByText("No lunch logged yet.")).toBeTruthy();
  });

  it("a meal logged before its numbers came back makes the day's figures not known, and says why", async () => {
    const server = foodServer({ meals: [], save: () => lost() }, { "/v1/nutrition/meals/preview": () => lost() });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={files().store} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Breakfast" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal · 1 cup, USDA" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add Oats, rolled" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Save meal to Breakfast" }));
    expect(await screen.findByText("1 meal is waiting for its numbers. They come once it is sent.")).toBeTruthy();
    expect(screen.getByLabelText("Calories, not known of 2,300 kcal")).toBeTruthy();
    expect(screen.queryByText(/kcal left/)).toBeNull();
  });

  it("a meal the server refuses for its shape is said in the app's own words, never the server's codes", async () => {
    await openFood({
      meals: [],
      save: () => ({ status: 400, body: { error: "validation_error", message: "takenAt: custom", requestId: "r" } }),
    });
    await addOats();
    expect(await screen.findByText("Oats, rolled wasn’t saved. This meal couldn't be saved. Add it again.")).toBeTruthy();
    expect(screen.queryByText(/takenAt/)).toBeNull();
  });
});

describe("the re-check's finding", () => {
  it("two quick presses on Add keep one meal", async () => {
    // The phone's file is slow to write, so the second press lands while the first is still being kept.
    let written: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      written = resolve;
    });
    const phone = files();
    const store = (userId: string): TextStore => ({
      read: phone.store(userId).read,
      write: async (text) => {
        await slow;
        await phone.store(userId).write(text);
      },
    });
    const server = await openFood({ meals: [] }, store);
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Breakfast" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal · 1 cup, USDA" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add Oats, rolled · 307 kcal" }));
    const keep = await screen.findByRole("button", { name: "Save meal to Breakfast" });
    await fireEvent.press(keep);
    await fireEvent.press(keep);
    written();
    expect(await screen.findByText("Oats, rolled added.")).toBeTruthy();
    await waitFor(() => {
      expect(posts(server).length).toBeGreaterThan(0);
    });
    expect(new Set(posts(server).map((p) => (p.body as { id: string }).id)).size).toBe(1);
    expect(screen.getAllByRole("button", { name: /^Oats, rolled, 307 kcal/ })).toHaveLength(1);
  });
});

describe("changing a logged meal (32b-ii-a)", () => {
  const LUNCH = "66666666-6666-4666-8666-666666666666";
  const halfPastMidnight = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30).toISOString();
  };
  const lunch = () => savedMeal(LUNCH, { mealName: "Oats, rolled", takenAt: halfPastMidnight(), mealType: "lunch" });

  it("the worst thing: a meal renamed and moved with no signal waits, survives a restart, and is changed once", async () => {
    const phone = files();
    const food: Food = { meals: [lunch()], patch: "made_lost" };
    const first = await openFood(food, phone.store);
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Edit" }));
    await fireEvent.changeText(screen.getByLabelText("Name"), "Big oats");
    await fireEvent.press(screen.getByRole("radio", { name: "Dinner" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Big oats updated.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Big oats, 307 kcal, waiting to send" })).toBeTruthy();
    expect(screen.getByText("No lunch logged yet.")).toBeTruthy();
    await waitFor(() => {
      expect(patches(first).length).toBeGreaterThan(0);
    });
    await screen.unmount();

    // The app opened again, the signal back: the change is sent again under its own id, and made once.
    delete food.patch;
    const second = await openFood(food, phone.store);
    await waitFor(() => {
      expect(screen.queryByText("Waiting to send")).toBeNull();
    });
    const ids = [...patches(first), ...patches(second)].map((p) => (p.body as { changeId: string }).changeId);
    expect(new Set(ids).size).toBe(1);
    expect(ids.length).toBeGreaterThan(1);
    expect(food.made).toHaveLength(1);
    expect(food.meals[0]).toMatchObject({ mealName: "Big oats", mealType: "dinner" });
    expect(patches(second)[0]?.body).toEqual({ mealName: "Big oats", mealType: "dinner", changeId: ids[0] });
    expect(await screen.findByRole("button", { name: "Big oats, 307 kcal" })).toBeTruthy();
    expect(JSON.parse(phone.kept.get(RAVI.id) ?? "")).toEqual({ version: 1, entries: [], refused: [] });
  });

  it("a food saved from a photo keeps what the photo saw as its name, with the food its numbers are from under it (33b-ii)", async () => {
    const fromPhoto = lunch();
    fromPhoto.items = fromPhoto.items.map((it) => ({ ...it, seenAs: "Porridge" }));
    await openFood({ meals: [fromPhoto] });
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" }));
    expect(await screen.findByText("Porridge")).toBeTruthy();
    expect(screen.getByText("Oats, rolled ·")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Change Porridge, Oats, rolled, 1 × cup · 81 g" }));
    expect(await screen.findByText("Logged: 1 × cup · 81 g · 307 kcal")).toBeTruthy();
    expect(screen.getAllByText("Porridge").length).toBeGreaterThan(0);
    expect(screen.getByText("Oats, rolled ·")).toBeTruthy();
  });

  it("changes a food's amount with the server's numbers, and the day's totals follow", async () => {
    const food: Food = { meals: [lunch()] };
    const server = await openFood(food);
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Change Oats, rolled, 1 × cup · 81 g" }));
    expect(screen.getByText("Logged: 1 × cup · 81 g · 307 kcal")).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: "More" }));
    expect(await screen.findByText("461 kcal · Meal total 461 kcal")).toBeTruthy();
    expect(screen.getByText("= 122 g")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Oats, rolled updated.")).toBeTruthy();
    await waitFor(() => {
      expect(patches(server)).toHaveLength(1);
    });
    expect(patches(server)[0]?.body).toMatchObject({ items: [{ from: 0, canonical: "oats_rolled", measure: "usda-1", amount: 1.5 }], itemsVersion: "v1" });
    expect(await screen.findByLabelText("Calories, 461 of 2,300 kcal")).toBeTruthy();
  });

  it("a food that is a part of one dish opens at its grams, and saved untouched keeps them (round one, High 1)", async () => {
    const shared = { ...item(81, 307), measure: { id: "dish", name: "Bowl", amount: 1, share: 0.5 } };
    const two = { ...lunch(), mealName: "Shared bowl", items: [shared, { ...item(81, 307), name: "Banana", canonical: "banana", measure: { id: "dish", name: "Bowl", amount: 1, share: 0.5 } }] as Meal["items"] };
    two.totals = sum(two.items);
    const server = await openFood({ meals: [two] }, undefined, { "/v1/nutrition/dishware": ok({ items: [], nextCursor: null }) });
    await fireEvent.press(await screen.findByRole("button", { name: "Shared bowl, 614 kcal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Change Oats, rolled, Part of Bowl, full · 81 g" }));
    // Not the whole bowl of oats: what it weighs.
    expect(await screen.findByText("307 kcal · Meal total 614 kcal")).toBeTruthy();
    expect(screen.getByLabelText("Amount").props.value).toBe("81");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(patches(server)).toHaveLength(1);
    });
    expect(patches(server)[0]?.body).toMatchObject({ items: [{ from: 0, canonical: "oats_rolled", measure: "g", amount: 81 }, { from: 1 }] });
  });

  it("removes one food only after asking, and offers no removal of a meal's only food", async () => {
    const two = { ...lunch(), mealName: "Lunch plate", items: [item(81, 307), { ...item(40, 152), name: "Banana", canonical: "banana" }] as Meal["items"] };
    two.totals = sum(two.items);
    const food: Food = { meals: [two] };
    const server = await openFood(food);
    await fireEvent.press(await screen.findByRole("button", { name: "Lunch plate, 459 kcal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Change Oats, rolled, 1 × cup · 81 g" }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove from meal" }));
    expect(screen.getByText("Remove Oats, rolled?")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Keep it" }));
    expect(patches(server)).toHaveLength(0);
    await fireEvent.press(screen.getByRole("button", { name: "Remove from meal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Remove food" }));
    expect(await screen.findByText("Oats, rolled removed from Lunch plate.")).toBeTruthy();
    await waitFor(() => {
      expect(food.meals[0]?.items.map((i) => i.name)).toEqual(["Banana"]);
    });
    expect(patches(server)[0]?.body).toMatchObject({ items: [{ from: 1 }], itemsVersion: "v1" });
    expect(await screen.findByLabelText("Calories, 152 of 2,300 kcal")).toBeTruthy();

    await fireEvent.press(await screen.findByRole("button", { name: "Lunch plate, 152 kcal" }));
    await fireEvent.press(screen.getByRole("button", { name: /^Change Banana/ }));
    expect(screen.queryByRole("button", { name: "Remove from meal" })).toBeNull();
  });

  it("a meal still waiting to be sent keeps its foods as they are until it is sent", async () => {
    await openFood({ meals: [], save: () => lost() });
    await addOats();
    await fireEvent.press(await screen.findByRole("button", { name: /^Oats, rolled, 307 kcal, waiting to send$/ }));
    expect(screen.getByText("You can change its foods once it’s sent.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Change Oats/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("a change made after the meal was changed on another device is said, and the meal stays as the server has it", async () => {
    const food: Food = { meals: [lunch()], patch: "changed" };
    await openFood(food);
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Change Oats, rolled, 1 × cup · 81 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: "More" }));
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Your change to Oats, rolled wasn’t saved. The meal was changed on another device. Open it and make the change again."),
    ).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByText(/wasn’t saved/)).toBeNull();
  });

  it("moves a meal's time a quarter of an hour at a time, and sends only the time", async () => {
    const food: Food = { meals: [lunch()] };
    const server = await openFood(food);
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("12:30 AM")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Later" }));
    await fireEvent.press(screen.getByRole("button", { name: "Later" }));
    expect(screen.getByText("1:00 AM")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(patches(server)).toHaveLength(1);
    });
    expect(patches(server)[0]?.body).toEqual({ takenAt: new Date(Date.parse(halfPastMidnight()) + 30 * 60_000).toISOString(), changeId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown });
  });
});

describe("previously logged foods (32b-ii-a)", () => {
  const recentOats: RecentFood = {
    canonical: "oats_rolled",
    source: "usda",
    add: { measure: "usda-1", amount: 1.5 },
    item: { ...item(121.5, 461), measure: { id: "usda-1", name: "cup", amount: 1.5 } } as RecentFood["item"],
    measures: OATS.measures,
  };

  it("Add to a meal opens on the foods logged before; the + opens one at the amount last had, logged only on Add", async () => {
    const server = await openFood({ meals: [], recent: [recentOats] });
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Lunch" }));
    expect(await screen.findByText("Previously logged")).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: "Add Oats, rolled" }));
    expect(screen.getByLabelText("Amount").props.value).toBe("1.5");
    expect(posts(server)).toHaveLength(0);
    await fireEvent.press(await screen.findByRole("button", { name: "Add Oats, rolled · 307 kcal" }));
    expect(posts(server)).toHaveLength(0);
    await fireEvent.press(await screen.findByRole("button", { name: "Save meal to Lunch" }));
    expect(await screen.findByText("Oats, rolled added.")).toBeTruthy();
    await waitFor(() => {
      expect(posts(server)).toHaveLength(1);
    });
    expect(posts(server)[0]?.body).toMatchObject({ mealName: "Oats, rolled", mealType: "lunch", items: [{ canonical: "oats_rolled", measure: "usda-1", amount: 1.5 }] });
    expect(screen.getByText(/^Food data from /)).toBeTruthy();
  });

  it("with no signal, a food logged before is added at the amount last had with its numbers then, and waits to send", async () => {
    await openFood({ meals: [], recent: [recentOats], save: () => lost() }, undefined, { "/v1/nutrition/meals/preview": () => lost() });
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Lunch" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add Oats, rolled" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add Oats, rolled" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Save meal to Lunch" }));
    expect(await screen.findByRole("button", { name: "Oats, rolled, 461 kcal, waiting to send" })).toBeTruthy();
    expect(screen.getByLabelText("Calories, 461 of 2,300 kcal")).toBeTruthy();
  });

  it("a food logged before opens at the amount last had, to change before it is added", async () => {
    const server = await openFood({ meals: [], recent: [recentOats] });
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Lunch" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 1.5 × cup · 122 g, 461 kcal" }));
    expect(screen.getByLabelText("Amount").props.value).toBe("1.5");
    expect(screen.getByRole("radio", { name: "cup · 81 g" }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole("button", { name: "More" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add Oats, rolled · 307 kcal" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Save meal to Lunch" }));
    expect(await screen.findByText("Oats, rolled added.")).toBeTruthy();
    await waitFor(() => {
      expect(posts(server)).toHaveLength(1);
    });
    expect(posts(server)[0]?.body).toMatchObject({ mealType: "lunch", items: [{ canonical: "oats_rolled", measure: "usda-1", amount: 2 }] });
  });

  it("a search hides the recent foods, and an empty search brings them back", async () => {
    await openFood({ meals: [], recent: [recentOats] });
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Lunch" }));
    expect(await screen.findByText("Previously logged")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Search food"), "oat");
    expect(screen.queryByText("Previously logged")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Search food"), "");
    expect(await screen.findByText("Previously logged")).toBeTruthy();
  });
});

describe("the ten figures (34b)", () => {
  const figures = { forWhom: "women aged 19 to 30", amounts: { fiberG: { kind: "about", amount: 25 }, sugarsG: null, satFatG: { kind: "most", amount: 20 }, unsatFatG: null, sodiumMg: { kind: "most", amount: 2300 }, potassiumMg: { kind: "about", amount: 2600 }, calciumMg: { kind: "about", amount: 1000 }, ironMg: { kind: "about", amount: 18 }, magnesiumMg: { kind: "about", amount: 310 }, vitaminDUg: { kind: "about", amount: 15 } } };
  const MORE = { fiberG: 11.9, sugarsG: 2.7, satFatG: 0.1, unsatFatG: null, sodiumMg: 3, potassiumMg: 554, calciumMg: 29, ironMg: 5, magnesiumMg: 54, vitaminDUg: 0 };
  const twoFoods = (): Meal => {
    const meal = savedMeal("66666666-6666-4666-8666-666666666666", { mealName: "Lunch", takenAt: new Date().toISOString(), mealType: "lunch" });
    const known = { ...item(150, 174), name: "Lentils", more: MORE } as Meal["items"][number];
    const estimate = { ...item(200, 500), name: "Pizza", nutritionSource: "estimate" } as Meal["items"][number];
    return { ...meal, items: [known, estimate] };
  };
  const daily = { "/v1/nutrition/daily-amounts": () => ({ status: 200, body: figures }) };

  it("the worst thing: a day with a food missing its sodium marks the total, names the food, with whose amount it is and that it is no goal", async () => {
    await openFood({ meals: [twoFoods()] }, undefined, daily);
    await fireEvent.press(await screen.findByRole("button", { name: "Nutrients" }));
    expect(await screen.findByLabelText("Sodium, 3 mg*. Limit 2,300 mg")).toBeTruthy();
    expect(screen.getByLabelText("Iron, 5 mg*. Recommended 18 mg")).toBeTruthy();
    expect(screen.getByLabelText("Unsaturated fat, No data")).toBeTruthy();
    expect(screen.getByText("* Some data is missing for Pizza.")).toBeTruthy();
    expect(screen.getByText("Daily amounts for women aged 19 to 30.")).toBeTruthy();
    expect(screen.getByText("These are general guidelines, not goals set by the app.")).toBeTruthy();
    expect(screen.getByText("Pregnancy or a health condition can change them.")).toBeTruthy();
    expect(screen.getByText("The saturated fat limit is the US Daily Value.")).toBeTruthy();
    expect(screen.getByText("Sources: Health Canada and the US FDA.")).toBeTruthy();
  });

  it("a saved meal shows its own figures", async () => {
    await openFood({ meals: [twoFoods()] }, undefined, daily);
    await fireEvent.press(await screen.findByRole("button", { name: /^Lunch, / }));
    const links = await screen.findAllByRole("button", { name: "Nutrients" });
    await fireEvent.press(links[links.length - 1] as NonNullable<(typeof links)[number]>);
    expect(await screen.findByText("Nutrients · Lunch")).toBeTruthy();
    expect(screen.getByLabelText("Calcium, 29 mg*. Recommended 1,000 mg")).toBeTruthy();
  });

  it("the amounts not loading still shows the figures, and says nothing about whose they are", async () => {
    await openFood({ meals: [twoFoods()] });
    await fireEvent.press(await screen.findByRole("button", { name: "Nutrients" }));
    expect(await screen.findByLabelText("Sodium, 3 mg*")).toBeTruthy();
    expect(screen.queryByText(/^Daily amounts/)).toBeNull();
  });

  it("a packaged food says its values are from the label, and somebody with no age or gender is told whose amounts they read", async () => {
    const meal = twoFoods();
    const pack = { ...item(15, 67), name: "Parle-G", canonical: "off_8901719101038", nutritionSource: "openfoodfacts", more: MORE } as Meal["items"][number];
    await openFood({ meals: [{ ...meal, items: [pack] }] }, undefined, { "/v1/nutrition/daily-amounts": () => ({ status: 200, body: { ...figures, forWhom: null } }) });
    await fireEvent.press(await screen.findByRole("button", { name: "Nutrients" }));
    expect(await screen.findByText("Packaged food values are from the label.")).toBeTruthy();
    expect(screen.getByText("Daily amounts are the US Daily Values used on food labels.")).toBeTruthy();
    expect(screen.queryByText("The saturated fat limit is the US Daily Value.")).toBeNull();
  });

  it("answers changed in setup read the amounts again: a woman is not left with a man's", async () => {
    const hers = { ...figures, amounts: { ...figures.amounts, ironMg: { kind: "about", amount: 18 } } };
    const his = { forWhom: "men aged 19 to 30", amounts: { ...figures.amounts, ironMg: { kind: "about", amount: 8 } } };
    let now: unknown = his;
    await openFood(
      { meals: [twoFoods()], targets: targets({ targets: null, appTargets: null, missing: ["heightCm"] }) },
      undefined,
      { "/v1/nutrition/daily-amounts": () => ({ status: 200, body: now }) },
    );
    await fireEvent.press(await screen.findByRole("button", { name: "Answer now" }));
    const setup = await screen.findByTestId("setup");
    now = hers;
    await fireEvent(setup, "requestClose");
    await fireEvent.press(await screen.findByRole("button", { name: "Nutrients" }));
    expect(await screen.findByLabelText("Iron, 5 mg*. Recommended 18 mg")).toBeTruthy();
    expect(screen.getByText("Daily amounts for women aged 19 to 30.")).toBeTruthy();
  });

  it("a meal waiting to send marks the day's figures and says why", async () => {
    const server = foodServer({ meals: [], save: () => lost() }, { "/v1/nutrition/meals/preview": () => lost() });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={files().store} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Breakfast" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 307 kcal · 1 cup, USDA" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add Oats, rolled" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Save meal to Breakfast" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Nutrients" }));
    expect(await screen.findByText("* A meal waiting to send isn’t counted yet.")).toBeTruthy();
    expect(screen.getByLabelText("Sodium, No data")).toBeTruthy();
  });

  it("a day cut short by the pages read marks its figures and says why", async () => {
    const whole = twoFoods();
    const lentils = whole.items[0];
    const meal = { ...whole, items: lentils === undefined ? [] : [lentils] };
    const server = foodServer({ meals: [meal] }, daily);
    const ask: Ask = (url, init) =>
      new URL(url).pathname === "/v1/nutrition/meals" && (init.method ?? "GET") === "GET"
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [meal], nextCursor: "next" }) })
        : server.ask(url, init);
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} mealStore={files().store} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
    const links = await screen.findAllByRole("button", { name: "Nutrients" });
    await fireEvent.press(links[0] as NonNullable<(typeof links)[number]>);
    expect(await screen.findByText("* Meals this far back couldn’t all be read.")).toBeTruthy();
    expect(screen.getByLabelText("Fibre, 11.9 g*. Recommended 25 g")).toBeTruthy();
  });

  it("an empty day offers no list", async () => {
    await openFood({ meals: [] }, undefined, daily);
    await screen.findByText("No lunch logged yet.");
    expect(screen.queryByRole("button", { name: "Nutrients" })).toBeNull();
  });
});
