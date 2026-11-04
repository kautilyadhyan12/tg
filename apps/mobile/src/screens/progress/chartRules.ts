import { count } from "../dashboard/words";
import type { Bucket, Step } from "./progressRules";

// How Progress's charts are drawn (ROADMAP Stage 5 35c-i): where each point stands, the line through
// them, the guide numbers, the average and the picked bar's words. Pure, so tested alone.

export interface Pt {
  x: number;
  y: number;
}

const fix = (n: number) => (Math.round(n * 10) / 10).toString();

/** The two control points of each piece of a smooth line through the points that never rises above
 *  or dips below the two points it joins (monotone cubic, Fritsch–Carlson): a chart never shows a week
 *  higher than it was. */
export function monotoneControls(p: readonly Pt[]): { c1: Pt; c2: Pt; to: Pt }[] {
  const n = p.length;
  if (n < 2) return [];
  const at = (i: number): Pt => p[i] ?? { x: 0, y: 0 };
  const d: number[] = [];
  for (let k = 0; k < n - 1; k += 1) {
    const dx = at(k + 1).x - at(k).x;
    d.push(dx === 0 ? 0 : (at(k + 1).y - at(k).y) / dx);
  }
  const dk = (i: number) => d[i] ?? 0;
  const m: number[] = [];
  for (let k = 0; k < n; k += 1) {
    if (k === 0) m.push(dk(0));
    else if (k === n - 1) m.push(dk(n - 2));
    else m.push(dk(k - 1) * dk(k) <= 0 ? 0 : (dk(k - 1) + dk(k)) / 2);
  }
  for (let k = 0; k < n - 1; k += 1) {
    if (dk(k) === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = (m[k] ?? 0) / dk(k);
    const b = (m[k + 1] ?? 0) / dk(k);
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[k] = t * a * dk(k);
      m[k + 1] = t * b * dk(k);
    }
  }
  const out: { c1: Pt; c2: Pt; to: Pt }[] = [];
  for (let k = 0; k < n - 1; k += 1) {
    const from = at(k);
    const to = at(k + 1);
    const third = (to.x - from.x) / 3;
    out.push({
      c1: { x: from.x + third, y: from.y + (m[k] ?? 0) * third },
      c2: { x: to.x - third, y: to.y - (m[k + 1] ?? 0) * third },
      to,
    });
  }
  return out;
}

export function monotonePath(p: readonly Pt[]): string {
  const first = p[0];
  if (first === undefined) return "";
  return [`M${fix(first.x)} ${fix(first.y)}`, ...monotoneControls(p).map(({ c1, c2, to }) => `C${fix(c1.x)} ${fix(c1.y)} ${fix(c2.x)} ${fix(c2.y)} ${fix(to.x)} ${fix(to.y)}`)].join(" ");
}

/** The middle of each of `n` columns across `width`, `gap` between them: a point stands over its date. */
export function columnCentres(width: number, n: number, gap: number): number[] {
  if (n <= 0) return [];
  const column = (width - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => column * (i + 0.5) + gap * i);
}

/** A number rounded down to its first figure: 63 → 60, 31.5 → 30, 168 → 100, 7 → 7. */
export function firstFigure(v: number): number {
  if (v <= 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.floor(v / mag) * mag;
}

/** The faint guide lines' numbers: 0, about half the top and about the top, never two the same. */
export function guides(top: number): number[] {
  if (top <= 0) return [0];
  return [...new Set([0, firstFigure(top / 2), firstFigure(top)])];
}

/** The bar a chart picks first: the highest, the later of two the same; null where every bar is 0. */
export function bestIndex(values: readonly number[]): number | null {
  let best: number | null = null;
  let top = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? 0;
    if (v > 0 && v >= top) {
      best = i;
      top = v;
    }
  }
  return best;
}

/** The average of the period's bars, every bar counted, as the dashed line shows it. */
export function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const parts = (key: string) => {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return { y, m, d, month: MONTHS[m - 1] ?? "" };
};

/** A bar's days in a few words: "21 Oct", "19–25 Oct", "26 Oct – 1 Nov", "Oct", "2026". */
export function rangeWords(bar: Pick<Bucket, "from" | "to">, step: Step): string {
  const a = parts(bar.from);
  const b = parts(bar.to);
  if (step === "year") return String(a.y);
  if (step === "month" && a.y === b.y && a.m === b.m && a.d === 1) return `${a.month} ${String(a.y)}`;
  if (bar.from === bar.to) return `${String(a.d)} ${a.month}`;
  if (a.y === b.y && a.m === b.m) return `${String(a.d)}–${String(b.d)} ${a.month}`;
  return `${String(a.d)} ${a.month} – ${String(b.d)} ${b.month}`;
}

/** The picked bar's tag: its days and its number. */
export function tagWords(bar: Pick<Bucket, "from" | "to">, step: Step, value: number): string {
  return `${rangeWords(bar, step)} · ${count(value)}`;
}
