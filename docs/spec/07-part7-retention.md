<!--
Part 7 — Retention & Growth Playbook
Extracted from aihomegym.pdf (pdftotext). Hard line-wraps and occasional
table/DDL wrapping are extraction artifacts, not content changes. When an
exact value (price, threshold, SQL) looks garbled, verify against the PDF.
This file is spec — BINDING. Do not modify; record deviations in DECISIONS.md.
-->

# Part 7 — Retention & Growth Playbook: Full Specification

**Prerequisites:** Architecture v1 §21 (the ranked feature set — this
document is its mechanics) · Part 2 (message keys, F-families, committed
scores) · Part 2B (display standard, recommender progression/recovery
terms) · Part 3 (boards/TV/poster/at-risk — built there, referenced here)
· Part 4 (streaks/achievements/challenges DDL) · Part 5 (entitlements,
`share_watermark`) · Part 6 (push channels, deep links,
offline-provisional reconciliation).
**Scope:** exact mechanics, triggers, and copy (EN message-key seeds;
HI/AS are translation passes) for Form Score™, streak freezes, challenges
& the City League, share cards & referral, programs, PR/badges, the weekly
recap & resurrection ladder, localization/voice, the QoL trio — plus the
global notification budget, per-feature kill criteria, and DDL addendum B.

## 0. Doctrine (four rules every mechanic below obeys)

1. **Honest numbers retain; fake ones churn** — the Trust Layer applies to
gamification too. Deltas display only when both sides are real (§2.2);
calorie totals in recaps are ranges (2B §2.3); streaks are server-truth
(Part 6 §4.5).
2. **Notification restraint is a retention feature.** One engagement push
per user per day, hard cap, server-enforced (v1 §15) — every send in this
playbook fits inside that budget (§13) or doesn't ship.
3. **No dark patterns — enumerated, not implied.** Banned: purchasable
streak freezes (monetizing anxiety), paywalls on the streak-loss screen
(kicking someone who's down), fake urgency ("only 2 spots!"), guilt copy,
opt-out-hostile emails. The cancel flow already set this bar (Part 5 §9);
growth features don't get an exemption.
4. **Every mechanic ships with a metric and a kill criterion** (§14). A
retention feature that doesn't move retention is UI debt.

**The loop these features assemble:** workout → *visible* progress (Form
Score) → identity (streak, mastery, badges) → social proof (boards,
challenges) → share (cards → referral → growth) → return trigger (recap,
freeze save, program day). Each section below is one arc of that loop.

## 1. What each feature is for (metric map)

| Feature | Primary metric | Guardrail |
|---|---|---|

| Form Score™ §2 | W1→W4 retention (progress visibility) | score inflation
(distribution drift alarm) |
| Streaks + freezes §3 | DAU/WAU ratio, D7 | churn spike after streak loss
|
| Challenges / League §4 | WAU, org adoption % | gaming flags (v1 §14) |
| Share cards + referral §5 | K-factor, activated referees | fake-account
rate |
| Programs §6 | D30/D60 (the finish-line effect) | abandonment week ≥ 2 |
| PR + badges §7 | session frequency | notification fatigue |
| Recap + resurrection §8 | resurrection rate, recap CTR | unsubscribe
rate |

---

## 2. Form Score™ (the proprietary metric — feature #1)

### 2.1 Definition (no new math — packaging of what the engine already
commits)

- **Set score:** `SetSummary.avgFormScore` (Part 2 §3.8, committed rep
scores only — live frame-quality never persists, so the score can't be
gamed by posing between reps).
- **Weekly Form Score:** mean of set scores in the user's week (user TZ),
**integer**, shown only at ≥ 5 scored sets that week (Part 3 §3.2's gate,
reused); otherwise "—" with copy `form.week.notyet`: *"A few more sets and
your weekly Form Score appears."*
- **Per-exercise mastery states** (unifies with 2B §4.2's progression term
— one ladder everywhere): `Learning` (< 10 scored sets lifetime) →
`Developing` (avg < 70) → `Solid` (70–84) → `Mastered` (avg ≥ 85 over the
last 3 sessions of that exercise). Mastered is exactly the recommender's
promote-trigger, so the library badge, the "ready to progress" chip, and
the program auto-swap prompt (§6.4) can never disagree.

