import { describe, expect, it } from "vitest";
import { foodWeekResponseSchema, type FoodWeekFact, type FoodWeekResponse } from "@app/shared";
import { averageLine, barSaid, dayLetter, factWords, monthLabel, targetsDiffer, weekBars, weekLine } from "../src/screens/food/weekRules";

// ROADMAP Stage 5 34f-ii: the week in food on the Food screen. The days, bands and counts are the
// server's (34f-i); these check the bars drawn from them and the words picked for them.

const TARGETS = { kcal: 2169, proteinG: 120, carbsG: 250, fatG: 70 };
type DayOver = Partial<FoodWeekResponse["days"][number]>;
const NONE: FoodWeekFact = { under: 0, on: 0, over: 0, judged: 0 };

/** Seven days ending Tuesday 3 Nov 2026, as the server writes them. */
function week(over: (i: number) => DayOver = () => ({}), facts: Partial<FoodWeekResponse["facts"]> = {}): FoodWeekResponse {
  const days = ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"];
  return foodWeekResponseSchema.parse({
    span: 7,
    days: days.map((day, i) => ({
      day, today: i === 6, meals: 0, about: false, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0,
      fiberG: { amount: 0, notKnown: 0 }, sodiumMg: { amount: 0, notKnown: 0 },
      targets: TARGETS, targetsOfTheDay: true, bands: null, ...over(i),
    })),
    facts: { kcal: NONE, proteinG: NONE, carbsG: NONE, fatG: NONE, ...facts },
  });
}
const eaten = (kcal: number, band: "under" | "on" | "over"): DayOver => ({
  meals: 3, kcal, proteinG: 100, carbsG: 200, fatG: 60, bands: { kcal: band, proteinG: "under", carbsG: "on", fatG: "on" },
});

describe("the worst thing: a bar under the wrong day, or today's half day judged", () => {
  it("each bar's letter is the server's own date, whatever the phone's clock or zone says", () => {
    // The server's days run Wednesday to Tuesday; a phone a zone away would read its own today otherwise.
    expect(week().days.map((d) => dayLetter(d.day))).toEqual(["W", "T", "F", "S", "S", "M", "T"]);
    expect([dayLetter("2024-02-29"), dayLetter("2026-12-31"), dayLetter("2027-01-01")]).toEqual(["T", "T", "F"]);
  });

  it("each bar holds its own day's number, in the server's order, today last", () => {
    const bars = weekBars(week((i) => (i === 6 ? eaten(900, "under") : eaten(1000 + i, "on"))), "kcal", null);
    expect(bars.map((b) => [b.day, b.value])).toEqual([
      ["2026-10-28", 1000], ["2026-10-29", 1001], ["2026-10-30", 1002], ["2026-10-31", 1003],
      ["2026-11-01", 1004], ["2026-11-02", 1005], ["2026-11-03", 900],
    ]);
  });

  it("today is never given a band, even where the server's reply carries one", () => {
    const bars = weekBars(week((i) => eaten(900, i === 6 ? "under" : "on")), "kcal", null);
    expect(bars.at(-1)).toMatchObject({ today: true, band: null });
    const today = bars.at(-1);
    expect(today === undefined ? null : barSaid(today, "kcal")).toBe("Today, 900 kcal of 2,169 kcal, so far");
    expect(bars.slice(0, 6).every((b) => b.band === "on")).toBe(true);
  });

  it("today's bar is the rings' numbers where the phone has them, and only today's", () => {
    const server = week((i) => eaten(i === 6 ? 500 : 2000, "on"));
    const bars = weekBars(server, "proteinG", { day: "2026-11-03", sums: { kcal: 1200, proteinG: 64, carbsG: 150, fatG: 40 }, meals: 2, about: true });
    expect(bars.at(-1)).toMatchObject({ value: 64, about: true });
    expect(bars.slice(0, 6).map((b) => b.value)).toEqual([100, 100, 100, 100, 100, 100]);
    // A meal just removed on the phone: today has none there, so no bar, whatever the server last said.
    expect(weekBars(server, "kcal", { day: "2026-11-03", sums: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, meals: 0, about: false }).at(-1)?.value).toBeNull();
  });

  it("the rings' numbers go only on the server's today of the same date: a phone a day ahead keeps the server's day", () => {
    // Stored zone London, the phone in India at 01:00 on Wed 4 Nov: the server's today is still Tue 3 Nov.
    const server = week((i) => eaten(i === 6 ? 1800 : 2000, "on"));
    const ahead = { day: "2026-11-04", sums: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, meals: 0, about: false };
    expect(weekBars(server, "kcal", ahead).at(-1)).toMatchObject({ day: "2026-11-03", value: 1800 });
    // Midnight with the page open: the new day has no meals, yesterday's still show.
    expect(weekLine(week((i) => (i === 6 ? eaten(1800, "on") : {})), ahead).words).toBe("Today counts once it’s over.");
    expect(weekLine(week(), ahead).words).toBe("Your week shows here once you log meals.");
  });

  it("a day with no meals has no bar and no band", () => {
    expect(weekBars(week((i) => (i === 2 ? {} : eaten(2000, "on"))), "kcal", null)[2]).toMatchObject({ value: null, band: null });
  });
});

