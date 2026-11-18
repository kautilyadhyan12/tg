import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { STORE, configFor, copyFor, storeConfig } from "../app.config";

// The phone test (ROADMAP Stage 5 51a) plays Kd's reference videos through Google's Android pose library in a
// folder's copy. Two things here would reach people if they slipped, and GitHub never builds the app: the store's
// app must hold none of the test (no screen anybody could open, no pose library before job 53 ships it), and a copy
// that holds the library must not let it send Google its usage reports (Kd, 2026-10-18: nothing goes online).

const mobile = join(__dirname, "..");
const MODULE = join(mobile, "modules", "phone-test", "android");
const text = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function filesUnder(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const require = createRequire(import.meta.url);
interface Plugin {
  withoutSender: (manifest: Manifest) => Manifest;
  DISCOVERY: string;
  SENDER: string;
}
interface Element {
  $?: Record<string, string>;
  "meta-data"?: Element[];
}
interface Manifest {
  $?: Record<string, string>;
  application?: { $?: Record<string, string>; service?: Element[] }[];
}
const plugin = require(join(mobile, "plugins", "noUsageReports.js")) as Plugin;

describe("the store's app holds none of the phone test (51a)", () => {
  const gradle = text(join(MODULE, "build.gradle"));

  it("Google's pose library is in the debug build alone, pinned to one version", () => {
    const lines = gradle.split("\n").filter((l) => l.includes("com.google.mediapipe"));
    expect(lines.map((l) => l.trim())).toEqual(['debugImplementation "com.google.mediapipe:tasks-vision:1.0.0"']);
  });

  it("no code a release build compiles names the pose library or the test", () => {
    const shipped = filesUnder(join(MODULE, "src")).filter((p) => !relative(MODULE, p).split(/[\\/]/).includes("debug"));
    expect(shipped.map((p) => relative(MODULE, p).replace(/\\/g, "/"))).toEqual(["src/main/AndroidManifest.xml"]);
    expect(text(join(MODULE, "src", "main", "AndroidManifest.xml"))).not.toMatch(/activity|mediapipe/i);
  });

  it("the test's screens open only from the laptop's cable (51a, 51b-ii)", () => {
    const manifest = text(join(MODULE, "src", "debug", "AndroidManifest.xml"));
    const activities = manifest.match(/<activity[\s\S]*?\/>/g) ?? [];
    expect(activities.map((a) => /android:name="([^"]+)"/.exec(a)?.[1])).toEqual(["expo.modules.phonetest.PhoneTestActivity", "expo.modules.phonetest.PhoneTestLiveActivity"]);
    for (const activity of activities) {
      // Exported for `adb shell am start`, behind a permission Android gives the shell and no installed app.
      expect(activity).toContain('android:exported="true"');
      expect(activity).toContain('android:permission="android.permission.DUMP"');
    }
    // The live screen asks for no permission of its own: the laptop grants the camera the app already declares.
    expect(manifest).not.toContain("uses-permission");
  });

  it("the live screen's camera and screen libraries are the app's own, in the debug build alone (51b-ii)", () => {
    const camera = text(join(mobile, "node_modules", "expo-camera", "android", "build.gradle"));
    const version = /def camerax_version = "([0-9.]+)"/.exec(camera)?.[1];
    expect(version).toBeDefined();
    // The app's own activity library comes with the photo picker (expo-image-picker's activity-ktx).
    const picker = text(join(mobile, "node_modules", "expo-image-picker", "android", "build.gradle"));
    const activity = /androidx\.activity:activity-ktx:([0-9.]+)"/.exec(picker)?.[1];
    expect(activity).toBeDefined();
    const lines = gradle.split("\n").filter((l) => /androidx\.(camera|activity)/.test(l)).map((l) => l.trim());
    expect(lines).toEqual([
      `debugImplementation "androidx.camera:camera-core:${String(version)}"`,
      `debugImplementation "androidx.camera:camera-camera2:${String(version)}"`,
      `debugImplementation "androidx.camera:camera-lifecycle:${String(version)}"`,
      `debugImplementation "androidx.camera:camera-view:${String(version)}"`,
      `debugImplementation "androidx.activity:activity:${String(activity)}"`,
    ]);
    expect(gradle.split("\n").filter((l) => /^\s*implementation /.test(l))).toEqual([]);
  });

  it("the live screen reads the laptop's live plan, asks for one person, and writes no picture (51b-ii)", () => {
    const kotlin = text(join(MODULE, "src", "debug", "java", "expo", "modules", "phonetest", "PhoneTestLive.kt"));
    const laptop = text(join(mobile, "..", "..", "packages", "movement", "scripts", "phoneLive.ts"));
    const version = /private const val LIVE_PLAN_VERSION = (\d+)/.exec(kotlin)?.[1];
    expect(version).toBeDefined();
    expect(laptop).toMatch(new RegExp(`return \\{\\n    version: ${String(version)},\\n    people: 1,`));
    expect(kotlin).toContain('check(json.getInt("version") == LIVE_PLAN_VERSION)');
    expect(kotlin).toContain('check(it == 1) { "The live test asks for one person." }');
    // Text only: no picture is turned into a file. The camera's pictures go to the model and nowhere else.
    expect(kotlin).not.toMatch(/\.compress\(|FileOutputStream|\.jpe?g|\.png|MediaStore|copyPixelsToBuffer|writeBytes|outputStream\(/);
    // And every write in the file is one of its known text lines (round one): a header, second, minute, end or a
    // picture's points through the run's writer, a failed run's note, or where the test is.
    const writes = kotlin.split("\n").filter((l) => /\.(write|writeText|append)\(|bufferedWriter\(/.test(l) && !/b\.append\(|StringBuilder|people\.append/.test(l)).map((l) => l.trim());
    expect(writes).toEqual([
      "part.bufferedWriter().use { w ->",
      'w.write(header(plan, "still", k, still.camera, still.setup, created) + "\\n")',
      'w.write(end(plan.stillSeconds, SystemClock.elapsedRealtime() - started, null) + "\\n")',
      "part.bufferedWriter().use { w ->",
      'w.write(head + "\\n")',
      'w.write(second(s, wall, one, cpu - lastCpu, charging) + "\\n")',
      'if (s % 60 == 0) w.write(minute(s / 60) + "\\n")',
      'w.write(end(s, SystemClock.elapsedRealtime() - started, stopped) + "\\n")',
      'w.write("{\\"kind\\":\\"frame\\",\\"t\\":$t,\\"people\\":[$people]}\\n")',
      'File(out, "$name.failed.json").writeText(json.toString())',
      "part.writeText(json.toString())",
    ]);
    expect(kotlin).toContain("PhoneTestCores.onCores(options, it)");
  });

  it("the test names the library version the app is built with", () => {
    const kotlin = text(join(MODULE, "src", "debug", "java", "expo", "modules", "phonetest", "PhoneTest.kt"));
    const version = /tasks-vision:([0-9.]+)"/.exec(gradle)?.[1];
    expect(version).toBeDefined();
    expect(kotlin).toContain(`internal const val LIBRARY = "tasks-vision ${String(version)}"`);
  });

  it("the main chip's cores are set in the debug build alone, on the main chip alone, and the phone reads the laptop's plan (51b)", () => {
    const cores = join(MODULE, "src", "debug", "java", "com", "google", "mediapipe", "tasks", "vision", "poselandmarker", "PhoneTestCores.java");
    const java = text(cores);
    // Text only: that the phone took the cores is shown by the cores it kept busy (phoneCheck's CORES_TAKEN, read on
    // every run) and was on Kd's phone (51b-i: 1.6 busy on 2 cores, 2.5 on 4), never by this test.
    // Only the chip's part of the library's settings is replaced, and anything but the main chip is refused.
    expect(java).toContain("if (!base.getAcceleration().hasTflite()) throw");
    expect(java.match(/setAcceleration\(/g)).toHaveLength(1);
    expect(java).toContain("setNumThreads(threads)");
    // The plan's version is the same number on both sides: a copy built before 51b refuses a plan that names cores.
    const kotlin = text(join(MODULE, "src", "debug", "java", "expo", "modules", "phonetest", "PhoneTest.kt"));
    const laptop = text(join(mobile, "..", "..", "packages", "movement", "scripts", "phoneRun.ts"));
    const phoneVersion = /private const val PLAN_VERSION = (\d+)/.exec(kotlin)?.[1];
    expect(phoneVersion).toBeDefined();
    expect(laptop).toContain(`version: ${String(phoneVersion)},`);
    expect(kotlin).toContain('check(json.getInt("version") == PLAN_VERSION)');
    expect(kotlin).toContain("PhoneTestCores.onCores(options, it)");
  });
});

describe("a copy that holds the pose library sends Google nothing (51a)", () => {
  it("every folder's copy is built with the sender taken away; the store's, without the library, is not changed", () => {
    for (const key of ["feature1", "feature2", "exercise1", "exercise2"]) {
      expect(configFor(copyFor(key)).plugins).toContain("./plugins/noUsageReports.js");
    }
    const store = storeConfig({ KWAZO_VERSION_CODE: "7" }, [STORE.applicationId]);
    expect(store.plugins).not.toContain("./plugins/noUsageReports.js");
  });

  it("the transport's sender is removed from the app's manifest, and only it", () => {
    const manifest: Manifest = {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      application: [{ service: [{ $: { "android:name": "some.other.Service" } }] }],
    };
    const done = plugin.withoutSender(plugin.withoutSender(manifest));
    expect(done.$?.["xmlns:tools"]).toBe("http://schemas.android.com/tools");
    const services = done.application?.[0]?.service ?? [];
    expect(services.map((s) => s.$?.["android:name"])).toEqual(["some.other.Service", plugin.DISCOVERY]);
    expect(services[1]?.["meta-data"]).toEqual([{ $: { "android:name": plugin.SENDER, "tools:node": "remove" } }]);
  });

  it("the names are Google's own (transport-backend-cct 3.1.0's manifest, read 2026-11-17)", () => {
    expect(plugin.DISCOVERY).toBe("com.google.android.datatransport.runtime.backends.TransportBackendDiscovery");
    expect(plugin.SENDER).toBe("backend:com.google.android.datatransport.cct.CctBackendFactory");
  });
});
