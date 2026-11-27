// The coach's script for ElevenLabs (spec Part 2 §12.6; ROADMAP 53b-i), on the laptop:
//   corepack pnpm --filter @app/movement voice-script
// Prints the voice and its settings, then each part's text to paste and generate on its own, with its characters.
import { readFiles, readVoice, ruleWords, scriptParts, scriptText, voiceGaps } from "./voiceLines.js";

const voice = readVoice();
const gaps = voiceGaps(voice, ruleWords(readFiles()));
if (gaps.length > 0) throw new Error(`The lines and the movement files do not agree: ${gaps.join("; ")}.`);
const parts = scriptParts(voice);
console.log(`Voice: ${voice.voice.name} · Model: ${voice.voice.model} · ${voice.voice.settings}`);
let total = 0;
parts.forEach((part, i) => {
  const text = scriptText(part);
  total += text.length;
  console.log(`\n── Part ${String(i + 1)} of ${String(parts.length)}: ${String(part.length)} lines, ${String(text.length)} characters ──\n${text}`);
});
console.log(`\nIn all: ${String(parts.reduce((n, p) => n + p.length, 0))} lines, ${String(total)} characters.`);
