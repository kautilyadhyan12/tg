<!--
Part 2B — Trust Layer (calories, meal photos, recommendations, predictions)
Extracted from aihomegym.pdf (pdftotext). Hard line-wraps and occasional
table/DDL wrapping are extraction artifacts, not content changes. When an
exact value (price, threshold, SQL) looks garbled, verify against the PDF.
This file is spec — BINDING. Do not modify; record deviations in DECISIONS.md.
-->

# AI Home Gym — Part 2B: The Trust Layer

**Calories · Meal-Photo Nutrition & the Portion Problem · Recommendations
· Predictions · The display standard that makes users believe your
numbers**

**Full engineering specification · v1.0 · companion to Part 2, follows
Architecture v1**
**Audience:** Kd (solo developer, owner)

---

## 0. Why this document exists

You named the risk precisely: *"user will lose trust if the results are
vague, not actual."* This document is the engineering answer. It audits
every numeric surface in the app that claims to know something about the
user's body or behavior — calories burned, meal nutrition,
recommendations, predictions — against your actual code, gives a
keep/extend/replace verdict for each, and specifies the redesigns.

One thesis governs everything here, and it is worth internalizing because
every design decision below follows from it:

> **Users forgive honest imprecision. They never forgive fake precision.**

"About 180–230 kcal" that is right every time builds trust. "212.4 kcal"
that changes to 187.1 on refresh destroys it — even if 212.4 was, on
average, closer. A fitness app cannot be a metabolic lab, and pretending
to be one is the fastest way to look like a toy. The apps users trust for
years (and the trainers and clinicians who recommend apps to *their*
users) are the ones whose numbers are stable, explainable, and honestly
bounded. That is a buildable engineering property, not a marketing wish —
and for your B2B segments it is the sales feature: a physio or trainer
will demo your app to a client, and the first overclaimed number ends the
deal.

**Verdict summary (each detailed in its own section):**

| Surface | Code audited | Verdict |
|---|---|---|
| Calories burned | `ai/fitness/calories.py` | **Keep the method — it's
genuinely good. Extend coverage** (49 of 58 exercises currently fall to a
fallback that misprices them) and fix the display. |
| Meal photo nutrition | `ai/nutrition/photo_analyzer.py`,
`routers/nutrition.py` | **Redesign the pipeline.** The vision model
currently both identifies *and* invents the numbers; portion size (your
bowl problem) is unsolvable in that architecture. Same cost after
redesign: still one vision call. |
| Recommendations | `routers/recommendations.py` | **Keep the
architecture** (deterministic content-based scoring — right choice at your

scale). **Add** the two missing layers: performance-awareness and recovery
spacing. **Cancel** the planned "Neural CF" upgrade. |
| Predictions | `ai/predictions/forecaster.py` | **Replace Prophet +
per-request XGBoost** with transparent statistics. As built, this module
is the single biggest trust risk in the app — and the replacement is
*more* accurate at your data sizes, not less. |

---

## 1. The four principles (engineering doctrine — every section below
applies them)

**P1 — Separate perception from arithmetic.** AI models (vision, pose)
*identify* things: "that is dal, in a medium katori, about ¾ full."
Deterministic code *computes* things: grams × per-gram nutrients = kcal.
The moment a language model is allowed to do the arithmetic, you get
numbers that are unreproducible, unexplainable, and unauditable. This is
the exact principle your form engine already embodies (MediaPipe perceives
landmarks; your rules compute verdicts) — Part 2B extends it to nutrition.

**P2 — Never fake precision.** Every displayed estimate is a **range**
with honest rounding, sized to the method's real uncertainty. Point values
are only shown where they are actually known (a barcode-scanned label, a
user-entered weight).

**P3 — Every number is explainable and versioned.** Each numeric surface
has a "How is this calculated?" affordance (one honest paragraph, i18n
message keys per Part 2 Appendix A conventions). Every *stored* estimate
carries a `calc_version` so that improving a formula later never silently
rewrites a user's history — their past stays as it was computed, and you
can tell which era any number came from. (Schema consequence for Part 4:
estimate-bearing tables get `calc_version SMALLINT NOT NULL`.)

**P4 — User corrections are ground truth.** Every estimate is editable,
the correction is stored *alongside* the original (never overwriting it),
and corrections feed back: per-user priors (their dishware, their portion
tendencies) and a global evaluation set for regression-testing any prompt
or table change. The user correcting you is the most valuable data the app
collects — treat it as a gift, design the UI so it takes two seconds, and
thank them with visibly better defaults next time.

