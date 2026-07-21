## MIGRATION STANCE (read before touching any file)

This repository is being REBUILT toward the architecture in docs/spec/, not
patched. The existing code (backend-auth, backend-ml, frontend, ml-training)
is the PREVIOUS version. Treat it as a SALVAGE SOURCE, not a template.

- The spec's target architecture WINS over any pattern in the old code.
  Where they conflict, follow the spec. Never preserve an old pattern just
  because it exists (the two-backend auth/ml split, MongoDB, the WebSocket
  pose path, Python form analysis on the server — these are all being
  REPLACED per the spec; do not carry them forward).
- You may REUSE specific existing logic ONLY when the documents/specs explicitly name it in a
  task (e.g. "port the bcrypt/token logic from backend-auth"). Reuse = extract
  the proven logic, then re-express it in the new structure. It does NOT mean
  keep the old file, folder layout, or dependencies.
- If you think an old pattern is worth keeping and the spec doesn't mention
  it, do NOT silently keep it. Raise it: "PRESERVE PROPOSAL: <what> because
  <why>" and wait for my decision.
- When in doubt about old-vs-new, the spec is the tie-breaker. If the spec is
  silent, ask — never default to "what the old code did."

**NO FEATURE IS EVER REMOVED, HIDDEN, OR "REDUCED TO WHAT THE BACKEND HAS"
WITHOUT AN EXPLICIT KD RULING MADE IN RESPONSE TO A CITED OPTION. A missing
backend surface is NEVER a reason to shrink the UI — the UI component STAYS
UNTOUCHED on the old backend (the Card-1/2 precedent: Onboarding/Settings,
"nothing deleted; all owed") and the endpoint gap is recorded as an OWED CARD.
The cutover runbook's "endpoints must exist for each feature" prerequisite is
the enforcement: P2.8 cannot run until every owed endpoint exists. A chat that
proposes hiding/removing UI must, in the same breath, cite the DECISIONS line
or spec § that sequences that feature's backend — no citation, no proposal.**
(Operator-added 2026-07-16 after a chat recommended "reduce the UI to what the
backend has" for gamification/predictions surfaces whose deferral was already
Kd-ruled and sequenced in DECISIONS 2026-07-11 and CLAUDE.md P4.x — the
recommendation was framed as removal instead of citing the existing rulings.)

**EVERY DEFERRAL GETS A LINE IN `OWED.md`, IN THE SAME COMMIT THAT DEFERS IT.**
`OWED.md` at the repo root is the single list of everything outstanding —
blocking and non-blocking, code and rulings. DECISIONS.md is a DIARY (what was
decided, why, in order) and cannot answer "what is still to do"; cutover.md
tracks only P2.8 blockers. A deferral written into DECISIONS prose alone is how
work gets silently lost — proven on 2026-07-21, when an audit found TWO items
owed and tracked nowhere: Google login (a user-facing feature switched off
since 2026-07-15, which the no-removal rule above exists to prevent) and
timezone capture (every user bucketed as UTC since 2026-07-11, so streaks roll
over at the wrong hour for everyone outside London). Items leave OWED.md only by
being DONE (ticked, dated, commit named) or by an explicit Kd ruling that they
will never be built (struck, ruling cited).
(Operator-added 2026-07-21 after Kd asked that nothing be "left to do later and
forgotten about silently".)

**GROUNDING BEFORE EVERY DECISION AND EVERY RECOMMENDATION — NO EXCEPTIONS.
Before proposing, recommending, planning, or deciding ANYTHING, the chat MUST
have read, IN THIS SESSION: (1) the spec §§ the task touches, (2) this file's
rules for the domain, (3) the ENTIRE DECISIONS.md — every ruling, because any
one of them may already answer the question, (4) HANDOFF.md's top block, and
(5) RUNBOOK/cutover.md's prerequisites when the work affects the migration.
Reading the spec but skipping DECISIONS.md is NOT grounded — DECISIONS.md IS
the operator's case law and it OVERRIDES a chat's fresh judgment every time.
A recommendation that contradicts or ignores an existing DECISIONS line is
void, and re-asking Kd to rule on something DECISIONS already rules on is a
protocol failure, not diligence. If any of these files was not read this
session, the only permitted output is reading it — not an opinion.**
(Operator-added 2026-07-16 after the same incident: the chat had read the spec
and verified endpoints but had NOT re-read DECISIONS.md's P2.3 entries, and so
re-litigated four questions Kd had already ruled on 2026-07-11.)


# AI Home Gym — Implementation Playbook for Opus 4.8

**Companion to the 8-part spec set (Architecture v1 + Parts 2–8). The spec says WHAT to build; this document controls HOW an AI model builds it without introducing bugs or security holes.**

**How to deploy this document (chat workflow):** best option — create a Claude Project called *AI Home Gym build* and put this file plus the nine split spec files into Project knowledge once; every chat inside the Project then sees them automatically, and per chat you add only the task prompt and the source files being touched. Without Projects — upload this file into **every** task chat, plus only the spec files the task card lists. Keep the nine spec files in `docs/spec/` in your repo regardless (they are the binding reference), and never feed the raw PDF or the old code zip into a task chat. (If you ever adopt Claude Code, this same file becomes `CLAUDE.md` at the repo root.)

**One honest note before the rules.** The risk on this project is not that Opus 4.8 "can't code" — it is a very strong coding model. The risk with *any* model, on a 182-page spec, is process: too much scope per session, silently inventing things the spec already decided, and shipping code that was never actually run. Every rule below closes one of those three doors. Follow the process and the model choice stops mattering much.

---

# PART 0 — Errata & binding clarifications (read before anything else)

These resolve every known inconsistency in the source documents. When a chat's output contradicts one of these, the chat is wrong.

1. **The catalog is 58 exercises — final.** Part 2 v2.1's evidence-verified changelog corrected Architecture v1's 59. Wherever `00-architecture-v1.md` says 59, read 58. The definitive list is Part 2 §6.
2. **Family templates: 12** (Part 2 §5 heading). v1 §23's "11" predates the final count.
3. **"Bit-for-bit" (invariant I2) is scoped by §7.4.** Integer/enum outputs — rep counts, fault multisets, FSM states — must match golden traces exactly. Float outputs compare within §7.4's written tolerances (scores: the trace's declared `scoreRange`, with ±5-point authoring slack; hold time ±700 ms). Do not chase float bit-equality across JS engines, and never widen a tolerance to turn a red trace green.
4. **Numeric gate values are quoted, never recalled.** Trace counts (§7.3: ≥6 per exercise; §7.5: ≥6+4+4 parity sessions), tolerances (§7.4), perf budgets (§1.3 I5, §7.6), prices (Part 5 §1) — every such number appearing in code or tests must be traceable to the spec line it came from, cited. A model summarizing "±3" when §7.4 says ±5 is exactly the failure this rule exists to catch — it has already happened once.
5. **The source PDF contains Part 2 twice.** The split kept the later, complete copy. Work only from the nine split files.
6. **Citation convention:** "v1 §6" or "Part 1 §6"-style references mean `00-architecture-v1.md` §6.

