<!--
Part 5 — Billing & Entitlements
Extracted from aihomegym.pdf (pdftotext). Hard line-wraps and occasional
table/DDL wrapping are extraction artifacts, not content changes. When an
exact value (price, threshold, SQL) looks garbled, verify against the PDF.
This file is spec — BINDING. Do not modify; record deviations in DECISIONS.md.
-->

# Part 5 — Billing & Entitlements: Full Specification

**Prerequisites:** Architecture v1 (§9 plans, §10 payments doctrine) ·
Part 3 (§4.2 banner machine, §4.6 Billing screen, §6.3 worldwide) · Part 4
(§3.3 DDL, one-live-sub index, entitlements canon, §4.1 resolver).
**Scope:** final price books · provider adapters and their webhook state
machines · checkout, trial, pilot-code, plan-change, dunning,
cancel/refund flows · entitlement propagation · invoicing & tax hooks ·
abuse safeguards · the test matrix that makes money code boring.

## 0. Doctrine & schema addenda

**The one rule everything obeys (v1 §10, made operational):** a webhook is
a *doorbell*, never a *messenger*. On receipt: verify signature → dedupe
on `webhook_events(provider,event_id)` → ack 200 immediately → worker
**fetches the authoritative object from the provider API** → reconciles
local state through the §3 machine. Out-of-order delivery, duplicates, and
replay attacks all become non-events, because we never apply a webhook's
*payload* — only its *pointer*. The only exception is RevenueCat, whose
webhook body is itself the normalized truth feed (that is RC's product);
its adapter still dedupes and still treats the RC REST API as tiebreaker.

**Part 4 addendum A (small DDL deltas this part requires; fold into
migration `0002_billing`):**
```sql
ALTER TABLE subscriptions
 ADD COLUMN pending_plan_id uuid REFERENCES plans(id),    -- scheduled
downgrades / interval switches (§7)
 ADD COLUMN plan_change_at timestamptz,
 DROP CONSTRAINT subscriptions_provider_check,
 ADD CONSTRAINT subscriptions_provider_check CHECK (provider IN
('none','pilot','razorpay','stripe','revenuecat'));
 -- 'none' = card-less self-serve trial (§6.1); 'pilot' = hand-sold
extended trial (§6.2)
ALTER TABLE invoices ADD COLUMN tax_minor int NOT NULL DEFAULT 0, ADD
COLUMN invoice_no text UNIQUE;
CREATE TABLE billing_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_type text NOT NULL CHECK (owner_type IN ('user','gym')), owner_id
uuid NOT NULL,
 legal_name text, gstin text, address jsonb, country text NOT NULL,
billing_email citext,
 UNIQUE (owner_type, owner_id)
);
CREATE TABLE invoice_counters ( fy text PRIMARY KEY, next int NOT NULL );
-- sequential numbering per Indian FY (§11)
CREATE TABLE pilot_codes (
 code text PRIMARY KEY, plan_id uuid NOT NULL REFERENCES plans(id),
 trial_days smallint NOT NULL, max_redemptions int NOT NULL DEFAULT 1,
redeemed int NOT NULL DEFAULT 0,
 org_types text[], expires_at timestamptz, created_by uuid, note text
);

```

---

## 1. Pricing ratification (the final price books; all values are `plans`
seed rows — changing any is a data edit)

### 1.1 Consumer

| Plan | India (Razorpay) | International (Stripe) | Mobile (IAP via
RevenueCat) |
|---|---|---|---|
| Free | ₹0 — permanent (v1 §9.1 unchanged) | $0 | $0 |
| Pro monthly | **₹149/mo** | **$3.99/mo** | nearest store tier to web
price |
| Pro annual | **₹999/yr** (44% off — the anchor) | **$29.99/yr** |
nearest store tier |

IAP notes: enroll in **Apple's Small Business Program and Google's 15%
tier** before launch (both cut commission 30→15% at your scale — this is
free margin, application takes days); store price tiers may drift a few
percent from web — accept it, never advertise cross-channel price
matching. One RevenueCat entitlement id: `pro`.

### 1.2 Organizations — ratified, including Micro

