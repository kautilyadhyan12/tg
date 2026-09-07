Paste everything below into a FRESH chat. Written 2026-09-05, on commit `c6f47cd`.

---

Read CLAUDE.md fully — its rules are binding. Follow the session-start protocol
(Part I.6) and the grounding rule before any substantive output.

You are reviewing, not fixing. This is **T3 ROUND 1 on the web half of "on a
roll" and the cheer** — `CARD-gym-overview-people.md` §4b, shipped in commit
`c6f47cd` on branch `web-repoint`. Audit that diff strictly against CLAUDE.md
Part II R0–R11 and the spec sections the card cites.

**The diff:** `git show c6f47cd` — 25 files, web-only. No `apps/api`, no
`packages/shared`, no migration.

**Ground yourself first — do NOT take any of the below as fact** (S1/V4: this
prompt is another chat's summary and the repo wins):
  · `DECISIONS-TRIGGERS.md` in full · `DECISIONS-INDEX.md` §1 and §2 in full,
    plus every `DECISIONS.md` entry those send you to, opened in full
  · `DECISIONS.md` `:34809` (this card's own record), `:34240` (the server half
    it reads), `:34443` and `:34666` (its two review rounds — round 2 wrote a
    build constraint for this half)
  · `:29961` ruling 4 (Kd's ruling), `:30399` (the screen this panel attaches
    to), `:12518` (a control a role might be refused)
  · `OWED.md`'s two cheer/people-lists lines and the new fifth-preset line
  · `HANDOFF.md`'s top block

Output only:
1. violations as rule# · file:line · one-line fix;
2. a security pass — authn/authz/tenancy, input parsing, idempotency,
   secrets/log leaks;
3. anything that would fail the phase's Done gate.

No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS `:5348`, and `:5807`'s amendment: **what a user can SEE and is FALSE
is Critical/High**). Justify a Critical/High tag by naming the concrete failure.
Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no further round — but
it is STILL FIXED and logged in `BACKLOG.md`; report it at full severity, never
soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to
check is broken (rule 4 — list them, do not fix them), and whether each
Critical/High fix carries a test that fails without it (rule 3). If Criticals
appear in the SAME subsystem two rounds running, say so and STOP — that is Kd's
redesign trigger, not a cue for another patch.

---

**Where to look hardest, and why — stated so you can disagree with it rather
than inherit it:**

1. **The mutant that was ALIVE.** C220 sends the cheer to `onARoll[0]` instead
   of the pressed row. It survived because the fixture had ONE member on the
   list. It is RED now, on a two-row fixture — **check whether the same
   one-of-something blindness is left anywhere else in this diff**, including
   the member's side and the sidebar dot.
2. **The four button states and their ORDER.** `cheerState` answers privilege →
   plan → window, mirroring `sendOrgCheer`. Check that against the server's
   actual order in `apps/api/src/modules/orgs/service.ts`, not against this
   claim.
3. **`reloadOverview` swallows its own failure** (`Overview.jsx`). Deliberate,
   argued in a docblock. Decide whether the argument holds.
4. **The 409 arm** turns a refusal into a row state. Check the sentence it shows
   is true for the second staffer on the desk, which is what `:34443` §4 cost
   already.
5. **The absence assertions.** `onARoll.render.test.jsx` and
   `console.render.test.jsx` both assert a control is NOT drawn. `:28976` is the
   class where those are vacuous — check each carries a positive control that
   would fail if the surrounding screen stopped rendering.
6. **The empty state** must not claim anything about the gym's history
   (`:8343`, `:30399` §4).

**Not built, and stated rather than implied** (`:5348` rule 6): no smoke has
run, and most of `RUNBOOK/smoke-on-a-roll-cheer.md` **cannot** be run — the list
needs a member with visits in two or more consecutive weeks, and no screen in
this product can create a visit dated two weeks ago.
