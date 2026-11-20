// My Workout kept on the phone (63c). The worst thing it could do to a real person: on a phone two people use, one of
// them sees, or changes, the other's list. So the first test signs two people in on one phone, one after the other.
import { describe, expect, it } from "vitest";
import { MY_WORKOUT_MOST, added, forgetStores, myWorkoutFileName, readList, removed, storeFor, type ListFile } from "../src/library/myWorkout";

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

describe("the worst thing: one person's My Workout seen or changed by another on the same phone", () => {
  it("each person's list is their own file and their own list, whoever signed in last", async () => {
    forgetStores();
    const { files, fileFor } = phone();
    const a = storeFor(A, fileFor(A));
    await a.ready;
    a.add("squat");
    a.add("plank");
    await settle();
    // A signs out and B signs in on the same phone.
    const b = storeFor(B, fileFor(B));
    await b.ready;
    expect(b.list()).toEqual([]);
    b.add("barbell_curl");
    await settle();
    expect(a.list()).toEqual(["squat", "plank"]);
    // The two files name their owner, so deleting an account removes its own (forgetPersonFiles).
    expect([...files.keys()].sort()).toEqual([myWorkoutFileName(A), myWorkoutFileName(B)].sort());
    expect(myWorkoutFileName(A)).toContain(A);
    // A back, after the app was closed: A's list read again from A's own file.
    forgetStores();
    const again = storeFor(A, fileFor(A));
    await again.ready;
    expect(again.list()).toEqual(["squat", "plank"]);
  });

  it("an empty id never shares a file", () => {
    expect(() => myWorkoutFileName("")).toThrow();
  });
});

describe("adding and removing", () => {
  it("no repeats; the order exercises were added in", () => {
    expect(added(["squat"], "plank")).toEqual(["squat", "plank"]);
    expect(added(["squat", "plank"], "squat")).toEqual(["squat", "plank"]);
    expect(removed(["squat", "plank"], "squat")).toEqual(["plank"]);
    expect(removed(["plank"], "squat")).toEqual(["plank"]);
  });

  it("at most as many as a saved workout holds; one more is not added", () => {
    const full = Array.from({ length: MY_WORKOUT_MOST }, (_, i) => `exercise_${String(i)}`);
    expect(added(full, "squat")).toBe(full);
  });

  it("a kept list that cannot be read is an empty one; a broken entry is left out", () => {
    expect(readList(null)).toEqual([]);
    expect(readList("not json")).toEqual([]);
    expect(readList(JSON.stringify({ v: 1, ids: ["squat", "Bad Word", 7, "squat", "plank"] }))).toEqual(["squat", "plank"]);
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
});
