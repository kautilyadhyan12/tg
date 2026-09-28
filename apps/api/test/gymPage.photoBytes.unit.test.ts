// A photo for a gym's page, cleaned (ROADMAP 20c-iv-b; `photoBytes.ts`).
//
// The first block is the worst thing this job could do to a real person: publish a
// photo with the place it was taken still inside it. The photos are real phones' own
// (an iPhone 16, a Samsung Galaxy A56, a Pixel 7; `fixtures/photos/README.md`), each
// carrying a GPS position, and what is checked is what a reader of the cleaned file
// would find — walked here by a reader of this test's own, not by the cleaner's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GYM_PAGE_PHOTO_MAX_BYTES } from "@app/shared";
import { loadConfig } from "../src/config.js";
import { cleanPhoto, exifOrientation } from "../src/modules/orgs/gymPage/photoBytes.js";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)));
const text = (b: Uint8Array): string => Buffer.from(b).toString("latin1");

/** Every block of a JPEG before its first scan (by length, so a thumbnail inside the
 *  EXIF is never mistaken for the picture), where that scan starts, the header before
 *  it, and how many bytes follow the picture's end. */
function jpegBlocks(b: Uint8Array): { blocks: { marker: number; at: number; body: Uint8Array }[]; scanAt: number; header: string; afterEnd: number } {
  const blocks: { marker: number; at: number; body: Uint8Array }[] = [];
  let at = 2;
  for (;;) {
    const marker = b[at + 1] ?? -1;
    const length = ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0);
    if (marker === 0xda) break;
    blocks.push({ marker, at, body: b.subarray(at + 4, at + 2 + length) });
    at += 2 + length;
  }
  const scanAt = at;
  // In the compressed data an FF is followed by 00 or a restart marker; the first FF D9
  // after the scan starts is the picture's end (one scan: every fixture is baseline).
  let end = scanAt;
  while (!(b[end] === 0xff && b[end + 1] === 0xd9)) end += 1;
  return { blocks, scanAt, header: text(b.subarray(0, scanAt)), afterEnd: b.length - (end + 2) };
}

/** Every chunk type of a PNG. */
function pngChunks(b: Uint8Array): string[] {
  const types: string[] = [];
  let at = 8;
  while (at < b.length) {
    const length = Buffer.from(b).readUInt32BE(at);
    types.push(text(b.subarray(at + 4, at + 8)));
    at += 12 + length;
  }
  return types;
}

/** Every chunk type of a WebP, and the VP8X flags. */
function webpChunks(b: Uint8Array): { types: string[]; flags: number | null; riffSize: number } {
  const buf = Buffer.from(b);
  const types: string[] = [];
  let flags: number | null = null;
  let at = 12;
  while (at < b.length) {
    const type = text(b.subarray(at, at + 4));
    const length = buf.readUInt32LE(at + 4);
    if (type === "VP8X") flags = b[at + 8] ?? null;
    types.push(type);
    at += 8 + length + (length % 2);
  }
  return { types, flags, riffSize: buf.readUInt32LE(4) };
}

const clean = (bytes: Uint8Array) => {
  const read = cleanPhoto(bytes);
  if (!read.ok) throw new Error(`refused: ${read.problem}`);
  return read;
};

