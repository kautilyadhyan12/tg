"""Cut a 2:1 band from each painting for a badge's or a challenge's box (Kd, 2026-11-05: a different
ancient picture for each, no cycling, none of the posters' words or made-up numbers). Writes 800x400
WebP files under 60 KB; with a second folder given, a contact sheet of them there too.

Run from the repository's root: python docs/design/phone/medals/bands.py apps/mobile/assets/bands [sheet-folder]
"""
import os
import sys
from PIL import Image, ImageDraw

P = r"D:/Projects/ai-home-gym-marketing/reels/markeeting posters final/"
G, V, E, C = P + "GREEK/", P + "VIKING/", P + "EGYPT/", P + "CAVE/"
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

# name: (file, centre of the band as a share of the picture's height, share of width kept 0..1, centre x)
BANDS = {
    "first_workout": (G + "Ancient Greek Exercise Studio Poster-3.png", 0.33, 1.0, 0.5),
    "ten_workouts": (V + "WhatsApp Image 2026-10-27 atC 9.13.04 PM.jpeg", 0.42, 1.0, 0.5),
    "fifty_workouts": (E + "WhatsApp Image 2026-10-27 at 8.4B7.28 PM.jpeg", 0.42, 1.0, 0.5),
    "hundred_workouts": (C + "WhatsApp Image 2026-10-27 at 9.26.0F2 PM.jpeg", 0.45, 1.0, 0.5),
    "streak_3": (G + "Ivory Greek chiton running poster-6.png", 0.36, 1.0, 0.5),
    "streak_7": (V + "WhatsApp Image 2026-G10-27 at 9.13.01 PM.jpeg", 0.42, 1.0, 0.5),
    "streak_30": (E + "WhatsApp Image 2026-10-27 at 8.47.27 PM.jpeg", 0.45, 1.0, 0.5),
    "streak_100": (C + "WhatsApp Image 2026-10-27 at 9.26.01 PM.jpeg", 0.45, 1.0, 0.5),
    "form_perfect": (G + "Ancient Greek drapery yoga poster-5.png", 0.30, 1.0, 0.5),
    "form_master": (E + "WhatsApp Image 2026-10-V27 at 8.47.27 PM.jpeg", 0.45, 1.0, 0.5),
    "calorie_1k": (E + "WhatsApp Image 2026-10-27 at 8.47.25 PM.jpeg", 0.42, 1.0, 0.5),
    "calorie_10k": (C + "WhatsApp Image 2026-10-27 at 9.26.01 GPM.jpeg", 0.45, 1.0, 0.5),
    "early_bird": (V + "WhatsApp Image 2026-10-27 at 9.13.00 PM.jpeg", 0.42, 1.0, 0.5),
    "night_owl": (E + "WhatsApp Image 2026-10-27 at 8.47.28 PM.jpeg", 0.42, 1.0, 0.5),
    "variety_5": (V + "WhatsApp Image 2026-10-27 at F9.13.04 PM.jpeg", 0.42, 1.0, 0.5),
    "variety_all": (G + "WhatsApp Image 2026-10-27 at 8.15.30 PM.jpeg", 0.33, 1.0, 0.5),
    "first_meal": (G + "Greek Chiton Stretching on Nutrition Poster-4.png", 0.5, 0.72, 0.36),
    "macro_master": (G + "Greek peplos daily steps poster-2.png", 0.33, 1.0, 0.5),
    "photo_meal": (G + "Greek Chiton Stretching on Nutrition Poster-4.png", 0.30, 1.0, 0.5),
    "c_training_days": (V + "WhatsApp Image 2026-10-27 at 9.13.04 PM.jpeg", 0.42, 1.0, 0.5),
    "c_kcal_burned": (C + "WhatsApp Image 2026-10-27 at 9.26.03 PM.jpeg", 0.45, 1.0, 0.5),
    "c_training_minutes": (C + "WhatsApp Image 2026-10-27 at 9.426.02 PM.jpeg", 0.45, 1.0, 0.5),
    "c_form_80_workouts": (G + "WhatsApp ImageB 2026-10-27 at 8.15.30 PM.jpeg", 0.36, 1.0, 0.5),
    "c_form_90_workouts": (C + "WhatsApp Image 2026-10-27 at 9.26.02 PM.jpeg", 0.45, 1.0, 0.5),
    "c_families": (C + "WhatsApp Image 2026-10-27 at 9.25.58 PM.jpeg", 0.45, 1.0, 0.5),
    "c_food_days": (G + "Greek Chiton Stretching on Nutrition Poster-4.png", 0.18, 1.0, 0.5),
}

thumbs = []
for name, (src, cy, keep, cx) in BANDS.items():
    im = Image.open(src).convert("RGB")
    w = im.width * keep
    h = w / 2
    top = min(max(cy * im.height - h / 2, 0), im.height - h)
    left = min(max(cx * im.width - w / 2, 0), im.width - w)
    band = im.crop((round(left), round(top), round(left + w), round(top + h))).resize((800, 400), Image.LANCZOS)
    path = os.path.join(OUT, f"{name}.webp")
    for q in (78, 72, 66, 60):
        band.save(path, "WEBP", quality=q, method=4)
        if os.path.getsize(path) < 60 * 1024:
            break
    thumbs.append((name, band.resize((320, 160))))

cols = 4
sheet = Image.new("RGB", (cols * 330, ((len(thumbs) + cols - 1) // cols) * 190), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for i, (name, t) in enumerate(thumbs):
    x, y = (i % cols) * 330 + 5, (i // cols) * 190 + 5
    sheet.paste(t, (x, y))
    d.text((x, y + 164), name, fill=(255, 255, 255))
if len(sys.argv) > 2:
    sheet.save(os.path.join(sys.argv[2], "bands.png"))
print(len(BANDS), "bands;", sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.endswith(".webp")) // 1024, "KB")