### 2.2 Display rules (Trust doctrine applied)

Weekly delta (`84 → 88`) renders only when **both** weeks pass the 5-set
gate; a partial week shows the current number alone — a delta against
noise is a lie with an arrow on it. Method sheet `form.score.how` (2B §6
table row, one paragraph): scored per rep from your joint angles against
the exercise's standards, on your device. Surfaces: Home hero card ·

exercise detail (mastery ring) · recap (§8) · share cards (§5) · org
member drawer & boards (Part 3 — min-set gates already aligned) · TV mode.

### 2.3 Integrity & the ™

Global boards show verified users only (v1 §14 — unchanged); org boards
are socially self-policing. Distribution telemetry per definition (Part 2
§9.4) doubles as the inflation alarm: a threshold tweak that shifts the
population +10 shows up before users feel "everyone's a 95 now." On the ™:
use it as branding freely; **registered** protection is a trademark filing
— one conversation with an IP attorney when revenue justifies it, noted
and parked.

---

## 3. Streaks & freeze tokens (feature #2)

### 3.1 What keeps a streak alive

≥ 1 synced **workout, run, or F12 mobility session** in a calendar day,
user's timezone (`users.timezone`, captured from the device at login —
Part 4 left it nullable for exactly this). F12 counting is deliberate:
stretch days are streak-safe rest days, which makes the streak compatible
with recovery instead of at war with it (v1 §21 #14's "guilt-free"
mechanic, delivered through content rather than exceptions).

### 3.2 Freeze tokens (earn-only — Doctrine 3)

Earn **1 per 7 consecutive active days**, bank cap **3** (Part 4
`freezes_available`). On the first missed day the server **auto-spends**

                                       ❄️
one at the day-close sweep — the user wakes to a saved streak, not to a
decision: push `streak.freeze.used` — *"     Streak freeze used — your
12-day streak is safe. 2 left."* Earning: quiet in-app moment +
`streak.freeze.earned` toast — *"You earned a streak freeze. Banked for a
busy day."* Never purchasable, never gifted by support as a habit (one
goodwill exception per user per year, admin-tooled, so kindness exists but
can't be farmed).

### 3.3 The loss moment (where most apps churn people)

No freeze left → streak resets. Copy `streak.lost` is compassionate and
forward-looking: *"14 days was real — nobody can take that. Day 1 starts
whenever you do."* `longest` is displayed forever next to `current` (the
achievement survives the reset). **Banned on this screen:** any paywall,
any freeze upsell (Doctrine 3). Measured option, not built: monthly
"streak repair" — ships only if §14 shows streak-loss-week churn > 1.5×
baseline.

### 3.4 The about-to-break nudge (the one push this feature gets)

19:00 user TZ, only if `current ≥ 3` and no qualifying activity today and
no freeze available to make it moot — wait, freezes make it *low-stakes*,
so: send regardless of freeze balance but let copy reflect it. With
freeze: *"No workout yet today — your freeze has you covered, but a
10-minute stretch keeps it clean."* Without: *"Your 8-day streak ends at
midnight. Even a short session counts."* Class: engagement (fits the 1/day
budget, §13); auto-suppressed if the app was opened after 17:00 (they
know).

### 3.5 Mechanics & edges

Server-authoritative at sync (Part 6 §4.5): the day-close sweep (per-TZ
batches, same worker pattern as Part 4 §4.3) evaluates yesterday → keep /
auto-freeze / reset, then earn-check. Client shows provisional state
instantly; server reconciliation only ever *improves* it (offline workouts
arriving late can restore a "lost" streak retroactively at sync — the
sweep re-runs affected days idempotently). Timezone travel: a day is kept
if it qualifies in **either** the stored-at-the-time TZ or the new one —
travel can never eat a streak. Milestones 7 / 30 / 100 / 365 → badge (§7)
+ share-card prompt (§5).
---

