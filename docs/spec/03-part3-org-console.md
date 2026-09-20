<!--
Part 3 — Organization Console (gyms/studios/clinics)
Extracted from aihomegym.pdf (pdftotext). Hard line-wraps and occasional
table/DDL wrapping are extraction artifacts, not content changes. When an
exact value (price, threshold, SQL) looks garbled, verify against the PDF.
This file is spec — BINDING. Do not modify; record deviations in DECISIONS.md.
-->

# Part 3 — The Organization Console (Gyms · Studios/PT · Physio Clinics):
Full Specification

**Prerequisites:** Architecture v1 (§8 tenancy, §9 plans, §11 sketch) ·
Part 2 (SetSummary contract §2.4, T1/T2/T3 tiers, message-key i18n) · Part
2B (display standard §6, org segments & clinic positioning §7).
**Scope:** the owner/staff-facing web console for every organization type,
screen by screen — every widget's data contract, every query it reads,
every empty/edge state — plus the org-type deltas and the build slices.
The **member-facing** app is out of scope except where the console creates
obligations in it (visibility disclosure, leaderboard opt-out, join flow).

## 0. Amendments to Architecture v1 (recorded here so the document set
stays consistent)

1. **Secrets addendum (Part 2 §0):** beyond v1 §18's list, rotate
`VITE_LOCATIONIQ_KEY` (shipped inside the public JS bundle — readable by
anyone today), `RAPIDAPI_KEY`, `USDA_API_KEY`. Geocoding moves behind the
server `geo` module as already planned.
2. **Meal photos are never persisted** (Part 2B §3 supersedes v1 §7.3's
`meal-photos/` R2 bucket): analysis is in-memory, one vision call, photo
discarded. Delete that bucket from the infra plan; the privacy line
"photos are analyzed, never stored" appears in the scan UI and in every
org-facing privacy sheet — it matters double for clinics.
3. **"Gym Dashboard" → "Organization Console."** Four segments (new gyms,
premium-aspiring gyms, boutique/PT studios, physio clinics) resolve to
**three product org types** — `gym` (both gym segments; "premium-aspiring"
is a *pitch*, not a product fork), `studio` (boutique/PT), `clinic` —
implemented per Part 2B §7 as vocabulary + feature-matrix overrides on v1
§8's tenancy. No new architecture.

---

## 1. Personas & jobs-to-be-done (what each screen must answer in one
glance)

| Persona | Role | The question they open the console with | The number
that decides renewal |
|---|---|---|---|
| Gym owner (Jorhat-tier, 60–300 members) | `owner` | "Are my members
actually using this, and is it keeping them from quitting?" | **Adoption
%** + at-risk saves |
| Gym manager / front desk | `manager` | "Get this walk-in signed up in 30
seconds" | time-to-join |
| Trainer / Coach | `trainer` | "Who needs my attention today, and is
their form improving?" | member form-score trend |
| Studio / PT owner (10–40 clients) | `owner` | "Which of *my* clients
trained this week, on the plan I gave them?" | per-client adherence |
| Clinic clinician (Phase 2) | `trainer` (vocab: *Clinician*) | "Did my
client do their assigned home exercises, safely?" | **adherence %** per
client |
| Kd (internal) | `admin` | — lives on the separate admin panel (v1 §6.1,
Part 2 §9.4), **not** in this console | — |

Design law derived from these: the console is a **retention instrument the
org uses on its members**, not an analytics toy. Every screen ends in an
action (nudge, print, invite, upgrade) — data that doesn't lead to an
action is decoration and gets cut.

---

## 2. Org model, roles, vocabulary & feature matrix

### 2.1 Additions to the v1 §8 schema (columns only; DDL lands in Part 4)

