"""
Phase 12 — Gamification API
Endpoints: badges, challenges, leaderboard, user gamification stats.
"""

from fastapi  import APIRouter, Depends
from datetime import datetime, timedelta, time

from app.db.mongo                       import get_db
from app.core.security                  import get_current_user
from app.ai.gamification.badges         import (
    ALL_BADGES, check_badges, xp_progress, get_badge_by_id, TIER_XP,
)
from app.ai.gamification.challenges     import (
    select_user_challenges, get_week_key, get_week_start, get_week_end,
    get_challenge_by_id, CHALLENGE_TEMPLATES,
)

router = APIRouter(prefix="/gamification", tags=["Gamification"])


# ── Helpers ───────────────────────────────────────────────────────────────────
async def compute_user_stats(db, user_id) -> dict:
    """
    Compute all stats needed for badge checks and challenge progress.
    Returns a dict that both badge engine and challenge engine consume.
    """
    # ── Workouts ──────────────────────────────────────────────────────────────
    sessions = await db.workout_sessions.find(
        {"user_id": user_id, "completed": True},
        {"completed_at": 1, "calories_burned": 1, "duration_minutes": 1,
         "form_accuracy": 1, "exercises": 1}
    ).to_list(2000)

    total_workouts = len(sessions)
    total_calories = sum(s.get("calories_burned",  0) for s in sessions)
    total_minutes  = sum(s.get("duration_minutes", 0) for s in sessions)

    # Form
    forms = [s.get("form_accuracy", 0) for s in sessions if s.get("form_accuracy")]
    avg_form_last_5 = (
        sum(sorted(forms, key=lambda x: 1)[-5:]) / min(5, len(forms))
        if forms else 0
    )
    perfect_form_count = sum(1 for f in forms if f >= 100)

    # Time of day buckets
    morning_workouts = 0
    night_workouts   = 0
    for s in sessions:
        if not s.get("completed_at"):
            continue
        h = s["completed_at"].hour
        if h < 8:
            morning_workouts += 1
        elif h >= 21:
            night_workouts += 1

    # Categories tried
    categories_tried = set()
    for s in sessions:
        for ex in s.get("exercises", []):
            if isinstance(ex, dict):
                cat = ex.get("primary_category") or ex.get("category")
                if cat:
                    categories_tried.add(cat)

    # ── Meals ─────────────────────────────────────────────────────────────────
    total_meals = await db.meal_logs.count_documents({"user_id": user_id})

    # Photo-logged meals (notes contain "Estimated from photo")
    photo_meals_logged = await db.meal_logs.count_documents({
        "user_id": user_id,
        "notes":   {"$regex": "Estimated from photo", "$options": "i"},
    })

    # Protein target streak — count consecutive past days hitting protein
    protein_target_streak = await _compute_protein_streak(db, user_id)

    # ── Coach messages ────────────────────────────────────────────────────────
    coach_messages = 0
    try:
        conversations = await db.coach_conversations.find(
            {"user_id": user_id}, {"messages": 1}
        ).to_list(100)
        for c in conversations:
            for m in c.get("messages", []):
                if m.get("role") == "user":
                    coach_messages += 1
    except Exception:
        pass

    # ── User streak ───────────────────────────────────────────────────────────
    user = await db.users.find_one({"_id": user_id})
    current_streak = user.get("streak", 0) if user else 0

    return {
        "total_workouts":        total_workouts,
        "total_calories":        round(total_calories),
        "total_minutes":         round(total_minutes),
        "current_streak":        current_streak,
        "avg_form_last_5":       round(avg_form_last_5, 1),
        "perfect_form_count":    perfect_form_count,
        "morning_workouts":      morning_workouts,
        "night_workouts":        night_workouts,
        "categories_tried":      categories_tried,
        "total_meals":           total_meals,
        "photo_meals_logged":    photo_meals_logged,
        "protein_target_streak": protein_target_streak,
        "coach_messages":        coach_messages,
    }


