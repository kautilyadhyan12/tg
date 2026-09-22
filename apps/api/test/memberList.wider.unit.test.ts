// The wider member record (spec Part 3 §11): what a gym's file keeps beyond the
// five things, and what it NEVER keeps.
//
// **THE FIRST TESTS HERE ARE THE WORST THING THIS CARD COULD DO TO A REAL
// PERSON** (CLAUDE.md §4, RULINGS 2026-09-20): leave their bank card number or
// a medical note in our database, or take somebody ELSE's details — an
// emergency contact's, a parent's — and show them as the member's own.
//
// The cases come from OUTSIDE the code. Every heading below was read on a real
// product's own page or is the wording a real form uses, and the sources are
// named beside the tests that use them:
//   · Gymdesk, "Data Imports Overview", read 2026-09-22 — its supported member
//     import fields: Full Name · First Name · Last Name · Date of Birth ·
//     Gender · Status · Member Type · Join Date · Cancellation Date · Phone
//     Numbers (Primary, Secondary) · Email Addresses (Primary, Secondary) ·
//     Parent Names (First, Last) · Medical Conditions · Street · City · State ·
//     Zip/Postal Code · Country · Program and Rank Info · Promotion Date ·
//     Check-in Code · Photo · Source · Notes · Up to (3) Emergency Contacts
//     (Name, Phone, and Relationship).
//   · Gymdesk, "Migrating Member Payment Information", read 2026-09-22 — a
//     token column and the "card or bank account holder name".
//   · GymMaster, "Data Transfers", read 2026-09-22 — Birthdate · Joining date ·
//     Membership start date · Next Billing Date · Cancellation date, and
//     "Tokenized billing details (e.g. credit card and bank details)".
//   · Wikipedia, "Postal code", read 2026-09-22 — postcode · post code ·
//     postal code · PIN · ZIP Code, and Ireland's Eircode.
// and they INCLUDE words no list of ours holds ("Locker No", "Belt", "Batch",
// "Gotra"), because a list that only matches itself proves nothing.
//
// Every person here is invented. The card, IBAN and ID numbers are the test
// values the card schemes and the standards publish, or numbers built here to
// carry a valid check digit — never anybody's.
import { describe, expect, it } from "vitest";
import {
  MEMBER_LIST_MAX_EXTRA_CHARS,
  MEMBER_LIST_MAX_EXTRA_FIELDS,
  MEMBER_LIST_MAX_STATUS_CHARS,
  type MemberFileGrid,
  type MemberListMapping,
  type MemberListUnderstanding,
  memberListUnderstandResultSchema,
} from "@app/shared";
import { type UnderstandOptions, understandMemberGrid } from "../src/modules/orgs/memberList/understand.js";

const gridOf = (rows: string[][]): MemberFileGrid => ({
  ok: true,
  kind: "csv",
  sheets: [{ name: null, rows, truncated: { rows: false, columns: false } }],
  facts: {},
  warnings: [],
});

const read = (rows: string[][], options: Partial<UnderstandOptions> = {}): MemberListUnderstanding => {
  const result = understandMemberGrid(gridOf(rows), { country: "IN", ...options });
  expect(memberListUnderstandResultSchema.safeParse(result).success).toBe(true);
  if (!result.ok) throw new Error(`refused: ${result.refusal.code}`);
  return result;
};

const EMPTY_MAPPING: MemberListMapping = {
  sheet: null,
  headerRow: null,
  fullName: null,
  firstName: null,
  lastName: null,
  email: [],
  phone: [],
  memberNumber: null,
  status: null,
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  paymentStatus: null,
  dateOfBirth: null,
  dontKeep: [],
  dateOrder: [],
};
const mappingOf = (over: Partial<MemberListMapping>): MemberListMapping => ({ ...EMPTY_MAPPING, ...over });

/** Everything the answer carries about one file, as one string: the rows, the
 *  columns' sample cells, the extra fields, the dates, the chips and the
 *  warnings. A cell §11.2 dropped must not be ANYWHERE in it. */
const everythingSaid = (found: MemberListUnderstanding): string => JSON.stringify(found);

const columnAt = (found: MemberListUnderstanding, index: number): MemberListUnderstanding["columns"][number] => {
  const column = found.columns[index];
  if (column === undefined) throw new Error(`no column ${String(index)}`);
  return column;
};

const extraOf = (found: MemberListUnderstanding, label: string): string[] => {
  const at = found.extraFields.findIndex((field) => field.label === label);
  if (at < 0) throw new Error(`no extra field "${label}" — has ${found.extraFields.map((f) => f.label).join(", ")}`);
  return found.rows.map((row) => row.extra[at] ?? "");
};

// Test numbers the card schemes publish, and numbers built to carry a real
// check digit. Nobody's.
const VISA_TEST_CARD = "4111111111111111";
const MASTERCARD_TEST_CARD = "5500 0000 0000 0004";
const AMEX_TEST_CARD = "3400-0000-0000-009";
const IBAN_GB = "GB82 WEST 1234 5698 7654 32";
// Twelve digits starting 2-9 that carry a valid Verhoeff check digit, built
// here (the check itself is proved against Verhoeff's own published vectors in
// `memberList.neverKeep.unit.test.ts`). Nobody's Aadhaar.
const AADHAAR_SHAPED = "234567890124";
const AADHAAR_SHAPED_TWO = "345678901238";
const PAN_SHAPED = "ABCDE1234F";
const UK_NI_SHAPED = "AB123456C";
const US_SSN_SHAPED = "123-45-6789";

// ---------------------------------------------------------------------------
// The worst thing, first
// ---------------------------------------------------------------------------

