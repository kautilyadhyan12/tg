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
