// The console's At risk page (spec Part 3 §16.4; ROADMAP 20d-i): the people on a gym's
// list who used to come and have stopped.
//
// `atRiskOf` is the one rule: pure, a person at a time. The server gathers what it reads
// and decides nothing itself.
import { z } from "zod";
import { addDays, daysBetween } from "./heldMemberships.js";
import { gymNudgeSchema } from "./orgs.js";

/** No visit for this many days: the numbers a gym may pick, and the one it starts on. */
export const AT_RISK_QUIET_DAYS = [7, 10, 14, 21, 30] as const;
export const AT_RISK_QUIET_DAYS_DEFAULT = 14;
/** The weeks looked at before somebody stopped: the 28 days that end on their last visit. */
export const AT_RISK_WEEKS = 4;
/** They came in at least this many of those weeks: what a gym may pick, and where it starts. */
export const AT_RISK_WEEKS_CAME = [1, 2, 3, 4] as const;
export const AT_RISK_WEEKS_CAME_DEFAULT = 2;
/** Somebody away longer than this is no longer listed. */
export const AT_RISK_AWAY_MAX_DAYS = 90;
/** How far back a person's visits are read: the longest absence and the weeks before it. */
export const AT_RISK_READ_DAYS = AT_RISK_AWAY_MAX_DAYS + AT_RISK_WEEKS * 7;
/** How many people one read lists, the most regular first. */
export const AT_RISK_MAX = 200;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const daySchema = z.string().regex(DAY);

/** A day that is one: "2026-02-30" is not. */
function isDay(day: unknown): day is string {
  return typeof day === "string" && DAY.test(day) && addDays(day, 0) === day;
}

/** On how many of the days since somebody's last visit the gym must have checked anybody
 *  in, for their absence to be read as theirs: a gym that was shut, or stopped using
 *  check-in, has nobody at risk. Half the gym's number, rounded up. */
export function atRiskGymDays(quietDays: number): number {
  return Math.ceil(quietDays / 2);
}

export interface AtRiskInput {
  /** Today on the gym's own calendar. */
  today: string;
  quietDays: number;
  weeksCame: number;
  /** Every day this person was checked in, by any means, in any order. */
  visitDays: readonly string[];
  /** Every day the gym checked anybody in. */
  gymDays: readonly string[];
}

export type AtRisk =
  | { atRisk: true; lastVisitOn: string; daysAway: number; weeksCame: number }
  | { atRisk: false; why: "unreadable" | "never_came" | "came_lately" | "away_too_long" | "not_regular" | "gym_quiet" };

/** Has this person stopped coming?
 *
 *  Yes when their last visit is `quietDays` or more back and no more than
 *  `AT_RISK_AWAY_MAX_DAYS`, they came in `weeksCame` or more of the four weeks that ended
 *  on that visit, and the gym has checked somebody in on enough days since. A visit dated
 *  after today (a gym that moved its clock) is a visit: they came. Anything unreadable is
 *  no decision, never a name on the list. */
export function atRiskOf(input: AtRiskInput): AtRisk {
  const { today, quietDays, weeksCame } = input;
  if (!isDay(today) || !Number.isInteger(quietDays) || quietDays < 1 || !Number.isInteger(weeksCame) || weeksCame < 1 || weeksCame > AT_RISK_WEEKS) {
    return { atRisk: false, why: "unreadable" };
  }
  if (!input.visitDays.every(isDay)) return { atRisk: false, why: "unreadable" };
  if (input.visitDays.length === 0) return { atRisk: false, why: "never_came" };
  const last = input.visitDays.reduce((a, b) => (a > b ? a : b));
  const daysAway = daysBetween(last, today);
  if (daysAway < quietDays) return { atRisk: false, why: "came_lately" };
  if (daysAway > AT_RISK_AWAY_MAX_DAYS) return { atRisk: false, why: "away_too_long" };
  const weeks = new Set<number>();
  for (const day of input.visitDays) {
    const back = daysBetween(day, last);
    if (back < AT_RISK_WEEKS * 7) weeks.add(Math.floor(back / 7));
  }
  if (weeks.size < weeksCame) return { atRisk: false, why: "not_regular" };
  const gymDays = new Set(input.gymDays.filter((day) => isDay(day) && day > last && day <= today));
  if (gymDays.size < atRiskGymDays(quietDays)) return { atRisk: false, why: "gym_quiet" };
  return { atRisk: true, lastVisitOn: last, daysAway, weeksCame: weeks.size };
}

