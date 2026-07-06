<!--
Part 8 — Ops Runbook (solo-operator)
Extracted from aihomegym.pdf (pdftotext). Hard line-wraps and occasional
table/DDL wrapping are extraction artifacts, not content changes. When an
exact value (price, threshold, SQL) looks garbled, verify against the PDF.
This file is spec — BINDING. Do not modify; record deviations in DECISIONS.md.
-->

# Part 8 — Ops Runbook (Solo-Operator Edition)

**Prerequisites:** v1 §17–§20 (observability, deploy, scale triggers) ·
Part 2 §9.3–9.4 (definition rollout/telemetry) · Part 4 (migration
discipline, sweeps, drill mandate) · Part 5 (money alerts, sweeps) · Part
6 §11 (mobile release trains).
**Scope:** deploy procedures for all four release surfaces · the alert
catalog with thresholds and first actions · backup/restore drills ·
incident playbooks and break-glass commands · the routine ops calendar ·
security & cost ops · the launch checklist that ties Parts 1–8 together.

## 0. Doctrine for a team of one

1. **You are not on call — your defaults are.** You will be asleep, in a
gym demo, or on a bus to Guwahati when things break. Therefore: every
failure mode degrades to a *safe standing state* without you (quotas
fail-open/closed by design, `past_due` grants, sync retries forever, pose
runs on-device regardless of any server fire). The alert's job is to
summon you to *restore*, never to *prevent harm* — harm prevention that
requires a human awake is a design bug, and the earlier parts were written
so there are none.
2. **One command per emergency, rehearsed before it's needed.** Everything
below is a subcommand of a thin `infra/ops` CLI (wrapper scripts, nothing
clever): `ops deploy`, `ops rollback`, `ops flag`, `ops drill`, `ops
breakglass …`. If a procedure isn't a command, it's a blog post — and you
don't read blog posts at 2 a.m.
3. **Boring on purpose.** No infra change lands the same week as a product
launch; no Friday-evening deploys; no clever migrations. The runbook's KPI
is how rarely it's interesting.
4. **Write-downs beat memory:** five living files, referenced throughout —
`RUNBOOK/` (one page per alert/playbook), `INCIDENTS.md`, `DRILL_LOG.md`,
`DECISIONS.md`, `CHANGELOG-OPS.md`. Standing rule: any prod change that
would surprise future-you gets one line in `DECISIONS.md` the same day.

## 1. Topology & the "if my laptop dies" inventory

| Piece | Where | Access recovery |
|---|---|---|
| API + worker + Caddy | Hetzner VPS (Docker Compose, `infra/`) | Hetzner
account (2FA + recovery codes in escrow); rebuildable from repo (§4.4 game
day proves it) |
| Postgres | Neon (prod + `staging` branch) | Neon 2FA; PITR + our dumps |
| Redis | Upstash | rebuildable by design (v1 §7.2; §5.3 playbook) |
| Web + console | Vercel | instant rollback built-in |
| Objects/CDN | Cloudflare R2 | bucket versioning on |
| Mobile | EAS + Play + App Store | Part 6 §11 |
| Repo/CI | GitHub (Actions) | hardware-key 2FA |
| Money | Razorpay, Stripe, RevenueCat | 2FA everywhere; webhook secrets
per env |
| Alerting | Better Stack (uptime/status) + Telegram bot |
phone-independent email fallback |

**Escrow doc** (encrypted, stored twice — password manager + offline):
every vendor account, its 2FA recovery codes, every secret's name → where
used → rotation command → last-rotated date. This single document is the
difference between a lost laptop being an afternoon and being an incident.

## 2. Deploy procedures (four release surfaces, one rhythm)

**Deploy window:** 11:00–15:00 IST (gyms peak 06–09 and 17–21 IST — never
deploy into their rush), never Friday after 15:00.

### 2.1 API + worker
PR → CI gates (typecheck · unit · **golden traces** · Part 5 money suite ·
Gitleaks · build) → merge → auto-deploy **staging** → smoke suite (health,
auth round-trip, sync echo, one sandbox charge) → `ops deploy promote`
(the one manual click) → post-deploy watch: 15 min on Sentry release + 5xx
rate; the deploy isn't "done" until that window closes clean.
**Rollback:** `ops rollback api <previous-tag>` — always safe because
migrations are expand-then-contract (Part 4 §1): destructive steps
(drops/renames-away) ship only in release N+1 after N has soaked a week.
Code can therefore always step back one version against the live schema,
by construction.

