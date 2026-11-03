import type { FoodBand, FoodWeekDay, FoodWeekFact, FoodWeekFigure, FoodWeekResponse } from "@app/shared";
import { count } from "../dashboard/words";
import type { Sums } from "./day";

// Your week in food on the Food screen (ROADMAP Stage 5 34f-ii): the bars and the sentences under them.
// Every day, band and count is the server's (34f-i); the phone only picks the words. Today's bar is
// the one exception: it is drawn from the numbers the day's rings show, so the two always agree.

export const WEEK_FIGURES: readonly { key: FoodWeekFigure; name: string; unit: string; verb: "was" | "were" }[] = [
  { key: "kcal", name: "Calories", unit: "kcal", verb: "were" },
  { key: "proteinG", name: "Protein", unit: "g", verb: "was" },
  { key: "carbsG", name: "Carbs", unit: "g", verb: "were" },
  { key: "fatG", name: "Fat", unit: "g", verb: "was" },
];

const BAND_WORDS: Record<FoodBand, string> = { under: "under target", on: "on target", over: "over target" };
/** On a tie the steadier word comes first. */
const BAND_ORDER: readonly FoodBand[] = ["on", "under", "over"];

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A day of the server's, "YYYY-MM-DD", read as a calendar date: the phone's own clock and zone play no part. */
function dateOf(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** The letter under a bar of the week: the day's own weekday. */
export function dayLetter(day: string): string {
  return LETTERS[dateOf(day).getUTCDay()] ?? "";
}

/** The day said in full, for a bar read aloud: "Monday 3 Nov". */
export function dayName(day: string): string {
  const at = dateOf(day);
  return `${WEEKDAYS[at.getUTCDay()] ?? ""} ${String(at.getUTCDate())} ${MONTHS[at.getUTCMonth()] ?? ""}`;
}

/** Under a bar of the 30 days: the date of today and of each week back from it, and nothing between. */
export function monthLabel(day: string, fromEnd: number): string {
  return fromEnd % 7 === 0 ? String(dateOf(day).getUTCDate()) : "";
}

/** One fact in words: "Protein was under target on 5 of 6 days." Null while no finished day is judged. */
export function factWords(figure: FoodWeekFigure, fact: FoodWeekFact): string | null {
  if (fact.judged === 0) return null;
  const of = WEEK_FIGURES.find((f) => f.key === figure);
  if (of === undefined) return null;
  const most = Math.max(fact.under, fact.on, fact.over);
  const lead = BAND_ORDER.filter((b) => fact[b] === most);
  const [first, ...tied] = lead;
  if (first === undefined) return null;
  const days = (n: number) => (n === 1 ? "1 day" : `${count(n)} days`);
  const span = most === fact.judged ? (fact.judged === 1 ? "on 1 day" : `on all ${count(fact.judged)} days`) : `on ${count(most)} of ${days(fact.judged)}`;
  const rest = tied.map((b) => `${BAND_WORDS[b]} on ${count(fact[b])}`);
  const tail = rest.length === 0 ? "" : rest.length === 1 ? ` and ${rest[0] ?? ""}` : `, ${rest.slice(0, -1).join(", ")} and ${rest.at(-1) ?? ""}`;
  return `${of.name} ${of.verb} ${BAND_WORDS[first]} ${span}${tail}.`;
}

export interface Bar {
  day: string;
  /** Null: no meals that day, and no bar. */
  value: number | null;
  /** The day's target for the figure; null while the plan has no numbers. */
  target: number | null;
  /** Null for today, which is still going, and for a day not judged. */
  band: FoodBand | null;
  today: boolean;
  /** A food that day is the scan's estimate. */
  about: boolean;
  /** Read against today's numbers: the day's own were not kept. */
  current: boolean;
}

/** Today as the rings show it: their sums where every meal of today has its numbers, and how many
 *  meals there are. Null where the phone cannot say (the page is on another day, or a meal waits for
 *  its numbers): the server's today is drawn. */
export interface TodayHere {
  /** The day the rings are of, on the phone's own calendar: drawn only on the server's day of that date. */
  day: string;
  sums: Sums;
  meals: number;
  about: boolean;
}

/** A day of the phone's own calendar as the server writes one, "YYYY-MM-DD". */
export function localDayKey(at: Date): string {
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** The phone's own today, where it is the same date as the server's today; otherwise none. */
function hereOn(d: FoodWeekDay, here: TodayHere | null): TodayHere | null {
  return d.today && here !== null && here.day === d.day ? here : null;
}

export function weekBars(week: FoodWeekResponse, figure: FoodWeekFigure, here: TodayHere | null): Bar[] {
  return week.days.map((d: FoodWeekDay) => {
    const mine = hereOn(d, here);
    const meals = mine === null ? d.meals : mine.meals;
    const value = mine === null ? d[figure] : mine.sums[figure];
    return {
      day: d.day,
      value: meals === 0 ? null : value,
      target: d.targets === null ? null : d.targets[figure],
      band: d.today || d.bands === null || meals === 0 ? null : d.bands[figure],
      today: d.today,
      about: mine === null ? d.about : mine.about,
      current: !d.targetsOfTheDay && d.targets !== null && meals > 0 && !d.today,
    };
  });
}

/** The one line across the bars is today's target; a finished day with meals whose own target
 *  differed is still coloured by its own, and the box says so. */
export function targetsDiffer(bars: readonly Bar[], line: number | null): boolean {
  return line !== null && bars.some((b) => !b.today && b.value !== null && b.target !== null && b.target !== line);
}
export const TARGETS_DIFFER_WORDS = "Bars are coloured by each day’s own target.";

/** How tall the chart reads: the biggest bar or target, with a little room over it. */
export function chartTop(bars: readonly Bar[]): number {
  const most = Math.max(0, ...bars.flatMap((b) => [b.value ?? 0, b.target ?? 0]));
  return most <= 0 ? 1 : most * 1.1;
}

/** The one line the Food screen's box shows under its bars. */
export function weekLine(week: FoodWeekResponse, here: TodayHere | null): { words: string; setUp: boolean } {
  const anyMeals = week.days.some((d) => (hereOn(d, here)?.meals ?? d.meals) > 0);
  if (!anyMeals) return { words: "Your week shows here once you log meals.", setUp: false };
  if (week.days.every((d) => d.targets === null)) return { words: "Set your daily numbers to compare your days.", setUp: true };
  return { words: factWords("kcal", week.facts.kcal) ?? "Today counts once it’s over.", setUp: false };
}

/** Fibre and sodium have no target: what the finished days with meals came to on average. */
export function averageLine(week: FoodWeekResponse): { words: string; partial: boolean } | null {
  const days = week.days.filter((d) => !d.today && d.meals > 0);
  if (days.length === 0) return null;
  const fibre = Math.round(days.reduce((n, d) => n + d.fiberG.amount, 0) / days.length);
  const sodium = Math.round(days.reduce((n, d) => n + d.sodiumMg.amount, 0) / days.length);
  const partial = days.some((d) => d.fiberG.notKnown > 0 || d.sodiumMg.notKnown > 0);
  return { words: `A day on average: Fibre ${count(fibre)} g${partial ? "*" : ""} · Sodium ${count(sodium)} mg${partial ? "*" : ""}`, partial };
}

/** A bar read aloud. */
export function barSaid(bar: Bar, figure: FoodWeekFigure): string {
  const of = WEEK_FIGURES.find((f) => f.key === figure);
  const unit = of?.unit ?? "";
  const name = bar.today ? "Today" : dayName(bar.day);
  if (bar.value === null) return `${name}, no meals`;
  const amount = `${bar.about ? "about " : ""}${count(Math.round(bar.value))} ${unit}`;
  const target = bar.target === null ? "" : ` of ${count(bar.target)} ${unit}`;
  const how = bar.today ? ", so far" : bar.band === null ? "" : `, ${BAND_WORDS[bar.band]}`;
  return `${name}, ${amount}${target}${how}`;
}
