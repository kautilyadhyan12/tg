// The phone rule as one table (spec Part 3 §9.5, §9.10), written before review.
//
// Every row below the first block is one of the vectors MEASURED on
// `libphonenumber-js` 1.13.13 on 2026-09-19 and re-run against this package on
// 2026-09-20, plus the spreadsheet damage the planning chat found. The expected
// value of each is what the SERVER must store, which is not always what the
// package alone answers: the four rows marked "the package alone" are exactly
// the ones our own rules exist for.
import { describe, expect, it } from "vitest";
import { type PhoneReading, isPhoneValue, readCountry, readPhone } from "../src/modules/orgs/memberList/phone.js";

const ch = (code: number): string => String.fromCodePoint(code);
/** The nine Devanagari digits and zero, which the package does NOT fold. */
const inScript = (zero: number, digits: string): string => Array.from(digits, (d) => ch(zero + Number(d))).join("");
const devanagari = (digits: string): string => inScript(0x0966, digits);
const arabicIndic = (digits: string): string => inScript(0x0660, digits);
const fullWidth = (digits: string): string => inScript(0xff10, digits);

const read = (text: string, country: string | null): PhoneReading => readPhone(text, readCountry(country));
const e164 = (text: string, country: string | null): string | null => read(text, country).e164;

describe("the country a gym's numbers are read in", () => {
  it.each([
    ["a country the package knows", "IN", "IN"],
    ["lower case", "gb", "GB"],
    ["spaces around it", " US ", "US"],
    ["a country it does not know", "XX", null],
    ["a name rather than a code", "India", null],
    ["not set at all", null, null],
    ["empty", "", null],
  ])("%s", (_label, given, expected) => {
    expect(readCountry(given)).toBe(expected);
  });
});

describe("one cell, one number", () => {
  it.each([
    // [what it is, the cell, the gym's country, the number stored]
    ["India, a leading 0", "09876543210", "IN", "+919876543210"],
    ["India, the country code with no +", "919876543210", "IN", "+919876543210"],
    ["India, written with +", "+91 98765 43210", null, "+919876543210"],
    ["India, spaced", "98765 43210", "IN", "+919876543210"],
    ["India, ten digits", "9876543210", "IN", "+919876543210"],
    ["India, already E.164", "+919876543210", null, "+919876543210"],
    ["India, the 00 prefix", "0091 98765 43210", "IN", "+919876543210"],
    ["America, dashes", "1-415-555-2671", "US", "+14155552671"],
    ["America, brackets", "(415) 555-2671", "US", "+14155552671"],
    ["America, already E.164", "+14155552671", null, "+14155552671"],
    ["a US number under a Canadian gym", "4155552671", "CA", "+14155552671"],
    ["Canada", "+16135552671", null, "+16135552671"],
    ["Canada, another area", "+12045551234", null, "+12045551234"],
    ["Britain, a leading 0", "07911 123456", "GB", "+447911123456"],
    ["Britain, the (0) some software writes", "+44 (0)7911 123456", null, "+447911123456"],
    ["Britain, spaced", "+44 7911 123456", null, "+447911123456"],
    ["Britain, no leading 0", "7911123456", "GB", "+447911123456"],
    ["Britain, the 00 prefix", "0044 7911 123456", "GB", "+447911123456"],
    ["a British number under an Indian gym", "00447911123456", "IN", "+447911123456"],
    ["Britain, the country code with no +", "447911123456", "GB", "+447911123456"],
    ["Australia", "0412 345 678", "AU", "+61412345678"],
    ["Australia, no leading 0", "412345678", "AU", "+61412345678"],
    ["New Zealand", "021 123 4567", "NZ", "+64211234567"],
    ["New Zealand, already E.164", "+64211234567", null, "+64211234567"],
    ["Brazil, a mobile", "11 91234 5678", "BR", "+5511912345678"],
    ["Brazil, a carrier code", "0 15 11 91234 5678", "BR", "+5511912345678"],
    ["Brazil, already E.164", "+55 11 91234 5678", null, "+5511912345678"],
    ["Germany", "030 12345678", "DE", "+493012345678"],
    ["Germany, a short landline", "+49 30 1234", null, "+49301234"],
    ["Italy, Rome", "06 6982 1234", "IT", "+390669821234"],
    ["Italy, already E.164", "+39 06 6982 1234", null, "+390669821234"],
    ["Italy, a mobile", "3331234567", "IT", "+393331234567"],
    ["Argentina, a mobile", "+54 9 11 2345 6789", null, "+5491123456789"],
    ["Argentina, a landline", "+54 11 2345 6789", null, "+541123456789"],
    ["Argentina, the 15 prefix", "011 15 2345 6789", "AR", "+5491123456789"],
    ["Mexico", "+52 55 1234 5678", null, "+525512345678"],
  ])("%s", (_label, cell, country, expected) => {
    expect(e164(cell, country)).toBe(expected);
  });
});

