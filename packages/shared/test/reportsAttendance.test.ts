// The Reports page's attendance figures (ROADMAP 21a-ii; spec Part 3 §16.5): which days
// each figure is counted over, and the rule that turns a gym's counts into visits a member,
// the busiest hours, how full classes are and no-shows, or says why not.
import { describe, expect, it } from "vitest";
import {
  REPORT_CLASS_TYPES_MAX,
  attendanceReportFrom,
  attendanceReportSchema,
  attendanceWindows,
  mondayOf,
  weekdayOf,
  type AttendanceReportFacts,
  type ReportClassCounts,
} from "../src/reportsAttendance.js";

function facts(over: Partial<AttendanceReportFacts> = {}): AttendanceReportFacts {
  return {
    timezone: "Europe/London",
    today: "2026-10-10",
    firstVisitOn: "2026-06-01",
    days: [],
    weeks: [],
    hours: [],
    hoursNoTime: 0,
    member: { members: 0, visits: 0, visitors: 0 },
    classes: { ever: false, types: [] },
    ...over,
  };
}

function classCounts(over: Partial<ReportClassCounts> = {}): ReportClassCounts {
  return { name: "Spin", classes: 1, limitedClasses: 1, places: 10, booked: 0, bookings: 0, attended: 0, noShows: 0, ...over };
}

/** The report, read through its own contract as the page reads it. */
const report = (over: Partial<AttendanceReportFacts> = {}) => attendanceReportSchema.parse(attendanceReportFrom(facts(over)));

describe("the days of the week", () => {
  // Days anybody can check on a calendar.
  it.each([
    ["1970-01-01", 4],
    ["2000-02-29", 2],
    ["2024-12-31", 2],
    ["2026-08-31", 1],
    ["2026-10-04", 7],
    ["2026-10-05", 1],
    ["2026-10-10", 6],
    ["2027-01-01", 5],
  ])("%s is weekday %i, Monday being 1", (day, weekday) => {
    expect(weekdayOf(day)).toBe(weekday);
  });

  it.each([
    ["2026-10-05", "2026-10-05"],
    ["2026-10-10", "2026-10-05"],
    ["2026-10-11", "2026-10-05"],
    ["2027-01-01", "2026-12-28"],
    ["2024-03-03", "2024-02-26"],
  ])("the week that holds %s starts on Monday %s", (day, monday) => {
    expect(mondayOf(day)).toBe(monday);
  });
});

