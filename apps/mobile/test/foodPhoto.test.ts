import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MEAL_PHOTO_KEPT_MOST, MEAL_SCAN_SAVE_SECONDS, type MealPhotoAnalysis, type WaitingMeal } from "@app/shared";
import { saveBody } from "../src/screens/food/outbox";
import {
  againWords,
  atScan,
  fitWithin,
  fromBase64,
  newSheet,
  onSheet,
  photoToSend,
  readSheetFile,
  saveWords,
  scanTrouble,
  sheetFileText,
  sheetItems,
  sheetLeftMs,
  sheetRows,
  toBase64,
  totalsWords,
  withExtra,
  withRowAmount,
} from "../src/screens/food/photo";

// A meal photo on the phone (ROADMAP Stage 5 33b-i).

/** Real phones' photos, each carrying the GPS position it was taken at (apps/api/test/fixtures/photos/README.md). */
const PHOTOS = ["iphone16.jpg", "samsung-a56-meta.jpg", "pixel7-meta.jpg", "progressive-exif-between-scans.jpg"] as const;
const photo = (name: string): Uint8Array => new Uint8Array(readFileSync(join(__dirname, "..", "..", "api", "test", "fixtures", "photos", name)));
const latin = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

/** Every block of a JPEG, between and after its passes too, and what follows its end: read here, not
 *  by the cleaner. */
function blocksOf(b: Uint8Array): { blocks: { marker: number; body: Uint8Array }[]; afterEnd: number } {
  const blocks: { marker: number; body: Uint8Array }[] = [];
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

describe("the worst thing: a meal photo never leaves the phone with where or when it was taken", () => {
  it.each(PHOTOS)("%s goes with none of its tags, nothing after its end, and only what draws it", (name) => {
    const original = photo(name);
    // The photo carries the tags this guards against.
    expect(latin(original)).toContain("Exif\0\0");
    const sent = fromBase64(photoToSend(toBase64(original)) ?? "");
    expect(sent).not.toBeNull();
    const bytes = sent ?? new Uint8Array();
    const { blocks, afterEnd } = blocksOf(bytes);
    expect(afterEnd).toBe(0);
    for (const block of blocks) {
      // Tables, frames and JFIF; a colour profile; and at most the one fact of which way up it is.
      if (block.marker === 0xe1) {
        // "Exif", a TIFF header and ONE entry, the orientation (tag 0x0112): 32 bytes, nothing else.
        expect(latin(block.body.subarray(0, 6))).toBe("Exif\0\0");
        expect(block.body.length).toBe(32);
        expect(Array.from(block.body.subarray(14, 18))).toEqual([0x00, 0x01, 0x01, 0x12]);
      } else if (block.marker === 0xe2) {
        expect(latin(block.body.subarray(0, 12))).toBe("ICC_PROFILE\0");
      } else if (block.marker === 0xee) {
        // Adobe's block says how the colours are stored: the picture is drawn wrong without it.
        expect(latin(block.body.subarray(0, 5))).toBe("Adobe");
        expect(block.body.length).toBe(12);
      } else {
        expect([0xe0, 0xdb, 0xc4, 0xc0, 0xc1, 0xc2, 0xdd]).toContain(block.marker);
      }
    }
    // Read in the blocks, where tags live: the compressed picture can hold any three letters.
    const header = blocks.map((b) => latin(b.body)).join("");
    for (const words of ["http://ns.adobe.com/xap", "Photoshop", "GPS", "SEFT", "Image_UTC_Data", "MPF"]) expect(header).not.toContain(words);
  });

  it("sends nothing for what is no picture", () => {
    expect(photoToSend("not base64!")).toBeNull();
    expect(photoToSend(toBase64(new Uint8Array(2000).fill(7)))).toBeNull();
    const damaged = photo("pixel7-meta.jpg").subarray(0, 900);
    expect(photoToSend(toBase64(damaged))).toBeNull();
  });

  it("reads and writes base64 as the server does", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 300]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);
      const text = toBase64(bytes);
      expect(text).toBe(Buffer.from(bytes).toString("base64"));
      expect(Array.from(fromBase64(text) ?? [])).toEqual(Array.from(bytes));
    }
    expect(fromBase64("abc")).toBeNull();
  });

  it("makes a photo no longer than 768 px on its longest side, never larger", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 768, height: 576 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 576, height: 768 });
    expect(fitWithin(600, 400)).toEqual({ width: 600, height: 400 });
  });
});

const NOW = new Date(2026, 9, 29, 13, 5);
const refused = (status: number, error: string, more: object = {}) => ({
  kind: "refused" as const,
  status,
  error,
  message: "The server's own words.",
  retryAfterSeconds: null,
  robotCheckKey: null,
  body: { error, message: "The server's own words.", requestId: "r", ...more },
});
const TOKEN = "t".repeat(40);

