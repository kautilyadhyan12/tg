// WHO "REMOVE" ON THE PEOPLE SELECTED CHANGES, as a table (spec Part 3 §18.5, §18.6; ROADMAP
// 5b-v-b-ii). The rule decides who loses the app, so every class of person a ticked record
// or a ticked account can reach is a case: their own record ticked, a relative's ticked, a
// family's shared email with some or all of its records ticked, staff, a past member still
// in the app, somebody already gone. The worst thing (CLAUDE.md §2.1) is somebody losing the
// app who was not ticked; the first block is that.
import { describe, expect, it } from "vitest";
import type { MemberRemovePreview } from "@app/shared";
import {
  largeRemoval,
  recordRemovalPlan,
  removalDigest,
  rosterRemovalPlan,
  type RecordBrief,
} from "../src/modules/orgs/memberList/removeSelected.js";
import type { MemberAgainstList } from "../src/modules/orgs/memberList/repo.js";

const GYM = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SCALE = { listCurrent: 1000, seats: 1000 };

const record = (n: number, fullName: string, over: Partial<RecordBrief> = {}): RecordBrief => ({
  id: id(n),
  fullName,
  email: null,
  phone: null,
  former: false,
  ...over,
});

/** Someone in the app, matched to a record the way `membersAgainstList` answers. */
const person = (n: number, fullName: string, over: Partial<MemberAgainstList> = {}): MemberAgainstList => ({
  userId: id(9000 + n),
  fullName,
  email: null,
  statedPhone: null,
  everListed: true,
  seatCounted: true,
  onList: false,
  entryId: null,
  entryStatus: null,
  entryMemberNumber: null,
  unsure: null,
  joinedEntryId: null,
  joinedFullName: null,
  joinedFormer: false,
  entryFullName: null,
  joinedAt: new Date("2026-09-01T00:00:00.000Z"),
  ...over,
});

/** In the app with this current record, certainly theirs. */
const on = (n: number, fullName: string, rec: RecordBrief, over: Partial<MemberAgainstList> = {}) =>
  person(n, fullName, { onList: true, entryId: rec.id, entryFullName: rec.fullName, joinedEntryId: rec.id, email: rec.email, ...over });

const plan = (selected: RecordBrief[], records: RecordBrief[], members: MemberAgainstList[], extraIds: string[] = []) =>
  recordRemovalPlan({ gymId: GYM, selectedIds: [...selected.map((r) => r.id), ...extraIds], records, members, scale: SCALE });

const names = (people: MemberRemovePreview["move"]) => people.map((p) => p.name);
const keptOf = (preview: MemberRemovePreview, reason: string) => names(preview.kept.find((k) => k.reason === reason)?.people ?? []);

describe("the worst thing: nobody loses the app who was not selected", () => {
  it("a son's record ticked moves him; his mother, on her own record at the same email, keeps the app and is named", () => {
    const email = "park@example.com";
    const leo = record(1, "Leo Park", { email });
    const maria = record(2, "Maria Park", { email });
    const mariaApp = on(1, "Maria Park", maria);
    const out = plan([leo], [leo], [mariaApp]);
    expect(names(out.preview.move)).toEqual(["Leo Park"]);
    expect(out.endApp).toEqual([]);
    expect(keptOf(out.preview, "own_record")).toEqual(["Maria Park"]);
    expect(out.moveIds).toEqual([leo.id]);
  });

  it("a family's shared email with only one of its records ticked leaves the person in the app alone", () => {
    const email = "ng@example.com";
    const sam = record(1, "Sam Ng", { email });
    const ivy = record(2, "Ivy Ng", { email });
    const who = person(1, "Kim", { email, onList: true, entryId: sam.id, unsure: { by: "email", records: [{ id: sam.id, fullName: "Sam Ng" }, { id: ivy.id, fullName: "Ivy Ng" }] } });
    const out = plan([sam], [sam], [who]);
    expect(out.endApp).toEqual([]);
    expect(keptOf(out.preview, "shared_email")).toEqual(["Kim"]);
  });

  it("people reached by nothing ticked are not in the answer at all", () => {
    const ava = record(1, "Ava Thompson", { email: "ava@example.com" });
    const other = record(2, "Olivia Bennett", { email: "olivia@example.com" });
    const olivia = on(1, "Olivia Bennett", other);
    const out = plan([ava], [ava], [olivia]);
    expect(out.endApp).toEqual([]);
    expect(out.preview.kept).toEqual([]);
  });

  it("the owner, staff and a complimentary place never lose the app here; their record still moves", () => {
    const dee = record(1, "Coach Dee", { email: "dee@example.com" });
    const staff = on(1, "Coach Dee", dee, { seatCounted: false });
    const out = plan([dee], [dee], [staff]);
    expect(out.moveIds).toEqual([dee.id]);
    expect(out.endApp).toEqual([]);
    expect(keptOf(out.preview, "staff")).toEqual(["Coach Dee"]);
  });
});

