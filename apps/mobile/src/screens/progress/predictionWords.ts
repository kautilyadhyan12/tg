import type { BestTime, CalorieForecast, SteadyPace, TimeSlot, WeekGoalPrediction } from "@app/shared";
import { count } from "../dashboard/words";

// What Progress's Predictions say (ROADMAP Stage 5 35c-i; the server's rules are 35a's, spec Part 2B
// §5). The server works every number out; these put it into words, and say plainly when a part is not
// ready yet and what it waits for. Pure, so tested alone.

const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

export interface ForecastDay {
  letter: string;
  low: number;
  high: number;
  point: number;
}

export interface Mini {
  value: string;
  /** Beside the value, smaller: "kcal". */
  unit?: string;
  lines: string[];
  /** Orange where something moved: a shorter workout, a tough week. */
  warm: boolean;
}

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const letterOf = (key: string) => {
  const [y = 0, m = 1, d = 1] = key.split("-").map(Number);
  return LETTERS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
};

export function forecastMini(f: CalorieForecast): Mini & { days: ForecastDay[] } {
  if (!f.available) {
    const lines =
      f.reason === "too_new" ? ["Ready a week after your first workout"] : [`${count(f.workouts)} of ${count(f.needed)} workouts in the last 4 weeks`];
    return { value: "Not yet", lines, warm: false, days: [] };
  }
  return {
    value: `~${count(f.totalPoint)}`,
    unit: "kcal",
    lines: [],
    warm: false,
    days: f.days.map((d) => ({ letter: letterOf(d.date), low: d.kcalLow, high: d.kcalHigh, point: d.kcalPoint })),
  };
}

const SLOTS: Record<TimeSlot, { name: string; hours: string }> = {
  morning: { name: "Morning", hours: "5 am – 12 pm" },
  afternoon: { name: "Afternoon", hours: "12 pm – 5 pm" },
  evening: { name: "Evening", hours: "5 pm – 10 pm" },
  night: { name: "Night", hours: "10 pm – 5 am" },
};

export function bestTimeMini(b: BestTime): Mini & { slot: TimeSlot | null } {
  if (!b.available) return { value: "Not yet", lines: [`${count(b.workouts)} of ${count(b.needed)} workouts with a form score`], warm: false, slot: null };
  if (b.best === null) return { value: "Not yet", lines: ["Ready once one time of day has 2 workouts"], warm: false, slot: null };
  const total = b.slots.reduce((n, s) => n + s.workouts, 0);
  const mine = b.slots.find((s) => s.slot === b.best)?.workouts ?? 0;
  return { value: SLOTS[b.best].name, lines: [`${count(mine)} of ${plural(total, "workout", "workouts")}`, SLOTS[b.best].hours], warm: false, slot: b.best };
}

type Figure = "minutes" | "kcal" | "form";
const FIGURE_NAMES: Record<Figure, string> = { minutes: "Minutes", kcal: "Calories", form: "Form" };
/** The headline when a figure moved the most: down, then up. */
const MOVED: Record<Figure, readonly [string, string]> = {
  minutes: ["Shorter workouts", "Longer workouts"],
  kcal: ["Fewer calories", "More calories"],
  form: ["Form slipping", "Form rising"],
};

const changeWords = (pct: number) => {
  const whole = Math.round(Math.abs(pct));
  if (whole === 0) return "";
  return pct < 0 ? ` ▼${String(whole)}%` : ` ▲${String(whole)}%`;
};

/** The web's Plateau Detector: the last 2 weeks beside the 4 weeks before them. */
export function plateauMini(s: SteadyPace): Mini {
  if (!s.available) {
    if (s.reason === "nothing_to_compare") return { value: "Not yet", lines: ["Nothing to compare yet"], warm: false };
    return { value: "Not yet", lines: [`${count(s.recent + s.before)} of ${count(s.needed)} workouts in the last 6 weeks`], warm: false };
  }
  const figures: { key: Figure; before: number; recent: number; changePct: number }[] = [];
  for (const key of ["minutes", "kcal", "form"] as const) {
    const f = s[key];
    if (f !== null) figures.push({ key, ...f });
  }
  const lines = figures.map((f) => `${FIGURE_NAMES[f.key]} ${count(f.before)} → ${count(f.recent)}${changeWords(f.changePct)}`);
  if (s.steady) return { value: "Steady", lines, warm: false };
  const moved = figures.reduce<(typeof figures)[number] | null>((most, f) => (most === null || Math.abs(f.changePct) > Math.abs(most.changePct) ? f : most), null);
  if (moved === null) return { value: "Steady", lines, warm: false };
  return { value: MOVED[moved.key][moved.changePct < 0 ? 0 : 1], lines, warm: moved.changePct < 0 };
}

const BANDS = { reached: "Reached", on_track: "On track", doable: "Doable", tough: "Tough week" } as const;

export function weekGoalMini(w: WeekGoalPrediction): Mini & { steps: { done: number; of: number } | null } {
  if (!w.available) {
    if (w.reason === "no_goal") return { value: "No goal", lines: ["No weekly training goal set"], warm: false, steps: null };
    const left = Math.max(1, w.needed - w.weeks);
    return {
      value: `${count(w.weeks)} of ${count(w.needed)} weeks`,
      lines: [left === 1 ? "Ready next week" : `Ready in ${count(left)} weeks`],
      warm: false,
      steps: { done: Math.min(w.weeks, w.needed), of: w.needed },
    };
  }
  const lines = [`${count(w.done)} of ${plural(w.target, "day", "days")} this week`];
  if (w.band === "doable") lines.push(`${plural(w.moreNeeded, "more day", "more days")} to go`);
  if (w.band === "tough") lines.push("One workout keeps your streak going");
  return { value: BANDS[w.band], lines, warm: w.band === "tough", steps: { done: Math.min(w.done, w.target), of: w.target } };
}

/** Under the box's title: what the predictions are read from. */
export function predictionsFrom(workouts: number): string {
  return `From your ${plural(workouts, "workout", "workouts")}`;
}
