// The list and the counters agree (spec Part 3 §15.10.3: each (subject, measure) the app counts
// has ONE counter). A measure put on the list before its counter would save, say "Counted by
// the camera" and count everybody at 0; a counter for a measure the list does not have would
// never be asked. Either is caught here, before any gym can make such a challenge.
import { describe, expect, it } from "vitest";
import { CHALLENGE_SUBJECTS } from "@app/shared";
import { counterFor, counterKey, counterKeys } from "../src/modules/orgs/challenges/counters.js";

describe("the list and the counters", () => {
  const pairs = CHALLENGE_SUBJECTS.flatMap((subject) => subject.measures.map((measure) => ({ subject: subject.id, measure: measure.id })));
  const onTheList = pairs.map((p) => counterKey(p.subject, p.measure));

  it("every number the app counts on the list has its counter", () => {
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.filter((p) => counterFor(p.subject, p.measure) === undefined)).toEqual([]);
  });

  it("every counter counts a number on the list, and no number has two", () => {
    expect(counterKeys().filter((key) => !onTheList.includes(key))).toEqual([]);
    expect(new Set(onTheList).size).toBe(onTheList.length);
  });
});
