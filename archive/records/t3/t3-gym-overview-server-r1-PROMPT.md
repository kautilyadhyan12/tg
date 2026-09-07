# T3 · ROUND 1 — the gym's numbers, SERVER half

**Paste this whole file into a FRESH chat, with `t3-gym-overview-server-r1.diff`
attached.** You are reviewing, not fixing. A subagent is not a T3
(`DECISIONS.md` — the Card 5c precedent); this must be a chat that did not write
the code.

---

You are reviewing a diff, not fixing it. Audit it strictly against `CLAUDE.md`
Part II R0–R11 and the spec sections named below. Output only:

1. **Violations** — rule# · file:line · one-line fix.
2. **A security pass** — authn/authz/tenancy, input parsing, idempotency,
   secrets/log leaks, SQL safety.
3. **Anything that would fail the phase's Done gate.**

No praise, no restating the diff.

**TAG EVERY FINDING `Critical/High` or `Low`** (CLAUDE.md Part I §2.5,
`DECISIONS.md:5348`, amended by `:5807`). Critical/High = security, data loss,
privacy, money, a broken core flow, **or anything a user could SEE that is
FALSE** — a wrong number, a wrong state, a promise that is not true. Low =
spelling, comments, naming, style. Justify a Critical/High tag by naming the
concrete failure. **Zero Critical/High ⇒ the packet SHIPS.** A Low finding buys
no further round — but it is STILL FIXED and logged in `BACKLOG.md`; report it at
full severity, never soften it to duck a round.

Also report: any existing test that stays GREEN when the thing it claims to check
is broken (rule 4 — list them, do not fix them), and whether each Critical/High
fix would carry a test that fails without it (rule 3). If Criticals appear in the
SAME subsystem two rounds running, say so and STOP — that is Kd's redesign
trigger, not a cue for another patch.

---

## WHAT THIS IS

The first half of `CARD-gym-overview-numbers.md`: the nightly rollup that writes
`org_daily_stats`, and `GET /v1/orgs/:gymId/overview` that feeds Part 3 §4.1's
Overview. **No screen is in this diff.** Commit `6b91e15`; the card record is
`DECISIONS.md:30094` and Kd's rulings behind it are `:29961`.

## THE BINDING READING, and this is not optional

- `DECISIONS.md:29961` — Kd's four gate rulings. **The tiles count VISITS, not
  workouts** (a knowing deviation from Part 3 §4.1, put to him and accepted) ·
  **a workout counts for a gym on the SAME GYM-DAY as the visit** · the card
  splits · the cheer is one tap.
- `DECISIONS.md:26469` — the gym's numbers are attendance numbers · three tiles,
  no average form score · **"trained anywhere" is NEVER shown** · every figure
  counts only people who were PRESENT.
- `DECISIONS.md:27992` §1 (a second visit in a different session counts again)
  and §3 (**the counts come from the SERVER**).
- `DECISIONS.md:28107` §2 — `attendance.read`, the ninth privilege.
- Part 3 §3.2 (the rollup layer and its definitions), §3.3 (the route's name),
  §4.1 (the screen). Part 4 §3.11 (`org_daily_stats`).
- `CARD-gym-overview-numbers.md` — the approved plan. **§4a.4 was CORRECTED
  during the build** (the route reads live rather than from the table); the
  correction and its reasoning are in the file and in `:30094` §2.1. Check the
  reasoning, not just that it is written down.

## FIVE THINGS I WOULD LOOK AT FIRST, stated as MY suspicions and not as answers

1. **The rollup's SQL is one statement with six CTEs and it is where a wrong
   number would live.** In particular: `present` dedupes attendance before
   workouts are joined, because a member who came to two sessions holds two rows
   and would otherwise double their sets and reps. Is that true of every join
   below it? Is `mem`'s `count(*) FILTER` counting members once per day rather
   than once per target row?
2. **Every day boundary is `AT TIME ZONE g.timezone`.** Is there anywhere a
   server-local or UTC date leaks in — the `generate_series`, the
   `created_at` guard, the membership interval, the workout bucketing?
3. **`count(a.id)` versus `count(*)` over LEFT JOINs.** The weekly series and the
   tiles both aggregate over an outer join; one of them getting this wrong
   reports an empty week as one visit. Are they both right?
4. **The route's `adoptionPct`.** Numerator and denominator are meant to be
   counted over the SAME population (current, non-complimentary members) so the
   ratio cannot exceed 100%. Are they?
5. **`ON CONFLICT … DO UPDATE` sets every column.** A column left out of the SET
   list freezes at whatever was written first and a late-synced workout is never
   counted. Is any column missing?

## WHAT IS NOT IN SCOPE

The web half (unbuilt), the people-lists card, the cheer, `org_live_counters`
(deliberately not built — reason and cost on its `OWED.md` line), and the smoke
(there is no screen). Do not review `CLAUDE.md`'s uncommitted edit; it is Kd's.

## HOW TO VERIFY ANYTHING

Docker must be running. Then, per `DECISIONS.md:13659` — never point a suite or a
sweep at the Neon branch:

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
corepack pnpm --filter api test:local test/orgs.overview.test.ts
DATABASE_URL="postgres://aihg:aihg@localhost:5433/aihg" \
  MUTATE_ONLY=O228,O229,O230,O231,O232,O233,O234,O235,O236,O237,O238 \
  node apps/api/tools/mutate-orgs.mjs
```

The round-1 figures you are checking, not trusting: `orgs.overview` 12/12 ·
`db.migration` 16/16 · `orgs.routes` + `orgs.attendance` 176/176 · shared 52/52 ·
web 1612/1612 · sweep 11 RED / 0 ALIVE on a stated subset of 228.