describe("every class of record selected", () => {
  it("their own current record ticked: moved, and their app ends with it", () => {
    const olivia = record(1, "Olivia Bennett", { email: "o@example.com" });
    const out = plan([olivia], [olivia], [on(1, "Olivia Bennett", olivia)]);
    expect(out.moveIds).toEqual([olivia.id]);
    expect(out.endApp).toEqual([{ userId: id(9001), removedWith: olivia.id }]);
    expect(names(out.preview.endApp)).toEqual(["Olivia Bennett"]);
  });

  it("a record matched by its email and the name they gave the app (no invitation): theirs, ended", () => {
    const dan = record(1, "Daniel Wu", { email: "dan@example.com" });
    const who = person(1, "du", { email: "dan@example.com", onList: true, entryId: dan.id, entryFullName: "Daniel Wu" });
    expect(plan([dan], [dan], [who]).endApp).toEqual([{ userId: id(9001), removedWith: dan.id }]);
  });

  it("a family's shared email with EVERY one of its records ticked: whichever was theirs was ticked, so their app ends", () => {
    const email = "ng@example.com";
    const sam = record(1, "Sam Ng", { email });
    const ivy = record(2, "Ivy Ng", { email });
    const who = person(1, "Kim", { email, onList: true, entryId: sam.id, unsure: { by: "email", records: [{ id: sam.id, fullName: "Sam Ng" }, { id: ivy.id, fullName: "Ivy Ng" }] } });
    const out = plan([sam, ivy], [sam, ivy], [who]);
    expect(out.endApp).toEqual([{ userId: who.userId, removedWith: sam.id }]);
    expect(out.preview.kept).toEqual([]);
  });

  it("twenty records on one email, all ticked: the read may have stopped at twenty, so nobody's app is ended", () => {
    const email = "club@example.com";
    const recs = Array.from({ length: 20 }, (_, i) => record(i + 1, `Player ${String(i + 1).padStart(2, "0")}`, { email }));
    const who = person(1, "Coach", { email, onList: true, entryId: recs[0]?.id ?? null, unsure: { by: "email", records: recs.map((r) => ({ id: r.id, fullName: r.fullName })) } });
    const out = plan(recs, recs, [who]);
    expect(out.endApp).toEqual([]);
    expect(keptOf(out.preview, "shared_email")).toEqual(["Coach"]);
    // Nineteen, all ticked, are all there is.
    const fewer = recs.slice(0, 19);
    const who19 = { ...who, unsure: { by: "email" as const, records: fewer.map((r) => ({ id: r.id, fullName: r.fullName })) } };
    expect(plan(fewer, fewer, [who19]).endApp).toHaveLength(1);
  });

  it("a past member still in the app (joined with that record, on no other): Remove from app ends it", () => {
    const grace = record(1, "Grace Hall", { email: "g@example.com", former: true });
    const who = person(1, "Grace Hall", { email: "g@example.com", joinedEntryId: grace.id, joinedFormer: true, joinedFullName: "Grace Hall" });
    const out = plan([grace], [grace], [who]);
    expect(out.moveIds).toEqual([]);
    expect(out.endApp).toEqual([{ userId: who.userId, removedWith: grace.id }]);
  });

  // Round one, High-2: the box said "Not in the app · Grace Hall" of someone in the app.
  it("a past record whose person is on the list again through another record: kept, named as in the app with their own record", () => {
    const old = record(1, "Grace Hall", { email: "g@example.com", former: true });
    const now = record(2, "Grace Hall", { email: "g@example.com" });
    const who = person(1, "Grace Hall", { email: "g@example.com", joinedEntryId: old.id, joinedFormer: true, onList: true, entryId: now.id });
    const out = plan([old], [old], [who]);
    expect(out.endApp).toEqual([]);
    expect(keptOf(out.preview, "not_in_app")).toEqual([]);
    expect(out.preview.kept).toEqual([{ reason: "own_record", people: [{ name: "Grace Hall", entryId: now.id, userId: who.userId }] }]);
  });

  it("a past record with nobody in the app: named as not in the app, nothing to do", () => {
    const old = record(1, "Tom Reed", { former: true });
    const out = plan([old], [old], []);
    expect([out.moveIds, out.endApp]).toEqual([[], []]);
    expect(keptOf(out.preview, "not_in_app")).toEqual(["Tom Reed"]);
  });

  it("an id that is not this gym's record (deleted, or another gym's) is nobody: counted as gone", () => {
    const ava = record(1, "Ava Thompson");
    const out = plan([ava], [ava], [], [id(777)]);
    expect(out.preview.selected).toBe(2);
    expect(out.preview.kept).toEqual([{ reason: "gone", people: [{ name: "", entryId: id(777), userId: null }] }]);
    expect(out.moveIds).toEqual([ava.id]);
  });

  it("an id sent twice is one person", () => {
    const ava = record(1, "Ava Thompson");
    const out = recordRemovalPlan({ gymId: GYM, selectedIds: [ava.id, ava.id], records: [ava], members: [], scale: SCALE });
    expect(out.preview.selected).toBe(1);
    expect(out.moveIds).toEqual([ava.id]);
  });

  it("someone reached by a ticked record's phone, on their own record: named as keeping the app", () => {
    const leo = record(1, "Leo Park", { phone: "+447700900001" });
    const maria = record(2, "Maria Park", { phone: "+447700900001" });
    const mariaApp = on(1, "Maria Park", maria, { statedPhone: "+447700900001" });
    expect(keptOf(plan([leo], [leo], [mariaApp]).preview, "own_record")).toEqual(["Maria Park"]);
  });

  it("the box lists people by name", () => {
    const recs = [record(1, "Zoe Adams"), record(2, "Adam Zane"), record(3, "Mia Cole")];
    expect(names(plan(recs, recs, []).preview.move)).toEqual(["Adam Zane", "Mia Cole", "Zoe Adams"]);
  });
});