describe("the worst thing — a payment card number, in a column called anything", () => {
  it.each([
    ["a column called Notes", "Notes"],
    ["a column called Locker No", "Locker No"],
    ["the gym's own member number", "Member ID"],
    ["a column with no heading at all", ""],
    ["a column the gym called Card Number, meaning a door fob", "Card Number"],
  ])("is dropped from %s", (_what, heading) => {
    const found = read([
      ["Name", "Email", heading],
      ["Ann Lee", "ann@example.com", VISA_TEST_CARD],
      ["Bo Chen", "bo@example.com", MASTERCARD_TEST_CARD],
      ["Cara Diaz", "cara@example.com", AMEX_TEST_CARD],
    ]);
    const said = everythingSaid(found);
    for (const card of [VISA_TEST_CARD, MASTERCARD_TEST_CARD, AMEX_TEST_CARD, "4111", "550000000000", "340000000000"]) {
      expect(said).not.toContain(card);
    }
    // The column is named, so staff know why it is missing, and shows no cell.
    expect(columnAt(found, 2).neverKept).toBe("payment_card");
    expect(columnAt(found, 2).samples).toEqual([]);
    expect(columnAt(found, 2).guess).toBe(null);
    expect(found.extraFields.map((field) => field.column)).not.toContain(2);
    // And the people are still there: nothing is lost but the card.
    expect(found.rows.map((row) => row.fullName)).toEqual(["Ann Lee", "Bo Chen", "Cara Diaz"]);
  });

  it("drops ONE card cell sitting in a column of ordinary notes, and keeps the rest of the column", () => {
    const found = read([
      ["Name", "Email", "Notes"],
      ["Ann Lee", "ann@example.com", "Prefers mornings"],
      ["Bo Chen", "bo@example.com", VISA_TEST_CARD],
      ["Cara Diaz", "cara@example.com", "Knee injury cleared by her doctor"],
    ]);
    expect(everythingSaid(found)).not.toContain(VISA_TEST_CARD);
    expect(extraOf(found, "Notes")).toEqual(["Prefers mornings", "", "Knee injury cleared by her doctor"]);
    expect(found.warnings).toContainEqual({ code: "card_cells_dropped", rows: 1 });
  });

  it("drops a card number typed into the NAME column", () => {
    const found = read([
      ["Name", "Email"],
      [VISA_TEST_CARD, "ann@example.com"],
    ]);
    expect(everythingSaid(found)).not.toContain(VISA_TEST_CARD);
    expect(found.rows[0]?.fullName).toBe("");
    expect(found.rows[0]?.email).toBe("ann@example.com");
  });

  it("keeps a number that only LOOKS like a card but fails the check digit", () => {
    const notACard = "4111111111111112";
    const found = read([
      ["Name", "Email", "Locker No"],
      ["Ann Lee", "ann@example.com", notACard],
    ]);
    expect(extraOf(found, "Locker No")).toEqual([notACard]);
  });

  it("refuses to let staff map a dropped column onto a field", () => {
    const rows = [
      ["Name", "Email", "Card Number"],
      ["Ann Lee", "ann@example.com", VISA_TEST_CARD],
      ["Bo Chen", "bo@example.com", MASTERCARD_TEST_CARD],
    ];
    const found = read(rows, { mapping: mappingOf({ headerRow: 0, fullName: 0, email: [1], memberNumber: 2 }) });
    expect(found.mapping.memberNumber).toBe(null);
    expect(columnAt(found, 2).neverKept).toBe("payment_card");
    expect(everythingSaid(found)).not.toContain(VISA_TEST_CARD);
    expect(found.rows.map((row) => row.memberNumber)).toEqual([null, null]);
  });
});

