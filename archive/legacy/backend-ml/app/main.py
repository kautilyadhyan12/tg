import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.core.logging import setup_logging, get_logger
from app.db.mongo import connect_db, close_db
from app.db.redis_client import connect_redis, close_redis
from app.routers import health, exercises, workouts, pose_ws, users, progress
from app.routers import recommendations, coach, nutrition, gamification, running

settings = get_settings()
setup_logging(settings.log_level)
log = get_logger(__name__)

# Refuse to boot in production with placeholder secrets / localhost CORS
settings.validate_for_production()


def _init_rag_blocking() -> None:
    """ChromaDB ingestion is synchronous and can take a while; it runs in a
    worker thread so the API starts serving traffic immediately."""
    from app.ai.rag.knowledge_base import ingest_knowledge_base
    ingest_knowledge_base()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────────
    log.info("Starting ML backend (env=%s)...", settings.node_env)
    await connect_db()
    await connect_redis()

    async def _rag_task():
        try:
            await asyncio.to_thread(_init_rag_blocking)
            log.info("RAG knowledge base ready")
        except Exception as e:
            log.error("RAG init failed (Coach degraded): %s", e)

    rag_task = asyncio.create_task(_rag_task())

    log.info("ML backend ready")
    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    log.info("Shutting down ML backend...")
    rag_task.cancel()
    await close_db()
    await close_redis()


app = FastAPI(
    title="AI Home Gym — ML Backend",
    description="FastAPI backend for all AI/ML features",
    version="1.0.0",
    lifespan=lifespan,
    # Never expose interactive API docs publicly in production
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

# ── Middleware ────────────────────────────────────────────────────────────────
# Gzip shrinks JSON payloads (progress charts, exercise lists) ~5-10x —
# directly less mobile data and faster loads on weak connections.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# ── Global error handler ─────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Any uncaught bug becomes a clean JSON 500 with a full server-side log,
    instead of a stack trace leaking to the client."""
    log.exception("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(health.router,           tags=["Health"])
app.include_router(exercises.router,        prefix="/api", tags=["Exercises"])
app.include_router(workouts.router,         prefix="/api", tags=["Workouts"])
app.include_router(users.router,            prefix="/api", tags=["Users"])
app.include_router(progress.router,         prefix="/api", tags=["Progress"])
app.include_router(recommendations.router,  prefix="/api", tags=["Recommendations"])
app.include_router(coach.router,            prefix="/api", tags=["Coach"])
app.include_router(nutrition.router,        prefix="/api", tags=["Nutrition"])
app.include_router(gamification.router,     prefix="/api", tags=["Gamification"])
app.include_router(running.router,          prefix="/api", tags=["Running"])
app.include_router(pose_ws.router,          tags=["Pose Detection"])


# ── Root ──────────────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"message": "AI Home Gym ML Backend", "version": "1.0.0"}
