// An indoor run's words (37q-ii-a): where its distance is from, what is read from the Treadmill distance box, and what the
// box says of it, as the server judges the number (`treadmillTaken`).
import { describe, expect, it } from "vitest";
import { treadmillTaken } from "@app/shared";
import { indoorFromWords, treadmillWords, typedMetres } from "../src/screens/running/indoorWords";

describe("what is read from the Treadmill distance box", () => {
  // As people type what a treadmill's screen shows: its two places, a comma where their phone's keyboard gives one.
  it.each([
    ["5.2", "metric", 5200],
    ["5.20", "metric", 5200],
    ["5,20", "metric", 5200],
    [" 3.1 ", "metric", 3100],
    ["10", "metric", 10_000],
    [".8", "metric", 800],
    ["3.11", "imperial", 5006],
    ["1", "imperial", 1610],
  ] as const)("%s in %s is %d m", (typed, units, metres) => {
    expect(typedMetres(typed, units)).toBe(metres);
  });

  it.each(["", " ", ".", "0", "0.00", "-3", "abc", "5.2km", "1e3", "5..2", "12345", "5.2.1"])("%j is no distance", (typed) => {
    expect(typedMetres(typed, "metric")).toBeNull();
  });
});

describe("what the box says, as the server judges the number", () => {
  const run = { stepsM: 4116, movingS: 1800, units: "metric" as const };
  const look = (typedM: number | null) => treadmillWords({ ...run, typedM, taken: treadmillTaken(typedM, run.movingS, run.stepsM) });

  it("nothing typed, nothing said", () => {
    expect(look(null)).toBeNull();
  });

  it("taken: the run's distance, and what the steps had said", () => {
    expect(look(4500)).toEqual({ text: "Your run is 4.50 km, from the treadmill. Your steps said 4.11 km.", good: true });
  });

  it("54 typed for 5.4 in thirty minutes: faster than anyone, and the run keeps its steps' distance", () => {
    expect(look(54_000)).toEqual({ text: "That's faster than anyone has run. Your run keeps 4.11 km.", good: false });
  });

  it("far under the steps: a third or less", () => {
    expect(look(1000)).toEqual({ text: "That's far less than your steps show. Your run keeps 4.11 km.", good: false });
  });

  it("far over the steps at a speed somebody could run: three times or more", () => {
    const slow = { stepsM: 1354, movingS: 1800, units: "metric" as const };
    expect(treadmillWords({ ...slow, typedM: 5000, taken: treadmillTaken(5000, slow.movingS, slow.stepsM) })).toEqual({
      text: "That's far more than your steps show. Your run keeps 1.35 km.",
      good: false,
    });
  });

  it("a phone that counted no step: the typed distance is taken by the time alone, and no steps' distance is named", () => {
    expect(treadmillWords({ typedM: 5000, taken: treadmillTaken(5000, 1800, 0), stepsM: 0, movingS: 1800, units: "metric" })).toEqual({
      text: "Your run is 5.00 km, from the treadmill.",
      good: true,
    });
  });

  it("in miles: what was typed reads back as typed, every hundredth of a mile from 0.01 to 30", () => {
    expect(treadmillWords({ typedM: typedMetres("3.11", "imperial"), taken: true, stepsM: 4116, movingS: 1800, units: "imperial" })?.text).toBe(
      "Your run is 3.11 mi, from the treadmill. Your steps said 2.55 mi.",
    );
    for (const units of ["imperial", "metric"] as const) {
      for (let h = 1; h <= 3000; h++) {
        const typed = (h / 100).toFixed(2);
        expect(treadmillWords({ typedM: typedMetres(typed, units), taken: true, stepsM: 0, movingS: 1800, units })?.text).toBe(
          `Your run is ${typed} ${units === "imperial" ? "mi" : "km"}, from the treadmill.`,
        );
      }
    }
  });
});

describe("the line under an indoor run's distance", () => {
  it.each([
    ["treadmill", 5066, false, "Indoor · from the treadmill"],
    ["steps", 5066, false, "Indoor · from your steps"],
    ["steps", 0, false, "Indoor · no steps counted"],
    ["steps", 0, true, "Indoor · no steps counted"],
    ["treadmill", 0, true, "Indoor · from the treadmill"],
  ] as const)("from %s with %d steps (off: %s): %s", (from, steps, off, words) => {
    expect(indoorFromWords(from, steps, off)).toBe(words);
  });
});
