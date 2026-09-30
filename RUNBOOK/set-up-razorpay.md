# Set up Razorpay for Indian gyms (once per environment)

ROADMAP Stage 3 item 1d-i; migration `0053_razorpay_gym_billing`. An Indian gym pays through
Razorpay. The api needs the account's key, a Razorpay plan recorded on each rupee gym plan,
and Razorpay's webhook for renewals and failed payments.

## Symptoms

- An Indian gym's plans say "There's no way to pay online yet": `RAZORPAY_KEY_ID` or
  `RAZORPAY_KEY_SECRET` is not set.
- Subscribe answers "Paying online isn't available right now" and the api logs
  `billing.price_not_set_up`: a rupee plan has no `razorpay_plan_id`.
- A gym paid, but its renewal or a failed payment never reaches the console: the webhook is
  not set up, or `RAZORPAY_WEBHOOK_SECRET` does not match it (the api answers 401 or 503).

## Steps

1. Set the api's and the worker's `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` (escrow names
   the same). Test keys start `rzp_test_`, live keys `rzp_live_`.
2. After the migrations and the seed, record the Razorpay plans. Razorpay's plans cannot be
   changed or deleted: the tool reuses one it made before and reports any that no longer
   matches our price.

   ```
   DATABASE_URL=<the environment's database> RAZORPAY_KEY_ID=<from escrow> RAZORPAY_KEY_SECRET=<from escrow> corepack pnpm --filter api exec tsx tools/razorpay-plans.ts
   ```

   It prints one line a plan: `created`, `recorded … made earlier`, or `matches`. Run it
   again: every line says `matches`. After a price changes, clear that plan's
   `razorpay_plan_id` and run it again: new gyms get the new Razorpay plan, and gyms already
   paying stay on their old one, and its price, until they subscribe again (the api still
   follows them through the checkout that sold it).
3. In Razorpay's dashboard (the same mode as the key): Account & Settings → Webhooks → Add
   New Webhook. URL `https://<api host>/v1/webhooks/razorpay`; a secret of your own (12 to
   200 visible characters), kept in escrow as `RAZORPAY_WEBHOOK_SECRET` and set on the api;
   events: every `subscription.*` event.

## Verify recovered

- `SELECT code, razorpay_plan_id FROM plans WHERE currency = 'INR' AND active;` has an id on
  every row.
- An Indian gym's plan list says "Prices are a month, with no GST added." and Subscribe opens Razorpay's window.
- UPI for monthly payments is switched on by Razorpay per account (its Subscriptions FAQ calls it early access): ask Razorpay's support, as for Subscriptions, and check that Razorpay's window lists UPI.
- Razorpay's webhook page shows the last deliveries answered 200.
