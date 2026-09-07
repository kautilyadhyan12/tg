# T3 ROUND 2 (DIFF-ONLY) — gym details, the fix round

Paste everything below into a FRESH chat. Not the chat that wrote the fixes, and
not the chat that ran round 1.

---

Read CLAUDE.md fully — its rules are binding, including the session-start
protocol (Part I.6) and the grounding rule.

You are reviewing, not fixing. Ground yourself first: `git log --oneline -3`,
`git status --short`, the TOP block of HANDOFF.md, DECISIONS-INDEX.md in full,
and §1/§2 of DECISIONS.md.

**THIS IS A DIFF-ONLY RE-REVIEW (CLAUDE.md Part I §2.5 rule 2). Cover ONLY the
fixes and the surfaces they touch — no fresh full pass.** Round 1's findings and
their reasoning are at `DECISIONS.md:19656`; the three Low are in `BACKLOG.md`.
The fix commit is the most recent one on `web-repoint`.

Audit strictly against CLAUDE.md Part II R0–R11 and Part 3 §2.2 / §3.3.

Output only: (1) violations as rule# · file:line · one-line fix; (2) a security
pass on what changed — authz/tenancy, input parsing, SQL safety; (3) anything
that would fail the phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (Part I §2.5, DECISIONS :5348,
amended :5807). Critical/High = security, data loss, privacy, money, a broken
core flow, **or anything a user could see that is FALSE**. Zero Critical/High ⇒
the packet SHIPS. A Low finding buys no further round but is STILL FIXED and
logged in `BACKLOG.md` — report it at full severity, never soften it to duck a
round.

**Report your findings in FULL TECHNICAL DETAIL.** Name files and lines, quote
the code, show the commands you ran and their output, and explain each finding's
mechanism completely. Do not compress or simplify for a non-technical reader —
a previous round was asked to write in plain English and the detail that mattered
was squeezed out of it. Findings are evidence; the plain-English translation is
someone else's job, downstream of you.

## The questions this round exists to answer

1. **Did any fix create a new defect?** Round 1's C/H-1 was itself created by
   code written an hour earlier, so ask this one hard (:6277's shape — a fix
   aimed at one thing creating a Critical elsewhere).
2. **`movesMoney` in `repo.updateOrg`.** It compares the resolved
   `currencyDisplay` against the stored one. Is there any input where the money
   moves and this says it does not? Consider: a country that is not in the
   supported set, a country whose currency lookup fails, `country` present but
   `currencyDisplay` somehow absent, and a gym whose stored `currency_display`
   is itself wrong.
3. **Is the C/H-2 fix genuinely safe?** A pre-`0014` gym has `country` NULL and
   `currency_display` INR. It may now record `IN`. Can it record anything else
   that ends up INR, and would that matter? Can a gym reach a state where it
   records a country that does not match the currency it is billed in?
4. **The renamed outcome (`country_locked` → `currency_locked`).** Grep for any
   surviving reference to the old name in code, tests, harness rows or docs.
5. **O125 and O126.** Do they genuinely fail without their fixes, and does O126
   really encode the REJECTED one-liner rather than something adjacent to it?
6. **The C/H-3 correction.** The code comment now says the guard is incomplete
   and names the requirement on the billing card. Is the comment TRUE, and is
   the `OWED.md` line specific enough that the billing card cannot miss it?
7. **Rule 4 on what changed:** does any test added or modified in this round stay
   GREEN when the thing it claims to check is broken? Mutate the tests written
   this round, in this round (:12731 — a test written to close a finding is not
   audited by the review that asked for it).

## What was already verified (re-derive rather than trust)

Rule 3 was measured: both C/H fixes were watched RED against the restored
pre-fix source, which was then verified byte-identical by sha256. Confirm that
independently rather than taking it on this file's word.

## Commands

```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
pnpm --filter api test:local test/orgs.routes.test.ts test/db.migration.test.ts
pnpm --filter @app/shared test
DATABASE_URL="postgres://aihg:aihg@localhost:5433/aihg" \
  MUTATE_ONLY=O15,O20,O114,O115,O116,O117,O118,O119,O120,O121,O122,O123,O124,O125,O126 \
  node apps/api/tools/mutate-orgs.mjs
```

Results claimed on the final bytes: `orgs.routes` 119/119 (this prompt originally
said 129/129, which round 2 correctly found to be the COMBINED figure — Low-5),
`db.migration` 10/10,
both together 129/129, shared 51/51, tsc exit 0, eslint clean, sweep 15 RED / 0
ALIVE / 0 never ran (a stated SUBSET of 126).

**The full api suite is NOT quoted green** — it flakes on a fast database for a
pre-existing reason with its own OWED line (:13746). Treat a failure in
`catalog.seed` or `db.migration`'s global counts as that known flake and say so
rather than scoring it.

If Criticals appear in the SAME subsystem two rounds running, say so and STOP —
that is Kd's redesign trigger, not a cue for another patch. Round 1's three were
all in `modules/orgs`, so **this round finding a Critical there ARMS the escape
hatch** and the decision is Kd's, not yours and not mine.
