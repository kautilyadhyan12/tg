// The check-in pass (spec Part 3 §12.2): signed, one 30-second window and the next, and
// nothing but its own key's passes read as fresh.
import { describe, expect, it } from "vitest";
import { CHECKIN_PASS_LENGTH, checkinPassResponseSchema } from "@app/shared";
import {
  WINDOWS_A_DAY,
  looksLikePass,
  makePass,
  makePhonePass,
  passDay,
  passWindow,
  phoneMadeBy,
  phonePassKey,
  readPass,
  windowEndsAt,
} from "../src/modules/orgs/checkin/pass.js";

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

// A pass the phone makes with no signal (ROADMAP Stage 5 item 15c).
describe("a pass the phone makes with no signal", () => {
  const RIYAS_PHONE = "5d1c9a3e-2b7f-4e60-8c14-9f0a6b3d2e71";
  const RIYAS_OLD_PHONE = "8a2e4c6f-1d3b-4f57-9e08-2c4a6b8d0f13";
  const ARJUNS_PHONE = "3c5e7a9b-0d2f-4416-8b3d-5f7a9c1e3b20";
  const TODAY = passDay(NOW);
  const phoneKey = phonePassKey(KEY, RIYA, RIYAS_PHONE, TODAY);

  it("THE WORST THING: it reads only with a live sign-in of its own person, never another phone's or person's", () => {
    const pass = makePhonePass(phoneKey, RIYA, NOW);
    expect(readPass(KEY, pass, NOW, [RIYAS_PHONE])).toEqual({ kind: "fresh", userId: RIYA, window: NOW });
    // Signed out, or replaced by a newer phone: its sign-in is not live, so no key is tried.
    expect(readPass(KEY, pass, NOW, [])).toEqual({ kind: "garbled" });
    expect(readPass(KEY, pass, NOW, [RIYAS_OLD_PHONE])).toEqual({ kind: "garbled" });
    // Arjun's live phone does not make Riya's pass good.
    expect(readPass(KEY, pass, NOW, [ARJUNS_PHONE])).toEqual({ kind: "garbled" });
    // Riya's phone's key cannot make Arjun's pass: the key is derived from the person in the pass.
    const forged = makePhonePass(phoneKey, ARJUN, NOW);
    expect(phoneMadeBy(forged)).toBe(ARJUN);
    expect(readPass(KEY, forged, NOW, [RIYAS_PHONE])).toEqual({ kind: "garbled" });
    expect(readPass(KEY, forged, NOW, [ARJUNS_PHONE])).toEqual({ kind: "garbled" });
  });

  it("THE WORST THING: a pass made ahead with the phone's clock moved on is good only with that day's key, which the phone holds for today and tomorrow alone", () => {
    // A week ahead: the phone has no key for that day, and today's key does not make a pass for it.
    const weekAhead = NOW + 7 * WINDOWS_A_DAY;
    expect(readPass(KEY, makePhonePass(phoneKey, RIYA, weekAhead), weekAhead, [RIYAS_PHONE])).toEqual({ kind: "garbled" });
    // Tomorrow's own key makes tomorrow's pass, and only tomorrow's.
    const tomorrowsKey = phonePassKey(KEY, RIYA, RIYAS_PHONE, TODAY + 1);
    const tomorrow = (TODAY + 1) * WINDOWS_A_DAY + 100;
    expect(readPass(KEY, makePhonePass(tomorrowsKey, RIYA, tomorrow), tomorrow, [RIYAS_PHONE])).toEqual({
      kind: "fresh",
      userId: RIYA,
      window: tomorrow,
    });
    expect(readPass(KEY, makePhonePass(tomorrowsKey, RIYA, NOW), NOW, [RIYAS_PHONE])).toEqual({ kind: "garbled" });
  });

  it("across midnight each window is read with its own day's key", () => {
    const last = (TODAY + 1) * WINDOWS_A_DAY - 1;
    const first = last + 1;
    expect(passDay(first)).toBe(TODAY + 1);
    const lastPass = makePhonePass(phoneKey, RIYA, last);
    const firstPass = makePhonePass(phonePassKey(KEY, RIYA, RIYAS_PHONE, TODAY + 1), RIYA, first);
    expect(readPass(KEY, lastPass, first, [RIYAS_PHONE])).toEqual({ kind: "fresh", userId: RIYA, window: last });
    expect(readPass(KEY, firstPass, last, [RIYAS_PHONE])).toEqual({ kind: "fresh", userId: RIYA, window: first });
  });

  it("the server's key never reads as the phone's, nor the phone's key as the server's", () => {
    const server = makePass(KEY, RIYA, NOW);
    expect(phoneMadeBy(server)).toBeNull();
    // A pass the server signed with its top bit set is not a phone's pass.
    expect(readPass(KEY, makePhonePass(KEY, RIYA, NOW), NOW, [RIYAS_PHONE])).toEqual({ kind: "garbled" });
    // A phone's key on a pass that says the server made it.
    expect(readPass(KEY, makePass(phoneKey, RIYA, NOW), NOW, [RIYAS_PHONE])).toEqual({ kind: "garbled" });
  });

  it("is fresh in the window before its own, its own and the next, and old outside them", () => {
    const pass = makePhonePass(phoneKey, RIYA, NOW);
    expect(readPass(KEY, pass, NOW - 1, [RIYAS_PHONE])).toEqual({ kind: "fresh", userId: RIYA, window: NOW });
    expect(readPass(KEY, pass, NOW + 1, [RIYAS_PHONE])).toEqual({ kind: "fresh", userId: RIYA, window: NOW });
    expect(readPass(KEY, pass, NOW - 2, [RIYAS_PHONE])).toEqual({ kind: "old" });
    expect(readPass(KEY, pass, NOW + 2, [RIYAS_PHONE])).toEqual({ kind: "old" });
  });

  it("names the same window as the server's pass, so the two share its one use", () => {
    const read = readPass(KEY, makePhonePass(phoneKey, RIYA, NOW), NOW, [RIYAS_PHONE]);
    expect(read).toEqual(readPass(KEY, makePass(KEY, RIYA, NOW), NOW));
  });

  it("any one letter changed is garbled", () => {
    const pass = makePhonePass(phoneKey, RIYA, NOW);
    for (let index = 4; index < pass.length; index++) {
      expect(readPass(KEY, flip(pass, index), NOW, [RIYAS_PHONE])).toEqual({ kind: "garbled" });
    }
  });

  it("reads among several live sign-ins, whichever made it", () => {
    const pass = makePhonePass(phoneKey, RIYA, NOW);
    expect(readPass(KEY, pass, NOW, [RIYAS_OLD_PHONE, RIYAS_PHONE])).toEqual({ kind: "fresh", userId: RIYA, window: NOW });
  });

  it("is the phone's own: the same key and pass as `apps/mobile/test/phonePass.test.ts`", () => {
    expect(TODAY).toBe(20_486);
    expect(phoneKey.toString("base64url")).toBe("xtpsaxfmZP6_Zz-UOUee-3_RiCU70Cbvl8KMNtj8rNQ"); // dummy test value, gitleaks:allow
    expect(makePhonePass(phoneKey, RIYA, NOW)).toBe("AHGPBNXSYHUNJJGDXHRPPINVY3MOSCBYIRGAF3JPZDEIBNSNC6QQMGEZ6QC4ZU");
  });
});
