// The Reports page's money figures (ROADMAP 21b-i; spec Part 3 §16.5): the rule that turns
// a gym's notebook into monthly recurring revenue, collected, owed and lifetime value, or
// says why there is none.
import { describe, expect, it } from "vitest";
import type { HeldMembership } from "../src/heldMemberships.js";
import { REPORT_MONTHS, membersReportFrom, type ReportMonthCounts } from "../src/reports.js";
import {
  moneyReportFrom,
  moneyReportSchema,
  monthlyMinorOf,
  type MoneyFigures,
  type MoneyHeld,
  type MoneyMonthOfType,
  type MoneyReportFacts,
} from "../src/reportsMoney.js";

const TODAY = "2026-10-20";

function monthsTo(today: string, named: Record<string, Partial<ReportMonthCounts>> = {}): ReportMonthCounts[] {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out: ReportMonthCounts[] = [];
  for (let i = 0; i < REPORT_MONTHS; i += 1) {
    const key = `${String(year)}-${String(month).padStart(2, "0")}`;
    out.unshift({ month: key, activeAtStart: 100, joined: 0, left: 0, leftOfStart: 0, ...named[key] });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

const membership = (over: Partial<HeldMembership> = {}): HeldMembership => ({
  kind: "recurring",
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  free: false,
  startsOn: "2026-10-01",
  frozenDays: 0,
  status: "active",
  frozenOn: null,
  cancelledOn: null,
  paidPeriods: 1,
  paidFloor: 0,
  renews: true,
  classesLeft: null,
  ...over,
});

const held = (typeId: string, priceMinor: number, over: Partial<HeldMembership> = {}): MoneyHeld => ({
  typeId,
  typeName: typeId.toUpperCase(),
  priceMinor,
  membership: membership(over),
});

const money = (typeId: string, month: string, paidMinor: number, refundedMinor = 0): MoneyMonthOfType => ({
  typeId,
  typeName: typeId.toUpperCase(),
  month,
  paidMinor,
  refundedMinor,
  // Twelve months hold every month the notebook is read over.
  periodPaidMinor: paidMinor,
  periodRefundedMinor: refundedMinor,
});

/** A gym a year into its list, three members leaving in each of the months churn reads. */
const LEAVING = { "2026-07": { leftOfStart: 3, left: 3 }, "2026-08": { leftOfStart: 3, left: 3 }, "2026-09": { leftOfStart: 4, left: 4 } };

function facts(over: Partial<MoneyReportFacts> = {}): MoneyReportFacts {
  return {
    timezone: "Europe/London",
    today: TODAY,
    period: "12m",
    currency: "GBP",
    anyMembership: true,
    anySale: false,
    firstSoldOn: null,
    firstPaidOn: "2026-01-10",
    otherCurrency: false,
    overdueAfterDays: 0,
    held: [],
    months: [],
    sales: [],
    products: [],
    staff: [],
    owed: { currentMinor: 0, currentPeople: 0, listPeople: 0, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 },
    members: { today: TODAY, firstListedOn: "2026-01-05", everLeft: true, months: monthsTo(TODAY, LEAVING) },
    yearEarlier: { paidMinor: 0, soldMinor: 0, refundedMinor: 0 },
    ...over,
  };
}

const report = (over: Partial<MoneyReportFacts> = {}) => moneyReportSchema.parse(moneyReportFrom(facts(over)));
const figures = (over: Partial<MoneyReportFacts> = {}): MoneyFigures => {
  const r = report(over);
  if (r.state !== "ok") throw new Error(`no figures: ${r.state}`);
  return r;
};

describe("a price as one month", () => {
  it.each([
    ["1 month", { kind: "recurring", termCount: 1, termUnit: "month" }, 4999, 4999],
    ["3 months", { kind: "recurring", termCount: 3, termUnit: "month" }, 12000, 4000],
    ["3 months, not a whole penny", { kind: "recurring", termCount: 3, termUnit: "month" }, 10000, 3333],
    ["1 year", { kind: "recurring", termCount: 1, termUnit: "year" }, 48000, 4000],
    ["2 years", { kind: "recurring", termCount: 2, termUnit: "year" }, 48000, 2000],
    ["1 week", { kind: "recurring", termCount: 1, termUnit: "week" }, 1200, 5200],
    ["2 weeks", { kind: "recurring", termCount: 2, termUnit: "week" }, 1200, 2600],
    ["4 weeks is not a month", { kind: "recurring", termCount: 4, termUnit: "week" }, 4000, 4333],
    ["free", { kind: "recurring", termCount: 1, termUnit: "month" }, 0, 0],
    ["paid once", { kind: "one_time", termCount: 1, termUnit: "month" }, 6000, null],
    ["a trial", { kind: "trial", termCount: 7, termUnit: "day" }, 500, null],
    ["a pack", { kind: "pack", termCount: null, termUnit: null }, 9000, null],
    ["a term the rule does not know", { kind: "recurring", termCount: 30, termUnit: "day" }, 3000, null],
  ] as const)("%s", (_name, m, price, want) => {
    expect(monthlyMinorOf(m, price)).toBe(want);
  });
});

describe("monthly recurring revenue: only a repeating membership in use today", () => {
  const cases: [string, MoneyHeld, { monthlyMinor: number; memberships: number }, number][] = [
    ["paid and running", held("g", 4999), { monthlyMinor: 4999, memberships: 1 }, 1],
    ["running and owing: still theirs to pay", held("g", 4999, { startsOn: "2026-08-01", paidPeriods: 1 }), { monthlyMinor: 4999, memberships: 1 }, 1],
    ["set to stop at the end of what is paid, not there yet", held("g", 4999, { renews: false }), { monthlyMinor: 4999, memberships: 1 }, 1],
    ["set to stop, and the paid days are over", held("g", 4999, { startsOn: "2026-08-01", renews: false }), { monthlyMinor: 0, memberships: 0 }, 0],
    ["frozen", held("g", 4999, { status: "frozen", frozenOn: "2026-10-05" }), { monthlyMinor: 0, memberships: 0 }, 0],
    ["starts next week", held("g", 4999, { startsOn: "2026-10-27", paidPeriods: 0 }), { monthlyMinor: 0, memberships: 0 }, 0],
    ["cancelled", held("g", 4999, { status: "cancelled", cancelledOn: "2026-10-10" }), { monthlyMinor: 0, memberships: 0 }, 0],
    ["ended", held("g", 4999, { status: "ended" }), { monthlyMinor: 0, memberships: 0 }, 0],
    ["free", held("g", 0, { free: true, paidPeriods: 0 }), { monthlyMinor: 0, memberships: 0 }, 1],
    ["paid once, in use", held("g", 6000, { kind: "one_time" }), { monthlyMinor: 0, memberships: 0 }, 1],
    ["paid once, its month over", held("g", 6000, { kind: "one_time", startsOn: "2026-08-01" }), { monthlyMinor: 0, memberships: 0 }, 0],
    ["a pack with classes left", held("g", 9000, { kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, classesLeft: 4 }), { monthlyMinor: 0, memberships: 0 }, 1],
  ];
  it.each(cases)("%s", (_name, one, want, inUse) => {
    const r = figures({ held: [one] });
    expect(r.recurring).toEqual(want);
    expect(r.types.reduce((sum, t) => sum + t.inUse, 0)).toBe(inUse);
    expect(r.types.reduce((sum, t) => sum + t.monthlyMinor, 0)).toBe(want.monthlyMinor);
  });

  it("adds up across types, each row its own", () => {
    const r = figures({ held: [held("gold", 4999), held("gold", 4999), held("annual", 48000, { termUnit: "year" }), held("day", 6000, { kind: "one_time" })] });
    expect(r.recurring).toEqual({ monthlyMinor: 13998, memberships: 3 });
    expect(r.types.map((t) => [t.name, t.inUse, t.monthlyMinor])).toEqual([
      ["GOLD", 2, 9998],
      ["ANNUAL", 1, 4000],
      ["DAY", 1, 0],
    ]);
  });
});

describe("collected: payments less refunds, month by month", () => {
  it("sums each month over its types, from the month of the first payment", () => {
    const r = figures({
      firstPaidOn: "2026-08-15",
      months: [money("gold", "2026-08", 10000), money("day", "2026-08", 6000), money("gold", "2026-09", 10000, 2500), money("day", "2026-10", 0, 6000), money("gold", "2026-10", 4999)],
    });
    expect(r.months).toEqual([
      { month: "2026-08", paidMinor: 16000, soldMinor: 0, refundedMinor: 0, netMinor: 16000 },
      { month: "2026-09", paidMinor: 10000, soldMinor: 0, refundedMinor: 2500, netMinor: 7500 },
      { month: "2026-10", paidMinor: 4999, soldMinor: 0, refundedMinor: 6000, netMinor: -1001 },
    ]);
    expect(r.thisMonth).toEqual({ month: "2026-10", paidMinor: 4999, soldMinor: 0, refundedMinor: 6000, netMinor: -1001 });
    expect(r.types).toEqual([
      { name: "GOLD", inUse: 0, monthlyMinor: 0, monthNetMinor: 4999, periodNetMinor: 22499 },
      { name: "DAY", inUse: 0, monthlyMinor: 0, monthNetMinor: -6000, periodNetMinor: 0 },
    ]);
  });

  it("a month with nothing is a zero between two with something, and twelve at most are shown", () => {
    const r = figures({ firstPaidOn: "2025-03-02", months: [money("gold", "2025-11", 500), money("gold", "2026-01", 700)] });
    expect(r.months).toHaveLength(12);
    expect(r.months[0]).toEqual({ month: "2025-11", paidMinor: 500, soldMinor: 0, refundedMinor: 0, netMinor: 500 });
    expect(r.months[1]).toEqual({ month: "2025-12", paidMinor: 0, soldMinor: 0, refundedMinor: 0, netMinor: 0 });
    expect(r.months[11]?.month).toBe("2026-10");
  });

  it("a month after today's is not this gym's yet", () => {
    const r = figures({ months: [money("gold", "2026-11", 9999), money("gold", "2026-10", 100)] });
    expect(r.thisMonth.paidMinor).toBe(100);
    expect(r.types[0]?.periodNetMinor).toBe(100);
  });

  it("a type has a row while it is in use or money moved on it, even where it all went back", () => {
    const r = figures({ held: [held("old", 4999, { status: "cancelled", cancelledOn: "2026-09-01" })], months: [money("gold", "2026-10", 100, 100), money("idle", "2026-10", 0, 0)] });
    expect(r.types.map((t) => t.name)).toEqual(["GOLD"]);
  });
});

describe("no figures, and why", () => {
  it.each([
    ["no membership ever given", { anyMembership: false, firstPaidOn: null }, "no_memberships"],
    ["a country we do not serve", { currency: null }, "no_memberships"],
    ["memberships, and no payment recorded", { firstPaidOn: null }, "no_payments"],
    ["memberships owing, and no payment recorded", { firstPaidOn: null, owed: { currentMinor: 9999, currentPeople: 2, listPeople: 2, pastMinor: 0, pastPeople: 0, overdueMinor: 9999, overduePeople: 2 } }, "no_payments"],
  ] as const)("%s", (_name, over, state) => {
    expect(report(over)).toEqual({ state, timezone: "Europe/London", today: TODAY });
  });
});

describe("lifetime value: the money of churn's months for each member who left in them", () => {
  const quarter = [money("gold", "2026-07", 300000), money("gold", "2026-08", 310000, 10000), money("gold", "2026-09", 400000)];

  it("is given over the same months as churn, and agrees with money a member over churn", () => {
    const f = facts({ months: quarter });
    const r = figures({ months: quarter });
    expect(r.lifetimeValue).toEqual({ state: "ok", minor: 100000, months: ["2026-07", "2026-08", "2026-09"], leavers: 10 });
    const members = membersReportFrom({ ...f.members, period: "12m", inPeriod: { joined: 0, left: 0 }, timezone: f.timezone, listChangedOn: null, activeNow: 100, stay: { leavers: 0, totalDays: 0 }, leads: [], anyLead: false, yearEarlier: { joined: 0, late: 0, lateOn: null } });
    expect(members.churnMonths).toEqual(["2026-07", "2026-08", "2026-09"]);
    if (members.churn.state !== "ok") throw new Error("no churn");
    // 1,000,000 over 300 member-months is 3,333.33 a member a month; churn is 10 in 300.
    const aMonth = 1000000 / 300;
    // The page's churn is rounded to a tenth of a percent, so the two agree to within 2%.
    expect(Math.abs(aMonth / (members.churn.percent / 100) / 100000 - 1)).toBeLessThan(0.02);
  });

  const cases: [string, Partial<MoneyReportFacts>, string][] = [
    ["nobody has ever left", { members: { today: TODAY, firstListedOn: "2026-01-05", everLeft: false, months: monthsTo(TODAY) } }, "nobody_left"],
    ["nobody left in those three months", { members: { today: TODAY, firstListedOn: "2026-01-05", everLeft: true, months: monthsTo(TODAY, { "2026-03": { leftOfStart: 5, left: 5 } }) } }, "nobody_left"],
    ["the list is two full months old", { members: { today: TODAY, firstListedOn: "2026-08-01", everLeft: true, months: monthsTo(TODAY, LEAVING) } }, "not_enough_data"],
    ["the list is three full months old: enough", { members: { today: TODAY, firstListedOn: "2026-07-01", everLeft: true, months: monthsTo(TODAY, LEAVING) } }, "ok"],
    ["payments began on the first day of those months: enough", { firstPaidOn: "2026-07-01" }, "ok"],
    ["payments began a day into those months", { firstPaidOn: "2026-07-02" }, "not_enough_data"],
    ["payments began this month", { firstPaidOn: "2026-10-03" }, "not_enough_data"],
    [
      "nobody was on the list as those months began",
      { members: { today: TODAY, firstListedOn: "2026-01-05", everLeft: true, months: monthsTo(TODAY).map((m) => ({ ...m, activeAtStart: 0 })) } },
      "nobody_at_start",
    ],
    ["those months gave back as much as they took", { months: [money("gold", "2026-08", 5000, 5000), money("gold", "2026-10", 9000)] }, "nothing_collected"],
  ];
  it.each(cases)("%s", (_name, over, state) => {
    expect(figures({ months: quarter, ...over }).lifetimeValue.state).toBe(state);
  });
});

describe("what is carried through as the database counted it", () => {
  it("owed, the grace period and the other-currency note", () => {
    const r = figures({
      otherCurrency: true,
      overdueAfterDays: 14,
      owed: { currentMinor: 12997, currentPeople: 2, listPeople: 5, pastMinor: 6000, pastPeople: 1, overdueMinor: 13998, overduePeople: 3 },
    });
    expect(r.otherCurrency).toBe(true);
    expect(r.owed).toEqual({ minor: 12997, people: 2, listOnlyPeople: 3, pastMinor: 6000, pastPeople: 1, overdueMinor: 13998, overduePeople: 3, overdueAfterDays: 14 });
  });

  it.each([
    ["the list counts the same people as the bills", 2, 2, 0],
    ["the list counts people with no bill here", 2, 6, 4],
    ["only the list counts anybody", 0, 3, 3],
    ["the list counts fewer than the bills: never below nought", 3, 2, 0],
  ])("people marked Payment due with no bill here: %s", (_name, currentPeople, listPeople, want) => {
    const r = figures({ owed: { currentMinor: 100 * currentPeople, currentPeople, listPeople, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 } });
    expect(r.owed.listOnlyPeople).toBe(want);
    expect(r.owed.people).toBe(currentPeople);
  });
});

const sale = (month: string, soldMinor: number, periodSoldMinor = soldMinor) => ({ month, soldMinor, periodSoldMinor });

describe("products sold at the desk (21b-ii)", () => {

  it.each<[string, Partial<MoneyReportFacts>, string]>([
    ["no membership given and nothing sold", { anyMembership: false }, "no_memberships"],
    ["no membership given, a product sold: figures", { anyMembership: false, anySale: true, firstPaidOn: null, firstSoldOn: "2026-10-02" }, "ok"],
    ["memberships, no payment, a product sold: figures", { firstPaidOn: null, anySale: true, firstSoldOn: "2026-09-30" }, "ok"],
    ["a product sold once, then taken back: nothing stands", { anyMembership: false, anySale: true, firstPaidOn: null, firstSoldOn: null }, "no_payments"],
    ["a sale in a country we do not serve", { currency: null, anySale: true, firstSoldOn: "2026-10-02" }, "no_memberships"],
  ])("%s", (_name, over, state) => {
    expect(report(over).state).toBe(state);
  });

  it("are in collected, each month and the period, beside membership payments; the first day is the earlier of the two", () => {
    const r = figures({
      period: "3m",
      firstPaidOn: "2026-09-10",
      firstSoldOn: "2026-08-20",
      anySale: true,
      months: [money("gold", "2026-09", 4999), money("gold", "2026-10", 4999, 1000)],
      sales: [sale("2026-08", 750), sale("2026-09", 300), sale("2026-10", 1250)],
    });
    expect(r.firstPaidOn).toBe("2026-08-20");
    expect(r.months).toEqual([
      { month: "2026-08", paidMinor: 0, soldMinor: 750, refundedMinor: 0, netMinor: 750 },
      { month: "2026-09", paidMinor: 4999, soldMinor: 300, refundedMinor: 0, netMinor: 5299 },
      { month: "2026-10", paidMinor: 4999, soldMinor: 1250, refundedMinor: 1000, netMinor: 5249 },
    ]);
    expect(r.thisMonth).toEqual({ month: "2026-10", paidMinor: 4999, soldMinor: 1250, refundedMinor: 1000, netMinor: 5249 });
    expect(r.inPeriod).toEqual({ paidMinor: 9998, soldMinor: 2300, refundedMinor: 1000, netMinor: 11298 });
    // The months listed add up to the period's own figure.
    expect(r.months.reduce((sum, m) => sum + m.netMinor, 0)).toBe(r.inPeriod.netMinor);
  });

  it("only the part of a month inside the period is counted, and a month after today never", () => {
    const r = figures({ period: "4w", anySale: true, firstSoldOn: "2026-01-02", sales: [sale("2026-09", 900, 400), sale("2026-10", 600), sale("2026-11", 5000)] });
    expect(r.inPeriod.soldMinor).toBe(1000);
    expect(r.months.map((m) => m.soldMinor)).toEqual([900, 600]);
  });

  // A year earlier, three months: 1 Aug to 20 Oct 2025. "Old" records began on or before
  // 1 Aug 2025, "new" ones after it; each part is set beside its own history.
  const SPAN = { from: "2025-08-01", to: "2025-10-20" };
  const THEN = { paidMinor: 10000, soldMinor: 2500, refundedMinor: 500 };
  const PAID_NOW = [money("gold", "2026-09", 4999)];
  const SOLD_NOW = [sale("2026-09", 1200)];
  it.each<[string, Partial<MoneyReportFacts>, unknown]>([
    ["payments old, sales old, both now: both counted", { firstPaidOn: "2025-01-10", firstSoldOn: "2025-06-01", months: PAID_NOW, sales: SOLD_NOW }, { state: "ok", ...SPAN, ...THEN, netMinor: 12000 }],
    ["payments old, sales new this period: no figure, and when the first sale was", { firstPaidOn: "2025-01-10", firstSoldOn: "2026-10-02", months: PAID_NOW, sales: SOLD_NOW }, { state: "no_sales_history", ...SPAN, since: "2026-10-02" }],
    ["payments old, a sale began inside the span, none now: sales left out of both sides", { firstPaidOn: "2025-01-10", firstSoldOn: "2025-09-01", months: PAID_NOW, sales: [] }, { state: "ok", ...SPAN, paidMinor: 10000, soldMinor: 0, refundedMinor: 500, netMinor: 9500 }],
    ["sales old, payments new this period: no figure, and when the first payment was", { firstPaidOn: "2026-10-05", firstSoldOn: "2025-07-15", months: [money("gold", "2026-10", 4000)], sales: SOLD_NOW }, { state: "no_history", ...SPAN, since: "2026-10-05" }],
    ["sales old, payments inside the span, none now: payments left out of both sides", { firstPaidOn: "2025-09-01", firstSoldOn: "2025-07-15", months: [], sales: SOLD_NOW }, { state: "ok", ...SPAN, paidMinor: 0, soldMinor: 2500, refundedMinor: 0, netMinor: 2500 }],
    ["only a refund now, payments new: no figure", { firstPaidOn: "2025-09-01", firstSoldOn: "2025-07-15", months: [money("gold", "2026-09", 0, 700)], sales: [] }, { state: "no_history", ...SPAN, since: "2025-09-01" }],
    ["both new: no figure, from the first payment", { firstPaidOn: "2025-09-01", firstSoldOn: "2025-08-15", months: PAID_NOW, sales: SOLD_NOW }, { state: "no_history", ...SPAN, since: "2025-09-01" }],
    ["desk only, sales new: no figure, from the first sale", { anyMembership: false, firstPaidOn: null, firstSoldOn: "2025-08-15", months: [], sales: SOLD_NOW }, { state: "no_sales_history", ...SPAN, since: "2025-08-15" }],
    ["desk only, sales old", { anyMembership: false, firstPaidOn: null, firstSoldOn: "2025-08-01", months: [], sales: SOLD_NOW }, { state: "ok", ...SPAN, paidMinor: 0, soldMinor: 2500, refundedMinor: 0, netMinor: 2500 }],
    ["payments only, old, never a sale", { firstPaidOn: "2025-01-10", firstSoldOn: null, months: PAID_NOW, sales: [] }, { state: "ok", ...SPAN, paidMinor: 10000, soldMinor: 0, refundedMinor: 500, netMinor: 9500 }],
  ])("a year earlier: %s", (_name, over, want) => {
    expect(figures({ period: "3m", anySale: true, yearEarlier: THEN, ...over }).yearEarlier).toEqual(want);
  });

  it("lifetime value is membership money only: a sale may be a walk-in's", () => {
    const quarter = [money("gold", "2026-07", 300000), money("gold", "2026-08", 310000, 10000), money("gold", "2026-09", 400000)];
    const without = figures({ months: quarter }).lifetimeValue;
    const withSales = figures({ months: quarter, anySale: true, firstSoldOn: "2026-07-01", sales: [sale("2026-07", 90000), sale("2026-08", 90000), sale("2026-09", 90000)] }).lifetimeValue;
    expect(withSales).toEqual(without);
    expect(withSales).toEqual({ state: "ok", minor: 100000, months: ["2026-07", "2026-08", "2026-09"], leavers: 10 });
  });

  it("products: the most money first, then the most sold, then by name; none sold is not listed", () => {
    const r = figures({
      anySale: true,
      firstSoldOn: "2026-02-01",
      products: [
        { productId: "a", name: "Water", sold: 40, minor: 4000 },
        { productId: "b", name: "Shake", sold: 10, minor: 4000 },
        { productId: "c", name: "Bar", sold: 20, minor: 4000 },
        { productId: "d", name: "Towel", sold: 1, minor: 1500 },
        { productId: "e", name: "Gloves", sold: 2, minor: 9000 },
        { productId: "f", name: "Old stock", sold: 0, minor: 0 },
      ],
    });
    expect(r.products).toEqual([
      { name: "Gloves", sold: 2, minor: 9000 },
      { name: "Water", sold: 40, minor: 4000 },
      { name: "Bar", sold: 20, minor: 4000 },
      { name: "Shake", sold: 10, minor: 4000 },
      { name: "Towel", sold: 1, minor: 1500 },
    ]);
  });

  it("staff: payments and sales each recorded, the most first, an account since deleted last, nobody with nothing", () => {
    const r = figures({
      staff: [
        { userId: null, name: null, login: null, paidMinor: 99999, soldMinor: 0 },
        { userId: "u1", name: "Ravi", login: "ravi", paidMinor: 5000, soldMinor: 500 },
        { userId: "u2", name: "Asha", login: "asha", paidMinor: 0, soldMinor: 9000 },
        { userId: "u3", name: "Ben", login: "ben", paidMinor: 5500, soldMinor: 0 },
        { userId: "u4", name: "Cat", login: "cat", paidMinor: 0, soldMinor: 0 },
      ],
    });
    expect(r.staff).toEqual([
      { name: "Asha", paidMinor: 0, soldMinor: 9000, totalMinor: 9000 },
      { name: "Ben", paidMinor: 5500, soldMinor: 0, totalMinor: 5500 },
      { name: "Ravi", paidMinor: 5000, soldMinor: 500, totalMinor: 5500 },
      { name: null, paidMinor: 99999, soldMinor: 0, totalMinor: 99999 },
    ]);
  });
});

describe("two staff with the same name (21b-ii, round one)", () => {
  it("each has the part of their email before the @ beside it; a name nobody shares is left alone", () => {
    const r = figures({
      staff: [
        { userId: "a", name: "Sam", login: "sam.k", paidMinor: 5000, soldMinor: 0 },
        { userId: "b", name: "Sam", login: "sam.b", paidMinor: 0, soldMinor: 300 },
        { userId: "c", name: "Ravi", login: "ravi", paidMinor: 100, soldMinor: 0 },
        { userId: "d", name: "Ravi", login: "ravi.p", paidMinor: 0, soldMinor: 0 },
      ],
    });
    expect(r.staff.map((m) => m.name)).toEqual(["Sam (sam.k)", "Sam (sam.b)", "Ravi"]);
  });
});
