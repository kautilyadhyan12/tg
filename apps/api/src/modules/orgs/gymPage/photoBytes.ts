// A PHOTO FOR A GYM'S PAGE, READ AND CLEANED — ROADMAP 20c-iv-b; spec Part 3 §16.3.
//
// The worst thing this could do to a real person: publish a photo with the place it was
// taken still inside it. A phone writes its GPS position into every photo it takes
// (EXIF in a JPEG, XMP beside it, `eXIf` or text chunks in a PNG, EXIF and XMP chunks in
// a WebP), and an owner's photo of the weights room taken at home, or of the owner, is
// then a public page that says where they live.
//
// So the file is rebuilt from the parts a picture needs, and nothing else is copied: an
// allowlist per format, never a list of things to strip. What is kept is what draws the
// picture — the compressed image, its tables, its colour profile — and, for a JPEG, the
// ONE fact of its metadata a browser needs to show it the right way up (the orientation),
// written into a fresh EXIF block of its own. Anything after the image's end (a second
// image in a multi-picture file, a phone maker's trailer) is dropped.
//
// Pure: bytes in, bytes out. The type is decided by the file's first bytes, never by its
// name or what the browser said.
import { GYM_PAGE_PHOTO_MAX_BYTES, GYM_PAGE_PHOTO_MAX_PIXELS, GYM_PAGE_PHOTO_MAX_SIDE, type GymPagePhotoType } from "@app/shared";

export type PhotoProblem = "too_big" | "not_a_photo" | "damaged" | "too_many_pixels";

export type PhotoReading =
  | { ok: true; type: GymPagePhotoType; width: number; height: number; bytes: Uint8Array }
  | { ok: false; problem: PhotoProblem };

class Damaged extends Error {}

/** The most blocks (JPEG segments, PNG or WebP chunks) one photo may have. A phone's has a
 *  few dozen, a large PNG a few hundred; past this it is a file built to keep the server
 *  busy, and is refused as damaged. */
const MAX_BLOCKS = 4096;

function byteAt(b: Uint8Array, i: number): number {
  const v = b[i];
  if (v === undefined) throw new Damaged();
  return v;
}
const u16be = (b: Uint8Array, i: number): number => (byteAt(b, i) << 8) | byteAt(b, i + 1);
const u16le = (b: Uint8Array, i: number): number => byteAt(b, i) | (byteAt(b, i + 1) << 8);
const u24le = (b: Uint8Array, i: number): number => byteAt(b, i) | (byteAt(b, i + 1) << 8) | (byteAt(b, i + 2) << 16);
const u32be = (b: Uint8Array, i: number): number => ((byteAt(b, i) << 24) >>> 0) + ((byteAt(b, i + 1) << 16) | (byteAt(b, i + 2) << 8) | byteAt(b, i + 3));
const u32le = (b: Uint8Array, i: number): number => ((byteAt(b, i + 3) << 24) >>> 0) + ((byteAt(b, i + 2) << 16) | (byteAt(b, i + 1) << 8) | byteAt(b, i));
const ascii = (b: Uint8Array, i: number, n: number): string => {
  if (i + n > b.length) throw new Damaged();
  return String.fromCharCode(...b.subarray(i, i + n));
};
const startsWith = (b: Uint8Array, i: number, text: string): boolean =>
  i + text.length <= b.length && ascii(b, i, text.length) === text;

