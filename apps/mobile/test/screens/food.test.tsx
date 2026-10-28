import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { Meal, NutritionTargetsResponse } from "@app/shared";
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
}

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
    if (path !== "/v1/nutrition/meals" && id === undefined) return server.ask(url, init);
    server.asked.push({ method, path, body, headers: init.headers ?? {} });
    const answer = (reply: Reply) => ({ ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) });
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

async function openFood(food: Food, store = files().store) {
  const server = foodServer(food);
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={store} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
  return server;
}

const posts = (server: ReturnType<typeof foodServer>) => server.asked.filter((a) => a.method === "POST" && a.path === "/v1/nutrition/meals");
const deletes = (server: ReturnType<typeof foodServer>) => server.asked.filter((a) => a.method === "DELETE");

/** Adds a cup of oats to Breakfast from the Food tab. */
async function addOats() {
  await fireEvent.press(await screen.findByRole("button", { name: "Add to Breakfast" }));
  await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
  await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 379 kcal per 100 g, USDA" }));
  const add = await screen.findByRole("button", { name: "Add Oats, rolled · 307 kcal" });
  await fireEvent.press(add);
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
    expect(await screen.findByRole("button", { name: "Oats, rolled, 379 kcal per 100 g, Verified" })).toBeTruthy();
    expect(screen.queryByText(/Our list/)).toBeNull();
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
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 379 kcal per 100 g, USDA" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Add Oats, rolled" }));
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
    const server = await openFood({ meals: [] });
    await fireEvent.press(await screen.findByRole("button", { name: "Add to Breakfast" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "oats");
    await fireEvent.press(await screen.findByRole("button", { name: "Oats, rolled, 379 kcal per 100 g, USDA" }));
    const add = await screen.findByRole("button", { name: "Add Oats, rolled · 307 kcal" });
    void fireEvent.press(add);
    void fireEvent.press(add);
    expect(await screen.findByText("Oats, rolled added.")).toBeTruthy();
    await waitFor(() => {
      expect(posts(server).length).toBeGreaterThan(0);
    });
    expect(new Set(posts(server).map((p) => (p.body as { id: string }).id)).size).toBe(1);
    expect(screen.getAllByRole("button", { name: /^Oats, rolled, 307 kcal/ })).toHaveLength(1);
  });
});
