// Which of a gym's meal plans a person gets (ROADMAP Stage 2 24a-ii; spec Part 6 §16.6): the newest
// of what reaches them, and who a membership type reaches on the gym's day. Pure; the routes are in
// `gymMealPlanGiving.routes.test.ts`.
import { describe, expect, it } from "vitest";
import { heldMembershipFacts, type HeldMembership } from "@app/shared";
import { newest, pickAll, reaching, typesOf, type Given, type PersonFacts } from "../src/modules/nutrition/gymMealPlanPick.js";

const TODAY = "2026-11-06";
const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 9, minute));
const g = (audienceId: string, planId: string, kind: Given["kind"], target: string | null, minute: number): Given => ({
  audienceId, planId, kind, target, givenAt: at(minute),
});
const person = (entryId: string, tagIds: string[] = [], typeIds: string[] = []): PersonFacts => ({ entryId, tagIds, typeIds: new Set(typeIds) });

describe("the plan a person gets: the newest of what reaches them", () => {
  it("each class of case, from nothing given to a group given again", () => {
    const everyone = g("a1", "lean", "everyone", null, 1);
    const beginners = g("a2", "muscle", "tag", "beginners", 2);
    const gold = g("a3", "gold-plan", "membership_type", "gold", 3);
    const annTicked = g("a4", "care", "member", "ann", 4);
    // [what is given, the person, the plan they get]
    const cases: [string, Given[], PersonFacts, string | null][] = [
      ["nothing given", [], person("ann"), null],
      ["Everybody only", [everyone], person("ann"), "lean"],
      ["a tag they do not hold", [beginners], person("ann"), null],
      ["a tag they hold, given after Everybody", [everyone, beginners], person("ann", ["beginners"]), "muscle"],
      ["a tag given before Everybody", [g("a2", "muscle", "tag", "beginners", 0), everyone], person("ann", ["beginners"]), "lean"],
      ["a type they are not in", [gold], person("ann"), null],
      ["a type they are in", [everyone, gold], person("ann", [], ["gold"]), "gold-plan"],
      ["ticked themselves, newest", [everyone, beginners, gold, annTicked], person("ann", ["beginners"], ["gold"]), "care"],
      ["somebody else ticked", [everyone, annTicked], person("bob"), "lean"],
      ["ticked, then their tag given again later", [annTicked, g("a2", "muscle", "tag", "beginners", 9)], person("ann", ["beginners"]), "muscle"],
      ["the same instant: the larger id, always", [g("b1", "x", "everyone", null, 5), g("b2", "y", "tag", "t", 5)], person("ann", ["t"]), "y"],
      ["a tag of another kind of id is no type", [g("a5", "p", "membership_type", "beginners", 1)], person("ann", ["beginners"]), null],
    ];
    for (const [name, given, who, plan] of cases) {
      expect(newest(reaching(given, who))?.planId ?? null, name).toBe(plan);
    }
  });

  it("everybody on the list is answered, and somebody nothing reaches is left out", () => {
    const given = [g("t", "muscle", "tag", "beginners", 1), g("m", "care", "member", "cara", 2)];
    const got = pickAll(given, [person("ann", ["beginners"]), person("bob"), person("cara", ["beginners"])]);
    expect([...got].map(([id, x]) => [id, x.planId])).toEqual([["ann", "muscle"], ["cara", "care"]]);
  });
});

const membership = (over: Partial<HeldMembership>): HeldMembership => ({
  kind: "recurring", termCount: 1, termUnit: "month", packClasses: null, packDays: null, free: false,
  startsOn: "2026-09-01", frozenDays: 0, giftDays: 0, giftFrom: 0, status: "active", frozenOn: null, cancelledOn: null,
  paidPeriods: 3, paidFloor: 0, renews: true, classesLeft: null, fullFrom: null, ...over,
});

describe("who a membership type reaches, as the Members list reads them", () => {
  const running = membership({});
  const frozen = membership({ status: "frozen", frozenOn: "2026-10-20" });
  const toStart = membership({ startsOn: "2026-12-01", paidPeriods: 0 });
  const cancelled = membership({ status: "cancelled", cancelledOn: "2026-10-15" });
  const ended = membership({ status: "ended", renews: false, termCount: 1, startsOn: "2026-08-01", paidPeriods: 1 });
  const lapsed = membership({ renews: false, termCount: 1, startsOn: "2026-08-01", paidPeriods: 1 });
  const usedUp = membership({ kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, classesLeft: 0, renews: false, startsOn: "2026-10-01" });

  it("the fixtures are what their names say, on the gym's day", () => {
    const status = (m: HeldMembership) => heldMembershipFacts(m, TODAY).status;
    expect([running, frozen, toStart, cancelled, ended, lapsed, usedUp].map(status)).toEqual([
      "active", "frozen", "upcoming", "cancelled", "ended", "ended", "ended",
    ]);
  });

  it("each class of case, from the app's own memberships and from the list's word", () => {
    const word = (typeId: string, everHeld = false) => ({ typeId, everHeld });
    // [case, memberships held, the list's word, the types they are in]
    const cases: [string, { typeId: string; membership: HeldMembership }[], { typeId: string; everHeld: boolean } | null, string[]][] = [
      ["nothing held, no word", [], null, []],
      ["running", [{ typeId: "gold", membership: running }], null, ["gold"]],
      ["frozen still counts", [{ typeId: "gold", membership: frozen }], null, ["gold"]],
      ["still to start: not yet", [{ typeId: "gold", membership: toStart }], null, []],
      ["cancelled", [{ typeId: "gold", membership: cancelled }], null, []],
      ["ended", [{ typeId: "gold", membership: ended }], null, []],
      ["stored running but past its last day", [{ typeId: "gold", membership: lapsed }], null, []],
      ["a pack used up", [{ typeId: "pt", membership: usedUp }], null, []],
      ["two at once", [{ typeId: "gold", membership: running }, { typeId: "pt", membership: frozen }], null, ["gold", "pt"]],
      ["the file's word only", [], word("gold"), ["gold"]],
      ["the file's word, an app membership running: the app's", [{ typeId: "silver", membership: running }], word("gold"), ["silver"]],
      ["the file's word, one still to start: neither", [{ typeId: "silver", membership: toStart }], word("gold"), []],
      ["the file's word, the app's own of another type over", [{ typeId: "silver", membership: cancelled }], word("gold"), ["gold"]],
      ["the file's word, that type held here and over: stale", [{ typeId: "gold", membership: ended }], word("gold", true), []],
    ];
    for (const [name, held, w, types] of cases) {
      expect([...typesOf({ held, word: w }, TODAY)].sort(), name).toEqual(types);
    }
  });
});
