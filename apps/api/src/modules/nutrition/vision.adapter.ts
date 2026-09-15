// Part 2B §3.2 Stage 1: vision identifies evidence and never computes nutrition.
import { z } from "zod";

// Vision-swap card 2026-07-16: real Groq completions (Scout AND Qwen, captured
// verbatim in nutrition.unit.test.ts) return format variants the strict shapes
// rejected — numeric confidence (0.9), string fill_level ("full"/"N/A"),
// "None" containers, capitalized enums — which 422'd EVERY real scan while the
// fake-provider tests stayed green. The preprocessors below normalize exactly
// those observed variants; everything else (unknown keys, smuggled kcal,
// missing fields) still fails .strict() as before.
const confidenceSchema = z.preprocess((v) => {
  if (typeof v === "string") return v.toLowerCase();
  // Bands are a recorded judgment call (DECISIONS 2026-07-16): models emit
  // 0–1 scores; ≥0.75 high · ≥0.4 medium · else low.
  if (typeof v === "number" && Number.isFinite(v)) return v >= 0.75 ? "high" : v >= 0.4 ? "medium" : "low";
  return v;
}, z.enum(["high", "medium", "low"]));
const fillLevelSchema = z.preprocess(
  // Non-numeric fill levels ("full", "N/A") are UNKNOWN, never guessed at.
  (v) => (typeof v === "string" ? null : v),
  z.number().min(0).max(1).nullable(),
);
const optionalNameSchema = z.preprocess(
  (v) => (typeof v === "string" && ["none", "n/a", "null", ""].includes(v.trim().toLowerCase()) ? null : v),
  z.string().nullable(),
);

/** The most of one item a photo's count may say, where the photo sheet's stepper stops. */
export const MAX_PHOTO_COUNT = 30;
const countSchema = z.preprocess(
  // A count past what one plate can be counted by is no reliable count, so it is
  // UNKNOWN, as the prompt's "Count only reliably countable items" asks; the
  // item stays on the sheet at its uncounted serving.
  (v) => (typeof v === "number" && Number.isInteger(v) && v > MAX_PHOTO_COUNT ? null : v),
  z.number().int().positive().max(MAX_PHOTO_COUNT).nullable(),
);

const itemSchema = z.object({
  name: z.string().min(1), canonical_hint: z.string().min(1), container: optionalNameSchema,
  fill_level: fillLevelSchema, size_class: optionalNameSchema,
  count: countSchema, confidence: confidenceSchema,
}).strict();
const evidenceSchema = z.object({
  meal_name: z.string().min(1), cuisine_guess: z.string().nullable(), items: z.array(itemSchema).max(30),
  scale_anchors: z.array(z.object({ type: z.string(), notes: z.string() }).strict()),
  unknown_items: z.array(z.string()),
  photo_quality: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.enum(["good", "poor"])),
}).strict();
export type VisionEvidence = z.infer<typeof evidenceSchema>;

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1),
  model: z.string().default(""), usage: z.object({ prompt_tokens: z.number().int().nonnegative().default(0), completion_tokens: z.number().int().nonnegative().default(0) }).default({ prompt_tokens: 0, completion_tokens: 0 }),
});

export interface VisionResult { evidence: VisionEvidence; model: string; tokensIn: number; tokensOut: number; }
export interface VisionProvider { analyze(imageBase64: string, mimeType: string): Promise<VisionResult>; }
export class VisionProviderError extends Error {
  constructor(message: string, readonly usage?: { model: string; tokensIn: number; tokensOut: number }) { super(message); this.name = "VisionProviderError"; }
}

export const MEAL_VISION_PROMPT = `Identify visible foods and portion evidence. Return JSON only with meal_name, cuisine_guess, items [{name,canonical_hint,container,fill_level,size_class,count,confidence}], scale_anchors [{type,notes}], unknown_items, photo_quality. Field formats are strict: confidence must be exactly one of the lowercase strings "high", "medium", "low" (never a number); fill_level must be a number between 0 and 1, or null when not applicable; container and size_class must be a string or null (null, not "none" or "N/A"); count must be a positive integer or null; photo_quality must be exactly "good" or "poor" (lowercase). For canonical_hint, prefer the common everyday or local name of the dish over a generic or fancy description — for example "roti" not "flatbread stack", "dal" not "lentil stew", "paneer" not "cottage cheese", "biryani" not "rice dish". Count only reliably countable items. Say unknown instead of guessing. Never output calories, kcal, grams, quantities by weight, protein, carbohydrates, fat, fibre, or any nutrition arithmetic.`;

export function createVisionProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): VisionProvider {
  return { async analyze(imageBase64, mimeType) {
    let response: Response;
    try {
      // Qwen 3.x models on Groq default to reasoning, which burns the token
      // budget before the JSON; reasoning_effort:"none" disables it (Groq
      // docs/reasoning, checked 2026-07-16 — the parameter is Qwen-only).
      const qwenOpts = model.startsWith("qwen/") ? { reasoning_effort: "none" } : {};
      response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0, max_tokens: 1000, response_format: { type: "json_object" }, ...qwenOpts, messages: [{ role: "user", content: [{ type: "text", text: MEAL_VISION_PROMPT }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }] }] }) });
    } catch { throw new VisionProviderError("vision network failure"); }
    if (!response.ok) throw new VisionProviderError(`vision HTTP ${String(response.status)}`);
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new VisionProviderError("vision non-JSON response", { model, tokensIn: 0, tokensOut: 0 }); }
    const completion = completionSchema.safeParse(raw);
    if (!completion.success) throw new VisionProviderError("vision malformed completion", { model, tokensIn: 0, tokensOut: 0 });
    const choice = completion.data.choices[0];
    if (choice === undefined) throw new VisionProviderError("vision empty completion");
    let content: unknown;
    const usage = { model: completion.data.model || model, tokensIn: completion.data.usage.prompt_tokens, tokensOut: completion.data.usage.completion_tokens };
    try { content = JSON.parse(choice.message.content); } catch { throw new VisionProviderError("vision malformed evidence JSON", usage); }
    const evidence = evidenceSchema.safeParse(content);
    if (!evidence.success) throw new VisionProviderError("vision malformed evidence shape", usage);
    return { evidence: evidence.data, ...usage };
  } };
}
