# T3 ROUND 1 — gym details, server half (two commits: `8540691` + the country-lock addendum)

> **SUPERSEDED — this ran on 2026-08-26 and found THREE Critical/High**
> (`DECISIONS.md:19656`). All are fixed. **Round 2 is
> `t3-gym-details-r2-PROMPT.md`.** Kept for the record.
>
> **AND THE WAY IT WAS HANDED OVER CARRIED A DEFECT OF MINE — do not repeat it.**
> The covering message I gave Kd to paste told the reviewer to report "in plain
> English, short, no file paths or line numbers", which is Part 0.5's rule for
> talking to KD. The reviewer complied, and **the detail Kd needed was compressed
> out of the report**, so he had to ask for it twice — *"i think something was
> wrong in the fucking prompt you gave that why it did not give things in
> details"*, and he was right. **Part 0.5 governs what a CHAT says to KD. A
> reviewer's findings are EVIDENCE and must arrive in full technical detail;
> translating them for Kd is a separate job, downstream of the review.** Round
> 2's prompt says so in as many words.

Paste everything below into a FRESH chat. Do not run it in the chat that wrote
the code (CLAUDE.md Part I §7c — the author defends their own reasoning).

---

You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11 and the spec sections it touches (Part 3 §2.2 the role matrix, §3.3 the
route surface, §4.0 the onboarding wizard's fields; Part 4 §3.2 the gyms DDL).

The diff is the last TWO commits on branch `web-repoint`:
`git log --oneline -2 && git diff 8540691~1..HEAD`

The second commit is a Kd ruling applied on top of the first, not a fix round —
review them as one packet.

Output only: (1) violations as rule# · file:line · one-line fix; (2) a security
pass — authn/authz/tenancy, input parsing, idempotency, secrets/log leaks, SQL
safety; (3) anything that would fail the phase's Done gate. No praise, no
restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5, DECISIONS
:5348, amended :5807). Critical/High = security, data loss, privacy, money, a
broken core flow, **or anything a user could see that is FALSE**. Low = spelling,
comments, naming, style. Justify a Critical/High tag by naming the concrete
failure. Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no further
round — but it is STILL FIXED and logged in BACKLOG.md; report it at full
severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix would carry a test that fails without it (rule 3). If Criticals appear in the
SAME subsystem two rounds running, say so and STOP — that is Kd's redesign
trigger, not a cue for another patch.

## What this card is, and what it deliberately does NOT do

A gym could never change its own name, city, country or time zone — the row was
insert-only after `createOrgAttempt`. This adds `PATCH /v1/orgs/:gymId` behind a
new `org.manage` privilege Kd approved at the plan gate (owner-only **by
default**; he can tick it across to a manager). Migration `0014` widens the
privileges CHECK, backfills the new privilege onto every existing owner row, and
adds `gyms.country`.

Out of scope BY RULING and refused with a 400 rather than stripped: `slug`,
`orgType`, `locale`, and a client-sent `currencyDisplay`. There is **no screen**,
so there is no smoke to run and none is claimed.

**A SECOND KD RULING LANDED THE SAME DAY AND IS PART OF THIS PACKET: a gym's
COUNTRY freezes once it is on a paid plan** (409 `country_locked` for any
subscription past `trialing`); name, city and time zone stay editable. The
card-less trial is deliberately NOT a lock. Reasoning and the sourced provider
evidence are at `DECISIONS.md:19560`, which SUPERSEDES the "country is freely
editable" half of the entry below.

Full reasoning: `DECISIONS.md:19366`, then the addendum at `:19560`. Read both
before scoring anything — several choices there are answers to prior findings and
re-litigating one is the protocol failure CLAUDE.md names.

## Places worth pointing a mutant at, because I have already been wrong twice here

1. **`repo.updateOrg`'s no-op comparison and its lock.** The lock is taken for
   the AUDIT ROW, not the write. Is that reasoning sound, and does the comparison
   actually hold under a concurrent edit?
2. **The `city` absent-vs-null distinction** (`"city" in patch` rather than
   `!== undefined`). Is there a path where an absent key still writes?
3. **The `0014` backfill against :15381's snapshot ruling.** I argue it is not a
   breach because the privilege did not exist. Check that argument, and check the
   backfill is genuinely idempotent.
4. **`gyms.country` left NULL for existing rows on purpose.** Is there anywhere
   that now reads `country` and would behave badly on NULL?
5. **The shared `resolveCurrency`.** Create and edit now depend on one function.
   Did that widen anything, or un-cover a guarantee at either door?
6. **`orgSummarySchema.country` uses `.default(null)`** for the
   expand-then-contract reason (:12660). Is that right in BOTH deploy directions?
7. **The country lock's placement.** It sits inside `repo.updateOrg`'s
   transaction, after `lockOrgRow`, because it is a check-then-act guarding
   money. Is the lock actually sufficient — can a subscription commit between the
   check and the UPDATE and move a paying gym's currency?
8. **`status <> 'trialing'` as the definition of "is paying".** Is there a state
   in Part 5 §3's machine where a gym has been billed but is back to `trialing`?
   Is there one where it has paid nothing and is NOT `trialing` (so we over-lock)?
   Over-locking is the accepted direction; under-locking is a Critical.
9. **The 409's sentence names a way out ("contact us").** There is no admin tool
   to perform it yet — it has an OWED line. Is a refusal that names an unbuilt
   remedy honest, or is it :5807's class (a promise that is not true)? Score it
   either way; I judged it honest because Kd approves every gym by hand today.

## What I already found and closed — do not re-find these, but DO check the fixes

- The first backfill test could not fail (an empty-set assertion on a database
  with no owner rows). Rewritten to build its own legacy row and run the backfill
  read out of the shipped migration file. **Check that it can still fail.**
- Two of eight new mutants would have come back ALIVE: `O120` (fixture had no
  lower-case country) and `O114` (the authz test's every PATCH is refused before
  it reaches the repo, so the `gym_id` predicate was never executed). Both closed
  by fixing the TESTS. **Check the fixes are real, not cosmetic.**
- `O15` was re-anchored and `O20` was given a sibling `O122` rather than being
  re-aimed. **Check O20/O122 genuinely cover two different call sites.**
- The country lock ships with TWO mutants on purpose — `O123` deletes it, `O124`
  deletes the trial carve-out so it fires too EARLY. **Check that the second
  really is observable**, and that the test's positive control (the same locked
  gym still renaming itself) is what makes the first mean anything.

## The verification I ran (all against the LOCAL Postgres)

```
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
pnpm --filter api test:local test/orgs.routes.test.ts test/db.migration.test.ts
pnpm --filter @app/shared test
DATABASE_URL="postgres://aihg:aihg@localhost:5433/aihg" \
  MUTATE_ONLY=O15,O20,O114,O115,O116,O117,O118,O119,O120,O121,O122,O123,O124 \
  node apps/api/tools/mutate-orgs.mjs
```

Results on the final bytes: `orgs.routes` 117/117, `db.migration` 10/10, both
together 127/127, shared 51/51, four more suites 69/69 (re-run after the country
lock landed, not carried), tsc exit 0, eslint clean, sweep 13 RED / 0 ALIVE / 0
never ran (a stated SUBSET of 124).

**The full api suite is NOT quoted green** — it flakes on a fast database for a
pre-existing reason with its own OWED line (:13746). If you want a full run,
treat a failure in `catalog.seed` or `db.migration`'s global counts as that
known flake and say so rather than scoring it.