describe("the facts in words: every class of count", () => {
  const cases: [string, FoodWeekFact, string | null][] = [
    ["nothing judged yet", NONE, null],
    ["one band leads", { under: 5, on: 1, over: 0, judged: 6 }, "Protein was under target on 5 of 6 days."],
    ["on target leads", { under: 1, on: 4, over: 1, judged: 6 }, "Protein was on target on 4 of 6 days."],
    ["over leads", { under: 0, on: 2, over: 4, judged: 6 }, "Protein was over target on 4 of 6 days."],
    ["every day the same", { under: 0, on: 6, over: 0, judged: 6 }, "Protein was on target on all 6 days."],
    ["every day under", { under: 6, on: 0, over: 0, judged: 6 }, "Protein was under target on all 6 days."],
    ["one day judged", { under: 0, on: 0, over: 1, judged: 1 }, "Protein was over target on 1 day."],
    ["one of two", { under: 1, on: 1, over: 0, judged: 2 }, "Protein was on target on 1 of 2 days and under target on 1."],
    ["on and under tie", { under: 3, on: 3, over: 0, judged: 6 }, "Protein was on target on 3 of 6 days and under target on 3."],
    ["under and over tie", { under: 2, on: 1, over: 2, judged: 5 }, "Protein was under target on 2 of 5 days and over target on 2."],
    ["on and over tie", { under: 0, on: 2, over: 2, judged: 4 }, "Protein was on target on 2 of 4 days and over target on 2."],
    ["three-way tie", { under: 2, on: 2, over: 2, judged: 6 }, "Protein was on target on 2 of 6 days, under target on 2 and over target on 2."],
    ["thirty days", { under: 19, on: 7, over: 3, judged: 29 }, "Protein was under target on 19 of 29 days."],
  ];
  it.each(cases)("%s", (_, fact, words) => {
    expect(factWords("proteinG", fact)).toBe(words);
  });

  it("each figure has its own name and verb", () => {
    const fact = { under: 1, on: 2, over: 0, judged: 3 };
    expect([factWords("kcal", fact), factWords("carbsG", fact), factWords("fatG", fact)]).toEqual([
      "Calories were on target on 2 of 3 days.",
      "Carbs were on target on 2 of 3 days.",
      "Fat was on target on 2 of 3 days.",
    ]);
  });
});

describe("the box's one line", () => {
  it("no meals in the week", () => {
    expect(weekLine(week(), null)).toEqual({ words: "Your week shows here once you log meals.", setUp: false });
  });
  it("meals today only: today is not over", () => {
    expect(weekLine(week((i) => (i === 6 ? eaten(900, "on") : {})), null).words).toBe("Today counts once it’s over.");
  });
  it("meals logged on the phone today, not yet on the server", () => {
    const here = { day: "2026-11-03", sums: { kcal: 300, proteinG: 10, carbsG: 50, fatG: 5 }, meals: 1, about: false };
    expect(weekLine(week(), here).words).toBe("Today counts once it’s over.");
  });
  it("no daily numbers yet: asks for them", () => {
    expect(weekLine(week((i) => ({ ...eaten(2000, "on"), targets: null, bands: null, ...(i === 6 ? { today: true } : {}) })), null)).toEqual({
      words: "Set your daily numbers to compare your days.",
      setUp: true,
    });
  });
  it("the calories fact", () => {
    const w = week(() => eaten(2000, "on"), { kcal: { under: 1, on: 3, over: 2, judged: 6 } });
    expect(weekLine(w, null).words).toBe("Calories were on target on 3 of 6 days.");
  });
});

describe("the rest", () => {
  it("a day read against today's numbers is marked; today and a day with no meals are not", () => {
    const bars = weekBars(week((i) => (i === 3 ? {} : { ...eaten(2000, "on"), targetsOfTheDay: i > 2 })), "kcal", null);
    expect(bars.map((b) => b.current)).toEqual([true, true, true, false, false, false, false]);
  });
  it("fibre and sodium: the finished days with meals, on average, starred where a food has no figure", () => {
    const w = week((i) => (i === 6 ? { ...eaten(500, "on"), fiberG: { amount: 90, notKnown: 0 } } : i < 2 ? { ...eaten(2000, "on"), fiberG: { amount: 20 + i, notKnown: i }, sodiumMg: { amount: 2000, notKnown: 0 } } : {}));
    expect(averageLine(w)).toEqual({ words: "A day on average: Fibre 21 g* · Sodium 2,000 mg*", partial: true });
    expect(averageLine(week())).toBeNull();
  });
  it("the 30 days are labelled by today's date and each week back", () => {
    expect([0, 1, 6, 7, 14].map((n) => monthLabel("2026-11-03", n))).toEqual(["3", "", "", "3", "3"]);
  });
});

describe("one straight line at today's target", () => {
  const own = { kcal: 1900, proteinG: 112, carbsG: 250, fatG: 70 };
  it("says so only where a finished day with meals had a target of its own", () => {
    // The test person of the walk: 1,900 kcal on five days, 2,169 today and on the first.
    const stepped = weekBars(week((i) => ({ ...eaten(2000, "on"), ...(i > 0 && i < 6 ? { targets: own } : {}) })), "kcal", null);
    expect(targetsDiffer(stepped, 2169)).toBe(true);
    // Protein was 112 g on every day: no line to say.
    expect(targetsDiffer(weekBars(week((i) => ({ ...eaten(2000, "on"), targets: i === 6 ? { ...own, kcal: 2169 } : own })), "proteinG", null), 112)).toBe(false);
    // A day with another target but no meals, or today, is not drawn against it.
    expect(targetsDiffer(weekBars(week((i) => (i === 2 ? { targets: own } : eaten(2000, "on"))), "kcal", null), 2169)).toBe(false);
    expect(targetsDiffer(weekBars(week((i) => ({ ...eaten(2000, "on"), ...(i === 6 ? { targets: own } : {}) })), "kcal", null), 1900)).toBe(true);
    expect(targetsDiffer(stepped, null)).toBe(false);
  });
});
