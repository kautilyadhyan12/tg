# P2.7a — Mongo→PG collection-field inventory (DATA-VERIFIED)

Deliverable of P2.7a (approved split). **Now verified against the LIVE dev Mongo**
(`docker aihg-mongo`, db `ai_home_gym`) — not code guesses. Every source shape
below is the real key-union scanned from actual documents this session; every
target column from `apps/api/drizzle/0001_init.sql`.

**Decisions in force (DECISIONS.md 2026-07-13):** full migration BUILT per §7
and verified against this dev Mongo as the fixture (approach B); **production
launches clean** (dev data NOT imported). **Strategy:** Node script
`apps/api/tools/migrate-mongo/`, Mongo read-only, `ON CONFLICT DO NOTHING`,
id = `UUIDv5(NAMESPACE_AIHG, mongo _id hex)`, no lookup table.
**NAMESPACE_AIHG (frozen):** `4fc832e8-4827-4475-bf8a-e72cc4b611c7`.

## Live data volumes (scanned 2026-07-13)
`users:18 · workout_sessions:230 · workout_templates:0 · meal_logs:16 ·
coach_conversations:11 · body_measurements:1 · running_sessions:8 ·
running_routes:17 · running_schedules:1 · exercises:58 (not migrated)`

## Migration order (FK dependency; idempotent)
users → workout_sessions(+sets) → **gamification recompute** (streaks + user_achievements) → meal_logs, coach_conversations, body_measurements, running_* → (exercises re-seeded, §8).

---

## 1. `users` (18) → `users` + `streaks` + `user_achievements`
**VERIFIED: a SINGLE merged collection** (auth + ml + onboarding in one doc; 17
password, 1 googleId, 18 email). §7's auth/ml email-merge does NOT apply.
Real keys: `_id, email, password, fullName, googleId, authProvider, age, gender,
height, weight, targetWeight, fitnessLevel, fitnessGoals, exerciseFrequency,
availableEquipment, sessionDuration, preferredWorkoutTime, medicalConditions,
onboardingCompleted, isActive, isEmailVerified, role, profilePicture, lastLogin,
loginAttempts, emailVerification*, passwordReset*, xp, level, streak, badges,
lastWorkoutDate, running_xp, running_level, running_streak, running_badges,
lastRunDate, completed_challenges, createdAt, updatedAt, __v`.

| Source | → target | Disposition |
|---|---|---|
| `_id` | `users.legacy_mongo_id` (hex) | XFORM; id=UUIDv5 |
| `email` | `users.email` (citext) | MAP |
| `password` | `users.password_hash` + `hash_algo='bcrypt'` | MAP (bcrypt preserved) |
| `fullName` | `users.display_name` (NOT NULL) | XFORM (fallback = email local-part if empty) |
| `weight {value,unit}` | `users.weight_kg` | XFORM lbs→kg (`normalize_weight_kg`) |
| `lastLogin` | `users.last_active_at` | MAP |
| `streak`,`lastWorkoutDate`,`badges`,`xp`,`level`,`running_*`,`completed_challenges` | `streaks` / `user_achievements` | **RECOMPUTE** from migrated history (§7:882-884) — NOT trusted from Mongo |
| `age,gender,height,fitnessLevel,fitnessGoals,exerciseFrequency,availableEquipment,sessionDuration,preferredWorkoutTime,medicalConditions,onboardingCompleted,targetWeight,profilePicture` | *(no columns)* | **DROP** (no target; the queued onboarding-storage gap) |
| `googleId`,`authProvider` | *(no oauth table)* | RULING — OAuth identity not in P2.1 |
| `role`,`isEmailVerified`,`isActive` | *(no columns)* | DROP / status='active' (RULING) |
| `emailVerification*`,`passwordReset*`,`loginAttempts`,`createdAt`,`updatedAt`,`__v` | — | NOT-MIGRATED (transient / row gets own created_at) |
| — | `locale,units,timezone,leaderboard_opt_out` | defaults 'en'/'metric'/null/false |

## 2. `workout_sessions` (230) → `workouts` + `workout_sets`
Real session keys: `_id, user_id, exercises, completed, calories_burned,
duration_minutes, active_seconds, form_accuracy, started_at, completed_at, notes`.
**VERIFIED — `exercises[]` (max 3/session) items are PRESCRIPTIONS:**
`{id, name, category?, sets, reps, rest}` (some carry the full denormalized
exercise doc). **0 of 230 have any per-set actual performance.**

**`workouts` (parent):** `started_at`→`started_at`; `completed_at`→`ended_at`;
`duration_minutes`×60000→`duration_ms`; `form_accuracy`→`avg_form_score`;
`calories_burned`→`kcal_point` (**G-kcal**: `active_seconds_by_exercise` is NOT
stored → the §7 per-exercise MET recompute is impossible → keep stored value,
`kcal_calc_version=0`); `platform='web'`, `engine_version='legacy-py'`,
`bundle_version=0`; `sets_count`/`total_reps` derived from the unroll;
`quality_flags={}`; `notes`→DROP. (`workouts` has NO `legacy_mongo_id` column —
traceability via UUIDv5 only; **RULING** confirm or add column.)

