# T3 — round 1 on the plans-seed card (paste this into a FRESH chat)

Attach: `t3-plans-seed-r1.diff` · `CLAUDE.md` · `docs/spec/04-part4-database.md`
§3.3 · `docs/spec/05-part5-billing.md` §1.

---

**YOU ARE REVIEWING ONLY. DO NOT EDIT, CREATE OR DELETE A SINGLE FILE. DO NOT
FIX ANYTHING. DO NOT COMMIT.** Your entire output is a list of findings that Kd
will copy out of this chat and hand to the chat that wrote the code — that chat
does the fixing, after he approves the list. A reviewer who fixes its own
findings destroys the independence the review exists for. If you believe
something must be fixed urgently, say so in the finding; still change nothing.

**Write the findings so KD can read them** (CLAUDE.md Part 0.5): he is a
complete beginner. Give each finding a number, a severity tag, and one plain
sentence saying what a user would experience. Put the technical detail
(file, line, rule number, the fix) underneath — the next chat needs that, but it
must not be the first thing Kd reads.

Audit this diff strictly against CLAUDE.md Part II
R0–R11 and the spec §§ above. Output only: (1) violations as rule# · file:line ·
one-line fix; (2) a security pass — authn/authz/tenancy, input parsing,
idempotency, secrets/log leaks, SQL safety; (3) anything that would fail the
phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS :5348). Critical/High = security, data loss, privacy, money, a broken
core flow — **and :5807 1a: anything a user could SEE that is FALSE**. Low =
spelling, comments, naming, style. Justify a Critical/High tag by naming the
concrete failure. Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no
further round — but it is STILL FIXED and logged in BACKLOG.md; report it at
full severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to
check is broken (rule 4 — list them, do not fix them), and whether each
Critical/High fix carries a test that fails without it (rule 3). If Criticals
appear in the SAME subsystem two rounds running, say so and STOP — that is Kd's
redesign trigger, not a cue for another patch.

## What this card is

The seeded price list (`apps/api/src/db/seed.ts`) matched no ruled price book
and had ZERO USD gym plans. It now carries the ruled book in both currencies.
Full record at `DECISIONS.md:18488`; the governing rulings are `:17366 §1`
(the ratified book) and `:17902 §1a/§1b` (bands 1–2 raised, boundaries rounded).

## Please attack these in particular

1. **MONEY, R6.1.** Every price is an integer minor unit. Check each of the 15
   figures against the two DECISIONS entries — **and check that bands 3–5 and
   the INR column were NOT scaled** to match the band-1/2 raise. Scaling them
   would be an invented ruling (:17366 §0).
2. **`seat_cap` is the band boundary AND the door.** `seatCapFor`
   (`modules/orgs/repo.ts`) reads it through the gym's live subscription. Are
   the caps right, and is the off-by-one right — band 1 is "0–300" and
   `claimSeat` refuses at `used >= cap`?
3. **THE RETIREMENT.** Six old org rows are set `active = false` after the
   upsert loop. Is the ORDER load-bearing and correct? Is it idempotent? Is
   anything, anywhere, reading `plans.active` that this would now change? (The
   card claims nothing does — verify it rather than believe it.)
4. **THE HARNESS CHANGE IS THE RISKIEST PART.** `seed.ts` is the first mutation
   target the suite RUNS rather than reads, so a mutant writes to the shared
   database and outlives the file restore. The card adds a post-sweep re-seed
   guard. **Is that guard actually load-bearing, or does the control run at the
   start of the next sweep already cover it? Can it report success without
   having verified anything?** The card admits its abort arm is unreachable —
   is that admission correct, and should the arm ship at all (:17218/:17676:
   a line nothing can observe should not ship)?
5. **THE NEW ASSERTIONS.** `test/db.migration.test.ts` grew a lot. Mutate them:
   does each actually fail when the thing it names is broken? In particular the
   both-books count and the content-idempotency loop.
6. **THE TWO NUMBERS THAT ARE NEW RULINGS** — ₹449 and yearly-at-eleven-months.
   Are they recorded as Kd's, in the right places, and is the correction to
   `OWED.md`'s "ratified at :17366" claim accurate?

## What was already run (do not re-run to confirm; re-run to DISPROVE)

Local Postgres per :13659. R9.5 red watched first
(`pro_in_m price: expected 14900 to be 44900`). Then db.migration 8/8 ·
entitlements.routes 9/9 · coach.chat 28/28 · catalog.seed 7/7 ·
orgs.routes 104/104 · tsc clean · eslint clean at `--max-warnings=0` on the
three changed api files · mutants **O106–O112, 7 RED, 0 ALIVE**, a stated
SUBSET of 112.

`pnpm -w typecheck` does not run on this machine (turbo invokes pnpm 11.18.0
against the pinned 9.15.4). Use `corepack pnpm --filter api exec tsc --noEmit`.

Commands:
```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
corepack pnpm --filter api test:local test/db.migration.test.ts
DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' \
  MUTATE_ONLY=O106,O107,O108,O109,O110,O111,O112 node apps/api/tools/mutate-orgs.mjs
```

## Not in scope

No checkout, no Paddle, no trial mechanism, no plan picker, no screen — each has
its own `OWED.md` line. Nothing inserts into `subscriptions`, so no gym is on a
plan and every cap here is inert in the running app.
