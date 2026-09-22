// The name, the email, the member number and the status, each cleaned by its
// own rule (spec Part 3 §9.5, §9.10), and the key that says who a row is.
// Written as one table over every class of case, before review.
import { describe, expect, it } from "vitest";
import { MEMBER_LIST_MAX_EMAIL_CHARS, MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS, MEMBER_LIST_MAX_NAME_CHARS, MEMBER_LIST_MAX_STATUS_CHARS, authEmailSchema } from "@app/shared";
import { booleanStatus, cleanEmail, cleanMemberNumber, cleanName, cleanStatus, cut, fold, identityKey, isBooleanWord } from "../src/modules/orgs/memberList/fields.js";
import { looksLikeAPaymentCard } from "../src/modules/orgs/memberList/neverKeep.js";

const ch = (code: number): string => String.fromCodePoint(code);

describe("an email address", () => {
  it.each([
    ["a plain one", "ann@example.com", "ann@example.com"],
    ["upper case", "ANN@EXAMPLE.COM", "ann@example.com"],
    ["spaces around it", "  ann@example.com  ", "ann@example.com"],
    ["a mailto: link", "mailto:ann@example.com", "ann@example.com"],
    ["an address book's name and address", "Ann Lee <ann@example.com>", "ann@example.com"],
    ["a name with no brackets", "Ann Lee ann@example.com", "ann@example.com"],
    ["two addresses, semicolon", "ann@example.com; bo@example.com", "ann@example.com"],
    ["two addresses, comma", "ann@example.com, bo@example.com", "ann@example.com"],
    ["two addresses, slash", "ann@example.com / bo@example.com", "ann@example.com"],
    ["a full stop after it", "ann@example.com.", "ann@example.com"],
    ["a zero-width space left by a copy and paste", `ann@ex${ch(0x200b)}ample.com`, "ann@example.com"],
    ["a no-break space around it", `${ch(0xa0)}ann@example.com${ch(0xa0)}`, "ann@example.com"],
    ["the first unreadable, the second good", "none, bo@example.com", "bo@example.com"],
    ["a plus tag, which is kept as typed", "ann+gym@example.com", "ann+gym@example.com"],
  ])("%s", (_label, cell, expected) => {
    expect(cleanEmail(cell)).toBe(expected);
  });

  it.each([
    ["nothing", ""],
    ["spaces", "   "],
    ["a word", "not given"],
    ["no dot in the domain", "ann@example"],
    ["no name", "@example.com"],
    ["two at signs", "ann@@example.com"],
    ["a dash", "-"],
    ["an accented domain, which sign-in does not take either", `ann@ex${ch(0xe4)}mple.com`],
    ["a phone number", "9876543210"],
  ])("%s is no address at all", (_label, cell) => {
    expect(cleanEmail(cell)).toBe(null);
  });

  it("stops at the longest an address may be, and is never matched against a longer cell", () => {
    const address = (local: number): string => `${"a".repeat(local)}@example.com`;
    const longest = address(MEMBER_LIST_MAX_EMAIL_CHARS - "@example.com".length);
    expect(longest).toHaveLength(MEMBER_LIST_MAX_EMAIL_CHARS);
    expect(cleanEmail(longest)).toBe(longest);
    expect(cleanEmail(address(MEMBER_LIST_MAX_EMAIL_CHARS))).toBe(null);
  });

  it("takes exactly what sign-in takes, which is the point of it", () => {
    for (const address of ["ann@example.com", "ANN@EXAMPLE.COM", "ann@example", "not given", "ann+gym@example.com"]) {
      const signIn = authEmailSchema.safeParse(address);
      expect(cleanEmail(address)).toBe(signIn.success ? signIn.data : null);
    }
  });
});

