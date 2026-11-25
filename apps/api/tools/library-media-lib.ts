// The pure parts of the clip line's laptop command (job 62a, `tools/library-media.ts`): which folder of Kd's is read,
// the size a clip and a picture are made, the colour round a picture's edge, and an exercise's file with its picture
// and clip written in. Tested in `test/library.media.unit.test.ts`.
import { basename, join } from "node:path";
import { exerciseFileSchema, type ExerciseClip, type ExercisePicture } from "@app/shared";

/** The long side a clip and a picture are made at (measured 2026-11-24: a clip 188 to 298 KB, a picture 30 to 58 KB,
 *  each as like its original as the eye can tell). A smaller original is never made larger. */
export const LONG_SIDE = 1280;

/** Kd's finished clip and picture of an exercise are `final.mp4` and `final.png` in a folder named `final` (or
 *  `final_<something>`, where one exercise has two). Given that folder, or the exercise's folder holding `final`, the
 *  two files' paths; the command refuses when either is missing. A loose clip beside them is never read: it is not
 *  finished. */
export function finalFiles(given: string): { clip: string; picture: string } {
  const trimmed = given.replace(/[\\/]+$/, "");
  const folder = /^final(?:_[a-z0-9-]+)?$/i.test(basename(trimmed)) ? trimmed : join(trimmed, "final");
  return { clip: join(folder, "final.mp4"), picture: join(folder, "final.png") };
}

/** The size a clip or picture is made at: its own shape, the long side at most `LONG_SIDE`, both sides even (H.264
 *  needs them so). */
export function madeSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, LONG_SIDE / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Whether the bytes begin as a PNG does. */
export const isPng = (bytes: Uint8Array): boolean => bytes.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b);
/** Whether the bytes begin as an MP4 does: a first box named "ftyp". */
export const isMp4 = (bytes: Uint8Array): boolean => bytes.length > 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp";

/** The colour round a picture's edge: the mean of the outer 2 % on every side (at least one pixel), from its pixels as
 *  red, green and blue bytes in rows. The phone runs it to the screen's edges, so the picture is never a box. */
export function edgeColour(rgb: Uint8Array, width: number, height: number): string {
  if (rgb.length !== width * height * 3) throw new Error(`edgeColour: ${String(rgb.length)} bytes is not ${String(width)}×${String(height)} pixels`);
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.02));
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const at = (y * width + x) * 3;
      sum[0] = (sum[0] ?? 0) + (rgb[at] ?? 0);
      sum[1] = (sum[1] ?? 0) + (rgb[at + 1] ?? 0);
      sum[2] = (sum[2] ?? 0) + (rgb[at + 2] ?? 0);
      n += 1;
    }
  }
  return `#${sum.map((s) => Math.round(s / n).toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

/** An exercise's file with its picture and clip written in, as the files are written (two spaces, a last newline).
 *  The file must be a whole exercise's before and after; the picture and the clip must be the same shape. */
export function withMedia(fileText: string, id: string, picture: ExercisePicture, clip: ExerciseClip): string {
  const before = exerciseFileSchema.safeParse(JSON.parse(fileText));
  if (!before.success) throw new Error(`${id}.json is not a whole exercise's file: fix it first (corepack pnpm --filter @app/shared test)`);
  if (before.data.id !== id) throw new Error(`the file's id is "${before.data.id}", not "${id}"`);
  if (picture.width > picture.height !== clip.width > clip.height) throw new Error("the clip and the picture are not the same shape: they come from one final folder");
  const after = exerciseFileSchema.parse({ ...before.data, picture, clip });
  return `${JSON.stringify(after, null, 2)}\n`;
}

