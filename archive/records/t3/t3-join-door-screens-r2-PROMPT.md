You are reviewing, not fixing. Do not change any file.

**THIS IS A RE-REVIEW (round 2), and it is DIFF-ONLY.** Cover ONLY the fixes
below and the surfaces they touch. No fresh full pass over the card — round 1
already did that (`CLAUDE.md` Part I §2.5 rule 2).

Audit against `CLAUDE.md` Part II R0–R11, `docs/spec/03-part3-org-console.md`
§2.4 / §4.3 / §2.2, and `00-architecture-v1.md` §8.

Output only: (1) violations as rule# · file:line · one-line fix; (2) a security
pass — authn/authz/tenancy, input parsing, idempotency, secrets/log leaks, SQL
safety; (3) anything that would fail the phase's Done gate. No praise, no
restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (Part I §2.5, DECISIONS :5348,
amended :5807). Critical/High = security, data loss, privacy, money, a broken
core flow — **or anything a user can SEE that is FALSE, or that blocks them from
finishing something they should be able to do**. Low = spelling, comments,
naming, style. Justify a Critical/High tag by naming the concrete failure.
**Zero Critical/High ⇒ the packet SHIPS.** A Low finding buys no further round —
but it is STILL FIXED and logged in `BACKLOG.md`; report it at full severity,
never soften it to duck a round.

Also report: whether each Critical/High fix carries a test that FAILS without it
(rule 3), and any existing test that stays GREEN when the thing it claims to
check is broken (rule 4 — list them, do not fix them).

**Escape hatch:** if Criticals appear in the SAME subsystem two rounds running,
say so and STOP — that is Kd's redesign trigger, not a cue for another patch.
Round 1 found two Critical/High in this subsystem, so **a Critical/High here
ARMS it**. Do not soften a finding to avoid that, and do not manufacture one.

## What is in this diff

Diff: `t3-join-door-screens-r2-full.diff` (repo root) — commits `2346fe4` and
`8b19775` concatenated, 19 file-diffs, 1,144 lines, record files excluded.
Round 1's report is at `DECISIONS.md` **:12518** and Kd's follow-up ruling at
**:12660**; read both first.

### The third fix — Kd's ruling AFTER round 1 (`DECISIONS.md` :12660)

Round 1's C/H-1 fix stopped the app calling a removed member a stranger. **It
left the app saying NOTHING about that gym, and Kd ruled that is its own hole.**
`/v1/orgs/mine` now carries a separate `formerOrgs` list and the dashboard card
says **"You're no longer a member of {gym}"**.

This is the part to aim hardest at, because it is the newest and least reviewed:
- **Is the sentence TRUE?** It claims every workout, form score and streak is
  still theirs. Check that removal really does leave training data untouched.
- **`formerOrgs` is `.default([])`** so a web app newer than the API degrades one
  sentence instead of destroying the whole card. Is that the right trade, and
  does the default hide anything it should not?
- **The rank** puts `removed` BELOW `refused`, which is a recency argument that
  depends on round 1's C/H-1 fix continuing to withhold superseded refusals.
  Is there a reachable sequence where that produces a wrong sentence?
- **`orgs` must be unchanged in meaning** — the console reads the same response
  and a removed gym leaking into `orgs` would enter a list whose reads 404.
- **The 14-day window and the rejoin exclusion** — can a person see both
  "you're a member" and "you're no longer a member" about one gym?
- **Is a removal distinguishable from a person deleting their own account?**
  The DPDP Day-0 cascade also writes `removed_at`. The code argues this cannot
  be in flight for a live account reading its own dashboard. Test that argument.

### The two Critical/High fixes — the whole point of this round

**C/H-1 · a removed member was told the gym never confirmed them.**
`apps/api/src/modules/orgs/repo.ts` — `listApplicationsForUser` gained a
`NOT EXISTS` arm withholding a rejected/expired row when a LATER application by
the same person for the same gym reached `confirmed`.
Point your instruments at:
- **Does it compare the right thing?** It uses `(newer.applied_at, newer.id) >
  (a.applied_at, a.id)`. The mirror case must still be visible: confirmed →
  removed → re-applied → refused is a refusal that IS the newest fact.
