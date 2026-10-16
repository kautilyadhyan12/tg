// A second free trial for a real owner of two gyms (ROADMAP Stage 3 item 2e-i; RULINGS
// 2026-09-08, layer 4). Kd runs it with the owner's email address and emails them the code it
// prints. The code works once, only for that person (any spelling of the address), for 14
// days; they type it in the plan box under "Have a code from us?".
//
//   corepack pnpm --filter api exec tsx tools/second-trial-code.ts owner@example.com
//
// The code is printed here and nowhere else: the database keeps only its SHA-256.
import postgres from "postgres";
import { z } from "zod";
import { normaliseSecondTrialCode } from "@app/shared";
import { sha256Hex } from "../src/modules/auth/tokens.js";
import { makeSecondTrialCode, saveSecondTrialCode, showSecondTrialCode } from "../src/modules/orgs/secondTrialCode.js";

const env = z.object({ DATABASE_URL: z.string().url() }).safeParse(process.env);
if (!env.success) {
  console.error("Missing env: DATABASE_URL. (secrets never printed)");
  process.exit(1);
}
const args = z.tuple([z.string().trim().email().max(254)]).safeParse(process.argv.slice(2));
if (!args.success) {
  console.error("Usage: second-trial-code.ts <the owner's email address>");
  process.exit(2);
}
const email = args.data[0];

const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 1 });
try {
  const code = makeSecondTrialCode();
  if (normaliseSecondTrialCode(code) !== code) throw new Error("a made code does not read back as itself");
  const saved = await saveSecondTrialCode(sql, { email, codeHash: sha256Hex(code) });
  console.log(`Second-trial code for ${email}: ${showSecondTrialCode(code)}`);
  // In this computer's own time zone: Kd's.
  const until = saved.expiresAt.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });
  console.log(`It works once, for this person only, until ${until}.`);
  console.log(
    saved.hasAccount
      ? "They have an account with this address."
      : "Nobody has signed in with this address yet. The code works once they sign in with it.",
  );
} finally {
  await sql.end();
}