describe("which days each figure is counted over", () => {
  it("the days shown are 28 with today, the weeks 12 with this one, the classes 56 days with today", () => {
    expect(attendanceWindows("2026-10-10", null)).toMatchObject({
      daysFrom: "2026-09-13",
      weeksFrom: "2026-07-20",
      thisWeek: "2026-10-05",
      classesFrom: "2026-08-16",
    });
  });

  // Today is Saturday 10 October 2026; its week began on Monday the 5th.
  it.each<[string, string | null, number, [string, string, number] | null, [string, string, number] | null]>([
    ["nobody has ever checked in", null, 0, null, null],
    ["the first check-in is today", "2026-10-10", 0, null, null],
    ["the first was this Monday", "2026-10-05", 0, null, null],
    ["the first was last Sunday: no whole week yet", "2026-10-04", 0, null, null],
    ["the first was last Monday: one whole week", "2026-09-28", 1, null, null],
    ["the first was a Tuesday a fortnight back: still one whole week", "2026-09-22", 1, null, null],
    ["the first was the Monday before: two whole weeks, enough", "2026-09-21", 2, ["2026-09-21", "2026-10-04", 2], ["2026-09-21", "2026-10-04", 2]],
    ["a Sunday counts for the week after it", "2026-09-20", 2, ["2026-09-21", "2026-10-04", 2], ["2026-09-21", "2026-10-04", 2]],
    ["five whole weeks: hours over five, members over the newest four", "2026-08-31", 5, ["2026-08-31", "2026-10-04", 5], ["2026-09-07", "2026-10-04", 4]],
    ["eight whole weeks", "2026-08-10", 8, ["2026-08-10", "2026-10-04", 8], ["2026-09-07", "2026-10-04", 4]],
    ["a year of check-ins: hours over the newest eight only", "2025-10-01", 52, ["2026-08-10", "2026-10-04", 8], ["2026-09-07", "2026-10-04", 4]],
    ["a first check-in dated after today counts for nothing", "2026-11-02", 0, null, null],
  ])("%s", (_name, first, fullWeeks, hours, member) => {
    const windows = attendanceWindows("2026-10-10", first);
    expect(windows.fullWeeks).toBe(fullWeeks);
    expect(windows.hours).toEqual(hours === null ? null : { from: hours[0], to: hours[1], weeks: hours[2] });
    expect(windows.member).toEqual(member === null ? null : { from: member[0], to: member[1], weeks: member[2] });
  });

  it("on a Monday no day of this week is in a whole week, and on a Sunday the week is still in progress", () => {
    expect(attendanceWindows("2026-10-05", "2026-09-21").hours).toEqual({ from: "2026-09-21", to: "2026-10-04", weeks: 2 });
    expect(attendanceWindows("2026-10-11", "2026-09-21").hours).toEqual({ from: "2026-09-21", to: "2026-10-04", weeks: 2 });
    expect(attendanceWindows("2026-10-12", "2026-09-21").hours).toEqual({ from: "2026-09-21", to: "2026-10-11", weeks: 3 });
  });

  it("every whole-week window is whole weeks: it starts on a Monday and ends on a Sunday", () => {
    for (let back = 0; back < 120; back += 1) {
      const first = new Date(Date.parse("2026-10-10T00:00:00Z") - back * 86_400_000).toISOString().slice(0, 10);
      const windows = attendanceWindows("2026-10-10", first);
      for (const window of [windows.hours, windows.member]) {
        if (window === null) continue;
        expect([weekdayOf(window.from), weekdayOf(window.to)], first).toEqual([1, 7]);
        expect(window.from >= first, first).toBe(true);
      }
    }
  });
});

describe("visits by day and by week", () => {
  it("nobody has ever checked in: no days, no weeks, and no figure", () => {
    expect(report({ firstVisitOn: null })).toMatchObject({
      firstVisitOn: null,
      fullWeeks: 0,
      days: [],
      weeks: [],
      perMember: { state: "not_enough_data" },
      hours: { state: "not_enough_data" },
    });
  });

  it("a day and a week nobody came are zeros, from the first check-in on and nothing before it", () => {
    const r = report({
      firstVisitOn: "2026-10-01",
      days: [
        { day: "2026-10-01", visits: 3 },
        { day: "2026-10-09", visits: 2 },
      ],
      weeks: [
        { weekStart: "2026-09-28", visits: 3, people: 3 },
        { weekStart: "2026-10-05", visits: 2, people: 1 },
      ],
    });
    expect(r.days).toHaveLength(10);
    expect(r.days[0]).toEqual({ day: "2026-10-01", visits: 3 });
    expect(r.days.filter((d) => d.visits === 0)).toHaveLength(8);
    expect(r.days[9]).toEqual({ day: "2026-10-10", visits: 0 });
    // The week of the first check-in began before it, so it is not a whole week.
    expect(r.weeks).toEqual([
      { weekStart: "2026-09-28", visits: 3, people: 3, full: false },
      { weekStart: "2026-10-05", visits: 2, people: 1, full: false },
    ]);
  });

  it("a long history shows 28 days and 12 weeks, the week in progress last and not whole", () => {
    const r = report({ firstVisitOn: "2025-01-06", weeks: [{ weekStart: "2026-08-03", visits: 40, people: 22 }] });
    expect(r.days).toHaveLength(28);
    expect(r.days[0]?.day).toBe("2026-09-13");
    expect(r.weeks).toHaveLength(12);
    expect(r.weeks[0]).toEqual({ weekStart: "2026-07-20", visits: 0, people: 0, full: true });
    expect(r.weeks[2]).toEqual({ weekStart: "2026-08-03", visits: 40, people: 22, full: true });
    expect(r.weeks[11]).toEqual({ weekStart: "2026-10-05", visits: 0, people: 0, full: false });
  });

  it("a count for a day or a week outside what is shown is not drawn", () => {
    const r = report({
      firstVisitOn: "2026-10-01",
      days: [{ day: "2026-09-30", visits: 9 }],
      weeks: [{ weekStart: "2026-09-21", visits: 9, people: 9 }],
    });
    expect(r.days.every((d) => d.visits === 0)).toBe(true);
    expect(r.weeks.every((w) => w.visits === 0)).toBe(true);
  });
});

