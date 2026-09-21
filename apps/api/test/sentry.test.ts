// What the app sends Sentry, read where the SDK writes it: the real @sentry/node
// with the app's own options, the app on a real port, requests over HTTP, and a
// transport that records every envelope instead of sending it. A mock of the SDK,
// or fastify.inject, never passes through the HTTP server, which is where the SDK
// takes a request's body, headers and cookies.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import * as Sentry from "@sentry/node";
import postgres from "postgres";
import { z } from "zod";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { VisionProvider } from "../src/modules/nutrition/vision.adapter.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const PASSWORD = "sentry-safe-test-password-1"; // gitleaks:allow
const EMAIL = "sentry-probe@example.com";
const env = { NODE_ENV: "test", DATABASE_URL: url ?? "", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "sentry-test-secret-0123456789abcdef-32", LOG_LEVEL: "fatal", SENTRY_DSN: "https://public@sentry.example.invalid/1" }; // gitleaks:allow
type App = Awaited<ReturnType<typeof buildApp>>;

/** Values that must never reach Sentry, one for each way a request's data can travel.
 *  Made at run time, so the source lines Sentry sends around a stack frame cannot hold them. */
const HEADER = `header-${randomUUID()}`;
const QUERY = `query-${randomUUID()}`;
const OUTGOING = `food-search-${randomUUID()}`;
const TYPED_EMAIL = `${randomUUID()}@example.com`;
/** A MEMBER FILE'S BYTES, and one person in it. The upload route's body is a gym's
 *  whole list — thousands of names, addresses and phone numbers — which is the biggest
 *  single thing in this app that a request body can carry, so it is driven here beside
 *  the photo. The SDK takes a body per REQUEST, not per route, so a fault on any route
 *  carrying this body is the case that matters. */
const MEMBER_NAME = `Marian-${randomUUID()}`;
/** A person inside a DATABASE ERROR rather than inside a request body — the other
 *  way a member's details can reach a crash report, and the one nothing in the app
 *  had ever looked at. Postgres writes the whole refused row into the error. */
const ROW_NAME = `Amara-${randomUUID()}`;
const ROW_ADDRESS = `${randomUUID()}@realgym.example`;
/** Made at run time like the two above, and for the same reason: Sentry sends the
 *  SOURCE LINES around each stack frame, so a phone number written as a literal in
 *  the probe route below would be reported as part of the code and read as a leak. */
const ROW_PHONE = `+4479${String(randomBytes(4).readUInt32BE(0)).padStart(8, "0").slice(0, 8)}`;
const memberFile = Buffer.from(
  [`Full Name,Email`, `${MEMBER_NAME},${randomUUID()}@realgym.example`].join("\r\n"),
  "utf8",
).toString("base64");
const photo = (() => { const bytes = randomBytes(3000); bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; return bytes.toString("base64"); })();

/** What the SDK holds of the request it is serving, as far as this test reads it. */
const heldRequestSchema = z.object({ normalizedRequest: z.object({ method: z.string(), data: z.unknown().optional() }) });

