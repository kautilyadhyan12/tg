// Which row is the headings and which column is which (spec Part 3 §9.5,
// §9.10), as one table over every class of case, written before review.
//
// The two rules being pinned here are the ones a wrong answer costs a member:
// a heading is believed only where the column's own cells agree with it, and a
// heading that names somebody who is NOT the member — an emergency contact, a
// trainer, a referrer — is never read as the member's own, whatever its cells
// hold.
import { describe, expect, it } from "vitest";
import { MEMBER_LIST_MOST_COLUMNS_PER_FIELD, type MemberListField } from "@app/shared";
import { columnStats, findHeaderRow, guessMapping } from "../src/modules/orgs/memberList/columns.js";
import { normaliseHeader, readHeader } from "../src/modules/orgs/memberList/headerWords.js";
import { readCountry } from "../src/modules/orgs/memberList/phone.js";

const ch = (code: number): string => String.fromCodePoint(code);

const mapOf = (rows: string[][], country: string | null = "IN") => {
  const headerRow = findHeaderRow(rows);
  const stats = columnStats(rows, headerRow, readCountry(country), { parsePhones: true });
  return { headerRow, stats, ...guessMapping(stats, headerRow) };
};

describe("a heading in one shape", () => {
  it.each([
    ["lower case", "EMAIL", "email"],
    ["a hyphen", "E-Mail", "e mail"],
    ["a dot and brackets", "Phone (Mobile)", "phone mobile"],
    ["an underscore", "member_number", "member number"],
    ["a slash", "Mobile/Cell", "mobile cell"],
    ["an accent", `T${ch(0xe9)}l${ch(0xe9)}phone`, "telephone"],
    ["a curly apostrophe (an apostrophe is a space, as every other mark is)", `Member${ch(0x2019)}s name`, "member s name"],
    ["a no-break space", `Full${ch(0xa0)}Name`, "full name"],
    ["a trailing 1, as Google Contacts writes", "E-mail 1", "e mail"],
    ["a trailing primary", "Phone - Primary", "phone"],
    ["a 1 that is not on the end", "E-mail 1 - Value", "e mail 1 value"],
    ["runs of spaces", "  Member   No  ", "member no"],
    ["a colon", "Status:", "status"],
  ])("%s", (_label, header, expected) => {
    expect(normaliseHeader(header)).toBe(expected);
  });
});

describe("what a heading names", () => {
  it.each([
    ["Email", "email"],
    ["E-mail Address", "email"],
    ["Email ID", "email"],
    ["Correo electrónico", "email"],
    ["E-mailadres", "email"],
    ["Mobile", "phone"],
    ["Mobile Number", "phone"],
    ["Cell Phone", "phone"],
    ["WhatsApp", "phone"],
    ["Contact Number", "phone"],
    ["Telefone", "phone"],
    ["Handy", "phone"],
    ["Full Name", "fullName"],
    ["Member Name", "fullName"],
    ["Naam", "fullName"],
    ["Nome completo", "fullName"],
    ["First Name", "firstName"],
    ["Vorname", "firstName"],
    ["Prénom", "firstName"],
    ["Last Name", "lastName"],
    ["Surname", "lastName"],
    ["Nachname", "lastName"],
    ["Cognome", "lastName"],
    ["Member ID", "memberNumber"],
    ["Membership Number", "memberNumber"],
    ["Check-in Code", "memberNumber"],
    ["Key Tag", "memberNumber"],
    ["Barcode", "memberNumber"],
    ["Mitgliedsnummer", "memberNumber"],
    ["Número de socio", "memberNumber"],
    ["Status", "status"],
    ["Membership Status", "status"],
    ["Estado", "status"],
    ["Situação", "status"],
  ])("%s", (header, field) => {
    expect(readHeader(header).field).toBe(field);
  });

  it.each([
    ["a heading of its own", "Joined"],
    ["an address", "Address Line 1"],
    ["a date", "Date of Birth"],
    ["a note", "Notes"],
    ["nothing", ""],
  ])("%s names no field", (_label, header) => {
    expect(readHeader(header).field).toBe(null);
    expect(readHeader(header).isHeaderWord).toBe(false);
  });

  it("reads a name with an apostrophe in it all the same", () => {
    expect(readHeader(`Member${ch(0x2019)}s name`).field).toBe("fullName");
  });

  it("a heading naming two fields with words of the same length names neither", () => {
    // "first" and "email" are both five letters, and nothing says which it is.
    // Its cells can still make it an email column, which the grid tests cover.
    expect(readHeader("First Email").field).toBe(null);
    expect(readHeader("First Email").isHeaderWord).toBe(true);
  });

  it("the longer word wins where one holds the other", () => {
    expect(readHeader("Client Email ID").field).toBe("email");
    expect(readHeader("Customer ID").field).toBe("memberNumber");
    expect(readHeader("Nome completo").field).toBe("fullName");
  });
});