/** The mean of colours written as #RRGGBB. */
export function meanColour(colours: readonly string[]): string {
  if (colours.length === 0) throw new Error("meanColour: no colours");
  const sum = [0, 0, 0];
  for (const c of colours) {
    const m = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(c);
    if (m === null) throw new Error(`meanColour: ${c} is not #RRGGBB`);
    for (let i = 0; i < 3; i++) sum[i] = (sum[i] ?? 0) + parseInt(m[i + 1] ?? "0", 16);
  }
  return `#${sum.map((s) => Math.round(s / colours.length).toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

/** The most a clip's grey is moved to meet its picture's: a clip made with another studio grey is not "nearly the same"
 *  and is refused, to be looked at, rather than its person's colours shifted far. */
export const GREY_SHIFT_MOST = 24;

/** How far to move each of a clip's red, green and blue so its grey round the edge meets its picture's (62b): on the
 *  phone the clip lies over the picture, its grey running to the screen's edges, and Kd's clips are a few shades off
 *  their pictures (printed by the command 2026-11-25: #D5D9D4 on #D1D1D1, #CDCDCD on #D5D5D5, #B2B2B0 on #B8B6B7), which showed
 *  as a box. The shift is
 *  that small, so the person's own colours move by no more than the eye can tell. */
export function greyShift(clipEdge: string, pictureEdge: string): { r: number; g: number; b: number } {
  const parts = (c: string) => {
    const m = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(c);
    if (m === null) throw new Error(`greyShift: ${c} is not #RRGGBB`);
    return [parseInt(m[1] ?? "0", 16), parseInt(m[2] ?? "0", 16), parseInt(m[3] ?? "0", 16)] as const;
  };
  const [cr, cg, cb] = parts(clipEdge);
  const [pr, pg, pb] = parts(pictureEdge);
  const shift = { r: pr - cr, g: pg - cg, b: pb - cb };
  if (Math.max(Math.abs(shift.r), Math.abs(shift.g), Math.abs(shift.b)) > GREY_SHIFT_MOST) {
    throw new Error(`the clip's grey (${clipEdge}) is far from its picture's (${pictureEdge}): are they from one final folder?`);
  }
  return shift;
}

/** The ffmpeg filter that moves a clip's colours by a shift (clipped to 0 to 255). */
export function greyShiftFilter(shift: { r: number; g: number; b: number }): string {
  const one = (n: number) => `'clip(val${n < 0 ? "-" : "+"}${String(Math.abs(n))},0,255)'`;
  return `lutrgb=r=${one(shift.r)}:g=${one(shift.g)}:b=${one(shift.b)}`;
}

/** KWAZO in a corner of every clip (Kd, 2026-11-25: "can you put kwazo in a corner say boottom left corner in the video
 *  frame"), the app's own wordmark on its white pill (`tools/library-mark.png`, made by `tools/library-mark.py` from
 *  `look/Wordmark.tsx`'s font and colours). It is part of the video, so it stays with the clip wherever the clip goes.
 *  The pill is this share of the clip's short side tall, and this share in from its side and its foot. */
export const MARK_TALL = 0.095;
export const MARK_IN = 0.04;
/** The mark's picture holds a soft shadow round the pill, this share of the pill's height on every side. */
export const MARK_SHADOW = 0.18;

/** Where the mark goes in a clip of this size: bottom-left, or bottom-right for a clip whose person reaches the
 *  bottom-left corner (Kd, 2026-11-25: the terminal looks at every clip's sheet and says so). The mark's picture is
 *  scaled to `width` × `height` and laid at `x`, `y` (its shadow may run past the inset, never past the clip). */
export function markPlace(clip: { width: number; height: number }, mark: { width: number; height: number }, corner: "left" | "right"): { width: number; height: number; x: number; y: number } {
  const short = Math.min(clip.width, clip.height);
  const pill = short * MARK_TALL;
  const height = Math.round(pill * (1 + 2 * MARK_SHADOW));
  const width = Math.round((mark.width * height) / mark.height);
  const shadow = Math.round(pill * MARK_SHADOW);
  const inset = Math.round(short * MARK_IN);
  const x = corner === "left" ? inset - shadow : clip.width - inset - (width - shadow);
  const y = clip.height - inset - (height - shadow);
  return { width, height, x, y };
}
