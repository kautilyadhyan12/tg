// The phone feels whether it is moving (ROADMAP Stage 5 item 37i): the number the phone keeps for each second of a
// run (modules/run-motion: the standard deviation over the second of the acceleration's size, gravity included,
// in m/s², over every reading of the second), worked out the same way from public recordings of real people
// standing, sitting, walking, on stairs and jogging, and from a run on Kd's phone. It prints each person's lowest,
// middle and highest number for each activity, then sets the two limits leaving one person out in turn.
//
// The recordings are not in git (their licences are in the handoff, 37i). Each is read from the folder given:
//   node apps/mobile/tools/run-motion-measure.mjs <data folder> [phone motion files ...]
// <data folder> holds any of:
//   motionsense/A_DeviceMotion_data/<act>_<trial>/sub_<n>.csv   (MotionSense, iPhone 6s in a front trouser pocket,
//                                                                50 Hz, gravity + user acceleration in g)
//   wisdm/wisdm-dataset/raw/phone/accel/data_<id>_accel_phone.txt  (WISDM 2019, Nexus 5/5X or Galaxy S5 in a
//                                                                pocket, 20 Hz, m/s²)
//   hapt/RawData/acc_exp<e>_user<u>.txt + labels.txt            (UCI HAPT, Galaxy S II on the waist, 50 Hz, g)
// A phone motion file is what the app keeps, `run-now-motion-<n>.json` ([ms into the run, sd × 100]); with it,
// `--phone-marks <file>` names a JSON list of [fromS, toS, "activity"] for that run.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const G = 9.80665;
/** As the phone: a second with fewer readings than this is not known. */
const LEAST_READINGS = 10;

/** The standard deviation of the sizes, over all of them (as the phone works it out). */
function sdOf(sizes) {
  const n = sizes.length;
  const mean = sizes.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(Math.max(0, sizes.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n));
}

/** Samples at `rate` a second, read every `step`th (50 Hz read every 2nd is the phone's 25), in seconds. */
function secondsOfEvenSamples(sizes, rate, step) {
  const per = rate / step;
  const out = [];
  const kept = sizes.filter((_, i) => i % step === 0);
  for (let i = 0; i + per <= kept.length; i += per) out.push(sdOf(kept.slice(i, i + per)));
  return out;
}

/** person -> activity -> list of stretches, each a list of seconds in a row. */
const people = new Map();
function add(person, activity, seconds) {
  if (seconds.length === 0) return;
  if (!people.has(person)) people.set(person, new Map());
  const acts = people.get(person);
  if (!acts.has(activity)) acts.set(activity, []);
  acts.get(activity).push(seconds);
}

const ACTS = { walk: "walking", jog: "jogging", stairs: "stairs", stand: "standing", sit: "sitting", lie: "lying", typing: "typing (phone in a pocket)" };

function readMotionSense(dir) {
  const root = join(dir, "motionsense", "A_DeviceMotion_data");
  if (!existsSync(root)) return 0;
  const map = { wlk: "walk", jog: "jog", ups: "stairs", dws: "stairs", std: "stand", sit: "sit" };
  let count = 0;
  for (const trial of readdirSync(root)) {
    const activity = map[trial.split("_")[0]];
    if (activity === undefined) continue;
    for (const file of readdirSync(join(root, trial))) {
      const sub = /^sub_(\d+)\.csv$/.exec(file)?.[1];
      if (sub === undefined) continue;
      const lines = readFileSync(join(root, trial, file), "utf8").trim().split(/\r?\n/);
      const head = lines[0].split(",");
      const col = (name) => head.indexOf(name);
      const [gx, gy, gz, ux, uy, uz] = ["gravity.x", "gravity.y", "gravity.z", "userAcceleration.x", "userAcceleration.y", "userAcceleration.z"].map(col);
      const sizes = [];
      for (const line of lines.slice(1)) {
        const v = line.split(",").map(Number);
        const x = (v[gx] + v[ux]) * G;
        const y = (v[gy] + v[uy]) * G;
        const z = (v[gz] + v[uz]) * G;
        sizes.push(Math.hypot(x, y, z));
      }
      // The first and last 2 s: the phone being put in and taken out of the pocket.
      add(`MotionSense ${sub}`, activity, secondsOfEvenSamples(sizes, 50, 2).slice(2, -2));
      count += 1;
    }
  }
  return count;
}

