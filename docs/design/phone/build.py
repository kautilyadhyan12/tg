"""Make the phone app's drawings from pages/*.src.html.

Usage: python build.py <out folder> <folder of pictures> [Name ...]   (no names: every page)
Writes <out>/project/<Name>.dc.html for the design canvas, <out>/check/<Name>.html for
a look in a browser on this computer, and <out>/sizes.json with each drawing's size.

In a page file: <!--HELMET--> is shared/helmet.html, <!--TABBAR:food--> the five tabs
with Food lit, <!--I:flame:20--> an icon from shared/icons.json at 20 px, %IMG:hero% a
picture (shared/images.json has its address on the canvas; the browser look reads
<folder of pictures>/hero.webp), and %H% the height, measured in headless Edge unless
the root says data-fixed-h. The pictures are the member web's own, made small by
compact.py.
"""
import glob, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def shared(name):
    return open(os.path.join(HERE, "shared", name), encoding="utf-8").read().strip()


ICONS = json.loads(shared("icons.json"))
IMAGES = json.loads(shared("images.json"))


def icon(m):
    name, size = m.group(1), m.group(2)
    return (f'<svg class="ic" width="{size}" height="{size}" viewBox="0 0 24 24" '
            f'aria-hidden="true">{ICONS[name]}</svg>')


def expand(src):
    s = src.replace("<!--HELMET-->", shared("helmet.html"))
    for tab in re.findall(r"<!--TABBAR:([a-z]+)-->", s):
        bar = shared("tabbar.html")
        old = f'class="tab" data-tab="{tab}"'
        assert bar.count(old) == 1, tab
        bar = bar.replace(old, f'class="tab tab-on" aria-current="page" data-tab="{tab}"')
        s = s.replace(f"<!--TABBAR:{tab}-->", bar)
    s = re.sub(r"<!--I:([a-z]+):(\d+)-->", icon, s)
    assert "<!--" not in s, "unexpanded marker"
    return s


def pictures(html, local):
    return re.sub(r"%IMG:([a-z0-9]+)%", lambda m: local(m.group(1)) if local else IMAGES[m.group(1)], html)


def measure(path, width):
    probe = path[:-5] + ".probe.html"
    html = open(path, encoding="utf-8").read().replace("height: %H%px", "height: auto").replace(
        "</body>",
        '<script>window.addEventListener("load",function(){document.fonts.ready.then(function(){'
        'var r=document.querySelector("[data-root]");document.title="H="+Math.ceil(r.scrollHeight);});});'
        '</script></body>')
    open(probe, "w", encoding="utf-8", newline="\n").write(html)
    dom = subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--virtual-time-budget=8000",
                          f"--window-size={width},1200", "--dump-dom",
                          "file:///" + probe.replace("\\", "/")],
                         capture_output=True, text=True, encoding="utf-8").stdout
    os.remove(probe)
    m = re.search(r"<title>H=(\d+)</title>", dom)
    assert m, "no height measured"
    return int(m.group(1))


out, img = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
names = sys.argv[3:] or sorted(os.path.basename(p)[:-len(".src.html")]
                               for p in glob.glob(os.path.join(HERE, "pages", "*.src.html")))
for sub in ("project", "check"):
    os.makedirs(os.path.join(out, sub), exist_ok=True)
sizes_path = os.path.join(out, "sizes.json")
sizes = json.load(open(sizes_path)) if os.path.exists(sizes_path) else {}
local = lambda name: "file:///" + os.path.join(img, name + ".webp").replace("\\", "/")
for name in names:
    html = expand(open(os.path.join(HERE, "pages", f"{name}.src.html"), encoding="utf-8").read())
    width = int(re.search(r'data-root="1"[^>]*?style="width: (\d+)px', html).group(1))
    check = os.path.join(out, "check", f"{name}.html")
    open(check, "w", encoding="utf-8", newline="\n").write(pictures(html, local))
    fixed = re.search(r'data-fixed-h="(\d+)"', html)
    h = int(fixed.group(1)) if fixed else (measure(check, width) + 9) // 10 * 10
    for path, text in ((check, pictures(html, local)),
                       (os.path.join(out, "project", f"{name}.dc.html"), pictures(html, None))):
        open(path, "w", encoding="utf-8", newline="\n").write(text.replace("%H%", str(h)))
    sizes[name] = {"w": width, "h": h}
    print(f"{name}: {width} x {h}")
json.dump(sizes, open(sizes_path, "w"), indent=1)
