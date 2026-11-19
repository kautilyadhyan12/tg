// The Exercise Library's rules on the phone (63a): search order, the effort bands, muscle wording, which
// shapes of a figure light, and the copy kept on the phone. Every test reads the real exercise files.
import { readdirSync, readFileSync } from "node:fs";
import { EXERCISE_MUSCLES, readPhoneLibrary, type PhoneLibrary, type PhoneLibraryEntry } from "@app/shared";
import { describe, expect, it } from "vitest";
import { DEEP_UNDER, DRAWN_MUSCLES, litMuscles, sideFor } from "../src/library/figure";
import { FIGURES } from "../src/library/figures";
import { normalise, searchExercises } from "../src/library/search";
import { LIBRARY_PATH, offered, readKept, refreshLibrary, type LibraryFile } from "../src/library/store";
import { effortOf, equipmentLine, muscleLine, muscleNames, plainWord, splitMistake, targetLine } from "../src/library/words";
import type { Answer, Request, Shape } from "../src/session/calls";

const FOLDER = new URL("../../../packages/shared/library/exercises/", import.meta.url);
const METS: Record<string, number> = { squat: 3, plank: 2.8, barbell_curl: 3.5 };

function realDownload(more: Record<string, unknown>[] = [], fingerprint = "a".repeat(64)): unknown {
  const exercises = readdirSync(FOLDER).map((name) => {
    const file = JSON.parse(readFileSync(new URL(name, FOLDER), "utf8")) as Record<string, unknown>;
    return { ...file, status: "live", met: METS[String(file.id)] ?? 3 };
  });
  return { fingerprint, version: 1, list: { exercises: [...exercises, ...more], camera: [] } };
}
function realLibrary(): PhoneLibrary {
  const read = readPhoneLibrary(realDownload());
  if (read === null) throw new Error("the real Library could not be read");
  return read;
}
const real = (id: string): PhoneLibraryEntry => {
  const found = realLibrary().exercises.find((e) => e.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
};

/** An exercise made from the plank's file with other names: for search cases the real three cannot show. */
function named(id: string, name: string, otherNames: string[] = [], change: Partial<PhoneLibraryEntry> = {}): PhoneLibraryEntry {
  const p = real("plank");
  return { ...p, ...change, id, text: { en: { ...p.text.en, name, otherNames } } };
}

describe("search: name matches first, then other names, then muscles, equipment and kind", () => {
  const list = [
    named("push_up", "Push-up", ["Press-up"]),
    named("pushup_plus", "Push-up Plus"),
    named("incline_push_up", "Incline Push-up"),
    named("ab_wheel", "Ab Wheel Rollout"),
    named("hollow_hold", "Hollow Body Hold", ["Hollow hold"]),
    named("calf_raise", "Calf Raise", [], { muscles: { main: ["calves"], also: ["soleus"], steady: [] } }),
    real("squat"),
    real("plank"),
    real("barbell_curl"),
  ];
  const ids = (q: string) => searchExercises(list, q).map((e) => e.id);
  it.each([
    // [what is typed, the order shown]
    ["", ["ab_wheel", "barbell_curl", "calf_raise", "hollow_hold", "incline_push_up", "plank", "push_up", "pushup_plus", "squat"]],
    ["push-up", ["push_up", "pushup_plus", "incline_push_up"]],
    ["Push up", ["push_up", "pushup_plus", "incline_push_up"]],
    ["pushup", ["push_up", "pushup_plus", "incline_push_up"]],
    ["press-up", ["push_up"]],
    ["  PLANK ", ["plank"]],
    ["front plank", ["plank"]],
    ["curl", ["barbell_curl"]],
    ["air squat", ["squat"]],
    ["biceps", ["barbell_curl"]],
    ["biceps femoris", ["squat"]],
    ["femoris", ["squat"]],
    ["hamstrings", ["squat"]],
    ["brachialis", ["barbell_curl"]],
    ["quadriceps", ["squat"]],
    ["vastus", ["squat"]],
    ["barbell", ["barbell_curl"]],
    ["glutes", ["squat"]],
    ["abs", ["ab_wheel", "hollow_hold", "incline_push_up", "plank", "push_up", "pushup_plus"]],
    ["strength", ["ab_wheel", "barbell_curl", "calf_raise", "hollow_hold", "incline_push_up", "plank", "push_up", "pushup_plus", "squat"]],
    ["burpee", []],
    // What people type for a muscle (L6): searched as the words it stands for.
    ["quads", ["squat"]],
    ["core", ["ab_wheel", "hollow_hold", "incline_push_up", "plank", "push_up", "pushup_plus"]],
    ["bis", ["barbell_curl"]],
    ["hams", ["squat"]],
    ["pecs", []],
    // An alias is matched as itself too (round one's re-check, N1): the word in a name still finds it.
    ["raise calf", ["calf_raise"]],
    ["calf", ["calf_raise"]],
    ["calves", ["calf_raise"]],
    ["éxercise", []],
    ["!!!", ["ab_wheel", "barbell_curl", "calf_raise", "hollow_hold", "incline_push_up", "plank", "push_up", "pushup_plus", "squat"]],
  ])("%j → %j", (q, want) => {
    expect(ids(q)).toEqual(want);
  });

  it("marks and capitals are ignored both ways", () => {
    expect(normalise("Crème  Brûlée-Curl")).toBe("creme brulee curl");
  });
});

describe("effort: the Compendium's own bands", () => {
  it.each([
    [null, null],
    [0, null],
    [-1, null],
    [Number.NaN, null],
    [1, "light"],
    [2.8, "light"],
    [2.99, "light"],
    [3, "moderate"],
    [3.5, "moderate"],
    [5.99, "moderate"],
    [6, "vigorous"],
    [8, "vigorous"],
  ])("MET %s → %s", (met, effort) => {
    expect(effortOf(met)).toBe(effort);
  });
});

describe("the words an exercise is shown with", () => {
  it.each([
    [["rectus_femoris", "vastus_lateralis", "vastus_medialis", "glute_max"], "Quadriceps (rectus femoris, vastus lateralis, vastus medialis) · Glutes (gluteus maximus)"],
    [["abs", "transverse_abdominis"], "Abs (rectus abdominis) · Transverse abdominis"],
    [["adductors", "adductor_magnus", "tibialis"], "Adductors · Adductor magnus · Tibialis anterior"],
    [["rotator_cuff"], "Rotator cuff"],
    [["obliques", "lower_back", "serratus"], "Obliques · Lower back (erector spinae) · Serratus anterior"],
    [["gluteus_minimus"], "Gluteus minimus"],
    [[], ""],
  ])("%j → %s", (muscles, line) => {
    expect(muscleLine(muscles)).toBe(line);
  });

  it("a card gives the plain names alone, each once", () => {
    expect(muscleNames(real("squat").muscles.main)).toBe("Quadriceps · Glutes");
  });

  it("the real three's targets and equipment", () => {
    expect(targetLine(real("squat"))).toBe("3 × 12 reps");
    expect(targetLine(real("plank"))).toBe("3 × 30 s");
    expect(targetLine(real("plank"), false)).toBe("3 sets of 30 s");
    expect(equipmentLine(real("plank"))).toBe("No equipment");
    expect(equipmentLine(real("barbell_curl"))).toBe("Barbell");
    expect(equipmentLine({ ...real("barbell_curl"), equipment: ["barbell", "bench"] })).toBe("Barbell +1");
    expect(targetLine({ ...real("plank"), set: { measuredIn: "distance", start: { sets: 3 } } })).toBeNull();
  });

  it("a word the phone does not know is shown plainly", () => {
    expect(plainWord("gluteus_minimus")).toBe("Gluteus minimus");
    expect(plainWord("_")).toBe("_");
  });
});

describe("a mistake as what goes wrong and how to put it right", () => {
  it.each([
    ["Heels lift off the floor. Keep your whole foot down.", "Heels lift off the floor.", "Keep your whole foot down."],
    ["Hips sag, e.g. toward the floor. Brace your abdominals.", "Hips sag, e.g. toward the floor.", "Brace your abdominals."],
    ["Feet approx. 10 cm too wide. Bring them in.", "Feet approx. 10 cm too wide.", "Bring them in."],
    ["Knees bend.", "Knees bend.", null],
    ["Breath is held. Keep breathing. Count each breath.", "Breath is held.", "Keep breathing. Count each breath."],
  ])("%j", (says, wrong, fix) => {
    expect(splitMistake(says)).toEqual({ wrong, fix });
  });
});

describe("the figures and the muscle list hold each other", () => {
  it("every muscle of the list is drawn on the figures, or is a deep one that lights a drawn one", () => {
    const missing = EXERCISE_MUSCLES.filter((m) => !DRAWN_MUSCLES.has(m) && !(m in DEEP_UNDER));
    expect(missing).toEqual([]);
    for (const under of Object.values(DEEP_UNDER)) expect(DRAWN_MUSCLES.has(under)).toBe(true);
  });

  it("a figure names only words of the list", () => {
    const list = new Set<string>(EXERCISE_MUSCLES);
    const strangers = Object.values(FIGURES).flatMap((parts) => parts.map((p) => p.m).filter((m) => m !== "" && !list.has(m)));
    expect(strangers).toEqual([]);
  });

  it("the male and female figures show the same muscles on each side", () => {
    const on = (name: keyof typeof FIGURES) => [...new Set(FIGURES[name].map((p) => p.m).filter((m) => m !== ""))].sort();
    expect(on("female-front")).toEqual(on("male-front"));
    expect(on("female-back")).toEqual(on("male-back"));
  });

  it("each row lights its muscles; a deep one lights the drawn one over it, never above that one's own row", () => {
    const lit = litMuscles(real("plank").muscles);
    expect(lit.get("abs")).toBe("main");
    expect(lit.get("obliques")).toBe("also");
    expect(lit.get("infraspinatus")).toBe("steady");
    expect(litMuscles({ main: ["infraspinatus"], also: [], steady: ["rotator_cuff"] }).get("infraspinatus")).toBe("main");
    expect(litMuscles({ main: ["rotator_cuff"], also: ["infraspinatus"], steady: [] }).get("infraspinatus")).toBe("main");
  });

  it.each([
    [["biceps"], "front"],
    [["rectus_femoris", "vastus_lateralis", "vastus_medialis", "glute_max"], "front"],
    [["glute_max", "biceps_femoris"], "back"],
    [["lats"], "back"],
    [["abs", "transverse_abdominis"], "front"],
    [["side_delts"], "front"],
    [["gluteus_minimus"], "front"],
  ])("the figure for main %j is the %s", (main, side) => {
    expect(sideFor(main)).toBe(side);
  });
});

describe("the copy kept on the phone", () => {
  const memory = (text: string | null = null): LibraryFile & { text: string | null; writes: number } => {
    const f = {
      text,
      writes: 0,
      read: () => Promise.resolve(f.text),
      write: (t: string) => {
        f.text = t;
        f.writes += 1;
        return Promise.resolve();
      },
    };
    return f;
  };
  /** The server as the store asks it: each call's request kept, its reply read through the store's shape. */
  const server = (reply: { status: "ok"; body: unknown } | { status: "none" }) => {
    const asked: Omit<Request, "token">[] = [];
    const ask = <T>(request: Omit<Request, "token">, shape: Shape<T>): Promise<Answer<T>> => {
      asked.push(request);
      if (reply.status === "none") return Promise.resolve({ kind: "no_answer" });
      const read = shape.safeParse(reply.body);
      return Promise.resolve(read.success ? { kind: "ok", data: read.data } : { kind: "no_answer" });
    };
    return { ask, asked };
  };

  it("the first open asks with no copy, keeps the download, and offers the live ones", async () => {
    const file = memory();
    const s = server({ status: "ok", body: realDownload([{ ...real("plank"), id: "old_crunch", status: "retired" }]) });
    const state = await refreshLibrary(s.ask, file, null);
    expect(s.asked).toEqual([{ method: "GET", path: LIBRARY_PATH }]);
    expect(file.writes).toBe(1);
    expect(state.kind === "ready" ? offered(state.library).map((e) => e.id).sort() : state.kind).toEqual(["barbell_curl", "plank", "squat"]);
    expect(state.kind === "ready" ? state.library.exercises.some((e) => e.id === "old_crunch") : false).toBe(true);
  });

  it("with a copy, it asks with the copy's fingerprint; not changed keeps the copy and writes nothing", async () => {
    const kept = realLibrary();
    const file = memory(JSON.stringify(realDownload()));
    const s = server({ status: "ok", body: null });
    const state = await refreshLibrary(s.ask, file, kept);
    expect(s.asked[0]?.etag).toBe(`"${"a".repeat(64)}"`);
    expect(file.writes).toBe(0);
    expect(state).toEqual({ kind: "ready", library: kept, fresh: true });
  });

  it("a newer copy replaces the kept one", async () => {
    const file = memory(JSON.stringify(realDownload()));
    const newer = realDownload([], "b".repeat(64));
    const state = await refreshLibrary(server({ status: "ok", body: newer }).ask, file, realLibrary());
    expect(state.kind === "ready" ? state.library.fingerprint : null).toBe("b".repeat(64));
    expect((await readKept(file))?.fingerprint).toBe("b".repeat(64));
  });

  it("no internet: the kept copy stands; with none, the Library says it could not load", async () => {
    const kept = realLibrary();
    expect(await refreshLibrary(server({ status: "none" }).ask, memory(), kept)).toEqual({ kind: "ready", library: kept, fresh: false });
    expect(await refreshLibrary(server({ status: "none" }).ask, memory(), null)).toEqual({ kind: "failed" });
  });

  it("no Library published yet (404) and none kept: the phone says so, and never that the connection failed", async () => {
    const refused = <T>(): Promise<Answer<T>> =>
      Promise.resolve({ kind: "refused", status: 404, error: "no_library", message: "No Library yet.", retryAfterSeconds: null, robotCheckKey: null, body: null });
    expect(await refreshLibrary(refused, memory(), null)).toEqual({ kind: "none" });
    const kept = realLibrary();
    expect(await refreshLibrary(refused, memory(), kept)).toEqual({ kind: "ready", library: kept, fresh: false });
  });

  it("a reply that is not a Library is never kept", async () => {
    const file = memory();
    const state = await refreshLibrary(server({ status: "ok", body: { error: "nope" } }).ask, file, null);
    expect(state).toEqual({ kind: "failed" });
    expect(file.writes).toBe(0);
  });

  it("a kept file that cannot be read is no copy", async () => {
    expect(await readKept(memory("{not json"))).toBeNull();
    expect(await readKept(memory(JSON.stringify({ hello: 1 })))).toBeNull();
    expect(await readKept(memory(null))).toBeNull();
  });
});