async def _compute_protein_streak(db, user_id) -> int:
    """Count consecutive recent days where protein target was hit."""
    user = await db.users.find_one({"_id": user_id})
    if not user:
        return 0

    # Get protein target from user profile
    from app.routers.nutrition import calculate_targets
    targets = calculate_targets(user)
    protein_target = targets.get("protein_g", 150)

    streak = 0
    for i in range(30):  # check last 30 days
        day        = datetime.utcnow().date() - timedelta(days=i)
        start, end = datetime.combine(day, time.min), datetime.combine(day, time.max)

        agg = await db.meal_logs.aggregate([
            {"$match": {
                "user_id":     user_id,
                "consumed_at": {"$gte": start, "$lte": end}
            }},
            {"$group": {"_id": None, "p": {"$sum": "$protein_g"}}}
        ]).to_list(1)

        protein = agg[0]["p"] if agg else 0
        if protein >= protein_target * 0.9:    # 90% counts as a hit
            streak += 1
        else:
            break

    return streak


async def compute_challenge_progress(db, user_id, challenges: list, week_start, week_end) -> list[dict]:
    """For each challenge, compute current progress out of target."""
    # Pull this week's data once
    sessions = await db.workout_sessions.find({
        "user_id":      user_id,
        "completed":    True,
        "completed_at": {"$gte": week_start, "$lte": week_end},
    }).to_list(200)

    meals_count = await db.meal_logs.count_documents({
        "user_id":     user_id,
        "consumed_at": {"$gte": week_start, "$lte": week_end},
    })

    # Coach messages this week
    coach_messages = 0
    try:
        conversations = await db.coach_conversations.find(
            {"user_id": user_id, "updated_at": {"$gte": week_start}},
            {"messages": 1}
        ).to_list(50)
        for c in conversations:
            for m in c.get("messages", []):
                ts = m.get("timestamp")
                if ts and ts >= week_start and m.get("role") == "user":
                    coach_messages += 1
    except Exception:
        pass

    workouts_completed = len(sessions)
    calories_burned    = sum(s.get("calories_burned",  0) for s in sessions)
    minutes_trained    = sum(s.get("duration_minutes", 0) for s in sessions)

    forms     = [s.get("form_accuracy", 0) for s in sessions if s.get("form_accuracy")]
    avg_form  = round(sum(forms) / len(forms), 1) if forms else 0

    cats_tried = set()
    for s in sessions:
        for ex in s.get("exercises", []):
            if isinstance(ex, dict):
                cat = ex.get("primary_category") or ex.get("category")
                if cat:
                    cats_tried.add(cat)

    metric_values = {
        "workouts_completed": workouts_completed,
        "calories_burned":    round(calories_burned),
        "minutes_trained":    round(minutes_trained),
        "avg_form":           avg_form,
        "categories_tried":   len(cats_tried),
        "meals_logged":       meals_count,
        "coach_messages":     coach_messages,
    }

    result = []
    for c in challenges:
        current  = metric_values.get(c["metric"], 0)
        target   = c["target"]
        progress = min(100, round((current / target) * 100, 1)) if target else 0
        completed = current >= target

        result.append({
            **c,
            "current":   current,
            "progress":  progress,
            "completed": completed,
        })

    return result


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/overview")
async def get_overview(current_user: dict = Depends(get_current_user)):
    """
    Master gamification endpoint. Returns:
      - User XP/level info
      - Earned badges
      - This week's challenges with progress
    """
    db      = get_db()
    user_id = current_user["_id"]

    # Compute everything
    stats = await compute_user_stats(db, user_id)

    # User XP/level
    user = await db.users.find_one({"_id": user_id})
    xp   = user.get("xp", 0) if user else 0
    progress = xp_progress(xp)

    # Earned badges
    earned_ids   = check_badges(stats)
    earned_set   = set(earned_ids)

    # Get previously-stored earned badges to detect new ones
    stored_badges = set((user or {}).get("badges", []))
    new_badges    = earned_set - stored_badges

    # Persist if there are new ones (and update XP for those)
    if new_badges:
        new_xp = 0
        for bid in new_badges:
            badge = get_badge_by_id(bid)
            if badge:
                new_xp += TIER_XP.get(badge["tier"], 50)

        await db.users.update_one(
            {"_id": user_id},
            {
                "$set":      {"badges": list(earned_set)},
                "$inc":      {"xp": new_xp},
            }
        )
        xp += new_xp
        progress = xp_progress(xp)

    # Build badges list with full info + earned flag
    badges = []
    for b in ALL_BADGES:
        badges.append({
            **b,
            "earned":    b["id"] in earned_set,
            "xp_reward": TIER_XP.get(b["tier"], 50),
            "is_new":    b["id"] in new_badges,
        })

    # Challenges
    fitness_level = (user.get("fitnessLevel") if user else None) or "beginner"
    week_key      = get_week_key()
    week_start    = get_week_start()
    week_end      = get_week_end()

    selected     = select_user_challenges(str(user_id), week_key, fitness_level)
    challenges   = await compute_challenge_progress(db, user_id, selected, week_start, week_end)

    # Award challenge completion XP (once)
    completed_key = (user or {}).get("completed_challenges", {})
    if not isinstance(completed_key, dict):
        completed_key = {}

    week_completed = set(completed_key.get(week_key, []))
    new_completions = set()
    challenge_xp_earned = 0

    for c in challenges:
        if c["completed"] and c["id"] not in week_completed:
            new_completions.add(c["id"])
            challenge_xp_earned += c["xp_reward"]

    if new_completions:
        week_completed.update(new_completions)
        completed_key[week_key] = list(week_completed)
        await db.users.update_one(
            {"_id": user_id},
            {
                "$set": {"completed_challenges": completed_key},
                "$inc": {"xp": challenge_xp_earned},
            }
        )
        xp += challenge_xp_earned
        progress = xp_progress(xp)

    # Update level if changed
    if user and progress["level"] != user.get("level"):
        await db.users.update_one(
            {"_id": user_id},
            {"$set": {"level": progress["level"]}}
        )

    return {
        "success": True,
        "user": {
            "xp":       xp,
            "level":    progress["level"],
            "progress": progress,
        },
        "badges": {
            "all":           badges,
            "earned_count":  len(earned_set),
            "total_count":   len(ALL_BADGES),
            "newly_earned":  list(new_badges),
        },
        "challenges": {
            "week_key":       week_key,
            "week_start":     week_start.isoformat(),
            "week_end":       week_end.isoformat(),
            "active":         challenges,
            "completed_now":  list(new_completions),
            "xp_earned_now":  challenge_xp_earned,
        },
        "stats": {
            k: list(v) if isinstance(v, set) else v
            for k, v in stats.items()
        },
    }


