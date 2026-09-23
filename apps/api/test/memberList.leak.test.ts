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
/** **THE THREE WORDS FIT INSIDE `MEMBER_LIST_MAX_STATUS_CHARS`, AND THAT IS NOT
 *  TIDINESS.** A gym's status, membership and payment words are each cut at 40
 *  characters on the way in, so a 43-character sentinel is STORED as a 40-character
 *  prefix — and `written.includes(sentinel)` could then never match, however loudly the
 *  server printed it. The status sentinel here was `Frozen-${uuid}` (43) until 3a-v-b
 *  added the other two and the entries filter refused one as too long, which is what
 *  found it: a test that would have stayed green with the thing it checks broken. A
 *  uuid is unique in 36, so two letters of prefix are the whole budget. */
const STATUS_WORD = `F-${randomUUID()}`;
/** THE WIDER RECORD'S OWN SENTINELS (3a-v-b, §11.1): the gym's membership and payment
 *  words, a plain day, and a cell of one of the gym's OWN columns. The cell is the one
 *  worth naming on its own — it is free text a gym can put anything in, and it is the
 *  only value in this file that never existed before Part 2 of the re-plan. */
const MEMBERSHIP_WORD = `G-${randomUUID()}`;
const PAYMENT_WORD = `P-${randomUUID()}`;
const OWN_CELL = `Locker-${randomUUID()}`;
/** What staff TYPE by hand (3a-iv, §11.6): a person, a changed word, and one of the
 *  gym's own cells, each sent in a request body. */
const TYPED_NAME = `Typed ${randomUUID()}`;
const TYPED_ADDRESS = `${randomUUID()}@typed.example`;
const TYPED_PHONE = "+447911998877";
const TYPED_WORD = `T-${randomUUID()}`;
const TYPED_CELL = `Note-${randomUUID()}`;

const csv = (rows: string[][]): Buffer => Buffer.from(rows.map((r) => r.join(",")).join("\r\n"), "utf8");