describe("THE WORST THING: a photo on a public page with the place it was taken still inside it", () => {
  it.each([
    ["iphone16.jpg", "iPhone 16", 1],
    ["samsung-a56-meta.jpg", "Galaxy A56 5G", 6],
    ["pixel7-meta.jpg", "Pixel 7", 1],
  ])("%s: the phone's EXIF, XMP, IPTC and everything after the picture's end are gone", (name, model, orientation) => {
    const original = fixture(name);
    // The file really is a phone's, with a GPS position (the GPS block's tag, 0x8825).
    expect(jpegBlocks(original).header).toContain(model);
    expect(jpegBlocks(original).header).toMatch(/\x88\x25|\x25\x88/);

    const read = clean(original);
    expect(read.type).toBe("image/jpeg");
    const { blocks, afterEnd, header } = jpegBlocks(read.bytes);
    const app = blocks.filter((b) => (b.marker >= 0xe0 && b.marker <= 0xef) || b.marker === 0xfe);
    // Only JFIF, the colour profile, Adobe's colour flag and our own orientation block.
    for (const block of app) {
      const id = text(block.body.subarray(0, 12));
      const allowed =
        (block.marker === 0xe0 && id.startsWith("JFIF\0")) ||
        (block.marker === 0xe2 && id.startsWith("ICC_PROFILE\0")) ||
        (block.marker === 0xee && id.startsWith("Adobe")) ||
        (block.marker === 0xe1 && id.startsWith("Exif\0\0") && block.body.length === 32);
      expect(allowed, `block FF${block.marker.toString(16)} ${JSON.stringify(id)}`).toBe(true);
    }
    // Before the picture: no GPS block, either byte order, nor the phone's own name. (The
    // compressed picture after it holds every byte pair somewhere, by chance.)
    expect(header).not.toMatch(/\x88\x25|\x25\x88/);
    expect(header).not.toContain(model);
    const all = text(read.bytes);
    expect(all).not.toContain("ns.adobe.com/xap");
    expect(all).not.toContain("Photoshop 3.0");
    expect(all).not.toContain("SEFT");
    expect(all).not.toContain("Image_UTC_Data");
    expect(all).not.toContain("MPF\0");
    expect(afterEnd).toBe(0);
    // The picture is shown the way up the phone held it.
    const exif = app.find((b) => b.marker === 0xe1);
    expect(exif === undefined ? 1 : exifOrientation(exif.body)).toBe(orientation);
  });

  it("the Samsung's trailer and the Pixel's second picture are really there before cleaning", () => {
    expect(text(fixture("samsung-a56-meta.jpg"))).toContain("Image_UTC_Data");
    expect(jpegBlocks(fixture("samsung-a56-meta.jpg")).afterEnd).toBe(467);
    expect(jpegBlocks(fixture("pixel7-meta.jpg")).afterEnd).toBe(7615);
  });

  it("a PNG keeps no eXIf, iTXt, tEXt or zTXt", () => {
    const original = fixture("iphone16-exif.png");
    expect(pngChunks(original)).toEqual(expect.arrayContaining(["eXIf", "iTXt"]));
    const read = clean(original);
    expect(read.type).toBe("image/png");
    const kept = pngChunks(read.bytes);
    expect(kept[0]).toBe("IHDR");
    expect(kept.at(-1)).toBe("IEND");
    for (const type of kept) expect(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "pHYs", "bKGD"]).toContain(type);
    expect(text(read.bytes)).not.toContain("iPhone");
    expect(text(read.bytes)).not.toMatch(/\x88\x25|\x25\x88/);
  });

  it("a WebP keeps no EXIF or XMP chunk, and says it has none", () => {
    const original = fixture("iphone16-exif.webp");
    expect(webpChunks(original).types).toEqual(expect.arrayContaining(["EXIF", "XMP "]));
    const read = clean(original);
    expect(read.type).toBe("image/webp");
    const { types, flags, riffSize } = webpChunks(read.bytes);
    expect(types).not.toContain("EXIF");
    expect(types).not.toContain("XMP ");
    expect((flags ?? 0) & 0x0c).toBe(0);
    expect(riffSize).toBe(read.bytes.length - 8);
    expect(text(read.bytes)).not.toContain("iPhone");
  });

  it("the picture itself is untouched: its size is read, and its compressed data is copied byte for byte", () => {
    const original = fixture("iphone16.jpg");
    const read = clean(original);
    expect([read.width, read.height]).toEqual([2935, 2479]);
    const scan = (b: Uint8Array) => Buffer.from(b.subarray(jpegBlocks(b).scanAt));
    expect(scan(read.bytes).equals(scan(original))).toBe(true);
    // …and the tables it is decoded with.
    const tables = (b: Uint8Array) => jpegBlocks(b).blocks.filter((x) => [0xdb, 0xc4, 0xc0, 0xdd].includes(x.marker)).map((x) => text(x.body));
    expect(tables(read.bytes)).toEqual(tables(original));
    expect(read.bytes.length).toBeLessThan(original.length);
  });
});

