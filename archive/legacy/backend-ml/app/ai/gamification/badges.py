"""
Phase 12 — Badge definitions.
Each badge has an ID, name, description, icon, tier, and check function.
Check functions receive user stats and return bool.
"""

from datetime import datetime, timedelta


# ── Badge tiers (XP rewards scale with tier) ──────────────────────────────────
TIER_XP = {
    "bronze":   50,
    "silver":   150,
    "gold":     400,
    "platinum": 1000,
}


# ── All badges in the system ──────────────────────────────────────────────────
ALL_BADGES = [
    # ── Workout milestones ────────────────────────────────────────────────────
    {
        "id":          "first_workout",
        "name":        "First Steps",
        "description": "Complete your first workout",
        "icon":        "🎯",
        "tier":        "bronze",
        "category":    "milestones",
    },
    {
        "id":          "ten_workouts",
        "name":        "Getting Serious",
        "description": "Complete 10 workouts",
        "icon":        "💪",
        "tier":        "silver",
        "category":    "milestones",
    },
    {
        "id":          "fifty_workouts",
        "name":        "Dedicated",
        "description": "Complete 50 workouts",
        "icon":        "🏆",
        "tier":        "gold",
        "category":    "milestones",
    },
    {
        "id":          "hundred_workouts",
        "name":        "Centurion",
        "description": "Complete 100 workouts",
        "icon":        "⭐",
        "tier":        "platinum",
        "category":    "milestones",
    },

    # ── Streaks ───────────────────────────────────────────────────────────────
    {
        "id":          "streak_3",
        "name":        "On a Roll",
        "description": "3-day workout streak",
        "icon":        "🔥",
        "tier":        "bronze",
        "category":    "streaks",
    },
    {
        "id":          "streak_7",
        "name":        "Week Warrior",
        "description": "7-day workout streak",
        "icon":        "🔥",
        "tier":        "silver",
        "category":    "streaks",
    },
    {
        "id":          "streak_30",
        "name":        "Unstoppable",
        "description": "30-day workout streak",
        "icon":        "🔥",
        "tier":        "gold",
        "category":    "streaks",
    },
    {
        "id":          "streak_100",
        "name":        "Legendary",
        "description": "100-day workout streak",
        "icon":        "💎",
        "tier":        "platinum",
        "category":    "streaks",
    },

    # ── Form quality ──────────────────────────────────────────────────────────
    {
        "id":          "form_perfect",
        "name":        "Picture Perfect",
        "description": "Achieve 100% form accuracy in a workout",
        "icon":        "🎨",
        "tier":        "silver",
        "category":    "quality",
    },
    {
        "id":          "form_master",
        "name":        "Form Master",
        "description": "Average 90%+ form over 5 workouts",
        "icon":        "🧘",
        "tier":        "gold",
        "category":    "quality",
    },

    # ── Calories burned ───────────────────────────────────────────────────────
    {
        "id":          "calorie_1k",
        "name":        "Calorie Crusher",
        "description": "Burn 1,000 total calories",
        "icon":        "⚡",
        "tier":        "bronze",
        "category":    "intensity",
    },
    {
        "id":          "calorie_10k",
        "name":        "Inferno",
        "description": "Burn 10,000 total calories",
        "icon":        "🌋",
        "tier":        "gold",
        "category":    "intensity",
    },

    # ── Time of day ───────────────────────────────────────────────────────────
    {
        "id":          "early_bird",
        "name":        "Early Bird",
        "description": "Complete 5 workouts before 8am",
        "icon":        "🌅",
        "tier":        "silver",
        "category":    "habits",
    },
    {
        "id":          "night_owl",
        "name":        "Night Owl",
        "description": "Complete 5 workouts after 9pm",
        "icon":        "🌙",
        "tier":        "silver",
        "category":    "habits",
    },

    # ── Variety ───────────────────────────────────────────────────────────────
    {
        "id":          "variety_5",
        "name":        "Well Rounded",
        "description": "Try 5 different exercise categories",
        "icon":        "🎭",
        "tier":        "silver",
        "category":    "variety",
    },
    {
        "id":          "variety_all",
        "name":        "All Rounder",
        "description": "Try all 11 exercise categories",
        "icon":        "🌈",
        "tier":        "gold",
        "category":    "variety",
    },

    # ── Nutrition ─────────────────────────────────────────────────────────────
    {
        "id":          "first_meal",
        "name":        "Fuel Up",
        "description": "Log your first meal",
        "icon":        "🍎",
        "tier":        "bronze",
        "category":    "nutrition",
    },
    {
        "id":          "macro_master",
        "name":        "Macro Master",
        "description": "Hit protein target 7 days in a row",
        "icon":        "🥩",
        "tier":        "gold",
        "category":    "nutrition",
    },

    # ── Coach ─────────────────────────────────────────────────────────────────
    {
        "id":          "first_chat",
        "name":        "Curious Mind",
        "description": "Ask the AI Coach your first question",
        "icon":        "💬",
        "tier":        "bronze",
        "category":    "engagement",
    },

    # ── Photo logging ─────────────────────────────────────────────────────────
    {
        "id":          "photo_meal",
        "name":        "AI Foodie",
        "description": "Log a meal using AI photo analysis",
        "icon":        "📸",
        "tier":        "bronze",
        "category":    "engagement",
    },
]


