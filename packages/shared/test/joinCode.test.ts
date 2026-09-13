// The code a poster link carries, as the web keeps it through sign-in and setup.
import { describe, expect, it } from "vitest";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, linkedJoinCodeSchema, normaliseJoinCode } from "../src/index.js";

const parse = (raw: unknown) => linkedJoinCodeSchema.safeParse(raw);

describe("linkedJoinCodeSchema", () => {
  it("keeps a code the server could have made, in capitals", () => {
    expect(parse("K7QM2X")).toEqual({ success: true, data: "K7QM2X" });
    expect(parse("k7qm2x")).toEqual({ success: true, data: "K7QM2X" });
  });

  it("normalises spaces and dashes the way the server's lookup does", () => {
    expect(parse(" k7q-m2x ")).toEqual({ success: true, data: "K7QM2X" });
    expect(parse("K7Q M2X")).toEqual({ success: true, data: "K7QM2X" });
  });

  // `normaliseJoinCode` is the function the server's lookup calls
  // (`apps/api/src/modules/orgs/service.ts`), so a link's code and a typed one
  // are cleaned by the same rule, not by two copies of it.
  it("cleans a code with normaliseJoinCode, the server's own rule", () => {
    for (const typed of [" k7q-m2x ", "K7Q M2X", "\tk7-q7-m2\n", "K-7-Q-M-2-X", "k7qm2x"]) {
      const cleaned = normaliseJoinCode(typed);
      expect(cleaned).toHaveLength(JOIN_CODE_LENGTH);
      expect(parse(typed)).toEqual({ success: true, data: cleaned });
    }
    for (const typed of ["k7q.m2x", "K7QM2X!", "K7_QM2X"]) {
      expect(normaliseJoinCode(typed)).not.toMatch(new RegExp(`^[${JOIN_CODE_ALPHABET}]{${String(JOIN_CODE_LENGTH)}}$`));
      expect(parse(typed).success).toBe(false);
    }
  });

  it("refuses a code of the wrong length", () => {
    expect(parse("K7QM2").success).toBe(false);
    expect(parse("K7QM2XA").success).toBe(false);
    expect(parse("").success).toBe(false);
    expect(parse("AIHG-24KQ7B").success).toBe(false);
  });

  it("refuses the four look-alikes the alphabet leaves out", () => {
    for (const bad of ["0", "O", "1", "I"]) {
      expect(JOIN_CODE_ALPHABET.includes(bad)).toBe(false);
      expect(parse(`K7QM2${bad}`).success).toBe(false);
    }
  });

  it("refuses words someone typed into the link", () => {
    expect(parse("CALL US NOW").success).toBe(false);
    expect(parse("555 0100").success).toBe(false);
    expect(parse("<b>HI</b>").success).toBe(false);
    expect(parse("K7QM2X?").success).toBe(false);
  });

  it("refuses anything that is not a string", () => {
    expect(parse(null).success).toBe(false);
    expect(parse(undefined).success).toBe(false);
    expect(parse(123456).success).toBe(false);
    expect(parse(["K7QM2X"]).success).toBe(false);
  });

  it("follows the alphabet and length the server generates from", () => {
    const every = JOIN_CODE_ALPHABET.slice(0, JOIN_CODE_LENGTH);
    expect(parse(every)).toEqual({ success: true, data: every });
    const last = JOIN_CODE_ALPHABET.slice(-JOIN_CODE_LENGTH);
    expect(parse(last)).toEqual({ success: true, data: last });
  });
});
