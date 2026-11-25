// A workout looked back on in History (64a-v): its exercises named from the Library on the phone, one the phone's copy
// does not hold named by its id word, and the line that lists them.
import { describe, expect, it } from "vitest";
import { exercisesLine, idWords, namedFrom, serverFirst } from "../src/screens/workout/pastWords";
import { realLibrary } from "./realLibrary";

describe("naming a workout's exercises", () => {
  const named = namedFrom(realLibrary());

  it("names an exercise the Library holds by its own name and kind", () => {
    expect(named("barbell_curl")).toEqual({ name: "Barbell Curl", kind: "strength", picture: null, clip: null });
    expect(named("plank").name).toBe("Plank");
  });

  it.each([
    ["deadlift", "Deadlift"],
    ["romanian_deadlift", "Romanian deadlift"],
    ["push-up", "Push up"],
    ["x", "X"],
    ["__", "__"],
  ])("names %j, which the phone's copy does not hold, %j", (id, words) => {
    expect(idWords(id)).toBe(words);
    expect(named(id)).toEqual({ name: idWords(id), kind: "strength", picture: null, clip: null });
  });

  it("names every exercise by its id word until the Library is read", () => {
    expect(namedFrom(null)("barbell_curl")).toEqual({ name: "Barbell curl", kind: "strength", picture: null, clip: null });
  });

  it.each([
    [[], ""],
    [["squat"], "Squat"],
    [["squat", "plank"], "Squat and Plank"],
    [["squat", "plank", "barbell_curl"], "Squat, Plank and Barbell Curl"],
    [["squat", "plank", "barbell_curl", "deadlift"], "Squat, Plank and 2 more"],
    [["squat", "plank", "barbell_curl", "deadlift", "lunge"], "Squat, Plank and 3 more"],
  ])("lists %j as %j", (ids, line) => {
    expect(exercisesLine(ids, named)).toBe(line);
  });

  it("names by the server's Library name first, then the phone's copy, then the id word (round one L2)", () => {
    const by = serverFirst(named, new Map([["deadlift", "Deadlift"], ["barbell_curl", null]]));
    expect(by("deadlift")).toEqual({ name: "Deadlift", kind: "strength", picture: null, clip: null });
    // Its own picture (62a) comes from the phone's copy whichever name is shown.
    expect(by("kettlebell_goblet_squat").picture).toEqual(named("kettlebell_goblet_squat").picture);
    expect(named("kettlebell_goblet_squat").picture?.file).toMatch(/^[0-9a-f]{64}.webp$/);
    // And its clip (62b).
    expect(by("kettlebell_goblet_squat").clip).toEqual(named("kettlebell_goblet_squat").clip);
    expect(named("kettlebell_goblet_squat").clip?.file).toMatch(/^[0-9a-f]{64}.mp4$/);
    expect(by("barbell_curl").name).toBe("Barbell Curl");
    expect(by("romanian_deadlift").name).toBe("Romanian deadlift");
  });
});
