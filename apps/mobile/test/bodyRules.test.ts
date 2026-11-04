import { describe, expect, it } from "vitest";
import type { BodyMeasurement, WaitingBodyEntry } from "@app/shared";
import { bodyList, buildEntry, changeWords, entryWords, holdsWords, lastValues, loggedMeasures, series, shownWithUnit } from "../src/screens/progress/bodyRules";

// Body's Log measurements (ROADMAP Stage 5 35c-ii). The worst thing on the phone's side: a number a
// person typed kept as another (pounds kept as kilograms, inches as centimetres), so their weight goal
// and their chart lie. The conversions are checked against the published factors (1 lb = 0.45359237 kg,
// 1 in = 2.54 cm, NIST SP 811), never against the code's own.

const at = (day: string) => `${day}T08:00:00.000Z`;
const m = (id: string, day: string, weightKg: number | null, metrics: Record<string, number> = {}, source: "manual" | "self_reported" = "manual"): BodyMeasurement => ({
  id,
  measuredAt: at(day),
  weightKg,
  metrics,
  source,
  createdAt: at(day),
});
const ID = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

describe("what the Log box keeps", () => {
  it.each([
    // [what the person typed, units, kept weightKg, kept metrics]
    [{ weight: "154" }, "imperial", 69.85, {}], // 154 × 0.45359237 = 69.853
    [{ weight: "200" }, "imperial", 90.72, {}], // 90.718
    [{ weight: "69.4" }, "metric", 69.4, {}],
    [{ weight: "69,4" }, "metric", 69.4, {}], // a comma keyboard
    [{ weight: " 72.555 " }, "metric", 72.56, {}], // to the hundredth the server takes
    [{ waist_cm: "32" }, "imperial", null, { waist_cm: 81.28 }], // 32 × 2.54
    [{ waist_cm: "82" }, "metric", null, { waist_cm: 82 }],
    [{ body_fat_pct: "18" }, "imperial", null, { body_fat_pct: 18 }], // a percent is a percent in either
    [{ weight: "70", left_arm_cm: "33.5", right_thigh_cm: "55" }, "metric", 70, { left_arm_cm: 33.5, right_thigh_cm: 55 }],
    [{ weight: "", hips_cm: "94", chest_cm: "  " }, "metric", null, { hips_cm: 94 }],
  ] as const)("%j in %s is kept as %s kg and %j", (typed, units, weightKg, metrics) => {
    expect(buildEntry(typed, units)).toEqual({ ok: true, weightKg, metrics });
  });

  it.each([
    [{ weight: "7" }, "metric", "weight", "Enter a weight between 20 and 400 kg."],
    [{ weight: "690" }, "metric", "weight", "Enter a weight between 20 and 400 kg."], // a slipped decimal point
    [{ weight: "30" }, "imperial", "weight", "Enter a weight between 44 and 880 lb."],
    [{ weight: "-70" }, "metric", "weight", "Enter a weight between 20 and 400 kg."],
    [{ weight: "70kg" }, "metric", "weight", "Enter a weight between 20 and 400 kg."],
    [{ weight: "7e1" }, "metric", "weight", "Enter a weight between 20 and 400 kg."],
    [{ body_fat_pct: "180" }, "metric", "body_fat_pct", "Enter a body fat between 2 and 75 %."],
    [{ waist_cm: "820" }, "metric", "waist_cm", "Enter a size between 10 and 300 cm."],
    [{ waist_cm: "200" }, "imperial", "waist_cm", "Enter a size between 4 and 118 in."],
  ] as const)("%j in %s is refused at %s", (typed, units, key, words) => {
    expect(buildEntry(typed, units)).toEqual({ ok: false, errors: { [key]: words }, none: false });
  });

  it("nothing typed saves nothing", () => {
    expect(buildEntry({}, "metric")).toEqual({ ok: false, errors: {}, none: true });
    expect(buildEntry({ weight: "  ", waist_cm: "" }, "metric")).toEqual({ ok: false, errors: {}, none: true });
  });

  it("one wrong number keeps the whole entry back", () => {
    expect(buildEntry({ weight: "70", waist_cm: "8200" }, "metric")).toMatchObject({ ok: false, none: false });
  });
});

