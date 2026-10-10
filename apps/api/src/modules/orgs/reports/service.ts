// The Reports page (spec Part 3 §16.5; ROADMAP 21a-i): the members figures, for staff
// holding `reports.read`. Counts only; no person's name or details leave here.
import type { Sql } from "postgres";
import { leadSourceSchema, membersReportFrom, membersReportResponseSchema, type LeadSource, type MembersReportResponse } from "@app/shared";
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

/** The members figures for a gym whose reader has been checked. */
export async function getMembersReport(deps: ReportsDeps, gymId: string, org: { timezone: string }): Promise<MembersReportResponse> {
  const counts = await repo.readMemberCounts(deps.sql, gymId, org.timezone, deps.now());
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
