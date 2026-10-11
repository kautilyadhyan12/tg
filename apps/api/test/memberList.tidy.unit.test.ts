// WHO THE SIGN COUNTS, AND WHO A REMOVE PRESSED FROM ITS LIST MOVES, as tables (ROADMAP
// 21c-iii; spec Part 3 §16.9.6). The worst thing (CLAUDE.md §2.1) is a paying member moved
// to past members because they were selected among the people whose membership is over;
// the first block is that.
import { describe, expect, it } from "vitest";
import type { MemberRemovePreview } from "@app/shared";
import { recordRemovalPlan, type RecordBrief } from "../src/modules/orgs/memberList/removeSelected.js";
import type { MemberAgainstList } from "../src/modules/orgs/memberList/repo.js";
import { tidyIdsFrom } from "../src/modules/orgs/memberList/tidy.js";

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

/** Someone in the app with this current record, certainly theirs. */
const on = (n: number, rec: RecordBrief, over: Partial<MemberAgainstList> = {}): MemberAgainstList => ({
  userId: id(9000 + n),
  fullName: rec.fullName,
  email: rec.email,
  statedPhone: null,
  everListed: true,
  inMarks: true,
  onList: true,
  entryId: rec.id,
  entryStatus: null,
  entryMemberNumber: null,
  unsure: null,
  joinedEntryId: rec.id,
  joinedFullName: null,
  joinedFormer: false,
  entryFullName: rec.fullName,
  joinedAt: new Date("2026-09-01T00:00:00.000Z"),
  ...over,
});

const names = (people: MemberRemovePreview["move"]) => people.map((p) => p.name);
const keptOf = (preview: MemberRemovePreview, reason: string) => names(preview.kept.find((k) => k.reason === reason)?.people ?? []);

describe("the worst thing: selected among the people whose membership is over, nobody whose membership is not over moves", () => {
  const cal = record(1, "Cal Cancelled", { email: "cal@example.com" });
  const paula = record(2, "Paula Paid", { email: "paula@example.com" });
  const yara = record(3, "Yara Yesterday", { email: "yara@example.com" });
  const all = [cal, paula, yara];
  const inApp = [on(1, cal), on(2, paula), on(3, yara)];
  const plan = (notOverIds: readonly string[] | undefined, members: MemberAgainstList[] = inApp, records: RecordBrief[] = all) =>
    recordRemovalPlan({ gymId: GYM, selectedIds: records.map((r) => r.id), records, members, scale: SCALE, ...(notOverIds === undefined ? {} : { notOverIds }) });

  it("a paying member and somebody renewed since stay on the list and in the app, and are named; the one still over moves", () => {
    const out = plan([paula.id, yara.id]);
    expect(out.moveIds).toEqual([cal.id]);
    expect(out.endApp).toEqual([{ userId: id(9001), removedWith: cal.id }]);
    expect(names(out.preview.move)).toEqual(["Cal Cancelled"]);
    expect(names(out.preview.endApp)).toEqual(["Cal Cancelled"]);
    expect(keptOf(out.preview, "not_over")).toEqual(["Paula Paid", "Yara Yesterday"]);
    // They are counted as selected, and are not "no longer on your list".
    expect(out.preview.selected).toBe(3);
    expect(keptOf(out.preview, "gone")).toEqual([]);
  });

  it("every class of selection: who moves is exactly the selected people still over", () => {
    const cases: [string, string[], string[]][] = [
      ["everybody still over", [], [cal.id, paula.id, yara.id]],
      ["one not over", [paula.id], [cal.id, yara.id]],
      ["nobody over any more", [cal.id, paula.id, yara.id], []],
      ["an id that was never selected is no reason to move anybody", [id(77)], [cal.id, paula.id, yara.id]],
    ];
    for (const [what, notOver, moves] of cases) {
      const out = plan(notOver);
      expect([...out.moveIds].sort(), what).toEqual([...moves].sort());
      expect(out.endApp.map((p) => p.removedWith).sort(), what).toEqual([...moves].sort());
      expect(keptOf(out.preview, "not_over").length, what).toBe(3 - moves.length);
    }
  });

  it("a family on one email: with one of them not over, the person in the app on that email is left alone", () => {
    const email = "park@example.com";
    const leo = record(4, "Leo Park", { email });
    const maria = record(5, "Maria Park", { email });
    // In the app on the shared email; the list cannot say which record is hers.
    const shared = on(4, leo, { fullName: "M Park", entryId: null, onList: false, joinedEntryId: null, unsure: { by: "email", records: [{ id: leo.id, fullName: leo.fullName }, { id: maria.id, fullName: maria.fullName }] } });
    const both = plan([], [shared], [leo, maria]);
    expect(both.endApp.length).toBe(1);
    const one = plan([maria.id], [shared], [leo, maria]);
    expect(one.moveIds).toEqual([leo.id]);
    expect(one.endApp).toEqual([]);
    expect(keptOf(one.preview, "not_over")).toEqual(["Maria Park"]);
    expect(keptOf(one.preview, "shared_email")).toEqual(["M Park"]);
  });

  it("the box's digest moves with who moves, so a press on an older box does nothing", () => {
    const digests = new Set([plan(undefined), plan([]), plan([paula.id]), plan([paula.id, yara.id]), plan([cal.id, paula.id, yara.id])].map((p) => p.preview.digest));
    // Not asked and asked with everybody over are the same box; the rest differ.
    expect(digests.size).toBe(4);
    expect(plan(undefined).preview).toEqual(plan([]).preview);
  });
});

describe("who the sign counts", () => {
  const over = new Map([
    [id(1), { on: "2026-10-03", heldId: id(101) }],
    [id(2), { on: "2026-07-16", heldId: id(102) }],
    [id(3), { on: "2026-10-14", heldId: id(103) }],
  ]);

  it("everybody who is over, apart from anybody kept on the list with that very membership", () => {
    const cases: [string, [string, string][], string[]][] = [
      ["nobody kept", [], [id(1), id(2), id(3)]],
      ["kept with the membership that is over now", [[id(2), id(102)]], [id(1), id(3)]],
      ["kept with an earlier membership: counted again", [[id(2), id(999)]], [id(1), id(2), id(3)]],
      ["somebody kept who is not over is nobody here", [[id(8), id(108)]], [id(1), id(2), id(3)]],
      ["everybody kept", [[id(1), id(101)], [id(2), id(102)], [id(3), id(103)]], []],
    ];
    for (const [what, kept, counted] of cases) expect(tidyIdsFrom(over, new Map(kept)), what).toEqual(counted);
    expect(tidyIdsFrom(new Map(), new Map([[id(1), id(101)]]))).toEqual([]);
  });
});
