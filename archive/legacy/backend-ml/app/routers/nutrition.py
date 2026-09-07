"""
Phase 11 — Nutrition API
Handles:
  - TDEE / macro target calculation from user profile
  - Logging meals (CRUD)
  - Daily / weekly nutrition summaries
  - Food search (built-in DB + USDA fallback)
  - Meal photo analysis (vision model)

Production hardening (behavior otherwise unchanged):
  * Photo analysis: 8/user/day quota (fail-CLOSED — this is the app's one
    genuinely expensive metered feature) and the vision call now runs in a
    worker thread instead of blocking the event loop.
  * Meal inputs bounded (kcal/macros/quantity/strings) so one bad client
    can't corrupt summaries or bloat storage.
  * USDA search results cached in Redis for 24h — food nutrition data is
    static, so repeat queries cost zero API calls.
  * Errors no longer leak exception strings to clients.
"""

import hashlib
import json
from datetime import datetime, timedelta, date, time
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.core.quotas import enforce_daily_quota, PHOTO_DAILY_LIMIT
from app.core.security import get_current_user
from app.db.mongo import get_db
from app.db.redis_client import cache_get, cache_set
from app.ai.nutrition.food_database import search_foods

log = get_logger(__name__)
router = APIRouter(prefix="/nutrition", tags=["Nutrition"])

_MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack"}
_USDA_CACHE_TTL = 24 * 60 * 60  # nutrition facts don't change


# ── Request / response schemas ────────────────────────────────────────────────
class MealLogRequest(BaseModel):
    meal_type: str = Field(max_length=20)
    food_name: str = Field(min_length=1, max_length=200)
    quantity:  float = Field(gt=0, le=100)
    kcal:      float = Field(ge=0, le=10000)
    protein_g: float = Field(ge=0, le=1000)
    carbs_g:   float = Field(ge=0, le=1000)
    fat_g:     float = Field(ge=0, le=1000)
    fiber_g:   Optional[float] = Field(default=0, ge=0, le=500)
    notes:     Optional[str] = Field(default=None, max_length=500)
    consumed_at: Optional[str] = None


class MealUpdateRequest(BaseModel):
    meal_type: Optional[str]   = Field(default=None, max_length=20)
    quantity:  Optional[float] = Field(default=None, gt=0, le=100)
    kcal:      Optional[float] = Field(default=None, ge=0, le=10000)
    protein_g: Optional[float] = Field(default=None, ge=0, le=1000)
    carbs_g:   Optional[float] = Field(default=None, ge=0, le=1000)
    fat_g:     Optional[float] = Field(default=None, ge=0, le=1000)
    notes:     Optional[str]   = Field(default=None, max_length=500)


# ── Helpers ───────────────────────────────────────────────────────────────────
def extract_numeric(value, default: float) -> float:
    """
    Safely extract a number from any shape:
    - plain number: 70 → 70.0
    - string: "70" → 70.0
    - dict with value: {"value": 70, "unit": "kg"} → 70.0
    - dict without value (skip clicked): {"unit": "kg"} → default
    - None → default
    """
    if value is None:
        return float(default)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except (TypeError, ValueError):
            return float(default)
    if isinstance(value, dict):
        v = value.get("value")
        if v is None:
            return float(default)
        try:
            return float(v)
        except (TypeError, ValueError):
            return float(default)
    return float(default)


