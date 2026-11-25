# KWAZO for every exercise clip's corner (ROADMAP Stage 5 62b): the app's wordmark as look/Wordmark.tsx draws it, Inter
# Bold, leaned, KWA and O near-black, Z orange, on a white pill with a soft shadow (MARK_SHADOW in library-media-lib.ts),
# written as a transparent PNG that the clip command scales down. Made once; run again only if the wordmark changes:
#   python apps/api/tools/library-mark.py <Inter_700Bold.ttf from @expo-google-fonts/inter> 256 apps/api/tools/library-mark.png 0.9
# Needs Pillow (pip install pillow); it is not a dependency of the app.
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

font_path, height, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
opacity = float(sys.argv[4]) if len(sys.argv) > 4 else 0.9
S = 4  # drawn large, then made small, for smooth edges
H = height * S
size = round(H * 22 / 40)
font = ImageFont.truetype(font_path, size)
spacing = round(size * 0.5 / 22)
parts = [("KWA", (10, 9, 8, 255)), ("Z", (255, 138, 31, 255)), ("O", (10, 9, 8, 255))]

# The words alone, leaned as the phone leans a font with no slanted letters.
widths = [font.getlength(t) for t, _ in parts]
text_w = round(sum(widths) + spacing * (sum(len(t) for t, _ in parts) - 1))
asc, desc = font.getmetrics()
lean = 0.22
pad_lean = round((asc + desc) * lean)
words = Image.new("RGBA", (text_w + pad_lean, asc + desc), (0, 0, 0, 0))
d = ImageDraw.Draw(words)
x = 0
for t, colour in parts:
    for ch in t:
        d.text((x, 0), ch, font=font, fill=colour)
        x += font.getlength(ch) + spacing
words = words.transform(words.size, Image.AFFINE, (1, lean, -pad_lean, 0, 1, 0), resample=Image.BICUBIC)

pad_x = round(H * 18 / 40)
pill_w = words.width + 2 * pad_x - pad_lean
shadow = round(H * 0.18)  # MARK_SHADOW
canvas = Image.new("RGBA", (pill_w + 2 * shadow, H + 2 * shadow), (0, 0, 0, 0))
# A soft shadow under the pill, as the app's lightButton shadow.
sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle((shadow, shadow + round(H * 0.08), shadow + pill_w, shadow + H + round(H * 0.08)), radius=H // 2, fill=(0, 0, 0, 90))
canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(H * 0.12)))
ImageDraw.Draw(canvas).rounded_rectangle((shadow, shadow, shadow + pill_w, shadow + H), radius=H // 2, fill=(255, 255, 255, 255))
top = shadow + (H - (asc + desc)) // 2 + round(size * 0.04)
canvas.alpha_composite(words, (shadow + pad_x - pad_lean // 2, top))
if opacity < 1:
    a = canvas.getchannel("A").point(lambda v: round(v * opacity))
    canvas.putalpha(a)
canvas = canvas.resize((canvas.width // S, canvas.height // S), Image.LANCZOS)
canvas.save(out)
print(out, canvas.size, "shadow margin", shadow // S)