### 2.2 Web/console (Vercel)
Preview per PR → promote; rollback is a dashboard click. The console is
inside `apps/web` (Part 3 §3.1), so one surface, one rhythm.

### 2.3 Mobile
Part 6 §11 verbatim: OTA weekly for JS (fingerprint runtimeVersion makes
native mismatch unshippable), native monthly, staged 10→50→100 with 24 h
Sentry gates; `ops mobile halt` toggles the rollout.

### 2.4 Definition bundles & config (the deploys that don't look like
deploys)
Exercise definitions follow Part 2 §9.3 (draft → beta soak → live;
**rollback = `ops defs rollback <bundle>`**, a repoint, seconds).
`plans.entitlements` and `feature_flags` edits are production changes:
made via admin panel only, audit-logged automatically, one line in
`CHANGELOG-OPS.md` — a mispriced plan is an outage with better manners.

## 3. Monitoring & the alert catalog

**Severities:** **P1** = Telegram + phone-call escalation, act now (money
broken, API down, backup failed, data-loss risk). **P2** = Telegram, same
day; quiet-hours (22:00–08:00 IST) P2s batch to morning. **P3** = weekly
review queue. Every alert message ends with a link to its `RUNBOOK/` page
— the alert *is* the table of contents.

| Alert | Condition | Sev | First action |
|---|---|---|---|
| API down | /health fails 2 consecutive checks | P1 | `ops status` →
VPS/Neon/Upstash triage page |
| 5xx spike | > 1 % of requests, 5 min | P1 | recent deploy? → rollback
first, diagnose second |
| Backup failed | nightly dump job non-zero / missing artifact | P1 |
rerun now; a night without a backup is not acceptable risk |
| Illegal money transition | Part 5 §3 alert fires | P1 | freeze nothing;
read audit trail; likely adapter bug |
| Webhook backlog | pending > 50 or any `failed` (Part 4 table) | P2 |
`ops queue drain webhooks`; check provider status page |
| Sync success | < 99.9 % over 1 h | P2 | Sentry group; clients retry
forever (Part 6) — no user harm, fix at leisure of hours not minutes |
| p95 latency | > 250 ms for 30 min | P2 | v1 §20 Stage-1 trigger playbook
|
| Queue age | oldest BullMQ job > 15 min | P2 | worker logs; `ops worker
restart` |
| Per-gym cost breaker | > ₹800/gym/month (v1 §9.3) | P2 | cost dashboard
→ which feature; quotas already capped the bleeding |
| Provider spend | daily > 2× 30-day median | P2 | per-feature cost
events; suspect abuse or a retry loop |
| Definition anomaly | rage-quit % or fault-rate shift post-publish (Part
2 §9.4) | P2 | `ops defs rollback`, then investigate with traces |
| Mobile crash-free | < 99.5 % on latest version | P2 | halt staged
rollout (Part 6) |
| Neon storage/conns | > 80 % | P2 | v1 §20 ladder page |
| VPS disk/CPU | > 80 % sustained | P2 | resize command in playbook (one
Hetzner CLI line + reboot) |
| Vendor quota | Groq/ORS/Resend/Upstash at 70 % of tier | P2 | raise tier
or tighten cache — decided per page |
| Rollup/report/sweep missed | expected job absent by +2 h | P2 | rerun
(all idempotent by construction — Parts 4/5/7) |

| India synthetic | TTFB from Mumbai probe > 1.5 s | P3 | weekly trend
review |
| Flagged accounts (v1 §14) | queue > 10 | P3 | weekly review ritual |

**The morning glance (one saved dashboard, 5 minutes):** uptime · last
night's backup ✓ · sync success · Sentry new issues · queue depths · MRR
& new subs · yesterday's actives · cost-vs-revenue outliers. If all green,
close the laptop — that's the point.
---

## 4. Backups & restore drills ("an untested backup is a rumor" — v1 §17,
now a procedure)

### 4.1 What is backed up, where
Neon PITR (continuous, 7–30 d window) · **nightly `pg_dump` → R2**
(encrypted, 35-day rolling + first-of-month kept 12 months) · R2 bucket
versioning (assets, reports, invoices) · repo on GitHub · secrets in the
§1 escrow · Redis **deliberately not backed up** (rebuildable by design —
§5.3 is the rebuild) · mobile artifacts live in EAS/store history.

