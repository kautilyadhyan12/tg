from fastapi import APIRouter, Depends, Query
from app.db.mongo import get_db
from app.core.security import get_current_user
from app.core.logging import get_logger
from datetime import datetime, timedelta
from bson import ObjectId
from app.ai.predictions.forecaster import get_all_predictions

log = get_logger(__name__)
router = APIRouter(prefix="/progress", tags=["Progress"])


def get_date_range(period: str):
    now = datetime.utcnow()
    if period == "7d":    return now - timedelta(days=7)
    if period == "30d":   return now - timedelta(days=30)
    if period == "90d":   return now - timedelta(days=90)
    if period == "1y":    return now - timedelta(days=365)
    return None  # All time


@router.get("/overview")
async def get_progress_overview(
    period:       str  = Query("30d"),
    current_user: dict = Depends(get_current_user),
):
    """Get overview stats for the progress page."""
    db      = get_db()
    user_id = current_user["_id"]

    since      = get_date_range(period)
    date_query = {"completed_at": {"$gte": since}} if since else {}
    base_query = {"user_id": user_id, "completed": True, **date_query}

    # Total workouts
    total_workouts = await db.workout_sessions.count_documents(base_query)

    # Total calories + time
    agg = await db.workout_sessions.aggregate([
        {"$match": base_query},
        {"$group": {
            "_id":             None,
            "total_calories":  {"$sum": "$calories_burned"},
            "total_minutes":   {"$sum": "$duration_minutes"},
            "avg_form":        {"$avg": "$form_accuracy"},
        }},
    ]).to_list(1)

    totals = agg[0] if agg else {}

    # Current streak
    user    = await db.users.find_one({"_id": user_id})
    streak  = user.get("streak", 0) if user else 0

    # Longest streak (from all time)
    all_sessions = await db.workout_sessions.find(
        {"user_id": user_id, "completed": True},
        {"completed_at": 1}
    ).sort("completed_at", 1).to_list(1000)

    longest_streak = calculate_longest_streak(all_sessions)

    # Consistency percentage
    if since:
        days_in_period = (datetime.utcnow() - since).days or 1
        consistency   = round((total_workouts / days_in_period) * 100)
        consistency   = min(consistency, 100)
    else:
        consistency = 0

    return {
        "success": True,
        "overview": {
            "total_workouts":  total_workouts,
            "total_calories":  round(totals.get("total_calories", 0)),
            "total_hours":     round(totals.get("total_minutes", 0) / 60, 1),
            "avg_form":        round(totals.get("avg_form", 0)),
            "current_streak":  streak,
            "longest_streak":  longest_streak,
            "consistency":     consistency,
        },
    }


def calculate_longest_streak(sessions: list) -> int:
    if not sessions:
        return 0
    dates = sorted(set(
        s["completed_at"].date()
        for s in sessions
        if s.get("completed_at")
    ))
    if not dates:
        return 0
    longest = current = 1
    for i in range(1, len(dates)):
        if (dates[i] - dates[i-1]).days == 1:
            current += 1
            longest  = max(longest, current)
        else:
            current  = 1
    return longest


@router.get("/calories-trend")
async def get_calories_trend(
    period:       str  = Query("30d"),
    current_user: dict = Depends(get_current_user),
):
    """Calories burned per day for trend chart."""
    db      = get_db()
    user_id = current_user["_id"]
    since   = get_date_range(period)

    match = {"user_id": user_id, "completed": True}
    if since:
        match["completed_at"] = {"$gte": since}

    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": {
                "year":  {"$year":       "$completed_at"},
                "month": {"$month":      "$completed_at"},
                "day":   {"$dayOfMonth": "$completed_at"},
            },
            "calories": {"$sum": "$calories_burned"},
            "workouts": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]

    results = await db.workout_sessions.aggregate(pipeline).to_list(365)

    data = []
    for r in results:
        d = r["_id"]
        data.append({
            "date":     f"{d['year']}-{d['month']:02d}-{d['day']:02d}",
            "calories": round(r["calories"]),
            "workouts": r["workouts"],
        })

    return {"success": True, "data": data}


@router.get("/weekly-workouts")
async def get_weekly_workouts(
    period:       str  = Query("90d"),
    current_user: dict = Depends(get_current_user),
):
    """Workouts per week for bar chart."""
    db      = get_db()
    user_id = current_user["_id"]
    since   = get_date_range(period)

    match = {"user_id": user_id, "completed": True}
    if since:
        match["completed_at"] = {"$gte": since}

    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": {
                "year": {"$isoWeekYear": "$completed_at"},
                "week": {"$isoWeek":     "$completed_at"},
            },
            "count":    {"$sum": 1},
            "calories": {"$sum": "$calories_burned"},
        }},
        {"$sort": {"_id": 1}},
    ]

    results = await db.workout_sessions.aggregate(pipeline).to_list(52)

    data = []
    for r in results:
        data.append({
            "week":     f"W{r['_id']['week']} {r['_id']['year']}",
            "workouts": r["count"],
            "calories": round(r["calories"]),
        })

    return {"success": True, "data": data}


