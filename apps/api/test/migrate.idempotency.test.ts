// P2.7b — the migration is idempotent (Part 4 §7): the same users insert run
// twice yields ONE row, second run inserts 0 (ON CONFLICT DO NOTHING).
// DATABASE_URL-gated; fixture prefix p27b-, cleaned before + after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { insertUser, transformUser } from "../tools/migrate-mongo/collections/users.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

d("migration users stage is idempotent (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });
  const clean = () => sql`DELETE FROM users WHERE legacy_mongo_id LIKE 'p27b-%'`;
  beforeAll(async () => { await clean(); });
  afterAll(async () => { await clean(); await sql.end({ timeout: 5 }); });

  it("first insert writes 1, re-run writes 0, exactly one row persists", async () => {
    const doc = { _id: "p27b-aaaa1111bbbb2222cccc3333", email: "p27b-idem@example.com", fullName: "Idem User", password: "$2b$10$abcdefghijklmnopqrstuv", weight: { value: 154, unit: "lb" } };
    const row = transformUser(doc);
    expect(row).not.toBeNull();
    if (row === null) return;

    expect(await insertUser(sql, row)).toBe(1);
    expect(await insertUser(sql, row)).toBe(0); // idempotent no-op

    const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users WHERE legacy_mongo_id = ${doc._id}`;
    expect(rows[0]?.n).toBe(1);

    // deterministic id + bcrypt preserved byte-for-byte
    const stored = await sql<{ id: string; password_hash: string; hash_algo: string }[]>`
      SELECT id, password_hash, hash_algo FROM users WHERE legacy_mongo_id = ${doc._id}`;
    expect(stored[0]?.id).toBe(row.id);
    expect(stored[0]?.password_hash).toBe(doc.password);
    expect(stored[0]?.hash_algo).toBe("bcrypt");
  }, 30_000);
});
