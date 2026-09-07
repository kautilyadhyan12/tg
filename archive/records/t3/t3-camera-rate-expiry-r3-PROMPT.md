# T3 · ROUND 3 (RE-REVIEW) — the camera-rate DECAY fix

Open a **FRESH chat** in this folder and paste everything below the line.

---

You are reviewing, not fixing. Audit this fix strictly against CLAUDE.md Part II
R0–R11 and Part 6 §3.6 / §3.3.

**THIS IS A RE-REVIEW (CLAUDE.md Part I §2.5 rule 2): cover ONLY round 2's fix
and the surfaces it touches. Do not re-review the card.** Rounds 1 and 2 covered
it; their findings are at `DECISIONS.md:9243` and `:9509`.

## Ground yourself first

`CLAUDE.md` in full · `DECISIONS-INDEX.md` in full plus §1/§2 in the
`DECISIONS.md` ORIGINAL · then these entries by line: **:9509** (round 2 and this
fix — read it whole), **:9243** (round 1), **:9003** (Kd's ruling on the row's
format and why the §3.6 ladder cannot be built), **:5807** (what makes a finding
Critical/High), **:5348** (the review process and the escape hatch), **:9328**
(the smoke, passed 5/5). Also `BACKLOG.md`'s last two entries.

## Why this round exists, and the ruling you are working under

Round 2 found the meter holding its pre-stop value for 2.0 s — the same class as
round 1's five-minute freeze. **Two consecutive rounds, Criticals in the same
function, so the escape hatch fired and it went to Kd. HE RULED PATCH**, on the
argument that the one-line change is the shape correction rather than a third
patch: round 1 fixed *which* frames count, round 2 fixes *what they are divided
by*, and `now` now governs both ends of the measurement.

**You may disagree with that reasoning — say so if you do.** What you may not do
is re-open the patch-vs-redesign decision as if it were unmade; it is Kd's, and
it is recorded.

## Exactly what changed — four files, and no mechanical diff exists

**Be aware of a limitation, and treat it as a reason to read the files rather
than trust this list**: the whole card is uncommitted, and **no baseline copy was
taken before this fix round was edited**, so `git diff` on these files shows the
CARD plus the fix, not the fix alone. (Round 2's own diff is at the repo root as
`t3-camera-rate-expiry-r2.diff` and shows what the previous round saw.) Recorded
as a process lesson; the change set below is small enough to verify by reading.

**1. `apps/web/src/engine/poseThroughput.js` — the only source change.**
- `hz()`: `const span = t[t.length - 1] - t[first];` → **`const span = now - t[first];`**
- Two comment blocks rewritten: the "computed from the SPAN BETWEEN the first and
  last frame" rationale (now false as written) and an added note that two rounds
  found the same mistake at two different ends of the measurement.

**2. `apps/web/src/engine/poseThroughput.test.js`**
- NEW: *"DECAYS as the silence grows…"* — the regression test. Reads at 500 /
  1000 / 1500 / 1990 ms of silence; each must be non-null, strictly lower than
  the one before, and within 0.5 of the trailing rate **computed by counting the
  fixture's own timestamps**, never by calling the module (:3610).
- NEW: *"blanks when the window runs out of frames, not two seconds early"* —
  closes the coverage gap round 2 named (the blank was pinned at +500 ms and
  +3001 ms, so any point between them passed).
- CHANGED: the mid-gap control no longer pins `toBeCloseTo(1000 / 67, 1)`; it
  asserts the reading is > 14 **and strictly below the reading taken at the last
  frame**.

**3. `apps/web/src/hooks/usePoseDetection.test.js` — four assertions.**
Three loosened from ±0.05 to ±0.5 **with the reason stated in each**, one
(the mid-gap control) replaced by `> 14` and `< 1000/67`, and the ceiling test
gains `toBeLessThanOrEqual(MAX_FEED_HZ)`.

**4. `apps/web/src/pages/activeWorkout.render.test.jsx`**
- NEW: *"RE-READS the meter on every repaint…"* — round 2's Low-1. Changes what
  the meter answers, advances the page's own once-a-second repaint, and asserts
  the row follows, that the OLD figure is gone, and that a later null reaches the
  screen as the dash.

## What to attack hardest

- **Is `now - t[first]` right, or merely different?** It changes what the number
  MEANS. Check the boundary behaviour: startup, a single frame, a resumed set
  after `reset()`, and whether `MIN_SPAN_MS` still closes the trap it was written
  for (two frames 1 ms apart).
- **A visible number moved.** A perfect machine now reads ~14.6 against a ceiling
  printed as 14.9, and the row decays toward zero before blanking. Is that
  reading TRUE at every point on the way down, or is there a regime where it
  understates badly? **If it can ever exceed the ceiling it is shown against,
  that is Critical/High** (:5807) — `12.0 of 14.9/s` stops being coherent.
- **Three tolerances were widened.** Part 0 rule 3 forbids widening a tolerance
  to turn a red green. Each is claimed to be a property change rather than a
  loosening. **Check that claim on each one**, and say so if any is just slack.
- **The new tests: do they fail for the right reason?** Two of them are claimed
  to go RED under the defect specifically because the defect makes two numbers
  identical. Verify rather than accept (:4718 F2 — a mutant red for the wrong
  reason certifies the wrong assertion).

## Rules 3 and 4 — re-derive, do not take these on trust

Five mutants were run, backup and restore **by file copy with sha256** (never
`git checkout` — that cost a reviewer an uncommitted edit in round 1):

| mutant | claimed |
|---|---|
| the exact defect: span ends at the last frame | RED — 4 failed / 41 |
| round 1's defect: the expiry deleted | RED — 4 failed / 41 |
| missing clock falls back to the newest frame | RED — 1 failed / 18 |
| the hook's reader stops passing the clock | RED — 5 failed / 21 |
| the PAGE caches the last reading (Low-1's mutant) | RED — 1 failed / 43 |

**And the sweep's FIRST run reported all five `*** ALIVE ***` on an empty summary
line** — it grepped for the summary before stripping ANSI colour. It was
class-fixed twice (a missing summary is now FATAL; an unmutated control must
report green through the same path first) and re-run. **That is the sixth
unearned harness verdict in this project. Assume the harness is the weakest part
of this round and probe it accordingly.** The script is in the session
scratchpad, not the repo — say so if you think that is wrong.

Also report, per rule 4: any test in these four files that stays GREEN when the
thing it claims to check is broken.

## Output

Only: (1) violations as rule# · file:line · one-line fix; (2) a security pass;
(3) anything that would fail the phase's Done gate.

**TAG EVERY FINDING Critical/High or Low** (Part I §2.5, :5348, :5807). Zero
Critical/High ⇒ **the packet SHIPS** and the card can finally close — its smoke
is already passed 5/5. A Low buys no further round but is still fixed and logged
in `BACKLOG.md`; report it at full severity, never softened to duck a round.

**If you find a Critical/High in `PoseThroughput` again, that is THREE rounds in
one function — say so loudly and STOP. Do not propose a fix.** Kd has already
ruled patch once on this hatch; a third occurrence is his to rule on again, with
the redesign genuinely on the table.

## State when this was written — 2026-08-17

Branch `web-repoint`, **nothing committed**. web **693/693** (31 files) ·
`vite build` ✓ · the four changed files `eslint` clean · `apps/api` and
`packages/*` untouched · the four files are uniformly CRLF.
