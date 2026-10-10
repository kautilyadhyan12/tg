// The Reports page's members figures (ROADMAP 21a-i; spec Part 3 §16.5): the rule that turns
// a gym's monthly counts into churn, retention and the average stay, or says why not.
import { describe, expect, it } from "vitest";
import {
  REPORT_MONTHS,
  membersReportFrom,
  membersReportSchema,
  type MembersReportFacts,
  type ReportMonthCounts,
} from "../src/reports.js";

/** The twelve months ending at `today`'s, oldest first, each counted as `fill` unless named. */
function monthsTo(today: string, named: Record<string, Partial<ReportMonthCounts>> = {}, fill: Partial<ReportMonthCounts> = {}): ReportMonthCounts[] {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out: ReportMonthCounts[] = [];
  for (let i = 0; i < REPORT_MONTHS; i += 1) {
    const key = `${String(year)}-${String(month).padStart(2, "0")}`;
    out.unshift({ month: key, activeAtStart: 0, joined: 0, left: 0, leftOfStart: 0, ...fill, ...named[key] });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

function facts(over: Partial<MembersReportFacts> = {}): MembersReportFacts {
  const today = over.today ?? "2026-10-10";
  return {
    timezone: "Europe/London",
    today,
    firstListedOn: "2026-01-05",
    listChangedOn: "2026-10-01",
    activeNow: 100,
    everLeft: true,
    months: monthsTo(today),
    stay: { leavers: 0, totalDays: 0 },
    leads: [],
    ...over,
  };
}

const report = (over: Partial<MembersReportFacts> = {}) => membersReportSchema.parse(membersReportFrom(facts(over)));

describe("the worst thing: a churn figure that is false", () => {
  it("is the people on the list when each of the last three full months began who came off during it, taken together", () => {
    const r = report({
      months: monthsTo("2026-10-10", {
        "2026-06": { activeAtStart: 400, leftOfStart: 200, left: 200 }, // older than the three: not counted
        "2026-07": { activeAtStart: 100, leftOfStart: 5, left: 5 },
        "2026-08": { activeAtStart: 95, leftOfStart: 10, left: 12 },
        "2026-09": { activeAtStart: 90, leftOfStart: 0, left: 0 },
        "2026-10": { activeAtStart: 90, leftOfStart: 30, left: 30 }, // the month in progress: not counted
      }),
    });
    expect(r.churn).toEqual({ state: "ok", percent: 5.3 }); // 15 of 285
    expect(r.retention).toEqual({ state: "ok", percent: 94.7 });
    expect(r.churnMonths).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("counts only those who were there when the month began: somebody who joined and left inside it is in Left, not in churn", () => {
    const r = report({ months: monthsTo("2026-10-10", {}, { activeAtStart: 50, left: 10, leftOfStart: 2 }) });
    expect(r.churn).toEqual({ state: "ok", percent: 4 });
    expect(r.months.find((m) => m.month === "2026-09")).toMatchObject({ left: 10, churnPercent: 4 });
  });

  it.each([
    // [what, first person listed, today, full months, a figure?]
    ["listed this month", "2026-10-02", "2026-10-10", 0, false],
    ["listed last month", "2026-09-15", "2026-10-10", 0, false],
    ["two full months", "2026-07-20", "2026-10-10", 2, false],
    ["two full months, on the month's last day", "2026-07-20", "2026-10-31", 2, false],
    ["three full months, on the next month's first day", "2026-07-20", "2026-11-01", 3, true],
    ["three full months", "2026-06-20", "2026-10-10", 3, true],
    ["listed on the 1st: that month is a full one", "2026-07-01", "2026-10-10", 3, true],
    ["listed on the 2nd: that month is not", "2026-07-02", "2026-10-10", 2, false],
    ["over a new year", "2026-09-20", "2027-01-15", 3, true],
    ["listed in December, read in March", "2026-12-01", "2027-03-01", 3, true],
    ["listed in December on the 2nd, read in March", "2026-12-02", "2027-03-31", 2, false],
    ["years on the list", "2021-03-09", "2026-10-10", 66, true],
  ])("%s: %s to %s is %i full months", (_what, firstListedOn, today, fullMonths, given) => {
    const r = report({ today, firstListedOn, months: monthsTo(today, {}, { activeAtStart: 40, leftOfStart: 4, left: 4 }), stay: { leavers: 8, totalDays: 800 } });
    expect(r.fullMonths).toBe(fullMonths);
    expect(r.churn).toEqual(given ? { state: "ok", percent: 10 } : { state: "not_enough_data" });
    expect(r.retention).toEqual(given ? { state: "ok", percent: 90 } : { state: "not_enough_data" });
    expect(r.averageStay).toEqual(given ? { state: "ok", days: 100, leavers: 8 } : { state: "not_enough_data" });
    expect(r.churnMonths).toHaveLength(given ? 3 : 0);
  });

  it("never reads 0% for a gym that has never taken anybody off its list, however long it has kept one", () => {
    const r = report({ everLeft: false, firstListedOn: "2024-01-01", months: monthsTo("2026-10-10", {}, { activeAtStart: 200 }) });
    expect(r.churn).toEqual({ state: "nobody_left" });
    expect(r.retention).toEqual({ state: "nobody_left" });
    expect(r.averageStay).toEqual({ state: "nobody_left" });
    expect(r.months.every((m) => m.churnPercent === null)).toBe(true);
  });

  it("reads 0% once somebody has left, when nobody left in the three months", () => {
    const r = report({ months: monthsTo("2026-10-10", {}, { activeAtStart: 200 }) });
    expect(r.churn).toEqual({ state: "ok", percent: 0 });
    expect(r.retention).toEqual({ state: "ok", percent: 100 });
  });

  it("has no figure when nobody was on the list as those months began", () => {
    const r = report({ months: monthsTo("2026-10-10") });
    expect(r.churn).toEqual({ state: "nobody_at_start" });
    expect(r.retention).toEqual({ state: "nobody_at_start" });
  });

  it("never passes 100%, whatever the counts", () => {
    const r = report({ months: monthsTo("2026-10-10", {}, { activeAtStart: 3, leftOfStart: 9, left: 9 }) });
    expect(r.churn).toEqual({ state: "ok", percent: 100 });
    expect(r.retention).toEqual({ state: "ok", percent: 0 });
  });

  it("rounds to one decimal, and retention is what is left of 100", () => {
    const r = report({ months: monthsTo("2026-10-10", {}, { activeAtStart: 3, leftOfStart: 1, left: 1 }) });
    expect(r.churn).toEqual({ state: "ok", percent: 33.3 });
    expect(r.retention).toEqual({ state: "ok", percent: 66.7 });
  });
});

describe("the months shown", () => {
  it("start at the month the first person went on the list, and end at this one", () => {
    const r = report({ firstListedOn: "2026-07-20", months: monthsTo("2026-10-10", {}, { activeAtStart: 7, joined: 1 }) });
    expect(r.months.map((m) => [m.month, m.full])).toEqual([
      ["2026-07", false],
      ["2026-08", true],
      ["2026-09", true],
      ["2026-10", false],
    ]);
  });

  it("are none for a gym with nobody ever on its list", () => {
    const r = report({ firstListedOn: null, listChangedOn: null, activeNow: 0, everLeft: false });
    expect(r.months).toEqual([]);
    expect(r.fullMonths).toBe(0);
    expect(r.thisMonth).toEqual({ month: "2026-10", joined: 0, left: 0 });
  });

  it("are twelve at most, and a month has churn only when it is full and somebody was there at its start", () => {
    const r = report({
      firstListedOn: "2020-02-02",
      months: monthsTo("2026-10-10", { "2026-05": { activeAtStart: 0, left: 1 }, "2026-10": { activeAtStart: 80, leftOfStart: 8, left: 8 } }, { activeAtStart: 80, leftOfStart: 4, left: 4 }),
    });
    expect(r.months).toHaveLength(12);
    expect(r.months.find((m) => m.month === "2026-05")?.churnPercent).toBeNull();
    expect(r.months.find((m) => m.month === "2026-09")?.churnPercent).toBe(5);
    expect(r.months.find((m) => m.month === "2026-10")).toMatchObject({ full: false, churnPercent: null, left: 8 });
  });

  it("this month's new and left are the month in progress", () => {
    const r = report({ months: monthsTo("2026-10-10", { "2026-10": { joined: 6, left: 2 }, "2026-09": { joined: 40, left: 9 } }) });
    expect(r.thisMonth).toEqual({ month: "2026-10", joined: 6, left: 2 });
  });
});

describe("the average stay", () => {
  it("is the leavers' days on the list shared between them, to the nearest day", () => {
    expect(report({ stay: { leavers: 3, totalDays: 1000 } }).averageStay).toEqual({ state: "ok", days: 333, leavers: 3 });
    expect(report({ stay: { leavers: 1, totalDays: 0 } }).averageStay).toEqual({ state: "ok", days: 0, leavers: 1 });
  });

  it("says nobody left when nobody did in the months shown", () => {
    expect(report({ stay: { leavers: 0, totalDays: 0 } }).averageStay).toEqual({ state: "nobody_left" });
  });
});

describe("leads that became members", () => {
  it("is each source's joined over its leads, in the list's own order, and all of them together", () => {
    const r = report({
      leads: [
        { source: "friend", leads: 4, joined: 3 },
        { source: "walk_in", leads: 10, joined: 2 },
        { source: "website", leads: 3, joined: 0 },
      ],
    });
    expect(r.leads).toEqual({
      total: 17,
      joined: 5,
      percent: 29.4,
      sources: [
        { source: "walk_in", leads: 10, joined: 2, percent: 20 },
        { source: "website", leads: 3, joined: 0, percent: 0 },
        { source: "friend", leads: 4, joined: 3, percent: 75 },
      ],
    });
  });

  it("has no share with no leads, and leaves out a source nobody came from", () => {
    expect(report().leads).toEqual({ total: 0, joined: 0, percent: null, sources: [] });
    expect(report({ leads: [{ source: "other", leads: 0, joined: 0 }] }).leads.sources).toEqual([]);
  });
});

describe("the month the list began", () => {
  it("has no New, and no month before the list was kept from its first day has an 'at start'", () => {
    const r = report({
      firstListedOn: "2026-07-20",
      months: monthsTo("2026-10-10", {}, { activeAtStart: 7, joined: 200, left: 1 }),
    });
    expect(r.months.map((m) => [m.month, m.activeAtStart, m.joined])).toEqual([
      ["2026-07", null, null],
      ["2026-08", 7, 200],
      ["2026-09", 7, 200],
      ["2026-10", 7, 200],
    ]);
    expect(r.thisMonth.joined).toBe(200);
  });

  it("a list begun on the 1st has its 'at start', and still no New that month", () => {
    const r = report({ firstListedOn: "2026-08-01", months: monthsTo("2026-10-10", {}, { activeAtStart: 0, joined: 9 }) });
    expect(r.months[0]).toMatchObject({ month: "2026-08", activeAtStart: 0, joined: null, full: true });
  });

  it("this month's New is not given when the list began this month", () => {
    const r = report({ firstListedOn: "2026-10-08", months: monthsTo("2026-10-10", { "2026-10": { joined: 200 } }) });
    expect(r.thisMonth).toEqual({ month: "2026-10", joined: null, left: 0 });
    expect(r.months).toEqual([{ month: "2026-10", full: false, activeAtStart: null, joined: null, left: 0, churnPercent: null }]);
  });
});
