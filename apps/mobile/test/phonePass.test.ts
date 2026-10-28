// A pass the phone makes with no signal (ROADMAP Stage 5 item 15c): the same pass the server's own
// `makePhonePass` makes, so the desk takes it.
import { describe, expect, it } from "vitest";
import { CHECKIN_PASS_LENGTH } from "@app/shared";
import { makePhonePass, phoneWindow, untilNextWindowMs } from "../src/screens/gym/phonePass";
import { passCells } from "../src/screens/gym/passView";

const RIYA = "0b6f2c1e-8d4a-4c3b-9e2f-7a1b5c6d8e90";
// The key and the pass of `apps/api/test/checkin.pass.unit.test.ts`, made by the server.
const KEY = "6kk2P5Zj8znws7IlJEBdalqwCFQdAxL2lgYYZUO3B6Q"; // dummy test value, gitleaks:allow
const SERVERS_PASS = "AHGPBNXSYHUNJJGDXHRPPINVY3MOSCBYIRGA7RUBX36QQGXAG4EUIIT26HXPAE";
const WINDOW = 59_000_000;
const AT = WINDOW * 30_000;

describe("a pass the phone makes with no signal", () => {
  it("is the very pass the server makes with the same key, person and window", () => {
    expect(makePhonePass(KEY, RIYA, AT)).toBe(SERVERS_PASS);
    expect(makePhonePass(KEY, RIYA, AT + 29_999)).toBe(SERVERS_PASS);
    expect(makePhonePass(KEY, RIYA.toUpperCase(), AT)).toBe(SERVERS_PASS);
  });

  it("is new in the next window, and is a pass the code draws", () => {
    const next = makePhonePass(KEY, RIYA, AT + 30_000);
    expect(next).not.toBe(SERVERS_PASS);
    expect(next).toHaveLength(CHECKIN_PASS_LENGTH);
    expect(passCells(next ?? "")).not.toBeNull();
  });

  it("another person's pass, or another key's, is a different pass", () => {
    expect(makePhonePass(KEY, "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b", AT)).not.toBe(SERVERS_PASS); // dummy test value, gitleaks:allow
    expect(makePhonePass(`A${KEY.slice(1)}`, RIYA, AT)).not.toBe(SERVERS_PASS);
  });

  it.each([
    ["a key cut short", KEY.slice(1), RIYA, AT],
    ["a key that is not base64url", `${KEY.slice(1)}=`, RIYA, AT],
    ["no key", "", RIYA, AT],
    ["a person who is not an id", KEY, "riya", AT],
    ["a time that cannot be read", KEY, RIYA, Number.NaN],
    ["a time before 1970", KEY, RIYA, -1],
  ])("draws nothing with %s", (_name, key, user, now) => {
    expect(makePhonePass(key, user, now)).toBeNull();
  });

  it("counts windows as the server does, and says when the next begins", () => {
    expect(phoneWindow(AT)).toBe(WINDOW);
    expect(phoneWindow(AT - 1)).toBe(WINDOW - 1);
    expect(untilNextWindowMs(AT)).toBe(30_000);
    expect(untilNextWindowMs(AT + 29_000)).toBe(1_000);
  });
});
