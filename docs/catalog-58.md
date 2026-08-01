# The 58-exercise catalog — REVIEWED CONSTANTS TABLE

**Status: SIGNED OFF by Kd and SEEDED, 2026-08-01 (DECISIONS :3538).** Both open
rows were ruled by Kd (F11 each). The authoritative copy of this table now lives
in `packages/shared/src/exerciseCatalog.ts` (`CATALOG_58`), which the API seeds
from and the web resolves names through; **if this document and that file ever
disagree, the file wins and this document is the thing to fix.** Live DB verified
at 58 rows. Built 2026-08-01 for the card that seeds the
new API's `exercises` table (DECISIONS :3424 — catalog before the web write
path). Nothing here is derived from memory or judgment; every column has one
named source, and the two rows where the spec does not answer are marked ⚠ and
left for Kd (R0.2 — never invent).

## Where each column comes from

| Column | Source |
|---|---|
| App name | `scripts/seed_exercises.py` — the canonical library. Part 2 §6:721 makes this the system of record: "seeds **exactly 58 exercises** into Mongo — matching your dashboard count". |
| Code name (slug) | The Part 2 §6 exercise name, lowercased, spaces and hyphens → `_`. **Not invented:** this rule reproduces all 11 slugs the migration already expects (`tools/migrate-mongo/exerciseNames.ts`) — see the cross-check below. |
| Family | Part 2 §6, per row. Family names from Part 2 §5. |
| Tier | Part 2 §6 — T1 the demo dozen (12), T2 next 17, T3 remaining 29. |
| MET | Part 2B Appendix A (§581-623), verbatim. ✱ = value preserved from `calories.py`, per the appendix's own mark. |
| Tracking | `pose` everywhere except Brisk Walking → `timer` (Part 4 §3.4:370-372, ruled). |
| Status | `live` everywhere, including Mountain Pose (Part 4 §3.4:366-369, ruled: "the `REMOVED_EXERCISES` frontend hack dies with the migration"). |

`name_key` = `exercise.<slug>` throughout (the convention set at DECISIONS
2026-07-10). `difficulty`, `equipment`, `muscles` stay NULL — nullable in the
Part 4 §3.4 DDL, read by nothing today, and they belong to the separate
"exercise library content" OWED line.

**The 12 families (Part 2 §5):** F1 squat_pattern · F2 hinge · F3 bridge_supine ·
F4 lunge_split · F5 push_horizontal · F6 push_vertical · F7 pull ·
F8 isolation_single_joint · F9 core_dynamic · F10 hold_isometric ·
F11 cadence_conditioning · F12 mobility_hold_flow.

---

## The two rows the spec does not answer — RULED BY KD 2026-08-01

Both were put to Kd as SPEC GAPs (R0.2) with a recommendation; he chose the
recommended option in both cases. **Both are `F11` (cadence_conditioning).**

1. **Brisk Walking has no family.** Part 2 §6:858-864 describes it only as
   "the catalog's one non-camera entry … no pose definition", and the column is
   NOT NULL with a CHECK of F1–F12. A family is a *pose-analysis* template, so
   for the one exercise that will never have a pose definition the value is
   inert bookkeeping — but a value is required.
   **RULED: F11 (cadence_conditioning)** — the family its actual movement
   belongs to, and where jogging in place / high knees already sit. No
   definition will ever be authored under it.
2. **Arm Circles is given TWO families.** Part 2 §6:851-854 says "F11/F8
   hybrid", and the column takes one.
   **RULED: F11** — the same sentence says "Mode D cadence", and Mode D is
   F11's counting mode (Part 2 §5).

## Cross-check against the migration's frozen table — 11/11 agree

