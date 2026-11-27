// Cuts Kd's ElevenLabs recording into the coach's clips (spec Part 2 §12.6; ROADMAP 53b-i), on the laptop:
//   corepack pnpm --filter @app/movement voice-cut [part1.mp3 part2.mp3 ...]
// With no files it takes the newest ElevenLabs downloads in Downloads, one a part of the script (voice-script), the
// oldest first; with --redo <clip>, the newest download is that one wording generated again on its own. Each part is
// cut at its pauses into one clip a wording, its loudness evened (EBU R128, -16 LUFS), kept as AAC in the app
// (apps/mobile/assets/voice), and read back as text by whisper.cpp: every clip must say exactly its own wording, or
// nothing at all is written. What each clip was heard saying is kept in packages/movement/voice/heard.json.
//
// whisper.cpp lives outside git, on the laptop only (Kd's yes, 53b-i's plan): `WHISPER_CLI` and `WHISPER_MODEL` name it,
// else ~/tools/whisper.cpp-1.9.5/bin/Release/whisper-cli.exe and its ggml-base.en.bin (release b5454, 2026-10-06, its
// zip's SHA-256 6ba69e34…16ccb; the model's a03779c8…6d002, as GitHub and Hugging Face list them).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { clipName, type VoiceHeard } from "@app/shared";
import { CLIPS, HEARD_FILE, readVoice, scriptParts, type Wording } from "./voiceLines.js";
import { heardOf, loudnessOf, QUIET_DB, QUIET_S, saysIt, silencesOf, silentClip, spansOf, type Span } from "./voiceCut.js";
import { CLIPS_MODULE, clipsModule } from "./voiceClips.js";

const WHISPER_HOME = join(homedir(), "tools", "whisper.cpp-1.9.5");
const READER = process.env.WHISPER_CLI ?? join(WHISPER_HOME, "bin", "Release", "whisper-cli.exe");
const MODEL = process.env.WHISPER_MODEL ?? join(WHISPER_HOME, "ggml-base.en.bin");

