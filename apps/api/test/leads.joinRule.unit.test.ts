// Which member record a joined lead is (ROADMAP 20c-i): the rule in `joinRule.ts`,
// over every class of case. The worst thing it could do is link a lead to somebody
// else's record — a son to his mother's because they share an email — so every case
// where the name does not match must come back "choose", never "link".
//
// The names and households are the shapes real gym files and front desks hold, not the
// rule's own words: a family on one address, a couple on one phone, a gym's export
// writing "Surname, First", a nickname at the desk, an accent the export dropped.
import { describe, expect, it } from "vitest";
import { leadJoinDecision, type LeadContact, type ListRecord } from "../src/modules/orgs/leads/joinRule.js";

const record = (entryId: string, over: Partial<ListRecord>): ListRecord => ({
  entryId,
  fullName: "",
  email: null,
  phone: null,
  former: false,
  ...over,
});

const E1 = "00000000-0000-4000-8000-000000000001";
const E2 = "00000000-0000-4000-8000-000000000002";
const E3 = "00000000-0000-4000-8000-000000000003";

interface Case {
  name: string;
  lead: LeadContact;
  records: ListRecord[];
  want: "add" | { link: string } | { choose: string[] };
}

const cases: Case[] = [
  {
    name: "nobody on the list: a new record",
    lead: { fullName: "Priya Shah", email: "priya@example.com", phone: null },
    records: [],
    want: "add",
  },
  {
    name: "records that share nothing are not candidates",
    lead: { fullName: "Priya Shah", email: "priya@example.com", phone: "+447700900001" },
    records: [record(E1, { fullName: "Priya Shah", email: "other@example.com", phone: "+447700900999" })],
    want: "add",
  },
  {
    name: "same email, same name: linked",
    lead: { fullName: "Priya Shah", email: "priya@example.com", phone: null },
    records: [record(E1, { fullName: "Priya Shah", email: "priya@example.com" })],
    want: { link: E1 },
  },
  {
    name: "email differs only by case: linked",
    lead: { fullName: "Priya Shah", email: "priya@example.com", phone: null },
    records: [record(E1, { fullName: "Priya Shah", email: "Priya@Example.com" })],
    want: { link: E1 },
  },
  {
    name: "same phone, same name: linked",
    lead: { fullName: "Tom Reid", email: null, phone: "+447700900002" },
    records: [record(E1, { fullName: "Tom Reid", phone: "+447700900002" })],
    want: { link: E1 },
  },
  {
    name: "name differs by case, spacing and an accent the export dropped: linked",
    lead: { fullName: "José  Álvarez", email: "jose@example.com", phone: null },
    records: [record(E1, { fullName: "jose alvarez", email: "jose@example.com" })],
    want: { link: E1 },
  },
  {
    name: "a mother and her son on one email: staff choose",
    lead: { fullName: "Arjun Shah", email: "shah.family@example.com", phone: null },
    records: [record(E1, { fullName: "Priya Shah", email: "shah.family@example.com" })],
    want: { choose: [E1] },
  },
  {
    name: "a couple on one phone: staff choose",
    lead: { fullName: "Sam Lee", email: null, phone: "+14155550100" },
    records: [record(E1, { fullName: "Alex Lee", phone: "+14155550100" })],
    want: { choose: [E1] },
  },
  {
    name: "the export writes \"Surname, First\": not proof, staff choose",
    lead: { fullName: "Priya Shah", email: "priya@example.com", phone: null },
    records: [record(E1, { fullName: "Shah, Priya", email: "priya@example.com" })],
    want: { choose: [E1] },
  },
  {
    name: "a nickname at the desk: not proof, staff choose",
    lead: { fullName: "Liz Taylor", email: "liz@example.com", phone: null },
    records: [record(E1, { fullName: "Elizabeth Taylor", email: "liz@example.com" })],
    want: { choose: [E1] },
  },
  {
    name: "a record with no name on the file: staff choose",
    lead: { fullName: "Priya Shah", email: "priya@example.com", phone: null },
    records: [record(E1, { fullName: "", email: "priya@example.com" })],
    want: { choose: [E1] },
  },
  {
    name: "two current records with the lead's name and email: staff choose between them",
    lead: { fullName: "Priya Shah", email: "priya@example.com", phone: null },
    records: [
      record(E1, { fullName: "Priya Shah", email: "priya@example.com" }),
      record(E2, { fullName: "Priya Shah", email: "priya@example.com", phone: "+447700900003" }),
    ],
    want: { choose: [E1, E2] },
  },
  {
    name: "the same name only on a record taken off the list: staff choose (it is put back only if chosen)",
    lead: { fullName: "Priya Shah", email: "priya@example.com", phone: null },
    records: [record(E1, { fullName: "Priya Shah", email: "priya@example.com", former: true })],
    want: { choose: [E1] },
  },
  {
    name: "a current same-name record beside a former one: the current one is linked",
    lead: { fullName: "Priya Shah", email: "priya@example.com", phone: null },
    records: [
      record(E1, { fullName: "Priya Shah", email: "priya@example.com", former: true }),
      record(E2, { fullName: "Priya Shah", email: "priya@example.com" }),
    ],
    want: { link: E2 },
  },
  {
    name: "email matches the mother, phone matches the lead's own record: the own record is linked",
    lead: { fullName: "Arjun Shah", email: "shah.family@example.com", phone: "+447700900004" },
    records: [
      record(E1, { fullName: "Priya Shah", email: "shah.family@example.com" }),
      record(E2, { fullName: "Arjun Shah", phone: "+447700900004" }),
    ],
    want: { link: E2 },
  },
  {
    name: "a lead with no email never matches records with no email",
    lead: { fullName: "Tom Reid", email: null, phone: "+447700900005" },
    records: [record(E1, { fullName: "Tom Reid", email: null, phone: null }), record(E2, { fullName: "Tom Reid", email: "tom@example.com" })],
    want: "add",
  },
  {
    name: "a lead with no phone never matches records with no phone",
    lead: { fullName: "Tom Reid", email: "tom@example.com", phone: null },
    records: [record(E3, { fullName: "Tom Reid", phone: null, email: null })],
    want: "add",
  },
];

describe("which record a joined lead is", () => {
  it.each(cases)("$name", ({ lead, records, want }) => {
    const decision = leadJoinDecision(lead, records);
    if (want === "add") {
      expect(decision).toEqual({ kind: "add" });
    } else if ("link" in want) {
      expect(decision).toEqual({ kind: "link", entryId: want.link });
    } else {
      expect(decision.kind).toBe("choose");
      if (decision.kind !== "choose") return;
      expect(decision.candidates.map((c) => c.entryId)).toEqual(want.choose);
    }
  });

  it("never links when the name differs, whatever the list holds", () => {
    const lead: LeadContact = { fullName: "Arjun Shah", email: "a@example.com", phone: "+447700900006" };
    const others = ["Priya Shah", "Shah, Arjun", "A. Shah", "Arjun", ""].map((fullName, i) =>
      record(`00000000-0000-4000-8000-00000000010${String(i)}`, { fullName, email: "a@example.com", phone: "+447700900006" }),
    );
    expect(leadJoinDecision(lead, others).kind).toBe("choose");
  });
});
