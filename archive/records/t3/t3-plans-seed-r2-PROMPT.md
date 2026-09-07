# T3 — round 2 (DIFF-ONLY) on the plans-seed card (paste into a FRESH chat)

Attach: `t3-plans-seed-r2.diff` · `CLAUDE.md` · `docs/spec/04-part4-database.md`
§3.3 · `docs/spec/05-part5-billing.md` §1.

---

**YOU ARE REVIEWING ONLY. DO NOT EDIT, CREATE OR DELETE A SINGLE FILE. DO NOT
FIX ANYTHING. DO NOT COMMIT.** Your entire output is a list of findings Kd will
copy out of this chat and hand to the chat that wrote the code — that chat does
the fixing, after he approves the list. A reviewer who fixes its own findings
destroys the independence the review exists for.

**Write the findings so KD can read them** (CLAUDE.md Part 0.5): he is a
complete beginner. Number each finding, tag its severity, and give one plain
sentence saying what a user would experience. Technical detail underneath.

**THIS IS A DIFF-ONLY RE-REVIEW (:5348 rule 2): cover ONLY the round-1 fixes and
the surfaces they touch. No fresh full pass.** Round 1 is at `DECISIONS.md:18652`
and the card it reviews is at `:18488`.

Tag every finding **Critical/High** or **Low**. Critical/High = security, data
loss, privacy, money, a broken core flow, **or (:5807 1a) anything a user could
SEE that is FALSE**. Zero Critical/High ⇒ the packet SHIPS. A Low buys no
further round but is still FIXED and logged in `BACKLOG.md` — report it at full
severity, never soften it to duck a round.

Also report: any test that stays GREEN when the thing it claims to check is
broken (rule 4), and whether each Critical/High fix carries a test that fails
without it (rule 3).

**ESCAPE HATCH — READ THIS BEFORE YOU TAG ANYTHING.** Round 1 found three
Critical/High. **If you find a Critical/High in the SAME subsystem, that is two
consecutive rounds and it is Kd's REDESIGN TRIGGER — say so plainly and STOP,
rather than proposing another patch.** Round 1's three were: `apps/api/test`
fixtures (C/H-1), `apps/api/tools/mutate-orgs.mjs` (C/H-2 and C/H-3). Judge the
subsystem at file granularity, as :13336 does.

## The three fixes to audit

1. **C/H-1 — six tests that only passed on a database holding retired rows.**
   Five fixtures repointed at `org_b1_in_m`; the retired-rows assertion replaced
   by one asserting the exact SET of active org codes; and the test now inserts
   its own legacy `org_micro` row so the retirement always has a subject.
   **Attack:** does the new assertion hold on a fresh database AND a long-lived
   one? Does the inserted legacy row leak into or corrupt any other suite (nine
   files call `seed()` against one shared database — :13746)? Is inserting a
   real production code from a test the right call, or does it plant a row that
   later confuses something? Do the four repointed gym-member tests actually
   observe the 5-scan block now, or did they move and still prove nothing?
2. **C/H-2 — the database-repair guard.** Moved ABOVE the mutation loop and
   registered via `process.on('exit')`. **The first fix for this was itself
   broken** (registered below the loop; measured `pro_us_m` left at 699).
   **Attack:** is it now reachable from every exit path — in-loop aborts, an
   uncaught throw, normal completion? Can it run TWICE, or run when no seed
   mutant was selected? Can it mask a real failure by exiting 0? Does the
   `seedRepaired` latch do what its name says?
3. **C/H-3 — the remote-database refusal.** A `seed` mutant against a non-local
   host aborts unless `MUTATE_SEED_ON_REMOTE_DB=i-know-this-writes-prices`.
   **Attack:** is the local-host regex right (IPv6, a unix socket, a host that
   merely starts with "localhost")? Does the refusal fire before anything is
   written? Is the opt-in string doing real work or is it theatre?

## Also worth your attention

- **O111's fix.** The mutant was ALIVE on a fresh database and RED on the dev
  one. Now the test builds its own legacy row. **Is the guarantee genuinely
  observable on both, or has the fixture just moved the blind spot?**
- **The two corrections written into `:18488`.** Round 1 struck two sentences of
  the original entry rather than only correcting them where they were noticed
  (:5748). Are the strikes accurate, and is anything still standing that the
  round proved false?
- **The four Low fixes** in `BACKLOG.md` — particularly `SEED_FILTER`, which is
  now referenced from eight places.

## What was already run (re-run to DISPROVE, not to confirm)

Every figure names its database.
**Fresh** (created, migrated, seeded, dropped): `db.migration` 8/8 ·
`entitlements.routes` 9/9 · `orgs.routes` 104/104 · O111 RED.
**Local** (carries the legacy rows): four suites 52/52 · `orgs.routes` 104/104 ·
**O106–O112 7 RED 0 ALIVE**, a stated SUBSET of 112 · `tsc` clean · `eslint`
clean at `--max-warnings=0` on five files · `node --check` clean.
Both new guards proven by causing them, in both directions.

```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
corepack pnpm --filter api test:local test/db.migration.test.ts
DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' \
  MUTATE_ONLY=O106,O107,O108,O109,O110,O111,O112 node apps/api/tools/mutate-orgs.mjs
```

To reproduce a fresh database (this is what caught C/H-1):
```
docker exec aihg-dev-postgres-1 psql -U aihg -d postgres -c "CREATE DATABASE t3check;"
DATABASE_URL='postgres://aihg:aihg@localhost:5433/t3check' corepack pnpm --filter api exec drizzle-kit migrate
DATABASE_URL='postgres://aihg:aihg@localhost:5433/t3check' corepack pnpm --filter api exec tsx src/db/seed.ts
# …then point vitest at that url. Drop it afterwards.
```

`pnpm -w typecheck` does not run on this machine (turbo invokes pnpm 11.18.0
against the pinned 9.15.4). Use `corepack pnpm --filter api exec tsc --noEmit`.

## Not in scope

The prices themselves were audited in round 1 and confirmed correct — do not
re-audit them unless a round-1 fix touched one. No checkout, no Paddle, no trial
mechanism, no plan picker, no screen; each has its own `OWED.md` line. Nothing
inserts into `subscriptions`, so no gym is on a plan and every cap is inert in
the running app.
