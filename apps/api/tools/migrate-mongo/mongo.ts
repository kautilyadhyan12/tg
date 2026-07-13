// P2.7b — read-only Mongo reader. Streams docs with `_id` normalized to a hex
// string (so downstream transforms are string-only and Zod-parseable). Never
// logs the URI. Reads only — the migration never writes to Mongo (Part 4 §7).
import { MongoClient, ObjectId } from "mongodb";

export interface MongoReader {
  /** Stream every doc in `collection`; returns the number processed. */
  each(collection: string, fn: (doc: Record<string, unknown>) => Promise<void> | void): Promise<number>;
  count(collection: string): Promise<number>;
  close(): Promise<void>;
}

const toHex = (id: unknown): string => (id instanceof ObjectId ? id.toHexString() : String(id));

// P2.7c: emit string-only ids. Any top-level ObjectId field (e.g.
// workout_sessions.user_id) → hex, so downstream transforms stay string-typed
// and Zod-parseable (the reader's documented intent). Nested docs are not
// touched — no collection needs it.
const normalizeIds = (raw: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = v instanceof ObjectId ? v.toHexString() : v;
  return out;
};

export async function connectMongo(uri: string, dbName = "ai_home_gym"): Promise<MongoReader> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName);
  return {
    async each(collection, fn) {
      let n = 0;
      const cursor = db.collection(collection).find({});
      for await (const raw of cursor) {
        const doc = normalizeIds(raw);
        doc["_id"] = toHex(raw._id); // _id is always a hex string, even if not an ObjectId instance
        await fn(doc);
        n += 1;
      }
      return n;
    },
    // countDocuments (exact) not estimatedDocumentCount (metadata estimate) —
    // §7's "counts match ±0" gate must not ride an estimate (T3 finding 1).
    count: (collection) => db.collection(collection).countDocuments({}),
    close: () => client.close(),
  };
}