`gyms` (table keeps its name; it's the *org* table) gains: `org_type
('gym'|'studio'|'clinic')`, `timezone` (IANA, set at onboarding, default
from browser), `locale`, `currency_display`, `owner_included_as_member
bool default true`, `activation jsonb` (checklist state, §5.1).
`gym_members` gains `removed_at timestamptz null` — membership is a
**validity interval** `[joined_at, removed_at)`; every org rollup counts a
workout iff the user was a member **on the workout's date** (this one rule
kills a whole class of "my numbers changed" bugs: history never
re-attributes when people join or leave). `gym_codes` gains `label` (v1:
one code; now multiple named codes per org — "Front Desk", "Morning
Batch", "Dr. Sen's clients" — each is a **group tag** on the memberships
it creates; this is the entire mechanism behind studio cohorts and clinic
caseloads, at the cost of one column).

### 2.2 Roles & permissions matrix (enforced server-side per route; UI
merely hides)

| Capability | owner | manager | trainer |
|---|---|---|---|
| Overview, Leaderboard, Reports (view) | ✔ | ✔ | ✔ |
| Members list + detail | ✔ | ✔ | **assigned/group only** (gym: all) |
| Invite (share code / print poster) | ✔ | ✔ | ✔ |
| Remove / restore member | ✔ | ✔ | — |
| Create / rotate / expire codes | ✔ | ✔ | — |
| Send "we miss you" nudge | ✔ | ✔ | ✔ (own members) |
| Billing (view, upgrade, payment method, cancel) | ✔ | — | — |
| Staff management | ✔ | — | — |
| Settings (profile, logo, vocabulary, privacy) | ✔ | ✔ (no privacy) | —
|

| TV-mode token create/revoke | ✔ | ✔ | — |
| CSV export (members, activity) | ✔ | ✔ | — |

Vocabulary overrides (Part 2B §7), applied by org_type through the same
message-key system as the member app — zero forked screens: `gym`: Members
/ Workouts / Trainer · `studio`: Clients / Sessions / Coach · `clinic`:
Clients / Sessions / Clinician. Copy rules for clinic strings are
**linted** exactly like Part 2's definition linter: the words "rehab",
"treatment", "therapy", "diagnosis", "recovery %" are build failures in
clinic-visible keys. Adherence and activity — nothing clinical, ever.

### 2.3 Feature matrix by org type

| Feature | gym | studio | clinic |
|---|---|---|---|
| Leaderboard + TV mode + poster | ✔ default on | ✔ (per-group boards) |
**off by default** (patients ranking each other is harm, not motivation;
owner may enable for wellness programs) |
| Challenges (v1.1) | ✔ | ✔ | off |
| At-risk list | ✔ | ✔ | ✔ (renamed "Inactive clients") |
| Groups (named codes) | optional | **core** | **core** (caseloads) |
| Trainer scoping to group | optional | ✔ | ✔ |
| Program/plan assignment surfacing | v1.5 | v1.5 core | Phase 2 core |
| Adherence report per client | — | v1.5 | Phase 2 core |
| Monthly org report PDF | ✔ | ✔ | ✔ (adherence framing) |

### 2.4 The org-visibility boundary (a promise, not a setting)

Organizations see, for their members and only during the membership
interval: **workout activity** (dates, exercises, sets/reps/hold time,
duration), **form scores & fault categories** (from `SetSummary` —
aggregates and per-set values), **streaks and challenge participation**.
Organizations **never** see: meal logs or nutrition anything, body
weight/measurements, AI-coach conversations, run GPS routes, or activity
from before joining / after leaving. This boundary is (a) enforced in the
`reports`/`gyms` repos (queries physically cannot join those tables for
org callers), (b) disclosed to the member at join time — the join screen
shows a "What {org} can see" sheet with exactly this list — and (c)
restated in Settings → Privacy on both sides. For clinics this disclosure
doubles as the consent record (DPDP/GDPR): joining a clinic code =

explicit consent checkbox, timestamped in `gym_members.consent_at`. This
is the Trust Layer's doctrine applied to B2B: the org console is powerful
*because* its limits are legible.

---

## 3. Information architecture & data contracts

### 3.1 Navigation

Responsive web app (owners live on phones; **no native console app**).
Left rail (desktop) / bottom tabs (mobile): **Overview · Members ·
Leaderboard · Reports · Billing · Settings** (+ **Staff** under Settings;
+ **Groups** surfaced as a filter everywhere rather than a screen). A
persistent trial/renewal banner slot sits above all screens (§4.2). URL
scheme `/console/:orgSlug/...` — the console is a separate route group in
`apps/web` (v1 §4's `apps/dashboard` folds into `apps/web` as a route
group; one deploy, shared auth, less infra — recorded as the
implementation choice).

### 3.2 The rollup layer (every widget reads these; nothing queries raw
tables ad hoc)

| Source | What | Refresh | Notes |
|---|---|---|---|
| `org_daily_stats` (table, worker-built) | per org × day:
`active_members, workouts, sets, total_reps, minutes, avg_form_score,
new_members, removed_members` | nightly at 02:00 **org TZ** +
rebuild-on-demand (admin) | day boundaries in `gyms.timezone`;
membership-interval rule §2.1 applied here, once |
| `org_live_counters` (Redis, 5-min TTL) | today's workouts, actives-today
| on read, cached 5 min | powers "today" tiles without touching PG per
view |
| `lb:org:{id}:{yyyymm}:{board}` (Redis ZSET, v1 §7.2) | leaderboard
standings | updated at each workout sync | boards: `formscore` (avg, min 8
scored sets in month), `workouts`, `streak` |
| `org_member_stats` (view) | per member: last_active_at, workouts_7d/30d,
avg_form_30d, joined_at, group | live view over indexed columns | Members
table + detail drawer |

| `at_risk` (query over the above) | §4.3 definition | computed on page
load, cached 1 h | capped list, ordered by value |

**Definitions (canonical — reports, tiles, and sales decks must all match
these):**
- **Active member (Nd):** ≥ 1 synced workout in the last N days (org TZ),
while a member.
- **Adoption %:** active_30d ÷ current members. **Utilization %:** current
members ÷ seat cap. (Two different numbers; the Overview shows adoption,
Billing shows utilization — never blur them.)
- **At-risk:** current member · joined > 14 days ago · had ≥ 1 workout in
their first 21 days or in the prior 30-day window · **0 workouts in the
last 14 days**. Sorted by lifetime workouts desc (save the most invested
first), capped at 20.
- **Avg form score:** mean of `SetSummary.avgFormScore` over scored sets
in window; displayed as an integer per Part 2B §6; suppressed (—) below 5
scored sets.

### 3.3 Console API surface (consumed only by these screens; feeds Part
4/5)

`GET /v1/orgs/:id/overview` (tiles + 8-wk series + at-risk) · `GET
/members?query&group&sort&cursor` · `GET/POST /members/:uid/nudge` ·
`DELETE /members/:uid` (soft: sets `removed_at`) · `GET
/leaderboard?board&month` · `POST /tv-token` / `DELETE /tv-token/:id` ·
`GET /reports` / `POST /reports/generate` · `GET /billing` (+ Part 5
endpoints) · `GET/PATCH /settings` · `GET/POST/PATCH /codes` ·
`GET/POST/DELETE /staff` · `GET /export/members.csv`. All org-scoped
routes pass the RBAC middleware (§2.2) and are rate-limited per user;
every mutating call writes `audit_log`.
---

## 4. Screen-by-screen specification

Format per screen: **Purpose → Zones/Widgets (with data contract &
refresh) → Actions → States (loading/empty/error/edge) → Events emitted.**
Loading state is skeletons everywhere (never spinners-over-blank); every
error state has a retry and never dead-ends.

### 4.0 Onboarding wizard (first-run; also the self-serve trial start)

**Purpose:** stranger → org on trial with a printed poster in **≤ 5
minutes**. The metric that predicts everything downstream is **TTFMJ —
time to first member joined** (instrumented start-to-join).

Steps (each skippable except 1–2; progress persisted per step so
abandonment resumes):
1. **Org basics** — name, city, `org_type` picker (three cards with
one-line descriptions; picking `clinic` shows the positioning line from
Part 2B §7 verbatim and the consent implications), timezone (prefilled),
locale.
2. **Size & plan** — member-count slider → recommended seat tier (v1 §9.2
tiers; `studio`/`clinic` see the **Micro tier, ≤ 25 seats** — price
proposed at ₹999/mo gym-studio / ₹1,499 clinic, **final numbers ratified
in Part 5**) → **Start 7-day free trial** (no card required;
`plans.trial_days`; pilot codes redeemable here extend `trial_ends_at` per
v1 §9.2).
3. **Branding** — logo upload (PNG/JPG ≤ 2 MB → R2 `gym-assets/`,
server-resized to 512px; shown live on a member-app preview so the owner
*sees* the white-labeling immediately).
4. **First join code** — auto-created (`label:"Front Desk"`, human-safe
6-char alphabet, no 0/O/1/I); **QR poster PDF** generated inline (worker
job, ≤ 10 s, §4.5) with a big **Print** button and a **WhatsApp share**
button (poster + code as an image — this is how Assam actually distributes
it).
5. **Add your team** — invite manager/trainer by email/phone (skippable).
6. **Done** → Overview, with the **Activation checklist** pinned (§5.1)
and, if `owner_included_as_member`, the owner silently joined as member #1
(complimentary, not seat-counted) — so the demo works on their own phone
in the parking lot.

States: resume-on-return · logo upload failure → keep going, checklist
carries it · code collision → regenerate silently. Events:
`org_created{type}`, `org_trial_started`, `org_logo_added`,
`org_poster_downloaded`, `TTFMJ` timer start.

### 4.1 Overview

**Purpose:** the renewal argument, self-served daily. One screen: are
members using it, is it trending right, who needs saving.

| Zone | Widget | Data (source · refresh) | Notes / states |
|---|---|---|---|
| Banner | Trial / renewal / payment state | `subscriptions` · live | §4.2
state table |
| KPI row | **Active members (30d)** with 7d sub-stat · **Workouts this
week** · **Adoption %** · **Avg form score** | tiles: `org_daily_stats` +
`org_live_counters` · nightly + 5-min | each tile shows Δ vs previous
period (▲▼, org TZ weeks); form tile suppressed < 5 scored sets; adoption
tile tap → Members filtered to inactive |
| Chart | 8-week trend — workouts (bars) + active members (line) |
`org_daily_stats` rolled to weeks · nightly | empty (< 1 wk data):
friendly "first week collecting" state with the checklist beside it |
| List | **At-risk members** (top 5 of the §3.2 query, "Inactive clients"
for clinic) | cached 1 h | row = name · last active · lifetime workouts ·
**[Send nudge]** one-tap (push via member app: "Your gym misses you    💪—
{org}"; rate-limit 1/member/7d; trainer sees own group only). Empty:
"Nobody's slipping — nice." Error: retry chip |
| Side | Activation checklist (until complete, §5.1) · This month's report
shortcut | `gyms.activation` | disappears forever once done |

Events: `console_overview_viewed`, `at_risk_nudged`, tile taps. **Edge:**
org with 0 members ever → Overview *is* the checklist + poster CTA (no sad
empty charts).

### 4.2 Banner state machine (persistent slot, all screens)

| State | Condition | Copy & CTA |
|---|---|---|
| Trial info | trial, > 3 days left | "Trial — X days left · **Add
payment**" (dismissible/day) |
| Trial urgent | ≤ 3 days | amber, not dismissible: "Trial ends {date}.
Members keep Pro features only if a plan is active. **Choose plan**" |
| Trial expired → grace | 0–14 days past, unpaid | red: "Trial ended —
members have moved to the free tier. Reactivate to restore.
**Reactivate**" — console goes **read-only** except Billing |
| Past-due | payment failed | v1 §10 dunning (5-day grace): "Payment
failed — retrying. **Update payment method**" |
| Seat pressure | members ≥ 90 % of cap | "87/100 seats — **Upgrade
tier**" (the cost-ceiling-as-upsell mechanism, v1 §8) |

| Healthy | else | no banner |

Entitlement truth (restating v1 §8 so support tickets answer themselves):
on trial/subscription expiry, member entitlements degrade to `free`
**immediately**; data is never deleted; the console stays read-only 14
days, then archived (restorable by reactivating). Member-side, each ex-gym
member gets the win-back Pro prompt — the B2B→B2C funnel firing exactly
where v1 designed it.

### 4.3 Members

*(AMENDED 2026-09-19: the gym's own member list — upload, reconcile, invites, the
code admitting at once, CSV export's escaping — is §9, which wins where this differs.)*

**Purpose:** roster, seats, and the 30-second walk-in join.

Header: **Seat meter** (`members / cap`, color at 90 %) · search · filters
(group/code · status active|at-risk|inactive|removed · joined range) ·
**[Invite]** (sheet: show code big, QR, WhatsApp share, poster PDF per
code) · **[Export CSV]** (owner/manager; columns = table columns; respects
§2.4 boundary).

Table (`org_member_stats`, cursor-paginated 50/page, server sort): Display
name · Group (code label) · Joined · Last active · Workouts 30d · Avg form
30d (— under 5 sets) · Streak · ⋮ (Nudge / View / Remove). Sort default:
last active desc. Trainer role: pre-filtered to their group(s), Remove
hidden.

**Member detail drawer** (tap row): identity chip (display name, member
since, group) · 12-week activity sparkline · exercise mix (top 5 by sets)
· form-score trend line · fault mix (top 3 fault categories by count —
*this is what makes a trainer nod*: "his squats cave inward, the app sees
it too") · last 10 sessions list (date, exercises, sets, avg score) ·
actions: Nudge · Assign program (v1.5, disabled with "coming" tag) ·
Remove. **Everything here derives from SetSummary aggregates — nothing
outside the §2.4 boundary is even queryable by this screen's repo.**

Remove flow: confirm sheet → sets `removed_at` (seat freed instantly;
history retained; member app notifies "You've left {org} — your workouts
are yours forever" + Pro win-back). **Restore** available 30 days (clears
`removed_at` if seats allow). Edge cases: duplicate display names →
disambiguate with join-month suffix in org views only · member of 2 orgs →
appears in both rosters, each sees only membership-interval activity

(§2.1) · code used by a stranger → they're a member like any other; owner
removes; **rotate code** suggested inline after any removal.

### 4.4 Leaderboard

**Purpose:** retention theater inside the facility; the poster/TV are the
app's own marketing to non-users on the floor.

Boards (month picker, org TZ): **Form Score** (avg over month, min 8
scored sets — quality gate stops one lucky set topping the board) ·
**Workouts** · **Streak**. Row: rank · display name (member-app setting:
first name + last initial default; **opt-out toggle lives in the member
app**, opted-out members simply don't appear) · value · movement vs last
week. **Board renders only at ≥ 3 eligible members** (below that: invite
CTA instead — a leaderboard of one is an insult). Groups filter (studio:
per-cohort boards). Clinic: whole screen hidden unless owner enables
(§2.3).

**TV mode:** owner/manager creates a **display token** → URL `/tv/:token`
— fullscreen, logo + rotating boards (20 s), auto-refresh 60 s (Redis
read; ~free), joins-this-month ticker, QR + code footer ("Scan to join
{org}"). Token is view-only, revocable, expires with subscription; safe on
any lobby screen. States: pre-3-members → shows QR + "Be first on the
board".

**Poster generator:** per-code A4 PDF (worker ≤ 10 s): org logo, "Free
with your membership" line, QR + code, 3-step how-to, bilingual (org
locale + English; AS/HI keys from Part 2 Appendix A conventions). Monthly
variant: top-3 podium + QR — the notice-board refresh that keeps the app
visible offline. Delivery: download + WhatsApp share; stored in R2
`reports/`.

Events: `tv_mode_started/heartbeat`, `poster_downloaded{variant}`,
`leaderboard_viewed`.
### 4.5 Reports

**Purpose:** the monthly renewal argument, generated for the owner and
*sent* to them — never assume they'll come looking.

**Monthly org report (PDF, worker job on the 1st, 06:00 org TZ; emailed +
WhatsApp-ready; archived in R2 `reports/`, listed here for 18 months):**
Page 1 — logo, month, four KPIs with Δ vs prior month, one-line headline
auto-picked from the best true stat ("Your members completed **1,240**
workouts — up 18%"). Page 2 — weekly trend chart · top-10 leaderboard ·
new members / removed. Page 3 — exercise mix, avg form score trend,
**at-risk snapshot** ("6 members going quiet — open the console to nudge
them") — the report always ends by sending the owner *back into the
console to act*. Clinic variant reframes page 3 as adherence summary
(Phase 2, §6.2). Numbers follow Part 2B §6 (integers, honest deltas, no
fake precision; calories, if ever shown, as ranges).
On-demand **[Generate now]** (rate-limit 3/day). States: first month
partial → watermark "partial month"; generation failure → auto-retry ×3
then surfaced with support link. Events: `report_generated/emailed/opened`
(open tracking = renewal-risk signal for *you*: an owner who never opens
two reports in a row is churning — this feeds your admin panel, not
theirs).

### 4.6 Billing

Plan card (tier, seats used/cap — **utilization**, renewal date, price in
org currency) · **Change tier** (up: immediate, prorated · down: blocked
while members > target cap with guided remove/upgrade choice; mechanics in
Part 5) · Payment method (Razorpay B2B rails per v1 §10 — B2B billing
never touches app stores) · Invoice list (PDF download) · **Cancel**
(owner only): one honest retention screen (pause 1 month option ·
Micro-tier downshift if eligible) → reason survey (4 options + text; this
survey is your churn dataset) → confirm; post-cancel = the §4.2 expiry
path. Trial state shows "Choose plan" instead of plan card. All money
mutations are idempotent + audit-logged (v1 §10 webhooks doctrine).

### 4.7 Settings (+ Staff)

**Profile:** name, city, logo, timezone (changing TZ takes effect next
rollup; historical rollups never rewritten — `calc_version` philosophy
applied to time itself), locale, vocabulary preview. **Codes:** list
(label, uses, created, status) · create (label + optional expiry/max-uses)
· rotate (old joins keep their group tag; old code dies) · pause.
**Privacy:** the §2.4 visibility sheet verbatim (what the org can/can't
see) + data-request routing (member deletion/export requests are

member-initiated in *their* app; the console only ever sees the §2.4
surface — stated here so owners can answer members' questions correctly).
**Notifications:** report email recipients, at-risk weekly digest on/off,
quiet hours. **Staff:** list, invite by email/phone with role, change
role, remove; every staff mutation audit-logged; last-owner removal
blocked.

---

## 5. Activation, console analytics & staff notifications

### 5.1 Activation checklist (pinned on Overview until complete)

☐ Logo added · ☐ Poster printed/shared · ☐ First **5** members joined ·
☐ First **20** workouts synced · ☐ Monthly report viewed. Stored in
`gyms.activation`; completing all five = **activated**. Rationale:
activation-by-day-7 will be your single best predictor of trial→paid
conversion — instrument it (`org_activated{days_since_signup}`) and steer
onboarding copy/pilot playbooks by it.

### 5.2 Console analytics (server-side PostHog, per v1 §16)

`console_login` (per staff) · `overview_viewed` · `at_risk_nudged` ·
`member_removed` · `code_rotated` · `poster_downloaded` ·
`tv_mode_started` · `report_opened` · `upgrade_clicked/completed` ·
`cancel_started/reason/completed`. Owner-engagement composite (logins +
report-opens + nudges per month) is the leading renewal indicator —
surfaced on *your* admin panel next to per-org cost (v1 §9.3) so every
renewal call starts with the two numbers that matter.

### 5.3 Staff notifications (through the v1 §15 module; same caps & quiet
hours)

Weekly digest (Mon 09:00 org TZ: KPIs + at-risk count + deep link) ·
report-ready (monthly) · seat-pressure (once per crossing) · trial D-5 /
D-1 · payment events. WhatsApp channel adapter (Phase 2 per v1 §15)
upgrades digest + report delivery for India orgs — architected now,
shipped later.

---

## 6. Org-type deltas (what actually differs, and when it ships)

### 6.1 Studio / PT (v1.5 — after gym console is stable; mostly
configuration, one real feature)

Groups become first-class in UI (they already exist as code labels): group
filter pinned on Members/Leaderboard; per-group boards; trainer scoped to
group(s) by default. **The one real feature: program assignment
surfacing** — depends on Programs (v1 §21 #6): trainer assigns a program
to a member/group; member app shows "Assigned by {Coach}"; Members table
gains an **On-plan %** column (sessions matching assigned program ÷
assigned sessions, week window). Micro seat tier live. Pitch delta: gyms
buy *differentiation*, studios buy *client accountability* — same console,
different first screen emphasis (Members-first default tab for studios).

### 6.2 Physio clinic (Phase 2 — **gate: one committed pilot clinic or 5
inbound clinic requests; do not build speculatively**)

Everything in 6.1, plus: vocabulary set (Clients/Sessions/Clinician) ·
leaderboards/challenges off by default · join = consent flow (§2.4,
`consent_at`) · **Client adherence view**: assigned plan vs completed
(calendar heat-strip), avg form score, fault mix, hold-time & ROM trend
for mobility/stretch items (F10/F12 data — the honest, measurable signal a
clinician actually wants) · **printable per-client adherence PDF** (for
their paper file; adherence & activity only) · copy linter active (§2.2).
Positioning boundary (Part 2B §7) is enforced product-wide: the console
*reports what the client did*; the clinician judges what it means. This
sentence appears in clinic terms, onboarding, and the report footer.

### 6.3 Worldwide

Console currency is **display-localized** (₹/$/€ from `currency_display`),
pricing tables per region resolved in Part 5; org TZ drives all time
boundaries (§3.2) — an Auckland gym's "this week" is Auckland's week;
member-side quotas remain UTC (v1) and the two never mix. All console
strings are message keys from day one; RTL deferred until a market demands
it.

---

## 7. Edge cases & policies (the support-ticket pre-emption list)

**Seat downgrade below headcount** → blocked with guided flow (§4.6).
**Code leaked publicly** → rotate + optional expiry/max-uses on new codes;
joins are members, not incidents. **Member in multiple orgs** → allowed;
entitlement = best active (v1 §8); stats per membership interval. **Owner
leaves own gym as member** → toggle off `owner_included_as_member`; staff
role unaffected. **Org deletes account** → subscription cancels,
memberships end (`removed_at = now`), members keep their own data +
win-back prompt, org data archived 90 days then purged (DPDP), audit_log
retained. **Timezone change** → future rollups only (§4.7). **Display-name
abuse on TV mode** → owner can hide a member from boards (member keeps
playing privately); profanity list on display names at the member-app
layer. **Minors** → member app policy question, not console's; boards show
display names only, never photos, partly for this reason. **Two staff edit
simultaneously** → last-write-wins + audit trail; no locking ceremony at
this scale.

---

## 8. Build slices & acceptance criteria

**Slice A — lands in v1 Phase 3 (weeks 6–8), the "gym console v1":**
Onboarding wizard · Overview (tiles, trend, at-risk, checklist) · Members
(table, drawer, invite, remove, CSV) · Codes · Billing (trial→pay, tier
change up, invoices) · Settings/Staff · rollup worker + `org_daily_stats`
· monthly report job + email · banner machine.
✔ *Done when:* a stranger self-serves org→trial→poster in ≤ 5 min (TTFMJ
instrumented) · a member joins by code and their next workout moves
Overview within 5 min (live counter) and next-day rollups · at-risk nudge
delivers a push · trial expiry degrades entitlements exactly per §4.2 with
zero manual steps · report PDF emails itself on the 1st · every §2.2
permission enforced by an API test, not just hidden UI.

**Slice B — v1.1 (rides Phase 4):** Leaderboards + TV mode + poster
generator + weekly digest. ✔ *TV URL runs 24 h on a lobby screen without
interaction; poster prints correctly A4; boards respect opt-out and the
3-member gate.*

**Slice C — v1.5 (with Programs):** §6.1 studio set. **Slice D — Phase 2
(gated):** §6.2 clinic set.

**Sequencing note:** Slice A intentionally ships *before* leaderboards — a
gym owner renews on adoption numbers and saved members; the poster/TV
layer then multiplies adoption. Don't invert it.

---

## 9. The member list

*(ADDED 2026-09-19, a planning chat with no code: RULINGS 2026-08-18, 2026-09-17 and
2026-09-19; ROADMAP Stage 2 items 3 and 5. Where §4.3 or the 2026-08-18 design notes
differ, this section wins: a list row carries no plan, fee or renewal date, and the
uploaded line is not kept. AMENDED the same day on Kd's words (RULINGS 2026-09-19): a
row keeps the gym's own STATUS word and the list can be filtered by it; nobody is
emailed until staff press Invite; and a gym with no other software keeps its list in
the app by hand. Every number marked "measured" came from a command run on 2026-09-19;
the scripts are kept outside the repository, at `D:\Projects\ai-home-gym-member-list\`.)*

### 9.1 What it is

The member list is the gym's own list of its members, held in the app. It serves two
kinds of gym with one mechanism:
- **A gym with other software** exports its list (CSV or Excel) and uploads it whenever
  it likes; each of those uploads is its WHOLE list as of today.
- **A gym with no other software** uploads once (its spreadsheet, or a file from the
  software it is leaving) or never, and keeps the list in the app by hand: staff add a
  person, change one, take one off. An upload can also just ADD people.

The server reads a file, says what it understood and what would change, and changes
nothing until staff confirm. The list keeps each person's name, email, phone, member
number and the gym's own status word ("Active", "Expired", "Frozen" …), and can be
filtered by that word. Staff choose who gets the app — everyone, or a filter such as
Active — and press **Invite**; only then is anyone emailed (9.12), once. For every app
member of the gym the app knows one of three things — on the list · no longer on the
list · never on the list. Nobody is ever removed on their own, and the list never
blocks a join. Fees, renewal dates and payments are NOT part of it; they come later
with the management features (9.11).

### 9.2 Principles (each is a test in 9.10)

1. **Source of truth, never a gate.** The list changes what the gym SEES. It grants
   nothing in 3a, blocks nothing ever, and removes nobody by itself.
2. **The table is the gym's list as it stands, exactly**: the newest whole-list
   upload, plus what staff have added, changed or taken off since. A person who leaves
   the list leaves the table. History is ONE timestamp on the membership,
   `last_listed_at`.
3. **Matching is worked out when asked, never stored.** App member ↔ list entry by
   VERIFIED email, else by the phone the member gave. There is no link column, so
   nothing can drift, and deleting an account needs no new statement.
4. **A wrong match is worse than a missed one.** Exact keys only. A name never
   matches anyone. A phone match clears a mark and grants nothing (RULINGS 2026-09-17).
5. **Read, show, then write.** Upload → preview → confirm. A confirm applies to the
   list the preview was worked out against, or refuses (Terraform's stale-plan rule).
6. **The same file twice writes nothing**: zero rows touched, the version not bumped.
7. **Keep only what a screen reads**: name, email, phone, member number, status. Every
   other column is dropped in memory, never stored, never logged. The file is never
   stored.
8. **Nothing in the file is believed**: not its name, type, declared sizes or encoding.
9. **Destructive steps carry a guard** sized to the gym (9.8), and an explicit
   acknowledgement for that one action — never a setting.
10. **Nobody is emailed until staff press Invite** (RULINGS 2026-09-19). A confirm
    sends nothing. The status word only chooses who is INVITED; it never decides who
    may join (RULINGS 2026-08-24, reaffirmed 2026-09-17: an upload is days old).
11. **The gym's invite is its yes.** Signing in with an address joins a person without
    a code only where the gym invited that address; everyone else uses the code.

### 9.3 Slices — one chat and one pull request each

| Slice | What lands | Packages | Model |
|---|---|---|---|
| 3a-i | Opening a file safely: type sniff, safe unzip and re-pack, the parse worker, CSV decoding and parsing → a grid of text cells. No database, no route. | `read-excel-file` | Opus xhigh |
| 3a-ii | Understanding the grid: header row, column guesses, cleaning of name, email, phone, member number and status, placeholders, duplicates → rows and plain-word problems; `tools/read-member-file.ts`. No database, no route. | `libphonenumber-js` | Opus xhigh |
| 3a-iii | The list on the server: migration, the reconcile rule, upload (whole list, or add) → preview → confirm, the reads with the status filter, the hourly expiry, the list going when a gym closes. | — | Opus xhigh |
| 3a-iv | Keeping the list by hand: add one person, change one, take one off, put an app member on the list, remove the unlisted in one call (with its guard). | — | Opus xhigh |
| 3b | The invites, sent when staff press Invite (9.12). | — | Opus xhigh |
| 3c | The code admits at once (9.13). | — | Opus xhigh |
| 5 | The screen (9.14). | — | Opus xhigh |

Shared shapes and every constant in 9.9 live in `packages/shared/src/memberList.ts`
(new; `orgs.ts` is already past 1,700 lines). Server code lives in
`apps/api/src/modules/orgs/memberList/`. The word in code, routes and screens is
**member list**; "roster" already means the app-members page in this module and is not
reused. Phone parsing stays on the server (the web never imports the phone metadata).

### 9.4 Opening a file safely (3a-i)

**Measured, and the reason for this slice.** `read-excel-file` 9.3.10 unzips in Node
with `unzipper-esm`, reads each part's LOCAL header and calls `Buffer.alloc(declared
size)`; nothing caps inflated bytes. A 139-byte file whose header claimed 200 MB took
the process from 46 MB to 447 MB; a 153 KB file of honest headers inflated to 150 MB
(365 MB peak). A 5 MB upload could ask for gigabytes and kill the API. Its XML reader
(`saxen`) defines no entities, so entity bombs do not apply, and formulas are never
worked out (it reads the cached value). So the package is kept, and never sees a file
we have not rebuilt ourselves.

**Transport.** `POST` JSON `{ contentBase64, mode, mapping? }`, the photo scan's pattern
(`analyze-photo`): no multipart, so no form can post it cross-site. `bodyLimit` 7.5 MB.
Sign-in, the privilege check and the rate limit all run in `onRequest`, in that order,
BEFORE the body is read — a stranger's 7 MB is never parsed. The file name and the
browser's type are not sent and not used.

**Sniff by content, never by name.**

| First bytes | Treated as |
|---|---|
| `50 4B 03 04` (or `05 06`, `07 08`) | a ZIP → the safe unzip below |
| `D0 CF 11 E0 A1 B1 1A E1` | refused `old_excel_or_password` — a legacy `.xls` AND a password-protected `.xlsx` both look like this |
| `25 50 44 46` | refused `pdf` |
| after any byte-order mark and white space, `<?xml` `<!doctype` `<!--` `<html` `<head` `<body` `<meta` `<table` `<style` `<workbook` or `MIME-Version:` | refused `web_page_or_xml` — an "Export to Excel" button that writes a web page or Excel 2003 XML under an `.xls` name (Kd, 2026-09-19; Excel's own Web Page, Single File Web Page and XML Spreadsheet 2003 saves are the fixtures) |
| anything else | text → the CSV reader |

**Safe unzip and re-pack** (`zipSafe`; Node's `zlib` only, no package):
1. Find the end-of-central-directory record from the tail (last 65,557 bytes). None →
   `not_a_spreadsheet`. Any ZIP64 record, any `0xFFFF`/`0xFFFFFFFF` sentinel, a disk
   number other than 0 → `unsafe_archive` (ZIP64 is never needed under 5 MiB).
2. Walk the central directory, bounds-checking every offset and length: at most 1,000
   entries (Apache POI's figure); flag bit 0 (encrypted) → `old_excel_or_password`;
   method 0 or 8 only; a name that is absolute, holds `..`, a backslash or NUL, or
   repeats → `unsafe_archive`.
3. It must hold `[Content_Types].xml` and `xl/workbook.xml`, else `other_zip` (naming
   OpenDocument or Numbers where the archive says so). A macro part (`vbaProject.bin`)
   is simply never read — step 6's allowlist leaves it behind.
4. For each entry ending `.xml` or `.rels`: read its local header for the data start;
   the data range must lie inside the file and must not overlap an earlier entry's
   (the overlapping-files bomb). The parts' DECLARED sizes over 25 MiB in total →
   `too_complex`, before a byte is inflated (an honest workbook that big is far past
   10,000 rows, and its fix is the member sheet as CSV). Inflate each with
   `zlib.inflateRawSync(slice, { maxOutputLength: its declared size })`.
   `ERR_BUFFER_TOO_LARGE`, a length that differs from the central directory's, or a
   CRC-32 mismatch (`zlib.crc32`) → `unsafe_archive`. (Measured: 50 MB of spaces
   deflates to 50,971 bytes and the cap stops it.)
5. A part containing `<!DOCTYPE` or `<!ENTITY` → `unsafe_archive`. So is a part with a
   tag longer than 64 KiB from its `<` to the first `>` outside a quoted value, or a
   comment, CDATA section or processing instruction never closed (review of PR #85,
   measured: the package took 74 s over one closed 1 MiB tag, 94 s over one whose
   early `>` sat inside quotes, 173 s over one never closed — 32 and 44 ms at 256 KiB);
   one linear pass. A part holding `<sheetData` (a worksheet, whatever its path) with
   `hidden="1"` or `hidden="true"` on a `<row` or `<col` → warning
   `hidden_rows_or_columns` (a filtered view is stored as hidden rows, so this also
   catches "exported a filter"); the pattern never scans past the next `<` or `>`
   (with `[^>]*?` it grew with the square of the size: at 64 KiB 409 ms measured in
   the building chat on the pattern alone and 759 ms in the review that found it).
6. Write a fresh archive of only those parts: stored, true sizes and CRCs, no data
   descriptors, no extra fields, no comment. ONLY this archive reaches the package —
   its sequential reader and our central-directory reader can then never disagree.

**Reading it.** `readXlsxFile(repacked, { parseNumber: plainNumberText, trim: false })`.
`parseNumber` hands over a number cell's stored text, which is what keeps a phone or
member number exact (measured on a real Excel file: `"919876543210"`,
`"1234567890123456"`); `plainNumberText` writes it in plain digits by moving the
decimal point in the text, never through a float, because Google Sheets stores the same
numbers as `9.1987654321E11` and `1.234567890123456E15` (3a-i, Kd's download) — every
digit present, and 3a-ii must not take that for a CSV's damage. Every sheet comes back; a cell becomes
text (string as is · TRUE/FALSE · a date as `YYYY-MM-DD` · empty). A sheet is cut at
10,020 rows and 100 columns and marked `truncated: { rows, columns }` only where
something was written past the cut; blank rows after the last written one are
dropped, blank rows inside are kept (row numbers match the gym's sheet). A workbook the
package cannot read is refused `unreadable_excel`; its error is never read (it can
quote a cell). Excel's "Strict Open XML" `.xlsx` reads exactly as a normal one
(measured 2026-09-19). **The grid's budget** (review of PR #85, Critical): all sheets
together hold at most 1,002,000 cells (one sheet at its cut) and 5,242,880 characters
(as many as the largest CSV), counted in the worker as the grid will be posted —
padded rows, cut cells — or the file is `too_complex`. A workbook can point every
cell at one shared string: one string in the worker, a copy per cell once posted (a
0.8 MB file took the request thread's heap past 1 GB). Excel's own 10,000 × 30 list
is 300,030 cells and 2,900,908 characters.

**CSV: decoding, measured on Excel 16 here** (ANSI code page 1252, list separator `,`):

| Excel's "Save as" | Bytes written |
|---|---|
| CSV UTF-8 | BOM `EF BB BF`, CRLF |
| CSV (Comma delimited) | windows-1252, no BOM, CRLF; a letter outside 1252 (Ł, अ) is written as a literal `?` — lost at export |
| Unicode Text | UTF-16LE with BOM `FF FE`, TAB-separated |
| CSV (Macintosh) | Mac Roman, bare CR line ends — and CRLF after the last line |
| CSV (MS-DOS) | the OEM code page, CRLF — cannot be told from 1252 by decoding |
| every one of them | a 12-digit number in a General cell is written `9.19877E+11`, a 16-digit one `1.23457E+15`: the digits are gone before we see the file |

Ladder: BOM → UTF-8, UTF-16LE or UTF-16BE · else strict UTF-8 (`TextDecoder`,
`fatal: true`) · else, where bare CR line ends are at least as many as CRLF and LF
together (Excel ends a Mac file's last line in CRLF), `macintosh` · else
`windows-1252` (it never fails, so it is last). A NUL left after decoding →
`unreadable_text`. **Windows-1252 is our own table, not Node's** (3a-i, measured
2026-09-19): Node 24.11.1's `TextDecoder("windows-1252")` reads 0x80–0x9F as ISO-8859-1
control characters — 27 bytes, among them € ’ “ ” and Š š Ž ž Œ œ Ÿ — against Python's
cp1252 (Node 22.23.2, CI's and production's, decodes them right); its `macintosh`
matched mac_roman on all 256 bytes. So 1252 is latin-1 with those 27 mapped from the
WHATWG index — one answer on every Node. Boot asserts `utf-8`, `utf-16le`, `utf-16be`
and `macintosh` exist (Node's official builds carry full ICU; a slim build would
not). Excel in a comma-decimal country writes `;`.

**CSV: parsing.** A first line `sep=X` names the delimiter and is not data. Otherwise
Papa Parse's published rule over `,` `;` TAB `|`: parse the first 10 non-empty records
with each; keep those averaging more than 1.99 fields; lowest change in field count
between rows wins, then most fields, then that order; none → `,` (a one-column list of
emails is a real file). A quote opens a field only as its first character; `""` is a
quote; CRLF, LF and CR end a record outside quotes; text after a closing quote is
kept as typed (Excel's behaviour). An unclosed quote at the end → `unterminated_quote`
with its row. One hand-written state machine, table-tested — no CSV package.

**The worker.** Everything after the sniff runs in a fresh `worker_threads` Worker per
file, started on `parseWorker.boot.mjs`, two lines of plain JavaScript that load the
TypeScript worker with tsx's `tsImport` (3a-i, found by CI: `execArgv: ["--import",
"tsx"]` works on Node 24 but not on Node 22.23.2, where Node's own type stripping
loaded the worker and its `./openFile.js` import was not found — production runs
Node 22), `execArgv: []`, `resourceLimits.maxOldGenerationSizeMb: 256`, a 15 s wall clock then
`terminate()`, the bytes copied once and the copy transferred (the caller's Buffer may
share pooled memory, which a transfer would detach), the reply parsed by Zod; a
crash comes back as its error's class name only. At most 2 parses run at once per
process; a third answers 503 `busy`; 3a-iii's route also allows one parse per gym at a
time, so one account cannot hold both. `resourceLimits` does not
cover Buffers — the byte caps above are what bound memory; the worker is what keeps a
slow parse off the event loop and makes a hard timeout possible at all. (Measured: a
`.ts` worker spawned this way, importing a sibling module as `./x.js`, answers under
`node --import tsx` — about 750 ms for the first start — and inside vitest 2.1.9.
Inside vitest the worker's modules load through tsx, not vite, so nothing in it can be
mocked: test the pure functions directly and the worker for its wiring.)

**Out of 3a-i:** `{ ok: true, kind, sheets: [{ name, rows: string[][], truncated:
{ rows, columns } }], facts: { encoding?, delimiter? }, warnings }` (a CSV's one sheet
has `name: null`; 3a-i's warnings are `hidden_rows_or_columns` and `encoding_guessed`)
or `{ ok: false, refusal }` with one refusal from 9.9. The shapes and the refusal
words are `packages/shared/src/memberList.ts`; the entry point is
`parseMemberFile(bytes)`. A worker out of heap answers `too_complex`; a fault of our
own code throws with the error's name only.

### 9.5 Understanding the grid (3a-ii) — the rules that pick, each with a table test

**Header row.** Over the first 20 non-empty rows: +2 for a cell that is a known header
word (below), −3 for a cell that looks like an email or a phone VALUE; the best row
scoring 2 or more is the header (first on a tie); none → the file has no header and
columns are told by their values alone. **Sheet:** the first sheet that yields an
email or phone column; the others are named in `other_sheets_ignored`.

**Header words** are compared after: NFKC · lower case · accents off · `_ - . / \ ( ) :
# *` and apostrophes to a space · spaces collapsed · a trailing ` 1` or ` primary`
dropped. Seen in a real product's help pages or sample files (2026-09-19): Gymdesk,
Zen Planner, Clubworx, Arketa, WellnessLiving, GymMaster, Magicline, Dynamics 365,
Google Contacts, Mailchimp, Square, Stripe. No Indian or Brazilian product publishes
its headers, so the list is a guess-assist over a mapping staff always see, never the
contract.

| Field | Words |
|---|---|
| first name | first name · firstname · member firstname · given name · fname · first · forename · vorname · prenom · nombre · nome · voornaam |
| last name | last name · lastname · family name · lname · surname · last · nachname · nom · apellido · apellidos · sobrenome · achternaam · cognome — and `name` where a first-name column exists (Magicline) |
| full name | full name · name · member name · client name · customer name · display name · nome completo · nombre completo · naam · nom complet |
| email | email · e mail · email address · e mail address · email addresses · email id · mail · primary email · e mail 1 value · correo · correo electronico · courriel · e mailadres · endereco de e mail |
| phone | mobile · mobile phone · mobile number · cell · cell phone · cellphone · whatsapp · phone · phone number · phone numbers · contact number · telephone · phone 1 value · home phone · home phone number · work phone · business phone · telefon · handy · mobil · telephone portable · portable · movil · telefono · telefone · celular · telefoon · mobiel · cellulare |
| member number | member id · member no · member number · membership number · membership id · client id · customer id · check in code · barcode · barcode id · key tag · keyfob · fob · card number · reference id · external id · id · mitgliedsnummer · matricula · numero de socio · lidnummer · tessera |
| status | status · member status · membership status · account status · client status · state · active · estado · situacao · statut · stato (the help pages read 2026-09-19 name none; a guess-assist like the rest) |

A header holding any of **emergency · guardian · parent · spouse · partner · next of
kin · referred · referrer · trainer · coach · sales · staff · employee · company ·
employer** is NEVER name, email or phone: an emergency contact's number is not the
member's. A header holding any of **payment · billing · invoice · marketing · email ·
sms · waiver · card · subscription to** is NEVER status ("Email status: subscribed" is
not a membership).

**Guess = header, confirmed by values.** Up to 200 non-empty cells a column: the share
shaped like an email; the share that parses as a possible phone for the gym's country.
A header guess stands at a share of 0.6 or more; with no usable header a column is
email or phone by values alone at 0.8 or more. Member number is never guessed from
values. **Several email columns:** the exact word first, then one not holding
secondary/alternate/other/work, then the most filled, then the leftmost. **Several
phone columns:** mobile/cell/whatsapp, then phone/telephone/contact, then home, then
work; then most filled; then leftmost. The losers are kept IN ORDER: a row whose first
email or phone is empty or unreadable falls back to the next column. **Remembered:**
if the header row's fingerprint equals the gym's last confirmed upload's, its mapping
is used again (`confidence: "remembered"`). Staff can always send their own
`mapping` — `{ sheet?, headerRow (or null), fullName?, firstName?, lastName?, email:
[], phone: [], memberNumber?, status? }` by column index — by uploading again; the server never
keeps unmapped columns, so re-mapping is a fresh upload from the file the browser
still holds.

**Cleaning a row**, in this order: each cell → placeholders → usable → identity key →
duplicates. Every cell first: NFKC, U+00A0 and zero-width characters out, control
characters out, trimmed.
- **Name:** full name, or first + last; spaces collapsed; at most 120 characters; may
  be empty (screens show the email instead).
- **Email:** `mailto:` off; the address out of `Name <a@b>`; split on `; , / |` and
  spaces and the first piece that passes wins; trailing `. , ; :` off; longer than 254
  → unreadable BEFORE any pattern runs; then `authEmailSchema` — the very rule sign-in
  uses, so list email and sign-in email are equal by construction. Exact match only;
  Gmail dots and `+tags` wait for the one shared rule Stage 3 item 2b builds.
- **Phone** (`libphonenumber-js/max` 1.13.13, measured 2026-09-19; `/min` checks
  length only): text only (a non-string THROWS `TypeError`, not `ParseError`) · every
  Unicode decimal digit folded to ASCII (the package folds full-width and
  Arabic-Indic; it does NOT fold Devanagari — `९८७६५४३२१०` → nothing) · `tel:`, a
  leading apostrophe and Unicode dashes handled · a trailing `.0` stripped (left in,
  `919876543210.0` becomes `+919198765432100`) · scientific notation is expanded only
  when every digit is present (`9.19876543210E+11` → `919876543210`), else the cell is
  `shortened_by_excel` and never repaired · split on `/ ; , |`, " or " and line breaks
  (two numbers in one cell otherwise GLUE: `555-1234 / 555-9876` →
  `+155512345559876`) · each piece `parsePhoneNumberFromString(piece,
  { defaultCountry: the gym's country, extract: false })` · the first piece that
  `isPossible()` wins and is stored as E.164, extension dropped · `!isValid()` is only
  counted (`phones_unusual`) — both sides use one package version, so a number range
  newer than its metadata still matches itself. No country on the gym → only a number
  written with `+` is read; the rest count as `phones_need_country`. Never compare
  `.country` (`07911 123456` in GB reads as Guernsey). Known and accepted: Argentina's
  and Mexico's two spellings of one mobile, and Brazil's old 8-digit mobiles, do not
  meet.
- **Member number:** text; `.0` off; scientific notation as for phone; at most 64;
  `0`, `-`, `n/a`, `na`, `none`, `null` are empty.
- **Status:** the gym's OWN word, never ours — spaces collapsed, at most 40 characters,
  grouped without regard to case, shown as first written; empty stays empty. A column
  of yes/no, true/false or 1/0 under a header such as "Active" reads "Active" and "Not
  active". A column with more than 20 different values is not a status column: it is
  never guessed, and a hand mapping of it is refused in those words. The app attaches
  no meaning to a status word — it filters and it chooses who is invited, nothing else
  (9.2 rule 10) — so no word list of ours can be wrong about a gym's "Current" or
  "Frozen".
- **Placeholders:** an email or phone that appears on more than 5 rows of one file is
  a front-desk placeholder and is dropped from every row carrying it (Segment's
  identifier limit), counted and shown.
- **Usable:** a row needs an email or a phone. Otherwise it is skipped as
  `no_contact` — a name alone can match nobody and invite nobody, so it is not kept.
- **Identity key:** `sha256` of `[email, phone, lower(member number), name folded]` —
  NOT the status, so "Active" becoming "Expired" changes a row in place.
  Equal keys in one file → the first is kept, the rest counted `duplicates`. Two
  people sharing an email (a family) differ by name and are both kept; the preview
  counts `shared_emails`. NO durable fact hangs on an entry's identity — the invite
  record is keyed by email (9.12) and being in the app is worked out — so a corrected
  spelling is honestly "one gone, one new" and costs nothing.

**Warnings** (file level, plain words in 9.9): `hidden_rows_or_columns` ·
`question_marks_in_names` (a `?` beside letters: the ANSI export above) ·
`garbled_names` (one of `‚ ƒ „ † ‡ ˆ ‰ ‹` touching a letter, or `Š Œ Ž Ÿ` between two
lower-case letters — `H‚lŠne` is a DOS file read as 1252, `Šimun` is a real name) ·
`shortened_by_excel` · `phones_need_country` · `phones_unusual` · `shared_emails` ·
`placeholders` · `other_sheets_ignored` · `encoding_guessed` · `no_header_row`.

**`tools/read-member-file.ts <path> --country IN [--show 5]`** prints what the server
understood (counts, mapping, warnings; row text only with `--show`). 3a-ii has no
screen; this is how a real export is tried before one exists.

**Out of 3a-ii:** `understandMemberFile(bytes, { country, mapping, remembered })` →
`{ ok: true, kind, facts, sheet: { index, name }, headerRow, headerFingerprint,
columns: [{ index, header, samples, guess, confidence }], mapping, needsMapping, rows,
counts: { dataRows, kept, noContact, duplicates, withEmail, withPhone,
withMemberNumber, withStatus }, statuses: [{ label, count }], skipped, warnings }` or
`{ ok: false, refusal }`. **The understanding runs IN THE WORKER**, straight after the
file is opened, so what crosses into the request's own thread is the rows a list keeps
and never the file's cells. Measured 2026-09-20 on Node 22.23.2 (production's), the
biggest list allowed (10,000 × 30, 3.15 MiB CSV): understanding it costs 559–634 ms —
which the API would otherwise answer nothing else during — so in the worker the whole
read is 1,326–1,472 ms with the request thread's longest stall 11–15 ms and its RSS
97 → 136 MB (3a-i alone: 19–24 ms). The route (3a-iii) calls this, never
`parseMemberFile`, which stays as 3a-i left it.

