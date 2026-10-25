// Who each member is in the gym's Square customer list (ROADMAP 18d-iii-b-ii-b-i): every class of case of
// the rule, BEFORE review (CLAUDE.md §4). The names and numbers come from OUTSIDE this code:
// - a card's own name field, ISO/IEC 7813 track 1's "SURNAME/GIVEN NAME MIDDLE" ("LEE/AMY L"), and the
//   capitals a card prints;
// - how gyms' own exports write a name ("Shah, Priya", `memberList/samePerson.ts`'s fixtures);
// - Square's own examples ("Amelia Earhart", "Amelia.Earhart@example.com", "+1-212-555-4240": the Create
//   customer reference, read 2026-10-26) and phones as staff type them at a till ("(212) 555-4240");
// - households: a child on a parent's email, a family landline, a father and son of one name;
// and names the rule has never been told about (a prepaid card's "VISA CARDHOLDER", one-word names).
import { describe, expect, it } from "vitest";
import {
  sameNameForSquare,
  squareEmail,
  squareMembersPlan,
  squarePhone,
  type PlanCustomer,
  type PlanMember,
} from "../src/modules/orgs/payments/squareMembersPlan.js";

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
  ])("%s %s vs %s → %s", (given, family, record, agree) => {
    expect(sameNameForSquare({ givenName: given, familyName: family }, record)).toBe(agree);
  });
});

describe("squarePhone: Square's phone read as the list reads its own", () => {
  it.each<[string | null, string | null, string | null]>([
    ["+1-212-555-4240", "US", "+12125554240"],
    ["(212) 555-4240", "US", "+12125554240"],
    ["212.555.4240", "US", "+12125554240"],
    ["2125554240", "US", "+12125554240"],
    ["+44 20 7946 0958", "US", "+442079460958"],
    ["020 7946 0958", "GB", "+442079460958"],
    // A gym with no country: only a number that says its own.
    ["(212) 555-4240", null, null],
    ["+1 212 555 4240", null, "+12125554240"],
    ["", "US", null],
    [null, "US", null],
    ["not a phone", "US", null],
  ])("%s (%s) → %s", (raw, country, e164) => {
    expect(squarePhone(raw, country === null ? null : (country as "US" | "GB"))).toBe(e164);
  });

  it("an email is compared trimmed and in lower case", () => {
    expect(squareEmail(" Amelia.Earhart@Example.com ")).toBe("amelia.earhart@example.com");
    expect(squareEmail("")).toBeNull();
    expect(squareEmail(null)).toBeNull();
  });
});

const member = (entryId: string, fullName: string, email: string | null, phone: string | null = null): PlanMember => ({ entryId, fullName, email, phone });
const customer = (id: string, given: string | null, family: string | null, email: string | null, phone: string | null = null, referenceId: string | null = null): PlanCustomer => ({
  id,
  givenName: given,
  familyName: family,
  email,
  phone,
  referenceId,
});
const nobody = { taken: new Set<string>(), recordIds: new Set<string>() };
const around = (records: string[], taken: string[] = []) => ({ taken: new Set(taken), recordIds: new Set(records) });

