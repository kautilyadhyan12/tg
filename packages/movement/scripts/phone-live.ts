// The live camera test (ROADMAP Stage 5 item 51b-ii): which model and chip hold the phone's own selfie camera for 20
// minutes, off the charger.
//   corepack pnpm --filter @app/movement phone-live [--collect | --report-only] [--videos <folder>]
// It needs this folder's copy of the app on the phone on the USB cable (corepack pnpm --filter mobile phone), and the
// phone standing facing the laptop's screen. It sends the plan and the models, lets the copy use the camera, and opens
// its live screen. The laptop's screen shows one picture of a person standing while the phone reads a still body
// through the back camera and then the selfie camera (it is turned round for that), then plays Kd's one-person videos
// in a loop, full screen, for the phone's camera, while the laptop is kept awake. The phone is unplugged; it runs each
// set-up of the ladder for 20 minutes, cooling between them, and is plugged in again when it beeps three times. The
// laptop then takes its files back, checks each, deletes everything it sent, takes the camera back if it gave it, and
// judges (phoneLive.ts). Stopped (Ctrl-C) on the cable, it does the same at once; stopped off it, or if the phone comes
// back late, `--collect` takes back and cleans whatever an earlier run left, and a new run does that first by itself.
// --report-only judges the files already taken back. Nobody exercises and nobody is filmed: the phone reads the
// laptop's screen, and no picture is ever written. Everything is in measured/phone-live/, which git ignores; older
// results are kept in phone/previous/.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { phoneLiveProgressSchema, type PhoneLiveProgress } from "@app/shared";
import { KD_VIDEOS, assertFolderStaysOutOfGit } from "./outFolder.js";
import { adb, appIdOf, fetchModel } from "./phoneAdb.js";
import { LADDER, LIVE, STILL, judgeFiles, liveFiles, makeLivePlan, readLiveFailure, readLiveRun, stepWords, type StepFiles } from "./phoneLive.js";

const REPO = resolve(import.meta.dirname, "../../..");
const MOBILE = join(REPO, "apps", "mobile");
const HERE = join(REPO, "measured", "phone-live");
const PHONE_OUT = join(HERE, "phone");
/** What the laptop changed on the phone, written before it changes it, so a stopped run can be put right (round one,
 *  H3): the copy, and whether it had the camera before. */
const STATE = join(HERE, "phone-state.json");
/** What the laptop's screen showed and when, so a run that lost the body can be read against it (round one, L12). */
const SCREEN_LOG = join(HERE, "screen.log");
/** The models 51a fetched and checked, shared with phone-test. */
const MODELS_HERE = join(REPO, "measured", "phone-test", "models");
const ON_PHONE = "files/phone-live";
/** As in phone-test: only Kd's public reference material and Google's models pass through the shell's folder. */
const STAGING = "/data/local/tmp/kwazo-phone-live";
const ACTIVITY = "expo.modules.phonetest.PhoneTestLiveActivity";
/** Kd's videos with one person in them, played in a loop for the camera. */
const LOOP = ["squat_reference", "chair_squat_reference", "bicep_curl_reference", "bicycle_crunch_reference"];
/** The longest the laptop waits for the phone to come back: three runs, two coolings at their longest, and an hour. */
const LONGEST_MS = (LADDER.length * LIVE.minutes + (LADDER.length - 1) * LIVE.cool.most + 60) * 60_000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (ms: number): string => new Date(ms).toTimeString().slice(0, 5);

const { values } = (() => {
  try {
    return parseArgs({ options: { "report-only": { type: "boolean", default: false }, collect: { type: "boolean", default: false }, videos: { type: "string", default: KD_VIDEOS } } });
  } catch (err) {
    fail(`${messageOf(err)}\nUsage: phone-live [--collect | --report-only] [--videos <folder>]`);
  }
})();
if (values["report-only"] && values.collect) fail("--report-only and --collect do not go together.");

try {
  assertFolderStaysOutOfGit(HERE);
} catch (err) {
  fail(messageOf(err));
}
mkdirSync(PHONE_OUT, { recursive: true });
mkdirSync(MODELS_HERE, { recursive: true });
const PLAN = join(HERE, "plan.json");
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const screenSays = (line: string): void => {
  appendFileSync(SCREEN_LOG, `${new Date().toISOString()} ${line}\n`);
};

