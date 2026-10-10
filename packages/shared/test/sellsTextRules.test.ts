// The text a gym types into Classes, a video link, a membership word and the personal
// training search: nothing hidden, nothing Postgres cannot keep, and no day that day
// arithmetic cannot reach. Found by the security pass over ROADMAP item 17.
import { describe, expect, it } from "vitest";
import {
  classDaySchema,
  classOnlineLinkSchema,
  createGymClassTypeRequestSchema,
  membershipUnlinkRequestSchema,
  ptPeopleQuerySchema,
} from "../src/index.js";

const ch = (code: number): string => String.fromCodePoint(code);
const NUL = ch(0);
const classBody = (over: Record<string, unknown>) => ({ name: "Yoga", minutes: 45, colour: "blue", ...over });
const takes = (over: Record<string, unknown>): boolean => createGymClassTypeRequestSchema.safeParse(classBody(over)).success;

describe("a class's name and description", () => {
  it("the plain form is taken, so the cases below fail for their own reason", () => {
    expect(takes({})).toBe(true);
  });

  it.each([
    ["the zero character", NUL],
    ["a right-to-left override", ch(0x202e)],
    ["a zero-width space", ch(0x200b)],
    ["a left-to-right mark", ch(0x200e)],
    ["a byte-order mark", ch(0xfeff)],
    ["a tab", ch(9)],
  ])("a name holding %s is refused", (_what, hidden) => {
    expect(takes({ name: `Yoga ${hidden}gnirpS` })).toBe(false);
    expect(takes({ description: `Slow ${hidden}flow` })).toBe(false);
  });

  it("a line break is refused in a name and taken in a description", () => {
    expect(takes({ name: "Yoga\nFlow" })).toBe(false);
    expect(takes({ description: "Slow flow.\nBring a mat.\r\nAll levels." })).toBe(true);
  });

  it("names in other alphabets, a joined emoji and Hindi's joiner are taken", () => {
    for (const name of ["योग", "Йога", "ヨガ", `क्${ch(0x200d)}ष`, `${ch(0x1f9d8)}${ch(0x200d)}${ch(0x2640)}${ch(0xfe0f)} Yoga`]) {
      expect(takes({ name }), name).toBe(true);
    }
  });
});

describe("the gym's own video link", () => {
  const takesLink = (link: string): boolean => classOnlineLinkSchema.safeParse(link).success;

  it.each([
    "https://us02web.zoom.us/j/81234567890?pwd=abcDEF123",
    "https://meet.google.com/abc-defg-hij",
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
    "https://my-gym.co.uk/live#room_1",
  ])("%s is taken", (link) => {
    expect(takesLink(link)).toBe(true);
  });

  it.each([
    ["a right-to-left override in the path", `https://zoom.us/j/${ch(0x202e)}123`],
    ["a soft hyphen in the site", `https://zo${ch(0xad)}om.us/j/123`],
    ["a word joiner", `https://zoom.us/j/${ch(0x2060)}123`],
    ["a Greek omicron in the site", `https://z${ch(0x3bf)}om.us/j/123`],
    ["a Cyrillic o in the site", `https://zo${ch(0x43e)}m.us/j/123`],
    ["the same site written the way a browser keeps it", "https://xn--zom-jdd.us/j/123"],
    ["that way of writing a site, further in", "https://live.xn--zom-jdd.us/j/123"],
    ["a bare number address", "https://203.0.113.9/j/123"],
    ["a bare number address in brackets", "https://[2001:db8::1]/j/123"],
    ["the zero character", `https://zoom.us/j/${NUL}123`],
    ["a letter of another alphabet in the path", "https://zoom.us/j/sala-é"],
  ])("%s is refused", (_what, link) => {
    expect(takesLink(link)).toBe(false);
  });
});

describe("a membership word and the personal training search", () => {

  it("a word as a file writes it is taken, a hidden mark and all", () => {
    for (const word of ["Active", "Gold – monthly", `Paid${ch(0x200e)}`, "aktív\ttag"]) {
      const parsed = membershipUnlinkRequestSchema.safeParse({ word: word });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it("a word holding the zero character is refused", () => {
    expect(membershipUnlinkRequestSchema.safeParse({ word: `Act${NUL}ive` }).success).toBe(false);
  });

  it("the search takes a name and refuses the zero character", () => {
    expect(ptPeopleQuerySchema.safeParse({ query: "o'brien" }).success).toBe(true);
    expect(ptPeopleQuerySchema.safeParse({ query: `a${NUL}b` }).success).toBe(false);
  });
});

describe("a day", () => {
  it.each(["2026-10-10", "1900-01-01", "2199-12-31"])("%s is taken", (day) => {
    expect(classDaySchema.safeParse(day).success).toBe(true);
  });

  it.each(["9999-12-20", "9999-12-31", "2200-01-01", "1899-12-31", "0001-01-01"])("%s is refused", (day) => {
    expect(classDaySchema.safeParse(day).success).toBe(false);
  });
});