**Refusals this step raises** (from 3a-i's cut, which marks a sheet rather than
refusing it): `too_many_columns` (the sheet is wider than 100), `too_many_rows` (cut
short, or more than 10,000 people under the headings), `no_rows` (headings and nothing
else), and — new, 2026-09-20 — `mapped_column_not_status` with the column staff chose,
for a hand mapping of a column holding more than 20 different words.

**AMENDED 2026-09-20, found building 3a-ii** (each one a table test):
- The heading fingerprint is taken from the heading ROW itself, not from the columns as
  read, so a remembered mapping is tried BEFORE anything is guessed — including the
  sheet. A gym whose headings we cannot read at all is exactly the gym that mapped them
  by hand, and it must not do it again every month.
- With no country set on the gym, a phone column is found by SHAPE, not by parsing.
  Otherwise a gym whose numbers are all local loses the column altogether and is never
  told to set its country. What is READ is unchanged: only a number written with its
  own country code, the rest counted `phones_need_country`.
- A joining date is a possible phone number to the package — measured, `2024/01/05`
  reads as a valid German landline — so a cell shaped like a date or a time is never a
  phone value. Without this, a headerless file's date column becomes its phone column.
- `question_marks_in_names` counts a `?` anywhere in a name, not one beside a letter:
  Excel's ANSI export wrote `अमित` as `????`, with no letter left beside the marks.
