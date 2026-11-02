import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { DIET_LABEL_CAUTION, FOOD_ALLERGY_CAUTION, type DietPlanResponse } from "@app/shared";
import { App } from "../../src/App";
import type { TextStore } from "../../src/screens/food/outbox";
import { planDayOf } from "../../src/screens/food/planRules";
import { fakeServer, kept, memoryStore, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const NUMBERS = { kcal: 2300, bmr: 1600, tdee: 2300, proteinG: 120, carbsG: 280, fatG: 75, noCalorieCut: false };
const TARGETS = { targets: NUMBERS, missing: [], targetWrongSide: false, source: "app", appTargets: NUMBERS, own: null, ownHeld: null };
const IDEAS = { status: "ok", day: "2026-11-02", kcalLeft: 0, meals: [], caution: FOOD_ALLERGY_CAUTION, labelCaution: null };
const TODAY = planDayOf(new Date());
const OTHER = (TODAY % 7) + 1;

const item = (canonical: string, name: string, gramsPoint: number, kcal: number) => ({
  name, canonical, gramsPoint, gramsRange: [gramsPoint, gramsPoint] as [number, number], portionSource: "default", kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal,
  proteinG: 20, carbsG: 30, fatG: 5, nutritionSource: "usda",
});
const planned = (mealType: string, kcal: number, ...items: ReturnType<typeof item>[]) => ({
  mealType, items, outsideDiet: [] as string[],
  totals: { kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 20, carbsG: 30, fatG: 5 },
});
const OATS = planned("breakfast", 410, item("oats", "Oatmeal", 250, 410));
const RICE = planned("lunch", 640, item("rice_white", "Rice", 212, 340), item("dal", "Dal", 150, 300));
const SALMON = planned("dinner", 700, item("salmon", "Salmon", 180, 700));
const TOFU = planned("lunch", 650, item("tofu", "Tofu", 220, 650));

type Meal = typeof OATS;
function week(todayMeals: Meal[], over: Partial<DietPlanResponse> = {}, otherMeals: Meal[] = []): DietPlanResponse {
  return {
    days: [1, 2, 3, 4, 5, 6, 7].map((day) => {
      const meals = day === TODAY ? todayMeals : day === OTHER ? otherMeals : [];
      return {
        day,
        meals,
        planned: { kcal: meals.reduce((n, m) => n + m.totals.kcalPoint, 0), proteinG: 0, carbsG: 0, fatG: 0 },
        target: { kcal: 2300, proteinG: 120, carbsG: 280, fatG: 75 },
        off: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      };
    }),
    make: { status: "ok" },
    caution: FOOD_ALLERGY_CAUTION,
    labelCaution: null,
    ...over,
  } as DietPlanResponse;
}

function files(): (userId: string) => TextStore {
  const held = new Map<string, string>();
  return (userId) => ({
    read: () => Promise.resolve(held.get(userId) ?? null),
    write: (text) => {
      held.set(userId, text);
      return Promise.resolve();
    },
  });
}

interface SentMeal { id: string; mealName: string; takenAt: string; mealType: string; items: { canonical: string; grams: number }[] }

function serverOf(plan: () => Reply, more: Record<string, Route> = {}, saving: Route | null = null) {
  const meals: unknown[] = [];
  const s = fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/nutrition/targets": () => ({ status: 200, body: TARGETS }),
    "/v1/nutrition/suggestions": () => ({ status: 200, body: IDEAS }),
    "/v1/nutrition/diet-plan": () => plan(),
    "/v1/workouts": () => ({ status: 200, body: { items: [], nextCursor: null, limitedToDays: 90, hasAnyWorkouts: false } }),
    "/v1/geo/runs": () => ({ status: 200, body: { items: [], nextCursor: null } }),
    "/v1/nutrition/meals": async (body) => {
      if (body === undefined) return { status: 200, body: { items: meals, nextCursor: null } };
      if (saving !== null) return saving(body);
      const b = body as SentMeal;
      const meal = {
        id: b.id, takenAt: b.takenAt, mealType: b.mealType, mealName: b.mealName, confirmed: true, origin: "manual", portionSource: "default",
        nutritionSources: ["usda"], calcVersion: 1, itemsVersion: "v1",
        items: b.items.map((i) => item(i.canonical, i.canonical, i.grams, 340)),
        totals: { kcalPoint: 640, kcalLow: 640, kcalHigh: 640, proteinG: 20, carbsG: 30, fatG: 5 },
      };
      if (!meals.some((m) => (m as { id: string }).id === b.id)) meals.push(meal);
      return { status: 201, body: { meal } };
    },
    ...more,
  });
  return { s, meals };
}

