# T3 ROUND 1 — gym details, server half (`8540691` + the country-lock addendum)

**Reviewed by a fresh chat that did not write the code. Round 1, so the escape
hatch (:5348, two consecutive rounds of Criticals in one subsystem) is NOT
armed — stated unprompted.**

**RESULT: THREE Critical/High. The packet does NOT ship** (:5348 rule 1).
Three Low, all logged for `BACKLOG.md` and all still to be fixed (:5307 stands).

Severity vocabulary is :5348 as amended by :5807 1a — Critical/High also covers
anything a user could see that is FALSE, or being blocked from finishing
something they should be able to do.

---

## Verification this review ran itself (not carried from the card)

| What | Result |
|---|---|
| `pnpm --filter api test:local test/orgs.routes.test.ts -t "freezes the country"` | 1 passed / 116 skipped of 117, exit 0 — the card's claim reproduces |
| `pnpm --filter api exec tsc --noEmit` | exit 0 |
| Purpose-built probe against local Postgres, calling `repo.updateOrg` directly | **C/H-1 CONFIRMED**, output below |
| `docker exec … psql -c "SELECT count(*), count(country) FROM gyms"` | `59 \| 57` on the local database AFTER this review ran the suite; the card's `55 / 0` was measured before it and is not contradicted |
| `git status --short` after the probe | clean — the probe file was deleted, nothing landed in the tree |

Probe output, verbatim:

```
CASE A  (name changed, country resent UNCHANGED): country_locked
CASE B  (name changed, country key ABSENT):       updated
stored name after both calls: probe gym renamed
```

Fixture: one gym, `country='US'`, `currency_display='USD'`, holding one
`subscriptions` row at `status='active'`. Case A's patch was
`{name, city, country:'US', currencyDisplay:'USD', timezone}` — every value
identical to the stored row except the name.

---

## (1) VIOLATIONS

### C/H-1 — the country lock fires when the country has NOT changed
`apps/api/src/modules/orgs/repo.ts:516` — `if ("country" in input.patch)`

**Rule:** R3.3 / the ruling at `DECISIONS.md:19570` in its own words —
*"Name, city and time zone stay editable"*.

