// Part 4 §3.7 — Coach (Chroma → pgvector, v1 §6.1). Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, vector } from "./common.js";
import { users } from "./identity.js";

export const coachThreads = pgTable("coach_threads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  legacyMongoId: text("legacy_mongo_id").unique(),
  createdAt: createdAt(),
});

export const coachMessages = pgTable(
  "coach_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => coachThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costMicro: bigint("cost_micro", { mode: "bigint" }),
    currency: text("currency").default("USD"),
    createdAt: createdAt(),
  },
  (t) => [
    check("coach_messages_role_check", sql`${t.role} IN ('user','assistant','system')`),
    index("coach_messages_thread_created_idx").on(t.threadId, t.createdAt),
  ],
);

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    doc: text("doc").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    meta: jsonb("meta").notNull().default(sql`'{}'`),
    embedding: vector("embedding", 384), // dimension PINNED to the embedder chosen at port; 384 = MiniLM-class
    createdAt: createdAt(),
  },
  (t) => [unique("kb_chunks_doc_chunk_uq").on(t.doc, t.chunkIndex)],
);
