// The console's Reports page: the members figures (spec Part 3 §16.5; ROADMAP 21a-i).
//
// The server counts the gym's member list month by month; `membersReportFrom` turns the
// counts into the figures, and says why where a figure cannot be given.
import { z } from "zod";
import { LEAD_SOURCES, leadSourceSchema, type LeadSource } from "./leads.js";

/** How many months the page and its CSV show, the month in progress last. */
export const REPORT_MONTHS = 12;
/** Churn, retention and the average stay wait for this many full months on the list. */
export const REPORT_FULL_MONTHS_NEEDED = 3;
/** Churn is worked out over this many full months, the newest ones. */
export const REPORT_CHURN_MONTHS = 3;

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const countSchema = z.number().int().min(0);
/** A share out of 100, to one decimal place. */
const percentSchema = z.number().min(0).max(100);

/** One month of the gym's list, as the database counted it. */
export interface ReportMonthCounts {
  /** 'YYYY-MM'. */
  month: string;
  /** On the list when the month's first day began. */
  activeAtStart: number;
  /** Started in the month. */
  joined: number;
  /** Came off the list in the month. */
  left: number;
  /** Came off in the month having been on the list when it began. */
  leftOfStart: number;
}

export interface MembersReportFacts {
  timezone: string;
  /** The gym's own day today. */
  today: string;
  /** The gym's day its first person went on the list; null with nobody ever on it. */
  firstListedOn: string | null;
  /** The gym's day somebody was last added or taken off. */
  listChangedOn: string | null;
  activeNow: number;
  /** Whether anybody has ever come off the list and is still kept as a former record. */
  everLeft: boolean;
  /** `REPORT_MONTHS` of them, oldest first, the month in progress last. */
  months: readonly ReportMonthCounts[];
  /** Those who came off in the months shown: how many, and their days on the list together. */
  stay: { leavers: number; totalDays: number };
  leads: readonly { source: LeadSource; leads: number; joined: number }[];
}

/** Why a figure has no number. */
export const REPORT_NO_FIGURE = ["not_enough_data", "nobody_left", "nobody_at_start"] as const;
const noFigureSchema = z.enum(REPORT_NO_FIGURE);

const shareFigureSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), percent: percentSchema }).strict(),
  z.object({ state: noFigureSchema }).strict(),
]);
export type ReportShareFigure = z.infer<typeof shareFigureSchema>;

const stayFigureSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), days: countSchema, leavers: countSchema.min(1) }).strict(),
  z.object({ state: z.enum(["not_enough_data", "nobody_left"]) }).strict(),
]);
export type ReportStayFigure = z.infer<typeof stayFigureSchema>;

export const membersReportSchema = z
  .object({
    timezone: z.string(),
    today: daySchema,
    listChangedOn: daySchema.nullable(),
    activeNow: countSchema,
    /** False while nobody has ever come off the list: Left and what is worked out from it
     *  are then said in words, never as a zero. */
    everLeft: z.boolean(),
    /** Full months the list has been kept, and whether that is enough for churn. */
    fullMonths: countSchema,
    thisMonth: z.object({ month: monthSchema, joined: countSchema, left: countSchema }).strict(),
    /** The full months churn was worked out over, oldest first; empty without a figure. */
    churnMonths: z.array(monthSchema).max(REPORT_CHURN_MONTHS),
    churn: shareFigureSchema,
    retention: shareFigureSchema,
    averageStay: stayFigureSchema,
    months: z
      .array(
        z
          .object({
            month: monthSchema,
            /** A whole month the list was kept for; the month in progress is not one. */
            full: z.boolean(),
            activeAtStart: countSchema,
            joined: countSchema,
            left: countSchema,
            /** Null for a month that is not full, with nobody at its start, or before there is enough to say. */
            churnPercent: percentSchema.nullable(),
          })
          .strict(),
      )
      .max(REPORT_MONTHS),
    leads: z
      .object({
        total: countSchema,
        joined: countSchema,
        /** The share of all leads that joined; null with no leads. */
        percent: percentSchema.nullable(),
        sources: z
          .array(z.object({ source: leadSourceSchema, leads: countSchema.min(1), joined: countSchema, percent: percentSchema }).strict())
          .max(LEAD_SOURCES.length),
      })
      .strict(),
  })
  .strict();
export type MembersReport = z.infer<typeof membersReportSchema>;

export const membersReportResponseSchema = z.object({ report: membersReportSchema }).strict();
export type MembersReportResponse = z.infer<typeof membersReportResponseSchema>;

/** `part` out of `whole` as a share of 100 to one decimal; `whole` is above zero. */
function percentOf(part: number, whole: number): number {
  return Math.round((Math.min(part, whole) / whole) * 1000) / 10;
}

const monthOf = (day: string): string => day.slice(0, 7);

