// WHAT A MEMBER FILE LEAVES BEHIND — spec Part 3 §9.9 ("Never logged, never in an
// error reply, never in Sentry: a cell, a name, an address, a number, the body") and
// §9.10's log capture.
//
// **WHY THIS FILE IS SEPARATE AND RUNS THE WHOLE LOGGER.** The other member-list
// suites run at `LOG_LEVEL=error`, so they would pass while every upload wrote a
// member's address at `info`. Here the app is built at the loudest level there is,
// every byte pino writes is captured, and the sentinels are a name, an email address
// and a phone number that appear nowhere in this repository except the file the test
// uploads — so a hit is a leak and not a coincidence.
//
// It drives the paths a cell could travel on: a good upload, a REFUSED upload (the
// refusal words are written by the server and printed as sent), a file nobody can
// map, a page of names read back, and an upload whose own request then faults.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LIVE_PLAN = "zz_memberlist_leak";
const TEST_TIMEOUT_MS = 60_000;

/** Made at run time, so no source line the logger might print can hold them. */
const NAME = `Marian ${randomUUID()}`;
const ADDRESS = `${randomUUID()}@realgym.example`;
const PHONE = "+447911223344";
const MEMBER_NUMBER = `MBR-${randomUUID()}`;
const STATUS_WORD = `Frozen-${randomUUID()}`;

const csv = (rows: string[][]): Buffer => Buffer.from(rows.map((r) => r.join(",")).join("\r\n"), "utf8");

/** One person, every field a sentinel. */
const FILE = csv([
  ["Full Name", "Email", "Mobile", "Member No", "Status"],
  [NAME, ADDRESS, PHONE, MEMBER_NUMBER, STATUS_WORD],
]);

