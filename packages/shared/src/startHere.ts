// The console's "Start here" list on Overview (spec Part 3 §5.1; ROADMAP 23b): six things
// a new gym sets up, each ticked by the server from what the gym already has.
import { z } from "zod";
import type { OrgPrivilege } from "./orgs.js";

/** The six steps, in the order the list shows them. */
export const START_HERE_STEPS = ["memberships", "members", "staff", "classes", "hours", "frontDesk"] as const;
export const startHereStepSchema = z.enum(START_HERE_STEPS);
export type StartHereStep = z.infer<typeof startHereStepSchema>;

/** The tick each step's own page asks for. A person is sent only the steps they can do. */
export const START_HERE_STEP_PRIVILEGE: Readonly<Record<StartHereStep, OrgPrivilege>> = {
  memberships: "memberships.manage",
  members: "members.confirm",
  staff: "staff.manage",
  classes: "schedule.manage",
  hours: "org.manage",
  frontDesk: "org.manage",
};

/** Hiding the list, and showing it again, is for whoever may change the gym's details. */
export const START_HERE_HIDE_PRIVILEGE: OrgPrivilege = "org.manage";

/** The steps somebody holding these ticks is shown, in the list's order. */
export function startHereStepsFor(privileges: readonly OrgPrivilege[]): StartHereStep[] {
  return START_HERE_STEPS.filter((step) => privileges.includes(START_HERE_STEP_PRIVILEGE[step]));
}

export const startHereSchema = z
  .object({
    /** Hidden for the whole gym. The steps are sent all the same. */
    hidden: z.boolean(),
    /** Whether this person may hide the list and show it again. */
    canHide: z.boolean(),
    steps: z.array(z.object({ step: startHereStepSchema, done: z.boolean() }).strict()).max(START_HERE_STEPS.length),
  })
  .strict();
export type StartHere = z.infer<typeof startHereSchema>;

export const startHereResponseSchema = z.object({ startHere: startHereSchema }).strict();
export type StartHereResponse = z.infer<typeof startHereResponseSchema>;

export const setStartHereRequestSchema = z.object({ hidden: z.boolean() }).strict();
export type SetStartHereRequest = z.infer<typeof setStartHereRequestSchema>;

/** What `gyms.activation` holds for the list. Anything else in the column is left alone. */
export const startHereStoredSchema = z.object({ startHereHidden: z.boolean().optional() });
