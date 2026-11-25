// The clip line's laptop command, its pure parts (job 62a, `tools/library-media-lib.ts`). The worst thing it could do
// is put one exercise's clip or picture in another exercise's file: `withMedia` writes only into the file whose id it
// is given, and refuses a clip and a picture of different shapes, which cannot come from one final folder.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exerciseFileSchema } from "@app/shared";
import { edgeColour, finalFiles, isMp4, isPng, madeSize, MARK_IN, MARK_SHADOW, MARK_TALL, markPlace, withMedia } from "../tools/library-media-lib.js";

const SQUAT = readFileSync(new URL("../../../packages/shared/library/exercises/squat.json", import.meta.url), "utf8");
const hash = "d".repeat(64);
const picture = { file: `${hash}.webp`, width: 720, height: 1280, bytes: 30_000, ground: "#D5D5D5" };
const clip = { file: `${hash}.mp4`, width: 720, height: 1280, bytes: 188_000, seconds: 4 };

describe("the worst thing: one exercise's clip or picture written into another's file", () => {
  it("writes into the file whose id it is given, and refuses another's", () => {
    const out = exerciseFileSchema.parse(JSON.parse(withMedia(SQUAT, "squat", picture, clip)));
    expect(out.id).toBe("squat");
    expect(out.picture).toEqual(picture);
    expect(out.clip).toEqual(clip);
    expect(() => withMedia(SQUAT, "plank", picture, clip)).toThrow('the file\'s id is "squat", not "plank"');
  });

  it("refuses a clip and a picture of different shapes", () => {
    expect(() => withMedia(SQUAT, "squat", picture, { ...clip, width: 1280, height: 720 })).toThrow("not the same shape");
  });

  it("changes nothing else in the file, and writes it as the files are written", () => {
    const out = withMedia(SQUAT, "squat", picture, clip);
    const before = exerciseFileSchema.parse(JSON.parse(SQUAT));
    expect(JSON.parse(out)).toEqual({ ...before, picture, clip });
    expect(out.endsWith("}\n")).toBe(true);
    expect(out.split("\n")[1]).toBe('  "id": "squat",');
  });
});

describe("only a final folder's two files are read", () => {
  it.each([
    [join("D:", "vidoe referene", "kettlebell goblet squat"), join("D:", "vidoe referene", "kettlebell goblet squat", "final")],
    [join("D:", "vidoe referene", "kettlebell goblet squat", "final"), join("D:", "vidoe referene", "kettlebell goblet squat", "final")],
    [join("D:", "x", "dumbbell overhead triceps extension", "final_seated"), join("D:", "x", "dumbbell overhead triceps extension", "final_seated")],
    [`${join("D:", "x", "calf", "final")}/`, join("D:", "x", "calf", "final")],
  ])("%s → final.mp4 and final.png in %s", (given, folder) => {
    expect(finalFiles(given)).toEqual({ clip: join(folder, "final.mp4"), picture: join(folder, "final.png") });
  });

  it("a loose clip beside the final folder is never what is read", () => {
    const read = finalFiles(join("D:", "x", "standing dumbbell calf raise", "calf raise.mp4"));
    expect(read.clip.endsWith(join("calf raise.mp4", "final", "final.mp4"))).toBe(true);
  });

  it("knows a PNG and an MP4 by their first bytes, never by the name", () => {
    expect(isPng(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe(true);
    expect(isPng(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(isMp4(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0]))).toBe(true);
    expect(isMp4(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });
});

describe("the size a clip and a picture are made at", () => {
  it.each([
    [1080, 1920, 720, 1280],
    [941, 1672, 720, 1280],
    [1920, 1080, 1280, 720],
    [1672, 941, 1280, 720],
    [2972, 1672, 1280, 720],
    [720, 1280, 720, 1280],
    [480, 640, 480, 640],
  ])("%i×%i → %i×%i: its own shape, at most 1280 long, both sides even, never made larger", (w, h, ew, eh) => {
    expect(madeSize(w, h)).toEqual({ width: ew, height: eh });
  });
});

describe("the colour round a picture's edge", () => {
  const picture = (w: number, h: number, edge: [number, number, number], middle: [number, number, number]) => {
    const rgb = new Uint8Array(w * h * 3);
    const band = Math.max(1, Math.round(Math.min(w, h) * 0.02));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = x >= band && x < w - band && y >= band && y < h - band;
        rgb.set(inside ? middle : edge, (y * w + x) * 3);
      }
    }
    return rgb;
  };

  it("is the edge's colour, whatever the person in the middle wears", () => {
    expect(edgeColour(picture(100, 180, [213, 213, 213], [0, 0, 0]), 100, 180)).toBe("#D5D5D5");
    expect(edgeColour(picture(180, 100, [183, 181, 182], [255, 0, 0]), 180, 100)).toBe("#B7B5B6");
  });

  it("refuses bytes that are not that many pixels", () => {
    expect(() => edgeColour(new Uint8Array(10), 4, 4)).toThrow("is not 4×4 pixels");
  });
});

// KWAZO in a corner of every clip (62b): the app's wordmark picture (890 × 348, its pill 256 tall inside its shadow).
describe("KWAZO's place in a clip", () => {
  const mark = { width: 890, height: 348 };
  it.each([
    [{ width: 720, height: 1280 }, "left", { width: 238, height: 93, x: 17, y: 1170 }],
    [{ width: 720, height: 1280 }, "right", { width: 238, height: 93, x: 465, y: 1170 }],
    [{ width: 1280, height: 720 }, "left", { width: 238, height: 93, x: 17, y: 610 }],
    [{ width: 1280, height: 720 }, "right", { width: 238, height: 93, x: 1025, y: 610 }],
    [{ width: 1080, height: 1920 }, "left", { width: 358, height: 140, x: 25, y: 1755 }],
  ] as const)("%o, bottom-%s", (clipSize, corner, placed) => {
    expect(markPlace(clipSize, mark, corner)).toEqual(placed);
  });

  it("the pill sits the same share in from its side and its foot, inside the clip, in every shape", () => {
    for (const clipSize of [{ width: 720, height: 1280 }, { width: 1280, height: 720 }, { width: 1080, height: 1920 }, { width: 640, height: 640 }]) {
      for (const corner of ["left", "right"] as const) {
        const p = markPlace(clipSize, mark, corner);
        const short = Math.min(clipSize.width, clipSize.height);
        const shadow = Math.round(short * MARK_TALL * MARK_SHADOW);
        const inset = Math.round(short * MARK_IN);
        expect(clipSize.height - (p.y + p.height - shadow)).toBe(inset);
        expect(corner === "left" ? p.x + shadow : clipSize.width - (p.x + p.width - shadow)).toBe(inset);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.width).toBeLessThanOrEqual(clipSize.width);
        expect(p.y + p.height).toBeLessThanOrEqual(clipSize.height);
      }
    }
  });
});