function readWisdm(dir) {
  const root = join(dir, "wisdm", "wisdm-dataset", "raw", "phone", "accel");
  if (!existsSync(root)) return 0;
  const map = { A: "walk", B: "jog", C: "stairs", D: "sit", E: "stand", F: "typing" };
  let count = 0;
  for (const file of readdirSync(root)) {
    const id = /^data_(\d+)_accel_phone\.txt$/.exec(file)?.[1];
    if (id === undefined) continue;
    count += 1;
    // Each activity's readings, by their own clock (ns): a stretch ends at a change of activity or a gap over 2 s.
    let stretch = null;
    const flush = () => {
      if (stretch === null) return;
      const activity = map[stretch.code];
      if (activity !== undefined) {
        const bySecond = new Map();
        for (const [t, s] of stretch.samples) {
          const k = Math.floor((t - stretch.from) / 1e9);
          if (!bySecond.has(k)) bySecond.set(k, []);
          bySecond.get(k).push(s);
        }
        const last = Math.max(...bySecond.keys());
        // A second the phone did not report breaks the row, as on the phone.
        let row = [];
        for (let k = 2; k <= last - 2; k++) {
          const sizes = bySecond.get(k);
          if (sizes === undefined || sizes.length < LEAST_READINGS) {
            add(`WISDM ${id}`, activity, row);
            row = [];
          } else row.push(sdOf(sizes));
        }
        add(`WISDM ${id}`, activity, row);
      }
      stretch = null;
    };
    for (const line of readFileSync(join(root, file), "utf8").split(/\r?\n/)) {
      const m = /^(\d+),([A-S]),(-?\d+),([-\d.eE]+),([-\d.eE]+),([-\d.eE]+);?$/.exec(line.trim());
      if (m === null) continue;
      const [, , code, ts, x, y, z] = m;
      const t = Number(ts);
      const size = Math.hypot(Number(x), Number(y), Number(z));
      if (stretch !== null && (stretch.code !== code || t - stretch.last > 2e9 || t < stretch.last)) flush();
      stretch ??= { code, from: t, last: t, samples: [] };
      stretch.samples.push([t, size]);
      stretch.last = t;
    }
    flush();
  }
  return count;
}

function readHapt(dir) {
  const root = join(dir, "hapt", "RawData");
  if (!existsSync(join(root, "labels.txt"))) return 0;
  const map = { 1: "walk", 2: "stairs", 3: "stairs", 4: "sit", 5: "stand", 6: "lie" };
  const labels = readFileSync(join(root, "labels.txt"), "utf8").trim().split(/\r?\n/).map((l) => l.trim().split(/\s+/).map(Number));
  const files = new Map();
  let count = 0;
  for (const [exp, user, act, from, to] of labels) {
    const activity = map[act];
    if (activity === undefined) continue;
    const name = `acc_exp${String(exp).padStart(2, "0")}_user${String(user).padStart(2, "0")}.txt`;
    if (!files.has(name)) {
      files.set(name, readFileSync(join(root, name), "utf8").trim().split(/\r?\n/).map((l) => Math.hypot(...l.trim().split(/\s+/).map(Number)) * G));
      count += 1;
    }
    // Labels count readings from 1; the first and last second of each are left out.
    const sizes = files.get(name).slice(from - 1 + 50, to - 50);
    add(`HAPT ${user}`, activity, secondsOfEvenSamples(sizes, 50, 2));
  }
  return count;
}

function readPhone(paths, marksFile) {
  const kept = paths.flatMap((p) => JSON.parse(readFileSync(p, "utf8")));
  kept.sort((a, b) => a[0] - b[0]);
  const marks = JSON.parse(readFileSync(marksFile, "utf8"));
  for (const [fromS, toS, activity] of marks) {
    let row = [];
    let lastS = null;
    for (const [ms, sd100] of kept) {
      const s = ms / 1000;
      if (s <= fromS || s > toS) continue;
      if (lastS !== null && s - lastS > 1.5) {
        add("Kd's phone", activity, row);
        row = [];
      }
      row.push(sd100 / 100);
      lastS = s;
    }
    add("Kd's phone", activity, row);
  }
  // How many of the run's seconds have a number.
  const first = kept[0]?.[0] ?? 0;
  const last = kept[kept.length - 1]?.[0] ?? 0;
  return { seconds: kept.length, span: Math.round((last - first) / 1000) + 1 };
}