@router.get("/activity-heatmap")
async def get_activity_heatmap(
    current_user: dict = Depends(get_current_user),
):
    """GitHub-style activity heatmap — last 365 days."""
    db      = get_db()
    user_id = current_user["_id"]
    since   = datetime.utcnow() - timedelta(days=365)

    sessions = await db.workout_sessions.find(
        {
            "user_id":      user_id,
            "completed":    True,
            "completed_at": {"$gte": since},
        },
        {"completed_at": 1, "calories_burned": 1}
    ).to_list(1000)

    heatmap = {}
    for s in sessions:
        if s.get("completed_at"):
            date_str = s["completed_at"].strftime("%Y-%m-%d")
            if date_str not in heatmap:
                heatmap[date_str] = {"count": 0, "calories": 0}
            heatmap[date_str]["count"]    += 1
            heatmap[date_str]["calories"] += s.get("calories_burned", 0)

    return {"success": True, "heatmap": heatmap}


@router.get("/category-distribution")
async def get_category_distribution(
    period:       str  = Query("30d"),
    current_user: dict = Depends(get_current_user),
):
    """Exercise category distribution for pie chart."""
    db      = get_db()
    user_id = current_user["_id"]
    since   = get_date_range(period)

    match = {"user_id": user_id, "completed": True}
    if since:
        match["completed_at"] = {"$gte": since}

    sessions = await db.workout_sessions.find(
        match, {"exercises": 1}
    ).to_list(500)

    category_counts = {}
    for session in sessions:
        for ex in session.get("exercises", []):
            if isinstance(ex, dict):
                cat = ex.get("primary_category") or ex.get("category", "General")
                category_counts[cat] = category_counts.get(cat, 0) + 1

    data = [
        {"category": k, "count": v}
        for k, v in sorted(
            category_counts.items(),
            key=lambda x: x[1],
            reverse=True
        )
    ]

    return {"success": True, "data": data}


@router.get("/personal-records")
async def get_personal_records(
    current_user: dict = Depends(get_current_user),
):
    """Get all personal records."""
    db      = get_db()
    user_id = current_user["_id"]

    # Most calories in one session
    best_calories = await db.workout_sessions.find_one(
        {"user_id": user_id, "completed": True},
        sort=[("calories_burned", -1)]
    )

    # Longest session
    longest_session = await db.workout_sessions.find_one(
        {"user_id": user_id, "completed": True},
        sort=[("duration_minutes", -1)]
    )

    # Best form accuracy
    best_form = await db.workout_sessions.find_one(
        {"user_id": user_id, "completed": True, "form_accuracy": {"$gt": 0}},
        sort=[("form_accuracy", -1)]
    )

    # Total workouts
    total = await db.workout_sessions.count_documents(
        {"user_id": user_id, "completed": True}
    )

    # Longest streak
    all_sessions = await db.workout_sessions.find(
        {"user_id": user_id, "completed": True},
        {"completed_at": 1}
    ).sort("completed_at", 1).to_list(1000)

    longest_streak = calculate_longest_streak(all_sessions)

    records = [
        {
            "label": "Most Calories (single session)",
            "value": f"{round(best_calories.get('calories_burned', 0))} kcal"
                     if best_calories else "No data",
            "icon":  "🔥",
        },
        {
            "label": "Longest Session",
            "value": f"{round(longest_session.get('duration_minutes', 0))} min"
                     if longest_session else "No data",
            "icon":  "⏱️",
        },
        {
            "label": "Best Form Accuracy",
            "value": f"{round(best_form.get('form_accuracy', 0))}%"
                     if best_form else "No data",
            "icon":  "🎯",
        },
        {
            "label": "Total Workouts",
            "value": str(total),
            "icon":  "💪",
        },
        {
            "label": "Longest Streak",
            "value": f"{longest_streak} days",
            "icon":  "🔥",
        },
    ]

    return {"success": True, "records": records}

# ── Body Measurements ─────────────────────────────────────────────────────────

from pydantic import BaseModel
from typing   import Optional


class MeasurementRequest(BaseModel):
    weight_kg:   Optional[float] = None
    waist_cm:    Optional[float] = None
    chest_cm:    Optional[float] = None
    hips_cm:     Optional[float] = None
    left_arm_cm: Optional[float] = None
    right_arm_cm:Optional[float] = None
    left_thigh_cm: Optional[float] = None
    right_thigh_cm:Optional[float] = None
    body_fat_pct:  Optional[float] = None
    notes:         Optional[str]  = None
    measured_at:   Optional[str]  = None


