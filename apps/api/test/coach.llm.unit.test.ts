// P2.5b — PURE unit tests: LLM adapter (Zod-parsed responses, retriable
// classification, Groq→OpenRouter fallback composition), cost math, prompt
// port. fetch is stubbed — no network anywhere.
import { describe, expect, it } from "vitest";
import {
  createGroqProvider,
  ProviderError,
  withFallback,
  type ChatProvider,
} from "../src/modules/coach/llm.adapter.js";
import { costMicro, PRICE_MICRO_PER_1M_IN, PRICE_MICRO_PER_1M_OUT } from "../src/modules/coach/service.js";
import { buildSystemPrompt, buildUserMessage, PROMPT_VERSION } from "../src/modules/coach/prompt.js";

const okBody = {
  choices: [{ message: { content: "Bend your knees." } }],
  model: "openai/gpt-oss-20b",
  usage: { prompt_tokens: 100, completion_tokens: 200 },
};

const fetchStub =
  (status: number, body: unknown): typeof fetch =>
  () =>
    Promise.resolve(
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    );

const MESSAGES = [{ role: "user" as const, content: "q" }];

describe("LLM adapter (R2.12: provider responses are external input)", () => {
  it("parses a valid completion with usage", async () => {
    const p = createGroqProvider("k", "openai/gpt-oss-20b", fetchStub(200, okBody)); // gitleaks:allow
    const r = await p.chat(MESSAGES);
    expect(r).toEqual({
      content: "Bend your knees.",
      model: "openai/gpt-oss-20b",
      provider: "groq",
      tokensIn: 100,
      tokensOut: 200,
    });
  });

  it("classifies failures: 429/5xx/network/malformed = retriable; other 4xx = not", async () => {
    const cases: [typeof fetch, boolean][] = [
      [fetchStub(429, {}), true],
      [fetchStub(503, {}), true],
      [() => Promise.reject(new Error("ECONNRESET")), true],
      [fetchStub(200, "not json"), true],
      [fetchStub(200, { choices: [] }), true], // wrong shape
      [fetchStub(401, {}), false], // our-fault: bad key must SURFACE
      [fetchStub(400, {}), false],
    ];
    for (const [f, retriable] of cases) {
      const p = createGroqProvider("k", "m", f); // gitleaks:allow
      const err = await p.chat(MESSAGES).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).retriable).toBe(retriable);
    }
  });

  it("withFallback: fires ONLY on retriable failures (v1 §6.1)", async () => {
    const good: ChatProvider = {
      chat: () =>
        Promise.resolve({ content: "ok", model: "m", provider: "openrouter", tokensIn: 1, tokensOut: 1 }),
    };
    const retriably: ChatProvider = { chat: () => Promise.reject(new ProviderError("x", true)) };
    const fatally: ChatProvider = { chat: () => Promise.reject(new ProviderError("x", false)) };

    expect((await withFallback(retriably, good).chat(MESSAGES)).provider).toBe("openrouter");
    await expect(withFallback(fatally, good).chat(MESSAGES)).rejects.toBeInstanceOf(ProviderError);
    await expect(withFallback(retriably, null).chat(MESSAGES)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("cost math (DECISIONS GAP-5 price constants)", () => {
  it("integer micro-USD, single rounding", () => {
    expect(costMicro(1_000_000, 1_000_000)).toBe(
      BigInt(PRICE_MICRO_PER_1M_IN + PRICE_MICRO_PER_1M_OUT),
    );
    // gpt-oss-20b (2026-07-22): (100·75000 + 200·300000 + 500000)/1e6 = 68
    expect(costMicro(100, 200)).toBe(68n);
    expect(costMicro(0, 0)).toBe(0n);
  });
});

describe("prompt port (coach.py:25-59; GAP-1 omit-missing-fields, T3 finding 2)", () => {
  it("carries only answer-affecting stored fields; NO displayName (leak vector)", () => {
    const p = buildSystemPrompt({ units: "metric", weightKg: 72.5 });
    expect(p).toContain("- Preferred units: metric");
    expect(p).toContain("- Body weight: 72.5 kg");
    expect(p).toContain("never make up information");
    expect(p).not.toContain("Fitness level"); // GAP-1: no storage, no line
    expect(p).not.toContain("Name:"); // finding 2: identity out of the prompt
    const noWeight = buildSystemPrompt({ units: "metric", weightKg: null });
    expect(noWeight).not.toContain("Body weight");
  });

  it("user turn wraps context verbatim (coach.py:84-87) and the version is tagged", () => {
    expect(buildUserMessage("CTX", "Q?")).toBe("CONTEXT FROM KNOWLEDGE BASE:\nCTX\n\nQUESTION: Q?");
    expect(PROMPT_VERSION).toBe(2); // bumped when the prompt shape changed
  });
});
