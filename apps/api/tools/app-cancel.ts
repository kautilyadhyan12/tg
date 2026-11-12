// Presses Cancel in the app for a member (ROADMAP 18l), and Keep my membership (18l-ii-a): the phone's screen is Stage 5
// item 20's, so until it is built a tester reads the box and cancels or keeps here, then sees the person's page and
// Overview in the console. It goes through the
// same code the phone's route does, as that member. The confirmation email is written to this window, never sent.
//
//   cd apps/api
//   $env:DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg'
//   corepack pnpm exec node --import tsx tools/app-cancel.ts ask <gymId> <member's email> "<membership's name>"
//   … tools/app-cancel.ts cancel <gymId> <member's email> "<membership's name>" <way>   (a way the box lists)
//   … tools/app-cancel.ts reason <gymId> <member's email> <cancelId> <reason>   (moving, cost, not_using, other_gym, service, other)
//   … tools/app-cancel.ts keep-ask <gymId> <member's email> "<membership's name>"
//   … tools/app-cancel.ts keep <gymId> <member's email> "<membership's name>"
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";
import { myCancelReasonSchema, myCancelWhenSchema } from "@app/shared";
import { NO_NEWS } from "../src/modules/live/news.js";
import { cancelInApp, readCancelAsk, setCancelReason, type CancelDeps } from "../src/modules/orgs/myMembership/cancel.js";
import { keepInApp, readKeepAsk } from "../src/modules/orgs/myMembership/keep.js";

const env = z.object({ DATABASE_URL: z.url() }).safeParse(process.env);
if (!env.success) {
  console.error("Needs DATABASE_URL, the local database's address.");
  process.exit(1);
}
const args = z
  .union([
    z.tuple([z.literal("ask"), z.uuid(), z.email(), z.string().min(1)]),
    z.tuple([z.literal("cancel"), z.uuid(), z.email(), z.string().min(1), myCancelWhenSchema]),
    z.tuple([z.literal("reason"), z.uuid(), z.email(), z.uuid(), myCancelReasonSchema]),
    z.tuple([z.enum(["keep-ask", "keep"]), z.uuid(), z.email(), z.string().min(1)]),
  ])
  .safeParse(process.argv.slice(2));
if (!args.success) {
  console.error('Usage: app-cancel.ts ask <gymId> <email> "<membership>" | cancel <gymId> <email> "<membership>" <way> | reason <gymId> <email> <cancelId> <reason> | keep-ask|keep <gymId> <email> "<membership>"');
  process.exit(2);
}

const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });
const deps: CancelDeps = {
  sql,
  now: () => new Date(),
  news: NO_NEWS,
  email: {
    sendCancelConfirmation: (letter) => {
      console.log(`\nThe confirmation email to ${letter.to}:\n  ${letter.done}\n  ${[...letter.lines, ...letter.notes].join("\n  ")}`);
      return Promise.resolve();
    },
    sendKeepConfirmation: (letter) => {
      console.log(`\nThe confirmation email to ${letter.to}:\n  ${letter.done}\n  ${letter.lines.join("\n  ")}`);
      return Promise.resolve();
    },
  },
  addressKey: null,
  log: {
    warn: (o, m) => {
      console.error(m, o);
    },
  },
};
const always = () => Promise.resolve(true);

/** The member's account, and the live membership of that name on their record or a record they pay for. */
async function find(gymId: string, email: string, name: string): Promise<{ userId: string; membershipId: string }> {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE lower(email::text) = lower(${email}) AND status = 'active'`;
  if (user === undefined) throw new Error("No account has that email.");
  const rows = await sql<{ id: string }[]>`
    SELECT h.id FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    JOIN gym_members m ON m.gym_id = h.gym_id AND m.user_id = ${user.id} AND m.removed_at IS NULL
    WHERE h.gym_id = ${gymId} AND lower(t.name) = lower(${name}) AND h.status IN ('active','frozen')
      AND (h.entry_id = m.entry_id OR h.entry_id IN (SELECT p.entry_id FROM gym_member_payers p WHERE p.gym_id = h.gym_id AND p.payer_entry_id = m.entry_id))
    ORDER BY h.starts_on DESC`;
  const first = rows[0];
  if (first === undefined) throw new Error(`They have no ${name} in use at that gym.`);
  if (rows.length > 1) console.error(`They have ${String(rows.length)} called ${name}; the newest is used.`);
  return { userId: user.id, membershipId: first.id };
}

try {
  const a = args.data;
  if (a[0] === "reason") {
    const [, gymId, email, cancelId, reason] = a;
    const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE lower(email::text) = lower(${email})`;
    const set = await setCancelReason(deps, user?.id ?? randomUUID(), gymId, cancelId, reason, always);
    console.log(`Reason kept: ${set?.reason ?? "none"}`);
  } else if (a[0] === "keep-ask" || a[0] === "keep") {
    const [, gymId, email, name] = a;
    const { userId, membershipId } = await find(gymId, email, name);
    const box = await readKeepAsk(deps, userId, gymId, membershipId, always);
    if (box === null) throw new Error("limited");
    console.log(box.membership.name);
    if (box.choice === null) console.log("  Nothing to press.");
    else console.log(`\n  ${box.choice.button}\n    ${box.choice.lines.join("\n    ")}`);
    for (const n of box.notes) console.log(`\n  ${n}`);
    if (a[0] === "keep" && box.choice !== null) {
      const done = await keepInApp(deps, userId, gymId, membershipId, { requestKey: randomUUID(), key: box.choice.key }, always);
      console.log(`\n${done?.line ?? ""}`);
    }
  } else {
    const [, gymId, email, name] = a;
    const { userId, membershipId } = await find(gymId, email, name);
    const box = await readCancelAsk(deps, userId, gymId, membershipId, always);
    if (box === null) throw new Error("limited");
    if (a[0] === "ask") {
      console.log(box.membership.name);
      if (box.choices.length === 0) console.log("  Nothing to press.");
      for (const c of box.choices) console.log(`\n  [${c.when}] ${c.button}\n    ${c.lines.join("\n    ")}`);
      for (const n of box.notes) console.log(`\n  ${n}`);
    } else {
      const when = a[4];
      if (when === undefined) throw new Error("Name the way to cancel.");
      const choice = box.choices.find((c) => c.when === when);
      if (choice === undefined) throw new Error(`The box has no ${when}: it lists ${box.choices.map((c) => c.when).join(", ") || "nothing"}.`);
      const done = await cancelInApp(deps, userId, gymId, membershipId, { requestKey: randomUUID(), when, key: choice.key }, always);
      console.log(`\n${done?.line ?? ""}\ncancelId ${done?.cancelId ?? ""}`);
    }
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
