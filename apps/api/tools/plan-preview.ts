// Prints the plan numbers for one person, straight from the pure calculator.
// There is no screen for this yet (ROADMAP Stage 1 item 3a); this is how the
// maths is looked at until item 4a builds the screens.
//
//   corepack pnpm --filter api exec tsx tools/plan-preview.ts
//   corepack pnpm --filter api exec tsx tools/plan-preview.ts --goal=lose --weight=82 --target=75 --pace=steady
//   corepack pnpm --filter api exec tsx tools/plan-preview.ts --pregnant=yes --heart=no --bp=no --diabetes=no
//
// The health screen counts as answered only when all four of --pregnant, --heart,
// --bp and --diabetes are given (yes/no); otherwise it is unanswered, as it is
// for a person who has not reached that screen. Every flag is a fact the screens
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

const pregnant = yesNo("pregnant");
const heart = yesNo("heart");
const bloodPressure = yesNo("bp");
const diabetes = yesNo("diabetes");
const healthArgs = [pregnant, heart, bloodPressure, diabetes];
const answered = healthArgs.filter((v) => v !== undefined).length;
if (answered !== 0 && answered !== 4) {
  throw new Error("the health screen is answered all at once: give all four of --pregnant --heart --bp --diabetes, or none");
}
const health =
  pregnant !== undefined && heart !== undefined && bloodPressure !== undefined && diabetes !== undefined
    ? { pregnant, heart, bloodPressure, diabetes }
    : undefined;

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
