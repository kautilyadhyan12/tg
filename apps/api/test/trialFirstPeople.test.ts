// The trial belongs to the gym (Stage 3 item 2d): every class of case for the decision, from
// the counts the database fetches. The database half is orgs.trialGym.test.ts.
import { describe, expect, it } from "vitest";
import {
  TRIAL_FIRST_PEOPLE,
  TRIAL_FIRST_PEOPLE_FROM_ONE_GYM,
  decideTrialCheck,
  type FirstPeopleSource,
  type TrialCheck,
} from "../src/modules/orgs/trialFirstPeople.js";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const src = (gymId: string, came: number, ownerWasThere = false): FirstPeopleSource => ({ gymId, came, ownerWasThere });

describe("decideTrialCheck", () => {
  it("looks at 20 people and needs more than half from one gym", () => {
    expect(TRIAL_FIRST_PEOPLE).toBe(20);
    expect(TRIAL_FIRST_PEOPLE_FROM_ONE_GYM).toBe(11);
  });

  const table: [string, FirstPeopleSource[], TrialCheck][] = [
    ["nobody came from another gym", [], { kind: "none" }],
    ["10 from one gym is half, not more", [src(A, 10)], { kind: "none" }],
    ["11 from one gym, owner never there: ended", [src(A, 11)], { kind: "ended", gymId: A }],
    ["20 from one gym, owner never there: ended", [src(A, 20)], { kind: "ended", gymId: A }],
    ["11 from one gym, owner was there: look", [src(A, 11, true)], { kind: "look", gymId: A }],
    ["spread over three gyms, none more than half", [src(A, 7), src(B, 7), src(C, 6)], { kind: "none" }],
    ["one gym over half beside small ones", [src(B, 3), src(A, 12), src(C, 2, true)], { kind: "ended", gymId: A }],
    ["small gym where the owner was is ignored", [src(A, 12), src(B, 4, true)], { kind: "ended", gymId: A }],
    ["two gyms over half (people in both), owner at one only: ended for the other", [src(A, 11, true), src(B, 11)], { kind: "ended", gymId: B }],
    ["two gyms over half, owner at both: look at the first by id", [src(B, 12, true), src(A, 11, true)], { kind: "look", gymId: A }],
    ["two gyms over half, owner at neither: the first by id", [src(B, 15), src(A, 11)], { kind: "ended", gymId: A }],
  ];
  it.each(table)("%s", (_name, sources, expected) => {
    expect(decideTrialCheck(sources)).toEqual(expected);
    // The order the rows come back in never changes the answer.
    expect(decideTrialCheck([...sources].reverse())).toEqual(expected);
  });
});
