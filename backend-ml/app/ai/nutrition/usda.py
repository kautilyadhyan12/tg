"""
Open Food Facts API integration.
Uses Search-a-licious (faster Elasticsearch backend) when available,
falls back to legacy CGI search if needed.
"""

import httpx
import re

# Search-a-licious (new, fast, ES-backed)
SEARCH_A_LICIOUS = "https://search.openfoodfacts.org/search"

# Legacy CGI search (slower, but more reliable from some regions)
LEGACY_SEARCH    = "https://world.openfoodfacts.org/cgi/search.pl"

USER_AGENT = "AIHomeGym/1.0 (kautilya@aihomegym.local)"


def _safe_float(value, default: float = 0.0) -> float:
    """Safely convert any value to float."""
    try:
        if value is None or value == "" or value == "unknown":
            return default
        return round(float(value), 1)
    except (TypeError, ValueError):
        return default


def _parse_serving(serving_raw: str) -> tuple:
    """Parse serving_size like '100g', '30 g', '1 oz (28g)' into (size, unit)."""
    try:
        match = re.search(r"([\d.]+)\s*(g|ml|oz|cup|tbsp|tsp)", serving_raw or "", re.I)
        if match:
            return float(match.group(1)), match.group(2).lower()
    except Exception:
        pass
    return 100.0, "g"


def _product_to_food(product: dict) -> dict | None:
    """Convert an Open Food Facts product dict to our food format."""

    def _to_str(value) -> str:
        """Convert any value to a clean string."""
        if value is None:
            return ""
        if isinstance(value, list):
            return value[0] if value else ""
        return str(value).strip()

    name = _to_str(product.get("product_name")) or _to_str(product.get("generic_name"))
    name = name.strip()

    if not name:
        return None

    # Brand — Search-a-licious returns list, legacy CGI returns string
    brands_raw = product.get("brands") or ""
    if isinstance(brands_raw, list):
        brand = brands_raw[0].strip() if brands_raw else ""
    elif isinstance(brands_raw, str):
        brand = brands_raw.split(",")[0].strip()
    else:
        brand = ""

    if brand and brand.lower() not in name.lower():
        display_name = f"{name} ({brand})"[:80]
    else:
        display_name = name[:80]

    # Nutriments are per 100g
    n = product.get("nutriments") or {}

    kcal      = _safe_float(n.get("energy-kcal_100g"))
    if kcal == 0:
        # Try converting from kJ
        kj = _safe_float(n.get("energy_100g"))
        if kj > 0:
            kcal = round(kj / 4.184, 1)

    protein_g = _safe_float(n.get("proteins_100g"))
    carbs_g   = _safe_float(n.get("carbohydrates_100g"))
    fat_g     = _safe_float(n.get("fat_100g"))
    fiber_g   = _safe_float(n.get("fiber_100g"))

    if kcal == 0:
        return None

    serving_size, serving_unit = _parse_serving(product.get("serving_size", ""))

    return {
        "name":         display_name,
        "kcal":         kcal,
        "protein_g":    protein_g,
        "carbs_g":      carbs_g,
        "fat_g":        fat_g,
        "fiber_g":      fiber_g,
        "serving_size": serving_size,
        "serving_unit": serving_unit,
        "source":       "openfoodfacts",
    }


async def _try_search_a_licious(query: str, limit: int) -> list:
    """Try the new fast Search-a-licious endpoint."""
    params = {
        "q":         query,
        "page_size": limit,
        "fields":    "product_name,brands,serving_size,nutriments,generic_name",
    }
    try:
        # Force IPv4 — fixes 'getaddrinfo failed' on Windows
        transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")
        async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
            resp = await client.get(
                SEARCH_A_LICIOUS,
                params=params,
                headers={"User-Agent": USER_AGENT},
            )
            if resp.status_code != 200:
                print(f"  Search-a-licious returned {resp.status_code}")
                return []
            data = resp.json()
    except httpx.TimeoutException:
        print("  Search-a-licious timed out")
        return []
    except Exception as e:
        print(f"  Search-a-licious failed: {e}")
        return []

    hits    = data.get("hits") or data.get("products") or []
    results = []
    for product in hits:
        food = _product_to_food(product)
        if food:
            results.append(food)
    return results[:limit]


async def _try_legacy_cgi(query: str, limit: int) -> list:
    """Fallback to legacy CGI search."""
    params = {
        "search_terms":  query,
        "search_simple": 1,
        "action":        "process",
        "json":          1,
        "page_size":     limit,
    }
    try:
        # Force IPv4 — fixes 'getaddrinfo failed' on Windows
        transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")
        async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
            resp = await client.get(
                LEGACY_SEARCH,
                params=params,
                headers={"User-Agent": USER_AGENT},
            )
            if resp.status_code != 200:
                print(f"  Legacy CGI returned {resp.status_code}")
                return []
            data = resp.json()
    except httpx.TimeoutException:
        print("  Legacy CGI timed out")
        return []
    except Exception as e:
        print(f"  Legacy CGI failed: {e}")
        return []

    products = data.get("products", [])
    results  = []
    for product in products:
        food = _product_to_food(product)
        if food:
            results.append(food)
    return results[:limit]


async def search_usda(query: str, limit: int = 10) -> list:
    """
    Search Open Food Facts. Tries fast endpoint first, falls back to legacy.
    Returns empty list if both fail (caller falls back to built-in DB).
    Function name kept as search_usda for backward compatibility.
    """
    print(f"🔍 Open Food Facts search: '{query}'")

    # Try fast endpoint first
    results = await _try_search_a_licious(query, limit)
    if results:
        print(f"  ✅ Got {len(results)} results from Search-a-licious")
        return results

    # Fall back to legacy CGI
    print("  Trying legacy CGI endpoint...")
    results = await _try_legacy_cgi(query, limit)
    if results:
        print(f"  ✅ Got {len(results)} results from legacy CGI")
        return results

    print("  ❌ Both endpoints failed, falling back to built-in")
    return []