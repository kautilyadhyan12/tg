import { describe, it, expect } from "vitest";
import { PERIOD_DAYS, PERIODS, clampNotice, effectiveClamp, heatmapCaption, recordsNote, totalsWindowLabel } from "./progressClamp.js";

// The plan read-gate (Part 4 §0.2; seed.ts:44 `history_days: 90`) is a READ
// GATE, NOT DELETION — repo.ts adds `AND started_at >= since` and nothing
// anywhere deletes a workout. Upgrading restores the full history instantly.
// Every string below has to be true under that fact: a notice that implies
// data loss would be as wrong as no notice at all.
describe("effectiveClamp", () => {
  it("is null for an unlimited plan, whatever the period", () => {
    for (const period of ["7d", "30d", "90d", "1y", "all"])
      expect(effectiveClamp(period, null)).toBeNull();
  });

  // THE TRAP (verified in the API, workouts/service.ts:134,:231): the server
  // reports `limitedToDays` UNCONDITIONALLY — a free user asking for 7 days
  // still gets `limitedToDays: 90`. Firing on that alone would warn about a
  // limit that is not limiting: technically sourced, still false, exactly the
  // class of lie the nutrition-targets card existed to remove.
  it("is null when the requested window already fits inside the plan window", () => {
    expect(effectiveClamp("7d", 90)).toBeNull();
    expect(effectiveClamp("30d", 90)).toBeNull();
    expect(effectiveClamp("90d", 90)).toBeNull(); // equal: clamps nothing
  });

  it("returns the clamp only when it actually cuts the requested window", () => {
    expect(effectiveClamp("1y", 90)).toBe(90);
    expect(effectiveClamp("all", 90)).toBe(90);
    expect(effectiveClamp("30d", 7)).toBe(7); // a tighter plan bites sooner
  });

  it("treats 'all' as unbounded, so any finite clamp cuts it", () => {
    expect(PERIOD_DAYS.all).toBeNull();
    expect(effectiveClamp("all", 3650)).toBe(3650);
  });

  it("survives an unknown period and a malformed clamp without inventing one", () => {
    expect(effectiveClamp("bogus", 90)).toBeNull();
    for (const bad of [undefined, "90", 0, -1, NaN, {}])
      expect(effectiveClamp("1y", bad)).toBeNull();
  });
});

// T3 f.4-unclosed: TWO cards on this page read PERIOD-LESS endpoints that are
// gated anyway, so a period-driven notice is silent while their own headings
// lie. The heatmap fixes since = clamp(now−365d, floor) (service.ts:257-259)
// and personalRecords passes gate.floor with no period at all (:281).
describe("heatmapCaption", () => {
  it("keeps the real 365-day heading when nothing is clamped", () => {
    expect(heatmapCaption(null)).toBe("Last 365 Days");
  });

  // The silent-at-7d/30d/90d case: the heatmap ALWAYS asks for a year, so a
  // 90-day plan cuts it at every period, including the ones where the
  // period-driven notice correctly stays quiet.
  it("names the real window whenever the plan cuts the fixed 365-day read", () => {
    expect(heatmapCaption(90)).toBe("Last 90 Days");
    expect(heatmapCaption(30)).toBe("Last 30 Days");
  });

  it("ignores a clamp that cannot cut a year, and a malformed value", () => {
    expect(heatmapCaption(365)).toBe("Last 365 Days");
    expect(heatmapCaption(400)).toBe("Last 365 Days");
    for (const bad of [undefined, "90", 0, -1, NaN]) expect(heatmapCaption(bad)).toBe("Last 365 Days");
  });
});

describe("recordsNote", () => {
  it("is null on an unlimited plan", () => {
    expect(recordsNote(null)).toBeNull();
  });

  // Gated at EVERY period (no period parameter reaches that endpoint), so this
  // is period-independent by construction.
  // longestStreak is DELIBERATELY ungated (service.ts:288-290, "streaks are
  // identity, not history reads"), so a flat card-level "last 90 days" would
  // be a NEW inaccuracy — the note must carve it out by name.
  it("scopes the window to the gated rows and exempts the all-time streak", () => {
    const note = recordsNote(90);
    expect(note).toContain("last 90 days");
    expect(note.toLowerCase()).toContain("longest streak");
    expect(note.toLowerCase()).toContain("all-time");
  });

  it("survives a malformed clamp without inventing a window", () => {
    for (const bad of [undefined, "90", 0, -1, NaN]) expect(recordsNote(bad)).toBeNull();
  });
});

describe("totalsWindowLabel — the Dashboard's three lifetime tiles", () => {
  it("says 'all time' only when the plan really is unlimited", () => {
    expect(totalsWindowLabel(null)).toBe("all time");
  });

  // THE ONE THAT MATTERS. The Dashboard asks for `period=all`, which is
  // unbounded, so a plan floor cuts it EVERY time — a gated user's 90-day
  // total was captioned "all time". That is f.4's lie on the first screen a
  // user sees, and it is what this label exists to stop.
  it("names the real window when the plan gate cut it", () => {
    expect(totalsWindowLabel(90)).toBe("last 90 days");
    expect(totalsWindowLabel(30)).toBe("last 30 days");
    expect(totalsWindowLabel(365)).toBe("last 365 days");
  });

  it("says 'day' for a one-day window, not '1 days'", () => {
    // The exact defect T3 R9 found in the sibling caption: the module
    // pluralised and the JSX did not, so a real user could read "1 days".
    expect(totalsWindowLabel(1)).toBe("last 1 day");
  });

  it("falls back to 'all time' on a malformed clamp, never to a made-up window", () => {
    for (const bad of [undefined, "90", 0, -1, NaN]) {
      expect(totalsWindowLabel(bad)).toBe("all time");
    }
  });
});

describe("PERIODS", () => {
  // T3 R1: the page's period list and this module's labels were two sources of
  // truth with no link — a period added to one degraded the other silently.
  it("is the single list, and every entry has a days mapping", () => {
    expect(PERIODS.map((p) => p.value)).toEqual(["7d", "30d", "90d", "1y", "all"]);
    for (const p of PERIODS) expect(p.value in PERIOD_DAYS).toBe(true);
    expect(PERIODS.find((p) => p.value === "1y").label).toBe("1 Year");
  });
});

describe("clampNotice", () => {
  it("stays silent — and leaves the caption alone — when nothing is clamped", () => {
    expect(clampNotice("1y", null)).toEqual({ show: false, days: null, caption: "1 Year" });
    expect(clampNotice("7d", 90)).toEqual({ show: false, days: null, caption: "7 Days" });
  });

  // The caption is half the bug: a notice beside a label still reading
  // "1 Year" over 90 days of data only half-fixes it.
  it("corrects the caption to the window actually shown", () => {
    expect(clampNotice("1y", 90)).toEqual({ show: true, days: 90, caption: "the last 90 days" });
    expect(clampNotice("all", 90)).toEqual({ show: true, days: 90, caption: "the last 90 days" });
  });

  it("keeps the singular honest", () => {
    expect(clampNotice("1y", 1).caption).toBe("the last 1 day");
  });
});
