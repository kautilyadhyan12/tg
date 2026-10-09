// HOW MEMBERS REACH THEIR GYM — against real Postgres (spec Part 3 §16.1; ROADMAP 20a-iii).
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: the owner's private mobile for
// payments shown to members, or one gym's phone and email read by somebody who is not its
// member. That is the first test below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { GYM_CONTACT_WORDS, gymInboxResponseSchema, myOrgsResponseSchema, updateOrgResponseSchema, type GymContact } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-contact-test-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_contact_live";
/** The owner's own mobile, typed when an Indian gym is made. Never a member's to read. */
const OWNER_MOBILE = "98765 43210";
const OWNER_MOBILE_DIGITS = "9876543210";

let ipCounter = 0;
const nextIp = () => `10.89.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("how members reach their gym (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'contact-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'contact-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'contact-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PATCH", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `contact-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    owner: Person;
  }
  const livePlan = async (gymId: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };
  /** A gym in India, made with its owner's mobile for payments, as the Create page asks. */
  const makeGym = async (name: string, plan = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, {
      trainsHere: false,
      name,
      city: "Jorhat",
      country: "IN",
      timezone: "Asia/Kolkata",
      billingMobile: OWNER_MOBILE,
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    expect((await sql`SELECT billing_mobile FROM gyms WHERE id = ${id}`)[0]).toEqual({ billing_mobile: `+91${OWNER_MOBILE_DIGITS}` });
    if (plan) await livePlan(id);
    return { id, owner };
  };
  const joins = async (gym: Gym, name: string): Promise<Person> => {
    const p = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${p.userId}, now() - interval '1 hour')`;
    return p;
  };
  const staff = async (gym: Gym, name: string, role: "manager" | "trainer", privileges: string[]): Promise<Person> => {
    const p = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${p.userId}, ${role}, ${privileges})`;
    return p;
  };

  const save = (gym: Gym, who: Person, body: unknown) => inject("PATCH", `/v1/orgs/${gym.id}`, who.cookies, body);
  const saved = async (gym: Gym, body: unknown) => {
    const res = await save(gym, gym.owner, body);
    expect(res.statusCode, res.body).toBe(200);
    return updateOrgResponseSchema.parse(JSON.parse(res.body));
  };
  const stored = async (gym: Gym) =>
    (await sql<{ contact_phone: string | null; contact_email: string | null; billing_mobile: string | null }[]>`
      SELECT contact_phone, contact_email, billing_mobile FROM gyms WHERE id = ${gym.id}`)[0];
  /** The inbox as a member is sent it: the status, and the reply's own text. */
  const inbox = (gym: Gym, who: Person) => inject("GET", `/v1/orgs/${gym.id}/inbox`, who.cookies);
  const contactFor = async (gym: Gym, who: Person): Promise<GymContact> => {
    const res = await inbox(gym, who);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body, "the owner's mobile in a member's reply").not.toContain(OWNER_MOBILE_DIGITS);
    return gymInboxResponseSchema.parse(JSON.parse(res.body)).contact;
  };
  /** The gym's row in a person's own list of gyms, or undefined when it is not on it. */
  const onMyList = async (gym: Gym, who: Person) => {
    const res = await inject("GET", "/v1/orgs/mine", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return { row: myOrgsResponseSchema.parse(JSON.parse(res.body)).orgs.find((o) => o.id === gym.id), body: res.body };
  };
  const NOTHING: GymContact = { phone: null, email: null };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis: createMemoryRedis() });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "the worst thing: the owner's mobile for payments is never a member's to read, and a gym's phone and email reach only its own members",
    async () => {
      const iron = await makeGym("Contact Iron");
      const other = await makeGym("Contact Other");
      const maya = await joins(iron, "Maya");
      const omar = await joins(other, "Omar");
      const gone = await joins(iron, "Gone");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${iron.id} AND user_id = ${gone.userId}`;
      const stranger = await signedIn("Stranger");

      // A gym that has typed nothing shows nothing, whatever else it holds: the mobile for
      // payments is on its row and is not filled in for it.
      expect(await contactFor(iron, maya)).toEqual(NOTHING);
      const before = await onMyList(iron, maya);
      expect(before.body).not.toContain(OWNER_MOBILE_DIGITS);
      expect(before.row?.billingMobile).toBeNull();

      // Each gym types its own.
      await saved(iron, { contactPhone: "0376 2301234", contactEmail: "desk@contactiron.com" });
      await saved(other, { contactPhone: "+91 361 2345678" });
      expect(await contactFor(iron, maya)).toEqual({ phone: "0376 2301234", email: "desk@contactiron.com" });
      expect(await contactFor(other, omar)).toEqual({ phone: "+91 361 2345678", email: null });
      // Typing them moved nothing else, and the mobile for payments is still only the owner's.
      expect((await stored(iron))?.billing_mobile).toBe(`+91${OWNER_MOBILE_DIGITS}`);
      expect((await onMyList(iron, iron.owner)).row?.billingMobile).toBe(`+91${OWNER_MOBILE_DIGITS}`);

      // Nobody outside the gym is sent them: each is answered as for a gym that is not there.
      const outsiders: [string, Person][] = [
        ["a stranger", stranger],
        ["another gym's member", omar],
        ["another gym's owner", other.owner],
        ["a member the gym removed", gone],
        ["the gym's own owner, who is not a member", iron.owner],
      ];
      for (const [who, person] of outsiders) {
        const res = await inbox(iron, person);
        expect(res.statusCode, who).toBe(404);
        expect(res.body, who).not.toContain("2301234");
        expect(res.body, who).not.toContain("contactiron");
      }
      expect((await inbox(iron, { userId: "", cookies: {} })).statusCode).toBe(401);

      // The list of a person's own gyms carries them for staff's Settings box only.
      const mayaSees = await onMyList(iron, maya);
      expect(mayaSees.row?.contactPhone).toBeNull();
      expect(mayaSees.row?.contactEmail).toBeNull();
      expect(mayaSees.body).not.toContain("2301234");
      expect((await onMyList(iron, gone)).body).not.toContain("2301234");
      const ownerSees = await onMyList(iron, iron.owner);
      expect(ownerSees.row?.contactPhone).toBe("0376 2301234");
      expect(ownerSees.row?.contactEmail).toBe("desk@contactiron.com");

      // A gym on no plan shows its members no inbox, and no phone or email with it.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${iron.id}`;
      const paused = await inbox(iron, maya);
      expect(paused.statusCode).toBe(200);
      expect(gymInboxResponseSchema.parse(JSON.parse(paused.body))).toMatchObject({ status: "paused", contact: NOTHING });
      expect(paused.body).not.toContain("2301234");
      await livePlan(iron.id);
      expect(await contactFor(iron, maya)).toEqual({ phone: "0376 2301234", email: "desk@contactiron.com" });
    },
    T,
  );

  it(
    "only somebody who may change the gym's details saves them, and a gym on no plan saves nothing",
    async () => {
      const gym = await makeGym("Contact Who");
      const other = await makeGym("Contact Who Other");
      const member = await joins(gym, "Member");
      const trainer = await staff(gym, "Trainer", "trainer", ["members.read", "attendance.read"]);
      const manager = await staff(gym, "Manager", "manager", ["org.manage"]);
      const body = { contactPhone: "020 7946 0958", contactEmail: "hello@contactwho.com" };

      const refused: [string, Person, number][] = [
        ["a stranger", await signedIn("Stranger"), 404],
        ["another gym's owner", other.owner, 404],
        ["the gym's own member", member, 404],
        ["a trainer without the tick", trainer, 403],
        ["nobody at all", { userId: "", cookies: {} }, 401],
      ];
      for (const [who, person, status] of refused) {
        expect((await save(gym, person, body)).statusCode, who).toBe(status);
      }
      expect(await stored(gym)).toMatchObject({ contact_phone: null, contact_email: null });

      const res = await save(gym, manager, body);
      expect(res.statusCode, res.body).toBe(200);
      expect(await stored(gym)).toMatchObject({ contact_phone: "020 7946 0958", contact_email: "hello@contactwho.com" });
      // A manager who does not manage billing is not sent the owner's mobile with the answer.
      expect(res.body).not.toContain(OWNER_MOBILE_DIGITS);
      // The other gym's row is untouched.
      expect(await stored(other)).toMatchObject({ contact_phone: null, contact_email: null });

      const lapsed = await makeGym("Contact Lapsed", false);
      const lapsedRes = await save(lapsed, lapsed.owner, body);
      expect(lapsedRes.statusCode).toBe(409);
      expect((JSON.parse(lapsedRes.body) as { error: string }).error).toBe("gym_not_on_plan");
      expect(await stored(lapsed)).toMatchObject({ contact_phone: null, contact_email: null });
    },
    T,
  );

  it(
    "what is typed is tidied or refused in a plain sentence, empty clears one, and the record says which changed and never what to",
    async () => {
      const gym = await makeGym("Contact Typed");
      const maya = await joins(gym, "Maya");

      const answer = await saved(gym, { contactPhone: "  (212)  555-0123 ", contactEmail: " Front.Desk@ContactTyped.com " });
      expect(answer).toMatchObject({ contactPhone: "(212) 555-0123", contactEmail: "Front.Desk@ContactTyped.com" });
      expect(await contactFor(gym, maya)).toEqual({ phone: "(212) 555-0123", email: "Front.Desk@ContactTyped.com" });

      const bad: [unknown, string, string][] = [
        [{ contactPhone: "020 7946 0958 ext 12" }, "bad_contact_phone", GYM_CONTACT_WORDS.bad_contact_phone],
        [{ contactPhone: "ask at the desk" }, "bad_contact_phone", GYM_CONTACT_WORDS.bad_contact_phone],
        [{ contactPhone: "12345" }, "bad_contact_phone", GYM_CONTACT_WORDS.bad_contact_phone],
        [{ contactEmail: "hello@contacttyped.com?subject=hi" }, "bad_contact_email", GYM_CONTACT_WORDS.bad_contact_email],
        [{ contactEmail: "contacttyped.com" }, "bad_contact_email", GYM_CONTACT_WORDS.bad_contact_email],
        // One good and one bad: neither is kept.
        [{ contactPhone: "020 7946 0958", contactEmail: "not an address" }, "bad_contact_email", GYM_CONTACT_WORDS.bad_contact_email],
      ];
      for (const [body, error, message] of bad) {
        const res = await save(gym, gym.owner, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect(JSON.parse(res.body), JSON.stringify(body)).toMatchObject({ error, message });
      }
      for (const body of [{ contactPhone: 2125550123 }, { contactPhone: "1".repeat(61) }, { contactEmail: ["a@b.com"] }, { contactFax: "020 7946 0958" }]) {
        const res = await save(gym, gym.owner, body);
        expect(res.statusCode, JSON.stringify(body)).toBe(400);
        expect((JSON.parse(res.body) as { error: string }).error).toBe("validation_error");
      }
      expect(await stored(gym)).toMatchObject({ contact_phone: "(212) 555-0123", contact_email: "Front.Desk@ContactTyped.com" });

      // The same again changes nothing and is not written down a second time.
      const audits = () =>
        sql<{ meta: { changed?: string[] } }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.updated' ORDER BY id`;
      expect((await audits()).map((a) => a.meta.changed)).toEqual([["contactPhone", "contactEmail"]]);
      await saved(gym, { contactPhone: "(212) 555-0123", contactEmail: "Front.Desk@ContactTyped.com" });
      expect(await audits()).toHaveLength(1);

      // Empty, or null, clears one and leaves the other.
      expect(await saved(gym, { contactPhone: "   " })).toMatchObject({ contactPhone: null, contactEmail: "Front.Desk@ContactTyped.com" });
      expect(await contactFor(gym, maya)).toEqual({ phone: null, email: "Front.Desk@ContactTyped.com" });
      expect(await saved(gym, { contactEmail: null })).toMatchObject({ contactPhone: null, contactEmail: null });
      expect(await contactFor(gym, maya)).toEqual({ phone: null, email: null });
      // Another detail saved alone leaves both as they are.
      await saved(gym, { contactPhone: "0376 2301234" });
      await saved(gym, { city: "Dibrugarh" });
      expect(await stored(gym)).toMatchObject({ contact_phone: "0376 2301234", contact_email: null });

      const log = await audits();
      expect(log.map((a) => a.meta.changed)).toEqual([["contactPhone", "contactEmail"], ["contactPhone"], ["contactEmail"], ["contactPhone"], ["city"]]);
      expect(JSON.stringify(log)).not.toContain("555-0123");
      expect(JSON.stringify(log)).not.toContain("ContactTyped.com");
    },
    T,
  );
});
