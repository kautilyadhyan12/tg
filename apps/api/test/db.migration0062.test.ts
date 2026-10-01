// MIGRATION 0062's DELETE, read out of the shipped file and run on fixture rows (ROADMAP
// 4a-ii round one). It runs on TEMPORARY tables of the four it reads, which shadow the real
// ones for this connection only (Postgres looks in the session's own schema first), so it
// never touches or locks a live row; everything is rolled back. One case each: what the
// old rule refused goes, everything it let in stays.
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

class Rollback extends Error {}

d("migration 0062 (staff rows the old rule refused)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 1 });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("deletes the ghost and a deleted account's row; keeps owners, live members, staff never members, and people who left before", async () => {
    const migration = await readFile(new URL("../drizzle/0062_staff_ghost_rows.sql", import.meta.url), "utf8");
    if (!/^DELETE FROM gym_staff s/m.test(migration)) throw new Error("0062 no longer holds its DELETE");
    let kept: string[] = [];
    await sql
      .begin(async (tx) => {
        await tx`CREATE TEMP TABLE users (id uuid PRIMARY KEY, status text NOT NULL) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gyms (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_staff (gym_id uuid, user_id uuid, created_at timestamptz NOT NULL, label text) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_members (gym_id uuid, user_id uuid, removed_at timestamptz) ON COMMIT DROP`;
        const id = async (): Promise<string> => (await tx<{ id: string }[]>`SELECT gen_random_uuid()::text AS id`)[0]?.id ?? "";
        const gym = await id();
        const otherGym = await id();
        const owner = await id();
        await tx`INSERT INTO gyms (id, owner_user_id) VALUES (${gym}, ${owner})`;
        const person = async (label: string, status: string, staffAt: string, memberships: (string | null)[], at = gym): Promise<string> => {
          const user = label === "owner, place closed" ? owner : await id();
          await tx`INSERT INTO users (id, status) VALUES (${user}, ${status}) ON CONFLICT (id) DO NOTHING`;
          await tx`INSERT INTO gym_staff (gym_id, user_id, created_at, label) VALUES (${at}, ${user}, ${staffAt}::timestamptz, ${label})`;
          for (const removed of memberships) {
            await tx`INSERT INTO gym_members (gym_id, user_id, removed_at) VALUES (${at}, ${user}, ${removed}::timestamptz)`;
          }
          return user;
        };
        // What the old rule refused: a membership closed after the staff row.
        await person("ghost", "active", "2026-08-01", ["2026-08-10"]);
        // An account inside its deletion window.
        await person("deleted trainer", "deleted", "2026-08-01", []);
        // Everything the old rule let in.
        await person("owner, place closed", "active", "2026-08-01", ["2026-08-10"]);
        await person("live member", "active", "2026-08-01", [null]);
        await person("never a member", "active", "2026-08-01", []);
        await person("left before staff", "active", "2026-08-10", ["2026-08-01"]);
        await person("left, then rejoined", "active", "2026-08-01", ["2026-08-10", null]);
        // A deleted account that owns a gym keeps that gym.
        const deletedOwner = await id();
        await tx`INSERT INTO users (id, status) VALUES (${deletedOwner}, 'deleted')`;
        await tx`INSERT INTO gyms (id, owner_user_id) VALUES (${otherGym}, ${deletedOwner})`;
        await tx`INSERT INTO gym_staff (gym_id, user_id, created_at, label) VALUES (${otherGym}, ${deletedOwner}, '2026-08-01', 'deleted owner, own gym')`;

        await tx.unsafe(migration);
        kept = (await tx<{ label: string }[]>`SELECT label FROM gym_staff ORDER BY label`).map((row) => row.label);
        // Twice is the same as once.
        await tx.unsafe(migration);
        expect((await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_staff`)[0]?.n).toBe(kept.length);
        throw new Rollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof Rollback)) throw err;
      });
    expect(kept).toEqual(
      ["deleted owner, own gym", "left before staff", "left, then rejoined", "live member", "never a member", "owner, place closed"].sort(),
    );
  });
});
