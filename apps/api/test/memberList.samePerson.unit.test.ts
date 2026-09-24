// The same person next month (ROADMAP 3a-vi; RULINGS 2026-09-24): which record on a
// gym's list each row of next month's file is.
//
// The cases come from how real gym software behaves, not from the rule's own lists:
// - PushPress: a sub-account "will share the same email as the Parent Account";
//   zingFit, on Mindbody migrations: "family accounts where all family members are
//   given one parent's address".
// - Mindbody: the client ID is "as configured by the business owner", and staff are told
//   to change it "to something systematic" (SOK1234 → XSOK1234 for an inactive client).
// - GymMaster: a key fob number, once deleted from a member, "can then be reassigned to
//   another member".
// - FCC (via Jones Day, 2019): "approximately 35 million telephone numbers … are
//   disconnected and then reassigned to a new subscriber" each year.
// - Zen Planner's People report has no member-number column (PushPress's migration help).
// - HubSpot: "When a new contact is added, HubSpot will look for a matching value in the
//   Email property."
import { describe, expect, it } from "vitest";
import type { MemberListRow } from "@app/shared";
import { identityKey } from "../src/modules/orgs/memberList/fields.js";
import { reconcile, type CarriedFields, type ListEntry, type Reconciled, type ReconcileInput } from "../src/modules/orgs/memberList/reconcile.js";
import { matchRows } from "../src/modules/orgs/memberList/samePerson.js";

interface Who {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  memberNumber?: string | null;
  dateOfBirth?: string | null;
}

const ALL: CarriedFields = {
  fullName: true,
  email: true,
  phone: true,
  memberNumber: true,
  status: true,
  membershipType: true,
  joinedOn: true,
  endsOn: true,
  paymentStatus: true,
  dateOfBirth: true,
};

/** A row of next month's file. Its key is the real one the reader gives it: the fields
 *  the file carries, blank where it has no column. */
const row = (at: number, who: Who, carries: CarriedFields = ALL): MemberListRow => {
  const fields = {
    fullName: carries.fullName ? who.fullName : "",
    email: carries.email ? (who.email ?? null) : null,
    phone: carries.phone ? (who.phone ?? null) : null,
    memberNumber: carries.memberNumber ? (who.memberNumber ?? null) : null,
  };
  return {
    row: at,
    ...fields,
    status: "Active",
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    paymentStatus: null,
    dateOfBirth: carries.dateOfBirth ? (who.dateOfBirth ?? null) : null,
    extra: [],
    identityKey: identityKey(fields),
  };
};

const entry = (who: Who, over: Partial<ListEntry> = {}): ListEntry => {
  const fields = { fullName: who.fullName, email: who.email ?? null, phone: who.phone ?? null, memberNumber: who.memberNumber ?? null };
  return {
    identityKey: identityKey(fields),
    ...fields,
    status: "Active",
    membershipType: null,
    joinedOn: null,
    endsOn: null,
    endsOnKind: null,
    paymentStatus: null,
    dateOfBirth: who.dateOfBirth ?? null,
    extra: {},
    handEdited: [],
    former: false,
    ...over,
  };
};

const run = (rows: MemberListRow[], entries: ListEntry[], over: Partial<ReconcileInput> = {}): Reconciled =>
  reconcile({ rows, entries, members: [], keptFields: [], carries: ALL, endsOnKind: null, mode: "whole_list", hasList: true, ...over });

/** Who each row became, by the record's name ("new" for nobody). */
const pairs = (out: Reconciled, entries: readonly ListEntry[]): string[] =>
  out.rows.map((r) => {
    const person = [...out.changed, ...out.unchanged, ...out.returning, ...out.added].find((p) => p.at === out.rows.indexOf(r));
    if (person === undefined) throw new Error(`row ${String(r.row)} is in no group`);
    if (person.entryKey === null) return `${r.fullName} → new`;
    const record = entries.find((e) => e.identityKey === person.entryKey);
    return `${r.fullName} → ${record?.fullName ?? "?"}`;
  });

