// The coach's lines and their clips (ROADMAP 53b-i; spec Part 2 §12.6). The worst thing first: a clip cut or named
// wrongly would speak the wrong advice, so the cutting tool refuses any clip whose read-back is not exactly its own
// wording, and every clip in the app is one that was heard saying its own words.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clipName, voiceHeardSchema } from "@app/shared";
import { CLIPS, HEARD_FILE, PAUSE, readFiles, readVoice, ruleWords, scriptParts, scriptText, voiceGaps, wordingsOf } from "../scripts/voiceLines.js";
import { heardOf, LEAST_GAP, loudnessOf, saysIt, silencesOf, silentClip, spansOf, wordsOf } from "../scripts/voiceCut.js";
import { CLIPS_MODULE, clipsModule } from "../scripts/voiceClips.js";

const VOICE = readVoice();

describe("the worst thing: a clip is kept only when it is heard saying exactly its own wording", () => {
  it.each([
    ["its own words", "Keep your knees in line with your toes.", true],
    ["its own words, the reader's own case and stops", " keep your knees in line with your toes", true],
    ["another line", "Push your knees out over your toes.", false],
    ["another line of another mistake", "Keep your chest up.", false],
    ["half the line, cut too soon", "Keep your knees", false],
    ["the line and the next run together", "Keep your knees in line with your toes. Push your knees out over your toes.", false],
    ["one word misheard", "Keep your knees in line with your nose.", false],
    ["one word more", "Keep your knees in line with your toes now.", false],
    ["nothing heard", "", false],
  ] as const)("%s: %s", (_, heard, kept) => {
    expect(saysIt(heard, "Keep your knees in line with your toes.")).toBe(kept);
  });

  it.each([
    ["a number written as a figure", "2 more.", "Two more."],
    ["an apostrophe the reader leaves out", "The camera cant see you.", "The camera can't see you."],
    ["a curly apostrophe", "That’s the set.", "That's the set."],
  ] as const)("the same words written another way are the same: %s", (_, heard, wording) => {
    expect(saysIt(heard, wording)).toBe(true);
    expect(wordsOf(heard)).toEqual(wordsOf(wording));
  });

  it("a clip with no speech in it is refused before it is read: the reader made up \"you\" on 32 silent clips (2026-11-27)", () => {
    expect(silentClip(-21.4)).toBe(false);
    expect(silentClip(-44)).toBe(false);
    expect(silentClip(-70)).toBe(true);
    expect(silentClip(Number("-inf"))).toBe(true);
    expect(silentClip(Number.NEGATIVE_INFINITY)).toBe(true);
    expect(silentClip(Number.NaN)).toBe(true);
    // As ffmpeg prints a silent stretch, and a spoken one.
    const silent = loudnessOf('[Parsed_loudnorm_2 @ 0x1]\n{\n\t"input_i" : "-inf",\n\t"input_tp" : "-inf",\n\t"input_lra" : "0.00",\n\t"input_thresh" : "-inf",\n\t"target_offset" : "inf"\n}\n');
    expect(silentClip(Number(silent.input_i))).toBe(true);
    // An offset loudnorm cannot take back ("inf", on a short clip) is no fine-tune: 0.
    expect(silent.target_offset).toBe("0");
    const spoken = loudnessOf('{\n\t"input_i" : "-21.43",\n\t"input_tp" : "-3.10",\n\t"input_lra" : "1.20",\n\t"input_thresh" : "-31.80",\n\t"output_i" : "-16.02",\n\t"target_offset" : "0.02"\n}');
    expect([spoken.input_i, silentClip(Number(spoken.input_i))]).toEqual(["-21.43", false]);
    expect(() => loudnessOf('{ "input_i": "-21" }')).toThrow(/loudnorm gave no/);
  });

  it("the reader's own output: times and bracketed notes are not words", () => {
    expect(heardOf("\n[00:00:00.000 --> 00:00:01.400]   Go lower to count.\n")).toBe("Go lower to count.");
    expect(heardOf("[BLANK_AUDIO]\n")).toBe("");
    expect(heardOf(" Better.\n That one counts.\n")).toBe("Better. That one counts.");
  });
});

// Kd's first part 1 on Eleven v4 with "[long pause]" (2026-11-27, 29.00 s): ffmpeg's silencedetect at -40 dB, 0.2 s.
const PART_1 = [
  [1.42937, 3.42372],
  [5.02646, 6.191],
  [7.90782, 8.8541],
  [10.3084, 11.3627],
  [13.1032, 13.9647],
  [15.7406, 16.5278],
  [18.7148, 19.4757],
  [21.1784, 21.9277],
  [24.1507, 24.8672],
  [25.9049, 26.5696],
  [27.5841, 28.2271],
] as const;
const PART_1_S = 28.995875;
const log = (pairs: readonly (readonly [number, number])[]): string =>
  pairs.map(([s, e]) => `[silencedetect @ 0x1] silence_start: ${String(s)}\n[silencedetect @ 0x1] silence_end: ${String(e)} | silence_duration: ${String(e - s)}`).join("\n");

