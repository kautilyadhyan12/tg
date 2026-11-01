"""The Python half of measure-video.ts. Two jobs, and no measuring of its own:

  trace  a video to a trace: only the model's points come from here.
  draw   the pictures, from the report the engine wrote.

Laptop only: it needs mediapipe, cv2 and matplotlib. Start it through measure-video,
which checks the output folder first.
"""
import argparse
import glob
import json
import math
import os
import sys

import cv2

# The app's own settings (apps/web/src/dev/poseTuning.js POSE_DEFAULTS).
NUM_POSES = 1
MIN_CONFIDENCE = 0.5
# The engine ignores a point seen less than this (VISIBILITY_THRESHOLD, @app/shared).
VISIBLE = 0.3
LONG_SIDE = 900
PLAIN_HEIGHT = 720

BONES = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24),
         (23, 25), (25, 27), (27, 29), (29, 31), (27, 31),
         (24, 26), (26, 28), (28, 30), (30, 32), (28, 32)]
CHART_PANELS = [
    ("Knees", ["knee_L", "knee_R", "knee_avg"]),
    ("Hips", ["hip_L", "hip_R", "body_line"]),
    ("Elbows", ["elbow_L", "elbow_R"]),
    ("Shoulders", ["shoulder_L", "shoulder_R"]),
    ("Lean from upright", ["trunk_incline", "shin_incline"]),
    ("Height against standing", ["hip_elevation", "ankle_elevation"]),
    ("Knee over ankle", ["valgus_L", "valgus_R"]),
    ("Stillness", ["stillness"]),
]


def picture_shape(cap, img):
    """Width / height of the picture as a person sees it, from the decoded picture, so a
    phone video stored sideways is right. Refuses stretched pixels: every angle would lie."""
    sar_n, sar_d = cap.get(cv2.CAP_PROP_SAR_NUM), cap.get(cv2.CAP_PROP_SAR_DEN)
    if sar_n > 0 and sar_d > 0 and abs(sar_n / sar_d - 1) > 0.01:
        sys.exit(f"This video's pixels are not square ({sar_n:g}:{sar_d:g}), so its angles would be wrong.")
    h, w = img.shape[:2]
    return w / h


def sampled_frames(cap, fps):
    """(t in ms from the first frame, picture), at most `fps` a second, by the video's own
    clock so uneven timing stays true. The draw step finds its frames by this same t."""
    step = 1000.0 / fps
    next_t = 0.0
    first = None
    last = -1.0
    while True:
        ok, img = cap.read()
        if not ok:
            return
        at = cap.get(cv2.CAP_PROP_POS_MSEC)
        if first is None:
            first = at
        t = round(at - first, 1)
        if t + 1e-6 < next_t or t <= last:
            continue
        next_t = max(next_t + step, t)
        last = t
        yield t, img


def frame_line(t, landmarks, world):
    """One trace line. Nobody found is an empty `kp`, as the app feeds the engine."""
    if not landmarks:
        return {"t": t, "kp": []}
    kp = [[l.x, l.y, l.z, 1.0 if l.visibility is None else min(1.0, max(0.0, l.visibility))] for l in landmarks]
    wkp = [[l.x, l.y, l.z] for l in world] if world else None
    if any(not math.isfinite(v) for p in kp for v in p):
        return {"t": t, "kp": []}
    line = {"t": t, "kp": [[round(v, 6) for v in p] for p in kp]}
    if wkp and all(math.isfinite(v) for p in wkp for v in p):
        line["wkp"] = [[round(v, 6) for v in p] for p in wkp]
    return line


