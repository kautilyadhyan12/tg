from datetime import datetime, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.core.security import get_current_user, invalidate_user_cache
from app.db.mongo import get_db

log = get_logger(__name__)
router = APIRouter(prefix="/workouts", tags=["Workouts"])

# Hard caps so no client can bloat documents or dump collections
_MAX_EXERCISES_PER_SESSION = 30
_MAX_TEMPLATES_PER_USER = 50
_MAX_NOTES_LEN = 2000


def serialize(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    if "user_id" in doc:
        doc["user_id"] = str(doc["user_id"])
    return doc


# ── Request models (replaces raw dicts — bounds stop fake-XP and DB bloat) ───
class CreateSessionRequest(BaseModel):
    exercises: list = Field(default_factory=list, max_length=_MAX_EXERCISES_PER_SESSION)
    notes: str = Field(default="", max_length=_MAX_NOTES_LEN)


class CompleteSessionRequest(BaseModel):
    duration_minutes: float = Field(default=0, ge=0, le=600)
    form_accuracy: float = Field(default=0, ge=0, le=100)
    active_seconds: float = Field(default=0, ge=0, le=36000)
    rest_seconds: float = Field(default=0, ge=0, le=36000)
    active_seconds_by_exercise: dict[str, float] = Field(default_factory=dict)
    exercises: Optional[list] = Field(default=None, max_length=_MAX_EXERCISES_PER_SESSION)


class TemplateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    exercises: list = Field(min_length=1, max_length=_MAX_EXERCISES_PER_SESSION)


@router.get("/stats")
async def get_user_stats(current_user: dict = Depends(get_current_user)):
    """Dashboard stats — one $facet aggregation + one find instead of six
    sequential round-trips (this is the hottest read in the app)."""
    db = get_db()
    user_id = current_user["_id"]

    now = datetime.utcnow()
    week_start = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    seven_days_ago = now - timedelta(days=7)

    facets = await db.workout_sessions.aggregate([
        {"$match": {"user_id": user_id, "completed": True}},
        {"$facet": {
            "totals": [
                {"$group": {
                    "_id": None,
                    "count":    {"$sum": 1},
                    "calories": {"$sum": "$calories_burned"},
                    "minutes":  {"$sum": "$duration_minutes"},
                }}
            ],
            "weekly": [
                {"$match": {"completed_at": {"$gte": week_start}}},
                {"$count": "count"},
            ],
            "recent_days": [
                {"$match": {"completed_at": {"$gte": seven_days_ago}}},
                {"$project": {"completed_at": 1}},
            ],
        }},
    ]).to_list(1)

    totals = (facets[0]["totals"] or [{}])[0] if facets else {}
    weekly = facets[0]["weekly"][0]["count"] if facets and facets[0]["weekly"] else 0

    activity = {}
    for s in (facets[0]["recent_days"] if facets else []):
        if s.get("completed_at"):
            activity[s["completed_at"].strftime("%Y-%m-%d")] = True

    recent = await db.workout_sessions.find(
        {"user_id": user_id, "completed": True},
    ).sort("completed_at", -1).limit(5).to_list(5)

    return {
        "success": True,
        "stats": {
            "total_workouts":  totals.get("count", 0),
            "total_calories":  round(totals.get("calories", 0) or 0),
            "total_minutes":   round(totals.get("minutes", 0) or 0),
            "weekly_workouts": weekly,
            "streak":          current_user.get("streak", 0),
            "level":           current_user.get("level", 1),
            "xp":              current_user.get("xp", 0),
        },
        "activity":        activity,
        "recent_workouts": [serialize(s) for s in recent],
    }


@router.post("")
async def create_workout_session(
    body: CreateSessionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Start a new workout session."""
    db = get_db()

    session = {
        "user_id":          current_user["_id"],
        "exercises":        body.exercises,
        "completed":        False,
        "calories_burned":  0,
        "duration_minutes": 0,
        "form_accuracy":    0,
        "started_at":       datetime.utcnow(),
        "completed_at":     None,
        "notes":            body.notes,
    }

    result = await db.workout_sessions.insert_one(session)
    session["id"] = str(result.inserted_id)
    session.pop("_id", None)
    session["user_id"] = str(session["user_id"])

    return {"success": True, "session": session}


@router.patch("/{session_id}/complete")
async def complete_workout(
    session_id: str,
    body: CompleteSessionRequest,
    current_user: dict = Depends(get_current_user),
):
    """Mark a workout session as complete and update user stats.

    Idempotent: the update filter requires completed=False, so a double-tap
    or client retry can never award XP or bump the streak twice.
    """
    db = get_db()

    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session ID")

    session = await db.workout_sessions.find_one({
        "_id":     oid,
        "user_id": current_user["_id"],
    })
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    duration       = body.duration_minutes
    form_accuracy  = body.form_accuracy
    active_seconds = body.active_seconds

    # ── Calorie estimate (MET-based) ──────────────────────────────────────
    # Computed server-side (not trusting a client-sent number) because this
    # is where the user's stored body weight lives.
    # See app/ai/fitness/calories.py for the full method and sourcing.
    from app.ai.fitness.calories import estimate_session_calories, normalize_weight_kg

    weight_kg = normalize_weight_kg(current_user.get("weight"))

    if body.active_seconds_by_exercise:
        calories = round(estimate_session_calories(
            weight_kg=weight_kg,
            active_seconds_by_exercise=body.active_seconds_by_exercise,
            rest_seconds=body.rest_seconds,
        ))
    else:
        # Fallback for any client that hasn't sent the per-exercise timing
        # breakdown: treat the whole reported duration as active time on a
        # generic moderate-effort MET.
        calories = round(estimate_session_calories(
            weight_kg=weight_kg,
            active_seconds_by_exercise={"_unspecified": duration * 60},
            rest_seconds=0,
        ))

    update_result = await db.workout_sessions.update_one(
        {"_id": oid, "completed": False},   # ← idempotency guard
        {"$set": {
            "completed":        True,
            "calories_burned":  calories,
            "duration_minutes": duration,
            "active_seconds":   active_seconds,
            "form_accuracy":    form_accuracy,
            "exercises":        body.exercises if body.exercises is not None else session["exercises"],
            "completed_at":     datetime.utcnow(),
        }},
    )
    if update_result.modified_count == 0:
        # Already completed — return current state without re-awarding anything
        return {
            "success":    True,
            "xp_earned":  0,
            "streak":     current_user.get("streak", 0),
            "new_badges": [],
            "level_up":   False,
            "new_level":  current_user.get("level", 1),
            "message":    "Workout was already completed",
        }

    # ── Award XP ──────────────────────────────────────────────────────────
    from app.ai.gamification.badges import (
        XP_REWARDS, level_for_xp, check_badges, get_badge_by_id, TIER_XP,
    )

    xp_earned = XP_REWARDS["workout_completed"]   # Base: 50 XP
    if form_accuracy >= 100:
        xp_earned += XP_REWARDS["form_perfect_bonus"]    # +50
    elif form_accuracy >= 80:
        xp_earned += XP_REWARDS["form_excellent_bonus"]  # +20

    user_id = current_user["_id"]
    user = await db.users.find_one({"_id": user_id})
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    # Calculate streak
    last_workout   = user.get("lastWorkoutDate")
    today          = datetime.utcnow().date()
    current_streak = user.get("streak", 0)

    if last_workout:
        last_date = (
            last_workout.date()
            if hasattr(last_workout, "date")
            else last_workout
        )
        if last_date == today:
            pass  # already worked out today — no streak increment
        elif (today - last_date).days == 1:
            current_streak += 1
            xp_earned += XP_REWARDS["streak_day"]   # +10 for keeping streak alive
        else:
            current_streak = 1
    else:
        current_streak = 1

    new_total_xp = user.get("xp", 0) + xp_earned
    new_level    = level_for_xp(new_total_xp)

    await db.users.update_one(
        {"_id": user_id},
        {
            "$inc": {"xp": xp_earned},
            "$set": {
                "streak":          current_streak,
                "lastWorkoutDate": datetime.utcnow(),
                "level":           new_level,
            },
        },
    )

    # ── Check for newly-unlocked badges ───────────────────────────────────
    new_badges = set()
    try:
        from app.routers.gamification import compute_user_stats

        updated_user = await db.users.find_one({"_id": user_id})
        stats        = await compute_user_stats(db, user_id)

        earned_ids    = check_badges(stats)
        stored_badges = set(updated_user.get("badges", []))
        new_badges    = set(earned_ids) - stored_badges

        if new_badges:
            badge_xp = 0
            for bid in new_badges:
                b = get_badge_by_id(bid)
                if b:
                    badge_xp += TIER_XP.get(b["tier"], 50)

            final_xp    = new_total_xp + badge_xp
            final_level = level_for_xp(final_xp)

            await db.users.update_one(
                {"_id": user_id},
                {
                    "$set": {
                        "badges": list(stored_badges | new_badges),
                        "level":  final_level,
                    },
                    "$inc": {"xp": badge_xp},
                },
            )
            xp_earned += badge_xp
            new_level = final_level
    except Exception:
        log.exception("Badge check failed for user %s", user_id)

    # The auth layer caches the user doc for 60s — invalidate so the new
    # XP/streak/level shows up immediately on the next request.
    await invalidate_user_cache(user_id)

    return {
        "success":    True,
        "xp_earned":  xp_earned,
        "streak":     current_streak,
        "new_badges": [
            {**get_badge_by_id(bid), "xp_reward": TIER_XP.get(get_badge_by_id(bid)["tier"], 50)}
            for bid in new_badges if get_badge_by_id(bid)
        ],
        "level_up":   new_level > user.get("level", 1),
        "new_level":  new_level,
        "message":    "Workout completed!",
    }


@router.get("")
async def get_workout_list(
    limit: int = Query(default=10, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """Get user's workout history (bounded page size)."""
    db = get_db()
    sessions = await db.workout_sessions.find(
        {"user_id": current_user["_id"], "completed": True},
    ).sort("completed_at", -1).limit(limit).to_list(limit)

    return {
        "success":  True,
        "workouts": [serialize(s) for s in sessions],
    }


# NOTE: /history and /templates are declared BEFORE /{session_id}/summary is
# irrelevant for correctness here (different path shapes), but keeping literal
# paths grouped ahead of parameterized ones is safer if routes evolve.

@router.get("/history")
async def get_workout_history(
    month: Optional[int] = Query(default=None, ge=1, le=12),
    year:  Optional[int] = Query(default=None, ge=2020, le=2100),
    current_user: dict = Depends(get_current_user),
):
    """Workout sessions for a given month/year, grouped by date."""
    db = get_db()
    user_id = current_user["_id"]

    now   = datetime.utcnow()
    month = month or now.month
    year  = year or now.year

    first_day = datetime(year, month, 1)
    last_day  = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)

    sessions = await db.workout_sessions.find(
        {
            "user_id":      user_id,
            "completed":    True,
            "completed_at": {"$gte": first_day, "$lt": last_day},
        },
        {
            "completed_at":     1,
            "duration_minutes": 1,
            "calories_burned":  1,
            "form_accuracy":    1,
            "exercises":        1,
            "xp_earned":        1,
        },
    ).sort("completed_at", 1).to_list(200)

    by_date: dict[str, list] = {}
    for s in sessions:
        if not s.get("completed_at"):
            continue
        date_str = s["completed_at"].strftime("%Y-%m-%d")
        by_date.setdefault(date_str, []).append({
            "id":               str(s["_id"]),
            "completed_at":     s["completed_at"].isoformat(),
            "duration_minutes": s.get("duration_minutes", 0),
            "calories_burned":  round(s.get("calories_burned", 0)),
            "form_accuracy":    round(s.get("form_accuracy", 0)),
            "xp_earned":        s.get("xp_earned", 0),
            "exercise_count":   len(s.get("exercises", [])),
            "exercises": [
                {"name": e.get("name", ""), "primary_category": e.get("primary_category", "")}
                for e in s.get("exercises", [])[:5]   # Max 5 for preview
                if isinstance(e, dict)
            ],
        })

    return {
        "success": True,
        "month":   month,
        "year":    year,
        "by_date": by_date,
        "total":   len(sessions),
    }


# ── Workout Templates ────────────────────────────────────────────────────────

@router.post("/templates")
async def save_template(
    body: TemplateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Save current workout as a named template."""
    db = get_db()
    user_id = current_user["_id"]

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required")

    existing = await db.workout_templates.find_one({
        "user_id": user_id,
        "name":    name,
    })

    if existing:
        await db.workout_templates.update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "exercises":      body.exercises,
                "updated_at":     datetime.utcnow(),
                "exercise_count": len(body.exercises),
            }},
        )
        return {"success": True, "message": f"Template '{name}' updated", "updated": True}

    # Cap templates per user so storage can't be spammed
    count = await db.workout_templates.count_documents({"user_id": user_id})
    if count >= _MAX_TEMPLATES_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=f"Template limit reached ({_MAX_TEMPLATES_PER_USER}). Delete one first.",
        )

    template = {
        "user_id":        user_id,
        "name":           name,
        "exercises":      body.exercises,
        "exercise_count": len(body.exercises),
        "created_at":     datetime.utcnow(),
        "updated_at":     datetime.utcnow(),
        "times_used":     0,
    }
    result = await db.workout_templates.insert_one(template)

    return {
        "success":     True,
        "message":     f"Template '{name}' saved",
        "template_id": str(result.inserted_id),
        "updated":     False,
    }


@router.get("/templates")
async def get_templates(current_user: dict = Depends(get_current_user)):
    """Get all saved templates for the current user."""
    db = get_db()
    templates = await db.workout_templates.find(
        {"user_id": current_user["_id"]}
    ).sort("updated_at", -1).to_list(_MAX_TEMPLATES_PER_USER)

    def _serialize(t):
        t["id"] = str(t.pop("_id"))
        t["user_id"] = str(t["user_id"])
        if t.get("created_at"):
            t["created_at"] = t["created_at"].isoformat()
        if t.get("updated_at"):
            t["updated_at"] = t["updated_at"].isoformat()
        return t

    return {"success": True, "templates": [_serialize(t) for t in templates]}


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a saved template."""
    db = get_db()

    try:
        oid = ObjectId(template_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid template ID")

    result = await db.workout_templates.delete_one({
        "_id":     oid,
        "user_id": current_user["_id"],
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")

    return {"success": True}


@router.post("/templates/{template_id}/use")
async def use_template(
    template_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Mark a template as used (increment counter) and return its exercises."""
    db = get_db()

    try:
        oid = ObjectId(template_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid template ID")

    template = await db.workout_templates.find_one({
        "_id":     oid,
        "user_id": current_user["_id"],
    })
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    await db.workout_templates.update_one(
        {"_id": oid},
        {"$inc": {"times_used": 1}},
    )

    return {
        "success":   True,
        "exercises": template["exercises"],
        "name":      template["name"],
    }


@router.get("/{session_id}/summary")
async def get_workout_summary(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get full summary for a completed workout session."""
    db = get_db()

    try:
        oid = ObjectId(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session ID")

    session = await db.workout_sessions.find_one({
        "_id":     oid,
        "user_id": current_user["_id"],
    })
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    user = await db.users.find_one({"_id": current_user["_id"]})

    # ── Personal records ──────────────────────────────────────────────────
    personal_records = []

    longest = await db.workout_sessions.find_one(
        {"user_id": current_user["_id"], "completed": True, "_id": {"$ne": oid}},
        sort=[("duration_minutes", -1)],
    )
    if not longest or session.get("duration_minutes", 0) >= longest.get("duration_minutes", 0):
        if session.get("duration_minutes", 0) > 0:
            personal_records.append("Longest workout session!")

    best_form = await db.workout_sessions.find_one(
        {"user_id": current_user["_id"], "completed": True, "_id": {"$ne": oid}},
        sort=[("form_accuracy", -1)],
    )
    if not best_form or session.get("form_accuracy", 0) >= best_form.get("form_accuracy", 0):
        if session.get("form_accuracy", 0) > 0:
            personal_records.append("Best form accuracy!")

    most_cal = await db.workout_sessions.find_one(
        {"user_id": current_user["_id"], "completed": True, "_id": {"$ne": oid}},
        sort=[("calories_burned", -1)],
    )
    if not most_cal or session.get("calories_burned", 0) >= most_cal.get("calories_burned", 0):
        if session.get("calories_burned", 0) > 0:
            personal_records.append("Most calories burned!")

    # ── XP ────────────────────────────────────────────────────────────────
    from app.ai.gamification.badges import XP_REWARDS

    xp_earned = XP_REWARDS["workout_completed"]
    form_acc = session.get("form_accuracy", 0)
    if form_acc >= 100:
        xp_earned += XP_REWARDS["form_perfect_bonus"]
    elif form_acc >= 80:
        xp_earned += XP_REWARDS["form_excellent_bonus"]

    # ── Meal suggestions ──────────────────────────────────────────────────
    calories = session.get("calories_burned", 0)
    if calories > 400:
        meal_suggestions = [
            {"meal": "Protein shake + banana",              "timing": "Within 30 mins"},
            {"meal": "Grilled chicken + rice + vegetables", "timing": "Within 2 hours"},
            {"meal": "Greek yogurt with berries",           "timing": "1 hour before bed"},
        ]
    elif calories > 200:
        meal_suggestions = [
            {"meal": "Protein shake or chocolate milk",     "timing": "Within 30 mins"},
            {"meal": "Eggs + whole grain toast + avocado",  "timing": "Within 2 hours"},
        ]
    else:
        meal_suggestions = [
            {"meal": "Banana + peanut butter",              "timing": "Within 30 mins"},
            {"meal": "Light salad with grilled protein",    "timing": "Within 2 hours"},
        ]

    # ── Stretches ─────────────────────────────────────────────────────────
    exercises = session.get("exercises", [])
    muscle_groups = set()
    for ex in exercises:
        if isinstance(ex, dict):
            for m in ex.get("muscles_primary", []):
                muscle_groups.add(m)

    stretches = []
    if "Quadriceps" in muscle_groups or "Glutes" in muscle_groups:
        stretches.append("Hip flexor stretch — 30 seconds each side")
    if "Chest" in muscle_groups or "Shoulders" in muscle_groups:
        stretches.append("Chest doorway stretch — 30 seconds")
    if "Hamstrings" in muscle_groups:
        stretches.append("Seated hamstring stretch — 45 seconds")
    if "Abs" in muscle_groups or "Obliques" in muscle_groups:
        stretches.append("Cat-cow stretch — 10 reps")
    if not stretches:
        stretches = [
            "Full body stretch — 5 minutes",
            "Child's pose — 30 seconds",
            "Neck rolls — 10 each direction",
        ]

    completed_at = session.get("completed_at")

    return {
        "success": True,
        "summary": {
            "session_id":       str(session["_id"]),
            "duration_minutes": session.get("duration_minutes", 0),
            "active_seconds":   session.get("active_seconds", 0),
            "calories_burned":  session.get("calories_burned", 0),
            "form_accuracy":    session.get("form_accuracy", 0),
            "exercises_count":  len(exercises),
            "completed_at":     completed_at.isoformat() if completed_at else "",
            "personal_records": personal_records,
            "xp_earned":        xp_earned,
            "current_level":    user.get("level", 1) if user else 1,
            "current_xp":       user.get("xp", 0) if user else 0,
            "current_streak":   user.get("streak", 0) if user else 0,
            "meal_suggestions": meal_suggestions,
            "stretches":        stretches,
            "exercises":        exercises,
        },
    }
