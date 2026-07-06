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

*— End of Part 3. Remaining queue (v1 §23, one at a time): **Part 4 —
Database DDL & Mongo→PG migration** (now carrying: §2.1 columns, Part 2B's
`calc_version`/dishware/corrections tables, Part 2's definition tables,
and the two catalog decisions — Mountain Pose & Brisk Walking) · Part 5 —
Billing & webhooks (+ Micro-tier pricing ratification) · Part 6 — Mobile ·
Part 7 — Retention playbook · Part 8 — Ops runbook.*
