// Which reminders go now, and what the phone shows (ROADMAP Stage 5 item 19e-i): every class of case.
import { describe, expect, it } from "vitest";
import {
  bitsToDays,
  daysToBits,
  minuteToTime,
  reminderNotification,
  reminderSaveSchema,
  remindersToSend,
  timeToMinute,
  type ReminderKind,
} from "../src/trainingReminders.js";

const at = (time: string) => timeToMinute(time);
const row = (kind: ReminderKind, time: string) => ({ kind, minute: at(time) });

describe("remindersToSend", () => {
  const cases: [string, { kind: ReminderKind; minute: number }[], string, ReminderKind[]][] = [
    ["nothing owed", [], "18:30", []],
    ["a minute early", [row("workout", "18:30")], "18:29", []],
    ["on the minute", [row("workout", "18:30")], "18:30", ["workout"]],
    ["29 minutes late still goes", [row("workout", "18:30")], "18:59", ["workout"]],
    ["30 minutes late does not", [row("workout", "18:30")], "19:00", []],
    ["one due later within the hour joins", [row("workout", "18:30"), row("dinner", "19:30")], "18:30", ["workout", "dinner"]],
    ["one due 61 minutes later waits", [row("workout", "18:30"), row("dinner", "19:31")], "18:30", ["workout"]],
    ["one due later alone does not go early", [row("dinner", "19:00")], "18:30", []],
    ["two due at once", [row("lunch", "13:00"), row("workout", "13:00")], "13:00", ["workout", "lunch"]],
    ["a meal due with a workout later", [row("lunch", "13:00"), row("workout", "13:45")], "13:00", ["workout", "lunch"]],
    ["midnight is a minute", [row("breakfast", "00:00")], "00:00", ["breakfast"]],
    ["the last minute of the day", [row("dinner", "23:55")], "23:59", ["dinner"]],
    ["the next day's early one does not join the night's", [row("dinner", "23:55"), row("breakfast", "00:10")], "23:55", ["dinner"]],
    ["a minute out of the day sends nothing", [{ kind: "lunch", minute: 1440 }], "23:59", []],
    ["a fraction sends nothing", [{ kind: "lunch", minute: 780.5 }], "13:00", []],
    ["order is workout, then the meals of the day", [row("dinner", "18:40"), row("breakfast", "18:30"), row("workout", "18:35")], "18:30", ["workout", "breakfast", "dinner"]],
  ];
  it.each(cases)("%s", (_name, owed, now, expected) => {
    expect(remindersToSend(owed, at(now))).toEqual(expected);
  });
  it("garbage for now sends nothing", () => {
    for (const now of [-1, 1440, Number.NaN, 12.5]) expect(remindersToSend([row("lunch", "13:00")], now)).toEqual([]);
  });
});

describe("reminderNotification", () => {
  const cases: [ReminderKind[], { title: string; body: string } | null][] = [
    [[], null],
    [["workout"], { title: "Time to train", body: "Your workout for today is waiting." }],
    [["workout", "dinner"], { title: "Time to train", body: "And log your dinner." }],
    [["workout", "lunch", "dinner"], { title: "Time to train", body: "And log your lunch and dinner." }],
    [["breakfast"], { title: "Breakfast", body: "Log what you ate." }],
    [["lunch"], { title: "Lunch", body: "Log what you ate." }],
    [["dinner"], { title: "Dinner", body: "Log what you ate." }],
    [["dinner", "lunch"], { title: "Log your meals", body: "Lunch and Dinner." }],
    [["breakfast", "lunch", "dinner"], { title: "Log your meals", body: "Breakfast, Lunch and Dinner." }],
  ];
  it.each(cases)("%j", (kinds, expected) => {
    expect(reminderNotification(kinds)).toEqual(expected);
  });
});

describe("days and times", () => {
  it("a workout keeps its days; a meal is every day; none or nonsense is every day", () => {
    expect(bitsToDays(daysToBits("workout", [1, 3, 5]))).toEqual([1, 3, 5]);
    expect(bitsToDays(daysToBits("workout", [7]))).toEqual([7]);
    expect(daysToBits("lunch", [2])).toBe(127);
    expect(daysToBits("workout", [])).toBe(127);
    expect(daysToBits("workout", [0, 8, 1.5])).toBe(127);
    expect(bitsToDays(0)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("times go both ways, in 5-minute steps only", () => {
    expect(minuteToTime(0)).toBe("00:00");
    expect(minuteToTime(1435)).toBe("23:55");
    expect(timeToMinute("18:30")).toBe(1110);
    for (const time of ["18:31", "24:00", "7:30", "18:3", "18:30 ", "-1:00"]) {
      expect(reminderSaveSchema.safeParse({ on: true, time, days: [1] }).success).toBe(false);
    }
    expect(reminderSaveSchema.safeParse({ on: true, time: "23:55", days: [1, 7] }).success).toBe(true);
  });
});