---

## 2. Calories burned — keep the engine, finish the table, fix the display

### 2.1 Audit

`calories.py` is the best-engineered numeric module in the codebase. It
already does the hard things right: standard MET formula (`kcal = MET ×
weight_kg × hours`) from the 2024 Adult Compendium; **active/rest split**
so long rests aren't credited as exercise; weight normalization with a
conservative 70 kg fallback; and — rarest of all — a docstring that
explicitly *refuses* to invent precision (no form-score intensity
multipliers, no age/sex corrections without the data to support them).
Keep every one of those decisions; they carry into the TypeScript/Fastify
port unchanged.

Two real gaps:

1. **Coverage: 9 of 58 exercises have specific METs; the other 49 silently
get the 5.0 fallback.** This is your "vague numbers" fear already live in
production: a 10-minute stretching flow gets credited at 5.0 MET when
hatha-style holds are ~2.5 — the app reports roughly **double** the real
burn for every yoga/mobility session. In the other direction, skipping
rope (~11 MET) is credited at less than half. Users compare these numbers
against their watches and against common sense; systematic 2× errors on
entire categories are exactly how trust dies. The fix is pure data:
Appendix A of this document is the complete 58-exercise table, each value
tied to its Compendium category. One day of work, port it as a constants
file with the same shape as today's `EXERCISE_MET`.
2. **Display: the number reaches the user as a point value.** The
Compendium's own MET values are population averages with real spread; the
honest display is a range. Spec in §2.3.

### 2.2 Data contract (already almost in place)

The engine's `SetSummary.durationMs` (Part 2 §2.4) is the **active-time**
input per exercise; between-set rest comes from the app's session timer
(`phase == 'rest'` today — same idea, same split, in the new session
model). Nothing about the formula needs the raw pose stream, so calorie

computation stays server-side at sync time (deterministic, versionable) —
the client may show a live *provisional* number during the workout,
clearly styled as provisional, reconciled at sync.

### 2.3 Display specification

- **Range = point estimate ± 20%**, both ends rounded to the nearest 5
kcal; e.g. computed 212.4 → **"≈ 170–255 kcal."** The ±20% is not
decoration — it is roughly the documented individual variation around
Compendium MET values, which is the method's true uncertainty. One
constant, `CALORIE_BAND = 0.20`, versioned under `calc_version`.
- **Session totals** sum the per-exercise points, then band the total (not
sum of bands — bands don't add linearly and summing them overstates
width).
- **Label:** "estimated" appears with the unit the first time in any view
(message key `est.calories.label`).
- **Method sheet** (`est.calories.how`): one paragraph — based on exercise
type, your body weight, and active time, using the standard MET method
(the same reference used in clinical and research settings); a heart-rate
monitor can narrow this, which is the mobile roadmap.
- **Weight nudge, not nag:** when the 70 kg fallback is in use, the
calorie card shows a single quiet line — "Add your weight for a number
that's actually yours" — because personal weight is the single biggest
accuracy lever available for free.

### 2.4 Roadmap (explicitly deferred, not forgotten)

Wearable heart rate on mobile (Part 6) upgrades the method to HR-based
estimation for users who have it, with MET as the universal fallback.
Continue to refuse: per-rep "work" physics (bodyweight exercise mechanical
work ≠ metabolic cost), form-score multipliers, and any per-user
"metabolism" claims. The module's own docstring already argues this
correctly — that reasoning is now policy.

---

## 3. Meal-photo nutrition — the portion problem, solved without new
models

### 3.1 Audit — why the bowl problem is unsolvable in the current
architecture

Today's pipeline (`photo_analyzer.py`): one Groq Llama-4-Scout vision call
receives the photo and a prompt that asks it to output food names **and**
quantities **and** kcal **and** all macros directly. The router hardening
around it is good (quota fail-closed, 10 MB cap, thread off-load so the
event loop isn't blocked, and — importantly — **the photo is never
stored**; it is analyzed in memory and discarded. Keep that property; §3.6
makes it an explicit promise).

But the architecture has two structural failures:

