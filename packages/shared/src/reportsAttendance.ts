// The console's Reports page: the attendance figures (spec Part 3 §16.5; ROADMAP 21a-ii, 21d-i).
//
// `attendanceWindows` says which days of the period each figure is counted over; the server counts the
// gym's visits and classes over them, and `attendanceReportFrom` turns the counts into the
// figures, and says why where a figure cannot be given.
import { z } from "zod";
import { addDays, daysBetween } from "./heldMemberships.js";
import {
  coversFrom,
  reportPeriodOf,
  reportPeriodSchema,
  yearEarlierFigureSchema,
  yearEarlierOf,
  type ReportPeriod,
  type ReportPeriodKey,
  type YearEarlierSpan,
} from "./reportPeriod.js";

/** The most days a period holds: twelve calendar months, one of them February in a leap year. */
export const REPORT_VISIT_DAYS_MAX = 366;
/** The most weeks those days touch. */
export const REPORT_VISIT_WEEKS_MAX = 54;
/** The busiest hours and visits a member a week wait for this many full weeks of check-ins. */
export const REPORT_FULL_WEEKS_NEEDED = 2;
/** How many classes the page lists, the ones that ran most first. */
export const REPORT_CLASS_TYPES_MAX = 100;
/** How many hours are named as the busiest when several tie. */
export const REPORT_BUSIEST_MAX = 3;

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const countSchema = z.number().int().min(0);
/** A share out of 100, to one decimal place. */
const percentSchema = z.number().min(0).max(100);
/** Monday is 1, Sunday is 7. */
const weekdaySchema = z.number().int().min(1).max(7);
const hourSchema = z.number().int().min(0).max(23);

/** Monday is 1, Sunday is 7. */
export function weekdayOf(day: string): number {
  // 1 January 1970 was a Thursday.
  return ((((daysBetween("1970-01-01", day) + 3) % 7) + 7) % 7) + 1;
}

/** The Monday of the week that holds `day`. */
export function mondayOf(day: string): string {
  return addDays(day, 1 - weekdayOf(day));
}

/** Days `from` to `to`, both counted. */
export interface DayWindow {
  from: string;
  to: string;
  weeks: number;
}

export interface AttendanceWindows {
  /** The period: visits day by day, week by week, and classes are counted from its first day. */
  period: ReportPeriod;
  /** The Monday of the week in progress. */
  thisWeek: string;
  /** Whole weeks, Monday to Sunday, that began on or after the first check-in and have ended. */
  fullWeeks: number;
  /** The whole weeks inside the period, since the first check-in: visits a member a week
   *  is a weekly rate. Null before there are `REPORT_FULL_WEEKS_NEEDED` full weeks of check-ins. */
  whole: DayWindow | null;
  /** The days the busiest hours are counted over: every day of the period, from the first
   *  check-in on, today among them. Null before there are that many full weeks. */
  hours: { from: string; to: string } | null;
}

/** The first Monday on or after `day`. */
function mondayFrom(day: string): string {
  const monday = mondayOf(day);
  return monday === day ? monday : addDays(monday, 7);
}

/** Which days each figure is counted over, from the gym's own day today, the period and
 *  the day of the gym's first check-in. Visits a member a week counts whole weeks only.
 *  The busiest hours count every day of the period, so what the page says came in the
 *  period is what the grid shows; both wait for two full weeks of check-ins. */
export function attendanceWindows(today: string, firstVisitOn: string | null, key: ReportPeriodKey): AttendanceWindows {
  const period = reportPeriodOf(key, today);
  const thisWeek = mondayOf(today);
  const firstFull = firstVisitOn === null ? null : mondayFrom(firstVisitOn);
  const fullWeeks = firstFull === null ? 0 : Math.max(0, Math.floor(daysBetween(firstFull, thisWeek) / 7));
  let whole: DayWindow | null = null;
  let hours: AttendanceWindows["hours"] = null;
  if (firstVisitOn !== null && firstFull !== null && fullWeeks >= REPORT_FULL_WEEKS_NEEDED) {
    hours = { from: firstVisitOn > period.from ? firstVisitOn : period.from, to: today };
    const inPeriod = mondayFrom(period.from);
    const from = firstFull > inPeriod ? firstFull : inPeriod;
    whole = { from, to: addDays(thisWeek, -1), weeks: Math.floor(daysBetween(from, thisWeek) / 7) };
  }
  return { period, thisWeek, fullWeeks, whole, hours };
}

