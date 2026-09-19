// What an upload is, told by its first bytes (spec Part 3 §9.4): a table over
// every start the sniff knows, and the ones it must not mistake for them.
import { describe, expect, it } from "vitest";
import { MEMBER_FILE_MAX_BYTES } from "@app/shared";
import { sniffMemberFile } from "../src/modules/orgs/memberList/sniff.js";

const bytes = (...parts: Array<string | number[]>): Buffer =>
  Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "utf-8") : Buffer.from(p))));

const kind = (input: Buffer): unknown => {
  const sniffed = sniffMemberFile(input);
  return sniffed.kind === "refused" ? sniffed.refusal.code : sniffed.kind;
};

describe("the sniff", () => {
  it.each([
    ["nothing at all", Buffer.alloc(0), "empty_file"],
    ["a zip's local header", bytes([0x50, 0x4b, 0x03, 0x04, 0x14]), "zip"],
    ["an empty zip's end record", bytes([0x50, 0x4b, 0x05, 0x06], Array<number>(18).fill(0)), "zip"],
    ["a spanned zip's marker", bytes([0x50, 0x4b, 0x07, 0x08]), "zip"],
    ["PK and nothing else", bytes("PK"), "text"],
    ["a CSV starting PK", bytes("PK code,Email\r\n"), "text"],
    ["the compound file of an .xls or a password", bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]), "old_excel_or_password"],
    ["half of the compound file's mark", bytes([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00, 0x00, 0x00]), "text"],
    ["a PDF", bytes("%PDF-1.7\n"), "pdf"],
    ["an HTML page", bytes("<html xmlns:o='urn:schemas-microsoft-com:office:office'>"), "web_page_or_xml"],
    ["an HTML page in capitals", bytes("<HTML><BODY><TABLE>"), "web_page_or_xml"],
    ["a doctype", bytes("<!DOCTYPE html>\r\n<html>"), "web_page_or_xml"],
    ["a table and nothing else (a bare export)", bytes("\r\n  <table border=1><tr><td>Email</td></tr></table>"), "web_page_or_xml"],
    ["XML", bytes('<?xml version="1.0"?>\r\n<?mso-application progid="Excel.Sheet"?>'), "web_page_or_xml"],
    ["Excel 2003 XML with no declaration", bytes('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">'), "web_page_or_xml"],
    ["a comment first", bytes("<!-- exported -->\n<table>"), "web_page_or_xml"],
    ["a single-file web page", bytes("MIME-Version: 1.0\r\nX-Document-Type: Workbook\r\n"), "web_page_or_xml"],
    ["HTML after a UTF-8 mark", bytes([0xef, 0xbb, 0xbf], "<html>"), "web_page_or_xml"],
    ["HTML in UTF-16LE with its mark", bytes([0xff, 0xfe], [...Buffer.from("<html>", "utf16le")]), "web_page_or_xml"],
    ["HTML in UTF-16BE with its mark", bytes([0xfe, 0xff], [...Buffer.from("<html>", "utf16le").swap16()]), "web_page_or_xml"],
    ["a CSV whose header starts with <", bytes("<Name>,Email\r\n"), "text"],
    ["a CSV that mentions html later", bytes("Name,Note\r\nAnn,<html>\r\n"), "text"],
    ["a CSV with a mark", bytes([0xef, 0xbb, 0xbf], "Name,Email\r\n"), "text"],
    ["UTF-16 text with its mark", bytes([0xff, 0xfe], [...Buffer.from("Name\tEmail", "utf16le")]), "text"],
  ])("%s → %s", (_label, input, expected) => {
    expect(kind(input)).toBe(expected);
  });

  it("takes exactly the size limit and refuses one byte over it", () => {
    expect(kind(Buffer.alloc(MEMBER_FILE_MAX_BYTES, 0x61))).toBe("text");
    expect(kind(Buffer.alloc(MEMBER_FILE_MAX_BYTES + 1, 0x61))).toBe("too_big");
  });
});
