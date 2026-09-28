// AN IMPORT'S LEAVERS, as a table (spec Part 3 §18.8; ROADMAP 5b-v-d; RULINGS 2026-09-28).
// Two pure halves decide who a whole-list file takes off and whose app ends with them:
// `reconcile` with staff's "Still a member" marks (who is missing, who is gone, what the
// file writes), and `importLeaversPlan` (Remove's rule on the records marked Left, except
// anyone the file's own writes reach). The worst thing (CLAUDE.md §2.1) is someone nobody
// marked Left going, or losing the app; the first block is that.
import { describe, expect, it } from "vitest";
import type { MemberListRow } from "@app/shared";
import { identityKey } from "../src/modules/orgs/memberList/fields.js";
import { reconcile, type CarriedFields, type ListEntry, type ListMember } from "../src/modules/orgs/memberList/reconcile.js";
import { importLeaversPlan, recordRemovalPlan, type FileWrites, type RecordBrief } from "../src/modules/orgs/memberList/removeSelected.js";
import type { MemberAgainstList } from "../src/modules/orgs/memberList/repo.js";

// ── reconcile, with marks ──

interface Who {
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
}
const who = (fullName: string, email: string | null, phone: string | null = null): Who => ({ fullName, email, phone, memberNumber: null });

const row = (at: number, p: Who, status: string): MemberListRow => ({
  row: at,
  ...p,
  status,
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  paymentStatus: null,
  dateOfBirth: null,
  extra: [],
  identityKey: identityKey(p),
});
const entry = (p: Who, status: string, over: Partial<ListEntry> = {}): ListEntry => ({
  id: identityKey(p),
  identityKey: identityKey(p),
  ...p,
  status,
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  endsOnKind: null,
  paymentStatus: null,
  dateOfBirth: null,
  extra: {},
  handEdited: [],
  former: false,
  ...over,
});
const carries: CarriedFields = {
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
const run = (rows: MemberListRow[], entries: ListEntry[], stay: string[] = [], members: ListMember[] = [], mode: "whole_list" | "add" = "whole_list") =>
  reconcile({ rows, entries, members, keptFields: [], carries, endsOnKind: null, mode, hasList: true, stay: new Set(stay) });

const ada = who("Ada Lane", "ada@example.com");
const ben = who("Ben Cole", "ben@example.com");
const cy = who("Cy Ward", "cy@example.com");
const idOf = (p: Who) => identityKey(p);

describe("the worst thing: only people marked Left are gone", () => {
  it("everyone missing unmarked is gone (the question is asked); marked Still a member stays; the missing set is the same either way", () => {
    const entries = [entry(ada, "Active"), entry(ben, "Frozen"), entry(cy, "Active")];
    const none = run([row(2, ada, "Active")], entries);
    expect(none.missing.map((p) => p.fullName)).toEqual(["Ben Cole", "Cy Ward"]);
    expect(none.gone.map((p) => p.fullName)).toEqual(["Ben Cole", "Cy Ward"]);
    const marked = run([row(2, ada, "Active")], entries, [idOf(ben)]);
    expect(marked.missing.map((p) => p.fullName)).toEqual(["Ben Cole", "Cy Ward"]);
    expect(marked.gone.map((p) => p.fullName)).toEqual(["Cy Ward"]);
    expect(marked.counts.gone).toBe(1);
    expect(marked.guard.entriesGoing).toBe(1);
  });

  it("a Still-a-member mark on someone the file holds, or on a record that is already past, changes nothing", () => {
    const entries = [entry(ada, "Active"), entry(ben, "Active"), entry(cy, "Active", { former: true })];
    const out = run([row(2, ada, "Active")], entries, [idOf(ada), idOf(cy)]);
    expect(out.missing.map((p) => p.fullName)).toEqual(["Ben Cole"]);
    expect(out.gone.map((p) => p.fullName)).toEqual(["Ben Cole"]);
  });

  it("an app member whose record is marked Still a member stays on the list; one marked Left comes off it", () => {
    const entries = [entry(ada, "Active"), entry(ben, "Active"), entry(cy, "Active")];
    const members: ListMember[] = [
      { userId: "u-ben", fullName: "Ben Cole", email: ben.email, statedPhone: null, everListed: true, seatCounted: true, joinedEntryId: idOf(ben) },
      { userId: "u-cy", fullName: "Cy Ward", email: cy.email, statedPhone: null, everListed: true, seatCounted: true, joinedEntryId: idOf(cy) },
    ];
    const out = run([row(2, ada, "Active")], entries, [idOf(ben)], members);
    expect(out.membersLeaving.map((p) => p.fullName)).toEqual(["Cy Ward"]);
    expect(out.marks.find((m) => m.userId === "u-ben")?.mark).toBe("on_list");
  });

  it("an add leaves nobody out, whatever is marked", () => {
    const out = run([row(2, ada, "Active")], [entry(ada, "Active"), entry(ben, "Active")], [], [], "add");
    expect([out.missing, out.gone]).toEqual([[], []]);
  });
});

describe("what the file writes that can change whose record someone is", () => {
  it("a new record, and a record whose email changes (old and new), are written; a status change is not", () => {
    // Matched to Ben's record by his phone, so it is his email changing, not a new person.
    const benPhone = who("Ben Cole", "ben@example.com", "+447700900200");
    const moved = who("Ben Cole", "ben.new@example.com", "+447700900200");
    const out = run(
      [row(2, ada, "Frozen"), row(3, moved, "Active"), row(4, who("Dee New", "dee@example.com", "+447700900123"), "Active")],
      [entry(ada, "Active"), entry(benPhone, "Active")],
    );
    expect(out.changed.map((p) => p.fullName)).toEqual(["Ada Lane", "Ben Cole"]);
    expect([...out.written.emails].sort()).toEqual(["ben.new@example.com", "ben@example.com", "dee@example.com"]);
    expect([...out.written.phones].sort()).toEqual(["+447700900123", "+447700900200"]);
    expect([...out.written.entryIds]).toEqual([idOf(benPhone)]);
  });

  it("a past record the file brings back is written", () => {
    const out = run([row(2, ada, "Active")], [entry(ada, "Active", { former: true })]);
    expect([...out.written.entryIds]).toEqual([idOf(ada)]);
    expect([...out.written.emails]).toEqual(["ada@example.com"]);
  });
});

// ── importLeaversPlan ──

const GYM = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SCALE = { listCurrent: 1000, seats: 1000 };
const record = (n: number, fullName: string, over: Partial<RecordBrief> = {}): RecordBrief => ({ id: id(n), fullName, email: null, phone: null, former: false, ...over });
const inApp = (n: number, rec: RecordBrief, over: Partial<MemberAgainstList> = {}): MemberAgainstList => ({
  userId: id(9000 + n),
  fullName: rec.fullName,
  email: rec.email,
  statedPhone: rec.phone,
  everListed: true,
  seatCounted: true,
  onList: true,
  entryId: rec.id,
  entryStatus: null,
  entryMemberNumber: null,
  unsure: null,
  joinedEntryId: rec.id,
  joinedFullName: rec.fullName,
  joinedFormer: false,
  entryFullName: rec.fullName,
  joinedAt: new Date("2026-09-01T00:00:00.000Z"),
  ...over,
});
const writes = (over: Partial<{ emails: string[]; phones: string[]; entryIds: string[] }> = {}): FileWrites => ({
  emails: new Set(over.emails ?? []),
  phones: new Set(over.phones ?? []),
  entryIds: new Set(over.entryIds ?? []),
});
const leo = record(1, "Leo Park", { email: "park@example.com", phone: "+447700900001" });
const leoApp = inApp(1, leo);
const plan = (written: FileWrites, members: MemberAgainstList[] = [leoApp]) =>
  importLeaversPlan({ gymId: GYM, leftIds: [leo.id], records: [leo], members, written, scale: SCALE });

describe("whose app ends with a leaver", () => {
  const cases: [string, FileWrites, "ends" | "in_file"][] = [
    ["the file writes nothing near him", writes(), "ends"],
    ["the file writes to someone else's email", writes({ emails: ["other@example.com"] }), "ends"],
    ["the file adds or changes a record at his email", writes({ emails: ["park@example.com"] }), "in_file"],
    ["the file's email is his in capitals (folded)", writes({ emails: ["park@example.com"] }), "in_file"],
    ["the file writes at his phone", writes({ phones: ["+447700900001"] }), "in_file"],
    ["the file changes or brings back the record he joined with", writes({ entryIds: [leo.id] }), "in_file"],
  ];
  for (const [name, written, expected] of cases) {
    it(`${name}: ${expected === "ends" ? "his app ends with his record" : "he keeps the app and is named"}`, () => {
      const out = plan(written, name.includes("capitals") ? [inApp(1, leo, { email: "PARK@Example.com" })] : [leoApp]);
      expect(out.moveIds).toEqual([leo.id]);
      if (expected === "ends") {
        expect(out.endApp).toEqual([{ userId: leoApp.userId, removedWith: leo.id }]);
        expect(out.preview.kept).toEqual([]);
      } else {
        expect(out.endApp).toEqual([]);
        expect(out.preview.endApp).toEqual([]);
        expect(out.preview.kept).toEqual([{ reason: "in_file", people: [{ name: "Leo Park", entryId: leo.id, userId: leoApp.userId }] }]);
      }
    });
  }

  it("a joined record on a family email the file writes to spares only the people it reaches, and the digest names what the press does", () => {
    const ana = record(2, "Ana Silva", { email: "ana@example.com" });
    const anaApp = inApp(2, ana);
    const out = importLeaversPlan({
      gymId: GYM,
      leftIds: [leo.id, ana.id],
      records: [leo, ana],
      members: [leoApp, anaApp],
      written: writes({ emails: ["park@example.com"] }),
      scale: SCALE,
    });
    expect(out.endApp).toEqual([{ userId: anaApp.userId, removedWith: ana.id }]);
    const plain = recordRemovalPlan({ gymId: GYM, selectedIds: [leo.id, ana.id], records: [leo, ana], members: [leoApp, anaApp], scale: SCALE });
    expect(plain.endApp).toHaveLength(2);
    expect(out.preview.digest).not.toBe(plain.preview.digest);
  });

  it("staff on a leaver's record keep the app as staff, not as in the file", () => {
    const out = plan(writes({ emails: ["park@example.com"] }), [inApp(1, leo, { seatCounted: false })]);
    expect(out.endApp).toEqual([]);
    expect(out.preview.kept.map((k) => k.reason)).toEqual(["staff"]);
  });
});
