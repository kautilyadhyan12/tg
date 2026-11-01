# Handoff · 2026-11-01 · The Challenges test's time limit (the web folder)

- **Why:** web `challengesConsole.render.test.jsx`, "numbers typed on page 1…", timed out on GitHub on pull request #419 (attempt 1) and on `master`'s run of that merge: 5,199 ms against 5,000. Seen once before, 2026-10-08. A second red is fixed at once on its own branch.
- **Built:** that test's limit is 30 seconds. It draws a hundred rows seven times; nothing in the app changed.