`tools/migrate-mongo/exerciseNames.ts` already names the slug it expects this
card to seed, and its header says it is "the single reconciliation point" if
this card chooses differently. It does not have to be touched:
`squat` · `jump_squat` · `chair_squat` · `glute_bridge` · `bicep_curl` ·
`bulgarian_split_squat` · `calf_raises` · `bicycle_crunch` · `arm_circles` ·
`bench_press` · `brisk_walking` — **all 11 produced by the rule above.**
(Note the table is not uniformly plural or singular — `bicep_curl` but
`calf_raises` — because Part 2 §6 is not; the spec's own naming is followed
rather than smoothed.)

## Three code names that read oddly, and why

The rule takes the SPEC's name, which occasionally differs from the app's label
by more than formatting. Flagged rather than silently smoothed — say the word
and I'll use the app's wording instead:

| App shows | Code name | Why |
|---|---|---|
| Jump Lunges | `lunge_jump` | Part 2 §6 Tier 2 calls it "lunge jump" (word order reversed). |
| Superman Hold | `superman` | Part 2 §6 Tier 2 calls it "superman". |
| Cobra Pose | `cobra` | Part 2 §6 Tier 3 mobility list calls it "cobra". |

Formatting conventions applied: apostrophes dropped (`childs_pose`,
`worlds_greatest_stretch`); roman numerals lowercased (`warrior_i`,
`warrior_ii`).

---

## Tier 1 — the demo dozen (12)

| # | App name | Code name | Family | Tier | MET |
|---|---|---|---|---|---|
| 1 | Squats | `squat` | F1 | T1 | 6.0✱ |
| 2 | Chair Squats | `chair_squat` | F1 | T1 | 5.0✱ |
| 3 | Jump Squats | `jump_squat` | F1 | T1 | 8.0 |
| 4 | Push-ups | `push_up` | F5 | T1 | 8.0✱ |
| 5 | Wall Push-ups | `wall_push_up` | F5 | T1 | 3.5 |
| 6 | Lunges | `lunge` | F4 | T1 | 6.0✱ |
| 7 | Glute Bridge | `glute_bridge` | F3 | T1 | 3.5 |
| 8 | Plank | `plank` | F10 | T1 | 3.0✱ |
| 9 | Wall Sit | `wall_sit` | F10 | T1 | 3.5 |
| 10 | Bicep Curls | `bicep_curl` | F8 | T1 | 3.5✱ |
| 11 | Shoulder Press | `shoulder_press` | F6 | T1 | 3.5✱ |
| 12 | High Knees | `high_knees` | F11 | T1 | 8.0 |

## Tier 2 — next 17

| # | App name | Code name | Family | Tier | MET |
|---|---|---|---|---|---|
| 13 | Deadlifts | `deadlift` | F2 | T2 | 5.0 |
| 14 | Hip Thrust | `hip_thrust` | F3 | T2 | 4.0 |
| 15 | Bulgarian Split Squat | `bulgarian_split_squat` | F4 | T2 | 6.0 |
| 16 | Step-ups | `step_up` | F4 | T2 | 6.5 |
| 17 | Calf Raises | `calf_raises` | F8 | T2 | 3.5 |
| 18 | Crunches | `crunch` | F9 | T2 | 3.8 |
| 19 | Leg Raises | `leg_raises` | F9 | T2 | 3.8 |
| 20 | Mountain Climbers | `mountain_climber` | F11 | T2 | 8.0 |
| 21 | Jumping Jacks | `jumping_jack` | F11 | T2 | 8.0 |
| 22 | Superman Hold | `superman` | F9 | T2 | 3.0 |
| 23 | Side Plank | `side_plank` | F10 | T2 | 3.0 |
| 24 | Tricep Dips | `tricep_dips` | F6 | T2 | 4.0 |
| 25 | Lateral Raises | `lateral_raises` | F8 | T2 | 3.5 |
| 26 | Russian Twists | `russian_twist` | F9 | T2 | 3.8 |
| 27 | Tricep Extensions | `tricep_extension` | F8 | T2 | 3.5 |
| 28 | Jump Lunges | `lunge_jump` | F4 | T2 | 8.0 |
| 29 | Skipping Rope | `skipping_rope` | F11 | T2 | 11.0 |

