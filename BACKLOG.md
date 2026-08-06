# BACKLOG.md — the LOG of LOW-severity review findings

Created 2026-08-06 by Kd's ruling on the fixed review/fix process
(`DECISIONS.md:5348`, restated at `CLAUDE.md` Part I §2.5).

## What this file is — and what it is NOT

**It is a LOG.** A Low finding — spelling, comments, naming, style — is written
here with the round that found it and the commit that fixed it. Its purpose is
that a Low finding is **visibly accounted for without buying another review
round**. That is the whole of what rule 1 changed.

**LOW FINDINGS ARE STILL FIXED before the packet closes.** Kd ruled this
explicitly when correcting a draft that said otherwise: *"no, they will be
fixed."* Nothing is left undone because it was Low. This file records the fixing;
it does not excuse skipping it.

**IT IS NOT A SECOND DEFERRAL LIST.** `OWED.md` is unchanged and remains the
single authority for everything outstanding. If a Low finding genuinely cannot be
fixed in its round, it has stopped being a log entry and become a **deferral** —
so it takes an `OWED.md` line, in the same commit, like anything else.

**Nothing Critical/High ever appears here.** Security, data loss, privacy, money
and broken core flows are fixed, or they hold the packet. If you are unsure which
side a finding falls on, it is Critical/High.

## Format

```
- [x] <what was wrong, where> — found <date>, <card / round> — fixed <commit>
- [ ] <same, still open — and if it will not be fixed this round, it also needs
      an OWED.md line, so say which>
```

---

## Log

_(empty — created with the ruling, before the first round that can feed it.)_
