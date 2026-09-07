# PASTE THIS INTO A **NEW** CLAUDE CHAT

*(Written 2026-09-07 for Kd. This file is a note to yourself, not part of the
project. Delete it whenever you like — nothing depends on it.)*

**Where things stand:** the "slipping away" server half is built, committed and
pushed, and CI is green. The next step is an independent review in a **fresh
chat** — a different chat has to review it, because the one that wrote the code
would defend its own reasoning instead of checking it.

**What to do:** open a new Claude chat in this project and paste everything
between the lines below.

---

```
You are reviewing, not fixing. Audit the diff of commits cf394fa and b1a3243 on
branch web-repoint strictly against CLAUDE.md Part II R0–R11 and
CARD-gym-overview-people.md §§S2.1–S2.7 (the "slipping away" slice-2 card).

Output only: (1) violations as rule# · file:line · one-line fix; (2) a security
pass — authn/authz/tenancy, input parsing, idempotency, secrets/log leaks, SQL
safety; (3) anything that would fail the phase's Done gate. No praise, no
restating the diff.

TAG EVERY FINDING Critical/High or Low (CLAUDE.md Part I §2.5, DECISIONS :5348).
Critical/High = security, data loss, privacy, money, a broken core flow, or
anything a user could SEE that is FALSE (:5807). Low = spelling, comments,
naming, style. Justify a Critical/High tag by naming the concrete failure.
Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no further round — but
it is STILL FIXED and logged in BACKLOG.md; report it at full severity.

Watch these four in particular, each with its record:
 · THE FOUR WINDOWS ARE FOUR DIFFERENT NUMBERS — quiet 3 gym-days (Kd :36816),
   membership floor 14, engagement 30, and the nudge cap 7 days ROLLING (Part 3
   §4.1). Folding any two reverses a ruling or breaks a spec limit (:35762).
 · MIGRATION 0021's "no UNIQUE can express this cap" reasoning is DEAD for the
   cheer and TRUE for the nudge — check the docblocks do not contradict.
 · THE TRAILING MARKERS in repo.ts (`-- the nudge's own, O289`, `// the nudge's
   own, O296`) are load-bearing mutation anchors, not litter (:15770, :27204 §6).
 · gym_nudges must not be readable by anything that reads gym_cheers, and vice
   versa (0022 §1 — three measured breakages).

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix would carry a test that fails without it (rule 3). If Criticals appear in the
SAME subsystem two rounds running, say so and STOP — that is Kd's redesign
trigger, not a cue for another patch.
```

---

## If you would rather not start the review yet

Paste this into a new chat instead, and it will pick up where this one left off:

```
Read HANDOFF.md's TOP BLOCK and follow CLAUDE.md Part I.6 before any
substantive output. The "slipping away" server half is built (commit cf394fa,
DECISIONS :36907) and CI is green. T3 has NOT been run.
```

## Two things I owe you an answer on, whenever you want it

1. **Three days may be too tight.** Someone who trains twice a week — Tuesday and
   Saturday, say — has a three-day gap every single week, so they will sit on the
   "slipping away" list permanently. Someone training three times a week never
   will. It is one number to change if you want four or five instead.
2. **Nothing is on screen yet.** This was the server half. The screen, and a
   click-through test for you, come after the review.
