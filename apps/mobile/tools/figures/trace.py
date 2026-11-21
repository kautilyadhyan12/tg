"""Makes the Exercise Library's body figures (src/library/figures.ts) from Kd's four line drawings.

    python apps/mobile/tools/figures/trace.py

Needs Python 3 with OpenCV (cv2) and NumPy. For each drawing (male and female, front and back,
made by Kd in ChatGPT on 2026-11-19 as colouring-book line art, 1024 x 1536):
1. The viewer's left half is mirrored onto the right, so both sides match exactly.
2. Every closed white shape inside the body is found; the drawn lines are the gaps between them.
3. A seed point below names the shape it falls in as a muscle (the word list of
   packages/shared/src/library/words.ts); the same point mirrored names its twin. A shape no seed
   names (head, hands, knees, feet) is drawn but never lit.
4. Each shape's outline is written as an SVG path, in the drawing's own pixels.
The script refuses to write if a seed falls on no shape or names a word the list lacks.
"""
import json
import os
import re
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "src", "library", "figures.ts")
WORDS = os.path.join(HERE, "..", "..", "..", "..", "packages", "shared", "src", "library", "words.ts")
MID = 511  # the body's middle, measured on all four drawings (the head's centre and the torso's line)

# Seed points on the viewer's left half, in the drawing's pixels.
SEEDS = {
    "male-front": {
        "neck": [(483, 251), (507, 252)], "upper_traps": [(457, 273)], "upper_chest": [(430, 312)],
        "lower_chest": [(440, 377)], "front_delts": [(343, 331)], "side_delts": [(320, 337)],
        "biceps": [(335, 425)], "brachialis": [(302, 445)], "brachioradialis": [(268, 557)],
        "forearm_flexors": [(283, 597)], "serratus": [(387, 419), (397, 447), (405, 474)],
        "abs": [(482, 438), (478, 484), (478, 535), (511, 628)], "obliques": [(432, 571)],
        "hip_flexors": [(462, 717)], "outer_hip": [(395, 721)], "sartorius": [(458, 795)],
        "adductors": [(487, 803)], "vastus_lateralis": [(397, 902)], "rectus_femoris": [(427, 845)],
        "vastus_medialis": [(455, 951)], "peroneals": [(396, 1222)], "tibialis": [(422, 1167)],
        "calves": [(460, 1137)], "soleus": [(440, 1246)],
    },
    "male-back": {
        "neck": [(507, 231)], "upper_traps": [(463, 273)], "middle_traps": [(463, 320)],
        "lower_traps": [(494, 401)], "rear_delts": [(355, 326)], "side_delts": [(317, 332)],
        "infraspinatus": [(408, 351)], "teres_major": [(388, 385)], "rhomboids": [(450, 371), (442, 337)],
        "triceps_long": [(338, 428)], "triceps_lateral": [(305, 425)], "forearm_extensors": [(281, 592)],
        "brachioradialis": [(265, 558)], "lats": [(435, 474)], "lower_back": [(489, 566)],
        "obliques": [(432, 601)], "glute_med": [(421, 651)], "glute_max": [(455, 727)],
        "biceps_femoris": [(404, 888)], "inner_hamstrings": [(447, 900), (474, 908)],
        "adductor_magnus": [(493, 842)], "calves": [(401, 1130), (445, 1148)], "soleus": [(416, 1245)],
    },
    "female-front": {
        "neck": [(484, 247), (507, 252)], "upper_traps": [(466, 273)], "upper_chest": [(443, 313)],
        "lower_chest": [(447, 380)], "front_delts": [(366, 327)], "side_delts": [(342, 343)],
        "biceps": [(353, 420)], "brachialis": [(322, 437)], "brachioradialis": [(286, 549)],
        "forearm_flexors": [(293, 595)], "serratus": [(399, 423), (406, 446), (414, 472)],
        "abs": [(487, 439), (483, 482), (483, 530), (511, 624)], "obliques": [(437, 582)],
        "hip_flexors": [(463, 718)], "outer_hip": [(375, 721)], "sartorius": [(452, 797)],
        "adductors": [(486, 809)], "vastus_lateralis": [(387, 879)], "rectus_femoris": [(416, 835)],
        "vastus_medialis": [(454, 951)], "peroneals": [(401, 1212)], "tibialis": [(428, 1166)],
        "calves": [(465, 1142)], "soleus": [(447, 1258)],
    },
    "female-back": {
        "neck": [(507, 231)], "upper_traps": [(470, 273)], "middle_traps": [(469, 316)],
        "lower_traps": [(498, 398)], "rear_delts": [(376, 324)], "side_delts": [(338, 338)],
        "infraspinatus": [(423, 348)], "teres_major": [(405, 383)], "rhomboids": [(459, 368), (455, 335)],
        "triceps_long": [(355, 428)], "triceps_lateral": [(326, 420)], "forearm_extensors": [(294, 594)],
        "brachioradialis": [(282, 552)], "lats": [(443, 471)], "lower_back": [(491, 569)],
        "obliques": [(434, 597)], "glute_med": [(412, 648)], "glute_max": [(446, 729)],
        "biceps_femoris": [(394, 882)], "inner_hamstrings": [(443, 900), (474, 920)],
        "adductor_magnus": [(492, 848)], "calves": [(405, 1130), (450, 1147)], "soleus": [(423, 1245)],
    },
}