- A cell written `Ann Lee <ann@gym.com>` counts as an email value, as the cleaner reads
  it; a note that happens to hold an address does not (it has spaces around it).
- At most 5 columns a field (`MEMBER_LIST_MOST_COLUMNS_PER_FIELD`). Every column after
  the fifth is another number to read on every one of 10,000 rows, and no gym's export
  has six email columns.
- The phone package is never asked about a cell that could not hold a number (7 to 24
  digits, at most 6 letters, no date or time): it costs about 0.04 ms a call, and a
  100-column file would otherwise spend most of a second on cells that are names.
- The understanding carries the file's own facts (`kind`, `facts.encoding`,
  `facts.delimiter`), so the preview can show how the file was read without the grid.
- A member number longer than 64 characters is dropped whole, never cut: half a member
  number is another member's number.

**AMENDED 2026-09-20 again, by PR #86's review round one** (it ran the reader over every
country's metadata and over files of its own):
- **There is ONE shape a phone number may be kept in** — `MEMBER_LIST_PHONE_E164`,
  E.164's own 7 to 15 digits — and the reader clamps to it. The package's "possible" is
  wider: measured, a German number with a long direct dial reads as 16 digits, one
  written for Gibraltar as 19, and one whose leading zero was stripped as 6. Such a cell
  is not stored; the row falls through to its next phone column and keeps its email.
  Before this, one cell of row 4,000 made the whole file fail its own contract in the
  request's thread — a 500 for 3a-iii and nine thousand good members lost.
