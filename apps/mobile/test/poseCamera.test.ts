import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { STORE, storeConfig } from "../app.config";
import { MODELS } from "../../../packages/movement/scripts/phoneRun";

// The camera screen's camera (ROADMAP Stage 5 53a), modules/pose-camera: this app's own Android code, in the store's app.
// The worst thing it could do to a person is keep or send their video or their body's points (Kd, 2026-10-18: "NOTHING
// SHOULD BE ONLINE ... EXCEPT THE END RESULT"). GitHub never builds the app, so its source is read here: it writes no file,
// opens nothing on the internet, records nothing, and logs no point; and the store's app takes away the pose library's
// own sender of usage reports.

const mobile = join(__dirname, "..");
const MODULE = join(mobile, "modules", "pose-camera", "android");
const text = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function filesUnder(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const sources = filesUnder(join(MODULE, "src")).filter((p) => /\.(kt|java)$/.test(p));
const code = sources.map(text).join("\n");
const view = text(join(MODULE, "src", "main", "java", "expo", "modules", "posecamera", "PoseCameraView.kt"));
const gradle = text(join(MODULE, "build.gradle"));

describe("the worst thing first: the camera keeps and sends nothing of a person (53a)", () => {
  it("its code is these files, and only these", () => {
    expect(sources.map((p) => relative(MODULE, p).replace(/\\/g, "/")).sort()).toEqual([
      "src/main/java/com/google/mediapipe/tasks/vision/poselandmarker/PoseCameraCores.java",
      "src/main/java/expo/modules/posecamera/PoseCameraModule.kt",
      "src/main/java/expo/modules/posecamera/PoseCameraView.kt",
    ]);
  });

  it("no file is written, no picture is made into one, nothing is recorded or kept", () => {
    expect(code).not.toMatch(
      /\bFile\(|toFile\(|java\.io|java\.nio\.file|kotlin\.io|FileOutputStream|FileWriter|RandomAccessFile|openFileOutput|\.compress\(|MediaStore|MediaRecorder|VideoCapture|ImageCapture|Recorder\b|writeBytes|writeText|appendText|appendBytes|printWriter|outputStream\(|bufferedWriter|SharedPreferences|DataStore|SQLite|filesDir|cacheDir|externalCache|getExternal|contentResolver|ContentResolver|ParcelFileDescriptor/i,
    );
    // Its one read is the model the build put in the app.
    expect(code.match(/assets\.open\(/g)).toHaveLength(1);
    expect(view).toContain("context.assets.open(MODEL)");
  });

  it("nothing reaches the internet: no address, no socket, no web library", () => {
    expect(code).not.toMatch(/java\.net|okhttp|HttpURLConnection|URLConnection|Socket|Retrofit|Volley|DownloadManager|WebView|HttpEngine|Cronet|https?:\/\//i);
  });

  it("the phone's log is told counts and a failure's kind, never a point", () => {
    // Every way Kotlin or Java can write to the log, however the call is split across lines.
    expect(code).not.toMatch(/\bprintln\(|\bprint\(|System\.(out|err)|printStackTrace|Log\.(wtf|println)\b/);
    expect(code.match(/\bLog\.\w+\s*\(/g)).toHaveLength(3);
    const logs = code.split("\n").filter((l) => /\bLog\.\w+\s*\(/.test(l)).map((l) => l.trim());
    expect(logs).toEqual([
      "if (debuggable) Log.i(TAG, \"frames=${frames ?: \"the camera's own\"}\")",
      'Log.i(TAG, "answers=$a found=$f")',
      'Log.w(TAG, "The $reason stopped: ${e?.javaClass?.simpleName ?: "no picture"}")',
    ]);
    // The counts only while a folder's copy is measured: a debuggable build.
    expect(view).toMatch(/if \(debuggable\) \{\n\s+val \(a, f\)/);
  });

  it("each answer goes to the screen, with the picture it was read from, and nowhere else", () => {
    expect(view.match(/onPose\(/g)).toHaveLength(1);
    expect(view).toContain(
      "if (picture != null) shown.setImageBitmap(picture)\n        body.show(drawn, if (image.height > 0) image.width.toFloat() / image.height else 0f)\n        onPose(event)",
    );
  });

  it("the module asks for no permission of its own: the camera's is the meal photo's", () => {
    expect(text(join(MODULE, "src", "main", "AndroidManifest.xml"))).not.toMatch(/uses-permission|activity|service|receiver|provider/);
  });

  it("the store's app takes away the pose library's sender of usage reports", () => {
    expect(storeConfig({ KWAZO_VERSION_CODE: "7" }, [STORE.applicationId]).plugins).toContain("./plugins/noUsageReports.js");
  });
});

describe("the body drawn by the phone, on the very picture it was read from (Kd at 53a's run: the lines lagging)", () => {
  it("drawn in the same moment as its picture, and on nothing once the camera rests", () => {
    // One message on the screen's thread sets both: they reach the screen in the same frame.
    expect(view).toMatch(/main\.post \{\n\s+if \(closed\) return@post\n[^}]*shown\.setImageBitmap\(picture\)\n\s+body\.show\(drawn/);
    expect(view).toContain("private fun stop() {\n    session?.close()\n    session = null\n    // Paused, or gone: no line is left on a picture the model no longer reads.\n    body.show(null, 0f)");
  });

  it("where the screen shows each point: the picture filling it, mirrored", () => {
    expect(view).toContain("val tall = maxOf(w / aspect, h)");
    expect(view).toContain("xs[k] = w - (left + x * wide)");
    expect(view).toContain("ys[k] = top + y * tall");
    expect(view).toContain("scaleType = ImageView.ScaleType.CENTER_CROP\n    scaleX = -1f");
    // The body lies over its picture, never beside it: Expo's own view lays its children out in a row.
    expect(view).toContain("stack.addView(shown, ");
    expect(view).toContain("stack.addView(body, ");
    expect(view).toContain("addView(stack, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))");
  });

  it("a point drawn only when the model is sure enough of it, and only a real number", () => {
    expect(view).toContain("seen[k] = x.isFinite() && y.isFinite() && p[k * 4 + 2] >= sure && p[k * 4 + 3] >= sure");
  });

  it("the app hands over its rules, words and colours", () => {
    const module = text(join(MODULE, "src", "main", "java", "expo", "modules", "posecamera", "PoseCameraModule.kt"));
    expect(module).toContain('Prop("drawing") { view: PoseCameraView, drawing: BodyDrawing -> view.setDrawing(drawing) }');
  });
});

describe("which way is down: gravity, and how the screen is turned from the phone's own axes (round one)", () => {
  it("each answer says how the screen is turned, the very turn the camera turns its pictures by (re-check N2)", () => {
    expect(view).toContain('"turn" to screenTurn.toDouble(),');
    expect(view).toContain(
      "val rotation = display?.rotation ?: Surface.ROTATION_0\n          screenTurn = rotation * 90\n          val builder = ImageAnalysis.Builder()\n            .setTargetRotation(rotation)",
    );
    // Set in that one place, never read again on its own while the camera runs.
    expect(view.match(/^\s+screenTurn = /gm)).toHaveLength(1);
  });

  it("a gravity reading is timed on the clock it is judged by", () => {
    expect(view).toContain("gravityAt = SystemClock.elapsedRealtimeNanos()");
    expect(view).toContain("SystemClock.elapsedRealtimeNanos() - gravityAt <= GRAVITY_STALE_NS");
  });
});

describe("the camera as the phone test picked it (51b-ii)", () => {
  it("the model reads the picture as the camera took it, upright and never mirrored", () => {
    expect(view).toContain("val turn = proxy.imageInfo.rotationDegrees");
    expect(view).toContain("postRotate(turn.toFloat(), raw.width / 2f, raw.height / 2f)");
    expect(view).not.toMatch(/postScale\(-1/);
    expect(view).toContain("CameraSelector.DEFAULT_FRONT_CAMERA");
  });

  it("one stream, the model's: the screen shows the very picture the model read, at a steady speed no faster than it reads (53a's runs)", () => {
    expect(view).toContain("cameras.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)");
    expect(view).not.toMatch(/PreviewView|Preview\.Builder/);
    expect(view).toContain("private const val FRAMES_MOST = 24");
    expect(view).toContain("?.filter { it.upper in FRAMES_LEAST..FRAMES_MOST }");
    expect(view).toContain("compareByDescending<Range<Int>> { it.lower >= FRAMES_LEAST }");
    expect(view).toContain("Camera2Interop.Extender(builder).setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, it)");
    // Every picture is handed over, as the model's live mode takes them: held back until the one before was answered, the
    // graphics chip answered 11 a second where it can 20. Six turned pictures, so none is drawn over while still read.
    expect(view).not.toMatch(/busySince/);
    expect(view).toContain("private const val TURNED = 6");
  });

  it("the full model, asked for one person, at the sureness every kept file was measured with, on the main chip's 4 cores", () => {
    // The pick the phone proof counts with (phoneCounts.ts CHOSEN_RUN, "cpu.t4"): the graphics chip has no proof row (round one).
    expect(view).not.toMatch(/Delegate\.GPU|Delegate\.NNAPI/);
    expect(view.match(/setDelegate\(/g)).toHaveLength(1);
    expect(view).toContain(".setDelegate(Delegate.CPU)");
    expect(view).toContain('private const val MODEL = "pose_landmarker_full.task"');
    expect(view).toContain(".setNumPoses(1)");
    expect(view).toContain("private const val SURE = 0.5f");
    expect(view).toContain("private const val CORES = 4");
    expect(view).toContain("PoseCameraCores.onCores(options, minOf(CORES, Runtime.getRuntime().availableProcessors()))");
    expect(view).toContain("RunningMode.LIVE_STREAM");
    const cores = text(join(MODULE, "src", "main", "java", "com", "google", "mediapipe", "tasks", "vision", "poselandmarker", "PoseCameraCores.java"));
    expect(cores).toContain("if (!base.getAcceleration().hasTflite()) throw");
    expect(cores.match(/setAcceleration\(/g)).toHaveLength(1);
  });

  it("the build fetches the very model the laptop measured with, and refuses any other", () => {
    const full = MODELS.find((m) => m.size === "full");
    expect(full).toBeDefined();
    expect(gradle).toContain(`file: '${String(full?.name)}.task'`);
    expect(gradle).toContain(`bytes: ${String(full?.bytes)}L`);
    expect(gradle).toContain(`sha256: '${String(full?.sha256)}'`);
    expect(gradle).toContain(`url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/${String(full?.name)}/float16/1/${String(full?.name)}.task'`);
    expect(gradle).toContain("if (!wholeModel(part))");
  });

  it("Google's pose library is the phone test's version, and the camera library and React Native the app's own", () => {
    const testGradle = text(join(mobile, "modules", "phone-test", "android", "build.gradle"));
    const tasks = /tasks-vision:([0-9.]+)"/.exec(testGradle)?.[1];
    expect(tasks).toBeDefined();
    const camera = text(join(mobile, "node_modules", "expo-camera", "android", "build.gradle"));
    const camerax = /def camerax_version = "([0-9.]+)"/.exec(camera)?.[1];
    expect(camerax).toBeDefined();
    expect(gradle.split("\n").filter((l) => /^\s*(implementation|api|debugImplementation) /.test(l)).map((l) => l.trim())).toEqual([
      `implementation "com.google.mediapipe:tasks-vision:${String(tasks)}"`,
      `implementation "androidx.camera:camera-core:${String(camerax)}"`,
      `implementation "androidx.camera:camera-camera2:${String(camerax)}"`,
      `implementation "androidx.camera:camera-lifecycle:${String(camerax)}"`,
      "implementation 'com.facebook.react:react-android'",
    ]);
  });
});
