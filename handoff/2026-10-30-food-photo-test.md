# Handoff · 2026-10-30 · the food photo test that depended on the machine's speed (the web folder)

Not a ROADMAP job: `master`'s run of PR #400's merge (41061341278) went red, which §2.7 makes the next work.

- **Why:** five phone tests in `apps/mobile/test/screens/foodPhoto.test.tsx` failed on both tries of that run. The same code had passed on the pull request.
- **Cause:** the test "with no signal it asks again after 30 seconds" put `jest.spyOn` on `setTimeout`. The testing tool takes a mocked `setTimeout` to mean fake timers, and that wait does not really wait: a stopwatch in the test read 254 and 304 ms, against the 300 ms the app waits before it asks. So pass or fail came down to the machine's speed. The mock came off only after the wait, so a failure left it on, and the four tests after it failed for that reason alone. Not the app, and not the time of day: it failed alone, on UTC and on India time.
- **Built:** the test records timers through a plain wrapper, taken off in `finally`. The app did not change.
- **Verified:** typecheck and lint exit 0. The whole file 27 of 27 on UTC and on India time, where it was 5 failed and 22 passed. The test went red on purpose three ways and was put back: the app waiting 60 seconds, never asking again, and the 30 seconds passing with nothing asked.
- **Also seen:** web `memberListUpload.render.test.jsx` "choosing They've left after a refused keep press…" failed on that run's first try and passed on its second (60 tests). A first red, left alone; a second one is fixed on its own branch.
- **Next in this folder:** 18d-iv, refunds and chargebacks.
- **Merged** 2026-10-30 on Kd's "merge" (PR #401). A test only, so no review. GitHub: 406 of 406 phone tests.
