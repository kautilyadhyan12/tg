// The clip line (job 62a): makes one exercise's clip and still picture small from Kd's finished `final` folder, keeps
// them in the server's media folder named by their sha256, and writes a picture sheet to look at. With --write it also
// names them in the exercise's file. Videos never go to git: the media folder is ignored. Every clip carries KWAZO in its
// bottom-left corner (62b); --mark-right puts it bottom-right, for a clip whose person reaches the bottom-left corner.
//
//   corepack pnpm --filter api exec tsx tools/library-media.ts "<Kd's exercise folder, or its final folder>" <exercise id> [--mark-right] [--write]
//
// Look at the sheet (frames of the clip beside the picture) before --write: an automatic check of the two against each
// other was measured and does not work (62a's plan), and a real person filmed in a real gym must never be published.
// Needs ffmpeg and ffprobe on PATH.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { exerciseIdSchema, type ExerciseClip, type ExercisePicture } from "@app/shared";
import { MEDIA_FOLDER } from "../src/modules/library/media.js";
import { edgeColour, finalFiles, isMp4, isPng, LONG_SIDE, madeSize, markPlace, withMedia } from "./library-media-lib.js";

const EXERCISES = fileURLToPath(new URL("../../../packages/shared/library/exercises/", import.meta.url));
const SHEETS = join(MEDIA_FOLDER, "..", "sheets");
const MARK = fileURLToPath(new URL("./library-mark.png", import.meta.url));

const args = process.argv.slice(2);
const write = args.includes("--write");
const corner = args.includes("--mark-right") ? "right" : "left";
const [given, rawId] = args.filter((a) => a !== "--write" && a !== "--mark-right");
if (given === undefined || rawId === undefined) throw new Error('usage: library-media.ts "<exercise folder>" <exercise id> [--mark-right] [--write]');
const id = exerciseIdSchema.parse(rawId);
const exerciseFile = join(EXERCISES, `${id}.json`);
if (!existsSync(exerciseFile)) throw new Error(`no exercise file ${id}.json: write the exercise's page first`);

const { clip: clipIn, picture: pictureIn } = finalFiles(given);
for (const f of [clipIn, pictureIn]) if (!existsSync(f)) throw new Error(`${f} is not there: only a final folder's final.mp4 and final.png are read`);
if (!isMp4(readFileSync(clipIn).subarray(0, 16))) throw new Error(`${clipIn} is not an MP4`);
if (!isPng(readFileSync(pictureIn).subarray(0, 16))) throw new Error(`${pictureIn} is not a PNG`);

const probeSchema = z.object({ streams: z.array(z.object({ width: z.number().int(), height: z.number().int() })).min(1), format: z.object({ duration: z.string().optional() }) });
const probe = (file: string) => {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  const read = probeSchema.parse(JSON.parse(out));
  const stream = read.streams[0];
  if (stream === undefined) throw new Error(`${file} has no picture`);
  return { width: stream.width, height: stream.height, seconds: Number(read.format.duration ?? "0") };
};
const scaleFilter = `scale='if(gt(iw,ih),min(${String(LONG_SIDE)},iw),-2)':'if(gt(iw,ih),-2,min(${String(LONG_SIDE)},ih))'`;

/** Runs ffmpeg into a file of its own, then names that file by its sha256 in the media folder. */
function made(ext: "mp4" | "webp", ffmpegArgs: string[]): { file: string; bytes: number } {
  mkdirSync(MEDIA_FOLDER, { recursive: true });
  const temp = join(MEDIA_FOLDER, `making-${id}.${ext}`);
  rmSync(temp, { force: true });
  execFileSync("ffmpeg", ["-v", "error", "-y", ...ffmpegArgs, temp], { stdio: "inherit" });
  const bytes = readFileSync(temp);
  const file = `${createHash("sha256").update(bytes).digest("hex")}.${ext}`;
  renameSync(temp, join(MEDIA_FOLDER, file));
  return { file, bytes: bytes.length };
}