/** Whether the list can be read yet, from the gym's own check-ins.
 *  `none`: nobody was ever checked in · `new`: check-in began too lately for anybody to
 *  have come and stopped · `stopped`: too few days with a check-in lately, so nobody who
 *  stopped in that time is listed · `in_use`. */
export const atRiskCheckinSchema = z.enum(["none", "new", "stopped", "in_use"]);
export type AtRiskCheckin = z.infer<typeof atRiskCheckinSchema>;

export function atRiskCheckin(input: { today: string; quietDays: number; firstCheckinOn: string | null; gymDays: readonly string[] }): AtRiskCheckin {
  if (input.firstCheckinOn === null || !isDay(input.firstCheckinOn) || !isDay(input.today)) return "none";
  if (daysBetween(input.firstCheckinOn, input.today) < input.quietDays) return "new";
  const from = addDays(input.today, -input.quietDays);
  const lately = new Set(input.gymDays.filter((day) => isDay(day) && day > from && day <= input.today));
  return lately.size < atRiskGymDays(input.quietDays) ? "stopped" : "in_use";
}

// ── THE WIRE ──

export const atRiskSettingsSchema = z
  .object({
    quietDays: z.number().int().refine((n) => AT_RISK_QUIET_DAYS.some((d) => d === n)),
    weeksCame: z.number().int().refine((n) => AT_RISK_WEEKS_CAME.some((w) => w === n)),
  })
  .strict();
export type AtRiskSettings = z.infer<typeof atRiskSettingsSchema>;

/** Who a message can go to: the one app account that holds the record. */
export const atRiskAppSchema = z.enum(["one", "none", "shared"]);

export const atRiskPersonSchema = z.object({
  /** The record on the gym's list, when they have one. */
  entryId: z.string().uuid().nullable(),
  /** The app account a message goes to, when exactly one holds the record. */
  userId: z.string().uuid().nullable(),
  app: atRiskAppSchema,
  name: z.string(),
  lastVisitOn: daySchema,
  daysAway: z.number().int().min(0),
  weeksCame: z.number().int().min(1).max(AT_RISK_WEEKS),
  /** The gym's newest come-back message to them, and when another may go (null: now). */
  lastMessage: gymNudgeSchema.nullable(),
  messageableAt: z.string().nullable(),
});
export type AtRiskPerson = z.infer<typeof atRiskPersonSchema>;

export const atRiskResponseSchema = z.object({
  settings: atRiskSettingsSchema,
  today: daySchema,
  checkin: atRiskCheckinSchema,
  firstCheckinOn: daySchema.nullable(),
  lastCheckinOn: daySchema.nullable(),
  /** Everybody at risk, and the first `AT_RISK_MAX` of them. */
  total: z.number().int().min(0),
  people: z.array(atRiskPersonSchema).max(AT_RISK_MAX),
});
export type AtRiskResponse = z.infer<typeof atRiskResponseSchema>;

export const atRiskSettingsResponseSchema = z.object({ settings: atRiskSettingsSchema });
export type AtRiskSettingsResponse = z.infer<typeof atRiskSettingsResponseSchema>;

/** The list's order: who came most regularly first, then who stopped most lately, then by
 *  name, so a reload never reshuffles it. */
export function atRiskOrder(a: Pick<AtRiskPerson, "weeksCame" | "daysAway" | "name" | "entryId" | "userId">, b: Pick<AtRiskPerson, "weeksCame" | "daysAway" | "name" | "entryId" | "userId">): number {
  if (a.weeksCame !== b.weeksCame) return b.weeksCame - a.weeksCame;
  if (a.daysAway !== b.daysAway) return a.daysAway - b.daysAway;
  const names = a.name.localeCompare(b.name, "en");
  if (names !== 0) return names;
  const ka = a.entryId ?? a.userId ?? "";
  const kb = b.entryId ?? b.userId ?? "";
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
