// WHAT AN UPLOAD WOULD DO TO A GYM'S LIST — the table test for the ONE pure rule
// (Part 3 §9.7, §9.10; CLAUDE.md §4: "a rule that picks, ranks or thresholds ships
// with a table test over every class of case BEFORE review").
//
// **THE RULE DECIDES SOMETHING ABOUT A PERSON, so the cases are classes and not
// examples** (RULINGS 2026-09-20). What it decides is whether a member of this gym
// is about to be marked as having dropped off its list — and, through the guard,
// whether a wrong file goes through silently. Every case below is one class of
// that, named for what it would do to somebody if it were wrong.
//
// **THE IDENTITY KEYS ARE THE REAL ONES.** They come from `identityKey`, the
// function the reader uses, rather than from hand-written hex: a table built on
// invented keys would pass while the real key included the status, which is the
// one thing it must not (a person going from "Active" to "Expired" is a change in
// place, not a person gone and a person arrived).
import { describe, expect, it } from "vitest";
import { isLargeMemberListChange, type MemberListRow } from "@app/shared";
import { identityKey } from "../src/modules/orgs/memberList/fields.js";
import { reconcile, type ListEntry, type ListMember } from "../src/modules/orgs/memberList/reconcile.js";

interface Person {
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
}

const person = (over: Partial<Person> & { fullName: string }): Person => ({
  email: null,
  phone: null,
  memberNumber: null,
  ...over,
});

/** A row of the file, at a row number, with the gym's own status word. */
const row = (at: number, who: Person, status: string | null): MemberListRow => ({
  row: at,
  fullName: who.fullName,
  email: who.email,
  phone: who.phone,
  memberNumber: who.memberNumber,
  status,
  identityKey: identityKey(who),
});

/** The same person, already on the list. */
const entry = (who: Person, status: string | null): ListEntry => ({
  identityKey: identityKey(who),
  fullName: who.fullName,
  email: who.email,
  phone: who.phone,
  memberNumber: who.memberNumber,
  status,
});

const member = (over: Partial<ListMember> & { userId: string }): ListMember => ({
  fullName: `Member ${over.userId}`,
  email: null,
  statedPhone: null,
  everListed: false,
  // A paid seat unless a case says otherwise, which is what every case here was
  // written against; the owner-and-staff case sets it false explicitly.
  seatCounted: true,
  ...over,
});

const ann = person({ fullName: "Ann Lee", email: "ann@gym.com" });
const bob = person({ fullName: "Bob Ray", email: "bob@gym.com" });
const cal = person({ fullName: "Cal Fox", phone: "+447911123456" });

