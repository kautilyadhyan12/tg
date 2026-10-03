// THE DESK DEVICE'S COOKIE (`deviceKey.ts`): the server's mark on a key decides only how a
// scan is counted, and nobody else can make it.
import { describe, expect, it } from "vitest";
import { deviceCookieValue, deviceLimitId, readDeviceCookie } from "../src/modules/orgs/checkin/deviceKey.js";

const SECRET = Buffer.from("device-key-unit-secret-0123456789abcdef", "utf8"); // dummy test value, gitleaks:allow
const OTHER = Buffer.from("another-device-key-secret-0123456789abcd", "utf8"); // dummy test value, gitleaks:allow
const KEY = "k".repeat(43);

describe("the desk device's cookie", () => {
  it("carries the key and a mark that verifies", () => {
    const cookie = deviceCookieValue(SECRET, KEY);
    expect(cookie).toMatch(/^k{43}\.[A-Za-z0-9_-]{22}$/);
    expect(readDeviceCookie(SECRET, cookie)).toEqual({ key: KEY, marked: true });
  });

  it.each([
    ["no mark: a desk set up before the mark", KEY, { key: KEY, marked: false }],
    ["another server's mark", deviceCookieValue(OTHER, KEY), { key: KEY, marked: false }],
    ["another key's mark", `${KEY}.${deviceCookieValue(SECRET, "j".repeat(43)).slice(44)}`, { key: KEY, marked: false }],
    ["a mark cut short", deviceCookieValue(SECRET, KEY).slice(0, -1), { key: KEY, marked: false }],
    ["an empty mark", `${KEY}.`, { key: KEY, marked: false }],
    ["a key too short", "k".repeat(42), null],
    ["a key with a character no key has", `${"k".repeat(42)}!`, null],
    ["nothing", "", null],
    ["no cookie", undefined, null],
  ])("%s", (_what, raw, read) => {
    expect(readDeviceCookie(SECRET, raw)).toEqual(read);
  });

  it("names a device for a rate limit by its key's hash, never the key", () => {
    const id = deviceLimitId(KEY);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain("kkkk");
    expect(deviceLimitId("j".repeat(43))).not.toBe(id);
  });
});
