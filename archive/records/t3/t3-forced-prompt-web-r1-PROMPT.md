# T3 ROUND 1 — the forced prompt's WEB half (the unskippable modal)

Paste everything below into a FRESH chat, and attach `t3-forced-prompt-web-r1.diff`
(commits `99687c5` and `3891acc` — the card and its record correction).

---

You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11 and the rulings named below. Output only: (1) violations as rule# ·
file:line · one-line fix; (2) a security pass — authn/authz/tenancy, input
parsing, idempotency, secrets/log leaks, SQL safety; (3) anything that would fail
the phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS :5348). Critical/High = security, data loss, privacy, money, a broken
core flow — **plus anything a user can SEE that is FALSE, or that blocks them
from finishing something they should be able to do** (:5807 rule 1a). Low =
spelling, comments, naming, style. Justify a Critical/High tag by naming the
concrete failure. Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no
further round — but it is STILL FIXED and logged in BACKLOG.md; report it at full
severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix would carry a test that fails without it (rule 3). If Criticals appear in the
SAME subsystem two rounds running, say so and STOP — that is Kd's redesign
trigger, not a cue for another patch.

## WHAT THIS CARD IS

The visible half of Kd's ruling that a gym without a live plan gets nothing
(DECISIONS :22215), as corrected at a screen: **it is a MODAL, not a button**
(:22697 §2). The server half landed the same day (:22921) and its T3 is closed
(:23128). This card's own entry is **DECISIONS :23257** — read it, plus :22215,
:22697, :22921 §1, :21580 (rule (c), and the trial screens it built), and :22029
(the console's keying rule).

Three pieces: the unskippable prompt with its two arms · the DELETION of the
Overview's pre-trial trial button (Kd ruled it, :22921 §1 ruling 2 — this is the
no-removal rule's authorised path, not a breach of it) · a rewritten
`RUNBOOK/smoke-trial-expiry.md`.

## THE CLAIMS THIS CARD MAKES — ATTACK THESE FIRST

1. **The prompt cannot be closed.** No X, no Escape handler, no click-outside, no
   dismissal state. All three are ABSENCES, so look for anything that could
   dismiss it — including something that unmounts the shell, a route change, or a
   parent re-render.
2. **It never draws on an unknown.** `ownerTrialUsed` null means "we could not
   ask" (a non-staff caller, or an api older than this bundle). Drawing on null
   seals a person out of their own console with no way past. Check every path
   into `planPromptFor`.
3. **It stops only whoever can pay** (`billing.manage`, Kd's ruling :22921 §1) —
   and hiding is never the enforcement (R3.3). Check that no entitlement, plan or
   price decision has moved to the client.
4. **It keys on STATUS, never on a date** (:21580 rule (c)) — so a gym past its
   trial end date but not yet swept keeps its console, and a paying gym is never
   locked out.
5. **A started trial survives a failed background re-read.** The answer is written
   into the shared store (`applyStartedTrial`), not held in the component, because
   the component unmounts when the owner walks out through "Your gyms". Check it
   cannot write another user's row, invent a subscription, or outlive a sign-out.
6. **The subscribe arm promises nothing it cannot do** — no payment exists, so it
   says we will be in touch, as a sentence rather than a button.
7. **An empty price book says something true** rather than the service refusing —
   the decision this card was told to make (:23128 Low-4, its own OWED line).
8. **A failed price read is never drawn as an empty price book.**
9. **The prompt covers the screen a gym is CREATED on** (`/console/new`'s success
   screen), which has no gym in its address — so `NewGym` draws its own copy,
   reading the new gym **from the shared store by id, never from the create
   response**. Check that path hard: it is the newest code in the card, it was
   written under smoke pressure, and it is the one place a second `PlanModal`
   is mounted.

## WHAT IS ALREADY KNOWN — do not re-report as new

- **Mutant C68 is ALIVE and it is NOT this card's.** `ConsoleSection` guards its
  open-on-failure rule twice (`|| forceOpen` and the `setOpen` latch); measured,
  each alone keeps the test green and both removed goes RED. Redundant pair,
  product correct, ⚪ OWED line, fix deliberately not taken (R1.1).
- The console is COVERED by the prompt but is not READ-ONLY — a separate owed
  item, not this card.
- The subscribe arm has nowhere to send anybody (Paddle unbuilt, admin tool
  unbuilt, contact channel owed). Kd was told before ruling.

## EVIDENCE ALREADY ON THE RECORD (challenge it, don't repeat it)

Web **1322/1322 across 49 files** · eslint `--max-warnings=0` clean on fourteen
files · `vite build` exit 0 · **WHOLE-TABLE mutation sweep of 121: 120 RED, 1
ALIVE (C68 above), 0 never ran**, controls GREEN first, restores sha256-verified ·
then a stated **SUBSET of 122 after the smoke fix — C12, C13, C51, C52, C93, C94,
C96–C102: 13 RED, 0 ALIVE**, chosen to cover every file that fix moved a line in.
The smoke sheet's API command was executed, not assumed.

**THE SMOKE PASSED 11/11 (Kd, 2026-08-28) — and it found a defect nothing else
had**, which is the part to read before reviewing: the prompt did not cover the
gym-created screen, so a new owner's first sight was their join code for a gym on
no plan. Fixed, pinned by three test cases and mutant C102, and written into the
sheet's step 1. **Everything was green when that defect shipped**, so treat "the
suite passes" as evidence about nothing in particular here.