const olivia = { fullName: "Olivia Bennett", email: "olivia.bennett@example.com", phone: "+447700900101", memberNumber: null };

describe("the same person next month: the worst thing first", () => {
  it("Olivia's new phone number is one Olivia, updated — not one new and one missing", () => {
    const before = entry(olivia);
    const out = run([row(2, { ...olivia, phone: "+447700900999" })], [before]);
    expect(out.counts).toMatchObject({ new: 0, changed: 1, unchanged: 0, gone: 0 });
    expect(out.fieldChanges).toEqual([{ field: "phone", count: 1 }]);
    const changed = out.changed[0];
    expect(changed?.entryKey).toBe(before.identityKey);
    expect(changed?.identityKey).toBe(identityKey({ ...olivia, phone: "+447700900999" }));
  });

  it("two family members at one parent's address stay two people, each updated on their own record", () => {
    const mum = { fullName: "Priya Shah", email: "shah.family@example.com", phone: "+447700900201" };
    const son = { fullName: "Arjun Shah", email: "shah.family@example.com", phone: "+447700900202" };
    const entries = [entry(mum), entry(son)];
    // Next month the son has his own phone, and the file lists him first.
    const out = run([row(2, { ...son, phone: "+447700900299" }), row(3, mum)], entries);
    expect(pairs(out, entries)).toEqual(["Arjun Shah → Arjun Shah", "Priya Shah → Priya Shah"]);
    expect(out.counts).toMatchObject({ new: 0, changed: 1, unchanged: 1, gone: 0 });
  });

  it("a parent leaves and the child stays with a new phone: the child keeps the child's record, the parent comes off", () => {
    const mum = { fullName: "Priya Shah", email: "shah.family@example.com", phone: "+447700900201" };
    const son = { fullName: "Arjun Shah", email: "shah.family@example.com", phone: "+447700900202" };
    const entries = [entry(mum), entry(son)];
    const out = run([row(2, { ...son, phone: "+447700900299" })], entries);
    expect(pairs(out, entries)).toEqual(["Arjun Shah → Arjun Shah"]);
    expect(out.gone.map((p) => p.fullName)).toEqual(["Priya Shah"]);
  });

  it("a new child joins on the address of a parent who left: with dates of birth, a stranger never takes the parent's record", () => {
    const mum = { fullName: "Priya Shah", email: "shah.family@example.com", dateOfBirth: "1981-05-14" };
    const daughter = { fullName: "Meera Shah", email: "shah.family@example.com", dateOfBirth: "2011-09-02" };
    const entries = [entry(mum)];
    const out = run([row(2, daughter)], entries);
    expect(pairs(out, entries)).toEqual(["Meera Shah → new"]);
    expect(out.gone.map((p) => p.fullName)).toEqual(["Priya Shah"]);
  });

  it("a key fob number handed to somebody else (GymMaster) does not hand them the old member's record", () => {
    const ann = { fullName: "Ann Lee", email: "ann.lee@example.com", memberNumber: "FOB-1234" };
    const bob = { fullName: "Bob Ray", email: "bob.ray@example.com", memberNumber: "FOB-1234" };
    const entries = [entry(ann)];
    const out = run([row(2, bob)], entries);
    expect(pairs(out, entries)).toEqual(["Bob Ray → new"]);
    expect(out.gone.map((p) => p.fullName)).toEqual(["Ann Lee"]);
  });

  it("the same fob with a phone only on the new holder still does not join two people", () => {
    const ann = { fullName: "Ann Lee", phone: "+447700900301", memberNumber: "FOB-1234" };
    const bob = { fullName: "Bob Ray", phone: "+447700900302", memberNumber: "FOB-1234" };
    const out = run([row(2, bob)], [entry(ann)]);
    expect(out.counts).toMatchObject({ new: 1, gone: 1, changed: 0 });
  });

  it("two people sharing a front-desk or family phone, each with an email of their own, are never one person", () => {
    const sam = { fullName: "Sam Okafor", email: "sam.o@example.com", phone: "+447700900401" };
    const ada = { fullName: "Ada Okafor", email: "ada.o@example.com", phone: "+447700900401" };
    const out = run([row(2, ada)], [entry(sam)]);
    expect(out.counts).toMatchObject({ new: 1, gone: 1, changed: 0 });
  });
});

