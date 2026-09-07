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
   chat reviews the diff (the review prompt is in §6). The building chat fixes every
   finding, the reviewer re-checks only the fixes, and that is the end of the round.
   No third round unless a Critical/High is still open. Two rounds of Criticals in the
   same code means stop and ask Kd for a redesign.
7. **Commit and open a pull request to `master`**; CI must be green; merge within a day
   or two; delete the branch. Small commits, explicit file lists (`git add <files>`,
   never `git add -A`).
8. **Record**: one line in `RULINGS.md` for anything Kd decided; tick or add lines in
   `ROADMAP.md`; ten lines in `HANDOFF.md`. That is all. No cards, no essays, no
   review-round history anywhere, including code comments.

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
test. Mutation harnesses (`apps/*/tools/mutate-*.mjs`) are run only when sign-in, money
or other-people's-data code changes, never as a routine step and never in CI.

**Dependencies.** A new dependency needs Kd's yes in the plan, with the reason.

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

## 6. The review prompt (paste into a fresh chat)

```
You are reviewing, not fixing. Read CLAUDE.md §4 and RULINGS.md. Audit the diff of
<commits or branch> against them and the spec sections it touches. Report only:
(1) defects, each tagged Critical/High (security, data loss, privacy, money, a broken
core flow, or anything a user can SEE that is FALSE) or Low (wording, naming, style),
with file:line and a one-line fix; (2) a security pass: authentication, tenancy,
input parsing, idempotency, secrets and logs, SQL; (3) tests that would stay green if
the thing they claim to check were broken. No praise, no restating the diff. If this
is a re-check, cover only the fixes.
```

## 7. Layout

`apps/api` (Fastify, TypeScript) · `apps/web` (React, JavaScript, Vite) · `apps/mobile`
(Expo, Stage 5) · `packages/engine` (pure pose engine) · `packages/shared` (Zod contracts,
API client) · `packages/config` · `docs/spec` (the nine spec files) · `infra` (Docker,
Caddy) · `RUNBOOK` (operational procedures) · `tools` and `apps/*/tools` (harnesses and
seeds) · `archive` (history: records, old backends, old smoke sheets — never required).