describe("a heading that names somebody who is not the member", () => {
  const NOT_THE_MEMBERS: ReadonlyArray<[string, MemberListField]> = [
    ["Emergency Contact Phone", "phone"],
    ["Emergency Email", "email"],
    ["Guardian Name", "fullName"],
    ["Parent Email", "email"],
    ["Spouse Phone", "phone"],
    ["Next of Kin Phone", "phone"],
    ["Referred By Email", "email"],
    ["Trainer Name", "fullName"],
    ["Coach Email", "email"],
    ["Sales Rep Name", "fullName"],
    ["Staff Email", "email"],
    ["Employee Name", "fullName"],
    ["Company Phone", "phone"],
    ["Employer Name", "fullName"],
  ];

  it.each(NOT_THE_MEMBERS)("%s is never the member's %s", (header, field) => {
    expect(readHeader(header).never.has(field)).toBe(true);
  });

  it.each([
    ["Payment Status", "payment"],
    ["Billing Status", "billing"],
    ["Invoice Status", "invoice"],
    ["Marketing Status", "marketing"],
    ["Email Status", "an email"],
    ["E-mail status", "an e-mail"],
    ["SMS Status", "a text"],
    ["Waiver Status", "a waiver"],
    ["Card Status", "a card"],
  ])("%s is never the membership's status (%s)", (header) => {
    expect(readHeader(header).never.has("status")).toBe(true);
  });

  it("an ordinary heading forbids nothing", () => {
    expect(readHeader("Mobile").never.size).toBe(0);
  });
});

describe("which of several columns of one kind is the main one", () => {
  const rankOf = (header: string): number => readHeader(header).rank;

  it("a mobile comes before a landline, and home before work", () => {
    expect(rankOf("Mobile")).toBeLessThan(rankOf("Phone"));
    expect(rankOf("Phone")).toBeLessThan(rankOf("Home Phone"));
    expect(rankOf("Home Phone")).toBeLessThan(rankOf("Work Phone"));
  });

  it("the bare word beats a longer one", () => {
    expect(rankOf("Email")).toBeLessThan(rankOf("Email Address"));
  });

  it.each([["Secondary Email"], ["Alternate Email"], ["Other Email"], ["Work Email"], ["Email 2"]])("%s ranks after every email column that does not say so", (header) => {
    expect(rankOf(header)).toBeGreaterThan(rankOf("Email Address"));
  });

  it.each([
    ["Other Phone", "Phone"],
    ["Phone 3", "Phone"],
    ["Alternate Mobile", "Mobile"],
    ["Secondary Email", "Email"],
  ])("%s ranks after the %s column it is the spare of", (spare, main) => {
    expect(rankOf(spare)).toBeGreaterThan(rankOf(main));
  });

  it("a work number is still the last of the phone columns", () => {
    for (const header of ["Mobile", "Phone", "Home Phone", "Other Phone", "Alternate Mobile"]) {
      expect(rankOf("Work Phone")).toBeGreaterThan(rankOf(header));
    }
  });
});

