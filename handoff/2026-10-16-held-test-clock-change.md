# Handoff · 2026-10-16 · the Members list test across the clocks going back (web folder 1)

- **Why:** `master`'s run of PR #288 (5e-i) failed one api test of 6,474: `memberList.held.routes.test.ts`, "never puts somebody who owes nothing yet under Payment due", expected Uma, Vik and Wren on the day and got Vik alone.
- **Cause, proved:** the test checked "on its day" at now + 10 × 24 hours. UK clocks go back on 25 October 2026, so from the first hour of a London day (23:00–24:00 UTC) that lands at 23:12 on the 25th, one day short of the 26th the bill falls due. Reproduced at 23:11 UTC on `master` and at 23:12 UTC on `master` before #288 (`021c6d5`): the same red, so not 5e-i's. The app reads the day in the gym's zone and is right.
- **Fixed:** "on its day" is midday on that day. The whole file, 10 of 10, at 23:14 UTC, inside the hour that failed. The file's other clock (forty days on) has nine days to spare.