describe("what a spreadsheet did to the number", () => {
  it.each([
    ["exponent form with every digit (Google Sheets writes it)", "9.19876543210E+11", "IN", "+919876543210"],
    ["the same in lower case", "9.19876543210e+11", "IN", "+919876543210"],
    ["exponent form, Australia", "6.1412345678E+10", "AU", "+61412345678"],
    ["a trailing .0 — the package alone reads +919198765432100", "919876543210.0", "IN", "+919876543210"],
    ["a trailing .00", "919876543210.00", "IN", "+919876543210"],
    ["a trailing .0 on a US number", "4155552671.0", "US", "+14155552671"],
    ["a trailing .0 beside a +", "+91 98765 43210.0", null, "+919876543210"],
    ["a leading apostrophe, as Excel marks text", "'+14155552671", null, "+14155552671"],
    ["spaces around it", " +1 415 555 2671 ", null, "+14155552671"],
    ["en dashes", `+1${ch(0x2013)}415${ch(0x2013)}555${ch(0x2013)}2671`, null, "+14155552671"],
    ["an em dash", `+1${ch(0x2014)}415-555-2671`, null, "+14155552671"],
    ["a no-break space", `+1${ch(0xa0)}415 555 2671`, null, "+14155552671"],
    ["a zero-width space left by a copy and paste", `+14155${ch(0x200b)}552671`, null, "+14155552671"],
    ["full-width digits", fullWidth("9876543210"), "IN", "+919876543210"],
    ["Arabic-Indic digits", arabicIndic("9876543210"), "IN", "+919876543210"],
    ["Devanagari digits — the package alone reads nothing", devanagari("9876543210"), "IN", "+919876543210"],
    ["a tel: link", "tel:+14155552671", null, "+14155552671"],
    ["a tel: link with an extension", "tel:+1-415-555-2671;ext=123", null, "+14155552671"],
    ["an extension written x123", "415-555-2671 x123", "US", "+14155552671"],
    ["an extension written ext. 5", "(415) 555-2671 ext. 5", "US", "+14155552671"],
  ])("%s", (_label, cell, country, expected) => {
    expect(e164(cell, country)).toBe(expected);
  });

  it.each([
    ["Excel's six digits of a twelve-digit number", "9.19877E+11", "IN"],
    ["the same in lower case", "9.19877e+11", "IN"],
    ["a shortened British number", "4.47911E+11", "GB"],
  ])("%s is said to be shortened and never guessed back", (_label, cell, country) => {
    expect(read(cell, country)).toEqual({ e164: null, unusual: false, shortened: true, needsCountry: false });
  });
});

describe("two numbers in one cell", () => {
  it.each([
    ["a slash — the package alone glues them into +155512345559876", "555-1234 / 555-9876", "US", null],
    ["a slash, both readable: the first wins", "415-555-2671 / 415-555-9876", "US", "+14155552671"],
    ["a semicolon", "+14155552671; +14155559876", null, "+14155552671"],
    ["a comma", "9876543210, 9876543211", "IN", "+919876543210"],
    ["a pipe", "9876543210 | 9876543211", "IN", "+919876543210"],
    ['the word "or"', "9876543210 or 9876543211", "IN", "+919876543210"],
    ["two lines, as Alt+Enter writes them", "9876543210\n9876543211", "IN", "+919876543210"],
    ["the first unreadable, the second good", "N/A / 9876543210", "IN", "+919876543210"],
    ["the first shortened, the second good", "9.19877E+11 / 9876543210", "IN", "+919876543210"],
  ])("%s", (_label, cell, country, expected) => {
    expect(e164(cell, country)).toBe(expected);
  });

  it("a cell whose only number was shortened says so; one with a good number does not", () => {
    expect(read("9.19877E+11 / 9.19878E+11", "IN").shortened).toBe(true);
    expect(read("9.19877E+11 / 9876543210", "IN").shortened).toBe(false);
  });
});

