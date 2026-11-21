// My Workout kept on the phone (63c, 64a-i). The worst thing it could do to a real person: the update wipes the
// workout somebody already put together, or one of two people on a phone sees, or changes, the other's. So the first
// tests read the list the earlier version kept, and sign two people in on one phone, one after the other.
import { describe, expect, it } from "vitest";
import {
  EMPTY,
  MY_WORKOUT_MOST,
  NAME_MOST,
  SETS_MOST,
  added,
  cleared,
  forgetStores,
  idsOf,
  moved,
  myWorkoutFileName,
  planned,
  readWorkout,
  removed,
  renamed,
  storeFor,
  type ListFile,
  type MyWorkout,
  type Plan,
} from "../src/library/myWorkout";

/** The phone's documents folder: one text a name. */
function phone() {
  const files = new Map<string, string>();
  const fileFor = (userId: string): ListFile => {
    const name = myWorkoutFileName(userId);
    return {
      read: () => Promise.resolve(files.get(name) ?? null),
      write: (text) => {
        files.set(name, text);
        return Promise.resolve();
      },
    };
  };
  return { files, fileFor };
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const settle = () => new Promise((r) => setTimeout(r, 0));
const CURL: Plan = { measuredIn: "reps", sets: [{ target: 10, weightGrams: 20_000, restSeconds: 60 }, { target: 6, weightGrams: 25_000, restSeconds: 90 }] };
const of = (...ids: string[]): MyWorkout => ids.reduce(added, EMPTY);

describe("the worst thing: the update loses a workout, or one person's is seen or changed by another", () => {
  it("the list the earlier version kept comes through whole, in its order, each on the Library's starting numbers", async () => {
    forgetStores();
    const { files, fileFor } = phone();
    // Exactly what 63c wrote.
    files.set(myWorkoutFileName(A), JSON.stringify({ v: 1, ids: ["barbell_curl", "squat", "plank"] }));
    const s = storeFor(A, fileFor(A));
    await s.ready;
    expect(s.workout()).toEqual({ name: "", items: [{ id: "barbell_curl", plan: null }, { id: "squat", plan: null }, { id: "plank", plan: null }] });
    expect(s.list()).toEqual(["barbell_curl", "squat", "plank"]);
    // The first change writes the new shape, and the old exercises are all still in it.
    s.plan("barbell_curl", CURL);
    await settle();
    forgetStores();
    const again = storeFor(A, fileFor(A));
    await again.ready;
    expect(again.workout().items).toEqual([{ id: "barbell_curl", plan: CURL }, { id: "squat", plan: null }, { id: "plank", plan: null }]);
  });

  it("each person's workout is their own file and their own, whoever signed in last", async () => {
    forgetStores();
    const { files, fileFor } = phone();
    const a = storeFor(A, fileFor(A));
    await a.ready;
    a.add("squat");
    a.add("plank");
    a.rename("Legs");
    await settle();
    // A signs out and B signs in on the same phone.
    const b = storeFor(B, fileFor(B));
    await b.ready;
    expect(b.workout()).toEqual(EMPTY);
    b.add("barbell_curl");
    b.plan("barbell_curl", CURL);
    b.rename("Arms");
    await settle();
    expect(a.workout()).toEqual({ name: "Legs", items: [{ id: "squat", plan: null }, { id: "plank", plan: null }] });
    expect([...files.keys()].sort()).toEqual([myWorkoutFileName(A), myWorkoutFileName(B)].sort());
    expect(myWorkoutFileName(A)).toContain(A);
    // A back, after the app was closed: A's workout read again from A's own file.
    forgetStores();
    const again = storeFor(A, fileFor(A));
    await again.ready;
    expect(again.workout()).toEqual({ name: "Legs", items: [{ id: "squat", plan: null }, { id: "plank", plan: null }] });
  });

  it("an empty id never shares a file", () => {
    expect(() => myWorkoutFileName("")).toThrow();
  });
});

describe("reading a kept workout leniently", () => {
  it.each<[string, string | null, MyWorkout]>([
    ["nothing kept", null, EMPTY],
    ["not JSON", "not json", EMPTY],
    ["the earlier list, with a broken id, a number and a repeat", JSON.stringify({ v: 1, ids: ["squat", "Bad Word", 7, "squat", "plank"] }), of("squat", "plank")],
    [
      "a plan that breaks the rules keeps its exercise on the starting numbers",
      JSON.stringify({ v: 2, name: "Push", items: [{ id: "squat", plan: { measuredIn: "reps", sets: [] } }, { id: "plank", plan: { measuredIn: "time", sets: [{ target: 30, weightGrams: null, restSeconds: 45 }] } }] }),
      { name: "Push", items: [{ id: "squat", plan: null }, { id: "plank", plan: { measuredIn: "time", sets: [{ target: 30, weightGrams: null, restSeconds: 45 }] } }] },
    ],
    ["reps past a save's limit", JSON.stringify({ v: 2, name: "", items: [{ id: "squat", plan: { measuredIn: "reps", sets: [{ target: 1001, weightGrams: null, restSeconds: 0 }] } }] }), of("squat")],
    ["more sets than an exercise takes", JSON.stringify({ v: 2, name: "", items: [{ id: "squat", plan: { measuredIn: "reps", sets: Array.from({ length: SETS_MOST + 1 }, () => ({ target: 5, weightGrams: null, restSeconds: 0 })) } }] }), of("squat")],
    ["a name too long is cut, a NUL taken out", JSON.stringify({ v: 2, name: `A\u0000${"b".repeat(80)}`, items: [] }), { name: `A${"b".repeat(NAME_MOST - 1)}`, items: [] }],
    ["a name that is not words", JSON.stringify({ v: 2, name: 7, items: [{ id: "plank" }] }), of("plank")],
  ])("%s", (_, text, want) => {
    expect(readWorkout(text)).toEqual(want);
  });

  it("at most as many exercises as a saved workout holds", () => {
    const ids = Array.from({ length: MY_WORKOUT_MOST + 5 }, (_, i) => `exercise_${String(i)}`);
    expect(readWorkout(JSON.stringify({ v: 1, ids })).items).toHaveLength(MY_WORKOUT_MOST);
  });
});

describe("adding, removing, moving, naming and clearing", () => {
  it("no repeats; the order exercises were added in", () => {
    expect(idsOf(added(of("squat"), "plank"))).toEqual(["squat", "plank"]);
    expect(added(of("squat", "plank"), "squat").items).toHaveLength(2);
    expect(idsOf(removed(of("squat", "plank"), "squat"))).toEqual(["plank"]);
    const w = of("plank");
    expect(removed(w, "squat")).toBe(w);
  });

  it("at most as many as a saved workout holds; one more is not added", () => {
    const full = of(...Array.from({ length: MY_WORKOUT_MOST }, (_, i) => `exercise_${String(i)}`));
    expect(added(full, "squat")).toBe(full);
  });

  it.each<[string, -1 | 1, string[]]>([
    ["plank", -1, ["plank", "barbell_curl", "squat"]],
    ["plank", 1, ["barbell_curl", "squat", "plank"]],
    ["barbell_curl", -1, ["barbell_curl", "plank", "squat"]],
    ["squat", 1, ["barbell_curl", "plank", "squat"]],
  ])("moving %s by %s", (id, by, want) => {
    const w = of("barbell_curl", "plank", "squat");
    const next = moved(w, id, by);
    expect(idsOf(next)).toEqual(want);
    if (idsOf(next).join() === idsOf(w).join()) expect(next).toBe(w);
  });

  it("a plan is kept for its own exercise only, its numbers kept as set; one that breaks the rules is not taken", () => {
    const w = planned(of("barbell_curl", "squat"), "barbell_curl", CURL);
    expect(w.items).toEqual([{ id: "barbell_curl", plan: CURL }, { id: "squat", plan: null }]);
    expect(planned(w, "plank", CURL)).toBe(w);
    expect(planned(w, "squat", { measuredIn: "reps", sets: [] })).toBe(w);
    expect(planned(w, "squat", { measuredIn: "reps", sets: [{ target: 0, weightGrams: null, restSeconds: 0 }] })).toBe(w);
  });

  it("naming keeps 60 characters at most; clearing takes every exercise and keeps the name", () => {
    expect(renamed(EMPTY, "x".repeat(70)).name).toHaveLength(NAME_MOST);
    const w = renamed(of("squat"), "Legs");
    expect(cleared(w)).toEqual({ name: "Legs", items: [] });
    expect(cleared(EMPTY)).toBe(EMPTY);
  });

  it("everybody watching is told of a change: the tab's count and the page's button", async () => {
    forgetStores();
    const { fileFor } = phone();
    const s = storeFor(A, fileFor(A));
    await s.ready;
    const seen: number[] = [];
    const stop = s.watch(() => seen.push(s.list().length));
    s.add("squat");
    s.add("squat");
    s.remove("squat");
    stop();
    s.add("plank");
    expect(seen).toEqual([1, 0]);
  });

  it("the ids are the same array while only sets or the name change, so the tab's count is not drawn again", async () => {
    forgetStores();
    const { fileFor } = phone();
    const s = storeFor(A, fileFor(A));
    await s.ready;
    s.add("barbell_curl");
    const ids = s.list();
    s.plan("barbell_curl", CURL);
    s.rename("Arms");
    expect(s.list()).toBe(ids);
    s.add("plank");
    expect(s.list()).not.toBe(ids);
  });
});

describe("the saved workout is never written over (review L1)", () => {
  it("presses made before the file was read are made again on the saved workout, never put in its place", async () => {
    forgetStores();
    const { files, fileFor } = phone();
    files.set(myWorkoutFileName(A), JSON.stringify({ v: 2, name: "Legs", items: [{ id: "squat", plan: null }, { id: "plank", plan: null }] }));
    const s = storeFor(A, fileFor(A));
    s.add("barbell_curl");
    s.remove("plank");
    s.move("barbell_curl", -1);
    await s.ready;
    await settle();
    expect(s.workout()).toEqual({ name: "Legs", items: [{ id: "barbell_curl", plan: null }, { id: "squat", plan: null }] });
    expect(readWorkout(files.get(myWorkoutFileName(A)) ?? null)).toEqual(s.workout());
  });

  it("a read that failed writes nothing, so the file keeps whatever it held", async () => {
    forgetStores();
    let written = 0;
    const s = storeFor(A, { read: () => Promise.reject(new Error("no disk")), write: () => { written += 1; return Promise.resolve(); } });
    await s.ready;
    s.add("plank");
    s.plan("plank", { measuredIn: "time", sets: [{ target: 40, weightGrams: null, restSeconds: 30 }] });
    await settle();
    expect(s.list()).toEqual(["plank"]);
    expect(written).toBe(0);
  });

  it("two people's stores alive at once stay apart", async () => {
    forgetStores();
    const { fileFor } = phone();
    const a = storeFor(A, fileFor(A));
    const b = storeFor(B, fileFor(B));
    await Promise.all([a.ready, b.ready]);
    a.add("squat");
    b.add("plank");
    b.plan("plank", { measuredIn: "time", sets: [{ target: 40, weightGrams: null, restSeconds: 30 }] });
    expect([a.list(), b.list()]).toEqual([["squat"], ["plank"]]);
    expect(a.workout().items[0]?.plan).toBeNull();
    expect(storeFor(A, fileFor(B))).toBe(a);
  });
});
