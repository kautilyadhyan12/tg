// P2.5b — coach chat service (v1 §6.1 gateway semantics): retrieve top-3 →
// versioned system prompt → provider (Groq→OpenRouter fallback) → persist
// exchange with tokens+cost → ONE api_cost_events row + costs:gym bump
// (v1 §9.3 "every external API call"). Exact-match answer cache (GAP-3:
// GLOBAL, keyed question+prompt+model, 24h TTL; hits skip the provider and
// the cost ledger — quota was already counted by the middleware).
import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import type { RedisLike } from "../../redis.js";
import { getUserSyncContext } from "../users/service.js";
import type { Embedder } from "./embedder.js";
import { withFallback, ProviderError, type ChatProvider } from "./llm.adapter.js";
import { buildSystemPrompt, buildUserMessage, PROMPT_VERSION } from "./prompt.js";
import * as repo from "./repo.js";
import { formatContext, retrieve } from "./retrieve.js";
import type { CoachChatResponse, CoachThreadDetail, CoachThreadPage, CoachThreadListQuery } from "./schemas.js";

// Coach-model migration 2026-07-22: re-quoted for openai/gpt-oss-20b (the
// Aug-16 llama-3.1-8b-instant decommission replacement). Groq public list
// price, integer micro-USD per 1M tokens (groq.com/pricing, verified
// 2026-07-22): $0.075/1M input, $0.30/1M output → ×1e6 = the constants below.
// Part 0 rule 4: quoted from the source, NEVER carried over — these SUPERSEDE
// the P2.5b GAP-5 llama constants (50_000 / 80_000). Groq also lists a
// discounted $0.0375/1M CACHED-input rate; we deliberately price every real
// call at the full input rate — the ledger must never under-count (R6.1), and
// our own 24h answer cache already skips the provider on a hit. The OpenRouter
// FALLBACK is still priced at these constants (DECISIONS 2026-07-12): it now
// serves a different model at a different price, so the fallback ledger row is
// an approximation — accepted until a real OpenRouter price line is added
// (fallback is rare; a conservative-enough estimate beats a missing one).
export const PRICE_MICRO_PER_1M_IN = 75_000; // $0.075 / 1M input tokens
export const PRICE_MICRO_PER_1M_OUT = 300_000; // $0.30 / 1M output tokens

export function costMicro(tokensIn: number, tokensOut: number): bigint {
  // Pure BigInt — no float ever touches money (R6.1; T3 P2.5b). Round-half-up
  // via +half-divisor before the integer division.
  const scaled =
    BigInt(tokensIn) * BigInt(PRICE_MICRO_PER_1M_IN) +
    BigInt(tokensOut) * BigInt(PRICE_MICRO_PER_1M_OUT);
  return (scaled + 500_000n) / 1_000_000n;
}

const LLM_HISTORY_MESSAGES = 12; // routers/coach.py:33
const ANSWER_CACHE_TTL_S = 24 * 60 * 60; // GAP-3
const THREAD_TITLE_CHARS = 60; // routers/coach.py:75

/** Typed failure for the central mapper (R8.1); messages client-safe. */
export class CoachError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CoachError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface CoachDeps {
  sql: Sql;
  redis: RedisLike;
  /** null = GROQ_API_KEY unset → coach cleanly 503s (config note). */
  provider: ChatProvider | null;
  embedder: Embedder;
  model: string;
  log: FastifyBaseLogger;
}

export function buildProvider(
  groq: ChatProvider | null,
  openrouter: ChatProvider | null,
): ChatProvider | null {
  if (groq === null) return null;
  return withFallback(groq, openrouter);
}

const normalizeQuestion = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, " ");

/** T3 P2.5b (finding 2): the answer cache is global for cost-saving, but the
 *  prompt is parameterized by the fields that change the ANSWER (units,
 *  weight → nutrition numbers). A cache shared across users MUST key on those,
 *  or user A's weight-derived answer leaks to user B. displayName was dropped
 *  from the prompt entirely (advice-irrelevant, pure identity-leak vector), so
 *  it is NOT in the fingerprint. Free/no-weight users (the majority) share one
 *  key → the cost saving is preserved for them. */
