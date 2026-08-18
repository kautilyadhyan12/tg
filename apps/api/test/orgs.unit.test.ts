// Orgs — pure helper unit suite (no database). Covers the join-code alphabet
// rule (Part 3 §4.0 step 4), the normalisation a poster-typed code goes
// through, and slug derivation for the worldwide names Part 3 §6.3 promises.
import { describe, expect, it } from "vitest";
import {
  COUNTRY_CURRENCY,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  SUPPORTED_COUNTRIES,
  currencyForCountry,
} from "@app/shared";
import { codeFromBytes, normaliseCode, slugCandidate, slugifyName } from "../src/modules/orgs/codes.js";

describe("join code alphabet (Part 3 §4.0 step 4)", () => {
  it("excludes every look-alike character the spec names", () => {
    for (const banned of ["0", "O", "1", "I"]) {
      expect(JOIN_CODE_ALPHABET).not.toContain(banned);
    }
  });

  it("has a length that divides 256, which is what makes the mapping unbiased", () => {
    // Not decoration: at 31 or 33 symbols `byte % length` favours the first
    // few symbols, and every other test in this file would still pass.
    expect(256 % JOIN_CODE_ALPHABET.length).toBe(0);
  });

  it("maps every possible byte value into the alphabet", () => {
    for (let b = 0; b < 256; b++) {
      const bytes = new Uint8Array(JOIN_CODE_LENGTH).fill(b);
      const code = codeFromBytes(bytes);
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      for (const ch of code) expect(JOIN_CODE_ALPHABET).toContain(ch);
    }
  });

  it("reaches all 32 symbols across the byte range (no dead symbols)", () => {
    const seen = new Set<string>();
    for (let b = 0; b < 256; b++) seen.add(codeFromBytes(new Uint8Array([b, b, b, b, b, b]))[0] ?? "");
    expect(seen.size).toBe(JOIN_CODE_ALPHABET.length);
  });

  it("is deterministic for the same bytes", () => {
    const bytes = new Uint8Array([0, 1, 31, 32, 200, 255]);
    expect(codeFromBytes(bytes)).toBe(codeFromBytes(bytes));
  });

  it("refuses short input rather than silently minting a weaker code", () => {
    expect(() => codeFromBytes(new Uint8Array([1, 2, 3]))).toThrow(/needs 6 bytes/);
  });

  it("mints a shorter token on request (the slug suffix)", () => {
    expect(codeFromBytes(new Uint8Array([0, 0, 0, 0]), 4)).toHaveLength(4);
  });
});

describe("normaliseCode", () => {
  it("accepts what a human actually types off a poster", () => {
    expect(normaliseCode(" 24kq7b ")).toBe("24KQ7B");
    expect(normaliseCode("24K-Q7B")).toBe("24KQ7B");
    expect(normaliseCode("24 KQ 7B")).toBe("24KQ7B");
  });

  it("does NOT substitute look-alikes — a guess would join the wrong gym", () => {
    // 0 and O are both outside the alphabet; turning one into the other would
    // be inventing an intent the code cannot confirm.
    expect(normaliseCode("240Q7B")).toBe("240Q7B");
    expect(normaliseCode("24IQ7B")).toBe("24IQ7B");
  });
});

describe("currencyForCountry (Kd ruling 2026-08-18 — currency follows location)", () => {
  it("maps the four places we are open in", () => {
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry("IN")).toBe("INR");
    expect(currencyForCountry("CA")).toBe("CAD");
    expect(currencyForCountry("DE")).toBe("EUR");
  });

  it("puts the UK on the pound, not the euro", () => {
    // "Europe" is not one currency, and a UK gym quoted in euros is a false
    // number in front of a paying customer.
    expect(currencyForCountry("GB")).toBe("GBP");
  });

  it("returns null for a country we are not open in — never a fallback", () => {
    // A fallback is how a gym in Sydney gets quoted in rupees. Each of these
    // is a real country with a real currency we have no prices for.
    for (const country of ["AU", "PL", "CH", "SE", "NO", "BR", "ZZ", ""]) {
      expect(currencyForCountry(country)).toBeNull();
    }
  });

  it("accepts what a person types (case and stray spaces)", () => {
    expect(currencyForCountry(" us ")).toBe("USD");
    expect(currencyForCountry("in")).toBe("INR");
  });

  it("cannot be fooled by an inherited object key", () => {
    // `Object.hasOwn` rather than `in`: "constructor" and "toString" are on
    // every object's prototype and would otherwise resolve to a currency.
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(currencyForCountry(key)).toBeNull();
    }
  });

  it("every supported country maps to a 3-letter code, and the picker matches the map", () => {
    expect(SUPPORTED_COUNTRIES.length).toBe(Object.keys(COUNTRY_CURRENCY).length);
    for (const country of SUPPORTED_COUNTRIES) {
      expect(country).toMatch(/^[A-Z]{2}$/);
      expect(currencyForCountry(country)).toMatch(/^[A-Z]{3}$/);
    }
  });
});

describe("slugifyName", () => {
  it("makes a readable URL segment", () => {
    expect(slugifyName("Iron House Gym")).toBe("iron-house-gym");
    expect(slugifyName("  Bob's 24/7 Fitness!  ")).toBe("bob-s-24-7-fitness");
  });

  it("never returns an empty slug for a non-Latin name (Part 3 §6.3)", () => {
    // An Assamese or Devanagari name strips to nothing; an empty slug is a
    // broken URL, which is worse than an ugly one.
    expect(slugifyName("অসম জিম")).toBe("org");
    expect(slugifyName("💪")).toBe("org");
  });

  it("never ends in a separator", () => {
    expect(slugifyName("Gym!!!")).toBe("gym");
    expect(slugifyName("A".repeat(60))).not.toMatch(/-$/);
  });
});

describe("slugCandidate", () => {
  it("returns the bare slug on the first attempt", () => {
    expect(slugCandidate("iron-house", null)).toBe("iron-house");
  });

  it("appends a lowercased token on a retry", () => {
    expect(slugCandidate("iron-house", "24KQ")).toBe("iron-house-24kq");
  });

  it("keeps the suffixed slug within the column-safe length", () => {
    const long = "a".repeat(48);
    const out = slugCandidate(long, "24KQ");
    expect(out.length).toBeLessThanOrEqual(48);
    expect(out).toMatch(/-24kq$/);
  });
});
