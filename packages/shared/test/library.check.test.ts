// The Exercise Library's check (spec Part 2 §13.4, job 60a), as a table over every class of
// fault. The words a file must refuse come from OUTSIDE this code: the old 58-exercise list's own
// words and the public list free-exercise-db's (read 2026-11-16), none of which the fixed lists
// hold.
import { describe, expect, it } from "vitest";
import { checkLibrary, faultLine, nameKey, type LibraryFault } from "../src/library/check.js";

const PAGE = "https://pacompendium.com/conditioning-exercise/";
const table = (rows: unknown[]) => ({
  name: "compendium.json",
  text: JSON.stringify({ edition: "2024 Adult Compendium of Physical Activities", rows }),
});
const goodTable = table([
  { code: "02056", met: 3.0, words: "Body weight resistance exercises (e.g., squat, lunge, push-up, crunch), general", page: PAGE },
  { code: "02024", met: 2.8, words: "Calisthenics (e.g., curl ups, abdominal crunches, plank), light effort", page: PAGE },
]);

/** A whole, correct exercise file; each case changes one thing in it. */
function squat(): Record<string, unknown> {
  return {
    id: "squat",
    status: "live",
    kind: "strength",
    level: "beginner",
    muscles: { main: ["rectus_femoris", "vastus_lateralis", "vastus_medialis"], also: ["glute_max"], steady: ["lower_back"] },
    equipment: [],
    set: { measuredIn: "reps", weight: "never", eachSide: false, start: { sets: 3, reps: 12 } },
    energy: { compendium: "02056" },
    text: {
      en: {
        name: "Squat",
        otherNames: ["Air squat"],
        about: "A standing exercise that bends the hips and knees.",
        steps: ["Stand tall.", "Bend your hips and knees.", "Stand back up."],
        mistakes: [
          { id: "heels_lift", says: "Heels lift. Keep them down." },
          { id: "knees_cave_in", says: "Knees fall in. Keep them over your toes." },
        ],
        cautions: [],
      },
    },
    sources: [{ name: "American Council on Exercise, Bodyweight Squat", url: "https://www.acefitness.org/x/" }],
    clip: null,
    picture: null,
  };
}

function plank(): Record<string, unknown> {
  const p = squat();
  p["id"] = "plank";
  p["set"] = { measuredIn: "time", weight: "never", eachSide: false, start: { sets: 3, seconds: 30 } };
  p["energy"] = { compendium: "02024" };
  p["text"] = {
    en: {
      name: "Plank",
      otherNames: ["Front plank"],
      about: "A held position on the forearms and toes.",
      steps: ["Lie face down.", "Lift your body.", "Hold it straight."],
      mistakes: [
        { id: "hips_sag", says: "Hips sag. Brace your abdominals." },
        { id: "hips_high", says: "Hips rise. Lower them." },
      ],
      cautions: ["If your lower back hurts, stop at once."],
    },
  };
  return p;
}

const file = (data: Record<string, unknown>, name = `${String(data["id"])}.json`) => ({ name, text: JSON.stringify(data) });

function faultsOf(files: { name: string; text: string }[], compendium = goodTable): LibraryFault[] {
  return checkLibrary({ exerciseFiles: files, compendium }).faults;
}

/** Sets a fact deep in a copy of the file: at("set.start.reps", 0). */
function changed(path: string, value: unknown, base = squat()): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredClone(base);
  const keys = path.split(".");
  const last = keys.pop() ?? "";
  let at: object = copy;
  for (const k of keys) {
    const next: unknown = Reflect.get(at, k);
    if (typeof next !== "object" || next === null) throw new Error(`no ${k} in ${path}`);
    at = next;
  }
  if (value === undefined) Reflect.deleteProperty(at, last);
  else Reflect.set(at, last, value);
  return copy;
}