describe("a name", () => {
  it.each([
    ["one column", { full: "Ann Lee" }, "Ann Lee"],
    ["two columns", { first: "Ann", last: "Lee" }, "Ann Lee"],
    ["a first name alone", { first: "Ann" }, "Ann"],
    ["a surname alone", { last: "Lee" }, "Lee"],
    ["the whole name where a file has both", { full: "Ann Lee", first: "Annabel", last: "Lee" }, "Ann Lee"],
    ["runs of spaces", { full: "  Ann    Lee " }, "Ann Lee"],
    ["a line break inside the cell", { full: "Ann\nLee" }, "Ann Lee"],
    ["a no-break space", { full: `Ann${ch(0xa0)}Lee` }, "Ann Lee"],
    ["nothing at all", {}, ""],
    ["an empty full name and two halves", { full: "  ", first: "Ann", last: "Lee" }, "Ann Lee"],
  ])("%s", (_label, parts, expected) => {
    expect(cleanName(parts)).toBe(expected);
  });

  it("is cut where it is longer than a name can be", () => {
    expect(cleanName({ full: "a".repeat(200) })).toHaveLength(MEMBER_LIST_MAX_NAME_CHARS);
  });
});

describe("a member number", () => {
  it.each([
    ["leading zeros, which are the number", "000123", "000123"],
    ["letters and dashes", "MEM-000123-A", "MEM-000123-A"],
    ["a trailing .0 a spreadsheet added", "123456.0", "123456"],
    ["a trailing .00", "123456.00", "123456"],
    ["exponent form with every digit", "1.23456789012E+11", "123456789012"],
    ["spaces around it", "  A123  ", "A123"],
  ])("%s", (_label, cell, expected) => {
    expect(cleanMemberNumber(cell)).toEqual({ value: expected, shortened: false });
  });

  it.each([["", ""], ["0", "0"], ["-", "-"], ["N/A", "N/A"], ["na", "na"], ["none", "none"], ["NULL", "NULL"]])("%s is no number at all", (_label, cell) => {
    expect(cleanMemberNumber(cell)).toEqual({ value: null, shortened: false });
  });

  it("says a number the spreadsheet shortened, and never guesses it back", () => {
    expect(cleanMemberNumber("1.23457E+15")).toEqual({ value: null, shortened: true });
  });

  it("is dropped whole rather than cut, because half a number is another member's", () => {
    const tooLong = "A".repeat(MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS + 1);
    expect(cleanMemberNumber(tooLong)).toEqual({ value: null, shortened: false });
  });

  // A gym's software calls the door fob a "card number", so that heading is
  // read as a member number — but an export whose card number is a BANK card
  // must not leave its digits in our list.
  it.each([
    ["a test Visa number", "4111111111111111"],
    ["a test Mastercard number", "5555555555554444"],
    ["a test Amex number", "378282246310005"],
    ["a 16-digit number with a card's check digit", "4242424242424242"],
  ])("%s is never kept", (_label, card) => {
    expect(looksLikeAPaymentCard(card)).toBe(true);
    expect(cleanMemberNumber(card)).toEqual({ value: null, shortened: false });
  });

  it.each([
    ["a long member number that is not shaped like a card", "1234567890123456"],
    ["a door fob number", "0001234567"],
    ["a member number with letters", "MEM-4111111111111111"],
    ["a short number", "12345"],
  ])("%s is kept", (_label, number) => {
    expect(looksLikeAPaymentCard(number)).toBe(false);
    expect(cleanMemberNumber(number).value).toBe(number);
  });
});

