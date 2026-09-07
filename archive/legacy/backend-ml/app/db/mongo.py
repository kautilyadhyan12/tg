from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger(__name__)

client: AsyncIOMotorClient | None = None
db: AsyncIOMotorDatabase | None = None


async def connect_db() -> None:
    """Connect to MongoDB on startup with sane timeouts and pool sizing."""
    global client, db
    client = AsyncIOMotorClient(
        settings.mongo_uri,
        # Fail fast instead of hanging requests for 30s when Mongo is down
        serverSelectionTimeoutMS=5000,
        connectTimeoutMS=5000,
        socketTimeoutMS=10000,
        # Pool: enough for a small VPS under load, bounded so Mongo isn't flooded
        maxPoolSize=50,
        minPoolSize=5,
        retryWrites=True,
    )
    db = client.ai_home_gym
    await client.admin.command("ping")
    log.info("MongoDB connected (ML backend)")
    await ensure_indexes(db)


async def ensure_indexes(database: AsyncIOMotorDatabase) -> None:
    """Create indexes for every hot query path. Idempotent — safe on each boot.

    Without these, user-scoped queries collection-scan and the app lags as
    data grows. Index names are explicit so they never duplicate.
    """
    try:
        # Users: login/auth lookups happen by _id (already indexed) and email
        await database.users.create_index("email", unique=True, name="uniq_email")

        # Workout sessions: everything is queried per-user, usually recent-first
        await database.workout_sessions.create_index(
            [("user_id", 1), ("completed", 1), ("completed_at", -1)],
            name="user_completed_recent",
        )

        # Meal logs: per user, by consumption time
        await database.meal_logs.create_index(
            [("user_id", 1), ("consumed_at", -1)], name="user_consumed"
        )

        # Body measurements over time
        await database.body_measurements.create_index(
            [("user_id", 1), ("measured_at", -1)], name="user_measured"
        )

        # Coach conversations (per user, recent-first)
        await database.coach_conversations.create_index(
            [("user_id", 1), ("updated_at", -1)], name="user_recent"
        )

        # Running
        await database.running_sessions.create_index(
            [("user_id", 1), ("completed_at", -1)], name="user_recent"
        )
        await database.running_schedules.create_index(
            [("user_id", 1), ("scheduled_at", -1)], name="user_scheduled"
        )
        await database.running_routes.create_index(
            [("user_id", 1)], name="user"
        )

        # Workout templates per user
        await database.workout_templates.create_index(
            [("user_id", 1), ("updated_at", -1)], name="user_recent"
        )

        # Exercise library: always filtered on is_active, sorted by name
        await database.exercises.create_index(
            [("is_active", 1), ("name", 1)], name="active_name"
        )
        # Text index — required by the library's $text search
        await database.exercises.create_index(
            [("name", "text"), ("primary_category", "text"),
             ("muscles_primary", "text")],
            name="exercise_text_search",
        )

        log.info("MongoDB indexes ensured")
    except Exception as e:  # index creation must never block boot
        log.warning("Index creation issue (continuing): %s", e)


async def close_db() -> None:
    global client
    if client:
        client.close()
        log.info("MongoDB connection closed")


def get_db() -> AsyncIOMotorDatabase:
    if db is None:
        # Surfaces as a clean 500 with a clear log line instead of AttributeError
        raise RuntimeError("Database not initialized — connect_db() has not run")
    return db
