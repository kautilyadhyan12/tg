import { describe, expect, it } from "vitest";
import {
  isLargeMemberListChange,
  MEMBER_LIST_CONFIRM_REFUSAL_WORDS,
  MEMBER_LIST_FIELD_WORDS,
  MEMBER_LIST_MAX_EDITED_FIELDS,
  MEMBER_LIST_MAX_EXTRA_CHARS,
  MEMBER_LIST_MAX_EXTRA_FIELDS,
  MEMBER_LIST_MAX_FIELD_KEY_CHARS,
  MEMBER_LIST_STATUS_CHIPS_MAX,
  memberListChangeCountsSchema,
  memberListEditedFieldSchema,
  memberListExtraChangeSchema,
  memberListExtraDocumentSchema,
  memberListFieldChangeSchema,
  memberListFieldSchema,
  memberListHandEditsSchema,
  memberListRecordsSchema,
  memberListConfirmRequestSchema,
  memberListConfirmedSchema,
  memberListViewSchema,
  memberListStatusCountSchema,
  memberListEntriesQuerySchema,
  memberListEntriesPageSchema,
  memberListEntrySchema,
  MEMBER_LIST_ENTRIES_PAGE,
  MEMBER_LIST_QUERY_MAX_CHARS,
  MEMBER_LIST_STATUS_FILTERS_MAX,
  MEMBER_LIST_MAX_STATUS_CHARS,
  MEMBER_LIST_MAX_STATUS_WORDS,
  MEMBER_FILE_MAX_BASE64_CHARS,
  MEMBER_LIST_UPLOAD_GONE_WORDS,
  memberListModeSchema,
  memberListRowsQuerySchema,
  memberListUploadGoneSchema,
  memberListUploadRequestSchema,
  MEMBER_FILE_MAX_BYTES,
  MEMBER_FILE_MAX_COLUMNS,
  MEMBER_LIST_SKIP_WORDS,
  memberListMappingSchema,
  memberListSkipReasonSchema,
  memberListUnderstandResultSchema,
  memberListWarningSchema,
  memberListWarningWords,
  type MemberListWarning,
  memberFileOtherZipSchema,
  memberFileRefusalSchema,
  memberFileRefusalWords,
  memberFileResultSchema,
  type MemberFileRefusal,
  MEMBER_LIST_BY_HAND_WORDS,
  memberListCardTypedWords,
  memberListEntryDetailSchema,
  memberListEntryInputSchema,
  memberListEntryPatchSchema,
  memberListEntryWrittenSchema,
  memberListMergeRequestSchema,
  memberListRemoveUnlistedRequestSchema,
  memberListRemovedSchema,
  memberListUnlistedPageSchema,
  memberListUnlistedQuerySchema,
} from "../src/memberList.js";

/** Every refusal the schema allows, each variant once. */
function everyRefusal(): MemberFileRefusal[] {
  const out: MemberFileRefusal[] = [];
  for (const option of memberFileRefusalSchema.options) {
    const code = option.shape.code;
    if ("options" in code) for (const c of code.options) out.push({ code: c });
    else if (code.value === "other_zip") for (const archive of memberFileOtherZipSchema.options) out.push({ code: "other_zip", archive });
    else if (code.value === "mapped_column_not_status") out.push({ code: "mapped_column_not_status", column: 3 });
    else out.push({ code: "unterminated_quote", row: 7 });
  }
  return out;
}

