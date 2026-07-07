"""
P1.3 video feeder — turns pre-recorded exercise clips into golden traces.

Replicates the browser path exactly (Part 2 §7.5): MediaPipe pose_landmarker
LITE (same model the web app runs), keypoints sampled at ~15 fps of VIDEO time,
streamed to the running pose server over the same WebSocket with the same
message shape. The server's responses (rep counts, form scores) become the
trace's `expected` block — the Python outputs are the locked truth.

Outputs, per clip:
  <out>/<label>.jsonl            §7.1 trace: header line + one PoseFrame/line
  <out>/<label>.responses.jsonl  full per-frame server responses (parity detail
                                 for P1.8; fault mapping happens there)

Usage (pose server must be running — scripts/dev-recording-rig.ps1):
  .venv/Scripts/python feed_video.py --exercise squat --view side \
      --label squat_clean_side recordings/squat_clean_side.mp4
"""

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
from jose import jwt
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision
import websockets

HERE = Path(__file__).parent
MODEL_PATH = HERE / "models" / "pose_landmarker_lite.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
)
SEND_INTERVAL_MS = 67.0  # browser's ~15 fps send cadence (usePoseDetection.js)
WS_URL = "ws://127.0.0.1:8000/ws/pose"


def load_ml_jwt_secret() -> str:
    env_path = HERE / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.strip().startswith("ML_JWT_SECRET="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    secret = os.environ.get("ML_JWT_SECRET", "")
    if not secret:
        sys.exit("ML_JWT_SECRET not found in backend-ml/.env or environment")
    return secret


def ensure_model() -> None:
    if not MODEL_PATH.exists():
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading lite model -> {MODEL_PATH}")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)


def extract_frames(video_path: Path):
    """Sample the clip at the browser cadence; yield (t_ms, keypoints33)."""
    options = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=mp_vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    next_sample_ms = 0.0
    frame_idx = 0
    with mp_vision.PoseLandmarker.create_from_options(options) as landmarker:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t_ms = (frame_idx / fps) * 1000.0
            frame_idx += 1
            if t_ms + 1e-6 < next_sample_ms:
                continue
            next_sample_ms = t_ms + SEND_INTERVAL_MS
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = landmarker.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(t_ms)
            )
            if not result.pose_landmarks:
                continue
            lm = result.pose_landmarks[0]
            kp = [[p.x, p.y, p.z, p.visibility] for p in lm]
            if len(kp) == 33:
                frames.append((round(t_ms, 1), kp))
    cap.release()
    return frames, fps


async def stream(frames, exercise: str, token: str):
    """Send frames like the browser; collect one response per send."""
    responses = []
    url = f"{WS_URL}?token={token}&exercise={exercise}"
    async with websockets.connect(url, max_size=2**22) as ws:
        # drain the greeting/init message(s) the server sends on connect
        try:
            greeting = await asyncio.wait_for(ws.recv(), timeout=2)
            responses.append(json.loads(greeting))
        except asyncio.TimeoutError:
            pass
        # Pace sends to REAL time like the browser: the server's flood guard is
        # wall-clock based (~30 fps cap) and silently skips analysis on frames
        # that arrive faster — the replay must take the clip's real duration.
        start = time.monotonic()
        first_t = frames[0][0] if frames else 0.0
        for t_ms, kp in frames:
            target = (t_ms - first_t) / 1000.0
            delay = target - (time.monotonic() - start)
            if delay > 0:
                await asyncio.sleep(delay)
            await ws.send(json.dumps({"keypoints": kp, "exercise": exercise}))
            try:
                resp = await asyncio.wait_for(ws.recv(), timeout=5)
                responses.append(json.loads(resp))
            except asyncio.TimeoutError:
                responses.append({"_feeder_note": "no response in 5s", "t": t_ms})
    return responses


def build_trace(frames, responses, args, video_fps: float) -> tuple[str, dict]:
    rep_counts = [r.get("rep_count") for r in responses if isinstance(r.get("rep_count"), int)]
    final_reps = rep_counts[-1] if rep_counts else 0
    scores = [
        r.get("form_score")
        for r in responses
        if isinstance(r.get("form_score"), (int, float)) and r.get("is_active", True)
    ]
    lo = int(min(scores)) if scores else 0
    hi = int(max(scores)) if scores else 100
    form_correct_all = all(bool(r.get("form_correct", True)) for r in responses if "form_correct" in r)
    header = {
        "traceVersion": 1,
        "exercise": args.exercise,
        "recordedWith": {"engine": "python-legacy", "defs": 0},
        "device": args.device,
        "platform": "video-feeder",
        "fps": round(1000.0 / SEND_INTERVAL_MS, 1),
        "view": args.view,
        "label": args.label,
        "expected": {
            # §7.5(3): expected values ARE the Python outputs.
            "reps": final_reps,
            # Fault-id mapping legacy→EDS happens in P1.8 from the responses
            # sidecar; empty here means "not yet mapped", not "clean".
            "faultsExact": {},
            "scoreRange": [max(0, lo - 5), min(100, hi + 5)],  # ±5 authoring slack (§7.4)
            "formCorrectAll": form_correct_all,
        },
    }
    lines = [json.dumps(header)]
    for t_ms, kp in frames:
        lines.append(json.dumps({"t": t_ms, "kp": kp}))
    return "\n".join(lines) + "\n", header


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+", help="video file(s)")
    ap.add_argument("--exercise", required=True, help="squat | jump_squat | chair_squat")
    ap.add_argument("--view", required=True, choices=["front", "side"])
    ap.add_argument("--label", help="trace label; default = video filename stem")
    ap.add_argument("--device", default="phone-video")
    ap.add_argument("--out", default=str(HERE.parent / "packages/engine/test/traces/parity"))
    args = ap.parse_args()

    ensure_model()
    token = jwt.encode(
        {"id": "trace-feeder", "exp": int(time.time()) + 3600},
        load_ml_jwt_secret(),
        algorithm="HS256",
    )
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    for video in args.videos:
        vpath = Path(video)
        if not vpath.exists():
            sys.exit(f"not found: {vpath}")
        label = args.label if (args.label and len(args.videos) == 1) else vpath.stem
        print(f"== {vpath.name}: extracting (lite model, ~15fps)...")
        frames, video_fps = extract_frames(vpath)
        print(f"   {len(frames)} sampled frames (video fps {video_fps:.1f})")
        if len(frames) < 10:
            print("   SKIP: fewer than 10 frames with a detected person — check framing/lighting")
            continue
        print("   streaming to Python analyzer...")
        responses = asyncio.run(stream(frames, args.exercise, token))
        trace_text, header = build_trace(frames, responses, argparse.Namespace(**{**vars(args), "label": label}), video_fps)
        trace_file = out_dir / f"{label}.jsonl"
        trace_file.write_text(trace_text, encoding="utf-8")
        sidecar = out_dir / f"{label}.responses.jsonl"
        sidecar.write_text("\n".join(json.dumps(r) for r in responses) + "\n", encoding="utf-8")
        exp = header["expected"]
        print(f"   -> {trace_file.name}: reps={exp['reps']} scoreRange={exp['scoreRange']} "
              f"formCorrectAll={exp['formCorrectAll']}")
        print(f"   -> {sidecar.name} ({len(responses)} responses)")
        print("   REVIEW: watch the clip once and confirm the rep count matches what you did (§7.1).")


if __name__ == "__main__":
    main()
