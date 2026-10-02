// Photos on a gym's own page — routes against real Postgres (DATABASE_URL-gated) and the
// real disk store in a folder of the test's own. ROADMAP 20c-iv-b; spec Part 3 §16.3.
//
// The first block is the worst thing this job could do to a real person: a phone photo
// published with the place it was taken. It is checked on the file the store really
// holds and on the bytes a stranger on the internet is really sent.
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import type { RobotCheck } from "../src/modules/orgs/gymPage/robotCheck.js";
import { GYM_PAGE_MAX_PHOTOS, type GymPage, type GymPagePhoto, type PublicGymPage } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-photo-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // The join door is a fixture here; join codes are off by default (ROADMAP 3c).
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 120_000;
const LIVE_PLAN = "zz_gym_page_photos";

const photo = (name: string): string => readFileSync(new URL(`./fixtures/photos/${name}`, import.meta.url)).toString("base64");
const IPHONE = photo("iphone16.jpg");
const SAMSUNG = photo("samsung-a56-meta.jpg");
const PNG = photo("iphone16-exif.png");
const WEBP = photo("iphone16-exif.webp");

/** The GPS block's tag, either byte order, anywhere before the picture starts. */
const hasGps = (bytes: Uint8Array): boolean => {
  const s = Buffer.from(bytes).toString("latin1");
  const scan = s.indexOf("\xff\xda", s.indexOf("\xff\xc0"));
  const header = s.slice(0, scan === -1 ? s.length : scan);
  return /\x88\x25|\x25\x88/.test(header) || header.includes("iPhone");
};