def make_trace(a):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    cap = cv2.VideoCapture(a.video)
    if not cap.isOpened():
        sys.exit(f"Cannot read the video {os.path.basename(a.video)}.")
    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=a.model),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=NUM_POSES,
        min_pose_detection_confidence=MIN_CONFIDENCE,
        min_pose_presence_confidence=MIN_CONFIDENCE,
        min_tracking_confidence=MIN_CONFIDENCE,
    )
    lines, aspect = [], None
    with vision.PoseLandmarker.create_from_options(options) as model:
        for t, img in sampled_frames(cap, a.fps):
            aspect = aspect or picture_shape(cap, img)
            rgb = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            r = model.detect_for_video(rgb, int(t))
            lines.append(frame_line(t, r.pose_landmarks[0] if r.pose_landmarks else None,
                                    r.pose_world_landmarks[0] if r.pose_world_landmarks else None))
    cap.release()
    if len(lines) < 2:
        sys.exit("The video has too few frames to measure.")
    seconds = lines[-1]["t"] / 1000
    header = {
        "traceVersion": 1,
        "exercise": a.exercise,
        "recordedWith": {"engine": a.engine, "defs": a.defs},
        "device": "video-file",
        "platform": "laptop-mediapipe",
        "fps": round((len(lines) - 1) / seconds, 2),
        "aspect": aspect,
        "view": a.view,
        "label": a.label,
        "expected": {"reps": a.reps, "faultsExact": {}, "faultsPending": True, "scoreRange": [0, 100],
                     "formCorrectAll": False},
        "provider": {
            "model": os.path.splitext(os.path.basename(a.model))[0],
            "numPoses": NUM_POSES,
            "minPoseDetectionConfidence": MIN_CONFIDENCE,
            "minPosePresenceConfidence": MIN_CONFIDENCE,
            "minTrackingConfidence": MIN_CONFIDENCE,
        },
    }
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(header) + "\n")
        for line in lines:
            f.write(json.dumps(line, allow_nan=False) + "\n")


def clip_text(text, width=46):
    """Splits a line so it stays on the picture."""
    out, line = [], ""
    for word in text.split(" "):
        if line and len(line) + len(word) + 1 > width:
            out.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    return out + [line]


def moment_lines(report, moment):
    i = moment["frame"]
    lines = [f"{moment['t'] / 1000:.2f} s  frame {i + 1}"] + clip_text(moment["why"])
    rules = report.get("rules")
    if rules:
        d = rules["decisions"][i]
        metric = d.get("metric")
        steady = "none" if metric is None else f"{metric:.1f}"
        lines.append(f"count {d['repCount']}  phase {d['phase']}  view {d['view']}")
        lines.append(f"{rules['metric']} steadied {steady}  down<{rules['downAt']} up>{rules['upAt']}")
    for name in ("knee_L", "knee_R", "hip_L", "hip_R", "elbow_L", "elbow_R", "trunk_incline"):
        v = report["signals"].get(name, [None] * (i + 1))[i]
        if v is not None:
            lines.append(f"{name} {v:.1f}")
    return lines


def draw_moment(img, kp, lines):
    h, w = img.shape[:2]
    scale = LONG_SIDE / max(h, w)
    img = cv2.resize(img, (round(w * scale), round(h * scale)))
    h, w = img.shape[:2]
    pts = [(int(p[0] * w), int(p[1] * h), p[3]) for p in kp]
    for a, b in BONES:
        if pts:
            seen = pts[a][2] >= VISIBLE and pts[b][2] >= VISIBLE
            cv2.line(img, pts[a][:2], pts[b][:2], (0, 230, 120) if seen else (120, 120, 120), 3 if seen else 1, cv2.LINE_AA)
    for x, y, vis in pts[11:]:
        cv2.circle(img, (x, y), 4, (255, 255, 255) if vis >= VISIBLE else (0, 0, 255), -1, cv2.LINE_AA)
    if not pts:
        lines = ["NOBODY SEEN"] + lines
    font, size, tall = cv2.FONT_HERSHEY_SIMPLEX, 0.5, 20
    wide = max(cv2.getTextSize(t, font, size, 1)[0][0] for t in lines) + 16
    panel = img[0:tall * len(lines) + 10, 0:wide]
    panel[:] = (panel * 0.25).astype(panel.dtype)
    for n, text in enumerate(lines):
        cv2.putText(img, text, (8, tall * (n + 1)), font, size, (255, 255, 255), 1, cv2.LINE_AA)
    return img


def sheet(pictures, path, across=4, tall=420):
    import numpy as np

    thumbs = [cv2.resize(p, (round(p.shape[1] * tall / p.shape[0]), tall)) for p in pictures]
    wide = max(t.shape[1] for t in thumbs)
    rows = []
    for start in range(0, len(thumbs), across):
        row = thumbs[start:start + across]
        row = [cv2.copyMakeBorder(t, 0, 0, 0, wide - t.shape[1], cv2.BORDER_CONSTANT) for t in row]
        row += [np.zeros((tall, wide, 3), np.uint8)] * (across - len(row))
        rows.append(cv2.hconcat(row))
    cv2.imwrite(path, cv2.vconcat(rows), [cv2.IMWRITE_JPEG_QUALITY, 80])


