// P2.5a — coach repo: the ONLY file that touches kb_chunks (v1 §6.2, R4.6).
// Retrieval per Part 4 §3.7: cosine distance (`<=>`) over a SEQUENTIAL scan —
// five docs ≈ a few hundred chunks, single-digit ms; "add HNSW only if the
// KB grows 100×". kb_chunks is a GLOBAL resource (no tenant column) — R3.2
// n/a by design, stated not skipped. The embedding travels as a
// parameterized '[...]'::vector cast — never string-built SQL (R3.8).
import type { Sql } from "postgres";
import { EMBEDDING_DIM } from "./embedder.js";

const toVectorLiteral = (v: readonly number[]): string => {
  if (v.length !== EMBEDDING_DIM) {
    throw new Error(`vector dim ${String(v.length)}, expected ${String(EMBEDDING_DIM)}`);
  }
  return `[${v.join(",")}]`;
};

export interface ChunkInput {
  doc: string; // e.g. 'form_guides' (knowledge_base.py:130 topic = file stem)
  chunkIndex: number;
  content: string;
  meta: { topic: string; source: string };
  embedding: readonly number[];
}

/** Idempotent per (doc, chunk_index) — re-ingest updates in place. */
export async function upsertChunk(sql: Sql, c: ChunkInput): Promise<void> {
  await sql`
    INSERT INTO kb_chunks (doc, chunk_index, content, meta, embedding)
    VALUES (${c.doc}, ${c.chunkIndex}, ${c.content}, ${sql.json(c.meta)},
            ${toVectorLiteral(c.embedding)}::vector)
    ON CONFLICT (doc, chunk_index) DO UPDATE SET
      content = EXCLUDED.content,
      meta = EXCLUDED.meta,
      embedding = EXCLUDED.embedding`;
}

/** A re-ingested doc that SHRANK must not leave stale tail chunks behind. */
export async function deleteStaleChunks(sql: Sql, doc: string, fromIndex: number): Promise<void> {
  await sql`DELETE FROM kb_chunks WHERE doc = ${doc} AND chunk_index >= ${fromIndex}`;
}

export async function countChunks(sql: Sql): Promise<number> {
  const rows = await sql<{ n: string }[]>`SELECT count(*) AS n FROM kb_chunks`;
  return Number(rows[0]?.n ?? 0);
}

export interface RetrievedChunk {
  doc: string;
  content: string;
  topic: string;
  source: string;
  distance: number; // cosine distance, rounded like retriever.py:36
}

export async function searchChunks(
  sql: Sql,
  embedding: readonly number[],
  topK: number,
): Promise<RetrievedChunk[]> {
  const rows = await sql<
    { doc: string; content: string; meta: unknown; distance: number }[]
  >`
    SELECT doc, content, meta,
           (embedding <=> ${toVectorLiteral(embedding)}::vector)::float8 AS distance
    FROM kb_chunks
    WHERE embedding IS NOT NULL
    ORDER BY distance ASC
    LIMIT ${topK}`;
  return rows.map((r) => {
    // meta is our own ingest's jsonb — shape-checked on the way out (R2.3).
    const meta =
      typeof r.meta === "object" && r.meta !== null ? (r.meta as Record<string, unknown>) : {};
    return {
      doc: r.doc,
      content: r.content,
      topic: typeof meta["topic"] === "string" ? meta["topic"] : "unknown", // retriever.py:34
      source: typeof meta["source"] === "string" ? meta["source"] : "", // retriever.py:35
      distance: Math.round(r.distance * 10_000) / 10_000, // retriever.py:36 round(...,4)
    };
  });
}

// ── threads & messages (P2.5b; Part 4 §3.7 tables) ──────────────────────────
// Every thread read/write is keyed (id, user_id) — foreign id reads as
// absent (R3.2). api_cost_events (§3.10) and the gym_members spend-time
// lookup are metering/tenancy tables with no owning module yet — written
// here like prior tasks' disclosed crossings.

export interface ThreadRow {
  id: string;
  title: string | null;
  lastMessageAt: Date | null;
}

export async function createThread(sql: Sql, userId: string, title: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO coach_threads (user_id, title, last_message_at)
    VALUES (${userId}, ${title}, now()) RETURNING id`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("thread insert returned no row");
  return id;
}

export async function getThread(sql: Sql, userId: string, threadId: string): Promise<ThreadRow | null> {
  const rows = await sql<{ id: string; title: string | null; last_message_at: Date | null }[]>`
    SELECT id, title, last_message_at FROM coach_threads
    WHERE id = ${threadId} AND user_id = ${userId}`;
  const r = rows[0];
  return r === undefined ? null : { id: r.id, title: r.title, lastMessageAt: r.last_message_at };
}

/** Keyset page on (last_message_at, id) DESC. Fetches limit+1. */
export async function listThreads(
  sql: Sql,
  userId: string,
  input: { limit: number; cursor: { lastMessageAt: Date; id: string } | null },
): Promise<ThreadRow[]> {
  const rows = await sql<{ id: string; title: string | null; last_message_at: Date | null }[]>`
    SELECT id, title, last_message_at FROM coach_threads
    WHERE user_id = ${userId}
      AND (${input.cursor === null}
           OR (last_message_at, id) < (${input.cursor?.lastMessageAt ?? null}, ${input.cursor?.id ?? null}))
    ORDER BY last_message_at DESC NULLS LAST, id DESC
    LIMIT ${input.limit + 1}`;
  return rows.map((r) => ({ id: r.id, title: r.title, lastMessageAt: r.last_message_at }));
}

/** Tenancy-scoped delete; false = not yours/absent (route answers 404). */
export async function deleteThread(sql: Sql, userId: string, threadId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM coach_threads WHERE id = ${threadId} AND user_id = ${userId} RETURNING id`;
  return rows.length > 0;
}

