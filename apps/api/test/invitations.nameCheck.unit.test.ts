// "Check this is them" (RULINGS 2026-09-23, gap A), tested against the world: the
// names are W3C's "Personal names around the world" (w3.org/International/questions/
// qa-personal-names, read 2026-09-24) and the shapes gym exports hold, not the rule's
// own vocabulary.
import { describe, expect, it } from "vitest";
import { checkName, nameParts } from "../src/modules/orgs/invites/nameCheck.js";

describe("the worst thing: a stranger at a member's mistyped address looks like that member", () => {
  // The gym typed the member's address wrong; somebody else holds it and signed up.
  it.each([
    ["Priya Shah", "Priya Sharma"],
    ["John Smith", "Jane Smith"],
    // W3C: siblings share a family and a generation name, never the whole name.
    ["Mao Zemin", "Mao Zedong"],
    // W3C: an Icelandic brother and sister share no surname at all.
    ["Björk Guðmundsdóttir", "Guðmundur Gunnarsson"],
    // W3C: a Russian wife's family name is her husband's plus "-a".
    ["Boris Yeltsin", "Naina Yeltsina"],
    ["Isa bin Osman", "Zaiton"],
    ["Maria José Carreño Quiñones", "Maria Carreño López"],
    ["Aditya Pratap Singh Chauhan", "Rahul Singh"],
  ])("list %j, signed up as %j: check this is them", (listName, accountName) => {
    expect(checkName(listName, accountName)).toBe("differs");
  });
});

describe("the same person written another way is not flagged", () => {
  it.each([
    // Case, accents, punctuation, and letters the decomposition leaves alone.
    ["Björk Guðmundsdóttir", "bjork gudmundsdottir"],
    ["Zoë Müller", "ZOE MULLER"],
    ["José Álvarez", "Jose Alvarez"],
    ["Łukasz Żółć", "Lukasz Zolc"],
    ["Søren Kierkegaard", "Soren Kierkegaard"],
    // A first name alone, as "What should we call you?" is often answered.
    ["Isa bin Osman", "Isa"],
    ["Samantha Lee", "Sam"],
    // Family name first or last (W3C: Russian and Vietnamese orders).
    ["Boris Nikolayevich Yeltsin", "Yeltsin Boris"],
    ["Nguyễn Tấn Dũng", "Dung Nguyen"],
    // Spanish and Brazilian: several family names, one used.
    ["María José Carreño Quiñones", "Maria Carreno"],
    ["José Eduardo Santos Tavares Melo Silva", "José Silva"],
    // Initials: an American middle initial, a Filipino one, Kerala's village and father.
    ["John Q. Public", "John Public"],
    ["Maria Jimenez Go", "Maria J. Go"],
    ["Velikkakathu Sankaran Achuthanandan", "V. S. Achuthanandan"],
    // The start of a name.
    ["Robert Smith", "Rob Smith"],
    ["Christopher O'Neill", "Chris ONeill"],
    // Hyphens and particles.
    ["Anna Smith-Jones", "Anna Smith"],
    ["Muhammad al-Jamil", "Muhammad Al Jamil"],
    // One script, no spaces: the same characters.
    ["毛泽东", "毛泽东"],
    ["東海林賢蔵", "東海林 賢蔵"],
  ])("list %j, signed up as %j", (listName, accountName) => {
    expect(checkName(listName, accountName)).toBe("matches");
  });
});

describe("what it cannot tell, and so asks about", () => {
  it.each([
    // A nickname that is not the start of the name (W3C: Thaksin is "Maew").
    ["Thaksin Shinawatra", "Maew"],
    ["Robert Smith", "Bob Smith"],
    // Another script.
    ["Mao Zedong", "毛泽东"],
    // Initials alone name nobody.
    ["Kautilya Dhyan", "K D"],
    ["John Smith", "J"],
    // Two letters are not the start of a name ("Al" is not Alice).
    ["Alice Brown", "Al Brown"],
    // Nothing to compare.
    ["Jane Smith", ""],
    ["", "Jane Smith"],
    ["Jane Smith", "  -- . "],
  ])("list %j, signed up as %j: check this is them", (listName, accountName) => {
    expect(checkName(listName, accountName)).toBe("differs");
  });

  it("a part is paired once: the same first name twice does not stand for a surname", () => {
    expect(checkName("John Smith", "John John")).toBe("differs");
  });

  it("an initial never takes the word the same name spells out", () => {
    // "j" could take "jones"; "jones" must still find "jones".
    expect(checkName("Jones J", "J Jones")).toBe("matches");
  });
});

describe("nameParts", () => {
  it("folds case, accents and the letters decomposition leaves, and splits on punctuation", () => {
    expect(nameParts("  Þóra Ðorđević-Æsa  ")).toEqual(["thora", "dordevic", "aesa"]);
    expect(nameParts("O'Neill, Jr.")).toEqual(["o", "neill", "jr"]);
  });
});
