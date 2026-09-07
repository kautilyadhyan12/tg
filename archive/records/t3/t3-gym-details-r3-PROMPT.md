# T3 ROUND 3 (DIFF-ONLY) — gym details, round 2's fix round

Paste everything below into a FRESH chat. Not the chat that wrote the fixes, and
not a chat that ran round 1 or round 2.

---

Read CLAUDE.md fully — its rules are binding, including the session-start
protocol (Part I.6) and the grounding rule.

You are reviewing, not fixing. Ground yourself first: `git log --oneline -3`,
`git status --short`, the TOP block of HANDOFF.md, DECISIONS-INDEX.md in full,
and §1/§2 of DECISIONS.md.

**THIS IS A DIFF-ONLY RE-REVIEW (CLAUDE.md Part I §2.5 rule 2). Cover ONLY the
fixes and the surfaces they touch — no fresh full pass.** Round 2's findings are
at `DECISIONS.md:19799`, round 1's at `:19656`, and the Lows of both are in
`BACKLOG.md`. The fix commit is the most recent on `web-repoint`.

Output only: (1) violations as rule# · file:line · one-line fix; (2) a security
pass on what changed; (3) anything that would fail the phase's Done gate. No
praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (Part I §2.5, DECISIONS :5348,
amended :5807). Zero Critical/High ⇒ the packet SHIPS. A Low buys no further
round but is STILL FIXED and logged in `BACKLOG.md`.

**Report in FULL TECHNICAL DETAIL** — files, lines, quoted code, commands and
their output, complete mechanism for each finding. Do not compress for a
non-technical reader; findings are evidence, and translating them is a separate
job downstream.

## The escape hatch may be live this round — read this before tagging

Round 1: three Critical/High, all in `modules/orgs`.
Round 2: one Critical/High, in `tools/mutate-orgs.mjs`.

:13336 judges the subsystem at FILE granularity, which is why round 2 did not
arm the hatch. **If this round finds a Critical/High in `tools/mutate-orgs.mjs`,
that is two consecutive rounds in the same subsystem and the hatch IS armed** —
say so and STOP. That is Kd's redesign call, not yours and not the author's.

## What this round exists to check

1. **Did any fix create a new defect?** Round 2's Critical was itself in a guard
   written to close round 1's, so ask this hard (:6277).
2. **The widened remote refusal.** It now fires for every target. Can any path
   reach the mutation loop against a non-local database? Is `isLocalHost` still
   correct for the hosts it must accept and reject (its self-check table is in
   the file)?
3. **The gym-row fingerprint guard.** Its first version could not fire at all.
   Can this one? Specifically: does the `node -e` probe work from a clean shell,
   does a probe failure still report "detection is OFF" rather than passing, and
   is the before/after comparison right about rows the suite legitimately
   creates and deletes?
4. **The stated limitation.** The author records that the guard cannot re-alarm
   on an already-uniform table, and that the local `gyms` table IS currently
   uniform. Verify both claims. Is the limitation stated where a reader of the
   green line would see it?
5. **Low-2's replacement assertion.** It asserts the PROMISE (must mention
   currency; must not claim a fixed country or a paid plan) rather than the exact
   string. Does it fail for the right reason under a reverted sentence, and can
   it be satisfied by wording that is still false?
6. **Low-4's actual fix.** Round 2 found a Low recorded as fixed in four
   documents and never fixed. Verify THIS round's version was actually written —
   `git show <commit> -- OWED.md` — rather than claimed again.
7. **Rule 4 on what changed:** mutate the assertions added this round and confirm
   they go RED (:12731 — a test written to close a finding is not audited by the
   review that asked for it).

## Commands

```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
pnpm --filter api test:local test/orgs.routes.test.ts test/db.migration.test.ts
pnpm --filter @app/shared test
DATABASE_URL="postgres://aihg:aihg@localhost:5433/aihg" \
  MUTATE_ONLY=O15,O20,O114,O115,O116,O117,O118,O119,O120,O121,O122,O123,O124,O125,O126 \
  node apps/api/tools/mutate-orgs.mjs
```

**BE CAREFUL WITH O114 — it is the round-2 Critical's subject.** It rewrites
every gym row in whatever database it runs against, by design. The harness now
refuses any non-local database; do not use the opt-in to override that.

Claimed on the final bytes: `orgs.routes` 119/119, `db.migration` 10/10, both
together 129/129, shared 51/51, tsc exit 0, eslint clean, `node --check` clean,
sweep 15 RED / 0 ALIVE / 0 never ran (a stated SUBSET of 126).

**The full api suite is NOT quoted green** — pre-existing flake with its own OWED
line (:13746). Treat a failure in `catalog.seed` or `db.migration`'s global
counts as that flake and say so rather than scoring it.
