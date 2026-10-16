# Handoff · 2026-10-16 · Stage 3 item 2b, one free trial per person (Folder B)

- **Why:** the trial was one per ACCOUNT, so `kd.gym+2@gmail.com` or an unconfirmed made-up address got a second one (RULINGS 2026-09-08, layer 1).
- **Built:** `trialPersonKey` in `@app/shared` (Gmail without dots, googlemail.com read as gmail.com, a `+tag` dropped everywhere); migration `0127_trial_person_key` adds the database's copy as a function and `users.trial_person_key`, worked out by the database, cleared by the purge with the email. The trial button and the subscribe prompt both count the owner's account and every confirmed account with the same key; a trial needs a confirmed address (`email_not_confirmed`, with a "Sign in with an email code" button). `POST /v1/orgs` refuses a throwaway address (`email_throwaway`, 9,196 domains from the CC0 list at commit 7cd238d, with a "Sign in with another email" button).
- **Verified:** `tsc` and `eslint` for `api`, `@app/shared` and web's console folders, all 0; `orgs.trialPerson.test.ts` and the six trial test files, 311 tests on `aihg_b`; shared's 25 cases from Google's and Microsoft's own pages, run through the database's copy too; planPrompt's 31 web tests. Broken on purpose three ways (the button forgets other spellings; the prompt forgets them; an unconfirmed account counts), red each time.
- **Open:** the shared rule is ready for the member list's Gmail matching (ROADMAP's after-launch list); nobody uses it there yet.
- **Next in Folder B:** 2d, the trial belongs to the gym.
- **Click-through:** passed by Kd, 2026-10-16.
- **Round one** (`reviews/2b-2-findings.md`): two Highs, both run by the reviewer: an unconfirmed spelling could read whether a real person had had a trial; a manager was offered a code sign-in that could not confirm the owner. Two Lows: `sify.com` was on the copied list; the migration named a missing test. All fixed in 9493ec8b: an unconfirmed owner is only their own account; a manager gets `owner_email_not_confirmed` with no button; `sify.com` kept in `throwaway.ts`; tests for the leak, the manager and two spellings pressing at once, each red with its bug put back.
- **Re-check** (`reviews/2b-4-verdict.md`): all closed, nothing Critical or High open; the round ends.
- **Merged** 2026-10-16 on Kd's "merge" (PR #293).

**The ROADMAP line as first written:** 2b. [ ] Same person, new spelling: Gmail dots and `+tags` collapse for trial counting; throwaway email domains refused at the Manage door.