def chart(report, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    panels = [(title, [n for n in names if n in report["ranges"]]) for title, names in CHART_PANELS]
    panels = [p for p in panels if p[1]]
    rules = report.get("rules")
    seconds = [t / 1000 for t in report["times"]]
    rows = len(panels) + (1 if rules else 0)
    fig, axes = plt.subplots(max(rows, 1), 1, figsize=(12, 2.2 * max(rows, 1)), sharex=True, squeeze=False)
    axes = [row[0] for row in axes]
    if rules:
        ax = axes[0]
        steady = [d.get("metric", float("nan")) for d in rules["decisions"]]
        ax.plot(seconds, steady, color="black", label=f"{rules['metric']}, steadied: the number the count uses")
        ax.axhline(rules["upAt"], color="green", ls="--", label=f"up {rules['upAt']}")
        ax.axhline(rules["downAt"], color="red", ls="--", label=f"down {rules['downAt']}")
        for r in rules["reps"]:
            ax.axvline(seconds[r["endFrame"]], color="blue", alpha=0.4)
        ax.set_title(f"{report['label']}: {rules['summary']['reps']} counted (blue lines)", loc="left")
        ax.legend(loc="center left", bbox_to_anchor=(1.0, 0.5), fontsize=7)
    for ax, (title, names) in zip(axes[1 if rules else 0:], panels):
        for name in names:
            ax.plot(seconds, [float("nan") if v is None else v for v in report["signals"][name]], label=name)
        ax.set_ylabel(title, fontsize=8)
        ax.legend(loc="center left", bbox_to_anchor=(1.0, 0.5), fontsize=7)
    axes[-1].set_xlabel("seconds")
    fig.tight_layout()
    fig.savefig(path, dpi=80)
    plt.close(fig)


def wanted_frames(report, trace_frames, video, fps):
    """{frame number: picture}. With no video, a plain picture of the trace's shape."""
    wanted = {m["frame"] for m in report["moments"]}
    if video is None:
        import numpy as np

        size = (PLAIN_HEIGHT, round(PLAIN_HEIGHT * report["aspect"]), 3)
        return {i: np.full(size, 40, np.uint8) for i in wanted}
    by_t = {f["t"]: i for i, f in enumerate(trace_frames)}
    pictures = {}
    cap = cv2.VideoCapture(video)
    for t, img in sampled_frames(cap, fps):
        i = by_t.get(t)
        if i in wanted:
            pictures[i] = img
    cap.release()
    missing = wanted - set(pictures)
    if missing:
        sys.exit(f"{len(missing)} frames of the report are not in the video: is it the same video?")
    return pictures


def make_pictures(a):
    with open(a.report, encoding="utf-8") as f:
        report = json.load(f)
    with open(a.trace, encoding="utf-8") as f:
        frames = [json.loads(line) for line in f if line.strip()][1:]
    for old in glob.glob(os.path.join(a.out, "[0-9][0-9]_*.jpg")):
        os.remove(old)
    pictures = wanted_frames(report, frames, a.video, a.fps)
    drawn = []
    for n, moment in enumerate(report["moments"]):
        i = moment["frame"]
        img = draw_moment(pictures[i].copy(), frames[i]["kp"], moment_lines(report, moment))
        word = "".join(c if c.isalnum() else "_" for c in moment["why"])[:28].strip("_")
        cv2.imwrite(os.path.join(a.out, f"{n + 1:02d}_{word}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        drawn.append(img)
    if drawn:
        sheet(drawn, os.path.join(a.out, "all.jpg"))
    chart(report, os.path.join(a.out, "chart.png"))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="job", required=True)
    t = sub.add_parser("trace")
    t.add_argument("--video", required=True)
    t.add_argument("--out", required=True)
    t.add_argument("--exercise", required=True)
    t.add_argument("--label", required=True)
    t.add_argument("--fps", type=float, required=True)
    t.add_argument("--reps", type=int, required=True)
    t.add_argument("--view", required=True)
    t.add_argument("--model", required=True)
    t.add_argument("--engine", required=True)
    t.add_argument("--defs", type=int, required=True)
    d = sub.add_parser("draw")
    d.add_argument("--report", required=True)
    d.add_argument("--trace", required=True)
    d.add_argument("--out", required=True)
    d.add_argument("--video")
    d.add_argument("--fps", type=float, default=15.0)
    a = p.parse_args()
    if a.job == "trace":
        make_trace(a)
    else:
        make_pictures(a)


if __name__ == "__main__":
    main()
