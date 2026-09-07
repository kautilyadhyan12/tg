"""Exercise library API.

Production hardening (results identical for normal use):
  * FIXED filter bug: `category` and `muscle` both wrote to query["$or"], so
    combining them silently dropped the category filter. Now merged via $and.
  * User-supplied filter strings are regex-escaped (raw regex from clients
    could error or trigger pathological scans).
  * $text search falls back to a safe regex search if the text index is
    missing, instead of a 500.
  * The library is global and static, so list/category/muscle responses are
    cached in Redis (5 min) — most browsing traffic never touches MongoDB.
  * Exercise media (RapidAPI ExerciseDB — a metered third-party API) cached
    for 7 days; GIF URLs never change, so repeat lookups cost zero calls.
"""

import hashlib
import json
import math
import re

from bson import ObjectId
from fastapi import APIRouter, Query, HTTPException, Depends

from app.core.logging import get_logger
from app.core.security import get_current_user
from app.db.mongo import get_db
from app.db.redis_client import cache_get, cache_set

log = get_logger(__name__)
router = APIRouter(prefix="/exercises", tags=["Exercises"])

_LIST_CACHE_TTL = 5 * 60          # library changes rarely
_TAXONOMY_CACHE_TTL = 60 * 60     # categories/muscles are near-static
_MEDIA_CACHE_TTL = 7 * 24 * 3600  # GIF URLs never change


def serialize_exercise(doc: dict) -> dict:
    """Convert MongoDB document to JSON-serializable dict."""
    doc["id"] = str(doc.pop("_id"))
    return doc


def _safe_regex(value: str) -> dict:
    return {"$regex": re.escape(value.strip()), "$options": "i"}