describe("the worst thing — the round-one Criticals, driven end to end", () => {
  // Review of PR #90. Each of these was green on 2,555 tests and is here so it
  // can never be green again. Every one goes through the whole reader.

  it("drops a card typed the way a person types it, in the MEMBER NUMBER column", () => {
    // Critical 1. `cleanMemberNumber` asked the bare-digits rule, so the same
    // card was dropped without spaces and kept with them — as the member's own
    // number, on the screen staff invite from. Four ordinary numbers keep the
    // column under the 0.6 share, so the COLUMN rule cannot be what catches it.
    const found = read([
      ["Member ID", "Full Name", "Email"],
      ["M1001", "Ann Lee", "ann@example.com"],
      ["M1002", "Bo Chen", "bo@example.com"],
      ["4111 1111 1111 1111", "Cara Diaz", "cara@example.com"],
      [VISA_TEST_CARD, "Dan Ellis", "dan@example.com"],
      ["M1005", "Eve Nair", "eve@example.com"],
      ["M1006", "Fay Ray", "fay@example.com"],
    ]);
    expect(columnAt(found, 0).neverKept).toBe(null);
    expect(found.rows.map((row) => row.memberNumber)).toEqual(["M1001", "M1002", null, null, "M1005", "M1006"]);
    expect(everythingSaid(found)).not.toContain("4111");
    // …and both drops are counted, which the member-number one never was.
    expect(found.warnings).toContainEqual({ code: "card_cells_dropped", rows: 2 });
  });

  it.each([["Fathers Name"], ["Guardians Email"], ["Parents Email"], ["Mothers Mobile"], ["Nominees Email"], ["Spouses Email"], ["Relatives Phone"], ["Fathers Date of Birth"]])("never reads %s as the member's own", (header) => {
    // Critical 2. `normaliseHeader` turns an apostrophe into a space, so
    // "Father's Name" held "father" and matched — but "Fathers Name", which is
    // how a gym's export really writes it, held nothing and walked past the
    // list that decides WHO GETS INVITED.
    const found = read([
      ["Full Name", "Email", "Mobile", header],
      ["Ann Lee", "ann@example.com", "9876543210", "ravi@example.com"],
      ["Bo Chen", "bo@example.com", "9876543211", "mei@example.com"],
    ]);
    expect(columnAt(found, 3).guess).toBe(null);
    expect(found.rows.map((row) => row.email)).toEqual(["ann@example.com", "bo@example.com"]);
    expect(found.rows.map((row) => row.phone)).toEqual(["+919876543210", "+919876543211"]);
    expect(found.rows.map((row) => row.dateOfBirth)).toEqual([null, null]);
    expect(found.rows.map((row) => row.fullName)).toEqual(["Ann Lee", "Bo Chen"]);
  });

  it("does not fall back to a guardian's address when the member has none", () => {
    // The end of Critical 2: the member's own cells empty, which is exactly the
    // file a junior membership produces.
    const found = read([
      ["Full Name", "Email", "Mobile", "Guardians Email", "Guardians Mobile"],
      ["Ann Lee", "", "", "ravi@example.com", "9000000001"],
      ["Bo Chen", "", "", "mei@example.com", "9000000002"],
    ]);
    // No column of the member's OWN is usable, so the file is not refused and
    // nothing is guessed: staff are asked which column is which (§9.5), and
    // nobody is invited from a guardian's address in the meantime.
    expect(found.needsMapping).toBe(true);
    expect(found.rows).toEqual([]);
    expect(found.mapping.email).toEqual([]);
    expect(found.mapping.phone).toEqual([]);
    expect(columnAt(found, 3).guess).toBe(null);
    expect(columnAt(found, 4).guess).toBe(null);
  });

  it("drops a US gym's door PIN, because its postcode is already in its own column", () => {
    // Critical 3. The sheet has an address, so a bare "PIN" was kept on every
    // member — even beside an explicit "Zip Code".
    const found = read(
      [
        ["Full Name", "Email", "Address", "City", "Zip Code", "PIN"],
        ["Ann Bell", "ann@example.com", "12 Main St", "Austin", "78701", "4821"],
        ["Bo Reed", "bo@example.com", "9 Oak Ave", "Austin", "78702", "9134"],
      ],
      { country: "US" },
    );
    expect(columnAt(found, 5).neverKept).toBe("password_or_pin");
    expect(columnAt(found, 4).neverKept).toBe(null);
    expect(extraOf(found, "Zip Code")).toEqual(["78701", "78702"]);
    expect(everythingSaid(found)).not.toContain("4821");
  });

  it("drops a gym's keypad codes whatever they are called, on a sheet with no address at all", () => {
    // Re-check of PR #90: round one's own fix left these kept on every sheet.
    // A file with no address column, which is what a small gym's export is.
    const found = read([
      ["Full Name", "Email", "Mobile", "Member PIN", "Check-in PIN", "Gym PIN"],
      ["Ann Lee", "ann@example.com", "9876543210", "4821", "9134", "2277"],
      ["Bo Chen", "bo@example.com", "9876543211", "1234", "5678", "9012"],
    ]);
    for (const at of [3, 4, 5]) expect(columnAt(found, at).neverKept).toBe("password_or_pin");
    for (const code of ["4821", "9134", "2277", "1234", "5678", "9012"]) expect(everythingSaid(found)).not.toContain(code);
    expect(found.extraFields).toEqual([]);
    // …and the people are untouched.
    expect(found.rows.map((row) => row.fullName)).toEqual(["Ann Lee", "Bo Chen"]);
  });

  it("still keeps an Indian gym's PIN, where the bare PIN IS the postcode", () => {
    const found = read(
      [
        ["Full Name", "Email", "Address", "City", "PIN"],
        ["Ann Lee", "ann@example.com", "12 MG Road", "Bengaluru", "560001"],
      ],
      { country: "IN" },
    );
    expect(columnAt(found, 4).neverKept).toBe(null);
    expect(extraOf(found, "PIN")).toEqual(["560001"]);
  });

  it("drops the short forms a real export writes, and never reads one as a phone", () => {
    // High 4. "Tax File No" and "Transit No" were kept — and being nine and ten
    // digits, the values-only rule then took them as the member's PHONE, which
    // is the invite channel. One member's own mobile cell is empty here, which
    // is how the review found a member carrying a stranger's number.
    const found = read(
      [
        ["Full Name", "Email", "Mobile", "Tax File No", "Driver's License", "Transit No"],
        ["Ann Bell", "ann@example.com", "0412345671", "123456782", "NSW-1234567", "0012345678"],
        ["Ben Cole", "ben@example.com", "", "123456783", "NSW-1234568", "0012345679"],
      ],
      { country: "AU" },
    );
    expect(columnAt(found, 3).neverKept).toBe("government_id");
    expect(columnAt(found, 4).neverKept).toBe("government_id");
    expect(columnAt(found, 5).neverKept).toBe("bank_details");
    expect(found.mapping.phone).toEqual([2]);
    expect(found.rows.map((row) => row.phone)).toEqual(["+61412345671", null]);
    for (const cell of ["123456782", "123456783", "NSW-1234567", "0012345678"]) expect(everythingSaid(found)).not.toContain(cell);
  });

  it("reads a date column's order from EVERY row, not its first two hundred cells", () => {
    // High 5. 205 cells that could be read either way, and the one cell that
    // settles it past the sample: the whole column was read the wrong way round
    // for a US gym and the preview said the COUNTRY had decided.
    const rows: string[][] = [["Full Name", "Email", "Join Date"]];
    for (let n = 0; n < 205; n++) rows.push([`Person ${String(n)}`, `p${String(n)}@example.com`, "02/05/2024"]);
    rows.push(["Late One", "late@example.com", "25/12/2024"]);
    const found = read(rows, { country: "US" });
    expect(found.dateColumns[0]).toMatchObject({ order: "dayFirst", from: "file" });
    expect(found.rows[0]?.joinedOn).toBe("2024-05-02");
    expect(found.rows[205]?.joinedOn).toBe("2024-12-25");
  });
});

