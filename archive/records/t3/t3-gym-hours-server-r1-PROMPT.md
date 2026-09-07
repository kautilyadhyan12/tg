# T3 · ROUND 1 — opening hours, SERVER HALF

Paste everything below into a **fresh chat**, and attach `t3-gym-hours-server-r1.diff`.

---

You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11 and DECISIONS :26624, :26684, :26736 (the three rulings it implements) and
:26812 (the card record). Output only: (1) violations as rule# · file:line ·
one-line fix; (2) a security pass — authn/authz/tenancy, input parsing,
idempotency, secrets/log leaks, SQL safety; (3) anything that would fail the
phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS :5348). Critical/High = security, data loss, privacy, money, a broken
core flow — **plus :5807: anything a user could SEE that is FALSE, or that blocks
them from finishing something.** Low = spelling, comments, naming, style.
Justify a Critical/High tag by naming the concrete failure. Zero Critical/High ⇒
the packet SHIPS. A Low finding buys no further round — but it is STILL FIXED and
logged in `BACKLOG.md`; report it at full severity, never soften it to duck a
round.

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix carries a test that fails without it (rule 3). If Criticals appear in the
SAME subsystem two rounds running, say so and STOP — that is Kd's redesign
trigger, not a cue for another patch.

## WHAT THIS CARD IS

A gym declares when it is open. Three states, and the third is the whole point:
`unset` (nobody has answered — members are told NOTHING), `open_24h` (a flag, not
a fake 00:00–23:59 row), `scheduled` (the `gym_hours` rows are the answer, and
only THEN does a weekday with no rows mean closed). Plus dated one-off closures
with an optional note.

**SERVER HALF ONLY. No screen exists**, so a finding of the form "no UI shows
this" is the next card, not a defect here.

## WHERE TO LOOK HARDEST — the five risks the card named before it was built

1. **The `unset` trap is the whole card's failure mode.** Every reader must
   branch on `mode` before drawing a word. A gym that never filled the form in
   and a gym genuinely shut every day have identical ROWS. Printing "Closed" for
   the first is :5807 Critical/High and would hit every one of the 112 existing
   gyms.
2. **The weekday convention.** ISO (1 = Monday … 7 = Sunday) on the wire and in
   the database, matching Postgres `ISODOW`; JS `getDay()` is 0 = Sunday. One
   conversion, in the client, or a gym closes on the wrong day.
3. **The gym's "today".** Closures are filtered against
   `(now() AT TIME ZONE g.timezone)::date`, never the server's clock and never
   the browser's (trap #8).
4. **Overlap validation is new** and its touching boundary (10:00–12:00 beside
   12:00–14:00 is LEGAL) is easy to get backwards.
5. **`0017` is hand-written**, so the snapshot debt grows by one. It has its own
   `OWED.md` line; this card does not fix it and must not claim to.

## THINGS THE CARD DECIDED — dispute them as findings if they are wrong, but they are deliberate

- **PUT replaces the whole week**, rather than per-session CRUD: overlap is a
  property of a whole day, and two half-applied requests must not leave a gym
  advertising a timetable no human chose.
- **Sessions never wrap past midnight.** 22:00–02:00 is two rows. `closes_minute`
  may be 1440 (midnight at the end of the day); `opens_minute` may not.
- **`unset` is not settable** — a gym that has answered cannot un-answer.
- **`gym_closures` has no `removed_at`**, a declared R4.3 exception: a statement
  about one day expires by itself and un-closing is a correction, with
  `audit_log` recording both ends.
- **Deleting a closure that never existed answers `removed`**, not 404 — the word
  names the STATE (`removeOrgMember`'s convention).
- **No session name and no capacity column.** Names were struck by Kd (:26684 §1)
  and capacity belongs to the booking card.

## WHAT THE PREVIOUS PASS ALREADY FOUND, so you do not re-find it

The mutation sweep ran 12 mutants and the FIRST run left two alive — **both
defects in the TESTS, both since fixed**, and they are recorded at :26812 §2:

- a lone UTC+14 timezone fixture agrees with a bare `now()` for fourteen hours of
  every day, so the zone mutant survived. Fixed with a **UTC+14 and UTC-12 pair**
  whose calendar dates can never both equal the server's.
- a mutant deleting the overlap **sort** was aimed at a test named "…out of
  order" which rejects its input either way. Re-aimed at the ACCEPTING case (a
  valid week sent out of order must be accepted).

**Look for more of that shape** — a test whose NAME restates a guarantee it does
not actually observe — rather than re-reporting these two.

## PROVE ALREADY RUN (all LOCAL, `localhost:5433`, on the committed bytes)

`orgs.hours` 32/32 · `orgs.routes` 147/147 · `db.migration` 13/13 ·
`orgs.unit`+`orgs.plans`+`orgs.sweep`+`orgs.trialSweep`+`orgs.archiveSweep`
82/82 · shared 51/51 · web 1385/1385 unchanged · api+shared `tsc` exit 0 ·
api+shared `lint` exit 0 · `check-harnesses` 25 scripts parse ·
**sweep: a stated subset of 193 — 12 mutants, 12 RED, 0 ALIVE, 0 never ran**,
restore byte-exact after every mutant.

Treat every figure above as a CLAIM, not evidence (V1). Re-run anything you mean
to rely on.
