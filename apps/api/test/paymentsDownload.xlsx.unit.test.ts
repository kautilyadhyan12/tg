// The payments file's text cells (ROADMAP 18n): a name or product a gym typed goes into the
// file's XML as text. A character XML refuses, or an unescaped & or <, and Excel will not
// open the file at all; so every name below comes out as characters XML 1.0 takes, escaped.
import { describe, expect, it } from "vitest";
import { moneyValue, xmlText } from "../src/modules/orgs/paymentsDownload/xlsx.js";

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

describe("payments file: an amount in its own money", () => {
  it("has its currency's own decimals: none for yen, two for most, three for a dinar", () => {
    expect(moneyValue(5000, "JPY")).toBe("5000");
    expect(moneyValue(1100, "JPY")).toBe("1100");
    expect(moneyValue(4999, "USD")).toBe("49.99");
    expect(moneyValue(4999, "AUD")).toBe("49.99");
    expect(moneyValue(5, "EUR")).toBe("0.05");
    expect(moneyValue(0, "INR")).toBe("0.00");
    expect(moneyValue(12500, "KWD")).toBe("12.500");
  });

  it("keeps a refund's minus", () => {
    expect(moneyValue(-250, "USD")).toBe("-2.50");
    expect(moneyValue(-1100, "JPY")).toBe("-1100");
  });
});