describe("where each wording lies in a part", () => {
  it("Kd's part 1: twelve wordings at its eleven pauses, each padded into its pauses and never into the next wording", () => {
    const spans = spansOf(silencesOf(log(PART_1), PART_1_S), PART_1_S, 12);
    if (typeof spans === "string") throw new Error(spans);
    expect(spans.length).toBe(12);
    spans.forEach((s, i) => {
      const before = PART_1[i - 1];
      const after = PART_1[i];
      if (before !== undefined) expect(s.start).toBeGreaterThanOrEqual((before[0] + before[1]) / 2);
      if (after !== undefined) expect(s.end).toBeLessThanOrEqual((after[0] + after[1]) / 2);
    });
    expect(spans[0]?.start).toBe(0);
    expect(spans[11]?.end).toBeCloseTo(PART_1_S, 3);
  });

  it("a short pause inside a line (after \"Better.\") is never a cut while the pauses between lines are longer", () => {
    const inner = [...PART_1.slice(0, 3), [9.1, 9.35] as const, ...PART_1.slice(3)];
    const spans = spansOf(silencesOf(log(inner), PART_1_S), PART_1_S, 12);
    expect(typeof spans === "string" ? spans : spans.length).toBe(12);
  });

  it("a part with a pause missing between two lines is refused, never cut at a short pause", () => {
    const missing = [...PART_1.slice(0, 4), ...PART_1.slice(5)];
    expect(spansOf(silencesOf(log(missing), PART_1_S), PART_1_S, 12)).toMatch(/11 wordings found where 12 were asked for/);
    const short = [...missing.slice(0, 4), [12.9, 12.9 + LEAST_GAP - 0.1] as const, ...missing.slice(4)];
    expect(spansOf(silencesOf(log(short), PART_1_S), PART_1_S, 12)).toMatch(/where 12 were asked for/);
  });

  it("a part that starts and ends quiet: the quiet ends are no cuts", () => {
    const quiet = [[0, 0.4] as const, ...PART_1, [28.6, PART_1_S] as const];
    const spans = spansOf(silencesOf(log(quiet).replace(/silence_end: 28\.995875[^\n]*$/, ""), PART_1_S), PART_1_S, 12);
    if (typeof spans === "string") throw new Error(spans);
    expect(spans.length).toBe(12);
    expect(spans[0]?.start).toBeGreaterThan(0.2);
  });
});

describe("the lines file and the movement files agree", () => {
  it("every sentence a movement or exercise file can put on the screen has a line, and every rule line is one of them", () => {
    expect(voiceGaps(VOICE, ruleWords(readFiles()))).toEqual([]);
  });

  it("the sentences the files give, today", () => {
    expect(ruleWords(readFiles())).toEqual([
      "Go lower to count.",
      "Keep your chest up.",
      "Keep your knees in line with your toes.",
      "Keep your whole body in view.",
      "Push your hips higher to count.",
      "Sit up higher to count.",
    ]);
  });

  it("a sentence with no line is found", () => {
    expect(voiceGaps(VOICE, [...ruleWords(readFiles()), "Jump higher to count."])).toEqual(['no line says "Jump higher to count."']);
  });

  it("the script: every wording once, in three parts, a pause written for Eleven v4 between two", () => {
    const parts = scriptParts(VOICE);
    expect(parts.map((p) => p.length)).toEqual([12, 12, 11]);
    expect(parts.flat().map((w) => w.words)).toEqual(wordingsOf(VOICE).map((w) => w.words));
    const text = scriptText(parts[0] ?? []);
    expect(text.split(PAUSE).length).toBe(12);
    expect(text).not.toMatch(/<break/);
  });
});

describe("every clip in the app was heard saying its own words", () => {
  const record = existsSync(HEARD_FILE) ? voiceHeardSchema.parse(JSON.parse(readFileSync(HEARD_FILE, "utf8"))) : null;

  it("one clip for every wording, recorded for this version of the lines", () => {
    expect(record?.version).toBe(VOICE.version);
    expect(record?.clips.map((c) => [c.file, c.words])).toEqual(wordingsOf(VOICE).map((w) => [clipName(w.line, w.index), w.words]));
  });

  it("each clip's bytes are the very clip that was heard, and it was heard saying exactly its wording", () => {
    const wrong = (record?.clips ?? []).flatMap((c) => {
      const file = join(CLIPS, c.file);
      if (!existsSync(file)) return [`${c.file}: missing`];
      const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
      return sha === c.sha256 && saysIt(c.heard, c.words) ? [] : [`${c.file}: ${sha === c.sha256 ? `heard "${c.heard}"` : "changed since it was heard"}`];
    });
    expect(record).not.toBeNull();
    expect(wrong).toEqual([]);
  });

  it("the app's list of clips is the one the lines make", () => {
    expect(readFileSync(CLIPS_MODULE, "utf8")).toBe(clipsModule(VOICE));
  });
});
