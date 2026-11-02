# 2026-11-02 · A red `master`: the Sell refund test crossed the gym's midnight (feature folder 1; branch `test-sell-refund-clock`)

- **What:** `master`'s run of PR #436 (run 41396686683) was red on one test, `saleCardRefunds.routes.test.ts`, "the sale is not on Sell's list". 8,173 of 8,174 passed. A test fault, not the app's.
- **Cause:** the chargeback test, added by 466a59f, moved the shared test clock to the real time, and the next test moves it on two hours. From two hours before midnight in Chicago, 04:00 to 06:00 UTC at this time of year, that crosses the gym's day. So it was red for two hours every day, on any branch.
- **Proof:** the clock forced to an hour before that midnight: red with the same words. With the fix, at the same hour: 59 of 59. At the real hour: 59 of 59.
- **Fix:** the chargeback test puts the clock back when it finishes. Test only.
