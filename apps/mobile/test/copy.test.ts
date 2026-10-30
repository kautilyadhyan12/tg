import { describe, expect, it } from "vitest";
import { phoneAppExtraSchema } from "@app/shared";
import { COPY_KEYS, configFor, copyFor } from "../app.config";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const keepActivity = require("../plugins/keepActivity.js") as { withBoth: (manifest: unknown) => unknown };

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

describe("the screen is not rebuilt", () => {
  it("handles a change of display size and text size itself, each once, and keeps what it had", () => {
    const manifest = { manifest: { application: [{ activity: [{ $: { "android:name": ".MainActivity", "android:configChanges": "orientation|density" } }, { $: { "android:name": ".Other" } }] }] } };
    keepActivity.withBoth(manifest);
    const [main, other] = manifest.manifest.application[0]?.activity ?? [];
    expect(main?.$["android:configChanges"]).toBe("orientation|density|fontScale");
    expect(other?.$["android:configChanges"]).toBeUndefined();
  });
});
