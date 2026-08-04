// BROWSER smoke for the two defects unit tests structurally cannot see, run
// against a REAL Chrome with a REAL MediaPipe load and the REAL API.
//
// WHY IT EXISTS. Three T3 rounds in a row found defects that every unit suite
// passed, and each time the reason was the same: the fixtures were kinder than a
// browser. The suite mocks the pose hook, mocks the camera, and runs one
// exercise per test. This drives the actual screens instead.
//
// WHAT IT CAN PROVE: that a graded exercise FOLLOWING an ungraded one is still
// handed to the camera — badge "AI form check", no "+1 Rep" button. That is the
// user-visible signature of round 3's F1, and it needs no human in frame.
//
// WHAT IT CANNOT PROVE: that the camera counts real squats and produces a real
// form score. Chrome's fake device shows a rolling pattern, not a person, so no
// pose is detected and no reps are counted. That check still needs Kd.
//
// ⚠️ THIS SCRIPT CANNOT RUN YET, and saying so is the point of this paragraph.
// `playwright` is NOT a dependency of this repo — verified, not assumed:
// `require.resolve('playwright')` → MODULE_NOT_FOUND, and `grep -c playwright
// pnpm-lock.yaml` → 0. (`npx playwright --version` answers from a global npx
// cache, which is what misled the chat that wrote this into telling Kd the run
// was about to happen.) Adding it is a NEW DEPENDENCY and needs Kd's approval
// under R1.4 — it also downloads browser binaries. Until then this file is a
// prepared plan, not a result, and nothing in it may be cited as evidence.
//
// Run it (once approved):
//   pnpm --filter web add -D playwright && npx playwright install chromium
//   node apps/web/tools/browser-smoke-two-exercises.mjs
// Needs the three local servers up (rig :8000 healthy, api :3000, web :5173).
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const WEB = "http://localhost:5173";
const API = "http://localhost:3000";
const RIG = "http://localhost:8000";

const stamp = Date.now();
const USER = {
  email: `browser-smoke-${stamp}@example.com`,
  // GENERATED, never written down. A literal here would be a credential in the
  // repo for gitleaks to trip over, and there is no reason for one: this account
  // is created, used once and never signed into again.
  password: `Smoke!${randomUUID()}`,
  displayName: "Browser Smoke",
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? ` :: ${detail}` : ""}`);
};

async function main() {
  // The rig boots in `dead`; a workout cannot be STARTED without it, because
  // PreWorkout creates its session through the old backend.
  const rigState = await fetch(`${RIG}/__state/healthy`).then((r) => r.text()).catch(() => null);
  if (rigState == null) throw new Error("the mock old backend is not running on :8000");

  const browser = await chromium.launch({
    channel: "chrome",
    args: [
      "--use-fake-ui-for-media-stream",     // auto-accept the permission prompt
      "--use-fake-device-for-media-stream", // a synthetic camera, no hardware
    ],
  });
  const context = await browser.newContext({ permissions: ["camera"] });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  // ── Sign in ────────────────────────────────────────────────────────────────
  // Through fetch on the app's own origin, so the httpOnly cookies land exactly
  // as they would from the login form, without scripting form fields.
  await page.goto(`${WEB}/login`);
  const userId = await page.evaluate(async ({ api, user }) => {
    const post = (path, body) =>
      fetch(api + path, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    await post("/v1/auth/register", user);
    await post("/v1/auth/login", { email: user.email, password: user.password });
    const me = await fetch(api + "/v1/auth/me", { credentials: "include" });
    const body = await me.json();
    return body?.user?.id ?? body?.id ?? null;
  }, { api: API, user: USER });

  check("signed in and got a user id", typeof userId === "string" && userId.length > 0, String(userId));
  if (!userId) { await browser.close(); return report(); }

  // ── Seed the workout: an UNGRADED exercise, then a GRADED one ──────────────
  // The builder screen is skipped deliberately — it writes this key and nothing
  // else, and the defects live on the two screens after it.
  await page.evaluate(({ id }) => {
    localStorage.setItem(`user_${id}_workout_builder`, JSON.stringify([
      { id: "e1", name: "Push-ups", sets: 1, reps: 2, rest: 10 },
      { id: "e2", name: "Squats",   sets: 1, reps: 2, rest: 10 },
    ]));
  }, { id: userId });

  // ── Pre-workout: the camera path ───────────────────────────────────────────
  await page.goto(`${WEB}/workout/pre`);
  await page.getByText("Use the camera").click().catch(() => {});
  for (const item of ["Room is well lit", "2m from camera", "Full body visible"]) {
    await page.getByText(item).click().catch(() => {});
  }
  const startBtn = page.getByRole("button", { name: /Start Workout|Complete checklist/ });
  await startBtn.waitFor({ timeout: 20000 });
  // The fourth item ticks itself once a stream arrives — that is the camera
  // actually opening, which is the part a unit test never does.
  await page.waitForFunction(
    () => !!document.querySelector("button")
      && [...document.querySelectorAll("button")].some((b) => /Start Workout/.test(b.textContent)),
    { timeout: 30000 },
  ).catch(() => {});
  const startText = (await startBtn.textContent()) ?? "";
  check("the camera opened and the checklist completed", /Start Workout/.test(startText), startText.trim());
  await startBtn.click();

  // ── Exercise 1: press-ups, which the engine cannot grade ───────────────────
  await page.waitForURL(/workout\/active/, { timeout: 20000 });
  const repButton = page.getByRole("button", { name: "+1 Rep" });
  await repButton.waitFor({ timeout: 30000 });
  check("press-ups offer hand counting (no definition)", true);

  await repButton.click();
  await repButton.click();                       // hits the target, ends the set

  // ── Exercise 2: squats. THE CHECK THIS SCRIPT EXISTS FOR ───────────────────
  const skipRest = page.getByRole("button", { name: /Skip Rest/ });
  await skipRest.waitFor({ timeout: 20000 }).catch(() => {});
  if (await skipRest.isVisible().catch(() => false)) await skipRest.click();

  await page.waitForFunction(
    () => /Squat/i.test(document.body.innerText),
    { timeout: 20000 },
  ).catch(() => {});
  // Give MediaPipe the same grace the screen gives it before deciding.
  await page.waitForTimeout(7000);

  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasRepButton = await page.getByRole("button", { name: "+1 Rep" }).isVisible().catch(() => false);
  const badge = /AI form check/.test(bodyText) ? "AI form check"
    : /Camera not counting/.test(bodyText) ? "Camera not counting"
    : /Counting yourself/.test(bodyText) ? "Counting yourself"
    : /Log-only/.test(bodyText) ? "Log-only" : "(none found)";

  check(
    "SQUATS AFTER PRESS-UPS are handed to the camera, not to hand counting",
    badge === "AI form check" && !hasRepButton,
    `badge=${badge} repButton=${hasRepButton}`,
  );

  if (consoleErrors.length) {
    console.log("\nconsole errors seen (informational):");
    for (const e of consoleErrors.slice(0, 6)) console.log("  ·", e.slice(0, 200));
  }

  await browser.close();
  report();
}

function report() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length} checks · ${failed.length} failed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("SMOKE ABORTED:", err.message);
  process.exitCode = 1;
});