describe("member file refusals", () => {
  it("give every refusal its own words, each ending in what to do", () => {
    const all = everyRefusal();
    expect(all.length).toBe(21); // 15 plain codes, 4 kinds of other zip, 1 open quote, 1 mapped column
    const words = all.map((r) => memberFileRefusalWords(r));
    for (const w of words) {
      expect(w.length).toBeGreaterThan(20);
      expect(w.endsWith(".")).toBe(true);
    }
    expect(new Set(words).size).toBe(all.length);
  });

  it("never speak of the file's name, which the server never sees", () => {
    // Review of PR #85: "named like an Excel file" was said of a members.htm too.
    for (const w of everyRefusal().map((r) => memberFileRefusalWords(r))) {
      expect(w).not.toMatch(/\bnamed?\b|file name|extension/i);
    }
  });

  it("name the row of a quote left open, and the program for a zip that is not Excel", () => {
    expect(memberFileRefusalWords({ code: "unterminated_quote", row: 42 })).toMatch(/^Row 42 /);
    expect(memberFileRefusalWords({ code: "other_zip", archive: "numbers" })).toContain("Numbers");
    expect(memberFileRefusalWords({ code: "other_zip", archive: "opendocument" })).toContain("LibreOffice");
    expect(memberFileRefusalWords({ code: "web_page_or_xml" })).toContain("Save As");
  });

  it("say the size limit the server applies", () => {
    expect(MEMBER_FILE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(memberFileRefusalWords({ code: "too_big" })).toContain("over 5 MB");
  });
});

describe("the shape a file opens into", () => {
  const grid = {
    ok: true,
    kind: "csv",
    sheets: [{ name: null, rows: [["Email"], ["a@example.com"]], truncated: { rows: false, columns: false } }],
    facts: { encoding: "utf-8", delimiter: "," },
    warnings: [],
  };

  it("accepts a grid and a refusal", () => {
    expect(memberFileResultSchema.safeParse(grid).success).toBe(true);
    expect(memberFileResultSchema.safeParse({ ok: false, refusal: { code: "busy" } }).success).toBe(true);
  });

  it.each([
    ["a zip refusal with no kind of zip", { ok: false, refusal: { code: "other_zip" } }],
    ["a quote refusal with no row", { ok: false, refusal: { code: "unterminated_quote" } }],
    ["a quote refusal at row 0", { ok: false, refusal: { code: "unterminated_quote", row: 0 } }],
    ["a code nobody sends", { ok: false, refusal: { code: "nope" } }],
    ["a two-character delimiter", { ...grid, facts: { delimiter: ";;" } }],
    ["an encoding the ladder never names", { ...grid, facts: { encoding: "ibm850" } }],
    ["a cell that is not text", { ...grid, sheets: [{ name: null, rows: [[1]], truncated: { rows: false, columns: false } }] }],
    ["a grid claiming to be refused", { ...grid, ok: false }],
    ["an unknown warning", { ...grid, warnings: ["looks_odd"] }],
  ])("refuses %s", (_label, value) => {
    expect(memberFileResultSchema.safeParse(value).success).toBe(false);
  });
});

describe("what the server says it understood (3a-ii)", () => {
  const mapping = memberListMappingSchema.parse({ headerRow: 0, email: [2], phone: [3] });

  it("fills in what a mapping leaves out, so nothing is ever undefined", () => {
    expect(mapping).toEqual({
      sheet: null,
      headerRow: 0,
      fullName: null,
      firstName: null,
      lastName: null,
      email: [2],
      phone: [3],
      memberNumber: null,
      status: null,
      // The five fields and the two choices Part 2 added (§11.1, §11.3).
      membershipType: null,
      joinedOn: null,
      endsOn: null,
      paymentStatus: null,
      dateOfBirth: null,
      dontKeep: [],
      dateOrder: [],
    });
  });

  it.each([
    ["no heading row at all, which is a real answer", { headerRow: null }],
    [
      "a mapping of every field",
      {
        headerRow: 1,
        sheet: 2,
        fullName: 0,
        firstName: 1,
        lastName: 2,
        email: [3, 4],
        phone: [5],
        memberNumber: 6,
        status: 7,
        membershipType: 8,
        joinedOn: 9,
        endsOn: 10,
        paymentStatus: 11,
        dateOfBirth: 12,
        dontKeep: [13, 14],
        dateOrder: [{ column: 9, order: "monthFirst" }],
      },
    ],
  ])("takes %s", (_label, sent) => {
    expect(memberListMappingSchema.safeParse(sent).success).toBe(true);
  });

  it.each([
    ["a mapping with no heading row given at all", { email: [1] }],
    ["a column past the widest sheet", { headerRow: 0, email: [MEMBER_FILE_MAX_COLUMNS] }],
    ["a column before the first", { headerRow: 0, email: [-1] }],
    ["more email columns than a person has", { headerRow: 0, email: [0, 1, 2, 3, 4, 5] }],
    ["a field nobody sends", { headerRow: 0, nickname: 1 }],
    ["a column that is not a whole number", { headerRow: 0, status: 1.5 }],
  ])("refuses %s", (_label, sent) => {
    expect(memberListMappingSchema.safeParse(sent).success).toBe(false);
  });

  const understanding = {
    ok: true,
    kind: "csv",
    facts: { encoding: "utf-8", delimiter: "," },
    sheet: { index: 0, name: null },
    headerRow: 0,
    headerFingerprint: "a".repeat(64),
    columns: [
      { index: 0, header: "Email", samples: ["ann@example.com"], guess: "email", confidence: "header", headerSays: "email", neverKept: null },
      { index: 1, header: "Medical Conditions", samples: [], guess: null, confidence: null, headerSays: null, neverKept: "medical" },
    ],
    mapping,
    needsMapping: false,
    rows: [
      {
        row: 2,
        fullName: "Ann Lee",
        email: "ann@example.com",
        phone: "+919876543210",
        memberNumber: "000123",
        status: "Active",
        membershipType: "Gold",
        joinedOn: "2024-03-14",
        endsOn: "2026-03-14",
        paymentStatus: "Paid",
        dateOfBirth: "1990-11-02",
        extra: ["Blue"],
        identityKey: "b".repeat(64),
      },
    ],
    extraFields: [{ key: "belt", label: "Belt", column: 4 }],
    dateColumns: [{ column: 5, field: "joinedOn", order: "dayFirst", from: "file", example: { raw: "03/04/2026", read: "2026-04-03" }, notRead: 0 }],
    endsOnKind: "ends",
    counts: {
      dataRows: 1,
      kept: 1,
      noContact: 0,
      duplicates: 0,
      withEmail: 1,
      withPhone: 1,
      withMemberNumber: 1,
      withStatus: 1,
      withMembershipType: 1,
      withJoinedOn: 1,
      withEndsOn: 1,
      withPaymentStatus: 1,
      withDateOfBirth: 1,
    },
    statuses: [{ label: "Active", count: 1 }],
    membershipTypes: [{ label: "Gold", count: 1 }],
    paymentStatuses: [{ label: "Paid", count: 1 }],
    skipped: [{ row: 3, reason: "no_contact" }],
    warnings: [{ code: "no_header_row" }],
  };

  it("takes a whole answer, and the same refusals as opening a file", () => {
    expect(memberListUnderstandResultSchema.safeParse(understanding).success).toBe(true);
    expect(memberListUnderstandResultSchema.safeParse({ ok: false, refusal: { code: "too_many_rows" } }).success).toBe(true);
  });

  it.each([
    ["a phone that is not E.164", { ...understanding, rows: [{ ...understanding.rows[0], phone: "9876543210" }] }],
    ["an identity key that is not a hash", { ...understanding, rows: [{ ...understanding.rows[0], identityKey: "not a hash" }] }],
    ["a row number of 0", { ...understanding, rows: [{ ...understanding.rows[0], row: 0 }] }],
    ["a status word nobody could have written", { ...understanding, statuses: [{ label: "Active", count: 0 }] }],
    ["a reason nobody sends", { ...understanding, skipped: [{ row: 3, reason: "felt like it" }] }],
    ["a warning nobody sends", { ...understanding, warnings: [{ code: "looks_odd" }] }],
    ["a counted warning with no count", { ...understanding, warnings: [{ code: "phones_unusual" }] }],
    ["four samples of one column", { ...understanding, columns: [{ ...understanding.columns[0], samples: ["a", "b", "c", "d"] }] }],
    // Part 2's own shapes (§11.1, §11.3).
    ["a joining date that is not a plain day", { ...understanding, rows: [{ ...understanding.rows[0], joinedOn: "14/03/2024" }] }],
    ["a date of birth carrying a time", { ...understanding, rows: [{ ...understanding.rows[0], dateOfBirth: "1990-11-02T00:00:00Z" }] }],
    ["an extra field key with a capital in it", { ...understanding, extraFields: [{ key: "Belt", label: "Belt", column: 4 }] }],
    ["an extra field key with a space in it", { ...understanding, extraFields: [{ key: "locker no", label: "Locker No", column: 4 }] }],
    ["a reason for not keeping a column that nobody sends", { ...understanding, columns: [{ ...understanding.columns[0], neverKept: "felt like it" }] }],
    ["a date column read in an order nobody sends", { ...understanding, dateColumns: [{ ...understanding.dateColumns[0], order: "yearFirst" }] }],
    ["a date column whose example is no day", { ...understanding, dateColumns: [{ ...understanding.dateColumns[0], example: { raw: "x", read: "x" } }] }],
    ["an end column that neither ends nor renews", { ...understanding, endsOnKind: "stops" }],
    ["a membership type nobody carries", { ...understanding, membershipTypes: [{ label: "Gold", count: 0 }] }],
  ])("refuses %s", (_label, value) => {
    expect(memberListUnderstandResultSchema.safeParse(value).success).toBe(false);
  });
});

describe("the words a warning is shown with", () => {
  const every: MemberListWarning[] = [
    { code: "hidden_rows_or_columns" },
    { code: "encoding_guessed" },
    { code: "no_header_row" },
    { code: "question_marks_in_names", rows: 1 },
    { code: "garbled_names", rows: 2 },
    { code: "shortened_by_excel", rows: 3 },
    { code: "phones_need_country", rows: 1 },
    { code: "phones_unusual", rows: 4 },
    { code: "shared_emails", rows: 2 },
    { code: "placeholders", rows: 300, values: ["frontdesk@example.com"] },
    { code: "other_sheets_ignored", sheets: ["Staff", "Classes"] },
    { code: "cells_cut", rows: 12 },
    { code: "dates_not_read", rows: 5 },
    { code: "card_cells_dropped", rows: 2 },
    { code: "extra_columns_left_out", columns: 7 },
    { code: "gym_fields_full", columns: 2 },
  ];

  it("cover every warning the server can send, each its own and each a sentence", () => {
    const codes = new Set(every.map((warning) => warning.code));
    for (const option of memberListWarningSchema.options) {
      const code = option.shape.code;
      if ("options" in code) for (const c of code.options) expect(codes.has(c)).toBe(true);
      else expect(codes.has(code.value)).toBe(true);
    }
    const words = every.map((warning) => memberListWarningWords(warning));
    for (const said of words) {
      expect(said.length).toBeGreaterThan(20);
      expect(said.endsWith(".")).toBe(true);
    }
    expect(new Set(words).size).toBe(every.length);
  });

  it("say one and many, and name what they are about", () => {
    expect(memberListWarningWords({ code: "shortened_by_excel", rows: 1 })).toContain("1 row has");
    expect(memberListWarningWords({ code: "shortened_by_excel", rows: 12 })).toContain("12 rows have");
    expect(memberListWarningWords({ code: "placeholders", rows: 300, values: ["desk@example.com"] })).toContain("desk@example.com");
    expect(memberListWarningWords({ code: "other_sheets_ignored", sheets: ["Staff"] })).toContain("Staff");
  });

  it("the two warnings about the gym's own columns say DIFFERENT things to do", () => {
    // `extra_columns_left_out` is about THIS FILE being wider than we read, and moving
    // a column left fixes it. `gym_fields_full` is about the GYM's catalogue being
    // full — every column already in it is kept, and moving anything left changes
    // nothing. One sentence for both would send staff to rearrange a spreadsheet that
    // was never the problem.
    const wide = memberListWarningWords({ code: "extra_columns_left_out", columns: 3 });
    const full = memberListWarningWords({ code: "gym_fields_full", columns: 3 });
    expect(wide).not.toEqual(full);
    expect(wide).toContain("further left");
    expect(full).not.toContain("further left");
    expect(full).toContain("Everything else in the file is kept");
    expect(memberListWarningWords({ code: "gym_fields_full", columns: 1 })).toContain("1 column in this file is");
    expect(memberListWarningWords({ code: "gym_fields_full", columns: 4 })).toContain("4 columns in this file are");
  });

  it("say what a skipped row was skipped for", () => {
    for (const reason of memberListSkipReasonSchema.options) {
      expect(MEMBER_LIST_SKIP_WORDS[reason].endsWith(".")).toBe(true);
    }
  });
});

describe("what the list's own shapes promise (3a-iii)", () => {
  it("the base64 ceiling is the file limit encoded, and nothing smaller", () => {
    // A body is refused on its LENGTH before a byte is decoded, so the ceiling has to
    // be at least what the biggest allowed file encodes to — one character short and
    // the largest legal file is refused for being too long.
    const biggest = Math.ceil(MEMBER_FILE_MAX_BYTES / 3) * 4;
    expect(MEMBER_FILE_MAX_BASE64_CHARS).toBe(biggest);
    expect(Buffer.alloc(MEMBER_FILE_MAX_BYTES).toString("base64").length).toBeLessThanOrEqual(MEMBER_FILE_MAX_BASE64_CHARS);
    // And not so generous that a body no file could fill gets through the schema.
    expect(Buffer.alloc(MEMBER_FILE_MAX_BYTES + 1024).toString("base64").length).toBeGreaterThan(MEMBER_FILE_MAX_BASE64_CHARS);
  });

  it.each([
    ["nothing", undefined, true, undefined],
    ["the first page", "0", true, 0],
    ["a page part way in", "500", true, 500],
    ["the last page a list could have", "9900", true, 9900],
    ["a number past any list", "100000", false, undefined],
    ["text", "abc", false, undefined],
    ["nothing at all", "", false, undefined],
    ["exponent form", "1e3", false, undefined],
    ["a negative", "-1", false, undefined],
    ["a leading zero", "00", false, undefined],
    ["a decimal", "1.5", false, undefined],
    ["spaces", " 5 ", false, undefined],
  ])("the cursor takes %s", (_label, cursor, ok, expected) => {
    // A query parameter is TEXT and is parsed into a number, never coerced from one
    // (trap #5): `z.coerce.number()` reads "" as 0 and "1e3" as 1,000, so a screen
    // asking for nothing would silently be answered the first page.
    const parsed = memberListRowsQuerySchema.safeParse(cursor === undefined ? { group: "new" } : { group: "new", cursor });
    expect(parsed.success, String(cursor)).toBe(ok);
    if (parsed.success) expect(parsed.data.cursor).toBe(expected);
  });

  it("the rows query takes only what it names", () => {
    expect(memberListRowsQuerySchema.safeParse({ group: "new", limit: "5" }).success).toBe(false);
    expect(memberListRowsQuerySchema.safeParse({}).success).toBe(false);
    expect(memberListRowsQuerySchema.safeParse({ group: "everybody" }).success).toBe(false);
  });

  it.each([
    [10, 100, false],
    [11, 100, true],
    [10, 50, false],
    [11, 50, true],
    [200, 2000, false],
    [201, 2000, true],
    [10, 0, false],
    [11, 0, true],
    [9, 9, false],
    [0, 0, false],
  ])("a change of %i out of %i needs a tick: %s", (changing, of, large) => {
    // max(10, 10 %), and the edges are the whole rule: a share alone is useless at 50
    // people and a count alone at 2,000 (§9.8). The same function answers the preview's
    // numbers and the confirm's refusal, so a screen can never promise what the server
    // will refuse.
    expect(isLargeMemberListChange(changing, of)).toBe(large);
  });

  it("an upload is either the whole list or people to add, and nothing else", () => {
    expect([...memberListModeSchema.options].sort()).toEqual(["add", "whole_list"]);
    expect(memberListUploadRequestSchema.safeParse({ contentBase64: "AAAA", mode: "replace" }).success).toBe(false);
    expect(memberListUploadRequestSchema.safeParse({ contentBase64: "AAAA", mode: "add" }).success).toBe(true);
    // A body with nothing in it is refused by the shape, before the service is reached.
    expect(memberListUploadRequestSchema.safeParse({ contentBase64: "", mode: "add" }).success).toBe(false);
  });

  it("every sentence for an upload that has gone says what to do about it", () => {
    for (const gone of memberListUploadGoneSchema.options) {
      const said = MEMBER_LIST_UPLOAD_GONE_WORDS[gone];
      expect(said.length).toBeGreaterThan(20);
      expect(said.endsWith(".")).toBe(true);
      // The server never sees a file's name and never says one (§9.9).
      expect(said).not.toContain(".csv");
      expect(said).not.toContain(".xlsx");
    }
  });
});

describe("pressing confirm, and the list you keep (3a-iii-b's own shapes)", () => {
  it("the tick is optional and nothing else may ride with it", () => {
    expect(memberListConfirmRequestSchema.parse({})).toEqual({});
    expect(memberListConfirmRequestSchema.parse({ acknowledgeLargeChange: true })).toEqual({ acknowledgeLargeChange: true });
    // A STRING IS NOT A TICK. "false" is truthy, so a screen sending the word
    // would apply a large change nobody acknowledged.
    expect(memberListConfirmRequestSchema.safeParse({ acknowledgeLargeChange: "true" }).success).toBe(false);
    expect(memberListConfirmRequestSchema.safeParse({ acknowledgeLargeChange: 1 }).success).toBe(false);
    // Strict: a field nobody reads must not be quietly accepted.
    expect(memberListConfirmRequestSchema.safeParse({ force: true }).success).toBe(false);
  });

  it("both refusals that carry numbers say what to do, and neither can hold a person", () => {
    for (const said of Object.values(MEMBER_LIST_CONFIRM_REFUSAL_WORDS)) {
      expect(said.length).toBeGreaterThan(20);
      expect(said.endsWith(".")).toBe(true);
      // The server never sees a file's name and never says one (§9.9).
      expect(said).not.toContain(".csv");
      expect(said).not.toContain(".xlsx");
    }
    // They are DIFFERENT sentences: a list that moved and a change that is too
    // big are two different things for staff to do something about.
    expect(MEMBER_LIST_CONFIRM_REFUSAL_WORDS.list_changed).not.toEqual(MEMBER_LIST_CONFIRM_REFUSAL_WORDS.large_change);
  });

  it("what a confirm answers is counts and instants, never a name", () => {
    const answer = {
      uploadId: "11111111-2222-3333-4444-555555555555",
      alreadyConfirmed: false,
      version: 3,
      confirmedAt: new Date().toISOString(),
      applied: { new: 1, returning: 0, changed: 2, unchanged: 3, gone: 4, alreadyInApp: 1, canBeInvited: 0, noEmail: 0 },
      statuses: [{ label: "Active", count: 6, new: 1, changed: 2, unchanged: 3, gone: 0 }],
      members: { leaving: 1, listedNow: 5 },
    };
    expect(memberListConfirmedSchema.parse(answer)).toEqual(answer);
    // A negative count is not a count. The preview half shipped a bug that
    // answered -1 for `canBeInvited`; the schema is what would have caught it.
    expect(memberListConfirmedSchema.safeParse({ ...answer, version: -1 }).success).toBe(false);
    expect(
      memberListConfirmedSchema.safeParse({ ...answer, applied: { ...answer.applied, canBeInvited: -1 } }).success,
    ).toBe(false);
    expect(memberListConfirmedSchema.safeParse({ ...answer, uploadId: "not-a-uuid" }).success).toBe(false);
  });

  it("the list a gym reads back is counts and its own words", () => {
    const view = {
      hasList: true,
      version: 2,
      lastConfirmedAt: new Date().toISOString(),
      counts: { entries: 10, inApp: 3, canBeInvited: 6, noEmail: 1, former: 0 },
      statuses: [{ label: "Active", count: 8, inApp: 3, canBeInvited: 5 }],
      // 3a-v-b's three, each with a default so a view built before it still parses.
      membershipTypes: [],
      paymentStatuses: [],
      fields: [],
    };
    expect(memberListViewSchema.parse(view)).toEqual(view);
    // A GYM WITH NO LIST IS A SCREEN, NOT A MISSING ONE: every field still has to
    // be answerable at zero.
    expect(
      memberListViewSchema.parse({
        hasList: false,
        version: 0,
        lastConfirmedAt: null,
        counts: { entries: 0, inApp: 0, canBeInvited: 0, noEmail: 0, former: 0 },
        statuses: [],
      }).hasList,
    ).toBe(false);
    // "" IS A LABEL — the people with no status at all, which a gym whose export
    // has no status column is entirely made of.
    expect(memberListStatusCountSchema.parse({ label: "", count: 4, inApp: 0, canBeInvited: 4 }).label).toBe("");
  });

  it("which people to show: the filters a screen may ask for, and the ones it may not", () => {
    expect(memberListEntriesQuerySchema.parse({})).toEqual({});
    expect(memberListEntriesQuerySchema.parse({ filter: "in_app" }).filter).toBe("in_app");
    expect(memberListEntriesQuerySchema.safeParse({ filter: "everybody" }).success).toBe(false);
    // ONE STATUS ARRIVES AS A STRING AND SEVERAL AS AN ARRAY — what a query string
    // actually does with a repeated key, and both have to be read.
    expect(memberListEntriesQuerySchema.parse({ status: "Active" }).status).toBe("Active");
    expect(memberListEntriesQuerySchema.parse({ status: ["Active", "Frozen"] }).status).toEqual(["Active", "Frozen"]);
    // AN EMPTY STATUS IS A REAL FILTER — "the people with no status at all" — so
    // it must not be rejected as an empty string.
    expect(memberListEntriesQuerySchema.parse({ status: "" }).status).toBe("");
    // The ceilings: a word longer than a status can be, more words than a screen
    // has chips, and a search longer than a search.
    expect(memberListEntriesQuerySchema.safeParse({ status: "x".repeat(MEMBER_LIST_MAX_STATUS_CHARS + 1) }).success).toBe(false);
    expect(
      memberListEntriesQuerySchema.safeParse({ status: Array.from({ length: MEMBER_LIST_STATUS_FILTERS_MAX + 1 }, () => "a") }).success,
    ).toBe(false);
    expect(memberListEntriesQuerySchema.safeParse({ query: "x".repeat(MEMBER_LIST_QUERY_MAX_CHARS + 1) }).success).toBe(false);
    expect(memberListEntriesQuerySchema.safeParse({ cursor: "x".repeat(513) }).success).toBe(false);
    expect(memberListEntriesQuerySchema.safeParse({ nonsense: 1 }).success).toBe(false);
  });

  it("a status filter can always carry every chip a file is allowed to produce", () => {
    // The reader refuses a status column holding more than MEMBER_LIST_MAX_STATUS_WORDS
    // different words, so a screen showing one chip each can never need more than
    // that — plus the "no status" chip. The filter's own ceiling sits above it, and
    // this is what holds the two together rather than a comment.
    expect(MEMBER_LIST_STATUS_FILTERS_MAX).toBeGreaterThan(MEMBER_LIST_MAX_STATUS_WORDS);
  });

  it("a page of the list is bounded, and its cursor is either a place to go or the end", () => {
    const entry = {
      entryId: "11111111-2222-3333-4444-555555555555",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+447911123456",
      memberNumber: "M-1",
      status: "Active",
      // The five 3a-v-b added, and the day they came off the list (§11.1). Empty here:
      // what this case is about is the page's own bounds and its cursor.
      membershipType: null,
      joinedOn: null,
      endsOn: null,
      endsOnKind: null,
      paymentStatus: null,
      dateOfBirth: null,
      formerAt: null,
      source: "upload" as const,
      inApp: false,
    };
    expect(memberListEntriesPageSchema.parse({ total: 1, entries: [entry], cursor: null }).cursor).toBeNull();
    expect(
      memberListEntriesPageSchema.safeParse({
        total: 1,
        entries: Array.from({ length: MEMBER_LIST_ENTRIES_PAGE + 1 }, () => entry),
        cursor: null,
      }).success,
    ).toBe(false);
    // Every field a gym's own record may leave empty is nullable, and the id is
    // not: 3a-iv changes and removes a person by it.
    expect(
      memberListEntrySchema.parse({ ...entry, email: null, phone: null, memberNumber: null, status: null }).entryId,
    ).toBe(entry.entryId);
    expect(memberListEntrySchema.safeParse({ ...entry, source: "invented" }).success).toBe(false);
  });
});

describe("the wider record, kept (3a-v-b's own shapes)", () => {
  it("every kept field has plain-English words, because staff read field names rather than count them", () => {
    for (const field of memberListFieldSchema.options) {
      const said = MEMBER_LIST_FIELD_WORDS[field];
      expect(said.length).toBeGreaterThan(3);
      // A NAME AND NOT A SENTENCE: these are read inside "…would replace your staff's
      // membership type", so a full stop or a capital would read as a fragment.
      expect(said.endsWith(".")).toBe(false);
      expect(said).toBe(said.toLowerCase());
    }
    // No two fields share a word, or a refusal naming two would look like one.
    expect(new Set(Object.values(MEMBER_LIST_FIELD_WORDS)).size).toBe(memberListFieldSchema.options.length);
  });

  it("the two ticks are two questions, and neither can be sent as a word", () => {
    expect(memberListConfirmRequestSchema.parse({})).toEqual({});
    expect(memberListConfirmRequestSchema.parse({ acknowledgeHandEdits: true })).toEqual({ acknowledgeHandEdits: true });
    expect(
      memberListConfirmRequestSchema.parse({ acknowledgeLargeChange: true, acknowledgeHandEdits: true }),
    ).toEqual({ acknowledgeLargeChange: true, acknowledgeHandEdits: true });
    expect(memberListConfirmRequestSchema.safeParse({ acknowledgeHandEdits: "true" }).success).toBe(false);
    // THE THREE REFUSALS THAT CARRY NUMBERS ARE THREE DIFFERENT SENTENCES.
    const words = Object.values(MEMBER_LIST_CONFIRM_REFUSAL_WORDS);
    expect(new Set(words).size).toBe(words.length);
    expect(MEMBER_LIST_CONFIRM_REFUSAL_WORDS.hand_edits).toContain("your staff typed in");
  });

  it("the hand-edit refusal carries a count and field NAMES, and nothing that could be a person", () => {
    expect(memberListHandEditsSchema.parse({ entries: 0, fields: [] })).toEqual({ entries: 0, fields: [] });
    expect(memberListHandEditsSchema.parse({ entries: 3, fields: ["status", "membership type"] }).entries).toBe(3);
    // Strict: nothing else may ride with it — least of all a person.
    expect(memberListHandEditsSchema.safeParse({ entries: 1, fields: [], people: ["Ada"] }).success).toBe(false);
    expect(memberListHandEditsSchema.safeParse({ entries: -1, fields: [] }).success).toBe(false);
    // Bounded by how many fields there can be, so nothing unbounded reaches a reply.
    expect(
      memberListHandEditsSchema.safeParse({
        entries: 1,
        fields: Array.from({ length: MEMBER_LIST_MAX_EDITED_FIELDS + 1 }, () => "x"),
      }).success,
    ).toBe(false);
  });

  it("a field a member of staff edited is a standard field's own name or one of the gym's columns, and nothing else", () => {
    for (const field of memberListFieldSchema.options) {
      expect(memberListEditedFieldSchema.safeParse(field).success).toBe(true);
    }
    expect(memberListEditedFieldSchema.safeParse("extra:locker_no").success).toBe(true);
    expect(memberListEditedFieldSchema.safeParse(`extra:${"a".repeat(MEMBER_LIST_MAX_FIELD_KEY_CHARS)}`).success).toBe(true);
    // A key is what an entry's document is written under, so it can only be the one
    // shape a document key has.
    expect(memberListEditedFieldSchema.safeParse("extra:Locker No").success).toBe(false);
    expect(memberListEditedFieldSchema.safeParse("extra:").success).toBe(false);
    expect(memberListEditedFieldSchema.safeParse(`extra:${"a".repeat(MEMBER_LIST_MAX_FIELD_KEY_CHARS + 1)}`).success).toBe(false);
    // …AND NEVER A VALUE. The whole design is that a record remembers THAT a field was
    // typed in, never what it was typed from (§11.4).
    expect(memberListEditedFieldSchema.safeParse("Platinum").success).toBe(false);
    expect(memberListEditedFieldSchema.safeParse("membership type").success).toBe(false);
  });

  it("the gym's own columns are a document of keys to cells, parsed like any other outside input", () => {
    expect(memberListExtraDocumentSchema.parse({ locker_no: "L-1", gender: "F" })).toEqual({ locker_no: "L-1", gender: "F" });
    expect(memberListExtraDocumentSchema.parse({})).toEqual({});
    // A cell a person left blank is a cell, not a missing key.
    expect(memberListExtraDocumentSchema.parse({ notes: "" }).notes).toBe("");
    // A key outside the one shape, a cell longer than we keep, and a cell that is not
    // text at all — each would come back from a document some later migration or
    // hand-run statement left half-shaped, and each would read as "this whole column
    // of this person is different" and be written over.
    expect(memberListExtraDocumentSchema.safeParse({ "Locker No": "L-1" }).success).toBe(false);
    expect(memberListExtraDocumentSchema.safeParse({ notes: "x".repeat(MEMBER_LIST_MAX_EXTRA_CHARS + 1) }).success).toBe(false);
    expect(memberListExtraDocumentSchema.safeParse({ notes: 7 }).success).toBe(false);
    expect(memberListExtraDocumentSchema.safeParse({ notes: null }).success).toBe(false);
    // AND HOW MANY KEYS (round one, Low-3). The migration's note says the 40-field
    // ceiling "holds by construction" because a document is only written from the
    // catalogue — and this is the one place that can actually CHECK it, which it did
    // not: a CHECK on the table cannot count a jsonb object's keys.
    const atTheCap = Object.fromEntries(Array.from({ length: MEMBER_LIST_MAX_EXTRA_FIELDS }, (_, i) => [`f${String(i)}`, "x"]));
    expect(memberListExtraDocumentSchema.safeParse(atTheCap).success).toBe(true);
    expect(memberListExtraDocumentSchema.safeParse({ ...atTheCap, one_too_many: "x" }).success).toBe(false);
  });

  it("what an upload would change is counted field by field, and the gym's own columns by their own heading", () => {
    expect(memberListFieldChangeSchema.parse({ field: "endsOn", count: 3 })).toEqual({ field: "endsOn", count: 3 });
    // A field nothing changes is not in the list at all, so a count of zero is not a
    // row — that is what `positive` says.
    expect(memberListFieldChangeSchema.safeParse({ field: "endsOn", count: 0 }).success).toBe(false);
    expect(memberListFieldChangeSchema.safeParse({ field: "invented", count: 1 }).success).toBe(false);
    expect(memberListExtraChangeSchema.parse({ key: "locker_no", label: "Locker No", count: 1 }).label).toBe("Locker No");
    expect(memberListExtraChangeSchema.safeParse({ key: "locker_no", label: "Locker No", count: 1, value: "L-9" }).success).toBe(false);
  });

  it("the list a gym reads back carries its FORMER records as their own number, and three kinds of its own word", () => {
    const view = {
      hasList: true,
      version: 2,
      lastConfirmedAt: new Date().toISOString(),
      counts: { entries: 10, inApp: 3, canBeInvited: 6, noEmail: 1, former: 4 },
      statuses: [{ label: "Active", count: 8, inApp: 3, canBeInvited: 5 }],
      membershipTypes: [{ label: "Gold", count: 6, inApp: 2, canBeInvited: 4 }],
      paymentStatuses: [{ label: "Overdue", count: 1, inApp: 0, canBeInvited: 1 }],
      fields: [{ key: "locker_no", label: "Locker No" }],
    };
    expect(memberListViewSchema.parse(view)).toEqual(view);
    // A GYM THAT HAS NEVER CONFIRMED ONE IS A SCREEN, not a missing route: every field
    // still has to be answerable at zero, including the three added here.
    const empty = memberListViewSchema.parse({
      hasList: false,
      version: 0,
      lastConfirmedAt: null,
      counts: { entries: 0, inApp: 0, canBeInvited: 0, noEmail: 0, former: 0 },
      statuses: [],
    });
    expect(empty.membershipTypes).toEqual([]);
    expect(empty.paymentStatuses).toEqual([]);
    expect(empty.fields).toEqual([]);
    // A gym cannot keep more of its own columns than it may have, and the chips of each
    // kind are capped on their own.
    expect(
      memberListViewSchema.safeParse({
        ...view,
        fields: Array.from({ length: MEMBER_LIST_MAX_EXTRA_FIELDS + 1 }, (_, i) => ({ key: `f${String(i)}`, label: "F" })),
      }).success,
    ).toBe(false);
    expect(
      memberListViewSchema.safeParse({
        ...view,
        membershipTypes: Array.from({ length: MEMBER_LIST_STATUS_CHIPS_MAX + 1 }, () => ({
          label: "Gold",
          count: 1,
          inApp: 0,
          canBeInvited: 1,
        })),
      }).success,
    ).toBe(false);
  });

  it("the three word filters and the records filter are what a screen may ask, and no more", () => {
    expect(memberListEntriesQuerySchema.parse({ membershipType: "Gold" }).membershipType).toBe("Gold");
    expect(memberListEntriesQuerySchema.parse({ paymentStatus: ["Paid", "Overdue"] }).paymentStatus).toEqual(["Paid", "Overdue"]);
    // AN EMPTY WORD IS A REAL FILTER for all three kinds — "the people with none of
    // that word" — which a gym whose export lacks the column is entirely made of.
    expect(memberListEntriesQuerySchema.parse({ membershipType: "" }).membershipType).toBe("");
    expect(memberListEntriesQuerySchema.parse({ paymentStatus: "" }).paymentStatus).toBe("");
    // CURRENT BY DEFAULT, and the former records asked for BY NAME: a former record in
    // a page nobody asked for is somebody the gym believes it has removed standing in a
    // list of its members.
    expect(memberListEntriesQuerySchema.parse({}).records).toBeUndefined();
    for (const records of memberListRecordsSchema.options) {
      expect(memberListEntriesQuerySchema.parse({ records }).records).toBe(records);
    }
    expect(memberListEntriesQuerySchema.safeParse({ records: "deleted" }).success).toBe(false);
    // The same ceilings as the status filter, because they are the same kind of word.
    expect(
      memberListEntriesQuerySchema.safeParse({ membershipType: "x".repeat(MEMBER_LIST_MAX_STATUS_CHARS + 1) }).success,
    ).toBe(false);
    expect(
      memberListEntriesQuerySchema.safeParse({
        paymentStatus: Array.from({ length: MEMBER_LIST_STATUS_FILTERS_MAX + 1 }, () => "a"),
      }).success,
    ).toBe(false);
    // The server's own spelling and nothing else: a screen sending snake_case would
    // otherwise be quietly answered with everybody.
    expect(memberListEntriesQuerySchema.safeParse({ membership_type: "Gold" }).success).toBe(false);
    expect(memberListEntriesQuerySchema.safeParse({ record: "former" }).success).toBe(false);
  });

  it("one person on a page carries every kept field and NOT the gym's own columns", () => {
    const entry = {
      entryId: "11111111-2222-3333-4444-555555555555",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+447911123456",
      memberNumber: "M-1",
      status: "Active",
      membershipType: "Gold",
      joinedOn: "2024-04-03",
      endsOn: "2027-04-02",
      endsOnKind: "renews" as const,
      paymentStatus: "Paid",
      dateOfBirth: "1991-02-07",
      formerAt: null,
      source: "upload" as const,
      inApp: false,
    };
    // The invitation (3b-i-a) is null for a person never invited, and for a row from a
    // server too old to send it.
    expect(memberListEntrySchema.parse(entry)).toEqual({ ...entry, invitation: null });
    // EVERY FIELD A GYM MAY LEAVE EMPTY IS NULLABLE — a gym whose export has four
    // columns is not a gym with a broken record.
    expect(
      memberListEntrySchema.parse({
        ...entry,
        membershipType: null,
        joinedOn: null,
        endsOn: null,
        endsOnKind: null,
        paymentStatus: null,
        dateOfBirth: null,
      }).entryId,
    ).toBe(entry.entryId);
    // A DAY IS A DAY AND NOT AN INSTANT: a birthday is the same day in every country,
    // so a timestamp here would be a zone waiting to be applied.
    expect(memberListEntrySchema.safeParse({ ...entry, dateOfBirth: "1991-02-07T00:00:00.000Z" }).success).toBe(false);
    expect(memberListEntrySchema.safeParse({ ...entry, joinedOn: "03/04/2024" }).success).toBe(false);
    expect(memberListEntrySchema.safeParse({ ...entry, endsOnKind: "lapses" }).success).toBe(false);
    // THE GYM'S OWN COLUMNS ARE NOT ON A PAGE, deliberately (§11.6): a hundred people
    // times forty columns of five hundred characters is two megabytes of a screen that
    // shows none of it. The schema is not strict, so this pins the intent.
    expect("extra" in memberListEntrySchema.shape).toBe(false);
  });

  it("`returning` is a slice of `new`, and the four groups are still the four groups", () => {
    const counts = { new: 5, returning: 2, changed: 1, unchanged: 3, gone: 0, alreadyInApp: 1, canBeInvited: 3, noEmail: 1 };
    expect(memberListChangeCountsSchema.parse(counts)).toEqual(counts);
    // A summary written before 3a-v-b still parses, which is what keeps a confirmed
    // upload's record readable rather than out of date.
    const older: Record<string, number> = { ...counts };
    delete older["returning"];
    expect(memberListChangeCountsSchema.parse(older).returning).toBe(0);
    expect(memberListChangeCountsSchema.safeParse({ ...counts, returning: -1 }).success).toBe(false);
  });
});

describe("keeping the list by hand (3a-iv's own shapes)", () => {
  const entry = {
    entryId: "11111111-2222-3333-4444-555555555555",
    fullName: "Ann Bell",
    email: "ann@x.example",
    phone: null,
    memberNumber: null,
    status: "Active",
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    endsOnKind: null,
    paymentStatus: null,
    dateOfBirth: null,
    formerAt: null,
    source: "typed",
    inApp: false,
    extra: [{ key: "locker_no", label: "Locker No", value: "L-1" }],
    handEdited: ["status", "extra:locker_no"],
    members: [],
  };
  const digest = "a".repeat(64);

  it("Add member takes the typed fields and nothing else", () => {
    expect(memberListEntryInputSchema.safeParse({ fullName: "Ann", email: "ann@x.example" }).success).toBe(true);
    expect(memberListEntryInputSchema.safeParse({ email: "ann@x.example", nonsense: 1 }).success).toBe(false);
    expect(memberListEntryInputSchema.safeParse({ email: "ann@x.example", joinedOn: "03/04/2026" }).success).toBe(false);
    expect(memberListEntryInputSchema.safeParse({ email: null }).success).toBe(false);
    expect(memberListEntryInputSchema.safeParse({ extra: { "Locker No": "L-1" } }).success).toBe(false);
    expect(memberListEntryInputSchema.safeParse({ extra: { locker_no: "x".repeat(501) } }).success).toBe(false);
    const tooMany = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${String(i)}`, "v"]));
    expect(memberListEntryInputSchema.safeParse({ extra: tooMany }).success).toBe(false);
  });

  it("a change needs at least one field, and null empties one", () => {
    expect(memberListEntryPatchSchema.safeParse({}).success).toBe(false);
    expect(memberListEntryPatchSchema.safeParse({ phone: null }).success).toBe(true);
    expect(memberListEntryPatchSchema.safeParse({ fullName: null }).success).toBe(false);
    // The tick alone changes nothing, so it is not a change.
    expect(memberListEntryPatchSchema.safeParse({ acknowledgeLeavesList: true }).success).toBe(false);
    expect(memberListEntryPatchSchema.safeParse({ email: null, acknowledgeLeavesList: true }).success).toBe(true);
  });

  it("Remove all's answer says whether this press removed them or an earlier one did", () => {
    expect(memberListRemovedSchema.safeParse({ group: "never_listed", removed: 2, alreadyRemoved: true }).success).toBe(true);
    expect(memberListRemovedSchema.safeParse({ group: "never_listed", removed: 2 }).success).toBe(false);
  });

  it("one person's page and a write's answer carry the gym's own columns and the edited field names", () => {
    expect(memberListEntryDetailSchema.parse(entry).extra).toHaveLength(1);
    expect(memberListEntryDetailSchema.safeParse({ ...entry, handEdited: ["favourite colour"] }).success).toBe(false);
    expect(memberListEntryWrittenSchema.safeParse({ outcome: "added", entry, version: 1 }).success).toBe(true);
    expect(memberListEntryWrittenSchema.safeParse({ outcome: "deleted", entry, version: 1 }).success).toBe(false);
  });

  it("joining two records names the one kept", () => {
    expect(memberListMergeRequestSchema.safeParse({ keepEntryId: entry.entryId }).success).toBe(true);
    expect(memberListMergeRequestSchema.safeParse({ keepEntryId: entry.entryId, acknowledgeLeavesList: true }).success).toBe(true);
    expect(memberListMergeRequestSchema.safeParse({ keepEntryId: "nope" }).success).toBe(false);
  });

  it("Remove all names one group, and sends back the version, count and digest it was shown", () => {
    expect(memberListUnlistedQuerySchema.safeParse({ group: "never_listed" }).success).toBe(true);
    expect(memberListUnlistedQuerySchema.safeParse({ group: "everyone" }).success).toBe(false);
    const request = { group: "no_longer_listed", version: 3, expectedCount: 2, digest };
    expect(memberListRemoveUnlistedRequestSchema.safeParse(request).success).toBe(true);
    expect(memberListRemoveUnlistedRequestSchema.safeParse({ ...request, digest: "short" }).success).toBe(false);
    expect(memberListRemoveUnlistedRequestSchema.safeParse({ ...request, expectedCount: -1 }).success).toBe(false);
    expect(memberListRemoveUnlistedRequestSchema.safeParse({ group: "no_longer_listed", version: 3, digest }).success).toBe(false);
    expect(
      memberListUnlistedPageSchema.safeParse({ group: "never_listed", version: 0, total: 0, digest, people: [], cursor: null }).success,
    ).toBe(true);
  });

  it("every sentence is a whole sentence, and the card sentence names the field and no digits", () => {
    for (const words of Object.values(MEMBER_LIST_BY_HAND_WORDS)) expect(words).toMatch(/^[A-Z].*[.!]$/);
    expect(memberListCardTypedWords("status")).toContain("status");
    expect(memberListCardTypedWords("status")).not.toMatch(/\d/);
  });
});
