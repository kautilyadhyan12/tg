// A GYM GONE FOR GOOD, WALKED ON A LOCAL DATABASE IN A MINUTE (ROADMAP Stage 4 item 14).
// Six months cannot be waited for in a click-through. For one gym, this ends its plan now
// (as a trial ending would) and runs the nightly sweep on the three nights that matter, with
// the clock moved forward: the month email, the week email, and the deletion. Each email is
// printed here instead of sent.
//
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_c node --import tsx tools/gone-for-good-walk.ts <gym-slug>
//
// It refuses any database that is not on this computer.
import postgres from "postgres";
import { z } from "zod";
import type { EmailMessage } from "../src/email/resend.js";
import { dueGyms } from "../src/modules/orgs/goneForGood/repo.js";
import { sweepGoneForGood } from "../src/modules/orgs/goneForGood/sweep.js";

const env = z.object({ DATABASE_URL: z.string().url(), WEB_ORIGIN: z.string().url().optional() }).safeParse(process.env);
if (!env.success) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}
const host = new URL(env.data.DATABASE_URL).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`Refused: ${host} is not this computer. This tool moves a gym's clock and deletes its list.`);
  process.exit(1);
}
const slug = process.argv[2];
if (slug === undefined || slug === "") {
  console.error("Name the gym: node --import tsx tools/gone-for-good-walk.ts <gym-slug>");
  process.exit(1);
}

const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });
const DAY = 24 * 60 * 60 * 1000;
try {
  const [gym] = await sql<{ id: string; name: string }[]>`SELECT id, name FROM gyms WHERE slug = ${slug}`;
  if (gym === undefined) throw new Error(`No gym called ${slug}.`);
  const ended = await sql`
    UPDATE subscriptions SET status = 'expired', ended_at = now()
    WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND status IN ('trialing','active','past_due')`;
  console.log(`${gym.name}: ${String(ended.count)} plan ended now.`);
  const [fact] = await dueGyms(sql, new Date(Date.now() + 10 * 365 * DAY), [gym.id]);
  if (fact === undefined) throw new Error("The gym is not counted as gone (a plan nobody dated?).");
  console.log(`No plan and no sign-in since ${fact.countedFrom.toISOString()}; six months on is ${fact.dueAt.toISOString()}.`);
  const mail = {
    webOrigin: env.data.WEB_ORIGIN ?? "http://127.0.0.2:5175",
    transport: {
      send: (m: EmailMessage): Promise<void> => {
        console.log(`\n--- email to ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n---`);
        return Promise.resolve();
      },
    },
  };
  const log = {
    info: (): void => undefined,
    error: (o: object): void => {
      console.error(o);
    },
  };
  for (const [label, at] of [
    ["a month before", new Date(fact.dueAt.getTime() - 30 * DAY)],
    ["a week before", new Date(fact.dueAt.getTime() - 7 * DAY)],
    ["the day", fact.dueAt],
  ] as const) {
    const result = await sweepGoneForGood({ sql, log, mail }, { now: at, gymIds: [gym.id] });
    console.log(`\nThe night ${label} (${at.toISOString()}):`, result);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
