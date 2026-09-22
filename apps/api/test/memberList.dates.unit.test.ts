// Reading a gym's dates (spec Part 3 §11.3), cell by cell and column by column.
//
// 03/04/2026 is two different days, and the whole design is that NO CELL EVER
// DECIDES: the order is settled once for a column, from the file's own evidence
// where it has any, else from the gym's country, and said back to staff with a
// real cell of the column beside it. These tests cover the rule underneath;
// `memberList.wider.unit.test.ts` covers it over whole files.
//
// Two-digit years follow Excel's own rule — 00 to 29 is this century, 30 to 99
// the last — because that is the rule the gym's file was written under. It is a
// rule and not a guess, which is what lets this file have no clock in it.
import { describe, expect, it } from "vitest";
import { countryOrder, dayOf, evidenceInColumn, evidenceOf, looksLikeADate, readDay, settleOrder } from "../src/modules/orgs/memberList/dates.js";

describe("one cell", () => {
  it.each([
    ["an ISO day", "2026-04-03", "2026-04-03"],
    ["an ISO day with a time", "2026-04-03T00:00:00Z", "2026-04-03"],
    ["an ISO day with a space and a time", "2026-04-03 09:30:00", "2026-04-03"],
    ["a year first with slashes", "2026/04/03", "2026-04-03"],
    ["a day first with slashes", "03/04/2026", "2026-04-03"],
    ["a day first with dots", "03.04.2026", "2026-04-03"],
    ["a day first with dashes", "03-04-2026", "2026-04-03"],
    ["a day over twelve, whatever the column said", "25/12/2025", "2025-12-25"],
    ["a month written out after the day", "3 Apr 2026", "2026-04-03"],
    ["a month written out in full", "3 April 2026", "2026-04-03"],
    ["an ordinal", "3rd April 2026", "2026-04-03"],
    ["Sept", "3 Sept 2026", "2026-09-03"],
    ["a two-digit year in this century", "03/04/26", "2026-04-03"],
    ["a two-digit year in the last one", "03/04/98", "1998-04-03"],
    ["the pivot's own edge, 29", "03/04/29", "2029-04-03"],
    ["the pivot's own edge, 30", "03/04/30", "1930-04-03"],
  ])("reads %s", (_what, cell, day) => {
    expect(readDay(cell, "dayFirst")).toBe(day);
  });

  it.each([
    ["a month written out before the day", "April 3, 2026", "2026-04-03"],
    ["a month first with slashes", "04/03/2026", "2026-04-03"],
  ])("reads %s under a month-first column", (_what, cell, day) => {
    expect(readDay(cell, "monthFirst")).toBe(day);
  });

  it("reads the same two numbers as two different days, which is the whole point", () => {
    expect(readDay("03/04/2026", "dayFirst")).toBe("2026-04-03");
    expect(readDay("03/04/2026", "monthFirst")).toBe("2026-03-04");
  });

  it.each([
    ["an empty cell", ""],
    ["a word", "not known"],
    ["a day February never had", "31/02/2026"],
    ["a thirty-first of April", "31/04/2026"],
    ["a month past twelve either way round", "13/13/2026"],
    ["a year before 1900", "03/04/1899"],
    ["a year past 2099", "03/04/2100"],
    ["a phone number", "9876543210"],
    ["a member number with dashes", "123-45-6789"],
    ["a price", "1,200.00"],
    ["a month nobody writes", "3 Smarch 2026"],
  ])("leaves %s empty rather than guessing", (_what, cell) => {
    expect(readDay(cell, "dayFirst")).toBe(null);
    expect(readDay(cell, "monthFirst")).toBe(null);
    expect(looksLikeADate(cell)).toBe(false);
  });

  it("keeps 29 February only in a leap year", () => {
    expect(dayOf(2024, 2, 29)).toBe("2024-02-29");
    expect(dayOf(2025, 2, 29)).toBe(null);
    expect(dayOf(2000, 2, 29)).toBe("2000-02-29");
    expect(dayOf(1900, 2, 29)).toBe(null);
  });
});

