// Fill `gym_member_list_entries.name_key` for records written before it existed (ROADMAP
// 5b-iv-a; migration 0055): possible duplicates find the same name by it. The api writes
// it with every name from then on; this is run once per database that already holds
// member lists. Safe to run again: it fills only the empty ones, a thousand at a time, and
// never over a key the api wrote meanwhile. The deploy step is
// `RUNBOOK/fill-member-name-keys.md`.
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg corepack pnpm --filter api exec tsx tools/member-name-keys.ts
import postgres from "postgres";
import { nameKey } from "../src/modules/orgs/memberList/samePerson.js";

const url = process.env["DATABASE_URL"] ?? "";
if (url === "") throw new Error("DATABASE_URL is required");

const sql = postgres(url, { prepare: false, max: 2 });
try {
  let filled = 0;
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows = await sql<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM gym_member_list_entries
      WHERE name_key IS NULL AND id > ${after}::uuid
      ORDER BY id
      LIMIT 1000`;
    const last = rows[rows.length - 1];
    if (last === undefined) break;
    after = last.id;
    const written = await sql`
      UPDATE gym_member_list_entries e SET name_key = v.name_key
      FROM unnest(${rows.map((row) => row.id)}::uuid[], ${rows.map((row) => row.full_name)}::text[], ${rows.map((row) => nameKey(row.full_name))}::text[])
        AS v(id, full_name, name_key)
      WHERE e.id = v.id AND e.name_key IS NULL AND e.full_name = v.full_name`;
    filled += written.count;
  }
  console.log(`Member records given their name key: ${String(filled)}`);
} finally {
  await sql.end({ timeout: 5 });
}