/** One person, every field a sentinel — the five a list kept, and the wider record's. */
const FILE = csv([
  ["Full Name", "Email", "Mobile", "Member No", "Status", "Membership Type", "Payment Status", "Join Date", "Locker No"],
  [NAME, ADDRESS, PHONE, MEMBER_NUMBER, STATUS_WORD, MEMBERSHIP_WORD, PAYMENT_WORD, "03/04/2024", OWN_CELL],
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
        await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine})`;
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

        // 7. THE PATHS 3a-v-b ADDED, each of which takes one of the gym's own words or
        //    cells IN. The hand-edit refusal carries field NAMES, and the filters carry
        //    a word a gym typed — so a request logger writing its query string writes a
        //    member's membership word, and a refusal naming the record would write a
        //    name. The list here is applied first, so all of it is real data.
        const applied = await json(uploads, body, cookies);
        expect(applied.statusCode).toBe(201);
        const applyId = (JSON.parse(applied.body) as { preview: { uploadId: string } }).preview.uploadId;
        expect((await json(`${uploads}/${applyId}/confirm`, {}, cookies)).statusCode).toBe(200);

        const read = (path: string) =>
          app.inject({ method: "GET", url: path, remoteAddress: "10.77.0.3", cookies });
        const list = `/v1/orgs/${gymId}/member-list`;
        // The gym's own word in a query string, which a request logger prints.
        expect((await read(`${list}/entries?membershipType=${encodeURIComponent(MEMBERSHIP_WORD)}`)).statusCode).toBe(200);
        expect((await read(`${list}/entries?paymentStatus=${encodeURIComponent(PAYMENT_WORD)}`)).statusCode).toBe(200);
        expect((await read(`${list}/entries?records=former`)).statusCode).toBe(200);
        expect((await read(list)).statusCode).toBe(200);

        // AND THE HAND-EDIT REFUSAL, which is the one new reply that names FIELDS. A
        // reply that named the person instead would put a member's name in a 409.
        await sql`
          UPDATE gym_member_list_entries
          SET membership_type = ${`X-${randomUUID()}`}, hand_edited = ARRAY['membershipType']
          WHERE gym_id = ${gymId}`;
        const again = await json(uploads, body, cookies);
        expect(again.statusCode).toBe(201);
        const editId = (JSON.parse(again.body) as { preview: { uploadId: string } }).preview.uploadId;
        const handRefusal = await json(`${uploads}/${editId}/confirm`, {}, cookies);
        expect(handRefusal.statusCode).toBe(409);
        expect(handRefusal.body).not.toContain(NAME);
        expect(handRefusal.body).not.toContain(ADDRESS);

        // 8. KEEPING THE LIST BY HAND (3a-iv): a person typed in, changed, refused, read
        //    back, taken off and joined to another record — every value in a request
        //    body, and the one page whose job is to send them back.
        const send = (method: "POST" | "PATCH" | "DELETE", path: string, payload?: unknown) =>
          app.inject({
            method,
            url: path,
            remoteAddress: "10.77.0.4",
            cookies,
            ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
          });
        const typed = await send("POST", `${list}/entries`, { fullName: TYPED_NAME, email: TYPED_ADDRESS, phone: TYPED_PHONE });
        expect(typed.statusCode).toBe(201);
        const typedId = (JSON.parse(typed.body) as { entry: { entryId: string } }).entry.entryId;
        expect((await send("PATCH", `${list}/entries/${typedId}`, { status: TYPED_WORD, extra: { locker_no: TYPED_CELL } })).statusCode).toBe(200);
        const cardRefused = await send("PATCH", `${list}/entries/${typedId}`, { status: `${TYPED_WORD} 4111 1111 1111 1111` });
        expect(cardRefused.statusCode).toBe(400);
        expect(cardRefused.body).not.toContain(TYPED_WORD);
        const one = await read(`${list}/entries/${typedId}`);
        expect(one.body).toContain(TYPED_NAME); // it is SENT, deliberately…
        expect((await send("DELETE", `${list}/entries/${typedId}`)).statusCode).toBe(200);
        const [other] = await sql<{ id: string }[]>`
          SELECT id FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id <> ${typedId} LIMIT 1`;
        if (other === undefined) throw new Error("no second record to join");
        expect((await send("POST", `${list}/entries/${typedId}/merge`, { keepEntryId: other.id })).statusCode).toBe(200);
        expect((await read(`${list}/unlisted?group=never_listed`)).statusCode).toBe(200);

        // …AND NONE OF IT IS IN THE LOG. Each sentinel is asserted on its own, so a
        // failure names which field escaped rather than only that something did.
        expect({
          name: written.includes(NAME),
          address: written.includes(ADDRESS),
          phone: written.includes(PHONE),
          memberNumber: written.includes(MEMBER_NUMBER),
          statusWord: written.includes(STATUS_WORD),
          membershipWord: written.includes(MEMBERSHIP_WORD),
          paymentWord: written.includes(PAYMENT_WORD),
          // A cell of one of the gym's OWN columns: free text, and the one value here
          // that did not exist before Part 2 of the re-plan.
          ownColumnCell: written.includes(OWN_CELL),
          // The base64 body itself: a log line holding it holds every person in the
          // file, one decode away.
          fileBody: written.includes(body.contentBase64.slice(0, 60)),
          typedName: written.includes(TYPED_NAME),
          typedAddress: written.includes(TYPED_ADDRESS),
          typedPhone: written.includes(TYPED_PHONE),
          typedWord: written.includes(TYPED_WORD),
          typedCell: written.includes(TYPED_CELL),
        }).toEqual({
          name: false,
          address: false,
          phone: false,
          memberNumber: false,
          statusWord: false,
          membershipWord: false,
          paymentWord: false,
          ownColumnCell: false,
          fileBody: false,
          typedName: false,
          typedAddress: false,
          typedPhone: false,
          typedWord: false,
          typedCell: false,
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
        expect(written).toContain(`/member-list/entries/${typedId}"`);
      } finally {
        await app.close();
        await cleanup();
        await sql.end({ timeout: 5 });
      }
    },
    TEST_TIMEOUT_MS,
  );
});
