import { describe, expect, it } from "vitest";
import { COPY_KEYS, copyFor } from "../app.config";
import copies from "../copies.json";
import { cableFor } from "../scripts/cable.mjs";

const cableOf = (key: keyof typeof copies) =>
  cableFor({ scheme: copyFor(key).scheme, ...copies[key] });

describe("what the phone command runs for a copy", () => {
  it("links the copy's own api and bundler through the cable, and nothing else", () => {
    expect(cableOf("feature2").reverse).toEqual([
      ["reverse", "tcp:3001", "tcp:3001"],
      ["reverse", "tcp:8092", "tcp:8092"],
    ]);
  });

  it("the api's link is the address the app itself asks", () => {
    for (const key of COPY_KEYS as (keyof typeof copies)[]) {
      const [api] = cableOf(key).reverse;
      expect(`http://localhost:${api?.[1]?.replace("tcp:", "") ?? ""}`).toBe(copyFor(key).apiUrl);
    }
  });

  it("starts the bundler on the copy's port, for this laptop alone", () => {
    expect(cableOf("exercise1").bundlerArgs).toEqual([
      "expo",
      "start",
      "--dev-client",
      "--localhost",
      "--port",
      "8093",
    ]);
  });

  it("opens the copy by its own scheme, pointed at its own bundler", () => {
    expect(cableOf("feature1").link).toBe(
      "aihomegym-feature1://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8091",
    );
    const links = (COPY_KEYS as (keyof typeof copies)[]).map((key) => cableOf(key).link);
    expect(new Set(links).size).toBe(links.length);
  });

  it.each([
    ["a port that is words", { scheme: "a", apiPort: "3000; calc", metroPort: 8091 }],
    ["a port with a fraction", { scheme: "a", apiPort: 3000.5, metroPort: 8091 }],
    ["a missing port", { scheme: "a", apiPort: 3000, metroPort: undefined }],
    ["a port below 1024", { scheme: "a", apiPort: 80, metroPort: 8091 }],
    ["a scheme with a space", { scheme: "a & calc", apiPort: 3000, metroPort: 8091 }],
  ])("refuses %s", (_name, copy) => {
    expect(() => cableFor(copy)).toThrow(/must be/);
  });
});
