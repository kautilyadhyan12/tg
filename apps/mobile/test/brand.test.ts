import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND, configFor, copyFor } from "../app.config";

const root = join(__dirname, "..");

/** Width, height and colour type from a PNG's header (2 = colour, no transparency; 6 = colour with transparency). */
function png(path: string): { width: number; height: number; colourType: number } {
  const b = readFileSync(join(root, path));
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colourType: b.readUInt8(25) };
}

describe("the KWAZO wizard on the phone and in the stores", () => {
  it("the app icon is 1024 square with no transparency, as Apple and Google require", () => {
    expect(png(BRAND.icon)).toEqual({ width: 1024, height: 1024, colourType: 2 });
    expect(png(BRAND.iosTinted)).toEqual({ width: 1024, height: 1024, colourType: 2 });
  });

  it("Android's icon layers are the same size, the themed one a shape on clear", () => {
    expect(png(BRAND.adaptiveForeground)).toEqual({ width: 1024, height: 1024, colourType: 2 });
    expect(png(BRAND.adaptiveMonochrome)).toMatchObject({ width: 1024, height: 1024, colourType: 6 });
  });

  it("the opening screen is the wizard on the night colour behind it, square so Android's circle keeps it all", () => {
    expect(png(BRAND.splash)).toEqual({ width: 1024, height: 1024, colourType: 2 });
    const config = configFor(copyFor("feature1"));
    expect(config.plugins).toContainEqual([
      "expo-splash-screen",
      { image: BRAND.splash, backgroundColor: BRAND.night, imageWidth: 240, resizeMode: "contain" },
    ]);
    expect(config.android?.adaptiveIcon?.backgroundColor).toBe(BRAND.night);
  });

  it("the notification icon is a small shape on clear, as Android draws it in one colour", () => {
    expect(png(BRAND.notificationIcon)).toMatchObject({ width: 96, height: 96, colourType: 6 });
  });

  it("the store pictures are at the sizes Google Play and the App Store ask for", () => {
    expect(png("store/play-icon-512.png")).toEqual({ width: 512, height: 512, colourType: 2 });
    expect(png("store/play-feature-1024x500.png")).toEqual({ width: 1024, height: 500, colourType: 2 });
    expect(png("store/app-store-1024.png")).toEqual({ width: 1024, height: 1024, colourType: 2 });
  });

  it("every copy of the app is built with the wizard", () => {
    const config = configFor(copyFor("feature1"));
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
