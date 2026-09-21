// AN ERROR SAYS WHAT WENT WRONG, NEVER WHO IT WENT WRONG ABOUT (spec Part 3 §9.9;
// the hazard 3a-iii-a recorded for this card).
//
// **THE ERROR HERE IS A REAL ONE AND THE TABLE IS THE REAL TABLE.** A hand-made
// object with a `detail` property would prove only that the code strips a property
// somebody wrote in a test; what is under test is what POSTGRES does, which is to
// put the whole failing row — a member's name, email address and phone number — into
// `detail` when it refuses a row. So the error below is drawn by breaking a real
// CHECK on `gym_member_list_entries`, and the first assertion is the CONTROL: that
// the raw error really does carry the person. Without it, every assertion after
// would pass against a database that had stopped saying anything at all.
//
// It also drives the WIRING and not only the rule (the class this repo keeps being
// caught by): the app's own logger, built by `buildApp`, with every byte it writes
// captured — because a serializer that is correct and not installed is no defence.
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { safeErrorSerializer, scrubbedForSentry } from "../src/logSafety.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

/** Made at run time, so no source line the logger might print can hold them. */
const NAME = `Amara ${randomUUID()}`;
const ADDRESS = `${randomUUID()}@realgym.example`;
const PHONE = "+447911223344";
const MEMBER_NUMBER = `MBR-${randomUUID()}`;

type App = Awaited<ReturnType<typeof buildApp>>;

d("a database error carries a person, and nothing we write carries it on", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 2 });

  /** The app's OWN logger, built at its loudest — and built while the capture is
   *  already in place, which is the whole trick. pino writes to the descriptor it
   *  was handed when it was constructed, so a capture installed afterwards records
   *  nothing at all and this test would pass against a logger printing the lot. */
  const buildCapturing = async (): Promise<{ app: App; written: () => string; stop: () => void }> => {
    const real = process.stdout.write.bind(process.stdout);
    let written = "";
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      written += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return Reflect.apply(real, process.stdout, [chunk, ...rest]) as boolean;
    });
    const app = await buildApp(
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: url ?? "",
        WEB_ORIGIN: "http://localhost:5173",
        JWT_SECRET: "logsafety-test-secret-0123456789ab", // dummy test value, gitleaks:allow
        LOG_LEVEL: "trace",
      }),
      { redis: createMemoryRedis() },
    );
    await app.ready();
    return {
      app,
      written: () => written,
      stop: () => {
        process.stdout.write = real;
      },
    };
  };

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /** THE REAL REFUSAL. A status longer than the column's CHECK allows, on a row
   *  carrying a whole person. The CHECK is evaluated before the foreign key, so no
   *  gym has to exist for this to be the error Postgres actually raises — which is
   *  itself worth knowing, because it means a bad row is refused with the person in
   *  it before anything about the gym is looked at. */
  const refusedRow = async (): Promise<Error> => {
    try {
      await sql`
        INSERT INTO gym_member_list_entries
          (gym_id, full_name, email, phone_e164, member_number, status, identity_key, source)
        VALUES ('11111111-2222-3333-4444-555555555555', ${NAME}, ${ADDRESS}, ${PHONE},
                ${MEMBER_NUMBER}, ${"x".repeat(60)}, ${"a".repeat(64)}, 'upload')`;
    } catch (err) {
      if (err instanceof Error) return err;
      throw new Error("the database refused the row with something that is not an Error");
    }
    throw new Error("the database ACCEPTED a row whose status is longer than its CHECK allows");
  };

  it("the raw error really does hold the failing row — the control every assertion below depends on", async () => {
    const err = await refusedRow();
    const carrier = err as unknown as Record<string, unknown>;
    expect(carrier["code"]).toBe("23514");
    expect(carrier["constraint_name"]).toBe("gym_member_list_entries_status_check");
    const held = carrier["detail"];
    const detail = typeof held === "string" ? held : "";
    // THE HAZARD, MEASURED RATHER THAN QUOTED: the person is in the error.
    expect(detail).toContain("Failing row contains");
    expect(detail).toContain(NAME);
    expect(detail).toContain(ADDRESS);
    expect(detail).toContain(PHONE);
    expect(detail).toContain(MEMBER_NUMBER);
    // And the message itself is safe: Postgres names the rule, not the row.
    expect(err.message).not.toContain(NAME);
  });

  it("the serializer keeps which rule refused and drops who it refused", async () => {
    const err = await refusedRow();
    const line = JSON.stringify(safeErrorSerializer(err));
    for (const secret of [NAME, ADDRESS, PHONE, MEMBER_NUMBER]) expect(line).not.toContain(secret);
    // AN ALLOWLIST IS ONLY WORTH HAVING IF IT STILL SAYS SOMETHING. An operator
    // reading this line has the constraint, the table and the code.
    expect(line).toContain("gym_member_list_entries_status_check");
    expect(line).toContain("gym_member_list_entries");
    expect(line).toContain("23514");
  });

  it("Sentry is handed the same error with everything that can quote a row taken off", async () => {
    const err = await refusedRow();
    const scrubbed = scrubbedForSentry(err);
    const carrier = scrubbed as Record<string, unknown>;
    expect("detail" in carrier).toBe(false);
    expect("where" in carrier).toBe(false);
    expect("internal_query" in carrier).toBe(false);
    // The stack is still the real one — Sentry's whole reason for wanting the
    // object rather than a copy of it.
    expect(err.stack).toContain("PostgresError");
    expect(JSON.stringify(carrier)).not.toContain(NAME);
  });

  it("THE WIRING: the app's own logger, at its loudest, writes the refusal without the person", async () => {
    const err = await refusedRow();
    const capture = await buildCapturing();
    let written = "";
    try {
      // Exactly what the central error handler does with an unexpected fault.
      capture.app.log.error({ err, requestId: "logsafety-probe" }, "unhandled error");
      written = capture.written();
    } finally {
      capture.stop();
      await capture.app.close();
    }
    // THE CONTROL: the line was written at all, and it says which rule refused.
    expect(written).toContain("logsafety-probe");
    expect(written).toContain("gym_member_list_entries_status_check");
    // AND NOT ONE FIELD OF THE PERSON. Without the serializer installed on the
    // app's logger, pino's own copies every property of the error and this line
    // holds the whole failing row.
    for (const secret of [NAME, ADDRESS, PHONE, MEMBER_NUMBER]) expect(written).not.toContain(secret);
    expect(written).not.toContain("Failing row contains");
  });
});
