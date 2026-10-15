# 2026-10-15 · two flaky web tests fixed (feature folder 2; branch `flaky-web-tests`)

- **Why:** both turned GitHub red on 35b's pull request #272 (`memberListSelect` first, re-run green; `xpDisplay` second), 35b changing no web code; both were on ROADMAP Stage 1 item 10's list of known defects. A second red is fixed at once on its own branch.
- **The causes, proven:** each test assumed a step was already done that the page does a moment later. `xpDisplay.render.test.jsx` "a non-array recommendations field does not blank the page" read the recommendations message as soon as "Level 3" showed; `memberListSelect.render.test.jsx` "a Select all that moved clears the old numbers" called `answer` before the page had asked for the new count. With that step slowed by 300 ms, the old lines failed as GitHub did ("Unable to find an element", "answer is not a function"); the fixed lines passed slowed and not.
- **The fix:** the first finds the message, waiting for it (`findByText`); the second waits until the new count has been asked for. Nothing else in either test changes. Their two entries leave ROADMAP's known-defects line.
- **Verified:** both files 86 of 86; web eslint 0 on both.
