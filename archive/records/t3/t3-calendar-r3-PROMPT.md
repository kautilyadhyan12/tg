# T3 ROUND 3 — the calendar packet, DIFF-ONLY

Paste everything in the box below into a **fresh** chat. Nothing else is needed:
the commit is on branch `web-repoint` and the reviewing chat reads it itself.

Round 2 is `DECISIONS.md:32583`. Round 3 is the last gate on `OWED.md`'s
*"days you came"* calendar line.

---

```
You are reviewing, not fixing. This is a DIFF-ONLY RE-REVIEW (CLAUDE.md Part I §2.5
rule 2): cover ONLY commit 7831015 and the surfaces it touches. No fresh full pass.

Audit it strictly against CLAUDE.md Part II R0–R11 and DECISIONS :32583, which is
the round record it closes. Output only: (1) violations as rule# · file:line ·
one-line fix; (2) a security pass — authn/authz/tenancy, input parsing,
idempotency, secrets/log leaks, SQL safety; (3) anything that would fail the
phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING Critical/High or Low (DECISIONS :5348, :5807). Critical/High =
security, data loss, privacy, money, a broken core flow, OR anything a user can
SEE that is FALSE. Low = spelling, comments, naming, style. Justify a
Critical/High tag by naming the concrete failure. Zero Critical/High ⇒ the packet
SHIPS and the OWED.md calendar line ticks. A Low finding buys no further round —
but it is STILL FIXED and logged in BACKLOG.md; report it at full severity.

Specifically check, because these are what round 2 changed:
- both attendance readers in apps/api/src/modules/orgs/repo.ts now fetch limit+1
  and page on `> limit`. Is the served page still exactly `limit`? Can the extra
  row leak into a response, a count, or a cursor? Is the day list's cursor still
  the last person OF THE PAGE and not the extra one?
- the two new tests in apps/api/test/orgs.attendance.test.ts. Do they fail if the
  fix is reverted in EITHER direction (the comparison, and the extra row)?
- the day-list fixture bulk-inserts 100 users. Does the suite's cleanup delete
  them, and can it collide with any other suite?
- C207/C208 and O257–O260: does each one's `from` anchor still match exactly once,
  and does each mutant die for the reason its `why` claims?

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix carries a test that fails without it (rule 3). If Criticals appear in the SAME
subsystem two rounds running, say so and STOP — that is Kd's redesign trigger.
```
