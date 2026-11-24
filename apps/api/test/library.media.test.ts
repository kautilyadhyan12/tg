// An exercise's picture and clip on the server (job 62a), against REAL Postgres. DATABASE_URL-gated.
// The first block is the job's worst thing: another exercise's picture or clip sent under a name, so somebody copies
// the wrong movement. The bytes sent are only ever the ones the name names, and only for a file an exercise names.
//
// The squat's, the plank's and the curl's published rows are given test pictures while the publish lock is held on one
// connection of this file's own, and put back before it is let go: every other test file's seed publishes the real
// folder, and waits for the lock meanwhile, so it never sees, or undoes, the test's rows.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type ReservedSql } from "postgres";
import { libraryMediaFileSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { seed } from "../src/db/seed.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import { createDiskMediaStore, holdsItsName, type LibraryMediaStore } from "../src/modules/library/media.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "library-media-secret-0123456789ab-32", // dummy test value, gitleaks:allow
  LOG_LEVEL: "fatal",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const silentAuthSender = (): EmailSender => ({
  sendVerificationEmail: () => Promise.resolve(),
  sendPasswordResetEmail: () => Promise.resolve(),
  sendSignInCodeEmail: () => Promise.resolve(),
});

let ipCounter = 0;
const nextIp = () => `10.62.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const named = (file: string) => libraryMediaFileSchema.parse(file);

/** A WebP's and an MP4's first bytes, then something of the exercise's own, so each has its own sha256. */
const webp = (what: string) => Buffer.concat([Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8 ", "latin1"), Buffer.from(what)]);
const mp4 = (what: string) => Buffer.concat([Buffer.from("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00", "latin1"), Buffer.from(what)]);

const SQUAT_PICTURE = webp("the squat's own picture");
const PLANK_PICTURE = webp("the plank's own picture");
const SQUAT_CLIP = mp4("the squat's own clip");
const SQUAT_PICTURE_FILE = `${sha(SQUAT_PICTURE)}.webp`;
const PLANK_PICTURE_FILE = `${sha(PLANK_PICTURE)}.webp`;
const SQUAT_CLIP_FILE = `${sha(SQUAT_CLIP)}.mp4`;
/** The name the plank's clip is published under; the server's file of that name holds the squat's clip: swapped. */
const PLANK_CLIP_FILE = `${sha(mp4("the plank's own clip, as it was made"))}.mp4`;
/** A file on the server that no exercise names. */
const LOOSE = webp("a picture no exercise names");
const LOOSE_FILE = `${sha(LOOSE)}.webp`;
/** Bytes that are their name's sha256 but not a WebP: named by the removed exercise below. */
const NOT_A_PICTURE = Buffer.from("plain words, named as if they were a picture");
const NOT_A_PICTURE_FILE = `${sha(NOT_A_PICTURE)}.webp`;

/** What the server's folder holds, by name; the plank's clip holds the squat's clip's bytes. */
const held = new Map<string, Buffer>([
  [SQUAT_PICTURE_FILE, SQUAT_PICTURE],
  [PLANK_PICTURE_FILE, PLANK_PICTURE],
  [SQUAT_CLIP_FILE, SQUAT_CLIP],
  [PLANK_CLIP_FILE, SQUAT_CLIP],
  [LOOSE_FILE, LOOSE],
  [NOT_A_PICTURE_FILE, NOT_A_PICTURE],
]);
const store: LibraryMediaStore = { read: (file) => Promise.resolve(held.get(file) ?? null) };

const picture = (file: string) => ({ file, width: 720, height: 1280, bytes: 30_000, ground: "#D5D5D5" });
const clip = (file: string) => ({ file, width: 720, height: 1280, bytes: 188_000, seconds: 4 });

d("an exercise's picture and clip (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 3 });
  let app: App | undefined;
  let lock: ReservedSql | undefined;
  /** The rows as the seed published them, put back before the lock is let go. */
  const before = new Map<string, { entry: string; status: string }>();
  let cookies: Cookies = {};
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const media = (file: string, headers: Record<string, string> = {}, who: Cookies = cookies) =>
    api().inject({ method: "GET", url: `/v1/library/media/${file}`, remoteAddress: nextIp(), headers, cookies: who });

  beforeAll(async () => {
    await seed(url ?? "");
    await sql`DELETE FROM users WHERE email = 'library-media@example.com'`;
    app = await buildApp(loadConfig(baseEnv), { emailSender: silentAuthSender(), libraryMedia: store });
    const inject = (path: string, body: unknown) =>
      api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
    expect((await inject("/v1/auth/register", { email: "library-media@example.com", password: PASSWORD, displayName: "Media Fixture" })).statusCode).toBe(201);
    const login = await inject("/v1/auth/login", { email: "library-media@example.com", password: PASSWORD });
    expect(login.statusCode).toBe(200);
    cookies = cookieMap(login);

    const own = await sql.reserve();
    lock = own;
    await own`SELECT pg_advisory_lock(hashtext('library:publish'))`;
    const rows = await own<{ slug: string; exercise_id: string; entry: string; status: string }[]>`
      SELECT e.slug, l.exercise_id, l.entry::text AS entry, l.status
      FROM library_exercises l JOIN exercises e ON e.id = l.exercise_id
      WHERE e.slug IN ('squat', 'plank', 'barbell_curl')`;
    const set = async (slug: string, change: Record<string, unknown>, status?: string) => {
      const row = rows.find((r) => r.slug === slug);
      if (row === undefined) throw new Error(`the seed published no ${slug}`);
      before.set(row.exercise_id, { entry: row.entry, status: row.status });
      await own`
        UPDATE library_exercises SET entry = entry || ${JSON.stringify(change)}::text::jsonb, status = ${status ?? row.status}
        WHERE exercise_id = ${row.exercise_id}`;
    };
    await set("squat", { picture: picture(SQUAT_PICTURE_FILE), clip: clip(SQUAT_CLIP_FILE) });
    await set("plank", { picture: picture(PLANK_PICTURE_FILE), clip: clip(PLANK_CLIP_FILE) });
    // A removed exercise's picture is no longer sent: the curl stands in for one.
    await set("barbell_curl", { picture: picture(NOT_A_PICTURE_FILE), clip: clip(LOOSE_FILE) }, "removed");
  }, 120_000);

  afterAll(async () => {
    if (lock !== undefined) {
      for (const [id, was] of before) {
        await lock`UPDATE library_exercises SET entry = ${was.entry}::text::jsonb, status = ${was.status} WHERE exercise_id = ${id}`;
      }
      await lock`SELECT pg_advisory_unlock(hashtext('library:publish'))`;
      lock.release();
    }
    await sql`DELETE FROM users WHERE email = 'library-media@example.com'`;
    await app?.close();
    await sql.end();
  });

  describe("the worst thing: never another exercise's picture or clip", () => {
    it("each name sends exactly its own exercise's bytes, as what its ending says", async () => {
      for (const [file, bytes, type] of [
        [SQUAT_PICTURE_FILE, SQUAT_PICTURE, "image/webp"],
        [PLANK_PICTURE_FILE, PLANK_PICTURE, "image/webp"],
        [SQUAT_CLIP_FILE, SQUAT_CLIP, "video/mp4"],
      ] as const) {
        const res = await media(file);
        expect(res.statusCode, file).toBe(200);
        expect(res.rawPayload.equals(bytes), file).toBe(true);
        expect(res.headers["content-type"]).toBe(type);
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
      }
    });

    it("the plank's clip, whose file on the server holds the squat's clip (swapped), is never sent: 404", async () => {
      const res = await media(PLANK_CLIP_FILE);
      expect(res.statusCode).toBe(404);
      expect(res.rawPayload.includes(Buffer.from("the squat's own clip"))).toBe(false);
    });

    it("bytes are sent only when they are their name's sha256 and what its ending says", () => {
      expect(holdsItsName(named(SQUAT_PICTURE_FILE), SQUAT_PICTURE)).toBe(true);
      expect(holdsItsName(named(SQUAT_PICTURE_FILE), PLANK_PICTURE)).toBe(false);
      expect(holdsItsName(named(NOT_A_PICTURE_FILE), NOT_A_PICTURE)).toBe(false);
      expect(holdsItsName(named(`${SQUAT_PICTURE_FILE.slice(0, 64)}.mp4`), SQUAT_PICTURE)).toBe(false);
    });
  });

  describe("the address reads nothing else", () => {
    it("a file the server holds that no exercise names is 404", async () => {
      expect((await media(LOOSE_FILE)).statusCode).toBe(404);
    });

    it("a removed exercise's picture is 404, whatever the server holds", async () => {
      expect((await media(NOT_A_PICTURE_FILE)).statusCode).toBe(404);
    });

    it("a name an exercise names that the server does not hold is 404 (the phone keeps the app's own picture)", async () => {
      held.delete(PLANK_PICTURE_FILE);
      try {
        expect((await media(PLANK_PICTURE_FILE)).statusCode).toBe(404);
      } finally {
        held.set(PLANK_PICTURE_FILE, PLANK_PICTURE);
      }
    });

    it("anything that is not a sha256 with .webp or .mp4 is refused before anything is read", async () => {
      const hash = SQUAT_PICTURE_FILE.slice(0, 64);
      for (const bad of ["..%2F..%2Fpackage.json", "squat.webp", hash.toUpperCase() + ".webp", `${hash}.png`, `${hash}.webp.webp`, `${hash.slice(1)}.webp`]) {
        const res = await media(bad);
        expect(res.statusCode, bad).toBe(400);
        expect(res.json()).toMatchObject({ error: "validation_error" });
      }
    });

    it("a signed-out caller gets 401, never the bytes", async () => {
      const res = await media(SQUAT_PICTURE_FILE, {}, {});
      expect(res.statusCode).toBe(401);
      expect(res.rawPayload.includes(Buffer.from("the squat's own picture"))).toBe(false);
    });
  });

  it("a phone that holds the file is told so (304), and a file is kept a year", async () => {
    const first = await media(SQUAT_PICTURE_FILE);
    expect(first.headers["etag"]).toBe(`"${SQUAT_PICTURE_FILE.slice(0, 64)}"`);
    expect(first.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    const again = await media(SQUAT_PICTURE_FILE, { "if-none-match": `W/"${SQUAT_PICTURE_FILE.slice(0, 64)}"` });
    expect(again.statusCode).toBe(304);
    expect(again.rawPayload.length).toBe(0);
  });
});

describe("the server's folder", () => {
  it("reads a file it holds and answers null for one it does not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aihg-media-"));
    try {
      writeFileSync(join(dir, SQUAT_PICTURE_FILE), SQUAT_PICTURE);
      const disk = createDiskMediaStore(dir);
      expect((await disk.read(named(SQUAT_PICTURE_FILE)))?.equals(SQUAT_PICTURE)).toBe(true);
      expect(await disk.read(named(PLANK_PICTURE_FILE))).toBeNull();
      expect(await createDiskMediaStore(join(dir, "no-such-folder")).read(named(SQUAT_PICTURE_FILE))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