@router.get("")
async def get_exercises(
    search:     str = Query(None, max_length=100),
    category:   str = Query(None, max_length=50),
    difficulty: str = Query(None, max_length=20),
    equipment:  str = Query(None, max_length=50),
    muscle:     str = Query(None, max_length=50),
    ai_only:    bool = Query(False),
    sort:       str = Query("name", max_length=20),
    page:       int = Query(1, ge=1, le=200),
    limit:      int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()

    # The exercise library is identical for all users — cache by the full
    # filter signature so popular views (page 1, no filters) hit Redis.
    sig = f"{search}|{category}|{difficulty}|{equipment}|{muscle}|{ai_only}|{sort}|{page}|{limit}"
    cache_key = "exlist:" + hashlib.sha1(sig.encode()).hexdigest()
    cached = await cache_get(cache_key)
    if cached:
        try:
            return json.loads(cached)
        except json.JSONDecodeError:
            pass

    query: dict = {"is_active": True}
    and_clauses: list = []

    # ── Filters (each on its own $or so they combine instead of colliding) ──
    if category:
        and_clauses.append({"$or": [
            {"primary_category": _safe_regex(category)},
            {"categories":       _safe_regex(category)},
        ]})

    if difficulty:
        query["difficulty"] = difficulty.lower().strip()

    if equipment:
        query["equipment"] = _safe_regex(equipment)

    if muscle:
        and_clauses.append({"$or": [
            {"muscles_primary":   _safe_regex(muscle)},
            {"muscles_secondary": _safe_regex(muscle)},
        ]})

    if ai_only:
        query["ai_supported"] = True

    if and_clauses:
        query["$and"] = and_clauses

    # ── Sort ──────────────────────────────────────────────────────────────────
    sort_map = {
        "name":     [("name", 1)],
        "rating":   [("rating", -1)],
        "calories": [("calories_per_min", -1)],
        "popular":  [("times_used", -1)],
    }
    sort_order = sort_map.get(sort, [("name", 1)])

    async def _run(q: dict):
        skip = (page - 1) * limit
        total = await db.exercises.count_documents(q)
        pages = math.ceil(total / limit) if total > 0 else 1
        cursor = db.exercises.find(q).sort(sort_order).skip(skip).limit(limit)
        return total, pages, await cursor.to_list(length=limit)

    # ── Search: try $text, fall back to name regex if no text index ─────────
    if search:
        text_query = {**query, "$text": {"$search": search.strip()}}
        try:
            total, pages, exercises = await _run(text_query)
        except Exception:
            log.warning("Text search unavailable, falling back to regex")
            regex_query = {**query, "name": _safe_regex(search)}
            total, pages, exercises = await _run(regex_query)
    else:
        total, pages, exercises = await _run(query)

    response = {
        "success":   True,
        "total":     total,
        "page":      page,
        "limit":     limit,
        "pages":     pages,
        "exercises": [serialize_exercise(e) for e in exercises],
    }
    await cache_set(cache_key, json.dumps(response, default=str), _LIST_CACHE_TTL)
    return response


@router.get("/categories")
async def get_categories(current_user: dict = Depends(get_current_user)):
    """Get all categories with counts — using the categories array."""
    cached = await cache_get("ex:categories")
    if cached:
        try:
            return json.loads(cached)
        except json.JSONDecodeError:
            pass

    db = get_db()
    pipeline = [
        {"$match": {"is_active": True}},
        {"$unwind": "$categories"},
        {"$group": {"_id": "$categories", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    categories = await db.exercises.aggregate(pipeline).to_list(length=50)
    response = {
        "success": True,
        "categories": [
            {"name": c["_id"], "count": c["count"]}
            for c in categories if c["_id"]
        ],
    }
    await cache_set("ex:categories", json.dumps(response), _TAXONOMY_CACHE_TTL)
    return response


@router.get("/muscles")
async def get_muscles(current_user: dict = Depends(get_current_user)):
    """Get all muscle groups."""
    cached = await cache_get("ex:muscles")
    if cached:
        try:
            return json.loads(cached)
        except json.JSONDecodeError:
            pass

    db = get_db()
    pipeline = [
        {"$match": {"is_active": True}},
        {"$unwind": "$muscles_primary"},
        {"$group": {"_id": "$muscles_primary", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    muscles = await db.exercises.aggregate(pipeline).to_list(length=50)
    response = {
        "success": True,
        "muscles": [
            {"name": m["_id"], "count": m["count"]}
            for m in muscles if m["_id"]
        ],
    }
    await cache_set("ex:muscles", json.dumps(response), _TAXONOMY_CACHE_TTL)
    return response


@router.get("/ai-supported")
async def get_ai_exercises(current_user: dict = Depends(get_current_user)):
    """Get only exercises with AI form detection support."""
    cached = await cache_get("ex:ai_supported")
    if cached:
        try:
            return json.loads(cached)
        except json.JSONDecodeError:
            pass

    db = get_db()
    exercises = await db.exercises.find(
        {"ai_supported": True, "is_active": True}
    ).sort("name", 1).to_list(length=50)
    response = {
        "success":   True,
        "exercises": [serialize_exercise(e) for e in exercises],
    }
    await cache_set("ex:ai_supported", json.dumps(response, default=str), _LIST_CACHE_TTL)
    return response


# NOTE: /media/{name} must be declared before /{exercise_id} would otherwise
# swallow it? No — /media/{x} has two segments vs one, so order is safe; kept
# here for readability.

@router.get("/media/{exercise_name}")
async def get_exercise_media(
    exercise_name: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Get GIF/media for an exercise by name.
    Tries ExerciseDB API (RapidAPI — metered), cached 7 days per name since
    media URLs never change.
    """
    if len(exercise_name) > 100:
        raise HTTPException(status_code=400, detail="Invalid exercise name")

    norm = exercise_name.lower().strip()
    cache_key = "exmedia:" + hashlib.sha1(norm.encode()).hexdigest()
    cached = await cache_get(cache_key)
    if cached:
        try:
            return {"success": True, "media": json.loads(cached)}
        except json.JSONDecodeError:
            pass

    from app.ai.exercise_media import get_exercise_gif
    result = await get_exercise_gif(norm)

    # Cache even "no media found" results — retrying a missing GIF on every
    # page view would waste metered calls too.
    await cache_set(cache_key, json.dumps(result), _MEDIA_CACHE_TTL)
    return {"success": True, "media": result}


@router.get("/{exercise_id}")
async def get_exercise(
    exercise_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a single exercise by ID."""
    db = get_db()

    try:
        oid = ObjectId(exercise_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid exercise ID")

    exercise = await db.exercises.find_one({"_id": oid, "is_active": True})
    if not exercise:
        raise HTTPException(status_code=404, detail="Exercise not found")

    await db.exercises.update_one(
        {"_id": oid},
        {"$inc": {"times_used": 1}},
    )

    return {"success": True, "exercise": serialize_exercise(exercise)}