const HASH_A = "a".repeat(63) + "1";
const HASH_B = "b".repeat(63) + "2";
const PICTURE_A = { file: `${HASH_A}.webp`, width: 720, height: 1280, bytes: 30_412, ground: "#D5D5D5" };
const CLIP_A = { file: `${HASH_A}.mp4`, width: 720, height: 1280, bytes: 188_211, seconds: 4 };

describe("62a's worst thing: another exercise's picture or clip shown, so somebody copies the wrong movement", () => {
  it("a second exercise naming another's picture is refused, in the file read second (files are read in name order)", () => {
    const first = changed("picture", PICTURE_A);
    const second = changed("picture", PICTURE_A, plank());
    expect(faultsOf([file(first), file(second)])).toEqual([
      { file: "squat.json", at: "picture.file", problem: `${HASH_A}.webp is already named by plank.json (picture.file); each exercise has its own picture and clip` },
    ]);
  });

  it("a second exercise naming another's clip is refused", () => {
    const first = changed("clip", CLIP_A);
    const second = changed("clip", CLIP_A, plank());
    expect(faultsOf([file(first), file(second)]).map(faultLine)).toEqual([`squat.json · clip.file: ${HASH_A}.mp4 is already named by plank.json (clip.file); each exercise has its own picture and clip`]);
  });

  it("each with its own picture and clip passes, and a clip and picture of different shapes are refused", () => {
    const first = changed("clip", CLIP_A, changed("picture", PICTURE_A));
    const second = changed("clip", { ...CLIP_A, file: `${HASH_B}.mp4` }, changed("picture", { ...PICTURE_A, file: `${HASH_B}.webp` }, plank()));
    expect(faultsOf([file(first), file(second)])).toEqual([]);
    const mixed = changed("clip", { ...CLIP_A, width: 1280, height: 720 }, changed("picture", PICTURE_A));
    expect(faultsOf([file(mixed)]).map((f) => f.at)).toEqual(["clip"]);
  });

  it("an exercise with no picture or clip yet is still a whole file", () => {
    expect(faultsOf([file(squat()), file(plank())])).toEqual([]);
  });
});

describe("the calorie number cannot be typed wrong (the worst thing: ten times the calories shown)", () => {
  it.each([
    ["80 typed for 8.0", 80],
    ["0.8 typed for 8.0", 0.8],
    ["a second decimal, 3.05", 3.05],
    ["zero", 0],
    ["below sitting still", 0.9],
    ["a word", "3.0"],
  ])("a Compendium row with a MET of %s is refused", (_case, met) => {
    const faults = faultsOf([file(squat())], table([{ code: "02056", met, words: "Body weight resistance exercises", page: PAGE }]));
    expect(faults.map((f) => f.at)).toContain("rows.0.met");
  });

  it("an exercise never types its own MET: a file with one is refused as an unknown fact", () => {
    const faults = faultsOf([file(changed("energy", { compendium: "02056", met: 30 }))]);
    expect(faults).toEqual([{ file: "squat.json", at: "energy", problem: 'unknown fact "met" (a misspelling?)' }]);
  });

  it("an exercise naming a Compendium code the table does not hold is refused", () => {
    const faults = faultsOf([file(changed("energy.compendium", "02099"))]);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.at).toBe("energy.compendium");
  });

  it("the same code twice in the table is refused, so one code cannot mean two numbers", () => {
    const dup = table([
      { code: "02056", met: 3.0, words: "Body weight resistance exercises", page: PAGE },
      { code: "02056", met: 6.5, words: "Body weight resistance exercises, high intensity", page: PAGE },
    ]);
    const checked = checkLibrary({ exerciseFiles: [file(squat())], compendium: dup });
    expect(checked.faults).toContainEqual({ file: "compendium.json", at: "rows.1.code", problem: "02056 is in the table twice" });
    expect(checked.exercises).toEqual([]);
  });

  it("the limits are 1.0 to 23.0: both ends pass, and just past either is refused", () => {
    const rows = (met: number) => table([{ code: "15550", met, words: "Running", page: PAGE }, { code: "02056", met: 3.0, words: "Body weight", page: PAGE }]);
    expect(faultsOf([file(squat())], rows(23))).toEqual([]);
    expect(faultsOf([file(squat())], rows(1))).toEqual([]);
    expect(faultsOf([file(squat())], rows(23.1)).map((f) => f.at)).toEqual(["rows.0.met"]);
    expect(faultsOf([file(squat())], rows(12.3))).toEqual([]);
  });
});

