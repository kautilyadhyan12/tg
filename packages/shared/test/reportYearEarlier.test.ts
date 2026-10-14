// The Reports page, the same period a year earlier (ROADMAP 21d-ii; spec Part 3 §16.5):
// which days it covers, and that each figure is given only where the app's records cover
// every one of those days, and is a sentence otherwise, never a zero.
import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "../src/heldMemberships.js";
import { REPORT_PERIODS, reportPeriodOf, yearEarlierOf, type ReportPeriodKey } from "../src/reportPeriod.js";
import { REPORT_MONTHS, membersReportFrom, membersReportSchema, type MembersReportFacts } from "../src/reports.js";
import {
  attendanceReportFrom,
  attendanceReportSchema,
  attendanceYearEarlier,
  weekdayOf,
  type AttendanceReportFacts,
  type ReportClassCounts,
} from "../src/reportsAttendance.js";
import { moneyReportFrom, moneyReportSchema, type MoneyReportFacts } from "../src/reportsMoney.js";

const TODAY = "2026-10-14";

describe("the days a year earlier", () => {
  // Days anybody can check on a calendar.
  it.each<[ReportPeriodKey, string, string, string]>([
    // Four weeks go back 52 weeks: a Thursday beside a Thursday.
    ["4w", "2026-10-14", "2025-09-18", "2025-10-15"],
    ["4w", "2024-03-10", "2023-02-13", "2023-03-12"],
    ["4w", "2026-01-05", "2024-12-10", "2025-01-06"],
    // Months go back a calendar year, to the same day of the month.
    ["3m", "2026-10-14", "2025-08-01", "2025-10-14"],
    ["3m", "2026-01-15", "2024-11-01", "2025-01-15"],
    ["12m", "2026-10-14", "2024-11-01", "2025-10-14"],
    ["12m", "2026-12-31", "2025-01-01", "2025-12-31"],
    // 29 February a year back is 28 February.
    ["12m", "2024-02-29", "2022-03-01", "2023-02-28"],
    ["3m", "2028-02-29", "2026-12-01", "2027-02-28"],
    // 28 February in the year after a leap year stays 28 February.
    ["3m", "2025-02-28", "2023-12-01", "2024-02-28"],
  ])("%s on %s: %s to %s", (key, today, from, to) => {
    expect(yearEarlierOf(reportPeriodOf(key, today))).toEqual({ from, to });
  });

  it("on every day of four years: four weeks are 28 days on the same weekdays, months the same months a year back", () => {
    for (let today = "2024-01-01"; today <= "2027-12-31"; today = addDays(today, 1)) {
      for (const key of REPORT_PERIODS) {
        const period = reportPeriodOf(key, today);
        const earlier = yearEarlierOf(period);
        // Never a day of the period itself.
        expect(earlier.to < period.from).toBe(true);
        expect(earlier.from <= earlier.to).toBe(true);
        if (key === "4w") {
          expect(daysBetween(earlier.from, earlier.to)).toBe(27);
          expect(weekdayOf(earlier.from)).toBe(weekdayOf(period.from));
          expect(daysBetween(earlier.to, period.to)).toBe(364);
        } else {
          expect(earlier.from).toBe(`${String(Number(period.from.slice(0, 4)) - 1)}${period.from.slice(4)}`);
          expect(earlier.to.slice(0, 4)).toBe(String(Number(period.to.slice(0, 4)) - 1));
          expect(earlier.to.slice(5, 7)).toBe(period.to.slice(5, 7));
          expect(earlier.to.slice(8)).toBe(period.to.slice(5) === "02-29" ? "28" : period.to.slice(8));
        }
      }
    }
  });

  it("the whole weeks a year earlier are Monday to Sunday inside its days, none left out, on every day of two years", () => {
    for (let today = "2025-01-01"; today <= "2026-12-31"; today = addDays(today, 1)) {
      for (const key of REPORT_PERIODS) {
        const { span, whole } = attendanceYearEarlier(today, key);
        if (whole === null) {
          expect(key).toBe("4w");
          continue;
        }
        expect(weekdayOf(whole.from)).toBe(1);
        expect(weekdayOf(whole.to)).toBe(7);
        expect(whole.from >= span.from).toBe(true);
        expect(whole.to <= span.to).toBe(true);
        expect(daysBetween(whole.from, whole.to) + 1).toBe(whole.weeks * 7);
        expect(daysBetween(span.from, whole.from)).toBeLessThan(7);
        expect(daysBetween(whole.to, span.to)).toBeLessThan(8);
      }
    }
  });
});