describe("a scan that did not read the photo says why, what next, and keeps the free try", () => {
  it.each([
    ["a photo it could not read, with a free try", refused(422, "retake_required", { retakeToken: TOKEN }), "Couldn’t read that photo. Try again in better light. This try is free.", { token: TOKEN }, false],
    ["a photo it could not read, the free try used", refused(422, "retake_required"), "Couldn’t read that photo. Try another one.", "keep", false],
    ["the scanner busy, a free try given", refused(503, "scanner_unavailable", { retakeToken: TOKEN }), "Meal scanning is busy. Try again in a minute. This try is free.", { token: TOKEN }, false],
    ["the scanner busy", refused(503, "scanner_unavailable"), "Meal scanning is busy. Try again in a minute.", "keep", false],
    ["scanning switched off", refused(503, "nutrition_unavailable"), "Meal scanning isn’t available right now. Try again later.", "keep", true],
    ["no scans left this month", refused(429, "quota_exceeded", { resetsAt: "2026-11-01T00:00:00.000Z" }), "You’ve used all your meal scans. More on 1 November.", "keep", true],
    ["no scans left today", refused(429, "quota_exceeded", { resetsAt: new Date(2026, 9, 30, 0, 0).toISOString() }), "You’ve used all your meal scans. More tomorrow.", "keep", true],
    ["no scans left, no date sent", refused(429, "quota_exceeded"), "You’ve used all your meal scans for now.", "keep", true],
    ["too many tries", refused(429, "rate_limited"), "Too many tries. Wait a minute, then try again.", "keep", false],
    ["the free try ran out", refused(400, "invalid_retake"), "That free try ran out. Take the photo again.", "clear", false],
    ["a picture it would not take", refused(400, "invalid_image"), "That photo couldn’t be read. Try another one.", "keep", false],
    ["a request it would not read", refused(400, "validation_error"), "That photo couldn’t be read. Try another one.", "keep", false],
    ["a fault of the server's", refused(500, "internal"), "Meal scanning didn’t work. Try again.", "keep", false],
    ["no answer", { kind: "no_answer" as const }, "No connection. Try again.", "keep", false],
  ] as const)("%s", (_, answer, words, retake, search) => {
    expect(scanTrouble(answer, NOW)).toEqual({ words, retake, search });
  });

  it("never shows the server's own words for a refusal", () => {
    for (const status of [400, 422, 429, 500, 503]) expect(scanTrouble(refused(status, "x"), NOW).words).not.toContain("server's own");
  });

  it("reads a date it cannot read as none", () => {
    expect(againWords("soon", NOW)).toBeNull();
    expect(againWords(null, NOW)).toBeNull();
  });
});

const measures = [
  { id: "g" as const, name: "g", grams: 1 },
  { id: "serving" as const, name: "slice", grams: 30 },
];
const scanned = (name: string, canonical: string, start: { measure: "g" | "serving"; amount: number }, estimated = false): MealPhotoAnalysis["items"][number] => ({
  name,
  canonical,
  gramsPoint: 60,
  gramsRange: [50, 70],
  portionSource: "default",
  nutritionSource: "curated",
  kcalPoint: 160,
  kcalLow: 140,
  kcalHigh: 180,
  proteinG: 5,
  carbsG: 30,
  fatG: 2,
  measures,
  startsAt: start,
  portionEstimated: estimated,
});
const ANALYSIS: MealPhotoAnalysis = {
  scanToken: "s".repeat(40),
  mealName: "Toast and eggs",
  items: [scanned("Toast", "toast", { measure: "serving", amount: 2 }), scanned("Eggs (scrambled)", "eggs_scrambled", { measure: "g", amount: 120 }, true)],
  unknownItems: ["green sauce"],
  photoQuality: "good",
  totals: { kcalPoint: 320, kcalLow: 280, kcalHigh: 360, proteinG: 10, carbsG: 60, fatG: 4 },
  confirmed: false,
};
const MILK = { canonical: "milk_whole", name: "Milk, whole", source: "usda" as const, measures, startsAt: { measure: "g" as const, amount: 240 } };

