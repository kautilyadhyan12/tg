import { describe, expect, it } from "vitest";
import { phoneAppExtraSchema } from "@app/shared";
import { COPY_KEYS, configFor, copyFor } from "../app.config";

describe("a folder's copy of the app", () => {
  it("each folder has its own name, application id, api and bundler port", () => {
    const all = COPY_KEYS.map(copyFor);
    expect(all.map((c) => c.name)).toEqual(["Feature 1", "Feature 2", "Exercise 1", "Exercise 2"]);
    for (const field of ["name", "applicationId", "scheme", "apiUrl", "metroPort"] as const) {
      expect(new Set(all.map((c) => c[field])).size).toBe(all.length);
    }
  });

  it("feature folder 1 talks to its own api, through the cable", () => {
    expect(copyFor("feature1\n")).toMatchObject({
      name: "Feature 1",
      applicationId: "com.aihomegym.dev.feature1",
      apiUrl: "http://localhost:3000",
      metroPort: 8091,
    });
  });

  it("what a build hands the running app is what the app reads", () => {
    const config = configFor(copyFor("exercise2"));
    expect(config.name).toBe("Exercise 2");
    expect(config.android?.package).toBe("com.aihomegym.dev.exercise2");
    expect(phoneAppExtraSchema.parse(config.extra)).toEqual({
      copyName: "Exercise 2",
      apiUrl: "http://localhost:3003",
    });
  });

  it.each(["", "feature3", "Feature 1", "toString", "__proto__"])("refuses %j", (written) => {
    expect(() => copyFor(written)).toThrow(
      /must hold one of: feature1, feature2, exercise1, exercise2/,
    );
  });
});
