# 2026-10-31 · The member-import test's tidy-up wait (feature folder 2, branch `import-leavers-wait`)

- **Why:** `memberList.importLeavers.routes` turned GitHub red in its 60-second hook for the third time (PR #352, PR #408, `master`'s run of #414), with all 14 tests passing. Not 33b-iii-b's code.
- **Cause, measured:** the file's tidy-up, one statement at a time, on this laptop with the file alone: `DELETE FROM users` 28,264 ms, `DELETE FROM gyms` 6,789 ms. Deleting one user runs 114 foreign-key checks, 7,365 ms on a fresh database connection (`EXPLAIN ANALYZE`, rolled back). GitHub runs that beside the other test files.
- **Fix:** the file's hooks wait 180 seconds. No app code changed.
- **Noted, not changed:** a real account delete carries the same 114 checks. It is rare and answers one person, so it is left for the load test (Stage 4 item 19).
