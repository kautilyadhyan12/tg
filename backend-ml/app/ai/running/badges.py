"""
Running badges + XP — fully isolated from the existing gamification system.

Why separate: the app already has app/ai/gamification/badges.py with its own XP
rewards, badges, and the shared user.xp / user.level / user.streak fields used
by the workout flow. To guarantee the running feature does NOT change or
interfere with that existing behavior, running keeps its own:

    user.running_xp        (separate from user.xp)
    user.running_badges    (separate from user.badges)
    user.running_streak / user.lastRunDate

The only thing we reuse from the existing module is the *level curve*
(`level_for_xp`) — a pure, read-only function — so running levels feel
consistent with workout levels without sharing state.
"""

from app.ai.gamification.badges import level_for_xp  # read-only reuse

# XP rewards specific to running.
RUN_XP = {
    "run_completed":       60,
    "distance_per_km":     8,    # per full km, rewards longer runs
    "streak_day":          12,
    "new_distance_pr":     40,
    "negative_split":      25,    # second half faster than first
}

# Running badge catalogue. `check` is evaluated against a stats dict.
RUNNING_BADGES = [
    {"id": "first_run",      "name": "First Steps",     "tier": "bronze",
     "desc": "Complete your first run",            "check": lambda s: s["total_runs"] >= 1},
    {"id": "five_k",         "name": "5K Finisher",     "tier": "silver",
     "desc": "Finish a single run of 5 km or more", "check": lambda s: s["max_distance_km"] >= 5},
    {"id": "ten_k",          "name": "10K Club",        "tier": "gold",
     "desc": "Finish a single run of 10 km or more","check": lambda s: s["max_distance_km"] >= 10},
    {"id": "half_marathon",  "name": "Half Marathon",   "tier": "platinum",
     "desc": "Finish a run of 21.1 km or more",    "check": lambda s: s["max_distance_km"] >= 21.1},
    {"id": "early_bird",     "name": "Early Bird",      "tier": "bronze",
     "desc": "Complete a run before 7am",          "check": lambda s: s["has_early_run"]},
    {"id": "night_owl",      "name": "Night Owl",       "tier": "bronze",
     "desc": "Complete a run after 9pm",           "check": lambda s: s["has_night_run"]},
    {"id": "consistent_5",   "name": "On a Roll",       "tier": "silver",
     "desc": "Reach a 5-day running streak",       "check": lambda s: s["running_streak"] >= 5},
    {"id": "distance_50",    "name": "Half Century",    "tier": "gold",
     "desc": "Run 50 km in total",                 "check": lambda s: s["total_distance_km"] >= 50},
]

TIER_RUN_XP = {"bronze": 30, "silver": 60, "gold": 120, "platinum": 250}

_BADGE_BY_ID = {b["id"]: b for b in RUNNING_BADGES}


def get_running_badge_by_id(badge_id: str):
    b = _BADGE_BY_ID.get(badge_id)
    if not b:
        return None
    return {k: v for k, v in b.items() if k != "check"}


def check_running_badges(stats: dict) -> list:
    """Return the list of running-badge ids earned given a stats dict."""
    earned = []
    for b in RUNNING_BADGES:
        try:
            if b["check"](stats):
                earned.append(b["id"])
        except (KeyError, TypeError):
            continue
    return earned


def running_level_for_xp(running_xp: int) -> int:
    """Running level uses the same curve as the main app, for consistency."""
    return level_for_xp(running_xp)
