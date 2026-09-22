// The checks a number carries in itself (spec Part 3 §11.2), against the
// vectors their own standards publish — not against numbers this code made up.
//
// This is the point of §11.2's order: a heading is what a gym's export is free
// to write however it likes, so wherever a number CHECKS ITSELF that check
// decides, in a column called anything at all. A check is only worth trusting
// if it is the real one, so every value below comes from outside this repo:
//   · Luhn's own worked example, and the test card numbers Visa, Mastercard,
//     American Express and Discover publish for developers.
//   · Verhoeff's published example — the check digit of 236 is 3, and of 12345
//     is 1 — which is the algorithm India's Aadhaar carries.
//   · The IBAN registry's own examples (ISO 13616): GB82 WEST 1234 5698 7654
//     32, DE89 3704 0044 0532 0130 00, FR14 2004 1010 0505 0001 3M02 606.
//   · HMRC's rule for a National Insurance number, including that QQ123456C is
//     its own PLACEHOLDER for an unknown one and is therefore NOT valid.
//   · The SSA's rule that no Social Security number has 000, 666 or a 9 as its
//     area, 00 as its group, or 0000 as its serial.
//
// No number below belongs to anybody.
import { describe, expect, it } from "vitest";
import {
  aadhaarShaped,
  cardShapedCell,
  governmentIdShaped,
  ibanShaped,
  looksLikeAPaymentCard,
  neverKeptByHeader,
  neverKeptColumn,
  sheetHints,
  verhoeffValid,
} from "../src/modules/orgs/memberList/neverKeep.js";

const NO_HINTS = { hasAddress: false, hasBank: false };
const WITH_ADDRESS = { hasAddress: true, hasBank: false };
const WITH_BANK = { hasAddress: false, hasBank: true };

describe("Luhn, and the card numbers the schemes publish for testing", () => {
  it.each(["4111111111111111", "4242424242424242", "5500000000000004", "5555555555554444", "340000000000009", "378282246310005", "6011000000000004"])(
    "%s is a card",
    (card) => {
      expect(looksLikeAPaymentCard(card)).toBe(true);
      expect(cardShapedCell(card)).toBe(true);
    },
  );

  it.each([
    ["written in fours", "4111 1111 1111 1111"],
    ["written with dashes", "4111-1111-1111-1111"],
    ["written with en dashes", "4111–1111–1111–1111"],
  ])("is still a card %s", (_how, card) => {
    expect(cardShapedCell(card)).toBe(true);
  });

  it.each([
    ["one digit changed", "4111111111111112"],
    ["too short", "411111111111"],
    ["too long", "41111111111111111111"],
    ["a card with a word beside it", "4111111111111111 (Visa)"],
    ["a phone number", "+919876543210"],
    ["a member number", "MEM-000123"],
  ])("%s is not", (_what, text) => {
    expect(cardShapedCell(text)).toBe(false);
  });
});

