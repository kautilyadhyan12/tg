# NEXT CARD — the workout core loop, BACKEND half. PLAN ONLY.

Read `CLAUDE.md` fully first; its rules are binding. This is a **T1 kickoff: I
want a PLAN, not code.**

**The two-round review cap is SET NOW, before the card runs** (DECISIONS :2866,
which makes the cap standing). Two T3 rounds, then the card closes either way.

**The STOPPING RULE is STANDING** (Kd, :5307 — it no longer needs setting per
card). Findings are tagged VISIBLE / NOT VISIBLE and only VISIBLE ones block the
tick (:2365) — **except security and data-loss findings, which block REGARDLESS
of visibility** (Kd, :5258), because a cross-account leak or a silently dropped
write is invisible to its victim by construction. **This card is why that
exception exists**: it is the first since the rule was written to touch other
people's data, so treat tenancy findings as blocking on sight.
**Everything found is still FIXED before the card closes, whatever its
severity** — the rule governs ticking, never fixing.

## Ground yourself first (CLAUDE.md Part I.6 — binding on your first reply)

`git log --oneline -4` and `git status --short`. Read HANDOFF.md's TOP block,
`DECISIONS-INDEX.md` IN FULL, §1 and §2 in the DECISIONS.md original, and at
minimum these entries in the ORIGINAL (quote by line; the index is a pointer,
never a citation):

- **:2866** — Kd's ruling that splits P2.8 into a CODE half and a DEPLOY half,
  and the card ORDER. **Read it before accepting this card's scope**: its list
  says "running progression, workout templates + stats, …" and Kd chose the
  workout loop ahead of running on 2026-08-05, told that it departs from the
  letter of that list. If you think that is wrong, say so as a labelled
  RECOMMENDATION and stop — do not silently re-order.
- **:3424** and **:3610** — `completeSession` STAYS, and why: dropping it makes
  the post-workout screen print a "+50 XP" that was never awarded. The web write
  path already sends workouts to `/v1/workouts/sync`; the legacy save is a
  DUAL-write, not the only write.
- **:2444**, **:2736** — the PostWorkout summary reader (`readSummaryView`) and
  the three review rounds behind it. This card gives that reader a real payload.
- **:1020**, **:1110** — XP storage is KEPT and the 100-XP curve must NEVER be
  copied into a client. The server sends the numbers; clients render them.
- **:5199**, **:5104**, **:5034** — the card that just closed, for the working
  method and for the harness lessons you will inherit.

**Anything in this prompt the repo contradicts: the repo wins. Say so and stop.**

## What the card is, in one sentence

Give the new API a home for the workout calls that still ride the OLD backend,
so the app's core loop — start a workout, finish it, see the summary, see the
dashboard stats — no longer needs the dead backend or its stand-in rig.

## The gap, measured 2026-08-05 (re-verify; do not take these on trust)

Already on the new API (`apps/api/src/modules/workouts/routes.ts`):
`/v1/workouts/sync`, `/v1/workouts`, `/v1/workouts/:id`, and a `/v1/progress/*`
family.

Still on the old backend, in `apps/web/src/api/workoutApi.js` — eight calls:

| call | what it serves |
|---|---|
| `createSession` | PreWorkout opens a session server-side |
| `completeSession` | the legacy save (STAYS per :3424 — dual write) |
| `getSummary` | the rich PostWorkout summary: records, meal ideas, stretches |
| `getStats` | the Dashboard's numbers |
| `saveTemplate` / `getTemplates` / `deleteTemplate` / `useTemplate` | WorkoutBuilder |

The `workout_templates` TABLE exists in the Part 4 §3.5 DDL — an earlier comment
claiming otherwise was corrected on 2026-08-01. **Verify what is actually
migrated before planning against it.**

## Why this card was chosen (so you can judge the scope)

Every smoke since the write path landed has needed a THIRD server, because
starting a workout calls the old backend; and the post-workout summary shows the
stand-in rig's canned numbers, identical for every workout, so **no smoke has
ever been able to judge that screen**. Both facts are recorded at :5034 and
:4081. This card is what removes them.

## What I want from you, in this order

1. **A SCOPE PROPOSAL BEFORE A PLAN.** This is too big for one card — the XP
   card took ELEVEN review rounds and :2158 records the cause as the CARD's
   scope, not the code. Propose a split into cards of roughly one backend
   surface each, in dependency order, and say which one you would do first and
   why. Name what each card does NOT touch.
2. **SPEC GAPs, loudly.** `getSummary` returns personal records, meal
   suggestions and stretches; `getStats` returns dashboard figures. Where the
   spec names no home for one of those, that is a `SPEC GAP` for Kd — **never an
   invented endpoint or an invented field** (R0.2). Expect several.
3. Only then, for the FIRST card of the split: files, endpoints, schemas,
   migrations if any, and the tests — including the cross-tenant denial case
   every new route needs (R3.2).

**No implementation code in this reply.** Kd approves a plan before anything is
written.

## Rules this card will be judged against, worth knowing up front

- Every new route: Zod-parsed input · authn · **tenancy in the WHERE** · a test
  proving a foreign user gets 404/403 · cursor pagination on lists.
- Repos are the only files that touch the DB. No inline queries in routes.
- The server computes anything that grants value (R3.1). XP and levels come from
  the server; the client renders and never computes.
- One migration per PR, reviewed as SQL by Kd BEFORE other code (T5).
- No feature is removed or reduced to fit what the backend has. A missing
  surface is a thing to BUILD, and a deferral gets an `OWED.md` line in the same
  commit.
