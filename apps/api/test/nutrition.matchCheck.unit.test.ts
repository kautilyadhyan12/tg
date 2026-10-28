// ROADMAP 33a-ii — the match check: a scanned food whose table match was found by
// words is put to the model as text, with its close foods, and is priced by the
// one the model names as the same food, or by the model's own estimate. Never the
// food words found when the model says none or cannot be asked. Kd's eight plates
// (fixtures/luna-match-check.json) run through the rule with Luna's real answers.
// The route and the real table run in nutrition.scan.routes.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MAX_MATCH_ENTRIES, foodMatchPicksSchema, mealVisionEvidenceSchema, type VisionItem } from "@app/shared";
import { findCurated } from "../src/modules/nutrition/foods.js";
import type { FoodReference } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { checkedPrice, closeFoodsOf, isPlainMatch, type ScanPrice } from "../src/modules/nutrition/scanMatch.js";
import {
  MATCH_CHECK_MAX_OUTPUT_TOKENS,
  MATCH_CHECK_PROMPT,
  MATCH_CHECK_TIMEOUT_MS,
  VisionProviderError,
  createOpenAiMatchChecker,
  matchQuestionText,
  type MatchFood,
} from "../src/modules/nutrition/vision.adapter.js";

const seen = (name: string, hint: string, figures: [grams: number, kcal: number, protein: number, carbs: number, fat: number] | null): VisionItem => ({
  name, canonical_hint: hint, count: null,
  grams: figures?.[0] ?? null, kcal: figures?.[1] ?? null, protein_g: figures?.[2] ?? null, carbs_g: figures?.[3] ?? null, fat_g: figures?.[4] ?? null,
});
const food = (canonical: string, name: string, kcal: number, source: FoodReference["source"] = "usda"): FoodReference =>
  ({ canonical, name, kcal, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null, serving: 100, unit: "g", source });
const ourList = { ourList: (hint: string) => findCurated(hint) };
/** What a price shows, in one word or the food's name. */
const shown = (price: ScanPrice): string => (price.kind === "table" ? price.food.name : price.kind);

// The milky iced coffee of Kd's plate download (2): 250 g at 100 kcal, 40 per 100 g.
const ICED_COFFEE = seen("iced coffee with milk", "iced coffee with milk", [250, 100, 5, 11, 4]);
const NON_DAIRY = food("usda_fndds_1", "Coffee, Iced Latte, with non-dairy milk, flavored", 31);
const ICED_LATTE = food("usda_fndds_2", "Coffee, Iced Latte", 27);
// The thigh meat of Kd's plate download (3): "cooked chicken", 150 g at 300 kcal.
const CHICKEN = seen("chicken", "cooked chicken", [150, 300, 36, 2, 16]);
const WING = food("usda_fndds_3", "Chicken wing, NS as to cooking method", 257);
const PLAIN_CHICKEN = food("usda_fndds_4", "Chicken, NS as to part and cooking method, skin eaten", 196);
const BUTTER = food("usda_fndds_5", "Butter, stick, salted", 717);

