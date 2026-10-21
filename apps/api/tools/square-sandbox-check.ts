// Runs our calls to Square against Square's real test area (ROADMAP 18d-i; CLAUDE.md §6:
// "reviewed by RUNNING the company's real sandbox"). Prints what Square answered, never a
// token, code or secret.
//
// With no gym named it checks the doors: a code Square never issued, a token it never
// issued and a revoke of one are each refused, in the shapes the adapter reads. Naming a
// gym whose owner pressed Allow in the console, it asks Square about that gym's connection
// (the token works, for that account; the business; its locations), then renews it through
// the worker's own path, as the worker would six days on, and checks the new token works.
// With `--cards` it then saves a card on a customer made for the check alone (18d-ii), with
// Square's own test tokens: the card saved, the same press giving it back, read, stopped twice;
// and what Square answers each of its failing test tokens, in the words the console shows.
// With `--terminals` it makes a Square Terminal code at the gym's location and reads it back
// (18d-ii-b-i); no Terminal can sign in with it there, so it runs out after five minutes.
//
//   cd apps/api
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm exec node --env-file=.env.square.local --import tsx tools/square-sandbox-check.ts [gymId] [--cards] [--terminals]
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";
import { cardRefusalOf } from "../src/modules/orgs/payments/cards.js";
import * as repo from "../src/modules/orgs/payments/repo.js";
import { accessContext } from "../src/modules/orgs/payments/service.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import type { SquareApi } from "../src/modules/orgs/payments/square.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    SQUARE_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    SQUARE_APPLICATION_ID: z.string().regex(/^sandbox-sq0idb-[A-Za-z0-9_-]{10,60}$/),
    SQUARE_APPLICATION_SECRET: z.string().regex(/^sandbox-sq0csb-[A-Za-z0-9_-]{10,100}$/),
    PAYMENT_TOKENS_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .refine((e) => e.SQUARE_ENV === "sandbox", { message: "the test area only" })
  .safeParse(process.env);
if (!env.success) {
  console.error("Needs DATABASE_URL, and Square's test-area SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET and PAYMENT_TOKENS_KEY (.env.square.local). Secrets are never printed.");
  process.exit(1);
}

const square = squareSettings({ ...env.data, SQUARE_WEBHOOK_SIGNATURE_KEY: undefined, SQUARE_WEBHOOK_URL: undefined });
if (square === null) throw new Error("Square settings did not load");
const gymId = process.argv[2]?.startsWith("--") === true ? undefined : process.argv[2];
const withCards = process.argv.includes("--cards");
const withTerminals = process.argv.includes("--terminals");
let problems = 0;
const check = (ok: boolean, line: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) problems += 1;
};

const neverIssued = "EAAAnever-issued-0000000000000000000000000000000000000000000000";
const code = await square.api.exchangeCode("sq0cgb-never-issued-000000000000");
check(code.kind === "refused", `a code Square never issued: ${code.kind}${code.kind === "refused" ? ` ${String(code.status)} ${code.code}` : ""}`);
const status = await square.api.tokenStatus(neverIssued);
check(status.kind === "refused" && status.status === 401, `a token Square never issued: ${status.kind}${status.kind === "refused" ? ` ${String(status.status)} ${status.code}` : ""}`);
const revoke = await square.api.revoke(neverIssued, false);
check(revoke.kind === "refused", `a revoke of it: ${revoke.kind}${revoke.kind === "refused" ? ` ${String(revoke.status)} ${revoke.code}` : ""}`);
// The stop tool's own call (`tools/square-stop.ts`), for an account our app was never given: Square
// takes our secret and the account's id and says it has no such account; a wrong secret is 401.
const stopUnknown = await square.api.revokeAccount("MLNEVERCONNECTED00");
check(stopUnknown.kind === "refused" && stopUnknown.status === 404, `the stop tool's call, for an account never connected: ${stopUnknown.kind}${stopUnknown.kind === "refused" ? ` ${String(stopUnknown.status)} ${stopUnknown.code}` : ""}`);
const page = new URL(square.api.authorizeUrl("x"));
check(page.origin === "https://connect.squareupsandbox.com", `Square's own page: ${page.origin}${page.pathname}`);

