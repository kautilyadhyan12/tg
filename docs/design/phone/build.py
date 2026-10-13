"""Make the phone app's drawings from pages/*.src.html.

Usage: python build.py <out folder> [Name ...]     (no names: every page)
Writes <out>/project/<Name>.dc.html (dark) and <Name>Light.dc.html (light), and
<out>/sizes.json with each drawing's width and height.

In a page file: <!--HELMET--> is shared/helmet.html, <!--TABBAR:food--> the five tabs
with Food lit, <!--I:flame:20--> an icon from shared/icons.json at 20 px, and %H% the
height, measured in headless Edge unless the root says data-fixed-h.
"""
import glob, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def shared(name):
    return open(os.path.join(HERE, "shared", name), encoding="utf-8").read().strip()


ICONS = json.loads(shared("icons.json"))


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


def measure(html, width, out):
    probe = html.replace("height: %H%px", "height: auto").replace(
        "</body>",
        '<script>document.fonts.ready.then(function(){var r=document.querySelector("[data-root]");'
        'document.title="H="+Math.ceil(r.scrollHeight);});</script></body>')
    path = os.path.join(out, "check", "probe.html")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8", newline="\n").write(probe)
    dom = subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--virtual-time-budget=8000",
                          f"--window-size={width},1200", "--dump-dom",
                          "file:///" + path.replace("\\", "/")],
                         capture_output=True, text=True, encoding="utf-8").stdout
    m = re.search(r"<title>H=(\d+)</title>", dom)
    assert m, "no height measured"
    return int(m.group(1))


def light(html):
    assert html.count('class="screen t-dark"') == 1
    s = html.replace('class="screen t-dark"', 'class="screen t-light"')
    s = s.replace('data-look="light" aria-checked="false"', 'data-look="light" aria-checked="TRUE_"')
    s = s.replace('data-look="dark" aria-checked="true"', 'data-look="dark" aria-checked="false"')
    s = s.replace('aria-checked="TRUE_"', 'aria-checked="true"')
    return s.replace(", dark</title>", ", light</title>")


out = os.path.abspath(sys.argv[1])
names = sys.argv[2:] or sorted(os.path.basename(p)[:-len(".src.html")]
                               for p in glob.glob(os.path.join(HERE, "pages", "*.src.html")))
os.makedirs(os.path.join(out, "project"), exist_ok=True)
sizes_path = os.path.join(out, "sizes.json")
sizes = json.load(open(sizes_path)) if os.path.exists(sizes_path) else {}
for name in names:
    html = expand(open(os.path.join(HERE, "pages", f"{name}.src.html"), encoding="utf-8").read())
    width = int(re.search(r'data-root="1"[^>]*?style="width: (\d+)px', html).group(1))
    fixed = re.search(r'data-fixed-h="(\d+)"', html)
    h = int(fixed.group(1)) if fixed else (measure(html, width, out) + 9) // 10 * 10
    final = html.replace("%H%", str(h))
    for out_name, text in ((name, final), (name + "Light", light(final))):
        open(os.path.join(out, "project", f"{out_name}.dc.html"), "w", encoding="utf-8",
             newline="\n").write(text)
        sizes[out_name] = {"w": width, "h": h}
    print(f"{name}: {width} x {h}")
json.dump(sizes, open(sizes_path, "w"), indent=1)