describe("a correct Library has no fault", () => {
  it("two whole files, one in reps and one in time", () => {
    const checked = checkLibrary({ exerciseFiles: [file(squat()), file(plank())], compendium: goodTable });
    expect(checked.faults).toEqual([]);
    expect(checked.exercises.map((e) => e.id)).toEqual(["plank", "squat"]);
  });
});

describe("a word outside a fixed list is refused, with the words it may be", () => {
  // Real words: the old list's categories, equipment and muscles, and the public list's.
  it.each([
    ["kind", "Rehabilitation"],
    ["kind", "HIIT"],
    ["kind", "Strength Training"],
    ["kind", "Core & Abs"],
    ["kind", "powerlifting"],
    ["kind", "olympic weightlifting"],
    ["kind", "strongman"],
    ["kind", "Yoga"],
    ["level", "expert"],
    ["level", "Beginner"],
    ["equipment.0", "None"],
    ["equipment.0", "Dumbbells"],
    ["equipment.0", "body only"],
    ["equipment.0", "kettlebells"],
    ["equipment.0", "e-z curl bar"],
    ["equipment.0", "other"],
    ["equipment.0", "bands"],
    ["equipment.0", "cable"],
    ["equipment.0", "dumbell"],
    ["muscles.main.0", "Abs"],
    ["muscles.main.0", "Spinal Erectors"],
    ["muscles.main.0", "Obliques"],
    ["muscles.main.0", "Rotator Cuff"],
    // The old list's broad words, now named by the muscle itself.
    ["muscles.main.0", "quadriceps"],
    ["muscles.main.0", "glutes"],
    ["muscles.main.0", "abdominals"],
    ["muscles.main.0", "shoulders"],
    ["muscles.main.0", "middle_back"],
    ["muscles.also.0", "Quadriceps"],
    ["muscles.also.0", "hamstrings"],
    ["muscles.steady.0", "core"],
    ["muscles.steady.0", "Shoulder Stabilizers"],
    ["muscles.steady.0", "gluteus_medius"],
    ["status", "hidden"],
    ["set.weight", "optional"],
  ])("%s: %s", (at, word) => {
    const faults = faultsOf([file(changed(at, word))]);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.at).toBe(at);
    expect(faults[0]?.problem).toMatch(new RegExp(`^"${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" is not one of: `));
  });

  it("a measure that is neither reps nor time is refused", () => {
    const faults = faultsOf([file(changed("set.measuredIn", "seconds"))]);
    expect(faults.map(faultLine)).toEqual(['squat.json · set.measuredIn: "seconds" is not "reps" or "time"']);
  });
});

describe("a missing fact, or a misspelt one, is refused", () => {
  it.each(["kind", "level", "equipment", "status", "energy", "sources", "clip", "set.eachSide", "text.en.steps", "text.en.mistakes", "text.en.cautions"])("missing %s", (at) => {
    const faults = faultsOf([file(changed(at, undefined))]);
    expect(faults.map((f) => f.at)).toContain(at);
  });

  it("a misspelt fact is refused, never ignored", () => {
    const data = changed("equipment", undefined);
    data["equipmnt"] = ["barbell"];
    const lines = faultsOf([file(data)]).map(faultLine);
    expect(lines).toContain('squat.json: unknown fact "equipmnt" (a misspelling?)');
  });

  it("a file in English only: another language key is refused until the list holds it", () => {
    const faults = faultsOf([file(changed("text.hi", { name: "Squat" }))]);
    expect(faults.map((f) => f.at)).toEqual(["text"]);
  });
});

