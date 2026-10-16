// One free trial per PERSON, however the address is spelled, and no gym for a throwaway
// address (ROADMAP Stage 3 item 2b; RULINGS 2026-09-08, layer 1), against real Postgres.
//
// THE WORST THING THIS JOB COULD DO: refuse a free trial to a real owner who never had
// one, or hand one person a second trial for a new spelling. The first tests are those.
// The spellings are the providers' own (packages/shared/test/fixtures/trialPersonCases.json
// names the pages), and the database's copy of the rule is run over that same file.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { trialPersonKey } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { isThrowawayEmail, THROWAWAY_DOMAIN_COUNT } from "../src/modules/orgs/throwaway.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "trialperson-test-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const TIMEOUT_MS = 60_000;

const CASES = JSON.parse(
  readFileSync(new URL("../../../packages/shared/test/fixtures/trialPersonCases.json", import.meta.url), "utf8"),
) as { same: [string, string, string][]; different: [string, string, string][] };

type App = Awaited<ReturnType<typeof buildApp>>;
type Account = { userId: string; email: string; cookies: Record<string, string> };

let ipCounter = 0;
const nextIp = () => `10.27.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

// Every address made here starts its name with this, on real providers' domains.
const TAG = "trialperson";
const run = String(Date.now() % 1_000_000);

d("one free trial per person (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const people = sql`SELECT id FROM users WHERE email ILIKE ${`${TAG}%`}`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${people})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE id IN (${people})`;
  };

  beforeAll(async () => {
    await cleanup();
    app = await buildApp(loadConfig(baseEnv));
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  const send = (method: "GET" | "POST", path: string, payload: unknown, cookies: Record<string, string>) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      cookies,
      ...(method === "POST" ? { payload: JSON.stringify(payload) } : {}),
    });

  /** An account through the password door, which leaves the address unconfirmed;
   *  `confirmed` then confirms it as the email code or Google does. */
  const makeUser = async (email: string, confirmed = true): Promise<Account> => {
    const reg = await send("POST", "/v1/auth/register", { email, password: PASSWORD, displayName: "Trial Person" }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    if (confirmed) await confirm(userId);
    const login = await send("POST", "/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };
  const confirm = async (userId: string) => {
    await sql`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
      VALUES (${userId}, 'verify_email', md5(random()::text) || md5(random()::text), now(), now())`;
  };

  let gymSeq = 0;
  const createGym = (owner: Account) =>
    send(
      "POST",
      "/v1/orgs",
      { trainsHere: false, name: `Trial Person Gym ${run} ${String(gymSeq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" },
      owner.cookies,
    );
  const makeGym = async (owner: Account): Promise<string> => {
    const res = await createGym(owner);
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { org: { id: string } }).org.id;
  };
  const startTrial = (owner: Account, gymId: string) => send("POST", `/v1/orgs/${gymId}/trial`, {}, owner.cookies);
  const trialUsedOnScreen = async (owner: Account, gymId: string): Promise<boolean | null> => {
    const res = await send("GET", "/v1/orgs/mine", undefined, owner.cookies);
    expect(res.statusCode).toBe(200);
    const org = (JSON.parse(res.body) as { orgs: { id: string; ownerTrialUsed: boolean | null }[] }).orgs.find(
      (o) => o.id === gymId,
    );
    if (org === undefined) throw new Error("gym missing from /v1/orgs/mine");
    return org.ownerTrialUsed;
  };
  const code = (res: { body: string }) => (JSON.parse(res.body) as { error?: string }).error;

  // Two addresses that both start with TAG and this run's number, from one case's pair.
  // The case's own names keep their dots, tags, capitals and domain. A lone "+tag" case
  // cannot be prefixed and stay what it is, so it is checked by the pure and database tests.
  let caseSeq = 0;
  const addresses = (a: string, b: string): [string, string] => {
    const n = `${run}${String(caseSeq++)}`;
    const name = (email: string) => {
      const at = email.lastIndexOf("@");
      const local = email.slice(0, at).trim();
      return `${TAG}${n}${local}${email.slice(at)}`.trim();
    };
    return [name(a), name(b)];
  };

  it(
    "WORST THING, a second trial: every spelling of one mailbox finds the first trial, on the screen and at the button",
    async () => {
      for (const [why, a, b] of CASES.same) {
        const [first, second] = addresses(a, b);
        expect(trialPersonKey(first), why).toBe(trialPersonKey(second));
        const one = await makeUser(first);
        const oneGym = await makeGym(one);
        expect((await startTrial(one, oneGym)).statusCode, why).toBe(200);

        const two = await makeUser(second);
        const twoGym = await makeGym(two);
        expect(await trialUsedOnScreen(two, twoGym), why).toBe(true);
        const refused = await startTrial(two, twoGym);
        expect(refused.statusCode, why).toBe(409);
        expect(code(refused), why).toBe("trial_already_used");
      }
    },
    TIMEOUT_MS * 5,
  );

  it(
    "WORST THING, a real owner refused: a different mailbox that looks alike still gets its own trial",
    async () => {
      // Google's own example domain, yourdomain.com, is on the throwaway list, so that pair
      // stops at the Manage door; the pure and database tests still check its key.
      const pairs = CASES.different.filter(([, a]) => !a.startsWith("+") && !isThrowawayEmail(a));
      expect(pairs.length).toBe(CASES.different.length - 2);
      for (const [why, a, b] of pairs) {
        const [first, second] = addresses(a, b);
        expect(trialPersonKey(first), why).not.toBe(trialPersonKey(second));
        const one = await makeUser(first);
        expect((await startTrial(one, await makeGym(one))).statusCode, why).toBe(200);

        const two = await makeUser(second);
        const twoGym = await makeGym(two);
        expect(await trialUsedOnScreen(two, twoGym), why).toBe(false);
        expect((await startTrial(two, twoGym)).statusCode, why).toBe(200);
      }
    },
    TIMEOUT_MS * 5,
  );

  it("an address nobody confirmed cannot spend the real owner's trial, and cannot start one", async () => {
    const [squatted, real] = addresses("k.d.gym+x@gmail.com", "kdgym@gmail.com");
    const squatter = await makeUser(squatted, false);
    const squatterGym = await makeGym(squatter);
    const refused = await startTrial(squatter, squatterGym);
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe("email_not_confirmed");
    // A trial an unconfirmed account already holds (from before this rule) is its own only.
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, trial_ends_at, provider)
      VALUES ('gym', ${squatterGym}, (SELECT id FROM plans WHERE code = 'org_b1_in_m'), 'expired', now() - interval '1 day', 'none')`;

    const owner = await makeUser(real);
    const gymId = await makeGym(owner);
    expect(await trialUsedOnScreen(owner, gymId)).toBe(false);
    expect((await startTrial(owner, gymId)).statusCode).toBe(200);
  }, TIMEOUT_MS);

  it("an unconfirmed owner is told so, and starts the trial once the address is confirmed", async () => {
    const [email] = addresses("owner@gmail.com", "x@gmail.com");
    const owner = await makeUser(email, false);
    const gymId = await makeGym(owner);
    const refused = await startTrial(owner, gymId);
    expect(refused.statusCode).toBe(409);
    expect(JSON.parse(refused.body)).toMatchObject({
      error: "email_not_confirmed",
      message: "The free trial starts once the owner's email address is confirmed. The owner confirms it by signing in with a code sent to that email.",
    });
    expect(await sql`SELECT 1 FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`).toHaveLength(0);
    await confirm(owner.userId);
    expect((await startTrial(owner, gymId)).statusCode).toBe(200);
  }, TIMEOUT_MS);

  it("a stranger cannot start another owner's trial", async () => {
    const [a, b] = addresses("owner@outlook.com", "stranger@outlook.com");
    const owner = await makeUser(a);
    const stranger = await makeUser(b);
    const gymId = await makeGym(owner);
    expect((await startTrial(stranger, gymId)).statusCode).toBe(404);
    expect(await sql`SELECT 1 FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`).toHaveLength(0);
  }, TIMEOUT_MS);

  it("a throwaway address cannot open a gym; a subdomain of one cannot either; a real one can", async () => {
    for (const domain of ["mailinator.com", "yopmail.com", "inbox.mailinator.com"]) {
      const person = await makeUser(`${TAG}${run}${String(caseSeq++)}@${domain}`);
      const res = await createGym(person);
      expect(res.statusCode, domain).toBe(422);
      expect(JSON.parse(res.body), domain).toMatchObject({
        error: "email_throwaway",
        message: "A throwaway email address can't open a gym. Sign in with an email address you keep, or with Google.",
      });
      expect(await sql`SELECT 1 FROM gyms WHERE owner_user_id = ${person.userId}`, domain).toHaveLength(0);
    }
    const real = await makeUser(`${TAG}${run}${String(caseSeq++)}@rediffmail.com`);
    expect((await createGym(real)).statusCode).toBe(201);
  }, TIMEOUT_MS);

  it("the throwaway list holds none of the mail providers real owners use", () => {
    expect(THROWAWAY_DOMAIN_COUNT).toBeGreaterThan(9000);
    const real = [
      "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "yahoo.co.in",
      "ymail.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "zoho.com", "zohomail.in",
      "rediffmail.com", "gmx.com", "mail.com", "yandex.com", "fastmail.com", "hey.com", "tutanota.com",
      "company.co.in", "gym.in", "fitness.com.au", "studio.co.uk",
    ];
    for (const domain of real) expect(isThrowawayEmail(`owner@${domain}`), domain).toBe(false);
  });

  it("the database's copy of the rule gives the same key as the app's, on every case", async () => {
    const all = [...CASES.same, ...CASES.different].flatMap(([, a, b]) => [a, b]);
    for (const email of all) {
      const [row] = await sql<{ key: string }[]>`SELECT trial_person_key(${email}) AS key`;
      expect(row?.key, email).toBe(trialPersonKey(email));
    }
  });

  it("the key goes with the address when the account is purged", async () => {
    const [email] = addresses("purged.owner+1@gmail.com", "x@gmail.com");
    const person = await makeUser(email);
    const [before] = await sql<{ k: string | null }[]>`SELECT trial_person_key AS k FROM users WHERE id = ${person.userId}`;
    expect(before?.k).toBe(trialPersonKey(email));
    await sql`UPDATE users SET email = NULL WHERE id = ${person.userId}`;
    const [after] = await sql<{ k: string | null }[]>`SELECT trial_person_key AS k FROM users WHERE id = ${person.userId}`;
    expect(after?.k).toBeNull();
    await sql`DELETE FROM users WHERE id = ${person.userId}`;
  }, TIMEOUT_MS);
});
