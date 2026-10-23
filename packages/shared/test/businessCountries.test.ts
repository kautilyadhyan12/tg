// A business only from India and the countries Square takes card payments in (ROADMAP 18s;
// Kd, 2026-10-23, `rulings/2026-10-23-18u-i.md`). The lists here are written from outside
// the code: Square's "International availability" page (US, Canada, the UK, Ireland, France,
// Spain, Australia, Japan; spec Part 3 §14.5) and the euro area's members.
import { describe, expect, it } from "vitest";
import {
  SQUARE_COUNTRIES,
  SUPPORTED_COUNTRIES,
  currencyForCountry,
  formatMinor,
  gymPaymentsAvailability,
  isServedCountry,
  memberCurrencyForCountry,
  minorToPriceText,
  priceToMinor,
} from "../src/index.js";

const SQUARE_PAGE = ["US", "CA", "GB", "IE", "FR", "ES", "AU", "JP"];
/** The euro area's other members, Bulgaria's first year (2026) among them. */
const EURO_NOT_SQUARE = ["AT", "BE", "BG", "HR", "CY", "EE", "FI", "DE", "GR", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI"];

describe("the countries a business can be in", () => {
  it("is India and Square's countries, no more and no fewer", () => {
    expect([...SUPPORTED_COUNTRIES].sort()).toEqual([...SQUARE_PAGE, "IN"].sort());
    expect([...SQUARE_COUNTRIES].sort()).toEqual([...SQUARE_PAGE].sort());
  });

  it("refuses the euro countries Square does not serve, and countries never on the list", () => {
    for (const country of [...EURO_NOT_SQUARE, "PL", "CH", "SE", "NO", "NZ", "BR", "ZZ", "", "constructor"]) {
      expect([country, isServedCountry(country)]).toEqual([country, false]);
      expect([country, currencyForCountry(country)]).toEqual([country, null]);
      expect([country, memberCurrencyForCountry(country)]).toEqual([country, null]);
    }
    expect(isServedCountry(null)).toBe(false);
  });

  it("takes each listed country as a person types it", () => {
    for (const country of [...SQUARE_PAGE, "IN"]) {
      expect([country, isServedCountry(country), isServedCountry(` ${country.toLowerCase()} `)]).toEqual([country, true, true]);
    }
  });

  it("asks a gym stored in a country that left the list for its country, as a gym with none", () => {
    for (const country of EURO_NOT_SQUARE) expect([country, gymPaymentsAvailability(country)]).toEqual([country, "no_country"]);
    expect(gymPaymentsAvailability(null)).toBe("no_country");
    for (const country of SQUARE_PAGE) expect([country, gymPaymentsAvailability(country)]).toEqual([country, "square"]);
    expect(gymPaymentsAvailability("IN")).toBe("india_soon");
  });
});

describe("Australia and Japan", () => {
  it("pay us in US dollars, as Canada and the UK do", () => {
    expect(currencyForCountry("AU")).toBe("USD");
    expect(currencyForCountry("JP")).toBe("USD");
  });

  it("price for their members in their own money", () => {
    expect(memberCurrencyForCountry("AU")).toBe("AUD");
    expect(memberCurrencyForCountry("JP")).toBe("JPY");
  });

  it("WORST THING: a ¥5,000 membership is ¥5,000, never ¥50 or ¥500,000", () => {
    expect(priceToMinor("5000", "JPY")).toBe(5000);
    expect(formatMinor(5000, "JPY")).toBe("¥5,000");
    expect(minorToPriceText(5000, "JPY")).toBe("5000");
    // Yen has no smaller unit, so a price with sen in it is not a price.
    expect(priceToMinor("5000.50", "JPY")).toBeNull();
    expect(priceToMinor("49.99", "AUD")).toBe(4999);
    expect(formatMinor(4999, "AUD")).toBe("A$49.99");
  });
});