describe("which row holds the headings", () => {
  it("the first row, in an ordinary export", () => {
    expect(findHeaderRow([["Name", "Email"], ["Ann Lee", "ann@example.com"]])).toBe(0);
  });

  it("under a title block and a blank line", () => {
    const rows = [["Members of Jorhat Fitness"], ["Exported 5 January 2024"], [], ["Name", "Email", "Mobile"], ["Ann Lee", "ann@example.com", "9876543210"]];
    expect(findHeaderRow(rows)).toBe(3);
  });

  it("is nowhere in a file that starts straight in with the people", () => {
    expect(findHeaderRow([["Ann Lee", "ann@example.com"], ["Bo Chen", "bo@example.com"]])).toBe(null);
  });

  it("is not a row of people's own details, however many words it holds", () => {
    // "Mobile" and "Email" as VALUES: a row of real addresses and numbers.
    expect(findHeaderRow([["ann@example.com", "9876543210", "Ann Lee"], ["bo@example.com", "9876543211", "Bo Chen"]])).toBe(null);
  });

  it("is not a row that holds a heading word beside somebody's own details", () => {
    // Somebody's details are worth more against a row than a known word is for
    // it, so one word in a row of real addresses never carries it.
    const rows = [["Name", "ann@example.com", "9876543210"], ["Bo Chen", "bo@example.com", "9876543211"]];
    expect(findHeaderRow(rows)).toBe(null);
  });

  it("is the first of two rows that score the same", () => {
    expect(findHeaderRow([["Name", "Email"], ["Name", "Email"], ["Ann Lee", "ann@example.com"]])).toBe(0);
  });

  it("needs two points: one heading word alone is not a heading row", () => {
    expect(findHeaderRow([["Name"], ["Ann Lee"]])).toBe(0);
    expect(findHeaderRow([["Joined"], ["2024-01-05"]])).toBe(null);
  });

  it("is not looked for past the twentieth row that holds anything", () => {
    const blank: string[] = [];
    const filler = Array.from({ length: 20 }, (_, i) => [`Line ${String(i)}`]);
    const rows = [...filler, blank, ["Name", "Email", "Mobile"], ["Ann Lee", "ann@example.com", "9876543210"]];
    expect(findHeaderRow(rows)).toBe(null);
  });

  it("is found on the twentieth row that holds anything", () => {
    const filler = Array.from({ length: 19 }, (_, i) => [`Line ${String(i)}`]);
    const rows = [...filler, ["Name", "Email", "Mobile"], ["Ann Lee", "ann@example.com", "9876543210"]];
    expect(findHeaderRow(rows)).toBe(19);
  });
});

