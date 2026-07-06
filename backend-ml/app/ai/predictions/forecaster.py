"""
Phase 10 — Predictive Analytics
Uses Prophet for time-series forecasting (calories/workouts trends)
and XGBoost for classification (will user hit weekly goal).
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from prophet import Prophet
import xgboost as xgb
import logging
import warnings

# Silence Prophet's verbose logging
logging.getLogger("prophet").setLevel(logging.WARNING)
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)


# ── Min data requirements ─────────────────────────────────────────────────────
MIN_SESSIONS_FOR_FORECAST  = 5   # Need at least 5 sessions to forecast
MIN_SESSIONS_FOR_PLATEAU   = 8   # Need at least 8 to detect plateau
MIN_SESSIONS_FOR_TIME_PREF = 6   # Need 6 to analyze time-of-day patterns


# ── Forecast calorie burn for next 7 days ─────────────────────────────────────
def forecast_calories(sessions: list, horizon_days: int = 7) -> dict:
    """
    Forecast next N days of calorie burn using Prophet.
    Returns total predicted calories + per-day breakdown.
    """
    if len(sessions) < MIN_SESSIONS_FOR_FORECAST:
        return {
            "available": False,
            "reason":    f"Need at least {MIN_SESSIONS_FOR_FORECAST} workouts (you have {len(sessions)})",
            "predicted_total": 0,
            "daily_forecast":  [],
        }

    # Build daily calorie data
    daily = {}
    for s in sessions:
        if not s.get("completed_at") or not s.get("calories_burned"):
            continue
        day = s["completed_at"].date()
        daily[day] = daily.get(day, 0) + s["calories_burned"]

    if len(daily) < MIN_SESSIONS_FOR_FORECAST:
        return {
            "available": False,
            "reason":    "Not enough unique workout days",
            "predicted_total": 0,
            "daily_forecast":  [],
        }

    # Fill missing days with 0 (rest days)
    sorted_days = sorted(daily.keys())
    start_day   = sorted_days[0]
    end_day     = sorted_days[-1]

    all_days = []
    current  = start_day
    while current <= end_day:
        all_days.append({
            "ds": pd.Timestamp(current),
            "y":  daily.get(current, 0),
        })
        current += timedelta(days=1)

    df = pd.DataFrame(all_days)

    # Train Prophet
    try:
        model = Prophet(
            daily_seasonality   = False,
            weekly_seasonality  = True,
            yearly_seasonality  = False,
            interval_width      = 0.80,
            changepoint_prior_scale = 0.05,
        )
        model.fit(df)
    except Exception as e:
        return {
            "available": False,
            "reason":    f"Forecast failed: {str(e)}",
            "predicted_total": 0,
            "daily_forecast":  [],
        }

    # Predict next N days
    future   = model.make_future_dataframe(periods=horizon_days)
    forecast = model.predict(future)

    future_only = forecast.tail(horizon_days)

    daily_forecast = []
    for _, row in future_only.iterrows():
        daily_forecast.append({
            "date":  row["ds"].strftime("%Y-%m-%d"),
            "value": max(0, round(float(row["yhat"]))),
            "lower": max(0, round(float(row["yhat_lower"]))),
            "upper": max(0, round(float(row["yhat_upper"]))),
        })

    predicted_total = sum(d["value"] for d in daily_forecast)

    return {
        "available":       True,
        "predicted_total": predicted_total,
        "daily_forecast":  daily_forecast,
        "horizon_days":    horizon_days,
    }


# ── Predict probability of hitting weekly goal ────────────────────────────────
def predict_weekly_goal(sessions: list, target_per_week: int = 3) -> dict:
    """
    Predict probability that user hits their weekly workout target.
    Uses XGBoost on simple features (day of week patterns, recent trend).
    """
    if len(sessions) < MIN_SESSIONS_FOR_FORECAST:
        return {
            "available":   False,
            "reason":      "Not enough history",
            "probability": 0,
            "target":      target_per_week,
            "current":     0,
        }

    # Group by ISO week
    week_counts = {}
    for s in sessions:
        if not s.get("completed_at"):
            continue
        dt   = s["completed_at"]
        week = (dt.isocalendar().year, dt.isocalendar().week)
        week_counts[week] = week_counts.get(week, 0) + 1

    if len(week_counts) < 3:
        return {
            "available":   False,
            "reason":      "Need at least 3 weeks of history",
            "probability": 0,
            "target":      target_per_week,
            "current":     week_counts.get(
                (datetime.utcnow().isocalendar().year,
                 datetime.utcnow().isocalendar().week), 0),
        }

    # Build training data: feature = last 3 weeks of workout counts, label = next week hit target?
    sorted_weeks = sorted(week_counts.keys())
    counts       = [week_counts[w] for w in sorted_weeks]

    X, y = [], []
    for i in range(3, len(counts)):
        X.append([counts[i-3], counts[i-2], counts[i-1]])
        y.append(1 if counts[i] >= target_per_week else 0)

    current_week = (datetime.utcnow().isocalendar().year, datetime.utcnow().isocalendar().week)
    current      = week_counts.get(current_week, 0)

    # If only one class exists in labels, can't train classifier
    if len(set(y)) < 2 or len(X) < 2:
        # Fallback: simple average rate
        avg_hit_rate = sum(1 for c in counts if c >= target_per_week) / max(len(counts), 1)
        return {
            "available":   True,
            "probability": round(avg_hit_rate * 100),
            "target":      target_per_week,
            "current":     current,
            "method":      "average",
        }

    # Train XGBoost
    try:
        model = xgb.XGBClassifier(
            n_estimators = 50,
            max_depth    = 3,
            learning_rate= 0.1,
            verbosity    = 0,
            eval_metric  = "logloss",
            use_label_encoder = False,
        )
        model.fit(np.array(X), np.array(y))

        # Predict on most recent 3 weeks
        recent_features = np.array([counts[-3:]])
        prob = float(model.predict_proba(recent_features)[0][1])
    except Exception:
        avg_hit_rate = sum(1 for c in counts if c >= target_per_week) / max(len(counts), 1)
        prob = avg_hit_rate

    return {
        "available":   True,
        "probability": round(prob * 100),
        "target":      target_per_week,
        "current":     current,
        "method":      "xgboost",
    }


# ── Detect plateau in calorie/duration trends ─────────────────────────────────
def detect_plateau(sessions: list) -> dict:
    """
    Detect if user's calorie burn / workout duration has been flat
    for the last 2+ weeks.
    Returns whether a plateau is detected and on which metric.
    """
    if len(sessions) < MIN_SESSIONS_FOR_PLATEAU:
        return {
            "available": False,
            "detected":  False,
            "reason":    f"Need at least {MIN_SESSIONS_FOR_PLATEAU} workouts",
            "metrics":   {},
        }

    # Sort by date
    sorted_sessions = sorted(
        [s for s in sessions if s.get("completed_at")],
        key=lambda s: s["completed_at"]
    )

    # Split into "older half" vs "recent 2 weeks"
    cutoff = datetime.utcnow() - timedelta(days=14)
    older  = [s for s in sorted_sessions if s["completed_at"] < cutoff]
    recent = [s for s in sorted_sessions if s["completed_at"] >= cutoff]

    if len(older) < 3 or len(recent) < 3:
        return {
            "available": False,
            "detected":  False,
            "reason":    "Need more data spread across time",
            "metrics":   {},
        }

    # Compute averages
    def avg(arr, key):
        vals = [s.get(key, 0) for s in arr if s.get(key)]
        return sum(vals) / len(vals) if vals else 0

    old_cal,    new_cal    = avg(older, "calories_burned"),  avg(recent, "calories_burned")
    old_dur,    new_dur    = avg(older, "duration_minutes"), avg(recent, "duration_minutes")
    old_form,   new_form   = avg(older, "form_accuracy"),    avg(recent, "form_accuracy")

    # Compute % change
    def pct_change(old, new):
        if old == 0:
            return 0
        return ((new - old) / old) * 100

    cal_change  = pct_change(old_cal,  new_cal)
    dur_change  = pct_change(old_dur,  new_dur)
    form_change = pct_change(old_form, new_form)

    # Plateau = all 3 metrics within ±5% of older average
    plateau = abs(cal_change) < 5 and abs(dur_change) < 5 and abs(form_change) < 5

    return {
        "available": True,
        "detected":  plateau,
        "metrics": {
            "calories": {"old": round(old_cal),  "new": round(new_cal),  "change_pct": round(cal_change, 1)},
            "duration": {"old": round(old_dur),  "new": round(new_dur),  "change_pct": round(dur_change, 1)},
            "form":     {"old": round(old_form), "new": round(new_form), "change_pct": round(form_change, 1)},
        },
    }


# ── Find best workout time of day ─────────────────────────────────────────────
def analyze_best_time(sessions: list) -> dict:
    """
    Analyze form scores by time of day.
    Returns the time period with the best performance.
    """
    if len(sessions) < MIN_SESSIONS_FOR_TIME_PREF:
        return {
            "available":   False,
            "reason":      f"Need at least {MIN_SESSIONS_FOR_TIME_PREF} workouts",
            "best_time":   None,
            "breakdown":   {},
        }

    # Bucket by time of day
    buckets = {
        "morning":   {"forms": [], "calories": [], "hours": (5, 12)},
        "afternoon": {"forms": [], "calories": [], "hours": (12, 17)},
        "evening":   {"forms": [], "calories": [], "hours": (17, 22)},
        "night":     {"forms": [], "calories": [], "hours": (22, 5)},
    }

    for s in sessions:
        if not s.get("completed_at"):
            continue
        hour = s["completed_at"].hour
        form = s.get("form_accuracy", 0)
        cals = s.get("calories_burned", 0)

        for name, b in buckets.items():
            lo, hi = b["hours"]
            if lo < hi and lo <= hour < hi:
                b["forms"].append(form)
                b["calories"].append(cals)
                break
            elif lo > hi and (hour >= lo or hour < hi):
                b["forms"].append(form)
                b["calories"].append(cals)
                break

    breakdown = {}
    for name, b in buckets.items():
        if b["forms"]:
            breakdown[name] = {
                "count":        len(b["forms"]),
                "avg_form":     round(sum(b["forms"]) / len(b["forms"]), 1),
                "avg_calories": round(sum(b["calories"]) / len(b["calories"])),
            }

    if not breakdown:
        return {
            "available":   False,
            "reason":      "No workouts with valid timestamps",
            "best_time":   None,
            "breakdown":   {},
        }

    # Best by form score, requires at least 2 sessions in that bucket
    valid = {k: v for k, v in breakdown.items() if v["count"] >= 2}
    if not valid:
        return {
            "available":   True,
            "best_time":   None,
            "reason":      "Need at least 2 workouts in each time bucket",
            "breakdown":   breakdown,
        }

    best_time = max(valid.items(), key=lambda kv: kv[1]["avg_form"])

    return {
        "available":   True,
        "best_time":   best_time[0],
        "best_form":   best_time[1]["avg_form"],
        "best_count":  best_time[1]["count"],
        "breakdown":   breakdown,
    }


# ── Master function — runs all 4 predictions ──────────────────────────────────
def get_all_predictions(sessions: list, target_per_week: int = 3) -> dict:
    """Run all prediction models and return combined result."""
    return {
        "calorie_forecast":  forecast_calories(sessions, horizon_days=7),
        "weekly_goal":       predict_weekly_goal(sessions, target_per_week),
        "plateau":           detect_plateau(sessions),
        "best_time":         analyze_best_time(sessions),
        "total_sessions":    len(sessions),
        "generated_at":      datetime.utcnow().isoformat(),
    }