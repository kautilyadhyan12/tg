# AI Home Gym — how we work here

Kd is the product owner. He is a self-described beginner at software. Every chat
builds this product for him, and this file is the whole rulebook. It was rewritten
on 2026-09-07 when Kd ruled the old process too slow; the old playbook is kept at
`archive/records/CLAUDE-playbook-2026-09-07.md` for reference, not for reading.

## 1. Read these before working (and nothing else is required)

1. This file.
2. `RULINGS.md` — Kd's decisions, one line each. They override any chat's judgement.
3. `ROADMAP.md` — the ordered work list. Your task is the next unticked item unless Kd says otherwise.
4. `HANDOFF.md` — the newest entry, to see where the last chat stopped.
5. The spec section your task touches, in `docs/spec/` (nine files; §-references in
   RULINGS point there). The spec says what to build; RULINGS wins where they differ.

Everything in `archive/` is history. Do not read it unless a RULINGS line points you
at a specific `[archive :line]` for detail. Never quote it as a rule.

## 2. How a feature is built

1. **Plan, ten lines or fewer, in plain English, to Kd.** What the user will see, what
   changes on the server, what you will test, anything that costs money or needs a
   new dependency. No file lists, no line numbers, no rule codes, no jargon.
   Its last line recommends the model and effort for building the card, with a
   one-line reason (RULINGS 2026-09-17): **Opus high** for a small screen, wording
   or display card; **Opus xhigh** for sign-in, money, other people's data, uploads,
   anything that parses an outside reply or sends data out, or a rule that picks,
   ranks or thresholds; **Fable max** for a planning or redesign chat that writes no
   code. If Kd's current setting differs, say so before building.
   Its plan also names, in ONE line, **the worst thing this card could do to a real
   person** — a stranger invited into a gym, a wrong allergen shown, somebody else's
   details on a screen — and that line is the FIRST test written (Kd, RULINGS
   2026-09-20, after 3a-ii shipped a review-passed card that would have invited a
   member's nominee instead of the member). Where a card decides something about a
   person from a list of words, the test cases come from OUTSIDE the code — real
   exports, real labels, real wording — and INCLUDE words the list does not have.
   A card that touches nobody says so in that line and moves on.
2. **Kd says go.** No code before that. If he answers a different question than the one
   asked, ask again in one line; never treat a musing as a ruling and never treat your
   own suggestion as his decision.
3. **Build the whole feature**, server and screen together when it is small enough,
   with its tests written alongside. One feature per chat. If a feature is too big for
   one chat, split it into user-visible halves and say so in the plan.
4. **Prove it yourself.** Run typecheck, lint and the scoped tests and paste the real
   output. Never describe output you did not see; never summarise it instead of pasting it.
5. **Click-through for Kd**: five to ten numbered steps with what he should see at each,
   against the local servers. A card whose screen cannot be reached yet says so instead.
6. **Independent review** — kept by Kd's ruling because it found real problems. A FRESH
   chat reviews the diff (the round-one prompt is in §6). The building chat fixes every
   finding. The re-check goes back to THAT SAME reviewer chat, never a fresh one: Kd
   pastes the re-check prompt from §6 into it and it reads only the fixes. A High
   found in a fix is fixed and confirmed in that same chat. The round ends when no
   Critical/High is open: Lows found by a re-check are fixed and merged with no
   further re-check and without asking (RULINGS 2026-09-16). Two rounds of Criticals
   in the same code means stop and ask Kd for a redesign. Risky code — sign-in, money,
   other people's data, uploads, anything that parses an outside reply or sends data
   out — is reviewed by RUNNING it, not only by reading it: the real SDK, the real
   Redis, a fixed address with several users.
7. **Commit and open a pull request to `master`**; CI must be green; merge within a day
   or two; delete the branch. Small commits, explicit file lists (`git add <files>`,
   never `git add -A`). `master` takes pull requests only: GitHub refuses a direct
   push, records included, and refuses a merge until the six checks pass (a skipped
   check counts as passed).
8. **Record**: one line in `RULINGS.md` for anything Kd decided; tick or add lines in
   `ROADMAP.md`; ten lines in `HANDOFF.md`. That is all. No cards, no essays, no
   review-round history anywhere, including code comments. Records ride on the
   feature's pull request, never a pull request of their own: check minutes are
   metered (GitHub Pro, 3,000 a month), so a push that changes only `.md` files runs
   just the secrets scan, and every code push runs every check — the `what changed`
   job in `.github/workflows/ci.yml` decides, not the chat.

## 3. Writing for Kd

- Plain English a beginner can read aloud. Say what a user sees, not what the code does.
- Lead with the answer. Short sentences. Tables over paragraphs. Numbers only when they
  change what he does next, and never a number you did not measure with a command.
- One decision at a time, and only decisions that are genuinely his (what the user
  sees, money, legal, order of work). Engineering choices are yours: state them in one
  line and move on.
- A hazard is raised together with its solutions and a recommendation, never alone.
- Never remove, hide or shrink a feature on your own judgement. "Switched off" is not
  "deleted". A missing backend is a reason to build it, never to trim the screen.

## 4. Engineering rules that are not negotiable

**TypeScript.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
the rest of the shared config. No `any`, no `@ts-ignore`, no non-null `!` in `apps/api`
or `packages/engine`, no `as` outside adapter files. The web app is JavaScript and
stays so; new web code follows its existing patterns.

**Parse, don't trust.** Every external input (HTTP body, query, params, webhooks, env,
queue jobs, AI and vision responses, files) crosses the boundary through a Zod schema
in `packages/shared`. Env is parsed once at boot. Request and response shapes live once,
in `packages/shared`.

