// THE NEXT MEMBER NUMBER — the table test for the pure rule (ROADMAP 5e-i; Kd,
// 2026-10-15: "typing member number by hand is nightmare").
//
// The first block is the worst thing this job could do to a real person: hand out a
// number somebody already holds, so the front desk finds a stranger when it searches
// that number. Every case below is checked against it, not only the cases written for it.
//
// The numbers are written the way gyms have them, not in the rule's own patterns:
// Mindbody client IDs staff edited ("SOK1234" → "XSOK1234", spec §11.4), a Google
// Sheets export's zero-padded "Member No" (`test/fixtures/member-list/google`), key
// fobs and barcodes, a year in front, lower case typed at a desk, and styles the rule
// has never heard of (Arabic-Indic digits, a letter after the number, no digits at all).
// Membership software continues from the highest number taken, never fills a gap, and
// keeps the zeros in front (Tendenci, Yapla, Centerbase's numbering help, 2026-10-16).
import { describe, expect, it } from "vitest";
import { keptWith, nextMemberNumber } from "../src/modules/orgs/memberList/memberNumbers.js";

interface Case {
  name: string;
  held: string[];
  next: string | null;
}

const CASES: Case[] = [
  // ── a gym with no numbers ──
  { name: "a new gym starts at 1", held: [], next: "1" },
  { name: "numbers with no digits at the end are not a sequence", held: ["GOLD", "VIP-A", "ABC"], next: "1" },
  { name: "Arabic-Indic digits are not read as a number", held: ["١٢٣"], next: "1" },
  { name: "a letter after the number is not continued", held: ["17B", "17C"], next: "1" },

  // ── plain numbers ──
  { name: "plain numbers continue from the highest", held: ["1", "2", "3"], next: "4" },
  { name: "a gap is never filled", held: ["1", "2", "9"], next: "10" },
  { name: "the order they were added does not matter", held: ["1042", "7", "1041", "300"], next: "1043" },
  { name: "1999 becomes 2000", held: ["1999"], next: "2000" },
  { name: "GymMaster-style numbers from 10001", held: ["10001", "10002", "10150"], next: "10151" },

  // ── zeros in front ──
  { name: "a Google Sheets export's 000123 keeps its zeros", held: ["000123", "000124"], next: "000125" },
  { name: "0999 becomes 1000, the same width", held: ["0999"], next: "1000" },
  { name: "9999 becomes 10000, one wider", held: ["9999"], next: "10000" },
  { name: "one typed without the zeros still gets the widest", held: ["000123", "124"], next: "000125" },
  { name: "0042 and 43 are the same sequence", held: ["0042", "43"], next: "0044" },

  // ── letters in front ──
  { name: "M0041 becomes M0042", held: ["M0040", "M0041"], next: "M0042" },
  { name: "Mindbody's SOK1234 continues", held: ["SOK1233", "SOK1234"], next: "SOK1235" },
  { name: "a dash after the letters is kept", held: ["GM-1001", "GM-1002"], next: "GM-1003" },
  { name: "a year in front is part of the prefix", held: ["2024-0045", "2024-0046"], next: "2024-0047" },
  { name: "lower case typed at a desk is the same prefix, written as most write it", held: ["M0039", "M0040", "m0041"], next: "M0042" },
  { name: "a tie of spellings is written as the highest number writes it", held: ["m0040", "M0041"], next: "M0042" },

  // ── two styles in one gym: the one most members have ──
  {
    name: "Mindbody staff edited a few to XSOK: the SOK sequence has more",
    held: ["SOK1233", "SOK1234", "SOK1235", "XSOK1236"],
    next: "SOK1236",
  },
  { name: "plain numbers outnumber a few typed with letters", held: ["101", "102", "103", "A1", "A2"], next: "104" },
  { name: "letters outnumber plain numbers", held: ["A1", "A2", "A3", "900"], next: "A4" },
  { name: "a tie goes to the style with the larger number", held: ["A5", "A6", "100", "101"], next: "102" },
  { name: "a tie of size and number goes to the first prefix in the alphabet", held: ["B7", "A7"], next: "A8" },
  { name: "words without digits do not count against a style", held: ["GOLD", "GOLD", "GOLD", "12"], next: "13" },

  // ── key fobs and barcodes ──
  { name: "a 12-digit barcode continues without losing a digit", held: ["000123456789", "000123456790"], next: "000123456791" },
  {
    name: "a number past what a JavaScript number holds exactly",
    held: ["90071992547409931"],
    next: "90071992547409932",
  },

  // ── the 64-character cap ──
  { name: "a next number over 64 characters is none", held: ["9".repeat(64)], next: null },
  { name: "a next number of exactly 64 characters is given", held: [`A${"8".repeat(63)}`], next: `A${"8".repeat(62)}9` },
];

