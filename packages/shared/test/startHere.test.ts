// The "Start here" list (ROADMAP 23b): which steps each person is shown.
//
// The expected lists are written out from the console's own gates (Settings draws
// Memberships on `memberships.manage`, Staff on `staff.manage`, opening hours and
// check-in devices on `org.manage`; the menu draws Classes on `schedule.manage`;
// Overview draws "Bring your members in" on `members.confirm`), not read back from the rule.
import { describe, expect, it } from "vitest";
import {
  ORG_PRIVILEGES,
  ROLE_PRIVILEGES,
  START_HERE_STEPS,
  START_HERE_STEP_PRIVILEGE,
  setStartHereRequestSchema,
  startHereResponseSchema,
  startHereStepsFor,
  startHereStoredSchema,
  type OrgPrivilege,
  type StartHereStep,
} from "../src/index.js";

describe("the steps a person is shown", () => {
  const cases: { who: string; ticks: readonly OrgPrivilege[]; steps: StartHereStep[] }[] = [
    { who: "an owner", ticks: ROLE_PRIVILEGES.owner, steps: ["memberships", "members", "staff", "classes", "hours", "contact", "frontDesk"] },
    { who: "a manager on the usual ticks", ticks: ROLE_PRIVILEGES.manager, steps: ["memberships", "members", "classes"] },
    { who: "a trainer on the usual ticks", ticks: ROLE_PRIVILEGES.trainer, steps: [] },
    { who: "nobody's ticks", ticks: [], steps: [] },
    { who: "only the gym's details", ticks: ["org.manage"], steps: ["hours", "contact", "frontDesk"] },
    { who: "only staff", ticks: ["staff.manage"], steps: ["staff"] },
    { who: "only the price list", ticks: ["memberships.manage"], steps: ["memberships"] },
    { who: "only the member list", ticks: ["members.confirm"], steps: ["members"] },
    { who: "only the timetable", ticks: ["schedule.manage"], steps: ["classes"] },
    // Ticks that open none of the seven pages.
    {
      who: "every other tick",
      ticks: ["members.read", "codes.invite", "codes.manage", "members.remove", "billing.manage", "attendance.read", "attendance.mark", "leaderboard.manage", "posts.manage"],
      steps: [],
    },
    // The list's order, whatever order the ticks arrive in.
    { who: "ticks in another order", ticks: ["org.manage", "schedule.manage", "memberships.manage"], steps: ["memberships", "classes", "hours", "contact", "frontDesk"] },
  ];
  it.each(cases)("$who", ({ ticks, steps }) => {
    expect(startHereStepsFor(ticks)).toEqual(steps);
  });

  it("every step asks for a tick the console knows, and every tick in the table above is one", () => {
    for (const step of START_HERE_STEPS) expect(ORG_PRIVILEGES).toContain(START_HERE_STEP_PRIVILEGE[step]);
    const named = new Set(cases.flatMap((c) => c.ticks));
    expect([...named].sort()).toEqual([...ORG_PRIVILEGES].sort());
  });
});

describe("what crosses the wire", () => {
  it("the request is hidden true or false and nothing else", () => {
    expect(setStartHereRequestSchema.safeParse({ hidden: true }).success).toBe(true);
    expect(setStartHereRequestSchema.safeParse({ hidden: false }).success).toBe(true);
    for (const bad of [{}, { hidden: "true" }, { hidden: 1 }, { hidden: null }, { hidden: true, steps: [] }, null, "hidden"]) {
      expect(setStartHereRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("the answer names only the seven steps", () => {
    const ok = { startHere: { hidden: false, canHide: true, steps: [{ step: "members", done: true }] } };
    expect(startHereResponseSchema.safeParse(ok).success).toBe(true);
    const unknownStep = { startHere: { hidden: false, canHide: true, steps: [{ step: "billing", done: true }] } };
    expect(startHereResponseSchema.safeParse(unknownStep).success).toBe(false);
  });

  it("the stored value reads a missing mark as not hidden, and refuses a mark that is not true or false", () => {
    expect(startHereStoredSchema.parse({})).toEqual({});
    expect(startHereStoredSchema.parse({ startHereHidden: true, somethingElse: 1 }).startHereHidden).toBe(true);
    expect(startHereStoredSchema.safeParse({ startHereHidden: "yes" }).success).toBe(false);
    expect(startHereStoredSchema.safeParse([]).success).toBe(false);
  });
});
