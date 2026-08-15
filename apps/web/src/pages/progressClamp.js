// Progress history read-gate display (Part 4 §0.2; T3 Card 3 finding f.4).
//
// Every /v1/progress response carries `limitedToDays` (shared/progress.ts) —
// the caller's plan window, `null` when unlimited. The page ignored it, so a
// free user picking "1 Year" saw 90 days of data captioned "in 1 Year": the
// numbers honest, the label not.
//
// THE FACT EVERY STRING HERE MUST RESPECT: this is a READ GATE, NOT DELETION
// (seed.ts:44 says so in as many words; workouts/repo.ts:183 just adds
// `AND started_at >= since`, and nothing anywhere deletes a workout).
// Upgrading lifts the filter and the whole history reappears instantly. A
// notice implying lost data would be its own falsehood.

/** Requested window in days; `all` is unbounded. Mirrors the API's own
 *  `progressPeriodSchema` enum (7d/30d/90d/1y/all) and its `sinceFor`. */
export const PERIOD_DAYS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
  all: null,
};

/** THE period list — exported so the page maps this instead of keeping its
 *  own copy (T3 R1: two lists with no link meant a period added to one
 *  degraded the other silently, and the page's copy was untestable). */
export const PERIODS = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "1y", label: "1 Year" },
  { value: "all", label: "All Time" },
];

const PERIOD_LABELS = Object.fromEntries(PERIODS.map((p) => [p.value, p.label]));

/** The clamp ONLY when it actually cuts the requested window, else null.
 *
 *  The server reports `limitedToDays` UNCONDITIONALLY — a free user asking for
 *  7 days still gets 90 back (workouts/service.ts:134,:231: the gate value is
 *  never compared to the period). Rendering on that alone would warn about a
 *  limit that is not limiting — sourced from a real field, still false. */
export function effectiveClamp(period, limitedToDays) {
  if (typeof limitedToDays !== "number" || !Number.isFinite(limitedToDays) || limitedToDays <= 0)
    return null;
  if (!(period in PERIOD_DAYS)) return null; // unknown period: never guess
  const requested = PERIOD_DAYS[period];
  if (requested === null) return limitedToDays; // 'all' is unbounded → always cut
  return limitedToDays < requested ? limitedToDays : null;
}

/** TWO cards on this page read PERIOD-LESS endpoints that are gated anyway, so
 *  the period-driven notice above is silent while their own headings lie
 *  (T3: f.4 was only half-closed by the notice).
 *
 *  The heatmap always asks for a fixed 365 days
 *  (`clamp(now − 365d, gate.floor)`, workouts/service.ts:257-259), so a 90-day
 *  plan cuts it at EVERY period — including 7d/30d/90d, where the notice
 *  correctly stays quiet. Its hard-coded "Last 365 Days" heading was therefore
 *  f.4's exact lie, one card lower on the same page. */
export function heatmapCaption(limitedToDays) {
  const days = effectiveClamp("1y", limitedToDays); // the heatmap's own window
  return days === null ? "Last 365 Days" : `Last ${days} Days`;
}

/** Personal records: `personalRecords` passes `gate.floor` with NO period
 *  (service.ts:281), so a gated user's records are plan-window records at every
 *  period — never truthful under a period-driven notice.
 *
 *  `longestStreak` is DELIBERATELY ungated (service.ts:288-290: "streaks are
 *  identity, not history reads"), so a flat card-level "last 90 days" would be
 *  a NEW inaccuracy. The note carves it out by name. */
export function recordsNote(limitedToDays) {
  const days = effectiveClamp("1y", limitedToDays);
  if (days === null) return null;
  return `On your plan these cover the last ${days} days. Longest streak is all-time.`;
}

/** The Dashboard's three lifetime totals: "all time", or the window that
 *  actually produced them.
 *
 *  Third sibling of `heatmapCaption` and `recordsNote`, and the same shape of
 *  defect. The Dashboard asks `/v1/progress/overview?period=all` and prints
 *  "all time" underneath — but `all` is unbounded, so a plan floor cuts it
 *  EVERY time (`effectiveClamp('all', …)` returns the limit for exactly that
 *  reason). A gated user therefore reads a 90-day total captioned "all time":
 *  f.4's lie again, on the screen they see first.
 *
 *  Lives here rather than beside the reader so all three period-less captions
 *  are one ladder — a fourth spelling of "the last N days" is how a screen
 *  starts describing the same window two ways. */
export function totalsWindowLabel(limitedToDays) {
  const days = effectiveClamp("all", limitedToDays);
  return days === null ? "all time" : `last ${days} ${days === 1 ? "day" : "days"}`;
}

/** What the page should render: whether to show the notice, and the caption
 *  for "in {…}" — corrected to the window actually shown, because a notice
 *  sitting beside a label still reading "1 Year" only half-fixes the lie. */
export function clampNotice(period, limitedToDays) {
  const days = effectiveClamp(period, limitedToDays);
  if (days === null)
    return { show: false, days: null, caption: PERIOD_LABELS[period] ?? "the selected period" };
  return { show: true, days, caption: `the last ${days} ${days === 1 ? "day" : "days"}` };
}