- `too_many_rows` is drawn by two kinds of file — more than 10,000 people, and a sheet
  cut short by its blank rows (the grid counts blanks against its row cap, so a list of
  5,011 people with a blank row after each one trips it). Its sentence is now true of
  both: "This sheet is longer than we can read. A member list may hold 10,000 people:
  take out any blank rows between them, or split the file…".
- Every column carries `headerSays`, what its heading CLAIMED before its cells were
  looked at. A column with `headerSays` and no `guess` is one the server disbelieved —
  an "Email" column whose cells say "N/A", or a heading that names somebody who is not
  the member — which is the one thing staff can act on.
- A vertical tab or a form feed inside a cell is a line break, not a character to drop:
  two numbers written one above the other are two numbers, never one glued number.

### 9.6 Data (3a-iii's one migration; forward-only)

```
gym_member_lists                         one row per gym that has ever confirmed a list
  gym_id uuid PK → gyms ON DELETE CASCADE
  version integer NOT NULL DEFAULT 0     bumped by every change to the list, under the gym's row lock
  last_confirmed_upload_id uuid NULL, last_confirmed_at timestamptz NULL, created_at

gym_member_list_entries                  exactly the newest confirmed list
  id uuid PK, gym_id uuid NOT NULL → gyms ON DELETE CASCADE
  full_name text NOT NULL DEFAULT ''     CHECK length ≤ 120
  email citext NULL                      CHECK length ≤ 254
  phone_e164 text NULL                   CHECK ~ '^\+[1-9][0-9]{6,14}$'
  member_number text NULL                CHECK length ≤ 64
  status text NULL                       CHECK length ≤ 40 — the gym's own word; INDEX (gym_id, lower(status))
  identity_key text NOT NULL             CHECK ~ '^[0-9a-f]{64}$'
  source text NOT NULL                   CHECK IN ('upload','typed','member')
  created_at
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
  UNIQUE (gym_id, identity_key) · INDEX (gym_id, email) · INDEX (gym_id, phone_e164)

gym_member_list_uploads                  staged → confirmed | superseded | expired
  id uuid PK, gym_id → gyms ON DELETE CASCADE, uploaded_by_user_id → users
  status text CHECK IN ('staged','confirmed','superseded','expired')
  mode text CHECK IN ('whole_list','add')
  file_kind text CHECK IN ('csv','xlsx'), file_sha256 text, file_bytes integer
  header_fingerprint text NULL, mapping jsonb NOT NULL
  base_version integer NOT NULL          the list's version the preview was worked out against
  summary jsonb NOT NULL                 counts only — never a name, an address or a number
  rows jsonb NULL                        the cleaned rows; NULL the moment it is confirmed, superseded or expired
  created_at, expires_at NOT NULL (created_at + 60 min), confirmed_at NULL

gym_members  + stated_phone_e164 text NULL   (same CHECK; written by 3c)
             + last_listed_at timestamptz NULL
             + INDEX (gym_id, stated_phone_e164) WHERE removed_at IS NULL AND stated_phone_e164 IS NOT NULL
```