**`workout_sets` (unroll):** each `exercises[]` item with prescribed `sets=N`
→ **N rows**, `set_index=0..N-1`, `reps`=prescribed reps, `started_at`=session
start, `engine_version='legacy-py'`, `definition_version=0`. **All rich engine
columns NULL** (no legacy source): `view, mode, hold_ms, rep_scores,
fault_counts({}), avg_form_score, tempo_ms_avg, rom_stats, calibration`.
`exercise_id` ← item `name`→slug→id via §8 seed name-match (**G-exid**: unmatched
name fallback — drop set? — RULING; note legacy exercises=58 == new count, so
match rate should be high). Embedded items have no `_id` → id=`UUIDv5(ns,
sessionHex:set_index)` (**G-subid**, confirm).

## 3. `workout_templates` (0) → `workout_templates`
**0 rows — nothing to migrate.** (Code path documented; script handles empty.)

## 4. `meal_logs` (16) → `meal_logs`
Real keys: `_id,user_id,meal_type,food_name,quantity,kcal,protein_g,carbs_g,
fat_g,fiber_g,notes,consumed_at,created_at`.
`consumed_at`→`taken_at`; `food_name`→`meal_name`+one `items[]`; `kcal`→`kcal_point`,
`kcal_low=round(kcal*0.7)`/`kcal_high=round(kcal*1.3)` (§7 ±30% band);
`protein_g/carbs_g/fat_g`→totals+item; fixed `confirmed=true, origin='manual',
portion_source='legacy', nutrition_sources={legacy_model}, calc_version=0`.
`fiber_g`,`meal_type`,`notes`,`quantity`→ no target (**RULING** drop vs fold).

## 5. `coach_conversations` (11) → `coach_threads` + `coach_messages`
Real keys: `_id,user_id,title,messages,created_at,updated_at`. `messages[]` =
`{role,content,timestamp}`.
Thread: `_id`→`legacy_mongo_id`, `title`→`title`, `updated_at`→`last_message_at`.
Each message → a `coach_messages` row: `role`→`role`, `content`→`content`,
`timestamp`→`created_at`, `model/tokens_*/cost_micro`=NULL (§7:898). No `_id` →
id=`UUIDv5(ns, convHex:index)` (**G-subid**).

## 6. `body_measurements` (1) → `body_measurements`
Real keys: `_id,user_id,measured_at,weight_kg,waist_cm,chest_cm,hips_cm,
left_arm_cm,right_arm_cm,left_thigh_cm,right_thigh_cm,body_fat_pct,created_at`.
`measured_at`→`measured_at`; `weight_kg`→`weight_kg`; all `*_cm`/`body_fat_pct`
→`metrics` jsonb; `source='manual'`. The legacy PROFILE weight (§1) becomes one
`self_reported` row for a user none of whose measurements carries a weight; the
history is the one source of weight and there is no users column (RULINGS 2026-09-10).

## 7. `running_*` → `runs` / `saved_routes` / `run_schedules`
- **`running_sessions` (8) → `runs`**: `started_at`; `duration_min`×60→`duration_s`;
  `distance_km`×1000→`distance_m`; `path`→`polyline` (**G-poly**: encode array→polyline vs JSON); `splits`→`splits`; `calories_burned`→`kcal_point`; `avg_pace_sec_km`/`elevation_gain_m`/`route_id`/`schedule_id`/`target_km`→DROP; `source='mobile'`.
- **`running_routes` (17) → `saved_routes`**: `label`→`name`; `coords`→`polyline` (G-poly); `distance_km`×1000→`distance_m`; `score`/`elevation_gain_m`/`source`→DROP.
- **`running_schedules` (1) → `run_schedules`**: flat `scheduled_at/recurrence/weekdays/route_id/lat/lng/note/target_km/status`→`rule` jsonb. **BLOCKED (G-rule)** — `run_schedules.rule` shape still unspecified (P2.6b deferral).

## 8. NOT migrated (§7:904-909)
`exercises` (58 — re-seeded §8, legacy_mongo_id name-match) · Chroma · predictions
· sessions/JWTs (re-login) · Redis counters.

---

## Rulings still owed for the P2.7b build (data-informed defaults proposed)
Since production starts clean, these govern only the verification migration —
lower stakes, but the script must decide each. Proposed defaults for batch approval:
- **G-kcal:** keep stored `calories_burned`, `kcal_calc_version=0` (per-exercise recompute impossible — input not stored).
- **G-exid:** unmatched legacy exercise name → skip that set, log it (don't fail the workout).
- **G-subid:** embedded sets & messages → id = `UUIDv5(ns, parentHex:index)`.
- **G-onboard / G-users-misc:** drop onboarding + role/isEmailVerified/profilePicture; `isActive=false`→ status stays 'active'.
- **G-oauth:** `googleId` → drop for now (no OAuth table until it's built); queue.
- **G-mealtype/G-fiber:** drop `meal_type`/`fiber_g`/`notes`/`quantity` (no target).
- **G-workouts-legacyid:** accept UUIDv5-only traceability for `workouts` (no column added) OR a tiny migration — RULING.
- **G-poly:** running `path`/`coords` → store as JSON-text passthrough in `polyline` (no encoder invented).
- **G-rule:** `run_schedules.rule` jsonb shape — the one true blocker; needs a shape ruling (or defer running_schedules, n=1).
