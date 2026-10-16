// The second-trial code (ROADMAP Stage 3 item 2e-i; RULINGS 2026-09-08, layer 4), against real
// Postgres. Kd makes a code for a real owner of two gyms; it lets that one person past "one free
// trial per person" and "one device, one trial" once.
//
// THE WORST THING THIS JOB COULD DO: a code Kd made for one owner gives a free trial to somebody
// else, or works twice. The first test is that.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normaliseSecondTrialCode } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { sha256Hex } from "../src/modules/auth/tokens.js";
import {
  SECOND_TRIAL_CODE_DAYS,
  makeSecondTrialCode,
  saveSecondTrialCode,
  showSecondTrialCode,
} from "../src/modules/orgs/secondTrialCode.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const SUPPORT = "help@gmail.com";
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "secondtrial-test-secret-0123456789", // dummy test value, gitleaks:allow
  SUPPORT_EMAIL: SUPPORT,
};
const TIMEOUT_MS = 60_000;
const MARK = "trial_mark";

type App = Awaited<ReturnType<typeof buildApp>>;
type Account = { userId: string; email: string; cookies: Record<string, string> };
type Res = Awaited<ReturnType<App["inject"]>>;

let ipCounter = 0;
const nextIp = () => `10.29.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const TAG = "secondtrial";
const run = String(Date.now() % 1_000_000);

describe("the code's letters", () => {
  it("are ten from the alphabet, read back as themselves, and are sent as two groups of five", () => {
    let i = 0;
    const code = makeSecondTrialCode((n) => i++ % n);
    expect(code).toBe("ABCDEFGHJK");
    expect(showSecondTrialCode(code)).toBe("ABCDE-FGHJK");
    expect(normaliseSecondTrialCode(" abcde-fghjk ")).toBe("ABCDEFGHJK");
    expect(normaliseSecondTrialCode("ABCDE FGHJK")).toBe("ABCDEFGHJK");
    // Nothing that reads like another: O, 0, I, 1 and L are never in a code.
    expect(normaliseSecondTrialCode("ABCDE-FGHJO")).toBeNull();
    expect(normaliseSecondTrialCode("ABCDE-FGHJ1")).toBeNull();
    expect(normaliseSecondTrialCode("ABCDE-FGHJ")).toBeNull();
    expect(normaliseSecondTrialCode("")).toBeNull();
    for (let k = 0; k < 50; k++) {
      const made = makeSecondTrialCode();
      expect(normaliseSecondTrialCode(made)).toBe(made);
    }
  });
});

d("the second-trial code (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const codesMade: string[] = [];

  const cleanup = async () => {
    const people = sql`SELECT id FROM users WHERE email ILIKE ${`${TAG}%`}`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${people})`;
    await sql`DELETE FROM second_trial_codes WHERE code_hash = ANY(${codesMade})`;
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

  const send = (method: "GET" | "POST", path: string, cookies: Record<string, string>, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      cookies,
      ...(method === "POST" ? { payload: JSON.stringify(payload ?? {}) } : {}),
    });

  let personSeq = 0;
  /** A person with a confirmed address, signed in. */
  const makeOwner = async (): Promise<Account> => {
    const email = `${TAG}${run}p${String(personSeq++)}@gmail.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: "Second Trial" }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await sql`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
      VALUES (${userId}, 'verify_email', md5(random()::text) || md5(random()::text), now(), now())`;
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])) };
  };

  let gymSeq = 0;
  const makeGym = async (owner: Account): Promise<string> => {
    const res = await send("POST", "/v1/orgs", owner.cookies, {
      trainsHere: false,
      name: `Second Trial Gym ${run} ${String(gymSeq++)}`,
      city: "Pune",
      country: "IN",
      timezone: "Asia/Kolkata",
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { org: { id: string } }).org.id;
  };

  /** Each person presses in their own browser unless a mark is given. */
  const startTrial = (who: Account, gymId: string, code?: string, mark?: string): Promise<Res> =>
    send(
      "POST",
      `/v1/orgs/${gymId}/trial`,
      mark === undefined ? who.cookies : { ...who.cookies, [MARK]: mark },
      code === undefined ? {} : { code },
    );
  /** An owner whose one free trial is spent on a first gym; their second gym is returned. */
  const ownerOfTwo = async (): Promise<{ owner: Account; second: string }> => {
    const owner = await makeOwner();
    expect((await startTrial(owner, await makeGym(owner))).statusCode).toBe(200);
    const second = await makeGym(owner);
    const refused = await startTrial(owner, second);
    expect(refused.statusCode).toBe(409);
    expect(body(refused).error).toBe("trial_already_used");
    return { owner, second };
  };
  /** Kd runs the tool for this address. */
  const kdMakesCode = async (email: string): Promise<string> => {
    const code = makeSecondTrialCode();
    codesMade.push(sha256Hex(code));
    await saveSecondTrialCode(sql, { email, codeHash: sha256Hex(code) });
    return code;
  };
  const body = (res: Res) => JSON.parse(res.body) as { error?: string; message?: string; outcome?: string };
  const trialsOf = async (gymId: string) =>
    (await sql<{ status: string }[]>`SELECT status FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`).map(
      (r) => r.status,
    );
  const codeRow = async (code: string) =>
    (await sql<{ used_at: Date | null; subscription_id: string | null }[]>`
      SELECT used_at, subscription_id FROM second_trial_codes WHERE code_hash = ${sha256Hex(code)}`)[0];

  it(
    "WORST THING: a code made for one owner gives nobody else a trial, and works only once",
    async () => {
      const a = await ownerOfTwo();
      const b = await ownerOfTwo();
      const code = await kdMakesCode(a.owner.email);

      // Somebody else whose trial is spent types A's code: refused, nothing written, code unspent.
      const stolen = await startTrial(b.owner, b.second, code);
      expect(stolen.statusCode).toBe(409);
      expect(body(stolen).error).toBe("trial_code_not_valid");
      expect(body(stolen).message).toBe("That code isn't valid. Check it and try again, or ask us for a new one.");
      expect(await trialsOf(b.second)).toEqual([]);
      expect((await codeRow(code))?.used_at).toBeNull();

      // A uses it: the trial starts, and the code is spent on that trial.
      const used = await startTrial(a.owner, a.second, code);
      expect(used.statusCode, used.body).toBe(200);
      expect(body(used).outcome).toBe("started");
      const subId = (await sql<{ id: string }[]>`
        SELECT id FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${a.second}`)[0]?.id;
      expect((await codeRow(code))?.subscription_id).toBe(subId);

      // A third gym of A's: the same code again is refused.
      const third = await makeGym(a.owner);
      const again = await startTrial(a.owner, third, code);
      expect(again.statusCode).toBe(409);
      expect(body(again).error).toBe("trial_code_not_valid");
      expect(await trialsOf(third)).toEqual([]);
    },
    TIMEOUT_MS * 2,
  );

  it("works for the person under another spelling of the address, typed in small letters with spaces", async () => {
    const { owner, second } = await ownerOfTwo();
    const [local] = owner.email.split("@");
    if (local === undefined) throw new Error("no local part");
    // Kd typed the address with dots and a tag, at googlemail.com: the same Gmail mailbox.
    const kdTyped = `${local.slice(0, 4)}.${local.slice(4)}+gyms@googlemail.com`;
    const code = await kdMakesCode(kdTyped);
    const typed = ` ${showSecondTrialCode(code).toLowerCase().replace("-", " ")} `;
    const res = await startTrial(owner, second, typed);
    expect(res.statusCode, res.body).toBe(200);
    expect(await trialsOf(second)).toEqual(["trialing"]);
    // The trial is noted as started by the code.
    const notes = await sql<{ meta: Record<string, unknown> }[]>`
      SELECT meta FROM audit_log WHERE gym_id = ${second} AND action = 'org.trial_started'`;
    expect(notes.length).toBe(1);
    expect(typeof notes[0]?.meta["secondTrialCode"]).toBe("string");
  });

  it("lets a person past one device, one trial: their own first trial on a computer that already had one", async () => {
    const first = await makeOwner();
    const marked = await startTrial(first, await makeGym(first));
    const mark = marked.cookies.find((c) => c.name === MARK)?.value;
    if (mark === undefined) throw new Error("no mark");

    const owner = await makeOwner();
    const gym = await makeGym(owner);
    const refused = await startTrial(owner, gym, undefined, mark);
    expect(body(refused).error).toBe("trial_used_on_device");
    const code = await kdMakesCode(owner.email);
    expect((await startTrial(owner, gym, code, mark)).statusCode).toBe(200);
    expect(await trialsOf(gym)).toEqual(["trialing"]);
  });

  it("refuses a code out of date, a made-up one and one of the wrong shape, all with one answer", async () => {
    const { owner, second } = await ownerOfTwo();
    const old = await kdMakesCode(owner.email);
    await sql`
      UPDATE second_trial_codes
      SET created_at = now() - ${SECOND_TRIAL_CODE_DAYS + 1} * INTERVAL '1 day', expires_at = now() - INTERVAL '1 day'
      WHERE code_hash = ${sha256Hex(old)}`;
    for (const typed of [old, makeSecondTrialCode(), "hello", "O0O0O-I1I1I"]) {
      const res = await startTrial(owner, second, typed);
      expect(res.statusCode).toBe(409);
      expect(body(res).error).toBe("trial_code_not_valid");
    }
    expect(await trialsOf(second)).toEqual([]);
    // A code longer than anybody types is a broken request.
    expect((await startTrial(owner, second, "A".repeat(41))).statusCode).toBe(400);
  });

  it("is not spent by an owner who never had a trial: the trial starts as it would have", async () => {
    const owner = await makeOwner();
    const gym = await makeGym(owner);
    const code = await kdMakesCode(owner.email);
    expect((await startTrial(owner, gym, code)).statusCode).toBe(200);
    expect((await codeRow(code))?.used_at).toBeNull();
    // A wrong code typed beside a trial that would start anyway refuses nothing either.
    const other = await makeOwner();
    expect((await startTrial(other, await makeGym(other), "hello")).statusCode).toBe(200);
  });

  it(
    "pressed on two gyms at once, one code starts one trial",
    async () => {
      const owner = await makeOwner();
      expect((await startTrial(owner, await makeGym(owner))).statusCode).toBe(200);
      const two = await makeGym(owner);
      const three = await makeGym(owner);
      const code = await kdMakesCode(owner.email);
      const answers = await Promise.all([startTrial(owner, two, code), startTrial(owner, three, code)]);
      expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect([...(await trialsOf(two)), ...(await trialsOf(three))]).toEqual(["trialing"]);
    },
    TIMEOUT_MS,
  );

  it("a stranger with the owner's code reaches nothing of the gym", async () => {
    const { owner, second } = await ownerOfTwo();
    const code = await kdMakesCode(owner.email);
    const stranger = await makeOwner();
    const res = await startTrial(stranger, second, code);
    expect([403, 404]).toContain(res.statusCode);
    expect(await trialsOf(second)).toEqual([]);
    expect((await codeRow(code))?.used_at).toBeNull();
  });

  it("the code is kept only as its hash, and the plans read carries where to write to us", async () => {
    const { owner, second } = await ownerOfTwo();
    const code = await kdMakesCode(owner.email);
    const raw = await sql`SELECT 1 FROM second_trial_codes WHERE code_hash = ${code} OR person_hash = ${owner.email}`;
    expect(raw.length).toBe(0);
    const plans = await send("GET", `/v1/orgs/${second}/plans`, owner.cookies);
    expect(plans.statusCode).toBe(200);
    expect((JSON.parse(plans.body) as { supportEmail: string | null }).supportEmail).toBe(SUPPORT);
  });

  it("says whether the address has an account yet", async () => {
    const owner = await makeOwner();
    const hashes = [sha256Hex(makeSecondTrialCode()), sha256Hex(makeSecondTrialCode())];
    codesMade.push(...hashes);
    expect((await saveSecondTrialCode(sql, { email: owner.email.toUpperCase(), codeHash: hashes[0] ?? "" })).hasAccount).toBe(true);
    const nobody = `${TAG}${run}nobody${randomBytes(3).toString("hex")}@gmail.com`;
    const saved = await saveSecondTrialCode(sql, { email: nobody, codeHash: hashes[1] ?? "" });
    expect(saved.hasAccount).toBe(false);
    const days = (saved.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(SECOND_TRIAL_CODE_DAYS - 0.01);
    expect(days).toBeLessThan(SECOND_TRIAL_CODE_DAYS + 0.01);
  });
});