---

# PART I — Operator protocol (for Kd: how to run every task chat)

## 1. The unit of work is one task card, one chat
Never ask for "implement Phase 2." Ask for exactly one line from a Part III task card. When a task is done and committed, close the chat and open a **fresh one** for the next task. Signs a chat has gone stale: the model re-explains earlier decisions, touches files outside the task, or the diff passes ~300–400 changed lines. Stop, commit what is verified, restart in a new chat.

## 2. The acceptance loop — never skip a step
```
PLAN  → model restates the task, lists files/functions/tests/migrations/risks,
        flags SPEC GAP questions. No code yet.
GATE  → you reply "approved" or corrections — nothing else. No approval, no code.
CODE  → model implements ONLY the approved plan.
PROVE → a chat cannot run your repo. The model ends with the EXACT commands to
        run; YOU run them locally and paste the full output back; it reads the
        output, fixes, and re-issues commands until green. It never declares
        success on output it has not seen. Exception — pure packages (engine,
        shared): upload the package folder as a zip and require the model to
        install and run its tests in its own sandbox, pasting genuine output.
        The engine has zero runtime deps by design (I1), so this works.
AUDIT → model outputs the self-audit table (rule → pass/fail/N-A) and the
        universal DoD checklist from Part II R11.
SMOKE → (Kd-added 2026-07-16; REQUIRED for any card that changes user-facing
        behavior — web/mobile screens, API responses a screen consumes.) The
        model hands Kd a numbered browser click-through with an explicit
        ✅-expectation per step, run against the LOCAL api + web dev servers;
        Kd reports pass/fail per step; failures are fixed (R9.5: failing test
        first where a test can express it) before the card is "done". This is
        NOT optional polish: unit suites run through fastify.inject() and
        node-vitest, which BYPASS the browser entirely — the Card 4 smoke
        caught a CORS preflight bug (browser DELETE/PATCH/PUT dead app-wide)
        that 250+ green tests were structurally incapable of seeing. A card
        whose UI cannot be reached yet states that explicitly instead.
REVIEW→ you run the 5-minute checklist in Part VI yourself. Re-run the
        commands yourself at least for money/auth/engine code.
COMMIT→ small commit, message references the task card ID and spec §.
```
Nothing merges without PROVE and REVIEW — and no user-facing card is "done" without its SMOKE. This loop is where "no bugs" actually comes from — the spec's golden traces, test matrices, and CI gates only protect you if unverified code never lands.

## 3. What goes into a session's context
Every task chat gets: this playbook (via Project knowledge or upload) · the task card pasted in the prompt · **only** the spec files that card's Attach line lists · the **current contents of every source file being modified** (uploaded or pasted — the model cannot see your disk, and editing a file from memory of a previous chat is forbidden). Never attach all 182 pages, the raw PDF, or the old code zip — precision of attention beats volume of context; the spec was split into nine files for exactly this reason.

## 4. Chats are stateless — the repo is the only memory
No chat remembers another. Two mechanisms bridge them: **(a) the repo itself** — a task is not done until committed, and the next chat receives current file contents, never a description of them; **(b) a HANDOFF block** — every task chat must end with a fenced block containing: task ID · files changed · decisions made · open SPEC GAPs · next task card ID. Append it to `HANDOFF.md` in the repo and paste the latest one under the T1 prompt of the next chat. Cheap insurance against re-deciding settled questions.

## 5. Deviations from the spec
The model must never silently deviate. If it believes the spec is wrong or a better option exists, it must output a block labeled `DEVIATION PROPOSAL` containing: spec § affected, what it proposes, why, and blast radius. You decide. Approved → one line in `DECISIONS.md` (date, §, decision, reason). Rejected → spec stands. Precedence when parts conflict: an explicit "Amendments" section in a later part wins; otherwise the more specific part wins; otherwise it is a SPEC GAP question, not a coin flip.

## 6. Git and migration discipline
Feature branch per task card · small commits · one Drizzle migration per PR, reviewed **as SQL** by you · `main` is always deployable · CI (typecheck, lint, tests, golden traces, gitleaks, migration-on-Neon-branch) must be green before merge — set this up in Phase 0 and never bypass it "just this once."

## 7. Difficulty tiers — the 🔴 hard-task protocol
Task cards in Part III carry a tier. 🟡 moderate tasks use the standard loop above. 🔴 hard tasks (engine pipeline stages, the form-analyzer port, the trace harness, all Part 5 money code, the Mongo→PG migration, the mobile pose spike and sync protocol) add four rules:
**(a)** the plan names the tests before the code — tests are written with or before the implementation, never after;
**(b)** hard ceilings per chat: one pipeline stage, one provider adapter, one migration — never two;
**(c)** before merge, the diff goes to a **separate, fresh chat** running the T3 review template — the reviewer must not be the chat that wrote the code, or it will defend its own reasoning instead of auditing it;
**(d)** the form-analyzer port runs as two chats: P1.8a produces only the constants inventory for your review; P1.8b writes definitions from the approved table and nothing else.

---

# PART I.5 — VERIFICATION DOCTRINE (operator-added 2026-07-12; binding on every chat)

Added after a real incident: a planning chat asserted the curated food table had
168 rows; it has 130. The claim was stated as fact without counting. These rules
make that class of error structurally hard:

V1. **No number without a command.** Any count, size, version, line number, price,
    threshold, or "the file contains X" claim about THIS repo or the salvage code
    must be produced by a tool invocation (grep -c, wc, a test, a SELECT) run in
    THIS chat, with its output shown. If you cannot run it, prefix the claim with
    "UNVERIFIED:". An unverified number in a plan is treated as wrong by default.
