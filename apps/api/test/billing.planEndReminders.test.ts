// A PLAN SET TO END IS REMINDED (ROADMAP Stage 2 item 4b-iv; Kd, 2026-10-20) — the billing
// worker's reminders against REAL Postgres (DATABASE_URL-gated), with a recording mail sender.
//
// A plan cancelled or handed over, through Paddle or Razorpay, emails the gym's owner and billing
// staff 7 days and 1 day before it ends, with a button to the plan. A plan that renews gets none.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): a gym
// whose plan renews told that it ends, so it pays again; or a gym's plan emailed to somebody who
// is not its owner or billing staff.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailMessage } from "../src/email/resend.js";
import { planEndReminderEmail } from "../src/modules/billing/emails.js";
import { sendPlanEndReminders } from "../src/modules/billing/service.js";
import { createMemoryRedis } from "../src/redis.js";
import { BILLING_LOCK_WAIT_MS, holdBillingSuiteLock } from "./billingSuiteLock.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const T = 120_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PLAN = "zz_end_rem_plan"; // up to 250 members, ₹1,999
const WEB = "http://localhost:5173";

describe("the reminder's words (no database)", () => {
  const base = {
    to: "owner@example.com",
    gymName: "Iron Den",
    orgType: "gym",
    members: 214,
    seatCap: 250,
    priceLabel: "₹1,999",
    trialing: false,
    // 16:37 UTC is 10:07 pm in India.
    endsAt: new Date("2026-10-27T16:37:00Z"),
    timezone: "Asia/Kolkata",
    lastDay: false,
    action: { kind: "choose" } as const,
    planLink: `${WEB}/console/iron-den`,
  };

  it("says when the plan ends, in the gym's own time, that nothing more is charged, and what the members keep", () => {
    const m = planEndReminderEmail(base);
    expect(m.to).toBe("owner@example.com");
    expect(m.subject).toBe("Iron Den's plan ends on 27 Oct");
    expect(m.text).toContain("Iron Den's plan, up to 250 members at ₹1,999 a month, ends at 10:07 pm on 27 Oct and won't renew. Nothing more is charged.");
    expect(m.text).toContain("After that, its 214 members get the free app only.");
    expect(m.text).toContain("Once it ends, you can choose a new plan.");
    expect(m.text).toContain(`Go to your plan: ${WEB}/console/iron-den`);
    expect(m.html).toContain(`href="${WEB}/console/iron-den"`);
    expect(m.html).toContain(">Go to your plan</a>");
  });

  it("the day before says it is a reminder", () => {
    expect(planEndReminderEmail({ ...base, lastDay: true }).subject).toBe("Reminder: Iron Den's plan ends on 27 Oct");
  });

  it("names what the plan box offers: Keep my plan with its last moment, or Manage payment", () => {
    const keep = planEndReminderEmail({ ...base, action: { kind: "keep_razorpay", until: new Date("2026-10-27T13:37:00Z") } });
    expect(keep.text).toContain("To keep it, press Keep my plan before 7:07 pm on 27 Oct.");
    expect(keep.text).not.toContain("choose a new plan");
    const paddle = planEndReminderEmail({ ...base, action: { kind: "keep_paddle" } });
    expect(paddle.text).toContain("To keep it, press Manage payment.");
  });

  it("a paid trial set to end charges nothing, and one member reads as one", () => {
    const m = planEndReminderEmail({ ...base, trialing: true, members: 1 });
    expect(m.text).toContain("Iron Den's plan ends with its free trial, at 10:07 pm on 27 Oct. Nothing is charged.");
    expect(m.text).toContain("After that, its 1 member gets the free app only.");
    expect(m.text).not.toContain("a month");
  });

  it("a studio's clients, no members yet, no limit", () => {
    const m = planEndReminderEmail({ ...base, orgType: "studio", members: 0, seatCap: null });
    expect(m.text).toContain("no client limit");
    expect(m.text).toContain("After that, its clients get the free app only.");
  });

  it("a gym's name cannot write into the HTML or break the subject line", () => {
    const m = planEndReminderEmail({ ...base, gymName: '<b>Bad</b> "Gym"\r\nBcc: x@example.com' });
    expect(m.html).not.toContain("<b>Bad</b>");
    expect(m.html).toContain("&lt;b&gt;Bad&lt;/b&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

interface Person {
  userId: string;
  email: string;
}
interface Gym {
  id: string;
  owner: Person;
  sub: string;
}

d("plan-end reminders (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const sent: EmailMessage[] = [];
  const transport = {
    send: (m: EmailMessage) => {
      sent.push(m);
      return Promise.resolve();
    },
  };
  /** One run of the worker's reminders at `now`. */
  const run = (now: Date, mail: boolean = true) =>
    sendPlanEndReminders({
      sql,
      redis: createMemoryRedis(),
      paddle: null,
      log: silent,
      now: () => now,
      mail: mail ? { transport, webOrigin: WEB } : null,
    });
  /** What this gym's people were sent since `from` (other suites' gyms are swept too). */
  const to = (gym: Gym, from = 0) => {
    const mine = new Set([gym.owner.email, ...(extra.get(gym.id) ?? [])]);
    return sent.slice(from).filter((m) => mine.has(m.to) || m.text.includes(`/console/${slugOf.get(gym.id) ?? "?"}`));
  };
  const extra = new Map<string, string[]>();
  const slugOf = new Map<string, string>();

  let seq = 0;
  const tag = String(Date.now() % 1_000_000);
  const person = async (name: string): Promise<Person> => {
    const email = `endrem-t-${tag}-${String(seq++)}@example.com`;
    const rows = await sql<{ id: string }[]>`INSERT INTO users (email, display_name) VALUES (${email}, ${name}) RETURNING id`;
    const userId = rows[0]?.id;
    if (userId === undefined) throw new Error("no user");
    return { userId, email };
  };
  const staff = async (gym: Gym, who: Person, role: "owner" | "manager" | "trainer") => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${who.userId}, ${role}, ${null})`;
    extra.set(gym.id, [...(extra.get(gym.id) ?? []), who.email]);
  };

  /** A gym on a plan through `provider`, ending at `end`, set to end or renewing. */
  const makeGym = async (input: {
    provider: "paddle" | "razorpay";
    end: Date;
    setToEnd: boolean;
    status?: "active" | "trialing" | "past_due";
  }): Promise<Gym> => {
    const owner = await person("Asha Owner");
    const slug = `endrem-${tag}-${String(seq++)}`;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gyms (owner_user_id, slug, name, timezone) VALUES (${owner.userId}, ${slug}, ${"Iron Den " + slug}, 'Asia/Kolkata') RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no gym");
    slugOf.set(id, slug);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${id}, ${owner.userId}, 'owner', ${null})`;
    const status = input.status ?? "active";
    const subRows = await sql<{ id: string }[]>`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, current_period_end, cancel_at_period_end,
                                 past_due_since, trial_ends_at)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${PLAN}), ${status}, ${input.provider}, ${`sub_endrem_${tag}_${String(seq++)}`},
              ${input.end}, ${input.setToEnd}, ${status === "past_due" ? new Date() : null}, ${status === "trialing" ? input.end : null})
      RETURNING id`;
    const sub = subRows[0]?.id;
    if (sub === undefined) throw new Error("no plan");
    return { id, owner, sub };
  };
  const members = async (gym: Gym, n: number) => {
    for (let i = 0; i < n; i++) {
      const m = await person(`Member ${String(i)}`);
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${gym.id}, ${m.userId})`;
    }
  };

  const mine = sql`SELECT id FROM gyms WHERE slug LIKE 'endrem-%'`;
  const cleanup = async () => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'endrem-t-%@example.com'`;
  };

  // The other billing suites' workers sweep every gym: they take turns (billingSuiteLock.ts).
  let releaseLock: (() => Promise<void>) | null = null;
  beforeAll(async () => {
    releaseLock = await holdBillingSuiteLock(sql);
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${PLAN}, 'org', ${"plan." + PLAN}, 199900, 'INR', 'month', 250, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true, price_minor = 199900, seat_cap = 250`;
  }, BILLING_LOCK_WAIT_MS);

  afterAll(async () => {
    await cleanup();
    await sql`DELETE FROM plans WHERE code = ${PLAN}`;
    await releaseLock?.();
    await sql.end();
  }, T);

  const now = new Date();
  const at = (ms: number) => new Date(now.getTime() + ms);

  describe("the worst thing: a plan that renews is never told it ends, and nobody outside the gym's owners is told", () => {
    it(
      "a renewing plan, through either provider, gets no reminder a week, a day or an hour before",
      async () => {
        const paddle = await makeGym({ provider: "paddle", end: at(6 * DAY_MS), setToEnd: false });
        const razorpay = await makeGym({ provider: "razorpay", end: at(6 * DAY_MS), setToEnd: false });
        const from = sent.length;
        for (const before of [6 * DAY_MS, 23 * HOUR_MS, HOUR_MS]) {
          await run(new Date(at(6 * DAY_MS).getTime() - before));
        }
        expect(to(paddle, from)).toEqual([]);
        expect(to(razorpay, from)).toEqual([]);
        const marks = await sql`SELECT id FROM subscriptions WHERE id IN (${paddle.sub}, ${razorpay.sub}) AND (end_week_reminded_for IS NOT NULL OR end_day_reminded_for IS NOT NULL)`;
        expect(marks).toHaveLength(0);
      },
      T,
    );

    it(
      "only the owner and co-owners are emailed: not a manager, a trainer, somebody taken off the staff, or another gym's owner",
      async () => {
        const gym = await makeGym({ provider: "paddle", end: at(5 * DAY_MS), setToEnd: true });
        const other = await makeGym({ provider: "paddle", end: at(20 * DAY_MS), setToEnd: true });
        const coOwner = await person("Ravi CoOwner");
        await staff(gym, coOwner, "owner");
        const manager = await person("Mira Manager");
        await staff(gym, manager, "manager");
        const trainer = await person("Tom Trainer");
        await staff(gym, trainer, "trainer");
        const gone = await person("Gina Gone");
        await staff(gym, gone, "owner");
        await sql`DELETE FROM gym_staff WHERE gym_id = ${gym.id} AND user_id = ${gone.userId}`;
        const from = sent.length;
        await run(now);
        expect(to(gym, from).map((m) => m.to).sort()).toEqual([gym.owner.email, coOwner.email].sort());
        expect(sent.slice(from).some((m) => [manager.email, trainer.email, gone.email, other.owner.email].includes(m.to))).toBe(false);
        // Each email names its own gym only.
        for (const m of to(gym, from)) expect(m.text).toContain(`Go to your plan: ${WEB}/console/${slugOf.get(gym.id) ?? "?"}#plan`);
      },
      T,
    );
  });

  it(
    "a week before, once, and a day before, once, however many runs",
    async () => {
      const end = at(6 * DAY_MS + 12 * HOUR_MS);
      const gym = await makeGym({ provider: "paddle", end, setToEnd: true });
      // Eight days before: not yet.
      let from = sent.length;
      await run(new Date(end.getTime() - 8 * DAY_MS));
      expect(to(gym, from)).toEqual([]);
      from = sent.length;
      await run(now);
      await run(at(HOUR_MS));
      await run(at(2 * DAY_MS));
      const week = to(gym, from);
      expect(week).toHaveLength(1);
      expect(week[0]?.subject).not.toMatch(/^Reminder/);
      from = sent.length;
      await run(new Date(end.getTime() - 20 * HOUR_MS));
      await run(new Date(end.getTime() - 2 * HOUR_MS));
      const day = to(gym, from);
      expect(day).toHaveLength(1);
      expect(day[0]?.subject).toMatch(/^Reminder: /);
      // After it has ended, nothing more.
      from = sent.length;
      await run(new Date(end.getTime() + HOUR_MS));
      expect(to(gym, from)).toEqual([]);
    },
    T,
  );

  it(
    "two runs at once send each reminder once",
    async () => {
      const gym = await makeGym({ provider: "razorpay", end: at(4 * DAY_MS), setToEnd: true });
      await staff(gym, await person("Ravi CoOwner"), "owner");
      const from = sent.length;
      await Promise.all([run(now), run(now), run(now), run(now)]);
      expect(to(gym, from)).toHaveLength(2);
    },
    T,
  );

  it(
    "set to end within the last day: only the day-before reminder",
    async () => {
      const gym = await makeGym({ provider: "paddle", end: at(10 * HOUR_MS), setToEnd: true });
      const from = sent.length;
      await run(now);
      await run(at(HOUR_MS));
      const got = to(gym, from);
      expect(got).toHaveLength(1);
      expect(got[0]?.subject).toMatch(/^Reminder: /);
    },
    T,
  );

  it(
    "kept and set to end again for the same end: not again; for a later end: reminded again",
    async () => {
      const end = at(5 * DAY_MS);
      const gym = await makeGym({ provider: "paddle", end, setToEnd: true });
      let from = sent.length;
      await run(now);
      expect(to(gym, from)).toHaveLength(1);
      // Kept: nothing while it renews.
      await sql`UPDATE subscriptions SET cancel_at_period_end = false WHERE id = ${gym.sub}`;
      from = sent.length;
      await run(at(HOUR_MS));
      expect(to(gym, from)).toEqual([]);
      // Set to end again, same month: already told.
      await sql`UPDATE subscriptions SET cancel_at_period_end = true WHERE id = ${gym.sub}`;
      from = sent.length;
      await run(at(2 * HOUR_MS));
      expect(to(gym, from)).toEqual([]);
      // Renewed, and set to end at its next month's end: told again.
      const next = new Date(end.getTime() + 30 * DAY_MS);
      await sql`UPDATE subscriptions SET current_period_end = ${next} WHERE id = ${gym.sub}`;
      from = sent.length;
      await run(new Date(next.getTime() - 5 * DAY_MS));
      expect(to(gym, from)).toHaveLength(1);
    },
    T,
  );

  it(
    "a plan past due, ended or expired is not reminded",
    async () => {
      const due = await makeGym({ provider: "razorpay", end: at(3 * DAY_MS), setToEnd: true, status: "past_due" });
      const ended = await makeGym({ provider: "paddle", end: at(3 * DAY_MS), setToEnd: true });
      await sql`UPDATE subscriptions SET status = 'canceled', ended_at = now() WHERE id = ${ended.sub}`;
      const from = sent.length;
      await run(now);
      expect(to(due, from)).toEqual([]);
      expect(to(ended, from)).toEqual([]);
    },
    T,
  );

  it(
    "with no mail sender nothing is marked, so the reminder still goes once one is set",
    async () => {
      const gym = await makeGym({ provider: "paddle", end: at(3 * DAY_MS), setToEnd: true });
      expect(await run(now, false)).toBe(0);
      const [row] = await sql<{ week: Date | null }[]>`SELECT end_week_reminded_for AS week FROM subscriptions WHERE id = ${gym.sub}`;
      expect(row?.week ?? null).toBeNull();
      const from = sent.length;
      await run(now);
      expect(to(gym, from)).toHaveLength(1);
    },
    T,
  );

  describe("the button's line is what the plan box offers", () => {
    it(
      "Razorpay, not yet sent: Keep my plan, before three hours ahead of the end; once sent: choose a new plan",
      async () => {
        const end = new Date(Math.floor(at(3 * DAY_MS).getTime() / 60_000) * 60_000);
        const keep = await makeGym({ provider: "razorpay", end, setToEnd: true });
        const sentAlready = await makeGym({ provider: "razorpay", end, setToEnd: true });
        await sql`UPDATE subscriptions SET cancel_sent_at = now() WHERE id = ${sentAlready.sub}`;
        await members(keep, 3);
        const from = sent.length;
        await run(now);
        const [k] = to(keep, from);
        expect(k?.text).toContain("To keep it, press Keep my plan before");
        expect(k?.text).toContain("After that, its 3 members get the free app only.");
        expect(k?.text).toMatch(/up to 250 members at ₹1,999(\.00)? a month/);
        const [s] = to(sentAlready, from);
        expect(s?.text).toContain("Once it ends, you can choose a new plan.");
        expect(s?.text).not.toContain("Keep my plan");
      },
      T,
    );

    it(
      "Paddle: Manage payment; handed over, either provider: choose a new plan, never keep",
      async () => {
        const paddle = await makeGym({ provider: "paddle", end: at(3 * DAY_MS), setToEnd: true });
        const handedPaddle = await makeGym({ provider: "paddle", end: at(3 * DAY_MS), setToEnd: true });
        const handedRazorpay = await makeGym({ provider: "razorpay", end: at(3 * DAY_MS), setToEnd: true });
        for (const g of [handedPaddle, handedRazorpay]) {
          await sql`UPDATE subscriptions SET handed_over_at = now(), handed_over_from = ${g.owner.userId} WHERE id = ${g.sub}`;
        }
        const from = sent.length;
        await run(now);
        expect(to(paddle, from)[0]?.text).toContain("To keep it, press Manage payment.");
        for (const g of [handedPaddle, handedRazorpay]) {
          const [m] = to(g, from);
          expect(m?.text).toContain("Once it ends, you can choose a new plan.");
          expect(m?.text).not.toMatch(/Keep my plan|Manage payment/);
        }
      },
      T,
    );

    it(
      "a paid trial set to end: ends with its free trial, nothing charged",
      async () => {
        const gym = await makeGym({ provider: "paddle", end: at(2 * DAY_MS), setToEnd: true, status: "trialing" });
        const from = sent.length;
        await run(now);
        expect(to(gym, from)[0]?.text).toMatch(/plan ends with its free trial, at .+\. Nothing is charged\./);
      },
      T,
    );
  });
});