| Plan code | Seats | India /mo | Intl /mo | Annual (both books) |
org_types |
|---|---|---|---|---|---|
| `org_micro` | ≤ 25 | **₹999** | **$19** | ×10 (2 months free) |
`{gym,studio}` |
| `org_micro_clinic` | ≤ 25 | **₹1,499** | **$29** | ×10 | `{clinic}` |
| `org_starter` | ≤ 100 | ₹1,499 | $39 | ×10 | all |
| `org_standard` | ≤ 150 | ₹1,999 | $59 | ×10 | all |
| `org_growth` | ≤ 400 | ₹3,499 | $99 | ×10 | all |
| `org_scale` | 400+ | ₹4,999 → custom | $149 → custom | ×10 | all |

**Micro rationale (closing Part 3's open item):** a ≤25-seat org's
worst-month metered cost is ~₹150–250 under the v1 §9.3 quotas → ₹999 nets
~₹750+, and it converts the 10–40-client PT studio that ₹1,499 would lose.

**Clinic Micro carries a ₹500 premium** because the segment carries real
extra weight — consent flow, elevated privacy posture, the Phase-2
adherence reporting it's buying into — and because clinicians anchor on
per-client value (₹60/client/mo is trivial against their session fees).
Larger clinics are rare enough that they take the standard ladder until
one asks for custom. **Annual org = 10× monthly**, offered from Starter up
and on Micro too (cash-flow + churn armor; the console upsells it at first
renewal). Currency book selection: `gyms.currency_display`/billing country
picks INR vs USD book; consumer book picked by payment country (provider
truth) with an IP/locale-based *display* default and a manual switcher
pre-checkout.

---

## 2. Provider topology (who owns what — no overlaps, no gaps)

| Surface | Provider | Instrument | Why |
|---|---|---|---|
| Consumer web, India | Razorpay Subscriptions | UPI Autopay preferred,
cards | you already run Razorpay (travels app); UPI Autopay is how India
actually subscribes |
| Consumer web, intl | Stripe Billing (Checkout + Customer Portal) | cards
| least-code path; portal offloads card-update/cancel UI |
| Consumer mobile | RevenueCat over Apple/Google IAP | store billing |
store rules require IAP for consumer digital subs (v1 §10) |
| Orgs, India | Razorpay Subscriptions (console web only) | UPI Autopay /
e-mandate / cards | B2B stays outside app stores entirely — zero
commission |
| Orgs, intl | Stripe Billing | cards | |
| Hand-sold pilots | internal (`provider='pilot'`) | none | §6.2 |

Merchant of record: you. Cross-provider invariants: **entitlements are
read only from our `subscriptions` table** (v1 §10, restated because it is
the whole design); Part 4's `subs_one_live_uq` makes a second live
subscription per owner *unrepresentable* — the §5 flows below are written
so every path respects it (mobile paywall hides IAP when a web sub is
live, and vice versa, §5.4).

---

## 3. The canonical subscription state machine (provider-agnostic; every
adapter compiles into these events)

**States** (Part 4 CHECK, unchanged): `trialing → active ⇄ past_due →
expired`, plus `canceled` (terminal-at-period-end) and direct `trialing →
expired` (card-less trial lapse).

**Normalized events → transitions → side-effects** (side-effect columns: E
= entitlement cache bust, N = notification per Part 3 §5.3 / v1 §15, A =
analytics per v1 §16, B = Part 3 §4.2 banner recomputes automatically from
state):