/** The month after 'YYYY-MM'. */
function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${String(year + 1).padStart(4, "0")}-01` : `${month.slice(0, 4)}-${String(m + 1).padStart(2, "0")}`;
}

/** How many months lie from `from` up to, not including, `to` (both 'YYYY-MM'); never below zero. */
function monthsBetween(from: string, to: string): number {
  const count = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  return Math.max(0, count);
}

/** The first month the list was kept for from its first day to its last: the month the
 *  first person went on it when that was the 1st, otherwise the month after. */
function firstFullMonth(firstListedOn: string): string {
  return firstListedOn.endsWith("-01") ? monthOf(firstListedOn) : nextMonth(monthOf(firstListedOn));
}

/** The figures from the counts.
 *
 *  Churn is the share of the people on the list when a month began who came off during it,
 *  over the newest `REPORT_CHURN_MONTHS` full months taken together; retention is the rest.
 *  Neither is given, nor the average stay, before `REPORT_FULL_MONTHS_NEEDED` full months,
 *  and none of the three while nobody has ever come off the list. */
export function membersReportFrom(facts: MembersReportFacts): MembersReport {
  const thisMonth = monthOf(facts.today);
  const firstFull = facts.firstListedOn === null ? null : firstFullMonth(facts.firstListedOn);
  const fullMonths = firstFull === null ? 0 : monthsBetween(firstFull, thisMonth);
  const enough = fullMonths >= REPORT_FULL_MONTHS_NEEDED;
  const isFull = (month: string): boolean => firstFull !== null && month >= firstFull && month < thisMonth;

  const churnOver = enough ? facts.months.filter((m) => isFull(m.month)).slice(-REPORT_CHURN_MONTHS) : [];
  const atStart = churnOver.reduce((sum, m) => sum + m.activeAtStart, 0);
  const leftOfStart = churnOver.reduce((sum, m) => sum + m.leftOfStart, 0);

  let churn: ReportShareFigure;
  let retention: ReportShareFigure;
  if (!facts.everLeft) {
    churn = { state: "nobody_left" };
    retention = { state: "nobody_left" };
  } else if (!enough || churnOver.length < REPORT_CHURN_MONTHS) {
    churn = { state: "not_enough_data" };
    retention = { state: "not_enough_data" };
  } else if (atStart === 0) {
    churn = { state: "nobody_at_start" };
    retention = { state: "nobody_at_start" };
  } else {
    const percent = percentOf(leftOfStart, atStart);
    churn = { state: "ok", percent };
    retention = { state: "ok", percent: Math.round((100 - percent) * 10) / 10 };
  }

  let averageStay: ReportStayFigure;
  if (!facts.everLeft || facts.stay.leavers === 0) averageStay = { state: "nobody_left" };
  else if (!enough) averageStay = { state: "not_enough_data" };
  else averageStay = { state: "ok", days: Math.round(facts.stay.totalDays / facts.stay.leavers), leavers: facts.stay.leavers };

  // A month before the list was started is counted from join dates alone, so it is left out.
  const firstMonth = facts.firstListedOn === null ? null : monthOf(facts.firstListedOn);
  const shown = firstMonth === null ? [] : facts.months.filter((m) => m.month >= firstMonth && m.month <= thisMonth);
  const current = facts.months.find((m) => m.month === thisMonth);
  const leadsTotal = facts.leads.reduce((sum, s) => sum + s.leads, 0);
  const leadsJoined = facts.leads.reduce((sum, s) => sum + Math.min(s.joined, s.leads), 0);

  return {
    timezone: facts.timezone,
    today: facts.today,
    listChangedOn: facts.listChangedOn,
    activeNow: facts.activeNow,
    everLeft: facts.everLeft,
    fullMonths,
    thisMonth: { month: thisMonth, joined: current?.joined ?? 0, left: current?.left ?? 0 },
    churnMonths: churn.state === "ok" ? churnOver.map((m) => m.month) : [],
    churn,
    retention,
    averageStay,
    months: shown.map((m) => {
      const full = isFull(m.month);
      return {
        month: m.month,
        full,
        activeAtStart: m.activeAtStart,
        joined: m.joined,
        left: m.left,
        churnPercent: full && enough && facts.everLeft && m.activeAtStart > 0 ? percentOf(m.leftOfStart, m.activeAtStart) : null,
      };
    }),
    leads: {
      total: leadsTotal,
      joined: leadsJoined,
      percent: leadsTotal === 0 ? null : percentOf(leadsJoined, leadsTotal),
      sources: LEAD_SOURCES.flatMap((source) => {
        const found = facts.leads.find((s) => s.source === source);
        if (found === undefined || found.leads === 0) return [];
        return [{ source, leads: found.leads, joined: Math.min(found.joined, found.leads), percent: percentOf(found.joined, found.leads) }];
      }),
    },
  };
}
