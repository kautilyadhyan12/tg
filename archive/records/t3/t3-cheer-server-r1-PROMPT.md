Paste everything below the line into a FRESH chat (T3 must not be the chat that
wrote the code, and a subagent is not a T3 — DECISIONS `:5348`, and the
`t3-fresh-chat-never-subagent` memory).

Commit under review: `a20ef8d` on `web-repoint`.

---

You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11 and the spec sections named below. Output only: (1) violations as
rule# · file:line · one-line fix; (2) a security pass — authn/authz/tenancy,
input parsing, idempotency, secrets/log leaks, SQL safety; (3) anything that
would fail the phase's Done gate. No praise, no restating the diff.

    git show a20ef8d --stat
    git show a20ef8d

**WHAT THIS IS.** The SERVER HALF of `CARD-gym-overview-people.md` §4a — a gym
can see which members keep turning up ("on a roll") and send one of four
ready-made lines of encouragement, capped at one per member per week. No screen
exists; the web half is unbuilt, no smoke has run, and the `OWED.md` line does
not tick.

**BINDING RULINGS, and a finding that contradicts one of these is Critical/High
by construction:**

- `DECISIONS.md:29961` ruling 4 — an emoji plus a ready-made line, ONE TAP, one
  per member per week, **no free-text box**.
- `DECISIONS.md:34240` — this card's own entry. Kd ruled BOTH streak units
  ("both weeks and days run") on 2026-09-04.
- `:26469` §1.3 — **a gym is NEVER shown what a member did away from it.**
- `:27992` §2 — the app never checks whether a member has paid the gym.
- `:27992` §3 / `:29250` — counts come from the SERVER or they are wrong.
- `:23711` — every write door in the orgs module refuses a gym with no live plan.
- `:28107` — adding a privilege is a MIGRATION here, not a list edit.
- Spec `03-part3-org-console.md:280` (`rate-limit 1/member/7d`), `:207` (the
  endpoint shape), `:98` (§2.2 grants the nudge to all three roles).

**FIVE THINGS I WOULD ATTACK FIRST IF I WERE YOU** — named because a reviewer who
only reads what the author thought about finds what the author thought about:

1. **The two island CTEs in `getGymRegulars`.** `day - row_number()` and the
   week variant with a stride of 7. Are the streaks right at a week boundary, on
   a gym whose "today" is not the server's? Is there a fixture that could only
   pass by accident? The GROUP BY in those CTEs was wrong on the first run.
2. **`visits` is counted over the week-streak's span**, not a fixed window. Can
   that produce a figure that disagrees with the `weeksRunning` beside it —
   `:30624`'s class, on the screen where it has already happened once?
3. **The cap is a check-then-act under `lockOrgRow`, not a constraint.** Is the
   lock actually held across the read and the insert? Can two staff members
   pressing at the same instant both write? Is `>` vs `>=` right at exactly
   seven days?
4. **`latestCheer` on `/v1/orgs/mine`.** It is deliberately NOT withheld from a
   plain member, unlike the four staff fields beside it. Is that boundary right,
   and does the lateral leak anything across gyms or users? (The author shipped
   this field missing from the response mapping once already — the schema default
   hid it.)
5. **`ON DELETE RESTRICT` on all three FKs** plus `gym_cheers` joining
   `USER_LINKED_NOT_PURGED_TABLES`. Does the DPDP path actually work, or is there
   a purge that now fails on a cheer row?

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS `:5348`). Critical/High = security, data loss, privacy, money, a broken
core flow — **and per `:5807`, anything a user could SEE that is FALSE**, which
on this card means a wrong streak, a wrong visit count, or a cheer attributed to
the wrong gym or person. Low = spelling, comments, naming, style. Justify a
Critical/High tag by naming the concrete failure. Zero Critical/High ⇒ the packet
SHIPS. A Low finding buys no further round — but it is STILL FIXED and logged in
`BACKLOG.md`; report it at full severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix would carry a test that fails without it (rule 3). If Criticals appear in the
SAME subsystem two rounds running, say so and STOP — that is Kd's redesign
trigger, not a cue for another patch.

**The audit that has already run, so you do not repeat it:** `MUTATE_ONLY=O261…
O272`, 12 mutants, 12 RED, 0 ALIVE, 0 never ran, against local Postgres, controls
green and tallied, restores sha256-verified. **That is a stated SUBSET of 262 and
is not a full sweep.** If you think a guarantee on this diff has no observer,
say which — that is the most valuable thing you can find here.
