// The console's Reports page: the period every part of it is counted over (spec Part 3
// §16.5; ROADMAP 21d-i). One rule for the members, attendance and money figures, so the
// page's parts never count different days under one choice.
import { z } from "zod";
import { addDays } from "./heldMemberships.js";

export const REPORT_PERIODS = ["4w", "3m", "12m"] as const;
export const reportPeriodKeySchema = z.enum(REPORT_PERIODS);
export type ReportPeriodKey = z.infer<typeof reportPeriodKeySchema>;

/** What a read that names no period is counted over. */
export const REPORT_PERIOD_DEFAULT: ReportPeriodKey = "12m";

export const reportPeriodQuerySchema = z.object({ period: reportPeriodKeySchema.default(REPORT_PERIOD_DEFAULT) }).strict();

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** The days counted, both ends among them; `to` is the gym's own day today. */
export const reportPeriodSchema = z.object({ key: reportPeriodKeySchema, from: daySchema, to: daySchema }).strict();
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

/** The first day of the month `back` months before the month of `day`. */
function firstOfMonthBack(day: string, back: number): string {
  const months = Number(day.slice(0, 4)) * 12 + (Number(day.slice(5, 7)) - 1) - back;
  return `${String(Math.floor(months / 12)).padStart(4, "0")}-${String((months % 12) + 1).padStart(2, "0")}-01`;
}

/** The days a period covers on the gym's calendar. Four weeks are today and the 27 days
 *  before it. Three and twelve months are whole calendar months with the month in
 *  progress last, so a month-by-month table adds up to the period's own figure. */
export function reportPeriodOf(key: ReportPeriodKey, today: string): ReportPeriod {
  if (key === "4w") return { key, from: addDays(today, -27), to: today };
  return { key, from: firstOfMonthBack(today, key === "3m" ? 2 : 11), to: today };
}

/** The same days a year earlier (ROADMAP 21d-ii), both ends among them. */
export const yearEarlierSpanSchema = z.object({ from: daySchema, to: daySchema }).strict();
export type YearEarlierSpan = z.infer<typeof yearEarlierSpanSchema>;

/** `day` a calendar year back; 29 February is 28 February. */
function yearBack(day: string): string {
  const year = Number(day.slice(0, 4)) - 1;
  const month = day.slice(5, 7);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dayOfMonth = month === "02" && day.slice(8) === "29" && !leap ? "28" : day.slice(8);
  return `${String(year).padStart(4, "0")}-${month}-${dayOfMonth}`;
}

/** The days a period is set beside a year earlier. Four weeks go back 52 weeks, so a
 *  Monday is set beside a Monday; three and twelve months go back a calendar year, the
 *  same months up to the same day of the month. */
export function yearEarlierOf(period: ReportPeriod): YearEarlierSpan {
  if (period.key === "4w") return { from: addDays(period.from, -364), to: addDays(period.to, -364) };
  return { from: yearBack(period.from), to: yearBack(period.to) };
}

/** A figure a year earlier: its counts, or, where the app's records of it began after
 *  those days did (`since`, null with none ever), no figure and the day they began. */
export function yearEarlierFigureSchema<T extends z.ZodRawShape>(shape: T) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("ok"), from: daySchema, to: daySchema, ...shape }).strict(),
    z.object({ state: z.literal("no_history"), from: daySchema, to: daySchema, since: daySchema.nullable() }).strict(),
  ]);
}

/** Whether records that began on `since` cover every day from `from` on. */
export function coversFrom(since: string | null, from: string): since is string {
  return since !== null && since <= from;
}
