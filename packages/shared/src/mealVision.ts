// The meal scanner's model replies (Part 2B §3.2 Stage 1): the evidence the
// model writes, and the envelope each provider wraps it in. Only
// apps/api/src/modules/nutrition/vision.adapter.ts reads a provider's reply,
// and it parses every reply through these (CLAUDE.md §4: AI responses cross
// the boundary through a schema in packages/shared).
import { z } from "zod";
import { MAX_ITEM_GRAMS } from "./nutrition.js";

// Vision-swap card 2026-07-16: real Groq completions (Scout AND Qwen) returned
// format variants a strict shape rejected — string fill levels ("full"/"N/A"),
// "None" containers, capitalized enums — which 422'd EVERY real scan while the
// fake-provider tests stayed green. So a slot the model filled with something
// that is no usable value reads as UNKNOWN, and a paid scan is never lost for
// it; what breaks the contract is the shape itself (below).
/** What a model writes for a name it does not have, however it is spelled: the
 *  prompt's own null, "none", "N/A" and unknown, and nothing at all. */
export const NO_VALUE_WORDS: readonly string[] = ["none", "n/a", "null", "unknown", ""];
/** Whether a name the model wrote is one of NO_VALUE_WORDS, in any case and spacing. */
export const isNoValueWord = (name: string): boolean => NO_VALUE_WORDS.includes(name.trim().toLowerCase());
/** Words that say the model could not tell what a food is. Matched inside a name, as
 *  whole words, because that is how Luna writes it ("unidentified brown cooked food"). */
const NOT_IDENTIFIED = /\b(?:unknown|unidentified|unidentifiable|unrecogni[sz]ed|unrecogni[sz]able|unsure|uncertain|undetermined|indeterminate|unclear|not sure|cannot tell|can't tell|cannot be identified|cannot identify|can't identify|could not identify|mystery|something)\b/;
/** A name with no kind of food in it: "food" or "item" where the kind would go, at the
 *  end of the name or its first part ("diced orange food", "fried item (possibly onion)",
 *  "brown cooked food pieces"), never inside one ("angel food cake"), or a bare word. */
const VAGUE_NAME = /\b(?:foods?|items?)\b(?:\s*$|\s*[,;:(]|\s+(?:pieces?|bits?|in|on|near|with)\b)|^(?:others?|things?|stuff|dish|meal)$/;
const asWritten = (name: string): string => name.replaceAll("_", " ").replaceAll(/\s+/g, " ").trim().toLowerCase();
/** Whether a name says the model could not tell what the food is. Such a food has no
 *  row and no figures on the sheet: it is named under "Not in the total" (Part 2B
 *  §3.5: honestly incomplete rather than confidently wrong). A name no word here
 *  catches stays the model's estimate, shown as one. */
export const saysNotIdentified = (name: string): boolean => {
  const said = asWritten(name);
  return NOT_IDENTIFIED.test(said) || VAGUE_NAME.test(said);
};
const optionalNameSchema = z.preprocess(
  (v) => (typeof v === "string" && isNoValueWord(v) ? null : v),
  z.string().nullable(),
);

/** The fields the scanner stopped asking for on 2026-09-15, dropped from a
 *  reply that still carries them before .strict() sees it. */
export const RETIRED_EVIDENCE_FIELDS: readonly string[] = ["cuisine_guess", "scale_anchors"];
const dropFields = (fields: readonly string[]) => (v: unknown): unknown =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !fields.includes(k)))
    : v;

/** A slot's value where it is one, else unknown (null). */
const orUnknown = <O>(schema: z.ZodType<O, z.ZodTypeDef, unknown>) =>
  z.unknown().transform((v): O | null => {
    const read = schema.safeParse(v);
    return read.success ? read.data : null;
  });

/** The most of one item a photo's count may say: a count the photo sheet may start a
 *  row at (ROADMAP 7a-iv-b), never more than one meal can hold. */
export const MAX_PHOTO_COUNT = 30;

/** The most foods the prompt asks one reply to list, naming any other food it sees
 *  in unknown_items, so it still shows under "Not in the total". It is what the
 *  reply's output cap holds with room to spare: each food cost about 40 output
 *  tokens when every item also carried a vessel, fill and size (155 for a plate of
 *  3, 393 for a plate of 9; HANDOFF 2026-09-16), and the cap is 1,000
 *  (`vision.adapter.ts`), so about 24 fit; the shorter reply measured 36.5 a food on
 *  the eight plates (HANDOFF 2026-09-17), inside that bound. A reply cut off at the cap
 *  is no JSON at all: the scan fails as unreadable, and so does its free retake. A
 *  reply that lists more anyway is still read: its first MAX_SCAN_FOODS foods are
 *  the sheet's rows and the rest are named in unknown_items, each by the name a row
 *  would show (`shownFoodName`). */
export const MAX_SCAN_FOODS = 20;

/** The most foods a reply may list at all, the bound this contract has had since
 *  the scanner was built: more is no plate's reply, and breaks the contract. */
const MAX_REPLY_FOODS = 30;

/** No figure past this is an estimate of one item: ten kilos at 900 kcal per 100 g,
 *  the most energy a food carries (pure fat). The bounds per 100 g are the
 *  service's; this only keeps an absurd number out of the arithmetic. */
const MAX_ESTIMATE = 90_000;