function run(cmd: string, args: readonly string[]): { out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error !== undefined) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${String(r.status)}): ${r.stderr.slice(-800)}`);
  return { out: r.stdout, err: r.stderr };
}

const durationOf = (file: string): number => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).out.trim());

/** A wording's stretch cut out, faded in and out over a few milliseconds so it never clicks, its loudness evened in two
 *  passes, kept as AAC; and the very clip decoded again for the reader. The stretch is taken where the part is read
 *  (`-ss` and `-to` before `-i`), so the clip's own clock starts at 0 and its fades fall on its own ends: taken after it,
 *  the fade out was timed on the whole part's clock and silenced every clip but each part's first (2026-11-27). Returns
 *  the clip's loudness as recorded, LUFS. */
function cut(part: string, span: Span, m4a: string, wav: string): number {
  const length = span.end - span.start;
  const fade = `afade=t=in:d=0.01,afade=t=out:st=${(length - 0.03).toFixed(3)}:d=0.03`;
  const target = "I=-16:TP=-1.5:LRA=11";
  const where = ["-ss", span.start.toFixed(3), "-to", span.end.toFixed(3), "-i", part];
  const first = run("ffmpeg", ["-hide_banner", "-nostats", ...where, "-af", `${fade},loudnorm=${target}:print_format=json`, "-f", "null", "-"]).err;
  const m = loudnessOf(first);
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  run("ffmpeg", ["-hide_banner", "-nostats", "-y", ...where, "-af", `${fade},loudnorm=${target}:${measured}`, "-ar", "44100", "-ac", "1", "-c:a", "aac", "-b:a", "96k", "-map_metadata", "-1", "-movflags", "+faststart", m4a]);
  run("ffmpeg", ["-hide_banner", "-nostats", "-y", "-i", m4a, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  return Number(m.input_i);
}
const heard = (wav: string): string => heardOf(run(READER, ["-m", MODEL, "-f", wav, "-l", "en", "-nt", "-np"]).out);

function newestDownloads(count: number): string[] {
  const dir = join(homedir(), "Downloads");
  return readdirSync(dir)
    .filter((f) => /^ElevenLabs_.*\.mp3$/.test(f))
    .map((f) => ({ f: join(dir, f), at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .slice(0, count)
    .reverse()
    .map((x) => x.f);
}

const voice = readVoice();
const parts = scriptParts(voice);
const args = process.argv.slice(2);
// --check: cut every clip and say how loud each was as recorded, with no reader, writing nothing.
const check = args.includes("--check");
// --redo <clip>: one wording generated again on its own (its clip's name without ".m4a", "workout_complete_1"): the last
// file, or the newest download, is that wording alone, and the parts are the files before it.
const redoAt = args.indexOf("--redo");
const redo = redoAt < 0 ? null : (args[redoAt + 1] ?? "");
if (redo !== null && !parts.flat().some((w) => clipName(w.line, w.index) === `${redo}.m4a`)) throw new Error(`No clip is called ${redo}.`);
const given = args.filter((a, i) => a !== "--check" && i !== redoAt && i !== redoAt + 1);
const all = given.length > 0 ? given : newestDownloads(parts.length + (redo === null ? 0 : 1));
const files = redo === null ? all : all.slice(0, -1);
const redoFile = redo === null ? null : (all[all.length - 1] ?? null);
if (files.length !== parts.length) throw new Error(`The script has ${String(parts.length)} parts; ${String(files.length)} files were given.`);

/** Each wording's stretch in a file of `n` wordings, or why not. */
function spansIn(file: string, n: number): { duration: number; spans: Span[] | string } {
  const duration = durationOf(file);
  const log = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", `silencedetect=noise=${String(QUIET_DB)}dB:d=${String(QUIET_S)}`, "-f", "null", "-"]).err;
  return { duration, spans: spansOf(silencesOf(log, duration), duration, n) };
}

const work = mkdtempSync(join(tmpdir(), "voice-cut-"));
const rows: { wording: Wording; file: string; m4a: string; heard: string; ok: boolean; seconds: number }[] = [];
const refused: string[] = [];
try {
  const again = redoFile === null ? null : spansIn(redoFile, 1);
  if (again !== null) console.log(`Again, ${String(redo)} alone: ${String(redoFile)}, ${again.duration.toFixed(2)} s`);
  if (typeof again?.spans === "string") refused.push(`${String(redo)}: ${again.spans}`);
  files.forEach((file, p) => {
    const part = parts[p] ?? [];
    const { duration, spans } = spansIn(file, part.length);
    console.log(`Part ${String(p + 1)}: ${file}, ${duration.toFixed(2)} s`);
    if (typeof spans === "string") {
      refused.push(`part ${String(p + 1)}: ${spans}`);
      return;
    }
    part.forEach((wording, i) => {
      const name = clipName(wording.line, wording.index);
      // The wording generated again on its own is taken from its own file; the part's take of it is not used.
      const own = name === `${String(redo)}.m4a` && redoFile !== null && again !== null && typeof again.spans !== "string" ? { from: redoFile, span: again.spans[0] } : { from: file, span: spans[i] };
      const span = own.span;
      if (span === undefined) return;
      const m4a = join(work, name);
      const wav = join(work, `${name}.wav`);
      const loud = cut(own.from, span, m4a, wav);
      const seconds = span.end - span.start;
      // A clip with no speech in it is refused before it is read: the reader makes up a word on silence ("you").
      if (silentClip(loud)) {
        refused.push(`${name} should say "${wording.words}" and holds no speech (${loud.toFixed(1)} LUFS as recorded)`);
        console.log(`  REFUSED ${name.padEnd(22)} ${seconds.toFixed(2)} s  "${wording.words}"  no speech, ${loud.toFixed(1)} LUFS`);
        return;
      }
      if (check) {
        console.log(`  cut     ${name.padEnd(22)} ${seconds.toFixed(2)} s  "${wording.words}"  ${loud.toFixed(1)} LUFS as recorded`);
        return;
      }
      const text = heard(wav);
      const ok = saysIt(text, wording.words);
      rows.push({ wording, file: name, m4a, heard: text, ok, seconds });
      console.log(`  ${ok ? "ok     " : "REFUSED"} ${name.padEnd(22)} ${seconds.toFixed(2)} s  "${wording.words}"  heard "${text}"`);
      if (!ok) refused.push(`${name} should say "${wording.words}" and was heard saying "${text}"`);
    });
  });
  if (check) {
    console.log(refused.length === 0 ? "\nEvery clip holds speech. Nothing written: --check reads nothing back." : `\n${String(refused.length)} clips hold no speech.`);
    if (refused.length > 0) process.exitCode = 1;
  } else if (refused.length > 0) {
    console.log(`\nNothing written. ${String(refused.length)} to put right (generate that part again, or that line alone and give it with --redo):\n  ${refused.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    mkdirSync(CLIPS, { recursive: true });
    const keep = new Set(rows.map((r) => r.file));
    for (const old of readdirSync(CLIPS)) if (old.endsWith(".m4a") && !keep.has(old)) unlinkSync(join(CLIPS, old));
    const clips: VoiceHeard["clips"] = rows.map((r) => {
      copyFileSync(r.m4a, join(CLIPS, r.file));
      const sha256 = createHash("sha256").update(readFileSync(join(CLIPS, r.file))).digest("hex");
      return { file: r.file, words: r.wording.words, heard: r.heard, sha256, seconds: Math.round(r.seconds * 100) / 100 };
    });
    const record: VoiceHeard = { version: voice.version, voice: `${voice.voice.name}, ${voice.voice.model}`, reader: "whisper.cpp 1.9.5, ggml-base.en", clips };
    writeFileSync(HEARD_FILE, `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(CLIPS_MODULE, clipsModule(voice));
    const bytes = clips.reduce((n, c) => n + statSync(join(CLIPS, c.file)).size, 0);
    console.log(`\nAll ${String(clips.length)} clips say their own words: written to apps/mobile/assets/voice (${(bytes / 1024).toFixed(0)} KB), with heard.json and the app's list of clips.`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
