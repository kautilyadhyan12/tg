// The Reports page (spec Part 3 §16.5; ROADMAP 21a-i, 21a-ii, 21b-i, 21d-i): the members, attendance
// and money figures, for staff holding `reports.read`. Counts only; no person's name or details leave here.
import type { Sql } from "postgres";
import {
  HELD_PAYMENT_WORDS,
  attendanceReportFrom,
  attendanceReportResponseSchema,
  attendanceWindows,
  heldListWords,
  leadSourceSchema,
  memberCurrencyForCountry,
  membersReportFrom,
  membersReportResponseSchema,
  moneyReportFrom,
  moneyReportResponseSchema,
  reportPeriodOf,
  type AttendanceReportResponse,
  type LeadSource,
  type MembersReportResponse,
  type MoneyReportResponse,
  type OrgPrivilege,
  type ReportPeriodKey,
} from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";
import { inUseForMoney } from "../memberships/heldRepo.js";
import { heldAndOverIn, overNow } from "../memberships/over.js";
import { OrgsError, requirePrivilege } from "../service.js";
import { readPaymentDue } from "../week/repo.js";
import * as repo from "./repo.js";

export interface ReportsDeps {
  sql: Sql;
  now: () => Date;
}

/** Whoever may read this gym's reports, with the gym's time zone; anybody else is refused.
 *  The money figures also need `also`, the notebook's own tick: an owner who lets a
 *  trainer see attendance has not shown them what the gym takes. */
export async function requireReportsReader(deps: ReportsDeps, userId: string, gymId: string, also: OrgPrivilege | null): Promise<{ timezone: string }> {
  const { org, privileges } = await requirePrivilege(deps, gymId, userId, "reports.read");
  if (also !== null && !privileges.includes(also)) throw new OrgsError(403, "forbidden", "Your role doesn't allow that.");
  return { timezone: org.timezone };
}

/** The members figures for a gym whose reader has been checked, over `period`.
 *
 *  Who has left is the people taken off the list and the people the Members list reads as
 *  "Ended" or "Cancelled" today, apart from anybody whose renewal is waiting: `overNow`,
 *  the one answer the sign atop Members counts by too (21c-iii). The reads share one
 *  snapshot: a membership given between them would otherwise count its person as left and
 *  as a member at once. */
export async function getMembersReport(deps: ReportsDeps, gymId: string, org: { timezone: string }, period: ReportPeriodKey): Promise<MembersReportResponse> {
  const now = deps.now();
  const today = dayInTz(now, org.timezone);
  const periodFrom = reportPeriodOf(period, today).from;
  const counts = await deps.sql.begin("isolation level repeatable read read only", async (tx) => {
    const gone = [...(await overNow(tx, gymId, today, null))].map(([id, left]) => ({ id, on: left.on }));
    return await repo.readMemberCounts(tx, gymId, org.timezone, today, gone, periodFrom);
  });
  const leadRows = await repo.readLeadCounts(deps.sql, gymId, org.timezone, periodFrom);
  const leads: { source: LeadSource; leads: number; joined: number }[] = [];
  for (const row of leadRows.sources) {
    const source = leadSourceSchema.safeParse(row.source);
    if (source.success) leads.push({ source: source.data, leads: row.leads, joined: row.joined });
  }
  return membersReportResponseSchema.parse({
    report: membersReportFrom({
      timezone: org.timezone,
      today: counts.today,
      period,
      firstListedOn: counts.first_listed_on,
      listChangedOn: counts.list_changed_on,
      activeNow: counts.active_now,
      everLeft: counts.ever_left,
      months: counts.months,
      inPeriod: { joined: counts.period_joined, left: counts.period_left },
      stay: { leavers: counts.stay_leavers, totalDays: counts.stay_days },
      leads,
      anyLead: leadRows.any,
    }),
  });
}

