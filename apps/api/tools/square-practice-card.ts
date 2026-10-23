// Swaps a person's card on file for one of Square's own practice cards (ROADMAP 18d-iii-i), in
// Square's sandbox only, so a tester sees a charge declined. Square's test area will not save a card
// that declines (CreateCard refuses its declining test value, measured 2026-10-23), but it charges
// its stored test cards as their names say ("Sandbox payments", read 2026-10-23). No screen offers
// this (Kd, 2026-10-21: no test-only box on any screen). The person must have a card on file already,
// in the account the gym is connected to: its customer is kept, and its agreement. Prints no token.
//
//   cd apps/api
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg_web1'
//   corepack pnpm exec node --env-file=.env.square.local --import tsx tools/square-practice-card.ts <gymId> <entryId> <declines|pays>
import postgres from "postgres";
import { z } from "zod";

const PRACTICE = {
  declines: { cardId: "ccof:customer-card-id-declined", brand: "VISA", last4: "0002" },
  pays: { cardId: "ccof:customer-card-id-visa-ok", brand: "VISA", last4: "1111" },
} as const;

const env = z.object({ DATABASE_URL: z.string().url(), SQUARE_ENV: z.literal("sandbox") }).safeParse(process.env);
if (!env.success) {
  console.error("Needs DATABASE_URL and Square's sandbox SQUARE_ENV (.env.square.local).");
  process.exit(1);
}
const args = z.tuple([z.string().uuid(), z.string().uuid(), z.enum(["declines", "pays"])]).safeParse(process.argv.slice(2));
if (!args.success) {
  console.error("Usage: square-practice-card.ts <gymId> <entryId> <declines|pays>");
  process.exit(2);
}
const [gymId, entryId, kind] = args.data;
const card = PRACTICE[kind];

const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 1 });
try {
  const rows = await sql<{ entry_id: string }[]>`
    UPDATE gym_member_cards k SET card_id = ${card.cardId}, brand = ${card.brand}, last4 = ${card.last4}, exp_month = 12, exp_year = 2031, updated_at = now()
    FROM gym_payment_connections c
    WHERE k.gym_id = ${gymId} AND k.entry_id = ${entryId} AND k.environment = 'sandbox'
      AND c.gym_id = k.gym_id AND c.environment = 'sandbox' AND c.state = 'connected' AND c.account_id = k.account_id
    RETURNING k.entry_id`;
  console.log(rows.length === 1 ? `That person's card on file is now Square's practice card that ${kind === "declines" ? "declines" : "pays"} (Visa ending ${card.last4}).` : "That person has no card on file in the Square test account this gym is connected to. Save a card for them first.");
} catch (err) {
  // Square's practice card is on one record of the account at a time.
  const taken = err instanceof Error && err.message.includes("gym_member_cards_card_uq");
  console.error(taken ? `Square's practice card that ${kind} is on another person in this Square test account already: remove that person's card on file first.` : err instanceof Error ? err.message : "failed");
  process.exitCode = 1;
} finally {
  await sql.end();
}