describe("reconcile: what an upload would do to the list", () => {
  it("a gym with no list has no new people and no marks — everything is new, nobody has dropped off", () => {
    const out = reconcile({
      rows: [row(2, ann, "Active"), row(3, bob, "Frozen")],
      entries: [],
      members: [member({ userId: "u1", email: "ann@gym.com" })],
      mode: "whole_list",
      hasList: false,
    });
    expect(out.counts).toEqual({ new: 2, changed: 0, unchanged: 0, gone: 0, alreadyInApp: 1, canBeInvited: 1, noEmail: 0 });
    // NOT ONE MARK. A gym that has never confirmed a list has nothing for anybody
    // to be missing from, so "never listed" beside every member would be an
    // accusation about nobody (§9.7).
    expect(out.marks).toEqual([]);
    expect(out.members).toEqual({ leaving: 0, listedNow: 0 });
  });

  // -------------------------------------------------------------------------
  // WHO IS NEW, CHANGED, UNCHANGED, GONE
  // -------------------------------------------------------------------------

  const cases: {
    label: string;
    rows: MemberListRow[];
    entries: ListEntry[];
    mode: "whole_list" | "add";
    expect: { new: number; changed: number; unchanged: number; gone: number };
  }[] = [
    {
      label: "a status that changed is the SAME person, changed in place",
      rows: [row(2, ann, "Frozen")],
      entries: [entry(ann, "Active")],
      mode: "whole_list",
      expect: { new: 0, changed: 1, unchanged: 0, gone: 0 },
    },
    {
      label: "the same status in another case is no change at all (two exports of one gym)",
      rows: [row(2, ann, "ACTIVE")],
      entries: [entry(ann, "Active")],
      mode: "whole_list",
      expect: { new: 0, changed: 0, unchanged: 1, gone: 0 },
    },
    {
      label: "a status that gained or lost spaces is no change",
      rows: [row(2, ann, "  Active ")],
      entries: [entry(ann, "Active")],
      mode: "whole_list",
      expect: { new: 0, changed: 0, unchanged: 1, gone: 0 },
    },
    {
      label: "no status against no status is no change (an empty cell and a missing column are one thing)",
      rows: [row(2, ann, "")],
      entries: [entry(ann, null)],
      mode: "whole_list",
      expect: { new: 0, changed: 0, unchanged: 1, gone: 0 },
    },
    {
      label: "a status where there was none IS a change",
      rows: [row(2, ann, "Active")],
      entries: [entry(ann, null)],
      mode: "whole_list",
      expect: { new: 0, changed: 1, unchanged: 0, gone: 0 },
    },
    {
      label: "somebody on the list and not in the file comes off",
      rows: [row(2, ann, "Active")],
      entries: [entry(ann, "Active"), entry(bob, "Active")],
      mode: "whole_list",
      expect: { new: 0, changed: 0, unchanged: 1, gone: 1 },
    },
    {
      label: "an ADD takes nobody off, whoever is missing from it",
      rows: [row(2, ann, "Active")],
      entries: [entry(ann, "Active"), entry(bob, "Active")],
      mode: "add",
      expect: { new: 0, changed: 0, unchanged: 1, gone: 0 },
    },
    {
      label: "an ADD still changes a status it carries",
      rows: [row(2, ann, "Frozen")],
      entries: [entry(ann, "Active"), entry(bob, "Active")],
      mode: "add",
      expect: { new: 0, changed: 1, unchanged: 0, gone: 0 },
    },
    {
      label: "an empty WHOLE LIST empties the list — a real answer, and the guard's business",
      rows: [],
      entries: [entry(ann, "Active"), entry(bob, "Active")],
      mode: "whole_list",
      expect: { new: 0, changed: 0, unchanged: 0, gone: 2 },
    },
    {
      label: "an empty ADD does nothing",
      rows: [],
      entries: [entry(ann, "Active")],
      mode: "add",
      expect: { new: 0, changed: 0, unchanged: 0, gone: 0 },
    },
    {
      label: "a person twice in one file is one person (the reader skips them; this is the backstop)",
      rows: [row(2, ann, "Active"), row(3, ann, "Frozen")],
      entries: [],
      mode: "whole_list",
      expect: { new: 1, changed: 0, unchanged: 0, gone: 0 },
    },
    {
      label: "a member number is part of WHO somebody is: the same name and address under two numbers is two people",
      rows: [
        row(2, person({ fullName: "Ann Lee", email: "ann@gym.com", memberNumber: "1" }), "Active"),
        row(3, person({ fullName: "Ann Lee", email: "ann@gym.com", memberNumber: "2" }), "Active"),
      ],
      entries: [],
      mode: "whole_list",
      expect: { new: 2, changed: 0, unchanged: 0, gone: 0 },
    },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const out = reconcile({ rows: c.rows, entries: c.entries, members: [], mode: c.mode, hasList: true });
      expect({
        new: out.counts.new,
        changed: out.counts.changed,
        unchanged: out.counts.unchanged,
        gone: out.counts.gone,
      }).toEqual(c.expect);
      // The groups and the counts are two views of one answer and must never
      // disagree: a screen shows one and pages through the other.
      expect(out.new).toHaveLength(c.expect.new);
      expect(out.changed).toHaveLength(c.expect.changed);
      expect(out.unchanged).toHaveLength(c.expect.unchanged);
      expect(out.gone).toHaveLength(c.expect.gone);
    });
  }

  it("the places it reports count into the rows IT kept, not the rows it was given", () => {
    // Understanding a file already drops a row whose person is on an earlier one, so
    // this can only happen if that ever changes — but the two must not be able to come
    // apart quietly, because a place that counts into the wrong array names the wrong
    // person on a screen. The rule hands back the rows its places belong to, and the
    // upload stores THOSE.
    const out = reconcile({
      rows: [row(2, ann, "Active"), row(3, ann, "Frozen"), row(4, bob, "Active")],
      entries: [],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.rows.map((r) => r.row)).toEqual([2, 4]);
    expect(out.new.map((p) => p.at)).toEqual([0, 1]);
    for (const person of out.new) {
      expect(out.rows[person.at ?? -1]?.identityKey).toBe(person.identityKey);
    }
    // Nobody outside the file has a place at all.
    const leaving = reconcile({
      rows: [],
      entries: [entry(ann, "Active")],
      members: [member({ userId: "u1", email: "ann@gym.com" })],
      mode: "whole_list",
      hasList: true,
    });
    expect(leaving.gone.map((p) => p.at)).toEqual([null]);
    expect(leaving.membersLeaving.map((p) => p.at)).toEqual([null]);
  });

  // -------------------------------------------------------------------------
  // WHO CAN BE INVITED — the split under `new`
  // -------------------------------------------------------------------------

  it("of the new people: already in the app · could be invited · no email", () => {
    const out = reconcile({
      rows: [row(2, ann, "Active"), row(3, bob, "Active"), row(4, cal, "Active")],
      entries: [],
      members: [member({ userId: "u1", email: "ann@gym.com" })],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.counts.alreadyInApp).toBe(1); // Ann
    expect(out.counts.canBeInvited).toBe(1); // Bob: an address, not in the app
    expect(out.counts.noEmail).toBe(1); // Cal: phone only, so nobody can be invited
    // The three add up to `new`, always — a screen prints them as a breakdown.
    expect(out.counts.alreadyInApp + out.counts.canBeInvited + out.counts.noEmail).toBe(out.counts.new);
  });

  it("an app member is matched by their address WHATEVER THE CASE either side wrote it in", () => {
    const shouty = person({ fullName: "Ann Lee", email: "ANN@GYM.COM" });
    const out = reconcile({
      rows: [row(2, shouty, "Active")],
      entries: [],
      members: [member({ userId: "u1", email: "ann@gym.com" })],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.counts.alreadyInApp).toBe(1);
    expect(out.new[0]?.inApp).toBe(true);
  });

  it("an app member with NO verified address is matched by nothing, and is not counted as in the app", () => {
    // The unverified case arrives here as a null email (the repo's CASE), and this
    // is what makes that null safe: a person who typed somebody else's address into
    // their own account must not be read as that somebody.
    const out = reconcile({
      rows: [row(2, ann, "Active")],
      entries: [],
      members: [member({ userId: "u1", email: null })],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.counts.alreadyInApp).toBe(0);
    expect(out.counts.canBeInvited).toBe(1);
  });

  it("a member with no address is matched by the phone number they gave the gym", () => {
    const out = reconcile({
      rows: [row(2, cal, "Active")],
      entries: [],
      members: [member({ userId: "u1", statedPhone: "+447911123456" })],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.new[0]?.inApp).toBe(true);
    // Still nobody to invite: matching is not an address.
    expect(out.counts.noEmail).toBe(1);
    expect(out.counts.canBeInvited).toBe(0);
  });

  it("a member the list holds TWICE is theirs by address first, and by phone only as the backup", () => {
    // §9.7's order, and the tie-break the database had to be taught as well: this member
    // is reachable both ways, and the two entries say different things about them. The
    // PHONE entry is the older one, so anything that picks by age alone picks it — and
    // then shows staff "Frozen, OLD-1" for somebody the list calls "Active, NEW-2".
    const greta = person({ fullName: "Greta Olsen", email: "greta@gym.com", phone: "+447911000111" });
    const byPhone = { ...entry(person({ fullName: "Greta (phone row)", phone: "+447911000111" }), "Frozen"), memberNumber: "OLD-1" };
    const byEmail = { ...entry(person({ fullName: "Greta (email row)", email: "greta@gym.com" }), "Active"), memberNumber: "NEW-2" };
    const out = reconcile({
      rows: [],
      entries: [byPhone, byEmail],
      members: [member({ userId: "u1", email: greta.email, statedPhone: greta.phone })],
      mode: "whole_list",
      hasList: true,
    });
    // The file holds nobody, so she is leaving — shown with what the list says about
    // her, which must be her ADDRESS entry's words, not her phone entry's.
    expect(out.membersLeaving.map((p) => [p.wasStatus, p.memberNumber])).toEqual([["Active", "NEW-2"]]);
  });

  // -------------------------------------------------------------------------
  // THE MARKS — the one thing staff act on, and the one that accuses somebody
  // -------------------------------------------------------------------------

  it("on the list · dropped off it · never on it", () => {
    const out = reconcile({
      rows: [row(2, ann, "Active")],
      entries: [entry(ann, "Active"), entry(bob, "Active")],
      members: [
        member({ userId: "on", email: "ann@gym.com" }),
        member({ userId: "off", email: "bob@gym.com" }),
        member({ userId: "never", email: "zoe@gym.com" }),
      ],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.marks).toEqual([
      { userId: "on", mark: "on_list", leaving: false },
      { userId: "off", mark: "no_longer_listed", leaving: true },
      { userId: "never", mark: "never_listed", leaving: false },
    ]);
    expect(out.members).toEqual({ leaving: 1, listedNow: 2 });
    // The leaving member is shown with what the list STILL says about them, so
    // staff can judge whether the file is wrong or the person really has left.
    expect(out.membersLeaving).toEqual([
      expect.objectContaining({ fullName: "Member off", wasStatus: "Active", row: null, inApp: true }),
    ]);
  });

  it("somebody who ALREADY dropped off is not leaving again", () => {
    const out = reconcile({
      rows: [row(2, ann, "Active")],
      entries: [entry(ann, "Active")],
      members: [member({ userId: "long-gone", email: "bob@gym.com", everListed: true })],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.marks).toEqual([{ userId: "long-gone", mark: "no_longer_listed", leaving: false }]);
    // Which is what keeps them out of the guard's numbers: they left long ago, and
    // this file is not what did it.
    expect(out.members).toEqual({ leaving: 0, listedNow: 0 });
  });

  it("listed, dropped, then BACK on a later file reads as on the list again", () => {
    const out = reconcile({
      rows: [row(2, ann, "Active")],
      entries: [],
      members: [member({ userId: "u1", email: "ann@gym.com", everListed: true })],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.marks).toEqual([{ userId: "u1", mark: "on_list", leaving: false }]);
  });

  it("an ADD flags NOBODY, however few people it holds", () => {
    const out = reconcile({
      rows: [],
      entries: [entry(ann, "Active"), entry(bob, "Active")],
      members: [member({ userId: "u1", email: "ann@gym.com" }), member({ userId: "u2", email: "bob@gym.com" })],
      mode: "add",
      hasList: true,
    });
    expect(out.marks.every((m) => m.mark === "on_list" && !m.leaving)).toBe(true);
    expect(out.members).toEqual({ leaving: 0, listedNow: 2 });
    expect(out.guard.needsTick).toBe(false);
    expect(out.guard.mostOfListWouldGo).toBe(false);
  });

  it("a family sharing ONE address: everybody is kept, and the member among them is on the list", () => {
    const dadEntry = entry(person({ fullName: "Dad Fox", email: "fox@gym.com" }), "Active");
    const kidEntry = entry(person({ fullName: "Kid Fox", email: "fox@gym.com" }), "Active");
    const out = reconcile({
      rows: [row(2, person({ fullName: "Dad Fox", email: "fox@gym.com" }), "Active")],
      entries: [dadEntry, kidEntry],
      members: [member({ userId: "u1", email: "fox@gym.com" })],
      mode: "whole_list",
      hasList: true,
    });
    // Two entries, one address: the kid comes off the list, and the member is
    // still ON it, because the file still holds that address. A rule that matched
    // a member to an ENTRY that had gone would mark a member who is right there.
    expect(out.counts.gone).toBe(1);
    expect(out.marks).toEqual([{ userId: "u1", mark: "on_list", leaving: false }]);
    expect(out.members.leaving).toBe(0);
  });

  // -------------------------------------------------------------------------
  // THE GYM'S OWN WORDS
  // -------------------------------------------------------------------------

  it("the spelling shown is the FILE'S OWN FIRST ROW, not whichever group the code walks first", () => {
    // THE CASE THAT ISOLATES IT. Row 2 writes "Active" and is a CHANGED person;
    // row 3 writes "ACTIVE" and is a NEW one. The groups are walked new before
    // changed, so a label taken as the groups are counted reads back "ACTIVE" — a
    // word this gym never wrote at the top of its own list (§9.5: "in the case it
    // was first written in"). Neither spelling is on any entry, so the stored list
    // cannot cover for the file here.
    const out = reconcile({
      rows: [row(2, ann, "Active"), row(3, bob, "ACTIVE")],
      entries: [entry(ann, "Frozen"), entry(cal, "Suspended")],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.statuses).toEqual([
      { label: "Active", count: 2, new: 1, changed: 1, unchanged: 0, gone: 0 },
      // A word only the STORED list has keeps the list's own spelling, because the
      // file never mentions the person coming off.
      { label: "Suspended", count: 1, new: 0, changed: 0, unchanged: 0, gone: 1 },
    ]);
    // "Frozen" is what the list said about Ann before this file changed her, and it
    // is NOT one of the upload's numbers: nobody on this upload carries it.
    expect(out.statuses.map((s) => s.label)).not.toContain("Frozen");
  });

  it("no status at all is its own group, with an empty label", () => {
    const out = reconcile({
      rows: [row(2, ann, null)],
      entries: [],
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(out.statuses).toEqual([{ label: "", count: 1, new: 1, changed: 0, unchanged: 0, gone: 0 }]);
  });

  // -------------------------------------------------------------------------
  // THE WRONG-FILE GUARD, AT ITS EDGES (§9.8)
  // -------------------------------------------------------------------------

  it.each([
    { of: 100, changing: 10, large: false },
    { of: 100, changing: 11, large: true },
    { of: 50, changing: 10, large: false },
    { of: 50, changing: 11, large: true },
    { of: 2000, changing: 200, large: false },
    { of: 2000, changing: 201, large: true },
    { of: 0, changing: 10, large: false },
    { of: 0, changing: 11, large: true },
    { of: 9, changing: 9, large: false },
  ])("max(10, 10 %): $changing off $of is large = $large", ({ of, changing, large }) => {
    expect(isLargeMemberListChange(changing, of)).toBe(large);
  });

  it("the guard's numbers come out of the rule, at the edge: 10 off 100 passes, 11 needs a tick", () => {
    const many = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => person({ fullName: `P${String(from + i)}`, email: `p${String(from + i)}@gym.com` }));
    const all = many(100, 0);
    const keep = (n: number) => all.slice(0, n).map((who, i) => row(i + 2, who, "Active"));
    const entries = all.map((who) => entry(who, "Active"));

    const ten = reconcile({ rows: keep(90), entries, members: [], mode: "whole_list", hasList: true });
    expect(ten.guard).toEqual({
      entriesGoing: 10,
      listSize: 100,
      membersLeaving: 0,
      membersListedNow: 0,
      needsTick: false,
      mostOfListWouldGo: false,
    });

    const eleven = reconcile({ rows: keep(89), entries, members: [], mode: "whole_list", hasList: true });
    expect(eleven.guard.entriesGoing).toBe(11);
    expect(eleven.guard.needsTick).toBe(true);
  });

  it("the MEMBERS' side of the guard trips ON ITS OWN, while the entries' side is nowhere near", () => {
    // THE CASE THIS EXISTS FOR: a small slice of a big list is exactly the shape
    // that slips past a guard measured only on entries — 11 off 200 is under the
    // 10 % that would need a tick — and those 11 can still be every app member the
    // gym has. Eleven real people told they are off the list is not a small change,
    // whatever share of the file it was.
    const listed = Array.from({ length: 200 }, (_, i) =>
      person({ fullName: `M${String(i)}`, email: `m${String(i)}@gym.com` }),
    );
    const entries = listed.map((who) => entry(who, "Active"));
    // The file keeps 189 of the 200; the 11 it drops are the gym's only app members.
    const kept = listed.slice(0, 189);
    const dropped = listed.slice(189);
    const out = reconcile({
      rows: kept.map((who, i) => row(i + 2, who, "Active")),
      entries,
      members: dropped.map((who, i) => member({ userId: `u${String(i)}`, email: who.email })),
      mode: "whole_list",
      hasList: true,
    });
    // The entries' side: 11 off 200 is under max(10, 20), so it asks for nothing.
    expect(out.guard.entriesGoing).toBe(11);
    expect(isLargeMemberListChange(out.guard.entriesGoing, out.guard.listSize)).toBe(false);
    // The members' side: 11 of 11, which is what makes the whole guard ask.
    expect(out.guard.membersLeaving).toBe(11);
    expect(out.guard.membersListedNow).toBe(11);
    expect(out.guard.needsTick).toBe(true);
    expect(out.guard.mostOfListWouldGo).toBe(false);
  });

  it("more than half the list coming off says so, and only for a whole list", () => {
    const all = Array.from({ length: 4 }, (_, i) => person({ fullName: `H${String(i)}`, email: `h${String(i)}@gym.com` }));
    const entries = all.map((who) => entry(who, "Active"));
    const half = reconcile({
      rows: [row(2, all[0] ?? ann, "Active"), row(3, all[1] ?? bob, "Active")],
      entries,
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    // Exactly half is not MORE than half.
    expect(half.guard.entriesGoing).toBe(2);
    expect(half.guard.mostOfListWouldGo).toBe(false);

    const most = reconcile({
      rows: [row(2, all[0] ?? ann, "Active")],
      entries,
      members: [],
      mode: "whole_list",
      hasList: true,
    });
    expect(most.guard.entriesGoing).toBe(3);
    expect(most.guard.mostOfListWouldGo).toBe(true);
  });

  // -------------------------------------------------------------------------
  // THE SAME RULE, ASKED WHAT THE LIST SAYS TODAY
  // -------------------------------------------------------------------------

  it("with no file at all, in ADD mode, it answers what the stored list says now", () => {
    const out = reconcile({
      rows: [],
      entries: [entry(ann, "Active")],
      members: [
        member({ userId: "on", email: "ann@gym.com" }),
        member({ userId: "off", email: "bob@gym.com", everListed: true }),
        member({ userId: "never", email: "zoe@gym.com" }),
      ],
      mode: "add",
      hasList: true,
    });
    expect(out.counts).toEqual({ new: 0, changed: 0, unchanged: 0, gone: 0, alreadyInApp: 0, canBeInvited: 0, noEmail: 0 });
    expect(out.marks).toEqual([
      { userId: "on", mark: "on_list", leaving: false },
      { userId: "off", mark: "no_longer_listed", leaving: false },
      { userId: "never", mark: "never_listed", leaving: false },
    ]);
  });


  // -------------------------------------------------------------------------
  // WHO A CONFIRM STAMPS AS LISTED (3a-iii-b, §9.7's `last_listed_at`)
  // -------------------------------------------------------------------------
  //
  // The union of "on the list being replaced" and "on the list that would
  // replace it". Each half is here for its own reason and the tests below name
  // both: without the new list's people nobody is ever stamped; without the old
  // list's, somebody taken off today reads as NEVER LISTED tomorrow, and the gym
  // is told it never had a member it has just removed.

  it("stamps the people the new list reaches and the people the old one held, and nobody else", () => {
    const out = reconcile({
      // Ann stays on, Cal arrives, Bob comes off.
      rows: [row(1, ann, "Active"), row(2, cal, "Active")],
      entries: [entry(ann, "Active"), entry(bob, "Active")],
      members: [
        member({ userId: "stays", email: "ann@gym.com" }),
        member({ userId: "arrives", statedPhone: "+447911123456" }),
        member({ userId: "leaves", email: "bob@gym.com" }),
        member({ userId: "never", email: "zoe@gym.com" }),
      ],
      mode: "whole_list",
      hasList: true,
    });
    // `leaves` IS IN THE SET though they are coming off, and `never` is not
    // though they are a member of the gym.
    expect([...out.onEitherList].sort()).toEqual(["arrives", "leaves", "stays"]);
    expect(out.marks).toEqual([
      { userId: "stays", mark: "on_list", leaving: false },
      { userId: "arrives", mark: "on_list", leaving: false },
      { userId: "leaves", mark: "no_longer_listed", leaving: true },
      { userId: "never", mark: "never_listed", leaving: false },
    ]);
  });

  it("a gym's FIRST confirm stamps everybody the file reaches, though it prints no marks at all", () => {
    const out = reconcile({
      rows: [row(1, ann, "Active"), row(2, cal, "Active")],
      entries: [],
      members: [
        member({ userId: "in-file", email: "ann@gym.com" }),
        member({ userId: "by-phone", statedPhone: "+447911123456" }),
        member({ userId: "not-in-file", email: "zoe@gym.com" }),
      ],
      mode: "whole_list",
      hasList: false,
    });
    // NO MARKS: a gym with nothing to be missing from accuses nobody (§9.7).
    expect(out.marks).toEqual([]);
    // AND YET THE STAMP SET IS FULL. Computing it inside the `hasList` gate
    // would leave a gym's first two hundred members unstamped, with nothing in
    // the system to say so — and every one of them would read "never listed"
    // the day one of them came off.
    expect([...out.onEitherList].sort()).toEqual(["by-phone", "in-file"]);
  });

  it("in ADD mode nobody the list already held falls out of the stamp, because an add takes nobody off", () => {
    const out = reconcile({
      rows: [row(1, cal, "Active")],
      entries: [entry(ann, "Active")],
      members: [member({ userId: "held", email: "ann@gym.com" }), member({ userId: "added", statedPhone: "+447911123456" })],
      mode: "add",
      hasList: true,
    });
    expect([...out.onEitherList].sort()).toEqual(["added", "held"]);
    expect(out.membersLeaving).toEqual([]);
  });

  it("asked what the list says today — no rows, ADD mode — it stamps exactly the members the list holds", () => {
    const out = reconcile({
      rows: [],
      entries: [entry(ann, "Active")],
      members: [
        member({ userId: "on", email: "ann@gym.com" }),
        member({ userId: "off", email: "bob@gym.com", everListed: true }),
      ],
      mode: "add",
      hasList: true,
    });
    expect(out.onEitherList).toEqual(["on"]);
  });
});
