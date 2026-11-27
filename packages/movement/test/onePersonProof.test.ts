// The lock's numbers are set by their rule (ROADMAP 52d-i; scripts/lockCheck.ts): once a set has counted, from every
// proof set the camera counts or times, as filmed and under every replay that must hold, how far each person went from
// their place and how much larger or smaller the camera read them. A few minutes: it runs with the proof.
import { describe, expect, it } from "vitest";
import { MATCH_LIMITS, PERSON_LIMITS } from "../src/index.js";
import { lockNumbers, lockRows } from "../scripts/lockCheck.js";
import { turnNumber, turnRows } from "../scripts/turnCheck.js";

describe("the lock's room is set by its rule from every person's own sets", () => {
  const rows = lockRows();
  it("every set counted or timed: as filmed and under each replay that must hold, its person never leaves the lock's room", () => {
    expect(rows.length).toBeGreaterThan(700);
    const out = rows.filter((r) => r.metres > PERSON_LIMITS.room || r.size > PERSON_LIMITS.sizeRoom);
    expect(out).toEqual([]);
  });

  it("the two numbers are the rule's: beyond the furthest set by half its distance from the middle set", () => {
    const n = lockNumbers(rows);
    expect([n.room, n.sizeRoom]).toEqual([PERSON_LIMITS.room, PERSON_LIMITS.sizeRoom]);
  });
});

// The turn's number (52d-ii, scripts/turnCheck.ts): between reps, how far from the way they faced when their standing was
// taken each person faced, once their set had counted, on every proof set of a movement counted by reps.
describe("the turn's number is set by its rule from every person's own sets", () => {
  const rows = turnRows();
  it("every set counted: as filmed and under each replay that must hold, its person never faces as far from their standing as the turn", () => {
    expect(rows.length).toBeGreaterThan(500);
    expect(rows.filter((r) => r.turned > MATCH_LIMITS.turned)).toEqual([]);
  });

  it("the number is the rule's: beyond the furthest set by half its distance from the middle set, rounded up to 5 degrees", () => {
    expect(turnNumber(rows).turned).toBe(MATCH_LIMITS.turned);
  });
});
