// The live server builds the api's image from infra/Dockerfile, and its install step has only the files copied in
// before it. pnpm reads every patch the root package.json declares before it installs anything, even a patch for a
// phone package the api never uses, and stops when one is missing: on 2026-11-17 the expo-camera patch (33c) was
// not copied in, the server answered "ENOENT ... /app/patches/expo-camera@57.0.6.patch" and could not take the
// update. GitHub's checks never build the image, so this reads the recipe the way the build does.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const repo = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), "utf8");

const rootPackage = z
  .object({ pnpm: z.object({ patchedDependencies: z.record(z.string(), z.string()).optional() }).optional() })
  .parse(JSON.parse(read("package.json")));
const patches = Object.values(rootPackage.pnpm?.patchedDependencies ?? {});

const dockerfile = read("infra/Dockerfile");
const deps = /^FROM \S+ AS deps$([\s\S]*?)^FROM /m.exec(dockerfile)?.[1] ?? "";
const install = deps.search(/^RUN [\s\S]*?pnpm install/m);
// A COPY's sources: every word but its flags and its last, the place it copies to.
const copiedBeforeInstall = [...deps.slice(0, install).matchAll(/^COPY (.+)$/gm)].flatMap((m) =>
  (m[1] ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => !word.startsWith("--"))
    .slice(0, -1),
);
const copies = (file: string) =>
  copiedBeforeInstall.some((source) => source === file || file.startsWith(source.endsWith("/") ? source : `${source}/`));

describe("the server's image has every file its install reads", () => {
  it("reads the install step from the recipe's deps stage", () => {
    expect(install).toBeGreaterThan(0);
    expect(copiedBeforeInstall).toEqual(expect.arrayContaining(["pnpm-lock.yaml", "package.json", "apps/api/package.json"]));
  });

  it("copies in every patch the root package.json declares, before the install", () => {
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.filter((file) => !copies(file))).toEqual([]);
  });

  it("leaves no patch out of the build through its ignore list", () => {
    const ignored = read("infra/Dockerfile.dockerignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(ignored.filter((line) => /patch/i.test(line))).toEqual([]);
  });
});
