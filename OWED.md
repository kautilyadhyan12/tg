# OWED — the single list of everything outstanding

**Why this file exists.** DECISIONS.md is a diary: it records *what was decided
and why*, in the order it happened. It is excellent for "why is this like this?"
and useless for "what is still to do?" — 580 lines of prose where a deferral
recorded on day 3 is indistinguishable from one recorded yesterday.
RUNBOOK/cutover.md tracks only what BLOCKS the P2.8 cutover, so anything that
does not block it had no home at all. An audit on 2026-07-21 found two real
items owed and tracked NOWHERE (Google login; timezone capture) — one of them a
user-facing feature that had been switched off, which the CLAUDE.md
MIGRATION-STANCE no-removal rule exists specifically to prevent.

**How to use it.** Every entry says what it is, why it was deferred, who ruled
it, what unblocks it, and what it blocks. Nothing leaves this file except by
being DONE (tick it, date it, name the commit) or by an explicit Kd ruling that
it will never be built (strike it, cite the ruling — the desktop-webcam
precedent, DECISIONS 2026-07-19).

**How to keep it true.** Any card that defers something adds its line HERE in
the same commit that records the deferral in DECISIONS. A deferral recorded in
prose only is the exact failure this file was built to stop.

**THIS FILE IS UNCHANGED by the 2026-08-06 review/fix ruling (DECISIONS :5348) —
Kd said so in as many words: "owed will be there as usual, no change."** Every
deferral still gets its line here, in the same commit that defers it. `BACKLOG.md`
is a LOG of Low review findings and the commits that fixed them, not a second
deferral list — a Low finding that genuinely cannot be fixed in its round has
become a deferral and belongs HERE like anything else.

Legend: 🔴 blocks the P2.8 cutover · 🟡 needed before real users · ⚪ improvement
· ⏰ has a real-world deadline

---

## ⏰ Deadline-driven — do these on the clock, not on the queue

- [x] 🔴 **THE "I'M HERE" BUTTON IS STILL SHOWN OUTSIDE OPENING HOURS — KD'S
      RULING IS ONLY HALF BUILT. DONE 2026-09-03**, commits `a1c5005` (the
      gate), `dba7cbe` (the timetable the smoke destroyed on its way through),
      `cfca936` + `00c2699` (the T3 round and its six Low fixes). **All three
      gates met: PROVE · Kd's browser · T3 round 1 with ZERO Critical/High**
      (`:31352`, `:31508`, `:31633`, `:31710`).
      **THE LAST STEP RAN 2026-09-03 AND IT IS THE ONE THAT HAD NEVER BEEN
      SEEN:** a closure dated today, and the card reads *"Your gym is closed
      today, so attendance isn't open."* rather than *"isn't open right now"* —
      the two refusals told apart on screen, which is the branch order (:26684
      §3, a dated closure beats the pattern) observed rather than merely
      mutated.
      **THE SCOPE CLAIM, MADE EXPLICITLY BECAUSE ONE STEP IS STANDING IN FOR A
      SHEET** (:27810, :25707): steps 1–5 ran on `a1c5005`, 6a–6d on `dba7cbe`,
      this one on `00c2699`. **The only non-test `apps/web/src` file to change
      across that span is `hoursView.js`** (`git diff --name-only`), whose
      `hoursDraft` drives the console FORM and is not reached by `GymHoursNote`
      or `AttendancePanel` at all — and the console screen it does drive was
      re-observed afterwards by 6b/6c. **The T3 fix round changed no web source
      whatsoever**, only tests and two server files (an audit column and a
      comment), neither of which reaches a screen. So every ✅ was observed on
      bytes that differ from `HEAD` only where they cannot touch it.
      ~~**THE CODE IS BUILT AND THE LINE DOES NOT TICK: no browser smoke has
      run and T3 is UNRUN.**~~ The button is now greyed with a true sentence
      whenever the gym is shut, it comes back to life at opening time without a
      reload, and every state the screen cannot decide leaves it PRESSABLE so
      the server keeps the last word (:24141 §3a). `web` 1697/1697; mutants
      C180–C186, 7 RED.
      **SMOKED 2026-09-03 AND IT DOES NOT TICK — steps 1–5 PASS at Kd's browser
      (`:31633`): the button faded at Thursday 05:17 Mendoza against a 07:40
      opening, which is his own complaint reproduced and refused, with the
      opening times beside it and his "Pressing this marks your attendance"
      line. **THE CLOSED-DAY REFUSAL WAS NEVER SEEN** — the only step covering it
      was abandoned mid-way when he lost his timetable, and its replacement had a
      different subject (`:23535`'s rule: an operator's "all passed" covers what
      they did). ~~**What is left: that one closure step, then a fresh chat runs
      T3 round 1**~~ — **BOTH DONE the same day: T3 at `:31710` (zero
      Critical/High) and the closure step at the top of this line. Left in place
      rather than deleted because naming the gap is what got it run.**
      Found by him at his own browser 2026-09-03:
      *"i set owner gym times to 7 am to 8 am but now it is 5:28 but the i am
      here button was still there which i told you to disable if it does not
      incline with the gym time"*. **The SERVER refuses correctly** (`:30867`,
      mutants O241/O242) — **the SCREEN was never touched**, so a member taps a
      live-looking button and is answered with a 409. His words were *"should
      not be able to press i am here"*, and being refused after pressing is not
      that.
      ~~Check whether `/v1/orgs/mine` carries enough to decide it without a
      second read.~~ **ANSWERED: IT DOES NOT** — that response carries
      `manualAttendanceEnabled` and nothing about hours, deliberately
      (`orgsApi.js`: a week of sessions plus a closure list per gym belongs to
      the screen that asks for them). The card reads `GET /hours`, which
      `gymHoursSchema`'s own header calls *"one reader for the console and for
      the member's gym card"*.
      ~~and say when the gym opens — the same sentence the server already
      produces~~ — **DELIBERATELY NOT DONE, and `:31352` §3 is the reasoning**:
      the server's sentence spells today's windows in 24-hour because a 409
      arrives with no context, while `GymHoursNote` already draws those times
      two lines above the button ON THE GYM'S OWN CLOCK. Repeating them would be
      a second, and wrong, spelling of one minute.
      **🔴 because a user-facing control lies about what it will do.**

- [x] 🟡 **THE MEMBER'S "DAYS YOU CAME" LIST GROWS WITHOUT BOUND, AND KD RULED A
      CALENDAR WITH FIRE ON THE DAYS ATTENDED — DONE 2026-09-04**, on the commit
      carrying DECISIONS `:32783` (T3 round 3, diff-only, ZERO Critical/High ⇒
      the packet ships, :5348 rule 1). Raised 2026-09-03, DECISIONS
      `:31508`. His words at his own browser: *"a user might cam 7 days a week
      that way the records on this section will also become very long and
      overwhelming so need better design ... i think a calander with dates when
      you went to gym is good and a day with attandance will have a fire effect"*
      — and *"do all four"* on a plan that recommended it. **A month grid is a
      fixed height however often somebody comes, which is the actual problem**,
      and `components/progress/WorkoutCalendar.jsx` is the same shape already
      shipped (month arrows, a day that opens, and it already imports `Flame`).
      🔥 already means a STREAK in this product (:27900), so the symbol reads
      correctly rather than being invented.
      ~~**IT CANNOT BE BUILT ON TODAY'S SERVER AND THAT IS THIS LINE'S
      FINDING:** `attendanceHistoryQuerySchema` takes `userId` and `cursor` and
      **nothing else** (`apps/api/src/modules/orgs/schemas.ts`), so no screen can
      ask for "September" — only for "the most recent visits", paged
      backwards.~~ **THE SERVER HALF SHIPPED 2026-09-03 (DECISIONS `:31921`) AND
      THIS BLOCKER IS SPENT.** `?from=`/`?to=` are live on
      `GET /v1/orgs/:gymId/attendance/history`, half-open so months tile, in GYM
      DAYS rather than :4434's instants — the reasoning is on the schema and a
      chat that "corrects" it to instants re-introduces the defect it thinks it
      is fixing. ~~**What remains on this line is the SCREEN**: the month grid,
      the arrows, and 🔥 on the days attended. No web file has moved.~~
      **THE SCREEN IS BUILT TOO, 2026-09-03 (DECISIONS `:32197`)** — the month
      grid with 🔥 on every day attended, arrows that step months, and the times
      behind a tap on the day, which is the cost stated below and accepted.
      **KD LOOKED AT IT THE SAME DAY AND SENT IT BACK** (`:32395`): the month
      filled the page and the flame was a 10px hairline. It now **folds away
      behind a calendar icon**, is capped compact when opened, and the fire
      **fills the square with the date inside it in white** — his three words.
      Steps 1–3 of `RUNBOOK/smoke-my-gyms-calendar.md` are ticked with *"excellent
      everything good"* beside them.
      **THE SMOKE GATE IS DISCHARGED ON HIS DECLARATION** (`:32498`, on
      :27415's precedent): *"the smoke passed"* and *"lets just say pass"*.
      **3 steps OBSERVED, 9 DECLARED, 1 STRUCK** — and the struck one is his own
      finding, that stopping the api sends you to the login page before any
      screen draws (its own line below).
      ~~**THE LINE STILL DOES NOT TICK: T3 IS UNRUN**, and that is now the only
      gate left on it.~~ ~~**T3 ROUND 2 RAN 2026-09-04 (DECISIONS `:32583`) AND
      FOUND TWO Critical/High, SO THE LINE STILL DOES NOT TICK** — both fixed in
      that commit, and **round 3 is diff-only** (:5348 rule 2), which is now the
      only gate left.~~ **ROUND 3 RAN 2026-09-04 (DECISIONS `:32783`), DIFF-ONLY,
      AND FOUND ZERO Critical/High — SO THE LINE TICKS.** Its three Low are fixed
      in the same commit and logged in `BACKLOG.md`. **What is NOT claimed is
      that the declared steps were watched** — nine of them were not, and the
      phone width in particular has no test behind it either, jsdom having no
      layout. **THE TICK RESTS ON TESTS AND NOT ON A BROWSER for the round-2 and
      round-3 fixes specifically**, on `:32583` §6's stated reason: both round-2
      defects need a hundred rows to reach, which no account in Kd's browser has.
      **WHAT ROUND 2 FOUND, because it is what round 3 must confirm is gone:**
      both readers of `gym_attendance` decided *"there is another page"* from a
      page being FULL, so a month holding exactly one page told the member *"some
      days may be missing"* over a grid where every day was drawn — and the same
      shortcut on the OWNER's day list drew a *Show more people* button that
      added nobody and told a name search to *"load the rest"* when the rest were
      already loaded. **The second one the review had CLEARED as harmless**, and
      it is the easier of the two to reach: a hundred people through the door is
      an ordinary Monday. Also closed: `:32197` §6's own stated gap (nothing
      asserted the panel greys future days by the GYM's clock) and **the fire
      itself had no test — two were named after it and both passed with it
      deleted.**
      **ROUND 3 CONFIRMED ALL OF THAT GONE** (`:32783` §5) — the served page is
      still exactly `limit` in both readers, the day list's cursor is still the
      last person OF THE PAGE, and neither `WHERE` was widened — **and found the
      fire's own test still one claim short**: it is named *"readable INSIDE the
      fire"* and nothing observed the "inside". Fixed with two mutants, `C209`
      and `C210`.
      **Cost stated to Kd before he chose:** a square in a grid cannot show that
      somebody came at 5:01 PM *and* 3:32 AM, so the times move behind a tap on
      the day — the same place the workout calendar puts them.

- [ ] ⚪ **A BARE `--` SILENTLY DEFEATS FILE SCOPING ON
      `pnpm --filter api test:local`** (2026-09-04, DECISIONS `:32583`'s round
      log). Passing a test file behind `--` sends the `--` through as an argument
      and the filter is ignored — **the whole 776-test suite ran when two tests
      were wanted**, about four and a half minutes instead of fifteen seconds.
      Without the `--` the scoping works, so this is a footgun rather than a
      breakage. **Why it matters beyond the wait:** a chat that does not notice
      believes it scoped a run, which is the family :26220 names (*"believing a
      `-t` filtered run about a test you have just written"*), and a sweep is
      exactly a scoped run repeated once per mutant. **The fix is in
      `apps/api/scripts/test-local.mjs`**: either drop a leading `--` from the
      forwarded arguments or refuse it by name. Not fixed on the card that found
      it (R1.1) — it is nowhere near the calendar packet's diff.

- [ ] 🟡 **THE DASHBOARD'S GYM GREETING AND THE HOURS FOLD ARE BUILT AND
      NEITHER HAS BEEN SEEN IN A BROWSER OR REVIEWED** (2026-09-04, DECISIONS
      `:32929` and `:33091`). Kd took the *"You're a member of xyz"* card off the
      dashboard at his own browser — *"its really looking bad in the dashboard
      and completely destroying the user experience it should have been in my
      gym as gym related things should be there very bad very bad"* — and the
      gym now arrives as **"Welcome to <gym>"** in the greeting, with the whole
      timetable on `My Gyms`.
      **THE CODE IS DONE. WHAT IS OWED IS THE TWO GATES:**
      ~~**`RUNBOOK/smoke-dashboard-gym-greeting.md`** (7 steps) and
      **`RUNBOOK/smoke-gym-hours-fold.md`** (5 steps) are both WRITTEN AND
      UNRUN, and~~ **THE GREETING SHEET IS DISCHARGED ON KD'S DECLARATION
      2026-09-04** (*"all passed"*, then *"all working"*) — :27415's and
      :32498's precedent, recorded as a DECLARATION and never as a watched run.
      **T3 is UNRUN on both cards and is now the only gate left** — the fold
      sits underneath the greeting card and a review of one without the other
      would cover half a screen.
      **TWO THINGS THE DECLARATION DOES NOT COVER, named rather than absorbed:**
      **(a) NOBODY HAS SEEN THE "Welcome to <gym>" LINE.** Kd is a member of TWO
      gyms, so it is correctly absent for him — and the sheet's own steps 1 and 3
      asked him to confirm it present AND absent, which is :32498's *"a step
      whose ✅ cannot be reached invites a tick for something nobody saw"*
      arriving one card later. Step 3 is STRUCK on the sheet with that reasoning.
      The line is held by mutant `P6` and by the one-gym render case.
      **(b) THE FOLD WAS SEEN AND NOT OPERATED.** The greeting sheet names it as
      present; nothing asked him to tap it SHUT, which is `:31295`'s whole
      subject. `smoke-gym-hours-fold.md` stays UNRUN and its status block says
      exactly this; the closing direction is held by `C212`.
      **WHY IT IS 🟡 AND NOT ⚪:** this is the FIRST screen of the app, the
      change is one he asked for after looking at it, and the thing he objected
      to is a thing no test in this repo can judge — jsdom has no layout, so
      *"it looks disgusting"* is outside what 1,745 green tests can answer
      (`:32395`, the fourth time a defect on these surfaces reached him rather
      than a test).
      **WHAT IS NOT AT RISK, so a later chat does not re-litigate it:** nothing
      was deleted. The membership row still draws on `My Gyms` and on Settings →
      Gym, and the dashboard KEEPS the three rows a member can see nowhere else
      — waiting (with **Remind them**), removed (`:12660`, his own ruling that
      a removed member must be told), and refused/expired. Those three were put
      to him before a line was written and he answered *"go"*.

- [ ] ⚪ **THE MEMBER'S GYM CARD DRAWS ALL SEVEN WEEKDAYS AT ONCE, AND KD ASKED
      FOR IT TO FOLD** (2026-09-03, DECISIONS `:31508`): *"should have a drop
      down type of effect whenver click or hover in them"*, part of *"do all
      four"*. ~~Today `GymHoursNote` prints today's line PLUS a Mon–Sun list on
      every card, on the dashboard and on `My Gyms` — his screenshot is seven
      rows tall before the attendance section starts.~~ **What it needs:** the
      headline (`Today: 7:40 AM – 9:40 AM`) stays and the week folds behind it.
      **ON TAP, NOT ON HOVER, and the reason is a ruling rather than taste:**
      hover does not exist on a phone, and :26586 is Kd's own *"members are not
      going to use the web"* — the phone is where this screen actually gets
      read. `ConsoleSection`'s `defaultOpen` is the console's answer to the same
      problem (:31295) and is the pattern to follow, not `forceOpen`.
      **THE CODE IS BUILT, 2026-09-04 (DECISIONS `:32929`) — AND THE LINE DOES
      NOT TICK: NO SMOKE HAS RUN AND T3 IS UNRUN.** The week is behind a *This
      week* row on both screens, the headline is outside it in both states,
      closing is what the tests assert (`:31295`'s standing rule), and a 24-hour
      gym is offered no control at all. `web` 1745/1745; mutants **C211–C214**
      plus the six existing `hoursnote` rows re-run, 10 RED.
      **WHAT THE CARD FOUND, because it is a hazard for the next fold rather
      than for this one:** three existing cases proving the dated closure wins
      *anywhere* on the card, and the `savedWeek` guard whose whole evidence was
      *"no weekday is on screen"* (`C190`), would all have been satisfied by a
      shut control. **When a section learns to fold, every absence assertion that
      could see into it inherits a second way to pass.**
      **`RUNBOOK/smoke-gym-hours-fold.md` is written and UNRUN** (5 steps), and
      `smoke-opening-hours.md`'s steps 22 and 22b were rewritten for the fold in
      the same commit and have **not** been re-run either — their 2026-09-01
      declaration is older than the edit and that sheet now says so.
      **T3 IS NO LONGER UNRUN AND THE LINE STILL DOES NOT TICK — TWO ROUNDS, EACH
      WITH ONE Critical/High** (`:33334`, `:33499`), so neither shipped the packet
      (`:5348` rule 1). **Round 2's finding widens what is owed here: a THIRD
      sheet, `smoke-attendance.md`, had four ✅ naming content behind this card's
      own fold and the `Days you came` calendar** — all corrected, none re-run.
      A permanent guard now holds the class on the root lint
      (`tools/check-smoke-folds.mjs`), and it is measured at 2 of those 4, which
      its own header states.
      **ROUND 3 (2026-09-04) FOUND TWO MORE Critical/High AND KD RULED PATCH,
      NOT REDESIGN**, the escape hatch having armed on `smoke-attendance.md`
      twice running (`:5348`; the hatch ARMS, Kd rules — `:14493`). Both were
      sheets again, neither in the app: round 2's own correction to step 10
      promised *"today's date carries a time beside it"* when the month grid
      draws a flame and a date and no time at all, and
      `smoke-my-gyms-calendar.md` step 5 asked for the month name that step 4
      had just folded away. Both fixed, plus two Low; all four sheets remain
      **UNRUN**.
      **THE GUARD'S REACH IS NOW MEASURED AT 0 OF 2 ON ROUND 3'S FINDINGS** —
      run against those sheets' pre-fix bytes it exits 0. It proves a step opens
      a fold; it cannot prove the ✅ underneath is true (C/H-1), and a per-step
      grep cannot see a step relying on a fold an EARLIER step shut (C/H-2).
      **Both limits are written into the file's own header rather than left to
      be rediscovered, and NEITHER IS FIXED** — closing them needs an instrument
      that reads a ✅ against the component, which is not this patch.
      **A THIRD LIMIT WAS FOUND BY ROUND 4 AND HAS ITS OWN LINE DIRECTLY BELOW,
      deliberately NOT recorded in here** — all three would vanish from this file
      the day this line ticks, which is how the two above are currently held.
      **ROUND 4 (2026-09-04, DECISIONS `:33799`) FOUND ZERO Critical/High, SO THE
      PACKET SHIPS** (`:5348` rule 1) **AND THE T3 HALF OF THIS LINE IS
      SATISFIED.** Four Low, all fixed in that round, none of which bought
      another round. **THE LINE STILL DOES NOT TICK, and the reason is the only
      one left: NONE OF THE FOUR SHEETS HAS BEEN RUN IN ITS CORRECTED FORM.**
      Four rounds, three of them with a Critical/High, every one of those in
      sheet prose and none in the app. **NEXT: Kd at a browser, not another
      review round.**

- [ ] ⚪ **`tools/check-smoke-folds.mjs` HAS THREE MEASURED LIMITS AND NOTHING
      HOLDS ANY OF THEM** (2026-09-04, T3 round 4 — DECISIONS `:33799`; the first
      two were found by round 3, `:33648` §4, and are moved here rather than left
      inside the line above, which will tick).
      **(1) NEW, AND IT IS THE GUARD'S OWN TIGHTENING GOING UNOBSERVED.** Round 3
      windowed `OPERATED` to within `NEAR = 80` of the fold's own control.
      **Measured: setting `NEAR = 100000` restores exactly the pre-round-3 "verb
      anywhere in the step" behaviour and the guard still exits 0 on every
      shipping sheet**, so the ROOT `lint` stays green over the defect that
      window was added to close. **It is NOT vacuous, and the distinction is the
      part to keep: stubbing `operates()` to return `true` DOES go red**, because
      `ABSENT_BY_DESIGN` is shrink-only and `smoke-attendance.md::step 4` stops
      violating. **Total disablement is caught; the window's VALUE is held by
      nothing.** `:18830`'s class exactly — a guard in `tools/*.mjs` whose only
      protection is a comment — and the comment is now in the file's header,
      which is what `:32114` says a warning can never be.
      **(2) and (3), unchanged from `:33648` §4 and still unfixed:** a false ✅
      INSIDE a correctly-operated fold (the guard proves a step opens the fold,
      never that the sentence under it is true), and cross-step fold state (a
      per-step grep cannot see a step relying on a fold an EARLIER step shut).
      **Measured 0 of 2 on round 3's own two Critical/High**, by running the
      guard against those sheets' pre-fix bytes: exit 0.
      **What closes (1):** a fixture for this file — there is no test harness
      covering `tools/*.mjs` today, which is why round 3 could not close it under
      a PATCH ruling and round 4 did not either. **What closes (2) and (3):** an
      instrument that reads a ✅ against the component it describes. **Neither is
      started, and the honest reading of a green run stays "no step introduces a
      fold without naming it", never "every ✅ is true".**

- [ ] 🟡 **`RUNBOOK/smoke-overview-numbers.md` IS STALE AND IS MARKED SO AT THE
      TOP** (2026-09-03). Two of its ✅ name things Kd removed the same day it
      passed — **the dashboard's amber *"outside your opening hours"* box**
      (`:30867` §2.3, deleted with `exceptionsNote`) and **the initials
      circles** (§2.6) — and its chart step predates the *"Your first week"*
      sentence (`:31008` §2). All three grep-verified. **A run today would
      report failures that are not failures**, which is why the banner names
      them rather than leaving them to be found.
      **THE DEEPER PROBLEM IS ITS SHAPE, not those three steps:** every ✅ in
      Part A asserts a LITERAL — `2 people`, `3 visits`, `33%`, `03:32` —
      against a database that is shared, seeded and added to, so they were true
      of one afternoon rather than of the screen (:26012, :25326). **The rewrite
      expresses them as relationships**, the way `smoke-attendance.md` was
      rewritten on 2026-09-03: the big number is PEOPLE, the caption is VISITS,
      and the test is that they DIFFER. Parts B and C are unaffected.

- [ ] ⚪ **`initials()` IN `overviewView.js` HAS NO CALLER AND KEEPS ITS TESTS**
      (2026-09-03, found while rewriting the smoke sheets). Kd had the initials
      circles removed from the console (`:30867` §2.6) and the helper survived
      the removal — grep-verified: nothing under `apps/web/src` imports it
      except its own test file, which still asserts four cases. **That is the
      exact shape `:30867` §2.3 named when `exceptionsNote` was deleted rather
      than left — *"dead surface with test coverage reads as protection and is
      not"*** — and `:31008` §3 records three sibling helpers dying with their
      callers in the same session while this one did not. **Not deleted here
      (R1.1: this session's task was the smoke sheets), and NOT to be deleted
      casually either:** `:31008`'s own slip was deleting the tests of a LIVE
      helper alongside a dead one, caught only by `eslint` noticing an unused
      import. Check callers, then remove the function and its cases together.

- [ ] ⚪ **A MEMBER WITH `/my-gyms` OPEN DOES NOT SEE THEIR GYM CHANGE ITS
      HOURS UNTIL THEY REFRESH** (2026-09-03, T3 round 1 on `:31352`). The hours
      are read once per mount; the 30-second tick moves the CLOCK, not the data.
      **So if an owner cancels today's closure or extends the hours while a
      member is looking at the screen, that member stays greyed out** — refusing
      somebody the server would admit, which is the direction :24141 §3a exists
      to prevent. **NOT graded Critical/High and the reasoning is on record:** it
      needs a concurrent owner edit, it clears on any reload, and the panel's own
      rate-limit constraint forbids polling (both attendance reads share one
      600/hour bucket, :28649). **The review's sharp point, kept because it is
      the argument for fixing this properly:** `:31352` graded the identical user
      outcome — 06:59 still refused at 07:05 — Critical/High when the cause was
      the clock, and the cause being staleness does not change what the member
      meets. The honest fix is the shared per-gym reader on the line below, which
      can re-read on the tick without a second request.

- [ ] ⚪ **EDITING DAYS, SWITCHING TO 24 HOURS AND SAVING DISCARDS THE EDIT**
      (2026-09-03, T3 round 1 on `:31508` — "noted, not graded"). `hoursRequest`
      sends `{ mode: 'open_24h' }` alone, and the server now KEEPS the rows it
      used to delete, so the week that comes back on switching to "Set opening
      times" is the one from before the edit. **NOT a regression — before
      `:31508` they got nothing back at all, so this is newly confusing rather
      than newly lossy** — and it needs a mode switch made mid-edit to reach,
      the day editor being hidden in 24-hour mode. **What it needs:** either the
      form warns that unsaved day edits will not be kept, or `hoursRequest`
      carries the draft week with an `open_24h` save. **The second is the better
      shape and is NOT free**: the request union deliberately refuses
      `open_24h` carrying a week (`setGymHoursRequestSchema`, and a test pins
      it), so it is a contract change and belongs to its own card.

- [ ] ⚪ **`apps/api/test/orgs.hours.test.ts` HAND-WRITES ITS OWN `interface
      Hours`, AND IT WENT STALE THE DAY IT MATTERED** (2026-09-03, T3 round 1's
      L-6 — **and the deferral is mine: it was written into a code comment with
      no line here, in the session that cited the deferral rule twice**).
      `savedWeek` had to be hand-added to that interface or `tsc` failed, while
      **every new assertion passed at runtime** — the suite was green against a
      type that did not know the field. R2.5 says infer types from schemas and
      never hand-write a duplicate interface; it is written about `src`, and a
      test file is where it quietly stops being followed. **What it needs:**
      replace it with `GymHours` from `@app/shared`. Not done in its own round
      because it touches every assertion in the file (R1.1).

- [ ] ⚪ **`/my-gyms` ASKS EACH GYM FOR ITS OPENING HOURS TWICE** (2026-09-03,
      DECISIONS `:31352` §5). `GymHoursNote` reads `GET /hours` to print the
      times and `AttendancePanel` reads it again to decide whether the button
      may be pressed, so one card makes two identical requests. **Harmless
      today** — the route carries no dedicated rate limit and does not touch the
      attendance reads' shared 600/hour bucket — and it is on the same screen
      where :28822 §3 recorded the identical duplicate for `/v1/orgs/mine`, so
      the fix is one card for both: a small per-gym reader the member app shares,
      the way `consoleOrgs.js` is shared for the gym list. **The two
      alternatives rejected in the moment, so nobody re-derives them:** a cache
      that outlives a component, and a second optional shape for a note THREE
      screens already draw — the second can break a screen Kd has smoked.
      **T3 round 1 found the user-visible cost of the duplication, which the
      original line only implied:** the two reads can fail INDEPENDENTLY, so a
      member whose hours-note read drops while the button's succeeds reads *"Your
      gym isn't open right now"* **with no opening times anywhere on the card** —
      and those times are the whole reason that sentence is allowed to name none
      (`:31352` §3). Low by :5807 (the sentence stays TRUE), and the second
      reason this card is worth doing.

- [ ] ⚪ ~~❓ **A MEMBER SEES THEIR GYM'S DAY, NOT THEIR OWN, AND KD READ IT AS A
      BUG.**~~ **NOT A DEFECT — KD CLOSED IT HIMSELF THE SAME EVENING:
      *"i agree my fault"*.** He had set that test gym to Argentina. **The
      behaviour is correct and stays**; what survives is only the small copy
      question in (b) below, on which he has NOT ruled.
      Original report: *"is the timimng wrong it is showing wednesaday but
      it is thrusday"*. **MEASURED, and it is not obviously a defect:** the
      `owner` gym's `timezone` is **`America/Mendoza`**, where it was
      **21:11 on Wednesday** while his own clock read 05:28 Thursday
      (`now()` UTC 2026-09-03 00:11). So the screen is showing the GYM's day,
      which is what every ruling on this product requires (trap #8, :26469 §5).
      ~~**(a) is that gym's timezone simply WRONG**~~ — **ANSWERED: yes, his
      own test gym, his own words. No code was wrong.**
      **(b) STILL OPEN AND HIS TO RULE, worth about one sentence of copy: even
      when the zone is right, a member reading "Wednesday" on their Thursday has
      no way to know why — the screen never says WHOSE CLOCK it is on.** Cheap
      to answer ("times are your gym's own", which the console already says on
      its own attendance screen) and not worth a card by itself; do it beside
      the next member-facing attendance change. **Do NOT "fix" it by switching
      to the reader's zone** — that is the trap this product has kept out of
      every attendance surface, and (a) is the proof it works.

- [ ] 🟡 **THE ATTENDANCE SCREEN'S PEOPLE LIST GROWS WITHOUT BOUND, and Kd asked
      the question that found it** (2026-09-03, DECISIONS `:31098` §3):
      *"Who came today shows two as of now what if there are 2000 3000 the whole
      page will be full?"*. **Measured rather than reassured:** the CHART cannot
      grow (fixed height, always 8 columns) and the DASHBOARD list cannot grow
      (capped at five, with the count coming from the server) — **but the
      console's Attendance screen pages at `ATTENDANCE_PAGE_LIMIT` = 100 and
      *Show more* APPENDS**, so a 3,000-member gym is thirty presses and 3,000
      rows in the DOM. **The collapsible section he asked for helps and does not
      fix it.** What it needs: server-side name search (its own line, from
      :29250 §2) and either windowing or a date/session filter that narrows
      before the rows arrive. Nobody has a gym this size yet; the first one will
      find it on a phone.

- [ ] 🟡 **A GYM THAT FORGETS TO UPDATE ITS OPENING HOURS NOW LOCKS ITS MEMBERS
      OUT, and that is Kd's accepted cost rather than a defect** (2026-09-03,
      DECISIONS `:30867`). His ruling refuses "I'm here" outside a gym's declared
      hours, reversing the chat's call at `:26624` §4.4 whose stated reason was
      exactly this. **Bounded already**: a gym with NO hours set, or on 24-hour,
      is unaffected, and the refusal names the day's real opening times. **What
      does not exist is any way for the GYM to notice** — no alert to an owner
      whose members are being turned away, and no override at the door. Revisit
      when a real gym is on it; the first complaint will be a member standing in
      a gym that changed its timetable and did not say so.

- [x] ⏰🔴 **Groq COACH_MODEL migration — DONE 2026-07-22, merged as PR #44**
      (merge `ad3b1ee`), ahead of the 2026-08-16 decommission of
      `llama-3.1-8b-instant`. Default flipped to `openai/gpt-oss-20b` and the
      model-specific price constants re-quoted from groq.com/pricing per Part 0
      rule 4 ($0.075/1M in, $0.30/1M out → 75_000/300_000 micro-USD); the
      discounted cached-input rate is deliberately unused (never under-count).
      `COACH_MAX_TOKENS` 800→1200 folded in by Kd ruling — the more verbose
      model truncated mid-sentence at the old cap. Fresh-chat T3, live-driven
      against real Groq. A follow-up web commit (`ca4b2cc`) added `remark-gfm`
      because the new model answers with markdown TABLES, which react-markdown
      alone rendered as pipe soup. **The key rotation it was expected to carry
      did NOT happen — its own line below.**

- [ ] 🟡 **Rotate GROQ_API_KEY.** The old key was reused for local dev with
      rotation explicitly DEFERRED, not waived — Kd's reasoning was that the zip
      carrying the old `.env` went only to Claude sessions, and he stated "I will
      rotate it later" (DECISIONS 2026-07-16). The Groq model-migration card was
      named as the natural moment (new key + new model in one visit to the Groq
      console); that card shipped on 2026-07-22 WITHOUT rotating, so the item
      would have vanished with its ticked line. Given its own line here on
      2026-07-22 rather than being lost. The P0 rule treats every secret in the
      old repo's `.env` as burned, so this is a real deferral, not hygiene.
- [x] 🟡 **Rotate the Neon database password (`DATABASE_URL`) — DONE
      2026-07-27 (Kd rotated in the Neon console; verified by query).** Exposed
      2026-07-26: a `grep` for the connection string during the XP-card smoke
      setup matched a neighbouring comment line, and the mangled value — password
      included — was printed into a Claude chat transcript in an error message.
      Same class as the two rotations above, and treated the same way rather than
      waved off because it was accidental. This one is heavier than a provider
      key: it is direct read/write access to the dev database.
      **HOW IT WAS DONE:** Neon console → Roles → `neondb_owner` → Reset
      password. Kd pasted the new value straight into `apps/api/.env` line 5 in
      the editor — deliberately NOT through the chat, since a chat transcript is
      exactly how the old one burned. Verified by connecting with the new URL and
      running `select current_user, current_database()` plus a table count:
      `neondb_owner` / `neondb` / 46 public tables. The API was restarted and
      re-listens on :3000. Grep confirmed `apps/api/.env` was the ONLY file
      holding the real secret — `.github/workflows/ci.yml` takes its URL from the
      `neon-branch` step output, and `infra/docker-compose.dev.yml` carries local
      container credentials (`aihg`/`postgres`), neither of which is this one.
      The dev branch holds only test fixtures, which is why this was 🟡 not 🔴.
- [ ] 🟡 **Rotate the GOOGLE_CLIENT_SECRET.** The secret created for the
      google-login local smoke (2026-07-24) was pasted into a Claude chat to wire
      `apps/api/.env`, so treat it as exposed (same class as GROQ above). Fine for
      local dev; before any real deployment, regenerate it in the Google Cloud
      console (Clients → "AI Home Gym Local" → + Add secret), put the new value in
      the deploy platform's secrets, and delete the old. The client ID is public
      by design; only the secret needs rotating.

## 🔴 Blocks the cutover — the old backend cannot be switched off until these exist

### Camera counting — found by Kd's smoke 2026-08-07, tracked nowhere before

Both lines are 🔴 for one reason and it is stated so a later chat can downgrade
them with a ruling rather than by opinion: **they BLOCK the camera smoke, and that
smoke gates BOTH committed cards on `web-repoint`** (the workout time + kcal v2
card and the camera-ownership ruling), which merges at P2.8. They are product
defects, not missing API surfaces. Full record: DECISIONS :6062.

- [x] 🔴 **DONE 2026-08-11** (`6fd7725` · `cd6c6a7`; T3 round 2 clean, both smoke
      runs recorded in `RUNBOOK/smoke-person-check.md`). **The pose model draws a
      skeleton on FURNITURE, and the app believes it.** Kd, in his own room: *"the camera instead of detecting my body
      sometimes detects other objects nearby like a chair, fan etc and takes its
      shape ... sometimes in taking those shape a correct angle happens then rep
      count happens"*. **Measured cause:** frame validity is 33 landmarks of
      finite numbers (`ingest.ts:44-46`) — **nothing checks the pose is a
      person**; per-landmark gate is `VIS_USABLE = 0.3`; MediaPipe runs at
      `minPoseDetectionConfidence/Presence/Tracking = 0.5` with `person_detected`
      = `landmarks.length > 0` (`usePoseDetection.js:118-120`). **This invents
      reps the user did not do — Critical/High under the :5807 amendment (a
      number on screen that is FALSE).** **UNVERIFIED and the first thing to
      test:** a knee landmark stuck on a chair leg never bends, so the bilateral
      gate (below) would block every REAL rep — the fake dots may be EATING reps,
      not only adding them, which would make this one defect the cause of both of
      Kd's complaints. **No threshold may be picked from judgement**: the card
      must MEASURE what the confidence actually reads on an empty chair versus on
      a person, in Kd's own room, before choosing a cut-off (V1).
      **STATUS 2026-08-08 — MEASURED. Kd recorded all five clips; full numbers
      at DECISIONS :6386. The blocking action is no longer his.** What the
      measurement settled, so no chat re-derives it:
      (a) **THE CHEAP FIX IS DEAD.** A chair reports **0.99** per-frame minimum
      visibility on its four torso landmarks — the same as a person. Legs shift
      but overlap hard (`me_squatting` p25 0.27 sits ON `furniture_only` median
      0.26), so any leg gate that rejects the chair also eats real squat frames.
      **No confidence cut-off separates them, and none was picked.**
      (b) **THE "EATING REPS" HYPOTHESIS ABOVE IS CONFIRMED.** Kd squatted
      steadily for 2 min with furniture in shot: his knee crossed `downAt` (100°)
      **4 times**, against **19** in the clip without furniture where he squatted
      LESS. Furniture in frame does not merely add fake reps — it destroys real
      counting, which makes this line the cause of the shallow-squat line below.
      (c) **An empty room is FINE** — 6.2% detection over the genuinely-empty
      window, vs **95.9% over 82 s** pointed at a chair and fan. The detector is
      not blind; it false-positives on chair-shaped objects and then TRACKS them.
      (d) **The lever is JITTER**, not confidence: the fake skeleton's body
      centre moves ~3× a squatting person and ~7× a standing one. **Its threshold
      is deliberately NOT picked — one chair, one room.** More furniture must be
      recorded, or the distributions go to Kd. This line's "no threshold from
      judgement" rule is UNCHANGED and still binds.
      **STATUS 2026-08-09 — the jitter finding was UNREPRODUCIBLE and now is
      not.** Those figures came from a throwaway script that no longer exists
      (`grep -rniE "jitter|bodyCentre|centroidShift" packages apps tools` →
      only unrelated hits), so the card's headline lever rested on numbers
      nobody could re-derive — :5199's class exactly. `packages/engine/scripts/
      discriminators.ts` is that measurement, committed, unit-tested and
      mutation-audited (11/11 RED), and `measure-pose.ts` grew section 4 (per-
      clip distributions) and section 5 (separation + operating points with the
      error each costs on BOTH sides). **Three deliberate departures from
      :6386's numbers, so they will NOT match and that is not drift:** rates are
      per SECOND not per frame (browser frames arrive irregularly, and the gate
      will too); pairs more than 500 ms apart are SKIPPED (measuring across a
      lost pose measures the gap — `empty_room`'s high figure may be that
      artefact); and body-centre/torso-length are defined in the file because
      the deleted script's definitions are unrecoverable.
      Three signals join jitter, all landmark-only and all free: bone-length
      stretch, left/right limb asymmetry, and motion incoherence (the spread of
      the 33 individual displacements — a real body moves as one piece, and
      centre drift alone can be fooled by someone genuinely moving).
      **NOTHING IS MEASURED YET on real furniture.** Kd runs
      `RUNBOOK/measure-camera-discriminators.md` — one command over the ten
      files already on his Desktop, no recording. **No cut-off may be picked
      from that run either**: it is still one chair in one room. What it can
      settle is whether any signal is worth recording more furniture for.
      **THIS IS NOT A CAMERA-STAGE FIX and the "needs fresh recordings"
      limitation above does not bite it.** That limit is true of anything that
      changes what MediaPipe OUTPUTS (settings, model); a bridge-layer gate
      consumes the landmark output the clips already contain. A later chat must
      not read the limitation so broadly that it shelves the one lever testable
      on data in hand.
      **STATUS 2026-08-10 (b) — THE CUT-OFF IS RULED: `bone_stretch > 0.923`,
      that signal alone (Kd, DECISIONS :7037).** Measured on all 13 clips and
      replayed through the real engine: **11 invented reps → 3, all 66 reps on
      the six clips containing Kd still counted.** `motion_incoherence` is OUT —
      equal separation on paper, loses a real rep in both sessions.
      **"No threshold from judgement" is now SATISFIED for this line, not
      waived.** It does not reach zero and never claimed to; the settings sweep
      stays in reserve. **The line still does NOT tick: nothing is wired.**
      **STATUS 2026-08-10 (d) — THE SMOKE PASSED: ZERO reps from the chair, over
      two minutes, in Kd's own room** (DECISIONS :7222). His own squats still
      counted; both sets stayed camera-graded with real form scores. **The line
      STILL does not tick — T3 is unrun** (:4718 F4). The smoke also surfaced a
      SEPARATE Critical/High that is not this line's: calories bill a mid-set
      absence as vigorous exercise — its own line above.
      **STATUS 2026-08-10 (e) — T3 ROUND 1 RAN AND FOUND TWO CRITICAL/HIGH,
      BOTH FIXED. The line STILL does not tick: the diff-only re-review is
      unrun** (:5348 rule 2). Both were the screen or the number being wrong,
      neither touched Kd's cut-off, and the ruled table came out BETTER on both
      sides. (1) **The panel said "Not counting" while it was counting** — the
      sentence is held for up to fourteen frames after blocking stops so it can
      be read, but counting resumes on the FIRST clean frame, so the count rose
      and the rep beep sounded underneath it; measured on FOUR of the six clips
      containing Kd. There are now two sentences, present tense while blocking
      and past tense after. (2) **The cut-off meant something different on every
      machine.** `bone_stretch` is a rate per second and `FEED_INTERVAL_MS` is
      only a FLOOR — Kd's laptop achieved a pooled median 82.1 ms over 12,075
      pairs, a quicker machine reaches 67 — so the shipped gate read ~1.22×
      higher on faster hardware and, replayed at that cadence, **lost a real rep
      on two of the six clips of Kd**: the exact harm `motion_incoherence` was
      rejected for (:7062), arriving on hardware nobody owns yet. The ruled
      cadence is now part of the ruled configuration (`nominalDtMs: 82`), so the
      verdict is a function of the FRAMES and not the machine.
      **THE RULED TABLE MOVED, IN KD'S FAVOUR ON BOTH SIDES, and he was told:**
      invented reps 11 → **2** (the ruling's table said 3), all **66** of his own
      reps still counted, and person frames silenced **4.5% → 1.8%**. Re-measured
      through the committed instrument at the shipped setting
      (`measure-pose.ts --gate "bone_stretch>0.923" --window 15 --nominal-dt 82`,
      which gained that flag in the same commit — without it the script could no
      longer reproduce what ships). web 585/585 · engine 190/190 · 23 mutants,
      22 RED, 1 ALIVE (PG14, pre-existing, reason recorded), 0 never ran,
      restores sha256-verified. Eight Low findings fixed, logged in `BACKLOG.md`;
      the one deferral has its own line below.
      **STATUS 2026-08-11 (f) — THE LAST BLOCKER IS DISCHARGED AND THIS LINE
      TICKS.** The diff-only re-review named in (e) ran and found **ZERO
      Critical/High**, so the packet ships (:5348 rule 1). Two Low findings, both
      fixed in `6fd7725` and logged as L9/L10 in `BACKLOG.md`, both comment-only:
      the burst fixture's comment mis-stated how the fixture fails, and
      `nominalDtMs` is applied to all three rate signals while being physically
      right for one — signposted at both sites rather than split per signal,
      because splitting it moves readings the ruled table was measured against.
      **The round also audited its own instruments**, which is where its value
      was: every control on both new regression fixtures was proven to go RED
      when the fixture drifts off the boundary (measured — shake 0.02 blocks
      nothing, 0.08 leaves only the 8 warm-up frames, a burst 20 frames later
      puts no rep inside the message, a burst 26 frames earlier costs a rep), and
      a mutant deleting one line of the tab-resume fix turns its test red. **At
      shake 0.02 the cadence test's headline assertion passes vacuously** — its
      boundary controls are the only thing holding that test up, which is exactly
      the trap round 1 fell into twice.
      **WHAT THIS LINE DOES NOT CARRY WITH IT**, so nothing is quietly closed by
      this tick: the escape hatch for a user the check is wrong about (its own ⚪
      line below) and the calorie defect the 2026-08-10 smoke surfaced (its own 🔴
      line below) are SEPARATE and both still open.
      **STATUS 2026-08-10 (c) — IT IS WIRED, AND THE SCREEN SAYS SO. The line
      still does NOT tick: the SMOKE WAS UNRUN at the time of writing.** (DECISIONS :7104.) Every frame
      the app feeds the engine goes through the check first at the ruled setting;
      a blocked frame reaches the engine with no landmarks, and after three
      blocked frames in a row the camera panel says *"Not counting — the camera
      isn't sure it's looking at you. Step into full view."*, clearing after
      fifteen clean ones. **This is the first change in the whole camera card a
      user can see.** web 578/578 · `vite build` ✓ · 17 mutants, 16 RED, 1 ALIVE
      with its reason. **What this line still needs before it ticks:**
      `RUNBOOK/smoke-person-check.md` run by Kd (chair alone in shot must stop
      counting AND Kd squatting must still count — either half alone proves
      nothing), and the T3 review. **Three invented reps on `chair_A` survive by
      design and are not a smoke failure** — the settings sweep stays in reserve.
      **STATUS 2026-08-10 (a) — THE GATE EXISTS BUT IS WIRED TO NOTHING, so this
      line does NOT tick.** `packages/engine/src/scene/personGate.ts` is the
      arithmetic that asks "does this move like a body?", committed with 190/190
      engine tests and an 18/18-RED mutation sweep (DECISIONS :6959). It chooses
      nothing: signal, cut-off and mode are arguments. **`apps/web` is untouched,
      so a user still sees the invented chair reps** — the fix is not delivered
      until step 3 wires it in AND the screen says so when it blocks (:5807).
      **The "Kd must run the measurement" blocker in the paragraphs above is NOT
      REAL and a later chat must not repeat it**: both clip sets sit on the dev
      machine (`C:\Users\kautilya\Desktop\traces` and `...\traces2`), so the gate
      simulation (`measure-pose.ts --gate`) is a command a chat runs unattended.
      **The no-threshold-from-judgement rule is UNCHANGED and still binds** — the
      run produces a table of what each candidate costs on BOTH sides, and Kd
      rules the number on it.
      (e) **KD RULING 2026-08-08 — his object-detector proposal is DROPPED on
      cost** (a second model against Part 6 §3.4/§3.5 budgets). Deferred, not
      struck: it returns if the free levers fail, at ~1 Hz, never per frame.
      **NOT measurable from the recorded clips:** they hold landmark OUTPUT, not
      video, so every candidate camera-stage fix needs FRESH recordings that
      capture video too. That is the instrument's main limit as built.
- [x] 🔴 **DONE 2026-08-15 — CALORIES BILL A MID-SET ABSENCE AS VIGOROUS
      EXERCISE.** Closed on all three gates: the engine half (`cd6c6a7`,
      DECISIONS :7404) and the API half (`faa7f06`, :7730) built it, the browser
      SMOKE passed on Kd's own three workouts with the claim carried by the
      STORED ROWS (:7929), and the fresh-chat **T3 round 1 found ZERO
      Critical/High** (:7974) — so under :5348 rule 1 the packet ships and no
      further round is owed. Its four Low findings are fixed in the closing
      commit and logged as L19–L22 in `BACKLOG.md`; the one that needed no code
      became its own OWED line below (the v1/v3 selection asymmetry).
      **Full history kept below rather than summarised — this line took five
      weeks and four measured design reversals, and the reasoning is the part a
      later chat will need.**

      **WAS: CALORIES BILL A MID-SET ABSENCE AS VIGOROUS EXERCISE — one rep's
      clock swallows the whole gap.** Found by **Kd's instinct** on the
      person-check smoke, 2026-08-10: 14 reps over a 2m41s workout reported
      **22 kcal**, and he asked whether that could be right. It is not.
      **MEASURED, not reasoned** (`kcalPointForSetsV2`, `calories.ts:93-97`):
      rep time is `reps × tempoMsAvg` capped at the SET SPAN, and his set 1
      reported `tempoMsAvg` of **21,267 ms — 21 seconds per squat**. So
      **171.7 s were billed at the squat MET inside a workout whose timer ran
      161.0 s**: more vigorous exercise than the workout lasted. Honest figure is
      roughly half.
      **THE CAUSE IS IN THE ENGINE, and it is reproducible** (`fsm.ts:167`,
      `cycleStartT ??= t`): a rep's clock starts when the metric LEAVES THE TOP
      and is cleared only by a completed rep, while a null metric HOLDS
      everything (`fsm.ts:106-115`). So a user who leaves the dead zone and then
      stops being measurable — walks out of shot, rests without pausing, is
      occluded, or **is silenced by the person check** — has that entire absence
      charged to the next rep. Swept over the golden squat with a 120 s absence
      inserted at each frame: **60 of 108 start points produce a single rep of
      123,100 ms and a `tempoMsAvg` of 63,000 ms.**
      **NOT CAUSED BY THE PERSON CHECK, and the check makes it far more likely.**
      The mechanism predates it and fires on any long mid-set gap; what the check
      changes is that long in-set silences are now the DESIGNED behaviour rather
      than an accident. Before it, invented chair reps kept resetting the clock,
      which masked the inflation.
      **A HINT FOR WHOEVER FIXES IT, not a design:** the arithmetic already had
      the evidence that it had gone wrong — `chargedMetMs` (171.7 s) exceeded
      `session.durationSeconds` (161 s), which the code notices only to floor
      idle at zero. Rep time that exceeds the on-screen timer is not a number to
      clamp quietly; it is a contradiction. **Its own card, with Kd's approval
      before any code (Part I §2.5), and R9.5 — a failing test first.**
      **Deferred out of the person-check card deliberately** (R1.1): the defect
      lives in `calories.ts` and the engine's rep timing, neither of which that
      card touches. DECISIONS :7104 records the smoke that found it.
      **STATUS 2026-08-11 — THE FAILING TEST EXISTS AND IS COMMITTED RED. THE FIX
      IS NOT WRITTEN.** `packages/engine/test/repTimingAbsence.test.ts` reproduces
      it from this package's OWN trace (`traces/parity/squat_sideview2goodform
      .jsonl`, 85 frames), splicing a 120 s absence in as frames with no
      keypoints — production, not a convenience: `sessionController.js` hands a
      blocked frame to the engine as `feed([], tMs)`. **Measured, swept over every
      frame boundary: 70 of 84 positions bill unwatched time as exercise; the
      worst charges 127,000 ms at the squat MET when the engine watched 8,400 ms;
      one single rep is credited 123,600 ms.** The clean-control test passes, so
      the suite is not simply broken. **DO NOT MERGE while this test is red.**
      **THE PARITY RISK IS MEASURED AND IT IS ZERO.** All ten traces under
      `test/traces/{parity,regression}` scanned: **every one has ZERO frames the
      engine cannot use, and the largest gap between consecutive frames is
      112 ms.** So a fix keyed to the engine's existing lost-sight rule
      (`INVALID_STREAK_FOR_VISIBILITY = 3`, §3.1) cannot alter any existing trace —
      the golden/parity gates stay green by construction, not by luck.
      **THE DESIGN IS AGREED WITH KD AND HAS TWO PARTS, because he found the flaw
      in the one-part version.** (1) On losing sight, the open cycle's clock and
      ROM bookkeeping re-arm, so the interrupted rep is timed only from when the
      user was visible again — never the absence. It STILL COUNTS; no rep is lost,
      which was his first question. (2) **That partial duration is EXCLUDED from
      `tempoMsAvg`.** He asked what happens to reps completed before the absence,
      and the answer exposed part 2: calories bill `reps × tempoMsAvg`, so a
      half-measured rep in the average drags it down and UNDER-charges every rep in
      the set — trading an over-count for a quieter under-count. Excluding it bills
      the interrupted rep at the rate of the reps actually watched. **Neither part
      changes a payload shape**, so §2.4's byte-match gate and stored history are
      untouched.
      **TWO TRAPS FOUND BY READING, NEITHER COVERED BY A TEST YET:** clearing
      `cycleStartT` alone makes `durationMs` fall to 0 (`fsm.ts`: `cycleStartT
      !== null ? t - cycleStartT : 0`) — a fabricated zero replacing a fabricated
      123 s; and `cycleMinT`/`cycleMinLastT` predate the absence, so re-arming the
      start without them yields a NEGATIVE `phaseTimings.descent`.
      **STATUS 2026-08-11 (evening) — THE ENGINE HALF IS DONE AND THE TEST IS
      GREEN; THE LINE DOES NOT TICK.** Both parts of the agreed design shipped in
      `fsm.ts` + `session.ts`, and BOTH traps above are now covered by a test and
      by a mutant each (6 mutants, 6 RED, restores sha256-verified). Counting is
      provably unmoved: 2 reps at all 84 absence positions, before and after.
      **The occlusion path was added on Kd's approval after being measured** —
      every frame valid, legs unmeasurable, **127,200 ms billed against 8,400 ms
      watched**, the same size as the absence and invisible to the committed
      sweep. Full record: DECISIONS :7404.
      **STATUS 2026-08-14 — T3 ROUND 1 HAS RUN: ONE Critical/High, FIXED. The
      line does NOT tick.** (DECISIONS :7487.) A rep can be watched for
      literally NO time — the clock re-pins on the first usable frame and the
      user returns already standing, so the rep closes on that same frame — and
      the all-interrupted fallback averaged that zero in: measured on the one-rep
      clip, **reps 1, `tempoMsAvg` 0** against 3,400 ms clean, on both paths. The
      server reads `reps × tempoMsAvg` as exercise time, so a set containing a
      real squat was billed as if nobody moved. **Fixed as Kd approved it in
      plain words: a rep watched for no time is not a measurement, so it is
      dropped from the average; the reps that WERE part-measured still set the
      rate.** **The review's own proposed fix (`null`) was MEASURED AND
      REJECTED** — on a set shaped like Kd's smoke, honest 10 kcal · today 8 ·
      null 6. engine 203/203 · 9 mutants 9 RED 0 ALIVE (1 retired with its
      reason) · Low ×3 as L12–L14 in `BACKLOG.md`.
      **STATUS 2026-08-14 (evening) — THE API HALF IS BUILT AND ALL THREE ITEMS
      BELOW ARE DISCHARGED IN CODE. THE LINE STILL DOES NOT TICK: the browser
      SMOKE and the fresh-chat T3 are both unrun.** (DECISIONS :7730.) **Kd ruled
      the design in plain words** — stop guessing a rate from half-seen reps,
      charge the time the camera actually watched, and charge nothing for the time
      it did not. `SetSummary` gains an OPTIONAL `watchedMs` (§2.4's document
      still parses and round-trips, so Part 2 §10's byte-match gate holds by
      construction), migration `0010_set_watched_ms` stores it NULLABLE (null =
      nobody told us, which is not zero), and `kcalPointForSetsV3` reads it.
      **This SUPERSEDES the 2026-08-11 clause "the part-measured reps still set
      the rate"**, which was never a measurement — it was a workaround for the
      missing number, and it was the inversion item (3) names.
      **AND IT FOUND THE NEXT ONE, MEASURED: a mid-set PAUSE is billed as
      exercise, and `watchedMs` cannot see it** — own 🔴 line below, because a
      pause feeds NO frames at all, so the engine cannot tell it from a slow
      camera. Pre-existing: v2 bills the identical 127,000 ms.
      engine 208/208 · shared 48/48 · api 443 of 444 · web 585/585. (The one red is
      the pre-existing `db.migration.test.ts` timeout flake, whose own line below
      is widened today; it is not in this diff.)

      **WHAT IS STILL OWED ON THIS LINE, and it is now THREE things:**
      (1) **the API half** — `kcalPointForSetsV2` still bills an unwatched
      stretch as IDLE at `REST_MET` rather than as nothing, because the on-screen
      timer does not stop when the camera stops seeing (a 2-minute absence is
      ~4 kcal at 70 kg instead of ~14, better but not right); its own step, its
      own tests. (2) **the DIFF-ONLY re-review** (:5348 rule 2) — round 1's
      findings are fixed and unreviewed. (3) **NEW, found by round 1 and not
      closed by it: an all-interrupted set still bills ~20% low**, because
      half-measured reps set the rate at all — **the one place Kd's ruled part 2
      is inverted**, since that ruling exists precisely so a half-measured rep
      cannot set the rate. Closing it honestly needs the engine to report **how
      much of the set it actually WATCHED**, which is a new payload field (§2.4
      byte-match gate + migration), so it belongs WITH the API half in (1) and
      not in a fix round (:5348 rule 6). **The floor is `> 0` because that is
      what Kd ruled in words** ("watched for no time at all"); a 100 ms remainder
      of a 3,400 ms rep is barely more of a measurement, and any higher floor is
      a NUMBER that R0.2 forbids a chat from picking — it goes to Kd on a table,
      the shape of :7037.
- [x] 🔴 **DONE 2026-08-15 — A MID-SET PAUSE IS BILLED AS SQUATTING.** Built
      exactly as the entry below describes (`8c2d204`, DECISIONS :7863): the
      client tells the engine the feed stopped, which routes into the same
      `loseSight()` path both blindness kinds already take. **SMOKE PASSED**
      (:7929) — and the stored rows, not Kd's word, are what carry it: the
      paused workout's sets LASTED 96 s and 94 s with the camera credited 30 s
      and 31 s, so ~64 s per set was correctly thrown away. **T3 round 1 found
      ZERO Critical/High** (:7974). Ticked together with the line above, which
      is the same packet.

      **WAS: A MID-SET PAUSE IS BILLED AS SQUATTING — and the watched-time field
      cannot see it.** **Found and MEASURED 2026-08-14 while building the API
      half above** (DECISIONS :7730), on the promise made to Kd in that card's
      plan that the pause question would be checked rather than assumed.
      **THE CAUSE, and it is why `watchedMs` does not close it:** pressing pause
      tears the pose feed down (`ActiveWorkout.jsx:267`, `enabled: !paused`), so
      **no frames arrive at all** — not blank ones, not unusable ones — while the
      timestamps inside the frames that resume have advanced by the pause length.
      Every mechanism this card and the two before it built keys on FRAMES THE
      ENGINE RECEIVED AND COULD NOT USE (§3.1's count of three). A pause produces
      one long inter-frame gap, which is indistinguishable here from a slow
      camera, so it lands INSIDE watched time.
      **MEASURED on this package's own squat clip, a 120 s pause swept across
      every frame boundary: 70 of 84 positions report `watchedMs` 128,400 ms
      against 8,400 ms really watched, `tempoMsAvg` 63,500, and bill 127,000 ms
      at the squat MET — 14.82 kcal where the truth is 0.98.**
      **PRE-EXISTING, NOT INTRODUCED: `kcalPointForSetsV2` bills the identical
      127,000 ms on the same input** — asserted by a test, so the claim is not
      just prose. What the API half adds is the CLAMP: the on-screen timer is the
      one measurement that stops on pause, and v3 spends exercise time against it
      as a budget, which brings the measured case to 1 kcal. **A clamp is not a
      fix** (:7222's own warning — rep time exceeding the timer is a
      contradiction, not a number to quietly trim), and it does nothing at all for
      a client that sends no timer.
      **THE REAL FIX NEEDS NO NEW NUMBER: the client knows why the frames
      stopped, and the engine does not.** The web bridge should tell the session
      it has stopped feeding, which routes into the SAME `loseSight()` path both
      blindness kinds already use. That is a web + engine card with its own
      measurement, not a fix round (:5348 rule 6). **Its own smoke matters more
      than usual**: pausing is a thing a user does deliberately, so the wrong
      number here is one they can reproduce.
      **STATUS 2026-08-14 (same evening) — BUILT EXACTLY AS DESCRIBED ABOVE, and
      the line does NOT tick.** (DECISIONS :7863.) Kd read the measurement and
      ruled: *"i understand the pause problem no need to see the problem with my
      own eyes just solve the problem."* `EngineSession` gained `loseSight()`,
      `sessionController.resetScene()` became `framesResumed()` and now moves the
      CLOCK as well as the scene check, and both resume sites in
      `usePoseDetection` call it. engine 212/212 · web 586/586 · 4 mutants 4 RED
      0 ALIVE. **WHY IT STILL DOES NOT TICK: he declined the DEMONSTRATION of the
      defect, which is not the same as waiving the browser smoke** — that rule is
      his (2026-07-16) and only he can lift it. A chat may not widen a ruling on
      his behalf; the precedent for ticking on a chat's own reading is :5034 and
      :4718 F4, both reverted.
      **SMOKE RUN AND PASSED 2026-08-14 (DECISIONS :7929) — the line still does
      not tick, because T3 is unrun.** Kd's three browser workouts, verified in
      the stored rows rather than on his word: **the paused workout's sets lasted
      96 s and 94 s with the camera credited 30 s and 31 s**, so ~64 s per set was
      correctly thrown away; the clean workout shows watched ≈ set length. All
      three stamped `kcal_calc_version` 3.
- [ ] 🟡 **THE GOLDEN-TRACE GATE CANNOT SEE REP TIMING AT ALL.** `assertTrace`
      (`packages/engine/src/harness/assert.ts`) asserts rep count, fault
      multiset, scores, hold time and phase sequence — and **nothing about
      `durationMs` or `tempoMsAvg`**. So §7.4, the mechanism that is supposed to
      make this engine safe to change, is structurally blind to the entire
      subject of the two rep-timing cards above: every timing guarantee rests on
      one hand-written test file, and a future change that silently doubles every
      rep's reported duration replays all ten traces GREEN. **Pre-existing — not
      introduced by either card**, and Low rather than 🔴 because nothing on
      screen is wrong today. **Deferred out of the T3 fix round deliberately**
      (:5348 rule 6): adding timing to the assertion layer means every golden
      trace must declare its expected timings, which is a card with a recording
      pass, not a fix. Found by T3 round 1 of the rep-timing card as its Low-3;
      logged as L14 in `BACKLOG.md`; DECISIONS :7487.

- [ ] 🟡 **WHEN GYMS CAN PAY, THE REMOVAL CARD MUST NAME WHAT ACTUALLY CHANGED —
      "You keep the free app" will be TRUE and INCOMPLETE.** Created 2026-08-20,
      **Kd's observation**: *"they keep the free app means there will be
      constraints on meal scan and running men."* He is right, and the gap is
      measured rather than estimated (`db/seed.ts`, the two canonical
      entitlements blocks):

      | | Free | Pro (what a paying gym grants) |
      |---|---|---|
      | Meal scans | **2 / day** | 8 / day |
      | Running routes | **2 / month** | 5 / day |
      | Coach questions | **5 / month** | 30 / day |
      | Exercises | Tier 1 only | all |
      | History | 90 days | unlimited |
      | Global leaderboards | no | yes |
      | Share images | watermarked | clean |

      Running is the brutal one: **2 a month against 5 a day is a 75× drop**, and
      a person who never hit a limit would meet one on their third route.
      **Why the card does NOT say this TODAY, and why saying it would be a
      defect:** no gym has ever paid (nothing inserts into `subscriptions`), so a
      removed member was already on free and **nothing changes for them**.
      Printing "your scans drop to 2 a day" would be the same class of untruth as
      the clause T3 round 2 just deleted (:12731 L2-1) — a screen describing a
      loss that did not happen. **The fix belongs with billing**: the card should
      name the drop only when the server can see there WAS one, comparing the
      person's entitlements before and after. **Do not hard-code the numbers into
      the client** (:1110's shape — the server sends, the client renders).
      Ties to the same card as the removal-reason column below.
- [ ] ⚪ **INLINE `:NNNN` CROSS-REFERENCES ARE UNCHECKED — the new guard covers
      the index's BOLD pointers only.** Created 2026-08-27 (DECISIONS :21057 §6).
      `tools/check-decisions-index.mjs` proves every **bold** pointer in
      `DECISIONS-INDEX.md` lands on the start of a decision, and it found 19 of
      212 wrong. It deliberately ignores the `:NNNN` mentions that appear inside
      prose, which are commentary rather than the map — but they drift by exactly
      the same mechanism, and they are far more numerous. **Measured 2026-08-27,
      not estimated: 2,927 occurrences across `DECISIONS-INDEX.md`,
      `DECISIONS.md`, `OWED.md`, `CLAUDE.md` and `HANDOFF.md`; 265 distinct
      numbers; 74 of those do not land on a heading.**
      **⚠ THE 74 IS NOT A DEFECT COUNT AND MUST NOT BE QUOTED AS ONE.** An
      unknown share are DELIBERATE mid-entry pointers — `:1110` is the worked
      example, and the naive "point at the next heading" repair would have moved
      it into a different ruling. **The classification has not been done, and it
      is the whole cost of this item**: 74 numbers each read in context to decide
      drifted-vs-deliberate. **Do NOT extend the guard before that** — turning
      inline mentions on today ships a red gate nobody can clear, which is how a
      guard gets disabled instead of fixed. Unblocked by the classification;
      blocks nothing.
- [ ] ⚪ **`gym_members` CANNOT SAY WHY A MEMBERSHIP ENDED, so a person who
      deleted their own account is told a GYM removed them.** Created 2026-08-20
      (DECISIONS :12731, T3 round 2 L2-2). The DPDP Day-0 cascade closes
      memberships when somebody deletes their own account, and `restoreUser`
      brings the account back while **deliberately leaving those memberships
      closed** (P2.2 T3 finding 4 — auto-reopen could exceed seat caps). Both
      windows are 14 days (`DPDP_RETENTION_DAYS`, `DECIDED_VISIBLE_DAYS`), so
      they coincide exactly. **Nothing user-visible is FALSE today** — "You're no
      longer a member of X" is true however it ended — which is why round 2 fixed
      the misleading COMMENT and not the code. **The sharp edge, recorded rather
      than fixed:** an owner who deletes and restores their account reads "You're
      no longer a member of {their own gym}" while the console still lists them
      as its owner. **The durable fix is a `reason` column on `gym_members`** so
      the two endings can be worded differently; **not invented in a fix round**
      (R0.2), and it needs a migration. Belongs with whatever card revisits
      account restore at P3.10.
- [ ] ⚪ **THE `/orgs/mine` SNAPSHOT HAS NO TEST.** Created 2026-08-20 (DECISIONS
      :12731, T3 round 2 L2-4). The two reads now run inside one `sql.begin`, so
      a removal committing between them can no longer produce a response where
      the gym is in neither list (the exact silence :12660 exists to end) or in
      both. **The fix is in; the guarantee is unproven.** Reproducing it needs a
      commit interleaved between two statements inside a transaction, and a fake
      would assert nothing — so no test was written rather than a green one that
      proves nothing (the class :12731's own standing lesson is about). Worth
      closing if this repo ever grows a two-connection interleaving harness; the
      seat-race tests drive two separate clients and are the nearest precedent.
- [ ] ⚪ **CONFIRM STRIPE IS ACTUALLY AVAILABLE TO THE ENTITY THAT WILL HOLD THE
      ACCOUNT, BEFORE P3.5 STARTS.** Created 2026-08-20 (DECISIONS :12600).
      **Kd RULED Stripe in** — *"stripe need to be used for payment men"* — which
      confirms `05-part5-billing.md` §4 and `CLAUDE.md` P3.5 rather than changing
      them. What is owed is not a decision but a FACT CHECK. An outside chat
      claimed new Stripe signups are effectively closed to India-based founders
      without a US entity; **that claim is UNVERIFIED — it came from a chat with
      no source read and this repo has never checked it.** If it is true it is
      discovered at P3.5, when the international book is being built, which is
      the worst moment to find it. **The check is cheap and the failure is
      expensive**, so it happens BEFORE that card opens. **If Stripe turns out to
      be closed, that is a SPEC GAP for Kd** (Part 5 §4 names the provider) —
      **never a chat's silent substitution of another provider or a
      Merchant-of-Record.** Razorpay already covers the India consumer and org
      books (P3.4) and is unaffected either way. Ticks when the answer is
      recorded, whichever way it goes.

- [ ] ⚪ **A PAYLOAD THAT REPORTS WATCHED TIME BUT NO REST TIME IS PRICED BY v1,
      WHICH IGNORES WATCHED TIME.** Created 2026-08-15 by T3 round 1 of the
      rep-timing packet (its Low-3; logged as L21 in `BACKLOG.md`).
      `service.ts:85` selects the formula on `restSeconds` FIRST and only then
      asks whether any set reported `watchedMs`, so a payload carrying the second
      field without the first falls to `kcalPointForSets` — the v1 formula, which
      has no parameter for watched time at all. **This is a missed upgrade, never
      a wrong number**: the row is still stamped `kcal_calc_version` 1, so it
      remains explicable from its own fields, which is the property the
      payload-shape rule exists to hold (:5906).
      **NOT REACHABLE TODAY, verified rather than assumed:** `ActiveWorkout.jsx`
      sends `durationSeconds` and `restSeconds` unconditionally alongside the
      sets (`:1074-1075`, read 2026-08-15), so no shipped client can produce the
      shape. **The plausible producer is the P5 mobile client**, which will build
      its own payload from the SQLite mirror and has no reason to inherit the
      web's field ordering.
      **NOT FIXED THIS ROUND deliberately** (:5348 rule 6 keeps a fix round to
      the findings Kd approved, and the fix is a ruling about selection order,
      not a typo): the honest options are to make v3 selectable on `watchedMs`
      alone, or to reject the shape at the parse boundary, and choosing between
      them is a decision about what a payload is allowed to omit. ⚪ because
      nothing today can reach it. **Whoever writes the mobile sync path must
      resolve this BEFORE the first payload ships**, or the field will be sent
      and silently ignored.

- [ ] 🔴 **A REST TAKEN IN FULL VIEW IS BILLED AS SQUATTING — if the knees are
      slightly bent.** **Found by Kd's question on 2026-08-11**, one day after his
      instinct found the absence defect above: he asked what happens when a user
      does a rep, rests a few seconds without leaving the camera, then does the
      next one. **MEASURED, not reasoned** (this package's own squat clip, a rest
      spliced in after rep 1):

      | resting posture | knee | 10 s rest | 60 s rest |
      |---|---|---|---|
      | upright | 178.8° | costs nothing | costs nothing |
      | knees slightly bent | 159.3° | all 10 s billed at the squat MET | all 60 s billed; rep 2 reported as **63,931 ms** |

      **Both are "standing still" to the person doing it** — nobody can see 20°
      of knee bend, and the app's number turns on which side of an invisible line
      a resting knee sits. **THE CAUSE IS THE SAME ONE LINE as the absence defect
      above** (`fsm.ts`: `cycleStartT ??= t` arms on the first frame at or below
      `upAt` and is cleared only by a completed rep) — one window with two entry
      points, which is why the 2026-08-11 fix cannot reach it: nobody is ever
      lost, every frame is usable. **IT FITS KD'S ORIGINAL 21,267 ms PER SQUAT
      BETTER THAN THE ABSENCE DOES** — a 15–20 s rest between reps produces
      exactly that — but **the stored row cannot say which occurred** (it holds
      the final count, not the count over time), so this is recorded as a FIT and
      never as a cause.
      **WHY IT IS ITS OWN CARD AND NOT A PATCH: it needs a NUMBER that does not
      exist.** Separating "resting still" from "descending" is a stillness
      judgement; R0.2 forbids inventing the threshold, and §3.5's C3 precedent
      (DECISIONS 2026-07-07) already rules that a stillness threshold is
      definition-declared with NO engine default. So the card is: measure
      candidates on Kd's real clips, put a table showing the cost on BOTH sides
      to him, he rules — the shape of the camera cut-off ruling (:7037).
      **Two cheap wrong answers, both rejected before this line was written:**
      re-arming on a return to the top never fires (a soft-knee rest never goes
      back above 160), and re-arming while the metric is not descending would cut
      the real descent out of every rep's duration, which §3.6 defines as part of
      it. **Kd ruled the split on 2026-08-11** (land the absence half, take this
      as its own card). DECISIONS :7404 records the measurement and the ruling.
      **STATUS 2026-08-15 — THE CARD IS STARTED AND BLOCKED ON A RECORDING, NOT
      ON A RULING. Do NOT re-run the measurement; it has been done.** The
      instrument exists and is committed (`packages/engine/scripts/measure-rest.ts`,
      typecheck+lint clean, and it ABORTS if declaring `stillness` moves the rep
      count, so it cannot quietly measure a different engine from the shipped
      one). Measured across the seven clips containing Kd: **none of them
      contains a rest.** `me_standing` is UPRIGHT standing — 1 frame of 1,268 sits
      at or below `upAt` — and the armed-not-repping stretches in every clean clip
      are the ~0.2 s gaps BETWEEN reps, 8.5 s in total across six clips.
      **THE TRAP, AND IT IS THE REASON THIS LINE SAYS "DO NOT RE-RUN":** priced
      over all seven clips the table looks convincing — a cut-off costing 1% of
      real-rep frames removes 9.0 s of 20.8 s. **12.4 s of that 20.8 s is
      `me_and_furniture` ALONE**, the clip where the model draws the skeleton on
      the chair (:6386), so those are not Kd's knees. Re-priced on the six clean
      clips the same cut-off removes **0.0 s of 8.5 s**. A chat that runs the
      instrument on everything and reads row 3 will hand Kd a confident table
      built on furniture — :7037's "separation is not the outcome", one card over.
      **WHAT UNBLOCKS IT:** `RUNBOOK/record-rest-clips.md` (written, committed,
      unrun) — two ~2-minute clips, `rest_natural` and `rest_upright`, whose three
      load-bearing instructions are that Kd must NOT pause, NOT leave the frame and
      NOT end the set during the rest, since all three are already fixed and each
      would hide the defect. **Kd deferred the recording on 2026-08-15** ("i think
      it will be done later lets go to the next thing") — deferred, not declined.
- [ ] ⚪ **A user the person check is WRONG about cannot take over the set.**
      "Count this set myself" is offered only on a frame GAP or a camera error
      (`ActiveWorkout.jsx`), and a blocked frame is not a gap — frames keep
      arriving, the check keeps refusing them, and the button never appears. So
      the one person the check has misjudged has no way out of it.
      **Deferred, not dismissed, and the severity is honest:** measured on Kd's
      own clips the worst run on a person clip is 18 frames (~1.5 s), which is
      an annoyance rather than a lost workout, and the frame-rate fix in the
      same commit cuts the silencing of a real user from 4.5% to 1.8%. It is
      recorded because it is the ESCALATION PATH for that defect — if the
      check is ever wrong for longer, this is what turns it from a pause into a
      dead set. Found by the T3 review of the person-check card (its Low-8);
      out of scope for a fix round under :5348 rule 6, which keeps a round to
      the findings Kd approved.
      **The no-removal rule is NOT engaged** — nothing is being hidden; this
      is a button that needs one more reason to appear.

- [ ] 🔴 **A squat too shallow to count says NOTHING — silence by
      construction.** Kd: *"when i do proper squat even then it does not count ...
      what would a user be thinking doing multiple correct squat but not being
      counted"*. **Measured cause:** `evaluateFrame` skips rep-scoped rules
      (`faults.ts:252-258`) and `shallow_depth` is `perRep: true`, so the only
      message that would say "go deeper" is evaluated **at rep completion** — a
      squat that never completes a rep can never trigger it. **KD RULING
      2026-08-07: the depth number STAYS** (100° down / 160° up, `squat.json`);
      he was offered a loosening proposal and chose the message instead. So the
      fix is a live cue, and the 2026-07-10 precedent is the shape to follow —
      the "cannot see your legs" cue was added in the WEB BRIDGE, not the engine,
      because the engine was already right to refuse to count and only the
      presentation lied. **Do not re-derive or widen any ported constant (R5.4).**
      **Second-order and NOT in this line's scope:** the bilateral gate means one
      knee that never bends blocks every rep (`fsm.ts:119-126`); whether the cue
      must also explain THAT depends on what the furniture line above measures.
      **STATUS 2026-08-08 — MEASURED, and this line is now DOWNSTREAM of the
      furniture line** (DECISIONS :6386). Kd's *"i do proper squat and it does not
      count"* was reproduced and its cause is NOT depth: with furniture in shot
      his knee crossed 100° only 4 times in 2 minutes of steady squatting, vs 19
      times in the clip without it. **The squats were deep enough; the app was
      watching a chair.** So the cue this line owes is still owed — a genuinely
      shallow squat must still say something — but **fixing the pose input comes
      first, and building the cue before it would attach a message to a number
      that is currently fiction.** Kd's ruling that the depth number STAYS is
      untouched by this and still binds.

- [ ] 🔴 **THE SPOKEN COACHING IS CONSTANT AND IRRELEVANT.** Reported by Kd
      2026-08-08, from his own camera testing the day before, and **recorded
      NOWHERE until now** — no OWED line, no BACKLOG line, no DECISIONS entry
      (grepped this session; the only prior hits for voice/speech in the whole
      record are an unrelated `voiceOn` dependency note and a camelCase line).
      A user-facing complaint that survived a testing session untracked is the
      exact failure this file exists to prevent.
      Kd: *"the voice commands also does not seem relevent at all it keeps
      bubling anything and very annoyning, in this way user will abondoned my
      product"*.
      **What exists:** `apps/web/src/utils/voice.js` (250 lines), six live
      triggers imported by `ActiveWorkout` — `speakExercise`, `speakCorrection`,
      `speakProgress`, `speakRest`, `speakSetStart`, `speakComplete`.
      **UNVERIFIED, AND THE FIRST THING THE CARD MUST TEST: this may be a
      SYMPTOM of the furniture line above rather than a separate defect.**
      `speakCorrection` reads out form faults. If the skeleton is sitting on a
      chair, the faults are computed from the chair — so the app would be
      reading nonsense corrections aloud, continuously, which is what "keeps
      babbling anything" describes. **Measure the two together before treating
      them as two problems**; repairing the pose input may quiet most of this on
      its own, and a throttle added first would only hide it.
      **The product decision is KD'S and is not assumed here:** how much the app
      should say, and whether it speaks by default. No behaviour changes until he
      rules.
      **Do not "fix" this by deleting the feature** (the no-removal rule): a
      coach that talks while your eyes are on your own form is the point of it.
      **STATUS 2026-08-08 — the SYMPTOM hypothesis is CONFIRMED; this is not a
      fourth defect** (DECISIONS :6386). Measured share of frames on which the
      engine would speak: **85.6%** pointed at furniture and **89.4%** on an
      empty room, against **1.1%** with Kd squatting in shot and **0.8%** with
      him and the furniture both in frame. **The babble is the app reading a
      chair's posture aloud.** Kd 2026-08-08: *"as for voice its working fine"* —
      he stayed in frame, which is exactly the condition under which it is quiet.
      **So: fix the pose input FIRST and re-listen before touching `voice.js`.**
      A throttle now would hide the furniture defect, which is why this line said
      so before the numbers existed. **Kd's product decision is still owed and
      still his** — how much the app says, and whether it speaks by default — but
      it must be put to him AFTER the pose fix, on what the app then actually
      says, not on today's chair-driven noise.

- [x] 🔴 **DONE 2026-08-09** (card 1 `6d255c4` = the abort half, card 2 = the
      recorder half). **THE GOLDEN-TRACE BAN IS LIFTED**: the recorder stamps the
      definition id, so a newly recorded trace can find its own definition.
      `--exercise` remains for clips recorded BEFORE this date and for nothing
      else. **THE MEASURING INSTRUMENT SILENTLY SKIPPED ITS OWN MAIN SECTION.**
      Found 2026-08-08 while reading Kd's five clips (DECISIONS :6386). The trace
      recorder stamps the workout's DISPLAY name into the trace header
      (`ActiveWorkout.jsx:1159`, `currentExercise.name.toLowerCase()` ⇒ `squats`)
      but definitions are keyed singular (`packages/engine/src/definitions/
      squat.json`), so `measure-pose.ts`'s `definitionFor(h.exercise)` throws
      ENOENT. **Section 3 — the engine replay, the whole point of the script —
      did not run on ANY of the five clips on the first pass**, while sections 1
      and 2 printed normally above a one-line `FAIL`. It reads as a partial
      success, which is how it nearly went unnoticed.
      **This is the SECOND time this same instrument degraded quietly instead of
      failing loudly** — the first was the empty-room clip that recorded nothing
      (commit 44f4ad2). **Fix the class:** a clip whose definition cannot be
      loaded must ABORT with the mismatch named, not print two sections and a
      FAIL; and the header slug must be the definition id, not a display name.
      Worked around on 2026-08-08 by rewriting the header in scratchpad copies
      (Kd's files untouched) — **the workaround is not the fix and no golden
      trace may be recorded until the slug is right**, or every future golden
      carries a header that cannot find its own definition.
      **BOTH HALVES ARE NOW DONE — see the tick above.** The record of how:
      **CARD 1 — the CLASS fix.** `measure-pose.ts` now resolves EVERY clip's definition BEFORE it
      prints a single line of per-clip output, and one unresolvable definition
      aborts the whole run naming the mismatch, the available ids and the
      `--exercise` flag to re-run with. **There is no longer a path on which
      some sections print and the main one silently does not** — the shape that
      made this defect nearly invisible twice. Proved by running it: the abort
      fires on a `squats` header with nothing printed above it.
      **CARD 2 — the RECORDER half.** `traceRecorder.definitionIdFor` resolves
      the slug through `getDefinition` — **the same lookup the engine uses**, so
      the header and the engine can never disagree about which definition a clip
      belongs to. `squats` → `squat`; an exercise with no definition (55 of 58)
      keeps its raw slug rather than having one guessed for it (:3538's
      exact-match-or-null shape). The expression that produced the bug existed
      TWICE in `ActiveWorkout.jsx` (:258 and :1159) and is now one `const` —
      a shared value with two declarations is where a correction gets lost
      (:4556 F1), which is exactly what happened here.
      Mutation-audited: T1 restores the original defect and the test goes RED.
- [ ] 🔴 **§3.6'S TRIGGER IS UNREACHABLE: THE APP CAPS ITSELF AT 12 FRAMES A
      SECOND AND THE SPEC WANTS 15.** Found and MEASURED 2026-08-17 while
      building the ladder half of the card below, which is why that half is not
      built. Nobody had noticed because the console line rounded it away.
      `usePoseDetection.js`'s `FEED_INTERVAL_MS = 67` is a THROTTLE — a frame is
      fed when `now - lastFeed >= 67` — so **14.93 a second is the arithmetic
      ceiling before any hardware is involved**, and `Math.round(1000 / 67)`
      printed that as "target 15" in every reading ever taken. In a real browser
      it is worse: the loop is `requestAnimationFrame`, which fires every
      16.67 ms on a 60 Hz screen, and 66.67 is not >= 67, so the feed slips a
      whole tick to 83.3 ms — **12.0 a second, on a machine doing nothing
      wrong.** Both figures are asserted by tests driving the real frame loop
      (`usePoseDetection.test.js`, "the ceiling is ~12" and "the throttle is the
      cap"), not reasoned.
      **WHAT IT COSTS US TODAY:** Part 6 §3.6 degrades a device when *"delivered
      Hz < 15"* — a condition **TRUE ON EVERY DEVICE BY ARITHMETIC**, so a ladder
      or a warning built on it fires for every user in their first ten seconds.
      It also **retires an explanation this project has been carrying since
      2026-08-08**: Kd's 9.2–12.2 fps (:8879) and his earlier 7.2–12.5 (:6386)
      were read as his laptop being under-powered. **12.0 is the ceiling and he
      was sitting on it.** Nothing has ever shown counting fails at these rates.
      **WHY IT IS NOT FIXED HERE (R1.1, R5.4):** raising the feed rate changes how
      often the engine is fed, and the person check's Kd-ruled
      `bone_stretch > 0.923` is normalised to `nominalDtMs: 82` — 12.2 a second,
      i.e. this exact ceiling (`sceneGate.js`, DECISIONS :7037/:7298, where the
      cut-off and the cadence are ONE ruling). Changing the throttle without
      re-measuring silently changes the shipped gate. **Needs Kd's decision plus a
      re-measurement, and it is plausibly the largest single win available for
      camera accuracy — more frames per rep is more evidence per rep.**
      **BLOCKS:** the §3.6 ladder in every form, and any use of "15 fps" as a
      device signal anywhere in this app.
- [ ] 🟡 **§3.6's degradation telemetry is not sent anywhere.** Deferred
      2026-08-17 with the card above. The spec asks for *"Degradation events →
      PostHog with device model, so the support floor is data, not guesswork"*
      (`06-part6-mobile.md:190-192`). **`apps/web` has no PostHog client at all
      — grep-verified across `src/` and `package.json`, zero hits** (P0.5 wired
      PostHog server-side only). The delivered rate is now readable by a user in
      the camera screen's `debug` panel, which is the local half; nothing is
      reported centrally, so the support floor stays guesswork until a real
      device fleet exists. **Unblocked by:** a web analytics client, which is its
      own decision (consent, DPDP scope — the open question at :592).
- [ ] 🔴 **THE PERSON CHECK'S RULED CUT-OFF WAS DERIVED UNDER A DIFFERENT MODEL
      FROM THE ONE WE NOW SHIP.** Opened 2026-08-17 by the model swap, and it is
      the swap's one real hazard. Kd ruled `bone_stretch > 0.923` on thirteen
      clips (DECISIONS :7037) — **every one of them recorded through
      `pose_landmarker_lite`**, because that is all the app had. `full` is a
      different estimator, so it produces different landmark jitter, and jitter
      is precisely what `bone_stretch` measures. **The number is NOT touched and
      must NOT be retuned to fit the new model** (R5.4, R5.7 — a threshold is
      never re-derived, and this one is a Kd ruling on top). What is unknown is
      whether it still does what he approved: it could silence a real person
      more often, or let the chair back in. **Neither has been observed — this is
      a hazard, not a symptom.** **Unblocked by:** a fresh recording under `full`,
      replayed through `measure-pose.ts --gate "bone_stretch>0.923" --window 15
      --nominal-dt 82`, printing the same table Kd ruled on. **Blocks:** nothing
      today; it is the first thing to check the moment anyone reports the chair
      counting again or reps going missing.
      **STATUS 2026-08-17 — SOMEONE LOOKED, AND SAW NOTHING WRONG; THE LINE DOES
      NOT TICK (DECISIONS :9328).** Step 3 of
      `RUNBOOK/smoke-strong-model-and-rate.md` ran under `full` for the first
      time: an empty room and a chair for one minute **invented ZERO reps**,
      while Kd's own reps counted normally in the same session. **That is one
      room, one chair, one minute, reported by the operator (:4829) — it is not
      the table he ruled on**, and a stored row cannot separate "reps before he
      stepped away" from "reps invented by the chair" (:7222). What moved is the
      hazard's TEMPERATURE, not its status: the failure this line was opened for
      has now been looked for once, under the shipped model, and was not there.
      The recording above is still the only thing that closes it.
- [ ] 🟡 **NOTHING IN THE APP DECIDES WHICH PERSON IS THE USER — in a gym, the
      camera counts whoever the model happens to crown.** **KD'S QUESTION,
      2026-08-17**, asked unprompted while the strong-model card's review was
      running: *"if a user uses it in gym there will be multiple people beside
      them then how would the camera detect only that target person?"* **Tracked
      NOWHERE before today — grep-verified across `OWED.md` and `BACKLOG.md`,
      zero hits** for multi-person/bystander/`numPoses`; the furniture half of
      the same question is well recorded (DECISIONS :6386, :7037), the PEOPLE
      half was not.
      **WHAT THE CODE DOES, read this session, not recalled:**
      `poseTuning.js:82` ships `numPoses: 1`, and `usePoseDetection.js:388-389`
      takes `results.landmarks[0]` — **MediaPipe crowns one winner and the app
      takes it.** There is no selection rule of our own: not the nearest body,
      not the largest, not the one in the middle, not the one that was there on
      the previous frame. **The person gate cannot help here and was never meant
      to**: `bone_stretch > 0.923` (`sceneGate.js`) asks *"is this a physically
      plausible human skeleton?"*, and a real bystander is one.
      **THE FAILURE, and it is UNVERIFIED — never tested with two people in
      shot:** the winner can change mid-set to somebody walking behind the user,
      after which their reps stop counting or another body's movement is counted
      as theirs, **and the app says nothing**, because as far as it knows it
      found a person. Same shape as :6386's chair — the model crowns a winner
      and nothing checks it is the RIGHT one — but with a subject that passes
      every plausibility test we have.
      **WHY IT MATTERS MORE THAN IT LOOKS:** the gym IS the pilot environment
      (P6: 2–3 Jorhat gyms on pilot codes), so the first room full of real users
      is also the first room where this can happen. A home user is unaffected.
      **Unblocked by:** a decision on how the user is chosen. The lever already
      on the record is DECISIONS :6810 — **`numPoses: 2+` returns CANDIDATES
      instead of a winner, and a rule then picks between them** (that entry pairs
      it with `motion_incoherence`); each extra pose costs another landmark pass
      against Part 6 §3.4's inference budget, so it is a measurement, not a
      default. **No rule is chosen here and none may be invented** (R0.2) — and
      note the recording gap above applies in full: clips of one person can never
      answer a two-person question, so this needs its own session in a room with
      two people in it. **Blocks:** nothing today; it blocks the GYM PILOT, not
      the cutover.
- [ ] 🟡 **KD RULED IT, 2026-08-17 — BUILD A FOLLOW-THE-DEMO MODE THE USER
      CHOOSES, AND TELL THE USER IT EXISTS (DECISIONS :9390).** His words:
      *"if a user is using in a environment where there are more people then it
      should switch to a mode where instead of the camera there will be a big
      reference of the exercise they want to do and follow the reference"*.
      Raised immediately after the multi-person line above, as a way AROUND that
      problem rather than through it.
      **WHY IT IS CHEAPER THAN IT SOUNDS — both halves already exist, verified
      this session, not recalled.** The moving demonstrations are already
      shipped: **112 GIFs in `apps/web/public/exercise-gifs/`, covering 63
      distinct exercise names** (`ls | wc -l`), so no media has to be produced.
      And the not-camera-graded path is the existing log-only set — the user
      counts, the workout still SAVES and still earns XP (DECISIONS :3085, Kd
      ruled), it simply carries no form score. So this is mostly screen work over
      two things already built.
      **RULING 1 — THE USER FLIPS THE SWITCH, NEVER THE APP.** Offered the
      choice, Kd said *"i will follow your recommendation"*, and the
      recommendation was that way round because of his own **:6008**: if the user
      chose the CAMERA, the app NEVER switches them off it — the approved hatch
      is a BUTTON *"the user presses, the app has no path to it"*. An app that
      DETECTS a crowd and switches is that forbidden handover wearing a new coat.
      **A later chat may NOT build the automatic version on the strength of this
      line — that needs Kd to amend :6008 expressly.**
      **RULING 2, in the same breath and larger — THE APP MUST TELL THE USER
      THE MODE EXISTS.** His words: *"this thing need to be explicitly told to
      the user that if there are multiple person then you need to switch
      otherwise they will think the app does not work"*. **A mode nobody is told
      about is a mode nobody uses, and the failure it prevents looks exactly like
      a broken app** — a user in a gym whose reps stop counting cannot guess the
      camera locked onto somebody else. :6662's "say it out loud" shape and
      :6856's "asking a person to notice a MISSING thing is not a check", applied
      BEFORE the defect rather than after it.
      **THE DESIGN CONSEQUENCE OF RULING 1 ON RULING 2, which must not be lost:
      the message CANNOT be conditional on a crowd**, because the app cannot
      detect one — that is the whole point of ruling 1. So it is unconditional
      and always present, which forces the wording: an **INSTRUCTION beside the
      switch** (*"training in a busy room? use Follow along"*), never a warning
      about the camera — otherwise every solo user at home is told the app may
      not work, the exact impression Kd is trying to prevent. **Copy is NOT
      written here (R0.2); it is written in the card and shown to him.**
      **AND THE TRAP WORTH THE WHOLE ENTRY: the AUTOMATIC version needs exactly
      the thing this idea was meant to avoid.** The app cannot know a room is
      crowded without asking the model for more than one body — the multi-person
      work in the line above. **User-chosen costs nothing extra; automatic costs
      the hard thing first.**
      **RULING 3, same day (DECISIONS :9452) — THE SET RUNS ON A TIMER, NOT ON
      REPS COUNTED FROM THE VIDEO.** Kd specified the video driving the count,
      then asked for the time-based version himself and ruled for it. **The
      reason is honesty: the app can only know how many reps the VIDEO did,
      never how many the USER did**, and writing the video's count into a
      person's history, calories and personal bests is a number the app invented.
      Secondary but real — **it removes the dependency on a perfect one-rep clip**,
      which is where the artwork was stuck. **Not a one-way door: rep counting can
      be added later.** **CALORIES NEED NO NEW WORK — verified, not recalled:**
      `calories.ts` is `MET × weight_kg × hours` and a log-only set is billed as
      its whole span at the exercise MET, so a timed set is the cleanest input
      that formula has had (:9452, :7730).
      **THE CARD IS WRITTEN: `NEXT-CARD-follow-along-PROMPT.md`.** It carries the
      three rulings, the traps, and what is deliberately out of scope.
      **Unblocked by:** nothing — it is ruled and buildable. **Sequenced after**
      the strong-model / camera-rate card closes. **Still owed inside the card and
      Kd's to give (R0.2):** the default set length, the on-screen wording, and
      where the reference footage comes from — the artwork is its own track and
      must not block the build (one placeholder reference proves the mode).
      **Blocks:** nothing today; it is what makes the GYM PILOT honest, alongside
      the multi-person line above.
- [ ] 🟡 **A model that changes the frames cannot be checked against any clip we
      hold, because the recorder saves landmarks and not video.** Restated
      2026-08-17 as its own line, having been a sentence inside two other
      entries. **Landmarks are the OUTPUT of the model, so a recording made under
      `lite` can never be replayed under `full`** — the thirteen clips behind
      `0.923`, the throughput sessions and the golden traces are all unusable for
      any question about a different model, a different MediaPipe build, or a
      different feed rate. **One fix serves all three:** something that can play a
      VIDEO through the camera pipeline. Nothing in the repo can — grep-verified
      2026-08-17, zero hits for `MediaRecorder`, `mp4`, `ffmpeg` or `VideoDecoder`
      across `apps/web/src`, `apps/web/tools` and `packages/engine`. Until then
      every camera experiment costs Kd a separate session in his own room, and
      the results cannot be re-derived by anyone else afterwards.
- [ ] 🔴 **WE SHIP THE FALLBACK POSE MODEL AS THE DEFAULT, AND THE DEGRADATION
      LADDER DOES NOT EXIST.** Found 2026-08-08 (DECISIONS :6386).
      **2026-08-17 — KD RULED THE SPLIT AND CHOSE THE ORDER. The LADDER half is
      now BLOCKED on the throttle line above, not merely unbuilt:** its trigger
      is unreachable, so there is nothing honest to build a step-down on. What
      that half's card delivered instead is the delivered rate shown beside the
      real ceiling in the camera screen's `debug` panel — *"a readout, never a
      warning"*, because under 15 is the normal case on every machine and
      counting works there. **Nobody ever chose `lite`** — it was inherited from
      the old code and never revisited; §3.3 makes `full` the default.
      ~~The MODEL half is blocked on a RECORDING.~~ **STRUCK the same day, by
      me, and the correction matters more than the claim.** Kd was told the swap
      was blocked on him recording video. It was not: the swap is a default, two
      digests and a fetch, and it is DONE below. What needs the recording is
      **CHECKING THE PERSON GATE AFTERWARDS** (its own 🔴 line above) — a
      verification, not a prerequisite. Saying "blocked" made a five-minute
      change look like a session of his time, and he over-ruled it with "just do
      the things of making the strong model default". **A verification you cannot
      run yet is not a blocker on the work; it is a blocker on the confidence.**
      **THE MODEL HALF IS BUILT, 2026-08-17 — NOT TICKED, because smoke and T3
      are unrun (the :5034 / :4718 F4 precedent: a line ticked in the same
      commit whose own notes say the gate has not run gets reverted).**
      **SMOKE UPDATE, same day (DECISIONS :9328): the sheet now PASSES 5 of 5.**
      `full` loads off disk (console: THE APP BUNDLE) for **+37 ms**, delivers
      **10–12 of the 14.9 ceiling** where `lite` delivers 11–12 on the same
      machine in the same session, and the empty chair invented ZERO reps. **Still
      NOT TICKED, and the reason is now a single one: the diff-only re-review of
      the rate-expiry fix (`t3-camera-rate-expiry-r2-PROMPT.md`) has not run, and
      a packet ships on a review round finding zero Critical/High (:5348 rule 1).**
      The LADDER half below is untouched by any of this and stays blocked.
      `POSE_DEFAULTS.model` is `'full'`; `fetch-pose-assets.mjs` bundles **both**
      `full` (9,398,198 bytes, sha256 `5134a3aa…`, both MEASURED by downloading
      it) and `lite`, so §3.3's step-down stays offline-capable and every past
      measurement stays reproducible. A contract test asserts **the shipped
      default is one of the models the build writes** — point it at an unfetched
      variant and nothing else complains, because Vite answers a missing
      `public/` file with index.html at 200. **The LADDER half stays open and
      stays BLOCKED on the throttle line above.**
      ~~`usePoseDetection.js` hard-wires `pose_landmarker_lite` on every
      device.~~ **No longer true as of the swap above** — kept struck rather than
      deleted, because it is what the line was opened for. The original finding,
      for the record:
      Part 6 §3.3 says the opposite — *"BlazePose **full** as default, **lite**
      as the automatic step-down (§3.6)"* — and §3.6's ladder (full → lite below
      15 Hz for 10 s → 640p → **log-only mode with honest copy**) is not
      implemented at all. A weaker model is a more credulous one, so this is
      plausibly UPSTREAM of the furniture defect; **UNTESTED, and it must not be
      switched blind.** Counter-evidence from Kd's own machine, measured:
      `FEED_INTERVAL_MS = 67` targets ~15 fps and his five clips landed at
      **11.6–12.5** (7.2 on one) — he is already UNDER target on the LIGHT model,
      so `full` may make his laptop worse. **Inference time has never been
      measured on any device.** Measure first, then choose; and the ladder is
      owed regardless of which model wins, because the whole point of §3.6 is
      that the choice is made per-device at runtime rather than by us guessing.

### Session handling — found by Kd's smoke 2026-08-18, tracked nowhere before

- [ ] 🟡 **A NETWORK BLIP ON PAGE LOAD LOGS YOU OUT OF THE WHOLE APP.** Found in
      the console smoke, on a step that was aimed at something else entirely:
      with the API stopped, a browser RELOAD of any protected screen bounced Kd
      to the login page instead of showing an error. **This is app-wide and
      PRE-EXISTING — not the console's, and not in that card's diff** (R1.1:
      reported, deliberately not fixed there).
      **THE CAUSE, read rather than guessed:** `AuthContext`'s mount effect does
      `authService.getMe().catch(() => { adoptSession(null); setUser(null); })`,
      and `ProtectedRoute` redirects on a null user. A network failure carries
      **no response at all**, so it lands in the same `catch` as a genuine 401 —
      the app cannot tell *"you have no session"* from *"I could not ask"*.
      **The identical lesson is already written down THREE LINES AWAY**:
      `fetchProfileFacts` returns `undefined` rather than `null` on a failed read
      precisely because "the read failed" and "the server has none" are different
      facts (:618's T3 F3). `getMe`'s catch never got the same treatment.
      **What a user sees:** a valid session, a moment of bad wifi, and a login
      screen asking them to sign in again — which is false, and on a phone in a
      gym basement it will not be rare. The cookies are still valid, so logging
      in again works, which is exactly why nobody has noticed.
      **What the fix has to be careful about:** failing OPEN here means a
      genuinely logged-out user could render a protected screen before the first
      request 401s. The honest shape is a THIRD state — unknown — that shows a
      retry rather than either the app or the login form, which is the same shape
      the console's own screens use for their reads.
      **Its own card. Not a blocker for the console card, whose eleven smoke
      steps passed** — but this is the sort of thing that is invisible to every
      test suite in the repo, because every one of them mocks the network.

### Screens still reading the OLD backend (no new-API home yet)
Each needs an API surface built BEFORE its screen can be repointed. Per the
no-removal rule these UIs stay untouched and working on the old backend until
then; none may be hidden or reduced to close the gap.

- [x] 🔴 **XP / levels display — DONE 2026-07-30.** Closed by T3 round 11
      under THE CAP (DECISIONS 2026-07-29): round 11 returned ONE visible
      finding, it was fixed, and the card closes on that fix. Eleven review
      rounds; commits `7b91c68` (Round A) · `0869f01` (Round B) · `df0ea05`
      (round 9) · `690cdfb` (round 10) · this one (round 11). Smoke passed
      11/11 on 2026-07-28 and no fix since has changed user-visible
      behaviour beyond a defect. Was: UNTICKED 2026-07-26 by round 3, still
      off after rounds 4, 5, 6 AND 7.
      **SMOKE HALF DISCHARGED 2026-07-28: the re-smoke PASSED, all 11 steps**
      (Kd, steps at `RUNBOOK/smoke-xp-dashboard.md`, result recorded there). It
      replaces the 2026-07-27 attempt voided by the rig's CORS wildcard. Level 3
      / `332/374` / `680 XP` held on all five XP surfaces in all ten rig states,
      including `dead` and `hang`; no fabricated zero and no false "unavailable"
      over visible content anywhere. **THE TICK STAYS OFF: this line needs the
      smoke AND T3 round 8.**
      **ROUND 8 HAS NOW RUN (2026-07-28) AND THE CARD FAILED IT: 6 BLOCKING
      FINDINGS, 15 of 31 MUTANTS SURVIVED.** Findings verbatim at
      `t3-xp-web-r8-FINDINGS.md`; all six independently re-verified against the
      current files before any fix was planned. The eighth consecutive round in
      which the previous round's fix opened the next finding.
      THREE ARE LIVE DEFECTS: F4 an unguarded `in` lookup on external input
      blanks the WHOLE Achievements page (a badge category of `toString` →
      `.push` on `Object.prototype.toString`); F3 the week strip claims
      "Weekly activity unavailable" during an in-flight read, permanently when
      the old backend hangs; F5 an unknown badge tier is painted BRONZE in
      GamificationStrip while Achievements renders it neutral — round 6 F5 fixed
      at one of two sites, the eighth instance of the one-of-N shape.
      THREE ARE THE PROTECTION: F1 `Sidebar` — the component the ORIGINAL bug
      lived in — is mounted by no render test at all, and the source guard's
      `FIELD_READ` misses `xp ?? { level: 1 }`, so the card's own defect is
      reintroducible with all 75 tests green; F2 no Achievements test ever runs
      with the XP read failing; F6 four numeric fabrications (`?? 0` at Total
      Workouts, Calories, This-week, Your Rank) survive because
      `getAllByText('—').length >= 3` is a floor with two dashes of slack.
      **Also falsified: the claim in `gamificationApi.test.js` (the guard
      section's header — round 8 cited it as :454-457, which Round A's edits had
      already shifted to :515-518; corrected here per V4) and DECISIONS
      (2026-07-26, line 1173) that "all ten bypasses fail there".** Two of them
      pass. Fifth false claim carried by that guard section.
      FIX ORDER, Kd-approved 2026-07-28: **Round A** = the live defects
      (F3, F4, F5), failing test first per R9.5; **Round B** = the protection
      layer (F1, F2, F6), every new assertion mutation-tested before it counts.
      The smoke does NOT need re-running for Round A/B unless a fix changes
      user-visible behaviour beyond the defect — and note the smoke could not
      have caught F4: the rig never sends a prototype-name category.
      **ROUND A IS DONE (2026-07-29). F3, F4 and F5 are FIXED.** Each began as a
      failing test written and shown RED before any source was touched (R9.5 —
      the gate round 7 failed): 6 new tests, and the F4 red run reproduced the
      reviewer's Probe C exactly (`TypeError: badgesByCategory[key].push is not
      a function`, `<body><div /></body>`). Suite 81/81 green. **11 mutations
      were run against the new assertions: 10 RED, 1 GREEN** — and the green one
      was declared green in the PLAN before it ran. It is `Object.create(null)`
      at `Achievements.jsx`, which is behaviourally inert once the
      `Object.hasOwn` check stands, so no assertion can distinguish it; that is
      written in the source comment instead of being credited to a test (rounds
      6 F11 / 7 F3's lesson). F5 was fixed as a CLASS: every site in the card's
      ten files resolving a colour from a nullable field was enumerated, the two
      defective ones fixed, the six already-correct ones re-read and left, and
      the one excluded (`podiumColors[entry.rank]`) is the OWED line below.
      Lint parity checked rather than "lint clean" ticked: the six touched files
      produce 1 error at HEAD and the same 1 error after (pre-existing
      `ChevronRight`), package-wide 67 both times.
      **ROUND B IS DONE (2026-07-29). F1, F2 and F6 are FIXED, and NO component
      file changed — all three were defects of the TEST layer, so Round B alters
      no shipping behaviour and owes no re-smoke.** F1: `Sidebar` is mounted by
      two new tests (XP dead → no level at either of its two sites; XP ready →
      the TRUE level at both, the positive control without which an empty
      sidebar would pass). F2: one Achievements test with `getMe` DEAD, the
      whole-document sweep matching the Dashboard's. F6: the three
      `getAllByText('—').length >= 3` floors at :144/:161/:182 are REPLACED by
      per-site identity assertions (`statValue`/`tileValue`, which throw when
      their anchor is absent or ambiguous so they cannot pass vacuously) plus a
      whole-document `\b0\b` sweep on the dead fixtures; `Your Rank` got its own
      identity assertion in GamificationStrip, since the pre-existing `of 0`
      check reads the TOTAL and never touched the rank.
      **9 mutations, 9 RED — every new assertion mutation-tested before it was
      claimed to protect anything**, restored from `cp` backups. B1/B3 are
      MUT-28/MUT-34 verbatim (the destructure that defeats `FIELD_READ`);
      B5/B6/B7/B8 are MUT-21/24/26/20, the four numeric fabrications, of which
      MUT-21 is round 4 F2 verbatim; B2 and B9 are the vanishing-site controls.
      Suite 84/84 (81 + 3). `vite build` green. Lint parity: the two touched
      files produce 0 problems, package-wide 67 errors — the same 67 Round A
      measured and round 8's reviewer counted independently.
      The two false "all ten bypasses" claims are CORRECTED IN THE SAME COMMIT,
      in the guard header and at DECISIONS line 1173, and neither is replaced by
      a new sweeping claim: what is written is what was measured (Kd chose this
      over re-running all ten to earn the strong sentence back).
      **ROUND 9 HAS RUN (2026-07-29) ON ROUNDS A+B: 4 findings, 2 VISIBLE, ALL
      FIXED.** The stopping rule worked in both directions — two findings held
      the ticks, two were fixed without holding anything. F1 (VISIBLE): Round A's
      own `${color}NN` hazard was applied to ONE of EIGHT sites, so seven more
      dropped their colour entirely in the unknown state — measured, a progress
      bar with no fill beside a card printing "2 / 5" and "40%", on two
      components. `difficultyStyle()` now joins `tierStyle()` and no call site
      concatenates (grep: zero remain). F4 (VISIBLE, pre-existing): round 5 F8's
      other direction — seven definite dots, 4 flames, under "Weekly activity
      unavailable". F2/F3 (NOT-VISIBLE) are both **Round B's own work**: its tile
      helper covered two tiles of three, leaving the LEVEL tile unasserted and a
      fabricated Level 1 green past all three protections; and one of its four
      new Achievements assertions could not fail, because the regex was copied
      from a site where digits sit next to "XP" to one spelled "N total XP".
      **12 new mutations, 12 RED**, including a positive control; Round B's nine
      re-run and all still RED with identical counts. Suite 87/87.
      Also corrected: this card's round-9 prompt claimed "touched files 0
      problems", which was Round B's two test files, not the combined six-file
      diff — that is 1 pre-existing `ChevronRight` error, as Round A recorded.
      **ROUND 10 HAS RUN (2026-07-29): 4 findings, 1 VISIBLE, ALL FIXED.**
      F1 (VISIBLE): the week caption printed `weekly_workouts` — a count of
      SESSIONS since Monday — labelled "days active", above a strip whose flames
      come from `activity`, keyed by DAY over a ROLLING seven days. Two
      mismatches, not one (verified at `backend-ml/app/routers/workouts.py`
      :72-74 and :86-89). Measured: "5 of 7 days active" over three flames, and
      "10 of 7 days active" — a sentence that cannot be true. Round 9 F4 fixed
      the readiness axis of round 5 F8 and left the counting axis. Caption and
      dots now derive from ONE `weekDates()`. F2/F3/F4 (NOT-VISIBLE): neutral
      style slots asserted for presence but not neutrality (4 mutants survived);
      the completeness loop listing 5 of 7 fields **and** covering only the
      NEUTRAL tier, so the four known tiers had no check at all (found while
      fixing, not by the review); and the recommendation pill's background
      knowing one vocabulary while its label knew two.
      **13 mutations, 12 RED, 1 GREEN** — the green one declared: a
      date-dependent equivalent (a 24h shift changes nothing except across a
      Sunday). Round 9's protections re-run as regression: all still RED.
      Suite 90/90.
      **ROUND 11 HAS RUN (2026-07-30): 6 findings, 1 VISIBLE, ALL FIXED — AND
      THE CARD CLOSES ON IT, per THE CAP.** F1 (VISIBLE) was a REGRESSION ROUND
      10 INTRODUCED: `weekDates` does local calendar arithmetic and serialises
      in UTC, and round 10 routed the printed day number through the UTC string,
      so in IST between 00:00 and 05:29 every day number was one behind and the
      orange "today" cell showed yesterday — measured, 26 27 28 29 30 31 1
      against a calendar reading 27 28 29 30 31 1 2. In DST zones the same
      mixing duplicated a key in the spring-forward week and skipped one in the
      fall-back week. Fixed by returning `{ key, day }`: the key stays UTC
      because the backend buckets UTC, the day is local because that is what the
      user's calendar says. F2/F5/F6 fixed too (two assertions that could not
      fail — one dominated, one whose producer the round 10 fix had made
      structurally bounded; an orphaned JSDoc; two `new Date()` calls where one
      was claimed). **10 mutations, 9 RED**; the survivor is declared (P9: the
      strip reading its own instant can only diverge across UTC midnight).
      A gap the mutations found in round 11's OWN fixture is closed in the same
      commit: every activity key sat inside the displayed week, so "count this
      week" and "count every key" were the same number and the caption could
      abandon the Mon-Sun window unnoticed.
- [ ] 🔴 **Week strip date axis — render-side coverage.** Round 11 F3 measured
      TEN surviving mutants on this axis and round 11's fix closed the helper
      half with pinned-clock, pinned-TZ unit tests (`weekDates` now has three).
      What is still UNCOVERED is the RENDER side: no assertion in
      `xpDisplay.render.test.jsx` reads a day NUMBER, a label↔date relationship,
      or which seven days the strip covers, so "labels rotated", "Monday
      permanently highlighted" and "dates reversed" are caught only at the unit
      layer. Needs `vi.setSystemTime` plus a pinned TZ in the render file, which
      is why it is a line rather than a same-commit fix: fake timers interact
      with framer-motion's animation waits, and this card has twice recorded
      that a timing instrument chosen carelessly produces a vacuous assertion.
- [ ] 🟡 **`xpDisplay.render.test.jsx`'s week fixture re-implements
      `weekDates`.** Round 11 F4: the fixture computes its own keys with the
      same algorithm, `toISOString` included, so a helper wrong in the SAME way
      is invisible to it — which is exactly how round 10's UTC/local mixing
      survived there. The overclaiming comment ("a wrong helper cannot make this
      test agree with itself") is CORRECTED in place; the structural fix is to
      derive the fixture from a pinned clock and literal dates.
- [x] 🟡 **`ExerciseLibrary.jsx:63` — `DIFF_COLORS[exercise.difficulty] ||
      DIFF_COLORS.beginner` — DONE 2026-08-05** by the exercise-library repoint,
      the card this line was explicitly waiting for. `difficultyStyle()` now
      lives in `apps/web/src/pages/exerciseLibraryView.js` and returns a NEUTRAL
      style for an unrecognised value and **null** for a missing one, so the
      caller draws no pill at all rather than being handed a default that reads
      as a fact. Mutation-checked both ways (M20 restores the `|| beginner`
      fallback, M21 makes a missing difficulty draw a pill; both RED).
      **CORRECTED 2026-08-05 — this tick was the INSTANCE, not the class, and was
      briefly false.** The card's own T3 round 1 (F3) found a FIFTH site still
      live: `components/exercise/ExerciseDetail.jsx` carried its own private copy
      of `DIFF_COLORS` and its own `|| DIFF_COLORS.beginner`, on the panel that
      opens on EVERY card click — so this line said DONE while an ungraded
      exercise was still asserted to be `beginner` in green, one component over
      from the fix. Now fixed: that file imports `difficultyStyle` and draws no
      pill when there is nothing to say. **This is "fix the class, not the case"
      (:1239) recurring for at least the fifth time — the check that would have
      caught it is a grep for the OPTION (`DIFF_COLORS`), not for the symptom, at
      the moment of ticking.**
      **CORRECTED AGAIN 2026-08-05 by T3 round 2 (F2): the re-tick above cited
      M20/M21, which live in a DIFFERENT FILE and pin the GRID's pill.** Nothing
      rendered the detail panel, so round 2 put the defect straight back and all
      494 tests stayed GREEN — measured. A tick citing mutants that cannot fail
      for the code being ticked is the same defect as the tick it replaced, one
      level up. Now real: two render assertions open the panel and check the pill
      (absent for a row with no difficulty, present and correct for `beginner` —
      a PAIR, because the negative alone is satisfied by never drawing a pill),
      and **M28** restores the `|| beginner` in that file. M28 measured RED.
      **WAS:** Raised by round 11 under R1.1 as out of scope: a
      FOURTH site of the one-of-N shape round 7 F2 declared fixed as a class, on
      a screen this card does not own — an unknown difficulty painted as a
      definite `beginner`. Belongs to whichever card repoints the exercise
      library.
      **ROUND 7 (2026-07-27, fresh chat): 8 findings, 3 blocking, all fixed.**
      Seventh consecutive round in which the previous round's fix opened the
      next one. F1: `recsState` derived from the STATS read's loading flag —
      the recommendations request had no settled flag at all — so BOTH failure
      modes this card exists to delete fired at once, a false "unavailable"
      during a healthy load and a permanent "Loading…" against a hung backend.
      F2: round 6's difficulty "class fix" covered one site of three; the
      hard-red `else` was still live in ChallengeCard and ChallengeRow. There
      is one exported `difficultyColor()` now. F3: round 6's F11 ruling
      (an assertion whose stated failure mode the code cannot produce is
      vacuous) was violated by the F11 commit itself — a `/advanced/i` check
      that could never fail, whose false premise then propagated into two
      source comments, DECISIONS, OWED and the commit message. All corrected.
      Also: a stale comment naming deleted functions (F4), seven bare nullable
      fields rendering blank where siblings print "—" (F5), six bare
      `isCurrentUser` reads the record claimed were fixed (F6),
      `earnedBadgeCount([null])` throwing one layer inside F12's own fix (F7),
      a section that vanished when both lists were empty (F8), and an
      unencoded id in a route query.
      **ROUND 6 (2026-07-27, fresh chat): 12 findings, 3 blocking, all fixed.**
      Sixth consecutive round in which the previous round's fix opened the next
      one. F1 is the headline and it is the INVERSE of this card's defect:
      round 5's F2 fix made the earned-count null whenever any badge's `earned`
      is unknown, and the list's STATE borrowed that test — so a catalog that
      arrived and was rendered on screen got "Badges are unavailable right now."
      printed directly above two visible badge cards. Not a fabricated number;
      a false denial of content the user can see. Same rule, opposite sign.
      F2/F3: `recommendations` was a SECOND unparsed list in Dashboard — round
      5's claim that `recent_workouts` was "the ONE" was false. A non-array
      value reached `.slice().map()` and blanked the entire page (no
      ErrorBoundary), and six bare reads painted an unknown difficulty red and
      "advanced". Also fixed: blank loading arms in the strip (F4), a fabricated
      bronze tier ring (F5), three more empty-list states (F6), a literal
      "Invalid Date" (F7), nullable booleans read as definite-false (F8), a
      failed recent-workouts read looking like a zero-workout account (F9), a
      fourth false claim in the guard (F10), two assertions that could not fail
      for the class they named (F11), and a throw on `earnedBadgeCount(undefined)`
      (F12). `badgesKnown`/`challengesKnown` DELETED — dead surface that still
      carried five assertions, which reads as protection and is not.
      **ROUND 5 (2026-07-26, fresh chat): 8 more findings, 3 blocking, all
      fixed.** The pattern held a fifth time — round 4's own F4 fix created
      round 5's F1, and round 4's new readers created F2 and F3.
      F1: the per-tab captions branched on the ENVELOPE's state, so "200 with no
      list" matched neither arm and three tabs said "Loading…" forever after
      both reads had settled. F2: the new readers defaulted every BOOLEAN to
      `false` (only the 15 numeric/string fields were nulled), so a catalog with
      no `earned` field printed "0 of 40 badges" and "earn your first badge" —
      the round-2 fabrication restored through a default instead of an envelope
      gate. F3: `recent_workouts` was the one list left unparsed, so three
      Dashboard sites rendered "0 min · 0 kcal · 0% form" with the unknown
      accuracy painted RED. Plus a dead current-user highlight (F4), a badges
      tab that rendered nothing when the catalog was empty (F7), a caption and
      its dots gated on different fields (F8), a false consumer count in
      `useXp`'s comment (F6), and two `.catch(console.error)` leaking the axios
      config in Dashboard (R3.10).
      **F5 is the one to remember: round 4's 132-line "class fix" shipped with
      NO tests on the class** — every render fixture used empty lists, so
      `readBadge`/`readChallenge` never produced output any test looked at,
      which is exactly why F2 and F3 survived a round. Now 19 unit tests over
      all ten readers/formatters + 6 render tests that render a real badge,
      challenge and recent workout. The render tests also caught TWO more
      page-blanking ReferenceErrors in the round-4/5 edits themselves.
      It was ticked on the round-2 smoke; round 3 then found
      three behaviour defects that a click-through cannot see, so the tick was
      premature and comes off (the google-login / DPDP precedent). Re-ticks when
      the fixes have their own smoke AND a round comes back clean.
      **ROUND 4 (2026-07-26, fresh chat): 8 findings, all real, all fixed — the
      fourth consecutive round to find that the previous round's fix opened
      something new.** Headline: the source guard was defeated FOUR more ways
      (ten total across four rounds), including a destructure that FIELD_READ
      structurally cannot see, and a contradiction appended to FIELD_READ that
      disarmed the whole scan silently because it had no positive control.
      **Kd approved two new dev deps (jsdom + @testing-library/react) on
      2026-07-26 and the protection of record is now RENDER tests**
      (`apps/web/src/pages/xpDisplay.render.test.jsx`, 13 tests): the regex
      battery cannot win because source text has unbounded spellings for the
      same rendered output. All four of the reviewer's paste-in mutations were
      re-run against the fix and each goes RED — verified, not asserted. Round
      4's other findings: `statsKnown` was `Boolean(data)` under a new name so a
      `{stats:{}}` 200 still printed six zeros (F2); the week strip rendered
      seven inactive dots — seven claims — beside a caption reading
      "unavailable" (F3); `allSettled` decoupled the FETCH but every render was
      still gated on the overview payload, so a healthy leaderboard was thrown
      away and disclaimed (F4); seven element-level fields were still read bare
      (F5); the old payloads never crossed a parser at all, which is the CLASS
      behind rounds 2-4 and is now fixed with `readOverviewView` /
      `readLeaderboardView` / `readStatsView` (F6); `useXp` exposed one state
      where three exist, so a hung old backend + failed XP read hid the surface
      forever (F7); and three claims in the guard's own header were false (F8).
      Round 3's findings:
      an unguarded `leaderboard.leaderboard.map` — the twin of the read round 2
      claimed to have fixed — which blanks the whole page including the XP
      header on a partial 200; "Failed to load achievements" asserted while the
      old read was still IN FLIGHT (a failure claim during a healthy load, and
      permanent against a hanging backend, since mlApi sets no timeout); and
      `oldReady = Boolean(data)` testing the envelope rather than the field, so
      a 200 with `{}` still printed "(0/—)" and "earn your first badge".
      Commits `7750478` (build) +
      `f918cc4` (T3 round 2). RE-SMOKE PASSED (Kd) on the round-2 bytes: the
      strip read "330 XP · Level 2" / "230/248 to Lv 3" with the old backend
      OFF, the counters read "(—/—)" and "of —" rather than zeros, Achievements
      read "Level 2 / 330 total XP · — of — badges", and the sidebar read
      "Level 2 / L2".** Two fresh-chat T3 rounds (6 + 8 findings, all resolved);
      round 2's own headline was that round 1's fix had re-created this card's
      defect elsewhere, which is why the re-smoke was required rather than
      assumed. A third round was offered and not run — if one is ever run and
      finds something blocking, this tick comes off (the google-login / DPDP
      precedent). The Dashboard XP surfaces are a SEPARATE line below, Kd-ruled
      out of this card on 2026-07-26 and confirmed wrong by the same smoke.
      (GamificationStrip, Achievements). XP storage
      does not exist anywhere in Part 4 — inventing a column would violate R0.2,
      so the badges.py XP/level curve stays unported until a ruled migration
      card. (DECISIONS 2026-07-11 P2.3 GAP-1.)
      **RULED 2026-07-24 (Kd): KEEP the feature — add XP storage.** XP/levels is
      a live feature on the old backend and the no-removal rule keeps it; the
      GAP-1 deferral is now discharged by an explicit ruling to build its home.
      Next: a 🔴 migration card adds XP storage (column or small table, SQL
      reviewed by Kd — the onboarding-storage / user_fitness_profiles precedent
      for Kd-authorised schema beyond the spec) and ports the badges.py
      XP/level curve verbatim (R5.4). THEN the web XP display repoints.
      Dropping it was never on the table — no-removal.
      **API HALF ✅ MERGED TO MASTER 2026-07-26 as PR #50 (merge `47cc001`) —
      this line stays OPEN because its actual subject, the web display, is
      still on the old backend.**
      Migration `0008_user_xp` (1:1 `user_xp`, SQL reviewed by Kd) + the
      verbatim badges.py curve/constants in `gamification/xp.ts`; XP is
      RECOMPUTED from full history at every sync (never `$inc` — a retried sync
      would double-count), and `user_xp` is on BOTH DPDP lists (delete +
      export). `/v1/gamification/me` now returns an `xp` block
      `{total, level, xpInLevel, xpForNext, progressPct, nextLevelAt}`.
      ~~NB **`web-repoint` does not carry it yet**~~ — DONE: master merged into
      this branch at `1164a86` (2026-07-26), which is what put the `xp` block
      here before the web half was built.
      T3 ran FIVE fresh-chat rounds (25 findings, all resolved). The code has
      been stable since round 1's lock fix; rounds 2-5 were about evidence and
      records. Three behavioural guarantees each carry a mutation-verified test:
      the advisory-lock body, its CALL SITE (probed via `pg_blocking_pids`), and
      that `/me` reads stored XP rather than recomputing. api 366/366 on Neon.
      **READ BEFORE TOUCHING XP NUMBERS:** `xp.ts` carries a governing rule —
      *every recomputed input to every component diverges from the old backend*
      (day bucketing, activity-vs-sync time, retroactive backfill, the
      server-derived form score, and all four badge-stat inputs). The constants
      are verbatim; the TOTALS deliberately are not. Do not "fix" a difference
      against the old app without reading it.
      **STILL OWED (the web half, this line's actual subject):** repoint
      GamificationStrip + Achievements off `gamificationApi`'s old-backend
      `getOverview` onto the new `xp` block. TRAP, same class as the
      nutrition-targets card: the API speaks camelCase (`xpInLevel`) while the
      components read the old shape (`user.progress.xp_in_level`,
      `user.xp`, `user.level`) — a straight swap yields `undefined`, which
      renders as a plausible-looking blank rather than an error. The browser
      SMOKE is owed WITH that card (the API half ships no reachable UI and
      correctly claims none).
      **WEB HALF BUILT + SMOKE PASSED (Kd) 2026-07-26 — commit `7750478` on
      `web-repoint`. Box stays UNTICKED pending the T3 round below.**
      Sidebar + GamificationStrip ("Your Rank" only) + Achievements (header
      only) now read the new `xp` block via a `useXp()` hook on the Card-1
      cookie client; `readXpView` returns NULL rather than a default so no
      fabricated number can reach the UI, mutation-verified. Kd's SCOPE RULING
      (2026-07-26) put **Sidebar IN** — its `user?.level || 1` read a field the
      auth user shape does not have, so it rendered "Level 1" for everyone —
      and **Dashboard OUT** (different old endpoint; its own line below).
      SMOKE evidence, on a seeded account at total_xp 330 → Level 2 (a value
      chosen BECAUSE a fresh account is genuinely Level 1, which is what the old
      bug faked and so could not discriminate): sidebar read "Level 2 / L2";
      "Your Rank" read "330 XP · Level 2" with "230/248 to Lv 3"; the
      Achievements header read "Level 2 / 330 total XP" with "Failed to load
      achievements" BELOW it. The last two both prove the T3 ① fix — they
      rendered with the old backend switched off, which the first cut of this
      card could not have done. `/v1/gamification/me` matched all three.
      **T3 ROUND 2 DONE — 8 findings, all fixed, and it proved the round-1 fix
      had created a NEW instance of this card's own defect** (hoisting XP out of
      the old payload made the badge/challenge counters render "of 0" and "0 of
      — badges" on a failed read, asserting zeros where nothing is known — the
      state Kd's smoke ran in, and which I wrongly reported as correct). Also:
      the Achievements spinner still gated the header on the old backend; two
      unguarded payload reads could blank the page; and BOTH source guards were
      bypassable nine ways until redesigned as a positive rule. **RE-SMOKE OWED
      on these bytes** — the previous pass does not carry over, because what the
      two screens display with the old backend off has changed ("—", not "0").
      NB the SMOKE also exposed a Docker trap worth knowing: `aihg-dev-api-1`
      publishes port 3000 and points at its OWN Postgres, so with that container
      up the browser talks to a different database than a locally-run api and a
      login can fail for no code reason at all.
      SCOPE BOUNDARY (verified by grep, so the web card does not over-reach):
      those two screens ALSO render `badge.xp_reward` (Achievements.jsx) and
      leaderboard `entry.xp`/`entry.level` — those belong to the **badge
      catalog** and **leaderboard** lines below, NOT to this one. The per-badge
      tier XP those need IS already ported (`ACHIEVEMENTS[].tier` +
      `badgeXpForCodes`, in `gamification/badges.ts`), but it is not yet served
      by any endpoint and is NOT stored on the `achievements` table — the badge
      catalog card decides whether it needs a column.
- [ ] 🔴 **Round 8 F6's other EIGHT surviving mutants — NOT addressed by Round B,
      NOT re-measured.** F6's table listed twelve; Round B's prescription
      ("per-site identity assertions plus a whole-document numeric sweep on the
      DEAD fixture") covers the four NUMERIC render-site fabrications only —
      MUT-20/21/24/26, all four now mutation-verified caught. The other eight
      stand exactly as the reviewer measured them on 2026-07-28 and have NOT been
      re-run since, so this line records a round-8 measurement and not a current
      one: MUT-3, 4, 15, 16, 17 (`orUnknown(...)` → bare read at badge
      name/icon/xpReward and `ex.primaryCategory` — round 7 F5's own fix, which
      shipped with no test at any layer), MUT-29 (`entry.isCurrentUser === true`
      → truthy, round 7 F6's fix), MUT-2 (the recommendation pill's BACKGROUND —
      round 7 F2's own site, asserted on colour but not background), and MUT-10
      (`useXp` reporting a malformed 200 as ready). Recorded rather than folded
      in because Kd approved a plan naming exactly nine mutations (R1.1/S4) —
      and recorded AT ALL because "fix the class, not the case" plus an untracked
      known gap is the precise combination this card has lost rounds to. Close it
      in whichever round next touches these assertions.
- [ ] 🔴 **Badge catalog + challenges screens.** "Tables now, screens later"
      carve; needs catalog/challenges read endpoints. Challenges also need a
      scheduler for weekly rotation. (DECISIONS 2026-07-11 P2.3.)
- [ ] 🔴 **Leaderboard** (GamificationStrip, Achievements). P4.x work: Redis
      ZSET + snapshots, verified-entries-only for global boards (v1 §14).
      ⚠ SEQUENCING CONFLICT, recorded and NOT yet ruled: the playbook puts P4
      AFTER P2.8, but cutover requires every feature's endpoint to exist first.
      Kd must either land a minimal read early or explicitly accept a dark
      window. DECIDE AT THIS LINE — do not silently flip it.
      (DECISIONS 2026-07-16, Card 3.)
      **RULED 2026-07-24 (Kd): the feature STAYS and is built PROPERLY in P4;
      accept a temporary "coming soon" state at the cutover moment** (the
      framework's sanctioned dark-window option — NOT a removal; the leaderboard
      screen stays working on the old backend until cutover, and shows a
      "coming soon" placeholder only if P4 has not yet landed when the old
      backend is switched off). Rationale: at launch the DB is empty
      (DECISIONS 2026-07-13), so a global board has no entries to show, and it
      needs the full verified-entries-only anti-cheat (v1 §14) that is real P4
      work — a rushed empty board before cutover buys nothing. No feature is
      deleted or reduced; this only sequences WHEN its new-backend home is
      built. Revisit if Kd later wants it visible at cutover → then a minimal
      read lands early instead.
      **INHERITED THREAT MODEL — read before ranking anyone by XP** (from the
      XP card's round-5 review, full text in master's DECISIONS): XP is safe
      today ONLY because it grants nothing. Every one of its four components is
      client-determined. PRIMARY vector: fabricated workout VOLUME — each
      accepted sync of a fresh client-generated `workoutId` mints 50 (base) +
      up to 50 (perfect-form bonus, since `avgFormScore` is client-sent per set
      and the server merely averages it), and **`POST /v1/workouts/sync` has NO
      per-route rate limit** (verified: `app.authenticate` is its only
      preHandler). SECOND: backdated `startedAt` (no past/future clamp) mints
      +10 per fabricated distinct day. The moment a leaderboard ranks on XP,
      both become value-granting inputs — a per-route limit plus v1 §14.1
      plausibility checks (P4.y) are the home for closing them, and v1 §14's
      "verified entries only" for global boards is the other half.
- [ ] 🔴 **Predictions** (PredictionsSection) — the 2B §5 card (P2.3 carve).
- [x] 🔴 **Exercise library content — DONE 2026-08-05, ALL THREE GATES PASSED.**
      Code `b96c009` · browser SMOKE 9/9 (:5034) · T3 round 1, 7 findings, zero
      visible, all fixed (:5104) · T3 round 2 THE CAP, 3 findings, zero visible,
      all fixed (:5199). **28/28 mutants RED, 0 survived, 0 invalid, and every
      target verified restored byte-exact against HEAD rather than on the
      harness's own say-so** — which is the point, since round 2's F1 was that
      harness printing PASS over live damage. 496/496.
      **This line was UN-TICKED once and re-ticked here.** `b96c009` ticked it
      `[x]` while its own HANDOFF block said "smoke and the fresh-chat T3 are
      both UNRUN" — :4718's F4 exactly, reverted there and at :4119 before that,
      third occurrence on this branch. A ticked line is the answer to "is this
      still to do?", and review rounds were still to do.
      (the exercise-library
      repoint; DECISIONS 2026-08-05). The screen is off the old backend: the LIST
      comes from `/v1/exercises`, and the WORDS come from `EXERCISE_CONTENT` in
      `packages/shared/src/exerciseContent.ts` — a verbatim port of
      `scripts/seed_exercises.py`, joined by slug. **Kd ruled the file, not
      columns**, shown both options: the Part 4 §3.4 DDL declares no column for
      name text / description / instructions, adding them would be inventing
      schema (R0.2), and `name_key` exists precisely because v1 §14's "message
      keys, not strings" model puts human text in locale tables. So there is NO
      migration in this card.
      **The port was PROVEN, not asserted**: 58 rows × 14 fields = 812 values
      compared against the JSON that Python's own `ast.literal_eval` produced
      from the seeder — 0 differences.
      **Each of the five old behaviours is answered, none dropped:**
      display names ✓ · instructions / common mistakes / muscles / equipment /
      difficulty / category / cal-per-min / default reps+sets ✓ · media ✓ (it was
      always local files in `utils/exerciseMedia.js`, matched by name — the old
      metered RapidAPI endpoint had NO caller) · search + category + difficulty
      filters ✓ **client-side** · the "58 Exercises" headline ✓ (exact, since the
      whole catalog is read).
      **`ai_supported` was deliberately NOT ported** — the seed marks EIGHT true
      and the engine ships THREE definitions, so copying it would badge five
      exercises with camera form-checking that does not happen. Kd ruled the
      badge is derived from the definitions the client holds, so it is true today
      and lights up by itself as the P4 line publishes each one.
      **Two behaviour changes a smoke will see:** the library now lists **58,
      not 56** (Part 4 §3.4:366-369 — "the `REMOVED_EXERCISES` frontend hack dies
      with the migration"), and a FAILED read now says so instead of drawing
      "No exercises found" over an empty grid.
      **WAS:** display names, instructions, media/GIFs, server-side search. The
      Part 4 §3.4 catalog is data-only
      (slug/nameKey/family/tier/met/equipment/muscles) and stores none of it.
      Owed to the P4 production line / Part 2 Appendix A localization.
      (DECISIONS 2026-07-16, Card 3.)
- [ ] 🟡 **Mountain Pose and Brisk Walking have no artwork — the only two of the
      58, and they are exactly the two this card un-hid.** Raised by the exercise
      library's T3 round 1 (2026-08-05) as a record note rather than a violation,
      and given a line here because **it is the one thing on this card a USER CAN
      SEE** and it was written down nowhere — neither DECISIONS :5002-5007 nor the
      smoke doc named it, so the next smoke run would report it as a defect (and
      the run on 2026-08-05 nearly did).
      **Measured, not inferred:** driving all 58 content names through the real
      `getExerciseMedia` lookup returns null for exactly these two; 56 of 58
      resolve. So both draw the 🏋️ placeholder card and open a detail panel with
      no photo and no GIFs.
      **Not a regression and not dishonest** — no artwork exists for them, and
      the alternative (hiding them) is the `REMOVED_EXERCISES` hack that Part 4
      §3.4:366-369 rules "dies with the migration". Closing this means SOURCING
      two images and two GIF pairs, which is an asset task, not a code one.
      Blocks nothing.
- [ ] 🟡 **Hindi and Assamese exercise copy.** `EXERCISE_CONTENT` is ENGLISH
      ONLY. This is not a regression — the old backend was English-only too — but
      it is the half of the 2026-08-05 ruling that is not yet built, and the
      ruling is what makes it buildable: the words are now a file keyed by slug,
      so translating them is a translation task and not an engineering one (Part
      2 Appendix A's own words about the fault-message table). Blocks nothing
      until a pilot gym wants it; belongs with the Appendix A locale work.
- [ ] ⚪ **Server-side exercise search, if the catalog ever outgrows one page.**
      Answered for now rather than deferred: 58 rows over a 100-row page limit is
      ONE request, so search and filters run in memory and respond with no round
      trip. **Re-entry trigger, stated so it is not a judgement call later:** if
      the catalog passes ~100 rows the client starts making two or more requests
      before it can draw anything, and `catalogListQuerySchema` (`.strict()`,
      `{limit, cursor}`) would need a search parameter. `CATALOG_MAX_PAGES` = 20
      is the guard until then, and a truncated read tells the user rather than
      drawing a short library.
- [ ] 🟡 **The Dashboard's "open this exercise" link still sends an OLD-backend
      id.** `Dashboard.jsx` links `/exercises?exercise=<ex.id>` where `ex` comes
      from `recommendationApi` — still on the old backend, so the id is a Mongo
      ObjectId. The library now resolves that parameter as a SLUG against the
      rows it has already read, so an old id matches nothing and simply opens no
      panel — which is exactly what a stale id already did, and the link is
      dead today anyway (the old backend gets no token since Card 1). NOT
      half-fixed from the library side: inventing a Mongo-id→slug map would be
      the fabrication class this project keeps deleting. **Closes with the
      recommendations repoint**, which owns the id.
- [x] 🔴 **THE EXERCISE CATALOG — DONE 2026-08-01** (DECISIONS :3538, commit on
      `web-repoint` the same day). 3 → **58** rows, verified against the live DB
      (`SELECT count(*) FROM exercises` = 58; pose 57 / timer 1). The reviewed
      table is `CATALOG_58` in `packages/shared/src/exerciseCatalog.ts` — Kd
      signed it off before any code was written (artifact `docs/catalog-58.md`),
      and the two SPEC GAPs in it were ruled by Kd (both F11: `brisk_walking`
      had no family, `arm_circles` had two). The seed imports that one table, so
      the API and the web cannot drift on what an exercise is called;
      `slugForLegacyName` is exact-match and returns null rather than guessing.
      api 381/381 · shared 41/41 · 9 shared mutants + 1 DB mutant, all RED
      against a verified green baseline. **The write-path line below is
      unblocked by this.** The original entry follows.
      **WAS: the exercise catalog holds 3 rows — every other exercise a user can
      pick is UNKNOWN to the new API, and its sets are SILENTLY DISCARDED.**
      Created 2026-08-01 (DECISIONS :3424), found while planning the web write
      path. **It had NO line anywhere in this file** — the gap was visible only
      as prose inside the write-path entry below ("nearly every exercise is
      log-only TODAY"), which is about DEFINITIONS, a different thing: an
      exercise can be hand-logged without a definition, but it cannot be STORED
      without a catalog row. Same shape of miss as the write-path line itself.
      **The chain, command-verified 2026-08-01:**
      1. `db/seed.ts:201-203` seeds exactly **3** exercises (squat, jump_squat,
         chair_squat) and `db/seed.ts:254` is the **only** insert site in
         `apps/api` (grep: one hit). The Mongo→PG tool adds none and says so
         (`tools/migrate-mongo/exerciseNames.ts:4-6`).
      2. `modules/workouts/repo.ts:58` filters sets whose slug has no row;
         `:71` flags the workout `unknown_exercise`; the parent workout is
         inserted REGARDLESS, so an all-unknown payload lands as a workout with
         `sets_count = 0`, `total_reps = 0`.
      3. `db/schema/training.ts:55-57` — `workout_sets.exercise_id` is NOT NULL
         with an FK, so "store it anyway" needs a migration AND an R0.3
         deviation against Part 4 §3.5. Kd did NOT choose that.
      4. There is **no name→slug resolver for a log-only set**. The engine path
         is unaffected only because definitions carry the plural legacy name as
         an alias (`definitions/squat.json:3`) and the compiled config takes the
         definition KEY (`definition/compile.ts:89`).
      **⇒ Until this line is closed, a hand-logged workout of anything but those
      three exercises would be ACCEPTED and then emptied — worse than today's
      missing data, because it writes a 0-rep workout into history.**
      **THIS BLOCKS THE WEB WRITE PATH BELOW** (Kd's ruling, DECISIONS :3424:
      catalog first). Scope when it runs: catalog rows for every exercise a user
      can pick, plus a REVIEWED name→slug table (the P1.8a-precedent instrument
      already exists in miniature at `tools/migrate-mongo/exerciseNames.ts`,
      covering **14** legacy names — not the library).
      **CORRECTED 2026-08-01, same day (DECISIONS :3501) — this line first
      claimed an OPEN RULING here and there is none.** The three unmapped legacy
      names (`exerciseNames.ts` rows 12–14: Arnold Shoulder Press, 1-Arm
      Half-Kneeling Lat Pulldown, 1 Leg Box Squat) are **not in the library**
      (`grep -in "arnold\|lat pulldown\|box squat" scripts/seed_exercises.py` →
      no match), so no user can pick or hand-log one; they exist only in historic
      legacy workout rows, which the migration already skips + flags. The spec
      rules the case directly: Part 4 §3.4:373 — "`arnold_shoulder_press` stays
      unseeded — first expansion candidate". **Nothing is owed for the write
      path, and Kd must NOT be asked to rule on it.**
      **The catalog decisions this card DOES need are likewise already ruled**
      (Part 4 §3.4:366-372): Mountain Pose → `status 'live'`, T3, F12, MET 2.3
      (the frontend's `REMOVED_EXERCISES` hack dies with the migration) · Brisk
      Walking → `tracking 'timer'`, excluded from every form-score surface.
      Catalog size is **58** (Part 2 §6:721, "verified, v1.1"); the visible
      library is 56 because of that same frontend hack.
      NOT this line: display names, instructions, media/GIFs and server-side
      search, which are the separate "Exercise library content" line above.
- [x] 🔴 **THE WORKOUT WRITE PATH — DONE 2026-08-02** (DECISIONS, web-repoint).
      Both halves shipped: the API half on 2026-08-01, the WEB half now. A
      hand-counted workout of any of the 58 catalog exercises reaches the new
      API with its real rep count, its own set ordinals and a per-set duration.
      **Kd's browser SMOKE PASSED and was verified in the database**, not merely
      in tests: a 3-rep hand-logged Push-ups set stored as `mode 'log_only'`,
      duration 19.2 s, `avg_form_score` NULL, `bundle_version` NULL, and
      `quality_flags []` — i.e. the server recognised the exercise rather than
      discarding the set. XP updated at the sync second.
      web 310/310 · 13 mutants across 2 files, all RED against a verified green
      baseline, all targets restored byte-for-byte · lint identical to HEAD ·
      TWO fresh-chat T3 rounds (5 findings each, ZERO VISIBLE in both), closed
      under the two-round cap.
      **THE TWO THINGS THIS LINE WAS HOLDING NOW HAVE THEIR OWN LINES BELOW** —
      the legacy dual-write removal, and a hole the web half creates. Neither is
      allowed to travel inside a ticked entry. The original follows.
      **WAS: and the ruling under it: where does a
      HAND-LOGGED workout live after the old backend is off?**
      Created 2026-08-01 (DECISIONS :2912). This was visible only as prose inside
      the calendar line below (:514) and had no line of its own; the audit rule
      exists for exactly this shape of miss.
      **The chain, every link command-verified this session:**
      1. `engine/sessionController.js:67` — `if (def == null) return; // no
         definition yet → log-only`.
      2. `ls packages/engine/src/definitions/` = **3** (squat, jump_squat,
         chair_squat) against the **58**-exercise catalog (CLAUDE.md:106). So
         nearly every exercise is log-only TODAY.
      3. `sync/syncClient.js:72` — an all-log-only workout is never queued.
      4. DECISIONS :75 — the server ENFORCES `sets[]` non-empty, so it would
         reject one even if sent.
      5. `pages/ActiveWorkout.jsx:536` — every workout is still written to the
         OLD backend via `completeSession`.
      **⇒ Today the new API holds only workouts containing one of three
      exercises. ⇒ After P2.8 switches the old backend off, a workout of any
      other exercise would be saved NOWHERE AT ALL.** That is data loss on the
      product's core action, and it blocks the cutover on its own terms.
      **What is owed FIRST is a Kd RULING, not code.** "All-log-only workouts are
      NOT synced" is Kd-approved (DECISIONS :67, P1.10c 2026-07-10) and was right
      for the sync contract — with no SetSummaries there is nothing
      engine-verified to send. It becomes a different question once the old
      backend is the only place those workouts live. Options exist (a log-only
      workout shape the server accepts; a separate manual-log surface; gating on
      P4 shipping definitions) and each has a different blast radius — R0.2, so
      none may be picked by a chat.
      **What it unblocks:** the calendar below, PostWorkout's summary, the
      Dashboard's stats — every workout-history surface reads whatever this
      ruling decides.
      **RULED AND API HALF DONE 2026-08-01 (DECISIONS :3085).** Kd ruled option
      A: the new API accepts hand-logged workouts. Part 6 §3.6 already promised
      it in its own user-facing copy ("your workout still counts"), so this was
      honouring the spec, not a new product call. Migration `0009_log_only_sets`
      (expand-only, SQL reviewed by Kd first) + the `setSummarySchema` union +
      the sync/read paths landed with 9 new real-Postgres tests, api 373/373.
      **[RULED 2026-08-01 — option A, DECISIONS :3298. No longer blocking.]**
      **WAS: blocking sub-item, open for Kd (T3 round 1 F3, DECISIONS :3199):** an
      all-log-only workout must still send a WORKOUT-level `engineVersion`
      (required string) and `defsVersion` (required positive int), both stored
      and served back by `GET /v1/workouts/:id`. The API card's own test hides
      this by hardcoding `"1.0.0"`/1 — the fabrication deleted at set level,
      performed at workout level by the fixture. It is invisible today and
      becomes real the moment the web half lands: `syncClient.js:40` builds that
      value as `summaries[0].engineVersion`, which does not exist when there are
      no summaries, so the next card must either invent a number or change this
      contract. Options: (a) make `defsVersion` nullable — matches Part 4
      §3.5:384, which declares `bundle_version int` NULLABLE while the payload
      forbids null; shared-schema only, no migration — and record that
      workout-level `engineVersion` means "the engine build the client was
      running", honest and non-null even when nothing was scored; or (b) a
      DEVIATION PROPOSAL to make `workouts.engine_version` nullable, which the
      spec declares NOT NULL (R0.3).
      **RESOLVED: Kd chose (a).** `engineVersion` at workout level now means
      "the engine build the CLIENT was running" — true whether or not anything
      was scored — and `defsVersion` is nullable, matching the spec DDL. No
      migration, no deviation. The web card can now build an all-log-only
      payload without inventing a number.
      **THE WEB HALF IS WHAT REMAINS AND THIS LINE STAYS OPEN FOR IT:**
      `ActiveWorkout.jsx:536` still posts every workout to the legacy backend and
      `syncClient.js:72` still refuses to queue an all-log-only one, so NOTHING
      has changed for a user yet and the cutover is still blocked. That is the
      next card. Also owed with it: `queueWorkoutSync` must build the log-only
      set shape, and the client must stop calling `completeSession`.
      **PLANNED 2026-08-01 AND BLOCKED, BOTH HALVES RULED BY Kd (DECISIONS
      :3424) — do NOT start this card until the CATALOG line above is closed:**
      1. ~~**BLOCKED ON THE CATALOG.**~~ **DISCHARGED 2026-08-01** (DECISIONS
         :3538): all 58 are seeded, so a hand-logged set of any pickable
         exercise now resolves to a real row. **This card is READY TO START.**
         It must resolve the exercise NAME through `slugForLegacyName`
         (`@app/shared`) — never by lowercasing the name itself, which resolves
         nothing (the slugs are singular, the names plural), and never by
         inventing a slug on a null, which the server would discard.
      2. **`completeSession` STAYS — the removal above is DEFERRED, not done,
         and this line is what holds it.** The web card DUAL-WRITES (new API in
         addition to the legacy save), exactly as engine workouts already do.
         Removal is discharged only when the post-workout summary, the Dashboard
         stats and the calendar have new-API homes; dropping it today makes the
         summary screen print duration/calories/form as 0 **and a plausible
         "+50 XP" that was never awarded** (the old handler recomputes that
         number: `backend-ml/app/routers/workouts.py:591`) — a screen that looks
         true and is false. No-removal rule: replacement before removal.
      3. **When it runs, hook `handleSetComplete` (`ActiveWorkout.jsx:386`) — the
         single funnel — plus the three `engineSetKey` bump sites (:426, :483,
         :508) and the discard at :359-366. NOT the rep-counter trigger:** a
         "Complete Set" BUTTON at :1004 ends a set before the rep target, and
         hooking the counter would lose every early-ended set.
      4. Also owed with it (recorded at DECISIONS :3332): the local
         `syncClient.test.js` "window is not defined" failure is fixed by THIS
         card, not by the catalog card (R1.1).
      5. **THE TRAP THAT WOULD RECORD EVERY HAND-LOGGED SET AS 0 REPS.**
         Command-verified 2026-08-01: the manual rep count lives ONLY in the
         `setReps` STATE (`ActiveWorkout.jsx:156`) and **nothing mirrors it into
         a ref** (grep: no `setRepsRef` exists). `handleSetComplete` is a
         `useCallback` whose deps (`[targetSets, restDuration, exercises,
         voiceOn]`, :412) rarely change after mount, so it stays pinned to an
         early render — reading `setReps` inside it yields that render's stale
         value. This is the SAME hazard the file already documents at :120-129
         for `elapsedSecs`/`repFormScores`, which is why `elapsedSecsRef` exists.
         A ref is required, or every hand-logged set syncs 0 reps while the
         screen shows the right number.
      6. Per-set DURATION has no source either: the page tracks whole-session
         elapsed time, movement-gated active seconds and total rest, but nothing
         per set — and `durationMs` is REQUIRED and non-null on every set in the
         wire contract. A per-set start timestamp is part of this card (wall
         clock is fine here — R5.1 binds `packages/engine`, not `apps/web`).
      7. Decided but not yet built (state it in the card's PLAN so it is
         reviewable): a set with 0 reps is not sent (nothing happened), and if
         an exercise name cannot be resolved to a slug the workout is NOT synced
         at all rather than synced partially — the legacy save still holds it,
         so nothing is lost while `completeSession` stays.
- [x] 🔴 **REMOVE THE LEGACY DUAL-WRITE (`completeSession`) from ActiveWorkout.**
      **DONE 2026-08-16.** Browser smoke **PASSED 9/9** with no old backend
      running at all (`RUNBOOK/smoke-dual-write-retirement.md` §RESULT); the
      mutation sweep — killed part-way on the first attempt, hence the earlier
      wording here — completed at **64 mutants · 55 RED · 4 alive · 5 not
      applied**, the nine bad rows being the pre-existing camera ones with their
      own line; and the fresh-chat T3 ran **two rounds**, round 1 finding one
      Critical/High (the Start button's error path deleted, DECISIONS :8610) and
      round 2 finding **ZERO Critical/High**, which is the severity gate's own
      ship condition (:5348). Ticking on code alone would have been :4718 F4 /
      :5034 — this ticks on code, a browser, a completed sweep and two reviews.
      The rest of this block describes what landed.
      `createSession` and `completeSession` both retired,
      in one card, as this line required. Every finished workout is now written
      ONCE, to `POST /v1/workouts/sync`, and starting a workout asks nothing of
      any server.
      **The condition was DISCHARGED, not waived** — each of the three surfaces
      named below was re-checked in the code before a line was deleted: the
      post-workout summary reads `GET /v1/workouts/:id/summary`
      (`PostWorkout.jsx:361`), the calendar reads `/v1/workouts`
      (`WorkoutCalendar.jsx:231`), the Dashboard reads `api/dashboardStats.js`
      (`Dashboard.jsx:14-16`). **The "+50 XP" this entry warns about is now
      computed by the NEW server** (`modules/workouts/service.ts:322`,
      `xpEarnedForWorkout`) and rendered from `summary.xpEarned`
      (`PostWorkout.jsx:223`), so the failure it describes is unreachable.
      **A FINDING WORTH KEEPING: the legacy write had not been landing anyway.**
      `mlApi` sends a Bearer token read from `localStorage.accessToken`, and
      nothing has written that key since Card 1 moved auth to cookies
      (grep-verified: three hits, all reads). The old backend accepts nothing
      else (`backend-ml/app/core/security.py:16`, `HTTPBearer`). So the four
      OTHER old-backend surfaces fed by this write — badges, challenges, the
      leaderboard, predictions — were already frozen and cannot have been
      degraded by removing it. Each has its own line above, under Kd's
      dark-window ruling (:1020).
      **Also discharged by this card: the offline-start line below**, which
      named it in advance.
      Tests: 15 assertions measured RED against the pre-card source before the
      change was restored byte-exact. Smoke:
      `RUNBOOK/smoke-dual-write-retirement.md`.
      The original follows.
      Created 2026-08-02, lifted OUT of the write-path entry above as that entry
      was ticked — it was item 2 there and the entry said in terms "this line is
      what holds it", so ticking without re-homing it is precisely the silent
      loss the deferral rule exists to stop.
      **NOT A CLEANUP. Replacement before removal (Kd's ruling, DECISIONS
      :3424):** every finished workout is still written to BOTH backends, and
      the old one is what the post-workout summary, the Dashboard stats and the
      workout calendar read. Dropping the call today makes the summary screen
      print duration, calories and form as 0 **and a plausible "+50 XP" that was
      never awarded** — the old handler recomputes that number
      (`backend-ml/app/routers/workouts.py:591`). A screen that looks true and
      is false.
      **Discharged only when all three of those surfaces have new-API homes.**
      **PROGRESS 2026-08-06: one of the three is DONE** — the post-workout
      summary now reads `GET /v1/workouts/:id/summary` on the new API
      (DECISIONS, this date). The calendar was already repointed (:4622). **What
      remains is the Dashboard's stats**, its own line below.
      **AND A COUPLING THAT WAS NOT WRITTEN DOWN UNTIL NOW:** `createSession`
      cannot be dropped BEFORE `completeSession`, because the legacy save needs
      the session id the legacy start hands out. They retire together, in one
      card, after the Dashboard line below is ticked. A chat that proposes
      deleting either one alone has not read this paragraph.
- [ ] 🟡 **NINE MUTANTS GUARDING THE CAMERA-HANDOVER FIXES NO LONGER PROTECT
      ANYTHING — measured 2026-08-16 by the dual-write retirement's own sweep,
      and PRE-EXISTING, which was measured too rather than assumed.**
      `apps/web/tools/mutate-write-path.mjs` ran to completion for the first time
      since the camera cards landed: **60 mutants · 47 RED · 4 ALIVE · 5 NOT
      APPLIED**. All nine bad rows sit in the camera-stall / rep-ownership
      subsystem, which the dual-write card did not touch.
      **ALIVE (the anchored line still exists; no test notices it changing):**
      M44 a redo silently un-stalls a camera that is still dead · M50 a camera
      error is not sticky, so the camera takes the set back on recovery · M52
      backgrounding the tab kills the set's grading · M53 a redo carries the
      stall even when the camera is alive.
      **NOT APPLIED (anchor text no longer exists — silent disarmament, :5199's
      class):** M5 the set clock never restarts · M21 a camera error no longer
      offers hand counting · M28 the frame heartbeat is never updated · M40 the
      round-2 F1 bug put back · M43 the heartbeat is not re-stamped when the tab
      returns. Four one-line arrow functions were reformatted into blocks by a
      later card and every anchor through them stopped matching.
      **THE MEASUREMENT THAT MAKES "PRE-EXISTING" A FACT:** the entire pre-card
      tree — three sources AND three test files — was restored to `HEAD`, the
      baseline confirmed green at 157, and the four ALIVE mutants re-applied
      there. **All four are ALIVE at HEAD too**, so the dual-write card's seven
      re-anchored waiting points did not cause this. Restores sha256-verified.
      **WHY IT MATTERS: every one of these guards a defect Kd hit in his own
      browser** — :3917, :3987 and :4023 are three consecutive T3 rounds of the
      same user action (backgrounding the tab, redoing a set) losing a set's form
      score by a different route each time. The CODE still carries those fixes;
      what is gone is anything that would notice them being undone.
      **This is exactly :5348 rule 4's "tests that stay green are liars", found
      by the instrument rather than by a review.**
      **NOT FIXED HERE (R1.1):** re-anchoring five mutants and writing four
      assertions is a different card's diff, and the fix must not be
      re-anchoring alone — a mutant re-aimed until it goes red proves nothing
      (:4718 F2). Its card re-anchors, then measures each of the nine RED, then
      writes the missing assertion where it is not.
      **Its card should also add the guard this cannot have: the harness must
      fail LOUDER than exit 1** — the previous sweep was killed part-way and the
      table prints only on completion, so nobody could see which rows were bad.
- [ ] 🟡 **A USER CAN SAVE A BODY WEIGHT THE APP HAS NO BUSINESS ACCEPTING, AND
      EVERY CALORIE AND NUTRITION NUMBER IS COMPUTED FROM IT.** Found 2026-08-16
      during the dual-write smoke — **by Kd's question, not by the sheet**, which
      passed 9/9 with the defect on screen the whole time (:7222's shape).
      His account holds `users.weight_kg = 787.00`. **The formula is right and
      its INPUT is wrong**: `kcal = MET × weight × hours` (`calories.ts`), so his
      12 squats priced at 6.0 × 787 × 0.01356 h ≈ 64 kcal + rest = **65 kcal
      where a plausible weight gives ~6**.
      **The app never objected.** `weightKg` is bounded only by
      `numeric(5,2)`'s own range — `z.number().positive().lt(1000)`
      (`packages/shared/src/users.ts:41`, and the same bound again in
      `nutrition.ts:133`), and `Onboarding.jsx:291` mirrors it with "enter
      1–999 kg". **1–999 kg is a COLUMN's range being used as a HUMAN's range.**
      **What it reaches:** every workout's `kcal_point`, the Part 2B nutrition
      targets (Mifflin-St Jeor takes weight directly), and anything downstream
      that bands or totals calories.
      **What it does NOT do — stated so the severity is not overstated:** the
      figure shown is arithmetically TRUE for the weight stored, so this is not
      :5807's "on screen AND wrong" in the app's own terms. It is a missing
      plausibility bound on a value the whole calorie model rests on.
      **NOT FIXED HERE (R1.1)** — out of the dual-write card's diff entirely.
      Its card needs a NUMBER, which R0.2 forbids inventing: the spec names no
      bound, so the range is Kd's ruling, and the two schema sites plus the
      onboarding copy must move together or they will disagree (:1239, the class
      not the case). Kd was told about the 787 the moment it was traced.
- [ ] 🟡 **THE UNCATALOGUED-EXERCISE GUARD NOW MEANS THE OPPOSITE OF WHAT IT
      WAS BUILT TO MEAN, AND ONLY ITS COMMENT SAID SO.** Found by the
      dual-write T3, round 1, L-4. `queueWorkoutSync` refuses to sync a WHOLE
      workout if any one of its exercises has no catalog row
      (`apps/web/src/sync/syncClient.js`). **That was the safe choice while a
      legacy save existed to hold the workout intact; since 2026-08-16 there is
      no second save, so refusing now stores the workout NOWHERE.** The comment
      justifying it named the deleted function by name and has been corrected in
      place; the BEHAVIOUR is unchanged, deliberately.
      **Unreachable today and that is the only reason it is 🟡 rather than
      blocking**: all 58 library names resolve (asserted in
      `activeWorkoutEngine.test.js`), so no user can reach it. **It arms itself
      the moment a 59th exercise is added** — which P4 does routinely, on the way
      to 58→more definitions, and the person adding it will not naturally look
      here.
      **The ruling it needs is a choice between two losses** and is Kd's, not a
      chat's: sync the workout WITHOUT the unknown sets (a record that
      under-reports what the user did), or keep refusing (no record at all).
      A third option exists and may be better than both — resolve the name at
      sync time and reject at the CATALOG level instead, per DECISIONS
      2026-07-10's "unknown slug does NOT 4xx the sync" ruling, which already
      settled the same question on the server side and points at accepting the
      workout while flagging it.
- [x] 🔴 **THE DASHBOARD'S STATS HAVE NO NEW-API HOME (`workoutService.getStats`).**
      Created 2026-08-06 by the post-workout-summary card, which deliberately did
      NOT touch it (one backend surface per card — :2158's recorded lesson that
      eleven review rounds was a fault of the CARD's scope).
      `Dashboard.jsx:305` calls the old backend's `/workouts/stats` for total
      workouts, total calories, total minutes, this week's count, the 7-day
      activity strip and the last 5 workouts.
      **Most of it already exists on the new API and needs composing, not
      building:** `/v1/progress/overview` carries totals and streak,
      `/v1/gamification/me` carries level and XP, `/v1/workouts` carries the
      recent list, `/v1/progress/heatmap` carries daily activity. What has no
      home is the WEEKLY count and the exact shape.
      **This line is what the legacy dual-write above is waiting on.** Until it
      is ticked, `completeSession` stays and the app needs three servers to run.
      **DONE 2026-08-16 — smoke 10/10 and THREE fresh-chat T3 rounds, the last
      finding ZERO Critical/High in the code** (DECISIONS :8267, :8340, :8405).
      The two rounds in between each shipped a Critical in the SAME empty state —
      first denying a real history, then telling brand-new users their plan hid
      one — which fired Part I §2.5's escape hatch. **Kd ruled for the redesign
      over a third patch**, and `workoutPageSchema` gained `hasAnyWorkouts`
      because the plan gate alone cannot tell a new account from a gated one.
      That made this card touch `apps/api` after all — the "web-only" scope below
      was true when written and stopped being true at round 2.
      **This unblocks the legacy dual-write line above.** Web-only; no migration, no new endpoint, `apps/api` untouched.
      **THE "WEEKLY COUNT HAS NO HOME" CLAIM ABOVE IS FALSE and was corrected by
      measurement, not by opinion:** `/v1/progress/trend?period=7d` reports
      `workouts` per DAY (`repo.ts:354-359`, `GROUP BY day` in the user's own
      timezone), so the week's count is the sum over this week's days and the lit
      dots are the same days with a non-zero count. **ONE read now answers both**,
      which makes round 10 F1's defect — a session count printed over a picture
      of days, "10 of 7 days active" — unreachable by construction rather than by
      two fields agreeing. `/v1/progress/heatmap` was NOT used: it is a fixed
      365-day read where seven days are wanted.
      **FIVE THINGS A USER CAN SEE CHANGED** (three listed below when this was
      written; the empty-state rewrite and the form-score colour ladder are the
      fourth and fifth — see `BACKLOG.md` L24 and DECISIONS :8340), **all of them
      corrections:**
      (1) **The seven dots move to the user's OWN timezone.** The retired
      `weekDates` keyed by `toISOString()` — the UTC day of a locally-computed
      date — deliberately, because the old backend bucketed by
      `datetime.utcnow()`. Its own JSDoc called the residual "the existing OWED
      timezone-capture item, not this card's to fix"; this is the card that fixes
      it, and the key had to follow the server. Pinned by unit tests in BOTH
      directions (Asia/Kolkata and America/New_York) with the TZ-switch positive
      control, because under UTC the two spellings are identical and the
      assertion would be inert (:4267 F2's trap).
      (2) **"All time" becomes "last 90 days" on a gated plan.** `period=all` is
      unbounded so the plan floor cuts it EVERY time; the page printed "all time"
      over the clamped total, which is :598's f.4 on the first screen a user
      sees. `totalsWindowLabel` joins `heatmapCaption`/`recordsNote` in
      `progressClamp.js` — one ladder, three period-less captions.
      (3) **A recent workout's duration is a real duration.** The old payload
      carried whole MINUTES; the new one carries milliseconds, and rounding to
      match is :4182 verbatim (8,491 ms printed as "0m"). The rows reuse the
      CALENDAR's `readCalendarSession` + `formatDuration`/`formatKcal`/
      `formColor`, so the two screens cannot describe one workout two ways.
      **THE TOTALS WILL DROP for anyone with pre-August history, and this is not
      a defect:** the new database holds only what has been synced since the web
      write path shipped. The migration at P2.8 is what closes it. Kd was told
      before the card ran.
      **FOUND BY THE MUTATION AUDIT, not by review or by writing the code:**
      nothing pinned WHICH windows the page requests. Every fixture mocks the
      network functions, so they answer identically whatever they are asked — a
      page asking `period=30d` and captioning the answer "all time" passed every
      other test in the file. An argument assertion now pins all three calls
      (P1 RED).
      **AND THE AUDIT'S OWN ROW WAS WRONG FIRST:** P5 came back ALIVE, and the
      mutant was never the problem — the row named a test that reaches the
      UNKNOWN arm, where the mutation is inert by construction. Re-aimed at the
      lit-dots invariant it fails `expected +0 to be 2`, measured. :4718 F2's
      class from the other side: a `-t` filter makes the mutant→assertion mapping
      a one-line thing to get wrong, and a wrong mapping reports as a missing
      test.
      web **615/615** (was 586; +29) · `vite build` ✓ · eleven touched files
      lint clean · **15 mutants, 15 RED, 0 ALIVE, 0 never ran**, restores
      sha256-verified (`apps/web/tools/mutate-dashboard-stats.mjs`).
      **WHAT THIS UNBLOCKS AND DOES NOT DO:** :3424's condition for retiring
      `completeSession` + `createSession` — "until the Dashboard's stats have a
      new-API home too" — is now MET, so that pair is unblocked and retires in
      its OWN card. Nothing about how a workout is SAVED changed here, and a chat
      that reads this paragraph as licence to delete either call has not read the
      coupling paragraph above it.
      **UNRUN, and the tick waits on both:** `RUNBOOK/smoke-dashboard-stats.md`
      (8 steps; step 5 — are the flames on the right days — is the one worth
      doing in the evening or early morning, since that is the window the old
      UTC key was wrong in) and the fresh-chat T3.
- [ ] 🟡 **THE POST-WORKOUT SCREEN PRINTS THE INDIAN DATE FORMAT TO EVERY USER
      ON EARTH.** Created 2026-08-15 by the Dashboard-stats card. **Found by KD'S
      QUESTION, not by a review**: he asked whether the app was becoming
      India-specific, since it is meant for users everywhere. It was checked
      rather than reassured, and this is what the check found.
      `PostWorkout.jsx:133` hard-codes `toLocaleDateString('en-IN', …)`, so a
      user in Berlin or Chicago reads the day-month ordering of a country they
      are not in. **Cosmetic-but-WRONG-for-the-reader**, which is why it is 🟡
      and not ⚪: nothing is false, but the app is speaking one country's
      convention to everyone.
      **The Dashboard's own copy of this WAS fixed in the same card**, because
      that line was already being rewritten for the repoint — `[]` (the visitor's
      own locale) is what `Nutrition.jsx` and `Running.jsx` already pass, so the
      correct spelling was already in the codebase three times over. PostWorkout
      is out of that card's files (R1.1) and gets its own line rather than a
      drive-by edit.
      **Two SIBLINGS found in the same grep and NOT fixed either**, so the next
      card does the class and not the case (:1239, recorded violated at least
      five times): `MeasurementsTracker.jsx:245,:386` and `WorkoutCalendar.jsx:58`
      and `Settings.jsx:501` hard-code `'en-US'`. Same defect, different country.
      **NOT a defect and deliberately left alone:** `gyms.timezone` defaults to
      `Asia/Kolkata` and `currencyDisplay` to `INR` (`db/schema/tenancy.ts:27-29`).
      That is the SPEC's own DDL — `04-part4-database.md:172`, quoted — not an
      invented default, and no gym exists yet. Whether a gym owner picks their
      country during onboarding is a P3.10 product decision for Kd, and changing
      the DDL default would need a DEVIATION PROPOSAL (R0.3). Recorded here so
      the question is not lost, not as work owed.
      **Kd's wider point is ALREADY OPEN and is not closed by this line:**
      DECISIONS :592 — privacy-law scope beyond India (GDPR/CCPA/LGPD) — is his
      ruling to make and nothing has been built on it either way.

- [ ] ⚪ **A FRACTIONAL "HOURS TRAINED" IS FLOORED TO A WHOLE NUMBER ON SCREEN.**
      Created 2026-08-15 by the Dashboard-stats card, which measured it while
      writing an assertion and then could not write the assertion.
      `AnimatedNumber` (`Dashboard.jsx`) renders `Math.floor(ease * value)`, so
      the tile's 1.1 arrives in the DOM as **1**, and a user with 24 minutes of
      training reads **"0h"** above a sub-line correctly saying "24 minutes".
      **PRE-EXISTING and NOT introduced by the repoint** — the old payload's
      hours figure went through the same component — and out of that card's scope
      (R1.1), which is why the render test asserts the minutes sub-line instead
      and says so in a comment.
      ⚪ rather than 🟡 because the honest number is printed directly beneath it,
      so nothing on screen is unrecoverable; but it is the same family as :4182
      (a real duration displayed as a rounder, smaller one) and the fix is a
      one-line decision about whether that component should animate decimals at
      all — which also touches the three other tiles that use it.

- [ ] 🟡 **WORKOUT TEMPLATES HAVE NO ENDPOINTS (`WorkoutBuilder`).** Created
      2026-08-06 by the same card, same reason. Four old-backend calls —
      `saveTemplate` / `getTemplates` / `deleteTemplate` / `useTemplate`.
      **The TABLE already exists** (`workout_templates`, Part 4 §3.5 DDL,
      `db/schema/training.ts`, and in migration `0001_init` — verified). Only the
      endpoints are missing, so this is a smaller card than it looks and needs NO
      migration. Independent of everything above: it blocks nothing and nothing
      blocks it.
- [x] 🟡 **A WORKOUT CANNOT BE STARTED OFFLINE AT ALL.**
      **DONE 2026-08-16. SMOKE STEP 9 PASSED — Kd started a workout with the
      browser's Offline toggle on, then finished it online and watched the
      summary fill in.** The fresh-chat T3 closed at ZERO Critical/High in round
      2, so this ticks with its parent line above. **Half of Part 6 §3.6 is now
      true: the hand-counted path (55 of 58 exercises) works with no network at
      all. The other half — the pose model's CDN download for the 3 camera
      exercises — is still open and keeps its own line.**
      This one is a browser claim above all others: only Kd's own Offline toggle
      can settle it, and no jsdom test can. Built by the card this line named in
      advance — the legacy
      start went with the legacy save, so `handleStart` now writes the session
      locally and navigates, with no request of any kind. Three tests pin it,
      all measured RED against the pre-card source; smoke step 9 in
      `RUNBOOK/smoke-dual-write-retirement.md` is Kd's own check with the browser
      set to Offline.
      **HALF THE PROMISE, NOT ALL OF IT — read the last paragraph of this entry
      before quoting it as closed.** Its named sibling (the pose model
      downloading from a CDN) is still open, so a CAMERA workout still needs the
      internet to start. What is fixed is the hand-counted path, which is 55 of
      the 58 exercises.
      The original follows.
      Found in Kd's smoke,
      2026-08-07, step 8 — with the network set to Offline the pre-workout screen
      says **"Failed to start workout"** and nothing begins. Screenshot evidence:
      three failed `POST /workouts` XHRs from `workoutApi.js` (`createSession`)
      against the OLD backend, each preceded by a CORS preflight.
      **Pre-existing, NOT caused by the summary card, and out of its scope
      (R1.1) — recorded because it was tracked nowhere.**
      **Why it matters more than it looks:** the offline story is a headline
      promise of this product — Part 6 §3.6's copy says "your workout still
      counts", and the P1.10 Done gate is "a full workout completes with the API
      server off, then syncs". Today the sync half works and the START half does
      not, so the promise is half-true in the direction a user notices first.
      **Discharged by card 4** (retire the legacy start+save): once the workout id
      is minted client-side and nothing is asked of a server to begin, starting
      offline costs nothing. Until then it cannot be fixed without deleting the
      legacy save, which :3424 forbids.
      **Its second victim is the SMOKE DOC**, which told Kd to go offline and
      *then* start a workout — an instruction with nothing behind it, the same
      shape as :5034's "clear all filters". `RUNBOOK/smoke-workout-summary-
      repoint.md` step 8 now says start ONLINE, go offline mid-workout, finish.
      **NB the sibling line above** (the local pose model silently falling back to
      a CDN) means camera workouts need the internet too — two independent reasons
      the offline promise is not yet true, and they must both close.
- [ ] ⚪ **TWO ACTIVE-TIME ACCUMULATORS ARE NOW WRITTEN AND NEVER READ.** Created
      2026-08-16 by the legacy dual-write retirement, which removed their ONLY
      reader. `ActiveWorkout.jsx`'s per-second timer still fills
      `activeSecondsByExerciseRef` (per-exercise movement-gated seconds) and
      `activeEffortSecsRef` (their sum); both existed to feed the old backend's
      calorie estimate through `completeSession`, and nothing consumes either
      one now. A third, `activeEffortSecs` state, was ALREADY write-only before
      this card — its setter is called, its value is rendered nowhere.
      **NOT deleted here, deliberately (R1.1):** the accumulators sit inside the
      workout timer effect alongside `elapsedSecs`, which IS still read and IS
      part of the sync payload, so unpicking them is a change to the timer rather
      than a deletion of dead lines — a different blast radius from the one this
      card was approved for.
      **Why it is not free to leave:** dead surface reads as protection without
      being any (:5104 F1's recorded shape). A later reader will reasonably
      assume something depends on these numbers.
      **The one thing to check before deleting them:** the new API prices
      calories from what the ENGINE watched (`watchedMs`, kcal v3), not from a
      client movement-gate, so these are not a fallback for anything — confirm
      that against `kcalPointForSetsV3` and then remove all three together.
- [ ] ⚪ **THE MUTATION HARNESS DOES NOT YET DO WHAT RULE 4a SAYS.** Created
      2026-08-07 with Kd's audit-scoping ruling (DECISIONS :5857), because the
      RULE now says something the TOOL does not do — and a gap between what is
      written and what runs is exactly what this file exists to stop.
      Two things missing from `tools/mutate-workout-summary.mjs`:
      1. **No severity class per mutant.** 4a says slow DB mutants are spent only
         on Critical/High surfaces (ownership · numbers a user sees · anything
         that saves or syncs · money). Today every mutant is equal, so the rule
         can only be followed by hand — which is how a rule quietly becomes
         whatever chats have been doing with it (:5307's recorded lesson).
         Wanted: a `class` field, and a default run that skips the cosmetic ones.
      2. ~~**No local-Postgres switch.** Every DB mutant round-trips to Neon in
         ap-southeast-1.~~ **DONE 2026-08-21 (DECISIONS :13659).**
         `pnpm --filter api test:local` runs the suite against the
         `docker-compose.dev.yml` Postgres on host port 5433, and
         `mutate-orgs.mjs` now PRINTS which database it is about to use — host
         only, never the url — so a slow sweep explains itself instead of being
         wondered about. The runner's 4-worker cap also lifts itself when the
         database is local, since that cap exists solely for the remote pooler.
      **THE MEASUREMENT THIS LINE DEMANDED IS NOW MADE (V1), 2026-08-21:**
      | measured on this machine, same day | Singapore (Neon) | local docker |
      |---|---|---|
      | round-trip `select 1`, median | **202.9 ms** | **2.7 ms** |
      | `orgs.sweep.test.ts` (18 tests) | **158.2 s** | **10.8 s** — 14.7× |
      | `orgs.routes` + `orgs.sweep` (67) | **did not finish in 10 min** | 77 s |
      | whole api suite (536 tests, 44 files) | not measured | **51 s** |
      **Read the third row as a LOWER BOUND, not a ratio** — that run was killed
      at a ten-minute cap, and no full-suite Neon figure has been taken, so none
      may be quoted. The row that matters for the audit is the second: the
      harness runs a suite once PER MUTANT, so 14.7× is the per-mutant saving,
      and the clock card's six DB mutants would have cost ~16 minutes of
      Singapore against ~1 minute local. It also removes the cause of the two
      control aborts at :13336 — contention on a database in another country.
      **STILL OPEN: item 1, the severity class per mutant.** The rule still
      cannot be followed by the tool, only by hand.
- [ ] 🟡 **THE FULL api SUITE FLAKES: NINE TEST FILES RUN `seed()` AGAINST ONE
      SHARED DATABASE WHILE TWO ASSERT EXACT GLOBAL COUNTS.** Found 2026-08-21
      (DECISIONS :13746) by the local-Postgres switch — **PRE-EXISTING, and
      Neon's latency was HIDING it**: slow queries spread the suites out so the
      collision window rarely opened, and a database answering in 2.7 ms opens
      it often. **Measured over five full local runs: 536/536, 535/536,
      532/536, 535/536, 536/536**, with failures always in
      `catalog.seed.test.ts` ("seeds all 58 and nothing else") and
      `db.migration.test.ts` ("seed is idempotent"). **Pinned rather than
      guessed: those two pass TOGETHER 3/3 and ALONE 2/2 each, and fail only
      inside the full run** — so the mutation comes from a third file, not from
      either of them.
      **WHAT IT DOES AND DOES NOT COST.** A SCOPED run — one file, or a `-t`
      filter — is unaffected, **which is exactly what a mutation sweep runs**,
      so the audit instrument is untouched. What IS affected is any claim that
      the whole api suite is green: **there is no clean-run claim available
      until this closes**, and a single green run must not be quoted as one
      (:13247's Low-3, which recurred here in the session that fixed it).
      **THE FIX IS ISOLATION, NEVER A WORKER COUNT.** Raising the cap from 4 to
      8 was tried on 2026-08-21 and disproven — it flakes at 4 as well. Wanted:
      a schema or database per worker, or the two seed-asserting files run
      alone. **Not blocking anything** — a test-infrastructure defect, not a
      product one, and invisible until this week.
      **WORSE AS OF 2026-08-22 (DECISIONS :14401), and said rather than
      shrugged off.** The staff card's T3 round added twelve tests to
      `orgs.routes.test.ts`, which lengthens that file and changes the
      interleaving: **three full runs earlier that day were 100% green, and the
      two full runs after the fix round both failed the SAME three global-count
      assertions in `catalog.seed.test.ts`** (which passes **1/1 alone**). Nobody
      caused the race and nobody fixed it; what changed is how often it fires,
      and it will keep drifting that way as suites grow. **The practical cost is
      now real rather than theoretical: a card can no longer end on a clean
      full-suite figure**, so cards are quoting scoped runs, which is exactly the
      erosion this line predicted.
      **ALSO MEASURED 2026-08-22, because the HANDOFF instruction is subtly
      wrong: through corepack, `pnpm --filter api test:local -- <file>` does NOT
      scope** — pnpm consumes the `--` and all 44 files run, so several "scoped"
      figures quoted before this was noticed were whole-suite runs wearing a
      scoped label. **The form that works is `test:local <file>`** (no `--`).
      `-t` filters are unaffected, which is why the mutation sweep never hit it.
      **A THIRD FAILING FILE SEEN ONCE, 2026-09-02 (DECISIONS :30243), AND
      RECORDED RATHER THAN SHRUGGED OFF BECAUSE THIS LINE NAMES ONLY TWO.** A
      full local run failed `workouts.sync.test.ts` at `beforeAll` with a **500
      from `/v1/auth/register`** — not a global-count assertion, which is the
      only shape above. It did NOT reproduce: the file passes 23/23 scoped and
      the next full run was 767/767. **Unexplained, so it is written down**; if
      it recurs, the thing to check first is whether the register path exhausts
      the connection pool under four workers, which would make it a DIFFERENT
      defect from the seed race and not part of this line.
- [x] ~~🟡 **THE NEW API DOES NOT STORE A WORKOUT'S WALL-CLOCK DURATION.**~~
      **DONE 2026-08-07** (DECISIONS :5906) — Kd RULED the contract change this
      line said was needed. `durationSeconds` (the on-screen workout timer) and
      `restSeconds` are now OPTIONAL fields on the sync payload, stored in
      `duration_ms`; the §2.4 SetSummary is untouched, so the byte-match gate is
      unaffected, and there is no migration. **The prediction below held exactly:
      the sub-line returned by itself** the first time a real total was stored —
      and then printed "2 min total" under "1m 27s", because it rounded to
      minutes while the figure above it was exact. That is fixed too.
      **What this line did NOT anticipate:** the stored total made the SET spans
      falsifiable for the first time, and they were wrong — the set stopwatch
      counted paused time. Both were found by Kd's browser, not by the suites.
      Original text kept below, because the reasoning is what dated well.
- [ ] 🟡 ~~**THE NEW API DOES NOT STORE A WORKOUT'S WALL-CLOCK DURATION.**~~ Found
      2026-08-07 by the summary card's own mutation sweep (M6 survived), then
      measured against the live DB: **12 of 12 workouts had `duration_ms` exactly
      equal to the sum of their sets' durations**, because
      `repo.syncWorkout` derives it that way (`repo.ts:65`).
      **So "active time" and "total time" are ONE number, and the app had been
      drawing them as two.** The summary printed e.g. "31s" for Workout Time with
      "1 min total" beneath it and a tooltip explaining that the total includes
      "standing between reps and camera setup" — a rest gap that does not exist.
      The minute rounding is what made one number look like two.
      **Already done, so this line is only about the missing DATA:** the sub-line
      now renders only when the two genuinely differ (M21 pins it), and the
      contract's comment no longer claims a wall clock it does not have.
      **What is owed:** the old backend carried a real session duration
      (`duration_minutes`, the whole time on the workout screen). `ActiveWorkout`
      still measures it — `finalElapsedSecs` — and the v1 §5.3 sync payload has no
      field to put it in, so adding one is a CONTRACT change and needs a ruling,
      not a patch. Until then the summary honestly reports one duration.
      **The sub-line returns by itself the day a real total is stored** — no
      client change needed, which is why the field was kept rather than deleted.
- [ ] 🟡 **A HAND-COUNTED SET STILL BILLS IDLE TIME AS EXERCISE.** Created
      2026-08-07 by the kcal-v2 card (DECISIONS :5906), and **disclosed to Kd
      before he approved it** — not discovered afterwards.
      **This is Kd's own founding scenario, still unclosed for one branch:**
      "someone was doing something and camera was going but not doing exercise".
      For an ENGINE set that is now handled — rep time (reps × tempoMsAvg) is
      billed at the exercise MET and the rest of the span at `REST_MET` 1.8, so a
      zero-rep set costs the idle rate. **A LOG-ONLY set has no rep timings at
      all** — nothing measured it — so its whole span is billed at the exercise
      MET, exactly as v1 did.
      **Why it is not simply fixed:** there is no measurement to fix it WITH. The
      honest options are a per-set "how long were you actually working" input, or
      a definition-derived expected rep duration, or accepting it. All three are
      product decisions, not patches — **this line is a RULING request, not a bug
      report.**
      **Scope, so nobody over-reads it:** 55 of 58 exercises have no engine
      definition today, so this is the common path until P4 publishes more.
- [ ] ⚪ **THE CALORIE TOOLTIP IS TRUE FOR A v2 WORKOUT AND FALSE FOR A v1 ONE.**
      Created 2026-08-08 by T3 round 3 (Low-1) on the badge/calorie-cue card.
      The sentence under Calories describes the THREE-TIER v2 estimate: rest
      breaks at a low resting rate, paused time not counted, a camera-graded set
      billed for its rep time and a hand-counted set for its whole span. **A
      v1-priced workout (`kcalPointForSets`) does none of that** — the whole span
      goes at the exercise MET and rest is not counted at all — so three of the
      four clauses are wrong for one and only the hand-counted clause survives.
      **Why it is not fixed here: the screen cannot tell which formula priced the
      workout.** `workoutSummarySchema` carries no `kcalCalcVersion` and the
      service serves the stored figure, so branching the wording is a CONTRACT
      change — the same shape as the wall-clock-duration line above — not a
      client patch.
      **Why ⚪ and not a defect today, measured rather than assumed:** every
      workout a user can reach is v2. `ActiveWorkout` always sends an integer
      `restSeconds`, the sync client always admits it, and the service selects v2
      whenever it is present. The only route to this screen is completing a
      workout — nothing links to it from history — and legacy Mongo rows land at
      `kcal_calc_version = 0` under NEW uuids, so an old bookmark cannot resolve
      to one. **No reachable path exists today or at first cutover.**
      **What is owed:** the day `kcalCalcVersion` reaches the summary payload,
      the tooltip branches on it. Until then it describes the only formula any
      user can actually be shown, which is why it was left alone rather than made
      vaguer — a sentence true of everything says nothing about anything.
- [ ] ⚪ **`secondsLabel` prints "35m 0s" for a whole number of minutes.**
      Created 2026-08-07 by the kcal-v2 card. Now visible in TWO places rather
      than one: the Workout Time headline has always spelled an exact 15 minutes
      "15m 0s", and the total sub-line now matches it (deliberately — the
      mismatch was the defect Kd found). True, never wrong, and slightly clunky.
      **Deliberately NOT fixed here**: the helper is shared by the calendar, the
      share card and both summary figures, so dropping a zero seconds component
      is a display change to a real value across four surfaces (R1.1) and wants
      its own card. Sits with the existing fractional-input line for the same
      helper.
- [x] ~~🟡 **RULING NEEDED: reading a workout by DIRECT ID ignores the plan's
      history window.**~~ **RULED BY KD 2026-08-07: LEAVE IT. Struck, not
      deferred** (the desktop-webcam precedent, :456 — an item leaves this file by
      being done or by a ruling that it will never be built).
      **The ruling:** your own old workout stays readable by direct link; the
      records section stays scoped to the plan window. Kd was shown both
      alternatives and why each is worse — blocking the read hides a user's own
      data from them, and ungating the records would make the summary and the
      Progress screen disagree about who holds a record, which is the exact thing
      the summary card unified. What remains is a mild oddity, not a falsehood: a
      very old workout's records section is simply empty, because it cannot be a
      record inside the visible window.
      **KD ATTACHED A CONDITION, and it is already met — recorded so nobody
      "relaxes" the read gate and takes the tenancy with it:** *"if someone else
      puts that link they should not get access."* They do not, and it is proven
      three ways — Kd's own smoke step 7 (a second account got "Failed to load
      summary" and no figures), the cross-tenant test asserting a stranger's 404
      is byte-identical to an unknown id's, and mutation M8, which deletes
      `AND user_id = ${userId}` from the shared detail read and is caught.
      **This ruling is about the PLAN WINDOW only. It grants nothing about
      ownership, and the two must never be conflated.**
      Original text below.
- [ ] 🟡 ~~**RULING NEEDED: reading a workout by DIRECT ID ignores the plan's
      history window.**~~ (superseded by the ruling above; kept for its evidence)
      Raised by the summary card's T3 (round 1, L-7),
      2026-08-07, reported not fixed — it is a RULING, not a defect, and it is
      pre-existing.
      `GET /v1/workouts/:id` and `/v1/workouts/:id/summary` apply no
      `historyGate`, while `listWorkouts` and every `/v1/progress/*` read do. So
      a free user whose plan shows 90 days can still open a two-year-old workout
      by its id and read its calories, form score and duration — and, on the
      summary, the personal-records section beside those numbers IS gated, so one
      screen answers the same question two ways.
      **Not a regression and not a leak**: it is the caller's own data, and the
      detail route has behaved this way since P2.3. The summary is new SURFACE on
      the old behaviour, which is why the reviewer raised it here.
      **The question for Kd:** is the history window a LIST gate (you cannot
      browse past it) or a READ gate (you cannot see past it at all)? Part 4 §0.2
      says "read-gate, not deletion" and DECISIONS 2026-07-21 says older workouts
      are "still saved" — both consistent with either answer. Do NOT guess: a
      chat that clamps this silently makes a paying-feature decision (R3.1), and
      one that leaves it silently makes the summary's own two halves disagree.
- [ ] ⚪ **The post-workout summary's WORDS ship as English strings.** Created
      2026-08-06. Meal ideas, stretch suggestions and the three personal-record
      labels are a verbatim port of the old backend's hardcoded English
      (`apps/api/src/modules/workouts/summaryContent.ts`), not v1 §14 message
      keys. Same debt, same shape, as the exercise library's copy (:4945) — hi/as
      is a translation task, and these strings should move with those when it
      runs. Kd approved porting them as-is rather than inventing a scheme
      (2026-08-06 plan gate); recorded so "why is there English in the API?" has
      an answer that is not "nobody noticed".
- [x] 🔴 **A camera-graded set can still land NOWHERE — and now it can leave a
      workout with sets MISSING.** **CODE COMPLETE 2026-08-03 (DECISIONS :3720);
      TICKED 2026-08-04 on the smoke**: step 4 passed and is DB-verified
      (camera refused on squats → hand-counted → `squat`/`log_only`/reps 3,
      `exercise_id` resolved; runbook table). Step 6, this line's other route,
      was **SKIPPED BY KD'S RULING** (DECISIONS :4081); the reconcile code it
      would have exercised stays covered by the unit suite + mutation harness.
      Original text below. Fixed as part of Kd's ruling that
      hand counting is a user CHOICE: the page no longer decides who files a set
      by asking whether a definition exists — it records the user's count for
      every set and settles ownership once at workout end, when the engine's
      answer actually exists. **The proposed fix in this entry could not have
      worked**: it assumed hand-counted reps were available to fall back on, and
      on a camera-graded exercise the `+1 Rep` button was not rendered at all,
      so the count was always 0. **This entry's own suite asserted the defect as
      correct** — a test called "files nothing itself when the engine is
      analysing the set" expected an empty queue and described it as "nothing to
      send"; it is replaced by four that assert the opposite.
      **The mutant that reinstated the old gate (M8) was RETIRED in T3 round 3 —
      it could not be made to bite.** Corrected here rather than left standing:
      at capture time the engine has not filed yet, so a "has the engine filed
      this?" guard never fires, and an `analysisAvailable` guard reads the first
      render's value through a pinned callback. That impossibility IS this
      card's central design claim. The behaviour is covered instead by M4, M7
      (both capture call sites) and M47 (the recording itself, 12 tests red).
      Created 2026-08-02 (write-path T3 round 2,
      F-3, NOT-VISIBLE, deliberately not fixed inside that card — R1.1).
      `analysisAvailable` is true whenever a DEFINITION exists
      (`sessionController.js:59-71`), independent of the camera. But `endSet()`
      returns null when zero frames were fed (`:123`) — reachable when camera
      permission is denied (the page carries on; the error is an inline banner,
      not a block), while MediaPipe is still loading, or when the set ends
      inside that window. The engine then files nothing, and the web half's
      capture correctly stands aside because the engine "owns" that set. Neither
      side files it.
      **Before the web half this was invisible** — an all-squat workout simply
      synced nothing and the legacy save held it whole. Now: **squats mixed with
      any hand-logged exercise sync a workout with the squat sets missing**,
      which is the partial-workout outcome the unresolved-exercise guard exists
      to prevent, with no equivalent guard. The zero-frame guard itself is
      P1.10b's and deliberate (it suppresses phantom StrictMode summaries); what
      changed is the consequence.
      Scope when it runs: reconcile at workout end — any ordinal with reps but
      no summary from either side gets filed — or refuse the sync the way an
      unresolved exercise does. Both are more than a one-line fix, which is why
      this is a line and not a patch.
- [x] 🔴 **RE-RUN SMOKE STEPS 5 AND 6 — DISCHARGED 2026-08-04.** Step 5
      re-ran on the final code and met this line's exact closure condition: a
      TWO-set camera squat workout, BOTH sets `mode` `engine`, real scores
      83/83 (started 03:55 UTC 08-04; table in the runbook). Step 6 was
      **SKIPPED BY KD'S RULING** (DECISIONS :4081) — not run, not owed; the
      handover code and its unit/mutation coverage stay. Original text below.
      Reopened 2026-08-03 by T3 round 2. Step 5 (the camera control) DID pass and
      is recorded below, but **it passed on ROUND 1 CODE**, and round 2's F1
      showed that code filed the FIRST set of every camera workout as the user's
      own count with the form score discarded. Re-run against the current code it
      would have failed. **A passed control cannot be carried across a change to
      the thing it controls.** Step 6 (camera dies mid-set) is owed for the
      separate reason that its round-1 expectation was unreachable, so its
      "pass" proved nothing either.
      **To close:** one camera-on squat workout of TWO OR MORE sets — set 1 is
      the whole point — then the step-3 query showing BOTH sets `mode` `engine`
      with real `avg_form_score`. Then step 6.
- [x] 🔴 **The camera control step (smoke 5) — passed 2026-08-03 on ROUND 1
      code; see the reopened line above, which supersedes this for the tick.**
      Two real camera workouts stored the same day:
      `squat`/`engine`/3 reps/`avg_form_score` 100/`view` `side` (started
      07:45:37) and `squat`/`engine`/3 reps/score 67 (started 07:58:05). The
      camera path grades and stores exactly as before this card.
      **KEPT UNSTRUCK BECAUSE THE ROUTE TO IT IS THE LESSON.** For 35 minutes
      this looked like a card-breaking regression, and the chat said so. Three
      queries (07:19, 07:47, 07:50 UTC) found no engine row, and the chat used
      that absence to conclude, in order: that steps 5–6 wrote nothing; that the
      workout was NOT sitting in the browser queue ("ruled out"); and finally,
      after tracing `buildLogOnlySet` dropping 0-rep sets into `queueWorkoutSync`
      returning `no-sets` SILENTLY, that a camera workout measuring nothing
      vanishes without trace — "a real bug, and it's mine".
      **Every one of those was wrong, and the mechanism is worth knowing.** The
      07:45 workout was queued correctly and simply had not flushed: it reached
      the DB at 07:57:21, TWELVE MINUTES after it started, the instant Kd
      hard-reloaded and `AuthContext` kicked the app-load flush. That is the
      documented, accepted behaviour (DECISIONS 2026-07-15 — "a liveness delay,
      never data loss"), and it means **a DB query moments after a workout is not
      a valid test of whether it was saved.** The runbook told the reader to
      trust the DB over the screen and never said the DB can lag the screen by
      minutes; that is a real gap in the runbook, now fixed there.
      Two further self-inflicted confounds, both avoidable: the chat ran the
      mutation harness — which rewrites `ActiveWorkout.jsx` 26 times, live, under
      Kd's running dev server — WHILE Kd was mid-smoke, so an unknown part of his
      session exercised deliberately sabotaged code; and it read `no-sets`, a
      real silent path, as the explanation for an absence that had a duller
      cause. **Do not run the mutation harness while a smoke is in progress.**
      Smoke 6 (camera dies mid-set) remains screen-only — see its own line.
- ~~🟡 **Switching between the camera and hand counting MID-WORKOUT, by
      choice.**~~ **STRUCK 2026-08-03 — Kd RULED IT WILL NOT BE BUILT**, in
      response to the T3 F2 finding: "if some chooses by hand then they can not
      change to camera in the middle of exercise same for the other part." The
      choice is made before the workout and is fixed for its length, both ways.
      **This is a design rule now, not an absent feature**, and the code enforces
      it in two places: `engineStalled` is sticky for the set it fired on, and
      `reconcileSets` rule 1 gives a hand-owned set to the user even when the
      engine also filed one. The ruling is what CLOSED F2 — the alternative on
      the table was comparing rep counts, which is a worse rule for the same
      reason it was tempting: it makes the stored number depend on arithmetic the
      user cannot see.
      **NOT struck, and deliberately: the AUTOMATIC handover when the camera
      DIES.** That is not a switch the user chooses, it is the only alternative
      to a set they cannot finish, and removing it would restore the exact defect
      this card exists to kill. Camera → hand on failure: yes. Hand → camera
      ever: no.
- [x] 🟡 **DONE 2026-08-17 — the camera's downloads are bundled; a workout now
      survives losing the network.** Smoke PASS on Kd's desktop, fresh-chat T3
      round 1 (4 Critical/High, all fixed here), `RUNBOOK/smoke-pose-assets.md`
      carries the run. Originally raised 2026-08-03 from Kd's smoke console.
      **TWO THINGS THIS LINE SAID WERE MEASURED FALSE — corrected in place
      rather than quietly ticked, because the next chat plans against them:**
      (1) *"Likely a corrupt or LFS-pointer model file — check the file's real
      size first"* — **there was no file at all.** `public/models/` held one
      unrelated `.onnx` and no `.task`, so MediaPipe was handed Vite's SPA
      fallback (index.html at 200) where it expected a zip; `Unable to open zip
      archive` was the symptom of ABSENCE, not corruption.
      (2) *"~1.4 s later than it should"* — **the real saving is ~240 ms**
      (643 ms bundled vs 884 ms from the internet, both measured 2026-08-17;
      the 1.4 s came off a months-old console). The 2738 ms first-load figure in
      the same session is Vite cold start and is not comparable.
      **AND THE HALF THIS LINE NEVER NAMED:** the model was only half the
      download. ~9.6 MB of MediaPipe WebAssembly came from jsdelivr on every
      workout too, so bundling the model alone would have left camera workouts
      online-only WHILE LOOKING FIXED. Both halves ship now, fetched at build
      time and sha256-pinned, and the app REPORTS which source it used.
      Scope honestly stated: this is offline ONCE THE PAGE IS OPEN. There is no
      service worker, so a cold start with no internet still does not work — the
      🟡 line for that is separate.
- [ ] 🔴 **NOBODY HAS PROVED THE PRODUCTION BUILD RUNS THE ASSET FETCH.**
      **KD RULING 2026-08-17: not deploying now, so this is DEFERRED, not
      unanswered.** He was asked for the Vercel Build Command and answered that
      he does not want to deploy yet — which is a complete answer: with nothing
      live, nothing is currently broken for a user. **This line is the gate that
      must close BEFORE the first deploy, and it must not be re-asked as an open
      question in the meantime.** Raised by the fresh-chat T3 of the bundling
      card, 2026-08-17 (C/H-3), and it is the one finding that can make that
      whole card worthless to users. MEASURED:
      `.github/workflows/ci.yml` has no build job for `apps/web` at all (jobs are
      gate · engine-purity · gitleaks · migrations · db-tests), so
      `tools/fetch-pose-assets.mjs` never executes in CI; and there is no
      `vercel.json`, no deploy workflow, and no recorded build command anywhere
      in the repo. The deployable build is Vercel's, configured in a dashboard
      this repo cannot see. If that project overrides its Build Command — routine
      in a monorepo — `dist/` ships without the five files and every user's
      camera still needs the internet, with the smoke and the ticked line above
      both saying otherwise. The smoke proved the fix under `pnpm --filter web
      run dev` on localhost, which is NOT the path users get. Fix: read the
      Vercel Build Command, confirm it reaches `apps/web`'s `build` script, and
      RECORD it in the repo the way `infra/Caddyfile` records TLS termination as
      load-bearing. A contract test now pins the script's CONTENTS
      (`poseAssets.contract.test.js`), which closes the "someone edits
      package.json" half; this line is the "something else runs instead" half.
- [ ] 🟡 **The camera runs 0.10.35's JavaScript against 0.10.21's WebAssembly,
      deliberately, and it must be fixed WITH the model swap and not before.**
      Recorded 2026-08-17 with the bundling card, which pinned the bundled WASM
      to **0.10.21** while `package.json` says **^0.10.35**. This is not an
      oversight to tidy: the WASM is where inference happens, so 21 produced
      every landmark this project has ever measured, including the 13 clips
      behind Kd's `bone_stretch > 0.923` person-gate ruling. Copying
      node_modules' 35 would have been tidier and would have quietly changed
      what the camera sees.
      **2026-08-17, SAME DAY — THE MODEL SWAP HAPPENED AND THIS DID NOT MOVE
      WITH IT, deliberately.** The line above said "both land together"; the
      reason for that clause was *never* simultaneity, it was "do not change the
      frames for a tidy-up". Doing both in one edit would have made the outcome
      unattributable — if counting gets worse nobody could say whether it was
      the model or the runtime — so they are SEQUENCED instead, each measured.
      That is the intent honoured, not waived. **This is now the second of two
      frame-changing edits and it lands after the model swap has been smoked**,
      re-measured against a fresh recording, never blind.
- [ ] 🟡 **`Maximum update depth exceeded`, repeatedly, throughout every camera
      workout.** Found 2026-08-17 in Kd's smoke console. React is warning that
      `setKeypointsData` — the ~30 fps overlay publish in `usePoseDetection` —
      is driven from a `requestAnimationFrame` chain it counts as nested
      updates. NOT caused by the bundling card and not fixed by it (R1.1):
      MEASURED, that card changed **zero** lines touching that setter or the
      frame loop (`git diff` count = 0) and adds no per-frame state update.
      Recorded nowhere in the repo before today, which is why it gets a line
      rather than a shrug. No user-visible symptom was observed — reps counted
      and the summary was normal — but it is per-frame React work on the exact
      path whose delivered rate is already 9–12 fps against a target of 15, so
      it belongs with the throughput ladder rather than on its own.
- [ ] 🟡 **Finishing a workout asks for its summary before the save has
      finished, gets a 404, and is rescued only by a retry.** Found 2026-08-17
      in the bundling card's smoke, in the API log rather than on screen. MEASURED
      on Kd's machine: `POST /v1/workouts/sync` took **34.7 s**; `GET
      /v1/workouts/{id}/summary` was issued **1.8 s** after it started, returned
      **404** at 10.1 s, and a retry returned **200**. Self-healing there, and
      Kd saw a normal summary — but the ordering is a race, not a slow path, so
      on a slow link a user can be shown the broken state first. NOT the bundling
      card's (R1.1 — it touched no save path). Two things to weigh together when
      this is picked up: the read should be sequenced after the write rather
      than raced against it, and a 34-second save is its own question.
- [ ] 🟡 **Every web build ships a 17 MB model file from the retired Python
      backend.** `dist/models/ctr_gcn_clean_ensemble_quant.onnx`, flagged by the
      T3 of the bundling card 2026-08-17 (L4) and left untouched under R1.1. It
      is the only other thing in `public/models/`, it belongs to the ML service
      the migration decommissioned, and nothing in the web app references it.
      Deleting it is almost certainly right and is deliberately NOT being done on
      a card about a different file — confirm nothing reads it, then remove.
- [ ] 🟡 **Replace the "who is counting this set?" if-ladder with one explicit
      state machine.** Raised 2026-08-04 after FOUR T3 rounds found ELEVEN
      blocking defects, and the same one kept returning in a new disguise: the
      hidden-tab/backgrounded-camera failure was found and "fixed" in rounds 2,
      3 AND 4, by three different routes (the stall poll, the mute latch, the
      error stamp). Each fix guarded one path; the next round found the next.
      **The cause is the shape of the code, and CLAUDE.md R2.4 already forbids
      it**: `countItYourself` is a four-term boolean OR, fed by a sticky key
      written from two separate effects, with `document.hidden` guards in two
      places and a special case for redo — the "ad-hoc if-ladder" the rule names.
      Nobody can enumerate its states, which is why every round found a new
      combination rather than a new mistake.
      **Shape of the replacement:** one pure reducer over three states —
      `deciding` (the hook has not answered for this exercise) · `camera` · `you`
      — with an explicit transition table: the hook answers → camera or you; a
      camera failure or stall → you, locked for the set; hidden/paused/resting →
      NO transition; a new set → deciding. Then a table test walks every row, and
      a new situation must be ADDED as a row or the test fails.
      **DELIBERATELY NOT DONE INSIDE THIS CARD (Kd, 2026-08-04).** The chat
      proposed doing it immediately; Kd's judgement was that a rewrite at the end
      of an exhausted four-round card is how you get rounds five, six and seven,
      and that the exit is his smoke run, not more new code. Correct call —
      recorded here so the idea is not lost, to be taken as its own small card in
      a fresh chat, on committed and smoke-passed code.
- [ ] 🟡 **`captureHandCountedSet` silently ignores render state — any future
      guard added inside it will not work.** Found 2026-08-03 by T3 round 2's
      mutation run, indirectly. It is a `useCallback` pinned to `[exercises]`, so
      anything it reads that is not a ref comes from the FIRST render of the
      workout. Today it reads only refs, deliberately and correctly. The hazard
      is the next edit: a reviewer or a chat adding an ordinary-looking condition
      like `if (analysisAvailable) return;` gets a guard that never fires — on
      every camera workout that value is `false` at first render, because the
      pose hook answers one commit later. **This was not theoretical: mutant M8
      injected exactly that guard and went ALIVE for precisely this reason.**
      Re-anchoring it onto a ref read did not help either — the second form asked
      "has the engine filed this ordinal?", which at capture time is always no —
      so M8 was RETIRED in round 3, with its reasoning kept where it stood in
      `mutate-write-path.mjs`. Nothing is broken now;
      what is owed is making it hard to get wrong — either widen the deps, or
      pass the values the function needs as arguments from its call sites.
- [ ] 🟡 **The Coach's message id still assumes a secure context — the assumption
      THIS card deleted.** T3 F8, 2026-08-03. Reported not fixed (R1.1): not this
      card's file. `coachApi.js` calls `crypto.randomUUID()` bare, under a comment
      justifying it as "the same requirement the sync path already relies on,
      ActiveWorkout.jsx". The sync path stopped relying on it the moment a workout
      could start without ever asking for a camera — `newWorkoutId` now falls back
      to `getRandomValues`. So on a plain-http origin (a phone opening the dev
      server by LAN address) sending a coach message throws where a workout now
      survives. The comment is the dangerous part: it cites a guarantee that no
      longer exists, so a reader checking it would conclude the call is safe.
      Fix is the same three-line fallback, or lift `newWorkoutId` into a shared
      helper both call.
- [ ] 🟡 **The camera is switched on before the user can say they don't want it.**
      T3 F9, 2026-08-03. Reported not fixed (R1.1): pre-existing mount behaviour,
      not something this card introduced. `PreWorkout` calls `getAvailableCameras()`
      on mount, which calls `getUserMedia` unconditionally, then starts the camera.
      So a user who always counts their own reps still gets a permission prompt and
      a lit recording light on every visit, and the new copy that says no camera is
      used is only true AFTER they have already been asked. The device list needs
      permission to carry labels, which is why it was written this way — but the
      list is only needed once the camera path is actually chosen.
- [ ] ⚪ **The rep-counting choice is not remembered between workouts.** Created
      2026-08-03. Every workout starts on "Use the camera" and a user who always
      counts by hand re-picks every time. Deliberately out of scope: per-user
      preference storage on this branch is `packages/shared` + the profile API,
      not a localStorage flag, and that is a card not a line of code.
- [ ] ⚪ **The 5-second camera-stall threshold has never been watched by a
      human.** Created 2026-08-03. `ENGINE_STALL_MS` in `ActiveWorkout.jsx` is
      how long a camera-graded set may produce no analysed frame before the
      screen offers hand counting. **It is not a spec value — there is none**
      (Part 0 rule 4 applies to spec numbers; this is a UI patience threshold).
      Chosen so a slow MediaPipe start does not flash the button and a dead
      camera does not cost a whole set. Never measured on a real slow phone,
      where model load is exactly the case it is trading against — the mobile
      camera smoke below is where it would be observed.
- [x] 🔴 **Workout history calendar — DONE 2026-08-04** (WorkoutCalendar →
      workoutApi.getHistory). **CLOSED under the two-round T3 cap after round 2
      (DECISIONS :4355): 6 findings, 1 user-visible, all fixed.** The visible one
      was a bold "0 active days this month" printed for a month the walk never
      finished reading — beneath the very caption admitting so; five others were
      states no render test had ever exercised (the truncation caption, the plan
      clamp's straddling arm, the "+N more" chip), each measured to survive with
      all 62 tests green. Round 1's two fixes were independently audited and both
      hold. Final: web 426/426, 29/29 mutants RED, `vite build` green. No
      re-smoke owed — both changed sentences need 1,000 workouts to reach, so no
      step of the 8-step smoke touches them.
      **HISTORY BELOW, kept because its lessons outlive the card.**
      **UNBLOCKED AND UNPARKED 2026-08-04 (DECISIONS :4119) — the code is now on
      `web-repoint`.** Two-round T3 cap, set before round 1.
      **SMOKE ROUND 1 RAN 2026-08-04 AND FAILED — one defect, VISIBLE, now
      FIXED (DECISIONS :4182).** Every duration on Kd's screen was false: real
      `duration_ms` of 8491/4767/36290/37681 displayed as `0m`/`0m`/`1m`/`1m`,
      i.e. two workouts shown as taking no time and two rounded UP past a minute
      they never reached. Cause: the OLD backend sent whole MINUTES, so rounding
      was right for the field this replaced and wrong for milliseconds — and
      every fixture in the suite used 1,800,000 ms, so no test could see it.
      Fixed to whole seconds through the shared `secondsLabel`; reads
      `8s`/`5s`/`36s`/`38s`. Failing tests shown RED first (R9.5); M23 guards the
      regression. 417/417, 23/23 mutants RED.
      **STEPS 1-4 OTHERWISE PASSED** — camera workouts 83%/84% in green,
      hand-counted ones `—` in the neutral tint, chips correct, and the mixed
      camera+hand workout rendered as ONE session with both chips.
      **SMOKE FULLY DISCHARGED 2026-08-04 — ALL 8 STEPS PASS on `5133114`**
      (result table in `RUNBOOK/smoke-workout-calendar.md`). The re-smoke of
      steps 1-4 was run on the FIXED bytes rather than carried over, because the
      numbers Kd had judged were the ones that changed (the XP-card precedent):
      the four sessions now read `8s`/`5s`/`36s`/`38s`, confirmed by Kd.
      Steps 5-8 had never run before today and all pass — including step 8, the
      hand-counted case written for this card's own new coverage.
      **T3 ROUND 1 (2026-08-04, DECISIONS :4267): 6 findings, 1 VISIBLE, ALL
      FIXED.**
      F1 (VISIBLE) was the duration defect's twin: the walk pages BACKWARDS from
      today, so an unreadable row from a NEWER month was counted and printed as
      "1 workout couldn't be read" over a month that had read perfectly — and
      every fixture put its unreadable rows INSIDE the viewed month, so none
      could see it. F2 (blocking, not visible) was measured both ways: the
      day-bucketing guard was **inert in CI** — with the UTC-day defect live the
      suites went 57/57 GREEN under TZ=UTC and RED only under Asia/Kolkata, and
      runners are UTC. Zone now pinned in `apps/web/vitest.config.js`, with a
      test asserting the pin survives and `turbo.json`'s input glob widened so
      deleting it cannot be masked by a cache hit.
      **The harness's OWN bite-check was blind** and that is the finding to
      remember: it claimed "every sed is proven to have bitten (md5 must
      change)", but the files are CRLF and `sed -i` rewrites them to LF, so the
      md5 moved on a sed matching nothing. A mutation whose anchor had DRIFTED
      was therefore reported as a missing TEST. Fixed to compare content; the
      false header claim corrected in place. Same class as DECISIONS :3720.
      Two untracked deferrals it surfaced now have their own lines below (the
      calorie BANDING rule, and the unit-drift gap in the reader's stand-in for
      `safeParse`).
      Measured after the round: web **422/422**, **25 mutants 25 RED, 0 alive,
      0 invalid**, `vite build` green, lint 1 pre-existing error (own line).
      **WHAT DISCHARGED THE BLOCK** was other cards, not a ruling here: blocker 1
      below said the new API held only squat / jump-squat / chair-squat
      workouts, and the 58-exercise catalog (:3538) plus the web write path
      (:3610) closed that; the rep-choice smoke (:4081) confirmed a hand-counted
      workout reaches the API from a real browser.
      **THE ONE GAP THE PARKED CODE HAD, and it is a date.** The screen was
      built 2026-08-01; hand-counted workouts first reached the new API on
      2026-08-02. So no parked fixture carried their shape — real duration, real
      kcal, and NO form score (migration 0009's CHECK forbids a log-only set
      from carrying one). The code was already correct; the COVERAGE was absent,
      which is the gap this repo has lost eight rounds to. Five render tests and
      mutations M19–M22 added. Measured: web 413/413, 22/22 mutants RED with a
      green baseline before AND after, `vite build` green.
      **ALSO CORRECTED IN THAT COMMIT:** `RUNBOOK/smoke-workout-calendar.md`
      claimed an unknown Form score was "not browser-reachable". True when
      written, false since 2026-08-02. Step 8 walks it now, and the smoke's setup
      warns that pre-2026-08-02 months look emptier here than in the old app —
      those workouts exist in the old backend alone, so that is not a defect to
      report.
      **The blockers below are kept as the record of why it waited. Blocker 1 is
      DISCHARGED; 2 and 3 were solved in the parked work itself.**
      **THE ORIGINAL ENTRY FOLLOWS AND ITS PRESENT TENSE IS 2026-08-01's** — in
      particular "code is on branch `workout-calendar-parked`, deliberately NOT
      on `web-repoint`" was true then and is superseded above. The branch is
      left in place unmerged as the provenance of these files.
      A chat
      recommended this card to Kd as the cheapest one left — the THIRD time,
      on the reasoning the next line pre-refutes — built it to PROVE (320/321,
      18/18 mutants), and only then read this entry. Code is on branch
      `workout-calendar-parked`, deliberately NOT on `web-repoint`, which merges
      wholesale at cutover and would have ARMED the broken repoint. Blockers 2
      and 3 below were solved in that work (detail endpoint for names; the Card-5d
      page-walk) and the dead `getHistory` duplicate is fixed there too, so the
      card resumes at the smoke + T3 once the WRITE-PATH item above is ruled.
      `/v1/workouts` exists, which is why this was twice (wrongly) recommended
      as the cheapest card left; existence is not usability, and three separate
      blockers were found only on the third check (2026-07-21):
      1. **THE BLOCKER — the new API holds only a SUBSET of workouts.**
         `syncClient.js:72` — `if (!summaries || summaries.length === 0) return
         { queued:false, reason:'log-only' }` — so an all-log-only workout
         (no engine-scored sets) is deliberately never synced (the ruling at
         DECISIONS 2026-07-10 P1.10c: with no SetSummaries there is nothing
         engine-verified to send, and `sets: []` would record an empty engine
         workout). Meanwhile `ActiveWorkout.jsx:536` still writes EVERY workout
         to the old backend via `completeSession`. Repointing the calendar
         today would therefore BLANK every hand-logged day — history showing
         less training than actually happened. **Unblocks only when the workout
         WRITE path moves to the new API, which is cutover work itself.**
      2. The list item carries no exercise breakdown (`workoutListItemSchema`:
         setsCount/totalReps only). Exercise identity lives on the per-workout
         DETAIL endpoint (N+1 for a month view) and as SLUGS — display names
         are the separate owed "exercise library content" card.
      3. `/v1/workouts` is a keyset cursor list with no month filter, so a
         month view needs the page-walk pattern from Card 5d.
      Also fix while here: `workoutApi.js` declares **`getHistory` TWICE** in
      one object literal (lines 5 and 9) — the second silently wins, so the
      `(limit)` variant is dead code and a footgun.
- [x] 🔴 **Dashboard XP — DONE 2026-07-30**, ticked with the XP display line above under THE CAP after T3 round 11. (Was: UNTICKED 2026-07-26 by its own T3, STILL OFF after round 4.)
      **SMOKE HALF DISCHARGED 2026-07-28 — the re-smoke PASSED, all 11 steps**
      (`RUNBOOK/smoke-xp-dashboard.md`). Step 6 is this line's own defect and it
      is CLOSED at the browser: in the `statsEmpty` state — a 200 carrying
      `{"stats":{}}`, the exact payload round 4 F2 was about — the three stat
      cards read `—`, not "0 workouts / 0h / 0 kcal". Step 17 (`emptyLists`)
      confirms the opposite sign still works: a zero the server actually sent
      still renders as `0`. **DONE 2026-07-30 — ticked with the XP display line
      above, under THE CAP after T3 round 11.** (Was: tick stays off
      pending T3 round 8; rounds 8, 9, 10 and 11 all ran.) The
      original entry follows. The
      card repointed XP but left the page's OTHER six figures fabricating
      (`s.total_workouts || 0` and friends), and `stats` is null whenever the old
      read fails — so a real "Level 2" sat beside three fabricated zeros and lent
      them credibility, while the strip below it correctly showed "—/—".
      Round 3 "fixed" this with `statsKnown`; **round 4 F2 found that fix was the
      SAME DEFECT under a new name** — `Boolean(stats?.stats)` asserted the
      envelope, then six sites read fields off it with `?? 0`, so a 200 carrying
      `{stats:{}}` (or any subset missing `total_minutes`) still printed
      "0 workouts / 0h / 0 kcal" as fact. That is verbatim the shape round 3 had
      just deleted from two OTHER files and shipped here in the same commit. The
      guard could not catch it because it banned `|| 0` and PERMITTED `?? 0`,
      which is the spelling the code was actually written in.
      Round 4 also found the week strip claiming seven untrained days it knew
      nothing about (F3), beside its own correct "unavailable" caption.
      Now fixed per-field through `readStatsView`, with the envelope gate gone
      entirely and render tests covering `{stats:{}}`, a partial 200, and the
      unknown week strip. Re-ticks on a fresh smoke AND a clean round 5.
      The DECISIONS entry calling that mix "honest" was false and is struck there.
      Kd chose
      option (a) on 2026-07-26 (ship the XP card, then this immediately) and
      confirmed the defect from his own re-smoke screenshot: the same page read
      "Level 1 / 0 XP earned" in a stat card and "0/100 XP → Level 2" in the
      Experience Points panel while the strip below it read "330 XP · Level 2".
      All four Dashboard sites now read the new API through the same `useXp()`
      hook and the shared formatters: the stat card's level + total, the XPBar,
      and the small "Level" figure. **The `xp % 100` maths is deleted FROM THIS
      PAGE** — the original wording said "DELETED" full stop, which its own T3
      showed was false of the app: `PostWorkout.jsx` still carries it, and has
      its own line below — it
      assumed every level costs 100 XP, but the curve is
      `floor(100*(level-1)^1.8)` (badges.py:215-227), so it was wrong for every
      user above level 2; the server's own `xpInLevel`/`xpForNext` are rendered
      instead. No fabricated defaults remain (`s.xp || 0`, `s.level || 1`, and
      XPBar's `xp = 0, level = 1` parameter defaults are all gone).
      The XP-guard's consumer list is DERIVED from the hook's importers, so it
      FAILED on this card until Dashboard was added — the guard working as
      designed rather than needing a human to remember. Both regressions
      mutation-verified caught: reinstating `xp?.level || 1`, and reinstating
      `xp.total % 100`. web 177 passed / 1 failed (178, the pre-existing
      syncClient quirk); lint clean on both touched files; `vite build` green.
      **SMOKE PASSED (Kd, 2026-07-26):** the stat card read "Level 2 / 330 XP
      earned", the Experience Points panel read "Level 2 / 230/248 XP → Level 3"
      with the bar nearly full, and all three XP surfaces on the page agreed
      with the sidebar and with `/v1/gamification/me`. The contradiction that
      the XP card's own smoke exposed — a real level beside a fabricated one on
      one page — is closed.
      **Still owed with it:** a T3 — no independent review has seen this card,
      and on the XP card each of two rounds found the previous round's fix had
      opened something new.
      ORIGINAL ENTRY, kept because it is the evidence the deferral was recorded
      rather than remembered: "Dashboard's XP surfaces still fabricate — XPBar +
      Current Level StatCard." Kd-ruled OUT of the 2026-07-26 XP-display card and
      given this line in the same commit, per the deferral rule. `Dashboard.jsx` renders
      `s.xp || 0` / `s.level || 1` (StatCard, XPBar, and a "Level" stat row) off
      `workoutService.getStats()` — a **different** old endpoint from the two
      the XP card repointed, so folding it in would have meant a second repoint
      in one card. Per the no-removal rule it STAYS working on the old backend,
      untouched, until its card. Two things that card must not inherit:
      (a) the `|| 0` / `|| 1` fallbacks are the fabrication class the XP card
      exists to remove — Dashboard shows a real-looking "Level 1" and "0 XP" for
      everyone whose stats read fails; (b) `XPBar` renders
      `{progress}/100 XP → Level {level + 1}`, i.e. a **hardcoded 100-XP
      level**, but the real curve is not linear (L2=100, L3=348, L4=722 —
      `xp_for_level`, badges.py:215-227). Render the API's precomputed
      `xpInLevel`/`xpForNext`/`progressPct` via the existing `useXp()` hook;
      never client-side XP math. Unblocked today — the endpoint exists.
- [ ] 🟡 **`/dashboard` and `/achievements` redirect to `/login` when the OLD ML
      API is RUNNING and rejecting.** Found by the XP card's T3 (2026-07-26)
      while it was busy getting the same question wrong in the other direction.
      `mlApi` sources a Bearer from `localStorage.accessToken`, which Card 1 no
      longer writes, so every old-backend read 401s and `mlApi.js`'s response
      interceptor navigates to `/login` before the page paints. The planned
      Card-1 interim (DECISIONS 2026-07-15: "the planned multi-card
      consequence"), closing when `workoutApi` / `recommendationApi` /
      `gamificationApi.getOverview` get their own repoint cards (③/⑦).
      **THE NUANCE THAT MATTERS FOR EVERY SMOKE FROM NOW ON, and that the XP
      card originally got wrong:** this only happens when the old API is UP and
      answering 401. When it is simply NOT RUNNING — the ordinary local-dev
      state — the axios error carries no `response`, `error.response?.status`
      is undefined, no redirect fires, and the page renders its own failure
      state. So "old backend down" is MORE smokeable than "old backend up", and
      a card that assumes unreachability without checking which case it is in
      will under-claim what it can prove.
- [ ] 🟡 **Achievements can now show two contradictory XP totals for the same
      user.** Raised by the XP card's T3 (2026-07-26); correct under no-removal,
      but it was not recorded and it is visible. The page HEADER now reads the
      new API (`xp.level` / `xp.total`) while the leaderboard tab's rows —
      including the current user's own highlighted row — still read the OLD
      backend's `entry.level` / `entry.xp`. Before this card both came from one
      payload and agreed by construction; they are now two stores whose totals
      accrued independently (the new one recomputes from history and diverges
      by design — see `xp.ts`'s governing rule). Closes with the leaderboard
      card (P4.x), which is where `entry.*` gets its new-API home. Until then,
      "header level vs. my own leaderboard row may disagree" is an EXPECTED
      smoke observation, not a bug to chase.
- [ ] 🟡 **`.catch(console.error)` on axios errors logs the whole error object,
      including any Authorization header.** Pre-existing, R3.10. **CORRECTED
      2026-07-26 twice over by the T3s.** (a) The original line said the leaked
      value is the string "Bearer null" — FALSE: `mlApi.js` sets the header only
      `if (token)`, so on this branch NO Authorization header is attached at all.
      The item is real but LESS urgent than recorded, not more; it becomes real
      the day any client attaches a live token. (b) The line named only
      `GamificationStrip.jsx` and `Achievements.jsx` while its own criterion was
      "files the XP card edited" — `Dashboard.jsx` qualified too and was missing.
      Round 3 has since converted the two gamification call sites to the
      `err?.message` form as part of the `allSettled` change, so what remains is
      the wider sweep: every other `catch(console.error)` on an axios call in
      `apps/web`, `Dashboard.jsx` included.
- [x] 🔴 **`PostWorkout.jsx` has the same 100-XP-per-level bug the Dashboard
      card deleted — and it is shown after EVERY workout. DONE 2026-07-28,
      commits `c681b23` + the round-4 fixes.** Smoke passed 2026-07-27 on a
      Level-3 account; FOUR T3 rounds (7+8+8+9 findings, 7 blocking, all fixed),
      round 4 clean of user-visible defects and recommending the tick.
      **THE TICK'S HISTORY, kept because it is the point:** it went on early
      after round 1, and round 2 took it off — correctly, on two counts. (a) It
      named no commit while nothing was committed, against OWED's own "tick it,
      date it, NAME THE COMMIT". (b) The argument for ticking without a clean
      round — "round 1 found no behaviour defect, only gaps in the protection" —
      is what the re-tick precedent forecloses. It goes back on now under a
      stopping rule Kd set explicitly: a finding blocks the tick only if it is a
      defect a user could see. Round 4 found none, said so, and recommended
      this. (Round 2's finding was a VACUOUS ASSERTION over a screen-visible
      defect class — corrected at round 4 F4, which verified ShareCard already
      read `formatLevel(xp)` before round 1: the mutant would have been visible,
      the shipped code never was.)
      Found by the T3 on
      888e750 (its F4) and given this line because the MIGRATION STANCE requires
      the deferral to be recorded in the deferring commit; grep confirmed
      "PostWorkout" appeared in neither OWED.md nor DECISIONS.md before now.
      `const xpProgress = summary.current_xp % 100`, rendered by a three-span
      row as `Level {summary.current_level}` · `{xpProgress}/100 XP` ·
      `Level {summary.current_level + 1}` — the identical assumption, on a live
      route (App.jsx). The real curve is `floor(100*(level-1)^1.8)`, so it is
      wrong for every user above level 2.
      **QUOTE CORRECTED 2026-07-27:** this line used to render the second half
      as `{xpProgress}/100 XP → Level {summary.current_level + 1}`, which is the
      DASHBOARD's wording — PostWorkout has no arrow and splits the caption
      across three spans. Small, but it is a paraphrase of a file the writer had
      not opened, which is exactly what CITATION DISCIPLINE (DECISIONS
      2026-07-20) exists to stop: quote the text, do not reconstruct it.
      OUT of the Dashboard card's scope because it reads a different payload
      (`summary.*` from the workout-complete response, not `/v1/gamification/me`),
      so it needs its own repoint rather than a formatter swap. **OWED.md said
      "The `xp % 100` maths is DELETED" — true of the Dashboard, false of the
      app**, which is the "fix the class, not the case" failure this project
      keeps recording; that wording is corrected on the Dashboard line above.
      **STATUS 2026-07-28: the user-facing bug IS fixed and browser-verified**
      (smoke passed on a Level-3 account, where the right answer `332/374 XP`
      and the deleted maths `80/100 XP` are visibly different) — but the line
      stays open until a clean round and a commit. Two T3 rounds have now found
      the same shape: the fix is right, the protection around it is not. Three
      vacuous assertions across the two rounds, each satisfied by a DIFFERENT
      site than the one it named. What landed: the page takes the level and the
      position within it from `useXp()` through the shared formatters exactly as
      the Dashboard does, `xpProgress` is deleted, and no XP arithmetic remains
      on the page. The SHARE CARD moved to the same source in the same commit —
      it read `summary.current_level`, so the page and the downloadable PNG
      would otherwise have printed two different levels. Web-only: no API
      change, no migration, no new dependency.

- [ ] 🟡 **The post-workout XP bar no longer animates from where you were to
      where you are.** Raised by T3 round 4 (F6) as a deferral-rule gap: the
      PostWorkout repoint changed the bar's `initial` from
      `max(0, xpProgress − xp_earned)` to `0`, so it now fills from empty rather
      than sweeping the gain. The reasoning was sound and declared in DECISIONS
      — the old "before" was computed on the broken `% 100` curve, and
      reconstructing it today means arithmetic across two stores that diverge by
      design — but CLAUDE.md's rule is that a UI reduction forced by a missing
      backend surface gets an OWED LINE, and that commit added three and missed
      this one. What the user lost is the ANIMATION, not a number (the number it
      used to sweep from was wrong), which is why round 4 did not call it
      blocking. Closes when the new API carries a per-workout delta: the bar can
      then start at `progressPct − thatDelta` honestly, from one store.

- [ ] 🟡 **The post-workout XP can be one workout stale — on the one screen that
      exists to be about that workout.** Raised by the PostWorkout repoint
      (2026-07-27); recorded rather than fixed, because closing it is sync-card
      work and this card was scoped to the curve. `ActiveWorkout.jsx` calls
      `queueWorkoutSync(...)` FIRE-AND-FORGET and navigates to the summary route
      about two seconds later, while the new API recomputes XP server-side at
      `POST /v1/workouts/sync`. So `useXp()` here can read a total that does not
      yet include the workout just finished — and offline it certainly does,
      since the queue flushes later BY DESIGN (R10.3). Nothing is fabricated:
      every number shown is a real server value, and the `+N XP` delta beside it
      is the old store's own figure. But the screen can truthfully report a
      level that looks like the workout did not count, which is a poor thing for
      a congratulations page to do. Real fixes are a refetch on the
      sync-settled event, or a shared XP store with invalidation — the SAME
      mechanism the `useXp` staleness line needs, so they should be built
      together rather than twice.

- [x] 🟡 **`PostWorkout.jsx`'s `summary` payload — DONE 2026-07-30.** Was: UNPARSED,
      the class rounds 4-7 closed for the other three old-backend payloads.
      **CLOSED under THE CAP (DECISIONS :2692, ruled BEFORE round 3 ran): round 3
      returned nine findings and ZERO VISIBLE ones, so the card closes and this
      box ticks.** Commits `fb1956c` (the card) · `271bbc8` (smoke) · `677ba90`
      (round 1) · `b2fa37a` (round 2) · `1334236` (the cap) · this one (round 3).
      **WHAT THE TICK RESTS ON, stated so it cannot be misread later:** Kd's
      passed browser smoke, THREE independent fresh-chat reviews, 21 findings
      across them all fixed or given lines, and a mutation harness whose own three
      false-success modes were each found and closed. **Not "nobody found
      anything"** — every round found six to nine things, and not one of them was
      a defect a user could see. No component file changed in ANY of the three
      rounds (reviewer-verified, not merely claimed), so the bytes Kd smoked are
      the bytes that ship.
      **T3 ROUNDS 1, 2 AND 3: 6 + 6 + 9 findings, ZERO VISIBLE in any of them.**
      **T3 round 2 (2026-07-30, fresh chat; full entry DECISIONS :2614).** It
      reproduced both PROVE claims before writing a word and re-verified round 1's
      five claims, then found six more — all mutants over correct code.
      **F3 is the one to know: the mutation harness had NO GREEN BASELINE, so
      "RED" could not distinguish "an assertion caught it" from "the tests never
      ran"** — proven with a broken runner producing a full table of REDs and exit
      0. Fixed, and the fix verified with the reviewer's own probe (exit 1, table
      never reached). F1: the Workout Time SUB-LINE had no failing assertion and
      printed "NaNh NaNm total" under mutation — root cause, no fixture had
      `active_seconds` absent with `duration_minutes` present. F2: round 1's own
      `/null/` sweep was added at ONE of its two sites. F4: a comment's evidence
      was false, and the rig now carries both record shapes so that path is
      browser-reachable at last. F6: harness restoration was silent on an
      uncatchable kill.
      Now a green baseline plus **21 mutations, 21 RED**. web 272/273.
      **No component file changed in either round**, so nothing a user sees has
      moved since the smoked bytes.
      **THE PATTERN, recorded because it is the card's real finding:** "fixed the
      instance, left the class" has happened FOUR times here — `xp_earned` →
      `current_streak` → `durationMinutes` → the sweep's own second site — each
      found in the fix written for the previous one.
      **T3 round 1 (2026-07-30, fresh chat; full entry DECISIONS :2546).** Every
      finding was a MUTANT a user could have seen, over shipped code that is
      correct; none was deferred, so none created an OWED line. F1: the
      anti-fabrication sweep checked `undefined`/`NaN` — what the PRE-fix code
      produced — but not `null`, the one spelling the NEW code can produce.
      **F2 is the one to remember: `current_streak` rendered at both surfaces and
      was asserted at neither — the same rename regression this card already
      recorded, ONE FIELD OVER, in the same commit.** F3: all four list-element
      render bodies were unreachable from every fixture. F4: the empty-200 test
      proved the toast and not the redirect. F5: "13 mutations, 13 RED" was
      unreproducible from the repo — the harness now lives at
      `apps/web/tools/mutate-postworkout-summary.sh` and exits non-zero if a
      mutant survives. F6: a helper's doc claimed protection it could not give.
      Now **18 mutations, 18 RED**, five of which were GREEN before this round.
      web 270/271. **No component file changed, so no re-smoke is owed** (the
      Round B precedent, DECISIONS :1950).
      **SMOKE HALF DISCHARGED 2026-07-30: PASSED (Kd), on commit `fb1956c`**,
      reported as a blanket pass rather than step-by-step and recorded that way
      (result at `RUNBOOK/smoke-postworkout-summary.md`). The `healthy` CONTROL was
      part of the run, which is the step that matters most — it is the only one
      that can catch the fix dashing out numbers the backend really sent.
      **THE TICK IS KD'S CALL, and the honest case against ticking is recorded
      first.** This card's own predecessor writes, on the line above: "the
      argument for ticking without a clean round — *round 1 found no behaviour
      defect, only gaps in the protection* — is what the re-tick precedent
      forecloses." That describes rounds 1 AND 2 exactly, and round 2's reviewer
      declined to recommend closure for that reason in its own words: the
      instance-not-class pattern "is now the card's most reliable output, and each
      round has found it in the fix written for the previous one."
      **RESOLVED 2026-07-30 — THE CAP (Kd ruling, DECISIONS :2692), set BEFORE
      round 3 runs so it binds whatever comes back: ROUND 3 IS THE LAST ROUND.**
      Nothing VISIBLE ⇒ this line TICKS. Something VISIBLE ⇒ it is fixed and the
      line ticks on that fix. NOT-VISIBLE findings are fixed if cheap, else take
      their own lines here, and block nothing.
      Round 3 exists for ONE named reason rather than as another cycle: **round 2
      fixed the mutation harness itself and that fix is unaudited**, so every
      "21 RED" figure this card quotes rests on a baseline gate written by the same
      chat, in the same session it was told the instrument was untrustworthy.
      The evidence the cap rests on: rounds 1 and 2 each returned six findings and
      ZERO VISIBLE ones, from two independent fresh chats; neither changed a
      component file, so the bytes Kd smoked at `fb1956c` are still the shipping
      bytes. The card will tick on a passed smoke + three fresh-chat reviews + a
      baselined harness — not on "nobody found anything": twelve findings were
      found and all twelve were fixed.
      What landed: `readSummaryView` + `formGrade` + the time/percent formatters in
      `gamificationApi.js`, beside `readStatsView` — which parses a
      `workoutService` payload too, so the location is precedent and not a new
      pattern. All 34 bare reads across 9 fields go through it; ONE grade ladder
      serves the page AND the share card, so the PNG can no longer print
      "undefined% (D)"; a 200 with no `summary` key takes the page's EXISTING
      toast+redirect instead of rendering a blank white screen; a list arriving as
      a string can no longer reach `.map` and blank the page. web **269/270** (the
      1 is the `syncClient` env quirk on its own line below), **+21 tests**,
      **13 mutations / 13 RED**, lint parity measured at HEAD and after. Smoke
      steps at `RUNBOOK/smoke-postworkout-summary.md`; new `unscored` rig state.
      Full entry at DECISIONS :2444.
      **THE LESSON, recorded because it nearly shipped:** `xp_earned` survived the
      snake→camel rename at ONE of two sites, so the page's XP card read "—" for
      every workout while the PNG read "+70" — and all 7 render tests stayed
      GREEN, because a whole-document `/\+70/` sweep is satisfied by the SHARE
      CARD (round 1 F1 verbatim). Found by grep, not by the tests. The missing
      identity assertion now exists and its mutation is RED.
      ORIGINAL ENTRY FOLLOWS. Reported not fixed
      by the PostWorkout XP repoint (2026-07-27) under R1.1, and Kd ruled
      "record as OWED, fix XP only" at that card's plan gate: the named task was
      the XP curve, and adding a fourth reader would have doubled a card on the
      page carrying the app's last live XP defect. CONCRETE, not theoretical —
      `getFormGrade(summary.form_accuracy)` has no unknown arm, so an absent
      score falls through every threshold to the final `return`: grade **D**,
      "Keep practicing", in red, with the bar animating to `undefined%`. That is
      a definite bad-form verdict on a workout whose form we were never told,
      i.e. verbatim round 5 F3's defect ("an unknown accuracy painted RED by the
      <60 branch") one page along. **A SECOND CONCRETE CASE, found by the T3:**
      a 200 with no `summary` key sets `summary = undefined` WITHOUT throwing,
      so the catch never runs and the page renders BLANK — no toast, no
      redirect, no text. The smoke rig's `empty200` state serves exactly that,
      and its comment says so, meaning a white screen there is the known state
      rather than a broken rig.
      **COUNT CORRECTED 2026-07-27 (T3 F5) — the line said "roughly fourteen",
      which was a guess.** Measured: 40 `summary.*` occurrences, minus 3
      comment-only and 3 `xp_earned` (which IS guarded), = **34 bare reads
      across NINE distinct fields** — `active_seconds` (8), `form_accuracy` (6),
      `duration_minutes` (6), `personal_records` (4), `current_streak` (4),
      `exercises_count` (2), `calories_burned` (2), `stretches` (1),
      `meal_suggestions` (1). (The review that raised this said eight fields; it
      is nine. A finding is a claim and inherits V1 too.) The fix is the
      established shape — a `readSummaryView` alongside `readStatsView` — and
      its natural home is the `workoutApi` repoint card, since that is the
      client this payload arrives on.

- [x] ~~🟡 **The XP bar's width has no protection a render test can give it —
      framer-motion is invisible to jsdom.**~~ **STRUCK 2026-07-28: THE PREMISE
      WAS FALSE, and this card should never have existed.** Raised by the
      PostWorkout T3 round 1 on the claim that `animate` "never executes under
      jsdom — the node reads `width: 0px` in every state". Round 2 MEASURED it
      on framer-motion 12.42.2: `0px` is the `initial`, and after the element's
      own `delay: 0.8 + duration: 1` the node settles at the real width. Round 1
      read the DOM about 1.8s too early — the existing `waitFor` resolves long
      before the animation ends — and generalised one instant into "every
      state". Measuring the case and calling it the class, in the fix written
      for exactly that mistake.
      **Consequences, all now undone:** the bar is asserted in the DOM where it
      always could have been (`expect(…style.width).toBe('61.5%')`, which
      catches the destructure bypass the regex cannot see); round 4's standing
      "add a render assertion instead" was never actually overridden; and no
      framer-motion mock is needed, so the 28 tests in that file stay untouched.
      Kept struck rather than deleted, per the rule that items leave this file
      by being done or by a ruling — and because "a card raised on a premise
      nobody measured" is the failure worth being able to find again.

- [ ] 🟡 **`gamificationApi.test.js`'s `validXp` fixture is impossible.**
      Found by T3 round 2 while checking a claim in the PostWorkout card — the
      corrected render fixture's comment cited this one as corroboration, and it
      does not corroborate. It reads `total: 330, level: 3, xpInLevel: 52`, but
      330 is LEVEL 2 on this curve (`xpForLevel(3)` = 348).
      **COUNT CORRECTED 2026-07-28 (T3 round 3 F3) — this line said "four of its
      six fields are unreachable together", and no reading of the block yields
      four.** Measured against `xp.ts`'s own `xpProgress`: hold `total: 330` and
      FIVE are wrong (the truth for 330 is level 2 / 230 / 248 / 92.7 / 348);
      hold the other five and exactly ONE is — `{level:3, xpInLevel:52,
      xpForNext:374, progressPct:13.9, nextLevelAt:722}` is `xpProgress(400)` to
      the digit. **So the fix is one character class: `total: 400`.** The same
      sentence also named `nextLevelAt` 348 and then left it out of its own
      tally. Recompute from `xpProgress`, never by hand — which is the whole
      lesson of the fixture this one was cited to corroborate.
      Same class as the render fixture corrected on 2026-07-27, one file along,
      and the tests using it are passthrough/shape tests that would pass with any
      six numbers, which is why nothing caught it. NOT fixed by the PostWorkout
      card (R1.1 — it is the XP card's file and its assertions would need
      re-checking against real values).

- [ ] 🟡 **`Running.jsx` fabricates a level: `stats?.running_level ?? 1`.**
      Found by the PostWorkout T3 (2026-07-27) while checking whether the
      100-XP class was really closed. It is verbatim the `user?.level || 1`
      class deleted from the Sidebar and the `s.level || 1` class deleted from
      the Dashboard — a confident "Level 1" for a user whose level nobody knows
      — on a live screen, differing only in which payload it reads (running has
      its OWN progression, `running.py`'s `running_xp`, which is a separate
      system from `user_xp` and was explicitly out of that card's scope,
      DECISIONS 2026-07-25 D4). Not fixed here (R1.1: different payload,
      different card). Closes with the running/geo repoint.
- [ ] 🟡 **The sidebar level is STALE until a full page reload.** Raised by the
      XP card's T3 round 2 (2026-07-26), which correctly demolished the reason
      the code gave for its own design. `useXp` reads once with `[]` deps and
      `Sidebar` mounts in `AppLayout` and never unmounts across navigation, so
      after a workout sync the sidebar keeps showing the pre-sync level until
      the user reloads. The comment had claimed the hook AVOIDED the staleness
      that an AuthContext value would have; it does not — the two differ only in
      WHEN the single read happens, and the honest reason to prefer the hook is
      that it is contained, not that it is fresher. Kd's smoke did not catch it
      because step 6 said "complete a workout, then reload", and the reload is
      exactly what hides it. Real fixes: refetch on the sync event, or a shared
      store with invalidation (which pairs with the dedupe line below). Not
      built with the card because either one is the Card-2/6 widening Kd ruled
      out — but the card must not claim freshness it does not have.
- [x] 🟡 **The XP source guards catch spellings, not the whole class — DONE
      2026-07-26 (round 4), by making the DOM test the protection of record.**
      Kd approved `jsdom` + `@testing-library/react` (R1.4) and
      `apps/web/src/pages/xpDisplay.render.test.jsx` now carries 13 render
      assertions; `vitest.config.js` gives `*.render.test.jsx` a jsdom
      environment. This also closes the JSX-coverage gap recorded from Cards
      2/3/4 for these three screens.
      **THE ORIGINAL TEXT OF THIS LINE WAS ITSELF FALSE, and the correction is
      the point:** it claimed "eight real bypasses were mutation-tested and are
      caught, including … destructuring defaults". Round 4 F1(a) then defeated
      the guard with exactly a destructure — `const { level = 1 } = xp ?? {}` —
      which `FIELD_READ` structurally cannot match, because it requires a `.` or
      `[` after `xp` and a destructure has neither. The earlier mutation must
      have tested a different spelling than the one the sentence names. Recorded
      here rather than quietly overwritten: a guard's own coverage claim is
      exactly the kind of assertion that needs re-testing, not re-reading.
      Ten bypasses across four rounds is the evidence that source-text matching
      cannot close this class; the guard stays as a cheap tripwire and its header
      now says so in those words.
- [ ] ⚪ **Render-test coverage is three screens, not all XP consumers.**
      Recorded 2026-07-26 (round 4). `xpDisplay.render.test.jsx` covers
      Dashboard, GamificationStrip and Achievements. **`Sidebar.jsx` is a
      `useXp` consumer with NO render assertion** — during round 4's mutation
      (b) the fabrication was re-introduced there and only the source guard's new
      positive control caught it, not a DOM assertion. Add a Sidebar render case
      when its layout dependencies (AppLayout, router) are cheap to mount.
- [ ] ⚪ **The guard's per-file lists are still four hardcoded literals.**
      Recorded 2026-07-26 (round 4 F8), which found the header's claim that they
      were "DERIVED from xpConsumers()" false — only the field-read scan is
      derived. `gamificationApi.test.js` hardcodes paths in the `gated` list and
      in three per-site blocks, so a FIFTH consumer added tomorrow gets zero
      gating coverage and nothing turns red. Not fixed in round 4 because the
      render tests now carry the real protection and growing this file further is
      explicitly the wrong direction (see its header); revisit only if a fifth
      consumer actually appears.
- [ ] ⚪ **`useXp()` makes one request per mounting component.** Sidebar always
      mounts it; GamificationStrip and Achievements add a second on their pages.
      A shared cache / in-flight dedupe (or a context value with a
      post-sync refresh) is the eventual home — deliberately NOT built with the
      XP card, because an unproven cache is worse than a cheap authenticated
      GET, and a value read once at session adoption goes stale on every
      workout sync. (2026-07-26.)
- [ ] ⚪ **XP display in the workout calendar — CURRENTLY DEAD, do not "restore"
      it.** WorkoutCalendar renders XP behind `session.xp_earned > 0`, but the
      old backend NEVER WRITES `xp_earned` onto a workout: the completion
      handler computes it, `$inc`s the USER's total and returns it in that one
      response (workouts.py:221-259, :311), while the session `$set`
      (:192-203) stores only completed/calories/duration/active_seconds/
      form_accuracy/exercises/completed_at. `/history` then projects a field
      that was never written (:373) and reads `s.get("xp_earned", 0)` → 0 for
      every workout, so the block has never rendered for anyone. **The
      no-removal rule is therefore NOT engaged** — there is no live feature to
      preserve when the calendar eventually moves. Any real XP display is
      gated on the XP-storage card above (P2.3 GAP-1), not on this.
      (Found 2026-07-21 while planning the calendar card.)
      **AMENDED 2026-08-01 when the calendar actually moved (DECISIONS :2912).**
      The block is gone from `WorkoutCalendar.jsx` with the old payload, and
      nothing a user has seen was lost — this line's own finding is why. What
      this card ADDS to it, command-verified: per-workout XP has no home in the
      NEW schema either. `grep -rn "xp" apps/api/src/db/schema/workouts.ts`
      returns nothing, and `user_xp` (db/schema/game.ts:39) stores ONE running
      total per user with `level` derived on read. So a real per-workout XP
      display is a MIGRATION plus a sync-time write, not a client change — and
      it is the SAME gap PostWorkout carries (`PostWorkout.jsx:40`: "`xp_earned`
      STAYS on the old summary payload, because the new API has no [per-workout
      XP]"). One backend card would close both surfaces; neither can be closed
      from the web side.
      **AMENDED 2026-08-07 — HALF OF THIS IS NOW WRONG, and the correction is the
      useful part.** The summary card (DECISIONS :5438) closed the PostWorkout
      surface **without** a migration and **without** a sync-time write:
      `xpEarnedForWorkout` DERIVES the figure from the ported `XP_REWARDS`
      constants and facts already stored (the workout's `avg_form_score`, and
      whether its day continued a streak). So "a MIGRATION plus a sync-time
      write" was true of STORING a per-workout total and false of DISPLAYING one.
      The quoted `PostWorkout.jsx:40` comment is gone with it.
      **What is still open is the CALENDAR's per-workout XP**, which would need
      the same derivation applied to a list — cheap now that the function exists.
      **And a real trap this card met, worth carrying:** the derivation must
      credit `streak_day` the way the TOTAL does — once per DAY, not once per
      workout — or two workouts in a day each claim it and the screen out-runs
      the total (:5618 C/H-1, fixed by `hasEarlierWorkoutOnDay`). Any list
      version inherits that hazard.
- [x] 🔴 **Google login — DONE, SMOKE PASSED (Kd, 2026-07-24).** End-to-end
      browser click-through on the local stack succeeded: `/login` → "Continue
      with Google" → Google account chooser → callback → logged in. All three
      closing conditions met (master merged into `web-repoint` @ 57526aa; Google
      OAuth credentials created + redirect URI `http://localhost:3000/v1/auth/
      google/callback`; smoke passed). The un-tick (web-half T3, 2026-07-24) held
      exactly until the feature actually worked — the DPDP Day-14 precedent.
      API half merged to master 2026-07-24 (PR #48): `GET /v1/auth/google` +
      `/callback` set httpOnly-cookie sessions (no token in URL/localStorage),
      3-way upsert, email-verified via consumed token, CSRF state, per-IP limit;
      fresh-chat T3 (2 blocking + 2 low, all fixed + mutation-verified). Web half
      done on `web-repoint` (this branch): Login/Register buttons un-gated and
      pointing at `${VITE_API_URL}/v1/auth/google`; `/auth/google/success` route
      restored (bare route); Login toasts the callback's `?error=`;
      `GoogleAuthSuccess.jsx` REWRITTEN — the `#token`/localStorage/raw-`setUser`
      flow is GONE, it reads the cookie session AuthProvider restored (getMe →
      adoptSession) and routes via the pure `googleSuccessRoute` (unit-tested);
      `setUser` no longer exported from AuthContext.
      **CLOSES WHEN:** (1) master merged into `web-repoint` so the endpoint the
      buttons target exists ON THIS BRANCH (web-repoint trails master by 11 — the
      API is real, just not integrated here yet; without the merge the buttons
      404 in local dev/smoke), AND (2) Kd creates the Google OAuth credentials +
      sets the API's `WEB_ORIGIN` to the web origin, AND (3) the browser
      click-through passes. (v1 §6.1:438; DECISIONS 2026-07-15 Cards 1–2,
      2026-07-24 google-login.)
- [ ] 🔴 **Avatar / profile-picture storage.** No `profilePicture` field exists
      in the shared schema or the users DDL (command-verified), so this is the
      one Settings surface still on legacy mlApi. **Scope MUST include the R3.9
      security the current path lacks** — it base64-inlines a 2 MB image into a
      JSON PATCH; R3.9 requires magic-byte content-type validation (not
      extension), a size cap, R2 storage under SERVER-generated keys, and
      signed-URL/CDN delivery. Do NOT inherit the current shape at cutover.
      (DECISIONS 2026-07-20, Card 7.)
- [x] 🔴 **Coach chat retry protection — API half DONE, merged 2026-07-22 as
      PR #43** (merge commit `facc804`; five fresh-chat T3 rounds).
      `/v1/coach/chat` had no per-route rate limit and accepted no
      Idempotency-Key, so a client retry opened a second thread, spent a second
      quota slot, and duplicated the messages. The API half now takes an
      optional `Idempotency-Key` and carries a 10-message/minute per-user cap,
      both placed BEFORE `requireQuota` (which increments the counter itself).
      (DECISIONS 2026-07-12 P2.5b T3; Kd D1(b)
      2026-07-16; design + Kd-approved numbers, DECISIONS 2026-07-21 on that
      branch.) **The two open lines below are what it does NOT close.**
- [x] 🔴 **Coach "Try again" control — the client half — DONE 2026-07-22.**
      Built as described below: the key is minted ONCE per composed message and
      stored with it, so "Try again" resends an IDENTICAL body under the SAME
      key; the input box is deliberately not restored (the button is the retry
      path). The 429 fold-in below is delivered too — the catch now branches on
      `err.response?.data?.error`, so the burst cap says "you're sending
      messages too quickly" and only a real `quota_exceeded` mentions upgrading.
      An unrecognised 429 also falls back to the "too quickly" copy: the global
      @fastify/rate-limit throws an untyped error, so its 429 reaches the client
      as `{error:"request_error"}` (verified) and must never produce the upgrade
      copy. `quota_exceeded`, `not_found` and `validation_error` offer NO retry
      button (it could not help); the two key-errors retry with a FRESH key
      (the same one would 400 for the full window). Fresh-chat T3: its BLOCKING
      finding was that the button was addressed per-message while the send
      writes to the TAIL, so a stale button resent the right key into the wrong
      bubble and overwrote a newer reply — closed at BOTH layers (offers
      withdrawn on compose; the button cannot render off-tail) and pinned by
      unit tests. Live-driven before handover: replay returned a byte-identical
      body with `idempotent-replay: true`, a same-key/different-message request
      returned 400 `idempotency_key_mismatch`, and one thread existed after
      three requests.
      **What was owed, kept for the record:** `Coach.jsx` cleared the message
      box on send and never restored it, and there was NO retry affordance — so
      a key minted inside `sendMessage` would have differed on every attempt and
      deduped nothing, and the user's only route back was retyping, which the
      server sees as a new message. (An earlier version of this line called the
      client half "one header line"; that was wrong and was corrected on
      2026-07-21.) The FOLD-IN was that every 429 mapped to the quota copy, so a
      free user with four questions left who sent quickly was told to UPGRADE.
      **SMOKE — PASSED (Kd, 2026-07-22), all three steps**, which also closes
      the API half's owed smoke (per CLAUDE.md Part I §2 none of its three new
      client-visible responses was browser-reachable until this landed):
      (1) request blocked in devtools → error with a **Try again** button →
      unblocked → click → real answer, ONE conversation in the sidebar;
      (2) the T3 V1 case — fail one message, then send a different one that
      succeeds → the stale button is gone and the newer answer is NOT
      overwritten; (3) ~11 rapid sends → the burst-cap message says "sending
      too quickly", not the upgrade copy.
- [ ] 🟡 **Empty conversation left behind by a failed coach message.**
      PRE-EXISTING, found 2026-07-21 while verifying the card above, not
      introduced by it. `repo.createThread` commits on its own BEFORE the
      provider is called and messages are appended only on success, so a
      message that fails after that point leaves an empty thread in the sidebar
      **even if the user never retries**. Scope, verified: only for the FIRST
      message of a new conversation, and never when the coach is unconfigured
      (that 503 precedes creation). The retry path now RESUMES such a thread, so
      only the never-retried case remains. Proper fix = create the thread in the
      same transaction as the exchange, which touches the `api_cost_events`
      ledger transaction (DECISIONS 2026-07-12 T3 finding 3) — its own card, not
      a drive-by.
- [ ] 🟡❓ **A coach question is spent even when the provider never answers —
      needs a Kd ruling.** `requireQuota` increments BEFORE the handler runs
      (the ported quotas.py doctrine, "a request that fails later still
      consumed a slot"), so a Groq failure costs a free user one of their five
      monthly questions and returns nothing; a retry spends another, because it
      does real work. **Newly REACHABLE rather than theoretical:** Groq's free
      tier allows 6,000 tokens/minute and a real coach call measures ~2,573
      tokens (from this project's own `api_cost_events` rows), i.e. about two
      questions a minute before Groq refuses. Refunding the slot when no answer
      was produced is a small, contained change to the coach route's failure
      path — but it changes ported behaviour, so it is Kd's call, not a chat's.
      (DECISIONS 2026-07-21.)

### Legal / operational gates
- [ ] 🔴 **WHICH USER-LINKED TABLES THE DAY-14 PURGE ACTUALLY CLEARS IS STILL
      KD'S TO RULE, AND UNTIL 2026-09-02 THE QUESTION LIVED ONLY IN A CODE
      COMMENT.** `apps/api/src/modules/privacy/tables.ts` carries a SPEC-GAP list
      of THIRTEEN tables and columns that keep a link to a purged person and that
      §5.2's prose does not name — `one_time_tokens · refresh_tokens ·
      gym_members · gym_staff · gym_join_applications · gym_attendance ·
      gym_closures · api_cost_events · usage_daily · trace_samples ·
      gyms.owner_user_id · subscriptions.owner_id ·
      exercise_definitions.published_by`. Widening a
      deletion list on a chat's judgement is R0.2, so filing them there was
      right; **leaving the RULING untracked was not, and it is this file's own
      failure mode** — the list has been growing table by table since 2026-07-22
      (`gym_join_applications` joined it 2026-08-19 at :11072, `gym_attendance`
      on 2026-09-02) with no line here to say anybody still owes an answer.
      **`gym_closures.created_by_user_id` JOINED IT LATER THE SAME DAY AND WAS
      FOUND BY A MACHINE RATHER THAN A PERSON** (attendance T3 round 2, L-7):
      the list is now also an exported array with a test walking `pg_constraint`
      for every foreign key to `users`, so a new user-linked table is red on the
      day it is created instead of a card late. It records WHICH PERSON declared
      a gym shut on a given date; the opening-hours card that created it
      enumerated nothing. **The check does NOT shrink this question — it only
      guarantees the list Kd is asked to rule on is complete, which :11072 said
      was the condition of the ruling being worth anything.** It is a foreign-key
      walk, so `subscriptions.owner_id` (polymorphic, no FK) and identity inside
      jsonb remain invisible to it and are still enumerated by hand.
      **What it blocks:** nothing today, because the purge itself is not running
      anywhere (the 🔴 below). **What makes it urgent when that changes:** the
      newest member is the most sensitive — attendance is a dated, per-gym record
      of which days a person was physically inside a building, and it survives an
      erasure request today. **RULE THEM TOGETHER** — a ruling that purges
      membership history but keeps the applications and the visits that produced
      it is a partial answer, and what makes either list auditable is that
      deletion and export stay symmetrical. `gym_attendance` is also the one
      whose **Day-0** half is unhandled: a membership is closed and an
      application cancelled at Day 0, and nothing touches an attendance at all.
      (DECISIONS 2026-09-02, attendance T3 round 1 C/H-4; the thirteenth entry
      and the automated check, attendance T3 round 2 L-7.)
- [ ] 🔴 **DPDP Day-14 HARD-DELETE — CODE COMPLETE 2026-07-22, BUT NOT YET
      RUNNING ANYWHERE, so it is NOT done** (branch `dpdp-day14-purge`).
      This line was first written ticked; its T3 (finding D1) proved that
      wrong and it is UNTICKED. A correct sweep that is scheduled nowhere
      deletes nothing, and "a deleted user's data actually goes" is the whole
      obligation. Command-verified 2026-07-22: **no Dockerfile exists in the
      repo**, `docker-compose.yml` defines only mongo/redis/mongo-express (no
      api, no worker), `ci.yml` has no deploy job, and nothing in RUNBOOK says
      where `pnpm worker` runs. **What closes it:** the deploy path runs the
      worker (or a cron runs `tools/dpdp-purge.ts --apply`), and the entry
      names where. The code below is real, T3'd and proven — the deployment
      is what is missing. §5.2 ANONYMIZES the users row rather than deleting
      it, so NO FK cascade collects user-owned PII; §5.2's explicit Day-14
      DELETE list is the only mechanism, and it now exists as
      `apps/api/src/modules/privacy`. 17 tables end empty per purged user — 15
      deleted directly, `meal_log_corrections` and `coach_messages` collected by
      CASCADE from their parents (they carry NO `user_id`, which the approved
      plan had assumed they did — caught by verification before any code).
      `user_fitness_profiles` IS included, so the condition on which
      onboarding-storage was merged (2026-07-16) is discharged for this half.
      Runs on BullMQ (**now installed**, 5.80.10) from a new `worker`
      entrypoint per v1 §6, plus `tools/dpdp-purge.ts` which is **dry by
      default** and needs `--apply` to destroy anything.
      **The build note is honoured and was bigger than it looked:** the
      retention window is ONE constant (`apps/api/src/retention.ts`), and there
      turned out to be FOUR hard-coded 14s, not one — two of them the
      user-facing strings on `DELETE /v1/users/me`. Had only the code read the
      constant, widening to GDPR's 30 would have left the API telling users
      "you have 14 days" while purging at 30.
      **PARTIAL PROGRESS 2026-07-24 (deploy-infra card) — STILL UNTICKED, and
      deliberately so.** Three of the four command-verified absences above are
      now closed: `infra/Dockerfile` exists (one image, two modes, v1 §6),
      `infra/docker-compose.yml` defines a `worker` service running
      `src/worker.ts`, and `infra/README.md` NAMES where the purge runs — the
      worker service on the Hetzner VPS, `dpdp.purge` on the `rollups` queue at
      03:00 UTC. What remains is the part that actually deletes data: **no host
      is provisioned and nothing is running**, and `ci.yml` still has no deploy
      job. An image proven on a laptop is not a scheduled sweep. This line ticks
      when the compose runs on a real host — the same standard that unticked it
      after T3 finding D1, applied to the card that built the image rather than
      relaxed for it.
- [x] 🔴 **CI runs none of the database tests — including the purge suite.**
      Found by the DPDP T3 (finding D2) and MEASURED both ways: the gate job
      runs `pnpm test` with NO `DATABASE_URL`, giving **151 passed / 173
      skipped**, while the same suite with a `DATABASE_URL` gives **324
      passed**. The Neon-branch job only runs `drizzle-kit migrate`. So every
      DB-gated suite this project has built — auth, workouts, nutrition,
      coach, the Mongo migration, and now the Day-14 purge — is green on merge
      without ever executing. **Pre-existing infrastructure, not broken by any
      one card**, but the purge is what makes it serious: the only code in the
      repo that irreversibly destroys user data has zero enforced coverage.
      Fix is to give the test job a Neon branch (the migrations job already
      creates one, so the mechanism exists). Its own card — R1.1.
      **DONE 2026-07-23 — PR #47, branch `ci-db-tests`.** The proposed fix
      ("give the test job a Neon branch") was TRIED (commit 34aa7c0) and MEASURED
      too slow: every test PASSED but the full suite took ~38 min against remote
      Neon from a GH runner (uniform latency, not a hang), overrunning a 30-min
      cap. Kd ruled to SPLIT instead: `migrations` keeps proving DDL on a real
      Neon branch; a NEW `db-tests` job runs migrate + seed + `pnpm --filter api
      test` against a pgvector/pgvector:pg16 SERVICE CONTAINER on the runner
      (~2 min, no paid Neon compute per PR, DB clean by construction). PROVE both
      ways: `api tests on local Postgres` green 341/341, 0 skipped; a
      deliberately-broken purge assertion turned that check RED while the DB-free
      gate stayed green, then reverted. See DECISIONS 2026-07-23 "CI runs the
      database-backed api suites".
- [ ] ⚪ **Assert the DB suites POSITIVELY executed (count floor / fail-if-skipped).**
      T3 defense-in-depth on the CI db-tests card (2026-07-23). No silent-skip
      path exists TODAY — `DATABASE_URL` is one job-level value shared by
      migrate/seed/test, and a bad URL fails `drizzle-kit migrate` loudly before
      the test step, so a green-with-0-DB-tests run is unreachable. But nothing
      POSITIVELY asserts a non-zero executed count, so a future refactor that
      split the env or changed the `skipIf` var could skip the suites while
      migrate/seed still pass → false green. Add a guard that fails the db-tests
      job if skipped>0 / passed<floor (a verified vitest-JSON read, not a brittle
      grep). NOT built with the card: an unverified CI guard risks a false-red,
      worse than the low residual. R1.1 — its own small card.
- [ ] 🟡 **The DPDP purge's single-marker guarantee rests on ONE call site.**
      Raised by the round-5 T3 (2026-07-23) as latent, not a live bug —
      recorded so it is not lost. `lockDueUserForPurge` was widened from
      `TransactionSql` to `SqlOrTx` purely so the concurrency test could drive
      it on two explicitly-ordered reserved connections. That removed the
      COMPILE-TIME guard: a pooled `Sql` now satisfies the parameter, and on a
      pooled handle `FOR UPDATE` autocommits and drops the row lock instantly —
      silently reverting to the double-marker race this card fixed across four
      rounds. There is no DB backstop either: `audit_log` has only
      `(gym_id, at)` btree + a BRIN on `at`, **no unique index on
      `(action, target_id)`**, so a duplicate marker raises no 23505. Verified
      today: the sole production caller (`purgeUser` → `deps.sql.begin`) does
      pass a real transaction, so nothing is broken now. Two real closures,
      either of which ends the reliance: (a) revert the signature to
      `TransactionSql` and rework the test, or (b) add a partial unique index —
      **but NOT a naive one on `(action, target_id)`**, which would break the
      legitimate re-deletion case the `at >= deleted_at` bound exists to allow
      (a user deletes, restores, and deletes again). Pairs naturally with the
      CI line above, since neither is enforced on merge today.
- [x] 🔴 **DPDP JSON export — DONE 2026-07-23, merged as PR #46** (merge
      `5c76d6c`). `GET /v1/users/me/export` returns the user's data as JSON:
      17 tables + profile, DERIVED from the Day-14 delete list so the two §5.2
      rights cannot drift apart. Kd-ruled DEVIATION on delivery only — §5.2
      describes a zip behind a signed URL; none of that infrastructure exists
      and v1 §18 itself says "data-export endpoint", so the content is
      identical and adding signed-URL delivery later changes only how it is
      sent. Three fresh-chat T3 rounds (10+6+4). Notable: the rate limit
      shipped with an IP dimension that refused a second gym member's FIRST
      export (and cited a precedent saying the opposite); internal columns
      rode along on SELECT * (our per-request AI cost on every coach message,
      and the anti-cheat flags the spec calls silent); and an untyped lookup
      let a typo ship them, found three times one level down each round —
      now guarded against the real drizzle schema by a test needing NO
      database, so CI actually runs it. **STILL OPEN, its own line below:**
      whether `gym_members` and `leaderboard_snapshots` belong in the export.
      ~~the OTHER half of §5.2, still owed and still blocks P2.8~~ Split from the delete half by Kd ruling 2026-07-22
      because NONE of its infrastructure exists — command-verified: no R2/S3
      client in any `package.json`, no bucket or signing keys among
      `config.ts`'s 17 env vars, no zip library, and no Part 4 table to track an
      export job. It therefore needs new credentials plus ≥2 new dependencies,
      which would have blown the 🔴 one-thing-per-chat ceiling and delayed the
      legally load-bearing half. §5.2 wants "a JSON zip of every user-owned
      table above + profile, delivered via signed URL, 7-day expiry".
      **A DEVIATION PROPOSAL is on file for that card:** serve it as an
      authenticated `GET /v1/users/me/export` returning JSON directly — no zip,
      no R2, no signed URL — which satisfies §5.2's "both flows exist at launch"
      with zero new infrastructure and keeps the export a table LIST, so adding
      signed-URL delivery later changes delivery only, never content. Kd rules
      on that at the card.
- [ ] 🔴 **Drain offline sync queues before cutover.** Per-user localStorage
      buckets are keyed `user_<id>_*`; pre-cutover that id is the old Mongo
      ObjectId, after it the new UUID, so unflushed workouts orphan. Non-issue
      on greenfield prod (empty DB) — matters only for a data-carrying cutover.
      (DECISIONS 2026-07-15.)
- [ ] 🔴 New API deployed and healthy (`/health`), `data_backend` flag seeded.
      The IMAGE and compose now exist (`infra/`, 2026-07-24) and are proven on a
      local Docker stack; no host is provisioned, so nothing is deployed and this
      stays open. Provisioning starts the ~₹700–1,200/mo spend Kd already accepted
      at the P0.4b ruling (DECISIONS 2026-07-07) — it is a decision to execute,
      not a decision still to make.
- [ ] 🔴 Secrets in the deploy platform (escrow doc, Part 8 §1) — never in repo.
      `infra/README.md` lists the four hard-required variables (`DATABASE_URL`,
      `WEB_ORIGIN`, `JWT_SECRET`, plus `REDIS_URL` in production) and the file
      they belong in on the host (`infra/api.env`, gitignored + dockerignored).
      The escrow doc itself is still owed, as are the two rotations above.
- [ ] 🔴 Backup/restore drill actually performed and logged (Part 8).
- [ ] ⚪ **CI does not build or push the API image, and nothing auto-deploys.**
      Deferred by the 2026-07-24 deploy-infra card rather than half-built: v1 §19's
      pipeline ends "build images → migrate → deploy staging → manual promote",
      but there is no registry and no host to push to yet, so a build-and-push job
      would be ceremony that proves nothing. Its own card once a host exists.
- [ ] ⚪ **The image runs TypeScript through `tsx` rather than a compiled `dist/`.**
      Kd-approved at the deploy-infra plan gate as option A. No package the image
      needs has a build script (`apps/api`, `@app/shared` and `@app/engine` all
      run from source; only `apps/web` has one, `vite build`), so compiling means
      adding build scripts to three packages and repointing their `main`/`exports`
      — which changes module resolution for typecheck and test everywhere, past
      the Part I §7b one-thing-per-chat ceiling. Cost today: a boot-time transpile
      and a larger image. Worth revisiting if boot time or image size ever bites.

## 🟡 Needed before real users, not before cutover

- [x] 🟡 **Timezone capture** — DONE 2026-07-21 (the second audit miss, owed
      since 2026-07-11). The web now reports the browser's IANA zone on session
      adoption, so `users.timezone` is real and day-bucketing stops falling back
      to UTC — streaks had been rolling over at the wrong local hour for every
      user outside UTC (05:30 IST, in a Jorhat pilot). Pure web card: the PATCH
      has accepted `timezone` since P2.2. Writes only on a real change;
      best-effort; the client reports its zone and never computes a day
      boundary. Kd's smoke caught a duplicate write on first login (login and
      session-restore both firing) — guarded. SMOKE passed, and the stored
      value was verified written BY THE BROWSER on an untouched account.
- [ ] 🟡 **Timezone TRAVEL rule (§3.5) — still owed, deliberately NOT absorbed
      by the capture card.** "A day is kept if it qualifies in either the
      stored-at-the-time TZ or the new one" is not implemented: streak replay
      uses only the CURRENT `users.timezone`, so a user who moves between zones
      can lose a day that legitimately qualified under their old one. This was
      shielded while every user was UTC; capturing real zones makes it
      reachable, which is why it is now its own line rather than a footnote.
      (DECISIONS 2026-07-11 P2.3 T3 note.)
- [x] 🟡 **`limitedToDays` surfaced in the Progress UI** — DONE 2026-07-21.
      Every `/v1/progress` read returns the plan-clamp field and the page
      ignored it entirely, so a free-plan user saw "1 Year" over 90 days of
      data. Now: a notice under the period buttons, and the caption corrected
      to the window actually shown. **The clamp is compared against the
      REQUESTED window, never rendered on `limitedToDays !== null`** — the
      server reports it unconditionally (7d also returns 90), so the naive
      check would warn about a limit that is not limiting.
      Its fresh-chat T3 caught that the notice closed only HALF of f.4: the
      heatmap and personal-records endpoints take NO period and are gated
      anyway, so their own headings still lied at the three periods where the
      notice correctly stays quiet. Both now caption from their own window
      (`heatmapCaption` / `recordsNote`), with `longestStreak` carved out
      because it is deliberately ungated. Copy states the history is SAVED —
      it is a read gate, not deletion. SMOKE passed.
      (T3 Card 3 f.4, owed 2026-07-16 → closed by the Progress-clamp card.)
- [ ] 🟡 **Real-phone mobile-web camera smoke.** The claim "the file input opens
      the camera on phones" is UNVERIFIED (V1) — every smoke to date ran on
      Kd's desktop. The desktop-webcam ruling makes mobile web the PRIMARY
      meal-capture path, so this needs one real-device run: `vite dev --host`,
      `VITE_API_URL` + API `WEB_ORIGIN` on the LAN address (a phone resolves
      `localhost` to itself; CORS is exact-origin + credentials — the Card-4
      lesson). Also settles the recorded `capture`-vs-photo-library trade-off
      (options A/B/C, DECISIONS 2026-07-19; recommendation was "A now, C later
      only if the phone smoke shows the gallery limitation bites").
      (DECISIONS 2026-07-19.)

## ⚪ Improvements and residuals

- [x] ✅ **DONE 2026-08-28 — THE DECISION RECORD'S READ PATH IS SPLIT A THIRD
      TIME, AND NOTHING WAS SUMMARISED (DECISIONS :22497, Kd-ruled).**
      `DECISIONS-INDEX.md` had reached **492 KB / 6,500 lines / ~123k tokens** —
      the same size that made `DECISIONS.md` unreadable on 2026-07-30 — so a chat
      obeying the grounding rule spent its working memory before doing any work.
      One did, that morning, and declared the departure instead of hiding it.
      **Fixed by (a) `DECISIONS-TRIGGERS.md`, GENERATED from the `Read before …`
      sentences the rulings already carried — in `DECISIONS.md` AND in their index
      lines** (**607 phrases from 173 of 311 rulings**, verbatim, plus a §2 naming
      every ruling that declares none; staleness-checked on the root `lint`), and
      **(b) moving §1's 1,631 lines of finished card history to a new §1B**, byte
      for byte. **Always-read: ~6,500 → ~1,427 lines.** Kd's condition was *"does
      not get summarised things instead of details"* and it is met: nothing was
      shortened, reworded or deleted. **36 of 36 moved entries were proven still
      surfaced by an always-read file BEFORE anything moved, and after :22640 all
      36 are reachable by a trigger PHRASE rather than by a title.**
- [x] ✅ **DONE 2026-08-28, THE SAME SESSION IT WAS RAISED — and how it closed is
      worth more than the fix (DECISIONS :22640).**
      ~~SIX CARD RECORDS ARE REACHABLE ONLY BY A TITLE IN A GAP LIST — they need a
      `Read before …` sentence.~~ `:20986` · `:14174` · `:14147` · `:14013` ·
      `:12832` · `:12731`. **Every one of them ALREADY HAD one — in its
      `DECISIONS-INDEX.md` line — and the generator was only reading
      `DECISIONS.md`.** Kd asked whether a new chat could still skip something;
      checking rather than answering found the defect. **It was not six entries'
      problem, it was 39: coverage went 418 → 607 trigger phrases, 133 → 173
      rulings, and the Kd rulings reachable only by a title fell 26 → 16.**
      **The lesson is that naming them is what closed them** — a vague "some
      entries are weaker" would have hidden this for ever.
- [ ] ⚪ **~~177 OF 310~~ 138 OF 311 RULINGS DECLARE NO TRIGGER (16 of them Kd's),
      so the trigger file NARROWS a search and can never CLEAR one (recorded
      2026-08-28, DECISIONS :22497 §6; figure re-measured at :22640).**
      This is a standing property, not a bug, and it is stated in bold in the
      generated file's own header — but it is the thing most likely to bite:
      **:19256 is the measured cost of a chat concluding "no match, therefore
      nothing binds me"** (it grepped `trial|seat cap|300|band`, the governing
      ruling contained none of those words, and a settled question went back to
      Kd). **It shrinks by one line every time a ruling is written with a
      `Read before …` sentence**, which `CLAUDE.md`'s maintenance clause now asks
      for. ~~No deadline; it improves by habit or not at all.~~
      **2026-08-29 — KD RULED THE SENTENCE MANDATORY (DECISIONS :24703,
      `CLAUDE.md` AMENDMENT 2026-08-29), so this line stops growing.** *"Should"*
      became *"must"*, which is what the phrase "improves by habit or not at all"
      was measuring the cost of. **The figure re-measured the same day: 138 of
      323, and 138 of 325 after that ruling and its round — the count held flat
      across two new entries for the first time**, because both carry a sentence.
      **IT STILL DOES NOT SHRINK THE 138 ALREADY WRITTEN** — the ruling says so
      itself and this line is the place that stays honest about it. No deadline,
      because retro-fitting a trigger onto an old ruling means reading it in full
      to decide what it binds, and a guessed sentence is worse than none: it
      would send a chat somewhere on a claim nobody checked. **The right moment
      is when a card touches one of the 138 anyway.**
- [ ] ⚪ **`db.migration.test.ts`'s "0009 workout_sets CHECKs bite at the DB" is
      79 ms inside vitest's default timeout — it will keep flaking.** Recorded
      2026-08-01 (DECISIONS :3538) by the catalog card, which is NOT its cause:
      that test never calls the seed and does its own inserts. **Measured, not
      guessed:** it FAILED one full-suite run ("Test timed out in 5000ms"),
      PASSED the very next with nothing changed, and passes at
      `--testTimeout=45000` taking **5079 ms** — 1.6% over the 5000 ms default.
      It is ~15 sequential round-trips to a Neon branch, so any latency bump
      tips it. Fix is one argument (the file already uses `120_000` and
      `30_000` elsewhere), left untouched under R1.1 because it belongs to the
      log-only card. Whoever next edits that file should give this test its
      budget — a test that fails on network weather teaches the suite to be
      ignored.
      **WIDENED 2026-08-14 (DECISIONS :7730), measured across four runs on one
      evening: it is no longer ONE test.** Full-suite runs went 442/442 green,
      443/443 green, then **"0009 workout_sets CHECKs" timed out** — and a
      re-run of that file ALONE failed a DIFFERENT test in it, **"created every
      Part 4 §2 table" at 5006 ms**, while the 0009 one passed at 4165 ms.
      So the whole file is riding the 5000 ms default against a Neon branch in
      another country, and WHICH test trips is network weather. **Still not this
      card's**: `db.migration.test.ts` is not in its diff (command-verified), and
      no assertion failed in any of the four runs — every failure was the
      timeout. **The fix is now the FILE's budget, not one test's.** Note the
      second-order cost, which is the real reason to fix it: an evening of
      genuine green runs now ends in a red line that has to be re-diagnosed by
      hand before anything can be claimed, and the next chat may not bother.
- [ ] 🟡 **T3 round 8's four non-blocking findings (2026-07-28).** Given lines
      here in the same commit that deferred them, per the deferral rule — they
      were reported by a review that named them explicitly, which is exactly how
      items get lost when only prose records them. Full text at
      `t3-xp-web-r8-FINDINGS.md` §(3).
      1. `Achievements.jsx:737` `key={entry.name ?? i}` — `readLeaderboardEntry`
         DISCARDS the payload's `user_id` (which the file's own fixture carries
         at line 411), forcing name-as-key. Two athletes with the same display
         name collide and React reuses the wrong row. Fix is to keep `user_id`
         in the reader and key on it; the reason it is not in Round A/B is that
         it changes a reader's shape, which is its own small card.
      2. `Achievements.jsx:268` `podiumColors[entry.rank]` — `rank` is
         `finite()`, so 0 or a negative passes `isPodium` and yields a Crown
         with `color: undefined`. Cosmetic.
      3. `Dashboard.jsx:733` `{!loading && (CTA)}` — the STATIC "Ready to
         start?" call-to-action borrows the stats read's knowability, so a hung
         `getStats` hides it forever. Round 7 F8's shape, one site over. Note
         this is the same three-states-never-two family as F3 and is worth
         folding into whichever round touches `Dashboard.jsx` last.
         **RAISED at Round A's plan gate (2026-07-29) as a labelled
         RECOMMENDATION, since Round A WAS the last round touching that file —
         Round B touches only `Sidebar.jsx` and the two test files. Kd approved
         the plan as written, so it was not folded in and there is now no
         scheduled round that will pass this file.** It needs a card of its own.
- [x] 🔴 **A long-time user's OLD MONTHS GO BLANK on the calendar, and the page-
      walk is why. `/v1/workouts` needs a date filter.** Raised by Kd on
      2026-08-04, in response to this chat calling the truncated state
      "unreachable" — **which was wrong, and the correction is the point of this
      line.** 1,000 workouts is four sessions a week for five years. Real users
      reach it; the app is being built for a lot of them.
      **WHAT THEY SEE.** `/v1/workouts` is a keyset cursor list with NO date
      filter, so `fetchMonth` assembles a month by paging BACKWARDS from today,
      capped at `HISTORY_MAX_PAGES` × `HISTORY_PAGE_LIMIT` = 10 × 100 = 1,000
      rows (`apps/web/src/api/workoutHistory.js`). Browse to a month with 1,000
      workouts logged since, and the walk never reaches it: `truncated` comes
      back true and the grid is EMPTY. The T3 round-2 fixes make that state stop
      LYING (it no longer prints a bold "0 active days this month", and the
      caption is now true) — **they do not make the month readable, and this line
      exists so that is not mistaken for done.**
      **THE FIX IS ON THE API, not the client.** A month filter on
      `/v1/workouts` (or a dedicated month/range read) returns the month in one
      request at any history size: no cap, no walk, no truncation caption, and
      the ten requests per month view collapse to one. The client's page-walk was
      always a stand-in for a filter the endpoint does not have — the Card-5d
      precedent it cites (`listMealsForDay`, DECISIONS 2026-07-19) made the same
      trade under the same constraint, so **the same question should be asked of
      that reader when this is built.**
      **✅ CARD 1 (API) IS DONE 2026-08-04 — DECISIONS :4434.** `/v1/workouts`
      now takes `from`/`to`: half-open, absolute instants, narrowing only (the
      Part 4 §0.2 plan gate still out-ranks a wider `from`), inverted window =
      400. 19/19 against real Postgres, both new guarantees mutation-checked.
      **✅ CARD 2 (WEB) IS DONE 2026-08-05 — DECISIONS :4855. THE LINE IS
      CLOSED, AND THIS TICK IS THE SECOND ONE.** The first was spent in
      `d28ace5`, in the same commit whose own message said "Smoke and T3 unrun";
      **T3 round 1's F4 struck it**, citing :4119 four commits back on this very
      screen ("NOT ticked — smoke and T3 are both unrun"). It ticks now because
      the gate is actually met: Kd's browser smoke passed steps A–D (:4829), and
      BOTH review rounds are done with ZERO user-visible findings across them
      (:4718, :4855) under the two-round cap. This file's header rule is that
      nothing leaves except by being DONE; a tick is the only signal it carries,
      and spending it early is how the list stops being trustworthy.
      What landed: `fetchMonth` now sends the month's own boundaries (local
      midnight to local midnight, converted client-side so no timezone decision
      moves to the server) and reads back one page instead of walking up to ten
      from today. An older month is readable at any depth of history, and a
      month view costs ONE request rather than up to ten. The truncation state
      SURVIVES with an honest new caption — the 10-page cap now bounds an
      in-month walk, so it means "more than a thousand workouts IN THIS MONTH",
      which is a far rarer claim than the one it used to make and is NOT deleted
      for being rare.
      **Not a regression and not this card's defect** — the cap predates it and
      the old backend answered `?month=&year=` server-side, which is exactly the
      surface the repoint lost. Needs its own card (API half, then the client
      simplification); size it against the P2.8 order at DECISIONS :2866.
- [ ] ⚪ **A server whose cursor never ADVANCES makes the calendar draw every
      workout ten times.** Raised by T3 round 2 (2026-08-05, DECISIONS :4718's
      round-2 entry) while fixing F2, and given its own line because F2 fixed
      only the half that was this card's: the CAPTION no longer claims a volume
      it did not see (`inWindow` counts distinct workout ids), but `byDate` still
      pushes the same session once per row, so a day with one workout renders
      "×10" and its detail panel lists the same session ten times.
      **Pre-existing and not this card's defect** — the page-walk has pushed
      rows without deduplicating since the calendar was built (2026-08-01), and
      the date window neither caused it nor made it worse. It is ⚪ because it
      needs a SERVER that accepts `from`/`to` and then returns a non-advancing
      cursor; against a correct API it cannot happen, and nothing on screen is
      wrong today.
      The fix is the same shape as F2's and about three lines: track the placed
      ids and skip a repeat before pushing into `byDate`. Worth doing with any
      future work on that reader rather than on its own.
      **Deliberately NOT folded into the round-2 fixes** (R1.1): the caption was
      in scope because its claim was this card's own, and the grid was not.
- [ ] 🟡 **The MEAL history has the same blank-page defect as the calendar had,
      from the same cause.** Raised 2026-08-04 while building the workouts date
      window (DECISIONS :4434), and given a line immediately because the workouts
      version of this went untracked until a user-visible bug forced it.
      `listMealsForDay` (`apps/web/src/api/nutritionApi.js`) page-walks
      `GET /v1/nutrition/meals` backwards from today at 100 rows × 10 pages,
      because that endpoint has no date filter either. Card 5d chose that
      deliberately AND named the exit: **"option (c) server-side date filter
      stays the documented upgrade path if history runs deeper"** (DECISIONS
      2026-07-19). At ~5 meals a day the cap is about six months — **sooner than
      the workouts one, not later**, because meals are logged more often than
      workouts. Past it, an older day shows "couldn't load back this far", which
      is at least honest, so this is 🟡 rather than 🔴.
      The fix is the same shape and now has a worked precedent to copy:
      `from`/`to` on the meals list query, half-open, absolute instants, clamped
      by the plan gate exactly as the workouts one is.
- [ ] ⚪ **Two more captions would print "Last 1 Days".** `progressClamp.js:63`
      (`heatmapCaption`) and `:76` (`recordsNote`), plus `WorkoutCalendar.jsx:341`
      ("Your plan shows the last 1 days"), interpolate the plan window with a
      hard-coded plural — the same defect as `BACKLOG.md` L26, in the three
      siblings that card did not touch. **Latent, not live:** no seeded plan uses
      `history_days: 1` (`seed.ts` has only -1 and 90), so nothing prints it
      today. Named by T3 round 3 (2026-08-15) as out of scope for the
      dashboard-stats card, and deferred here rather than swept up in a fix
      round (rule 6 — minimal diffs).
      **Fix the CLASS, not the three cases** (:1239): `totalsWindowLabel` already
      owns the singular and the Dashboard now calls it rather than spelling it —
      the other captions should reach the same owner, not each grow their own
      ternary. That is what L28 was found for, one file over.
- [ ] ⚪ **On the FIRST load of an account with no stored timezone, the week
      strip can draw one flame a day out — for that one render only.**
      Found by the dashboard-stats T3 round 1 (2026-08-15, its Low-3), tagged Low
      with its argument shown, and **deferred rather than patched — so it is here
      rather than only in `BACKLOG.md`** (Part I §2.5: a Low that cannot be fixed
      in its round has become a deferral).
      `syncTimezone` is called fire-and-forget from `AuthContext.jsx:95,120`, by a
      DOCUMENTED decision recorded at both call sites: *"a best-effort write must
      never delay rendering or hold the loading spinner open."* So on the very
      first load of an account whose `users.timezone` is still null, the server
      buckets that render's trend by UTC while the client keys the seven cells
      LOCALLY — and east of Greenwich the two disagree for the early hours of a
      day. It self-corrects on the next load, and it needs a stored-null
      timezone, which the capture card makes rare.
      **Why it was not fixed in the round:** the only two fixes are to await the
      write before first paint — reversing the decision above, and delaying every
      login for a best-effort call — or to hide the strip until the timezone is
      known, which the no-removal rule forbids. Neither is a fix round's business
      (rule 6: minimal diffs, only the fix). **It needs a card and a Kd ruling on
      the trade-off, not a patch.**
      **Strictly better than before the repoint**, which is why it is ⚪: the old
      key was UTC permanently for the same user, so this is a one-render residual
      of a defect that used to be constant.
- [ ] ⚪ **The timezone-pin guard asserts only that the offset is NOT ZERO, so a
      DST zone would satisfy it.** Raised by the calendar's T3 round 2
      (2026-08-04, DECISIONS :4355) while auditing round 1's own fix, and
      reported rather than patched — the fix is not free, since naming the zone
      in the assertion duplicates the value the config already owns, and a
      duplicated constant is its own drift risk.
      `apps/web/vitest.config.js` pins `TZ=Asia/Kolkata` because under UTC the
      local day and the UTC day are identical by definition, so no fixture can
      tell a correct day-bucketing from the UTC-day defect (round 1's F2, which
      was inert on the CI runner). The config's stated reason for THAT zone is
      that it is the product's own market AND has no DST — a date fixture cannot
      drift twice a year. The guard at `workoutHistory.test.js:112` checks
      `getTimezoneOffset() !== 0`, which a DST zone passes. So the pin can be
      edited to, say, `Europe/London` and every date test keeps passing while the
      no-DST half of the rationale silently stops holding, and two fixtures a year
      start landing on the wrong day. **Not visible and not urgent: nothing on
      screen is wrong today, and the pin is not something a card routinely
      touches.** Closing it means asserting the property the rationale actually
      depends on — that January and July offsets agree — which is one line and
      names no zone.
- [ ] 🟡 **The calendar's stand-in for `safeParse` catches renamed fields but NOT
      changed UNITS — and a changed unit is what actually bit.** Raised inside
      the calendar T3 round 1's security pass (2026-08-04) as an observation
      rather than a numbered finding, and given a line because an observation
      with no tracker is how this exact thing gets lost.
      `readCalendarSession` deliberately reads per field instead of running
      `workoutListItemSchema.safeParse`, and the documented reason is sound: a
      strict parse would DROP a row the calendar could draw perfectly, over a
      field the screen never shows. The substitute is a contract-drift test that
      feeds a schema-valid row through the reader and fails if a field NAME
      moves. **That substitute is narrower than the R2.3 rule it replaces**: a
      field whose unit, scale or range changes keeps its name and sails through.
      **Not hypothetical — it is this card's own duration defect exactly.**
      `durationMs` kept its name while the payload changed from the old
      backend's whole minutes; the drift test was green throughout, and the
      screen printed a 9-second workout as "0m" until Kd's browser caught it.
      Closing it means asserting the SHAPE of values, not just the presence of
      keys — a unit fixture per numeric field (1000 ms ⇒ 1 s; a 0-100 form
      score; integer kcal), or a narrowed parse that validates only the fields
      this screen reads and keeps the drop-nothing property. Belongs with
      whichever card next revisits the reader, and the same question should be
      asked of every other per-field reader on the repoint (`readSummaryView`,
      `readOverviewView`, `readStatsView`, `readLeaderboardView`, and
      **`readCatalogPage`** — added 2026-08-05 by the exercise library's T3 round
      1, F6: that card shipped a SIXTH per-field reader without adding it here,
      and its F4 is what the omission cost, a renamed `slug` field turning an
      unreadable page into "0 Exercises" + "No exercises found". F4 is fixed; the
      wider UNIT question — a reader that catches renamed fields but not changed
      units — is still open for all six).
- [ ] 🟡 **Calories are shown as a flat number where the spec requires a RANGE.**
      Raised by the calendar's T3 round 1 (F3, NOT-VISIBLE) on 2026-08-04 and
      given a line the same day — it was tracked NOWHERE, which is the exact
      shape the deferral rule exists to stop, and it had survived every card
      that ever rendered a kcal figure.
      **Verified this session, not taken on the reviewer's word:**
      `docs/spec/02-part2b-trust-layer.md:148-152` — "**Range = point estimate
      ± 20%**, both ends rounded to the nearest 5 kcal; e.g. computed 212.4 →
      **'≈ 170–255 kcal.'** … constant, `CALORIE_BAND = 0.20`, versioned under
      `calc_version`" — and the §2.3 display table at :475 marks the session
      calories row "range ±20% / nearest 5 kcal / **always**".
      `grep -in "banding|CALORIE_BAND|calorie range" OWED.md` returned nothing
      before this line.
      **Why it is a trust requirement and not polish:** the number is an
      estimate derived from MET × body weight × time, and the spec's whole
      Trust-Layer argument is that a point value presented as fact overstates
      what the app knows. Same family as this project's em-dash rule, one step
      further on: `210` claims a precision the calculation does not have.
      **Not the calendar's to fix (R1.1)** — it is the display rule for EVERY
      surface reading a kcal point value from the new API. Both shared contracts
      already say so and are the pointer to the work:
      `packages/shared/src/workouts.ts:23` ("2B §2.3: display banding is the
      client's job") and `packages/shared/src/progress.ts:15`. One shared
      formatter, `CALORIE_BAND = 0.20` quoted from the spec and never
      re-derived, plus the "estimated" label — then every consumer switched to
      it, the one-ladder rule (a second spelling is how two screens come to
      disagree about one number).
- [x] 🟡 **Exercise names in the workout calendar are TITLE-CASED SLUGS — DONE
      2026-08-05** by the exercise-library content card, which is the card this
      line named in writing as the one that closes it. `exerciseLabel` now looks
      the slug up in `EXERCISE_CONTENT` — the same table the library screen draws
      from, so the two cannot call one exercise two things — and falls back to
      the derived `Slug Case` label for a slug the table does not stock (e.g.
      `barbell_squat`, which is not one of the 58). Both arms are pinned by test
      and mutation-checked (M22). The chips read `Push-ups`, not `Push Up`.
      **WAS:**
      Created 2026-08-01 by the calendar repoint (DECISIONS :2912) in the same
      commit that deferred it. The old `/workouts/history` projected up to five
      exercise NAMES per session (`workouts.py:388-393`) — a live feature, so the
      no-removal rule was engaged and the chips stayed. But the new API carries
      only `sets[].exerciseSlug` (`workoutDetailSchema`), so `exerciseLabel`
      renders `barbell_squat` as `Barbell Squat`. That is a label DERIVED from
      the value, not a name invented for it — the identifier is unchanged, only
      its punctuation — which is why it shipped rather than a guessed name.
      **Closes with the exercise-library content card** (already 🔴 above: display
      names, instructions, media, server-side search), which is the thing that
      gives a slug a real name and its hi/as translations. Until then the chips
      read machine-ish, and the smoke doc says so at step 2 rather than letting
      Kd report it as a defect.
- [ ] 🟡 **`WorkoutCalendar.jsx` keeps the pre-existing
      `react-hooks/set-state-in-effect` error.** Measured both ways 2026-08-01,
      not ticked: the file at HEAD produces **2** eslint errors (an unused
      `Dumbbell` import + this one); after the repoint it produces **1** — the
      unused import is gone, and this one was PRESERVED rather than restructured,
      under R1.1 (it predates the card and fixing it changes the loading
      semantics the new tests pin). Parity improved, so it blocked nothing; it is
      listed because "same as baseline" is a claim that decays into "clean" if
      nobody writes the number down. Whoever next restructures that effect should
      close it.
- [ ] 🟡 **`Running.jsx:97-100` carries BOTH of Round A's defect classes, in a
      SAFETY signal.** Found 2026-07-29 while enumerating F5's class across the
      XP card's ten files; outside those files, so reported under R1.1 and
      deferred rather than fixed — and given a line here so it is not lost the
      way Google login and timezone capture were.
      Verified by reading the file this session:
      1. `colors[weather.risk] || '#FFD66B'` — `#FFD66B` is the **low**-risk
         colour, so an unrecognised risk is painted as a definite LOW risk.
         That is round 8 F5's fabrication (unknown rendered as a definite
         value), except the claim here understates a weather hazard to a runner
         rather than mis-colouring a badge. Line 96 already special-cases
         `risk === 'unknown'` and `'none'`, so the backend HAS a declared
         unknown — the gap is every other unrecognised string.
      2. It is also round 8 F4's shape: an object indexed by external text with
         no own-property guard, so `risk: 'toString'` resolves to
         `Object.prototype.toString` — truthy, so the `||` fallback never fires
         and the colour is invalid. Not a crash here (unlike Achievements),
         because nothing is called on the result.
      **`apps/web/src/api/runningApi.js` declares ZERO readers** (grep-verified,
      `^export function read` → 0) and never mentions `weather` or `risk`, so
      this payload reaches the render completely unparsed — the same
      external-input-rendered-raw condition that produced rounds 1-7's entire
      finding sequence on the XP card. The running feature has not had that
      pass yet.
- [ ] 🟡 **R3.6's pre-commit gitleaks HAS NEVER EXISTED, and a feature-branch
      push is scanned by nothing.** CLAUDE.md R3.6 states "Gitleaks runs in CI
      and pre-commit". Verified 2026-07-28: there is no `.husky`, no
      `.git/hooks/pre-commit`, and `gitleaks` is not on PATH — so the pre-commit
      half is a rule the repo asserts and does not implement. The CI half is real
      but narrower than it reads: `.github/workflows/ci.yml` triggers on
      `pull_request` and `push: branches: [master]` ONLY. Found while pushing
      `web-repoint` (31 commits) as a backup — the push went out with a
      hand-written pattern scan standing in for gitleaks, which is weaker and was
      stated as such rather than ticked.
      **CORRECTED 2026-07-31: "so pushing a feature branch runs NO scan at all"
      was FALSE as written, and the correction narrows this item.** A push to a
      branch with an OPEN PR fires the `pull_request` event (`synchronize`), and
      `ci.yml` has no draft filter (grep-verified) — so `web-repoint` has been
      scanned on every push since PR #29 was opened, and its checks read "All
      checks have passed — 5 successful checks" on `a9a9d17`, gitleaks included.
      The claim holds ONLY for a branch with NO open PR. It was written on
      2026-07-28 about the very branch that did have one. Corrected in the same
      session a chat repeated the error one level worse — asserting that 112
      commits "have never been through CI" while an open PR had been gating them
      the whole time. Both errors share a cause: reading the trigger list and not
      checking what was actually running.
      **This matters here more than in most repos: three secrets have already
      burned** (Groq key, Neon password, Google client secret — all three above
      on this list), and two of those reached a chat transcript rather than git,
      which is the failure mode a pre-commit hook does NOT catch either. Fix is
      either (a) install gitleaks + a pre-commit hook so the rule becomes true,
      or (b) amend R3.6 to describe what actually runs. Do NOT leave the sentence
      standing as-is: a protection everyone believes in and nobody installed is
      worse than a known gap.
- [ ] 🟡 **`apps/web/src/sync/syncClient.test.js` fails locally, passes in CI.**
      `ReferenceError: window is not defined`. Cause VERIFIED by T3 round 8:
      `apps/web/.env` sets `VITE_API_URL`, vitest loads it, so the test's premise
      ("in this node test env `VITE_API_URL` is unset") is false on a dev machine
      with a populated `.env`. Not a product defect — but it makes EVERY local
      PROVE run report "1 failed", which is how a real regression gets waved
      through as "that's just the known one". It has been described as "the
      pre-existing syncClient env quirk" in five handoff blocks without anyone
      naming the cause until now.
- [ ] 🟡 **`apps/web` is excluded from the lint gate and the DoD box says
      "lint clean" anyway.** Root lint is `turbo run lint --filter=!web`, and
      `pnpm --filter web lint` fails with 67 errors package-wide. So every web
      card has ticked "lint clean" truthfully-by-exclusion while the package it
      changed was never linted. Found by T3 round 8, which also confirmed the 2
      errors in this card's own files (`Sidebar.jsx:8` unused `Zap`,
      `Achievements.jsx:5` unused `ChevronRight`) are pre-existing on master and
      correctly untouched per R1.1. Either lint web and fix the 67, or change the
      DoD wording so the box stops asserting something nobody checked.
      **RE-MEASURED 2026-08-26 (gym-details T3 round 4, :20867): it is now 73
      problems — 65 errors, 8 warnings — and it was 73 on `97d1098` before that
      round touched anything, so the debt GREW by 6 while every web card kept
      ticking the box.** That growth is the argument for closing this item.
- [ ] ⚪ **Two PostWorkout behaviours are render-test-proven but BROWSER-unreachable.**
      T3 round 3 F7 (2026-07-30). No rig state has `duration_minutes` present with
      `active_seconds` absent (the minutes-fallback arm, where "NaNh NaNm total"
      lived), and none has unreadable list ELEMENTS — so two behaviours rounds 2
      and 3 wrote fixtures for cannot be seen in a browser. Round 2 F4 established
      that a jsdom-only path should be made rig-reachable and then did it for one
      of the three paths it created. Fix is a `minutesOnly` and a `badElements`
      state in `apps/web/tools/mock-ml-backend.mjs` plus smoke steps — deferred
      because it only pays off with a RE-RUN smoke, which is Kd's call, not a
      chat's.
- [ ] 🟡 **The mutation harnesses are not run by CI, so their tables decay — AND
      ON 2026-08-30 THIS STOPPED BEING A PREDICTION AND BECAME A MEASUREMENT.**
      `apps/web/tools/mutate-postworkout-summary.sh` is a point-in-time
      measurement: it was green at `HEAD` on 2026-07-30 and nothing re-checks it
      when the files it mutates change. Raised by T3 round 3 as the general form of
      its own F1 — the same reasoning that says "prove a test RAN" says "prove the
      table is still true". Recorded rather than wired into CI, because the sed
      anchors are literal source strings and a CI job that goes red on an innocent
      refactor teaches people to ignore it. ~~Its header says so; revisit if a
      second harness ever appears.~~ **There are 17 (:13432's Low-4), and the
      revisit is overdue.**
      **WHAT ACTUALLY HAPPENED, measured on the held-application card
      (DECISIONS :25092): `mutate-join-door.mjs` had FOUR dead anchors and had
      been ABORTING — producing no verdict at all — since 2026-08-20.** Ten days
      and several cards shipped past a table that was saying nothing, and nobody
      noticed, **because the abort reads as a broken tool rather than as an
      unguarded guarantee.** All four were ordinary refactor drift in the files
      they point at (`removed: 0` joining `RANK`, the queue's instruction moving
      onto its own conditional, a name wrapped in a span, `member.complimentary`
      becoming `seatIsFree(member)`). Re-aimed at the same call sites and the
      whole table now runs.
      **THE GUARD THAT WOULD HAVE CAUGHT IT IS SMALL AND ALREADY HAS A HOME:
      `apps/api/scripts/check-harnesses.mjs` walks every harness on the ROOT lint
      and today only `node --check`s them.** Teaching it to verify each row's
      anchor against its target would have gone red on the first lint after
      `8b19775` rather than ten days later, and it cannot go red on an innocent
      refactor of anything the harnesses do not point at — which is the objection
      that kept this line ⚪ for a month. **Recommended as its own small card; not
      taken on the held-application card (R1.1).**
- [ ] ⚪ **`mutate-orgs.mjs` has FIVE anchors that match their target TWICE, and
      the harness's pre-check cannot see it — found 2026-08-30 (DECISIONS
      :25092), pre-existing, proven at `HEAD` in a throwaway worktree.**
      O17, O29, O89, O103 and O104. **The pre-check asks "does this anchor
      match?" and never "does it match ONCE?"**, while the mutation itself is
      `String.replace(from, to)` — which takes the FIRST hit. So each of these
      five may be mutating a line the row does not name, and its RED would then be
      evidence about a guarantee nobody chose. **Not a false verdict yet and not
      claimed as one: nothing here says the first hit is the wrong one, only that
      the harness cannot tell.**
      Left alone deliberately (R1.1) — the card that found it was the held
      application, the rows do not block a run, and re-aiming five anchors is a
      change to the instrument every other card's evidence rests on. **The fix is
      the same one line as the line above** (a match-count check in the walk),
      which is why they are neighbours here.
- [ ] ⚪❓ **Should `readSummaryView` DROP unreadable list elements rather than
      preserve them as null? — needs a Kd ruling.** Raised by T3 round 2 (F5),
      2026-07-30. Today an all-unreadable `personal_records` renders N trophy rows
      of "—" at both surfaces: not a fabricated VALUE, but a fabricated COUNT.
      Preserving is strictly better than the pre-card code (which threw), and
      dropping would silently remove rows the payload did claim exist — which is
      why a chat must not choose. A render fixture pins today's behaviour, so
      whichever way it is ruled the change is one assertion.
- [ ] ⚪ **`secondsLabel` carries to "1m 60s" on fractional input.**
      `Math.round(totalSeconds % 60)` rounds 59.6 to 60 instead of carrying into
      the minute. Found by T3 round 2 and verified a FAITHFUL port of the
      `formatSeconds` deleted at `dd07856`, so it predates this card (R1.1,
      reported not fixed). Reachable only if the old backend sends fractional
      seconds.
- [ ] ⚪ **`ShareCard` stamps today's date, not the workout's.** It renders
      `new Date()`, so a PNG exported the day after a workout dates it wrong.
      Pre-existing; `completed_at` is deliberately outside the reader's nine
      rendered fields, so closing this adds a field as well as a line. Found by T3
      round 2 (R1.1, reported not fixed).
- [ ] ⚪ **PostWorkout prints calories unrounded while its share card rounds
      them.** One workout can read `280.4 kcal` on screen and `280 kcal` in the
      downloadable PNG — two surfaces, one number. Pre-existing (the page never
      rounded, the card always did); found while writing the summary reader
      2026-07-30 and Kd chose **report only** at that card's gate, since rounding
      the page would be an unrequested display change to a real value. Both sites
      ARE now honest about an ABSENT value ("— kcal"). Close it by picking one
      rounding rule for both, in whichever card next touches that screen's copy.
- [ ] ⚪ **An EMPTY meal-suggestion or stretch list renders a heading with nothing
      under it.** Pre-existing, and distinct from the defect the summary reader
      closed: a list that ARRIVED empty is a truthful "none", so it is not a
      fabrication — but "Post-Workout Nutrition" over blank space reads as broken.
      The UNKNOWN case now says "unavailable right now" (2026-07-30); the empty
      case was left alone because writing empty-state copy is a product decision,
      not a defect fix. Same family as round 6 F6 / round 7 F8's empty-list states
      on the other three payloads.
- [ ] 🟡 **`RUNBOOK/cutover.md` is STALE — its checkboxes must not be quoted as
      fact.** Flagged by `DECISIONS-INDEX.md` when it was written (2026-07-30) and
      command-verified the same day: `cutover.md:107` still reads
      `- [ ] XP/levels display (GamificationStrip, Achievements)` although that
      card CLOSED on 2026-07-30 and both 🔴 lines for it above are ticked. The file
      states no verification date; the newest past date anywhere in it is
      2026-07-26 (`cutover.md:108`, the XP API-half merge — `2026-08-16` also
      appears but is the future Groq decommission deadline). So it predates THREE
      card closures, and `grep -ci postworkout` over it returns **0** although that
      card closed 2026-07-28.
      It matters because CLAUDE.md's grounding rule sends every
      migration-affecting card to cutover.md's prerequisites, and the P2.8 gate is
      "every owed endpoint exists" — a checklist that under-reports what is DONE
      reads as work still outstanding, and one that over-reported would be worse.
      Given a line here rather than fixed in passing because re-verifying the whole
      file against OWED.md is its own pass, not a one-checkbox edit. Closes by
      re-verifying every box against OWED.md and re-dating the file.

- [ ] ⚪ **Onboarding wizard's native unit dropdowns → the shared `Select`.** A
      native `<select>` popup is OS-drawn and its hovered row uses the system
      accent (blue) which CSS cannot override; Settings' five dropdowns moved to
      `components/common/Select` in Card 7, the wizard's cm/ft + kg/lbs pickers
      were left rather than folded in silently. (DECISIONS 2026-07-20.)
- [ ] ⚪ **Food matching residuals** (Card 5c T3, DECISIONS 2026-07-17/18):
      (a) `bySubstring`'s cross-word `includes` is a latent master-era hazard
      ("tea" ⊂ steak, "ham" ⊂ hamburger) reachable by any short manual query —
      fixing it trades honest-drops for wrong-guesses and needs a Kd product
      ruling, not a silent widening; (b) REMOVALS of drafted items produce no
      Stage-5 correction row, though 2B §3.2 counts "item swapped" as a
      correction; (c) the API does not dedupe canonicals within one request
      (double-counts the item and the correction pair; the web excludes
      duplicates client-side only).
      Also recorded: descriptive names whose head noun we stock but the
      substring pass misses still drop honestly ("Margherita Pizza", plurals
      like "Plate of Rotis") — same product call.
- [ ] ⚪❓ **Raw HTML in coach answers renders as visible text — needs a Kd
      ruling, not a drive-by.** Seen in the 2026-07-22 smoke: the model emitted
      `<br>` inside a markdown table cell and it displayed literally
      ("→ 90-120 g `<br>` Carbs:"). `react-markdown` ignores raw HTML BY DESIGN
      and prints it as text; rendering it needs the `rehype-raw` plugin — a NEW
      DEPENDENCY (R1.4) **and** a decision to let model-authored HTML into the
      DOM, which is a security-shaped choice (rehype-raw does not sanitise on
      its own). The honest alternatives are (a) add rehype-raw + a sanitiser,
      (b) strip/convert a small set of known tags client-side, or (c) nudge the
      system prompt away from HTML (relies on the model obeying, the same
      weakness Kd rejected when choosing remark-gfm over prompt instructions).
      Cosmetic today and harms no data. (2026-07-22.)
- [ ] ⚪ **An over-long coach message is hard to recover.** The composer sets no
      `maxLength`, but the contract caps a message at 2000 chars
      (`COACH_MAX_MESSAGE_CHARS`, packages/shared/src/coach.ts), so a longer one
      is rejected with `validation_error` AFTER the box has been cleared — and
      that error correctly offers no "Try again" (resending the same too-long
      text fails identically), so the only route back is selecting the text out
      of the user bubble. The copy hedges ("may be too long"), asserting nothing
      false. Pre-existing; surfaced by the Try-again card's T3 (V5) and reported
      rather than fixed (R1.1) since it needs a client-side length affordance,
      not a change to the error mapping. (2026-07-22.)
- [ ] ⚪ **Coach streaming.** Non-streaming was chosen for v1 (exact token/cost
      accounting + exact-match cacheability, nothing consumed the endpoint until
      P2.8). A streaming card can follow post-cutover.
      (DECISIONS 2026-07-11 P2.5 GAP-3.)
- [ ] ⚪ **Outbox for external-call ledger writes.** `api_cost_events` is written
      immediately after a provider response but outside a transaction with the
      application rows (coach: same tx; vision: two statements). The residual
      "provider spent + total DB failure" window is inherent to a
      non-transactional external call; an OUTBOX is the eventual answer, owed
      with the billing/worker phase. (DECISIONS 2026-07-12.)
- [ ] ⚪ **Coach read-path ordering tiebreaker.** `getRecentMessages` has no id
      tiebreaker on equal `created_at`, so live same-millisecond user/assistant
      pairs could invert. Pre-existing; the migration sidesteps it by making
      `created_at` monotonic per thread. (DECISIONS 2026-07-13 P2.7e T3.)
- [ ] ⚪ **Sync POST timeout.** `syncApi` has no timeout, so a hung POST holds a
      flush run open indefinitely. Made harmless by Card 2's owner check
      (correctness no longer depends on run length), so it was reported not
      fixed (R1.1). (DECISIONS 2026-07-15.)

## Phase-1 engine debt (does NOT block cutover; blocks the P4 exercise line)

- [ ] ⚪ **§7.5 trace-count shortfall — the phase's own hard gate is NOT met.**
      §7.5 / Part 0 #4 require ≥6 squat + 4 jump + 4 chair recorded parity
      sessions; the repo has 3 + 3 + 3. "9/9 green" means all PRESENT clips
      pass, NOT certification. Kd records the remaining ~3 squat + 1 jump + 1
      chair (front views included) to unblock. Accepted as tracked debt under
      the Option-B scope Kd set; traces.replay warns loudly.
- [ ] ⚪ **Fault multisets have zero trace coverage** (`faultsPending` stays),
      blocked on the same jump-airborne / chair-target template work below.
- [ ] ⚪ **Phase timings asserted only structurally** — a tolerance must be
      declared before any trace asserts them (§7.4 names none).
- [ ] ⚪ **Kd spot-check owed:** 2–3 re-recorded goldens' `expected.reps` against
      the raw videos (gate and fixtures changed in the same PR).
- [ ] ⚪ **Jump-squat airborne-state scoring/faults** (SPEC GAP → P4). Stiff
      landing, loading-depth window, just-landed score and the `(trunk−shin)`
      relative lean all need per-frame airborne gating the current template
      cannot express. Jump ships counting + an interim depth curve only.
- [ ] ⚪ **Chair adaptive depth scoring** (SPEC GAP → P4). The legacy curve is
      anchored to the C2 `target`; scoring-curve x-values are fixed numbers.
      Chair ships an interim fixed-fallback-target curve.
- [ ] ⚪ **±3 per-rep score parity has no defined extraction rule** (SPEC GAP,
      needs a Kd decision). Python emits per-FRAME scores, the engine per-REP.
      Recommendation on file: "Python rep score = min form_score within that
      rep's descent→completion window", asserted for squat only.

### Adding exercises 4–58: what is genuinely shared, and can therefore interfere

Raised by **Kd's question on 2026-08-14** — *"i will add all the 58 exercises and
one exercise['s] rules should not interfere with other exercises"*. Recorded
because he is right that this is the risk, and because **the answer is mostly
reassuring and partly not**, which is exactly the shape that gets lost.
**MEASURED that day, not reasoned** (commands in DECISIONS :7575):
**what is genuinely isolated** — the engine declares **zero** module-level
mutable state (`grep` for top-level `let`/`var` under `packages/engine/src`
returns nothing), so one set's session cannot leak into another's; the engine
names **no exercise** in any logic (R5.6 holds — the only hits are comments); and
each definition carries its own `upAt`, `downAt`, `countOn`, `minRepMs`,
`maxRepMs` and `bilateralGate`. Adding an exercise is adding a data file.

- [ ] ⚪ **~20 ENGINE CONSTANTS ARE SHARED BY EVERY EXERCISE, AND THEY WERE PORTED
      FROM THE SQUAT ANALYSER.** `MIN_DOWN_FRAMES` 3 · `MIN_UP_FRAMES` 2 ·
      `MIN_REP_INTERVAL_MS` 450 · `BILATERAL_ENGAGE_ANGLE` 150 ·
      `FSM_SMOOTHING_SAMPLES`/`SMOOTHING_WINDOW_FRAMES` 7 · `VIS_USABLE` 0.3 ·
      `STANDING_KNEE_MIN` 160 · `NEUTRAL_SCORE` 80 · `CORRECT_AT` 70 and the rest
      (`grep -rnE "^export const [A-Z_]+ =" packages/engine/src/pipeline/*.ts`).
      Their own comments name `rep_counter.py` as the source, so **they are
      squat-shaped numbers that all 58 exercises will inherit.** The concrete
      case, verified: `fsm.ts` computes `Math.max(MIN_REP_INTERVAL_MS,
      config.minRepMs ?? 0)`, so a definition can only make the gap between reps
      LONGER — **a genuinely fast exercise cannot go below 450 ms without editing
      the constant every other exercise reads.** That edit is the interference Kd
      is asking about, and it is the one real path to it.
      **THE PROTECTION EXISTS BUT IS PARTIAL, and the distinction matters: the
      golden traces CATCH such a change, they do not PREVENT it** — squat's traces
      assert rep counts exactly, so a counting constant that moves goes loudly red.
      **They assert nothing about timing** (the L14 line above), so a shared
      constant that shifts durations only would pass. **The fix, when the first
      exercise actually needs it, is to promote that constant into the definition
      schema with the engine value as the default** — never to retune the shared
      one. Not owed before exercise 4; owed before the first exercise that needs a
      different value, and R5.4 forbids re-deriving any of them meanwhile.
- [ ] ⚪ **THREE OF THE FOUR REP MODES DO NOT EXIST, AND EACH WILL NEED ITS OWN
      LOST-SIGHT HANDLING — today's rep-timing fix will NOT carry over to them.**
      `RepMode` declares `alternating_threshold | hold | alternating_sides |
      cadence` (`fsm.ts:28`), and `session.ts:88` constructs `ModeAFsm`
      unconditionally: **only `alternating_threshold` is built.** So holds
      (plank), left-right alternating (lunges) and cadence exercises each need a
      counter written, and **each must re-implement the rule that a rep's clock
      re-arms when the camera stops being able to watch** — the whole subject of
      DECISIONS :7404 and :7487, which lives inside `ModeAFsm` and is not
      inherited by a sibling class. Written down BEFORE those cards exist
      precisely because whoever writes the plank counter will not otherwise know
      this fix happened: a plank whose hold clock swallows a two-minute absence is
      the same defect Kd found, in the mode where it is arguably worse. Part 2
      §3.6 sequences the modes; §7.3's fixture matrix must cover an absence for
      each new one.
      **EXTENDED 2026-08-14 by the API half (DECISIONS :7730): `watchedMs` is
      accumulated in `session.ts` and so is mode-agnostic, but one of its two
      blindness signals is NOT** — the occluded path reads `fsm.sightLost`, which
      is `ModeAFsm`'s. A sibling counter that does not set it will report a hold
      or a lunge set as fully watched through an occlusion, **and the server now
      BILLS from that number**, so the consequence is larger than it was when this
      line was written. Whoever writes the second counter owes the flag as well as
      the clock.
- [ ] ⚪ **WEARABLES — the app neither sends a workout to a user's watch nor
      reads one from it.** Created 2026-08-16 from Kd's question (DECISIONS
      :8808). **It was tracked NOWHERE before that day** — grep-verified across
      this file and `RUNBOOK/cutover.md` — though `02-part2b-trust-layer.md:169`
      has scheduled it since the spec was written (§2.4 Roadmap: wearable heart
      rate upgrades the calorie method at Part 6, with MET as the universal
      fallback). **A roadmap paragraph is not a to-do list**, which is the whole
      reason this file exists.
      **Not a decision and not a commitment** — Kd asked whether it is possible
      and costly and said expressly he was not asking to build it now.
      **BLOCKED ON P5 BY CONSTRUCTION, not by priority:** the phone health stores
      are reachable only from a NATIVE app, and live heart rate during a set
      additionally needs a companion app on the watch. Nothing here is buildable
      from the web, so this cannot start before the mobile phase whatever the
      appetite.
      **When it does run, three things are already decided by argument and should
      not be re-derived:** (1) **write OUT before reading IN** — pushing our
      finished workout into the user's health app closes their rings, is far less
      work than ingestion, and is what users actually notice; (2) **direct
      integrations, not a paid aggregator** — the platforms charge nothing per
      user while an aggregator bills monthly per user for a convenience that only
      matters for the long tail; (3) **dedupe is part of the card, not an
      afterthought** — the app already records runs by GPS, so an imported watch
      run can land the SAME run twice and double a user's distance and calories.
      ~~**Audience caveat, recorded because it decides SEQUENCE:** the pilot is
      Jorhat gyms, where Apple Watch and Garmin are rare and the dominant cheap
      bands expose no open API at all. A wearable card may serve very few of the
      first hundred users.~~ **STRUCK BY KD THE SAME DAY: "my target is all over
      world including assam that is jorhat".** Jorhat is the PILOT, not the
      market, and Part 3 §6.3 (*Worldwide*) already says so — localised console
      currency, org-timezone boundaries, message keys from day one. **On a
      worldwide target the value of this is HIGHER than the struck sentence
      claimed**, since Apple Watch and Garmin are common in the markets a
      worldwide launch reaches. It still varies by market, so it is not a
      uniform win — but it is no longer an argument for deferring.
      **Health data is sensitive personal data** and lands inside the open
      privacy-scope question below (:592), still unruled.
      **Platform specifics in the DECISIONS entry are marked UNVERIFIED** —
      model knowledge, not a source read, and these companies change their terms.
      Re-check every one at planning time (V5).

## Gym platform — Kd's 2026-08-18 product rulings (DECISIONS :9604)

**Read the ruling before working any line here.** On 2026-08-18 Kd moved the
project from *a consumer camera-coach app with a gym console bolted on* to *a gym
platform sold to US gyms, whose consumer app is one surface*. Fifteen rulings in
one session. Everything below is new work created by that shift, or existing work
whose priority it changed.

**HOW TO READ THE MARKERS IN THIS SECTION.** The file legend is anchored to the
P2.8 cutover, and **nothing here blocks the cutover** — switching off the old
backend does not need any of it. So there are no 🔴 lines below. 🟡 here means
*"needed before a US gym signs"*, which is a different bar from the rest of the
file and is stated so nobody reads these as lower priority than they are.

**NOT A PLAN.** No card is written, no sequence approved, no estimate ratified.

### Direction changes that re-price existing work

- [ ] 🟡 **WEB MEMBER SCREENS ARE NOW OWED-ONLY — building more of them buys the
      product nothing.** Kd ruled the mobile app is the product and web is "just
      side" (:9604 §1). Measured that session: `packages/engine` (20 files,
      `dependencies: {}`), `packages/shared` (20 files), all of `apps/api` and
      every exercise definition transfer to mobile UNCHANGED — but all **24**
      files under `apps/web/src/pages` do not, because React and React Native
      share no screen code. **Web keeps ONE job and it is worth keeping: the TEST
      RIG** — filming fixtures and checking a new exercise counts correctly
      without waiting for a phone build. A chat proposing "finish web first, it
      will speed up mobile" is wrong on measured grounds and this line is the
      refutation.
- [ ] 🟡 **PART 5 §1'S PRICE BOOKS ARE INDIA-ONLY AND ARE NOW UNRESOLVED.** The
      market is US gyms (:9604 §2). US gyms pay multiples of the Indian tiers.
      This is not "un-ratified pricing" any more — the numbers in the spec are for
      the wrong country. Blocks any billing card and any gym pitch.
      **UPDATE 2026-08-18 (DECISIONS :9944): a Kd proposal now EXISTS and the
      math is done** — gym tiers $20/$30/$40/$50 by member count, consumers
      $5/mo, 8 meal scans + 2 route plans per day in both channels. Measured
      against the live cost ledger: covered in the normal case (~3-5× headroom),
      underwater only under full-roster daily use; three boundary/cap fixes put
      with the math. **AWAITING KD'S RATIFICATION — do not seed or quote these
      numbers until he confirms.**
      **UPDATE 2026-08-24 (DECISIONS :16548) — THE NUMBERS ABOVE ARE SUPERSEDED
      AND MUST NOT BE SEEDED OR QUOTED.** Kd RULED: **0-299 $29 · 300-499 $39 ·
      2100+ custom**, gym members **5** meal scans/day even though the gym pays,
      consumers **1 week unlimited then 3/day**, gym trial **30 days**, first
      **20 gyms free**. He fixed his own overlapping draft ("0-299/0-499", where
      a 200-member gym fell in both) on being shown it: *"yes good"*.
      **UPDATE 2026-08-24, SAME DAY (DECISIONS :16702) — THE BANDS ARE COMPLETE
      AND RATIFIED. THE FULL BOOK, and it is now safe to seed:**
      **0-299 $29 · 300-499 $39 · 500-999 $59 · 1000-1499 $79 · 1500-2099 $99 ·
      2100+ custom.** Consumer: **$6.99/mo for 20 meal scans/day** (supersedes
      :9944's $5). **This line stays open only for the SEED, not the numbers.**
      **ALSO RULED THE SAME DAY, and it is the one a builder will trip on: a
      $6.99 consumer gets 20 scans/day while a member of a PAYING GYM gets 5.**
      `mergeEntitlements` hands a user holding both the BETTER of the two, so
      the gym member who also subscribes personally keeps 20 — probably right,
      never ruled. **Its own ❓ line is in the open-questions section.**
      **UPDATE 2026-08-24, THIRD RULING THE SAME DAY (DECISIONS :17357) — EVERY
      NUMBER ABOVE IS SUPERSEDED. THIS IS THE BOOK TO SEED, AND IT NOW COVERS
      TWO MARKETS:**
      **US · CANADA · EUROPE, one USD book: $30 · $40 · $69 · $99 · $129 ·
      custom above 2099.**
      **INDIA, INR: ₹1,500 · ₹2,500 · ₹4,500 · ₹6,500 · ₹8,500** (Kd fixed the
      first two and delegated the rest; the chat's three were not overruled).
      **Individuals: international $10/mo · India $5, recommended as ₹449 ·
      FREE TIER FALLS 3/day → 2/day · gym member 5/day unchanged.**
      **UNCHANGED BY SILENCE — assumptions, not rulings (S3):** the paid
      individual keeps 20/day and the one-week unlimited trial survives. A chat
      finding either contradicted must ASK.
      **THE 5-vs-20 ❓ IS CLOSED, not still open** — see the struck line in the
      open-questions section. Kd's reason measured correct: 20/day for gym
      members is UNDERWATER in three of five bands.
- [ ] 🟡 **IN-APP CONSENT SCREEN FOR HEALTH DATA AND THE CAMERA — needed before
      a US gym signs (DECISIONS :9944).** Whatever the gym's contract says
      about the roster upload, health-type data (meals, weight, workouts) and
      the camera sit under US state laws that reach the app directly — so the
      app asks the MEMBER at first use, not the gym. Small build; its wording
      is part of the pre-signing lawyer review (:592).
- [ ] 🟡 **THE PRIVACY-LAW QUESTION (:592) IS NO LONGER THEORETICAL.** US workout
      and body data is health data and several states legislate it specifically.
      Still unruled; now on the critical path to a signed gym rather than behind
      it. Its own ❓ line remains below in the open-questions section — this line
      exists so the priority change is visible from here.

### The AI chat coach — switched OFF by Kd ruling

- [ ] 🟡 **UNWIRE THE AI CHAT COACH FROM WEB (and never wire it on mobile).**
      Kd: *"i have decided to drop the chat bot from both web and mobile"*
      (:9604 §5). **THIS IS THE NO-REMOVAL RULE'S AUTHORISED PATH — an explicit Kd
      ruling made against a cited cost — not a breach of it.**
      **OFF, NOT DELETED, and the distinction is the point.** Measured:
      `apps/api/src/modules/coach` is 1,617 lines over 13 files including a full
      retrieval pipeline and an ingested knowledge base; `Coach.jsx` is 772 lines;
      `grep -rln coach` outside the module returns 15 files, five of them privacy
      (export and account-delete must still account for stored conversations).
      Deleting is a day across six subsystems with real risk to export/delete.
      Unwiring the route is an hour and is reversible.
      **EXECUTION DETAIL THAT DECIDES WHETHER IT WORKS: remove the ROUTE/import,
      not the nav button.** Hiding the button leaves the 772-line screen in the
      download; removing the route drops it and its exclusive dependencies
      automatically. The 1,617 server lines are never downloaded by anyone and
      cost app size nothing — this was Kd's own question and it has a precise
      answer.
      **STILL NOT DONE, AND THAT IS NOW A CHOICE RATHER THAN AN OVERSIGHT — KD
      WAS ASKED DIRECTLY ON 2026-08-26 AND SAID *"lets do it later so nothing
      happens now"*.** Verified live that day: `apps/web/src/App.jsx:23,122` and
      `apps/api/src/app.ts:24`. **DO NOT RE-ASK HIM** — offer it when a card is
      already touching the web routes or the API app wiring, and until then leave
      it alone. **Consequence he accepted, stated plainly to him first: the Coach
      page still opens, still answers, and still bills per question until it is
      done.**
      **WHOEVER FINALLY DOES IT MUST ALSO MOVE THE `costs:gym` BUMP** out of
      `coach/service.ts:224` into nutrition and geo — it is the only call site
      that feeds the v1 §9.3 breaker, so unwiring the coach leaves that counter
      with no inputs at all (:19256 §5; the 🔴 breaker line carries the detail).
- [ ] ⚪ **~SEVEN COACH ITEMS IN THIS FILE ARE PARKED, NOT DONE — DO NOT TICK
      THEM.** Empty conversation on a failed message · a question spent when the
      provider never answers · raw HTML in answers · over-long message recovery ·
      streaming · read-path ordering tiebreaker · the secure-context message id.
      They park with the feature and return if it does. Ticking them would record
      work that never happened.

### The meal scanner moves to Gemini — Kd's 2026-08-24 rulings (DECISIONS :16548)

- [ ] 🟡 **RUN THE PARITY TEST BEFORE THE GEMINI SWAP SHIPS. THIS IS THE ONE
      THAT MUST NOT BE SKIPPED.** Kd ruled the scanner moves to
      `gemini-2.5-flash-lite`, and **nobody has established that it identifies
      food — Indian food especially — as well as the Qwen path does.** Cost is
      answered; QUALITY is not, and a cheaper model that reads "roti" as
      "flatbread stack" costs more in trust than it saves in dollars.
      **The instrument already exists and was built for exactly this class of
      failure:** :344 preserved REAL Groq completions verbatim as fixtures in
      `nutrition.unit.test.ts` (they exist because both vision models once
      returned shapes the schema rejected and 250+ green tests could not see
      it), and 18 real scans sit in `api_cost_events`. Replay them through
      Gemini, compare item-by-item, and put the disagreements in front of Kd.
      **A swap that ships without this is the Card-5a bug class returning.**
      **RATIFIED as a requirement 2026-08-24 (DECISIONS :16702) — Kd agreed it
      runs before the switch, so this is no longer a recommendation a chat may
      weigh against schedule.**
- [ ] 🟡 **BUILD THE GEMINI ADAPTER — and it is NOT a model-string change.**
      `vision.adapter.ts` posts to `api.groq.com/openai/v1/chat/completions`
      with Groq's request shape, a `qwen/`-conditional `reasoning_effort`, and
      Groq's price constants (`VISION_INPUT/OUTPUT_MICRO_USD_PER_MILLION`).
      Gemini has its own endpoint, request shape and prices
      (**$0.10/$0.40 per 1M, verified 2026-08-24**), so the cost-ledger
      constants must move with it or `api_cost_events` silently reports Groq
      prices for Gemini calls — the ledger is the tripwire the whole pricing
      model rests on. Keep the `.strict()` parse and the kcal-smuggling
      rejection; they are what stop a model inventing nutrition.
- [ ] 🟡 **RESIZE THE PHOTO BEFORE IT IS SENT — and DO NOT pick the size to
      save money.** Kd ruled the image is capped. **Measured: the entire spread
      between a 384px and a 1024px image is $5.80/month at realistic volume**
      (per scan $0.000152 vs $0.000281). **768px longest side — RATIFIED
      2026-08-24 (DECISIONS :16702)**, chosen for accuracy and upload speed on
      gym wi-fi, NOT for cost. A chat that shrinks to 384px "for cost" has
      misread the measurement.
      **The PROMPT is deliberately NOT shortened** — Kd's own call, and correct:
      it is 260 tokens, $0.000026/scan.
- [ ] ⚪ **CHEAP-FIRST-ESCALATE ON A FAILED SCAN.** Recommended, not ruled:
      Flash-Lite at 768px on every scan; on `photo_quality: "poor"` or zero
      matched items, ONE retry at higher resolution or on Gemini Flash
      ($0.15/$1.25 per 1M). Fires only on failures, so the average cost barely
      moves and the person does not hit a dead end. **Pairs with the existing
      honest "couldn't match" empty state (Card 5b) rather than replacing it.**
- [x] ~~🟡❓ **CAP THE UNLIMITED TRIAL WEEK**~~ — **RATIFIED 2026-08-24 AT
      20 SCANS/DAY (DECISIONS :16702).** Proposed as anti-farming (1,000
      scans/day × 7 days = $1.60 per farmed account, trivial alone and
      scriptable in bulk). **It turned out to have a better justification than
      the one it was proposed for: the paid consumer tier is ALSO 20/day, so
      capping the trial at 20 makes the trial EXACTLY the paid experience** —
      which is what a trial should be, and costs nothing in goodwill.
      **Not ticked as done — it is ratified, not built.** Rides the one seed
      change below.
- [x] ~~🟡 **RE-SEED THE QUOTAS AND PRICES**~~ — **DONE 2026-08-25 in the same
      change as the 🔴 seed line below.** Seeded exactly the CORRECTED list in
      this entry, plus :17902's band-1/2 raise ($35/$50) and rounded boundaries,
      plus Kd's two 2026-08-25 answers (₹449; yearly = eleven months' money).
      **`route_gen` 2/day paid and the free tier's 2/day are in.** What did NOT
      ship with it, each with its own line: the trial's MECHANISM (the seed
      writes `trial_days`; nothing reads it), the org YEARLY book, and the
      "custom above 2100" tier. Original text kept below:
- [x] ~~🟡 **RE-SEED THE QUOTAS AND PRICES — EVERY NUMBER IS NOW RULED, so this
      is unblocked (DECISIONS :16548 + :16702).**~~ `db/seed.ts` holds the
      pre-ruling shape (PAID `meal_scan` 8/day, `route_gen` 5/day — both
      wrong). **The complete ruled book, to be seeded in ONE change:**
      · consumer trial week **unlimited, capped 20/day** · consumer free
      **3/day** · consumer paid **$6.99/mo, 20/day** · gym member **5/day** ·
      `route_gen` **2/day** paid · gym bands **$29 / $39 / $59 / $79 / $99 /
      custom above 2099** · gym trial **30 days**.
      **Integer minor units end-to-end (R6.1): $6.99 is 699, never 6.99.**
      **CORRECTED 2026-08-24 (DECISIONS :17357) — SEED THESE, NOT THE LINE
      ABOVE:** consumer trial week **unlimited, capped 20/day** (unchanged) ·
      consumer free **2/day** (was 3) · consumer paid **$10/mo, 20/day** (was
      $6.99) · gym member **5/day** (unchanged) · `route_gen` **2/day** paid
      (unchanged) · **US/CA/EU gym bands $30 / $40 / $69 / $99 / $129 / custom
      above 2099** · **INDIA gym bands ₹1,500 / ₹2,500 / ₹4,500 / ₹6,500 /
      ₹8,500** · India consumer **₹449** · gym trial **30 days** (unchanged).
      **R6.1 still binds: $10 is 1000, ₹449 is 44900. Two currency books now
      exist, so a seed that assumes one is wrong.**

### Running: the Strava-style line is free, the route SUGGESTIONS are not

- [ ] 🔴 **THE "POPULAR ROUTES" FEATURE MUST BE REDESIGNED BEFORE A LINE OF IT IS
      WRITTEN — it walks into two LIVE Strava patents that run to DECEMBER 2034
      (DECISIONS :18128 §1.3, researched 2026-08-25 at Kd's direct request).**
      **Read before touching `saved_routes`, before any route discovery or
      suggestion surface, and before writing a running store listing.**
      :16924 item 4 asks for *"routes used by other users"*. **Pooling many
      users' GPS onto a base map to derive popular ways to go is what
      US 9,297,651 and US 9,778,053 claim in terms** — the heatmap/preference-map
      family **Strava sued Garmin over on 30 Sep 2025.** Both expire 9 Dec 2034.

      | Do NOT build | Build instead |
      |---|---|
      | a map computed automatically from everyone's activity | a route a runner **deliberately publishes** |
      | "popular routes near you", derived | "routes people chose to share", a list |

      **User-published content is not a derived preference map — and this ALSO
      answers the 🔴 home-address line below. One change closes both.**
      **SECOND STANDING RULE from the same research: never build "compare your
      time on this stretch of road against everyone else"** — that is Strava's
      segments patent **US 9,116,922, alive to 31 March 2031**.
      **Territory capture is CLEAR and needs no change** (Microsoft's own
      "Surround-and-Capture" patent lapsed; prior art to 2010) — :18128 §1.4.
      **Not legal advice and Kd was told so; a freedom-to-operate opinion
      (~$2–5k) is owed BEFORE US scale, not now.**
- [ ] ⚪ **GPS TRACK-AND-DRAW — Kd's Strava-style blue line (DECISIONS :16548).**
      **The point a chat must not lose: this costs NOTHING, ever.** The line is
      the device's own GPS; no external call, no allowance, no bill. It is the
      cheapest feature on Kd's list and the one users actually name.
      **What it needs is storage and a map to draw on, not an API.** Nothing
      built; no governing spec § (Part 6 §5.1 covers the permission flow and
      its Play-rejection-proof copy, which binds this).
- [ ] 🟡 **THE MAP STACK IS RULED — MapLibre + PMTiles on R2 + bundled
      elevation. Google is STRUCK (DECISIONS :17012).** **Read before wiring any
      map.** Kd: *"abondoned google map i think"*, *"i want it to be like
      starva"*. **Do not re-propose Google**, and note WHY it is struck: it is
      free on mobile, but four of Google's own terms kill Kd's feature list —
      no storing Content past **30 days**, no *"create or augment your own
      mapping-related dataset"*, no offline, and styling cannot change WHAT is
      on the map. **That is saved routes, shared routes, no-signal running, and
      a runner's map.**
      **BUILD: MapLibre GL Native · OpenStreetMap data · a self-hosted PMTiles
      file on the R2 already in v1 §19 · ELEVATION BUNDLED INTO THAT SAME FILE.**
      **The bundling is not optional polish:** AWS's terrarium tiles are free
      with **no SLA and no guarantee**, and the dataset **already moved once**
      when Mapzen shut down in 2018. Bundling costs nothing and makes the 3D
      recap unbreakable.
      **Measured: $1.80/mo at 1,000 AND at 10,000 users, $7.92 at 100,000**,
      heavy-use ceiling ~$40. Egress is $0, which is the whole reason.
      **The job Kd takes on: refreshing the map file every few months.** That is
      the entire maintenance burden and he accepted it knowingly.
- [ ] 🟡 **THE TWO SAFE SCAN-COST FIXES — ship them with the Gemini adapter
      (DECISIONS :17012). 29% off, no quality risk.**
      1. **Trim the model's JSON to ~120 tokens.** Output is 44% of the bill
         (4× the input rate). Cut `cuisine_guess` and the free-text
         `scale_anchors.notes`; shorten field names. **NEVER cut `confidence`
         or `photo_quality`** — they drive the retake-photo path. You are
         removing words, not decisions.
      2. **GROW the prompt past ~1,024 tokens with 6-8 worked WESTERN
         examples** (burger and fries, caesar salad, pasta, steak, breakfast
         plate, sandwich, stir fry, smoothie bowl). Google's implicit cache
         gives **90% off a repeated prefix above that threshold** and the
         prompt is byte-identical every scan — **so a bigger prompt is cheaper
         AND more accurate.** **Kd corrected the audience: WESTERN, not
         Indian.** Vary the examples or the model over-predicts whatever
         dominates them, and **no example may contain a calorie number.**
      **$0.000229 → $0.000162.**
      **⚠ DO NOT DROP TO 384px. Ruled out deliberately** — 34% saving,
      unmeasured quality risk, on a bill that is 2.4¢ per member. **768px is
      KEPT.** And know the shape before "compromising": **the image price is a
      CLIFF — 385/512/640/768px all cost 1,032 tokens, only ≤384 drops to 258.**
      A 512px compromise pays full price for a worse picture.
      **⚠ THE MONTHLY POOL IS REJECTED. Kd: *"i do not agree with pool keep 5
      scan per day for gyms users"*. 5/day per member is a HARD daily cap. Do
      not re-propose the pool.** His $200 ceiling is held instead by
      **staggering onboarding — 10 gyms one month, 10 the next** — which halves
      the peak and touches nobody's allowance.
- [ ] 🟡 **MEAL PHOTOS ARE NOW STORED — this REVERSES the request-only design
      (Kd ruling 2026-08-24, DECISIONS :17012; supersedes the "photo storage
      does not exist at all today" state at DECISIONS-INDEX:2934).**
      **THE DECISION THAT DOMINATES EVERY OTHER: store the 768px copy you
      already made for the AI, NOT the phone original.** 0.15 MB vs 3 MB ⇒
      **$0.57 vs $11.45 added per month, EVERY month, forever. 20×.**
      **STORAGE ACCUMULATES — API calls do not, and this is the new cost
      SHAPE.** 20 gyms add 42 GB/mo → **$8.53/mo after a year**; 100,000
      members add 418 GB/mo → **$87/mo**.
      **Build R3.9's five guarantees** (magic-byte validation, size cap,
      server-generated keys, signed URLs, never reflect a user filename) —
      they are exactly the five ways object storage leaks.
      **OFFERED, NOT RULED: delete meal photos at 90 days** — holds storage near
      $2.86/mo at two years instead of $14.88. Kd's call whether people want
      last year's lunch.
- [ ] 🟡 **VIDEO FROM GYMS AND USERS — R2, NEVER CLOUDFLARE STREAM
      (DECISIONS :17012).** Stream bills **$1 per 1,000 minutes WATCHED**, so
      popularity IS the bill: at 100k members it is **$610/mo against R2's
      $1.00**. R2's egress is $0.
      **Kd's plan: 20 videos per gym, 5 minutes max, pay extra beyond.**
      **STRAVA CAPS VIDEO AT 30 SECONDS** and auto-crops anything longer.
      **RECOMMENDED 60s, and the argument is NOT money — it is the VIEWER'S
      DATA PLAN:** a 5-minute 720p clip is **94 MB**, so five gym videos burn
      half a gigabyte of a member's mobile data, and a raw 94 MB file from R2
      has no quality-switching so it buffers on weak signal. **Fixing THAT
      means Stream, and Stream at 5 minutes is $410/mo.**
      **Also recommended: sell MINUTES, not video count** — 20 five-minute
      videos is ten times 20 thirty-second ones.
      **Do not launch video without report-and-remove** — same surface as
      route sharing.
- [ ] 🟡 **SHARING A STATS PHOTO TO THE GYM — RULED IN FULL 2026-08-25
      (DECISIONS :18128 §4 and §6.1). THE LIFETIME IS NOW RULED: ONE WEEK, both
      copies, gone.** It supersedes :17366's one-year row.
      **THE WARNING SHIPS IN THE SAME CARD AS THE SWEEP — this is not polish.**
      :17366's recorded fear is that a post vanishing reads as *you* deleting
      someone's work; **the explicit "download it, it goes in a week" notice is
      the entire answer to that**, and a sweep built without it is that defect.
      **Do not shorten or lengthen it for cost reasons** — posted photos measure
      $4.66/mo forever at 500 gyms; this is a clutter and privacy call.
      A photo carrying the stats overlay and the gym's
      logo can be shared **to the gym the member belongs to**. A section in the
      **member dashboard** shows the shared photos. **Likes and reactions —
      NO COMMENTS** (Kd, explicit). **Gym staff and owners get a similar
      dashboard with different stats.** Users are **explicitly told** the photos
      are deleted and told to download them.
      **This is the surface `GYM-GLOBAL SHARING NEEDS REPORT-AND-REMOVE` below
      was written for** — people post pictures of their bodies. Ship them
      together. Part 3 §2.4's promise still binds: the gym sees this because the
      member chose to share it, and nothing else.
- [ ] 🟡 **APP-STORE BILLING COMPLIANCE — the risk that arrives BEFORE any patent
      (DECISIONS :18128 §1.6).** **Read before writing any paywall or price
      screen.** **Apple PULLED Cal AI in April 2026** — 15M downloads, ~$50M ARR
      — for **deceptive billing design**: the weekly price shown more prominently
      than the amount actually charged, plus bypassing in-app purchase. Restored
      after fixes. **Free to get right, expensive to get wrong:** show the real
      amount and the real period with equal weight, and do not route around
      in-app purchase where it is required. Sits beside :17366's Paddle ruling —
      **Paddle is the WEB route; the stores have their own rules.**
- [ ] 🟡 **THE PHOTO + STATS EDITOR — KD RULED THE FULL BUILD 2026-08-25
      (DECISIONS :17902), OVERRULING THE CHAT'S "SHIP ONLY THE STICKER".**
      **Read before building share cards, photo posting, or anything that puts a
      number on an image.** This is the Strava-stats-on-a-photo trend, and the
      research behind it matters: **Strava itself has NO editor** — its Stats
      Stickers are a transparent PNG (distance, elevation, time, route line,
      logo) handed to Instagram, whose editor does the moving. A paid market
      exists in that gap (StatShot $19.99/yr–$49 one-time; FitnessOverlays free).
      **Ruled scope, all of it:** take or pick a photo · attach the stats as an
      overlay · move and resize it · undo/redo · crop · resize · brightness ·
      contrast · grayscale · add text with a **limited** font selection · add an
      overlay and edit it the same way.
      **The stats are NEVER typed — they come from the workout, run or meal the
      person actually did.** That is the entire difference from any photo editor
      on the store, and it must not be "simplified" away.
      **The chat's case for the smaller build is recorded so it is not re-argued
      from scratch: Instagram is free, better, and already on the phone, and
      Strava's own team chose not to build one.** Kd was shown that and chose the
      full build. **The counter-argument that decides it: his gym feed is his own
      (:9604 §6, share gym-global or private) and Instagram is not in that loop —
      a member posting to their gym has no other way to put stats on a photo.**
      **Two costs stated at ruling time:** it gets built TWICE (web now, native
      later — :17765's standing cost), and the tools are each easy while making
      them work TOGETHER with undo is where the time goes.
      **Feeds the two-clock trap already recorded below** — the moment stats are
      burned in it is a NEW file with a 1-year life, not the 7-day scan photo.
- [ ] ⚪ **THE SHARE CARD KD ASKED FOR ALREADY EXISTS IN THE SPEC — build
      Part 7 §5.1, do not design it (DECISIONS :17012).** His *"photo with this
      much running for his time"* is §5.1's card generator: workout summary, PR,
      streak, challenge, certificate, and a **run card whose map thumb already
      carries the 200 m end-trim** (Part 6 §5.4) that :16924 independently
      re-derived for shared routes. R2 `share-cards/` with a 7-day lifecycle,
      20/day rate limit, org logo for gym members. **Free-tier watermark +
      referral QR IS the growth mechanic** — it is not decoration. Cost ≈ $0.
- [ ] 🟡 **BACK THE MEAL PHOTOS UP OFF R2, AND RENDER A PLACEHOLDER WHEN AN
      IMAGE FAILS (DECISIONS :17012).** R2 is KEPT and it is the right call —
      but its record is younger: **13 Cloudflare outages 7-14 Aug 2026, with R2
      write availability down ~2 h in Eastern North America on 7 Aug and one
      customer reporting ~67 GB unrestored days later.** One tier, no Object
      Lock, limited versioning; **5 of 14 studied migrations went BACK to S3.**
      **Meal photos are the only stored thing that cannot be regenerated** — the
      map file can be rebuilt, share cards redrawn. A weekly copy elsewhere is
      cents. And a failed image must never break a screen.
- [ ] 🟡❓ **DOES R2 MEET US HEALTH-DATA COMPLIANCE? Joins the :592 / :9944
      lawyer list (DECISIONS :17012).** R2's compliance certifications are less
      mature than S3's — no Object Lock/WORM, thinner audit surface — and this
      app stores **meals, weight and workouts, which are health data under
      several US state laws.** Not a reason to move today; a question the
      pre-signing lawyer review must actually answer.
- [ ] 🔴❓ **ROUTE SHARING PUBLISHES WHERE PEOPLE LIVE UNLESS FOUR THINGS ARE
      BUILT IN FROM THE FIRST LINE — Kd asked for the feature 2026-08-24
      (DECISIONS :16924); the privacy shape is UNRULED.**
      **Read before building anything that shows one user's route to another,
      and before any migration touching `saved_routes`.**
      Kd asked for "routes used by other users" because Strava has it. **Strava
      also has the mitigations, which are the half that does not show in the
      app.** A route that starts at someone's front door, shown to a stranger,
      **is that person's home address** — the best-known privacy failure in this
      product category.
      **RECOMMENDED, all four, and they are cheap only if designed in now:**
      1. **Opt-in. Private by DEFAULT.** ⚠ **A migration back-filling existing
         `saved_routes` rows as public would publish the entire table** — the
         column defaults to private, always.
      2. **Trim ~200 m off BOTH ends of a shared route** (Strava's privacy
         zone). The middle is the useful part; the ends are the dangerous part.
      3. **Prefer POPULARITY to individual tracks** — "run 40 times" gives Kd
         what he wants and hands nobody another person's line. Cheapest to
         compute, too.
      4. **Never show who.** No name, avatar or link on a shared route.
      **Binds against rulings already on the board:** :9944's consent split (a
      route IS location-health data, asked of the MEMBER not the gym), §2.4,
      and the pending US privacy review at :592. **Shipping sharing without an
      explicit Kd ruling on 1-4 is a chat making a privacy decision for him.**
- [ ] 🟡 **THE RUNNING FEATURE'S REAL GAP IS THREE THINGS, NOT A REWRITE —
      measured 2026-08-24 (DECISIONS :16924).** Four of Kd's five parts are
      already on the server: `runs` stores polyline/duration/distance/splits/
      kcal (**a recap needs no new data**), `savedRoutes` has full CRUD,
      `listRuns`/`getRun` exist, `generateRoutes` exists.
      **MISSING: (a) a start lat/lng on `saved_routes` so "near me within X km"
      can be asked at all — a bounding-box query is enough, DO NOT add PostGIS;
      (b) the sharing/popularity model above; (c) the phone screens.**
      **BUILD ORDER — the opposite of the obvious one, and it is Kd's own idea
      turned into an optimisation:** search-over-SAVED-routes FIRST, route
      GENERATION as the fallback when nothing nearby exists. A saved nearby line
      costs **no external call**, so this **retires most of :12111's ORS
      ceiling** without paying anyone. Faster for the user, and it improves as
      the database fills.
- [ ] 🟡 **UNWIRE NUTRITION AND RUNNING FROM WEB — Kd ruling 2026-08-24
      (DECISIONS :16812). A MOVE TO THE PHONE APP, NOT A DELETION.**
      Kd: *"nutrion and running will not be there in web , but ... we will build
      the app ... and nutrion and running will be there"*. **The no-removal
      rule's AUTHORISED path** — ruled against a cited option (he was shown the
      line counts and that users lose both until `apps/mobile` exists, which it
      does not).
      **Measured 2026-08-24:** `pages/Nutrition.jsx` 2,026 + `MacroRings.jsx`
      194 · `pages/Running.jsx` + `RunPlanner.jsx` 361 + `ActiveRun.jsx` 216 +
      `components/running/` 4 files = **1,484** · **`apps/mobile` DOES NOT
      EXIST.**
      **EXECUTION — the coach precedent verbatim: remove the ROUTE and the
      import, NOT the nav button.** A hidden button leaves 3,700 lines in the
      download; a removed route drops them and their exclusive deps
      (`leaflet`, `react-leaflet`, `leaflet-rotate`). **KEEP THE SOURCE** — it
      is the working reference for the phone screens, and re-deriving a
      rotating turn-by-turn view from nothing is strictly worse than porting
      one that ran.
      **⚠ THE SERVER SIDE IS NOT TOUCHED AND MUST NOT BE.** `modules/nutrition`
      and `modules/geo` stay whole — the phone app calls exactly them. **The
      Gemini swap, the 768px cap, the parity test and every price/quota at
      :16548 + :16702 ALL STAND.** A chat reading this as "cancel the Gemini
      card" has misread it.
      **Park, do NOT tick, the web-side nutrition/running items in this file** —
      they return with the phone screens (the ~seven parked coach items are the
      precedent).
- [ ] 🟡❓ **CHOOSE THE MAP RENDERER AND TILE SOURCE — ANSWERED, NOT CHOSEN, AND
      IT IS NOW A PHONE-APP DECISION, NOT A WEB ONE (DECISIONS :16702, moved by
      :16812).** **Nothing is blocked today** — the only map surface was the web
      running screens, which are leaving. **Read before wiring any map.**
      **⚠ LIVE RISK IN THE CODE THAT IS ABOUT TO BE UNWIRED, recorded because
      the phone app will copy-paste it:** `NavigationMap.jsx:173` and
      `RouteMap.jsx:79` point at `https://{s}.tile.openstreetmap.org/...` —
      **the OSM Foundation's CHARITY tile server.** Its policy
      (`operations.osmfoundation.org/policies/tiles/`, read 2026-08-24) gives
      **no SLA**, warns that **"commercial services ... should be especially
      aware that access may be withdrawn at any point"**, and states traffic
      using default User-Agents **"will be blocked"** — which a browser app
      cannot set. **A paid product was leaning on a volunteer project and
      nobody had written it down.**
      **KD DOUBTED THE FREE ANSWER ("will it give good result i dont think
      so"). HE IS HALF RIGHT AND THE HALVES MUST NOT BE COLLAPSED:**
      · **WRONG on map DATA — Strava's data IS OpenStreetMap** (support.strava.com);
        Mapbox is paid to HOST and RENDER it, not for better data.
      · **WRONG on the renderer — MapLibre GL JS is Mapbox GL forked at the
        point Mapbox closed it.** Same engine, same 3D terrain API. **The 3D
        recap belongs to the RENDERER, which is why it costs nothing.**
      · **RIGHT on ADDRESS SEARCH** — free geocoders are genuinely weaker for
        Indian addresses and business names. **But the app already runs
        LocationIQ + Nominatim fallback** (`LocationAutocomplete.jsx:24,39`),
        never Google — so "go free" is not the change on the table; improving
        search is a separate and legitimately PAID later decision.
      · **RIGHT to distrust an unbacked host** — OpenFreeMap's public instance
        has no SLA; self-hosted PMTiles on the R2 in v1 §19 is the answer.
      **A PRIOR CHAT RECOMMENDED GOOGLE MAPS AND IT IS NOT IN THE RECORD** —
      grep-verified across DECISIONS/INDEX/OWED; Kd confirms that chat was
      abruptly closed. **Never a ruling, reasoning unavailable (S1: hearsay).**
      On cost it is the dearest of the three: **Google $7/1,000 map views
      (10,000 free/mo) · Mapbox ~$5 (50,000 free, MAU-billed on mobile) ·
      MapLibre+OpenFreeMap $0.** If that chat had a non-cost reason, it is worth
      hearing before this is settled.
      **What Strava actually does, since that is what Kd is comparing against:**
      it renders with **MAPBOX** over OpenStreetMap data plus its own
      heat/popularity layer, and **the 3D route recap he likes is Mapbox 3D
      terrain** (`support.strava.com` "About Strava Maps"; mapbox.com blog).
      **Why not simply copy it: Mapbox bills ~$5 per 1,000 web map loads above
      50,000/month, and by MONTHLY ACTIVE USER on mobile (25,000 free).** A map
      load fires every time a member opens a run — **it turns a zero-cost
      feature into a per-VIEW bill at exactly the scale running is meant to
      reach.**
      **THE FINDING, and it is the reason this is cheap: the renderer Strava
      uses was forked open.**
      · **MapLibre GL JS** — open-source fork of Mapbox GL, same engine, same
        3D terrain API, no key, no bill. **The 3D recap is a feature of the
        RENDERER, not of the paid provider.**
      · Tiles: **OpenFreeMap** (no key, no cap) or self-hosted
        **Protomaps/PMTiles on the R2 already in v1 §19** (~$0-3/mo).
      · 3D elevation: **AWS Open Data terrarium**,
        `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`,
        no key, no account.
      · Popular routes: **our own database** — Kd's "most-used routes" makes no
        external call at all.
      **UNVERIFIED, and to be settled before committing rather than after:**
      OpenFreeMap's public instance carries no SLA (self-hosting PMTiles on R2
      is the answer if that matters), and AWS terrarium is 256px PNG which
      sources call slow from a browser — **Mapterhorn's WebP PMTiles is the
      named alternative and nobody here has measured either.**

### The 20-gym pilot and what it costs to run

- [x] 🟡 **~~THE 30-DAY GYM TRIAL (ruled 2026-08-24, DECISIONS :16548). It is
      billing-card work and it does not exist.~~ — DONE 2026-08-27.** The server
      half shipped that morning (`a313861`, DECISIONS :21157) and the web half —
      the button, §4.2's banner and §4.3's seat meter — the same day. A gym owner
      can now start their own 30-day trial from the console, see how long is
      left on every console screen, and see how many of their places are taken.
      **Card-less (`provider='none'`, Part 5 §6) as ruled, and 30 days as
      ruled.**
      ~~so it sits behind :11072's Kd-approval gate — no self-serve path may mint
      a live gym trial, which is what stops the fresh-gym-per-month free ride.~~
      **— STRUCK: KD REVERSED THAT GATE on 2026-08-27** (*"a gym can start on own
      without my approval but i will have the power of removing them or pausing
      their use if i find them to be fraud"*). What stops the fresh-gym-per-month
      ride now is **one trial per OWNER, ever** (Part 5 §12), enforced in the
      repo and tested across an EXPIRED first trial — not a human.
      **WHAT THIS TICK DOES NOT COVER, each with its own line below: nothing ENDS
      a trial** (🔴, and it is the big one) · §4.2's CTAs and its expired/grace
      arm · the member-side "this gym is full" sentence.
      **⚠ THERE IS NO "FIRST 20 GYMS FREE" PROGRAMME AND THERE NEVER WAS —
      DECISIONS :16702.** An earlier version of this line carried one. Kd wrote
      *"initially 20 gyms free trisl then subscription"*, meaning **he will
      APPROACH the first twenty gyms with the 30-day trial**; the chat turned
      that into a permanent free perk for twenty businesses, which he rejected
      on sight (*"first 20 gyms free who even said that men"*). **There is one
      trial, every gym gets it, and "the first 20" is a sales target that needs
      no code at all.** No pilot cohort, no counter, no seed row. Kept as a
      warning rather than deleted, because the invented version was specific
      enough to look buildable.
- [ ] 🟡 **THE TRIAL'S SHAPE IS RULED AND ~~NONE~~ MOST OF IT IS BUILT — Kd
      2026-08-25, RE-RULED THE SAME DAY (DECISIONS :19129, superseding :17902 §1d
      in part).**
      **UPDATED 2026-08-27, NOT TICKED.** Built since: no card · no plan choice ·
      the same limit for every gym, read off the lowest-capped band rather than a
      literal 300 · the seat cap biting · **and (b) below, the 90 %-of-cap warning
      — §4.2's banner is now on every console screen and its seat-pressure row is
      live.** **What still holds this line open is (c): the REFUSED MEMBER's
      sentence.** A member who applies to a full gym is turned away by the
      confirm route with `seat_cap_reached`, and the console owner sees it — but
      the member-side wording Kd asked for (*"This gym is full — ask at the front
      desk"*) is not written anywhere a member reads. Nor is the end-of-trial
      prompt to subscribe, which waits on billing.
      Sits with the 30-day trial line above; that line owns the LENGTH, this one
      owns the SHAPE.
      **Ruled, current:** no card or bank details · **NO plan choice at signup** ·
      **EVERY gym trials at the SAME limit: 300 members** · **the gym subscribes
      according to its own member count AFTER the trial** · a prompt to subscribe
      at the end. :11083's Kd-approval gate still governs activation.
      ~~the gym picks WHICH PLAN it is trialling at signup · that plan is FIXED
      for the whole trial~~ **— DEAD at :19129. There is no plan to pick and none
      to fix.** (:17902's own note that he proposed mid-trial plan changes and
      reversed it himself is now moot for the same reason; do not build either.)
      **Kd confirmed the consequence knowingly: a gym with 800 members brings
      only 300 through the door for the month, and the refusal lands on members
      the OWNER invited.**
      **Two of the three chat recommendations SURVIVE and matter MORE now** — the
      wall is certain for every gym above 300, not just for one that picked badly:
      **(b)** warn the owner at **90% of cap** before the wall (Part 3 §4.2's
      banner exists in the spec — make sure it is actually built); **(c)** the
      refused member sees **"This gym is full — ask at the front desk"**, never an
      error, because that sends them to the one person who can fix it.
      Subscribing early is the escape hatch and is a conversion.
      ~~**(a)** pick the plan FROM their stated member count~~ **— DEAD with the
      plan-pick it existed to make harmless.**
- [x] ✅ **DONE 2026-08-28 — `modules/orgs/trialSweep.ts`, the nightly
      `orgs.trial_expiry` job, and `tools/trial-sweep.ts` (DECISIONS :22341).**
      A gym subscription still marked `trialing` past its `trial_ends_at` becomes
      `expired`, in one transaction with its audit row, and its members fall back
      to free within the resolver's own 60-second cache window. **PROVEN, not
      asserted: 9/9 in `test/orgs.trialSweep.test.ts` local, six new mutants
      O139–O144 all RED, and the job watched routing through a real worker to the
      real handler** (`job.started orgs.trial_expiry` → `orgs.trial_sweep.finished`).
      **T3 ROUND 1 IS CLOSED — ZERO Critical/High, the packet SHIPS (:22782).**
      Seven Low, all fixed in the round, logged in `BACKLOG.md`. **Its
      highest-value finding was not in the sweep at all: the SMOKE SHEET'S ONLY
      COMMAND COULD NOT RUN, and both obvious repairs were wrong** — one of them
      badly enough to end every live gym trial on the Neon branch Kd's browser
      reads. Fixed; the sheet now runs the whole smoke on local Postgres.
      **THE SMOKE IS THE ONLY GATE LEFT AND IS RUNNABLE FOR THE FIRST TIME.**
      **WHAT THIS LINE DID NOT CLOSE, each now its own line below: the read-only
      console**, the consumer trial (`owner_type = 'user'`), and the fact that
      **nothing in the suite covers the worker's job ROUTING** — that was verified
      by hand this once and is not a standing guard.
      ~~🔴 **NOTHING ENDS A TRIAL. A GYM THAT TAPS THE BUTTON HAS GYM-TIER FEATURES
      FOR EVER, FREE — raised by T3 round 1 on `a313861` and NOT tracked anywhere
      until this line (2026-08-27).**~~ The self-serve trial writes a `trialing`
      subscription with a `trial_ends_at` thirty days out, that date passes, and
      ~~**nothing in the product notices**~~ **— it does now.**
      **UPDATE 2026-08-28 — KD RULED THIS INTO THE QUEUE (DECISIONS :22215), AND
      THE DEFERRAL BELOW IS STRUCK.** He found it himself, from the report rather
      than from this line: *"after gyms trial ends gyms needs to subscribe other
      wise no acess also for the members of the gyms"*. **Step 1 of his four-step
      order is exactly this sweep and it is now the smallest card that closes a
      live money hole**, so it no longer waits for P3.8. Re-measured that day and
      unchanged: one `INSERT INTO subscriptions`, zero `UPDATE`, nothing acting on
      `trial_ends_at`. Cost derived from the recorded unit price (:9965, $0.00212 a
      scan; 5/day for a gym member): **$0.318/member/month, ~$95/month for a
      300-member dead-trial gym at absolute maximum use** — UNVERIFIED against the
      post-Gemini price, and real usage is far below maximum.
      **WHAT SHIPS WITH IT, ruled in the same message:** members of the lapsed gym
      **fall back to the FREE app and are NOT locked out** (arm A, his words *"The
      member did nothing wrong"*), which needs no resolver change — `expired` is
      simply not in the granting set; and the console goes **read-only except the
      pay path**. §4.2's read-only window (14 days, then archived) was NOT
      re-ratified and stands as the spec wrote it.
      **Measured, not reasoned, at the time of writing:** `subscriptions` has
      exactly ONE writer in the whole API — the `INSERT` in `startGymTrial` — and
      `grep -rn "UPDATE subscriptions" apps/api/src apps/api/scripts` returns
      **nothing**. No sweep, no worker, no route moves `trialing` → `expired`.
      **The scheduled work that DOES exist, enumerated correctly at T3 round 2's
      Low-1 — the first version of this line got its own list wrong:**
      `apps/api/src/worker.ts` registers exactly **two** job schedulers, both on
      the `rollups` QUEUE — **`dpdp.purge` at `0 3 * * *`** (:68) and
      **`orgs.join_sweep` at `30 3 * * *`** (:100). There is no rollup JOB;
      `rollups` is the queue's name. **The useful consequence, which the wrong
      list hid: whoever builds trial expiry does not need new infrastructure** —
      the queue, the worker process and the daily-pattern precedent are already
      there, two lines below the join sweep. `trial_ends_at`
      is written and read by **nothing that acts on it**. The entitlement resolver
      counts `trialing` as granting (`entitlements/repo.ts:19,24`), so the gym's
      members keep 5 meal scans a day against free's 2, indefinitely, **with no
      human in the loop — and the human who used to be the loop was the approval
      gate removed in that same commit** (:21157 §1).
      ~~**THIS IS NOT A REQUEST TO BUILD THE SWEEP NOW.** Expiry and dunning are
      **P3.8** and R1.1 forbids pulling them forward~~ **— STRUCK 2026-08-28 BY KD
      (:22215). Expiry is now step 1 of a ruled card; dunning is NOT and stays in
      P3.8.** What was owed on 2026-08-27
      was this line, in the commit that created the exposure, and it was missing —
      the deferral rule's own failure mode, in the commit that recorded three other
      gaps correctly.
      **TICKS WHEN** a `trialing` subscription whose `trial_ends_at` has passed
      becomes `expired` on a schedule, with a fake-clock test walking the timeline
      (R6.4) — i.e. with the P3.8 card, or earlier if the app goes on the internet
      first. **The trigger is the same as the cost breaker's two lines below: this
      cannot be live-with-real-gyms and unbuilt at the same time.**
      **A THIRD THING, ADDED BY THE WEB HALF 2026-08-27 — THERE IS NOW A SCREEN
      THAT HAS TO LIE ABOUT THIS, and it does not.** §4.2's banner ships with its
      trial countdown, and past the end date it reads *"Your trial is past its end
      date. Your members keep your gym's features while it is still running."*
      That sentence is TRUE only because nothing ends a trial, and it is
      deliberately not *"your trial has ended"* for that reason. **Whoever builds
      the sweep must change that copy in the same card**, or the console will be
      telling owners their trial is merely overdue on the day it actually stops.
      Grep `past its end date` in `apps/web/src/pages/console/billingView.js`.
      **TWO THINGS FOR WHOEVER BUILDS IT, both measured here so nobody re-derives
      them in a panic:** (1) `updateOrg`'s currency lock asks `status <> 'trialing'`
      (`orgs/repo.ts:571`), so **it has never engaged and cannot while every
      subscription in existence is a trial** — it starts working **the day a gym's
      subscription first leaves `trialing`, whichever of billing (P3.4/P3.5, a
      checkout writing `active`) or expiry (P3.8) lands first**, having never run
      in anger. **Round 2's Low-6 corrected this**: the first version named the
      expiry sweep as the trigger, but `<> 'trialing'` is equally satisfied by
      `active`, so the first live exercise of this guard may belong to whoever
      builds checkout, not to whoever builds the sweep;
      (2) the seat-cap line further down this file already says its gap covers
      *"every gym whose trial has ended"*, which is a sentence written on the
      assumption that trials end. Today that set is empty.
      **UPDATE 2026-08-28: THAT SET IS NO LONGER EMPTY AND THIS GUARD IS NOW
      LIVE** (:22341). The first gym whose trial lapses is the first row this
      condition has ever seen. Nothing about it changed; what changed is that it
      can now fire, and the FIRST direction it fires in is expiry, not checkout —
      the opposite of what round 2's Low-6 predicted.
- [ ] 🟡 **A GYM THAT TRIALLED AND NEVER PAID CANNOT FIX ITS OWN COUNTRY, AND KD
      RULED THAT DELIBERATELY — 2026-08-28 (DECISIONS :22341). This is not a bug
      report; it is the consequence, written down so the next chat does not
      "fix" it.** The currency lock asks `status <> 'trialing'`
      (`orgs/repo.ts:641`), so the moment the sweep above writes `expired` the
      gym's country freezes. :19560's reasoning for locking every non-trial
      status ("an ended subscription may still have raised invoices, and
      over-locking is the safe direction") covers a gym that PAID; a lapsed trial
      paid nothing, and is frozen at the exact moment it is asked to subscribe.
      **The alternative was put to Kd in one line beside this one — "let a
      lapsed-trial gym still fix its country" was RECOMMENDED and he ruled AGAINST
      it.** *"No, keep it frozen."* So the code is correct as it stands and must
      not be widened without a fresh ruling.
      **WHAT IS OWED IS THE ESCAPE HATCH, NOT THE RULE:** a gym in this state has
      to reach a human, and `PATCH /v1/orgs/:gymId`'s 409 already says *"Contact
      us"* to nowhere. That is the CONTACT CHANNEL owed beside the admin panel,
      and this line is a second caller for it. **Until it exists, a gym that
      mistyped its country at signup and let its trial lapse is stuck with no
      route to anybody** — bounded today (no gym has lapsed yet) and growing from
      thirty days after the first trial started.
- [x] 🔴 **A GYM WHOSE TRIAL HAS ENDED IS OFFERED THE TRIAL AGAIN, AND THE BUTTON
      CANNOT SUCCEED — a FALSE PROMISE ON SCREEN that the expiry sweep makes
      REACHABLE FOR THE FIRST TIME (found 2026-08-28 by the card that creates it,
      :22341; NOT shipped past Kd silently — it is the finding put to him with the
      card).** **CLOSED 2026-08-28 by the modal card (DECISIONS :23257), smoke
      PASSED 11/11.**
      **Measured, not reasoned.** `listOrgsForUser`'s LATERAL serves only
      `status IN ('trialing','active','past_due')` (`orgs/repo.ts:398`), so the
      moment the sweep writes `expired` the console reads `subscription: null` —
      **identical to a gym that never trialled**. `TrialCard.jsx:106` branches on
      exactly that, so the owner is shown ***"Start your 30-day free trial · Your
      members get the gym's features for 30 days. No card needed."*** with a live
      button. Tapping it is a 409 `trial_already_used`
      (`orgs/repo.ts:1218-1225`): *"You've already used your free trial."*
      **:5807 rule 1a on both arms at once** — a promise that is not true, and a
      person blocked from finishing something the screen says they can do.
      **IT WAS UNREACHABLE UNTIL THIS CARD AND THAT IS THE DANGER, NOT THE
      COMFORT** (:19656 C/H-3's words). Nothing had ever left `trialing`, so no
      screen had ever drawn this state. **Timing, stated so nobody reads it as
      urgent-today or as safe-for-ever: the first real gym's trial started
      2026-08-27, so the first owner can see this from about 2026-09-26.**
      **THE FIX IS SMALL AND IS THE READ-ONLY CONSOLE CARD'S FIRST PIECE, pulled
      forward:** widen `/v1/orgs/mine` to serve the ENDED status (:21580 recorded
      that gap in its own words — the read cannot tell an ended plan from a gym
      that never started one) and let `TrialCard` say the trial has ended and
      point at the pay path instead of offering a trial that will be refused.
      **A chat must not do it unasked** — it is a screen, and the copy is Kd's.
      **THE SERVER HALF IS DONE 2026-08-28 (DECISIONS :22921) AND THIS LINE STILL
      DOES NOT TICK, because the FALSE SENTENCE IS ON A SCREEN and the screen is
      unchanged.** `/v1/orgs/mine` now carries `ownerTrialUsed`, so a console CAN
      finally tell "this owner never trialled" from "their trial is over" — the
      exact blindness measured above. **The fix took the other route, deliberately:
      the LATERAL was NOT widened to serve ended statuses**, because
      `subs_one_live_uq` is a partial index over the three live ones and that is
      what makes its `LIMIT 1` well-defined; widening it gives a gym many matching
      rows with nothing choosing between them (:12731's trap from the other side).
      A separate boolean asks the separate question, and mutant **O150** puts this
      defect back — the evidence keyed on status instead of the durable column —
      and is RED.
      **WHAT IS LEFT IS EXACTLY THE SENTENCE**: `TrialCard`'s pre-trial branch is
      what the modal replaces, and Kd ruled on 2026-08-28 that the button goes when
      it does. ~~**Until that card ships, this defect is still on screen** — first
      reachable about 2026-09-26, unchanged by today's work.~~
      **THE SENTENCE IS GONE 2026-08-28 (DECISIONS :23257).** `TrialCard`'s
      pre-trial branch is deleted on Kd's ruling, so a gym whose trial has ended
      draws no plan card at all; its owner meets the SUBSCRIBE arm of the
      unskippable prompt — the real plans, the line saying the free trial is
      spent, and **no button offering a trial the server would refuse**. Both
      directions are pinned: `planPrompt.render.test.jsx` ("DOES stop that gym
      once the sweep has ended its trial") and mutant **C99**, which puts the
      false promise back by showing the TRIAL arm to an owner whose trial is
      spent. ~~**THIS LINE TICKS ON THE BROWSER SMOKE**~~ **TICKED: the smoke
      PASSED 11/11 on the shipping bytes, and its step 8 is that exact screen —
      Kd saw the subscribe prompt with the real price ladder where the false
      trial offer used to be.**
      **THE TICK WAS WRITTEN ONCE BEFORE ITS EVIDENCE EXISTED, and that is
      recorded rather than quietly fixed** (DECISIONS :23257 §12): the expiry
      steps had not been run when it first went in — the step that jumps time is
      the CHAT's to run and it never had. Kd caught it (*"these are not
      tested"*). Now genuinely run: `expired: 2` against a database read first,
      the null-dated trial correctly untouched, and steps 10–11 confirmed at the
      screen.
- [x] 🟡 **THE LAPSED GYM'S CONSOLE IS NOT READ-ONLY — the OTHER HALF of Kd's
      :22215 step 1, split out of the sweep card on 2026-08-28 (:22341) and
      SPLIT WITH HIS APPROVAL, not deferred quietly.**
      **DONE 2026-08-30 — THE SMOKE PASSED 16/16 (DECISIONS :24893), which was
      the only thing left on this line.** Server half :23711, web half :24141,
      T3 rounds :24376 and :24559, all already shipped. Run on `206ae2c` with
      every `src` file byte-identical to HEAD; step 10 — the manager holding a
      confirm question open across the lapse, which is what round 1 found live —
      passed on the tab-focus path, confirmed by question rather than taken from
      the run's global "all passed".
      **WHAT THIS TICK DOES NOT COVER, and each is its own line elsewhere:** the
      two Settings panels in their read-only state (nobody can reach them — the
      `org.manage` tick-box line), the waiting member's own screen (Kd's
      2026-08-29 ruling that a lapsed gym HOLDS their place, the next card), the
      14-day archive, and a gym that never subscribed at all (one server field
      answers for both and the tests cover both, but the run walked the
      trial-ENDED path only). He was shown the split in
      one line ("it touches every console screen — too much for one safe chunk")
      and chose the job alone.
      **What ships today:** a gym whose trial has ended keeps its whole console —
      roster, join codes, staff, settings — and its members correctly drop to
      free. **What §4.2 and the ruling require:** the console unusable except the
      pay path, for 14 days, then archived-but-restorable. **The 14 days is the
      SPEC's number and was NOT re-ratified** (:22215 §6) — do not shorten or
      lengthen it without asking.
      **IT CANNOT BE BUILT FROM `/v1/orgs/mine` AS IT STANDS** and that is
      :21580's own recorded gap: the read serves only the LIVE statuses, so an
      ended plan and a gym that never started one are identical to a console.
      That widening is this card's first piece.
      **AND IT IS THE PREREQUISITE FOR THE SUBSCRIBE PROMPT** on the 🔴 line
      below — an unskippable prompt over a console that still works is not a
      prompt, it is a dialog somebody closes.
      **THE SERVER HALF IS DONE 2026-08-29 (DECISIONS :23711) AND THIS LINE STILL
      DOES NOT TICK, because nothing a person can SEE has changed yet.** Twelve
      write doors now answer 409 `gym_not_on_plan` for a gym with no live plan —
      the gym's own details, all four code doors, confirm, reject, remove member
      and all four staff doors — while every READ and the pay path keep working,
      which is what makes it read-ONLY. **Kd ruled the scope: it stops EVERY
      member of staff, not only whoever can pay** (`billing.manage` is a tick, so
      a gate on its holders alone is no gate — an owner would simply act through
      a manager). **`/v1/orgs/mine` gained `consoleReadOnly`**, three-state and
      staff-only, so the screens can grey the right controls out; `null` means
      "we could not ask" and locks nothing (C97's rule).
      **THE LATERAL WAS NOT WIDENED after all, and the note above predicting it
      would be is superseded**: a separate field asks the separate question, for
      :22921's reason (`subs_one_live_uq` is a PARTIAL index over the three live
      statuses, which is what makes that read's `LIMIT 1` well-defined).
      ~~**WHAT IS LEFT ON THIS LINE IS THE SCREENS:** every control the server now
      refuses is still drawn live, so a lapsed gym's staff meet a button whose
      press is a 409 with no sentence saying why. Nothing is deleted to fix that
      — the controls are DISABLED with a true sentence (the no-removal rule), and
      §4.2's "trial expired" banner state, which :21580 recorded as unbuildable
      because no trial could end, is buildable now.~~
      **THE SCREENS ARE BUILT 2026-08-29 (DECISIONS :24141) AND THIS LINE STILL
      DOES NOT TICK, because the browser has not seen them: the SMOKE is written
      and UNRUN, and T3 is UNRUN.** Shipped: §4.2's read-only banner (red, no
      CTA, in words true of BOTH a gym that never subscribed and one whose trial
      ended — the spec's "Trial ended" copy is false for the first) · five panels
      greying every control the server refuses, with the server's own sentence
      written once · the confirm queue saying nobody can be let in · and
      `isRetryable` no longer offering "Try again" on the permanent 409, which
      closes the separate 🟡 line below. **Nothing is hidden — the join code, the
      roster and the staff list all still draw in full, and two tests hold that**
      (Kd's ruling: read-only "seals nobody out").
      **The smoke needs TWO ACCOUNTS and that is not incidental**: a gym's OWNER
      meets the unskippable prompt instead of these screens, so everything on
      this card is what a MANAGER sees. `RUNBOOK/smoke-read-only-console.md`.
      **T3 ROUND 1 RAN 2026-08-29 AND THE PACKET DID NOT SHIP: ONE Critical/High.**
      *"Five panels greying every control the server refuses"*, above, was FALSE
      when written — the prop reached every OPENER and stopped there, so **Save,
      Replace it, Remove it and Make the code stayed live** inside a step that was
      already open when the gym lapsed, under the note saying nothing could be
      changed. The app walks that path itself: the console re-reads on tab focus
      and nothing remounts on a plan change. Fixed with the fields beside them,
      five regression cases and nine mutants (C120–C128). **Five Low also fixed;
      the sentence above is left standing and corrected here rather than edited,
      because it is what a review read and believed** (:5748).
      **THE SMOKE SHEET CHANGED SHAPE TOO, and it now covers this**: ~~new step
      9~~ **step 10 after round 2 renumbered the sheet** holds a confirm question
      open across the lapse, which is the one thing no test, mutant or reviewer
      had looked at before this round. **Its four Settings steps were removed as
      UNRUNNABLE** — see the `org.manage` tick-box line below, which is what
      makes them unreachable.
      **T3 ROUND 2 RAN 2026-08-29 (:24559): ZERO Critical/High, THE PACKET SHIPS,
      T3 IS CLOSED — AND THIS LINE STILL DOES NOT TICK, because the SMOKE IS
      STILL UNRUN.** That is now the only thing between this line and its tick.
      Five Low, none in `src/`: round 1's *"the only `<form>` in the console"*
      is false (`NewGym.jsx:262`) and is corrected in all four editable copies,
      **and four of the five were the SHEET, every one of them a step that would
      have failed against CORRECT code** — a landing screen the app does not
      draw, a "no coloured strip" ✅ over a trial banner that is genuinely there,
      a **Confirm** button no queue was drawing, and an exact `expired: 1` from a
      database shared with earlier smokes. **The sheet is runnable end to end for
      the first time and now needs THREE accounts, not two** — the third only
      ever types the join code and is left waiting, so the queue step has
      somebody in it instead of asking Kd to improvise mid-run.
- [x] 🟡 **THE LAPSED GYM IS CLOSED FOUR MONTHS AFTER ITS PLAN ENDS — the third
      step of Kd's :22215 §5 step 1, split off at the plan gate on 2026-08-29
      (:23711) and shown to him in one line, not deferred quietly.**
      **DONE 2026-08-31. Both gates met: the SMOKE passed 8 of 9 at the browser
      (`:26012`) and T3 ROUND 1 found ZERO Critical/High (`:26220`).** Commits
      `be03891` (the card), `db61a84` (the smoke record) and this one (the
      round's eight Low fixes). **THE ROUND CHANGED THE RULE IN ONE PLACE AND KD
      RULED IT: a gym re-opened by hand is no longer immune for ever** —
      `archived_at IS NULL` alone meant exactly that, so an ending recorded after
      the last closure now re-arms the four months. The restore still survives the
      next night, which is all :25771 §3.3 was protecting. Also fixed in the
      round: `max(ended_at)` blind to a newer undated ending, calendar months
      counted in the database session's time zone, the closure's stamp and the
      order of the two console refusals both unobserved (two ALIVE mutants), the
      unscoped configuration `worker.ts` runs exercised by nothing, and two smoke
      sheet clauses. Nine mutants became fourteen (O168–O181), all RED.
      ~~**BUILT 2026-08-31 (DECISIONS :25771) AND THIS LINE DOES NOT TICK:** the
      SMOKE is written and UNRUN, and T3 is UNRUN. Those two are all that is
      left on it.~~ **THE SMOKE PASSED 8 OF 9 on 2026-08-31 (DECISIONS `:26012`),
      run by Kd on `be03891`, with STEP 6 STRUCK — it asked the owner to inspect
      a console the owner cannot reach (the unskippable subscribe prompt,
      :22215/:22697), about a change no screen makes (no web file reads
      `org.status`, :25771 §6), so its ✅ had no observable subject. The claim it
      carried — a closure deletes nothing — was checked from the ROWS instead.
      ~~T3 IS UNRUN AND IS NOW THE ONLY THING LEFT ON THIS LINE~~** — it RAN the
      same day (`:26220`); a passing smoke is not a review (:14147, :14840), and
      this line waited for both.
      **KD RULED FOUR MONTHS, NOT THE SPEC'S FOURTEEN DAYS** — *"i think after 4
      months of inactivity shut down the gym"* — which is :22215 §6's *"do not
      shorten or lengthen it without asking"* being asked and answered. Part 3
      §4.2's fourteen days is superseded. **The four months count from the day the
      PLAN ENDED, and that half is a recommendation he approved rather than a
      paraphrase of what he said**: nothing in this product records when a gym was
      last active (`org_daily_stats` has no writer and no reader), and an
      inactivity rule can close a gym that is PAYING but quiet.
      **SHIPPED:** migration `0016` (`subscriptions.ended_at`, stamped by the
      trial sweep — the clock had no starting instant and the product was
      discarding it) · `modules/orgs/archiveSweep.ts` + a fourth nightly job at
      `30 4 * * *` · `tools/archive-sweep.ts` · `repo.restoreGym` +
      `tools/gym-restore.ts` · a second console refusal so a CLOSED gym cannot be
      written even while on a plan (unreachable until the admin panel's suspend
      button, which is exactly what makes it worth having) · nine mutants
      O168–O176, all RED · the mass-write guard widened to watch `gyms.status`.
      **NOTHING IS DELETED AND NOTHING IS HIDDEN by a closure**: the console still
      draws in full, read-only, and the members moved to the free app four months
      earlier when the plan ended. What stops is that nobody new can join —
      `applyByCode` answers *"That gym is no longer active."*
      **THE AUTOMATIC WAY BACK IS NOT BUILT AND CANNOT BE** — see the payment
      card's line below; `tools/gym-restore.ts` is the hand operation until then,
      and Kd ruled the four months knowing it.
- [ ] ⚪ **THE OTHER TWO SWEEPS ARE STILL NEVER RUN IN THE CONFIGURATION
      PRODUCTION USES — found by T3 round 1 on the archive sweep (`:26220` §4)
      and fixed THERE only.**
      `orgs.sweep.test.ts` and `orgs.trialSweep.test.ts` both drive their sweep
      through a helper that always passes `gymIds`; `worker.ts` passes none. So
      if either statement's `${scope}::uuid[] IS NULL` short-circuit broke, that
      nightly job would become a **permanent silent no-op** — a clean `expired: 0`
      in the log every morning — with every test in both files still green.
      **The archive sweep's own hole is CLOSED** (a test at a year-2000 clock,
      plus mutant O181), and **the same shape works for both siblings**: run
      unscoped at an instant far enough in the PAST that only the test's own
      fixture can be inside the window, assert "at least one" and never a
      literal. Left undone here because a fix round contains only the fix
      (:5348 rule 6) and neither file is in this card's diff.
- [ ] ⚪ **A GYM THAT NEVER SUBSCRIBED AT ALL IS NEVER CLOSED — a decision made
      at :25771 §3, not an oversight, and Kd has not ruled on it.**
      The archive sweep counts four months from the day a plan ENDED, so a gym
      whose owner created it and never started the trial has no clock and is never
      closed. That is the safe direction and it matches §4.2, whose state is a
      plan ENDING. **What it leaves:** a gym created, abandoned before the forced
      trial prompt was answered, sitting `active` for ever with a join code that
      still admits people into a gym on no plan (they land in a queue nobody can
      clear — the held-request behaviour, which is correct). Bounded today: the
      forced prompt (:23257) means a real owner meets the trial before anything
      else. **Put to Kd as a question when the admin panel's gym list exists**,
      which is where he would see such gyms.
- [ ] ⚪ **A HELD JOIN REQUEST AGAINST A GYM THAT IS NEVER RE-OPENED WAITS FOR
      EVER — :25092 §6 handed this to the archive card and :25771 §6 answers half
      of it.**
      Kd ruled *"hold their request and tell them the truth"* (:24141 §1) and the
      expiry holds while the gym has no plan (:25092). Closing the gym does not
      change that: the request is still held and the applicant's sentence is still
      true. **What is unresolved is the far end** — a gym closed and never
      re-opened leaves that person waiting indefinitely, and no screen ever tells
      them the gym is gone. The archive was terminal when :25092 raised this; it
      is not any more (`tools/gym-restore.ts`), which is why this is ⚪ rather than
      🟡. **The honest options, none of them ruled:** expire held requests when the
      gym closes (destroys something, against the spirit of the hold), or tell the
      applicant the gym has closed (new copy, Kd's to write).
- [ ] ⚪ **`drizzle-kit generate` CANNOT BE USED IN THIS REPO, and it was tracked
      NOWHERE before 2026-08-31** (grep-verified before writing this line).
      The snapshots in `apps/api/drizzle/meta/` stop at `0012_snapshot.json`, so
      the generator diffs today's schema against a schema three migrations old and
      re-emits the whole of `0014` and `0015` alongside whatever is new. **Run on
      2026-08-31 it produced a migration containing `ALTER TABLE gyms ADD COLUMN
      country`, both CHECK-constraint rebuilds and the new column together** —
      unusable, and it dies on 42701 if applied. It also names the file by the
      journal's 0-based `idx`, so it collided with the existing `0015`.
      **`0013` THROUGH `0018` were all hand-written for this reason** and none
      left a snapshot, so the debt compounds by one migration each time.
      **`0017_gym_hours` and `0018_gym_clock_format` (both 2026-09-01, opening
      hours and the gym's chosen clock) are the fifth and sixth, counted here
      rather than allowed to pass unremarked — that card does NOT fix this and
      says so in its own risk list.**
      **The fix is one command's worth of work and nobody has scheduled it:**
      regenerate the snapshot chain from the current schema, or accept
      hand-written migrations permanently and say so in `CLAUDE.md`'s T5 template,
      which today tells a chat to use the generator. **Do NOT "fix" it by
      regenerating an applied migration** — that desynchronises
      `drizzle.__drizzle_migrations` and the next `drizzle-kit migrate` re-runs it
      and dies on 42710, CI included (:3332).
- [x] 🔴 **`orgs.unit.test.ts` HAS BEEN RED SINCE THE CURRENCY CARD, AND CI WITH
      IT — found 2026-08-29 (:23711 §6a) by a card that had nothing to do with
      it.** **DONE 2026-08-29 on Kd's say-so** (*"yes"*), in its own commit —
      *"The currency test stops contradicting Kd's own ruling"* — and the fix is
      described below the original note. **Named by SUBJECT rather than by hash
      deliberately: the first draft of this line carried a hash invented before
      the commit existed** (V1 — a number with no command behind it), and a hash
      written INSIDE the commit it names cannot be right anyway, because writing
      it changes it. Two assertions demanded `currencyForCountry("CA") === "CAD"` and
      `("GB") === "GBP"`, while Kd ruled at :22215 §3.5 — and :22921 §2(c) built
      — CA, GB and the euro area onto **USD**.
      **PROVEN PRE-EXISTING RATHER THAN ASSUMED:** at HEAD the map already reads
      `CA: "USD"` and the test already reads `"CAD"`, so it was red before this
      card touched anything. **Neither :22921's PROVE nor :23128's ran that
      file**, which is how a card shipped leaving CI red — and is :22782's
      standing rule ("a card that closes a documented gap should grep for the
      gap's own description before it ships") failing on its own author.
      **THE TEST IS WHAT IS WRONG, not the map**, and the fix is two lines. NOT
      taken at :23711 because it encodes a Kd ruling and belongs to the card that
      made it false (R1.1) — but it is 🔴 because a red suite is a broken gate for
      everybody, not only for its owner.
      **WHAT THE FIX FOUND: it was THREE stale assertions, not two, and nothing
      could see the third.** `DE → EUR` sat three lines below `CA → CAD` in the
      same case, so the CA failure stopped the case before reaching it and the
      suite reported two failures for what were three. **A case that asserts a
      row of related facts hides every one after the first that breaks** — which
      is why the replacement spreads the euro area over three countries instead
      of trusting the one somebody happened to type.
      **PINNED BOTH WAYS (rule 4), because a test rewritten to match the code is
      the easiest kind of green liar to ship:** `CA: "USD"` → `"CAD"` in the map
      goes RED (exit 1, one case), and `IN: "INR"` → `"USD"` goes RED (exit 1,
      two cases). The second is the POSITIVE CONTROL and it is the load-bearing
      one — without India on rupees, a map answering "USD" to everything would
      satisfy every assertion in the rewritten case. Restore verified
      sha256-identical, and the restored file re-run green (exit 0).
- [ ] ⚪ **A LAPSED GYM CANNOT CONFIRM ANYBODY, SO PEOPLE CAN STILL APPLY TO IT
      AND WAIT FOR NOTHING — recorded 2026-08-29 (:23711 §6b) as a consequence
      the read-only card CREATES, rather than found later.**
      **THERE ARE TWO MEMBER DOORS, NOT ONE** — corrected 2026-08-29 by this
      card's T3 round 1 (Low-5), which found the line naming only the first.
      **(i) `POST /v1/orgs/join`** is a MEMBER door and is deliberately not gated
      by the read-only rule, so somebody typing a lapsed gym's code still joins a
      queue whose confirm button now answers 409. **(ii) `POST
      /v1/orgs/applications/:applicationId/nudge`** is the second and reaches the
      same dead end from the other side: the waiting person can still chase the
      gym once a day, it writes `member_nudged_at`, and the console's queue then
      shows a "reminded" badge on a row nobody can clear. The application expires
      by itself after 14 days (`APPLICATION_TTL_DAYS`), so both resolve rather
      than festering, ~~and the applicant's screen says they are waiting — which
      is TRUE, so it is not :5807's class.~~
      **THAT LAST GRADING WAS WRONG AND IS CORRECTED 2026-08-30 (DECISIONS
      :25092).** The applicant's screens did not merely say "you are waiting":
      the dashboard card said *"one tap at the front desk"* and counted down to a
      deadline, and `/org/join` said *"ask them now — it takes one tap"*. **A tap
      the server answers 409 and a deadline nothing acts on are both :5807's
      class**, on two screens, for ten days. The grading held only for the words
      the line quoted, not for the words on screen — **which is the reusable
      part: a severity call made from a summary of a screen is a call about the
      summary.** All three sentences are fixed on the card below.
      ~~**TWO SEPARATE THINGS ARE OWED and they are not the same size.** The
      console's own waiting queue should SAY that nobody can be let in until the
      gym is on a plan — that is the web half's job and costs a sentence. Whether
      the join DOOR itself should refuse — **and whether the nudge should, which
      is the same question about the same dead end** — is a product question with
      its own copy and Kd's ruling, and it touches a surface with heavy rulings
      behind it (:11072, :11385, :12343).~~
      **BOTH ARE SETTLED 2026-08-29 (DECISIONS :24141 §1), one built and one
      ruled.** The console's queue now says *"Nobody can be let in until this gym
      is on a plan."* — **done, and deliberately no more than that.** And KD
      RULED the product question, having first ruled the OTHER way and reversed
      himself a message later: **the join door does NOT refuse — the request is
      HELD and the waiting person is told the truth.** That build is the next
      line below; **this one now ticks only when that ships**, because the
      applicant's own screen is the half that still says nothing.
- [x] 🟡 **DONE 2026-08-30 — commits `1b1de15` (built, DECISIONS :25092),
      `14487cf` (T3 round 1's Critical/High, :25450) and `c49251f` (T3 round 2,
      :25567). BOTH GATES MET: a review round with ZERO Critical/High, and Kd's
      browser.** Smoke 13/13 on 2026-08-30 (:25326) plus **the step-11 re-smoke
      on the shipping bytes, reported PASS by Kd the same day** — owed because
      round 1's fix changed a screen he had already signed off, on a line the
      original run's ✅ never named.
      **THE RE-SMOKE ATTRIBUTES TO THE FIX RATHER THAN MERELY CO-OCCURRING WITH
      IT, which is :25326 §2's rule applied to the step that closes this line.**
      Its ✅ requires the OTHER half of the same grey line to be PRESENT —
      *"Waiting ‹N› days"* under C's name — so an empty queue draws no section at
      all and fails it, and pre-fix bytes would print both halves. The countdown
      being absent **while its own line is on screen** is reachable only through
      `readOnly ? null : expiresInLabel(…)`. C's row also carries a real future
      `expires_at` (2026-09-13, :25326 round log), so the absence cannot be an
      innocent `null`. **And the step is wholly Kd's action, no command of mine
      inside it, so his word is the right evidence for it** (:23535's standing
      rule that a pass is per step and never per message).
      ~~🟡 **A PERSON WAITING TO JOIN A LAPSED GYM IS TOLD NOTHING, AND THEIR
      REQUEST DIES ANYWAY AFTER 14 DAYS**~~ — KD RULED THE FIX 2026-08-29
      (DECISIONS :24141 §1): *"hold their request and tell them the truth."* This
      was CARD B of a split he approved, and card A (the console's screens) went
      first at his choice.
      **HE RULED THE OTHER WAY FIRST AND REVERSED HIMSELF ONE MESSAGE LATER, and
      the reason is the part to keep.** The first ruling was that the join door
      REFUSES a lapsed gym outright ("i say yes"). He then asked the question the
      recommendation had never answered — *"what happens to that user when gym
      subscribes again"* — and the answer killed it: **a refusal saves nobody,
      because the person has to remember to come back and type the code again and
      nothing reminds them**, and it creates two rules where one belongs (whoever
      applied the day BEFORE the gym lapsed keeps their place; whoever applied the
      day after is lost). **Do not re-propose the refusal.**
      **WHAT TO BUILD, and it is a SERVER change plus one sentence:**
      (1) the 14-day expiry HOLDS while the gym has no live plan —
      `sweep.ts`'s expiry step already has a "held" concept (`heldForNotice`) and
      this is a second reason, not a new mechanism;
      (2) the waiting person's own card says the gym cannot take new members
      right now — a field on `/v1/orgs/applications/mine`, which today carries
      nothing about the gym's plan;
      (3) **the nudge** — a waiting person can still chase a lapsed gym once a
      day. It is the second member door (:23928's Low-5) and belongs here, not on
      a line of its own.
      ⚠️ **ONE PIECE CANNOT BE BUILT OR TESTED YET AND IT IS NAMED RATHER THAN
      DISCOVERED LATER: reviving a held request when the gym pays.** Measured
      2026-08-29 — **nothing in this product can put a lapsed gym back on a
      plan**: one `INSERT INTO subscriptions` (the trial) and one `UPDATE`
      (expiry), and the trial is refused to any owner who has ever had one. So
      there is no trigger point for it today. **It belongs to the PAYMENT card**
      and is written here so that card inherits it — a held application whose
      `expires_at` is already in the past would otherwise be killed by the first
      sweep after the gym subscribes, which is the exact outcome Kd's ruling
      exists to prevent.
      **AND A SECOND THING THE PAYMENT CARD NOW INHERITS, added 2026-08-31 with
      the archive writer (:25771 §4): PAYING MUST ALSO RE-OPEN A CLOSED GYM.**
      Four months after its plan ends a gym becomes `archived`, and the only way
      back today is `tools/gym-restore.ts` by hand. The step is one call to
      `repo.restoreGym` in whatever handles a successful payment, and it must run
      BEFORE the held-request revival above — a closed gym refuses `confirm` on a
      different condition from a planless one, so reviving the requests without
      re-opening the gym would hand the front desk a queue it still cannot clear.
      ⚠️ **AND IT MUST NOT RE-OPEN A GYM KD SUSPENDED**: :19016's first admin
      slice writes the SAME `archived` status for fraud, so "they paid, switch
      them back on" needs to tell the two apart before it fires. The `audit_log`
      row distinguishes them today (`org.archived` with `via: archive_sweep`
      versus whatever the admin panel writes) and that is a thin instrument —
      whoever builds either half should give the reason a column instead. Named
      here rather than discovered by a re-opened fraudulent gym.
      ~~**The copy the console shows today STOPS SHORT of promising any of this**
      (:24141 §3d), and two tests assert that, so the reassurance cannot be
      written before the behaviour exists.~~
      **BUILT 2026-08-30 (DECISIONS :25092) AND WAITING ONLY ON ITS SMOKE.** All
      three pieces ship: the expiry holds while the gym has no live plan
      (`sweep.ts`, with `heldNoPlan` reported separately from `heldForNotice` so
      the two reasons a row survives cannot be confused); the waiting person is
      told the gym cannot take new members right now and their request is being
      held, and stops being counted down to a deadline nothing will act on; and
      **the nudge STAYS OPEN, which is the ruling rather than an omission** — Kd
      ruled the join door does not refuse, and this line's own text calls the
      nudge "the same question about the same dead end", so it gets the same
      answer.
      **IT REACHED TWO SCREENS AND THE APPROVED PLAN ONLY NAMED ONE — the second
      is the one most people arrive on.** `orgCanConfirm` was first put on
      `/v1/orgs/applications/mine` alone, i.e. the dashboard card, on a stated
      assumption that the join screen needed nothing because "the card directly
      above re-reads and says it". **That is true of Settings → Gym and FALSE of
      `/org/join`, which renders `JoinGymPanel` and nothing else** — so the QR
      and poster route still said *"ask them now — it takes one tap"* about a tap
      the server answers 409, with no second screen to correct it (:5807's class).
      The field now sits on `orgApplicationSchema`, the shape the join door's two
      waiting arms and the list all share, so a third applicant surface cannot be
      added without it.
      **The console's queue sentence gained its second half in the same commit**,
      exactly as :24141 §3d required — the two tests that asserted its absence
      flipped with the code.
      ~~**This line ticks when `RUNBOOK/smoke-held-application.md` passes**, which
      is written and UNRUN; T3 is also unrun.~~ **THE SMOKE PASSED 13/13 on
      2026-08-30 (DECISIONS :25326), run by Kd on `1b1de15`. THE LINE STILL DOES
      NOT TICK: T3 IS UNRUN, and a passing smoke is not a review** (:14147,
      :14840). That is the only gate left on this card.
      **THE RUN FOUND TWO DEFECTS IN THE SHEET, BOTH FIXED IN THE SAME COMMIT,
      and the first is worth more than the smoke.** (1) **Step 9 proved less than
      it claimed**: it offered one sweep's `expired: 0` as evidence of the new
      plan gate, while the SAME run had just sent that gym its first reminder and
      the expiry refuses to delete inside `EXPIRY_NOTICE_DAYS` — **so the request
      would have survived without this card at all.** A second run five days on
      now isolates the plan gate. **Standing: a sweep result is the output of
      every condition in its WHERE at once, so a single run can never attribute a
      survival to one of them.** (2) Step 9's literal **`heldNoPlan: 1`** read
      **3** — two older waiting people on two other lapsed gyms, correctly held —
      **the third recurrence** of a literal count over a shared database (:23535,
      :24559 Low-5, :24893 §2). Nothing ticks that the browser has not seen, and
      nothing ticks that a review has not seen either.
      **THE REVIEW GATE IS NOW MET AND THE BROWSER GATE IS NOT.** T3 round 1
      (2026-08-30, DECISIONS :25450) found ONE Critical/High — the applicant
      countdown left on the lapsed gym's own queue — and round 2 (diff-only,
      DECISIONS :25567) found **ZERO Critical/High, so the packet SHIPS**; its two
      Low were both fixed in the round and logged in `BACKLOG.md`. **THE ONLY GATE
      LEFT IS A RE-SMOKE OF STEP 11 ALONE**, not the whole sheet: round 1's fix
      changed a screen Kd had already signed off, and the run that signed it off
      could not have seen that row — step 11's ✅ named the sentence and the two
      greyed buttons and never the countdown line between them. **This line ticks
      when Kd has run step 11 on the SHIPPING bytes** (:14956, :15198 — nothing
      ticks that the browser has not seen on the bytes that ship).
- [x] 🟡 **THE CONSOLE OFFERS "TRY AGAIN" ON A REFUSAL THAT TRYING AGAIN CAN
      NEVER FIX — deferred 2026-08-29 from this card's T3 round 1 (Low-6) to the
      READ-ONLY CONSOLE'S WEB HALF, which is the next card and owns this file.**
      **DONE 2026-08-29 in that card (DECISIONS :24141 §3f), exactly as this line
      prescribed — the two permanent 409s are non-retryable beside 403, and the
      POSITIVE CONTROL it demanded ships with them: the same failure OFFLINE
      still offers the button.** Listed by CODE and never by status, which the
      line did not say and which matters: a blanket "409 is permanent" would take
      the retry away from every race on this module (a paused code, an
      application somebody else just decided, a seat cap) — the opposite defect,
      and worse, because that person is stuck looking at a refusal that WOULD
      have cleared. Mutants **C118** (the retry comes back) and **C119** (offline
      loses its button) run both directions.
      `isRetryable` in `apps/web/src/api/orgsApi.js` treats everything except 403
      as retryable, so the permanent **409 `gym_not_on_plan`** this card created
      arrives on screen with a Try again button behind it. **Reachable today**: a
      manager holding `staff.manage` without `billing.manage` on a lapsed gym
      sees it (the owner meets the unclosable plan prompt instead).
      **Graded Low deliberately and NOT softened**: the sentence shown is the
      server's own and is TRUE (*"This gym needs a plan before anything here can
      be changed."*), so it is not :5807's class — what is false is the BUTTON's
      implied promise. **409 `trial_already_used` already sat in that same bucket
      before this card**, so the shape is pre-existing and this adds one member to
      it; the fix belongs with the card that disables these controls anyway,
      alongside a third copy of the rule being avoided (:15010's L-5 moved it here
      precisely so there would be one place to change).
      **The fix, so the next card does not re-derive it:** make the permanent 409s
      non-retryable beside 403, and give it a POSITIVE CONTROL — the same failure
      offline must still offer the button, which is what :15010's own retryable
      pair carries and what keeps the gate a bound rather than a ban.
- [ ] ⚪ **A CONSUMER TRIAL WILL NEVER END, FOR THE SAME REASON A GYM'S ONE DID
      NOT — recorded 2026-08-28 (:22341) so the class is visible rather than
      re-created.** `trialSweep.ts` filters `owner_type = 'gym'` deliberately:
      nothing in the product inserts a `user` subscription today, and R6.2 puts
      every consumer subscription transition through Part 5 §3's single pure
      machine, so a second writer invented in a sweep would be exactly the
      deviation that rule forbids. **The day the one-week consumer trial (:16548)
      ships, it needs its own expiry through that machine** — and the mutant that
      would have caught this is deliberately absent from `mutate-orgs.mjs` (no
      observable subject today, :12343's shape), so it earns one then too.
- [ ] ⚪ **NOTHING IN THE TEST SUITE COVERS THE WORKER'S JOB ROUTING — three jobs
      now share one queue and are told apart by NAME ALONE, with no test
      anywhere** (recorded 2026-08-28, :22341; `grep -rln worker apps/api/test`
      returns four files, none of which imports `worker.ts`).
      **The dangerous direction is specific:** a job name added to the guard list
      without its branch falls THROUGH to the purge handler and runs the wrong
      job under the right name. The guard's own comment now says so, which is a
      comment and not a test.
      **Verified BY HAND this once and that is not a standing guard** — the
      trial job was enqueued onto a real local `rollups` queue and watched
      through a real worker to the real handler (`job.started
      orgs.trial_expiry` → `orgs.trial_sweep.finished`, 70 ms). Nothing repeats
      that on the next change. `worker.ts` is an entrypoint with top-level
      `await` and live Redis/Postgres connections, so testing it is its own small
      card, not a line in this one.
- [x] 🔴 **THE TRIAL PROMPT AND THE SUBSCRIBE PROMPT ARE BOTH UNSKIPPABLE, AND A
      GYM WITHOUT A LIVE PLAN HAS NO CONSOLE — KD RULED IT 2026-08-28 (DECISIONS
      :22215).** His words: *"whenver a gym is created there is trial pop up and
      they can not skip that after the trail ends there is subscription plan pop up
      they can not skip it"*.
      **THREE PIECES, none of them built:** (1) at gym creation the owner meets a
      trial prompt they cannot skip — it costs them nothing (no card, 30 days, the
      smallest band) and it removes the state where a gym hands out codes while
      nobody can tell whether it is a customer; (2) at the end of the trial a
      subscribe prompt they cannot skip, with the console unusable except the pay
      path; (3) the lapsed gym's members drop to the FREE app and are **NOT** locked
      out (arm A, ruled explicitly against a locked-out arm put beside it).
      **IT DEPENDS ON THE EXPIRY SWEEP ABOVE and on two things that do not exist.**
      The subscribe prompt has nowhere to send anybody: Paddle is unbuilt (:17357),
      and the interim — a PayPal invoice plus the admin panel's "mark this gym as
      paid" — is unbuilt too. **Until one exists the prompt says "contact us", which
      needs the CONTACT CHANNEL already owed beside the admin panel** (`PATCH
      /v1/orgs/:gymId`'s 409 already says "Contact us" to nowhere). A prompt whose
      only button fails is the brick wall this ruling exists to remove, so **do not
      ship the subscribe prompt without deciding what its button does.**
      **AND IT NEEDS THE CURRENCY LINE IN THE SAME CARD** (the Canada/UK/euro-area
      item further down): an unskippable trial prompt in front of a gym whose
      currency has no plan strands that gym at signup with a button that 409s.
      **A SECOND GYM'S OWNER HAS ALREADY USED THEIR ONE TRIAL** (`repo.ts`'s
      one-trial-per-owner rule) and must be shown the SUBSCRIBE prompt, not a trial
      prompt that cannot succeed. ~~Named to Kd and not disputed; the copy is
      unwritten.~~
      **KD RULED THE SECOND-GYM ARM 2026-08-28, and it is no longer "not
      disputed", it is DECIDED:** *"they will be showed subscription option that
      they can take and say that they alreday ahd a free trial"*. So that arm
      **shows the real plans with real prices** and says the free trial is used.
      **HE ALSO RESTATED THE SHAPE OF THE WHOLE THING AT A SCREEN, and the
      restatement is the useful part** — shown the console's existing trial BUTTON
      during a smoke, he objected: *"what i am saying is after creating gym when a
      gym is clicked a pop up in the middle of the screen is needed for free trial
      not a button , saying this for million time"*. **A BUTTON ON THE OVERVIEW IS
      NOT THIS ITEM. The deliverable is a MODAL over the console that cannot be
      closed** — no X, no click-outside, no Escape.
      **MEASURED 2026-08-28 — TWO THINGS THE SERVER CANNOT ANSWER YET, so this is
      a server+web card and not a web one:** (1) **nothing tells a console whether
      this owner may still start a trial** — `/v1/orgs/mine` serves only the LIVE
      statuses, so "never trialled" and "trial ended" are the same `null` (that is
      also the 🔴 false-promise line above); (2) **there is NO plans or pricing
      endpoint anywhere in the API** (`grep -rnE '/v1/plans|listPlans|pricing'`
      over `apps/api/src`: no hits), so the subscribe arm has no prices to draw.
      **THE SUBSCRIBE ARM'S BUTTON STILL HAS NOWHERE TO SEND ANYBODY** — Paddle is
      unbuilt (:17357), the admin "mark as paid" tool is unbuilt, and the contact
      channel is owed. Kd was told this before ruling. Until one exists it says we
      will be in touch, which is :22215 §5 step 3's own sequencing.
      **THE SERVER HALF LANDED 2026-08-28 (DECISIONS :22921) AND THIS LINE DOES
      NOT TICK.** Three of the blockers above are gone: the console can now tell
      "never trialled" from "trial ended" (`ownerTrialUsed` on `/v1/orgs/mine`),
      there IS a pricing endpoint (`GET /v1/orgs/:gymId/plans`, the first price
      ever served by this product), and the CA/GB/euro-area currency line above is
      ticked. **What remains is the MODAL itself and it is the whole visible half.**
      **TWO KD RULINGS THE SAME DAY, both now settled and not to be re-asked:**
      the prompt stops **only whoever can pay** (a trainer without `billing.manage`
      is unaffected — :22697 §4's first open question, closed); and the Overview's
      **pre-trial BUTTON is removed** when the modal ships, the plan card staying
      for a gym that IS trialling. **The button's removal belongs to the WEB card,
      not to the server one, and is authorised by that ruling rather than by a
      chat's reading of "a pop up not a button".**
      **:22697 §4's SECOND open question is answered without a ruling**: the gap
      between a trial ending and the 04:00 sweep costs nothing new, because the
      modal keys on STATUS and never on the date (:21580's rule (c)).

      **THE MODAL SHIPPED 2026-08-28 (DECISIONS :23257) AND THIS LINE STILL DOES
      NOT TICK — the smoke is the gate and it has not been run.** What is built:
      `PlanModal`, drawn from `ConsoleLayout` so it covers EVERY console screen
      rather than one an owner can walk around by typing an address · **both arms**
      (never trialled → the trial; trial spent → the real plans, the line saying it
      is used, and no button) · **no X, no Escape, no click-outside**, asserted
      from the outside because all three are absences · the Overview's pre-trial
      button DELETED on Kd's ruling · and the two exits he chose, "Your gyms" and
      Sign out, neither of which is a way past.
      **WHAT IS STILL NOT BUILT, and neither is this line's to close:** the
      console is COVERED by the prompt but not READ-ONLY (its own 🟡 line above),
      and the subscribe arm still has nowhere to send anybody, so it says we will
      be in touch — which needs the CONTACT CHANNEL owed beside the admin panel.
      ~~**TICKS WHEN** all three pieces are live with the sweep, with a fake-clock
      test walking creation → trial → expiry → member entitlements falling back to
      free, and the browser smoke Kd runs on it.~~
      **TICKED. The smoke PASSED 11/11 on the shipping bytes** — Kd created a gym
      and met the trial prompt at the moment of creation, could not close it by
      any means, started the trial, had the chat jump 35 days forward
      (`expired: 2`, against a database read first, with a null-dated trial
      correctly left alone), and met the SUBSCRIBE prompt with the real price
      ladder and no second trial on offer. **This tick was first written before
      the expiry half had been run and Kd caught it** — the correction and its
      standing lesson are at DECISIONS :23257 §12. The fake-clock test is `orgs.trialSweep.test.ts` (:22341), and the
      member half — entitlements falling back to free — is held by the test that
      reads the same gym as owner and as member, because no member screen mentions
      billing and a ✅ there would be satisfied by any app at all (:21751).
      **KD FOUND A DEFECT AT STEP 1 AND IT WAS FIXED BEFORE THE TICK:** the prompt
      did not cover the gym-created screen, so a new owner's FIRST sight was their
      join code for a gym on no plan. Now covered; the code appears once the trial
      starts (DECISIONS :23257 §11, mutant C102).
      **WHAT THIS TICK DOES NOT COVER, so nobody reads it as more than it is:** the
      lapsed gym's console is COVERED by the prompt but is not READ-ONLY (its own
      🟡 line above), the subscribe arm still has nowhere to send anybody (the
      contact channel), and nobody can actually pay (Paddle, unbuilt and
      unauthorised).
- [x] 🟡 **THE PRICE LIST CAN ANSWER 200 WITH AN EMPTY LIST, AND NOTHING REFUSES
      — raised by T3 round 1 on the forced prompt's server half, 2026-08-28
      (DECISIONS :22921), and DEFERRED TO THE MODAL CARD RATHER THAN GUESSED AT.**
      **DECIDED AND BUILT 2026-08-28 IN THE MODAL CARD, exactly where this line
      said it belonged (DECISIONS :23257 §3a). THE SCREEN SAYS SOMETHING TRUE:**
      *"We don't have plans listed in your gym's currency yet"*, above the same
      "we'll be in touch" line that arm always ends on. **The service refusal —
      the other option named below — was REJECTED for a reason specific to this
      surface: behind a prompt that cannot be closed, a 409 is an error card with
      no way forward, a dead end dressed as a failure**, while the sentence keeps
      the one route the arm already offers. No server change was needed (R1.1).
      Covered by `planPrompt.render.test.jsx` ("says something TRUE when the price
      book has nothing in the gym's currency") and by mutant **C100**, which
      proves a FAILED read is never drawn as an empty book.
      `GET /v1/orgs/:gymId/plans` reads `gyms.currency_display`, a STORED column,
      while the guard that proves every currency has a book walks
      `currencyForCountry` — the MAP. A gym still carrying a currency the book has
      since stopped listing therefore gets `{plans: []}` and a 200.
      **Bounded and currently EMPTY on the shared branch, and it cannot grow**:
      `updateOrg` recomputes through the same map, so only rows predating a map
      change can disagree, and there are none there (one on the local database,
      created by this card's own smoke). That is why it is Low and not a hole.
      **WHY IT IS NOT FIXED HERE: the choice is the modal's, not this card's.**
      The options are a typed refusal in the service the way
      `no_plan_for_currency` already answers one function over, or a screen that
      says something true about an empty list. **An unskippable prompt is what
      turns a 200-with-nothing into a person staring at a wall (:22215 §4)**, so
      the card that builds the prompt is the card that must decide — R1.1 forbids
      this one pulling it forward, and :19656's Low-3 is the precedent for not
      inventing a channel.
      **TICKS WHEN** the subscribe prompt ships with a decided answer for a gym
      whose currency has no book.
- [ ] ⚪ **MUTANT C68 IS ALIVE AND THE PRODUCT IS FINE — `ConsoleSection` GUARDS
      ITS OPEN-ON-FAILURE RULE TWICE, so neither guard is falsifiable on its own.
      Found 2026-08-28 by the WHOLE-TABLE web sweep on the modal card (DECISIONS
      :23257), in a file that card never touched.**
      **MEASURED THREE WAYS RATHER THAN REASONED ABOUT**, on
      `settings.render.test.jsx -t "OPENS ITSELF when the staff list fails"`:
      delete `|| forceOpen` from `const isOpen = open || forceOpen;` → **GREEN**
      (this is C68, and why it survived) · delete the latch
      `if (forceOpen && !open) setOpen(true);` → **GREEN** · delete **BOTH** →
      **RED**. So the guarantee is real and observable, the test is not a liar,
      and the two lines are a redundant pair — either one alone satisfies it.
      **NOTHING A USER CAN SEE IS WRONG**, which is why this is ⚪ and not a
      blocker: a section holding an error still opens itself.
      **IT IS C88's SHAPE EXACTLY** (:21580) — two guards, either sufficient,
      neither falsifiable — and the recorded remedy for that shape is to delete
      the redundancy from the SOURCE and move the mutant onto the line that
      decides (:17676's standard). **The fix is one line and it is NOT taken here
      (R1.1): this card owns neither `ConsoleStates.jsx` nor the Settings
      screen**, and the latch exists because of a Critical found at that card's
      own T3 round 1 (Try again cleared `forceOpen` and shut the section under
      the click) — a line with that history is not a drive-by edit.
      **WHY IT WAS INVISIBLE UNTIL NOW, and it is the reusable part: the two
      guards were not written together.** The latch was added later, which made
      the `|| forceOpen` half redundant, and **every web sweep since has been a
      stated SUBSET** — a subset run exercises the whole-table ANCHOR pre-check
      but never actually runs everybody else's mutants. :21580 recorded the same
      class from the other side (three console mutants sat with no anchor for two
      commits). **A no-op mutation cannot be caught by any pre-check; only
      running it finds it.**
      **TICKS WHEN** the redundancy is removed from `ConsoleStates.jsx` and C68
      is re-aimed at the surviving line and re-measured RED.
- [ ] 🟡 **THE SEAT CAP IS CHECKED WHEN SOMEBODY JOINS AND IS NEVER RE-COUNTED, so
      a gym can carry more members than its plan admits — found 2026-08-28 while
      answering Kd's question about unsubscribed gyms; grep-verified untracked
      before adding** (`grep -niE "recount|re-count|never re-?checked|only at join"`
      over `OWED.md` and `BACKLOG.md`: no hits).
      `claimSeat` (`modules/orgs/repo.ts:993-1048`) is the ONLY reader of
      `seatCapFor`, and nothing re-runs it — not the roster, not the resolver, not a
      job. **Combined with the uncapped-without-a-plan line below, the shape is:** a
      gym on no plan takes an unlimited roster (harmless today — its members resolve
      to `free`, measured at `entitlements/repo.ts:12-26`), then starts a trial and
      **every one of those people is inside a 300-seat band at once**, entitled and
      uncounted. The cap would then only refuse the NEXT person.
      **Not a defect this ruling creates — one it makes worth money**, and it is why
      it is written down now rather than when somebody notices a gym of five hundred
      on band 1. **The honest fix is not to evict anybody**: it is that the
      subscribe/upgrade path prices a gym on the roster it actually has, and that
      the console says so before the trial starts. Sizing and shape belong to the
      billing card, not to a chat.
- [ ] 🟡 **§4.2's BANNER SHIPS ITS STATES WITHOUT ITS BUTTONS, AND WITHOUT THE
      EXPIRED/GRACE ARM — deferred by the web half of the trial, 2026-08-27.**
      **Read before adding anything to `billingView.js`'s `bannerFor`.**
      §4.2's table pairs every state with a CTA — *Add payment* · *Choose plan* ·
      *Reactivate* · *Upgrade tier* — and **every one of them opens a Billing
      screen that does not exist**, which is Kd's own sequencing (:19016: *"only
      the Billing TAB now waits for stage 8, while the seat cap, the trial and the
      banner go live in stage 1"*). So the states ship and the buttons do not, and
      each sentence is written to be complete without one. A test asserts the
      banner returns exactly `{key, tone, text, dismissible}`, so adding a `cta`
      is a deliberate act rather than something a later card slips in.
      **THE SECOND HALF IS NOT A CHOICE AND IS THE ONE TO READ: two of §4.2's six
      rows CANNOT BE BUILT YET.** "Trial expired → grace" and the read-only
      console it specifies both need a trial to have ENDED, and nothing ends one
      (the 🔴 line above). Worse, they are unreachable from this data by
      construction: the read serves only the LIVE statuses
      (`trialing`/`active`/`past_due`, §4.1's own set, the same set `seatCapFor`
      and `getCandidates` use), so an ended plan and a gym that never started one
      come back identically as `subscription: null`. **Widening that lateral to
      "the live one, else the most recent" is the change whoever builds expiry
      will need**, and it is a decision about what "the gym's subscription" means
      to four readers, not a one-line edit — which is why it was not made here.
      **TICKS WHEN** an ended trial produces a banner that says so and the console
      goes read-only except Billing, per §4.2 — i.e. with the P3.8 expiry card.
      **`past_due` IS built** and is reachable the day anything writes that
      status; it carries no promise about retrying, because v1 §10's dunning is
      unbuilt and there is nowhere to update a card.
- [ ] 🟡 **`DECISIONS-INDEX.md` HAS OUTGROWN THE READ-PATH IT WAS CREATED TO BE —
      raised by T3 round 1, 2026-08-27, and it is the 2026-07-30 amendment's own
      wall reached a second time.** Measured this session: **6,096 lines** (`wc -l`),
      which CLAUDE.md's grounding rule requires be read **IN FULL every session,
      whatever the task**. That rule exists because DECISIONS.md hit 2,396 lines /
      ~135k tokens and a chat obeying it literally spent half its working memory
      before doing any work. **The index is now roughly 195k tokens and cannot be
      read in one sitting either**, so the rule as written is once again asking for
      something impossible — and the honest consequence is that chats will start
      skipping part of it silently, which is :18830's lesson exactly (an undeclared
      shortcut becomes what every later chat does).
      **The round-1 reviewer declared its own shortcut rather than hiding it** —
      read §1, §2, §3 and §5–7 in full plus four named entries in the DECISIONS.md
      original, and enumerated §4 (≈4,000 lines) by entry HEADER only. That is the
      right behaviour under a broken rule and is not a fix.
      **This line does NOT propose the fix — that is Kd's ruling to make**, and the
      shape of it matters more than the size: §4 (`WEB REPOINT CARDS`) is two thirds
      of the file and is where the growth is. Splitting by phase, or an index-of-the-
      index, or a per-card index living beside the card, are all live options and
      none has been costed. **What is NOT an option is leaving the rule saying "in
      full" while every chat quietly does something else.**
- [ ] 🔴 **THE v1 §9.3 COST BREAKER IS HALF-BUILT AND ENFORCES NOTHING — measured
      2026-08-25 (DECISIONS :19129 §3).** `00-architecture-v1.md:651` promises an
      alert at **₹800/gym/month** and soft-degrade past **3× the gym's fee**, in
      its own words *"bankruptcy-by-API-bill is now mathematically impossible."*
      **Grep-verified: `costs:gym:{id}:{month}` is incremented in exactly ONE
      place** (`apps/api/src/modules/coach/service.ts:224`), **nothing reads it**
      (the only other hits are a comment and `coach.chat.test.ts:281`), and
      **meal scans and ORS never bump it at all** — so even the counter that
      exists is incomplete. There is no alert and no soft-degrade.
      **WORSE THAN FIRST WRITTEN (:19256 §5): that ONE incrementing call site is
      inside the coach module, which is the module being switched off.** Once the
      coach is unwired the counter is incremented **NOWHERE** and still read
      nowhere — an instrument with no inputs and no readers. **Whoever unwires
      the coach must move the `costs:gym` bump to nutrition and geo, or this line
      silently gets worse rather than staying still.**
      🔴 because it is the instrument that BOUNDS the worst case whatever
      allowance is chosen, which makes it worth more than the allowance decision
      itself. ~~Must be live before the first real gym starts a trial.~~
      **DEADLINE SHARPENED 2026-08-27 (DECISIONS :21157), AND THE TRIGGER MOVED:
      it must be live BEFORE THE APP IS ON THE INTERNET, not before the first
      trial** — because gyms now start their own trials with no human in the way,
      so "the first gym" is no longer a moment anybody schedules.
      **KD RAISED THIS HIMSELF and the answer is on record**: *"what if a hacker
      hack my app and create a million gym or user and add million user and uses
      all fetaures aggresively that way a broke like me will have to pay millions
      of dollar in api and server money which i dont have"*. **The measurement he
      was given, so nobody re-derives it in a panic: the exposure is per ACCOUNT
      and is bounded by the daily quota, which IS built** — free 2 scans/day, gym
      member 5 — so at the measured **$0.00212/scan** (:9944) a maxed fake account
      costs **$0.127/month** free and **$0.318** inside a gym. **A gym multiplies
      the damage by 2.5, not by a thousand, and the approval gate he removed was
      never what stood between him and that bill — THIS LINE IS.**
      **WHY IT WAS NOT BUILT FIRST, measured and put to him rather than assumed:
      this breaker cannot precede a gym having a plan.** It meters per GYM against
      3× *the gym's fee*, and spend reaches a gym only through `getLiveGymId`,
      which inner-joins a LIVE subscription — measured 2026-08-27, **1 of 120
      `api_cost_events` rows carries a `gym_id` at all**, total spend ever is
      **≈5 cents**, and nothing is deployed (`apps/web/.env` → `localhost:3000`).
      Building the meter first means building it against nothing and testing it
      against nothing. He chose B on that evidence.
- [x] ~~❓ **THE GYM MEMBER'S COACH ALLOWANCE HAS NEVER BEEN PRICED** — computed
      $0.705/member/month, coach 64–95% of it, every band underwater at the
      ceiling; owed Kd a costed table of allowance options.~~
      **STRUCK 2026-08-26, NOT DONE — THE QUESTION NEVER EXISTED (DECISIONS
      :19256).** The AI chat coach was ruled DROPPED on 2026-08-18 (:9604 §5,
      *"OFF, NOT DELETED"*) and confirmed 2026-08-24 (:16606 §9). **There is no
      allowance to rule on and no bill to price.** Kd caught it —
      *"coach is fucking droped, is it fucking not mentioned in the fucking
      documented"* — and **it was: in six places across four files.**
      **KEPT AS A WARNING RATHER THAN DELETED, because the trap is still armed:**
      `seed.ts` still carries `coach: {day, 30}` and always will, since
      *"OFF, NOT DELETED"* leaves every seed value in place **by design**. **A
      LIVE ENTITLEMENT ROW IS NOT EVIDENCE A FEATURE IS LIVE.** The next chat to
      open the seed with a cost question will find the same number waiting.
      **Before pricing any feature, grep its NAME plus drop/struck/off.**
      The real per-member cost, coach removed, is at :19256 §3: scans only,
      $0.255/month on today's Qwen constants and $0.024 after the Gemini swap —
      **so the ratified book is right only on the far side of a swap that is not
      built** (the unticked Gemini line above).
- [ ] ⚪ **POSTGRES STAYS ON NEON — revisit above ~$150/month.** Measured
      2026-08-24: Neon Launch is **$32-91/mo** at 10,000 registered members and
      is the single largest infrastructure line ($62.82-$162.87 total, against
      $73-$173 all-in for the whole 20-gym pilot). Self-hosting it on the VPS
      already paid for drops it near zero. **Put to Kd with the trade stated —
      he would own backups, and a lost database costs more than $91 — and he
      left it where it is.** Recorded so the lever is findable, not lost.
      **A move is a v1 §19 DEVIATION PROPOSAL, never a chat's own call.**

### Gym platform — the console and the gym's own money

- [x] ~~🔴 **THE PLANS SEED MATCHES NO PRICE BOOK THAT HAS EVER BEEN RULED, AND
      IT HAS ZERO USD GYM PLANS.**~~ **DONE 2026-08-25 — the seeded book is now
      the ruled one, both currencies, with the caps and the 30-day trial
      (DECISIONS entry below; `apps/api/src/db/seed.ts`).** Ten gym rows (five
      USD + five INR), caps 300/500/1000/1500/2100, the individual tiers at
      $10/₹449 monthly and $110/₹4,939 yearly, paid scans 20/day, gym-member
      scans 5/day. The six pre-ruling org rows are RETIRED (`active = false`),
      not deleted. **The 🟡 quota/price re-seed line below closes with it — it
      was the same one change.** Original text kept below for the record:
- [x] ~~🔴 **THE PLANS SEED MATCHES NO PRICE BOOK THAT HAS EVER BEEN RULED, AND IT
      HAS ZERO USD GYM PLANS. Measured 2026-08-25 (DECISIONS :17902).**~~
      **Read before any billing, checkout, trial, seat-cap or entitlement work —
      this file is where a gym's price AND its member limit actually come from.**
      `grep -n 'currency:\|code: "' apps/api/src/db/seed.ts`:
      **every org plan is INR** (consumer plans are seeded in both books, so the
      absence is specific to gyms) and **the entire US/CA/EU book — the primary
      market since :9604 — has never been seeded at all.** The six INR rows carry
      the **pre-:17366** prices: `org_micro` ₹999 cap 25 · `org_micro_clinic`
      ₹1,499 cap 25 · `org_starter` ₹1,499 cap 100 · `org_standard` ₹1,999 cap
      150 · `org_growth` ₹3,499 cap 400 · `org_scale` ₹4,999 capless.
      **Not one price and not one cap has matched a ruled book since 2026-08-24 —
      :17366 ratified a price book against a seed nobody re-read**, and :17902
      then moved bands 1–2 and every boundary on top of that.
      **The `seat_cap` values ARE the band boundaries in code**, so the fix is
      both halves at once: prices **$35 / $50 / $69 / $99 / $129 / custom** (USD,
      bands 3–5 still unruled — see the ❓ line) and caps **300 / 500 / 1000 /
      1500 / 2100 / null**.
      **DO NOT "tidy" this by scaling the INR rows to match** — that book is
      unruled (❓ line below) and inventing it is the failure :17366 §0 names.
- [ ] 🔴 **PADDLE IS THE PAYMENT ROUTE — KD RULED IT 2026-08-24 (DECISIONS
      :17357), and NOTHING IS BUILT.** **Read before writing any billing code or
      substituting any provider.** *"ok final paddle it is"*. **This does NOT
      overturn :12600's STRIPE = YES** — Stripe is still the destination; Paddle
      is what carries the first gyms, because Stripe India is invite-only and
      needs a registered business he does not have yet.
      **THE DECIDING CONSTRAINT WAS HIS, and a chat re-opening this must answer
      it: the gym must be charged AUTOMATICALLY and must NOT have to create an
      account.** PayPal cannot do both at once (its subscriptions require the
      buyer to hold a PayPal account; its invoices are manual). Razorpay's
      e-mandates are India-issued-card + INR only. **Paddle is the only option
      that does all three and admits a solo Indian individual.**
      **What actually has to be BUILT:** Paddle as a provider adapter under Part
      5 §4's ≤200-line rule, mapping to the ONE internal subscription machine —
      **not a second billing system.** Paddle is merchant of record, so refunds,
      US sales tax and EU VAT are theirs, and the webhook is a truth-feed
      exception in the shape of Part 5 §0's RevenueCat carve-out (**still
      deduped, R3.4**).
      ⚠️ **TWO THINGS ELSEWHERE BECOME REACHABLE THE DAY THIS SHIPS, and both are
      written down so this card inherits them rather than discovering them:**
      (1) **a held join request whose `expires_at` is already in the past is
      killed by the first sweep after the gym subscribes** — the outcome Kd's
      2026-08-29 ruling exists to prevent (the held-application line above);
      (2) **the sweep's `heldNoPlan` / `heldForNotice` counters can drift**,
      because the due count and the expiry read `gymOnPlan` in different
      transactions and a subscription committing between them is only possible
      once this exists (its own ⚪ line, DECISIONS :25450).
      **Facts a builder needs and must not re-derive:** payout is MONTHLY
      (balance converts on the 1st, sent by the 15th, ~3 working days) so money
      arrives ~2½–6½ weeks after a gym pays, a ONE-TIME offset · **$100 minimum
      payout ⇒ four gyms at $30 before any payout at all** · PayPal, cards, Apple
      Pay, Google Pay **and UPI** are all methods INSIDE Paddle's checkout, so
      "offer PayPal too" needs no second integration · 5% + 50¢, which is
      CHEAPER than PayPal's ~9.2% all-in.
      **UNVERIFIED and to confirm with Paddle before committing:** their own page
      states no holding period or rolling reserve for new sellers; a secondary
      source says new accounts can see holds. Also whether the $15 SWIFT fee
      applies to an Indian bank, and whether Payoneer avoids it.
      **RAZORPAY IS STRUCK for the international book** (:456's precedent — no
      line of its own, nothing to build, do not re-propose). It remains the
      obvious candidate for the INDIA book, **which nobody has ruled on**.
- [ ] 🟡 **THE FIRST 4–5 GYMS GO ON PAYPAL INVOICES, NOT PADDLE — agreed
      2026-08-24 (DECISIONS :17357).** Below four gyms he is under Paddle's $100
      payout threshold anyway, and a PayPal invoice is paid **by card with no
      account**, so the gym feels nothing. This is an OPERATOR step, not code —
      it is here so a chat does not build Paddle integration before it is needed
      or wonder why early gyms are not in the system. A gym that later refuses
      Paddle also gets a hand-written invoice; **that is an escape hatch, never a
      second billing path.**
- [ ] 🟡 **KD NEEDS A REGISTERED SOLE PROPRIETORSHIP — the door to Stripe, and a
      CA will ask for it regardless (DECISIONS :17357).** He raised the blocker
      himself: *"i am a completely solo developer not a business"*. **Stripe
      India requires a registered business and a sole proprietorship qualifies —
      a company is NOT needed.** Free first step: **Udyam registration**
      (`udyamregistration.gov.in`) — Aadhaar + PAN, fully online, self-declared,
      no documents uploaded, no fee. Banks then typically want ONE more paper
      (GST registration or a Shop Act licence) for a current account.
      **Paddle needs none of this — so START it, do NOT WAIT for it.**
      Belongs with the :592 / :9944 professional-advice items: **the tax
      questions (LUT for zero-rated export GST, s.44ADA presumptive taxation,
      when a Pvt Ltd starts beating an individual) are for a CA, not a chat.**
- [ ] 🟡 **SIGNED LIABILITY WAIVERS — absent from all ~47 features Kd listed, and
      every US gym needs them (raised by the chat 2026-08-24, DECISIONS :17357;
      no ruling sought yet).** **Zero spec hits.** A PDF, a finger signature, a
      timestamp, stored against the member. Small, and it is one of the things an
      owner checks when judging whether software is serious enough to run their
      business on. Lands in build wave 2 with the other gym-running work.
- [ ] 🟡 **THE CONSOLE EXISTS IN BOTH THE PHONE APP AND ON THE WEB, WITH THE SAME
      FEATURES IN EACH — KD RULED 2026-08-24 (DECISIONS :17765), and this STRIKES
      the mechanism half of :9604 §4.** **Read before planning any console screen
      or proposing a console architecture.** He was asked directly and answered
      *"both men both"*, then rejected a proposed camera-based split of features
      between the two: *"does that mean one thing will exsit in web and another
      feature will exsit in web what is this men"*. **THE FEATURE SET IS NOT
      SPLIT BY DEVICE.** Attendance, announcements, roster, reports, staff,
      settings — all of it, both places. The only difference is LAYOUT.
      **THE ONE DEVICE DIFFERENCE, and it is not a missing feature: the PAY
      BUTTON OPENS A BROWSER.** The billing screen itself exists in both; only
      card entry leaves, because a purchase completed INSIDE the app is an IAP at
      15–30% (measured: $16,421/yr at 500 gyms, at the GOOD 15% rate). Apple
      3.1.3(c) exempts software sold to ORGANISATIONS, so this is permitted.
      **Consumer subscriptions are the OPPOSITE and IAP is mandatory** (Part 5
      §2) — and Apple/Google are merchant of record there, so **they remit tax
      worldwide and a $10 subscriber is zero tax work.** Part 5 §5.4's
      cross-channel guard must exist or someone pays twice.
      **HOW "both" IS BUILT — RULED THE SAME DAY (DECISIONS :17871): NATIVE
      console screens in the Android/iOS app, the existing REACT console on web.
      NOT a web view and NOT a wrapper — that option is STRUCK, do not
      re-propose it as a cost saving.** His words: *"the web gets build for web
      and the apps gets build for android and ios what is the confusion"*.
      **:9604 §4's "building the console TWICE" warning stands and Kd has
      ACCEPTED that cost, having been told the ongoing half in plain words:
      every console screen is written twice and STAYS twice — every future
      change must be made in both places, forever.**
      **Six web console screens exist today** (`apps/web/src/pages/console/`:
      ConsoleHome, Members, NewGym, Overview, Settings, ApplicationsQueue —
      counted 2026-08-24). The API is shared and is NOT duplicated work.
- [ ] 🟡 **APPLE SMALL BUSINESS PROGRAM + GOOGLE'S 15% TIER — APPLY BEFORE
      LAUNCH, NOT AFTER (DECISIONS :17765; Part 5 §1 already said so).** Free,
      days to process, and the default is **30%** until it is done. On the ruled
      $10 consumer price that is **$7.00 kept instead of $8.50 — ~$18,000/yr at
      1,000 subscribers, for filling in a form.** An OPERATOR step; no code waits
      on it, but a launch that skips it is paying double commission from day one.
- [ ] 🟡 **THE GYM CONSOLE DOES NOT EXIST: gyms, join codes, seats.** Measured
      2026-08-18 — `apps/api/src/modules/` has no `org`, `billing`, `webhook` or
      `console` directory; the DB tables (`tenancy.ts`, `orgAnalytics.ts`,
      `money.ts`) exist and nothing reads or writes them through a route.
      **Nothing else on this list works until a gym can exist and people can join
      it**, so this is the first slice whenever a slice is cut.
      **THE HALF THAT IS ALREADY BUILT AND TESTED, so nobody rebuilds it:** the
      entitlement resolver already treats `gym_membership` as a grant source
      alongside `own_subscription` and `free`, and merges them so a member with
      both gets the better one (`modules/entitlements/service.ts`,
      `mergeEntitlements`). Its own comment names the gap — *"P3/gyms add the
      rest"*. What is missing is the gym side that FEEDS it.
      **UPDATE 2026-08-18 — THE API HALF IS BUILT (DECISIONS :10010). THIS LINE
      DOES NOT TICK: it names the CONSOLE, and no console screen exists.** What
      now exists: `apps/api/src/modules/orgs` with `POST /v1/orgs` (org + first
      "Front Desk" code + owner staff row + the owner's complimentary seat, one
      transaction), `GET /v1/orgs/mine`, `POST /v1/orgs/join` (Part 4 §4.2's
      seat-safe join, `FOR UPDATE` on the org row, idempotent repeat) and
      `GET /v1/orgs/:gymId/members`. **The resolver's gap above is CLOSED** —
      joining busts the §4.1 cache and a member of a subscribed gym is upgraded
      on the next read, proven end-to-end by test rather than by reading the
      code. No migration: the §3.2 tables were already there. What is still
      owed sits in the lines added below plus the console screens themselves.
      **UPDATE 2026-08-18 — THE CONSOLE SCREENS NOW EXIST, so this line's own
      headline ("does not exist") is no longer true and is corrected here rather
      than left standing.** `/console` (the gyms you staff) · `/console/new`
      (Part 3 §4.0 step 1 + step 4's code reveal) · `/console/:orgSlug` (the
      gym, its live join code, its member count) · `/console/:orgSlug/members`
      (§2.4's roster, cursor-walked), all under a responsive shell with a left
      rail at `md`+ and bottom tabs below it (§3.1, and Kd's phone ruling at
      :9604 §4). Reached from a **My Gym** entry in the app's own sidebar. One
      API route was added with them — `GET /v1/orgs/:gymId/codes`, Part 3
      §3.3's read half — because **a join code left the server exactly once,
      in the create response, so the console could not show an owner their own
      code after a reload.** Kd ruled the endpoint in rather than let the screen
      print a code from its own memory of one.
      **STILL DOES NOT TICK, and the remaining third is named rather than
      implied:** "seats" in this line's own title is unbuilt — there is no seat
      meter, because a meter needs a cap and no gym has a subscription (the
      line below). §4.1's Overview tiles, §4.3's real Members contents and the
      other four console sections have their own lines. **And smoke and T3 are
      both UNRUN as this is written.**
- [ ] 🟡 **A GYM WITH NO SUBSCRIPTION HAS NO SEAT LIMIT — deferred with the org
      slice, 2026-08-18 (DECISIONS :10010).**
      **NARROWED 2026-08-27, NOT CLOSED (DECISIONS :21157), and the difference
      matters.** A gym can now put itself on a plan — `POST /v1/orgs/:gymId/trial`
      writes a `trialing` subscription on the lowest-capped band in its currency
      (300 members, Kd's :19129 ruling) — so **the cap is live and biting for any
      gym that has started its trial**, proven end to end by a test that fills a
      one-seat plan and watches the next applicant refused. **What is still open is
      the gym that has NOT started one**, which is every gym until its owner taps
      the button and every gym whose trial has ended: `seatCapFor` still resolves
      to null and nothing limits the roster. **Do NOT close this with a default
      cap** — the original reasoning stands, and it is now sharper, because a gym
      sitting between trials is exactly where an uncapped roster is worth money to
      somebody. The seat check itself is BUILT and
      correct: it reads the cap off the gym's live subscription's plan
      (`trialing|active|past_due`, §4.1's own status set), counts live
      non-complimentary members, and refuses the join at the cap — proven by a
      one-seat test plan and by a two-connection concurrency test. **What is
      deferred is the case where there is NO subscription at all, which today is
      EVERY gym**, because billing does not exist: the cap resolves to null and
      nothing limits the roster. Harmless while nobody is paying and nothing is
      live; a revenue hole the moment a gym is on a tier. Do NOT paper over it
      with a hard-coded default cap: the tier sizes are part of the unratified
      US pricing (:9944).
      ~~**Closes by itself when the billing card writes a subscription row — no
      change to this code is expected.**~~ **STRUCK 2026-08-18 BY T3 ROUND 1
      C/H-1 — that sentence was FALSE, and it was the kind of false that hides
      a defect behind a reassurance.** The seat check refused a member who
      ALREADY held a seat: they sit inside the count the cap is compared
      against, so at the cap their second tap on Join answered "this gym has no
      free places" to somebody standing in the gym. A change to this code WAS
      needed and has been made (the check is skipped for a caller with a live
      membership, read under the org lock). **The lesson is the shape: a
      deferral that also predicts its own future is making two claims, and the
      prediction gets no evidence while the deferral gets all the attention.**
- [x] 🟡 **~~`gyms.currency_display` STILL DEFAULTS TO `INR`~~ — DONE 2026-08-18
      BY KD RULING, in the same session that raised it (DECISIONS :10010).**
      Raised as a deferral; Kd overruled the deferral within the hour: *"no inr
      defalut wil update according to location for now usa india candan and
      europe later"*. **The currency now follows the gym's COUNTRY and the
      SERVER derives it** — `country` is a required field on org create,
      `currencyForCountry` maps it, and a client-sent `currencyDisplay` is
      rejected by the strict body schema (tested). Supported today: **US → USD ·
      IN → INR · CA → CAD · GB → GBP · the 20 euro-area countries → EUR**.
      **The UK is on the pound, not the euro** — a K4 call put to Kd in one line
      and not overruled; "Europe" is not one currency and a UK gym quoted in
      euros is a false number in front of a paying customer.
- [ ] 🟡 **WE ARE NOT OPEN IN MOST OF THE WORLD, AND SAY SO — Kd's "later"
      (DECISIONS :10010).** A country outside the supported map is refused at
      org create with `country_unsupported` and a plain sentence, **never given
      a fallback currency** — a fallback is how a gym in Sydney gets quoted in
      rupees. Concretely refused today and each a real market: **Australia,
      Poland, Switzerland, Sweden, Norway, Denmark, Czechia, Hungary, Romania,
      Brazil** and everywhere else. **Adding a country is one row in
      `COUNTRY_CURRENCY`, but a new currency also needs PRICES that exist**, so
      it belongs with the pricing ratification (:9944) and not with a chat's
      guess. The console's country picker must be built from
      `SUPPORTED_COUNTRIES` — a picker sourced from anywhere else offers a
      country the server then refuses.
- [ ] ⚪ **THE `gyms.currency_display` COLUMN DEFAULT IS STILL `INR` IN THE DDL.**
      Harmless today and measured so: every insert writes the derived value
      explicitly, and a test asserts the value that LANDS IN THE DATABASE rather
      than only the one in the reply. Left alone because changing it is a
      migration (R4.4, reviewed as SQL) for no behavioural gain. **It is a trap
      for a future insert path that forgets the column** — whoever adds one owes
      the check, and the migration that touches `gyms` next should drop the
      default while it is there.
- [ ] 🟡 **TRAINERS CANNOT BE SCOPED TO A GROUP, SO STUDIO AND CLINIC TRAINERS
      ARE HELD OUT OF THE ROSTER ENTIRELY (DECISIONS :10010).** Part 3 §2.2
      grants a trainer the member list "assigned/group only (gym: all)" and
      §2.3 makes group scoping CORE for studios and clinics — but nothing
      assigns a trainer to a group: `gym_staff` has `gym_id`, `user_id`, `role`
      and no group column at all. An unscoped list is the only thing buildable,
      and handing a clinic trainer every caseload is the wrong direction to
      guess in, so a trainer gets the full list on a `gym` (which the matrix
      already grants) and a 403 on a `studio`/`clinic`. **Closed by the card
      that adds trainer→code/group assignment**, which is also what Part 3's
      Groups filter needs.
- [ ] 🟡 **THE REST OF THE §2.2 MATRIX HAS NO ROUTES: ~~remove~~/RESTORE a
      member, ~~create/rotate/expire codes~~, staff management, CSV export,
      nudges.** The org slice built create/join/roster only. Part 3 §4.3's
      remove flow (soft `removed_at`, seat freed instantly, 30-day restore) and
      §2.1's multiple named codes are both specced and both unbuilt.
      **UPDATE 2026-08-21 — CODE MANAGEMENT IS BUILT ON THE SERVER, and the
      line does NOT tick.** `POST /v1/orgs/:gymId/codes` (make one) ·
      `PATCH /v1/orgs/:gymId/codes/:code` (pause/wake, set or clear an end date,
      set or clear a join limit) · `POST /v1/orgs/:gymId/codes/:code/rotate`
      (new code on and old code off in ONE transaction, Part 3 §7's leaked-code
      answer). **The refusal machinery was ALREADY built and already enforced** —
      `applyByCode` has turned away paused, expired and exhausted codes since the
      door was built — so what this adds is the only thing missing: a way for a
      gym to REACH those states. No migration; all four columns have existed
      since `0001_init`. **`codes.manage` is a NEW privilege, deliberately not
      merged with `codes.invite`**: §2.2 grants Invite to all three roles and
      "Create / rotate / expire codes" to owner and manager only, so a trainer
      reads 200 and writes 403.
      **UPDATE, SAME DAY — THE SCREEN IS BUILT and the line STILL does not
      tick.** A **Join codes** section now sits on the gym's Overview, under the
      code being handed out: every code with its live state in words, plus
      switch-off/switch-on, an end date, a people-limit, and Replace behind a
      confirmation. It is a SECTION and not a seventh tab — §3.1 fixes the nav at
      six and surfaces Groups as a filter rather than a screen, which is the same
      call :12343 made for the confirm queue. **A trainer sees the code and none
      of the controls** (§2.2's two rows), and the 403 stays the enforcement.
      **BOTH GATES ARE NOW MET, AND THIS LINE STILL DOES NOT TICK — read the
      next sentence before quoting either fact.** The browser SMOKE **PASSED
      2026-08-21** (Kd, all 13 steps, commit `2273fc4`, "all passed"; run record
      in the sheet, the fixes it produced at DECISIONS :14013), and **T3 round 1
      came back ZERO Critical/High** across all three join-code commits, ten Lows,
      all fixed in the round (DECISIONS :14174, `BACKLOG.md` for the table).
      **So the JOIN-CODE half of this line is DONE and its gates are behind it.**
      What holds the line open is the rest of its own title, which was never about
      codes: ~~RESTORE a member, staff management, CSV export, nudges~~ — **and
      STAFF MANAGEMENT's SERVER half is now built too (2026-08-22, DECISIONS
      :14262): list · add by email · change role · remove**, all four owner-only
      through the new `staff.manage` tick, no migration, and Kd's
      *"yes staff seats free"* written into the appointment.
      **AND ITS SCREEN LANDED 2026-08-22 (DECISIONS :14570): a Settings tab in the
      console with the Staff list on it** — every row with its role and when they
      got the keys, Add someone by email, one tap to switch between manager and
      trainer, and a Remove that asks whether they also stop being a member (Kd's
      ruling that day, on his own question *"suppose owner fires a staff should he
      be still a member after that?"*). **THE LINE STILL DOES NOT TICK, and reason
      (1) has CHANGED SHAPE rather than closed — do not tick it on either reason
      alone.** (1) The staff packet's gates are **NOT behind it: the SMOKE
      (`RUNBOOK/smoke-staff.md`, written) and the web half's T3 are both UNRUN**,
      and a screen with no smoke is what :11846/:13803 refused to tick on.
      (2) **RESTORE a member, CSV export and nudges are still routeless**, and
      staff management itself ships only its ROLE half — the per-staff privilege
      TICKS keep their own line below. A chat that ticks this line because the
      staff work finished will lose three items and half of a fourth.
      ~~**AND A DEFERRAL THIS CARD MAKES, recorded here rather than in prose: a
      code can be turned OFF but never DELETED.** `ORG_CODES_MAX` is 100, derived
      from the `listCodes` ceiling so the list is provably whole rather than
      provably truncated, and retired codes count toward it. A gym rotating
      monthly reaches the cap in eight years; the refusal names the number and
      says to delete one, which is a thing nothing can do yet. Deliberate — a
      delete has to decide what happens to `gym_members.code_id`, which is the
      group attribution every membership carries, and that is a ruling (R0.2),
      not a chat's guess.~~
      **CLOSED 2026-08-21 BY KD'S OWN SMOKE (DECISIONS :14061, commit named
      there): *"codes will pile up should have a option to delete"*.** Built as
      REMOVE, not DELETE, and the ruling the line was waiting for is the one it
      predicted: `gym_members.code_id` (and `gym_join_applications.code_id`)
      reference the row under `ON DELETE RESTRICT`, so a real delete is either
      refused by Postgres for exactly the codes a gym most wants gone — the ones
      people used — or erases how today's members got in. `gym_codes.removed_at`
      (migration `0012`) is the same soft-state shape `gym_members.removed_at`
      already uses. **Only a code that cannot admit anybody may go (paused or
      past its end date), and the UPDATE pauses it in the same statement**, so
      "off the list" and "still opens the door" can never disagree; a merely FULL
      code stays, because a member leaving revives it. The cap now counts VISIBLE
      codes, which makes the refusal's "remove one from the list" a thing an owner
      can actually do — it was pointing at a button that did not exist.
      ~~**Consequence worth knowing: `removed_at` is written by nothing
      today**, so the roster's `removed_at IS NULL` filter is correct but
      untested against a real removal — the card that builds removal owes that
      test.~~
      **UPDATE 2026-08-20 — REMOVE IS BUILT, AND KD IS THE REASON (DECISIONS
      :12343).** Shown a plan whose buttons asked "sure?" because a confirmed
      member could not be removed, he answered *"do you even have some common
      sense if someone joins once can not be rempved what is this"*. Measured
      before building: the ONLY statement in the product that had ever written
      `removed_at` was the DPDP Day-0 cascade, i.e. a person deleting their own
      account. `DELETE /v1/orgs/:gymId/members/:userId` now exists (owner and
      manager, §2.2's remove/restore row), the row is CLOSED not deleted, the
      seat is freed by the same statement, the removed person's entitlement
      cache is busted immediately (Kd's own second ruling), and STAFF are
      refused — an owner is member #1 of their own gym and there is no restore
      to undo it with. Tests cover the roster drop, the freed seat, the retained
      history, the cross-gym scoping, the idempotent second tap, the 404 for a
      non-member and the re-join. **This line does NOT tick: RESTORE (§4.3's 30
      days) is still unbuilt, and so is everything else named above.**
      **What restore costs, so the next card starts informed:** the partial
      unique index is on LIVE rows only, so a restore is not an UPDATE of the
      closed row — it is a decision between reopening that row and inserting a
      new membership, and the two disagree about `joined_at`, which is what
      every membership-interval reader is scoped by (§2.1).
- [ ] 🟡 **THE MEMBERS SCREEN'S REAL CONTENTS ARE NOT SERVED: ~~seat meter,~~ last
      active, workouts 30d, avg form 30d, streak, search, group filter.** Part 3
      §4.3 specifies all of them and §3.2 says they come from `org_member_stats`
      — a view that does not exist.
      **THE SEAT METER IS STRUCK FROM THIS LIST — BUILT 2026-08-27, and it never
      needed `org_member_stats`**, which is why it could come first: it is a
      count over `gym_members` against the plan's `seat_cap`, both of which
      exist. `/v1/orgs/mine` now serves the exact count and the cap, and the
      Members header draws `X of Y places used`, amber at §4.2's 90 %. Everything
      else on this line still waits on the view. The roster route serves identity, join date,
      group label and the complimentary flag, which is what Part 3 §2.4's
      boundary allows without touching workout tables. **A field added to that
      response without re-reading §2.4 is how the org-visibility promise gets
      broken**, so the next card on it starts there.
- [x] 🟡 **NO SCREEN ANYWHERE LETS A MEMBER TYPE A GYM'S JOIN CODE.**
      **DONE 2026-08-20, commit `c9435d7`** (built across `25e013d` → `c9435d7`).
      Every gate is met: the two screens exist, **smoke PASSED — all 17 steps
      plus 14b, run by Kd on real servers with two accounts** — and **T3 round 2
      found ZERO Critical/High, so the packet shipped** (DECISIONS :12343 built
      it, :12518 round 1, :12660 Kd's removal-message ruling, :12731 round 2).
      **What ticks is STEP 2 of the approved three-step split only** — the
      waiting room's CLOCK (expiry sweep, gym reminder, member nudge) is step 3
      and keeps its own separate line below; nothing about it is done.
      Original text kept in full below, because the reasoning in it still binds
      the step-3 card. Found
      2026-08-19 while building the login door (DECISIONS :10866); **tracked
      nowhere before, grep-verified.** `POST /v1/orgs/join` has existed since
      :10010 — seat-safe, `FOR UPDATE` on the org row, idempotent on a repeat —
      and **no client calls it**: a grep for `orgs/join` over `apps/web/src`
      returns only the console's own `joinCode` display, which is the OWNER
      seeing the code, not a member redeeming it.
      **What this means in plain words:** a gym owner can create a gym, print the
      code and hand it out, and there is no place in the app for the person
      holding it to enter it. The console prints an invitation nobody can accept.
      **It is the member half of the door built today** — "I'm a member" now
      leads somewhere honest, and what is missing is the one screen that connects
      a member to the gym that invited them.
      **Not fixed in the door card (R1.1):** it is a new screen and a new API
      call, not a routing change. **Part 6 §2's QR poster and the
      `aihg://org/join?code=` deep link are the mobile half of the same thing**,
      so whoever builds this should read that first rather than inventing a
      second entry path. The attach-on-join rule from the member-migration ruling
      (:9870) lands on this same screen and must not be designed twice.
      **UPDATE 2026-08-19 — KD RULED THE DOOR'S SHAPE (DECISIONS :11072) and it
      is bigger than a screen: typing a code creates an APPLICATION.** An
      unknown person is PENDING — no seat, no member features — until the front
      desk confirms; a roster match auto-confirms by :9870's rule verbatim
      (verified email, exactly one candidate). This card therefore also needs:
      a pending state (`gym_members` has none — VERIFIED, so a migration), the
      entitlement resolver and §4.2 seat check both excluding pending, the
      console's confirm queue (ONE mechanism shared with the import card), and
      the join route reworked from instant to apply. Read :11072 before
      planning it.
      **TWO BINDING CLARIFICATIONS + ONE OPTION (DECISIONS :11132, Kd's
      convenience challenge):** a pending person keeps the WHOLE FREE APP — a
      build that parks them on a locked or waiting screen is wrong ("no member
      features" = the gym-paid perks only); the import stays OPTIONAL, so this
      door must work with zero files uploaded; and **auto-confirm via the
      imported gym MEMBER NUMBER is an OPTION to evaluate at this card, not
      ruled** — sequential numbers are guessable, so pair with name/phone if
      adopted, under :9870's wrong-match-is-not-fixable rule.
      **THE WAITING ROOM IS RULED TOO (DECISIONS :11385, same day) — three more
      mechanics this card owes:** a pending application **EXPIRES** if nobody
      acts on it and **re-applying is free**, so a leaked code's pile clears
      itself while a missed real member loses seconds (**this RETIRES the
      "stranger waits forever" line above — the stranger still never gets in,
      but the ROW dies**); the **GYM IS REMINDED** — a count in the console from
      day one plus a nudge if applications sit, and **nothing may expire before
      the gym has been told at least once**, or the feature quietly throws
      members away; and the **WAITING MEMBER CAN NUDGE** the gym, rate-limited,
      from a card that sits ON TOP of the whole free app (never a locked or
      waiting screen). **Defaults put to Kd and not objected to, but RATIFIED AT
      THIS CARD, not already decided: 14-day expiry · gym reminded at 2 days
      then weekly · member nudge once a day.** **Ship the IN-APP half first —
      email does not exist (its own line below).**
      **UPDATE 2026-08-19 — THE SERVER HALF IS BUILT (step 1 of 3; DECISIONS
      :11891). THIS LINE DOES NOT TICK: it names a SCREEN, and there is still
      no screen.** Kd approved a three-step split (server → the two screens →
      the waiting room's clock) after being shown that one card would be four
      times the diff that has caused review spirals here before. What exists
      now: `gym_join_applications` (migration `0011`), `POST /v1/orgs/join`
      REWORKED from instant join to APPLY, the confirm queue, confirm/reject,
      and the applicant's own list. **The 14-day expiry is STAMPED on every row
      but nothing acts on it yet** — that is step 3, its own line below.
      Step 2 (the member's code screen carrying §2.4's "what the gym can see"
      sheet, the waiting card, and the console's queue screen) is what ticks
      this line, after its smoke and a review round with zero Critical/High.
      **UPDATE 2026-08-20 — STEP 2 IS BUILT (DECISIONS :12343), ITS SMOKE HAS
      PASSED (all 17 steps including Remove), AND T3 ROUND 1 HAS RUN AND DID NOT
      SHIP IT (DECISIONS :12518). STILL DOES NOT TICK.** Two Critical/High were
      found and are FIXED — a removed member being told the gym never confirmed
      them, and a trainer being drawn a Remove button the server refuses — plus
      six Lows, all fixed in the same round. **Then Kd caught the OTHER half of
      the first one: the fix left the app saying NOTHING to a removed member,
      and he ruled it must TELL them (DECISIONS :12660).** Built:
      `/v1/orgs/mine` now carries a `formerOrgs` list and the card says "You're
      no longer a member of {gym}"; `RUNBOOK/smoke-join-door.md` gains **step
      14b** for it. **T3 ROUND 2 (diff-only) THEN RAN AND FOUND ZERO
      CRITICAL/HIGH — THE PACKET SHIPS (DECISIONS :12731).** Four Lows and three
      lying tests, all fixed in that round; escape hatch NOT armed.
      **UPDATE 2026-08-20 (final) — KD RAN STEP 14b AND IT PASSED. THIS LINE IS
      TICKED.** The last gate was step 14b — the removed member's dashboard
      saying "You're no longer a member of {gym}" — held open because that copy
      was written AFTER the 17-step smoke and no human had yet seen it on a
      screen. Kd ran it and reported **passed**. What exists now: the code
      box at **Settings → Gym** and at
      `/org/join?code=` (Part 6 §2's deep link mirrored, so the mobile QR and
      the web link are one path), §2.4's visibility sheet on the form and again
      named in the answer, a waiting/refused/member card on the dashboard, the
      console's **Waiting to join** section above the roster with the server's
      exact count on the gym's home screen, and — Kd's addition mid-card —
      **Remove**. `RUNBOOK/smoke-join-door.md` is the 17-step sheet.
- [ ] 🟡 **NO TEST ANYWHERE RENDERS `Dashboard.jsx` OR `Settings.jsx`, so their
      wiring is guarded by SOURCE TEXT rather than by behaviour** (deferred
      2026-08-20, DECISIONS :12518, T3 round 1 L-1). The finding was that
      deleting the `/org/join` route, the dashboard's gym card, or either half
      of Settings → Gym left **all 857 web tests green** while the feature
      disappeared from the product. It is FIXED for this card — five source
      assertions in `joinGym.render.test.jsx`, mutation-proved by deleting two
      of the four wiring points — and the limit is stated in the test file:
      **they prove a page still NAMES a component, not that it renders.** A page
      whose own render throws would satisfy them. Closing this properly means a
      render harness for the two big pages (`Dashboard` needs AuthContext,
      TransitionContext, three api services, `useXp` and framer-motion;
      `Settings` is comparable), which is a card of its own and was NOT built
      inside a fix round (`CLAUDE.md` Part I §2.5 rule 6 — minimal diffs).
      **Why it matters beyond this card:** these are the two screens every
      feature lands on, so the same blind spot applies to every future card that
      wires something into either of them, and the source assertions only cover
      what somebody thought to write a regex for. **Not tracked anywhere before
      today** (grep-verified).
- [ ] 🟡 **A POSTER LINK ONLY WORKS IF YOU ARE ALREADY SIGNED IN — the code is
      lost on the way through the login page** (deferred 2026-08-20, DECISIONS
      :12343). `/org/join?code=ABC123` is the address a gym's QR poster points
      at, and it is behind `ProtectedRoute`, which redirects a signed-out
      visitor to `/login` **carrying nothing** — no `state`, no `from`, no
      query. So the person who scanned the poster signs in and lands on their
      dashboard with the code gone, and has to find Settings → Gym and type it
      by hand. **Measured, not assumed:** `ProtectedRoute` is
      `<Navigate to="/login" replace />` with no location, and `landingRoute`
      decides the destination from the DOOR they chose, by Kd's two-doors
      ruling (:10824/:11616).
      **Why it was not fixed in the card that created it (R1.1):** carrying a
      destination through sign-in means touching the login door itself, and that
      is the surface Kd has ruled on twice — a card that quietly adds a third
      thing deciding where you land after signing in is exactly what :10866's
      "four places decided the destination" finding was about.
      **Part 6 §2 says deep links "never dead-end on a login wall"**, so the
      mobile app owes the same fix and should not invent a second mechanism.
      **Cost today:** the poster works for anyone already signed in, which at
      pilot scale is most people standing at a front desk with the app open.
- [ ] 🟡 **NOBODY IS TOLD WHEN A GYM CONFIRMS OR REMOVES THEM — the app waits
      to be asked** (deferred 2026-08-20, DECISIONS :12343). A confirmed member
      finds out by opening the app (their dashboard card changes to "You're a
      member of {gym}"); a removed member finds out because the card is simply
      gone. **Both are silent by construction: there are no notifications and no
      email** — `EmailSender` logs an event name and sends nothing (:11385's own
      line), and no push exists on web. **Nothing false is on screen** — the
      card states the truth whenever it is read — but the person who is standing
      at a front desk waiting to be let in has to keep reloading, and somebody
      removed gets no explanation at all. Part 3 §4.3 specifies the removal
      message in as many words ("You've left {org} — your workouts are yours
      forever" + Pro win-back), so this is a spec item, not an invention.
      **Closes with the notifications module, which no `OWED.md` line had ever
      named until :11385 and which password reset and email verification are
      also waiting on.**
      **WIDENED 2026-08-20 (DECISIONS :12878) — THERE IS NOW A THIRD SILENT
      EVENT, and this one is the machine's:** a join request that runs out is
      changed by a background job at 03:30, and **the person who was waiting
      finds out only by opening the app.** The card is honest about it — the
      dashboard says "Your request to {gym} expired before anyone confirmed it"
      whenever it is read, and the copy promises no message — so nothing false
      is on screen. But somebody who applied and then waited is exactly the
      person least likely to open the app again, and they get no prompt to.
      **It is the strongest case of the three for the notifications module**,
      because the other two follow a human's tap while this one follows nothing
      at all. Same fix, same module, no separate line.
- [x] ~~🔴 **NOTHING EXPIRES, REMINDS OR NUDGES YET — the waiting room has no
      clock (step 3 of the join door; deferred 2026-08-19, DECISIONS :11891).**~~
      **DONE 2026-08-21 — built (DECISIONS :12878), smoked 10/10 (:13174), and
      FIVE T3 rounds closed with round 5 finding ZERO Critical/High (:13552), on
      commit `12383b4`.** The full gate is met: a round with no
      Critical/High (:5348 rule 1) plus the browser smoke. All four owed
      behaviours are live — the expiry sweep, the gym reminder at 2 days then
      weekly, the member's once-a-day nudge, and the countdown on both screens.
      **What the five rounds cost is the record worth keeping: every Critical on
      this card was a calendar word computed from elapsed arithmetic, or a
      document calling a dead condition load-bearing** — the same two shapes in
      the same two files, four rounds running, closed only when round 4 stopped
      patching functions and wrote ONE rule the whole file obeys.
      **BUILT 2026-08-20 (DECISIONS :12878). T3 ROUND 1 HAS RUN AND DID NOT SHIP
      IT (DECISIONS :13075). STILL DOES NOT TICK.** Two Critical/High, both
      FIXED: **the ordering rule was a YES/NO where the promise is a DURATION**
      (a gym measured at 31 minutes' notice against a promise of two days — the
      second time on this card that :11385's own wording produced the outcome it
      forbids), and **the expiry's audit rows lived outside its transaction**, so
      one dead worker made the trail unrecoverable. Seven Lows, all fixed the
      same round (`BACKLOG.md`), including a hazard the card itself introduced:
      an unscoped test sweep could expire the applications the sibling suite was
      confirming.
      **UPDATE 2026-08-21 — THE SMOKE PASSED 10/10 (DECISIONS :13174). The
      DIFF-ONLY RE-REVIEW IS THE ONLY GATE LEFT.** The `expired` arm was seen by
      a human for the first time, and the final run caught the C/H-1 fix
      refusing to delete a real request in a browser. Two sheet defects were
      found and fixed mid-run, both the sheet's.
- [x] ⚪ **DONE 2026-08-21 — KD RULED IT OFF, and the ruling that settled it was
      a different one.** He asked about this during the clock smoke and did not
      rule; what closed it was his no-names ruling on join codes the next day
      (*"this kind of names not needed men"*). **Once no code can be given a
      name, EVERY code carries the same default label** — so the field can no
      longer distinguish anything, and "hide it while a gym has one code" (the
      fix this line proposed) became "hide it always". The label is off the
      waiting row; `groupLabelText` and the roster's own column are UNTOUCHED
      (R1.1 — he named the waiting list). The §2.4 test that asserted the label
      was INVERTED rather than deleted, because "four facts and nothing else" is
      still its subject and the allowed set got smaller by one. Ticked against
      the code-management web half; the no-removal rule's authorised path is the
      explicit ruling. **Original text below.**

      **WAS: THE CONSOLE'S WAITING QUEUE PRINTS THE JOIN CODE'S LABEL ("Front
      Desk") AND IT IS NOISE WHILE A GYM HAS ONE CODE** (raised by Kd during the
      clock smoke, 2026-08-21, DECISIONS :13174). It is Part 3 §2.1's group
      mechanism — the thing that tells a big gym which desk, class or campaign a
      person came through — and it is genuinely useful the moment a gym runs
      several codes. **Today no gym can have a second code**: nothing in the
      product creates, rotates or expires one (the pause/rotate line above is
      the gap), so the label is the same six words on every row.
      **Kd asked whether it is needed and was told the above; he did not rule.**
      Not a defect and not acted on (R1.1). The fix, if he wants it, is to hide
      the label while a gym has exactly one live code — one line, and it
      un-hides itself when the code-management card lands. **His call.** All four owed items
      are in: the expiry sweep · the gym reminder at 2 days then weekly · the
      member's once-a-day nudge · and **:11385's ordering rule, enforced TWICE**
      — in the sweep's sequence and in the expiry statement's own WHERE, so if
      the worker never runs, nothing expires. **The three numbers are now
      RATIFIED rather than defaults**: Kd was asked at this card, as :11385
      required, and chose to keep all three. **No migration was needed** — the
      step-1 card wrote all three columns for this one. The daily job is on the
      existing `rollups` queue at 03:30 UTC, and `tools/orgs-sweep.ts --now`
      stands the clock in the future so the smoke takes minutes rather than a
      fortnight. Original text kept below.
      Every application is stamped with a 14-day `expires_at` when it is
      written, and **no code reads that column.** So today a pending row waits
      for ever, which **contradicts :11385 as written** ("a build that keeps
      pending rows indefinitely now contradicts a ruling") — it is a deferral,
      not a disagreement, and the gap is named here rather than left to be
      discovered. What step 3 owes: the expiry sweep · the gym reminder at 2
      days then weekly · the member's once-a-day nudge · and **:11385's
      ordering rule, which is the load-bearing one — nothing may expire before
      the gym has been told at least once**, or the feature quietly throws
      members away. The three numbers are Kd's ratified defaults and each is one
      word from him to change. BullMQ's `rollups` queue and the DPDP purge
      scheduler are the worked pattern (deterministic jobId, idempotent handler,
      an unknown job THROWS); an injectable clock is required so the timeline is
      testable without waiting a fortnight. **IN-APP ONLY — email does not
      exist (next line), so no copy may promise one.**
- [ ] ⚪ **THE JOIN-APPLICATION SWEEP HAS NO BATCH LIMIT — every overdue row in
      the whole database moves in one statement** (deferred 2026-08-20,
      DECISIONS :12878). `purgeDueUsers` next door takes a `limit` and this does
      not, deliberately: the DPDP purge walks each user through a transaction
      doing real work, while this is three set-based UPDATEs against a PARTIAL
      INDEX (`gym_join_applications_expiry_idx`, on `expires_at` where status is
      pending), and batching a set-based statement adds a cursor and a
      resume-point for no gain at the size the product is.
      **The honest cost, stated rather than discovered later:** at a scale where
      tens of thousands of applications go overdue on one night, that UPDATE
      holds a lot of row locks at once — and the rows it locks are exactly the
      ones a front desk might be confirming at that moment, so a confirm could
      block behind the sweep. **03:30 UTC is not the middle of the night
      everywhere** (it is 09:00 in Jorhat), which is what makes that reachable
      rather than theoretical.
      **Not fixed now (R1.1) and no number invented:** the fix is a `LIMIT` plus
      a loop, or moving the schedule per-region, and choosing between them needs
      a real roster size nobody has yet. **The trigger to revisit is the first
      gym with thousands of members**, i.e. the same trigger the roster-import
      work has. Tracked nowhere before today.
- [ ] 🟡 **AUTO-CONFIRM CANNOT BE BUILT YET: there is no imported roster to
      match against** (deferred 2026-08-19, DECISIONS :11891). :11072 rules that
      "a person matching the gym's imported roster is confirmed AUTOMATICALLY"
      by :9870's key verbatim — verified email, exactly ONE candidate row in
      that gym. **Measured: no roster/import table exists at all**, so the
      candidate set is empty by construction and the branch has no input. It was
      NOT stubbed (R1.3 — a stub that returns success is a security bug wearing
      a disguise); the join response's outcome union deliberately has **no
      `joined` arm**, so the import card adds the arm together with the code
      that produces it. **What this costs TODAY, and Kd was told: every single
      applicant waits for a front-desk tap, including a gym's own existing
      members.** Acceptable only because :11132 keeps them on the whole free app
      meanwhile. Closes with the import card, not before.
- [x] 🟡 **DONE 2026-08-23 — commits `245632d` (screen) · `f1a334a` (T3 r1 fixes)
      · `291f499` (T3 r2 fixes), and the re-smoke Kd ran on the last of them.
      TICKED ON THE FULL GATE AND NOT A BYTE LESS:** a passed 10-step smoke
      (:15927), a review round finding **zero Critical/High** (:16221), **and the
      one observation both of those were missing** — a human watching a power
      ticked ON reach a control. Kd ran that himself on a TRAINER, after the
      reload: *Change join codes* ticked on → Pause/Replace/New code **appeared**;
      ticked off → they **disappeared**, with the code itself still visible
      because sharing it is a different tick. **That last step is why this line
      sat unticked for a day after its stated conditions were already met** —
      step 7 of the original sheet was meant to be it and proved nothing (:16221
      L-3), and ticking over that would have been :5034's recorded defect wearing
      a better argument. **The remaining work on this SURFACE is card C (custom
      role names) and the ⚪ refresh line; neither belongs to this item.**

      **The whole history below is kept UNSTRUCK and is worth reading** — it is
      the clearest worked example on this branch of a gate being met on paper
      before it was met in fact.

      **ORIGINALLY: PER-STAFF PRIVILEGE TICKS HAVE NO STORAGE — the seam is in, the
      table is not** (deferred 2026-08-19, DECISIONS :11891). Kd ruled the model
      at :11429 and reaffirmed the widening half on 2026-08-19: *"ok only owner
      and manager but if owner gives permission others can also add"*. Built
      now: `requirePrivilege`, a named finite privilege set, and role DEFAULTS —
      **no route checks a role NAME any more**, which is the hole :11429 says a
      new route re-opens. **Not built: the ticks themselves.** `gym_staff` holds
      gym/user/role and nothing else, so an owner cannot yet widen one person's
      access and a gym whose front desk is a TRAINER cannot confirm joins. The
      staff card owes: the migration (:11429's K4 call — store the EFFECTIVE set
      as a SNAPSHOT, table-vs-JSONB decided there against R4.2), an owner-only
      route, **the last-owner lockout guard (rule 2 — §4.7 blocks last-owner
      REMOVAL and ticking away billing/staff-management is the same lockout by
      another door)**, audit logging, and the Staff screen. When it lands it
      replaces the body of one function and no caller changes.
      **UPDATE 2026-08-22 (DECISIONS :14262) — THE ROLE HALF IS BUILT AND THIS
      LINE DOES NOT TICK.** A gym can now appoint managers and trainers (server
      only, no screen), so *"a gym whose front desk is a TRAINER cannot confirm
      joins"* is a REACHABLE state rather than a hypothetical one — which makes
      the ticks more wanted, not less. **Discharged by that card and no longer
      owed here: the last-owner lockout guard** (a COUNT inside the org lock,
      written so it stays correct on the day a second owner can exist) **and the
      audit logging** (add · role change · remove; a no-op role tap deliberately
      writes nothing). **Still owed here: the migration, the owner-only ticks
      route, and the Staff screen.** The permission model is no longer the
      missing part — `staff.manage` is the owner-only privilege that card added —
      what is missing is STORAGE.
      **UPDATE 2026-08-22 (DECISIONS :15381) — THE STORAGE AND THE ROUTE ARE
      BUILT AND THIS LINE STILL DOES NOT TICK.** Migration `0013` gives
      `gym_staff` its `privileges` column; `requirePrivilege` decides on the
      STORED set; `PUT /v1/orgs/:gymId/staff/:userId/privileges` is the
      owner-only way to change it, audit-logged at both ends; a role change
      RESETS the ticks, so a demotion demotes. **What remains is the SCREEN — an
      owner cannot reach any of this today**, which is also why there was no
      smoke to run (:10010's no-screen precedent). The last-owner lockout guard
      on the TICK door landed with it (a count inside the org lock, the sibling
      of the REMOVE door's guard built at :14262).
      **UPDATE 2026-08-23 (DECISIONS :15773) — THE SCREEN IS BUILT AND THE LINE
      STILL DOES NOT TICK, because its two gates are unrun.** An owner opens
      **What they can do** on any staff row and gets the boxes: the effective set
      the server holds, `staff.manage` absent for anybody but the owner, Save
      sending the WHOLE set, and the role button asking first because a role
      change resets the ticks. **NOTHING IS OWED IN CODE ON THIS LINE ANY MORE**
      — what holds it open is `RUNBOOK/smoke-staff-privileges.md` (10 steps,
      written, UNRUN) and T3 (UNRUN). It ticks on a passed smoke plus a review
      round finding zero Critical/High, and on nothing less (:4718 F4, :5034 —
      ticking on code alone is this branch's most repeated bookkeeping defect).
      **Step 6 of that sheet is the one the tick really rests on:** it is the
      only step that proves the SERVER enforces an untick rather than the screen
      merely drawing it (R3.3, :11429 rule 4).
      **UPDATE 2026-08-23 (DECISIONS :15927) — THE SMOKE PASSED 10/10 AND THIS
      LINE STILL DOES NOT TICK: T3 IS THE ONE REMAINING GATE.** Kd's run on
      `245632d`, tree verified byte-identical before and after. **Step 6 passed in
      BOTH directions** — the helper was refused the member list the moment the
      box came off and got it back when it went on — and ~~step 7 repeated the enforcement on a
      SECOND power~~ **— STRUCK 2026-08-23 by the re-review's L-3: step 7 ran with a
      MANAGER, whose ROLE alone drew those controls, so it proved nothing either
      way, and its "gone or refused" ✅ was satisfied by the defect round 1 found.** A passing smoke
      is not a review (:14147); one round finding zero Critical/High is what is
      left.
      **T3 ROUND 1 HAS SINCE RUN — ONE Critical/High, THREE Low; THE PACKET DOES
      NOT SHIP and this line stays open.** **A power ticked ON for a TRAINER
      reaches no control**: the console gates the join-code panel and the Remove
      button on the ROLE NAME (`canManageCodes`, `canRemoveMembers`) while the
      server gates on the TICK (`codes.manage`, `members.remove`) — :11429's seam
      never reached the client, and **`myOrgSchema` carries `staffRole` and no
      `privileges`, so the console has no source for the caller's own set.** That
      is the root and the fix crosses `@app/shared` + `apps/api` + `apps/web`.
      **The smoke could not have caught it** — step 7's widening ✅ is
      unachievable for a trainer and the run used a Manager. Findings listed and
      **approved by Kd before any code** (:5348). Escape hatch NOT armed (:15673
      found zero, and this is the web console rather than `modules/orgs`). **The run needed a MIGRATION APPLIED FIRST — see the ⚪ line below;
      the dev database was one change behind and every screen inside a gym was
      failing.**
      **UPDATE 2026-08-23 (DECISIONS :16095) — ALL FOUR FINDINGS ARE FIXED AND
      THIS LINE STILL DOES NOT TICK: the DIFF-ONLY RE-REVIEW is the one gate
      left** (:5348 rule 2). `/v1/orgs/mine` now serves the caller's effective set
      through the SAME `privilegesFor` the door uses, so screen and server come
      out of one function; both gates ask for the POWER; `privileges` is parsed
      leniently on READS and strictly on the WRITE. **Rule 3 measured for all
      four** — each watched RED under its own defect and GREEN restored, sources
      sha256-verified. web 1127/1127 · orgs.routes 104/104 · db.migration 8/8 ·
      shared 51/51 · WEB SWEEP whole table 64 · 64 RED · 0 ALIVE · API SWEEP a
      stated subset 2 of 105 · 2 RED. **A passing smoke plus a closed round is
      still not a review** (:14147).
      **DEPLOY THE API BEFORE THE WEB FOR THIS FIELD — re-review L-2, and it is
      the one operational thing this line carries.** `viewerPrivileges` falls back
      to the ROLE's defaults when `privileges` is absent, which is right in the
      direction it was chosen for (a real manager keeps their controls if the web
      ships first) and WRONG in the narrowing direction: in a window where the web
      is newer than an api that has the ticks WRITE route but not this READ field,
      **somebody an owner has NARROWED is still drawn Remove and the code
      controls**, and the server 403s them — the "offers a control it knows will
      be refused" defect, at the one moment the fallback cannot avoid it. R3.3
      holds throughout (the 403 is still the enforcement) and **api-first closes
      it entirely**. Nothing else on this branch depends on the ordering, so it is
      written here rather than made a separate line.
      **RE-REVIEW: ZERO Critical/High — THE PACKET SHIPS** (:5348 rule 1). Three
      Lows, all fixed on top: the THIRD gate of round 1's own class
      (`canManageStaff` still read the job title — Low only because
      `staff.manage` cannot diverge from `role === 'owner'` on any reachable row
      today, and it stops being Low the day a second owner or delegated staff
      management ships), this deploy note, and the smoke's step-7 overstatement.
      **STILL NOT TICKED, AND THE REASON IS A JUDGEMENT PUT TO KD RATHER THAN MADE
      QUIETLY.** Both conditions this line names are literally met — a passed
      smoke and a round finding zero Critical/High — **and the step the line
      itself calls load-bearing (step 6) is sound and discriminates.** What holds
      it is that **no human has yet watched a power ticked ON reach a control**:
      step 7 was meant to be that observation and proved nothing (L-3 above), so
      the headline direction of the feature has been seen working by tests and
      mutants only. That is a small, named, tracked thing — the 🟡 line below — and
      ticking over it would be :5034's recorded defect wearing a better argument.
      **Kd's call: tick now on the stated conditions, or hold for the one-step
      re-smoke.** Recommended: hold, it is two minutes of clicking.
- [ ] 🟡 **THE TICK-BOXES SMOKE HAS NO STEP THAT TICKS A POWER *ON* FOR A
      TRAINER — which is the only shape that can catch the defect T3 round 1
      found** (2026-08-23, DECISIONS :16095). **Read before running or editing
      `RUNBOOK/smoke-staff-privileges.md`.** Step 7's ✅ says "the helper can now
      use the join-code controls that they could not before", which **a MANAGER
      cannot demonstrate** — they already hold every non-owner power, so the sheet
      itself sends the runner down the parenthetical UNTICK path. The 10/10 pass
      at :15927 is TRUE and is **not evidence about widening**, and the Critical
      it missed is precisely widening. Fix is one step: appoint a TRAINER, tick
      *Change join codes* on, and confirm the controls APPEAR in their window
      **after a reload** — the reload matters, see the line below. Not written
      into the sheet in the fix round (:5348 rule 6); it is a sheet change and
      belongs with the re-smoke.
- [x] ⚪ **DONE 2026-08-24** (`e8a7e5c` built it · `4c40cd2` fixed T3 round 1's
      two Critical/High · `42017d2` recorded Kd's step-5 smoke pass · round 2
      DIFF-ONLY found **ZERO Critical/High**, so under :5348 rule 1 the packet
      ships; its two Low are fixed in the same commit and logged in `BACKLOG.md`).
      **Both gates are met: a human watched it (steps 1–4 on `e8a7e5c`, step 5 on
      `4c40cd2`) and two review rounds are closed.** Instruments on the final
      bytes: web **1149/1149**, mutants **C43–C54: 12 RED, 0 ALIVE**.
      **THE CONSOLE LEARNS WHAT YOU MAY DO WHEN A SCREEN OPENS AND NEVER
      AGAIN — so an idle tab keeps drawing controls for a role you no longer
      hold** (found 2026-08-23, DECISIONS :15927; **Kd pushed back on "leave it"
      and was right**). **Read before touching `useConsoleOrg`, and before
      answering "does a real user have to refresh?".**
      **BUILT 2026-08-23 AND DELIBERATELY NOT TICKED — DECISIONS :16331.** Kd
      approved the card and it is written: one kept answer in
      `pages/console/consoleOrgs.js`, read by every console screen and by the
      shell around them, re-checked on `focus` AND `visibilitychange`.
      **THE SMOKE PASSED 4/4 on `e8a7e5c` (Kd, 2026-08-23, DECISIONS :16495) —
      so ONE of the two gates is met and the whole claim has now been WATCHED:
      a permission ticked ON reached a control in a SECOND window with no F5.**
      **T3 ROUND 1 HAS NOW RUN (2026-08-24) AND FOUND TWO CRITICAL/HIGH, so the
      packet did NOT ship on it** (DECISIONS :17218). Both are FIXED in that
      commit, each with a test that fails without the fix and a mutant (C51,
      C52, C53):
        · **Creating a gym left the console saying the gym was not yours** —
          "Go to your gym" landed on *"We couldn't find a gym you run at this
          address"*, and "Your gyms" told a first-time owner *"You don't run a
          gym yet"*. The kept answer only re-checks on window focus, and making
          a gym happens INSIDE the window. **This is the card's own reasoning
          failing at its edge** (:16371 argued freshness is bounded because "the
          only way in is the login page's two doors" — true of ENTERING the
          console, silent about it changing its own list from the inside).
        · **A shared front-desk browser could strand the next account on a
          spinner** with no in-app way out, when a hung read outlived a sign-out.
      **THE SMOKE'S NEW STEP 5 — create a gym, press Go to your gym, see the gym —
      PASSED (Kd, 2026-08-24, on `4c40cd2`).** The human half of this line is now
      met ON THE FIXED BYTES. Steps 1–4 were not repeated on that commit; the
      sheet's result block records that and the reasoning for it.
      **WHAT STILL HOLDS THE TICK: round 2 alone — a DIFF-ONLY re-review of those
      fixes** (:5348 rule 2). A passing smoke is not a review
      (:14147), and this branch's most repeated bookkeeping defect is ticking on
      less than the full gate (:5034, :4718 F4).
      **THE STANDING LESSON, because it cost 1147 tests, a 74-mutant table and a
      4/4 human smoke to find one screen lying:** every helper in the render
      suite mounted ONE route, so no test had ever left a screen for the screen
      it navigates to. A guarantee that spans two screens has no instrument here
      unless one is written on purpose.
      **TWO THINGS THE PASS DOES NOT COVER, carried by tests and mutants alone:**
      a background re-check that FAILS leaving the screen alone (C45), and **the
      shared-browser stamp (C46), which that sheet CANNOT exercise as written** —
      an incognito window and a normal window are two cookie jars, so no account
      is swapped inside one window. One extra step fixes it, owed with the next
      run of that sheet.
      **Read the entry before re-reading the rest of this line — the paragraphs
      below describe the defect as it stood, not as the code stands.**
- [ ] 🟡 **A MUTATION SWEEP THAT IS KILLED LEAVES THE MUTATED FILE ON DISK, AND
      NOTHING WARNS YOU** (found 2026-08-24, DECISIONS :17218). **Read before
      killing a sweep, and before trusting a tree you have not run `git status`
      on.** `mutate-console.mjs` (and its siblings) restore byte-exactly after
      every mutant and verify the sha256 — but only on the paths where the run
      finishes. A run stopped part-way (timeout, `TaskStop`, Ctrl-C) leaves the
      current mutant written to the source file. It happened here: a single
      mutant ran past 600 s under a wrong fix, was killed, and left
      `useConsoleOrg.js` holding C49's `[wanted, snapshot.status]`. **`git
      status` caught it because the file was one I had not edited; had it been
      one of the five in the diff, it could have been committed.** Fix is a
      `SIGINT`/`SIGTERM` handler that restores from the kept original before
      exiting, in every mutate-*.mjs. **Not done in this commit — :5348 rule 6
      keeps a fix round to the fix.** Until then the discipline is the one that
      worked: `git status --short` after any sweep that did not print its own
      summary.
- [ ] 🟡 **99 MUTATION ANCHORS ACROSS 9 HARNESSES SPAN TWO LINES, AND A `git
      checkout` OF THEIR TARGET FILE BREAKS EVERY ONE OF THEM** (found
      2026-08-24, DECISIONS :17676). **Read before writing a two-line anchor, and
      before being surprised by "its anchor matches nothing".** Counted:
      `mutate-write-path` 45 · `login-door` 15 · `person-gate` 12 ·
      `console` 9 · `pose-assets` 6 · `join-door` 5 · `dashboard-stats` 4 ·
      `pose-tuning` 2 · `badge-cue` 1 (which already hard-codes `\r\n`, i.e.
      somebody hit this once and patched the instance). They match on `\n`, and
      **this machine's git rewrites a checked-out file to CRLF** — so an anchor
      that works today stops matching the moment its file is restored, reverted
      or freshly cloned. It happened here: restoring `consoleOrgs.js` after a
      probe flipped it to CRLF and aborted C53.
      **IT FAILS SAFE, which is why this is 🟡 and not 🔴:** the whole-table
      pre-check ABORTS with "its anchor matches nothing" rather than letting a
      no-op mutation report ALIVE. The cost is an instrument that is unavailable
      until re-anchored, never a false green.
      **Fix is one line in each harness** — normalise both the file text and the
      anchor (`.replace(/\r\n/g, '\n')`) before matching, then write the mutant
      back in the file's own ending. **Not done in this commit — :5348 rule 6
      keeps a fix round to the fix.** Until then: prefer a ONE-LINE anchor, and
      name the step in the source if no single line carries the guarantee (what
      `forgetTheReadInTheAir` exists for).
- [ ] 🟡 **THE CONSOLE-REFRESH SMOKE CANNOT EXERCISE THE ONE GUARANTEE ABOUT
      OTHER PEOPLE'S DATA, AND IT PASSED WITHOUT NOTICING** (2026-08-23,
      DECISIONS :16495). **Read before running or editing
      `RUNBOOK/smoke-console-refresh.md`.** The sheet asks for a normal window
      and an INCOGNITO window, which are two cookie jars — so no account is ever
      swapped inside ONE window, and **the kept answer's user stamp, the thing
      that stops a gym's shared front-desk browser handing the next person the
      last one's gyms, is never touched by any step.** The 4/4 pass is TRUE and
      is not evidence about that. **Same shape as the tick-boxes sheet's step 7
      (:16095): a step whose fixture cannot produce the state it claims to
      check** — except here the step is absent rather than misleading. Fix is one
      step: in the normal window sign OUT and sign in as the helper, then confirm
      the console lists THEIR gyms and powers, not the owner's. Carried today by
      a test and mutant C46 alone. Not written into the sheet inside the smoke's
      own commit (:5348 rule 6); it belongs with the next run.
      **Not a security defect and that half is verified:** OWASP's rule is that
      the server decides every request and that hiding is never the lock, and
      `requirePrivilege` does exactly that on every gym-scoped route — a stale tab
      can draw a button, never get one past the server.
      **What it costs is a lie on screen and a confused person.** `useConsoleOrg`'s
      effect is keyed `[orgSlug, attempt]` and each console page mounts its own,
      so moving BETWEEN screens re-reads and **sitting still on one does not**.
      The realistic case is the one that actually happened here: two people side
      by side, one ticks a box, the other says "nothing happened".
      **It is PRE-EXISTING — the ticks card did not cause it — but the ticks make
      it bite far more often**, because before this a person's powers changed only
      when their ROLE changed, which is rare, and now an owner can change one at
      any time.
      **THE INDUSTRY ANSWER IS RE-CHECK ON WINDOW FOCUS, and the evidence is that
      it is a DEFAULT rather than a feature: TanStack Query ships
      `refetchOnWindowFocus: true` out of the box.** We hand-rolled the hook, so we
      inherited no such default. **Recommended: option 2 of three** — re-read when
      the window regains focus (small, fixes the case that annoys somebody);
      option 1 was "leave it" and option 3 was polling every few seconds, which
      buys little and chatters. **Its own card, straight after the ticks fix
      round — NOT inside it** (:5348 rule 6: a fix round carries only the fix).
      **It also nearly cost a real Critical/High:** told about the T3 finding, Kd
      tested on a tab open since that account was a Manager, it worked, and that
      read as an acquittal until he reloaded. **A browser check on a stale tab is
      not a measurement** (:11846 — the unnamed cause pointed the flattering way).
- [ ] 🟡 **NOTHING NOTICES WHEN THE DEV DATABASE FALLS A MIGRATION BEHIND, AND IT
      HAD — for a day, with every screen inside a gym failing** (found
      2026-08-23, DECISIONS :15927). **Read before running any browser smoke, and
      before quoting a card's PROVE as evidence that the app works.**
      **Measured, not inferred:** the Neon dev branch `apps/api/.env` points at
      held **12 of the 13** migrations; `gym_staff.privileges` did not exist, and
      `getStaffAuthority` — which gates **every** gym-scoped route through
      `requirePrivilege` — selects it, so Members, Overview, join codes and
      Settings all failed. Applied by hand and verified in the database
      (13 applied, both owner rows backfilled, 0 left NULL, 107 gyms untouched).
      **HOW IT GOT THERE, and it is nobody's carelessness — it is a GAP BETWEEN
      TWO CORRECT THINGS:** :13659 moved the api suite onto a LOCAL Postgres, and
      :15381's PROVE says "all on LOCAL Postgres" quite properly; CI applies
      migrations to its own ephemeral Neon *branch*. **So the one database a
      browser actually reads is applied to by hand and by nothing else**, and the
      day the server half shipped, nobody did. **The card was not wrong; the
      pipeline has no step that owns this.**
      **Why it is worth a line rather than a shrug:** the failure is SILENT until
      a person opens a screen, and it points the flattering way — `/console`
      still lists your gyms, so it reads as one broken screen rather than a
      database a change behind. **It also rehearses the deploy**: the same gap on
      the day P2.8 cuts over is every gym's console dark.
      **Candidate fixes, none chosen (Kd's call, R0.2):** a boot-time check in
      `apps/api` that refuses to start against a database with pending
      migrations, naming the command — the loudest and the cheapest; or a line in
      every smoke sheet's setup (done for the staff-privileges sheet already, as
      a case fix not a class fix — :1239); or making "apply to the dev database"
      an explicit step of any card that ships a migration. **The boot-time check
      is the recommendation**: it is the only one that cannot be forgotten, and
      it converts a silent wrong answer into a refusal to start (:11846's
      precedent — an instrument that refuses a verdict it cannot back is the
      instrument working).
- [ ] 🟡 **A GYM CANNOT APPOINT SOMEBODY WHO IS NOT ALREADY A MEMBER — because
      the invite email cannot be sent** (deferred 2026-08-22, DECISIONS :14262).
      Part 3 §4.7 says "invite by email/phone with role"; what ships is the
      by-email half narrowed to **people already on this gym's live roster**.
      Two reasons, and only the first is a dependency: **`EmailSender` logs an
      event name and delivers nothing** (:11385's own line), so an invite to
      somebody with no account would be a promise the product cannot keep; and a
      lookup across the whole `users` table would turn the route into an
      **account-existence oracle** for any address an owner types. **The second
      reason does not expire** — whenever the invite lands it must go through a
      token the invitee redeems, never a "does this email exist" answer.
      Cost today, stated to Kd before he approved: a manager who is not a member
      joins with the gym's own code first, which takes seconds. **Closes with the
      notifications module**, alongside the three silent join events and password
      reset. Phone is separate and is NOT owed — :12600 struck phone OTP.
- [ ] 🟡 **A GYM CANNOT BE HANDED TO SOMEBODY ELSE: there is no second owner and
      no transfer** (deferred 2026-08-22, DECISIONS :14262). The staff card ships
      `manager|trainer` as the assignable roles and refuses the owner's own role
      at the row as well as at the boundary, so **every owner is the LAST owner**
      and `last_owner` is the only answer removal can give about one. That is the
      safe half; the unsafe half is what nobody has ruled: **when an owner hands
      the gym over, what happens to them** — do they stay staff, keep §4.0 step
      6's complimentary seat, keep billing (§2.2 gives billing to the owner
      alone), and may there be TWO owners at once or only a swap? Shipping the
      widening half alone would let a gym acquire a second owner with no ruling on
      what that means, which is how §4.7's last-owner rule quietly stops meaning
      anything. **The removal guard is already written as a COUNT, not as "is this
      the owner", so the day a second owner exists it keeps working** — that was
      deliberate and is the only part of this that is done. Needs a Kd ruling
      (R0.2) before a card, and it is a real gym's real question: owners sell
      gyms.
- [ ] 🟡 **THE ROSTER'S CURSOR CAN SILENTLY SKIP A MEMBER — a millisecond
      cursor against a microsecond column** (found 2026-08-19 by the join
      door's own new test finding the mirror-image bug in ITS pager; DECISIONS
      :11846). **Measured, not reasoned:** Postgres stores `timestamptz` to the
      microsecond (`now()` came back `…467902`) while a JS `Date` — and so
      `toISOString()` — carries milliseconds (`…467`). `GET /v1/orgs/:gymId/
      members` serialises `joined_at` into its cursor, so the cursor names an
      instant slightly EARLIER than the row it came from. Ordered DESC with
      `<`, that **excludes** rather than repeats: any member whose `joined_at`
      falls between the truncated millisecond and the true value is **dropped
      from the roster and never appears on any page.** The confirm queue had the
      same defect pointing the other way (ASC + `>` REPEATED the boundary row),
      which is how it was found — a duplicate is visible on page two, a gap is
      invisible for ever. **Not fixed here (R1.1):** the roster is a shipped,
      reviewed surface and its cursor is a wire format, so changing it is its
      own card. **The fix is known and already worked:** carry the row's ID and
      let SQL read the true value back (`(joined_at, id) < (SELECT …)`), exactly
      as `listApplications` now does. **Needs two rows inside the same
      millisecond to bite**, which is why four fixtures created seconds apart
      have never shown it — and why the roster IMPORT, which writes many rows in
      one transaction, is the thing most likely to trip it.
- [ ] ⚪ **THE JOIN SCREEN'S LEADERBOARD OPT-OUT IS NOT BUILT** (deferred
      2026-08-19, DECISIONS :11891). Part 6 §2 lists the org-membership surface
      as "join-by-code + **'What {org} can see' sheet** + leaderboard opt-out".
      The sheet is step 2's and is binding (§2.4 requires it at join time); the
      opt-out is not built and is ⚪ rather than 🟡 because **`hidden_from_boards`
      already exists as a column and there are no leaderboards to be on** — the
      board work is P4.x and its dark window is a SCHEDULED state (:1020), not a
      bug. Build it with the boards, on the same screen.
- [ ] 🟡 **NO EMAIL IS EVER ACTUALLY SENT — `EmailSender` LOGS AND RETURNS.**
      Found 2026-08-19 while ruling the join-application reminders (DECISIONS
      :11385); **tracked nowhere in this file before, grep-verified** (`grep -ni
      "notification"` returned two hits, neither of them this). The default
      implementation logs event names only — deliberately, at P2.1 GAP-5 on
      2026-07-11, with real delivery deferred to "the notifications module"
      **that no line has ever owed.** **What is silently affected TODAY, not
      later:** password reset and email verification both mint a one-time token
      and then send nothing, so the only way anybody has ever completed either
      flow is a developer reading it out of the database. **What is blocked
      tomorrow:** every reminder, nudge and D-5 trial email in the gym plan.
      **Not urgent-in-itself and genuinely load-bearing — it is the difference
      between "we told the gym" and "we believe we told the gym".** Whoever
      builds it owes the provider choice (an R1.4 approval) and the rule that a
      send failure is logged and retried, never swallowed.
- [ ] 🟡 **NEITHER `POST /v1/orgs/join` NOR `POST /v1/orgs` HAS A PER-ROUTE RATE
      LIMIT — only the global one.** **JOIN:** codes are 6 characters over a
      32-symbol alphabet (~1.07 billion), so guessing one is not a practical
      attack and this is not urgent; it is recorded because the join route is
      the one place a guess turns into membership of somebody else's gym.
      **CREATE (added 2026-08-18 by T3 round 1 L-5, tracked nowhere before):**
      one account can mint gyms at the global 300/min, which costs us rows and
      lets somebody squat every readable slug — `iron-house` is first-come, and
      a real gym arriving later gets `iron-house-24kq`. The per-route limiter
      pattern already exists in the auth module (dual-keyed per-IP and
      per-identifier). Owed before a real gym is live; deliberately NOT built
      inside the fix round that found it (:5348 rule 6, minimal diffs).
      **WIDENED 2026-08-18 to `GET /v1/orgs/:gymId/codes`**, added with the
      console screen: it is staff-only and takes a uuid, so it is not a guessing
      surface, but it is now the endpoint that hands out the key to a gym's
      roster and it has no per-route limit either.
      **HALF DONE 2026-08-19 (DECISIONS :11891): `POST /v1/orgs/join` NOW HAS
      ONE** — closed inside the waiting-room card because that card rewrote the
      route anyway and it is now the door a stranger with a leaked code knocks
      on. **10/hour per ACCOUNT and 120/hour per IP, and the asymmetry is the
      point:** a real person applies to their gym once, but the normal case for
      the IP dimension is thirty members on the same gym wi-fi on induction day,
      so a tight per-IP number would lock out the exact scenario the feature
      exists for. Neither figure has a governing § — both are recorded as chosen
      (R0.2). Required a small additive `ipMax` option on the shared dual-bucket
      limiter; every auth route is unchanged and its suite proves it.
      **STILL OPEN: `POST /v1/orgs` and `GET /v1/orgs/:gymId/codes`**, which is
      why this line does not tick — the create surface is the one that lets a
      single account squat every readable slug.
- [ ] 🟡 **THE RUNNING FEATURE HAS A HARD CEILING AT A FEW HUNDRED ACTIVE USERS,
      AND IT FAILS AS A DEAD FEATURE RATHER THAN A BILL** (found 2026-08-19
      answering Kd's pricing question; DECISIONS :12111. **Tracked nowhere
      before — `grep -ni openrouteservice OWED.md` returns 0**; :9944 carried it
      as one UNVERIFIED clause inside a pricing entry).
      **Measured in the code:** `generateRoutes` loops `routeSeeds(input.count)`
      and makes ONE provider call per seed with one `api_cost_events` row each,
      and `count` is 1-5 **default 3** (`packages/shared/src/geo.ts:14`). So a
      member's **3 route plans a day is 9 external calls a day, up to 15** — not
      3. ORS bills a request COUNT against a daily allowance, not per call
      (`geo/cost.ts`, `ORS_ROUTE_COST_MICRO = 0n`), **and that allowance is
      shared across the WHOLE APP, not per gym.**
      **THE SIZE IS STILL UNVERIFIED AND THAT IS THE FIRST THING OWED:**
      openrouteservice.org's restrictions page lists functional limits only and
      no rate limits; secondary sources say ~2,000/day (40/min), one says 2,500.
      **The account dashboard is the only authority and nobody has looked.**
      **At ~2,000/day, roughly 130-220 members app-wide using their full
      allowance exhausts routing for EVERY user of EVERY gym that day** — and
      the path is deliberately fail-closed with no mock fallback
      (`geo/service.ts` logs `geo.ors_failed` and throws a typed 503), so what
      they all see is "route generation is temporarily unavailable".
      **Why this is not a pricing problem:** it arrives regardless of what a gym
      pays, at hundreds of users rather than thousands, and Kd's proposed
      2/day → 3/day move brought it 33% closer with nothing recorded.
      **The options, cheapest first, and the first two are free:** cache and
      reuse candidates for the same start point and distance · **drop the
      default `count` from 3 to 1** and generate more only on "show me another"
      — each cuts the call rate ~3× · a paid ORS plan · self-host.
      **Not urgent today** (5 route_gen calls have ever been recorded) and it
      must not be discovered by a gym's members losing the feature at once.
      **UPDATE 2026-08-24 (DECISIONS :16548) — KD RULED THE ALLOWANCE BACK DOWN
      TO 2/day for paid users**, undoing the 3/day that moved this ceiling 33%
      closer. The ceiling itself is UNCHANGED and this line does not tick: the
      ORS allowance size is still unverified and nobody has opened the
      dashboard. **The two free fixes above are now BACKED by a Kd feature ask
      rather than only by this line — his "most-used routes" IS the candidate
      cache, and it is the cheapest feature on his list because it reads our own
      database and makes no external call at all.**
- [x] ~~🟡 **GYM PLAN/TRIAL ACTIVATION SITS BEHIND KD'S APPROVAL — ruled
      2026-08-19 (DECISIONS :11072), binds the BILLING card.**~~
      **STRUCK 2026-08-27 BY KD, WHO REVERSED HIS OWN RULING (DECISIONS :21157).**
      *"i think that should not happen a gym can start on own without my approval
      but i will have the power of removing them or pausing their use if i find
      them to be fraud"*. **A gym now starts its own 30-day trial: there is no
      approval step and none is to be re-proposed.** What replaces it is not
      nothing — **ONE TRIAL PER OWNER, EVER** (Part 5 §12's own *"allowed once"*),
      enforced in `startGymTrial` and guarded by mutant **O128**.
      **BOTH HAZARDS THIS GATE EXISTED FOR WERE RE-MEASURED BEFORE HE RULED, and
      that is the part to keep rather than the reversal itself.** *Friend-pooling
      is already dead and his own ruling killed it*: `gymMemberEntitlements` is
      `proEntitlements` with ONE key changed (5 meal scans/day vs 20, :17366 §2),
      so five people splitting band 1 buy a WORSE product than the $10 individual
      plan, each — the arithmetic that made pooling attractive at :11023's prices
      no longer holds. *Trial-chaining is the one that survived*, and it is what
      the one-trial-per-owner rule closes, with no human and no waiting.
      **THE SUSPEND/REMOVE HALF HE ASKED FOR IN THE SAME BREATH IS NOT BUILT** and
      is now the admin panel's first slice — see the line directly below, which is
      where that half is tracked.
      **Everything :10959 settled stays settled** (an unpaid gym grants its members
      nothing) and needs no re-derivation.
      ~~ORIGINAL TEXT BELOW, kept because the hazard analysis in it is still the
      best statement of what the gate was for:~~ The hazard pair
      this answers was raised by Kd the same day (:11023, tracked nowhere
      before): friends pooling a cheap gym tier undercut the $5 consumer
      price, and card-less gym trials (P3.6) invite a fresh-gym-per-month free
      ride — the resolver already honours `trialing`. **THE RULING: no
      self-serve path mints a live gym subscription or trial; activation
      requires Kd approving the gym (real business name and address).** One
      gate closes both holes — the pool needs a plan that is never approved,
      the chain needs a trial that never activates. The part of the instinct
      that does NOT work stays settled at :10959 (an unpaid gym grants its
      members nothing). **The approval gate is an addition with no governing §
      — the billing card's plan presents it as such (R0.2).**
      **AND IT HAS NO PATH: the gate is RULED and there is nowhere to perform
      it.** The surface it belongs on is the line directly below, which until
      2026-08-25 had never been tracked at all.
- [ ] 🔴 **KD'S OWN ADMIN PANEL IS IN THE SPEC FIVE TIMES AND WAS TRACKED HERE
      ZERO TIMES UNTIL 2026-08-25 — the surface he needs to RUN THE BUSINESS,
      and the deferral rule's own failure mode.** Raised when Kd asked directly
      whether he should have an admin dashboard and whether it would fail store
      review. **Read before building any operator tool, before adding an
      `admin` role anywhere, and before putting an internal control on the gym
      console or in a phone app.**
      **⏳ SCHEDULED LAST BY KD, 2026-08-31 (DECISIONS :26385) — *"own control
      panel needs to be built last it controls all the application not only
      gyms"*.** This line is NOT struck and NOT ticked: the panel is still owed
      in full. What changed is WHEN — it is built after the application it
      controls exists, and **it is not a gym-stage card.** :19016 §4's
      "first slice" is superseded ON TIMING ONLY; everything that entry says
      about where the panel lives and what it must hold still stands. **The 🔴
      here means "blocks the cutover", never "build it next" — a chat that reads
      it as a queue position is repeating the recommendation Kd overturned.**
      Until it exists, a fraudulent gym is stopped by hand in the database and a
      closed gym is re-opened by `apps/api/tools/gym-restore.ts` (:25771), both
      accepted by him on the record.
      **THE SPEC ALREADY SPECIFIES IT AND SAYS WHERE IT LIVES** (grep-verified,
      not recalled): `03-part3-org-console.md:60` — *"Kd (internal) | `admin` |
      lives on the separate admin panel (v1 §6.1, Part 2 §9.4), **not** in this
      console"* · `00-architecture-v1.md:480` — *"your internal panel: gyms,
      cost dashboard, circuit-breaker"* · `:570` lists `admin` in the role set ·
      `08-part8-ops-runbook.md:97` — changes *"made via admin panel only,
      audit-logged automatically"* · `:243` — ban tooling lives there ·
      `05-part5-billing.md:404` — margin on one screen · `03-part3` `:401`/`:454`
      — churn signals and per-org cost feed it.
      **THE CODE ALREADY POINTS AT IT AND CORRECTLY REFUSES TO BUILD IT IN THE
      WRONG PLACE:** `packages/shared/src/orgs.ts:37-38` — *"`admin` is
      deliberately absent — Kd's internal panel is a separate surface (Part 3
      §1), never a role inside an org."* **So this was never an oversight of
      judgement; it is an oversight of TRACKING.** A comment naming a surface is
      not an `OWED.md` line, and prose is exactly how work gets silently lost —
      which is the failure this file was created for.
      **WHY IT IS 🔴 rather than 🟡:** :11072's approval gate (line above) is a
      Kd RULING with no path to perform it, so **no gym can be legitimately
      activated at all** once billing exists; and the DPDP/ban/breakglass
      tooling Part 8 puts here is launch-blocking.
      **KD'S STORE QUESTION, ANSWERED: it does NOT endanger Play Store or App
      Store review, because it must NEVER be inside a phone app.** Store review
      only sees the binary submitted; a separate web surface is not in it. That
      is also the SECURITY answer — an admin panel is the highest-value target
      in the product and has no business shipping to a million handsets. **This
      is the ONE surface exempt from :17765's "same features in both places"
      ruling, because that ruling governs the GYM'S console, a different
      audience entirely.**
      **THE FIRST SLICE CHANGED SHAPE ON 2026-08-27 (DECISIONS :21157) and it is
      now SUSPEND / REMOVE A GYM, not "mark this gym as paid".** Kd reversed the
      approval gate the same day — *"a gym can start on own without my approval
      but i will have the power of removing them or pausing their use if i find
      them to be fraud"* — so the trial no longer waits for him and **the half he
      asked for in exchange is the half that is missing.** Until it exists a gym
      he believes is fraudulent can be stopped only by hand in the database.
      `gyms.status` (`active|archived`) and `gyms.archived_at` already exist since
      `0001_init` and the trial route already refuses an archived gym with 409
      `org_archived` (tested), so the SERVER half of "suspend" is a one-column
      write; what is missing is the surface and the authenticated identity to
      perform it from. **"Mark this gym as paid" is still wanted and still owed** —
      it is what a hand-invoiced gym needs once its trial ends — but it is no
      longer the thing standing between a gym and its first 30 days.
      **ORIGINAL FIRST SLICE, approved by Kd 2026-08-25: "mark this gym as paid"** — it
      writes the `subscriptions` row a hand-invoiced gym needs, which turns the
      seat cap, the 30-day trial and §4.2's banner from correct-but-inert into
      live, with no payment provider involved. Carries :11072's approval gate
      with it. **Every write here is audit-logged (Part 8 §97) and the panel
      needs its own authentication story — it is NOT a privilege on
      `gym_staff`.**
      **IT ALSO OWES A CONTACT CHANNEL, AND SOMETHING IN THE APP ALREADY POINTS
      AT ONE THAT DOES NOT EXIST** (T3 round 2 Low-4, and the round before it
      recorded this as done when it was not — the claim reached four documents;
      `git show` of that commit's `OWED.md` diff contains only the lock block).
      `PATCH /v1/orgs/:gymId`'s 409 tells a gym *"Contact us and we'll move it
      for you"* when its country would change the currency it is billed in.
      **Not a falsehood** — Kd approves every gym by hand at this scale (:11072)
      and both Stripe and Paddle treat a currency move as a support request — but
      **the app sends no email and has no contact page**, so an owner reading it
      has nowhere to go. **Two things close it together: the panel gains the tool
      that performs the move, and the sentence names the real channel** (whatever
      it turns out to be — an address, a form, a WhatsApp number). Until then the
      sentence stays, because a refusal naming no way out is worse than one
      naming a way out still being built.
- [ ] ⚪ **`db.migration.test.ts` LEAKS A GYM ROW EVERY RUN AND NEVER CLEANS UP,
      AND THE LEAK IS BIGGER ON KD'S NEON BRANCH THAN ON THE LOCAL DATABASE.**
      Found out-of-diff by T3 round 2 (R1.1 — reported, not fixed in a fix
      round). Its uniqueness fixture inserts `uq-gym-<Date.now()>` rows and
      deletes none: **59 had accumulated locally since 2026-08-21, and a
      read-only count of the Neon branch the same day found 102 rows named
      "UQ Gym"** — every one of them junk beside Kd's four real test gyms.
      **Harmless in itself and NOT harmless in aggregate**, for three reasons
      that are each worth more than the tidiness: they are what made the
      mass-write Critical's blast radius visible at all (59 canaries destroyed);
      they inflate every "how many gyms" figure anyone reads out of either
      database; and `/v1/orgs/mine` truncates at 100, which the Neon count has
      already passed. **Fix is a cleanup in that suite's own teardown**, matching
      what `orgs.routes.test.ts` already does by slug and by owner.
      **AND THE LOCAL TABLE IS CURRENTLY FLATTENED, WHICH BLINDS THE NEW
      MASS-WRITE GUARD — measured 2026-08-26, all 63 local rows carry
      `Orgs Test Edit Authz Renamed | Dibrugarh`**, the payload O114 wrote while
      the round-2 Critical was being reproduced. That guard compares rows before
      and after a sweep, so on an already-uniform table O114 writes identical
      values, nothing changes, and it reports "rows unchanged" — true, and
      misleading if read as "O114 is safe". **It catches the FIRST mass-write and
      cannot re-alarm on a table already destroyed.** Deleting the junk rows
      restores the guard's sight as well as the counts; nothing real is in them
      (every one is a `uq-gym-*` leak or a test leftover). Kd's Neon branch is
      NOT in this state — verified 108 rows, zero test names, his own gyms
      intact.
      **ROUND 3 UPDATE — the "clean it and the next sweep exits 4" trap is
      CLOSED, so this line is now only about the leak.** The reviewer measured
      that a sweep containing O114 and a working guard were mutually exclusive:
      exit 4 on a healthy table, blind on a flattened one, which meant cleaning
      these rows guaranteed the next sweep would fail and re-flatten them. The
      guard now ATTRIBUTES row changes to the mutant that made them and O114
      declares `writesRows`, so its own damage is reported by name and is not an
      alarm. **Cleaning the junk rows is now safe and is what this line asks
      for.**
- [ ] ⚪ **THE MUTATION HARNESS DIES ON A RAW NODE STACK WHEN A FILE WRITE HITS A
      TRANSIENT WINDOWS SHARING VIOLATION.** Found out-of-diff by T3 round 3 and
      **reproduced three times across two sessions**: `writeFileSync` on
      `modules/orgs/repo.ts` raises `UNKNOWN (errno -4094)` immediately after the
      previous mutant's restore, and the harness exits with a Node stack instead
      of an `abort()`. **The tree was verifiably clean every time** — the open
      FAILED, so nothing was written, and both exit handlers ran — but the
      operator sees a crash with no "nothing was mutated, the tree is clean"
      reassurance and no retry, which is indistinguishable from the harness
      having wrecked something. Predates this card (`:2025`). **Fix: wrap the
      mutation write in a short retry, then `abort()` with the usual
      reassurance.** Cheap, and it belongs with the other harness Lows.
- [ ] ⚪ **`GET /v1/orgs/:gymId/codes` IS CAPPED AT 100 AND HAS NO CURSOR**
      (T3 round 1 L-1, 2026-08-18). Added as a BOUND, not as pagination — it was
      the only list in the orgs module without one while `/mine` is capped and
      the roster is keyset-paged. Unreachable today, since a gym has exactly one
      code and it is minted with the gym; **`POST /codes` is already owed and a
      gym running one code per class could pass 100.** Whoever builds that owes
      the cursor, and the roster reader next door is the worked pattern.
- [ ] 🟡 **THE `manager` ROLE IS ENFORCED BY CODE NO TEST HAS EVER RUN AS A
      MANAGER** (T3 round 1, reviewer's Done-gate note, 2026-08-18).
      Grep-verified: `manager` appears in ZERO api tests. Part 3 §8's slice-A
      gate asks that every §2.2 permission be enforced by an API test rather
      than by hidden UI, and owner and trainer both have one — manager has
      none, on the shared `requireStaff` path both of the others exercise.
      **No route creates a manager row**, so the fixture cannot be built without
      the staff routes, which is why this rides the §2.2-matrix line above — but
      the TEST gap itself had no line anywhere and now has one, so the card that
      builds staff management cannot close without noticing it.
- [ ] 🟡 **PER-STAFF PRIVILEGE TICKS ON TOP OF THE THREE ROLES — Kd ruling
      2026-08-19 (DECISIONS :11429), an ADDITION to §2.2's fixed matrix.** His
      words: *"Owner · Manager · Trainer staff , and the privileges ticked per
      staff member also needed"*. The role picks the STARTING ticks; **the ticks
      are what the server enforces.** Roles and their CHECK constraint are
      untouched.
      **THE SEAM IS CHEAP NOW AND EXPENSIVE LATER, measured: ONE function and
      TWO call sites** — `orgs/service.ts:219 requireStaff(..., allowedRoles[])`
      at `:244` and `:296`. **Any new route that checks a role NAME re-opens
      this**; the check to write is "holds privilege X".
      **Catalogue** = §2.2's rows (with **privacy as its own tick** — a manager
      gets settings but not privacy) + **confirm a join application**
      (:11072/:11385) + **roster import** (:9809/:9870).
      **RULE THAT CLOSES A HOLE THIS RULING OPENS: the last owner cannot be
      ticked out of billing or staff management.** §4.7 blocks last-owner
      REMOVAL and says nothing about ticks, which achieve the same lockout by
      another door — without this a gym locks itself out and only we can let it
      back in. Also binding: only an OWNER changes ticks · ticks may widen as
      well as narrow · **UI hides, the SERVER enforces** (a greyed control over
      a live route is the defect, R3.3) · every change audit-logged ·
      **a tick is not a SCOPE** — trainer *assigned/group only* is the group
      axis and is still blocked on the missing group column (line above);
      conflating them hands a trainer the whole roster.
      **Needs a MIGRATION** (`gym_staff` stores no privileges) and the plan must
      flag it (R0.2). **K4 calls to ratify, not re-derive:** store the EFFECTIVE
      set as a snapshot rather than a diff against the role template (a template
      edit must never silently widen ten people's access; the cost is that
      default changes do not retro-apply), and decide table-vs-JSONB against
      R4.2 at the card. ~~**A fourth FRONT-DESK role was recommended against and
      not taken** — it guards a till we do not have, and ticks make it
      unnecessary; revisit only if attendance and product sales make a standard
      receptionist bundle worth naming.~~
      **KD AMENDED THIS 2026-08-22 AT THE STAFF SCREEN'S SMOKE (DECISIONS
      :14745): CUSTOM ROLE NAMES *AND* THE TICKS — *"now want custom role names
      instead of ticks. want both"*.** The struck sentence above is his own
      rejection of a fourth role, overruled by him in the additive direction.
      **IT IS ONE FEATURE AND A LABEL, NOT TWO, and the build order follows from
      that: no route in the product checks a role NAME** (:11891 converted the
      seam; :14262's four staff routes enforce the `staff.manage` TICK), **so a
      custom role is a NAMED PRESET OF TICKS** — ticks are the substance,
      `owner|manager|trainer` become three presets rather than three special
      cases, and a card that builds names before ticks has to invent an
      enforcement model that already exists. **Second migration cost, measured:**
      `gym_staff.role` is `text` NOT NULL under
      `check("gym_staff_role_check", role IN ('owner','manager','trainer'))`
      (`db/schema/tenancy.ts:213,218`), so custom names cannot live in that
      column as it stands. §2.2 is a FIXED three-role matrix, so this is an
      ADDITION with no governing § (:9809's class) and must be presented as one.
      **All six safety rules above still bind** — and rule 2 (the last owner
      cannot be ticked out of billing or staff management) matters MORE now, a
      custom role being a new way to hand somebody an incomplete set.
      **UPDATE 2026-08-22 (DECISIONS :15381) — THE TICKS HALF IS BUILT ON THE
      SERVER. THIS LINE DOES NOT TICK: the SCREEN and the NAMES are both
      unbuilt.** Kd approved a three-step split — ticks · the Staff screen's tick
      boxes · custom role names — and step 1 shipped: storage (migration `0013`),
      the owner-only route, the seam reading the stored set, the last-owner
      guard, audit rows both ends, and a role change resetting the ticks.
      **KD SETTLED THE SNAPSHOT-vs-NAMED-ROLE QUESTION the same day and the
      NAMES card inherits the consequence:** editing what a named role may do
      changes **nobody** on its own — the owner is offered *"Change everyone on
      Front Desk too?"* and taps it. **That button is the names card's to build**
      (a batch write over one gym's staff rows, no further migration), and it is
      recorded here because the ruling that produced it lives on a line that has
      now ticked.
- [x] 🟡 **DONE 2026-08-22 — THE ROSTER DOES NOT SAY WHICH MEMBERS ARE FREE — a staff member takes
      no seat and looks exactly like somebody who pays for one (Kd's finding at
      the staff re-smoke, 2026-08-22, DECISIONS :14953).** His words: *"when a
      member is added as a staff there badge should also show complimentary and
      like owner should not occupy gyms member space"*.
      **THE SECOND HALF IS ALREADY TRUE AND WAS VERIFIED, NOT ASSUMED**: `claimSeat`
      counts live members `AND m.complimentary = false AND NOT EXISTS (SELECT 1
      FROM gym_staff …)`, so staff have consumed no seat since :14401's C/H-1.
      **The first half is the gap**: `Members.jsx` draws its "Complimentary" badge
      off `gym_members.complimentary`, which is deliberately NOT written for staff,
      so the screen and the door disagree about who costs money and an owner
      cannot see which seats are free.
      **THE FIX MUST NOT BE TO WRITE `complimentary` FOR STAFF — that is exactly
      the defect :14401 C/H-1 removed** (the column means "did not JOIN", and
      three readers act on it: `joinedCount`, the join door's `max_uses` gate, and
      `orgCodeSchema.joined`). The roster response needs a SEPARATE derived field
      meaning "this person takes no seat", computed the same way the door computes
      it, and **anchored by a test that drives both** so the screen and the cap
      cannot drift (:14013's six-site precedent).
      **It widens `/v1/orgs/:gymId/members`, whose key set is asserted EXACTLY by
      a §2.4 test on purpose** (:10010), so the addition is argued at the card, not
      waved through — and a staff flag on a roster row is a §2.4 question in its
      own right, since it tells the gym something about a person.
      Server half plus web half; not built at the staff card (R1.1, and the packet
      was mid-review-round).
      **BUILT 2026-08-22 (DECISIONS :15093) — THIS LINE DOES NOT TICK YET.** The
      roster carries a derived `takesSeat` computed by `claimSeat`'s own count
      rule, anchored by a test driving the badge and the cap together, and the
      badge is drawn for anybody whose place is free. `complimentary` was NOT
      written for staff.
      **SMOKE PASSED 2026-08-22, "all passed", on his own gym against live data
      (DECISIONS :15187)** — including the control that an ordinary member is NOT
      badged, and that the join-code count does not move on a promotion. He ran a
      **7-step compressed version typed in chat**, not the 8-step sheet; sheet
      step 2 was swallowed by the compression and is named as unrun rather than
      counted (T3 L-4).
      **T3 ROUND 1 RAN: ZERO Critical/High — THE PACKET SHIPS (DECISIONS :15259).**
      Six Low, all fixed in the round. **This line ticks on the commit.**
- [ ] 🟡 **`gym_staff.privileges` IS NULLABLE AND SHOULD NOT STAY THAT WAY — the
      CONTRACT half of expand-then-contract (deferred 2026-08-22, DECISIONS
      :15381).** Migration `0013` adds the column nullable and backfills every
      existing row, and both writers fill it in, so **no row is NULL today**
      (measured: the backfill's own `WHERE` found 2 rows on the dev database, and
      a fresh database creates none). The nullability exists for ONE window: the
      minutes between the migration landing and the new code deploying, where
      OLD code still inserts staff rows without the column — a NOT NULL there
      would break CREATING A GYM, not merely appointing somebody.
      **Why it matters that this closes:** while the null branch exists,
      `privilegesFor` falls back to the ROLE's template, so a later edit to
      `ROLE_PRIVILEGES` would reach any row that slipped through — **the silent
      widening Kd ruled against on 2026-08-22**, bounded to a deploy window
      rather than shut. Closing it is one migration (`SET NOT NULL` after a
      re-run of the same idempotent backfill) plus deleting the fallback branch
      and its test. **Do it AFTER the deploy that carries this code, never in the
      same one** — that ordering is the whole point of the rule.
- [ ] 🟡 **THE LAST-OWNER LOCKOUT GUARD COVERS ONE PRIVILEGE AND :11429 NAMES TWO
      — BILLING IS MISSING BECAUSE IT DOES NOT EXIST YET (deferred 2026-08-22,
      DECISIONS :15381).** Rule 2 says the last owner cannot be ticked out of
      **billing or staff management**; `LAST_OWNER_REQUIRED_PRIVILEGES` in
      `modules/orgs/service.ts` holds `staff.manage` alone, because there is no
      billing tick in `ORG_PRIVILEGES` and inventing one would be R0.2's
      forbidden shape (a tick nobody enforces).
      **The trap this line exists to stop:** the day a billing privilege is
      added, adding it to `ORG_PRIVILEGES` and the database CHECK is the obvious
      work and adding it to the lockout list is the part that gets forgotten —
      after which an owner can tick away their own billing access and no one
      inside the gym can restore it. It is a ONE-LINE change and it belongs in
      the SAME commit that creates the privilege. The guard is already written as
      a LIST for exactly this reason.
      **WIDENED 2026-08-22 by T3 round 1 (DECISIONS :15534): there are now TWO
      lists and billing belongs on BOTH.** `OWNER_ONLY_PRIVILEGES` is what stops
      an owner-only power being handed to a manager at all — the round's
      Critical/High — and `LAST_OWNER_REQUIRED_PRIVILEGES` is what stops the last
      owner losing it. §2.2 puts money and staff in the same owner-alone row, so
      a billing tick that lands on neither list is the escalation and the lockout
      at once.
- [ ] ⚪ **THREE MUTATION ANCHORS MATCH TWICE AND LAND RIGHT ONLY BY POSITION
      (O17, O29, O89 in `mutate-orgs.mjs`; found by the census T3 L-1 prompted,
      2026-08-22, DECISIONS :15259).** The pre-check now REFUSES an ambiguous
      anchor — the improvement :14493 named and never built — but these three
      pre-date it and sit in an explicit `AMBIGUOUS_ALLOWED` allow-list so the
      guard could be turned on at all. **Each still mutates its intended line,
      because `String.replace` takes the first occurrence and that happens to be
      the right one; what is missing is any PROOF that it does.** O29 and O89 are
      the `getStaffRole`/`listStaff` pair that deliberately hold identical SQL
      text (:14493 Low-2), so re-anchoring means finding a line unique to each
      function — the same job O88 took in that round. **The list may only ever
      shrink**; closing this empties it and deletes the allow-list.
- [ ] ⚪ **A TRAINER AND A MANAGER CAN NOW WORK OUT WHO HOLDS THE GYM'S KEYS, AND
      KD HAS NOT BEEN ASKED (T3 L-1 on the badge card, 2026-08-22, DECISIONS
      :15259).** The roster serves `complimentary` and `takesSeat` together, and
      `complimentary === false && takesSeat === false` means exactly "this person
      is staff here" — an exact inference, not a guess. Both roles hold
      `members.read`; only the owner holds `staff.manage`, which is what gates the
      staff LIST, so the two roles the server answers 403 can derive it from the
      roster instead. **Accepted at the card and recorded rather than reversed**:
      §2.4's never-see list is member health and personal data, none of which
      moves, and what a colleague learns is a role inside their own gym.
      **Do NOT close this by withholding `takesSeat` from trainers** — that hands
      them back the defect the card removed (a staff colleague drawn as occupying
      a paid place), i.e. trades a disclosure for something FALSE on screen, and
      :5807 outranks a tidier boundary. If Kd wants it hidden it is his ruling and
      needs its own card, with the trade named to him first.
- [x] 🟡 **DONE 2026-08-22 — KD RULED IT: NOTHING CHANGES ON ITS OWN, THE OWNER
      TAPS A BUTTON.** Asked in plain words at the per-staff ticks card with a
      recommendation, as this line required, and he chose the recommended
      answer: editing what a named role may do changes **nobody** by itself;
      the owner is offered *"Change everyone on Front Desk too?"* and decides.
      **So :11429's SNAPSHOT stands and the propagation is an explicit ACT** —
      the third option this line named, and the only one that is neither a
      silent widening nor a rename that visibly does nothing.
      **WHAT THE RULING NOW OWES, and it is tracked on the ticks line above
      rather than here:** the button itself, which belongs to the custom-role-
      names card (there are no named roles to edit until it lands). The storage
      built on 2026-08-22 makes it a batch write over one gym's staff rows and
      needs no further migration. Ruling recorded at DECISIONS :15381.
      **The question as originally raised follows, kept whole rather than
      rewritten — the reasoning is what makes the ruling legible later.**
      **A NAMED ROLE AND A SNAPSHOT CONTRADICT EACH OTHER, AND KD HAS NOT BEEN
      ASKED (raised 2026-08-22 by his own "want both" amendment, DECISIONS
      :14745).** :11429 ruled the effective privilege set is stored as a
      **SNAPSHOT**, so editing a template never silently widens ten people's
      access. **A NAMED role invites the opposite expectation**: an owner who
      edits "Front Desk" will expect everybody on Front Desk to change, and
      snapshot-plus-a-visible-name is a contradiction *a user can see* — they
      rename or re-tick a role, nothing moves, and nothing on screen explains
      why. **Neither answer is obviously right** (retro-apply is the intuitive
      one and is exactly what the snapshot rule exists to prevent; a third option
      is to apply forward and offer "update everyone on this role" explicitly).
      **The per-staff privilege card must PUT THIS TO KD rather than pick one**,
      and it cannot be settled by a chat (R0.2). Closes with that card.
- [ ] ⚪ **THE CONSOLE'S ANALYTICS EVENTS ARE NOT EMITTED.** Part 3 §4.0 names
      `org_created{type}`, `org_trial_started`, `org_logo_added`,
      `org_poster_downloaded` and the TTFMJ timer; `gym_code_redeemed` is
      already in the `analytics.ts` taxonomy and unused. **Consistent with the
      rest of the API — no module emits a single event today** (grep-verified),
      which is itself the thing to fix, one card, rather than one module
      quietly starting. TTFMJ is the metric Part 3 says predicts everything
      downstream, so this is worth more than it looks.
- [ ] 🟡 **THE OVERVIEW HAS NO NUMBERS: Part 3 §4.1's KPI tiles, the 8-week
      trend chart and the at-risk list are all UNBUILT (deferred with the console
      screen, 2026-08-18).** §4.1 specifies active members (30d) with a 7d
      sub-stat, workouts this week, adoption %, average form score, a
      bars-plus-line eight-week chart, and the top-5 at-risk list with a one-tap
      nudge. **§3.2 says every one of them reads `org_daily_stats`,
      `org_live_counters` or `org_member_stats` — and not one of those three
      exists**: no table, no Redis key, no view, no worker building them, no
      route serving them. A tile drawn over that would print a number nobody
      computed, which is :5807 on its face, so the screen shows what is true
      instead (the gym's identity, its live join code, its member count) and
      says nothing about activity. **Closed by the rollup card**, which owes the
      nightly worker keyed on `gyms.timezone` (§3.2) before any of these tiles
      can be honest. The at-risk nudge also needs push, which does not exist.
      **AMENDED 2026-08-31 BY KD (DECISIONS :26469) — THREE THINGS, and they
      change what this line owes.** (a) **The average-form-score tile is NOT
      built** — *"average form score not needed"*; the nightly job still WRITES
      `avg_form_score`/`scored_sets`, because an unrecorded history cannot be
      recovered, so this is scope on a new screen and not a removal. (b) **Every
      figure counts only people who were PRESENT AT THE GYM** — §2.1's membership
      interval plus an attendance row — so **this line is BLOCKED on the
      attendance card** and cannot start before it. (c) **A "trained anywhere"
      count is NEVER shown**; the chat's offer to display both was rejected.
      `org_daily_stats` still has no writer as of this line.
      **UNBLOCKED 2026-09-02: the attendance card CLOSED** (`bcf0586`,
      DECISIONS :29870), which is the condition (b) named.
      **AND KD RULED FOUR MORE THINGS AT THIS CARD'S OWN PLAN GATE THE SAME DAY
      (DECISIONS :29961), which change what this line owes again.**
      (d) **THE TILES COUNT VISITS, NOT WORKOUTS** — a knowing DEVIATION from
      §4.1 put to him and accepted (R0.3): **visits this week · members who came
      in 30 days · adoption %**. A workout exists only if a member ALSO logged
      their training, so a workout tile can read zero on a day forty people came
      through the door. **Nothing stops being recorded** — the workout-side
      columns are still written nightly, on :26469 §1.1's own reasoning.
      (e) **A WORKOUT COUNTS FOR A GYM ON THE SAME GYM-DAY AS THE VISIT** —
      :26469 §6's fifth question, which :27900 withheld from the attendance gate
      and sent here. Live membership covering that day AND an attendance row at
      that gym on that day. The rejected arm (*"within N hours"*) needed a
      constant nobody ruled (R0.2). **Cost he was shown before choosing: a
      morning tap plus an evening workout AT HOME counts for the gym.**
      (f) **THE CARD IS SPLIT, numbers first and the people lists second** —
      his call, shown the cost of one card carrying both. **This line now owes
      the NUMBERS half only**; the lists have their own line below.
      (g) **THE AT-RISK LIST AND ITS NUDGE MOVE TO THAT SECOND CARD.** The list
      is buildable there (it names who to call); the NUDGE BUTTON stays blocked
      on push, which does not exist.
      **THE BUILD PLAN IS `CARD-gym-overview-numbers.md`, APPROVED BY KD
      2026-09-02** (*"approve"*), migration `0020` reviewed as SQL first.
      **⚙️ THE SERVER HALF IS BUILT — DECISIONS `:30094`.** Migration `0020`
      (`visits`, `visitors`, read back out of `information_schema` after
      applying) · `modules/orgs/rollup.ts` on a FIFTH `rollups` scheduler at
      `15 * * * *`, rolling each gym when its OWN clock reads 02 ·
      `tools/orgs-rollup.ts` · `GET /v1/orgs/:gymId/overview` on
      `attendance.read`. PROVE and the 11-mutant sweep at that entry.
      **⚙️ THE WEB HALF IS BUILT TOO — DECISIONS `:30399`.** Three tiles, the
      8-week chart and the four empty states on the console's Overview
      (`OverviewNumbers.jsx`, `overviewView.js` pure beside it).
      **AND KD LOOKED AT IT THE SAME DAY, WHICH FOUND A Critical/High NOTHING IN
      THE SUITE COULD SEE** (`:30624`): *"Today · 1 person"* drawn beside
      *"Last 30 days · 0% — 0 of 2 members came"*, both figures CORRECT — the
      visitor held a free owner's seat, which the share excludes at both ends —
      and the two together reading as a screen contradicting itself. Fixed with
      a sentence that appears only when they disagree; both numbers still draw.
      The chart was redesigned in the same commit, and *"too simple"* was also a
      correctness finding: a zero-height bar draws NOTHING, so seven quiet weeks
      rendered as seven weeks that never happened.
      **AND HE LOOKED AGAIN AFTER MARKING HIMSELF IN, WHICH FOUND TWO MORE**
      (`:30733`): a visit made when the gym was SHUT counted as an ordinary
      visit, with nothing on screen saying so — the member's own screen had told
      him the truth — and the numbers linked NOWHERE, while the Attendance
      screen has held the names and times since `:29250`. Both fixed: the odd
      arrivals are named above the list, and the panel now reaches Attendance.
      **AND HE OPENED IT A THIRD TIME AFTER MARKING HIMSELF IN, WHICH PRODUCED
      A RULING AND SIX DESIGN CHANGES** (`:30867`): visit counts off the
      dashboard, `visited 2 times` beside the name on Attendance, the
      odd-arrival line removed, "The day" collapsed to a dropdown, the initials
      circles gone, and **the chart drawn only once there is a week to compare
      against** — his *"random fat ass box"* was arithmetically correct and a
      one-column chart all the same.
      **AND A FOURTH AND FIFTH PASS THE SAME DAY** (`:31008`, `:31098`): the
      chart came back after I removed it in answer to a question, gained a
      minimum visible bar so a week with one visit stops drawing as a week with
      none, and had its bars un-stretched — Kd's screenshot showed a 26-unit bar
      rendering ~84px wide under `preserveAspectRatio="none"`. **The member's
      EMAIL is now visible to the gym by his ruling**, with the join door's
      disclosure changed in the same commit.
      **THIS LINE STILL DOES NOT TICK: no smoke has run on this version and T3
      is UNRUN. The smoke sheet is STALE — it was written against tile wording
      and a chart that no longer ship.**
      ~~Also owed with it: the one-off backfill
      (`tools/orgs-rollup.ts --all-hours --days=70`) against the branch Kd's
      browser reads — until it runs, that gym's chart is eight empty weeks.~~
      **— THE CONSEQUENCE IS FALSE AND WAS FALSE THE DAY IT WAS WRITTEN. The
      backfill writes `org_daily_stats`; the chart reads `gym_attendance` LIVE
      (:30094 §2.1's own correction), so an unrun backfill changes NOTHING a
      person can see.** Re-measured 2026-09-03 while building the web half: one
      `INSERT INTO org_daily_stats` in the whole repo and no `SELECT` at all,
      outside schema files, comments and the privacy list. **The sentence is a
      survivor of the plan the same commit corrected** — §4a.4 said the chart
      summed the nightly table, writing the query proved it could not, and this
      instruction was left pointing at the old design in four documents. **The
      backfill is STILL OWED and is still worth running** — it is the durable
      record Reports will read — **but it is NOT a smoke prerequisite and must
      not hold one up.** :7298's class: a sentence that outlived the condition
      that raised it.
      **AND ONE THING NOBODY MAY READ INTO IT: `org_daily_stats` now has a WRITER
      AND STILL NO READER.** The Overview's figures are read LIVE from
      `gym_attendance`, because a distinct count cannot be summed across days and
      a nightly table is partial for part of every day (:5807). The aggregate is
      the durable record — Reports' source, and what survives the day
      `gym_attendance` becomes deletable under DPDP, which is when the chart's
      source moves onto it.
- [ ] 🟡 **THE GYM'S OVERVIEW HAS NO PEOPLE LISTS — the second half of the
      dashboard, split off at Kd's own instruction 2026-09-02 (DECISIONS
      :29961 ruling 3).**
      **⚙️ ONE OF THEM SHIPPED EARLY, 2026-09-03, AT KD'S OWN INSTRUCTION
      (`DECISIONS.md:30733` §4): "who came today" is ON the Overview** — a
      preview of five, name and a chip per visit, above a link to the full day —
      because he asked what a gym does with a count it cannot open. **The TIMING
      moved, not the design: this line already described exactly that.** The rest
      is untouched and still owed. Owed: ~~**who came today**~~ (names and times, a summary
      linking to the Attendance section that exists) · **when they come**
      (visits per opening session, off `gym_attendance.slot_key` and the stored
      session window — the staffing number) · **on a roll** (members on an
      attendance streak, beside the cheer below) · **slipping away** (§4.1's
      at-risk list, redefined onto VISITS per :26469 rather than the spec's
      workouts-anywhere) · **this week's roster** (joined · left · still
      waiting) · **§5.1's activation checklist**. **Not started, no document
      yet** (`CARD-gym-overview-people.md` when it is written). **THE TRAP THAT
      MUST TRAVEL WITH THIS LINE: `org_member_stats` (the view, unread since
      `0001_init`) counts workouts ANYWHERE**, which :26469 §1.3 forbids showing
      a gym — it is the obvious thing to reach for on exactly these screens.
      **And every count comes from the SERVER** (:27992 §3, :29250).
- [ ] 🟡 **A GYM CANNOT CHEER A MEMBER ON — Kd's own addition at the
      overview-numbers gate, 2026-09-02 (DECISIONS :29961 ruling 4), tracked
      NOWHERE before this line (grep-verified).** His words: *"if some mebers
      comes to gym reguraly and maintains a continous streak the gym can send
      inpiring things like emojy short message etc"*. **RULED: an emoji plus a
      READY-MADE line, ONE TAP, capped at one per member per week. NO free-text
      box** — the "let the owner type" arm was costed (length cap · rate limit ·
      a report path · an operator view of what was sent) and refused, agreeing
      with his own PACT ruling (:18128, *"no free text ever"*) for a different
      reason. **BUILT IN THE PEOPLE-LISTS CARD, beside "on a roll".**
      **THE FACT THAT SHAPES IT: nothing in this product SENDS anything** — no
      mailer, no SMTP, no notifications table (measured 2026-09-02). So a cheer
      is **STORED and read on `My Gyms`** (:28822), the shape `nudgeApplication`
      already uses, and it becomes a real push for free at stage 6 with nothing
      rebuilt. **A card that promises a member will be NOTIFIED is promising a
      channel that does not exist.**
- [ ] ⚪ **`org_live_counters` IS NOT BUILT and the Overview reads "today" live
      from Postgres instead (chat's call at the overview-numbers gate,
      2026-09-02, with its cost stated).** Part 3 §3.2 specifies a Redis key with
      a 5-minute TTL for today's tiles. The card reads the count live against
      `gym_attendance_gym_day_idx`, which is **EXACT rather than up-to-five-
      minutes stale**, at one indexed count per page load. **A cache is a
      performance answer to a load nobody has measured, and a stale "today" tile
      is a number that is wrong on screen (:5807).** Revisit when a real gym's
      load exists — not before, and never by making the tile stale to save a
      query nobody has timed.
- [ ] 🟡 **THE §4.0 WIZARD IS ONE STEP OF SIX: size/plan/trial, logo upload,
      team invites and the QR poster PDF are all UNBUILT (deferred with the
      console screen, 2026-08-18).** Built: step 1 (name · city · org type ·
      country · timezone) and step 4's code reveal, which the server does in the
      same transaction. **Not built, each because it has no endpoint at all:**
      step 2's member-count slider → seat tier → 7-day trial (billing does not
      exist, and the tier sizes are unratified US pricing, :9944) · step 3's
      logo upload (no R2 bucket configured, and R3.9's five upload guarantees
      would have to be built) · step 5's invite-your-team (no staff route —
      see the §2.2 matrix line above) · step 4's QR poster PDF and WhatsApp
      share (a worker job with no worker). **§4.0's own metric, TTFMJ, is
      instrumented nowhere** — see the analytics line below.
- [ ] ⚪ **THE ORG'S `locale` IS NOT COLLECTED BY THE WIZARD (deferred with the
      console screen, 2026-08-18).** Part 3 §4.0 step 1 lists it; the create
      schema accepts it and defaults it to `"en"`. It is omitted from the form
      because **nothing reads the column**: §2.2's vocabulary overrides and the
      bilingual poster are the two consumers and neither is built, and the
      market is now US gyms (:9604 §2), so a picker offering en/hi/as today
      would be a control with no effect. **Closed by whichever card first makes
      the org's language change something a user sees.**
- [ ] 🟡 **~~FOUR~~ THREE OF THE CONSOLE'S SIX SECTIONS HAVE NO SCREEN:
      Leaderboard, Reports, Billing ~~, Settings (+ Staff)~~ (deferred with the
      console screen, 2026-08-18).** §3.1's nav lists six; the shell renders the
      ones that exist and the rest are ABSENT rather than greyed out — a disabled
      tab that answers nothing is still a promise on screen. Their server sides
      are owed elsewhere: leaderboards at P4.x, `org_daily_stats` for reports (the
      line above), billing at P3.
      **✅ SETTINGS IS DONE — ALL THREE GATES BEHIND IT (2026-08-22).** Built at
      :14570; **SMOKE complete** — 12/12 plus steps 9 and 11 re-run on the shipping
      bytes after the removal control was rewritten (:14953); **T3 round 1 found
      two Critical/High, both fixed (:14840), and round 2 (diff-only) found ZERO
      Critical/High, which is the severity gate's own shipping condition**
      (:15007). Commits `971836d` · `ba7bd13` · `2e5500e` · `a5ef49c` and the
      round-2 fixes. **THIS TICKS THE SETTINGS/STAFF CLAUSE OF THIS LINE AND
      NOTHING ELSE** — Leaderboard, Reports and Billing keep the line open, and
      the §2.2-matrix line below is UNTOUCHED by this (RESTORE a member, CSV
      export and nudges are still routeless, and staff management ships only its
      ROLE half).
      **SETTINGS SHIPPED 2026-08-22 (DECISIONS :14570) AND CARRIES §4.7's STAFF
      LIST — but it is drawn for the OWNER ONLY**, because the one thing on it is
      §2.2's owner-only row and the server gates even the READ with it, so for a
      manager or a trainer the tab would open onto a refusal. The condition is
      `canManageStaff`, so the tab widens by itself the day Settings grows a
      section a manager can use — a different question rather than a forgotten
      one. **§4.7 lists FIVE things under Settings and this ships ONE**: Profile,
      Notifications and Privacy have no server side at all (Profile's gap has its
      own new line below); Codes are deliberately NOT moved here — Kd's join-code
      card put them on Overview under the code an owner hands out, and moving them
      would be a removal from the screen a ruling put them on, so Settings points
      at them instead.
      **§4.2's banner slot is unbuilt for the same reason** — every one of its
      states (trial, trial-urgent, grace, past-due, seat pressure) is read off
      `subscriptions`, so today the banner would have nothing to say and no way
      to know it.
- [ ] 🟡 **A GYM CANNOT CHANGE ITS OWN NAME, CITY, TIMEZONE OR CURRENCY AFTER IT
      IS CREATED — everything the wizard asks is written once and can never be
      corrected (raised 2026-08-18 at DECISIONS :10606, tracked NOWHERE until
      2026-08-22; grep-verified across `OWED.md` before adding).** Measured, not
      recalled: the orgs module exposes nineteen routes and **not one of them is a
      `PATCH /v1/orgs/:gymId`** — a gym's own row is insert-only after
      `createOrgAttempt`. :10596's C/H-1 named the currency half of this while
      fixing the wizard's preselected United States, in prose, and prose is how
      work gets silently lost — which is what the deferral rule exists to stop.
      **The cost is not cosmetic.** `gyms.timezone` is what the rollup worker uses
      to decide when a gym's day ends (trap #8), so a gym set up in the wrong zone
      has its day boundaries wrong for ever; `currency_display` is what a gym is
      billed in and Kd ruled it follows the gym's LOCATION (:10099), which a gym
      that moves cannot act on; and a typo in the name is on every screen the
      owner shows a member. **The slug is deliberately NOT part of this** — it is
      minted once against `RESERVED_SLUGS` and a gym named "New" already collides
      with the console's own create form (:10596 L-2), so renaming the address is
      a separate and harder question. **Settings is the screen this belongs on and
      it now exists** (2026-08-22, DECISIONS :14570) — the screen is no longer the
      blocker, the route is.
      **UPDATE 2026-08-26 — THE SERVER HALF IS BUILT AND THIS LINE STAYS OPEN.**
      `PATCH /v1/orgs/:gymId` exists, gated on the `org.manage` privilege Kd
      approved that day (migration `0014`); name, city, country and time zone are
      all editable and the currency follows the country server-side. What holds
      the line open is that **no screen calls it** — the same shape as :13803 and
      :14262, where an endpoint with no caller ticks nothing. The web half is the
      next card and carries the SMOKE. T3 is UNRUN.
      **UPDATE 2026-08-26, SAME DAY — THE SCREEN IS BUILT AND THIS LINE STILL
      DOES NOT TICK** (DECISIONS :20075). Settings now carries a **Gym details**
      form: name, city, country and time zone, with the currency shown and not
      editable, sending only the fields that actually changed. **What holds it
      open now is the GATES, not the code.** **The slug is still deliberately NOT
      part of this** and the currency is still never client-settable.
      **UPDATE, SAME DAY AGAIN — THE SMOKE PASSED AND T3 IS NOW THE ONLY THING
      HOLDING THIS LINE** (DECISIONS :20222). Kd ran it on the shipping bytes
      (`7236093`, `git status` carrying no source change), and **the pass is
      corroborated by the AUDIT ROWS rather than by the report**: five
      `org.updated` rows, **each naming exactly ONE field**, and none mentioning
      the country except the save that changed it — mutant C55's guarantee seen on
      live data. **His FIRST "all passed" covered three steps that were never
      clicked** and the database is what caught it (one row where five were owed);
      asked with both branches named, he answered *"i skipped now it is saved"*
      and ran them. **:14745 twice over.**
      **THREE THINGS THE PASS DOES NOT COVER, and they belong to whoever ticks
      this line:** clearing a city was never done (`city: null` is carried by C58
      and no human) · **step 4 could not have failed on that gym**, whose zone was
      already in the runtime's list, so the alias case it exists for was NOT
      exercised (:15927's step-7 shape; the fixture it needs is a gym whose stored
      zone the browser calls by its other name) · the currency lock stays
      unreachable while nothing inserts into `subscriptions`.
      **T3 IS UNRUN on all six commits in this packet** — a passing smoke is not
      a review (:14147).
      **UPDATE, SAME DAY — SETTINGS' SECTIONS NOW COLLAPSE** (Kd's call at the
      screen, DECISIONS :20338), so this line's screen is two tappable rows
      rather than one long page. **Its rewritten STEP 1 was re-run and PASSED**
      (Kd, on `428bbfb`, tree clean at the time) and steps 2–9 stand on
      `7236093` — **two commits, two runs, recorded as two rather than merged
      into one tick** (:17647's care; what carries 2–9 across the change is
      mutants C67–C71 plus the 32 call sites rewritten to open a section the way
      a person does — 27 staff and 5 gym; **the "33 … and 6" this line carried
      until T3 round 2's Low-2 counted an intermediate state nobody committed,
      and it survived round 1's own correction of the other four copies**,
      :5748's class in the file that was not being edited).
      **SO THIS LINE NOW WAITS ON T3 AND NOTHING ELSE.** Every step on the sheet
      has been run by a person against the bytes it describes.
      **UPDATE — T3 ROUND 1 RAN: ONE Critical/High, FIXED, and the packet did NOT
      ship this round** (DECISIONS :20440). The form never noticed the gym
      changing underneath it and **offered to revert somebody else's change,
      time zone included** — the one permanent thing this screen was supposed to
      be incapable of. Four Low, all fixed, in `BACKLOG.md`. **What holds this
      line now is the DIFF-ONLY ROUND 2** on those fixes; the smoke does not need
      re-running and :20440 says why.
      **UPDATE — ROUND 2 RAN: ONE Critical/High, and it was ROUND 1'S OWN FIX**
      (DECISIONS :20587). Round 1 anchored the time-zone list to the zone the box
      is showing and made that the only thing it follows, so **the zone the gym
      HOLDS left the list the moment an owner picked anything else** — the
      permanent damage this screen must be incapable of, re-introduced by the fix
      for it. **THE ESCAPE HATCH FIRED (both Criticals in one file) and KD RULED
      PATCH** — fourth firing, fourth patch ruling. Two Low, fixed, in
      `BACKLOG.md`; one of them is two surviving copies of round 1's own
      corrected figure, **one of which was in THIS FILE**.
      **UPDATE — ROUND 3 RAN: ONE Critical/High, THE HATCH FIRED A THIRD TIME,
      AND KD RULED PATCH** (DECISIONS :20712). **Gym A's typing followed the
      owner onto gym B and Save wrote it there, time zone included** — on a gym
      they were not editing. The reviewer stopped without proposing a fix, and
      the ruling rests on one fact: rounds 1 and 2 were a fix causing the next
      round's defect, **this one is older than round 1**. The fix is
      `key={org.id}` on both panels, which is a CLASS fix — the panel cannot
      carry state across a gym change for any field, including ones nobody has
      added yet. **The Staff panel had it too and the review did not name it;
      found by probing (:1239).** Four Low, incl. **a test I wrote in round 2
      that could not fail**. **What holds this line now is a DIFF-ONLY ROUND 4,
      and a Critical there would be the FOURTH consecutive round in one file —
      the "not caused by the previous fix" argument would have to be re-made on
      its own evidence rather than inherited.**
      **One thing the smoke still cannot reach, beside the currency lock: a
      section OPENING ITSELF when its data fails.** That needs the staff read to
      fail in a browser and no step sets it up, so it is carried by C68/C69 and
      their tests alone. **The way to close it is a devtools step blocking
      `/v1/orgs/:gymId/staff`** — exactly how :589's nutrition failure path was
      finally observed, and the same class of hole that sheet's own T3 named.
- [ ] ⚪ **EVERY GYM CREATED BEFORE 2026-08-26 HAS NO COUNTRY RECORDED, and no
      honest backfill exists.** `gyms.country` arrived with migration `0014`;
      before it the create wizard collected a country, the server mapped it to a
      currency and threw the country away, so 55 rows on the local database (and
      whatever Kd's Neon branch holds) read back NULL. **Deliberately NOT
      back-filled and this is the citation:** USD/CAD/GBP/INR each invert to
      exactly one row of `COUNTRY_CURRENCY`, so a fill looks exact — but `INR` is
      also `currency_display`'s own DEFAULT, i.e. what a row carries when nobody
      said anything, so the fill would stamp `IN` onto gyms that never chose it;
      EUR is ambiguous twenty ways regardless. NULL means "we never asked", which
      is the only claim true of every row, and :10010/:10099 refuse exactly this
      class of inference about where a gym is.
      **What closes it:** the Settings screen shows the currency (which is what
      actually decides money and is correct on every row) and asks for the
      country when an owner edits; each gym self-heals on its first save. **What
      it costs meanwhile:** the country box on that screen starts empty for an
      existing gym, which is true and not false — :5807 Low by its own test.
      **UPDATE 2026-08-26 — THE SCREEN THAT CLOSES THIS EXISTS NOW** (DECISIONS
      :20075), **and the line stays open because the ROWS have not moved.** The
      form starts the country box empty on such a gym and **says so in words**
      ("we don't have your country on record — this gym was set up before we
      started keeping it"), with the currency it IS billed in named beside it, so
      the empty box does not read as something that failed to load. That sentence
      is guarded in both directions (mutant **C64**): a gym whose country we hold
      must never be told we do not have it. **This ticks when the rows do** —
      each gym on its owner's first save — and there is still no honest backfill
      to hurry it.
- [x] ~~❓ **CAN A GYM CHANGE THE CURRENCY IT IS BILLED IN ONCE IT IS ACTUALLY
      PAYING?**~~ **CLOSED 2026-08-26 THE SAME DAY IT WAS RAISED — KD RULED, and
      the ruling is BUILT, not deferred** (DECISIONS :19366 addendum, commit
      below). **NO: a gym's country — and so the currency it is billed in —
      FREEZES the day it goes on a paid plan.** `PATCH /v1/orgs/:gymId` returns
      409 `currency_locked` — **AMENDED BY T3 ROUND 1 (:19656) AND CORRECTED HERE
      BY ROUND 2's Low-3: it fires only when the new country resolves to a
      DIFFERENT currency, not for "any gym holding a subscription past
      `trialing`", which is what this line said and is over-broad.** A paying gym
      may re-save its own details with the country unchanged (the first version
      refused that whole save — round 1's C/H-1), a pre-`0014` gym may record the
      country it is already billed for, and France → Germany is a 200 because
      both are EUR. **This file is what the billing and admin-panel cards read,
      so the stale name and the stale condition are corrected in place rather
      than left for the diary** (:18830 — a stale record manufactures work).
      **He raised it himself** (*"a gym should not be able to change the country
      as it will create problem of money"*), **asked for a recommendation rather
      than compliance, and refined his own ruling on the evidence**: locking from
      day one was his first instinct; the providers were checked and neither does
      that. **Stripe refuses a currency change once a customer has been invoiced
      once; Paddle — the route ruled at :17366 — refuses a COUNTRY change on a
      live subscription outright, its answer being cancel-and-resubscribe. But
      neither freezes before money has moved**, because a business that mistyped
      its country at signup would be stuck for ever. **The card-less 30-day trial
      (:16548) is deliberately NOT a lock** — it is the moment before the typo
      starts to cost.
      **What the billing card still inherits, and it is NOT a deferral:** the
      guard reads `subscriptions.status`, so Part 5 §3's machine must leave
      `trialing` on first payment for it to bite. That is already what §3
      requires; it is written here so the billing card knows this guard depends
      on it.
- [x] 🔴 **DONE 2026-08-27 (DECISIONS :21157) — THE CURRENCY LOCK'S CHECK-THEN-ACT
      IS CLOSED, BY THE FIRST CARD THAT COULD CLOSE IT.** `startGymTrial` is the
      product's first and only writer of `subscriptions`, and `lockOrgRow` is the
      FIRST statement in its transaction — the same lock and the same order
      (org row → child rows) `updateOrg` already takes, so the two serialise: a
      trial starting while an owner saves the settings form either commits before
      that guard's SELECT or waits behind its UPDATE, and never lands between them.
      **Proven by a two-client concurrency test and by mutant `O127`** (delete the
      lock and the test goes red), because `buildApp` pools at `max: 1` and two
      `app.inject` calls would be serialised by the CLIENT — a test that cannot
      fail (this file's own header lesson).
      **THE REQUIREMENT DOES NOT EXPIRE WITH THIS TICK, and here is where it now
      lives: any SECOND writer of `subscriptions` must take the same lock first.**
      The repo's docblock says so at the statement, `O127` fails the sweep if this
      writer stops, and the billing card inherits both. **A 23505 from
      `subs_one_live_uq` is deliberately NOT caught** — it cannot happen while
      every writer takes the lock, so swallowing it would hide the one symptom of a
      writer that skipped it (R1.3's fail-loudly, pointed at our own future code).
      ~~ORIGINAL TEXT:~~ **THE CURRENCY LOCK IS A CHECK-THEN-ACT AND THE BILLING
      CARD MUST CLOSE IT: whatever creates a gym subscription MUST take
      `lockOrgRow` on that gym first.** Found by T3 round 1 (C/H-3) on 2026-08-26, and **the note in the
      code used to claim the guard was already safe — that claim is now
      corrected in place** (:5748: a false record is worse than a missing one,
      because the next card builds on it).
      **The gap, exactly:** `repo.updateOrg` asks "is this gym paying?" and then
      writes. It holds the GYM row's lock, which cannot lock a subscription that
      does not exist yet — so one committing between the SELECT and the UPDATE is
      missed, and a now-paying gym's billing currency moves. That is precisely
      what Kd's ruling of 2026-08-26 exists to prevent.
      **UNREACHABLE TODAY, and that is the danger rather than the comfort:**
      nothing in the product inserts into `subscriptions` (grep-verified), so it
      cannot fire until the billing card ships — and whoever writes that card
      will be reading this guard. **A lock on one side is not a lock.**
      **What closes it:** the subscription writer takes `lockOrgRow(tx, gymId)`
      before its INSERT — the same lock and the same order (org row → child rows)
      every mutation in `modules/orgs` already uses, so the two serialise with no
      new deadlock edge. A concurrency test driving two real postgres clients is
      what proves it (`orgs.routes.test.ts` has the precedent: `buildApp` opens
      its pool at `max: 1`, so two `app.inject` calls are serialised by the
      CLIENT and would pass with the lock deleted).
- [ ] ⚪ **A GYM THAT PICKED THE WRONG COUNTRY AND IS ALREADY PAYING CANNOT FIX
      IT ITSELF — and that is the deliberate consequence of the ruling above, not
      an oversight.** The way out exists in principle (Kd approves every gym by
      hand at this scale, :11072) and needs a tool: it belongs to the **ADMIN
      PANEL's** first slices, beside "mark this gym as paid" (:19016, 🔴 line
      above). Both providers make this a support action too — Paddle's own answer
      is cancel-and-resubscribe — so the panel is not working around a limitation
      we invented. **Bounded and currently empty: nothing inserts into
      `subscriptions`, so no gym can be in this state today.**
- [ ] 🟡 **THE CONSOLE IS BUILT ONCE — responsive, opened from inside the phone
      app.** Kd demanded phone management (*"main idea is convenience"*); Part 3
      §3.1 already chose responsive web for the same reason (*"owners live on
      phones; no native console app"*). Mechanism called under K4 and not
      overruled (:9604 §4). **A later chat wanting native console screens is
      proposing to build the console TWICE and owes that cost explicitly.**
      **UPDATE 2026-08-18: the first three screens are built this way** — one
      responsive shell, left rail at `md`+ and bottom tabs below, `ConsoleLayout`
      rather than `AppLayout` (which pins a 256px left margin with no breakpoint
      anywhere in it, so on a phone its content starts off the left edge). The
      line stays open because it governs every console screen still to come.
- [ ] 🟡 **STRIPE CONNECT — GYMS COLLECT THEIR OWN MEMBER FEES, GYM AS MERCHANT.**
      Kd's diagram: `Payment interface → Stripe Connect → Gym's Stripe account →
      Gym bank`, and *"as for money gym customer and user its between them"*
      (:9604 §3). **A BUSINESS-MODEL ADDITION, NOT A FEATURE** — the spec has one
      money direction only (members and gyms pay us); `grep -ci` for
      `connect|payout|marketplace|on behalf|platform fee|split` over
      `05-part5-billing.md` returns **ZERO**.
      **RULED:** the gym is the merchant; disputes, refunds and the member payment
      relationship are theirs. **NOT RULED, and must not be guessed:** which
      Connect account type actually delivers that (they differ materially in who
      carries liability), onboarding and identity-check flow, what a gym sees
      before verification completes, how a half-onboarded gym behaves.
      **UNVERIFIED (V5): every Stripe Connect specific stated in that session came
      from model memory, not a source read. Pull current Stripe documentation at
      planning time and build against nothing asserted there.**
      **The India regulatory objection raised against this is WITHDRAWN** — it was
      anchored on RBI rules that do not apply to a US platform onboarding US gyms.
      Do not resurrect it.
- [ ] 🟡 **GYM SETS ITS OWN PRICING, OFFERS AND FREE PROMOTIONS.** Zero spec hits.
      Rides along with the Connect work — same build, same card family.
- [x] 🟡 **A GYM CANNOT SAY WHEN IT IS OPEN — opening hours as SESSIONS,
      Kd's requirement 2026-08-31 (DECISIONS :26624).** *"a gym can set time
      like we are open from 6 to 7 am … 2 to 3 pm … 4 to 9 pm … or 24 hour
      open … a day can have many session"*. **Zero spec hits for opening hours
      anywhere in `docs/spec/` or this file** (grep-verified before adding) —
      genuinely new, as attendance was. **Read before building attendance,
      before the Overview numbers, before touching Settings, before designing
      classes or booking, and before treating a join code's "Morning Batch"
      label as a time.**
      **THIS IS THE NEXT CARD, AHEAD OF ATTENDANCE**, because an attendance is
      stamped with the session it fell in and a session cannot be attached to an
      attendance recorded before sessions existed — definitions move, so a
      back-fill is guesswork. Order: **sessions → attendance → numbers.**
      **A SESSION IS NOT A GROUP TAG:** Part 3 §2.1's *"Morning Batch"* join-code
      label says who a member belongs to, permanently; a session says when the
      door is open, and a "Morning Batch" member can walk in at 7pm.
      **RULED SHAPE (chat's calls at :26624 §4, stated not asked):** per weekday
      · optional session name · **no capacity** (that is the booking card) · the
      gym's own time zone · **attendance outside hours is recorded and MARKED,
      never refused** · **24-hour is a flag on the gym, not a fake 00:00–23:59
      row.** **UNRULED, to the plan gate:** whether members see the hours
      (recommended yes) · holidays and one-off closures · whether a session
      becomes a bookable class · staff hours vs opening hours.
      **THREE OF THOSE ANSWERED SAME SESSION (:26684):** **no session names**
      (*"not neeeded"* — struck before it was built; a session is a time range
      and nothing else, and it must not return as a carrier for anything else) ·
      **members SEE the hours** (*"yes can see"*), in the SAME card, on their gym
      card · **one-off closures** (*"we are close today"*). **THE TWO
      MECHANISMS MUST NOT MERGE: "closed every Sunday" is the weekly pattern —
      that weekday has NO sessions — while "closed today" is a DATED override
      that wins over it.** A recurring closed day needs no feature; a second way
      to say it lets a gym's two answers disagree. **Chat's calls:** whole-day
      closures only · an optional short note shown to members (*"Closed today —
      Holi"*) · dated so they expire by themselves · removable · dates in the
      gym's own zone. **An attendance on a closed day is recorded and MARKED,
      never refused.**
      **AND :26736, same session — NO WEEKDAY IS SPECIAL** (*"but sundays can be
      open if gym wants"*; the chat's repeated "closed on Sunday" example read
      as a rule). **The gap it exposed is real and is IN THIS CARD: "no hours
      set" and "closed" would render identically**, so a member card saying
      "Closed" for a gym that never filled the form in is :5807 Critical/High
      and would hit EVERY existing gym on day one. **An explicit "hours not set
      yet" state**: members are told nothing about opening times until a gym
      sets them, a weekday with no sessions means closed only AFTER it has, and
      **no default hours are ever invented at creation or in a migration.**
      **SERVER HALF BUILT 2026-09-01** from `CARD-gym-hours.md` §4a: migration
      `0017_gym_hours` (`gyms.hours_mode` defaulting to `unset` · `gym_hours` ·
      `gym_closures`), the contract once in `@app/shared`, and four routes —
      read (staff **OR live member**, so the console and the member's gym card
      share ONE reader and cannot disagree), replace-the-whole-week, close a
      day, un-close a day.
      **WEB HALF BUILT 2026-09-01** — the console's **"When we're open"** section
      on Settings (24-hour switch · many sessions per weekday · dated closures
      with an optional reason and an undo) and the member's own gym card, which
      draws the hours, the whole week and any closure. **The `unset` state is
      physical on both surfaces: a gym that has not answered shows NOTHING to its
      members and is told so on its own screen — never "Closed".**
      **AND KD RULED FIVE CHANGES AT THE SCREEN, 2026-09-01 (:27204), ALL
      BUILT:** times come from a **dropdown** in quarter hours, never typed ·
      **BOTH clocks with the GYM choosing** (migration `0018`,
      `gyms.clock_format`, default `24h`, shown to the owner AND to members) ·
      the date opens a **calendar** · **"use these times every day"** copies one
      day across the week · **each weekday folds INDEPENDENTLY** (opening one
      must never close another).
      **AND FOUR CORRECTIONS FROM HIS SECOND LOOK (:27333):** the clock switch
      is labelled **12-hour / 24-hour** rather than by an example of each · the
      time control is **three boxes, `_ _ : _ _` plus AM/PM**, one 96-item list
      having been the wrong shape · **the FORM says "No times set", never
      "Closed", for a day nobody has filled in** — :26736 one level in, with the
      rule stated once above the list and the MEMBER's card still saying
      "Closed" because there the gym HAS answered · and the picker now HOLDS a
      half-finished time, which the first version could not, making it
      unusable.
      **THE SMOKE GATE IS DISCHARGED ON KD'S DECLARATION, 2026-09-01, NOT ON A
      WATCHED RUN** — handed the 26 steps he answered *"lets just say all
      passed"* and then *"just write smoke pass i am saying you to write"*.
      **His call, recorded as his; do NOT cite it as evidence the screens work
      in a browser.** Sheet: `RUNBOOK/smoke-opening-hours.md`, now **27 steps**.
      **AND THE SHEET HAS MOVED SINCE HE DISCHARGED IT: step 22b is new and is
      OUTSTANDING.** It is the only step that looks at TODAY's own row on a
      member's card — the surface of the web T3's second Critical/High — and a
      declaration cannot cover a step that did not exist when it was made.
      Running it is Kd's call like the rest of the sheet.
      **THE WEB HALF'S T3 ROUND 1 RAN 2026-09-01: TWO Critical/High, both FIXED
      in that round** — a deleted time row leaving its half-typed hour on the
      surviving row (the gym published `09:00` for a row somebody set to 7) and a
      member's card printing today's opening hours under its own "Closed today".
      Each carries a test that fails without the fix and a permanent mutant
      (**C149**, **C150**), and the ✕ that deletes a row got its first observer
      of any kind (**C151**). ~~Four~~ **SIX** Low fixed and logged in
      `BACKLOG.md` (count corrected by T3 round 2's L-3).
      ~~**TWO OF THAT REVIEW'S LOWS HAVE NEVER BEEN READ: L-3 and L-4 were cut
      out of the paste, twice.**~~ **DISCHARGED the same session — they arrived
      on the third paste and are FIXED: a raw ISO date shown to a member
      (`Closed 2026-09-20` → `Closed Sun 20 Sep 2026`, hand-built because the
      obvious `toLocaleDateString` prints the 19th to every reader west of the
      gym) and an unencoded path segment in `removeClosure`.** Both in
      `BACKLOG.md`. **The line is kept struck rather than deleted, because the
      part worth remembering is that they were carried HERE while unreadable
      rather than mentioned in prose** — that is the only reason a finding
      nobody could read was not a finding nobody had.
      ~~**THIS LINE STILL DOES NOT TICK: the web half's T3 ROUND 2 is unrun** (it
      is diff-only, :5348 rule 2) **and step 22b is unrun.**~~
      **T3 ROUND 2 RAN 2026-09-01 (diff-only): ZERO Critical/High, so the REVIEW
      GATE IS CLOSED and the packet ships** (:5348 rule 1; entry at
      `DECISIONS.md:27659`). Six Low, all fixed in that round and logged in
      `BACKLOG.md` — **three of them were round 1's own instruments overstating
      what they had done** (a test's name, a mutant's `why`, and this file's own
      "four Low" count), and the one a person can see is today's row on a
      member's card now reading **"Closed today"** rather than a bare "Closed",
      which in a list of weekdays reads as *closed every Wednesday*.
      ~~**THIS LINE STILL DOES NOT TICK, AND EXACTLY ONE THING NOW HOLDS IT:
      SMOKE STEP 22b IS UNRUN.**~~
      **STEP 22b RAN 2026-09-01 AND KD REPORTED PASS — the line TICKS on this
      commit** (`DECISIONS.md:27810`). Today's row on a member's card read
      **"Closed today"** while the other six read `06:00 – 07:00`, on a gym whose
      every weekday carried real hours, so the row had something to print if the
      dated closure had failed to win.
      **THE DEPARTURE IS DECLARED RATHER THAN HIDDEN, because this sheet says
      "no commands from the chat": I BUILT THE STATE — both accounts, the gym,
      the trial, the week, today's closure and the confirmed membership — over
      the same HTTP API the browser uses, and Kd did the OBSERVING.** Step 22b
      contains no command of mine (:23535's test), so his word is the correct and
      complete evidence for it. **What is NOT claimed: the optional owner-side
      check offered in the same message** (add a time row, delete it) — he did not
      say he ran it, and a pass is per STEP, never per message (:27415).
      **THE OTHER 26 STEPS STILL STAND ON HIS DECLARATION OF 2026-09-01, NOT ON A
      WATCHED RUN** — this tick does not upgrade them, and nothing here is
      evidence that the rest of these screens work in a browser.
      The SERVER half's T3 round 1 ran 2026-09-01 with ZERO Critical/High and its
      eight Low are fixed and logged in `BACKLOG.md`.
      **⚠️ THE WEB HALF MUST HANDLE A SAVE WHOSE REPLY DOES NOT CONTAIN IT, and
      it is written here because it is recorded nowhere else** (raised by T3
      round 1 as a carry-forward, not a defect in the server). **Closing a day
      answers 200 with the gym's hours — and that object is TODAY-FORWARD and
      capped at a ONE-YEAR HORIZON, so a closure typed for YESTERDAY or for more
      than a year ahead is genuinely saved and genuinely absent from the reply.**
      Both are by design (the write has no date window on purpose: a gym typing
      last night's closure in at 1am is telling the truth late). **A screen that
      re-renders straight from the response will look as though the save silently
      failed**, which is :5807 — a user shown something false — arriving through
      a correct server. The screen must either say what happened or refuse the
      out-of-range date before sending.
- [x] 🟡 **ATTENDANCE / QR CHECK-IN.** ✅ **DONE 2026-09-02** — commits `8eacc54`
      (owner's half + both review rounds), `98f2688` (smoke + the visible-date
      fix), and the halves before them. **THE WEB HALVES ARE COMPLETE AND
      VERIFIED IN A BROWSER; the QR half is the phone app's and keeps its own
      line below** (:26558, :26586 — *"drop the scan part completely from web"*),
      so this ticks for what was ever web work, not for the scanner. Kd:
      a QR printed and stuck on the door;
      registered members scan it to mark attendance. **Zero spec hits for
      `attendance` or `check-in`** — but the mechanism is half-designed already:
      Part 6 §2 has QR posters and an `aihg://org/join?code=` deep link for
      JOINING. Attendance is the same scan with a different action.
      **⬆️ PROMOTED TO THE NEXT CARD, 2026-08-31 (DECISIONS :26469), and it is
      where :17366 §6's wave 1 always had it.** Kd ruled the gym's Overview
      numbers count *"present in the gym"*, so nothing on that screen can be
      built until attendance exists. **RULED SHAPE, all four his:** two ways in —
      **scan the gym's QR or mark it manually in the app** — **the gym SEES which
      is which**, and **the owner can switch the manual option OFF in Settings**.
      **Store the two as DIFFERENT THINGS from day one**: a manual tap can come
      from home, so a single "attended" boolean throws away the only thing that
      makes the number trustworthy, and no later card can recover it.
      **:17765 binds the surface** — the gym DISPLAYS a QR and SEES who came
      (both work on a laptop), the MEMBER scans with their phone.
      ~~**UNRULED and owed to the plan gate (:26469 §6):** how a workout links to
      an attendance · whether staff can mark somebody present · what a member
      sees of their own attendance · whether attendance feeds streaks or badges ·
      QR validity and rotation.~~
      **FOUR OF THE FIVE WERE PUT TO KD AT THE GATE AND ANSWERED, 2026-09-01
      (DECISIONS :27900):** staff marking somebody present is **NOT NOW** — only
      the member marks, and `marked_by_user_id` is stored separately from
      `user_id` from day one so a front-desk button later ADDS a value rather
      than rewriting history (:26469 §4's own argument, applied) · a member
      **DOES** see their own attendance history · **ATTENDANCE FEEDS STREAKS**,
      *against* the recommendation to defer it · and QR validity/rotation left
      the web entirely at :26586 and is the phone app's.
      **THE STREAK ANSWER CARRIES A BUILD REQUIREMENT, not just a yes: the
      STREAK's day list becomes workout days ∪ attendance days and the XP
      total's does NOT.** They share ONE list today
      (`gamification/repo.ts:136`, `SELECT DISTINCT … FROM workouts`, replayed
      by `onWorkoutSynced` for the streak and by `recomputeXp` for XP), so a
      one-line union pays XP for a button tap, silently, to everybody. **Kd
      ruled streaks; he did not rule XP.**
      **⚠️ STILL OWED, and it moves rather than closing: HOW A WORKOUT LINKS TO
      AN ATTENDANCE.** Deliberately NOT put to Kd at this gate — it needs no
      column in the attendance card (the link is a rollup-time join on the gym's
      day) and it is the Overview-numbers card that cannot be built without it.
      **It goes to THAT card's plan gate, as options with a recommendation,
      never as a chat's default (R0.2).**
      **THE BUILD PLAN IS WRITTEN AND UNAPPROVED: `CARD-gym-attendance.md`**
      (2026-09-01). **NOTHING IS BUILT.** ~~Two things it leaves for Kd at the
      gate rather than assuming: whether a visit is **one per DAY** (recommended,
      cost stated — a member who comes morning and evening is counted once) and
      whether a member of a **LAPSED** gym can still mark attendance
      (recommended yes; refusing would show a member something false about their
      own gym, :5807).~~
      **BOTH ANSWERED SAME SESSION (:27992), ONE AGAINST THE RECOMMENDATION —
      and Kd added TWO rulings nobody asked him for:**
      **(1) A SECOND VISIT IN A DIFFERENT SESSION COUNTS AGAIN** and the owner
      sees the member attended twice — *"if a member again comes in different
      slot and gives attandance taht also count"*. Built as **UNIQUE (gym_id,
      user_id, day, slot_key)**, `slot_key` NOT NULL (the session window, else
      the `hours_status` name), so the ruling sits in a constraint rather than a
      comment and a same-session double-tap is still one row (R3.5 kept, not
      traded).
      **(2) A LAPSED gym's member CAN still mark** (:22215 arm A); an ARCHIVED
      gym (:25771) refuses.
      **(3) THE APP NEVER CHECKS WHETHER A MEMBER HAS PAID THE GYM** — *"thas
      gym responsibility"*. One condition only: a live membership row.
      `members.remove` is the gym's remedy for anyone else. **No dues, arrears or
      payment concept enters the schema, the routes or the screen** — and this is
      a ruling about what the product does NOT do, the kind a later chat quietly
      reverses by "improving" a check.
      **(4) THE OWNER'S SCREEN MUST NOT PILE UP** — *"it might pile up and may be
      hard to analuse and see so the ui should be clean and beautiful"*. **A
      build requirement with a test, not styling:** the day's shape before any
      names, exceptions as a filter, then PEOPLE one row each with their times as
      chips, name search, paged never infinite, and an empty state that tells
      "nobody came yet" apart from "the button is off". **The counts come from
      the server or they are wrong** — a browser that counts its own page reports
      the page.
      ~~**❓ THE ONE OPEN QUESTION LEFT ON THIS CARD, named rather than
      defaulted: should a gym that is open 24 HOURS, or that has declared no
      sessions, also count REPEAT visits?**~~ **CLOSED SAME SESSION BY KD
      (:28055): *"only one time attandance"*.** The shape does not change —
      `slot_key` already behaved this way — **but its STATUS does: it was a
      chat's stated consequence and is now his ruling, so "count it again after
      an hour" is RE-OPENING a settled question rather than filling a gap, and
      the number it needs is the R0.2 invention this avoided.** Struck and
      closed, not deferred.
      **(5) THE GYM SEES WHO ATTENDED, BY NAME** (:28055) — *"will gyms be able
      see who attended etc ? beacvuse they should"*. Already ruled at :26469 §1
      and already in the card, **and he still had to ask, which is evidence
      about the PLAN and not about him — a feature nobody can find is a feature
      that is not there.** Now written in rather than assumed: the **"Who came"
      view is a first-class console screen, ONE click from the nav, beside
      Members, never inside Settings**, and **one member's own history is
      answerable on the same route via `?userId=` — a filter, not a second
      endpoint** (:14401's shape).
      **(6) ATTENDANCE IS ITS OWN CONSOLE SECTION, AND STAFF SEE IT BY DEFAULT
      WITH THE OWNER ABLE TO CHANGE THAT** (:28107) — *"it should not be in
      settings but in a section call attandance a new option besides gym memebr
      settings etc also stafs can see it too default permission owner can change
      it"*. **A fourth item in the console's left rail** (it holds three today:
      `Gym`, `Members`, `Settings`). **The SWITCH stays in Settings while the
      LIST moves out** — Settings is where a gym CONFIGURES itself, a section is
      where it WORKS.
      **⚠️ THIS MINTS `attendance.read`, THE NINTH PRIVILEGE, AND IN THIS REPO
      THAT IS A MIGRATION AND NOT A LIST EDIT.** Reusing `members.read` would
      have satisfied "staff see it by default" and FAILED "owner can change it"
      — unticking it also takes the roster (:13803, :21157).
      **The trap the type system cannot see: `gym_staff.privileges` carries a
      CHECK listing all eight names in DDL** (`tenancy.ts:404-405`), **so a
      ninth added in TypeScript alone compiles, passes every unit test, and 500s
      in Postgres the first time an owner ticks the box.**
      `db.migration.test.ts:549` already asserts the CHECK equals
      `[...ORG_PRIVILEGES].sort()` and goes red by itself — **do not "fix" that
      expectation.** Also required: a **BACKFILL** onto stored privilege sets
      (:21157's precedent), a **TICK BOX** in `PRIVILEGE_COPY` (six of eight
      have one — **without it "owner can change it" is a false sentence**),
      default ON for **all three roles**, and **not** in
      `OWNER_ONLY_PRIVILEGES` or `LAST_OWNER_REQUIRED_PRIVILEGES`.
      **AND TWO FIXTURES MEASURE "NEWEST PRIVILEGE" BY NAME AND WILL GO STALE**
      — `schemas.test.ts`'s positive control, and `db.migration.test.ts:677`'s
      `legacySeven`, whose arithmetic still passes with nine so **it goes QUIET
      rather than RED** (:5348 rule 4's liar). Named here rather than waited for.
      **NOTHING ON THIS CARD IS NOW OPEN.**
      **SERVER HALF BUILT 2026-09-01** from `CARD-gym-attendance.md` §4a
      (`DECISIONS.md:28221`): migration `0019_gym_attendance`
      (`gyms.manual_attendance_enabled` defaulting to `true` · `gym_attendance`
      with five CHECKs and `UNIQUE (gym_id, user_id, day, slot_key)` · the NINTH
      privilege `attendance.read`, its widened DDL CHECK and a backfill onto
      EVERY role), the contract once in `@app/shared`, and three routes — mark
      (a live member), the gym's day (`attendance.read`, answering PEOPLE plus a
      per-session SUMMARY and DAY TOTALS, never a list of taps), and one
      person's history (self, or `attendance.read` for somebody else) — plus the
      owner's switch on the existing `PATCH /v1/orgs/:gymId`.
      **`slot_key` IS WHERE KD'S RULING LIVES**, and the database re-derives it
      so a later writer setting it to a constant gets a 23514 instead of
      silently reverting every gym to one visit a day.
      **STREAKS: `getStreakDays` (workouts ∪ attendance) is a SECOND function
      beside `getActivityDays` (workouts alone, for XP), and two mutants hold
      the split in both directions.**
      ⚠️ **NO SCREEN EXISTS. The web half (§4b) is UNBUILT**, so no member can
      tap anything and no owner can see a list. **No browser smoke was run and
      none was offered** — there is nothing to click. **T3 IS UNRUN.** This line
      does NOT tick.
      **⚠️ THE WEB HALF MUST NOT COUNT THE DAY IN THE BROWSER, and it is written
      here because it is Kd's ruling 14 made concrete** (:27992 §3): the response
      carries `totals` (day-level, with a DISTINCT people count) and `summary`
      (per session). **A screen summing the per-slot rows double-counts whoever
      came twice and prints more people than the gym has members** — :5807
      arriving through the very feature that made returning twice possible. The
      per-slot `visits` and `people` are provably EQUAL (the UNIQUE admits one
      visit per person per slot); only the day totals differ.
      **§4b's MEMBER HALF BUILT 2026-09-02** (`DECISIONS.md:28822`), and **§4b
      was SPLIT IN TWO on chat-size grounds with Kd told before he approved**:
      the member's *"I'm here"* button, the sentence it answers with, and the
      days they came — inside **`My Gyms`, a new item in the MEMBER's left nav
      that Kd ruled the same day**, shown only once a gym has approved them.
      **It is NOT the `My Gym` he removed on 2026-08-19 (:11616): that pointed
      at `/console` and this points at a member screen** — the crossing stays
      shut and the suite asserts it with the new item on screen.
      ⚠️ **STILL OWED, AND THIS LINE DOES NOT TICK: THE OWNER'S HALF** — the
      console's **Attendance** section (:28107, a fourth nav item), the manual
      switch on **Settings**, and the *"See who came in"* **TICK BOX** in
      `PRIVILEGE_COPY`, **without which "the owner can change it" is a false
      sentence**. Plus: **no browser smoke has been run on either half.**
      **T3 ROUND 1 RAN ON THE MEMBER HALF 2026-09-02 (`DECISIONS.md:28976`):
      THREE Critical/High and FOUR Low, all seven fixed, so the packet does NOT
      ship that round and a DIFF-ONLY ROUND 2 IS OWED** (:5348 rule 2). Two of
      the three were things a member could SEE and be told falsely — a history
      of one day drawn off a read that never answered, and a visit erased by a
      read that was already in flight. **T3 is still UNRUN on the server half.**
      **T3 ROUND 2 RAN 2026-09-02 (`DECISIONS.md:29117`) AND THE MEMBER HALF'S
      REVIEW IS NOW CLOSED: ZERO Critical/High, so THAT PACKET SHIPS** (:5348
      rule 1) — four Low, all fixed, all in `BACKLOG.md`, escape hatch not armed.
      Every one was a guarantee the code kept correctly with **nothing holding it
      there**, including C/H-3's own second half; three mutants now hold them.
      **THIS LINE STILL DOES NOT TICK, and "the packet ships" is a statement
      about that diff only.** What holds it: ~~**the OWNER's half is unbuilt**~~
      **BUILT 2026-09-02, see below** · **no
      browser smoke has EVER run on any attendance surface, either half** · **T3
      is unrun on the server half.**
      **§4b's OWNER HALF BUILT 2026-09-02 (`DECISIONS.md:29250`)** — the console's
      **Attendance** section (:28107's fourth nav item, gated on
      `attendance.read` and NOT on a job title), the **manual switch** on
      Settings, and the *"See who came in"* **TICK BOX** in `PRIVILEGE_COPY`,
      which is ruling 18's second half and without which *"the owner can change
      it"* had no control behind it. **Web-only: no migration, no `apps/api`
      file, no `packages/shared` change** — :28221 had already shipped the routes
      and the ninth privilege. Kd's ruling 14 is the screen's shape: the day's
      SHAPE first (one line per session, server-counted), the exceptions as a
      FILTER (the server's `?statuses=`, never a browser predicate), then PEOPLE
      one row each with times as chips, paged and never infinite.
      **THE COUNTS ARE SERVED AND THE SCREEN DERIVES NONE** — the test hands it a
      day whose `totals` say 300 people while its page carries two, which is
      ruling 14's named breakage made observable.
      ⚠️ **STILL NOT TICKING, AND NOW ONLY TWO THINGS HOLD IT: no browser smoke
      has EVER run on any attendance surface, either half, and T3 is UNRUN on
      this half and on the server half.** The smoke sheet is owed and can now be
      written across BOTH halves, which is what §4b's split was waiting for.
      **THE SMOKE'S CORE RAN 2026-09-02 AND PASSED 8 OF 8**
      (`RUNBOOK/smoke-attendance.md`, `DECISIONS.md:29410`) — the FIRST browser
      evidence for any attendance surface, covering both halves from one account:
      the nav item, the button, *"You're marked in."* with **no claim about
      opening hours**, the second tap staying ONE visit, the console's fourth nav
      item, the owner seeing the day, **the count staying at 1 person after two
      taps**, and yesterday saying nobody came.
      ⚠️ **THIS LINE STILL DOES NOT TICK AND TWO THINGS HOLD IT:**
      **(a) the sheet's PARTS C AND D ARE UNRUN** — the Settings switch (off →
      the member's button disappears while their past visits stay → on) and the
      **came-twice** case (one row, two times, ruling 12 at the screen). Part D
      was flagged IN the sheet as the one path the chat could not verify itself
      (an auth rate limit), so nothing about it is claimed in either direction.
      **(b)** ~~T3 IS UNRUN on the owner's half AND on the server half.~~
      **CORRECTED AND ADVANCED 2026-09-02 (`DECISIONS.md:29500`). The SERVER
      half's T3 ran twice** — `:28452` (round 1, four Critical/High) and `:28649`
      (round 2, diff-only, ZERO, **that packet SHIPS**) — **so the words above
      were false when written, and they were read and believed by the owner's-half
      reviewer, who then paid for a fresh full pass over it. A stale status line
      does not merely misinform; it BUYS WORK.**
      ~~**THE OWNER'S HALF THEN RAN ROUND 1: TWO Critical/High, five Low, all
      seven fixed, so THAT PACKET DOES NOT SHIP ITS ROUND and a DIFF-ONLY ROUND 2
      IS OWED**~~ **— ROUND 2 RAN 2026-09-02 (`DECISIONS.md:29740`): ZERO
      Critical/High, so THE OWNER'S HALF SHIPS and EVERY HALF OF THIS CARD HAS
      NOW PASSED ITS REVIEW GATE** (server `:28649` · member `:29117` · owner
      `:29740`), **each on a diff-only round 2, escape hatch never armed on any
      of them.** Round 2's two Low were both round 1's own account of itself — a
      false recorded cause and a guard claiming more reach than it has — and
      neither is in the app.
      Both Criticals were things an OWNER could see: **a greyed switch with no
      sentence** — the sixth panel to grey a control and the first to explain
      nothing, which :24141 §3(c) requires per panel and not only in the page's
      red strip — and **a cleared date box stranding the whole screen**, one
      keystroke taking out both arrows, the read (`day: invalid_string` printed at
      the owner) and Try again together.
      ~~**THE CARRY-FORWARD FOR ANY FUTURE CONSOLE PANEL, because it is a class
      and not a case: nine assertions pinned the read-only sentence per SCREEN
      (`getAllByText(...).length > 0`), and Settings mounts four panels that share
      one sentence — so any ONE of them satisfied all nine.**~~ **— STRUCK BY T3
      ROUND 2 (`DECISIONS.md:29740` L-1). A closed `ConsoleSection` is UNMOUNTED
      and every case opens exactly one, so those assertions were already scoped;
      killing a neighbouring panel's note turns one of them RED. FIVE take that
      shape, TEN mention the note, all in ONE file. THE REAL CARRY-FORWARD IS
      SMALLER AND TRUER: no test ever opened the attendance section with a note
      assertion in it — a missing CASE, not a blind INSTRUMENT.** The guard is
      per-panel, scoped through `ConsoleSection`'s `aria-controls`, and asserts
      the section COUNT — **which counts SECTIONS only; a greying panel drawn as
      a plain `ConsoleCard` (the `Members.jsx:343` shape) is invisible to it,
      measured, and the test now says so.**
      ✅ **NOTHING HOLDS IT ANY LONGER — THIS LINE TICKS, 2026-09-02.** **SHEET
      PARTS C AND D RAN AND PASSED**, by Kd at the browser, on the shipping bytes
      of `8eacc54` (verified with `git diff HEAD --name-only` over the three
      `src` trees returning empty, not asserted — :14956, :15198). **The switch
      turns marking off and the member's button GOES while their past visits
      STAY; the permission box reads "See who came in"; and Part D — which he ran
      though it was optional — is the only observation this project has of Kd's
      ruling 12 at a screen: one member, two sessions, ONE ROW WITH TWO TIME
      CHIPS and a count reading `1 person · 2 visits`.** That second number is
      printed only when it differs from the first, so the ✅ could not have been
      met by a day with one visit.
      **HE RAN THEM AND REPORTED THEM; THE CHAT OBSERVED NONE** — the ordinary
      shape of this gate, and no step needed a terminal command, so :23535's
      failure mode (a step needing the chat's action recorded as passed) cannot
      apply. **The API was DOWN when the steps were handed over and the sheet's
      "both servers are running" was stale** — started first, both 200. A sheet's
      setup section ages (:5041).
      **WHAT NO BROWSER HAS SEEN, so nobody reads the tick as wider: the QR scan
      path (phone), staff marking somebody present (:27900, "not now"), a second
      gym's owner, and anything on a phone.**
- [ ] 🟡 **`apps/web/tools/mutate-login-door.mjs` IS UNRUNNABLE AND HAS BEEN
      SINCE 2026-08-28.** Found 2026-09-02 (`DECISIONS.md:28822` §4) by trying to
      run it. It ABORTS before writing a byte — **D13's anchor matches nothing**,
      because :23257 (`99687c5`) moved `ConsoleLayout`'s inline `handleSignOut`
      into `useConsoleSignOut` and the mutant still anchors on the inline copy.
      **The whole-table pre-check behaved correctly** — it refused rather than
      reporting a no-op as ALIVE (:13336) — **so nothing is wrong with the
      instrument's design; what is owed is the re-aim**: D13 moves to
      `useConsoleSignOut.js`, which needs a new `TARGETS` entry, and
      **re-anchoring by MEANING and not by pattern** (:28221 — a sibling pair
      re-anchored by pattern became one mutant reporting twice). Until then
      **D12–D17 cannot run at all**, so Kd's 2026-08-19 crossing ruling and the
      questionnaire's exit have no mutation cover. **D15 was hand-run 2026-09-02
      and was RED on both cases**, so the crossing half is spot-verified, not
      covered. **STANDING: a harness is only as live as its last run.**
- [ ] 🟡 **`apps/web/tools/mutate-person-gate.mjs` IS UNRUNNABLE AND HAS BEEN
      SINCE 2026-08-14 — 213 COMMITS, THE LONGEST OF THESE YET.** Found
      2026-09-04 by T3 round 1 on `:32929`/`:33091` (Low-4) and re-measured
      independently before it was written down. **`PG16` and `PG17` both anchor
      on `if (enabled && !wasEnabled) controllerRef.current.resetScene();`, and
      `resetScene` does not appear in `apps/web/src/hooks/usePoseDetection.js`
      at all any more** — `8c2d204` (*"The pause stops being billed as squatting"*)
      took it out. The harness ABORTS on a drifted anchor, exactly as designed
      (:13336), ~~**so all 23 of its mutants have been unrunnable that whole
      time, not merely those two.**~~ **— CORRECTED 2026-09-04 by T3 round 2,
      and the correction is what makes this line actionable: it is SIX, not 23.**
      `PG1`–`PG15b` (**17**) run and report normally; the abort fires at `PG16`
      and takes `PG16`–`PG21` (**6**) with it. **The reason is a missing
      instrument, and it is the part to keep: `mutate-person-gate.mjs` has NO
      whole-table pre-check** — the anchor test lives INSIDE the run loop
      (`mutate-person-gate.mjs:322-326`), so it cannot know a later anchor is
      dead until it has already written and restored seventeen mutants.
      `mutate-console.mjs` pre-checks the whole table BEFORE its run loop, which
      is why that harness reports every dead anchor at once and this one reports
      the first. **So the `--check` flag ruled at `:33334` §3 has nothing to call
      on THIS harness and must build the pre-check here**, rather than exposing
      one that already exists — a difference between the harnesses that the
      one-line shape of that ruling does not carry.
      What they guard is the person check's ruled cut-off
      and the sentence it puts on screen (:7037, :6959, :7104) — a Kd-ruled
      number and a `:5807` Critical/High class.
      **What is owed is the re-aim, BY MEANING and not by pattern** (:28221),
      then a measured run of the whole table. **Re-anchoring alone proves
      nothing** (:4718 F2): a mutant re-aimed until it goes red is a mutant
      fitted to the tests. `:33091` §6 re-anchored `P4` in-card only because the
      abort BLOCKED that card's own proof; nothing here blocks anything, so
      under R1.1 this is its own card and not a drive-by.
      **NOT DOUBLE-COUNTED: the five NOT-APPLIED rows in
      `apps/web/tools/mutate-write-path.mjs`** (M5 · M21 · M28 · M40 · M43) **are
      already carried by the 2026-08-16 line above** and were re-confirmed dead
      by the same measurement; that harness reports NOT APPLIED and exits 1
      rather than aborting, so its other 59 mutants do still run. **D13
      (`mutate-login-door.mjs`) is the line immediately above.** Measured the
      same day across all nine web harnesses, CRLF-normalised on both sides:
      **console 231 · dashboard-stats 17 · join-door 36 · badge-cue 8 ·
      pose-assets 27 · pose-tuning 13 — every anchor live, zero ambiguous.**
      **THE CLASS IS NOW FOUR DEEP AND EACH ONE WAS FOUND BY ACCIDENT** — D13
      (five days dead, `:28822`), `P4` (nineteen days, `:33091` §6), the
      write-path five (reformatted arrow functions, 2026-08-16), and these two
      (twenty-one days). **`tools/check-harnesses.mjs` parses every harness and
      says in its own docblock that it "cannot tell a stale anchor from a live
      one — the harness's own whole-table pre-check does that".** That mitigation
      is *"somebody runs the harness"*, and nobody did for 213 commits.
      **RECOMMENDED, and it is `:5348` rule 5's class fix rather than a fifth
      careful case fix: give every harness a `--check` flag that runs its
      existing whole-table pre-check and exits, then have the ROOT `lint` guard
      call it.** Deliberately NOT a central anchor parser reading the tables from
      outside: the nine harnesses use five different table shapes, three are
      shell scripts with no JS table at all, and a checker that silently resolves
      a target wrong reports CLEAN — which is the failure mode `:22640` recorded
      when a generator's own input list turned out to be incomplete. Reusing each
      harness's own resolution logic is the only version that cannot lie.
      **Put to Kd 2026-09-04 with that recommendation; he approved building it as
      its own card rather than inside the fix round.**
- [ ] ⚪ **THE MEMBER APP NOW ASKS `/v1/orgs/mine` TWICE ON THE DASHBOARD.**
      Raised 2026-09-02 (`DECISIONS.md:28822` §3). The sidebar reads the kept
      answer in `consoleOrgs.js` (so the `My Gyms` item is decided once per
      session and survives a screen change), while `GymMembershipCard` still
      makes its own direct read on the Dashboard and on Settings. **No defect —
      both answers come from the same endpoint and neither can be stale in a way
      the other is not** — it is one wasted request per screen that draws the
      card. **The fix is moving that card onto the store, which also needs
      `/v1/orgs/applications/mine` in the store** (the card reads both and
      settles them separately), so it is a card of its own rather than a line in
      somebody else's.
      **AMENDED 2026-09-02 by T3 round 1's C/H-3** (`DECISIONS.md:28976` §2):
      **the cost written above was measured wrong.** Subscribing the sidebar the
      console's way also attached the console's FOCUS listeners, so the member
      app re-read `/v1/orgs/mine` on every focus and tab switch, on every screen,
      all session — 1 read on mount, 4 after three focus events. **Fixed there;
      what remains true of this line is only the one duplicate read per screen.**
- [ ] ⚪ **`My Gyms` APPEARS ON THE NEXT PAGE LOAD, NOT THE NEXT TAB SWITCH.**
      The stated cost of that same fix: a member approved while their tab sits
      open sees the item when they next load the app. **Kd's ruling is satisfied
      — the option appears once a gym approves them — and this is about how
      fast, not whether.** **DO NOT "fix" it with a focus re-read or any poll in
      the member app:** `Sidebar` is on every member screen for the whole
      session, a gym's members share ONE NAT'd address, and `/v1/orgs/mine` has
      only the global 300/minute keyed to `req.ip` — that IS what C/H-3 was.
      **The bounded fix is a targeted refresh at the moment the answer can have
      changed**, i.e. when the member is on Settings → Gym, where
      `GymMembershipCard` already reads `/v1/orgs/mine` and could feed the store
      — **the same card as the line above, and to be done with it.**
- [ ] 🟡 **THE OWNER'S ATTENDANCE SEARCH CANNOT SEARCH WHAT IT HAS NOT LOADED.**
      Deferred 2026-09-02 by the owner's half (`DECISIONS.md:29250` §2), **as a
      call put to Kd WITH ITS COST at the gate and approved**, rather than
      discovered afterwards. `GET /v1/orgs/:gymId/attendance` has no name
      parameter and pages 100 people at a time, so the console's search filters
      the rows LOADED. **The screen is honest about it** — with pages still
      unread it says *"Nobody by that name in the people loaded so far — load the
      rest to search them too"* and never *"nobody came"*, because a silent miss
      for a member sitting on page three is the same defect as counting a page
      and calling it the day (ruling 14, :27992 §3). **A gym at the trial cap of
      300 is three presses from fully searchable**, which is why this is 🟡 and
      not blocking. **THE FIX IS A SERVER PARAMETER, not a bigger page**: a `q`
      on the day route, filtered in SQL, so the answer is about the DAY and not
      about what a browser happens to hold. **Do NOT "fix" it by raising
      `ATTENDANCE_PAGE_LIMIT`** — that moves the cliff without removing it, and
      the limit is paired with a `.max()` in the contract that a change would
      have to move in the same commit (:28452 §3, :28649 L-6).
- [ ] ⚪ **TWO DATE PICKERS NOW EXIST IN THE CONSOLE AND THEY ARE THE SAME
      CONTROL WRITTEN TWICE.** Raised 2026-09-02 by the owner's half
      (`DECISIONS.md:29250` §8). The Attendance section's day box and the hours
      screen's *"closed on a date"* box are byte-for-byte the same behaviour —
      `type="date"`, the whole box opening the calendar via `showPicker()` in a
      swallowed try/catch (**Kd's own instruction, 2026-09-01: *"for date i have
      to hand type men"***), and deliberately **no `min` and no `max`** (an HTML
      `min` is a CONSTRAINT, not a hint: the field silently refuses to submit
      with no event and no sentence, which the hours card learned the hard way).
      **Not extracted deliberately**: sharing them means editing
      `OpeningHoursPanel.jsx`, an 800-line file under five rounds of review, and
      R1.1 says a card does not refactor a file it otherwise has no business in.
      **THE RISK IS THE ORDINARY ONE FOR A DUPLICATE — the next fix lands in one
      copy.** The fix is a small shared `DayField` in `components/console/`, used
      by both, with the hours render suite as the guard that the extraction
      changed nothing.
- [ ] ⚪ **A GYM THAT CHANGES ITS TIME ZONE LEAVES OLD VISITS WITH A DATE AND A
      TIME THAT DESCRIBE DIFFERENT DAYS.** Raised 2026-09-02 by the member half's
      T3 round 2 (`DECISIONS.md:29117` §4) as an observation, **not a finding of
      that round — it PRE-DATES the whole attendance web half.** Every row's
      `day` was computed on the SERVER, in the zone the gym had **at write
      time**, and is stored; every chip beside it is rendered from `markedAt` in
      the gym's **current** zone. While a gym never moves zone the two agree
      exactly, which is why nothing on screen is wrong today and this is ⚪. Move
      a gym across a date line and an old visit can print a date from the old
      zone above a clock time from the new one. **It is NOT round 1's L-4
      returning** — that only picks the fresher of two answers about the gym as
      it is NOW, so it improves the choice without creating this class.
      **THE ONE THING NOT TO DO: re-bucket the stored `day` in the browser.** The
      server owns the day (`slot_key` and the UNIQUE are derived from it,
      :27992 §1) and a client that recomputes it disagrees with the constraint —
      and with the owner's screen, which reads the same rows. **The honest fixes
      are server-side and are a card of their own:** either stamp each row with
      the zone it was written in and render each row in its own, or accept the
      drift and say so in the copy. **It reaches the OWNER's screen too**, so it
      belongs with the console's Attendance section rather than as a patch here.
- [ ] 🟡 **THE IN-APP QR SCANNER IS A MOBILE-APP FEATURE AND IS DEFERRED TO THE
      ANDROID CARD — Kd ruling 2026-08-31 (DECISIONS :26558):** *"well scanner
      is for mobile app not for browser"*. **Read before building any QR/barcode
      reader, before adding a camera dependency to `apps/web`, and before
      promising a member any in-app scan on the web.** Built natively with
      Android (stage 6 of :19016's order) and again for iOS, where a scanner is
      a platform component rather than a decoder we ship. **BLOCKS NOTHING: the
      QR is a LINK** — a member on the web points their phone's own camera at
      the poster and lands on the confirm screen, or taps the manual button, so
      the web attendance card ships both of :26469 §1.4's ways in without it.
      **SUPERSEDED SAME SESSION BY :26586 — THE WHOLE SCAN PATH LEAVES THE WEB,
      not just the reader:** the poster, the link and its confirm screen are
      phone-app work too, and **the web card ships ONE way in, the manual tap.**
      Kd: *"drop the scan part completely from web men , it will be only manual
      if user uses web which the user is not going to do"*. The sentence above
      about the phone's own camera opening the confirm screen is kept because it
      is what this line claimed when it was written, and it is exactly the half
      measure he corrected.
      The chat had verified that `apps/web/src/hooks/useCamera.js` already opens
      the phone camera and recommended the reader as a small addition; correct
      about the cost, wrong about the surface.
- [ ] 🟡 **CLASSES, SCHEDULES AND COACH INSTRUCTION SLOTS (booking).** Zero spec
      hits for `booking`, `schedule` or `check-in`. **The largest single new piece
      on this list**, and the thing gyms actually pay competitors for.
- [x] 🟡 **SEPARATE GYM LOGIN AND USER LOGIN on the entry screen. — DONE
      2026-08-19, commits `80ee871` (the crossing) on top of `a18a15b` (the
      doors), gates closed at DECISIONS :11757.** Full gate met and not waived:
      smoke **11/11** in Kd's browser (:11706) AND a T3 round finding **ZERO
      Critical/High** (:5348 rule 1), its eight Low all fixed and logged in
      `BACKLOG.md`. What ships: two doors on the login page, one `landingRoute`
      consulted by all four places that decide where a person lands, the choice
      remembered for the tab and cleared on sign-out, the gym door skipping the
      questionnaire (:10959), and — :11616 — **the doors as the ONLY way across
      in either direction**, with a Sign out on the console and the wizard so the
      removals strand nobody. **The real-handset check is NOT part of this tick**
      and has its own line below. Small — Part 3
      already puts the console in its own route group (`/console/:orgSlug/...`).
      **RULED BY KD 2026-08-18, raised by him mid-smoke: *"why the hell there is
      my gym … why would a gym owner enter a users profile to create their gym …
      there should be like this in the register or login page you either logged
      in as user or a gym administrator"*.** He answered **yes** to the shape put
      to him: **two DOORS, ONE ACCOUNT** — the login page offers "I'm a member"
      or "I run a gym", the email and password are the SAME either way, and the
      choice decides only which screen you land on.
      **THE FACT THAT DECIDED IT, and it must not be lost by a later chat: the
      same person is deliberately BOTH.** Part 3 §4.0 step 6 makes the owner
      member #1 of their own gym, complimentary and not seat-counted, precisely
      so they can demo the app on their own phone. **Separate ACCOUNTS would mean
      a gym owner cannot use their own app without logging out** — which is the
      opposite of the convenience ruling at :9604 §4.
      **What this replaces:** the **My Gym** sidebar entry added with the console
      screens, which was a TEMPORARY door built so the screen was reachable at
      all and should have been labelled temporary when it shipped. Whether it
      SURVIVES beside the new door is part of that card, not decided here — an
      owner already inside the member app still needs a way across.
      **UPDATE 2026-08-19 — BUILT (DECISIONS :10866), then AMENDED BY KD the
      same day mid-smoke (:10959): the gym door skips the fitness questionnaire
      entirely — a gym owner lands straight on the console and meets the wizard
      only when crossing into the member app ("Back to the app"), where every
      member screen still requires it. THIS LINE DOES NOT TICK: the smoke
      restarts on the amended bytes and the T3 is UNRUN** (:4718 F4 — a line
      ticked in the same commit whose message said otherwise had to be
      reverted). What now exists: two doors on the login page, one
      `landingRoute` consulted by all FOUR places that decide where a person
      lands, the choice remembered for the tab and cleared on sign-out, console
      routes opted out of the onboarding requirement, and
      `RUNBOOK/smoke-login-door.md` (rewritten for the amendment).
      ~~**THE `My Gym` SIDEBAR ENTRY STAYS — the open question above is CLOSED and
      the answer is "it survives"**: an owner already inside the app still needs
      a way across without signing out, and the no-removal rule keeps it absent a
      ruling to drop it. It is no longer a temporary door; the door it stood in
      for now exists.~~
      **STRUCK 2026-08-19 THE SAME DAY — KD RULED THE OPPOSITE (DECISIONS
      :11616): `My Gym` is REMOVED, and the console's "Back to the app" with it.
      The two doors are the ONLY way across, in both directions.** His words:
      *"no back to the app in gym dashboard sign out instead"* and *"why my gym
      in the user side profile if they want to create gym they will sing in as
      gym"*. The no-removal rule's AUTHORISED path — an explicit ruling against a
      cited cost; the recommendation put to him was the OPPOSITE (keep the
      cross-link, add a sign-out) and he reaffirmed. **The cost he was given
      first, and it changed the fix: `ConsoleLayout` had NO sign-out at all, so
      removing the cross-link alone would have locked an owner inside the
      console.** **Sign out** now replaces it on BOTH the desktop rail and the
      phone bar.
      **AND THE SCREEN NOBODY WAS LOOKING FOR: the onboarding questionnaire had
      no sign-out either** — no sidebar, no skip (removed at Card 6), so anyone
      who signed up or picked the wrong door was stuck on a five-step form with
      no exit but finishing it. **Kd hit it on his FIRST step of this very
      smoke**, which is how it was found at all. Fixed in the same packet; it is
      NOT a skip (the onboarding gate is untouched, pinned by a test).
      **UPDATE — THE REWRITTEN SMOKE PASSED 11/11 on `9aae571` (DECISIONS
      :11706), Kd's own browser.** Both removed shortcuts confirmed gone, both
      new Sign outs confirmed to really end the session (browser BACK button),
      Google still landing in the console. **THIS LINE STILL DOES NOT TICK — the
      T3 on this diff is UNRUN** (:4718 F4: a line ticked in the same commit
      whose message said otherwise had to be reverted, on this branch). The
      packet needs a review round finding ZERO Critical/High (:5348 rule 1).
      **THE FOURTH LANDING SITE IS WHAT THIS CARD ALMOST MISSED, and it is worth
      carrying:** `Onboarding.jsx` ended `navigate('/dashboard')`, hard-coded,
      and every brand-new account is sent through that wizard — so a NEW gym
      owner would have finished five setup screens in the member app and never
      found their console. The door would have worked for everybody except the
      account it was built for.
- [ ] 🟡 **THE CONSOLE HAS NEVER BEEN OPENED ON A REAL PHONE — every "phone"
      check so far has been a NARROWED DESKTOP WINDOW.** Raised by the T3 on the
      crossing packet (L7, 2026-08-19) against the deferral rule itself: the fact
      was stated plainly in DECISIONS prose (:11706 — *"the phone was a NARROWED
      DESKTOP WINDOW, not a phone"*) and tracked NOWHERE, which is the exact
      shape CLAUDE.md names as how work gets silently lost.
      **Why it matters and is not pedantry:** :9604 §4 is Kd's ruling that the
      console is REACHED FROM THE PHONE, and `ConsoleLayout` exists as its own
      shell precisely because `AppLayout` pins `marginLeft: 256` with no
      breakpoint (:10402). A desktop window dragged narrow proves the CSS
      breakpoint fires; it does not exercise a real viewport, touch targets, the
      on-screen keyboard over the create-gym form, or Safari/Chrome mobile.
      **What is already covered, so this is narrower than it sounds:** the
      breakpoint swap and the phone bar's Sign out are pinned by tests and by
      mutant D14, and the console smoke passed 11/11 at both widths on a desktop.
      **What is owed is one sitting on an actual handset**, against the existing
      `RUNBOOK/smoke-login-door.md` steps 5–6 plus the console sheet.
      **Not a blocker for the crossing packet** — it is a pre-existing gap the
      packet made visible rather than one it created.

- [ ] 🟡 **MEMBER MIGRATION FROM A COMPETITOR APP — Kd ruling 2026-08-18
      (DECISIONS :9809): a SYSTEM, built now, not a favour to the first
      customer.** The spec has member EXPORT only (`03-part3-org-console.md:105`,
      `:212`) and its only inbound path is self-join by code — this is an
      addition with no governing §. Three parts, in the Stage-1 card family by
      construction (it writes the gym/roster tables):
      **(a) roster rows WITHOUT a user account** — an "imported, not yet joined"
      member state, so a 1000-member gym sees its whole roster on day one;
      **(b) ONE upload screen with column mapping** — the owner points at their
      own spreadsheet's columns, preview shows duplicates/missing/unparseable
      BEFORE anything saves; mapping-at-upload is what makes one system fit
      every competitor with no format known in advance;
      **(c) ATTACH-ON-JOIN — the load-bearing part:** a member who installs and
      enters the gym code matches by exact phone/email to their EXISTING row.
      Without it import+join makes two records per person and the owner's count
      is wrong forever. **A match rule looser than exact needs a Kd ruling — a
      wrong attach hands one person's history to another (ownership,
      Critical/High by :5807).**
      **DESIGN SETTLED SAME DAY (DECISIONS :9870) — the card builds THIS:**
      auto-attach on verified email only, exactly one candidate row (phone is
      not an auto key — no verified phone exists); everyone else joins
      immediately and lands in a front-desk "who is this?" confirm queue; names
      never auto-match; a member never self-claims a row. **Kd's amendments:
      CSV AND XLSX (reader lib = R1.4 new-dep approval); the preview is the
      owner's correction surface (nothing saves until CONFIRM; fix in place,
      re-map, skip, or cancel-and-reupload; rows editable forever after;
      re-upload updates, never duplicates); works on phone and laptop via the
      one responsive console, preview built PHONE-FIRST.**
      **FORMATS RULED 2026-08-19 (DECISIONS :11309): `.csv`, `.xlsx` and legacy
      `.xls` — nothing else**, and an unsupported file gets a refusal NAMING the
      two rather than a silent failure. Kd: *"gym submits csv xl or other most
      used files fprmat and the backedn handles the things onward"*. The reader
      library must cover the legacy `.xls` case, and is still an R1.4 approval.
      **The pipeline is now a stated commitment:** gate by looking INSIDE the
      file never at its extension (R3.9/R2.3) → parse both formats into one row
      shape → infer columns → preview saving NOTHING → CONFIRM is the ONLY human
      step → write rows (name-only required, whole original line kept) →
      in-file dedupe and re-upload-updates → attach-on-join.
      **THE SENTENCE THAT CHANGES HOW THIS IS PITCHED: the human step is
      per-COLUMN, not per-ROW** — ~8 decisions whether the file holds 50 rows or
      5,000, with row-level attention spent only on rows the machine flags. It
      is the answer to Kd's *"3000 5000 members ... manully check all those
      numbers that a lot of work"*, and it needs to be true in the BUILD: a
      preview that asks the owner to scroll 5,000 rows has failed this line.
      **AND THE PART NO CODE DELIVERS: for a big gym, WE run the migration.**
      Verified by web search 2026-08-19 — GymMaster staffs a data-transfer team
      (*"particularly helpful"* above 150+ memberships), Gym Insight sells the
      same service, and even incumbents exclude financial history and bookings.
      **Kd already approves every gym by hand (:11072), so "email me your export"
      rides a call he is making anyway.** Operating answer only — **the app must
      promise no done-for-you migration.**
- [ ] ⚪ **PDF ROSTER IMPORT — NOT BUILT, and the condition to revisit is
      written down.** Kd 2026-08-19: *"ok pdf not needed"* (DECISIONS :11309),
      after being given the reasoning: nearly every gym PDF was printed BY
      software that also exports a spreadsheet, so the fix is one export click
      in THEIR system during onboarding; a scanned paper register needs text
      recognition whose misreads write wrong facts about other people (:5807's
      class, where the person harmed cannot see the error to correct it); and
      demand is unproven. **NOT struck — the trigger is a real PDF-only gym.**
      If one appears it re-enters BEHIND the same preview screen and changes
      nothing else in the design. Recorded so the ruling is not mistaken for
      "nobody thought of it".
- [ ] ❓ **MIGRATION SEAT POLICY — RESERVED FOR KD, blocks the import card's
      plan gate:** do 1000 imported-but-not-yet-joined members consume 1000 paid
      seats? Pricing policy; decides what an owner is told at upload time.
- [ ] ❓ **MIGRATION CONSENT — RESERVED FOR KD:** an owner uploads 1000 people's
      names and phone numbers before any of them has agreed to anything. Sits
      inside the open privacy-law question (:592), already on the critical path
      to a signed gym per :9604 §2.

- [ ] ⚪ **CLINICS ARE OUT OF THE PRODUCT — Kd ruling 2026-08-18 (DECISIONS
      :10248; the parent card is :10010). What PARKS with them, so nobody
      builds it and nobody ticks it.** His words: *"no click will be there only gyms and fitness
      centers"*, ruled when he was asked whether a clinic owner should be
      auto-enrolled in their own clinic and stamped with a consent record
      nobody collected. **This is the no-removal rule's AUTHORISED path** — an
      explicit ruling against a cited option — and it is recorded here because
      a ruling that deletes work still has to say WHICH work.
      **NARROWED AT THE DOOR, NOT DELETED:** `createOrgTypeSchema` accepts
      `gym|studio`; the §3.2 CHECK, the `clinic` value and the join-path
      consent gate are all untouched, so an existing row still reads and is
      still protected (pinned by a test that inserts one directly). No
      migration. Reopening is one value.
      **PARKED, NOT DONE:** Part 3 §2.3's clinic feature matrix (leaderboard
      off by default, "Inactive clients", caseloads), §2.2's clinic vocabulary
      overrides and the clinic copy LINTER that makes "rehab"/"treatment"/
      "therapy"/"diagnosis" build failures, and Part 2B §7's clinic
      positioning. **`studio` STAYS** — a boutique or PT studio is a fitness
      business, not a medical one; that call was stated to Kd in one line and
      not overruled, and it is why the trainer-scoping hold-back still has a
      live org type to apply to.
- [ ] ⚪ **`GET /v1/orgs/mine` IS CAPPED AT 100 AND HAS NO CURSOR** (T3 round 1
      L-4). A person belongs to one or two gyms and a multi-site owner to a
      dozen, so the cap exists to give the response a ceiling at all rather
      than because anyone is near it. Whoever first has a caller that could
      approach 100 owes the cursor — the roster reader next door is the
      worked pattern.
      **RAISED FROM ⚪ IN CONSEQUENCE, 2026-08-18: the console now DEPENDS on
      this list being complete.** `/console/:orgSlug` is resolved by matching
      the slug against `mine`, because the API is keyed by uuid and there is no
      by-slug route. So for anyone past the cap, a gym they really do staff
      reads back as "we couldn't find a gym you run at this address" — the
      truncation stops being a shape issue and becomes a door that will not
      open. Still nobody near it; still ⚪. **The fix is the cursor, or a
      `GET /v1/orgs/by-slug/:slug`, and whoever picks one owes this line.**

- [ ] 🟡 **THE DATABASE KD'S BROWSER READS STILL HOLDS THE PRE-RATIFICATION PRICE
      BOOK, AND MIGRATION `0015` IS NOT APPLIED TO IT — third recurrence of
      :15927/:20222, found 2026-08-27 (DECISIONS :21157).** Measured on the Neon
      dev branch that day: **six `org_*` rows from before :17366, all still
      `active = true`, at the OLD prices with caps 25–400 — and NONE of the ten
      ratified band rows.** The seed was corrected in code on 2026-08-25
      (`e894eef`) and never run there.
      **WHY IT BITES NOW rather than being untidy:** the trial picks the
      lowest-capped active org plan in the gym's currency, so on that database a
      gym would be handed **`org_micro`, a 25-seat plan with a 7-day trial**,
      instead of the 300-seat 30-day band Kd ruled. The local Postgres the suite
      runs against IS correct (verified the same day: ten bands, cap 300, 30 days),
      **so every green test in this card says nothing about what his browser would
      do** — which is exactly the shape :20222 recorded.
      **Two commands close it** (`drizzle-kit migrate` then the seed, both against
      that branch) and neither may be run without asking him first: it is his data.
      **The standing fix is still the boot-time refusal** the :20222 addendum
      called overdue — nothing in this repo notices a database that is behind.
- [ ] 🟡 **`org.manage` AND `billing.manage` HAVE NO TICK BOX, so an owner cannot
      delegate either through the product — found 2026-08-27, grep-verified
      untracked before adding (DECISIONS :21157).** `PRIVILEGE_COPY` in
      `apps/web/src/pages/console/staffView.js` holds **six** entries and
      `ORG_PRIVILEGES` now holds **eight**; the two missing ones are "edit gym
      details" (shipped 2026-08-26) and "manage billing" (shipped today).
      `PRIVILEGE_ORDER` is derived from that list, so a privilege absent from it is
      simply not drawn.
      **THE CONSEQUENCE IS A RULING THAT CANNOT BE PERFORMED, not a cosmetic gap.**
      Both privileges are deliberately absent from `OWNER_ONLY_PRIVILEGES`
      precisely so an owner CAN tick them across (:11429 rule 3 — *"ticks may
      widen, not just narrow"*), and the server honours it — proven by a test in
      which a manager is refused the trial, is ticked `billing.manage` by the
      owner, and then succeeds. **Only the screen cannot ask for it.**
      **NOT a data-loss risk, and this was checked rather than assumed:**
      `unknownPrivileges` collects ticks the build has no words for, carries them
      through a save UNCHANGED and says so on screen — a guard whose own comment
      predicted a billing tick by name. So an owner saving a staff row does not
      silently strip either privilege.
      ~~Closed by the same web card that draws the trial button, which is the next
      one; two rows in one array plus their words.~~
      **THAT PREDICTION WENT STALE AND IS STRUCK (2026-08-29).** The card that
      drew the trial button shipped (:23257) and closed nothing here — the
      deferral predicted its own future, which is :21353's recorded shape. It is
      still two rows in one array plus their words; nothing is owed but the doing.
      **AND THE COST HAS GROWN, MEASURED BY THE READ-ONLY CONSOLE'S T3 ROUND 1
      (:24141): this gap now makes two SCREENS unverifiable in a browser.** The
      Settings tab is drawn for `staff.manage || org.manage`. `staff.manage` is
      owner-only, `org.manage` cannot be given away — so a manager has no Settings
      tab, and an owner of a lapsed gym meets `PlanModal` instead of Settings.
      **Nobody can therefore see `GymDetailsPanel`'s or `StaffPanel`'s read-only
      state**, including the Enter-key guard C116 exists for. Their smoke steps
      were written, found unrunnable, and moved into that sheet's *"does NOT
      cover"* with the reason. Those guarantees rest on tests and mutants alone
      until this line ticks — **which makes this the cheapest way to buy back a
      browser check the project currently cannot perform.**
- [ ] ⚪ **`gitleaks detect` OVER FULL HISTORY EXITS NON-ZERO ON TWO FALSE
      POSITIVES IN `HANDOFF.md`, and they are not in `.gitleaksignore` — measured
      2026-08-27.** Both are the `generic-api-key` rule firing on the prose
      *"API half: `kcalPointForSetsV3`"* in handoff blocks from commits
      `9b54454a` and `84ff14d7` (2026-08-11): an 18-character "secret" that is a
      TypeScript function name. **Verified non-secrets before writing this line,
      and no value is reproduced here (R3.10).**
      Fix is two pinned fingerprints in `.gitleaksignore` beside the P2.1 entries
      already there, whose header sets the standard this must meet — *"Pinned
      false positives ONLY … Never add a real-secret fingerprint here"*.
      ⚪ because nothing is exposed; it matters because **a scanner that is
      routinely red is a scanner nobody reads**, and R3.6 puts gitleaks in CI and
      in the pre-commit hook that :3813's line says has never existed either.

### Member-side gym surface

- [ ] 🟡 **THE PACT — THE ONE FEATURE IN THIS PRODUCT NOBODY ELSE HAS, RULED IN
      FULL 2026-08-25 (DECISIONS :18128 §3).** Kd: *"excellent idea i like it"*.
      **Read the whole of :18128 §3 before writing a line of it — this summary is
      a pointer, not the design.** Strangers are paired; the pact lives only
      while everyone in it keeps showing up.
      **Ruled:** pair **or squad up to 4** · random **within a MUTUAL gender
      preference** · gym members choose own-gym or worldwide · **under-18s barred
      entirely** · **7/30/90 days, all three at launch** · survival rule is
      **never 3 days without training** and is never voted on · **one save per
      pact, two per squad** · the shared goal comes from **both ranking a top 3,
      best overlap, SPIN WHEEL on a tie** and is a **BONUS that can never kill the
      pact** · **no free text ever** — one-tap compliments only, **no daily cap**
      (Kd struck the chat's limit) · each sees the other's stats but **no photos
      until the end** · **reveal is automatic AND both are told on day one, which
      is where the consent lives** · leaving early keeps anonymity forever ·
      voting extends/ends (unanimous) and removes a quiet squad member
      (majority), **never the survival rule** · **no match ⇒ say so honestly,
      hold them in the queue, notify, invite a friend.**
      **BUILD PAIRS FIRST** (chat recommendation): four matching people is far
      harder to find than two. Block and report on every screen.
      **GENDER PREFERENCE IS FOUR VALUES, NOT TWO (Kd, :18128 §6.4):** `male` ·
      `female` · `other` · `prefer_not_to_say` — the same four `Onboarding.jsx`
      already offers, still matched MUTUALLY. **Do not re-propose an "anyone"
      option; it was superseded.** Known and accepted: **the pool fragments**
      (4 × 4 × 3 durations × gym/worldwide) and the small categories wait
      longest — the honest empty-state is the answer on record.
- [ ] 🟡 **FINISHING A PACT PRODUCES A JOINT PHOTO (Kd ruling 2026-08-25,
      DECISIONS :18128 §6.3).** **Read with the editor line and the gym-sharing
      line — this is a THIRD kind of stats overlay, not a reuse of either.**
      **TOTALS ONLY (Kd, §6.3a): ONE set of summed numbers for the whole pact —
      no per-person column, no breakdown, no names against figures.** Each
      person's own numbers stay visible **only inside the pact**. Editable,
      downloadable, postable to Instagram or anywhere.
      **THE CHAT OVERSTATED THIS AS "a new multi-column overlay" AND CORRECTED
      ITSELF: the LAYOUT is close to :17902's single-person overlay. What is
      genuinely new is the SOURCE** — summing several people across running AND
      workouts is a query nothing else in the product does. **Kd's clarification
      also removed every individual's figures from a gym feed, unprompted.**
      **It reaches a gym feed only when EVERY participant belongs to that same
      gym** — chat's stated working rule, not a Kd answer; a worldwide or
      two-gym pact still gets the photo, just no gym feed. There **the owner,
      the staff AND every member of that gym** see it and encourage them (Kd,
      §6.3b — an earlier draft said only owner and staff).
      **SHARING IS OPTIONAL — finishing a pact posts nothing (Kd, §6.3c) — AND
      ALL PARTICIPANTS MUST TAP YES (Kd, §6.3d).** Four in a squad means four
      yeses; **one no and it does not reach the gym.** **What unanimity does NOT
      block: each person may still download it and post it anywhere themselves.**
      It governs the GYM FEED only, that being the audience nobody individually
      chose.
      **The one thing not to discover late: it inherits the ONE-WEEK clock**, so
      a 90-day pact yields a picture gone in seven — **the download warning
      matters more here than anywhere else in the app.**
- [ ] 🔴 **RUN ROUTES MUST NEVER BE VISIBLE INSIDE A PACT — raised by the chat
      2026-08-25 (DECISIONS :18128 §3.3), NOT a Kd ruling, and it should not need
      one.** **Read with the Pact line above, before implementing "each sees the
      other's stats".** That phrase would otherwise include a run map, and
      `apps/api/src/db/schema/geo.ts:2` calls GPS polylines *"the most sensitive
      data in the app"*. **A route that starts at a front door is a home address —
      handed to a stranger, by the one feature that deliberately pairs strangers
      by gender.** **Numbers yes, maps never** — not during the pact, and
      arguably not after a reveal either. 🔴 because it is the feature being safe
      or not.
- [ ] 🟡 **A GYM GETS A PROFILE PAGE, AND A MAP OF GYMS COMES LATER (Kd ruling
      2026-08-25, DECISIONS :18128 §2.3).** The page shows the facilities the gym
      offers, visible to its members. **The MAP is explicitly deferred to "when
      more gyms join"** — it is worthless at 20 gyms, the same reasoning that
      puts nearby-gyms/day-passes last.
- [ ] ⚪ **TWO SMALL IDEAS KD KEPT 2026-08-25 (DECISIONS :18128 §2.5).**
      **(a) A live "X people are training right now" count** — no names, no
      ranking, no competition; works at any size and costs almost nothing.
      **(b) THE COMEBACK** — every app punishes a return by showing a lost
      streak, so people never come back. Yours welcomes them instead. Churn is
      the biggest enemy and nobody has tried being kind about it.
- [ ] 🟡 **GYM BRANDING ON THE MEMBER'S HOME — "Welcome to {gym}" plus their
      logo.** Nearly free: the gym logo is already part of console settings
      (9 spec hits in Part 3). High perceived value for the cost.
- [ ] 🟡 **GYM ANNOUNCEMENTS / UPDATES FEED TO MEMBERS.** Zero spec hits. Part 3
      §5.3's staff notifications are a different thing and must not be mistaken
      for it.
- [ ] 🟡 **MEMBER-TO-COACH / GYM-STAFF MESSAGING.** Zero spec hits.
      **Must not become a back door through Part 3 §2.4's visibility promise** —
      see the sharing line below.
- [ ] ⚪ **MEMBERSHIP CARD — plan, renewal date, gym contact.** Small, and it is
      the first thing members look for.
- [ ] ⚪ **CHECK-IN STREAK ("you have come 12 days this month").** Nearly free once
      QR attendance exists, and it is the strongest retention hook a gym has.
      Proposed by me and not contradicted; not a Kd ruling.
- [ ] 🟡 **THE MEMBER DASHBOARD IS THE NORMAL DASHBOARD PLUS A GYM HEADER — ONE
      SCREEN, NOT A MEMBERS' APP (Kd 2026-08-19, DECISIONS :11181).** He
      described it directly: same dashboard as a solo user, plus a welcome
      message with the gym's name, its logo if uploaded, the gym's updates,
      notifications, coach instructions, booking, products and messaging.
      **This is a CONSTRAINT, not a feature — it is recorded so nobody builds a
      second dashboard for gym members**, which is the expensive mistake
      available here. The pieces above are the pieces; this line is how they sit.
- [ ] 🟡 **CLASS AND SEAT BOOKING FOR MEMBERS — named by Kd twice and tracked
      NOWHERE until 2026-08-19** (grep-verified; :9604 §7 recorded it as an
      addition with ZERO spec hits, and no `OWED.md` line was ever written).
      Members *"book clasess"* / seats; the gym runs the schedule from the
      console. **Zero spec hits means every rule is invented at the card** —
      capacity, waitlists, cancellation windows and no-shows are each a decision
      nobody has made. Depends on nothing built today; it is a real subsystem,
      not a screen, and must not be sized as one.
- [ ] ⚪ **GYMS SELL THEIR PRODUCTS TO MEMBERS — named by Kd 2026-08-19, tracked
      nowhere before** (grep-verified). *"sell thier products"*. **This is money
      moving between a gym and its member, so it lands on the Stripe Connect
      path (:9604 §3) and cannot precede it** — a catalogue with no payment rail
      is a picture of a shop. ⚪ because nothing else waits on it.

### Plans, food and content

- [ ] 🟡 **PERSONALISED WORKOUT AND DIET PLANS FROM THE USER'S OWN INFORMATION.**
      Part 7 covers workout **programs** in depth (27 hits) so this is not
      greenfield; diet-plan generation is.
- [ ] 🟡 **A GYM COACH CAN AUTHOR A WORKOUT AND DIET PLAN FOR A NAMED MEMBER.**
      Zero spec hits. **Collides with Part 3 §2.4 unless routed through the
      member's own sharing consent** — a coach writing a diet will want to see
      what the member eats, and nutrition is on the never-see list. Kd's opt-in
      sharing ruling is the resolution; the implementation must actually use it
      rather than widening the boundary.
- [ ] 🟡 **THE USER CAN HAND-EDIT ANY PLAN THE APP GIVES THEM AND FOLLOW THEIRS.**
      Small, and it is what makes a generated plan tolerable when it is wrong.
- [ ] ⚪ **HEALTHY RECIPE SUGGESTIONS AND A GROCERY LIST FOR THEM.** `recipe`
      appears twice in Part 4 (a table only); `grocery`/`shopping list` return
      **zero** across the whole spec set.

### Photos and sharing

- [ ] 🟡 **IMAGE STORAGE DOES NOT EXIST AND MUST BE BUILT FROM SCRATCH.** Measured:
      `modules/nutrition/routes.ts:3` states photos are *"request-only"* — a meal
      image goes to the vision provider and is discarded — and `apps/api/src/
      config.ts` has no bucket or storage configuration at all. Kd wants meal,
      running and workout-completion pictures shared. R3.9 already specifies the
      five guarantees this needs: magic-byte content-type validation, size cap,
      server-generated keys, signed URLs, and no user-supplied filename ever
      reflected into a path or header. Add the DPDP/account-delete cascade.
- [ ] 🟡 **THE FOUR RETENTION CLOCKS — Kd rulings. AMENDED 2026-08-25: THE
      POSTED PHOTO IS NOW ONE WEEK, NOT ONE YEAR (DECISIONS :18128 §6.1).**
      Timed sweeps, not manual cleanup; the repo already has TTL-sweep patterns.

      | Thing | Lives | Note |
      |---|---|---|
      | Meal SCAN photo | **7 days** | Kd :17357, unchanged. **The nutrition data stays FOREVER** — only the image goes |
      | A POSTED photo (stats burned in) | ~~1 year~~ **1 WEEK** | **Kd 2026-08-25, :18128 §6.1.** Both copies go. **The explicit "download it, it goes in a week" warning is MANDATORY and ships in the same card as the sweep** |
      | Gym announcement | **1 year** | Kd :17357, unchanged. Gym may delete earlier, or pin one |
      | Coach video | **never expires** | Kd :17357, unchanged. The 20-per-gym cap is the control |

      **THE TWO-CLOCK POINT STILL STANDS AND IS NOW SUBTLER, SO READ IT: the scan
      photo and the posted photo are STILL TWO SEPARATE FILES WITH TWO SEPARATE
      ROWS.** Kd described them as one image (*"it is same single photo"*) and
      physically that is where it starts — scan, get stats, paste them on, post
      it — **but the moment stats are burned in it is a NEW file.** They now
      happen to carry the same 7-day length, **which makes it tempting to collapse
      them into one row. DO NOT.** They have different owners, different delete
      triggers and different consent (a scan is private data; a post was
      deliberately shared), and the moment either clock moves again the collapse
      becomes a bug. Same path for workout and running pictures.
      **:17357's recorded fear — a vanishing post reads as YOU deleting someone's
      work — is now LIVE rather than hypothetical, and the explicit download
      warning is the whole answer to it.** A sweep shipped without that warning is
      that defect.
      **DO NOT SHORTEN OR LENGTHEN ANY OF THESE FOR MONEY — measured, keeping
      every posted photo FOREVER at 500 gyms is $4.66/mo.** Retention here is a
      privacy and clutter decision; the cost argument was tested and collapsed.
- [ ] 🟡 **GYM-GLOBAL SHARING NEEDS REPORT-AND-REMOVE.** Kd ruled sharing is the
      member's choice, scoped gym-global or private (:9604 §6). **The moment a
      picture is visible to other members, a way to report and remove one stops
      being optional** — people post pictures of their bodies. Not a Kd ruling;
      raised here because shipping the feed without it is the defect.
- [ ] 🟡 **PART 3 §2.4'S PROMISE STANDS AND EVERY NEW SURFACE MUST RESPECT IT.**
      Gyms still never see meal logs, body weight, coach conversations, run routes
      or anything outside the membership interval — **except what the member
      deliberately shares.** The boundary is enforced in the repo layer (those
      queries physically cannot join those tables for org callers), not in the UI,
      and it must stay that way as messaging, coach plans and photo feeds land.
- [ ] 🔴 **A TERRITORY POLYGON PUBLISHES WHERE SOMEBODY LIVES — IT NEEDS THE
      200 m END-TRIM (raised by the chat 2026-08-24, DECISIONS :17357; not a Kd
      ruling, and it should not need one).** **Read before writing ANY line of
      the territory feature.** `apps/api/src/db/schema/geo.ts:2` calls GPS
      polylines *"the most sensitive data in the app — org-invisible (Part 3
      §2.4)"*, and a captured area drawn around a person's neighbourhood is that
      data published to strangers by design. **Part 6 §5.4's 200 m end-trim
      already exists for shared route thumbnails; the territory polygon takes the
      same trim.** Without it a user's flag lands on their own house. 🔴 because
      it is not a polish item — it is the feature being safe or not.

### Dropped and parked

- [ ] 🟡 **COACH-UPLOADED INSTRUCTION VIDEOS — UN-STRUCK 2026-08-24 (DECISIONS
      :17357). THIS LINE WAS STALE FOR A DAY AND A CHAT ALMOST INHERITED IT.**
      It read *"~~DROPPED BY KD 2026-08-18~~"* on his *"ok will not upload
      video"*. **:17012 (2026-08-24) had ALREADY reversed that** — 20 videos per
      gym — and he confirmed it a third time the same day. **The strike is
      removed; the history stays visible here deliberately, because the lesson is
      that a reversal recorded in DECISIONS does not un-strike its own OWED line
      and somebody must do it in the same commit.**
      **THE RULED SHAPE: 1 minute each · 20 per gym · the gym deletes to make
      room · NO EXPIRY.** The 20-cap IS the storage control — measured $2.78/mo
      at 500 gyms held forever — so expiring a "how to squat" video only makes
      the coach re-upload it. Video goes to **R2, never Cloudflare Stream**
      (:17012 §5: Stream bills per minute WATCHED, so popularity is the bill).
- [ ] ⚪ **~~IMPORT A GYM'S DATA FROM A COMPETITOR MANAGEMENT APP — PARKED.~~
      SUPERSEDED IN PART by Kd's ruling 2026-08-18 (DECISIONS :9809):** *"i
      obvisoulsy can not wait untill someone joins i need to make the system"*.
      The UNIVERSAL spreadsheet import moved into the plan — its 🟡 lines live in
      the console section above. **What STAYS parked, and only this:**
      per-competitor one-click importers ("connect your Glofox account"-style),
      which genuinely are written against a real customer's real export file.
      Not ticked — rewritten.
- [ ] ⚪ **GYM PAYMENT FEATURES BEYOND THE CONNECT INTERFACE — PARKED** until a
      real gym asks for them.

## Open questions awaiting a Kd ruling (nothing built on these)

- [ ] ❓ **THE SEVERITY GATE NEVER ASKS "CAN A USER GET HERE?" — and on
      2026-08-28 that cost a Critical/High tag, an escape-hatch firing and a
      ruling from Kd, all on a defect no user could reach. RAISED 2026-08-28
      (DECISIONS :22029), HIS TO SETTLE.**
      **What happened, measured:** the console's stale-state defect was tagged
      Critical/High and armed :5348's hatch. Kd ruled REDESIGN. **Then, while
      writing the smoke sheet, the journey turned out not to exist** — the
      console has no gym switcher, every path between two gyms goes through
      "Your gyms", and that unmounts the screen. Gym A's join code appears **x0**
      under gym B with the fix and **x0** without it. He was told before anything
      was committed and ruled **KEEP** the fix.
      **Why the gate did not catch it:** :5807 1a asks whether a user could see
      something FALSE. Both the reviewer and this chat answered that from what
      the COMPONENT does under a gym change, and the component does show gym A's
      code. **Neither asked whether the app draws a path to that state**, which
      was the whole question.
      **THE QUESTION, in one line: should a Critical/High tag require naming the
      journey a user takes to reach it?** Recommended YES and cheap — one clause
      in the T3 prompt asking the reviewer to name the clicks, which also makes
      the smoke sheet fall out of the review for free. **The cost of NOT doing
      it is not a missed bug — it is Kd being asked to rule on something that
      was not happening**, and rulings are the scarcest thing on this project.
      **Against it:** an unreachable leak is still real (this one needed only a
      link to become visible), so the answer must not become "unreachable ⇒
      ignore it". The tag would change, not the fix.
      **A chat must not resolve this on its own** — it changes :5348/:5807, which
      are his.

- [x] 🟡 **~~❓~~ CANADA, THE UK AND THE EURO AREA CANNOT START A TRIAL AT ALL, because
      the app and Kd's own ratified price book disagree about what they pay in —
      RAISED 2026-08-27 (DECISIONS :21157), ~~HIS TO SETTLE~~ **SETTLED 2026-08-28
      (DECISIONS :22215): THEY PAY IN US DOLLARS.** His words, given while ruling
      the forced trial prompt in the same message — *"A forced trial pop-up traps
      gyms in Canada, the UK and Europe. they also pays in dollar"* — which is the
      recommendation below and what :17366 already ratified. **It is no longer a
      question and is now a small BUILD**: map `CA`, `GB` and the twenty euro-area
      countries to `USD` in `COUNTRY_CURRENCY` (`packages/shared/src/orgs.ts:88-96`),
      with the tests that pin what a gym in each country is billed in. **Ships with
      the forced-trial card, because that card is what turns this from a shrug into
      a brick wall at signup.** The no-fallback rule (:10010) is untouched: a
      country not in the map is still refused outright.
      **DONE 2026-08-28 — the forced prompt's SERVER half (DECISIONS :22921).**
      `COUNTRY_CURRENCY` now maps `CA`, `GB` and the twenty euro-area countries to
      `USD`, with the country→currency table asserting all six rows and a Canadian
      gym starting its trial on the dollar band end to end (`orgs.plans.test.ts`).
      **It shipped in the same card as the price list, exactly as this line asked,
      because that card is what turns the gap into a wall.**
      **THE PERMANENT GUARD IS WORTH MORE THAN THE FIX** (:5348 rule 5): a test
      walks EVERY supported country and fails if one of them reaches an empty price
      book, so the next country added without prices is caught here rather than by
      its owner. This gap lived for eleven days and it took Kd noticing.
      **NO BACKFILL WAS NEEDED AND THAT IS MEASURED, NOT ASSUMED**: `currency_display`
      is recomputed only when a gym's country changes, so a stale CAD row would keep
      it for ever — there are zero CA/GB/euro-area gyms on either database. The trap
      is recorded in the map's own comment for whoever re-rules it.
      **The `no_plan_for_currency` refusal is KEPT, re-pointed at the mechanism**
      rather than deleted, so it still guards :10010 for any future currency.

      **The reasoning that produced the question, kept because it is the reasoning
      behind the answer:**
      **The disagreement, both sides measured:** `COUNTRY_CURRENCY` in
      `@app/shared` maps **CA → CAD, GB → GBP and all twenty euro-area countries →
      EUR** (written 2026-08-18 at :10010, from his *"usa india candan and europe"*
      ruling), while the seeded price book has **USD and INR rows only** — and
      :17366 ratifies the book as **"US · CANADA · EUROPE, one USD book"**. So the
      currency the app stamps on a Canadian gym is a currency no plan exists in.
      **What happens today:** the gym is created normally and the trial answers 409
      `no_plan_for_currency` with *"We're not open for business in your country
      yet"*. **That is deliberate and is the safe direction** — :10010's standing
      rule refuses a fallback currency, because a fallback is how a Canadian gym
      gets quoted in rupees — but it is not what he ratified.
      **THE QUESTION, in one line: should Canada, the UK and the euro area be
      billed in US dollars, as the ratified book says?** Recommended YES, because
      it is what :17366 already says and it needs no new prices; the alternative is
      three more currency books he has never priced. **A chat must not resolve this
      on its own** — :16702's fabricated ruling is what happens when one does.
      Whichever way it goes, the fix is small: either `COUNTRY_CURRENCY` maps those
      countries to USD, or the seed grows CAD/GBP/EUR books. **Until he rules, the
      refusal stays and no fallback is invented.**

- [x] ~~❓ **HOW LONG DOES A PHOTO SHARED TO THE GYM LIVE?**~~ **CLOSED
      2026-08-25 by Kd: ONE WEEK, both copies, gone (DECISIONS :18128 §6.1,
      commit below).** Supersedes :17366's *"posted photo · 1 year"* row. The
      chat's one-week-in-feed / one-year-in-history alternative was put to him
      and **REJECTED**. The build requirement moved to the 🟡 sharing line.
- [x] ~~❓ **THE PACT NAMES TWO GENDERS AND THE SCREEN OFFERS FOUR.**~~
      **CLOSED 2026-08-25 by Kd (DECISIONS :18128 §6.4, commit below): `other`
      and `prefer_not_to_say` become PAIRING OPTIONS**, so the preference list is
      the same four values onboarding already offers and the mutual rule is
      unchanged. **The chat's "ANYONE" idea is superseded — do not re-propose
      it.** The build requirement moved to the 🟡 Pact line.
      Instrument note kept: the chat first said the field did not exist, then
      that it could be skipped — **both wrong; only reading the schema AND the
      screen gave the true shape.**
- [ ] ❓ **GYM BANDS 3–5 (USD) AFTER KD RAISED BANDS 1–2 — HE NAMED TWO NUMBERS
      AND ONLY TWO (DECISIONS :17902, 2026-08-25).** $30 → **$35** and $40 →
      **$50**; $69 / $99 / $129 were not mentioned and **are unchanged until he
      says otherwise.**
      **DO NOT scale them by the same ~17%.** :17366 §0 is the recorded lesson,
      from the day before: *"an inferred ruling is not a ruling"* — that session
      caught itself about to read "as discussed" two ways worth ~$18,600/yr and
      asked instead. **Same discipline here.**
      **The thing nobody has computed and that this question should carry when it
      is put to him: raising band 1 by 17% while band 3 stands flattens the
      curve** — price per member now falls faster as a gym grows than :17366's
      margin table assumed. Measure it before proposing anything; it may be fine.
- [ ] ❓ **THE ENTIRE INR GYM BOOK AFTER THE USD RAISE (DECISIONS :17902).**
      ₹1,500 / ₹2,500 (Kd's own numbers at :17366) and ₹4,500 / ₹6,500 / ₹8,500
      (chat-chosen, un-overruled) were **not touched on 2026-08-25** and are not
      inferable from the USD change. **The BOUNDARIES do move** — 0–300 / 301–500
      / 501–1000 / 1001–1500 / 1501–2100 — because a boundary is a member count,
      not a currency; that is mechanical and is already ruled. **The PRICES are
      not.**
- [ ] ❓ **THE ORG YEARLY BOOK — TWO CONVENTIONS NOW EXIST AND ONLY ONE IS
      RULED (2026-08-25, the seed card).** Kd was asked what a YEARLY individual
      plan costs now that a month is $10, and answered **"one month free"** —
      so the consumer yearly rows are seeded at **eleven months' money** ($110,
      ₹4,939). **`05-part5-billing.md:91-97` gives the ORG column a different
      convention: ×10, "2 months free".** Nothing forces them to agree — a gym
      and an individual are different buyers — but **no org yearly row is
      seeded**, so the question is open and nothing is inferred. **Do not seed
      an org yearly row on either convention without asking him.**
- [ ] ❓ **₹4,939 IS EXACTLY ELEVEN MONTHS AND LOOKS IT (2026-08-25, the seed
      card).** ₹449 × 11. Kd was told the figure and offered ₹4,999 instead when
      the plan was approved; he did not pick, so the exact arithmetic stands.
      **One line to change if he ever wants the rounder number.** Blocks
      nothing — nobody can buy anything yet.
- [ ] 🟡 **"CUSTOM ABOVE 2100" HAS NO ROW AND NO PROCESS (2026-08-25, the seed
      card).** The ruled book says "custom" above 2,100 members and the seed
      deliberately writes **no row** for it — a plan row carrying no real price
      is a number waiting to be read as one. **So a 2,101-member gym cannot be
      put on a plan by any existing path**, and the biggest customers are the
      ones with no route in. Needs a decision at the billing card: a bespoke row
      per deal (fine at these volumes) or a real "enterprise" plan.
- [ ] 🟡 **THE TRIAL HAS NUMBERS BUT NO MECHANISM (2026-08-25, the seed card).**
      `plans.trial_days` now carries Kd's ruled lengths — **30 for a gym**
      (:16548, superseding the spec's 7) and **7 for a paid individual** — and
      **nothing in the product reads that column** (grep-verified). Nothing
      starts a trial, ends one, or tells anybody it is running. The billing card
      owns it. **Recorded so nobody reads a correct number in the database as a
      working feature.**
- [ ] ⚪ **NOTHING READS `plans.active`, INCLUDING THE SIX ROWS THE SEED CARD
      JUST RETIRED (2026-08-25).** The pre-ruling org book is switched off
      honestly, but the flag is bookkeeping until a plan picker exists —
      **any code that lists plans for a buyer MUST filter on it**, or a gym
      gets offered ₹999 for 25 seats. There is no such code today, which is why
      this is ⚪ and not louder.
- [ ] ❓ **DOES THE GYM RAISE MOVE THE INDIVIDUAL TIER? (DECISIONS :17902.)**
      $10/mo international and $5 India were ratified at :17366 and were not
      mentioned in that day's raise. **Unchanged.**
      **CORRECTION 2026-08-25 (the seed card): this line said "$5 (₹449) … were
      ratified at :17366". The rupee figure was NOT.** That entry's own words
      are *"Paid, India — **$5** → chat recommends **₹449**"* — a
      recommendation, and reading it back as a ruling is :16702's fabrication
      class. **It is a ruling NOW**, because the seed card put it to Kd
      explicitly before seeding it and he chose ₹449. Corrected here rather than
      only where it was noticed (:5748).
      Worth putting to him with one
      measured fact beside it: **Paddle's flat 50¢ makes a $10 subscription cost
      10% to collect (≈14.7% on ₹449) against 6.4% on a $35 gym plan**, and the
      app stores take 15% under $1M/yr — so the individual tier is the one where
      the collection fee actually bites.

- [ ] ❓ **NEARBY GYMS AND PAID DAY PASSES — WANTED, NEVER SIZED OR SEQUENCED.**
      Kd 2026-08-18: a user with no gym, or away from their own, searches gyms
      near their location and *"tempriraily join the nearest gym by paying fees"*,
      with joined gyms able to offer the service. **Zero spec hits for `nearby` or
      `day pass`.** Recorded as WANTED, not APPROVED (DECISIONS :9604 §8).
      **Two things make this last in any sequence, not first:** it needs the
      Stripe Connect money path live, and it is **worthless until many gyms have
      already signed up** — a day-pass search across three gyms finds nothing.
      Nothing is blocked on the ruling today.
- [ ] ❓ **PAID FRIEND/FAMILY INVITES AND TRAINING TOGETHER — WANTED, NEVER
      SIZED.** Kd 2026-08-18: users invite friends and family *"(not free of cost
      obviously)"* and *"do exercise together"*. `together` returns 1 spec hit;
      effectively new. **The paid-invite half is ordinary work. The "together"
      half is not** — two people in one live session is a different class of
      problem from anything built so far, and it needs its own ruling on what
      "together" means (same room · same time remotely · same plan, compared
      afterwards). Each of those three is a different product.
- [ ] ❓ **NEARBY-RUNNER CONNECTION — AND A SAFETY QUESTION THAT CONSENT SETTINGS
      DO NOT ANSWER.** Kd 2026-08-18: runners connect with nearby runners, *"but
      user privacy will be very imoortant and if user does nit want there will be
      no sharing"*. **His privacy instinct is right and is not the whole
      problem.** Privacy is *"do not share my data"* and an opt-in switch answers
      it. Safety is *"do not help a stranger learn where someone runs alone, on a
      schedule, every week"* — and a user who opts in has answered the first
      question without being asked the second. Put to Kd on 2026-08-18 and not yet
      answered. **Nothing may be built here until it is** — this is the one item
      on the 2026-08-18 list where shipping the obvious implementation is worse
      than shipping nothing. Zero spec hits.
- [x] ~~❓ **THE 5-DAY CONSUMER FREE TRIAL**~~ — **RULED 2026-08-24 (DECISIONS
      :16548). THE TRIAL EXISTS: ONE WEEK, UNLIMITED, THEN 3 MEAL SCANS/DAY.**
      Not five days; not :9944's 8/day. **The recommendation on record was to
      DROP it and Kd ruled the other way** — so
      `05-part5-billing.md:292-293`'s "Consumer trials: none" is now a KNOWING
      deviation, and a chat that finds the prohibition must cite this ruling
      rather than treat the trial as an error to correct.
      **THREE THINGS THIS RULING DID NOT DISPOSE OF — each keeps its own line
      below, and none may be inferred from the ruling:** the farming attack
      (answered only by a recommended, unratified 20-scans/day cap) · whether
      badges and progress move behind the trial (a REMOVAL of a live free
      feature; still needs its own explicit ruling) · the seed change itself.
      The original text is kept below because its reasoning is still the
      evidence base.
- [ ] ❓ **[SUPERSEDED — see the ruling directly above; kept for its reasoning]
      THE 5-DAY CONSUMER FREE TRIAL — KD'S PLAN WANTS ONE, THE SPEC FORBIDS
      ONE BY NAME, AND HE HAS NOT RULED (2026-08-19, DECISIONS :11181).**
      His plan: exercises free always, but personalised plans, recommendations,
      8 meal scans/day, progress tracking and badges free for FIVE DAYS only.
      **`05-part5-billing.md:292-293` says: "Consumer trials: none — permanent
      free tier is the funnel (v1 §9.1; unchanged, restated so nobody
      'helpfully' adds one later)"**, and v1 §9.1:626-629 gives the reason (a
      permanent free tier converts better than a time trial for an unknown solo
      app).
      **HE ASKED THE RIGHT QUESTION ABOUT HIS OWN IDEA:** what stops someone
      registering a second email for another five days? **The answer put to him:
      nothing cheap does — the attack exists only because the trial does.**
      Recommendation on record is to DROP the trial; if it stays, **only a CARD
      before the trial starts holds**, which costs real signups on a $3.99–$5
      product. Priced rather than argued: $0.00212/scan (:9944) ⇒ **$0.085** per
      farmed five days, against a farmer losing their history, streak and badges
      every time. **He moved to the next topic; nothing is built either way.**
      **RULED WITH IT, IF HE RULES FOR THE TRIAL: do badges and progress move
      behind it?** They are free forever today — `00-architecture-v1.md:611`
      (logging, streaks, badges ✅ unlimited on Free) and ungated in code (only
      coach, geo and nutrition consult entitlements) — **so moving them is a
      REMOVAL of a live free feature and needs an explicit ruling against the
      cited option, not a plan sentence.**
      **Blocks nothing today. Blocks the billing card and any seed change.**
- [x] ~~❓ **A PAYING GYM'S MEMBER GETS FEWER MEAL SCANS THAN A $6.99 CONSUMER —
      5/DAY vs 20/DAY.**~~ **ANSWERED AND CLOSED 2026-08-24 by Kd (DECISIONS
      :17357) — not built, RULED, so it leaves this file by ruling.** He gave
      the reason himself: *"its beacuse not finnacially possible to give gym user
      20 scans"*, and **it measures correct — 20/day for gym members is
      UNDERWATER in three of five bands** (the $40 band would cost $48.50). The
      structure, recorded so it is never re-argued: an individual pays **$10 per
      head**, a gym pays **$0.10 per head**, so the individual can eat 4× the
      scans. **The gap is therefore an UPSELL, not a defect, and needs NO CODE**
      — `mergeEntitlements` already hands a user holding both grants the better
      one, so a gym member who wants 20/day buys the $10 subscription.
- [ ] ❓ **WHERE THE FOLLOW-ALONG REFERENCE FOOTAGE COMES FROM — ANSWERED FOR
      HIM 2026-08-19 (DECISIONS :11534), STILL NOT CHOSEN.** Elaborates the
      clause the follow-along line above already carries ("still owed inside
      the card and Kd's to give"); it is repeated here because that line sits
      far from this section and the answer is now long enough to lose.
      **Three options, all live:** film a real person (cheapest per exercise,
      unambiguously correct form, no pipeline, no legal question — what the big
      fitness apps ship) · **motion-capture an expert clip onto a rigged 3D
      model** (his own proposal — free extraction tools, Mixamo rig, Blender
      retarget; **the Blender half is scriptable and headless, the clip and the
      judging are his**) · buy a ready-made exercise mocap pack (**UNVERIFIED
      whether one covers these 58**).
      **THE DISTINCTION HE DREW AND A LATER CHAT MUST NOT FLATTEN: AI video
      GENERATION invents motion and is a NO for demonstrations** (:5807 — a
      demo subtly wrong teaches wrong form, in the one area this app claims
      expertise), **but MOTION CAPTURE copies a real body, so that objection
      largely dissolves.** AI generation is a YES for MARKETING.
      **The argument for the 3D route: ONE capture renders the same rep from
      the FRONT and the SIDE at any resolution** — which also permanently fixes
      the shipped GIFs' measured size problem (600×600 at best, 220×119 for
      jump squat), needs no model release and never needs re-shooting.
      **RECOMMENDED: prove it on ONE exercise (squat — his clips already exist
      at `Desktop\traces`) before committing to 58.** Measured, not assumed:
      **Blender is not installed on the dev machine.**
      **THIS BLOCKS NOTHING.** :9452's rule stands: artwork is its own track and
      must not hold up the follow-along card — one placeholder proves the mode.
- [x] ❓ **ANSWERED BY KD 2026-08-18 — IT MEANS RUNNING THE BUSINESS
      (DECISIONS :9604).** He answered the third bullet of "THE RULING NEEDED"
      below by simply listing what the console must do: *"Gym management ├──
      Members ├── Attendance ├── Classes ├── Workouts └── Payment interface"*,
      with fees flowing `Stripe Connect → Gym's Stripe account → Gym bank`. That
      is **gym OPERATIONS**, the reading this entry itself called *"a different,
      much larger product with established competitors in every market"*.
      **THE ENTRY'S WARNING WAS CORRECT AND IS NOT WITHDRAWN — it was overruled
      with the cost stated.** Kd was shown, before ruling, that attendance,
      classes, coach messaging, gym-set pricing, coach-authored plans, grocery
      lists, day passes and the competitor importer return **ZERO hits across the
      entire spec set**, and that gym-collected payments are a business-model
      addition rather than a feature. He proceeded. The "integrate rather than
      build" third option was NOT taken.
      **CONSEQUENTLY the retention framing in §1 is no longer the whole product,
      and no chat may cite it to refuse operations work.** The new surface has its
      own section above (*Gym platform — Kd's 2026-08-18 product rulings*).
      **Kept, not deleted:** everything below is the analysis that sized the
      decision correctly, and it is the reference for what Part 3 already
      automates versus what is now owed.

      **THE ORIGINAL QUESTION, KEPT VERBATIM AS THE ANALYSIS (no longer an open
      item — it is answered above):**
      **DOES "GYM MANAGEMENT" MEAN RETENTION, OR RUNNING THE BUSINESS?**
      Raised by Kd 2026-08-16, in his words: *"is this gym management section
      really good will it allow owners to automate things? i want that so less
      work and more efficient for gym owners and easy way to manage their
      business"*. **Write the answer down before promising anything to a gym**,
      because the two readings sell differently and build differently.
      **WHAT PART 3 ACTUALLY SPECIFIES — verified by reading it, not assumed.**
      It automates real work, and the valuable part is what happens with the
      owner doing nothing: a monthly PDF report **generated and emailed** on the
      1st at 06:00 org time (§4.5) · a **weekly digest** Monday 09:00 org time
      with the at-risk count and a deep link (§5.3) · **at-risk members detected
      automatically** with one-tap Nudge (§4.3, §4.5) · **seat-pressure, trial
      D-5/D-1 and payment alerts** firing on their own (§5.3) · a **30-second
      walk-in join** by code/QR/WhatsApp/poster with no staff data entry (§4.3).
      Its design law is explicit and good: *"the console is a retention
      instrument the org uses on its members, not an analytics toy. Every screen
      ends in an action … data that doesn't lead to an action is decoration and
      gets cut"* (§1).
      **WHAT IT DOES NOT DO, AND THIS IS THE QUESTION.** Nothing in Part 3
      collects the gym's OWN membership fees, tracks attendance or door access,
      schedules classes, runs a point of sale, or handles staff pay. Those are
      gym-OPERATIONS software — a different, much larger product with
      established competitors in every market, and it would change what a sales
      conversation promises.
      **THE RULING NEEDED:** does v1's console stay a retention instrument
      (recommended — it is what the spec is built for, what the engine makes
      uniquely defensible, and what one person can ship), or does the roadmap
      commit to gym operations as a later phase? **A third answer exists and may
      be the best one: integrate rather than build** — let the gym keep whatever
      it already uses for fees and attendance, and be the thing that makes
      members actually train. Nothing is blocked on this today; it blocks the
      moment a pitch deck or a pricing page describes the console.
      **Related and already corrected: the market is WORLDWIDE, not Jorhat**
      (Kd, same day; Part 3 §6.3 *Worldwide* already localises currency, drives
      boundaries from each org's timezone, and makes every console string a
      message key). Jorhat is the pilot. Any argument that reasons from Indian
      market conditions alone is suspect — see the struck clause on the wearables
      line above for one that was.

- [ ] ❓ **Privacy-law scope beyond DPDP** (raised by Kd 2026-07-21). Should the
      product satisfy EU/UK GDPR, US state laws (CCPA/CPRA), Brazil's LGPD —
      not DPDP alone? The spec is partly with him: Part 4 §5.2:829 heads the
      flow "DPDP/GDPR", 2B:538 says "under India's DPDP Act 2023 and GDPR for EU
      users" — but it never enumerates the GDPR deltas and never mentions
      CCPA/LGPD. **Engineering assessment:** the worker's MECHANISM is common to
      all of them (hard-delete pass + JSON export); the deltas are mostly TIMERS
      (DPDP 14 days · GDPR "without undue delay", conventionally ≤30 · CCPA 45)
      and metadata, so building it now boxes nothing in PROVIDED the window is
      one named constant. **Not code, and Kd's alone:** lawful basis, consent
      records, privacy notice, breach notification, DPAs, an EU representative,
      and whether the product is even offered in those jurisdictions at launch.
      "India-only at launch, widen before an EU/US launch" is a legitimate
      answer that leaves the worker card unchanged.
- [ ] ❓ **Leaderboard sequencing** — see the 🔴 leaderboard line above. Kd must
      choose: land a minimal read before cutover, or accept a dark window.
- [ ] ❓ **`capture="environment"` trade-off** — keep as-is (A), drop `capture`
      so phones offer a Take-Photo/Library chooser (B), or two explicit buttons
      (C). Recommendation: A now, C later only if the owed phone smoke shows the
      gallery limitation actually bites.

---

## Done (kept, not deleted — the record of what closed and when)

- [x] argon2id rehash-on-login — merged 2026-07-15, PR #28.
- [x] Onboarding/fitness-profile storage — merged 2026-07-16, PR #30.
- [x] Vision model migration (Scout → qwen/qwen3.6-27b, prices re-quoted) —
      2026-07-16, during web Card 5a.
- [x] Dishware in-flow UI + portion API — Card 5c2, 2026-07-18.
- [x] Food synonym/alias matching — Card 5c, 2026-07-17 (residuals above).
- [x] Meal composition (add/remove ingredients) + change-label — Card 5c.
- [x] Previous-days meal view — Card 5d, 2026-07-19.
- [x] Settings profile forms → new API — Card 7, 2026-07-20.
- [x] Nutrition targets, API + web halves — PR #42 + commit aa362ce, 2026-07-21.
- [x] ~~Desktop webcam capture~~ — **WON'T BUILD**, Kd ruled 2026-07-19. Not a
      removal: no meal-photo webcam was ever built, Part 2B §3 mandates no
      capture mechanism, and nobody is blocked (the file picker already works on
      desktop). A laptop webcam is a worse input to 2B's portion problem and
      would burn paid vision calls on poor photos.

- [ ] ⚪ **The duplicate-key guard has one blind spot: a test that silences
      `console.error` with its own mock.** `apps/web/src/test-setup.js` (added
      2026-08-26, T3 round 5 L-1, :20986) fails the run on React's
      `Encountered two children with the same key` — the class that cost four
      review rounds on the console's Settings screen (:20867). A test that does
      `vi.spyOn(console, 'error').mockImplementation(() => {})` replaces the
      guard's wrapper for that test's duration, so an offence inside it is
      unseen. **Exactly one test does this today: `xpDisplay.render.test.jsx:219`**,
      and it silences deliberately, for a subject unrelated to keys. Not fixed in
      round 5 because widening the guard means editing a test whose subject is
      something else — a drive-by under R1.1. Close it either by having that test
      silence only its own expected message, or by giving the guard a channel a
      spy cannot replace.

- [ ] ⚪ **THE SWEEP'S TWO HELD NUMBERS CAN DISAGREE WITH WHAT IT ACTUALLY DID —
      deferred 2026-08-30 from the held-application card's T3 round 1 (Low-1),
      DECISIONS :25450.** **Read before building the payment card, and before
      moving anything in `sweep.ts` between the due count and the expiry.**
      `sweepJoinApplications` counts `due` / `due_on_plan` OUTSIDE any
      transaction and the expiry re-evaluates the same `gymOnPlan` condition
      INSIDE its own, so a subscription committing between the two makes a row
      counted into `heldNoPlan` actually expire: `heldForNotice`
      (`dueOnPlan - expired`) can go **NEGATIVE** and `heldNoPlan` reports a row
      that is gone. **Log-only — no user sees it, no row is harmed, and nothing
      is deleted that should not be.**
      **UNREACHABLE TODAY, MEASURED NOT ASSUMED:** one `INSERT INTO
      subscriptions` (the trial, refused to any owner who has ever had one) and
      one `UPDATE` (the expiry), so nothing can put a lapsed gym back on a plan
      at all, let alone mid-sweep. **THE PAYMENT CARD IS THE COMMIT THAT MAKES
      IT REACHABLE**, which is why it is written here and named on Paddle's line
      rather than left in `BACKLOG.md` alone.
      **THE FIX IS NOT A CLAMP.** Clamping `heldForNotice` at zero hides the
      drift and leaves `heldNoPlan` overstating; the honest fix is to take BOTH
      readings inside the expiry's transaction, so one snapshot answers both.
      **Deferred rather than fixed because Kd approved a fix round whose stated
      scope was "log the minor finding"** and widening an approved plan mid-round
      is the drift R1.1/S4 exist to stop — he was told in the round summary and
      can overrule.

- [ ] ⚪ **THE MUTATION HARNESS BLAMES THE FILTER WHEN THE DATABASE IS THE
      PROBLEM — found 2026-09-03 by walking into it (DECISIONS `:31921` §4).**
      **Read before re-anchoring an `expect` filter that a control step calls
      dead, and before trusting any `mutate-*.mjs` abort message's stated CAUSE.**
      A control run whose suite cannot CONNECT tallies zero tests, and
      `mutate-orgs.mjs` reports that as *"no test tally. That filter matches no
      test, so its mutants would prove nothing"* — naming a healthy filter as the
      fault. **The guard itself is sound and nothing ran** (:5199's class, doing
      its job); what is wrong is only the diagnosis, and the cost is a chat
      re-aiming a filter that was never broken. Hit here with a mistyped
      `DATABASE_URL`: the message survived a genuine credentials failure
      unchanged.
      **THE FIX IS TO TELL TWO THINGS APART: a suite that FAILED and a filter
      that MATCHED NOTHING.** Vitest reports them differently — a failed suite
      prints `Test Files 1 failed` with zero tests run, a dead filter prints
      `N skipped` and no failure — so the abort can name the real cause instead
      of guessing the likelier one.
      **NOT FIXED IN THE CARD THAT FOUND IT (R1.1):** that card's approved scope
      was the attendance date window, and it already touches this file to add a
      target and eight mutants. Widening an approved plan mid-card is the drift
      R1.1/S4 exist to stop — Kd was told and can overrule.

- [ ] ⚪ **THIS APP'S MODALS AND SHEETS HAVE NO FOCUS TRAP, AS A CLASS**
      (2026-09-03, raised by the calendar's day sheet — DECISIONS `:32197`).
      **Read before adding any overlay to `apps/web`, and before quoting a jsdom
      render test as evidence that a dialog behaves for somebody using a
      keyboard.** `WorkoutCalendar`'s `SessionDetail`, the forced plan prompt and
      the calendar's new `DaySheet` all open over the page with no `role="dialog"`,
      no focus move, no `Escape` handler and no trap — so a keyboard or
      screen-reader user tabs straight through into the page behind them.
      **NOT invented on the card that noticed it (R1.1)**: the sheet was built to
      match `SessionDetail` exactly, which is what :26586 and the `OWED.md`
      calendar line both asked for, and giving ONE overlay a trap would make the
      app inconsistent while leaving the class open.
      **THE INSTRUMENT PROBLEM IS THE REASON THIS IS ⚪ RATHER THAN A QUICK FIX:**
      :23578 records that a jsdom test cannot prove keyboard behaviour, so a trap
      written today ships as an unobserved guarantee — the thing this repo keeps
      finding. Whoever takes it decides how it is watched FIRST.

- [ ] 🟡 **A DROPPED REQUEST LOGS A MEMBER OUT RATHER THAN TELLING THEM TO TRY
      AGAIN** (2026-09-03, found by Kd at his own browser during the calendar
      smoke — DECISIONS `:32498`). **Read before writing any smoke step that
      turns the api off, and before treating a failed `/v1/auth/me` as a signed-
      out user.** His words: *"well when api was off i reloaded and was directed
      to login page did not show the word"*.
      **THE MECHANISM, verified in the code rather than inferred:**
      `AuthContext.jsx:98` catches ANY failure from `getMe()` and runs
      `adoptSession(null); setUser(null)`, so `ProtectedRoute.jsx:44` redirects
      to `/login`. **A 401 and a dropped connection are the same event to that
      `catch`** — one means "you are not signed in", the other means "we could
      not ask" — and the app draws the first for both. That is :8267/:8343's
      class (a failure drawn as a state) on the app's front door.
      **WHAT IT COSTS A REAL PERSON:** a member on a train through a tunnel is
      bounced to a login screen rather than shown a retry, and their cookie is
      very likely still valid. **No data is lost and nothing is deleted** —
      which is why this is 🟡 rather than 🔴.
      **PRE-EXISTING AND APP-WIDE, not the calendar's** (`git log -S` would date
      it to the Card 1 auth repoint). **Not fixed on the card that found it
      (R1.1)** — every protected screen in the app is downstream of that `catch`,
      and it needs its own decision about what a member is shown instead.
      **AND IT MAKES ONE SMOKE STEP UNRUNNABLE, which is how it was found:**
      `smoke-my-gyms-calendar.md` step 12 asked for the api to be stopped so the
      calendar's failed state could be seen, and the login redirect happens
      first. That step is STRUCK with the reasoning on the sheet.