let ipCounter = 0;
const nextIp = () => `10.64.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const passing: RobotCheck = { siteKey: "test-site-key", verify: () => Promise.resolve("passed") };

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

/** Every chunk type of a PNG or a WebP, as a reader of this test's own walks them. */
function chunkTypes(b: Uint8Array): string[] {
  const buf = Buffer.from(b);
  const types: string[] = [];
  if (buf.subarray(0, 4).toString("latin1") === "RIFF") {
    for (let at = 12; at < buf.length; ) {
      const length = buf.readUInt32LE(at + 4);
      types.push(buf.subarray(at, at + 4).toString("latin1"));
      at += 8 + length + (length % 2);
    }
  } else {
    for (let at = 8; at < buf.length; ) {
      const length = buf.readUInt32BE(at);
      types.push(buf.subarray(at + 4, at + 8).toString("latin1"));
      at += 12 + length;
    }
  }
  return types;
}

let puts = 0;
let gate: { need: number; arrived: number; open: () => void; opened: Promise<void> } | null = null;
const closeGate = (need: number): void => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  gate = { need, arrived: 0, open, opened };
};

d("photos on a gym's page (real Postgres, real disk)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let app: App | undefined;
  /** A second api on the same database and folder: one api holds one connection, so
   *  two uploads race only across two of them. */
  let second: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'gphoto-t-%@example.com')`;
    await sql`DELETE FROM gym_page_photos WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_pages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'gphoto-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (target: App, method: "GET" | "POST" | "PUT" | "DELETE", path: string, payload: unknown, cookies: Record<string, string>) =>
    target.inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Record<string, string> = {}) => send(api(), "GET", path, undefined, cookies);
  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) => send(api(), "POST", path, payload, cookies);
  const put = (path: string, payload: unknown, cookies: Record<string, string>) => send(api(), "PUT", path, payload, cookies);
  const del = (path: string, cookies: Record<string, string>) => send(api(), "DELETE", path, undefined, cookies);

  const makeUser = async (local: string) => {
    const email = `gphoto-t-${local}@example.com`;
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Photo ${local}` })).statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { email, cookies: cookieMap(login) };
  };

  const makeOrg = async (cookies: Record<string, string>, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };

  const makeStaff = async (org: CreatedOrg, owner: Record<string, string>, local: string, role: "manager" | "trainer") => {
    const person = await makeUser(local);
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id ?? "";
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner)).statusCode).toBe(200);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role }, owner)).statusCode).toBe(201);
    return person;
  };

  const photosUrl = (gymId: string) => `/v1/orgs/${gymId}/page/photos`;
  const staffPhotoUrl = (gymId: string, id: string) => `${photosUrl(gymId)}/${id}`;
  const publicPhotoUrl = (slug: string, id: string) => `/v1/public/gyms/${slug}/photos/${id}`;
  const switchOn = async (org: CreatedOrg, cookies: Record<string, string>, shown = true) => {
    expect((await put(`/v1/orgs/${org.org.id}/page`, { shown, about: "", facilities: [], ownFacilities: [] }, cookies)).statusCode).toBe(200);
  };
  const add = async (org: CreatedOrg, cookies: Record<string, string>, contentBase64 = IPHONE): Promise<GymPagePhoto> => {
    const res = await post(photosUrl(org.org.id), { contentBase64, uploadKey: randomUUID() }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { photo: GymPagePhoto }).photo;
  };
  const stored = async (gymId: string) =>
    await sql<{ id: string; storage_key: string; content_type: string; position: number }[]>`
      SELECT id, storage_key, content_type, position FROM gym_page_photos WHERE gym_id = ${gymId} ORDER BY position`;
  const filesOf = async (gymId: string): Promise<string[]> => {
    try {
      return (await readdir(join(folder, "gym-page", gymId))).sort();
    } catch {
      return [];
    }
  };

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-photo-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const disk = createDiskPhotoStore(folder);
    const overrides = {
      emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
      robotCheck: passing,
      // The disk store, with a gate a test can close: every write waits there until the
      // number it names have arrived, so two requests are proved to be past the same point.
      photoStore: {
        put: async (key: string, bytes: Uint8Array) => {
          puts += 1;
          if (gate !== null) {
            gate.arrived += 1;
            if (gate.arrived >= gate.need) gate.open();
            await gate.opened;
          }
          await disk.put(key, bytes);
        },
        get: (key: string) => disk.get(key),
        remove: (key: string) => disk.remove(key),
      },
    };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await sql.end({ timeout: 5 });
    if (folder !== "") await rm(folder, { recursive: true, force: true });
  }, TIMEOUT_MS);

  // ── THE WORST THING: A PHOTO PUBLISHED WITH WHERE IT WAS TAKEN ──────────────

  it(
    "a phone photo with its GPS position is kept and shown with no position in it, from every format",
    async () => {
      const owner = await makeUser("worst-owner");
      const gym = await makeOrg(owner.cookies, "Harbour Gym");
      await switchOn(gym, owner.cookies);
      for (const [name, base64, type, maker] of [
        ["iphone16.jpg", IPHONE, "image/jpeg", "Apple"],
        ["samsung-a56-meta.jpg", SAMSUNG, "image/jpeg", "samsung"],
        ["iphone16-exif.png", PNG, "image/png", "Apple"],
        ["iphone16-exif.webp", WEBP, "image/webp", "Apple"],
      ] as const) {
        const sent = Buffer.from(base64, "base64");
        // What is sent carries the phone's own EXIF (its maker's name) and, for a JPEG,
        // the GPS block.
        expect(sent.toString("latin1")).toContain(maker);
        if (type === "image/jpeg") expect(hasGps(new Uint8Array(sent))).toBe(true);
        const added = await add(gym, owner.cookies, base64);
        const row = (await stored(gym.org.id)).find((r) => r.id === added.id);
        expect(row?.content_type).toBe(type);
        // The file on disk…
        const onDisk = new Uint8Array(await readFile(join(folder, ...(row?.storage_key ?? "").split("/"))));
        expect(hasGps(onDisk), `${name} on disk`).toBe(false);
        expect(Buffer.from(onDisk).toString("latin1"), `${name} on disk`).not.toContain(maker);
        // A PNG's or WebP's metadata is in chunks of its own: none of them is on disk.
        if (type !== "image/jpeg") {
          expect(chunkTypes(new Uint8Array(sent))).toEqual(expect.arrayContaining(type === "image/png" ? ["eXIf", "iTXt"] : ["EXIF", "XMP "]));
          for (const chunk of ["eXIf", "iTXt", "tEXt", "zTXt", "EXIF", "XMP "]) expect(chunkTypes(onDisk), `${name} on disk`).not.toContain(chunk);
        }
        // …and what anybody on the internet is sent.
        const shown = await get(publicPhotoUrl(gym.org.slug, added.id));
        expect(shown.statusCode).toBe(200);
        expect(shown.headers["content-type"]).toBe(type);
        expect(Buffer.from(shown.rawPayload).equals(Buffer.from(onDisk))).toBe(true);
      }
      // The iPhone photo was one the server read, not a stand-in: its real size.
      const page = JSON.parse((await get(`/v1/public/gyms/${gym.org.slug}`)).body) as { page: PublicGymPage };
      expect(page.page.photos[0]).toMatchObject({ width: 2935, height: 2479 });
      // The Galaxy's photo, held sideways (orientation 6): kept at the size it is shown.
      expect(page.page.photos[1]).toMatchObject({ width: 72, height: 96 });
    },
    TIMEOUT_MS,
  );

  // ── WHO MAY ─────────────────────────────────────────────────────────────────

  it(
    "only the owner adds, removes and moves; a manager sees them; a trainer, another gym and a stranger get nothing",
    async () => {
      const owner = await makeUser("who-owner");
      const rival = await makeUser("who-rival");
      const stranger = await makeUser("who-stranger");
      const gym = await makeOrg(owner.cookies, "Who Gym");
      const rivalGym = await makeOrg(rival.cookies, "Who Rival Gym");
      const manager = await makeStaff(gym, owner.cookies, "who-manager", "manager");
      const trainer = await makeStaff(gym, owner.cookies, "who-trainer", "trainer");
      const mine = await add(gym, owner.cookies);
      const theirs = await add(rivalGym, rival.cookies, PNG);

      // A manager sees it, off or on, and changes nothing.
      const seen = await get(staffPhotoUrl(gym.org.id, mine.id), manager.cookies);
      expect(seen.statusCode).toBe(200);
      expect(seen.headers["cache-control"]).toBe("private, no-store");
      expect((await post(photosUrl(gym.org.id), { contentBase64: PNG, uploadKey: randomUUID() }, manager.cookies)).statusCode).toBe(403);
      expect((await del(staffPhotoUrl(gym.org.id, mine.id), manager.cookies)).statusCode).toBe(403);
      expect((await put(`${photosUrl(gym.org.id)}/order`, { photoIds: [mine.id] }, manager.cookies)).statusCode).toBe(403);
      // A trainer has no Leads gate at all.
      expect((await get(staffPhotoUrl(gym.org.id, mine.id), trainer.cookies)).statusCode).toBe(403);
      expect((await post(photosUrl(gym.org.id), { contentBase64: PNG, uploadKey: randomUUID() }, trainer.cookies)).statusCode).toBe(403);
      // Another gym's owner and a stranger: this gym does not exist for them.
      for (const outsider of [rival, stranger]) {
        expect((await get(staffPhotoUrl(gym.org.id, mine.id), outsider.cookies)).statusCode).toBe(404);
        expect((await post(photosUrl(gym.org.id), { contentBase64: PNG, uploadKey: randomUUID() }, outsider.cookies)).statusCode).toBe(404);
        expect((await del(staffPhotoUrl(gym.org.id, mine.id), outsider.cookies)).statusCode).toBe(404);
        expect((await put(`${photosUrl(gym.org.id)}/order`, { photoIds: [mine.id] }, outsider.cookies)).statusCode).toBe(404);
      }
      // The rival reaching this gym's photo through their OWN gym's address finds nothing,
      // and cannot remove it or order it there.
      expect((await get(staffPhotoUrl(rivalGym.org.id, mine.id), rival.cookies)).statusCode).toBe(404);
      expect((await del(staffPhotoUrl(rivalGym.org.id, mine.id), rival.cookies)).statusCode).toBe(404);
      expect((await put(`${photosUrl(rivalGym.org.id)}/order`, { photoIds: [mine.id] }, rival.cookies)).statusCode).toBe(409);
      expect((await stored(gym.org.id)).map((r) => r.id)).toEqual([mine.id]);
      expect(await filesOf(gym.org.id)).toHaveLength(1);
      // Signed out: the console's photo is not a public one.
      expect((await get(staffPhotoUrl(gym.org.id, mine.id))).statusCode).toBe(401);

      // In public, one gym's page never shows another's photo.
      await switchOn(gym, owner.cookies);
      await switchOn(rivalGym, rival.cookies);
      expect((await get(publicPhotoUrl(rivalGym.org.slug, mine.id))).statusCode).toBe(404);
      expect((await get(publicPhotoUrl(gym.org.slug, theirs.id))).statusCode).toBe(404);
      expect((await get(publicPhotoUrl(gym.org.slug, mine.id))).statusCode).toBe(200);
    },
    TIMEOUT_MS,
  );

  it(
    "a page that is off, of a gym with no plan, or of a closed gym shows no photo: the page's own 404",
    async () => {
      const owner = await makeUser("off-owner");
      const gym = await makeOrg(owner.cookies, "Off Gym");
      const one = await add(gym, owner.cookies, WEBP);
      const notFound = { error: "page_not_found", message: "This page isn't available." };
      const body = (res: { body: string }) => {
        const b = JSON.parse(res.body) as { error: string; message: string };
        return { error: b.error, message: b.message };
      };
      expect(body(await get(publicPhotoUrl(gym.org.slug, one.id)))).toEqual(notFound);

      await switchOn(gym, owner.cookies);
      const shown = await get(publicPhotoUrl(gym.org.slug, one.id));
      expect(shown.statusCode).toBe(200);
      expect(shown.headers["content-type"]).toBe("image/webp");
      expect(shown.headers["x-content-type-options"]).toBe("nosniff");
      expect(shown.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
      expect(shown.headers["cache-control"]).toBe("public, max-age=300");

      await sql`UPDATE subscriptions SET status = 'expired' WHERE owner_type = 'gym' AND owner_id = ${gym.org.id}`;
      expect(body(await get(publicPhotoUrl(gym.org.slug, one.id)))).toEqual(notFound);
      await sql`UPDATE subscriptions SET status = 'trialing' WHERE owner_type = 'gym' AND owner_id = ${gym.org.id}`;
      await sql`UPDATE gyms SET status = 'archived', archived_at = now() WHERE id = ${gym.org.id}`;
      expect(body(await get(publicPhotoUrl(gym.org.slug, one.id)))).toEqual(notFound);
      await sql`UPDATE gyms SET status = 'active' WHERE id = ${gym.org.id}`;
      await switchOn(gym, owner.cookies, false);
      expect(body(await get(publicPhotoUrl(gym.org.slug, one.id)))).toEqual(notFound);
      // No such photo, and an address that is not a photo's: the same.
      expect(body(await get(publicPhotoUrl(gym.org.slug, "00000000-0000-4000-8000-000000000000")))).toEqual(notFound);
      expect(body(await get(`/v1/public/gyms/${gym.org.slug}/photos/..%2F..%2Fetc%2Fpasswd`))).toEqual(notFound);
    },
    TIMEOUT_MS,
  );

  // ── WHAT IS REFUSED ─────────────────────────────────────────────────────────

  it(
    "what is not a photo is refused with words staff can act on, and nothing is kept",
    async () => {
      const owner = await makeUser("refuse-owner");
      const gym = await makeOrg(owner.cookies, "Refuse Gym");
      const refused = async (contentBase64: string) => {
        const res = await post(photosUrl(gym.org.id), { contentBase64, uploadKey: randomUUID() }, owner.cookies);
        return { status: res.statusCode, ...(JSON.parse(res.body) as { error: string; message: string }) };
      };
      expect(await refused(Buffer.from("<svg onload=alert(1)>").toString("base64"))).toMatchObject({
        status: 400,
        error: "photo_not_a_photo",
        message: "Choose a photo saved as JPEG, PNG or WebP.",
      });
      expect(await refused(Buffer.from(readFileSync(new URL("./fixtures/photos/iphone16.jpg", import.meta.url)).subarray(0, 4000)).toString("base64"))).toMatchObject({
        status: 400,
        error: "photo_damaged",
      });
      expect((await refused("not base64 at all!")).status).toBe(400);
      expect((await post(photosUrl(gym.org.id), { contentBase64: PNG, uploadKey: randomUUID(), name: "x.png" }, owner.cookies)).statusCode).toBe(400);
      // Over the cap the body itself is refused before anything reads it.
      const tooBig = await post(photosUrl(gym.org.id), { contentBase64: "A".repeat(3_000_000), uploadKey: randomUUID() }, owner.cookies);
      expect([400, 413]).toContain(tooBig.statusCode);
      expect(await stored(gym.org.id)).toEqual([]);
      expect(await filesOf(gym.org.id)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    `at most ${String(GYM_PAGE_MAX_PHOTOS)}, even when the last place is asked for twice at the same instant`,
    async () => {
      const owner = await makeUser("full-owner");
      const gym = await makeOrg(owner.cookies, "Full Gym");
      for (let i = 0; i < GYM_PAGE_MAX_PHOTOS - 1; i++) await add(gym, owner.cookies, WEBP);
      const other = second;
      if (other === undefined) throw new Error("no second api");
      // Both are held at the file write, past the early count, until both have got there:
      // only the count under the gym's lock can tell them apart.
      closeGate(2);
      const putsBefore = puts;
      const both = await Promise.all([
        send(api(), "POST", photosUrl(gym.org.id), { contentBase64: PNG, uploadKey: randomUUID() }, owner.cookies),
        send(other, "POST", photosUrl(gym.org.id), { contentBase64: PNG, uploadKey: randomUUID() }, owner.cookies),
      ]);
      gate = null;
      expect(puts - putsBefore).toBe(2);
      expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      const refused = both.find((r) => r.statusCode === 409);
      expect(JSON.parse(refused?.body ?? "{}")).toMatchObject({
        error: "photos_full",
        message: "Your page has 10 photos, the most it can show. Remove one to add another.",
      });
      const rows = await stored(gym.org.id);
      expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      // The refused photo's file went with it.
      expect(await filesOf(gym.org.id)).toEqual(rows.map((r) => r.storage_key.split("/")[2]).sort());
      expect((await post(photosUrl(gym.org.id), { contentBase64: PNG, uploadKey: randomUUID() }, owner.cookies)).statusCode).toBe(409);
    },
    TIMEOUT_MS,
  );

  it(
    "the same photo sent again under its upload key is the photo already kept, sent twice at once too",
    async () => {
      const owner = await makeUser("again-owner");
      const gym = await makeOrg(owner.cookies, "Again Gym");
      const uploadKey = randomUUID();
      const first = await post(photosUrl(gym.org.id), { contentBase64: PNG, uploadKey }, owner.cookies);
      expect(first.statusCode).toBe(201);
      // Its reply was lost on the way back; the browser sends it again.
      const again = await post(photosUrl(gym.org.id), { contentBase64: PNG, uploadKey }, owner.cookies);
      expect(again.statusCode).toBe(201);
      expect(JSON.parse(again.body)).toEqual(JSON.parse(first.body));
      expect(await stored(gym.org.id)).toHaveLength(1);
      expect(await filesOf(gym.org.id)).toHaveLength(1);

      // Two at the same instant, through two apis, both past the first look.
      const other = second;
      if (other === undefined) throw new Error("no second api");
      const twinKey = randomUUID();
      closeGate(2);
      const twins = await Promise.all([
        send(api(), "POST", photosUrl(gym.org.id), { contentBase64: WEBP, uploadKey: twinKey }, owner.cookies),
        send(other, "POST", photosUrl(gym.org.id), { contentBase64: WEBP, uploadKey: twinKey }, owner.cookies),
      ]);
      gate = null;
      expect(twins.map((r) => r.statusCode)).toEqual([201, 201]);
      expect(JSON.parse(twins[0].body)).toEqual(JSON.parse(twins[1].body));
      expect(await stored(gym.org.id)).toHaveLength(2);
      expect(await filesOf(gym.org.id)).toHaveLength(2);
      // The key is this gym's: another gym may use the same one for a photo of its own.
      const rival = await makeUser("again-rival");
      const rivalGym = await makeOrg(rival.cookies, "Again Rival Gym");
      const theirs = await post(photosUrl(rivalGym.org.id), { contentBase64: PNG, uploadKey }, rival.cookies);
      expect(theirs.statusCode).toBe(201);
      const idOf = (res: { body: string }) => (JSON.parse(res.body) as { photo: GymPagePhoto }).photo.id;
      expect(idOf(theirs)).not.toBe(idOf(first));
      expect(await stored(rivalGym.org.id)).toHaveLength(1);

      // The tenth photo's reply lost: sent again to a page now full, it is still the photo
      // kept, not "your page has 10 photos", and nothing is written for it.
      for (let i = 2; i < GYM_PAGE_MAX_PHOTOS - 1; i++) await add(gym, owner.cookies, WEBP);
      const tenthKey = randomUUID();
      const tenth = await post(photosUrl(gym.org.id), { contentBase64: PNG, uploadKey: tenthKey }, owner.cookies);
      expect(tenth.statusCode).toBe(201);
      expect(await stored(gym.org.id)).toHaveLength(GYM_PAGE_MAX_PHOTOS);
      const putsBefore = puts;
      const replay = await post(photosUrl(gym.org.id), { contentBase64: PNG, uploadKey: tenthKey }, owner.cookies);
      expect(replay.statusCode, replay.body).toBe(201);
      expect(idOf(replay)).toBe(idOf(tenth));
      expect(puts).toBe(putsBefore);
    },
    TIMEOUT_MS,
  );

  it(
    "a gym's id in capitals is the same gym: its photo is kept, not a server error",
    async () => {
      const owner = await makeUser("caps-owner");
      const gym = await makeOrg(owner.cookies, "Caps Gym");
      const res = await post(photosUrl(gym.org.id.toUpperCase()), { contentBase64: PNG, uploadKey: randomUUID() }, owner.cookies);
      expect(res.statusCode, res.body).toBe(201);
      const rows = await stored(gym.org.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.storage_key).toBe(rows[0]?.storage_key.toLowerCase());
      expect(await filesOf(gym.org.id)).toHaveLength(1);
    },
    TIMEOUT_MS,
  );

  it(
    "swapping a full page of ten photos three times in an hour is not stopped half way",
    async () => {
      const owner = await makeUser("swap-owner");
      const gym = await makeOrg(owner.cookies, "Swap Gym");
      for (let i = 0; i < GYM_PAGE_MAX_PHOTOS; i++) await add(gym, owner.cookies, WEBP);
      for (let round = 0; round < 3; round++) {
        for (const row of await stored(gym.org.id)) expect((await del(staffPhotoUrl(gym.org.id, row.id), owner.cookies)).statusCode).toBe(200);
        for (let i = 0; i < GYM_PAGE_MAX_PHOTOS; i++) await add(gym, owner.cookies, WEBP);
        const ids = (await stored(gym.org.id)).map((r) => r.id).reverse();
        expect((await put(`${photosUrl(gym.org.id)}/order`, { photoIds: ids }, owner.cookies)).statusCode).toBe(200);
      }
      expect(await stored(gym.org.id)).toHaveLength(GYM_PAGE_MAX_PHOTOS);
    },
    TIMEOUT_MS,
  );

  // ── REMOVE AND MOVE ─────────────────────────────────────────────────────────

  it(
    "a removed photo is gone from the page, the database and the disk; the rest close up and can be put in any order",
    async () => {
      const owner = await makeUser("order-owner");
      const gym = await makeOrg(owner.cookies, "Order Gym");
      await switchOn(gym, owner.cookies);
      const a = await add(gym, owner.cookies, PNG);
      const b = await add(gym, owner.cookies, WEBP);
      const c = await add(gym, owner.cookies, SAMSUNG);

      const removed = await del(staffPhotoUrl(gym.org.id, b.id), owner.cookies);
      expect(removed.statusCode).toBe(200);
      expect((JSON.parse(removed.body) as { photos: GymPagePhoto[] }).photos.map((p) => p.id)).toEqual([a.id, c.id]);
      expect((await stored(gym.org.id)).map((r) => [r.id, r.position])).toEqual([
        [a.id, 0],
        [c.id, 1],
      ]);
      expect(await filesOf(gym.org.id)).toHaveLength(2);
      expect((await get(publicPhotoUrl(gym.org.slug, b.id))).statusCode).toBe(404);
      // Removed twice: the second says so.
      const again = await del(staffPhotoUrl(gym.org.id, b.id), owner.cookies);
      expect(again.statusCode).toBe(404);
      expect(JSON.parse(again.body)).toMatchObject({ error: "photo_not_found", message: "This photo has already been removed." });

      // Make the Samsung photo the first.
      const moved = await put(`${photosUrl(gym.org.id)}/order`, { photoIds: [c.id, a.id] }, owner.cookies);
      expect(moved.statusCode).toBe(200);
      expect((JSON.parse(moved.body) as { photos: GymPagePhoto[] }).photos.map((p) => p.id)).toEqual([c.id, a.id]);
      const page = JSON.parse((await get(`/v1/public/gyms/${gym.org.slug}`)).body) as { page: PublicGymPage };
      expect(page.page.photos.map((p) => p.id)).toEqual([c.id, a.id]);
      const console_ = JSON.parse((await get(`/v1/orgs/${gym.org.id}/page`, owner.cookies)).body) as { page: GymPage };
      expect(console_.page.photos.map((p) => p.id)).toEqual([c.id, a.id]);

      // An order that leaves one out, names one twice, or names one removed meanwhile:
      // refused, and the order stands.
      for (const photoIds of [[c.id], [c.id, a.id, b.id]]) {
        const res = await put(`${photosUrl(gym.org.id)}/order`, { photoIds }, owner.cookies);
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ error: "photos_changed" });
      }
      expect((await put(`${photosUrl(gym.org.id)}/order`, { photoIds: [c.id, c.id] }, owner.cookies)).statusCode).toBe(400);
      expect((await stored(gym.org.id)).map((r) => r.id)).toEqual([c.id, a.id]);

      // Each change is in the gym's own record of who did what.
      const audit = await sql<{ action: string }[]>`
        SELECT action FROM audit_log WHERE gym_id = ${gym.org.id} AND action LIKE 'org.page_photo%' ORDER BY id`;
      expect(audit.map((r) => r.action)).toEqual(["org.page_photo_added", "org.page_photo_added", "org.page_photo_added", "org.page_photo_removed", "org.page_photos_ordered"]);
    },
    TIMEOUT_MS,
  );
});
