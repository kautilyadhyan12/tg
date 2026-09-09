// Prints the plan numbers for one person, straight from the pure calculator.
// There is no screen for this yet (ROADMAP Stage 1 item 3a); this is how the
// maths is looked at until item 4a builds the screens.
//
//   corepack pnpm --filter api exec tsx tools/plan-preview.ts
//   corepack pnpm --filter api exec tsx tools/plan-preview.ts --goal=lose --weight=82 --target=75 --pace=steady
//   corepack pnpm --filter api exec tsx tools/plan-preview.ts --condition=yes --check=not_yet
//
// The health screen is ONE question (--condition=yes/no); a yes takes --check=
// cleared or not_yet. Without --condition it is unanswered, as it is for a
// person who has not reached that screen. Every flag is a fact the screens
// will later say in plain words.
import { planAnswersSchema } from "@app/shared";
import { resolvePlan } from "../src/modules/plan/maths.js";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
function num(name: string): number | undefined {
  const raw = arg(name);
  return raw === undefined ? undefined : Number(raw);
}
function yesNo(name: string): boolean | undefined {
  const raw = arg(name);
  if (raw === undefined) return undefined;
  if (raw === "yes" || raw === "true" || raw === "1") return true;
  if (raw === "no" || raw === "false" || raw === "0") return false;
  throw new Error(`--${name} must be yes or no, got "${raw}"`);
}

const hasCondition = yesNo("condition");
const check = arg("check");
if (hasCondition === true && check !== "cleared" && check !== "not_yet") {
  throw new Error("a yes needs --check=cleared or --check=not_yet");
}
if (hasCondition !== true && check !== undefined) {
  throw new Error("--check only goes with --condition=yes");
}
const health = hasCondition === undefined ? undefined : { hasCondition, safeMode: check === "not_yet" };

const answers = planAnswersSchema.parse({
  goal: arg("goal") ?? "lose",
  age: num("age") ?? 30,
  gender: arg("gender") ?? "male",
  heightCm: num("height") ?? 175,
  weightKg: num("weight") ?? 82,
  targetWeightKg: num("target") ?? 75,
  pace: arg("pace") ?? "steady",
  dayActivity: arg("day") ?? "sitting",
  trainingDays: num("days") ?? 3,
  sessionMinutes: num("minutes") ?? 45,
  ...(health === undefined ? {} : { health }),
  today: arg("today") ?? "2026-09-08",
});

process.stdout.write(`${JSON.stringify({ answers, result: resolvePlan(answers) }, null, 2)}\n`);