# ── XP earnings ───────────────────────────────────────────────────────────────
XP_REWARDS = {
    "workout_completed":      50,
    "form_excellent_bonus":   20,    # form ≥ 80%
    "form_perfect_bonus":     50,    # form = 100%
    "streak_day":             10,
    "meal_logged":            5,
    "challenge_completed":    200,
    "coach_message":          2,
    "photo_analyzed":         15,
}


# ── Level curve ───────────────────────────────────────────────────────────────
def xp_for_level(level: int) -> int:
    """
    XP required to REACH the given level.
    Curve: each level needs progressively more XP.
      Level 2: 100 XP
      Level 5: ~625 XP
      Level 10: ~2400 XP
      Level 20: ~9500 XP
      Level 50: ~60000 XP
    """
    if level <= 1:
        return 0
    return int(100 * (level - 1) ** 1.8)


def level_for_xp(xp: int) -> int:
    """Calculate current level given total XP."""
    level = 1
    while xp_for_level(level + 1) <= xp:
        level += 1
        if level > 200:
            break
    return level


def xp_progress(xp: int) -> dict:
    """Return progress info: current_level, next_level, xp_in_level, xp_for_next."""
    current = level_for_xp(xp)
    base    = xp_for_level(current)
    next_   = xp_for_level(current + 1)

    return {
        "level":         current,
        "xp":            xp,
        "xp_in_level":   xp - base,
        "xp_for_next":   next_ - base,
        "progress_pct":  round(((xp - base) / max(next_ - base, 1)) * 100, 1),
        "next_level_at": next_,
    }


# ── Badge check engine ────────────────────────────────────────────────────────
def check_badges(stats: dict) -> list[str]:
    """
    Given user stats, return list of badge IDs the user qualifies for.

    Required stats keys:
        total_workouts, current_streak, total_calories, total_meals,
        coach_messages, photo_meals_logged, perfect_form_count,
        avg_form_last_5, categories_tried (set), morning_workouts,
        night_workouts, protein_target_streak
    """
    earned = []

    # Milestones
    if stats.get("total_workouts", 0) >= 1:    earned.append("first_workout")
    if stats.get("total_workouts", 0) >= 10:   earned.append("ten_workouts")
    if stats.get("total_workouts", 0) >= 50:   earned.append("fifty_workouts")
    if stats.get("total_workouts", 0) >= 100:  earned.append("hundred_workouts")

    # Streaks
    streak = stats.get("current_streak", 0)
    if streak >= 3:    earned.append("streak_3")
    if streak >= 7:    earned.append("streak_7")
    if streak >= 30:   earned.append("streak_30")
    if streak >= 100:  earned.append("streak_100")

    # Form
    if stats.get("perfect_form_count", 0) >= 1:                    earned.append("form_perfect")
    if stats.get("avg_form_last_5", 0) >= 90 and stats.get("total_workouts", 0) >= 5:
        earned.append("form_master")

    # Calories
    if stats.get("total_calories", 0) >= 1000:    earned.append("calorie_1k")
    if stats.get("total_calories", 0) >= 10000:   earned.append("calorie_10k")

    # Time of day
    if stats.get("morning_workouts", 0) >= 5:     earned.append("early_bird")
    if stats.get("night_workouts", 0) >= 5:       earned.append("night_owl")

    # Variety
    cats = stats.get("categories_tried", set())
    if len(cats) >= 5:    earned.append("variety_5")
    if len(cats) >= 11:   earned.append("variety_all")

    # Nutrition
    if stats.get("total_meals", 0) >= 1:                  earned.append("first_meal")
    if stats.get("protein_target_streak", 0) >= 7:       earned.append("macro_master")

    # Engagement
    if stats.get("coach_messages", 0) >= 1:              earned.append("first_chat")
    if stats.get("photo_meals_logged", 0) >= 1:          earned.append("photo_meal")

    return earned


def get_badge_by_id(badge_id: str) -> dict | None:
    """Look up badge metadata by ID."""
    for b in ALL_BADGES:
        if b["id"] == badge_id:
            return b
    return None