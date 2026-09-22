# AI Home Gym — how we work here

Kd is the product owner. He is a self-described beginner at software. Every chat
builds this product for him, and this file is the whole rulebook. It was rewritten
on 2026-09-07 when Kd ruled the old process too slow; the old playbook is kept at
`archive/records/CLAUDE-playbook-2026-09-07.md` for reference, not for reading.

## 1. Read these before working (and nothing else is required)

1. This file.
2. `RULINGS.md` — Kd's decisions, one line each. They override any chat's judgement.
3. `ROADMAP.md` — the ordered work list. Your task is the next unticked item unless Kd says otherwise.
4. `HANDOFF.md` — the newest entry, to see where the last terminal stopped.
5. `FOLDER.md` at the root of the folder you are in — it says which folder this is (A or
   B), which list of jobs it builds, and its own database, Redis number and ports (§8).
   It is not in git; each folder has its own.
6. The spec section your task touches, in `docs/spec/` (nine files; §-references in
   RULINGS point there). The spec says what to build; RULINGS wins where they differ.

Everything in `archive/` is history. Do not read it unless a RULINGS line points you
at a specific `[archive :line]` for detail. Never quote it as a rule.

## 2. How a job is built

A job is one ROADMAP line, one terminal, one branch and one pull request. Kd says
"build the next thing" in a folder; the terminal takes the first unticked job of that
folder's list (`FOLDER.md`, §8) whose needs are met, and says so if none is.

**Three sizes of job** (Kd, RULINGS 2026-09-22). The plan says which, in its last
line, next to the model and effort. When in doubt, the bigger size.

| Size | What it is | What it gets |
|---|---|---|
| **Risky** | touches sign-in, money, other people's data, uploads, or anything that parses an outside reply or sends data out | everything below: the worst-thing test, the review and its re-check, a deliberate break of its ONE core rule (§4), and, once per feature, the two extra passes (§6) |
| **Ordinary** | a server job with none of that | its tests, one review, and a re-check only if the review found a Critical or High |
| **Screen or wording** | a screen, wording or display job that shows no personal data | its tests and Kd's click-through; no review |

