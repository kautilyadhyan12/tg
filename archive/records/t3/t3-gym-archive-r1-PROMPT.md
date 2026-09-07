# T3 ROUND 1 — the four-month gym closure (server + tools)

Paste everything below into a **FRESH chat**, with `t3-gym-archive-r1.diff`
attached. Do not run this in the chat that wrote the code (CLAUDE.md Part I §7c).

---

You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11 and Part 3 §4.2. Output only: (1) violations as rule# · file:line ·
one-line fix; (2) a security pass — authn/authz/tenancy, input parsing,
idempotency, secrets/log leaks, SQL safety; (3) anything that would fail the
phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5, DECISIONS
:5348). Critical/High = security, data loss, privacy, money, a broken core flow,
**or anything a user could SEE that is FALSE** (:5807 rule 1a). Low = spelling,
comments, naming, style. Justify a Critical/High tag by naming the concrete
failure. Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no further
round — but it is STILL FIXED and logged in `BACKLOG.md`; report it at full
severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix would carry a test that fails without it (rule 3). If Criticals appear in the
SAME subsystem two rounds running, say so and STOP — that is Kd's redesign
trigger.

## What this card is

Kd ruled on 2026-08-31 that a gym with no live plan is **archived four months**
after its plan ended, replacing Part 3 §4.2's *"read-only 14 days, then
archived"*. The full record is `DECISIONS.md:25771`; read it and `:22215 §5/§6`,
`:22341`, `:23711` and `:25092 §4/§6` before judging design choices — several of
them are answers to earlier rulings rather than fresh judgement.

Commit under review: **`be03891`** on `web-repoint`. The diff is code + the smoke
sheet only; the record files are excluded deliberately.

## Where to look hardest

1. **`archiveSweep.ts`'s WHERE.** Three conditions carry the guarantee: the live
   plan check, `max(ended_at)` (not `EXISTS`), and `archived_at IS NULL`. **Is
   each one actually load-bearing, and is each one CORRECT in BOTH directions?**
   A closure that fires too widely closes a paying customer; one that never fires
   is invisible to any test that only checks something stayed open.
2. **The clock's anchor.** `subscriptions.ended_at` is new (`0016`), nullable and
   deliberately not backfilled. **Is there any path where a NULL is read as an
   old date, or where the stamp disagrees with the instant the run decided on?**
   The trial sweep writes it from the injected clock, not `now()`.
3. **The restore.** `repo.restoreGym` leaves `archived_at` SET on purpose. Attack
   that decision: is there a state where the column being set is wrong, or where
   a gym can end up un-closeable that should be closeable?
4. **The write gate's new second refusal** (`service.ts`) is placed AFTER the
   plan check on purpose, so it is unreachable today. Check the ordering
   argument, and check that the information boundary (:23711 §2(a)) still holds —
   a signed-in stranger must not learn a gym's plan or status from a 409.
5. **The two tools.** `--now` blast radius, the production refusal, the
   year guard, exit codes, and whether `gym-restore.ts` can be pointed at the
   wrong gym by a slug collision.
6. **The smoke sheet** (`RUNBOOK/smoke-gym-archive.md`): would every ✅ be
   satisfied by a BROKEN app? Steps 5 and 8 are a deliberate pair; say if the
   pair is weaker than claimed. Every command in it was run once while it was
   written — verify that claim if you can.

## Three things the writing chat already reports against itself

Do not re-find these; DO check the fixes are right.

- **THE SMOKE HAS SINCE BEEN RUN AND ITS STEP 6 IS STRUCK — the sheet in this
  diff is the PRE-RUN version, and its step 6 is wrong in two ways.** It asks the
  OWNER to inspect the read-only console, and an owner of a gym with no plan
  cannot reach it: `planPromptFor` gives them the unskippable subscribe modal
  (:22215, :22697), a fact already recorded at :24893 §5 and :25326 §4 and not
  applied when the sheet was written. Worse, no web file reads `org.status`
  (:25771 §6), so that step's ✅ is satisfied identically whether or not the gym
  was ever archived — it has no observable subject (:25326 §1's shape). Steps
  1–5 and 7–9 passed. The run is recorded at `DECISIONS.md:26012`, and the
  corrected sheet — the strike, a self-describing ✅ on step 4, the block-and-
  handshake shape at the top — is in the working tree and NOT in this diff.
  **Judge the OTHER eight steps, and say if any of them has the same defect; the
  sheet's own claim that steps 5 and 8 are a pair is the thing to attack
  hardest.**

- **A third full-suite run exited 1 and its failure is unknown**, because the run
  was piped through `tail -6`. The two runs either side passed 676/676. The flake
  hypothesis is recorded AS a hypothesis at `:25771`.
- **`writesRows` on mutant O173** is declared and the detector reported it moved
  no PRE-EXISTING row. Both are true; the reasoning is in the row's comment.
  Judge whether that reasoning holds.

## Known and out of scope

`drizzle-kit generate` is unusable in this repo (snapshots stop at `0012`), which
is why `0016` is hand-written like `0013`–`0015`. It has its own new `OWED.md`
line; it is not this card's to fix.
