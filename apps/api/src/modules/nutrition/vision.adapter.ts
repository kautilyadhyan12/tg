// Part 2B §3.2 Stage 1: vision identifies the foods and the portion evidence, and
// gives its own estimate of each food's grams, calories and macros, which the
// app shows only where no food table has the food (RULINGS 2026-09-15, amended
// 2026-09-16). The scanner runs on Gemini (RULINGS 2026-08-24); Groq stays as a
// switched-off spare. MEAL_VISION_MODEL picks one at boot, and every model
// carries its price. Every reply is parsed through the scanner's schemas in
// @app/shared.
import { MAX_SCAN_FOODS, MEAL_VESSELS, geminiReplySchema, groqCompletionSchema, mealVisionEvidenceSchema, type VisionEvidence } from "@app/shared";
import type { AppConfig } from "../../config.js";

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

/** A scan's cost in integer micro-USD at its model's list price; BigInt
 *  end-to-end, rounded half up. The ledger and the cost-measuring tool
 *  (`tools/measure-scan-cost.ts`) both price with this. */
export function visionCostMicro(model: MealVisionModel, tokensIn: number, tokensOut: number): bigint {
  const price = MEAL_VISION_MODELS[model];
  const raw =
    BigInt(tokensIn) * price.inputMicroUsdPerMillion +
    BigInt(tokensOut) * price.outputMicroUsdPerMillion;
  return (raw + 500_000n) / 1_000_000n; // round-half-up, no float near money
}

/** A provider that never answers must not hold the scan request open. */
export const VISION_TIMEOUT_MS = 30_000;

/** The most output tokens one reply may bill: the most a scan can cost. The
 *  number of foods a reply may list (`MAX_SCAN_FOODS`) is sized to fit inside it. */
export const VISION_MAX_OUTPUT_TOKENS = 1000;

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

/** Why a scan failed, which decides what the person is told:
 *  - "unavailable": the provider cannot answer for now (the network, the
 *    timeout, an HTTP 408, 429 or 5xx, or a reply that is not the provider's)
 *    — the scanner's fault, never the photo's, and a try soon may work;
 *  - "refused": the provider refused this request (any other HTTP status), so
 *    the same request is refused however often it is sent;
 *  - "unreadable": the model answered, and its answer cannot be used (blocked,
 *    empty, or breaking the evidence contract).
 *  Only the model's answer carries usage; with no completion there is no
 *  ledger row (ruled — DECISIONS). */
export type VisionFailureKind = "unavailable" | "refused" | "unreadable";
export class VisionProviderError extends Error {
  readonly usage: VisionUsage | undefined;
  constructor(message: string, kind: "unavailable" | "refused");
  constructor(message: string, kind: "unreadable", usage: VisionUsage);
  constructor(message: string, readonly kind: VisionFailureKind, usage?: VisionUsage) {
    super(message);
    this.name = "VisionProviderError";
    this.usage = usage;
  }
}

/** An HTTP error the provider gets over on its own (a request timeout, its
 *  rate limit, a fault of its own) is an outage; any other refuses the request. */
const httpFailure = (status: number): VisionProviderError =>
  new VisionProviderError(`vision HTTP ${String(status)}`, status === 408 || status === 429 || status >= 500 ? "unavailable" : "refused");

// The instructions on reading the plate are Kd's (RULINGS 2026-08-24), word for
// word: what to identify, a name and a canonical_hint on every item, the local
// name before a generic one, counting only what is reliably countable, and
// unknown instead of a guess. What changed is what the model writes back:
// - trimmed to what the app reads (RULINGS 2026-09-15): no cuisine guess, no
//   scale anchors, no confidence word;
// - ONE LIST PER FOOD (RULINGS 2026-09-16), with a null in a slot it cannot
//   fill, so the five numbers ride in fewer tokens than field names would;
// - the model's own grams, kcal and macros for what it sees, always filled —
//   "Never output calories…" went with the redesign of 2026-09-15 — which the
//   app shows only where no table has the food, marked "estimate". Never ending
//   in .0 is for the bill: the shape check wrote "150.0" for every whole number,
//   and each ".0" is output tokens (the shape check, HANDOFF 2026-09-16);
// - a vessel from a fixed list, and a count of whole pieces only (the form
//   ROADMAP 7a-iv reads);
// - at most MAX_SCAN_FOODS items, any other food named in unknown_items, so a
//   crowded plate's reply ends inside the output cap instead of being cut off.
export const MEAL_VISION_PROMPT = `Identify visible foods and portion evidence. Return JSON only with meal_name, items, unknown_items, photo_quality, where every item is one list: [name, canonical_hint, vessel, fill_level, size_class, count, grams, kcal, protein_g, carbs_g, fat_g]. Write the JSON on one line, with no line breaks or indentation, and write null in any slot you cannot fill. Every item always has both name and canonical_hint; a food you cannot name goes in unknown_items, not in items. List at most ${String(MAX_SCAN_FOODS)} items, and put the name of any other food you see in unknown_items. Field formats are strict: meal_name must be a short name for the meal; vessel must be exactly one of ${MEAL_VESSELS.join(", ")}; fill_level must be a number between 0 and 1; size_class must be a string; count must be a positive integer; grams, kcal, protein_g, carbs_g and fat_g must be numbers, your own estimate for the portion shown, always filled, and never end in .0; photo_quality must be exactly "good" or "poor" (lowercase). For canonical_hint, prefer the common everyday or local name of the dish over a generic or fancy description — for example "roti" not "flatbread stack", "dal" not "lentil stew", "paneer" not "cottage cheese", "biryani" not "rice dish". Count only reliably countable items. Say unknown instead of guessing. Count whole pieces only, never slices, chunks or pieces cut from a bigger item.`;