describe("the gym's own status word", () => {
  it.each([
    ["as written", "Active", "Active"],
    ["another gym's word", "Frozen", "Frozen"],
    ["a word of its own", "On hold - injury", "On hold - injury"],
    ["spaces collapsed", "  Past  Due  ", "Past Due"],
    ["a word in another language", "Aktiv", "Aktiv"],
    ["nothing", "", null],
    ["spaces alone", "   ", null],
  ])("%s", (_label, cell, expected) => {
    expect(cleanStatus(cell)).toBe(expected);
  });

  it("is cut where it is longer than a word", () => {
    expect(cleanStatus("z".repeat(60))).toHaveLength(MEMBER_LIST_MAX_STATUS_CHARS);
  });

  it.each([["yes"], ["Y"], ["TRUE"], ["1"], ["no"], ["N"], ["false"], ["0"]])("%s is a yes or a no, not a state of membership", (word) => {
    expect(isBooleanWord(word)).toBe(true);
  });

  it.each([["Active"], ["Frozen"], ["2"], ["paid"]])("%s is not a yes or a no", (word) => {
    expect(isBooleanWord(word)).toBe(false);
  });

  it.each([
    ["yes under Active", "Yes", "Active", "Active"],
    ["no under Active", "No", "Active", "Not active"],
    ["true under Active", "TRUE", "Active", "Active"],
    ["false under Active", "FALSE", "Active", "Not active"],
    ["1 under Member", "1", "Member", "Member"],
    ["0 under Member", "0", "Member", "Not member"],
    ["a heading already in capitals", "No", "ACTIVE", "Not ACTIVE"],
    ["anything else", "Frozen", "Active", null],
    ["an empty cell", "", "Active", null],
  ])("%s", (_label, cell, header, expected) => {
    expect(booleanStatus(cell, header)).toBe(expected);
  });
});

describe("who a row is", () => {
  const ann = { fullName: "Ann Lee", email: "ann@example.com", phone: "+919876543210", memberNumber: "000123" };

  it("is 64 hexadecimal characters", () => {
    expect(identityKey(ann)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same row twice", () => {
    expect(identityKey(ann)).toBe(identityKey({ ...ann }));
  });

  it("does NOT change when only the status changes, which is why a status change is a change in place", () => {
    // The status is not part of the key at all: the same four fields, so the
    // same key, whatever the gym's word says this month.
    expect(identityKey(ann)).toBe(identityKey({ ...ann }));
  });

  it.each([
    ["a different name", { fullName: "Ann Leigh" }],
    ["a different email", { email: "ann2@example.com" }],
    ["a different phone", { phone: "+919876543211" }],
    ["a different member number", { memberNumber: "000124" }],
    ["an email taken away", { email: null }],
  ])("changes with %s", (_label, change) => {
    expect(identityKey({ ...ann, ...change })).not.toBe(identityKey(ann));
  });

  it.each([
    ["the case of the name", { fullName: "ANN LEE" }],
    ["an accent on the name", { fullName: `Ann L${ch(0xe9)}e` }],
    ["spaces around the name", { fullName: " Ann  Lee " }],
  ])("does not change with %s", (_label, change) => {
    expect(identityKey({ ...ann, ...change })).toBe(identityKey(ann));
  });

  it("does not change with the case of the member number", () => {
    const withLetters = { ...ann, memberNumber: "MEM-123a" };
    expect(identityKey({ ...withLetters, memberNumber: "mem-123A" })).toBe(identityKey(withLetters));
  });

  it("is one person for two spellings that differ only by an accent", () => {
    expect(identityKey({ ...ann, fullName: "José Álvarez" })).toBe(identityKey({ ...ann, fullName: "jose alvarez" }));
  });

  it("keeps two people who share an email but not a name apart", () => {
    const family = { email: "family@example.com", phone: null, memberNumber: null };
    expect(identityKey({ ...family, fullName: "Ann Lee" })).not.toBe(identityKey({ ...family, fullName: "Bo Lee" }));
  });
});

describe("folding and cutting", () => {
  it("folds case, accents and spaces and nothing else", () => {
    expect(fold("  José   ÁLVAREZ ")).toBe("jose alvarez");
    expect(fold("O'Brien")).toBe("o'brien");
  });

  it("never cuts a character in half", () => {
    const emoji = "a".repeat(9) + ch(0x1f600);
    expect(cut(emoji, 10)).toBe("a".repeat(9));
    expect(cut(emoji, 11)).toBe(emoji);
  });
});