/** The same days a year earlier, and the whole weeks, Monday to Sunday, inside them that
 *  visits a member a week is counted over there; null where not one whole week fits. */
export function attendanceYearEarlier(today: string, key: ReportPeriodKey): { span: YearEarlierSpan; whole: DayWindow | null } {
  const span = yearEarlierOf(reportPeriodOf(key, today));
  const from = mondayFrom(span.from);
  const lastMonday = mondayOf(span.to);
  const weeks = Math.floor(daysBetween(from, lastMonday) / 7);
  return { span, whole: weeks >= 1 ? { from, to: addDays(lastMonday, -1), weeks } : null };
}

/** One class the gym runs, counted over the classes of it that started in the window. */
export interface ReportClassCounts {
  name: string;
  /** Classes that ran: cancelled ones are not counted. */
  classes: number;
  /** Those with a limit on places, and their places together. */
  limitedClasses: number;
  places: number;
  /** Places taken in the classes with a limit, never more than a class's places. */
  booked: number;
  /** Places taken in every class: booked, came or no-show. */
  bookings: number;
  attended: number;
  noShows: number;
}

export interface AttendanceReportFacts {
  timezone: string;
  /** The gym's own day today. */
  today: string;
  period: ReportPeriodKey;
  /** The day of the gym's first check-in; null with none. */
  firstVisitOn: string | null;
  /** The days of the period that had a visit. */
  days: readonly { day: string; visits: number }[];
  /** The weeks of the period that had a visit, each by its Monday, or by the period's
   *  first day for the week that day falls in. */
  weeks: readonly { weekStart: string; visits: number; people: number }[];
  /** How many different people visited in the period. */
  people: number;
  /** Visits with a known time in the hours' days, by weekday and hour on the gym's clock. */
  hours: readonly { weekday: number; hour: number; visits: number }[];
  /** Visits in the hours' days that staff added on a later day, so no time is known. */
  hoursNoTime: number;
  /** People on the list today who were on it when the whole weeks began, and their
   *  visits in them: somebody added since could not have come. */
  member: { members: number; visits: number; visitors: number };
  /** Whether the gym has set up any class, and the classes that started in the window. */
  classes: { ever: boolean; types: readonly ReportClassCounts[] };
  /** The day of the gym's first class that ran; null with none. */
  firstClassOn: string | null;
  /** The same counts over `attendanceYearEarlier`'s days: visits a member a week of the
   *  people on the list on its last day who were on it when its whole weeks began. */
  yearEarlier: {
    visits: number;
    people: number;
    member: { members: number; visits: number; visitors: number };
    classes: readonly ReportClassCounts[];
  };
}

const cellSchema = z.object({ weekday: weekdaySchema, hour: hourSchema }).strict();

const perMemberSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("ok"),
      /** Visits a member a week, to one decimal place. */
      perWeek: z.number().min(0),
      from: daySchema,
      to: daySchema,
      weeks: countSchema.min(1),
      /** On the list today and since `from` or before. */
      members: countSchema.min(1),
      visits: countSchema,
      /** How many of those members came at least once. */
      visitors: countSchema,
    })
    .strict(),
  /** Enough weeks, and nobody on the list today was on it when they began. */
  z.object({ state: z.literal("no_members"), from: daySchema, to: daySchema, weeks: countSchema.min(1) }).strict(),
  z.object({ state: z.literal("not_enough_data") }).strict(),
]);
export type ReportPerMember = z.infer<typeof perMemberSchema>;

const hoursSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("ok"),
      from: daySchema,
      to: daySchema,
      /** Every weekday and hour that had a visit. */
      cells: z.array(cellSchema.extend({ visits: countSchema.min(1) }).strict()).min(1).max(7 * 24),
      /** The most visits any one hour had, and the hours that had it: the first few, in the week's order. */
      top: countSchema.min(1),
      busiest: z.array(cellSchema).min(1).max(REPORT_BUSIEST_MAX),
      /** How many hours had that many. */
      tied: countSchema.min(1),
      noTime: countSchema,
    })
    .strict(),
  /** Enough weeks of check-ins, and no visit with a time in those days. */
  z.object({ state: z.literal("no_visits"), from: daySchema, to: daySchema, noTime: countSchema }).strict(),
  z.object({ state: z.literal("not_enough_data") }).strict(),
]);
export type ReportHours = z.infer<typeof hoursSchema>;

const fillSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), percent: percentSchema, booked: countSchema, places: countSchema.min(1), classes: countSchema.min(1) }).strict(),
  /** No class that ran had a limit on places. */
  z.object({ state: z.literal("no_limit") }).strict(),
]);
export type ReportFill = z.infer<typeof fillSchema>;

const noShowsSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ok"), percent: percentSchema, noShows: countSchema, marked: countSchema.min(1), unmarked: countSchema }).strict(),
  /** Places were booked and none is marked came or no-show. */
  z.object({ state: z.literal("nothing_marked"), unmarked: countSchema.min(1) }).strict(),
  z.object({ state: z.literal("no_bookings") }).strict(),
]);
export type ReportNoShows = z.infer<typeof noShowsSchema>;

const classTypeSchema = z
  .object({
    name: z.string(),
    classes: countSchema.min(1),
    /** Null where none of its classes had a limit. */
    places: countSchema.min(1).nullable(),
    booked: countSchema,
    fillPercent: percentSchema.nullable(),
    attended: countSchema,
    noShows: countSchema,
    /** Null where none of its places is marked. */
    noShowPercent: percentSchema.nullable(),
  })
  .strict();

const classesEarlierSchema = yearEarlierFigureSchema({
  /** Classes that ran; the two shares are null where there is none to give. */
  classes: countSchema,
  fillPercent: percentSchema.nullable(),
  noShowPercent: percentSchema.nullable(),
});
export type ReportClassesYearEarlier = z.infer<typeof classesEarlierSchema>;

const visitsEarlierSchema = yearEarlierFigureSchema({
  visits: countSchema,
  people: countSchema,
  /** Null where not one whole week fits in those days, or nobody was on the list then. */
  perMember: z.object({ perWeek: z.number().min(0), weeks: countSchema.min(1), members: countSchema.min(1) }).strict().nullable(),
});
export type ReportVisitsYearEarlier = z.infer<typeof visitsEarlierSchema>;

const classesSchema = z.discriminatedUnion("state", [
  /** The gym has set up no class. */
  z.object({ state: z.literal("none_ever") }).strict(),
  /** It has, and none started in the window. */
  z.object({ state: z.literal("none_recent"), from: daySchema }).strict(),
  z
    .object({
      state: z.literal("ok"),
      from: daySchema,
      classes: countSchema.min(1),
      bookings: countSchema,
      fill: fillSchema,
      noShows: noShowsSchema,
      types: z.array(classTypeSchema).min(1).max(REPORT_CLASS_TYPES_MAX),
      /** Classes counted in the totals and not listed. */
      moreTypes: countSchema,
      yearEarlier: classesEarlierSchema,
    })
    .strict(),
]);
export type ReportClasses = z.infer<typeof classesSchema>;

export const attendanceReportSchema = z
  .object({
    timezone: z.string(),
    today: daySchema,
    period: reportPeriodSchema,
    /** Null while nobody has ever checked in: the visit figures are then said in words. */
    firstVisitOn: daySchema.nullable(),
    fullWeeks: countSchema,
    /** Every visit in the period, and the people who made them. */
    inPeriod: z.object({ visits: countSchema, people: countSchema }).strict(),
    /** From the first check-in or the period's first day, whichever is later, to today. */
    days: z.array(z.object({ day: daySchema, visits: countSchema }).strict()).max(REPORT_VISIT_DAYS_MAX),
    /** `weekStart` is a Monday, or the period's first day for the week that day falls in.
     *  `full` is a whole week of check-ins that has ended; the week in progress is last. */
    weeks: z
      .array(z.object({ weekStart: daySchema, visits: countSchema, people: countSchema, full: z.boolean() }).strict())
      .max(REPORT_VISIT_WEEKS_MAX),
    perMember: perMemberSchema,
    /** Visits, people and visits a member a week over the same days a year earlier; no
     *  figure where the first check-in came after they began. */
    yearEarlier: visitsEarlierSchema,
    hours: hoursSchema,
    classes: classesSchema,
  })
  .strict();
