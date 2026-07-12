// P2.5a — embedding seam (interface + constant + the test fake). The real
// MiniLM adapter lives in embedder.adapter.ts (third-party wrapper, R2.2
// adapter exemption); this file stays cast-free.
//
// Retrieval metric note (T3 P2.5a, DECISIONS): the real adapter L2-normalizes
// its output and repo.ts scores with cosine distance — the conventional and
// recommended similarity metric for MiniLM sentence embeddings. This is NOT
// bit-identical to the old Chroma path (default L2 distance over
// NON-normalized vectors); rankings can differ in principle. Normalized-cosine
// is the standard choice and is what the ported retrieval quality was
// spot-checked against at ingest.
export const EMBEDDING_DIM = 384; // Part 4 §3.7, pinned

export interface Embedder {
  /** One L2-normalized EMBEDDING_DIM vector per input text. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

/** Deterministic bag-of-words hash embedding: each word bumps a hashed
 *  coordinate, then L2-normalize — shared vocabulary ⇒ higher cosine
 *  similarity, so retrieval RANKING tests are meaningful offline (no ONNX). */
export function createFakeEmbedder(): Embedder {
  const coord = (word: string): number => {
    let h = 2166136261; // FNV-1a
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % EMBEDDING_DIM;
  };
  return {
    embed(texts) {
      return Promise.resolve(
        texts.map((t) => {
          const v = new Array<number>(EMBEDDING_DIM).fill(0);
          for (const w of t.toLowerCase().split(/\W+/)) {
            if (w !== "") v[coord(w)] = (v[coord(w)] ?? 0) + 1;
          }
          const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
          return v.map((x) => x / norm);
        }),
      );
    },
  };
}