describe("what is refused", () => {
  it("by its first bytes, never its name: text, a GIF, a PDF, HEIC, and a photo cut short", () => {
    expect(cleanPhoto(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toEqual({ ok: false, problem: "not_a_photo" });
    expect(cleanPhoto(new TextEncoder().encode("GIF89a\x01\x00\x01\x00"))).toEqual({ ok: false, problem: "not_a_photo" });
    expect(cleanPhoto(new TextEncoder().encode("%PDF-1.7\n"))).toEqual({ ok: false, problem: "not_a_photo" });
    // An iPhone's HEIC starts with a box that says "ftypheic".
    expect(cleanPhoto(Uint8Array.from([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")]))).toEqual({ ok: false, problem: "not_a_photo" });
    const whole = fixture("iphone16.jpg");
    expect(cleanPhoto(whole.subarray(0, 5000))).toEqual({ ok: false, problem: "damaged" });
    expect(cleanPhoto(fixture("iphone16-exif.png").subarray(0, 200))).toEqual({ ok: false, problem: "damaged" });
    expect(cleanPhoto(fixture("iphone16-exif.webp").subarray(0, 40))).toEqual({ ok: false, problem: "damaged" });
  });

  it("a script hidden behind a JPEG's first bytes is not a photo", () => {
    const polyglot = new Uint8Array([0xff, 0xd8, 0xff, ...new TextEncoder().encode("<script>alert(1)</script>")]);
    expect(cleanPhoto(polyglot).ok).toBe(false);
  });

  it("over 2 MB is refused before it is read", () => {
    const big = new Uint8Array(GYM_PAGE_PHOTO_MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(cleanPhoto(big)).toEqual({ ok: false, problem: "too_big" });
    expect(cleanPhoto(new Uint8Array(GYM_PAGE_PHOTO_MAX_BYTES))).toEqual({ ok: false, problem: "not_a_photo" });
  });

  it("a picture that says it is huge is refused, whatever its file size", () => {
    // The iPhone photo with its frame header saying 9,000 × 9,000.
    const original = fixture("iphone16.jpg");
    const huge = Uint8Array.from(original);
    const sof = jpegBlocks(huge).blocks.find((b) => b.marker === 0xc0)?.at ?? -1;
    expect(sof).toBeGreaterThan(0);
    huge.set([9000 >> 8, 9000 & 0xff, 9000 >> 8, 9000 & 0xff], sof + 5);
    expect(cleanPhoto(huge)).toEqual({ ok: false, problem: "too_many_pixels" });
  });
});

describe("where the photos are kept", () => {
  const prod = {
    DATABASE_URL: "postgres://u:p@localhost:5432/db",
    WEB_ORIGIN: "http://localhost:5173",
    JWT_SECRET: "photo-config-secret-0123456789abcdef-32", // gitleaks:allow
    REDIS_URL: "redis://localhost:6379",
    NODE_ENV: "production",
    RESEND_API_KEY: "re_x",
    EMAIL_FROM: "AI Home Gym <hi@example.com>",
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret",
  };

  it("production does not start without a folder for them, so they never land in a temporary one", () => {
    expect(() => loadConfig(prod)).toThrow(/PHOTO_DIR is required in production/);
    expect(loadConfig({ ...prod, PHOTO_DIR: "/srv/aihg/photos" }).PHOTO_DIR).toBe("/srv/aihg/photos");
    expect(loadConfig({ ...prod, NODE_ENV: "development" }).PHOTO_DIR).toBeUndefined();
  });
});