## 4. Challenges & the City League (feature #4)

### 4.1 Challenge templates (config, not code — Part 4
`challenges.template_code` + `config`)

| Template | Scope | Win condition (computed from SetSummaries) | Notes |
|---|---|---|---|

| `squat30` "30-Day Squat Challenge" | user | daily rep ladder (day N
target in config), 25/30 days | the classic; T1-only variant for free tier
|
| `consistency20` | user | ≥ 20 active days in 30 | pairs with streaks,
forgiving |
| `formfocus` | user | avg Form Score ≥ 80 on chosen exercise, ≥ 12 sets |
mastery on-ramp |
| `org_reps` "Gym Total" | org | sum of member reps in month, target from
config | the notice-board number |
| `org_active` "Adoption Sprint" | org | ≥ X % members active this month |
secretly an owner-retention feature |
| `league_city` | league | §4.3 | gated |

Join: one tap from Home/console → `challenge_participants`; progress:
Redis increments at sync + nightly true-up worker (same dual pattern as
org counters, Part 3 §3.2); completion → badge + share card +
`challenge.done` push (celebration class). Copy seeds: `challenge.joined`
*"You're in. Day 1 starts now."* · `challenge.behind` (day 10+, < 60 %
pace, max once per challenge): *"You're 40 squats behind pace — one solid
session catches you up."*

### 4.2 Org challenges (console Slice B/C)

Owner creates from templates (Part 3 §2.3 gating: clinics off), appears on
member Home + TV mode; progress bar is the lobby-screen centerpiece for
the month. No prizes handled by us — the gym supplies its own (a shaker
bottle moves mountains); we supply the scoreboard.

### 4.3 The City League (B2B growth infrastructure — **gate: ≥ 5 paying
orgs in one city**, same discipline as the clinic gate)

Season = calendar month · entry = console opt-in, free · **score = avg
workouts per participating member** (min 10 participants to qualify) —
per-capita by design so a 60-member Jorhat gym can beat a 300-member
Guwahati one; total-volume boards would just rank size. Standings on TV
mode + console + a public city page (org names only, no member data —
§Part 3 §2.4 boundary applies to leagues too). Winner: digital trophy on
their TV mode for the next month + a print-ready *"Jorhat's Most Active
Gym — July 2026"* poster asset. Why it exists: owners recruit **each
other** (a league needs opponents) — the only B2B feature that markets

itself. Anti-gaming: verified summaries only; a gym spiking on flagged
accounts (v1 §14) is quietly excluded from standings with a private note
to you, never a public shaming.

---

## 5. Share cards & referral (feature #5 — the growth loop)

### 5.1 Card generator

Server-side worker renders PNG (1080×1920 story + 1080×1080 square) from
templates: **workout summary** (exercises, reps, Form Score, streak) ·
**PR card** · **streak milestone** · **challenge complete** · **program
certificate** (§6.5) · **run card** (map thumb, 200 m end-trim per Part 6
§5.4). Org members' cards carry the org logo (Part 3 branding — the gym
markets itself every time a member shares; owners will notice). Free tier:
small wordmark + referral QR (`entitlements.share_watermark` — the
watermark *is* the growth mechanic); Pro: clean, QR optional. Locale-aware
text. Flow: post-workout "Share" → `POST /v1/share-cards {type,
entity_id}` → R2 `share-cards/` (7-day lifecycle, v1 §7.3) → signed URL →
native share sheet, WhatsApp first-class. Rate: 20/day (Redis, quota
module).

### 5.2 Referral program (give-a-month / get-a-month)

- Every user gets `users.referral_code` (7-char, ambiguity-free); link
`https://<domain>/r/{code}` + the same code typed manually on mobile
signup (install-referrer attribution where available, manual entry as the
reliable path — first-touch wins, 30-day window).
- **Reward trigger = referee activation, not signup:** referee completes
**3 workouts within 14 days** → both sides receive **+30 days Pro
credit**. Signup-triggered rewards farm fake accounts;
activation-triggered rewards farm *users*.
- **Credits mechanics (DDL addendum B):** `entitlement_credits(user_id,
plan_id→pro, days, source, expires_unused_at)`; the Part 4 §4.1 resolver
gains a third UNION arm (rank-10 candidate while a credit window is open).
Credits **bank while a paid sub is active** and start counting only when
no paid plan grants — a paying referrer's credit extends their coverage
after cancellation rather than fighting the provider's billing period (no

