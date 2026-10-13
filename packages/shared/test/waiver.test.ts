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
    ["a first waiver, 12 people in the app", { savedText: null, inUse: false, draft: saved, people: 12 }, "All 12 people in the app will be asked to sign it."],
    ["a first waiver, 1 person in the app", { savedText: null, inUse: false, draft: saved, people: 1 }, "The 1 person in the app will be asked to sign it."],
    ["changed words", { savedText: saved, inUse: true, draft: `${saved} And more.`, people: 12 }, "All 12 people in the app will be asked to sign again, because the words have changed."],
    ["changed words while it is not in use", { savedText: saved, inUse: false, draft: `${saved} And more.`, people: 3 }, "All 3 people in the app will be asked to sign it."],
    ["the same words while it is not in use", { savedText: saved, inUse: false, draft: saved, people: 3 }, "People in the app who have not signed these words will be asked to sign."],
  ])("%s", (_case, input, line) => {
    expect(waiverSaveAsks(input)).toBe(line);
  });

  it.each([
    ["the same words, in use", { savedText: saved, inUse: true, draft: saved, people: 12 }],
    ["the same words with other line ends and spaces", { savedText: "One\nTwo", inUse: true, draft: " One\r\nTwo \r\n", people: 12 }],
    ["nothing typed", { savedText: saved, inUse: true, draft: "  ", people: 12 }],
    ["nobody in the app", { savedText: null, inUse: false, draft: saved, people: 0 }],
  ])("asks nobody: %s", (_case, input) => {
    expect(waiverSaveAsks(input)).toBeNull();
  });
});
