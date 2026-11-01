import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Linking } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { Meal, MealPhotoAnalysis, NutritionTargetsResponse } from "@app/shared";
import { App } from "../../src/App";
import { mealTypeName, sectionOf, MONTH_NAMES } from "../../src/screens/food/day";
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
type Own = { name: string; grams: number; own: { proteinG: number; carbsG: number; fatG: number } };
type Dish = { canonical: string; dishwareId: string; fillLevel: number; share?: number };
type Sent = { canonical: string; measure: string; amount: number } | Own | Dish;
/** The bowl everybody has holds 375 ml; these foods weigh a gram a millilitre. */
const BOWL_ML = 375;
const BOWL_ML_NOW = { ml: BOWL_ML };
/** As the server prices them: a food of the lists by its own figures, the person's own food by its
 *  protein, carbs and fat at 4, 4 and 9 kcal a gram. */
function priced(sent: Sent) {
  if ("own" in sent) {
    const kcal = Math.round(4 * sent.own.proteinG + 4 * sent.own.carbsG + 9 * sent.own.fatG);
    return {
      name: sent.name,
      canonical: `own_${sent.name.toLowerCase().replace(/[^a-z]+/g, "_")}`,
      gramsPoint: sent.grams,
      gramsRange: [sent.grams, sent.grams],
      portionSource: "default",
      nutritionSource: "own",
      kcalPoint: kcal,
      kcalLow: kcal,
      kcalHigh: kcal,
      ...sent.own,
    };
  }
  const food = PER_GRAM[sent.canonical] ?? { name: sent.canonical, kcal: 1, source: "usda" };
  if ("dishwareId" in sent) {
    const grams = Math.round(BOWL_ML_NOW.ml * sent.fillLevel * (sent.share ?? 1));
    const kcal = Math.round(grams * food.kcal);
    return {
      name: food.name, canonical: sent.canonical, gramsPoint: grams, gramsRange: [grams, grams], portionSource: "user_dishware", nutritionSource: food.source,
      kcalPoint: kcal, kcalLow: kcal, kcalHigh: kcal, proteinG: 5, carbsG: 10, fatG: 2,
      measure: { id: "dish", name: "Bowl", amount: sent.fillLevel, ...(sent.share === undefined ? {} : { share: sent.share }) },
    };
  }
  const item = sent;
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
  /** The server no longer holds the scan: its previews are refused. */
  scanGone?: boolean;
  /** The previews stop answering (no signal), from the moment this is set. */
  previewsLost?: boolean;
  /** The ten figures each food is priced with, by its canonical. */
  figures?: Record<string, unknown>;
  /** The person's own dishes. */
  dishes?: unknown[];
  /** The server answers the previews no, from the moment this is set. */
  previewsRefused?: boolean;
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
    "/v1/nutrition/dishware": () => ({ status: 200, body: { items: phone.dishes ?? [], nextCursor: null } }),
    "/v1/nutrition/dishware/00000000-0000-4000-8000-00000000d153": () => ({ status: 200, body: { dishware: { id: "00000000-0000-4000-8000-00000000d153", label: "Bowl", containerClass: "cereal_bowl", volumeMl: BOWL_ML_NOW.ml, foodHint: null, createdAt: "2026-10-30T00:00:00.000Z" } } }),
    "/v1/nutrition/analyze-photo": (body) => (phone.scans.shift() ?? ok(SCAN))(body),
    "/v1/nutrition/meals/preview": (body) => {
      if (phone.previewsLost === true) return lost();
      if (phone.previewsRefused === true) return refusal(400, "unknown_food", "Food not found.");
      if (phone.scanGone === true && (body as { scanToken?: string }).scanToken !== undefined) return refusal(400, "invalid_scan", "Invalid or expired scan token.");
      const items = (body as { items: Sent[] }).items.map(priced);
      const withFigures = items.map((it) => ({ ...it, ...(phone.figures?.[it.canonical] === undefined ? {} : { more: phone.figures[it.canonical] }) }));
      return { status: 200, body: { items: withFigures, totals: sum(items) } };
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
  await fireEvent.press(await screen.findByRole("button", { name: "Scan food" }));
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
  it("signing out on purpose removes the kept photo: the next person to hold the phone is not its owner", async () => {
    const phone: Phone = { meals: [], scans: [] };
    const photos = files();
    await openFood(phone, { meals: files(), photos });
    await fireEvent.press(await screen.findByRole("button", { name: "Scan food" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Take photo" }));
    await screen.findByText("Toast and eggs");
    await waitFor(() => { expect([...photos.kept.values()].some((text) => text.length > 0)).toBe(true); });
    const closes = await screen.findAllByRole("button", { name: "Close" });
    const close = closes[0];
    if (close === undefined) throw new Error("no Close");
    await fireEvent.press(close);
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
    const asks = await screen.findAllByRole("button", { name: "Sign out" });
    const ask = asks[asks.length - 1];
    if (ask === undefined) throw new Error("no Sign out");
    await fireEvent.press(ask);
    await waitFor(() => { expect([...photos.kept.values()].every((text) => text === "")).toBe(true); });
  });

  it("opens the live camera at once, and saves the scan's foods once to the meal picked", async () => {
    const phone: Phone = { meals: [], scans: [] };
    const photos = files();
    const server = await openFood(phone, { meals: files(), photos });
    await fireEvent.press(await screen.findByRole("button", { name: "Scan food" }));
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
    expect(await screen.findByText("340 kcal · Protein 10 g · Carbs 20 g · Fat 4 g")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save to Snack" });
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
    expect(screen.getByRole("button", { name: "Scan food" })).toBeTruthy();
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
    expect(await screen.findByText(/^344\skcal · /)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Save to / }));
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
    // A date some days off, not a fixed one: tomorrow is said as "tomorrow".
    const later = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await openFood({ meals: [], scans: [() => refusal(429, "quota_exceeded", "You've used all 3 meal_scan uses for this month.", { resetsAt: later.toISOString() })] });
    await takePhoto();
    expect(await screen.findByText(`You’ve used all your photo scans. More on ${String(later.getDate())} ${MONTH_NAMES[later.getMonth()] ?? ""}.`)).toBeTruthy();
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
    // One way back in: the picture's own button says what it opens.
    expect(screen.queryByRole("button", { name: "Finish" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Finish photo meal" }));
    expect(await screen.findByText("Toast and eggs")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
    await screen.unmount();

    // After a restart the meal comes back with the photo as it was sent.
    await openFood({ meals: [], scans: [] }, stores);
    expect(await screen.findByText("Your photo meal isn’t saved yet.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Finish photo meal" }));
    expect(await screen.findByText("Toast and eggs")).toBeTruthy();
    const sent = (scansAsked(server)[0]?.body as { imageBase64: string }).imageBase64;
    expect(screen.getByTestId("meal-picture").props.source).toEqual({ uri: `data:image/jpeg;base64,${sent}` });
    await fireEvent.press(screen.getByRole("button", { name: "Close" }));
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

describe("a food the photo got wrong, and one no list has (Kd, 2026-10-30)", () => {
  it("changes a food to another from the search, at the grams it weighed, and goes back to what the photo saw", async () => {
    const server = await openFood({ meals: [], scans: [] });
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: "Change Toast, 2 × slice · 60 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Not this? Change food" }));
    expect(await screen.findByText("Change Toast")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Search food"), "milk");
    await fireEvent.press(await screen.findByRole("button", { name: "Change to Milk, whole, 144 kcal · 240 g" }));
    expect(await screen.findByText("Toast changed to Milk, whole.")).toBeTruthy();
    expect(screen.getByText("Changed from Toast")).toBeTruthy();
    // Undo, from the food's own box.
    await fireEvent.press(await screen.findByRole("button", { name: /^Change Milk, whole, 60 g/ }));
    await fireEvent.press(await screen.findByRole("button", { name: "Back to Toast" }));
    expect(await screen.findByText("Back to Toast.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Change Toast, 2 × slice · 60 g" })).toBeTruthy();
    // Changed again, and saved: the milk goes in the toast's place, at the 60 g the toast weighed.
    await fireEvent.press(screen.getByRole("button", { name: "Change Toast, 2 × slice · 60 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Not this? Change food" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "milk");
    await fireEvent.press(await screen.findByRole("button", { name: "Change to Milk, whole, 144 kcal · 240 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Save to / }));
    await waitFor(() => {
      expect(saves(server)).toHaveLength(1);
    });
    expect((saves(server)[0]?.body as { items: unknown }).items).toEqual([
      { canonical: "milk_whole", measure: "g", amount: 60 },
      { canonical: "eggs_scrambled", measure: "g", amount: 120 },
    ]);
  });

  it("the worst thing (33b-ii): a food titled by what the photo saw always says, under it, the food its numbers are from", async () => {
    const seenToast = { ...scannedItems[0], seenAs: "Sourdough toast" };
    await openFood({ meals: [], scans: [ok({ ...SCAN, items: [seenToast, scannedItems[1]] })] });
    await takePhoto();
    expect(await screen.findByText("Sourdough toast")).toBeTruthy();
    expect(screen.getByText("Toast ·")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change Sourdough toast, Toast, 2 × slice · 60 g" })).toBeTruthy();
    // A food that reads as its food has no second name.
    expect(screen.getByRole("button", { name: "Change Eggs (scrambled), 120 g · estimate" })).toBeTruthy();
    expect(screen.queryByText("Eggs (scrambled) ·")).toBeNull();
    // Its own box says the same.
    await fireEvent.press(screen.getByRole("button", { name: "Change Sourdough toast, Toast, 2 × slice · 60 g" }));
    expect(await screen.findAllByText("Toast ·")).toHaveLength(2);
  });

  it("\"Not this?\" offers the close foods first, at the grams the food weighed, never one already on the meal; typing searches instead (33b-ii)", async () => {
    const SOURDOUGH = { ...MILK, canonical: "bread_sourdough", name: "Bread, sourdough", kcal: 289, source: "usda" };
    const EGGS = { ...MILK, canonical: "eggs_scrambled", name: "Eggs (scrambled)", kcal: 149, source: "curated" };
    const seenToast = { ...scannedItems[0], seenAs: "Sourdough toast", closeFoods: [EGGS, SOURDOUGH] };
    const server = await openFood({ meals: [], scans: [ok({ ...SCAN, items: [seenToast, scannedItems[1]] })] });
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: "Change Sourdough toast, Toast, 2 × slice · 60 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Not this? Change food" }));
    expect(await screen.findByText("Change Sourdough toast")).toBeTruthy();
    expect(screen.getByText("Close matches")).toBeTruthy();
    // 289 kcal a 100 g, at the 60 g the toast weighed.
    expect(screen.getByRole("button", { name: "Change to Bread, sourdough, 173 kcal · 60 g" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Change to Eggs \(scrambled\)/ })).toBeNull();
    // Typing searches: the close foods give way to what the search finds.
    await fireEvent.changeText(screen.getByLabelText("Search food"), "milk");
    expect(await screen.findByRole("button", { name: "Change to Milk, whole, 144 kcal · 240 g" })).toBeTruthy();
    expect(screen.queryByText("Close matches")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Search food"), "");
    await fireEvent.press(await screen.findByRole("button", { name: "Change to Bread, sourdough, 173 kcal · 60 g" }));
    expect(await screen.findByText("Sourdough toast changed to Bread, sourdough.")).toBeTruthy();
    expect(screen.getByText("Changed from Sourdough toast")).toBeTruthy();
    // Back to what the photo saw, and changed again: saved in the toast's place at its 60 g.
    await fireEvent.press(await screen.findByRole("button", { name: /^Change Bread, sourdough, 60 g/ }));
    await fireEvent.press(await screen.findByRole("button", { name: "Back to Sourdough toast" }));
    expect(await screen.findByText("Back to Sourdough toast.")).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: "Change Sourdough toast, Toast, 2 × slice · 60 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Not this? Change food" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Change to Bread, sourdough, 173 kcal · 60 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Save to / }));
    await waitFor(() => {
      expect(saves(server)).toHaveLength(1);
    });
    expect((saves(server)[0]?.body as { items: unknown }).items).toEqual([
      { canonical: "bread_sourdough", measure: "g", amount: 60 },
      { canonical: "eggs_scrambled", measure: "g", amount: 120 },
    ]);
  });

  it("puts the person's own food in a food's place, starting at the grams it weighed, priced by their numbers", async () => {
    const server = await openFood({ meals: [], scans: [] });
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: "Change Eggs (scrambled), 120 g · estimate" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Not this? Change food" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "chicken taco");
    await fireEvent.press(await screen.findByRole("button", { name: "Add chicken taco with your own numbers" }));
    expect(await screen.findByText("Your own food")).toBeTruthy();
    expect(screen.getByLabelText("Food name").props.value).toBe("chicken taco");
    expect(screen.getByLabelText("How much you ate, in grams").props.value).toBe("120");
    await fireEvent.changeText(screen.getByLabelText("Food name"), "Chicken taco");
    // Numbers heavier than the food say so, never a grey button alone.
    await fireEvent.changeText(screen.getByLabelText("Protein (g)"), "200");
    expect(await screen.findByText("Protein, carbs and fat together can’t weigh more than the food itself.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Protein (g)"), "18");
    await fireEvent.changeText(screen.getByLabelText("Carbs (g)"), "20");
    await fireEvent.changeText(screen.getByLabelText("Fat (g)"), "9");
    await fireEvent.press(await screen.findByRole("button", { name: "Add Chicken taco · 233 kcal" }));
    expect(await screen.findByText("Eggs (scrambled) changed to Chicken taco.")).toBeTruthy();
    expect(screen.getByText("Changed from Eggs (scrambled)")).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: /^Save to / }));
    await waitFor(() => {
      expect(saves(server)).toHaveLength(1);
    });
    expect((saves(server)[0]?.body as { items: unknown }).items).toEqual([
      { canonical: "toast", measure: "serving", amount: 2 },
      { name: "Chicken taco", grams: 120, own: { proteinG: 18, carbsG: 20, fatG: 9 } },
    ]);
  });

  it("shares the whole meal out over one dish, in the amounts the photo saw (Kd, 2026-10-30)", async () => {
    const server = await openFood({ meals: [], scans: [] });
    await takePhoto();
    expect(await screen.findByText(/^340\skcal · /)).toBeTruthy();
    // The dishes under the foods, the bowl picked for somebody who has used none; nothing changes
    // until a filled bowl is tapped.
    expect(screen.getByText("Eaten from one dish")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Bowl · 375 ml" }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole("button", { name: "Change Toast, 2 × slice · 60 g" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Bowl, full" }));
    expect(await screen.findByText("Shared out over Bowl, full.")).toBeTruthy();
    // Toast 60 g and eggs 120 g: a third and two thirds of the bowl.
    expect(await screen.findByRole("button", { name: "Change Toast, Part of Bowl, full · 125 g" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change Eggs (scrambled), Part of Bowl, full · 250 g · estimate" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Save to / }));
    await waitFor(() => {
      expect(saves(server)).toHaveLength(1);
    });
    expect((saves(server)[0]?.body as { items: unknown }).items).toEqual([
      { canonical: "toast", dishwareId: "00000000-0000-4000-8000-00000000d153", fillLevel: 1, share: 0.333 },
      { canonical: "eggs_scrambled", dishwareId: "00000000-0000-4000-8000-00000000d153", fillLevel: 1, share: 0.667 },
    ]);
  });

  it("a lit filled dish or a lit dish tapped again is unselected, and the foods go back to what the photo saw (Kd's click-through, 2026-10-30)", async () => {
    await openFood({ meals: [], scans: [] });
    await takePhoto();
    await screen.findByText(/^340\skcal · /);
    await fireEvent.press(screen.getByRole("button", { name: "Bowl, full" }));
    await screen.findByRole("button", { name: "Change Toast, Part of Bowl, full · 125 g" });
    expect(screen.getByRole("button", { name: "Bowl, full" }).props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole("button", { name: "Bowl, full" }));
    expect(await screen.findByText("Back to the amounts the photo saw.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Change Toast, 2 × slice · 60 g" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bowl, full" }).props.accessibilityState).toMatchObject({ selected: false });
    // The dish itself: lit, then none, its pictures gone; tapped again, back.
    await fireEvent.press(screen.getByRole("button", { name: "Bowl, half full" }));
    await screen.findByRole("button", { name: /^Change Toast, Part of Bowl/ });
    await fireEvent.press(screen.getByRole("radio", { name: "Bowl · 375 ml" }));
    expect(await screen.findByRole("button", { name: "Change Toast, 2 × slice · 60 g" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Bowl · 375 ml" }).props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.queryByRole("button", { name: "Bowl, full" })).toBeNull();
    await fireEvent.press(screen.getByRole("radio", { name: "Bowl · 375 ml" }));
    expect(screen.getByRole("button", { name: "Bowl, full" })).toBeTruthy();
  });

  it("with no signal the foods' weights say so, never an endless wait, and come by themselves when it is back (Kd's click-through, 2026-10-30)", async () => {
    const phone: Phone = { meals: [], scans: [] };
    await openFood(phone);
    await takePhoto();
    await screen.findByText(/^340\skcal · /);
    phone.previewsLost = true;
    await fireEvent.press(screen.getByRole("button", { name: "Bowl, full" }));
    expect(await screen.findAllByText(/^Can’t reach the server\./)).not.toHaveLength(0);
    expect(screen.queryByText("Working out the foods’ weights…")).toBeNull();
    phone.previewsLost = false;
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: /^Change Toast, Part of Bowl, full · \d+ g/ });
    expect(screen.queryByText(/^Can’t reach the server\./)).toBeNull();
  });

  it("with no signal it asks again after 30 seconds, by itself (re-check)", async () => {
    const phone: Phone = { meals: [], scans: [] };
    await openFood(phone);
    await takePhoto();
    await screen.findByText(/^340\skcal · /);
    phone.previewsLost = true;
    // Not a jest mock: one turns the tool's wait into its fake-timer wait, which stops after about 250 ms, before the app's 300 ms is up.
    const realTimeout = globalThis.setTimeout;
    const waits: { run: () => void; ms: number | undefined }[] = [];
    globalThis.setTimeout = Object.assign((run: () => void, ms?: number) => {
      waits.push({ run, ms });
      return realTimeout(run, ms);
    }, realTimeout);
    try {
      await fireEvent.press(screen.getByRole("button", { name: "Bowl, full" }));
      await screen.findAllByText(/^Can’t reach the server\./);
    } finally {
      globalThis.setTimeout = realTimeout;
    }
    const again = waits.find((w) => w.ms === 30_000)?.run;
    expect(typeof again).toBe("function");
    phone.previewsLost = false;
    await act(async () => {
      again?.();
      await Promise.resolve();
    });
    expect(await screen.findByRole("button", { name: /^Change Toast, Part of Bowl, full · \d+ g/ })).toBeTruthy();
  });

  it("a server that answers no is never told as no connection, and is not asked again (round one, H4)", async () => {
    const phone: Phone = { meals: [], scans: [] };
    await openFood(phone);
    await takePhoto();
    await screen.findByText(/^340\skcal · /);
    phone.previewsRefused = true;
    await fireEvent.press(screen.getByRole("button", { name: "Bowl, full" }));
    expect(await screen.findByText("This meal’s calories can’t be worked out. Change a food, or take a new photo.")).toBeTruthy();
    expect(screen.queryByText(/^Can’t reach the server/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Save to / }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("a dish's size changed while the meal uses it prices the meal again (round one)", async () => {
    const phone: Phone = { meals: [], scans: [] };
    await openFood(phone);
    await takePhoto();
    await screen.findByText(/^340\skcal · /);
    await fireEvent.press(screen.getByRole("button", { name: "Bowl, full" }));
    await screen.findByRole("button", { name: "Change Toast, Part of Bowl, full · 125 g" });
    BOWL_ML_NOW.ml = 750;
    await fireEvent.press(screen.getByRole("button", { name: "Edit your dishes" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Edit Bowl" }));
    await fireEvent.changeText(screen.getByLabelText("Its size in ml"), "750");
    await fireEvent.press(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved Bowl, 750 ml.");
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: "Change Toast, Part of Bowl, full · 250 g" })).toBeTruthy();
    BOWL_ML_NOW.ml = BOWL_ML;
  });

  it("the one dish's Edit offers the dishes everybody has too (Kd's click-through, 2026-10-30)", async () => {
    await openFood({ meals: [], scans: [] });
    await takePhoto();
    await screen.findByText(/^340\skcal · /);
    await fireEvent.press(screen.getByRole("button", { name: "Edit your dishes" }));
    for (const name of ["Edit Cup", "Edit Mug", "Edit Bowl"]) expect(await screen.findByRole("button", { name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Bowl" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset Bowl" })).toBeNull();
  });

  it("the one dish's Edit opens the person's own dishes", async () => {
    await openFood({ meals: [], scans: [], dishes: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Travel mug", containerClass: "mug", volumeMl: 400, foodHint: null, createdAt: "2026-10-30T00:00:00.000Z" }] });
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: "Edit your dishes" }));
    expect(await screen.findByRole("button", { name: "Edit Travel mug" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Travel mug" })).toBeTruthy();
  });

  it("a food left without how full its dish was is named, in red, and the meal waits for it", async () => {
    await openFood({ meals: [], scans: [] });
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: "Change Toast, 2 × slice · 60 g" }));
    // The food's own box is open over the meal: its Bowl is the last drawn.
    const bowls = await screen.findAllByRole("radio", { name: "Bowl · 375 ml" });
    await fireEvent.press(bowls[bowls.length - 1] ?? bowls[0] ?? screen.getByText("x"));
    await fireEvent.press(await screen.findByRole("button", { name: "Done" }));
    expect(await screen.findByText("Toast: pick how full the dish was. Tap it to finish, then save.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change Toast, Pick how full the dish was" })).toBeTruthy();
    expect(screen.getByText("Toast needs an amount first.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Save to / }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("one part of a shared dish changed before the weights come back waits, and never refills the dish (re-check, N1)", async () => {
    const phone: Phone = { meals: [], scans: [] };
    await openFood(phone);
    await takePhoto();
    expect(await screen.findByText(/^340\skcal · /)).toBeTruthy();
    // The signal drops as the dish is applied: its parts' weights never come back.
    phone.previewsLost = true;
    await fireEvent.press(screen.getByRole("button", { name: "Bowl, full" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Change Eggs \(scrambled\), / }));
    await fireEvent.press(screen.getByRole("button", { name: "Take off the meal" }));
    expect(await screen.findAllByText("Wait a moment: the foods’ weights are still being worked out.")).toBeTruthy();
    // Nothing changed: both parts are still on the meal, as they were.
    expect(screen.getByRole("button", { name: /^Change Toast, / })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Change Eggs \(scrambled\), / })).toBeTruthy();
  });

  it("a scan the server no longer holds says so, and is not saved", async () => {
    const server = await openFood({ meals: [], scans: [], scanGone: true });
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: "Change Toast, 2 × slice · 60 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: "More" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Done" }));
    expect(await screen.findByText("This photo’s scan has run out, so this meal can’t be saved. Take a new photo.")).toBeTruthy();
    const save = screen.getByRole("button", { name: /^Save to / });
    expect(save.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(save);
    expect(saves(server)).toEqual([]);
  });

  it("logs a typed meal of the person's own food where the search has none", async () => {
    const server = await openFood({ meals: [], scans: [] });
    const section = mealTypeName(sectionOf({ mealType: null, takenAt: new Date().toISOString() }));
    await fireEvent.press(await screen.findByRole("button", { name: `Add to ${section}` }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "Chicken taco");
    await fireEvent.press(await screen.findByRole("button", { name: "Add Chicken taco with your own numbers" }));
    await fireEvent.changeText(screen.getByLabelText("How much you ate, in grams"), "150");
    await fireEvent.changeText(screen.getByLabelText("Protein (g)"), "18");
    await fireEvent.changeText(screen.getByLabelText("Carbs (g)"), "20");
    await fireEvent.changeText(screen.getByLabelText("Fat (g)"), "9");
    await fireEvent.press(await screen.findByRole("button", { name: "Add Chicken taco · 233 kcal" }));
    // After each Add the meal is shown, with Add another food and Save (Kd, 2026-10-30: oats and milk).
    expect(await screen.findByText("Your meal")).toBeTruthy();
    expect(screen.queryByLabelText("Search food")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Add another food" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "milk");
    await fireEvent.press(await screen.findByRole("button", { name: "Milk, whole, 144 kcal · 240 g, USDA" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Add Milk, whole · / }));
    expect(await screen.findByText("Milk, whole")).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: "Take Milk, whole off" }));
    await fireEvent.press(screen.getByRole("button", { name: "Add another food" }));
    await fireEvent.changeText(screen.getByLabelText("Search food"), "milk");
    await fireEvent.press(await screen.findByRole("button", { name: "Milk, whole, 144 kcal · 240 g, USDA" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Add Milk, whole · / }));
    // A food on the meal opened again is changed in its own place.
    await fireEvent.press(await screen.findByRole("button", { name: /^Change Milk, whole, / }));
    await fireEvent.press(await screen.findByRole("button", { name: "More" }));
    await fireEvent.press(await screen.findByRole("button", { name: /^Update Milk, whole/ }));
    expect(await screen.findByText("Your meal")).toBeTruthy();
    // Named the person's own way (Kd, 2026-10-30: the foods' names grow too long); blank, the foods name it.
    expect(screen.getByLabelText("Meal name").props.placeholder).toBe("Chicken taco & Milk, whole");
    await fireEvent.changeText(screen.getByLabelText("Meal name"), "  Taco night ");
    const keep = await screen.findByRole("button", { name: `Save meal to ${section}` });
    await fireEvent.press(keep);
    await fireEvent.press(keep);
    expect(await screen.findByText("Taco night added.")).toBeTruthy();
    await waitFor(() => {
      expect(saves(server)).toHaveLength(1);
    });
    expect(saves(server)[0]?.body).toMatchObject({
      mealName: "Taco night",
      items: [{ name: "Chicken taco", grams: 150, own: { proteinG: 18, carbsG: 20, fatG: 9 } }, { canonical: "milk_whole", measure: "g", amount: 250 }],
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
    await fireEvent.press(await screen.findByRole("button", { name: "Scan food" }));
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

describe("a food's ten figures on the photo's review (34b)", () => {
  const none = { fiberG: null, sugarsG: null, satFatG: null, unsatFatG: null, potassiumMg: null, calciumMg: null, ironMg: null, magnesiumMg: null, vitaminDUg: null };
  const figures = { toast: { ...none, sodiumMg: 111 }, eggs_scrambled: { ...none, sodiumMg: 222 } };

  it("shows the opened food's own figures, never another's, and a food with none reads No data", async () => {
    await openFood({ meals: [], scans: [], figures });
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: "Change Toast, 2 × slice · 60 g" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Nutrients" }));
    expect(await screen.findByLabelText("Sodium, 111 mg")).toBeTruthy();
    expect(screen.queryByLabelText("Sodium, 222 mg")).toBeNull();
    expect(screen.getByLabelText("Iron, No data")).toBeTruthy();
  });

  it("Back returns to the food's box as it was left", async () => {
    await openFood({ meals: [], scans: [], figures });
    await takePhoto();
    await fireEvent.press(await screen.findByRole("button", { name: /^Change Eggs \(scrambled\), / }));
    const field = await screen.findByLabelText("Amount");
    await fireEvent.changeText(field, "77");
    await fireEvent.press(await screen.findByRole("button", { name: "Nutrients" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Amount").props.value).toBe("77");
    expect(screen.queryByLabelText(/^Sodium, /)).toBeNull();
  });
});