proration surgery, no Part 5 state-machine exceptions). Bank cap: 180
days/rolling year per referrer.
- Anti-abuse: referee must be a new account · self-referral blocked
(email/device heuristics) · device-fingerprint soft-flag → admin queue
past 3 same-device referrals · no payment method required (activation gate
is the fraud filter) · all grants in `audit_log`.
- Copy: `referral.cta` *"Give a month of Pro, get a month of Pro — when
your friend does their first 3 workouts."* (the condition stated up front
— Trust doctrine, applied to marketing).
- **Org-to-org referral:** owner refers owner → 1 month free appended at
the referred org's first paid renewal + the referrer's next renewal. Year
one: fulfilled manually via admin credit-note (volume will be tens, not
thousands); automated only when that stops being true.

---

## 6. Programs (feature #6 — the retention backbone)

### 6.1 Model (DDL addendum B)

`programs(id, code, name_key, level, goal, weeks jsonb, status)` — `weeks`
= ordered sessions of `{day, exercise_slug, target_sets,
target_reps|hold_s, optional}` · `program_enrollments(user_id, program_id,
started_at, schedule text[], current_day, completed_at, abandoned_at)` —
one active enrollment per user (partial unique, same trick as
subscriptions).

### 6.2 Launch content (authored like definitions: message keys,
versioned, no code)

**Foundations** (4 wk, 3×/wk, pure T1 — the free-tier program,
`entitlements.programs='starter'`) · **Home Strength** (6 wk, 4×/wk,
T1+T2) · **Mobility Reset** (3 wk, daily 15-min F12/F10 — the streak-safe
program, and the clinic segment's natural demo). Pro unlocks all; more
programs are content drops via config, zero deploys — the EDS philosophy,
third application.

### 6.3 Session matching (deliberately fuzzy)

A workout counts toward today's prescribed session when ≥ 60 % of
prescribed exercises appear in it. Exact-match adherence punishes
substitutions and equipment reality; 60 % rewards showing up. This same
number is Part 3 §6.1's **On-plan %** for studios/clinics — consumer
feature and B2B feature are one mechanism.

### 6.4 Progression & schedule mercy

When an exercise hits **Mastered** (§2.1), the next prescribed instance
offers the harder family variant — **prompted, never silent**
(`program.progress.offer`: *"Your squats have been ≥ 85 for three
sessions. Swap in jump squats for week 3?"*). Missed days shift forward (a
program is a sequence, not a calendar); 14 days inactive → `abandoned_at`
+ a no-guilt resume path (*"Week 2, day 1 is right where you left it."*).

### 6.5 Completion

Certificate share card + badge + the recommender's next-program suggestion
(2B §4.2 surfaces it with its "why" chip). Completion rate per program is
the §14 metric; a program with < 15 % completion gets redesigned, not
promoted.

---

## 7. PR celebrations & badges (feature #7)

**PRs** (`user_prs`, addendum B): per exercise — most reps in a set · best
Form Score (≥ 8-rep sets only, quality gate) · longest hold (F10/F12) ·
plus run bests (5k/10k time, longest run). Detected client-side against
the local cache for the **instant confetti** (from `RepEvent`, zero
latency), confirmed server-side at sync (authoritative; multi-device
disagreements reconcile quietly — Part 6 §4.5 pattern). In-app celebration
suppresses the push (no double dopamine, §13).
**Badges:** ~24 at launch — `badges.py` port + streak 7/30/100/365, first
workout, first sync-after-offline ("Basement Session"), 1k/10k lifetime
reps, all-T1-tried ("Full Body Explorer"), Form 90 Club (ten 90+ sets),
program completions, referral activated, challenge winner. **Positive-only
catalog** — no shame badges, no "comeback from being lazy" framing; the
catalog is seed data (Part 4 `achievements`), additions are content.

## 8. The weekly recap & resurrection ladder (feature #8)

**Recap:** Sundays 18:00 user TZ (per-TZ worker batches, the Part 4 §4.3
pattern) · push + email, one engagement-class send (§13) · contents,
display-standard compliant: workouts vs last week · Form Score delta (§2.2
gates) · streak + freezes banked · top exercise · kcal as a **banded
weekly range** (2B §2.3 total-then-band rule) · one highlight
(PR/badge/challenge) · one honest nudge from the recommender's recovery
data (2B §4.2: *"Legs untouched for 9 days — recovered and ready"*) · CTA
= program day or recommended workout. Skip rule: 2 consecutive
zero-activity weeks → recap pauses, resurrection ladder takes over.

                         ❄️
**Resurrection ladder (lapsed = 0 activity):** D3 push *"Your streak
freeze is still banked        "* → D7 email (their own stats: *"Your best week
was 5 workouts. It's still in you."*) → D14 what's-new + win-back → D30
monthly digest cadence → **D90 full stop** (respect is a retention
strategy too). Every rung: one-tap per-channel unsubscribe, honored
instantly, tracked as the §14 guardrail.

## 9–12. Supporting cast (specced brief because the machinery already
exists)

