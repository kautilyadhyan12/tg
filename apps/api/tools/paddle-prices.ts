// Puts our gym plans into Paddle's catalogue and records each price's id on its plan
// (ROADMAP Stage 3 item 1a). Run once per environment after the seed, and again after
// a price changes: a plan whose Paddle price no longer matches is reported, never
// silently re-pointed.
//
//   $env:DATABASE_URL='…'; $env:PADDLE_API_KEY='…'; corepack pnpm --filter api exec tsx tools/paddle-prices.ts
//
// PADDLE_ENV (sandbox by default) must match the key. Keys are never printed.
import postgres from "postgres";
import { z } from "zod";
import { createPaddleApi } from "../src/modules/billing/paddle.js";
import { paddlePlans, setPaddlePriceId } from "../src/modules/billing/repo.js";

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    PADDLE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    PADDLE_API_KEY: z.string().regex(/^pdl_(live|sdbx)_apikey_[a-z\d]{26}_[a-zA-Z\d]{22}_[a-zA-Z\d]{3}$/),
  })
  .refine((e) => e.PADDLE_API_KEY.startsWith(e.PADDLE_ENV === "sandbox" ? "pdl_sdbx_" : "pdl_live_"))
  .safeParse(process.env);
if (!env.success) {
  console.error("Needs DATABASE_URL, and PADDLE_API_KEY for PADDLE_ENV (sandbox by default). (secrets never printed)");
  process.exit(1);
}

const paddle = createPaddleApi({ apiKey: env.data.PADDLE_API_KEY, environment: env.data.PADDLE_ENV });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 1 });
let problems = 0;
try {
  const plans = await paddlePlans(sql);
  let productId: string | null = null;
  // Reuse the product the existing prices hang off, so a re-run makes no second one.
  for (const plan of plans) {
    if (plan.paddlePriceId === null) continue;
    const price = await paddle.getPrice(plan.paddlePriceId);
    if (price.kind === "ok") {
      productId = price.value.product_id;
      break;
    }
  }
  for (const plan of plans) {
    const members = plan.seatCap === null ? "any number of members" : `up to ${plan.seatCap.toLocaleString("en-US")} members`;
    if (plan.paddlePriceId !== null) {
      const price = await paddle.getPrice(plan.paddlePriceId);
      if (price.kind !== "ok") {
        console.error(`${plan.code}: its Paddle price could not be read (${price.kind}).`);
        problems += 1;
        continue;
      }
      const p = price.value;
      const agrees =
        p.status === "active" &&
        p.unit_price.amount === String(plan.priceMinor) &&
        p.unit_price.currency_code === plan.currency &&
        p.billing_cycle?.interval === "month" &&
        p.billing_cycle.frequency === 1 &&
        p.tax_mode === "external" &&
        p.quantity.minimum === 1 &&
        p.quantity.maximum === 1;
      const name = `Monthly, ${members}`;
      if (agrees && p.name !== name) {
        // The name is what Paddle shows at checkout; the amount never changes here.
        const renamed = await paddle.renamePrice(p.id, name);
        if (renamed.kind === "ok") console.log(`${plan.code}: renamed ${p.id} to "${name}".`);
        else {
          console.error(`${plan.code}: could not rename ${p.id} (${renamed.kind}).`);
          problems += 1;
        }
      } else if (agrees) console.log(`${plan.code}: matches ${p.id}.`);
      else {
        console.error(`${plan.code}: Paddle's price ${p.id} does not match the plan. Archive it in Paddle, clear the plan's paddle_price_id, and run this again.`);
        problems += 1;
      }
      continue;
    }
    if (productId === null) {
      const product = await paddle.createProduct({ name: "AI Home Gym for gyms", description: "The gym console and the member app for a gym's members, monthly." });
      if (product.kind !== "ok") {
        console.error(`Could not create the product in Paddle (${product.kind}).`);
        process.exitCode = 1;
        break;
      }
      productId = product.value.id;
      console.log(`Created product ${productId}.`);
    }
    const created = await paddle.createPrice({
      productId,
      description: plan.code,
      name: `Monthly, ${members}`,
      amountMinor: plan.priceMinor,
      currency: plan.currency,
      interval: "month",
      customData: { plan_code: plan.code },
    });
    if (created.kind !== "ok") {
      console.error(`${plan.code}: Paddle did not create the price (${created.kind}).`);
      problems += 1;
      continue;
    }
    await setPaddlePriceId(sql, plan.code, created.value.id);
    console.log(`${plan.code}: created ${created.value.id}.`);
  }
} finally {
  await sql.end();
}
if (problems > 0) {
  console.error(`${String(problems)} plan(s) need attention.`);
  process.exitCode = 1;
}
