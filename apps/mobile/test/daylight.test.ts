// Light by day, dark at night (ROADMAP Stage 5 37b-i). The sun's rule is held to the U.S. Naval
// Observatory's published sunrise and sunset (fixtures/usno-sun.json, its source inside): two minutes
// either side of each, in India, North America, Australia and above the Arctic Circle.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RISEN_DEG, mapScheme, sunHeight } from "../src/screens/running/daylight";

type Day = { place: string; date: string; lat: number; lng: number; tz: number } & (
  | { rise: string; set: string }
  | { always: "up"; lowest: string }
  | { always: "down"; highest: string }
);

const days: Day[] = (JSON.parse(readFileSync(join(__dirname, "fixtures", "usno-sun.json"), "utf8")) as { days: Day[] }).days;

/** A local time on the day, as the moment it is everywhere. */
function moment(day: Day, hhmm: string, plusMin = 0): number {
  const [y, m, d] = day.date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, (mm ?? 0) + plusMin) - day.tz * 3_600_000;
}

/** The minute the sun crosses the horizon, searched a minute at a time from `from` for 3 hours. */
function crossing(day: Day, from: string, rising: boolean): number {
  const start = moment(day, from, -90);
  for (let i = 0; i <= 180; i++) {
    const up = sunHeight(day.lat, day.lng, start + i * 60_000) > RISEN_DEG;
    if (up === rising) return i - 90;
  }
  return Number.NaN;
}

describe("the sun's rising and setting", () => {
  for (const day of days) {
    if ("rise" in day) {
      it(`${day.place} on ${day.date}: risen 2 minutes after ${day.rise}, set 2 minutes after ${day.set}`, () => {
        expect(sunHeight(day.lat, day.lng, moment(day, day.rise, -2))).toBeLessThan(RISEN_DEG);
        expect(sunHeight(day.lat, day.lng, moment(day, day.rise, 2))).toBeGreaterThan(RISEN_DEG);
        expect(sunHeight(day.lat, day.lng, moment(day, day.set, -2))).toBeGreaterThan(RISEN_DEG);
        expect(sunHeight(day.lat, day.lng, moment(day, day.set, 2))).toBeLessThan(RISEN_DEG);
        // Within a minute of the almanac's own minute, both ends of the day.
        expect(Math.abs(crossing(day, day.rise, true))).toBeLessThanOrEqual(1);
        expect(Math.abs(crossing(day, day.set, false))).toBeLessThanOrEqual(1);
      });
    } else if (day.always === "up") {
      it(`${day.place} on ${day.date}: the midnight sun is still up at its lowest, ${day.lowest}`, () => {
        expect(sunHeight(day.lat, day.lng, moment(day, day.lowest))).toBeGreaterThan(RISEN_DEG);
      });
    } else {
      it(`${day.place} on ${day.date}: the polar night is still dark at noon, ${day.highest}`, () => {
        expect(sunHeight(day.lat, day.lng, moment(day, day.highest))).toBeLessThan(RISEN_DEG);
      });
    }
  }
});

describe("which map is drawn", () => {
  const jorhat: [number, number] = [26.7509, 94.2037];
  const noon = Date.UTC(2026, 10, 6, 6, 30); // 12:00 in Jorhat
  const night = Date.UTC(2026, 10, 6, 15, 30); // 21:00 in Jorhat
  it("follows the sun where the person is on Automatic", () => {
    expect(mapScheme("auto", jorhat, noon, 12)).toBe("light");
    expect(mapScheme("auto", jorhat, night, 21)).toBe("dark");
    // The phone's own clock says nothing once the place is known: noon in Jorhat is night in New York.
    expect(mapScheme("auto", [40.7128, -74.006], noon, 12)).toBe("dark");
  });
  it("keeps the person's own choice whatever the sun", () => {
    expect(mapScheme("light", jorhat, night, 21)).toBe("light");
    expect(mapScheme("dark", jorhat, noon, 12)).toBe("dark");
  });
  it("goes by the phone's clock, 6 am to 6 pm, before any place is known", () => {
    expect([5, 6, 12, 17, 18, 23].map((h) => mapScheme("auto", null, noon, h))).toEqual(["dark", "light", "light", "light", "dark", "dark"]);
  });
});
