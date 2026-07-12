// Part 2B §3.2 Stage 1: vision identifies evidence and never computes nutrition.
import { z } from "zod";

const itemSchema = z.object({
  name: z.string().min(1), canonical_hint: z.string().min(1), container: z.string().nullable(),
  fill_level: z.number().min(0).max(1).nullable(), size_class: z.string().nullable(),
  count: z.number().int().positive().nullable(), confidence: z.enum(["high", "medium", "low"]),
}).strict();
const evidenceSchema = z.object({
  meal_name: z.string().min(1), cuisine_guess: z.string().nullable(), items: z.array(itemSchema).max(30),
  scale_anchors: z.array(z.object({ type: z.string(), notes: z.string() }).strict()),
  unknown_items: z.array(z.string()), photo_quality: z.enum(["good", "poor"]),
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

export const MEAL_VISION_PROMPT = `Identify visible foods and portion evidence. Return JSON only with meal_name, cuisine_guess, items [{name,canonical_hint,container,fill_level,size_class,count,confidence}], scale_anchors [{type,notes}], unknown_items, photo_quality. Count only reliably countable items. Say unknown instead of guessing. Never output calories, kcal, grams, quantities by weight, protein, carbohydrates, fat, fibre, or any nutrition arithmetic.`;

export function createVisionProvider(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): VisionProvider {
  return { async analyze(imageBase64, mimeType) {
    let response: Response;
    try {
      response = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, temperature: 0, max_tokens: 1000, response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text: MEAL_VISION_PROMPT }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } }] }] }) });
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