1. **Portion blindness — your bowl problem, precisely.** A monocular photo
has no absolute scale. The same dal photographed in a 150 ml katori and a
300 ml serving bowl can produce nearly identical pixels — yet one is ~110
kcal and the other ~220. The model cannot know which it is unless
something in the frame anchors the scale, and today nothing asks it to
look for anchors, the user is never consulted, and the app has no memory
of the user's actual dishes. Every scan silently rolls dice on a 1.5–3×
quantity error — the single largest error source in the whole feature,
dwarfing food-identification mistakes.
2. **Macro hallucination.** The model does the nutrition arithmetic
itself. Same photo can yield different totals run-to-run (temperature 0.1
reduces but does not eliminate this); the numbers trace to no database;
when a user asks "why 340 kcal?" there is no answer. This violates P1 at
the exact place users check your work — many know the calories of their
daily foods better than any model does.

### 3.2 The redesigned pipeline — five stages, still exactly one vision
call

The vision call does what vision models are good at (seeing);
deterministic code does everything else. Cost per scan is unchanged, so
the 8/day quota and the unit economics from the pricing doc are untouched.

**Stage 1 — Vision: identify, never compute.** The prompt is rewritten so
the model returns identification *evidence*, no nutrition math at all.
*("Never compute" and "no nutrition math at all" AMENDED 2026-09-15 and 2026-09-16, RULINGS: the model also gives its own grams, calories and macros for each food, as its estimate, shown marked "estimate" only where no food table has the food; the table's number wins wherever it exists, unless the table's calories per 100 g are more than three times, and more than 10 kcal, from the model's own. Since 2026-09-16 the estimate's energy also chooses among USDA entries of one name: the plainest entry whose energy is near the model's, or within 10 kcal of the nearest entry's. The rules paragraph below carries the same amendment.)*
Output contract (temperature 0; JSON only) — *temperature 0 AMENDED 2026-09-16 (RULINGS): the scanner runs at Google's default on Gemini 3, whose guide warns that below 1.0 the model can loop or degrade; the eight plates were measured at it. The shape below AMENDED 2026-09-16 (RULINGS, ROADMAP 7a-iii-b): each item is one list, `[name, canonical_hint, vessel, fill_level, size_class, count, grams, kcal, protein_g, carbs_g, fat_g]`, the vessel from a fixed list, the count of whole pieces only; no cuisine guess, scale anchors or confidence (trimmed 2026-09-15). AMENDED AGAIN 2026-09-17 (RULINGS, ROADMAP 7a-iv-d): no vessel, fill level or size class — nothing read them once a row started by its count and grams — so each item is `[name, canonical_hint, count, grams, kcal, protein_g, carbs_g, fat_g]`; the reply is asked for as one JSON object, and a reply of that object in a list of one reads as the object*:

```json
{
    "meal_name": "Dal with rice and roti",
    "cuisine_guess": "north_indian",
    "items": [
         { "name": "dal (lentil curry)", "canonical_hint": "dal",
          "container": "katori_or_small_bowl", "fill_level": 0.75,
          "size_class": "medium", "count": null, "confidence": "high" },
         { "name": "steamed white rice", "canonical_hint": "rice_cooked",
          "container": "plate_section", "fill_level": null,
          "size_class": "medium_mound", "count": null, "confidence": "high" },
         { "name": "roti", "canonical_hint": "roti",
          "container": null, "fill_level": null,
          "size_class": null, "count": 2, "confidence": "high" }
    ],
    "scale_anchors": [
         { "type": "dinner_plate_rim", "notes": "full rim visible, slight
ellipse" },
         { "type": "spoon", "notes": "steel tablespoon left of bowl" }
    ],
    "unknown_items": [],
    "photo_quality": "good"
}
```

Rules encoded in the prompt: every food the model can see apart is its own item — a toast topped with avocado, a fried egg and bacon is four items — while a dish cooked or mixed into one (a curry, a stew, biryani, a pizza), or a closed sandwich or burger, stays one *(ADDED 2026-09-17, RULINGS, ROADMAP 7a-iv-f: without it, Kd's topped toasts came back as one dish in most scans, priced by the model's estimate)*; countable items get counts (rotis, idlis,
eggs — counting is the one portion task vision does reliably); containers
get a type + size class + fill level *(STRUCK 2026-09-17, RULINGS, ROADMAP 7a-iv-d: no container, size or fill is asked)*; the model must list visible scale
anchors (plate rims, cutlery, hands, cans) and must say "unknown" rather
than guess. **No kcal, no grams, no macros — ever.** *(AMENDED 2026-09-15 and 2026-09-16, RULINGS: the model's own grams, calories and macros ARE asked for, as its estimate, and shown marked "estimate" only where no table has the food; the table's number wins wherever it exists, unless the table's calories per 100 g are more than three times, and more than 10 kcal, from the model's own.)* The model naming a
*quantity in grams* is banned from the contract because that is arithmetic
wearing a costume.