describe("every class of person ticked on In the app", () => {
  const roster = (userIds: string[], members: MemberAgainstList[]) => rosterRemovalPlan({ gymId: GYM, userIds, members, scale: SCALE });

  it("with their own record: it moves with them, and they are removed with it", () => {
    const maria = record(2, "Maria Park", { email: "park@example.com" });
    const who = on(1, "Maria Park", maria);
    const out = roster([who.userId], [who]);
    expect(out.moveIds).toEqual([maria.id]);
    expect(out.endApp).toEqual([{ userId: who.userId, removedWith: maria.id }]);
  });

  it("on a family's shared email the list can't place: their app ends, no record moves", () => {
    const who = person(1, "Kim", { onList: true, entryId: id(1), unsure: { by: "email", records: [{ id: id(1), fullName: "Sam Ng" }, { id: id(2), fullName: "Ivy Ng" }] } });
    const out = roster([who.userId], [who]);
    expect(out.moveIds).toEqual([]);
    expect(out.endApp).toEqual([{ userId: who.userId, removedWith: null }]);
  });

  it("a past member still in the app: removed with the record they joined with", () => {
    const who = person(1, "Grace Hall", { joinedEntryId: id(5), joinedFormer: true });
    expect(roster([who.userId], [who]).endApp).toEqual([{ userId: who.userId, removedWith: id(5) }]);
  });

  it("not on the list at all: their app ends and nothing else", () => {
    const who = person(1, "Walk In");
    const out = roster([who.userId], [who]);
    expect([out.moveIds, out.endApp]).toEqual([[], [{ userId: who.userId, removedWith: null }]]);
  });

  it("the owner, staff and a complimentary place are kept, their record left alone", () => {
    const dee = record(1, "Coach Dee");
    const who = on(1, "Coach Dee", dee, { seatCounted: false });
    const out = roster([who.userId], [who]);
    expect([out.moveIds, out.endApp]).toEqual([[], []]);
    expect(keptOf(out.preview, "staff")).toEqual(["Coach Dee"]);
  });

  it("somebody no longer in the app (or never in this gym) is counted as gone", () => {
    const out = roster([id(4242)], []);
    expect(out.preview.kept).toEqual([{ reason: "gone", people: [{ name: "", entryId: null, userId: id(4242) }] }]);
    expect([out.moveIds, out.endApp]).toEqual([[], []]);
  });

  it("two accounts on one record, both ticked: the record moves once", () => {
    const dan = record(1, "Daniel Wu");
    const a = on(1, "Daniel Wu", dan);
    const b = on(2, "du", dan, { joinedEntryId: null });
    const out = roster([a.userId, b.userId], [a, b]);
    expect(out.moveIds).toEqual([dan.id]);
    expect(out.endApp).toHaveLength(2);
    expect(out.preview.kept).toEqual([]);
  });

  // Round one, Low-3: B's record moved with A's without the box naming B.
  it("two accounts on one record, one ticked: the other keeps the app and is named, their record moving with the one ticked", () => {
    const dan = record(1, "Daniel Wu");
    const a = on(1, "Daniel Wu", dan);
    const b = on(2, "du", dan, { joinedEntryId: null });
    const out = rosterRemovalPlan({ gymId: GYM, userIds: [a.userId], members: [a], reached: [a, b], scale: SCALE });
    expect(out.moveIds).toEqual([dan.id]);
    expect(out.endApp).toEqual([{ userId: a.userId, removedWith: dan.id }]);
    expect(out.preview.kept).toEqual([{ reason: "same_record", people: [{ name: "du", entryId: dan.id, userId: b.userId }] }]);
  });

  it("only those ticked are looked up, whoever else the read holds", () => {
    const dan = record(1, "Daniel Wu");
    const a = on(1, "Daniel Wu", dan);
    const stranger = on(2, "Olivia Bennett", record(2, "Olivia Bennett"));
    const out = roster([a.userId], [a, stranger]);
    expect(out.endApp.map((p) => p.userId)).toEqual([a.userId]);
    expect(out.moveIds).toEqual([dan.id]);
  });
});

