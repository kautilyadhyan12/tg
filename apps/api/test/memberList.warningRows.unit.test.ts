// Each Review warning names its rows (ROADMAP 5b-v-d-iii; Kd at 5b-v-d-ii's
// click-through: "asking to check but no option to check or correct or see what
// is even wrong").
//
// The worst thing this could do is quote a payment card number on the screen: a
// warning now says what a cell held, and §11.2 never keeps a card. The cards
// below are the published test numbers from Stripe's docs (stripe.com/docs/testing),
// not the ones `neverKeep.ts` was written against, and they are typed the ways a
// person types them. Every person here is invented.
import { describe, expect, it } from "vitest";
import {
  MEMBER_LIST_WARNING_ROWS_SHOWN,
  type MemberFileGrid,
  type MemberListUnderstanding,
  type MemberListWarning,
  type MemberListWarningRow,
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

const at = (row: number, name: string, column: string | null = null, cell: string | null = null, sameAsRow: number | null = null): MemberListWarningRow => ({ row, name, column, cell, sameAsRow });

const rowsOf = (found: MemberListUnderstanding, code: MemberListWarning["code"]): MemberListWarningRow[] => {
  const warning = found.warnings.find((w) => w.code === code);
  return warning !== undefined && "where" in warning ? warning.where : [];
};

/** A card number's last digit, by Luhn's rule, so a card from a range nobody here listed is a real one. */
const withCheckDigit = (body: string): string => {
  for (let d = 0; d <= 9; d++) {
    const digits = `${body}${String(d)}`;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      const n = Number(digits[digits.length - 1 - i]);
      const doubled = i % 2 === 1 ? n * 2 : n;
      sum += doubled > 9 ? doubled - 9 : doubled;
    }
    if (sum % 10 === 0) return digits;
  }
  throw new Error("no check digit");
};
/** Mir (Russia, 2200–2204) and Troy (Turkey, 9792): real card ranges `neverKeep.ts` does not list. */
const MIR = withCheckDigit("220070012345600");
const TROY = withCheckDigit("979212345678900");
const spaced = (digits: string, sizes: number[], sep: string): string => {
  const parts: string[] = [];
  let at = 0;
  for (const size of sizes) {
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  return parts.join(sep);
};

/** Round one of 5b-v-d-iii, High 1: cards written the ways the storage rules do not read,
 *  each of which was quoted on the Review. */
const ODDLY_TYPED: [string, string][] = [
  ["4242424242424242", "4242 4242-4242 4242"],
  ["4242424242424242", "(4242) 4242 4242 4242"],
  ["4242424242424242", "4242_4242_4242_4242"],
  ["4242424242424242", "4242*4242*4242*4242"],
  ["4242424242424242", "4242 · 4242 · 4242 · 4242"],
  ["4242424242424242", "4242:4242:4242:4242"],
  ["4242424242424242", "4242.4242.4242.4242"],
  ["4242424242424242", "42424 24242 424242"],
  ["4242424242424242", "42 42 42 42 42 42 42 42"],
  ["5555555555554444", "5555 / 5555 / 5555 / 4444"],
  // A number written just before it, so the card is not where the digits start.
  ["4242424242424242", "room 7: 4242_4242_4242_4242"],
  [MIR, spaced(MIR, [4, 4, 4, 4], " ")],
  [TROY, spaced(TROY, [4, 4, 4, 4], "-")],
];

/** Stripe's test cards: Visa, Mastercard, Amex, Discover, Diners, JCB, UnionPay. */
const STRIPE_CARDS = ["4242424242424242", "5555555555554444", "378282246310005", "6011111111111117", "3056930009020004", "3566002020360505", "6200000000000005"];
/** …written as people write them: in fours with spaces, with dashes, and Amex's 4-6-5. */
const AS_TYPED = ["4242 4242 4242 4242", "5555-5555-5555-4444", "3782 822463 10005", "6011 1111 1111 1117", "3056-9300-0902-0004", "3566 0020 2036 0505", "6200 0000 0000 0005"];

describe("the worst thing — a card number quoted in a warning", () => {
  it("never quotes a card, whole or inside other words, in any column a warning points at", () => {
    const rows: string[][] = [["Name", "Email", "Mobile", "Joined", "Notes"]];
    const ok = (i: number): string[] => [`Ok Person ${String(i)}`, `ok${String(i)}@example.com`, `98765400${String(10 + i)}`, "2024-01-05", "Prefers mornings"];
    for (let i = 0; i < 20; i++) rows.push(ok(i));
    AS_TYPED.forEach((card, i) => {
      // A card as the whole of a date cell, a card inside a date cell's words, a card at
      // the start of a note long enough to be cut, and a card as the whole phone cell.
      rows.push([`Date Card ${String(i)}`, `d${String(i)}@example.com`, `98765411${String(10 + i)}`, card, "x"]);
      rows.push([`Date Words ${String(i)}`, `w${String(i)}@example.com`, `98765422${String(10 + i)}`, `paid by ${card}`, "x"]);
      rows.push([`Long Note ${String(i)}`, `n${String(i)}@example.com`, `98765433${String(10 + i)}`, "2024-01-05", `Card ${card} on file. ${"z".repeat(600)}`]);
      rows.push([`Phone Card ${String(i)}`, `p${String(i)}@example.com`, card, "2024-01-05", "x"]);
    });
    rows.push(["Odd Card", "odd@example.com", "9876549999", "1234 5678 1234 5670", "x"]);
    // With no country, every phone without its own code is quoted, so the card in
    // the phone column is asked about too.
    for (const country of ["IN", null]) {
      const found = read(rows, { country });
      // Each quoted cell's digits, whatever sat between them, never hold a card.
      const quoted = found.warnings.flatMap((w) => ("where" in w ? w.where.map((r) => r.cell ?? "") : []));
      for (const cell of quoted) {
        const digits = cell.replace(/[^0-9]/g, "");
        for (const card of STRIPE_CARDS) expect({ cell, has: digits.includes(card) }).toEqual({ cell, has: false });
      }
      // A number shaped like a card with no card company's first digits is dropped from a
      // cell all the same (§11.2), so it is not quoted either.
      const oddCard = rowsOf(found, "dates_not_read").find((w) => w.name === "Odd Card");
      expect(oddCard).toEqual(at(rows.length, "Odd Card", "Joined", null));
      // And the rows were still found: the date cells are not dates, and the notes were cut.
      expect(rowsOf(found, "dates_not_read").map((w) => w.row)).toHaveLength(AS_TYPED.length * 2 + 1);
      expect(rowsOf(found, "cells_cut").map((w) => w.row)).toHaveLength(AS_TYPED.length);
    }
  });

  it("never quotes a card however it is written, in a date cell or a phone cell, whole or inside words", () => {
    // Enough real dates that Joined stays a date column, so each odd cell is quoted as a date.
    const rows: string[][] = [["Name", "Email", "Mobile", "Joined"]];
    for (let i = 0; i < 200; i++) rows.push([`Ok Person ${String(i)}`, `ok${String(i)}@example.com`, `9876${String(500000 + i)}`, "2024-01-05"]);
    ODDLY_TYPED.forEach(([, typed], i) => {
      rows.push([`Date Whole ${String(i)}`, `dw${String(i)}@example.com`, `98765411${String(10 + i)}`, typed]);
      rows.push([`Date Words ${String(i)}`, `dd${String(i)}@example.com`, `98765422${String(10 + i)}`, `paid by ${typed} today`]);
      rows.push([`Phone Words ${String(i)}`, `pw${String(i)}@example.com`, `card ${typed}`, "2024-01-05"]);
    });
    for (const country of ["IN", null]) {
      const found = read(rows, { country });
      // Every odd date cell was quoted (or, a whole card, named by its column alone).
      expect(rowsOf(found, "dates_not_read").map((w) => w.name).sort()).toEqual(
        ODDLY_TYPED.flatMap((_, i) => [`Date Whole ${String(i)}`, `Date Words ${String(i)}`]).sort(),
      );
      const quoted = found.warnings.flatMap((w) => ("where" in w ? w.where.map((r) => r.cell ?? "") : []));
      for (const cell of quoted) {
        const digits = cell.replace(/[^0-9]/g, "");
        for (const [card] of ODDLY_TYPED) expect({ cell, has: digits.includes(card) }).toEqual({ cell, has: false });
      }
    }
  });

  it("counts a card in the name like any other card, by the name's column", () => {
    const found = read([
      ["Name", "Email"],
      ["4242 4242 4242 4242", "one@example.com"],
      ["Ann 5555555555554444", "ann@example.com"],
      ["Bo Chen", "bo@example.com"],
    ]);
    expect(rowsOf(found, "card_cells_dropped").map((w) => [w.row, w.column, w.cell])).toEqual([
      [2, "Name", null],
      [3, "Name", null],
    ]);
  });

  it("a whole card in a date column is listed as a card too, so staff are told to delete it", () => {
    const found = read([
      ["Name", "Email", "Joined"],
      ["Ann Lee", "ann@example.com", "2024-01-05"],
      ["Bo Chen", "bo@example.com", "4242 4242 4242 4242"],
      ["Cy Shah", "cy@example.com", "2024-01-07"],
      ["Di Park", "di@example.com", "2024-01-08"],
    ]);
    expect(rowsOf(found, "card_cells_dropped")).toEqual([at(3, "Bo Chen", "Joined")]);
    expect(rowsOf(found, "dates_not_read")).toEqual([at(3, "Bo Chen", "Joined", null)]);
  });

  it("names the row and column of a card it dropped, and never the card", () => {
    const found = read([
      ["Name", "Email", "Member No", "Notes"],
      ["Ann Lee", "ann@example.com", "M1", "Prefers mornings"],
      ["Bo Chen", "bo@example.com", "M2", "4242 4242 4242 4242"],
      ["Cara Diaz", "cara@example.com", "5555555555554444", "Pays at the desk"],
      ["Dev Rao", "dev@example.com", "M4", "Visa 3782 822463 10005, expires soon"],
      ["Eve Nair", "eve@example.com", "M5", "Evening classes"],
    ]);
    expect(rowsOf(found, "card_cells_dropped")).toEqual([at(3, "Bo Chen", "Notes"), at(4, "Cara Diaz", "Member No"), at(5, "Dev Rao", "Notes")]);
    expect(found.warnings).toContainEqual(expect.objectContaining({ code: "card_cells_dropped", rows: 3 }));
  });
});

describe("each warning names exactly its own rows", () => {
  // One problem on each row from 3 to 11, clean people around them, and a row that
  // is skipped (no email, no phone), which no warning names.
  const people: string[][] = [
    ["Name", "Email", "Mobile", "Joined", "Notes"],
    ["Ann Lee", "ann@example.com", "9876543210", "2024-01-05", "Prefers mornings"],
    ["?ukasz Nowak", "lukasz@example.com", "9876543211", "2024-01-06", ""],
    [`H${String.fromCodePoint(0x201a)}l${String.fromCodePoint(0x160)}ne Dupont`, "helene@example.com", "9876543212", "2024-01-07", ""],
    ["Cy Shah", "cy@example.com", "9.19877E+11", "2024-01-08", ""],
    ["Di Park", "di@example.com", "00000000000", "2024-01-09", ""],
    ["Ed Moss", "ed@example.com", "9876543215", "sometime in March", ""],
    ["Flo Kerr", "flo@example.com", "9876543216", "2024-01-11", "n".repeat(700)],
    ["Gus Tan", "family@example.com", "9876543217", "2024-01-12", ""],
    ["Hana Tan", "FAMILY@example.com", "9876543218", "2024-01-13", ""],
    ["Ivy Cole", "", "", "2024-01-14", "walk-in"],
    ["Jon Bell", "jon@example.com", "9876543220", "2024-01-15", ""],
  ];

  it("lists each row under its own warning, with the cell as the file wrote it", () => {
    const found = read(people);
    expect(rowsOf(found, "question_marks_in_names")).toEqual([at(3, "?ukasz Nowak")]);
    expect(rowsOf(found, "garbled_names").map((w) => w.row)).toEqual([4]);
    expect(rowsOf(found, "shortened_by_excel")).toEqual([at(5, "Cy Shah", "Mobile", "9.19877E+11")]);
    expect(rowsOf(found, "phones_unusual")).toEqual([at(6, "Di Park", "Mobile", "00000000000")]);
    expect(rowsOf(found, "dates_not_read")).toEqual([at(7, "Ed Moss", "Joined", "sometime in March")]);
    expect(rowsOf(found, "cells_cut").map((w) => [w.row, w.column])).toEqual([[8, "Notes"]]);
    // The two sharing an address each name the other.
    expect(rowsOf(found, "shared_emails")).toEqual([at(9, "Gus Tan", null, "family@example.com", 10), at(10, "Hana Tan", null, "family@example.com", 9)]);
    // Ivy is skipped, and says so there; Ann and Jon are named nowhere.
    const named = found.warnings.flatMap((w) => ("where" in w ? w.where.map((r) => r.row) : []));
    for (const clean of [2, 11, 12]) expect(named).not.toContain(clean);
    // Every count is the number of rows it names.
    for (const warning of found.warnings) if ("where" in warning) expect(warning.where).toHaveLength(warning.rows);
  });

  it("names the phones it left out for want of a country, and not the ones it read", () => {
    const found = read(
      [
        ["Name", "Email", "Phone"],
        ["Ann Lee", "ann@example.com", "+44 7911 123456"],
        ["Bo Chen", "bo@example.com", "07911 123457"],
        ["Cy Shah", "cy@example.com", "+91 98765 43210"],
        ["Di Park", "di@example.com", "(415) 555-0100"],
      ],
      { country: null },
    );
    expect(rowsOf(found, "phones_need_country")).toEqual([at(3, "Bo Chen", "Phone", "07911 123457"), at(5, "Di Park", "Phone", "(415) 555-0100")]);
  });

  it("a row that lost both its email and its phone to the front desk's details names both", () => {
    const rows: string[][] = [["Name", "Email", "Mobile"]];
    for (let i = 0; i < 6; i++) rows.push([`Desk ${String(i)}`, "desk@gym.example", "9999999999"]);
    rows.push(["Ann Lee", "ann@example.com", "9876543210"]);
    const where = rowsOf(read(rows), "placeholders");
    expect(where).toHaveLength(6);
    expect(where[0]).toEqual(at(2, "Desk 0", null, "desk@gym.example and +919999999999"));
  });

  it("with three on one address, each names another of them", () => {
    const found = read([
      ["Name", "Email"],
      ["Ann Lee", "home@example.com"],
      ["Bo Lee", "home@example.com"],
      ["Cy Lee", "home@example.com"],
    ]);
    expect(rowsOf(found, "shared_emails").map((w) => [w.row, w.sameAsRow])).toEqual([
      [2, 3],
      [3, 2],
      [4, 2],
    ]);
  });

  it("a column with no heading is called by its place, as the screen calls it", () => {
    const found = read(
      [
        ["Ann Lee", "ann@example.com", "9876543210"],
        ["Bo Chen", "bo@example.com", "00000000000"],
        ["Cy Shah", "cy@example.com", "9876543212"],
      ],
      {},
    );
    // No heading says which column is the name, so none was read: the row alone finds it.
    expect(found.headerRow).toBe(null);
    expect(rowsOf(found, "phones_unusual")).toEqual([at(2, "", "Column 3", "00000000000")]);
  });

  it("counts every row but lists the first hundred", () => {
    const rows: string[][] = [["Name", "Email", "Mobile"]];
    for (let i = 0; i < 150; i++) rows.push([`Person ${String(i)}`, `p${String(i)}@example.com`, "00000000000"]);
    // They are all the same number, so it is the front desk's and dropped — use
    // a different unusual number on each row instead.
    for (let i = 0; i < 150; i++) {
      const row = rows[i + 1];
      if (row !== undefined) row[2] = `0000000${String(1000 + i)}`;
    }
    const found = read(rows);
    const warning = found.warnings.find((w) => w.code === "phones_unusual");
    expect(warning).toMatchObject({ code: "phones_unusual", rows: 150 });
    const where = rowsOf(found, "phones_unusual");
    expect(where).toHaveLength(MEMBER_LIST_WARNING_ROWS_SHOWN);
    expect(where[0]?.row).toBe(2);
    expect(where.at(-1)?.row).toBe(MEMBER_LIST_WARNING_ROWS_SHOWN + 1);
  });
});
