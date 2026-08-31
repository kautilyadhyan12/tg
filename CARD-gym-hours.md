# CARD — "When we're open": a gym's opening hours

**Status: WRITTEN, NOT BUILT. Awaiting Kd's approval at the plan gate.**
Rulings: `DECISIONS.md` :26624 + addenda :26684, :26736. Tracked at `OWED.md`'s
"A GYM CANNOT SAY WHEN IT IS OPEN" line. Branch `web-repoint`, as every gym card
has been.

---

## 1 · IN PLAIN WORDS (this part is for Kd)

A gym can say when it is open. Three sessions on a Tuesday, none on a Wednesday,
open all day Sunday — whatever it actually does. Or it can say **open 24 hours**
and be done.

It can also say **"we are closed today"** for one date, with a short reason if it
wants ("Holi"). That clears itself when the date passes.

Members see their gym's hours on their gym card, and see the closure when there
is one.

**Nothing about any weekday is special.** Sunday is a day like any other.

**A gym that has not filled this in yet says nothing at all** — members are never
told "Closed" for a gym that simply has not answered.

---

## 2 · WHAT IT DOES NOT DO, so nobody expects it

| Not in this card | Where it lives |
|---|---|
| Attendance / who came | the NEXT card (:26469) |
| The gym's numbers, the 8-week chart | the card after that |
| "Only 20 people in this slot" | booking — its own card, the biggest on the gym list |
| A name on a session ("Morning") | **struck by Kd** (:26684 §1) — do not re-propose |
| Closing part of a day | not asked for; a closure is a whole day |
| Different hours for staff | not asked for |
| Public holidays filled in automatically | not asked for; every closure is typed by the gym |

---

## 3 · THE RULINGS THIS IMPLEMENTS, so the build cannot drift from them

1. **Many sessions per day, or open 24 hours** (:26624 §1).
2. **Sessions, not a name** — a session is a time range and nothing else
   (:26684 §1).
3. **Members see the hours**, in this same card (:26684 §2).
4. **"Closed today" is a DATED override; "closed every Sunday" is the weekly
   pattern** — Sunday simply holds no sessions. Two ways to say one thing would
   let a gym's two answers disagree (:26684 §3).
5. **"Hours not set" ≠ "closed"** — an explicit third state, because both look
   like "no rows" and a member card printing "Closed" for a gym that never
   answered is a user shown something false (:26736, :5807).
6. **Everything is in the gym's own time zone** (:26469 §5, trap #8).
7. **No default hours are ever invented** — not at creation, not in a migration.
8. **No weekday is special** (:26736).

---

## 4 · SPLIT INTO TWO CHATS, because one card is one chat (Part I §1)

### 4a — SERVER HALF

**Migration `0017_gym_hours.sql`** — hand-written, for `0016`'s recorded reason
(`drizzle/meta/` stops at `0012_snapshot.json`, so the generator re-emits
`0014`–`0016` and dies on an existing column). **Reviewed as SQL by Kd before
anything else is written (R4.4 / T5).**

- `gyms.hours_mode` — `text` + CHECK `('unset','open_24h','scheduled')`,
  DEFAULT `'unset'`, NOT NULL. This is ruling 5 made physical.
- `gym_hours` — one row per session: `gym_id` (CASCADE), `weekday`,
  `opens_minute`, `closes_minute`.
  - **`weekday` is ISO 8601, 1 = Monday … 7 = Sunday**, which is Postgres
    `EXTRACT(ISODOW)` exactly, so the attendance card buckets a stamp with no
    mapping table. JS `getDay()` is 0 = Sunday and is deliberately NOT the
    convention — the client is the one place that converts.
  - **Times are minutes from midnight (0…1440) in the gym's own zone.** A
    session is a wall-clock fact about a place, not an instant: storing it as a
    timestamp would move it twice a year. **1440 means midnight at the END of
    the day**, so a gym open until midnight loses no minute.
  - CHECKs: weekday 1–7 · opens 0–1439 · closes 1–1440 · `closes > opens`.
  - **A session cannot wrap past midnight, deliberately.** 22:00–02:00 is Monday
    1320–1440 plus Tuesday 0–120. Every query stays one comparison and "which
    day is this on" never has two answers. Making that pleasant is the screen's
    job — one control writing two rows — never a schema change.
  - **No name column** (struck) and **no capacity column** (that is booking's
    schema, and half of it in the wrong table is worse than none).
- `gym_closures` — `gym_id` (CASCADE), `day date`, `note text` (≤120, nullable),
  `created_by`.
  - **UNIQUE (gym_id, day)** — a day is closed or it is not; re-closing updates
    the note rather than stacking rows, which is what makes the writer
    idempotent when an owner double-taps (R3.5).
  - **No `weekday` column, ever** — that is ruling 4.
  - **No `removed_at`**, a declared exception to R4.3: a closure is a statement
    about one day that expires by itself, and un-closing is a correction rather
    than an event. The audit log records both ends, so no history is lost.

