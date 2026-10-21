# Handoff · 2026-10-22 · Save card on Terminal: Cancel no longer comes back (web folder 1)

- **Why:** GitHub failed the money plan's records pull request (#331) twice on the same web test, "Cancel while Square has not stopped it yet" (`memberCardTerminal.render.test.jsx:224`, expected no Cancel button), though #331 changed only records and the test passed on 18d-ii-b-ii's own runs. A real flicker: an ask sent to the server before Cancel was pressed could answer after Cancel's own answer and put the box back to waiting, with Cancel showing, until the next ask.
- **Fixed** in `MemberCard.jsx` (`TerminalWait`): the answer to an ask sent before Cancel's answer arrived is dropped and the server is asked again.
- **Proof:** a new test sends the older answer after Cancel on purpose; on the old code it failed ("Unable to find … Asking the Terminal to stop…"), with the fix it passes. The box's two test files 32/32; the Cancel tests green in 5 of 5 runs; eslint on both files, exit 0.
- **Screen only**, no server change: no review (CLAUDE.md §2, screen job). A click-through cannot show it: it needs an answer to arrive in the same hundredth of a second as Cancel's.