def calculate_targets(user: dict) -> dict:
    """
    Compute calorie + macro targets using Mifflin-St Jeor BMR formula.
    Handles all MongoDB field shapes defensively.
    """
    weight = extract_numeric(user.get("weight"), 70)    # kg
    height = extract_numeric(user.get("height"), 170)   # cm
    age    = int(extract_numeric(user.get("age"), 25))
    gender = (user.get("gender") or "male").lower()

    goals     = user.get("fitnessGoals") or []
    frequency = str(user.get("workoutFrequency") or
                    user.get("exerciseFrequency") or "3-4")

    if not isinstance(goals, list):
        goals = [goals] if goals else []

    # ── Convert weight to kg if stored in lbs ────────────────────────────────
    weight_raw = user.get("weight")
    if isinstance(weight_raw, dict) and weight_raw.get("unit") == "lbs":
        weight = weight * 0.453592

    # ── Convert height to cm if stored in ft ─────────────────────────────────
    height_raw = user.get("height")
    if isinstance(height_raw, dict) and height_raw.get("unit") == "ft":
        height = height * 30.48

    # ── BMR (Mifflin-St Jeor) ─────────────────────────────────────────────────
    if gender == "female":
        bmr = (10 * weight) + (6.25 * height) - (5 * age) - 161
    else:
        bmr = (10 * weight) + (6.25 * height) - (5 * age) + 5

    # ── Activity multiplier ───────────────────────────────────────────────────
    activity_map = {
        "1-2":   1.375,
        "3-4":   1.55,
        "5-6":   1.725,
        "daily": 1.9,
    }
    # Also handle plain integer frequency from onboarding
    freq_map = {
        "1": 1.2, "2": 1.375, "3": 1.375, "4": 1.55,
        "5": 1.55, "6": 1.725, "7": 1.9,
    }
    activity = activity_map.get(frequency) or freq_map.get(frequency, 1.55)

    tdee = bmr * activity

    # ── Adjust for goals ──────────────────────────────────────────────────────
    if "weight_loss" in goals:
        target_kcal = tdee - 400
    elif "muscle_gain" in goals:
        target_kcal = tdee + 300
    else:
        target_kcal = tdee

    target_kcal = max(target_kcal, 1200)

    # ── Macro split ───────────────────────────────────────────────────────────
    if "muscle_gain" in goals:
        protein_per_kg = 2.2
    elif "weight_loss" in goals:
        protein_per_kg = 2.0
    else:
        protein_per_kg = 1.6

    protein_g = weight * protein_per_kg
    fat_g     = (target_kcal * 0.25) / 9
    carbs_g   = (target_kcal - (protein_g * 4) - (fat_g * 9)) / 4

    return {
        "bmr":        round(bmr),
        "tdee":       round(tdee),
        "kcal":       round(target_kcal),
        "protein_g":  round(protein_g),
        "carbs_g":    round(max(carbs_g, 50)),
        "fat_g":      round(fat_g),
        "fiber_g":    round(target_kcal / 1000 * 14),
        "water_ml":   round(weight * 35),
        "using_defaults": weight == 70 or height == 170,
    }


def day_bounds(target_date: date) -> tuple:
    start = datetime.combine(target_date, time.min)
    end   = datetime.combine(target_date, time.max)
    return start, end


def serialize_meal(meal: dict) -> dict:
    meal["id"]      = str(meal.pop("_id"))
    meal["user_id"] = str(meal["user_id"])
    if meal.get("consumed_at"):
        meal["consumed_at"] = meal["consumed_at"].isoformat()
    if meal.get("created_at"):
        meal["created_at"] = meal["created_at"].isoformat()
    return meal


