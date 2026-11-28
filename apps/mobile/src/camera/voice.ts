import { coachWords, type CoachWords, type Say } from "@app/movement";
import voiceJson from "@app/movement/voice/lines.json";
import { voiceSchema, type Voice, type VoiceWhen } from "@app/shared";

// The coach's voice (ROADMAP Stage 5 53b-i; spec Part 2 §12.6): the lines file the engine's coach speaks from, checked
// once, and which clip says a line. A line is found by its first wording, the screen's own words; the coach says its
// wordings in turn, so a line that comes back is said another way.

export const VOICE: Voice = voiceSchema.parse(voiceJson);
export const COACH_WORDS: CoachWords = coachWords(VOICE);

/** A clip: its line's id and the wording's place in it. */
export interface Clip {
  readonly id: string;
  readonly index: number;
}

/** The clip that says this line this time; null for words no line has (none: a test holds every sentence to a line). */
export function clipOf(say: Pick<Say, "words" | "times">, voice: Voice = VOICE): Clip | null {
  const line = voice.lines.find((l) => l.wordings[0] === say.words);
  if (line === undefined) return null;
  return { id: line.id, index: say.times % line.wordings.length };
}

/** The clip of a set's own line, found by what it is said for ("get ready", "halfway"), in its first wording: Follow
 *  along's timer (53b-ii) says each at most once a set, Reset set starting the set again. */
export function clipFor(when: VoiceWhen, voice: Voice = VOICE): Clip | null {
  const line = voice.lines.find((l) => l.when === when);
  return line === undefined ? null : { id: line.id, index: 0 };
}
