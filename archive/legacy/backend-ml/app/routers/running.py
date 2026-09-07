"""
Running feature — API router.

Mounted at /api/running. Uses the same auth dependency (get_current_user) and
DB accessor (get_db) as the rest of the app. All persistence lives in NEW
collections so nothing existing is touched:

    running_routes      generated/chosen routes
    running_schedules   scheduled (incl. recurring) runs
    running_sessions    actual completed/in-progress runs

User progression for running is stored in NEW user fields (running_xp,
running_badges, running_streak, lastRunDate) so the existing workout XP /
streak / badges are completely unaffected.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta
from bson import ObjectId

from app.db.mongo import get_db
from app.core.security import get_current_user
from app.ai.fitness.calories import normalize_weight_kg
from app.ai.running.routing_provider import generate_candidate_routes, match_path
from app.ai.running.scoring import score_and_rank
from app.ai.running.weather import check_weather
from app.ai.running.badges import (
    RUN_XP, TIER_RUN_XP, check_running_badges, get_running_badge_by_id,
    running_level_for_xp,
)

router = APIRouter(prefix="/running", tags=["Running"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")


def _iso(dt):
    return dt.isoformat() if isinstance(dt, datetime) else dt


def _serialize(doc: dict) -> dict:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    if "user_id" in doc:
        doc["user_id"] = str(doc["user_id"])
    if "route_id" in doc and isinstance(doc["route_id"], ObjectId):
        doc["route_id"] = str(doc["route_id"])
    if "schedule_id" in doc and isinstance(doc["schedule_id"], ObjectId):
        doc["schedule_id"] = str(doc["schedule_id"])
    for k in ("created_at", "scheduled_at", "started_at", "completed_at"):
        if k in doc and doc[k] is not None:
            doc[k] = _iso(doc[k])
    return doc


# Running MET by speed (km/h), 2024 Compendium of Physical Activities.
def _running_met(speed_kmh: float) -> float:
    if speed_kmh < 6.4:
        return 6.0      # light jog
    if speed_kmh < 8.0:
        return 8.3
    if speed_kmh < 9.7:
        return 9.0
    if speed_kmh < 11.3:
        return 10.5
    if speed_kmh < 12.9:
        return 11.5
    return 12.8


def _estimate_run_calories(weight_kg: float, distance_km: float,
                           duration_min: float) -> float:
    if duration_min <= 0 or distance_km <= 0:
        return 0.0
    speed = distance_km / (duration_min / 60.0)
    met = _running_met(speed)
    return met * weight_kg * (duration_min / 60.0)


async def _compute_running_stats(db, user_id) -> dict:
    """Aggregate running stats for badge checks and the hub."""
    sessions = await db.running_sessions.find(
        {"user_id": user_id, "completed": True}
    ).to_list(1000)

    total_runs = len(sessions)
    total_distance = sum(s.get("distance_km", 0) for s in sessions)
    max_distance = max([s.get("distance_km", 0) for s in sessions], default=0)
    has_early = any(
        s.get("completed_at") and s["completed_at"].hour < 7 for s in sessions
    )
    has_night = any(
        s.get("completed_at") and s["completed_at"].hour >= 21 for s in sessions
    )

    user = await db.users.find_one({"_id": user_id})
    running_streak = (user or {}).get("running_streak", 0)

    return {
        "total_runs":         total_runs,
        "total_distance_km":  round(total_distance, 2),
        "max_distance_km":    round(max_distance, 2),
        "has_early_run":      has_early,
        "has_night_run":      has_night,
        "running_streak":     running_streak,
    }


# ── Models ────────────────────────────────────────────────────────────────────

class GenerateRoutesBody(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    target_km: float = Field(5.0, gt=0, le=42.2)
    scheduled_iso: Optional[str] = None     # ISO datetime, to time-weight traffic
    count: int = Field(3, ge=1, le=5)


class ScheduleBody(BaseModel):
    scheduled_iso: str                       # ISO datetime of the run
    target_km: float = Field(5.0, gt=0, le=42.2)
    route_id: Optional[str] = None           # a saved route to attach
    recurrence: str = Field("none")          # none | daily | weekly
    weekdays: Optional[List[int]] = None     # 0=Mon..6=Sun for weekly
    lat: Optional[float] = None
    lng: Optional[float] = None
    note: str = ""


class StartSessionBody(BaseModel):
    route_id: Optional[str] = None
    schedule_id: Optional[str] = None
    target_km: float = Field(5.0, gt=0, le=42.2)


class TrackBody(BaseModel):
    points: List[List[float]] = []           # [[lat,lng], ...] appended to path
    distance_km: Optional[float] = None       # running total from client


class CompleteRunBody(BaseModel):
    distance_km: float = Field(0.0, ge=0)
    duration_min: float = Field(0.0, ge=0)
    path: Optional[List[List[float]]] = None
    splits: Optional[List[float]] = None      # per-km pace in seconds
    elevation_gain_m: float = 0.0


# ── Route generation ──────────────────────────────────────────────────────────

@router.post("/routes/generate")
async def generate_routes(body: GenerateRoutesBody,
                          current_user: dict = Depends(get_current_user)):
    """Generate and score candidate routes from the user's location.

    Metered: 5/user/day (ORS is a limited third-party API), fail-closed.
    Cached: coordinates rounded to ~100m + distance — gym members running the
    same neighborhoods hit the cache instead of ORS after the first request.
    """
    import json as _json
    from app.core.quotas import enforce_daily_quota, ROUTE_DAILY_LIMIT
    from app.db.redis_client import cache_get, cache_set

    cache_key = (f"routes:{round(body.lat, 3)}:{round(body.lng, 3)}"
                 f":{round(body.target_km, 1)}:{body.count}")
    result = None
    cached = await cache_get(cache_key)
    if cached:
        try:
            result = _json.loads(cached)
        except _json.JSONDecodeError:
            result = None

    if result is None:
        # Only uncached generations consume quota — cache hits are free.
        await enforce_daily_quota(
            current_user["_id"], "routes", ROUTE_DAILY_LIMIT, fail_open=False
        )
        result = await generate_candidate_routes(
            body.lat, body.lng, body.target_km, count=body.count
        )
        if result.get("mode") == "ors":   # don't cache mock fallbacks
            await cache_set(cache_key, _json.dumps(result), 7 * 24 * 60 * 60)

    # Determine scheduled hour for traffic weighting (defaults to now).
    hour = datetime.utcnow().hour
    if body.scheduled_iso:
        try:
            hour = datetime.fromisoformat(body.scheduled_iso.replace("Z", "")).hour
        except ValueError:
            pass

    fitness = current_user.get("fitnessLevel", "intermediate")
    ranked = score_and_rank(result["routes"], scheduled_hour=hour,
                            fitness_level=fitness)

    # Weather for the planned start point/time (single call, best-effort).
    weather = None
    if body.scheduled_iso:
        try:
            when = datetime.fromisoformat(body.scheduled_iso.replace("Z", ""))
            weather = await check_weather(body.lat, body.lng, when)
        except ValueError:
            weather = None

    return {
        "success": True,
        "mode":    result["mode"],
        "notice":  result["notice"],
        "routes":  ranked,
        "weather": weather,
    }


@router.post("/match")
async def match_running_path(body: dict,
                            current_user: dict = Depends(get_current_user)):
    """Road-snap a runner's GPS track (server-side, reuses the ORS key)."""
    path = body.get("path") or []
    if not isinstance(path, list) or len(path) > 5000:
        raise HTTPException(status_code=400,
                            detail="Invalid path (max 5000 GPS points)")
    result = await match_path(path)
    return {"success": True, **result}


