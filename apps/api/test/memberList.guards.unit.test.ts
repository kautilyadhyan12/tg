// THE CONFIRM'S OWN SELF-CHECK, pinned where it can actually be pinned.
//
// `expectApplied` compares what each of the confirm's three statements DID against
// what the pure rule said it would. Under the gym's row lock, with the rule's own
// dedupe ahead of the INSERT, the two cannot differ — which is why no route test can
// make it fire, and why deleting its three call sites left the whole suite green
// (review of PR #88). The guard's own behaviour is what is testable, so that is what
// is tested: a future refactor that turns it into a no-op turns this red.
import { describe, expect, it } from "vitest";
import { expectApplied } from "../src/modules/orgs/memberList/service.js";

describe("the confirm's applied-count guard", () => {
  it("says nothing when a statement did exactly what the rule said", () => {
    expect(() => {
      expectApplied(7, 7, "added", "11111111-1111-1111-1111-111111111111");
    }).not.toThrow();
    expect(() => {
      expectApplied(0, 0, "removed", "11111111-1111-1111-1111-111111111111");
    }).not.toThrow();
  });

  it("throws when a statement wrote FEWER rows than the rule promised", () => {
    expect(() => {
      expectApplied(6, 7, "added", "22222222-2222-2222-2222-222222222222");
    }).toThrow(/added 6 entries where the rule said 7/);
  });

  it("throws when a statement wrote MORE rows than the rule promised", () => {
    expect(() => {
      expectApplied(9, 7, "removed", "33333333-3333-3333-3333-333333333333");
    }).toThrow(/removed 9 entries where the rule said 7/);
  });

  it("names the upload, so an incident can find which file it was", () => {
    expect(() => {
      expectApplied(1, 2, "updated", "44444444-4444-4444-4444-444444444444");
    }).toThrow(/44444444-4444-4444-4444-444444444444/);
  });
});
