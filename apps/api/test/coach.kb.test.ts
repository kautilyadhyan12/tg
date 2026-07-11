// P2.5a — chunker/embedder unit tests (pure) + ingest/retrieval against REAL
// Postgres with pgvector (R9.2). DB tests use the deterministic fake embedder
// (bag-of-words hash → shared vocabulary lands closer in cosine space), so
// RANKING is provable offline — the real MiniLM path is exercised by the ops
// ingest run, not CI (DECISIONS GAP-2; float rank equality across ONNX
// runtimes is not a contract, same discipline as engine §7.4).
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { CHUNK_OVERLAP_WORDS, CHUNK_SIZE_WORDS, chunkText } from "../src/modules/coach/chunk.js";
import { EMBEDDING_DIM, createFakeEmbedder } from "../src/modules/coach/embedder.js";
import { ingestKnowledgeBase } from "../src/modules/coach/ingest.js";
import { countChunks } from "../src/modules/coach/repo.js";
import { formatContext, retrieve } from "../src/modules/coach/retrieve.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const para = (word: string, n: number) => Array.from({ length: n }, () => word).join(" ");

describe("chunker (knowledge_base.py:45-85 port)", () => {
  it("keeps small paragraphs together in one chunk", () => {
    const text = `${para("alpha", 100)}\n\n${para("beta", 100)}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("alpha");
    expect(chunks[0]).toContain("beta");
  });

  it("flushes at the 500-word target and carries a 50-word overlap", () => {
    const text = `${para("one", 300)}\n\n${para("two", 300)}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBe(2);
    // Overlap: chunk 2 starts with the tail of chunk 1 (knowledge_base.py:74-76).
    const tail = chunks[1]?.split(/\s+/).slice(0, CHUNK_OVERLAP_WORDS) ?? [];
    expect(tail.every((w) => w === "one")).toBe(true);
  });

  it("word-splits an oversized paragraph with the overlap stride", () => {
    const chunks = chunkText(para("big", 1200));
    // stride 450: [0..500),[450..950),[900..1200) → 3 chunks
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.split(/\s+/).length).toBe(CHUNK_SIZE_WORDS);
  });

  it("empty/whitespace input yields no chunks", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("\n\n  \n\n")).toEqual([]);
  });

  it("CRLF separators chunk IDENTICALLY to LF (the /\\n\\s*\\n/ relaxation; T3 P2.5a)", () => {
    // Multi-chunk input so paragraph boundaries + overlap carry are exercised.
    const lf = `${para("alpha", 100)}\n\n${para("beta", 300)}\n\n${para("gamma", 300)}`;
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(chunkText(crlf)).toEqual(chunkText(lf));
    // And the boundary is real (this input actually splits).
    expect(chunkText(lf).length).toBeGreaterThan(1);
  });
});

describe("fake embedder", () => {
  it("is deterministic, 384-dim, L2-normalized, and vocabulary-sensitive", async () => {
    const e = createFakeEmbedder();
    const [a1] = await e.embed(["squat depth knees"]);
    const [a2] = await e.embed(["squat depth knees"]);
    const [b] = await e.embed(["protein grams intake"]);
    expect(a1).toEqual(a2);
    expect(a1?.length).toBe(EMBEDDING_DIM);
    const norm = Math.sqrt((a1 ?? []).reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    // Same-vocab similarity beats different-vocab similarity.
    const [a3] = await e.embed(["how deep should my squat be"]);
    expect(dot(a1 ?? [], a3 ?? [])).toBeGreaterThan(dot(a1 ?? [], b ?? []));
  });
});

d("KB ingest + pgvector retrieval (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const embedder = createFakeEmbedder();

  it("ingests the 5 guides idempotently and retrieves the right doc top-1", { timeout: 120_000 }, async () => {
    const first = await ingestKnowledgeBase(url ?? "", embedder);
    expect(first.docs).toBe(5);
    expect(first.chunks).toBeGreaterThan(5);
    const countAfterFirst = await countChunks(sql);

    // Idempotent: same content → same rows (v1 §7.4 re-ingest is repeatable).
    const second = await ingestKnowledgeBase(url ?? "", embedder);
    expect(second.chunks).toBe(first.chunks);
    expect(await countChunks(sql)).toBe(countAfterFirst);

    // Ranking: the fake embedder is bag-of-words, NOT semantic — so the
    // provable contract here is vocabulary-overlap → cosine order (pgvector
    // `<=>` correctness + meta round-trip). Queries quote distinctive
    // phrases from their target docs; true semantic ranking is MiniLM's job
    // at the ops ingest, outside CI (header note).
    const form = await retrieve(
      sql,
      embedder,
      "feet shoulder-width apart toes slightly pointed out descent pushing hips back knees tracking over toes",
    );
    expect(form.length).toBe(3); // top_k default (coach.py:70)
    expect(form[0]?.doc).toBe("form_guides");
    expect(form[0]?.distance).toBeLessThanOrEqual(form[1]?.distance ?? Infinity);

    const macro = await retrieve(
      sql,
      embedder,
      "protein builds and repairs muscle grams calories carbohydrates macros",
    );
    expect(macro[0]?.doc).toBe("nutrition");

    // Context formatting (retriever.py:42-53 verbatim).
    const ctx = formatContext(form);
    expect(ctx).toContain("[Source 1 — form_guides]");
    expect(ctx.split("\n\n---\n\n").length).toBe(3);
    expect(formatContext([])).toBe("No specific context available.");
  });

  it("a shrunken doc prunes its stale tail chunks on re-ingest", { timeout: 60_000 }, async () => {
    // Simulate a stale tail beyond the real chunk count, then re-ingest.
    await sql`
      INSERT INTO kb_chunks (doc, chunk_index, content, meta)
      VALUES ('form_guides', 9999, 'stale tail', '{}')
      ON CONFLICT (doc, chunk_index) DO NOTHING`;
    await ingestKnowledgeBase(url ?? "", embedder);
    const stale = await sql`
      SELECT 1 FROM kb_chunks WHERE doc = 'form_guides' AND chunk_index = 9999`;
    expect(stale.length).toBe(0);
  });

  it("cleanup", async () => {
    await sql.end({ timeout: 5 });
  });
});
