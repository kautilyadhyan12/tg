"""
Calorie estimation for workout sessions.

Replaces the old flat `minutes * 6` placeholder with a real MET-based
estimate. This is still an ESTIMATE, not a measurement — no consumer app can
know true energy expenditure without a heart-rate monitor or metabolic cart —
but it now accounts for the two things that actually move the number the
most: the person's own body weight, and how much of the session was active
exercise versus standing around resting between sets.

── Method ───────────────────────────────────────────────────────────────────
Standard MET formula (Compendium of Physical Activities; this exact form is
also used in CDC/ACSM patient handouts):

    calories = MET * weight_kg * duration_hours

Equivalently, per minute: calories = (MET * 3.5 * weight_kg * minutes) / 200
(3.5 ml O2/kg/min is the standardized resting reference 1 MET is defined
against). Both forms are algebraically identical; we use the simpler one.

Session calories = (active_seconds at the exercise's MET)
                  + (rest_seconds at a resting/light MET)
so that someone who paused for a long rest isn't credited as if they kept
exercising the whole time, and someone who rested very little isn't
shortchanged either.

── Sourcing for MET values ────────────────────────────────────────────────
2024 Adult Compendium of Physical Activities (the standard academic
reference for this exact purpose):
  - Resistance training, squats/deadlifts, slow or explosive effort: 5.0 MET
  - Circuit training, body weight exercises (continuous, minimal rest,
    e.g. a bodyweight squat SET with no rest between reps): 6.0 MET
  - Calisthenics (push-ups, sit-ups, pull-ups, jumping jacks, burpees),
    vigorous effort: 8.0 MET
  - Resting/standing quietly between sets: ~1.3-1.5 MET (sedentary/light
    range per the Compendium's own sedentary-behavior classification)

We use the bodyweight circuit-training value (6.0) as the default for
exercises done continuously without external load, since that's the closer
match for how this app's sets are actually performed (back-to-back reps,
no rest within a set) rather than the loaded-barbell-with-rest-between-reps
scenario the 5.0 value describes. Per-exercise overrides below are used
where a more specific Compendium entry applies.

IMPORTANT — explicitly NOT done here, to avoid inventing precision that
doesn't exist: no adjustment for rep speed, depth, or form quality (the
Compendium MET values are themselves broad bands, not regression
coefficients — multiplying by a guessed "intensity factor" derived from
form_score would add a second layer of invented numbers on top of an
already-approximate base, not improve accuracy). No age/sex-based RMR
correction (Kozey et al.'s correction lowers/raises the standard MET based
on individual RMR, but that requires lab-grade body composition data we
don't have — using the *standard* MET, as the Compendium itself recommends
for population-level estimation, is the defensible choice here).
"""

# MET values by exercise name (lowercase, matching how exercise names are
# normalized elsewhere in this app, e.g. form_analyzer.py's exercise_key).
# Source: 2024 Adult Compendium of Physical Activities (see module docstring).
EXERCISE_MET = {
    "squat":                 6.0,  # bodyweight circuit-style, continuous reps
    "squats":                6.0,
    "chair_squat":           5.0,  # slower, less continuous — closer to the
    "chair_squats":          5.0,  # loaded-squat Compendium entry (5.0)
    "push_up":               8.0,  # calisthenics, vigorous effort
    "push_ups":              8.0,
    "lunge":                 6.0,
    "lunges":                6.0,
    "plank":                 3.0,  # isometric hold, not the same energy cost
    "planks":                3.0,  # as repeated dynamic movement
    "bicep_curl":            3.5,  # resistance training, multiple exercises,
    "bicep_curls":           3.5,  # 8-15 reps at varied resistance (Compendium)
    "shoulder_press":        3.5,
    "arnold_shoulder_press": 3.5,
}

# Fallback for any exercise not in the table above: general moderate
# bodyweight conditioning exercise, per Compendium's "circuit training,
# moderate effort" entry.
DEFAULT_EXERCISE_MET = 5.0

# Resting between sets: standing/light movement, not lying down — closer to
# the Compendium's light-intensity band (1.6-2.9 MET) than true sedentary
# (1.0-1.5 MET), since the person is typically standing, not seated.
REST_MET = 1.8

# Population-average adult body weight (kg), used ONLY when a user hasn't
# entered their own weight. This is a coarse fallback, not a target — every
# user who provides their real weight gets a number specific to them.
# Source: CDC NHANES 2015-2018 mean adult body weight (combined sexes, US
# population) is approximately 81 kg; we use a slightly more conservative
# 70 kg as a generic cross-population default to avoid overestimating for
# users from regions/contexts with a lower population-average body weight
# than the US figure, since this app has no way to know the user's region
# when weight is missing.
DEFAULT_WEIGHT_KG = 70.0

KG_PER_LB = 0.453592


def normalize_weight_kg(weight_field) -> float:
    """
    weight_field: the user's stored `weight` dict, e.g. {"value": 154, "unit": "lb"}
    or {"value": 70, "unit": "kg"}, or None if never entered.

    Returns weight in kg, falling back to DEFAULT_WEIGHT_KG if missing,
    malformed, or non-positive (a 0 or negative value is obviously not a
    real measurement and would make the calorie estimate meaningless or
    negative, so we treat it the same as missing).
    """
    if not weight_field or not isinstance(weight_field, dict):
        return DEFAULT_WEIGHT_KG

    try:
        value = float(weight_field.get("value"))
    except (TypeError, ValueError):
        return DEFAULT_WEIGHT_KG

    if value <= 0:
        return DEFAULT_WEIGHT_KG

    unit = (weight_field.get("unit") or "kg").lower()
    if unit in ("lb", "lbs", "pound", "pounds"):
        return value * KG_PER_LB
    return value  # assume kg for any other/unrecognized unit


def get_exercise_met(exercise_name: str) -> float:
    """Look up the MET value for an exercise name, with a sensible fallback."""
    if not exercise_name:
        return DEFAULT_EXERCISE_MET
    key = exercise_name.lower().strip().replace(" ", "_").replace("-", "_")
    return EXERCISE_MET.get(key, DEFAULT_EXERCISE_MET)


def estimate_session_calories(
    weight_kg: float,
    active_seconds_by_exercise: dict,
    rest_seconds: float = 0.0,
) -> float:
    """
    weight_kg: the user's body weight in kg (already normalized — see
        normalize_weight_kg above).
    active_seconds_by_exercise: dict mapping exercise name -> seconds of
        ACTIVE time (phase == 'workout' in the frontend, i.e. excluding
        rest) spent on that exercise during the session. Different
        exercises can have different MET values, so this needs to be
        broken out per exercise rather than a single total.
    rest_seconds: total seconds spent resting between sets/exercises during
        the session (phase == 'rest' in the frontend).

    Returns estimated total calories burned (float, NOT rounded — caller
    decides display precision).
    """
    if weight_kg is None or weight_kg <= 0:
        weight_kg = DEFAULT_WEIGHT_KG

    total_calories = 0.0

    for exercise_name, seconds in (active_seconds_by_exercise or {}).items():
        if not seconds or seconds <= 0:
            continue
        met = get_exercise_met(exercise_name)
        hours = seconds / 3600.0
        total_calories += met * weight_kg * hours

    if rest_seconds and rest_seconds > 0:
        hours = rest_seconds / 3600.0
        total_calories += REST_MET * weight_kg * hours

    return total_calories