**Security.**
- The server computes everything that grants value: prices, plans, quotas, roles, trials.
- Tenancy on every query: a tenant-owned row is always fetched with its owner in the
  `WHERE`. Every new route ships with a test proving a stranger gets 403 or 404.
- Route order: authenticate → role/privilege → entitlement → quota → rate limit → handler.
- Webhooks: verify the signature on the raw body, dedupe by provider event id, ack, then
  a worker fetches the authoritative object. Idempotency keys on sync and every
  payment-adjacent POST; every queue handler safe to run twice.
- Secrets never in code, logs, error responses or client bundles. Gitleaks in CI.
- Auth: httpOnly cookies only; hashes never reversible; one-time codes and tokens stored
  as hashes with expiry and single use; per-IP and per-identifier rate limits on every
  entry point; responses never reveal whether an account exists.
- Never log passwords, tokens, cookies, raw payloads or keypoints with identity.
- SQL only through Drizzle or parameterised `sql` values; no string-built SQL.
- Uploads: magic-byte type check, size cap, server-generated keys, signed URLs.

**Database.** UUID keys, `timestamptz` in UTC, day math only with the user's or gym's
time zone. Status columns are text with a CHECK. Migrations generated by Drizzle,
reviewed as SQL, forward-only, one per pull request, applied in CI. Repos are the only
files that touch the database.

**Engine (`packages/engine`).** Pure: no clock, no randomness, no platform globals, no
network — the CI grep enforces it. Same frames in, same events out. Garbage in means no
decision, never a wrong one. Exercises are data; engine code never names an exercise.

**Money.** Integer minor units everywhere. One pure transition function for subscription
state with exhaustive tests. Provider SDK types never leak past the adapter. Sweeps and
trials use an injectable clock.

**Health and safety (from RULINGS 2026-09-07).** No calorie deficit under 18, in
pregnancy, or for a flagged heart, blood-pressure or diabetes answer. Safe mode hides
workout and run plans until a professional's clearance is confirmed. Every suggestion
that involves food shows its allergens. Disclaimer text is never softened or removed.

**Tests.** Route tests via `fastify.inject` covering the happy path, a validation failure
and the cross-tenant denial. Database-backed tests run against the local Postgres
(`pnpm --filter api test:local`, Docker Desktop running). A bug fix starts with a failing
test. A rule that picks, ranks or thresholds (which entry wins, which portion applies)
ships with a table test over every class of case BEFORE review; the reviewer is never
the first to sweep it. Mutation harnesses (`apps/*/tools/mutate-*.mjs`) are run only when
sign-in, money or other-people's-data code changes, never as a routine step and never in CI.

**The worst thing (RULINGS 2026-09-20).** A rule that decides something about a PERSON
is tested against the world, not against itself: a table built from the code's own word
list proves only that the list matches itself. Go and get real cases — a real export's
headings, a real label's wording — and include what the list has never heard of. The
structural rule comes first where one exists (a plain heading beats a qualified one),
and the word list is the backstop, never the mechanism.

**Dependencies.** A new dependency needs Kd's yes in the plan, with the reason.

**Cost at full size (Kd, 2026-09-20, after the member-list preview).** A card that
reads or writes a list of PEOPLE is not done until it says what it costs at the
BIGGEST size the app allows, measured with a command like every other number here —
and the number that matters is not how long it takes, it is **how long the server
answers nobody**, because that time is taken from every other gym and every member
using the app at that moment. Measure it for each thing staff will actually do: the
upload, the preview, one page of names, a sweep. 3a-iii-a shipped with a page of a
hundred names blocking the whole server for 121 ms — a hundred pages for one gym,
twelve seconds of answering nobody — and no rule asked, so nothing found it until Kd
did. The launch shape to measure against is 20 gyms of 200 (RULINGS 2026-09-20), and a
number that is comfortable there is still stated, not assumed.