/** The model's JSON text → evidence. A reply that breaks the contract fails
 *  closed and keeps its usage, so the ledger still records the spend. */
function parseEvidence(text: string, usage: VisionUsage): VisionResult {
  let content: unknown;
  try { content = JSON.parse(text); } catch { throw new VisionProviderError("vision malformed evidence JSON", "unreadable", usage); }
  const evidence = mealVisionEvidenceSchema.safeParse(content);
  if (!evidence.success) throw new VisionProviderError("vision malformed evidence shape", "unreadable", usage);
  return { evidence: evidence.data, ...usage };
}

export function createGroqVisionProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): VisionProvider {
  return { async analyze(imageBase64, mimeType) {
    let response: Response;
    try {
      // Qwen 3.x models on Groq default to reasoning, which burns the token
      // budget before the JSON; reasoning_effort:"none" disables it (Groq
      // docs/reasoning, checked 2026-07-16 — the parameter is Qwen-only).
      const qwenOpts = model.startsWith("qwen/") ? { reasoning_effort: "none" } : {};
      response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0, max_tokens: VISION_MAX_OUTPUT_TOKENS, response_format: { type: "json_object" }, ...qwenOpts, messages: [{ role: "user", content: [{ type: "text", text: MEAL_VISION_PROMPT }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }] }] }), signal: AbortSignal.timeout(VISION_TIMEOUT_MS) });
    } catch { throw new VisionProviderError("vision network failure", "unavailable"); }
    if (!response.ok) throw httpFailure(response.status);
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new VisionProviderError("vision non-JSON response", "unavailable"); }
    const completion = groqCompletionSchema.safeParse(raw);
    if (!completion.success) throw new VisionProviderError("vision malformed completion", "unavailable");
    const [choice] = completion.data.choices;
    const usage = { tokensIn: completion.data.usage.prompt_tokens, tokensOut: completion.data.usage.completion_tokens };
    const text = choice.message.content ?? "";
    if (text === "") throw new VisionProviderError("vision empty completion", "unreadable", usage);
    return parseEvidence(text, usage);
  } };
}

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
      // §3.2's temperature 0 was set for the earlier models; Kd ruled the
      // default, RULINGS 2026-09-16). Thinking is pinned to "minimal", since thought
      // tokens bill as output. No response schema: 3.5 Flash-Lite refuses the
      // evidence contract's item shape with a 400, so JSON mode and the prompt
      // carry the contract, and the evidence schema parses every reply, as on Groq.
      response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: MEAL_VISION_PROMPT }, { inlineData: { mimeType, data: imageBase64 } }] }],
          generationConfig: {
            maxOutputTokens: VISION_MAX_OUTPUT_TOKENS,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingLevel: "minimal" },
            ...(mediaResolution === null ? {} : { mediaResolution }),
          },
        }),
        signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
      });
    } catch { throw new VisionProviderError("vision network failure", "unavailable"); }
    if (!response.ok) throw httpFailure(response.status);
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new VisionProviderError("vision non-JSON response", "unavailable"); }
    const reply = geminiReplySchema.safeParse(raw);
    if (!reply.success) throw new VisionProviderError("vision malformed completion", "unavailable");
    const meta = reply.data.usageMetadata;
    // Thought tokens bill at the output price, so they count as output.
    const usage = { tokensIn: meta.promptTokenCount, tokensOut: meta.candidatesTokenCount + meta.thoughtsTokenCount };
    if (reply.data.promptFeedback?.blockReason !== undefined) throw new VisionProviderError("vision blocked", "unreadable", usage);
    const parts = reply.data.candidates[0]?.content?.parts ?? [];
    const text = parts.filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
    if (text === "") throw new VisionProviderError("vision empty completion", "unreadable", usage);
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