describe("a number outside its limits is refused", () => {
  it.each([
    ["set.start.sets", 0],
    ["set.start.sets", 50],
    ["set.start.sets", 2.5],
    ["set.start.reps", 0],
    ["set.start.reps", 500],
  ])("%s = %s", (at, n) => {
    expect(faultsOf([file(changed(at, n))]).map((f) => f.at)).toEqual([at]);
  });

  it.each([
    ["set.start.seconds", 2],
    ["set.start.seconds", 3600],
  ])("%s = %s", (at, n) => {
    expect(faultsOf([file(changed(at, n, plank()))]).map((f) => f.at)).toEqual([at]);
  });

  it("a time exercise given reps, or a reps exercise given seconds, is refused", () => {
    expect(faultsOf([file(changed("set.start", { sets: 3, reps: 12 }, plank()))]).map((f) => f.at)).toContain("set.start.seconds");
    expect(faultsOf([file(changed("set.start", { sets: 3, seconds: 30 }))]).map((f) => f.at)).toContain("set.start.reps");
  });
});

describe("two exercises never share a name", () => {
  it("nameKey treats spelling and spacing as one name", () => {
    expect(new Set(["Push-up", "push up", "Pushup", "PUSH-UP", "Push‑up"].map(nameKey)).size).toBe(1);
    expect(nameKey("Bulgarian Split Squat")).toBe("bulgariansplitsquat");
  });

  it("another file's name, written differently, is refused in the file read second (files are read in name order)", () => {
    const second = changed("text.en.name", "Air-squat", plank());
    const faults = faultsOf([file(squat()), file(second)]);
    expect(faults).toEqual([{ file: "squat.json", at: "text.en.otherNames.0", problem: '"Air squat" is already the name "Air-squat" in plank.json (text.en.name)' }]);
  });

  it("an exercise's other name that repeats its own name is refused", () => {
    const faults = faultsOf([file(changed("text.en.otherNames", ["SQUAT"]))]);
    expect(faults.map((f) => f.at)).toEqual(["text.en.otherNames.0"]);
  });
});

