# SMOKE — a gym can fix its own details

**What changed, in one line:** a gym owner can now correct their gym's name,
city, country and time zone from the Settings screen. Until today none of those
could ever be changed after the gym was created.

## RESULT — PASSED (Kd, 2026-08-26, on commit `7236093`)

> **STEP 1 REWRITTEN AND RE-RUN — PASSED (Kd, 2026-08-26, on commit `428bbfb`,
> `git status` empty at the time).** He asked for the sections to collapse
> (*"i think there should be like drop down… other wise it will be a really long
> list"*), so step 1 now checks the tapping, the closed headings and the staff
> count that survives on a shut row — **none of which existed when he first ran
> this sheet**, which is why it was carried as UNRUN rather than folded into the
> pass below (:14840: a smoke that does not carry the shipping bytes).
>
> **Steps 2–9 are unchanged in what they ask and their pass stands on `7236093`;
> step 1's pass is on `428bbfb`.** Two commits, two runs, stated as two rather
> than merged into a single tick — the same care :17647 took, and for the same
> reason: what changed between them is the SCREEN those steps are read from.
> **What carries steps 2–9 across that change is mutants C67–C71 plus the 27
> staff and 6 gym call sites rewritten to open a section the way a person does,
> all green on the final bytes.**
>
> **NOT ESTABLISHED by step 1: the anti-silence rule.** A section opening ITSELF
> when its data fails needs the staff read to fail in a browser, which the sheet
> does not set up; it is carried by C68/C69 and their tests alone. **A step that
> blocks `/v1/orgs/:gymId/staff` in devtools is what would close it** — the
> nutrition card's own method (DECISIONS :589), and the honest way to see it.

**"all passed", and this one is CORROBORATED BY THE ROWS rather than resting on
the report** (:7929's rule — for anything a screen can only claim, design the
sheet to produce the rows and let them carry it). Five `org.updated` audit rows
reached the server, **each naming exactly ONE field**, which is the guarantee
this whole card turns on:

| time | `changed` |
|---|---|
| 08:01:24 | `["country"]` — from NULL to `US`, and `currency_display` came back `USD` |
| 08:14:23 | `["name"]` |
| 08:14:32 | `["name"]` (back again) |
| 08:14:44 | `["timezone"]` |
| 08:15:02 | `["city"]` |

**Five saves, five single-field patches, and not one of them mentioned the
country except the save that changed it.** That is C55 observed on live data
instead of in a fixture — the thing that stops a rename refusing itself once a
gym is paying.

**THE FIRST RUN WAS A PARTIAL PASS REPORTED AS A WHOLE ONE, AND THE DATABASE IS
WHAT CAUGHT IT.** "all passed" arrived with exactly ONE audit row in the entire
history of the table — the country. Steps 3, 5 and 6 had been read rather than
clicked. Asked which it was ("did you click Save, or look and move on?"), Kd
answered *"i skipped now it is saved"* and ran them, producing the four rows
above. **:14745's lesson holds and is now twice-proven: a global "all passed"
does not cover a step whose evidence is missing, and naming the doubt is what
produces the evidence.** Had the rows not been read, this sheet would carry a
9/9 for a run that never exercised saving at all.

**WHAT THIS PASS DOES NOT ESTABLISH — three things, stated rather than glossed:**

- **CLEARING a city was never done.** The city went `ohio` → `new yprk`; the
  box was never emptied. So `city: null` — the PATCH's whole point, mutant
  C58 — is carried by tests and by no human.
- **STEP 4 COULD NOT HAVE FAILED ON THIS GYM.** Its zone was
  `America/New_York`, which this machine's `Intl.supportedValuesOf` already
  lists, so the box would have shown it correctly whether or not
  `timezoneChoices` injects a missing zone. **The alias case the step exists for
  (:10402's measured `Asia/Kolkata` vs `Asia/Calcutta` gap) was NOT exercised**
  — :15927's step-7 shape, a step whose fixture cannot produce the state it
  claims to check. It is carried by C56 and its unit test alone. **A gym whose
  stored zone the browser calls by its other name is the fixture this step
  needs**, and that is what a future run should set up.
- **The currency lock is still unreached**, as the sheet already says below.

**THE GYM WAS LEFT MODIFIED** — city `new yprk`, zone `America/Mendoza` — i.e.
its day currently ends on Argentine time. Recorded because the sheet's own last
section asks for a restore and one did not happen; the same screen reverses it.

**IT ALSO COULD NOT START UNTIL A MIGRATION WAS APPLIED BY HAND**, which is its
own finding and is written up at DECISIONS :20075's addendum and on `OWED.md`'s
migration-gap line. Read that before running any browser smoke.

---

**9 steps, about 12 minutes.**

**Why this matters.** A typo in a gym's name used to be on every screen its
members see, for ever. Worse, the **time zone** is what decides when a gym's day
ends — so a gym set up in the wrong one had its daily figures and its members'
streaks rolling over at the wrong hour, permanently, with nothing anybody could
do about it.

**The one thing to keep an eye on.** Step 4 is the important one. The time-zone
box must already be showing **your gym's own time zone** when the screen opens.
If it opens showing a different one, stop and say so — saving would then move
your gym's day without you asking.

**Nothing here can affect your members.** Nobody joins, leaves or changes. If a
member disappears from your Members list at any point in this sheet, that is a
failure — say so.

---

## Before you start

Two terminals, from the repo root.

**Terminal 1 — the API**
```
cd apps/api && node --import tsx --env-file=.env src/index.ts
```
Wait for it to say it is listening on port 3000.

**Terminal 2 — the web app**
```
cd apps/web && npx vite
```

Open **http://localhost:5173/login** and press **F5** once.

**You need one account that runs a gym.** Sign in with it and choose **I run a
gym**. If it does not have a gym yet, make one — any name is fine.

**Write down your gym's current name before you start.** You will change it and
change it back.

---

## Step 1 — find the form

Go to **/console**, click your gym, then click **Settings** in the left rail (or
the bottom bar on a narrow window).

✅ **Expect:** two closed rows — **Gym details** and **Staff** — each with a line
underneath saying what it is, and the staff count (*"2 people run this gym"*)
still readable on the Staff row **without opening it**.

Click **Gym details**.

✅ **Expect:** it opens, showing four boxes — **Gym name**, **City**, **Country**
and **Time zone** — each already filled in with what your gym has now, and under
the country box a line saying which money your gym is billed in. **Staff stays
shut.**

Click **Gym details** again.

✅ **Expect:** it closes. Open it again before going on.

❌ **Failure:** the sections are open from the start (the tap does nothing), or
tapping one opens both, or the staff count is missing from the closed row.

---

## Step 2 — the Save button is asleep until you change something

Do not touch anything yet. Look at the **Save changes** button.

✅ **Expect:** it is faded out and does nothing when you click it.

Now type one extra letter at the end of the gym name.

✅ **Expect:** the button lights up.

Now delete that letter again, so the name is exactly what it was.

✅ **Expect:** the button goes back to faded.

❌ **Failure:** the button is live before you change anything, or stays live
after you put the name back.

---

## Step 3 — rename the gym, and watch the whole console follow

Change the gym name to something clearly different — add **" Two"** to the end.
Click **Save changes**.

✅ **Expect:** the word **Saved.** appears beside the button, and **the new name
also appears at the top of the screen** (under the "Settings" heading) within a
second or two — without you reloading anything.

Now click **Gym** in the rail (the gym's own screen).

✅ **Expect:** the new name in the heading there — **without** pressing F5.

Now click **Your gyms** (the arrow at the top of the rail).

✅ **Expect:** the new name in that list too.

❌ **Failure:** the name changes in the box but the rest of the console still
shows the old one, or the screen goes blank / shows a spinner when you save.

---

## Step 4 — THE IMPORTANT ONE: your gym's own time zone is already selected

Go back to **Settings**. Look at the **Time zone** box **without touching it**.

✅ **Expect:** it shows **your gym's own time zone** — the one you picked when
you created the gym.

❌ **Failure:** it shows some other zone, or the very first zone in the list
(something like *Africa/Abidjan*). **If this fails, stop the sheet and report
it.** It would mean that simply opening this screen and saving a name change
moves the gym's day to somebody else's.

---

## Step 5 — change the time zone and prove it stuck

Pick a clearly different zone from the list — say **Europe/Paris**. Click
**Save changes**.

✅ **Expect:** **Saved.** appears.

Now press **F5** to reload the page.

✅ **Expect:** the box still says **Europe/Paris** after the reload.

Now set it back to your gym's real zone and save again. Reload once more and
check it stuck.

❌ **Failure:** the reload brings back the old zone — the save did not reach the
database.

---

## Step 6 — the city can be emptied

Type a city if the box is empty (say **Jorhat**), save, and reload to check it
stuck. Then **delete everything in the City box** and click **Save changes**.

✅ **Expect:** **Saved.**, and after a reload the City box is empty.

❌ **Failure:** the city comes back after the reload, or an error appears.

---

## Step 7 — an empty gym name is refused in plain words

Delete everything in the **Gym name** box.

✅ **Expect:** straight away, without clicking anything, a red line appears
saying your gym needs a name, and the **Save changes** button goes faded.

Type the name back in.

✅ **Expect:** the red line disappears and the button lights up again.

❌ **Failure:** nothing appears and the button just sits there faded with no
explanation, or you see something that looks like computer output (for example
`name: too_small`).

---

## Step 8 — the country

Look at the **Country** box.

**If your gym was created before today**, it will be **empty**, and there will be
a line saying we do not have your country on record. **That is correct, not a
bug** — the country was never saved for gyms made before this week. The line
under it still tells you which money the gym is billed in, and that part has
always been right.

Pick your country and click **Save changes**.

✅ **Expect:** **Saved.**, the "we don't have your country on record" line
**disappears**, and after a reload your country is still selected.

**If your gym already has a country**, change it to a different one instead, save,
reload, and check it stuck. Then set it back.

❌ **Failure:** the country box is empty after a reload, or the "we don't have
your country" line is still there after you picked one.

---

## Step 9 — the money follows the country, and you cannot type it yourself

Still on **Settings**, read the line under the country box.

✅ **Expect:** it names a currency and says you cannot set it here. If in step 8
you moved the gym to a country that uses different money (for example India), the
currency on that line should have changed to match — **USD** for the United
States, **INR** for India, **GBP** for the UK, **EUR** for a euro country.

✅ **Expect:** there is **no box anywhere on this screen** that lets you choose
the currency yourself.

❌ **Failure:** the currency does not match the country you just picked, or there
is a currency box.

---

## When you are done

Put your gym's **name, city, country and time zone** back to what they were
before you started. Everything on this sheet is reversible from the same screen.

---

## What this sheet does NOT cover, and why

- **The refusal a PAYING gym gets when it changes to a country with different
  money.** No gym in this product is on a subscription yet — nothing anywhere
  writes one — so there is no way to reach that message from a browser today. It
  is carried by the server's own tests and by the mutation harness alone, and it
  is the one thing on this screen a person has not seen.
- **What a MANAGER sees.** The gym-details form is the owner's by default. An
  owner can hand it to a manager from the Staff section's tick boxes, and the
  Settings tab then appears for them — that path is covered by tests, not by this
  sheet.
