// MIGRATION 0247 (ROADMAP Stage 5 37o, the running faults' E1), read out of the shipped file and run on fixture rows.
// It runs on TEMPORARY tables, which shadow the real ones for this connection only, so it never touches or locks a
// live row; everything is rolled back. Each run takes its own person's zone, only one Postgres knows.
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

class Rollback extends Error {}

d("migration 0247 (a run keeps the time zone it was run in)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 1 });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("gives each older run its own person's zone; none for a person with none or with a name Postgres does not know", async () => {
    const migration = await readFile(new URL("../drizzle/0247_run_time_zone.sql", import.meta.url), "utf8");
    if (!/^UPDATE "runs" SET "time_zone"/m.test(migration)) throw new Error("0247 no longer holds its UPDATE");
    let zones: Record<string, string | null> = {};
    await sql
      .begin(async (tx) => {
        await tx`CREATE TEMP TABLE users (id uuid PRIMARY KEY, timezone text) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE runs (id uuid PRIMARY KEY, user_id uuid NOT NULL, label text NOT NULL) ON COMMIT DROP`;
        const person = async (timezone: string | null, ...labels: string[]) => {
          const [u] = await tx<{ id: string }[]>`INSERT INTO users (id, timezone) VALUES (gen_random_uuid(), ${timezone}) RETURNING id::text`;
          for (const label of labels) await tx`INSERT INTO runs (id, user_id, label) VALUES (gen_random_uuid(), ${u?.id ?? ""}, ${label})`;
        };
        await person("Europe/London", "London 1", "London 2");
        await person("Asia/Kolkata", "Kolkata");
        await person(null, "no zone");
        await person("Mars/Olympus_Mons", "unknown zone");
        await person("", "empty zone");
        await tx.unsafe(migration);
        zones = Object.fromEntries((await tx<{ label: string; time_zone: string | null }[]>`SELECT label, time_zone FROM runs`).map((r) => [r.label, r.time_zone]));
        throw new Rollback();
      })
      .catch((err: unknown) => {
        if (!(err instanceof Rollback)) throw err;
      });
    expect(zones).toEqual({ "London 1": "Europe/London", "London 2": "Europe/London", Kolkata: "Asia/Kolkata", "no zone": null, "unknown zone": null, "empty zone": null });
  });
});