describe("the worst thing — somebody else's details are never the member's", () => {
  // Gymdesk's own import fields name up to three emergency contacts with a
  // name, a phone and a relationship, and the parents' names beside them.
  const rows = [
    ["Name", "Email", "Mobile", "Emergency Contact Name", "Emergency Contact Phone", "Parent Email", "Guardian Date of Birth", "Nominee Membership Type"],
    ["Ann Lee", "ann@example.com", "9876543210", "Ravi Lee", "9000000001", "ravi@example.com", "01/02/1970", "Gold"],
    ["Bo Chen", "bo@example.com", "9876543211", "Mei Chen", "9000000002", "mei@example.com", "02/03/1972", "Silver"],
  ];

  it("never reads a contact's phone, email, birthday or membership as the member's", () => {
    const found = read(rows);
    expect(found.rows.map((row) => row.email)).toEqual(["ann@example.com", "bo@example.com"]);
    expect(found.rows.map((row) => row.phone)).toEqual(["+919876543210", "+919876543211"]);
    expect(found.rows.map((row) => row.dateOfBirth)).toEqual([null, null]);
    expect(found.rows.map((row) => row.membershipType)).toEqual([null, null]);
    for (const field of ["dateOfBirth", "membershipType"] as const) expect(found.mapping[field]).toBe(null);
  });

  it("keeps those columns as the gym's own fields instead, so nothing is lost", () => {
    const found = read(rows);
    expect(extraOf(found, "Guardian Date of Birth")).toEqual(["01/02/1970", "02/03/1972"]);
    expect(extraOf(found, "Nominee Membership Type")).toEqual(["Gold", "Silver"]);
    expect(extraOf(found, "Emergency Contact Phone")).toEqual(["9000000001", "9000000002"]);
  });

  it("holds even where the qualifier is a word no list of ours has ever heard of", () => {
    // "Gotra" is a family line, on real Indian membership forms; no list here
    // holds it. The STRUCTURAL rule is what saves us: the plain column wins.
    const found = read([
      ["Date of Birth", "Gotra Date of Birth", "Email"],
      ["01/02/1990", "01/02/1940", "ann@example.com"],
      ["02/03/1991", "02/03/1941", "bo@example.com"],
    ]);
    expect(found.mapping.dateOfBirth).toBe(0);
    expect(found.rows.map((row) => row.dateOfBirth)).toEqual(["1990-02-01", "1991-03-02"]);
  });
});

describe("the worst thing — a medical note is never kept", () => {
  // "Medical Conditions" is a field Gymdesk's own import TAKES. Ours never will
  // (RULINGS 2026-09-07: the app holds no medical detail).
  it.each([
    ["Medical Conditions", "Asthma, uses an inhaler"],
    ["Health Notes", "Recovering from a knee operation"],
    ["Injuries", "Torn rotator cuff, left"],
    ["Allergies", "Peanuts — carries an EpiPen"],
    ["PAR-Q Answers", "Yes to chest pain"],
    ["Blood Group", "O+"],
    ["Doctor", "Dr Mehta, Apollo"],
    ["Medication", "Metformin 500mg"],
    ["Disability", "Wheelchair user"],
  ])("drops %s", (heading, cell) => {
    const found = read([
      ["Name", "Email", heading],
      ["Ann Lee", "ann@example.com", cell],
    ]);
    expect(columnAt(found, 2).neverKept).toBe("medical");
    expect(everythingSaid(found)).not.toContain(cell);
    expect(found.rows[0]?.extra).toEqual([]);
  });

  it("keeps Terms and Conditions, which is a signature and not a diagnosis", () => {
    const found = read([
      ["Name", "Email", "Terms and Conditions Accepted"],
      ["Ann Lee", "ann@example.com", "Yes"],
    ]);
    expect(columnAt(found, 2).neverKept).toBe(null);
    expect(extraOf(found, "Terms and Conditions Accepted")).toEqual(["Yes"]);
  });

  it("keeps a plain Notes column, which is the gym's own writing", () => {
    const found = read([
      ["Name", "Email", "Notes"],
      ["Ann Lee", "ann@example.com", "Joined with her sister"],
    ]);
    expect(extraOf(found, "Notes")).toEqual(["Joined with her sister"]);
  });
});

