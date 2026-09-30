// Puts our rupee gym plans into Razorpay and records each Razorpay plan's id on its plan
// (ROADMAP Stage 3 item 1d-i). Run once per Razorpay account after the seed, and again
// after a price changes. Razorpay's plans cannot be changed or deleted, so a plan whose
// Razorpay plan no longer matches is reported, never silently re-pointed; a Razorpay plan
// made by an earlier run whose id was never recorded is found by its note and reused.
//
//   $env:DATABASE_URL='…'; $env:RAZORPAY_KEY_ID='…'; $env:RAZORPAY_KEY_SECRET='…'; corepack pnpm --filter api exec tsx tools/razorpay-plans.ts
//
// Keys are never printed.
import postgres from "postgres";
import { z } from "zod";
import { createRazorpayApi } from "../src/modules/billing/razorpay.js";
import { razorpayPlans, setRazorpayPlanId } from "../src/modules/billing/repo.js";

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    RAZORPAY_KEY_ID: z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]{14}$/),
    RAZORPAY_KEY_SECRET: z.string().regex(/^[A-Za-z0-9]{20,40}$/),
  })
  .safeParse(process.env);
if (!env.success) {
  console.error("Needs DATABASE_URL, RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. (secrets never printed)");
  process.exit(1);
}

const razorpay = createRazorpayApi({ keyId: env.data.RAZORPAY_KEY_ID, keySecret: env.data.RAZORPAY_KEY_SECRET });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 1 });
let problems = 0;

type Plan = Awaited<ReturnType<typeof razorpayPlans>>[number];
const nameOf = (plan: Plan) => `Monthly, ${plan.seatCap === null ? "any number of members" : `up to ${plan.seatCap.toLocaleString("en-US")} members`}`;
const matches = (plan: Plan, p: { period: string; interval: number; item: { amount: number; currency: string; active: boolean } }) =>
  p.period === "monthly" && p.interval === 1 && p.item.amount === plan.priceMinor && p.item.currency === plan.currency && p.item.active;

try {
  const plans = await razorpayPlans(sql);
  // Every plan already on the account, to find one an earlier run made but did not record.
  const existing = [];
  for (let skip = 0; ; skip += 100) {
    const page = await razorpay.listPlans(skip);
    if (page.kind !== "ok") {
      console.error(`Razorpay's plans could not be listed (${page.kind}).`);
      process.exit(1);
    }
    existing.push(...page.value);
    if (page.value.length < 100) break;
  }

  for (const plan of plans) {
    if (plan.razorpayPlanId !== null) {
      const found = await razorpay.getPlan(plan.razorpayPlanId);
      if (found.kind !== "ok") {
        console.error(`${plan.code}: its Razorpay plan could not be read (${found.kind}).`);
        problems += 1;
      } else if (matches(plan, found.value)) console.log(`${plan.code}: matches ${found.value.id}.`);
      else {
        console.error(`${plan.code}: Razorpay's plan ${found.value.id} does not match the plan. Clear the plan's razorpay_plan_id and run this again: a new Razorpay plan is made, and gyms already paying stay on the old one.`);
        problems += 1;
      }
      continue;
    }
    const earlier = existing.find((p) => p.notes["plan_code"] === plan.code && matches(plan, p));
    if (earlier !== undefined) {
      await setRazorpayPlanId(sql, plan.code, earlier.id);
      console.log(`${plan.code}: recorded ${earlier.id}, made earlier.`);
      continue;
    }
    const created = await razorpay.createPlan({
      name: nameOf(plan),
      description: plan.code,
      amountMinor: plan.priceMinor,
      currency: plan.currency,
      notes: { plan_code: plan.code },
    });
    if (created.kind !== "ok" || !matches(plan, created.value)) {
      console.error(`${plan.code}: Razorpay did not create the plan as asked (${created.kind}).`);
      problems += 1;
      continue;
    }
    await setRazorpayPlanId(sql, plan.code, created.value.id);
    console.log(`${plan.code}: created ${created.value.id}.`);
  }
} finally {
  await sql.end();
}
if (problems > 0) {
  console.error(`${String(problems)} plan(s) need attention.`);
  process.exitCode = 1;
}
