import { describe, expect, it } from "vitest";
import type { GymAttendanceVisit } from "@app/shared";
import {
  ADDED_LATER,
  dayIn,
  dayLabel,
  emptyMonthNote,
  monthGrid,
  monthName,
  monthOfDay,
  monthWindow,
  shiftMonth,
  visitTime,
} from "../src/screens/gym/visitsView";

const visit = (day: string, markedAt: string, hoursStatus: GymAttendanceVisit["hoursStatus"] = "in_session"): GymAttendanceVisit => ({
  day,
  markedAt,
  method: "pass",
  hoursStatus,
  session: null,
});

describe("the month asked for", () => {
  it.each([
    ["2026-10", { from: "2026-10-01", to: "2026-11-01" }],
    ["2026-12", { from: "2026-12-01", to: "2027-01-01" }],
    ["2028-02", { from: "2028-02-01", to: "2028-03-01" }],
    ["2026-13", null],
    ["2026-1", null],
    ["", null],
  ])("%s asks for %j", (key, window) => {
    expect(monthWindow(key)).toEqual(window);
  });

  it.each([
    ["2026-01", -1, "2025-12"],
    ["2026-12", 1, "2027-01"],
    ["2026-10", -1, "2026-09"],
    ["2026-10", 0, "2026-10"],
    ["nonsense", 1, "nonsense"],
  ])("%s moved %i is %s", (key, step, moved) => {
    expect(shiftMonth(key, step)).toBe(moved);
  });
});

describe("the gym's day, not the phone's", () => {
  // 20:00 in London's winter is already the next day in India and still the same day in New York.
  const at = new Date("2026-10-31T20:00:00Z");
  it.each([
    ["Asia/Kolkata", "2026-11-01"],
    ["America/New_York", "2026-10-31"],
    ["Pacific/Kiritimati", "2026-11-01"],
    ["UTC", "2026-10-31"],
    ["Not/AZone", null],
    ["", null],
  ])("in %s it is %s", (zone, day) => {
    expect(dayIn(zone, at)).toBe(day);
  });

  it("the month of a day, and none for what is not a day", () => {
    expect(monthOfDay("2026-11-01")).toBe("2026-11");
    expect(monthOfDay(null)).toBeNull();
    expect(monthOfDay("2026-11")).toBeNull();
  });
});

describe("a visit's time, on the gym's clock", () => {
  it.each([
    ["2026-10-27T12:32:00Z", "Asia/Kolkata", "12h", "6:02 PM"],
    ["2026-10-27T12:32:00Z", "Asia/Kolkata", "24h", "18:02"],
    ["2026-10-27T18:35:00Z", "Asia/Kolkata", "12h", "12:05 AM"],
    ["2026-10-27T18:35:00Z", "Asia/Kolkata", "24h", "00:05"],
    ["2026-10-27T07:00:00Z", "Asia/Kolkata", "12h", "12:30 PM"],
    ["2026-10-27T13:00:00Z", "America/New_York", "12h", "9:00 AM"],
    ["2026-10-27T12:32:00Z", "Not/AZone", "12h", ""],
    ["not a time", "Asia/Kolkata", "12h", ""],
  ] as const)("%s in %s on a %s clock reads %j", (markedAt, zone, clock, time) => {
    expect(visitTime(markedAt, zone, clock)).toBe(time);
  });
});

describe("the month as days", () => {
  it.each([
    ["2026-02", 28, 6],
    ["2028-02", 29, 1],
    ["2100-02", 28, 0],
    ["2000-02", 29, 1],
    ["2026-06", 30, 0],
    ["2026-10", 31, 3],
    ["2026-11", 30, 6],
  ])("%s has %i days and starts after %i blanks (Monday first)", (key, days, leading) => {
    const grid = monthGrid(key, [], "Asia/Kolkata", "24h", null);
    expect(grid?.cells).toHaveLength(days);
    expect(grid?.leading).toBe(leading);
  });

  it("marks only the days somebody came, with every time of that day", () => {
    const grid = monthGrid(
      "2026-10",
      [visit("2026-10-27", "2026-10-27T12:32:00Z"), visit("2026-10-27", "2026-10-27T01:00:00Z"), visit("2026-10-03", "2026-10-03T03:30:00Z")],
      "Asia/Kolkata",
      "12h",
      "2026-10-28",
    );
    const came = grid?.cells.filter((cell) => cell.came).map((cell) => [cell.date, cell.times]);
    expect(came).toEqual([
      ["2026-10-03", ["9:00 AM"]],
      ["2026-10-27", ["6:02 PM", "6:30 AM"]],
    ]);
  });

  it("a visit staff added later says so, never the time it was added", () => {
    const grid = monthGrid("2026-10", [visit("2026-10-05", "2026-10-20T10:00:00Z", "added_later")], "Asia/Kolkata", "12h", null);
    expect(grid?.cells.find((cell) => cell.came)?.times).toEqual([ADDED_LATER]);
  });

  it("a day whose time cannot be read is still a day they came", () => {
    const grid = monthGrid("2026-10", [visit("2026-10-05", "2026-10-05T10:00:00Z")], "Not/AZone", "12h", null);
    expect(grid?.cells.find((cell) => cell.date === "2026-10-05")).toMatchObject({ came: true, times: [] });
  });

  it("a visit from another month is not drawn in this one", () => {
    const grid = monthGrid("2026-10", [visit("2026-09-30", "2026-09-30T10:00:00Z")], "Asia/Kolkata", "12h", null);
    expect(grid?.cells.some((cell) => cell.came)).toBe(false);
  });

  it("today is the gym's, and the days after it are dimmed; with no today nothing is", () => {
    const grid = monthGrid("2026-10", [], "Asia/Kolkata", "12h", "2026-10-28");
    expect(grid?.cells.filter((cell) => cell.today).map((cell) => cell.day)).toEqual([28]);
    expect(grid?.cells.filter((cell) => cell.future).map((cell) => cell.day)).toEqual([29, 30, 31]);
    const unknown = monthGrid("2026-10", [], "Asia/Kolkata", "12h", null);
    expect(unknown?.cells.some((cell) => cell.today || cell.future)).toBe(false);
  });
});

describe("the words", () => {
  it.each([
    ["2026-10", "2026-10", "October"],
    ["2025-12", "2026-10", "December 2025"],
    ["2026-10", null, "October 2026"],
  ])("%s seen in %s is %j", (key, now, name) => {
    expect(monthName(key, now)).toBe(name);
  });

  it("an empty month speaks of that month only", () => {
    expect(emptyMonthNote("2026-10", "2026-10")).toBe("No check-ins yet this month.");
    expect(emptyMonthNote("2026-09", "2026-10")).toBe("No check-ins in September 2026.");
  });

  it.each([
    ["2026-10-27", "Tue 27 Oct 2026"],
    ["2026-02-01", "Sun 1 Feb 2026"],
    ["2026-02-31", "2026-02-31"],
  ])("%s is shown as %j", (day, label) => {
    expect(dayLabel(day)).toBe(label);
  });
});
