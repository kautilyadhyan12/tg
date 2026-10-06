// The Members list's word filters and chips for people who hold a membership (ROADMAP
// 23a-i): which of them a filter passes, what the chips count, and how the app's chips
// and the list's own become one set. Pure; the routes are in `memberList.held.routes.test.ts`.
import { describe, expect, it } from "vitest";
import type { HeldOnList } from "@app/shared";
import { heldChips, heldPassing, mergeChips, type AskedWords, type HeldShown, type WordCount } from "../src/modules/orgs/memberships/onList.js";

const shown = (over: Partial<HeldOnList> = {}, noEmail = false): HeldShown => ({
  shown: { status: "active", memberships: ["Gold Monthly"], day: null, payment: { state: "paid" }, ...over },
  noEmail,
});

const people = new Map<string, HeldShown>([
  ["paid", shown()],
  ["owes", shown({ memberships: ["Gold Monthly", "PT 10"], payment: { state: "due", since: "2026-10-01" } })],
  ["free", shown({ memberships: ["Free week"], payment: { state: "free" } })],
  ["frozen", shown({ status: "frozen" }, true)],
  ["gone", shown({ status: "cancelled", payment: null })],
]);
const none: AskedWords = { statuses: null, membershipTypes: null, paymentStatuses: null };

describe("which people a word filter passes, by the app's own words", () => {
  it("each kind asked must match, in any capitals, and nothing asked passes everybody", () => {
    // [the filter, who passes]
    const cases: [Partial<AskedWords>, string[]][] = [
      [{}, ["paid", "owes", "free", "frozen", "gone"]],
      [{ paymentStatuses: ["paid"] }, ["paid", "frozen"]],
      [{ paymentStatuses: ["payment due"] }, ["owes"]],
      [{ paymentStatuses: ["paid", "free"] }, ["paid", "free", "frozen"]],
      // "" is the people with no word of the kind: a membership that is over owes nothing.
      [{ paymentStatuses: [""] }, ["gone"]],
      [{ statuses: ["active"], paymentStatuses: ["paid"] }, ["paid"]],
      [{ statuses: ["cancelled"] }, ["gone"]],
      [{ statuses: [""] }, []],
      // Somebody with two memberships is found under either name.
      [{ membershipTypes: ["pt 10"] }, ["owes"]],
      [{ membershipTypes: ["gold monthly"] }, ["paid", "owes", "frozen", "gone"]],
      [{ membershipTypes: [""] }, []],
      // A word of the gym's old file is nobody's here.
      [{ statuses: ["expired"] }, []],
      [{ paymentStatuses: ["unpaid"] }, []],
    ];
    for (const [asked, who] of cases) {
      expect(heldPassing(people, { ...none, ...asked }), JSON.stringify(asked)).toEqual(who);
    }
  });
});

describe("the chips of the people the app answers for", () => {
  it("count each person under every word they are shown with, in the Filter's order", () => {
    const chips = heldChips(people, new Set(["paid"]));
    const read = (rows: readonly WordCount[]) => rows.map((row) => [row.label, row.count, row.inApp, row.canBeInvited, row.noEmail]);
    expect(read(chips.statuses)).toEqual([
      ["Active", 3, 1, 2, 0],
      ["Frozen", 1, 0, 0, 1],
      ["Cancelled", 1, 0, 1, 0],
    ]);
    expect(read(chips.membershipTypes)).toEqual([
      ["Free week", 1, 0, 1, 0],
      ["Gold Monthly", 4, 1, 2, 1],
      ["PT 10", 1, 0, 1, 0],
    ]);
    expect(read(chips.paymentStatuses)).toEqual([
      ["Payment due", 1, 0, 1, 0],
      ["Paid", 2, 1, 0, 1],
      ["Free", 1, 0, 1, 0],
      ["", 1, 0, 1, 0],
    ]);
  });

  it("nobody is no chips", () => {
    expect(heldChips(new Map(), new Set())).toEqual({ statuses: [], membershipTypes: [], paymentStatuses: [] });
  });
});

describe("the app's chips and the list's own as one set", () => {
  const chip = (label: string, count: number): WordCount => ({ label, count, inApp: 1, canBeInvited: count - 1, noEmail: 0 });

  it("a word both have is one chip in the app's spelling, with the numbers added up", () => {
    const merged = mergeChips([chip("Active", 3), chip("Frozen", 1)], [chip("ACTIVE", 40), chip("Expired", 7)], 200);
    expect(merged).toEqual([
      { label: "Active", count: 43, inApp: 2, canBeInvited: 41, noEmail: 0 },
      { label: "Frozen", count: 1, inApp: 1, canBeInvited: 0, noEmail: 0 },
      { label: "Expired", count: 7, inApp: 1, canBeInvited: 6, noEmail: 0 },
    ]);
  });

  it("the people with no word stay where the list has them, or come last", () => {
    const labels = (rows: readonly WordCount[]) => rows.map((row) => `${row.label}:${String(row.count)}`);
    expect(labels(mergeChips([chip("Paid", 2), chip("", 1)], [chip("", 5), chip("Unpaid", 1)], 200))).toEqual(["Paid:2", ":6", "Unpaid:1"]);
    expect(labels(mergeChips([chip("Paid", 2), chip("", 1)], [chip("Unpaid", 1)], 200))).toEqual(["Paid:2", "Unpaid:1", ":1"]);
    expect(labels(mergeChips([], [chip("Active", 4), chip("", 2)], 200))).toEqual(["Active:4", ":2"]);
  });

  it("is cut to the most a screen takes, and never changes what it was given", () => {
    const app = [chip("A", 1)];
    const own = [chip("a", 2), chip("B", 1), chip("C", 1)];
    expect(mergeChips(app, own, 2).map((row) => row.label)).toEqual(["A", "B"]);
    expect(app[0]?.count).toBe(1);
    expect(own[0]?.count).toBe(2);
  });
});
