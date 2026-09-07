import redis.asyncio as aioredis

from app.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger(__name__)

redis_client: aioredis.Redis | None = None


async def connect_redis() -> None:
    """Connect to Redis on startup. App degrades gracefully without it."""
    global redis_client
    try:
        redis_client = aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            # A stalled Redis must never stall API requests
            socket_connect_timeout=2,
            socket_timeout=2,
            health_check_interval=30,
            retry_on_timeout=True,
            max_connections=50,
        )
        await redis_client.ping()
        log.info("Redis connected (ML backend)")
    except Exception as e:
        log.warning("Redis connection failed (%s) — caching disabled", e)
        redis_client = None


async def close_redis() -> None:
    global redis_client
    if redis_client:
        await redis_client.close()
        log.info("Redis connection closed")


def get_redis() -> aioredis.Redis | None:
    return redis_client


# ── Safe helpers ─────────────────────────────────────────────────────────────
# Use these instead of calling redis_client directly. They never raise, so a
# Redis hiccup degrades to "cache miss" instead of a 500 for the user.

async def cache_get(key: str) -> str | None:
    if redis_client is None:
        return None
    try:
        return await redis_client.get(key)
    except Exception as e:
        log.warning("Redis GET failed for %s: %s", key, e)
        return None


async def cache_set(key: str, value: str, ttl_seconds: int = 300) -> None:
    if redis_client is None:
        return
    try:
        await redis_client.set(key, value, ex=ttl_seconds)
    except Exception as e:
        log.warning("Redis SET failed for %s: %s", key, e)


async def cache_delete(key: str) -> None:
    if redis_client is None:
        return
    try:
        await redis_client.delete(key)
    except Exception as e:
        log.warning("Redis DEL failed for %s: %s", key, e)


async def cache_incr_with_ttl(key: str, ttl_seconds: int) -> int | None:
    """Atomic counter for rate limiting / quotas. Returns None if Redis is down
    (callers should fail open for UX-critical paths, closed for cost-critical)."""
    if redis_client is None:
        return None
    try:
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, ttl_seconds, nx=True)
        results = await pipe.execute()
        return int(results[0])
    except Exception as e:
        log.warning("Redis INCR failed for %s: %s", key, e)
        return None