describe("the same person next month: what real gym software does between two exports", () => {
  type Case = { name: string; before: Who[]; file: Who[]; carries?: CarriedFields; mode?: "whole_list" | "add"; expect: string[]; gone: string[]; fields?: Record<string, number> };
  const noNumberColumn: CarriedFields = { ...ALL, memberNumber: false };
  const noEmailColumn: CarriedFields = { ...ALL, email: false };
  const noBirthColumn: CarriedFields = { ...ALL, dateOfBirth: false };

  const cases: Case[] = [
    {
      name: "a new email address, same member number",
      before: [{ fullName: "Tom Reed", email: "tom@old.example", memberNumber: "M-0042" }],
      file: [{ fullName: "Tom Reed", email: "tom.reed@new.example", memberNumber: "M-0042" }],
      expect: ["Tom Reed → Tom Reed"],
      gone: [],
      fields: { email: 1 },
    },
    {
      name: "a new email AND a new phone, same member number",
      before: [{ fullName: "Tom Reed", email: "tom@old.example", phone: "+447700900501", memberNumber: "M-0042" }],
      file: [{ fullName: "Tom Reed", email: "tom.reed@new.example", phone: "+447700900599", memberNumber: "M-0042" }],
      expect: ["Tom Reed → Tom Reed"],
      gone: [],
      fields: { email: 1, phone: 1 },
    },
    {
      name: "a corrected spelling, same email, no member numbers",
      before: [{ fullName: "Olivia Smyth", email: "olivia@example.com" }],
      file: [{ fullName: "Olivia Smith", email: "olivia@example.com" }],
      expect: ["Olivia Smith → Olivia Smyth"],
      gone: [],
      fields: { fullName: 1 },
    },
    {
      name: "a report that writes 'Surname, First'",
      before: [{ fullName: "Olivia Bennett", email: "olivia.bennett@example.com" }],
      file: [{ fullName: "Bennett, Olivia", email: "olivia.bennett@example.com" }],
      expect: ["Bennett, Olivia → Olivia Bennett"],
      gone: [],
      fields: { fullName: 1 },
    },
    {
      name: "a married name and the same email",
      before: [{ fullName: "Grace Oduya", email: "grace.o@example.com" }],
      file: [{ fullName: "Grace Whitfield", email: "grace.o@example.com" }],
      expect: ["Grace Whitfield → Grace Oduya"],
      gone: [],
      fields: { fullName: 1 },
    },
    {
      name: "Mindbody's ID edited by staff (SOK1234 → XSOK1234), same name and email",
      before: [{ fullName: "Liam Walsh", email: "liam.walsh@example.com", memberNumber: "SOK1234" }],
      file: [{ fullName: "Liam Walsh", email: "liam.walsh@example.com", memberNumber: "XSOK1234" }],
      expect: ["Liam Walsh → Liam Walsh"],
      gone: [],
      fields: { memberNumber: 1 },
    },
    {
      name: "a member number in another case (m-0042 / M-0042) is the same number",
      before: [{ fullName: "Tom Reed", email: "tom@example.com", memberNumber: "M-0042" }],
      file: [{ fullName: "Tom Reed", email: "tom@example.com", memberNumber: "m-0042" }],
      expect: ["Tom Reed → Tom Reed"],
      gone: [],
    },
    {
      name: "an email in capitals is the same email",
      before: [{ fullName: "Tom Reed", email: "tom@example.com" }],
      file: [{ fullName: "Tom Reed", email: "Tom@Example.com" }],
      expect: ["Tom Reed → Tom Reed"],
      gone: [],
    },
    {
      name: "the family's two children at one address, both with new phones: the names pick",
      before: [
        { fullName: "Priya Shah", email: "shah@example.com", phone: "+447700900601" },
        { fullName: "Arjun Shah", email: "shah@example.com", phone: "+447700900602" },
      ],
      file: [
        { fullName: "Arjun Shah", email: "shah@example.com", phone: "+447700900698" },
        { fullName: "Priya Shah", email: "shah@example.com", phone: "+447700900699" },
      ],
      expect: ["Arjun Shah → Arjun Shah", "Priya Shah → Priya Shah"],
      gone: [],
      fields: { phone: 2 },
    },
    {
      name: "a family address where one name is corrected: on a SHARED address a new name is a new person, never a guess",
      before: [
        { fullName: "Priya Shah", email: "shah@example.com", phone: "+447700900601" },
        { fullName: "Arjun Shah", email: "shah@example.com", phone: "+447700900602" },
      ],
      file: [
        { fullName: "Arjun Shah", email: "shah@example.com", phone: "+447700900698" },
        { fullName: "Priyah Shah", email: "shah@example.com", phone: "+447700900699" },
      ],
      expect: ["Arjun Shah → Arjun Shah", "Priyah Shah → new"],
      gone: ["Priya Shah"],
      fields: { phone: 1 },
    },
    {
      name: "review H1: a new child on a shared family address, no date-of-birth column, does not take the parent's record",
      before: [
        { fullName: "Priya Shah", email: "shah.family@example.com", phone: "+447700900201" },
        { fullName: "Arjun Shah", email: "shah.family@example.com", phone: "+447700900202" },
      ],
      file: [
        { fullName: "Arjun Shah", email: "shah.family@example.com", phone: "+447700900202" },
        { fullName: "Meera Shah", email: "shah.family@example.com", phone: "+447700900203" },
      ],
      carries: noBirthColumn,
      expect: ["Arjun Shah → Arjun Shah", "Meera Shah → new"],
      gone: ["Priya Shah"],
    },
    {
      name: "review H2: adding people ('Keep them'), a child on a current member's lone email never takes that member's record",
      before: [{ fullName: "Mary Jones", email: "jones@example.com", phone: "+447700900501", memberNumber: "501" }],
      file: [{ fullName: "Tom Jones", email: "jones@example.com", phone: "+447700900502" }],
      mode: "add",
      expect: ["Tom Jones → new"],
      gone: [],
    },
    {
      name: "review H3: the same person found by phone and name later in the file beats a different name on her old email",
      before: [{ fullName: "Mary Jones", email: "jones@example.com", phone: "+447700900501" }],
      file: [
        { fullName: "Tom Jones", email: "jones@example.com", phone: "+447700900502" },
        { fullName: "Mary Jones", email: "mary.new@example.com", phone: "+447700900501" },
      ],
      expect: ["Tom Jones → new", "Mary Jones → Mary Jones"],
      gone: [],
      fields: { email: 1 },
    },
    {
      name: "review H4: a key fob's number with a different name and a contact missing on one side is still a new person",
      before: [{ fullName: "Bob Old", email: "bob@example.com", memberNumber: "123" }],
      file: [{ fullName: "Alice New", phone: "+447700900777", memberNumber: "123" }],
      expect: ["Alice New → new"],
      gone: ["Bob Old"],
    },
    {
      name: "review H4: a child with no email on the family landline does not take the parent's record",
      before: [{ fullName: "Raj Patel", email: "raj@example.com", phone: "+441134960000" }],
      file: [{ fullName: "Anya Patel", phone: "+441134960000" }],
      expect: ["Anya Patel → new"],
      gone: ["Raj Patel"],
    },
    {
      name: "a corrected spelling on a lone address, with a member number that agrees, is still the same person",
      before: [{ fullName: "Grace Oduya", email: "grace.o@example.com", memberNumber: "M-7" }],
      file: [{ fullName: "Grace Whitfield", email: "grace.o@example.com", memberNumber: "M-7" }],
      expect: ["Grace Whitfield → Grace Oduya"],
      gone: [],
      fields: { fullName: 1 },
    },
    {
      name: "a family address where neither name matches and two people are on it: nobody is guessed",
      before: [
        { fullName: "Priya Shah", email: "shah@example.com" },
        { fullName: "Arjun Shah", email: "shah@example.com" },
      ],
      file: [{ fullName: "Meera Shah", email: "shah@example.com" }],
      expect: ["Meera Shah → new"],
      gone: ["Priya Shah", "Arjun Shah"],
    },
    {
      name: "a family member with the same email and a different member number and name is a different person",
      before: [{ fullName: "Priya Shah", email: "shah@example.com", memberNumber: "M-1" }],
      file: [{ fullName: "Arjun Shah", email: "shah@example.com", memberNumber: "M-2" }],
      expect: ["Arjun Shah → new"],
      gone: ["Priya Shah"],
    },
    {
      name: "a Zen Planner-style file with no member-number column: matched by email, the list's member number kept",
      before: [{ fullName: "Ella Hart", email: "ella.hart@example.com", phone: "+447700900701", memberNumber: "ZP-77" }],
      file: [{ fullName: "Ella Hart", email: "ella.hart@example.com", phone: "+447700900799" }],
      carries: noNumberColumn,
      expect: ["Ella Hart → Ella Hart"],
      gone: [],
      fields: { phone: 1 },
    },
    {
      name: "a file with no email column: matched by phone and name, the list's email kept",
      before: [{ fullName: "Rahul Verma", email: "rahul@example.com", phone: "+919812345678" }],
      file: [{ fullName: "Rahul Verma", phone: "+919812345678", memberNumber: "R-1" }],
      carries: noEmailColumn,
      expect: ["Rahul Verma → Rahul Verma"],
      gone: [],
      fields: { memberNumber: 1 },
    },
    {
      name: "a file with no email column: a phone never joins a different name, even a corrected spelling",
      before: [{ fullName: "Rahul Verma", email: "rahul@example.com", phone: "+919812345678" }],
      file: [{ fullName: "Rahul Varma", phone: "+919812345678" }],
      carries: noEmailColumn,
      expect: ["Rahul Varma → new"],
      gone: ["Rahul Verma"],
    },
    {
      name: "a person with no email in the file, the list holding their email: the phone matches",
      before: [{ fullName: "Rahul Verma", email: "rahul@example.com", phone: "+919812345678" }],
      file: [{ fullName: "Rahul Verma", phone: "+919812345678" }],
      expect: ["Rahul Verma → Rahul Verma"],
      gone: [],
      fields: { email: 1 },
    },
    {
      name: "a phone number reassigned to a new subscriber, who joins the gym with an email: a new person",
      before: [{ fullName: "Kate Moss", email: "kate.m@example.com", phone: "+447700900801" }],
      file: [{ fullName: "Dan Frost", email: "dan.f@example.com", phone: "+447700900801" }],
      expect: ["Dan Frost → new"],
      gone: ["Kate Moss"],
    },
    {
      name: "a strong match later in the file is not beaten by a weaker one earlier",
      before: [{ fullName: "Olivia Bennett", email: "bennett@example.com", memberNumber: "M-9" }],
      file: [
        { fullName: "Ruby Bennett", email: "bennett@example.com" },
        { fullName: "Olivia Bennett", email: "bennett@example.com", memberNumber: "M-9" },
      ],
      expect: ["Ruby Bennett → new", "Olivia Bennett → Olivia Bennett"],
      gone: [],
    },
    {
      name: "a corrected date of birth, everything else the same, is an update",
      before: [{ fullName: "Ivy Chen", email: "ivy@example.com", dateOfBirth: "1990-01-02" }],
      file: [{ fullName: "Ivy Chen", email: "ivy@example.com", dateOfBirth: "1990-02-01" }],
      expect: ["Ivy Chen → Ivy Chen"],
      gone: [],
      fields: { dateOfBirth: 1 },
    },
    {
      name: "a different date of birth AND a different phone on one address is two people (a split, never a wrong join)",
      before: [{ fullName: "Ivy Chen", email: "chen@example.com", phone: "+447700900901", dateOfBirth: "1990-01-02" }],
      file: [{ fullName: "Ivy Chen", email: "chen@example.com", phone: "+447700900902", dateOfBirth: "2012-06-30" }],
      expect: ["Ivy Chen → new"],
      gone: ["Ivy Chen"],
    },
    {
      name: "without a date-of-birth column, a lone new name on a lone address is the same person, and says the name changed",
      before: [{ fullName: "Priya Shah", email: "shah.family@example.com", dateOfBirth: "1981-05-14" }],
      file: [{ fullName: "Meera Shah", email: "shah.family@example.com" }],
      carries: noBirthColumn,
      expect: ["Meera Shah → Priya Shah"],
      gone: [],
      fields: { fullName: 1 },
    },
    {
      name: "somebody nobody has heard of, beside everybody unchanged",
      before: [{ fullName: "Tom Reed", email: "tom@example.com" }],
      file: [
        { fullName: "Tom Reed", email: "tom@example.com" },
        { fullName: "Zoë Müller", email: "zoe@example.com" },
      ],
      expect: ["Tom Reed → Tom Reed", "Zoë Müller → new"],
      gone: [],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const carries = c.carries ?? ALL;
      const entries = c.before.map((who) => entry(who));
      const out = run(
        c.file.map((who, i) => row(i + 2, who, carries)),
        entries,
        { carries, mode: c.mode ?? "whole_list" },
      );
      expect(pairs(out, entries)).toEqual(c.expect);
      expect(out.gone.map((p) => p.fullName)).toEqual(c.gone);
      expect(Object.fromEntries(out.fieldChanges.map((f) => [f.field, f.count]))).toEqual(c.fields ?? {});
    });
  }
});

