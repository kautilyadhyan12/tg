// What a bigger size costs now on a plan paid through Razorpay (ROADMAP Stage 3 item 1d-iii-a):
// the difference between the two monthly prices for the rest of the month paid. Every class of
// case, at the rupee price list (Kd, RULINGS 2026-09-29) and months of every length. No database.
import { describe, expect, it } from "vitest";
import { RAZORPAY_MIN_CHARGE_MINOR, upgradeCharge, type UpgradeCharge } from "../src/modules/billing/razorpayPlan.js";

const at = (iso: string) => new Date(iso);
const S = 1000;
const DAY = 24 * 60 * 60 * S;

// The rupee price list, in paise.
const UP_TO_200 = 750_000;
const UP_TO_500 = 1_250_000;
const UP_TO_1000 = 1_900_000;
const UP_TO_2000 = 3_650_000;

const OCT_1 = at("2026-10-01T06:30:00Z");
const NOV_1 = at("2026-11-01T06:30:00Z"); // a 31-day month, as Razorpay bills from the day paid

describe("upgradeCharge: the rest of the month paid, at the difference", () => {
  const cases: { name: string; from: number; to: number; start: Date; end: Date; now: Date; want: UpgradeCharge }[] = [
    {
      name: "half of a 30-day month left: half the difference",
      from: UP_TO_200,
      to: UP_TO_500,
      start: at("2026-11-01T00:00:00Z"),
      end: at("2026-12-01T00:00:00Z"),
      now: at("2026-11-16T00:00:00Z"),
      want: { kind: "charge", minor: 250_000 },
    },
    {
      name: "the month's first second: the whole difference",
      from: UP_TO_200,
      to: UP_TO_500,
      start: OCT_1,
      end: NOV_1,
      now: OCT_1,
      want: { kind: "charge", minor: 500_000 },
    },
    {
      name: "10 of 31 days left, two sizes up: ₹11,500 × 10/31",
      from: UP_TO_200,
      to: UP_TO_1000,
      start: OCT_1,
      end: NOV_1,
      now: new Date(NOV_1.getTime() - 10 * DAY),
      want: { kind: "charge", minor: Math.round((1_150_000 * 10) / 31) },
    },
    {
      name: "the smallest to the biggest, one second in",
      from: UP_TO_200,
      to: UP_TO_2000,
      start: OCT_1,
      end: NOV_1,
      now: new Date(OCT_1.getTime() + S),
      want: { kind: "charge", minor: Math.round((2_900_000 * (31 * 86_400 - 1)) / (31 * 86_400)) },
    },
    {
      name: "a 28-day February: a day left is a 28th",
      from: UP_TO_500,
      to: UP_TO_1000,
      start: at("2027-02-01T00:00:00Z"),
      end: at("2027-03-01T00:00:00Z"),
      now: at("2027-02-28T00:00:00Z"),
      want: { kind: "charge", minor: Math.round(650_000 / 28) },
    },
    {
      name: "milliseconds are dropped: counted to the second, as Razorpay stamps",
      from: UP_TO_200,
      to: UP_TO_500,
      start: at("2026-11-01T00:00:00Z"),
      end: at("2026-12-01T00:00:00Z"),
      now: at("2026-11-16T00:00:00.999Z"),
      want: { kind: "charge", minor: 250_000 },
    },
    {
      name: "half a paisa rounds up",
      from: 0,
      to: 201,
      start: at("2026-11-01T00:00:00Z"),
      end: at("2026-11-01T00:00:02Z"),
      now: at("2026-11-01T00:00:01Z"),
      want: { kind: "charge", minor: 101 },
    },
    {
      name: "exactly ₹1 is taken",
      from: 0,
      to: 200,
      start: at("2026-11-01T00:00:00Z"),
      end: at("2026-11-01T00:00:02Z"),
      now: at("2026-11-01T00:00:01Z"),
      want: { kind: "charge", minor: RAZORPAY_MIN_CHARGE_MINOR },
    },
    {
      name: "under ₹1 (the last second of the month): nothing taken now",
      from: UP_TO_200,
      to: UP_TO_500,
      start: OCT_1,
      end: NOV_1,
      now: new Date(NOV_1.getTime() - S),
      want: { kind: "free" },
    },
    {
      name: "a bigger size at the same price: nothing taken now",
      from: UP_TO_500,
      to: UP_TO_500,
      start: OCT_1,
      end: NOV_1,
      now: at("2026-10-15T00:00:00Z"),
      want: { kind: "free" },
    },
    {
      name: "a bigger size that costs less (a price list out of order): nothing taken, never a credit",
      from: UP_TO_1000,
      to: UP_TO_500,
      start: OCT_1,
      end: NOV_1,
      now: at("2026-10-15T00:00:00Z"),
      want: { kind: "free" },
    },
    {
      name: "a clock behind Razorpay's: the whole month, never more than the difference",
      from: UP_TO_200,
      to: UP_TO_500,
      start: OCT_1,
      end: NOV_1,
      now: new Date(OCT_1.getTime() - DAY),
      want: { kind: "charge", minor: 500_000 },
    },
    {
      name: "at the month's very end: no rest of it",
      from: UP_TO_200,
      to: UP_TO_500,
      start: OCT_1,
      end: NOV_1,
      now: NOV_1,
      want: { kind: "month_over" },
    },
    {
      name: "after the month's end (its renewal not yet written)",
      from: UP_TO_200,
      to: UP_TO_500,
      start: OCT_1,
      end: NOV_1,
      now: new Date(NOV_1.getTime() + DAY),
      want: { kind: "month_over" },
    },
    {
      name: "a month of no length",
      from: UP_TO_200,
      to: UP_TO_500,
      start: NOV_1,
      end: NOV_1,
      now: OCT_1,
      want: { kind: "month_over" },
    },
    {
      name: "a month that ends before it starts",
      from: UP_TO_200,
      to: UP_TO_500,
      start: NOV_1,
      end: OCT_1,
      now: OCT_1,
      want: { kind: "month_over" },
    },
  ];

  it.each(cases)("$name", ({ from, to, start, end, now, want }) => {
    expect(upgradeCharge({ fromMinor: from, toMinor: to, periodStart: start, periodEnd: end, now })).toEqual(want);
  });

  it("never charges more than the difference, and less as the month runs on", () => {
    let last = Number.POSITIVE_INFINITY;
    for (let day = 0; day <= 31; day += 1) {
      const got = upgradeCharge({ fromMinor: UP_TO_200, toMinor: UP_TO_2000, periodStart: OCT_1, periodEnd: NOV_1, now: new Date(OCT_1.getTime() + day * DAY) });
      const minor = got.kind === "charge" ? got.minor : 0;
      expect(minor).toBeLessThanOrEqual(UP_TO_2000 - UP_TO_200);
      expect(minor).toBeLessThanOrEqual(last);
      expect(Number.isInteger(minor)).toBe(true);
      last = minor;
    }
    expect(last).toBe(0);
  });
});