**Stage 2 — Deterministic portion resolver (grams + a gram-range per
item).** *(AMENDED 2026-09-16 and 2026-09-17, RULINGS, the portion redesign; built at ROADMAP 7a-iv-b: the rungs below, and every rule that read a food's name, a container or a serving word, are gone. Every food carries its own measures — USDA's household measures, a packaged product's label serving, grams and ounces — and a scanned row starts at the photo's count of one of them only where that weighs within 30 % of the grams the model saw, else at those grams, marked estimate; a saved dish is never chosen for the person. Stage 4's sheet corrects each row with the same measure picker Add food has.)* Pure code, fully testable, applies the first matching rung:

1. **User's saved dishware** (§3.4): if the user has confirmed "my dal
katori ≈ 180 ml" before, that beats everything.
2. **Anchor scaling:** a visible standard dinner-plate rim (26–27 cm
across the world's tableware with remarkable consistency) or standard

cutlery gives an approximate mm-per-pixel; container diameter → volume
class. This is coarse — its job is only to pick between S/M/L classes,
which is where the 2–3× errors live.
3. **Regional portion priors:** cuisine guess + item + container class →
the Appendix B measures table (katori ≈ 150 ml, serving bowl ≈ 300 ml, 1
roti ≈ 40 g, 1 idli ≈ 35 g...). Region defaults from the user's profile
locale.
4. **Global defaults:** the conservative middle of the item's
typical-serving range.

Each rung yields `grams_point` and `grams_range` (e.g. dal, medium katori,
0.75 full → 110 g, range 90–140 g). The rung used is recorded
(`portion_source: "user_dishware" | "anchor" | "regional_prior" |
"default"`) — it drives the confidence chip and tells you, in telemetry,
which rungs are earning their keep.

**Stage 3 — Nutrition arithmetic from databases, never from the model.**
`kcal = grams × per-gram values` from, in priority order: the local
curated table (which already holds a good Western core plus Roti, Dal,
Paneer, Idli — expand per §7), USDA FoodData Central (already integrated),
an **IFCT 2017 pack** for Indian foods (the Indian Food Composition Tables
— the authoritative source for exactly the cuisine your first users eat),
and OpenFoodFacts for packaged goods (free, global; barcode path arrives
with mobile). Every item's result carries its source. Same photo + same
confirmed portions now produce the same numbers every single time, and
every number has a citation. *(AMENDED 2026-09-17, RULINGS, ROADMAP 7a-iv-i: a
scanned name is looked up whole on the curated table, then as USDA's food of that
name; a name no table holds whole, such as "steamed broccoli", is the curated
table's food of a shorter name — never shortened past a word that is a food of its
own ("chicken salad"), and only where that food carries the kcal the model saw
within its own error — unless USDA's food holding every word is more than 10 kcal
per 100 g nearer to it; then a packaged product; else the model's estimate.)*

**Stage 4 — The confirmation moment (three seconds, one tap).** *(AMENDED 2026-09-16, RULINGS, the portion redesign; built at ROADMAP 7a-iv-b: each item starts at one of its food's measures or at the photo's grams marked "~120 g · estimate", and is corrected in the measure picker — a measure and how many, or a saved dish and how full — never S/M/L cards; the total is a single number, "about" while an estimate is in it.)* Before
anything is saved, one compact sheet: each item as a chip with its portion
pre-selected by the resolver — *"Dal — medium katori (~110 g)"* — tappable
to S/M/L cards (with gram labels and relatable visuals) or a gram stepper;
wrong item → tap to search (existing food search endpoint); missing item →
add. Then one confirm button. Because the resolver pre-fills well, the
common case is literally one tap — but that tap converts an AI guess into
a user-verified log, which changes both the data quality and how the user
*feels* about the number. The displayed total before confirm is a range
(from the gram ranges); after confirm it tightens around the chosen
portions.

**Stage 5 — Memory and the learning loop.** First time an unrecognized
personal container appears: one question — "How big is this bowl?" with
three visual cards — stored to **My Dishware** (per-user: label, volume,
food-type association). Next scans auto-apply it (rung 1) and the question
never repeats. Every correction (portion changed, item swapped) is stored
as `{original_estimate, user_final, delta, portion_source}`: per-user, a
consistent bias (always corrects rice down ~20%) shifts *their* defaults;
globally, corrections become the regression eval set — any change to the
Stage-1 prompt or the measures table must not worsen agreement with the
last N hundred confirmed logs (this is the golden-trace idea from Part 2
§7, applied to nutrition).

### 3.3 What accuracy to promise (set the bar honestly, then clear it)

Photo-based estimation is ±20–40% *for trained humans*. The goal is
therefore not laboratory truth; it is: **(a)** eliminate the 2–3×
portion-class errors (the resolver + dishware memory do this — it's the
whole reason the bowl question matters), **(b)** make remaining error
*consistent and correctable* (deterministic arithmetic + one-tap edits),
**(c)** never display more precision than exists (kcal ranges rounded to
10; macros to 1 g; totals as ranges until confirmed). In-app framing
(message key `est.meal.how`): "We identify your food from the photo,
estimate portions from your dishes and regional serving sizes, and
calculate nutrition from published food databases (USDA/IFCT). Confirming
portions makes it accurate to *your* servings."

### 3.4 Data notes for Part 4

Two small tables: `user_dishware(user_id, label, container_class,
volume_ml, created_at)` and `meal_log_corrections(meal_log_id, field,
original, corrected, portion_source, created_at)`; `meal_logs` rows gain
`portion_source`, `nutrition_source`, `calc_version`. Meal photos remain
**never persisted** — that stays an architectural guarantee, stated in the
privacy copy, and it matters double for the physio-clinic segment (§7).

### 3.5 Edge cases (specified now so they don't become support tickets)

Thali / multi-compartment plates → each compartment is an item with
`container: "thali_section"` (priors in Appendix B). Liquids and curries →
fill-level drives grams via container volume × density class

(thin/medium/thick — three constants, not a physics model). Packaged food
in frame → identify the product, prefer OpenFoodFacts label data, and on
mobile suggest the barcode scan instead. Truly unknown item → shown as
"couldn't identify — tap to add," which logs *honestly incomplete* rather
than confidently wrong; an unknown that the user fills in is a success,
not a failure. Terrible photo (`photo_quality: "poor"`) → ask for one
retake with a one-line tip before spending the user's patience on a bad
estimate — but never burn a second quota unit for the retake of a failed
parse.

---

## 4. Recommendations — right architecture, two missing layers

### 4.1 Audit

The content-based scorer (goal 40 · difficulty 20 · equipment 20 ·
duration 10 · variety 5 · AI-support 5, popular-items fallback for empty
profiles) is the **correct architecture at your scale**: deterministic,
explainable, zero marginal cost, cold-start-friendly. Do not let anyone
talk you into collaborative filtering yet — the docstring's "upgrades to
Neural CF as history grows" is hereby cancelled. CF needs dense user×item
interaction data across thousands of users to beat rules; below that it
produces unstable, unexplainable suggestions — vague numbers again, in
list form. Revisit only past ~50k MAU, and then as a *global* model
trained offline, never per-request.

What the scorer is blind to today: **how the user actually performs** (it
never reads rep counts or form scores — the richest data your product
uniquely generates) and **recovery** (nothing stops it recommending
lower-body four days straight).

### 4.2 The upgrade (still 100% deterministic rules)

Add two scoring terms and one output field; totals stay comparable:

- **Progression term (±15).** This is where Part 2 pays for itself twice:
the **family templates (§5) are the progression graph.** Within a family,
if the user's last 3 sessions on an exercise averaged form ≥ 85 with reps
at the top of their range → +15 to the next-harder family member (squat →

jump squat; wall push-up → push-up; plank → side plank) and a small −5 to
the mastered one (gently graduate them). Struggling (avg form < 60 or
chronic early set termination) → +15 to the easier variant. All thresholds
are config, not code, per v1 §9.3 conventions.
- **Recovery & balance term (−20 / +10).** Primary muscle group trained
within the last 48 h → −20. A muscle group untouched for 7+ days while
others repeat → +10 to its exercises. Uses the `primary_category`/muscle
tags already in your seed data.
- **Surface the "why."** The score components are already computed and
then thrown away; return the top contributors per item as message keys,
rendered as chips: *"Matches your muscle-gain goal · You're ready to
progress from squats · Legs are recovered."* A recommendation with a
visible reason is advice; one without is an ad. This one change moves more
trust than any model swap could.

### 4.3 Acceptance tests (deterministic → trivially testable)

Fixture profiles + histories with exact assertions: *mastered-squats user
→ jump squat in top 6, squat not #1*; *trained-legs-yesterday user → no
lower-body in top 3*; *empty profile → popular fallback, `method:
"popular"`*. These run in CI like golden traces; a scoring-weight change
that flips a fixture is a reviewed decision, not an accident.

---

## 5. Predictions — replace statistical theater with transparent
statistics

### 5.1 Audit — the hard verdict

`forecaster.py` fits **Prophet** on one user's daily calories (gated at
only 5 sessions) and trains an **XGBoost classifier per request** on 3–10
weekly samples with 3 features to output "73% chance you hit your goal."
At these data sizes this is statistical theater: Prophet's changepoint
machinery on two noisy weeks produces forecasts that *visibly change
between refreshes* (trust-killer #1, and your exact words: vague, not
actual); a per-request tree ensemble on single-digit samples memorizes
noise — its own average-rate fallback (already in the file!) is the better
system; and the dependency chain (prophet + cmdstanpy + xgboost) is
hundreds of MB that slows every cold start and per-request training burns

CPU you pay for. Notably, `detect_plateau` and `analyze_best_time` in the
same file are simple deterministic comparisons — those two are *already*
the right kind of system. The replacement below makes everything match
them, keeps the same API shapes (frontend barely changes), and deletes the
heavyweight deps from the image.

### 5.2 Replacement spec (deterministic, same response shapes)

- **7-day forecast → the weekday-profile method.** For each weekday, the
recency-weighted mean of that weekday's total calories over the last 4
weeks (weights 4/3/2/1, newest first; missing weekday-instances count as 0
— a skipped Tuesday is real behavior, not missing data). Band = ± the
weighted mean absolute deviation, floored at ±15%. Keeps the existing
`{date, value, lower, upper}` items and the ≥5-sessions gate. Explainable
in one sentence — *"based on your recent Tuesdays"* — which is the entire
point.
- **Weekly-goal likelihood → an honest blend, displayed as words.**
`hit_rate` = recency-weighted share of the last 6 weeks meeting the
target; `feasibility` = can `target − current_week_count` still fit in the
days remaining (1, else a proportional penalty; 0 if impossible).
Likelihood = hit_rate × feasibility, then **mapped to bands, never shown
as a percent**: ≥ 0.75 → "On track" · 0.40–0.75 → "Doable — N more
sessions" · < 0.40 → "Tough week — even one session keeps the streak
alive." A fake-precise "73%" invites the user to catch you being wrong; a
correct band with a next action is coaching.
- **Plateau & best-time:** keep as built (rolling averages, hour-of-day
histogram); tighten only the copy — "your pace has been steady for 3
weeks" (observation) rather than "you have plateaued" (diagnosis).
- **Framing rule for every prediction surface:** these are *reflections of
the user's own pattern*, and the copy says so. Below data gates, surfaces
hide entirely (already correct today — keep) rather than showing wide
nonsense.
- **When ML returns:** a single global model, trained offline on the whole
population, shipped as versioned artifacts behind the same API —
considered only when cohorts and retention data justify it (v1 §20 scale
triggers), never trained per-request again.

Migration is a drop-in: same routes, same JSON shapes, delete three heavy
dependencies, and the numbers stop moving between refreshes — which users
will *feel* even if they never articulate it.

---

## 6. The display standard (cross-cutting — applies to every number in the
app)

One table to rule every numeric surface; new features must add a row
before shipping:

| Surface | Display | Rounding | Confidence shown when | Method key |
|---|---|---|---|---|
| Calories burned (session) | range ±20% | nearest 5 kcal | always
"estimated" | `est.calories.how` |
| Meal kcal (pre-confirm) | range from gram-ranges | nearest 10 kcal |
chip from `portion_source` | `est.meal.how` |
| Meal kcal (confirmed) | tightened range | nearest 10 kcal | — |
`est.meal.how` |
| Macros | point from confirmed grams | nearest 1 g | — | `est.meal.how` |
| Recommendations | ranked list + "why" chips | — | — | `rec.how` |
| Forecast | band chart | nearest 10 kcal | hidden below data gate |
`pred.how` |
| Goal likelihood | word band + next action | no percentages | hidden
below 3 weeks | `pred.goal.how` |
| Form score | existing 0–100 | integer | — | `form.score.how` |

Plus three invariants: **determinism** (same inputs → same outputs on
every surface; the only nondeterministic component left anywhere is
Stage-1 vision identification, and even it runs at temperature 0 with its
arithmetic removed); **versioning** (`calc_version` stored with every
persisted estimate; recomputation of history is always explicit, never
silent); **editability** (any number about the user's own life is
correctable in ≤2 taps, and the correction visibly wins).

---

## 7. Worldwide users and the organization segments

**Units & locale:** kg/lb and ml/cup follow the user's profile (weight
normalization already handles both units — keep); all trust-layer copy

