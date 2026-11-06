// The map the phones draw runs on (ROADMAP Stage 5 37b-i): which one the server says, and the
// settings it refuses at start. No database.
import { describe, expect, it } from "vitest";
import { OPENFREEMAP, mapSourceSchema } from "@app/shared";
import { loadConfig } from "../src/config.js";
import { mapSourceFor } from "../src/modules/geo/mapSource.js";

const base = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://x:y@localhost:5432/z",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "map-unit-test-secret-0123456789abcdef", // gitleaks:allow
};
const FILE = "https://maps.example.org/world.pmtiles";
const GLYPHS = "https://maps.example.org/fonts/{fontstack}/{range}.pbf";

describe("the map the server tells the phones to draw", () => {
  it("is OpenFreeMap's unless the server is switched", () => {
    expect(mapSourceFor(loadConfig(base))).toEqual(OPENFREEMAP);
  });

  it("is our own copy of Protomaps' world file once MAP_SOURCE is protomaps", () => {
    const config = loadConfig({ ...base, MAP_SOURCE: "protomaps", MAP_PROTOMAPS_FILE: FILE, MAP_PROTOMAPS_GLYPHS: GLYPHS });
    expect(mapSourceFor(config)).toEqual({ maker: "protomaps", tiles: `pmtiles://${FILE}`, glyphs: GLYPHS, sprite: null, credit: "Protomaps © OpenStreetMap" });
  });

  it("refuses to start switched with no file, with letters that are not a pattern, or on http in production", () => {
    expect(() => loadConfig({ ...base, MAP_SOURCE: "protomaps" })).toThrow(/MAP_PROTOMAPS_FILE/);
    expect(() => loadConfig({ ...base, MAP_SOURCE: "protomaps", MAP_PROTOMAPS_FILE: FILE, MAP_PROTOMAPS_GLYPHS: "https://maps.example.org/fonts.pbf" })).toThrow(/fontstack/);
    expect(() => loadConfig({ ...base, MAP_PROTOMAPS_FILE: "https://maps.example.org/world.mbtiles" })).toThrow(/pmtiles/);
    expect(() => loadConfig({ ...base, MAP_SOURCE: "openfreemap-ish" })).toThrow(/MAP_SOURCE/);
    const insecure = { ...base, MAP_SOURCE: "protomaps", MAP_PROTOMAPS_FILE: "http://maps.example.org/world.pmtiles", MAP_PROTOMAPS_GLYPHS: GLYPHS };
    expect(() => loadConfig(insecure)).not.toThrow();
    expect(() => loadConfig({ ...insecure, NODE_ENV: "production" })).toThrow(/https/);
  });

  it("is read by the phone only when every address is a plain web address", () => {
    expect(mapSourceSchema.safeParse(OPENFREEMAP).success).toBe(true);
    for (const tiles of ["javascript:alert(1)", "file:///sdcard/x.pmtiles", "https://x.org/a b", 'https://x.org/"a', "asset://world.pmtiles", ""]) {
      expect(mapSourceSchema.safeParse({ ...OPENFREEMAP, tiles }).success).toBe(false);
    }
    expect(mapSourceSchema.safeParse({ ...OPENFREEMAP, glyphs: "https://x.org/fonts.pbf" }).success).toBe(false);
    expect(mapSourceSchema.safeParse({ ...OPENFREEMAP, credit: "" }).success).toBe(false);
  });
});
