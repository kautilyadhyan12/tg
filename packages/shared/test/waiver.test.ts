// A gym's waiver (ROADMAP 3e-i): what is kept of the words a gym pastes and of the name a
// person types, and who Settings says a save will ask.
import { describe, expect, it } from "vitest";
import {
  WAIVER_MAX_CHARS,
  acceptInvitationBodySchema,
  cleanSignedName,
  cleanWaiverText,
  saveGymWaiverBodySchema,
  signWaiverBodySchema,
  waiverReadyToSign,
  waiverSaveAsks,
} from "../src/index.js";

const ID = "7d3f5a10-2b4c-4e6d-8f9a-0b1c2d3e4f5a";

describe("the gym's words as kept", () => {
  it("keeps the words and their blank lines, with one kind of line end and no space at either end", () => {
    expect(cleanWaiverText("  Title\r\n\r\n1. One\r2. Two\n\n ")).toBe("Title\n\n1. One\n2. Two");
    expect(saveGymWaiverBodySchema.parse({ text: "\r\nI agree.\r\n" })).toEqual({ text: "I agree." });
  });

  it("drops the characters a database refuses, and keeps tabs, new lines and a language's own direction marks", () => {
    expect(cleanWaiverText("One\u0000Two\u0007\n\tThree")).toBe("OneTwo\n\tThree");
    expect(saveGymWaiverBodySchema.parse({ text: "I agree.\u0000" })).toEqual({ text: "I agree." });
    expect(saveGymWaiverBodySchema.safeParse({ text: "\u0000\u0000" }).success).toBe(false);
    expect(cleanWaiverText("\u200F\u05E9\u05DC\u05D5\u05DD")).toBe("\u200F\u05E9\u05DC\u05D5\u05DD");
  });

  it("refuses nothing but spaces, more than the most kept, and anything that is not text", () => {
    for (const text of ["", " \r\n\t ", "x".repeat(WAIVER_MAX_CHARS + 1), 7, null]) {
      expect(saveGymWaiverBodySchema.safeParse({ text }).success).toBe(false);
    }
    expect(saveGymWaiverBodySchema.safeParse({ text: "x".repeat(WAIVER_MAX_CHARS) }).success).toBe(true);
    // Spaces around the longest waiver do not push it over.
    expect(saveGymWaiverBodySchema.safeParse({ text: ` ${"x".repeat(WAIVER_MAX_CHARS)}\r\n` }).success).toBe(true);
  });
});