/** ONE LIST PER FOOD (RULINGS 2026-09-16): [name, canonical_hint, count, grams,
 *  kcal, protein_g, carbs_g, fat_g], null in a slot the model cannot fill. The
 *  positions carry what the field names used to, in fewer tokens. The vessel, how
 *  full it looked and a size word are no longer asked for: nothing read them once a
 *  row started by its count and grams (ROADMAP 7a-iv-d). A list of any other length,
 *  an item with no name, or a canonical_hint that is not text breaks the contract. A
 *  canonical_hint left null or empty is the item's name: Luna wrote null on 3 of 127
 *  real plates, and it fails no scan. Any other slot holding no usable value is unknown:
 *  - a count that is no whole number from 1 to MAX_PHOTO_COUNT (0, 2.5, 31, "3"),
 *    as the prompt's "Count only reliably countable items" asks — the item stays on
 *    the sheet, started at the photo's own grams, as an item with no count is;
 *  - grams that are none, or more than a meal item may weigh, and kcal or macros
 *    below zero. */
const mealVisionItemSchema = z.tuple([
  z.string().min(1),
  z.string().nullable(),
  orUnknown(z.number().int().min(1).max(MAX_PHOTO_COUNT)),
  orUnknown(z.number().positive().max(MAX_ITEM_GRAMS)),
  orUnknown(z.number().min(0).max(MAX_ESTIMATE)),
  orUnknown(z.number().min(0).max(MAX_ESTIMATE)),
  orUnknown(z.number().min(0).max(MAX_ESTIMATE)),
  orUnknown(z.number().min(0).max(MAX_ESTIMATE)),
]).transform(([name, hint, count, grams, kcal, protein_g, carbs_g, fat_g]) => ({
  name, canonical_hint: hint === null || hint === "" ? name : hint, count, grams, kcal, protein_g, carbs_g, fat_g,
}));
/** A scanned item as the api reads it, by name. */
export type VisionItem = z.infer<typeof mealVisionItemSchema>;

/** The name a scanned food is shown by: its own, or its canonical_hint where its
 *  name says there is none ("N/A") or names no kind of food ("fried item") and the
 *  hint does. */
export const shownFoodName = (item: Pick<VisionItem, "name" | "canonical_hint">): string => {
  if (isNoValueWord(item.name)) return item.canonical_hint;
  const hintNames = !isNoValueWord(item.canonical_hint) && !saysNotIdentified(item.canonical_hint);
  return hintNames && VAGUE_NAME.test(asWritten(item.name)) ? item.canonical_hint : item.name;
};

/** Luna sometimes writes a food in unknown_items as a whole item list, figures and
 *  all (2 of 127 real plates). Only its name is read, so its figures reach no total;
 *  by its hint where its name says there is none. A list that names nothing reads as
 *  "", which the sheet never shows, as it never shows "unknown". */
const nameInList = ([name, hint]: unknown[]): string => {
  if (typeof name === "string" && !isNoValueWord(name)) return name;
  return typeof hint === "string" ? hint : "";
};

/** A reply wrapped in a list of one, `[{…}]`, is what the list holds: the first
 *  scan of ROADMAP 7a-iv-d's prompt came back so, every food in it well formed,
 *  and a paid scan is not lost for the wrapper. Only once, and only a list of one:
 *  what it holds must still be the reply object, so two objects, an empty list or
 *  a list in a list is still no reply. */
const unwrapListOfOne = (v: unknown): unknown => (Array.isArray(v) && v.length === 1 ? v[0] : v);

export const mealVisionEvidenceSchema = z.preprocess((v) => dropFields(RETIRED_EVIDENCE_FIELDS)(unwrapListOfOne(v)), z.object({
  // A photo with no meal on it has no meal name; the retake path answers it.
  // "none", "N/A" and "null" are no name.
  meal_name: optionalNameSchema.default(null),
  items: z.array(mealVisionItemSchema).max(MAX_REPLY_FOODS).default([]),
  unknown_items: z.array(z.union([z.string(), z.array(z.unknown()).transform(nameInList)])).default([]),
  photo_quality: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.enum(["good", "poor"])),
}).strict().transform((evidence) => (evidence.items.length <= MAX_SCAN_FOODS ? evidence : {
  ...evidence,
  items: evidence.items.slice(0, MAX_SCAN_FOODS),
  unknown_items: [...evidence.unknown_items, ...evidence.items.slice(MAX_SCAN_FOODS).map(shownFoodName)],
})));
export type VisionEvidence = z.infer<typeof mealVisionEvidenceSchema>;

/** OpenAI's chat completion, as far as the scanner reads it. A choice whose
 *  content is empty or null is the model answering with nothing; a refusal or a
 *  content filter is the model declining the photo. Usage is required: every
 *  answered scan is billed, so a reply that does not say what it cost is not one. */
export const openAiCompletionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable().default(null), refusal: z.string().nullable().default(null) }),
    finish_reason: z.string().nullable().default(null),
  })).nonempty(),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    // Thinking tokens are counted inside completion_tokens and billed as output.
    completion_tokens: z.number().int().nonnegative(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().default(0) }).default({}),
  }),
});

/** The most close foods one scanned food is checked against (ROADMAP 33a-ii). */
export const MAX_MATCH_ENTRIES = 12;

/** The model's answer to the match check (ROADMAP 33a-ii): for each food it was
 *  asked about, by its number, the number of the close food that is the same food,
 *  or null for none. The numbers are read against the question by the api, so one
 *  out of range ("entry": 0 for none, or a food it was not asked about) is no answer
 *  for that food alone, never another food's, and never the whole plate's. */
export const foodMatchPicksSchema = z.object({
  picks: z.array(z.object({
    food: z.number().int(),
    entry: z.number().int().nullable(),
  }).strict()).max(MAX_SCAN_FOODS),
}).strict();
export type FoodMatchPicks = z.infer<typeof foodMatchPicksSchema>;
