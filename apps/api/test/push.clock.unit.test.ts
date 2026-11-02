// Whose clock decides night for a phone notification (ROADMAP Stage 5 item 18b-i): the person's own
// zone when the phone told it, else the gym's; a zone that cannot be read is no clock at all.
import { describe, expect, it } from "vitest";
import { hourIn, localHour } from "../src/modules/push/sweep.js";

// 2026-07-01 06:30 UTC (summer in New York) and 2026-12-01 06:30 UTC (winter).
const SUMMER = new Date("2026-07-01T06:30:00Z");
const WINTER = new Date("2026-12-01T06:30:00Z");

describe("hourIn", () => {
  it.each([
    ["Asia/Kolkata", SUMMER, 12],
    ["America/New_York", SUMMER, 2],
    ["America/New_York", WINTER, 1],
    ["Europe/London", SUMMER, 7],
    ["UTC", WINTER, 6],
    ["Not/AZone", SUMMER, null],
    ["", SUMMER, null],
    ["   ", SUMMER, null],
    [null, SUMMER, null],
  ])("%s at %s → %s", (zone, at, hour) => {
    expect(hourIn(zone, at)).toBe(hour);
  });
});

describe("localHour", () => {
  it("the person's zone first, the gym's when the person's is missing or cannot be read", () => {
    expect(localHour("America/New_York", "Asia/Kolkata", SUMMER)).toBe(2);
    expect(localHour(null, "Asia/Kolkata", SUMMER)).toBe(12);
    expect(localHour("Mars/Base", "Asia/Kolkata", SUMMER)).toBe(12);
    expect(localHour(null, "Not/AZone", SUMMER)).toBeNull();
  });
});
