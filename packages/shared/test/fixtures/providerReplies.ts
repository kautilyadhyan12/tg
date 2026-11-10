// Replies in the providers' documented shapes (Paddle API v1, Razorpay v1, Square 2025, Resend webhooks),
// with the extra fields the providers send and the app does not name.
const at = "2024-04-12T10:18:47.635628Z";
const pri = "pri_01gsz8x8sawmvhz1pv30nge1ke", pro = "pro_01gsz4t5hdjse780zja8vvr7jg", ctm = "ctm_01hv6y1jedq4p1n0yqn5ba3ky4";
const sub = "sub_01hv8x29kz0t586xy6zn1a62ny", txn = "txn_01hv8wptq8987qeep44cyrewp9";
const price = {
  id: pri, product_id: pro, type: "standard", description: "Monthly", name: "Monthly", tax_mode: "account_setting",
  billing_cycle: { frequency: 1, interval: "month" }, trial_period: null, unit_price: { amount: "1500", currency_code: "USD" },
  unit_price_overrides: [], custom_data: { plan: "zz_mid" }, status: "active", quantity: { minimum: 1, maximum: 1 },
  import_meta: null, created_at: at, updated_at: at,
};
const subscription = {
  id: sub, status: "active", customer_id: ctm, address_id: "add_01hv8gq3318ktkfengj2r75gfx", business_id: null,
  currency_code: "USD", created_at: at, updated_at: at, started_at: at, first_billed_at: at, next_billed_at: "2024-05-12T10:18:47.635628Z",
  paused_at: null, canceled_at: null, discount: null, collection_mode: "automatic", billing_details: null,
  current_billing_period: { starts_at: at, ends_at: "2024-05-12T10:18:47.635628Z" }, billing_cycle: { frequency: 1, interval: "month" },
  scheduled_change: null, custom_data: { gymId: "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c" }, import_meta: null,
  items: [{ status: "active", quantity: 1, recurring: true, created_at: at, updated_at: at, previously_billed_at: at, next_billed_at: at, trial_dates: null, price, product: { id: pro, name: "Gym", status: "active" } }],
};
const subscriptionScheduled = { ...subscription, scheduled_change: { action: "cancel", effective_at: "2024-05-12T10:18:47.635628Z", resume_at: null }, discount: { id: "dsc_01gtgztp8fpchantd5g1wrksa3", starts_at: at, ends_at: null } };
const transaction = {
  id: txn, status: "completed", customer_id: ctm, address_id: null, business_id: null, custom_data: null, origin: "subscription_recurring",
  collection_mode: "automatic", subscription_id: sub, invoice_id: "inv_01hv8x2ah5ptq8ap6y3m2pjtng", invoice_number: "325-10566",
  billing_details: null, billing_period: { starts_at: at, ends_at: at }, currency_code: "USD", discount_id: null,
  created_at: at, updated_at: at, billed_at: at,
  items: [{ price, quantity: 1, proration: null }],
  details: { tax_rates_used: [], totals: { subtotal: "1500", tax: "0", discount: "0", total: "1500", grand_total: "1500", fee: "125", earnings: "1375", currency_code: "USD" }, line_items: [] },
  payments: [], checkout: { url: "https://kwazo.app/pay?_ptxn=txn_01hv8wptq8987qeep44cyrewp9" }, adjustments: [{ action: "refund", status: "approved", id: "adj_01hvgf2s84dr6reszzg29zbvcm" }],
};
const rzpPlan = { id: "plan_00000000000001", entity: "plan", interval: 1, period: "monthly", item: { id: "item_00000000000001", active: true, name: "Gym", description: null, amount: 129900, unit_amount: 129900, currency: "INR", type: "plan" }, notes: [], created_at: 1580219935 };
const rzpSub = {
  id: "sub_00000000000001", entity: "subscription", plan_id: "plan_00000000000001", customer_id: "cust_D0000000000001", status: "active",
  current_start: 1580284732, current_end: 1582963200, ended_at: null, quantity: 1, notes: { gymId: "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c" },
  charge_at: 1582963200, start_at: 1580284732, end_at: 1611081000, auth_attempts: 0, total_count: 12, paid_count: 1,
  customer_notify: true, created_at: 1580283807, expire_by: 1580626740, short_url: "https://rzp.io/i/z3b1R61A9", has_scheduled_changes: false,
  change_scheduled_at: null, source: "api", payment_method: "card", offer_id: null, remaining_count: 11,
};
const rzpInvoice = {
  id: "inv_00000000000001", entity: "invoice", receipt: null, invoice_number: null, customer_id: "cust_D0000000000001", order_id: "order_00000000000001",
  subscription_id: "sub_00000000000001", line_items: [], payment_id: "pay_00000000000001", status: "paid", expire_by: null, issued_at: 1593344888,
  paid_at: 1593344889, cancelled_at: null, expired_at: null, sms_status: null, email_status: null, date: 1593344888, terms: null,
  partial_payment: false, gross_amount: 129900, tax_amount: 0, taxable_amount: 0, amount: 129900, amount_paid: 129900, amount_due: 0,
  currency: "INR", currency_symbol: "₹", description: null, notes: [], comment: null, short_url: "https://rzp.io/i/Ys4feGqEp", view_less: true,
  billing_start: 1594405800, billing_end: 1597084200, type: "invoice", group_taxes_discounts: false, created_at: 1593344888, idempotency_key: null,
};
const rzpPayment = { id: "pay_00000000000001", entity: "payment", amount: 129900, currency: "INR", status: "captured", order_id: null, invoice_id: null, international: false, method: "card", amount_refunded: 0, refund_status: null, captured: true, description: null, card_id: null, bank: null, wallet: null, vpa: null, email: "a@b.in", contact: "+919999999999", notes: [], fee: 2600, tax: 400, error_code: null, created_at: 1593344889 };
const squarePayment = {
  id: "R2B3Z8WMVt3EAmzYWLZvz7Y69EbZY", created_at: "2021-10-13T21:14:29.577Z", updated_at: "2021-10-13T21:14:30.504Z",
  amount_money: { amount: 1000, currency: "USD" }, status: "COMPLETED", delay_duration: "PT168H", source_type: "CARD",
  card_details: { status: "CAPTURED", card: { card_brand: "MASTERCARD", last_4: "9029", exp_month: 11, exp_year: 2022, fingerprint: "sq-1-x", card_type: "CREDIT", prepaid_type: "NOT_PREPAID", bin: "540988" }, entry_method: "KEYED", cvv_status: "CVV_ACCEPTED", avs_status: "AVS_ACCEPTED", statement_description: "SQ *DEFAULT TEST ACCOUNT", card_payment_timeline: { authorized_at: "2021-10-13T21:14:29.732Z", captured_at: "2021-10-13T21:14:30.504Z" } },
  location_id: "L88917AVBK2S5", order_id: "pRsjRTgFWATl7so6DxdKBJa7ssbZY", risk_evaluation: { created_at: "2021-10-13T21:14:30.423Z", risk_level: "NORMAL" },
  total_money: { amount: 1000, currency: "USD" }, approved_money: { amount: 1000, currency: "USD" }, receipt_number: "R2B3", receipt_url: "https://squareup.com/receipt/preview/R2B3", delay_action: "CANCEL", delayed_until: "2021-10-20T21:14:29.577Z", application_details: { square_product: "ECOMMERCE_API", application_id: "sq0ids-TcgftTEtKxJTRF1lCFJ9TA" }, version_token: "test-card-fingerprint",
};
export const PROVIDER_REPLIES = {
  paddleSubscriptionSchema: [subscription, subscriptionScheduled, { ...subscription, status: "canceled", canceled_at: at, next_billed_at: null, current_billing_period: null }],
  paddleTransactionSchema: [transaction, { ...transaction, status: "ready", billed_at: null, details: { totals: null }, adjustments: undefined }],
  paddlePriceSchema: [price],
  paddleCustomerSchema: [{ id: ctm, name: "Sam Rivera", email: "sam.rivera+paddle@gmail.com", marketing_consent: false, status: "active", custom_data: null, locale: "en", created_at: at, updated_at: at, import_meta: null }],
  paddleWebhookBodySchema: [{ event_id: "evt_01hv8x2acma2gz9y6kfvrxm6dx", event_type: "subscription.created", occurred_at: "2024-04-12T10:18:49.621022Z", notification_id: "ntf_01hv8x2af8etxb1a2wxc8ewhp6", data: subscription }],
  paddlePortalSessionSchema: [{ id: "cpls_01h4ge9r64c22exjsx0fy8b48b", customer_id: ctm, urls: { general: { overview: "https://customer-portal.paddle.com/cpl_01j7zbyqs3vah3aafp4jf62qaw?action=overview&token=pga_x" }, subscriptions: [{ id: sub, cancel_subscription: "https://customer-portal.paddle.com/cpl_01j7zbyqs3vah3aafp4jf62qaw?action=cancel_subscription&subscription_id=sub_01hv8x29kz0t586xy6zn1a62ny&token=pga_x", update_subscription_payment_method: "https://customer-portal.paddle.com/cpl_01j7zbyqs3vah3aafp4jf62qaw?action=update_subscription_payment_method&subscription_id=sub_01hv8x29kz0t586xy6zn1a62ny&token=pga_x" }] }, created_at: "2024-10-25T06:53:58.370Z" }],
  razorpayPlanSchema: [rzpPlan, { ...rzpPlan, notes: { code: "zz_mid" } }],
  razorpaySubscriptionSchema: [rzpSub, { ...rzpSub, status: "created", current_start: null, current_end: null, notes: [], customer_id: null, plan: rzpPlan }],
  razorpayInvoiceSchema: [rzpInvoice, { ...rzpInvoice, status: "issued", payment_id: null, paid_at: null, amount_paid: 0, amount_due: 129900 }],
  razorpayPaymentSchema: [rzpPayment],
  razorpayWebhookBodySchema: [{ entity: "event", account_id: "acc_BFQ7uQEaa7j2z7", event: "subscription.charged", contains: ["subscription", "payment"], payload: { subscription: { entity: rzpSub }, payment: { entity: rzpPayment } }, created_at: 1593344889 }, { entity: "event", event: "invoice.paid", payload: { invoice: { entity: rzpInvoice } } }],
  squarePaymentAnswerSchema: [{ payment: squarePayment }],
  squareMerchantSchema: [{ merchant: { id: "DM7VKY8Q63GNP", business_name: "Apple A Day", country: "US", language_code: "en-US", currency: "USD", status: "ACTIVE", main_location_id: "9A65CGC72ZJ8M", created_at: "2021-12-10T19:25:52.484Z" } }],
  squareTokenSchema: [{ access_token: "EAAA-test-access-token", token_type: "bearer", expires_at: "2026-12-10T19:21:06Z", merchant_id: "MLT2F9W1PPWQ7", refresh_token: "EQAA-test-refresh-token", short_lived: false }],
  squareWebhookBodySchema: [{ merchant_id: "6SSW7HV8K2ST5", type: "dispute.created", event_id: "a1b2c3d4-1234-5678-9abc-def012345678", created_at: "2020-02-06T21:27:34.308Z", data: { type: "dispute", id: "ka9c3uKkUtNfdb7N8QJ8yDYAkqOZY", object: { dispute: { id: "ka9c3uKkUtNfdb7N8QJ8yDYAkqOZY", amount_money: { amount: 1000, currency: "USD" }, reason: "NO_KNOWLEDGE", state: "EVIDENCE_REQUIRED" } } } }],
  resendWebhookBodySchema: [
    { type: "email.bounced", created_at: "2024-11-22T23:41:12.126Z", data: { broadcast_id: "8b146471-e88e-4322-86af-016cd36fd216", created_at: "2024-11-22T23:41:11.894719+00:00", email_id: "56761188-7520-42d8-8898-ff6fc54ce618", from: "KWAZO <invites@mail.kwazo.app>", to: ["member@gmail.com"], subject: "You're invited", bounce: { message: "The recipient's email address is on the suppression list.", subType: "Suppressed", type: "Permanent" }, tags: { invite_send: "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c" } } },
    { type: "email.complained", created_at: "2024-11-22T23:41:12.126Z", data: { created_at: "2024-11-22T23:41:11.894719+00:00", email_id: "56761188-7520-42d8-8898-ff6fc54ce618", from: "a@b.co", to: ["m@gmail.com"], subject: "s", tags: [{ name: "invite_send", value: "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c" }] } },
  ],
};
