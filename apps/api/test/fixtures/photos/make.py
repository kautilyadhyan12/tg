# How the photo fixtures in this folder were made (ROADMAP 20c-iv-b). Run once, by hand,
# with Pillow; CI never runs it. The sources are real phone photos on Wikimedia Commons,
# each released CC0 (public domain) by its author, read 2026-09-28 — see README.md.
#
#   python make.py <folder holding the five downloaded originals>
#
# iphone16.jpg is copied whole. The Samsung and Pixel originals are over 2 MB, so each
# keeps EVERY metadata block its phone wrote, and the bytes after its end (Samsung's
# trailer, the Pixel's second picture), exactly as they were; only the picture in the
# middle is swapped for a small one Pillow drew from the same photo. The PNG and WebP
# carry the iPhone's real EXIF (its GPS position) and XMP, written by Pillow, since no
# phone saves either format with a position of its own.
import io, shutil, sys
from pathlib import Path
from PIL import Image

src = Path(sys.argv[1])
here = Path(__file__).parent


def segments(b):
    """(marker, start, end) for each block before the first scan, the scan start, the end
    of the image, as a JPEG reader walks them."""
    out, at = [], 2
    while True:
        m = b[at + 1]
        n = int.from_bytes(b[at + 2:at + 4], "big")
        if m == 0xDA:
            return out, at
        out.append((m, at, at + 2 + n))
        at += 2 + n


def first_eoi(b, scan):
    at = scan
    while True:
        at = b.index(b"\xff", at)
        nxt = b[at + 1]
        if nxt == 0xD9:
            return at + 2
        at += 1


def small_picture(original):
    im = Image.open(io.BytesIO(original))
    im.thumbnail((96, 96))
    out = io.BytesIO()
    im.convert("RGB").save(out, "JPEG", quality=80)  # no EXIF, no XMP
    return out.getvalue()


def transplant(name, out_name):
    b = (src / name).read_bytes()
    meta, _ = segments(b)
    kept = b"".join(b[s:e] for m, s, e in meta if 0xE0 <= m <= 0xEF or m == 0xFE)
    tail = b[first_eoi(b, segments(b)[1]):]
    tiny = small_picture(b)
    tmeta, tscan = segments(tiny)
    tables = b"".join(tiny[s:e] for m, s, e in tmeta if not (0xE0 <= m <= 0xEF or m == 0xFE))
    body = tiny[tscan:first_eoi(tiny, tscan)]
    (here / out_name).write_bytes(b"\xff\xd8" + kept + tables + body + tail)


shutil.copyfile(src / "iphone16.jpg", here / "iphone16.jpg")
transplant("samsung-a56.jpg", "samsung-a56-meta.jpg")
transplant("pixel7.jpg", "pixel7-meta.jpg")

iphone = Image.open(src / "iphone16.jpg")
exif = iphone.info["exif"]
xmp = iphone.info.get("xmp") or b""
small = iphone.copy()
small.thumbnail((120, 120))
# The XMP goes in an iTXt chunk, where Photoshop and Pillow put it in a PNG.
from PIL import PngImagePlugin
info = PngImagePlugin.PngInfo()
info.add_itxt("XML:com.adobe.xmp", xmp.decode("utf-8", "replace") if isinstance(xmp, bytes) else str(xmp))
small.save(here / "iphone16-exif.png", "PNG", exif=exif, pnginfo=info)
small.save(here / "iphone16-exif.webp", "WEBP", exif=exif, xmp=xmp, quality=80)

# A progressive JPEG (the picture in several passes) with a phone's EXIF where a simple
# reader stops looking: after the first pass. Pillow draws the picture; the EXIF block is
# the Galaxy A56's own, as its phone wrote it (review of 20c-iv-b, round one, test 3).
samsung = (src / "samsung-a56.jpg").read_bytes()
meta, _ = segments(samsung)
exif_block = next(samsung[s:e] for m, s, e in meta if m == 0xE1 and samsung[s + 4:s + 10] == b"Exif\0\0")
prog = io.BytesIO()
small.convert("RGB").save(prog, "JPEG", quality=80, progressive=True)
p = prog.getvalue()
_, first_scan = segments(p)
at = first_scan + 2 + int.from_bytes(p[first_scan + 2:first_scan + 4], "big")
while not (p[at] == 0xFF and p[at + 1] not in (0x00, 0xFF, *range(0xD0, 0xD8))):
    at += 1
(here / "progressive-exif-between-scans.jpg").write_bytes(p[:at] + exif_block + p[at:])