function slice(b: Uint8Array, from: number, to: number): Uint8Array {
  if (from < 0 || to > b.length || from > to) throw new Damaged();
  return b.subarray(from, to);
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ── JPEG ────────────────────────────────────────────────────────────────────

/** Markers a picture is drawn from: tables, frame headers, restart interval. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_TABLES = new Set([0xdb, 0xc4, 0xcc, 0xdd, 0xdc]);

/** The orientation (2–8) in an EXIF block, or null: the only fact kept from it. */
export function exifOrientation(app1: Uint8Array): number | null {
  // "Exif\0\0", then a TIFF header: II or MM, 42, the first IFD's offset.
  const tiff = 6;
  const order = ascii(app1, tiff, 2);
  if (order !== "II" && order !== "MM") return null;
  const u16 = order === "II" ? u16le : u16be;
  const u32 = order === "II" ? u32le : u32be;
  if (u16(app1, tiff + 2) !== 42) return null;
  const ifd = tiff + u32(app1, tiff + 4);
  const entries = u16(app1, ifd);
  for (let e = 0; e < entries; e++) {
    const entry = ifd + 2 + e * 12;
    if (u16(app1, entry) !== 0x0112) continue;
    // SHORT, one value, held in the entry itself.
    if (u16(app1, entry + 2) !== 3 || u32(app1, entry + 4) !== 1) return null;
    const value = u16(app1, entry + 8);
    return value >= 2 && value <= 8 ? value : null;
  }
  return null;
}

/** A fresh EXIF block holding the orientation and nothing else. */
function orientationApp1(orientation: number): Uint8Array {
  const body = [
    ...[0x45, 0x78, 0x69, 0x66, 0x00, 0x00], // "Exif\0\0"
    ...[0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], // "MM", 42, first IFD at 8
    ...[0x00, 0x01], // one entry
    ...[0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00], // Orientation, SHORT, 1
    ...[0x00, 0x00, 0x00, 0x00], // no next IFD
  ];
  const length = body.length + 2;
  return Uint8Array.from([0xff, 0xe1, length >> 8, length & 0xff, ...body]);
}

function cleanJpeg(b: Uint8Array): { width: number; height: number; bytes: Uint8Array } {
  const out: Uint8Array[] = [Uint8Array.from([0xff, 0xd8])];
  let at = 2;
  let size: { width: number; height: number } | null = null;
  let orientationDone = false;
  let rotated = false;
  let scans = 0;
  let blocks = 0;
  for (;;) {
    // A photo has a few dozen blocks; thousands of empty ones only make the server work.
    blocks += 1;
    if (blocks > MAX_BLOCKS) throw new Damaged();
    if (byteAt(b, at) !== 0xff) throw new Damaged();
    // Fill bytes: any number of 0xFF before a marker.
    let marker = byteAt(b, at + 1);
    while (marker === 0xff) {
      at += 1;
      marker = byteAt(b, at + 1);
    }
    if (marker === 0xd9) {
      // The end of the image. Whatever follows (a second picture, a trailer) is not copied.
      if (size === null || scans === 0) throw new Damaged();
      out.push(Uint8Array.from([0xff, 0xd9]));
      // Orientations 5 to 8 turn the picture a quarter: it is shown the other way round.
      return { width: rotated ? size.height : size.width, height: rotated ? size.width : size.height, bytes: join(out) };
    }
    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) throw new Damaged();
    const length = u16be(b, at + 2);
    if (length < 2) throw new Damaged();
    const segment = slice(b, at, at + 2 + length);
    at += 2 + length;

    if (marker === 0xda) {
      // A scan: its header, then compressed data up to the next real marker. In the data
      // an 0xFF is followed by 0x00 (a stuffed byte) or a restart marker.
      if (size === null) throw new Damaged();
      let end = at;
      for (;;) {
        if (byteAt(b, end) !== 0xff) {
          end += 1;
          continue;
        }
        const next = byteAt(b, end + 1);
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) {
          end += next === 0xff ? 1 : 2;
          continue;
        }
        break;
      }
      scans += 1;
      out.push(segment, slice(b, at, end));
      at = end;
      continue;
    }
    if (SOF.has(marker)) {
      // Precision, then height and width.
      const height = u16be(segment, 5);
      const width = u16be(segment, 7);
      if (width === 0 || height === 0) throw new Damaged();
      if (size !== null) throw new Damaged();
      size = { width, height };
      out.push(segment);
      continue;
    }
    if (JPEG_TABLES.has(marker)) {
      out.push(segment);
      continue;
    }
    if (marker === 0xe0) {
      // JFIF says how to read the picture; JFXX is a thumbnail, and a thumbnail is a
      // second copy of the photo nobody checks.
      if (startsWith(segment, 4, "JFIF\0")) out.push(jfifWithoutThumbnail(segment));
      continue;
    }
    if (marker === 0xe1) {
      // EXIF (where the GPS position lives) or XMP (which can repeat it): neither is
      // copied. The first EXIF block's orientation is written into a block of its own.
      // Only a block before the picture says which way up it is: one after a pass is
      // no phone's, and goes whole.
      if (!orientationDone && scans === 0 && startsWith(segment, 4, "Exif\0\0")) {
        orientationDone = true;
        let orientation: number | null = null;
        try {
          orientation = exifOrientation(segment.subarray(4));
        } catch (err) {
          // A broken EXIF block is dropped like any other; the picture is still fine.
          if (!(err instanceof Damaged)) throw err;
        }
        if (orientation !== null) {
          out.push(orientationApp1(orientation));
          rotated = orientation >= 5;
        }
      }
      continue;
    }
    if (marker === 0xe2) {
      // The colour profile keeps colours true; a multi-picture index (MPF) points at the
      // pictures after the end, which are not copied.
      if (startsWith(segment, 4, "ICC_PROFILE\0")) out.push(segment);
      continue;
    }
    if (marker === 0xee) {
      // Adobe's colour transform: without it some JPEGs draw in the wrong colours.
      if (startsWith(segment, 4, "Adobe")) out.push(segment);
      continue;
    }
    if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) {
      // Every other application block (IPTC, maker notes, depth maps) and comments.
      continue;
    }
    // A marker no ordinary photo carries: refused rather than guessed at.
    throw new Damaged();
  }
}

