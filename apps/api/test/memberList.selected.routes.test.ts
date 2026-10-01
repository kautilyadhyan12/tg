// THE PEOPLE SELECTED — Invite and Download CSV on the people ticked, against REAL
// Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 5b-v-b-i; Part 3 §18.5.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md
// §2.1): an email, or a file of their details, reaching somebody staff did not tick —
// the Invite of three ticked people emailing the whole list, or a "Select all 40 Active"
// emailing the two an import added before Send. Every email is counted where it would
// leave: the transport the sender hands it to.
import { addAnyway } from "./memberListAddAnyway.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { InviteEmail, InviteTransport } from "../src/email/resend.js";
import { dayInTz } from "../src/modules/gamification/streak.js";
import { sendDueInvites, type SendRun } from "../src/modules/orgs/invites/sender.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { selectionDigest } from "../src/modules/orgs/memberList/selection.js";
import {
  MEMBER_LIST_SELECTION_CHANGED_WORDS,
  MEMBER_LIST_TICKED_MAX,
  memberInvitePeopleSchema,
  memberInvitePreviewSchema,
  memberInvitedSchema,
  memberListEntryWrittenSchema,
  memberListSelectedAllSchema,
  memberListSelectionChangedSchema,
  type MemberInvitePreview,
  type MemberListFilter,
  type MemberListSelection,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-selected-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

/** Its own plan code: the suites share one database. */
const LIVE_PLAN = "zz_member_selected";
const DOMAIN = "msel-t.example.com";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

let ipCounter = 0;
const nextIp = () => `10.64.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** An address in this suite's own domain. */
const addr = (local: string) => `msel-t-${local}@${DOMAIN}`;

/** One line of the file read as a spreadsheet reads it: quoted cells, "" inside one. */
function cellsOf(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line.charAt(i);
    if (quoted && char === '"' && line.charAt(i + 1) === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

d("the people selected (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");
  const sender = settings.sender;
  if (sender === null) throw new Error("sending is off in the test config");

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${`msel-t-%@${DOMAIN}`})`;
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE ${`msel-t-%@${DOMAIN}`}`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, cookies: Record<string, string>, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Record<string, string>, ip?: string) => send("POST", path, cookies, payload, ip);
  const patch = (path: string, payload: unknown, cookies: Record<string, string>) => send("PATCH", path, cookies, payload);
  const del = (path: string, cookies: Record<string, string>) => send("DELETE", path, cookies);

  const makeUser = async (local: string): Promise<User> => {
    const email = addr(local);
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Sel ${local}` }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  /** A gym on a trial with its postal address set. */
  const makeGym = async (owner: User, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await patch(`/v1/orgs/${created.org.id}`, { postalAddress: "12 High Street, Leeds LS1 1AA" }, owner.cookies)).statusCode).toBe(200);
    return created;
  };

  const appointTrainer = async (who: User, org: CreatedOrg, owner: User) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, who.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner.cookies)).statusCode).toBe(200);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: who.email, role: "trainer" }, owner.cookies)).statusCode).toBe(201);
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;

  /** One person typed in; their record's id. */
  const typeIn = async (gymId: string, who: User, body: Record<string, unknown>): Promise<string> => {
    const res = await post(`${listUrl(gymId)}/entries`, body, who.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    return memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId;
  };

  const ticked = (...entryIds: string[]): MemberListSelection => ({ kind: "ticked", entryIds });

  /** "Select all" for this filter, as the screen's link presses it. */
  const selectAll = async (gymId: string, who: User, filter: MemberListFilter): Promise<MemberListSelection> => {
    const res = await post(`${listUrl(gymId)}/selection`, { filter }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const got = memberListSelectedAllSchema.parse((JSON.parse(res.body) as { selection: unknown }).selection);
    return { kind: "all", filter, count: got.count, digest: got.digest };
  };

  const previewOf = async (gymId: string, who: User, selection: MemberListSelection): Promise<MemberInvitePreview> => {
    const res = await post(`${listUrl(gymId)}/selected/invite-preview`, { selection }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberInvitePreviewSchema.parse((JSON.parse(res.body) as { preview: unknown }).preview);
  };

  const peopleOf = async (gymId: string, who: User, selection: MemberListSelection, group: "reach" | "left_out") => {
    const res = await post(`${listUrl(gymId)}/selected/invite-people`, { selection, group }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberInvitePeopleSchema.parse((JSON.parse(res.body) as { page: unknown }).page);
  };

  const press = (gymId: string, who: User, selection: MemberListSelection, preview: MemberInvitePreview) =>
    post(`${listUrl(gymId)}/invites`, { selection, version: preview.version, expectedCount: preview.reach, permissionConfirmed: true }, who.cookies);

  const exportOf = (gymId: string, who: User, selection: MemberListSelection) => post(`${listUrl(gymId)}/export.csv`, { selection }, who.cookies);

  /** The file's lines under its heading, split into cells (every cell is quoted). */
  const csvRows = (body: string): string[][] =>
    body
      .replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), "")
      .split("\r\n")
      .filter((line) => line !== "")
      .map(cellsOf);

  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };

  // ── The worker's sender, with every email it would send recorded ──

  const outbox: InviteEmail[] = [];
  const transport: InviteTransport = {
    send: (message) => {
      outbox.push(message);
      return Promise.resolve({ kind: "sent", id: `msg_${String(outbox.length)}` });
    },
  };
  // This suite's own gyms only: the local database also holds a developer's gyms.
  const ourGyms = async () =>
    (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${`msel-t-%@${DOMAIN}`})`).map(
      (row) => row.id,
    );
  const runSender = async (): Promise<SendRun> =>
    await sendDueInvites({
      gymIds: await ourGyms(),
      sql,
      log: { info: () => undefined, warn: () => undefined },
      settings,
      sender,
      transport,
      mailDomain: () => Promise.resolve("accepts"),
      now: () => new Date(Date.now() + 1),
      sleep: () => Promise.resolve(),
    });
  const emailedTo = () => outbox.map((message) => message.to).sort();

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
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // =========================================================================
  // THE WORST THING: AN EMAIL, OR A FILE OF THEIR DETAILS, TO SOMEBODY NOT TICKED
  // =========================================================================

  it(
    "Invite on two ticked people emails those two and nobody else on the list",
    async () => {
      const owner = await makeUser("tick-owner");
      const gym = (await makeGym(owner, "Tick Gym")).org.id;
      await typeIn(gym, owner, { fullName: "Ava Tick", email: addr("ava"), status: "Active" });
      const ben = await typeIn(gym, owner, { fullName: "Ben Tick", email: addr("ben"), status: "Active" });
      await typeIn(gym, owner, { fullName: "Cara Tick", email: addr("cara"), status: "Active" });
      const dan = await typeIn(gym, owner, { fullName: "Dan Tick", email: addr("dan"), status: "Cancelled" });
      await typeIn(gym, owner, { fullName: "Eve Tick", email: addr("eve"), status: "Active" });
      const selection = ticked(ben, dan);

      const preview = await previewOf(gym, owner, selection);
      expect(preview.reach).toBe(2);
      const reach = await peopleOf(gym, owner, selection, "reach");
      expect(reach.people.map((p) => p.fullName)).toEqual(["Ben Tick", "Dan Tick"]);
      expect((await peopleOf(gym, owner, selection, "left_out")).total).toBe(0);

      outbox.length = 0;
      const pressed = await press(gym, owner, selection, preview);
      expect(pressed.statusCode, pressed.body).toBe(200);
      expect(memberInvitedSchema.parse((JSON.parse(pressed.body) as { invited: unknown }).invited).queued).toBe(2);
      await runSender();
      expect(emailedTo()).toEqual([addr("ben"), addr("dan")].sort());
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a Select all whose people changed before Send emails nobody, and says how many it holds now",
    async () => {
      const owner = await makeUser("all-owner");
      const gym = (await makeGym(owner, "All Gym")).org.id;
      await typeIn(gym, owner, { fullName: "Gil All", email: addr("gil"), status: "Active" });
      await typeIn(gym, owner, { fullName: "Hana All", email: addr("hana"), status: "Active" });
      await typeIn(gym, owner, { fullName: "Ivo All", email: addr("ivo"), status: "Cancelled" });
      const filter: MemberListFilter = { status: "Active" };
      const selection = await selectAll(gym, owner, filter);
      expect(selection.kind === "all" ? selection.count : -1).toBe(2);
      const preview = await previewOf(gym, owner, selection);
      expect(preview.reach).toBe(2);

      // An import (here, a colleague typing one in) adds an Active member before Send.
      await typeIn(gym, owner, { fullName: "Jo All", email: addr("jo"), status: "Active" });
      outbox.length = 0;
      const pressed = await press(gym, owner, selection, preview);
      expect(pressed.statusCode, pressed.body).toBe(409);
      const changed = memberListSelectionChangedSchema.parse(JSON.parse(pressed.body));
      expect(changed.error).toBe("selection_changed");
      expect(changed.message).toBe(MEMBER_LIST_SELECTION_CHANGED_WORDS);
      expect(changed.count).toBe(3);
      await runSender();
      expect(emailedTo()).toEqual([]);
      const invited = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_invites WHERE gym_id = ${gym}`;
      expect(invited[0]?.n).toBe(0);

      // The page and the numbers are refused the same way, so no screen shows the old set.
      const page = await post(`${listUrl(gym)}/selected/invite-people`, { selection, group: "reach" }, owner.cookies);
      expect(page.statusCode).toBe(409);
      expect(errorOf(page).error).toBe("selection_changed");

      // Someone leaving the set is refused too, not only someone joining it.
      const again = await selectAll(gym, owner, filter);
      const seen = await previewOf(gym, owner, again);
      await sql`UPDATE gym_member_list_entries SET status = 'Frozen' WHERE gym_id = ${gym} AND full_name = 'Gil All'`;
      const shrunk = await press(gym, owner, again, seen);
      expect(shrunk.statusCode).toBe(409);
      expect(errorOf(shrunk).error).toBe("selection_changed");

      // Selected again: the three Active members now, and only they are emailed.
      const fresh = await selectAll(gym, owner, filter);
      const ok = await press(gym, owner, fresh, await previewOf(gym, owner, fresh));
      expect(ok.statusCode, ok.body).toBe(200);
      await runSender();
      expect(emailedTo()).toEqual([addr("hana"), addr("jo")].sort());
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Download CSV holds exactly the people ticked, and a moved Select all gives no file",
    async () => {
      const owner = await makeUser("file-owner");
      const gym = (await makeGym(owner, "File Gym")).org.id;
      const kim = await typeIn(gym, owner, { fullName: "Kim File", email: addr("kim"), status: "Active" });
      await typeIn(gym, owner, { fullName: "Lou File", email: addr("lou"), status: "Active" });
      const max = await typeIn(gym, owner, { fullName: "Max File", email: addr("max"), status: "Cancelled" });

      const file = await exportOf(gym, owner, ticked(kim, max));
      expect(file.statusCode, file.body).toBe(200);
      const rows = csvRows(file.body);
      expect(rows[0]?.slice(0, 3)).toEqual(["Name", "Email", "Phone"]);
      expect(rows.slice(1).map((row) => row[0])).toEqual(["Kim File", "Max File"]);
      expect(file.body).not.toContain("Lou File");
      expect(file.headers["content-disposition"]).toContain("Selected members");

      const selection = await selectAll(gym, owner, { status: "Cancelled" });
      await typeIn(gym, owner, { fullName: "Ned File", email: addr("ned"), status: "Cancelled" });
      const moved = await exportOf(gym, owner, selection);
      expect(moved.statusCode).toBe(409);
      expect(errorOf(moved).error).toBe("selection_changed");
      expect(moved.body).not.toContain("Max File");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHO MAY ASK, AND ANOTHER GYM'S PEOPLE
  // =========================================================================

  it(
    "another gym's owner reaches nobody with this gym's ids, and is refused this gym's routes; a trainer is refused all of them",
    async () => {
      const owner = await makeUser("ten-owner");
      const created = await makeGym(owner, "Tenancy Gym");
      const gym = created.org.id;
      const pia = await typeIn(gym, owner, { fullName: "Pia Private", email: addr("pia"), status: "Active" });
      const stranger = await makeUser("ten-stranger");
      const theirs = (await makeGym(stranger, "Stranger Gym")).org.id;
      const trainer = await makeUser("ten-trainer");
      await appointTrainer(trainer, created, owner);

      const selection = ticked(pia);
      // Their own gym's routes with Pia's id: she is nobody there.
      expect((await previewOf(theirs, stranger, selection)).reach).toBe(0);
      expect((await peopleOf(theirs, stranger, selection, "reach")).total).toBe(0);
      const file = await exportOf(theirs, stranger, selection);
      expect(file.statusCode).toBe(200);
      expect(file.body).not.toContain("Pia");
      expect(csvRows(file.body)).toHaveLength(1);
      // This gym's digest does not fit their gym, whatever the count.
      const stolen: MemberListSelection = { kind: "all", filter: {}, count: 1, digest: selectionDigest(gym, [pia]) };
      expect((await exportOf(theirs, stranger, stolen)).statusCode).toBe(409);

      // This gym's routes: refused to the stranger and to a trainer (no list tick).
      for (const who of [stranger, trainer]) {
        for (const res of [
          await post(`${listUrl(gym)}/selection`, { filter: {} }, who.cookies),
          await post(`${listUrl(gym)}/selected/invite-preview`, { selection }, who.cookies),
          await post(`${listUrl(gym)}/selected/invite-people`, { selection, group: "reach" }, who.cookies),
          await exportOf(gym, who, selection),
          await post(`${listUrl(gym)}/invites`, { selection, version: 0, expectedCount: 1, permissionConfirmed: true }, who.cookies),
        ]) {
          expect([403, 404], res.body).toContain(res.statusCode);
          expect(res.body).not.toContain("Pia");
        }
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a selection is checked at the door: too many ticked, words and people together, a digest that is not one",
    async () => {
      const owner = await makeUser("val-owner");
      const gym = (await makeGym(owner, "Validation Gym")).org.id;
      const many = Array.from({ length: MEMBER_LIST_TICKED_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
      expect((await exportOf(gym, owner, { kind: "ticked", entryIds: many })).statusCode).toBe(400);
      expect((await post(`${listUrl(gym)}/selected/invite-preview`, { selection: { kind: "ticked", entryIds: [] } }, owner.cookies)).statusCode).toBe(400);
      const both = await post(
        `${listUrl(gym)}/invites`,
        { status: "Active", selection: ticked(many[0] ?? ""), version: 0, expectedCount: 0, permissionConfirmed: true },
        owner.cookies,
      );
      expect(both.statusCode).toBe(400);
      expect((await exportOf(gym, owner, { kind: "all", filter: {}, count: 0, digest: "nope" })).statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE FILE ITSELF
  // =========================================================================

  it(
    "the file: a name Excel would run is guarded, a +44 phone keeps its plus, past members get their day, the name says what it holds",
    async () => {
      const owner = await makeUser("csv-owner");
      const gym = (await makeGym(owner, "Csv Gym")).org.id;
      // Formula-injection payloads as OWASP's CSV Injection page lists them.
      const hostile = ["=HYPERLINK(\"http://example.com\",\"x\")", "+SUM(1+1)", "-2+3+cmd|' /C calc'!A0", "@SUM(1+1)"];
      for (const [i, name] of hostile.entries()) {
        // Two of the payloads are one name to the duplicates rule: added anyway (5b-iv-b).
        const res = await addAnyway((body) => post(`${listUrl(gym)}/entries`, body, owner.cookies), { fullName: name, email: addr(`hostile${String(i)}`), status: "Active" });
        expect(res.statusCode, res.body).toBe(201);
      }
      await typeIn(gym, owner, { fullName: "Quinn Phone", phone: "+44 7700 900123", status: "Active" });
      const rae = await typeIn(gym, owner, { fullName: "Rae Past", email: addr("rae"), status: "Cancelled" });
      expect((await del(`${listUrl(gym)}/entries/${rae}`, owner.cookies)).statusCode).toBe(200);

      const current = await exportOf(gym, owner, await selectAll(gym, owner, { status: "Active" }));
      expect(current.statusCode, current.body).toBe(200);
      const day = dayInTz(new Date(), "Europe/London");
      expect(current.headers["content-disposition"]).toContain(`filename="Active members ${day}.csv"`);
      const rows = csvRows(current.body);
      const names = rows.slice(1).map((row) => row[0] ?? "");
      for (const name of hostile) expect(names).toContain(`\t${name}`);
      const quinn = rows.find((row) => row[0] === "Quinn Phone");
      expect(quinn?.[2]).toBe("+447700900123");
      expect(rows[0]).not.toContain("Past member since");

      const past = await exportOf(gym, owner, await selectAll(gym, owner, { records: "former" }));
      expect(past.statusCode).toBe(200);
      expect(past.headers["content-disposition"]).toContain(`Past members ${day}.csv`);
      const pastRows = csvRows(past.body);
      expect(pastRows[0]).toContain("Past member since");
      expect(pastRows[1]?.[0]).toBe("Rae Past");
      expect(pastRows[1]?.[pastRows[1].length - 1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Who downloaded how many is noted; the names are not.
      const audit = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_list_exported' ORDER BY id`;
      expect(audit.map((row) => row.meta["rows"])).toEqual(["5", "1"]);
      expect(JSON.stringify(audit)).not.toContain("Quinn");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // ROUND ONE OF THE REVIEW
  // =========================================================================

  it(
    "the same number of people, but different ones, is still a changed Select all: nobody emailed, no file",
    async () => {
      const owner = await makeUser("swap-owner");
      const gym = (await makeGym(owner, "Swap Gym")).org.id;
      await typeIn(gym, owner, { fullName: "Uma Swap", email: addr("uma"), status: "Active" });
      await typeIn(gym, owner, { fullName: "Vic Swap", email: addr("vic"), status: "Cancelled" });
      const filter: MemberListFilter = { status: "Active" };
      const selection = await selectAll(gym, owner, filter);
      const seen = await previewOf(gym, owner, selection);
      expect(seen.reach).toBe(1);
      // One leaves the filter and one joins it before Send: still one Active member.
      await sql`UPDATE gym_member_list_entries SET status = CASE full_name WHEN 'Uma Swap' THEN 'Cancelled' ELSE 'Active' END
                WHERE gym_id = ${gym} AND full_name IN ('Uma Swap', 'Vic Swap')`;
      outbox.length = 0;
      const pressed = await press(gym, owner, selection, seen);
      expect(pressed.statusCode, pressed.body).toBe(409);
      expect(memberListSelectionChangedSchema.parse(JSON.parse(pressed.body)).count).toBe(1);
      const file = await exportOf(gym, owner, selection);
      expect(file.statusCode).toBe(409);
      expect(file.body).not.toContain("Vic Swap");
      await runSender();
      expect(emailedTo()).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the file's note counts the people in it, not the ids sent; an email that starts like a formula is guarded",
    async () => {
      const owner = await makeUser("count-owner");
      const gym = (await makeGym(owner, "Count Gym")).org.id;
      const stranger = await makeUser("count-stranger");
      const theirs = (await makeGym(stranger, "Count Stranger Gym")).org.id;
      const wes = await typeIn(gym, owner, { fullName: "Wes Count", email: `+sum${addr("wes")}`, status: "Active" });
      const xia = await typeIn(gym, owner, { fullName: "Xia Count", email: `-2+3${addr("xia")}`, status: "Cancelled" });
      expect((await del(`${listUrl(gym)}/entries/${xia}`, owner.cookies)).statusCode).toBe(200);
      const foreign = await typeIn(theirs, stranger, { fullName: "Yan Elsewhere", email: addr("yan"), status: "Active" });
      const nobody = "00000000-0000-4000-8000-000000000001";

      const file = await exportOf(gym, owner, ticked(wes, xia, foreign, wes, nobody));
      expect(file.statusCode, file.body).toBe(200);
      const rows = csvRows(file.body);
      expect(rows.slice(1).map((row) => row[0])).toEqual(["Wes Count", "Xia Count"]);
      expect(rows[1]?.[1]).toBe(`\t+sum${addr("wes")}`);
      expect(rows[2]?.[1]).toBe(`\t-2+3${addr("xia")}`);
      const audit = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_list_exported'`;
      expect(audit.map((row) => row.meta["rows"])).toEqual(["2"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "downloads: 20 an hour a person and 60 at one address, and presses refused to one person use up nobody else's",
    async () => {
      const desk = "10.65.0.1";
      const owners: User[] = [];
      const selections: MemberListSelection[] = [];
      for (const n of [0, 1, 2, 3]) {
        const who = await makeUser(`desk-${String(n)}`);
        const gym = (await makeGym(who, `Desk Gym ${String(n)}`)).org.id;
        const one = await typeIn(gym, who, { fullName: `Zed Desk ${String(n)}`, email: addr(`zed${String(n)}`), status: "Active" });
        owners.push(who);
        selections.push(ticked(one));
      }
      const pressAt = async (n: number, ip: string) => {
        const who = owners[n];
        const selection = selections[n];
        if (who === undefined || selection === undefined) throw new Error("no such owner");
        const gymId = (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id = ${who.userId}`)[0]?.id ?? "";
        return (await post(`${listUrl(gymId)}/export.csv`, { selection }, who.cookies, ip)).statusCode;
      };
      // One person: twenty, then refused — and their five refused presses cost the desk nothing.
      const first: number[] = [];
      for (let i = 0; i < 25; i += 1) first.push(await pressAt(0, desk));
      expect(first.filter((code) => code === 200)).toHaveLength(20);
      expect(first.slice(20)).toEqual([429, 429, 429, 429, 429]);
      // Two colleagues at the same desk still get their twenty each: sixty at the address.
      for (const n of [1, 2]) {
        const codes: number[] = [];
        for (let i = 0; i < 20; i += 1) codes.push(await pressAt(n, desk));
        expect(codes.every((code) => code === 200), `owner ${String(n)}: ${codes.join(",")}`).toBe(true);
      }
      // The desk is full: a fourth is refused there, and those refusals are given back to
      // them, so from another address they still have their own twenty.
      for (let i = 0; i < 5; i += 1) expect(await pressAt(3, desk)).toBe(429);
      const elsewhere: number[] = [];
      for (let i = 0; i < 20; i += 1) elsewhere.push(await pressAt(3, "10.65.0.2"));
      expect(elsewhere.every((code) => code === 200)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