describe("the match check: what each food is priced by", () => {
  it("the worst thing: a milky iced coffee is never shown as a non-dairy latte — not when the model says none, nor when the check cannot be asked", () => {
    // Words found the non-dairy latte, so it is not plain, and the model is asked.
    expect(isPlainMatch(ICED_COFFEE, NON_DAIRY, ourList)).toBe(false);
    const close = [NON_DAIRY, ICED_LATTE];
    for (const pick of [null, 7, -1]) {
      const price = checkedPrice(ICED_COFFEE, NON_DAIRY, close, pick);
      expect(price.kind, `pick ${String(pick)}`).toBe("estimate");
      expect(shown(price)).not.toContain("non-dairy");
    }
    // The model named the iced latte: it is that.
    expect(shown(checkedPrice(ICED_COFFEE, NON_DAIRY, close, 1))).toBe("Coffee, Iced Latte");
  });

  /** Every class of table answer: plain (not asked) or checked. */
  /** Our list's own food for a name, as the tables answer it. */
  const ours = (name: string): FoodReference => {
    const own = findCurated(name);
    if (own === null) throw new Error(`our list has no ${name}`);
    return food(own.canonical, own.name, own.kcal, "curated");
  };
  const PLAIN: [label: string, item: VisionItem, found: FoodReference, plain: boolean][] = [
    ["our list's food for the whole hint, the name the same", seen("avocado", "avocado", [70, 112, 1, 6, 10]), ours("avocado"), true],
    ["our list's food for the hint, a name that finds no food", seen("coffee with milk", "cappuccino", [180, 90, 5, 8, 4]), ours("cappuccino"), true],
    ["our list's food for the hint, a name that says nothing", seen("unknown", "dal", [150, 170, 9, 25, 4]), ours("dal"), true],
    ["our list's food for the hint, a name that finds another food on the list", seen("roasted potatoes", "potatoes", [200, 300, 5, 40, 13]), ours("potatoes"), false],
    ["a food of our list the hint does not find (a shorter name's)", seen("scored pork sausage", "scored pork sausage", [96, 312, 13, 1, 28]), ours("pork sausage"), false],
    ["USDA's food, by the name or by every word", CHICKEN, WING, false],
    ["a packaged product", seen("cola", "qwzx cola", [330, 140, 0, 35, 0]), food("off_1", "Qwzx Cola", 42, "openfoodfacts"), false],
  ];
  it("holds the cases as the list answers them: the hint finds the food, or a name finds another", () => {
    expect(findCurated("coffee with milk")).toBeNull();
    expect(findCurated("roasted potatoes")?.name).toBe("Roast potatoes");
    expect(findCurated("potatoes")?.name).toBe("Potato (baked)");
    expect(findCurated("scored pork sausage")).toBeNull();
  });
  for (const [label, item, found, plain] of PLAIN) {
    it(`${plain ? "is not asked about" : "asks about"} ${label}`, () => {
      expect(isPlainMatch(item, found, ourList)).toBe(plain);
    });
  }

  /** What a checked food becomes, for every kind of answer. */
  const close = [WING, PLAIN_CHICKEN, BUTTER];
  const NO_FIGURES = seen("chicken", "cooked chicken", null);
  const CHECKED: [label: string, item: VisionItem, pick: number | null, expected: string, overruled?: string][] = [
    ["the close food the model named", CHICKEN, 1, PLAIN_CHICKEN.name],
    ["the food words found, where the model named it", CHICKEN, 0, WING.name],
    ["the estimate where the model said none", CHICKEN, null, "estimate", WING.name],
    ["the estimate where the model named a number it was not offered", CHICKEN, 3, "estimate", WING.name],
    ["the estimate where the named food's energy is three times from the plate's", CHICKEN, 2, "estimate", BUTTER.name],
    ["nothing, named, where the model said none and gave no figures", NO_FIGURES, null, "none"],
    ["the named food where the model gave no figures to set it against", NO_FIGURES, 1, PLAIN_CHICKEN.name],
  ];
  for (const [label, item, pick, expected, overruled] of CHECKED) {
    it(`a checked food is ${label}`, () => {
      const price = checkedPrice(item, WING, close, pick);
      expect(shown(price)).toBe(expected);
      if (price.kind === "estimate") {
        expect(price.overruled?.name).toBe(overruled);
        // The estimate is the model's own: 300 kcal at its 150 g.
        expect(Math.round((price.per100g.kcal * price.grams) / 100)).toBe(300);
      }
    });
  }

  it("puts the food words found first, then the others in order, each once, at most twelve", () => {
    const others = Array.from({ length: 20 }, (_, n) => food(`usda_fndds_${String(100 + n)}`, `Qwzx ${String(n)}`, 100));
    const close = closeFoodsOf(WING, [PLAIN_CHICKEN, WING, others[0] ?? WING, PLAIN_CHICKEN, ...others]);
    expect(close.map((f) => f.name).slice(0, 3)).toEqual([WING.name, PLAIN_CHICKEN.name, "Qwzx 0"]);
    expect(close).toHaveLength(MAX_MATCH_ENTRIES);
    expect(new Set(close.map((f) => f.canonical)).size).toBe(MAX_MATCH_ENTRIES);
  });
});

