"""The Achievements medals (ROADMAP Stage 5 35c-iii) as small WebP pictures for the phone.

Draws medals.html in headless Edge on a clear background, reads where each medal sits from
the page itself, cuts each one out and saves it under apps/mobile/assets/medals:

- medal_<code>.webp         an earned badge, 420 x 490
- medal_<code>_locked.webp  the same medal grey and dark, for a badge not earned yet, 312 x 364
- coin_<measure>_<metal>.webp  a weekly challenge's coin, 156 x 156, and its _grey twin
- place_<n>.webp            the leaderboard's I, II and III coins, 120 x 120

Run from the repository's root: python docs/design/phone/medals/make.py
"""
import os
import re
import subprocess
import tempfile
import time

from PIL import Image, ImageEnhance

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "medals.html")
OUT = os.path.join(ROOT, "apps", "mobile", "assets", "medals")
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
SCALE = 4 / 3  # the page's 360-wide cells come out 480 wide

url = "file:///" + PAGE.replace("\\", "/")
# Where each picture sits, worked out as the page's own script lays them: eight to a row,
# the medals in the page's order, then each challenge coin in its three metals, then I, II, III.
page = open(PAGE, encoding="utf-8").read()
medals = re.findall(r"^ (\w+):\(\)=>coin\(", page[page.index("const B={"):], re.M)
measures = re.findall(r"^ (\w+):\(m\)=>", page[page.index("const EMB={"):], re.M)
names = [f"medal_{m}" for m in medals] + [f"coin_{m}_{metal}" for m in measures for metal in ("bronze", "silver", "gold")] + ["place_1", "place_2", "place_3"]
cells = [{"name": n, "x": (i % 8) * 380, "y": (i // 8) * 440, "w": 360, "h": 420 if n.startswith("medal_") else 360} for i, n in enumerate(names)]
if len(medals) != 23 or len(measures) != 7:
    raise SystemExit(f"read {len(medals)} medals and {len(measures)} coins from the page")
width = max(c["x"] + c["w"] for c in cells) + 20
height = max(c["y"] + c["h"] for c in cells) + 20

shot = os.path.join(tempfile.mkdtemp(), "medals.png")
edge = subprocess.Popen([EDGE, "--headless", "--disable-gpu", "--allow-file-access-from-files", "--virtual-time-budget=3000",
                         "--default-background-color=00000000", f"--force-device-scale-factor={SCALE:.4f}",
                         f"--window-size={width},{height}", f"--screenshot={shot}", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
# Edge started from Python can stay open after it has written the picture: wait for the file, then close it.
for _ in range(120):
    if os.path.exists(shot) and os.path.getsize(shot) > 0:
        size = os.path.getsize(shot)
        time.sleep(1)
        if os.path.getsize(shot) == size:
            break
    time.sleep(0.5)
else:
    edge.kill()
    raise SystemExit("Edge wrote no picture")
edge.kill()
sheet = Image.open(shot).convert("RGBA")


def cut(c):
    box = tuple(round(v * SCALE) for v in (c["x"], c["y"], c["x"] + c["w"], c["y"] + c["h"]))
    return sheet.crop(box)


def grey(img, dark):
    """The same picture without its colour and darker; its clear edges kept."""
    alpha = img.getchannel("A")
    flat = ImageEnhance.Brightness(img.convert("L").convert("RGB")).enhance(dark)
    flat = ImageEnhance.Contrast(flat).enhance(1.1).convert("RGBA")
    flat.putalpha(alpha)
    return flat


def save(img, name, size):
    img.resize(size, Image.LANCZOS).save(os.path.join(OUT, name + ".webp"), "WEBP", quality=86, method=4)


os.makedirs(OUT, exist_ok=True)
for c in cells:
    img = cut(c)
    if c["name"].startswith("medal_"):
        save(img, c["name"], (420, 490))
        save(grey(img, 0.42), c["name"] + "_locked", (312, 364))
    elif c["name"].startswith("coin_"):
        save(img, c["name"], (156, 156))
        save(grey(img, 0.45), c["name"] + "_grey", (156, 156))
    else:
        save(img, c["name"], (120, 120))

total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print(f"{len(os.listdir(OUT))} pictures, {total // 1024} KB, in {OUT}")