**Numbers.** Any count, size, threshold or "the file contains X" claim comes from a
command run in this session, with its output shown. Otherwise write "unverified".

## 5. Commands

```bash
# per package (pnpm is not on PATH; corepack is)
corepack pnpm --filter api exec tsc --noEmit
corepack pnpm --filter api exec eslint src test tools
corepack pnpm --filter @app/shared exec tsc --noEmit
corepack pnpm --filter @app/engine test
corepack pnpm --filter web test

# database-backed api tests, once per machine restart:
docker compose -f infra/docker-compose.dev.yml up -d postgres redis
corepack pnpm --filter api test:local            # or test:local -t "name" / a file path

# root guards (what CI runs)
corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test

# engine purity (must print nothing)
grep -rnE 'Date\.now|new Date\(|Math\.random|performance\.now|setTimeout|setInterval|process\.env|window\.|document\.|navigator\.|localStorage|fetch\(|console\.|toLocale|Intl\.' packages/engine/src

# secrets
gitleaks protect --staged --no-banner
```

Dev servers: api from `apps/api` with `DATABASE_URL` pointing at the LOCAL database
(the `.env` there points at Kd's real Neon data; never run sweeps or seeds against it);
web with `corepack pnpm --filter web dev`.

## 6. The review prompts

Round one, pasted into a FRESH chat:

```
You are reviewing, not fixing. Read CLAUDE.md §4 and RULINGS.md. Audit the diff of
<commits or branch> against them and the spec sections it touches. Where it touches
sign-in, money, other people's data, uploads, or anything that parses an outside
reply or sends data out, RUN it (the real SDK, the real Redis, a fixed address with
several users); do not only read it. Report only:
(1) defects, each tagged Critical/High (security, data loss, privacy, money, a broken
core flow, or anything a user can SEE that is FALSE) or Low (wording, naming, style),
with file:line and a one-line fix; (2) a security pass: authentication, tenancy,
input parsing, idempotency, secrets and logs, SQL; (3) tests that would stay green if
the thing they claim to check were broken. No praise, no restating the diff.
```

The re-check, pasted into THAT SAME reviewer chat, never a fresh one:

```
Re-check, in this chat: cover only the fixes in <commit>. For each of your findings
say closed or still open, with file:line. Report anything a fix broke. No new sweep
of the rest of the diff. If nothing Critical/High is open, say so in one line: the
round ends there.
```

**The two extra passes, for a card that touches sign-in, money, other people's data,
uploads, or anything that parses an outside reply or sends data out** (Kd,
2026-09-20). They are ROUND ONE's siblings, not its replacement: each goes in a FRESH
chat of its own, after round one has closed, and its findings are fixed the same way.
A card outside that list gets neither.

```
Act as a hostile security reviewer. Read CLAUDE.md §4 and RULINGS.md. Do not modify
anything. Attack the diff of <commits or branch>: authentication bypass, authorisation
bypass and IDOR (one gym reading another's people), injection, information leakage,
sensitive data in logs, error replies or Sentry, insecure file handling, replay,
broken or bypassable rate limiting, enumeration, and denial of service. RUN it — the
real route on local Postgres and the real Redis, several gyms and several staff at ONE
fixed address. For every finding give the exact code path (file:line), the attack a
real person could carry out, its severity, and a one-line fix. Do not call the code
safe because the tests pass.
```

```
Act as a data-integrity reviewer. Read CLAUDE.md §4 and RULINGS.md. Do not modify
anything. Assume two staff, or two requests, do the same thing at the same instant,
and that any request can arrive twice. In the diff of <commits or branch> find every
operation that can produce a duplicate row, a lost update, an inconsistent state, a
duplicate job, a duplicate email, or a half-finished change — and every check-then-act
that two requests can pass together. Say where a transaction, a unique constraint, a
lock, an idempotency key or one atomic statement is required instead. RUN the races
you name. file:line and a one-line fix for each.
```

## 7. Layout

`apps/api` (Fastify, TypeScript) · `apps/web` (React, JavaScript, Vite) · `apps/mobile`
(Expo, Stage 5) · `packages/engine` (pure pose engine) · `packages/shared` (Zod contracts,
API client) · `packages/config` · `docs/spec` (the nine spec files) · `infra` (Docker,
Caddy) · `RUNBOOK` (operational procedures) · `tools` and `apps/*/tools` (harnesses and
seeds) · `archive` (history: records, old backends, old smoke sheets — never required).