/** The attendance figures for a gym whose reader has been checked, over `period`. */
export async function getAttendanceReport(deps: ReportsDeps, gymId: string, org: { timezone: string }, period: ReportPeriodKey): Promise<AttendanceReportResponse> {
  const now = deps.now();
  const clock = await repo.readVisitClock(deps.sql, gymId, org.timezone, now);
  const windows = attendanceWindows(clock.today, clock.firstVisitOn, period);
  const visits = await repo.readVisitCounts(deps.sql, gymId, org.timezone, clock.today, windows);
  const classes = await repo.readClassCounts(deps.sql, gymId, org.timezone, windows.period.from, now);
  return attendanceReportResponseSchema.parse({
    report: attendanceReportFrom({
      timezone: org.timezone,
      today: clock.today,
      period,
      firstVisitOn: clock.firstVisitOn,
      days: visits.days,
      weeks: visits.weeks,
      people: visits.people,
      hours: visits.hours,
      hoursNoTime: visits.hours_no_time,
      member: { members: visits.members, visits: visits.member_visits, visitors: visits.member_visitors },
      classes,
    }),
  });
}

/** The money figures for a gym whose reader has been checked, over `period`: sums and counts, never a
 *  person. Its reads share one snapshot, so a payment recorded between them is in every
 *  figure or in none; the list's own counts are read with them because lifetime value
 *  divides by churn, which must be the Members figures' churn. */
export async function getMoneyReport(deps: ReportsDeps, gymId: string, org: { timezone: string }, period: ReportPeriodKey): Promise<MoneyReportResponse> {
  const today = dayInTz(deps.now(), org.timezone);
  const periodFrom = reportPeriodOf(period, today).from;
  const facts = await deps.sql.begin("isolation level repeatable read read only", async (tx) => {
    const gym = await repo.readMoneyGym(tx, gymId);
    // The country's own currency once a payment stands in it, so the page does not turn
    // with whoever paid last; before that, the money the gym has.
    const home = memberCurrencyForCountry(gym.country);
    const currency = home !== null && gym.paidCurrencies.includes(home) ? home : (gym.paidCurrencies[0] ?? gym.heldCurrency ?? home);
    if (currency === null) return null;
    const money = await repo.readMoney(tx, gymId, today, currency, gym.overdueAfterDays, periodFrom);
    if (!money.any_membership || money.first_paid_on === null) return { gym, currency, money, held: [], members: null, listPeople: 0 };
    const held = await inUseForMoney(tx, gymId, currency);
    const onList = await heldAndOverIn(tx, gymId, today, null);
    const gone = [...onList.over].map(([id, left]) => ({ id, on: left.on }));
    const members = await repo.readMemberCounts(tx, gymId, org.timezone, today, gone, periodFrom);
    // Who the Members page reads as "Payment due": Overview's box counts them the same way.
    const answered = [...onList.held.values()].filter(({ shown }) => heldListWords(shown).payment === HELD_PAYMENT_WORDS.due).length;
    const own = await readPaymentDue(tx, gymId, [...onList.held.keys()]);
    return { gym, currency, money, held, members, listPeople: answered + own.ownWord };
  });
  return moneyReportResponseSchema.parse({
    report: moneyReportFrom({
      timezone: org.timezone,
      today,
      period,
      currency: facts?.currency ?? null,
      anyMembership: facts?.money.any_membership ?? false,
      firstPaidOn: facts?.money.first_paid_on ?? null,
      otherCurrency: facts?.money.other_currency ?? false,
      overdueAfterDays: facts?.gym.overdueAfterDays ?? 0,
      held: facts?.held ?? [],
      months: facts?.money.months ?? [],
      owed: {
        currentMinor: facts?.money.current_minor ?? 0,
        currentPeople: facts?.money.current_people ?? 0,
        listPeople: facts?.listPeople ?? 0,
        pastMinor: facts?.money.past_minor ?? 0,
        pastPeople: facts?.money.past_people ?? 0,
        overdueMinor: facts?.money.overdue_minor ?? 0,
        overduePeople: facts?.money.overdue_people ?? 0,
      },
      members: {
        today,
        firstListedOn: facts?.members?.first_listed_on ?? null,
        everLeft: facts?.members?.ever_left ?? false,
        months: facts?.members?.months ?? [],
      },
    }),
  });
}