## Tier 3 — remaining 29

| # | App name | Code name | Family | Tier | MET |
|---|---|---|---|---|---|
| 30 | Pull-ups | `pull_up` | F7 | T3 | 8.0 |
| 31 | Bench Press | `bench_press` | F5 | T3 | 3.5 |
| 32 | Pike Push-ups | `pike_push_up` | F6 | T3 | 8.0 |
| 33 | Resistance Band Pull | `resistance_band_pull` | F7 | T3 | 3.5 |
| 34 | Burpees | `burpees` | F11 | T3 | 8.0 |
| 35 | Plank Jacks | `plank_jack` | F11 | T3 | 7.0 |
| 36 | Skater Jumps | `skater_jump` | F11 | T3 | 7.0 |
| 37 | Tuck Jumps | `tuck_jump` | F11 | T3 | 8.0 |
| 38 | Jogging in Place | `jogging_in_place` | F11 | T3 | 8.0 |
| 39 | Flutter Kicks | `flutter_kick` | F9 | T3 | 4.0 |
| 40 | Bicycle Crunch | `bicycle_crunch` | F9 | T3 | 4.0 |
| 41 | Seated Leg Raises | `seated_leg_raise` | F9 | T3 | 3.0 |
| 42 | Heel Raises | `heel_raise` | F8 | T3 | 3.0 |
| 43 | Arm Circles | `arm_circles` | F11 | T3 | 2.8 |
| 44 | Mountain Pose | `mountain_pose` | F12 | T3 | 2.3 |
| 45 | Brisk Walking | `brisk_walking` | F11 | T3 | 3.8 |
| 46 | Cat-Cow Stretch | `cat_cow` | F12 | T3 | 2.5 |
| 47 | Child's Pose | `childs_pose` | F12 | T3 | 2.3 |
| 48 | Cobra Pose | `cobra` | F12 | T3 | 2.5 |
| 49 | Downward Dog | `downward_dog` | F12 | T3 | 3.0 |
| 50 | Bridge Pose | `bridge_pose` | F12 | T3 | 2.5 |
| 51 | Hamstring Stretch | `hamstring_stretch` | F12 | T3 | 2.5 |
| 52 | Hip Flexor Stretch | `hip_flexor_stretch` | F12 | T3 | 2.5 |
| 53 | Seated Forward Bend | `seated_forward_bend` | F12 | T3 | 2.5 |
| 54 | Shoulder Stretch | `shoulder_stretch` | F12 | T3 | 2.5 |
| 55 | World's Greatest Stretch | `worlds_greatest_stretch` | F12 | T3 | 3.0 |
| 56 | Tree Pose | `tree_pose` | F12 | T3 | 3.0 |
| 57 | Warrior I | `warrior_i` | F12 | T3 | 3.0 |
| 58 | Warrior II | `warrior_ii` | F12 | T3 | 3.0 |

**Row 45 is the only `tracking: 'timer'` row** (Part 4 §3.4:370). Every other
row is `tracking: 'pose'`. All 58 are `status: 'live'`.

## Counts, and how they were checked

- 12 + 17 + 29 = **58**, matching Part 2 §6:885's own coverage check ("every
  seeded exercise mapped, zero open slots").
- The library list is **58** names (`grep -c '^        "name":'
  scripts/seed_exercises.py`), each appearing exactly once above.
- Part 2B Appendix A's seven MET bands total 14+4+6+16+4+13+1 = **58**, each
  name consumed exactly once above.
- The visible library is **56** — Part 2 §6:889: the frontend's
  `REMOVED_EXERCISES` hides Mountain Pose and Brisk Walking. Both are seeded
  `live` here per the Part 4 §3.4 ruling.
- `arnold_shoulder_press` is **absent by ruling**, not by omission (Part 4
  §3.4:373 — "stays unseeded — first expansion candidate").