uses the Part 2 message-key system, so translation is content work, not
engineering.

**Food regionalization** is the real localization problem, and it is
data-shaped: the resolver's priors and the nutrition sources ship as
**regional packs** — India first (IFCT 2017 values + the Appendix B
measures; the local table's four Indian staples grow to the ~60 dishes
that cover the overwhelming majority of Indian home meals), USDA as the
global backbone, OpenFoodFacts for packaged goods everywhere. The Stage-1
prompt receives a cuisine hint from profile locale (improving
identification of, say, poha vs. upma), but identification is never
*restricted* by region — a user in Mumbai photographing pasta must work
perfectly. New market → new pack, zero engine changes: the same
exercises-as-data philosophy, applied to food.

**The four organization types** (new gyms, premium-aspiring gyms,
boutique/PT studios, physio clinics) all fit v1 §8's tenancy design as org
types with vocabulary overrides — no new architecture. Two things *do*
need saying now:

- **Physio clinics are a positioning boundary, not just a segment.** The
product is a **wellness and exercise-adherence tool the clinician assigns
and monitors** — it does not diagnose, treat, or claim rehabilitation
outcomes. That single sentence keeps you outside medical-device regimes
(India CDSCO's SaMD framework, EU MDR, FDA) that would otherwise consume a
solo developer whole. Enforce it in copy rules (in-app strings say
"exercise plan," never "rehab protocol" or "treatment"; message-key review
catches this), in the clinic dashboard's framing (adherence and activity,
not clinical outcomes), and in the terms for clinic tenants (the
professional retains clinical judgment). Everything the trust layer builds
is *why* clinics will adopt it — honest ranges, visible methods,
never-stored photos, and a clinician-visible record of what their client
actually did.
- **Privacy posture is health-adjacent worldwide:** meal and workout data
under India's DPDP Act 2023 and GDPR for EU users means the v1 §18 items
(export, deletion, consent copy) are launch requirements, not polish — and
"photos are analyzed, never stored" is both a compliance simplification
and a marketing line. Put it in the scan UI itself.