describe("the match check on OpenAI", () => {
  const FOODS: MatchFood[] = [
    { name: "chicken", hint: "cooked chicken", grams: 150, kcal: 300, entries: [{ name: WING.name, kcal: 257 }, { name: PLAIN_CHICKEN.name, kcal: 195.6 }] },
    { name: "iced coffee with milk", hint: "iced coffee with milk", grams: null, kcal: null, entries: [{ name: NON_DAIRY.name, kcal: 31 }] },
  ];
  const completion = (content: string | null, refusal: string | null = null) => ({
    choices: [{ message: { content, refusal }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1400, completion_tokens: 70 },
  });
  const answering = (reply: unknown, status = 200) => {
    const seenCalls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      seenCalls.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init });
      return Promise.resolve(new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } }));
    };
    return { seenCalls, fetchImpl };
  };
  const failure = async (p: Promise<unknown>): Promise<VisionProviderError> => {
    try { await p; } catch (err) { if (err instanceof VisionProviderError) return err; throw err; }
    throw new Error("expected a VisionProviderError");
  };

  it("sends only the instructions and the foods' names and numbers: no photo, no user, nothing stored, thinking off", async () => {
    const { seenCalls, fetchImpl } = answering(completion('{"picks":[{"food":1,"entry":2},{"food":2,"entry":null}]}'));
    await createOpenAiMatchChecker("dummy-openai-key", "gpt-6-luna", fetchImpl).check(FOODS); // gitleaks:allow
    expect(seenCalls).toHaveLength(1);
    const [call] = seenCalls;
    expect(call?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call?.init?.headers).toEqual({ "content-type": "application/json", authorization: "Bearer dummy-openai-key" }); // gitleaks:allow
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
    // Compared WHOLE: a photo, a user or safety_identifier field, or store:true turns this red.
    expect(JSON.parse(typeof call?.init?.body === "string" ? call.init.body : "null")).toEqual({
      model: "gpt-6-luna",
      store: false,
      reasoning_effort: "none",
      max_completion_tokens: MATCH_CHECK_MAX_OUTPUT_TOKENS,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [{ type: "text", text: `${MATCH_CHECK_PROMPT}\n\n${matchQuestionText(FOODS)}` }] }],
    });
    // JSON mode needs the word JSON in the instructions, or OpenAI refuses the request.
    expect(MATCH_CHECK_PROMPT).toContain("JSON");
  });

  it("writes each food with what the photo showed and its close foods, numbered from 1", () => {
    expect(matchQuestionText(FOODS)).toBe([
      "Food 1: chicken (cooked chicken), 150 g, 300 kcal",
      "  1. Chicken wing, NS as to cooking method: 257 kcal per 100 g",
      "  2. Chicken, NS as to part and cooking method, skin eaten: 196 kcal per 100 g",
      "Food 2: iced coffee with milk, amount not estimated",
      "  1. Coffee, Iced Latte, with non-dairy milk, flavored: 31 kcal per 100 g",
    ].join("\n"));
  });

  it("reads one pick a food: a number it was not offered, a food it skipped and a second pick are no answer for that food alone", async () => {
    const check = (content: string) => createOpenAiMatchChecker("k", "gpt-6-luna", answering(completion(content)).fetchImpl).check(FOODS);
    expect(await check('{"picks":[{"food":1,"entry":2},{"food":2,"entry":null}]}')).toEqual({ picks: [1, null], tokensIn: 1400, tokensOut: 70 });
    expect((await check('{"picks":[{"food":1,"entry":3},{"food":2,"entry":1}]}')).picks).toEqual([null, 0]);
    expect((await check('{"picks":[{"food":2,"entry":1}]}')).picks).toEqual([null, 0]);
    expect((await check('{"picks":[{"food":1,"entry":1},{"food":1,"entry":2}]}')).picks).toEqual([0, null]);
    // "entry": 0 is a way to say none, and 13 is past any list: that food is none, the other keeps its pick.
    expect((await check('{"picks":[{"food":1,"entry":0},{"food":2,"entry":1}]}')).picks).toEqual([null, 0]);
    expect((await check(`{"picks":[{"food":1,"entry":2},{"food":2,"entry":${String(MAX_MATCH_ENTRIES + 1)}}]}`)).picks).toEqual([1, null]);
    // A food it was not asked about is no other food's answer.
    expect((await check('{"picks":[{"food":0,"entry":1},{"food":3,"entry":1},{"food":1,"entry":2}]}')).picks).toEqual([1, null]);
  });

  it("gives the check its own time limit, half the photo's", async () => {
    expect(MATCH_CHECK_TIMEOUT_MS).toBe(15_000);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      await createOpenAiMatchChecker("k", "gpt-6-luna", answering(completion('{"picks":[]}')).fetchImpl).check(FOODS);
      expect(timeout).toHaveBeenCalledWith(MATCH_CHECK_TIMEOUT_MS);
    } finally { timeout.mockRestore(); }
    // A check the time limit cuts off is an outage, and its foods go to the estimate.
    const aborted: typeof fetch = () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    expect((await failure(createOpenAiMatchChecker("k", "m", aborted).check(FOODS))).kind).toBe("unavailable");
  });

  it("fails closed, with the usage kept, on a reply that breaks the shape, a refusal or an empty answer; an outage and a refusal of the request are told apart", async () => {
    for (const content of ['{"picks":[{"food":1,"entry":"2"}]}', '{"picks":[{"food":1.5,"entry":1}]}', '{"pick":[]}', "not json", '{"picks":[{"food":1,"entry":1,"why":"same"}]}']) {
      const err = await failure(createOpenAiMatchChecker("k", "m", answering(completion(content)).fetchImpl).check(FOODS));
      expect(err.kind, content).toBe("unreadable");
      expect(err.usage, content).toEqual({ tokensIn: 1400, tokensOut: 70 });
    }
    expect((await failure(createOpenAiMatchChecker("k", "m", answering(completion(null, "no")).fetchImpl).check(FOODS))).kind).toBe("unreadable");
    expect((await failure(createOpenAiMatchChecker("k", "m", answering(completion("")).fetchImpl).check(FOODS))).kind).toBe("unreadable");
    expect((await failure(createOpenAiMatchChecker("k", "m", answering({}, 429).fetchImpl).check(FOODS))).kind).toBe("unavailable");
    expect((await failure(createOpenAiMatchChecker("k", "m", answering({}, 400).fetchImpl).check(FOODS))).kind).toBe("refused");
    expect(foodMatchPicksSchema.safeParse({ picks: Array.from({ length: 21 }, (_, n) => ({ food: n + 1, entry: null })) }).success).toBe(false);
  });
});

