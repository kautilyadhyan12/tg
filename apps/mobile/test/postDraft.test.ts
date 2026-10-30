import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GYM_POST_DRAFT_MOST, GYM_POST_PHONE_PHOTO_MAX_BYTES } from "@app/shared";
import { fromBase64, toBase64 } from "../src/screens/food/photo";
import { clampScale, clampShift } from "../src/screens/gym/zoom";
import { draftFileText, hasWork, photoTrouble, postPhotoToSend, postedWords, readDraftFile } from "../src/screens/gym/postDraft";

// A member's post on the phone (ROADMAP Stage 5 17b).

/** Real phones' photos, each carrying the GPS position it was taken at (apps/api/test/fixtures/photos/README.md). */
const PHOTOS = ["samsung-a56-meta.jpg", "pixel7-meta.jpg", "progressive-exif-between-scans.jpg"] as const;
const photo = (name: string): Uint8Array => new Uint8Array(readFileSync(join(__dirname, "..", "..", "api", "test", "fixtures", "photos", name)));
const latin = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

/** Every block of a JPEG before and between its passes: read here, not by the cleaner. */
function headersOf(b: Uint8Array): string {
  const found: string[] = [];
  let at = 2;
  for (;;) {
    const marker = b[at + 1] ?? -1;
    if (marker === 0xd9) return found.join("");
    const length = ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0);
    if (marker !== 0xda) found.push(latin(b.subarray(at + 4, at + 2 + length)));
    at += 2 + length;
    if (marker === 0xda) {
      while (!(b[at] === 0xff && ![0x00, 0xff, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].includes(b[at + 1] ?? 0))) at += 1;
    }
  }
}

describe("the worst thing: a post's photo never goes up saying where it was taken", () => {
  it.each(PHOTOS)("%s is sent with none of its position", (name) => {
    const original = photo(name);
    expect(latin(original)).toContain("Exif\0\0");
    const read = postPhotoToSend(toBase64(original));
    if (!read.ok) throw new Error(read.problem);
    const header = headersOf(fromBase64(read.base64) ?? new Uint8Array());
    for (const words of ["GPS", "http://ns.adobe.com/xap", "Photoshop", "SEFT", "MPF"]) expect(header).not.toContain(words);
    // Beyond the one fact of which way up it is, no Exif of the camera's is left: 32 bytes is that one entry.
    const exif = header.indexOf("Exif\0\0");
    if (exif !== -1) expect(header.slice(exif + 32)).not.toContain("Exif");
    expect(headersOf(original).length).toBeGreaterThan(header.length);
  });

  it("a WebP, as the phone draws it, goes with none of the camera's tags", () => {
    const original = photo("iphone16-exif.webp");
    expect(latin(original)).toContain("EXIF");
    expect(latin(original)).toContain("XMP ");
    const read = postPhotoToSend(toBase64(original));
    if (!read.ok) throw new Error(read.problem);
    const sent = latin(fromBase64(read.base64) ?? new Uint8Array());
    expect(sent.startsWith("RIFF")).toBe(true);
    expect(sent).not.toContain("EXIF");
    expect(sent).not.toContain("XMP ");
  });

  it("sends nothing over the limit, so the next quality is tried", () => {
    const large = new Uint8Array(GYM_POST_PHONE_PHOTO_MAX_BYTES + 1);
    large.set(photo("samsung-a56-meta.jpg"));
    expect(postPhotoToSend(toBase64(large))).toEqual({ ok: false, problem: "too_big" });
  });

  it("sends nothing for what is no picture", () => {
    expect(postPhotoToSend("not base64!")).toEqual({ ok: false, problem: "unreadable" });
    expect(postPhotoToSend(toBase64(new Uint8Array(2000).fill(7)))).toEqual({ ok: false, problem: "unreadable" });
    expect(postPhotoToSend("")).toEqual({ ok: false, problem: "unreadable" });
  });
});

