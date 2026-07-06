import torch
import numpy as np
from ultralytics import YOLO
from app.config import get_settings

settings = get_settings()
_model   = None
_inference_count = 0


def get_model():
    global _model
    if _model is None:
        print("Loading YOLOv8s-Pose model...")
        _model = YOLO(settings.yolo_model_path)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        # Warmup — run one blank frame so first real frame is fast
        dummy = np.zeros((360, 480, 3), dtype=np.uint8)
        _model(dummy, device=device, verbose=False, imgsz=480)
        print(f"  ✅ YOLOv8s-Pose loaded and warmed up on {device.upper()}")
    return _model


def run_pose(frame_rgb: np.ndarray) -> dict:
    """
    Run YOLO pose inference. Returns keypoints normalised to 0-1.
    Uses torch.inference_mode() to prevent autograd accumulation.
    Periodically clears CUDA cache to prevent fragmentation.
    """
    global _inference_count

    model  = get_model()
    device = "cuda" if torch.cuda.is_available() else "cpu"

    # ── Critical fix: disable autograd to prevent memory accumulation ────────
    with torch.inference_mode():
        results = model(
            frame_rgb,
            device=device,
            verbose=False,
            conf=0.25,
            imgsz=480,
            half=True,    # FP16 — 2x faster on GTX 1650
        )

    _inference_count += 1

    # ── Periodically clear GPU cache to prevent fragmentation ────────────────
    # Every 300 frames (~30 seconds at 10fps) clear any cached memory
    if device == "cuda" and _inference_count % 300 == 0:
        torch.cuda.empty_cache()

    if not results or len(results) == 0:
        return {"person_detected": False, "keypoints": [], "bbox": [], "confidence": 0}

    result = results[0]

    if result.keypoints is None or len(result.keypoints.data) == 0:
        return {"person_detected": False, "keypoints": [], "bbox": [], "confidence": 0}

    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return {"person_detected": False, "keypoints": [], "bbox": [], "confidence": 0}

    best_idx = int(boxes.conf.argmax())
    conf     = float(boxes.conf[best_idx])
    bbox     = boxes.xyxy[best_idx].tolist()

    kps_data  = result.keypoints.data[best_idx]
    h, w      = frame_rgb.shape[:2]

    keypoints = []
    for kp in kps_data:
        x       = float(kp[0]) / w
        y       = float(kp[1]) / h
        conf_kp = float(kp[2]) if kp.shape[0] > 2 else 1.0
        keypoints.append([round(x, 4), round(y, 4), round(conf_kp, 3)])

    return {
        "person_detected": True,
        "keypoints":       keypoints,
        "bbox":            [round(v, 2) for v in bbox],
        "confidence":      round(conf, 3),
    }


def unload_model():
    global _model
    if _model is not None:
        del _model
        _model = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print("YOLOv8s-Pose unloaded")