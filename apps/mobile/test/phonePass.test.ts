// A pass the phone makes with no signal (ROADMAP Stage 5 item 15c): the same pass the server's own
// `makePhonePass` makes, so the desk takes it.
import { describe, expect, it } from "vitest";
import { CHECKIN_PASS_LENGTH } from "@app/shared";
import { makePhonePass, phoneDay, phoneWindow, untilNextWindowMs } from "../src/screens/gym/phonePass";
import { passCells } from "../src/screens/gym/passView";

const RIYA = "0b6f2c1e-8d4a-4c3b-9e2f-7a1b5c6d8e90";
const WINDOW = 59_000_000;
const AT = WINDOW * 30_000;
const DAY = 20_486;
// The key and the pass of `apps/api/test/checkin.pass.unit.test.ts`, made by the server for that day.
const KEY = "xtpsaxfmZP6_Zz-UOUee-3_RiCU70Cbvl8KMNtj8rNQ"; // dummy test value, gitleaks:allow
const SERVERS_PASS = "AHGPBNXSYHUNJJGDXHRPPINVY3MOSCBYIRGAF3JPZDEIBNSNC6QQMGEZ6QC4ZU";
const KEYS = [{ day: DAY, key: KEY }];

describe("a pass the phone makes with no signal", () => {
  it("is the very pass the server makes with the same key, person and window", () => {
    expect(phoneDay(AT)).toBe(DAY);
    expect(makePhonePass(KEYS, RIYA, AT)).toBe(SERVERS_PASS);
    expect(makePhonePass(KEYS, RIYA, AT + 29_999)).toBe(SERVERS_PASS);
    expect(makePhonePass(KEYS, RIYA.toUpperCase(), AT)).toBe(SERVERS_PASS);
    // Tomorrow's key held beside it changes nothing today.
    expect(makePhonePass([{ day: DAY + 1, key: `A${KEY.slice(1)}` }, ...KEYS], RIYA, AT)).toBe(SERVERS_PASS);
  });

  it("is new in the next window, and is a pass the code draws", () => {
    const next = makePhonePass(KEYS, RIYA, AT + 30_000);
    expect(next).not.toBe(SERVERS_PASS);
    expect(next).toHaveLength(CHECKIN_PASS_LENGTH);
    expect(passCells(next ?? "")).not.toBeNull();
  });

  it("THE WORST THING: with no key for the day, nothing is drawn, so a pass cannot be made ahead past the keys it holds", () => {
    const nextDay = (DAY + 1) * 86_400_000;
    expect(makePhonePass(KEYS, RIYA, nextDay)).toBeNull();
    expect(makePhonePass(KEYS, RIYA, nextDay + 7 * 86_400_000)).toBeNull();
    expect(makePhonePass(KEYS, RIYA, DAY * 86_400_000 - 1)).toBeNull();
    // Tomorrow's key makes tomorrow's pass, signed with it and not today's.
    const tomorrows = makePhonePass([{ day: DAY + 1, key: KEY }], RIYA, nextDay);
    expect(tomorrows).not.toBeNull();
    expect(tomorrows).not.toBe(makePhonePass(KEYS, RIYA, nextDay - 1));
  });

  it("another person's pass, or another key's, is a different pass", () => {
    expect(makePhonePass(KEYS, "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b", AT)).not.toBe(SERVERS_PASS); // dummy test value, gitleaks:allow
    expect(makePhonePass([{ day: DAY, key: `A${KEY.slice(1)}` }], RIYA, AT)).not.toBe(SERVERS_PASS);
  });

  it.each([
    ["a key cut short", [{ day: DAY, key: KEY.slice(1) }], RIYA, AT],
    ["a key that is not base64url", [{ day: DAY, key: `${KEY.slice(1)}=` }], RIYA, AT],
    ["no keys", [], RIYA, AT],
    ["a person who is not an id", KEYS, "riya", AT],
    ["a time that cannot be read", KEYS, RIYA, Number.NaN],
    ["a time before 1970", KEYS, RIYA, -1],
  ])("draws nothing with %s", (_name, keys, user, now) => {
    expect(makePhonePass(keys, user, now)).toBeNull();
  });

  it("counts windows and days as the server does, and says when the next window begins", () => {
    expect(phoneWindow(AT)).toBe(WINDOW);
    expect(phoneWindow(AT - 1)).toBe(WINDOW - 1);
    expect(phoneDay(DAY * 86_400_000)).toBe(DAY);
    expect(phoneDay(DAY * 86_400_000 - 1)).toBe(DAY - 1);
    expect(untilNextWindowMs(AT)).toBe(30_000);
    expect(untilNextWindowMs(AT + 29_000)).toBe(1_000);
  });
});
