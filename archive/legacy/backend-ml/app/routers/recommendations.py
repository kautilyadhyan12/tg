"""
Phase 8 — AI Recommendations
Hybrid recommender: content-based now, upgrades to Neural CF as history grows.
"""

from fastapi import APIRouter, Depends, Query
from app.db.mongo import get_db
from app.core.security import get_current_user
from app.core.logging import get_logger

log = get_logger(__name__)
router = APIRouter(prefix="/recommendations", tags=["Recommendations"])


# ── Goal → category mapping ───────────────────────────────────────────────────
GOAL_CATEGORIES = {
    "weight_loss":     ["Cardio", "HIIT", "Endurance & Stamina"],
    "muscle_gain":     ["Strength Training", "Upper Body", "Lower Body"],
    "flexibility":     ["Yoga", "Flexibility & Mobility", "Rehabilitation"],
    "general_fitness": ["Bodyweight Exercises", "Cardio", "Core & Abs"],
    "endurance":       ["Cardio", "Endurance & Stamina", "HIIT"],
    "stress_relief":   ["Yoga", "Flexibility & Mobility"],
    "core_strength":   ["Core & Abs", "Bodyweight Exercises", "Strength Training"],
}

# ── Fitness level → allowed difficulty ───────────────────────────────────────
LEVEL_DIFFICULTY = {
    "beginner":     ["beginner"],
    "intermediate": ["beginner", "intermediate"],
    "advanced":     ["beginner", "intermediate", "advanced"],
}

# ── Equipment → exercise equipment tags ──────────────────────────────────────
EQUIPMENT_MAP = {
    "none":        ["No Equipment", "Bodyweight"],
    "dumbbells":   ["Dumbbells", "No Equipment", "Bodyweight"],
    "bands":       ["Resistance Bands", "No Equipment", "Bodyweight"],
    "kettlebells": ["Kettlebells", "No Equipment", "Bodyweight"],
    "pullup_bar":  ["Pull-up Bar", "No Equipment", "Bodyweight"],
    "barbell":     ["Barbell", "No Equipment"],
    "machine":     ["Machine", "Dumbbells", "No Equipment"],
}


def _as_list(value, default=None):
    """Ensure value is a list. Handles None, string, or list."""
    if value is None:
        return default if default is not None else []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return value
    return default if default is not None else []


def score_exercise(exercise: dict, user: dict, done_ids: set) -> float:
    """
    Score a single exercise for a user. Higher = better match.
    Returns 0.0 - 100.0
    """
    score = 0.0

    goals     = _as_list(user.get("fitnessGoals"), [])
    level     = user.get("fitnessLevel") or "beginner"
    equipment = _as_list(user.get("availableEquipment"), ["none"])
    duration  = user.get("sessionDuration") or 30

    ex_cats       = _as_list(exercise.get("categories"), [])
    ex_difficulty = (exercise.get("difficulty") or "beginner").lower()
    ex_equipment  = _as_list(exercise.get("equipment"), [])
    ex_duration   = exercise.get("duration_seconds") or 60

    # ── 1. Goal match (40 points) ─────────────────────────────────────────────
    preferred_cats = set()
    for goal in goals:
        preferred_cats.update(GOAL_CATEGORIES.get(goal, []))

    cat_matches = len(set(ex_cats) & preferred_cats)
    score += min(cat_matches * 20, 40)

    # ── 2. Difficulty match (20 points) ───────────────────────────────────────
    allowed_difficulties = LEVEL_DIFFICULTY.get(level, ["beginner"])
    if ex_difficulty in allowed_difficulties:
        if ex_difficulty == level:
            score += 20
        else:
            score += 10

    # ── 3. Equipment match (20 points) ────────────────────────────────────────
    allowed_equipment = set()
    for eq in equipment:
        allowed_equipment.update(EQUIPMENT_MAP.get(eq, []))
    allowed_equipment.update(["No Equipment", "Bodyweight"])

    if any(eq in allowed_equipment for eq in ex_equipment):
        score += 20

    # ── 4. Duration fit (10 points) ───────────────────────────────────────────
    try:
        target_ex_duration = (duration * 60) / 6
        duration_diff      = abs(ex_duration - target_ex_duration)
        score += max(0, 10 - (duration_diff / 30))
    except Exception:
        pass

    # ── 5. Variety bonus (5 points) ───────────────────────────────────────────
    if str(exercise.get("_id", "")) not in done_ids:
        score += 5

    # ── 6. AI support bonus (5 points) ────────────────────────────────────────
    if exercise.get("ai_supported"):
        score += 5

    return round(score, 2)


@router.get("")
async def get_recommendations(
    limit:        int = Query(6, ge=1, le=20),
    current_user: dict = Depends(get_current_user),
):
    """
    Get personalised exercise recommendations for the current user.
    Uses content-based filtering on onboarding profile.
    Falls back to popular exercises if profile is incomplete.
    """
    try:
        db      = get_db()
        user_id = current_user["_id"]

        user = await db.users.find_one({"_id": user_id})
        if not user:
            return {"success": True, "recommendations": [], "method": "none"}

        # Exercises user has already done (for variety scoring)
        past_sessions = await db.workout_sessions.find(
            {"user_id": user_id, "completed": True},
            {"exercises": 1}
        ).sort("completed_at", -1).limit(10).to_list(10)

        done_ids = set()
        for session in past_sessions:
            for ex in session.get("exercises", []):
                if isinstance(ex, dict) and ex.get("id"):
                    done_ids.add(str(ex["id"]))

        has_profile = bool(
            user.get("fitnessGoals") or
            user.get("fitnessLevel") or
            user.get("availableEquipment")
        )

        exercises = await db.exercises.find({"is_active": True}).to_list(200)
        if not exercises:
            return {"success": True, "recommendations": [], "method": "none"}

        if not has_profile:
            exercises.sort(
                key=lambda x: (x.get("rating") or 0) + (x.get("times_used") or 0) * 0.1,
                reverse=True
            )
            top    = exercises[:limit]
            method = "popular"
        else:
            scored = [(ex, score_exercise(ex, user, done_ids)) for ex in exercises]
            scored.sort(key=lambda x: x[1], reverse=True)
            top    = [ex for ex, _ in scored[:limit]]
            method = "personalised"

        def serialize(ex):
            ex["id"] = str(ex.pop("_id"))
            return ex

        return {
            "success":         True,
            "recommendations": [serialize(ex) for ex in top],
            "method":          method,
            "based_on": {
                "goals":     _as_list(user.get("fitnessGoals"), []),
                "level":     user.get("fitnessLevel") or "",
                "equipment": _as_list(user.get("availableEquipment"), []),
            },
        }
    except Exception as e:
        import traceback
        log.exception("Recommendations error: %s", e)
        traceback.print_exc()
        return {"success": False, "recommendations": [], "method": "error", "error": str(e)}