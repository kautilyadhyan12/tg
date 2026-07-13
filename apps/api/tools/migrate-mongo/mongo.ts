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

export async function connectMongo(uri: string, dbName = "ai_home_gym"): Promise<MongoReader> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName);
  return {
    async each(collection, fn) {
      let n = 0;
      const cursor = db.collection(collection).find({});
      for await (const raw of cursor) {
        const doc: Record<string, unknown> = { ...raw, _id: toHex(raw._id) };
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