describe("which column is which", () => {
  it("takes the plain case", () => {
    const { mapping, confidence } = mapOf([
      ["Member No", "Full Name", "Email", "Mobile", "Status"],
      ["000123", "Ann Lee", "ann@example.com", "9876543210", "Active"],
    ]);
    expect(mapping).toEqual({ sheet: null, headerRow: 0, fullName: 1, firstName: null, lastName: null, email: [2], phone: [3], memberNumber: 0, status: 4 });
    expect(confidence.get(2)).toBe("header");
  });

  it("puts several email columns in order, and keeps the losers as spares", () => {
    const { mapping } = mapOf([
      ["Secondary Email", "Email Address", "Email"],
      ["spare@example.com", "long@example.com", "main@example.com"],
    ]);
    expect(mapping.email).toEqual([2, 1, 0]);
  });

  it("puts a mobile before a landline before a work number", () => {
    const { mapping } = mapOf([
      ["Work Phone", "Home Phone", "Phone", "Mobile"],
      ["9876543210", "9876543211", "9876543212", "9876543213"],
    ]);
    expect(mapping.phone).toEqual([3, 2, 1, 0]);
  });

  it("keeps at most five columns of one kind, however many the file has", () => {
    const headers = Array.from({ length: 8 }, (_, i) => (i === 0 ? "Email" : `Email ${String(i + 1)}`));
    const values = Array.from({ length: 8 }, (_, i) => `a${String(i)}@example.com`);
    const { mapping } = mapOf([headers, values]);
    expect(mapping.email).toHaveLength(MEMBER_LIST_MOST_COLUMNS_PER_FIELD);
    expect(mapping.email[0]).toBe(0);
  });

  it("does not believe a heading its column's cells disagree with", () => {
    const { mapping } = mapOf([
      ["Email", "Mobile"],
      ["yes", "yes"],
      ["no", "no"],
      ["ann@example.com", "9876543210"],
      ["no", "no"],
      ["no", "no"],
    ]);
    expect(mapping.email).toEqual([]);
    expect(mapping.phone).toEqual([]);
  });

  it("believes a heading where most of its cells agree", () => {
    const { mapping } = mapOf([
      ["Email"],
      ["ann@example.com"],
      ["bo@example.com"],
      ["not given"],
      ["cara@example.com"],
      ["dee@example.com"],
    ]);
    expect(mapping.email).toEqual([0]);
  });

  it("reads a file with no headings from its cells alone", () => {
    const { headerRow, mapping, confidence } = mapOf([
      ["Ann Lee", "ann@example.com", "9876543210"],
      ["Bo Chen", "bo@example.com", "9876543211"],
      ["Cara Diaz", "cara@example.com", "9876543212"],
    ]);
    expect(headerRow).toBe(null);
    expect(mapping.email).toEqual([1]);
    expect(mapping.phone).toEqual([2]);
    expect(mapping.fullName).toBe(null);
    expect(confidence.get(1)).toBe("values");
  });

  it("asks more of a column with no heading than of one with", () => {
    // Four in five is enough under a heading, and not enough without one.
    const cells = [["ann@example.com"], ["bo@example.com"], ["cara@example.com"], ["dee@example.com"], ["not given"]];
    expect(mapOf([["Email"], ...cells]).mapping.email).toEqual([0]);
    expect(mapOf([...cells, ["eve@example.com"], ["not given"]]).mapping.email).toEqual([]);
  });

  it("reads a column of names and addresses written together as the email column", () => {
    const rows = [["Email"], ["Ann Lee <ann@example.com>"], ["Bo Chen <bo@example.com>"], ["Cara Diaz <cara@example.com>"]];
    expect(mapOf(rows).mapping.email).toEqual([0]);
  });

  it("does not read a note that happens to hold an address as the email column", () => {
    const rows = [["Notes"], ["call ann@example.com about the fee"], ["email bo@example.com"], ["cara@example.com is her address"], ["write to dee@example.com"]];
    expect(mapOf(rows).mapping.email).toEqual([]);
  });

  it("never reads a member number as a phone number, however phone-like it looks", () => {
    const { mapping } = mapOf([
      ["Member ID", "Email"],
      ["98765432", "ann@example.com"],
      ["98765433", "bo@example.com"],
    ]);
    expect(mapping.memberNumber).toBe(0);
    expect(mapping.phone).toEqual([]);
  });

  it("never guesses a status from a column's words", () => {
    const { mapping } = mapOf([
      ["Email", "Kind"],
      ["ann@example.com", "Active"],
      ["bo@example.com", "Frozen"],
    ]);
    expect(mapping.status).toBe(null);
  });

  it("never reads an emergency contact's number as the member's, even where every cell is a number", () => {
    const { mapping } = mapOf([
      ["Email", "Emergency Contact Number"],
      ["ann@example.com", "9876543210"],
      ["bo@example.com", "9876543211"],
    ]);
    expect(mapping.phone).toEqual([]);
    expect(mapping.email).toEqual([0]);
  });

  it("never reads a trainer's email as the member's, even with no heading row to go on", () => {
    const { mapping } = mapOf([
      ["Name", "Trainer Email"],
      ["Ann Lee", "coach@example.com"],
      ["Bo Chen", "coach2@example.com"],
    ]);
    expect(mapping.email).toEqual([]);
  });

  it('reads "Name" beside "First name" as the surname, as Magicline writes it', () => {
    const { mapping } = mapOf([
      ["First name", "Name", "Email"],
      ["Ann", "Lee", "ann@example.com"],
    ]);
    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.fullName).toBe(null);
  });

  it('reads "Name" on its own as the whole name', () => {
    const { mapping } = mapOf([
      ["Name", "Email"],
      ["Ann Lee", "ann@example.com"],
    ]);
    expect(mapping.fullName).toBe(0);
    expect(mapping.lastName).toBe(null);
  });

  it("gives a real surname column the surname where a bare Name column is there too", () => {
    const { mapping } = mapOf([
      ["First name", "Name", "Surname", "Email"],
      ["Ann", "A. Lee", "Lee", "ann@example.com"],
    ]);
    expect(mapping.lastName).toBe(2);
  });

  it("gives one column to one field", () => {
    const { mapping } = mapOf([
      ["Email", "Mobile"],
      ["ann@example.com", "9876543210"],
    ]);
    const used = [mapping.fullName, mapping.firstName, mapping.lastName, mapping.memberNumber, mapping.status, ...mapping.email, ...mapping.phone].filter((i) => i !== null);
    expect(new Set(used).size).toBe(used.length);
  });
});
