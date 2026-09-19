// How a text file's bytes become letters (spec Part 3 §9.4). The ladder was
// measured on the Excel 16 on Kd's machine (ANSI code page 1252), 2026-09-19:
//   CSV UTF-8          → a UTF-8 mark (EF BB BF), CRLF
//   CSV (Comma delim.) → windows-1252, no mark; a letter outside it (Ł, अ) is a
//                        literal "?", lost when Excel wrote the file
//   Unicode Text       → UTF-16LE with its mark (FF FE), TAB between columns
//   CSV (Macintosh)    → Mac Roman, a bare CR after every line but the last,
//                        which ends in CRLF
//   CSV (MS-DOS)       → the OEM code page; it cannot be told from 1252 by
//                        decoding and is read as 1252 (3a-ii warns of the letters)
// So: a mark decides; else strict UTF-8; else Mac Roman where bare CR line ends
// are at least as many as CRLF and LF together; else windows-1252, which never
// fails and so comes last. The last two are guesses and say so.
//
// **WINDOWS-1252 IS DECODED HERE, NOT BY NODE.** Measured 2026-09-19 on Node
// 24.11.1: `new TextDecoder("windows-1252")` reads the 27 letters and signs at
// 0x80–0x9F as invisible control characters, as ISO-8859-1 does — € ‚ „ … ' ' " "
// – — ™ and the letters Š š Ž ž Œ œ Ÿ of Czech, Croatian, Slovenian and French
// names (compared byte for byte with Python's cp1252). Its `macintosh` matched
// Python's mac_roman on all 256 bytes. So 1252 is latin-1, which maps every byte
// to the same code point, with those 27 put right from the WHATWG table.
import type { MemberFileEncoding, MemberFileRefusal } from "@app/shared";

export type DecodedText =
  | { ok: true; text: string; encoding: MemberFileEncoding; guessed: boolean }
  | { ok: false; refusal: MemberFileRefusal };

/** Every label the ladder asks Node for. Node's official builds carry full ICU;
 *  a slim build would lack `macintosh`, and the API refuses to start rather than
 *  mis-read the first Mac file it is sent. */
const LABELS: readonly MemberFileEncoding[] = ["utf-8", "utf-16le", "utf-16be", "macintosh"];

/** Windows-1252 at 0x80–0x9F (WHATWG's index, the same as Python's cp1252). The
 *  five bytes it leaves undefined — 81, 8D, 8F, 90, 9D — stay the control
 *  characters latin-1 gives them, as WHATWG decodes them. */
const WINDOWS_1252_HIGH: Readonly<Record<number, number>> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

export function decodeWindows1252(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .toString("latin1")
    .replace(/[\u0080-\u009f]/g, (c) => {
      const code = WINDOWS_1252_HIGH[c.charCodeAt(0)];
      return code === undefined ? c : String.fromCharCode(code);
    });
}

export function assertMemberFileDecoders(): void {
  for (const label of LABELS) {
    try {
      new TextDecoder(label);
    } catch {
      throw new Error(`This Node.js build cannot decode ${label}; the member list needs a build with full ICU.`);
    }
  }
}

const hasMark = (bytes: Uint8Array, mark: readonly number[]): boolean => mark.every((b, i) => bytes[i] === b);

/** Bare CR line ends against CRLF and LF, counted on the bytes. */
export function looksLikeMacLineEnds(bytes: Uint8Array): boolean {
  let bareCr = 0;
  let other = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0d) {
      if (bytes[i + 1] === 0x0a) {
        other++;
        i++;
      } else bareCr++;
    } else if (b === 0x0a) other++;
  }
  return bareCr > 0 && bareCr >= other;
}

function strict(label: MemberFileEncoding, bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeMemberText(bytes: Uint8Array): DecodedText {
  let decoded: { text: string | null; encoding: MemberFileEncoding; guessed: boolean };
  if (hasMark(bytes, [0xef, 0xbb, 0xbf])) decoded = { text: strict("utf-8", bytes), encoding: "utf-8", guessed: false };
  else if (hasMark(bytes, [0xff, 0xfe])) decoded = { text: strict("utf-16le", bytes), encoding: "utf-16le", guessed: false };
  else if (hasMark(bytes, [0xfe, 0xff])) decoded = { text: strict("utf-16be", bytes), encoding: "utf-16be", guessed: false };
  else {
    const utf8 = strict("utf-8", bytes);
    if (utf8 !== null) decoded = { text: utf8, encoding: "utf-8", guessed: false };
    else {
      decoded = looksLikeMacLineEnds(bytes)
        ? { text: new TextDecoder("macintosh").decode(bytes), encoding: "macintosh", guessed: true }
        : { text: decodeWindows1252(bytes), encoding: "windows-1252", guessed: true };
    }
  }
  // A NUL is binary, or UTF-16 or UTF-32 read the wrong way: not a list anyone typed.
  if (decoded.text === null || decoded.text.includes("\u0000")) return { ok: false, refusal: { code: "unreadable_text" } };
  return { ok: true, text: decoded.text, encoding: decoded.encoding, guessed: decoded.guessed };
}
