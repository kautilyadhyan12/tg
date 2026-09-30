// The stored name key (ROADMAP 5b-iv-a): two records hold one key exactly when the import's
// own name rule (`sameName`) calls them one name, so possible duplicates and the import
// never disagree about a name.
import { describe, expect, it } from "vitest";
import { NAME_KEY_MAX_CHARS, nameKey, sameName } from "../src/modules/orgs/memberList/samePerson.js";

/** Names as gyms' exports and front desks write them: accents, apostrophes, commas, capitals,
 *  letters from outside Western Europe, a nickname, a middle name, empty cells. */
const NAMES = [
  "Priya Shah",
  "Shah, Priya",
  "SHAH PRIYA",
  "Priya  Shah ",
  "José Álvarez",
  "Jose Alvarez",
  "Siobhán O'Brien",
  "Siobhan OBrien",
  "Siobhan O’Brien",
  "Łukasz Nowak",
  "Lukasz Nowak",
  "Søren Kierkegaard",
  "Soren Kierkegaard",
  "Straße Anna",
  "Anna Strasse",
  "Liz Smith",
  "Elizabeth Smith",
  "Mary Jane Watson",
  "Mary Watson",
  "Watson-Mary",
  "李 小龙",
  "小龙 李",
  "Nguyễn Văn An",
  "Nguyen Van An",
  "Ольга Петрова",
  "Петрова Ольга",
  "",
  "   ",
  "---",
];

describe("nameKey", () => {
  it("is one key for exactly the names sameName calls one name, and empty for a name with no words", () => {
    for (const a of NAMES) {
      for (const b of NAMES) {
        const same = nameKey(a) !== "" && nameKey(a) === nameKey(b);
        expect(same, `${a} / ${b}`).toBe(sameName(a, b));
      }
    }
    expect(["", "   ", "---"].map(nameKey)).toEqual(["", "", ""]);
  });

  it("reads real spellings as one name and a nickname or a middle name as another", () => {
    expect(nameKey("Shah, Priya")).toBe("priya shah");
    expect(nameKey("José Álvarez")).toBe(nameKey("Jose Alvarez"));
    expect(nameKey("Siobhán O'Brien")).toBe(nameKey("Siobhan OBrien"));
    expect(nameKey("Łukasz Nowak")).toBe(nameKey("Lukasz Nowak"));
    expect(nameKey("Nguyễn Văn An")).toBe(nameKey("Nguyen Van An"));
    expect(nameKey("Петрова Ольга")).toBe(nameKey("Ольга Петрова"));
    expect(nameKey("Liz Smith")).not.toBe(nameKey("Elizabeth Smith"));
    expect(nameKey("Mary Jane Watson")).not.toBe(nameKey("Mary Watson"));
  });

  it("never passes the stored limit and never cuts a character in half", () => {
    // NFKD spells U+FDFA out as eighteen letters: 120 of them fold to far past the limit.
    const long = nameKey("ﷺ ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(NAME_KEY_MAX_CHARS);
    const astral = nameKey("𝒜".repeat(300));
    expect(astral.length).toBeLessThanOrEqual(NAME_KEY_MAX_CHARS);
    expect(astral).toBe(astral.normalize());
    expect(/[\uD800-\uDBFF]$/.test(astral)).toBe(false);
  });
});
