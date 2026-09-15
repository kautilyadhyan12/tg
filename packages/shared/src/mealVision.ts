// The meal scanner's model replies (Part 2B §3.2 Stage 1): the evidence the
// model writes, and the envelope each provider wraps it in. Only
// apps/api/src/modules/nutrition/vision.adapter.ts reads a provider's reply,
// and it parses every reply through these (CLAUDE.md §4: AI responses cross
// the boundary through a schema in packages/shared).
import { z } from "zod";

// Vision-swap card 2026-07-16: real Groq completions (Scout AND Qwen, captured
// verbatim in the api's nutrition.unit.test.ts) return format variants the
// strict shapes rejected — string fill_level ("full"/"N/A"), "None" containers,
// capitalized enums — which 422'd EVERY real scan while the fake-provider tests
// stayed green. The preprocessors below normalize exactly those observed
// variants; everything else (unknown keys, smuggled kcal) still fails .strict().
// The reply is trimmed to what the app reads (RULINGS 2026-09-15): a field the
// model cannot fill is left out rather than written as null, and the three
// fields nothing ever read — a cuisine guess, scale anchors, a confidence word —
// are no longer asked for; a model that still writes them is not failed for it.
const fillLevelSchema = z.preprocess(
  // Non-numeric fill levels ("full", "N/A") are UNKNOWN, never guessed at.
  (v) => (typeof v === "string" ? null : v),
  z.number().min(0).max(1).nullable(),
).default(null);
/** What a model writes for a name it does not have, however it is spelled: the
 *  prompt's own null, "none", "N/A" and unknown, and nothing at all. */
export const NO_VALUE_WORDS: readonly string[] = ["none", "n/a", "null", "unknown", ""];
const optionalNameSchema = z.preprocess(
  (v) => (typeof v === "string" && NO_VALUE_WORDS.includes(v.trim().toLowerCase()) ? null : v),
  z.string().nullable(),
).default(null);

/** The fields the scanner stopped asking for on 2026-09-15, dropped from a
 *  reply that still carries them before .strict() sees it. */
export const RETIRED_ITEM_FIELDS: readonly string[] = ["confidence"];
export const RETIRED_EVIDENCE_FIELDS: readonly string[] = ["cuisine_guess", "scale_anchors"];
const dropFields = (fields: readonly string[]) => (v: unknown): unknown =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([k]) => !fields.includes(k)))
    : v;

/** The most of one item a photo's count may say, where the photo sheet's stepper stops. */
export const MAX_PHOTO_COUNT = 30;
const countSchema = z.preprocess(
  // A count is a whole number of things from 1 to the sheet's stepper. Any other
  // value the model gives (0, 2.5, 31, "3") is no reliable count, so it is
  // UNKNOWN, as the prompt's "Count only reliably countable items" asks; the
  // item stays on the sheet at its uncounted serving, and the paid scan is kept.
  // A count left out is unknown too, as every field the model cannot fill is.
  (v) => (v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_PHOTO_COUNT) ? v : null),
  z.number().int().positive().max(MAX_PHOTO_COUNT).nullable(),
).default(null);

const mealVisionItemSchema = z.preprocess(dropFields(RETIRED_ITEM_FIELDS), z.object({
  name: z.string().min(1), canonical_hint: z.string().min(1), container: optionalNameSchema,
  fill_level: fillLevelSchema, size_class: optionalNameSchema,
  count: countSchema,
}).strict());

export const mealVisionEvidenceSchema = z.preprocess(dropFields(RETIRED_EVIDENCE_FIELDS), z.object({
  // A photo with no meal on it has no meal name; the retake path answers it.
  // "none", "N/A" and "null" are no name, as they are for a container.
  meal_name: optionalNameSchema,
  items: z.array(mealVisionItemSchema).max(30).default([]),
  unknown_items: z.array(z.string()).default([]),
  photo_quality: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.enum(["good", "poor"])),
}).strict());
export type VisionEvidence = z.infer<typeof mealVisionEvidenceSchema>;

/** Groq's OpenAI-style chat completion, as far as the scanner reads it. A
 *  choice whose content is empty or null is the model answering with nothing. */
export const groqCompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().default(null) }) })).nonempty(),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().default(0), completion_tokens: z.number().int().nonnegative().default(0) }).default({ prompt_tokens: 0, completion_tokens: 0 }),
});

/** Gemini's generateContent reply, as far as the scanner reads it. */
export const geminiReplySchema = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).default([]) }).optional(),
  })).default([]),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z.object({
    promptTokenCount: z.number().int().nonnegative().default(0),
    candidatesTokenCount: z.number().int().nonnegative().default(0),
    thoughtsTokenCount: z.number().int().nonnegative().default(0),
  }).default({}),
});
