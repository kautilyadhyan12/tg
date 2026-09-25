// NOBODY THE LIST SAYS IS UNDER 18 IS INVITED (RULINGS 2026-09-24; ROADMAP 5b-ii).
//
// The worst thing this job could do to a real person: email a 16-year-old on a family
// plan an invitation into an app that is for 18 and over. The birthdays below are the
// ones a gym's export holds — a junior on a family plan, somebody turning 18 today or
// tomorrow, a leap-day birthday — read on the GYM's own calendar day, not the server's.
import { describe, expect, it } from "vitest";
import { underAgeAt, underAgeOn } from "../src/modules/orgs/invites/age.js";

describe("underAgeOn — the list's date of birth against the gym's today", () => {
  const cases: [string, string | null, string, boolean][] = [
    ["a junior on a family plan, 16", "2010-03-14", "2026-09-25", true],
    ["17, the day before turning 18", "2008-09-26", "2026-09-25", true],
    ["18 today", "2008-09-25", "2026-09-25", false],
    ["18 yesterday", "2008-09-24", "2026-09-25", false],
    ["an adult parent", "1979-06-02", "2026-09-25", false],
    // 18 years after a leap year is never a leap year, so the 29th is not there.
    ["born 29 February: still 17 on 28 February", "2008-02-29", "2026-02-28", true],
    ["born 29 February: 18 on 1 March", "2008-02-29", "2026-03-01", false],
    ["born 28 February: 18 on 28 February", "2008-02-28", "2026-02-28", false],
    ["born 31 December, the day before", "2008-12-31", "2026-12-30", true],
    ["born 31 December, 18 that day", "2008-12-31", "2026-12-31", false],
    ["born 1 January, 18 that day", "2008-01-01", "2026-01-01", false],
    ["a date of birth in the future (a typo) is not an adult", "2027-01-01", "2026-09-25", true],
    ["a date of birth of today (a typo) is not an adult", "2026-09-25", "2026-09-25", true],
    ["born in 1900", "1900-01-01", "2026-09-25", false],
    ["no date of birth on the list: invited as before", null, "2026-09-25", false],
    // The database writes ISO dates; any other shape (a changed DateStyle) cannot be judged.
    ["a date in another shape is not taken as an adult", "14/03/1990", "2026-09-25", true],
    ["a date with a time on it is not taken as an adult", "1990-03-14 00:00:00", "2026-09-25", true],
  ];
  for (const [name, dateOfBirth, today, under] of cases) {
    it(name, () => {
      expect(underAgeOn(dateOfBirth, today)).toBe(under);
    });
  }
});

describe("underAgeAt — the day is the GYM's, not the server's", () => {
  // 20:00 on 24 September in London is already 25 September in Auckland.
  const instant = new Date("2026-09-24T20:00:00Z");
  it("a gym in Auckland: the person turned 18 today", () => {
    expect(underAgeAt("2008-09-25", instant, "Pacific/Auckland")).toBe(false);
  });
  it("a gym in Los Angeles: it is still the day before", () => {
    expect(underAgeAt("2008-09-25", instant, "America/Los_Angeles")).toBe(true);
  });
});
