import type { BodyMeasurement, WaitingBodyEntry } from "@app/shared";
import { dateWords, entryDay } from "./otherRules";

// Body's Log measurements, its chart and its list (ROADMAP Stage 5 35c-ii). Pure, so tested alone.
// The measurements are the browser's own nine, under the same keys, so an entry logged on either is
// the same entry on both.

export type MeasureKey = "weight" | "body_fat_pct" | "waist_cm" | "chest_cm" | "hips_cm" | "left_arm_cm" | "right_arm_cm" | "left_thigh_cm" | "right_thigh_cm";
type Kind = "weight" | "pct" | "length";

export const MEASURES: readonly { key: MeasureKey; name: string; kind: Kind }[] = [
  { key: "weight", name: "Weight", kind: "weight" },
  { key: "body_fat_pct", name: "Body fat", kind: "pct" },
  { key: "waist_cm", name: "Waist", kind: "length" },
  { key: "chest_cm", name: "Chest", kind: "length" },
  { key: "hips_cm", name: "Hips", kind: "length" },
  { key: "left_arm_cm", name: "Left arm", kind: "length" },
  { key: "right_arm_cm", name: "Right arm", kind: "length" },
  { key: "left_thigh_cm", name: "Left thigh", kind: "length" },
  { key: "right_thigh_cm", name: "Right thigh", kind: "length" },
];

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

const imperial = (units: string) => units === "imperial";
export const unitOf = (kind: Kind, units: string): string => (kind === "pct" ? "%" : kind === "weight" ? (imperial(units) ? "lb" : "kg") : imperial(units) ? "in" : "cm");

/** What the box takes, in the person's units: a weight a person can have, a body fat a scale shows,
 *  a size a tape reaches. Outside these the number was mistyped. */
