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
