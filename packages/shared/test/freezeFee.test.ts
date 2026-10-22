// A fee while frozen (spec Part 3 §14.8; ROADMAP Stage 2 item 18z).
//
// The first block is the worst thing this job could do to a real person: charge a member twice for
// the same frozen days, or for days they were not frozen. Every day from the freeze on falls in
// exactly one month, the first starts on the freeze day, each starts the day after the last ended,
// and nothing is charged before the freeze. The hand cases were read off a calendar.
import { describe, expect, it } from "vitest";
import { addDays, freezeFeeApplies, freezeFeeMonth } from "../src/index.js";

describe("the month a freeze is charged for", () => {
  it("every day from the freeze on is in exactly one month: no day charged twice or missed, over freezes on every day of 2027 and 2028", () => {
    for (let freeze = "2027-01-01"; freeze <= "2028-12-31"; freeze = addDays(freeze, 1)) {
      expect(freezeFeeMonth(freeze, addDays(freeze, -1))).toBeNull();
      let month = freezeFeeMonth(freeze, freeze);
      expect(month?.from).toBe(freeze);
      let months = 1;
      for (let day = addDays(freeze, 1); day <= addDays(freeze, 370); day = addDays(day, 1)) {
        const now = freezeFeeMonth(freeze, day);
        if (now === null || month === null) throw new Error(`no month for ${day}`);
        expect(now.from <= day && day <= now.to).toBe(true);
        if (now.from !== month.from) {
          // A new month begins the day after the last one ended, on the day it moved to.
          expect(now.from).toBe(addDays(month.to, 1));
          expect(now.from).toBe(day);
          months += 1;
        } else {
          expect(now.to).toBe(month.to);
        }
        month = now;
      }
      // 371 days from the freeze hold exactly 13 month starts: twelve months on is 365 or 366 days, thirteen at least 393.
      expect(months).toBe(13);
    }
  });

  it.each([
    ["2026-10-22", "2026-10-22", "2026-10-22", "2026-11-21"],
    ["2026-10-22", "2026-11-21", "2026-10-22", "2026-11-21"],
    ["2026-10-22", "2026-11-22", "2026-11-22", "2026-12-21"],
    ["2026-10-22", "2027-01-05", "2026-12-22", "2027-01-21"],
    // A month's end: 31 Jan, 28 Feb, 31 Mar, each counted from the freeze day.
    ["2027-01-31", "2027-02-27", "2027-01-31", "2027-02-27"],
    ["2027-01-31", "2027-02-28", "2027-02-28", "2027-03-30"],
    ["2027-01-31", "2027-03-31", "2027-03-31", "2027-04-29"],
    // A leap year.
    ["2028-01-30", "2028-02-29", "2028-02-29", "2028-03-29"],
    ["2028-02-29", "2029-02-28", "2029-02-28", "2029-03-28"],
    // Across a year.
    ["2026-12-15", "2027-01-15", "2027-01-15", "2027-02-14"],
  ])("frozen on %s, on %s the month is %s to %s", (frozenOn, today, from, to) => {
    expect(freezeFeeMonth(frozenOn, today)).toEqual({ from, to });
  });

  it("nothing before the freeze", () => {
    expect(freezeFeeMonth("2026-10-22", "2026-10-21")).toBeNull();
    expect(freezeFeeMonth("2026-10-22", "2025-12-31")).toBeNull();
  });
});

describe("which memberships a freeze fee is charged on", () => {
  it.each([
    ["renewing, with a price", { kind: "recurring", renews: true, free: false }, true],
    ["set to stop at the end of what is paid", { kind: "recurring", renews: false, free: false }, false],
    ["renewing and free", { kind: "recurring", renews: true, free: true }, false],
    ["paid once", { kind: "one_time", renews: false, free: false }, false],
    ["a class pack", { kind: "pack", renews: false, free: false }, false],
    ["a trial", { kind: "trial", renews: false, free: false }, false],
  ] as const)("%s: %s", (_name, m, charged) => {
    expect(freezeFeeApplies(m)).toBe(charged);
  });
});