describe("the photo's meal while it is reviewed", () => {
  it("starts each food where the server started it, in the meal the time of day says", () => {
    const sheet = newSheet(ANALYSIS, NOW);
    expect(sheet.mealType).toBe("lunch");
    expect(newSheet(ANALYSIS, new Date(2026, 9, 29, 8, 0)).mealType).toBe("breakfast");
    expect(sheetItems(sheet)).toEqual([
      { canonical: "toast", measure: "serving", amount: 2 },
      { canonical: "eggs_scrambled", measure: "g", amount: 120 },
    ]);
    expect(sheetRows(sheet).map((r) => [r.name, r.estimated])).toEqual([["Toast", false], ["Eggs (scrambled)", true]]);
    expect(atScan(sheet)).toBe(true);
  });

  it("sends a food changed, taken off or added; the scan's own numbers stand only while it is as scanned", () => {
    const sheet = newSheet(ANALYSIS, NOW);
    const more = withRowAmount(sheet, "s1", { measure: "g", amount: "150" });
    expect(sheetRows(more)[1]?.estimated).toBe(false);
    expect(atScan(more)).toBe(false);
    const off = withRowAmount(sheet, "s0", null);
    expect(sheetItems(off)).toEqual([{ canonical: "eggs_scrambled", measure: "g", amount: 120 }]);
    expect(atScan(off)).toBe(false);
    const milk = withExtra(off, MILK, { measure: "g", amount: "240" });
    expect(sheetItems(milk)).toEqual([{ canonical: "eggs_scrambled", measure: "g", amount: 120 }, { canonical: "milk_whole", measure: "g", amount: 240 }]);
    expect(atScan(milk)).toBe(false);
    expect([...onSheet(milk)].sort()).toEqual(["eggs_scrambled", "milk_whole", "toast"]);
    expect(sheetItems(withRowAmount(milk, "x0", null))).toEqual([{ canonical: "eggs_scrambled", measure: "g", amount: 120 }]);
  });

  it("sends nothing while a food has no amount or no food is left", () => {
    const sheet = newSheet(ANALYSIS, NOW);
    expect(sheetItems(withRowAmount(sheet, "s0", { measure: "", amount: "2" }))).toBeNull();
    expect(sheetItems(withRowAmount(sheet, "s0", { measure: "g", amount: "" }))).toBeNull();
    expect(sheetItems(withRowAmount(withRowAmount(sheet, "s0", null), "s1", null))).toBeNull();
  });

  it("is kept and read back whole while it can still be saved, and never after", () => {
    const sheet = withExtra(newSheet(ANALYSIS, NOW), MILK, { measure: "g", amount: "240" });
    const text = sheetFileText(sheet);
    expect(readSheetFile(text, NOW)).toEqual(sheet);
    expect(sheetLeftMs(sheet, NOW)).toBe(MEAL_SCAN_SAVE_SECONDS * 1000);
    const nearlyGone = new Date(NOW.getTime() + MEAL_SCAN_SAVE_SECONDS * 1000 - 30_000);
    expect(readSheetFile(text, nearlyGone)).toBeNull();
    expect(readSheetFile(text, new Date(NOW.getTime() + 23 * 3600 * 1000))).toEqual(sheet);
    expect(readSheetFile("", NOW)).toBeNull();
    expect(readSheetFile("{", NOW)).toBeNull();
    expect(readSheetFile(JSON.stringify({ ...JSON.parse(text), amounts: [null] }), NOW)).toBeNull();
    expect(readSheetFile(JSON.stringify({ ...JSON.parse(text), version: 2 }), NOW)).toBeNull();
  });

  it("keeps the photo as it was sent, so it is shown when the meal is reopened; never one too large to keep", () => {
    const photo = toBase64(new Uint8Array(3000).fill(9));
    const sheet = newSheet(ANALYSIS, NOW, photo);
    expect(sheet.photo).toBe(photo);
    expect(readSheetFile(sheetFileText(sheet), NOW)?.photo).toBe(photo);
    expect(newSheet(ANALYSIS, NOW, "A".repeat(MEAL_PHOTO_KEPT_MOST + 4)).photo).toBeUndefined();
    expect(newSheet(ANALYSIS, NOW).photo).toBeUndefined();
    // A file whose photo is not base64 is not read.
    expect(readSheetFile(JSON.stringify({ ...JSON.parse(sheetFileText(sheet)), photo: "<script>" }), NOW)).toBeNull();
  });

  it("names the meal it saves to, and the meal's numbers in one line", () => {
    expect(saveWords("lunch")).toBe("Save to Lunch");
    expect(saveWords("snack")).toBe("Save to Snack");
    // Each number stays with its unit where the line wraps on a small phone.
    expect(totalsWords({ kcalPoint: 1846, kcalLow: 1800, kcalHigh: 1900, proteinG: 56.4, carbsG: 51, fatG: 47 })).toBe(
      "1,846 kcal · Protein 56 g · Carbs 51 g · Fat 47 g",
    );
  });
});

describe("a photo's meal kept on the phone is sent as the scan's save", () => {
  const body = { id: "0b5a5b1e-1d6a-4c1e-9b1a-2f5c3d4e5f60", mealName: "Toast and eggs", takenAt: "2026-10-29T12:05:00.000Z", mealType: "lunch" as const, items: [{ canonical: "toast", measure: "serving", amount: 2 }] };
  const waiting: WaitingMeal = { id: body.id, body, items: null, totals: null, tried: false };
  it("with its scan and without its name, which the server keeps from the scan", () => {
    expect(saveBody({ ...waiting, scanToken: TOKEN })).toEqual({ id: body.id, takenAt: body.takenAt, mealType: "lunch", items: body.items, scanToken: TOKEN });
  });
  it("and a typed meal as typed", () => {
    expect(saveBody(waiting)).toBe(body);
  });
});
