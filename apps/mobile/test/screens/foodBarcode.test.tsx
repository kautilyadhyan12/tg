import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { NutritionTargetsResponse } from "@app/shared";
import { App } from "../../src/App";
import { mealTypeName, sectionOf } from "../../src/screens/food/day";
import type { TextStore } from "../../src/screens/food/outbox";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

// Scanning a barcode on the phone (ROADMAP Stage 5 33b-iii-b): the camera, the product box and what it
// says about allergens, the whole pack, and every code that has no product.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { camera } = require("expo-camera") as { camera: { permission: object; afterAsk: object } };

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });
const PLAN = { kcal: 2300, bmr: 1600, tdee: 2300, proteinG: 120, carbsG: 280, fatG: 75, noCalorieCut: false };
const TARGETS: NutritionTargetsResponse = { targets: PLAN, missing: [], targetWrongSide: false, source: "app", appTargets: PLAN, own: null, ownHeld: null };

const NUTELLA_CODE = "3017620422003";
const food = (over: object = {}) => ({
  canonical: `pack_${NUTELLA_CODE}`,
  name: "Nutella",
  kcal: 539,
  proteinG: 6.3,
  carbsG: 57.5,
  fatG: 30.9,
  fiberG: null,
  serving: 15,
  unit: "g",
  source: "openfoodfacts",
  measures: [
    { id: "serving", name: "serving", grams: 15 },
    { id: "pack", name: "whole pack", grams: 400 },
    { id: "g", name: "g", grams: 1 },
    { id: "oz", name: "oz", grams: 28.35 },
  ],
  startsAt: { measure: "serving", amount: 1 },
  startsKcal: 81,
  ...over,
});
const found = (over: object = {}, foodOver: object = {}) => ({
  status: "found",
  code: NUTELLA_CODE,
  food: food(foodOver),
  allergens: ["milk", "nuts", "soybeans"],
  mayContain: [],
  listedAsTyped: [],
  allergensFrom: "openfoodfacts",
  check: "fine",
  ...over,
});

const GRAMS: Record<string, number> = { serving: 15, pack: 400, g: 1, oz: 28.35 };
function server(replies: Record<string, () => Reply>, save: () => Reply = lost) {
  return fakeServer({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/nutrition/targets": ok(TARGETS),
    "/v1/nutrition/foods/recent": ok({ items: [] }),
    "/v1/nutrition/dishware": ok({ items: [], nextCursor: null }),
    "/v1/nutrition/meals/preview": (body) => {
      const items = (body as { items: { canonical: string; measure: string; amount: number }[] }).items.map((i) => {
        const grams = (GRAMS[i.measure] ?? 1) * i.amount;
        const kcal = Math.round((grams * 539) / 100);
        return {
          name: "Nutella", canonical: i.canonical, gramsPoint: grams, gramsRange: [grams, grams], portionSource: "default", nutritionSource: "openfoodfacts",
          kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 6, carbsG: 58, fatG: 31,
          measure: { id: i.measure, name: i.measure === "pack" ? "whole pack" : i.measure, amount: i.amount },
        };
      });
      const kcal = items.reduce((n, i) => n + i.kcalPoint, 0);
      return { status: 200, body: { items, totals: { kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 6, carbsG: 58, fatG: 31 } } };
    },
    "/v1/nutrition/meals": (body) => (body === undefined ? { status: 200, body: { items: [], nextCursor: null } } : save()),
    ...replies,
  });
}

function memoryFiles() {
  const held = new Map<string, string>();
  return (userId: string): TextStore => ({
    read: () => Promise.resolve(held.get(userId) ?? null),
    write: (text) => {
      held.set(userId, text);
      return Promise.resolve();
    },
  });
}