describe("the worst thing — bank and government ID numbers are never kept", () => {
  it.each([
    ["Bank Account Number", "12345678", "bank_details"],
    ["Sort Code", "12-34-56", "bank_details"],
    ["IFSC", "HDFC0001234", "bank_details"],
    ["BSB", "062-000", "bank_details"],
    ["Routing Number", "021000021", "bank_details"],
    ["UPI ID", "ann@okhdfcbank", "bank_details"],
    ["Passport No", "Z1234567", "government_id"],
    ["Driving Licence Number", "MH0120110012345", "government_id"],
    ["Aadhaar", AADHAAR_SHAPED, "government_id"],
    ["PAN", PAN_SHAPED, "government_id"],
    ["Door Code", "4821", "password_or_pin"],
    ["Password", "hunter2", "password_or_pin"],
    ["Security Question", "First pet", "password_or_pin"],
  ])("drops %s by its heading", (heading, cell, reason) => {
    const found = read([
      ["Name", "Email", heading],
      ["Ann Lee", "ann@example.com", cell],
    ]);
    expect(columnAt(found, 2).neverKept).toBe(reason);
    expect(everythingSaid(found)).not.toContain(cell);
  });

  it.each([
    ["IBANs", IBAN_GB, "DE89 3704 0044 0532 0130 00", "bank_details"],
    ["Aadhaar numbers", AADHAAR_SHAPED, AADHAAR_SHAPED_TWO, "government_id"],
    ["PANs", PAN_SHAPED, "ZYXWV9876E", "government_id"],
    ["UK National Insurance numbers", UK_NI_SHAPED, "JG121212A", "government_id"],
    ["US Social Security numbers", US_SSN_SHAPED, "234-56-7891", "government_id"],
  ])("drops a column of %s under a heading that says nothing", (_what, one, two, reason) => {
    const found = read([
      ["Name", "Email", "Reference"],
      ["Ann Lee", "ann@example.com", one],
      ["Bo Chen", "bo@example.com", two],
    ]);
    expect(columnAt(found, 2).neverKept).toBe(reason);
    expect(everythingSaid(found)).not.toContain(one);
    expect(everythingSaid(found)).not.toContain(two);
  });

  it("keeps a bare Account Number where the sheet has no bank columns — it is the gym's own number", () => {
    const found = read([
      ["Name", "Email", "Account Number"],
      ["Ann Lee", "ann@example.com", "A-1001"],
      ["Bo Chen", "bo@example.com", "A-1002"],
    ]);
    expect(columnAt(found, 2).neverKept).toBe(null);
    expect(extraOf(found, "Account Number")).toEqual(["A-1001", "A-1002"]);
  });

  it("drops the same column where the sheet DOES carry bank columns", () => {
    const found = read([
      ["Name", "Email", "Account Number", "Sort Code"],
      ["Ann Lee", "ann@example.com", "12345678", "12-34-56"],
    ]);
    expect(columnAt(found, 2).neverKept).toBe("bank_details");
    expect(columnAt(found, 3).neverKept).toBe("bank_details");
    expect(everythingSaid(found)).not.toContain("12345678");
  });

  it("keeps a gym's twelve-digit member numbers, which pass Aadhaar's check about seven times in a hundred", () => {
    const found = read([
      ["Name", "Email", "Member No"],
      ["Ann Lee", "ann@example.com", "100000000001"],
      ["Bo Chen", "bo@example.com", "100000000002"],
      ["Cara Diaz", "cara@example.com", "100000000003"],
    ]);
    expect(columnAt(found, 2).neverKept).toBe(null);
    expect(found.rows.map((row) => row.memberNumber)).toEqual(["100000000001", "100000000002", "100000000003"]);
  });
});

describe("the worst thing — a PIN code is a postcode, in every country that writes one", () => {
  // Kd, 2026-09-22: this must hold for the United States, the United Kingdom,
  // Australia, Canada, New Zealand and India alike, not India alone. The
  // wording is Wikipedia's ("Postal code", read that day) and Gymdesk's own
  // import field, which it writes "Zip/Postal Code".
  it.each([
    ["India", "PIN Code", "560001", "IN"],
    ["India, written as one word", "Pincode", "110001", "IN"],
    ["the United States", "ZIP Code", "90210", "US"],
    ["the United States, five plus four", "Zip", "90210-1234", "US"],
    ["Gymdesk's own wording", "Zip/Postal Code", "SW1A 1AA", "GB"],
    ["the United Kingdom", "Postcode", "SW1A 1AA", "GB"],
    ["the United Kingdom, two words", "Post Code", "EC1A 1BB", "GB"],
    ["Canada", "Postal Code", "K1A 0B1", "CA"],
    ["Australia", "Postcode", "3000", "AU"],
    ["New Zealand", "Postcode", "6011", "NZ"],
    ["Ireland", "Eircode", "D02 AF30", "IE"],
  ])("keeps %s (%s)", (_where, heading, cell, country) => {
    const found = read(
      [
        ["Name", "Email", "City", heading],
        ["Ann Lee", "ann@example.com", "Somewhere", cell],
      ],
      { country },
    );
    expect(columnAt(found, 3).neverKept).toBe(null);
    expect(extraOf(found, heading)).toEqual([cell]);
  });

  it("keeps a bare PIN beside an address, because the sheet says it is one", () => {
    const found = read([
      ["Name", "Email", "Address", "City", "PIN"],
      ["Ann Lee", "ann@example.com", "12 MG Road", "Bengaluru", "560001"],
    ]);
    expect(columnAt(found, 4).neverKept).toBe(null);
    expect(extraOf(found, "PIN")).toEqual(["560001"]);
  });

  it("drops a bare PIN where the sheet has no address at all — there it is a door code", () => {
    const found = read([
      ["Name", "Email", "PIN"],
      ["Ann Lee", "ann@example.com", "4821"],
    ]);
    expect(columnAt(found, 2).neverKept).toBe("password_or_pin");
    expect(everythingSaid(found)).not.toContain("4821");
  });

  it("drops a Door PIN even beside a full address, because the heading says what it is", () => {
    const found = read([
      ["Name", "Email", "Address", "PIN Code", "Door PIN"],
      ["Ann Lee", "ann@example.com", "12 MG Road", "560001", "4821"],
    ]);
    expect(columnAt(found, 3).neverKept).toBe(null);
    expect(columnAt(found, 4).neverKept).toBe("password_or_pin");
    expect(everythingSaid(found)).not.toContain("4821");
    expect(extraOf(found, "PIN Code")).toEqual(["560001"]);
  });
});