describe("the same person next month: the record the upload writes", () => {
  it("a field the file has no column for is kept from the record, and the new key is built from what is written", () => {
    const before = entry({ fullName: "Ella Hart", email: "ella@example.com", phone: "+447700900701", memberNumber: "ZP-77" });
    const carries: CarriedFields = { ...ALL, memberNumber: false };
    const out = run([row(2, { fullName: "Ella Hart", email: "ella.hart@example.com", phone: "+447700900701" }, carries)], [before], { carries });
    expect(out.changed[0]?.identityKey).toBe(identityKey({ fullName: "Ella Hart", email: "ella.hart@example.com", phone: "+447700900701", memberNumber: "ZP-77" }));
  });

  it("no two records ever end up with one key, whatever the month brings", () => {
    const entries = [
      entry({ fullName: "Priya Shah", email: "shah@example.com", phone: "+447700900601" }),
      entry({ fullName: "Arjun Shah", email: "shah@example.com", phone: "+447700900602" }),
      entry({ fullName: "Tom Reed", email: "tom@example.com", memberNumber: "M-1" }),
      entry({ fullName: "Tom Reed", email: "tom@example.com", memberNumber: "M-1", phone: "+447700900111" }, { former: true }),
      entry({ fullName: "Kate Moss", phone: "+447700900801" }),
    ];
    const out = run(
      [
        row(2, { fullName: "Arjun Shah", email: "shah@example.com", phone: "+447700900698" }),
        row(3, { fullName: "Tom Reed", email: "tom@example.com", memberNumber: "M-1", phone: "+447700900111" }),
        row(4, { fullName: "Tom Reed", email: "tom.reed@example.com", memberNumber: "M-1" }),
        row(5, { fullName: "Kate Moss", email: "kate@example.com", phone: "+447700900801" }),
      ],
      entries,
    );
    const after = new Map<string, string>(entries.map((e) => [e.identityKey, e.identityKey]));
    for (const p of [...out.changed, ...out.returning, ...out.unchanged]) {
      if (p.entryKey === null) throw new Error("a matched person without a record");
      after.set(p.entryKey, p.identityKey);
    }
    const keys = [...after.values(), ...out.added.map((p) => p.identityKey)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a returning former record found by its email is revived, not added again", () => {
    const before = entry(olivia, { former: true });
    const out = run([row(2, { ...olivia, phone: "+447700900999" })], [before]);
    expect(out.counts).toMatchObject({ new: 1, returning: 1, gone: 0 });
    expect(out.returning[0]?.entryKey).toBe(before.identityKey);
  });

  it("a current record is offered before a former one holding the same address", () => {
    const former = entry({ fullName: "Olivia Smyth", email: "olivia@example.com" }, { former: true });
    const current = entry({ fullName: "Olivia Smith", email: "olivia@example.com", phone: "+447700900101" });
    const out = run([row(2, { fullName: "Olivia Smith", email: "olivia@example.com", phone: "+447700900102" })], [former, current]);
    expect(out.changed[0]?.entryKey).toBe(current.identityKey);
  });

  it("a phone staff corrected by hand is asked about before the file writes over it", () => {
    const before = entry(olivia, { handEdited: ["phone"] });
    const out = run([row(2, { ...olivia, phone: "+447700900999" })], [before]);
    expect(out.handEdits).toEqual({ entries: 1, fields: ["phone number"] });
    expect(out.changed[0]?.moved).toEqual(["phone"]);
  });

  it("matchRows alone pairs one row with one record at most", () => {
    const e = entry({ fullName: "Tom Reed", email: "tom@example.com" });
    const matches = matchRows(
      [row(2, { fullName: "Tom Reed", email: "tom@example.com", phone: "+447700900001" }), row(3, { fullName: "Tom Reed", email: "tom@example.com", phone: "+447700900002" })],
      [e],
      ALL,
      true,
    );
    expect(matches.filter((m) => m !== null)).toHaveLength(1);
  });
});

describe("the same person next month: 5a's second month, the case that found it", () => {
  // 20 people; next month two have new phones, one a new email, one a corrected
  // spelling, three joined and two left. Before 3a-vi this read 7 new and 6 missing.
  const people = Array.from({ length: 20 }, (_, i) => ({
    fullName: `Member ${["Ava", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jin", "Kai", "Lea", "Max", "Nia", "Oto", "Pia", "Quin", "Ros", "Sol", "Tia"][i] ?? "X"} Grey`,
    email: `m${String(i)}@example.com`,
    phone: `+4477009${String(10000 + i).slice(1)}`,
    memberNumber: null,
  }));
  it("reads 3 new, 2 left, and 4 changed: phone 2, email 1, name 1", () => {
    const entries = people.map((who) => entry(who));
    const next: Who[] = people.slice(2).map((who, i) => {
      if (i === 0) return { ...who, phone: "+447700999001" };
      if (i === 1) return { ...who, phone: "+447700999002" };
      if (i === 2) return { ...who, email: "new.address@example.com" };
      if (i === 3) return { ...who, fullName: who.fullName.replace("Grey", "Gray") };
      return who;
    });
    next.push({ fullName: "New One", email: "new1@example.com" }, { fullName: "New Two", email: "new2@example.com" }, { fullName: "New Three", phone: "+447700999003" });
    const out = run(next.map((who, i) => row(i + 2, who)), entries);
    expect(out.counts).toMatchObject({ new: 3, gone: 2, changed: 4, unchanged: 14 });
    expect(Object.fromEntries(out.fieldChanges.map((f) => [f.field, f.count]))).toEqual({ phone: 2, email: 1, fullName: 1 });
  });
});