def _totals(meals: list) -> dict:
    return {
        "kcal":      round(sum(m.get("kcal", 0)      for m in meals), 1),
        "protein_g": round(sum(m.get("protein_g", 0) for m in meals), 1),
        "carbs_g":   round(sum(m.get("carbs_g", 0)   for m in meals), 1),
        "fat_g":     round(sum(m.get("fat_g", 0)     for m in meals), 1),
        "fiber_g":   round(sum(m.get("fiber_g", 0)   for m in meals), 1),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/targets")
async def get_targets(current_user: dict = Depends(get_current_user)):
    """Get the user's daily calorie + macro targets."""
    try:
        targets = calculate_targets(current_user)
        return {"success": True, "targets": targets}
    except Exception:
        log.exception("Target calculation failed for user %s", current_user.get("_id"))
        return {"success": False, "error": "Could not calculate targets", "targets": None}


@router.get("/search")
async def search_food(
    q:     str = Query(..., min_length=1, max_length=100),
    limit: int = Query(10, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """
    Search food database.
    Tries USDA FoodData Central first (millions of foods),
    falls back to built-in database (~200 common foods).
    USDA results are cached for 24h — nutrition facts are static, so repeat
    searches (everyone types "chicken") cost zero external calls.
    """
    from app.ai.nutrition.usda import search_usda

    norm_q = q.strip().lower()
    cache_key = "usda:" + hashlib.sha1(f"{norm_q}:{limit}".encode()).hexdigest()

    cached = await cache_get(cache_key)
    if cached:
        try:
            results = json.loads(cached)
            return {"success": True, "results": results, "source": "usda", "count": len(results)}
        except json.JSONDecodeError:
            pass

    # ── Try USDA first ────────────────────────────────────────────────────────
    usda_results = await search_usda(norm_q, limit=limit)

    if usda_results:
        await cache_set(cache_key, json.dumps(usda_results), _USDA_CACHE_TTL)
        return {
            "success": True,
            "results": usda_results,
            "source":  "usda",
            "count":   len(usda_results),
        }

    # ── Fall back to built-in ─────────────────────────────────────────────────
    builtin = search_foods(norm_q, limit=limit)
    out = []
    for r in builtin:
        out.append({
            "name":         r["name"],
            "kcal":         r["kcal"],
            "protein_g":    r["p"],
            "carbs_g":      r["c"],
            "fat_g":        r["f"],
            "fiber_g":      r["fib"],
            "serving_size": r["serving"],
            "serving_unit": r["unit"],
            "source":       "built-in",
        })

    return {"success": True, "results": out, "source": "built-in", "count": len(out)}


@router.post("/meals")
async def log_meal(
    body: MealLogRequest,
    current_user: dict = Depends(get_current_user),
):
    """Log a meal."""
    db = get_db()
    user_id = current_user["_id"]

    meal_type = body.meal_type if body.meal_type in _MEAL_TYPES else "snack"

    consumed_at = datetime.utcnow()
    if body.consumed_at:
        try:
            consumed_at = datetime.fromisoformat(body.consumed_at.replace("Z", "+00:00"))
            consumed_at = consumed_at.replace(tzinfo=None)
        except Exception:
            pass

    meal = {
        "user_id":     user_id,
        "meal_type":   meal_type,
        "food_name":   body.food_name,
        "quantity":    body.quantity,
        "kcal":        body.kcal,
        "protein_g":   body.protein_g,
        "carbs_g":     body.carbs_g,
        "fat_g":       body.fat_g,
        "fiber_g":     body.fiber_g or 0,
        "notes":       body.notes,
        "consumed_at": consumed_at,
        "created_at":  datetime.utcnow(),
    }

    result = await db.meal_logs.insert_one(meal)
    meal["_id"] = result.inserted_id
    return {"success": True, "meal": serialize_meal(meal)}


@router.get("/meals/today")
async def get_today_meals(current_user: dict = Depends(get_current_user)):
    """Get all meals logged today + running totals."""
    db = get_db()
    user_id = current_user["_id"]

    today = datetime.utcnow().date()
    start, end = day_bounds(today)

    cursor = db.meal_logs.find({
        "user_id":     user_id,
        "consumed_at": {"$gte": start, "$lte": end},
    }).sort("consumed_at", 1)

    meals = [serialize_meal(m) for m in await cursor.to_list(100)]
    totals = _totals(meals)

    by_type = {"breakfast": [], "lunch": [], "dinner": [], "snack": []}
    for m in meals:
        by_type.setdefault(m["meal_type"], []).append(m)

    targets = calculate_targets(current_user)

    return {
        "success":  True,
        "date":     today.isoformat(),
        "meals":    meals,
        "by_type":  by_type,
        "totals":   totals,
        "targets":  targets,
        "remaining": {
            "kcal":      max(0, round(targets["kcal"]      - totals["kcal"])),
            "protein_g": max(0, round(targets["protein_g"] - totals["protein_g"])),
            "carbs_g":   max(0, round(targets["carbs_g"]   - totals["carbs_g"])),
            "fat_g":     max(0, round(targets["fat_g"]     - totals["fat_g"])),
        },
    }


@router.get("/meals/date/{date_str}")
async def get_meals_by_date(
    date_str: str,
    current_user: dict = Depends(get_current_user),
):
    """Get all meals for a specific date (YYYY-MM-DD)."""
    db = get_db()
    user_id = current_user["_id"]

    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")

    start, end = day_bounds(target_date)

    cursor = db.meal_logs.find({
        "user_id":     user_id,
        "consumed_at": {"$gte": start, "$lte": end},
    }).sort("consumed_at", 1)

    meals = [serialize_meal(m) for m in await cursor.to_list(100)]

    return {"success": True, "date": date_str, "meals": meals, "totals": _totals(meals)}


@router.delete("/meals/{meal_id}")
async def delete_meal(
    meal_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a logged meal."""
    db = get_db()

    try:
        oid = ObjectId(meal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid meal ID")

    result = await db.meal_logs.delete_one({"_id": oid, "user_id": current_user["_id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Meal not found")

    return {"success": True}


@router.patch("/meals/{meal_id}")
async def update_meal(
    meal_id: str,
    body: MealUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update fields on a logged meal."""
    db = get_db()

    try:
        oid = ObjectId(meal_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid meal ID")

    update = {k: v for k, v in body.dict().items() if v is not None}
    if not update:
        return {"success": True}

    if "meal_type" in update and update["meal_type"] not in _MEAL_TYPES:
        update["meal_type"] = "snack"

    update["updated_at"] = datetime.utcnow()

    result = await db.meal_logs.update_one(
        {"_id": oid, "user_id": current_user["_id"]},
        {"$set": update},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Meal not found")

    return {"success": True}


@router.get("/weekly-summary")
async def weekly_summary(current_user: dict = Depends(get_current_user)):
    """Get nutrition totals for the last 7 days."""
    db = get_db()
    user_id = current_user["_id"]

    today    = datetime.utcnow().date()
    start    = today - timedelta(days=6)
    start_dt = datetime.combine(start, time.min)

    cursor = db.meal_logs.find({
        "user_id":     user_id,
        "consumed_at": {"$gte": start_dt},
    })
    meals = await cursor.to_list(1000)

    by_date = {}
    for i in range(7):
        d = (start + timedelta(days=i)).isoformat()
        by_date[d] = {"date": d, "kcal": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}

    for m in meals:
        if m.get("consumed_at"):
            d = m["consumed_at"].date().isoformat()
            if d in by_date:
                by_date[d]["kcal"]      += m.get("kcal", 0)
                by_date[d]["protein_g"] += m.get("protein_g", 0)
                by_date[d]["carbs_g"]   += m.get("carbs_g", 0)
                by_date[d]["fat_g"]     += m.get("fat_g", 0)

    days = list(by_date.values())
    for d in days:
        d["kcal"]      = round(d["kcal"])
        d["protein_g"] = round(d["protein_g"])
        d["carbs_g"]   = round(d["carbs_g"])
        d["fat_g"]     = round(d["fat_g"])

    targets = calculate_targets(current_user)
    avg = {
        "kcal":      round(sum(d["kcal"]      for d in days) / 7),
        "protein_g": round(sum(d["protein_g"] for d in days) / 7),
        "carbs_g":   round(sum(d["carbs_g"]   for d in days) / 7),
        "fat_g":     round(sum(d["fat_g"]     for d in days) / 7),
    }

    return {"success": True, "days": days, "averages": avg, "targets": targets}


@router.post("/analyze-photo")
async def analyze_photo(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """
    Analyze a meal photo using Groq vision AI.
    Returns estimated calories and macros for all visible food items.
    Accepts JPEG, PNG, WebP. Max 10MB. Limited to 8/day per user.
    """
    # Quota FIRST, before reading any bytes. This is the app's one genuinely
    # expensive metered feature — fail CLOSED if Redis can't meter it.
    await enforce_daily_quota(
        current_user["_id"], "photo", PHOTO_DAILY_LIMIT, fail_open=False
    )

    # ── Validate file ─────────────────────────────────────────────────────────
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/jpg"}
    mime_type = file.content_type or "image/jpeg"

    if mime_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {mime_type}. Use JPEG, PNG, or WebP.",
        )

    image_bytes = await file.read()

    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large. Maximum size is 10MB.")
    if len(image_bytes) < 1000:
        raise HTTPException(status_code=400, detail="Image too small or empty.")

    # ── Run AI analysis (worker thread — the vision call is synchronous and
    # previously blocked the entire event loop for its full duration) ─────────
    import asyncio
    from app.ai.nutrition.photo_analyzer import analyze_meal_photo

    try:
        result = await asyncio.to_thread(
            analyze_meal_photo, image_bytes, mime_type=mime_type
        )
    except Exception:
        log.exception("Photo analysis crashed for user %s", current_user["_id"])
        raise HTTPException(status_code=502, detail="Analysis service failed. Please try again.")

    if not result["success"]:
        raise HTTPException(status_code=422, detail=result.get("error", "Analysis failed"))

    return {
        "success":  True,
        "analysis": result["analysis"],
    }