const profileFingerprint = (units: string, weightKg: number | null): string =>
  `${units}|${weightKg === null ? "-" : String(weightKg)}`;

const cacheKey = (model: string, question: string, profileFp: string): string =>
  `coach:ans:${createHash("sha256")
    .update(`${String(PROMPT_VERSION)}|${model}|${profileFp}|${normalizeQuestion(question)}`)
    .digest("hex")}`;

const cachedAnswerSchema = z.object({ content: z.string().min(1) });

export interface ChatHooks {
  /** Fired the instant a NEW thread row commits — which happens before the
   *  provider is called, so a later failure leaves that thread behind, empty.
   *  The retry guard (idempotency.ts) records it so a resend under the same
   *  Idempotency-Key continues in that thread instead of opening another. */
  onThreadOpened?: (threadId: string) => void;
  /** A thread a previous FAILED attempt under the same Idempotency-Key opened.
   *  BEST-EFFORT by design: resumed if it still exists, otherwise a fresh
   *  thread is opened. Unlike `input.threadId` — which is the client asserting
   *  a thread and must 404 when wrong — this one merely remembers, and the user
   *  may legitimately have deleted it in the meantime. */
  resumeThreadId?: string | undefined;
}

export async function chat(
  deps: CoachDeps,
  userId: string,
  input: { message: string; threadId?: string | undefined },
  hooks: ChatHooks = {},
): Promise<CoachChatResponse> {
  if (deps.provider === null) {
    throw new CoachError(503, "coach_unavailable", "The coach is not available right now.");
  }

  // Load-or-create the thread (routers/coach.py:60-82; foreign id → 404 R3.2).
  let threadId: string;
  if (input.threadId !== undefined) {
    const thread = await repo.getThread(deps.sql, userId, input.threadId);
    if (thread === null) throw new CoachError(404, "not_found", "thread not found");
    threadId = thread.id;
  } else {
    // Resume the thread a failed attempt under this key opened — but only if
    // it is still there. getThread is userId-scoped (R3.2), so a remembered id
    // can never resolve to anyone else's thread.
    const resumed =
      hooks.resumeThreadId === undefined
        ? null
        : await repo.getThread(deps.sql, userId, hooks.resumeThreadId);
    if (resumed !== null) {
      threadId = resumed.id;
    } else {
      threadId = await repo.createThread(deps.sql, userId, input.message.slice(0, THREAD_TITLE_CHARS));
      hooks.onThreadOpened?.(threadId);
    }
  }

  // Profile drives the prompt AND the cache key (finding 2) — load it first.
  // Via the users service interface (R7.1); only stored fields (GAP-1).
  const profile = await getUserSyncContext(deps.sql, userId);
  const profileFp = profileFingerprint(profile.units, profile.weightKg);

  // Exact-match answer cache (v1 §6.1): hit = no provider call, no cost event.
  const key = cacheKey(deps.model, input.message, profileFp);
  const hit = await deps.redis.get(key);
  if (hit !== null) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(hit);
    } catch {
      raw = null; // corrupt cache = miss (same posture as the entitlement cache)
    }
    const cached = cachedAnswerSchema.safeParse(raw);
    if (cached.success) {
      await repo.appendExchange(deps.sql, threadId, input.message, cached.data.content, {
        model: `cached:${deps.model}`,
        tokensIn: null,
        tokensOut: null,
        costMicro: 0n,
      });
      return { threadId, reply: cached.data.content, cached: true };
    }
  }

  // RAG + prompt (coach.py:62-89 flow).
  const chunks = await retrieve(deps.sql, deps.embedder, input.message);
  const history = await repo.getRecentMessages(deps.sql, threadId, LLM_HISTORY_MESSAGES);
  const messages = [
    { role: "system" as const, content: buildSystemPrompt({ units: profile.units, weightKg: profile.weightKg }) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: buildUserMessage(formatContext(chunks), input.message) },
  ];

  let result;
  try {
    result = await deps.provider.chat(messages);
  } catch (err) {
    if (err instanceof ProviderError) {
      // R3.10: class + provider only, never the question or response.
      deps.log.warn({ event: "coach.provider_failed", errName: err.message.split(":")[0] }, "coach provider failed");
      throw new CoachError(503, "coach_unavailable", "The coach hit a temporary problem — please try again.");
    }
    throw err;
  }

  // v1 §9.3: EVERY external call → one ledger row. The message rows and the
  // ledger row commit in ONE transaction (T3 P2.5b finding 3) — a spent call
  // can never persist messages without its cost row, or vice-versa. gym_id is
  // resolved at spend time (§3.10) before the tx (a read). The residual
  // "Groq spent but total DB failure" edge is inherent to a non-transactional
  // external call — an outbox is the eventual answer (billing/worker phase).
  const cost = costMicro(result.tokensIn, result.tokensOut);
  const gymId = await repo.getLiveGymId(deps.sql, userId);
  await repo.appendExchange(
    deps.sql,
    threadId,
    input.message,
    result.content,
    {
      model: `${result.model}#p${String(PROMPT_VERSION)}`, // prompt versioning (v1 §6.1)
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costMicro: cost,
    },
    {
      userId,
      gymId,
      feature: "coach",
      provider: result.provider,
      units: result.tokensIn + result.tokensOut,
      unitType: "tokens",
      costMicro: cost,
    },
  );

  if (gymId !== null) {
    const month = new Date().toISOString().slice(0, 7).replace("-", "");
    await deps.redis.incrWithTtl(`costs:gym:${gymId}:${month}`, 40 * 24 * 60 * 60);
  }

  await deps.redis.setex(key, ANSWER_CACHE_TTL_S, JSON.stringify({ content: result.content }));
  return { threadId, reply: result.content, cached: false };
}