describe("Kd's eight plates, with Luna's real answers (fixtures/luna-match-check.json)", () => {
  const entry = z.object({ canonical: z.string(), name: z.string(), kcal: z.number() });
  const fixture = z.object({
    about: z.string(),
    plates: z.array(z.object({
      photo: z.string(),
      reply: z.unknown(),
      foods: z.array(z.object({ found: entry.nullable(), close: z.array(entry), lunaPick: z.string().nullable() })),
    })),
  }).parse(JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "luna-match-check.json"), "utf8")));
  const asFood = (e: z.infer<typeof entry>): FoodReference => food(e.canonical, e.name, e.kcal, e.canonical.startsWith("usda_") ? "usda" : "curated");

  /** Each food as it is priced: a plain match as words found it, a checked one by Luna's answer. */
  const priced = fixture.plates.map(({ photo, reply, foods }) => {
    const evidence = mealVisionEvidenceSchema.parse(reply);
    return [photo, evidence.items.map((item, at): string => {
      const f = foods[at];
      if (f?.found === null || f === undefined) return "estimate";
      const found = asFood(f.found);
      if (isPlainMatch(item, found, ourList)) return found.name;
      const close = f.close.map(asFood);
      const pick = f.lunaPick === null ? null : close.findIndex((c) => c.name === f.lunaPick);
      if (pick === -1) throw new Error(`${photo}: Luna's answer ${String(f.lunaPick)} is not among the close foods`);
      return shown(checkedPrice(item, found, close, pick));
    })] as const;
  });
  if (process.env["PRINT_PLATES"] === "1") for (const [photo, rows] of priced) console.log(`PLATE ${photo} ${JSON.stringify(rows)}`);

  // Read by eye against each photo, 2026-10-28. The four foods words put on the wrong
  // food are no longer on it: the thigh meat ("cooked chicken") is no chicken wing, the
  // corn on the cob no frozen uncooked corn, the milky iced coffee no non-dairy latte —
  // each now Luna's estimate — and the roasted potatoes are USDA's roasted with oil,
  // no baked potato at half the calories. The plain matches are as before.
  const EXPECTED: Record<string, string[]> = {
    "download-1": ["estimate", "Avocado", "Egg (fried)", "Bacon (cooked)", "Ham (sliced)", "Apple", "Brie", "Mixed nuts", "Cappuccino"],
    "download-2": ["estimate", "Avocado", "Egg (fried)", "Pork sausage (cooked)", "Asparagus (cooked)", "estimate", "Shrimp (cooked)", "estimate"],
    "download-3": ["Shrimp (cooked)", "estimate", "Egg (hard-boiled)", "Broccoli (cooked)", "estimate", "estimate", "Orange juice"],
    "download-4": ["Salmon (cooked)", "Potato, roasted, from fresh, peel eaten, made with oil", "Broccoli (cooked)", "Lemon"],
    "download-5": ["estimate", "Avocado", "Eggs (scrambled)", "Strawberries"],
    "download-6": ["estimate", "Peanut butter", "Jam", "Avocado", "Eggs (scrambled)", "Blueberries", "Raspberries", "Mixed seeds"],
    "download": ["estimate", "Banana", "White chocolate candy", "estimate", "Egg (hard-boiled)", "Bacon (cooked)", "Arugula", "estimate"],
    "minimalist-meal-planner-inspiration-idea-120": ["Egg (hard-boiled)", "Roast potatoes", "Rotisserie chicken", "Corn (cooked)", "Carrots (raw)", "Broccoli (cooked)"],
  };

  it("are all eight", () => {
    expect(priced.map(([photo]) => photo).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
  for (const [photo, rows] of priced) {
    it(`${photo}: every food is priced as pinned`, () => {
      expect(rows).toEqual(EXPECTED[photo]);
    });
  }
  it("words alone put four foods of the eight plates on the wrong food, which the check takes off them", () => {
    const byWords = fixture.plates.flatMap(({ foods }) => foods.map((f) => f.found?.name ?? "estimate"));
    for (const wrong of ["Chicken wing, NS as to cooking method", "Corn, sweet, yellow, frozen, kernels on cob, unprepared", "Coffee, Iced Latte, with non-dairy milk, flavored", "Potato (baked)"]) {
      expect(byWords, wrong).toContain(wrong);
      expect(priced.flatMap(([, rows]) => rows), wrong).not.toContain(wrong);
    }
  });
});