**`packages/shared/src/orgs.ts`** — the contract, once, for both sides (R7.2):
`gymHoursModeSchema` · `gymSessionSchema` (with the `closes > opens` refine, so
a client gets a 400 it can explain rather than a 500 the database produced) ·
`gymWeekScheduleSchema` · `gymClosureSchema` · `gymHoursSchema` ·
`setGymHoursRequestSchema` (a discriminated union, so `open_24h` cannot arrive
carrying a week) · `closeGymDayRequestSchema` · params + response schemas.
**`unset` is not settable** — a gym that has answered cannot un-answer.

**Routes** (`/v1`, the module's existing shape — thin route, service owns authz,
repo owns tenancy):

| Route | Who | Notes |
|---|---|---|
| `GET /v1/orgs/:gymId/hours` | any **member** or staff of that gym | one reader for the console AND the member card, so the two screens cannot disagree |
| `PUT /v1/orgs/:gymId/hours` | `org.manage` | replaces the whole week atomically |
| `POST /v1/orgs/:gymId/closures` | `org.manage` | idempotent on (gym, day) |
| `DELETE /v1/orgs/:gymId/closures/:day` | `org.manage` | `removed` states the STATE, not the request |

- The three writes go through `requireWritablePrivilege`, so a gym with no live
  plan and an archived gym are already refused by the existing gates (:23711,
  :26220) — **no new refusal vocabulary is invented.**
- **`PUT` replaces the week rather than editing one session**: per-session CRUD
  lets two half-applied requests leave a gym advertising hours no human chose.
- The read is deliberately **not** folded into `/v1/orgs/mine`: that response is
  loaded on every dashboard paint and capped at 100 gyms, and hours belong to
  the screen that asks for them.
- Overlapping sessions on one day are **refused in the service** with a sentence
  naming the two that clash. The whole-week replace is what makes that checkable
  at all.
- `DELETE`/`PUT` reach a browser through a CORS preflight `fastify.inject`
  cannot exercise — **verify `app.ts`'s method list before claiming this works**
  (Card 4's dead-method bug).

**Tests** — `apps/api/test/orgs.hours.test.ts`, plus additions to
`orgs.routes.test.ts` and `db.migration.test.ts`:

- happy path: set a week, read it back · set `open_24h` · replace a week and see
  the old sessions gone.
- **the cross-tenant denial case on all four routes** (R9.2) — a member and a
  staffer of gym B get 404 on gym A.
- a non-member gets 404 on the read; a `trainer` gets 403 on the writes.
- validation: `closes <= opens` · weekday 0 and 8 · minute 1441 · a week with 13
  sessions in a day · `open_24h` sent with a week (union refuses it).
- **overlap refused**, including the touching case (10:00–12:00 + 12:00–14:00 is
  legal; 10:00–12:00 + 11:00–13:00 is not).
- closure: create · re-create same day updates the note and does not stack ·
  delete · delete a day that was never closed still answers `removed`.
- **`unset` cannot be set**, and a gym created today reads back `unset` — the
  :26736 guarantee, pinned by a test rather than by a comment.
- **past closures are not returned** (the read is today-forward in the gym's own
  zone) — and the fixture drives a non-UTC gym, because that is the only way this
  assertion can fail honestly.
- migration: the four CHECKs read back out of `pg_get_constraintdef` after
  migrating (:20222's lesson), and the UNIQUE too.

**Mutation sweep** (`tools/mutate-orgs.mjs`, rule 4/4a): the tenancy predicate on
each new repo function · the `hours_mode` guard · the overlap check · the
today-forward closure filter · the UNIQUE's `ON CONFLICT` arm. Local Postgres
(`test:local`), per :13659.

### 4b — WEB HALF (a separate chat, after 4a's T3)

- Console → Settings → a **"When we're open"** section: 24-hour switch, or a day
  list with add/remove session rows. Uses the existing `ConsoleSection` and
  obeys `readOnly` like every other panel (:24141, :24376).
- A **"Closed today"** control with an optional note, and the list of upcoming
  closures with an undo.
- The member's gym card shows the hours and any closure — **and shows nothing at
  all when the mode is `unset`**, which is the one thing a reviewer should check
  first.
- Tests: the three modes render differently; `unset` renders no sentence about
  opening times; a closure wins over the pattern on screen.

---

## 5 · RISKS, named before the build rather than found after

1. **The `unset` trap is the whole card's failure mode.** Every reader must
   branch on `mode` before drawing a word. A reviewer should mutate `mode` and
   watch a test go red; if none does, the guarantee is a comment.
2. **The weekday convention.** ISO on the wire and in the database, JS in the
   browser. One conversion, in one place, or the gym closes on the wrong day.
3. **The gym's "today".** Both the closure list and any future "are they open
   now" must ask the gym's zone, never the server's and never the browser's.
4. **Overlap validation is new** and has a touching-boundary case that is easy
   to get backwards.
5. **`0017` is hand-written**, so the snapshot debt grows by one. It already has
   an `OWED.md` line; this card does not fix it and must not claim to.

## 6 · SPEC GAP / DEVIATION

**None.** Opening hours have zero spec hits anywhere in `docs/spec/` — this is
new product, and every shape above traces to a Kd ruling at :26624, :26684 or
:26736 rather than to a chat's preference.
