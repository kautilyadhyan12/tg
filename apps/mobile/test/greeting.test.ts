import { describe, expect, it } from "vitest";
import { greetingAt } from "../src/screens/greeting";

describe("the Dashboard's greeting, by the hour on the person's clock", () => {
  it.each([
    [0, "Good morning"],
    [5, "Good morning"],
    [11, "Good morning"],
    [12, "Good afternoon"],
    [16, "Good afternoon"],
    [17, "Good evening"],
    [23, "Good evening"],
  ])("at %i it says %s", (hour, words) => {
    expect(greetingAt(hour)).toBe(words);
  });
});
