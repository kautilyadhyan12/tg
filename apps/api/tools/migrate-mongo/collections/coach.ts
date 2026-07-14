// P2.7e — coach stage. Transforms a legacy `coach_conversations` doc into a
// `coach_threads` row + its unrolled `coach_messages` rows, inserted
// idempotently. Field contract mirrors the coach.ts schema. GAP-I: the read
// path orders messages by (created_at DESC, id DESC) but id=UUIDv5(convHex:index)
// is a hash and every conversation's per-message timestamps are tied — so
// created_at is set to anchor + arrayIndex ms to preserve the original order.
import { z } from "zod";
import type { Sql } from "postgres";
import { uuidv5 } from "../uuid5.js";

type CoachRole = "user" | "assistant" | "system";

/** Narrow a legacy role string to the CHECK enum, or null (skip the message). */
function toRole(r: string): CoachRole | null {
  return r === "user" || r === "assistant" || r === "system" ? r : null;
}

const legacyMessageSchema = z
  .object({
    role: z.string(),
    content: z.string(), // NOT NULL target; a null/absent content skips the message
    timestamp: z.union([z.date(), z.string()]).nullish(),
  })
  .passthrough();

const legacyConvSchema = z
  .object({
    _id: z.string().min(1),
    user_id: z.string().min(1),
    title: z.string().nullish(),
    updated_at: z.union([z.date(), z.string()]).nullish(),
    messages: z.array(z.unknown()).nullish(),
  })
  .passthrough();

function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface CoachMessageRow {
  id: string;
  threadId: string;
  role: CoachRole;
  content: string;
  createdAt: Date;
}

export interface CoachThreadRow {
  id: string;
  userId: string;
  title: string | null;
  lastMessageAt: Date | null;
  legacyMongoId: string;
}

export interface CoachData {
  thread: CoachThreadRow;
  messages: CoachMessageRow[];
}

/** Pure transform — null only when the conversation itself is unparseable
 *  (missing _id/user_id). A malformed or non-enum-role message is skipped
 *  (fail-soft), never fatal to the thread. */
export function transformCoach(doc: unknown): CoachData | null {
  const parsed = legacyConvSchema.safeParse(doc);
  if (!parsed.success) return null;
  const c = parsed.data;
  const items = c.messages ?? [];

  // GAP-I anchor: the conversation's start (first parseable message timestamp,
  // else updated_at, else epoch). created_at = anchor + arrayIndex ms → strictly
  // monotonic in message order regardless of the tied raw timestamps.
  let anchorMs: number | null = null;
  for (const raw of items) {
    const p = legacyMessageSchema.safeParse(raw);
    if (p.success) {
      const d = toDate(p.data.timestamp);
      if (d !== null) {
        anchorMs = d.getTime();
        break;
      }
    }
  }
  if (anchorMs === null) anchorMs = toDate(c.updated_at)?.getTime() ?? 0;

  const messages: CoachMessageRow[] = [];
  items.forEach((raw, i) => {
    const p = legacyMessageSchema.safeParse(raw);
    if (!p.success) return; // malformed → fail-soft skip
    const role = toRole(p.data.role);
    if (role === null) return; // non-enum role → skip (CHECK guard)
    messages.push({
      id: uuidv5(`${c._id}:${String(i)}`), // G-subid; i is the ORIGINAL array index
      threadId: uuidv5(c._id),
      role,
      content: p.data.content,
      createdAt: new Date(anchorMs + i),
    });
  });

  return {
    thread: {
      id: uuidv5(c._id),
      userId: uuidv5(c.user_id),
      title: typeof c.title === "string" ? c.title : null,
      lastMessageAt: toDate(c.updated_at),
      legacyMongoId: c._id,
    },
    messages,
  };
}

export interface CoachInsertOutcome {
  threadInserted: number;
  messagesInserted: number;
}

/** Idempotent insert of a thread + its messages in one transaction. Both keyed
 *  on deterministic UUIDv5 PKs → re-runs are no-ops (ON CONFLICT (id)). */
export async function insertCoach(sql: Sql, d: CoachData): Promise<CoachInsertOutcome> {
  return await sql.begin(async (tx) => {
    const t = await tx`
      INSERT INTO coach_threads (id, user_id, title, last_message_at, legacy_mongo_id)
      VALUES (${d.thread.id}, ${d.thread.userId}, ${d.thread.title},
              ${d.thread.lastMessageAt}, ${d.thread.legacyMongoId})
      ON CONFLICT (id) DO NOTHING`;
    let messagesInserted = 0;
    for (const m of d.messages) {
      const r = await tx`
        INSERT INTO coach_messages (id, thread_id, role, content, created_at)
        VALUES (${m.id}, ${m.threadId}, ${m.role}, ${m.content}, ${m.createdAt})
        ON CONFLICT (id) DO NOTHING`;
      messagesInserted += r.count;
    }
    return { threadInserted: t.count, messagesInserted };
  });
}
