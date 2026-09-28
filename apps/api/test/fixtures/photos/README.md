# Photo fixtures (ROADMAP 20c-iv-b)

Real phone photos that carry the place they were taken, for the gym page's photo
cleaner (`src/modules/orgs/gymPage/photoBytes.ts`). Each original is on Wikimedia
Commons, released by its author under **CC0 1.0** (public domain), read 2026-09-28.
`make.py` says how each file here was made from them.

| File | From | What it carries |
|---|---|---|
| `iphone16.jpg` | [File:IPhone 5C - front.jpg](https://commons.wikimedia.org/wiki/File:IPhone_5C_-_front.jpg), taken on an iPhone 16; copied whole | EXIF with 15 GPS tags, Photoshop IPTC (APP13), XMP, Adobe |
| `samsung-a56-meta.jpg` | [File:Samsung Galaxy Z Flip 7 Unfolded.jpg](https://commons.wikimedia.org/wiki/File:Samsung_Galaxy_Z_Flip_7_Unfolded.jpg), taken on a Galaxy A56 5G | its EXIF (5 GPS tags, orientation 6), ICC, APP4, JFIF, and Samsung's 467-byte `SEFT` trailer after the end (`Image_UTC_Data`) |
| `pixel7-meta.jpg` | [File:2025 liturgical candle.jpg](https://commons.wikimedia.org/wiki/File:2025_liturgical_candle.jpg), taken on a Pixel 7 | its EXIF (11 GPS tags), three XMP blocks, ICC, MPF, and the 7,615-byte second picture after the end |
| `iphone16-exif.png` | the iPhone photo, 120 px, written by Pillow | the iPhone's EXIF in an `eXIf` chunk, its XMP in `iTXt` |
| `iphone16-exif.webp` | the same | the iPhone's EXIF and XMP chunks |

The two `-meta` files keep every metadata block and every byte after the end exactly as
the phone wrote them; only the picture between is a small one, because both originals
are over 2 MB.