if (gymId !== undefined) {
  const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });
  try {
    const row = await repo.readConnection(sql, gymId, "sandbox");
    if (row === null || row.state !== "connected" || row.accessToken === null) {
      check(false, "that gym has no Square connection here");
    } else {
      const token = square.tokens.open(row.accessToken, accessContext(gymId));
      check(token !== null, "its token opens under its own gym");
      if (token !== null) {
        const works = await square.api.tokenStatus(token);
        check(works.kind === "ok" && works.value.merchant_id === row.accountId, `its token works, for the account it was kept with: ${works.kind}`);
        const merchant = await square.api.merchant(token);
        check(merchant.kind === "ok", merchant.kind === "ok" ? `the business: ${merchant.value.country}, ${merchant.value.currency}, named ${merchant.value.business_name === undefined ? "nothing" : "as kept"}` : `the business: ${merchant.kind}`);
        const locations = await square.api.locations(token);
        check(locations.kind === "ok", locations.kind === "ok" ? `its locations: ${String(locations.value.length)}, ${String(locations.value.filter((l) => (l.capabilities ?? []).includes("CREDIT_CARD_PROCESSING")).length)} taking cards` : `its locations: ${locations.kind}`);
        if (withCards) await checkCards(square.api, token, row.accountId);
        if (withTerminals && row.locationId !== null) await checkTerminals(square.api, token, row.locationId);
      }
      // Renewed through the worker's own path, as six days on.
      await sql`UPDATE gym_payment_connections SET refresh_due_at = now() - interval '1 second' WHERE gym_id = ${gymId} AND provider = 'square'`;
      const run = await processSquareWork({ sql, square, log: { info: () => undefined, warn: () => undefined, error: (o, m) => {
        console.error(m, o);
      } }, now: () => new Date() }, null, [gymId]);
      const after = await repo.readConnection(sql, gymId, "sandbox");
      check(run.renewed >= 1 && after?.accessToken !== row.accessToken, `renewed by the worker: ${String(run.renewed)} renewed, ${String(run.renewalsWaiting)} waiting, ${String(run.removed)} removed`);
      const renewed = after?.accessToken === null || after === null ? null : square.tokens.open(after.accessToken, accessContext(gymId));
      if (renewed !== null) {
        const works = await square.api.tokenStatus(renewed);
        check(works.kind === "ok", `the renewed token works: ${works.kind}`);
      }
    }
  } finally {
    await sql.end();
  }
}

