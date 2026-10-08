// Staff notes and tags: what is kept of a typed tag or note (spec Part 3 §18.13).
//
// The look-alike tags are the ones the security pass over 5d saved beside a plain "VIP"
// (reviews, 2026-10-09), each made here from its code point so the file holds nothing
// that cannot be seen.
import { describe, expect, it } from "vitest";
import { cardCheckReadings, memberNoteAddRequestSchema, memberNoteIsSeen, memberTagAddRequestSchema, tidyMemberNoteBody, tidyMemberTagName } from "../src/memberNotes.js";

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

const LOOK_ALIKE: [string, string][] = [
  ["left-to-right mark", `VIP${cp(0x200e)}`],
  ["right-to-left mark", `VIP${cp(0x200f)}`],
  ["soft hyphen", `V${cp(0xad)}IP`],
  ["invisible times", `VI${cp(0x2062)}P`],
  ["combining grapheme joiner", `VI${cp(0x34f)}P`],
  ["variation selector", `VIP${cp(0xfe0f)}`],
  ["variation selector supplement", `VIP${cp(0xe0100)}`],
  ["Mongolian vowel separator", `VIP${cp(0x180e)}`],
  ["Mongolian free variation selector", `VIP${cp(0x180b)}`],
  ["Hangul filler", `VIP${cp(0x3164)}`],
  ["Hangul choseong filler", `VIP${cp(0x115f)}`],
  ["half-width Hangul filler", `VIP${cp(0xffa0)}`],
  ["braille blank", `VIP${cp(0x2800)}`],
  ["tag character", `VIP${cp(0xe0041)}`],
  ["bidi isolate", `${cp(0x2066)}VIP${cp(0x2069)}`],
  ["bidi override", `${cp(0x202e)}VIP`],
  ["zero-width space", `V${cp(0x200b)}IP`],
  ["zero-width joiner", `V${cp(0x200d)}IP`],
  ["word joiner", `VIP${cp(0x2060)}`],
  ["byte order mark", `${cp(0xfeff)}VIP`],
  ["full-width letters", cp(0xff36, 0xff29, 0xff30)],
  ["a NUL", `V${cp(0)}IP`],
  ["no-break and ideographic spaces around", `${cp(0xa0)}VIP${cp(0x3000)}`],
];