**§9 Localization (#10):** all copy above ships as message keys (Part 2
App A conventions); HI/AS = native-speaker passes before T1 pilots (Part 2
DoD, unchanged). **Voice in Assamese:** Android TTS coverage for `as` is
unreliable → the ~30 workout cues are **pre-recorded audio files** (one
afternoon with a native speaker, ~1 MB bundled); EN/HI use device TTS. A
form-checking app that *speaks Assamese* in a Jorhat gym demo is the
moment the trainer smiles — cheap, decisive.
**§10 Voice coach (#11):** cue policy is already law (Part 2 §4.9 — one
cue/rep, 4 s gap, ≤ 2 repeats, positive reinforcement on fixes); mobile
playback via expo-speech/bundled audio with music ducking; persistent mute
toggle.
**§11 Trainer mode (#12):** stays gated — **≥ 5 paying orgs asking** (the
clinic-gate discipline). When it opens: assignment = §6 programs + Part 3
§6.1 On-plan (already built by then); live-view = the WebSocket that
finally earns its way back (v1 §21). One paragraph on purpose; speccing it
now would be speculation wearing a roadmap.
**§12 QoL trio (#14):** rest timer (auto-starts post-set; default 60 s /
90 s for F1–F3 heavies; editable; local notification if backgrounded) ·
plate calculator (offline barbell math, kg-first with lb toggle) · workout

note (`workouts.note`, addendum B — private, **org-invisible**, the §Part
3 §2.4 boundary extended by default to anything new; that's now the
standing rule for every future field).

## 13. The global notification budget (every push in this playbook, one
table)

| Push | Class | Trigger | Cap |
|---|---|---|---|
| Streak nudge §3.4 | engagement | 19:00, streak ≥ 3, no activity | the
1/day slot |
| Recap §8 | engagement | Sun 18:00 | weekly (owns Sunday's slot) |
| Freeze used §3.2 | transactional-lite | morning after | 1/event |
| PR / badge / challenge-done | celebration | on event, suppressed if seen
in-app | 2/week combined |
| Challenge behind-pace §4.1 | engagement | once per challenge |
1/challenge |
| Resurrection rungs §8 | resurrection | D3/D7/D14/D30 | ladder only, then
stop |
| Org "we miss you" (Part 3) | org | owner-initiated | 1/member/7d
(already set) |

Server-side arbitration (v1 §15): engagement class shares one daily slot —
if two qualify, priority = streak > recap > challenge; losers drop
silently (never queue-and-flood tomorrow). Quiet hours 21:30–08:00 user
TZ. In-app-seen suppression everywhere.

## 14. Measurement & kill criteria (the monthly 30-minute retention
review)

