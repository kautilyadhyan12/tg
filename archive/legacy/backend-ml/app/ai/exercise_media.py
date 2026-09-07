"""
Exercise media fetcher.
Tries ExerciseDB API for GIFs, falls back gracefully.
"""

import httpx
from app.config import get_settings

settings = get_settings()

EXERCISEDB_BASE = "https://exercisedb.p.rapidapi.com"


async def get_exercise_gif(exercise_name: str) -> dict:
    """
    Fetch exercise GIF URL from ExerciseDB.
    Returns dict with gif_url, video_url, source.
    """
    key = settings.rapidapi_key
    if not key:
        return {"gif_url": None, "source": "none"}

    # Normalize name for search
    search_name = exercise_name.lower().strip()

    try:
        transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")
        async with httpx.AsyncClient(timeout=8.0, transport=transport) as client:
            resp = await client.get(
                f"{EXERCISEDB_BASE}/exercises/name/{search_name}",
                headers={
                    "X-RapidAPI-Key":  key,
                    "X-RapidAPI-Host": "exercisedb.p.rapidapi.com",
                },
            )
            if resp.status_code != 200:
                return {"gif_url": None, "source": "none"}

            data = resp.json()
            if not data or not isinstance(data, list) or len(data) == 0:
                return {"gif_url": None, "source": "none"}

            exercise = data[0]
            gif_url  = exercise.get("gifUrl")

            return {
                "gif_url":  gif_url,
                "source":   "exercisedb",
                "body_part": exercise.get("bodyPart", ""),
                "target":    exercise.get("target", ""),
            }

    except Exception as e:
        print(f"ExerciseDB fetch failed for '{exercise_name}': {e}")
        return {"gif_url": None, "source": "none"}