// The published daily amounts beside the food figures (ROADMAP Stage 5 34b) against REAL Postgres.
// DATABASE_URL-gated. The first test is the job's worst thing: the wrong person's amounts.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { dailyAmountsResponseSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "ofp-test-secret-0123456789abcdef-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});
const noExternal: FoodSearchProvider = { search: () => Promise.resolve([]) };

type App = Awaited<ReturnType<typeof buildApp>>;
let ipCounter = 0;
const nextIp = () => `10.34.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

d("GET /v1/nutrition/daily-amounts", () => {
  let app: App;
  const sql = postgres(url ?? "", { max: 2 });
  const emails: string[] = [];

  beforeAll(async () => {
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender(), nutrition: { foodSearchProvider: noExternal } });
    await app.ready();
  });
  afterAll(async () => {
    if (emails.length > 0) await sql`DELETE FROM users WHERE email = ANY(${emails})`;
    await sql.end();
    await app.close();
  });

  const signedUp = async (): Promise<Record<string, string>> => {
    const email = `daily-${randomUUID()}@test.local`;
    emails.push(email);
    const res = await app.inject({
      method: "POST", url: "/v1/auth/register", remoteAddress: nextIp(),
      payload: { email, password: PASSWORD, displayName: "Daily" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", remoteAddress: nextIp(), payload: { email, password: PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    return Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
  };
  const read = (cookies: Record<string, string>) => app.inject({ method: "GET", url: "/v1/nutrition/daily-amounts", cookies });
  const answer = async (cookies: Record<string, string>, body: Record<string, unknown>) => {
    const res = await app.inject({ method: "PATCH", url: "/v1/users/me/onboarding", cookies, payload: body });
    expect(res.statusCode, res.body).toBe(200);
  };

  it("each person reads the amounts of their own age and gender, never another's", async () => {
    const woman = await signedUp();
    const man = await signedUp();
    await answer(woman, { age: 30, gender: "female" });
    await answer(man, { age: 30, gender: "male" });
    const hers = dailyAmountsResponseSchema.parse((await read(woman)).json());
    const his = dailyAmountsResponseSchema.parse((await read(man)).json());
    expect(hers.forWhom).toBe("women aged 19 to 30");
    expect(hers.amounts.ironMg).toEqual({ kind: "about", amount: 18 });
    expect(his.forWhom).toBe("men aged 19 to 30");
    expect(his.amounts.ironMg).toEqual({ kind: "about", amount: 8 });
  });

  it("somebody who has not answered reads the labels' Daily Values, and a changed answer shows at once", async () => {
    const person = await signedUp();
    const before = dailyAmountsResponseSchema.parse((await read(person)).json());
    expect(before.forWhom).toBeNull();
    expect(before.amounts.potassiumMg).toEqual({ kind: "about", amount: 4700 });
    await answer(person, { age: 55, gender: "female" });
    const after = dailyAmountsResponseSchema.parse((await read(person)).json());
    expect(after.forWhom).toBe("women aged 51 to 70");
    await answer(person, { gender: "prefer_not_to_say" });
    expect(dailyAmountsResponseSchema.parse((await read(person)).json()).forWhom).toBeNull();
  });

  it("nobody signed in is refused, and nothing about anybody comes back", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/nutrition/daily-amounts" });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain("amounts");
  });
});