describe("visits a member a week", () => {
  const cases: [string, Partial<AttendanceReportFacts>, unknown][] = [
    ["under two whole weeks: not enough", { firstVisitOn: "2026-09-28", member: { members: 50, visits: 80, visitors: 30 } }, { state: "not_enough_data" }],
    ["nobody on the list: no members to share between", { member: { members: 0, visits: 0, visitors: 0 } }, { state: "no_members" }],
    [
      "members who never came: a true zero",
      { member: { members: 40, visits: 0, visitors: 0 } },
      { state: "ok", perWeek: 0, from: "2026-09-07", to: "2026-10-04", weeks: 4, members: 40, visits: 0, visitors: 0 },
    ],
    [
      "600 visits by 100 members over four weeks: 1.5 each a week",
      { member: { members: 100, visits: 600, visitors: 71 } },
      { state: "ok", perWeek: 1.5, from: "2026-09-07", to: "2026-10-04", weeks: 4, members: 100, visits: 600, visitors: 71 },
    ],
    [
      "two whole weeks only: shared over two",
      { firstVisitOn: "2026-09-21", member: { members: 10, visits: 30, visitors: 9 } },
      { state: "ok", perWeek: 1.5, from: "2026-09-21", to: "2026-10-04", weeks: 2, members: 10, visits: 30, visitors: 9 },
    ],
    [
      "to one decimal place",
      { member: { members: 3, visits: 7, visitors: 2 } },
      { state: "ok", perWeek: 0.6, from: "2026-09-07", to: "2026-10-04", weeks: 4, members: 3, visits: 7, visitors: 2 },
    ],
    [
      "never more people who came than members",
      { member: { members: 3, visits: 9, visitors: 5 } },
      { state: "ok", perWeek: 0.8, from: "2026-09-07", to: "2026-10-04", weeks: 4, members: 3, visits: 9, visitors: 3 },
    ],
  ];
  it.each(cases)("%s", (_name, over, expected) => {
    expect(report(over).perMember).toEqual(expected);
  });
});