describe("a tag's name", () => {
  it.each(LOOK_ALIKE)("VIP typed with a %s is VIP", (_what, typed) => {
    expect(tidyMemberTagName(typed)).toBe("VIP");
  });

  it.each([
    ["only a left-to-right mark", cp(0x200e)],
    ["only a Hangul filler", cp(0x3164)],
    ["only a braille blank", cp(0x2800)],
    ["only a soft hyphen and spaces", ` ${cp(0xad)} `],
    ["only variation selectors", cp(0xfe0f, 0xfe0e)],
  ])("a tag that is %s is no tag", (_what, typed) => {
    expect(tidyMemberTagName(typed)).toBe("");
    expect(memberTagAddRequestSchema.safeParse({ name: typed }).success).toBe(false);
  });

  it.each([
    ["Early bird", "Early bird"],
    ["  Knee   rehab ", "Knee rehab"],
    [`${cp(0xdc)}ber 60`, `${cp(0xdc)}ber 60`],
    ["U" + cp(0x308) + "ber 60", `${cp(0xdc)}ber 60`],
    [cp(0x92a, 0x941, 0x930, 0x93e, 0x928, 0x947), cp(0x92a, 0x941, 0x930, 0x93e, 0x928, 0x947)],
    [cp(0x4f1a, 0x5458), cp(0x4f1a, 0x5458)],
    [`${cp(0x1f525)} Hot`, `${cp(0x1f525)} Hot`],
    ["Since 2019", "Since 2019"],
    ["PT-10 / off-peak", "PT-10 / off-peak"],
  ])("a real tag %j is kept as %j", (typed, kept) => {
    expect(tidyMemberTagName(typed)).toBe(kept);
  });

  it("a name written right to left over a file name is kept as its own letters", () => {
    expect(tidyMemberTagName(`${cp(0x202e)}gnp.exe`)).toBe("gnp.exe");
  });

  it("a tag is picked by its id or typed by its name, never both", () => {
    const id = "33333333-3333-4333-8333-000000000001";
    expect(memberTagAddRequestSchema.parse({ id })).toEqual({ id });
    expect(memberTagAddRequestSchema.parse({ name: " VIP " })).toEqual({ name: "VIP" });
    expect(memberTagAddRequestSchema.safeParse({ id, name: "VIP" }).success).toBe(false);
    expect(memberTagAddRequestSchema.safeParse({ id: "VIP" }).success).toBe(false);
    expect(memberTagAddRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("a note's words", () => {
  const key = "33333333-3333-4333-8333-000000000002";

  it.each([
    ["direction marks only", cp(0x200e, 0x200f, 0x202e)],
    ["a Hangul filler and a new line", `${cp(0x3164)}\n`],
    ["a braille blank", cp(0x2800)],
    ["spaces", "   "],
  ])("a note of %s is refused as empty", (_what, body) => {
    expect(memberNoteIsSeen(tidyMemberNoteBody(body))).toBe(false);
    expect(memberNoteAddRequestSchema.safeParse({ body, requestKey: key }).success).toBe(false);
  });

  it("a note keeps the joiners its words are written with", () => {
    // A Hindi conjunct with a zero-width joiner, a Persian word with a zero-width
    // non-joiner and a family emoji, each made from its code points.
    const hindi = cp(0x915, 0x94d, 0x200d, 0x937);
    const persian = cp(0x645, 0x6cc, 0x200c, 0x62e, 0x648, 0x627, 0x647, 0x645);
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const body = `${hindi} ${persian} ${family}\nSecond line`;
    expect(memberNoteAddRequestSchema.parse({ body, requestKey: key }).body).toBe(body);
  });
});

describe("what the card rule reads", () => {
  it("every script's digits are read as 0 to 9", () => {
    // Unicode keeps each script's ten digits together and in order: checked over every
    // decimal digit this runtime knows, against the digit's own name order.
    const digit = /\p{Nd}/u;
    const wrong: string[] = [];
    let run = 0;
    let seen = 0;
    for (let code = 0; code <= 0x10ffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const char = String.fromCodePoint(code);
      if (digit.test(char)) {
        // NFKC first, as the rule does: the mathematical and full-width digits become plain there.
        if (cardCheckReadings(char).join("|") !== String(run % 10)) wrong.push(`U+${code.toString(16)}`);
        run += 1;
        seen += 1;
      } else {
        if (run % 10 !== 0) wrong.push(`the run of digits ending before U+${code.toString(16)}`);
        run = 0;
      }
    }
    expect(wrong).toEqual([]);
    expect(seen).toBeGreaterThanOrEqual(600);
  });

  it.each([
    ["spaces and a dash", "4111 - 1111 - 1111 - 1111", ["4111 1111 1111 1111"]],
    ["colons", "4111:1111:1111:1111", ["4111 1111 1111 1111"]],
    ["pipes", "4111|1111|1111|1111", ["4111 1111 1111 1111"]],
    ["stars", "4111*1111*1111*1111", ["4111 1111 1111 1111"]],
    ["new lines and tabs", "4111\n1111\t1111\r\n1111", ["4111 1111 1111 1111"]],
    ["one digit at a time", "4 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1", ["4111111111111111"]],
    ["Arabic-Indic digits", `${cp(0x664, 0x661, 0x661, 0x661)} ${cp(0x661, 0x661, 0x661, 0x661)}`, ["4111 1111"]],
    ["Devanagari digits", `${cp(0x96a, 0x967, 0x967, 0x967)} ${cp(0x967, 0x967, 0x967, 0x967)}`, ["4111 1111"]],
    ["full-width digits", cp(0xff14, 0xff11, 0xff11, 0xff11), ["4111"]],
    ["a soft hyphen between groups", `4111${cp(0xad)}1111`, ["41111111", "4111 1111"]],
    ["a left-to-right mark inside a group", `41${cp(0x200e)}11 1111`, ["4111 1111", "41 11 1111"]],
  ])("%s", (_what, typed, readings) => {
    expect(cardCheckReadings(typed)).toEqual(readings);
  });

  it("a plus sign is kept, so a phone number is still read as one", () => {
    expect(cardCheckReadings("Call 12 +44 7911 123456")).toEqual(["Call 12 +44 7911 123456"]);
  });
});
