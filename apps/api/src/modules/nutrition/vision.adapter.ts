// Part 2B §3.2 Stage 1: vision identifies evidence and never computes nutrition.
// The scanner runs on Gemini (RULINGS 2026-08-24); Groq stays as a switched-off
// spare. MEAL_VISION_MODEL picks one at boot, and every model carries its price.
import { z } from "zod";
import type { AppConfig } from "../../config.js";

// Vision-swap card 2026-07-16: real Groq completions (Scout AND Qwen, captured
// verbatim in nutrition.unit.test.ts) return format variants the strict shapes
// rejected — string fill_level ("full"/"N/A"), "None" containers, capitalized
// enums — which 422'd EVERY real scan while the fake-provider tests stayed
// green. The preprocessors below normalize exactly those observed variants;
// everything else (unknown keys, smuggled kcal) still fails .strict() as before.
// The reply is trimmed to what the app reads (RULINGS 2026-09-15): a field the
// model cannot fill is left out rather than written as null, and the three
// fields nothing ever read — a cuisine guess, scale anchors, a confidence word —
// are no longer asked for; a model that still writes them is not failed for it.
const fillLevelSchema = z.preprocess(
  // Non-numeric fill levels ("full", "N/A") are UNKNOWN, never guessed at.
  (v) => (typeof v === "string" ? null : v),
  z.number().min(0).max(1).nullable(),
).default(null);
const optionalNameSchema = z.preprocess(
  (v) => (typeof v === "string" && ["none", "n/a", "null", ""].includes(v.trim().toLowerCase()) ? null : v),
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

const itemSchema = z.preprocess(dropFields(RETIRED_ITEM_FIELDS), z.object({
  name: z.string().min(1), canonical_hint: z.string().min(1), container: optionalNameSchema,
  fill_level: fillLevelSchema, size_class: optionalNameSchema,
  count: z.number().int().positive().nullable().default(null),
}).strict());
const evidenceSchema = z.preprocess(dropFields(RETIRED_EVIDENCE_FIELDS), z.object({
  // A photo with no meal on it has no meal name; the retake path answers it.
  meal_name: z.preprocess((v) => (v === "" ? null : v), z.string().nullable()).default(null),
  items: z.array(itemSchema).max(30).default([]),
  unknown_items: z.array(z.string()).default([]),
  photo_quality: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.enum(["good", "poor"])),
}).strict());
export type VisionEvidence = z.infer<typeof evidenceSchema>;

export type MealVisionModel = AppConfig["MEAL_VISION_MODEL"];

/** Every model the scanner may run on: its provider, and its public list price
 *  in integer micro-USD per 1M tokens (a photo is input tokens). A model the
 *  config allows without a row here fails the type check, so no scan is ever
 *  priced by guess.
 *  gemini-3.5-flash-lite: $0.30 in, $2.50 out (ai.google.dev/gemini-api/docs/pricing, read 2026-09-15).
 *  qwen/qwen3.6-27b: $0.60 in, $3.00 out (console.groq.com/docs/models, read 2026-09-15). */
export const MEAL_VISION_MODELS: Readonly<Record<MealVisionModel, {
  provider: "gemini" | "groq";
  inputMicroUsdPerMillion: bigint;
  outputMicroUsdPerMillion: bigint;
}>> = {
  "gemini-3.5-flash-lite": { provider: "gemini", inputMicroUsdPerMillion: 300_000n, outputMicroUsdPerMillion: 2_500_000n },
  "qwen/qwen3.6-27b": { provider: "groq", inputMicroUsdPerMillion: 600_000n, outputMicroUsdPerMillion: 3_000_000n },
};

/** A provider that never answers must not hold the scan request open. */
export const VISION_TIMEOUT_MS = 30_000;

/** How many tokens Gemini spends reading the photo. Gemini 3 reads a photo as
 *  about 280 tokens at low, 560 at medium and 1,120 when left unset
 *  (ai.google.dev/gemini-api/docs/media-resolution, read 2026-09-15); null
 *  leaves it to the model. Low found every food the other two settings found
 *  on Kd's eight plates (2026-09-15), so the cheapest setting is the one used. */
export type GeminiMediaResolution = "MEDIA_RESOLUTION_LOW" | "MEDIA_RESOLUTION_MEDIUM" | "MEDIA_RESOLUTION_HIGH" | null;
export const MEAL_SCAN_MEDIA_RESOLUTION: GeminiMediaResolution = "MEDIA_RESOLUTION_LOW";

export interface VisionUsage { tokensIn: number; tokensOut: number; }
export interface VisionResult extends VisionUsage { evidence: VisionEvidence; }
export interface VisionProvider { analyze(imageBase64: string, mimeType: string): Promise<VisionResult>; }
export class VisionProviderError extends Error {
  constructor(message: string, readonly usage?: VisionUsage) { super(message); this.name = "VisionProviderError"; }
}

// The instructions on reading the plate are Kd's whole prompt (RULINGS
// 2026-08-24). What the model writes back is trimmed to what the app reads
// (RULINGS 2026-09-15): no cuisine guess, no scale anchors, no confidence
// word, and a field it cannot fill is left out rather than written as null.
export const MEAL_VISION_PROMPT = `Identify visible foods and portion evidence. Return JSON only with meal_name, items [{name,canonical_hint,container,fill_level,size_class,count}], unknown_items, photo_quality. Write the JSON on one line, with no line breaks or indentation, and leave out any field you cannot fill instead of writing null, "none" or "N/A". Field formats are strict: meal_name must be a short name for the meal; fill_level must be a number between 0 and 1; container and size_class must be strings; count must be a positive integer; photo_quality must be exactly "good" or "poor" (lowercase). For canonical_hint, prefer the common everyday or local name of the dish over a generic or fancy description — for example "roti" not "flatbread stack", "dal" not "lentil stew", "paneer" not "cottage cheese", "biryani" not "rice dish". Count only reliably countable items. Say unknown instead of guessing. Never output calories, kcal, grams, quantities by weight, protein, carbohydrates, fat, fibre, or any nutrition arithmetic.`;

