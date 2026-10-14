// The Reports page's period (ROADMAP 21d-i; spec Part 3 §16.5): which days each choice
// covers, and that the members and money figures count those days and no others.
import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "../src/heldMemberships.js";
import { REPORT_PERIODS, reportPeriodKeySchema, reportPeriodOf, reportPeriodQuerySchema, type ReportPeriodKey } from "../src/reportPeriod.js";
import { membersReportFrom, membersReportSchema, newCountedFrom, type MembersReportFacts, type ReportMonthCounts } from "../src/reports.js";
import { moneyReportFrom, moneyReportSchema, type MoneyMonthOfType, type MoneyReportFacts } from "../src/reportsMoney.js";

describe("the days a period covers", () => {
  // Days anybody can check on a calendar.
  it.each<[ReportPeriodKey, string, string]>([
    ["4w", "2026-10-13", "2026-09-16"],
    ["4w", "2026-03-10", "2026-02-11"],
    ["4w", "2024-03-10", "2024-02-12"],
    ["4w", "2026-01-05", "2025-12-09"],
    ["3m", "2026-10-13", "2026-08-01"],
    ["3m", "2026-10-01", "2026-08-01"],
    ["3m", "2026-10-31", "2026-08-01"],
    ["3m", "2026-01-15", "2025-11-01"],
    ["3m", "2026-02-28", "2025-12-01"],
    ["3m", "2026-03-31", "2026-01-01"],
    ["12m", "2026-10-13", "2025-11-01"],
    ["12m", "2026-12-31", "2026-01-01"],
    ["12m", "2026-01-01", "2025-02-01"],
    ["12m", "2024-02-29", "2023-03-01"],
  ])("%s on %s is counted from %s", (key, today, from) => {
    expect(reportPeriodOf(key, today)).toEqual({ key, from, to: today });
  });

  it("four weeks are 28 days, three months 3 calendar months and twelve months 12, on every day of four years", () => {
    for (let on = 0; on < 1461; on += 1) {
      const today = addDays("2024-01-01", on);
      expect(daysBetween(reportPeriodOf("4w", today).from, today)).toBe(27);
      for (const [key, months] of [["3m", 3], ["12m", 12]] as const) {
        const from = reportPeriodOf(key, today).from;
        expect(from.slice(8), today).toBe("01");
        const apart = (Number(today.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(from.slice(5, 7));
        expect(apart, today).toBe(months - 1);
      }
    }
  });

  it("only the three choices are a period, and a read that names none is twelve months", () => {
    expect(REPORT_PERIODS).toEqual(["4w", "3m", "12m"]);
    expect(reportPeriodQuerySchema.parse({})).toEqual({ period: "12m" });
    expect(reportPeriodQuerySchema.parse({ period: "4w" })).toEqual({ period: "4w" });
    for (const not of ["", "1y", "12M", "4W", "all", "3m ", "0", "365"]) expect(reportPeriodKeySchema.safeParse(not).success, not).toBe(false);
    expect(reportPeriodQuerySchema.safeParse({ period: "12m", from: "2020-01-01" }).success).toBe(false);
    expect(reportPeriodQuerySchema.safeParse({ period: ["4w", "12m"] }).success).toBe(false);
  });
});

const TODAY = "2026-10-13";

function monthsTo(today: string, each: (month: string) => Partial<ReportMonthCounts>): ReportMonthCounts[] {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out: ReportMonthCounts[] = [];
  for (let i = 0; i < 12; i += 1) {
    const key = `${String(year)}-${String(month).padStart(2, "0")}`;
    out.unshift({ month: key, activeAtStart: 100, joined: 0, left: 0, leftOfStart: 0, ...each(key) });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

function members(over: Partial<MembersReportFacts>): ReturnType<typeof membersReportFrom> {
  return membersReportSchema.parse(
    membersReportFrom({
      timezone: "Europe/London",
      today: TODAY,
      period: "12m",
      firstListedOn: "2024-03-04",
      listChangedOn: "2026-10-01",
      activeNow: 100,
      everLeft: true,
      months: monthsTo(TODAY, () => ({ joined: 4, left: 2, leftOfStart: 2 })),
      inPeriod: { joined: 0, left: 0 },
      stay: { leavers: 0, totalDays: 0 },
      leads: [],
      anyLead: false,
      yearEarlier: { joined: 0, left: 0, stay: { leavers: 0, totalDays: 0 }, leads: 0, leadsJoined: 0 },
      firstLeadOn: null,
      ...over,
    }),
  );
}

describe("the members figures follow the period", () => {
  it.each<[ReportPeriodKey, string[]]>([
    ["4w", ["2026-09", "2026-10"]],
    ["3m", ["2026-08", "2026-09", "2026-10"]],
    ["12m", ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]],
  ])("%s lists the months it touches, and no other", (period, months) => {
    const r = members({ period, inPeriod: { joined: 7, left: 3 } });
    expect(r.period).toEqual(reportPeriodOf(period, TODAY));
    expect(r.months.map((m) => m.month)).toEqual(months);
    expect(r.inPeriod).toEqual({ joined: 7, joinedFrom: r.period.from, left: 3 });
  });

  it("churn and retention keep their own three full months whatever the period", () => {
    const of = (period: ReportPeriodKey) => {
      const r = members({ period });
      return [r.churnMonths, r.churn, r.retention];
    };
    expect(of("4w")).toEqual(of("12m"));
    expect(of("3m")).toEqual(of("12m"));
    expect(of("12m")[0]).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  it("a list younger than the period is shown from its own first month", () => {
    const r = members({ period: "12m", firstListedOn: "2026-08-20", inPeriod: { joined: 9, left: 1 } });
    expect(r.months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    // The people a gym first puts on its list are not new members: new is counted from the month after.
    expect(r.inPeriod).toEqual({ joined: 9, joinedFrom: "2026-09-01", left: 1 });
  });

  it("a list that began this month has no new figure in any period, never a zero", () => {
    for (const period of REPORT_PERIODS) {
      expect(members({ period, firstListedOn: "2026-10-02", inPeriod: { joined: 0, left: 0 } }).inPeriod).toEqual({ joined: null, joinedFrom: null, left: 0 });
    }
    expect(members({ firstListedOn: null, listChangedOn: null, inPeriod: { joined: 0, left: 0 } }).inPeriod.joined).toBeNull();
  });

  it.each<[string | null, string, string | null]>([
    [null, "2026-08-01", null],
    ["2024-03-04", "2026-08-01", "2026-08-01"],
    ["2026-07-31", "2026-08-01", "2026-08-01"],
    ["2026-08-01", "2026-08-01", "2026-09-01"],
    ["2026-09-30", "2026-09-16", "2026-10-01"],
    ["2026-12-15", "2026-12-01", "2027-01-01"],
  ])("a list begun on %s, in a period from %s, counts new members from %s", (first, from, expected) => {
    expect(newCountedFrom(first, from)).toBe(expected);
  });
});

const paid = (month: string, paidMinor: number, periodPaidMinor: number, refundedMinor = 0, periodRefundedMinor = 0, typeId = "gold"): MoneyMonthOfType => ({
  typeId,
  typeName: typeId.toUpperCase(),
  month,
  paidMinor,
  refundedMinor,
  periodPaidMinor,
  periodRefundedMinor,
});

function money(over: Partial<MoneyReportFacts>) {
  const report = moneyReportSchema.parse(
    moneyReportFrom({
      timezone: "Europe/London",
      today: TODAY,
      period: "12m",
      currency: "GBP",
      anyMembership: true,
      firstPaidOn: "2025-01-10",
      otherCurrency: false,
      overdueAfterDays: 0,
      held: [],
      months: [],
      owed: { currentMinor: 0, currentPeople: 0, listPeople: 0, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 },
      members: { today: TODAY, firstListedOn: "2024-03-04", everLeft: false, months: monthsTo(TODAY, () => ({})) },
      yearEarlier: { paidMinor: 0, refundedMinor: 0 },
      ...over,
    }),
  );
  if (report.state !== "ok") throw new Error("no figures");
  return report;
}

describe("the money figures follow the period", () => {
  it("collected is the part of each month that falls in the period, never the whole of the months listed", () => {
    // Four weeks from 16 September: September took 9,000, of which 4,000 from the 16th on.
    const r = money({
      period: "4w",
      months: [paid("2026-08", 7000, 0), paid("2026-09", 9000, 4000, 1000, 500), paid("2026-10", 3000, 3000, 200, 200), paid("2026-09", 600, 0, 0, 0, "day")],
    });
    expect(r.period).toEqual({ key: "4w", from: "2026-09-16", to: TODAY });
    expect(r.inPeriod).toEqual({ paidMinor: 7000, refundedMinor: 700, netMinor: 6300 });
    // The months listed are whole months, each its own true figure.
    expect(r.months).toEqual([
      { month: "2026-09", paidMinor: 9600, refundedMinor: 1000, netMinor: 8600 },
      { month: "2026-10", paidMinor: 3000, refundedMinor: 200, netMinor: 2800 },
    ]);
    expect(r.thisMonth).toEqual({ month: "2026-10", paidMinor: 3000, refundedMinor: 200, netMinor: 2800 });
    // A membership with no money in the period and none in use is not listed.
    expect(r.types).toEqual([{ name: "GOLD", inUse: 0, monthlyMinor: 0, monthNetMinor: 2800, periodNetMinor: 6300 }]);
  });

  it.each<[ReportPeriodKey, number, number]>([
    ["3m", 3, 19000],
    ["12m", 12, 26000],
  ])("%s lists %i months, and they add up to what the period collected", (period, months, net) => {
    const inside = (month: string) => month >= reportPeriodOf(period, TODAY).from.slice(0, 7);
    const rows = [paid("2026-01", 7000, 0), paid("2026-08", 7000, 0), paid("2026-09", 9000, 0), paid("2026-10", 3000, 0)].map((row) =>
      inside(row.month) ? { ...row, periodPaidMinor: row.paidMinor } : row,
    );
    const r = money({ period, months: rows });
    expect(r.months).toHaveLength(months);
    expect(r.inPeriod.netMinor).toBe(net);
    expect(r.months.reduce((sum, m) => sum + m.netMinor, 0)).toBe(net);
  });

  it("the period gave back more than it took: a figure below zero, said as it is", () => {
    const r = money({ period: "4w", months: [paid("2026-10", 1000, 1000, 2500, 2500)] });
    expect(r.inPeriod).toEqual({ paidMinor: 1000, refundedMinor: 2500, netMinor: -1500 });
  });

  it("a gym whose first payment is inside the period is listed from that month", () => {
    const r = money({ period: "12m", firstPaidOn: "2026-09-20", months: [paid("2026-09", 500, 500)] });
    expect(r.months.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
  });

  it("recurring revenue, what is owed and lifetime value do not move with the period", () => {
    const base: Partial<MoneyReportFacts> = {
      months: [paid("2026-07", 50000, 0), paid("2026-08", 50000, 0), paid("2026-09", 50000, 0)],
      owed: { currentMinor: 4000, currentPeople: 2, listPeople: 3, pastMinor: 0, pastPeople: 0, overdueMinor: 1000, overduePeople: 1 },
      members: { today: TODAY, firstListedOn: "2024-03-04", everLeft: true, months: monthsTo(TODAY, (m) => (m >= "2026-07" && m <= "2026-09" ? { left: 5, leftOfStart: 5 } : {})) },
    };
    const still = (period: ReportPeriodKey) => {
      const r = money({ ...base, period });
      return [r.recurring, r.owed, r.lifetimeValue];
    };
    expect(still("4w")).toEqual(still("12m"));
    expect(still("3m")).toEqual(still("12m"));
    expect(still("12m")[2]).toEqual({ state: "ok", minor: 10000, months: ["2026-07", "2026-08", "2026-09"], leavers: 15 });
  });
});
