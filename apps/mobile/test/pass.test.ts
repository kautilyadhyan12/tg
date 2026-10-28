// The pass as a code, and when the next is asked for. The browser's own tests read its drawn code back
// with the desk's reader (apps/web/src/components/gym/checkinPassView.test.js); the phone draws the
// very same cells, so what the desk reads off the browser it reads off the phone.
import { describe, expect, it } from "vitest";
import { passSide } from "../src/look/sizing";
import { PASS_GOOD_MS, PASS_QUIET_CELLS, nextPassDelayMs, passCells, passPath } from "../src/screens/gym/passView";

// The browser's file is JavaScript, with no types: it is read when the tests run.
const BROWSER_VIEW = "../../web/src/components/gym/checkinPassView.js";
const browser: unknown = await import(BROWSER_VIEW);
function browserCells(pass: string): unknown {
  if (typeof browser !== "object" || browser === null || !("passCells" in browser) || typeof browser.passCells !== "function") {
    throw new Error("the browser's passCells was expected");
  }
  return (browser.passCells as (pass: string) => unknown)(pass);
}

// Passes made by the server's own `makePass` (apps/api, 2026-10-03), the browser test's own.
const REAL_PASSES = [
  "AHGPLG763ESHTVB2ZAG44DJVO6OZTIBY55AU7C4WIZRMWOB6SNIWULCDANFKYI",
  "AHGPRB32WCZWQNH5DPF72VQT4RBYDABY55AVGD2T7324JFIASG2F7CA45QCLBQ",
  "AHGPLIQVH3B3TFBQRGYIT4QBSLEYBABY55AWLYH5DPJHU5IYRWH74YHME353JM",
];

describe("the pass as a code", () => {
  it.each(REAL_PASSES)("a real pass is drawn cell for cell as the browser draws it: %s", (pass) => {
    const cells = passCells(pass);
    expect(cells).not.toBeNull();
    expect(cells).toEqual(browserCells(pass));
  });

  it("two passes one letter apart are two different codes", () => {
    const a = REAL_PASSES[0] ?? "";
    const b = `${a.slice(0, -1)}${a.endsWith("A") ? "B" : "A"}`;
    expect(passPath(passCells(a) ?? [])).not.toBe(passPath(passCells(b) ?? []));
  });

  it("is square, 33 cells a side at a quarter spare, drawn inside its white border", () => {
    const cells = passCells(REAL_PASSES[1] ?? "") ?? [];
    expect(cells).toHaveLength(33);
    expect(cells.every((row) => row.length === 33)).toBe(true);
    // The top-left corner's finder starts after the four white cells.
    expect(passPath(cells).startsWith(`M${String(PASS_QUIET_CELLS)} ${String(PASS_QUIET_CELLS)}h1v1h-1z`)).toBe(true);
  });

  it.each(["", "ahgp1234", "AHGP-1234", "AHGP 1234"])("what is not a pass draws nothing: %j", (pass) => {
    expect(passCells(pass)).toBeNull();
  });
});

describe("when the next pass is asked for", () => {
  const now = Date.parse("2026-10-28T10:00:10.000Z");
  it.each([
    ["the window's end, 20 s away", "2026-10-28T10:00:30.000Z", 20_000],
    ["never sooner than 7 s, with the end a moment away", "2026-10-28T10:00:11.000Z", 7_000],
    ["never sooner than 7 s, with the end past (a clock ahead)", "2026-10-28T09:59:00.000Z", 7_000],
    ["never later than 25 s (a clock behind)", "2026-10-28T10:05:00.000Z", 25_000],
    ["25 s when the time cannot be read", "soon", 25_000],
  ])("%s", (_name, refreshAt, wait) => {
    expect(nextPassDelayMs(refreshAt, now)).toBe(wait);
  });

  it("a pass stays up 30 seconds at most, and the next is asked for 5 seconds before", () => {
    expect(PASS_GOOD_MS).toBe(30_000);
    expect(nextPassDelayMs("2026-10-28T11:00:00.000Z", now)).toBe(PASS_GOOD_MS - 5_000);
  });
});

// Screen shapes in the phone's own points (dp), width by height.
describe("the pass's code on phones of every size", () => {
  it.each([
    ["a phone like Kd's", 412, 915, 380],
    ["a small phone", 360, 760, 328],
  ])("%s: the sheet's whole width", (_name, width, height, side) => {
    expect(passSide(width, height, 16)).toBe(side);
  });

  it.each([
    ["a folding phone opened", 690, 829, 415],
    ["a phone on its side", 915, 412, 206],
  ])("%s: at most half the screen's height, so its words stay on screen", (_name, width, height, side) => {
    expect(passSide(width, height, 16)).toBe(side);
  });
});
