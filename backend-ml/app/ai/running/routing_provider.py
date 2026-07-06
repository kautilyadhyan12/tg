"""
Route generation provider.

Two interchangeable modes behind one function, `generate_candidate_routes`:

  1. REAL mode  — OpenRouteService (ORS) "round trip" directions on the
     foot-walking profile. Free tier, OSM-based. Requires ORS_API_KEY.
     We also request ORS `extra_info` (waytype + steepness + surface) so the
     scoring layer can reason about how runnable/safe each road segment is.

  2. MOCK mode  — a purely geometric loop generator (no network, no key).
     Used automatically when the key is missing, the ORS call fails, or ORS
     is rate-limited. This is what keeps the feature demoable on day one and
     keeps it from breaking during a live demo if the free tier is exhausted.

Design choices that matter:
  * No new Python dependency. ORS/Open-Meteo are called with the standard
    library (urllib) inside `asyncio.to_thread`, so adding this feature does
    not change the backend's requirements or risk breaking the existing
    install.
  * Every route is returned in one normalized shape (see `_normalize_route`)
    regardless of source, so the scoring layer and the API don't care whether
    a route came from ORS or the mock generator.
  * Swapping ORS for Mapbox/Google later is a change *only* to this file.
"""

import os
import json
import math
import random
import asyncio
import logging
import urllib.request
import urllib.error

logger = logging.getLogger("running.routing")


def _resolve_api_key() -> str:
    """
    Read the ORS key the same way the rest of the app reads config.

    This app loads .env via pydantic-settings (app.config.Settings), which
    populates the Settings OBJECT but does NOT export values into os.environ.
    So os.getenv("ORS_API_KEY") is empty even when .env has the key. We read
    from Settings first, and only fall back to a real OS env var (useful in
    production/Docker where the key may be a true environment variable).
    """
    try:
        from app.config import get_settings
        key = (get_settings().ors_api_key or "").strip()
        if key:
            return key
    except Exception:
        pass
    return os.getenv("ORS_API_KEY", "").strip()

ORS_BASE = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson"
# The directions endpoint lives on api.openrouteservice.org (still active).
# api.heigit.org returns 404 for this path — it does not expose the same
# /v2/directions route, so we use the openrouteservice host here. The key
# from account.heigit.org works fine against this host.

# ORS waytype codes (from the ORS docs) grouped by how good they are for a
# runner. Used by the scoring layer; defined here next to the source that
# produces them.
WAYTYPE_LABELS = {
    0: "unknown", 1: "state_road", 2: "road", 3: "street", 4: "path",
    5: "track", 6: "cycleway", 7: "footway", 8: "steps", 9: "ferry",
    10: "construction",
}
# Higher = nicer/safer to run on (footways, paths, quiet streets).
SAFE_WAYTYPES = {3, 4, 5, 6, 7}        # street, path, track, cycleway, footway
BUSY_WAYTYPES = {1, 2}                  # state road, road (vehicle-heavy)

EARTH_KM_PER_DEG_LAT = 111.32