Per feature: adoption %, target metric (§1), guardrail, and a
pre-committed action — e.g., streaks: if streak-loss-week churn > 1.5×
baseline → build repair (§3.3); recap: unsubscribe > 3 %/month → halve
frequency; referral: fake-flag > 10 % of grants → tighten activation gate
to 5 workouts; programs: < 15 % completion → redesign. A/B where volume
allows via `feature_flags` + PostHog cohorts; below A/B volume,
before/after cohorts with honesty about noise (the Trust doctrine applies
to *your* dashboards too). The ritual: first Monday monthly, 30 minutes,
D7/D30 curves by signup cohort + this table — decisions get one line in a
`RETENTION_LOG.md`.

## 15. DDL addendum B (migration `0003_growth`)

```sql
ALTER TABLE users ADD COLUMN referral_code text UNIQUE, ADD COLUMN
referred_by uuid REFERENCES users(id);
ALTER TABLE workouts ADD COLUMN note text;
CREATE TABLE entitlement_credits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id uuid NOT NULL REFERENCES plans(id), days smallint NOT NULL,
 source text NOT NULL, granted_at timestamptz NOT NULL DEFAULT now(),
 consumed_from timestamptz, consumed_until timestamptz );
CREATE TABLE programs ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
code text UNIQUE NOT NULL,
 name_key text NOT NULL, level text, goal text, weeks jsonb NOT NULL,
 status text NOT NULL DEFAULT 'live' CHECK (status IN
('draft','live','retired')) );
CREATE TABLE program_enrollments ( id uuid PRIMARY KEY DEFAULT
gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 program_id uuid NOT NULL REFERENCES programs(id),
 started_at timestamptz NOT NULL DEFAULT now(), current_day int NOT NULL
DEFAULT 1,
 completed_at timestamptz, abandoned_at timestamptz );
CREATE UNIQUE INDEX enroll_one_active_uq ON program_enrollments (user_id)
 WHERE completed_at IS NULL AND abandoned_at IS NULL;
CREATE TABLE user_prs ( user_id uuid NOT NULL REFERENCES users(id) ON
DELETE CASCADE,
 exercise_id uuid REFERENCES exercises(id), kind text NOT NULL,
 value numeric NOT NULL, workout_id uuid, achieved_at timestamptz NOT
NULL,
 PRIMARY KEY (user_id, exercise_id, kind) );
CREATE TABLE challenge_org_scores ( challenge_id uuid NOT NULL REFERENCES
challenges(id) ON DELETE CASCADE,
 gym_id uuid NOT NULL REFERENCES gyms(id), score numeric NOT NULL, rank
int,
 PRIMARY KEY (challenge_id, gym_id) );
```

Resolver amendment (extends Part 4 §4.1): third UNION arm selects
rank/entitlements from `plans` joined via active `entitlement_credits`
windows; credit consumption (`consumed_from/until`) is stamped by the
day-close sweep only when no paid candidate exists — banked otherwise
(§5.2). DPDP cascade (Part 4 §5.2) extends to: credits, enrollments,
user_prs, org_scores rows.

## 16. Build mapping & acceptance

**Ships with v1 core (Phases 2–4, per v1 §21 sequencing):** §2 Form Score
surfaces · §3 streaks/freezes · §5 share cards + referral · §7 PR/badges ·
§8 recap. ✔ *Done when:* freeze auto-save fires correctly across a
TZ-travel test · delta gates verified (no delta on 4-set weeks) · referral
end-to-end on sandbox (activation gate, credit banking while paid, credit
consumption after cancel) · recap renders banded kcal and honors the
Sunday slot arbitration · share card generates < 5 s and WhatsApp-shares
with working QR.
**v1.1 (with console Slice B):** §4 personal + org challenges. **Gated:**
City League (5 orgs/city) · Trainer mode (5 orgs asking). **Content track
(parallel, no code):** 3 launch programs · badge catalog · HI/AS passes +
Assamese cue recordings.

---

*— End of Part 7. Final queue item: **Part 8 — Ops Runbook** (deploy,
monitoring, backup drills, incident basics, launch checklist).*