/** A card saved on a customer made for this check alone, in the gym's own test account. */
async function checkCards(api: SquareApi, token: string, accountId: string): Promise<void> {
  const customer = await api.createCustomer(token, {
    idempotencyKey: randomUUID(),
    givenName: "KWAZO",
    familyName: "Card check",
    email: null,
    phone: null,
    referenceId: randomUUID(),
  });
  check(customer.kind === "ok", `a customer made in the gym's account: ${customer.kind}${customer.kind === "refused" ? ` ${String(customer.status)} ${customer.code}` : ""}`);
  if (customer.kind !== "ok") return;
  const press = randomUUID();
  const saved = await api.createCard(token, { idempotencyKey: press, sourceId: "cnon:card-nonce-ok", customerId: customer.value.id, cardholderName: null });
  check(
    saved.kind === "ok" && saved.value.customer_id === customer.value.id && saved.value.merchant_id === accountId && saved.value.enabled === true && saved.value.last_4 !== undefined,
    saved.kind === "ok"
      ? `a card saved: ${saved.value.card_brand ?? "?"} ending ${saved.value.last_4 ?? "?"}, ${String(saved.value.exp_month)}/${String(saved.value.exp_year)}, on that customer, in that account, ${saved.value.enabled === true ? "enabled" : "not enabled"}`
      : `a card saved: ${saved.kind}${saved.kind === "refused" ? ` ${String(saved.status)} ${saved.code}` : ""}`,
  );
  if (saved.kind !== "ok") return;
  const again = await api.createCard(token, { idempotencyKey: press, sourceId: "cnon:card-nonce-ok", customerId: customer.value.id, cardholderName: null });
  check(again.kind === "ok" && again.value.id === saved.value.id, `the same press again gives back the same card: ${again.kind === "ok" ? String(again.value.id === saved.value.id) : again.kind}`);
  const read = await api.retrieveCard(token, saved.value.id);
  check(read.kind === "ok" && read.value.enabled === true, `read back: ${read.kind}`);
  const stopped = await api.disableCard(token, saved.value.id);
  check(stopped.kind === "ok" && stopped.value.enabled === false, `stopped: ${stopped.kind === "ok" ? `enabled ${String(stopped.value.enabled)}` : stopped.kind}`);
  const twice = await api.disableCard(token, saved.value.id);
  check(twice.kind === "ok" || (twice.kind === "refused" && twice.status === 404), `stopped twice: ${twice.kind}${twice.kind === "refused" ? ` ${String(twice.status)} ${twice.code}` : ""}`);
  const after = await api.retrieveCard(token, saved.value.id);
  check(after.kind !== "ok" || after.value.enabled === false, `read after stopping: ${after.kind === "ok" ? `enabled ${String(after.value.enabled)}` : `${after.kind}${after.kind === "refused" ? ` ${String(after.status)} ${after.code}` : ""}`}`);
  const noCustomer = await api.createCard(token, { idempotencyKey: randomUUID(), sourceId: "cnon:card-nonce-ok", customerId: "NOSUCHCUSTOMER0000000000", cardholderName: null });
  check(noCustomer.kind === "refused", `a customer Square never had: ${noCustomer.kind}${noCustomer.kind === "refused" ? ` ${String(noCustomer.status)} ${noCustomer.code}, said "${cardRefusalOf(noCustomer.status, noCustomer.code).words}"` : ""}`);
  // Square's own failing test tokens ("Sandbox test values", read 2026-10-20).
  for (const source of ["cnon:card-nonce-rejected-cvv", "cnon:card-nonce-rejected-postalcode", "cnon:card-nonce-rejected-expiration", "cnon:card-nonce-declined", "cnon:card-nonce-already-used"]) {
    const r = await api.createCard(token, { idempotencyKey: randomUUID(), sourceId: source, customerId: customer.value.id, cardholderName: null });
    if (r.kind === "ok") {
      console.log(`info ${source}: Square saved it (${r.value.card_brand ?? "?"} ending ${r.value.last_4 ?? "?"}); stopped again`);
      await api.disableCard(token, r.value.id);
    } else {
      console.log(`info ${source}: ${r.kind}${r.kind === "refused" ? ` ${String(r.status)} ${r.code}, said "${cardRefusalOf(r.status, r.code).words}"` : ""}`);
    }
  }
}

/** A Square Terminal code at the gym's location, read back; the same press twice is one code. */
async function checkTerminals(api: SquareApi, token: string, locationId: string): Promise<void> {
  const press = randomUUID();
  const made = await api.createDeviceCode(token, { idempotencyKey: press, name: "KWAZO Terminal check", locationId });
  check(
    made.kind === "ok" && made.value.status === "UNPAIRED" && made.value.code !== undefined && made.value.location_id === locationId,
    made.kind === "ok"
      ? `a Terminal code: ${made.value.status}, ${String(made.value.code?.length ?? 0)} characters, at the gym's location: ${String(made.value.location_id === locationId)}, works for ${String(Math.round((Date.parse(made.value.pair_by ?? "") - Date.now()) / 1000))} s`
      : `a Terminal code: ${made.kind}${made.kind === "refused" ? ` ${String(made.status)} ${made.code}` : ""}`,
  );
  if (made.kind !== "ok") return;
  const again = await api.createDeviceCode(token, { idempotencyKey: press, name: "KWAZO Terminal check", locationId });
  // Square shows a code once: the same press again is the same code, its text left empty.
  check(
    again.kind === "ok" && again.value.id === made.value.id && (again.value.code ?? "") === "",
    `the same press again gives back the same code, without its text: ${again.kind === "ok" ? `${String(again.value.id === made.value.id)}, text ${again.value.code === "" ? "empty" : "shown"}` : again.kind}`,
  );
  const read = await api.retrieveDeviceCode(token, made.value.id);
  check(read.kind === "ok" && read.value.status === "UNPAIRED" && read.value.device_id === undefined, `read back: ${read.kind === "ok" ? `${read.value.status}, no Terminal yet` : read.kind}`);
  const never = await api.retrieveDeviceCode(token, "NEVERISSUED00");
  check(never.kind === "refused" && never.status === 404, `a code Square never made: ${never.kind}${never.kind === "refused" ? ` ${String(never.status)} ${never.code}` : ""}`);
}

console.log(problems === 0 ? "All checks passed." : `${String(problems)} checks failed.`);
process.exit(problems === 0 ? 0 : 1);