function videoOf(label: string): string {
  const folder = values.videos;
  const found = existsSync(folder)
    ? readdirSync(folder, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
        .map((d) => join(folder, d.name, `${label}.mp4`))
        .find((p) => existsSync(p))
    : undefined;
  return found ?? fail(`No video named ${label}.mp4 in ${folder}.`);
}

// ── The laptop's screen, and keeping the laptop awake ─────────────────────────────
const children = new Set<ChildProcess>();
function child(command: string, args: string[]): ChildProcess {
  const c = spawn(command, args, { stdio: "ignore" });
  children.add(c);
  c.on("exit", () => children.delete(c));
  return c;
}

/** Windows' own "this program needs the screen": the display and the laptop stay on while it runs. */
function keepAwake(): ChildProcess {
  const script =
    "$t = Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint e);' -Name Awake -Namespace KwazoPhoneLive -PassThru; " +
    "while ($true) { [void]$t::SetThreadExecutionState(0x80000003); Start-Sleep -Seconds 30 }";
  return child("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

/** One picture of a person standing, full screen, for the still body. */
function showStill(): ChildProcess {
  const still = join(HERE, "still.png");
  if (!existsSync(still)) {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", "0.5", "-i", videoOf("squat_reference"), "-frames:v", "1", still], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`ffmpeg could not take the still picture: ${r.stderr.trim()}`);
  }
  screenSays("the still picture");
  return child("ffplay", ["-fs", "-loglevel", "error", "-window_title", "Live camera test", still]);
}

/** Kd's one-person videos, full screen, one after another, until stopped; each start and end written to the screen's
 *  log. */
function playLoop(): { stop: () => void } {
  let stopped = false;
  let now: ChildProcess | null = null;
  const paths = LOOP.map(videoOf);
  const next = (k: number): void => {
    if (stopped) return;
    const label = LOOP[k % LOOP.length] ?? "";
    screenSays(`plays ${label}`);
    now = child("ffplay", ["-fs", "-autoexit", "-an", "-loglevel", "error", "-window_title", "Live camera test", paths[k % paths.length] ?? ""]);
    now.on("exit", (code) => {
      if (code !== 0 && !stopped) screenSays(`${label} ended with code ${String(code)}`);
      next(k + 1);
    });
  };
  next(0);
  return {
    stop: () => {
      stopped = true;
      now?.kill();
      screenSays("the videos stopped");
    },
  };
}

function stopChildren(): void {
  for (const c of children) c.kill();
}

// ── The phone ────────────────────────────────────────────────────────────────────
const onCable = (): boolean => adb(["get-state"]).text === "device";
const inApp = (id: string, command: string) => adb(["shell", `run-as ${id} ${command}`]);

function progressOn(id: string): PhoneLiveProgress | null {
  const read = adb(["exec-out", "run-as", id, "cat", `${ON_PHONE}/progress.json`]);
  if (!read.ok) return null;
  try {
    const parsed = phoneLiveProgressSchema.safeParse(JSON.parse(read.out.toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Whether Android has given this copy the camera (a person may have, for the meal photo). */
function cameraGranted(id: string): boolean {
  return /android\.permission\.CAMERA: granted=true/.test(adb(["shell", "dumpsys", "package", id]).text);
}

/** This folder's copy, on the phone and open to the laptop. */
function theCopy(): string {
  if (!onCable()) fail("No phone on the USB cable. Plug it in with USB debugging on, and allow this computer on the phone.");
  let id: string;
  try {
    id = appIdOf(MOBILE);
  } catch (err) {
    fail(messageOf(err));
  }
  if (!adb(["shell", "pm", "list", "packages", id]).text.split(/\s+/).includes(`package:${id}`)) fail(`This folder's copy (${id}) is not on the phone. Run: corepack pnpm --filter mobile phone`);
  if (!inApp(id, "true").ok) fail(`The phone will not let the laptop into ${id}: it must be a folder's copy, built for testing.`);
  return id;
}

/** The results already here go to phone/previous/<time>/, never deleted (round one, L7). */
function keepPrevious(): void {
  const old = liveFiles(readdirSync(PHONE_OUT));
  if (old.length === 0) return;
  const folder = join(PHONE_OUT, "previous", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(folder, { recursive: true });
  for (const name of old) renameSync(join(PHONE_OUT, name), join(folder, name));
  if (existsSync(PLAN)) renameSync(PLAN, join(folder, "plan.json"));
  console.log(`Kept ${String(old.length)} earlier files in ${folder}.`);
}

/**
 * Takes every result file the phone holds back, each checked against the phone's own file check (round one, L8), and
 * only then cleans the phone: the test's files, the shell's folder, the app stopped, and the camera taken back when the
 * copy did not have it before. A file that does not come back whole leaves the phone as it is.
 */
function collect(id: string): void {
  // Taken back only when the laptop wrote, before giving it, that the copy did not have it: unknown is left as it is.
  const state: unknown = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null;
  const hadCamera = !(typeof state === "object" && state !== null && "hadCamera" in state && state.hadCamera === false);
  const names = liveFiles(inApp(id, `ls ${ON_PHONE}/out`).text.split(/\s+/));
  for (const name of names) {
    const file = adb(["exec-out", "run-as", id, "cat", `${ON_PHONE}/out/${name}`]);
    const onPhone = inApp(id, `sha256sum ${ON_PHONE}/out/${name}`).text.split(/\s+/)[0];
    if (!file.ok || onPhone !== sha256(new Uint8Array(file.out))) throw new Error(`${name} did not come back whole: the phone keeps it. Run phone-live --collect again.`);
    writeFileSync(join(PHONE_OUT, name), file.out);
  }
  if (names.length > 0) console.log(`Took ${String(names.length)} files back from the phone, each checked.`);
  inApp(id, `rm -rf ${ON_PHONE}`);
  adb(["shell", `rm -rf ${STAGING}`]);
  adb(["shell", "am", "force-stop", id]);
  if (!hadCamera) adb(["shell", "pm", "revoke", id, "android.permission.CAMERA"]);
  const left = inApp(id, "ls files").text.split(/\s+/).includes("phone-live") || adb(["shell", `ls -d ${STAGING}`]).ok;
  console.log(left ? "THE TEST'S FILES ARE STILL ON THE PHONE." : "The phone holds none of the test's files now.");
  if (!hadCamera) console.log(cameraGranted(id) ? "THE COPY STILL HAS THE CAMERA." : "The copy no longer has the camera; it did not have it before the test.");
  if (!left && !(!hadCamera && cameraGranted(id))) rmSync(STATE, { force: true });
}

/** Whether an earlier run left anything on the phone or unput right. */
function leftOver(id: string): boolean {
  return existsSync(STATE) || inApp(id, `ls ${ON_PHONE}`).ok;
}

async function onThePhone(id: string): Promise<void> {
  const models = [...new Set(LADDER.map((s) => s.model))];
  const paths = new Map<string, string>();
  for (const m of models) paths.set(m.name, await fetchModel(m, MODELS_HERE));
  keepPrevious();
  writeFileSync(PLAN, JSON.stringify(makeLivePlan()));
  writeFileSync(STATE, JSON.stringify({ copy: id, hadCamera: cameraGranted(id) }));

  let still: ChildProcess | null = null;
  let loop: { stop: () => void } | null = null;
  keepAwake();
  adb(["shell", "am", "force-stop", id]);
  if (!cameraGranted(id) && !adb(["shell", "pm", "grant", id, "android.permission.CAMERA"]).ok) throw new Error("The phone would not let this copy use the camera.");
  inApp(id, `rm -rf ${ON_PHONE}`);
  if (!inApp(id, `mkdir -p ${ON_PHONE}/models`).ok) throw new Error("The phone would not make the test's folder.");
  adb(["shell", `rm -rf ${STAGING}`]);
  if (!adb(["shell", `mkdir -p ${STAGING}`]).ok) throw new Error("The phone would not make the laptop's folder.");
  const send = (local: string, path: string, what: string): void => {
    const name = basename(path);
    if (!adb(["push", local, `${STAGING}/${name}`]).ok) throw new Error(`${what} did not reach the phone.`);
    if (!inApp(id, `cp ${STAGING}/${name} ${path}`).ok) throw new Error(`${what} could not go into the app's own files.`);
    adb(["shell", `rm -f ${STAGING}/${name}`]);
    if (inApp(id, `sha256sum ${path}`).text.split(/\s+/)[0] !== sha256(new Uint8Array(readFileSync(local)))) throw new Error(`${what} did not arrive whole.`);
  };
  for (const m of models) {
    console.log(`Sending the ${m.size} model to the phone.`);
    send(paths.get(m.name) ?? "", `${ON_PHONE}/models/${m.name}.task`, `The ${m.size} model`);
  }
  send(PLAN, `${ON_PHONE}/plan.json`, "The plan");

  still = showStill();
  const opened = adb(["shell", "am", "start", "-W", "-n", `${id}/${ACTIVITY}`]);
  if (!opened.ok || /Error|Exception/i.test(opened.text)) throw new Error(`The live screen did not open on the phone:\n${opened.text}`);
  console.log("The live screen is open on the phone. The laptop's screen shows a person standing.");

  // On the cable: the still body, then the word to unplug.
  let said = "";
  let progress: PhoneLiveProgress | null = null;
  const opening = Date.now();
  for (;;) {
    await sleep(3000);
    // Before the phone has said to unplug, a missing cable is a blip of adb's.
    if (!onCable()) {
      if (loop !== null) break;
      if (Date.now() - opening > 45 * 60_000) throw new Error("The phone left the cable before the still body was done.");
      continue;
    }
    if (Date.now() - opening > 45 * 60_000 && loop === null) throw new Error("The still body took longer than 45 minutes. Look at the phone's screen.");
    progress = progressOn(id);
    if (progress === null) continue;
    const now = `${progress.stage} ${String(progress.step)}`;
    if (now !== said) {
      said = now;
      if (progress.stage === "still" && progress.step === 1) console.log("   POINT THE PHONE'S BACK CAMERA at the laptop's screen: it reads the still body.");
      if (progress.stage === "turn") console.log("   TURN THE PHONE ROUND, its screen to the laptop's screen: the selfie camera reads the still body.");
      if (progress.stage === "unplug" && loop === null) {
        still.kill();
        loop = playLoop();
        await sleep(2000);
        inApp(id, `touch ${ON_PHONE}/laptop-ready`);
        console.log("   The videos are playing. When the phone beeps twice, UNPLUG ITS CABLE and leave it facing the laptop's screen.");
      }
    }
    if (progress.stage === "failed" || progress.stage === "done") break;
  }

  if (progress?.stage !== "failed") {
    const unplugged = Date.now();
    const least = LIVE.settleSeconds * 1000 + (LADDER.length * LIVE.minutes + (LADDER.length - 1) * LIVE.cool.least) * 60_000;
    const most = LIVE.settleSeconds * 1000 + (LADDER.length * LIVE.minutes + (LADDER.length - 1) * LIVE.cool.most) * 60_000;
    console.log(`Unplugged at ${clock(unplugged)}. The runs end between ${clock(unplugged + least)} and ${clock(unplugged + most)}; the phone then beeps three times to be plugged in.`);
    // Off the cable: wait for it to come back, and for its runs to end.
    for (;;) {
      await sleep(20_000);
      if (Date.now() - unplugged > LONGEST_MS) throw new Error("The phone has not come back for longer than the runs can take. Look at its screen; when it is back, run phone-live --collect.");
      if (!onCable()) continue;
      progress = progressOn(id);
      if (progress === null) continue;
      if (progress.stage === "done" || progress.stage === "failed") break;
      const now = `${progress.stage} ${String(progress.step)} ${String(Math.floor(progress.second / 60))}`;
      if (now !== said) {
        said = now;
        console.log(`   Back on the cable before the end (step ${String(progress.step)} of ${String(progress.steps)}, ${progress.stage}): UNPLUG IT AGAIN. A run the cable goes into is dropped and started again once it is out.`);
      }
    }
  }
  if (progress.stage === "failed") console.log(`The phone stopped: ${progress.reason ?? "it gave no reason"}`);
}

// ── The judgement and the report ─────────────────────────────────────────────────
function stepFiles(name: string): StepFiles {
  const path = join(PHONE_OUT, `${name}.jsonl`);
  const note = join(PHONE_OUT, `${name}.failed.json`);
  return {
    run: existsSync(path) ? readLiveRun(readFileSync(path, "utf8")) : null,
    failed: existsSync(note) ? readLiveFailure(readFileSync(note, "utf8")).reason : null,
  };
}

function report(): void {
  if (!existsSync(PLAN)) fail(`No plan in ${HERE}: the test has not been run.`);
  const live = LADDER.map((_, k) => stepFiles(`live.${String(k)}`));
  const r = judgeFiles(readFileSync(PLAN, "utf8"), live, STILL.map((camera) => stepFiles(`still.${camera}`)));

  const lines: string[] = ["# The live camera test (51b-ii)", ""];
  const header = live.find((f) => f.run !== null)?.run?.header;
  if (header !== undefined) {
    const p = header.phone;
    lines.push(`Phone: ${p.maker} ${p.model}, Android ${p.android}. Selfie camera, asked for one person, ${String(header.picture.width)} by ${String(header.picture.height)} pictures.`, "");
  }
  for (const j of r.judged) {
    const step = LADDER[j.step];
    if (step === undefined) continue;
    lines.push(`## Run ${String(j.step + 1)}: ${stepWords(step)} — ${j.verdict.toUpperCase()}`);
    for (const reason of j.reasons) lines.push(`- ${reason}`);
    if (j.minutes.length > 0) {
      const used = j.batteryUsed === null ? "unknown" : `${String(j.batteryUsed)}%`;
      lines.push(
        `- cores busy ${j.coresBusy === null ? "unknown" : j.coresBusy.toFixed(2)}; battery used ${used}; hottest: thermal ${String(j.hottest?.thermal ?? "?")}, battery ${String(j.hottest?.batteryC ?? "?")} °C; the app's memory at most ${j.appMbMost === null ? "?" : j.appMbMost.toFixed(0)} MB`,
        "",
        "| minute | answers a second | slowest second | camera's pictures a second | body found | wait, middle / longest ms | cores busy | thermal | battery °C | battery % | app MB | free MB |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
      );
      for (const m of j.minutes) {
        const e = m.end;
        lines.push(
          `| ${String(m.m)} | ${m.rate.toFixed(1)} | ${m.lowest.toFixed(0)} | ${m.cameraRate.toFixed(1)} | ${String(Math.round(m.found * 100))}% | ${String(m.waitMiddle ?? "-")} / ${String(m.waitMost ?? "-")} | ${m.coresBusy.toFixed(2)} | ${String(e?.heat.thermal ?? "?")} | ${String(e?.heat.batteryC ?? "?")} | ${String(e?.battery.percent ?? "?")} | ${e === null ? "?" : e.memory.appMb.toFixed(0)} | ${e === null ? "?" : e.memory.freeMb.toFixed(0)} |`,
        );
      }
    }
    lines.push("");
  }
  lines.push("## The pick");
  const pick = r.pick;
  if (pick.kind === "picked") {
    const step = LADDER[pick.step];
    const above = pick.step === 0 ? "" : ", every one above it having fallen short in a fair run";
    lines.push(`${step === undefined ? "?" : stepWords(step)}: the first set-up on the ladder that held ${String(LIVE.rate)} answers a second in every one of the ${String(LIVE.minutes)} minutes${above}.`);
  } else if (pick.kind === "run again") lines.push(`Nothing is picked: run ${String(pick.step + 1)} was not fair (${pick.reasons.join("; ")}), and a set-up above any that held is run again first.`);
  else lines.push(`None of the ${String(LADDER.length)} held. The ladder's next step, lite on the graphics chip, is next to try.`);
  lines.push("", "## A still body (from the laptop's screen, not a person in the room)");
  for (const s of r.stills) {
    if (typeof s === "string") lines.push(`- ${s}`);
    else lines.push(`- the ${s.camera} camera: ${s.rate.toFixed(1)} answers a second, the body in ${String(s.found)} of ${String(s.answers)}; shake ${s.flat === null ? "not read" : `${s.flat.toFixed(4)} of the body's size on the picture, ${(s.worldMm ?? 0).toFixed(1)} mm in 3D`}`);
  }
  const text = `${lines.join("\n")}\n`;
  writeFileSync(join(HERE, "report.txt"), text);
  writeFileSync(join(HERE, "report.json"), JSON.stringify(r, null, 1));
  console.log(`\n${text}`);
}

// ── What runs ────────────────────────────────────────────────────────────────────
if (!values["report-only"]) {
  const id = theCopy();
  // Stopped here (Ctrl-C, the window closed): the screen and the keep-awake stop, and the phone, if it is on the cable,
  // gives back what it has and is cleaned.
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    stopChildren();
    try {
      if (onCable()) collect(id);
      else console.log("THE PHONE IS NOT ON THE CABLE: plug it in and run phone-live --collect.");
    } catch (err) {
      console.error(messageOf(err));
    }
    process.exit(130);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  if (values.collect || leftOver(id)) {
    if (!values.collect) console.log("An earlier run left files on the phone: taking them back and cleaning it first. Run phone-live again for a new test.");
    try {
      collect(id);
    } catch (err) {
      fail(messageOf(err));
    }
  } else {
    try {
      await onThePhone(id);
    } catch (err) {
      console.error(messageOf(err));
    } finally {
      stopChildren();
      try {
        if (onCable()) collect(id);
        else console.log("THE PHONE IS NOT ON THE CABLE: the test's files are still on it. Plug it in and run phone-live --collect.");
      } catch (err) {
        console.error(messageOf(err));
      }
    }
  }
}
try {
  report();
} catch (err) {
  fail(messageOf(err));
}
