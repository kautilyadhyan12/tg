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
4. **(2026-09-21) The console is the browser's alone, and join codes are abandoned**
(RULINGS 2026-09-21; the design is §10). The member app is the phone's alone: this
console is never built into it, and it must work in a PHONE's browser as well as a
computer's. Every mention in this Part of a join code, a poster or a QR that joins —
§2.2's "Invite (share code / print poster)" and "Create / rotate / expire codes",
§4.0's first code, §4.3's Invite sheet, §4.7's **Codes**, §9.13 — is superseded by
§10: a person comes into an organisation only by an invitation to their email
address. Staff are invited the same way (§10.3) and a seat is counted as §10.4 says.

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
| Members list + detail | ✔ | ✔ | ✔ (every type since 2026-10-10, ROADMAP 4e: a studio's coach reads the people in the app as a gym's trainer does: a name, the join date, the group, whether their place is free and whether it is one of the paid places; the owner's ticks decide the rest) |
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
| Trainer scoping to group | not built, and not the rule since 2026-10-10 (ROADMAP 4e): a trainer or coach with the tick reads everyone in the app, in every type |||
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

**The menu as built, and the look of every page: §17** (2026-09-26).

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
{org}"; rate-limit 1/member/7d). Empty:
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

*(23b's notes, 2026-10-07; RULINGS that day. The five boxes above were never built: the
logo, the poster and the report do not exist, and join codes are off.)* **What is built is
a "Start here" list, first on Overview**, of what a new gym sets up, each line a button
that opens the page where it is done:

| Step | Its button opens | Ticked while the gym has | Shown to staff holding |
|---|---|---|---|
| What you sell | Memberships (its own page since 23c-i) | a membership type that is not archived | `memberships.manage` |
| Bring your members in | Members, with Import or Add open | a person on its list | `members.confirm` |
| Invite your staff | Members → Staff, the Invite staff form open (since 23c-ii) | somebody on the staff besides the owner, or an invitation still waiting | `staff.manage` |
| Add your classes | Classes | a class with a time slot, neither cancelled, past its last day nor archived | `schedule.manage` |
| Opening hours | Settings, When we're open, open | its hours said (a week, always open, or closed every day) | `org.manage` |
| How members reach you (20a-iii) | Settings, How members reach you, open | a phone number or an email address for its members | `org.manage` |
| Front desk check-in | Settings, Check-in devices open | a device that opened its link and is not switched off | `org.manage` |

- **The server works every tick out from the gym's own rows** each time Overview opens
  (`GET /v1/orgs/:gymId/start-here`); nobody ticks anything, and a tick goes when its
  thing goes. The ticks are the gym's, the same for everybody; a member of staff is sent
  only the steps their own ticks let them do, and the count is out of those.
- **Hide this list** is for whoever holds `org.manage`, for the whole gym, on a gym with a
  live plan (`PUT`, `gyms.activation.startHereHidden`); **Show the Start here list** at the
  foot of Overview brings it back. With every step done the box says so until it is hidden;
  staff who cannot hide it stop seeing it once their own steps are done.
- While the list shows "Bring your members in", the card of that name is not drawn a second
  time under it; hidden, unreadable, or for somebody with no step, Overview is as it was.

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
   nothing in 3a, blocks nothing ever, and removes nobody by itself. *(2026-09-21: join
   codes are abandoned, so the way IN is now the gym's invitation, §10.2. What this
   principle still means: a status word, a later upload or dropping off the list never
   blocks or removes anybody by itself — the INVITE is the gym's yes, the list is not.)*
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
7. ~~**Keep only what a screen reads**: name, email, phone, member number, status. Every
   other column is dropped in memory, never stored, never logged.~~ **REVERSED
   2026-09-21 (RULINGS; §11): keep what the gym gave us, minus the never-keep list** —
   ten standard fields and the gym's own extra columns. What stands: a never-keep
   column is dropped in the worker, never stored, never logged; and the file itself is
   never stored.
8. **Nothing in the file is believed**: not its name, type, declared sizes or encoding.
9. **Destructive steps carry a guard** sized to the gym (9.8), and an explicit
   acknowledgement for that one action — never a setting.
10. **Nobody is emailed until staff press Invite** (RULINGS 2026-09-19). A confirm
    sends nothing. The status word only chooses who is INVITED; it never decides who
    may join (RULINGS 2026-08-24, reaffirmed 2026-09-17: an upload is days old).
11. **The gym's invite is its yes.** Signing in with an address joins a person only
    where the gym invited that address. ~~Everyone else uses the code.~~ *(2026-09-21:
    there is no code; everyone else asks the front desk to add their email, §10.2.)*

### 9.3 Slices — one chat and one pull request each

| Slice | What lands | Packages | Model |
|---|---|---|---|
| 3a-i | Opening a file safely: type sniff, safe unzip and re-pack, the parse worker, CSV decoding and parsing → a grid of text cells. No database, no route. | `read-excel-file` | Opus xhigh |
| 3a-ii | Understanding the grid: header row, column guesses, cleaning of name, email, phone, member number and status, placeholders, duplicates → rows and plain-word problems; `tools/read-member-file.ts`. No database, no route. | `libphonenumber-js` | Opus xhigh |
| 3a-iii-a | The list on the server, half one: the migration, the reconcile rule, upload (whole list, or add) → preview, the names behind every number, the hourly expiry, the list going when a gym closes. It writes ONE staged row and changes nothing about anybody's membership. | — | Opus xhigh |
| 3a-iii-b | Half two: press Confirm — the one transaction that writes the list, the wrong-file guard, and the reads with the status filter. | — | Opus xhigh |
| 3a-iv | Keeping the list by hand: add one person, change one, take one off, put an app member on the list, remove the unlisted in one call (with its guard). | — | Opus xhigh |
| 3b-i | The invites, sent when staff press Invite (9.12): the records, the queue, the checks before a send, the webhook, unsubscribe. | — | Opus xhigh |
| 3b-ii | Joining by invitation (9.12 "Joining", 10.2): the invitation waiting after sign-in, ONE tap, `claimSeat`; one person's invitation sent again. | — | Opus xhigh |
| ~~3c~~ | ~~The code admits at once (9.13).~~ **Struck 2026-09-21**; its number now carries "codes switched off" (10.6). | — | Opus xhigh |
| 5 | The screen (9.14), in two pull requests: 5a upload, preview, confirm · 5b the list, Invite, by hand, export. | — | Opus xhigh |
| 4a | Staff invited by email (10.3). | — | Opus xhigh |
| 4c | A seat is a person using the member app (10.4). | — | Opus xhigh |

**Split 2026-09-20, building 3a-iii** (the chat's own sizing call, CLAUDE.md §2.3): one chat for one migration, six routes, the guard and 9.10's whole test matrix was too much, and the honest cut is between the half that decides nothing and the half that changes a gym's records. The two are built back to back.

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

**AMENDED 2026-09-20, third time: whose email gets invited** (Kd asked, after the round
closed, whether anything here is still wrong, "because this is the most critical feature
of the application"). Two real faults were found by running realistic headings through
the reader, and both would have sent an invitation to somebody who is not a member —
which, because the gym's invite is its yes (§9.2 rule 11), would have joined that person
to the gym:
- **`Nominee Email` outranked `Email`** and became the column every member was invited
  at, because the ranking read the WORD matched and not the heading. Now a heading that
  IS its word beats one that merely HOLDS it, whatever the other word is — which holds
  even for a qualifier no list has ever heard of (`Zzyzx Email` ranks after `Email`).
- **25 of 37 headings naming somebody who is not the member read as the member's own**:
  nominee, father, mother, husband, wife, son, daughter, brother, sister, relative,
  family member, friend, guarantor, sponsor, reference, witness, attendant, caretaker,
  carer, doctor, physician, physio, therapist, agent, broker, manager, contact person,
  corporate, kin. All are on the never-list now; 0 of 37 are read as the member's. A
  column refused this way is still shown with `headerSays`, so a gym that really does
  keep members under one of those words maps it by hand.

**AMENDED 2026-09-20, fourth time: a card number we must not keep.** Gym software
calls a member's door fob a "card number", which is why that heading reads as a
member number — but an export whose "Card Number" is a BANK card must not leave its
digits here. A value shaped like a payment card (13–19 digits) AND carrying a card's
check digit (Luhn) is dropped: the person keeps their name, email and phone, and the
list holds nothing worth stealing. Measured: our own 16-digit fixture member number
is not card-shaped and survives. Heading words added the same day from 37 real
headings — `tel`, `contact no`, `membership no`, `client number`, `customer number`;
`account number` and other bank-sounding words are deliberately NOT read.

**Several gyms at once (measured 2026-09-20, Node 22.23.2)**: the biggest file allowed
uploaded by 1, 2, 3 and 5 gyms at the same moment — two are read, the rest answer
`busy` ("Other files are being read right now. Try again in a minute."), nothing
crosses between gyms, the request thread stalls at most 54 ms and the process stays
at 123–134 MB. The cap is what keeps the server standing; more gyms means more
capacity, not a bigger cap on one box.

**Known limit, written down rather than patched**: where the ONLY address column in a
file belongs to somebody else under a word no list has ("Buddy Email"), it is read as
the member's. No list can be complete. What closes it is the preview: nobody is
emailed until staff press Invite (§9.2 rule 10), and the column's heading, its
`headerSays` and three of its own cells are on that screen. Item 5 (§9.14) is
accepted only if staff can see WHOSE address is about to be invited.
**ENGLISH ONLY (Kd, RULINGS 2026-09-20).** The heading words are English; the German,
French, Spanish, Portuguese, Dutch and Italian words 3a-ii shipped with are struck. A
file whose headings are in another language is not refused and nothing of it is guessed
wrong — its columns come back unmapped for staff to map. This is about the file's
HEADINGS, not its people: a member called José Álvarez or Zoë Müller is read, matched
and invited like anyone else, and every country's phone numbers are still read.

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

**Out of 3a-iii-a (built 2026-09-20).** Migration `0033`, forward-only, exactly the three tables and the two membership columns above. Four things the shipped shape settles:

- **`rows` holds the WHOLE understanding of the file, not only the cleaned rows** — wider than this section's column name suggests, on purpose. Everything a file's own cells can reach goes in one place and leaves in one statement: the rows, the columns with three of their cells each, the warnings (two of which quote a cell's words — a shared front-desk address, an ignored sheet's name) and the file's own facts. Split across two columns, the day somebody adds a field to one of them is the day a member's address outlives the file it came from, and nothing would say so. `summary` keeps counts, and the gym's own status words, which say nothing about any one person and are what make a confirmed upload's record readable.
- **A CHECK, not a promise: `status = 'staged' OR rows IS NULL`.** "This upload is finished with and is still holding a member's name, address and phone number" is a state no screen would ever show and nothing else in the system would notice, including a hand-run statement during an incident. `(status = 'confirmed') = (confirmed_at IS NOT NULL)` is there for the same reason.
- **`expires_at` has no DEFAULT.** The expiry job and its tests drive an injectable clock; `now() + interval` would be a second clock in the database that no test can move.
- **`gym_members.stated_phone_e164` carries the same CHECK as an entry's phone** — `MEMBER_LIST_PHONE_E164` in `@app/shared`, read back against the code's own pattern by `db.migration.test.ts`. Matching compares the two columns directly, so a number stored one way here and another way there would match nobody and nothing would say why.

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

**Out of 3a-iii-a (built 2026-09-20).** `reconcile({ rows, entries, members, mode, hasList })` in `apps/api/src/modules/orgs/memberList/reconcile.ts`. Pure: no clock, no database, no randomness — `everListed` arrives as a boolean rather than a date, because the rule needs to know that a member was once listed and never when. Five things the shipped rule settles:

- **The list to measure against is DERIVED, so `add` mode takes nobody off without a branch saying so.** A whole-list upload's new list is the file; an add's is the file plus everybody already on the list. Every "would this member still be listed" question is asked of that, so `leaving` is empty in `add` mode as a consequence rather than as an exception a later edit could drop.
- **THE SAME RULE ANSWERS "WHAT DOES THE LIST SAY TODAY".** Called with no rows and in `add` mode, the list to measure against is the stored list itself: nothing is new, changed, unchanged or gone, and every member's mark is what the console should print beside them now. That is what 3a-iii-b's read-back calls, so the marks cannot come from a second query with a second opinion.
- **A status word is compared with its case and spaces folded**, so two exports of one gym writing "Active" and "ACTIVE" are `unchanged` and nobody reads five hundred false changes. The word STORED is still the gym's own. The word SHOWN in the per-status counts is the one the FILE wrote first, in the file's own row order — found by a deliberate break: taking it as the groups are counted (new before changed) read back a word the gym never wrote at the top of its own list.
- **`leaving` is "on the list now and not on the new one", never "not on the new one".** A member who dropped off months ago is already `no_longer_listed`; counting them as leaving again would put them in the wrong-file guard's numbers for every upload for ever.
- **A member is matched to an ENTRY, not merely to the list**, so a family sharing one address is answered correctly: the kid's entry can come off while the member on the same address stays `on_list`, because the file still holds that address.

**Out of 3a-iii-b (built 2026-09-21).** `POST /uploads/:uploadId/confirm` is the one transaction that writes a gym's list, and everything below it was settled by building it.

- **THE PREVIEW IS WHAT STAFF READ; IT IS NEVER WHAT IS APPLIED.** The rule runs AGAIN under the gym's row lock, over the three sets read inside that transaction, and the confirm writes THAT answer — which is also what the upload's `summary` is overwritten with, so pressing Confirm a second time reads back what the first press did rather than a stale story about the same file. The stored grouping from the staging is not used by the confirm at all: it is the answer for a list at `base_version`, and although the version says the list has not moved, the gym's own MEMBERS have no version — somebody joined, proved an address or left while the preview was on the screen.
- **EVERY STATEMENT INSIDE THE TRANSACTION USES `tx`, AND THAT IS NOT A STYLE POINT.** A query sent on the pool runs on another connection, outside the transaction and its lock (the pool was ONE connection until ROADMAP Stage 4 item 11, when such a query stopped the whole API). `measure` therefore takes an executor rather than `deps`, which is also what makes the rule's three sets the ones the lock is holding still.
- **A REFUSAL COMMITS NOTHING BECAUSE IT WRITES NOTHING.** `list_changed` and `large_change` return before the first write, and both carry NUMBERS rather than a sentence alone: a screen cannot ask staff to tick a large change without showing what would go, and "somebody changed your list" without the two version numbers is a dead end for whoever is standing at the desk. Neither says anything about a person — a version is the gym's own list's, and the guard is counts.
- **THE TICK BELONGS TO THE REQUEST AND IS NEVER STORED.** A gym that acknowledged a large change a moment ago has acknowledged nothing about this press, so pressing again without it is refused again — driven, because a flag written on the upload would have passed a test that only pressed twice with the tick.
- **WHAT EACH STATEMENT DID IS CHECKED AGAINST WHAT THE RULE SAID IT WOULD.** Under this lock they cannot differ, so a difference is a fault of ours and the confirm rolls back rather than reporting a number that is not what happened. It costs nothing: the three `RETURNING` clauses are already there.
- **`last_listed_at` IS STAMPED ON THE UNION OF THE OLD LIST AND THE NEW ONE, and each half earns its place.** Without the new list's people nobody is ever stamped; without the OLD list's, a member taken off today reads as "never listed" tomorrow and the gym is told it never had somebody it has just removed. The rule answers it (`onEitherList`) OUTSIDE its `hasList` gate, which is the case a gym's very first confirm is: no marks to print, and two hundred people to stamp.
- **THE VERSION MOVES ONLY WHEN SOMETHING CHANGED**, but `last_confirmed_at` and `last_confirmed_upload_id` move either way — the gym DID confirm this file, and which file the list came from is what next month's mapping is remembered from (§9.5). The same file twice is exactly the case where nothing changed, and bumping the version would throw away every other preview open in that gym for no reason.
- **Reachable today, and it is a race and not a hypothetical:** `list_changed` needs the version to move while an upload is still staged. An upload reads the list's version, spends a second in the worker reading the file, and a confirm of an EARLIER upload lands in between — the second upload is then staged against a version that is already gone. 3a-iv's typed-in person is the other door.

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

**Out of 3a-iii-a (built 2026-09-20).** The three read/stage routes above are live; the confirm and the two list reads are 3a-iii-b's. Four things the shipped routes settle:

- **THE RATE LIMITER IS CALLED FROM INSIDE THE HANDLER, AFTER THE PRIVILEGE GATE**, which is CLAUDE.md §4's order and against this module's habit of hanging a limiter on the route (which puts it first). A stranger's 404 and a trainer's 403 must not spend the front desk's own allowance, and reading a file costs a worker, 5 MiB and up to fifteen seconds, so the cheap refusals belong in front of the limiter as well as in front of the work. The service takes the limiter as an argument and answers null when it has replied 429 itself.
- **`ipMax` is explicit on both limiters** (12 an hour a person and 40 an address for an upload; 600 and 2,000 for a read). A gym's front desk is one address with several staff signed in, and a per-address ceiling equal to the per-person one throttles the second person to touch the screen. A test drives it at ONE fixed address.
- **One file per gym at a time is a Redis counter**, the same primitive the rate limiters use, with a window of the parse timeout plus a second so a reader that dies without releasing its place cannot lock a gym out for longer than a file could have taken. Redis down fails OPEN, loudly, as the rate limiters do: the per-process ceiling of two still stands, and refusing every gym's upload because a cache blinked is the worse answer.
- **A preview past its own hour is answered as expired by the clock**, whether or not the hourly job has run, so nothing correct waits for a sweep. What a re-read serves is set out below: the file-versus-list half from the store while the list has not moved, every member fact worked out again.

**A PAGE OF NAMES DOES NOT COST THE WHOLE FILE, and the first version of this slice got that wrong.** It worked the whole comparison out again for every page: fetch every row, parse every row, fetch every person already on the list, run the rule, keep a hundred. The cost was the same whichever page it was, so §9.5's promise — 3a-ii moved the file READ into a worker precisely to keep the request thread's block to 14–15 ms — was broken by the paging route, the cheapest-looking one. Measured then on a 10,000-person gym: 121 ms blocked for one page, about twelve seconds in total to walk the list.

**What ships instead.** The FILE-versus-LIST grouping is worked out ONCE when the file is staged and stored beside the rows (`memberListGroupsSchema`); a page is a hundred rows cut out of the document by the database (`repo.stagedPage`). It is not a cache that can be wrong: the stored answer is the answer for the list at `base_version`, and a preview whose gym has moved its list since is worked out again from the rows — the expensive path, now the rare one.

**But NOTHING ABOUT ONE OF THE GYM'S OWN MEMBERS IS EVER STORED** (review of PR #87, High-1 and High-2), and this is the load-bearing half of the design. Whether somebody is already in the app, how many seats are used, which members would be marked as having dropped off, and who those members are — all of it moves when a member joins, proves an address, gives the gym a number or leaves, and NONE of that touches the gym's list, so the list's version cannot say when it is stale. Stored, staff read "Amara Okafor, not in the app" for the preview's whole hour after Amara signed up, and were offered an invite for somebody already here; and a leaving member's own name, PROVED address and phone number sat in a table the Day-14 purge does not touch. So every member fact is worked out again on every read, from two small statements (`repo.stagedContacts`, `repo.membersAgainstList`) through the same pure rule the stage used (`membersAgainstNewList`). Computing it every time cannot go stale by construction, which a longer freshness check could not promise.

**Measured 2026-09-21 as §4's "cost at full size" rule asks, through the real HTTP server, at the processor's full 2,592 MHz, two runs at each size** — because the API's Postgres pool is ONE connection (`app.ts`), so a request waiting on the database is also a request nothing else gets past, and the event loop alone would be the flattering number.

**The bystander is a STREAM, and the number that counts is its WORST wait.** A single `GET /health` beside each call answers what a bystander TYPICALLY waits, and the first version of this table reported that and called it the cost (review of PR #87, High-3: the medians were right and the conclusion drawn from them was not). So `GET /health` — one `SELECT 1` — now runs back to back for as long as the measured call is in flight, each from a fresh address so the global 300/min limiter answers none of them out of hand, and both its median and its longest wait are below. **§4 asks how long the server answers NOBODY, which is the longest.**

Each cell: **wall clock · longest event-loop block · a bystander's median wait · a bystander's WORST wait**.

| | 20 gyms of 200 (the launch shape) | 10,000, the biggest a list may hold |
|---|---|---|
| upload → preview | 970–1,075 ms · 14 ms · 2 ms · **57–135 ms** | 1,647–1,858 ms · 61–63 ms · 2 ms · **251–300 ms** |
| read the preview back | 32–49 ms · 0–4 ms · 4–5 ms · **9–12 ms** | 73–89 ms · 6–10 ms · 3–7 ms · **31–34 ms** |
| one page of 100 names | 35–37 ms · 1–4 ms · 4–5 ms · **9 ms** | 292–413 ms · 13 ms · 4–5 ms · **226–334 ms** |
| page 50 of the list | 27–28 ms · 0–1 ms · 3 ms · **8–9 ms** | 301–342 ms · 12–14 ms · 4 ms · **239–276 ms** |
| walking every name | 58–69 ms, 2 pages, worst block 0–3 ms | 30.6 s, 100 pages, worst block 16–20 ms |

**At the launch shape — which is what launch is — every read is comfortable**: nothing holds the request thread for more than 4 ms, and the worst a bystander waits beside a page is 9 ms.

**At ten thousand a page still costs the server about a third of a second of answering nobody**, and that is the honest headline. It is not a regression and it is not the paging fix: the first version cost the same (the review measured 309 ms beside a page of it), because what a page really waits on is the pool of ONE, behind statements that read a ten-thousand-person document. Moving the grouping into the database took the work off Node's thread — the event-loop block is 13 ms where it was 121 — and a bystander is now served in 4–5 ms for MOST of that window rather than waiting the whole of it. What it did not do, and could not, is make one connection into two. **That is ROADMAP Stage 4 item 11 and it is the next thing to fix for this screen, not this card.**

**3a-v-a's own cost, measured 2026-09-22** at the processor's full 2,592 MHz on mains
(checked: a battery halves it), three runs at each size, best of each, on the shape
§11.8 names — 10,000 people carrying 30 of the gym's OWN columns beside the ten
standard ones. **Reading the wider row happens in the WORKER thread**, so the reading
itself is taken from nobody; what the request's own thread pays is receiving that
answer and checking it against its contract before it is staged. Once per FILE, never
per page.

| 10,000 × 30 of the gym's own columns | keeping only the five old things | as shipped |
|---|---|---|
| understanding it, in the worker | — | 707–770 ms (the parse timeout is 15,000 ms) |
| what crosses to the request's thread | 3.2 MB | 9.2 MB |
| **the request's thread answers nobody for** | **46–47 ms** | **86–95 ms** (61–68 ms checking the contract, 25–27 ms writing it out) |

At the launch shape — 20 gyms of 200 (RULINGS 2026-09-20) — the same file costs the
request's thread **4 ms** (81 ms in the worker, 0.2 MB across), and at a band-5 gym of
2,100 it costs **29 ms** (212 ms in the worker, 1.9 MB). So Part 2 of the re-plan costs
**+3 ms at launch, +16 ms at 2,100 and +40 ms at the biggest list allowed**. The 95 ms
sits beside the 61–63 ms the preview's own rule already blocks for on that same file and
is accepted for the same reason (twelve uploads an hour a person); the pool of ONE is
still what to fix for this screen (Stage 4 item 11), not this.

*(Re-measured after round one’s fixes, three runs at each size. Round one’s High 5 made
a date column’s order read every row of it rather than its first 200 cells, which costs
the WORKER about 11 ms on the biggest file and the request’s thread nothing. The first
table here reported a single run’s 118 ms; three runs put it at 86–95, and the honest
number is the range.)* **What is worth watching
is the 9.2 MB**, which is a staged upload's row in the database growing threefold —
3a-v-b measures it again once that row is written per entry rather than as one document.

**ONE STATEMENT WAS COSTING MEMBERS × ENTRIES, and it is the one that answers everything about the gym's own people** (review of PR #87, High-B). `repo.membersAgainstList` asked a single lateral with `email = … OR phone_e164 = …`, and cast `u.email` to `text` on the way past. An `OR` across two columns rules out both of `0033`'s indexes, and the cast rules out the one on a `citext` column by itself — so it read the gym's whole list once per member. It runs on the preview read and on every page of names, and it grows as members × entries, which is the one shape in this card that gets worse as the app succeeds. Measured at the launch shape crossed with the biggest list — 200 members against 10,000 entries, `EXPLAIN (ANALYZE, BUFFERS)`:

| | the first shape | as shipped |
|---|---|---|
| execution time | 207 ms | **4.5 ms** |
| shared buffers | 51,212 | **2,813** |
| the list's rows | sequential scan, 10,000 removed by filter, once per member | both indexes, one row each |

It is now a `UNION ALL` of the two matches, each its own indexed lookup, ordered and cut to one afterwards — the same answer, and the same tie-break, as one lateral gave. **The cast was also WRONG, not merely slow**: text to text is case-sensitive, so the database answered a different question from `reconcile`'s own `foldEmail`, which folds case. One member could be on the list to the rule and off it to the database. Comparing citext to citext is both the fast answer and the right one, and a test drives that case rather than trusting that sign-in lower-cases everything it stores today.

**AND THE TWO CHANNELS ARE ORDERED, not merely joined.** §9.7 matches a member on their verified address first and falls to the phone only when there is none, which is what `reconcile`'s `entryFor` does in this process. The statement took whichever matched entry was OLDEST across both channels — the single `OR` lateral did too, so this is older than the paging and older than the split — and a member whose proved address matches a NEWER entry while their stated phone matches an OLDER one was shown with the wrong one's words: "was Frozen, OLD-1" about somebody the gym's list calls "Active, NEW-2". Only the status word and the member number beside one person, never who is on the list or any count, which is why it is a Low — but it is a sentence about a named person that is false. `ORDER BY by_email DESC` comes before `created_at` now, and the rule's own tie-break has a case in the table test beside the route's.

Two limits found while measuring, both recorded rather than fixed here. **A preview still blocks this thread for 61–63 ms at ten thousand people**, which is the rule running over every row on the request thread; it cannot move to the worker, which has no database, and at twelve uploads an hour a person it is accepted. **And `postgres.js` refuses more than 65,534 parameters in one statement**, so 3a-iii-b's confirm writing a row per person would fail at about 8,000 people — measured, and the reason §9.7's `INSERT … SELECT FROM jsonb_to_recordset($1)` is the only shape that reaches the biggest list allowed, not a style choice.

**Never logged, never in an error reply, never in Sentry** is now driven rather than promised (9.10): `memberList.leak.test.ts` builds the app at `trace` with request logging on and captures every byte pino writes through a good upload, a refusal, an unmappable file, a page of names and a fault carrying the file as its body; `sentry.test.ts` sends a member file's bytes through the forced fault beside the photo. One hazard is recorded for 3a-iii-b: **Postgres puts the whole failing row in a CHECK violation's `detail`** — measured printing a person's name, address and phone number — and nothing strips it before an error is logged or captured. No statement in THIS slice can draw one (every CHECK on `gym_member_list_uploads` is on a value the server computes, and a file holding a NUL byte is refused by 9.4 before the database sees it), but the confirm's INSERT of entries is CHECKed against real member data and can.

**`tools/preview-member-list.ts <file> --gym=<slug> --database-url=… [--mode=add] [--show=N]`** prints the whole preview through the service the route calls. It is how a real export is tried before item 5's screen exists, and it is what the reviewer runs. It names its own database and never reads `apps/api/.env`, for `import-usda.ts`'s recorded reason. Without `--show` no cell of the file reaches the screen.

**Out of 3a-iii-b (built 2026-09-21).** The confirm and the two list reads are live, so §9.9's table is now built except for 3a-iv's row. Seven things the shipped reads settle:

- **"ALREADY IN THE APP" IS ONE ANSWER, ASKED ONCE, AND HANDED TO BOTH READS AS A SET OF ENTRY IDS.** The question is "does one of this gym's members reach this entry", and it already exists in exactly one place — `membersAgainstList`, which the preview reads too, matching on the proved address first and the stated phone second. Asked again per entry it would be ten thousand lookups to answer two hundred questions (the shape review of PR #87 found costing 207 ms on the one connection the whole API shares) AND a second opinion that could disagree with the preview about one person. The members are bounded by what a gym can hold; the entries are not.
- **A MEMBER MATCHES AT MOST ONE ENTRY AND TWO MEMBERS CAN MATCH THE SAME ONE** — a household on one address — so the ids go through a Set before anything counts them. Counting the members instead would tell a gym of two that two people on a list holding one of them are in the app.
- **AND "WHICH ENTRY CAME FIRST" NEEDED A COLUMN OF ITS OWN, WHICH `0033` DID NOT GIVE IT (migration `0034`).** Three answers hang on it: the spelling shown on a status chip and the order the chips come in, which entry a member is matched to when a household shares one address (§9.7), and the order the pure rule is handed the list in. All three ordered by `created_at` with the entry's id as the tie-break — and `created_at` defaults to `now()`, which is the TRANSACTION's clock, so every row one confirm writes carries the same instant to the microsecond and the tie fell to `gen_random_uuid()`. **Measured 2026-09-21 on a copy of the table: of 40 confirms whose file wrote "Active" before "ACTIVE", 16 read the gym's own chip back as "ACTIVE"** — its own word, misspelt at the top of its own list, and able to differ between two reads a second apart, with the household's "in the app" mark landing on a random one of the two. `listed_seq` is a SEQUENCE and not the file's row number, because a second confirm and 3a-iv's typed-in person must APPEND rather than restart at one; the confirm's INSERT orders by the file's own row order so the numbers follow the list. It was found by this card's own test failing once and passing the next run, which is the only way a coin toss shows up — and the rule's table test could never have found it, because a pure function over an ORDERED array is exactly what the database was failing to be.
- **THE STATUS WORDS ARE FOLDED IN SQL THE WAY THE RULE FOLDS THEM IN THIS PROCESS.** `lower(coalesce(status, ''))` is `foldStatus`: a stored word is already trimmed with its spaces collapsed (`cleanStatus`), so lower-casing is the whole of the difference, and a NULL status and an empty one are one group here as they are one word there. The `(gym_id, lower(status))` index does not serve the coalesce and is not asked to — both reads walk the gym's own entries once whatever they do, because neither the email nor the id is in that index.
- **A PAGE IS CUT BY THE PERSON IT LEFT OFF AT, NEVER BY AN OFFSET.** Staff page through a list a colleague is editing; an offset skips people and shows others twice. The cursor is the last row's name and id — `(full_name, id) > (…)` against `ORDER BY full_name, id`, the id in it so two people called the same thing are two pages apart rather than one blocking the other for ever. It is opaque, and it is PARSED on the way back in: one that does not decode is a 400 and never "start again from the top", which would silently restart a walk through ten thousand names. A tampered one can only move the page within that gym's list, because the gym is in the `WHERE` either way. The encoding lives in `apps/api`, not in `@app/shared`: that package is read by the web app in a browser and touches no Node global, and a screen never builds a cursor.
- **THE TOTAL IS COUNTED OVER THE SAME FILTERED SET THE PAGE IS CUT FROM, IN THE SAME STATEMENT**, so "312 Active" and the names under it can never be answers to two questions asked a moment apart. The one-row `totals` on the outside is what makes an EMPTY page still carry its total: `SELECT (SELECT count(*) …) FROM filtered` answers nothing at all when the page is empty — no rows in, no rows out — so a search matching nobody would have come back with no total rather than zero.
- **A SEARCH'S OWN CHARACTERS ARE NOT WILDCARDS.** `%`, `_` and `\` are escaped before the LIKE, so a member number of `10%` finds that member and not every member.

**Cost at full size for the WRITE and the two list reads (§4), measured 2026-09-21** through the real HTTP server with a bystander stream beside every call, on AC at the processor's full 2,592 MHz, two runs at each size. Same instrument and same cells as the table above: **wall clock · longest event-loop block · a bystander's median wait · a bystander's WORST wait**. `apps/api/.cost/cost.ts`, which is scratch and not committed.

| | 20 gyms of 200 (the launch shape) | 10,000 entries · 200 members | 10,000 entries · 2,000 members (**the cap**) |
|---|---|---|---|
| confirm — the first, which writes the whole list | 289–350 ms · 18–25 ms · 2 ms · **183–184 ms** | 1,228–2,075 ms · 41–59 ms · 1 ms · **980–1,635 ms** | 1,546–1,610 ms · 42 ms · 1–2 ms · **1,164–1,216 ms** |
| confirm — next month's file, every status moved | 129–542 ms · 16–23 ms · 2 ms · **82–298 ms** | 1,948 ms · 47 ms · 1 ms · **1,496 ms** | 1,332–1,646 ms · 48–49 ms · 1–2 ms · **1,011–1,357 ms** |
| `GET /` — the list and its status chips | 23–53 ms · 5–15 ms · 1 ms · **11–40 ms** | 40–63 ms · 12–15 ms · 1–2 ms · **18–27 ms** | 104–107 ms · 16 ms · 1–2 ms · **72 ms** |
| `GET /entries` — a page of 100 | 25–54 ms · 7–16 ms · 1 ms · **8–36 ms** | 29–30 ms · 9 ms · 1 ms · **11–12 ms** | 98–225 ms · 16 ms · 1–2 ms · **69–147 ms** |
| `GET /entries` filtered, or searched | 21–52 ms · 6–16 ms · 1 ms · **9–37 ms** | 28–45 ms · 9–14 ms · 1 ms · **11–26 ms** | 89–108 ms · 16–21 ms · 1–2 ms · **66–76 ms** |
| walking every name, a page at a time | 48–104 ms, 2 pages · **10–39 ms** | 3,187–3,198 ms, 100 pages · **22–25 ms** | 9,434–9,809 ms, 100 pages · **122 ms** |

**THE THIRD COLUMN EXISTS BECAUSE THE SECOND ONE IS NOT THE BIGGEST SHAPE THE APP ALLOWS** (review of PR #88, High-2). A list may hold 10,000 people and a gym may hold 2,100 members (band 5, `seed.ts`), and the statement behind every fact about a gym's own people grows as **members × entries** — this section says so itself, a few paragraphs down. Measuring ten thousand entries against two hundred members measured one axis and called it full size. It is not: at the crossing every read is about three times the cost, and walking the whole list goes from 3.2 s to 9.4–9.8 s.

**The reads are still comfortable at the launch shape and they are NOT free at the cap.** A bystander waits 11–12 ms beside a page at ten thousand entries and 200 members, and **69–147 ms** at the same list with 2,000 — a page of the gym's list is the console's ordinary screen, not a monthly job. Walking the whole list at the cap holds the server for the better part of ten seconds in total. Nothing here is a regression and nothing is a wrong answer; it is the **members × entries** shape running on the ONE connection the whole API shares. **What bounds it is the `inApp` set**, which is the half that grows, and the pool — ROADMAP Stage 4 item 11. Both belong to item 5's screen and to that pool, not to this card, and they are written down here so the next chat meets the number rather than discovering it.

**THE CONFIRM IS THE EXPENSIVE ONE AT EVERY SIZE, AND AT TEN THOUSAND IT COSTS THE SERVER ABOUT A SECOND OF ANSWERING NOBODY.** It is one transaction that writes the lot — the rule again under the lock, one INSERT, one UPDATE, one DELETE, the stamp, the audit row — so while it runs no other gym and no member gets past. At the launch shape it is 183–184 ms, which is comfortable. At ten thousand it is not, and it is bounded by how rarely it happens: a gym confirms a list about once a month and presses the button itself, so nobody is waiting on a schedule. Nothing in this card can make one connection into two.

**A `large_change` or a `list_changed` refusal costs almost none of it**, because both answer before the first write: the rule runs, the numbers come back, and the transaction ends having written nothing.


**A REQUEST'S QUERY STRING IS NOT LOGGED EITHER, since 3a-v-b.** pino's stock `req` serializer writes a url as it arrived — the path AND the query string — on every request Fastify logs, so `GET …/entries?query=ada@members.example` put a member's address in the log and `?status=` has been on that route since 3a-iii-b. Nothing drove it, because the log capture only ever drove the upload routes and their values travel in a POST body; 3a-v-b's three new filters widened the same surface and its own capture found it. `logSafety.ts` now replaces the `req` serializer too: the PATH is kept and the query string is not, globally rather than route by route — a list somebody has to remember to add to is how the next screen with a search box leaks with nothing saying so.

**Never logged, never in an error reply, never in Sentry — and the hazard 3a-iii-a recorded is now closed** (§9.10). When Postgres refuses a row it puts the WHOLE FAILING ROW into the error's `detail` — measured again here, printing a member's name, address, phone number and member number — and `pino`'s standard error serializer copies every own property of an error onto the line it writes. The confirm's INSERT of entries is the first statement in this feature CHECKed against a gym's real people, so it is the first that can draw one. `apps/api/src/logSafety.ts` replaces the serializer with an ALLOWLIST (type, message, stack, code, status, and the four structural facts that say which rule refused) rather than a list of fields to strip: stripping `detail` would close the measured case and leave `where`, `internal_query` and whatever the next driver adds. The same helper takes those fields off an error before Sentry captures it. Driven by `logSafety.test.ts`, whose FIRST assertion is the control — that the raw error really does carry the person — because every assertion after it is worthless against a database that has stopped saying anything.

**3a-v-b's own cost — THE WIDER ROW WRITTEN AND READ — measured 2026-09-22** on mains at the processor's full 2,592 MHz (checked with `PowerOnline`: a battery halves it, and a first set of these numbers taken on one was thrown away), three runs at each size, through the REAL HTTP server with the same bystander stream as the table above. The file is the shape §11.8 names: **10,000 people × 30 of the gym's OWN columns beside the ten standard ones**. Each cell: **wall clock · longest event-loop block · a bystander's median wait · a bystander's WORST wait**.

| | 20 gyms of 200 (the launch shape) | 10,000 entries · 200 members | 10,000 entries · 2,000 members (**the cap**) |
|---|---|---|---|
| upload → preview | 1,062–1,197 ms · 16 ms · 2 ms · **70–234 ms** | 2,574–2,752 ms · 122–132 ms · 2 ms · **466–703 ms** | 2,708–4,166 ms · 126–223 ms · 2 ms · **592–1,332 ms** |
| confirm — the first, which writes the whole list | 178–281 ms · 16–18 ms · 2 ms · **128–231 ms** | 2,707–3,468 ms · 175–227 ms · 1–2 ms · **2,270–3,040 ms** | 3,395–4,538 ms · 153–218 ms · 1–2 ms · **3,027–3,982 ms** |
| confirm — next month's file, every field moved | 164–184 ms · 15–16 ms · 1–2 ms · **117–138 ms** | 2,747–4,126 ms · 197–281 ms · 1 ms · **2,355–3,715 ms** | 3,731–5,335 ms · 285–323 ms · 1–2 ms · **3,292–4,759 ms** |
| `GET /` — the list and its THREE kinds of chip | 28–41 ms · 4–10 ms · 1–2 ms · **14–20 ms** | 80–90 ms · 16 ms · 1–2 ms · **53–63 ms** | 148–164 ms · 16–22 ms · 1–2 ms · **76–84 ms** |
| `GET /entries` — a page of 100 | 24–30 ms · 7–8 ms · 1–2 ms · **9–11 ms** | 37–40 ms · 12–15 ms · 1–2 ms · **19–24 ms** | 105–122 ms · 16–20 ms · 1–2 ms · **66–87 ms** |
| `GET /entries` filtered by the gym's own words | 19–27 ms · 5–9 ms · 1–2 ms · **8–12 ms** | 24–41 ms · 8–15 ms · 1–2 ms · **9–16 ms** | 93–186 ms · 15–21 ms · 1–2 ms · **64–130 ms** |
| `GET /entries?records=former` | 19–23 ms · 5–7 ms · 1 ms · **8–9 ms** | 24–48 ms · 6–12 ms · 1–2 ms · **9–21 ms** | 88–135 ms · 16–20 ms · 1–4 ms · **63–97 ms** |
| walking every name, a page at a time | 60–77 ms, 2 pages · **11–23 ms** | 3,898–4,276 ms, 100 pages · **31–78 ms** | 10,883–15,409 ms, 100 pages · **125–221 ms** |

What the rows cost in the database, at 10,000 × 30: a staged upload's cells **2.00 MB**, and the kept entries **7.86 MB** of the gym's own columns inside **10.60 MB** of rows.

**THE READS DID NOT GET WORSE AND THE CONFIRM ROUGHLY DOUBLED, and that is the honest headline.** Against 3a-iii-b's five-field list measured on the same instrument: a page at the cap was 69–147 ms and is 66–87 ms; `GET /` was 72 ms and is 76–84 ms; the three new filters cost what the status filter already cost, because all of them are one pass over the gym's own entries and always were. The CONFIRM is where the wider row is paid for — **980–1,635 ms of answering nobody at ten thousand became 2,270–3,040 ms, and 1,164–1,216 ms at the cap became 3,027–3,982 ms** — because it now writes ten columns and a document per person where it wrote one word, and because `markEntriesFormer` updates rows a DELETE used to remove.

**At the launch shape it is unchanged**: 128–231 ms where the five-field list was 183–184 ms, and nothing holds the request thread for more than 18 ms.

**At ten thousand it is three to five seconds of the server answering nobody, and what bounds it is how rarely it happens**: a gym confirms a list about once a month and presses the button itself, so nobody is waiting on a schedule. It is one transaction that writes the lot, on the ONE connection the whole API shares — ROADMAP Stage 4 item 11 — and nothing in this card can make one connection into two. **A `large_change`, a `list_changed` or a `hand_edits` refusal costs almost none of it**, because all three answer before the first write — which is a promise round one found broken and fixed. The gym's catalogue was grown and INSERTed before the two tick gates, and a gate `return`s out of `sql.begin`, which COMMITS: a confirm that answered "nothing was changed" had already written the file's new headings into a bounded per-gym resource nothing prunes, so staff could fill a gym's forty slots with headings from files it never applied by uploading wide files the guard refuses — the guard's ORDINARY case. Reading and growing the catalogue is pure and happens before the rule; the INSERT is now past both gates, still under the gym's row lock.

**One number is worth watching and it is not a millisecond: a file of 10,000 people with 30 of the gym's own columns is about 4 MB, and the ceiling is 5 MiB** (`MEMBER_FILE_MAX_BYTES`). A gym at the biggest list this app allows, keeping the most columns it allows, is already close to the biggest file it allows — measured while building this card, when the first version of the harness wrote longer cells and the route refused the body. Nothing to fix here (the refusal is correct and says what to do), but it is the shape 11.7's "moving from other software" will meet first.

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
moves to the app keeps its own export to load them from then. **AMENDED 2026-09-21
(RULINGS; §11):** the file's membership type, its dates, its payment-status word and
every other column ARE kept now, minus §11.2's never-keep list. What is still later:
taking payments, plans as things the gym sells in the app, reminders to pay (Parts 4,
5 and 7 of the re-plan). A status is still never worked out from a date.

### 9.12 The invites (3b) — the frame; its own plan settles the rest with Kd

**Who is emailed, and when** (RULINGS 2026-09-19: *"they send a invite click invite
button and a message is send to the members via email with join link"*). Nothing is
sent by a confirm. Staff press **Invite** — for everyone, or for the status words they
ticked ("Active", "Pending") — and the button says the number before it sends:
`POST /v1/orgs/:gymId/member-list/invites` `{ statuses?: string[], version,
expectedCount }` (`members.confirm`, a gym on a plan; a different version or count →
409 and nothing is queued; since 23a-i also `expectedDigest`, the preview's value for
exactly the people it would email, §13.2). It queues every entry in that group that has an email, is
not in the app, has no invite record for this gym and no suppression, and answers how
many were queued and how many were skipped for each reason. Adding one person by hand
offers "Add and invite" (the same call for that one entry). **One email per person per
gym, ever; no reminders and no bulk "send again"** — in *Perkins v. LinkedIn* (N.D.
Cal. 2014, about $13M) the invitation was consented to and the two reminders were not.
~~Whether staff may re-send to ONE person who asks is 3b's plan to put to Kd.~~
**Answered 2026-09-21 (RULINGS): yes.** With codes abandoned the invitation is the only
way in, so a lost email must be replaceable: staff may send ONE person's invitation
again when that person asks (the person is at the desk, or wrote to the gym) —
`POST …/member-list/entries/:entryId/invite/resend`, `members.confirm`, at most 3 for
one entry in 30 days and 20 a day a gym, never to a suppressed address, never in bulk
and never on a timer. It is a new message to somebody who asked for it, not a reminder.

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
join. ~~Everyone else joins with the code (9.13) and is matched to the list all the
same. One tap or none is Kd's (ROADMAP).~~ **Settled 2026-09-21 (RULINGS): there is no
code, and it is ONE tap** — on a screen showing "What {gym} can see": joining starts
sharing a person's activity with the gym, and nobody should start sharing because a
third party typed their address. Everyone else is told to ask the front desk to add
their email. The whole join is §10.2.

**"Staff create his account" (Kd, 2026-09-19), as built.** Staff add the walk-in's
name and email and press "Add and invite". The account itself comes into being when
HE signs in with that address — the app has no passwords, an account is made by
proving an address (RULINGS 2026-09-07), and only he can tap the health and consent
screens — and the moment he does (and taps Join, §10.2), he is in that gym with no
code. ~~A walk-in with no email is added with a phone and joins with the gym's code;
the phone puts him on the list.~~ *(2026-09-21: a walk-in with no email goes on the
list with his phone and gets no app until the front desk adds an address for him —
every product read that day needs an email for app access.)*

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

**Out of 3b-i-a (built 2026-09-23).** 3b-i was split in two: 3b-i-a is below; 3b-i-b (the webhook, bounces and complaints, the first 50 then wait, the 2 % and complaint stops, the "have a look" list) is next.

- Migration `0038`: `gyms.postal_address` (≤ 200, set through `PATCH /v1/orgs/:gymId` `postalAddress`, stored as every invitation prints it — lines joined with ", ", links, `@` and control characters out; staff read it on `/mine`); `gym_invites` (one row an address a gym, `UNIQUE (gym_id, email_hmac)`, the state CHECK of §10.2); `gym_invite_sends` (one row an email, `first` or `again`; at most one `first` an invitation that is waiting, went or may have gone, by a partial unique index; the address is held only while the email waits and a CHECK clears it after; `maybe_sent_at` marks an email that may have reached Resend); `email_suppressions` (a CHECK makes a bounce every gym's and an unsubscribe or complaint one gym's). No foreign key to a list record: the sender reads the address on the send row and asks at send time whether a current record still holds it.
- Routes: `GET …/member-list/invites/preview` (the three word filters; `reach`, the left-out counts by reason — no email · in the app · already invited · unsubscribed · bounced · shared mailbox — and `blocked`; `digest` since 23a-i), `POST …/member-list/invites` (`version`, `expectedCount`, and `expectedDigest` since 23a-i; 409 `invite_changed` with a fresh preview), `POST …/entries/:entryId/invite`, `POST …/entries/:entryId/invite/resend`, and `invite: true` on "Add member" (added and invited together, or neither). A list row and a person's page carry `invitation`; `GET /entries` filters by `invitation`. `GET` and `POST /v1/email/unsubscribe?t=` (public). The token (the invitation's id and a MAC) rides in the query string, which the api's request log drops (`logSafety.ts`) and, since this job, Caddy's access log drops too (`infra/Caddyfile`; checked with the `caddy:2-alpine` image, v2.11.4: the log reads `/v1/email/unsubscribe`). It also drops a member-list search's words, which Caddy was writing.
- "In the app" is asked of the ADDRESS: if any current record holding it is matched to a member (§9.7), nobody is invited at it, so a household's second record never invites the member the first one is.
- Shared mailboxes are RFC 2142's names and Mailchimp's role list (both read 2026-09-23), whole local part, any case, a `+tag` ignored; a word neither names (reception@, hello@) is emailed.
- The press works out the group one statement at a time, checks the version again under the gym's lock with the first 500, then writes the rest in batches of 500; an address another press invited meanwhile is left alone by the unique key and counted as already invited.
- "Already invited" is about EMAILS: an invitation counts once one of its emails went, may have gone or is waiting, or once it is answered. One whose every email was skipped or given up (the gym lapsed that day, an outage) is invited by the next press or Invite, which queues its first email again.
- The worker (queue `invites`, every minute) takes one email at a time under an advisory lock: a gym 500 in any 24 hours, 200 on trial; the app `INVITE_EMAILS_PER_DAY` (default 2,000); `INVITES_PAUSED` stops it. Just before each email it checks again (`decideSend`, a table test over every case): the gym active, on a plan, with an address; the invitation pending; a current record holding the address; not in the app; not suppressed; a valid, unshared address; the domain takes mail (MX, else an address record; a null MX or no domain is no mail; a resolver failure retries). Resend's answer is one of three. It went. It did not go — any 4xx but a running key's 409 (our request, our key or account, the rate): the email waits and nothing is spent, a bad key, account or rate stops the run, and a week of it gives the email up, after which a press queues it again. Or it may have gone — a timeout, a network failure, a 5xx, a running key: the row is marked before every hand-over, tried again first and outside the caps under the same `Idempotency-Key` (the send's id), and once 20 hours have passed since the mark it is never handed to Resend again and ends as `send_unknown`, "We couldn't confirm this email went" (Resend keeps a key for 24 hours). A domain that cannot be asked waits the same way as a refusal.
- The email: the ruled subject, From "{gym} via AI Home Gym" on `INVITE_EMAIL_FROM`, the gym's name and city cleaned and cut at 60 (a name that is all web address is read as words, "IronHouse com"; one that cleans to nothing is not sent, `gym_name`), its postal address, the join link `{WEB_ORIGIN}/join/{slug}` (its page comes with 3b-ii), and the unsubscribe link with both RFC 8058 headers; the token is accepted in one spelling only. In production `INVITE_HMAC_SECRET` (never to change once set) alone keeps invitations readable and every unsubscribe link working; sending also needs `INVITE_EMAIL_FROM` and `API_ORIGIN`.
- Cost at full size (2026-09-23, mains, 2,592 MHz; the api has one database connection, so a bystander's worst wait is what counts), three runs at the cap and two at the launch shape on the final code. At the cap, 10,000 records and 2,000 app members: the count 149–225 ms (2,345 ms once, the first request of a fresh server), a page of 100 names 141–179 ms, a page filtered by invitation 141–213 ms, one person's page 9–11 ms, "Add and invite" 89–309 ms — each led by the whole-gym member match (161–174 ms alone), the statement the list page already runs. Pressing Invite for 9,000 people: 238–338 ms. Written in one transaction it had held everybody for 1,176 ms, its write alone 713–792 ms; in batches, before the fixes, one run in three still hit a stalled write on this machine's Docker database (798–943 ms), and plain 200-row inserts with no app code stalled for 746 ms in the same session, so those stalls are the disk. The launch shape, a gym of 200: the press 57–101 ms, "Add and invite" 69–85 ms, a page 11–16 ms. The worker, which is not the api: 137–147 ms an email, most of it commits (the claim, the mark before the hand-over, the finish).

**Out of 3b-i-b (built 2026-09-23).**

- Migration `0039`: `gyms.invites_stopped_at` / `invites_stopped_reason` (`bounces` · `complaint`) / `invites_counted_from`; `gym_invite_sends.result` (`delivered` · `bounced` · `complained` · `failed` · `refused`, only on an email that went) and `result_at`; `email_suppressions` gains `refused` (every gym's, like a bounce); `webhook_events` gains `attempts` (the claim's number), `tries` and `not_before`.
- `POST /v1/webhooks/resend`: the raw bytes (no parser runs first), Svix's signature (any `v1,` of the header, constant-time, the timestamp within 5 minutes), kept once by `svix-id` in `webhook_events` as `{ type, emailId, sendId, bounceType, bounceSubType }` only — never the address or the subject — then 200. Every invitation email carries the Resend tag `invite_send` = its row's id, so a report finds its email even before Resend's id for it is known. Kept: `email.delivered`, `bounced`, `complained`, `failed`, `suppressed`; every other signed event is answered 200 and dropped. No secret set: 503, so Resend keeps the events. Its own rate limit, 1,200 a minute.
- The worker (queue `invites`, job `invites.results`, every minute) acts on a report only for an invitation email (the tag's row, or else a sent row with Resend's id; a sign-in code's report is let go) and only once `GET /emails/{id}` agrees — the record carries the same tag, and its `last_event` is the report's own event or one that can follow it (a delivery by an open, a click, a complaint or a later bounce; a complaint by an open or a click). An email still being sent or retried: the report waits for its row. An email the sender ended as "couldn't confirm" (`send_unknown`) that Resend's record shows reached a mail server (delivered, bounced, complained about) becomes sent, under Resend's id; one Resend says failed or refused stays as it was. Record not caught up yet: asked again at 1, 5, 15, 60 and 180 minutes; still not after 8 tries, or Resend has no such email: given up, logged, nothing done. A 401/403 (the run stops and says the key needs Full access), a 429 or no answer spends no try; a report unsettled after a week is given up.
- What a confirmed report does: a delivery is recorded; a bounce Resend types `Permanent` (or leaves untyped) keeps the address from EVERY gym; a bounce of sub-type `Suppressed`, and `email.suppressed`, are `refused` — Resend's own list, which a complaint about ANY of the account's email puts an address on ("Email suppressions", resend.com/docs, read 2026-09-23: team-wide, every domain and sub-domain) — so they keep the address from every gym but are never counted against the gym, and staff read "our email service won't deliver to this address"; a `Transient` or other bounce is only "didn't arrive"; a complaint keeps it from that gym. An email keeps its most serious result (delivered < failed < refused < bounced < complained). A person's page shows the result beside the email.
- A gym's first 50 emails go and the next waits until all 50 have a result or an hour after the 50th went (`mayGymSend`, decided in the claim). A gym stops when hard bounces × 50 > the larger of emails sent (less those refused) and 50 — its second bounce in the first 50, three in 100, five in 200 — or on a complaint about one of its first 100 (`judgeGym`). A stop skips its waiting emails as `sending_stopped` (nothing spent: a later press queues them again), and an email that may already have gone ends as `send_unknown`. Staff see `blocked: "sending_stopped"` and a press, Invite, send again or Add and invite answers 409 `sending_stopped`.
- Kd's "have a look" list: `tools/invites-stopped.ts` lists the stopped gyms and `resume <gymId>` starts one again, its counts starting afresh (a first 50, then wait). The stop emails `OPERATOR_EMAIL` once, through the sign-in codes' sender, with the resume line.
- **To switch it on in production (Kd):** in Resend, Webhooks → Add endpoint `https://{api}/v1/webhooks/resend` with the five events above, and put its signing secret in `RESEND_WEBHOOK_SECRET`; `RESEND_API_KEY` must be a **Full access** key (a Sending access key cannot read an email back); `OPERATOR_EMAIL` is where the stop note goes.
- Cost at full size (2026-09-23, mains, 2,592 MHz, local database, the api's one connection): one report arriving 36 ms median, 150–224 ms worst (mostly the commit); the claim's gate 9 ms median for 20 gyms of 200 due, 35–37 ms (73 worst) with one gym of 10,000 sent beside them (13 ms before round one's fixes, which did not touch it; the local database had grown); one report acted on at a gym of 10,000 sent 125–134 ms median in the worker, during which a list write to that gym waited 60–61 ms median, 158 ms worst. The gate and the report are the worker's, not the api's.

### 9.13 ~~The code admits at once (3c) — the frame~~ STRUCK 2026-09-21, never built

*(RULINGS 2026-09-21: join codes are abandoned. Nothing below is built; it is kept for
its words. What replaces it is §10.2, the join by invitation, and §10.6, the codes
switched off. What survives: the waiting room's sweep, reminders and nudge are
switched off in the worker, not deleted.)*

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

**Redrawn 2026-09-27 as §18 (5b-v):** one list, tick boxes and one action bar, ten App words. Where this frame and §18 differ, §18 wins.

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
the names, then asks. *(2026-09-21: nobody joins by code any more, so the "joined by
code, not on your list" part of that line is gone; "Put on the list" stays for an app
member whose entry was taken off.)* **The list itself:** the gym's own status words as filter chips
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

**Out of 5a (built 2026-09-24; redesigned the same day on Kd's click-through, RULINGS
2026-09-24).** Console → Members → an "Import members" card opens a box of two screens.
**Upload**: a drop box (or choose a file), or Paste — pasted rows go as UTF-8 with its
byte-order mark. **Review**: the file; one big number for a list of only new people, else
tiles for new and updated, each opening its names 100 at a time; one line each for the
columns ("6 columns matched · Check", which opens every column with a dropdown — a field,
"Keep as its own column", "Don't import" — applied by reading the file again before Import
is allowed), for a date column nothing in the file settled ("03/04/2026 = 3 April 2026 ·
Swap"; the preview now carries `dateColumns`), for each never-stored class of column, and
for each warning (a short title; "Why?" shows the server's sentence). **The whole-list
question is asked only when it arises**: every file is read as the whole list first, and
only when people on the list are missing from it does Review ask, with their names, "They've
left" (a large change then needs the number TYPED) or "Keep them" (the same bytes read again
as `add`); nothing is picked for staff. The hand-edit tick names the fields. **The
permission tick** ("I have permission to store these members' details.") is
`permissionConfirmed` on the confirm request: without it the answer is 409
`permission_needed` and nothing is written; with it the audit row records
`permissionConfirmed` beside the actor. **A page of names unpacks the staged document
once** (`stagedPage`, a materialised step): written inside the per-person lookup, it was
unpacked for each of the hundred people, and at 10,000 people × 30 of the gym's own columns
(2 MB) a page held the one connection for 1.3–3.9 s; after, 0.17–0.36 s for a page of new
people (a bystander's worst wait 91–187 ms). Every page still works out who is in the app
live (members × entries, §9.9), which is the remaining ~0.5–0.8 s at the cap and belongs
with the pool (ROADMAP Stage 4 item 11). Measured on mains at 2,592 MHz with Folder B's
terminal sharing the database container, so runs varied two- to four-fold.

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

---

## 10. Getting in — invitations, staff, seats, one phone

*(ADDED 2026-09-21, a planning chat with no code: Part 1 of Kd's planning document
`PLANINGDOC.pdf`, agreed that day — RULINGS 2026-09-21, five lines. Frames, as 9.12 to
9.14 are: each card's own ten-line plan settles the rest with Kd. Where §2.2, §4.0,
§4.3, §4.7 or §9 differ, this section wins. Every card here is **Opus xhigh**: sign-in,
other people's data, sending email.)*

### 10.1 The shape

- **The browser is the console's and the phone is the member app's.** One account a
  person, proved by an email address (code, Google, Apple). The member web lives only
  until the phone app exists; nothing here is designed for it beyond staying TRUE.
- **Member and staff are two separate things.** A person is a MEMBER of an
  organisation by an accepted member invitation (10.2), and STAFF by an accepted staff
  invitation (10.3) or by having created it. Neither implies the other.
- **An invitation hangs on the ADDRESS, never on a link, a code or a phone.** Proving
  the address at sign-in is the whole credential. No link in any email carries a token.
- **A person who belongs to no organisation** signs in as usual and never meets any of
  this.

**The worst thing this section could do to a real person:** let a stranger into a gym —
reading its members' names on the leaderboard, or, as staff, their emails — because an
invitation opened for somebody other than the address it was sent to. It is the FIRST
test of 3b-ii and of 4a, written before anything else, with cases from outside the
code: a forwarded email, an address differing only in case (the same person), a Gmail
address differing by dots (NOT the same person here — exact keys only, 9.2 rule 4),
Apple's relay address, a second account, another gym's invitation id.

### 10.2 Joining as a member (3b-ii)

**When an invitation admits.** All of: a `gym_invites` record (9.12) for this gym and
this address that is `pending` · a list entry with that address STILL on the gym's list
(the list is the gym's yes today; a person who was invited and has since dropped off a
whole-list upload is not let in, and is let in again the moment a good upload restores
them) · the organisation active and on a plan · a free seat (10.4). `gym_invites`
therefore gains a state — `pending` · `accepted` · `declined` · `withdrawn` (staff took
the entry off, or removed the member: signing in again must not walk them back in;
"Invite again" is the one-person re-send of 9.12 and makes it `pending`). Whether the
email was delivered is NOT part of it: the press of Invite is the yes, and nobody can
sign in with a dead address.

**The flow.** The email's link is `{WEB_ORIGIN}/join/{slug}`: on a phone with the app
it opens the app, otherwise it shows the two store buttons, and until the phone app
exists it opens the web sign-in. The person signs in with the address the gym has.
`GET /v1/orgs/invitations` lists what is waiting for the caller's VERIFIED address —
member and staff invitations alike: organisation name, city, logo, kind, role — worked
out from the address's HMAC, so a caller can only ever see invitations to an address
they have proved. It is shown straight after "Before you start" (4d) and BEFORE setup,
so a person who stops halfway through setup is already in their gym (the reason
RULINGS 2026-07-19 gave for applying a code first), and again in Settings → Gym.
`POST /v1/orgs/invitations/:id/accept` — the ONE tap, on the "What {gym} can see"
sheet — takes the gym's row lock, checks everything above AGAIN, `claimSeat`s (a
membership with no code), marks the invitation `accepted`, stamps `last_listed_at`, and
records the consent time. Twice is a 200 that says already a member. `…/decline` marks
it `declined`; the gym sees that and sends nothing more.

**The honest walls.** No invitation for this address: "No invitation for {address}.
Your gym invites the email address it has for you — sign in with that one, or ask the
front desk to add this one." It shows the signed-in address, which is what explains an
Apple relay address to its owner. A full gym: "{gym} has no free places right now —
tell the front desk", and the entry reads "invited · waiting for a place" to staff.
Neither reply says anything about any other address.

**Limits.** Accept and decline 10 an hour a person with an explicit `ipMax` sized for a
gym's wi-fi at an induction (ROADMAP Stage 4 item 10's lesson); the list read 60.

**Out of 3b-ii-a (built 2026-09-23).** 3b-ii was split in two: 3b-ii-a is below; 3b-ii-b is "Not me", a deleted account's invitations waiting again, and "your gym now covers the app" (RULINGS 2026-09-23, gaps A, B, D), after it.

- Migration `0040`: `gym_members.entry_id`, a foreign key `(gym_id, entry_id)` → the record's `(gym_id, id)` with `ON DELETE SET NULL (entry_id)`, so a membership can only name its own gym's record; `gym_invites.answered_at` (set exactly when not `pending`) and `waiting_since` (only on a `pending` one); an index on `gym_invites.email_hmac`.
- Routes: `GET /v1/orgs/invitations` (`{ address, invitations }`: `pending` and `declined` ones, at an active gym whose current list holds the address, where the caller is not a member, each with `canTakeMembers`), `POST …/:invitationId/accept`, `POST …/:invitationId/decline`. Limits: 60 reads an hour a person, 3,000 an address; answers 10 a person, 600 an address (200 people each tapping Join, perhaps No thanks and Join again).
- **Who an invitation opens for.** The caller's account address must be proved AND the caller's sign-in session must be live and have begun at or after the first proof; an access token now carries its session (`fid`). Everything is looked up by the HMAC of that address; any other invitation id is `404 no_invitation`, whose sentence names only the caller's own address. The first proof of an address (a code, Google, the old verification link) ends any password and session set up before it, in the proof's own transaction: `POST /v1/auth/register` let anybody make a password account under an address they do not hold ("pre-account hijacking", Sudhodanan & Paverd, USENIX Security 2022). A password sign-in or change that was checked before the proof cannot write after it: each write holds the same users row lock and needs the checked hash still in place (round one's C1). A sign-in that has not proved the address reads `addressProved: false`, and Join and No thanks answer `403 address_not_proved`: "To see your invitations, sign in again with a code sent to {address}."
- **Join**, under the gym's lock: the gym active; the invitation `pending` or `declined` (a declined one may still join, RULINGS 2026-09-23 gap C); a current record holding the address; a live plan (else `409 gym_not_taking_members`, "{gym} can't take new members in the app right now — tell the front desk", never why); a free place (else `409 gym_full`, and the invitation reads `pending` with `waiting_since`, which staff see on the person's page). The membership has no code, the tap's consent time, `last_listed_at`, and `entry_id` when exactly ONE current record holds the address — a family sharing an address is linked to neither, since the list cannot say whose it is. Already a member: `already_member`, linking the record where the membership had none. Twice is one membership (the gym's lock and the live-membership unique index).
- **Withdrawn**: taking a record off by hand withdraws the invitation unless another current record still holds the address (the family's other person stays invited); removing a member, one or by Remove all, withdraws theirs. Putting a record back re-opens nothing; Send again does, before its "an email is still waiting" check (an email waiting for a withdrawn invitation would otherwise be skipped by the worker, and the person could never join). A whole-list upload that drops somebody withdraws nothing: they are let in again the moment a good upload holds them. The worker's reason for a withdrawn invitation's email is `invitation_withdrawn`, "you took this person off your list or removed them from the app".
- Joining two records moves `entry_id` onto the kept one; deleting a record clears it and keeps the membership.
- The web (the member web, until the phone app): straight after "Before you start" and before setup, a person with a `pending` invitation sees "You're invited to {gym}", the "What {gym} can see" sheet, and Join · No thanks, with Not now (for the visit) or Continue; a read that fails lets them on. A gym that cannot take members shows its sentence in place of the sheet, and No thanks without Join, so the invitation can still be answered. The console's routes never ask. Settings → Gym lists open invitations, a declined one with Join. `/join/{slug}` sends a signed-out person to sign in through the member door and a signed-in one to `/invitations`. The food-and-weight switch of RULINGS 2026-09-22 comes with ROADMAP 19e.
- Cost at full size (2026-09-23, mains, 2,592 MHz, local database, the api's one connection), three runs of twelve: what is waiting 10–13 ms median at the launch shape and 11 ms at a gym of 10,000 records and 2,000 members; Join 59–64 ms median at the launch shape and 58–69 ms at the cap (worst 176 ms); No thanks 51–55 ms; taking one person off at the cap 70–78 ms. Remove all of 1,000 members, their invitations withdrawn: 311 ms median of three (worst 338 ms), 475 ms in an earlier single run and 1,168 ms in one that stalled on the Docker disk, as 3b-i-a's did; withdrawing the 1,000 alone 42 ms median (worst 76 ms).

**Out of 3b-ii-b (built 2026-09-24).** "Not me", a deleted account's invitations waiting again, and a person who pays for their own plan (RULINGS 2026-09-23, gaps A, B, D; 2026-09-24).

- Migration `0042` (numbered after Folder B's `0041`, which merged first): `gym_invites.not_me_at`, only on a declined invitation (a CHECK); every other change of state clears it.
- **"Not me" in the email**: a link of its own, `/v1/email/not-me?t=…`, whose token is the unsubscribe token's shape with a purpose of its own in the MAC, so neither link can act as the other. GET shows one button and changes nothing (mail scanners open links); POST declines and marks the invitation. Its pages name the gym and nothing else. It never undoes a Join ("Somebody has already joined {gym} by signing in with this email address. If that wasn't you, contact {gym}.") and a withdrawn invitation stays withdrawn. 20 an hour a link, 5,000 an address.
- **"Not me" on the Join screen**: `POST /v1/orgs/invitations/:id/not-me`, the same checks as No thanks. The person can still Join afterwards (a mis-tap), which clears the mark.
- **Staff told**: `GET /v1/orgs/:gymId/member-list/not-me` (`members.confirm`) lists each current record at an address that said Not me; the console's Members screen shows them in a box, "Check the email address you have for them" (5b moves it onto the person's row). Send again to that address is refused (`said_not_me`) until the address is corrected, which is a different invitation.
- **The name each joiner signed up with**: the Members screen's roster carries, for staff holding `members.confirm`, the name on the list of the record the membership was joined through and `matches` or `differs` (`invites/nameCheck.ts`). A wrong "differs" only asks staff to look, so every doubt answers it: a name still the one a code sign-up was given from its own address is no name (round one's C1 — a mistyped address is usually built from the member's name); every part of the signed-up name must be found in its own part of the list's — the same word, or an initial either way; and at least two of the list's parts (its only one, if one) must be the same words, so a first name alone is asked about. A shortening is not a match (the re-check of round one): the list keeps one full name, so "Rob" for "Robert" cannot be told from "Reed" for a member's "Reedman". Order, case, accents and punctuation are ignored; an apostrophe joins a name. Its cases are W3C's "Personal names around the world", round one's, and names made from mistyped addresses. Remove is the roster's existing one tap.
- **Deleting an account** puts back to waiting the accepted invitations of the gyms whose memberships the deletion closed, in the same transaction; a withdrawn one stays withdrawn.
- **A plan of one's own**: each open invitation at a gym with a live plan carries `yourPlan` for a person with a live plan of their own — what having both gives beyond the gym's member plan alone, merged as the app merges them (a higher rank replaces a lower one whole; `ownPlanExtras`, the switched-off coach never named) and where to cancel it (the App Store or Google Play for a store purchase, else "where you bought it").
- Cost at full size (2026-09-24, mains, 2,592 MHz, local database), 12 runs, three times: the Members page of 100 with list names 16 ms median, the server busy 6–7 ms; the Not me box at a list of 10,000 with 20 marked 64–72 ms, the server busy 8–10 ms median (worst 24 ms), another request waiting at most 18–22 ms median. Hashed in one go it had held the server 47–50 ms; read by a cursor, 7 ms busy but other requests waited 71–77 ms on the api's one database connection. At a gym of 200: 13–15 ms, busy 2–4 ms.

### 10.3 Staff are invited by email (4a)

**Data.** `gym_staff_invites`: gym · email (citext, kept readable: the owner must see
whom they invited) · role · invited by · created · expires (7 days) · accepted at and
by whom · revoked at · last sent · send count. One pending invitation an address a gym.

**Routes**, all `staff.manage` (owner only): `POST /v1/orgs/:gymId/staff/invites`
`{ email, role }` → 201 with the same body and the same timing whether or not that
address has an account (the account-existence oracle `packages/shared/src/orgs.ts`
warned about is why the old route looked only inside the roster) · `GET` the pending
ones · `DELETE …/:id` cancels · `POST …/:id/resend` restarts the 7 days, at most 3
times. 20 pending and 20 sends a day a gym. The roles offered are manager and trainer;
a second owner is item 4b's hand-over.

**Accepting.** The invitation appears in 10.2's `GET /v1/orgs/invitations` with its
role. Accept writes a `gym_staff` row with the role's default ticks and **no
membership**. A new person who came in through the Manage door with an invitation
waiting lands ON it, never on "create your organisation" (today `/console` sends anyone
who runs nothing to `/console/new`). Audit rows for invited, accepted, cancelled.

**The email** is fixed words — "{owner's name} invited you to help run {gym} as
{role}. Sign in with this email address" — with a link to the console's sign-in and no
token, sent from the invites sub-domain through 9.12's checks and suppressions, the
gym's name stripped as 9.12 strips it.

**What changes in code that exists.** `addStaff` keeps appointing somebody who is
already a member. `removeMember`'s `is_staff` refusal goes: with staff and member
separate, ending a staff person's membership leaves their keys, and RULINGS
2026-08-22's question ("do they also stop being a member?") is asked in both
directions. Marking attendance still needs a membership.

**Out of 4a-i (built 2026-10-01).** 4a was split in two: 4a-i is below; 4a-ii is Send again, a bounced staff email shown to the owner, and `removeMember`'s change.

- Migration `0059` (numbered after Folder B's `0058`, which merged first): `gym_staff_invites` (the address readable, role, invited by, 7 days; `pending` · `accepted` · `declined` · `cancelled`; `cleared_at` for an ended or declined one the owner removed or a new one replaced; one OPEN invitation an address a gym, by a partial unique index) and `gym_staff_invite_sends` (each email, queued in the invitation's transaction, its address cleared when done).
- **The ticks are chosen on the invite form** (RULINGS 2026-10-01): the role fills in its usual ones, the owner changes any, the invitation keeps them (`privileges`, never `staff.manage`, a CHECK too) and Accept gives exactly those. The button is "Invite staff".
- **The gym's own roles** (RULINGS 2026-10-01): `gym_staff_roles` (a name, citext unique a gym, and its ticks; 20 a gym; not the app's own role names; never `staff.manage`) through `GET/POST /v1/orgs/:gymId/staff/roles` and `DELETE …/:roleId`. The form's roles are one row of buttons, Manager · Trainer · the gym's own · "+ New role", with the ticks straight underneath. Inviting with one (`roleId`) writes its name on the invitation and, on Accept, on the staff row (`gym_staff.role_name`; the `role` underneath is a trainer's, the ticks are what the console obeys); the name is shown on Staff, in the email and on the card. Deleting a role takes nothing from anybody; changing someone to Manager or Trainer clears the name.
- Routes: `POST/GET /v1/orgs/:gymId/staff/invites`, `DELETE …/:inviteId` (`staff.manage`, owner only); the invited person's own are `GET /v1/orgs/staff-invitations` and `POST …/:invitationId/accept|decline` — routes of their own rather than inside 10.2's `GET /v1/orgs/invitations`, which the member web reads before setup: a staff invitation is the console's. An address that is somebody already IN the gym is appointed at once (`addStaff`, RULINGS 2026-09-21); already staff or already invited (live) is a 409. Limits: 20 waiting, 20 emails a day a gym, 3 to one address in 7 days; the owner's list shows the newest 100.
- **Who it opens for** is 10.2's rule: the account's own address, proved in a session begun after the proof, matched exactly (citext: case only). A declined one may still be accepted until it ends; a second Accept is `already_staff`. Accept writes `gym_staff` with the role's starting ticks and no membership.
- **A past member invited as staff runs the gym.** `getStaffAuthority` and `listStaff` refused anyone whose membership was ever closed (the ghost of 2026-08-22); they now refuse only a membership closed AFTER the staff row was written, so the ghost stays shut and a past member hired as a trainer is let in. Accepting re-writes a ghost's row, so the invitation is the owner's yes from then.
- **What comes back** (round one): a staff email's Resend report is kept by its own tag (`staff_invite_send`) and acted on as an invitation's: a bounce suppresses the address for every gym, a spam report for this gym, both count toward the gym's standing (so an early complaint pauses all its emails), and the owner's list says a bounced one did not arrive. The send keeps the address's HMAC for this after clearing the address. Invitations are deleted 97 days after they are made (the hourly tidy-up), their emails with them; the audit rows keep what happened.
- The staff row carries `isMember`, so Remove offers "Remove from the gym too" only to somebody who is a member.
- **The email** goes through 9.12's worker, daily cap, kill switch and suppressions after the leads' follow-ups, with `decideStaffSend`: no list, age, postal-address or shared-mailbox check (it is one person the owner typed, and a front desk's shared address is a fair place to invite a front desk), and no unsubscribe link (a one-to-one work email, not marketing). Its link is `{WEB_ORIGIN}/staff-invitation`, which sends a signed-out person to sign in through the Manage door and a signed-in one to `/console`, where the invitation waits above the list (and in place of the redirect to Create, for somebody who runs nothing).

**Out of 4a-ii (built 2026-10-01).**

- **Send again**: `POST /v1/orgs/:gymId/staff/invites/:inviteId/resend` (`staff.manage`, the create route's rate limit). A waiting, ended or declined invitation is opened again for 7 days from now and its email queued once more, at most 3 times (`STAFF_INVITE_RESENDS_MAX`; counted from the invitation's own emails, so no new column); a declined one goes back to waiting. Under the gym's lock: refused while the last email is still to go (`still_sending`, so two presses send one), for an address that bounced or was refused anywhere or complained or unsubscribed here (`address_blocked`, with what to do), and by the gym's own caps as a new invitation is (20 waiting, 20 emails a day, 3 to one address a week). The owner's list carries `lastSentAt` and `resendsLeft`; Settings → Staff shows Send again beside Cancel, "Email sent again · 3 Oct", and, once used up, "Sent 4 times, so it can't be sent again…". The three "for a week" email reasons now say to press Send again.
- **`removeMember` stops refusing staff.** `DELETE /v1/orgs/:gymId/members/:userId?alsoStaff=true` removes somebody's place in the app and, with the tick, their staff access in the same transaction (audit `org.staff_removed`). A staff person's or the owner's place may be removed only by someone holding `staff.manage` (`staff_owner_only`, 403), so a manager never half-removes a colleague; the tick is refused for an owner (`owner_stays_owner`). A staff person who was never a member is not this route's (404). The member list's rows carry `staff` (role and the gym's own name for it), so the panel's box says "{name} is also staff here (trainer)." with the tick "Also remove {name} from staff" and, under it, whether they keep the console; for the owner, "They stay the owner and keep the console." Remove for people ticked on "In the app" follows the same rule (Kd's click-through): the owner's ticked staff and the owner leave the app and keep the console, listed in the box's `keepConsole`; a manager's ticked staff are kept. Remove on Your list and an import's leavers still leave staff and the owner out (§9.7). A person in the app who also runs the gym is tagged "Owner" or "Staff · Trainer" (the gym's own role name) in place of "Complimentary", and the names under "Already in the app" open their panel. Members has a third tab, **Staff**, for the owner (`staff.manage`): everyone who runs the gym from `GET …/staff`, their role, "Uses the app" for those with a live membership, and a panel with Remove from staff (ticked, also from the app, in one transaction); the owner is not removable there. Your list's records carry `staff` (the role of the person in the app the record is theirs) for the same tag.
- **The ghost rule goes; deleting an account ends its staff access.** `getStaffAuthority`, `listStaff` and the staff-invite checks now ask only for the staff row and a live account. The Day-0 cascade (`softDeleteUser`) deletes the person's staff rows except at a gym they own, so a restore gives back the account and not the console; migration `0062` (numbered after Folder B's `0061`, which merged first) deletes the rows the old rule refused (a membership closed after the staff row, not the gym's owner) and the rows of accounts inside their deletion window, so nobody refused before is let in.

**Out of 23c-ii (built 2026-10-07; RULINGS that day, "the console is made easy to find one's way in").**

- **Staff are invited and managed on Members → Staff**, in the console's new look (§17). It was a closed box in Settings; **Settings holds nothing about staff**, the older address `/settings#staff` opens plain Settings, and `staff.manage` alone no longer puts Settings in a person's menu. The tab is the owner's, as before; the one server change is the role step below.
- **The tab**: who runs the gym, each row opening the person; **Invite staff**; and **Invited**, each invitation with Send again and Cancel invitation (Remove, once it ended or was declined), which now ask first and name the address. Start here's Invite staff opens it with the form open (`/members?view=staff&open=invite`), and is greyed for a gym with no live plan, as Import and Add are.
- **Invite staff** is a panel from the right, as a member's page is: the email, the role as one row (Manager · Trainer · the gym's own roles · New role), what that role can do ticked underneath, Send invitation. A refusal is said in the form with the typing kept.
- **A person's panel** holds their role with a button for each other role they can be given (it asks first: their permissions become the new role's), **What they can do** with Save permissions, and **Remove from staff**. **The roles are manager, trainer and the gym's own** (Kd at the click-through: a role he had made was not offered on a profile): `PATCH /v1/orgs/:gymId/staff/:userId` takes `{ roleId }` beside `{ role }`, one or the other. A role of the gym's own is read with its gym (another gym's is `role_not_found`, 404), makes the person a trainer underneath shown by the role's name, and gives them the ticks saved with it, as an invitation made with it does; the same role under the same name is no change (for one of the gym's own, with the same ticks too: a role is changed by deleting it and making it again under its name), and "Front desk" to plain trainer is one (the name goes, the ticks are a trainer's). The audit row carries both names. Removing is asked ONE way, the tab's: "Remove {name} from staff?" with the tick "Also remove {name} from the app", which is one transaction on the server; Settings' "Take the keys back?" with its two calls is gone.
- **What is sent is exactly what is ticked.** A save sends the whole set: the boxes as they stand, plus every tick the person holds that has no box on their row (`carriedPrivileges`: the retired join-code ticks, `org.manage` and `billing.manage` on somebody who is not the owner, and any the build has no words for), and never `staff.manage` on a row that is not the owner's. An edit not yet saved is dropped when the server's set for that person changes (a save, a role change). After a save the list is read again and "Permissions saved." is said only if the server holds exactly what was sent.
- **Every permission has words.** `schedule.manage` ("Run classes and personal training") had no box from 17b-i, so every manager's panel said they held "1 permission this screen is too old to show", and a server that sent no set lost it on a save; it is a box for anybody on staff now. `org.manage` ("Change gym details") and `billing.manage` ("Manage the plan and billing") are drawn on the owner's own row, which cannot be changed; whether anybody else may be given them from this screen is not decided. A test holds the words to the server's whole list.
- **The page's name** (Kd, after the click-through; RULINGS 2026-10-07): the left option and the page's own title read **"Members & staff"** ("Clients & staff" for a studio or trainer) for whoever has the Staff tab, and "Members" for everybody else, whose page holds no staff (`membersPageName` in `consoleMenu.js`). The phone's bottom bar keeps the one word. Sentences that send somebody to the member list still say Members.
- Tests: `membersStaff.render.test.jsx` (the worst thing first: a table over each kind of person, one box pressed, the whole set that leaves the screen), `staffView.test.js`, and for the role given on a profile `staffInvites.routes.test.ts` on real Postgres (another gym's role, a body that is both or neither, everybody who is not this gym's owner, the same role twice, the owner's own row, a deleted role).

### 10.4 A seat is a person using the member app (4c)

**The rule.** A seat is a LIVE `gym_members` row — the owner's and staff's included.
`claimSeat`'s count loses `complimentary = false` and `NOT EXISTS gym_staff`, and so
does every mirror of it (`listMembers`, the member list's seat meter). The member
features already follow the membership row and nothing else
(`entitlements/repo.ts`), so a staff login with no membership is the free app on a
phone, which is the point: **a fake "staff member" gains a console login and no app.**
Staff logins are free and unlimited.

**Two questions that 3a-iii answered with one flag, and must stay two.** 9.7 keeps
staff and the owner OUT of the list's marks, the leavers and remove-all, so a gym is
never told it has lost its own owner by an export that holds only customers. That
stays. What changes is only what COUNTS: `seatCounted` splits into "counts as a seat"
(every live member) and "in the marks" (not staff, not the owner), with a table test
over member · staff only · staff and member · owner only · owner and member · removed ·
another gym, against: counts as a seat · gets the gym's member features · is in the
marks. The fraud itself is a route test: appointing five members as staff frees no
seat.

**The owner's automatic free membership ends.** Creating an organisation asks "Do you
train here too?" and a yes is an ordinary seat. `gym_members.complimentary` stays a
column and is written `false` from now on (production starts empty, RULINGS
2026-07-13; its other readers were the per-code join counts, which go in 10.6).

**Out of 4c (built 2026-10-01).**

- **One count of places, every live membership**: `claimSeat`'s `paidPlacesUsed` (and Put back's `placesFree`), billing's `seatsUsed` (a smaller size's day), `listOrgsForUser`'s meter, the import preview's `seat.liveMembers`; the roster's `takesSeat` is always true. An old `complimentary` row counts like any other.
- **The marks are a separate flag**, `inMarks` (was `seatCounted`): not staff, not complimentary. The leavers, Remove all, "Not on your list", a record's Remove and the large-change guards read it, so an export of customers never takes the owner's or a trainer's app.
- **"Do you train here too?"** on Create your organisation (`trainsHere`, required, nothing picked; a personal trainer reads "Do you train with the app yourself too?"). Yes writes the owner's membership with no code, the answer's time as its consent, `complimentary = false`; no writes none. `gyms.owner_included_as_member` is no longer read. An owner who said no adds themselves on Members and is invited like anyone.
- The screens: the owner's and staff's panels on In the app say their place counts in the plan; Members → Staff says "Uses the member app here, which takes one of your places" or "Uses the console only, which is free"; Settings' Staff card says "Who can help you run this gym. Staff use the console free. Using the member app here takes one of your places." (it said staff never use a seat). The Overview's note under a share nobody counted in says "People who came but have since left the gym, or hold a free place…" (it called the owner's place free). The Overview's "joined" leaves the owner out by role, and "(you)" is said of the viewer's own seat by identity.
- The Overview's populations (adoption, regulars, slipping away, nudge, cheer) are unchanged: live members not complimentary, so an owner who trains here is among them, as staff who train already were.
- Tests: `orgs.seats.test.ts` — the worst thing (the owner and a trainer take a place and Remove all of "not on any list" takes only the customer), the fraud (five members made staff free no place; the next person is told the gym is full), the question, and the table over member · staff only · staff and member · owner only · owner and member · removed · another gym's member against place · member features · marks. Breaks, each red: marks taking staff in, the door's count skipping staff, the roster calling staff free.
- Cost at full size (2026-10-01, mains, 2,592 MHz, local database; `.cost/cost-4c.ts`), a gym of 10,001 members with 100 staff, 12 runs: the door's count 5 ms, billing's 6 ms, the meter 32 ms, a page of 100 on In the app 48 ms, the server answering nobody at most 3.5 ms for each. "Not on any list you have imported" took 2.2 s median (busy 8 ms, worst 39 ms) and took 1.6 s (busy 10 ms, worst 32 ms) on the code before 4c, measured the same way the same day: slow at that size already, not made so here.

### 10.5 One phone at a time (with the phone app's sign-in, ROADMAP Stage 5)

`refresh_tokens` gains `client` (`web` · `phone`, existing rows `web`) and a nullable
`revoked_reason`. A successful PHONE sign-in, in its own transaction and under the
user's row lock, revokes every other live `phone` family of that person with the
reason `signed_in_elsewhere` — a reason of its own, so an ordinary second sign-in never
reads as a stolen token in the audit trail (`revokeAllRefreshTokens`'s three callers
are all security events). The old phone's next refresh is a 401 that names it, and the
app says "You were signed out because your account was signed in on another phone",
with Sign in again. `web` families are never touched, so an owner keeps the console
open while training. Nothing has to be done on the old phone first. Left to Stage 5's
sync design: workouts the old phone had not yet sent are kept for the same account's
next sign-in and wiped for any other account's. The `client` word comes from the app's
own request; proving it (Play Integrity, App Attest) is after launch — what it guards is
a shared login, not a secret.

### 10.6 Join codes switched off (3c) — built LAST in this section

So that no build exists in which nobody can join. **Server:** `POST /v1/orgs/join`, the
applications routes and the five code routes answer `410` `join_codes_retired` behind
one switch; handlers, tables and their suites stay, the suites running with the switch
on so the code does not rot unseen; creating an organisation mints no code; the
waiting room's sweep, reminders and nudge stop in the worker. **Console:** the code
cards on Overview and the "your gym is ready" code become "Bring your members in"
(the member list); the applications queue on Members goes off; `codes.invite` and
`codes.manage` stay in the privilege vocabulary (stored snapshots and the table's
CHECK name them) and gate nothing reachable. **Member web — the least that keeps it
true, since it is to be deleted:** `/org/join` becomes the invitations page, so an old
poster link lands somewhere honest; the code box in Settings → Gym and setup's "Your
code" screen give way to the invitations list of 10.2 (setup is eleven screens); the
carried code (`CarryJoinCode`, `landingRoute.js`, the sign-in page's "Sign in to use
your code", the Google return) leaves the sign-in routing. **Tests:** every retired
route answers 410 to a member, staff and a stranger; no screen draws a code box; an
old link lands on the invitations page; sign-in no longer reads the kept code.

### 10.7 Order, and the two extra passes

3a-iv → 3b-i → 3b-ii → 5a → 5b → 4a → 4c → 3c. "Getting in" is ONE feature for
CLAUDE.md §6: the hostile-security pass and the data-integrity pass run once over all
of it (3a-i to 3c, 4a, 4c) after 3c, each in a fresh chat, before any gym uses it.

### 10.8 Asked again in the planning document, and already built (9.7)

The same file uploaded twice writes nothing. A person whose details changed is updated
in place, never doubled — matched by email, else by phone. A person missing from a
whole-list upload is flagged for staff and never removed by the upload. A walk-in
added at the desk on the 22nd is matched by his email when the file of the 25th holds
him; if that file is the whole list and does not hold him, he is flagged, not removed.

### 10.9 Where the facts came from (read 2026-09-21)

PushPress help: "How can I invite new members and share access to the PushPress
Members app?" and "PushPress Login Overview for Admins, Coaches, and Members" · ABC
Trainerize help: "How To Add Clients" · Gymdesk docs: "Gym Staff", and its pricing
page (active members, unlimited staff accounts). Read in the code that day:
`orgs/repo.ts` `claimSeat` and `addStaff`, `entitlements/repo.ts`, `db/schema/
identity.ts` `refresh_tokens`, `orgs/routes.ts`, and the fifteen web places that show
or take a join code. No source was found for a gym app that limits an account to one
device; the one-phone rule follows apps that fight shared accounts (WhatsApp).

---

## 11. The member record — what is kept from a gym's file

*(ADDED 2026-09-21, the same planning chat: Part 2 of Kd's planning document, agreed
that day — RULINGS 2026-09-21. A frame; each card's plan settles the rest. It reverses
9.2 rule 7 and amends 9.1, 9.5 to 9.7 and 9.11; where they differ, this wins. Opus
xhigh: uploads, other people's data, and rules that decide whose column is whose.)*

**The worst thing this section could do to a real person:** leave their bank card
number or a medical note in our database — or keep somebody ELSE's address (an
emergency contact's, a parent's) as the member's own. The first tests written: a
card-shaped number is dropped from ANY column; nothing of a never-keep column reaches
the database, a log line or Sentry; a contact who is not the member can never become
the member's email or phone (9.5's structural rule, carried to every new field). The
cases come from outside the code — real exports' headings, real products' templates —
and include words no list holds ("PIN code" is a postcode in India and a door PIN
elsewhere).

### 11.1 What a record holds

**Standard fields** — typed columns the app reads: name · email · phone · member
number · status (the gym's word) · **membership type** (the gym's word: "Gold",
"Student 12 months") · **joined on** (date) · **ends or renews on** (date, with which
of the two its heading said, so a screen can say "Renews 3 Oct" or "Ends 3 Oct"; a file
with both keeps the second as an extra field) · **payment status** (the gym's word:
"Paid", "Overdue") · **date of birth**. It is the core of Gymdesk's own import list
(read 2026-09-21: name, date of birth, gender, status, member type, join date,
cancellation date, phones, emails, address, check-in code, notes, emergency contacts,
custom fields).

**Extra fields** — every other column, kept as TEXT under the gym's own heading: a
small catalogue per gym (`gym_member_list_fields`: key, the label as the gym wrote it,
order) and one JSON document on the entry. At most 40 a gym; a cell is cut at 500
characters and the preview says how many were. Shown on the person's page; searched
with the rest; not filter chips in the first build. A second email or phone is an
extra field and is NEVER invited or matched on.

**Words stay the gym's.** Status, membership type and payment status are compared with
case and spaces folded and shown in the file's own first spelling (9.7), each with its
chips and counts, each capped as the status chips are. A payment status is never read
as a membership status (9.5), and no status is ever worked out from a date (9.11).

**Records outlive the list.** *(The chat's design call, put to Kd with Part 3 and
agreed: RULINGS 2026-09-21.)* A
management app's member record is durable: a person who leaves a whole-list upload, or
is taken off by hand, is marked **former** with the date — not deleted, as 9.2 rule 2
had it — so visits, reports and a returning member's history survive, which is how
every product read that day keeps its ex-members. A former record admits nobody
(10.2), is never invited, is filtered out by default, and the gym can delete it for
good.

### 11.2 Never kept

Decided by what the CELLS are wherever a check exists, and by the heading only as the
backstop (CLAUDE.md §4, "the worst thing"):

| Class | Found by |
|---|---|
| Payment card numbers | 13 to 19 digits (spaces and dashes allowed) that pass the card check digit — in ANY column; the cell is dropped, and a column that is mostly such cells is dropped whole |
| Bank account details | an IBAN by its own check digits; account, routing, sort-code and IFSC columns by heading |
| Government ID numbers | the shapes that have one (US SSN, Canada's SIN with its check digit, India's Aadhaar with its check digit and PAN, the UK's NI number); passport and licence columns by heading |
| Passwords, PINs, door codes | by heading — and "PIN code", "Pincode", "Postal" are an ADDRESS, the table test says so |
| Medical and health notes | by heading (medical, health, injury, condition, allergy, medication, PAR-Q, disability, doctor …) |

A never-keep column is named in the preview with its reason ("not kept: looks like
bank card numbers") and cannot be switched back on. Its cells are dropped in the parse
worker, before any row crosses to the request thread, and never appear in a staged
upload, a log line, an error or Sentry. The same rules run on what staff TYPE: a
card-shaped number typed into any field is refused. A free-text "Notes" column is
kept — what staff wrote there is the gym's own, which the gym's promise and the
data-processing agreement cover (ROADMAP Stage 4 item 3); for the lawyer.

### 11.3 Reading the new fields (extends 9.5)

Heading words from real products' files, confirmed by the cells: a date column is one
whose cells read as dates; a membership type has few distinct words and is not the
status; a payment status holds payment words. **Dates:** a typed Excel date is taken
as it is; text is read ISO first; day-first or month-first is settled PER COLUMN by
any cell whose first or second part is over 12, else by the gym's country, and the
preview says "We read 03/04/2026 as 3 April 2026" with a switch to flip the column. A
cell that is no date is left empty and counted, never guessed. Staff can change any
guess or choose "don't keep"; the choice is remembered by the heading fingerprint
(3a-ii).

### 11.4 The reconcile rule over the wider row (extends 9.7)

Who is the same person: see "Out of 3a-vi" below (RULINGS 2026-09-24). "Changed" is any kept field
that differs, and the preview counts the changes field by field. Each entry remembers
WHICH fields staff edited by hand since the last upload (names, never values); an
upload that would overwrite one lists them and needs a tick on that request, as the
wrong-file guard does; after the tick the file wins. "Gone" marks the record former
(11.1) instead of deleting it, and a returning person is the same record again.

**Out of 3a-vi (built 2026-09-25).** `samePerson.ts`, `matchRows`: pure, one row to one record at most, called by `reconcile`.

- **The order, each step over the whole file before the next.** (1) Every carried field equal. (2) The same name (its words in any order, so "Shah, Priya" is Priya Shah) and the same member number, else email, else phone — a different member number does not part them (Mindbody staff edit a client ID, "SOK1234" → "XSOK1234"), nor a different email on a phone match (a new address). (3) A whole-list upload only: a different name on an email that exactly one record of the list holds and one remaining row brings (a corrected spelling, a married name). Current records are offered before former ones. Round one of the review (4 Highs) moved the rule to this shape: a same-name match anywhere in the file now comes before any rename.
- **Never one person**: a different name on a member number (GymMaster hands a key fob's number to the next member) or on a phone (a family landline), whatever else is missing; a different name on an email two records share; any different name in an upload that adds people ("Keep them"), where a record missing from the file has not left; a different date of birth on an email or phone match; a different member number on a rename. A split costs a former record the gym can join (§11.6); a wrong join puts one person's details on another's record.
- **The only cases that still join a different name** (RULINGS 2026-09-25, (3)): in a whole-list upload, a row whose email one record holds, when no other row matched that record — a corrected spelling, a married name, and, with no date-of-birth column, a parent who left and a child new on that parent's lone email ("name 1" on Review). A spelling corrected on a phone-only record, or on a shared family email, is a new record beside a former one.
- **The record keeps its id**; its name, address, phone and member number are written where the file carries that column (a field the file has no column for is kept), and its key is rebuilt from what is written. The update finds it by its old key. No two records can end with one key: a row whose carried fields equal a record's is matched to it in the first step.
- **The four identity fields are hand-edit marks too** (§11.6), so a phone staff corrected is asked about before a file writes over it.
- **Not changed here:** app members are still matched to the list by their proved email or stated phone (ROADMAP 3a-vi-b, below).

**Out of 3a-vi-b (built 2026-09-25; RULINGS 2026-09-25).** A member who joined by invitation is matched to the record that invitation was for (`gym_members.entry_id`), before their email or phone, everywhere "on your list" is decided: the upload's preview and confirm (`reconcile`'s `onListOf`), the one read behind the list, Remove all, the person's page and Invite (`membersAgainstList`, the joined record first and the contact channels only for a member with none), the roster's "On your list as …" (a current record only), and the staff stamp. So the gym's software changing their email keeps them on the list, and their row reads "in the app" so Invite does not email the new address; and when their own record comes off they are off the list, even while a relative's record on the same address stays. A member with no joined record (a code, a family address at the time, a deleted record) is matched by email, then phone, as before. "Put on the list" for a member whose joined record is former brings that record back rather than making a second. A staged upload's groups remember each row's record id (`entryId`), so a second look at a preview gives the same answer. Known edge, by 3a-vi's rule (3): another name on the member's lone old address is read as their record renamed, and the member follows it; the roster's name check then said "Check this is them" (until 2026-09-28: names are no longer compared). **On Members (RULINGS 2026-09-25)**, a paid-place member the list does not hold, once the gym has a list, has an amber edge, "Not on your list" with why (their record taken off on a day · was on an earlier list · never on a list the gym imported), the name on a current record holding their address, and "Put back on list" / "Add to list" (5b's "Put on the list", brought forward); only for staff with `members.confirm` (`orgMember.offList`). No migration, no new package.
- **Measured** (2026-09-25, mains, 2,592 MHz): 5a's second month on the real server reads 3 new · 2 missing · phone 2, email 1, name 1, status 4 (was 7 new, 6 missing); the same 20 people as "Surname, First" read 20 updated (was 20 new, 20 missing). At 10,000 people and 2,000 members, a month where every phone changed: confirm's bystander worst 2,909 ms, preview's 641 ms; the same status-only month on master 2,841 ms and 439 ms, on this job 2,920 ms and 559 ms (run-to-run noise is larger). At 200 people, every phone changed: confirm 134 ms, preview 57 ms.

### 11.5 Filters and Invite

`GET …/entries` filters by status, membership type, payment status (each a list of the
gym's words), in the app or not, invitation state, current or former, and search. The
Invite call (9.12) takes the same filter in place of `statuses`, with the version and
the count the person saw.

### 11.6 One person's page, and editing by hand (3a-iv)

`GET …/entries/:entryId` — every kept field, the extra fields, the invitation's state
and, for somebody in the app, only what §2.4 lets a gym see (last active, streak,
visits). `PATCH` changes any field under the never-keep rules; "Add member" is the
same form with **Add** and **Add and invite**. The audit row holds the NAMES of the
fields that changed, never their values. The member app never shows a gym's notes.

**Out of 3a-iv (built 2026-09-23).**

- Routes beside §9.9's: `GET /entries/:entryId` (the page) · `DELETE /entries/:entryId` takes a person off, their record becomes former · `POST /entries/:entryId/restore` puts it back · `DELETE /former/:entryId` deletes a former record for good (a current one: 409 `not_former`) · `POST /entries/:entryId/merge { keepEntryId }` joins two records (RULINGS 2026-09-23) · `GET /unlisted?group=` lists who "Remove all" would remove, with the version, count and digest the removal sends back.
- **"Remove all" sends a digest as well as the version and count.** A count still matches when one member leaves and another joins between the look and the press; the digest fingerprints the set (gym, group, user ids), so nobody is removed whom staff were not shown. The set is §9.7's marks from `membersAgainstNewList`, the preview's own function; only paid seats are marked, so the owner, staff and free places are never in it. The guard (§9.8) measures against the gym's paid-seat members.
- A typed field is tidied, then goes through the file's own rule for it (sign-in's email rule, the phone reader with the gym's country, the member-number rule, the card rule); one that cannot be kept refuses the whole change with the server's sentence, and a card number typed into any field is refused (§11.2). A digit group straight after a "+" that can begin a phone number — a 1–3 digit country code, or a whole 7–15 digit number — never begins a card, in typed fields and in a file's cells alike, since +49151… mobiles with no spaces pass Luhn about one time in ten; any other group, and everything after that one, is scanned, so a card joined on after a phone or glued to a "+" is still found. The phone box always asks the card rule with an issuer prefix (never true of a number starting 0 or 00), and skips the check-digit-only rule for a number valid for its country and for digits starting 0, which no card does: 0049, 0044 and 0091 numbers pass that one about one time in ten. Digits typed with neither "+" nor a leading 0, such as 4915100000400, are still refused when shaped like a card; they would have been read as a different number anyway.
- Hand-edit marks (§11.4) are set by a change, never by an add, and only on the fields an upload can write over. Changing a name, address, phone or member number moves the identity key; one that lands on another record's key answers 409 `already_on_list` with that record's id, or `former_record` when that record is a former one.
- **A change or a join never silently takes an app member off the list.** If, after it, a member the record reached is reached by no current record, the transaction is undone and the answer is 409 `leaves_list` with how many, unless the request carries `acknowledgeLeavesList`. A join keeps the kept record's own address and phone (RULINGS 2026-09-23), so keeping the other record is the usual answer.
- "Remove all" sent again with the same numbers (a retry, or the second of two staff) answers 200 `alreadyRemoved: true` with what the first press removed: the summary audit row keeps the set's digest for a day. Only when the set shown is no longer the set now; the same set with a moved version is `list_changed`.
- A gym's first typed person creates its list, so from then on its app members carry §9.7's marks; "no marks" holds only while a gym has no list at all.
- The page shows, for an app member, when they joined and their visits during this membership. "Last active" and the streak wait for 1a's active day; the invitation's state and "Add and invite" arrive with 3b-i.
- Every write bumps the list's version under the gym's row lock (creating the list for a gym whose first change is typed), so a preview staged before it cannot be confirmed, and stamps `last_listed_at` on the members the record reached, so a member whose record is taken off reads "no longer listed".
- No table points at a record yet, so a join and a delete move nothing; a test fails the day a migration adds a foreign key to one, and that job makes the join move those rows and drives it.
- **Cost at full size** (2026-09-23, after round one's fixes; mains and 2,592 MHz checked before and after every run; a bystander's worst wait, three runs each): 20 gyms of 200 — the page 6–9 ms, one write 38–62 ms (one spike of 126 ms; the commit alone is 24–33 ms on this machine's disk), the Remove all page 14–25 ms, removing 100 members 60–78 ms. The cap, 10,000 entries · 2,000 members — the page 8–9 ms, one write 47–95 ms (one spike of 150 ms), the Remove all page 169–249 ms, removing 1,000 members 329–389 ms. Before the fixes, four runs at the cap gave the page 169–212 ms with one 1,920 ms stall that never repeated, and the removal 305–562 ms; the reviewer's one run measured 315 ms and 615 ms.

### 11.7 Moving from other software

A step before the upload, "Which software are you leaving?": that product's own export
steps in plain words, and a preset that pre-fills the column matching. A preset is
DATA in `packages/shared`, built only from a real export or the vendor's published
template or help page, and cites it; no preset means the ordinary guess. The whole
move is self-serve, as Gymdesk's is. What a file does not bring, and the screen says
so: saved cards (they move between payment companies — Part 5), attendance history (a
later import), documents and photos.

*(5c, 2026-10-01; RULINGS that day.)* Built as "Which software is your list in?" above the
upload, since the same Import serves a gym keeping its software: Glofox, Gym Insight,
Gymdesk, GymMaster, Mindbody, TeamUp, WellnessLiving and Wodify, each with its own help
page's steps and a link to it, plus "My own spreadsheet" and "Other software". No
vendor publishes its export's headings, so no product has a preset yet: a product's
preset is added with the first real file from it. Zen Planner, PushPress, Virtuagym,
ClubRight, Clubworx, Arketa, Exercise.com, Magicline, Momence, FitnessForce and Wellyx
are left off until their own page gives the steps (theirs were unreachable, showed no
whole-list export, or the steps were only on another company's page). The choice changes nothing the upload sends.

### 11.8 Cost at full size, and cards

Measured again at 10,000 people × 30 kept columns: the staged document's size, the
preview, a page, the confirm, a bystander's longest wait — into 9.9's table. Cards,
built BEFORE 3a-iv so that card is written once: **3a-v-a** reading the wider row (the
new fields, dates, the never-keep rules — no database) · **3a-v-b** keeping it (one
migration, the reconcile rule over the wider row, former records, the filters). The
screens (5a, 5b) then carry the column matching with "don't keep", the person's page
and the chips.

**Out of 3a-v-b (built 2026-09-22).** Migration `0037`, forward-only: nine columns on an entry and the gym's own catalogue, `gym_member_list_fields`. Everything §11.1, §11.4 and §11.5 describe is now written and read. What building it settled:

- **Nobody is deleted, and the unique key makes a return free.** A confirm marks the people a file no longer holds with `former_at` instead of deleting them, and `(gym_id, identity_key)` already covered a former row — so the upload that holds somebody again REVIVES that very row, keeping its id and everything that will hang off it (visits, reports). A revived person is `new` to the list as it stands, which is what staff are deciding about, and `returning` says how many of the new are not new to the gym. A record that is already former is in no `gone`: marking it again would write a fresh date over the day the person really left and would put them in the wrong-file guard's numbers for every upload for ever, which is the mistake `leaving` avoids on the members' side.
- **A former record is off the list, in four places.** The rule measures every count, every match and every `gone` against the CURRENT records (one `filter`, not a condition each reader remembers); `membersAgainstList` carries `former_at IS NULL` in both of its channels, so a member matched to somebody the gym took off cannot read "on your list"; the chips and the whole-list counts read the current rows; and a page is cut from them unless `records=former|all` asks otherwise. `former` is its own number on the view and is part of no other, because `canBeInvited` is what 3b's Invite button acts on.
- **"Changed" is a list of fields, and a field the file does not carry is left alone.** This reverses what 3a-iii-b did with the status word: a file with no status column used to empty every status the gym had. A whole-list upload is the gym's list of PEOPLE as of today, not a statement that the columns its report omits are now blank; the columns a file legitimately omits are often the ones §11.2 refuses to keep. The `carries` flags are booleans inside a CASE in the one UPDATE, never a SET list built as text. The gym's own columns are MERGED with `||` for the same reason: a key the file carries is written, blank cell and all; a key it does not mention stays.
- **The breakdown is counted per field.** "412 changed" could be 412 corrected phone numbers or 412 dates read the wrong way round off one badly-ordered column, which is the mistake §11.3's date switch exists to catch. `endsOnKind` rides with `endsOn` rather than becoming a field of its own: a heading that went from "Expiry Date" to "Renewal Date" IS a change worth writing, and it is a property of a column, not a field staff would recognise.
- **The hand-edit tick is a second question, not a second reason for the first.** "More of your list would come off than we apply without asking" is about the FILE being wrong; "this would replace corrections your own staff typed in" is about the file being right and somebody's work being lost anyway. Two ticks, both belonging to the request and never stored, both refusing before the first write. The refusal carries a COUNT and field NAMES in plain English (`MEMBER_LIST_FIELD_WORDS`, or the gym's own heading for one of its columns) — never a value and never a person. Only the marks the file really overwrote are cleared: a mark on a field it left alone, or agrees with, is owed the same question next month. The screen that SETS a mark is 3a-iv's; this card writes the column, the rule, the tick and the clearing, so that card is written once.
- **The catalogue has its own ceiling, separate from the file's.** One upload is capped at 40 of the gym's columns by the reader; the catalogue is not replaced by an upload, so without a cap of its own a gym uploading differently-shaped exports would accumulate fields without limit — an unbounded document on every one of its people. It is applied in `growFields` (pure, so the preview and the confirm ask the same question of the same data) and the preview says so in the server's own words (`gym_fields_full`), which is a DIFFERENT sentence from `extra_columns_left_out`: that one is about this file being too wide and moving a column left fixes it, this one is about the gym being full and moving anything changes nothing. A CHECK cannot hold the ceiling — counting a jsonb object's keys needs a set-returning function and a CHECK may hold no subquery — so the documents are only ever written from what the catalogue returns.
- **§11.2 runs again where the confirm writes.** The reader drops a card-shaped cell before any row crosses to the request thread, which is where the rule belongs; but a staged upload lives an hour as a document in the database, outlives a deploy that tightens a rule and can be reached by a hand-run statement, and the confirm reads it back and writes it out. So every cell and every word about to be written is asked the card question again. A card-shaped cell is dropped and counted, never refused: a gym must not be left unable to load its own list because one value in ten thousand passes a check digit. The key is still written, empty: leaving it out would let the `||` merge keep the very cell the write was dropping. Only the CARD check is asked of one cell, which 3a-v-a measured rather than assumed: 7,269 of 100,000 made-up twelve-digit numbers pass Aadhaar's Verhoeff check, so asking the ID shapes per cell would throw away a gym's own member numbers.
- **A card number written inside a cell is replaced with `[card number removed]` and the rest of the cell kept** (`neverKeep.withoutCardNumbers`). A candidate must be written the way cards are — one unbroken group of 13–19 digits, or 4-4-4-4, 4-6-5, 4-6-4, 4-4-4-1 or 4-4-4-4-3 with one separator throughout (space, hyphen, dash, dot, comma, slash) — carry an issuer prefix (Visa, Mastercard, Amex, Discover, Diners, JCB, UnionPay, Maestro, RuPay) and pass Luhn; this is the length + prefix + check-digit test standard card detection uses. It runs where a raw cell becomes a kept value (the row's own columns, the sample cells, the status, membership and payment words, the name) and again at the write boundary; the member number keeps its whole-cell rule, because its whole job is to be a long number. Measured (`.cost/measure-redact.ts`, `.cost/notes-cost.ts`, on mains): 546 of 546 published test cards caught in seven written forms and six contexts; 0 of 12 ordinary cells altered in the script and 0 of 15 in the table test, among them number logs, a Luhn-valid run of four years and a Luhn-valid 4-2-2-2-3 code; 0–1 % of random number lists altered; 0.05 ms on a 500-character cell; a 200-person confirm with a 500-character number-log column 128–229 ms. The value is cut to its cap after the scrub, because the marker is longer than an unspaced card.
- **The log keeps a request's path, never its query string.** pino's stock `req` serializer writes a request's url as it arrived — the path AND the query string — on every request Fastify logs. `GET …/entries?query=ada@members.example` put a member's address in the log, and `?status=` has been on that route since 3a-iii-b; nothing drove it because the capture only ever drove the upload routes, whose values travel in a POST body. §9.9's rule is "never logged: a cell, a name, an address, a number, the body". `logSafety.ts` replaces the `req` serializer: the path is kept and the query string is not, for every route, so a new search box cannot leak by being left off a list.
- **An unnamed column is keyed among the unnamed columns** (`unnamed_N`, shown as "Column N"), not by its place in the file, so a column inserted to its left does not make the same cell a second catalogue field. **A refused confirm writes nothing, the catalogue included**: both ticks are asked before the first write, because a `return` from `sql.begin` commits. **An empty end cell has no kind**, so it never reads as changed.
- **A former record says whether its person is in the app.** `membersAgainstList` leaves former records out of both channels, so a second lateral answers that one question for the page of former records; the counts, the chips and `canBeInvited` still read the set without them.

- *(Superseded by 3a-vi, §11.4.)* **The identity rule is unchanged (§9.5), and that has a cost now that records are durable.** Who is the same person is still the name, address, phone and member number, so a gym that corrects a spelling in its own software gets a FORMER record it can tidy away and a new one beside it. It cost nothing while a list was replaced wholesale; it costs a duplicate now. Matching on the address alone instead would make two family members who share one email into one person, which is worse, and §11.4 says the matching does not change here. Recorded rather than fixed: the person's page (3a-iv) is where a gym would join two records, and this is the case to settle there.

### 11.9 Where the facts came from (read 2026-09-21)

Gymdesk docs: "Data Imports Overview" (its field list, custom member fields, the date
format choice) and "Migrating from a different provider" (the sentence on card and
bank data; self-serve import) · PushPress help: "Migration of your Members/Clients from
Another Platform into Core" (name, email, phone, plans, discounts, billing info; card
data requested between processors after the list is loaded).

---

## 12. Check-in at the front desk

*(ADDED 2026-09-21, the same planning chat: Part 3 of Kd's planning document, agreed
that day — RULINGS 2026-09-21. A frame; each card's plan settles the rest. It replaces
the member's own tap (§4 of the attendance work, RULINGS 2026-08-31 to 2026-09-03) as
the way a visit is made. Opus xhigh: other people's data, and a signed pass.)*

**The worst thing this section could do to a real person:** give a stranger a green
tick on somebody else's pass — or let whoever stands at an unattended desk tablet read
the gym's members. The first tests written: a pass that is old, used, another gym's or
another person's never checks anybody in; and a desk device's key reaches NOTHING but
the scan — not the list, not a search, not Settings.

### 12.1 The shape

The member shows, the gym reads — how PushPress and Gymdesk work (read 2026-09-21).
Three ways a visit is made, and the log says which: **pass** (the app's QR, read by a
USB scanner that types like a keyboard, or by the tablet's camera) · **key tag** (the
gym's existing barcode, which is the member number of §11) · **staff** (a signed-in
member of staff finds the person and taps Check in). The member's own tap is switched
off (12.7). Door machines and the gym's other software stay after launch (RULINGS
2026-09-17).

### 12.2 The pass

`GET /v1/orgs/:gymId/pass` (a live member of that gym) answers a short opaque string
the app draws as a QR: gym, person and a 30-second window, signed with a server secret
(HMAC-SHA256), about 60 characters so a cheap scanner reads it off a phone. The app
asks again every 30 seconds while the pass is on screen. The scan accepts the current
window and the one before it (clocks, slow hands) and each pass ONCE (a Redis key that
lives as long as the window), so a screenshot or a second phone showing the same pass
gets "Show a fresh pass". A pass is used up by a visit and by nothing else: read at a
desk where its person is not a member, or when the visit could not be saved, it still
works (the two extra passes, 2026-10-03). 10 passes a minute a person. The phone needs
the internet to show a pass; a pass the phone can make offline is the phone app's later
work. The pass is drawn as wide as the phone allows, with a quarter of the code spare
(error correction Q, the same 33 cells), so a patch of glare does not stop it reading,
and the phone's screen is kept awake while it is open (ROADMAP 16f).

### 12.3 The desk device

Settings → **Check-in devices** (`org.manage`): add one, name it ("Front desk"), and
the console shows a one-time link to open ON that tablet or computer; opening it stores
the device's key as an httpOnly cookie for the check-in page alone. `gym_checkin_
devices`: gym · name · key hash · made by · last seen · switched off at. The key
authorises exactly one call, `POST /v1/checkin/scan`, for its own gym — no list, no
search, no read of any kind — and the owner switches a device off in one tap. The page
is a big input that always holds the focus (a USB scanner types the code and presses
Enter), a camera button (`jsqr`), and the result: green with the name · grey "Show a
fresh pass" · red "Not a member of {gym}" · orange under a green tick for the gym's
own status or payment word. It shows one result at a time and clears it after a few
seconds, so the last person's name is not left on the screen. Finding a person BY NAME
is never on this page: it is staff's, in the console (12.5). The cookie holds the key
and the server's own mark on it, which opens nothing and only lets the rate limits count
a desk on its own (12.8). A device's name is its own among the gym's switched-on devices,
and a second "New link" within 10 seconds of the first is refused, so two staff pressing
together are not each shown a link of which one is dead.

**Sound, and the camera in poor light (ROADMAP 16f; RULINGS 2026-10-03).** Each answer
has a sound, so staff hear the desk without watching it: two rising notes for somebody
let in · the same and two lower notes when the gym's own status or payment word is
shown · one long low buzz for everything else. Only the two answers that let somebody in
are ever "let in" (a member whose record has no name included); the same pass shown again
is silent, and a pass the camera is still looking at is sent once, whatever the answer.
**Turn sound off** is on the page and the desk remembers it; turned back on it plays one
short note of its own, which is none of the three, so nobody at the desk can make it
sound like a check-in. A sound the browser cannot play at once is not played later. The camera is the backup, and Check-in devices says so: a USB
scanner that reads QR codes is the reliable way for a busy desk, and the camera reads a
pass but not a key tag. The camera is asked for a 1280 × 720 picture and reads it up to
ten times a second, each time one of six ways in turn — the whole picture or its middle,
as it is or with the grey pulled apart from the white, which is what a phone's bright
screen needs in a dim room (`deskRead.js`); a way that is slow and finds nothing rests,
and the reading is done in a worker, one picture at a time, so the page keeps answering.
The Scanner box stays at the bottom of the window. `tools/measure-desk-reads.mjs` measures it on made pictures.
The desk's own screen is kept awake.

### 12.4 The scan rule — ONE pure function, one table test

In: what was read (a pass · a member number · staff's pick), the gym, the time, the
gym's opening periods, the person's record and membership. Out: `checked_in` ·
`already` (with the first time) · `fresh_pass_needed` · `not_a_member`, and beside the
first two the gym's own status and payment words as a notice. It NEVER blocks on a
status, a payment word or the hour (a gym that runs its memberships and bills in the app may choose to stop people at the desk: RULINGS 2026-10-02, ROADMAP 16d). **Twice:** the visit's place in the day is the
opening period the scan falls in, or "outside hours" when it falls in none, and the
table's own uniqueness — gym, person, day, period (`slot_key`, built 2026-09-01) —
makes a second scan the same visit. A member number that fits two records asks staff
which. **One person is one person:** a card and a pass write the same visit, the record
and the account together — a card names the app member who holds the record, or else the
account a pass would name as that record (its proved email; on a shared address, the
record with its own name), never an account that has not proved the address. A person
named by both has their earlier visits of the day joined to them, and every count takes a
person as their record, or their account when the visit has no record. The table test covers every class: each way in × member · former · removed ·
never a member · another gym's person × first scan · same period · next period ·
outside hours × the pass fresh · old · used · garbled.

### 12.5 Staff check-in, and the live log

The console's Attendance page gains a search and **Check in** for signed-in staff with
a new tick, `attendance.mark` (owner and manager by default; the owner can give it to
a trainer) — logged with who did it. The page refreshes itself every 5 seconds
(`GET …/attendance?since=`; plain polling, no socket): name, time, how, which device or
which member of staff, and under the name the gym's own status and payment words in
orange, as the desk showed them (RULINGS 2026-10-03; sent only to staff who hold
`attendance.mark`). *(23a-ii: for somebody who holds a membership in the app the words,
here and at the desk, are what they hold, as the Members list reads it: §13.2.)*

**Fixing a visit, as built (19a-iv).** The same tick, `attendance.mark`, adds a visit
somebody made on an earlier day and removes a wrong one; a lapsed gym changes nothing.
*Add:* "Day they came" on Check someone in (today, or back 62 days of the gym's own
calendar, which covers all of last month's board); for an earlier day the button reads Add
visit and a box names the person and the day first. The visit is staff's, with no hour:
`hours_status` and `slot_key` are `added_later` (migration `0068`), so a person has at most
one a day, the same request twice adds once, and a day that already holds a visit that
counts answers `already` and adds nothing. `marked_at` is when it was added, and every
screen says "added by … on …" instead of a time. *Remove:* beside each of today's visits
on Attendance, and beside each visit in a person's "What counted" on the Leaderboard page.
The row leaves `gym_attendance`, so no count reads it, and is kept under its own id in
`gym_attendance_removed` with who removed it and when; asking again answers the same and
writes nothing more. A removed visit follows its record as a visit does (a join moves it,
a deleted record takes the ones only it named). Both are noted in `audit_log`
(`attendance.visit_added`, `attendance.visit_removed`) and the person's app streak is
worked out again: the streak they hold now. Their longest streak and any badge already
earned are kept, as everywhere else in the app (a "longest" is never taken back), so a
visit added by mistake and removed again can leave both. Remove tries once more when it
meets a join of the person's two records or a delete of their record at the same moment,
so it answers 200 or "not there any more", never a server error. The kept table's `method`
and `hours_status` carry the visit table's own two CHECK lists. The member's own calendar
and the console's lists print "Added later by staff" for such a visit, never a clock time,
and a person's list of days is drawn newest day first.

### 12.6 Data

A visit hangs on the member's RECORD (§11), so a person without the app is counted:
`gym_attendance` gains `entry_id` and `device_id`, `user_id` becomes optional with a
CHECK that one of the two is there, and `method` grows to `manual` (the old tap's
rows) · `pass` · `key_tag` · `staff`. When the person has the app the row carries
their `user_id` as well — written once, at the scan — so the streak, the leaderboard
and the active day (ROADMAP Stage 2 item 1a) read it unchanged. A former record keeps
its visits. Gyms never see a person's visits to ANOTHER gym (§2.4).

### 12.7 What is switched off

The member's tap (`POST /v1/orgs/:gymId/attendance`) answers 410 behind one switch;
its code and suite stay. Settings' "manual attendance" switch goes from the screen.
My Gyms shows the pass where the "I'm here" button was. The phone that notices it is
at the gym (ROADMAP Stage 5 item 8) is struck, never built.

### 12.8 Limits

A device: 120 scans a minute, of which at most 20 key tags; after 10 key tags nobody has
within 10 minutes, the device takes no key tags for 10 minutes and the console says so
(RULINGS 2026-10-02: a typed member number must not read the gym's list). Every refusal looks the same from outside and says
nothing about who is or is not a member beyond the one red line. A device key is
random, stored hashed, and useless for anything but the scan. A desk the server set up
is counted by its own device, by the app-wide limit too, so nobody on the gym's wi-fi can
use up its allowance; a scan with no key, or one the server did not mark, is counted by
its address. Ten unknown numbers are ten looked up, however many arrive together: a
device never has more key tags on their way than misses left before its pause. A set-up
link that opens nothing is counted by its address (30 an hour); a real link always opens.

### 12.9 Packages, cards, the two extra passes

`qrcode-generator` (MIT, no dependencies of its own) draws the pass; `jsqr`
(Apache-2.0) reads a QR from the tablet's camera; a USB scanner needs nothing. Kd's yes
to both: RULINGS 2026-09-21. Cards, after 3a-v-b (a visit needs the durable record):
**16a** the server — the scan rule, the pass, the devices, the migration · **16b** the
desk page, Check-in devices in Settings, staff check-in and the live log · **16c** the
member's side — the pass on the member web (the test rig until the phone app), the tap
switched off. Check-in is ONE feature for CLAUDE.md §6: both extra passes run once
over 16a to 16c, before any gym uses it.

### 12.10 Where the facts came from (read 2026-09-21)

PushPress help: "How to Check Members into Open Gym Using Barcode Scanner" (the USB
scanner at about $20; members scan their card or the member app's QR at a computer
open on the check-in page) and "Kiosk Mode Check-Ins with the Staff App" (a locked
screen with no staff powers) · Gymdesk docs: "Attendance Tracking" (kiosk: name,
numeric code, QR by the device's camera, barcode by a connected scanner that types
like a keyboard; check-in from the member app) and its guide "How to Set Up a Gym
Check-In System for Under $150". Neither product's public pages state a rule for a
second scan; ours is the one already built (`slot_key`).

---

## 13. What a gym sells, and its timetable

*(ADDED 2026-09-21, the same planning chat: Part 4 of Kd's planning document, agreed
that day — RULINGS 2026-09-21. A frame; each card's plan settles the rest. It is
ROADMAP Stage 2 items 8 and 9's prices, planned. **Every number in this section is a
starting value a gym can change in its own Settings** — Kd's words. Opus xhigh: rules
that decide who gets the last place and whose pack is charged.)*

**The worst thing this section could do to a real person:** tell two people "You're
booked" for the last place, so that one is turned away at the door — or take a class
off somebody's pack for a booking they never got. The first tests written: fifty
people tap Book at the same instant on a class with one place left and exactly one has
it; a pack is charged exactly once for a booking, however many times the request
arrives, and gets the class back on a free cancel.

### 13.1 Membership types — the gym's own price list

`gym_membership_types`: name · kind (`recurring` · `one_time` · `pack` · `trial`; a
**day pass is a pack of 1 valid for a day**, as PushPress makes a drop-in) · price in
integer minor units of the gym's own currency (RULINGS 2026-08-18: the currency follows
the gym's country) · for `recurring`, the period (so many weeks, months or years) · for
`one_time` and `trial`, the length · for `pack`, the classes it holds and the days it
lasts · what it includes (`all_classes` · so many bookings a week · `gym_only`) and
which class types it covers (all, or a chosen set — personal training is one) ·
archived, never deleted once anybody holds it. `memberships.manage` (owner and manager
by default; the owner can tick it for anyone on staff, RULINGS 2026-10-04).

*(17a-i's notes, 2026-10-04.)* The gym's own currency is the COUNTRY's own —
`MEMBER_CURRENCY` in `@app/shared`: pounds in the UK, euros in the euro area, Canadian
dollars in Canada — not `COUNTRY_CURRENCY`, which is what the gym pays US in. The server
stamps it on a type when it is made and never changes it, nor the type's kind. Reading
the list needs `members.read`, or the tick itself. A change sends back the type's
`updatedAt`, and one made from a form older than somebody else's change is refused (409),
never saved over theirs. One live type of a name per gym, whatever its capitals;
60 live types. A type has a description (optional), and its class limit is so many a
WEEK OR A MONTH (`limited`, `bookings_limit`, `bookings_period`), not a week alone
(RULINGS 2026-10-04: the gym’s own options; PushPress and TeamUp count both). The screen
asks "How is it paid?" in the industry’s words: Recurring · One-time payment · Class pack
· Day pass · Trial. Built in three jobs: 17a-i the price list, 17a-ii a person's membership,
17a-iii a file's word linked to a type.

*(23c-i's notes, 2026-10-07; RULINGS that day, "the console is made easy to find one's way
in".)* **The price list is a page of its own, Memberships, in the menu straight after
Members** (`/console/:orgSlug/memberships`; on a phone under More), for whoever holds
`memberships.manage`. It was a closed box in Settings. The page opens with the list
already open and **Add a membership type** top right, in the console's new look (§17). A
new type's form opens under the title; a type being changed, and a name from the member
list being set up, open their form in their own row; a refused save is said in the form
beside its button, and any other answer is brought into view. Every button, field and
message the box had is kept. Somebody without the tick who types the address is told
their role doesn't allow it, and neither the price list nor the member list's names are
read for them. **Settings holds nothing about it** (Kd at the click-through: the line
first kept there "is not needed anymore"), so the price-list tick alone no longer puts
Settings in a person's menu. The form says while a type is being ADDED, too, that how it
is paid can't be changed once it is saved: that is when there is still a choice to make.

### 13.2 A person's membership

Held by the member's RECORD (§11), so a person without the app can hold one:
type · starts on · ends or renews on (worked out from the type) · status (`active` ·
`frozen` · `ended` · `cancelled`, text with a CHECK) · classes left, for a pack · paid
through. **One pure transition function** moves the status, with an exhaustive test
(CLAUDE.md §4, Money), on an injectable clock. Until Part 5 connects a payment company
staff mark a period paid by hand — every product read that day lets staff record a
cash payment — and Part 5's ledger takes those marks over, nothing rebuilt. **A gym
that came from a file** links each of its membership-type WORDS to a type once ("Gold"
→ Gold Monthly) and the people who carry that word hold the type, their file's dates
kept. **A gym that keeps its other software** makes no types, and its file's words
just show (§11).

*(17a-ii's notes, 2026-10-04.)* `gym_held_memberships`, and ONE rule in `@app/shared`
(`heldMemberships.ts`): `heldMembershipView` says what a membership is on a day, and
`moveHeldMembership` is the transition. Every date is worked out on the gym's own day
(the server's clock in the gym's time zone). What is stored and what is worked out:
- The kind, the price and the term are copied from the type when the membership is
  given, so a later change to the price list moves nobody's dates; the name shown is the
  type's name now.
- A repeating membership renews on the same day each period, counted from its start
  (31 Jan, 28 Feb, 31 Mar), until staff cancel it; it never ends for being unpaid. Any
  other kind runs through its last day and reads `ended` the day after. `status` holds
  the last one written, so nothing reads it without the rule.
- "Paid" is a count of periods marked paid, moved one at a time either way: a
  repeating membership is paid up to its start plus that many periods; any other kind
  has one. Giving one to somebody who started earlier asks whether the period today
  falls in is paid. A free type has nothing to pay. The periods before it was given
  count as paid (`paid_floor`), and a mark is never taken back below that.
- Freeze starts today, Unfreeze gives every frozen day back: `frozen_days` counts them,
  and they are added AFTER the month arithmetic from the start day, so every later date
  moves by exactly the days frozen (moving the start instead lost days at a month's
  end, 31 Jan being cut to 28 Feb). Cancel is today, or, for a repeating membership paid ahead, at the
  end of what is paid, after which it takes no more payments.
- A request carries a key made by the screen, and a change names the state it moves
  to, so the same request arriving twice changes things once.
- A past member's memberships are kept, not in use and not changeable; Put back brings
  them back as they were. A merge moves them to the kept record; Delete for good takes
  them. One person can have more than one at a time (a monthly and a pack), at most 20
  running, frozen or still to start; the ones that are over are read a page of 30,
  newest first, with a count of the rest. A write marks what the clock has ended.
- Reading and changing both need `members.confirm`, the tick the person's page needs.
  Changes are limited to 300 an hour a person (900 an address); the read sits under the
  app-wide limit, as the person's page does.
- The person's page shows them in a **Memberships** box, drawn only where the gym has
  types or the person holds one; what the gym's own list says about the person sits
  under **Details**.
- Add member carries the same choice ("Give a membership": a type, a start date, paid;
  "No membership" until staff pick one). The person is added first and the membership
  given next, by the two routes above, and only where the add answered that somebody
  NEW was added (never for somebody already on the list or a past member put back, whose
  page says the membership was not added); where the second fails the person stays added and
  the page says the membership was not (RULINGS 2026-10-04). Where the gym has a price
  list the form does not also ask the list's own Membership word (§11): it takes the
  name of the type once that membership is given, and never otherwise. Edit, and a gym with no price list, keep that box.
  *(23a-ii: the choice comes straight after name, email and phone, and with a price list
  none of the list's own four words is asked; the notes at the end of this section.)*
- Not here: bills and money (18a), a pack's classes used by a booking (17c), who a desk
  lets in (16d).

*(17a-iii's notes, 2026-10-04, the screen redrawn 2026-10-05.)* **A list's membership
word linked to a type**: `gym_membership_word_links` (one link a word),
`linkHeldMembership` in `@app/shared` (`heldMemberships.ts`), and the gym's ONE list of
memberships, Settings → Memberships.
- A word is matched WHOLE, its capitals folded by Postgres on both sides (`lower`), as
  the list's own chips fold it: "Gold" is "GOLD" and never "Gold Plus". There is no list
  of words in the code.
- **The list's day is kept.** "Renews 14 Nov" is the first day not paid for; "Ends 31 Dec"
  is the last day covered. A repeating membership is paid up to that day (`settled`), or
  owes since it where it has passed (`due`) and is never ended for it. Its start is so
  many whole periods before the list's day and never after today, the first such start
  that comes back to the list's day exactly (one month before 31 Mar is 28 Feb, which
  comes back to 28 Mar, so the start is 31 Jan), so later renewals stay on the list's day
  of the month. Somebody paid further ahead than one period (a year paid on a type
  set up as monthly) renews in the rule every period and owes nothing until the list's
  day: every screen prints the list's day (`shownRenewal`), in the box's row and on
  the person's page. A free repeating one has nothing paid up to that day, so its page
  reads "From your list" with no renewal day. The periods up to the list's day are the list's own fact, so
  Undo mark paid never goes below them. Any other kind runs through the list's last day; where the type's own
  term does not reach it, the days between are counted in `frozen_days`. One whose day
  has passed is not given (`ended`), nor one whose worked-back start would be before
  1 January 2000, the first day any membership can start.
- **What the list does not say, staff do** (RULINGS 2026-10-04): with no day on the list
  the membership starts the day it is linked, and for these people, and for a membership
  that ends (its end day says how long, not whether it is paid), the box asks once
  whether they have paid, with nothing chosen. A free type asks nothing.
- The box names three groups that get it, each with a tick (paid up · payment due · your
  list doesn't say), and who does not, each with the reason: holds or has held the type
  (so a second press gives nobody a second, and a cancelled one is not handed back), has
  20 running, ended in the list, a day more than five years off, and past members, who
  are counted and given nothing. Names are the first 200 of a group; the counts are of
  everybody. A pack is given whole, and the box says the list does not say how many
  classes are used.
- The press carries the box's `digest`: the day, the type as it stands (its price, term
  and when it last changed) and each person who can get it, with their name, group and
  list day. A list or a type that has moved since is refused (409) and nobody is given
  anything, however alike the numbers are. The same press arriving again, its people
  already given, is told it was done (409 `membership_link_done`), never that nobody was
  given a membership. Everybody is given theirs in one statement under
  the gym's lock, with one note in `audit_log`. `from_list` marks a membership whose
  start was worked back from the list's day: a person's page reads "From your list ·
  Renews 14 November 2026", never the worked-back day as the day they started.
- **A person on the list twice** has the name on both records, and both are given the
  type. Joining the two records (§11.6) does not move a from-list membership onto a
  kept record that has that type IN USE: it goes with its record, and the join's note
  counts it. Where the kept record's one is over (cancelled, or ended, the clock's
  endings marked first), the other record's is the person's running membership and
  moves, as any other membership does.
- One link a word. A second type is refused until the link is removed; removing it
  changes nobody. The link is remembered and never acts by itself: people who arrive
  with the word later are given it on a press.
- **The screen: one list of memberships, never a second one beside it** (RULINGS
  2026-10-05). A name on the member list IS a membership, as the file's own
  membership names are in every product read (§13.8). So Settings → Memberships draws:
  - under the types, **"On your member list, not set up yet"**: each name that is no
    type so far, with how many people have it, and **Set up**. With nothing for sale
    yet, Set up opens the usual Add form with the name filled in; saving it leads
    straight to the box of who gets it. Where the gym has types it first asks "What is
    “Gold” at your gym?": *One of the memberships above* (which one) or *A new
    membership*, nothing chosen. The closed section says how many names wait.
  - on a type's own row, what it has to do with the list, in plain numbers: "On your
    member list this is “Gold” · 360 people. 60 of them have never had it." with **See
    who can get it**, and **This isn't “Gold”**, which undoes the tie and changes
    nobody. Where nobody with the name has had it, the row offers **Give it to them**.
  - **a name that is already a type's own name is never asked about** (the read's
    `sameName`): nothing is drawn where everybody with it has had the type, and its
    row states the numbers where some have not. Kd's click-through met "Gold Monthly"
    on the list beside a dropdown offering Gold Monthly.
  - a name whose type was archived goes back under "not set up yet" with **Set up
    again**.
  The box opens with everybody who can get it ticked the first time, and with NOBODY
  ticked where some already have the type: the rest may have been left out on purpose
  (lapsed members a gym chose not to bring across), so staff tick who they mean. A name
  not yet tied to the type can be counted as it with nobody given. One thing is open at
  a time: a form, the question or the box.
- **The box names people in a list, a row each** (Kd's second click-through,
  2026-10-05): the name and the day they will read ("Aarav Mehta · Renews 16 October
  2026"), three of a group, then "and N more · See all" a hundred at a time inside the
  list's own frame, as the Remove box does (§18.6). Never a line of names.
- **A person's page says the membership their list names** (the same click-through:
  Leo Grant's page read "No membership yet" above "Membership: Gold Plus"). The read of
  a person's memberships answers `listed`: the list's name, its day, the live type that
  name is (one staff said it is, else a type of that very name; none where it is not set
  up or its type is archived) and whether this person has, or has had, that type. Where
  they have not, the Memberships box draws it as a row of its own: "Gold Plus · Not set
  up · From your member list · Renews 13 October 2026", or, for a name that is a type,
  "Gold Monthly · Not added · Your member list says “Gold”". It has no buttons: it is
  not a membership held here. "No membership yet" is said only where the list names
  none. A past member's page is told nothing of it.
- All four routes need `members.confirm` (a preview names people and what each owes);
  the box sits in Settings → Memberships, which opens on `memberships.manage`, so in
  practice both. The word travels in the request's body, never its address.

*(23a-i's notes, 2026-10-07.)* **The Members list says what each person holds** (RULINGS
2026-10-07; §18.2). The list's Status, Membership, Renews-or-ends and Payment columns were
the gym's own words from its file and nothing else, so somebody given a membership here
read as having none. ONE rule, `heldOnList` in `@app/shared` (`heldOnList.ts`), now says
what those four show for a person, on the gym's own day:
- **Something in use** (running, frozen or still to start): the app's own facts, and only
  those. Status is the first membership's ("Active", "Frozen", "Not started": the words of
  the person's own page, `HELD_STATUS_WORDS`). Membership names each once, a running one
  before a frozen one before one still to start, a membership before a pack, then the
  newest: "Gold Monthly +1". The day is the first one's: "Renews 6 Nov", "Ends 31 Dec",
  "Starts 18 Oct", "Frozen since 6 Oct". **Payment is "Payment due" where ANY of them is
  owed today**; else "Not due yet" where one has a payment whose day has not come (a
  membership still to start, not paid); "Paid" only where nothing is owed or to come;
  "Free" where there is nothing to pay. A row never reads Paid for somebody who owes, and
  nobody who owes nothing yet is under the word staff chase people by (`HELD_PAYMENT_WORDS`).
  A name on their record from the gym's old file is not a second membership; their own
  page still shows it.
- **Nothing in use, and the list names a membership they never had here**: the gym's own
  words, as before. "Had" is any membership of theirs of the type staff said that name is,
  or of a type of that very name, whether or not the type is still on the price list:
  archiving a type sends nobody cancelled here back to their old file's "Active". (Their
  own page says "Not set up" of an archived type; that is about setting it up again.)
- **Nothing in use otherwise**: the one that FINISHED last, "Cancelled 6 Oct" or "Ended 31
  Aug", with no payment: the day it was cancelled, else its last day; a membership before
  a pack that finished the same day; then the newest start. A pack used up before its last
  day finished on a day nobody stored, so its start day stands in. So somebody whose year
  membership is cancelled today is "Cancelled", not "Ended" under a day pass from last week,
  and never "Active" from the gym's old file. A person can have hundreds of rows that are
  over, so `overForList` picks each one's row in SQL by this same order;
  `memberships.overForList.test.ts` holds SQL and the rule to the same choice.
- An unpaid membership the clock has ended is over, so it is under no payment word; what
  somebody still owes for one comes with bills (18a).
- **Nothing held at all**, and every past member: the gym's own words.
The row carries it as `held` beside the four words, which stay the list's own; a person's
page carries the same. **The Filter, its counts, Select all, Invite and Download CSV read
what the rows show**: somebody the app answers for passes a word filter by the app's words
and never by their record's; a person with two memberships is under both names; the file
writes the app's words in the list's own columns ("Gold Monthly; PT 10"). Worked out for
the page's people on every read, and for the whole gym only for the counts and a word
filter (`memberships/onList.ts`), with two plain reads (`inUseForList`, `overForList`)
at one moment (one read-only snapshot). **A press of Invite says who its box showed**: who
a word filter chooses follows memberships and the day, so the people can change with the
list's version and the number both as they were (a payment marked, midnight). The preview
carries `digest`, one value for exactly the addresses it would email; the press sends it
back as `expectedDigest`, and for other people, or with none, it is 409 `invite_changed`
with the new preview and nobody is invited.
The membership rule itself was split so a list reads a membership's state, dates and what
is owed without what staff can do to it (`heldMembershipFacts`; `heldMembershipView` is
that and the buttons).

*(23a-ii's notes, 2026-10-07.)* **Every other screen gives the same one answer.**
- **Add member asks who the person is, then their membership**: Name, Email, Phone; then a
  **Membership** box picked from the price list ("No membership" until staff pick one);
  then Member number, Join date, Date of birth and the gym's own columns. A gym with a
  price list is not asked the typed Status, Membership, Payment status or End or renewal
  date, and a box the form does not show sends nothing. **A gym that has set up nothing to
  sell** types those four in the membership's place, under a line saying so, with **Set up
  memberships** for staff who hold `memberships.manage` (others are told the owner can). It
  opens Settings beside the form with the Memberships section open
  (`/settings#memberships`, `useSectionLink`), and the form reads the price list again when
  staff come back to its window. Nothing is asked about a membership until the price list
  is read; where it cannot be read the four are typed and nothing says the gym has none.
- **A person's Details and Edit** leave those four out for somebody the app answers for
  (`held` on their page, the same answer as their row), so the page says them once, in the
  Memberships box; Edit says where they are changed, with **Go to Memberships**. A
  membership changed in the box reads the page again. The "Changed by hand" line leaves
  those four out too. With nothing in use the box, which folds what is over away, says
  what the row says: "No membership now. Gold Monthly · Cancelled 6 Oct". Somebody the app
  holds nothing for keeps every word and every box, in the order Edit had. The words stay
  on the record, and an import still writes them.
- **The front desk, staff's search, staff's check-in and the live log** (§12.4, §12.5) say
  the status and payment word of what the person holds, by this rule on the gym's own day,
  and their record's two words only where the app holds nothing for them
  (`checkin/service.ts`: `noticeOf`, `heldWords`). What a person holds stands whole: one
  that is over has no payment word, and the record's is not put in its place. The visit is
  saved before the words are read, so a read that fails takes the words away and never the
  tick, the search or the log (`checkin.held_words_unread`). A past member's visit in
  today's log has no words. The log's screen asks for new visits every 5 seconds and for
  the whole day once a minute, so a row follows a payment marked elsewhere. The desk prints
  a payment word that says "payment" itself without the label: "Status: Active · Payment
  due". Merge duplicate's side-by-side view reads the same four from what the person holds.

**The membership row carries its record.** Since 2026-09-21 a person joins only by
accepting an invitation (§10.2), and the invitation knows which record it was for; so
`gym_members` gains `entry_id`, written at the accept. It replaces 9.2 rule 3's
"matching is worked out when asked" for everything after joining — a stored link is
safe now that records are durable (§11.1) and nobody arrives by code — and it is what
bookings, visits (§12.6) and "who may book" read. Staff changing a record's email does
not move the link; deleting the record clears it.

### 13.3 Classes and the calendar

`gym_class_types` (name, words about it, minutes, places, usual coach, colour, open
gym or not) · `gym_class_schedules` (type, weekdays, the LOCAL start time, from, until
or open-ended, places and coach where they differ) · `gym_class_sessions`, one row for
each day a class runs (its instant in UTC, its local date and time, places, coach,
`scheduled` or `cancelled`, and whether it was changed on its own). A daily worker
fills the calendar **8 weeks ahead**, safe to run twice (one session a schedule a
local date). A recurring class is kept as the gym's clock time plus the gym's time
zone and turned into an instant for each day, so a summer-time change never moves the
6 pm class. Staff change or cancel **this day only** (the session is marked as changed
alone and later edits of the schedule leave it be) or **this day and later** (the old
schedule ends, a new one begins); people booked on a changed or cancelled day are told.
*(AMENDED 2026-09-22, RULINGS: a repeat carries its OWN coach, places and length — the
class type holds them as the values a new repeat is filled in from and changes nothing
already on the calendar, 17b-ii-a — and staff can change EVERY repeat of one class in
one go, forward only from a date they pick and never a day changed on purpose, which is
TeamUp's Bulk Edit, 17b-ii-b.)*
*(17b-ii-b-i, 2026-09-23: a CANCEL is a status and is not marked "changed alone" —
nothing that writes the calendar touches a date's status, so a date put back on runs
as its repeat then does. Only a change to one date's time, length, places or coach
marks it changed alone. **TeamUp's model (Kd, RULINGS 2026-09-23):** a cancelled date
stays cancelled while its repeat runs; Stop and Remove clear every coming date,
cancelled ones too, and a repeat added afterwards writes its own. One class runs once
at a given time on a given date: a day cannot be moved or put back onto a time the
class already runs, and the fill writes no second one where the class already has a
date at that time, running or cancelled. A day cannot be moved to a time the clocks
skip on that date.)*
*(17b-ii-b-ii-a, 2026-09-23, RULINGS that day: "this day and later" is a change
from an **Update from** date, on the time slot's Edit or a Calendar class's "This
and future classes". Classes before the date, and any that has started, are never
touched. A new day or time is a MOVE: the time slot ends the day before (or stops
outright when it has no class left before the date) and a new one starts on the
date; its classes from the date are replaced, one changed or cancelled on its own
included, and the server answers 409 `class_slot_replaces` with the count until
the request confirms that same number. A new length, size or coach keeps the
classes: the time slot is split at the date when it still runs before it — its
classes from the date move to the new one with their ids — and each takes the
values except one changed on its own. The date must be on the written calendar. A
time slot whose last day has passed no longer counts toward the cap.)*
*(17b-ii-b-ii-b, 2026-09-23: **Bulk edit** (TeamUp's name) is a new length, coach or
class size for the time slots of ONE class that staff tick, from one Update-from
date; a field not ticked keeps each time slot's own. Each time slot changes exactly
as its own Edit would, from the date or from its own first day when that is later.
All or nothing: an id that is not a running time slot of that class in that gym, or
one that does not run on its date, refuses the whole request. Days and start time
are not in it. **The limits:** at most 12 time slots of a class running at once (not
finished on the same date, whatever weekdays each runs), and at most 24 listed (not finished) — a time slot changed from a date is
listed twice until the date, and the Classes screen reads 24 a class.)*
An open-gym slot is a class type marked so. `schedule.manage` (owner and manager); a
trainer sees the lists of their own classes.
*(17g, 2026-10-09: **online classes.** A time slot is marked Online and carries the gym's
own video link (`gym_class_schedules.online`, `online_link`; `0089`); each class on the
calendar has its own copy, stamped when it is written, and a time slot that carries on
from another (a split or a move from a date) takes its answer; a class given a link of
its own keeps it on the class a move writes for its date. The link is an `https://`
address of a named site, at most 500 characters, with no sign-in written into it and no
character that cannot be seen ("Https://" is kept as "https://"); it may be added later. It is changed at `PUT …/class-repeats/:id/online` (the time slot and each
of its classes that has not ended, except one set on its own) and
`PUT …/class-sessions/:id/online` (one class, until it ends, which then keeps its own:
`online_alone`), both on `schedule.manage`, both keys every time. We host no video. **Who
is sent the link** is one rule, `classOnlineView` in `packages/shared/src/classOnline.ts`:
somebody who holds a place (booked, or marked came or no-show), from 30 minutes before the
class starts until it ends, in a class that runs; nobody waiting, nobody who cancelled or
was taken off, nobody else. A member's list keeps an online class under way that they hold
a place in, one that runs past the gym's midnight too, so Join class stays until it ends;
the screen reads the list again when a link is due and when the class ends, and every 20
seconds while a link is due and not there. Staff who run the timetable, and the class's
own coach, read the link with the class. The link is never written to the audit log. A
check-in at the gym never marks an online class, and the run after a class ends leaves it:
staff mark it. Places, the waitlist and cancelling are as for any class.)*

### 13.4 Booking and the waitlist — ONE rule, table-tested and raced

`gym_class_bookings`: session · person (the app account and the record) · status
(`booked` · `waitlisted` · `cancelled` · `late_cancelled` · `attended` · `no_show`) ·
when · whether a pack was charged · the request's idempotency key. **Book** is one
transaction under the session's row lock: places counted inside it, the pack charged
inside it, the same key twice the same answer. **Cancel** frees the place and, in the
same transaction, gives it to the first in line — **only when the class is more than
1 day away** (TeamUp's model and TeamUp's default, RULINGS 2026-09-21); inside that
time everyone waiting is told "a place is free" and the first to claim it has it,
through the same Book. **The gym's settings, with their starting values:** booking
opens 7 days before and closes at the start · cancelling is free until 2 hours before ·
the waitlist's hand-over time 1 day · the waitlist holds 20. After the free time a
cancel is a late cancel, and not coming is a no-show (Mindbody's words): counted, shown
to the gym, the pack keeps the charge; no money fee until Part 5. **Who may book:**
where the gym has any membership type, a person whose held membership covers the class
type — unlimited, or within their bookings a week (counted in the gym's own week), or
a pack with a class left, charged at booking and given back by a free cancel; where it
has none, any current member. The table test covers every class of case: kind of
membership × places (free · last · full) × time (before opening · open · inside the
free-cancel time · inside the hand-over time · after the start) × the request arriving
twice. The races are RUN, across two app instances (3a-iii-b's lesson: one app has one
database connection and cannot race itself).
*(17c-i, 2026-10-05: built as `decideBook`, `decideCancel` and `pickCover` in
`packages/shared/src/classBookings.ts`. The lock is the GYM's row and then the class's:
every timetable and membership write takes the gym's row first, so a booking takes it
too. A "no" is answered from a plain read and takes no lock. A booking is the app
account's, with its record on the list; a new row each time a person books again, the
cancelled ones kept. Outside the hand-over time a free place is the first in line's
before anybody else's: Book hands it over before it decides. Somebody waiting whose
membership no longer covers the class is passed over and keeps their place in line. The
pack is charged when the place is theirs, never for waiting. Which membership pays: one
that includes the class without counting, then one with bookings left in the class's
own week (Monday to Sunday) or month, then a pack, the one ending soonest first. A
membership counts if it runs on the CLASS's day; a late cancel and a no-show count
toward a week's bookings, a free cancel does not. "Gym only" includes an open-gym slot
and no class. A late cancel answers 409 `late_cancel` until the request says `lateOk`.
A booking keeps the key of the request that made it and of the Claim that took its
place from the waitlist; either arriving again changes nothing. A place the waitlist is
about to be handed reads as taken for anybody not waiting. A class staff cancelled does
not count toward a week's bookings. A class's coach reads who is coming and waiting,
not what they pay with.
The four settings are columns on `gyms` with the starting values; the screen that
changes them, the emails, and what happens to bookings when staff cancel, move or
delete a class, when a member is removed or an account deleted, are 17c-ii: until then
a class with a booking cannot be deleted (no cascade; staff are answered 409
`class_has_bookings`), so a pack's charge is never lost with it.)*
*(17c-ii-a, 2026-10-05: **bookings when things change.** A class that will not run takes
its bookings with it, and nobody pays for it: every booking on it ends, every pack
charged for one has its class back (a late cancel's too), the waitlist is cleared. Staff
**cancel one class**: the bookings stay as `cancelled`, and putting the class back does
not bring them back. Staff **cancel a time slot, archive a class, or move a time slot to
another day or time from a date**: the coming classes that go are deleted and their
bookings with them; bookings of classes before the date, and of a class that has
started, stay. Each of the four first answers 409 `class_has_bookings` with `ending`
(classes, booked, waiting, the first three people) and does nothing until the request
sends `confirmBookings` equal to booked plus waiting, counted again under the gym's
lock; `GET …/class-bookings/ending` is the whole list, 100 at a time. **One class moved
to another time on its day keeps its bookings. A class made smaller takes nobody out; a
class made bigger hands its free places to the waitlist by the usual rule.** **A member
who leaves** (removed by staff, taken off the list, or their account deleted) loses
their bookings of classes that have not started, their pack has those classes back, and
each place goes to the waitlist; a class that has started keeps its row. One function
for every way of leaving (`endLeaversBookings`, called where the membership is closed).
**The four settings** (and, since 17e-vi, personal training's own two beside them, §13.5)
are read and changed at `…/booking-settings` on
`schedule.manage` (Settings → Booking rules); they hold from the next booking on and
change none already made; a shorter hand-over time hands over at once the free places
it makes the waitlist's, and the save answers how many (`movedIn`). Nobody is emailed
yet: the box that asks says so until 17c-ii-b. `booked` and `waiting` count BOOKINGS:
in one class they are people, across several the box says "bookings" (one person on
three classes is three). `confirmBookings` is that count and not the list, so a booking
made and another cancelled between the box and its button leave it equal: the change
then ends a booking the box did not name, by at most what moved in that moment. The
list pages by a booking's id; its `seq`, one counter for every gym, is never sent.)*
*(17g, 2026-10-09: **staff take one person off a class**
(`POST …/class-sessions/:sessionId/bookings/:bookingId/remove`; `decideStaffRemove`):
whoever runs the timetable, and the class's own coach, before the class starts. A place
held is cancelled and is never a late cancel, so a pack always has its class back, and
the freed place goes to the waitlist by the usual rule; somebody waiting leaves the
waitlist and nobody else moves. A place a check-in marked came before the start is
removed as the booked place it was. The same removal again changes nothing. Once the class
has started staff mark the place instead (409 `class_started`). The screen asks first, in
a box under that person that names them and the class and says nobody else is changed;
nothing is sent until its Yes. Nobody is told until the inbox (20a).)*

### 13.5 Personal training

`gym_trainer_hours` (a member of staff, weekday, local from and to) and the session
length they offer (Mindbody's are 30, 45, 60 and 90 minutes). Free times are worked
out, never stored: the hours minus what is booked. An appointment is a row with the
trainer and its time range, and **the database itself refuses two that overlap** for
one trainer (an exclusion constraint on the range) — the structural rule, before any
check in code. A member picks a free time, is booked at once, and the trainer is told;
personal training's own free-cancel time applies (17e-vi); PT packs are a pack type that covers personal
training. A trainer keeps their own hours.
*(17e-i, 2026-10-06: **the staff side.** `gym_trainers` (offers, session length),
`gym_trainer_hours` (ISO weekday, minutes from midnight on the gym's clock, three ranges a
day at most, none overlapping) and `gym_pt_appointments`, whose EXCLUDE constraint on
`(gym_id, trainer_user_id, tstzrange(starts_at, ends_at))` over the statuses that hold
time is the structural rule (`btree_gist`, migration `0079`). The rule in words is
`decidePtBook`, `decidePtCancel` and `pickPtCover` in `packages/shared/src/personalTraining.ts`,
decided under the gym's lock. A session is held by the person's RECORD, so somebody
without the app can be booked; it keeps its request's key, so the same request again
changes nothing. Free times are each range of hours cut into sessions from its start,
less what is booked and what has started; a time the gym's clock skips is never offered.
**What pays:** a membership type has `includes_pt`; "every class" does not include it. A
membership that includes it pays first and is not charged; else a pack, the one ending
soonest, is charged one; a class limit a week or a month does not count sessions; a gym
with no membership types books anybody on its list. **Cancel** is free until the gym's
free-cancel time (the one classes use) and gives a pack its session back; after it the
request says which: a late cancel that keeps the session used, or `giveBack`. **Who:**
`schedule.manage` sees and changes every trainer; anybody else on staff has their own
hours and sessions; booking also needs `members.confirm`, since it picks a person from
the member list. The console's Personal training page (`/console/:slug/personal-training`)
is in every member of staff's menu. **From Kd's click-through (RULINGS 2026-10-06):** a
session is any length from 10 to 240 minutes on a five-minute mark; whoever runs the
timetable sees a Trainers list and Add a trainer, never themselves as a trainer they are
not; a free time is a button reading its whole session; the booking box lists the member
list at once (`GET …/pt/people`, `members.confirm`: people holding something that
includes personal training first, with a pack's sessions left; `query` narrows it by
part of a name or an email), and where the gym sells memberships somebody holding
nothing that pays is named and cannot be picked. **A class the trainer coaches takes
their time too** (RULINGS 2026-10-06; TeamUp blocks it the same way): a taught class on the
calendar with them as its coach, not cancelled, comes off their free times and refuses a
booking over it (409 `trainer_in_class`), read from `gym_class_sessions` under the gym's
lock; an open-gym slot takes nobody's time. The week answers each day's `classes` and
the page lists them as not free; a session that a class was put over afterwards says it
runs into it (the class side asking first is 17e-iii). The calendar is written 56 days
ahead and sessions are booked 55, so the classes of every bookable day are there once the
nightly fill has run. **From the review (2026-10-06):** the people list runs `pickPtCover`
itself for the session's day (`day` on the request, else the gym's today), so what it names
is what the booking charges; a booking carries the session's `minutes` and is refused
`not_a_time` when the trainer's length has changed since the page was read; a session
already late-cancelled answers 409 `kept_used` to a give-back or a plain cancel, and 200
only to the same late cancel again (a late-cancelled session cannot be given back
afterwards yet); the other way round, a late cancel on a session already cancelled with
nothing kept answers 409 `not_kept`; the membership's name on a session goes only to staff with
`members.confirm`; changing a membership type must say `includesPt`. Nobody is told yet (the inbox, 20a). Not done: the class side asking first and a trainer's time off (17e-iii, built next);
the member's own booking (17e-ii); sessions ended when a person leaves, a membership is
cancelled or a trainer leaves the staff, came and no-show (17e-iv).)*
*(17e-iii-a, 2026-10-06: **the class side asks first.** A change to the timetable that would
put a taught class over a session already booked with its coach answers 409
`class_over_pt_sessions` with `sessions` (their whole `count`, a `mark` that is one value
for exactly those sessions, and the first 100, the earliest first: the person, the trainer,
the class, the session's own day and time) and writes nothing. The same request with
`confirmTrainerSessions` equal to that mark, worked out again under the gym's lock, goes
through, and the sessions stay booked and charged as they were: the app never cancels a paid
session by itself, and the session goes on saying it runs into the class until staff cancel
it and book another time. A mark and not a number: one session cancelled and another booked
while the box is open leaves the number the same, and is asked about again. It is asked on every write that can do it: a
new time slot, a time slot changed from a date (its coach, its length, its days or time),
"This and future classes", the bulk edit, one class changed, a cancelled class put back
(its route now takes a body), and an open-gym class made a taught one. One wrapper in
`classes/repo.ts` (`askingTrainers`) does it for all of them: the write names its coaches,
the sessions their classes run into are read before and after it in the write's own
transaction (`sessionsUnderClasses` in `pt/repo.ts`), and a session under a class (its own
row on the calendar) that was not over it before is new; with a new one unconfirmed the
whole write is rolled back. So the same class made longer, or moved on its own day, over a
session staff already said yes to is not asked about again; any other class put on that
trainer over it is, a second time slot of the same class included, and so is a time slot
moved to other days or another time, whose classes are written again. A booking takes the
same lock, so a session booked while the box is open changes the count and the box is shown
again. Never asked: another coach, no coach, an open-gym slot, a cancelled class, a cancelled
session, a class that only touches the session's start or end. The console shows the box
where the form's Save was (`TrainerSessionsBox.jsx`): the sessions, what saving does, that
nobody's session or pack changes, **Save anyway** (or **Un-cancel anyway**) and **Go back**;
a change to the form takes the box away. **The nightly fill is outside the wrapper**, and
safe while a booking can only land on a day whose classes are written: a booking for a day
in the last week of its window writes that gym's calendar first (`pt/service.ts` `book`), so
a night the job missed cannot leave a session under a class written later. Nobody is told
(the inbox, 20a). Not done: a trainer's time off (17e-iii-b, built next).)*
*(17e-iii-b, 2026-10-06: **a trainer's time off.** `gym_trainer_time_off` (migration `0081`):
whole days of the gym's, or some hours of one day, with that time kept as two instants in the
gym's zone; up to a year long, starting up to a year ahead, 50 not yet over a trainer. It
takes the trainer's time as a session or a class does: it comes off their free times, and a
booking in it is refused 409 `trainer_off` (`decidePtBook`), read under the gym's lock.
`POST …/pt/trainers/:userId/time-off` adds one and `DELETE …/time-off/:id` removes one;
staff who run the timetable for anybody, a trainer for themselves; each answers the trainers
list, whose rows carry `timeOff` (those not over). **It asks first:** with sessions booked
with the trainer in it, or taught classes on the calendar they coach in it, it answers 409
`time_off_over_bookings` with `over` (a `mark` for exactly those, each kind's whole count
and first 100, and `classesUpTo`, the last day whose classes are on the calendar) and writes
nothing; the same request with `confirm` equal to the mark, worked out again under the lock,
adds it, and every session, pack and class stays as it was. A booking takes the same lock, so
of a booking and a time off sent together one always sees the other. The same `requestKey`
again adds nothing. The week answers each day's `timeOff`; the page marks the day, and a
session or class left in it says so. The console's **Time off** button is on each trainer's
row and on a trainer's own card. **From Kd's click-through (RULINGS 2026-10-06):** the days
are pressed on the console's calendar (`DatePick`), never typed, and Remove asks first in a
box under its own row (whose time off, which days, that nothing booked changes).
**From the review (2026-10-06):** a gym's change of time zone works every time off's two
instants out again in the same step (`reworkTimeOffInstants`, as events' are), so a day off
stays that day on the gym's clock; hours of one day whose start or end the gym's clock skips
that day (the hour the clocks go forward over) are refused 409 `time_off_not_a_time`, and
whole days are as long as those days are; the Remove box says the times can be booked again
only where no other time off of that trainer covers them, and otherwise that the other one
stays; a request the server answers `request_reused` gets a new key and the list is read
again; somebody who cannot book is told to ask a manager, in the box and on a session. Not done: the Classes page does not ask before it gives a
trainer a class inside their time off (their week marks it); nobody is told (the inbox, 20a).)*
*(23d, 2026-10-07: **every step to a first session, with ticks.** Whoever runs the timetable
(`schedule.manage`) reads a list above the trainers until every step is done; it is then
gone, and is back if a step comes undone. Nobody else is sent it. The page's read of its
trainers carries `setup`, four facts about this gym alone, read in one statement
(`setupOf`), each true while its thing is there:

| Step | Its button opens | Ticked while | Button for |
|---|---|---|---|
| Add a trainer and set their hours | Members → Staff, the Invite staff form open | a member of staff has hours saved | `staff.manage` (greyed with no live plan) |
| Sell a membership or pack that includes personal training | Memberships | a type that is not archived has `includes_pt` | `memberships.manage` |
| Give it to a member | Members | somebody on the list holds one in use (running or frozen; a pack with a session left, inside its days on the gym's own day), or a session booked on one still holds its time: a pack of one session is used up by the first booking, and the gym did give it | all staff |
| Book a session | (on this page) | a session is booked, or took place; a cancelled one does not count | — |

A gym with no membership types has three: the two in the middle are one, "Put your members
on your list" (somebody on the list). The step to do next has the orange button. A step
whose place the reader cannot open has no button and says who can. "Somebody holds it" is
the rule the picker orders its people by (`holdsPt`), so the tick and "people with personal
training first" agree; what one person can be booked on is still `pickPtCover`'s to say.
A booking or a cancel reads the steps again while they are on screen. **From Kd's
click-through:** a time that can be booked is an "available time" on every line of the page
(it was "free time"), a trainer is "available", and a trainer's name in the Trainers list
opens their week as See week does, with the week brought into view.)*
*(17e-ii, 2026-10-08: **the member books and cancels their own.** Three routes for a live app
member of a gym on a live plan, 404 for anybody else: `GET …/member-pt?week=0..7` (seven of
the gym's days: the trainers taking sessions, each day's times that member can book, what
would pay on each day by the booking's own rule, and the reader's own coming sessions,
whoever booked them), `POST …/member-pt/sessions` and `POST …/member-pt/sessions/:id/cancel`.
**Nothing takes a person from the request:** the session is for the reader's own record on
the gym's list, read under the gym's lock; a body that names one is a 400; a session is found
only where it is that record's. What takes a trainer's time is read as spans alone
(`busyOfTrainers`), so no name, class or time off reaches a member, and a time that has gone
is refused in one sentence whatever took it (`PT_MEMBER_WORDS`). The booking and the cancel
are the staff side's own rule (`bookUnderLock`, `cancelUnderLock`). **What differs for a
member:** a time can be booked once the gym's class bookings would be open for it (Settings →
Booking rules, 7 days to start with; 409 `not_open_yet`), never past the eight weeks; a late
cancel keeps the session used and a member cannot give one back (`{ lateOk }` alone); their
own session takes their own time with every trainer; a trainer who is also a member is not
offered themself; somebody in the app with no record on the list reads so and books nothing
(409 `not_on_list`). A time somebody already holds is refused from a plain read before the
lock, in the server's line of members' writes. The audit rows are `member.pt_booked` and
`member.pt_cancelled`. The member web's **Personal training** tab on My Gyms, beside Classes:
a row of the seven days picks one (the first with a time opens), and each of that day's
available times is a button reading its whole session that books at one press; with
nothing that pays the times show as plain text under who to ask; Your sessions has Cancel
session, which asks first and says what a late cancel costs. **From Kd's click-through:**
the read also answers `history`, the reader's own sessions that are over or were cancelled
(the newest 20 of the last 60 days), and they stay in the one Your sessions list under the
coming ones, greyed, each saying what happened (Cancelled · Cancelled late · You came · You
missed this session · Past); the box before a cancel names the gym, whose setting the time
to cancel for free is; what a booking uses reads "You have PT 10 pack: 10 sessions left.
Each booking uses 1 session." **The gym's booking rules are said where they apply:** the
console's Classes and Personal training pages carry one line ("Members can book up to 7 days
ahead and cancel for free until 2 hours before it starts.") with **Change booking rules**,
which opens the box in Settings (`#booking-rules`, the place `bookingRules`, on
`schedule.manage`); staff who may not change them read the cancel rule and "A manager can
change the booking rules." The box is named **Booking rules** (it was "Class bookings"):
one rule set covers classes and personal training (its own for personal training is 17e-vi).
**From the review (2026-10-08):** a record that two live app accounts hold (two records
joined on the console leave both accounts on the kept one) is nobody's in the app: the read
answers `record: "shared"` with no session and no history, a booking is refused 409
`record_shared`, a cancel finds nothing, and staff go on running its sessions from the
console; `record` is `own`, `none` or `shared` (it was `onList`). The read also answers 404
for a closed gym; a member's cancel is refused in a member's words
(`PT_MEMBER_CANCEL_WORDS`); a press answered with a session cancelled since is never said
as booked. Nobody is told (the inbox, 20a):
the session is on the trainer's week. Not done: sessions ended when a person or a trainer
leaves, came and no-show (17e-iv).)*
*(17e-v, 2026-10-08: **a limit on sessions.** A membership type that includes personal
training has `pt_limit` and `pt_period` (migration `0084`): so many sessions a week or a
month, both NULL for no limit, which is what every type had. A pack has none (its own count
is its limit), and the table's CHECK refuses one on a pack or on a type without personal
training. **What is used is never stored.** It is counted from `gym_pt_appointments` by the
membership the session was booked on, over the session's own week (Monday to Sunday) or
calendar month on the gym's days, the periods a class limit uses (`bookingPeriod`); a late
cancel and a missed session are counted (`PT_COUNTED`), a free cancel and a session staff
give back are not; nothing is carried over. **What pays** (`pickPtCover`): a membership with
no limit, then one with sessions left in that week or month, then a pack with a session
left, which is charged; with none of those the booking is refused 409 `limit_week` or
`limit_month`, for staff as for a member, and nothing is written. The count is read under
the gym's lock in the booking's own transaction (`heldWithUsed`), so two presses at one
instant cannot both take the last session. A limit changed on the price list holds from the
next booking; sessions already booked past a lowered limit stay. The count belongs to ONE
held membership: two memberships of one limited type on a record each have their own
sessions, and a membership cancelled and given again starts with none used. A session
carries `usesLimit`, so the console's late-cancel box offers "Late cancel: the session
stays used" and "Cancel and give the session back" as it does for a pack, and a member's
boxes say whether it still counts. Where a pack pays because the membership's sessions are
used, `limit` names that membership with none left and both screens say so. A change to a type must
say `ptLimit` and `ptPeriod` outright, as it says `includesPt`. The picker's rows and a
member's days carry `limit` (the membership, its number, its period and what is left) where
the paying membership has one, or where nothing pays because one is used. On the screens:
the membership form has **Personal training sessions** (No limit · A limit on sessions) with
the number and "a week / a month"; the price list's line reads "4 personal training sessions
a month"; the picker reads "Gold · 3 of 4 sessions left that week" and somebody with none
left cannot be picked; a member's tab reads "You have Gold: 3 of 4 sessions left this
week." and, once used, "You've used all 4 personal training sessions Gold includes this
week. You can book for Mon 12 Oct or later." with the times as plain text. **From Kd's
click-through:** a member's pressed time opens **Book this session?** (the day, the time,
the trainer, what it uses; Book session · Not now), so nothing is booked by one press. Not done:
personal training's own booking rules (17e-vi).)*
*(17e-vi, 2026-10-09: **personal training's own booking rules.** A gym has `pt_opens_days` and
`pt_free_cancel_minutes` (migration `0085`, CHECK `gyms_pt_booking_settings_check`: 1 to 56
days, 0 to 10,080 minutes, the limits the classes' same two have). The migration starts each
gym's two at its class numbers of that day, so nothing changed for a gym until it changed
one; a new gym's start at 7 days and 2 hours. **A session reads these two and never the
classes'; a class never reads these.** There is one place a session gets them, `gymClock`
in `pt/repo.ts`, which the week, the member's read, a booking and a cancel all call; a
cancel reads it in its own transaction under the gym's lock, the lock a save takes, so of a
save and a cancel sent together one sees the other. `opensDays` holds a MEMBER's own
booking (409 `not_open_yet`); staff book further ahead, as before. `freeCancelMinutes`
decides free or late for a member and for staff, and is the `freeCancelMinutes` and
`freeCancelUntil` the personal training reads answer. **A changed number holds from that
moment for every session, the ones already booked too** (it is read at the cancel, never
stored on the session), and cancels nothing. `GET` and `PUT …/booking-settings`
(`schedule.manage`) answer `settings` (the classes' four) and `pt` (these two); a save
sends all six every time (`bookingSettingsBodySchema`: the four, and `pt`), and the audit
row names a changed one `pt.opensDays` or `pt.freeCancelMinutes`. On the screens: Settings →
Booking rules has two headed parts, **Classes** (the four) and **Personal training** (When
booking opens: N days before the session · Free cancelling: until N minutes, hours or days
before the session), saved by the box's one Save; its closed line reads "Classes: opens 7
days before · free to cancel until 2 hours before · waitlist of 20. Personal training: opens
3 days before · free to cancel until 1 day before."; a number outside its range is said as
"Personal training, when booking opens: pick 1 to 56 days." The rules line on the console's
Personal training page says personal training's two and the one on Classes the classes'
(`BookingRulesLine`, `of`). On a member's tab a day past the last one open reads "Booking for
this day isn't open yet. You can book up to Sat 10 Oct." and shows no times: with a gym's
number as low as one day, such days are on the first page. **From the review (2026-10-09):**
on the last open day a time opens `opensDays` before it starts, so the later ones are not
open yet; the member's read answers `opensDays` and each trainer's day `opensLater`, and the
tab says under the trainer "Times on this day aren't open yet: each one opens 1 day before it
starts." (or "More times on this day open later: …" under the ones that can be pressed),
never "No available times on this day." for them; a time pressed too soon is refused as
"Booking for that time isn't open yet."; the trainer's week answers `freeCancelMinutes`,
so the console's late-cancel box names the length the same read decided "late" by.)*
*(17e-iv-a, 2026-10-09: **sessions when a person leaves.** A record taken off the gym's list
ends the coming sessions booked for it, and a membership staff cancel ends the coming
sessions booked on it: each becomes `cancelled`, the trainer's time can be booked again, and
a pack has each session back (a limit has it back too, since a cancelled session is not
counted). "Coming" is `booked` and not started; a session that has started, took place, was
missed, was cancelled, or was cancelled late with the session kept used, stays exactly as it
is. Nobody else's session or pack is read or written. **One rule, called where the record
goes** (`pt/changes.ts`): `endLeaversSessions` is called inside the three statements that
make a record a past member (`setEntryFormer`, `setEntriesFormer`, `markEntriesFormer` in
`memberList/repo.ts`), so every door ends them: Remove on a person's page, Remove on the
people ticked (both tabs), Remove on a person in the app, Remove from staff and app, and an
import's They've left. A membership's cancel ends them beside its class bookings
(`endMembershipBookings`); cancelled at the end of what is paid, only the sessions after its
last day. All of it runs in the removal's own transaction under the gym's lock, the lock a
booking takes, so of a removal and a booking sent together one sees the other, and a pack
session comes back once however often the request arrives. **Each names them first.** The
sessions are `PtSessionsEnding` (`ptSessionsEnding.ts`): their whole `count`, how many go
back to a pack, the first 100 (person, trainer, day, time) and a `mark` that is one value
for exactly those sessions. The Remove box and the import's leavers box carry it as
`preview.ptSessions`, and it is part of the box's `digest`, so a session booked or
cancelled while the box is open answers `remove_changed` or `leavers_changed` with the new
box and removes nobody. Removing ONE person (`DELETE …/member-list/entries/:entryId`,
`DELETE …/members/:userId`) answers 409 `pt_sessions_ending` with `sessions` and does
nothing until the request sends `confirmPtSessions` equal to the mark, worked out again
under the lock. A membership's cancel answers its 409 `membership_has_bookings` with
`ending.ptSessions` beside the classes (either may be none) and needs `confirmPtSessions`
as well as `confirmBookings`. **What does not end them:** somebody removed from the app
whose record stays on the list (a shared email the list cannot place, "Not this person"),
and an account its owner deletes: a session is held by the record, staff book and run
sessions for people with no app, and the record is still on the list. Put back brings no
session back. Two records joined keep their sessions on the kept one, as before. On the
screens one part (`PtSessionsEnding.jsx`) is in every box: "2 personal training sessions
will be cancelled", each session's person, day, time and trainer (three, "and N more", See
all), what happens to packs, that a started session stays, and that the app tells nobody
yet. **From the review (2026-10-09):** every removal and a membership's cancel read ONE
clock, the one a booking reads (`now` on the member list's, the memberships' and the orgs'
routes; they each read the real clock before, which is the same in production and was not
in a test); a session that starts at that very instant has started and stays; a session is
said to go back to a pack only where the pack is still there to take it; a removal's audit
row counts the sessions it ended and the pack sessions it gave back (`ptSessionsEnded`,
`ptPackSessionsBack`, and `org.pt_sessions_ended` for an import), never a name; the box says
"The time is free again." and names no trainer, since a session may have none left; a
membership's box with classes and sessions says once that the app tells nobody. Not done:
a trainer leaving the staff, came and no-show (17e-iv-b, built next); nobody is told (the
inbox, 20a).)*
*(17e-iv-b, 2026-10-09: **a trainer leaves the staff, and came or no-show.** A trainer's
staff row is deleted at three doors, and each ends the coming sessions booked WITH them
(`endTrainersSessions` in `pt/changes.ts`, called where the row is deleted): they become
cancelled and a pack has each back; one that has started, took place or was cancelled late
stays. **Remove from staff** (`DELETE …/staff/:userId`) and **Remove from staff and app**
(`DELETE …/members/:userId?alsoStaff=true`) name the sessions first: 409
`pt_sessions_ending`, nothing written, until the request sends `confirmPtSessions` equal to
the mark, worked out again under the gym's lock. Removed from staff and app in one step,
ONE mark covers the sessions booked with them and the ones booked for them; removed from the
app alone they stay a trainer and the sessions they give stay. **An account its owner
deletes** ends them with no box (nobody is there to ask), by the gyms' clock; an owner who
deletes theirs keeps the gym, so theirs stay. The audit row (`org.staff_removed`) counts
the sessions ended and the pack sessions given back, never a name. A role change, and
"isn't taking sessions", end nothing: the person is still on the staff. On the screen the
box over the page says which removal it is ("Remove Sam from staff?", "… from staff and the
app?") and each line leads with the person booked. **Came or no-show:**
`POST …/pt/appointments/:id/mark` with `attended` or `no_show` (`decidePtMark`): only once
the session has started (the instant it starts counts), never a cancelled or late-cancelled
one; whoever runs the timetable marks any trainer's and a trainer marks their own; the same
mark again changes nothing and a mark can be changed to the other. Either way the session
stays used: the pack stays charged and a membership's limit still counts it (17e-v), so no
mark moves a pack or a limit. No fee (18h), and nothing marks a session by itself (a desk
scan near a class is 17f). A session reads `canMark`; the Personal training page shows
"Not marked yet" with **Came** and **No-show**, then the mark with one button to change it,
and a no-show says what stays used. **The week turns back:** `from` may be up to 28 days
before today (`PT_PAST_DAYS`, `firstDay` on the read), so an earlier session can be marked;
nothing on a day gone by is free. **The page shows one day at a time** (Kd's click-through,
RULINGS 2026-10-09): a trainer is one short row, their hours on as few lines as say them;
the week is a strip of its seven days, each with one note (sessions to mark, else how many
are booked, else a whole day off); the open day, today where the week holds it, shows
Booked first and then Available times. **From the review (2026-10-09):** a trainer's box
says "Nobody can be booked with them after this.", never that their times are free again;
a removal that will be refused is refused BEFORE its box (403 for staff who may not change
the list, 404 `member_not_found` for "from staff and the app" on somebody who was never a
member); `DELETE …/staff/:userId` is limited (60 an hour a person, 300 an address); a day of
the strip says "booked" only for sessions still to come. Not done: the sessions of a trainer already off the staff
that were never marked cannot be opened (their week needs them on the staff); nobody is told
(the inbox, 20a).)*

### 13.6 The calendar, the desk and the messages

Staff: a week view of classes and personal training, filtered by coach or type, each
session opening its list (booked, waiting, came, no-show). Members: a list by day with
Book · Cancel · Join waitlist · Claim, on the phone (the member web until the phone app
exists), every time in the GYM's time zone and named where the phone's differs. A desk
scan (§12) from 30 minutes before a booked class until it ends marks the booking
`attended`; 15 minutes after the end a worker marks the rest `no_show`, safe to run
twice. Booked · on the waitlist · moved in · a place is free · class changed or
cancelled · PT booked or cancelled: fixed-word emails now, phone notifications with the
phone app (Part 7 of the re-plan).
*(2026-10-05, RULINGS that day: the booking emails are not built. A member is told in the
app, by the inbox and the phone's notification; until then staff tell them.)*
*(17d, 2026-10-05: **the member's side.** `GET …/member-classes?week=0..7` answers the
gym's classes that have not started on seven of its own days (week 0 starts today), the
soonest first, each exactly as that class's own read answers it, with the week's first
and last day and the gym's time zone; for a live app member of a gym on a live plan, 404
for anybody else. `week` is one digit and nothing else. A page holds 500 classes at
most and answers `more` when the week has more, which the screen says. The person's
memberships are read once for the page (two statements), not once a class, and so are the
waitlists, and their people's memberships, of the classes with a free place to hand over. The member web's Classes tab on My Gyms, beside Updates and
Leaderboard, lists them by day on the gym's clock and names the gym's zone when the
device's differs; one button to take a place (Book · Join waitlist · Claim place) and one
to give it up (Cancel booking · Leave waitlist), a box before every cancel that says
what it costs; the week is read again after every Book and Cancel, since one booking
changes what the others say; a free place that is the first in line's reads "Full" to
anybody else; waiting reads "On the waitlist, not booked", never as a booking. It is a
plain screen, the member web's until the phone app has its own. Not on it yet: the
class's coach.)*
*(17c-iii, 2026-10-05: **who is booked, and a cancelled membership.** A class opened on
the Calendar draws its list under its name: Booked ("3 of 12 places"), the Waitlist in
its order, and Cancelled late, from `GET …/class-sessions/:sessionId/bookings` (17c-i):
staff with `schedule.manage` read what each person booked with, the class's own coach
the names alone, any other staff are told who can see it; a cancelled class asks for no
list, and a save reads it again. A name opens that person's page over the Calendar
(Kd's click-through): the list carries each person's record on the gym's list
(`entryId`) for staff who hold `members.confirm`, and for nobody else; closing the page
reads the class's list again. **A membership staff cancel on a person's page ends the
places booked on it** in classes that have not started: cancelled today, all of them;
cancelled on its last paid day, those on a day after it. A pack has those classes back
and each place goes to the class's waitlist by the usual rule, in the cancel's own
transaction under the gym's lock. A place booked on the person's other membership or
pack is not on this one and stays, as does a class that has started; somebody waiting
has no membership on their row, so no waitlist place ends. The cancel first answers 409
`membership_has_bookings` with `ending` (the classes, a hundred at most) and does nothing
until the request sends `confirmBookings` equal to their number, counted again under the
lock; the box names the classes, says what stays, and has its own button. Not done: a
membership frozen, or one whose last payment mark is taken back, keeps its bookings.)*
*(17f, 2026-10-09: **check-in meets bookings.** The window is **one hour** before the
class starts until it ends, both ends included (Kd, RULINGS 2026-10-09; the 30 minutes
above was the plan's), and the rest are decided 15 minutes after the end
(`CLASS_CHECKIN_BEFORE_MINUTES`, `CLASS_NO_SHOW_AFTER_MINUTES` in `classAttendance.ts`;
fixed numbers, not yet a gym's setting). **A check-in** is the desk's scan of a pass or a
key tag, or staff's Check in on the console (`writeNamedVisit`, the one way a visit is
written); a second one the same day, which writes no new visit, counts too. It marks
`attended` the places still `booked` of the ACCOUNT it named, in this gym's classes that
run and whose window holds that moment (`checkinMarksBooking`, `markCameAtCheckin`), under
the gym's lock where there is one to mark. Never by a record or a name: a key tag whose
record the list cannot say is one person's marks nobody's place. A place on the
waitlist, cancelled or cancelled late is not touched. **The run** (`orgs.class_no_shows`,
every five minutes; `markEndedClasses`) reads each gym's places still `booked` in classes
that ended 15 minutes ago or more and decides each by `decideClassSweep`: `attended`
where a check-in in the window names the person's own account (a check-in whose mark
never reached the booking; a pass always, a key tag's or staff's only while no second
member holds its record, since one of two people on a record showing a pass later is
written onto the tag's visit); left as it is where a check-in in the window names only a
record the booking was made for or the person holds; left as it is where the person has
ANY visit at the gym that day (an earlier check-in, their own tap, a visit staff added:
not proof they came to the class, and never proof they did not); left as it is where the gym checked
NOBODY in during that window, since a gym that does not use check-in, or whose desk was
off that hour, has no evidence about who came; `no_show` otherwise. A member's own tap
and a visit staff add for an earlier day are no check-in: neither marks came. A class that ended more than
48 hours ago is left for staff. Only a `booked` place is ever written, a gym at a time
under its lock, so a second run changes nothing. **Both marks keep the class used:** a
pack stays charged and a limit still counts it, and no mark moves either. **Staff's own
mark:** `POST …/class-sessions/:sessionId/bookings/:bookingId/mark` with `attended` or
`no_show` (`decideClassMark`), for whoever runs the timetable and the class's own coach,
only once the class has started, never in a cancelled class, only a place that is held;
the same mark again changes nothing, a mark can be changed to the other, and an audit row
(`org.class_booking_marked`) says what it was. It answers the class's list, which carries
`canMark` (started, and runs). **For the member:** checked in before the class, their
place reads "You're checked in for this class", offers nothing to book, and is theirs to
cancel as any booked place, free or late by the gym's rule, until the class starts; the
check-in routes read the clock the booking routes read. **A mark made before the start is
taken back** to `booked` (`putBackToBooked`, under the gym's lock) when staff remove the
visit and no visit of theirs is left that day, and when the class is changed so that it
starts more than the hour away; somebody who leaves the gym, or whose membership staff
cancel, gives such a place up as a booked one, the pack's class back. On the Calendar a class's Booked list says, once the class has
started, "Not marked yet" with **Came** and **No-show**, then the mark with one button to
change it, a no-show on a pack saying the class stays used, and one line saying how the
marks get there by themselves; before the start a check-in reads "Checked in". Personal
training is still marked by hand (17e-iv-b). Not done: no fee (18h); nobody is told
(20a); a mark by staff writes no visit, so somebody marked Came who never checked in has
no gym day for it; somebody who checked in more than an hour early stays "Not marked
yet" for staff (never a no-show); a class moved by a few minutes keeps a mark whose
check-in is now just outside the hour.)*

### 13.7 Cost at full size, cards, the two extra passes

Measured by the cards: a week's calendar for a gym of 2,100, a session's list, and the
burst when a popular class opens — two hundred people booking inside a minute from the
gym's own wi-fi, so every limit here carries an explicit per-address ceiling (ROADMAP
Stage 4 item 10's lesson). Cards, every one Opus xhigh: **17a** membership types and a
person's membership · **17b** classes and the calendar · **17c** booking and the
waitlist, on the server · **17d** the member's side · **17e** personal training ·
**17f** check-in meets bookings. 17a and 17c–17f need the durable record (3a-v-b) and
`entry_id` on the membership (3b-ii); 17b needs neither and can be built beside the
member list. ONE feature for CLAUDE.md §6: both extra passes run once over 17a–17f.

**What the two passes changed (17h, 2026-10-10):**
- A staff route's limit on Classes and Memberships is asked only of the gym's own staff, so
  nobody else at the gym's address can use it up.
- A record taken off the list (by hand, ticked, or left out of an import) loses its coming
  class bookings as it loses its sessions: the pack has the class back and the place goes
  to the waitlist, whether or not the person's app ends.
- One person holds one membership type once at a time: a second that would run over the
  same days is refused ("They already have Gold Monthly. Cancel that one first.", and "or
  pick a start date after it ends" only where the one they hold has a last day). Class
  packs are not asked.
- Two records are not merged while the kept one would hold a type twice, or have two
  personal training sessions at one time; staff are told what to cancel first.
- A box that ends bookings is confirmed by `ending.mark`, the mark of exactly the bookings
  it counted, sent back as `confirmBookings`; a count is no longer taken.
- A timetable write reads the clock again once it holds the gym's lock.
- A gym has one live class of a name, in any capitals.
- A class's name and description, and a video link, hold nothing hidden; a link's site is a
  plain name ending in letters; a day's year is 1900 to 2199.

### 13.8 Where the facts came from (read 2026-09-21)

PushPress help: "Create, Edit & Delete Membership Plans" (recurring, non-recurring,
session pack) and "Drop-ins — Best Practices" (a drop-in is a punchcard with a session
count of 1); its barcode article names "plans with limited class access" · Gymdesk
docs: "Setting Up Memberships" (recurring, one time, per-session, trial) · TeamUp help:
"Waitlist overview" (added from the waitlist by itself only when the place opens more
than a set time before the event, default 1 day; inside it the customer "will need to
manually claim the spot") and "Cancelling classes, class schedules, and Class Types" ·
Mindbody support: "How to manage early cancellations, late cancellations, and no-shows
for classes" (the business sets the window; a fee or a visit deduction) and its
scheduling page (session lengths, real-time trainer availability) · Glofox's blog on
class scheduling (the next person on the waitlist is told by SMS or push). **Read 2026-10-05 for 17a-iii's screen:** TeamUp, "Switching to TeamUp from a
spreadsheet" ("We need at least memberships set up in order to complete the import";
"we'll either need memberships to match the names of the memberships in your previous
system, or we can ask for the matches before completing the import") · PushPress,
"Migration of your Members/Clients from Another Platform" ("Assign membership plans,
apply discounts, and set dates. You can do this one-by-one or with bulk assign";
"Select a cohort and apply in one step"; "Bulk edit plan details and set remaining
sessions") · Gymdesk, "Data Imports Overview" (its membership import's fields:
"Member Name · Membership Title · Payment Amount · Recurrence Details · … Start Date ·
End Date · … Next Payment Date"). Not opened
that day, and general to every product the chat knows: the week calendar, and a desk
check-in marking a booking attended — each card checks its own before it builds.

---

## 14. Money between a member and their gym

*(ADDED 2026-09-22, the same planning chat: Part 5 of Kd's planning document, agreed
that day — RULINGS 2026-09-22, two lines. A frame. What people pay US — the price list,
trials, Paddle — is `05-part5-billing.md`, amended the same day. Opus xhigh: money.)*

**The worst thing this section could do to a real person:** charge a member twice, or
after they cancelled; let a stranger move money through a gym's payment account; or
show "Overdue" at the front desk about somebody who has paid. The first tests written:
the same payment message arriving twice records ONE payment; a cancelled membership is
never billed again; nothing that opens a gym's payment account — a token, a secret —
ever appears in a log line, an error, a reply or Sentry.

### 14.1 The shape: a register and a notebook, and a card machine plugged in later

The app never holds a member's money and takes no part of it (Kd). It keeps the gym's
NOTEBOOK — what each person owes, their bills, their payments — and its REGISTER — the
desk's Sell screen. A payment company is the card machine: one adapter each behind ONE
interface, so that adding or changing a company touches nothing else, and no company's
SDK types cross the adapter (CLAUDE.md §4, Money). Everything in 14.2 to 14.4 works
with no company connected, which is what is built first (Kd: the payment parts *"WILL
BE BUILT BUT ACTUAL MERCHANTS WILL BE CONNECTED LATER"*).

### 14.2 The notebook

For every held membership (§13.2): a billing schedule (the next date and amount, from
the type's price and period, in integer minor units of the gym's currency), **bills**
(`gym_member_bills`: person's record, what for, amount, due on, status `open` · `paid`
· `void` · `refunded`) and **payments** (`gym_member_payments`: bill, amount, how —
`cash` · `card_at_desk` · `bank_transfer` · `link` · a connected company — when, who
recorded it, the company's own id where there is one, UNIQUE so the same event twice
is one row). Paid · due · overdue is worked out by the server from those rows on an
injectable clock, never stored as a word that can go stale. A daily worker opens the
next bill for a repeating membership, safe to run twice (one bill a membership a
period). Staff record a payment, void a bill, or note a refund; every change has an
audit row of amounts and ids, never a card detail. `billing.members` is a new tick
(owner and manager), apart from `billing.manage`, which is the gym's own plan with us.
The status word a gym's FILE carried (§11) stays what that gym sees until it starts
billing here; the two are never mixed on one person.

**As built, 18a-i (2026-10-10; RULINGS that day).** A bill is one period of one held
membership (`gym_member_bills`, one a membership a period); a membership's count of
paid periods (§13.2) is still what its dates are worked out from, and it moves on only
with the payment that settles the bill of the first unpaid period.
- **Opened by itself**: when a membership is given, and by an hourly run for every
  period that has begun since (each gym on its own day). A bill keeps the days it was
  opened for and the day it fell due: a later freeze moves the membership's dates and
  never a bill's. Nothing is opened for a
  membership that is cancelled, ended, frozen, free, set to stop at the end of what is
  paid, or a past member's. A bill already owed stays owed after the membership ends,
  so somebody who left without paying is still found.
- **Record payment** (a person's page → Memberships): the amount, starting at what is
  left, and how it was paid (Cash · Card at the desk · Bank transfer). Less than what
  is left keeps the bill Due for the rest; more is refused. Periods are paid in order.
  Giving a membership as paid records its payment in the same step, so the Add form
  asks how they paid.
- **Paid · Due · Overdue** is worked out on the gym's own day and stored nowhere. A bill
  reads Overdue once the gym's **grace period** has passed after its due date: 0 to 60
  days, starting at 0, set in the Bills box on Memberships (as Gymdesk lets a gym set
  when a manual payment turns overdue).
- **Undo last payment** takes back the newest payment on a membership, one at a time;
  its row is kept, marked. A period counted paid before bills were kept, or on the word
  of the gym's own list, has no payment behind it and is taken back as it always was.
- **Who**: `billing.members` (owner and manager by default; "Record members' payments"
  on the staff form) to read a person's bills and payments, record, undo and change the
  grace period. Staff with the list's tick alone still read Paid or Payment due on the
  person's page, as before, and are told who can record.
- **Left for 18a-ii**: void a bill, note a refund, and the Members list's Payment filter
  reading the bills (it still reads the count of paid periods, which a payment moves).

### 14.3 The register

**Sell**: staff pick a product or a membership type (a day pass, a bottle of water),
the person or "walk-in", how they paid — one bill and one payment in one transaction,
with an idempotency key. `gym_products` (name, price, whether stock is counted and how
much). **Discounts and promo codes** on membership types: so much off or a percentage,
from and until, a limit of uses, counted under a lock; the price a person was sold at
is written on their membership, so a later change of price or promo never rewrites it.

### 14.4 Pay by the gym's own link

A gym pastes its own payment link for a membership type (any company: RULINGS
2026-09-15). The member's app shows **Pay {gym}**, which opens it outside the app;
staff tick the bill paid. Only `https` links, shown with their host named, never
fetched by our server.

### 14.5 The Connect buttons — later, and only the normal way

A gym presses **Connect**, signs in at the payment company, approves, and comes back:
OAuth, the company's own page, no key typed or pasted by anybody (Kd refused the
limited-key idea on 2026-09-21; struck). The tokens are kept encrypted under a key
from the platform's secret store, never logged, refreshed by the worker, and dropped
at Disconnect. With a company connected: the member saves a card or a bank mandate on
the COMPANY's own page (card numbers never reach our server), repeating memberships
are charged by the company on the notebook's schedule, and its webhooks tick bills
paid or failed — signature checked on the raw body, deduped by the company's event id,
acknowledged, then a worker fetches the real object (CLAUDE.md §4). A failed payment
makes the bill overdue and tells the gym; retry rules are the company's. The order
(RULINGS 2026-09-22), Stripe left out because its partner programme is invite-only for
a business in India:

| Button | Gyms in | What it moves | What is known (read 2026-09-22) |
|---|---|---|---|
| **Square** | US, Canada, UK, Ireland, France, Spain, Australia, Japan | cards; a saved card charged each period (Subscriptions API); desk readers later | Square staff, its developer forum: "developers from any country can build apps using Square's APIs, but payment processing … only works for sellers in the supported countries". Its developer terms require OAuth for an app that serves sellers. Application fees need an account in the seller's country — and Kd takes none. |
| **GoCardless** | UK, Europe, Australia, also US and Canada | the member's BANK account each period (Direct Debit, SEPA, ACH) | The UK's usual way to pay a gym. A partner app is made in its sandbox; before going live its team reviews "a demonstration video" and aims to answer "within 5 working days"; it asks for a live account and a live app, and states no country rule for the partner. |
| **Razorpay** | India | cards, UPI, bank mandates | Its Technology Partner programme: OAuth to a business's own account, after the partner's KYC — an Indian business. |

Whether an owner in India can finish each sign-up is proved only by doing it; it is
free, and Kd's to do when he chooses. Nothing in 14.2 to 14.4 waits for it.

### 14.6 Cards

**18a** the notebook · **18b** the register, discounts and promo codes · **18c** Pay by
link · **18d** the first Connect button, once its developer account exists · **18e**,
**18f** the others. 18a needs 17a. ONE feature for CLAUDE.md §6; the extra passes run
over 18a–18c before a gym uses them, and again over each Connect button — reviewed by
RUNNING the company's real sandbox, never a mock alone.
*(2026-10-08, RULINGS that day: six more cards, each a line in ROADMAP — **18g** receipts ·
**18h** a fee for a late cancel or a no-show · **18i** family plans, one person paying for
several · **18j** My membership, the member's own view · **18k** a member buys and pays in
the app · **18l** a member stops their own repeating membership. 18k and 18l need a Connect
button; tax on what a gym sells is settled in 18b's plan.)*

### 14.7 Where the facts came from (read 2026-09-21 and 2026-09-22)

Square: developer forum thread "Square app development for devs out of US" (a staff
reply), "International Development", "Test in Unsupported Regions", its developer
terms, "Subscriptions API" · Square support: "International availability" (eight
countries; an account's country cannot be changed) · Stripe support: "Stripe accounts
are invite-only in India" · GoCardless docs: "For Partner Integrators", "Going Live
with your integration" · GoCardless's own guides (82 % of UK gym payments by Direct
Debit; in the US since 2018) · Razorpay docs: "Technology Partners", "Integrate with
Razorpay OAuth" · Paddle: pricing, identity verification.

*(Read again 2026-10-08, with Kd's talk about Square and the stores; RULINGS that day.)*
Square, "International Development": "Square APIs can be used by developers worldwide,
with payment processing supported in select countries", and "The Square Sandbox is only
available in regions where payment processing is supported" — so whether an account made
from India is given a test area is still proved only by trying · "OAuth and Testing":
"When developing an integration for other Square sellers, you must implement the Square
OAuth flow using the OAuth API"; application fees need "a Square account in the seller's
country" · "Test in Unsupported Regions": "Square hardware only works in Square-supported
countries" · its Cards API and Subscriptions API pages (found by search, not read page by
page): only credit and debit cards are saved; a payment made with Apple Pay, Google Pay or
Cash App Pay cannot be used to save a card; a subscription takes no bank debit; the buyer
is asked before a card is saved · Apple's App Review Guidelines 3.1.3(e): "If your app
enables people to purchase physical goods or services that will be consumed outside of
the app, you must use purchase methods other than in-app purchase to collect those
payments, such as Apple Pay or traditional credit card entry" · Google Play's Payments
policy: §3 names "gym memberships" among the physical services for which Play's billing
"must not be used", and §4's rule that "apps may not lead users to a payment method other
than Google Play's billing system" opens "Other than the conditions described in Section
3, Section 8, and Section 9". When a gym's bank is paid is Square's payout setting for
that gym; nothing here moves it.

---

## 15. The gym's shared page

*(ADDED 2026-09-22, the same planning chat: Part 6 of Kd's planning document — his
"common dashboard" — agreed that day, one question open; RULINGS 2026-09-22. A frame.
It takes in ROADMAP Stage 2 items 1b, 6, 10 and 11. Opus xhigh: other people's words
and pictures.)*

**The worst thing this section could do to a real person:** let somebody be shamed in
front of their whole gym — a cruel post, a photo of them they never agreed to — or show
a person's food or weight to their gym without their say. The first tests written: a
reported post is removed by staff in one tap and is gone for everyone; a blocked
person's posts are gone for the one who blocked them; a member who chose "hide me"
appears to nobody else on any board or challenge; nothing about food or weight reaches
a trainer's screen by a path the person did not open.

### 15.1 The page

One page a gym — **Updates · Events · Leaderboard · Challenges** — for its live
members in the phone app (the member web until it exists) and its staff in the
browser. A former member, a removed one and a stranger get a 404.

### 15.2 Updates

`gym_posts`: who, words (2,000 characters), up to 4 photos or 1 video, pinned or not,
when, removed at and by whom. Staff always post; **a gym setting decides whether
members may** (off to start). **Reactions — one tap from a small fixed set — and NO
comments, and no private chat** (RULINGS 2026-08-25, kept 2026-09-22). Photos: checked
by their first bytes, size-capped, stripped of location tags, stored on R2 under keys
the server makes, served by signed URLs (CLAUDE.md §4, Uploads). Videos: up to one
minute, 20 a gym (RULINGS 2026-08-24), uploaded straight to Cloudflare Stream by a
one-time upload address the server asks for, played from Stream, deleted there when
the post goes.

**As built in 19b-i (2026-10-04): the gym's own posts.** Staff holding a new tick,
`posts.manage` ("Post updates": owner and manager by default, the owner can give it to
a trainer), write a post on the console's **Updates** page: words, up to 4 photos (each
drawn by the browser at most 1,600 px on its longest side and held to 1 MB by the server
since 19b-iv; cleaned by the gym page's `cleanPhoto`), pin (at most 3, newest pin first) and remove. The same tick gates the
page's reads and is the one the staff queue of §15.3 will read, in place of a second
`posts.moderate`. Members read them on their gym's page under an **Updates** tab, the
pinned ones first, 20 a page, with the author's first name and last initial (their name on the gym's list
when the app's is only their email's first part; the gym's name when they have neither
or the account is gone). Staff see each post's reactions as members do, a filled icon and a
number each, and a press on one lists who gave it by whole name, newest first, 100 at
most (`GET …/posts/:postId/reactions?reaction=`, the tick's alone; members see only the
counts) (Kd's click-through, RULINGS 2026-10-04). **A post stays until staff remove it** (RULINGS
2026-10-04; the one-week life of 2026-08-25 is for members' photos, settled in 19b-ii).
A removed post is gone for everyone at once: its photos' files and its reactions are
deleted, and its row is kept with who removed it. The reactions are **Like · Love ·
Strong · Fire**, one a person a post; a tap on one's own takes it off; only the counts
are shown, never who. A reaction counts, and its giver is
named, only while they are a live app member of the gym with an active account, so the
number and the names always agree. A post's 2,000 characters are counted by character
on the screen and the server alike (an emoji is one). A photo is served by the api itself
to a live member of that gym or to staff holding the tick, and to nobody else; a browser
may keep it but asks again each time it shows it, so a removed post's photo is gone at
its next showing (signed URLs come with R2, Stage 4
item 4). A gym whose plan has lapsed: its members are sent no posts and no photos, and
its staff can read but not post, pin or remove. Members' own posts, the gym's switch
for them and the safety tools of §15.3 are 19b-ii; video is 19b-iii.

**As built in 19b-ii-a (2026-10-04): members post.** The Updates page carries a switch,
**Members can post** (`gyms.members_can_post`, off to start, the tick's to change). While
it is on, a live app member writes a post on their gym's Updates tab: the same words and
photos as staff (`POST …/posts/mine`, one key a post), **10 in any 24 hours, 3 of them
with photos** (Kd, RULINGS 2026-10-05; 429 `posts_photo_day_full`, "take the photos off to
post the words now"; both refusals say the 24 hours and in about how many hours the next
may be made, since a post from yesterday evening still counts this morning) counted in the database with the person's membership held (a removed
post gives none of the ten back; a removed photo post, its files deleted, gives its photo
place back whoever removed it, the member or staff, and the ten bound that; a photo post
that waits on both limits is told the later of the two hours; "take the photos off" is
said only to a post that has words), and who
may post — the switch and a stop — is settled before the body is read, as for staff; a
full day is refused before any photo is cleaned, and a post sent again under its key is
answered with the post kept, the day's last one too. A member's post that staff pinned gives its pin back when its writer leaves. A member's post is marked
`by_member`; it is shown under their first name and last initial ("A member" with no
name), staff posts carry the word "Staff", and the console marks a member's post with the
gym's word for a member. **A member's post stays until they or staff remove it** (RULINGS
2026-10-04: the one-week life of 2026-08-25 is replaced); they remove their own
(`DELETE …/posts/mine/:postId`). **It is the person's, not the gym's:** it and its photos
are shown only while its writer is a live app member of the gym with an active account
(leave, be removed or delete the account and they are gone for everyone; rejoin and they
are back), it is deleted with its photo files at the account's Day 14, and it is in the
person's export. Switching the switch off leaves the posts already made.

### 15.3 Keeping it safe — what Apple (guideline 1.2) and Google ask of any app where people post

**Report** on every post, with a reason; reports land in a staff queue
(`posts.moderate`, owner and manager) where a post is removed in one tap and a person
can be stopped from posting. **Block**: a member never again sees a blocked member's
posts or reactions. A bad-words filter HOLDS a post for staff rather than refusing it.
A support address is shown. Kd can remove any post and pause any gym (RULINGS
2026-08-27). Everyone here is a real, invited member under their own name, which is
the main protection; rate limits stop a flood (10 posts a day a member, with the usual
per-address ceiling).

**As built in 19b-ii-a (2026-10-04): Report, the staff list, stopping a person.** Every
post a member did not write carries **Report** with one of five reasons (Bullying or
unkind · A photo of someone who didn't agree to it · Nudity or sexual · Spam or selling ·
Something else) and, if the member wants, up to 300 characters typed beside it (Kd's
click-through, RULINGS 2026-10-05; a reason is still picked): `POST …/posts/:postId/report`,
one a person a post (`gym_post_reports`). Staff read what was typed under the post it was
typed about, 20 notes a post at most, never who typed it. **Nobody is told who reported**: staff are sent how many and why,
never who, and no audit line names the reporter. Staff holding `posts.manage` (the one
tick, as 19b-i decided) see **reported posts** at the top of the console's Updates page,
longest waiting first, 50 at most (`GET …/posts/reported`): **Remove post** is the
removal of §15.2, one request, gone for everyone with its photos, the reports answered
"removed"; **Keep post** answers "kept" the reports staff were SHOWN (`POST
…/posts/:postId/keep` with the list item's `allReports` and `reportsMark`: how many reports
the post has had, and one value for exactly those):
when another has arrived while they were looking NONE is answered, the post stays on the
list, and the page says so and reads the list again; when the post has no more reports than
staff saw but not the same ones (a reporter's account purged), the answer is 409
`reports_changed` and the list is read again. It is the reports themselves and not a time (the
feature's passes, 2026-10-05): a report's time is read before the report is stored, so one
can land after staff read the list carrying an earlier time than the newest they saw. A kept post stays, and only a NEW person's report brings it back. **Stop them posting** on a member's
post (`PUT` · `DELETE …/posts/stopped/:userId`, `gym_post_stops`): that person cannot post
at this gym until staff let them again, still reads and reacts, their posts stay, and the
page lists who is stopped. A gym whose plan has lapsed reads the list and answers nothing.
Every Updates route asks who is reading or writing before the rate limit, so a stranger's
404 is never a 429 and never counts against the address a gym's members share; nothing a
person wrote, as a member or as staff, offers them Report.

**As built in 19b-vi (2026-10-05): a post five people have reported is hidden until staff
decide** (RULINGS 2026-10-05). A post with five reports nobody has answered
(`GYM_POST_REPORTS_TO_HIDE`; one report a person a post, so five people, whatever reason
each picked) is sent to no member but the one who wrote it: not on Updates, not pinned, not
on the writer's profile, not its photo by its own address, and a reaction, a report or a
block of it answers 404, except that one of the five sending their report again is
answered as the first time. The moment is kept on the post (`gym_posts.hidden_at`,
migration 0077), written in the fifth report's own transaction with the post held, so two
reports at one instant are counted one after the other. It is NOT worked out from the
waiting reports on each read: a reporter whose account is purged would then bring the post
back with no staff decision (round one's review). The purge clears the mark only when no
report of the post is left waiting, since staff then have nothing on their list to answer.
The gym's own staff posts follow the same rule. The writer still reads it, marked `hidden`
("Hidden from other members while the staff at {gym} check it."), and can remove it. Staff
read it marked, once, on the reported list (the console's list below leaves it out; one
the list of 50 has not reached stays below and says it will show above): **Keep post**
answers the reports and clears the mark, so every member reads it again and it takes five
NEW people to hide it again; **Remove post** is the removal above. A hidden pinned post
keeps its pin.

**A photo's file is never lost track of** (the feature's passes, 2026-10-05). A photo's
row goes in the database's own step and its file after it, so the file's key is written
to `photo_files_to_remove` in that same step (a removal, a purged account) and taken off
once the file has gone; a new post lists its files before it writes them and takes them
off in the step that keeps the post. A file that will not go stays listed: the nightly
purge run tries again whatever has been listed for over an hour, counts what is still
there (`photoFilesLeft`) and fails the run while any is. A listed key with no file under
it counts as gone for the api, whose store it is. The nightly run counts it as gone only
when its own store holds a photo that gym still has, which shows the store is the api's;
a worker pointed at the wrong folder holds none, so it cannot clear the list.

**As built in 19b-ii-c (2026-10-05): a person's posts on their profile** (RULINGS
2026-10-02, 2026-10-03). A member's picture or name on a post, and a row of the
leaderboard, open **a page of its own, laid out as a profile is on Instagram or X** (Kd's
click-through, RULINGS 2026-10-05): Back, the picture and name large, a row of numbers
(how many posts, `total`; then the person's place on each board the gym shows — §15.5's
profile, which answers 404 for a hidden person, so nothing about a board is drawn for
them) and under it **the posts they made as a member**, newest first, 20 a page, a pinned
one in its own place
(`GET …/posts/people/:userId`). It is the Updates feed's own rule with one more
condition, so a reader is sent nothing Updates would not send them: no post of somebody
they blocked (the answer says `blocked`, and the page says why it is empty), none of
somebody who has left, been removed or deleted their account, none that was removed. A
post the staff wrote for the gym is the gym's: its name opens nobody and it is on nobody's
profile. An id that is nobody's reads exactly as a member who has not posted; a stranger,
a former member and a lapsed gym's member get the usual 404. Each post carries
`authorId` for a member's post (null for a staff post), which is what the name asks by.
Staff holding `posts.manage` read the same list (`GET …/posts/staff/people/:userId`)
with Remove post and Stop them posting: in a box opened from a member's name on the
console's Updates page (the reported list too), and under the boards on a person's panel
on the Leaderboard page for staff who hold both ticks. The member's read asks who is
reading before its rate limit. A photo opened anywhere is drawn on the page's body
(`PhotoViewer`), so it fills the window from inside a box too.

**Video (Kd, RULINGS 2026-10-05, for 19b-iii):** only the gym's staff post video, at most
20 a month a gym, one minute each, played on a tap and never by itself; members post words
and photos. It replaces "20 a gym" above.

**As built in 19b-ii-b (2026-10-05): Block, the bad-words check, the support address.**
**Block** is on every post another MEMBER wrote (`PUT …/posts/:postId/block`,
`gym_post_blocks`): from then on the blocker is sent none of that person's posts or
photos at that gym, a pinned one included, and that person's reactions are left out of
the counts the blocker reads. It is one way and per gym; the blocked person is never
told, staff are never told, and no audit line is written. A post the gym's staff wrote
cannot be blocked (it is the gym's word; Report answers it), so a blocked person who is
also staff is still read where they post for the gym, and the Block box says so. A
reaction the blocker had given that person's posts is deleted with the block; the same
block sent twice answers as the first did. The blocker reads their
list at the bottom of Updates (`GET …/posts/blocked`, 200 at most, first name and last
initial) and takes a block off (`DELETE …/posts/blocked/:blockId`), which brings
everything back. A block is the person's own data: deleted at the account's Day 14, with
anybody's block OF them, and in their export without the other person's id.
**The bad-words check (Kd, RULINGS 2026-10-05: the app checks, staff are sent nothing;
it replaces the hold above):** a member's post is checked before anything is kept
(`posts/badWords.ts`: the `obscenity` package's English list, plus slurs and explicit
words it lacks; English only). One that has a listed word is refused (400
`post_bad_words`) with a sentence naming each word found, five at most; the member's
words stay in the box to change, nothing is stored, no photo is read, and it uses none
of the day's ten. Staff's own posts are not checked. A word is refused for what it IS,
never for what it has inside it ("cucumber", "mishit" and "rapeseed" pass; "bullshit" and
"dickheads" do not), and the sentence names the whole word as typed. Characters nobody
sees are taken out first, a mark or digit after a word does not hide it ("tosser!"), and
letters typed one at a time are read joined. The list catches the words it
knows: an unkind post in ordinary words goes through, and Report is what answers it;
the outside list it is tested against, and what is let through on purpose, are in
`apps/api/test/fixtures/bad-words`.
**The support address** is one for the whole app, `SUPPORT_EMAIL` on the server,
required in production; members read "Need help with the app? Email …" under a gym's
Updates once it is set. Kd has not chosen it yet (RULINGS 2026-10-05).

### 15.4 Events

Name, words, place, start and end in the gym's time zone, places or no limit. "I'm
coming" is 13.4's Book rule on an event row — one counting rule in the app, not two.

**Built in two jobs (ROADMAP 19c-i, 19c-ii).** **19c-i, the gym makes events and members
see them:** `gym_events` (migration `0078`): name (80 characters), details (1,000), place
(120), places (1 to 10,000, or none for no limit), and a start and an end kept twice: as
the gym's own clock reads them (a day and minutes after midnight) and as the instants
those were in the gym's time zone when it was saved; a gym that changes its zone has
them worked out again in the same step, so "coming" and "ended" stay the gym's own
clock. The end is after the start, at most 31 days after it, and not already passed; the
start is at most two years from the gym's today; a name holds a letter or a number
somebody can see. Staff holding `posts.manage` ("Post updates",
no new tick) add an event (one key, one event), change it, and cancel or un-cancel it
(`PUT …/events/:eventId/cancelled`), all only until it ends; a gym keeps at most 100
coming events. **A poster** (Kd, RULINGS 2026-10-06) is one picture an event, kept as a
post's photo is: made smaller by the browser, 1 MB at most, cleaned of where it was
taken, stored under a key the server makes (`gym-event/{gymId}/{posterId}`), its old file
listed in `photo_files_to_remove` in the step that replaces or removes it. A live app
member of a gym on a live plan is sent every event that has not ended, soonest first, a
cancelled one too, marked, so nobody wonders where it went; an ended event is staff's
alone ("Past events"), and of it only the poster can change, by being taken off (a
person in it may ask). Anybody else gets the 404 of a gym that does not exist, for the
list and for a poster. The console has an Events page; the member's gym page an Events
tab. **19c-ii, "I'm coming":** `gym_event_places` (migration `0080`), one row a person an
event in use (`coming` · `waitlisted` · `cancelled`), counted by 13.4's own rule
(`decideComing`, `decideNotComing` and `eventGoing` in `packages/shared/src/gymEvents.ts`
call `decideBook` and `decideCancel`). An event is free: nothing is checked or charged, any
live app member may come from the day it is posted until it starts, and "Can't come" is
free until it starts. The waitlist's size and its hand-over time are the gym's own booking
settings (13.4): outside that time a freed place is the first in line's, inside it the
first to tap has it. A place is given in one transaction under the gym's row and then the
event's, and a request's key is kept on it. Staff holding `posts.manage` read who is
coming and waiting by name and take a person off (`…/events/:eventId/people`). Places
cannot be cut below the people coming; more places, a later start and an un-cancel hand
what is free to the waitlist; a cancelled event keeps everybody's place, so an event
brought back is as it was. Somebody removed from the gym, or whose account is deleted,
loses their places at events that have not started. Nobody is told of any of it yet (the
inbox, 20a): the member's card and the console's boxes say so.

### 15.5 The leaderboard — only what the desk, staff or the app recorded

*(RE-PLANNED 2026-10-02 for accuracy at Kd's request — *"people will get angry and feel
bad if the leaderboard is not accurate and tansparent"* — RULINGS that day. The plan with
pictures: https://claude.ai/artifact/LTFJYnb3JEVQ3yAwGgg1GZ. Read that day: PushPress's Committed Club,
Wodify's Weekly Streaks, Strava's clubs and under-18 defaults, Myzone, F45, Fitbit, the
UK ICO children's code (standard 7), Duolingo on streaks its own outages broke.)*

**The worst thing it could do to a real person:** show somebody who chose Hide me to
another member — in a row, a photo, a profile, a count, or a gap in the places. The
first test written.

**Three boards, each ranking ONE fact.** Equal numbers share a place (1, 2, 2, 4) and
are listed by name, as PushPress does.
- **Gym days** — a day with at least one visit at this gym made by `pass`, `key_tag` or
  `staff` (a door machine later); `manual` (the old tap) and `qr` never count. The day is
  the visit's stored `day`. A visit is the person's when its `user_id` is theirs, or when
  it has no `user_id` and its `entry_id` is their membership's record (`gym_members.
  entry_id`) held by exactly one live member — so visits from before the app count.
  16b-ii counts Attendance and Overview by record too: ONE function decides whose visit
  it is, and whichever job merges second uses the first's.
- **Workout days** (19a-ii) — a day, in the gym's zone, with a finished app workout,
  however its reps were counted (Kd's choice, 2026-10-02: the camera counts 3 of the 58
  exercises): at least one set saved, started on or after the current membership's
  `joined_at` and not in the future, and reaching the server (`created_at`) within 7
  days of its start. A home workout counts at each of the person's gyms (2026-09-23).
  *As built (19a-ii):* one SQL rule (`leaderboard/workouts.ts`) gives each workout its gym
  day and the first reason it does not count — saved before it started · still ahead ·
  before joining · no set with a rep or a hold · saved late — and the board and "what
  counted" both read it. A workout that reached the server more than an hour before its
  own start NEVER counts (the sync route takes any start time; the hour is for a phone's
  fast clock). All time's own list leaves out workouts from before the person joined. A
  profile at a gym that checks nobody in carries Workout days only, and there the board
  opens on Workout days.
- **Streak** — weeks, Monday to Sunday in the gym's dates, in a row with a gym day. Last
  week keeps it alive until this Sunday ends. A week in which the gym recorded no counted
  visit for anybody is skipped: it neither counts nor breaks. It ranks the streak now;
  the person's best is in their own sheet. "On a roll" (`getGymRegulars`) moves onto
  this one rule in 19a-i, so the two never show different numbers.
- Later: **Classes** (booked and came, with 17f) and **Running** (Stage 5 item 4: the
  distance the server measures from the GPS track, never a typed one, with any stretch
  faster than a person runs dropped).

**Periods**, for the two day boards: this week · last week · this month · last month ·
all time, in the gym's time zone (`gyms.timezone`), "today" from an injectable clock,
ISO weeks (`date_trunc('week')`, as the console's calendar). Each board prints its dates
("Mon 28 Sep – Sun 4 Oct, Iron Temple's time"). Last week and last month stay, because a
reset otherwise wipes the winners (Strava keeps last week; Myzone shows last month's
leaders for 7 days).

**Who is on it.** Live app members (`removed_at IS NULL`, `users.status = 'active'`) with
a number above 0. Not ranked: the gym's staff (greyed "Staff, not ranked" for staff)
and hidden people. People without the app are not on it; the staff page says how many.
Members see the top 100 and their own place, with how many more reach the next place;
staff see everyone. No board until 3 people are on it.

**Hidden**: (a) Hide me, the person's own switch for every gym
(`users.leaderboard_opt_out`), on the board and in Settings; (b) under 18, by the age
they gave or the record's date of birth, until they choose Show me — a floor only, since
invitations refuse under-18s and Stage 4 item 9 makes the app 18+; (c) taken off by
staff (19a-iii; `gym_members.hidden_from_boards`), and told so. Hidden people are taken
out BEFORE places are given, so no gap gives them away. They see their own row greyed,
with the place they would have; staff see them greyed, with the reason.

**Names, photos, profiles.** Members see the first name and last initial of the person's
app name, never an email: an automatic name (the email's first part, "New User") gives
way to the gym record's name, or else the person is asked to add a name and is off the
board until they do. Staff see the full name, as on Members. Each row has a round photo
(5b-vi, after photo storage; initials until then; RULINGS 2026-10-02: members see it
wherever its owner is shown, never while hidden). A tap opens the person's profile on
the gym page: their place on every board members see, and their posts once 19b exists;
nothing for a hidden person.

**What counted.** The person, and staff, open a number to see each counted day: visits
with their time and how (the desk's name, the member of staff) and "2 visits, 1 day";
workouts with their time and whether the camera or the person counted them (staff see
workout dates only, never what the workout was); and what did not count, with why
("saved 9 days late"). Other members never see a time. Every number equals its own
list, by test.

**Day-circles** (2026-09-17, amended 2026-10-02): on a week view, seven circles, Monday to
Sunday, for the days THAT board counted, so they add up to its number; the Streak's
circles are its last seven weeks; month and all-time views show none. **Amended
2026-10-04 (RULINGS that day):** every period draws the same row — a month and all time
carry THIS week's seven marks, read beside the board, and the page says so — and a mark
is a flame, lit and glowing when it counted, its outline when it did not.

**Gyms that use only part of the app** (Kd, 2026-10-02). Gym days and Streak show to
members only while the gym has recorded a counted visit in the last 30 days; Workout
days needs nothing. The gym switches any board off (19a-iii), and the console says why a
board is not showing. A lapsed gym's members see no board (2026-08-28); its staff can
still look.

**Fresh, never stored.** Worked out from the rows each time it opens, one query a board;
the page refreshes every minute while open and says when ("updated 10:42 am"), so a
staff fix (19a-iv) shows at once. Cost at full size (CLAUDE.md §4): 2,100 members with
three years of visits and workouts — how long the server answers nobody for each board
and period — measured before review.

**Proof.** Route tests: a stranger, a former or removed member and another gym's staff
get 404 from every new route, a member of staff without the tick 403. A plain model of
every board, kept in the api's tests, and a seeded random generator (no new package):
thousands of gyms with ties, hidden people, households on one record, joined records,
deleted records, rejoins, visits from before the app and silent weeks, on which the
database and the model must agree on every place and number. Real clocks, each checked
against the tz database: Asia/Kolkata, America/New_York, Europe/London, Asia/Kathmandu,
Australia/Lord_Howe, America/Santiago, and 29 February 2028. The deliberate breaks
(CLAUDE.md §4) are on Hide me.

**The board in the console, as built (19a-iii).** A Leaderboard page in the menu for staff
holding the tick `leaderboard.manage` ("Run the leaderboard": owner and manager; the owner
can give it to a trainer; it gates the reads too). Everyone with a number, a hundred a
page, by full name (the app name, or the record's when the app's is automatic; never an
email), ties by name: a person members see carries the place members see, from the same
function that ranks the members' board; a hidden person carries the reason and no place.
A person's panel: their place and number on all three boards, hidden or not, and what
counted for each (visits with time and desk or staff; a workout as its date only); their
posts join it with 19b. Take off the board / Put back (`gym_members.hidden_from_boards`),
behind a box naming who changes and what is kept; noted in `audit_log` once. Which boards
members see: `gyms.leaderboard_boards_off` (migration `0067`), a switch a board; a
switched-off board answers members `switched_off` with no row, no number and no profile
line, and their app draws no tab for it. Each switch says why its board is not showing
(switched off · no plan · nobody checked in for 30 days · fewer than 3 people), and the
page says how many people on the list have no app (Members' own match). A lapsed gym's
staff still read it and change nothing. A place is the place members see: while members
see no board (switched off, no plan, no check-ins, fewer than 3), nobody carries one. A
switch is one board a request, so two staff never undo each other.

**Fixing a visit, as built (19a-iv; §12.5 has the rule).** In "What counted" an added visit
reads "Added by Sam (staff) on 4 Oct" for the person and for staff, and a removed one stays
under "Didn't count" as "Visit removed by Sam (staff) on 4 Oct", so nothing leaves a
person's list without a trace. Staff who hold `attendance.mark` see Remove beside each
visit and Add a visit under Gym days on a person's panel; the box before either names the
person, the visit or the day, and the number it leaves ("Their Gym days, this week, go
from 3 to 2"). The person's own list carries no visit id; staff's does. An added visit
counts as its person's gym day and never makes a silent week the gym's: a week is the
gym's when the desk or staff checked somebody in AT THE TIME, so fixing one person's week
cannot break everybody else's Streak (the week stays skipped, for that person too).

**Jobs** (ROADMAP 19a-i to 19a-iv): the members' board with Gym days and Streak · Workout
days · the board in the console · fixing a visit (after 16b-ii).

### 15.6 Challenges (the document's "leagues and tournaments")

`gym_challenges`: name, words, from and until, what is counted (one of 15.5's checked
facts), everyone or people who join, alone or in teams (staff make the teams, or
members pick one), a prize in words. Its board is 15.5's query over its dates and its
people; at the end the result is posted to Updates. Knock-out brackets are later.

**Challenges, as built (19d-i).** `gym_challenges` and `gym_challenge_people` (migration
`0082`). A challenge counts **gym days** or **workout days** over its own first and last
day (the gym's calendar, both counted, 366 days at most), for **everyone in the app** or
**only people who join**, and is won by **the most** or by **reaching a number** that
everybody who gets there wins (a target is never more than the challenge's days: one a
day is counted). A prize and details in words. Staff holding `leaderboard.manage` make
one on the console's Challenges page (six that have not ended at most; a new one may
start up to 31 days back, the days since then already counting, and up to a year ahead).
Once it has started, what it counts, its first day, who is in it and its target cannot
change; its name, prize, details and last day can. Cancel is behind a box and can be
undone until its last day; nothing is ever deleted.

Its board is the leaderboard's own count (`countedDays`, `countedWorkoutDays`) and its own
ranking (`rankBoard`) over the challenge's dates, so a hidden person (Hide me, under 18,
taken off, staff, no name), a removed member and a deleted account show to nobody else:
not in a place, not in the count who joined, not in the count who reached the target.
Fewer than three people with a number: no places. Nothing is stored; a visit fixed later
changes a result.

A member's Challenges tab (the member web until the phone app): running first, then
coming, then the newest three that ended in the last 14 days with who won; a cancelled one stays,
marked, for 7 days. Each card: how it is won, its days, the prize, who is in it, the
member's own number with a bar toward the target and a flame for every counted day, their
place and what it takes to move up, the top three, Join or Leave, and the whole board
(the first hundred). Joining is open to its last day and counts the days since it
started. A gym-days challenge at a gym that checks nobody in says so, never a bare 0. A
gym on no plan: its members are sent none.

**The result posted to Updates, as built (19d-ii-b).** When a challenge's last day is over
on its gym's own clock, one post is made in the gym's Updates, from the gym and by no
worker (`gym_posts.challenge_id`, migration `0087`; the worker's `orgs.challenge_results`
job every fifteen minutes, `tools/challenge-results.ts` by hand). One post a challenge for
ever: a second run or two at once write nothing more, and a post staff remove is not made
again (its row keeps the challenge's one place; the Remove box says so). Nothing is posted
for a cancelled challenge, for one that ended more than 14 days ago, or for a gym that is
closed or on no plan, whose result is posted if its plan comes back inside those 14 days.

**The post keeps only "{name} has ended."** Who won is never stored: it is read with the
post each time (`challengeResult` on a post), and is the challenge exactly as that reader's
Challenges tab is sent it (`memberView`), less the days the tab draws as flames. So the
post and the tab give one answer; the hidden rule holds in the post as on the board; a
person who hides, leaves or deletes their account AFTER the post went up is named in it no
longer; and numbers staff type after the last day show in the post already up (until three
people have one it says the staff are still adding them, on the tab too). The post shows
the headline, the first three or every team, how it was won, its days and the prize, and
**See the challenge** while the reader's tab still lists it (`canOpen`). Staff read it on
the console's Updates as members see it, with no line of their own, told so, with **Open
the challenge** for staff who run the leaderboard and a line saying who can for the rest.
It is pinned, reacted to, reported and removed as any post of the gym's. A challenge's own
page says, before it ends, that its result is posted to Updates, and after, that it is
there (**See it in Updates** for staff who post updates), that it is hidden from members while
five reports wait, or that its post was removed; the form says it too. On no plan nothing
is posted, and a running challenge's page promises nothing. A result post whose challenge
is running again (its gym moved its clock back) is in no list of Updates until it has
ended again. Nobody is sent a message about it until the inbox (20a).

**The console's words (Kd's click-through of 19d-ii-b, RULINGS 2026-10-09).** On the
console's Challenges page a number never stands without its word ("4 gym days", "1 gym
day", "55 push-ups", "4 people"). How a challenge is won is said in the one line its
members read (`winLine`): "Most gym days wins", "Lowest seconds wins", "Reach 12 gym days",
"The team with the most gym days wins", "Reach 60 gym days as a team". The form asks **Who
counts it**: **The app**, then **What the app counts** (Gym days · Workout days), or **Your
staff**, then **What your staff count** (the gym's own word). These are the same three
counts as before (`gym_days`, `workout_days`, `own`), and a count the app makes from an
exercise (19d-iii) will be offered under The app. **How it is won**: "Most {gym days} wins"
· "Reach a target" (its box is **Target**, with the word of what it counts beside it) ·
and where the staff count, "Lowest {seconds} wins" (round one: "Fewest 5 km time wins" was no
sentence). One of the staff's own word is said as one where the word is a plain plural
("1 push-up"; "1 kg lifted" as typed). **Individual or teams**: Individual ·
Teams: you put people in them · Teams: your {members} pick their own, the words the
challenge's own page uses over its teams. A challenge's facts read "Counted by the app" or
"Counted by your staff", and who is in it as people ("Everyone in the app · 4 people").

**The gym's own count (Kd, RULINGS 2026-10-06, built in 19d-i).** A third thing a challenge
can count: `counts` `own`, with `unit` the gym's word for it ("push-ups", 30 characters).
Nothing is counted by the app: staff holding `leaderboard.manage` type each person's number
on the challenge's board (`gym_challenge_scores`, one whole number a person, 1 to
1,000,000; an empty box takes it off; `PUT …/challenges/{id}/scores`, up to 200 people a
save, noted once in `audit_log`), from its first day until 14 days after its last (the days
members still see its result), for a live app member in it. It can
be won by the most, by reaching a number (not bound by its days), or by **the lowest**
(`lowest_wins`, a fastest time; only for this count and with no target). Places, the
hidden rule and the three-people rule are the same as every other challenge's; it has no
flames, since it has no days. A number a member types is still never ranked (§15.5), and
where the app counts a challenge it never counts either (§15.10; Kd, RULINGS 2026-10-09).

**Teams, as built (19d-ii-a).** A challenge is **individual** (each person on their own) or **in teams**
(`gym_challenges.teams`: `none`, `staff`, `members`; `gym_challenge_teams`,
`gym_challenge_team_people`, migration `0086`). Staff name two to eight teams on the form
(40 characters a name, no two alike) and choose who fills them: **the staff** (Put people
in teams on the challenge's board: a team to pick beside each person, then a box that names
everyone who changes, from which team to which (read again from the server as the box
opens; five named, See all for the rest), and says nobody else is moved;
`PUT …/challenges/{id}/team-people`, up to 200 people a save, noted once in `audit_log`),
or **the members** (each team has Join team on the member's card, asked first;
`PUT …/challenges/{id}/team`). Where members pick, picking a team is how a person joins a
challenge people join (Join with no team is refused, `challenge_pick_team`); a member may change team until the first day, and after it a first
pick stands (a late joiner still picks once) and a change is refused; leaving keeps their
place in the team, so coming back opens no other. Staff may move anybody in either kind
until the last day ends. Until its first day the teams can be renamed, added or removed (a
removed team's people are left in no team, said on the form before Save); once it has
started, alone or in teams and the teams themselves cannot change, as its other rules.

A team's number is **its people's numbers added together** (the terminal's call, Kd's to
overrule; RULINGS 2026-10-09), counted over the people in the challenge now. Teams are
placed by it, the highest first (the lowest where the lowest wins), equal numbers sharing
a place, a team with no number in none. **Where the lowest wins, a team has a place only
once everyone in it that members may see has a number** (round one, RULINGS 2026-10-09): a
total with somebody's number missing is lower and would win for it; the card says how many
numbers a team waits for, and the form tells staff to give each team the same number of
people. A hidden person's missing number holds nobody back. A target is the **team's** to reach, so it is not
bound by the challenge's days, and no one person is said to have reached it. The people's
own board stays, one press away.

The hidden rule holds for teams as for places: a hidden person (Hide me, under 18, taken
off, staff, no name), a removed member and a deleted account are in no list of a team's
people, are not counted among them, and their number is **not in the team's number**, so
nobody can work it out from the total; a hidden member reads their own line and is told
their number is not added. Teammates are named only once they have a number of their own,
as the people's board names people. While fewer than three people members may see have a
number, no team has a number or a place either. Nothing of a team's number is stored.
Staff's Teams box counts everyone in a team, the hidden too, and says under it that a
team's number leaves them out. An ended challenge's teams are read with its board
(`teams` on the staff board's reply), since the list of ended challenges counts nothing.

**The console's page, redrawn in the same job (Kd, RULINGS 2026-10-09).** The page is one of
three things at a time, never all at once: a **list**, one line a challenge (name, where it
is on the calendar, its dates, what it is in a line, who is leading, Open); **one challenge**
on a page of its own (`?challenge=` in the address, All challenges to go back: what it is and
Edit and Cancel at the top, then its teams or who is leading, its prize and details, and its
Board with See the board, Enter numbers and Put people in teams); or the **form**, in three
numbered parts on one page (what and when · how it is won and who is in it · teams, prize
and details) with the challenge said back beside it as it is filled in. Every button, field
and message it had is kept.

### 15.7 A gym's own plan for a member

A trainer with `plans.write` (a new tick) opens a member's weekly workout plan and
daily food numbers as the APP built them, changes them, and saves a copy marked "From
{gym}"; the member switches between App's plan · My own · Gym's plan (the rings'
switch, 7a-iv-e). The server runs the health rules over a gym's numbers exactly as
over typed ones (never under the calorie floor; no cut for a health yes, Safe mode or
under 18). It waits for the app's own plan builder (ROADMAP Stage 1 items 6a and 6b).
**SETTLED 2026-09-22 (RULINGS): the tap is kept.** A trainer sees a member's food,
weight and plan only after the member's own yes — ONE switch on the Join screen ("Let
my coaches at {gym} see my food and weight, so they can build my plan"), off until
tapped, changeable at any time in Settings → Gym; the trainer's list says who has
shared. Without it the trainer can still write a plan from what the gym may see
(§2.4), and the screen says what is hidden and why.

### 15.8 Cards

**19a** the leaderboard, in four jobs (§15.5; takes item 1b's place) · **19b** Updates,
reactions and the safety tools, in three jobs since 2026-10-04: **19b-i** the gym's own
posts with photos, pins and reactions · **19b-ii** members' posts, the gym's switch and
the safety tools · **19b-iii** video (needs a Cloudflare Stream account — Kd's, $5 a
month for each 1,000 minutes kept and $1 for each 1,000 watched)
· **19c** events · **19d** challenges (19d-iii, a challenge about anything the app tracks: §15.10) · **19e** a gym's own plan (after Stage 1 items
6a and 6b). ONE feature for CLAUDE.md §6.

### 15.9 Where the facts came from (read 2026-09-22)

SugarWOD's own pages (a gym feed with photos, comments and fist bumps; gym
leaderboards) · Apple's App Review Guidelines, 1.2 (a filter, a report, a block,
published contact details) · Cloudflare Stream's pricing page.

### 15.10 A challenge about anything the app tracks (planned 2026-10-09; ROADMAP 19d-iii)

*(Planned, not built. Kd's words and what he ruled are RULINGS 2026-10-09. Read that day:
Strava's support page on challenges ("Manual activities will not count toward challenge
leaderboards") and BikeRadar's report of its group challenges (Most Activity, Fastest
Effort, Longest Single Activity); MoveSpring's help pages (Leaderboard, Target, Streak
and team modes; the organiser switches members' manual entry on or off); Everfit's
(a coach picks a leaderboard type from a list; "Other leaderboard types are in
development"); HubFit's (a "Challenge Type" list; Leaderboard and Milestone). Each gives
the organiser ONE list of what the product tracks, and the list grows with the product.)*

**The idea.** A gym making a challenge answers, in this order: **what it is about** (one
thing from a list of everything the app tracks, or something of its own that it names),
**who counts it** (the app, where the app measured the thing itself; or the gym's staff,
always possible), **what counts** (where there is more than one number to take), **how it
is won**, **who is in it**, then teams, prize and details as today. When the app comes to
track something new, that thing joins the list: the form, the board, teams, the posted
result and the messages are not rewritten.

**The worst thing it could do to a real person**, for the whole family: somebody wins a
prize, or loses a place, by a number nobody earned (a set typed by hand, a count the
camera never made, a run nobody ran); or a member's private activity is shown to their
gym without their choosing. Each job below names its own, and that is its first test.

**Words (one name for one thing).** *About*: Gym visits · Workouts in the app · An
exercise · Running · Something else. *Who counts it*: The app · Your staff (19d-ii-b's
words; Kd's "judge" means this). *What counts*: the number each person gets. *How it is
counted*, said to the gym and to members wherever a number is shown: "Checked in at the
front desk" · "Counted by the camera" · "Measured by GPS" · "Counted by the staff at
{gym}". *Target* for a number to reach. Individual and teams as today.

#### 15.10.1 The list

One file of plain data, `packages/shared/src/challengeSubjects.ts`, is the whole list;
nothing else in the code names a subject, as engine code never names an exercise. Each
**subject** has: an `id` that never changes and is never used again for something else;
the words the form shows; whether the gym picks from the exercise library; whether
"Everyone in the app" may be used (§15.10.5); and its **measures**, the numbers the APP
can work out for it, each with its id, its words, the word after a number, how the
number is printed, how it is counted (`desk` · `app` · `camera` · `gps`), which ways to
win it allows (most · target · fewest), and whether one a day is the most, so that a
target cannot pass the challenge's days. A subject with no measure can only be counted
by staff.

| Subject (`id`) | What the app can count (measure) | Counted how | Job |
|---|---|---|---|
| Gym visits (`gym_visits`) | Gym days (`days`) | front desk | 19d-iii-a: today's `gym_days` |
| Workouts in the app (`workouts`) | Workout days (`days`) | the app | 19d-iii-a: today's `workout_days` |
| An exercise (`exercise`), picked from the library | nothing at first; then all reps added up (`reps`) and days done (`days`); then best single set (`best_set`), time held (`hold_seconds`), longest hold (`best_hold`) | camera | staff count it in -a; `reps` and `days` in -b; the rest in -c |
| Running (`running`) | distance (`metres`), longest run (`longest_metres`), runs (`runs`), days with a run (`days`) | GPS | 19d-iii-d |
| Something else (`own`) | never: the gym names it and its staff count it | staff | 19d-iii-a: today's `own` |

A subject is **offered** to a gym only while the app can really do it there. The server
decides each time the form opens (`GET /v1/orgs/{gymId}/challenges/subjects`, for staff
holding `leaderboard.manage`). Running is not on the list until the phone app records
runs. For an exercise the reply marks which ones the camera can count today (those with
a live definition: squat, chair squat and jump squat of the 58, counted on Folder B's
local database on 2026-10-09), and of any other the form says "The camera can't count
{Plank} yet, so your staff count it". Nothing is offered that the app cannot do, and
nothing a gym has is taken away: every challenge made before is one of the first, second
or last row.

**An old phone must show a new kind.** A phone app cannot be made to update. So every
challenge the server sends carries the words that show it: what it is about, the word
after a number (for one and for many), how its numbers are printed (`whole` · `time` ·
`km`) and how it is counted. A client prints those; it never looks a subject's id up in a
list of its own. A subject added next year shows correctly in this year's app.

#### 15.10.2 What is kept

`gym_challenges` holds `subject`, `measure` (null where staff count) and `counted_by`
(`app` · `staff`) in place of `counts`. One forward migration fills them from `counts`
(`gym_days` → `gym_visits` · `days` · `app`; `workout_days` → `workouts` · `days` · `app`;
`own` → `own` · null · `staff`), states the target, unit and lowest-wins CHECKs again in
their terms, and drops `counts`. `subject` and `measure` are text held to a shape by a
CHECK and to the list by the request's Zod schema, so a new subject needs no migration
of its own. The exercises of a challenge are rows of `gym_challenge_exercises` (the gym,
the challenge, the exercise: one in -a and -b, up to ten in -c), never an array of ids.
The gym's own word (`unit`) stays for a challenge its staff count: for an exercise it
starts as the exercise's own name ("squats") and the gym may change it ("seconds" for a
plank). A number is a whole number in the measure's base unit (reps, seconds, metres),
and only the printing turns it into "2 min 05 s" or "12.4 km"; a distance is cut to a
tenth, never rounded up past a target. A target is typed in the printed unit and kept in
the base unit.

#### 15.10.3 Counting

Each (subject, measure) has ONE counter, in `apps/api/src/modules/orgs/challenges/
counters.ts`: given the gym, the instant and the spans of the challenges that use it, it
returns each live member's number in each span, in one pass. §15.5's `daysInRanges` is
the pattern, and `gymDaysInRanges` and `workoutDaysInRanges` ARE the first two counters.
`countFor` asks each counter once a read, whatever the number of challenges. Everything
after the numbers is today's code and does not know where a number came from: places
(`placeEntrants`), the three-people rule, the hidden rule, teams and their totals, the
target, the staff board, the posted result.

A counter reads only what passes its subject's own rule, written once and read by the
board and by What counted alike, as `leaderboard/workouts.ts` is:
- **An exercise, by camera.** A set counts when its workout counts for Workout days
  (§15.5: inside the membership, not dated ahead, saved no earlier than an hour before it
  started and within 7 days after), it is one of the challenge's exercises, its `mode` is
  `engine`, and it is **believable** (below). A set typed by hand (`log_only`) never
  counts (Kd, RULINGS 2026-10-09: *"i agree wit you"*).
- **Running.** A run the phone's GPS recorded, its distance measured by the server from
  the track with any stretch faster than a person runs dropped (§15.5), started inside
  the membership. A typed run never counts.

**Believable, and why it has to be built.** `mode = 'engine'` is what the phone SAYS:
`packages/shared/src/events.ts` calls it "a client claim, not a verification", and today
the server checks nothing about it (the one flag `/v1/workouts/sync` writes is
`unknown_exercise`). A challenge is its first use that can decide a prize, so 19d-iii-b
builds the check the architecture planned (v1 §14, item 1) as a pure rule in
`packages/shared`: a set passes when its reps fit in its time at the exercise's own
fastest rep (`minRepMs`, never under the engine's 450 ms), the camera watched for at
least that long (`watchedMs`), and its definition was live for that exercise; its plan
settles the rest from v1 §14. A set that fails still saves, still shows in the person's
own history and is never an error to them (v1 §14); it only does not count here, and
What counted says why in one plain line. This makes a false count hard and visible, not
impossible: somebody who rebuilds the app can send believable numbers. So the gym is
told how a thing is counted where it chooses it, and keeps three things in its own
hands: count only on a day the person checked in at the gym; count at most so many a
day; take a person off the board (19a-iii). A gym that wants certainty has its staff
count.

#### 15.10.4 How it is won

As today: the most; a target, which everyone who reaches it wins; or, where a lower
number is better, the fewest. Equal numbers share a place, and a team's number is its
people's added together. What each measure allows is in the list: gym days and a best
single set have no "fewest". The fewest stays for times the staff count; the app
counting a fastest time over a set distance (Strava's Fastest Effort) is later, with
running.

#### 15.10.5 Who is in it

- **Everyone in the app** is offered only where members are ALREADY told a gym sees the
  thing (`OrgVisibilitySheet`: the days they trained, which exercises, sets, reps and hold
  time): gym visits, workouts, an exercise. The hidden rule is unchanged (Hide me, under
  18, taken off, staff, no name), and a member's card for an exercise challenge says in
  one line that their {squats} in the app count here, with Hide me one press away.
- **Only people who join** is the one choice for anything else (running; later steps or
  cycling). The Join box says what the gym's members will see and what they never will
  ("your running distance from 1 to 30 Nov; never where you ran").
- **Never counted by the app**, whatever a gym asks: weight, body measurements, meals,
  anything about nutrition, water. Members are promised a gym never sees them
  (`OrgVisibilitySheet`), and the health rules of CLAUDE.md §4 stand.
- A member in Safe mode is offered no exercise or running challenge the app counts until
  their clearance is confirmed, and their card says so (RULINGS 2026-09-07).

#### 15.10.6 What a gym and a member read

The form's Part 1; the rest is as 19d-ii-b left it, its words following what was picked:

```
What is the challenge about
  ( ) Gym visits            Days a member is checked in, at your front desk or by your staff.
  ( ) Workouts in the app   Days a member finishes a workout in the app.
  ( ) An exercise           One exercise from the app's library, such as squats.
  ( ) Something else        Anything the app doesn't track: a rowing time, a tug of war. You name it.
Which exercise              [ Squats ▾ ]     a list to pick from, never a box to type in
Who counts it
  ( ) The app               The camera counts each squat. Sets typed in by hand don't count.
  ( ) Your staff            Your staff enter each person's number.
```

Where there is one answer the question is a plain line, not a choice ("Counted by the
app, from front-desk check-ins."). Where the app cannot count the thing yet, The app is
shown switched off with the reason in its own line. On the challenge's page: "About ·
Squats · Counted by the camera". On a member's card: what it is about, how it is counted,
their number with its word and, from 19d-iii-b, **What counted**: each set that counted,
and each that did not with why ("typed in by hand" · "the camera couldn't watch this
set" · "saved more than 7 days later" · "over the 50 a day this challenge counts").

#### 15.10.7 The jobs

Every job is Risky (other people's numbers; a rule that ranks) and Opus xhigh. The two
extra passes run once over the family, before any gym uses a challenge the camera counts.

- **19d-iii-a, the list and the form that reads it.** The list and its route; the kept
  shape (§15.10.2); the words sent with every challenge; the form's first question read
  from the list; staff counting any exercise in the library. No challenge a gym has
  changes its numbers. *Worst thing, first test:* a challenge made before this job counts
  something else after it. Every kind (gym days · workout days · the gym's own; most ·
  target · fewest; individual · teams) reads the same numbers, places and sentences
  before and after the migration, run on a temp copy of the table. Also first: a subject
  this client has never heard of is shown from the words the server sent. If it passes
  about a thousand new lines it is two pull requests: the list and the kept shape, then
  the form.
- **19d-iii-b, an exercise the camera counts.** The believable rule; the `reps` and
  `days` counters; What counted; the member's line and Hide me. *Worst thing, first test:*
  somebody wins with squats nobody did. A table of sets sent through the real sync route
  (believable · too fast for the exercise · the camera watched nothing · typed by hand ·
  another exercise · an exercise the camera cannot count · before joining · saved late ·
  dated ahead), of which only the first counts. A member's list is measured at 20 gyms of
  200 with every challenge an exercise, and an index on a person's sets by exercise and
  day is added only if that measurement asks for it. **Waits** for the camera to count
  correctly (ROADMAP Stage 4 item 6) or for the phone app's camera. Its plan names
  2026-08-25's "no camera-dependent gym feature" as replaced for challenges.
- **19d-iii-c, more ways to count an exercise.** Up to ten exercises in one challenge;
  the best single set; time held and the longest hold, from sets the camera watched; "at
  most N a day"; "only on a day they checked in". *Worst thing, first test:* a limit the
  gym set is not kept, or a best single set is two sets added together. Its plan asks Kd
  one thing: whether time on the app's clock, with nothing watching, may count (the
  terminal recommends no: the clock times the minutes, not the exercise).
- **19d-iii-d, running.** With the phone app's running (Stage 5 item 4). *Worst thing,
  first test:* a member's route, or a run in a challenge they did not join, is shown; a
  typed or impossible run counts. The Leaderboard's Running board (§15.5, "Later") reads
  the same counter.

**Adding a feature later** (steps, cycling, whatever the app comes to track), in this
order: (1) the feature itself is built, and keeps each person's dated amounts and how
each was measured; (2) its plan says how it is counted and what is dropped as not
believable, and a typed amount never counts; (3) one row is added to the list; (4) one
counter is written, with a table test built from real records that includes what it
must drop; (5) its What counted lines; (6) its cost is measured at full size. Nothing
else is touched.

**Not in this plan:** members making challenges of their own · challenges between gyms ·
knock-outs · a clip of the camera's points run again on the server (v1 §14, item 2; for
a prize between gyms, if ever) · anything read from a watch (after launch).

---

## 16. Messages and reports

*(ADDED 2026-09-22, the same planning chat: Part 7 of Kd's planning document, agreed
that day — RULINGS 2026-09-22. A frame. It takes in ROADMAP Stage 2 items 2 and 12.
Opus xhigh: it sends data out to real people.)*

**The worst thing this section could do to a real person:** "We miss you" to somebody
the gym removed; "Payment overdue" to somebody who paid; the same message fifty times
because a job ran twice. The first tests written: a job run twice sends once; a former
or removed member gets nothing; an overdue reminder is never made for a paid bill; a
person who switched a kind of message off never gets it.

### 16.1 The channel: in the app

A gym's message to a member is a row in **the member's inbox** on that gym's page in
the phone app (the member web until it exists), with a phone notification once the
phone app has push (spec Part 6 §6) — Kd's change to the plan, RULINGS 2026-09-22.
`gym_member_messages`: gym · person · kind · the words as sent · when · read at ·
expires (30 days). **Email only where the person has no app**: the member's invitation
(9.12), a staff invitation (10.3), the owner's weekly
summary — and the sign-in code. (A lead's follow-ups go from the gym's own email, 16.3.) **No SMS** (RULINGS 2026-09-17). The one gym message
of RULINGS 2026-09-07 (a new one replaces the old; gone after 7 days) becomes the
inbox's pinned note.

**The menu says a message is waiting** (ROADMAP 20a-ii): the dot beside My Gyms lights
while any of the member's gyms holds a new message, and goes out once that gym's Inbox
is opened; with two gyms each gym's button shows its count. The list of my gyms
(`/v1/orgs/mine`) carries the count a gym, `newMessages`, by the inbox's own rule.

**Contact the gym** (ROADMAP 20a-iii; RULINGS 2026-10-09): nobody can reply in the inbox, so
under its note a button, **Contact the gym** (the studio, the trainer), opens the gym's phone
number as a link that calls and its email as a link that writes. A gym that added neither
has no button and one line, "{gym} hasn't added a phone number or email yet." The gym types
them in Settings → **How members reach you** (both optional, saved by the gym's details
route on `org.manage`; `gyms.contact_phone`, `gyms.contact_email`, migration `0090`). They
are sent with the inbox (`contact`), so only a live member of that gym reads them, and not
from a gym that is closed or on no plan. They are never the owner's mobile for payments
nor the address leads reply to: nothing is copied in. A phone number is 6 to 15 digits,
with spaces, brackets, hyphens, dots, slashes and one `+` at the start or straight after an
opening bracket (`gymContactPhoneProblem`, `packages/shared/src/gymContact.ts`). It is ONE
number: a slash after seven or more digits (ten with a country code), or a spaced slash or
hyphen with six or more digits each side, is a second number or line and is refused as
"Add one phone number only." The Call link dials the digits, and with a country code it
drops the "(0)" written after it ("+44 (0)20…" dials +44 20…). Somebody who runs the gym
they train at reads the line with a button to the Settings box.

### 16.2 The automatic messages

Each a switch in Settings → Messages, each number the gym's to change: **Welcome** (on
joining) · **Trial check-in** (day 2 of a trial membership) · **Trial ending** (2 days
before) · **We miss you** (no visit for 10 days; once for each absence) · **Membership
ending** (7 days before) · **Payment overdue** (3 days after a bill's due date, §14.2)
· **Birthday** · **Milestone** (the 50th visit, the 100th). Fixed words with the gym's
name and the person's first name; the gym may add ONE line of its own — 140
characters, no links, no `@`, held by 15.3's filter. One worker decides what is due,
by ONE pure rule over (the gym's switches and numbers, the person's record, visits,
membership and bills, what was already sent, the gym's clock), with a table test over
every kind × every reason NOT to send: former · removed · switched off by the person ·
already sent for this occasion · another automatic message that day · night by the
gym's clock · the gym lapsed. `(gym, person, kind, occasion)` is UNIQUE, so a second
run cannot send a second message. A member can switch each kind off, except a payment
notice.

**Built in 20a (2026-10-09):** the table is `gym_member_messages` (`0088`), one row a
(gym, person, kind, occasion) under a unique index. The rule is `gymMessageDue` in
`packages/shared/src/gymMessages.ts`, pure, with its table test over every kind and every
reason; the worker's `orgs.member_messages` runs it four times an hour
(`messages/send.ts`), a gym at a time with the gym's row held. **Only Welcome is sent
yet**: the other seven kinds are in the rule and are given no facts until 20b reads
memberships, bills, birthdays and visits for them. The terminal's own, Kd's to overrule
(RULINGS 2026-10-09): messages go from 08:00 up to 21:00 on the gym's clock · one a day,
picked in the order payment overdue, membership ending, trial ending, trial check-in,
welcome, birthday, milestone, we miss you · a Welcome goes up to three days after
joining, and never to the gym's own staff · after its 30 days a message leaves the inbox
and its row is kept, so its occasion is never sent again · somebody removed and back sees
only what was sent since they came back (Put back opens the same stay again, so it gives
the old messages back) · a closed gym or one on no plan sends nothing
and its members are shown none. The member reads it on their gym's page, the **Inbox**
tab (`GET /v1/orgs/:gymId/inbox`), which counts what is new before it is opened; opening
it marks them read (`POST …/inbox/read`). The pinned note is the newer of the gym's cheer
and its come-back line for seven days, read from the fields `/v1/orgs/mine` already
carries; the cheer's line on the gym's card stays where it was. A person's own switches
and the gym's are 20b. **An occasion is never named by a day of the gym's calendar that
a zone change can move** (round one's L1): a Welcome's is the join's day in UTC, and 20b
names each of its own the same way (a trial's and a membership's by the row they belong
to). A gym the run cannot read is logged and skipped, the rest are still sent theirs, and
the run then fails; a gym whose new people all have their Welcome is not looked at.

### 16.3 Leads

`gym_leads`: name · email · phone · where from · `new` · `contacted` · `on_trial` ·
`joined` · `lost` · notes. Added by hand or from a file (20c-iii): **Import leads** reads
a CSV or Excel file with the member list's own reader (§9.4, §11.2's never-kept columns
dropped first), guesses name, email, phone, "heard of you from" and notes by heading
(the vendors' own export headings, read 2026-09-27), and shows before anything is saved
who is added, who is already a lead (left as they are), who is already on the member
list with the same name and contact (not added), who repeats an email or phone from an
earlier row, and each file word beside the source it was sorted into (the word kept in
the notes). Every lead from a file is New and **never ticked "Happy to hear from us"**,
whatever the file's opt-in column says. Add re-reads the file and, under the gym's lock,
adds exactly the list shown (its key) or nothing; staff tick that they may store the
people's details, as for the member list. Three follow-up emails, day 0 · day 3 · day 7, **sent by the gym from
its own email, not by the app** (RULINGS 2026-09-27): only a New lead ticked "Happy to
hear from us" is due one; the first on the day of the tick, the second 3 days after the
first is sent, the third 4 days after the second (`follow_up_due_on`, the gym's day);
**Email {first name}** opens the gym's email program with fixed words and the gym's
address, and staff press **Mark email N as sent**; an **Email due** chip and tag on the
list. Moving the status or taking the tick off stops them; a new address starts them
again. Nothing goes through our email account. Staff mark only the next one, on or
after its day, to the address the lead has now. A due day is the gym's day when it was
worked out; a gym that later changes its time zone may see one a day early or late. A lead who becomes a
member is the same person: the record is made from the lead.

**"Send them for me" (20c-v-a; RULINGS 2026-09-27).** Settings → **Follow-up emails to
leads**: the owner's switch (`org.manage`; off until turned on; a change needs a live
plan) and **Replies go to**, the gym's own address (the owner's own filled in when the
switch is first ticked), because the app's sending address has no inbox. Switching on
needs the gym's postal address and a name an email can show. With it on, the worker sends
each New, ticked lead's next follow-up on its day, from 8:00 to 20:00 by the gym's clock:
the same three letters the panel writes (`leadFollowUpLetter`), "Hi {first name}" (the
name cleaned as the gym's own words are, so a name typed as a web address carries no
link), signed with the gym's name and postal address, from "{gym} via AI Home Gym" on the
invitations' mailbox with Reply-To the gym's address, and a one-click **Stop** (RFC 8058).
Up to **100 new leads a gym's month** (`LEAD_EMAILS_PER_MONTH`): a lead counts once, when
the app first emails it under its tick, and its later emails go outside the count; past
100 the rest are staff's, as in 20c-ii. Through the invitations' checks (the address rule,
the domain's MX, shared mailboxes, suppressions, a gym stopped for bounces or a complaint),
their whole-app day (`INVITE_EMAILS_PER_DAY`, the two counted together), their kill switch
and their handling of Resend's answers (unclear: again under the same key; after 20 hours
taken as sent, since the same email twice is worse than one missing); and never to an
address a current record on the member list holds. `gym_lead_sends` keeps one row per
lead, tick and step (UNIQUE), whatever became of it: the worker takes a due lead under its
lock, looks again with the lead locked just before sending, and staff pressing Mark as
sent on an email the app has taken are refused (`follow_up_sent_for_you`). Stop keeps the
address from every email of that gym through the app (invitations too) and takes the
lead's tick off; staff may tick it again for a person who asks at the desk and send by
hand, but the app never emails that address for the gym again. Each lead says who sends
its next one (`followUp.by`), why the app did not (`notSent`) and when the person asked to
stop (`optedOutAt`); **Email due** counts only staff's. The app's they are only while emails
through it can go: with the operator's kill switch on (`INVITES_PAUSED`) they are staff's and
Settings says emails are paused; with sending not set up the switch cannot be turned on
(503 `invites_off`, as for invitations). The panel says when the app sends one
(`followUp.appWhen`): today; tomorrow morning, after 20:00 by the gym's clock; or
"waiting to be sent for you" — held for another try (a week of that gives it back), or its
day gone by in the sending hours. Every try, a first or another, waits for those hours.
An address stopped, bounced or on the member list is staff's at once on the panel; the
list's Email due counts it from the worker's next try, since it cannot read the keyed
address list. **What comes back (20c-v-b)**: Resend's reports on these emails are kept
by the invitations' webhook (the `lead_send` tag names the row) and acted on by the same
worker, only once Resend's own record of the email agrees: the email keeps its result
(`gym_lead_sends.result`), a hard bounce or an address Resend refuses keeps the address
from every gym, and a complaint keeps it from that gym and takes the lead's tick off if
it is still at that address, as Stop does (the panel then says why, and staff may tick
it again for a person who asks). The gym's stop (§9.12: bounces past 2 %, or a complaint
among its first 100) counts its invitations and these emails together, and stops both;
the operator's note says so. **Found on the list** (RULINGS 2026-09-29): a New lead whose
address bounces, or that the email service refuses (its own list, which a spam report
anywhere can put an address on, so never called a bounce), or who marked one of the gym's
emails as spam and has not been ticked again since, is tagged on its Leads row ("Email
bounces" · "Can't be emailed" · "Marked as spam", `emailProblem`) and counted in an
**Email problems** chip that shows only them (`followUp=problem`; found by the address's
HMAC kept on the lead, `gym_leads.email_hmac`, written by the app with every address and
filled for older leads by `tools/lead-email-hmacs.ts`); the lead's panel says the same
whoever sends the next email, or with none to come ("Emails to this address bounce. Check
the address with them."); a spam report reads "they marked one of your emails as
spam" (`optedOutHow`); and a gym whose emails through the app are stopped is told at the
top of Leads as in Settings. A lead from the gym's page, ticked by the person on the form, is emailed like
any other, as gym software does (RULINGS 2026-09-29): a stranger could type somebody
else's address, which is met the standard way, as for invitations — the robot check, the
form's limits, Stop in every email, the address check — and 20c-v-b is built before any
real gym switches this on.

**The gym's own page and its form (20c-iv-a; RULINGS 2026-09-28).** `/gyms/{slug}`, a
page of ours anyone with the link opens without signing in: the gym's name, town, today's
opening hours and the week (from Settings), its **About us** (1,000 characters) and the
**Facilities** it ticked from a fixed list of 21 (`GYM_FACILITIES`) and the ones it added
itself (**Add a facility**: up to 10, 40 characters each, shown ticked in the same list and
taken off by unticking; words that are the list's own tick the list's facility, and one
typed twice is kept once — `typedFacility`), as one list, then **Get in touch**: name, email or phone, "How did you hear about us?" (the five
sources in a visitor's words), a message (1,000), an unticked **Happy to hear from {gym}
by email**, Cloudflare Turnstile's robot check, a hidden field only robots fill (labelled
"Leave this field empty", a name no autofill knows), and
"Your details go only to {gym}, so they can reply." `?embed=1` is the form alone, and
**Leads → Your gym page** gives the code (an iframe) that shows it inside the gym's own
website, beside the link. The page is **off until the owner switches it on** (`gym_pages`;
`org.manage` changes it; staff with `members.confirm` see it and copy the link); off, of a
gym with no live plan, closed, or no such gym, both routes answer the same 404. A sent
form always answers the same `received` — for a new person, a known lead or a robot — so
the form never says who a gym has. A person no lead has by email or phone becomes a New
lead of THAT gym (`added_by` null, their source or Other, ticked only by their own tick);
one a lead already has by email (else phone) is kept as a message on that lead, which
the form never renames, re-contacts, moves or re-ticks — a stranger can type anybody's
email, and staff may have taken a tick off when the person asked for no more emails; the
person's tick is kept on the message for staff to act on. A gym at its 10,000 leads
refuses everybody alike, before anybody is looked up. Every message is kept on its
lead (`gym_lead_enquiries`, the newest 20, deleted with the lead; the foreign key is
`(gym_id, lead_id)`, so a message cannot sit on another gym's lead) and shown in the
lead's panel as typed; the list tags the lead **From your page**. Limits, in this order:
60 sends an hour from one address (any send), then the hidden field, then the robot
check, then 120 messages an hour to one page — counted only for sends that passed the
robot check, so robots cannot use a page up; a page over it says "This page is getting a
lot of messages…", not "from here". Only our secret and the token are sent to Cloudflare.
The public page carries only TODAY's closure: notes further ahead were written for
members. A robot check that never loaded (a blocker) says to turn the blocker off or
contact the gym, not to try again.

**Photos (20c-iv-b).** At most 10 a gym, 2 MB each (`gym_page_photos`, the database's own
position rule 0–9 refusing an eleventh). The owner adds, removes and picks the **Main
photo** in the same panel, and they go on Save like everything else there; staff with
`members.confirm` see them. The browser redraws a picked photo at most 2,000 px on its
longest side as a JPEG, so a phone's photo fits. The server then checks the first bytes
(JPEG, PNG or WebP only) and **rebuilds the file from what draws the picture and nothing
else** (`photoBytes.ts`): no EXIF, XMP, IPTC, text chunk, thumbnail, or byte after the
picture's end — so no GPS position, camera or time — keeping only the colour profile and,
for a JPEG, the orientation in a block of its own. It keeps the file under a key it makes
(`gym-page/{gym}/{photo}.{ext}`), on the server's disk (`PHOTO_DIR`, required in
production) until Cloudflare R2 at deploy. The public page shows the main photo large and
the rest in a row; a tap opens one full size. A photo is served at
`/v1/public/gyms/{slug}/photos/{id}` only while the page shows (the same 404 otherwise),
as its checked type with `nosniff` and a sandboxing CSP, cached five minutes.

### 16.4 At risk

The console lists members whose visits have dropped — came in at least 2 of the last
4 full weeks before, and not at all in the last 14 days; both numbers the gym's — each
with their last visit and one tap to send a cheer (RULINGS 2026-09-02, 2026-09-05).
It reads visits (§12), so a gym with no check-in in use is told the list needs one.
It takes the place of "slipping away" (ROADMAP Stage 2 item 2). The owner's weekly
summary email: new, left, at risk, visits against last week, money overdue.

### 16.5 Reports

One Reports page (`reports.read`: owner and manager), every figure with the info
symbol that says exactly how it is worked out, and a CSV download. **Members**: active
now · new and left this month · **churn** (those who left in the month over those
active at its start) · retention (1 − churn) · the average stay of those who left —
from the durable records of §11.1, which is why a leaver is kept. **Attendance**:
visits by day and week · the busiest hours (weekday by hour) · visits a member a week ·
how full classes are (booked over places) · no-shows. **Money** — read from the gym's
notebook (§14.2), which holds the gym's prices and every payment though the app never
holds the money: **MRR** (each active repeating membership's sold-at price as one
month) · collected this month · overdue · **lifetime value** (monthly money a member
over monthly churn). A gym that keeps its billing in other software has no money
report and is told why. A figure with too little behind it — under three full months
for churn and lifetime value — says "not enough data yet", never a made-up number
(RULINGS 2026-07-15). Worked out when the page opens from indexed rows or §3.2's
nightly rollups, the cost measured at the biggest size sold (2,000 on the list since
2026-09-24, with 6,000 former records, beside 19 gyms of 200; `tools/measure-reports-cost.ts`).

**Built by 21a-i (2026-10-10): the page and the members figures.** `reports.read` is a
tick of its own (owner and manager; the owner can give it to a trainer), and Reports has
its own line in the menu. A person **starts** on the join date the gym gave, when it is
earlier than the day they went on the list, and otherwise on that day; they **leave** on
the day they are removed from the list (a membership that runs out removes nobody: Kd,
RULINGS 2026-10-10). Somebody removed and put back counts as there the whole time; a
record deleted for good is not counted. **Churn** is the people on the list as a month
began who left during it, over the newest three full months taken together (a person
counts at a month's start only if the list held them before that month ended, so a late
import fills no earlier month); retention is
the rest of 100; the **average stay** is over those who left in the twelve months shown.
A full month is one the list was kept for from its first day. Before three of them the
three figures read "Not enough data yet", and while nobody has ever been removed Left and
the three read "Nobody has been removed from your member list yet", never a zero: a gym
that uses only part of the app is told what feeds a figure, with a button to the place
(RULINGS 2026-10-10). The month the list began shows no New (its first people are not new members) and no
"at start". **Leads that became members**: leads marked Joined over all leads, by where
they heard of the gym; until one lead is marked Joined the shares are a sentence. Each table downloads as a CSV of counts, never a name.
Worked out when the page opens, in one statement over the gym's list. Attendance is 21a-ii.

### 16.6 Cards

**20a** the inbox and the message rule (its table test first) · **20b** the automatic
messages and their switches · **20c** leads · **20d** At risk and the weekly summary ·
**21a** reports: members and attendance · **21b** reports: money (after 18a). ONE
feature each for CLAUDE.md §6 (20, 21).

### 16.7 Where the facts came from (read 2026-09-22)

Twilio support: "A2P 10DLC Sole Proprietor Brands FAQ" (the one-person registration is
for the US and Canada) · the churn and lifetime-value formulas are the plain ones every
subscription business uses; each card names its source before it builds.

## 17. The console's look

Kd, 2026-09-26: the LOOK of every console page redesigned — layout, sizes, fonts, text
colours — drawn first and looked at before the app changed, with the rules every later
page follows. Approved: *"i like all of them"*; both looks, with a switch: *"both design
will have option to switch like dark mode light mode"*; and nothing taken away: *"do not
delete the exsiting features and buttons etc"* (RULINGS 2026-09-26). Built as ROADMAP
R1–R8: R1 the menu, the font and the colours; then one page per job.

### 17.1 Where the drawings are

- `docs/design/console/pages/` — one file a screen, dark (`Name.src.html`; Overview's four
  are finished files, `Overview*.dc.html`). `docs/design/console/shared/` — `helmet.html`
  (every colour and building block), `rail.html`, `topbar.html`, `tabbar.html` (the menus).
  In a page file `<!--HELMET-->` and `<!--TOPBAR-->` stand for those files,
  `<!--RAIL:members-->` for the menu with Members lit (`none`: no gym, so "Gym console"
  where the gym's name goes and no pages) and `<!--TABBAR:members-->` for the phone's
  tabs; the light look of a page is the same file with `t-dark` changed to `t-light`.
- Pictures of all 56 drawings, dark and light: `D:\Projects\ai-home-gym-design\2-all-pages\`
  on Kd's computer. The design canvas: https://claude.ai/artifact/1Rioe5nc9f132HarZ6x69y
  (Kd's; read it with the Artifact tool).
- Members is drawn again by 5b-v (2026-09-27): its 17 files and what each shows are in §18.1; `MembersApp` is gone.
- Not drawn: Staff (4a rebuilt it; 23c-ii built it on Members → Staff from the blocks), the marking-attendance switch, the edit
  forms, Merge duplicate, Bulk edit, Change size and the payment prompts. The job that
  restyles their page draws them from the same building blocks (17.6).

### 17.2 The twelve rules

1. **One page, one job.** The title says where you are, top left. The one main button sits
   top right; on a phone, just under the title.
2. **The key number is the biggest thing.** What a gym checks most is big and bold. Its
   label is small and calm.
3. **Orange means "press here".** One solid orange button per box at most. A second
   important action is pale orange; the rest are outlined. In the menu, orange shows where
   you are.
4. **Colour always has a meaning.** Green is good, amber is "look at this", red is a
   problem, and each class keeps its own colour. Always with a word, never colour alone.
5. **Things that belong together share a box.** Each box has one clear title, and a box
   holds one kind of thing.
6. **One font, a fixed set of sizes.** Archivo everywhere. Titles and big numbers in its
   wider bold style. Three greys for all text.
7. **The same gaps everywhere.** 24 pixels between boxes and inside them (20 on a phone);
   48 at the sides of the page (16 on a phone).
8. **Big enough for a thumb.** On a phone every button and row is at least 44 pixels tall.
   Pick from a list or calendar instead of typing.
9. **One pattern for pop-ups.** One person or thing opens in a side panel on a computer and
   a full page on a phone. A question or a choice opens in the middle, or from the bottom
   on a phone.
10. **Lists look the same everywhere.** Search and filters on top, the count on the right,
    rows that open, "Load more" at the bottom.
11. **Every page in both looks.** Dark and light, switched from the menu, with Auto
    following the device. The menu stays dark in both.
12. **A gym's words.** Say it the way a gym would. No sentences that explain how the app
    works inside.

### 17.3 Colours

A page names a colour and never writes one: `apps/web/src/components/console/console.css`
holds both looks under `.t-dark` and `.t-light`, and the shell puts one of the two on its
root. The menu's colours (`--rail-*`) are the same in both looks.

| Name | What it is for | Dark | Light |
|---|---|---|---|
| `--page` | the page | #0C0B0A | #F5F3EF |
| `--card` | a box | #151311 | #FFFFFF |
| `--t1` · `--t2` · `--t3` | main text · second text · hints and small print | #F4F1EC · #B8B0A6 · #8B847B | #1B1815 · #57504A · #736C64 |
| `--accent` | orange: press here | #FF8A1F | #FF8A1F |
| `--soft-t` on `--soft` | pale orange: the second action | #FF9F45 on #2A1A0C | #9A4508 on #FFE9D2 |
| `--good` · `--warn` · `--bad` | good · look at this · a problem (each with its `-bg`) | #46D993 · #F2C35B · #FF7B6E | #177A48 · #7A5600 · #C23A2E |
| `--link` | a link inside text | #FF9F45 | #A84D08 (the drawing's #B45309, a shade darker) |
| `--cl-*` | a class's own colour: orange, blue, green, purple, red, teal, amber, slate | see `console.css` | see `console.css` |

Every text colour (`--t1`, `--t2`, `--t3`, `--link`, `--good`, `--warn`, `--bad`) on the
page, a box, a raised box (`--raise`) and a sheet, each tag on its own background, and the
words on an orange, pale orange or picked button, is 4.5 to 1 or more in both looks: 34
pairs a look, measured 2026-09-26 with the WCAG contrast formula and checked on every push
by `apps/web/src/components/console/consoleCss.test.js`. The lowest are the light look's
third text on a raised box and red tag (4.55 each), its third text on the page (4.67) and
the dark look's third text on a raised box (4.69). The drawing's light link, #B45309,
measured 4.42 on a raised box, so the app's is #A84D08 (4.95 there, 5.08 on the page).
The banner above every page takes its colours from the same names (`c-banner-danger`,
`c-banner-warn`, `c-banner-info`).

### 17.4 Text

One font, Archivo, kept in the app (`apps/web/src/assets/fonts/archivo`, SIL Open Font
License); titles and big numbers use its wider bold (`font-stretch: 108%`). The sizes, and
nothing between them: big number 48 (phone 44), 40 inside a pop-up · page title 34 (phone
28) · box title 18 · words 15 · labels 14 · small 13 · the phone's tab names 12. Classes:
`c-big`, `c-big-sm`, `c-h1` (34, and 28 under 768 px), `c-h2`, `c-h3`, `c-sub`,
`c-eyebrow`, `c-s12`–`c-s16`, `c-w5`–`c-w7`, `c-t1`–`c-t3`, `c-lk`, `c-num`, `c-ell`. The
title classes carry their own colour, because `index.css` makes every heading white.

### 17.5 The menu (R1)

On a computer (768 px and wider) the menu is on the left: the gym's name at the top with
its city and type under it — tapping it opens "Your organisations" — then the pages this
person may open, then **Your organisations**, and at the bottom their name, their role and
**Sign out**. On a phone the gym's name is on a bar at the top (tapping it opens "Your
organisations"), and the bottom holds up to four tabs and **More**. More holds the pages
that are not tabs, **Your organisations**, the person's name and role, and **Sign out**.
Where there is no gym yet (your organisations, create) the menu says "Gym console" and
holds the name and Sign out, and the gym box says "Gym console" too while the gym is being
read or when the address is not one of the person's gyms; on a phone the top bar holds "Gym console" and Sign out, and
there are no tabs.

| Page | Drawn for whoever holds | On a phone |
|---|---|---|
| Overview (was "Gym") | everyone | tab |
| Members (Clients for a studio or trainer); **"Members & staff"** for whoever holds `staff.manage`, since 23c-ii | everyone | tab, as the one word "Members" |
| Memberships (23c-i) | `memberships.manage` | More |
| Leads | `members.confirm` | More |
| Attendance | `attendance.read` | tab |
| Classes | `schedule.manage` | tab |
| Settings | `org.manage` or `schedule.manage` (`staff.manage` until 23c-ii: staff are on Members → Staff) | More |

Pages added since R1, each in `consoleMenu.js` with its own tick: Personal training (every
member of staff), Updates and Events (`posts.manage`), Leaderboard and Challenges
(`leaderboard.manage`), all under More on a phone.

**Buttons, not words (23d, 2026-10-07; RULINGS that day, "the console is made easy to find
one's way in").** A sentence that sends staff to another place has a button that opens that
exact place, with its box open and in view. `consolePlaces.js` is the one list of those
places, each with its address and the rule that opens it, the menu's own; `PlaceLink` is the
button. Somebody who cannot open a place gets no button, and the sentence says who can.
**Every button opens its place in this same tab** (Kd at the click-through, RULINGS
2026-10-07: new tabs "become a pile of tabs"; a link inside an app opens where it is, and a
new tab is for an outside site). A button that sits in a form or a box holding something
typed **asks first**, in place: "You'll leave this page, and what you typed here won't be
saved." with Leave this page and Stay here. **The gym's postal address, which stops an
invitation, is typed where it is asked for** (`PostalAddressBox`: Invite, and a person's
page), saved by the route Settings uses, so nobody leaves that page and the people ticked
are kept. A box that sends staff to Memberships reads again when they come back to its tab
(`useCameBack`, which hears a switch of tab as well as of window).

| Sentence, on | Button | Opens |
|---|---|---|
| Invite, and a person's page: the gym has no postal address | none: **Postal address** and **Save address**, there | nothing; the count is read again |
| Memberships: the country is not set | Set your country | Settings, Gym details open, at the country |
| Leads → Your gym page: its opening hours | Change opening hours (asks first while the page has changes not saved) | Settings, When we're open, open |
| A lead's follow-up: where replies go | Change reply address (asks first while the lead has typing not saved) | Settings, Follow-up emails to leads, open |
| Settings → Follow-up emails: the rest wait on Leads | Open Leads (asks first while a change there is not saved) | Leads |
| A person's Memberships box (a name with no price here; a type not given; no types to pick) | Open Memberships | Memberships |
| Add member, in a gym with nothing to sell (23a-ii) | Set up memberships (asks first once something is typed) | Memberships |
| The Remove box: staff who keep their staff access | Open the Staff tab (somebody who cannot open it reads "The owner can remove someone from staff.") | Members → Staff |
| Leaderboard → a person → Add a visit: "For today, use Check in on Attendance" | Open Attendance (asks first once a day is picked) | Attendance |
| Personal training: an empty member list in the picker | Open Members | Members |
| Personal training: a class in a trainer's time off (their week; the time-off box, which asks first) | Open the Calendar | Classes → Calendar, on that class's week (`&week=`) |
| Classes: sessions a class would go over | Open Personal training (asks first) | Personal training |
| The banner: pay, choose a plan or change size "under Plan on the Overview" | Open Plan | Overview, at the plan (`#plan`) |
| An invitation not sent because the business name can't be used in an email (a person's page; Members → Staff → Invited) (23d-ii) | Open Gym details (on a person's page it asks first while a form is open; anybody else reads "The owner can change the name in Gym details.") | Settings, Gym details, open |
| Import members and Import leads: phone numbers left out, no country set (23d-ii) | Set your country (asks first; anybody else reads "The owner can set the country in Gym details.") | Settings, Gym details open, at the country |
| A person's page: "Not them?" refused, they are staff or have a complimentary place (23d-ii) | Open the Staff tab (anybody else reads "The owner can change their access."); the sentence ends "so their access isn't changed here." | Members → Staff |
| Settings → Follow-up emails: no postal address; the name can't be shown in an email (23d-ii) | Add your postal address · Open Gym details | that box, higher up the same page; the box reads its facts again when Gym details saves, keeping what is typed |

The server's own sentences name no place in words since 23d-ii, and a link to a section counts each press, also one to the section already named ("Change it to the name in words, then
invite them again."); the screen adds the button or who can (`sentencePlace` in
`consolePlaces.js`, drawn by `SentencePlace`).

Settings' sections take a link by their `id` (`gym-details`, `opening-hours`,
`check-in-devices`, `follow-up-emails`), and `postal-address` and `country` are boxes inside
the details. Not a button: "You can add yourself later from Members", said while a gym is
being created, when there is no gym to open; and a person's own page, named in sentences
about several people at once.

Every page appears for exactly the people it appeared for before R1; drawing a page is not
the permission — every route refuses on its own. The More tab is lit on More and on a page
reached from it. The prompts drawn from the shell (the plan prompt, the smaller-size
question) and the banner above every page are unchanged by R1 and restyled with Overview
(R4). `apps/web/src/pages/console/consoleMenu.js` holds the rule, and
`consoleMenu.render.test.jsx` draws every mix of the five permissions and checks that the
menu, and the phone's tabs with More, each hold exactly the pages above.

### 17.6 A page

The title top left and the page's one main button top right (on a phone, under the
title); search and filters under the title; the main work in a wide column and side facts
in a narrow one; one column on a phone. A page's padding is `c-page`: 48 at the sides and
24 between boxes on a computer, 16 and 20 on a phone. The building blocks, in
`console.css`: `c-card` (a box) and `c-row` (a row in it, 44 px or more) · `c-btn` with
`c-btn-p` (orange, one a box), `c-btn-soft` (pale orange), `c-btn-s` (outlined),
`c-btn-danger`, `c-btn-ghost`, `c-btn-lg`, `c-btn-sm`, and `c-btn-link` and `c-btn-quiet`
(an action written as a word, orange or grey: a time slot's Edit and Cancel) · `c-icon-btn` · `c-chip` and
`c-chip-on`, with `c-n` for its count · `c-tag` with `-good`, `-warn`, `-bad`, `-plain`,
`-soft` · `c-tc` (a time in a grey box) · `c-field`, `c-label`, `c-hint`, `c-input`,
`c-sel`, `c-area`, `c-search` · `c-check`, `c-switch` · `c-utabs` and `c-utab` (tabs
across a page) · `c-th` (a table heading) · `c-sheet` (a panel or pop-up) · `c-callout`
(the amber "look at this" box) · `c-seg` and `c-seg2` (Light · Dark · Auto). Every class
starts `c-` because the member pages already use `.card`, `.btn` and `.label` for other
things. Rule 8 holds whatever a drawing shows: under 768 px every `c-btn` (`c-btn-sm`
included), `c-chip` and `c-icon-btn` is at least 44 px tall, an icon button 44 px wide
too, and `consoleCss.test.js` checks it with the widths each bar shows at. Icons are the
line icons the app already uses (`lucide-react`), never emoji.

### 17.7 Both looks, and the switch

A page is drawn once; `.t-dark` or `.t-light` on the shell's root picks the colours. The
switch — **Light · Dark · Auto**, Auto following the device — sits at the bottom of the
menu on a computer and on More on a phone, as drawn, and is built by whichever of R2–R8
is built LAST, once every page is in both looks, so nobody meets a half-finished page; its
plan says where the choice is kept. Until then a development build shows a page in the
light look when its address ends in `?look=light`, which is how each job's click-through
shows a finished page in light.

### 17.8 Restyling a page (R2–R8), and new pages

- A restyle changes how a page looks, never what it does: every button, field, message,
  count and permission it has today stays (RULINGS 2026-09-26). What the drawing lacks and
  the page has is kept, drawn from the same building blocks; words change only where the
  drawing changed them and RULINGS allow.
- A page is restyled only after Folder A's last planned job on it (ROADMAP R4–R8 say
  which), so the two folders never change one page at once.
- From R1 on, a NEW console page, or a new box on a page already restyled, is built in the
  new look in both folders. A new box on a page not yet restyled follows that page's
  current look, and its page's R-job restyles it with the rest.
- The pieces several pages share — the loading and failed boxes, the "are you sure" line,
  a folding section (`ConsoleStates.jsx`) and the date and time pickers — draw the new look
  when a restyled page passes `newLook`, and the old one otherwise, so a page not yet
  restyled keeps its look until its own R-job (R2, 2026-09-26).

### 17.9 Where the facts came from

The drawings: 17.1. The two font files are the ones Google Fonts serves (Archivo v25,
Inter v20, with Google's own character ranges), and their SIL Open Font License 1.1 texts
come from github.com/google/fonts; both fetched 2026-09-26. They are kept in the app
because a page that loads Google's fonts sends each visitor's internet address to Google,
which Landgericht München I found a breach of the GDPR on 20 January 2022 (3 O 17493/20).

## 18. Members, redesigned (5b-v)

Planned 2026-09-27 (RULINGS 2026-09-26, "Members is redesigned before anything more is built
on it"), after 5b-iii's click-through measured the same people in two tabs, 14 labels for
where someone stands with the app, 79 phrases in all, and buttons acting on people the screen
never named. The words and the layout are the planning terminal's judgement (CLAUDE.md §3,
§4 "Screens a new gym understands"); every feature Members had is kept (18.9). It is built in
the console's new look (§17), so it is also Members' restyle (ROADMAP R8, folded in).

**AMENDED 2026-09-28, after 5b-v-a-i merged (RULINGS 2026-09-28, three lines)** — where anything
below says otherwise, this wins:
- **The two tabs stay** ("Your list" · **In the app**, renamed from "Using the app"); 5b-v-a-ii
  is not built. Someone in the app who isn't on the list stays on the In the app tab with its
  amber "Not on your list" tag. Where 18.5 gives the bar to "Not on your list", 5b-v-b-ii gives
  it to the In the app tab.
- **The toolbar's Invite to app stays** and chooses by the Filter's words, as it did; the tick
  boxes, "Select all" and the bar come beside it, and the bar's Invite reaches only the people
  selected (5b-v-b-i). "Remove from app" in 18.5 and 18.6 is One Remove (2026-09-27): the bar's
  Remove moves each selected member to past members and ends their app, in 5b-v-b-ii.
- **Built in 5b-v-b-i:** a selection is the rows ticked (`kind: "ticked"`, at most 500 ids) or a
  "Select all" (`kind: "all"`: the list's filter and search, the count and a digest of exactly
  who, from `POST …/member-list/selection`). Invite's numbers, its page and the press, and
  `POST …/member-list/export.csv`, take it; a "Select all" whose filter now matches anyone else
  is refused with 409 `selection_changed` and the new count and digest, and nothing is done
  (`memberList/selection.ts`). The file is 5b-iii's (formula cells guarded, email and phone as
  checked, "Past member since" when past members are in it), named "Active members
  2026-09-28.csv" for a Select all and "Selected members …" for rows ticked.
- **Built in 5b-v-b-ii: Remove on the people selected.** The bar's **Remove** ("Remove from app"
  on Past members; "Remove" on the In the app tab, which now has tick boxes too, ticked one by
  one, at most 500) opens the box of 18.6: "You selected 4 members." · "4 will move to past
  members" and names · "2 will lose access to the app" and names · "3 won't change", a line per
  reason (Owner and staff keep the app · Keep the app: on your list with their own details ·
  Keep the app: they share an email with someone still on your list · Not in the app · No
  longer on your list) · the large-change tick (more than 10 and more than 10 % of the paid
  places, or of the list) · **Remove 4 members** (red). One rule decides it, for the box and the
  press (`memberList/removeSelected.ts`): a record's person loses the app when the record is
  certainly theirs (`whose.ts`), or when a family's shared email has EVERY one of its records
  ticked (whichever is theirs was ticked; at 20 or more records on one email, never); staff and
  complimentary places never. The press carries the box's digest; if anyone changed, nobody is
  removed and the answer is the new box (409 `remove_changed`); "These members were already
  removed" only while that earlier press's work still stands. Put back undoes each person.
  Routes: `POST …/member-list/selected/remove-preview`, `…/selected/remove`,
  `POST …/members/selected/remove-preview`, `…/members/selected/remove`; the presses have
  their own limit (30 an hour each, 120 from one address). The box says why only some lose
  the app ("Only people who use the app lose access. The other 1 doesn't use the app, so only
  their details move."), from the server's count of moving records nobody in the app uses;
  on In the app, someone NOT ticked whose record moves with a ticked person is named ("Keep
  the app: their record is the same as someone you selected…"). Also from Kd's click-through:
  on a computer the toolbar and the bar stay at the top of the screen as the list scrolls, and
  Back to top / Go to the bottom buttons sit at the bottom right. Cost at the ceiling (10,000
  on the list, 2,000 in the app; mains): the box for everyone 431–481 ms (a 1.09 MB reply of
  names), 500 ticked 62–74 ms; Remove 500 272–294 ms; removing 8,250 at once 2.0 s; answering
  nobody at most 47 ms throughout. A gym of 200: at most 291 ms, 17 ms.
- **The "plan was full" line says when, and how the plan stands now** (Kd, 2026-09-28): "Noah
  tried to join on 27 Sep, when your plan was full. 496 places are free now, so ask Noah to try
  again." · "… It's still full: upgrade your plan or remove a member who has left, then ask
  Noah to try again." · "… Your plan has free places now …" (no cap) · "… You have no active
  plan now, so nobody can join until you choose one." Never "all 500 places are in use".
- **Built in 5b-v-c: a person's page** in the new look, a side panel on a computer and the
  whole screen on a phone. One orange button by state (Invite to app · Send again · Invite
  again · Edit · Put back on your list); under More, Remove ("When they have left your
  gym", One Remove: the drawing's separate "Move to past members" and "Remove from app"
  items are gone) and Merge duplicate. **Invite to app asks first**: "Invite Ava Thompson to
  the app?" / "One email goes to … with a link to the app." · **Send invitation** · Cancel.
  A past member still in the app has the amber line with **Remove from app** on the page.
  Sections Contact · Membership · Custom fields · App. Someone in the app not on your list
  whose email a member on the list holds gets **Open their details** (the roster's
  `offList.sameEmailEntryId`, this gym's record only).
- **An import's "They've left" ends the person's app** in the same step (One Remove), each
  missing person marked by staff, the box naming who loses the app; Put back gives both back
  (5b-v-d; amends §9.2 principle 1).

**AMENDED 2026-09-28, the words** (Kd: *"use standard words this is not a school project … a
professional software will not have this kind thing"*). Plain, neutral product wording, as
email and gym software write it; where a quote below differs, these words win:
- **Invite:** "Invite members to the app"; "20 of 38 members will receive an invitation email ·
  18 not included" ("All 38 members will receive an invitation email"; "No members to invite ·
  38 not included", and then the Not included tab opens first); tabs **Recipients** · **Not
  included**; columns Name · Status · Membership · Email (or Reason); "Filtered by Status:
  Active"; reasons "No email address" (Add an email address to invite them.), "Under 18 (can
  be invited from 1 May 2030)", "Already in the app", "Shares an email address with Arjun
  Shah, who is being invited", "Invitation sent · 22 Sep" (To resend, open their page.),
  "Email address bounces", "Shared email address (such as info@)", "Unsubscribed from your
  emails"; after Send, "20 invitations are being sent." and "Share the invitation".
- **A person's page:** "Remove Olivia Bennett?" / "They'll be moved to past members and lose
  access to your gym in the app. Their details are kept, and you can put them back at any
  time."; a past member, "Remove Grace Hall's app access?"; Not this person, "Remove du's app
  access?" with **Remove access**; notices "Member added.", "Changes saved.", "Moved to past
  members. Their details are kept.", "App access removed. …", "Restored to your member list.",
  "Invitation sent. It will arrive within a few minutes."; under 18, "They can be invited from
  14 March 2028, when they turn 18. If the date of birth is incorrect, select Edit to update
  it."
- **Lines:** an invitation email that did not go, "Invitation not sent: …" (for example "…this
  member wasn't on your list when it was due. Invite them again."); a full plan, "Noah tried
  to join, but all 500 places on your plan are in use. Upgrade your plan or remove a member
  who has left, then ask Noah to try again."; a wrong address, "The recipient at … says they
  aren't Jacob. Confirm Jacob's email address."; a past member in the app, "Grace is a past
  member but still uses the app. Remove them if they've left."
- **The list and Import:** "3 need attention" and the Filter's **Needs attention**; "No members
  match."; "13 of 14 columns matched" and "Examples are from the first row of your file.";
  "03/04/2024 is read as 3 April 2024" with **Change to 4 March 2024**; "Added manually · 20
  Sep"; "Your file should include all current members, so members missing from it have
  usually left. Members added manually may not be in your export yet."

**AMENDED 2026-09-28, round one of 5b-v-a-i** (the review's six Highs; built in the same job,
and where anything below says otherwise, this wins):
- **A family's shared email the list can't place (row 1e).** Someone in the app who joined
  with no record, on an email (or phone) that several current records hold, under a name on
  none of them: every one of those rows reads **In the app** in amber with "Mum uses the app
  with the email address Leo Park and Maria Park share, so we can't tell which of them it is.
  Give each of them their own email address." (Needs attention). No record is theirs for
  certain (`membersAgainstList`'s `unsure`, `whose.ts`): Remove on either record leaves their
  app, Not {name}? is not offered and is refused, "Using the app" opens no record for them
  ("On your list as Leo Park or Maria Park") and its Remove ends their app only. Once one
  record holds the email, it is theirs.
- **A past record reads In the app only when it is certainly the person's** — the one they
  joined with, when no current record keeps them on the list (Remove's own rule). A past
  record whose email someone else in the app uses reads 1c ("Maria Park uses the app with
  this email address.") and nobody's app ends with it.
- **A removal is read only onto its own record.** Removing someone with a record keeps that
  record on the closed membership (`gym_members.removed_entry_id`, migration 0048); only that
  record reads "Removed from app · 28 Sep" (row 4) and counts under the Filter's Removed from
  app. Another record at the address reads "Someone using this email address was removed
  from the app · 28 Sep" (row 4b).
- **Not {name}? marks the address the account used as somebody else's**
  (`gym_invites.wrong_person_at`): its invitation stays stopped, nothing is sent to it again
  (Send again refused, `wrong_person`; Invite answers "already invited"), and the record reads
  **Not in the app** with "Someone else uses daniel@… Confirm Daniel's email address." in red
  (row 2) until its email is changed. The box: "du uses the app as Daniel Wu. If du isn't
  Daniel Wu, remove their access…".
- **Boxes name people:** Remove says whose app access ends ("…Ada L will lose access to your
  gym in the app.") and who keeps it ("Mum keeps app access: we can't tell whether they are Ada
  Lovelace."); "Using the app"'s Remove says "moved to past members" only when the server named
  the record it moves, else "Remove Tom Reed's app access?".
- **A stopped invitation offers Invite again, asked first** (RULINGS 2026-09-26), never Send
  again: "You removed Olivia Bennett from the app on 26 September 2026. They'll get one
  invitation email at …". 1c and 1d leave the Filter's Not invited yet (Invite can't reach
  them). Invite's page continues after the last person shown (a keyset on the list's order),
  and each person shows once. "Using the app"'s search finds the list's name of any current
  record on a person's proved email or stated phone. Studio and trainer words: the new
  sentences say "this person" or the organisation's own word ("Past client since").

**AMENDED 2026-09-27, at 5b-v-a-i's click-through (RULINGS 2026-09-27).** Kd: *"clean like the
leads … i dont want thing to be deleted … just fix the vague invite and delete list delete
app confusion"*. Built in 5b-v-a-i, and where this section says otherwise, this wins:
- **Laid out as Leads is.** One tag per row: the App word (18.4), amber or red with a ⚠ when
  something needs checking, the sentence on the person's page (and on hover). Check these is
  one quiet "⚠ 4 need checking" link beside the count, not a box. No button inside a row:
  "Using the app" rows are a name, "In the app since 7 Sep 2026" and one tag (Complimentary ·
  Not on your list); the row opens the person's panel (as a lead's),
  which holds Add to your list / Put back on your list and Remove. "Using the app" has
  "Search by name" (the name they signed up with, and the list's name for staff who see the
  list; never by email) with the count beside it.
- **One Remove** (both doors: a member's page, and a person in the app). Removing someone on
  the list moves their record to past members AND ends their app in one transaction
  (`memberList/oneRemove.ts`), their place freed; only the people whose record it certainly
  is (`memberList/whose.ts`), never a household member on their own record, never someone on
  a family's shared email the list can't place, never staff or a complimentary place. **Put
  back undoes both** (RULINGS 2026-09-27; this line said the opposite until round one): the
  record comes back, and so does the app of whoever staff removed WITH it
  (`gym_members.removed_entry_id`), when the plan has a place for every one of them —
  otherwise the notice says there was no free place, and the page offers Invite again. The
  box: "Remove Olivia Bennett?" /
  "They move to past members and can't use the app with your gym any more. Their details are
  kept, and Put back brings them back." Someone in the app not on the list: "Remove Nia Cole
  from the app? They can't use the app with your gym any more, and they keep their own
  workouts." A role with the list's tick but not `members.remove` is refused on a record
  whose person is in the app, and the reverse ("…your role can't…").
- **Invite is a page, laid out as the list is** (Kd's second click-through: *"it should show
  like a normal dashboard just like your list … showing every details and reason that is
  understandable by human"*, and "Everyone on your list" over "Invite 20" read as a
  contradiction). One line whose numbers add up: "20 of the 38 members on your list will get
  an email invitation. 18 won't." ("…the 30 members you chose…" when words are ticked, with
  "You chose: Status: Active" under it). Two tabs, **Will get an email 20 · Won't get one
  18**, each a table of Name · Status · Membership · The email goes to (or Why they won't get
  one), a hundred at a time with Load more; a row opens the person's page over Invite's.
  Each reason in the words the person's own row uses, and what to do: "No email address ·
  Add one on their page to invite them", "Under 18 · can be invited from 1 May 2030",
  "Already in the app", "Maria Park uses the app with this email.", "Same email as Arjun
  Shah, who gets this invitation", "Invitation sent · 22 Sep · To send it again, open their
  page.", "Removed from app · 26 Sep", "Unsubscribed from your emails", "A shared address,
  such as info@". `GET …/member-list/invites/people?group=reach|left_out&cursor=` is worked
  out by the walk that makes the count and the press (`invites/people.ts`), so the page and
  the Send button cannot disagree. The tick reads "These are Iron House Gym's members, and I
  have permission to email them." Selecting people by hand stays 5b-v-b.
- **Built at the second click-through too** (RULINGS 2026-09-27): an import's "aren't in
  this file" people are shown at once, each with what the list says of them today —
  "Cancelled · Gold · Ended 31 Aug · Unpaid", "Uses the app", "Added by hand · 20 Sep" — and
  "Your file should hold everyone who is a member today, so people missing from it have
  usually left. Anyone added by hand may simply not be in the system you exported from yet."
  A date column's own proof (a day over 12) beats a switch remembered from an earlier file;
  where nothing in the file settles it the line reads "We read 03/04/2024 as 3 April 2024"
  with **Read as 4 March 2024 instead**, which also puts it back; "We understood 13 of your
  14 columns", its examples "from the first row of your file". The Filter's App choices add
  **Not invited yet** and **Removed from app**. An under-18's page adds "They can be invited
  from 14 March 2028, when they turn 18. If the date of birth is wrong, press Edit to change
  it."; a full plan's line adds "Free a place — a bigger plan, or remove someone who has left
  — then ask Noah to tap Join again."
- **One page for one person.** In "Using the app", somebody with a record of their own
  opens the same page as on "Your list" (the current record §9.7 matches them to, else the
  past record they joined with; never a past record found only by a shared email, which can
  be a relative's); the rest keep their panel. A past member still in the app (a whole-list
  import never ends anybody's app) has **Remove** there: "Remove Grace Hall from the app?
  They're already a past member. This ends their app with your gym, and they keep their own
  workouts." Remove's box says the app ends only when Remove's own rule says it will
  (`removeEndsApp`).
- **The email on the list is the link; names are never compared (RULINGS 2026-09-28).** Kd:
  *"daniel wu enter the name as du , but the email is correct , now how on earth gym staff
  will know du is daniel wu"*. As GymMaster, Gym Insight and Gymdesk do (their help pages,
  read that day: the app finds the member's account by the email on file; GymMaster's "member
  must have correct email to login; this is their username"), the person who proves the
  email on a record is that record's person, whatever name they give the app. So there is no
  "Signed up in the app as … Check this is them" any more, on a row, a page or the roster
  (it amends 2026-09-23 (A)). A person's page lists who uses the app with it under the name
  they gave the app ("du joined 7 September 2026"), with **Not Daniel Wu?** beside each for
  staff who know it is somebody else — a relative on a family address, a stranger at a
  mistyped one. It asks first ("du isn't Daniel Wu? du signed up in the app with the email
  address on Daniel Wu's record. They lose the app with your gym. Daniel Wu stays on your
  list: check their email address, change it with Edit, then invite them again.") and takes
  out that one account: the record stays, the address that account signed in with is marked
  as somebody else's (its invitation stopped for good; round one, AMENDED above), and it needs
  the `members.remove` tick. Never offered for a family's shared email the list can't place. "Using the app" shows "On your list as Daniel Wu" beside
  the name they gave the app, and marks nothing. A stranger at a mistyped address is stopped
  where they can be — the invitation's own "It's not me" — which reaches the list as "Whoever
  gets email at … says they aren't Daniel". No join codes: a code tells nobody who someone is
  (staff would see "du" waiting all the same), where a proved email ties them to a record.
- **An invitation whose email never went is not "Invited"** (Kd: *"Not sent: this address
  was no longer on your list … what is trying to say?"*): it reads **Not in the app**, amber,
  with the reason in words that say the email was not sent, and what to press ("The
  invitation email wasn't sent: this person wasn't on your list when it was due to go. Press
  Invite to send it now."), and counts under Not invited yet; an email that went and bounced
  stays **Invited** · "This email bounced…". (The line Kd saw was false: a test run's sender,
  sharing the local database, had skipped his local gym's waiting invitations under its own
  address key. A test's sender now touches only its own gyms, `gymIds`, as the sweeps do.)

### 18.1 The drawings

`docs/design/console/pages/`, the §17.1 format (dark; `t-light` for the light look), 17 files
that replace Members' drawings of 2026-09-26 (`MembersApp`, the "Using the app" tab, is gone):

| File | What it shows |
|---|---|
| `MembersList` | The one list: every App word on a row, the "Check these" box, search, Filter, the count |
| `MembersSelected` | Everyone on the page selected: the action bar and "Select all 312 members" |
| `MembersInvite` · `MembersRemove` | The two boxes that name who changes and who doesn't |
| `MembersNotOnList` | People in the app who aren't on your list, and the "Owner and staff" box |
| `MembersPast` | Past members, two selected |
| `MembersFilter` · `MembersFilterPhone` | The Filter, in the middle on a computer, from the bottom on a phone |
| `MemberPerson` · `MemberPersonPhone` | A member's page: in the app with More open; not invited, asking before the invitation |
| `MemberPast` · `MemberAppOnly` | A past member still in the app; someone in the app who isn't on your list |
| `MembersImport` | Review, with "who has left" marked person by person (5b-iii-b) |
| `MembersPhone` · `MembersPhoneSelected` | The list on a phone; three selected with the bar at the bottom |
| `MembersTrainer` · `MembersEmpty` | What a trainer sees; a new gym with no list yet |

The drawings' words are the words to build. Where a drawing and this section differ, this
section wins and the drawing is corrected in the same job.

### 18.2 The page

- **Title** "Members" ("Clients" for a studio or trainer, `orgWords`), and under it the gym's
  name and the plan meter: "146 of 500 members in the app" (paid places, as the meter counts
  today; amber at 90 %, and "your gym is full, so nobody else can join yet" with **Change
  size** for `billing.manage`, as today). **Import** (outlined) and **Add member** (orange)
  top right; on a phone under the title.
- **Check these** (amber box, only when a line has a number): "1 invitation reached the wrong
  person · See who" (App filter: Wrong email) and "3 people use the app but aren't on your
  list · See who" (Show: Not on your list). 5b-iv adds its "2 people may be on your list
  twice · Review" line here. It replaces today's "Not me" box and the group rows.
- **Search** ("Search by name, email, phone or member number"), **Filter**, and the count on the
  right ("312 members", "118 members match", "40 past members", "3 people").
- **One list.** Rows are the gym's members; each person appears once. Columns: tick box ·
  Name (email, else phone) · Status · Membership · Renews or ends ("Renews 3 Oct", "Ends 30
  Sep", "Ended 31 Aug" once past) · Payment · App · ›. A row opens the person (18.7). On a
  phone each row is a card with the tick box on the left and "Active · Gold · Renews 3 Oct ·
  Paid" as one line. *(23a-i, 2026-10-07: for somebody who holds a membership in the app
  those four say what it says, "Active · Gold Monthly +1 · Renews 6 Nov · Payment due", and
  the Filter reads the same; Payment is one of Payment due · Not due yet · Paid · Free;
  §13.2 has the rule.)*
- **Show** (in the Filter, one choice): **Members** (the list, the default) · **Past members** ·
  **Not on your list** — people in the app with no current member at their details (paid
  places, amber, with the reason and the fix on the row: "Moved to past members on 3 Sep" +
  **Put back on your list**, "Was on an earlier list" or "Not on any list you imported" + **Add
  to your list**, and "Arjun Shah on your list has the same email"). Owner and staff in the app
  who aren't on the list sit below in their own box, "Owner and staff in the app · 1", "They
  use the app free and don't need to be on your list.", tagged **Complimentary**, and are not
  counted as "Not on your list".
- **The "Using the app" tab is gone.** A person in the app who is on the list is their member
  row; one who isn't is under Not on your list. A trainer (no `members.confirm`) sees one list
  of the people in the app (`MembersTrainer`: name, "In the app since", Complimentary), with
  no tick boxes and no list details, as the roster shows them today.
- **A gym with no list yet**: "Your list is empty" / "Import your members from a spreadsheet,
  or add them one at a time." with **Import members** and **Add member**, and below it
  "Already in the app · 3" (today's roster).
- "Waiting to join" (join-code requests) stays above the list, restyled, until 3c switches it
  off. Every state a read-only gym has today stays (18.9).

### 18.3 One name for one thing

| The thing | The word on every screen | Never |
|---|---|---|
| A person on the gym's list | member (client for a studio or trainer) | record, entry, person on your list |
| Someone the gym took off its list | past member · "Past member since 3 Sep 2026" | former, removed from list, taken off |
| Taking someone off | **Move to past members** | Remove from list, Take off the list |
| Bringing them back | **Put back on your list** | Put back, Put back on list, restore |
| Deleting a past member | **Delete for good** | erase |
| One person twice | **Merge duplicate** | join records |
| Using the member app through the gym | **In the app** · "In the app since 12 Aug 2026" | Uses the app, Joined, Using the app |
| Emailing the link | **Invite to app**; the email is an invitation | Send invites, Invite N members |
| Ending someone's app use | **Remove from app** · "Removed from app · 26 Sep" | Remove, Remove all, Invitation stopped |
| In the app, no member at their details | **Not on your list** | unlisted, no longer listed, never listed |
| Adding such a person | **Add to your list** | Put on the list, Add to list |
| Owner or staff in the app free | **Complimentary** | free seat |
| The gym's own extra columns | **Custom fields** | extra fields, own columns |
| The gym's three kinds of word | **Status · Membership · Payment status** | Payment (as a heading) |
| People ticked | "3 selected" · **Select all 312 members** · **Clear** | ticked, chosen |
| The file | **Download CSV** | Export |

"Selected", the banner and the tick box at the top left are Gmail's and HubSpot's own
wording (18.12); "Download" is Glofox's and TeamUp's.

### 18.4 The App word — ONE function, one table test

**AMENDED 2026-09-27, at 5b-v-a-i's click-through** (Kd: *"confusing list with too many
information"*; RULINGS 2026-09-27). The ten rows below are now the REASONS `appReason` finds,
first match wins, exactly as the table says. A screen shows **three words**: **In the app**
(rows 1, 1b) · **Invited** (3 waiting, 8 didn't arrive, 9) · **Not in the app** (1c, 1d, 2, 4,
5, 6, 7, 10), and the reason as the one line under it: a red or amber line (1 two people on one row,
two people, 1b, 2, 3, 8) asks staff to check something and is shown on the list under the
row; every other line only explains ("Invitation sent · 22 Sep", "Removed from app · 26 Sep",
"Left the app", "Declined the invitation", "Unsubscribed from your emails", "Not invited yet",
"No email address", "Under 18", "Maria Park uses the app with this email.") and is shown on
the person's own page only. The Filter's App choices are **In the app · Invited · Not in the
app · Needs checking** (everyone with a red or amber line), and Check these reads "3 members
need checking · See who" (Needs checking). Every product read that day shows about this
much: TeamUp one "Unclaimed" pill, Trainerize a "Pending" folder.

Every member row, the person's page, the Filter's App chips and their counts read ONE pure
function on the server (it decides something about a person, so CLAUDE.md §4's table test,
with cases from real invitation histories, including states the table has never seen, which
must come out as a word and never throw). First match wins:

| # | When | Word (colour) | Second line |
|---|---|---|---|
| 1 | A current member row reaches someone in the app (§9.7's one-row-per-person match) | **In the app** (green) | Two people in the app on one row: "Maria Park and Leo Park use the app with these details." (amber). Names are never compared (AMENDED 2026-09-28). |
| 1b | A past member row whose person is still in the app | **In the app** (amber) | "Grace still uses the app through your gym. Remove them from the app if they've left." |
| 1c | Nobody in the app on this row, but someone in the app with this row's email is matched to another row (a household) | **Not invited** (grey) | "Maria Park uses the app with this email." (the other row's name) |
| 1d | A current row with an email whose date of birth makes them under 18 by the gym's day | **Not invited** (grey) | "Under 18" — whatever the address's invitation says: Invite never reaches them, so it was a parent's or came before the date was corrected |
| 2 | Invitation declined as "Not me" | **Wrong email** (red) | "Whoever gets email at {email} says they aren't {first name}. Check the address with {first name}." |
| 3 | Invitation waiting for a place | **Waiting for a place** (amber) | "{First name} tapped Join, but all {cap} places in your plan are taken." |
| 4 | Invitation stopped with a removed date | **Removed from app · 26 Sep** (grey) | — |
| 5 | Invitation accepted, not in the app now, no removed date | **Left the app** (grey) | — |
| 6 | The person unsubscribed, or marked an invitation as spam | **Unsubscribed** (grey) | spam only: "Marked your invitation as spam." |
| 7 | Declined | **Declined** (grey) | — |
| 8 | Email bounced, failed or refused, or not sent for an address, delivery or gym reason | **Email didn't arrive** (amber) | the reason's sentence (`MEMBER_INVITE_EMAIL_RESULT_WORDS` / `…_REASON_WORDS`), e.g. "The email bounced. Check the address with Emma." |
| 9 | Invitation waiting (queued, sending, sent, delivered, or not known) | **Invited** (grey) | the day, "22 Sep"; not known: "We couldn't confirm this email went. Only send it again if they say they didn't get it." |
| 10 | Never invited, or the invitation was cancelled when they were moved to past members | **Not invited** (grey) | "No email address" · "Under 18" (the list's date of birth, the gym's today) · "Invitation cancelled" |

**Built in 5b-v-a-i (2026-09-27):** `appWord` in `apps/api/src/modules/orgs/memberList/appWord.ts`,
its facts gathered in `appViews.ts`, its table in `memberList.appWord.unit.test.ts` (the
spec's rows, the local databases' real invitation histories, and every combination of
invitation facts the types allow). Two things building it settled. **A household's person is
the row with their own name** (§9.7's match, both `membersAgainstList` and `reconcile`): of
the current rows on a member's proved email or stated phone, the one whose name is the name
they signed up with (the same words in any order) — so when Maria joins on the email she
shares with her son Leo, typed in first, her row reads "In the app" and his reads 1c. Under a
name on neither row (AMENDED 2026-09-28, round one: "Mum", or "Maria") the list can't say
whose she is, and both rows read 1e. **An invitation belongs to an address, not a person**, so 1c and 1d come
before every invitation row: without them the son read "Left the app" or "Invited" from his
mother's invitation. The line's colour is its own (`lineTone`): red for Wrong email, amber
for 1, 1b, 3 and 8's lines (under the whole row), plain for the rest (under the word).

Ten words where there were fourteen tags, each with at most one second line; the "Not sent:"
sentences stay as the second line of #8 and on the person's page. The Filter's App chips are
these words with their counts over the current members (Show: Members) — #1 In the app · #9
Invited · #10 Not invited · #8 · #2 · #3 · #7 · #6 · #4 (and #5 only while it holds anyone).

### 18.5 Selecting, and the action bar

- A tick box on every row (44 px on a phone); the heading's box selects everyone shown. Then
  the line under the bar: "All 100 members on this page are selected. **Select all 312
  members**" (or "… that match" with a filter or search), then "All 312 members are selected.
  **Clear**". A search or filter change clears the selection.
- With one or more selected, the table's heading row becomes the bar: "3 selected" ·
  **Invite to app** (pale orange) · **Remove from app** · **Download CSV** · **Clear**. Past
  members: Remove from app · Download CSV. Not on your list: Remove from app. A trainer has
  no tick boxes. A read-only gym's bar holds Download CSV only. On a phone the bar sits above
  the tabs, three buttons of icon and words.
- **Nothing happens to anyone who was not selected.** A press sends either the selected rows'
  ids (a page at most) or, after "Select all", the filter and search with the count and a
  digest of who they were (as "Remove all" does today); if the set has moved, nothing happens
  and the box shows the new names.
- Today's "Invite 41 members", "Remove N from the app" and the group rows' "Remove N from the
  app" become this bar: the same actions on the people selected.

### 18.6 The boxes

Before anything emails, removes or changes people, a box (middle on a computer, from the
bottom on a phone) names who will change and who won't, a reason a line: a few names, "and N
more", **See all** (the names, 100 at a time).

- **Invite to the app** (`MembersInvite`): "You selected all 312 members." · the big number
  "41 will get an email invitation" and names · "271 won't": Already in the app · Invited before
  · No email address · Under 18 · Unsubscribed · Their address bounces (and the other skip
  reasons the server has, each its own line) · "Each gets one email from Iron House Gym with a
  link to the app." · the tick "These are Iron House Gym's members, and I have permission to email them." (RULINGS 2026-09-27; `MEMBER_INVITE_PERMISSION_WORDS` changes with it) ·
  Cancel · **Send 41 invitations**. After: today's "41 invitations are on the way.", the batches
  line, "Share it yourself too" and Done.
- **Remove from the app** (`MembersRemove`): "You selected 4 members." · "2 will be removed
  from the app" and names · "They stay on your list. They keep their workouts and the free
  app, and the app tells them they're no longer a member of Iron House Gym." · "2 won't": Not
  in the app · Complimentary (owner or staff) · "Another member at their email is still on
  your list" (5b-iii's rule, 18.10) · over the large-change line (more than 10, or 10 % of the
  paid places) the tick "Yes, remove 60 of your 146 members in the app." shown up front ·
  Cancel · **Remove 2 from the app** (red). After: "2 members removed from the app."
- **Download CSV** has no box: it changes nobody, and the bar already says how many. The file is
  named for what it holds, as 5b-iii built ("Cancelled members 2026-09-26.csv"; "Selected
  members …" for rows picked by hand).
- **One person** (their page): **Invite to app** asks "Invite Ava Thompson to the app?" / "One
  email goes to ava.thompson@example.com with a link to the app." / **Send invitation** ·
  Cancel (today it sent at once; Send again and Invite again already asked). **Move to past
  members**: "Move Olivia Bennett to past members?" / "Their details are kept, and you can put
  them back." + "Their invitation stops working." when one is waiting + "They stay in the app
  until you remove them from the app." when in the app / **Move to past members** · Keep as a
  member. **Remove from app**: "Remove Olivia Bennett from the app?" / "They stay on your list.
  They keep their workouts and the free app, and the app tells them they're no longer a member
  of Iron House Gym." / **Remove from app** (red) · Cancel. Send again, Invite again, Delete for
  good keep today's words.

### 18.7 A person's page

A side panel on a computer, the whole screen on a phone (§17.2 rule 9), closed only by its X.
Name, App word (and its line), then the buttons by state:

| The person | Buttons | More |
|---|---|---|
| Not invited, with an email | **Invite to app** (orange) · Edit | Move to past members · Merge duplicate |
| Invited | Edit · **Send again** | Share the invitation · Move to past members · Merge duplicate |
| Removed from app, or invitation cancelled | Edit · **Invite again** | Move to past members · Merge duplicate |
| In the app | **Edit** | Move to past members · Merge duplicate · Remove from app (red, `members.remove`) |
| Past member | **Put back on your list** | Edit · Merge duplicate · Delete for good; still in the app: the amber line with **Remove from app** |
| Not on your list | **Put back on your list** or **Add to your list** · **Remove from app** | — ("Open their details" when a member has the same email) |

Sections: Contact · Membership · Custom fields · App ("In the app since", Visits "14 · last 25
Sep", the invitation's line). "Changed by hand" under a field and the "An import asks before
it writes over these." line stay. The Add member and Edit forms keep every field, hint, date
picker and both buttons (Add member · Add and invite), drawn in the new look. *(23a-ii,
2026-10-07: Add member asks for the membership straight after name, email and phone; the
typed Status, Membership, Payment status and End or renewal date are asked only where the
gym has no price list, and shown under Details and in Edit only for somebody the app holds
no membership for: §13.2.)*

### 18.8 Import: who has left, person by person (5b-iii-b)

Upload and Review keep every step, line, warning, tick and error they have (18.9). The
missing-people card becomes: "4 of your 340 members aren't in this file" / "Mark each one.
Those who have left become past members." · **Select:** the Status words of the missing people
with counts · a list with tick boxes, each row the name, their status and "in the app", and its
mark: **Left**, **Still a member** or **Not marked yet** · with any selected, "1 selected ·
**They've left** · **Still a member**" · the tally "2 left · 1 still a member · 1 not marked
yet". The permission tick reads "These are Iron House Gym's members, and I have permission to store their details." (RULINGS 2026-09-27). Nothing is marked for staff. Import waits until everyone is marked ("Mark Leo Park
first. Nobody is emailed."). Over the large-change line the number of leavers is typed, as
today. The confirm sends who left and who stays, with the digest of the missing set; a set
that moved is refused as `list_changed`, nothing applied.

**Built in 5b-v-d-i (2026-09-28), as Kd ruled at its click-through (RULINGS 2026-09-28, amended 2026-09-29):**
Review keeps the look it had: the number of new members above, then this card with the
names of the people the file leaves out and their details, and its two answers, **They've
left** and **They're still members**. The one addition is a tick beside each name: They've
left moves the people ticked ("Move the 2 ticked to past members"), or everyone when nobody
is ticked, as before; They're still members keeps everyone and opens no box. Import waits for
one of the two answers; a line under the status words says "Tick the people who have left. If
you tick nobody, They've left moves everyone.", and with people ticked They're still members
reads "Keep all 5 on the list, ticked or not". When the wrong-file check asks about They're
still members (app members whose email the file changes), its number is typed on the card.
Each person's details name what each word is ("Status: Cancelled ·
Membership: Gold · Payment: Paid"; the line above: "Status: Active 20 · Frozen 5"), and above
the card Review shows, beside the new members, how many are already on the list, each with
See who (RULINGS 2026-09-29). Import with anyone leaving opens a box first, as
Remove does (18.6): who moves to past members, who loses the app with them, who keeps it and
why, how many stay; the large-change number is typed there. It is Remove's own rule on the
records marked Left, worked out before the file is applied, with one exception that ends
nobody's app by mistake: someone in the app whose email or phone the file itself writes to (a
record added or brought back there, or one whose name, email or phone changes) keeps the app,
named "Keep the app for now: someone in this file has the same email or phone", because once
the file is in, a different record may be theirs. The press carries the box's digest; a box
that moved is refused as `leavers_changed` with the new box, nothing applied.

**5b-v-d-ii (RULINGS 2026-09-29):** people added in this app (by hand, or from the app) whom no
file has held yet are counted apart beside the new members ("1 added manually, not in this
file", See who); each is ticked to stay, with Untick all, and anyone unticked moves to past
members through the same box. The card, its number and status line, and They've left are about
the file's own people only, and the card is not shown when only people added here are missing.
An import makes every record it holds the file's (`source` becomes `upload`).

### 18.9 Every feature kept

| Today | In the redesign |
|---|---|
| "Your list" and "Using the app" tabs | One list; Show: Members · Past members · Not on your list; a trainer's list (18.2) |
| 14 row tags, 79 standing phrases | 10 App words, one second line each (18.4); every "Not sent:" and "didn't arrive" sentence kept as a line |
| "Not me" box | "Check these" line → App: Wrong email |
| Group rows "N using the app … Remove N from the app" | "Check these" line → Not on your list; select → Remove from app |
| Roster row: Joined date, "On your list as", Complimentary, Remove, Put back on list, Add to list (Check this is them: gone 2026-09-28, names are never compared) | Member row ("In the app"); a person's page names who uses the app with it, with Not {name}?; Not on your list rows and page; Owner and staff box; Remove from app in the bar and on the page |
| Search, Filter (Status, Membership, Payment, App, Past members), Showing pills, Clear, counts | Kept; App gains the ten words; Show gains Not on your list |
| Invite N members (by words) + its box, tick, sent screen, share text | The bar's Invite to app on selected people, the same box with names |
| Remove N from the app (by words) + its box and large-change tick | The bar's Remove from app, the same box with names |
| Download CSV on the total line | The bar's Download CSV |
| Seat meter, Change size, read-only note, "Waiting to join" queue | Kept, restyled (the queue until 3c) |
| Person page: Edit, Invite, Send again, Invite again, Share the invitation, Remove from list, Put back on list, Merge duplicate (find, compare, Swap, Merge), Delete for good, Go ahead anyway, Open that record, every notice and refusal | Kept (18.7), renamed per 18.3; Invite now asks first; Remove from app added to the page |
| Add member form: every field, hints, date pickers, Ends or renews, custom fields, Add and invite | Kept, restyled |
| Import: Upload/Paste, Review tiles and names, columns panel, dates Swap, never-kept lines, warnings, hand-edit tick, permission tick, typed number, Done, every error | Kept, restyled; the missing-people question per person (18.8) |
| Empty list, loading and failure cards, Load more everywhere | Kept, restyled |

### 18.10 The four build jobs, each Opus xhigh with its review round

| Job | What a gym sees | The server | The worst thing, the first test |
|---|---|---|---|
| **5b-v-a · The one list** | The page in the new look: one list, the ten App words, Check these, Show (Members · Past members · Not on your list, Owner and staff), the Filter, a trainer's list, the empty list. Today's Invite N, Remove N, group Remove and Download stay as they are, restyled, until 5b-v-b | The App word function (18.4) with its table test; the App filter and its counts; the matched person's signed-up name on a member row; Not on your list and Owner and staff from the roster's own facts, paged; 5b-iii's stopped invitation with `removedAt` for every removal, taken from the paused branch | A member row showing someone else's app state — the son's row "In the app" when only his mother joined on that email — or a false word, so staff remove or chase the wrong person |
| **5b-v-b · Select and act** | Tick boxes, Select all 312, the bar, the Invite and Remove boxes with names, Download CSV of the selected | Invite, Remove from app and the file take `{entryIds}` (a page at most) or `{filter, query, expectedCount, digest, version}`; their previews return names by reason, paged; 5b-iii's remove rule and export taken from the paused branch; the old by-words buttons go into the bar | Someone emailed or removed who was not selected — a select-all whose set moved, an Active mother removed with her Cancelled son, the owner removed |
| **5b-v-c · A person's page** | 18.7 and 18.6's one-person boxes in the new look; Invite asks first; Remove from app on the page; the page for someone not on your list; Add member and Edit restyled | None new beyond calling existing routes (the roster's Remove, the list's writes) | An answer for one person landing on another's page, or a button acting on the person opened before — two people opened one after the other, the first answering late |
| **5b-v-d · Import, who has left** | 18.8 in the new look | The confirm takes the marks per person with the missing set's digest | Someone never marked "Left" becoming a past member, or someone marked "Left" staying |

**5b-v-a is two pull requests** (split 2026-09-27: the first half alone adds 2,165 lines):
**5b-v-a-i** the page in the new look, the App word, Check these ("reached the wrong person"),
the Filter with Show (Members · Past members) and the App words, the empty list — the "Using
the app" tab kept, restyled; **5b-v-a-ii** the ONE Remove (RULINGS 2026-09-27: removing a
member makes them a past member and ends their app, one step; Put back undoes both; the tabs
become **Members · Past members**), Show: Not on your list with Owner and staff, Check
these' second line, a trainer's list, and the "Using the app" tab folded in. The worst thing
is the same for both.

Each merges before the next starts, then 5b-iv (possible duplicates) and 5c. PR #121 (5b-iii,
a draft) stays open until 5b-v-b has taken its last server part, then is closed unmerged.

### 18.11 Cost at full size

Each job measures, with a command, how long the server answers nobody at 10,000 members and
2,000 in the app (the cap) and at 20 gyms of 200 (§4 "Cost at full size"): 5b-v-a one page of
names with the App word and the Filter's counts; 5b-v-b a preview and a press of "Select all"
at the cap; 5b-v-d a confirm with 1,000 marks.

### 18.12 Where the facts came from (read 2026-09-26, the vendors' own help pages)

Gmail: "All 50 conversations on this page are selected. Select all 2,000 conversations in
Inbox." (support.google.com/mail/answer/7401). HubSpot: "select the checkbox at the top left of
the table … click the Select all [number] [records] link" and "At the top of the table, select
from the following actions" (knowledge.hubspot.com/records/bulk-edit-records); delete asks to
"enter the number of records". Wodify: "Click the uppermost checkbox … a clickable link to
Select All Items will appear". Gymdesk: "Check all" and an "Actions" button (Change status,
Delete, Compose Email, Send Text); "export it as a PDF or CSV file". Glofox: "Actions" →
"Download" a CSV. TeamUp: an "Unclaimed" marker on each customer not yet in the app, a
"claimed or unclaimed" filter, "Resend Invite Email". PushPress: "Ex-Member", "Blocked?" to
end app access, "Contacts with an unsubscribe status will automatically be excluded from the
send". Zen Planner: "Alumni". None of these confirmation boxes lists names; this app does,
because CLAUDE.md §4 asks it to. None offers "who has left" on an import; this app does,
because RULINGS 2026-09-17 and 2026-09-26 ask it to.

### 18.13 Staff notes and tags (5d; RULINGS 2026-10-08)

On a person's page, under Memberships: **Tags**, then **Notes**. Built in two jobs: 5d-i is
the person's page; 5d-ii is tags as a filter on Members, tagging everybody ticked, and
renaming or deleting one of the gym's tags.

- **A note** is up to 2,000 characters, kept with who wrote it and when, shown newest
  first. It is deleted (the box asks first), never edited, as PushPress's staff notes are.
  Staff add up to 200 to a person. A note that looks like it holds a payment card number
  is refused in a sentence (§11's never-keep list), read with every script's digits as
  plain ones, every run of spaces and marks between two digits as one space (a new line,
  " - ", ":", "|", "*", and "+" unless it starts a phone number), digits typed one at a
  time put together, and characters nobody can see both dropped and as a space; the note
  of a writer whose account is gone reads "Someone no longer here". Its day is the gym's
  own day. A note with nothing in it a person can see is refused as empty; the joiners
  Hindi and Persian words are written with are kept.
- **A page of notes.** A reply carries the newest 200 notes and `notesTotal`, every note
  the person has. When there are more, the box says "Showing the newest 200 of 400 notes."
  with **Show older notes**, which brings the next 200
  (`GET …/entries/:entryId/notes/older?before=` the oldest note shown; `more` says whether
  older ones are left). So no reply grows with what joins leave on a person.
- **A tag** is the gym's own word, up to 30 characters, one name once in a gym whatever its
  capitals. Add tag offers the gym's other tags to pick, then a box for a new one. A person
  is given 20 at most and a gym has 100. Taking a tag off a person asks first and leaves
  it among the gym's. A tag that looks like a card number is refused as a note is. So
  that two tags never look the same, a name is kept in its plain form (full-width letters
  become ordinary ones) with everything nobody can see dropped: joiners and direction
  marks, the soft hyphen, variation selectors, and the letters and the braille cell drawn
  as a blank; a name with nothing left, or only an accent, is refused. (A Hindi tag typed
  with a joiner is kept without it, and a family emoji as its separate faces.) A tag PICKED on a person's page is sent
  by its id, so one a colleague has renamed is still that tag and one a colleague has
  deleted is "not there any more", never made again; only a typed name can make a tag.
- **Who.** Read by the gym's staff who may open the person's page (`members.confirm`);
  written by the same staff while the gym has a plan. A trainer without that tick, a
  member, another gym and nobody signed in get nothing. A past member's notes and tags are
  kept and can still be added to.
- **Never sent out.** Notes and tags are in no reply but their own
  (`GET …/member-list/entries/:entryId/notes`), so not in the person's page read, the
  list, the CSV download, an email, or the member's app; the audit log keeps that a note
  was added or deleted and by whom, never its words. Under the Notes box: "Only your staff
  see notes. Keep health details to what staff need to know." A file's medical notes are
  still never kept (§11).
- **Their own allowance.** Notes and tags are 1,200 writes an hour a person (4,800 an
  address), apart from the allowance for adding and changing members, so a gym tagging its
  200 people is not stopped and does not stop its other work. The address is counted a gym
  at a time (whatever capitals its id is typed in), so one gym's staff never use up another
  gym's at a shared address.
- **With the record.** Joining two records moves both people's notes and tags to the kept
  one (a tag both had is one tag), so a joined record can hold more than 200 notes and 20
  tags; it then takes no more until some are removed, and the sentence says "200 notes or
  more". A record deleted for good takes its notes and its tags
  with it; the gym's tags stay. A gym's deletion removes them all. A press's key guards
  that press until its note is deleted: the same request arriving again after the delete
  saves the note again.
- **Tables** (`0083`): `gym_member_notes`, `gym_member_tags`, `gym_member_entry_tags`,
  each with its gym.
- **A person left with 10,000 notes by joins**, measured (the same tool, 2026-10-09, 20
  runs; the machine was slower that hour, a usual page 13 ms): the page sent is 421 kB;
  one read 29 ms, the thread busy 11 ms; twenty staff reading it at the same moment 180 ms
  in all, longest stall 18 ms; the next page back 31 ms; another person's usual page asked
  for while ten read that page waited 96 ms (worst 161 ms). Before the page had a size, the
  security pass measured that wait at 4.3 s.
- **Cost at full size**, measured (`tools/measure-member-notes-cost.ts`, 20 gyms of 200,
  on mains at 2,592 MHz, 20 runs): a usual page (5 notes, 3 tags) 6 ms, the thread busy
  2 ms; the fullest page staff can fill without a join (199 notes of 2,000 characters, 19 tags) 9 ms, the
  thread busy 3 ms; a hundred staff reading the fullest page at the same moment 598 ms in
  all, longest stall 19 ms; saving then deleting the longest note there 116 ms for the two,
  the thread busy 13 ms; a tag put on and taken off 126 ms for the two, the thread busy
  14 ms.
- **On the Members list (5d-ii).** Read and changed by the same staff as above.
  - *A filter.* The Filter box has a **Tag** group: the gym's tags somebody in the view
    holds, each with its count (members, or past members when those are shown); one tag at
    a time, together with the other filters and the search. "Showing:" has a pill, "Tag:
    VIP". A list row, the CSV download and Invite still carry no tag: a CSV of the people a
    tag shows is named "Selected members", never "All members" and never the tag's word. The
    toolbar's Invite, with nobody ticked, still reaches everyone the gym's own words choose
    (§18.5): it does not follow the tag, as it does not follow the search or the App words;
    the bar's Invite, after ticking, reaches the people ticked.
  - *The people selected.* The action bar has **Tags**. Its box asks "Add a tag" or "Take a
    tag off", then which (one of the gym's, or a new name), and then names who will get it
    or lose it and who won't change, with the reason: already have it · don't have it ·
    already hold 20 · no longer on the list (counted, never named). Only its button changes
    anybody, and only people who were selected; the answer says how many changed. A record
    of another gym among the ids is "no longer on the list". A "Select all" that has moved
    changes nobody (`selection_changed`). The box carries the first 100 names of each group
    and counts the rest in one line ("and 9,995 more" under the five shown). A new tag is made only when somebody gets it:
    with nobody to give it to, the press is refused in a sentence (`tag_for_nobody`).
  - *Manage tags*, from the Filter box: each tag with who holds it ("On 12 members and 2
    past members"), **Rename** (everybody who holds it keeps it; a name another tag has, in
    any capitals, is refused) and **Delete**, which first names the people it comes off and
    says they stay on the list. The press says how many people the box named
    (`DELETE …/tags/:tagId?people=`); with the gym held, a tag that is now on more or fewer
    is not deleted (409 `tag_people_changed`, with the gym's tags as they stand), and the
    box names the people again before another press. A deleted tag stops being the list's
    filter; a renamed one keeps filtering under its new name.
  - *Routes*: `GET …/member-list/tags` · `GET …/member-list/entries?tag=` ·
    `POST …/member-list/selected/tags-preview` and `…/selected/tags` · `PATCH` and
    `DELETE …/member-list/tags/:tagId`. Writes need a plan and count against the notes
    and tags allowance, one a press. The audit log keeps a tag's id and how many people,
    never its name.
  - *Cost at full size*, measured (`tools/measure-member-tags-cost.ts`, on mains at
    2,592 MHz). **20 gyms of 200**, 99 tags a gym, 20 runs: the gym's tags with their counts
    23 ms, the thread busy 5 ms (a hundred staff at the same moment 160 ms in all, longest
    stall 13 ms); a page of the list shown by a tag 61 ms, the thread busy 13 ms (with no
    tag asked 52 ms, 12 ms); Select all 200 and the box 78 ms, the thread busy 13 ms; a tag
    on all 200 then off all 200, 356 ms for the two, the thread busy 41 ms; a rename there
    and back 170 ms, the thread busy 14 ms; a new tag made on all 200 then deleted 371 ms
    for the two, the thread busy 31 ms. **One gym of 10,000**, the most a list can hold, 5
    runs: the tags with their counts 117 ms, the thread busy 2 ms; a page of the list shown
    by a tag all 10,000 hold 186 ms, the thread busy 47 ms (with no tag asked 88 ms, 11 ms),
    and a hundred staff of that one gym reading it at the same moment keep the thread busy
    3.5 s in all, longest stall 193 ms; Select all 10,000 and the box 495 ms, the thread
    busy 147 ms; a tag on all 10,000 then off, 2.9 s for the two with the gym's row held,
    the thread busy 290 ms; a new tag made on all 10,000 then deleted 1.2 s, the thread
    busy 100 ms.
  - *Just after a big upload or a big press* Postgres's own counts of the tables are up to
    a minute old, and a statement that joined the tags to the list then took about a
    minute on 10,000 people (measured: the counts 62 s, the people selected 38 s). So each
    read here asks one table, the list's tag filter is given the records' ids as its other
    filters are, and a press that tags 1,000 people or more first has Postgres count the
    list again if it has moved, before the gym is held (`analyseEntriesIfMoved`, the
    worker's own step). Measured in that state on 10,000: the counts 0.1 to 0.2 s, the
    people selected 0.1 to 0.2 s, the count and the write together 1.3 and 4.0 s where the
    write alone was 11 s.
- **Read first** (2026-10-08, the vendors' own help pages): PushPress, "Staff App: Member
  Notes" (each note shows the staff member and the date; editing is not possible; Delete
  from the three dots). Gymdesk, "Tag management" (tags are "visible only to managers and
  staff"; added on a profile by picking one or making a new one; managed on one screen that
  counts each tag's people).


Database DDL & Mongo→PG migration** (now carrying: §2.1 columns, Part 2B's
`calc_version`/dishware/corrections tables, Part 2's definition tables,
and the two catalog decisions — Mountain Pose & Brisk Walking) · Part 5 —
Billing & webhooks (+ Micro-tier pricing ratification) · Part 6 — Mobile ·
Part 7 — Retention playbook · Part 8 — Ops runbook.*
