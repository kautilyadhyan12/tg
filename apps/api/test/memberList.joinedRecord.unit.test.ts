// An app member follows their record (ROADMAP 3a-vi-b; RULINGS 2026-09-25): a member
// who joined by invitation is the record that invitation was for, before their email
// or phone.
//
// The cases are the ruling's own and 3a-vi's outside ones: the gym's software gives a
// member a new email (the ruling's example); a family on one parent's address
// (PushPress: a sub-account "will share the same email as the Parent Account"; zingFit:
// "family accounts where all family members are given one parent's address"), where the
// parent leaves and the child stays.
import { describe, expect, it } from "vitest";
import type { MemberListRow } from "@app/shared";
import { identityKey } from "../src/modules/orgs/memberList/fields.js";
import {
  onListOf,
  reconcile,
  type CarriedFields,
  type ListEntry,
  type ListMember,
  type MemberMark,
  type Reconciled,
} from "../src/modules/orgs/memberList/reconcile.js";

interface Who {
  fullName: string;
  email?: string | null;
  phone?: string | null;
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

const fieldsOf = (who: Who) => ({ fullName: who.fullName, email: who.email ?? null, phone: who.phone ?? null, memberNumber: null });

const row = (at: number, who: Who): MemberListRow => ({
  row: at,
  ...fieldsOf(who),
  status: "Active",
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  paymentStatus: null,
  dateOfBirth: who.dateOfBirth ?? null,
  extra: [],
  identityKey: identityKey(fieldsOf(who)),
});

const entry = (id: string, who: Who, over: Partial<ListEntry> = {}): ListEntry => ({
  id,
  identityKey: identityKey(fieldsOf(who)),
  ...fieldsOf(who),
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
});

const member = (userId: string, over: Partial<ListMember> = {}): ListMember => ({
  userId,
  fullName: userId,
  email: null,
  statedPhone: null,
  everListed: true,
  seatCounted: true,
  joinedEntryId: null,
  ...over,
});

const run = (input: { rows: MemberListRow[]; entries: ListEntry[]; members: ListMember[]; mode?: "whole_list" | "add" }): Reconciled =>
  reconcile({ keptFields: [], carries: ALL, endsOnKind: null, mode: input.mode ?? "whole_list", hasList: true, ...input });

const markOf = (out: Reconciled, userId: string): { mark: MemberMark; leaving: boolean } | undefined => {
  const found = out.marks.find((mark) => mark.userId === userId);
  return found === undefined ? undefined : { mark: found.mark, leaving: found.leaving };
};

const emma: Who = { fullName: "Emma Clarke", email: "emma.clarke@example.com", phone: "+447700900101" };
const emmaNewEmail: Who = { ...emma, email: "e.clarke@example.com" };
const priya: Who = { fullName: "Priya Shah", email: "shah.family@example.com", phone: "+447700900201", dateOfBirth: "1981-05-14" };
const arjun: Who = { fullName: "Arjun Shah", email: "shah.family@example.com", phone: "+447700900202", dateOfBirth: "2009-09-02" };

describe("an app member follows the record they joined with", () => {
  it("the worst thing: Emma, whose email the gym's software changed, stays on the list and is not leaving", () => {
    const out = run({
      rows: [row(2, emmaNewEmail)],
      entries: [entry("r-emma", emma)],
      // Her account keeps the address she joined with.
      members: [member("u-emma", { email: emma.email ?? null, joinedEntryId: "r-emma" })],
    });
    expect(out.counts).toMatchObject({ new: 0, changed: 1, gone: 0 });
    expect(markOf(out, "u-emma")).toEqual({ mark: "on_list", leaving: false });
    expect(out.members).toEqual({ leaving: 0, listedNow: 1 });
    expect(out.membersLeaving).toEqual([]);
    // Her row reads "in the app", so Invite does not email her new address.
    expect(out.changed[0]?.inApp).toBe(true);
    expect(out.onEitherList).toEqual(["u-emma"]);
  });

  it("the worst thing: a parent whose own record comes off is leaving, though their child stays listed on the same address", () => {
    const out = run({
      rows: [row(2, arjun)],
      entries: [entry("r-priya", priya)],
      members: [member("u-priya", { email: priya.email ?? null, joinedEntryId: "r-priya" })],
    });
    // 3a-vi parts them on the date of birth: Arjun is new, Priya's record goes.
    expect(out.counts).toMatchObject({ new: 1, gone: 1 });
    expect(markOf(out, "u-priya")).toEqual({ mark: "no_longer_listed", leaving: true });
    expect(out.members).toEqual({ leaving: 1, listedNow: 1 });
    expect(out.membersLeaving.map((person) => person.email)).toEqual([priya.email]);
  });

  // Every class of member against every fate of the list, in one table.
  const cases: {
    label: string;
    rows: MemberListRow[];
    entries: ListEntry[];
    member: Partial<ListMember>;
    mode?: "whole_list" | "add";
    expect: { mark: MemberMark; leaving: boolean };
  }[] = [
    {
      label: "joined, record in the file unchanged",
      rows: [row(2, emma)],
      entries: [entry("r1", emma)],
      member: { email: emma.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "joined, a new email AND a new phone with only the name the same: 3a-vi cannot tell it is her, so the record goes and she with it",
      rows: [row(2, { ...emmaNewEmail, phone: "+447700900999" })],
      entries: [entry("r1", emma)],
      member: { email: emma.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "no_longer_listed", leaving: true },
    },
    {
      label: "joined, another name on her lone old address is read as her record renamed (RULINGS 2026-09-25 (3)), and she follows the record",
      rows: [row(2, { ...emmaNewEmail, phone: "+447700900999" }), row(3, { fullName: "Someone Else", email: emma.email ?? null })],
      entries: [entry("r1", emma)],
      member: { email: emma.email ?? null, joinedEntryId: "r1" },
      // The roster then shows "On your list as Someone Else" with "Check this is them"
      // (3b-ii-b's name check): the same answer she had by address before this job.
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "joined, record gone, a row on the member's own email under another name and another date of birth",
      rows: [row(2, arjun)],
      entries: [entry("r1", priya)],
      member: { email: priya.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "no_longer_listed", leaving: true },
    },
    {
      label: "joined, record gone, a relative's CURRENT record on the same email stays",
      rows: [row(2, arjun)],
      entries: [entry("r1", priya), entry("r2", arjun)],
      member: { email: priya.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "no_longer_listed", leaving: true },
    },
    {
      label: "joined, record already former and not in the file",
      rows: [row(2, arjun)],
      entries: [entry("r1", priya, { former: true }), entry("r2", arjun)],
      member: { email: priya.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "no_longer_listed", leaving: false },
    },
    {
      label: "joined, record former, the file brings it back",
      rows: [row(2, priya)],
      entries: [entry("r1", priya, { former: true })],
      member: { email: priya.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "joined, an add that does not mention the record keeps it",
      rows: [row(2, arjun)],
      entries: [entry("r1", priya)],
      member: { email: "someone.else@example.com", joinedEntryId: "r1" },
      mode: "add",
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "joined, an add while the record is former leaves them off, though a listed relative shares the address",
      rows: [row(2, { fullName: "Mia Shah", email: priya.email ?? null })],
      entries: [entry("r1", priya, { former: true }), entry("r2", arjun)],
      member: { email: priya.email ?? null, joinedEntryId: "r1" },
      mode: "add",
      expect: { mark: "no_longer_listed", leaving: false },
    },
    {
      label: "not joined by invitation, email in the file: on, as before",
      rows: [row(2, emma)],
      entries: [entry("r1", emma)],
      member: { email: emma.email ?? null },
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "not joined by invitation, record's email changed: off, as before (nothing ties them to it)",
      rows: [row(2, emmaNewEmail)],
      entries: [entry("r1", emma)],
      member: { email: emma.email ?? null },
      expect: { mark: "no_longer_listed", leaving: true },
    },
    {
      label: "not joined by invitation, family address: on through whichever record holds it, as before",
      rows: [row(2, arjun)],
      entries: [entry("r1", priya)],
      member: { email: priya.email ?? null },
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "joined, but the record was deleted (the link is cleared): matched by email again",
      rows: [row(2, emma)],
      entries: [],
      member: { email: emma.email ?? null, joinedEntryId: null },
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "joined, never on a list before this one: still decided by the record",
      rows: [row(2, emmaNewEmail)],
      entries: [entry("r1", emma)],
      member: { email: emma.email ?? null, joinedEntryId: "r1", everListed: false },
      expect: { mark: "on_list", leaving: false },
    },
  ];

  // Round one, H1: staff take Emma's record off and type her back in by hand (her own
  // email, a new phone). The reviewer ran it on the real routes: she was named for Remove
  // all, and "Put back on list" made two of her.
  const emmaTyped: Who = { ...emma, phone: "+447700900999" };
  cases.push(
    {
      label: "H1: joined record former, staff typed her back in with her own email and name: on, not leaving",
      rows: [row(2, emmaTyped)],
      entries: [entry("r1", emma, { former: true }), entry("r2", emmaTyped)],
      member: { email: emma.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "H1: the typed-in record written 'Clarke, Emma' is the same name",
      rows: [row(2, { ...emmaTyped, fullName: "Clarke, Emma" })],
      entries: [entry("r1", emma, { former: true }), entry("r2", { ...emmaTyped, fullName: "Clarke, Emma" })],
      member: { email: emma.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "H1: the typed-in record on her phone only, same name: on",
      rows: [row(2, { fullName: "Emma Clarke", phone: "+447700900101" })],
      entries: [entry("r1", emma, { former: true }), entry("r2", { fullName: "Emma Clarke", phone: "+447700900101" })],
      member: { email: emma.email ?? null, statedPhone: "+447700900101", joinedEntryId: "r1" },
      expect: { mark: "on_list", leaving: false },
    },
    {
      label: "H1: typed back in, and next month's file drops that record too: leaving",
      rows: [row(2, arjun)],
      entries: [entry("r1", emma, { former: true }), entry("r2", emmaTyped)],
      member: { email: emma.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "no_longer_listed", leaving: true },
    },
    {
      label: "H1: two current records of her, the file keeps only the typed one: still on through the name",
      rows: [row(2, emmaTyped)],
      entries: [entry("r1", emma), entry("r2", emmaTyped)],
      member: { email: emma.email ?? null, joinedEntryId: "r1" },
      expect: { mark: "on_list", leaving: false },
    },
  );

  for (const c of cases) {
    it(c.label, () => {
      const out = run({ rows: c.rows, entries: c.entries, members: [member("u1", c.member)], ...(c.mode === undefined ? {} : { mode: c.mode }) });
      expect(markOf(out, "u1")).toEqual(c.expect);
    });
  }

  it("today's list, read with no rows: a joined member reads by their record whatever their email says", () => {
    const entries = [entry("r-emma", emmaNewEmail), entry("r-priya", priya, { former: true }), entry("r-arjun", arjun)];
    const out = run({
      rows: [],
      entries,
      members: [
        member("u-emma", { email: emma.email ?? null, joinedEntryId: "r-emma" }),
        member("u-priya", { email: priya.email ?? null, joinedEntryId: "r-priya" }),
      ],
      mode: "add",
    });
    expect(markOf(out, "u-emma")).toEqual({ mark: "on_list", leaving: false });
    expect(markOf(out, "u-priya")).toEqual({ mark: "no_longer_listed", leaving: false });
    expect(out.members).toEqual({ leaving: 0, listedNow: 1 });
  });

  it("H1 on today's list: the typed-in Emma holds her, a relative on her address does not", () => {
    const out = run({
      rows: [],
      entries: [entry("r-emma", emma, { former: true }), entry("r-typed", { ...emma, phone: "+447700900999" }), entry("r-priya", priya, { former: true }), entry("r-arjun", arjun)],
      members: [
        member("u-emma", { email: emma.email ?? null, joinedEntryId: "r-emma" }),
        member("u-priya", { email: priya.email ?? null, joinedEntryId: "r-priya" }),
      ],
      mode: "add",
    });
    expect(markOf(out, "u-emma")).toEqual({ mark: "on_list", leaving: false });
    expect(markOf(out, "u-priya")).toEqual({ mark: "no_longer_listed", leaving: false });
  });

  it("the owner who joined with a record is never marked, and still makes the record's row read 'in the app'", () => {
    const out = run({
      rows: [row(2, emmaNewEmail)],
      entries: [entry("r1", emma)],
      members: [member("u-owner", { email: "owner@example.com", joinedEntryId: "r1", seatCounted: false })],
    });
    expect(out.marks).toEqual([]);
    expect(out.changed[0]?.inApp).toBe(true);
  });

  it("a row on a joined member's old address still reads 'in the app' by address, as before", () => {
    const out = run({
      rows: [row(2, arjun)],
      entries: [entry("r1", priya)],
      members: [member("u-priya", { email: priya.email ?? null, joinedEntryId: "r1" })],
    });
    expect(out.new[0]?.inApp).toBe(true);
    // ...and a row nobody reaches does not.
    const none = run({ rows: [row(2, { fullName: "Nia Cole", email: "nia@example.com" })], entries: [], members: [] });
    expect(none.new[0]?.inApp).toBe(false);
  });

  it("every row and record carries the id of the record it is, for the read that follows", () => {
    const out = run({
      rows: [row(2, emmaNewEmail), row(3, arjun)],
      entries: [entry("r-emma", emma), entry("r-priya", priya)],
      members: [],
    });
    expect(out.changed.map((person) => person.entryId)).toEqual(["r-emma"]);
    expect(out.new.map((person) => person.entryId)).toEqual([null]);
    expect(out.gone.map((person) => person.entryId)).toEqual(["r-priya"]);
  });
});

describe("onListOf", () => {
  const yes = () => true;
  const no = () => false;
  const emmaRecord = { id: "r1", fullName: "Emma Clarke" };
  it("a joined member is on while the list holds their record", () => {
    expect(onListOf(emmaRecord, (id) => id === "r1", no)).toBe(true);
  });
  it("once it has not, only a contact match carrying that record's name counts", () => {
    const asked: (string | null)[] = [];
    expect(onListOf(emmaRecord, no, (name) => (asked.push(name), name === "Emma Clarke"))).toBe(true);
    expect(asked).toEqual(["Emma Clarke"]);
    expect(onListOf(emmaRecord, no, (name) => name === null)).toBe(false);
  });
  it("a member with no record is answered by any contact match", () => {
    expect(onListOf(null, yes, (name) => name === null)).toBe(true);
    expect(onListOf(null, yes, no)).toBe(false);
  });
});
