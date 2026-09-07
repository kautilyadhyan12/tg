# HANDOFF — the last thing each chat did (newest first, ten lines each)

Format: date · what was built or decided · what is verified (commands run) · what is open. Older
entries move to `archive/records/` when this file passes forty entries. The record before
2026-09-07 is `archive/records/HANDOFF-2026-07-06-to-2026-09-07.md`.

## 2026-09-07 · The reset (Fable 5.1, this session)

- Kd ruled the project too slow and the record files "a novel"; gave the chat authority to
  restructure; features are never deleted. Decisions from the session are in `RULINGS.md`
  (bottom of each section, dated 2026-09-07) and the plan is `ROADMAP.md` Stage 1.
- Moved to `archive/`: the six record files, the card and plan files, review prompts, the 35
  smoke sheets, the three record-checking scripts, the old backends and the old root compose
  and env files. Git history is intact (renames). Nothing deleted.
- Rewrote `CLAUDE.md` (the rules), created `RULINGS.md`, `ROADMAP.md`, this file; root `lint`
  no longer runs the record-file guards.
- Open: merge `web-repoint` into `master` and delete merged branches (Stage 0 item 2), then
  Stage 1 item 1 (sign-in by email code) starts in a fresh chat with a ten-line plan to Kd.
- Not touched this session: any `src` file, any test, any migration, the database, the dev servers.