V2. **Quote, don't recall.** Spec values are copied from the open file and cited
    §-and-line, never reproduced from memory (restates Part 0 rule 4 — it applies
    to plans and chat prose, not just code).
V3. **Plans name their evidence.** Every factual premise in a PLAN carries its
    source: a file read this session, a command output, or a DECISIONS/HANDOFF
    line. A premise with no source is a SPEC GAP question, not a fact.
V4. **Re-derive nothing that exists.** Before describing repo state (tables,
    endpoints, exports, test counts), read the current file or run the command —
    never infer it from an earlier task's description.
V5. **Uncertainty is said out loud.** "I believe / probably / should be" are
    banned in front of verifiable claims — verify, or mark UNVERIFIED.
V6. Mistakes will still happen. The safety net stays: plan-gate → PROVE with real
    pasted output → T3 in a fresh chat. Nothing above replaces those.
V7. **Merge protocol** (added after PR #20 was merged pre-T3-fix): Kd merges only
    after the chat explicitly writes "READY TO MERGE" — which it may do only when
    CI is green AND every T3 finding is resolved and pushed.

---

# PART I.6 — SESSION-START PROTOCOL (operator-added 2026-07-12; binding on the
FIRST reply of every new chat)

Added after repeated new-chat failures: misreading repo state, treating the
kickoff prompt as truth, filling gaps with assumptions, and volunteering
opinions instead of following rulings. Before ANY substantive output, a new
chat must:

S1. **Ground in the repo, not the prompt.** Run `git log --oneline -3` and
    `git status --short`; read the TOP block of HANDOFF.md and the tail of
    DECISIONS.md. Show these outputs. If anything in the kickoff prompt
    contradicts the repo, THE REPO WINS — say so explicitly and stop for
    Kd's ruling. A kickoff prompt is a summary written by another chat: it
    is hearsay, not a source (V4 applies to it in full).
S2. **Restate the task with evidence.** ≤10 lines, every factual premise
    tagged with its source (file read this session / command output /
    DECISIONS/HANDOFF line). A premise you cannot tag is a question for Kd,
    not a working assumption.
S3. **Assumptions are forbidden; questions are cheap.** If required context
    is missing (a file, a ruling, a connection string), ask ONE compact
    batch of questions. Never proceed on "probably".
S4. **No unsolicited opinions.** Alternatives and critiques appear ONLY as a
    labeled `DEVIATION PROPOSAL` (spec conflicts) or `RECOMMENDATION`
    (operator convenience), each with evidence and blast radius — then STOP
    for Kd's decision. Anything else is silent scope drift and will be
    reverted. Implement rulings as written even if you'd have chosen
    differently; your disagreement belongs in a labeled block, not in the
    code.
S5. **Inherited work is unverified work.** Taking over a partial branch?
    Re-verify what exists (typecheck, lint, scoped tests, targeted greps)
    before building on it — the previous chat's claims about its own work
    follow V1 like everything else.

---

# PART II — Standing rules for the implementing model (binding, numbered)

You are implementing the AI Home Gym spec set. These rules are non-negotiable. When any rule conflicts with being fast or agreeable, the rule wins.

## R0 — Spec supremacy
1. The files in `docs/spec/` are law. Cite the governing § for every non-obvious decision you make.
2. If the spec is silent or ambiguous on something you need, output `SPEC GAP: <question>` and **stop**. Never invent schema fields, endpoints, prices, thresholds, quota numbers, or state-machine transitions. Never "fill in what the author probably meant."
3. If you believe the spec is wrong, output `DEVIATION PROPOSAL` (per Part I §5) and stop. Do not implement your alternative.
4. Amendments precedence: later part's explicit amendment §0 > more specific part > ask.
5. The spec files are pdftotext extractions; if a numeric value or SQL fragment looks garbled by line-wrapping, say so and ask for the PDF value instead of guessing.

## R1 — Scope discipline
1. Implement only the named task. No drive-by refactors, renames, dependency bumps, formatting sweeps, or "while I was here" fixes. If you notice a real problem outside scope, report it in one line at the end; do not touch it.
2. Plan before code (Part I §2). List every file you will create or modify. Then touch only those files.
3. No TODO/stub/placeholder code paths in auth, money, tenancy, or engine code. A stub that returns success is a security bug wearing a disguise. If something can't be finished in-task, fail loudly (`throw new NotImplementedError`) — never fake it.
4. New dependencies require explicit approval, with the reason and the npm weekly-download/maintenance sanity check stated. Prefer the stack the spec fixed: Fastify, Zod, Drizzle, BullMQ, pino — do not introduce parallel ways to do the same job.

## R2 — TypeScript & code quality
1. `tsconfig` (in `packages/config`, extended everywhere): `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitReturns": true`, `"noFallthroughCasesInSwitch": true`, `"noImplicitOverride": true`, `"isolatedModules": true`. CI also enforces `noUnusedLocals/Parameters`.
2. Banned: `any` (explicit or via bare `{}`/`Function`), `@ts-ignore`, non-null `!` in `apps/api` and `packages/engine`, `as` casts outside adapter files (and there only with a runtime guard on the same line's block). `@ts-expect-error` allowed only with a comment explaining why and an issue reference.
3. Parse, don't validate: every external input (HTTP body/query/params, webhook payloads, env vars, queue job data, LLM/vision API responses, files) crosses the boundary through `schema.parse()` / `safeParse` from `packages/shared`. Inside the boundary, types are trusted because the parser made them true. Env vars are parsed **once** at boot into a typed config object (the existing repos' fail-fast boot validation carries over — v1 §1.1); `process.env` is never read elsewhere.
4. Exhaustiveness: every `switch` over a union ends in a `default` that assigns to `never` (`assertNever(x)`). All state machines (subscription, rep FSM, sync status) are typed unions driven by an explicit transition table — no ad-hoc `if (status === ...)` ladders scattered across files.
5. All async errors handled: no floating promises (`@typescript-eslint/no-floating-promises` = error), no empty `catch`, no `catch (e) { console.log(e) }` in `apps/api` (use the pino logger with context, then rethrow or map to a typed error).

