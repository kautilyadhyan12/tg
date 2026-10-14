// The console's Reports page: the members figures (spec Part 3 §16.5; ROADMAP 21a-i).
//
// The server counts the gym's member list month by month; `membersReportFrom` turns the
// counts into the figures, and says why where a figure cannot be given.
import { z } from "zod";
import { LEAD_SOURCES, leadSourceSchema, type LeadSource } from "./leads.js";
import { reportPeriodOf, reportPeriodSchema, yearEarlierOf, type ReportPeriodKey, type YearEarlierSpan } from "./reportPeriod.js";

/** How many months the page and its CSV show, the month in progress last. */
export const REPORT_MONTHS = 12;
/** Churn, retention and the average stay wait for this many full months on the list. */
export const REPORT_FULL_MONTHS_NEEDED = 3;
/** Churn is worked out over this many full months, the newest ones. */
export const REPORT_CHURN_MONTHS = 3;
/** A month: the page asks a gym that keeps its list in other software to import it each
 *  month, so somebody added within this many days of joining was added in the ordinary way. */
export const REPORT_LIST_LAG_DAYS = 31;

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
  /** Left in the month: came off the list, or their last membership here ended or was
   *  cancelled with no new one (21c-ii). */
  left: number;
  /** Left in the month having been a member when it began. */
  leftOfStart: number;
}

export interface MembersReportFacts {
  timezone: string;
  /** The gym's own day today. */
  today: string;
  period: ReportPeriodKey;
  /** The gym's day its first person went on the list; null with nobody ever on it. */
  firstListedOn: string | null;
  /** The gym's day somebody was last added or taken off. */
  listChangedOn: string | null;
  activeNow: number;
  /** Whether anybody has ever left: come off the list and still kept as a former record,
   *  or still on it with every membership given here over. */
  everLeft: boolean;
  /** `REPORT_MONTHS` of them, oldest first, the month in progress last. */
  months: readonly ReportMonthCounts[];
  /** Counted over the period's own days: who started from `newCountedFrom` on, and who left. */
  inPeriod: { joined: number; left: number };
  /** Those who left in the period: how many, and their days as a member together. */
  stay: { leavers: number; totalDays: number };
  /** Leads added in the period, by where they heard of the gym. */
  leads: readonly { source: LeadSource; leads: number; joined: number }[];
  /** Whether the gym has any lead at all, in the period or before it. */
  anyLead: boolean;
  /** New members over the same days a year earlier (`yearEarlierOf`), both ends among them. */
  yearEarlier: MembersEarlierCounts;
}

/** Who started in a year-earlier span: those the list held on its last day (`joined`), as
 *  today's figure counts those the list holds today; and those added more than
 *  `REPORT_LIST_LAG_DAYS` after it (`late`; most of them on `lateOn`, the earliest such day
 *  where days tie). Those added in between are a month's ordinary import, as today's own
 *  newest joiners may be, and are in neither. */
export interface MembersEarlierCounts {
  joined: number;
  late: number;
  lateOn: string | null;
}

/** Why a figure has no number. */
export const REPORT_NO_FIGURE = ["not_enough_data", "nobody_left", "nobody_at_start"] as const;
const noFigureSchema = z.enum(REPORT_NO_FIGURE);

const shareFigureSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), percent: percentSchema }).strict(),
  z.object({ state: noFigureSchema }).strict(),
]);
export type ReportShareFigure = z.infer<typeof shareFigureSchema>;

const membersEarlierSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), from: daySchema, to: daySchema, joined: countSchema }).strict(),
  /** The list began after new members of those days could be counted (`since`, null with no list). */
  z.object({ state: z.literal("no_history"), from: daySchema, to: daySchema, since: daySchema.nullable() }).strict(),
  /** Most of those days' new members reached the list only well after them, most of them on `on`. */
  z.object({ state: z.literal("added_later"), from: daySchema, to: daySchema, on: daySchema }).strict(),
]);
export type MembersYearEarlier = z.infer<typeof membersEarlierSchema>;

/** New members a year earlier, counted as today's are: from the list as it stood on that
 *  span's last day. Given only where the list could count new members from the span's first
 *  day (`newCountedFrom`), and where it was being kept then: not where more of those who
 *  started in the span were added over a month later than were on it in time, as when one
 *  person is typed in by hand before a gym imports its file. */