// ---------------------------------------------------------------------------
// The five fields the record gained
// ---------------------------------------------------------------------------

describe("the wider row", () => {
  // Gymdesk's own headings, and GymMaster's beside them.
  const GYMDESK = [
    ["Full Name", "Email Address", "Phone Number", "Status", "Member Type", "Join Date", "Cancellation Date", "Date of Birth"],
    ["Ann Lee", "ann@example.com", "9876543210", "Active", "Gold", "14/03/2024", "14/03/2026", "02/11/1990"],
    ["Bo Chen", "bo@example.com", "9876543211", "Frozen", "Student 12 months", "01/07/2025", "01/07/2026", "23/06/1998"],
    ["Cara Diaz", "cara@example.com", "9876543212", "Active", "Gold", "30/09/2025", "30/09/2026", "15/01/1985"],
  ];

  it("reads all ten standard fields from a real product's headings", () => {
    const found = read(GYMDESK);
    expect(found.rows.map((row) => row.membershipType)).toEqual(["Gold", "Student 12 months", "Gold"]);
    expect(found.rows.map((row) => row.joinedOn)).toEqual(["2024-03-14", "2025-07-01", "2025-09-30"]);
    expect(found.rows.map((row) => row.endsOn)).toEqual(["2026-03-14", "2026-07-01", "2026-09-30"]);
    expect(found.rows.map((row) => row.dateOfBirth)).toEqual(["1990-11-02", "1998-06-23", "1985-01-15"]);
    expect(found.rows.map((row) => row.status)).toEqual(["Active", "Frozen", "Active"]);
    expect(found.counts.withMembershipType).toBe(3);
    expect(found.counts.withJoinedOn).toBe(3);
    expect(found.counts.withEndsOn).toBe(3);
    expect(found.counts.withDateOfBirth).toBe(3);
  });

  it("says whether the membership ENDS or RENEWS on that day", () => {
    expect(read(GYMDESK).endsOnKind).toBe("ends");
    const renews = read([
      ["Name", "Email", "Next Billing Date"],
      ["Ann Lee", "ann@example.com", "03/10/2026"],
    ]);
    expect(renews.endsOnKind).toBe("renews");
  });

  it("counts the gym's own membership types and payment words as chips, commonest first", () => {
    const found = read([
      ["Name", "Email", "Membership Type", "Payment Status"],
      ["Ann Lee", "ann@example.com", "Gold", "Paid"],
      ["Bo Chen", "bo@example.com", "GOLD", "Overdue"],
      ["Cara Diaz", "cara@example.com", "Silver", "Paid"],
    ]);
    // One word written two ways is one chip, under the way it was written first.
    expect(found.membershipTypes).toEqual([
      { label: "Gold", count: 2 },
      { label: "Silver", count: 1 },
    ]);
    expect(found.paymentStatuses).toEqual([
      { label: "Paid", count: 2 },
      { label: "Overdue", count: 1 },
    ]);
    expect(found.counts.withPaymentStatus).toBe(3);
  });

  it("never reads a payment word as the membership status, nor the other way round", () => {
    const found = read([
      ["Name", "Email", "Membership Status", "Payment Status"],
      ["Ann Lee", "ann@example.com", "Active", "Overdue"],
    ]);
    expect(found.mapping.status).toBe(2);
    expect(found.mapping.paymentStatus).toBe(3);
    expect(found.rows[0]?.status).toBe("Active");
    expect(found.rows[0]?.paymentStatus).toBe("Overdue");
  });

  it("reads a column of yes and no under its own heading, as the status does", () => {
    const found = read([
      ["Name", "Email", "Paid"],
      ["Ann Lee", "ann@example.com", "Yes"],
      ["Bo Chen", "bo@example.com", "No"],
    ]);
    expect(found.rows.map((row) => row.paymentStatus)).toEqual(["Paid", "Not paid"]);
  });

  it("never works a membership type out of a column of dates, nor a price", () => {
    const dates = read([
      ["Name", "Email", "Plan", "Product Price"],
      ["Ann Lee", "ann@example.com", "01/02/2026", "1200"],
      ["Bo Chen", "bo@example.com", "01/03/2026", "1200"],
    ]);
    expect(dates.mapping.membershipType).toBe(null);
    expect(dates.rows.map((row) => row.membershipType)).toEqual([null, null]);
  });

  it("does not take a note column as a membership type, however few rows the file has", () => {
    const rows: string[][] = [["Name", "Email", "Plan"]];
    for (let n = 0; n < 70; n++) rows.push([`Person ${String(n)}`, `p${String(n)}@example.com`, `A one-off arrangement, number ${String(n)}`]);
    const found = read(rows);
    expect(found.mapping.membershipType).toBe(null);
    expect(found.extraFields.map((field) => field.label)).toContain("Plan");
  });
});

