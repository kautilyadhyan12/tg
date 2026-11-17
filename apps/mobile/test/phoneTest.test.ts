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

  it("the test's screen opens only from the laptop's cable", () => {
    const manifest = text(join(MODULE, "src", "debug", "AndroidManifest.xml"));
    const activities = manifest.match(/<activity[\s\S]*?\/>/g) ?? [];
    expect(activities).toHaveLength(1);
    expect(activities[0]).toContain('android:name="expo.modules.phonetest.PhoneTestActivity"');
    // Exported for `adb shell am start`, behind a permission Android gives the shell and no installed app.
    expect(activities[0]).toContain('android:exported="true"');
    expect(activities[0]).toContain('android:permission="android.permission.DUMP"');
  });

  it("the test names the library version the app is built with", () => {
    const kotlin = text(join(MODULE, "src", "debug", "java", "expo", "modules", "phonetest", "PhoneTest.kt"));
    const version = /tasks-vision:([0-9.]+)"/.exec(gradle)?.[1];
    expect(version).toBeDefined();
    expect(kotlin).toContain(`internal const val LIBRARY = "tasks-vision ${String(version)}"`);
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