---

## 8. Sequencing and definition of done

Slotting into v1 §22 without disturbing it — the form engine (Part 2)
still leads; this work rides the phases where each module is being ported
anyway:

| Work | Lands in | Effort | Done when |
|---|---|---|---|
| MET table (Appendix A) → constants | Phase 2 backend port | ~1 day |
Every seeded exercise resolves a category-correct MET; yoga session ≈
halves vs. today; unit test locks table completeness against the catalog.
|
| Forecaster replacement | Phase 2 | 1–2 days | prophet/cmdstanpy/xgboost
gone from requirements; responses byte-shape-compatible;
same-input-same-output test passes; image size and cold start measurably
drop. |
| Recommender upgrade | Phase 2–3 | 2–3 days | Progression/recovery terms
live behind config; "why" chips render; CI fixtures pass. |
| Meal pipeline v2 (Stages 1–3) | Phase 3 (nutrition port) | 3–4 days |
Model output contains zero nutrition numbers; identical confirmed portions
→ identical totals; every value carries a source. |
| Confirmation UI + My Dishware (4–5) | Phase 3 | 3–4 days | Common case
is one tap; second scan with a saved bowl asks nothing; corrections
persist with originals. |
| Display standard | applied per surface as ported | folded in | §6 table
implemented; `calc_version` written on every stored estimate. |
| India food pack | content, parallel | ongoing | Top-60 Indian dishes
resolve locally with IFCT values + priors. |