### 4.2 The monthly drill (`ops drill restore`, ~20 min, scripted
end-to-end)
1) Restore last night's dump into a fresh Neon scratch branch. 2)
Verification script: row counts vs prod within tolerance · canary user's
workouts/meals/subscription intact · migrations apply cleanly on top ·
Part 4 §4 canonical queries return sane values. 3) One line in
`DRILL_LOG.md` (date, dump size, restore minutes, ✓/✗). A red drill is a
**P1 on the backup pipeline**, treated exactly like an outage.

### 4.3 Quarterly + annual
Quarterly: PITR drill — pick a timestamp 3 days back, branch-restore to
it, verify a known-changed row shows its old value (this is the
ransomware/fat-finger recovery path; rehearse it before you need it).
Annually: **total-loss game day** — new VPS from `infra/` scripts, restore
DB, point staging DNS, stopwatch running; target < 2 h, gaps become
`infra/` fixes the same week.

## 5. Incident response (solo edition)

### 5.1 The loop

**Detect** (alert) → **Stabilize** (break-glass command — restore a safe
state *before* diagnosis) → **Communicate** (status page + in-app banner
flag; org owners get the email template only for > 30 min money/console
impact) → **Fix** → **Postmortem-lite**: 30 blameless minutes into
`INCIDENTS.md` (timeline · impact · cause · 1–3 actions with dates). Five
incidents with skipped postmortems = the same incident five times.

