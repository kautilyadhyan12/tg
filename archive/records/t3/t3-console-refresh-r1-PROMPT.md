# T3 — ROUND 1 on the console-refresh packet (paste this into a FRESH chat)

Attach: `t3-console-refresh-r1.diff` · `CLAUDE.md` · `DECISIONS-INDEX.md`
(and open `DECISIONS.md:16331`, the card's own entry, plus `:16095` / `:15927`,
which raised the ⚪ line this builds).

---

You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11 and the rulings named below. Output only: (1) violations as rule# ·
file:line · one-line fix; (2) a security pass — authn/authz/tenancy, input
parsing, idempotency, secrets/log leaks, SQL safety; (3) anything that would fail
the phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS :5348, amended by :5807). Critical/High = security, data loss, privacy,
money, a broken core flow, **or anything a user can SEE that is FALSE**. Low =
spelling, comments, naming, style. Justify a Critical/High tag by naming the
concrete failure. Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no
further round — but it is STILL FIXED and logged in `BACKLOG.md`; report it at
full severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix carries a test that fails without it (rule 3). If Criticals appear in the
SAME subsystem two rounds running, say so and STOP — that is Kd's redesign
trigger, not a cue for another patch.

## What this card does

The gym console asked the server "who am I here and what may I do?" once per
screen, on open, and never again — so an owner changing somebody's permissions
reached that person only after F5, and the same question was asked twice per page
(the shell for its nav, the screen for its controls). It is now ONE kept answer
(`apps/web/src/pages/console/consoleOrgs.js`) shared by every console screen, and
re-read when the window regains focus. No server change, no migration, no new
dependency; the hook keeps its four states, so no screen file was edited for it.

## Where to point the review

These are the places the author believes are load-bearing. Do not treat the list
as a boundary — findings outside it are the point of a fresh reader.

1. **Ownership on a shared front-desk browser.** The kept answer is stamped with
   `getUserId()` and a reader whose id differs gets the empty state. Is there any
   path where one account reads another's gyms or privileges? Note the
   alternative that was rejected: a reset call in `logout()` (:618 T3 F1's shape).
2. **The four store rules** (in the file's own header): a background re-read
   publishes no spinner · a background re-read that fails changes nothing · the
   stamp · a successful re-read replaces the answer whole, `notFound` included.
   Can any of them be broken by an ordinary edit without a test going red?
3. **The loop the card shipped and fixed.** `useConsoleOrg`/`useConsoleOrgs` must
   ask on mount only; re-arming on the store's status made a failed read retry
   for ever. Both hooks were fixed — is either still reachable, and is there a
   THIRD way in (a caller that ensures on every render, a status change that
   re-mounts)?
4. **R3.3 is untouched and must stay so.** Hiding is not the enforcement; the
   server decides every gym-scoped request. Does anything here read as the
   client deciding?
5. **The mutation rows.** `apps/web/tools/mutate-console.mjs` gains C43–C50 and
   re-anchors/re-targets C8. Are any of them RED for a reason other than the
   guarantee they name (:4718 F2)? Is the deliberately-unwritten generation-guard
   mutant the right call, or does the guard have an observable subject after all?
6. **The two events.** `focus` and `visibilitychange` are separate listeners with
   separate mutants. Is there a third way a browser says "you are back" that
   matters here, and is the listener lifecycle (attached with the first
   subscriber, removed with the last) leak-free?

## Gates already run (re-derive rather than believe)

- web **1144/1144 exit 0** (+16) · `vite build` exit 0 · eslint **0 at
  `--max-warnings=0`** on the six changed web files · `node --check` on the
  harness exit 0.
- The mutation sweep's figures are in the card's `HANDOFF.md` block and its
  DECISIONS entry; the run itself is quotable only as it is written there. **One
  mutant came back ALIVE (C48) and was re-aimed** — check that re-aim rather than
  take it.
- **The browser SMOKE PASSED 4/4** (Kd, on `e8a7e5c`, DECISIONS :16495) — and
  the diff includes that record, so its claims are yours to audit too. **Two
  guarantees it does NOT cover are named in the entry** (a failed background
  re-check; the shared-browser stamp, which that sheet cannot exercise as
  written); check whether anything else is claimed there that the run did not
  establish. **This is the LAST gate: a clean round ticks the `OWED.md` line.**