d("what reaches Sentry: the real SDK, a real port, a recording transport", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });
  const envelopes: string[] = [];
  const recording = () => ({
    send: (envelope: unknown) => { envelopes.push(JSON.stringify(envelope)); return Promise.resolve({}); },
    flush: () => Promise.resolve(true),
  });
  let app: App | undefined;
  let base = "";
  let access = "";
  let refresh = "";
  let held: z.infer<typeof heldRequestSchema> | undefined;
  /** A scanner that, while the scan's request is served, reads what the SDK keeps of
   *  it, makes an outgoing call whose address carries words (as the food search's
   *  does), and then breaks: a fault nobody expected. */
  const scanner: VisionProvider = {
    async analyze() {
      held = heldRequestSchema.parse(Sentry.getIsolationScope().getScopeData().sdkProcessingMetadata);
      await fetch(`${base}/health?search_terms=${OUTGOING}`);
      throw new TypeError("Cannot read properties of undefined (reading 'parts')");
    },
  };

  beforeAll(async () => {
    await sql`DELETE FROM users WHERE email = ${EMAIL}`;
    const built = await buildApp(loadConfig(env), { redis: createMemoryRedis(), sentryTransport: recording, nutrition: { visionProvider: scanner, foodSearchProvider: { search: () => Promise.resolve([]) } } });
    app = built;
    // Any route's unhandled fault goes through the app's central error handler.
    built.post("/v1/sentry-probe/fault", () => Promise.reject(new Error("a fault nobody expected")));
    /** A REAL DATABASE REFUSAL, drawn by breaking a real CHECK on the member-list
     *  table. Postgres puts the WHOLE failing row into the error's `detail` — the
     *  person's name, address and phone number — and this is the route that proves
     *  none of it reaches Sentry (spec Part 3 §9.9; the hazard 3a-iii-a recorded
     *  for the confirm, which is the first statement in the feature that can draw
     *  one). The CHECK is evaluated before the foreign key, so no gym has to exist. */
    built.post("/v1/sentry-probe/db-fault", async () => {
      await sql`
        INSERT INTO gym_member_list_entries
          (gym_id, full_name, email, phone_e164, member_number, status, identity_key, source)
        VALUES ('11111111-2222-3333-4444-555555555555', ${ROW_NAME}, ${ROW_ADDRESS}, ${ROW_PHONE},
                'MBR-1', ${"x".repeat(60)}, ${"a".repeat(64)}, 'upload')`;
      return { never: true };
    });
    const inject = (path: string, body: unknown) => built.inject({ method: "POST", url: path, headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    expect((await inject("/v1/auth/register", { email: EMAIL, password: PASSWORD, displayName: "Sentry Probe" })).statusCode).toBe(201);
    const login = await inject("/v1/auth/login", { email: EMAIL, password: PASSWORD });
    access = login.cookies.find((c) => c.name === "accessToken")?.value ?? "";
    refresh = login.cookies.find((c) => c.name === "refreshToken")?.value ?? "";
    expect([access.length > 0, refresh.length > 0]).toEqual([true, true]);
    await built.listen({ port: 0, host: "127.0.0.1" });
    const address: AddressInfo | string | null = built.server.address();
    if (address === null || typeof address === "string") throw new Error("the app is not listening on a port");
    base = `http://127.0.0.1:${String(address.port)}`;
  }, 60_000);
  afterAll(async () => {
    if (app !== undefined) await app.close();
    await Sentry.close(2000);
    await sql`DELETE FROM users WHERE email = ${EMAIL}`;
    await sql.end({ timeout: 5 });
  });

  it("a scanner fault and a route's fault each send their error and request id, and nothing of the request: no body, cookie, header, query or outgoing call's words", async () => {
    const post = async (path: string, body: unknown) => {
      const res = await fetch(`${base}${path}?probe=${QUERY}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `accessToken=${access}; refreshToken=${refresh}`, "x-probe": HEADER },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: z.object({ error: z.string(), requestId: z.string() }).parse(await res.json()) };
    };
    const scan = await post("/v1/nutrition/analyze-photo", { imageBase64: photo, mimeType: "image/jpeg" });
    expect(scan).toMatchObject({ status: 503, body: { error: "nutrition_unavailable" } });
    const fault = await post("/v1/sentry-probe/fault", { email: TYPED_EMAIL, contentBase64: memberFile, mode: "whole_list" });
    expect(fault).toMatchObject({ status: 500, body: { error: "internal_error" } });
    expect(await Sentry.flush(5000)).toBe(true);

    const events = envelopes.filter((e) => e.includes('"exception"'));
    expect(events).toHaveLength(2);
    const sent = events.join("\n");
    for (const { error, requestId } of [
      { error: "Cannot read properties of undefined (reading 'parts')", requestId: scan.body.requestId },
      { error: "a fault nobody expected", requestId: fault.body.requestId },
    ]) {
      expect(events.some((e) => e.includes(error) && e.includes(`"requestId":"${requestId}"`)), error).toBe(true);
    }
    expect({
      photo: sent.includes(photo.slice(0, 100)) || sent.includes(photo.slice(-100)),
      typedEmail: sent.includes(TYPED_EMAIL),
      accessCookie: sent.includes(access),
      refreshCookie: sent.includes(refresh),
      header: sent.includes(HEADER),
      query: sent.includes(QUERY),
      memberFile: sent.includes(memberFile.slice(0, 60)) || sent.includes(memberFile.slice(-60)),
      memberName: sent.includes(MEMBER_NAME),
      outgoingCallWords: sent.includes(OUTGOING),
    }).toEqual({ photo: false, typedEmail: false, accessCookie: false, refreshCookie: false, header: false, query: false, memberFile: false, memberName: false, outgoingCallWords: false });
    // The SDK was serving the scan's request, and kept none of its body.
    expect(held?.normalizedRequest.method).toBe("POST");
    expect(held?.normalizedRequest.data).toBeUndefined();
  }, 30_000);

  it("a database refusal reaches Sentry as the rule that refused, never as the row it refused", async () => {
    envelopes.length = 0;
    const res = await fetch(`${base}/v1/sentry-probe/db-fault`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(500);
    const { requestId } = z.object({ error: z.string(), requestId: z.string() }).parse(await res.json());
    expect(await Sentry.flush(5000)).toBe(true);

    const events = envelopes.filter((e) => e.includes('"exception"'));
    expect(events).toHaveLength(1);
    const sent = events.join("\n");
    // THE CONTROL: the fault really was reported, and it says which rule refused.
    expect(sent).toContain(`"requestId":"${requestId}"`);
    expect(sent).toContain("violates check constraint");
    // AND NOT THE PERSON IN THE ROW. Without `scrubbedForSentry` the SDK is handed
    // an error whose `detail` is "Failing row contains (…, Amara …, …@…, +44…)".
    expect({
      name: sent.includes(ROW_NAME),
      address: sent.includes(ROW_ADDRESS),
      phone: sent.includes(ROW_PHONE),
      failingRow: sent.includes("Failing row contains"),
    }).toEqual({ name: false, address: false, phone: false, failingRow: false });
  }, 30_000);
});
