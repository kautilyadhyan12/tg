// A gym's price list (spec Part 3 §13.1; ROADMAP 17a-i).
//
// The first block is the worst thing this job could do to a real person: a price
// saved or shown a hundred times off. Its cases come from outside the code: the
// decimal places are ISO 4217's own (yen 0, dinar 3), and the typed prices are
// the ways people in the app's markets really write one.
import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_PRICE_MINOR_MAX,
  MEMBER_CURRENCY,
  SUPPORTED_COUNTRIES,
  currencyDecimals,
  formatMinor,
  isDayPass,
  isVisibleText,
  memberCurrencyForCountry,
  minorToPriceText,
  priceToMinor,
  saveGymMembershipTypeRequestSchema,
  updateGymMembershipTypeRequestSchema,
} from "../src/index.js";

describe("a price is never a hundred times off", () => {
  it("knows each currency's decimal places from ISO 4217, not from a list of its own", () => {
    const iso: [string, number][] = [
      ["USD", 2], ["EUR", 2], ["GBP", 2], ["CAD", 2], ["INR", 2], ["AUD", 2], ["NZD", 2], ["BRL", 2],
      ["JPY", 0], ["KRW", 0], ["VND", 0], ["CLP", 0],
      ["KWD", 3], ["BHD", 3], ["OMR", 3], ["JOD", 3],
    ];
    for (const [currency, decimals] of iso) expect(currencyDecimals(currency), currency).toBe(decimals);
    expect(currencyDecimals("not a currency")).toBeNull();
    // A well-formed code no country uses: the formatter alone would answer 2.
    for (const unknown of ["ABC", "ZZZ", "XXX", "usd", ""]) expect(currencyDecimals(unknown), unknown).toBeNull();
    expect(priceToMinor("49.99", "ABC")).toBeNull();
  });

  it("turns a typed price into minor units with whole-number arithmetic", () => {
    const cases: [string, string, number][] = [
      ["49.99", "USD", 4999],
      ["49.9", "USD", 4990],
      ["49", "USD", 4900],
      [" 49 ", "USD", 4900],
      ["0", "USD", 0],
      ["0.05", "USD", 5],
      // The prices a float gets wrong: 4.35 * 100 is 434.99999999999994.
      ["4.35", "USD", 435],
      ["1.15", "GBP", 115],
      ["0.29", "EUR", 29],
      ["19.99", "CAD", 1999],
      ["1500", "INR", 150000],
      ["999999.99", "USD", MEMBERSHIP_PRICE_MINOR_MAX],
      // Yen has no cents: 5000 typed is 5000 kept, never 500000.
      ["5000", "JPY", 5000],
      ["30000", "KRW", 30000],
      // A dinar has a thousand fils.
      ["12.500", "KWD", 12500],
      ["12.5", "KWD", 12500],
    ];
    for (const [text, currency, minor] of cases) {
      expect(priceToMinor(text, currency), `${text} ${currency}`).toBe(minor);
    }
  });

  it("refuses what is not plainly a price rather than guessing", () => {
    const refused: [string, string][] = [
      // A comma means cents in Berlin and thousands in Mumbai.
      ["49,99", "EUR"],
      ["1,500", "INR"],
      ["1,00,000", "INR"],
      ["1.500,00", "EUR"],
      // A German thousands point is three decimals in a two-decimal currency.
      ["1.500", "EUR"],
      ["49.999", "USD"],
      // Yen has no decimals at all.
      ["5000.5", "JPY"],
      ["$49.99", "USD"],
      ["₹1500", "INR"],
      ["49.99 USD", "USD"],
      ["49.", "USD"],
      [".99", "USD"],
      ["-5", "USD"],
      ["+5", "USD"],
      ["1e3", "USD"],
      ["0x10", "USD"],
      ["٤٩", "USD"],
      ["4 9", "USD"],
      ["", "USD"],
      ["   ", "USD"],
      ["1000000", "USD"],
      ["49.99", "not a currency"],
    ];
    for (const [text, currency] of refused) {
      expect(priceToMinor(text, currency), `${text} ${currency}`).toBeNull();
    }
  });

  it("prints minor units as the price that was typed", () => {
    expect(formatMinor(4999, "USD")).toBe("$49.99");
    expect(formatMinor(4990, "USD")).toBe("$49.90");
    expect(formatMinor(5, "USD")).toBe("$0.05");
    expect(formatMinor(0, "USD")).toBe("$0.00");
    expect(formatMinor(4999, "GBP")).toBe("£49.99");
    expect(formatMinor(4999, "EUR")).toBe("€49.99");
    expect(formatMinor(150000, "INR")).toBe("₹1,500.00");
    expect(formatMinor(5000, "JPY")).toBe("¥5,000");
    expect(formatMinor(12500, "KWD")).toMatch(/^KWD\s12\.500$/);
    expect(formatMinor(MEMBERSHIP_PRICE_MINOR_MAX, "USD")).toBe("$999,999.99");

    expect(minorToPriceText(4999, "USD")).toBe("49.99");
    expect(minorToPriceText(5, "USD")).toBe("0.05");
    expect(minorToPriceText(5000, "JPY")).toBe("5000");
    expect(minorToPriceText(12500, "KWD")).toBe("12.500");
  });

  it("gives back the same minor units after a trip through the price box, in every currency", () => {
    const currencies = [...new Set(Object.values(MEMBER_CURRENCY)), "JPY", "KRW", "KWD", "BHD", "AUD", "NZD", "BRL"];
    const amounts = [0, 1, 5, 9, 10, 29, 99, 100, 101, 115, 435, 999, 1999, 4999, 150000, 12345678, MEMBERSHIP_PRICE_MINOR_MAX];
    for (const currency of currencies) {
      for (const minor of amounts) {
        expect(priceToMinor(minorToPriceText(minor, currency), currency), `${String(minor)} ${currency}`).toBe(minor);
      }
    }
  });
});

