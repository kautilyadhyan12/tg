// Overview's "Last 7 days" box (spec Part 3 §16.4; ROADMAP 20d-ii), for the gym's staff.
// Counts only. Each part is its own page's figure, read by that page's own rule, and is
// sent only to somebody who may open that page:
//
//   new and left   Reports      `reports.read`
//   at risk        At risk      `members.read`
//   visits         Attendance   `attendance.read`
//   payment due    Members      `members.confirm`
import type { Sql } from "postgres";
import { HELD_PAYMENT_WORDS, gymWeekCanCompare, gymWeekResponseSchema, gymWeekWindow, heldListWords, type GymWeek, type GymWeekResponse, type OrgPrivilege } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { countAtRisk } from "../atRisk/service.js";
import { heldAndOverIn } from "../memberships/over.js";
import { requireStaff } from "../service.js";
import * as repo from "./repo.js";

export interface WeekDeps {
  sql: Sql;
  now: () => Date;
}

export interface WeekReader {
  timezone: string;
  privileges: readonly OrgPrivilege[];
}

/** Anybody on this gym's staff, with the ticks they hold; anybody else is refused. */
export async function requireWeekReader(deps: WeekDeps, userId: string, gymId: string): Promise<WeekReader> {
  const { org, privileges } = await requireStaff(deps, gymId, userId);
  return { timezone: org.timezone, privileges };
}

/** The box, for a gym whose reader has been checked. */
export async function getWeek(deps: WeekDeps, gymId: string, reader: WeekReader): Promise<GymWeekResponse> {
  const now = deps.now();
  const today = dayInTz(now, reader.timezone);
  const window = gymWeekWindow(today);
  const may = (privilege: OrgPrivilege): boolean => reader.privileges.includes(privilege);
  const week: GymWeek = { from: window.from, to: window.to, members: null, atRisk: null, visits: null, paymentDue: null };

  if (may("reports.read") || may("members.confirm")) {
    // One snapshot, as Reports reads: a membership given between the reads would count
    // its person as left and as a member at once.
    await deps.sql.begin("isolation level repeatable read read only", async (tx) => {
      const { held, over } = await heldAndOverIn(tx, gymId, today, null);
      if (may("reports.read")) {
        const gone = [...over].map(([id, left]) => ({ id, on: left.on }));
        const members = await repo.readWeekMembers(tx, gymId, reader.timezone, window, gone);
        // The list's first people are not new members (Reports' rule for its first month).
        if (members !== null) week.members = { joined: members.firstListedOn >= window.from ? null : members.joined, left: members.left };
      }
      if (may("members.confirm")) {
        const answered = [...held.values()].filter(({ shown }) => heldListWords(shown).payment === HELD_PAYMENT_WORDS.due).length;
        const own = await repo.readPaymentDue(tx, gymId, [...held.keys()]);
        // A gym that takes no payments here and names nobody as owing is told nothing.
        if (own.anyBill || answered + own.ownWord > 0) week.paymentDue = { count: answered + own.ownWord };
      }
    });
  }

  if (may("members.read")) {
    const count = await countAtRisk(deps.sql, gymId, now);
    if (count !== null) week.atRisk = { count };
  }

  if (may("attendance.read")) {
    const visits = await repo.readWeekVisits(deps.sql, gymId, window);
    // Before the first check-in, or with the first one today, there is no week to count.
    if (visits.firstVisitOn !== null && visits.firstVisitOn <= window.to) {
      week.visits = { thisWeek: visits.thisWeek, weekBefore: gymWeekCanCompare(visits.firstVisitOn, window) ? visits.weekBefore : null };
    }
  }

  return gymWeekResponseSchema.parse({ week });
}
