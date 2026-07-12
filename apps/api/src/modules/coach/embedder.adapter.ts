// P2.5a — MiniLM adapter (third-party wrapper; R2.2 adapter file — `as` casts
// permitted here, each with a same-block runtime guard). Runs
// all-MiniLM-L6-v2 LOCALLY via Transformers.js (the ONNX conversion of the
// exact model the salvage code used — knowledge_base.py:18), honoring Part 4
// §3.7's PINNED vector(384). Weights (~90 MB) download-and-cache on first use
// (DECISIONS GAP-2: ingest is an ops step; deployed hosts warm the cache at
// ingest/boot for the P2.5b in-request query embedding).
import { EMBEDDING_DIM, type Embedder } from "./embedder.js";

// Transformers.js publishes the ONNX conversion under the Xenova namespace.
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** The minimal shape we call — mean-pooled, L2-normalized feature extraction
 *  returning a Tensor with `.tolist()`. */
type FeatureExtractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

export function createMiniLmEmbedder(): Embedder {
  // Lazy singleton: the pipeline (and the one-time weight download) loads on
  // first embed, not at module import.
  let pipe: Promise<FeatureExtractor> | null = null;
  const load = async (): Promise<FeatureExtractor> => {
    const { pipeline } = await import("@huggingface/transformers");
    // The library's "feature-extraction" overload is structurally assignable
    // to FeatureExtractor — no cast needed; the dim check below is the runtime
    // guard on the returned vectors (R2.3).
    return pipeline("feature-extraction", MODEL_ID);
  };
  return {
    async embed(texts) {
      pipe ??= load();
      let extractor: FeatureExtractor;
      try {
        extractor = await pipe;
      } catch (err) {
        pipe = null; // don't cache a rejected load — allow retry (T3 nit)
        throw err;
      }
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