| Event (emitted by adapters or sweeps) | From → To | Side-effects |
|---|---|---|
| `TRIAL_STARTED` | ∅ → trialing | E · A `org_trial_started` · schedule
D-5/D-1 N |
| `PAYMENT_METHOD_ATTACHED` | trialing (provider none→rzp/stripe) | N
"you're set — first charge {date}" |
| `ACTIVATED` (first successful charge) | trialing/expired → active | E ·
invoice row · N receipt · A `subscribe_activated` |
| `RENEWED` (periodic charge ok) | active/past_due → active | invoice ·
`current_period_end` advance · E if was past_due |
| `PAYMENT_FAILED` | active → past_due | E (grace still grants, Part 4
§4.1) · N day-0 of dunning (§8) |
| `GRACE_EXPIRED` (sweep, day 5) | past_due → expired | E (degrade) · N ·
A `churned{reason:payment}` |
| `TRIAL_LAPSED` (sweep) | trialing → expired | E · Part 3 §4.2 read-only
path · A |
| `CANCEL_REQUESTED` | active → canceled (`cancel_at_period_end=true`) | N
confirm + paid-through date · A + reason survey |
| `PERIOD_ENDED` (sweep or provider) | canceled → expired | E · win-back N
(member-side prompts per v1 §8) |
| `UNCANCELED` | canceled → active | E · N |
| `PLAN_CHANGE_APPLIED` | any live (plan_id swap) | E · invoice
(proration, §7) · A |
| `REFUND_FULL_FIRST` | active → expired | invoice refunded · E · A |

Two sweeps own time-based edges (BullMQ repeatable, idempotent,
fake-clock-testable): the **grace sweep** (`past_due` older than 5 days →
`GRACE_EXPIRED`) and the **expiry sweep** (`trialing` past `trial_ends_at`

with `provider='none'|'pilot'` → `TRIAL_LAPSED`; `canceled` past
`current_period_end` → `PERIOD_ENDED`; also fires `pending_plan_id`
applications, §7). Every transition writes `audit_log`; illegal
transitions (e.g., `RENEWED` on `expired`) log + alert instead of applying
— that alert firing means an adapter bug, and it will be the first you
hear of it rather than a customer.
---

## 4. Provider adapters (each ≤ ~200 lines of mapping code; the state
machine does the thinking)

Adapter contract: `verifySignature(req) → dedupe → ack → enqueue{provider,
event_id, pointer}` then worker: `fetchAuthoritative(pointer) → normalize
→ apply(§3 event)`. Event names below are the current documented sets —
**the adapter is the only file that knows them**, so provider renames are
a one-file fix; verify against live docs at implementation.

### 4.1 Razorpay (consumer IN + orgs IN)

| Razorpay event | Normalized |
|---|---|
| `subscription.authenticated` | `PAYMENT_METHOD_ATTACHED` (mandate
approved) |
| `subscription.activated` / first `subscription.charged` | `ACTIVATED` |
| `subscription.charged` (subsequent) | `RENEWED` |
| `payment.failed` (sub context) / `subscription.pending` |
`PAYMENT_FAILED` |
| `subscription.halted` | ensure past_due (dunning continues; halted ≠
dead) |
| `subscription.cancelled` | `CANCEL_REQUESTED` (if user-initiated at
provider) or reconcile |
| `subscription.completed` | `PERIOD_ENDED` (fixed-count subs — we don't
use, reconcile only) |
| `refund.processed` | `REFUND_*` per §9 |

Mechanics: subscriptions created server-side against a Razorpay Plan
mirroring our `plans` row (mapping table in config, asserted at boot — a
mismatch fails deploy, not a customer); **UPI Autopay mandate** collected
via hosted checkout; card-less trials attach later with `start_at =
trial_ends_at` so the mandate charges only when the trial converts (§6.1).

Signature: `X-Razorpay-Signature` HMAC-SHA256 over raw body with the
webhook secret — verified before parsing, constant-time compare.

### 4.2 Stripe (consumer intl + orgs intl)

`checkout.session.completed` → attach/ACTIVATE per mode · `invoice.paid` →
`RENEWED`/`ACTIVATED` · `invoice.payment_failed` → `PAYMENT_FAILED` ·
`customer.subscription.updated` → reconcile (plan/interval/cancel flags) ·
`customer.subscription.deleted` → `PERIOD_ENDED`. Use **Stripe Checkout**
for purchase and **Customer Portal** for
card-update/cancel/interval-switch (portal configured to allow only our
plan set) — two redirects replace four screens of PCI-adjacent UI. Stripe
Smart Retries configured to 3 attempts over 5 days so provider dunning and
our §8 timeline coincide. Signature: `Stripe-Signature` with tolerance
window; raw-body route (no JSON middleware before verify — classic
footgun, flagged here so it never happens).

