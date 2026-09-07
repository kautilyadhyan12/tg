"""
Weather-aware scheduling — Open-Meteo (free, keyless).

Given a location and a scheduled date/time, fetch the hourly forecast and flag
running-relevant risks: rain, heat, cold, and wind. This never blocks a
schedule; it only informs the user with a badge on the run card.

Honest limits:
  * Open-Meteo provides ~7 days of hourly forecast. For runs scheduled beyond
    that horizon we return risk="unknown" rather than guessing.
  * No new dependency: the HTTP call uses urllib inside asyncio.to_thread,
    matching routing_provider.py.
"""

import asyncio
from datetime import datetime

from app.ai.running.routing_provider import _http_get_json

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"

# Thresholds (apparent temperature in °C, wind in km/h, precip probability %).
HEAT_C = 32.0
COLD_C = 0.0
WIND_KMH = 30.0
RAIN_PROB = 60.0
RAIN_MM = 0.5


def _build_url(lat: float, lng: float) -> str:
    hourly = ",".join([
        "temperature_2m", "apparent_temperature",
        "precipitation_probability", "precipitation", "wind_speed_10m",
    ])
    return (
        f"{OPEN_METEO}?latitude={lat:.4f}&longitude={lng:.4f}"
        f"&hourly={hourly}&forecast_days=7&timezone=auto"
    )


def _nearest_hour_index(times: list, when: datetime) -> int:
    """Index of the forecast hour closest to `when`. -1 if out of range."""
    if not times:
        return -1
    target = when.strftime("%Y-%m-%dT%H:00")
    if target in times:
        return times.index(target)
    # Fall back to nearest by absolute time difference.
    best_i, best_delta = -1, None
    for i, t in enumerate(times):
        try:
            dt = datetime.strptime(t, "%Y-%m-%dT%H:%M")
        except ValueError:
            continue
        delta = abs((dt - when).total_seconds())
        if best_delta is None or delta < best_delta:
            best_i, best_delta = i, delta
    # Only trust it if within ~90 minutes of a forecast slot.
    if best_delta is not None and best_delta <= 90 * 60:
        return best_i
    return -1


async def check_weather(lat: float, lng: float, when: datetime) -> dict:
    """
    Return a weather risk assessment for a run at (lat,lng) at `when`.

    Shape:
      {"risk": "none"|"low"|"moderate"|"high"|"unknown",
       "summary": str, "flags": [str], "details": {...}|None}
    Never raises — on any failure returns risk="unknown".
    """
    try:
        url = _build_url(lat, lng)
        data = await asyncio.to_thread(_http_get_json, url)
        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        idx = _nearest_hour_index(times, when)
        if idx < 0:
            return {
                "risk": "unknown",
                "summary": "Forecast not available for this time yet.",
                "flags": [],
                "details": None,
            }

        temp = hourly.get("apparent_temperature", [None])[idx]
        precip_prob = hourly.get("precipitation_probability", [0])[idx] or 0
        precip_mm = hourly.get("precipitation", [0])[idx] or 0
        wind = hourly.get("wind_speed_10m", [0])[idx] or 0

        flags = []
        if precip_prob >= RAIN_PROB or precip_mm >= RAIN_MM:
            flags.append(f"Rain likely ({int(precip_prob)}% chance)")
        if temp is not None and temp >= HEAT_C:
            flags.append(f"Hot (~{round(temp)}°C feels-like)")
        if temp is not None and temp <= COLD_C:
            flags.append(f"Freezing (~{round(temp)}°C feels-like)")
        if wind >= WIND_KMH:
            flags.append(f"Windy (~{round(wind)} km/h)")

        if not flags:
            risk, summary = "none", "Good conditions expected."
        elif len(flags) == 1 and "Windy" in flags[0]:
            risk, summary = "low", flags[0]
        elif any("Rain" in f or "Freezing" in f for f in flags) and len(flags) >= 2:
            risk, summary = "high", "Tough conditions — consider rescheduling."
        else:
            risk, summary = "moderate", "Dress for the conditions."

        return {
            "risk": risk,
            "summary": summary,
            "flags": flags,
            "details": {
                "apparent_temp_c": None if temp is None else round(temp, 1),
                "precip_probability": int(precip_prob),
                "precip_mm": round(float(precip_mm), 2),
                "wind_kmh": round(float(wind), 1),
            },
        }
    except Exception:
        # Weather is a nice-to-have signal; never let it break scheduling.
        return {
            "risk": "unknown",
            "summary": "Weather check unavailable.",
            "flags": [],
            "details": None,
        }
