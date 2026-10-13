"""Make small copies of the member web's pictures for the phone's drawings.

Usage: python compact.py <apps/web/public/images> <out folder>
Each picture becomes <out>/<name>.webp, 900 pixels on its long side at most, and its
size before and after is printed. Needs Python's cv2 and numpy.
"""
import os, sys
import cv2
import numpy as np

WANT = {
    "hero": "exercises/lifting.jpg", "weight": "exercises/weight.jpg", "running": "wellness/running.jpg",
    "yoga": "wellness/yoga.jpg", "ready": "wellness/regularexercise.jpg",
    "totalworkout": "dashboard/totalworkout.png", "hourstrained": "dashboard/hourstrained.png",
    "caloriesburned": "dashboard/caloriesburned.png", "currentlevel": "dashboard/currentlevel.png",
    "experiencepoints": "dashboard/experiencepoints.png", "thisweek": "dashboard/thisweek.png",
    "dailymotivation": "dashboard/dailymotivation.png", "weeklychallenges": "dashboard/weeklychallenges.png",
    "rank": "dashboard/Screenshot (221).png", "latestbadges": "dashboard/latestbadges.png",
    "recommended": "dashboard/recommendedforyou.png", "recentworkout": "dashboard/recentworkout.png",
    "progress": "dashboard/progress.jpg", "setting": "dashboard/setting.png",
    "exhero": "exercises/backgroundexercise.png", "food": "nutrition/food.jpg", "foodbg": "nutrition/download.png",
    "monalisa": "achievements/monalisa.jpg", "squat": "exercises/squat.png", "chairsquat": "exercises/chairsquat.jpg",
    "bicepcurls": "exercises/bicepcurls.jpg", "benchpress": "exercises/benchpress.jpg",
    "cyclingcrunch": "exercises/cyclingcrunch.jpg", "jumpsquat": "exercises/jumpsquat.jpg",
    "ropping": "wellness/ropping.jpg", "yoga1": "wellness/yoga1.jpg",
}

# A picture cut for one screen: its file, the part kept (left, top, right, bottom, each 0 to 1)
# and its long side. "getstarted" is the browser's sign-in picture, cut to sit at the top of a phone.
CUT = {"getstarted": ("exercises/lifting.jpg", (0.30, 0.0, 1.0, 0.92), 1200)}

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
before = after = 0
for name, path in WANT.items():
    full = os.path.join(src, path)
    im = cv2.imdecode(np.fromfile(full, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    assert im is not None, path
    h, w = im.shape[:2]
    scale = min(1.0, 900 / max(w, h))
    if scale < 1:
        im = cv2.resize(im, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".webp", im, [cv2.IMWRITE_WEBP_QUALITY, 80])
    assert ok, path
    buf.tofile(os.path.join(out, name + ".webp"))
    before += os.path.getsize(full)
    after += len(buf)
    print(f"{name}: {w}x{h} {os.path.getsize(full) // 1024} KB -> {im.shape[1]}x{im.shape[0]} {len(buf) // 1024} KB")
print(f"total {before // 1024} KB -> {after // 1024} KB")
for name, (path, (left, top, right, bottom), long_side) in CUT.items():
    im = cv2.imdecode(np.fromfile(os.path.join(src, path), dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    assert im is not None, path
    h, w = im.shape[:2]
    im = im[round(top * h):round(bottom * h), round(left * w):round(right * w)]
    h, w = im.shape[:2]
    scale = min(1.0, long_side / max(w, h))
    im = cv2.resize(im, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".webp", im, [cv2.IMWRITE_WEBP_QUALITY, 80])
    assert ok, path
    buf.tofile(os.path.join(out, name + ".webp"))
    print(f"{name}: cut from {path} -> {im.shape[1]}x{im.shape[0]} {len(buf) // 1024} KB")