// ── thread reads (routers/coach.py:144-208 port) ────────────────────────────

function parseCursor(cursor: string | undefined): { lastMessageAt: Date; id: string } | null {
  if (cursor === undefined) return null;
  const sep = cursor.indexOf("|");
  if (sep === -1) return null;
  const lastMessageAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (Number.isNaN(lastMessageAt.getTime()) || !uuidRe.test(id)) return null;
  return { lastMessageAt, id };
}

export async function listThreads(
  deps: Pick<CoachDeps, "sql">,
  userId: string,
  query: CoachThreadListQuery,
): Promise<CoachThreadPage> {
  const rows = await repo.listThreads(deps.sql, userId, {
    limit: query.limit,
    cursor: parseCursor(query.cursor),
  });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items[items.length - 1];
  return {
    items: items.map((t) => ({
      id: t.id,
      title: t.title,
      lastMessageAt: t.lastMessageAt === null ? null : t.lastMessageAt.toISOString(),
    })),
    nextCursor:
      hasMore && last !== undefined && last.lastMessageAt !== null
        ? `${last.lastMessageAt.toISOString()}|${last.id}`
        : null,
  };
}

export async function getThreadDetail(
  deps: Pick<CoachDeps, "sql">,
  userId: string,
  threadId: string,
): Promise<CoachThreadDetail | null> {
  const thread = await repo.getThread(deps.sql, userId, threadId);
  if (thread === null) return null;
  const messages = await repo.getRecentMessages(deps.sql, threadId, repo.STORED_HISTORY_MESSAGES);
  return {
    id: thread.id,
    title: thread.title,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function deleteThread(
  deps: Pick<CoachDeps, "sql">,
  userId: string,
  threadId: string,
): Promise<boolean> {
  return await repo.deleteThread(deps.sql, userId, threadId);
}