// Round one, High-1: the box said "None of them use the app" of a record a family's shared
// email in the app is on. The server counts the moving records nobody in the app uses.
describe("how many of the records moving nobody in the app uses", () => {
  it("one in the app and one not: 1", () => {
    const olivia = record(1, "Olivia Bennett", { email: "o@example.com" });
    const ava = record(2, "Ava Thompson", { email: "a@example.com" });
    expect(plan([olivia, ava], [olivia, ava], [on(1, "Olivia Bennett", olivia)]).preview.movingNotInApp).toBe(1);
  });

  it("a record on a family's shared email in the app, the person kept: 0, never 'nobody uses it'", () => {
    const email = "park@example.com";
    const maria = record(1, "Maria Park", { email });
    const leo = record(2, "Leo Park", { email });
    const mum = person(1, "Mum", { email, onList: true, entryId: maria.id, unsure: { by: "email", records: [{ id: maria.id, fullName: "Maria Park" }, { id: leo.id, fullName: "Leo Park" }] } });
    const out = plan([maria], [maria], [mum]);
    expect(out.endApp).toEqual([]);
    expect(out.preview.movingNotInApp).toBe(0);
  });

  it("a relative's record at the same email, whose person has their own record: the relative's counts as not used", () => {
    const email = "park@example.com";
    const leo = record(1, "Leo Park", { email });
    const maria = record(2, "Maria Park", { email });
    expect(plan([leo], [leo], [on(1, "Maria Park", maria)]).preview.movingNotInApp).toBe(1);
  });

  it("staff use the app: their record is not counted as unused", () => {
    const dee = record(1, "Coach Dee");
    expect(plan([dee], [dee], [on(1, "Coach Dee", dee, { seatCounted: false })]).preview.movingNotInApp).toBe(0);
  });

  it("nobody in the app: every record moving", () => {
    const recs = [record(1, "A"), record(2, "B"), record(3, "C", { former: true })];
    expect(plan(recs, recs, []).preview.movingNotInApp).toBe(2);
  });
});

