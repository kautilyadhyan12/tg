You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II
R0–R11 and the spec sections below. Output only: (1) violations as rule# ·
file:line · one-line fix; (2) a security pass — authn/authz/tenancy, input
parsing, idempotency, secrets/log leaks, SQL safety; (3) anything that would fail
the phase's Done gate. No praise, no restating the diff.

TAG EVERY FINDING **Critical/High** or **Low** (CLAUDE.md Part I §2.5,
DECISIONS :5348, amended :5807). Critical/High = security, data loss, privacy,
money, a broken core flow — **or anything a user can SEE that is FALSE, or that
blocks them from finishing something they should be able to do**. Low =
spelling, comments, naming, style. Justify a Critical/High tag by naming the
concrete failure. Zero Critical/High ⇒ the packet SHIPS. A Low finding buys no
further round — but it is STILL FIXED and logged in BACKLOG.md; report it at
full severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to
check is broken (rule 4 — list them, do not fix them), and whether each
Critical/High fix carries a test that fails without it (rule 3). If Criticals
appear in the SAME subsystem two rounds running, say so and STOP — that is Kd's
redesign trigger, not a cue for another patch.

## What this packet is

THE JOIN DOOR, STEP 2 OF 3 — the two screens, plus REMOVE.

A member types their gym's code (Settings → Gym, or `/org/join?code=`), sees they
are waiting, and is told when they get in or are refused. The gym's console shows
a **Waiting to join** section above its roster with Confirm / Not this person,
and the number waiting on the screen an owner lands on. **A member can also be
REMOVED — a route that did not exist**, added mid-card because Kd asked what
happens when a gym confirms the wrong person.

Diff: `t3-join-door-screens-r1.diff` (attached / at the repo root).

## Binding context — read BEFORE reviewing, in this order

1. `DECISIONS.md` **:12343** — this card's own entry (the four decisions, the two
   Kd rulings, and the audit finding).
2. `DECISIONS.md` **:11846** and **:12227** — step 1 (the server half) and its
   review. The contracts this packet consumes are all there.
3. `DECISIONS.md` **:11072**, **:11132**, **:11385** — the rulings that decide
   what these screens may say: typing a code APPLIES; a pending person keeps the
   WHOLE FREE APP and must never be parked on a waiting screen; the waiting
   room's clock is step 3 and does not exist yet.
4. `DECISIONS.md` **:11616** — the crossing between the member app and the gym
   console is shut in both directions. Nothing may link one to the other.
5. `DECISIONS.md` **:10402** — the console's screens as built and its layout
   rules (including: a count is exact or a bound, never one page's length).
6. Spec: `03-part3-org-console.md` **§2.4** (the visibility boundary and the
   "What {org} can see" sheet — a HARD requirement of the join screen), **§3.1**
   (console nav), **§4.3** (Members screen and the remove flow).
   `00-architecture-v1.md` **§8** (member enters the code in Settings).
   `06-part6-mobile.md` **§2** (the QR poster and `aihg://org/join?code=`).

## Things worth pointing your own instruments at

- **The §2.4 sheet.** It is the product's written promise about what a gym can
  see. Check the list against the spec line by line — a missing or added row is
  the finding, and joining would work perfectly without any of it.
- **Consent.** `consent: true` must never be sent for somebody who did not tick
  a box the SERVER asked for. For a clinic that record IS the DPDP/GDPR consent.
- **The count.** `pendingCount` is the server's exact figure; `items.length` is
  a page. Both appear on screen.
- **Remove.** New route, new privilege, new button. Tenancy is inside the
  UPDATE as well as in the authorization above it; the row is CLOSED not
  deleted; the seat is freed; the removed person's entitlement cache is busted
  (Kd's own ruling — they lose the gym's perks); staff are refused.
- **The wire.** `DELETE` and `POST` are indistinguishable to every server test
  in this repo, because `fastify.inject` sends no CORS preflight. Same for the
  `{}` body confirm/reject need.
- **The empty-vs-failed shape**, which this project ships most often: a failed
  read drawn as an empty one. It appears on four surfaces here.

## Its own audit, so you can aim past it rather than repeat it

`node apps/web/tools/mutate-join-door.mjs` — **24 mutants, all RED, 0 alive**
(web only, no database mutants: :5857 rule 4a).
`node apps/api/tools/mutate-orgs.mjs` with `DATABASE_URL` set — **47 mutants, all
RED, 0 alive**, the whole table re-run to completion including **O42–O47** for
removal. (It takes about an hour against the cloud database; a subset run via
`MUTATE_ONLY` is fine for a re-review, and the harness prints that it is one.)

**The finding I already have, so a repeat is not news:** J11 survived twice. A
trainer's 403 was hidden by TWO guards — the catch suppressed the error and the
render returned null — and each was unfalsifiable because the other held.
:5104 F5's shape, twice, in code written the same hour. Fixed in the source so
one line does the work. **Write mutants of your own rather than only re-running
mine** — that is what turned up L-1 last round.

## PROVE figures to re-check rather than trust

api **512/512** across all 43 files on real Postgres · shared **48/48** · web
**857/857** · `vite build` ✓ · tsc clean on api and shared · eslint clean on
every new file; `Settings.jsx` / `Dashboard.jsx` / `App.jsx` sit at the HEAD
baseline of 4 errors, measured by linting `git show HEAD:` copies.

**Smoke: UNRUN** (`RUNBOOK/smoke-join-door.md`, 17 steps). Nothing ticks yet.