async function open(world: ReturnType<typeof serverOf>, store = files(), tab: "Food" | "Dashboard" = "Food") {
  await render(<App extra={extra} ask={world.s.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={store} />);
  await fireEvent.press(await screen.findByRole("tab", { name: tab }));
  return screen;
}
const posts = (world: ReturnType<typeof serverOf>, path: string) => world.s.asked.filter((a) => a.method === "POST" && a.path === path);
const ok = (body: unknown): Reply => ({ status: 200, body });

describe("the worst thing: one tap logs one meal, at what it showed; nobody is shown food outside their diet unsaid", () => {
  it("two quick taps log one meal, by the plan's own foods and grams, under its own meal", async () => {
    const world = serverOf(() => ok(week([RICE, SALMON])));
    const box = await open(world);
    const log = await box.findByRole("button", { name: "Log Rice + Dal" });
    const press = log.props.onClick as (event: object) => void;
    await act(async () => {
      press({});
      press({});
      await Promise.resolve();
    });
    await waitFor(() => { expect(world.meals).toHaveLength(1); });
    await act(async () => { await new Promise((done) => setTimeout(done, 200)); });
    const sent = posts(world, "/v1/nutrition/meals");
    expect(new Set(sent.map((a) => (a.body as SentMeal).id)).size).toBe(1);
    const body = sent[0]?.body as SentMeal;
    expect(body.mealType).toBe("lunch");
    expect(body.items).toEqual([{ canonical: "rice_white", grams: 212 }, { canonical: "dal", grams: 150 }]);
  });

  it("a meal logged is offered no more, and the next meal takes its place", async () => {
    const world = serverOf(() => ok(week([RICE, SALMON])));
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Log Rice + Dal" }));
    expect(await box.findByRole("button", { name: "Log Salmon" })).toBeTruthy();
    expect(box.queryByRole("button", { name: "Log Rice + Dal" })).toBeNull();
    expect(box.getByText("Logged to Lunch.")).toBeTruthy();
  });

  it("a meal already logged before the page opened is not offered again, and nothing can be logged until today's list is read", async () => {
    const world = serverOf(() => ok(week([RICE, SALMON])));
    const store = files();
    const box = await open(world, store);
    await fireEvent.press(await box.findByRole("button", { name: "Log Rice + Dal" }));
    await waitFor(() => { expect(world.meals).toHaveLength(1); });
    await screen.unmount();
    const again = await open(world, store);
    expect(await again.findByRole("button", { name: "Log Salmon" })).toBeTruthy();
    expect(again.queryByRole("button", { name: "Log Rice + Dal" })).toBeNull();
  });

  it("with no signal the meal is kept, reads as logged, and is not offered a second time", async () => {
    const world = serverOf(() => ok(week([RICE, SALMON])), {}, () => Promise.reject(new Error("no signal")));
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Log Rice + Dal" }));
    expect(await box.findByRole("button", { name: "Log Salmon" })).toBeTruthy();
    expect(box.queryByRole("button", { name: "Log Rice + Dal" })).toBeNull();
  });

  it("a meal the server refused can be logged again", async () => {
    const world = serverOf(() => ok(week([RICE])), {}, () => ({ status: 400, body: { error: "validation_failed", message: "Check this meal." } }));
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Log Rice + Dal" }));
    expect(await screen.findByText(/wasn’t saved/)).toBeTruthy();
    expect(await box.findByRole("button", { name: "Log Rice + Dal" })).toBeTruthy();
  });

  it("a meal outside the diet names the food, beside Swap, in the box and in the week", async () => {
    const world = serverOf(() => ok(week([{ ...SALMON, outsideDiet: ["Salmon"] }])));
    const box = await open(world);
    expect(await box.findByText("Not in your diet: Salmon.")).toBeTruthy();
    expect(box.getByRole("button", { name: "Swap Salmon" })).toBeTruthy();
    await fireEvent.press(box.getByRole("button", { name: "See the week" }));
    const sheet = within(await screen.findByTestId("sheet"));
    expect(sheet.getByText("Not in your diet: Salmon.")).toBeTruthy();
  });

  it("the allergy line is beside every planned meal shown, and a vegetarian's label line", async () => {
    const world = serverOf(() => ok(week([RICE], { labelCaution: DIET_LABEL_CAUTION })));
    const box = await open(world);
    expect(await box.findByText(FOOD_ALLERGY_CAUTION)).toBeTruthy();
    expect(box.getByText(DIET_LABEL_CAUTION)).toBeTruthy();
  });
});

describe("until today's meals are read (round one, H1)", () => {
  it.each(["Food", "Dashboard"] as const)("on %s no meal is named and nothing can be logged or swapped while they load", async (tab) => {
    const never = () => new Promise<Reply>(() => undefined);
    const world = serverOf(() => ok(week([RICE, SALMON])), { "/v1/nutrition/meals": (body) => (body === undefined ? never() : ok({})) });
    const box = await open(world, files(), tab);
    await act(async () => { await new Promise((done) => setTimeout(done, 300)); });
    expect(box.getAllByText("–").length).toBeGreaterThan(0);
    expect(box.queryByText(/Lunch · 640 kcal/)).toBeNull();
    expect(box.queryByRole("button", { name: /^Log Rice/ })).toBeNull();
    expect(box.queryByRole("button", { name: /^Swap Rice/ })).toBeNull();
  });

  it.each(["Food", "Dashboard"] as const)("on %s a failed read says so, with Try again, and names no meal", async (tab) => {
    const world = serverOf(() => ok(week([RICE, SALMON])), { "/v1/nutrition/meals": () => ({ status: 500, body: { error: "server_error", message: "No." } }) });
    const box = await open(world, files(), tab);
    expect((await box.findAllByText("Your meals couldn’t load.")).length).toBeGreaterThan(0);
    expect(box.queryByText(/Lunch · 640 kcal/)).toBeNull();
  });

  it("on the Dashboard a plan that can't load says so, never the ideas as if there were none", async () => {
    const world = serverOf(() => ({ status: 500, body: { error: "server_error", message: "No." } }));
    const box = await open(world, files(), "Dashboard");
    const card = within(await box.findByTestId("recommended-box"));
    expect(await card.findByText("Your meal plan couldn’t load.")).toBeTruthy();
  });
});

describe("swapping", () => {
  const SWAP = `/v1/nutrition/diet-plan/days/${String(TODAY)}/swap`;

  it("shows the server's new meal at once, by the meal's place in the day", async () => {
    const world = serverOf(() => ok(week([OATS, RICE])), { [SWAP]: () => ok(week([TOFU, RICE])) });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Swap Oatmeal" }));
    expect(await box.findByText(/Tofu/)).toBeTruthy();
    expect(box.getByText("Meal swapped.")).toBeTruthy();
    expect((posts(world, SWAP)[0]?.body as { meal: number }).meal).toBe(0);
  });

  it("trying again after a lost answer sends the same change, so it is made once", async () => {
    let lost = true;
    const world = serverOf(() => ok(week([RICE])), {
      [SWAP]: () => {
        if (lost) {
          lost = false;
          return Promise.reject(new Error("no signal"));
        }
        return ok(week([TOFU]));
      },
    });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Swap Rice + Dal" }));
    expect(await box.findByText("No connection. Try again.")).toBeTruthy();
    await fireEvent.press(box.getByRole("button", { name: "Swap Rice + Dal" }));
    expect(await box.findByText(/Tofu/)).toBeTruthy();
    const ids = posts(world, SWAP).map((a) => (a.body as { changeId: string }).changeId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("sends the foods it showed, and a plan changed elsewhere is read again with the server's words", async () => {
    let plan = week([RICE]);
    const world = serverOf(() => ok(plan), {
      [SWAP]: () => {
        plan = week([TOFU]);
        return { status: 409, body: { error: "plan_changed", message: "Your plan has changed. Open it again to swap this meal." } };
      },
    });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Swap Rice + Dal" }));
    expect(await box.findByText("Your plan has changed. Open it again to swap this meal.")).toBeTruthy();
    expect((posts(world, SWAP)[0]?.body as { shown: string[] }).shown).toEqual(["rice_white", "dal"]);
    expect(await box.findByRole("button", { name: "Log Tofu" })).toBeTruthy();
  });

  it("a refusal that isn't about the connection says the server's words (round one, L1)", async () => {
    const world = serverOf(() => ok(week([RICE])), { [SWAP]: () => ({ status: 404, body: { error: "not_found", message: "Meal not found." } }) });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Swap Rice + Dal" }));
    expect(await box.findByText("Meal not found.")).toBeTruthy();
    expect(box.queryByText("No connection. Try again.")).toBeNull();
  });

  it("says the server's reason when no other meal fits", async () => {
    const world = serverOf(() => ok(week([RICE])), {
      [SWAP]: () => ({ status: 409, body: { error: "no_other_meal", message: "No other meal of this size fits your diet." } }),
    });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Swap Rice + Dal" }));
    expect(await box.findByText("No other meal of this size fits your diet.")).toBeTruthy();
    expect(box.getByText(/Rice/)).toBeTruthy();
  });
});

describe("one box, one answer", () => {
  it("with a plan the Food page has no second box of ideas; Other ideas opens them", async () => {
    const world = serverOf(() => ok(week([RICE])));
    const box = await open(world);
    expect(await box.findByRole("button", { name: "Log Rice + Dal" })).toBeTruthy();
    expect(box.queryByTestId("meal-ideas-box")).toBeNull();
    expect(box.getAllByText("What to eat next")).toHaveLength(1);
    await fireEvent.press(box.getByRole("button", { name: "Other ideas" }));
    expect(await screen.findByText("No more meals to suggest today.")).toBeTruthy();
  });

  it("without a plan the ideas' box is the one box, with Make my plan under it", async () => {
    const world = serverOf(() => ok(week([])));
    const box = await open(world);
    expect(await box.findByRole("button", { name: "Make my plan" })).toBeTruthy();
    expect(box.queryByTestId("meal-plan-box")).toBeNull();
    expect(box.getAllByText("What to eat next")).toHaveLength(1);
  });

  it("the Dashboard offers the plan's next meal, logs it once, and then the same next meal as Food", async () => {
    const world = serverOf(() => ok(week([RICE, SALMON])));
    const box = await open(world, files(), "Dashboard");
    const card = within(await box.findByTestId("recommended-box"));
    const log = await card.findByRole("button", { name: "Log Rice + Dal", disabled: false });
    expect(card.getByText(FOOD_ALLERGY_CAUTION)).toBeTruthy();
    // Two presses in one go: one meal.
    const press = log.props.onClick as (event: object) => void;
    await act(async () => {
      press({});
      press({});
      await Promise.resolve();
    });
    await waitFor(() => { expect(world.meals).toHaveLength(1); });
    expect(await card.findByRole("button", { name: "Log Salmon" })).toBeTruthy();
    expect(((posts(world, "/v1/nutrition/meals")[0]?.body) as SentMeal).mealType).toBe("lunch");
    await fireEvent.press(screen.getByRole("tab", { name: "Food" }));
    const food = within(await screen.findByTestId("meal-plan-box"));
    expect(await food.findByRole("button", { name: "Log Salmon" })).toBeTruthy();
    expect(food.queryByRole("button", { name: "Log Rice + Dal" })).toBeNull();
    await act(async () => { await new Promise((done) => setTimeout(done, 200)); });
    expect(world.meals).toHaveLength(1);
  });

  it("the Dashboard's See meal plan opens the week itself (round one, L4)", async () => {
    const world = serverOf(() => ok(week([RICE])));
    const box = await open(world, files(), "Dashboard");
    await fireEvent.press(await within(await box.findByTestId("recommended-box")).findByRole("button", { name: "See meal plan" }));
    expect(await screen.findByText(/^Today · /)).toBeTruthy();
    // Closed, then back to today from another day: it stays closed (re-check, N1).
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await fireEvent.press(screen.getByRole("button", { name: "Previous day" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Next day" }));
    await act(async () => { await new Promise((done) => setTimeout(done, 100)); });
    expect(screen.queryByText(/^Today · /)).toBeNull();
  });

  it("a second swap with no answer takes away the first swap's Undo (re-check, N2)", async () => {
    let first = true;
    const SWAP = `/v1/nutrition/diet-plan/days/${String(TODAY)}/swap`;
    const world = serverOf(() => ok(week([OATS, RICE])), {
      [SWAP]: () => {
        if (first) {
          first = false;
          return ok(week([TOFU, RICE]));
        }
        return Promise.reject(new Error("no signal"));
      },
    });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Swap Oatmeal" }));
    expect(await box.findByRole("button", { name: "Undo the swap" })).toBeTruthy();
    await fireEvent.press(box.getByRole("button", { name: "Swap Tofu" }));
    expect(await box.findByText("No connection. Try again.")).toBeTruthy();
    expect(box.queryByText("Meal swapped.")).toBeNull();
    expect(box.queryByRole("button", { name: "Undo the swap" })).toBeNull();
  });
});

describe("Undo of a swap", () => {
  const SWAP = `/v1/nutrition/diet-plan/days/${String(TODAY)}/swap`;
  const DAY = `/v1/nutrition/diet-plan/days/${String(TODAY)}`;

  it("sends the day back whole as it stood, shows it, and is gone once used", async () => {
    const world = serverOf(() => ok(week([OATS, RICE])), { [SWAP]: () => ok(week([OATS, TOFU])), [DAY]: () => ok(week([OATS, RICE])) });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Swap Oatmeal" }));
    expect(await box.findByRole("button", { name: "Undo the swap" })).toBeTruthy();
    await fireEvent.press(box.getByRole("button", { name: "Undo the swap" }));
    expect(await box.findByText("Meal put back.")).toBeTruthy();
    expect(box.queryByRole("button", { name: "Undo the swap" })).toBeNull();
    const sent = world.s.asked.find((a) => a.method === "PUT" && a.path === DAY)?.body as { meals: unknown };
    expect(sent.meals).toEqual([
      { mealType: "breakfast", items: [{ canonical: "oats", grams: 250 }] },
      { mealType: "lunch", items: [{ canonical: "rice_white", grams: 212 }, { canonical: "dal", grams: 150 }] },
    ]);
  });

  it("Undo tried again after a lost answer sends the same change, with the day it showed", async () => {
    let lost = true;
    const world = serverOf(() => ok(week([OATS, RICE])), {
      [SWAP]: () => ok(week([OATS, TOFU])),
      [DAY]: () => {
        if (lost) {
          lost = false;
          return Promise.reject(new Error("no signal"));
        }
        return ok(week([OATS, RICE]));
      },
    });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Swap Oatmeal" }));
    await fireEvent.press(await box.findByRole("button", { name: "Undo the swap" }));
    expect(await box.findByText("No connection. Try again.")).toBeTruthy();
    // Undo is still offered, and tried again it is the same change.
    await fireEvent.press(box.getByRole("button", { name: "Undo the swap" }));
    expect(await box.findByText("Meal put back.")).toBeTruthy();
    const puts = world.s.asked.filter((a) => a.method === "PUT" && a.path === DAY).map((a) => a.body as { changeId: string; shown: string[][] });
    expect(puts).toHaveLength(2);
    expect(puts[0]?.shown).toEqual([["oats"], ["tofu"]]);
    expect(puts[1]?.changeId).toBe(puts[0]?.changeId);
  });

  it("a meal logged after the swap takes Undo away, so a logged meal's plan isn't changed under it", async () => {
    const world = serverOf(() => ok(week([RICE, SALMON])), { [SWAP]: () => ok(week([TOFU, SALMON])) });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Swap Rice + Dal" }));
    await fireEvent.press(await box.findByRole("button", { name: "Log Tofu" }));
    expect(await box.findByText("Logged to Lunch.")).toBeTruthy();
    expect(box.queryByRole("button", { name: "Undo the swap" })).toBeNull();
  });
});

describe("making the plan", () => {
  const MAKE = "/v1/nutrition/diet-plan/make";

  it("trying again after a lost answer sends the same change, so the week is made once", async () => {
    let lost = true;
    const world = serverOf(() => ok(week([])), {
      [MAKE]: () => {
        if (lost) {
          lost = false;
          return Promise.reject(new Error("no signal"));
        }
        return ok(week([OATS]));
      },
    });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Make my plan" }));
    expect(await box.findByText("No connection. Try again.")).toBeTruthy();
    await fireEvent.press(box.getByRole("button", { name: "Make my plan" }));
    expect(await box.findByRole("button", { name: "Log Oatmeal" })).toBeTruthy();
    const ids = posts(world, MAKE).map((a) => (a.body as { changeId: string }).changeId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("no plan: Make my plan makes the week, and today's first meal shows", async () => {
    const world = serverOf(() => ok(week([])), { [MAKE]: () => ok(week([OATS, RICE])) });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Make my plan" }));
    expect(await box.findByRole("button", { name: "Log Oatmeal" })).toBeTruthy();
    expect(box.getByText("Your week is ready.")).toBeTruthy();
  });

  it("a plan already there is replaced only after the box asks, and Keep my plan sends nothing", async () => {
    const world = serverOf(() => ok(week([RICE])), { [MAKE]: () => ok(week([TOFU])) });
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "See the week" }));
    const sheet = within(await screen.findByTestId("sheet"));
    // At the top of the week, above the day's meals: never under them.
    const order = JSON.stringify(screen.toJSON());
    expect(order.indexOf("Make a new plan")).toBeLessThan(order.indexOf("kcal planned"));
    await fireEvent.press(sheet.getByRole("button", { name: "Make a new plan" }));
    expect(sheet.getByText("This replaces your whole week, and any meals you swapped.")).toBeTruthy();
    await fireEvent.press(sheet.getByRole("button", { name: "Keep my plan" }));
    expect(posts(world, MAKE)).toHaveLength(0);
    await fireEvent.press(sheet.getByRole("button", { name: "Make a new plan" }));
    await fireEvent.press(sheet.getByRole("button", { name: "Make new plan" }));
    expect(await sheet.findByText(/Tofu/)).toBeTruthy();
    expect(posts(world, MAKE)).toHaveLength(1);
  });

  it("answers missing: no Make my plan; the ideas' own question is the one question asked", async () => {
    const world = serverOf(() => ok(week([], { make: { status: "needs_answers", missing: ["diet"] } })));
    const box = await open(world);
    expect(await box.findByTestId("meal-ideas-box")).toBeTruthy();
    await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
    expect(box.queryByRole("button", { name: "Make my plan" })).toBeNull();
  });
});

describe("the week", () => {
  it("another day reads its meals with Swap and no Log; today's logged meal says so", async () => {
    const world = serverOf(() => ok(week([RICE], {}, [SALMON])));
    const box = await open(world);
    await fireEvent.press(await box.findByRole("button", { name: "Log Rice + Dal" }));
    await waitFor(() => { expect(box.getByText("All of today’s meals are logged.")).toBeTruthy(); });
    await fireEvent.press(box.getByRole("button", { name: "See the week" }));
    const sheet = within(await screen.findByTestId("sheet"));
    expect(sheet.getByText("Logged")).toBeTruthy();
    expect(sheet.getByText(FOOD_ALLERGY_CAUTION)).toBeTruthy();
    expect(sheet.queryByRole("button", { name: "Swap Rice + Dal" })).toBeNull();
    expect(sheet.getByText("640 kcal planned · target 2,300 kcal")).toBeTruthy();
    await fireEvent.press(sheet.getByRole("button", { name: "Next day" }));
    expect(sheet.getByRole("button", { name: "Swap Salmon" })).toBeTruthy();
    expect(sheet.queryByRole("button", { name: "Log Salmon" })).toBeNull();
  });

  it("the plan that cannot load says so, with Try again", async () => {
    const world = serverOf(() => ({ status: 500, body: { error: "server_error", message: "No." } }));
    const box = await open(world);
    expect(await box.findByText("Your meal plan couldn’t load.")).toBeTruthy();
    expect(box.getByRole("button", { name: "Try your meal plan again" })).toBeTruthy();
  });
});
