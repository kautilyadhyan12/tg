// The same person next month on the real routes and real Postgres (ROADMAP 3a-vi;
// RULINGS 2026-09-24): an upload that recognises a person by member number, email or
// phone updates THAT record in place — its id, and everything that hangs off it, stay.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { MemberListConfirmed, MemberListPreview } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-same-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_memberlist_same";

let ipCounter = 0;
const nextIp = () => `10.67.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** Gymdesk's own import headings, as the gym's software writes them. */
const HEADER = ["Full Name", "Email", "Mobile", "Member No", "Status", "Date of Birth"];
interface Person {
  name: string;
  email: string;
  phone: string;
  number: string;
  status?: string;
  dob?: string;
}
const csv = (people: readonly Person[], header: readonly string[] = HEADER): Buffer => {
  const cells = (p: Person) => [p.name, p.email, p.phone, p.number, p.status ?? "Active", p.dob ?? ""].slice(0, header.length);
  const quote = (cell: string) => (cell.includes(",") ? `"${cell}"` : cell);
  return Buffer.from([header.join(","), ...people.map((p) => cells(p).map(quote).join(","))].join("\r\n"), "utf8");
};

d("member list: the same person next month (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'msame-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'msame-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    api().inject({ method: "POST", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, cookies, payload: JSON.stringify(payload) });
  const patch = (path: string, payload: unknown, cookies: Record<string, string>) =>
    api().inject({ method: "PATCH", url: path, remoteAddress: nextIp(), headers: { "content-type": "application/json" }, cookies, payload: JSON.stringify(payload) });

  const makeOwner = async (local: string) => {
    const email = `msame-t-${local}@example.com`;
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Same ${local}` })).statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const cookies = cookieMap(login);
    const res = await post("/v1/orgs", { name: `Same ${local} Gym`, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { cookies, gymId };
  };

  const stage = async (gymId: string, cookies: Record<string, string>, bytes: Buffer): Promise<MemberListPreview> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/uploads`, { contentBase64: bytes.toString("base64"), mode: "whole_list" }, cookies);
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { preview: MemberListPreview }).preview;
  };
  const confirm = (gymId: string, cookies: Record<string, string>, uploadId: string, body: Record<string, boolean> = {}) =>
    post(`/v1/orgs/${gymId}/member-list/uploads/${uploadId}/confirm`, { permissionConfirmed: true, ...body }, cookies);
  const apply = async (gymId: string, cookies: Record<string, string>, bytes: Buffer, body: Record<string, boolean> = {}) => {
    const preview = await stage(gymId, cookies, bytes);
    const res = await confirm(gymId, cookies, preview.uploadId, body);
    expect(res.statusCode).toBe(200);
    return { preview, confirmed: (JSON.parse(res.body) as { confirmed: MemberListConfirmed }).confirmed };
  };

  /** Every record of a gym, as the table holds it. */
  const records = async (gymId: string) =>
    await sql<{ id: string; full_name: string; email: string | null; phone_e164: string | null; member_number: string | null; identity_key: string; former: boolean; hand_edited: string[] }[]>`
      SELECT id, full_name, email::text AS email, phone_e164, member_number, identity_key, (former_at IS NOT NULL) AS former, hand_edited
      FROM gym_member_list_entries WHERE gym_id = ${gymId} ORDER BY listed_seq`;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'GBP', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  const mum: Person = { name: "Priya Shah", email: "shah.family@example.com", phone: "07700 900201", number: "", dob: "14/05/1981" };
  const son: Person = { name: "Arjun Shah", email: "shah.family@example.com", phone: "07700 900202", number: "", dob: "02/09/2009" };
  const olivia: Person = { name: "Olivia Bennett", email: "olivia.bennett@example.com", phone: "07700 900101", number: "" };

  it(
    "the worst thing: a family at one parent's address stays two records, each updated on its own, and a stranger on that address never takes the parent's",
    async () => {
      const gym = await makeOwner("family");
      await apply(gym.gymId, gym.cookies, csv([mum, son, olivia]));
      const first = await records(gym.gymId);
      const idOf = (name: string) => first.find((r) => r.full_name === name)?.id;

      // Next month both have new phones, the son is listed first and this report has no
      // date-of-birth column, so only the name can say which record on the address is his.
      const next = await apply(gym.gymId, gym.cookies, csv([{ ...son, phone: "07700 900299" }, { ...mum, phone: "07700 900298" }, olivia], HEADER.slice(0, 5)));
      expect(next.preview.list).toMatchObject({ new: 0, changed: 2, unchanged: 1, gone: 0 });
      const after = await records(gym.gymId);
      expect(after.find((r) => r.id === idOf("Arjun Shah"))).toMatchObject({ full_name: "Arjun Shah", phone_e164: "+447700900299", former: false });
      expect(after.find((r) => r.id === idOf("Priya Shah"))).toMatchObject({ full_name: "Priya Shah", phone_e164: "+447700900298", former: false });

      // The month after: the parent has left, and a daughter joins on the parent's address.
      const daughter: Person = { name: "Meera Shah", email: "shah.family@example.com", phone: "07700 900203", number: "", dob: "30/06/2012" };
      const third = await apply(gym.gymId, gym.cookies, csv([{ ...son, phone: "07700 900299" }, daughter, olivia]));
      expect(third.preview.list).toMatchObject({ new: 1, gone: 1 });
      const last = await records(gym.gymId);
      expect(last.find((r) => r.id === idOf("Priya Shah"))).toMatchObject({ full_name: "Priya Shah", former: true });
      expect(last.find((r) => r.full_name === "Meera Shah")?.id).not.toBe(idOf("Priya Shah"));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Olivia's new phone number is one Olivia, updated: the same record, the new number, a new key, nobody former",
    async () => {
      const gym = await makeOwner("olivia");
      await apply(gym.gymId, gym.cookies, csv([olivia]));
      const [before] = await records(gym.gymId);
      const next = await apply(gym.gymId, gym.cookies, csv([{ ...olivia, phone: "07700 900999" }]));
      expect(next.preview.list).toMatchObject({ new: 0, changed: 1, gone: 0 });
      expect(next.preview.fieldChanges).toEqual([{ field: "phone", count: 1 }]);
      const after = await records(gym.gymId);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ id: before?.id, phone_e164: "+447700900999", former: false });
      expect(after[0]?.identity_key).not.toBe(before?.identity_key);

      // The same file again reads as nothing to do: the new key is the one the file gives.
      const again = await stage(gym.gymId, gym.cookies, csv([{ ...olivia, phone: "07700 900999" }]));
      expect(again.list).toMatchObject({ new: 0, changed: 0, unchanged: 1, gone: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a new email, a corrected name and an edited member number are written to the same records; a file without a member-number column keeps them",
    async () => {
      const gym = await makeOwner("fields");
      const tom: Person = { name: "Tom Reed", email: "tom@old.example", phone: "07700 900301", number: "SOK1234" };
      const grace: Person = { name: "Grace Oduya", email: "grace.o@example.com", phone: "07700 900302", number: "SOK1235" };
      await apply(gym.gymId, gym.cookies, csv([tom, grace]));
      const before = await records(gym.gymId);

      const next = await apply(gym.gymId, gym.cookies, csv([
        { ...tom, email: "tom.reed@new.example", number: "XSOK1234" },
        { ...grace, name: "Grace Whitfield" },
      ]));
      expect(next.preview.list).toMatchObject({ new: 0, changed: 2, gone: 0 });
      const after = await records(gym.gymId);
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
      expect(after[0]).toMatchObject({ email: "tom.reed@new.example", member_number: "XSOK1234" });
      expect(after[1]).toMatchObject({ full_name: "Grace Whitfield", member_number: "SOK1235" });

      // Zen Planner's People report has no member-number column: nobody's number is blanked.
      const narrow = await apply(
        gym.gymId,
        gym.cookies,
        csv([{ ...tom, email: "tom.reed@new.example", number: "" }, { ...grace, name: "Grace Whitfield", phone: "07700 900399" }], ["Full Name", "Email", "Mobile"]),
      );
      expect(narrow.preview.list).toMatchObject({ new: 0, changed: 1, unchanged: 1, gone: 0 });
      const last = await records(gym.gymId);
      expect(last.map((r) => r.member_number)).toEqual(["XSOK1234", "SOK1235"]);
      expect(last[1]?.phone_e164).toBe("+447700900399");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a phone staff corrected by hand is not written over without the tick, and the tick clears only that mark",
    async () => {
      const gym = await makeOwner("handedit");
      await apply(gym.gymId, gym.cookies, csv([olivia]));
      const [record] = await records(gym.gymId);
      if (record === undefined) throw new Error("no record");
      const typed = await patch(`/v1/orgs/${gym.gymId}/member-list/entries/${record.id}`, { phone: "07700 900555" }, gym.cookies);
      expect(typed.statusCode).toBe(200);
      expect((await records(gym.gymId))[0]?.hand_edited).toEqual(["phone"]);

      // The gym's own software still has the old number.
      const preview = await stage(gym.gymId, gym.cookies, csv([olivia]));
      const refused = await confirm(gym.gymId, gym.cookies, preview.uploadId);
      expect(refused.statusCode).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "hand_edits", handEdits: { entries: 1, fields: ["phone number"] } });
      expect((await records(gym.gymId))[0]?.phone_e164).toBe("+447700900555");

      expect((await confirm(gym.gymId, gym.cookies, preview.uploadId, { acknowledgeHandEdits: true })).statusCode).toBe(200);
      expect((await records(gym.gymId))[0]).toMatchObject({ id: record.id, phone_e164: "+447700900101", hand_edited: [] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one gym's file is matched only against that gym's list: the same person uploaded at another gym touches nothing here",
    async () => {
      const a = await makeOwner("tenant-a");
      const b = await makeOwner("tenant-b");
      await apply(a.gymId, a.cookies, csv([olivia]));
      const before = await records(a.gymId);
      const atB = await apply(b.gymId, b.cookies, csv([{ ...olivia, phone: "07700 900777" }]));
      expect(atB.preview.list).toMatchObject({ new: 1, changed: 0 });
      expect(await records(a.gymId)).toEqual(before);
      // Nor can B's owner confirm into A's list.
      const staged = await stage(b.gymId, b.cookies, csv([olivia]));
      expect((await confirm(a.gymId, b.cookies, staged.uploadId)).statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );
});
