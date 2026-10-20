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
  START_HERE_TICK_STEPS,
  withKnownStartHereSteps,
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
    for (const step of START_HERE_TICK_STEPS) expect(ORG_PRIVILEGES).toContain(START_HERE_STEP_PRIVILEGE[step]);
    const named = new Set(cases.flatMap((c) => c.ticks));
    expect([...named].sort()).toEqual([...ORG_PRIVILEGES].sort());
  });
});

// Take payments (ROADMAP 18d-i) is the gym's own owner's, on no tick, where Square takes
// card payments: its eight countries from Square support's "International availability"
// (read 2026-09-22), and the countries a gym here can also be in that Square does not serve.
describe("Take payments", () => {
  const every = ROLE_PRIVILEGES.owner;
  const cases: { who: string; isGymOwner: boolean; country: string | null; ticks: readonly OrgPrivilege[]; shown: boolean }[] = [
    ...["US", "CA", "GB", "IE", "FR", "ES", "AU", "JP"].map((country) => ({ who: `the owner, in ${country}`, isGymOwner: true, country, ticks: every, shown: true })),
    ...["IN", "DE", "NL", "IT", "PT", "BE", "AT"].map((country) => ({ who: `the owner, in ${country}`, isGymOwner: true, country, ticks: every, shown: false })),
    { who: "the owner, no country set", isGymOwner: true, country: null, ticks: every, shown: false },
    { who: "a co-owner or a manager with every tick, in GB", isGymOwner: false, country: "GB", ticks: every, shown: false },
    { who: "the owner with no ticks at all, in GB", isGymOwner: true, country: "GB", ticks: [], shown: true },
    { who: "a lower-case country is not a country", isGymOwner: true, country: "gb", ticks: every, shown: false },
  ];
  it.each(cases)("$who", ({ isGymOwner, country, ticks, shown }) => {
    const steps = startHereStepsFor(ticks, { isGymOwner, country });
    expect(steps.includes("payments")).toBe(shown);
    // Last in the list, after the seven a tick opens.
    if (shown) expect(steps[steps.length - 1]).toBe("payments");
  });

  it("is not offered to anybody without the owner's word", () => {
    expect(startHereStepsFor(every)).not.toContain("payments");
    expect(START_HERE_STEPS).toEqual([...START_HERE_TICK_STEPS, "payments"]);
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

  it("a step this build has never heard of is dropped before the answer is checked, and nothing else is", () => {
    const sent = { startHere: { hidden: false, canHide: true, steps: [{ step: "members", done: true }, { step: "waiver", done: false }, { step: "hours", done: false }] } };
    const read = startHereResponseSchema.parse(withKnownStartHereSteps(sent));
    expect(read.startHere.steps.map((s) => s.step)).toEqual(["members", "hours"]);
    // A broken row or a broken answer is still refused.
    const broken = { startHere: { hidden: false, canHide: true, steps: [{ step: "members" }, "x"] } };
    expect(startHereResponseSchema.safeParse(withKnownStartHereSteps(broken)).success).toBe(false);
    for (const body of [null, "x", {}, { startHere: null }, { startHere: { steps: "all" } }]) expect(withKnownStartHereSteps(body)).toBe(body);
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