export type AttendanceReport = z.infer<typeof attendanceReportSchema>;

export const attendanceReportResponseSchema = z.object({ report: attendanceReportSchema }).strict();
export type AttendanceReportResponse = z.infer<typeof attendanceReportResponseSchema>;

/** `part` out of `whole` as a share of 100 to one decimal; `whole` is above zero. */
function percentOf(part: number, whole: number): number {
  return Math.round((Math.min(part, whole) / whole) * 1000) / 10;
}

function hoursFrom(facts: AttendanceReportFacts, window: AttendanceWindows["hours"]): ReportHours {
  if (window === null) return { state: "not_enough_data" };
  const cells = facts.hours
    .filter((c) => c.visits > 0)
    .map((c) => ({ weekday: c.weekday, hour: c.hour, visits: c.visits }))
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
  if (cells.length === 0) return { state: "no_visits", ...window, noTime: facts.hoursNoTime };
  const top = Math.max(...cells.map((c) => c.visits));
  const atTop = cells.filter((c) => c.visits === top);
  return {
    state: "ok",
    ...window,
    cells,
    top,
    busiest: atTop.slice(0, REPORT_BUSIEST_MAX).map((c) => ({ weekday: c.weekday, hour: c.hour })),
    tied: atTop.length,
    noTime: facts.hoursNoTime,
  };
}

/** How full classes were and the share of no-shows, over `types`; null where none is given. */
function classShares(types: readonly ReportClassCounts[]): { classes: number; fillPercent: number | null; noShowPercent: number | null } {
  const sum = (pick: (t: ReportClassCounts) => number): number => types.reduce((total, t) => total + pick(t), 0);
  const limited = sum((t) => t.limitedClasses);
  const places = sum((t) => t.places);
  const marked = sum((t) => t.attended) + sum((t) => t.noShows);
  return {
    classes: sum((t) => t.classes),
    fillPercent: limited === 0 || places === 0 ? null : percentOf(sum((t) => t.booked), places),
    noShowPercent: marked === 0 ? null : percentOf(sum((t) => t.noShows), marked),
  };
}

function classesFrom(facts: AttendanceReportFacts, from: string, earlier: YearEarlierSpan): ReportClasses {
  const ran = facts.classes.types.filter((t) => t.classes > 0);
  if (ran.length === 0) return facts.classes.ever ? { state: "none_recent", from } : { state: "none_ever" };
  const sum = (pick: (t: ReportClassCounts) => number): number => ran.reduce((total, t) => total + pick(t), 0);
  const limited = sum((t) => t.limitedClasses);
  const places = sum((t) => t.places);
  const bookings = sum((t) => t.bookings);
  const attended = sum((t) => t.attended);
  const noShows = sum((t) => t.noShows);
  const marked = attended + noShows;

  let noShowFigure: ReportNoShows;
  if (bookings === 0) noShowFigure = { state: "no_bookings" };
  else if (marked === 0) noShowFigure = { state: "nothing_marked", unmarked: bookings };
  else noShowFigure = { state: "ok", percent: percentOf(noShows, marked), noShows, marked, unmarked: Math.max(0, bookings - marked) };

  const listed = [...ran].sort((a, b) => b.classes - a.classes || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    state: "ok",
    from,
    classes: sum((t) => t.classes),
    bookings,
    fill:
      limited === 0 || places === 0
        ? { state: "no_limit" }
        : { state: "ok", percent: percentOf(sum((t) => t.booked), places), booked: Math.min(sum((t) => t.booked), places), places, classes: limited },
    noShows: noShowFigure,
    types: listed.slice(0, REPORT_CLASS_TYPES_MAX).map((t) => {
      const typeMarked = t.attended + t.noShows;
      const hasLimit = t.limitedClasses > 0 && t.places > 0;
      return {
        name: t.name,
        classes: t.classes,
        places: hasLimit ? t.places : null,
        booked: hasLimit ? Math.min(t.booked, t.places) : t.bookings,
        fillPercent: hasLimit ? percentOf(t.booked, t.places) : null,
        attended: t.attended,
        noShows: t.noShows,
        noShowPercent: typeMarked === 0 ? null : percentOf(t.noShows, typeMarked),
      };
    }),
    moreTypes: Math.max(0, listed.length - REPORT_CLASS_TYPES_MAX),
    yearEarlier: coversFrom(facts.firstClassOn, earlier.from)
      ? { state: "ok", ...earlier, ...classShares(facts.yearEarlier.classes.filter((t) => t.classes > 0)) }
      : { state: "no_history", ...earlier, since: facts.firstClassOn },
  };
}

