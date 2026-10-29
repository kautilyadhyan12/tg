import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Linking } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { Meal, MealPhotoAnalysis, NutritionTargetsResponse } from "@app/shared";
import { App } from "../../src/App";
import { mealTypeName, sectionOf } from "../../src/screens/food/day";
import type { TextStore } from "../../src/screens/food/outbox";
import { RAVI, fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply, type Route } from "../kit";

// A meal logged from a photo on the phone (ROADMAP Stage 5 33b-i): the live camera, the photo made
// small and rebuilt before it is sent, the scan's foods reviewed and saved once.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { camera } = require("expo-camera") as { camera: { permission: object; afterAsk: object; asked: number; pictures: number; fails: boolean } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { picker } = require("expo-image-picker") as { picker: { next: object; opened: number } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { drawing } = require("expo-image-manipulator") as { drawing: { base64: string; sizes: { width: number; height: number }[]; fails: boolean } };

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

/** A Galaxy A56's photo, with the GPS position it was taken at (apps/api/test/fixtures/photos/README.md). */
const TAGGED = readFileSync(join(__dirname, "..", "..", "..", "api", "test", "fixtures", "photos", "samsung-a56-meta.jpg"));
const latin = (b: Buffer): string => b.toString("latin1");

/** Every block of a JPEG before and between its passes, and what follows its end: read here. */
function blocksOf(b: Buffer): { blocks: { marker: number; body: Buffer }[]; afterEnd: number } {
  const blocks: { marker: number; body: Buffer }[] = [];
  let at = 2;
  for (;;) {
    const marker = b[at + 1] ?? -1;
    if (marker === 0xd9) return { blocks, afterEnd: b.length - (at + 2) };
    const length = ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0);
    if (marker !== 0xda) blocks.push({ marker, body: b.subarray(at + 4, at + 2 + length) });
    at += 2 + length;
    if (marker === 0xda) {
      while (!(b[at] === 0xff && ![0x00, 0xff, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(b[at + 1] ?? 0))) at += 1;
    }
  }
}

const PLAN = { kcal: 2300, bmr: 1600, tdee: 2300, proteinG: 120, carbsG: 280, fatG: 75, noCalorieCut: false };
const TARGETS: NutritionTargetsResponse = { targets: PLAN, missing: [], targetWrongSide: false, source: "app", appTargets: PLAN, own: null, ownHeld: null };

const measures = [
  { id: "g", name: "g", grams: 1 },
  { id: "serving", name: "slice", grams: 30 },
] as const;
/** As the server prices them: toast 80 kcal a slice, eggs 1.5 kcal a gram, milk 0.6. */
const PER_GRAM: Record<string, { name: string; kcal: number; source: string }> = {
  toast: { name: "Toast", kcal: 80 / 30, source: "curated" },
  eggs_scrambled: { name: "Eggs (scrambled)", kcal: 1.5, source: "estimate" },
  milk_whole: { name: "Milk, whole", kcal: 0.6, source: "usda" },
};
type Sent = { canonical: string; measure: string; amount: number };
function priced(item: Sent) {
  const food = PER_GRAM[item.canonical] ?? { name: item.canonical, kcal: 1, source: "usda" };
  const grams = item.measure === "serving" ? item.amount * 30 : item.amount;
  const kcal = Math.round(grams * food.kcal);
  return {
    name: food.name,
    canonical: item.canonical,
    gramsPoint: grams,
    gramsRange: [grams, grams],
    portionSource: "default",
    nutritionSource: food.source,
    kcalPoint: kcal,
    kcalLow: kcal,
    kcalHigh: kcal,
    proteinG: 5,
    carbsG: 10,
    fatG: 2,
    measure: { id: item.measure, name: item.measure === "serving" ? "slice" : "g", amount: item.amount },
  };
}
const sum = (items: ReturnType<typeof priced>[]) => ({
  kcalPoint: items.reduce((n, i) => n + i.kcalPoint, 0),
  kcalLow: items.reduce((n, i) => n + i.kcalLow, 0),
  kcalHigh: items.reduce((n, i) => n + i.kcalHigh, 0),
  proteinG: items.reduce((n, i) => n + i.proteinG, 0),
  carbsG: items.reduce((n, i) => n + i.carbsG, 0),
  fatG: items.reduce((n, i) => n + i.fatG, 0),
});
const scannedItems = [
  { ...priced({ canonical: "toast", measure: "serving", amount: 2 }), measures, startsAt: { measure: "serving", amount: 2 }, portionEstimated: false },
  { ...priced({ canonical: "eggs_scrambled", measure: "g", amount: 120 }), measures, startsAt: { measure: "g", amount: 120 }, portionEstimated: true },
];
const SCAN_TOKEN = "s".repeat(43);
const SCAN = {
  scanToken: SCAN_TOKEN,
  mealName: "Toast and eggs",
  items: scannedItems,
  unknownItems: ["green sauce"],
  photoQuality: "good",
  totals: sum(scannedItems),
  confirmed: false,
} as unknown as MealPhotoAnalysis;
const MILK = {
  canonical: "milk_whole",
  name: "Milk, whole",
  kcal: 60,
  proteinG: 3.2,
  carbsG: 4.8,
  fatG: 3.3,
  fiberG: 0,
  serving: 240,
  unit: "g",
  source: "usda",
  measures,
  startsAt: { measure: "g", amount: 240 },
  startsKcal: 144,
};