### 4.3 RevenueCat (consumer mobile)

`INITIAL_PURCHASE` → `ACTIVATED` · `RENEWAL` → `RENEWED` · `BILLING_ISSUE`
→ `PAYMENT_FAILED` (store grace ≈ our past_due; expiry date from RC is
authoritative) · `CANCELLATION` → `CANCEL_REQUESTED` (auto-renew off;
access continues) · `UNCANCELLATION` → `UNCANCELED` · `EXPIRATION` →
`PERIOD_ENDED`/`GRACE_EXPIRED` · `PRODUCT_CHANGE` → `PLAN_CHANGE_APPLIED`
· `TRANSFER` → move `provider_ref` between our users (RC app-user-id = our
user uuid — set at login, never anonymous, which is what makes
restore-purchases and transfers deterministic). Store receipts, prices,
and proration are the stores' problem; we mirror state and never compute
money for IAP.

## 5. Checkout & payment-method flows

**5.1 Consumer web IN:** paywall (plan cards, annual pre-selected) → `POST
/v1/billing/checkout {plan_code}` (server prices everything; client-sent
amounts don't exist) → Razorpay hosted checkout → handler verifies payment
signature → optimistic "Pro active" UI while the webhook path confirms
(state machine remains the truth; UI reconciles within seconds).
**5.2 Consumer web intl:** same endpoint → Stripe Checkout redirect →
success URL → portal link stored on Billing page.

**5.3 Org (console Billing, Part 3 §4.6):** tier picker (org_type-filtered
per `plans.org_types`, annual toggle) → Razorpay/Stripe by currency book →
mandate/checkout → `ACTIVATED` flips the Part 3 banner machine out of
trial.
**5.4 Mobile:** RC Paywall → purchase → RC webhook `ACTIVATED`.
Cross-channel guards: paywall first calls `GET /v1/me/entitlements`; if
`source=web`, show "You're already Pro (manage on the web)" — no purchase
button; web Billing for `source=revenuecat` shows "Managed through your
app store" with deep links. Restore Purchases wired on login and on
paywall. This pair of guards is the entire defense against double-paying,
and it's tested in §14.

## 6. Trials & pilot codes

**6.1 Org self-serve (card-less 7-day, Part 3 §4.0):** signup → local
`trialing`, `provider='none'`, `trial_ends_at=+7d`. Add payment any time
during trial → provider sub created with first charge at `trial_ends_at` →
`PAYMENT_METHOD_ATTACHED`. Lapse without payment → `TRIAL_LAPSED` → Part
3's read-only grace. Reactivation within 90 days of archive → new checkout
on the *same* subscription row (`expired → active` via `ACTIVATED`),
history intact.
**6.2 Pilot codes (the hand-sold Jorhat play, v1 §9.2):** admin issues
`pilot_codes` rows (30–90 d, org-type-scoped, single-redemption default);
redeemed at onboarding step 2 → `trialing` with `provider='pilot'` and the
long `trial_ends_at`. Everything downstream — banners, D-5/D-1 nudges,
conversion checkout — is byte-identical to 6.1; a pilot is just a trial
with a longer fuse and a `note` telling you which gym owner shook your
hand. Consumer trials: **none** — permanent free tier is the funnel (v1
§9.1; unchanged, restated so nobody "helpfully" adds one later).

## 7. Plan changes & proration (the money-math rules, exhaustively)

| Change | Effect | Billing mechanics |
|---|---|---|
| **Org upgrade** (seat pressure / feature) | entitlements + seat cap
**immediately** | one-off proration charge now = `(new−old) ×
days_left/period_days` (minor-units, floor); provider plan swap scheduled
at cycle end (`pending_plan_id` + provider schedule API). Stripe: native
`proration_behavior=create_prorations` does both in one call. |

| **Org downgrade** | at period end | blocked while live non-complimentary
members > target cap (Part 3 §4.6 guided flow); else `pending_plan_id`,
applied by the expiry sweep → `PLAN_CHANGE_APPLIED` |
| Consumer **monthly → annual** | immediately | charge full year now;
`current_period_end = now + 1y + days_left_of_month` (remaining paid days
convert to bonus days — no refund math, user visibly wins) |
| Consumer **annual → monthly** | at period end | `pending_plan_id`;
Stripe portal handles its own book natively |
| Mobile any | store-managed | `PRODUCT_CHANGE` mirrors it; we never
compute |
| Currency-book switch | not supported in-place | cancel at period end →
resubscribe in new book (rare; support-documented) |

Property test (§14): for every (old, new, day-in-cycle) triple — proration
≥ 0, never exceeds new plan price, and upgrade-then-immediate-downgrade
never mints negative money.

## 8. Dunning & grace (one timeline, all providers)

Day 0 `PAYMENT_FAILED` → `past_due` (**entitlements keep granting** — Part
4 resolver; punishing a member mid-workout for their gym owner's expired
card is how you lose both) → notify owner/user (email + push; org: banner
turns red per Part 3 §4.2). Providers retry on their own schedules
(Razorpay auto-retry / Stripe Smart Retries ≈ 3 attempts); our nudges at
day 0, 2, 4 with an "update payment" deep link (Razorpay: fresh mandate
flow; Stripe: portal). Day 5 grace sweep → `GRACE_EXPIRED` → degrade +
honest copy ("members are on the free tier until payment resumes"). Any
successful charge at any point → `RENEWED` → instant restore. Org-side
dunning mail goes to `billing_profiles.billing_email` ∪ owner — the front
desk paying the bills is often not the owner reading the app.
## 9. Cancellation, refunds, disputes

**Cancel** is always *at period end* (access through what was paid;
`CANCEL_REQUESTED`); immediate termination exists only inside the refund
path. Consumer cancel: two taps, no retention screen (dark-pattern-free is
a brand asset; the win-back happens later via v1 §8's prompts, not at the
exit door). Org cancel: Part 3 §4.6's one honest retention screen
(pause-1-month · Micro downshift) → reason survey → confirm.
**Refund policy (ratified):** consumer — **7-day no-questions refund on
the first charge** of any plan (self-serve button on Billing;

`REFUND_FULL_FIRST` → expire; kills most disputes before they exist);
renewals — goodwill case-by-case via support, default no (they had 26+
notified days). Org — no refunds by default (they had a free trial);
pro-rata service-credit for verified outages, at your discretion, issued
as bonus days not money (simpler books). IAP — store-owned; support copy
links the store's refund page and we honor whatever `EXPIRATION` says.
**Disputes/chargebacks:** provider dispute webhook → sub to `past_due`
(freeze upside, don't nuke data) → alert you with an auto-assembled
evidence pack (signup IP/UA, `audit_log` trail, `usage_daily` showing
actual product use, invoices) — usage evidence wins the winnable ones and
takes the worker 0 minutes to compile. Two disputes on one owner → account
flagged, manual review before any new subscription.

## 10. Entitlement propagation (closing the loop)

Single choke point = Part 4 §4.1 resolver · Redis cache 60 s · **bust
triggers** (exhaustive): any §3 transition · `gym_members` insert/removal
· `plans.entitlements` edit (admin) · `pending_plan_id` application.
Clients read `GET /v1/me/entitlements` (ETag; returns effective doc +
`source: own|org|free` + `renewsAt`) to *shape UI*; the server re-derives
on every gated request regardless — client entitlements are a hint, never
an authority. Grace semantics restated once: `past_due` grants, `expired`
doesn't, and the 60-second cache is why a gym owner's payment fixing
itself feels instant to 150 members.

## 11. Invoicing & tax hooks (engineering now, CA later)

Every `ACTIVATED`/`RENEWED`/proration charge → worker renders **our own
invoice PDF** (org logo-free, sequential `invoice_no` per Indian FY from
`invoice_counters` — `2026-27/000041`), stores to R2 `invoices/`, emails
it, lists it on Billing (Part 3 §4.6). `billing_profiles` captures legal
name/GSTIN/address at first org checkout (optional for consumers).
`invoices.tax_minor` + a `tax_note` line on the PDF exist from day one so
enabling GST is a **data + template change, not a schema change**.   ⚠️ *Not
tax advice:* GST registration thresholds, SAC codes, place-of-supply for
the USD book, and export-of-services treatment are questions for your CA
before the first paid invoice — the schema above is deliberately shaped so
whatever they answer slots in.

## 12. Abuse & safety rails

Server-side pricing only (client sends `plan_code`, nothing else) · hosted
checkouts only (no raw card handling, no card-testing surface on our API)
· webhook raw-body + signature + dedupe (§4) · pilot codes
single-redemption, expiring, audit-logged · trial re-abuse (org deletes,
re-signs for another 7 days): allowed once — second trial for a matching
owner email/phone requires a pilot code (a soft gate that costs honest
users nothing) · provider/plan mapping asserted at boot (§4.1) · all money
mutations behind `Idempotency-Key` and written to `audit_log` (v1 §10) ·
secrets: separate webhook secrets per provider per environment, rotated
with the §0 doctrine that rotation is routine, not incident response.

## 13. Finance analytics

Events (v1 §16 taxonomy, money subset): `paywall_viewed{trigger}` ·
`checkout_started{plan,provider}` · `subscribe_activated` ·
`trial_converted{days_used}` · `plan_changed{from,to}` ·
`payment_failed/recovered` · `churned{reason}` · `refunded`. **MRR view**
(admin panel, next to the v1 §9.3 cost dashboard — margin on one screen):
```sql
CREATE VIEW mrr AS
SELECT p.audience, p.currency,
         sum(CASE p."interval" WHEN 'month' THEN p.price_minor ELSE
p.price_minor/12 END) AS mrr_minor,
         count(*) AS subs
FROM subscriptions s JOIN plans p ON p.id=s.plan_id
WHERE s.status IN ('active','past_due') GROUP BY 1,2;
```
Weekly finance digest to you: MRR by book, trials in flight, conversion %,
dunning saves, per-org cost vs revenue outliers.

## 14. Test matrix & acceptance criteria (money code graduates only
through this gate)

Sandbox suites per provider (Razorpay test mode, Stripe test clocks, RC
sandbox store): happy path trial→attach→activate→renew ×2 → cancel →
period end · dunning path with **fake clock** (fail day 0 → nudges 0/2/4 →
recover day 3 ⟂ expire day 5) · duplicate webhook ×5 → one transition
(dedupe) · **out-of-order** (`charged` before `activated`) → correct final
state via fetch-authoritative · replayed old event after refund → no

resurrection (illegal-transition alert fires) · cross-channel double-pay
guard both directions (§5.4) · seat-blocked downgrade → guided flow →
succeeds after removals · proration property test (§7) across 1,000 random
triples · card-less trial lapse → Part 3 read-only console → reactivation
restores history · pilot code full lifecycle · resolver flips within 60 s
of every §10 bust trigger (integration-timed) · one-live-sub invariant:
concurrent double-checkout race admits exactly one (DB test like Part 4's
seat race).
**Done when:** every row above is a green CI job against sandboxes · a
stranger can pay you in INR and USD on web and via IAP on a test device ·
you can narrate any subscription's life from `audit_log` alone · and
killing the worker mid-webhook-burst loses nothing (queue + dedupe replay
test).

## 15. Build mapping & open items

Lands in **v1 Phase 3** exactly as scheduled (weeks 6–8): §5 checkouts +
§4 adapters + §3 machine + sweeps + §6 trials/pilots are the Phase-3 core;
§11 invoicing and §13 digest ride the same phase's worker; §9 dispute pack
and annual-org upsell copy can trail by a sprint. **Open items (external,
start now — lead times, not code):** CA session (GST posture for INR +
export treatment for USD book) · Apple Small Business + Google 15%
enrollments · Razorpay live-mode KYC for subscriptions · Stripe account
activation for export receipts. None block Phase 1–2 engine work.

---

*— End of Part 5. Queue: **Part 6 — Mobile** (pose-pipeline spike
protocol, offline sync, RC integration test plan, store listings & privacy
labels) · Part 7 — Retention playbook · Part 8 — Ops runbook.*