const KEY = "a1111111-1111-4111-8111-111111111111";
const NAME = "b1111111-1111-4111-8111-111111111111.webp";

describe("the post kept on the phone", () => {
  it("reads back what it wrote", () => {
    const draft = { postKey: KEY, body: "Leg day 🔥", photos: [NAME] };
    expect(readDraftFile(draftFileText(draft))).toEqual(draft);
    const sent = { ...draft, sent: true, changed: true };
    expect(readDraftFile(draftFileText(sent))).toEqual(sent);
  });

  it.each([
    ["nothing", null],
    ["empty", ""],
    ["broken", "{"],
    ["no key", JSON.stringify({ version: 1, body: "x", photos: [] })],
    ["another version", JSON.stringify({ version: 2, postKey: KEY, body: "x", photos: [] })],
    ["too many photos", JSON.stringify({ version: 1, postKey: KEY, body: "", photos: [NAME, NAME, NAME, NAME, NAME] })],
    ["a photo's name that climbs out of its folder", JSON.stringify({ version: 1, postKey: KEY, body: "", photos: ["../../secrets.webp"] })],
    ["words past the most", JSON.stringify({ version: 1, postKey: KEY, body: "a".repeat(GYM_POST_DRAFT_MOST + 1), photos: [] })],
  ])("reads %s as no post", (_, text) => {
    expect(readDraftFile(text)).toBeNull();
  });

  it("has work with words or a photo, and spaces are the person's words", () => {
    expect(hasWork({ body: "", photos: [] })).toBe(false);
    expect(hasWork({ body: " ", photos: [] })).toBe(true);
    expect(hasWork({ body: "", photos: [NAME] })).toBe(true);
  });
});

describe("zooming a photo", () => {
  it.each([
    [0.5, 1],
    [1, 1],
    [2, 2],
    [4, 4],
    [9, 4],
  ])("a scale of %d is held at %d", (asked, held) => {
    expect(clampScale(asked)).toBe(held);
  });

  it.each([
    [50, 300, 1, 0],
    [50, 300, 2, 50],
    [500, 300, 2, 150],
    [-500, 300, 2, -150],
    [500, 300, 4, 450],
  ])("a move of %d on %d at %d is held at %d", (shift, size, scale, held) => {
    expect(clampShift(shift, size, scale) + 0).toBe(held);
  });
});

describe("what the member reads", () => {
  it.each([
    [{ unreadable: 0, tooBig: 0, left: 0 }, null],
    [{ unreadable: 1, tooBig: 0, left: 0 }, "1 photo couldn't be opened. Choose another one."],
    [{ unreadable: 2, tooBig: 0, left: 0 }, "2 photos couldn't be opened. Choose another one."],
    [{ unreadable: 0, tooBig: 1, left: 0 }, "1 photo is too large even made smaller. Choose a smaller one."],
    [{ unreadable: 0, tooBig: 2, left: 0 }, "2 photos are too large even made smaller. Choose a smaller one."],
    [{ unreadable: 0, tooBig: 0, left: 1 }, "A post holds up to 4 photos, so 1 photo was not added."],
    [{ unreadable: 0, tooBig: 0, left: 3 }, "A post holds up to 4 photos, so 3 photos were not added."],
  ])("%j", (counts, words) => {
    expect(photoTrouble(counts)).toBe(words);
  });

  it("says when the server kept the post as it first was", () => {
    const up = "Your post is up.";
    const first = "Your post went up as you first wrote it. Your later changes weren't added.";
    // This send made the post: whatever was changed went.
    expect(postedWords({ firstKept: true, changed: false })).toBe(up);
    expect(postedWords({ firstKept: true, changed: true })).toBe(up);
    // An earlier send made it: nothing was changed, so it is what they meant.
    expect(postedWords({ firstKept: false, changed: false })).toBe(up);
    // An earlier send made it, and they changed it since.
    expect(postedWords({ firstKept: false, changed: true })).toBe(first);
  });
});
