// P0.3 migration/seed proof (runs against a real Postgres — Neon branch).
// Requires DATABASE_URL pointing at a database that has had `pnpm --filter api
// migrate` applied. Skips visibly when unset so unit CI stays green; the
// migration CI job / local Neon-branch run is where this executes.
import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { seed } from "../src/db/seed.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

d("0001_init on a real database", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });

  it("created every Part 4 §2 table", async () => {
    const expected = [
      "users", "auth_identities", "refresh_tokens",
      "gyms", "gym_codes", "gym_members", "gym_staff",
      "plans", "subscriptions", "invoices", "webhook_events",
      "exercises", "exercise_definitions", "definition_bundles",
      "workouts", "workout_sets", "workout_templates",
      "meal_logs", "user_dishware", "meal_log_corrections", "body_measurements",
      "coach_threads", "coach_messages", "kb_chunks",
      "streaks", "achievements", "user_achievements", "challenges",
      "challenge_participants", "leaderboard_snapshots",
      "runs", "saved_routes", "run_schedules", "geo_cache",
      "usage_daily", "api_cost_events",
      "org_daily_stats", "gym_usage_reports",
      "push_tokens", "feature_flags", "audit_log", "trace_samples",
    ];
    const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    const present = new Set(rows.map((r) => r["tablename"] as string));
    for (const t of expected) {
      expect(present.has(t), `missing table: ${t}`).toBe(true);
    }
    const views = await sql`SELECT viewname FROM pg_views WHERE schemaname = 'public'`;
    expect(views.map((v) => v["viewname"] as string)).toContain("org_member_stats");
  });

  // 120s: two full seed passes = many sequential round-trips over a WAN
  // pooler; 30s flaked once under load (P2.5a PROVE) — headroom, not a bug.
  it("seed is idempotent and matches the Part 5 §1 price book", { timeout: 120_000 }, async () => {
    await seed(url ?? "");
    const first = await sql`SELECT count(*)::int AS n FROM plans`;
    await seed(url ?? "");
    const second = await sql`SELECT count(*)::int AS n FROM plans`;
    expect(second[0]?.["n"]).toBe(first[0]?.["n"]);

    const book = await sql`
      SELECT code, price_minor, currency, "interval", seat_cap, rank
      FROM plans ORDER BY code`;
    const byCode = new Map(book.map((r) => [r["code"] as string, r]));
    const expectPrice = (code: string, minor: number, cur: string): void => {
      const row = byCode.get(code);
      expect(row, `missing plan ${code}`).toBeDefined();
      expect(row?.["price_minor"]).toBe(minor);
      expect(row?.["currency"]).toBe(cur);
    };
    expectPrice("free", 0, "INR");
    expectPrice("pro_in_m", 14900, "INR");
    expectPrice("pro_in_y", 99900, "INR");
    expectPrice("pro_us_m", 399, "USD");
    expectPrice("pro_us_y", 2999, "USD");
    expectPrice("org_micro", 99900, "INR");
    expectPrice("org_micro_clinic", 149900, "INR");
    expectPrice("org_starter", 149900, "INR");
    expectPrice("org_standard", 199900, "INR");
    expectPrice("org_growth", 349900, "INR");
    expectPrice("org_scale", 499900, "INR");
    expect(byCode.get("free")?.["rank"]).toBe(0);
    expect(byCode.get("pro_in_m")?.["rank"]).toBe(10);
  });

  it("subs_one_live_uq rejects a second live subscription (23505)", async () => {
    const [user] = await sql`
      INSERT INTO users (display_name) VALUES ('uq-test') RETURNING id`;
    const [plan] = await sql`SELECT id FROM plans WHERE code = 'pro_in_m'`;
    const userId = user?.["id"] as string;
    const planId = plan?.["id"] as string;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('user', ${userId}, ${planId}, 'active', 'razorpay')`;
    let code = "";
    try {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('user', ${userId}, ${planId}, 'trialing', 'razorpay')`;
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    }
    expect(code).toBe("23505");
    // A non-live (canceled) row for the same owner is allowed — history stacks.
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('user', ${userId}, ${planId}, 'canceled', 'razorpay')`;
  });

  it("gym_members_live_uq blocks duplicate live membership but allows rejoin", async () => {
    const [owner] = await sql`INSERT INTO users (display_name) VALUES ('owner') RETURNING id`;
    const [member] = await sql`INSERT INTO users (display_name) VALUES ('member') RETURNING id`;
    const ownerId = owner?.["id"] as string;
    const memberId = member?.["id"] as string;
    const [gym] = await sql`
      INSERT INTO gyms (slug, name, owner_user_id)
      VALUES (${`uq-gym-${Date.now().toString()}`}, 'UQ Gym', ${ownerId}) RETURNING id`;
    const gymId = gym?.["id"] as string;
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${memberId})`;
    let code = "";
    try {
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${memberId})`;
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    }
    expect(code).toBe("23505");
    // Leave, then rejoin: history rows stack (Part 4 §3.2).
    await sql`
      UPDATE gym_members SET removed_at = now()
      WHERE gym_id = ${gymId} AND user_id = ${memberId} AND removed_at IS NULL`;
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gymId}, ${memberId})`;
    const rows = await sql`
      SELECT count(*)::int AS n FROM gym_members
      WHERE gym_id = ${gymId} AND user_id = ${memberId}`;
    expect(rows[0]?.["n"]).toBe(2);
  });
});