/** The model's JSON text → evidence. A reply that breaks the contract fails
 *  closed and keeps its usage, so the ledger still records the spend. */
function parseEvidence(text: string, usage: VisionUsage): VisionResult {
  let content: unknown;
  try { content = JSON.parse(text); } catch { throw new VisionProviderError("vision malformed evidence JSON", usage); }
  const evidence = evidenceSchema.safeParse(content);
  if (!evidence.success) throw new VisionProviderError("vision malformed evidence shape", usage);
  return { evidence: evidence.data, ...usage };
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().default(0), completion_tokens: z.number().int().nonnegative().default(0) }).default({ prompt_tokens: 0, completion_tokens: 0 }),
});

export function createGroqVisionProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): VisionProvider {
  return { async analyze(imageBase64, mimeType) {
    let response: Response;
    try {
      // Qwen 3.x models on Groq default to reasoning, which burns the token
      // budget before the JSON; reasoning_effort:"none" disables it (Groq
      // docs/reasoning, checked 2026-07-16 — the parameter is Qwen-only).
      const qwenOpts = model.startsWith("qwen/") ? { reasoning_effort: "none" } : {};
      response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0, max_tokens: 1000, response_format: { type: "json_object" }, ...qwenOpts, messages: [{ role: "user", content: [{ type: "text", text: MEAL_VISION_PROMPT }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }] }] }), signal: AbortSignal.timeout(VISION_TIMEOUT_MS) });
    } catch { throw new VisionProviderError("vision network failure"); }
    if (!response.ok) throw new VisionProviderError(`vision HTTP ${String(response.status)}`);
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new VisionProviderError("vision non-JSON response", { tokensIn: 0, tokensOut: 0 }); }
    const completion = completionSchema.safeParse(raw);
    if (!completion.success) throw new VisionProviderError("vision malformed completion", { tokensIn: 0, tokensOut: 0 });
    const choice = completion.data.choices[0];
    if (choice === undefined) throw new VisionProviderError("vision empty completion");
    return parseEvidence(choice.message.content, { tokensIn: completion.data.usage.prompt_tokens, tokensOut: completion.data.usage.completion_tokens });
  } };
}

const geminiReplySchema = z.object({
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

export function createGeminiVisionProvider(
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
  mediaResolution: GeminiMediaResolution = MEAL_SCAN_MEDIA_RESOLUTION,
): VisionProvider {
  return { async analyze(imageBase64, mimeType) {
    let response: Response;
    try {
      // The key rides in a header, never the URL, so nothing that logs a URL
      // can carry it. The prompt goes before the photo, as Google's guide asks
      // for a single image. Temperature stays at Gemini 3's default: Google's
      // Gemini 3 guide warns that below 1.0 it can loop or degrade (Part 2B
      // §3.2's temperature 0 was set for the earlier models). Thinking is
      // pinned to "minimal", since thought tokens bill as output. No response
      // schema: 3.5 Flash-Lite refuses the evidence contract's item shape
      // with a 400, so JSON mode and the prompt carry the contract, and
      // evidenceSchema parses every reply, as on Groq.
      response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: MEAL_VISION_PROMPT }, { inlineData: { mimeType, data: imageBase64 } }] }],
          generationConfig: {
            maxOutputTokens: 1000,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingLevel: "minimal" },
            ...(mediaResolution === null ? {} : { mediaResolution }),
          },
        }),
        signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
      });
    } catch { throw new VisionProviderError("vision network failure"); }
    if (!response.ok) throw new VisionProviderError(`vision HTTP ${String(response.status)}`);
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new VisionProviderError("vision non-JSON response", { tokensIn: 0, tokensOut: 0 }); }
    const reply = geminiReplySchema.safeParse(raw);
    if (!reply.success) throw new VisionProviderError("vision malformed completion", { tokensIn: 0, tokensOut: 0 });
    const meta = reply.data.usageMetadata;
    // Thought tokens bill at the output price, so they count as output.
    const usage = { tokensIn: meta.promptTokenCount, tokensOut: meta.candidatesTokenCount + meta.thoughtsTokenCount };
    if (reply.data.promptFeedback?.blockReason !== undefined) throw new VisionProviderError("vision blocked", usage);
    const parts = reply.data.candidates[0]?.content?.parts ?? [];
    const text = parts.filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
    if (text === "") throw new VisionProviderError("vision empty completion", usage);
    return parseEvidence(text, usage);
  } };
}

/** The scanner the config names, or null when that provider's key is unset:
 *  scanning then answers 503 and the rest of the app runs. */
export function createMealVisionProvider(config: AppConfig, fetchImpl: typeof fetch = fetch): VisionProvider | null {
  const model = config.MEAL_VISION_MODEL;
  if (MEAL_VISION_MODELS[model].provider === "gemini") {
    return config.GEMINI_API_KEY === undefined ? null : createGeminiVisionProvider(config.GEMINI_API_KEY, model, fetchImpl);
  }
  return config.GROQ_API_KEY === undefined ? null : createGroqVisionProvider(config.GROQ_API_KEY, model, fetchImpl);
}