describe("squareMembersPlan: linked, added, or left out", () => {
  it("THE WORST THING: Sam on his mum Pat's email is added as his own customer, never linked to Pat", () => {
    const plan = squareMembersPlan([member("sam", "Sam Smith", "pat@example.com")], [customer("PAT", "Pat", "Smith", "pat@example.com")], around(["sam"]));
    expect(plan.get("sam")).toEqual({ kind: "add" });
  });

  it("a family landline joins no two names", () => {
    const plan = squareMembersPlan([member("sam", "Sam Smith", null, "+12125554240")], [customer("PAT", "Pat", "Smith", null, "+12125554240")], around(["sam"]));
    expect(plan.get("sam")).toEqual({ kind: "add" });
  });

  it("nobody in Square with their email or phone: added", () => {
    const plan = squareMembersPlan([member("amy", "Amy Lee", "amy@example.com", "+12125550101")], [customer("OTHER", "Amy", "Lee", "other@example.com", "+12125550199")], around(["amy"]));
    expect(plan.get("amy")).toEqual({ kind: "add" });
  });

  it("the same email and the same name: linked by email, whatever the case of the email", () => {
    const plan = squareMembersPlan([member("amelia", "Amelia Earhart", "amelia.earhart@example.com")], [customer("AE", "Amelia", "Earhart", "Amelia.Earhart@example.com")], around(["amelia"]));
    expect(plan.get("amelia")).toEqual({ kind: "link", customerId: "AE", by: "email" });
  });

  it("the same phone and the same name, from a card's own name field: linked by phone", () => {
    const plan = squareMembersPlan([member("amy", "Amy Lee", null, "+12125554240")], [customer("AL", "LEE/AMY L", null, null, "+12125554240")], around(["amy"]));
    expect(plan.get("amy")).toEqual({ kind: "link", customerId: "AL", by: "phone" });
  });

  it("one customer with both her email and her phone is found once, and linked by email", () => {
    const plan = squareMembersPlan([member("amy", "Amy Lee", "amy@example.com", "+12125554240")], [customer("AL", "Amy", "Lee", "amy@example.com", "+12125554240")], around(["amy"]));
    expect(plan.get("amy")).toEqual({ kind: "link", customerId: "AL", by: "email" });
  });

  it("a customer with an email and no name at all is nobody's: added", () => {
    const plan = squareMembersPlan([member("amy", "Amy Lee", "amy@example.com")], [customer("X", null, null, "amy@example.com")], around(["amy"]));
    expect(plan.get("amy")).toEqual({ kind: "add" });
  });

  it("Square's own duplicates of one member: left out, nobody added", () => {
    const plan = squareMembersPlan(
      [member("nora", "Nora Price", "nora@example.com")],
      [customer("N2", "Nora", "Price", "nora@example.com"), customer("N1", "NORA", "PRICE", "NORA@example.com")],
      around(["nora"]),
    );
    expect(plan.get("nora")).toEqual({ kind: "several_customers", customerIds: ["N1", "N2"] });
  });

  it("her email on one customer and her phone on another: left out", () => {
    const plan = squareMembersPlan(
      [member("kai", "Kai Moss", "kai@example.com", "+12125550142")],
      [customer("BYMAIL", "Kai", "Moss", "kai@example.com"), customer("BYPHONE", "Kai", "Moss", null, "+12125550142")],
      around(["kai"]),
    );
    expect(plan.get("kai")).toEqual({ kind: "several_customers", customerIds: ["BYMAIL", "BYPHONE"] });
  });

  it("one customer two records here could be (one person twice on the list): both left out", () => {
    const plan = squareMembersPlan(
      [member("leo1", "Leo Grant", "leo@example.com"), member("leo2", "Leo Grant", null, "+12125550177")],
      [customer("LG", "Leo", "Grant", "leo@example.com", "+12125550177")],
      around(["leo1", "leo2"]),
    );
    expect(plan.get("leo1")).toEqual({ kind: "several_people", customerId: "LG", entryIds: ["leo1", "leo2"] });
    expect(plan.get("leo2")).toEqual({ kind: "several_people", customerId: "LG", entryIds: ["leo1", "leo2"] });
  });

  it("Pat and Sam both members on Pat's email, Square has Pat: Pat linked, Sam added", () => {
    const plan = squareMembersPlan(
      [member("pat", "Pat Smith", "pat@example.com"), member("sam", "Sam Smith", "pat@example.com")],
      [customer("PAT", "Pat", "Smith", "pat@example.com")],
      around(["pat", "sam"]),
    );
    expect(plan.get("pat")).toEqual({ kind: "link", customerId: "PAT", by: "email" });
    expect(plan.get("sam")).toEqual({ kind: "add" });
  });

  it("a father and son of one name on one email: the son is never the father's", () => {
    const plan = squareMembersPlan([member("jr", "John Smith Jr", "smiths@example.com")], [customer("SR", "John", "Smith", "smiths@example.com")], around(["jr"]));
    expect(plan.get("jr")).toEqual({ kind: "add" });
  });

  it("a customer already linked to another record here is that record's: the member is added", () => {
    const plan = squareMembersPlan([member("amy2", "Amy Lee", "amy@example.com")], [customer("AL", "Amy", "Lee", "amy@example.com")], around(["amy1", "amy2"], ["AL"]));
    expect(plan.get("amy2")).toEqual({ kind: "add" });
  });

  it("the customer the app made for this record before (its answer lost) is theirs, whatever it says", () => {
    const plan = squareMembersPlan(
      [member("amy", "Amy Lee", "amy@example.com")],
      [customer("OURS", "Amy", null, null, null, "amy"), customer("AL", "Amy", "Lee", "amy@example.com")],
      around(["amy"]),
    );
    expect(plan.get("amy")).toEqual({ kind: "ours", customerId: "OURS" });
  });

  it("two customers the app made for one record: the first by id, the same each time", () => {
    const plan = squareMembersPlan([member("amy", "Amy Lee", null, "+12125550101")], [customer("Z9", null, null, null, "+12125550101", "amy"), customer("A1", null, null, null, "+12125550101", "amy")], around(["amy"]));
    expect(plan.get("amy")).toEqual({ kind: "ours", customerId: "A1" });
  });

  it("a customer the app made for another record of this gym is that record's alone", () => {
    const plan = squareMembersPlan(
      [member("amy2", "Amy Lee", "amy@example.com")],
      [customer("FOR1", "Amy", "Lee", "amy@example.com", null, "amy1")],
      around(["amy1", "amy2"]),
    );
    expect(plan.get("amy2")).toEqual({ kind: "add" });
  });

  it("a reference id of somebody else's (another gym of the business, another app) does not stop a link", () => {
    const plan = squareMembersPlan(
      [member("amy", "Amy Lee", "amy@example.com")],
      [customer("AL", "Amy", "Lee", "amy@example.com", null, "0b6a54c2-another-gym-record")],
      around(["amy"]),
    );
    expect(plan.get("amy")).toEqual({ kind: "link", customerId: "AL", by: "email" });
  });

  it("the same plan whatever order Square and the list come in", () => {
    const members = [
      member("pat", "Pat Smith", "pat@example.com"),
      member("sam", "Sam Smith", "pat@example.com"),
      member("nora", "Nora Price", "nora@example.com"),
      member("leo1", "Leo Grant", "leo@example.com"),
      member("leo2", "Leo Grant", null, "+12125550177"),
      member("amy", "Amy Lee", null, "+12125554240"),
    ];
    const customers = [
      customer("PAT", "Pat", "Smith", "pat@example.com"),
      customer("N1", "Nora", "Price", "nora@example.com"),
      customer("N2", "Nora", "Price", "nora@example.com"),
      customer("LG", "Leo", "Grant", "leo@example.com", "+12125550177"),
      customer("AL", "AMY L", "LEE", null, "+12125554240"),
    ];
    const first = squareMembersPlan(members, customers, around(members.map((m) => m.entryId)));
    const second = squareMembersPlan([...members].reverse(), [...customers].reverse(), around(members.map((m) => m.entryId)));
    expect(Object.fromEntries(second)).toEqual(Object.fromEntries(first));
    expect(first.size).toBe(members.length);
  });

  it("no members: an empty plan", () => {
    expect(squareMembersPlan([], [customer("X", "Amy", "Lee", "amy@example.com")], nobody).size).toBe(0);
  });
});
