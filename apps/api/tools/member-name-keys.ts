// Fill `gym_member_list_entries.name_key` for records written before it existed (ROADMAP
// 5b-iv-a; migration 0056): possible duplicates find the same name by it. The api writes
// it with every name from then on; this is run once per database that already holds
// member lists. Safe to run again: it fills only the empty ones, a thousand at a time, and
// never over a key the api wrote meanwhile (`nameKeys.ts`). The deploy step is
// `RUNBOOK/fill-member-name-keys.md`.
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg corepack pnpm --filter api exec tsx tools/member-name-keys.ts
import postgres from "postgres";
import { fillNameKeys } from "../src/modules/orgs/memberList/nameKeys.js";

const url = process.env["DATABASE_URL"] ?? "";
if (url === "") throw new Error("DATABASE_URL is required");

const sql = postgres(url, { prepare: false, max: 2 });
try {
  console.log(`Member records given their name key: ${String(await fillNameKeys(sql))}`);
} finally {
  await sql.end({ timeout: 5 });
}
