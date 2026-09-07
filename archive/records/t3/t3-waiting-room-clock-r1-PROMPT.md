You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11 and Part 3 §2.4 / §4.3, plus DECISIONS :11385 (the ruling this card
implements) and :12878 (what it decided). Output only: (1) violations as
rule# · file:line · one-line fix; (2) a security pass — authn/authz/tenancy,
input parsing, idempotency, secrets/log leaks, SQL safety; (3) anything that
would fail the phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS :5348, amended by :5807). Critical/High = security, data loss,
privacy, money, a broken core flow — **or anything a user can SEE that is
FALSE**. Low = spelling, comments, naming, style. Justify a Critical/High tag by
naming the concrete failure. Zero Critical/High ⇒ the packet SHIPS. A Low
finding buys no further round — but it is STILL FIXED and logged in BACKLOG.md;
report it at full severity, never soften it to duck a round.
Also report: any existing test that stays GREEN when the thing it claims to
check is broken (rule 4 — list them, do not fix them), and whether each
Critical/High fix carries a test that fails without it (rule 3). If Criticals
appear in the SAME subsystem two rounds running, say so and STOP — that is Kd's
redesign trigger, not a cue for another patch.

## What this card is

Step 3 of 3 of the join door: the waiting room's CLOCK. A pending join
application now EXPIRES, the gym gets CHASED about it, and the waiting member
can NUDGE once a day. Kd RATIFIED the three numbers at this card (14 days · 2
days then weekly · once a day), which is what :11385 required of it.

Diff: `t3-waiting-room-clock-r1.diff` (23 files). No migration — the three
columns were written by the step-1 card for this one and had never been read.

## Where to aim first — the four things most likely to be wrong

1. **`modules/orgs/sweep.ts`, the expiry's WHERE.** :11385: "an application may
   NEVER expire before the gym has been told at least once." It is enforced
   twice (the run's sequence, and the statement's own WHERE) and the guard has
   TWO ARMS (`gym_notified_at <= expires_at` OR flagged ≥ `EXPIRY_NOTICE_DAYS`
   ago). **Work out for yourself whether both arms are needed and whether the
   pair has a hole**, rather than taking the comment's word: the author's first
   version had one, and three tests — not a review — found it. Specifically ask:
   can any sequence of runs delete a request the gym had no real chance to act
   on, and can any sequence leave one that can NEVER die?
2. **The asymmetry between the two chases** (the first fires on overdue rows,
   the weekly one skips them). Decide whether that is correct or whether it
   strands something.
3. **Tenancy on the nudge.** `POST /v1/orgs/applications/:id/nudge` carries NO
   gym id by design; the pair is (application, caller). Check the WHERE, and
   check the 404-vs-403 choice matches the rest of the module.
4. **The once-a-day rule is a DATABASE column compared inside the writing
   statement**, not a Redis counter. Check it cannot be beaten by two concurrent
   taps, and that the "already sent" answer reports the time that HAPPENED
   rather than `now`.

## Specific things worth checking that a reader might not think to

- **`heldForNotice` is computed as (due) − (expired), both measured this run**,
  rather than from a second copy of the expiry's condition. Is that arithmetic
  right under a concurrent confirm?
- **The §2.4 key-set guard in `orgs.routes.test.ts` was WIDENED** to admit
  `gymNotifiedAt`/`nudgedAt` on the confirm queue. The argument is written into
  the test. **Judge that argument** — is either field something a gym should not
  see about an applicant?
- **The expiry writes an audit row with `actor_user_id = NULL`** and leaves
  `decided_at` NULL. Both are deliberate; check nothing downstream assumes
  either is non-null (`listApplicationsForUser` reads
  `coalesce(decided_at, expires_at)`).
- **Copy may promise NO email and NO delivered message** — none exists. Check
  every new string on both screens.
- **Both new contract fields are `.default(null)`** for :12660's
  expand-then-contract reason. Check the tests that prove it go through the REAL
  parser, not a mocked `orgService` (:12731's rule-4 finding was exactly that).
- **`tools/orgs-sweep.ts --now`** points at whatever `DATABASE_URL` names and a
  future date makes every pending row look old. Is the guard adequate, and is
  the absence of a dry run defensible?

## What has already been run (do not re-derive; challenge if you doubt it)

- sweep suite 15/15 on real Postgres · orgs.routes + orgs.unit 71/71 · web
  905/905 · shared 48/48 · `vite build` ✓ · tsc clean on api and shared ·
  eslint zero problems on all 14 changed files.
- Mutation sweep O48–O55 (8 new rows, own target + suite). Verdicts are in the
  DECISIONS entry; **the harness is `apps/api/tools/mutate-orgs.mjs` and you are
  encouraged to write mutants of your own** — :12227 recorded that a reviewer who
  only re-runs the author's harness inherits the author's blind spots, and that
  is how its sharpest finding surfaced.
- Kd's browser smoke (`RUNBOOK/smoke-clock.md`) — state whether it is run when
  you review; if it has not been, that is a gate, not a finding.
