# T3 ROUND 1 — the forced prompt's SERVER half (DECISIONS :22921)

Paste everything in the box into a **FRESH chat**. Not a subagent, not this chat
(CLAUDE.md Part I §7c, and the Card-5c precedent: a subagent review is not a T3).

```
You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11 and the rulings named below. Output only: (1) violations as rule# ·
file:line · one-line fix; (2) a security pass — authn/authz/tenancy, input
parsing, idempotency, secrets/log leaks, SQL safety; (3) anything that would fail
the phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS :5348). Critical/High = security, data loss, privacy, money, a broken
core flow — plus :5807 rule 1a: anything a USER COULD SEE THAT IS FALSE, or that
blocks them finishing something. Low = spelling, comments, naming, style.
Justify a Critical/High tag by naming the concrete failure. Zero Critical/High
⇒ the packet SHIPS. A Low finding buys no further round — but it is STILL FIXED
and logged in BACKLOG.md; report it at full severity, never soften it to duck a
round. If Criticals appear in the SAME subsystem two rounds running, say so and
STOP — that is Kd's redesign trigger, not a cue for another patch.

Also report: any existing test that stays GREEN when the thing it claims to
check is broken (rule 4 — list them, do not fix them), and whether each
Critical/High fix would carry a test that fails without it (rule 3).

THE DIFF: run `git diff` (plus `apps/api/test/orgs.plans.test.ts`, which is
UNTRACKED and is most of the new test surface). Working tree, branch
`web-repoint`, on top of e50d4ef. Ignore `apps/web/src/App.jsx` and
`apps/web/src/pages/console/Overview.jsx` — they show as modified but their
CONTENT is identical to HEAD (line endings only; `git diff` on them is empty).

GROUND FIRST, and these are the rulings this card is accountable to:
  · DECISIONS :22921 — this card's own entry (read it LAST, after forming a view)
  · :22215 §3.5 — Canada/UK/euro area are billed in US DOLLARS
  · :22697 — the modal, its two arms, and the two questions it left unruled
  · :22341 §7 — the false promise this card closes on the server
  · :21580 — what `/v1/orgs/mine` may and may not tell whom
  · :10010 — the no-fallback-currency rule
  · :13659 — the local Postgres every figure here was measured on

WHAT THE CARD CLAIMS, so you can attack the claims rather than the prose:
  1. `ownerTrialUsed` on `/v1/orgs/mine` lets a console tell "never trialled"
     from "trial ended". It is staff-only, nullable, and the card claims NULL
     must never draw a blocking modal.
  2. `GET /v1/orgs/:gymId/plans` serves the gym's own currency book behind
     `billing.manage`. The card claims it is tenant-scoped for free via
     `requirePrivilege`, and that no minor-unit integer reaches the client.
  3. `COUNTRY_CURRENCY` now maps CA/GB/euro area to USD, with NO backfill, on
     the measured claim that zero such gyms exist on either database.
  4. The price formatter touches no float, and its `en-US` pin is load-bearing.

QUESTIONS I WOULD ASK IF I WERE REVIEWING, and I wrote the code so I am the
wrong person to answer them:
  · `ownerTrialUsed`'s EXISTS is a SECOND copy of `startGymTrial`'s `used`
    query (R3.8 forbids sharing it as an `sql` fragment). Do the two actually
    agree in every case, including a gym whose owner changed?
  · The card says a gym transfer would "silently erase and misattribute trial
    history" — inherited from :21157's own note. Is that still only a future
    hazard, and does this new reader widen it?
  · Is `billing.manage` the right gate for a PRICE LIST, or does it hide prices
    from someone who legitimately needs them?
  · `formatPriceMinor` throws when Intl reports no minor-unit digits. Is a
    throw the right failure there, and can it reach a user as a 500?
  · The suite asserts an exact USD ladder. Four suites share one database — is
    that assertion actually race-free, or did I just get lucky?

DO NOT re-litigate: the two Kd rulings recorded in :22921 §1 (the prompt stops
only whoever can pay; the Overview button goes with the web card). Those are his,
made today, against cited options.
```

## What has NOT been done, so the reviewer is not misled

- **No SMOKE.** This card ships no screen, so there is nothing to click. The
  expiry smoke (`RUNBOOK/smoke-trial-expiry.md`) is deliberately NOT re-run: it
  must run AFTER the modal card (:22697 §5), and three of its seven steps
  describe the button the modal replaces.
- **Not committed.** The work is in the working tree at the time of writing.
- **The mutation sweep was a stated SUBSET** — O145–O151, 7 of 151. Not a full
  sweep, and must not be quoted as one.
