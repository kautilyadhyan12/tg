from datetime import datetime

from fastapi import APIRouter

from app.db.mongo import get_db
from app.db.redis_client import get_redis

router = APIRouter()


@router.get("/health")
async def health_check():
    """Liveness + dependency check for monitoring/uptime probes."""
    mongo_status = "disconnected"
    redis_status = "disconnected"

    try:
        db = get_db()
        await db.client.admin.command("ping")
        mongo_status = "connected"
    except Exception:
        mongo_status = "error"

    try:
        redis = get_redis()
        if redis is not None:
            await redis.ping()
            redis_status = "connected"
    except Exception:
        redis_status = "error"

    healthy = mongo_status == "connected"  # Redis is optional (degrades to no cache)

    return {
        "success":   healthy,
        "message":   "ML backend is running" if healthy else "Degraded",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {
            "mongodb": mongo_status,
            "redis":   redis_status,
        },
    }