describe("the rest of one file's rules", () => {
  it("the file's name is its id", () => {
    expect(faultsOf([file(squat(), "squats.json")])).toEqual([{ file: "squats.json", at: "id", problem: 'the id is "squat", so the file is named squat.json' }]);
  });

  it.each(["Squat", "squat-jump", "squat jump", "_squat", "squat__jump", "1squat"])("a badly made id: %s", (id) => {
    expect(faultsOf([file(changed("id", id), "x.json")]).map((f) => f.at)).toContain("id");
  });

  it("a muscle named twice, or in two rows, is refused", () => {
    const at = (muscles: unknown) => faultsOf([file(changed("muscles", muscles))]).map((f) => f.at);
    expect(at({ main: ["glute_max", "glute_max"], also: [], steady: [] })).toEqual(["muscles.main.1"]);
    expect(at({ main: ["glute_max"], also: ["glute_max"], steady: [] })).toEqual(["muscles.also.0"]);
    expect(at({ main: ["glute_max"], also: [], steady: ["glute_max"] })).toEqual(["muscles.steady.0"]);
    expect(at({ main: ["abs"], also: ["obliques"], steady: ["obliques"] })).toEqual(["muscles.steady.0"]);
  });

  it("a file without its row of steadying muscles is refused: an empty row is written, never left out", () => {
    expect(faultsOf([file(changed("muscles", { main: ["abs"], also: [] }))]).map((f) => f.at)).toEqual(["muscles.steady"]);
  });

  it("equipment named twice is refused", () => {
    expect(faultsOf([file(changed("equipment", ["barbell", "barbell"]))]).map((f) => f.at)).toEqual(["equipment.1"]);
  });

  it("a mistake named twice is refused", () => {
    const twice = [{ id: "heels_lift", says: "Heels lift. Keep them down." }, { id: "heels_lift", says: "Heels rise. Keep them flat." }];
    expect(faultsOf([file(changed("text.en.mistakes", twice))]).map((f) => f.at)).toEqual(["text.en.mistakes.1.id"]);
  });

  it.each([
    ["text.en.steps", ["Stand tall", "Bend.", "Rise."], "text.en.steps.0"],
    ["text.en.steps", ["stand tall.", "Bend.", "Rise."], "text.en.steps.0"],
    ["text.en.steps", ["Stand  tall.", "Bend.", "Rise."], "text.en.steps.0"],
    ["text.en.steps", ["Stand tall.", "Bend."], "text.en.steps"],
    ["text.en.about", "Short.", "text.en.about"],
    ["text.en.name", "squat", "text.en.name"],
    ["text.en.name", " Squat", "text.en.name"],
    ["text.en.cautions", ["stop if it hurts"], "text.en.cautions.0"],
  ])("words that are not whole sentences, or are too few: %s", (at, value, faultAt) => {
    expect(faultsOf([file(changed(at, value))]).map((f) => f.at)).toContain(faultAt);
  });

  it("a source without https, or with no source at all, is refused", () => {
    expect(faultsOf([file(changed("sources", [{ name: "A page", url: "http://example.org/" }]))]).map((f) => f.at)).toEqual(["sources.0.url"]);
    expect(faultsOf([file(changed("sources", []))]).map((f) => f.at)).toEqual(["sources"]);
  });

  it("a picture or clip that is not named by its sha256 is refused: a name like squat.mp4 could be any file", () => {
    for (const bad of ["squat.mp4", `${HASH_A.slice(0, 63)}.mp4`, `${HASH_A.toUpperCase()}.mp4`, `${HASH_A}.mov`, `../${HASH_A}.mp4`, `${HASH_A}.webp`]) {
      expect(faultsOf([file(changed("clip", { ...CLIP_A, file: bad }))]).map((f) => f.at), bad).toEqual(["clip.file"]);
    }
    expect(faultsOf([file(changed("picture", { ...PICTURE_A, file: `${HASH_A}.png` }))]).map((f) => f.at)).toEqual(["picture.file"]);
    expect(faultsOf([file(changed("picture", { ...PICTURE_A, ground: "#d5d5d5" }))]).map((f) => f.at)).toEqual(["picture.ground"]);
    expect(faultsOf([file(changed("picture", { ...PICTURE_A, extra: 1 }))]).map((f) => f.at)).toEqual(["picture"]);
  });

  it("a file that is not JSON, and a file that is not an exercise's, are refused by name", () => {
    expect(faultsOf([{ name: "squat.json", text: "{ id: squat" }]).map((f) => f.file)).toEqual(["squat.json"]);
    expect(faultsOf([{ name: "notes.txt", text: "hello" }])).toEqual([{ file: "notes.txt", at: "", problem: "only exercise files (<id>.json) belong in the exercises folder" }]);
  });

  it("a broken Compendium table is named, and every exercise is held back until it is fixed", () => {
    const checked = checkLibrary({ exerciseFiles: [file(squat())], compendium: { name: "compendium.json", text: "[" } });
    expect(checked.faults.map((f) => f.file)).toEqual(["compendium.json"]);
    expect(checked.exercises).toEqual([]);
  });

  it("only files with no fault are handed on, and every fault in every file is listed", () => {
    const checked = checkLibrary({ exerciseFiles: [file(changed("kind", "HIIT")), file(changed("level", "expert", plank()))], compendium: goodTable });
    expect(checked.exercises).toEqual([]);
    expect(checked.faults.map((f) => f.file)).toEqual(["plank.json", "squat.json"]);
  });
});
