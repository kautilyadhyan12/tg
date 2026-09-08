// Prints the plan numbers for one person, straight from the pure calculator.
// There is no screen for this yet (ROADMAP Stage 1 item 3a); this is how the
// maths is looked at until item 4a builds the screens.
//
//   corepack pnpm --filter api exec tsx tools/plan-preview.ts
//   corepack pnpm --filter api exec tsx tools/plan-preview.ts --goal=lose --weight=82 --target=75 --pace=steady
//
// Every flag is a fact the screens will later say in plain words.
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
function yes(name: string): boolean {
  return arg(name) === "yes";
}

const health =
  arg("health") === "unanswered"
    ? undefined
    : { pregnant: yes("pregnant"), heart: yes("heart"), bloodPressure: yes("bp"), diabetes: yes("diabetes") };

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
