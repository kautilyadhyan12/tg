// P2.5a — retrieval service (retriever.py port). top_k default 3
// (coach.py:70); context formatting verbatim from retriever.py:42-53.
import type { Sql } from "postgres";
import type { Embedder } from "./embedder.js";
import { searchChunks, type RetrievedChunk } from "./repo.js";

export const DEFAULT_TOP_K = 3; // coach.py:70

export async function retrieve(
  sql: Sql,
  embedder: Embedder,
  query: string,
  topK = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  const [embedding] = await embedder.embed([query]);
  if (embedding === undefined) throw new Error("embedder returned no vector for the query");
  return await searchChunks(sql, embedding, topK);
}

/** retriever.py:42-53 verbatim. */
export function formatContext(chunks: readonly RetrievedChunk[]): string {
  if (chunks.length === 0) return "No specific context available.";
  return chunks
    .map((c, i) => `[Source ${String(i + 1)} — ${c.topic}]\n${c.content}`)
    .join("\n\n---\n\n");
}