**Concrete failure.** The web half is the next card and is a Settings form: it
prefills every field and posts every field back. That is not a guess — it is
this packet's OWN stated premise, used eleven lines lower to justify the no-op
comparison (`repo.ts:526`, *"a screen sending back every field it drew is the
normal case"*). For a paying gym, that form can never be saved. The owner
changes the gym's NAME; the request carries the country it already has; the
server answers 409 `country_locked` and **writes nothing** — not the name, not
the city, not the time zone. The message it shows is *"Your gym's country is
fixed now that it's on a paid plan"*, about a country the owner never touched.

The lock asks whether the key is PRESENT. Every other comparison in the same
function (`repo.ts:529-541`) asks whether the value MOVED. The country is the
one field that does not, and it is the field that refuses the whole request.

**Why the suite is green.** The control in
`orgs.routes.test.ts` (*"THE CONTROL — the lock is narrow"*) patches
`{name, city, timezone}` and omits `country`. That is Case B above. The card's
own justification for the control — :7104's PG1, *a test that only checks a lock
FIRES is satisfied by a door that is simply shut* — is right, and the control is
still one case short: it never sends the shape a console sends.

**Fix (one line):** lock only when the country genuinely changes —
`if ("country" in input.patch && input.patch.country !== before.country)`, moved
below the `before` read it already sits below.

**Rule-3 test that fails without the fix:** on the same locked gym, PATCH
`{name: <new>, country: <the stored one>}` → expect 200 and the new name in the
row. Proven to fail today by the probe above.

---

### C/H-2 — a paying gym that never recorded a country can never record one, and is told a falsehood
Same line. Same one-line fix, different failure.

**Concrete failure.** Every gym created before migration `0014` has
`country = NULL` — deliberately, and correctly (`OWED.md`'s new ⚪ line;
:19366's no-backfill reasoning). That line's promise is *"each gym self-heals on
its first save"*. If such a gym goes on a paid plan **before** its owner opens
the Settings screen, the first attempt to record a country is a change from NULL
and is refused for ever. The gym is told *"Your gym's country is fixed now that
it's on a paid plan"* — **there is no country**, so the sentence is false
(:5807 1a), and the only way out is an admin panel that is not built.

**Fix:** the same comparison also settles this — `NULL → 'US'` is not a change
of a billing country, because there was none to protect. If Kd would rather lock
it anyway, then the message must stop claiming a country exists.

---

### C/H-3 — the lock's stated safety is not delivered by the lock it names
`apps/api/src/modules/orgs/repo.ts:483` + `:512-515`, and
`DECISIONS.md:19625-19629`.

**The claim under review** (the packet's own prompt asked for it, weak point 7):
*"THE CHECK IS INSIDE THE TRANSACTION AND UNDER THE ORG LOCK … outside the lock,
a subscription committing between the check and the UPDATE moves a paying gym's
currency."*

**Measured:** `lockOrgRow` is `SELECT 1 FROM gyms WHERE id = $1 FOR UPDATE`
(`repo.ts:1708`). It locks one row of `gyms`. It does not lock, and cannot lock,
rows of `subscriptions` — and `FOR SHARE` would not fix it either, because the
row does not exist yet at check time. This database runs READ COMMITTED (stated
in this same file, `repo.ts` above `lockOrgRow`, as the reason the code-cap
needed the lock). So:

1. edit transaction takes the `gyms` row lock, counts subscriptions → 0 past `trialing`
2. billing transaction inserts `status='active'` and commits — it never touched `gyms`
3. edit transaction writes the new country and currency and commits

A gym that is paying by the time the request finishes has had its billing
currency moved. This is precisely the failure the ruling exists to prevent, and
the lock named as the protection does not close it.

**Reachability:** inert today — `grep -rn "INSERT INTO subscriptions" apps/api/src
apps/api/tools scripts` returns nothing, so no production code creates one. It
goes live the day the billing card ships, which is the card that will read this
comment and trust it.

**Fix:** the guarantee needs the two writers to agree on one lock. Either the
subscription writer takes `lockOrgRow(gymId)` first — a lock-order contract
written onto the `OWED.md` line beside the `trialing` dependency already there —
or both sides take a transaction-scoped advisory lock keyed on the gym. Whichever
Kd prefers, the comment and `DECISIONS.md:19625` must stop asserting a protection
the row lock does not provide.

**Rule-3 test:** a two-connection test — hold the edit transaction open after its
count, insert an `active` subscription on a second connection, commit both, assert
the country did not move. It fails today.

---

## (2) SECURITY PASS

| Area | Verdict |
|---|---|
| AuthN | New PATCH is behind `app.authenticate`, and the 401 list test was extended with it (third time that list has been the thing a card forgot — it was remembered here). Clean. |
| AuthZ | `requirePrivilege(…, "org.manage")` before anything else; stranger and plain member 404, trainer and manager 403. Owner-only-by-default is real, not a comment: a test drives the widening through the ticks route. Clean. |
| Tenancy (R3.2) | `WHERE id = ${input.gymId}` on the UPDATE, and O114's fix is genuine — the authz test now makes a SUCCESSFUL owner edit and checks the second gym's row is untouched, so deleting the predicate would rename the other gym and fail. Clean. |
| Input parsing (R2.3) | `.strict()` + `.partial()` + a non-empty refine; `currencyDisplay`, `slug`, `orgType`, `locale` all refused with 400 rather than stripped, proven by a five-body loop. Time zone proven against `Intl`, not a length bound. Clean. |
| SQL safety (R3.8) | Every interpolation is a VALUE; no dynamic identifiers; the column-by-column UPDATE is written out longhand for exactly that reason and says so. `tx.unsafe()` appears only in the migration test, fed by the repo's own shipped `.sql` file. Clean. |
| Money (R3.1) | Currency is derived server-side from the country through one shared function and is not on the request schema. Correct — see C/H-1/2/3 for the lock around it. |
| Idempotency | Not required here (R3.5 scopes it to sync and payment-adjacent POSTs); a PATCH of absolute values is naturally repeatable. Clean. |
| Secrets / logs | Nothing new logged; no secret material anywhere in the diff. Clean. |
| Rate limit | No per-route limit — consistent with `POST /v1/orgs` next door, covered by the global limit. Not a finding. |
| CORS | `PATCH` is in `app.ts`'s methods list — checked, not assumed. Clean. |

---

## (3) PHASE DONE GATE

Nothing here fails P2's gate. The card is correct that **nothing ticks**: no
screen, so no smoke, and the 🟡 `OWED.md` line stays open on :13803/:14262's
precedent. C/H-1 is the thing that would fail the WEB half's smoke on its first
click, which is why it is worth catching now rather than there.

---

## (4) LOW — logged, no further round, still fixed (:5307)

- **L-1 — the out-parse stopped guarding the country.**
  `packages/shared/src/orgs.ts:178` gives `country` `.default(null)`. In BOTH
  deploy directions that is correct for the web (checked: `orgSummarySchema` is
  a plain `z.object`, so an older web bundle strips a newer api's extra key, and
  a newer web bundle fills `null` when an older api omits it). The cost is on the
  API's own side: the api parses responses on the way OUT, and the create card
  records that this is *"what would have caught a response missing
  `currencyDisplay`"*. With a default, a query that forgot to SELECT `country`
  would serve `null` silently and a console would show "no country" for a gym
  that has one. All seven org queries do select it today — verified by reading
  every `RawOrg` site (`repo.ts:234, 323, 404, 429, 548, 726, 1024`). Suggest a
  test pinning that, rather than removing the default.

- **L-2 — the authz test appoints staff by rebuilding an email string.**
  `orgs.routes.test.ts`, the second loop reconstructs
  `orgs-t-edit-trainer@example.com` from the role name and then discards the
  user it just made (`void person;`). It works only while `makeUser`'s email
  convention holds. Use the user object.

- **L-3 — the 409 names a way out that has no door.**
  *"Contact us and we'll move it for you."* The card judged this honest because
  Kd approves every gym by hand (:11072) and both providers make it a support
  action. I agree it is not FALSE, so it is not :5807 1a. But the product sends
  no email and has no contact surface (:19016, *"no email is ever sent"*), so the
  sentence names an action the owner cannot start. Name the channel when the
  admin panel's slice lands, and keep the two lines in step.

---

## (5) RULE 4 — tests that stay GREEN when the thing they check is broken

Listed, not fixed, as the prompt requires.

1. **The country lock's positive control.** It cannot see C/H-1: it omits the
   country key, so the over-lock direction has no observer at all. Its stated
   job (proving the lock is narrow to one FIELD) it does; the shape a console
   actually sends it never tries.
2. **`"changing the name does NOT change the gym's web address"`.** The slug is
   not in the UPDATE statement at all, so no change to the shipped code can turn
   this red. It is a deliberate regression guard and fine as one — recorded here
   only so nobody counts it as evidence about current behaviour.

Everything else new in this packet was checked the other way and holds:
the migration backfill test builds its own legacy row and reads the statement out
of the shipped `.sql` file (so it fails if the file changes shape — it already
did once, on `startsWith("UPDATE")`); the country CHECK test carries a positive
control and fails loudly rather than silently if `users` is empty; O120's re-aim
is real (the `ie` row makes the normalisation observable — without it the insert
would violate the CHECK and 500); O123/O124 are two genuine directions and O124
is observable because the same test asserts a `trialing` gym still gets 200; O20
and O122 anchor two different schemas and are not one mutant wearing two hats.

## (6) RULE 3 — do the Critical/High fixes carry tests that fail without them?

Not yet — the fixes are not written. Each finding above names the test it needs,
and C/H-1's has already been shown to fail against the current bytes.

## (7) ESCAPE HATCH

Not armed. This is round 1 on this subsystem.
