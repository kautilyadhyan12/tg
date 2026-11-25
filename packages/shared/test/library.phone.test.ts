// The phone's reading of the Library download (job 63a). The worst thing it could do to a person is
// show an exercise without its caution ("If you feel pain in your lower back, stop at once…"), so that is
// tested first: an exercise whose cautions cannot be read is left out, never shown without them. The
// rest reads the real files as the server publishes them, and words no list has heard of yet.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkLibrary } from "../src/library/check.js";
import { libraryDownloadSchema, libraryEntrySchema } from "../src/library/download.js";
import { readPhoneLibrary } from "../src/library/phoneLibrary.js";

const LIBRARY = new URL("../library/", import.meta.url);
const EXERCISES = new URL("exercises/", LIBRARY);

/** The entries the server publishes, made as publishing makes them: the real folder through the check, each
 *  checked file given its status and the MET read from the Compendium table, through the server's own entry
 *  schema. A change to the server's entry that the phone cannot read fails here. */
function realEntries(): Record<string, unknown>[] {
  const checked = checkLibrary({
    exerciseFiles: readdirSync(EXERCISES).map((name) => ({ name, text: readFileSync(new URL(name, EXERCISES), "utf8") })),
    compendium: { name: "compendium.json", text: readFileSync(new URL("compendium.json", LIBRARY), "utf8") },
  });
  if (checked.faults.length > 0 || checked.compendium === null) throw new Error("the real folder has a fault");
  const mets = new Map(checked.compendium.rows.map((r) => [r.code, r.met]));
  return checked.exercises.map((e) => libraryEntrySchema.parse({ ...e, status: e.status, met: mets.get(e.energy.compendium) }) as unknown as Record<string, unknown>);
}

/** The real folder's exercises by id, in order, read from the folder: never a list typed here. */
const realIds = (): string[] => realEntries().map((e) => String(e.id)).sort();

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
    expect(read?.exercises[0]?.text.en.cautions).toEqual(["If you feel pain in your lower back, stop at once and see a qualified professional."]);
  });

  it.each([
    ["cautions left out", (en: Record<string, unknown>) => { delete en.cautions; }],
    ["cautions not a list", (en: Record<string, unknown>) => { en.cautions = "If you feel pain, stop."; }],
    ["a caution that is not words", (en: Record<string, unknown>) => { en.cautions = [42]; }],
    ["an empty caution", (en: Record<string, unknown>) => { en.cautions = [""]; }],
    ["cautions null", (en: Record<string, unknown>) => { en.cautions = null; }],
  ])("%s: the exercise is left out, and the others are still shown", (_, change) => {
    const read = readPhoneLibrary(download([withText(plank(), change), ...realEntries().filter((e) => e.id !== "plank")]));
    expect(read?.exercises.map((e) => e.id).sort()).toEqual(realIds().filter((id) => id !== "plank"));
    expect(read?.unread).toBe(1);
  });
});

describe("the real Library, as the server sends it", () => {
  it("every exercise is read, with all three rows of its muscles", () => {
    // The whole reply as the server's own reply schema has it.
    expect(libraryDownloadSchema.safeParse(download(realEntries())).success).toBe(true);
    const read = readPhoneLibrary(download(realEntries()));
    expect(read?.unread).toBe(0);
    expect(read?.exercises.map((e) => e.id).sort()).toEqual(realIds());
    expect(realIds()).toEqual(readdirSync(EXERCISES).map((name) => name.replace(/.json$/, "")).sort());
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

describe("an exercise's own picture and clip (62a)", () => {
  const hash = "c".repeat(64);
  const picture = { file: `${hash}.webp`, width: 720, height: 1280, bytes: 30_000, ground: "#D5D5D5" };
  const clip = { file: `${hash}.mp4`, width: 720, height: 1280, bytes: 188_000, seconds: 4 };

  it("each is read as the server sends it", () => {
    const read = readPhoneLibrary(download([{ ...plank(), picture, clip }]));
    expect(read?.exercises[0]?.picture).toEqual({ file: `${hash}.webp`, width: 720, height: 1280, ground: "#D5D5D5" });
    expect(read?.exercises[0]?.clip).toEqual({ file: `${hash}.mp4`, width: 720, height: 1280, seconds: 4, mark: "left" });
  });

  it("the clip's KWAZO corner (62b): right is read; one sent before it, or a word the phone does not know, is left", () => {
    const corner = (mark: unknown) => readPhoneLibrary(download([{ ...plank(), picture, clip: { ...clip, mark } }]))?.exercises[0]?.clip?.mark;
    expect(corner("right")).toBe("right");
    expect(corner("left")).toBe("left");
    expect(corner(undefined)).toBe("left");
    expect(corner("top")).toBe("left");
  });

  it("one the phone cannot read is none, and the exercise is still shown (with the app's picture of its kind)", () => {
    for (const bad of [{ ...picture, file: "../secret.webp" }, { ...picture, file: `${hash}.png` }, { ...picture, ground: "red" }, "squat.webp"]) {
      const read = readPhoneLibrary(download([{ ...plank(), picture: bad }]));
      expect(read?.exercises.map((e) => [e.id, e.picture]), JSON.stringify(bad)).toEqual([["plank", null]]);
    }
  });

  it("an entry published before 62a, with no picture or clip at all, reads as none", () => {
    const old = structuredClone(plank());
    delete old.picture;
    delete old.clip;
    const read = readPhoneLibrary(download([old]));
    expect(read?.exercises[0]?.picture).toBeNull();
    expect(read?.exercises[0]?.clip).toBeNull();
  });
});

describe("what cannot be read", () => {
  it("one broken exercise is left out and counted; the second of two with one id too", () => {
    const read = readPhoneLibrary(download([...realEntries(), { id: "broken" }, plank()]));
    expect(read?.exercises).toHaveLength(realIds().length);
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
