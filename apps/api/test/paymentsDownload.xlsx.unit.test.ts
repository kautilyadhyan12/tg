// The payments file's text cells (ROADMAP 18n): a name or product a gym typed goes into the
// file's XML as text. A character XML refuses, or an unescaped & or <, and Excel will not
// open the file at all; so every name below comes out as characters XML 1.0 takes, escaped.
import { describe, expect, it } from "vitest";
import { xmlText } from "../src/modules/orgs/paymentsDownload/xlsx.js";

/** XML 1.0's Char production, with & and < only as the start of an entity. */
const XML_CHARS = /^[\t\n\r -퟿-�\u{10000}-\u{10FFFF}]*$/u;
const BARE = /&(?!(amp|lt|gt|quot);)|</;

describe("payments file: text as XML holds it", () => {
  it.each([
    ["a bell", "Ring\u0007 Ring", "Ring Ring"],
    ["a form feed and an escape", "\u000C\u001BOmar", "Omar"],
    ["the characters XML escapes", 'A & B <c> "d" ]]>', "A &amp; B &lt;c&gt; &quot;d&quot; ]]&gt;"],
    ["an entity already written", "&amp;", "&amp;amp;"],
    ["a lone high surrogate", "\uD800Maya", "Maya"],
    ["a lone low surrogate", "Maya\uDC00", "Maya"],
    ["U+FFFE and U+FFFF", "￾Zoe￿", "Zoe"],
    ["an emoji, kept whole", "Leo 💪", "Leo 💪"],
    ["Hebrew, kept", "שרה", "שרה"],
    ["a tab and a new line, kept", "a\tb\nc", "a\tb\nc"],
    ["a formula, as text", "=1+1", "=1+1"],
  ])("%s", (_, input, out) => {
    const said = xmlText(input);
    expect(said).toBe(out);
    expect(said).toMatch(XML_CHARS);
    expect(said).not.toMatch(BARE);
  });

  it("a cell longer than Excel takes is cut, and the cut never leaves half an entity", () => {
    const said = xmlText("&".repeat(40_000));
    expect(said).toBe("&amp;".repeat(32_000));
  });
});
