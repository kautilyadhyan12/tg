import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// A meal photo is the picture the screen shows (33c, testers on Google Play): held flat over a plate,
// Android's tilt sensor cannot tell which way is up and turned the photo on its side. The setting that
// stops it is the iPhone's own; Android has it only through our patch to the camera package, and only
// if the build compiles the camera from its source, never Expo's ready-built copy. Lose either and the
// fix leaves the phone without a word, so each is checked here.

const mobile = join(__dirname, "..");
const root = join(mobile, "..", "..");
const json = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const field = (value: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((at, key) => (typeof at === "object" && at !== null ? (at as Record<string, unknown>)[key] : undefined), value);

const app = json(join(mobile, "package.json"));
const version = field(app, "dependencies", "expo-camera");
const patchPath = field(json(join(root, "package.json")), "pnpm", "patchedDependencies", `expo-camera@${String(version)}`);
const KOTLIN = "android/src/main/java/expo/modules/camera";

describe("the camera's patch reaches the phone build (33c)", () => {
  it("the patch is declared for the camera version the app uses", () => {
    expect(typeof version).toBe("string");
    expect(patchPath).toBe(`patches/expo-camera@${String(version)}.patch`);
    const patch = readFileSync(join(root, String(patchPath)), "utf8").replace(/\r\n/g, "\n");
    // A screen that says nothing keeps the screen's picture; the tilt reading changes nothing then.
    expect(patch).toContain("+        view.responsiveOrientationWhenOrientationLocked = responsive ?: false");
    expect(patch).toContain("+  var responsiveOrientationWhenOrientationLocked: Boolean = false");
    expect(patch).toContain("+        if (orientation == ORIENTATION_UNKNOWN || !responsiveOrientationWhenOrientationLocked) {");
    // The screen's own turn, set when the setting changes, on every new camera and on every photo.
    expect(patch).toContain("+    imageCaptureUseCase?.targetRotation = upright");
    expect(patch).toContain("+    imageAnalysisUseCase?.targetRotation = upright");
    expect(patch).toContain("+      field = value\n+      keepScreenTurn()");
    expect(patch).toContain("imageAnalysisUseCase = createImageAnalyzer()\n+    keepScreenTurn()");
    expect(patch).toContain("runtimeContext: RuntimeContext) {\n+    keepScreenTurn()");
  });

  it("Android builds the camera from its source, so the patch is in the app", () => {
    expect(field(app, "expo", "autolinking", "android", "buildFromSource")).toContain("expo-camera");
  });

  it("the installed camera carries the patch", () => {
    const here = dirname(createRequire(join(mobile, "package.json")).resolve("expo-camera/package.json"));
    expect(readFileSync(join(here, KOTLIN, "CameraViewModule.kt"), "utf8")).toContain('Prop("responsiveOrientationWhenOrientationLocked")');
    const view = readFileSync(join(here, KOTLIN, "ExpoCameraView.kt"), "utf8").replace(/\r\n/g, "\n");
    expect(view).toContain("orientation == ORIENTATION_UNKNOWN || !responsiveOrientationWhenOrientationLocked");
    expect(view).toContain("runtimeContext: RuntimeContext) {\n    keepScreenTurn()");
  });
});
