// How members reach their gym (ROADMAP 20a-iii): what counts as a phone number and an
// email address a gym may show its members.
import { describe, expect, it } from "vitest";
import {
  GYM_CONTACT_PHONE_MAX_CHARS,
  cleanGymContactEmail,
  cleanGymContactPhone,
  gymContactPhoneProblem,
  gymContactSchema,
  gymContactTel,
  gymInboxResponseSchema,
} from "../src/index.js";

describe("a gym's phone number for its members", () => {
  // Written as each country's own gyms print them, not as the rule's pattern reads.
  const kept: [string, string, string][] = [
    ["London", "020 7946 0958", "tel:02079460958"],
    ["London, from abroad", "+44 20 7946 0958", "tel:+442079460958"],
    ["New York", "(212) 555-0123", "tel:2125550123"],
    ["the US, from abroad", "+1 212-555-0123", "tel:+12125550123"],
    ["the US, with dots", "212.555.0123", "tel:2125550123"],
    ["a US free number", "1-800-555-0199", "tel:18005550199"],
    ["an Indian mobile", "+91 98765 43210", "tel:+919876543210"],
    ["an Indian mobile, as dialled at home", "098765 43210", "tel:09876543210"],
    ["an Indian landline", "0376 2301234", "tel:03762301234"],
    ["Berlin, with a slash", "030/901820", "tel:030901820"],
    ["Paris", "01 23 45 67 89", "tel:0123456789"],
    ["Sydney", "(02) 9876 5432", "tel:0298765432"],
    ["São Paulo", "+55 (11) 91234-5678", "tel:+5511912345678"],
    ["an Australian free number", "1800 123 456", "tel:1800123456"],
    ["the longest a number can be", "+123456789012345", "tel:+123456789012345"],
    // The zero in brackets is dialled only inside the country, so a link with the code drops it.
    ["London, the British way", "+44 (0)20 7946 0958", "tel:+442079460958"],
    ["Berlin, from abroad", "+49 (0)30 901820", "tel:+4930901820"],
    ["London, with no code, keeps its zero", "(0)20 7946 0958", "tel:02079460958"],
    ["an Indian mobile, the code in brackets", "(+91) 98765 43210", "tel:+919876543210"],
    ["London, the code in brackets", "(+44) (0)20 7946 0958", "tel:+442079460958"],
    ["an Indian landline, a slash after its area code", "0376/2301234", "tel:03762301234"],
    // A German town's long area code, with the country code before it: still one number.
    ["Lübbenau, from abroad", "+49 (0)3541/123456", "tel:+493541123456"],
    ["a German village, from abroad", "+49 (0)33203/12345", "tel:+493320312345"],
    ["the same village, at home", "033203/12345", "tel:03320312345"],
    ["London, the code written 00", "0044 (0)20 7946 0958", "tel:00442079460958"],
    ["only the first zero in brackets is dropped", "+44 (0)20 (0)7946 095", "tel:+442007946095"],
  ];
  it.each(kept)("%s is kept as typed and calls the right number", (_where, typed, tel) => {
    expect(cleanGymContactPhone(typed)).toBe(typed);
    expect(gymContactTel(typed)).toBe(tel);
  });

  it("is tidied: spaces run together and trimmed, nothing else changed", () => {
    expect(cleanGymContactPhone("  020   7946\t0958 ")).toBe("020 7946 0958");
  });

  const refused: [string, string][] = [
    ["an extension in words", "020 7946 0958 ext 12"],
    ["letters for digits", "1-800-FLOWERS"],
    ["words", "ask at the front desk"],
    ["an email address", "hello@ironhouse.com"],
    ["two numbers", "020 7946 0958, 020 7946 0959"],
    ["too few digits", "12345"],
    ["too many digits", "+1234567890123456"],
    ["a plus in the middle", "020+7946 0958"],
    ["two pluses", "++44 20 7946 0958"],
    ["digits of another script", "٠٢٠ ٧٩٤٦ ٠٩٥٨"],
    ["a link", "tel:02079460958"],
    ["a web address", "https://wa.me/442079460958"],
    ["nothing but marks", "(--) .. //"],
    ["longer than is kept", `020 7946 0958${" -".repeat(GYM_CONTACT_PHONE_MAX_CHARS / 2)}`],
    ["empty", ""],
    ["brackets with no meaning", "(((((123456"],
    ["hyphens before the number", "------123456"],
    ["a plus standing alone", "+ 123456"],
    ["a plus inside brackets, after a digit", "(0+44) 20 7946 0958"],
    ["a second number after a slash", "2345678 / 2345679"],
    ["a second line after a slash", "0376-2301234/35"],
    ["a second line, spaced", "080 4567 8900 / 01"],
    ["two short numbers, a spaced slash", "234567 / 234568"],
    ["two numbers, a spaced hyphen", "2345678 - 2345679"],
  ];
  it.each(refused)("%s is not a phone number", (_what, typed) => {
    expect(cleanGymContactPhone(typed)).toBeNull();
  });

  it("two numbers with a slash between them are refused in their own words, and nothing else is", () => {
    for (const typed of ["2345678 / 2345679", "0376-2301234/35", "080 4567 8900 / 01", "+44 20 7946 0958/59", "234567 / 234568", "2345678 - 2345679"]) {
      expect(gymContactPhoneProblem(typed), typed).toBe("two_contact_phones");
    }
    for (const [, typed] of refused.filter(([, t]) => !t.includes("/") && t !== "2345678 - 2345679")) expect(gymContactPhoneProblem(typed), typed).toBe("bad_contact_phone");
    for (const [, typed] of kept) expect(gymContactPhoneProblem(typed), typed).toBeNull();
  });
});

describe("a gym's email address for its members", () => {
  it.each(["hello@ironhouse.com", "Front.Desk+members@iron-house.co.uk", "o'neil@gym.ie"])("%s is kept as typed", (typed) => {
    expect(cleanGymContactEmail(`  ${typed} `)).toBe(typed);
  });

  // A link that writes to the address is built from it, so nothing that could add to that link is kept.
  it.each([
    "hello@ironhouse.com?subject=hi",
    "hello@ironhouse.com&cc=other@x.com",
    "hello@ironhouse.com, desk@ironhouse.com",
    "hello @ironhouse.com",
    "mailto:hello@ironhouse.com",
    "hello@ironhouse",
    "ironhouse.com",
    "@ironhouse.com",
    "<hello@ironhouse.com>",
    `${"a".repeat(250)}@x.com`,
    "",
  ])("%s is not an email address", (typed) => {
    expect(cleanGymContactEmail(typed)).toBeNull();
  });
});

describe("the contact a member is sent", () => {
  it("is nothing from an api too old to send it, never a failed read", () => {
    const old = { gymId: "7b0e3f0e-8a55-4a55-9d0c-3a8f0f1f2c11", gymName: "Iron House", status: "shown", messages: [], unread: 0, asOf: "2026-10-09T06:30:00.000Z" };
    expect(gymInboxResponseSchema.parse(old).contact).toEqual({ phone: null, email: null });
  });

  it("holds a phone and an email, each there or null", () => {
    expect(gymContactSchema.safeParse({ phone: "020 7946 0958", email: null }).success).toBe(true);
    expect(gymContactSchema.safeParse({ phone: "020 7946 0958" }).success).toBe(false);
  });
});
