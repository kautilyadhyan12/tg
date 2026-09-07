# T3 round 1 — the gym's self-serve trial (server half). Paste into a FRESH chat.

```
You are reviewing, not fixing. Audit commit `a313861` on branch `web-repoint`
strictly against CLAUDE.md Part II R0–R11 and the spec sections it touches
(Part 3 §2.2 + §4.2, Part 4 §3.3 + §4.1/§4.2, Part 5 §0 addendum A + §3 + §6 + §12,
v1 §8 and §9.3).

Ground yourself first per CLAUDE.md Part I.6 — the repo beats anything in this
prompt. Read DECISIONS :21157 (this card), and :19656, :19560, :11072, :11429,
:19129, :17366, :10010 before judging any of its decisions.

WHAT IT DOES: `POST /v1/orgs/:gymId/trial` writes the first `subscriptions` row
this product has ever written. Migration `0015` adds the `billing.manage`
privilege (backfilled onto every owner) and widens `subscriptions.provider` to
include `'none'`. Kd REVERSED :11072 ruling 1 the same day — gyms self-serve
their trial and there is no approval step; one trial per OWNER, ever, replaces it.

Output only: (1) violations as rule# · file:line · one-line fix; (2) a security
pass — authn/authz/tenancy, input parsing, idempotency, secrets/log leaks, SQL
safety, and specifically whether the org lock actually closes :19656 C/H-3's
check-then-act; (3) anything that would fail the phase's Done gate.
No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS :5348, and :5807 1a — what a user can SEE and is FALSE is Critical/High).
Critical/High = security, data loss, privacy, money, a broken core flow.
Justify a Critical/High tag by naming the concrete failure. Zero Critical/High ⇒
the packet SHIPS. A Low finding buys no further round — but it is STILL FIXED and
logged in BACKLOG.md; report it at full severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix carries a test that fails without it (rule 3).

ATTACK THESE SPECIFICALLY, because the card claims them and a claim is not
evidence:
  · **the one-trial-per-owner gate.** It matches on the OWNER's user id, not on
    email/phone as Part 5 §12 says. Is there a path to a second free trial that
    does not cost a new email address? Deleted accounts, restored accounts,
    transferred gyms, an owner who is staff at a second gym.
  · **the lock.** Does `lockOrgRow` in `startGymTrial` genuinely serialise against
    `updateOrg`'s currency guard, or only appear to? The card deliberately does
    NOT catch a 23505 — is that right, or does it turn a real race into a 500?
  · **the trial band query.** `ORDER BY seat_cap ASC NULLS LAST … LIMIT 1` is
    Kd's "every gym trials at 300" expressed as a query. What price book makes it
    pick the wrong row? What happens to a gym whose currency has exactly one plan?
  · **`billing.manage` in `LAST_OWNER_REQUIRED_PRIVILEGES`.** Can an owner now
    strand themselves or a colleague in a state no in-app control repairs?
  · **the entitlement bust.** The card busts only the ACTOR and leans on the 60s
    cache TTL for every other member. Is R6.5 actually satisfied, or is there a
    path where a member's answer is stale longer than 60 seconds?
  · **migration `0015`.** Review it as SQL. Is the backfill idempotent, is the
    CHECK widening safe on every existing row, and does the Drizzle schema mirror
    it exactly?

The card's own three known gaps are RECORDED in `OWED.md`, so do not re-report
them as findings — judge only whether the record is honest about them: the dev
Neon branch holds a stale price book and lacks `0015`; Canada/UK/euro-area gyms
cannot trial at all (an open ❓ for Kd); neither `org.manage` nor `billing.manage`
has a tick box on the Staff screen.

This is ROUND 1, so the escape hatch is not armed — say so rather than leaving it
unstated. There is no screen, so there is no smoke to cite.
```
