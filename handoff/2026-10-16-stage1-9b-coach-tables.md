# Handoff · 2026-10-16 · Stage 1 item 9b, the coach's old tables emptied (Folder B)

- **Why:** the chat coach was deleted on 2026-10-15 (Stage 1 item 9) with its old chats kept until a job emptied the tables; Kd ruled them deleted for good.
- **Built:** migration `0123_coach_tables_dropped` drops `coach_threads`, `coach_messages` and `kb_chunks`, takes the `coach` key off every plan's `entitlements` and `member_entitlements`, and removes the `first_chat` badge and anybody's row of it. The data download and account removal no longer name the chat tables; the plans' `coach` limit is gone from the shared shape, the merge, the quota table and the seed; the badge is gone from the catalogue; the Mongo import tool lost its chat step and gate.
- **Verified:** `tsc` and `eslint` for `@app/shared` and `api`, both 0; 11 api test files, 204 tests, on `aihg_b` (the worst-thing test first: download and removal work and take nobody else's data, red before the change); the migration's plan and badge statements run in a rolled-back transaction on `aihg_b`: 12 plans holding `coach` became 0, the free plan's other limits unchanged, `first_workout` kept beside the removed `first_chat`.
- **Open:** nothing of this job. The pgvector extension stays installed, unused.
- **Next in Folder B:** nothing; the borrowed laptop goes back. What is left returns to Kd's own folders (ROADMAP Stage 2's header).

**The ROADMAP line as first written:** 9b. **The coach's old tables emptied** (Kd, 2026-10-15, `rulings/2026-10-15-stage1-9-coach-deleted.md`): a migration drops `coach_threads`, `coach_messages` and `kb_chunks`, and with them their lines in the data download and the account removal, the plans' unused coach limit, and the "first chat" badge nobody can earn. Before launch. **Ordinary.**
