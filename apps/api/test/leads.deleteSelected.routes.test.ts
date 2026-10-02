// Delete the leads selected — routes against real Postgres (DATABASE_URL-gated). ROADMAP
// 20c-vii; spec Part 3 §16.3.
//
// The first block is the worst thing this job could do to a real person: delete a lead
// nobody ticked, or another gym's. Every answer is checked against the database, never
// against what a reply says.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { LEADS_TICKED_MAX, ROLE_PRIVILEGES, type Lead, type LeadsDeletePreview, type LeadsSelectedAll } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "leads-delete-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_leads_delete";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("deleting the leads selected (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'leaddel-t-%@example.com')`;
    await sql`DELETE FROM gym_leads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'leaddel-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Record<string, string>) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      cookies,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });

  const makeUser = async (local: string) => {
    const email = `leaddel-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Lead ${local}` }, {});
    expect(reg.statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { email, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const makeOrg = async (cookies: Record<string, string>, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  const makeStaff = async (org: CreatedOrg, owner: Record<string, string>, local: string, role: "manager" | "trainer") => {
    const person = await makeUser(local);
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner)).statusCode).toBe(200);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role }, owner)).statusCode).toBe(201);
    return person;
  };

  const leadsUrl = (gymId: string) => `/v1/orgs/${gymId}/leads`;
  const selectAllUrl = (gymId: string) => `${leadsUrl(gymId)}/selection`;
  const previewUrl = (gymId: string) => `${leadsUrl(gymId)}/selected/delete-preview`;
  const deleteUrl = (gymId: string) => `${leadsUrl(gymId)}/selected/delete`;

  const addLead = async (gymId: string, cookies: Record<string, string>, name: string, over: Record<string, unknown> = {}) => {
    const local = name.toLowerCase().replace(/[^a-z]/g, "");
    const res = await post(leadsUrl(gymId), { fullName: name, email: `${local}-${String(ipCounter)}@example.com`, source: "website", ...over }, cookies);
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { lead: Lead }).lead;
  };

  /** What is really stored, never what a reply says. */
  const storedNames = async (gymId: string) =>
    (await sql<{ full_name: string }[]>`SELECT full_name FROM gym_leads WHERE gym_id = ${gymId} ORDER BY full_name`).map((r) => r.full_name);

  const previewOf = (res: { body: string }) => (JSON.parse(res.body) as { preview: LeadsDeletePreview }).preview;
  const selectAll = async (gymId: string, filter: Record<string, unknown>, cookies: Record<string, string>) => {
    const res = await post(selectAllUrl(gymId), { filter }, cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { selection: LeadsSelectedAll }).selection;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, TIMEOUT_MS);

  // ── THE WORST THING: A LEAD NOBODY TICKED, OR ANOTHER GYM'S ─────────────────

  it(
    "only the leads ticked are deleted: never one left unticked, and never another gym's whose id was sent",
    async () => {
      const owner = await makeUser("worst-owner");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Ticked Leads Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Rival Ticked Gym");
      const ana = await addLead(org.org.id, owner.cookies, "Ana Spam");
      const ben = await addLead(org.org.id, owner.cookies, "Ben Spam");
      await addLead(org.org.id, owner.cookies, "Cara Real");
      const theirs = await addLead(rivalOrg.org.id, rival.cookies, "Dev Theirs");

      const selection = { kind: "ticked", leadIds: [ana.id, ben.id, theirs.id] };
      const box = await post(previewUrl(org.org.id), { selection }, owner.cookies);
      expect(box.statusCode).toBe(200);
      const preview = previewOf(box);
      expect(preview.leads.map((l) => l.name).sort()).toEqual(["Ana Spam", "Ben Spam"]);
      expect(preview).toMatchObject({ selected: 3, gone: 1 });

      const done = await post(deleteUrl(org.org.id), { selection, digest: preview.digest }, owner.cookies);
      expect(done.statusCode).toBe(200);
      expect(JSON.parse(done.body)).toEqual({ deleted: { deleted: 2, alreadyDeleted: false } });
      expect(await storedNames(org.org.id)).toEqual(["Cara Real"]);
      expect(await storedNames(rivalOrg.org.id)).toEqual(["Dev Theirs"]);
    },
    TIMEOUT_MS,
  );

  it(
    "Select all deletes only what the filter matched: other statuses, other searches and other gyms stay",
    async () => {
      const owner = await makeUser("all-owner");
      const rival = await makeUser("all-rival");
      const org = await makeOrg(owner.cookies, "Select All Leads Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Rival Select All Gym");
      for (const name of ["Flood One", "Flood Two", "Flood Three"]) await addLead(org.org.id, owner.cookies, name);
      const contacted = await addLead(org.org.id, owner.cookies, "Flood Contacted");
      expect((await api().inject({ method: "PATCH", url: `${leadsUrl(org.org.id)}/${contacted.id}`, remoteAddress: nextIp(), cookies: owner.cookies, headers: { "content-type": "application/json" }, payload: JSON.stringify({ status: "contacted" }) })).statusCode).toBe(200);
      await addLead(org.org.id, owner.cookies, "Grace Real");
      await addLead(rivalOrg.org.id, rival.cookies, "Flood Theirs");

      const filter = { status: "new", q: "flood" };
      const all = await selectAll(org.org.id, filter, owner.cookies);
      expect(all.count).toBe(3);
      const selection = { kind: "all", filter, count: all.count, digest: all.digest };
      const preview = previewOf(await post(previewUrl(org.org.id), { selection }, owner.cookies));
      expect(preview.leads.map((l) => l.name).sort()).toEqual(["Flood One", "Flood Three", "Flood Two"]);

      const done = await post(deleteUrl(org.org.id), { selection, digest: preview.digest }, owner.cookies);
      expect(done.statusCode).toBe(200);
      expect(await storedNames(org.org.id)).toEqual(["Flood Contacted", "Grace Real"]);
      expect(await storedNames(rivalOrg.org.id)).toEqual(["Flood Theirs"]);
    },
    TIMEOUT_MS,
  );

  it(
    "a lead that arrives after Select all, or after the box, is never deleted with the others: nothing is",
    async () => {
      const owner = await makeUser("late-owner");
      const org = await makeOrg(owner.cookies, "Late Lead Gym");
      await addLead(org.org.id, owner.cookies, "Early One");
      await addLead(org.org.id, owner.cookies, "Early Two");
      const filter = {};
      const all = await selectAll(org.org.id, filter, owner.cookies);
      const selection = { kind: "all", filter, count: all.count, digest: all.digest };

      // Arrives between Select all and the box: the box is refused, with the new count.
      await addLead(org.org.id, owner.cookies, "Late Before Box");
      const moved = await post(previewUrl(org.org.id), { selection }, owner.cookies);
      expect(moved.statusCode).toBe(409);
      expect(JSON.parse(moved.body)).toMatchObject({ error: "selection_changed", count: 3 });

      // Selected again, the box read, then one more arrives before Delete: nothing goes.
      const again = await selectAll(org.org.id, filter, owner.cookies);
      const selection2 = { kind: "all", filter, count: again.count, digest: again.digest };
      const preview = previewOf(await post(previewUrl(org.org.id), { selection: selection2 }, owner.cookies));
      expect(preview.leads).toHaveLength(3);
      await addLead(org.org.id, owner.cookies, "Late After Box");
      const refused = await post(deleteUrl(org.org.id), { selection: selection2, digest: preview.digest }, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "selection_changed", count: 4 });
      expect(await storedNames(org.org.id)).toEqual(["Early One", "Early Two", "Late After Box", "Late Before Box"]);
    },
    TIMEOUT_MS,
  );

  it(
    "a ticked lead changed by a colleague after the box: nothing is deleted, and the new box comes back",
    async () => {
      const owner = await makeUser("moved-owner");
      const org = await makeOrg(owner.cookies, "Moved Box Gym");
      const a = await addLead(org.org.id, owner.cookies, "Hana Ticked");
      const b = await addLead(org.org.id, owner.cookies, "Ivo Ticked");
      await addLead(org.org.id, owner.cookies, "Jo Kept");
      const selection = { kind: "ticked", leadIds: [a.id, b.id] };
      const preview = previewOf(await post(previewUrl(org.org.id), { selection }, owner.cookies));
      // A colleague deletes one of them from its own panel.
      expect((await api().inject({ method: "DELETE", url: `${leadsUrl(org.org.id)}/${b.id}`, remoteAddress: nextIp(), cookies: owner.cookies })).statusCode).toBe(204);

      const refused = await post(deleteUrl(org.org.id), { selection, digest: preview.digest }, owner.cookies);
      expect(refused.statusCode).toBe(409);
      const body = JSON.parse(refused.body) as { error: string; preview: LeadsDeletePreview };
      expect(body.error).toBe("leads_changed");
      expect(body.preview).toMatchObject({ selected: 2, gone: 1 });
      expect(body.preview.leads.map((l) => l.name)).toEqual(["Hana Ticked"]);
      expect(await storedNames(org.org.id)).toEqual(["Hana Ticked", "Jo Kept"]);

      // The new box's press goes through.
      const done = await post(deleteUrl(org.org.id), { selection, digest: body.preview.digest }, owner.cookies);
      expect(done.statusCode).toBe(200);
      expect(await storedNames(org.org.id)).toEqual(["Jo Kept"]);
    },
    TIMEOUT_MS,
  );

  // ── WHO MAY ────────────────────────────────────────────────────────────────

  it(
    "a stranger, another gym's owner and a trainer are refused at every door, and nothing is deleted",
    async () => {
      const owner = await makeUser("door-owner");
      const stranger = await makeUser("door-stranger");
      const rival = await makeUser("door-rival");
      const org = await makeOrg(owner.cookies, "Door Leads Gym");
      await makeOrg(rival.cookies, "Door Rival Gym");
      const trainer = await makeStaff(org, owner.cookies, "door-trainer", "trainer");
      expect(ROLE_PRIVILEGES.trainer).not.toContain("members.confirm");
      const lead = await addLead(org.org.id, owner.cookies, "Kim Guarded");
      const selection = { kind: "ticked", leadIds: [lead.id] };

      // The positive control: the owner opens every door.
      expect((await post(selectAllUrl(org.org.id), { filter: {} }, owner.cookies)).statusCode).toBe(200);
      const preview = previewOf(await post(previewUrl(org.org.id), { selection }, owner.cookies));

      for (const who of [stranger, rival, trainer]) {
        const all = await post(selectAllUrl(org.org.id), { filter: {} }, who.cookies);
        const box = await post(previewUrl(org.org.id), { selection }, who.cookies);
        const press = await post(deleteUrl(org.org.id), { selection, digest: preview.digest }, who.cookies);
        for (const res of [all, box, press]) {
          expect([403, 404]).toContain(res.statusCode);
          expect(res.body).not.toContain("Kim Guarded");
        }
      }
      // Signed out.
      expect((await post(deleteUrl(org.org.id), { selection, digest: preview.digest }, {})).statusCode).toBe(401);
      expect(await storedNames(org.org.id)).toEqual(["Kim Guarded"]);
    },
    TIMEOUT_MS,
  );

  it(
    "a manager may; a gym with no live plan sees the box and deletes nothing",
    async () => {
      const owner = await makeUser("plan-owner");
      const org = await makeOrg(owner.cookies, "Plan Leads Gym");
      const manager = await makeStaff(org, owner.cookies, "plan-manager", "manager");
      const a = await addLead(org.org.id, owner.cookies, "Lee Lapsed");
      const b = await addLead(org.org.id, owner.cookies, "Mo Managed");

      const managed = { kind: "ticked", leadIds: [b.id] };
      const box = previewOf(await post(previewUrl(org.org.id), { selection: managed }, manager.cookies));
      expect((await post(deleteUrl(org.org.id), { selection: managed, digest: box.digest }, manager.cookies)).statusCode).toBe(200);

      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
      const selection = { kind: "ticked", leadIds: [a.id] };
      const preview = await post(previewUrl(org.org.id), { selection }, owner.cookies);
      expect(preview.statusCode).toBe(200);
      const refused = await post(deleteUrl(org.org.id), { selection, digest: previewOf(preview).digest }, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "gym_not_on_plan" });
      expect(await storedNames(org.org.id)).toEqual(["Lee Lapsed"]);
    },
    TIMEOUT_MS,
  );

  // ── THE PRESS ──────────────────────────────────────────────────────────────

  it(
    "the same press twice deletes once and says so the second time; the activity log names each lead once",
    async () => {
      const owner = await makeUser("twice-owner");
      const org = await makeOrg(owner.cookies, "Twice Leads Gym");
      const a = await addLead(org.org.id, owner.cookies, "Nia Twice");
      const b = await addLead(org.org.id, owner.cookies, "Omar Twice");
      const selection = { kind: "ticked", leadIds: [a.id, b.id] };
      const preview = previewOf(await post(previewUrl(org.org.id), { selection }, owner.cookies));
      const body = { selection, digest: preview.digest };
      const [first, second] = await Promise.all([post(deleteUrl(org.org.id), body, owner.cookies), post(deleteUrl(org.org.id), body, owner.cookies)]);
      const answers = [first, second].map((res) => {
        expect(res.statusCode).toBe(200);
        return (JSON.parse(res.body) as { deleted: { deleted: number; alreadyDeleted: boolean } }).deleted;
      });
      expect(answers.map((x) => x.alreadyDeleted).sort()).toEqual([false, true]);
      expect(answers.every((x) => x.deleted === 2)).toBe(true);
      expect(await storedNames(org.org.id)).toEqual([]);

      const audit = await sql<{ action: string; target_id: string }[]>`
        SELECT action, target_id FROM audit_log WHERE gym_id = ${org.org.id} AND action IN ('org.lead_deleted', 'org.leads_selected_deleted')`;
      expect(audit.filter((r) => r.action === "org.lead_deleted").map((r) => r.target_id).sort()).toEqual([a.id, b.id].sort());
      expect(audit.filter((r) => r.action === "org.leads_selected_deleted")).toHaveLength(1);
    },
    TIMEOUT_MS,
  );

  it(
    "a body that is not a selection is refused with 400 and deletes nothing",
    async () => {
      const owner = await makeUser("bad-owner");
      const org = await makeOrg(owner.cookies, "Bad Body Gym");
      const lead = await addLead(org.org.id, owner.cookies, "Pat Stays");
      const digest = "0".repeat(64);
      const tooMany = Array.from({ length: LEADS_TICKED_MAX + 1 }, () => lead.id);
      for (const payload of [
        { selection: { kind: "ticked", leadIds: ["not-a-uuid"] }, digest },
        { selection: { kind: "ticked", leadIds: [] }, digest },
        { selection: { kind: "ticked", leadIds: tooMany }, digest },
        { selection: { kind: "ticked", leadIds: [lead.id] }, digest: "nope" },
        { selection: { kind: "all", filter: { cursor: "x" }, count: 1, digest }, digest },
        { selection: { kind: "ticked", leadIds: [lead.id] } },
      ]) {
        const res = await post(deleteUrl(org.org.id), payload, owner.cookies);
        expect(res.statusCode).toBe(400);
        expect(res.body).not.toContain("Pat Stays");
      }
      expect(await storedNames(org.org.id)).toEqual(["Pat Stays"]);
    },
    TIMEOUT_MS,
  );
});