// ── What is printed ─────────────────────────────────────────────────────────────────────────────

const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i];
};
const f = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");
const allOf = (person, activity) => (people.get(person)?.get(activity) ?? []).flat();
const ON_FOOT = ["walk", "jog", "stairs"];

/** The lowest, over every 4 seconds in a row on foot, of the highest of the 4: under it, 4 in a row read still. */
function lowestFourHigh(person) {
  let low = Infinity;
  for (const activity of ON_FOOT) {
    for (const row of people.get(person)?.get(activity) ?? []) {
      for (let i = 0; i + 4 <= row.length; i++) low = Math.min(low, Math.max(...row.slice(i, i + 4)));
    }
  }
  return low;
}

/** How many times 3 standing seconds in a row all read above `limit`. */
function threeAbove(person, limit) {
  let n = 0;
  for (const row of people.get(person)?.get("stand") ?? []) for (let i = 0; i + 3 <= row.length; i++) if (row.slice(i, i + 3).every((x) => x > limit)) n += 1;
  return n;
}

/** The limits, set from these people alone: written down before any person is left out, never moved after.
 *  Still: the geometric middle between the highest of the people's 95th percentiles standing, and the lowest
 *  4-in-a-row high on foot (what (a) guards). Moving: the geometric middle between the highest of the people's
 *  99th percentiles standing and the lowest of their 5th percentiles on foot, never under the still limit. */
function limitsFrom(group) {
  const standHigh95 = Math.max(...group.filter((p) => allOf(p, "stand").length > 0).map((p) => quantile(allOf(p, "stand"), 0.95)));
  const standHigh99 = Math.max(...group.filter((p) => allOf(p, "stand").length > 0).map((p) => quantile(allOf(p, "stand"), 0.99)));
  const footLow4 = Math.min(...group.map(lowestFourHigh).filter(Number.isFinite));
  const footLow05 = Math.min(...group.filter((p) => ON_FOOT.some((a) => allOf(p, a).length > 0)).map((p) => quantile(ON_FOOT.flatMap((a) => allOf(p, a)), 0.05)));
  const still = Math.sqrt(standHigh95 * footLow4);
  const moving = Math.max(still, Math.sqrt(standHigh99 * footLow05));
  return { still, moving, standHigh95, standHigh99, footLow4, footLow05 };
}