describe("what Body shows", () => {
  const items = [m(ID(3), "2026-11-03", 69.4, { waist_cm: 82 }), m(ID(2), "2026-10-28", 69.85, {}, "self_reported"), m(ID(1), "2026-10-02", 71, { waist_cm: 84, body_fat_pct: 19 })];

  const nth = (i: number): BodyMeasurement => {
    const found = items[i];
    if (found === undefined) throw new Error(`no item ${String(i)}`);
    return found;
  };

  it("a kept value in the person's units, to one place", () => {
    expect(shownWithUnit(69.85, "weight", "metric")).toBe("69.9 kg");
    expect(shownWithUnit(69.85, "weight", "imperial")).toBe("154 lb");
    expect(shownWithUnit(81.28, "length", "imperial")).toBe("32 in");
    expect(shownWithUnit(18.25, "pct", "imperial")).toBe("18.3 %");
  });

  it("the chips are the measurements logged at least once, in the box's order", () => {
    expect(loggedMeasures(items)).toEqual(["weight", "body_fat_pct", "waist_cm"]);
    expect(loggedMeasures([])).toEqual([]);
  });

  it("the line is the measurement's entries oldest first; the change is the newest against the one before", () => {
    expect(series(items, "waist_cm").map((p) => p.value)).toEqual([84, 82]);
    expect(series(items, "weight").map((p) => p.value)).toEqual([71, 69.85, 69.4]);
    expect(changeWords(series(items, "weight"), "weight", "metric")).toEqual({ words: "▼ 0.5 kg since 28 Oct", down: true });
    expect(changeWords(series(items, "waist_cm"), "waist_cm", "imperial")).toEqual({ words: "▼ 0.8 in since 2 Oct", down: true });
    expect(changeWords(series(items, "body_fat_pct"), "body_fat_pct", "metric")).toBeNull();
    const same = [m(ID(5), "2026-11-04", 70), m(ID(4), "2026-11-01", 70.02)];
    expect(changeWords(series(same, "weight"), "weight", "metric")).toEqual({ words: "No change since 1 Nov", down: null });
  });

  it("the box's Last is each measurement's newest", () => {
    expect(lastValues(items)).toEqual({ weight: 69.4, waist_cm: 82, body_fat_pct: 19 });
  });

  it("an entry's line says how it came", () => {
    expect(entryWords(nth(1), "metric", false)).toEqual({ date: "28 Oct 2026", how: "Typed by you", weight: "69.9 kg", more: null });
    expect(entryWords(nth(0), "metric", true)).toMatchObject({ how: "Waiting to send", more: "1 measurement" });
    expect(holdsWords(nth(2))).toBe("Weight and 2 measurements");
    expect(holdsWords(m(ID(9), "2026-11-01", null, { hips_cm: 90 }))).toBe("1 measurement");
  });

  it("the list: the server's, what it just took and what still waits, newest first, none removed here", () => {
    const waiting: WaitingBodyEntry = { id: ID(8), measuredAt: at("2026-11-04"), weightKg: 69, metrics: {}, tried: true };
    const landed = m(ID(7), "2026-11-04", 69.2);
    const out = bodyList(items, { waiting: [waiting], landed: [landed], removing: new Set([ID(2)]) });
    expect(out.items.map((i) => i.id)).toEqual([ID(8), ID(7), ID(3), ID(1)]);
    expect([...out.waiting]).toEqual([ID(8)]);
    // An entry the server's list already holds is drawn once, as the server keeps it.
    const twice = bodyList([m(ID(8), "2026-11-04", 69)], { waiting: [waiting], landed: [m(ID(8), "2026-11-04", 69)], removing: new Set() });
    expect(twice.items).toHaveLength(1);
    expect(twice.waiting.size).toBe(0);
  });
});
