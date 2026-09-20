// What an uploaded member file is, told by its first bytes and never by its
// name or the browser's type (spec Part 3 §9.4, principle 8). Runs on the
// request's own thread before any reader starts, so a PDF or an old .xls is
// refused without spending a worker on it. Everything that is not refused here
// is read inside the worker (`parseMemberFile.ts`).
import { MEMBER_FILE_MAX_BYTES, type MemberFileRefusal } from "@app/shared";

export type SniffedMemberFile = { kind: "zip" } | { kind: "text" } | { kind: "refused"; refusal: MemberFileRefusal };

const startsWith = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

/** A zip's local file header, empty-archive end record and spanning marker:
 *  each is how some writer starts a zip, and the safe unzip judges the rest. */
const ZIP_STARTS = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
] as const;
/** The compound file format: a legacy .xls, AND an .xlsx saved with a password
 *  (Excel wraps an encrypted workbook in one), which is why one refusal names both. */
const COMPOUND_FILE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const PDF = [0x25, 0x50, 0x44, 0x46] as const;

/** How a web page or an XML file begins, lower case, after any byte-order mark
 *  and white space. "Export to Excel" buttons write these under an .xls name,
 *  and so does Excel itself for its Web Page, Single File Web Page ("MIME-Version")
 *  and XML Spreadsheet 2003 kinds; read as a CSV they would give nonsense columns. */
const MARKUP_STARTS = [
  "<?xml",
  "<!doctype",
  "<!--",
  "<html",
  "<head",
  "<body",
  "<meta",
  "<table",
  "<style",
  "<workbook",
  "mime-version:",
] as const;

/** Enough of the head to see past a mark and a little white space. */
const HEAD_BYTES = 1024;

function headText(bytes: Uint8Array): string {
  const head = bytes.subarray(0, HEAD_BYTES);
  if (startsWith(head, [0xff, 0xfe])) return new TextDecoder("utf-16le").decode(head);
  if (startsWith(head, [0xfe, 0xff])) return new TextDecoder("utf-16be").decode(head);
  // UTF-8 and every single-byte code page agree on ASCII, which is all the
  // markup starts are made of; a UTF-8 mark is dropped by the decoder.
  return new TextDecoder("utf-8").decode(head);
}

export function looksLikeMarkup(bytes: Uint8Array): boolean {
  const text = headText(bytes).replace(/^[\s﻿]+/u, "").slice(0, 32).toLowerCase();
  return MARKUP_STARTS.some((start) => text.startsWith(start));
}

export function sniffMemberFile(bytes: Uint8Array): SniffedMemberFile {
  if (bytes.length === 0) return { kind: "refused", refusal: { code: "empty_file" } };
  if (bytes.length > MEMBER_FILE_MAX_BYTES) return { kind: "refused", refusal: { code: "too_big" } };
  if (ZIP_STARTS.some((magic) => startsWith(bytes, magic))) return { kind: "zip" };
  if (startsWith(bytes, COMPOUND_FILE)) return { kind: "refused", refusal: { code: "old_excel_or_password" } };
  if (startsWith(bytes, PDF)) return { kind: "refused", refusal: { code: "pdf" } };
  if (looksLikeMarkup(bytes)) return { kind: "refused", refusal: { code: "web_page_or_xml" } };
  return { kind: "text" };
}