/** The scan's own toast, as the search also finds it. */
const TOAST_FOUND = { ...MILK, canonical: "toast", name: "Toast", source: "curated", startsAt: { measure: "serving", amount: 1 }, startsKcal: 80 };

interface Phone {
  meals: Meal[];
  /** The scan's answers, in order; the scan as above once they run out. */
  scans: Route[];
  /** How a meal's save answers; by default as the server does. */
  save?: Route;
}

function savedMeal(body: { id: string; takenAt: string; mealType?: string; items: Sent[] }): Meal {
  const items = body.items.map(priced);
  return {
    id: body.id,
    takenAt: body.takenAt,
    mealType: (body.mealType ?? null) as Meal["mealType"],
    mealName: "Toast and eggs",
    items: items as Meal["items"],
    totals: sum(items),
    confirmed: true,
    origin: "photo",
    portionSource: "default",
    nutritionSources: ["curated"],
    calcVersion: 1,
    itemsVersion: "v1",
  };
}

function photoServer(phone: Phone) {
  return fakeServer({
    "/v1/auth/refresh": ok({ tokens: tokens(2) }),
    "/v1/nutrition/targets": ok(TARGETS),
    "/v1/nutrition/foods": ok({ items: [TOAST_FOUND, MILK] }),
    "/v1/nutrition/foods/recent": ok({ items: [] }),
    "/v1/nutrition/analyze-photo": (body) => (phone.scans.shift() ?? ok(SCAN))(body),
    "/v1/nutrition/meals/preview": (body) => {
      const items = (body as { items: Sent[] }).items.map(priced);
      return { status: 200, body: { items, totals: sum(items) } };
    },
    "/v1/nutrition/meals": (body) => {
      if (body === undefined) return { status: 200, body: { items: phone.meals, nextCursor: null } };
      if (phone.save !== undefined) return phone.save(body);
      const sent = body as { id: string; takenAt: string; mealType?: string; items: Sent[] };
      const known = phone.meals.find((m) => m.id === sent.id);
      if (known !== undefined) return { status: 200, body: { meal: known } };
      const meal = savedMeal(sent);
      phone.meals = [meal, ...phone.meals];
      return { status: 201, body: { meal } };
    },
  });
}

/** The phone's files for each person, kept across a restart of the app. */
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

async function openFood(phone: Phone, files_ = { meals: files(), photos: files() }) {
  const server = photoServer(phone);
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} mealStore={files_.meals.store} photoStore={files_.photos.store} />);
  await fireEvent.press(await screen.findByRole("tab", { name: "Food" }));
  return server;
}

const scansAsked = (server: ReturnType<typeof photoServer>) => server.asked.filter((a) => a.path === "/v1/nutrition/analyze-photo");
const saves = (server: ReturnType<typeof photoServer>) => server.asked.filter((a) => a.method === "POST" && a.path === "/v1/nutrition/meals");

