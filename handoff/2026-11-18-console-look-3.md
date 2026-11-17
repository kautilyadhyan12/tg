# Handoff · 2026-11-18 · The console's third look, designed (the web folder; branch `console-look-3`)

Kd's decisions: `rulings/2026-11-18-console-look-3.md`. A planning job on Fable, records only, no code, no review.

- **Why:** Kd doubted the second look would be easy to find one's way in, then judged it not good-looking enough beside the member app. He asked for a modern CRM layout with no feature touched.
- **Done:** a review of the second look (21 of its 147 boards rendered and read), then nine boards and `kit3.css` on a design canvas, approved after one round of his corrections (flat colour, standard words, Connect Square first, every fitness business). Copied to `docs/design/console-v3`; spec Part 3 §17.11 written; ROADMAP item 22 gains V1-c, V1-d, V1-e, V1-f and V0-d before V2a; CLAUDE.md §4 "The console's look" points at the third look.
- **Verified:** the facts the review rests on were read with commands in the session: an owner's menu has 17 pages (`consoleMenu.js`); the Members board carries 48 tags on 20 rows (`MembersNew.dc.html`); the board of Overview with money waiting is 2,560 px tall; no search from every page exists in `apps/web/src/pages/console`; a member's visits and last visit are already on their page (`MemberListPerson.jsx`). The nine boards were NOT looked at drawn: the canvas tool forbids it unless asked, so expect small faults of spacing.
- **Not changed:** no code, no test, no page. `console.css` is still the second look's; V1-c changes it.
- **Open:** Kd did not name which words or which effect he disliked; the word list and the removal of every gradient and glow are the terminal's reading. V1-d's count route and V1-e's search each need a plan that names its size and its cost at 20 businesses of 200.
- **V1-b:** its pull request (#576) was open when this was written. Its boxes are kept; V1-c restyles them. V1-c starts after V1-b merges.
- **Next in this folder:** V1-c, the third look's blocks and the bar across the top. Opus high, a screen job.