@router.get("/badges")
async def get_badges(current_user: dict = Depends(get_current_user)):
    """List all badges with earned status for current user."""
    db    = get_db()
    user  = await db.users.find_one({"_id": current_user["_id"]})
    stored = set((user or {}).get("badges", []))

    badges = []
    for b in ALL_BADGES:
        badges.append({
            **b,
            "earned":    b["id"] in stored,
            "xp_reward": TIER_XP.get(b["tier"], 50),
        })

    return {
        "success":      True,
        "badges":       badges,
        "earned_count": len(stored),
        "total_count":  len(ALL_BADGES),
    }


@router.get("/leaderboard")
async def get_leaderboard(
    limit:        int = Query(20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
):
    """
    Get top users by XP (global leaderboard).
    Returns the top N + the current user's rank if not in top N.
    """
    db = get_db()

    # Get top users
    top_users = await db.users.find(
        {"isActive": True},
        {
            "fullName": 1, "profilePicture": 1,
            "xp": 1, "level": 1, "streak": 1, "badges": 1,
        }
    ).sort("xp", -1).limit(limit).to_list(limit)

    leaderboard = []
    current_user_in_top = False

    for i, u in enumerate(top_users, 1):
        is_current = str(u["_id"]) == str(current_user["_id"])
        if is_current:
            current_user_in_top = True

        leaderboard.append({
            "rank":           i,
            "user_id":        str(u["_id"]),
            "name":           u.get("fullName", "Anonymous"),
            "avatar":         u.get("profilePicture", ""),
            "xp":             u.get("xp", 0),
            "level":          u.get("level", 1),
            "streak":         u.get("streak", 0),
            "badge_count":    len(u.get("badges", [])),
            "is_current_user": is_current,
        })

    # If current user not in top N, compute their rank
    current_rank = None
    if not current_user_in_top:
        rank = await db.users.count_documents({
            "isActive": True,
            "xp":       {"$gt": current_user.get("xp", 0)},
        })
        current_rank = rank + 1

    return {
        "success":           True,
        "leaderboard":       leaderboard,
        "current_user_rank": current_rank,
        "total_users":       await db.users.count_documents({"isActive": True}),
    }