export function membersYearEarlierFrom(firstListedOn: string | null, span: YearEarlierSpan, counts: MembersEarlierCounts): MembersYearEarlier {
  if (newCountedFrom(firstListedOn, span.from) !== span.from) return { state: "no_history", ...span, since: firstListedOn };
  if (counts.late > counts.joined && counts.lateOn !== null) return { state: "added_later", ...span, on: counts.lateOn };
  return { state: "ok", ...span, joined: counts.joined };
}

const stayFigureSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), days: countSchema, leavers: countSchema.min(1) }).strict(),
  z.object({ state: z.enum(["not_enough_data", "nobody_left"]) }).strict(),
]);
export type ReportStayFigure = z.infer<typeof stayFigureSchema>;

export const membersReportSchema = z
  .object({
    timezone: z.string(),
    today: daySchema,
    period: reportPeriodSchema,
    /** The day the list began: a gym younger than the period is told its figures start there. */
    firstListedOn: daySchema.nullable(),
    listChangedOn: daySchema.nullable(),
    activeNow: countSchema,
    /** False while nobody has ever left: Left and what is worked out from it
     *  are then said in words, never as a zero. */
    everLeft: z.boolean(),
    /** Full months the list has been kept, and whether that is enough for churn. */
    fullMonths: countSchema,
    /** `joined` is null in the month the list began: its first people are not new members. */
    thisMonth: z.object({ month: monthSchema, joined: countSchema.nullable(), left: countSchema }).strict(),
    /** New and left over the period's days. `joined` is null while the list's first month
     *  is still going, and is counted from `joinedFrom`: the period's first day, or the
     *  month after the list began when that is later. */
    inPeriod: z.object({ joined: countSchema.nullable(), joinedFrom: daySchema.nullable(), left: countSchema }).strict(),
    /** New members over the same days a year earlier (`membersYearEarlierFrom`). */
    yearEarlier: membersEarlierSchema,
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
            /** Null for a month that began before the list did. */
            activeAtStart: countSchema.nullable(),
            /** Null in the month the list began. */
            joined: countSchema.nullable(),
            left: countSchema,
            /** Null for a month that is not full, with nobody at its start, or before there is enough to say. */
            churnPercent: percentSchema.nullable(),
          })
          .strict(),
      )
      .max(REPORT_MONTHS),
    leads: z
      .object({
        /** False while the gym has never added a lead; true with leads only before the period. */
        ever: z.boolean(),
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

/** The first day new members are counted from in a period that begins on `from`: never
 *  the month the list began, whose people are not new. Null with nobody ever on the list. */
export function newCountedFrom(firstListedOn: string | null, from: string): string | null {
  if (firstListedOn === null) return null;
  const after = `${nextMonth(monthOf(firstListedOn))}-01`;
  return after > from ? after : from;
}

/** What churn is worked out from: the newest `REPORT_CHURN_MONTHS` full months of the
 *  list taken together, with everybody on it as each began and those of them who left
 *  during it. One answer for churn and for lifetime value (`reportsMoney.ts`). */
export function churnBasis(facts: Pick<MembersReportFacts, "today" | "firstListedOn" | "everLeft" | "months">): {
  state: "ok" | (typeof REPORT_NO_FIGURE)[number];
  /** The months it is worked out over, oldest first; empty unless `ok`. */
  months: string[];
  atStart: number;
  leftOfStart: number;
} {
  const thisMonth = monthOf(facts.today);
  const firstFull = facts.firstListedOn === null ? null : firstFullMonth(facts.firstListedOn);
  const enough = firstFull !== null && monthsBetween(firstFull, thisMonth) >= REPORT_FULL_MONTHS_NEEDED;
  const over = enough ? facts.months.filter((m) => m.month >= firstFull && m.month < thisMonth).slice(-REPORT_CHURN_MONTHS) : [];
  const atStart = over.reduce((sum, m) => sum + m.activeAtStart, 0);
  const leftOfStart = over.reduce((sum, m) => sum + m.leftOfStart, 0);
  const none = { months: [], atStart: 0, leftOfStart: 0 };
  if (!facts.everLeft) return { state: "nobody_left", ...none };
  if (!enough || over.length < REPORT_CHURN_MONTHS) return { state: "not_enough_data", ...none };
  if (atStart === 0) return { state: "nobody_at_start", ...none };
  return { state: "ok", months: over.map((m) => m.month), atStart, leftOfStart };
}

/** The figures from the counts.
 *
 *  Churn is the share of the people on the list when a month began who came off during it,
 *  over the newest `REPORT_CHURN_MONTHS` full months taken together; retention is the rest.
 *  Neither is given, nor the average stay, before `REPORT_FULL_MONTHS_NEEDED` full months,
 *  and none of the three while nobody has ever come off the list. New, left, the average
 *  stay, the months listed and the leads follow the period; churn and retention are a
 *  monthly rate and keep their own three months. */
export function membersReportFrom(facts: MembersReportFacts): MembersReport {
  const thisMonth = monthOf(facts.today);
  const period = reportPeriodOf(facts.period, facts.today);
  const newFrom = newCountedFrom(facts.firstListedOn, period.from);
  const joinedFrom = newFrom === null || newFrom > facts.today ? null : newFrom;
  const firstFull = facts.firstListedOn === null ? null : firstFullMonth(facts.firstListedOn);
  const fullMonths = firstFull === null ? 0 : monthsBetween(firstFull, thisMonth);
  const enough = fullMonths >= REPORT_FULL_MONTHS_NEEDED;
  const isFull = (month: string): boolean => firstFull !== null && month >= firstFull && month < thisMonth;

  const basis = churnBasis(facts);
  let churn: ReportShareFigure;
  let retention: ReportShareFigure;
  if (basis.state === "ok") {
    const percent = percentOf(basis.leftOfStart, basis.atStart);
    churn = { state: "ok", percent };
    retention = { state: "ok", percent: Math.round((100 - percent) * 10) / 10 };
  } else {
    churn = { state: basis.state };
    retention = { state: basis.state };
  }

  let averageStay: ReportStayFigure;
  if (!facts.everLeft || facts.stay.leavers === 0) averageStay = { state: "nobody_left" };
  else if (!enough) averageStay = { state: "not_enough_data" };
  else averageStay = { state: "ok", days: Math.round(facts.stay.totalDays / facts.stay.leavers), leavers: facts.stay.leavers };

  // The months the period touches. A month before the list was started is counted from join dates alone, so it is left out.
  const firstMonth = facts.firstListedOn === null ? null : monthOf(facts.firstListedOn);
  const shown = firstMonth === null ? [] : facts.months.filter((m) => m.month >= firstMonth && m.month >= monthOf(period.from) && m.month <= thisMonth);
  const current = facts.months.find((m) => m.month === thisMonth);
  const leadsTotal = facts.leads.reduce((sum, s) => sum + s.leads, 0);
  const leadsJoined = facts.leads.reduce((sum, s) => sum + Math.min(s.joined, s.leads), 0);

  const yearEarlier = membersYearEarlierFrom(facts.firstListedOn, yearEarlierOf(period), facts.yearEarlier);

  return {
    timezone: facts.timezone,
    today: facts.today,
    period,
    firstListedOn: facts.firstListedOn,
    listChangedOn: facts.listChangedOn,
    activeNow: facts.activeNow,
    everLeft: facts.everLeft,
    fullMonths,
    thisMonth: { month: thisMonth, joined: thisMonth === firstMonth ? null : (current?.joined ?? 0), left: current?.left ?? 0 },
    inPeriod: { joined: joinedFrom === null ? null : facts.inPeriod.joined, joinedFrom, left: facts.inPeriod.left },
    yearEarlier,
    churnMonths: basis.months,
    churn,
    retention,
    averageStay,
    months: shown.map((m) => {
      const full = isFull(m.month);
      return {
        month: m.month,
        full,
        activeAtStart: firstFull !== null && m.month >= firstFull ? m.activeAtStart : null,
        // Whoever a gym puts on its list first has been with it for years, whatever the file says.
        joined: m.month === firstMonth ? null : m.joined,
        left: m.left,
        churnPercent: full && enough && facts.everLeft && m.activeAtStart > 0 ? percentOf(m.leftOfStart, m.activeAtStart) : null,
      };
    }),
    leads: {
      ever: facts.anyLead || leadsTotal > 0,
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