describe("the next member number never belongs to anybody (the worst thing)", () => {
  it.each(CASES)("$name", ({ held }) => {
    const given = nextMemberNumber(held);
    if (given === null) return;
    const taken = new Set(held.map((number) => number.toLowerCase()));
    expect(taken.has(given.toLowerCase())).toBe(false);
  });

  /** A gym's life, step by step: each number given or gone is kept by `keptWith`, as the
   *  server keeps it, and no number given is ever one somebody had. */
  const lifeOf = (steps: ({ give: true } | { type: string } | { gone: string })[]): string[] => {
    const members: string[] = [];
    let kept: Record<string, string> = {};
    const ever = new Set<string>();
    const given: string[] = [];
    const keep = (number: string) => {
      kept = keptWith(kept, number) ?? kept;
    };
    for (const step of steps) {
      if ("give" in step) {
        const next = nextMemberNumber(members, Object.values(kept));
        if (next === null) throw new Error("no number");
        expect(ever.has(next.toLowerCase()), `${next} was somebody's`).toBe(false);
        members.push(next);
        ever.add(next.toLowerCase());
        given.push(next);
        keep(next);
      } else if ("type" in step) {
        members.push(step.type);
        ever.add(step.type.toLowerCase());
      } else {
        members.splice(members.indexOf(step.gone), 1);
        keep(step.gone);
      }
    }
    return given;
  };

  it("a gym that switches style and back never gets a deleted number again (round one, High-1)", () => {
    // The reviewer's run: 1 2 3 given, 3 deleted for good, M1..M4 typed, M5 given, every M
    // number changed to a word: the plain sequence is the gym's again, and 3 is not given.
    const given = lifeOf([
      { give: true },
      { give: true },
      { give: true },
      { gone: "3" },
      { type: "M1" },
      { type: "M2" },
      { type: "M3" },
      { type: "M4" },
      { give: true },
      { gone: "M1" },
      { gone: "M2" },
      { gone: "M3" },
      { gone: "M4" },
      { gone: "M5" },
      { give: true },
      // And M comes back: M5 is not given again either.
      { type: "M1" },
      { type: "M2" },
      { type: "M3" },
      { give: true },
    ]);
    expect(given).toEqual(["1", "2", "3", "M5", "4", "M6"]);
  });

  it("a number that goes from a style that is not the gym's is kept too", () => {
    // A typed A900 deleted while the gym's numbers are plain; later the gym moves to A.
    const given = lifeOf([{ give: true }, { type: "A900" }, { gone: "A900" }, { type: "A1" }, { type: "A2" }, { give: true }]);
    expect(given).toEqual(["1", "A901"]);
  });

  it("a gym whose members all went continues where it was", () => {
    expect(lifeOf([{ give: true }, { give: true }, { gone: "1" }, { gone: "2" }, { give: true }])).toEqual(["1", "2", "3"]);
  });
});

describe("the next member number", () => {
  it.each(CASES)("$name", ({ held, next }) => {
    expect(nextMemberNumber(held)).toBe(next);
  });

  it("is the same whatever order the numbers come in", () => {
    const held = ["SOK1233", "XSOK1236", "SOK1235", "SOK1234", "A1"];
    expect(nextMemberNumber([...held].reverse())).toBe(nextMemberNumber(held));
    expect(nextMemberNumber(held, ["A7", "SOK2000"])).toBe(nextMemberNumber([...held].reverse(), ["SOK2000", "A7"]));
  });

  it("the kept numbers raise a sequence and never choose it (round one, Low-1)", () => {
    // The only member holds A1; a kept 7 of the plain sequence does not make it the gym's.
    expect(nextMemberNumber(["A1"], ["7"])).toBe("A2");
    // The plain sequence's kept 1050 lifts it above its members' 1049.
    expect(nextMemberNumber(["1048", "1049"], ["1050"])).toBe("1051");
    // Kept zeros in front outlive the members that had them.
    expect(nextMemberNumber(["124"], ["000123"])).toBe("000125");
    // A kept number of another case is the same sequence.
    expect(nextMemberNumber(["M0040"], ["m0050"])).toBe("M0051");
  });
});

describe("the kept numbers, one per sequence", () => {
  it("keeps a number in its own sequence and leaves the others", () => {
    expect(keptWith({}, "3")).toEqual({ "": "3" });
    expect(keptWith({ "": "3" }, "M5")).toEqual({ "": "3", m: "M5" });
    expect(keptWith({ "": "3", m: "M5" }, "4")).toEqual({ "": "4", m: "M5" });
  });

  it("never lowers what is kept, and keeps the wider width", () => {
    expect(keptWith({ "": "9" }, "4")).toBeNull();
    expect(keptWith({ "": "124" }, "000124")).toEqual({ "": "000124" });
    expect(keptWith({ "": "000124" }, "124")).toBeNull();
    expect(keptWith({ "": "000124" }, "130")).toEqual({ "": "000130" });
  });

  it("keeps nothing for a number in no sequence", () => {
    expect(keptWith({ "": "3" }, "Guest")).toBeNull();
    expect(keptWith({}, "17B")).toBeNull();
  });
});
