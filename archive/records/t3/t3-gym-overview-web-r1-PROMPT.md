# T3 · ROUND 1 — the gym's numbers, WEB half

**Paste this whole file into a FRESH chat, with `t3-gym-overview-web-r1.diff`
attached.** You are reviewing, not fixing. A subagent is not a T3
(`DECISIONS.md` — the Card 5c precedent); this must be a chat that did not write
the code.

---

You are reviewing a diff, not fixing it. Audit it strictly against `CLAUDE.md`
Part II R0–R11 and the spec sections named below. Output only:

1. **Violations** — rule# · file:line · one-line fix.
2. **A security pass** — authn/authz/tenancy, input parsing, idempotency,
   secrets/log leaks.
3. **Anything that would fail the phase's Done gate.**

No praise, no restating the diff.

**TAG EVERY FINDING `Critical/High` or `Low`** (CLAUDE.md Part I §2.5,
`DECISIONS.md:5348`, amended by `:5807`). Critical/High = security, data loss,
privacy, money, a broken core flow, **or anything a user could SEE that is
FALSE** — a wrong number, a wrong state, a promise that is not true. Low =
spelling, comments, naming, style. Justify a Critical/High tag by naming the
concrete failure. **Zero Critical/High ⇒ the packet SHIPS.** A Low finding buys
no further round — but it is STILL FIXED and logged in `BACKLOG.md`; report it at
full severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix would carry a test that fails without it (rule 3). If Criticals appear in the
SAME subsystem two rounds running, say so and STOP — that is Kd's redesign
trigger, not a cue for another patch. **Round 1 on the server half (`:30243`)
found ZERO Critical/High, so the hatch is not armed going in.**

---

## WHAT THIS IS

The second half of `CARD-gym-overview-numbers.md` — §4b, the screen. Three tiles,
an eight-week chart and the empty states on the console's Overview. **Commits `0532811` and `3028969`; the card record is `DECISIONS.md:30399`, with
its same-session addendum at `:30624`.** The server half it draws is
`:30094`, reviewed at `:30243`.

**WEB-ONLY.** No migration, no `apps/api` file, no `packages/shared` change — so
`:28395`'s fan-out does not apply and `web` is the whole of the suite that could
move.

## THE BINDING READING, and this is not optional

- **`DECISIONS.md:29961`** — Kd's four rulings at this card's gate. Ruling 1 is a
  KNOWING deviation from Part 3 §4.1: **the tiles count VISITS, not workouts.**
- **`DECISIONS.md:30094`** §2.1 — why the route reads `gym_attendance` LIVE and
  not the nightly table. **A reviewer who reads `org_daily_stats` into this
  screen has the wrong model of the feature.**
- **`DECISIONS.md:30399`** — this card's own record, including §3 (an instruction
  four documents carried that was false) and §6 (a mutant that was ALIVE).
- **`DECISIONS.md:8267` and `:8343`** — the empty-state class. §4 of this card's
  record explains why the card's own prescribed sentence could not ship.
- **`docs/spec/03-part3-org-console.md` §4.1** — the KPI row, the chart's
  "< 1 wk data" state, and the "0 members ever" edge.
- **`CARD-gym-overview-numbers.md` §4b** — the four empty states and the fifth
  requirement (the uneven week comparison).

## WHAT I WOULD LOOK AT FIRST, said plainly so you can disagree with it

1. **Does anything on this screen compute a figure?** Ruling 14 (`:27992` §3):
   every number is the server's. The percentage especially — the fixture that
   proves it serves 77% beside 12 of 28, which is not 12/28.
2. **The uneven week comparison.** `week.visits` is this gym-week SO FAR and
   `prevVisits` is the WHOLE of last week. Is there any path that draws an arrow
   without saying so? On a Tuesday that is two days against seven.
3. **The last chart bar is the current, PARTIAL week.** Is that visible to
   somebody who cannot hover? Is it visible at all?
4. **The four empty states.** Failed · no members · nobody has come · still
   collecting. Are any two of them reachable at once, and does the one that wins
   describe the thing the owner is actually looking at? (`emptyDayReason`'s L-1
   one screen over is that exact defect.)
5. **The 403.** `attendance.read` is default-on for all three roles and an owner
   may untick it, so a refused trainer is a real person. The numbers go silent —
   is silence right, and is anything else lost with them?
6. **The fourth read.** It joins three others in one `Promise.allSettled`. Does
   any pane's outcome now depend on another's? Does the retry re-read all four?
   Does gym A's answer survive a walk to gym B (`:22029`, `:20712`)?
7. **The date on the axis.** A gym's Monday has no instant in it. Is there any
   `Date` on that path?

## THE ONE THING A REVIEW OF THIS DIFF SHOULD ASSUME IS STILL THERE

**Kd opened the first version and found a Critical/High in the first minute that
1,659 green tests and 12 RED mutants could not see** (`:30624`): *"Today · 1
person"* drawn beside *"Last 30 days · 0% — 0 of 2 members came"*. Every figure
was correct — the visitor held a complimentary seat the share excludes at both
ends — **and the screen was false because two correct numbers sat next to each
other.** It is fixed here as `crowdNote`.

**Assume that class is not exhausted.** Every string on this screen is asserted
and every assertion passes; ask instead what two of them say TOGETHER, and to
whom. The populations in play: `today`/`week` count every attendee, `month`
counts current non-complimentary members only, and `members` is that same
restricted denominator.

## THE INSTRUMENT, and please check it rather than trust it

The audit was `MUTATE_ONLY=C155…C168` in `apps/web/tools/mutate-console.mjs` —
14 mutants, 14 RED, a stated SUBSET of 188. **C155 was ALIVE on the first pass
because the test I wrote with it could not see the defect** (`:30399` §6), and
the fix was to the fixture, not the code. **Assume there are more of those.** The
question worth asking of every new assertion: would it fail if the guarantee were
removed, or does it merely agree with the current output?

A duplicate-id guard was ported into that harness in this diff and proven by
causing it. Check it is not the only thing standing between two mutants sharing
an id.

## WHAT DOES NOT TICK, so you are not reviewing a claim I have not made

- **No browser smoke has run.** `RUNBOOK/smoke-overview-numbers.md` is written
  and unrun; the `OWED.md` line does not tick.
- **The backfill has not been run** and, per `:30399` §3, gates nothing.
- Three of the screen's states cannot be reached from Kd's own gym; the sheet
  says which and why.