Roughly two and a half weeks of focused work total, none of it blocking
the engine — and at the end, every number the app shows is stable,
bounded, sourced, and correctable. That is what "actual, not vague"
compiles to.

---

## Appendix A — Complete MET table for all 58 exercises

Values assigned from the 2024 Adult Compendium of Physical Activities by
category; these are population bands (hence the ±20% display rule),
conservative where a judgment call existed. ✱ = value already in
`calories.py` today, preserved exactly.

**Yoga & stretching holds (2.3–3.0)** — hatha/static-stretch band:
Mountain Pose 2.3 · Child's Pose 2.3 · Cat-Cow Stretch 2.5 · Seated
Forward Bend 2.5 · Hamstring Stretch 2.5 · Hip Flexor Stretch 2.5 ·
Shoulder Stretch 2.5 · Cobra Pose 2.5 · Bridge Pose 2.5 · World's Greatest
Stretch 3.0 · Tree Pose 3.0 · Warrior I 3.0 · Warrior II 3.0 · Downward
Dog 3.0

**Isometric holds (3.0–3.5):** Plank 3.0✱ · Side Plank 3.0 · Superman
Hold 3.0 · Wall Sit 3.5

**Light dynamic / warm-up (2.8–3.8):** Arm Circles 2.8 · Heel Raises 3.0 ·
Calf Raises 3.5 · Wall Push-ups 3.5 · Brisk Walking 3.8 · Seated Leg
Raises 3.0