describe("the busiest hours", () => {
  it("under two whole weeks no hour is named, whatever was counted", () => {
    expect(report({ firstVisitOn: "2026-09-28", hours: [{ weekday: 1, hour: 18, visits: 30 }] }).hours).toEqual({ state: "not_enough_data" });
  });

  it("enough weeks and no visit in them says so, with the visits that have no time", () => {
    expect(report({ hours: [], hoursNoTime: 4 }).hours).toEqual({ state: "no_visits", from: "2026-08-10", to: "2026-10-04", weeks: 8, noTime: 4 });
    expect(report({ hours: [{ weekday: 2, hour: 9, visits: 0 }] }).hours).toMatchObject({ state: "no_visits", noTime: 0 });
  });

  it("one hour is the busiest, and the hours come in the week's order", () => {
    const hours = report({
      hours: [
        { weekday: 7, hour: 10, visits: 4 },
        { weekday: 1, hour: 18, visits: 31 },
        { weekday: 1, hour: 7, visits: 12 },
        { weekday: 3, hour: 18, visits: 30 },
      ],
      hoursNoTime: 2,
    }).hours;
    expect(hours).toEqual({
      state: "ok",
      from: "2026-08-10",
      to: "2026-10-04",
      weeks: 8,
      cells: [
        { weekday: 1, hour: 7, visits: 12 },
        { weekday: 1, hour: 18, visits: 31 },
        { weekday: 3, hour: 18, visits: 30 },
        { weekday: 7, hour: 10, visits: 4 },
      ],
      top: 31,
      busiest: [{ weekday: 1, hour: 18 }],
      tied: 1,
      noTime: 2,
    });
  });

  it("two hours level are both named, never one picked", () => {
    const hours = report({
      hours: [
        { weekday: 5, hour: 17, visits: 20 },
        { weekday: 2, hour: 6, visits: 20 },
        { weekday: 2, hour: 7, visits: 19 },
      ],
    }).hours;
    expect(hours).toMatchObject({
      top: 20,
      tied: 2,
      busiest: [
        { weekday: 2, hour: 6 },
        { weekday: 5, hour: 17 },
      ],
    });
  });

  it("many hours level: the first three in the week's order are named and the count says how many there are", () => {
    const hours = report({ hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, hour: 9, visits: 1 })) }).hours;
    expect(hours).toMatchObject({
      top: 1,
      tied: 7,
      busiest: [
        { weekday: 1, hour: 9 },
        { weekday: 2, hour: 9 },
        { weekday: 3, hour: 9 },
      ],
    });
  });

  it("midnight and the last hour of Sunday are hours like any other", () => {
    const hours = report({
      hours: [
        { weekday: 1, hour: 0, visits: 2 },
        { weekday: 7, hour: 23, visits: 3 },
      ],
    }).hours;
    expect(hours).toMatchObject({ top: 3, busiest: [{ weekday: 7, hour: 23 }], tied: 1 });
  });
});