## R3 — Security invariants (the never-list)
1. **The server computes everything that grants value.** Price, plan, quota limits, entitlements, seat counts, roles, trial length, leaderboard eligibility — always derived server-side from the DB. Client-sent versions of these are display hints at best. (Nuance for D1: rep counts/form scores *are* client-computed by design — the server never uses them raised beyond the sender's own history without the §14 plausibility checks, and global leaderboards take verified entries only. v1 §14.)
2. **Tenancy on every query.** Every repo function for a tenant-owned resource takes the owner (`userId` / `gymId`) and includes it in the `WHERE`. Fetch-by-id-alone is forbidden for tenant resources — that is an IDOR. Every new route ships with a test proving a foreign user/gym gets 404/403.
3. **AuthZ separate from AuthN.** Route order: authenticate → load membership/role → check permission (Part 3 §2.2 matrix, server-side) → entitlement check → quota check (where metered) → rate limit → handler. UI hiding is never the enforcement.
4. **Webhooks:** verify signature against the **raw body** → dedupe on `webhook_events(provider, event_id)` → ack 200 → worker fetches the authoritative object from the provider API and drives the state machine. Never apply a webhook's payload as truth (RevenueCat excepted per Part 5 §0 — still deduped). Never delete `webhook_events` rows.
5. **Idempotency:** honor `Idempotency-Key` on `/v1/workouts/sync` and every payment-adjacent POST. Sync upserts on the client-generated `workoutId` (`ON CONFLICT DO NOTHING/UPDATE`) so retries are free. Every BullMQ handler must be safe to run twice — jobs *will* retry.
6. **Secrets:** never in code, never in the repo, never in logs, never in error responses, never in client bundles (`VITE_*`/`EXPO_PUBLIC_*` are public by definition). Gitleaks runs in CI and pre-commit. Every secret in the ops escrow doc (Part 8 §1) with a rotation command.
7. **Auth mechanics (port faithfully from the audited `backend-auth`):** bcrypt (cost ≥ 10) with the timing-equalizer dummy-hash on unknown emails; one-time tokens stored as SHA-256 hashes; refresh tokens type-tagged and rejected on access-token paths; JWT verify pins `algorithms: ['HS256']`; cookies `httpOnly` + `secure` + `sameSite` with Fastify `trustProxy: true` behind Caddy; strict per-route rate limits on register/login/forgot (per-IP **and** per-identifier); auth responses never distinguish "no such user" from "wrong password"; tokens never in `localStorage`.
8. **SQL:** Drizzle query builder or parameterized `sql` template values only. String-concatenated SQL, `sql.raw` with any interpolated variable, and dynamic identifiers from user input are forbidden.
9. **Uploads/media (meal photos, logos, avatars):** validate content-type by magic bytes not extension, size-cap, store in R2 under server-generated keys, serve via signed URLs/CDN — never reflect user-supplied filenames into paths or headers.
10. **Never log:** passwords, tokens, cookie values, full card/webhook payloads, raw keypoints with user identity. Log IDs and event names.

## R4 — Database & migration rules (Part 4 §1 distilled — deviations need a DEVIATION PROPOSAL)
1. `uuid` PKs (`gen_random_uuid()`), client-generated only where the spec says (workouts). `timestamptz` UTC only; org-local day math happens solely in the rollup worker using `gyms.timezone`.
2. Status columns are `text` + `CHECK (col IN (...))` — never PG enums. JSONB only for values the app treats as a document (definition, entitlements, report payload); the moment SQL filters/joins on a JSONB field, that field becomes a column.
3. Soft-state (`removed_at`, `status`) for anything with history; hard `DELETE` only in the DPDP cascade and TTL sweeps. FK default `ON DELETE RESTRICT`; `CASCADE` only where Part 4 flags it.
4. Migrations: generated by Drizzle, **reviewed as SQL by Kd**, expand-then-contract, forward-only, one per PR, CI applies them to a Neon branch. Backfills are separate batched statements, never inside the DDL migration. No down-migrations in prod.
5. Correctness-critical SQL is not improvised: the seat-claim race, one-live-subscription enforcement (partial unique index + `23505` handled as "lost the race," not a 500), workout-sync upsert, and quota bump use **Part 4 §4's canonical SQL verbatim**.
6. Repos are the only files that touch the DB (v1 §6.2). No inline queries in routes/services. Every list endpoint: cursor pagination, spec-defined ordering, tenancy in the WHERE.

## R5 — Engine rules (`packages/engine`; Part 2 §1.3 invariants made mechanical)
1. **Purity (I1):** the package imports nothing platform-specific. Banned tokens anywhere under `packages/engine/src`: `Date.now`, `new Date`, `Math.random`, `performance.now`, `setTimeout`, `setInterval`, `window`, `document`, `navigator`, `localStorage`, `fetch`, `process.env`, `console.`, `toLocale`, `Intl.`, any `node:` import. Time exists only as frame timestamps in the input. Enforced by ESLint `no-restricted-globals/imports` **and** the CI grep in the Appendix.
2. **Determinism (I2):** same frames in → same events out. Integer/enum outputs (rep counts, fault sets, FSM states) must match golden traces exactly; float outputs compare within Part 2 §7.4 tolerances. No iteration over object keys where order affects results; no locale-dependent formatting anywhere.
3. **Fail-soft (I6):** NaN, missing landmarks, low visibility, fps collapse → the defined degraded behavior (hold state, don't count, emit visibility hint). Any `throw` escaping the engine is a P0. Garbage in → **no decision**, never a wrong decision.
4. **The harness comes first.** No pipeline stage is "done" without golden traces replaying green in CI (Part 2 §7). The Python→TS port of squat/jump-squat/chair-squat goes through the §7.5 parity protocol with the §8.1 constant-preservation table filled in — every threshold accounted for, none re-derived from memory.
5. **Perf (I5):** the CI benchmark proves ≤ 3 ms p95 per frame post-inference on the mid-Android profile and flat memory across a 30-min replay. No per-frame allocations in hot loops (reuse buffers), no hidden `map/filter` chains per frame in stage code.
6. Definitions are data: never special-case an exercise in engine code. If a definition can't express something, that's a template/schema gap → SPEC GAP, not an `if (exercise === 'squat')`.
7. Versioning (I4): every emitted session carries `engineVersion` + `defsVersion`; definitions declare `minEngineVersion`; published definitions are immutable — changes create a new version through the §9 lifecycle (linter → beta → staged rollout), never an edit in place.

## R6 — Money-code rules (Part 5; graduates only through the §14 test matrix)
1. All amounts are **integer minor units** (`price_minor`, `amount_minor`) end-to-end. Floats never touch money. Proration math per Part 5 §7 with its rounding rules, covered by the 1,000-triple property test.
2. Subscription state changes go through one pure, unit-tested transition function implementing the Part 5 §3 machine. Illegal transitions (e.g., a replayed event resurrecting a refunded sub) throw + alert — they are never silently ignored or "fixed up."
3. Provider adapters are ≤ ~200 lines of mapping to the internal machine (Part 5 §4). Provider SDK types never leak past the adapter.
4. Dunning/expiry sweeps and trials use an **injectable clock**; the fake-clock test walks the full fail→nudge→recover/expire timeline. `Date.now()` directly inside billing logic is a bug.
5. Entitlement resolver output is cached but every §10 bust trigger flips it within 60s (integration-timed test). Quota middleware reads only the canonical entitlements JSON shape (Part 4 §3.3) — every key read has a default.
6. Invoice numbering: transactional per-FY counter (Part 5 §11). Refunds/disputes follow §9 exactly; nothing user-visible promises what the spec doesn't.

## R7 — API & module boundaries (v1 §6.2)
1. Module = `routes.ts` (thin) / `service.ts` (logic) / `repo.ts` (DB) / `schemas.ts` (Zod) / `events.ts`. Cross-module calls only via service interfaces or domain events — never another module's tables or repo.
2. Every request/response shape lives once, in `packages/shared` as Zod, consumed by API validation and typed clients. Adding an endpoint = schema first, then route.
3. Route checklist (all of): Zod-parse input · authn · authz/tenancy · entitlement · quota (metered) · rate limit · handler · typed error mapping. `/v1` prefix, cursor pagination on lists.
4. External API calls (Groq, vision, ORS, geocode) go through the quota gateway with an `api_cost_events` row and the fail-open(cheap)/fail-closed(expensive) policy from v1 §9.3. Cache per spec (geocode cache table).

## R8 — Errors, logging, observability
1. Typed error classes mapped centrally to HTTP responses; no stack traces or internals in client-facing errors; every 5xx captured to Sentry with request ID.
2. pino structured logs with `userId/gymId/requestId` context; no `console.log` in `apps/api` production paths.
3. Every background job logs start/finish/duration and lands failures on a dead-letter queue with alerting (Part 8 alert catalog) — silent job death is forbidden.

## R9 — Testing requirements (what "done" needs before the word is used)
1. Engine: golden traces (exact + toleranced per §7.4), the fuzz pass, the perf benchmark — all in CI.
2. API modules: service unit tests · repo tests against real Postgres (Neon branch or Testcontainers — not mocks of SQL) · route tests via `fastify.inject` covering the happy path, a validation failure, and the **cross-tenant/authz denial** case.
3. Money: the entire Part 5 §14 matrix as CI jobs against sandboxes — duplicate webhooks ×5 → one transition; out-of-order events; replay-after-refund; double-checkout race admitting exactly one; fake-clock dunning; proration property test; worker-killed-mid-burst loses nothing.
4. Migration/seed: migration applies cleanly to a fresh DB and to a copy of current staging (expand-then-contract proof); Mongo→PG script is idempotent and its verify step (counts + spot checksums) passes twice in a row.
5. A bug fix starts with a failing test that reproduces it. No regression test, no fix.

## R10 — Frontend/client rules
1. Web keeps httpOnly-cookie auth; the API client comes from `packages/shared` types; no hand-rolled `fetch` with string URLs scattered in components.
2. Retries: only idempotent requests auto-retry; POSTs retry only when carrying an `Idempotency-Key` (this exact class of bug — axios retrying non-idempotent POSTs — was found in the Bikash Das audit; do not reintroduce it).
3. Offline queue (web localStorage / mobile SQLite) stores sync payloads keyed by `workoutId`; flush order preserved; a failed flush never drops or duplicates a workout.
4. Client never renders money math it computed itself — totals/proration previews come from the API.

## R11 — Output contract (how you must present every task)
1. **PLAN first** (Part I §2), then wait for approval.
2. After coding, end with the exact verification commands for Kd to run (typecheck, lint, scoped tests, relevant greps) and **stop — wait for the pasted output**; iterate on real output only. If this chat received a pure package upload (engine/shared), install and run its tests in the sandbox yourself and paste the genuine output. Describing expected results as if they were observed is an automatic rejection.
3. End every task with: (a) the self-audit table `| Rule | Pass/Fail/N-A | Evidence |` for R0–R10, (b) the universal DoD checklist below, (c) `DEVIATION/SPEC GAP: none` or the list.
4. Full file contents for new/small files; unified diffs for surgical edits to large files; never "…rest unchanged" inside a code block you expect to be applied.

**Universal DoD checklist (every task):**
```
[ ] typecheck clean        [ ] lint clean            [ ] scoped tests green (output pasted)
[ ] new routes: schema + authz/tenant-denial test    [ ] no banned tokens (grep clean)
[ ] migrations reviewed as SQL (if any)              [ ] no new deps (or approved)
[ ] DECISIONS.md updated (if judgment call)          [ ] only planned files touched
```

---

# PART III — Phase task cards (the queue; one line ≈ one chat)

Format per phase: **Attach** = the only spec files to give the model · **Tier** = 🔴 tasks get the Part I §7 protocol · **Tasks** = run top to bottom, one per chat · **Done** = the spec's own gate · **Traps** = the mistakes this phase invites.

## P0 — Foundation (Week 1)
**Attach:** `00-architecture-v1.md` §4, §17–19, §22 · `04-part4-database.md` (whole) · `08-part8-ops-runbook.md` §1–2
**Tier:** 🟡, except P0.3 (the schema) 🔴.

⚠️ **Do first, before any session:** the old repo's `.env` files contain live secrets (JWT/ML_JWT secrets, Google client secret, Groq, ORS, RapidAPI, USDA keys, SMTP, Mongo URI) and they have now also traveled inside a zip. Treat every one as burned: rotate at each provider today. The new monorepo is a **fresh repo** — never copy a `.env` into it; secrets exist only in the deploy platform and your escrow doc (Part 8 §1).

1. P0.1 Scaffold monorepo per v1 §4 (pnpm workspaces + Turborepo): empty `apps/api`, `packages/engine`, `packages/shared`, `packages/config` with the R2 tsconfig + ESLint presets (including the engine restricted-import rules).
2. P0.2 CI pipeline: typecheck · lint · test · gitleaks · Drizzle migrations against a Neon branch. Red until proven green on a dummy test.
3. P0.3 Drizzle setup + migration `0001_init`: the Part 4 §3 DDL, domain by domain, reviewed as SQL. Seeds/fixtures per Part 4 §8 (plans rows exactly per Part 5 §1 price books).
4. P0.4 `apps/api` skeleton: Fastify boot with parsed env config, pino, Sentry, `/health`, trustProxy, CORS for the web origin with credentials, global rate limit; deploy staging on merge (Hetzner compose per v1 §19/Part 8 §2).
5. P0.5 PostHog server-side init + `DECISIONS.md`, `RUNBOOK/`, `INCIDENTS.md` files created.

**Done (v1 §22):** CI green · staging deploys on merge · `/health` up. **Traps:** review generated SQL against Part 4 line-by-line (pdftotext wrapped some DDL — Part IV trap #1) · `citext`/`pgcrypto`/`vector` extensions in migration 0001 · don't let the model "improve" the schema (R0) · partial unique index `subs_one_live_uq` must be in the SQL, not just Drizzle's mind.

## P1 — The Engine (Weeks 2–4, keystone)
**Attach:** `01-part2-form-engine-eds.md` (whole — it's self-contained) · `00-architecture-v1.md` §5 · old repo files only when the card names them.
**Tier:** 🔴 throughout; only P1.10 (the web swap) is 🟡.

1. P1.1 `packages/shared`: PoseFrame, session I/O, event, and sync-payload Zod schemas verbatim from Part 2 §2 (+ v1 §5.3).
2. P1.2 **Harness before engine** (Part 2 §7): trace JSONL format, replay runner, §7.4 assertion/tolerance layer, CI wiring, perf benchmark scaffold.
3. P1.3 Recording mode in the current web app: dev toggle writing raw PoseFrame JSONL while the *existing Python analyzer* runs → record the squat/jump/chair fixture matrix (§7.3) against it. These are the parity goldens; keep the Python service alive until P1.8 passes.
4. P1.4 Pipeline stages 1–3 (ingest/validation, smoothing + visibility gating, view classifier) per Part 2 §3.1–3.3, with unit + trace tests.
5. P1.5 Signal library v1 + calibration modules (§3.4–3.5).
6. P1.6 Rep/hold FSMs + fault-rule DSL evaluator + scorer + emission (§3.6–3.9).
7. P1.7 Definition schema + linter (§4, §9.2); load/validate a definition bundle.
8. P1.8a 🔴 Constants inventory — a chat whose ONLY deliverable is the completed §8.1 constant-preservation table from `form_analyzer.py` + the RepCounter configs: name · value · units · Python source line · target definition field. You review it against the Python file before anything else happens.
9. P1.8b 🔴 Express squat, jump-squat, chair-squat as definitions using only the approved table (re-deriving or "improving" any constant is forbidden) → §7.5 parity gate green (≥6 squat + 4 jump + 4 chair recorded sessions).
10. P1.9 Fuzz pass + perf gate (I5) green on the mid-Android replay profile.
11. P1.10 Web swap: `usePoseDetection` → local engine; offline summary queue; `POST /v1/workouts/sync` (Idempotency-Key + upsert on client `workoutId`, Part 4 §4 SQL); delete the WebSocket path.

**Done (Part 2 §10):** all invariants CI-enforced · parity green · perf gate green · fuzz green · full workout completes with the API server off, then syncs · sync payload byte-matches §2.4. **Traps:** mirroring/left-right policy (§2.2) decided once, in the adapter · no wall-clock anywhere (R5.1 grep) · rep counts exact / floats toleranced — don't "fix" a failing trace by widening tolerance (that's a DEVIATION PROPOSAL) · port constants, never re-derive them.

## P2 — One backend (Weeks 4–6)
**Attach:** `00-architecture-v1.md` §6–9, §13 · `04-part4-database.md` §3–5, §7 · `02-part2b-trust-layer.md` (for coach/nutrition/predictions ports) · old backend file(s) per card.
**Tier:** 🟡, except P2.7–P2.8 (migration & cutover) 🔴.

1. P2.1 Auth module: port the audited `backend-auth` semantics into Fastify (R3.7 checklist is the porting spec). Existing bcrypt hashes must keep verifying — write a test with a real legacy hash.
2. P2.2 Users + profile module; exercises/catalog read APIs (serving definition bundles per Part 2 §9.3).
3. P2.3 Workouts module (sync endpoint from P1.10 lands here) + progress + gamification ports.
4. P2.4 Entitlement resolver + quota middleware: plans/entitlements JSON (Part 4 §3.3 canonical shape), Redis counters, fail-open-cheap/fail-closed-expensive (v1 §9.3), per-route wiring.
5. P2.5 Coach port: Groq behind the quota gateway with `api_cost_events`; Chroma → pgvector (Part 4 §3.7), re-ingest the 5 knowledge guides.
6. P2.6 Nutrition per Part 2B §3 pipeline (one vision call, portion resolver) + Part 2B display standard; geo/running read side + geocode cache.
7. P2.7 Mongo→PG migration script per Part 4 §7: ObjectId→uuid mapping table, idempotent upserts, verify step (counts + checksums) that must pass twice.
8. P2.8 Cutover: web `.env` → new API only; freeze Mongo read-only; run migration; verify; decommission both old services.

**Done (v1 §22):** web runs 100% on the new API · old services off · cost dashboard shows real numbers. **Traps:** tenancy WHERE + cross-tenant test on every new route (R3.2) · `citext` for emails, unique on it · cookie auth cross-origin needs exact `origin` + `credentials: true` + `trustProxy` (Part IV #6) · every external call metered — no bare `fetch` to Groq/ORS.

## P3 — Money & orgs (Weeks 6–8)
**Attach:** `05-part5-billing.md` (whole) · `03-part3-org-console.md` (whole) · `04-part4-database.md` §3.2–3.3, §4 · `00-architecture-v1.md` §8–11.
**Tier:** 🔴 for P3.2–P3.8 (machine, webhooks, adapters, proration, dunning); 🟡 for P3.1 and P3.9–P3.11.

1. P3.1 Migration `0002_billing` (Part 5 §0 addenda) + plans seed = §1 price books exactly.
2. P3.2 The subscription state machine as one pure transition function + exhaustive unit tests (legal, illegal, out-of-order, replay-after-refund).
3. P3.3 Webhook receiver: raw-body routes (Part IV #2) · verify · dedupe insert · ack 200 · enqueue; worker fetches authoritative object → machine. Kill-worker-mid-burst test.
4. P3.4 Razorpay adapter + checkout (consumer IN, orgs IN). P3.5 Stripe adapter + checkout (intl) — each ≤ ~200 lines of mapping (Part 5 §4).
5. P3.6 Trials + pilot codes (§6); card-less trial (`provider='none'`) → Part 3 read-only console on lapse → reactivation restores history.
6. P3.7 Proration engine (§7) + 1,000-triple property test; scheduled downgrades via `pending_plan_id`.
7. P3.8 Dunning/expiry sweeps on injectable clock + fake-clock timeline test (§8); entitlement-bust propagation ≤ 60s test (§10).
8. P3.9 Consumer paywall + billing pages (server-computed previews only, R10.4); invoices + FY counter (§11).
9. P3.10 Org onboarding wizard (Part 3 §4.0), join codes, **seat claim via Part 4 §4 SQL verbatim** + concurrent-race test, staff roles per §2.2 matrix.
10. P3.11 Console slice 1 per Part 3 §8: Overview, Members, Billing, banner state machine, rollup job → `org_daily_stats`; monthly report job + at-risk list.

**Done:** the entire Part 5 §14 matrix green in CI · a stranger can pay in INR and USD · a gym self-serves trial→pay with members joining by code · any subscription's life narratable from `audit_log` alone. **Traps:** raw body or every signature fails (Part IV #2) · integer paise/cents only · `23505` on one-live-sub = lost race, return the winner · console widgets read rollups, never raw workout tables (Part 3 §3.2).

## P4 — Exercise production line (Weeks 8–10 → ongoing)
**Attach:** `01-part2-form-engine-eds.md` §5–6, §9–10 · `07-part7-retention.md` (for leaderboards/share cards/TV mode cards).
**Tier:** 🟡 — volume work; the harness you already built is what keeps it safe.

1. P4.1→ Family templates in Part 2 §5 order; then per exercise: parameterize (§6 mapping) → record §7.3 fixture matrix → linter → CI green → publish `beta` → one telemetry-clean week (§9.4) → staged GA (§9.3). Cadence 2–3/week; **12 solid before pitching** (v1 §22).
2. P4.x Leaderboards (Redis ZSET + snapshots, verified-only global per v1 §14), Form Score™ (Part 7 §2), share cards, TV mode.
3. P4.y Server plausibility validation on sync (v1 §14.1: cadence bounds from the definition's `minRepMs/maxRepMs`, duration math, score distributions) → flag `unverified`, **never** a user-facing rejection; sampled trace audit worker (§14.2) replaying the server's copy of the same engine.

**Done (Part 2 §10):** 12 exercises live via remote bundle, none hand-coded; per-exercise DoD boxes all ticked. **Traps:** published definitions are immutable (R5.7) · engine code gains zero exercise names · anti-cheat flags are silent metadata.

## P5 — Mobile (Weeks 10–14)
**Attach:** `06-part6-mobile.md` (whole) · Part 5 §4.3 (RevenueCat).
**Tier:** 🔴 for the spike, offline sync, and RevenueCat; 🟡 for screens.
Order is Part 6 §14; the **§3.2 spike runs first and is a hard gate** — no screens until a mid-range Android sustains the pass criteria. Then: dev-client, shared-package screens, SQLite offline mirror + delivery engine (§4), running feature with the §5.1 permission flow (Play-rejection-proof), RevenueCat (webhook = truth-feed exception, still deduped), push, EAS trains (§11), store/privacy labels (§12).
**Done (v1 §22):** full offline workout on a mid-Android ≥20 fps, syncing later; a real route recorded. **Traps:** engine runs on Hermes untouched only if R5.1 held · per-frame JS-bridge budget (§3.4) · background-location copy exactly per §5.1 · in chat, the model delivers the spike harness and measurement script — the ≥20 fps pass/fail number comes from you running it on a real device; a model-estimated frame rate is not a result.

## P6 — Pilots & ops (ongoing)
**Attach:** `08-part8-ops-runbook.md` (whole) · `07-part7-retention.md`.
**Tier:** 🟡.
Ops CLI (`ops deploy/rollback/flag/drill/breakglass`), alert catalog wired, backup **restore drill actually performed** and logged, launch checklist, 2–3 Jorhat gyms on pilot codes, watch Part 2 §9.4 + Part 3 activation metrics, keep the exercise line running toward 58.

---

# PART IV — Stack-specific trap list (each of these ships a production bug if ignored)

1. **pdftotext wrapping.** The spec files have hard line-wraps; a few DDL lines and table cells wrapped mid-token (e.g., plan codes). When implementing DDL, prices, thresholds: reconstruct carefully; if any value is ambiguous, R0.5 — ask, don't guess.
2. **Fastify webhook raw body.** Fastify consumes the JSON body before your handler; Razorpay HMAC and `stripe.webhooks.constructEvent` need the **raw bytes**. Register `fastify-raw-body` (or a scoped content-type parser) on the webhook routes only, verify against `request.rawBody`, and add a test that a re-serialized (key-reordered) payload **fails** verification — that test catches the classic parse-then-stringify mistake forever.
3. **BullMQ:** enqueue **after** the DB transaction commits (or via an outbox) — a job referencing a row that rolled back is a ghost; handlers idempotent (R3.5); deterministic `jobId` where a duplicate enqueue must collapse; QueueScheduler/worker settings for retries + DLQ; never `JSON.parse` job data without a Zod schema.
4. **Drizzle:** the `sql` template is safe only with interpolated *values* — `sql.raw(userInput)` or template-built identifiers are injection; transactions don't auto-retry serialization failures — the seat race and double-checkout paths must catch `40001/23505` and resolve per Part 4 §4; always review generated migration SQL (it will happily emit a table rewrite).
5. **Zod:** `z.coerce` on query params, else every `?limit=10` is a string; `.strict()` on request bodies so unknown keys are rejected, not silently carried; `safeParse` external/provider responses and treat failure as an integration error, not a crash; infer types from schemas — never hand-write a duplicate interface.
6. **Cookies cross-origin:** web on Vercel + API on Hetzner ⇒ `secure` cookies require `trustProxy: true` behind Caddy; CORS must list the exact origin with `credentials: true` (`*` silently breaks cookies); `sameSite` needs an explicit decision for the cross-site XHR case — flag it as a SPEC GAP the first time, decide once, record in DECISIONS.md.
7. **Float determinism vs. golden traces.** JS arithmetic (+ − × ÷ √) is IEEE-754-identical across platforms, but `Math.atan2/acos/pow` may differ by ULPs between engines. Hence Part 2 §7.4: integers/enums exact, floats toleranced. Never chase bit-equality by sprinkling `toFixed` (locale/rounding traps); never widen a tolerance to make a red trace green.
8. **Timezones.** DB is UTC `timestamptz`; "today" for a gym exists only in the rollup worker via `gyms.timezone`; streaks/day-boundaries computed anywhere else (server local time, client `new Date()`) will corrupt streaks for every non-UTC user — which is all of them.
9. **Mongo→PG:** ObjectId→uuid via a mapping table so FKs stay consistent across runs; migrate in FK dependency order; idempotent upserts on natural keys; Mongo read-only during cutover; the verify step is part of the script, not a manual afterthought.
10. **pnpm/Turborepo:** `workspace:*` for internal deps; engine's package.json declares browser/RN-safe entry points and **zero** runtime deps; Turborepo pipeline caches typecheck/test per package — engine tests must not read files outside the package or the cache lies.
11. **Old-code porting:** `bcryptjs` hashes verify fine under `bcrypt` (same format) — but prove it with a fixture test; keep the timing-equalizer and hashed one-time-token behaviors (they were deliberate fixes, comments explain why — read them before porting).
12. **LLM/vision responses are external input** (R2.3): Groq/coach and meal-photo outputs get Zod-parsed with a defined fallback; a malformed model response must degrade the feature, never 500 the route or store garbage macros.

---

# PART V — Copy-paste prompt templates

**T1 · Task kickoff (plan only)**
```
Read the OPUS-IMPLEMENTATION-PLAYBOOK (uploaded / in Project knowledge) fully — its rules are binding.
Task <P2.4>: <one line from the task card>.
Binding spec: the uploaded <spec files> §<numbers>. Current source files uploaded: <files or "none">.
Output a PLAN only (files to create/modify, functions, tests incl. the authz/tenant-denial case,
migrations, risks, SPEC GAP questions). Do not write implementation code yet.
```

**T2 · Implement (after plan approval)**
```
Plan approved [with changes: <...>]. Implement exactly it — only the listed files, full contents.
Then STOP and give me the exact commands to run (typecheck, lint, scoped tests, plus the
banned-token grep if engine code changed). I will paste the output; fix and re-issue until green.
If I uploaded the package itself, run its tests in your sandbox and paste genuine output.
Finish with the R0–R10 self-audit table, the universal DoD checklist,
"DEVIATION/SPEC GAP: none" or the list, and the HANDOFF block (Part I §4).
```

**T3 · Independent review (run in a FRESH chat on the diff — mandatory for 🔴 tasks)**
```
You are reviewing, not fixing. Audit this diff strictly against CLAUDE.md Part II R0–R11
and spec §<x>. Output only: (1) violations as rule# · file:line · one-line fix;
(2) a security pass — authn/authz/tenancy, input parsing, idempotency, secrets/log leaks,
SQL safety; (3) anything that would fail the phase's Done gate. No praise, no restating the diff.
```

**T4 · Parity port (engine, P1.8)**
```
Port <function> from <old file> into <definition/template> per Part 2 §8.
Fill the §8.1 constant-preservation row for EVERY numeric threshold: old name · value ·
new location · source comment. Re-deriving or "improving" a constant is forbidden.
Then run the parity traces (§7.5) and paste the runner output.
```

**T5 · Migration**
```
Write migration <000N_name> implementing exactly Part 4 §<x> [+ Part 5 §0 addenda].
Show me the generated SQL for review BEFORE anything else. Expand-then-contract; forward-only;
backfills as separate batched statements; call out any lock or table-rewrite risk.
```

**T6 · Bug fix**
```
Bug: <exact repro + expected vs actual>. Step 1: write a failing test that reproduces it and give
me the run command — I'll paste the failure to confirm. Step 2: the minimal fix. Step 3: I re-run
the scoped suite and paste it green. No drive-by changes.
```

---

# PART VI — Kd's 5-minute review (before any merge)

1. Diff touches only the planned files? Any new dependency? (reject unless pre-approved)
2. Run the Appendix red-flag greps yourself — 30 seconds.
3. Test output in the response is real terminal output, and `pnpm -w typecheck && pnpm --filter <pkg> test` passes **on your machine** for money/auth/engine changes.
4. New route → does its test file contain the cross-tenant denial case? Open it and look.
5. Migration in the PR → read the SQL top to bottom against Part 4. One migration only.
6. Money diff → search it for `number`-typed amounts doing division, any `Date.now`, any webhook handler reading `request.body` instead of raw body.
7. Self-audit table present and honest? A "Pass" you can't verify in the diff is a "Fail."
8. DECISIONS.md updated if anything was decided beyond the spec.

# APPENDIX — Verification commands (you run these locally; the model requests them and reads your pasted output)

```bash
# Standard gate (every task)
pnpm -w typecheck && pnpm -w lint && pnpm -w test

# Engine purity/determinism (must print nothing)
grep -rnE 'Date\.now|new Date\(|Math\.random|performance\.now|setTimeout|setInterval|process\.env|window\.|document\.|navigator\.|localStorage|fetch\(|console\.|toLocale|Intl\.' packages/engine/src

# Repo-wide red flags (review every hit)
grep -rnE ': any\b|as any|@ts-ignore|catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}' apps packages --include='*.ts' --include='*.tsx'
grep -rnE 'sql\.raw\(' apps/api/src

# Secrets
gitleaks detect --no-banner

# Engine golden traces + perf gate
pnpm --filter @app/engine test:traces && pnpm --filter @app/engine bench

# Money suite (Phase 3+)
pnpm --filter api test:billing
```

*End of playbook. When the spec and this document disagree, the spec wins — raise it, don't route around it.*
