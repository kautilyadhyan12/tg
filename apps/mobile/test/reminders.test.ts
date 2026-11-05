// Your training's reminders on the phone (ROADMAP Stage 5 item 19e-i): the words and the time box's sums.
import { describe, expect, it } from "vitest";
import { clockWords, daysWords, reminderLine, timeWheels, wheelTime } from "../src/screens/remindersView";

describe("the reminders' words", () => {
  it.each([
    ["00:00", "12:00 AM"],
    ["00:05", "12:05 AM"],
    ["08:00", "8:00 AM"],
    ["11:55", "11:55 AM"],
    ["12:00", "12:00 PM"],
    ["13:30", "1:30 PM"],
    ["18:30", "6:30 PM"],
    ["23:55", "11:55 PM"],
  ])("%s reads %s", (time, words) => {
    expect(clockWords(time)).toBe(words);
  });

  it.each([
    [[1, 2, 3, 4, 5, 6, 7], "Every day"],
    [[1, 2, 3, 4, 5], "Weekdays"],
    [[6, 7], "Weekends"],
    [[1, 3, 5], "Mon, Wed and Fri"],
    [[5, 1, 3], "Mon, Wed and Fri"],
    [[2], "Tue"],
    [[7, 6, 1], "Mon, Sat and Sun"],
    [[], "Every day"],
  ])("%j reads %s", (days, words) => {
    expect(daysWords(days)).toBe(words);
  });

  it("a line for off, a workout and a meal; a paused one keeps its times (its box says why)", () => {
    const base = { time: "18:30", days: [1, 3, 5], paused: false };
    expect(reminderLine({ ...base, kind: "workout", on: false })).toBe("Off.");
    expect(reminderLine({ ...base, kind: "workout", on: true })).toBe("Mon, Wed and Fri at 6:30\u00a0PM.");
    expect(reminderLine({ ...base, kind: "dinner", on: true, days: [1, 2, 3, 4, 5, 6, 7] })).toBe("Every day at 6:30\u00a0PM.");
    expect(reminderLine({ ...base, kind: "workout", on: true, paused: true })).toBe("Mon, Wed and Fri at 6:30\u00a0PM.");
  });
});

describe("the time box's wheels", () => {
  it("every time of the day in 5-minute steps goes onto the wheels and comes back the same", () => {
    for (let minute = 0; minute < 1440; minute += 5) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
      const at = timeWheels(time);
      expect(wheelTime(at.hour, at.minute, at.half)).toBe(time);
    }
  });
  it("12 on the wheel is midnight with AM and noon with PM", () => {
    expect(wheelTime(0, 0, 0)).toBe("00:00");
    expect(wheelTime(0, 0, 1)).toBe("12:00");
    expect(wheelTime(6, 6, 1)).toBe("18:30");
  });
});