const dir = process.argv[2];
if (dir === undefined) {
  console.error("node run-motion-measure.mjs <data folder> [run-now-motion-*.json ...] [--phone-marks marks.json]");
  process.exit(1);
}
const rest = process.argv.slice(3);
const marksAt = rest.indexOf("--phone-marks");
const phoneFiles = marksAt === -1 ? rest : rest.slice(0, marksAt);
const counted = { motionSense: readMotionSense(dir), wisdm: readWisdm(dir), hapt: readHapt(dir) };
const phone = phoneFiles.length > 0 && marksAt !== -1 ? readPhone(phoneFiles, rest[marksAt + 1]) : null;
console.log(`files read: MotionSense ${String(counted.motionSense)}, WISDM ${String(counted.wisdm)}, HAPT ${String(counted.hapt)}${phone === null ? "" : `, Kd's phone ${String(phone.seconds)} seconds with a number of ${String(phone.span)}`}`);

const activities = Object.keys(ACTS).filter((a) => [...people.values()].some((acts) => acts.has(a)));
console.log("\n## Each person: lowest / middle / highest sd (m/s²), seconds\n");
console.log(`| person | ${activities.map((a) => ACTS[a]).join(" | ")} |`);
console.log(`|---|${activities.map(() => "---").join("|")}|`);
const names = [...people.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
for (const p of names) {
  console.log(`| ${p} | ${activities.map((a) => { const xs = allOf(p, a); return xs.length === 0 ? "" : `${f(Math.min(...xs))} / ${f(quantile(xs, 0.5))} / ${f(Math.max(...xs))} (${String(xs.length)})`; }).join(" | ")} |`);
}
console.log("\n## All people together: 1st / 5th / 50th / 95th / 99th percentile\n");
for (const a of activities) {
  const xs = names.flatMap((p) => allOf(p, a));
  console.log(`- ${ACTS[a]}: ${[0.01, 0.05, 0.5, 0.95, 0.99].map((q) => f(quantile(xs, q))).join(" / ")} (${String(xs.length)} seconds, ${String(names.filter((p) => allOf(p, a).length > 0).length)} people)`);
}

// The recordings of people, left out one at a time (Kd's phone is never used to set them: it is tested on).
const recorded = names.filter((p) => p !== "Kd's phone");
const all = limitsFrom(recorded);
console.log(`\n## The limits from every person: FEEL_STILL_BELOW ${f(all.still)}, FEEL_MOVING_ABOVE ${f(all.moving)}`);
console.log(`   (standing 95th, highest person ${f(all.standHigh95)}; 99th ${f(all.standHigh99)}; on foot 4-in-a-row low ${f(all.footLow4)}; 5th, lowest person ${f(all.footLow05)})`);
console.log("\n## Each person left out: the limits from the others, tested on them\n");
console.log("| left out | still below | moving above | (a) 4 on foot in a row all still | (b) standing read still | walking read moving | standing 3 in a row read moving |");
console.log("|---|---|---|---|---|---|---|");
let failsA = 0;
let failsB = 0;
for (const p of [...recorded, ...(people.has("Kd's phone") ? ["Kd's phone"] : [])]) {
  const lim = p === "Kd's phone" ? all : limitsFrom(recorded.filter((q) => q !== p));
  const four = lowestFourHigh(p);
  const aFails = Number.isFinite(four) && four < lim.still;
  const stand = allOf(p, "stand");
  const standStill = stand.length === 0 ? NaN : stand.filter((x) => x < lim.still).length / stand.length;
  const foot = ON_FOOT.flatMap((a) => allOf(p, a));
  const footMoving = foot.length === 0 ? NaN : foot.filter((x) => x > lim.moving).length / foot.length;
  if (aFails) failsA += 1;
  if (standStill < 0.9) failsB += 1;
  const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "–");
  console.log(`| ${p} | ${f(lim.still)} | ${f(lim.moving)} | ${aFails ? `**yes** (low ${f(four)})` : `never (low ${f(four)})`} | ${pct(standStill)} | ${pct(footMoving)} | ${String(threeAbove(p, lim.moving))} |`);
}
console.log(`\n(a) failed for ${String(failsA)} people; (b) under 9 in 10 for ${String(failsB)} people.`);

// Where (b) failed: the standing seconds over the still limit, in their rows.
console.log("\n## Standing read still under 9 seconds in 10: the seconds over the limit\n");
for (const p of recorded) {
  const lim = limitsFrom(recorded.filter((q) => q !== p));
  const stand = allOf(p, "stand");
  if (stand.length === 0 || stand.filter((x) => x < lim.still).length / stand.length >= 0.9) continue;
  for (const row of people.get(p)?.get("stand") ?? []) {
    const over = row.map((x, i) => [i, x]).filter(([, x]) => x >= lim.still);
    console.log(`- ${p}, ${String(over.length)} of ${String(row.length)} over ${f(lim.still)}, at seconds ${over.map(([i, x]) => `${String(i)} (${f(x)})`).join(", ")}`);
  }
}

// Where (a) failed: the activity, the place in its recording, and the seconds around it.
console.log("\n## Where 4 seconds on foot in a row read still (limits from the others)\n");
for (const p of recorded) {
  const lim = limitsFrom(recorded.filter((q) => q !== p));
  for (const activity of ON_FOOT) {
    for (const row of people.get(p)?.get(activity) ?? []) {
      for (let i = 0; i + 4 <= row.length; i++) {
        if (Math.max(...row.slice(i, i + 4)) >= lim.still) continue;
        let end = i + 4;
        while (end < row.length && row[end] < lim.still) end += 1;
        console.log(`- ${p}, ${ACTS[activity]}, seconds ${String(i)} to ${String(end - 1)} of ${String(row.length)} (under ${f(lim.still)}): ${row.slice(Math.max(0, i - 3), end + 3).map(f).join(" ")}`);
        i = end;
      }
    }
  }
}