**Resistance, moderate (3.5–5.0)** — Compendium "resistance training,
multiple exercises, 8–15 reps":
Bicep Curls 3.5✱ · Shoulder Press 3.5✱ · Lateral Raises 3.5 · Tricep
Extensions 3.5 · Bench Press 3.5 · Resistance Band Pull 3.5 · Glute Bridge
3.5 · Crunches 3.8 · Leg Raises 3.8 · Russian Twists 3.8 · Bicycle Crunch
4.0 · Flutter Kicks 4.0 · Tricep Dips 4.0 · Hip Thrust 4.0 · Chair Squats
5.0✱ · Deadlifts 5.0

**Bodyweight circuit, continuous (6.0–6.5):** Squats 6.0✱ · Lunges 6.0✱
· Bulgarian Split Squat 6.0 · Step-ups 6.5

**Calisthenics & plyometric, vigorous (7.0–8.0):** Push-ups 8.0✱ ·
Pull-ups 8.0 · Pike Push-ups 8.0 · Burpees 8.0 · Jumping Jacks 8.0 ·
Mountain Climbers 8.0 · High Knees 8.0 · Jogging in Place 8.0 · Jump
Squats 8.0 · Tuck Jumps 8.0 · Jump Lunges 8.0 · Skater Jumps 7.0 · Plank
Jacks 7.0

**Jump rope (11.0):** Skipping Rope 11.0 — the Compendium's moderate-pace
rope value; the largest single correction vs. today's 5.0 fallback.

(58 total. `arnold_shoulder_press` — the non-catalog config — inherits 3.5
if ever seeded.)

---

## Appendix B — Portion priors seed (India-first, ranges the resolver
uses)

Sources: IFCT 2017 serving conventions and standard Indian dietetic
references; these are **priors** — user dishware and corrections override
them, and telemetry (§3.2 Stage 5) refines them.

**Containers:** small katori 100–150 ml · standard katori 150–200 ml ·
large katori/bowl 250–300 ml · serving bowl 300–400 ml · steel tumbler
150–200 ml · chai cup 100–150 ml · thali section 100–150 g · rice mound on
plate: small 100 g / medium 150 g / large 250 g.

**Countables:** roti/chapati 35–45 g · paratha 60–90 g · puri 20–30 g ·
idli 30–50 g · dosa (plain) 80–120 g · medu vada 40–60 g · samosa 60–100 g
· egg (large, whole) 50 g · bread slice 25–30 g · banana 100–120 g.

**Fill-density classes for curries/liquids:** thin (rasam, thin dal) ≈
0.95 g/ml · medium (dal, sambar, most curries) ≈ 1.0 g/ml · thick (dry
sabzi, halwa, thick gravies) ≈ 1.1 g/ml — three constants that turn
*container × fill level* into grams.

**Global starter set** (expanded per market pack): dinner plate rim 26–27
cm (the scale anchor) · cup 240 ml · tablespoon 15 ml · teaspoon 5 ml ·
cereal bowl 350–400 ml · mug 300–350 ml.

---

*— End of Part 2B. The sequence resumes per v1 §23: Part 3 Gym Dashboard
(recommended next — the pilots depend on it) · Part 4 Database DDL &
migration (now including §2–3's small schema notes) · Part 5 Billing &
webhooks · Part 6 Mobile (wearable-HR calorie upgrade lands there) · Part
7 Retention playbook · Part 8 Ops runbook.*
