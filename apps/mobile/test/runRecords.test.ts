// Running records' rules on the phone (ROADMAP 37c-ii): which records a run just finished beats, against the
// server's, and their words. The worst thing: a New record claimed that the run did not set.
import { describe, expect, it } from "vitest";
import type { RunRecords } from "@app/shared";
import { beatWords, newRecords, shownKinds, shownRecords } from "../src/screens/running/runRecords";

const held = (value: number, before: number | null = null) => ({
  runId: "7d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed", name: "Old Run", startedAt: "2026-10-01T01:00:00.000Z", day: "2026-10-01", value, before,
});
const NONE: RunRecords = { k1: null, mile: null, k5: null, k10: null, longest: null };
const bests = (k1: number | null, mile: number | null, k5: number | null, k10: number | null) => ({ k1, mile, k5, k10 });

describe("which records a run beats", () => {
  it("only strictly faster or longer: a tie keeps the old record, as the server does", () => {
    const records: RunRecords = { k1: held(300), mile: held(480), k5: held(1600), k10: null, longest: held(6000) };
    expect(newRecords(bests(300, 470, 1601, null), 6000, records, "metric")).toEqual([]);
    expect(newRecords(bests(299, 470, 1599, null), 6001, records, "metric").map((r) => r.kind)).toEqual(["k1", "k5", "longest"]);
  });

  it("a first run sets every record it covers; a 10K it did not run is never claimed", () => {
    expect(newRecords(bests(320, 520, 1700, null), 5400, NONE, "metric")).toEqual([
      { kind: "k1", value: 320, before: null },
      { kind: "k5", value: 1700, before: null },
      { kind: "longest", value: 5400, before: null },
    ]);
  });

  it("in miles the mile is the record, never the kilometre", () => {
    expect(newRecords(bests(320, 520, null, null), 1700, NONE, "imperial").map((r) => r.kind)).toEqual(["mile", "longest"]);
    expect(shownKinds("imperial")).toEqual(["mile", "k5", "k10", "longest"]);
  });

  it("the longest run counts from 200 m, the streak's own line", () => {
    expect(newRecords(bests(null, null, null, null), 199, NONE, "metric")).toEqual([]);
    expect(newRecords(bests(null, null, null, null), 200, NONE, "metric")).toEqual([{ kind: "longest", value: 200, before: null }]);
  });
});

describe("the words", () => {
  it("say how much better, in seconds, minutes or the person's units", () => {
    expect(beatWords("k5", 1660, 1702, "metric")).toBe("42 seconds faster than your last best.");
    expect(beatWords("k5", 1600, 1601, "metric")).toBe("1 second faster than your last best.");
    expect(beatWords("k10", 3500, 3640, "metric")).toBe("2:20 faster than your last best.");
    expect(beatWords("longest", 6210, 5000, "metric")).toBe("1.21 km longer than your last best.");
    expect(beatWords("longest", 6210, 5000, "imperial")).toBe("0.75 mi longer than your last best.");
    expect(beatWords("k1", 300, null, "metric")).toBeNull();
  });

  it("a longest run beaten by under a hundredth of the unit says metres or feet, never 0.00", () => {
    expect(beatWords("longest", 5008, 5000, "metric")).toBe("8 metres longer than your last best.");
    expect(beatWords("longest", 5001, 5000, "metric")).toBe("1 metre longer than your last best.");
    expect(beatWords("longest", 5010, 5000, "metric")).toBe("0.01 km longer than your last best.");
    expect(beatWords("longest", 5010, 5000, "imperial")).toBe("33 feet longer than your last best.");
    expect(beatWords("longest", 5017, 5000, "imperial")).toBe("0.01 mi longer than your last best.");
  });

  it("a record not set says what it takes", () => {
    expect(shownRecords(NONE, "metric").map((r) => [r.name, r.value, r.takes])).toEqual([
      ["Fastest 1K", null, "Run 1 km to set it."],
      ["Fastest 5K", null, "Run 5 km to set it."],
      ["Fastest 10K", null, "Run 10 km to set it."],
      ["Longest run", null, "Go for a run to set it."],
    ]);
  });
});
