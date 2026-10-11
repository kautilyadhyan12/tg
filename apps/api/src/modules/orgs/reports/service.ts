// The Reports page (spec Part 3 §16.5; ROADMAP 21a-i, 21a-ii): the members and attendance
// figures, for staff holding `reports.read`. Counts only; no person's name or details leave here.
import type { Sql } from "postgres";
import {
  attendanceReportFrom,
  attendanceReportResponseSchema,
  attendanceWindows,
  leadSourceSchema,
  membersReportFrom,
  membersReportResponseSchema,
  type AttendanceReportResponse,
  type LeadSource,
  type MembersReportResponse,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { leftOnOf } from "../memberships/onList.js";
import { renewedByTheList } from "../memberships/wordsRepo.js";
import { requirePrivilege } from "../service.js";
import * as repo from "./repo.js";

export interface ReportsDeps {
  sql: Sql;
  now: () => Date;
}

/** Whoever may read this gym's reports, with the gym's time zone; anybody else is refused. */
export async function requireReportsReader(deps: ReportsDeps, userId: string, gymId: string): Promise<{ timezone: string }> {
  const { org } = await requirePrivilege(deps, gymId, userId, "reports.read");
  return { timezone: org.timezone };
}

/** The members figures for a gym whose reader has been checked.
 *
 *  Who has left is the people taken off the list and the people the Members list reads as
 *  "Ended" or "Cancelled" today, asked of that list's own rule (`leftOnOf`). Somebody
 *  whose membership ended and whom the gym's list now gives a later date is still a member:
 *  the gym renewed them in its own software, and the Memberships page is waiting for the
 *  press that renews them here (21c-i). Once the day the list covered has passed with
 *  nothing pressed, that day is the day they left, so the month their membership here ended
 *  in reads as it closed. The reads share one snapshot: a membership given
 *  between them would otherwise count its person as left and as a member at once. */
export async function getMembersReport(deps: ReportsDeps, gymId: string, org: { timezone: string }): Promise<MembersReportResponse> {
  const now = deps.now();
  const today = dayInTz(now, org.timezone);
  const counts = await deps.sql.begin("isolation level repeatable read read only", async (tx) => {
    const left = await leftOnOf(tx, gymId, today);
    for (const kept of left.size > 0 ? await renewedByTheList(tx, gymId, today) : []) {
      const day = left.get(kept.entryId);
      if (day === undefined) continue;
      if (kept.waiting) left.delete(kept.entryId);
      else if (kept.covered < today && kept.covered > day) left.set(kept.entryId, kept.covered);
    }
    const gone = [...left].map(([id, on]) => ({ id, on }));
    return await repo.readMemberCounts(tx, gymId, org.timezone, today, gone);
  });
  const leadRows = await repo.readLeadCounts(deps.sql, gymId);
  const leads: { source: LeadSource; leads: number; joined: number }[] = [];
  for (const row of leadRows) {
    const source = leadSourceSchema.safeParse(row.source);
    if (source.success) leads.push({ source: source.data, leads: row.leads, joined: row.joined });
  }
  return membersReportResponseSchema.parse({
    report: membersReportFrom({
      timezone: org.timezone,
      today: counts.today,
      firstListedOn: counts.first_listed_on,
      listChangedOn: counts.list_changed_on,
      activeNow: counts.active_now,
      everLeft: counts.ever_left,
      months: counts.months,
      stay: { leavers: counts.stay_leavers, totalDays: counts.stay_days },
      leads,
    }),
  });
}

/** The attendance figures for a gym whose reader has been checked. */
export async function getAttendanceReport(deps: ReportsDeps, gymId: string, org: { timezone: string }): Promise<AttendanceReportResponse> {
  const now = deps.now();
  const clock = await repo.readVisitClock(deps.sql, gymId, org.timezone, now);
  const windows = attendanceWindows(clock.today, clock.firstVisitOn);
  const visits = await repo.readVisitCounts(deps.sql, gymId, org.timezone, clock.today, windows);
  const classes = await repo.readClassCounts(deps.sql, gymId, org.timezone, windows.classesFrom, now);
  return attendanceReportResponseSchema.parse({
    report: attendanceReportFrom({
      timezone: org.timezone,
      today: clock.today,
      firstVisitOn: clock.firstVisitOn,
      days: visits.days,
      weeks: visits.weeks,
      hours: visits.hours,
      hoursNoTime: visits.hours_no_time,
      member: { members: visits.members, visits: visits.member_visits, visitors: visits.member_visitors },
      classes,
    }),
  });
}
