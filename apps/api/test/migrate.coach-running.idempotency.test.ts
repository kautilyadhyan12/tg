// P2.7e — end-to-end coach + running stages against real Postgres: rows persist,
// coach messages read back IN ORDER despite tied timestamps (GAP-I), the
// polyline round-trips as its JSON string, and every stage is idempotent.
// DATABASE_URL-gated; fixture prefix p27e-, cleaned before + after.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { insertUser, transformUser } from "../tools/migrate-mongo/collections/users.js";
import { insertCoach, transformCoach } from "../tools/migrate-mongo/collections/coach.js";
import { insertRoute, insertRun, transformRoute, transformRun } from "../tools/migrate-mongo/collections/running.js";
import { getRecentMessages } from "../src/modules/coach/repo.js";
import { uuidv5 } from "../tools/migrate-mongo/uuid5.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

d("migration coach + running stages: persistence + ordering + idempotency (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });
  const userMongoId = "p27e-user-aaaa1111bbbb2222";
  const userId = uuidv5(userMongoId);

  const clean = async (): Promise<void> => {
    await sql`DELETE FROM runs WHERE user_id = ${userId}`; // FK RESTRICT — before user
    await sql`DELETE FROM coach_threads WHERE user_id = ${userId}`; // cascades coach_messages
    await sql`DELETE FROM users WHERE legacy_mongo_id LIKE 'p27e-%'`; // cascades saved_routes
  };

  beforeAll(async () => {
    await clean();
    const u = transformUser({ _id: userMongoId, email: "p27e-cr@example.com", fullName: "CR User", password: "$2b$10$abcdefghijklmnopqrstuv" });
    expect(u).not.toBeNull();
    if (u !== null) await insertUser(sql, u);
  }, 60_000);
  afterAll(async () => {
    await clean();
    await sql.end({ timeout: 5 });
  }, 30_000);

  it("coach thread + tied-timestamp messages read back IN ORDER, idempotently", async () => {
    const TS = "2026-05-19T08:34:03.042Z"; // both messages share it
    const data = transformCoach({
      _id: "p27e-conv-cccc3333dddd4444",
      user_id: userMongoId,
      title: "How do I squat?",
      updated_at: TS,
      messages: [
        { role: "user", content: "How do I squat?", timestamp: TS },
        { role: "assistant", content: "Keep your back neutral.", timestamp: TS },
      ],
    });
    expect(data).not.toBeNull();
    if (data === null) return;

    expect(await insertCoach(sql, data)).toEqual({ threadInserted: 1, messagesInserted: 2 });
    expect(await insertCoach(sql, data)).toEqual({ threadInserted: 0, messagesInserted: 0 }); // idempotent

    // read through the REAL production read path (getRecentMessages), whose
    // outer sort is `created_at ASC` with no id tiebreaker — this is exactly
    // what GAP-I's monotonic created_at must satisfy (T3 advisory 2).
    const msgs = await getRecentMessages(sql, data.thread.id, 10);
    expect(msgs.map((m) => m.content)).toEqual(["How do I squat?", "Keep your back neutral."]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  }, 60_000);

  it("run persists with the JSON polyline and is idempotent", async () => {
    const path = [[26.71547, 94.17095], [26.71600, 94.17100]];
    const row = transformRun({
      _id: "p27e-run-eeee5555ffff6666",
      user_id: userMongoId,
      started_at: "2026-06-20T20:32:18Z",
      duration_min: 30,
      distance_km: 5,
      calories_burned: 250,
      path,
    });
    expect(row).not.toBeNull();
    if (row === null) return;

    expect(await insertRun(sql, row)).toBe(1);
    expect(await insertRun(sql, row)).toBe(0); // idempotent

    const [r] = await sql<{ polyline: string; duration_s: number; distance_m: number; kcal_calc_version: number; source: string }[]>`
      SELECT polyline, duration_s, distance_m, kcal_calc_version, source FROM runs WHERE id = ${row.id}`;
    expect(r?.polyline).toBe(JSON.stringify(path)); // opaque round-trip
    expect(r?.duration_s).toBe(1800);
    expect(r?.distance_m).toBe(5000);
    expect(r?.kcal_calc_version).toBe(0);
    expect(r?.source).toBe("mobile");
  }, 60_000);

  it("saved route persists and is idempotent", async () => {
    const coords = [[26.714, 94.175], [26.715, 94.176]];
    const row = transformRoute({
      _id: "p27e-route-7777888899990000",
      user_id: userMongoId,
      label: "Best match",
      coords,
      distance_km: 2.8,
    });
    expect(row).not.toBeNull();
    if (row === null) return;

    expect(await insertRoute(sql, row)).toBe(1);
    expect(await insertRoute(sql, row)).toBe(0); // idempotent

    const [sr] = await sql<{ name: string; polyline: string; distance_m: number }[]>`
      SELECT name, polyline, distance_m FROM saved_routes WHERE id = ${row.id}`;
    expect(sr?.name).toBe("Best match");
    expect(sr?.polyline).toBe(JSON.stringify(coords));
    expect(sr?.distance_m).toBe(2800);
  }, 60_000);
});