def _http_get_json(url: str, timeout: float = 8.0) -> dict:
    """Blocking GET returning parsed JSON. Runs inside a thread."""
    req = urllib.request.Request(url, headers={"User-Agent": "ai-home-gym/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _http_post_json(url: str, body: dict, headers: dict, timeout: float = 12.0) -> dict:
    """Blocking POST of a JSON body returning parsed JSON. Runs inside a thread."""
    data = json.dumps(body).encode("utf-8")
    base_headers = {"Content-Type": "application/json", "User-Agent": "ai-home-gym/1.0"}
    base_headers.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=base_headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ── MOCK generator ────────────────────────────────────────────────────────────

def _mock_loop(lat: float, lng: float, target_km: float, seed: int) -> dict:
    """
    Build a closed polygon loop of roughly `target_km` length around (lat,lng).

    A loop of perimeter L has an approximate radius r = L / (2*pi). We place
    `points` vertices on a circle of that radius, jitter them a little (seeded,
    so the 3 candidates differ but are reproducible within a request), and
    close the loop. Distances use the standard degrees<->km conversion.
    """
    rng = random.Random(seed)
    radius_km = max(0.15, target_km / (2 * math.pi))
    points = 14
    km_per_deg_lng = EARTH_KM_PER_DEG_LAT * max(0.1, math.cos(math.radians(lat)))

    coords = []
    for i in range(points):
        angle = (2 * math.pi * i) / points
        jitter = 1.0 + rng.uniform(-0.18, 0.18)
        r = radius_km * jitter
        dlat = (r * math.sin(angle)) / EARTH_KM_PER_DEG_LAT
        dlng = (r * math.cos(angle)) / km_per_deg_lng
        coords.append([round(lat + dlat, 6), round(lng + dlng, 6)])
    coords.append(coords[0])  # close the loop

    # Synthesize plausible per-route attributes so scoring has something to
    # work with offline. These are clearly approximate (mock mode).
    safe_fraction = round(rng.uniform(0.45, 0.95), 2)
    green_fraction = round(rng.uniform(0.05, 0.55), 2)
    elevation_gain = round(target_km * rng.uniform(3, 22))  # m

    return _normalize_route(
        coords=coords,
        distance_km=round(target_km * rng.uniform(0.92, 1.08), 2),
        elevation_gain_m=elevation_gain,
        safe_fraction=safe_fraction,
        busy_fraction=round(max(0.0, 1 - safe_fraction) * rng.uniform(0.4, 1.0), 2),
        green_fraction=green_fraction,
        source="mock",
        seed=seed,
    )


# ── ORS parsing ───────────────────────────────────────────────────────────────

def _ors_extras_fraction(feature: dict, key: str, code_set: set) -> float:
    """
    ORS returns extras as {"values": [[from_idx, to_idx, code], ...],
    "summary": [{"value": code, "distance": m, "amount": pct}, ...]}.
    We sum the `amount` (percentage of route) for codes in `code_set`.
    """
    try:
        summary = feature["properties"]["extras"][key]["summary"]
    except (KeyError, TypeError):
        return 0.0
    total = 0.0
    for entry in summary:
        if int(entry.get("value", -1)) in code_set:
            total += float(entry.get("amount", 0.0))
    return round(total / 100.0, 3)


def _parse_ors_feature(feature: dict) -> dict:
    geom = feature.get("geometry", {}).get("coordinates", [])
    # ORS returns [lng, lat, (elev)] — convert to [lat, lng] for Leaflet.
    coords = [[round(c[1], 6), round(c[0], 6)] for c in geom if len(c) >= 2]

    props = feature.get("properties", {})
    summary = props.get("summary", {}) or {}
    distance_m = float(summary.get("distance", 0.0))
    ascent = float(props.get("ascent", 0.0) or 0.0)

    safe_fraction = _ors_extras_fraction(feature, "waytypes", SAFE_WAYTYPES)
    busy_fraction = _ors_extras_fraction(feature, "waytypes", BUSY_WAYTYPES)
    # Surface codes 3/4/5/6/7/8 in ORS are unpaved/ground/grass-ish — a decent
    # proxy for parks/trails (greenery) when we have no POI lookup.
    green_fraction = _ors_extras_fraction(feature, "surface", {3, 4, 5, 6, 7, 8})

    return _normalize_route(
        coords=coords,
        distance_km=round(distance_m / 1000.0, 2),
        elevation_gain_m=round(ascent),
        safe_fraction=safe_fraction,
        busy_fraction=busy_fraction,
        green_fraction=green_fraction,
        source="ors",
        seed=None,
    )


def _normalize_route(coords, distance_km, elevation_gain_m, safe_fraction,
                     busy_fraction, green_fraction, source, seed):
    """Single canonical route shape used everywhere downstream."""
    return {
        "coords":            coords,                     # [[lat, lng], ...]
        "distance_km":       distance_km,
        "elevation_gain_m":  elevation_gain_m,
        "safe_fraction":     safe_fraction,              # 0..1 runnable roads
        "busy_fraction":     busy_fraction,              # 0..1 vehicle roads
        "green_fraction":    green_fraction,             # 0..1 park/trail proxy
        "is_loop":           bool(coords) and coords[0] == coords[-1],
        "source":            source,                     # "ors" | "mock"
        "seed":              seed,
    }


def _call_ors(lat: float, lng: float, target_km: float, seed: int, api_key: str) -> dict:
    body = {
        "coordinates": [[lng, lat]],
        "options": {
            "round_trip": {
                "length": int(target_km * 1000),
                "points": 4,
                "seed": seed,
            }
        },
        "elevation": True,
        "instructions": False,
        "extra_info": ["waytype", "steepness", "surface"],
    }
    headers = {"Authorization": api_key}
    data = _http_post_json(ORS_BASE, body, headers)
    feature = data["features"][0]
    return _parse_ors_feature(feature)


async def generate_candidate_routes(
    lat: float,
    lng: float,
    target_km: float,
    count: int = 3,
) -> dict:
    """
    Return `count` candidate routes for a run starting/ending at (lat, lng)
    of roughly `target_km` kilometres.

    Returns: {"routes": [<normalized route>, ...], "mode": "ors"|"mock",
              "notice": <str|None>}. Never raises for an ORS failure — it
    degrades to mock so the caller (and the UI) always gets routes.
    """
    target_km = max(0.5, min(float(target_km), 42.2))
    api_key = _resolve_api_key()
    seeds = [11 + i * 37 for i in range(count)]

    if api_key:
        routes, failed = [], False
        for s in seeds:
            try:
                routes.append(await asyncio.to_thread(
                    _call_ors, lat, lng, target_km, s, api_key
                ))
            except urllib.error.HTTPError as e:
                body = ""
                try:
                    body = e.read().decode("utf-8", errors="replace")[:500]
                except Exception:
                    pass
                logger.warning(
                    "ORS request failed: HTTP %s %s — body: %s",
                    e.code, e.reason, body,
                )
                failed = True
                break
            except urllib.error.URLError as e:
                logger.warning("ORS request failed: URLError — %s", e.reason)
                failed = True
                break
            except (KeyError, IndexError, ValueError, TimeoutError) as e:
                logger.warning(
                    "ORS request failed: %s — %s", type(e).__name__, e
                )
                failed = True
                break
        if routes and not failed:
            return {"routes": routes, "mode": "ors", "notice": None}
        # Partial/total failure → fall through to mock (graceful degrade).
        # See the WARNING log line above this point for the real cause.
        notice = ("Live routing was unavailable, so these routes are "
                  "approximate (offline mode).")
        return {
            "routes": [_mock_loop(lat, lng, target_km, s) for s in seeds],
            "mode": "mock",
            "notice": notice,
        }

    # No key configured: mock mode, with an honest notice for the UI.
    return {
        "routes": [_mock_loop(lat, lng, target_km, s) for s in seeds],
        "mode": "mock",
        "notice": ("Using approximate offline routes. Add an OpenRouteService "
                   "API key (ORS_API_KEY) to enable real road-based routing."),
    }


# ── Map matching (snap a GPS track to roads/paths) ──────────────────────────────

ORS_MATCH = "https://api.openrouteservice.org/v2/match/foot-walking/geojson"


def _call_ors_match(coords_lonlat: list, api_key: str) -> list:
    """Snap a list of [lng,lat] points to the foot network. Returns [[lat,lng],...]."""
    body = {"coordinates": coords_lonlat, "preference": "shortest"}
    headers = {"Authorization": api_key}
    data = _http_post_json(ORS_MATCH, body, headers, timeout=15.0)
    geom = data["features"][0]["geometry"]["coordinates"]
    return [[round(c[1], 6), round(c[0], 6)] for c in geom if len(c) >= 2]


async def match_path(path_latlng: list) -> dict:
    """
    Road-snap a runner's GPS track. `path_latlng` is [[lat,lng], ...].

    Returns {"matched": [[lat,lng],...], "snapped": bool}. Never raises — on a
    missing key or any ORS failure it returns the original path with
    snapped=False, so the caller always gets something usable.
    """
    if not path_latlng or len(path_latlng) < 5:
        return {"matched": path_latlng, "snapped": False}

    api_key = _resolve_api_key()
    if not api_key:
        return {"matched": path_latlng, "snapped": False}

    # ORS match accepts a bounded number of points; sample down if very long.
    pts = path_latlng
    if len(pts) > 600:
        step = len(pts) // 600 + 1
        pts = pts[::step] + [path_latlng[-1]]

    coords_lonlat = [[p[1], p[0]] for p in pts]
    try:
        matched = await asyncio.to_thread(_call_ors_match, coords_lonlat, api_key)
        if matched and len(matched) >= 2:
            return {"matched": matched, "snapped": True}
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        logger.warning("ORS match failed: HTTP %s %s — %s", e.code, e.reason, body)
    except (urllib.error.URLError, KeyError, IndexError, ValueError, TimeoutError) as e:
        logger.warning("ORS match failed: %s — %s", type(e).__name__, e)

    return {"matched": path_latlng, "snapped": False}