describe("the money a gym's members pay in", () => {
  it("is the country's own, for every country a gym can be in", () => {
    expect(memberCurrencyForCountry("US")).toBe("USD");
    expect(memberCurrencyForCountry("IN")).toBe("INR");
    expect(memberCurrencyForCountry("GB")).toBe("GBP");
    expect(memberCurrencyForCountry("CA")).toBe("CAD");
    expect(memberCurrencyForCountry("DE")).toBe("EUR");
    expect(memberCurrencyForCountry(" ie ")).toBe("EUR");
    for (const country of SUPPORTED_COUNTRIES) {
      const currency = memberCurrencyForCountry(country);
      expect(currency === null ? null : currencyDecimals(currency), country).not.toBeNull();
    }
  });

  it("is nothing, never a fallback, where the country is unknown", () => {
    expect(memberCurrencyForCountry(null)).toBeNull();
    expect(memberCurrencyForCountry("JP")).toBeNull();
    expect(memberCurrencyForCountry("constructor")).toBeNull();
  });
});

describe("what a gym may save as a membership type", () => {
  const monthly = {
    name: "Gold Monthly",
    description: null,
    kind: "recurring",
    priceMinor: 4999,
    termCount: 1,
    termUnit: "month",
    packClasses: null,
    packDays: null,
    access: "all_classes",
    bookingsLimit: null,
    bookingsPeriod: null,
    classTypeIds: null,
  };
  const pack = {
    ...monthly,
    name: "10 classes",
    kind: "pack",
    termCount: null,
    termUnit: null,
    packClasses: 10,
    packDays: 60,
  };
  const ok = (value: unknown) => saveGymMembershipTypeRequestSchema.safeParse(value).success;
  const id = "7d3c1b9e-2f4a-4c6d-8e1f-0a2b3c4d5e6f";

  it("takes each kind in its own shape", () => {
    expect(ok(monthly)).toBe(true);
    expect(ok({ ...monthly, kind: "one_time", termCount: 90, termUnit: "day" })).toBe(true);
    expect(ok({ ...monthly, kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day" })).toBe(true);
    expect(ok(pack)).toBe(true);
    expect(ok({ ...monthly, access: "limited", bookingsLimit: 3, bookingsPeriod: "week" })).toBe(true);
    expect(ok({ ...monthly, access: "limited", bookingsLimit: 8, bookingsPeriod: "month" })).toBe(true);
    expect(ok({ ...monthly, description: "Unlimited classes and open gym." })).toBe(true);
    expect(ok({ ...monthly, description: "" })).toBe(true);
    expect(ok({ ...monthly, access: "gym_only" })).toBe(true);
    expect(ok({ ...monthly, classTypeIds: [id] })).toBe(true);
    expect(saveGymMembershipTypeRequestSchema.parse({ ...monthly, name: "  Gold  " }).name).toBe("Gold");
  });

  it("refuses a shape that belongs to another kind", () => {
    const refused: unknown[] = [
      { ...monthly, termUnit: "day" },
      { ...monthly, termCount: null },
      { ...monthly, termUnit: null },
      { ...monthly, packClasses: 10 },
      { ...monthly, packDays: 30 },
      { ...pack, packClasses: null },
      { ...pack, packDays: null },
      { ...pack, termCount: 1, termUnit: "month" },
      { ...pack, access: "gym_only" },
      { ...pack, access: "limited", bookingsLimit: 2, bookingsPeriod: "week" },
      { ...monthly, access: "limited" },
      { ...monthly, access: "limited", bookingsLimit: 3 },
      { ...monthly, access: "limited", bookingsPeriod: "week" },
      { ...monthly, access: "limited", bookingsLimit: 3, bookingsPeriod: "day" },
      { ...monthly, access: "limited", bookingsLimit: 0, bookingsPeriod: "week" },
      { ...monthly, access: "limited", bookingsLimit: 201, bookingsPeriod: "month" },
      { ...monthly, bookingsLimit: 3 },
      { ...monthly, bookingsPeriod: "week" },
      { ...monthly, description: "x".repeat(301) },
      { ...monthly, description: "one\nline" },
      { ...monthly, access: "gym_only", classTypeIds: [id] },
      { ...monthly, classTypeIds: [] },
      { ...monthly, classTypeIds: [id, id] },
      { ...monthly, classTypeIds: ["not-an-id"] },
    ];
    for (const value of refused) expect(ok(value), JSON.stringify(value)).toBe(false);
  });

  it("refuses a price that is not a whole number of minor units, a currency of the sender's, and a bad name", () => {
    const refused: unknown[] = [
      { ...monthly, priceMinor: 49.99 },
      { ...monthly, priceMinor: -1 },
      { ...monthly, priceMinor: MEMBERSHIP_PRICE_MINOR_MAX + 1 },
      { ...monthly, priceMinor: "4999" },
      { ...monthly, currency: "USD" },
      { ...monthly, name: "" },
      { ...monthly, name: "   " },
      { ...monthly, name: "x".repeat(81) },
      { ...monthly, name: "Gold\u0000" },
      { ...monthly, name: "Gold\nMonthly" },
      // Half an emoji, and the characters that make two names look like one.
      { ...monthly, name: "Gold \ud83d" },
      { ...monthly, name: "Gold\u200b" },
      { ...monthly, name: "\u202eGold" },
      { ...monthly, name: "Gold\u2066" },
      { ...monthly, name: "Go\ufeffld" },
      { ...monthly, description: "Open gym\u200b" },
      { ...monthly, description: "Open \ud83d gym" },
      { ...monthly, kind: "day_pass" },
      { ...monthly, termCount: 0 },
      { ...monthly, termCount: 366 },
    ];
    for (const value of refused) expect(ok(value), JSON.stringify(value)).toBe(false);
  });

  it("takes a whole emoji and any alphabet in a name", () => {
    // A joined emoji (woman lifting weights), and Hindi and Persian typed with their joiners.
    for (const name of [
      "Strong \ud83c\udfcb\ufe0f\u200d\u2640\ufe0f",
      "\u0915\u094d\u200d\u0937",
      "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645",
    ]) {
      expect(ok({ ...monthly, name }), name).toBe(true);
      expect(isVisibleText(name)).toBe(true);
    }
    expect(isVisibleText("Gold\u200b")).toBe(false);
    for (const name of ["Gold 💪", "سنوي", "月会費", "Café & Gym – Monthly"]) {
      expect(ok({ ...monthly, name }), name).toBe(true);
    }
  });

  it("a change carries the stamp the list gave, and is refused without it", () => {
    const change = (value: unknown) => updateGymMembershipTypeRequestSchema.safeParse(value).success;
    const stamped = { ...monthly, includesPt: false, updatedAt: "2026-10-04T10:00:00.000Z" };
    expect(change(stamped)).toBe(true);
    expect(change({ ...monthly, includesPt: false })).toBe(false);
    expect(change({ ...stamped, updatedAt: "yesterday" })).toBe(false);
    // The rules between the fields hold on a change too.
    expect(change({ ...stamped, termUnit: "day" })).toBe(false);
    // A change states the personal-training tick outright: left out, it would be taken
    // off everybody who holds the type. A new type may leave it out, and has it off.
    expect(change({ ...monthly, updatedAt: "2026-10-04T10:00:00.000Z" })).toBe(false);
    expect(change({ ...stamped, includesPt: true })).toBe(true);
    expect(ok(monthly)).toBe(true);
    // And a new type does not take a stamp.
    expect(ok({ ...monthly, updatedAt: "2026-10-04T10:00:00.000Z" })).toBe(false);
  });

  it("calls a pack of 1 class for 1 day a day pass, and nothing else", () => {
    expect(isDayPass({ kind: "pack", packClasses: 1, packDays: 1 })).toBe(true);
    expect(isDayPass({ kind: "pack", packClasses: 1, packDays: 2 })).toBe(false);
    expect(isDayPass({ kind: "pack", packClasses: 10, packDays: 1 })).toBe(false);
    expect(isDayPass({ kind: "trial", packClasses: null, packDays: null })).toBe(false);
  });
});