describe("what is never read as somebody's number", () => {
  it.each([
    ["nothing at all", "", "IN"],
    ["a dash", "-", "IN"],
    ["N/A", "N/A", "IN"],
    ["a word with a number in it", "Mob: 9876543210 (home)", "IN"],
    ["letters for digits", "1-800-GOT-MILK", "US"],
    ["letters where the number should be", "+1 412 535 abcd", null],
    ["a seven-digit local number with no area code", "555-2671", "US"],
    ["a country code typed twice", "0044 7911 123456", "US"],
    ["a Mexican mobile's old 1 prefix", "+52 1 55 1234 5678", null],
    ["two numbers with only a space between them", "9876543210 9876543211", "IN"],
    ["a joining date, day first", "05/01/2024", "DE"],
    ["a joining date, year first", "2024-01-05", "DE"],
    ["a joining date with the time", "2024/12/31 14:30", "IN"],
    ["a date under an Indian gym", "2024/01/05", "IN"],
    ["a price", "2,500.00", "IN"],
    ["a room number", "12", "IN"],
    ["a long id that is not a number", "MEMBER-000123-A", "IN"],
    // With `extract` left on, the package would pull a number out of this and
    // give somebody a flat number as their mobile.
    ["a flat number in an address", "Flat 4155552671", "US"],
    ["a number with a word in front of it", "Mobile 9876543210", "IN"],
  ])("%s", (_label, cell, country) => {
    expect(e164(cell, country)).toBe(null);
  });

  it("a name with digits in it is never handed to the package", () => {
    expect(e164("Flat 12, 45 Church Street, Jorhat 785001", "IN")).toBe(null);
  });
});

describe("a number the country does not hand out is kept and counted", () => {
  it.each([
    ["all zeros", "00000000000", "IN"],
    ["one digit too many", "98765432109", "IN"],
    ["a Brazilian mobile written the old way", "11 1234 5678", "BR"],
    ["a British number in a range the metadata has not got", "07700 900123", "GB"],
  ])("%s", (_label, cell, country) => {
    const reading = read(cell, country);
    expect(reading.e164).not.toBe(null);
    expect(reading.unusual).toBe(true);
  });

  it("an ordinary number is not counted as unusual", () => {
    expect(read("9876543210", "IN").unusual).toBe(false);
  });
});

describe("a gym with no country set", () => {
  it("reads a number written with its country code", () => {
    expect(read("+14155552671", null)).toEqual({ e164: "+14155552671", unusual: false, shortened: false, needsCountry: false });
  });

  it.each([
    ["a local number", "9876543210"],
    ["a number with a leading zero", "07911 123456"],
    ["a country code with no +", "919876543210"],
  ])("leaves %s alone and asks for the country", (_label, cell) => {
    expect(read(cell, null)).toEqual({ e164: null, unusual: false, shortened: false, needsCountry: true });
  });

  it("does not ask for a country over a cell that holds no number at all", () => {
    expect(read("Not given", null).needsCountry).toBe(false);
  });
});

describe("isPhoneValue, which is what counts a column's cells", () => {
  it.each([
    ["a number", "9876543210", "IN", true],
    ["a date", "2024-01-05", "IN", false],
    ["an email address", "ann@example.com", "IN", false],
    ["a name", "Ann Lee", "IN", false],
    ["a shortened number", "9.19877E+11", "IN", false],
  ])("%s", (_label, cell, country, expected) => {
    expect(isPhoneValue(cell, readCountry(country))).toBe(expected);
  });
});