def known_words():
    text = open(WORDS, encoding="utf-8").read()
    block = text[text.index("export const EXERCISE_MUSCLES = [") : text.index("] as const;", text.index("export const EXERCISE_MUSCLES"))]
    return set(re.findall(r'"([a-z_]+)"', block))


def mirrored(gray):
    out = np.full_like(gray, 255)
    left = gray[:, : MID + 1]
    out[:, : MID + 1] = left
    right = left[:, ::-1][:, 1:]
    width = min(right.shape[1], gray.shape[1] - MID - 1)
    out[:, MID + 1 : MID + 1 + width] = right[:, :width]
    return out


def shapes(gray):
    lines = cv2.dilate((gray < 140).astype(np.uint8), np.ones((3, 3), np.uint8))
    count, lab, stats, _ = cv2.connectedComponentsWithStats((1 - lines).astype(np.uint8), connectivity=4)
    h, w = gray.shape
    labels = np.zeros_like(lab, dtype=np.int32)
    k = 0
    for i in range(1, count):
        x, y, bw, bh, area = stats[i]
        if x == 0 or y == 0 or x + bw >= w or y + bh >= h or area < 120:
            continue  # the room around the body, or a speck
        k += 1
        labels[lab == i] = k
    return labels


def nearest(lab, x, y, reach=8):
    """The shape under (x, y), or, for a point on a drawn line, the nearest within `reach` pixels."""
    if lab[y, x]:
        return int(lab[y, x])
    box = lab[y - reach : y + reach + 1, x - reach : x + reach + 1]
    ys, xs = np.nonzero(box)
    if len(xs) == 0:
        return 0
    i = int(np.argmin((xs - reach) ** 2 + (ys - reach) ** 2))
    return int(box[ys[i], xs[i]])


def trace(name, words):
    gray = mirrored(cv2.imread(os.path.join(HERE, f"{name}.png"), cv2.IMREAD_GRAYSCALE))
    lab = shapes(gray)
    owner = {}
    for muscle, points in SEEDS[name].items():
        if muscle not in words:
            sys.exit(f"{name}: {muscle} is not in the muscle word list")
        for x, y in points:
            for px in {x, 2 * MID - x}:
                k = nearest(lab, px, y)
                if k == 0:
                    sys.exit(f"{name}: the seed of {muscle} at {px},{y} is more than 8 pixels from any shape")
                owner[k] = muscle
    parts = []
    for k in range(1, int(lab.max()) + 1):
        mask = cv2.dilate((lab == k).astype(np.uint8), np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        d = ""
        for c in contours:
            c = cv2.approxPolyDP(c, 1.1, True)
            if len(c) >= 3:
                d += "M" + " ".join(f"{p[0][0]} {p[0][1]}" for p in c) + "Z"
        if d:
            parts.append({"m": owner.get(k, ""), "d": d})
    named = {p["m"] for p in parts if p["m"]}
    print(f"{name}: {len(parts)} shapes, {len(named)} muscles")
    return parts


def main():
    words = known_words()
    figures = {name: trace(name, words) for name in SEEDS}
    lines = [
        "// Made by apps/mobile/tools/figures/trace.py from Kd's four line drawings; never edited by hand.",
        "// Each part is one closed shape of the drawing, in its own pixels (1024 x 1536): `m` is the muscle",
        "// word it shows (packages/shared/src/library/words.ts), empty for a part never lit (head, hands, knees, feet).",
        "",
        'export type FigureName = "male-front" | "male-back" | "female-front" | "female-back";',
        "export interface FigurePart {",
        "  readonly m: string;",
        "  readonly d: string;",
        "}",
        "",
        "export const FIGURES: Readonly<Record<FigureName, readonly FigurePart[]>> = {",
    ]
    for name, parts in figures.items():
        lines.append(f'  "{name}": [')
        for p in parts:
            lines.append(f"    {{ m: {json.dumps(p['m'])}, d: {json.dumps(p['d'])} }},")
        lines.append("  ],")
    lines.append("};")
    open(OUT, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
    print("written", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
