// P2.5b — LLM gateway adapter (v1 §6.1: "Groq primary → OpenRouter fallback").
// Third-party HTTP wrapper file (R2.2 adapter). No SDK: both providers speak
// the OpenAI-compatible chat API — plain fetch + Zod (R2.12/Part IV #12: a
// malformed provider response is an integration error that DEGRADES the
// feature, never a crash, never stored garbage).
// Fallback fires ONLY on provider-side failures (network, 429, 5xx) — a
// 4xx-our-fault (bad request/auth) must surface, not silently retry.
import { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: "groq" | "openrouter";
  tokensIn: number;
  tokensOut: number;
}

export interface ChatProvider {
  chat(messages: ChatMessage[]): Promise<ChatResult>;
}

/** retriable=true → the fallback provider may be attempted. */
export class ProviderError extends Error {
  readonly retriable: boolean;
  constructor(message: string, retriable: boolean) {
    super(message);
    this.name = "ProviderError";
    this.retriable = retriable;
  }
}

// coach.py:96-97 — the ported per-call budget (v1 §6.1 "per-call token budget").
export const COACH_TEMPERATURE = 0.7;
export const COACH_MAX_TOKENS = 800;

// OpenAI-compatible response, only the fields we consume (R2.3).
const completionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().min(1) }) }))
    .min(1),
  model: z.string().default(""),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().default(0),
      completion_tokens: z.number().int().nonnegative().default(0),
    })
    .default({ prompt_tokens: 0, completion_tokens: 0 }),
});

interface EndpointConfig {
  name: "groq" | "openrouter";
  url: string;
  apiKey: string;
  model: string;
}

function createHttpProvider(ep: EndpointConfig, fetchImpl: typeof fetch): ChatProvider {
  return {
    async chat(messages) {
      let res: Response;
      try {
        res = await fetchImpl(ep.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${ep.apiKey}`,
          },
          body: JSON.stringify({
            model: ep.model,
            messages,
            temperature: COACH_TEMPERATURE,
            max_tokens: COACH_MAX_TOKENS,
            stream: false,
          }),
        });
      } catch {
        throw new ProviderError(`${ep.name}: network failure`, true);
      }
      if (!res.ok) {
        // 429/5xx = provider-side → retriable; other 4xx = our fault → not.
        const retriable = res.status === 429 || res.status >= 500;
        throw new ProviderError(`${ep.name}: HTTP ${String(res.status)}`, retriable);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ProviderError(`${ep.name}: non-JSON response`, true);
      }
      const parsed = completionSchema.safeParse(body);
      if (!parsed.success) {
        throw new ProviderError(`${ep.name}: malformed completion shape`, true);
      }
      const choice = parsed.data.choices[0];
      if (choice === undefined) throw new ProviderError(`${ep.name}: empty choices`, true);
      return {
        content: choice.message.content,
        model: parsed.data.model === "" ? ep.model : parsed.data.model,
        provider: ep.name,
        tokensIn: parsed.data.usage.prompt_tokens,
        tokensOut: parsed.data.usage.completion_tokens,
      };
    },
  };
}

export function createGroqProvider(
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): ChatProvider {
  return createHttpProvider(
    { name: "groq", url: "https://api.groq.com/openai/v1/chat/completions", apiKey, model },
    fetchImpl,
  );
}

/** OpenRouter serves the same Llama family under its own model id. */
export function createOpenRouterProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): ChatProvider {
  return createHttpProvider(
    {
      name: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey,
      model: "meta-llama/llama-3.1-8b-instruct",
    },
    fetchImpl,
  );
}

/** v1 §6.1 composition: primary, then fallback on retriable failures only.
 *  fallback=null (no OPENROUTER_API_KEY) → primary errors surface directly. */
export function withFallback(primary: ChatProvider, fallback: ChatProvider | null): ChatProvider {
  return {
    async chat(messages) {
      try {
        return await primary.chat(messages);
      } catch (err) {
        if (fallback !== null && err instanceof ProviderError && err.retriable) {
          return await fallback.chat(messages);
        }
        throw err;
      }
    },
  };
}
