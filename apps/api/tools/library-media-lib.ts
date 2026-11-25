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