No entry column points at a user, so `privacy/tables.ts` gains only
`gym_member_list_uploads` (its uploader, on `gym_closures`' footing). The list is the
gym's record, held for the gym: it is not in a person's export, a purge does not touch
it, and an account deletion already closes the membership the match reads. When the
archive sweep closes a gym, its three list tables' rows go in the same transaction.
The hourly job `orgs.member_list_expiry` (injectable clock) expires staged uploads.

### 9.7 The reconcile rule (3a-iii) — ONE pure function, one table test

`reconcile({ rows, entries, members })` — the SQL only fetches the three sets, so the
preview, the confirm, the reads and 3a-iv's removal cannot disagree.

- **Who counts as a member here:** live (`removed_at IS NULL`), not `complimentary`,
  not in `gym_staff` — the seat rule's own three conditions. The owner is member one
  and is on no export; without this every gym's owner reads "not on your list".
- **A member is on the list** when their VERIFIED email (`isEmailVerified`'s marker)
  equals an entry's email, else when their `stated_phone_e164` equals an entry's phone.
- **no longer listed** = not on the list and `last_listed_at` set (in a preview: or on
  the list being replaced). **never listed** = the rest. A gym that has never
  confirmed a list shows no marks at all.
- **The list:** `new` = keys in the file and not the table · `changed` = the same key
  with a different status · `unchanged` · `gone` = keys in the table and not the file.
  An upload in `add` mode has no `gone`: it adds and changes, takes nobody off and
  flags nobody. Of `new`: `alreadyInApp` · `canBeInvited` (has an email, not in the
  app) · `noEmail`. Each count is also given per status word.
- **Confirm**, in one transaction: lock the gym's row (the module's order: gym row,
  then child rows) → lock the upload row → `confirmed` already → the stored answer,
  `alreadyConfirmed: true` · `expired` / `superseded` → 409 · the list's `version` ≠
  `base_version` → 409 `list_changed` · work the rule out AGAIN on what is true now →
  the guard (9.8) → one `INSERT … SELECT FROM jsonb_to_recordset($1)`, one `UPDATE …
  SET status … FROM jsonb_to_recordset($2)` and one `DELETE … identity_key = ANY($3)`
  (parameters only; one round trip each, because the gym's row is held; NOTHING is
  emailed) → stamp `last_listed_at = now()` on every member who is on the list
  being replaced OR on the new one (so what the preview called "no longer listed"
  reads the same after the confirm) → bump the version (not when nothing changed) →
  the upload `confirmed`, `rows` NULL → audit `org.member_list_confirmed`, counts only.
- Joining also takes the gym's row lock (`claimSeat`), so a join and a confirm cannot
  interleave.

### 9.8 The guard against a wrong file

Staff export one location, a filtered view, or the wrong report, and the list
collapses. Identity products stop on exactly this (Okta's import safeguard 20 %;
Microsoft Entra's 500 deletions; Okta's entitlement safeguard, the one shipping both
shapes: 10 % and 100). A percentage alone is useless at 50 people and a count alone at
2,000, so: **a change is large when it is more than `max(10, 10 %)` of what it is
measured against.**

| Step | Measured | Against |
|---|---|---|
| confirm | entries that would go | the list's size |
| confirm | members who would become "no longer listed" | members now on the list |
| remove the unlisted (3a-iv) | members that would be removed | the gym's live members |

A large change answers 409 `large_change` with the numbers, writes nothing, and goes
through only with `acknowledgeLargeChange: true` on THAT request. New, changed and
unchanged rows never trip it, so an upload in `add` mode never does. The preview of a
whole-list upload that would take off more than half the list says so first and offers
"add these people instead" — the likeliest wrong file is a list of new joiners.

### 9.9 Routes, limits, refusals

All under `/v1/orgs/:gymId/member-list`. Order: authenticate → privilege → live plan
and not archived (`requireWritablePrivilege`, writes only) → rate limit → handler. A
stranger and another gym's staff get the module's 404; staff without the tick 403; a
gym with no plan 409 on writes while reads still answer. Every id is fetched with its
gym in the `WHERE`.

| Route | Tick | Slice |
|---|---|---|
| `POST /uploads` `{ contentBase64, mode: "whole_list" \| "add", mapping? }` → 201 the preview: file facts, columns (header, 3 samples, guess, confidence), mapping, counts (also per status word), skipped (first 200, with row numbers and reasons), warnings, `seat: { cap, liveMembers, listSize }`, the guard's numbers, `uploadId`, `expiresAt`, `sameAsLastUpload`. Supersedes the gym's earlier staged uploads. | `members.confirm` | 3a-iii |
| `GET /uploads/:uploadId` · `GET /uploads/:uploadId/rows?group=new\|unchanged\|gone\|members_leaving&cursor` — the names behind every number, before anyone confirms | `members.confirm` | 3a-iii |
| `POST /uploads/:uploadId/confirm` `{ acknowledgeLargeChange? }` | `members.confirm` | 3a-iii |
| `GET /` → `{ hasList, version, lastConfirmedAt, counts, statuses: [{ label, count, inApp, canBeInvited }] }` · `GET /entries?filter=all\|in_app\|not_in_app&status=…&status=…&query&cursor` (a status is matched without regard to case; `status=` empty means "no status") | `members.confirm` | 3a-iii |
| `POST /entries` `{ fullName?, email?, phone?, memberNumber?, status? }` (email or phone) → 201, or 200 `already_on_list` · `PATCH /entries/:entryId` (any of the five; the same cleaning; a change that lands on another entry's key → 409 `already_on_list`) · `DELETE /entries/:entryId` · `POST /entries/from-member/:userId` — put an app member of this gym on the list from their name, verified email and stated phone (the hand-kept gym's answer to "joined by code, not on your list") | `members.confirm` | 3a-iv |
| `POST /remove-unlisted` `{ group: "no_longer_listed" \| "never_listed", version, expectedCount, acknowledgeLargeChange? }` — the set is worked out again under the lock; a different version or count → 409 `list_changed` and nobody is removed; each removal is `removeMember`'s own statements and audit row, entitlements busted after commit | `members.remove` | 3a-iv |

No new tick: reading the list shows the email and phone of people who never joined the
app, so it needs `members.confirm` (owner and manager by default), not `members.read`.

| Constant | Value |
|---|---|
| file, decoded | 5 MiB |
| inflated parts, in total | 25 MiB |
| archive entries | 1,000 |
| data rows · columns · characters in a cell | 10,000 · 100 · 2,000 |
| header scan · value sample | 20 rows · 200 cells |
| parse wall clock · at once · worker heap | 15 s · 2 a process, 1 a gym (3a-iii) · 256 MB |
| a grid's cells · characters, all sheets | 1,002,000 · 5,242,880 |
| a tag in an Excel part | 64 KiB |
| a staged upload lives | 60 minutes |
| upload | 12 an hour a person, 40 an address (`ipMax` explicit: a front desk shares one) |
| confirm | 30 an hour a person, 120 an address |
| type one in, take one off | 120 an hour a person, 600 an address |
| remove the unlisted | 10 an hour a person, 40 an address |

The builder measures a 10,000-row, 30-column file (time, peak memory) and pastes it.
**Measured 2026-09-19 (3a-i)**, files saved by Excel 16 with invented people, through
`parseMemberFile`, the worker's modules already transpiled once, on Node 22.23.2
(production's), three runs after round one's fixes (the tag check reads every tag):
`.xlsx` 1.68 MiB (its XML parts 15.07 MiB inflated) — 1,403–1,589 ms, the whole
process's peak RSS 133 → 235 MB; CSV UTF-8 3.10 MiB — 608–908 ms, 134 → 171 MB. The
request thread's longest stall was 19–24 ms (one more Zod pass of the reply: 39–49 ms).
**Measured 2026-09-20 (3a-ii)**, the same size of file read AND understood in the
worker, three runs on Node 22.23.2 after round one's fixes: 1,326–1,472 ms all told,
the request thread's longest stall 11–15 ms, its RSS 97 → 136 MB and the process's peak
201–234 MB. Understanding the grid is 559–634 ms of that, which is why it runs there
(§9.5).

Refusals are the SERVER'S sentences and a screen prints them as sent; each says the fix:
`empty_file` · `too_big` ("…over 5 MB. Save just the member sheet as CSV and try
again.") · `old_excel_or_password` ("This is an older Office file, such as an .xls, or
a file with a password, which we can't open. In Excel choose File → Save As → Excel
Workbook (.xlsx), with no password, or save it as CSV.") · `pdf` · `other_zip` ·
`not_a_spreadsheet` · `unsafe_archive` ("This file is built in a way we can't open
safely. If it is an Excel file, open it in Excel, save a fresh copy as .xlsx, and
upload that.") · `web_page_or_xml` ·
`unreadable_excel` · `unreadable_text` · `unterminated_quote` · `too_many_rows` ·
`too_many_columns` · `no_rows` · `parse_timeout` · `too_complex` ("This file is too
large or complex to read. Save just the member sheet as CSV and upload that.") ·
`busy` · `mapped_column_not_status` (3a-ii: the column staff chose as the status holds more than 20 different words) · `list_changed` · `large_change` · `upload_expired` · `upload_superseded`.
`other_zip` names OpenDocument, Apple's Numbers, Pages or Keynote, or Excel Binary
where the archive says so, with that program's own way to save as `.xlsx` or CSV.
**Every sentence is true of every file that draws it** (review of PR #85): the server
never sees a file's name, so no sentence speaks of one, and one mark in the bytes can
belong to several programs (a compound file is also an old Word file; `Index/
Document.iwa` is also Pages and Keynote; `mimetype` + `content.xml` is any
OpenDocument file). A file with no email and no phone column is NOT refused: it
answers `needsMapping: true` with its columns and samples.

**Never logged, never in an error reply, never in Sentry:** a cell, a name, an
address, a number, the body. Logs carry ids, counts and codes.

### 9.10 Tests, and what the reviewer RUNS

*Fixtures* in `apps/api/test/fixtures/member-list/`, every person invented: real Excel
files made here by COM automation (Excel 16 is installed: `.xlsx`, CSV UTF-8, CSV
comma, Unicode Text, CSV Macintosh, CSV MS-DOS — accented, Polish and Devanagari names,
phones as text and as numbers, leading zeros, a 16-digit id) · a Google Sheets `.xlsx`
and `.csv` (Kd imported the Excel book into Google Sheets and downloaded both,
2026-09-19; Google's `.xlsx` writes every part with a data descriptor, so it is also
the real streaming-writer file `openpyxl` was to give — not installed here — beside
one built in the test) · hand-written
text: `;` and TAB and `|`, `sep=`, quoted line breaks, a title block above the header,
a totals row, a blank row mid-file, no header row, one column of emails. *Bombs are
built in the test, never committed:* a lying size, a 1,000:1 deflate, overlapping
entries, ZIP64, an encrypted entry, 1,001 entries, a `<!DOCTYPE`, junk before the
archive, a name with `..`.

*Table tests written BEFORE review* (CLAUDE.md §4): the phone table (the 52 measured
vectors of 2026-09-19, plus `447911123456` in GB and every spreadsheet-damage row) ·
header words and the two never-lists · several email and phone columns · the header
row · the status column (the gym's own words kept, case grouped, yes/no under
"Active", 21 different values refused, "Payment status" and "Email status" never
taken) · the decoding ladder · the delimiter rule · the CSV state machine ·
placeholders · identity keys (a status change is NOT a new person) · `reconcile` over
every class: email verified and not, case, phone only, staff, owner, complimentary,
removed, two gyms, a shared family email, listed → dropped → back, never listed, a gym
with no list, a status that changed, `add` mode (nobody goes, nobody is flagged) · the
guard at its edges (10, 11, 10 %, one over; never in `add` mode).

*Wiring, each with the named break that must turn it red:* the real worker is spawned
once per kind · two confirms at once (one applies, both 200, rows written once) · a
confirm after a typed person (409) · a superseded and an expired upload · the same
file twice (no row's `xmin` moves, the version does not) · a join racing a confirm ·
a confirm emails nobody (the capturing sender stays empty) · a status change updates
the row in place · "put on the list" with another gym's member (404) ·
every route: the happy path, a validation failure, a stranger, another gym's staff
with this gym's ids, a trainer, a gym with no plan · the rate limit at ONE fixed
address with several staff · the real Sentry SDK with a recording transport and a
forced fault on the upload route: no body, no cell · a log capture holding a sentinel
address from the fixture: never present · the archive sweep and the expiry job with an
injected clock · `db.migration.test.ts` reads each new CHECK back against the shared
constants.

*The reviewer runs:* the bombs and the real exports through the live route on local
Postgres and the real Redis, several gyms and staff; the mutation harness on the
reconcile rule and on remove-unlisted (other people's data).

### 9.11 Known limits, written down so nobody finds them by surprise

Legacy `.xls` and password-protected workbooks are refused with the fix in the words
(the package reads `.xlsx` only) · so are OpenDocument, Apple Numbers, Excel Binary and
a web page or Excel 2003 XML named `.xls`; CSV (any of the four delimiters, or
tab-separated text) and `.xlsx` are the formats, as Kd confirmed on 2026-09-19 · a
workbook whose XML passes 25 MiB is refused `too_complex` (Excel's own 10,000 × 30 is
15 MiB) · a CSV saved as "CSV (MS-DOS)" is warned about, not
decoded · hidden rows ARE read, with a warning · a 12-digit phone saved to CSV from a
General cell is unrecoverable and is said so · Gmail dots and `+tags`, Argentina,
Mexico and Brazil's old mobiles do not match · a number range newer than the phone
package's metadata counts as "unusual" and still matches itself · a file with no
status column has no status filter, and a status is never worked out from an expiry
date (day-first and month-first dates cannot be told apart safely) — the gym filters in
its own software before exporting.

**Not part of the member list, and built later:** fees, plans, renewal and expiry
dates, payments, reminders to pay. Kd ruled on 2026-09-19 that the app WILL be a gym
management app and that the management features are built later (ROADMAP Stage 2 item
15); the member list is its first piece — who the members are — and holds none of the
rest. Until item 15 is built those columns of a gym's file are not kept, so a gym that
moves to the app keeps its own export to load them from then.

### 9.12 The invites (3b) — the frame; its own plan settles the rest with Kd

**Who is emailed, and when** (RULINGS 2026-09-19: *"they send a invite click invite
button and a message is send to the members via email with join link"*). Nothing is
sent by a confirm. Staff press **Invite** — for everyone, or for the status words they
ticked ("Active", "Pending") — and the button says the number before it sends:
`POST /v1/orgs/:gymId/member-list/invites` `{ statuses?: string[], version,
expectedCount }` (`members.confirm`, a gym on a plan; a different version or count →
409 and nothing is queued). It queues every entry in that group that has an email, is
not in the app, has no invite record for this gym and no suppression, and answers how
many were queued and how many were skipped for each reason. Adding one person by hand
offers "Add and invite" (the same call for that one entry). **One email per person per
gym, ever; no reminders and no bulk "send again"** — in *Perkins v. LinkedIn* (N.D.
Cal. 2014, about $13M) the invitation was consented to and the two reminders were not.
Whether staff may re-send to ONE person who asks is 3b's plan to put to Kd.

**Records.** `gym_invites`, keyed `(gym_id, email_hmac)` — HMAC-SHA256 of the
lower-cased address under a server secret. It outlives the list entry, so a broken
export followed by a good one cannot email anyone twice; Resend's own
`Idempotency-Key` lasts 24 hours and is only the retry guard (the invite's id).
`email_suppressions (email_hmac, gym_id NULL = every gym, reason)`: an unsubscribe or
a complaint is for THAT gym, a hard bounce for every gym (Amazon SES's documented
multi-tenant pattern; Resend's own list is account-wide and cannot say "this gym
only"). Suppress rather than delete, and keep no more than the hash (ICO).

**Sending.** A queue job in the worker, never inside the request. Before each send:
the address rule, a cached MX lookup for the domain, RFC 2142 role addresses
(`info@`, `admin@`, `sales@`, `support@` …) skipped, suppressions, "already in the
app". A gym's first 50 go and the rest wait for their results; a daily cap per gym,
tighter for a gym on trial (whose member cap is 300 anyway); a gym stops at 2 % hard
bounces once 50 have gone, or on any complaint in its first 100; one cap for the whole
platform (`INVITE_EMAILS_PER_DAY`, beside `CODE_EMAILS_PER_DAY`) and a kill switch; a
gym the breaker stopped goes on Kd's "have a look" list (Stage 3 item 2e).

**Abuse, named.** Anyone can make a gym and upload strangers' addresses; without care
our domain is a spam and phishing relay. So the message is FIXED; the only words a gym
writes into it are its name and city, stripped of links, `@` and control characters
and cut at 60; every link goes to our own domain; trial gyms are capped as above.

**The message.** Subject "You're a member of {gym} — get the app" (RULINGS). It says
who sent it and why. The join link is `{WEB_ORIGIN}/join/{slug}` and is NOT a
credential: joining needs a sign-in with that same address (a code or Google proves
it), so a forwarded email admits nobody. Footer: "Sent by {app} on behalf of {gym}",
the GYM's postal address, the unsubscribe link. Both `List-Unsubscribe` headers (RFC
8058); the POST takes no cookie, no login and no redirect, accepts
`multipart/form-data` and `application/x-www-form-urlencoded`, and answers a blank
200; GET shows a page; the token is an HMAC, opaque; honoured at once; the link works
for at least 60 days (CASL's figure covers the rest). Open and click tracking stay off
(Resend's default): the join link is never rewritten. The gym's postal address has no
column today (`gyms.city` only): 3b adds the Settings field, and a gym without one
cannot send.

**The webhook.** `POST /v1/webhooks/resend`: Svix signature over the RAW body
(`svix-id.svix-timestamp.body`, HMAC-SHA256, the secret base64 after `whsec_`, a
5-minute window, constant-time compare) → dedupe by `svix-id` → 2xx → the worker
updates the invite. `email.bounced` (permanent) → suppressed for every gym;
`email.complained` → suppressed for that gym, and its breaker.

**Joining.** A person signed in with a VERIFIED address that an active, on-a-plan gym
has INVITED (an invite record for that gym and address — being on the list is not
enough: a gym that invited only its "Active" members has not said yes to the rest)
joins through `claimSeat` (the seat cap holds). An unsubscribe stops emails, never the
join. Everyone else joins with the code (9.13) and is matched to the list all the
same. One tap or none is Kd's (ROADMAP). Recommended: ONE tap, on a screen showing
"What {gym} can see" — joining starts sharing a person's activity with the gym, and
nobody should start sharing because a third party typed their address.

**"Staff create his account" (Kd, 2026-09-19), as built.** Staff add the walk-in's
name and email and press "Add and invite". The account itself comes into being when
HE signs in with that address — the app has no passwords, an account is made by
proving an address (RULINGS 2026-09-07), and only he can tap the health and consent
screens — and the moment he does, he is in that gym with no code. A walk-in with no
email is added with a phone and joins with the gym's code; the phone puts him on the
list.

**The email provider's limits, and the standard answer to them.** Resend's Acceptable
Use Policy (read 2026-09-19; last updated 2026-08-27): "Your complaint rate must be
lower than 0.08%"; "Your bounce rate must be lower than 4%"; "your account may be shut
down without warning". Sign-in codes go out through the same account. What every app
that sends invites does about this, and ALL this plan does (RULINGS 2026-09-19 — Kd
refused a second account and asking the provider's permission as invented and
uncertain; they are struck): (a) invites go out from a sub-domain of their own
(ROADMAP 3b; Resend's own advice for keeping one kind of mail from hurting another);
(b) the automatic hygiene under "Sending" above — addresses checked first, small
batches, a gym stopped when its bounces pass 2 %, a dead address never emailed twice,
one-click unsubscribe — which is what keeps the account under those limits; (c) the
join link can also be copied and shared by the gym itself, as §4.3's Invite sheet
already has (the code, QR, WhatsApp share). If the account were ever closed all the
same, sign-in codes stop until the key and the sending domain are moved to another
provider; the email sender already sits behind one seam (`EmailTransport`,
`email/resend.ts`), so that is a settings change, not a rebuild. The gym's tick at
upload that it may share its list (9.14) stays. Prices read 2026-09-19: Resend free
3,000 a month and 100 a day, Pro $20 for 50,000; 10 requests a second a team; a batch
call takes 100.

**The law, for the lawyer review (Stage 4 item 3) — research, not advice.** US
CAN-SPAM: this is a commercial message (16 CFR 316.3's subject-line test) — a postal
address, opt-out within 10 business days, up to $53,088 an email; the gym named in
From is the sender, we are the initiator. Canada CASL: consent is implied during a
membership and two years after; BOTH parties named, a mailing address, unsubscribe
within 10 business days. UK and EU: only the GYM can rely on the soft opt-in (PECR
reg 22(3)); we send as its processor — an Art 28 agreement with each gym, standard
contractual clauses for EU → India. Australia and New Zealand: name the authorising
business; unsubscribe within 5 working days. India: no anti-spam law for email; DPDP
processor duties from about 2027-05-13. Brazil: LGPD legitimate interest with the
right to object. Gmail counts its 5,000-a-day bulk line across the whole primary
domain, so a sub-domain does not split it; Gmail and Yahoo want SPF, DKIM, DMARC and
one-click unsubscribe for this kind of mail.

### 9.13 The code admits at once (3c) — the frame

A valid code → `claimSeat` under the gym's row lock → a member at once;
`last_listed_at` stamped if they are on the list. "Not on your list yet" is shown TO
THE GYM ONLY: no member-facing reply ever carries a list state, which is what keeps
the phone question from telling anyone whose number a gym holds. After joining: "Your
phone number, as {gym} has it" (optional) → `PUT /v1/orgs/:gymId/membership/phone` →
read like a list phone but accepted at `isPossible()`, stored in `stated_phone_e164`;
the same reply and the same timing whether or not it matches; 5 changes a day a
person with an explicit `ipMax` (a gym's members share its wi-fi); never logged. No
application is created any more; the waiting room's sweep, reminders and nudge are
switched off in the worker, not deleted (production starts empty, so no row needs
moving). The join door, setup's code screen and My Gyms say "You're in". What a FULL
gym's door does is Kd's (ROADMAP), and 3b's join meets the same wall.

### 9.14 The screen (item 5) — the frame

Members gains **Member list**. Upload — or **paste rows copied from a spreadsheet**
into a box, for a gym that would rather not save a file (Kd, 2026-09-20; Mailchimp's
other way in). A paste needs nothing new on the server: what a spreadsheet puts on the
clipboard is tab-separated text, which 3a-i's reader already opens, so the pasted text
is sent as the upload's bytes and everything after it — the preview, the confirm, the
guard — is the one path. Then → the preview, PHONE-FIRST (RULINGS 2026-08-18:
a tappable list of problems, never a thousand-row grid): the counts in words, each
opening its names; every column with its samples and a dropdown to correct the guess;
the warnings; for a large change, the numbers and a typed confirmation; the tick that
the gym may share this list (words: Kd and the lawyer); "this is my whole list" or
"add these people"; Confirm. Then the result line: "12 new · 3 no longer on your list
— remove all? · 2 joined by code, not on your list" (ROADMAP's line said "12 new,
invited"; since RULINGS 2026-09-19 nothing is sent by a confirm) — remove-all shows
the names, then asks. **The list itself:** the gym's own status words as filter chips
with their counts ("Active 312 · Expired 88 · no status 5"), a filter for in the app /
not in the app, search, and ONE **Invite** button that always says who it will reach
("Invite 214 people" — those shown who have an email, are not in the app and were
never invited) and says afterwards who was skipped and why. Add a person ("Add" · "Add
and invite"), change one, take one off; on an app member who is not on the list, "Put
on the list". A gym that would rather send the invite itself gets the same words and
join link to copy. Each member row says on the list · no longer · never (only once a
list exists), with last active and streak. **CSV export:** a name or any free
text starting `= + - @`, TAB, CR, LF or full-width `＝＋－＠` gets a TAB inside the
quoted field (OWASP's advice since 2026-01: Excel strips an apostrophe when the file
is saved again); email and E.164 phone columns are shapes the server checked and are
written as they are (a blanket rule breaks `+44…`, and `-10` → `10` is a documented
casualty elsewhere); a save-and-reopen test. Members are told when confirmed or
removed, as a removal tells them today.

### 9.15 Where the facts came from (read or measured 2026-09-19)

Measured here: Excel 16's six export formats · `read-excel-file` 9.3.10 on a real
workbook and on two built bombs · `zlib`'s `maxOutputLength` and `crc32` · the
`TextDecoder` labels (`ibm850` is NOT supported) · a `.ts` worker under tsx and
vitest · `libphonenumber-js` 1.13.13, 52 vectors. Read: Okta import safeguard
(help.okta.com, `usgp-import-safeguard`, `usgp-safeguard-threshold`) · Microsoft Entra
"prevent accidental deletes" · Terraform's stale-plan check (`backend_local.go`) ·
Segment identity resolution settings · HubSpot import de-duplication · OWASP CSV
Injection (community.owasp.org) · D. Fifield, "A better zip bomb" (WOOT '19) · Apache
POI `ZipSecureFile` · Papa Parse's delimiter guess (its source) · RFC 4180 · RFC 8058 ·
resend.com `legal/acceptable-use`, `pricing`, rate limit, webhooks, suppressions,
unsubscribe for transactional email · Svix payload verification · Gmail and Yahoo
sender rules · FTC CAN-SPAM guide and 16 CFR 316 · CASL and SOR/2012-36 · ICO on
direct marketing and the soft opt-in · ACMA spam rules · AWS SES tenant-level
suppression and reputation thresholds · *Perkins v. LinkedIn* · Google's libphonenumber
FAQ. No primary source was found for: what Google Sheets writes, any Indian or
Brazilian gym product's export headers, how common Mac Roman or DOS files are.


Database DDL & Mongo→PG migration** (now carrying: §2.1 columns, Part 2B's
`calc_version`/dishware/corrections tables, Part 2's definition tables,
and the two catalog decisions — Mountain Pose & Brisk Walking) · Part 5 —
Billing & webhooks (+ Micro-tier pricing ratification) · Part 6 — Mobile ·
Part 7 — Retention playbook · Part 8 — Ops runbook.*