/** A JFIF block with no thumbnail pixels (width and height 0). */
function jfifWithoutThumbnail(segment: Uint8Array): Uint8Array {
  // FF E0, length, "JFIF\0", version (2), units (1), densities (4), thumbnail w, h.
  if (segment.length < 4 + 14) throw new Damaged();
  const fixed = Uint8Array.from(segment.subarray(0, 4 + 14));
  fixed[2] = 0;
  fixed[3] = 16;
  fixed[16] = 0;
  fixed[17] = 0;
  return fixed;
}

// ── PNG ─────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Chunks that draw the picture or keep its colours true. Text, `eXIf`, time and
 *  animation chunks are not among them. */
const PNG_KEPT = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP", "pHYs", "bKGD"]);

function cleanPng(b: Uint8Array): { width: number; height: number; bytes: Uint8Array } {
  const out: Uint8Array[] = [slice(b, 0, 8)];
  let at = 8;
  let size: { width: number; height: number } | null = null;
  let hasPicture = false;
  let blocks = 0;
  for (;;) {
    blocks += 1;
    if (blocks > MAX_BLOCKS) throw new Damaged();
    const length = u32be(b, at);
    const type = ascii(b, at + 4, 4);
    const chunk = slice(b, at, at + 12 + length);
    at += 12 + length;
    if (size === null) {
      if (type !== "IHDR" || length !== 13) throw new Damaged();
      size = { width: u32be(chunk, 8), height: u32be(chunk, 12) };
      if (size.width === 0 || size.height === 0) throw new Damaged();
    } else if (type === "IHDR") {
      throw new Damaged();
    }
    if (PNG_KEPT.has(type)) out.push(chunk);
    if (type === "IDAT") hasPicture = true;
    if (type === "IEND") {
      if (!hasPicture) throw new Damaged();
      return { ...size, bytes: join(out) };
    }
  }
}

// ── WEBP ────────────────────────────────────────────────────────────────────

/** Chunks that draw the picture: the image itself, its alpha, its colour profile, and
 *  an animation's frames. EXIF and XMP are not among them. */
