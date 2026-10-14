// The Reports page, the same period a year earlier (ROADMAP 21d-ii; spec Part 3 §16.5):
// which days it covers, and that each figure is given only where the app's records cover
// every one of those days, and is a sentence otherwise, never a zero.
import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "../src/heldMemberships.js";
import { REPORT_PERIODS, reportPeriodOf, yearEarlierOf, type ReportPeriodKey } from "../src/reportPeriod.js";
import { REPORT_MONTHS, membersReportFrom, membersReportSchema, type MembersReportFacts } from "../src/reports.js";
import { weekdayOf } from "../src/reportsAttendance.js";
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
      yearEarlier: { joined: 7, late: 0, lateFrom: null },
      ...over,
    }),
  );
}

/** Twelve months to 14 Oct 2026, a year earlier. */
const SPAN = { from: "2024-11-01", to: "2025-10-14" };

describe("new members a year earlier", () => {
  it("are those who started in those days and were on the list by their last day", () => {
    expect(members({}).yearEarlier).toEqual({ state: "ok", ...SPAN, joined: 7 });
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

  // Who started in those days, by when they reached the list: on time, and later (round
  // one's H1: one member typed in July 2025, the gym's real file of 75 imported in
  // September 2026, 35 of them joined in August and September 2025).
  it.each<[string, number, number, "ok" | "added_later"]>([
    ["nobody started", 0, 0, "ok"],
    ["all on time", 7, 0, "ok"],
    ["one late, the rest on time", 7, 1, "ok"],
    ["as many late as on time: half the figure is still the app's own", 3, 3, "ok"],
    ["one more late than on time", 3, 4, "added_later"],
    ["one late and none on time", 0, 1, "added_later"],
    ["the file of 35 imported a year later", 0, 35, "added_later"],
    ["the file of 35 beside one typed by hand", 1, 35, "added_later"],
  ])("%s (%s on time, %s late): %s", (_, joined, late, state) => {
    const r = members({ yearEarlier: { joined, late, lateFrom: late === 0 ? null : "2026-09-10" } });
    expect(r.yearEarlier.state).toBe(state);
    if (r.yearEarlier.state === "ok") expect(r.yearEarlier.joined).toBe(joined);
    if (r.yearEarlier.state === "added_later") expect(r.yearEarlier.on).toBe("2026-09-10");
  });

  it("a list that began too late says so before anything about late arrivals", () => {
    expect(members({ firstListedOn: "2026-09-10", yearEarlier: { joined: 0, late: 35, lateFrom: "2026-09-10" } }).yearEarlier).toEqual({
      state: "no_history",
      ...SPAN,
      since: "2026-09-10",
    });
  });

  it("nothing about leads a year earlier: the page shows none", () => {
    expect(Object.keys(members({}).leads)).not.toContain("yearEarlier");
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