d("a member file reaches no log (real Postgres, the loudest logger)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 3 });
  let written = "";
  let restore: (() => void) | undefined;

  beforeEach(() => {
    // pino writes to stdout, and the app builds its own logger with no seam, so the
    // capture goes where the bytes actually go. Every write is kept AND passed on,
    // so a failure is still readable.
    const real = process.stdout.write.bind(process.stdout);
    written = "";
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      written += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return Reflect.apply(real, process.stdout, [chunk, ...rest]) as boolean;
    });
    restore = () => {
      process.stdout.write = real;
    };
  });

  afterEach(() => {
    restore?.();
  });

  it(
    "not a name, an address, a phone number, a member number or a status word — through an upload, a refusal, a page of names, a fault, and a confirm the database refuses",
    async () => {
      const cleanup = async () => {
        const mine = sql`
          SELECT id FROM gyms WHERE owner_user_id IN
            (SELECT id FROM users WHERE email LIKE 'mleak-t-%@example.com')`;
        await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
        await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
        await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
        await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
        await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
        await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
        await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
        await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
        await sql`DELETE FROM gyms WHERE id IN (${mine})`;
        await sql`DELETE FROM users WHERE email LIKE 'mleak-t-%@example.com'`;
        await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
      };
      await cleanup();
      await sql`
        INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                           seat_cap, trial_days, rank, entitlements, member_entitlements)
        VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
                100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
        ON CONFLICT (code) DO UPDATE SET active = true`;

      // **`trace`, and request logging left ON** (`NODE_ENV` is not "test" for this
      // app, so Fastify logs every request as production does). This is the loudest
      // the server can be; a suite at `error` proves nothing about `info`.
      const app = await buildApp(
        loadConfig({
          NODE_ENV: "development",
          DATABASE_URL: url ?? "",
          WEB_ORIGIN: "http://localhost:5173",
          JWT_SECRET: "memberlist-leak-secret-0123456789", // dummy test value, gitleaks:allow
          LOG_LEVEL: "trace",
        }),
        { redis: createMemoryRedis() },
      );
      try {
        // A route that faults while the upload's own body is attached to the request:
        // the logger takes a request's body per request, not per route, so this is the
        // body of a member file arriving at a handler that then throws. Registered
        // BEFORE `ready()`, which is the only time Fastify accepts a route.
        app.post("/v1/mleak-probe/fault", () => Promise.reject(new Error("a fault nobody expected")));
        await app.ready();

        const email = "mleak-t-owner@example.com";
        const json = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
          app.inject({
            method: "POST",
            url: path,
            remoteAddress: "10.77.0.1",
            headers: { "content-type": "application/json" },
            cookies,
            payload: JSON.stringify(payload),
          });
        expect((await json("/v1/auth/register", { email, password: PASSWORD, displayName: "Leak Owner" })).statusCode).toBe(201);
        const login = await json("/v1/auth/login", { email, password: PASSWORD });
        const cookies = Object.fromEntries(login.cookies.map((c) => [c.name, c.value]));
        const made = await json("/v1/orgs", { name: "Leak Gym", city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
        expect(made.statusCode).toBe(201);
        const gymId = (JSON.parse(made.body) as { org: { id: string } }).org.id;
        await sql`
          INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
          VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;

        const uploads = `/v1/orgs/${gymId}/member-list/uploads`;
        const body = { contentBase64: FILE.toString("base64"), mode: "whole_list" };

        // 1. A good upload.
        const ok = await json(uploads, body, cookies);
        expect(ok.statusCode).toBe(201);
        const uploadId = (JSON.parse(ok.body) as { preview: { uploadId: string } }).preview.uploadId;

        // 2. The names read back — the one route whose whole job is to send them.
        const page = await app.inject({
          method: "GET",
          url: `${uploads}/${uploadId}/rows?group=new`,
          remoteAddress: "10.77.0.2",
          cookies,
        });
        expect(page.statusCode).toBe(200);
        expect(page.body).toContain(NAME); // it is SENT, deliberately…

        // 3. A file the server refuses, whose sentence it writes itself.
        const refused = await json(
          uploads,
          { contentBase64: Buffer.from("%PDF-1.7\n%junk\n").toString("base64"), mode: "whole_list" },
          cookies,
        );
        expect(refused.statusCode).toBe(400);

        // 4. A file nobody can map: its columns and its own cells go back to staff.
        const unmapped = await json(
          uploads,
          {
            contentBase64: csv([
              ["Mitgliedsnummer", "Vollständiger Name"],
              ["A-1", NAME],
            ]).toString("base64"),
            mode: "whole_list",
          },
          cookies,
        );
        expect(unmapped.statusCode).toBe(201);

        // 5. A fault, with a member file as the request's body.
        const fault = await json("/v1/mleak-probe/fault", body, cookies);
        expect(fault.statusCode).toBe(500);

        // 6. THE CARD'S OWN HAZARD, DRIVEN END TO END. Postgres puts the WHOLE failing
        //    row into a CHECK violation's `detail`, and pino's stock serializer copies
        //    every own property of an error onto the line. The confirm's INSERT of
        //    entries is the first statement in this feature CHECKed against a gym's
        //    real people, so it is the one that can draw one — and until now nothing
        //    drove that path: the unit test logs a hand-built error and `sentry.test`
        //    watches Sentry, not the log (review of PR #88).
        //
        //    A constraint that only this one name can violate, so nothing else running
        //    against this shared database is affected, and it is dropped in `finally`.
        const staged = await json(uploads, body, cookies);
        expect(staged.statusCode).toBe(201);
        const tripId = (JSON.parse(staged.body) as { preview: { uploadId: string } }).preview.uploadId;
        try {
          // SCOPED TO THIS GYM by its own id, so nothing else sharing this database
          // can be refused by it. DDL takes no bind parameter, and a uuid we made
          // ourselves is hex and dashes. Dropped in `finally` whatever happens.
          await sql.unsafe(
            `ALTER TABLE gym_member_list_entries ADD CONSTRAINT mleak_trip_wire ` +
              `CHECK (gym_id <> '${gymId}'::uuid OR full_name NOT LIKE 'Marian %')`,
          );
          const refusedByCheck = await json(`${uploads}/${tripId}/confirm`, {}, cookies);
          // It fails, and it fails as a fault rather than quietly writing a short list.
          expect(refusedByCheck.statusCode).toBe(500);
          // Nothing of the person is in the REPLY either.
          expect(refusedByCheck.body).not.toContain(NAME);
        } finally {
          await sql`ALTER TABLE gym_member_list_entries DROP CONSTRAINT IF EXISTS mleak_trip_wire`;
        }

        // …AND NONE OF IT IS IN THE LOG. Each sentinel is asserted on its own, so a
        // failure names which field escaped rather than only that something did.
        expect({
          name: written.includes(NAME),
          address: written.includes(ADDRESS),
          phone: written.includes(PHONE),
          memberNumber: written.includes(MEMBER_NUMBER),
          statusWord: written.includes(STATUS_WORD),
          // The base64 body itself: a log line holding it holds every person in the
          // file, one decode away.
          fileBody: written.includes(body.contentBase64.slice(0, 60)),
        }).toEqual({
          name: false,
          address: false,
          phone: false,
          memberNumber: false,
          statusWord: false,
          fileBody: false,
        });
        // THE CAPTURE REALLY WAS LISTENING, and to the REQUESTS — not merely to the
        // server starting up. `written.length > 0` was the first version of this
        // control and the boot lines alone satisfied it, so it would have stayed green
        // with request logging switched off entirely, which is the one setting that
        // makes every assertion above vacuous (review of PR #87). What is asserted now
        // is a line that only exists because a request was served, and the uploads
        // route's own url in it.
        expect(written).toContain('"msg":"request completed"');
        expect(written).toContain(`${uploads}"`);
      } finally {
        await app.close();
        await cleanup();
        await sql.end({ timeout: 5 });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
