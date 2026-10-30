// The name rule that following Square's merges reads (ROADMAP 18d-iii-b-ii-b-ii-a; `squareSameName.ts`): every class of case,
// BEFORE review (CLAUDE.md §4). The names come from OUTSIDE this code: a card's own name field, ISO/IEC 7813 track 1's
// "SURNAME/GIVEN NAME MIDDLE" ("LEE/AMY L"), and the capitals a card prints; how gyms' own exports write a name ("Shah, Priya",
// `memberList/samePerson.ts`'s fixtures); Square's own example ("Amelia Earhart", the Create customer reference, read
// 2026-10-26); households, a child on a parent's email, a father and son of one name; and names the rule has never been told
// about (a prepaid card's "VISA CARDHOLDER", one-word names).
import { describe, expect, it } from "vitest";
import { followMerged, sameNameForSquare } from "../src/modules/orgs/payments/squareSameName.js";

describe("sameNameForSquare: the name guard on top of a shared email or phone", () => {
  it.each<[string | null, string | null, string, boolean]>([
    // The same person, as Square and the gym write them.
    ["Amy", "Lee", "Amy Lee", true],
    ["AMY", "LEE", "amy lee", true],
    ["AMY L", "LEE", "Amy Lee", true],
    ["Amy", "Lee", "Amy L. Lee", true],
    ["LEE/AMY L", null, "Amy Lee", true],
    ["Priya", "Shah", "Shah, Priya", true],
    ["Amy", "Lee-Chen", "Amy Lee", true],
    ["Zoë", "Brontë", "Zoe Bronte", true],
    ["Dr Amy", "Lee", "Amy Lee", true],
    ["Amelia", "Earhart", "Amelia Earhart", true],
    ["Mary Jane", "Watson", "Mary Watson", true],
    ["Madonna", null, "Madonna", true],
    ["John", "Smith Jr", "John Smith Jr.", true],
    // Not enough to say: one word against two, an initial, no name at all.
    ["Amy", null, "Amy Lee", false],
    [null, "Lee", "Amy Lee", false],
    ["A", "Lee", "Amy Lee", false],
    [null, null, "Amy Lee", false],
    ["", "  ", "Amy Lee", false],
    ["Amy", "Lee", "", false],
    // Somebody else: a nickname, a parent, a married name, a father and son, a placeholder.
    ["Bob", "Smith", "Robert Smith", false],
    ["Pat", "Smith", "Sam Smith", false],
    [null, "Smith", "Sam Smith", false],
    ["Smith", null, "Sam Smith", false],
    ["Mrs", "Smith", "Sam Smith", false],
    ["Amy", "Chen", "Amy Lee", false],
    ["John", "Smith", "John Smith Jr", false],
    ["John", "Smith Sr", "John Smith Jr", false],
    ["John", "Smith III", "John Smith", false],
    ["Cher", null, "Madonna", false],
    ["VISA", "CARDHOLDER", "Amy Lee", false],
    // A child given a parent's first name as a middle name, either way round (round one, Critical 1), and a
    // double family name with the same first name.
    ["Jane", "Smith", "Emma Jane Smith", false],
    ["Michael", "Smith", "John Michael Smith", false],
    ["Emma Jane", "Smith", "Jane Smith", false],
    ["Jane", "Smith", "Smith, Emma Jane", false],
    ["LEE/JANE", null, "Emma Jane Lee", false],
    ["Maria", "Garcia", "Maria Garcia Lopez", true],
    ["Mrs Jane", "Smith", "Jane Smith", true],
  ])("%s %s vs %s → %s", (given, family, record, agree) => {
    expect(sameNameForSquare({ givenName: given, familyName: family }, record)).toBe(agree);
  });
});

describe("followMerged: the one record whose name is the merged customer's keeps it", () => {
  const rec = (entryId: string, fullName: string) => ({ entryId, fullName });
  it.each<[string, { givenName: string | null; familyName: string | null }, { entryId: string; fullName: string }[], string | null, string[]]>([
    ["his own two customers, the till's kept", { givenName: "LEO", familyName: "GRANT" }, [rec("leo", "Leo Grant")], "leo", []],
    ["a card's own name field", { givenName: "LEE/AMY L", familyName: null }, [rec("amy", "Amy Lee")], "amy", []],
    ["the export's family name first", { givenName: "Priya", familyName: "Shah" }, [rec("priya", "Shah, Priya")], "priya", []],
    ["a child merged into the parent's customer", { givenName: "Pat", familyName: "Smith" }, [rec("sam", "Sam Smith")], null, ["sam"]],
    ["the parent and the child both here: the parent keeps it", { givenName: "Pat", familyName: "Smith" }, [rec("sam", "Sam Smith"), rec("pat", "Pat Smith")], "pat", ["sam"]],
    ["a daughter given her mother's name as a middle name", { givenName: "Jane", familyName: "Smith" }, [rec("emma", "Emma Jane Smith")], null, ["emma"]],
    ["a father and son of one name", { givenName: "John", familyName: "Smith" }, [rec("son", "John Smith Jr"), rec("dad", "John Smith")], "dad", ["son"]],
    ["two records of one person: neither", { givenName: "Nora", familyName: "Price" }, [rec("n1", "Nora Price"), rec("n2", "Nora Price")], null, ["n1", "n2"]],
    ["a merged customer with no given name: nobody's", { givenName: null, familyName: "Grant" }, [rec("leo", "Leo Grant")], null, ["leo"]],
    ["a company's name only: nobody's", { givenName: null, familyName: null }, [rec("leo", "Leo Grant")], null, ["leo"]],
    ["a first name alone: not enough", { givenName: "Leo", familyName: null }, [rec("leo", "Leo Grant")], null, ["leo"]],
    ["a nickname for the name: not the same name", { givenName: "Bob", familyName: "Ortiz" }, [rec("rob", "Robert Ortiz")], null, ["rob"]],
    ["a record with no name", { givenName: "Leo", familyName: "Grant" }, [rec("blank", "")], null, ["blank"]],
    ["nobody here", { givenName: "Leo", familyName: "Grant" }, [], null, []],
  ])("%s", (_case, merged, records, keep, separate) => {
    expect(followMerged(records, merged)).toEqual({ keep, separate });
  });

  it("the same answer whatever order the records come in", () => {
    const records = [rec("sam", "Sam Smith"), rec("pat", "Pat Smith"), rec("kai", "Kai Smith")];
    const merged = { givenName: "Pat", familyName: "Smith" };
    const forward = followMerged(records, merged);
    const back = followMerged([...records].reverse(), merged);
    expect(back.keep).toBe(forward.keep);
    expect([...back.separate].sort()).toEqual([...forward.separate].sort());
  });
});
