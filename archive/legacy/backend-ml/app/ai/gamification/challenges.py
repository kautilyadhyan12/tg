"""
Phase 12 — Weekly challenge generator.
Generates 3 personalized challenges per user per week.
Challenges auto-rotate every Monday.
"""

from datetime import datetime, timedelta
import random
import hashlib


# ── Challenge templates ───────────────────────────────────────────────────────
# Each template has: id, name, description, metric, target, xp_reward, tier
CHALLENGE_TEMPLATES = [
    # ── Workout volume ────────────────────────────────────────────────────────
    {
        "id":          "weekly_workouts_3",
        "name":        "Consistent Trainer",
        "description": "Complete 3 workouts this week",
        "metric":      "workouts_completed",
        "target":      3,
        "xp_reward":   200,
        "difficulty":  "easy",
        "icon":        "💪",
    },
    {
        "id":          "weekly_workouts_5",
        "name":        "High Volume",
        "description": "Complete 5 workouts this week",
        "metric":      "workouts_completed",
        "target":      5,
        "xp_reward":   400,
        "difficulty":  "medium",
        "icon":        "🔥",
    },
    {
        "id":          "weekly_workouts_7",
        "name":        "Every Day Counts",
        "description": "Workout every day this week (7/7)",
        "metric":      "workouts_completed",
        "target":      7,
        "xp_reward":   700,
        "difficulty":  "hard",
        "icon":        "⚡",
    },

    # ── Calories ──────────────────────────────────────────────────────────────
    {
        "id":          "weekly_calories_1500",
        "name":        "Calorie Crusher",
        "description": "Burn 1,500 calories this week",
        "metric":      "calories_burned",
        "target":      1500,
        "xp_reward":   250,
        "difficulty":  "easy",
        "icon":        "🔥",
    },
    {
        "id":          "weekly_calories_3000",
        "name":        "Inferno Week",
        "description": "Burn 3,000 calories this week",
        "metric":      "calories_burned",
        "target":      3000,
        "xp_reward":   500,
        "difficulty":  "medium",
        "icon":        "🌋",
    },

    # ── Duration ──────────────────────────────────────────────────────────────
    {
        "id":          "weekly_minutes_120",
        "name":        "2 Hours of Sweat",
        "description": "Train for 120 minutes total this week",
        "metric":      "minutes_trained",
        "target":      120,
        "xp_reward":   200,
        "difficulty":  "easy",
        "icon":        "⏱️",
    },
    {
        "id":          "weekly_minutes_300",
        "name":        "5 Hour Grind",
        "description": "Train for 300 minutes total this week",
        "metric":      "minutes_trained",
        "target":      300,
        "xp_reward":   500,
        "difficulty":  "hard",
        "icon":        "⏱️",
    },

    # ── Form quality ──────────────────────────────────────────────────────────
    {
        "id":          "weekly_form_avg",
        "name":        "Quality Focus",
        "description": "Average 80%+ form across all workouts this week",
        "metric":      "avg_form",
        "target":      80,
        "xp_reward":   300,
        "difficulty":  "medium",
        "icon":        "🎯",
    },
    {
        "id":          "weekly_form_high",
        "name":        "Form Perfectionist",
        "description": "Average 90%+ form across all workouts this week",
        "metric":      "avg_form",
        "target":      90,
        "xp_reward":   500,
        "difficulty":  "hard",
        "icon":        "🏆",
    },

    # ── Variety ───────────────────────────────────────────────────────────────
    {
        "id":          "weekly_variety_3",
        "name":        "Mix It Up",
        "description": "Try 3 different exercise categories this week",
        "metric":      "categories_tried",
        "target":      3,
        "xp_reward":   250,
        "difficulty":  "easy",
        "icon":        "🎭",
    },
    {
        "id":          "weekly_variety_5",
        "name":        "Well Rounded",
        "description": "Try 5 different exercise categories this week",
        "metric":      "categories_tried",
        "target":      5,
        "xp_reward":   450,
        "difficulty":  "medium",
        "icon":        "🌈",
    },

    # ── Nutrition ─────────────────────────────────────────────────────────────
    {
        "id":          "weekly_meals_15",
        "name":        "Track Everything",
        "description": "Log 15 meals this week",
        "metric":      "meals_logged",
        "target":      15,
        "xp_reward":   200,
        "difficulty":  "easy",
        "icon":        "🍽️",
    },
    {
        "id":          "weekly_meals_21",
        "name":        "Full Logger",
        "description": "Log 21 meals this week (3/day)",
        "metric":      "meals_logged",
        "target":      21,
        "xp_reward":   400,
        "difficulty":  "medium",
        "icon":        "📊",
    },

    # ── Engagement ────────────────────────────────────────────────────────────
    {
        "id":          "weekly_coach_3",
        "name":        "Ask the Coach",
        "description": "Ask the AI Coach 3 questions this week",
        "metric":      "coach_messages",
        "target":      3,
        "xp_reward":   150,
        "difficulty":  "easy",
        "icon":        "💬",
    },
]


# ── Helpers ───────────────────────────────────────────────────────────────────
def get_week_start(d: datetime | None = None) -> datetime:
    """Get the Monday of the current ISO week (UTC, midnight)."""
    d = d or datetime.utcnow()
    monday = d - timedelta(days=d.weekday())
    return monday.replace(hour=0, minute=0, second=0, microsecond=0)


def get_week_end(d: datetime | None = None) -> datetime:
    """Get the Sunday end of the current ISO week (UTC, 23:59:59)."""
    start = get_week_start(d)
    return start + timedelta(days=6, hours=23, minutes=59, seconds=59)


def get_week_key(d: datetime | None = None) -> str:
    """Get a unique key for the current week (e.g. '2026-W21')."""
    d        = d or datetime.utcnow()
    year, wk = d.isocalendar().year, d.isocalendar().week
    return f"{year}-W{wk:02d}"


def select_user_challenges(user_id: str, week_key: str, fitness_level: str = "beginner") -> list[dict]:
    """
    Deterministically select 3 challenges for a user for a given week.
    Same user + same week = same challenges every time (no flakiness).

    Mix of difficulties based on fitness level:
      - beginner:     2 easy + 1 medium
      - intermediate: 1 easy + 1 medium + 1 hard
      - advanced:     1 medium + 2 hard
    """
    # Seed RNG with user_id + week_key for deterministic per-user-per-week selection
    seed_str = f"{user_id}:{week_key}"
    seed     = int(hashlib.md5(seed_str.encode()).hexdigest()[:8], 16)
    rng      = random.Random(seed)

    by_difficulty = {"easy": [], "medium": [], "hard": []}
    for c in CHALLENGE_TEMPLATES:
        by_difficulty[c["difficulty"]].append(c)

    if fitness_level == "advanced":
        mix = [("medium", 1), ("hard", 2)]
    elif fitness_level == "intermediate":
        mix = [("easy", 1), ("medium", 1), ("hard", 1)]
    else:
        mix = [("easy", 2), ("medium", 1)]

    selected = []
    for diff, count in mix:
        pool = by_difficulty[diff].copy()
        rng.shuffle(pool)
        selected.extend(pool[:count])

    # If we ran out of options in some buckets, top up from anywhere
    while len(selected) < 3:
        all_pool = [c for c in CHALLENGE_TEMPLATES if c not in selected]
        if not all_pool:
            break
        rng.shuffle(all_pool)
        selected.append(all_pool[0])

    return selected[:3]


def get_challenge_by_id(challenge_id: str) -> dict | None:
    """Look up challenge template by ID."""
    for c in CHALLENGE_TEMPLATES:
        if c["id"] == challenge_id:
            return c
    return None