/** From the Food tab: the camera at once, the shutter, the review. */
async function takePhoto() {
  await fireEvent.press(await screen.findByRole("button", { name: "Log meal from photo" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Take photo" }));
}

beforeEach(() => {
  drawing.base64 = TAGGED.toString("base64");
  drawing.sizes = [];
  drawing.fails = false;
  camera.permission = { granted: true, canAskAgain: true, status: "granted", expires: "never" };
  camera.afterAsk = camera.permission;
  camera.asked = 0;
  camera.pictures = 0;
  camera.fails = false;
  picker.next = { canceled: true, assets: null };
  picker.opened = 0;
});

describe("the worst thing: a meal photo never leaves the phone with where or when it was taken", () => {
  it("the photo sent is drawn small and rebuilt: none of the camera's tags, nothing after its end", async () => {
    // The drawing hands back the phone's photo with every tag it had: the phone still sends none.
    expect(latin(TAGGED)).toContain("Exif\0\0");
    const server = await openFood({ meals: [], scans: [] });
    await takePhoto();
    expect(await screen.findByText("Toast and eggs")).toBeTruthy();
    const [asked] = scansAsked(server);
    const body = asked?.body as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["imageBase64", "mimeType"]);
    expect(body["mimeType"]).toBe("image/jpeg");
    const sent = Buffer.from(body["imageBase64"] ?? "", "base64");
    expect(sent.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const { blocks, afterEnd } = blocksOf(sent);
    expect(afterEnd).toBe(0);
    for (const block of blocks) {
      if (block.marker === 0xe1) expect(block.body.length).toBe(32);
      else expect([0xe0, 0xe2, 0xee, 0xdb, 0xc4, 0xc0, 0xc2, 0xdd]).toContain(block.marker);
    }
    const header = blocks.map((b) => latin(b.body)).join("");
    for (const words of ["GPS", "SEFT", "Image_UTC_Data", "http://ns.adobe.com/xap"]) expect(header).not.toContain(words);
    // Drawn no longer than 768 px on its longest side.
    expect(drawing.sizes).toEqual([{ width: 576, height: 768 }]);
  });

  it("sends nothing where the photo could not be drawn, and says so", async () => {
    drawing.base64 = "";
    const server = await openFood({ meals: [], scans: [] });
    await takePhoto();
    expect(await screen.findByText("That photo couldn’t be read. Try another one.")).toBeTruthy();
    expect(scansAsked(server)).toEqual([]);
  });
});

describe("a meal from a photo", () => {
  it("opens the live camera at once, and saves the scan's foods once to the meal picked", async () => {
    const phone: Phone = { meals: [], scans: [] };
    const photos = files();
    const server = await openFood(phone, { meals: files(), photos });
    await fireEvent.press(await screen.findByRole("button", { name: "Log meal from photo" }));
    expect(await screen.findByTestId("camera-view")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose from gallery" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByText("Toast and eggs")).toBeTruthy();
    expect(screen.getByText("Calories from a photo are an estimate. A photo cannot detect allergens.")).toBeTruthy();
    // The meal the time of day says is picked.
    const now = mealTypeName(sectionOf({ mealType: null, takenAt: new Date().toISOString() }));
    expect(screen.getByRole("radio", { name: now }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole("button", { name: "Change Toast, 2 × slice · 60 g" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change Eggs (scrambled), 120 g · estimate" })).toBeTruthy();
    expect(screen.getByText("green sauce")).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Snack" }));
    const save = await screen.findByRole("button", { name: "Save to Snack · 340 kcal" });
    // Two quick taps: one meal.
    await fireEvent.press(save);
    await fireEvent.press(save);
    expect(await screen.findByText("Toast and eggs added.")).toBeTruthy();
    await waitFor(() => {
      expect(phone.meals).toHaveLength(1);
    });
    expect(saves(server)).toHaveLength(1);
    const sent = saves(server)[0]?.body as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["id", "items", "mealType", "scanToken", "takenAt"]);
    expect(sent).toMatchObject({
      scanToken: SCAN_TOKEN,
      mealType: "snack",
      items: [
        { canonical: "toast", measure: "serving", amount: 2 },
        { canonical: "eggs_scrambled", measure: "g", amount: 120 },
      ],
    });
    // Saved: the photo meal is no longer kept, and the Food tab offers a new one.
    expect(photos.kept.get(RAVI.id)).toBe("");
    expect(screen.getByRole("button", { name: "Log meal from photo" })).toBeTruthy();
    expect(screen.queryByText("Your photo meal isn’t saved yet.")).toBeNull();
  });

  it("changes a food's amount, takes one off, and adds one the photo missed", async () => {
    const phone: Phone = { meals: [], scans: [] };
    const server = await openFood(phone);
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: "Change Toast, 2 × slice · 60 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: "More" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: "Change Toast, 2.5 × slice · 75 g" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Change Eggs (scrambled), 120 g · estimate" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Take off the meal" }));
    expect(await screen.findByText("Eggs (scrambled) taken off.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Add a food it missed" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "milk");
    await fireEvent.press(await screen.findByRole("button", { name: "Add Milk, whole, 144 kcal · 240 g" }));
    expect(await screen.findByText("Milk, whole added.")).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: /^Save to .* · 344 kcal$/ }));
    await waitFor(() => {
      expect(saves(server)).toHaveLength(1);
    });
    expect((saves(server)[0]?.body as { items: unknown }).items).toEqual([
      { canonical: "toast", measure: "serving", amount: 2.5 },
      { canonical: "milk_whole", measure: "g", amount: 240 },
    ]);
  });

  it("never offers a food the scan already put on the meal", async () => {
    await openFood({ meals: [], scans: [] });
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: "Add green sauce" }));
    expect(screen.getByLabelText("Search food").props.value).toBe("green sauce");
    expect(await screen.findByRole("button", { name: "Add Milk, whole, 144 kcal · 240 g" })).toBeTruthy();
    // The search found the scan's toast too: sent again, it would be read as the scan's own row.
    expect(screen.queryByRole("button", { name: /^Add Toast,/ })).toBeNull();
  });
});

describe("a scan that did not read the photo", () => {
  it("a poor photo says why, and the next photo is the free try the server gave", async () => {
    const token = "r".repeat(43);
    const server = await openFood({ meals: [], scans: [() => refusal(422, "retake_required", "Photo too dark.", { retakeToken: token })] });
    await takePhoto();
    expect(await screen.findByText("Couldn’t read that photo. Try again in better light. This try is free.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByText("Toast and eggs")).toBeTruthy();
    expect(scansAsked(server).map((a) => (a.body as { retakeToken?: string }).retakeToken)).toEqual([undefined, token]);
  });

  it("with no scans left says when more come, and opens the food search instead", async () => {
    await openFood({ meals: [], scans: [() => refusal(429, "quota_exceeded", "You've used all 3 meal_scan uses for this month.", { resetsAt: "2026-11-01T00:00:00.000Z" })] });
    await takePhoto();
    expect(await screen.findByText("You’ve used all your meal scans. More on 1 November.")).toBeTruthy();
    expect(screen.queryByText(/meal_scan/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Search food instead" }));
    const section = mealTypeName(sectionOf({ mealType: null, takenAt: new Date().toISOString() }));
    expect(await screen.findByText(`Add to ${section}`)).toBeTruthy();
  });

  it("with no signal keeps the camera and says so", async () => {
    await openFood({ meals: [], scans: [() => lost()] });
    await takePhoto();
    expect(await screen.findByText("No connection. Try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
  });
});

describe("a photo meal is never thrown away by leaving it", () => {
  it("closed, it waits on the Food tab, comes back after a restart, and goes only when Discard is said twice", async () => {
    const stores = { meals: files(), photos: files() };
    const server = await openFood({ meals: [], scans: [] }, stores);
    await takePhoto();
    expect(await screen.findByText("Toast and eggs")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Your photo meal isn’t saved yet.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Toast and eggs")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await screen.unmount();

    await openFood({ meals: [], scans: [] }, stores);
    expect(await screen.findByText("Your photo meal isn’t saved yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish photo meal" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Discard" }));
    expect(await screen.findByText("Its foods aren’t saved, and the scan it used isn’t given back.")).toBeTruthy();
    await fireEvent.press(screen.getAllByRole("button", { name: "Discard" }).at(-1) ?? screen.getByText("x"));
    await waitFor(() => {
      expect(screen.queryByText("Your photo meal isn’t saved yet.")).toBeNull();
    });
    expect(stores.photos.kept.get(RAVI.id)).toBe("");
    // One scan in all.
    expect(scansAsked(server)).toHaveLength(1);
  });

  it("saved with no signal, it waits on the phone and is saved once, as the scan's save, when the signal is back", async () => {
    const stores = { meals: files(), photos: files() };
    const phone: Phone = { meals: [], scans: [], save: () => lost() };
    await openFood(phone, stores);
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: /^Save to / }));
    expect(await screen.findByText("Toast and eggs added.")).toBeTruthy();
    expect(await screen.findByText("Waiting to send")).toBeTruthy();
    expect(phone.meals).toEqual([]);
    await screen.unmount();

    delete phone.save;
    const second = await openFood(phone, stores);
    await waitFor(() => {
      expect(phone.meals).toHaveLength(1);
    });
    expect(saves(second).map((s) => (s.body as { scanToken?: string }).scanToken)).toEqual([SCAN_TOKEN]);
    await waitFor(() => {
      expect(screen.queryByText("Waiting to send")).toBeNull();
    });
  });
});

describe("the camera not allowed", () => {
  it("asks once, then offers the phone's settings, and a photo from the gallery still works", async () => {
    const no = { granted: false, canAskAgain: false, status: "denied", expires: "never" };
    camera.permission = { granted: false, canAskAgain: true, status: "undetermined", expires: "never" };
    camera.afterAsk = no;
    picker.next = { canceled: false, assets: [{ uri: "file:///gallery/lunch.jpg", width: 3000, height: 4000 }] };
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    const server = await openFood({ meals: [], scans: [] });
    await fireEvent.press(await screen.findByRole("button", { name: "Log meal from photo" }));
    expect(await screen.findByText("Allow the camera")).toBeTruthy();
    expect(camera.asked).toBe(1);
    expect(screen.queryByTestId("camera-view")).toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "Open settings" }));
    expect(settings).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Choose from gallery" }));
    expect(await screen.findByText("Toast and eggs")).toBeTruthy();
    expect(picker.opened).toBe(1);
    expect(scansAsked(server)).toHaveLength(1);
  });
});