### 5.2 Break-glass commands (each rehearsed once on staging — §9 requires
it)
`ops breakglass maintenance on` (writes 503 with friendly copy; reads
still served) · `ops breakglass metered off` (coach/meal/route-gen
honestly disabled; **pose, logging, sync untouched** — the on-device
architecture means your worst server day still counts every rep) · `ops
breakglass grace-extend 48h` (payment-provider outage: nobody degrades for
a failure that isn't theirs) · `ops queue pause|drain <name>` · `ops defs
rollback <bundle>` · `ops rotate <provider>` (scripted per §7) · `ops tv
revoke-all` · `ops flag <key> <value>`.

### 5.3 Playbooks (one `RUNBOOK/` page each; triggers → numbered steps)
**DB degraded/down:** Neon status → if theirs, maintenance-on + wait
(their SLO beats your heroics); if ours (conn saturation), restart pool,
check the §3 ladder. **Redis down:** by design — quotas fail-open (cheap)
/ fail-closed (metered) exactly per v1; leaderboards restore from
`leaderboard_snapshots` + resync; geo cache rewarms; document says *do
nothing but restart it*. **Payment provider outage:** webhooks queue (Part
5 doorbell doctrine), grace-extend if > 12 h, reconcile-on-recovery is
automatic (fetch-authoritative). **LLM outage:** Groq → OpenRouter
fallback is automatic (v1 §6.1); both down → honest error, **no quota
consumed** on failures (standing rule). **Bad deploy / mass sync
failures:** rollback first; clients retry forever (Part 6 §4.3) so the
queue self-heals — your job is the fix, not the data. **Leaked secret:**
`ops rotate <provider>` (exact console paths per provider in the page),
then audit-log sweep for misuse window; you have already done this once —
the runbook page is that experience, written down. **Store emergency (bad
native build):** halt rollout; JS-fixable → OTA within the hour; native →
expedited-review request template in the page. **Suspicious admin
access:** revoke-all sessions, rotate JWT secrets, audit trail review — 15
minutes, scripted.

## 6. Routine ops calendar (the whole job, time-boxed)

**Daily (5 min):** morning glance (§3) · Telegram triage. **Weekly (45
min):** Renovate dependency PRs (patch/minor auto-merged by CI policy;
majors reviewed) · Sentry to zero-or-ticketed · parked 4xx sync rejects
(Part 6 — those are *your* bugs) · flag-queue review (v1 §14) · finance
digest read (Part 5 §13). **Monthly:** restore drill (§4.2) · retention
review (Part 7 §14, 30 min) · rotate one provider's secrets (staggered so
everything rotates quarterly, and rotation stays routine, not archaeology)
· invoice/GST export to your CA · access review (the answer should be
"just me, 2FA everywhere" — verify, don't assume). **Quarterly:** PITR
drill · k6 load test: `/workouts/sync` + entitlement reads at 10× current
peak (the number goes in `DRILL_LOG.md`; regressions are Stage-trigger
evidence, v1 §20) · unit-economics snapshot (cost dashboard vs plans — the
Part 1 margins, re-verified against reality). **Annually:** game day
(§4.3) · dependency major-version window · pricing review.

## 7. Security & compliance ops
Gitleaks in CI (standing) + quarterly manual scan of infra repo · npm
audit gate: fail CI on high-severity in production deps · 2FA + recovery
codes escrowed for every vendor (§1) · rate-limit tuning is a P3 review
item, ban tooling lives in the admin panel with audit-logging · **DPDP
ops:** deletion/export are automated (Part 4 §5.2) — the ops job is
monitoring the day-14 job and a monthly count in the compliance note;
breach response outline: assess → contain (rotate/revoke) → document
timeline → notify per DPDP obligations — *confirm notification thresholds
and timelines with a lawyer once, write the answer into this page* ·
clinic-copy linter (Part 3 §2.2) runs in CI — positioning compliance is a
build gate, not a memo.

## 8. Cost & capacity ops
The margin lives on one screen (v1 §9.3 cost dashboard + Part 5 MRR view,
side by side — already specced; this section just says *look at it
weekly*). Capacity is not a judgment call: the §3 alerts **are** v1 §20's
triggers, each mapped to a pre-planned action page (resize VPS → one
command; Stage 1 second API node → the LB page written now, executed
later; read replica → Stage 2 page). You never decide architecture during
an incident — you executed a decision made in daylight.

## 9. The launch checklist (Parts 1–8, tied off)

**Gates (all must be green):** ☐ P1 acceptance per part — v1 §22 phase
criteria · Part 2 engine DoD + parity traces · Part 3 Slice A · Part 4 §9
(incl. the zero-PII deletion scan) · Part 5 §14 money matrix · Part 6
acceptance (incl. Play background-location pack) · Part 7 v1-core set. ☐
**Security pass:** all secrets rotated post-audit (the v1 §18 + Part 2 §0
lists), Gitleaks clean, headers scan, admin 2FA. ☐ **Legal/copy:**
privacy policy (on-device + never-stored-photos claims verbatim true) ·
ToS · org agreement with the fair-use quota table (v1 §9.2) · clinic terms
boundary (2B §7) · health disclaimer everywhere Part 6 §12 says. ☐ **Ops
live:** every P1/P2 alert **test-fired once** (an alert that never fired
is a rumor, same as backups) · drill ✓ in `DRILL_LOG.md` · break-glass
rehearsed on staging · status page up · escrow doc current. ☐ **Business
ready:** pilot gym on `preview` with real members · support channel (email
+ WhatsApp Business number) with a canned-answers doc · Part 5 external
items closed (CA, store programs, Razorpay KYC) · dashboards saved · the
five living files created with their first entries.
**Launch day:** deploy freeze from T-1 15:00 IST · morning glance × 3
(08:00/13:00/19:00) · rollback criteria pre-agreed in writing (5xx > 1 %
or crash-free < 99 % ⇒ roll back, no debate) · one person (you) watching,
everything else automated — which is the whole design.
**Week 1:** glance twice daily · error budgets reviewed Friday ·
first-cohort funnel (signup → first workout → D7) against Part 7 §1
targets · first `RETENTION_LOG.md` entry.

## 10. The document map (the series, closed)

**Specs (immutable, amended forward):** Part 1 Architecture v1 → Part 2
Engine/EDS + 2B Trust Layer → Part 3 Org Console → Part 4 Database &
Migration → Part 5 Billing → Part 6 Mobile → Part 7 Retention → Part 8
Ops. Amendments always travel forward (Part 3 §0, Part 4 §0, Part 6 §0
pattern) — never edit an earlier part; supersede it and cite. **Living
files:** `RUNBOOK/*` · `INCIDENTS.md` · `DRILL_LOG.md` ·
`RETENTION_LOG.md` · `DECISIONS.md` · `CHANGELOG-OPS.md` · the encrypted
escrow.
**Acceptance for Part 8 itself:** the `ops` CLI exists with every §2/§5.2
subcommand · each alert fired once on purpose · one restore drill logged ·
break-glass rehearsal logged · game day on the calendar.

**What to do first, tomorrow morning:** the standing items with lead times
— secrets rotation if any remain, Apple/Google program enrollments,

Razorpay KYC, the CA session, the ₹11k test phone — then v1 §22 **Phase 0,
week 1.** Everything after that is written down.

*— End of Part 8, and of the specification series. Build order: v1 §22. —*
