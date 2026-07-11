// P2.5a — embedding seam. The real impl runs all-MiniLM-L6-v2 LOCALLY
// (Transformers.js ONNX port of the exact model the salvage code used —
// knowledge_base.py:18 "sentence-transformers/all-MiniLM-L6-v2"), honoring
// Part 4 §3.7's PINNED vector(384). Mean pooling + L2-normalize matches
// sentence-transformers' defaults, so cosine ranking is a true port.
// Weights (~90 MB) download-and-cache on first use (DECISIONS GAP-2: ingest
// is an ops step, never a request path... except the P2.5b query embedding —
// deployed hosts warm the cache at ingest/boot).
// Tests use createFakeEmbedder: deterministic, dependency-free, and built so
// texts sharing more words land closer in cosine space — ranking is testable
// without ONNX.
export const EMBEDDING_DIM = 384; // Part 4 §3.7, pinned

export interface Embedder {
  /** One L2-normalized EMBEDDING_DIM vector per input text. */
  embed(texts: readonly string[]): Promise<number[][]>;
}

// Transformers.js publishes the ONNX conversion under the Xenova namespace.
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

export function createMiniLmEmbedder(): Embedder {
  // Lazy singleton: the pipeline (and the one-time weight download) loads on
  // first embed, not at module import (keeps app boot free of it).
  let pipe: Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>> | null =
    null;
  const load = async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const p = await pipeline("feature-extraction", MODEL_ID);
    return p as unknown as (texts: string[], opts: object) => Promise<{ tolist(): number[][] }>;
  };
  return {
    async embed(texts) {
      pipe ??= load();
      const extractor = await pipe;
      const out = await extractor([...texts], { pooling: "mean", normalize: true });
      const vectors = out.tolist();
      for (const v of vectors) {
        if (v.length !== EMBEDDING_DIM) {
          throw new Error(`embedder returned dim ${String(v.length)}, expected ${String(EMBEDDING_DIM)}`);
        }
      }
      return vectors;
    },
  };
}

/** Deterministic bag-of-words hash embedding: each word bumps a hashed
 *  coordinate, then L2-normalize — shared vocabulary ⇒ higher cosine
 *  similarity, so retrieval RANKING tests are meaningful offline. */
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