describe("the gym's OWN words, whatever they are", () => {
  // Kd, 2026-09-22, asked why a membership type came out "Gold" and what
  // happens when a gym's payment word is not "Overdue". The answer is that the
  // app holds NO list of these words and never has (§9.2 rule 10, §11.1): the
  // cell is kept exactly as the gym typed it. These rows are the proof, and
  // not one of them is a word any list in this repo holds — several are not
  // English at all.
  const rows = [
    ["Full Name", "Email", "Membership Status", "Membership Type", "Payment Status"],
    ["Ann Lee", "ann@example.com", "On hold", "Platinum Elite 24mo", "Awaiting Direct Debit"],
    ["Bo Chen", "bo@example.com", "Lapsed", "Founding Member", "Arrears - 2 months"],
    ["Cara Diaz", "cara@example.com", "Cooling off", "Whanau Family Pass", "Part payment received"],
    ["Dev Patel", "dev@example.com", "Dormant", "Ubuntu Community Rate", "Debit order bounced"],
    ["Eve Nkosi", "eve@example.com", "Probezeit", "Jahreskarte Premium", "Lastschrift offen"],
    ["Fay O'Brien", "fay@example.com", "Notice period", "Laoch Lifetime", "Paid up to March"],
  ];

  it("keeps every membership word exactly as the gym wrote it", () => {
    expect(read(rows).rows.map((row) => row.membershipType)).toEqual([
      "Platinum Elite 24mo",
      "Founding Member",
      "Whanau Family Pass",
      "Ubuntu Community Rate",
      "Jahreskarte Premium",
      "Laoch Lifetime",
    ]);
  });

  it("keeps every payment word exactly as the gym wrote it", () => {
    expect(read(rows).rows.map((row) => row.paymentStatus)).toEqual([
      "Awaiting Direct Debit",
      "Arrears - 2 months",
      "Part payment received",
      "Debit order bounced",
      "Lastschrift offen",
      "Paid up to March",
    ]);
  });

  it("keeps every status word exactly as the gym wrote it", () => {
    expect(read(rows).rows.map((row) => row.status)).toEqual(["On hold", "Lapsed", "Cooling off", "Dormant", "Probezeit", "Notice period"]);
  });

  it("makes each of them a chip with its count, in the gym's own spelling", () => {
    const found = read(rows);
    expect(found.membershipTypes.map((chip) => chip.label)).toContain("Jahreskarte Premium");
    expect(found.paymentStatuses.map((chip) => chip.label)).toContain("Lastschrift offen");
    expect(found.statuses.map((chip) => chip.label)).toContain("Probezeit");
  });

  it("cuts a word longer than a word, rather than refusing the file", () => {
    const long = "Platinum ".repeat(20);
    const found = read([
      ["Name", "Email", "Membership Type"],
      ["Ann Lee", "ann@example.com", long],
    ]);
    expect(found.rows[0]?.membershipType?.length).toBe(MEMBER_LIST_MAX_STATUS_CHARS);
  });
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

describe("dates, settled once for a whole column", () => {
  const withJoinDates = (...cells: string[]): string[][] => [
    ["Name", "Email", "Join Date"],
    ...cells.map((cell, at) => [`Person ${String(at)}`, `p${String(at)}@example.com`, cell]),
  ];

  it("takes the file's own evidence over the gym's country", () => {
    // 25 can only be a day, so the whole column is day-first — even in the
    // United States, whose own order is the other one.
    const found = read(withJoinDates("25/12/2025", "03/04/2026", "11/11/2025"), { country: "US" });
    expect(found.rows.map((row) => row.joinedOn)).toEqual(["2025-12-25", "2026-04-03", "2025-11-11"]);
    expect(found.dateColumns[0]?.order).toBe("dayFirst");
    expect(found.dateColumns[0]?.from).toBe("file");
  });

  it("falls back to the gym's country where nothing in the file settles it", () => {
    const india = read(withJoinDates("03/04/2026", "05/06/2026"), { country: "IN" });
    expect(india.rows.map((row) => row.joinedOn)).toEqual(["2026-04-03", "2026-06-05"]);
    expect(india.dateColumns[0]?.from).toBe("country");

    const america = read(withJoinDates("03/04/2026", "05/06/2026"), { country: "US" });
    expect(america.rows.map((row) => row.joinedOn)).toEqual(["2026-03-04", "2026-05-06"]);
    expect(america.dateColumns[0]?.order).toBe("monthFirst");
  });

  it("falls back to the country where the file contradicts itself, because two rows cannot both be right", () => {
    const found = read(withJoinDates("25/12/2025", "12/25/2025", "03/04/2026"), { country: "IN" });
    expect(found.dateColumns[0]?.from).toBe("country");
    expect(found.dateColumns[0]?.order).toBe("dayFirst");
  });

  it("says the reading back with a real cell of the column", () => {
    const found = read(withJoinDates("25/12/2025", "03/04/2026"), { country: "IN" });
    expect(found.dateColumns[0]?.example).toEqual({ raw: "03/04/2026", read: "2026-04-03" });
  });

  it("lets staff flip a column, and then reads every cell that way", () => {
    const found = read(withJoinDates("03/04/2026", "05/06/2026"), {
      country: "IN",
      mapping: mappingOf({ headerRow: 0, fullName: 0, email: [1], joinedOn: 2, dateOrder: [{ column: 2, order: "monthFirst" }] }),
    });
    expect(found.rows.map((row) => row.joinedOn)).toEqual(["2026-03-04", "2026-05-06"]);
    expect(found.dateColumns[0]?.from).toBe("chosen");
  });

  it.each([
    ["an ISO day, whatever the column was settled as", "2026-04-03", "2026-04-03"],
    ["an ISO day with a time on it", "2026-04-03T00:00:00Z", "2026-04-03"],
    ["a year first with slashes", "2026/04/03", "2026-04-03"],
    ["a month written out after the day", "3 Apr 2026", "2026-04-03"],
    ["a month written out before it", "April 3, 2026", "2026-04-03"],
    ["a month written out with dashes", "3-Apr-2026", "2026-04-03"],
    ["Sept, which is not the first three letters", "3 Sept 2026", "2026-09-03"],
    ["a two-digit year in this century", "03/04/26", "2026-04-03"],
    ["a two-digit year in the last one", "03/04/98", "1998-04-03"],
  ])("reads %s", (_what, cell, day) => {
    expect(read(withJoinDates(cell)).rows[0]?.joinedOn).toBe(day);
  });

  it("leaves a cell that is no date empty and counts it, rather than guessing", () => {
    // Four of the six read, which is what makes it a date column at all; the
    // other two are a word and a day February has never had.
    const found = read(withJoinDates("25/12/2025", "not known", "31/02/2026", "03/04/2026", "01/05/2026", "02/06/2026"));
    expect(found.rows.map((row) => row.joinedOn)).toEqual(["2025-12-25", null, null, "2026-04-03", "2026-05-01", "2026-06-02"]);
    expect(found.dateColumns[0]?.notRead).toBe(2);
    expect(found.warnings).toContainEqual({ code: "dates_not_read", rows: 2 });
  });

  it("reads each date column its own way round, not the file's", () => {
    const found = read([
      ["Name", "Email", "Join Date", "Date of Birth"],
      ["Ann Lee", "ann@example.com", "25/12/2025", "11/30/1990"],
      ["Bo Chen", "bo@example.com", "03/04/2026", "05/06/1991"],
    ]);
    expect(found.rows.map((row) => row.joinedOn)).toEqual(["2025-12-25", "2026-04-03"]);
    expect(found.rows.map((row) => row.dateOfBirth)).toEqual(["1990-11-30", "1991-05-06"]);
    expect(found.dateColumns.map((date) => [date.field, date.order])).toEqual([
      ["joinedOn", "dayFirst"],
      ["dateOfBirth", "monthFirst"],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The gym's own columns
// ---------------------------------------------------------------------------

describe("the gym's own columns", () => {
  it("keeps every other column, under the gym's own heading, including words no list holds", () => {
    const found = read([
      ["Name", "Email", "Belt", "Batch", "Locker No", "Referred By", "Gotra"],
      ["Ann Lee", "ann@example.com", "Blue", "Morning 6am", "L-14", "Bo Chen", "Kashyap"],
    ]);
    expect(found.extraFields.map((field) => [field.key, field.label, field.column])).toEqual([
      ["belt", "Belt", 2],
      ["batch", "Batch", 3],
      ["locker_no", "Locker No", 4],
      ["referred_by", "Referred By", 5],
      ["gotra", "Gotra", 6],
    ]);
    expect(found.rows[0]?.extra).toEqual(["Blue", "Morning 6am", "L-14", "Bo Chen", "Kashyap"]);
  });

  it("gives a column with no heading a key of its own place, and one repeated heading a number", () => {
    const found = read([
      ["Name", "Email", "", "Belt", "Belt"],
      ["Ann Lee", "ann@example.com", "x", "Blue", "Brown"],
    ]);
    expect(found.extraFields.map((field) => field.key)).toEqual(["column_3", "belt", "belt_2"]);
  });

  it("leaves out a column that is empty on every row", () => {
    const found = read([
      ["Name", "Email", "Belt", "Nothing Here"],
      ["Ann Lee", "ann@example.com", "Blue", ""],
    ]);
    expect(found.extraFields.map((field) => field.label)).toEqual(["Belt"]);
  });

  it("leaves out a column staff ticked don't keep", () => {
    const found = read(
      [
        ["Name", "Email", "Belt", "Batch"],
        ["Ann Lee", "ann@example.com", "Blue", "Morning 6am"],
      ],
      { mapping: mappingOf({ headerRow: 0, fullName: 0, email: [1], dontKeep: [2] }) },
    );
    expect(found.extraFields.map((field) => field.label)).toEqual(["Batch"]);
    expect(found.rows[0]?.extra).toEqual(["Morning 6am"]);
  });

  it("cuts a very long cell and says how many it cut", () => {
    const long = "a".repeat(MEMBER_LIST_MAX_EXTRA_CHARS + 50);
    const found = read([
      ["Name", "Email", "Notes"],
      ["Ann Lee", "ann@example.com", long],
    ]);
    expect(found.rows[0]?.extra[0]?.length).toBe(MEMBER_LIST_MAX_EXTRA_CHARS);
    expect(found.warnings).toContainEqual({ code: "cells_cut", rows: 1 });
  });

  it("keeps at most forty, and says how many it left out", () => {
    const headings = ["Name", "Email"];
    const person = ["Ann Lee", "ann@example.com"];
    for (let n = 0; n < MEMBER_LIST_MAX_EXTRA_FIELDS + 5; n++) {
      headings.push(`Own ${String(n)}`);
      person.push(`value ${String(n)}`);
    }
    const found = read([headings, person]);
    expect(found.extraFields).toHaveLength(MEMBER_LIST_MAX_EXTRA_FIELDS);
    expect(found.rows[0]?.extra).toHaveLength(MEMBER_LIST_MAX_EXTRA_FIELDS);
    expect(found.warnings).toContainEqual({ code: "extra_columns_left_out", columns: 5 });
  });

  it("never keeps a standard field twice as one of the gym's own", () => {
    const found = read([
      ["Full Name", "Email", "Status", "Belt"],
      ["Ann Lee", "ann@example.com", "Active", "Blue"],
    ]);
    expect(found.extraFields.map((field) => field.label)).toEqual(["Belt"]);
  });

  it("does not change who is the same person", () => {
    // The identity key is the four things it always was (§9.5), so a gym's own
    // columns changing cannot turn one member into a new one.
    const withOwn = read([
      ["Name", "Email", "Belt"],
      ["Ann Lee", "ann@example.com", "Blue"],
    ]);
    const without = read([
      ["Name", "Email"],
      ["Ann Lee", "ann@example.com"],
    ]);
    expect(withOwn.rows[0]?.identityKey).toBe(without.rows[0]?.identityKey);
  });
});
