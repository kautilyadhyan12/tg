"""The Python half of measure-points.ts. Two jobs, and no measuring of its own:

  measure  a video to the body points of every person the pose model finds, every
           number as the model gave it (measure-points rounds them, once).
  draw     the pictures: each person the file holds, drawn on the video's own frame;
           for body-check, the points the possible-body check refused in red.

Laptop only: it needs mediapipe and cv2. Start it through measure-points, which checks
the output folder first.
"""
import argparse
import json
import math
import os
import sys
import textwrap

import cv2

POINTS = 33
# The app's own model settings (apps/web/src/dev/poseTuning.js POSE_DEFAULTS).
MIN_CONFIDENCE = 0.5
# A point the model is less than half sure of is drawn thin and grey.
SURE_ENOUGH_TO_DRAW = 0.5
MARKER = ".measure-points.json"
LONG_SIDE = 900

BONES = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24),
         (23, 25), (25, 27), (27, 29), (29, 31), (27, 31),
         (24, 26), (26, 28), (28, 30), (30, 32), (28, 32)]
# One colour for each place in a frame's list (blue, green, red, in cv2's order).
COLOURS = [(0, 230, 120), (0, 150, 255), (255, 220, 0), (255, 0, 255), (0, 230, 230), (255, 255, 255)]
# A point the possible-body check refused for a broken bone, a jump or a swap.
REFUSED = (40, 40, 255)


def picture_shape(cap, img):
    """(width, height) of the picture as a person sees it, from the decoded picture, so a
    phone video stored sideways is right. Refuses stretched pixels: every angle would lie."""
    sar_n, sar_d = cap.get(cv2.CAP_PROP_SAR_NUM), cap.get(cv2.CAP_PROP_SAR_DEN)
    if sar_n > 0 and sar_d > 0 and abs(sar_n / sar_d - 1) > 0.01:
        sys.exit(f"This video's pixels are not square ({sar_n:g}:{sar_d:g}), so its angles would be wrong.")
    h, w = img.shape[:2]
    return w, h


def sampled_frames(cap, fps):
    """(t in ms from the first frame, picture), at most `fps` a second, by the video's own
    clock so uneven timing stays true. For each moment a `1/fps` apart it keeps the video
    frame nearest to it, so the gaps stay even. The draw step finds its frames by this
    same order."""
    video_fps = cap.get(cv2.CAP_PROP_FPS) or fps
    step = 1000.0 / fps
    half_frame = 500.0 / max(video_fps, fps)
    due = 0.0
    first = None
    last = -1.0
    while True:
        ok, img = cap.read()
        if not ok:
            return
        at = cap.get(cv2.CAP_PROP_POS_MSEC)
        if first is None:
            first = at
        raw = at - first
        t = round(raw, 1)
        if raw < due - half_frame or t <= last:
            continue
        due = (math.floor((raw + half_frame) / step) + 1) * step
        last = t
        yield t, img


def sure(value, what):
    """Visibility and presence as the model gives them. A model that gives none is not
    guessed for: the whole measurement stops."""
    if value is None:
        sys.exit(f"The pose model gave no {what} for a point; this tool needs it.")
    return min(1.0, max(0.0, value))


def person_entry(landmarks, world):
    """One person as the engine's frame holds it, or None when a number is broken."""
    if len(landmarks) != POINTS or (world is not None and len(world) != POINTS):
        return None
    points = [[l.x, l.y, l.z, sure(l.visibility, "visibility"), sure(l.presence, "presence")] for l in landmarks]
    world_points = None if world is None else [[l.x, l.y, l.z] for l in world]
    numbers = [v for p in points for v in p] + ([v for p in world_points for v in p] if world_points else [])
    if not all(math.isfinite(v) for v in numbers):
        return None
    return {"points": points, "world": world_points}


def measure(a):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    cap = cv2.VideoCapture(a.video)
    if not cap.isOpened():
        sys.exit(f"Cannot read the video {os.path.basename(a.video)}.")
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    if not video_fps or video_fps <= 0:
        sys.exit("The video does not say its frames a second.")
    fps = min(a.fps, video_fps)
    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=a.model),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=a.people,
        min_pose_detection_confidence=MIN_CONFIDENCE,
        min_pose_presence_confidence=MIN_CONFIDENCE,
        min_tracking_confidence=MIN_CONFIDENCE,
    )
    frames, size, left_out = [], None, 0
    with vision.PoseLandmarker.create_from_options(options) as model:
        for t, img in sampled_frames(cap, fps):
            size = size or picture_shape(cap, img)
            rgb = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            r = model.detect_for_video(rgb, int(t))
            people = []
            for n, landmarks in enumerate(r.pose_landmarks or []):
                world = r.pose_world_landmarks[n] if r.pose_world_landmarks and n < len(r.pose_world_landmarks) else None
                entry = person_entry(landmarks, world)
                if entry is None:
                    left_out += 1
                else:
                    people.append(entry)
            # A reference video is taken as upright (spec Part 2 §12.2).
            frames.append({"t": t, "aspect": size[0] / size[1], "down": [0, 1, 0], "people": people})
    cap.release()
    if len(frames) < 2:
        sys.exit("The video has too few frames to measure.")
    header = {
        "label": a.label,
        "source": "video",
        "picture": {"width": size[0], "height": size[1]},
        "videoFps": round(video_fps, 3),
        "fps": round(fps, 3),
        "model": {
            "file": os.path.splitext(os.path.basename(a.model))[0],
            "people": a.people,
            "minDetection": MIN_CONFIDENCE,
            "minPresence": MIN_CONFIDENCE,
            "minTracking": MIN_CONFIDENCE,
        },
        "madeWith": {"tool": "measure-points", "version": a.tool_version},
    }
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(header) + "\n")
        for frame in frames:
            f.write(json.dumps(frame, allow_nan=False) + "\n")
    if left_out:
        print(f"{left_out} people were left out of their frames: the model gave a broken number for them.")


