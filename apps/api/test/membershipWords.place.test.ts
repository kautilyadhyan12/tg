// Who the Memberships box gives a type to, case by case (ROADMAP 21c-i; spec Part 3
// §16.9.3). Pure: `placePeople` is the rule the box and the press both ask.
import { describe, expect, it } from "vitest";
import { HELD_LIVE_MAX, type HeldMembershipTerms } from "@app/shared";
import { offeredAgain, placePeople, type WordPerson } from "../src/modules/orgs/memberships/words.js";

const TODAY = "2026-10-11";

const terms = (kind: HeldMembershipTerms["kind"]): HeldMembershipTerms =>
  kind === "pack"
    ? { kind, termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 4999 }
    : { kind, termCount: 1, termUnit: "month", packClasses: null, packDays: null, priceMinor: kind === "trial" ? 0 : 4999 };

const person = (over: Partial<WordPerson>): WordPerson => ({
  entryId: "00000000-0000-4000-8000-000000000001",
  fullName: "Asha Rao",
  endsOn: "2026-11-30",
  endsOnKind: "ends",
  heldType: true,
  typeCancelled: false,
  typeInUse: false,
  typeLastDay: "2026-09-30",
  inUse: 0,
  ...over,
});

const place = (p: WordPerson, kind: HeldMembershipTerms["kind"]) => {
  const [placed] = placePeople([p], terms(kind), false, TODAY);
  if (placed === undefined) throw new Error("nobody placed");
  return `${placed.group}${placed.again ? " again" : ""}${placed.membership === null ? "" : " given"}`;
};

describe("who the Memberships box gives a type to", () => {
  const NOT_REPEATING = ["one_time", "pack", "trial"] as const;

  it.each(NOT_REPEATING)("a %s: every case of somebody who has held it", (kind) => {
    const given = kind === "trial" ? "settled again given" : "ask again given";
    const cases: [string, Partial<WordPerson>, string][] = [
      ["holds one in use", { typeInUse: true }, "has"],
      ["one of theirs was cancelled by staff", { typeCancelled: true }, "has"],
      ["cancelled, and another is in use", { typeCancelled: true, typeInUse: true }, "has"],
      ["the list gives no day", { endsOn: null, endsOnKind: null }, "has"],
      ["the list's day is the day theirs ended", { endsOn: "2026-09-30" }, "has"],
      ["the list's day is the day before theirs ended", { endsOn: "2026-09-29" }, "has"],
      ["the list's day is one day later, and has passed", { endsOn: "2026-10-01" }, "ended again"],
      ["a renewal day the day after theirs ended covers the same last day", { endsOn: "2026-10-01", endsOnKind: "renews" }, "has"],
      ["a renewal day two days after covers one day more, and has passed", { endsOn: "2026-10-02", endsOnKind: "renews" }, "ended again"],
      ["the list's day is later and still to come", {}, given],
      ["a renewal day still to come", { endsOnKind: "renews" }, given],
      ["the list's last day is today", { endsOn: TODAY }, given],
      ["a renewal day of today covers yesterday, which has passed", { endsOn: TODAY, endsOnKind: "renews" }, "ended again"],
      ["theirs ended on a month's last day and the list says the next month's", { typeLastDay: "2026-01-31", endsOn: "2027-02-28" }, given],
      ["later, and they already have as many running as one person can", { inUse: HELD_LIVE_MAX }, "full again"],
      ["later, but more than five years off", { endsOn: "2040-01-01" }, "day again"],
    ];
    for (const [name, over, expected] of cases) expect(place(person(over), kind), name).toBe(expected);
  });

  it("a repeating type is never offered again, whatever the list says", () => {
    expect(place(person({}), "recurring")).toBe("has");
    expect(place(person({ endsOnKind: "renews" }), "recurring")).toBe("has");
    expect(offeredAgain(person({}), terms("recurring"))).toBe(false);
  });

  it("somebody who never held it is placed as before, and never marked again", () => {
    const fresh = { heldType: false, typeLastDay: null };
    expect(place(person(fresh), "one_time")).toBe("ask given");
    expect(place(person({ ...fresh, endsOn: null, endsOnKind: null }), "one_time")).toBe("ask given");
    expect(place(person({ ...fresh, endsOn: "2026-10-01" }), "one_time")).toBe("ended");
    expect(place(person({ ...fresh, endsOnKind: "renews" }), "recurring")).toBe("settled given");
    expect(place(person({ ...fresh, inUse: HELD_LIVE_MAX }), "one_time")).toBe("full");
  });

  it("the membership given again runs to the list's new day", () => {
    const [placed] = placePeople([person({})], terms("one_time"), true, TODAY);
    expect(placed?.membership?.startsOn).toBe("2026-10-11");
    expect(placed?.membership?.paidPeriods).toBe(1);
    // One month from today is 10 November; the days up to the list's 30 November are added after it.
    expect(placed?.membership?.frozenDays).toBe(20);
  });
});
