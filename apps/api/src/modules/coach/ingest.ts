// P2.5a — KB ingestion (v1 §7.4: "re-ingest the 5 knowledge docs into
// pgvector (minutes)"; knowledge_base.py:100-158 port). Idempotent: chunks
// upsert on (doc, chunk_index) and shrunken docs prune their stale tail —
// running twice is a no-op. CLI: pnpm --filter api coach:ingest
// (DATABASE_URL required; downloads/caches MiniLM weights on first run —
// DECISIONS GAP-2: ingest is an ops step).
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { chunkText } from "./chunk.js";
import { createMiniLmEmbedder } from "./embedder.adapter.js";
import type { Embedder } from "./embedder.js";
import { deleteStaleChunks, upsertChunk } from "./repo.js";

const KNOWLEDGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "knowledge");

export interface IngestResult {
  docs: number;
  chunks: number;
}

export async function ingestKnowledgeBase(
  databaseUrl: string,
  embedder: Embedder,
  knowledgeDir = KNOWLEDGE_DIR,
): Promise<IngestResult> {
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    const files = (await readdir(knowledgeDir)).filter((f) => f.endsWith(".md")).sort();
    if (files.length === 0) throw new Error(`no .md files in ${knowledgeDir}`);
    let totalChunks = 0;
    for (const file of files) {
      const topic = basename(file, ".md"); // knowledge_base.py:130 — file stem
      const text = await readFile(join(knowledgeDir, file), "utf-8");
      const chunks = chunkText(text);
      const embeddings = await embedder.embed(chunks); // batch (knowledge_base.py:147)
      for (let i = 0; i < chunks.length; i++) {
        const content = chunks[i];
        const embedding = embeddings[i];
        if (content === undefined || embedding === undefined) {
          throw new Error(`embedder returned ${String(embeddings.length)} vectors for ${String(chunks.length)} chunks`);
        }
        await upsertChunk(sql, {
          doc: topic,
          chunkIndex: i,
          content,
          meta: { topic, source: file }, // knowledge_base.py:136-139
          embedding,
        });
      }
      await deleteStaleChunks(sql, topic, chunks.length);
      totalChunks += chunks.length;
    }
    return { docs: files.length, chunks: totalChunks };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// CLI entry (same pattern as seed.ts).
const invokedDirectly =
  process.argv[1]?.endsWith("ingest.js") === true || process.argv[1]?.endsWith("ingest.ts") === true;
if (invokedDirectly) {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") throw new Error("DATABASE_URL is required to ingest");
  const result = await ingestKnowledgeBase(url, createMiniLmEmbedder());
  process.stdout.write(`ingested ${String(result.chunks)} chunks from ${String(result.docs)} docs\n`);
  process.exit(0);
}
