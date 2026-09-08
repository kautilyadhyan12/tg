# HANDOFF — the last thing each chat did (newest first, ten lines each)

Format: date · what was built or decided · what is verified (commands run) · what is open. Older
entries move to `archive/records/` when this file passes forty entries. The record before
2026-09-07 is `archive/records/HANDOFF-2026-07-06-to-2026-09-07.md`.

## 2026-09-08 · Words by type everywhere else (Stage 1 item 2b), branch `words-by-type`

- Built: one word table in `@app/shared` (`orgWords.ts`) read by the API and by every screen —
  a gym has members and a Trainer, a studio and a personal trainer have clients and a Coach.
  A personal trainer's org has TWO nouns: their console says "business", their clients read
  "trainer". About sixty sentences now follow it: the console shell (Studio console · Clients),
  Overview, roster, Settings, staff, codes, hours, attendance, the plan prompt, and the member's
  join door, My Gyms and attendance card.
- Server: the join refusals name the place in its own word ("Ask the studio for a current one");
  a code matching nothing says "any gym, studio or trainer"; the not-on-plan, archived, staff,
  cheer and nudge messages follow the type. "Gym not found." became "Organisation not found." —
  that 404 cannot know a type, and telling a stranger one would answer a question they were refused.
- Verified: shared + api tsc and eslint exit 0; engine 213 passed; shared 59 passed; web 1857
  passed (the pre-existing `poseAssets.contract.test.js` encoding failure is red on clean master
  too — checked by stashing); api `orgs.routes` + `orgs.hours` + `orgs.attendance` 227 passed and
  `orgs.cheers` + `orgs.nudges` green. The full api run showed 3 failures in `catalog.seed`, which
  pass alone: the shared-database flake ROADMAP item 10 already carries (`zz_p22_hidden` is
  `exercises.routes`'s fixture).
- New tests: `packages/shared/test/orgWords.test.ts`, `apps/web/src/pages/console/orgWords.render.test.jsx`
  (a studio and a trainer console, each with the gym asserted beside it as the control), plus
  cases in the My Gyms, join-door, consoleView and staffView suites and two api route tests.
- Judgement calls for Kd: the console has no "Workouts" label to swap for "Sessions" — its tiles
  count VISITS by his own ruling, and the only "workout" words mean the member's own history, so
  that third of §2.2's vocabulary row has no site today. A member in a gym AND a studio sees the
  neutral "My organisations", because no type's word is true of that list.
- Kd clicked through on 2026-09-08 and passed it, skipping the steps whose ground was
  already covered by item 2a's smoke. PR #55, CI green on all five jobs.
- Review round 1 (fresh chat): six Lows, zero High, security pass clean. All six fixed — the
  console front door now says Coach; the member's archived refusal uses the member's word;
  the seat-cap and trainer-scope refusals follow the type; the attendance switch names what
  the member's app calls the place; `privilegeCopy` re-indented. The reviewer's seven test
  gaps are closed: every new `orgType` parameter now has a literal-string observer at a
  studio (unit suites), plus My Gyms rendered at a studio with scheduled hours and the
  membership card's three rows at a studio. Web 1876 passed; api orgs suites 267 passed.
- Open: the reviewer's re-check of the fixes, then merge. Next: roadmap Stage 1 item 3a.

## 2026-09-08 · Organisation types (Stage 1 item 2a), merged as PR #53

- Built: `personal_trainer` joins `gym` and `studio` as a creatable type; migration `0024` widens
  `gyms_org_type_check` (clinic stays readable). The create screen is "Create your organisation"
  with three type cards and words that follow the type (a gym has members; a studio and a trainer
  have clients); `/console` sends a person who runs nothing straight to `/console/new`; a personal
  trainer's assistant (staff role `trainer`) gets the client list; a studio's trainer is told so in
  the studio's word; the migration test asserts the deployed CHECK equals `orgTypeSchema`.
- Verified: shared + api tsc, api eslint exit 0; `orgs.routes` + `db.migration` on local Postgres
  169 passed; web 1836 passed (pre-existing `poseAssets.contract.test.js` encoding failure remains).
- Kd clicked through all nine steps: passed. He ruled on trial abuse (RULINGS 2026-09-08); Stage 3
  item 2 split into 2a–2e. Review re-check found four Lows, fixed; CI green; merged, branch deleted.
  Next: roadmap Stage 1 item 2b (words by type on every other screen).

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
  eslint green; `auth.code.test.ts` 18 + unit 16 green on local Postgres; touched suites (users,
  orgs delete, auth, google, migration 0023) green; web 1824 green (`poseAssets.contract.test.js`
  fails on clean master too — pre-existing, local encoding); `tools/mutate-auth.mjs` 18 mutants, 17 RED + 1 alive by design
  (four survived the first sweep because a sibling check covered them; the tests were
  strengthened until each fell) — the table is in the PR.
- Review round 1 (Opus, fresh chat) found 4 High + 6 Low; all fixed in the second commit on the
  branch: too-soon keeps the live code on screen · per-IP send ceiling cut to 20/h and ONE
  ceiling across everyone (`CODE_EMAILS_PER_DAY`, default 5000) · the Day-14 purge deletes the
  address from `sign_in_codes` · the undo email is sent and its page `/restore-account` exists ·
  a per-address lock closes the day-cap race · `EMAIL_FROM` shape-checked at boot. Mutants now 18.
- Re-check closed all ten and found two the fixes had introduced, both fixed in the third commit:
  the daily ceiling now counts emails sent, not requests (checked in the preHandler, stepped
  after the send resolves) · Resend says "New code sent." only when one was. Each fix has a test
  that was run red on the old code first; A16 re-run RED against its new anchor.
- Re-checks on 2026-09-08 (three more commits, zero High at any point): a used code still holds the
  sixty-second gap; a too-soon refusal claims only the wait, never that a code was sent or is still
  valid; the too-soon header gives way to a timeless line when the countdown ends, and its words are
  built once with the gap read from `SIGN_IN_CODE_RULES` in `@app/shared`. Each header claim is
  pinned by a test that was run red against the old behaviour. CI green on a2881e6.
- Kd delegated work sizing to the chat; Stage 1 items 3–7 split into lettered one-chat lines in
  `ROADMAP.md` (RULINGS 2026-09-08). The next chat starts at item 2, then 3a.
- Merged to `master` 2026-09-08 on Kd's word (PR #51, CI green, branch deleted). Next: Stage 1 item 2.

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
