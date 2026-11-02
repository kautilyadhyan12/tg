import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { DIET_LABEL_CAUTION, FOOD_ALLERGY_CAUTION, type MealIdeasResponse } from "@app/shared";
import { App } from "../../src/App";
import type { TextStore } from "../../src/screens/food/outbox";
import { fakeServer, kept, lost, memoryStore, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const PLAN = { kcal: 2300, bmr: 1600, tdee: 2300, proteinG: 120, carbsG: 280, fatG: 75, noCalorieCut: false };
const TARGETS = { targets: PLAN, missing: [], targetWrongSide: false, source: "app", appTargets: PLAN, own: null, ownHeld: null };

const food = (canonical: string, name: string, grams: number, kcal: number, servings = 1, unit = "cup") => ({
  canonical, name, grams, servings, unit, kcal, proteinG: 20, carbsG: 30, fatG: 5,
});
const idea = (...items: ReturnType<typeof food>[]) => ({
  kind: "plate" as const,
  items,
  totals: { kcal: items.reduce((n, f) => n + f.kcal, 0), proteinG: 20 * items.length, carbsG: 30 * items.length, fatG: 5 * items.length },
});
const RICE_PLATE = idea(food("chicken_breast", "Chicken breast", 150, 248, 1.5, "g"), food("rice_white", "Rice", 200, 260));
const DAL_BOWL = idea(food("dal", "Dal", 240, 300));
const OAT_BOWL = idea(food("oats", "Oatmeal", 250, 200));
const FISH_PLATE = idea(food("salmon", "Salmon", 150, 310, 1.5, "g"));

const answer = (over: Partial<Extract<MealIdeasResponse, { status: "ok" }>> = {}): MealIdeasResponse => ({
  status: "ok",
  day: "2026-11-02",
  kcalLeft: 1500,
  meals: [
    { kcalTarget: 508, ideas: [RICE_PLATE, DAL_BOWL, OAT_BOWL] },
    { kcalTarget: 500, ideas: [FISH_PLATE] },
  ],
  caution: FOOD_ALLERGY_CAUTION,
  labelCaution: null,
  ...over,
});
const AFTER_LOG = answer({ kcalLeft: 992, meals: [{ kcalTarget: 500, ideas: [FISH_PLATE] }] });

function files() {
  const held = new Map<string, string>();
  return (userId: string): TextStore => ({
    read: () => Promise.resolve(held.get(userId) ?? null),
    write: (text) => {
      held.set(userId, text);
      return Promise.resolve();
    },
  });
}

interface SavedBody { id: string; mealName: string; takenAt: string; mealType: string }
const savedMeal = (body: SavedBody) => ({
  id: body.id,
  takenAt: body.takenAt,
  mealType: body.mealType,
  mealName: body.mealName,
  items: [],
  totals: { kcalPoint: 508, kcalLow: 508, kcalHigh: 508, proteinG: 40, carbsG: 60, fatG: 10 },
  confirmed: true,
  origin: "manual",
  portionSource: "default",
  nutritionSources: ["usda"],
  calcVersion: 1,
  itemsVersion: "v1",
});

interface World {
  ideas: () => Reply | Promise<Reply>;
  save?: () => Reply;
  meals: ReturnType<typeof savedMeal>[];
}

function server(world: World, more: Record<string, Route> = {}) {
  return fakeServer({
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    "/v1/nutrition/targets": () => ({ status: 200, body: TARGETS }),
    "/v1/nutrition/suggestions": () => world.ideas(),
    "/v1/workouts": () => ({ status: 200, body: { items: [], nextCursor: null, limitedToDays: 90, hasAnyWorkouts: false } }),
    "/v1/geo/runs": () => ({ status: 200, body: { items: [], nextCursor: null } }),
    "/v1/nutrition/meals": (body) => {
      if (body === undefined) return { status: 200, body: { items: world.meals, nextCursor: null } };
      const refused = world.save?.();
      if (refused !== undefined) return refused;
      const meal = savedMeal(body as SavedBody);
      if (!world.meals.some((m) => m.id === meal.id)) world.meals.push(meal);
      return { status: 201, body: { meal } };
    },
    ...more,
  });
}

const posts = (s: ReturnType<typeof server>) => s.asked.filter((a) => a.method === "POST" && a.path === "/v1/nutrition/meals");

async function open(world: World, tab: "Food" | "Dashboard", store = files()) {
  const s = server(world);
  await render(<App extra={extra} ask={s.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={store} />);
  await fireEvent.press(await screen.findByRole("tab", { name: tab }));
  return s;
}

const logRice = () => screen.findByRole("button", { name: "Log Chicken breast + Rice" });

describe("the worst thing: one tap saves one meal, at the calories it showed", () => {
  it("two quick taps save one meal, by the idea's own foods and grams", async () => {
    const world: World = { ideas: () => ({ status: 200, body: answer() }), meals: [] };
    // The phone's file answers late, so the second tap comes while the first is still being kept.
    let held = true;
    let release: () => void = () => undefined;
    const plain = files();
    const slow = (userId: string): TextStore => ({
      read: plain(userId).read,
      write: (text) =>
        held
          ? new Promise((done) => {
              release = () => {
                held = false;
                void plain(userId).write(text).then(done);
              };
            })
          : plain(userId).write(text),
    });
    const s = await open(world, "Food", slow);
    const log = await logRice();
    // Both presses in one go, with no drawing between: the row is still there for the second.
    const press = log.props.onClick as (event: object) => void;
    expect(typeof press).toBe("function");
    await act(async () => {
      press({});
      press({});
      await Promise.resolve();
    });
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(world.meals).toHaveLength(1);
    });
    // Long enough for a second save to reach the server, had the second tap made one.
    await act(async () => {
      await new Promise((done) => setTimeout(done, 200));
    });
    expect(world.meals).toHaveLength(1);
    expect(posts(s)).toHaveLength(1);
    expect(posts(s)[0]?.body).toMatchObject({ mealName: "Chicken breast + Rice", items: [{ canonical: "chicken_breast", grams: 150 }, { canonical: "rice_white", grams: 200 }] });
  });

  it("with no signal the ideas are gone until the server has the meal, so the same one can't be logged twice", async () => {
    const store = files();
    const world: World = { ideas: () => ({ status: 200, body: answer() }), save: lost, meals: [] };
    await open(world, "Food", store);
    await fireEvent.press(await logRice());
    expect(await screen.findByText("Waiting to send your meal.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Log / })).toBeNull();
    // The rings count it while it waits, at the idea's own calories.
    expect(await screen.findByLabelText("Calories, 508 of 2,300 kcal")).toBeTruthy();
    await screen.unmount();

    // The phone opened again with the signal back: the one meal is saved, and the ideas count it.
    const back: World = { ideas: () => ({ status: 200, body: AFTER_LOG }), meals: [] };
    const again = await open(back, "Food", store);
    await waitFor(() => {
      expect(back.meals).toHaveLength(1);
    });
    expect(posts(again)).toHaveLength(1);
    expect(await screen.findByRole("button", { name: "Log Salmon" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log Chicken breast + Rice" })).toBeNull();
  });

  it("a read begun before the meal landed isn't offered: nothing to log until one begun after answers", async () => {
    let free: (reply: Reply) => void = () => undefined;
    let held = false;
    const world: World = {
      ideas: () =>
        held
          ? new Promise<Reply>((done) => {
              free = done;
            })
          : { status: 200, body: answer() },
      meals: [],
    };
    await open(world, "Food");
    const log = await logRice();
    held = true;
    await fireEvent.press(log);
    await waitFor(() => {
      expect(world.meals).toHaveLength(1);
    });
    expect(await screen.findByText("Getting new ideas…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Log / })).toBeNull();
    free({ status: 200, body: AFTER_LOG });
    expect(await screen.findByRole("button", { name: "Log Salmon" })).toBeTruthy();
    expect(screen.getByText(/^Logged to /)).toBeTruthy();
  });

  it.each(["Dashboard", "Food"] as const)("a meal the server refuses never reads as logged on %s, after OK too", async (tab) => {
    const world: World = {
      ideas: () => ({ status: 200, body: answer() }),
      save: () => ({ status: 422, body: { error: "bad", message: "That food is no longer on the list.", requestId: "r" } }),
      meals: [],
    };
    await open(world, tab);
    await fireEvent.press(await logRice());
    expect(await screen.findByText(/Chicken breast \+ Rice wasn’t saved\. That food is no longer on the list\./)).toBeTruthy();
    expect(world.meals).toHaveLength(0);
    expect(screen.queryByText(/^Logged to /)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => {
      expect(screen.queryByText(/wasn’t saved/)).toBeNull();
    });
    expect(screen.queryByText(/^Logged to /)).toBeNull();
  });

  it("a meal the phone couldn't write to its file says to keep the app open", async () => {
    const failing = (): TextStore => ({ read: () => Promise.resolve(null), write: () => Promise.reject(new Error("disk full")) });
    await open({ ideas: () => ({ status: 200, body: answer() }), save: lost, meals: [] }, "Dashboard", failing);
    await fireEvent.press(await logRice());
    expect(await screen.findByText("Waiting to send. It couldn’t be saved on this phone yet, so keep the app open.")).toBeTruthy();
  });
});

describe("the Food screen's box", () => {
  it("shows the next meal's ideas with amounts and numbers, and the later meals behind a button", async () => {
    await open({ ideas: () => ({ status: 200, body: answer() }), meals: [] }, "Food");
    const box = within(await screen.findByTestId("meal-ideas-box"));
    expect(await box.findByText("Rice 1 cup · 200 g")).toBeTruthy();
    expect(box.getByText("Chicken breast 150 g")).toBeTruthy();
    expect(box.getByText(/^508 kcal · 40 g protein/)).toBeTruthy();
    expect(box.queryByRole("button", { name: "Log Salmon" })).toBeNull();
    expect(screen.getAllByText(FOOD_ALLERGY_CAUTION)).toHaveLength(1);
    await fireEvent.press(box.getByRole("button", { name: "1 more meal today" }));
    expect(await screen.findByRole("button", { name: "Log Salmon" })).toBeTruthy();
    expect(screen.getByText(/^1 meal later · about 500 kcal/)).toBeTruthy();
    // The box that opens carries the line too.
    expect(screen.getAllByText(FOOD_ALLERGY_CAUTION)).toHaveLength(2);
  });

  it("always carries the allergy line, and the label line only for a vegetarian or vegan", async () => {
    await open({ ideas: () => ({ status: 200, body: answer() }), meals: [] }, "Food");
    expect(await screen.findByText(FOOD_ALLERGY_CAUTION)).toBeTruthy();
    expect(screen.queryByText(DIET_LABEL_CAUTION)).toBeNull();
    await screen.unmount();
    await open({ ideas: () => ({ status: 200, body: answer({ labelCaution: DIET_LABEL_CAUTION }) }), meals: [] }, "Food");
    expect(await screen.findByText(DIET_LABEL_CAUTION)).toBeTruthy();
  });

  it("isn't there on another day: an idea is for today", async () => {
    await open({ ideas: () => ({ status: 200, body: answer() }), meals: [] }, "Food");
    await screen.findByTestId("meal-ideas-box");
    await fireEvent.press(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.queryByTestId("meal-ideas-box")).toBeNull();
  });
});

describe("why the box has no ideas", () => {
  it("names the food questions still to answer, with a button", async () => {
    await open({ ideas: () => ({ status: 200, body: { status: "needs_answers", missing: ["diet", "mealsPerDay"] } }), meals: [] }, "Food");
    expect(await screen.findByText(/To see meal ideas, answer your diet and how many meals a day\./)).toBeTruthy();
    await fireEvent.press(within(screen.getByTestId("meal-ideas-box")).getByRole("button", { name: "Answer now" }));
    expect(await screen.findByTestId("setup")).toBeTruthy();
  });

  it("no calorie number: said on the Dashboard; on the Food screen the rings already ask", async () => {
    await open({ ideas: () => ({ status: 200, body: { status: "needs_plan" } }), meals: [] }, "Dashboard");
    expect(await screen.findByText("Finish setting up to see meal ideas.")).toBeTruthy();
    await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
    await waitFor(() => {
      expect(screen.queryByTestId("meal-ideas-box")).toBeNull();
    });
    await fireEvent.press(await screen.findByRole("tab", { name: "Dashboard" }));
    await fireEvent.press(within(screen.getByTestId("recommended-box")).getByRole("button", { name: "Answer now" }));
    expect(await screen.findByTestId("setup")).toBeTruthy();
  });

  it("today's calories eaten: says so, with no made-up idea", async () => {
    await open({ ideas: () => ({ status: 200, body: answer({ kcalLeft: 0, meals: [] }) }), meals: [] }, "Food");
    expect(await screen.findByText("No more meals to suggest today.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Log / })).toBeNull();
  });

  it("a read that fails offers Try again, and that brings the ideas", async () => {
    let fail = true;
    await open({ ideas: () => (fail ? lost() : { status: 200, body: answer() }), meals: [] }, "Food");
    const again = await screen.findByRole("button", { name: "Try meal ideas again" });
    fail = false;
    await fireEvent.press(again);
    expect(await logRice()).toBeTruthy();
  });
});

describe("the Dashboard's Recommended box", () => {
  it("holds the Food option, the next meal's first idea, the allergy line, and logs it", async () => {
    const world: World = { ideas: () => ({ status: 200, body: answer({ labelCaution: DIET_LABEL_CAUTION }) }), meals: [] };
    await open(world, "Dashboard");
    const box = within(await screen.findByTestId("recommended-box"));
    expect(box.getByText("Recommended For You")).toBeTruthy();
    expect(box.getByRole("radio", { name: "Food" })).toBeTruthy();
    expect(await box.findByText(/^Rice/)).toBeTruthy();
    expect(box.getByText("1 cup · 200 g")).toBeTruthy();
    expect(box.getByText("508 kcal")).toBeTruthy();
    expect(box.getByText("40 g protein · 60 g carbs")).toBeTruthy();
    expect(box.queryByText(/^Dal/)).toBeNull();
    expect(box.getByText(FOOD_ALLERGY_CAUTION)).toBeTruthy();
    expect(box.getByText(DIET_LABEL_CAUTION)).toBeTruthy();
    expect(box.queryByRole("radio", { name: "Exercise" })).toBeNull();
    expect(box.queryByRole("radio", { name: "Running" })).toBeNull();
    world.ideas = () => ({ status: 200, body: AFTER_LOG });
    await fireEvent.press(box.getByRole("button", { name: "Log Chicken breast + Rice" }));
    expect(await box.findByText(/^Logged to /)).toBeTruthy();
    await waitFor(() => {
      expect(world.meals).toHaveLength(1);
    });
    expect(await box.findByRole("button", { name: "Log Salmon" })).toBeTruthy();
    // And it shows in Recent Activity, read again once the server has it.
    expect(await within(screen.getByTestId("recent-activity")).findByText("Chicken breast + Rice")).toBeTruthy();
  });

  it("More ideas opens the Food tab on today, from any day it was left on", async () => {
    await open({ ideas: () => ({ status: 200, body: answer() }), meals: [] }, "Food");
    await screen.findByTestId("meal-ideas-box");
    await fireEvent.press(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.queryByTestId("meal-ideas-box")).toBeNull();
    await fireEvent.press(screen.getByRole("tab", { name: "Dashboard" }));
    await fireEvent.press(await screen.findByRole("button", { name: "More ideas" }));
    expect(await screen.findByTestId("meal-ideas-box")).toBeTruthy();
  });
});
