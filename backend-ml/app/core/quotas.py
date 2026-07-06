"""Per-user daily quotas for metered features.

These caps sit far above real human usage (a genuine user logs ~4-6 meal
photos and asks a handful of coach questions a day), so legitimate users
never see them — they exist to bound worst-case third-party API spend.

Fail-open vs fail-closed when Redis is down:
  * Cheap features (coach chat on Groq 8B) fail OPEN — availability wins,
    the worst case is a few dollars.
  * Expensive features (vision photo analysis, ORS route generation) fail
    CLOSED — an unmetered hour of these is the actual bankruptcy scenario.
"""
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.logging import get_logger
from app.db.redis_client import cache_incr_with_ttl

log = get_logger(__name__)

# Daily limits per user (see gym fair-use policy)
COACH_DAILY_LIMIT = 30
PHOTO_DAILY_LIMIT = 8
ROUTE_DAILY_LIMIT = 5

_DAY_SECONDS = 60 * 60 * 24 + 60  # +60s slack so the key outlives the day


def _quota_key(feature: str, user_id) -> str:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"quota:{feature}:{user_id}:{day}"


async def enforce_daily_quota(
    user_id,
    feature: str,
    limit: int,
    fail_open: bool,
) -> None:
    """Increment today's counter for (user, feature); raise 429 over limit.

    The increment happens before the feature runs, so a request that fails
    later still consumed a slot — acceptable, and it keeps this a single
    atomic Redis op.
    """
    count = await cache_incr_with_ttl(_quota_key(feature, str(user_id)), _DAY_SECONDS)

    if count is None:
        # Redis unavailable — cannot meter
        if fail_open:
            log.warning("Quota check skipped (Redis down): %s user=%s", feature, user_id)
            return
        log.error("Quota REFUSED (Redis down, fail-closed): %s user=%s", feature, user_id)
        raise HTTPException(
            status_code=503,
            detail="This feature is temporarily unavailable. Please try again in a few minutes.",
        )

    if count > limit:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Daily limit reached for this feature ({limit}/day). "
                "It resets at midnight UTC — this cap is set well above normal use."
            ),
        )
