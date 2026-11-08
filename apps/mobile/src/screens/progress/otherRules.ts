import type { BodyMeasurement, ProgressDistribution } from "@app/shared";
import { count } from "../dashboard/words";
import { weightWords } from "../goals/words";

// Progress's Exercise Categories and Body (ROADMAP Stage 5 35c-i). Pure, so tested alone.

/** The exercise families by the names gyms use (spec Part 2 §5's F1 to F12), never their codes. */
export const FAMILY_NAMES: Readonly<Record<string, string>> = {
  F1: "Squats",
  F2: "Hinges",
  F3: "Bridges",
  F4: "Lunges",
  F5: "Push-ups",
  F6: "Overhead presses",
  F7: "Pulls",
  F8: "Curls and raises",
  F9: "Core",
  F10: "Holds",
  F11: "Cardio",
  F12: "Mobility",
};

export interface Slice {
  name: string;
  sets: number;
  /** Whole percent of all the sets. */
  pct: number;
}

/** The three families with the most sets, and the rest together as "Other"; a family the app does
 *  not know by name is counted in "Other" too. */
export function slices(d: Pick<ProgressDistribution, "families">): Slice[] {
  const total = d.families.reduce((n, f) => n + Math.max(0, f.sets), 0);
  if (total === 0) return [];
  const named = d.families
    .filter((f) => f.sets > 0 && FAMILY_NAMES[f.family] !== undefined)
    .sort((a, b) => b.sets - a.sets || a.family.localeCompare(b.family));
  const top = named.slice(0, 3);
  const other = total - top.reduce((n, f) => n + f.sets, 0);
  const out: Slice[] = top.map((f) => ({ name: FAMILY_NAMES[f.family] ?? "Other", sets: f.sets, pct: Math.round((f.sets / total) * 100) }));
  if (other > 0) out.push({ name: "Other", sets: other, pct: Math.round((other / total) * 100) });
  return out;
}

export const setsWords = (n: number) => `${count(n)} ${n === 1 ? "set" : "sets"}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The day an entry belongs to on the phone: a weight typed in setup is dated by when it was typed,
 *  as the browser shows it (its `measuredAt` can sit ahead of the clock). */
export function entryDay(m: Pick<BodyMeasurement, "source" | "measuredAt" | "createdAt">): Date {
  return new Date(m.source === "self_reported" ? m.createdAt : m.measuredAt);
}

export const dateWords = (d: Date) => `${String(d.getDate())} ${MONTHS[d.getMonth()] ?? ""} ${String(d.getFullYear())}`;

export interface EntryRow {
  id: string;
  date: string;
  /** "Typed by you" for a weight typed in setup, "Logged" otherwise. */
  how: string;
  weight: string;
  /** The other measurements kept with it: "2 measurements", or null. */
  more: string | null;
}

export function entryRows(items: readonly BodyMeasurement[], units: string, most = 5): EntryRow[] {
  return items.slice(0, most).map((m) => {
    const others = Object.keys(m.metrics).length;
    return {
      id: m.id,
      date: dateWords(entryDay(m)),
      how: m.source === "self_reported" ? "Typed by you" : "Logged",
      weight: m.weightKg === null ? "No weight" : weightWords(m.weightKg, units),
      more: others === 0 ? null : `${count(others)} ${others === 1 ? "measurement" : "measurements"}`,
    };
  });
}

/** The newest entry with a weight: the big number on Body. */
export function latestWeight(items: readonly BodyMeasurement[]): BodyMeasurement | null {
  return items.find((m) => m.weightKg !== null) ?? null;
}
