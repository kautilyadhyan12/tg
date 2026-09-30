// Filling the name key of records written before 0056 (ROADMAP 5b-iv-a): run once per
// database by `tools/member-name-keys.ts`. Safe to run again, and beside a live api.
import * as repo from "./repo.js";
import { nameKey } from "./samePerson.js";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

/** How many records it gave a key; `gymIds` narrows it to those gyms. */
export async function fillNameKeys(sql: repo.SqlOrTx, gymIds: readonly string[] | null = null): Promise<number> {
  let filled = 0;
  let after = EMPTY_UUID;
  for (;;) {
    const rows = await repo.entriesWithoutNameKey(sql, { after, limit: 1000, gymIds });
    const last = rows[rows.length - 1];
    if (last === undefined) return filled;
    after = last.id;
    filled += await repo.writeNameKeys(sql, rows.map((row) => ({ ...row, nameKey: nameKey(row.fullName) })));
  }
}