/** The figures from the counts.
 *
 *  Everything is counted over the period. A day or a week nobody came is a zero, from the
 *  gym's first check-in on; nothing earlier is shown. The busiest hours and visits a member a week are given only once
 *  there are `REPORT_FULL_WEEKS_NEEDED` full weeks of check-ins. No-shows are a share of
 *  the places marked came or no-show, so a gym that marks nobody is told so. */
export function attendanceReportFrom(facts: AttendanceReportFacts): AttendanceReport {
  const windows = attendanceWindows(facts.today, facts.firstVisitOn, facts.period);
  const from = windows.period.from;
  const first = facts.firstVisitOn;

  const days: AttendanceReport["days"] = [];
  const weeks: AttendanceReport["weeks"] = [];
  if (first !== null && first <= facts.today) {
    const visitsOn = new Map(facts.days.map((d) => [d.day, d.visits]));
    const start = first > from ? first : from;
    for (let day = start; day <= facts.today; day = addDays(day, 1)) {
      days.push({ day, visits: visitsOn.get(day) ?? 0 });
    }
    const weekOf = new Map(facts.weeks.map((w) => [w.weekStart, w]));
    const firstFull = mondayFrom(first);
    for (let week = mondayOf(start); week <= windows.thisWeek; week = addDays(week, 7)) {
      // The week the period begins in is counted from the period's first day, and says so.
      const weekStart = week < from ? from : week;
      const found = weekOf.get(weekStart);
      weeks.push({ weekStart, visits: found?.visits ?? 0, people: found?.people ?? 0, full: week >= from && week >= firstFull && week < windows.thisWeek });
    }
  }

  let perMember: ReportPerMember;
  if (windows.whole === null) perMember = { state: "not_enough_data" };
  else if (facts.member.members === 0) perMember = { state: "no_members", ...windows.whole };
  else {
    perMember = {
      state: "ok",
      perWeek: Math.round((facts.member.visits / windows.whole.weeks / facts.member.members) * 10) / 10,
      ...windows.whole,
      members: facts.member.members,
      visits: facts.member.visits,
      visitors: Math.min(facts.member.visitors, facts.member.members),
    };
  }

  // A year earlier only where check-ins were kept here for every one of its days.
  const earlier = attendanceYearEarlier(facts.today, facts.period);
  const was = facts.yearEarlier;
  const yearEarlier: ReportVisitsYearEarlier = coversFrom(first, earlier.span.from)
    ? {
        state: "ok",
        ...earlier.span,
        visits: was.visits,
        people: was.people,
        perMember:
          earlier.whole === null || was.member.members === 0
            ? null
            : {
                perWeek: Math.round((was.member.visits / earlier.whole.weeks / was.member.members) * 10) / 10,
                weeks: earlier.whole.weeks,
                members: was.member.members,
              },
      }
    : { state: "no_history", ...earlier.span, since: first };

  return {
    timezone: facts.timezone,
    today: facts.today,
    period: windows.period,
    firstVisitOn: first !== null && first <= facts.today ? first : null,
    fullWeeks: windows.fullWeeks,
    inPeriod: { visits: days.reduce((sum, d) => sum + d.visits, 0), people: days.length === 0 ? 0 : facts.people },
    days,
    weeks,
    perMember,
    yearEarlier,
    hours: hoursFrom(facts, windows.hours),
    classes: classesFrom(facts, from, earlier.span),
  };
}
