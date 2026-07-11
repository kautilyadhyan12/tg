// P2.5a — chunker, ported from knowledge_base.py:45-85 VERBATIM (constants
// and packing algorithm; R0/Part 2 §8 spirit — port, don't re-derive):
// paragraph-pack toward a 500-WORD target with a 50-word overlap carried
// from the previous chunk; oversized paragraphs word-split with the same
// overlap stride. Word = whitespace token, exactly like str.split().

export const CHUNK_SIZE_WORDS = 500; // knowledge_base.py:45 chunk_size
export const CHUNK_OVERLAP_WORDS = 50; // knowledge_base.py:45 overlap

const words = (s: string): string[] => s.split(/\s+/).filter((w) => w !== "");

export function chunkText(
  text: string,
  chunkSize = CHUNK_SIZE_WORDS,
  overlap = CHUNK_OVERLAP_WORDS,
): string[] {
  // knowledge_base.py:51 — split on blank lines (paragraphs).
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");

  const chunks: string[] = [];
  let current = "";
  let currentSize = 0;

  for (const para of paragraphs) {
    const paraSize = words(para).length;

    // knowledge_base.py:61-69 — big paragraph: flush, then word-split with
    // an overlap stride.
    if (paraSize > chunkSize) {
      if (current !== "") {
        chunks.push(current);
        current = "";
        currentSize = 0;
      }
      const ws = words(para);
      for (let i = 0; i < ws.length; i += chunkSize - overlap) {
        chunks.push(ws.slice(i, i + chunkSize).join(" "));
      }
      continue;
    }

    // knowledge_base.py:72-77 — would overflow: flush and carry the tail
    // overlap into the next chunk.
    if (currentSize + paraSize > chunkSize) {
      chunks.push(current);
      const overlapWords = current === "" ? [] : words(current).slice(-overlap);
      current = overlapWords.length > 0 ? `${overlapWords.join(" ")}\n\n${para}` : para;
      currentSize = words(current).length;
    } else {
      current = current === "" ? para : `${current}\n\n${para}`;
      currentSize += paraSize;
    }
  }

  if (current !== "") chunks.push(current);
  return chunks;
}
