"""
Dev-only entrypoint for task P1.3 (trace recording): boots ONLY the pose
WebSocket path — no coach/RAG/nutrition/recommender imports, so the venv needs
just fastapi/uvicorn/numpy/python-jose/pydantic-settings.

The analysis behavior is byte-identical to main.py's: same router module, same
form_analyzer/rep_counter, same settings. This file exists because the full
main.py drags in dependencies unrelated to recording parity traces.

Run:  .venv/Scripts/python run_pose_only.py   (serves ws on :8000 like main.py)
"""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.mongo import close_db, connect_db
from app.db.redis_client import close_redis, connect_redis
from app.routers import exercises, gamification, pose_ws, recommendations, users, workouts

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Mongo + Redis needed by the exercises read API the workout screens use.
    await connect_db()
    await connect_redis()
    yield
    await close_redis()
    await close_db()


app = FastAPI(title="ai-home-gym pose-only (P1.3 trace recording)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(pose_ws.router)
# Same /api prefix as main.py. NOT mounted (heavy ML deps, not needed for
# trace recording): progress (prophet), coach (groq/rag), nutrition, running —
# their dashboard cards just show empty/404 in this dev mode.
app.include_router(exercises.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(workouts.router, prefix="/api")
app.include_router(gamification.router, prefix="/api")
app.include_router(recommendations.router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "mode": "pose-only"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=settings.ml_port)
