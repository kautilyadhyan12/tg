// P2.7e — pure transform tests for the coach stage (no DB/Mongo). The key
// guard (GAP-I): messages of a tied-timestamp conversation must come back in
// their original order — created_at is strictly monotonic in array index.
import { describe, expect, it } from "vitest";
import { transformCoach } from "../tools/migrate-mongo/collections/coach.js";
import { uuidv5 } from "../tools/migrate-mongo/uuid5.js";

const cid = "6a11aa00bb11cc22dd33ee44";
const uid = "6a0d468a98494b5b25602e8e";
const TS = "2026-05-19T08:34:03.042Z"; // every message shares this (tied)

function conv(messages: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return { _id: cid, user_id: uid, title: "How do I squat?", updated_at: TS, messages, ...over };
}

describe("transformCoach", () => {
  it("maps the thread and unrolls messages with deterministic sub-ids", () => {
    const d = transformCoach(
      conv([
        { role: "user", content: "How do I squat?", timestamp: TS },
        { role: "assistant", content: "Keep your back neutral.", timestamp: TS },
      ]),
    );
    expect(d).not.toBeNull();
    if (d === null) return;
    expect(d.thread.id).toBe(uuidv5(cid));
    expect(d.thread.userId).toBe(uuidv5(uid));
    expect(d.thread.title).toBe("How do I squat?");
    expect(d.thread.lastMessageAt).toBeInstanceOf(Date);
    expect(d.thread.legacyMongoId).toBe(cid);
    expect(d.messages).toHaveLength(2);
    expect(d.messages[0]?.id).toBe(uuidv5(`${cid}:0`));
    expect(d.messages[1]?.id).toBe(uuidv5(`${cid}:1`));
    expect(d.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(d.messages.map((m) => m.threadId)).toEqual([uuidv5(cid), uuidv5(cid)]);
  });

  it("GAP-I: tied timestamps → created_at strictly increasing in message order", () => {
    const d = transformCoach(
      conv([
        { role: "user", content: "a", timestamp: TS },
        { role: "assistant", content: "b", timestamp: TS },
        { role: "user", content: "c", timestamp: TS },
      ]),
    );
    expect(d).not.toBeNull();
    if (d === null) return;
    const times = d.messages.map((m) => m.createdAt.getTime());
    expect(times[0]).toBeLessThan(times[1] ?? 0);
    expect(times[1]).toBeLessThan(times[2] ?? 0);
    // anchored on the (shared) message timestamp + index ms
    expect(times[0]).toBe(new Date(TS).getTime());
    expect(times[2]).toBe(new Date(TS).getTime() + 2);
  });

  it("skips non-enum roles and malformed messages (fail-soft), keeps index for ids", () => {
    const d = transformCoach(
      conv([
        { role: "user", content: "keep", timestamp: TS },
        { role: "bot", content: "drop — bad role", timestamp: TS }, // not in CHECK enum
        { content: "drop — no role", timestamp: TS },
      ]),
    );
    expect(d?.messages).toHaveLength(1);
    expect(d?.messages[0]?.id).toBe(uuidv5(`${cid}:0`)); // index 0 preserved
  });

  it("handles a titleless, empty-message conversation", () => {
    const d = transformCoach(conv([], { title: null }));
    expect(d?.thread.title).toBeNull();
    expect(d?.messages).toEqual([]);
  });

  it("returns null for a conversation with no _id, and is deterministic", () => {
    expect(transformCoach({ user_id: uid, messages: [] })).toBeNull();
    const a = transformCoach(conv([{ role: "user", content: "x", timestamp: TS }]));
    const b = transformCoach(conv([{ role: "user", content: "x", timestamp: TS }]));
    expect(a?.messages[0]?.id).toBe(b?.messages[0]?.id);
  });
});
