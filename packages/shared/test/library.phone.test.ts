// The phone's reading of the Library download (job 63a). The worst thing it could do to a person is
// show an exercise without its caution ("If you feel pain in your lower back, stop at once…"), so that is
// tested first: an exercise whose cautions cannot be read is left out, never shown without them. The
// rest reads the real files as the server publishes them, and words no list has heard of yet.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPhoneLibrary } from "../src/library/phoneLibrary.js";

const EXERCISES = new URL("../library/exercises/", import.meta.url);
const METS: Record<string, number> = { squat: 3, plank: 2.8, barbell_curl: 3.5 };

/** The download the server sends: each real file with its status and its MET. */
function realEntries(): Record<string, unknown>[] {
  return readdirSync(EXERCISES).map((name) => {
    const file = JSON.parse(readFileSync(new URL(name, EXERCISES), "utf8")) as Record<string, unknown>;
    return { ...file, status: "live", met: METS[String(file.id)] ?? 3 };
  });
}

function download(exercises: unknown[]): unknown {
  return { fingerprint: "a".repeat(64), version: 4, list: { exercises, camera: [] } };
}

function plank(): Record<string, unknown> {
  const found = realEntries().find((e) => e.id === "plank");
  if (found === undefined) throw new Error("plank.json is gone");
  return found;
}

function withText(entry: Record<string, unknown>, change: (en: Record<string, unknown>) => void): Record<string, unknown> {
  const copy = structuredClone(entry);
  const en = (copy.text as { en: Record<string, unknown> }).en;
  change(en);
  return copy;
}

describe("an exercise is never shown without its cautions", () => {
  it("the plank's caution is read exactly as its file says it", () => {
    const read = readPhoneLibrary(download([plank()]));
    expect(read?.exercises[0]?.text.en.cautions).toEqual(["If you feel pain in your lower back, stop at once and see a doctor."]);
  });

  it.each([
    ["cautions left out", (en: Record<string, unknown>) => { delete en.cautions; }],
    ["cautions not a list", (en: Record<string, unknown>) => { en.cautions = "If you feel pain, stop."; }],
    ["a caution that is not words", (en: Record<string, unknown>) => { en.cautions = [42]; }],
    ["an empty caution", (en: Record<string, unknown>) => { en.cautions = [""]; }],
    ["cautions null", (en: Record<string, unknown>) => { en.cautions = null; }],
  ])("%s: the exercise is left out, and the others are still shown", (_, change) => {
    const read = readPhoneLibrary(download([withText(plank(), change), ...realEntries().filter((e) => e.id !== "plank")]));
    expect(read?.exercises.map((e) => e.id).sort()).toEqual(["barbell_curl", "squat"]);
    expect(read?.unread).toBe(1);
  });
});

describe("the real Library, as the server sends it", () => {
  it("every exercise is read, with all three rows of its muscles", () => {
    const read = readPhoneLibrary(download(realEntries()));
    expect(read?.unread).toBe(0);
    expect(read?.exercises.map((e) => e.id).sort()).toEqual(["barbell_curl", "plank", "squat"]);
    const squat = read?.exercises.find((e) => e.id === "squat");
    expect(squat?.muscles.main).toContain("vastus_lateralis");
    expect(squat?.muscles.steady).toContain("glute_med");
  });
});

describe("words no list has yet are shown, never refused (§13.1, principle 7)", () => {
  it.each([
    ["a new kind", { kind: "calisthenics" }],
    ["a new level", { level: "elite" }],
    ["a new muscle", { muscles: { main: ["gluteus_minimus"], also: [], steady: [] } }],
    ["new equipment", { equipment: ["sandbag"] }],
    ["a new way to measure a set", { set: { measuredIn: "distance", weight: "never", eachSide: false, start: { sets: 3 } } }],
    ["a fact the phone does not know", { tempo: "3-1-1" }],
    ["muscles from before the steadying row", { muscles: { main: ["abs"], also: ["obliques"] } }],
  ])("%s", (_, change) => {
    const read = readPhoneLibrary(download([{ ...plank(), ...change }]));
    expect(read?.unread).toBe(0);
    expect(read?.exercises).toHaveLength(1);
  });

  it("a MET that cannot be read leaves only the effort out", () => {
    const read = readPhoneLibrary(download([{ ...plank(), met: "light" }]));
    expect(read?.exercises[0]?.met).toBeNull();
  });
});

describe("what cannot be read", () => {
  it("one broken exercise is left out and counted; the second of two with one id too", () => {
    const read = readPhoneLibrary(download([...realEntries(), { id: "broken" }, plank()]));
    expect(read?.exercises).toHaveLength(3);
    expect(read?.unread).toBe(2);
  });

  it.each([
    ["no fingerprint", { version: 1, list: { exercises: [] } }],
    ["a fingerprint that is not one", { fingerprint: "abc", version: 1, list: { exercises: [] } }],
    ["no list", { fingerprint: "a".repeat(64), version: 1 }],
    ["not a download at all", "<html>"],
    ["nothing", null],
  ])("%s: no Library, so the phone keeps the copy it has", (_, raw) => {
    expect(readPhoneLibrary(raw)).toBeNull();
  });
});