- **Is the client half really unnecessary?** The fix is server-only on the claim
  that `gymMembershipView.js`'s rank is correct and was merely starved of the
  winning row. Test that claim rather than accepting it.
- **What else reads this?** The same rows feed the dashboard card and Settings →
  Gym. A row withheld here is a row neither screen can draw.
- **Ordering and paging.** `MY_APPLICATIONS_LIMIT` and the `ORDER BY` are
  unchanged; check the new arm cannot interact with them to drop a PENDING row.

**C/H-2 · a trainer was drawn a Remove button the server refuses.**
`consoleView.js` gained `canRemoveMembers`; `Members.jsx` consumes it.
Point your instruments at:
- **Is it an allow-list in effect, not just in comment?** A role added to the
  schema later must be refused by default.
- **Where does `staffRole` come from, and can it be absent?** It is read off the
  `useConsoleOrg` row while that row may still be loading.
- **Did hiding become the enforcement anywhere?** The server's 403 must still be
  what actually stops a trainer. R3.3.
- **Did the gate shut on anyone it should not?** A trainer must still read the
  full roster (:10010).

### The six Low fixes (all in the same round; details in `BACKLOG.md`)

- **L-1** four wiring points had no assertion at all — five SOURCE assertions
  added in `joinGym.render.test.jsx`. **Their stated limit is that they prove a
  page NAMES a component, not that it renders.** Say so if you think that limit
  is understated, or if a regex there can pass against a broken page.
- **L-2 / L-5** `/org/join?code=` is now driven as a real route; `key={code}`
  remounts the panel when the URL names a different gym. Check the `key` does
  not throw away state somebody was mid-way through typing.
- **L-3** `ConsoleFailed` on a failed removal now carries `onRetry`.
- **L-4** the `consent_required` question returns early instead of falling
  through to `setError`. Check nothing downstream needed that `setError`.
- **L-6** `GymMembershipCard` gained `refreshToken`; `JoinGymPanel` gained
  `onApplied`. Check the Dashboard's single-read behaviour is genuinely
  unchanged, and that the new effect dependency cannot loop.

## Figures to re-check rather than trust

orgs **48/48** on real Postgres (44 before this work) · web **874/874** (857
before) · shared **48/48** · `vite build` ✓ · `tsc --noEmit` clean on api and
shared · eslint clean on every changed file · `Settings.jsx` measured against its
HEAD copy at **4 errors before and 4 after**.

Every new test was mutation-proved and every mutant restored: the two round-1 C/H
tests were watched RED before their fixes; `params.get('code')` →
`params.get('c')` takes 2 RED; dropping `key={code}` takes 1 RED; deleting the
Dashboard card and renaming the route takes 2 RED; `formerOrgs: []` in the
service takes the removal-message test RED; deleting the rejoin `NOT EXISTS` arm
takes the rejoin test RED.

**Smoke: PASSED** before this round, all 17 steps of
`RUNBOOK/smoke-join-door.md`, including Remove. The C/H-1 defect was found on
the account that smoke left behind — the smoke passed and the app was still
lying, which is worth knowing before you decide what these fixes are worth.

## Two blind spots already proven on this card — aim past both

**1. A mutation sweep cannot find a MISSING guard, only delete an existing one.**
The 24-mutant sweep was scoped to what the card CHANGED; round 1's C/H-2 lived in
what the card ASSUMED — a role check nobody had written. **Look for the guard
that is absent, not only the guard that is wrong.**

**2. Nothing flags an ABSENT SENTENCE.** Round 1 caught the app saying something
FALSE and could not catch it saying NOTHING — no reviewer, test or mutant reports
a screen that stays silent when it owes the user a fact. **Kd found that one
himself, by looking.** Where this diff makes the app stop saying something, ask
what the person is now left to work out on their own.
