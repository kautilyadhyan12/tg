# HANDOFF — the last thing each chat did (newest first, ten lines each)

Format: date · what was built or decided · what is verified (commands run) · what is open. Older
entries move to `archive/records/` when this file passes forty entries. The record before
2026-09-07 is `archive/records/HANDOFF-2026-07-06-to-2026-09-07.md`.

## 2026-09-07 · Sign-in by email code (Stage 1 item 1), branch `sign-in-by-email-code`

- Built: `POST /v1/auth/code/send` and `/verify` (codes HMAC-stored in new table `sign_in_codes`,
  migration 0023; ten-minute life, one resend after 60 s, two a day per address, five guesses,
  single use, address is the tenant); Resend transport with no SDK (`src/email/`); the dev sender
  prints the code in the API log when `RESEND_API_KEY` is unset; production refuses to boot without it.
- Web: one "Get started" screen at `/login` (doors "Train" / "Manage my gym, studio or clients",
  email → code → landing); `/register` and `/forgot-password` fold into it; Settings loses the
  password card and deletes the account with an emailed code (`POST /v1/users/me/delete-code`,
  then `DELETE /v1/users/me {code}`). Password routes stay on the server, switched off on screen.
- Kd amended his ruling mid-plan (RULINGS 2026-09-07): no password at all; one resend; two codes a day.
- Verified per package (the root `turbo` scripts cannot run on Kd's machine: turbo calls a global
  pnpm 11 that refuses the 9.15.4 pin — CI uses the pinned one): api/shared/config/engine tsc +
  eslint green; `auth.code.test.ts` 13 + unit 11 green on local Postgres; touched suites (users,
  orgs delete, auth, google, migration 0023) green; web 1824 green (`poseAssets.contract.test.js`
  fails on clean master too — pre-existing, local encoding); `tools/mutate-auth.mjs` 14 mutants, 14 RED
  (four survived the first sweep because a sibling check covered them; the tests were
  strengthened until each fell) — the table is in the PR.
- Open: fresh-chat review; Kd's click-through; then merge. The deletion undo page is owed (ROADMAP 1.8).

## 2026-09-07 · The reset (Fable 5.1, this session)

- Kd ruled the project too slow and the record files "a novel"; gave the chat authority to
  restructure; features are never deleted. Decisions from the session are in `RULINGS.md`
  (bottom of each section, dated 2026-09-07) and the plan is `ROADMAP.md` Stage 1.
- Moved to `archive/`: the six record files, the card and plan files, review prompts, the 35
  smoke sheets, the three record-checking scripts, the old backends and the old root compose
  and env files. Git history is intact (renames). Nothing deleted.
- Rewrote `CLAUDE.md` (the rules), created `RULINGS.md`, `ROADMAP.md`, this file; root `lint`
  no longer runs the record-file guards.
- `master` now holds everything (fast-forwarded from `web-repoint`, CI green on the PR run);
  49 remote and 37 local merged branches deleted; `web-repoint` retired. Only `master` and
  the stale local `workout-calendar-parked` remain (its work was redone on the main line).
- Open: Stage 1 item 1 (sign-in by email code) starts in a fresh chat, on a new branch off
  `master`, with a ten-line plan to Kd first. Kd wants Fable at high effort for it.
- Not touched this session: any `src` file, any test, any migration, the database, the dev servers.