describe("the box's digest names exactly what the press does", () => {
  it("is the same whatever order people come in, and changes when anyone's outcome does", () => {
    const a = removalDigest(GYM, [id(1), id(2)], [{ userId: id(9), removedWith: id(1) }]);
    expect(removalDigest(GYM, [id(2), id(1)], [{ userId: id(9), removedWith: id(1) }])).toBe(a);
    expect(removalDigest(GYM, [id(1), id(2)], [])).not.toBe(a);
    expect(removalDigest(GYM, [id(1), id(2)], [{ userId: id(9), removedWith: id(2) }])).not.toBe(a);
    expect(removalDigest(GYM, [id(1)], [{ userId: id(9), removedWith: id(1) }])).not.toBe(a);
    expect(removalDigest(id(2), [id(1), id(2)], [{ userId: id(9), removedWith: id(1) }])).not.toBe(a);
  });

  it("a person joining the app on a ticked record changes the box", () => {
    const olivia = record(1, "Olivia Bennett");
    const before = plan([olivia], [olivia], []).preview.digest;
    const after = plan([olivia], [olivia], [on(1, "Olivia Bennett", olivia)]).preview.digest;
    expect(after).not.toBe(before);
  });
});

describe("a big removal asks first: more than 10 AND more than 10 % of the places (or of the list)", () => {
  const cases: [string, number, number, { listCurrent: number; seats: number }, ReturnType<typeof largeRemoval>][] = [
    ["10 of 20 in the app: not asked", 0, 10, { listCurrent: 20, seats: 20 }, null],
    ["11 of 20 in the app", 0, 11, { listCurrent: 20, seats: 20 }, { kind: "app", removing: 11, of: 20 }],
    ["11 of 200 in the app: the line is 20 (10 %), not asked", 0, 11, { listCurrent: 200, seats: 200 }, null],
    ["20 of 200 in the app: exactly 10 %, not asked", 0, 20, { listCurrent: 1000, seats: 200 }, null],
    ["21 of 200 in the app", 0, 21, { listCurrent: 1000, seats: 200 }, { kind: "app", removing: 21, of: 200 }],
    ["300 records with nobody in the app", 300, 0, { listCurrent: 1200, seats: 50 }, { kind: "list", removing: 300, of: 1200 }],
    ["both: the app is said first", 300, 60, { listCurrent: 1200, seats: 146 }, { kind: "app", removing: 60, of: 146 }],
    ["one person", 1, 1, { listCurrent: 1, seats: 1 }, null],
  ];
  it.each(cases)("%s", (_name, moving, ending, scale, expected) => {
    expect(largeRemoval(moving, ending, scale)).toEqual(expected);
  });
});
