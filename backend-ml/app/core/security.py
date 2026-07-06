import json

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.config import get_settings
from app.core.logging import get_logger
from app.db.mongo import get_db
from app.db.redis_client import cache_get, cache_set

settings = get_settings()
log = get_logger(__name__)
security = HTTPBearer()

# Every authenticated request needs the user document. Caching it briefly in
# Redis removes one MongoDB round-trip from EVERY API call — the single
# hottest query in the system. 60s TTL keeps deactivations near-real-time.
_USER_CACHE_TTL = 60


def _user_cache_key(user_id: str) -> str:
    return f"authuser:{user_id}"


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """Validate a JWT issued by the Node auth backend and load the user."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.ml_jwt_secret,
            algorithms=["HS256"],
        )
        user_id = payload.get("id")
        if not user_id:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # A malformed id in a token must be a 401, not an InvalidId 500.
    try:
        oid = ObjectId(user_id)
    except (InvalidId, TypeError):
        raise credentials_exception

    # 1) Try cache
    cached = await cache_get(_user_cache_key(user_id))
    if cached:
        try:
            user = json.loads(cached)
            user["_id"] = ObjectId(user["_id"])
            if not user.get("isActive", True):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Account has been deactivated",
                )
            return user
        except (json.JSONDecodeError, KeyError, InvalidId):
            pass  # corrupt cache entry — fall through to DB

    # 2) Load from MongoDB
    db = get_db()
    user = await db.users.find_one({"_id": oid})
    if user is None:
        raise credentials_exception
    if not user.get("isActive", True):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account has been deactivated",
        )

    # 3) Cache a JSON-safe copy (ObjectId/datetime → str). Never let a cache
    # problem break auth.
    try:
        safe = json.loads(json.dumps(user, default=str))
        await cache_set(_user_cache_key(user_id), json.dumps(safe), _USER_CACHE_TTL)
    except Exception as e:
        log.warning("User cache write failed: %s", e)

    return user


async def invalidate_user_cache(user_id) -> None:
    """Call after any users-collection update so changes appear immediately."""
    from app.db.redis_client import cache_delete
    await cache_delete(_user_cache_key(str(user_id)))