describe("the name a person types", () => {
  // Names as people write them: W3C's "Personal names around the world".
  it.each(["Björk Guðmundsdóttir", "María-José Carreño Quiñones", "Zhang Wei", "毛泽东", "O'Neill", "Li", "van der Berg"])("keeps %s as typed", (name) => {
    expect(cleanSignedName(`  ${name} `)).toBe(name);
    expect(signWaiverBodySchema.parse({ waiverId: ID, name }).name).toBe(name);
  });

  it("tidies the spaces and refuses a name that is not one", () => {
    expect(cleanSignedName(" Alice \t  Stone\n")).toBe("Alice Stone");
    for (const name of ["", " ", "A", " A ", "x".repeat(101), 5]) {
      expect(signWaiverBodySchema.safeParse({ waiverId: ID, name }).success).toBe(false);
    }
    expect(signWaiverBodySchema.safeParse({ waiverId: "nope", name: "Alice Stone" }).success).toBe(false);
  });

  // Round one, L1 to L3: what a database refuses or a screen cannot show is never a name.
  it("counts letters, not the bytes JavaScript counts: one letter is not a name, whatever plane it is on", () => {
    for (const name of ["\u{1D49C}", " \u{1D49C} ", "\u{1F600}\u{1F600}", "-- ", "A."]) {
      expect(signWaiverBodySchema.safeParse({ waiverId: ID, name }).success).toBe(false);
      expect(waiverReadyToSign(name, true)).toBe(false);
    }
    expect(signWaiverBodySchema.parse({ waiverId: ID, name: "\u{1D49C}\u{1D4B7}" }).name).toBe("\u{1D49C}\u{1D4B7}");
  });

  it("drops what nobody can see or a database refuses, and keeps the joiners some names are written with", () => {
    expect(cleanSignedName("Ann\u0000 Lee")).toBe("Ann Lee");
    expect(cleanSignedName("Ann\nLee")).toBe("Ann Lee");
    // A right-to-left override would draw the name backwards on a person's page.
    expect(cleanSignedName("\u202EeeL nnA")).toBe("eeL nnA");
    expect(cleanSignedName("\u2066Ann\u2069 \uFEFFLee\u200B")).toBe("Ann Lee");
    // Persian: the zero-width non-joiner inside a name is part of its spelling.
    expect(cleanSignedName("\u0639\u0644\u06CC\u200C\u0631\u0636\u0627")).toBe("\u0639\u0644\u06CC\u200C\u0631\u0636\u0627");
    for (const name of ["\u200B\u200B", "\u200C\u200D", "\u202E\u202C", "\u0000\u0000\u0000"]) {
      expect(signWaiverBodySchema.safeParse({ waiverId: ID, name }).success).toBe(false);
    }
  });

  // The re-check's Low: Unicode calls these letters, and a screen draws each as a blank.
  it("letters that are drawn as a blank are not a name: the Hangul fillers and the two unseen Khmer vowels", () => {
    for (const name of ["\u3164\u3164", "\u115F\u1160", "\uFFA0\uFFA0", "\u17B4\u17B5", "\u3164 \u1160"]) {
      expect(signWaiverBodySchema.safeParse({ waiverId: ID, name }).success).toBe(false);
      expect(waiverReadyToSign(name, true)).toBe(false);
    }
    expect(cleanSignedName("\u3164Kim\u3164 Min\uFFA0")).toBe("Kim Min");
    // Real Hangul is untouched.
    expect(signWaiverBodySchema.parse({ waiverId: ID, name: "\uAE40\uBBFC\uC900" }).name).toBe("\uAE40\uBBFC\uC900");
  });

  it("a screen may send a signature only with a name typed and the box ticked", () => {
    expect(waiverReadyToSign("Alice Stone", true)).toBe(true);
    expect(waiverReadyToSign("Alice Stone", false)).toBe(false);
    expect(waiverReadyToSign(" A ", true)).toBe(false);
    expect(waiverReadyToSign("", true)).toBe(false);
  });

  it("Join takes no signature, or a whole one", () => {
    expect(acceptInvitationBodySchema.parse({})).toEqual({});
    expect(acceptInvitationBodySchema.parse({ waiver: { id: ID, name: " Alice  Stone " } })).toEqual({ waiver: { id: ID, name: "Alice Stone" } });
    for (const body of [{ waiver: { id: ID } }, { waiver: { name: "Alice Stone" } }, { waiver: { id: ID, name: "Alice Stone", agreed: true } }, { other: 1 }]) {
      expect(acceptInvitationBodySchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("who a save asks to sign, said before Save", () => {
  const saved = "I take part at my own risk.";

  it.each([
    ["a first waiver, 12 people in the app", { savedText: null, inUse: false, draft: saved, people: 12, signed: 0 }, "All 12 people in the app will be asked to sign it."],
    ["a first waiver, 1 person in the app", { savedText: null, inUse: false, draft: saved, people: 1, signed: 0 }, "The 1 person in the app will be asked to sign it."],
    ["changed words", { savedText: saved, inUse: true, draft: `${saved} And more.`, people: 12, signed: 3 }, "All 12 people in the app will be asked to sign again, because the words have changed."],
    ["changed words that nobody has signed yet", { savedText: saved, inUse: true, draft: `${saved} And more.`, people: 12, signed: 0 }, "All 12 people in the app will be asked to sign it."],
    ["changed words while it is not in use", { savedText: saved, inUse: false, draft: `${saved} And more.`, people: 3, signed: 2 }, "All 3 people in the app will be asked to sign it."],
    ["the same words while it is not in use", { savedText: saved, inUse: false, draft: saved, people: 3, signed: 1 }, "People in the app who have not signed these words will be asked to sign."],
  ])("%s", (_case, input, line) => {
    expect(waiverSaveAsks(input)).toBe(line);
  });

  it.each([
    ["the same words, in use", { savedText: saved, inUse: true, draft: saved, people: 12, signed: 3 }],
    ["the same words with other line ends and spaces", { savedText: "One\nTwo", inUse: true, draft: " One\r\nTwo \r\n", people: 12, signed: 3 }],
    ["nothing typed", { savedText: saved, inUse: true, draft: "  ", people: 12, signed: 3 }],
    ["nobody in the app", { savedText: null, inUse: false, draft: saved, people: 0, signed: 0 }],
  ])("asks nobody: %s", (_case, input) => {
    expect(waiverSaveAsks(input)).toBeNull();
  });
});