1. **Plan, ten lines or fewer, in plain English, to Kd.** What the user will see, what
   changes on the server, what you will test, anything that costs money or needs a
   new dependency. No file lists, no line numbers, no rule codes, no jargon.
   Its last line names the job's size and recommends the model and effort, with a
   one-line reason (RULINGS 2026-09-17): **Opus high** for a small screen, wording
   or display job; **Opus xhigh** for sign-in, money, other people's data, uploads,
   anything that parses an outside reply or sends data out, or a rule that picks,
   ranks or thresholds; **Fable max** for a planning or redesign terminal that writes
   no code. If Kd's current setting differs, say so before building.
   Its plan also names, in ONE line, **the worst thing this job could do to a real
   person** — a stranger invited into a gym, a wrong allergen shown, somebody else's
   details on a screen — and that line is the FIRST test written (Kd, RULINGS
   2026-09-20, after 3a-ii shipped a review-passed job that would have invited a
   member's nominee instead of the member). Where a job decides something about a
   person from a list of words, the test cases come from OUTSIDE the code — real
   exports, real labels, real wording — and INCLUDE words the list does not have.
   A job that touches nobody says so in that line and moves on.
2. **Kd says go.** No code before that. If he answers a different question than the one
   asked, ask again in one line; never treat a musing as a ruling and never treat your
   own suggestion as his decision.
3. **Build the whole job**, server and screen together when it is small enough, with
   its tests written alongside. One job per terminal. If a job is too big for one
   terminal, split it into user-visible halves and say so in the plan.
4. **Prove it yourself.** Run typecheck, lint and the scoped tests and paste the real
   output. Never describe output you did not see; never summarise it instead of pasting it.
5. **Click-through for Kd**: five to ten numbered steps with what he should see at each,
   against this folder's local servers (`FOLDER.md` has the ports). A job whose screen
   cannot be reached yet says so instead.
6. **Review, by file, never by paste** (Kd, RULINGS 2026-09-22; kept because a fresh
   terminal finds what the builder cannot). A screen-or-wording job skips this step.
   The reviewer is always a fresh terminal that KD opens, never an agent started inside
   the building terminal: three such inside reviews once missed a fault that his own
   fresh terminals found.
   - The building terminal writes `reviews/<job>-1-review.md`: the round-one prompt
     from §6 with the branch or commits filled in, and on its first line where the
     findings go. Then it tells Kd the one line to type, and waits.
   - Kd opens a new terminal in the same folder and types
     `Review reviews/<job>-1-review.md`. That terminal reads the file, does what it
     says, writes `reviews/<job>-2-findings.md`, and changes nothing else.
   - Kd types `Fix the findings` in the building terminal. It reads the findings file,
     fixes every one, commits, and writes `reviews/<job>-3-recheck.md` (the re-check
     prompt from §6 with the fix commits filled in). For an ORDINARY job whose findings
     hold no Critical or High, it fixes the Lows and skips the re-check.
   - Kd types `Re-check reviews/<job>-3-recheck.md` in THAT SAME reviewer terminal,
     never a fresh one. It reads only the fixes and writes `reviews/<job>-4-verdict.md`.
     Kd types `Read the verdict` in the building terminal.
   - The round ends when no Critical/High is open: Lows found by a re-check are fixed
     and merged with no further re-check and without asking (RULINGS 2026-09-16). A
     High found in a fix is fixed and confirmed in that same reviewer terminal. Two
     rounds of Criticals in the same code means stop and ask Kd for a redesign. Risky
     code is reviewed by RUNNING it, not only by reading it: the real SDK, the real
     Redis, a fixed address with several users.
   - A terminal whose whole message is `Review <file>` or `Re-check <file>` is the
     reviewer: it reads that file, does what it says, writes where it says, and touches
     nothing else in the folder. `reviews/` is ignored by git and never committed.
7. **Commit and open a pull request to `master`**; CI must be green; delete the branch
   after the merge. Small commits, explicit file lists (`git add <files>`, never
   `git add -A`). `master` takes pull requests only: GitHub refuses a direct push,
   records included, and refuses a merge until the six checks pass (a skipped check
   counts as passed). **Merge when green** (Kd, RULINGS 2026-09-22): if Kd's start
   text for the job says "merge when green", the building terminal merges its own pull
   request once the checks are green and the review round is closed (or none was due),
   deletes the branch, and says so. Without those words it ends with "say **merge** and
   I merge it" and waits. If the tool refuses the merge because it cannot see those
   words, say so in one line and ask Kd to type `merge`.
8. **Record**: one line in `RULINGS.md` for anything Kd decided; in `ROADMAP.md` the
   job's line becomes ONE line — its number, its name, `[x]`, the merge date and the
   pull request — and anything longer moves whole to `archive/records/ROADMAP-stories.md`
   (a NEW ROADMAP line is three lines at most); ten lines in `HANDOFF.md`. That is all.
   No cards, no essays, no review-round history anywhere, including code comments.
   Records ride on the job's own pull request, never a pull request of their own: a
   push that changes only `.md` files runs just the secrets scan, and every code push
   runs every check — the `what changed` job in `.github/workflows/ci.yml` decides,
   not the terminal.

## 3. Writing for Kd

- Plain English a beginner can read aloud. Say what a user sees, not what the code does.
- Lead with the answer. Short sentences. Tables over paragraphs. Numbers only when they
  change what he does next, and never a number you did not measure with a command.
- One decision at a time, and only decisions that are genuinely his (what the user
  sees, money, legal, order of work). Engineering choices are yours: state them in one
  line and move on.
- A hazard is raised together with its solutions and a recommendation, never alone.
- His words: "terminal", not "chat"; "job", not "card". When a step needs a word of the
  trade ("merge", "pull request", "branch"), say what it means in the same sentence.
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
the first to sweep it. **Deliberate breaks** (Kd, RULINGS 2026-09-22): for a RISKY job
only, and only on its ONE core rule — the rule behind the plan's worst-thing line — the
builder breaks that rule on purpose two or three ways, shows the test go red each time
with the output pasted, and puts it back. Never on the rest of the job, never for an
ordinary or screen job, never in CI. The harnesses in `apps/*/tools/mutate-*.mjs` are the
tool where one already fits; a break made by hand and shown is the same proof.

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
(Folder A's `apps/api/.env` points at Kd's real Neon data; never run sweeps or seeds
against it, and never `--env-file=.env` for anything that touches a gym); web with
`corepack pnpm --filter web dev`. Each folder's `FOLDER.md` gives its own database name,
Redis number, ports and the exact commands. Folder B sets `LOCAL_DATABASE_URL` and
`LOCAL_REDIS_URL` before `test:local`, or its tests run on Folder A's database.

## 6. The review prompts

Round one. The building terminal writes it into `reviews/<job>-1-review.md` with the
branch or commits filled in, under this first line: *Write your findings to
`reviews/<job>-2-findings.md`. Change nothing else in this folder.* Kd opens a fresh
terminal in the same folder and types `Review reviews/<job>-1-review.md`:

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

The re-check. The building terminal writes it into `reviews/<job>-3-recheck.md` with the
fix commits filled in, under the first line *Write your verdict to
`reviews/<job>-4-verdict.md`.* Kd types `Re-check reviews/<job>-3-recheck.md` into THAT
SAME reviewer terminal, never a fresh one:

```
Re-check, in this chat: cover only the fixes in <commit>. For each of your findings
say closed or still open, with file:line. Report anything a fix broke. No new sweep
of the rest of the diff. If nothing Critical/High is open, say so in one line: the
round ends there.
```

**The two extra passes, for a FEATURE that touches sign-in, money, other people's
data, uploads, or anything that parses an outside reply or sends data out** (Kd,
2026-09-20; moved from the card to the FEATURE on 2026-09-21, the chat's call on Kd's
question). Each goes to a FRESH terminal of its own, never two in one (Kd, 2026-09-21),
by file like round one: the building terminal writes `reviews/<feature>-security.md`
and `reviews/<feature>-integrity.md`, Kd types `Review <file>` in a fresh terminal for
each, and the findings are fixed the way round one's are.

**They run ONCE, over the whole feature's diff, when its last card is built and BEFORE
anybody uses it** — not after every card. A feature is a roadmap line's family (3a-i to
3a-iv is one feature, not four), and the gate is USE, not merge: a card merges on round
one alone, because nothing on `master` is in front of a real person before launch. Two
reasons it is safe and better, not merely cheaper. Round one already carries a security
pass of its own on every card (§6's prompt asks for it), so this is depth, not first
cover. And half a feature cannot be attacked properly: a data-integrity reviewer has
almost nothing to bite on in a card that deliberately writes nothing, while the card
that writes is reviewed without the one that stages. **If a card WILL be used before
its feature is finished** — Kd or a real gym touching its screen, or anything that sends
a real email — both passes run before that use, not after it.

A feature outside that list gets neither.

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

## 8. Two folders, two terminals

Two DIFFERENT features are built at once (Kd, RULINGS 2026-09-22). Folder A is
`D:\Projects\ai-home-gym`; Folder B is `D:\Projects\ai-home-gym-b`, a git worktree of
the same repository (one `.git`, two checkouts, so a branch can be open in only one of
them at a time). Each folder's `FOLDER.md` names its list of jobs, its own database,
Redis number and ports; the two lists are in ROADMAP Stage 2's header.

- Kd says "build the next thing" once in each folder. A terminal takes the first
  unticked job of ITS folder's list whose needs are met, and if none is, says so
  rather than taking the other folder's.
- Records (RULINGS, ROADMAP, HANDOFF) are written on the job's own branch, each job
  touching only its own lines, so the two folders' records never collide.
- Jobs merge ONE at a time. The one that merges second first takes `master` in,
  re-runs its checks, and, if both added a migration, renames its own to the next free
  number and re-stamps its journal entry: Drizzle applies migrations in the journal's
  time order and would skip an older-stamped one on a database already past it.
- Each folder runs only its own servers, on its own ports, against its own database
  and Redis number; the Docker containers are shared and started once.
- `FOLDER.md` and `reviews/` are ignored by git: they are the folder's own.
