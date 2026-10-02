// The check-in pass (spec Part 3 §12.2): signed, one 30-second window and the next, and
// nothing but its own key's passes read as fresh.
import { describe, expect, it } from "vitest";
import { CHECKIN_PASS_LENGTH, checkinPassResponseSchema } from "@app/shared";
import { looksLikePass, makePass, passWindow, readPass, windowEndsAt } from "../src/modules/orgs/checkin/pass.js";

const KEY = Buffer.from("test-checkin-pass-key-0123456789abcdef", "utf8"); // dummy test value, gitleaks:allow
const OTHER_KEY = Buffer.from("another-checkin-pass-key-0123456789ab", "utf8"); // dummy test value, gitleaks:allow
const RIYA = "0b6f2c1e-8d4a-4c3b-9e2f-7a1b5c6d8e90";
const ARJUN = "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b";
const NOW = 59_000_000;

/** One letter of the pass changed to another letter of the alphabet. */
const flip = (pass: string, index: number): string => {
  const char = pass.charAt(index);
  return pass.slice(0, index) + (char === "A" ? "B" : "A") + pass.slice(index + 1);
};

describe("the check-in pass", () => {
  it("is 62 capital letters and digits starting AHGP, so a QR packs it small and any scanner types it", () => {
    const pass = makePass(KEY, RIYA, NOW);
    expect(pass).toHaveLength(CHECKIN_PASS_LENGTH);
    expect(pass).toMatch(/^AHGP[A-Z2-7]{58}$/);
    expect(looksLikePass(pass)).toBe(true);
    expect(checkinPassResponseSchema.parse({ pass, refreshAt: windowEndsAt(NOW).toISOString() }).pass).toBe(pass);
  });

  it("reads back the person it was made for, in its own window and the next", () => {
    const pass = makePass(KEY, RIYA, NOW);
    expect(readPass(KEY, pass, NOW)).toEqual({ kind: "fresh", userId: RIYA, window: NOW });
    expect(readPass(KEY, pass, NOW + 1)).toEqual({ kind: "fresh", userId: RIYA, window: NOW });
  });

  it("is old two windows later, and a window that has not come yet is old too", () => {
    expect(readPass(KEY, makePass(KEY, RIYA, NOW), NOW + 2)).toEqual({ kind: "old" });
    expect(readPass(KEY, makePass(KEY, RIYA, NOW + 1), NOW)).toEqual({ kind: "old" });
  });

  it("another key's pass, or any one letter changed, is garbled — never somebody else", () => {
    const pass = makePass(KEY, RIYA, NOW);
    expect(readPass(OTHER_KEY, pass, NOW)).toEqual({ kind: "garbled" });
    for (let index = 4; index < pass.length; index++) {
      expect(readPass(KEY, flip(pass, index), NOW)).toEqual({ kind: "garbled" });
    }
  });

  it("Riya's pass with Arjun's id put in its place is garbled", () => {
    const riya = makePass(KEY, RIYA, NOW);
    const arjun = makePass(KEY, ARJUN, NOW);
    // The first 25 letters after AHGP carry the id (16 bytes is 25.6 letters).
    const spliced = arjun.slice(0, 4 + 25) + riya.slice(4 + 25);
    expect(readPass(KEY, spliced, NOW)).toEqual({ kind: "garbled" });
  });

  it("a scanner's cut-short, lengthened, or foreign reading is garbled", () => {
    const pass = makePass(KEY, RIYA, NOW);
    expect(readPass(KEY, pass.slice(0, -1), NOW)).toEqual({ kind: "garbled" });
    expect(readPass(KEY, `${pass}A`, NOW)).toEqual({ kind: "garbled" });
    expect(readPass(KEY, `${pass.slice(0, -1)}1`, NOW)).toEqual({ kind: "garbled" });
    expect(readPass(KEY, `AHGP${"A".repeat(58)}`, NOW)).toEqual({ kind: "garbled" });
  });

  it("has one spelling: the last letter's spare bits must be zero", () => {
    const pass = makePass(KEY, RIYA, NOW);
    const last = pass.charAt(pass.length - 1);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const twin = alphabet.charAt(alphabet.indexOf(last) + 1);
    expect(readPass(KEY, pass.slice(0, -1) + twin, NOW)).toEqual({ kind: "garbled" });
  });

  it("reads with Caps Lock on: lower case is the same pass", () => {
    const pass = makePass(KEY, RIYA, NOW);
    expect(looksLikePass(pass.toLowerCase())).toBe(true);
    expect(readPass(KEY, pass.toLowerCase(), NOW)).toEqual({ kind: "fresh", userId: RIYA, window: NOW });
  });

  it("a member number is not a pass", () => {
    expect(looksLikePass("100245")).toBe(false);
    expect(looksLikePass("GM-0042")).toBe(false);
  });

  it("a window is 30 seconds and ends where the next begins", () => {
    const now = new Date("2026-10-02T06:02:10.000Z");
    const window = passWindow(now);
    expect(passWindow(new Date(now.getTime() + 30_000))).toBe(window + 1);
    expect(windowEndsAt(window).getTime() - now.getTime()).toBeGreaterThan(0);
    expect(windowEndsAt(window).getTime() - now.getTime()).toBeLessThanOrEqual(30_000);
    expect(passWindow(windowEndsAt(window))).toBe(window + 1);
  });
});