describe("Verhoeff, the check India's Aadhaar carries", () => {
  it("agrees with Verhoeff's own published example", () => {
    expect(verhoeffValid("2363")).toBe(true);
    expect(verhoeffValid("2364")).toBe(false);
    expect(verhoeffValid("123451")).toBe(true);
    expect(verhoeffValid("123452")).toBe(false);
  });

  it.each(["234567890124", "345678901238", "456789012341", "567890123458"])("%s is Aadhaar-shaped", (number) => {
    expect(aadhaarShaped(number)).toBe(true);
    expect(aadhaarShaped(number.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3"))).toBe(true);
  });

  it.each([
    ["a number starting 0", "034567890124"],
    ["a number starting 1", "134567890124"],
    ["a wrong check digit", "234567890125"],
    ["eleven digits", "23456789012"],
  ])("%s is not", (_what, number) => {
    expect(aadhaarShaped(number)).toBe(false);
  });
});

describe("the IBAN registry's own examples", () => {
  it.each(["GB82 WEST 1234 5698 7654 32", "DE89 3704 0044 0532 0130 00", "FR1420041010050500013M02606", "gb82west12345698765432"])("%s is an IBAN", (iban) => {
    expect(ibanShaped(iban)).toBe(true);
  });

  it.each([
    ["one digit changed", "GB82 WEST 1234 5698 7654 33"],
    ["a member number", "MEM00012345"],
    ["a sentence", "Bank transfer preferred"],
  ])("%s is not", (_what, text) => {
    expect(ibanShaped(text)).toBe(false);
  });
});

describe("government ID numbers, by their own shapes", () => {
  it.each([
    ["a US Social Security number", "123-45-6789"],
    ["a Canadian Social Insurance number", "046 454 286"],
    ["an Indian PAN", "ABCDE1234F"],
    ["a UK National Insurance number", "AB123456C"],
    ["a UK National Insurance number in its spaced form", "AB 12 34 56 C"],
  ])("%s is one", (_what, number) => {
    expect(governmentIdShaped(number)).toBe(true);
  });

  it.each([
    ["nine bare digits, which is a member number in half the world's gyms", "123456789"],
    ["HMRC's own placeholder for an unknown NI number", "QQ123456C"],
    ["an NI number with O as its second letter, which HMRC never issues", "AO123456C"],
    ["an NI number with a suffix past D", "AB123456E"],
    ["a Social Security number with the area 666", "666-45-6789"],
    ["a Social Security number with the group 00", "123-00-6789"],
    ["a Social Security number with the serial 0000", "123-45-0000"],
    ["a gym's own reference", "REF-2024-0912"],
    ["a name", "Ann Lee"],
  ])("%s is not", (_what, text) => {
    expect(governmentIdShaped(text)).toBe(false);
  });
});

describe("a heading, the backstop", () => {
  it.each([
    ["Medical Conditions", "medical"],
    ["Health Notes", "medical"],
    ["Allergies", "medical"],
    ["PAR-Q", "medical"],
    ["Bank Account", "bank_details"],
    ["Sort Code", "bank_details"],
    ["IFSC Code", "bank_details"],
    ["BSB", "bank_details"],
    ["Aadhaar Number", "government_id"],
    ["Passport Number", "government_id"],
    ["Password", "password_or_pin"],
    ["Door Code", "password_or_pin"],
    // A CVV is a card SECURITY code, which is what it is named for, so it is
    // read with the passwords rather than with the account details.
    ["CVV", "password_or_pin"],
  ])("%s is never kept", (header, reason) => {
    expect(neverKeptByHeader(header, NO_HINTS)).toBe(reason);
  });

  it.each([
    ["Full Name"],
    ["Email Address"],
    ["Mobile"],
    ["Member Type"],
    ["Join Date"],
    ["Notes"],
    ["Terms and Conditions"],
    ["Check-in Code"],
    ["Key Tag"],
    ["Belt"],
    ["Expiry Date"],
    ["Next Billing Date"],
  ])("%s is kept", (header) => {
    expect(neverKeptByHeader(header, NO_HINTS)).toBe(null);
  });
});

describe("a postcode is an address, in every word the English-speaking world writes it with", () => {
  // Kd, 2026-09-22. The words are Wikipedia's ("Postal code", read that day)
  // and Gymdesk's own import field, which it writes "Zip/Postal Code".
  it.each([
    ["Postcode"],
    ["Post Code"],
    ["Postal Code"],
    ["Zip"],
    ["ZIP Code"],
    ["Zipcode"],
    ["Zip/Postal Code"],
    ["Zip + 4"],
    ["PIN Code"],
    ["Pincode"],
    ["Eircode"],
    ["Postal Index Number"],
  ])("%s is kept, with or without an address column beside it", (header) => {
    expect(neverKeptByHeader(header, NO_HINTS)).toBe(null);
    expect(neverKeptByHeader(header, WITH_ADDRESS)).toBe(null);
  });

  it("settles a bare PIN by the sheet, because no list of words can", () => {
    expect(neverKeptByHeader("PIN", WITH_ADDRESS)).toBe(null);
    expect(neverKeptByHeader("PIN", NO_HINTS)).toBe("password_or_pin");
    expect(neverKeptByHeader("Pin No", WITH_ADDRESS)).toBe(null);
    expect(neverKeptByHeader("Pin No", NO_HINTS)).toBe("password_or_pin");
  });

  it("still drops a PIN a heading says is a key, address or no address", () => {
    for (const header of ["Door PIN", "Access PIN", "Gate PIN"]) {
      expect(neverKeptByHeader(header, WITH_ADDRESS)).toBe("password_or_pin");
    }
  });

  it("reads the sheet's own headings for that", () => {
    expect(sheetHints(["Name", "Email", "PIN"])).toEqual({ hasAddress: false, hasBank: false });
    expect(sheetHints(["Name", "Street", "City", "PIN"]).hasAddress).toBe(true);
    expect(sheetHints(["Name", "Zip Code"]).hasAddress).toBe(true);
    expect(sheetHints(["Name", "Sort Code"]).hasBank).toBe(true);
  });
});

describe("every market the app is for, not one country's", () => {
  // Kd, 2026-09-22: *"things should be built not only taking indian context but
  // other countries as well"*. One row per market, for the wording that market
  // actually uses on a membership form or a direct-debit mandate.
  it.each([
    ["the United States", "Social Security Number", "government_id"],
    ["the United States", "ITIN", "government_id"],
    ["the United States", "Routing Number", "bank_details"],
    ["the United States", "ACH Details", "bank_details"],
    ["Canada", "Social Insurance Number", "government_id"],
    ["Canada", "Transit Number", "bank_details"],
    ["Canada", "Institution Number", "bank_details"],
    ["Canada", "Interac Email", "bank_details"],
    ["the United Kingdom", "National Insurance Number", "government_id"],
    ["the United Kingdom", "NI Number", "government_id"],
    ["the United Kingdom", "Sort Code", "bank_details"],
    ["the United Kingdom", "BACS Reference", "bank_details"],
    ["Ireland", "PPS Number", "government_id"],
    ["Ireland", "PPSN", "government_id"],
    ["Ireland", "IBAN", "bank_details"],
    ["Australia", "Tax File Number", "government_id"],
    ["Australia", "TFN", "government_id"],
    ["Australia", "Medicare Number", "government_id"],
    ["Australia", "BSB", "bank_details"],
    ["Australia", "PayID", "bank_details"],
    ["New Zealand", "IRD Number", "government_id"],
    ["New Zealand", "Bank Account Number", "bank_details"],
    ["Singapore", "NRIC", "government_id"],
    ["Singapore", "FIN", "government_id"],
    ["the UAE", "Emirates ID", "government_id"],
    ["the Philippines", "SSS Number", "government_id"],
    ["South Africa", "Debit Order Details", "bank_details"],
    ["Europe", "SEPA Mandate", "bank_details"],
    ["India", "Aadhaar Number", "government_id"],
    ["India", "PAN Card", "government_id"],
    ["India", "IFSC Code", "bank_details"],
    ["India", "UPI ID", "bank_details"],
    ["everywhere", "Passport Number", "government_id"],
    ["everywhere", "Driving Licence Number", "government_id"],
  ])("drops %s's %s", (_where, header, reason) => {
    expect(neverKeptByHeader(header, NO_HINTS)).toBe(reason);
  });

  it("keeps a BUSINESS's number, which §11.2 is not about", () => {
    // A gym's corporate account may honestly need one; it is not a member's
    // own government ID, so it is kept as one of the gym's extra fields.
    expect(neverKeptByHeader("ABN", NO_HINTS)).toBe(null);
    expect(neverKeptByHeader("Company Registration Number", NO_HINTS)).toBe(null);
  });
});

describe("an account number, settled by the sheet in the same way", () => {
  it("is the gym's own number where nothing else is a bank column", () => {
    expect(neverKeptByHeader("Account Number", NO_HINTS)).toBe(null);
  });

  it("is a bank account where the sheet carries bank columns", () => {
    expect(neverKeptByHeader("Account Number", WITH_BANK)).toBe("bank_details");
  });
});

describe("a whole column, cells before heading", () => {
  const shapes = (over: Partial<{ written: number; cards: number; ibans: number; governmentIds: number }>) => ({
    written: 10,
    cards: 0,
    ibans: 0,
    governmentIds: 0,
    ...over,
  });

  it("is dropped for its cells whatever its heading says", () => {
    expect(neverKeptColumn("Locker No", shapes({ cards: 10 }), NO_HINTS)).toBe("payment_card");
    expect(neverKeptColumn("Reference", shapes({ ibans: 8 }), NO_HINTS)).toBe("bank_details");
    expect(neverKeptColumn("Notes", shapes({ governmentIds: 7 }), NO_HINTS)).toBe("government_id");
  });

  it("is kept where only a few of its cells carry the shape by chance", () => {
    // Seven runs of twelve digits in a hundred pass Verhoeff (measured
    // 2026-09-22), which is why one cell can never decide a column.
    expect(neverKeptColumn("Member No", shapes({ governmentIds: 1 }), NO_HINTS)).toBe(null);
    expect(neverKeptColumn("Member No", shapes({ governmentIds: 5 }), NO_HINTS)).toBe(null);
  });

  it("falls back to the heading where the cells say nothing", () => {
    expect(neverKeptColumn("Medical Conditions", shapes({}), NO_HINTS)).toBe("medical");
    expect(neverKeptColumn("Belt", shapes({}), NO_HINTS)).toBe(null);
  });
});
