import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND, COPY_KEYS, configFor, copyFor } from "../app.config";
import { pixel, readPng, type Png } from "./png";

const root = join(__dirname, "..");
const read = (path: string): Png => readPng(join(root, path));
const NIGHT = [0x00, 0x00, 0x1b] as const;

/** No transparency at all: colour without alpha and no tRNS chunk (Apple refuses either). */
function expectOpaque(png: Png): void {
  expect(png.colourType).toBe(2);
  expect(png.chunks).not.toContain("tRNS");
}

/** Every pixel farther than `limit` of the width from the centre is the plain night colour. */
function plainBeyond(png: Png, limit: number): number {
  let off = 0;
  const c = png.width / 2;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (Math.hypot(x + 0.5 - c, y + 0.5 - c) / png.width <= limit) continue;
      const [r, g, b] = pixel(png, x, y);
      if (Math.abs(r - NIGHT[0]) > 6 || Math.abs(g - NIGHT[1]) > 6 || Math.abs(b - NIGHT[2]) > 6) off++;
    }
  }
  return off;
}

/** A one-colour shape: some pixels clear, every visible pixel white, and the farthest visible pixel from the centre. */
function whiteShape(png: Png): { clear: number; notWhite: number; reach: number; box: [number, number, number, number] } {
  let clear = 0;
  let notWhite = 0;
  let reach = 0;
  const box: [number, number, number, number] = [png.width, png.height, -1, -1];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const [r, g, b, a] = pixel(png, x, y);
      if (a === 0) {
        clear++;
        continue;
      }
      if (r < 250 || g < 250 || b < 250) notWhite++;
      reach = Math.max(reach, Math.hypot(x + 0.5 - png.width / 2, y + 0.5 - png.height / 2) / png.width);
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  }
  return { clear, notWhite, reach, box };
}

describe("the KWAZO wizard on the phone and in the stores", () => {
  it("the app icon is 1024 square with no transparency, as Apple and Google require", () => {
    for (const file of [BRAND.icon, BRAND.iosTinted]) {
      const png = read(file);
      expect([png.width, png.height]).toEqual([1024, 1024]);
      expectOpaque(png);
    }
  });

  it("Android's icon layer keeps everything inside the circle every maker's shape keeps (66 of 108)", () => {
    const png = read(BRAND.adaptiveForeground);
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expectOpaque(png);
    expect(plainBeyond(png, 0.306)).toBe(0);
    expect(BRAND.night).toBe("#00001B");
  });

  it("Android's themed icon is a white shape on clear, inside the same circle", () => {
    const png = read(BRAND.adaptiveMonochrome);
    expect([png.width, png.height, png.colourType]).toEqual([1024, 1024, 6]);
    const s = whiteShape(png);
    expect(s.clear).toBeGreaterThan(0);
    expect(s.notWhite).toBe(0);
    expect(s.reach).toBeLessThanOrEqual(0.306);
  });

  it("the opening screen is the wizard on the night colour, plain beyond Android's circle and iPhone's square", () => {
    const png = read(BRAND.splash);
    expect([png.width, png.height]).toEqual([1024, 1024]);
    expectOpaque(png);
    // Android 12+ keeps a 192 dp circle of the 240 dp picture: 0.40 of its width. Plain from 0.34 out.
    expect(plainBeyond(png, 0.34)).toBe(0);
    expect(plainBeyond(png, 0.0)).toBeGreaterThan(10000);
    const config = configFor(copyFor("feature1"));
    expect(config.plugins).toContainEqual([
      "expo-splash-screen",
      { image: BRAND.splash, backgroundColor: BRAND.night, imageWidth: 240, resizeMode: "contain" },
    ]);
  });

  it("the notification icon is a white shape on clear inside Android's 80 of 96, never a grey square", () => {
    const png = read(BRAND.notificationIcon);
    expect([png.width, png.height, png.colourType]).toEqual([96, 96, 6]);
    const s = whiteShape(png);
    expect(s.clear).toBeGreaterThan(96 * 96 * 0.3);
    expect(s.notWhite).toBe(0);
    const [x0, y0, x1, y1] = s.box;
    expect(Math.min(x0, y0)).toBeGreaterThanOrEqual(8);
    expect(Math.max(x1, y1)).toBeLessThanOrEqual(87);
  });

  it("the store pictures are at the sizes Google Play and the App Store ask for, without transparency", () => {
    for (const [file, w, h] of [["store/play-icon-512.png", 512, 512], ["store/play-feature-1024x500.png", 1024, 500], ["store/app-store-1024.png", 1024, 1024]] as const) {
      const png = read(file);
      expect([png.width, png.height], file).toEqual([w, h]);
      expectOpaque(png);
    }
  });

  it.each(COPY_KEYS)("the %s copy of the app is built with the wizard", (key) => {
    const config = configFor(copyFor(key));
    expect(config.icon).toBe(BRAND.icon);
    expect(config.ios?.icon).toEqual({ light: BRAND.icon, dark: BRAND.icon, tinted: BRAND.iosTinted });
    expect(config.android?.adaptiveIcon).toEqual({
      foregroundImage: BRAND.adaptiveForeground,
      backgroundColor: BRAND.night,
      monochromeImage: BRAND.adaptiveMonochrome,
    });
    expect(config.plugins).toContainEqual(["expo-notifications", { icon: BRAND.notificationIcon, color: BRAND.violet }]);
    for (const file of [BRAND.icon, BRAND.iosTinted, BRAND.adaptiveForeground, BRAND.adaptiveMonochrome, BRAND.notificationIcon, BRAND.splash]) {
      expect(existsSync(join(root, file)), file).toBe(true);
    }
  });
});
