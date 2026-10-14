// Your week in food (ROADMAP 34f-i; 7d): the last 7 or 30 days of the person's own
// meals against each day's targets, and the plain facts under them. Pure: the
// database adds up each day (repo `foodDays`); the service reads those, the kept
// targets and today's, and hands them here.
import {
  FOOD_WEEK_FIGURES,
  foodWeekResponseSchema,
  type FoodBand,
  type FoodDayTargets,
  type FoodWeekDay,
  type FoodWeekFact,
  type FoodWeekResponse,
  type MoreTotal,
} from "@app/shared";

/** A figure within this share of its target, either way, is "on" target. */
export const ON_TARGET_SHARE = 0.1;

/** Under, on or over: within 10 % either way is on, the edges included. Compared in
 *  tenths of a gram, so 90 % of a target is on and a hair under it is under. */
export function bandOf(eaten: number, target: number): FoodBand {
  const tenths = Math.round(eaten * 10);
  const low = Math.round(target * 10 * (1 - ON_TARGET_SHARE));
  const high = Math.round(target * 10 * (1 + ON_TARGET_SHARE));
  if (tenths < low) return "under";
  if (tenths > high) return "over";
  return "on";
}

/** The `span` days ending on `today`, oldest first, as YYYY-MM-DD. */
export function spanDays(today: string, span: number): string[] {
  const [y, m, d] = today.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) throw new Error(`not a day: ${today}`);
  const days: string[] = [];
  for (let back = span - 1; back >= 0; back--) {
    days.push(new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10));
  }
  return days;
}

/** A day's logged meals added up, on its day of the person's own time zone. */
export interface DayTotals {
  day: string;
  meals: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** A food in the day is the scanner's own estimate. */
  about: boolean;
  fiberG: MoreTotal;
  sodiumMg: MoreTotal;
}

export interface WeekInput {
  span: 7 | 30;
  today: string;
  /** Only days with a meal; the rest of the span is empty days. */
  logged: readonly DayTotals[];
  /** The targets kept on a day (food_day_targets), by day. */
  kept: ReadonlyMap<string, FoodDayTargets>;
  /** Today's targets, the rings' own; null while the plan has no numbers. */
  current: FoodDayTargets | null;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

export function foodWeek(input: WeekInput): FoodWeekResponse {
  const byDay = new Map(input.logged.map((d) => [d.day, d]));
  const days = spanDays(input.today, input.span).map((day): FoodWeekDay => {
    const got = byDay.get(day);
    // Today is always read against today's targets: they can change during the day.
    const keptOnDay = day === input.today ? undefined : input.kept.get(day);
    const targets = keptOnDay ?? input.current;
    const meals = got?.meals ?? 0;
    const eaten = {
      kcal: got?.kcal ?? 0,
      proteinG: round1(got?.proteinG ?? 0),
      carbsG: round1(got?.carbsG ?? 0),
      fatG: round1(got?.fatG ?? 0),
    };
    return {
      day,
      today: day === input.today,
      meals,
      about: got?.about ?? false,
      ...eaten,
      // Kept as each food's figure is: fibre to a tenth of a gram, salt to the milligram.
      fiberG: { amount: round1(got?.fiberG.amount ?? 0), notKnown: got?.fiberG.notKnown ?? 0 },
      sodiumMg: { amount: Math.round(got?.sodiumMg.amount ?? 0), notKnown: got?.sodiumMg.notKnown ?? 0 },
      targets,
      targetsOfTheDay: targets !== null && (day === input.today || keptOnDay !== undefined),
      bands:
        meals === 0 || targets === null
          ? null
          : {
              kcal: bandOf(eaten.kcal, targets.kcal),
              proteinG: bandOf(eaten.proteinG, targets.proteinG),
              carbsG: bandOf(eaten.carbsG, targets.carbsG),
              fatG: bandOf(eaten.fatG, targets.fatG),
            },
    };
  });
  // The facts count finished days only: today is still going.
  const judged = days.filter((d) => !d.today);
  const fact = (figure: (typeof FOOD_WEEK_FIGURES)[number]): FoodWeekFact => {
    const f = { under: 0, on: 0, over: 0, judged: 0 };
    for (const d of judged) {
      if (d.bands === null) continue;
      f[d.bands[figure]] += 1;
      f.judged += 1;
    }
    return f;
  };
  return foodWeekResponseSchema.parse({
    span: input.span,
    days,
    facts: { kcal: fact("kcal"), proteinG: fact("proteinG"), carbsG: fact("carbsG"), fatG: fact("fatG") },
  });
}