function monthsTo(today: string) {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out = [];
  for (let i = 0; i < REPORT_MONTHS; i += 1) {
    out.unshift({ month: `${String(year)}-${String(month).padStart(2, "0")}`, activeAtStart: 100, joined: 0, left: 0, leftOfStart: 0 });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

function members(over: Partial<MembersReportFacts>) {
  return membersReportSchema.parse(
    membersReportFrom({
      timezone: "Europe/London",
      today: TODAY,
      period: "12m",
      firstListedOn: "2023-05-02",
      listChangedOn: "2026-10-01",
      activeNow: 100,
      everLeft: true,
      months: monthsTo(TODAY),
      inPeriod: { joined: 10, left: 5 },
      stay: { leavers: 5, totalDays: 500 },
      leads: [],
      anyLead: true,
      yearEarlier: { joined: 7, left: 4, stay: { leavers: 4, totalDays: 802 }, leads: 9, leadsJoined: 3 },
      firstLeadOn: "2024-01-01",
      ...over,
    }),
  );
}

describe("members a year earlier", () => {
  it("are the counts of those days, where the list covers them", () => {
    const r = members({});
    expect(r.yearEarlier).toEqual({ state: "ok", from: "2024-11-01", to: "2025-10-14", joined: 7, left: 4, stay: { days: 201, leavers: 4 } });
    expect(r.leads.yearEarlier).toEqual({ state: "ok", from: "2024-11-01", to: "2025-10-14", total: 9, joined: 3 });
  });

  // Where the list began, for twelve months whose year earlier starts 1 Nov 2024.
  it.each<[string | null, boolean]>([
    ["2024-10-31", true],
    ["2024-10-01", true],
    // Its first month's people are not new: new could not be counted from 1 Nov.
    ["2024-11-01", false],
    ["2024-11-02", false],
    ["2025-10-14", false],
    ["2026-06-10", false],
    [null, false],
  ])("a list that began on %s: a year earlier given %s", (firstListedOn, given) => {
    const r = members({ firstListedOn });
    expect(r.yearEarlier.state).toBe(given ? "ok" : "no_history");
    if (r.yearEarlier.state === "no_history") expect(r.yearEarlier.since).toBe(firstListedOn);
  });

  it("nobody left in those days: no average stay, never zero days", () => {
    const r = members({ yearEarlier: { joined: 7, left: 0, stay: { leavers: 0, totalDays: 0 }, leads: 0, leadsJoined: 0 } });
    expect(r.yearEarlier).toMatchObject({ state: "ok", left: 0, stay: null });
  });

  it.each<[string | null, boolean]>([
    ["2024-11-01", true],
    ["2024-11-02", false],
    [null, false],
  ])("leads first added on %s: a year earlier given %s", (firstLeadOn, given) => {
    expect(members({ firstLeadOn }).leads.yearEarlier.state).toBe(given ? "ok" : "no_history");
  });
});

function counts(over: Partial<ReportClassCounts> = {}): ReportClassCounts {
  return { name: "Spin", classes: 4, limitedClasses: 4, places: 40, booked: 30, bookings: 30, attended: 20, noShows: 5, ...over };
}

function attendance(over: Partial<AttendanceReportFacts>) {
  return attendanceReportSchema.parse(
    attendanceReportFrom({
      timezone: "Europe/London",
      today: TODAY,
      period: "4w",
      firstVisitOn: "2025-01-06",
      days: [],
      weeks: [],
      people: 0,
      hours: [],
      hoursNoTime: 0,
      member: { members: 0, visits: 0, visitors: 0 },
      classes: { ever: true, types: [counts()] },
      firstClassOn: "2025-02-01",
      yearEarlier: {
        visits: 90,
        people: 30,
        member: { members: 20, visits: 60, visitors: 15 },
        classes: [counts({ places: 50, booked: 25, attended: 9, noShows: 1 })],
      },
      ...over,
    }),
  );
}

describe("attendance a year earlier", () => {
  it("visits, people and visits a member a week over its own whole weeks", () => {
    const r = attendance({});
    // 18 Sep to 15 Oct 2025: whole weeks 22 Sep to 12 Oct, three of them.
    expect(r.yearEarlier).toEqual({
      state: "ok",
      from: "2025-09-18",
      to: "2025-10-15",
      visits: 90,
      people: 30,
      perMember: { perWeek: 1, weeks: 3, members: 20 },
    });
    if (r.classes.state !== "ok") throw new Error("no classes");
    expect(r.classes.yearEarlier).toEqual({ state: "ok", from: "2025-09-18", to: "2025-10-15", classes: 4, fillPercent: 50, noShowPercent: 10 });
  });

  it("the first check-in after those days began: a sentence with the day, never zero visits", () => {
    expect(attendance({ firstVisitOn: "2025-09-19" }).yearEarlier).toEqual({ state: "no_history", from: "2025-09-18", to: "2025-10-15", since: "2025-09-19" });
    expect(attendance({ firstVisitOn: "2025-09-18" }).yearEarlier.state).toBe("ok");
    expect(attendance({ firstVisitOn: null }).yearEarlier).toMatchObject({ state: "no_history", since: null });
  });

  it("nobody on the list then: visits are given, visits a member a week is not", () => {
    const r = attendance({ yearEarlier: { visits: 5, people: 2, member: { members: 0, visits: 0, visitors: 0 }, classes: [] } });
    expect(r.yearEarlier).toMatchObject({ visits: 5, perMember: null });
  });

  it("classes: none before those days began is a sentence; none that ran in them gives no share", () => {
    const late = attendance({ firstClassOn: "2025-09-19" });
    if (late.classes.state !== "ok") throw new Error("no classes");
    expect(late.classes.yearEarlier).toEqual({ state: "no_history", from: "2025-09-18", to: "2025-10-15", since: "2025-09-19" });
    const none = attendance({ yearEarlier: { visits: 0, people: 0, member: { members: 0, visits: 0, visitors: 0 }, classes: [] } });
    if (none.classes.state !== "ok") throw new Error("no classes");
    expect(none.classes.yearEarlier).toMatchObject({ state: "ok", classes: 0, fillPercent: null, noShowPercent: null });
  });
});

function money(over: Partial<MoneyReportFacts>) {
  return moneyReportSchema.parse(
    moneyReportFrom({
      timezone: "Europe/London",
      today: TODAY,
      period: "3m",
      currency: "GBP",
      anyMembership: true,
      firstPaidOn: "2025-08-01",
      otherCurrency: false,
      overdueAfterDays: 0,
      held: [],
      months: [],
      owed: { currentMinor: 0, currentPeople: 0, listPeople: 0, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 },
      members: { today: TODAY, firstListedOn: "2024-03-04", everLeft: false, months: monthsTo(TODAY) },
      yearEarlier: { paidMinor: 120000, refundedMinor: 5000 },
      ...over,
    }),
  );
}

describe("money collected a year earlier", () => {
  it("payments less refunds of those days", () => {
    const r = money({});
    if (r.state !== "ok") throw new Error("no figures");
    expect(r.yearEarlier).toEqual({ state: "ok", from: "2025-08-01", to: "2025-10-14", paidMinor: 120000, refundedMinor: 5000, netMinor: 115000 });
  });

  it("the first payment recorded after those days began: a sentence with its day, never nothing collected", () => {
    const r = money({ firstPaidOn: "2025-08-02" });
    if (r.state !== "ok") throw new Error("no figures");
    expect(r.yearEarlier).toEqual({ state: "no_history", from: "2025-08-01", to: "2025-10-14", since: "2025-08-02" });
  });

  it("a gym whose first payment was a year ago today has none for twelve months", () => {
    const r = money({ period: "12m", firstPaidOn: "2025-10-14" });
    if (r.state !== "ok") throw new Error("no figures");
    expect(r.yearEarlier).toMatchObject({ state: "no_history", from: "2024-11-01", since: "2025-10-14" });
  });
});