def draw_frame(img, people, lines):
    h, w = img.shape[:2]
    scale = LONG_SIDE / max(h, w)
    img = cv2.resize(img, (round(w * scale), round(h * scale)))
    h, w = img.shape[:2]
    for n, person in enumerate(people):
        colour = COLOURS[n % len(COLOURS)]
        pts = [(int(p[0] * w), int(p[1] * h), p[3]) for p in person["points"]]
        # body-check's: for each point, null or why it was refused; only these are drawn red.
        refused = [r in ("bone", "jump", "swap") for r in person.get("refused") or [None] * len(pts)]
        for a, b in BONES:
            seen = pts[a][2] >= SURE_ENOUGH_TO_DRAW and pts[b][2] >= SURE_ENOUGH_TO_DRAW
            line = REFUSED if refused[a] or refused[b] else colour if seen else (120, 120, 120)
            cv2.line(img, pts[a][:2], pts[b][:2], line, 3 if seen else 1, cv2.LINE_AA)
        for i, (x, y, vis) in enumerate(pts):
            if i < 11 and not refused[i]:
                continue
            if refused[i]:
                cv2.circle(img, (x, y), 8, REFUSED, 2, cv2.LINE_AA)
            cv2.circle(img, (x, y), 4, colour if vis >= SURE_ENOUGH_TO_DRAW else (120, 120, 120), -1, cv2.LINE_AA)
        sx = (pts[11][0] + pts[12][0]) // 2
        sy = min(pts[11][1], pts[12][1]) - 12
        cv2.putText(img, str(n + 1), (sx, sy), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 5, cv2.LINE_AA)
        cv2.putText(img, str(n + 1), (sx, sy), cv2.FONT_HERSHEY_SIMPLEX, 1.0, colour, 2, cv2.LINE_AA)
    font, size, tall = cv2.FONT_HERSHEY_SIMPLEX, 0.5, 20
    lines = [part for text in lines for part in textwrap.wrap(text, width=max(20, (w - 16) // 9))]
    wide = min(w, max(cv2.getTextSize(t, font, size, 1)[0][0] for t in lines) + 16)
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


def draw(a):
    with open(a.look, encoding="utf-8") as f:
        look = json.load(f)
    marker_path = os.path.join(a.out, MARKER)
    if not os.path.exists(marker_path):
        sys.exit(f"{a.out} is not this tool's folder. Start through measure-points.")
    with open(marker_path, encoding="utf-8") as f:
        marker = json.load(f)
    wanted = {m["index"]: m for m in look["frames"]}
    pictures = {}
    cap = cv2.VideoCapture(a.video)
    for i, (t, img) in enumerate(sampled_frames(cap, a.fps)):
        m = wanted.get(i)
        if m is not None:
            if abs(m["t"] - t) > 0.05:
                sys.exit(f"Frame {i + 1} of the file is at {m['t']} ms and the video's at {t} ms: is it the same video?")
            pictures[i] = img
    cap.release()
    if set(pictures) != set(wanted):
        sys.exit(f"{len(set(wanted) - set(pictures))} frames of the file are not in the video: is it the same video?")
    # Only what this folder's last run wrote: nothing else here is ours to remove.
    for old in marker["pictures"]:
        old_path = os.path.join(a.out, os.path.basename(old))
        if os.path.exists(old_path):
            os.remove(old_path)
    drawn, names = [], []
    for n, m in enumerate(sorted(look["frames"], key=lambda x: x["index"])):
        lines = m.get("lines") or [f"{m['t'] / 1000:.2f} s  frame {m['index'] + 1}", m["why"], f"people in the file: {len(m['people'])}"]
        img = draw_frame(pictures[m["index"]].copy(), m["people"], lines)
        word = "".join(c if c.isalnum() else "_" for c in m["why"])[:28].strip("_")
        name = f"{n + 1:02d}_{word}.jpg"
        names.append(name)
        cv2.imwrite(os.path.join(a.out, name), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        drawn.append(img)
    if drawn:
        sheet(drawn, os.path.join(a.out, "all.jpg"))
    marker["pictures"] = names + (["all.jpg"] if drawn else [])
    with open(marker_path, "w", encoding="utf-8") as f:
        json.dump(marker, f)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="job", required=True)
    m = sub.add_parser("measure")
    m.add_argument("--video", required=True)
    m.add_argument("--out", required=True)
    m.add_argument("--label", required=True)
    m.add_argument("--fps", type=float, required=True)
    m.add_argument("--people", type=int, required=True)
    m.add_argument("--model", required=True)
    m.add_argument("--tool-version", type=int, required=True)
    d = sub.add_parser("draw")
    d.add_argument("--look", required=True)
    d.add_argument("--video", required=True)
    d.add_argument("--fps", type=float, required=True)
    d.add_argument("--out", required=True)
    a = p.parse_args()
    if a.job == "measure":
        measure(a)
    else:
        draw(a)


if __name__ == "__main__":
    main()
