// The app's list of the coach's clips (apps/mobile/src/camera/voiceClips.ts), made by voice-cut from the lines file so
// that Metro, which needs every file named in the code, bundles exactly the clips the lines have.
import { dirname, join } from "node:path";
import { clipName, type Voice } from "@app/shared";
import { CLIPS } from "./voiceLines.js";

export const CLIPS_MODULE = join(dirname(CLIPS), "..", "src", "camera", "voiceClips.ts");

export function clipsModule(voice: Voice): string {
  const names = voice.lines.map((l) => ({ id: l.id, clips: l.wordings.map((_, i) => clipName(l, i)) }));
  const ident = (file: string): string => `clip_${file.replace(/\.m4a$/, "")}`;
  const imports = names.flatMap((l) => l.clips.map((c) => `import ${ident(c)} from "../../assets/voice/${c}";`));
  const entries = names.map((l) => `  ${l.id}: [${l.clips.map(ident).join(", ")}],`);
  return [
    `// Made by voice-cut (packages/movement/scripts/voice-cut.ts) from the coach's lines (packages/movement/voice/lines.json,`,
    `// version ${String(voice.version)}) and Kd's recording, every clip read back saying its own words: never edited by hand.`,
    ...imports,
    "",
    "/** The lines file's version the clips were recorded for. */",
    `export const VOICE_CLIPS_VERSION = ${String(voice.version)};`,
    "",
    "/** Each line's clips, one a wording, in the line's own order, by the line's id. */",
    "export const VOICE_CLIPS: Readonly<Record<string, readonly number[]>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}