describe("what one cell proves about its column", () => {
  it.each([
    ["a first part over twelve", "25/12/2025", "dayFirst"],
    ["a second part over twelve", "12/25/2025", "monthFirst"],
    ["two numbers under thirteen", "03/04/2026", "either"],
    ["an ISO day, which says its own order", "2026-04-03", "none"],
    ["a year first with slashes", "2026/04/03", "none"],
    ["a month written out", "3 Apr 2026", "none"],
    ["a word", "not known", "none"],
    ["nothing", "", "none"],
  ])("%s proves %s", (_what, cell, proves) => {
    expect(evidenceOf(cell)).toBe(proves);
  });
});

describe("a whole column's order", () => {
  // Driven through the column's own CELLS, not through a hand-written list of
  // verdicts: a test of `settleOrder` alone could never have caught the window
  // this rule reads them over (review of PR #90, High 5 and test note 5).
  const order = (cells: readonly string[], country: string | null, chosen: "dayFirst" | "monthFirst" | null = null) =>
    settleOrder(evidenceInColumn(cells), country, chosen);

  it("takes the file's own evidence over the country", () => {
    expect(order(["03/04/2026", "25/12/2025", "05/06/2026"], "US")).toEqual({ order: "dayFirst", from: "file" });
    expect(order(["03/04/2026", "12/25/2025"], "IN")).toEqual({ order: "monthFirst", from: "file" });
  });

  it("falls back to the country where the file says nothing either way", () => {
    expect(order(["03/04/2026", "05/06/2026"], "IN")).toEqual({ order: "dayFirst", from: "country" });
    expect(order(["03/04/2026", "05/06/2026"], "US")).toEqual({ order: "monthFirst", from: "country" });
    expect(order(["03/04/2026"], null)).toEqual({ order: "dayFirst", from: "country" });
  });

  it("falls back to the country where the file contradicts itself — two rows cannot both be right", () => {
    expect(order(["25/12/2025", "12/25/2025"], "IN")).toEqual({ order: "dayFirst", from: "country" });
    expect(order(["25/12/2025", "12/25/2025"], "US")).toEqual({ order: "monthFirst", from: "country" });
  });

  it("says nothing was decided where every cell said its own order", () => {
    expect(order(["2026-04-03", "3 Apr 2026"], "IN")).toEqual({ order: "dayFirst", from: "none" });
    expect(order([], "IN")).toEqual({ order: "dayFirst", from: "none" });
  });

  it("lets staff's own switch beat both", () => {
    expect(order(["25/12/2025"], "IN", "monthFirst")).toEqual({ order: "monthFirst", from: "chosen" });
    expect(order(["12/25/2025"], "US", "dayFirst")).toEqual({ order: "dayFirst", from: "chosen" });
  });

  it("READS EVERY ROW OF THE COLUMN, not its first two hundred cells", () => {
    // The fault, exactly as the review drove it: 250 cells that could be read
    // either way round, and the one cell that settles it sitting past the
    // sample. Before the fix this was answered by the gym's country — and a US
    // gym's 250 join dates were read month-first while the file said the
    // opposite, and the preview told staff the country had decided.
    const late = [...Array.from({ length: 250 }, () => "02/05/2024"), "25/12/2024"];
    expect(order(late, "US")).toEqual({ order: "dayFirst", from: "file" });
    expect(order(late, "IN")).toEqual({ order: "dayFirst", from: "file" });
  });

  it("stops reading once the column has contradicted itself", () => {
    // Nothing past the contradiction can change the answer, so a million-row
    // column costs two cells.
    const cells = { read: 0, *[Symbol.iterator](): Generator<string> { for (const cell of ["25/12/2025", "12/25/2025", "03/04/2026"]) { this.read++; yield cell; } } };
    expect(settleOrder(evidenceInColumn(cells), "IN", null)).toEqual({ order: "dayFirst", from: "country" });
    expect(cells.read).toBe(2);
  });
});

describe("which way round a country writes a date", () => {
  it.each(["US", "us", "PH", "GU", "PR"])("%s writes the month first", (country) => {
    expect(countryOrder(country)).toBe("monthFirst");
  });

  it.each(["IN", "GB", "AU", "NZ", "IE", "CA", "ZA", "SG", "AE", null])("%s writes the day first", (country) => {
    expect(countryOrder(country)).toBe("dayFirst");
  });
});