@router.post("/routes/save")
async def save_route(body: dict, current_user: dict = Depends(get_current_user)):
    """Persist a chosen route so a schedule/session can reference it."""
    db = get_db()
    route = body.get("route") or {}
    if not route.get("coords"):
        raise HTTPException(status_code=400, detail="Route has no coordinates")

    doc = {
        "user_id":          current_user["_id"],
        "coords":           route.get("coords"),
        "distance_km":      route.get("distance_km", 0),
        "elevation_gain_m": route.get("elevation_gain_m", 0),
        "score":            route.get("score"),
        "label":            route.get("label", "Route"),
        "source":           route.get("source", "mock"),
        "created_at":       datetime.utcnow(),
    }
    res = await db.running_routes.insert_one(doc)
    return {"success": True, "route_id": str(res.inserted_id)}


@router.get("/routes/{route_id}")
async def get_route(route_id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.running_routes.find_one(
        {"_id": _oid(route_id), "user_id": current_user["_id"]}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Route not found")
    return {"success": True, "route": _serialize(doc)}


# ── Scheduling ────────────────────────────────────────────────────────────────

@router.post("/schedule")
async def create_schedule(body: ScheduleBody,
                          current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        scheduled_at = datetime.fromisoformat(body.scheduled_iso.replace("Z", ""))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid scheduled_iso")

    doc = {
        "user_id":      current_user["_id"],
        "scheduled_at": scheduled_at,
        "target_km":    body.target_km,
        "route_id":     _oid(body.route_id) if body.route_id else None,
        "recurrence":   body.recurrence,
        "weekdays":     body.weekdays or [],
        "lat":          body.lat,
        "lng":          body.lng,
        "note":         body.note,
        "status":       "upcoming",
        "created_at":   datetime.utcnow(),
    }
    res = await db.running_schedules.insert_one(doc)

    # Best-effort weather attached to the response (not stored — forecasts move).
    weather = None
    if body.lat is not None and body.lng is not None:
        weather = await check_weather(body.lat, body.lng, scheduled_at)

    return {"success": True, "schedule_id": str(res.inserted_id), "weather": weather}


@router.get("/schedule")
async def list_schedule(current_user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.running_schedules.find(
        {"user_id": current_user["_id"], "status": {"$ne": "cancelled"}}
    ).sort("scheduled_at", 1).to_list(100)

    now = datetime.utcnow()
    out = []
    for d in docs:
        item = _serialize(d)
        item["is_past"] = d.get("scheduled_at") and d["scheduled_at"] < now
        # Attach a fresh weather check for upcoming runs with a location.
        if (not item["is_past"] and d.get("lat") is not None
                and d.get("lng") is not None):
            item["weather"] = await check_weather(
                d["lat"], d["lng"], d["scheduled_at"]
            )
        out.append(item)
    return {"success": True, "schedules": out}


@router.delete("/schedule/{schedule_id}")
async def cancel_schedule(schedule_id: str,
                          current_user: dict = Depends(get_current_user)):
    db = get_db()
    res = await db.running_schedules.update_one(
        {"_id": _oid(schedule_id), "user_id": current_user["_id"]},
        {"$set": {"status": "cancelled"}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return {"success": True}


# ── Sessions (live tracking) ──────────────────────────────────────────────────

@router.post("/sessions/start")
async def start_session(body: StartSessionBody,
                        current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = {
        "user_id":     current_user["_id"],
        "route_id":    _oid(body.route_id) if body.route_id else None,
        "schedule_id": _oid(body.schedule_id) if body.schedule_id else None,
        "target_km":   body.target_km,
        "path":        [],
        "distance_km": 0.0,
        "completed":   False,
        "started_at":  datetime.utcnow(),
        "completed_at": None,
    }
    res = await db.running_sessions.insert_one(doc)
    return {"success": True, "session_id": str(res.inserted_id)}


@router.patch("/sessions/{session_id}/track")
async def track_session(session_id: str, body: TrackBody,
                        current_user: dict = Depends(get_current_user)):
    """Append GPS points during a run (batched from the client)."""
    db = get_db()
    update = {}
    if body.points:
        update["$push"] = {"path": {"$each": body.points}}
    if body.distance_km is not None:
        update.setdefault("$set", {})["distance_km"] = body.distance_km
    if not update:
        return {"success": True}
    res = await db.running_sessions.update_one(
        {"_id": _oid(session_id), "user_id": current_user["_id"],
         "completed": False},
        update,
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Active session not found")
    return {"success": True}


@router.patch("/sessions/{session_id}/complete")
async def complete_session(session_id: str, body: CompleteRunBody,
                           current_user: dict = Depends(get_current_user)):
    db = get_db()
    oid = _oid(session_id)
    session = await db.running_sessions.find_one(
        {"_id": oid, "user_id": current_user["_id"]}
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    weight_kg = normalize_weight_kg(current_user.get("weight"))
    calories = round(_estimate_run_calories(
        weight_kg, body.distance_km, body.duration_min
    ))
    avg_pace_sec = (
        round((body.duration_min * 60) / body.distance_km)
        if body.distance_km > 0 else 0
    )

    completed_at = datetime.utcnow()
    await db.running_sessions.update_one(
        {"_id": oid},
        {"$set": {
            "completed":        True,
            "distance_km":      round(body.distance_km, 2),
            "duration_min":     round(body.duration_min, 1),
            "avg_pace_sec_km":  avg_pace_sec,
            "calories_burned":  calories,
            "elevation_gain_m": round(body.elevation_gain_m),
            "splits":           body.splits or [],
            "path":             body.path or session.get("path", []),
            "completed_at":     completed_at,
        }},
    )

    # ── Isolated running XP / streak / badges (never touches workout fields) ──
    user_id = current_user["_id"]
    user = await db.users.find_one({"_id": user_id})

    xp = RUN_XP["run_completed"] + int(body.distance_km) * RUN_XP["distance_per_km"]

    # Negative split bonus: second half faster (lower pace seconds) than first.
    splits = body.splits or []
    if len(splits) >= 2:
        half = len(splits) // 2
        first = sum(splits[:half]) / max(1, half)
        second = sum(splits[half:]) / max(1, len(splits) - half)
        if second < first:
            xp += RUN_XP["negative_split"]

    # Distance PR bonus.
    prev_max = 0
    prev = await db.running_sessions.find_one(
        {"user_id": user_id, "completed": True, "_id": {"$ne": oid}},
        sort=[("distance_km", -1)],
    )
    if prev:
        prev_max = prev.get("distance_km", 0)
    is_distance_pr = body.distance_km > prev_max and body.distance_km > 0
    if is_distance_pr:
        xp += RUN_XP["new_distance_pr"]

    # Running streak (separate from workout streak).
    last_run = user.get("lastRunDate")
    today = completed_at.date()
    streak = user.get("running_streak", 0)
    if last_run:
        last_date = last_run.date() if hasattr(last_run, "date") else last_run
        if last_date == today:
            pass
        elif (today - last_date).days == 1:
            streak += 1
            xp += RUN_XP["streak_day"]
        else:
            streak = 1
    else:
        streak = 1

    new_running_xp = user.get("running_xp", 0) + xp
    new_running_level = running_level_for_xp(new_running_xp)

    await db.users.update_one(
        {"_id": user_id},
        {"$set": {
            "running_streak": streak,
            "lastRunDate":    completed_at,
            "running_level":  new_running_level,
         },
         "$inc": {"running_xp": xp}},
    )

    # Badge check (running-only).
    stats = await _compute_running_stats(db, user_id)
    earned_ids = check_running_badges(stats)
    stored = set(user.get("running_badges", []))
    new_ids = set(earned_ids) - stored
    badge_xp = 0
    if new_ids:
        for bid in new_ids:
            b = get_running_badge_by_id(bid)
            if b:
                badge_xp += TIER_RUN_XP.get(b["tier"], 30)
        await db.users.update_one(
            {"_id": user_id},
            {"$set": {"running_badges": list(stored | new_ids),
                      "running_level": running_level_for_xp(new_running_xp + badge_xp)},
             "$inc": {"running_xp": badge_xp}},
        )
        xp += badge_xp

    # Mark a linked schedule as completed.
    if session.get("schedule_id"):
        await db.running_schedules.update_one(
            {"_id": session["schedule_id"]}, {"$set": {"status": "completed"}}
        )

    return {
        "success":        True,
        "xp_earned":      xp,
        "running_streak": streak,
        "is_distance_pr": is_distance_pr,
        "new_badges":     [get_running_badge_by_id(b) for b in new_ids],
        "summary": {
            "distance_km":     round(body.distance_km, 2),
            "duration_min":    round(body.duration_min, 1),
            "avg_pace_sec_km": avg_pace_sec,
            "calories_burned": calories,
        },
    }


@router.get("/sessions")
async def list_sessions(limit: int = 20,
                        current_user: dict = Depends(get_current_user)):
    db = get_db()
    docs = await db.running_sessions.find(
        {"user_id": current_user["_id"], "completed": True}
    ).sort("completed_at", -1).limit(limit).to_list(limit)
    return {"success": True, "sessions": [_serialize(d) for d in docs]}


@router.get("/sessions/{session_id}/summary")
async def session_summary(session_id: str,
                          current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await db.running_sessions.find_one(
        {"_id": _oid(session_id), "user_id": current_user["_id"]}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "session": _serialize(doc)}


# ── Hub stats ─────────────────────────────────────────────────────────────────

@router.get("/stats")
async def running_stats(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = current_user["_id"]
    stats = await _compute_running_stats(db, user_id)
    user = await db.users.find_one({"_id": user_id})

    # Personal records.
    fastest = await db.running_sessions.find_one(
        {"user_id": user_id, "completed": True, "avg_pace_sec_km": {"$gt": 0}},
        sort=[("avg_pace_sec_km", 1)],
    )
    longest = await db.running_sessions.find_one(
        {"user_id": user_id, "completed": True},
        sort=[("distance_km", -1)],
    )

    return {
        "success": True,
        "stats": {
            **stats,
            "running_xp":     user.get("running_xp", 0) if user else 0,
            "running_level":  user.get("running_level", 1) if user else 1,
            "badges":         user.get("running_badges", []) if user else [],
            "best_pace_sec_km": fastest.get("avg_pace_sec_km") if fastest else None,
            "longest_run_km":   longest.get("distance_km") if longest else 0,
        },
    }