const clipShape = probe(clipIn);
const pictureShape = probe(pictureIn);
if (clipShape.width > clipShape.height !== pictureShape.width > pictureShape.height) {
  throw new Error(`the clip (${String(clipShape.width)}×${String(clipShape.height)}) and the picture (${String(pictureShape.width)}×${String(pictureShape.height)}) are not the same shape`);
}

// The clip: H.264 main, no sound, nothing of the original's own details (who made it, where, when), playable as it arrives,
// with KWAZO in its corner.
const markShape = probe(MARK);
const place = markPlace(madeSize(clipShape.width, clipShape.height), markShape, corner);
const clipMade = made("mp4", [
  "-i", clipIn, "-i", MARK,
  "-filter_complex", `[0:v:0]${scaleFilter}[v];[1:v]scale=${String(place.width)}:${String(place.height)}[m];[v][m]overlay=${String(place.x)}:${String(place.y)},format=yuv420p[out]`,
  "-map", "[out]", "-an", "-sn", "-dn", "-map_metadata", "-1",
  "-c:v", "libx264", "-profile:v", "main", "-pix_fmt", "yuv420p", "-crf", "28", "-preset", "slow", "-movflags", "+faststart",
]);
// The picture: WebP at quality 90, nothing of the original's own details.
const pictureMade = made("webp", ["-i", pictureIn, "-map_metadata", "-1", "-vf", scaleFilter, "-c:v", "libwebp", "-quality", "90", "-compression_level", "6"]);

const clipOut = probe(join(MEDIA_FOLDER, clipMade.file));
const pictureOut = probe(join(MEDIA_FOLDER, pictureMade.file));
const expected = madeSize(pictureShape.width, pictureShape.height);
if (Math.abs(pictureOut.width - expected.width) > 2 || Math.abs(pictureOut.height - expected.height) > 2) throw new Error("the picture was not made at its expected size");
const rgb = execFileSync("ffmpeg", ["-v", "error", "-i", join(MEDIA_FOLDER, pictureMade.file), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });

const picture: ExercisePicture = { file: pictureMade.file, width: pictureOut.width, height: pictureOut.height, bytes: pictureMade.bytes, ground: edgeColour(new Uint8Array(rgb), pictureOut.width, pictureOut.height) };
const clip: ExerciseClip = { file: clipMade.file, width: clipOut.width, height: clipOut.height, bytes: clipMade.bytes, seconds: Math.round(clipOut.seconds * 100) / 100 };

// The sheet: the picture, then one frame of the clip a second, side by side, to be looked at before --write.
mkdirSync(SHEETS, { recursive: true });
const sheet = join(SHEETS, `${id}.png`);
execFileSync("ffmpeg", [
  "-v", "error", "-y", "-i", join(MEDIA_FOLDER, pictureMade.file), "-i", join(MEDIA_FOLDER, clipMade.file),
  "-filter_complex", "[0:v]scale=-2:360[p];[1:v]fps=1,scale=-2:360,tile=4x1[f];[p][f]hstack=inputs=2", "-frames:v", "1", sheet,
], { stdio: "inherit" });

const kb = (file: string) => `${String(Math.round(statSync(file).size / 1024))} KB`;
console.log(id);
console.log(`  clip     ${kb(clipIn)} → ${String(Math.round(clip.bytes / 1024))} KB  ${String(clip.width)}×${String(clip.height)}  ${String(clip.seconds)} s  KWAZO bottom-${corner}  ${clip.file}`);
console.log(`  picture  ${kb(pictureIn)} → ${String(Math.round(picture.bytes / 1024))} KB  ${String(picture.width)}×${String(picture.height)}  edge ${picture.ground}  ${picture.file}`);
console.log(`  sheet    ${sheet}`);
if (!write) {
  console.log("  Look at the sheet. When the clip and the picture are this exercise's, no real person is in them, and KWAZO covers nobody, run again with --write (--mark-right where the person reaches the bottom-left corner).");
} else {
  writeFileSync(exerciseFile, withMedia(readFileSync(exerciseFile, "utf8"), id, picture, clip));
  console.log(`  written into ${exerciseFile}`);
}