const LIMITS: Readonly<Record<Kind, { metric: [number, number]; imperial: [number, number] }>> = {
  weight: { metric: [20, 400], imperial: [44, 880] },
  pct: { metric: [2, 75], imperial: [2, 75] },
  length: { metric: [10, 300], imperial: [4, 118] },
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const tenth = (n: number) => {
  const t = Math.round(n * 10) / 10;
  return Number.isInteger(t) ? String(t) : t.toFixed(1);
};

/** A size most people would be near, for an empty box: its faint words say what goes in it. */
const EXAMPLES: Readonly<Record<MeasureKey, readonly [number, number]>> = {
  weight: [70, 155],
  body_fat_pct: [20, 20],
  waist_cm: [85, 33],
  chest_cm: [95, 37],
  hips_cm: [95, 37],
  left_arm_cm: [32, 13],
  right_arm_cm: [32, 13],
  left_thigh_cm: [55, 22],
  right_thigh_cm: [55, 22],
};
export const exampleOf = (key: MeasureKey, units: string): string => String(EXAMPLES[key][imperial(units) ? 1 : 0]);

/** A kept value (kg, %, cm) in the person's units, to one place where it has one. */
export function shown(value: number, kind: Kind, units: string): string {
  if (kind === "weight" && imperial(units)) return tenth(value / KG_PER_LB);
  if (kind === "length" && imperial(units)) return tenth(value / CM_PER_IN);
  return tenth(value);
}

export const shownWithUnit = (value: number, kind: Kind, units: string): string => `${shown(value, kind, units)}${kind === "pct" ? " %" : ` ${unitOf(kind, units)}`}`;

/** The value an entry holds for one measurement, as kept (kg, %, cm), or null. */
export function valueOf(m: Pick<BodyMeasurement, "weightKg" | "metrics">, key: MeasureKey): number | null {
  if (key === "weight") return m.weightKg;
  const v = m.metrics[key];
  return v === undefined ? null : v;
}

export type Typed = Partial<Record<MeasureKey, string>>;
export type Built =
  | { ok: true; weightKg: number | null; metrics: Record<string, number> }
  | { ok: false; errors: Partial<Record<MeasureKey, string>>; none: boolean };

/** The box's numbers as the server keeps them, or what is wrong with each. A comma is a decimal point,
 *  as many phones' keyboards type it. */
export function buildEntry(typed: Typed, units: string): Built {
  const errors: Partial<Record<MeasureKey, string>> = {};
  const metrics: Record<string, number> = {};
  let weightKg: number | null = null;
  let any = false;
  for (const m of MEASURES) {
    const raw = (typed[m.key] ?? "").trim().replace(",", ".");
    if (raw === "") continue;
    any = true;
    const n = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
    const [low, high] = LIMITS[m.kind][imperial(units) ? "imperial" : "metric"];
    if (!Number.isFinite(n) || n < low || n > high) {
      errors[m.key] = `Enter ${m.kind === "weight" ? "a weight" : m.kind === "pct" ? "a body fat" : "a size"} between ${String(low)} and ${String(high)} ${unitOf(m.kind, units)}.`;
      continue;
    }
    const kept = round2(m.kind === "weight" && imperial(units) ? n * KG_PER_LB : m.kind === "length" && imperial(units) ? n * CM_PER_IN : n);
    if (m.key === "weight") weightKg = kept;
    else metrics[m.key] = kept;
  }
  if (!any) return { ok: false, errors: {}, none: true };
  if (Object.keys(errors).length > 0) return { ok: false, errors, none: false };
  return { ok: true, weightKg, metrics };
}

/** An entry waiting on the phone, drawn as the server will keep it. */
export function asMeasurement(w: WaitingBodyEntry): BodyMeasurement {
  return { id: w.id, measuredAt: w.measuredAt, weightKg: w.weightKg, metrics: w.metrics, source: "manual", createdAt: w.measuredAt };
}

/** Body's list: the server's entries, those it has just taken, and those still waiting, newest first;
 *  none removed here. `waiting` names the ones the server does not have yet. */
export function bodyList(
  read: readonly BodyMeasurement[],
  view: { waiting: readonly WaitingBodyEntry[]; landed: readonly BodyMeasurement[]; removing: ReadonlySet<string> },
): { items: BodyMeasurement[]; waiting: ReadonlySet<string> } {
  const byId = new Map<string, BodyMeasurement>();
  for (const m of read) byId.set(m.id, m);
  for (const m of view.landed) if (!byId.has(m.id)) byId.set(m.id, m);
  const waiting = new Set<string>();
  for (const w of view.waiting) {
    if (byId.has(w.id)) continue;
    byId.set(w.id, asMeasurement(w));
    waiting.add(w.id);
  }
  const items = [...byId.values()]
    .filter((m) => !view.removing.has(m.id))
    .sort((a, b) => entryDay(b).getTime() - entryDay(a).getTime() || (a.id < b.id ? 1 : -1));
  return { items, waiting };
}

/** The measurements this person has logged at least once, in the box's order: the chart's chips. */
export function loggedMeasures(items: readonly BodyMeasurement[]): MeasureKey[] {
  return MEASURES.filter((m) => items.some((i) => valueOf(i, m.key) !== null)).map((m) => m.key);
}

/** The newest value of each measurement: the box's "Last" under each. */
export function lastValues(items: readonly BodyMeasurement[]): Partial<Record<MeasureKey, number>> {
  const out: Partial<Record<MeasureKey, number>> = {};
  for (const m of MEASURES) {
    const found = items.find((i) => valueOf(i, m.key) !== null);
    const v = found === undefined ? null : valueOf(found, m.key);
    if (v !== null) out[m.key] = v;
  }
  return out;
}

export interface SeriesPoint {
  id: string;
  day: Date;
  value: number;
}

/** One measurement's newest `most` entries, oldest first: the chart's line. */
export function series(items: readonly BodyMeasurement[], key: MeasureKey, most = 10): SeriesPoint[] {
  return items
    .flatMap((m) => {
      const v = valueOf(m, key);
      return v === null ? [] : [{ id: m.id, day: entryDay(m), value: v }];
    })
    .slice(0, most)
    .reverse();
}

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const shortDay = (d: Date) => `${String(d.getDate())} ${SHORT[d.getMonth()] ?? ""}`;

/** How the newest value moved from the one before it, in the person's units: "▼ 0.5 kg since 28 Oct". */
export function changeWords(points: readonly SeriesPoint[], key: MeasureKey, units: string): { words: string; down: boolean | null } | null {
  const last = points.at(-1);
  const before = points.at(-2);
  if (last === undefined || before === undefined) return null;
  const kind = MEASURES.find((m) => m.key === key)?.kind ?? "length";
  const a = Number(shown(before.value, kind, units));
  const b = Number(shown(last.value, kind, units));
  const since = `since ${shortDay(before.day)}`;
  if (a === b) return { words: `No change ${since}`, down: null };
  return { words: `${b < a ? "▼" : "▲"} ${tenth(Math.abs(b - a))} ${kind === "pct" ? "%" : unitOf(kind, units)} ${since}`, down: b < a };
}

/** One entry's line on Body: its day, how it came, its weight and how many more it holds. */
export function entryWords(m: BodyMeasurement, units: string, waiting: boolean): { date: string; how: string; weight: string; more: string | null } {
  const others = Object.keys(m.metrics).length;
  return {
    date: dateWords(entryDay(m)),
    how: waiting ? "Waiting to send" : m.source === "self_reported" ? "Typed by you" : "Logged",
    weight: m.weightKg === null ? "No weight" : shownWithUnit(m.weightKg, "weight", units),
    more: others === 0 ? null : `${String(others)} ${others === 1 ? "measurement" : "measurements"}`,
  };
}

/** A refused entry's line: which entry it was, then why. */
export function refusedWords(r: { message: string; measuredAt?: string | undefined; weightKg?: number | null | undefined }, units: string): string {
  if (r.measuredAt === undefined) return r.message;
  const what = `${dateWords(new Date(r.measuredAt))}${r.weightKg === null || r.weightKg === undefined ? "" : `, ${shownWithUnit(r.weightKg, "weight", units)}`}`;
  return `${what}: ${r.message}`;
}

/** What the Remove box says the entry holds: "Weight and 2 measurements". */
export function holdsWords(m: BodyMeasurement): string {
  const others = Object.keys(m.metrics).length;
  const more = `${String(others)} ${others === 1 ? "measurement" : "measurements"}`;
  if (m.weightKg === null) return others === 0 ? "No measurements" : more;
  return others === 0 ? "Weight" : `Weight and ${more}`;
}