describe("how full classes are, and no-shows", () => {
  it("no class ever set up, and classes set up with none run, are two different sentences", () => {
    expect(report().classes).toEqual({ state: "none_ever" });
    expect(report({ classes: { ever: true, types: [] } }).classes).toEqual({ state: "none_recent", from: "2026-08-16" });
    // A class counted with none run is as good as not there.
    expect(report({ classes: { ever: true, types: [classCounts({ classes: 0 })] } }).classes).toEqual({ state: "none_recent", from: "2026-08-16" });
  });

  const fillCases: [string, ReportClassCounts[], unknown][] = [
    ["half the places taken", [classCounts({ classes: 4, limitedClasses: 4, places: 40, booked: 20, bookings: 20 })], { state: "ok", percent: 50, booked: 20, places: 40, classes: 4 }],
    ["nobody booked: a true zero, the classes had places", [classCounts({ classes: 2, limitedClasses: 2, places: 20 })], { state: "ok", percent: 0, booked: 0, places: 20, classes: 2 }],
    ["every place taken", [classCounts({ places: 10, booked: 10, bookings: 10 })], { state: "ok", percent: 100, booked: 10, places: 10, classes: 1 }],
    ["never over full", [classCounts({ places: 10, booked: 13, bookings: 13 })], { state: "ok", percent: 100, booked: 10, places: 10, classes: 1 }],
    ["no class has a limit: no share at all", [classCounts({ limitedClasses: 0, places: 0, booked: 0, bookings: 30 })], { state: "no_limit" }],
    [
      "a class with no limit is left out of the share, its bookings too",
      [classCounts({ classes: 2, limitedClasses: 2, places: 20, booked: 5, bookings: 5 }), classCounts({ name: "Open gym", classes: 9, limitedClasses: 0, places: 0, booked: 0, bookings: 90 })],
      { state: "ok", percent: 25, booked: 5, places: 20, classes: 2 },
    ],
    ["to one decimal place", [classCounts({ classes: 3, limitedClasses: 3, places: 30, booked: 10, bookings: 10 })], { state: "ok", percent: 33.3, booked: 10, places: 30, classes: 3 }],
  ];
  it.each(fillCases)("how full: %s", (_name, types, expected) => {
    const classes = report({ classes: { ever: true, types } }).classes;
    expect(classes.state === "ok" ? classes.fill : null).toEqual(expected);
  });

  const noShowCases: [string, ReportClassCounts[], unknown][] = [
    ["nobody booked anything", [classCounts()], { state: "no_bookings" }],
    ["places booked and nobody marked: said so, never 0%", [classCounts({ booked: 8, bookings: 8 })], { state: "nothing_marked", unmarked: 8 }],
    ["everybody marked came: a true zero", [classCounts({ booked: 8, bookings: 8, attended: 8 })], { state: "ok", percent: 0, noShows: 0, marked: 8, unmarked: 0 }],
    ["one in four marked did not come", [classCounts({ booked: 9, bookings: 9, attended: 6, noShows: 2 })], { state: "ok", percent: 25, noShows: 2, marked: 8, unmarked: 1 }],
    ["everybody marked a no-show", [classCounts({ booked: 3, bookings: 3, noShows: 3 })], { state: "ok", percent: 100, noShows: 3, marked: 3, unmarked: 0 }],
    [
      "a class nobody marked does not water down the share",
      [classCounts({ booked: 4, bookings: 4, attended: 3, noShows: 1 }), classCounts({ name: "Yoga", booked: 10, bookings: 10 })],
      { state: "ok", percent: 25, noShows: 1, marked: 4, unmarked: 10 },
    ],
    [
      "places in a class with no limit count too",
      [classCounts({ name: "Open gym", limitedClasses: 0, places: 0, booked: 0, bookings: 5, attended: 4, noShows: 1 })],
      { state: "ok", percent: 20, noShows: 1, marked: 5, unmarked: 0 },
    ],
  ];
  it.each(noShowCases)("no-shows: %s", (_name, types, expected) => {
    const classes = report({ classes: { ever: true, types } }).classes;
    expect(classes.state === "ok" ? classes.noShows : null).toEqual(expected);
  });

  it("each class has its own line, the one that ran most first, then by name", () => {
    const classes = report({
      classes: {
        ever: true,
        types: [
          classCounts({ name: "Yoga", classes: 2, limitedClasses: 2, places: 24, booked: 6, bookings: 6 }),
          classCounts({ name: "Open gym", classes: 8, limitedClasses: 0, places: 0, booked: 0, bookings: 31, attended: 20, noShows: 5 }),
          classCounts({ name: "Boxing", classes: 2, limitedClasses: 1, places: 10, booked: 10, bookings: 14, attended: 9, noShows: 1 }),
        ],
      },
    }).classes;
    expect(classes).toMatchObject({
      state: "ok",
      classes: 12,
      bookings: 51,
      moreTypes: 0,
      types: [
        { name: "Open gym", classes: 8, places: null, booked: 31, fillPercent: null, attended: 20, noShows: 5, noShowPercent: 20 },
        { name: "Boxing", classes: 2, places: 10, booked: 10, fillPercent: 100, attended: 9, noShows: 1, noShowPercent: 10 },
        { name: "Yoga", classes: 2, places: 24, booked: 6, fillPercent: 25, attended: 0, noShows: 0, noShowPercent: null },
      ],
    });
  });

  it("past the most the page lists, the rest are counted in the totals and said as a number", () => {
    const types = Array.from({ length: REPORT_CLASS_TYPES_MAX + 3 }, (_, i) => classCounts({ name: `Class ${String(i).padStart(3, "0")}`, places: 10, booked: 5, bookings: 5 }));
    const classes = report({ classes: { ever: true, types } }).classes;
    expect(classes).toMatchObject({ state: "ok", classes: REPORT_CLASS_TYPES_MAX + 3, moreTypes: 3 });
    expect(classes.state === "ok" ? classes.types.length : 0).toBe(REPORT_CLASS_TYPES_MAX);
    expect(classes.state === "ok" ? classes.fill : null).toEqual({ state: "ok", percent: 50, booked: (REPORT_CLASS_TYPES_MAX + 3) * 5, places: (REPORT_CLASS_TYPES_MAX + 3) * 10, classes: REPORT_CLASS_TYPES_MAX + 3 });
  });
});
