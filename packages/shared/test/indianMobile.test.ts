// An Indian gym owner's mobile, as people write it (ROADMAP 1d-i). The cases are the ways
// Indian mobiles are printed on cards, sites and forms, and the numbers that are NOT
// mobiles: landlines, toll-free, other countries, other scripts' digits.
import { describe, expect, it } from "vitest";
import { normaliseIndianMobile } from "../src/orgs.js";

describe("an Indian mobile number, however it is typed", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["98 76 54 32 10", "+919876543210"],
    ["9876-543-210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["+91.98765.43210", "+919876543210"],
    ["(+91) 98765 43210", "+919876543210"],
    ["+919876543210", "+919876543210"],
    ["91 9876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["098765 43210", "+919876543210"],
    ["0091 98765 43210", "+919876543210"],
    ["  70123 45678  ", "+917012345678"],
    ["6000000000", "+916000000000"],
  ])("%s is %s", (typed, want) => {
    expect(normaliseIndianMobile(typed)).toBe(want);
  });

  it.each([
    ["a Pune landline", "020 2612 3456"],
    ["a Delhi landline", "011-2345-6789"],
    ["a Mumbai landline with the country", "+91 22 2345 6789"],
    ["a toll-free number", "1800 123 4567"],
    ["a toll-free number with dashes", "1800-180-1234"],
    ["a number starting 5", "5876543210"],
    ["a number starting 5, with the country", "+91 58765 43210"],
    ["nine digits", "98765 4321"],
    ["eleven digits without a 0", "98765432101"],
    ["a US number", "+1 (415) 555-2671"],
    ["a UK mobile", "+44 7911 123456"],
    ["a plus without the country", "+9876543210"],
    ["the (0) some write after +91", "+91 (0) 98765 43210"],
    ["Devanagari digits", "९८७६५४३२१०"],
    ["full-width digits", "９８７６５４３２１０"],
    ["an extension", "98765 43210 ext 12"],
    ["two numbers", "98765 43210 / 98765 43211"],
    ["an email address", "owner@example.com"],
    ["nothing", ""],
    ["spaces", "   "],
  ])("%s (%s) is not an Indian mobile", (_what, typed) => {
    expect(normaliseIndianMobile(typed)).toBeNull();
  });
});