export interface MessageRow {
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

/** Oldest-first tail of the thread (routers/coach.py:33 sends last 12 to the
 *  model; the detail view reads more).
 *  INVARIANT (T3 P2.5b): keyed by thread_id only — every caller MUST first
 *  prove ownership via getThread/createThread (both user_id-scoped). Do not
 *  call this on a thread id that hasn't been ownership-checked, or another
 *  user's messages leak. */
export async function getRecentMessages(
  sql: Sql,
  threadId: string,
  limit: number,
): Promise<MessageRow[]> {
  const rows = await sql<{ role: string; content: string; created_at: Date }[]>`
    SELECT role, content, created_at FROM (
      SELECT role, content, created_at FROM coach_messages
      WHERE thread_id = ${threadId} AND role IN ('user','assistant')
      ORDER BY created_at DESC, id DESC LIMIT ${limit}) tail
    ORDER BY created_at ASC`;
  return rows.map((r) => ({
    role: r.role === "assistant" ? "assistant" : "user",
    content: r.content,
    createdAt: r.created_at,
  }));
}

export interface AssistantMeta {
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costMicro: bigint;
}

export interface CostEvent {
  userId: string;
  gymId: string | null;
  feature: string;
  provider: string;
  units: number;
  unitType: string;
  costMicro: bigint;
}

/** One exchange, atomically (T3 P2.5b finding 3): user + assistant rows,
 *  thread freshness bump, the GAP-4 cap (delete-oldest beyond 200 — the old
 *  $slice semantics, routers/coach.py:34/128), AND — when a real provider
 *  call was made — the api_cost_events ledger row, all in ONE transaction.
 *  A spent call therefore never persists messages without its cost row.
 *  costEvent omitted on the cache-hit path (no spend, no ledger — approved). */
export const STORED_HISTORY_MESSAGES = 200; // routers/coach.py:34

export async function appendExchange(
  sql: Sql,
  threadId: string,
  userContent: string,
  assistantContent: string,
  meta: AssistantMeta,
  costEvent?: CostEvent,
): Promise<void> {
  await sql.begin(async (tx) => {
    // clock_timestamp(), not now(): now() is transaction-stable, which would
    // give both rows the SAME created_at and make user/assistant order
    // ambiguous on read-back.
    await tx`
      INSERT INTO coach_messages (thread_id, role, content, created_at)
      VALUES (${threadId}, 'user', ${userContent}, clock_timestamp())`;
    // cost_micro travels as text→::bigint (postgres.js doesn't parameterize
    // JS bigint by default); stays bigint in the TS domain (R6.1 spirit).
    await tx`
      INSERT INTO coach_messages (thread_id, role, content, model, tokens_in, tokens_out, cost_micro, created_at)
      VALUES (${threadId}, 'assistant', ${assistantContent}, ${meta.model},
              ${meta.tokensIn}, ${meta.tokensOut}, ${meta.costMicro.toString()}::bigint, clock_timestamp())`;
    await tx`UPDATE coach_threads SET last_message_at = now() WHERE id = ${threadId}`;
    await tx`
      DELETE FROM coach_messages WHERE id IN (
        SELECT id FROM coach_messages WHERE thread_id = ${threadId}
        ORDER BY created_at DESC, id DESC OFFSET ${STORED_HISTORY_MESSAGES})`;
    if (costEvent !== undefined) {
      await tx`
        INSERT INTO api_cost_events (user_id, gym_id, feature, provider, units, unit_type, cost_micro)
        VALUES (${costEvent.userId}, ${costEvent.gymId}, ${costEvent.feature}, ${costEvent.provider},
                ${costEvent.units}, ${costEvent.unitType}, ${costEvent.costMicro.toString()}::bigint)`;
    }
  });
}

/** Live gym at spend time (Part 4 §3.10: "gym resolved via live membership
 *  at spend time; null for direct consumers"). */
export async function getLiveGymId(sql: Sql, userId: string): Promise<string | null> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT m.gym_id FROM gym_members m
    JOIN subscriptions s ON s.owner_type = 'gym' AND s.owner_id = m.gym_id
                         AND s.status IN ('trialing','active','past_due')
    WHERE m.user_id = ${userId} AND m.removed_at IS NULL
    LIMIT 1`;
  return rows[0]?.gym_id ?? null;
}
