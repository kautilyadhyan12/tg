// The Exercise Library on the server (spec Part 2 §13.4, job 60b), against REAL Postgres.
// DATABASE_URL-gated. The first block is the job's worst thing on the real tables: a member's saved
// set whose exercise's file was deleted. Then publishing (rows, copies, a faulty file, two at once),
// the old routes left as they were, and the phone's download.
//
// Every publish that changes the Library runs in a transaction that is rolled back: the seed of every
// other test file publishes the real folder, and the publish lock keeps them waiting meanwhile.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { z } from "zod";
import { exerciseFileSchema, libraryDownloadSchema, libraryListSchema, type LibraryInput } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { channelFor } from "../src/modules/library/channel.js";
import { readLibraryFolder } from "../src/modules/library/folder.js";
import { LibraryRefused, publishLibrary } from "../src/modules/library/publish.js";
import { checkedCopyText, copyFor, newestCopyFor } from "../src/modules/library/repo.js";
import { holdsCopy } from "../src/modules/library/routes.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "library-test-secret-0123456789abc-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

let ipCounter = 0;
const nextIp = () => `10.60.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

class RolledBack extends Error {}

/** The real folder, with one more exercise: the barbell curl's file under another id and name. */
function withExtra(input: LibraryInput, id: string, name: string): LibraryInput {
  const curl = input.exerciseFiles.find((f) => f.name === "barbell_curl.json");
  if (curl === undefined) throw new Error("the real folder has no barbell_curl.json");
  const file = exerciseFileSchema.parse(JSON.parse(curl.text));
  const text = JSON.stringify({ ...file, id, text: { en: { ...file.text.en, name, otherNames: [] } } });
  return { ...input, exerciseFiles: [...input.exerciseFiles, { name: `${id}.json`, text }] };
}

const oldListSchema = z.object({ items: z.array(z.object({ slug: z.string() })) });

d("the Exercise Library on the server (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const real = readLibraryFolder();

  /** Runs `fn` in a transaction and rolls it back, whatever it did. */
  async function rolledBack(fn: (tx: TransactionSql) => Promise<void>): Promise<void> {
    await expect(
      sql.begin(async (tx) => {
        await fn(tx);
        throw new RolledBack();
      }),
    ).rejects.toBeInstanceOf(RolledBack);
  }

  const listIn = async (tx: TransactionSql) => {
    const rows = await tx<{ body: string }[]>`SELECT body FROM library_copies WHERE channel = 'live' ORDER BY version DESC LIMIT 1`;
    return libraryListSchema.parse(JSON.parse(rows[0]?.body ?? "null"));
  };
  const counts = async (tx: TransactionSql | Sql) =>
    (await tx<{ copies: number; rows: number; exercises: number }[]>`
      SELECT (SELECT count(*)::int FROM library_copies) AS copies,
             (SELECT count(*)::int FROM library_exercises) AS rows,
             (SELECT count(*)::int FROM exercises) AS exercises`)[0];

  /** A saved set naming this exercise, by a person made for it; returns the workout's id. */
  const saveSet = async (tx: TransactionSql, exerciseId: string, who: string): Promise<string> => {
    const user = (await tx<{ id: string }[]>`INSERT INTO users (email, display_name) VALUES (${`library-${who}@example.com`}, 'Library Set') RETURNING id`)[0]?.id ?? "";
    const workout = (await tx<{ id: string }[]>`
      INSERT INTO workouts (id, user_id, started_at, platform, engine_version) VALUES (gen_random_uuid(), ${user}, now(), 'android', '1') RETURNING id`)[0]?.id ?? "";
    await tx`
      INSERT INTO workout_sets (workout_id, user_id, exercise_id, started_at, set_index, mode, reps, duration_ms)
      VALUES (${workout}, ${user}, ${exerciseId}, now(), 0, 'log_only', 10, 30000)`;
    return workout;
  };
  const idOf = async (tx: TransactionSql, slug: string): Promise<string> =>
    (await tx<{ id: string }[]>`SELECT id FROM exercises WHERE slug = ${slug}`)[0]?.id ?? "";
  const statusOf = async (tx: TransactionSql, exerciseId: string): Promise<string | undefined> =>
    (await tx<{ status: string }[]>`SELECT status FROM library_exercises WHERE exercise_id = ${exerciseId}`)[0]?.status;

  const makeUser = async (name: string): Promise<{ cookies: Cookies; id: string }> => {
    const email = `library-${name}@example.com`;
    const inject = (path: string, body: unknown) =>
      api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    expect((await inject("/v1/auth/register", { email, password: PASSWORD, displayName: "Library Fixture" })).statusCode).toBe(201);
    const login = await inject("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const id = (await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`)[0]?.id;
    if (id === undefined) throw new Error(`no fixture ${name}`);
    return { cookies: cookieMap(login), id };
  };
  const get = (cookies: Cookies, headers: Record<string, string> = {}) =>
    api().inject({ method: "GET", url: "/v1/library", remoteAddress: nextIp(), headers, cookies });

  const mine = sql`SELECT id FROM users WHERE email LIKE 'library-%@example.com'`;
  const clear = async () => {
    await sql`DELETE FROM user_achievements WHERE user_id IN (${mine})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${mine})`;
    await sql`DELETE FROM workouts WHERE user_id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'library-%@example.com'`;
  };

  beforeAll(async () => {
    await seed(url ?? "");
    await clear();
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender() });
  }, 120_000);
  afterAll(async () => {
    await clear();
    await app?.close();
    await sql.end();
  });

  describe("the worst thing: a saved set never loses its exercise's name", () => {
    it("an exercise whose file is deleted while a saved set names it stays in the download, hidden, with its name", async () => {
      await rolledBack(async (tx) => {
        await publishLibrary(tx, withExtra(real, "zz_library_lift", "Library Test Lift"));
        const lift = await idOf(tx, "zz_library_lift");
        expect(lift).not.toBe("");
        const workout = await saveSet(tx, lift, "set");

        // The file is deleted; the set still names the exercise.
        const outcome = await publishLibrary(tx, real);
        expect(outcome).toMatchObject({ hidden: 1, removed: 0 });
        const kept = (await listIn(tx)).exercises.find((e) => e.id === "zz_library_lift");
        expect(kept?.status).toBe("hidden");
        expect(kept?.text.en.name).toBe("Library Test Lift");
        expect(await statusOf(tx, lift)).toBe("hidden");

        // Once no set names it, it is marked removed and leaves the download; both its rows stay.
        await tx`DELETE FROM workouts WHERE id = ${workout}`;
        expect(await publishLibrary(tx, real)).toMatchObject({ hidden: 0, removed: 1 });
        expect((await listIn(tx)).exercises.map((e) => e.id)).not.toContain("zz_library_lift");
        expect(await statusOf(tx, lift)).toBe("removed");
        expect(await tx`SELECT 1 FROM exercises WHERE id = ${lift}`).toHaveLength(1);
      });
    });

    it("an exercise whose file is deleted while only a SAVED WORKOUT names it stays in the download, hidden (61c)", async () => {
      await rolledBack(async (tx) => {
        await publishLibrary(tx, withExtra(real, "zz_library_planned", "Library Planned Lift"));
        const lift = await idOf(tx, "zz_library_planned");
        const user = (await tx<{ id: string }[]>`INSERT INTO users (email, display_name) VALUES ('library-planned@example.com', 'Library Plan') RETURNING id`)[0]?.id ?? "";
        const saved = randomUUID();
        await tx`INSERT INTO saved_workouts (id, user_id, name, edited_at) VALUES (${saved}, ${user}, 'Plan', now())`;
        await tx`INSERT INTO saved_workout_sets (saved_workout_id, exercise_place, set_place, exercise_id, measured_in, target)
                 VALUES (${saved}, 0, 0, ${lift}, 'reps', 10)`;

        expect(await publishLibrary(tx, real)).toMatchObject({ hidden: 1, removed: 0 });
        const kept = (await listIn(tx)).exercises.find((e) => e.id === "zz_library_planned");
        expect(kept?.status).toBe("hidden");
        expect(kept?.text.en.name).toBe("Library Planned Lift");

        // Once the saved workout is deleted, it is removed.
        await tx`DELETE FROM saved_workouts WHERE id = ${saved}`;
        expect(await publishLibrary(tx, real)).toMatchObject({ hidden: 0, removed: 1 });
        expect(await statusOf(tx, lift)).toBe("removed");
      });
    });

    it("a set that arrives after its exercise was removed brings it back to the download, hidden, with its name (round one's High)", async () => {
      await rolledBack(async (tx) => {
        await publishLibrary(tx, withExtra(real, "zz_library_late", "Library Late Lift"));
        const late = await idOf(tx, "zz_library_late");
        expect(await publishLibrary(tx, real)).toMatchObject({ removed: 1 });
        expect(await statusOf(tx, late)).toBe("removed");

        // An offline phone sends its workout after the publish.
        await saveSet(tx, late, "late");
        expect(await publishLibrary(tx, real)).toMatchObject({ hidden: 1, removed: 0 });
        const back = (await listIn(tx)).exercises.find((e) => e.id === "zz_library_late");
        expect(back?.status).toBe("hidden");
        expect(back?.text.en.name).toBe("Library Late Lift");
      });
    });

    it("one of the old 58 whose file is deleted stays in the download, hidden, though no set names it", async () => {
      await rolledBack(async (tx) => {
        await tx`DELETE FROM workout_sets WHERE exercise_id = ${await idOf(tx, "squat")}`;
        const noSquat = { ...real, exerciseFiles: real.exerciseFiles.filter((f) => f.name !== "squat.json") };
        expect(await publishLibrary(tx, noSquat)).toMatchObject({ hidden: 1, removed: 0 });
        expect((await listIn(tx)).exercises.find((e) => e.id === "squat")?.status).toBe("hidden");
      });
    });

    it("a stored entry that no longer reads as an exercise refuses the publish and changes nothing", async () => {
      await rolledBack(async (tx) => {
        await publishLibrary(tx, withExtra(real, "zz_library_broken", "Library Broken Lift"));
        const broken = await idOf(tx, "zz_library_broken");
        await saveSet(tx, broken, "broken");
        await tx`UPDATE library_exercises SET entry = '{"id": "zz_library_broken"}'::jsonb WHERE exercise_id = ${broken}`;
        const before = await counts(tx);
        const refused = await publishLibrary(tx, real).then(
          () => null,
          (err: unknown) => err,
        );
        expect(refused).toBeInstanceOf(LibraryRefused);
        expect(String(refused)).toContain("library_exercises (zz_library_broken)");
        expect(await counts(tx)).toEqual(before);
      });
    });
  });

  describe("publishing", () => {
    it("the real folder: the old exercises keep their row and id, a new one gets a row the old routes never show", async () => {
      const rows = await sql<{ slug: string; status: string; met: string; old_status: string; old_met: string; family: string | null }[]>`
        SELECT e.slug, l.status, l.met::text AS met, e.status AS old_status, e.met::text AS old_met, e.family
        FROM library_exercises l JOIN exercises e ON e.id = l.exercise_id ORDER BY e.slug`;
      expect(rows).toEqual([
        { slug: "barbell_curl", status: "live", met: "3.5", old_status: "hidden", old_met: "3.5", family: null },
        { slug: "plank", status: "live", met: "2.8", old_status: "live", old_met: "3.0", family: "F10" },
        { slug: "squat", status: "live", met: "3.0", old_status: "live", old_met: "6.0", family: "F1" },
      ]);
    });

    it("run again with nothing changed, it writes nothing and makes no copy", async () => {
      await rolledBack(async (tx) => {
        const before = await counts(tx);
        expect(await publishLibrary(tx, real)).toMatchObject({ written: 0, removed: 0, copies: [] });
        expect(await counts(tx)).toEqual(before);
      });
    });

    it("a changed file makes one new copy for each of live and beta, and the copy before is not changed", async () => {
      await rolledBack(async (tx) => {
        const before = await tx<{ version: number; body: string }[]>`SELECT version, body FROM library_copies ORDER BY version`;
        const changed = { ...real, exerciseFiles: real.exerciseFiles.map((f) => (f.name === "plank.json" ? { ...f, text: f.text.replace('"level": "intermediate"', '"level": "advanced"') } : f)) };
        const outcome = await publishLibrary(tx, changed);
        expect(outcome.written).toBe(1);
        expect(outcome.copies.map((c) => c.channel)).toEqual(["live", "beta"]);
        expect((await listIn(tx)).exercises.find((e) => e.id === "plank")?.level).toBe("advanced");
        const after = await tx<{ version: number; body: string }[]>`SELECT version, body FROM library_copies WHERE version = ANY(${before.map((b) => b.version)}::int[]) ORDER BY version`;
        expect(after).toEqual(before);
      });
    });

    it("a Library-only exercise's MET in the old table follows its Compendium code; an old row's never does", async () => {
      await rolledBack(async (tx) => {
        const recode = (input: LibraryInput, file: string, code: string): LibraryInput => ({
          ...input,
          exerciseFiles: input.exerciseFiles.map((f) => (f.name === file ? { ...f, text: f.text.replace(/"compendium": "\d{5}"/, `"compendium": "${code}"`) } : f)),
        });
        // The squat's code (MET 3.0) to the barbell curl (3.5), the curl's (3.5) to the plank (old MET 3.0).
        await publishLibrary(tx, recode(recode(real, "barbell_curl.json", "02056"), "plank.json", "02054"));
        const met = await tx<{ slug: string; met: string; library: string }[]>`
          SELECT e.slug, e.met::text AS met, l.met::text AS library FROM exercises e JOIN library_exercises l ON l.exercise_id = e.id
          WHERE e.slug IN ('barbell_curl', 'plank') ORDER BY e.slug`;
        expect(met).toEqual([
          { slug: "barbell_curl", met: "3.0", library: "3.0" },
          { slug: "plank", met: "3.0", library: "3.5" },
        ]);
      });
    });

    it("a faulty file refuses the whole publish, naming the file and the fact, and changes nothing", async () => {
      const broken = { ...real, exerciseFiles: real.exerciseFiles.map((f) => (f.name === "squat.json" ? { ...f, text: f.text.replace('"kind": "strength"', '"kind": "Strength"') } : f)) };
      await rolledBack(async (tx) => {
        const before = await counts(tx);
        const refused = await publishLibrary(tx, withExtra(broken, "zz_library_never", "Library Never")).then(
          () => null,
          (err: unknown) => err,
        );
        expect(refused).toBeInstanceOf(LibraryRefused);
        expect(String(refused)).toContain("squat.json · kind");
        expect(await counts(tx)).toEqual(before);
      });
    });

    it("two publishes at once: the second waits until the first is done", async () => {
      // Nothing is committed: the seed of every other test file publishes the real folder, and a
      // committed change here could meet one. That the second waits is the rule; with "run again
      // with nothing changed, it writes nothing" above, it is why two publishes never add two copies.
      let release = (): void => undefined;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let markLocked = (): void => undefined;
      const locked = new Promise<void>((r) => {
        markLocked = r;
      });
      const first = sql
        .begin(async (tx) => {
          await publishLibrary(tx, real);
          markLocked();
          await gate;
          throw new RolledBack();
        })
        .catch((err: unknown) => {
          if (!(err instanceof RolledBack)) throw err;
        });
      await locked;
      let secondDone = false;
      const second = sql.begin((tx) => publishLibrary(tx, real)).then((o) => {
        secondDone = true;
        return o;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(secondDone).toBe(false);
      release();
      await first;
      expect(await second).toMatchObject({ written: 0, copies: [] });
    });

    it("the old exercise list does not show the new exercise, and its old rows read as before", async () => {
      const me = await makeUser("old-list");
      const res = await api().inject({ method: "GET", url: "/v1/exercises?limit=100", remoteAddress: nextIp(), cookies: me.cookies });
      expect(res.statusCode).toBe(200);
      const slugs = oldListSchema.parse(JSON.parse(res.body)).items.map((i) => i.slug);
      expect(slugs).toHaveLength(58);
      expect(slugs).not.toContain("barbell_curl");
      expect(slugs).toContain("squat");
    });
    it("the old save route counts a set of the new exercise as unknown, as it does any name it does not know", async () => {
      const me = await makeUser("old-save");
      const workoutId = randomUUID();
      const set = (exercise: string, setIndex: number) => ({
        exercise, setIndex, reps: 10, durationMs: 30000, mode: "log_only", avgFormScore: null, repScores: null, faultCounts: {},
        tempoMsAvg: null, romStats: null, view: "unknown", holdMs: null, calibration: null, engineVersion: null, definitionVersion: null,
      });
      const res = await api().inject({
        method: "POST",
        url: "/v1/workouts/sync",
        remoteAddress: nextIp(),
        cookies: me.cookies,
        headers: { "content-type": "application/json", "idempotency-key": workoutId },
        payload: JSON.stringify({
          workoutId, startedAt: new Date(Date.now() - 3_600_000).toISOString(), platform: "web", engineVersion: "1.0.0", defsVersion: 1, traceSample: null,
          sets: [set("squat", 1), set("barbell_curl", 2)],
        }),
      });
      expect(res.statusCode).toBeLessThan(300);
      const saved = await sql<{ slug: string }[]>`
        SELECT e.slug FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id WHERE s.workout_id = ${workoutId}`;
      expect(saved.map((r) => r.slug)).toEqual(["squat"]);
      await sql`DELETE FROM workouts WHERE id = ${workoutId}`;
    });
  });

  describe("a word list that changed after a copy was made (63a, round one's High)", () => {
    /** The squat as a publish before 63a stored it: the old broad muscle words and no steadying row. */
    const oldSquat = () => {
      const squat = real.exerciseFiles.find((f) => f.name === "squat.json");
      if (squat === undefined) throw new Error("the real folder has no squat.json");
      const file = JSON.parse(squat.text) as Record<string, unknown>;
      return { ...file, status: "live", met: 3, muscles: { main: ["quadriceps", "glutes"], also: ["hamstrings"] } };
    };

    it("a copy published under the old muscle words is still served whole, as it was made", async () => {
      await rolledBack(async (tx) => {
        const body = JSON.stringify({ exercises: [oldSquat()], camera: [] });
        const version = (await tx<{ version: number }[]>`
          INSERT INTO library_copies (channel, sha256, body)
          VALUES ('live', ${createHash("sha256").update(body).digest("hex")}, ${body}) RETURNING version`)[0]?.version ?? 0;
        expect(await checkedCopyText(tx, version)).toBe(body);
      });
    });

    it("a publish carries on the stored entry of an exercise whose file is gone, in the words it was written under", async () => {
      await rolledBack(async (tx) => {
        await publishLibrary(tx, withExtra(real, "zz_library_old_words", "Library Old Words"));
        const lift = await idOf(tx, "zz_library_old_words");
        await saveSet(tx, lift, "old-words");
        // Its stored entry as an earlier word list wrote it.
        await tx`
          UPDATE library_exercises
          SET entry = jsonb_set(entry, '{muscles}', ${tx.json({ main: ["biceps"], also: ["forearms"] })})
          WHERE exercise_id = ${lift}`;
        expect(await publishLibrary(tx, real)).toMatchObject({ hidden: 1, removed: 0 });
        const rows = await tx<{ body: string }[]>`SELECT body FROM library_copies WHERE channel = 'live' ORDER BY version DESC LIMIT 1`;
        const kept = (JSON.parse(rows[0]?.body ?? "null") as { exercises: { id: string; status: string; muscles: unknown }[] }).exercises.find((e) => e.id === "zz_library_old_words");
        expect(kept?.status).toBe("hidden");
        expect(kept?.muscles).toEqual({ main: ["biceps"], also: ["forearms"], steady: [] });
      });
    });

    it("a stored entry that is not an exercise at all still refuses the publish", async () => {
      await rolledBack(async (tx) => {
        await publishLibrary(tx, withExtra(real, "zz_library_broken", "Library Broken"));
        const lift = await idOf(tx, "zz_library_broken");
        await saveSet(tx, lift, "broken");
        await tx`UPDATE library_exercises SET entry = jsonb_set(entry, '{text}', ${tx.json({})}) WHERE exercise_id = ${lift}`;
        await expect(publishLibrary(tx, real)).rejects.toBeInstanceOf(LibraryRefused);
      });
    });
  });

  describe("the phone's download", () => {
    it("a signed-in person gets the whole list with its fingerprint, the same as the ETag", async () => {
      const me = await makeUser("download");
      const res = await get(me.cookies);
      expect(res.statusCode).toBe(200);
      const body = libraryDownloadSchema.parse(JSON.parse(res.body));
      expect(res.headers["etag"]).toBe(`"${body.fingerprint}"`);
      expect(res.headers["cache-control"]).toBe("private, no-cache");
      expect(body.list.exercises.map((e) => [e.id, e.status, e.met])).toEqual([
        ["barbell_curl", "live", 3.5],
        ["plank", "live", 2.8],
        ["squat", "live", 3],
      ]);
      expect(body.list.camera).toEqual([]);
    });

    it("a phone that already holds the copy is answered 304 with no body; one holding an older copy gets the new one", async () => {
      const me = await makeUser("not-changed");
      const etag = (await get(me.cookies)).headers["etag"];
      expect(typeof etag).toBe("string");
      const same = await get(me.cookies, { "if-none-match": String(etag) });
      expect(same.statusCode).toBe(304);
      expect(same.body).toBe("");
      const older = await get(me.cookies, { "if-none-match": `"${"0".repeat(64)}"` });
      expect(older.statusCode).toBe(200);
    });

    it("the download's choice: a person the beta flag lists gets beta's copy, everyone else live's", async () => {
      const me = await makeUser("beta");
      const other = await makeUser("not-beta");
      await rolledBack(async (tx) => {
        // In the transaction only: the old exercise test sets this flag for its own people meanwhile.
        await tx`UPDATE feature_flags SET rules = ${tx.json({ userIds: [me.id] })} WHERE key = 'beta_definitions'`;
        const beta = (await tx<{ version: number }[]>`
          INSERT INTO library_copies (channel, sha256, body) VALUES ('beta', ${"d".repeat(64)}, '{}') RETURNING version`)[0]?.version;
        expect((await copyFor(tx, me.id))?.version).toBe(beta);
        expect((await copyFor(tx, other.id))?.version).toBe((await newestCopyFor(tx, "live"))?.version);
      });
    });

    it("a tester on beta gets beta's newest copy, and live's while beta has none", async () => {
      await rolledBack(async (tx) => {
        const live = await newestCopyFor(tx, "live");
        const beta = (await tx<{ version: number }[]>`
          INSERT INTO library_copies (channel, sha256, body) VALUES ('beta', ${"b".repeat(64)}, '{}') RETURNING version`)[0]?.version;
        expect((await newestCopyFor(tx, "beta"))?.version).toBe(beta);
        expect((await newestCopyFor(tx, "live"))?.version).toBe(live?.version);
        await tx`DELETE FROM library_copies WHERE channel = 'beta'`;
        expect(await newestCopyFor(tx, "beta")).toEqual(live);
      });
    });

    it("a copy whose text does not match its fingerprint, or does not read as a list, never reaches a phone", async () => {
      await rolledBack(async (tx) => {
        const good = await newestCopyFor(tx, "live");
        expect(JSON.parse(await checkedCopyText(tx, good?.version ?? 0))).toHaveProperty("exercises");
        const add = async (sha: string, body: string) =>
          (await tx<{ version: number }[]>`INSERT INTO library_copies (channel, sha256, body) VALUES ('live', ${sha}, ${body}) RETURNING version`)[0]?.version ?? 0;
        const tampered = await add("c".repeat(64), '{"camera":[],"exercises":[]}');
        await expect(checkedCopyText(tx, tampered)).rejects.toThrow("does not match its fingerprint");
        const body = '{"exercises":"not a list"}';
        const misshapen = await add(createHash("sha256").update(body).digest("hex"), body);
        await expect(checkedCopyText(tx, misshapen)).rejects.toThrow();
      });
    });

    it("nobody signed in gets nothing", async () => {
      const res = await get({});
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain("squat");
    });
  });
});

