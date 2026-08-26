# SMOKE — a gym can fix its own details

**What changed, in one line:** a gym owner can now correct their gym's name,
city, country and time zone from the Settings screen. Until today none of those
could ever be changed after the gym was created.

## RESULT — NOT YET RUN

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

✅ **Expect:** a card headed **Gym details** with four boxes — **Gym name**,
**City**, **Country** and **Time zone** — each already filled in with what your
gym has now. Under the country box, a line saying which money your gym is billed
in. Below the card, the **Staff** section you already know.

❌ **Failure:** no **Gym details** card, or the boxes are empty when your gym
does have a name and a time zone.

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