async function openScan(replies: Record<string, () => Reply>) {
  const fake = server(replies);
  await render(<App extra={extra} ask={fake.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={memoryFiles()} photoStore={memoryFiles()} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Scan food" }));
  await fireEvent.press(await screen.findByRole("radio", { name: "Barcode" }));
  return fake;
}

/** What the camera reads, as many times as a pack held still gives it. */
async function read(type: string, data: string, times = 2) {
  for (let n = 0; n < times; n += 1) {
    const lens = screen.getByTestId("camera-view");
    await act(async () => {
      (lens.props as { onBarcodeScanned: (r: { type: string; data: string }) => void }).onBarcodeScanned({ type, data });
      await Promise.resolve();
    });
  }
}
const lookups = (fake: ReturnType<typeof server>) => fake.asked.filter((a) => a.path.startsWith("/v1/nutrition/barcode/"));
const route = (code: string, body: unknown) => ({ [`/v1/nutrition/barcode/${code}`]: ok(body) });

beforeEach(() => {
  camera.permission = { granted: true, canAskAgain: true, status: "granted", expires: "never" };
  camera.afterAsk = camera.permission;
});

describe("the worst thing: an allergic person is never told a pack is clear", () => {
  it("a pack with nothing listed says to check it, and says nothing that reads as safe", async () => {
    await openScan(route(NUTELLA_CODE, found({ allergens: [], mayContain: [], listedAsTyped: [], allergensFrom: null })));
    await read("ean13", NUTELLA_CODE);
    const box = await screen.findByTestId("pack-allergens");
    expect(within(box).getByText("No allergens listed. Check the pack.")).toBeTruthy();
    expect(within(box).queryByText(/Contains/)).toBeNull();
  });

  it("shows what it contains, what it may contain and what somebody typed, each under its own name", async () => {
    await openScan(route(NUTELLA_CODE, found({ mayContain: ["eggs"], listedAsTyped: ["weizenmehl"] })));
    await read("ean13", NUTELLA_CODE);
    expect(await screen.findByText(/Milk, Nuts, Soybeans/)).toBeTruthy();
    expect(screen.getByText(/^May contain: Eggs$/)).toBeTruthy();
    expect(screen.getByText(/^Also listed: weizenmehl$/)).toBeTruthy();
    expect(screen.getByText("If you have any food allergy, take care and check the labels.")).toBeTruthy();
  });

  it("a 0 kcal isn't taken as certain", async () => {
    await openScan(route(NUTELLA_CODE, found({}, { kcal: 0, startsKcal: 0 })));
    await read("ean13", NUTELLA_CODE);
    expect(await screen.findByText("Listed as 0 kcal. Check the pack.")).toBeTruthy();
  });
});

describe("the camera", () => {
  it("the worst thing: a single read is never looked up, and the camera looks only for food codes", async () => {
    const fake = await openScan(route(NUTELLA_CODE, found()));
    const lens = screen.getByTestId("camera-view");
    expect((lens.props as { barcodeScannerSettings: unknown }).barcodeScannerSettings).toEqual({ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] });
    await read("ean13", NUTELLA_CODE, 1);
    expect(lookups(fake)).toHaveLength(0);
    await read("ean13", NUTELLA_CODE, 1);
    await screen.findByText("Nutella");
    expect(lookups(fake)).toHaveLength(1);
  });

  it("a UPC-E is asked for written out", async () => {
    const fake = await openScan(route("049000006582", found()));
    await read("upc_e", "04965802");
    await screen.findByText("Nutella");
    expect(lookups(fake)[0]?.path).toBe("/v1/nutrition/barcode/049000006582");
  });

  it("the torch goes on and off", async () => {
    await openScan({});
    await fireEvent.press(screen.getByRole("button", { name: "Turn torch on" }));
    expect((screen.getByTestId("camera-view").props as { enableTorch: boolean }).enableTorch).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Turn torch off" }));
    expect((screen.getByTestId("camera-view").props as { enableTorch: boolean }).enableTorch).toBe(false);
  });

  it("the torch is on the meal camera too, and stays on across the switch", async () => {
    await openScan({});
    await fireEvent.press(screen.getByRole("radio", { name: "Meal" }));
    await fireEvent.press(screen.getByRole("button", { name: "Turn torch on" }));
    expect((screen.getByTestId("camera-view").props as { enableTorch: boolean }).enableTorch).toBe(true);
    await fireEvent.press(screen.getByRole("radio", { name: "Barcode" }));
    expect((screen.getByTestId("camera-view").props as { enableTorch: boolean }).enableTorch).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Turn torch off" }));
    expect((screen.getByTestId("camera-view").props as { enableTorch: boolean }).enableTorch).toBe(false);
  });

  it("Meal leaves the barcode camera for the shutter, and the barcode reader stops", async () => {
    await openScan({});
    await fireEvent.press(screen.getByRole("radio", { name: "Meal" }));
    expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
    expect((screen.getByTestId("camera-view").props as { onBarcodeScanned?: unknown }).onBarcodeScanned).toBeUndefined();
  });
});

describe("a code with no product says what to do next", () => {
  it("not on the list: search, or the person's own numbers", async () => {
    await openScan(route(NUTELLA_CODE, { status: "not_found", code: NUTELLA_CODE }));
    await read("ean13", NUTELLA_CODE);
    expect(await screen.findByText("This product isn’t on our list.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search food" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Add your own numbers" }));
    expect(await screen.findByText("Your own food")).toBeTruthy();
  });

  it.each([
    [{ status: "store_only" }, "This is the shop’s own code. Search for the food instead."],
    [{ status: "not_a_food" }, "This barcode isn’t a food. Try another one."],
    [{ status: "bad_code" }, "That barcode isn’t right. Scan it again, or check the number."],
  ])("%o", async (reply, words) => {
    await openScan(route(NUTELLA_CODE, reply));
    await read("ean13", NUTELLA_CODE);
    expect(await screen.findByText(words)).toBeTruthy();
  });

  it("no signal: says so, and Try again asks again for the same code", async () => {
    let tries = 0;
    await openScan({
      [`/v1/nutrition/barcode/${NUTELLA_CODE}`]: () => {
        tries += 1;
        return tries === 1 ? lost() : { status: 200, body: found() };
      },
    });
    await read("ean13", NUTELLA_CODE);
    await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nutella")).toBeTruthy();
  });

  it("the server's refusal is said in its own words, with no Try again", async () => {
    await openScan({ [`/v1/nutrition/barcode/${NUTELLA_CODE}`]: () => refusal(429, "rate_limited", "Too many requests. Try again in a minute.") });
    await read("ean13", NUTELLA_CODE);
    expect(await screen.findByText("Too many requests. Try again in a minute.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("type the number", () => {
  it("too few digits are said in the box, and nothing is asked", async () => {
    const fake = await openScan({});
    await fireEvent.press(screen.getByRole("button", { name: "Type the number" }));
    await fireEvent.changeText(await screen.findByLabelText("Barcode number"), "12345");
    await fireEvent.press(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("Enter all the digits under the barcode.")).toBeTruthy();
    expect(lookups(fake)).toHaveLength(0);
  });

  it("a wrong number is said in the box, and a right one opens the product", async () => {
    await openScan({
      ...route("1234567890128", { status: "bad_code" }),
      ...route(NUTELLA_CODE, found()),
    });
    await fireEvent.press(screen.getByRole("button", { name: "Type the number" }));
    const field = await screen.findByLabelText("Barcode number");
    await fireEvent.changeText(field, "1234567890128");
    await fireEvent.press(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("That barcode isn’t right. Scan it again, or check the number.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Barcode number"), NUTELLA_CODE);
    await fireEvent.press(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("Nutella")).toBeTruthy();
  });
});

describe("adding it", () => {
  it("the whole pack is priced by the server, and is what is sent; kept on the phone with no signal", async () => {
    const fake = await openScan(route(NUTELLA_CODE, found()));
    await read("ean13", NUTELLA_CODE);
    await fireEvent.press(await screen.findByRole("radio", { name: /whole pack/ }));
    expect(await screen.findByText(/2,156 kcal/)).toBeTruthy();
    const name = mealTypeName(sectionOf({ mealType: null, takenAt: new Date().toISOString() }));
    const adds = screen.getAllByRole("button", { name: `Add to ${name}` });
    const add = adds[adds.length - 1];
    if (add === undefined) throw new Error("no Add button");
    await fireEvent.press(add);
    expect(await screen.findByText("Nutella added.")).toBeTruthy();
    await waitFor(() => {
      const sent = fake.asked.find((a) => a.method === "POST" && a.path === "/v1/nutrition/meals");
      expect(sent?.body).toMatchObject({ mealName: "Nutella", items: [{ canonical: `pack_${NUTELLA_CODE}`, measure: "pack", amount: 1 }] });
    });
  });
});