describe("a phone's tag, compared weakly (RFC 9110 §13.1.2)", () => {
  const etag = `"${"a".repeat(64)}"`;
  it.each([
    { name: "no header", header: undefined, holds: false },
    { name: "the same tag", header: etag, holds: true },
    { name: "the same tag, weakened by a proxy", header: `W/${etag}`, holds: true },
    { name: "any copy", header: "*", holds: true },
    { name: "among others", header: `"old", ${etag}`, holds: true },
    { name: "another tag", header: `"${"b".repeat(64)}"`, holds: false },
    { name: "the tag without its quotes", header: "a".repeat(64), holds: false },
  ])("$name: $holds", ({ header, holds }) => {
    expect(holdsCopy(header, etag)).toBe(holds);
  });
});

describe("which copy a person downloads", () => {
  const me = "7b0c5e1e-6d4a-4f39-9a51-2f0f5d1b2c3d";
  it.each([
    { name: "no flag", rules: null, channel: "live" },
    { name: "an empty flag", rules: {}, channel: "live" },
    { name: "a malformed flag", rules: { userIds: "everyone" }, channel: "live" },
    { name: "a flag that lists somebody else", rules: { userIds: ["0b7a4f0e-1c2d-4e3f-8a9b-0c1d2e3f4a5b"] }, channel: "live" },
    { name: "a flag that lists this person", rules: { userIds: [me] }, channel: "beta" },
  ])("$name: $channel", ({ rules, channel }) => {
    expect(channelFor(rules, me)).toBe(channel);
  });
});
