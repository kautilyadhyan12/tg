// "Check this is them" (RULINGS 2026-09-23, gap A), tested against the world: the
// names are W3C's "Personal names around the world" (w3.org/International/questions/
// qa-personal-names, read 2026-09-24), the shapes gym exports hold, and the names a
// code sign-up is given from a mistyped address — not the rule's own vocabulary. A wrong
// "differs" only asks staff to look; a wrong "matches" hides a stranger.
import { describe, expect, it } from "vitest";
import { displayNameFromEmail } from "../src/modules/auth/service.js";
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
    // Round one's cases: the holder of a name-built address shares a name with the
    // member, because that is how the address came to be nearly the same.
    ["Priya Shah", "Priya"],
    ["Maria Garcia", "Maria"],
    ["Mohammed Khan", "Mohammed"],
    ["John Smith", "Smith"],
    ["Priya Shah", "Priya Shahani"],
    ["Ann Lee", "Annabelle Leeson"],
    ["Sam Lee", "Samuel Leeds"],
    // The re-check's cases: the other way round, the stranger's family name the start of
    // the member's (the desk typed johnsmith@ for johnsmithson@).
    ["Priya Shahani", "Priya Shah"],
    ["Ann Leeson", "Ann Lee"],
    ["Tom Reedman", "Tom Reed"],
    ["Maria Garcia", "Maria Gar"],
    ["John Smithson", "John Smith"],
  ])("list %j, signed up as %j: check this is them", (listName, accountName) => {
    expect(checkName(listName, accountName)).toBe("differs");
  });

  // A code sign-up is named after its address until the person types a name, and a
  // mistyped address is usually built from the member's own name (round one's C1).
  it.each([
    ["Priya Shah", "priya.shah1@gmail.com"],
    ["Priya Shah", "priyashah1@gmail.com"],
    ["Priya Shah", "priya_sha@yahoo.com"],
    ["John Smith", "johnsmith@gmial.com"],
    ["Maria Garcia", "mariagarcia@gmail.com"],
    ["Tom Reed", "tom.reed@gmail.co"],
    ["Tom Reed", "Tom.Reed@gmail.co"],
  ])("list %j, holder of %j who has typed no name: check this is them", (listName, address) => {
    const madeFromAddress = displayNameFromEmail(address);
    expect(checkName(listName, madeFromAddress, madeFromAddress)).toBe("differs");
  });

  it("the same words typed as a real name still match", () => {
    expect(checkName("Tom Reed", "Tom Reed", displayNameFromEmail("tom.reed@gmail.co"))).toBe("matches");
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
    // Family name first or last (W3C: Russian and Vietnamese orders).
    ["Boris Nikolayevich Yeltsin", "Yeltsin Boris"],
    ["Nguyễn Tấn Dũng", "Dung Nguyen"],
    // Spanish and Brazilian: several family names, one used.
    ["María José Carreño Quiñones", "Maria Carreno"],
    ["José Eduardo Santos Tavares Melo Silva", "José Silva"],
    // A middle initial left out, or given for a name.
    ["John Q. Public", "John Public"],
    ["Maria Jimenez Go", "Maria J. Go"],
    // An apostrophe joins a name.
    ["Christopher O'Neill", "Christopher ONeill"],
    ["D'Angelo Russell", "Dangelo Russell"],
    // Hyphens and particles.
    ["Anna Smith-Jones", "Anna Smith"],
    ["Muhammad al-Jamil", "Muhammad Al Jamil"],
    // One part, one script.
    ["Zaiton", "Zaiton"],
    ["毛泽东", "毛泽东"],
  ])("list %j, signed up as %j", (listName, accountName) => {
    expect(checkName(listName, accountName)).toBe("matches");
  });
});

describe("what it cannot tell, and so asks about", () => {
  it.each([
    // A first name alone, as "What should we call you?" is often answered: a stranger
    // shares it too often.
    ["Isa bin Osman", "Isa"],
    ["Samantha Lee", "Sam"],
    // A nickname (W3C: Thaksin is "Maew"), or a shortening: "Rob" for "Robert" has the
    // shape of "Reed" for "Reedman", and the list cannot say which part is the first name.
    ["Thaksin Shinawatra", "Maew"],
    ["Robert Smith", "Bob Smith"],
    ["Robert Smith", "Rob Smith"],
    ["Christopher O'Neill", "Chris ONeill"],
    // Another script, or one script split another way.
    ["Mao Zedong", "毛泽东"],
    ["東海林賢蔵", "東海林 賢蔵"],
    // Initials and one word (W3C's Kerala name), or initials alone.
    ["Velikkakathu Sankaran Achuthanandan", "V. S. Achuthanandan"],
    ["Kautilya Dhyan", "K D"],
    ["John Smith", "J"],
    // A middle name the list does not have.
    ["José Álvarez", "José Luis Álvarez"],
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
    // "j" could take "jones" as its initial; "jones" must still find "jones".
    expect(checkName("Jones J", "J Jones")).toBe("matches");
    expect(checkName("Mary Jane Jones", "J Jones Mary")).toBe("matches");
  });
});

describe("nameParts", () => {
  it("folds case, accents and the letters decomposition leaves, joins at apostrophes, splits on the rest", () => {
    expect(nameParts("  Þóra Ðorđević-Æsa  ")).toEqual(["thora", "dordevic", "aesa"]);
    expect(nameParts("O'Neill, Jr.")).toEqual(["oneill", "jr"]);
    expect(nameParts("D’Angelo")).toEqual(["dangelo"]);
  });
});
