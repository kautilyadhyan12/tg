You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II R0–R11
and Part 3 §4.2 / §2.4 of `docs/spec/03-part3-org-console.md`. Output only: (1) violations as
rule# · file:line · one-line fix; (2) a security pass — authn/authz/tenancy, input parsing,
idempotency, secrets/log leaks, SQL safety; (3) anything that would fail the phase's Done gate.
No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5, DECISIONS :5348).
Critical/High = security, data loss, privacy, money, a broken core flow — plus :5807's
amendment: **what a user can SEE and is FALSE**, or is blocked from finishing something.
Low = spelling, comments, naming, style — cosmetic-but-TRUE.
Justify a Critical/High tag by naming the concrete failure.
Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no further round — but it is
STILL FIXED and logged in BACKLOG.md; report it at full severity, never soften it to duck a round.
Also report: any existing test that stays GREEN when the thing it claims to check is broken
(rule 4 — list them, do not fix them), and whether each Critical/High fix carries a test that
fails without it (rule 3). If Criticals appear in the SAME subsystem two rounds running, say so
and STOP — that is Kd's redesign trigger, not a cue for another patch.

## WHAT THIS IS

The WEB half of the read-only console — Part 3 §4.2 and Kd's ruling of 2026-08-29 that a gym
with no live plan can SEE everything and CHANGE nothing, and that this stops **every member of
staff**, not only whoever can pay.

The SERVER half already shipped and passed its own T3: twelve write functions answer
**409 `gym_not_on_plan`**, and `/v1/orgs/mine` carries a three-state `consoleReadOnly`.
This diff makes the screens tell the truth about that. **No server file, no migration,
no dependency.**

Read before reviewing: **DECISIONS :24141** (this card), **:23711** (the server half),
**:23928** (its T3, whose Low-6 this card closes), **:22215** (Kd's governing ruling).

## THE FOUR THINGS IT CLAIMS TO DO

1. Five panels grey every control the server refuses — join codes, the confirm queue, the
   roster's Remove, the staff list, the gym's details — each with the server's own sentence.
2. §4.2's "trial expired → grace" banner, which :21580 recorded as unbuildable.
3. The confirm queue says nobody can be let in until the gym is on a plan (:23928's Low-5).
4. `isRetryable` stops offering "Try again" on two permanent 409s (:23928's Low-6).

## WHERE I WOULD LOOK HARDEST — my own uncertainties, not a defence

- **`consoleIsReadOnly` is `=== true` and nothing else.** `null` means "we could not ask"
  (an older api, a plain member) and must grey out NOTHING. Check every consumer honours
  that, and that nothing derives the lock from `subscription === null` instead.
- **The banner is ranked FIRST in `bannerFor`.** I argue it cannot collide with the four
  states below it because the server computes this field and `subscription` off one lateral.
  **If that argument is wrong, a trialling gym's banner is silently swallowed.**
- **GREYED, NEVER HIDDEN.** The no-removal rule at the level of one control. If anything in
  this diff makes a control DISAPPEAR on a lapsed gym rather than go grey, that is a finding.
- **The copy must be true of BOTH ways a gym arrives here** — trial ended, and never
  subscribed. I rejected §4.2's own "Trial ended — members have moved to the free tier"
  for that reason. Check every sentence against the second case.
- **The queue's copy deliberately STOPS SHORT.** Kd ruled that a lapsed gym should HOLD a
  waiting person's request and tell them so — that is the NEXT card, and until it ships the
  request still dies after 14 days. Two tests assert the reassurance is ABSENT. **If any
  sentence in this diff implies the waiting people keep their place, that is :5807's class.**
- **`GymDetailsPanel` is a `<form>`**, so ENTER submits it past the greyed button. The guard
  is in `save()`. Mutant C116 survived the first run against a test that only checked the
  button — check I have not left a similar door open elsewhere.
- **`isRetryable` is listed by CODE, not by status.** A blanket "409 is permanent" would take
  the retry away from every race on this module. Check the offline case still gets its button.
- **`PrivilegesControl` now holds TWO locks** — the owner's row (permanent) and the gym's
  read-only state (temporary). I renamed the existing local to `ownerRow`. Check nothing
  conflated them, in either direction.

## WHAT I ALREADY FOUND AND FIXED — do not re-report unless my fix is wrong

- A test of mine that **passed for the wrong reason**: it took the OWNER's staff row, whose
  ticks are read-only for an unrelated reason, and stayed green with the new prop deleted.
  Both tick-box cases are now scoped to the TRAINER's row.
- **C116 survived twice** — first no observer (the "cannot be saved" case only asserted the
  BUTTON), then the mutant's own FILTER still named the old test.
- **Seven mutant anchors drifted**, none in this diff's own subject: C20/S16, S15/C81/C82,
  S22, C78. All re-aimed at the same call sites and re-measured RED.

## PROVE, so you can challenge the figures rather than re-run them

Web suite **1365/1365 across 50 files** (+38, and no existing test moved) · eslint
`--max-warnings=0` exit 0 on thirteen files · `vite build` exit 0 · **whole-table mutation
sweep of 139: 138 RED, 1 ALIVE, 0 never ran**, 135 controls green first, restores
sha256-verified. **The one ALIVE is C68, which is NOT this card's** — `ConsoleStates.jsx`,
found by :23257 §9, product-correct, own ⚪ OWED line, fix deliberately not taken (R1.1).

**THE BROWSER SMOKE RAN AND PASSED, AND IT FOUND A DEFECT IN THE SHEET RATHER THAN IN THE
CODE — which you should treat as a gap in my evidence, not as reassurance.**

Kd confirmed at the screen, as a MANAGER on a gym whose trial the sweep had just ended:
the red strip on every console screen with no button in it · the join-code controls greyed
with the sentence · **the code still visible and Copy still working** · the roster intact
with Remove greyed · and the confirm queue saying *"Nobody can be let in until this gym is
on a plan."* with both taps greyed. The time-jump was mine to run: `expired: 1`, matching a
count read out of the database BEFORE the run, with a second null-dated trial correctly
untouched.

**TWO THINGS THE BROWSER COULD NOT DO, AND THE SECOND IS A REAL LIMIT ON THIS PACKET:**

1. **My sheet's steps 12–14 were written for a journey the product does not draw.** A
   MANAGER has no Settings tab by default — `ROLE_PRIVILEGES.manager` holds neither
   `org.manage` nor `staff.manage` — so the sheet asked Kd to test a screen he could not
   reach. He found it. Gym details is reachable only after an owner ticks `org.manage`
   across.
2. **THE STAFF PANEL'S READ-ONLY STATE IS UNREACHABLE IN A BROWSER TODAY.** `staff.manage`
   is in `OWNER_ONLY_PRIVILEGES`, so a manager can never hold it; and the owner — who can —
   meets the unskippable plan prompt over the whole console. **So no human can currently see
   the greyed staff list.** It is covered by tests and by mutant C117 only. If you think that
   makes any claim in this diff unearned, say so.

## THE DIFF

`t3-read-only-console-web-r1.diff` at the repo root (includes the two new files).
