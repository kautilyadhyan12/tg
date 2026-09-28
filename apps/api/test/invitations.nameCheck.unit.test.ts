// The parts of a name (`nameParts`), which `samePerson.ts` uses to tell a household's
// people apart by their own names (§9.7). Nothing compares a name given to the app with
// the gym's list any more (RULINGS 2026-09-28): the email on the list is the link.
import { describe, expect, it } from "vitest";
import { nameParts } from "../src/modules/orgs/invites/nameCheck.js";

describe("nameParts", () => {
  it("folds case, accents and the letters decomposition leaves, joins at apostrophes, splits on the rest", () => {
    expect(nameParts("  Þóra Ðorđević-Æsa  ")).toEqual(["thora", "dordevic", "aesa"]);
    expect(nameParts("O'Neill, Jr.")).toEqual(["oneill", "jr"]);
    expect(nameParts("D’Angelo")).toEqual(["dangelo"]);
  });
});