@router.post("/measurements")
async def log_measurement(
    body:         MeasurementRequest,
    current_user: dict = Depends(get_current_user),
):
    """Log a new body measurement entry."""
    db      = get_db()
    user_id = current_user["_id"]

    measured_at = datetime.utcnow()
    if body.measured_at:
        try:
            measured_at = datetime.fromisoformat(body.measured_at.replace("Z", "+00:00"))
        except Exception:
            pass

    doc = {
        "user_id":        user_id,
        "measured_at":    measured_at,
        "created_at":     datetime.utcnow(),
    }

    # Only store non-null fields
    fields = [
        "weight_kg", "waist_cm", "chest_cm", "hips_cm",
        "left_arm_cm", "right_arm_cm", "left_thigh_cm",
        "right_thigh_cm", "body_fat_pct", "notes",
    ]
    for f in fields:
        val = getattr(body, f)
        if val is not None:
            doc[f] = val

    result = await db.body_measurements.insert_one(doc)

    doc["id"]         = str(result.inserted_id)
    doc["user_id"]    = str(doc["user_id"])
    doc["measured_at"]= doc["measured_at"].isoformat()
    doc["created_at"] = doc["created_at"].isoformat()
    del doc["_id"]

    return {"success": True, "measurement": doc}


@router.get("/measurements")
async def get_measurements(
    limit:        int  = Query(30, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """Get measurement history for the current user."""
    db      = get_db()
    user_id = current_user["_id"]

    docs = await db.body_measurements.find(
        {"user_id": user_id}
    ).sort("measured_at", -1).limit(limit).to_list(limit)

    measurements = []
    for d in docs:
        d["id"]          = str(d.pop("_id"))
        d["user_id"]     = str(d["user_id"])
        d["measured_at"] = d["measured_at"].isoformat() if d.get("measured_at") else ""
        d["created_at"]  = d["created_at"].isoformat()  if d.get("created_at")  else ""
        measurements.append(d)

    # Compute latest values for each metric
    latest = {}
    metric_keys = [
        "weight_kg", "waist_cm", "chest_cm", "hips_cm",
        "left_arm_cm", "right_arm_cm", "left_thigh_cm",
        "right_thigh_cm", "body_fat_pct",
    ]
    for m in reversed(measurements):   # oldest first so latest wins
        for k in metric_keys:
            if k in m and m[k] is not None:
                latest[k] = m[k]

    return {
        "success":      True,
        "measurements": measurements,
        "latest":       latest,
        "count":        len(measurements),
    }


@router.delete("/measurements/{measurement_id}")
async def delete_measurement(
    measurement_id: str,
    current_user:   dict = Depends(get_current_user),
):
    """Delete a measurement entry."""
    db      = get_db()
    user_id = current_user["_id"]

    try:
        oid = ObjectId(measurement_id)
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid ID")

    result = await db.body_measurements.delete_one({
        "_id":     oid,
        "user_id": user_id,
    })

    if result.deleted_count == 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Measurement not found")

    return {"success": True}


@router.get("/predictions")
async def get_predictions(
    current_user: dict = Depends(get_current_user),
):
    """
    Phase 10 — AI-powered predictions.
    Returns calorie forecast, weekly goal probability,
    plateau detection, and best-workout-time analysis.
    """
    db      = get_db()
    user_id = current_user["_id"]

    # ── Fetch all completed workout sessions ──────────────────────────────────
    sessions = await db.workout_sessions.find(
        {"user_id": user_id, "completed": True},
        {
            "completed_at":      1,
            "calories_burned":   1,
            "duration_minutes":  1,
            "form_accuracy":     1,
        }
    ).sort("completed_at", 1).to_list(500)

    # ── Get user's target (default 3 workouts/week) ───────────────────────────
    user = await db.users.find_one({"_id": user_id})
    target_per_week = 3
    if user:
        freq = user.get("workoutFrequency", "")
        if freq == "1-2":
            target_per_week = 2
        elif freq == "3-4":
            target_per_week = 3
        elif freq == "5-6":
            target_per_week = 5
        elif freq == "daily":
            target_per_week = 7

    # ── Run all predictions ───────────────────────────────────────────────────
    try:
        predictions = get_all_predictions(sessions, target_per_week=target_per_week)
    except Exception as e:
        import traceback
        log.exception("Predictions error: %s", e)
        traceback.print_exc()
        return {
            "success":     False,
            "predictions": None,
            "error":       str(e),
        }

    return {
        "success":     True,
        "predictions": predictions,
    }
    
