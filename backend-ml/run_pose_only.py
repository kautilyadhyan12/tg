"""
Dev-only entrypoint for task P1.3 (trace recording): boots ONLY the pose
WebSocket path — no coach/RAG/nutrition/recommender imports, so the venv needs
just fastapi/uvicorn/numpy/python-jose/pydantic-settings.

The analysis behavior is byte-identical to main.py's: same router module, same
form_analyzer/rep_counter, same settings. This file exists because the full
main.py drags in dependencies unrelated to recording parity traces.

Run:  .venv/Scripts/python run_pose_only.py   (serves ws on :8000 like main.py)
"""

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import pose_ws

settings = get_settings()

app = FastAPI(title="ai-home-gym pose-only (P1.3 trace recording)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(pose_ws.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "mode": "pose-only"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=settings.ml_port)
