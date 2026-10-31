# Handoff · 2026-10-31 · the Settings health test that waited one second (the web folder)

Not a ROADMAP job: `master`'s run of PR #404's merge (41183166822) went red, which §2.7 makes the next work. Its second red: it failed on that pull request's run 41180742370 too.

- **Why:** `apps/web/src/pages/settingsHealth.render.test.jsx`, "says so when the health answer cannot be read", in a file this job's merge did not touch.
- **Cause:** a person's Settings is a heavy page, and the test's look for the Try again button stops after the testing tool's one second. On GitHub's busy machine the test took 1.5 s and its neighbours up to 2.4 s. Shown on demand: a wait of 20 ms gives the same error, on this laptop. The app did not change.
- **Built:** the file waits up to 5 seconds, and each test may take 20.
- **Verified:** the file 9 of 9 here; lint 0.
- **Next in this folder:** 18d-iv-b-ii.
