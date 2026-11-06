// Presses Pay for a member, in Square's sandbox only (ROADMAP 18k-ii-a): the phone's button is Stage 5 item 20's, so until
// it is built a tester opens a member's payment page here, pays it on Square's test page in a browser, and sees the bill
// paid on the person's page in the console. It goes through the same code the phone's route does, as that member. Prints
// the page's address, never a token.
//
//   cd apps/api
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm exec node --env-file=C:\Projects\ai-home-gym\apps\api\.env.square.local --import tsx tools/square-app-payment.ts pay <gymId> <member's email>
//   … tools/square-app-payment.ts pay-fee <gymId> <member's email>   (their oldest fee owed, 18k-ii-b)
//   … tools/square-app-payment.ts check <gymId> <member's email> <paymentId>
//   … tools/square-app-payment.ts close <gymId> <member's email> <paymentId>
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";
import { formatMinor } from "@app/shared";
import { getMyMembership } from "../src/modules/orgs/myMembership/service.js";
import { checkAppPayment, closeAppPayment, startAppPayment } from "../src/modules/orgs/payments/appPayments.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";

const env = z
  .object({
    DATABASE_URL: z.string().url(),
    SQUARE_ENV: z.literal("sandbox"),
    SQUARE_APPLICATION_ID: z.string().regex(/^sandbox-sq0idb-[A-Za-z0-9_-]{10,60}$/),
    SQUARE_APPLICATION_SECRET: z.string().regex(/^sandbox-sq0csb-[A-Za-z0-9_-]{10,100}$/),
    PAYMENT_TOKENS_KEY: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .safeParse(process.env);
if (!env.success) {
  console.error("Needs DATABASE_URL, and Square's sandbox SQUARE_ENV, SQUARE_APPLICATION_ID, SQUARE_APPLICATION_SECRET and PAYMENT_TOKENS_KEY (.env.square.local). Secrets are never printed.");
  process.exit(1);
}
const args = z
  .union([
    z.tuple([z.literal("pay"), z.string().uuid(), z.string().email()]),
    z.tuple([z.literal("pay-fee"), z.string().uuid(), z.string().email()]),
    z.tuple([z.enum(["check", "close"]), z.string().uuid(), z.string().email(), z.string().uuid()]),
  ])
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error("Usage: square-app-payment.ts pay|pay-fee <gymId> <email> | check <gymId> <email> <paymentId> | close <gymId> <email> <paymentId>");
  process.exit(2);
}

const square = squareSettings({ ...env.data, SQUARE_WEBHOOK_SIGNATURE_KEY: undefined, SQUARE_WEBHOOK_URL: undefined });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });
const log = {
  info: () => undefined,
  warn: (o: object, m: string) => {
    console.error(m, o);
  },
  error: (o: object, m: string) => {
    console.error(m, o);
  },
};
const deps = { sql, square, log, now: () => new Date() };
const always = (): Promise<boolean> => Promise.resolve(true);
try {
  const [step, gymId, email] = args.data;
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
  if (user === undefined) throw new Error("No account has that email.");
  if (args.data[0] === "pay") {
    const mine = await getMyMembership({ sql, now: () => new Date() }, user.id, gymId, always);
    const owed = [...(mine?.memberships ?? []), ...(mine?.paysFor ?? []).flatMap((p) => p.memberships)].find((m) => m.owed !== null);
    if (owed?.owed == null) throw new Error("Nothing is owed now for this member, or they don't read it as theirs.");
    const done = await startAppPayment(deps, user.id, gymId, { requestKey: randomUUID(), membershipId: owed.id, periodIndex: owed.owed.periodIndex, amountMinor: owed.owed.amountMinor }, always);
    const page = done?.answer.payment;
    if (page === undefined) throw new Error("No answer.");
    console.log(`${owed.name}: ${formatMinor(page.amountMinor, page.currency)}. Payment ${page.id}`);
    console.log(`Square's page: ${page.url ?? "(not open)"}`);
  } else if (args.data[0] === "pay-fee") {
    const mine = await getMyMembership({ sql, now: () => new Date() }, user.id, gymId, always);
    const owing = [...(mine?.memberships ?? []), ...(mine?.paysFor ?? []).flatMap((p) => p.memberships)].flatMap((m) =>
      m.fees.filter((f) => f.state === "due" || f.state === "overdue").map((f) => ({ membership: m, fee: f })),
    );
    const oldest = owing.sort((a, b) => a.fee.dueOn.localeCompare(b.fee.dueOn))[0];
    if (oldest === undefined) throw new Error("No fee is owed now for this member, or they don't read it as theirs.");
    const done = await startAppPayment(deps, user.id, gymId, { requestKey: randomUUID(), membershipId: oldest.membership.id, feeId: oldest.fee.id, amountMinor: oldest.fee.amountMinor }, always);
    const page = done?.answer.payment;
    if (page === undefined) throw new Error("No answer.");
    console.log(`${oldest.fee.fee} fee, ${oldest.fee.forName}: ${formatMinor(page.amountMinor, page.currency)}. Payment ${page.id}`);
    console.log(`Square's page: ${page.url ?? "(not open)"}`);
  } else {
    const id = args.data[3];
    const done = step === "check" ? await checkAppPayment(deps, user.id, gymId, id, always) : await closeAppPayment(deps, user.id, gymId, id, always);
    console.log(`Payment ${id}: ${done?.answer.payment.state ?? "no answer"}${done?.answer.payment.receiptNumber == null ? "" : `, receipt ${String(done.answer.payment.receiptNumber)}`}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : "failed");
  process.exitCode = 1;
} finally {
  await sql.end();
}