const WEBP_KEPT = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "ANIM", "ANMF"]);
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function webpSize(type: string, data: Uint8Array): { width: number; height: number } {
  if (type === "VP8X") return { width: u24le(data, 4) + 1, height: u24le(data, 7) + 1 };
  if (type === "VP8L") {
    if (byteAt(data, 0) !== 0x2f) throw new Damaged();
    const bits = u32le(data, 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (type === "VP8 ") {
    if (byteAt(data, 3) !== 0x9d || byteAt(data, 4) !== 0x01 || byteAt(data, 5) !== 0x2a) throw new Damaged();
    return { width: u16le(data, 6) & 0x3fff, height: u16le(data, 8) & 0x3fff };
  }
  throw new Damaged();
}

function cleanWebp(b: Uint8Array): { width: number; height: number; bytes: Uint8Array } {
  const riffEnd = 8 + u32le(b, 4);
  if (riffEnd > b.length) throw new Damaged();
  const chunks: Uint8Array[] = [];
  let at = 12;
  let size: { width: number; height: number } | null = null;
  let hasPicture = false;
  let blocks = 0;
  while (at < riffEnd) {
    blocks += 1;
    if (blocks > MAX_BLOCKS) throw new Damaged();
    const type = ascii(b, at, 4);
    const length = u32le(b, at + 4);
    const padded = length + (length % 2);
    const chunk = slice(b, at, at + 8 + padded);
    at += 8 + padded;
    if (size === null) {
      if (type !== "VP8X" && type !== "VP8L" && type !== "VP8 ") throw new Damaged();
      size = webpSize(type, chunk.subarray(8));
    }
    if (!WEBP_KEPT.has(type)) continue;
    if (type === "VP8 " || type === "VP8L" || type === "ANMF") hasPicture = true;
    if (type === "VP8X") {
      const fixed = Uint8Array.from(chunk);
      fixed[8] = byteAt(fixed, 8) & ~(VP8X_EXIF | VP8X_XMP);
      chunks.push(fixed);
    } else {
      chunks.push(chunk);
    }
  }
  if (size === null || !hasPicture || size.width === 0 || size.height === 0) throw new Damaged();
  const body = join(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  const riffSize = 4 + body.length;
  header.set([riffSize & 0xff, (riffSize >>> 8) & 0xff, (riffSize >>> 16) & 0xff, (riffSize >>> 24) & 0xff], 4);
  header.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return { ...size, bytes: join([header, body]) };
}

// ── THE ONE ENTRY ───────────────────────────────────────────────────────────

function typeOf(b: Uint8Array): GymPagePhotoType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v)) return "image/png";
  if (b.length >= 12 && startsWith(b, 0, "RIFF") && startsWith(b, 8, "WEBP")) return "image/webp";
  return null;
}

/** The photo as it will be kept and shown, or why it cannot be. `maxBytes` is the gym
 *  page's unless said; a post's photo has a smaller one. */
export function cleanPhoto(input: Uint8Array, maxBytes: number = GYM_PAGE_PHOTO_MAX_BYTES): PhotoReading {
  if (input.length > maxBytes) return { ok: false, problem: "too_big" };
  const type = typeOf(input);
  if (type === null) return { ok: false, problem: "not_a_photo" };
  let cleaned: { width: number; height: number; bytes: Uint8Array };
  try {
    cleaned = type === "image/jpeg" ? cleanJpeg(input) : type === "image/png" ? cleanPng(input) : cleanWebp(input);
  } catch (err) {
    if (err instanceof Damaged || err instanceof RangeError) return { ok: false, problem: "damaged" };
    throw err;
  }
  const { width, height } = cleaned;
  if (width > GYM_PAGE_PHOTO_MAX_SIDE || height > GYM_PAGE_PHOTO_MAX_SIDE || width * height > GYM_PAGE_PHOTO_MAX_PIXELS) {
    return { ok: false, problem: "too_many_pixels" };
  }
  return { ok: true, type, width, height, bytes: cleaned.bytes };
}
