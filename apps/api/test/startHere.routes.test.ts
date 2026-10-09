// Overview's "Start here" list, through its routes against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 23b; spec Part 3 §5.1.
//
// The first block is the worst thing this job could do: a tick that lies, because it was
// read from another gym. One gym is set up through the console's own routes and one is
// left empty; each reads only its own.
//
// Every step is set up the way a gym does it, through the route its own page calls, so a
// tick that stops following that page fails here.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { START_HERE_STEPS, startHereResponseSchema } from "@app/shared";
import type { GymClassesResponse, GymMembershipTypesResponse, StartHere, StartHereStep } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "start-here-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: "start-here-pass-secret-0123456789abcdef", // dummy test value, gitleaks:allow
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  email: string;
  cookies: Cookies;
}

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_start_here_routes";

let ipCounter = 0;
const nextIp = () => `10.23.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const NOTHING_DONE: Record<StartHereStep, boolean> = {
  memberships: false,
  members: false,
  staff: false,
  classes: false,
  hours: false,
  contact: false,
  frontDesk: false,
};
const only = (...steps: StartHereStep[]): Record<StartHereStep, boolean> => ({
  ...NOTHING_DONE,
  ...Object.fromEntries(steps.map((s) => [s, true])),
});

d("Overview's Start here list: whose ticks, who sees which step, and who hides it (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sth-t-%@example.com')`;
    await sql`DELETE FROM gym_staff_invite_sends WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff_invites WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'sth-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => send("PUT", path, cookies, payload);
  const del = (path: string, cookies: Cookies = {}) => send("DELETE", path, cookies);

  const makeUser = async (local: string): Promise<User> => {
    const email = `sth-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Sth ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  /** A gym made today by its owner: nothing set up, on a live plan. */
  const makeGym = async (owner: User, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await subscribeGym(gymId);
    return gymId;
  };

  /** Somebody on the gym's staff holding exactly these ticks. */
  const makeStaff = async (gymId: string, who: User, role: "manager" | "trainer", privileges: string[]) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${privileges})`;
  };

  const startHereUrl = (gymId: string) => `/v1/orgs/${gymId}/start-here`;
  const read = async (gymId: string, who: User): Promise<StartHere> => {
    const res = await get(startHereUrl(gymId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return startHereResponseSchema.parse(JSON.parse(res.body)).startHere;
  };
  const doneOf = (answer: StartHere) => Object.fromEntries(answer.steps.map((s) => [s.step, s.done]));
  const stored = async (gymId: string) =>
    (await sql<{ activation: unknown }[]>`SELECT activation FROM gyms WHERE id = ${gymId}`)[0]?.activation;
  const audits = (gymId: string) =>
    sql<{ action: string }[]>`SELECT action FROM audit_log WHERE gym_id = ${gymId} AND action LIKE 'org.start_here%' ORDER BY id`;

  // ── Each step, done the way its own page does it ──

  const addMembership = async (gymId: string, owner: User, name = "Gold Monthly"): Promise<string> => {
    const res = await post(
      `/v1/orgs/${gymId}/membership-types`,
      {
        name,
        description: null,
        kind: "recurring",
        priceMinor: 4999,
        termCount: 1,
        termUnit: "month",
        packClasses: null,
        packDays: null,
        access: "all_classes",
        bookingsLimit: null,
        bookingsPeriod: null,
        classTypeIds: null,
        includesPt: false,
      },
      owner.cookies,
    );
    expect(res.statusCode, res.body).toBe(201);
    const made = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === name);
    if (made === undefined) throw new Error("no membership type came back");
    return made.id;
  };

  const addPerson = async (gymId: string, owner: User, fullName = "Priya Shah"): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName, email: `sth-t-listed-${String(ipCounter)}@example.com` }, owner.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    const rows = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gymId} AND full_name = ${fullName}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("the person is not on the list");
    return id;
  };

  const inviteStaff = async (gymId: string, owner: User, local: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/staff/invites`, { email: `sth-t-${local}@example.com`, role: "trainer" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const body = JSON.parse(res.body) as { outcome: string; invite?: { id: string } };
    if (body.outcome !== "invited" || body.invite === undefined) throw new Error("the person was not invited");
    return body.invite.id;
  };

  const addClass = async (gymId: string, owner: User, name = "Yoga"): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/classes`, { name, minutes: 60, places: 20, colour: "blue" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const made = (JSON.parse(res.body) as GymClassesResponse).entries.find((e) => e.type.name === name);
    if (made === undefined) throw new Error("no class came back");
    return made.type.id;
  };

  const addTimeSlot = async (gymId: string, owner: User, classId: string): Promise<string> => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await post(
      `/v1/orgs/${gymId}/classes/${classId}/repeats`,
      { minutes: 60, places: 20, coachUserId: null, weekdays: [1, 3], startMinute: 18 * 60, startsOn: today },
      owner.cookies,
    );
    expect(res.statusCode, res.body).toBe(201);
    const rows = await sql<{ id: string }[]>`SELECT id FROM gym_class_schedules WHERE gym_id = ${gymId} AND class_type_id = ${classId}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no time slot was kept");
    return id;
  };

  const setHours = async (gymId: string, owner: User, body: unknown) => {
    const res = await put(`/v1/orgs/${gymId}/hours`, body, owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };
  /** Settings → How members reach you. */
  const setContact = async (gymId: string, owner: User, body: unknown) => {
    const res = await api().inject({
      method: "PATCH",
      url: `/v1/orgs/${gymId}`,
      remoteAddress: nextIp(),
      cookies: owner.cookies,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(body),
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  const A_WEEK = { mode: "scheduled", week: [{ weekday: 2, sessions: [{ opensMinute: 6 * 60, closesMinute: 21 * 60 }] }] };

  /** A device added in Settings. Its link is opened on the tablet by `openLink`. */
  const addDevice = async (gymId: string, owner: User, name = "Front desk"): Promise<{ deviceId: string; token: string }> => {
    const res = await post(`/v1/orgs/${gymId}/checkin-devices`, { name }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const body = JSON.parse(res.body) as { device: { id: string }; link: string };
    return { deviceId: body.device.id, token: body.link.split("#")[1] ?? "" };
  };
  const openLink = async (token: string) => {
    expect((await post("/v1/checkin/device/claim", { token })).statusCode).toBe(200);
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
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  it(
    "a gym's ticks are its own: one gym set up and one empty each read only theirs, and nobody outside reads or hides either",
    async () => {
      const setUpOwner = await makeUser("worst-setup-owner");
      const emptyOwner = await makeUser("worst-empty-owner");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const trainer = await makeUser("worst-trainer");
      const setUp = await makeGym(setUpOwner, "Sth Set Up Gym");
      const empty = await makeGym(emptyOwner, "Sth Empty Gym");

      // A gym made today has nothing ticked.
      expect(doneOf(await read(setUp, setUpOwner))).toEqual(NOTHING_DONE);
      expect(doneOf(await read(empty, emptyOwner))).toEqual(NOTHING_DONE);

      // One gym does all seven, each on its own page.
      await addMembership(setUp, setUpOwner);
      await addPerson(setUp, setUpOwner);
      await inviteStaff(setUp, setUpOwner, "worst-coach");
      await addTimeSlot(setUp, setUpOwner, await addClass(setUp, setUpOwner));
      await setHours(setUp, setUpOwner, A_WEEK);
      await setContact(setUp, setUpOwner, { contactPhone: "020 7946 0958" });
      await openLink((await addDevice(setUp, setUpOwner)).token);

      const mine = await read(setUp, setUpOwner);
      expect(mine.steps.map((s) => s.step)).toEqual([...START_HERE_STEPS]);
      expect(doneOf(mine)).toEqual(only(...START_HERE_STEPS));
      // The gym beside it did none of them, and reads none.
      expect(doneOf(await read(empty, emptyOwner))).toEqual(NOTHING_DONE);

      // Nobody outside reads either gym's list, and nobody who may not hides it.
      await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${setUp}, ${member.userId})`;
      await makeStaff(setUp, trainer, "trainer", ["members.read", "attendance.read"]);
      const outsiders: { who: string; cookies: Cookies; read: number; write: number }[] = [
        { who: "a stranger", cookies: stranger.cookies, read: 404, write: 404 },
        { who: "the other gym's owner", cookies: emptyOwner.cookies, read: 404, write: 404 },
        { who: "this gym's own member", cookies: member.cookies, read: 404, write: 404 },
        { who: "this gym's trainer", cookies: trainer.cookies, read: 200, write: 403 },
        { who: "nobody at all", cookies: {}, read: 401, write: 401 },
      ];
      for (const outsider of outsiders) {
        const res = await get(startHereUrl(setUp), outsider.cookies);
        expect(res.statusCode, `${outsider.who} GET`).toBe(outsider.read);
        if (outsider.read !== 200) expect(res.body).not.toContain("steps");
        expect((await put(startHereUrl(setUp), { hidden: true }, outsider.cookies)).statusCode, `${outsider.who} PUT`).toBe(outsider.write);
        expect(await stored(setUp)).toEqual({});
      }
      // A trainer on the usual ticks can do none of the six, so is sent none.
      expect(await read(setUp, trainer)).toEqual({ hidden: false, canHide: false, steps: [] });

      // Hiding one gym's list hides only that gym's.
      expect((await put(startHereUrl(setUp), { hidden: true }, setUpOwner.cookies)).statusCode).toBe(200);
      expect((await read(setUp, setUpOwner)).hidden).toBe(true);
      expect((await read(empty, emptyOwner)).hidden).toBe(false);
      expect(await stored(empty)).toEqual({});
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "each step ticks itself for its own thing alone, and unticks when that thing goes",
    async () => {
      const owner = await makeUser("steps-owner");
      /** A fresh gym for each step, so one step's thing can never tick another's. */
      const fresh = async (name: string) => makeGym(owner, `Sth ${name}`);
      const done = async (gymId: string) => doneOf(await read(gymId, owner));

      // What you sell: a membership on the price list; archived, it is not for sale.
      const sells = await fresh("Sells");
      const typeId = await addMembership(sells, owner);
      expect(await done(sells)).toEqual(only("memberships"));
      expect((await del(`/v1/orgs/${sells}/membership-types/${typeId}`, owner.cookies)).statusCode).toBe(200);
      expect(await done(sells)).toEqual(NOTHING_DONE);

      // Members: a person on the list; off the list, nobody is.
      const lists = await fresh("Lists");
      const entryId = await addPerson(lists, owner);
      expect(await done(lists)).toEqual(only("members"));
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${lists} AND id = ${entryId}`;
      expect(await done(lists)).toEqual(NOTHING_DONE);

      // Staff: an invitation that is waiting; cancelled or run out, it is not.
      const invites = await fresh("Invites");
      const inviteId = await inviteStaff(invites, owner, "steps-coach-a");
      expect(await done(invites)).toEqual(only("staff"));
      expect((await del(`/v1/orgs/${invites}/staff/invites/${inviteId}`, owner.cookies)).statusCode).toBe(200);
      expect(await done(invites)).toEqual(NOTHING_DONE);
      const secondId = await inviteStaff(invites, owner, "steps-coach-b");
      expect(await done(invites)).toEqual(only("staff"));
      await sql`
        UPDATE gym_staff_invites SET created_at = now() - interval '30 days', expires_at = now() - interval '1 day'
        WHERE gym_id = ${invites} AND id = ${secondId}`;
      expect(await done(invites)).toEqual(NOTHING_DONE);
      // An invitation the person said no to is still on the owner's list, and is nobody.
      const declined = await fresh("Declined");
      const declinedId = await inviteStaff(declined, owner, "steps-coach-d");
      expect(await done(declined)).toEqual(only("staff"));
      await sql`
        UPDATE gym_staff_invites SET state = 'declined', answered_at = now()
        WHERE gym_id = ${declined} AND id = ${declinedId}`;
      expect(await done(declined)).toEqual(NOTHING_DONE);
      // Somebody else on the staff is the step done too; the owner alone is not.
      const staffed = await fresh("Staffed");
      expect(await done(staffed)).toEqual(NOTHING_DONE);
      const coach = await makeUser("steps-coach-c");
      await makeStaff(staffed, coach, "trainer", ["members.read"]);
      expect(await done(staffed)).toEqual(only("staff"));
      // Not somebody whose account is deleted: the Staff list does not show them either.
      await sql`UPDATE users SET status = 'deleted' WHERE id = ${coach.userId}`;
      expect(await done(staffed)).toEqual(NOTHING_DONE);
      await sql`UPDATE users SET status = 'active' WHERE id = ${coach.userId}`;

      // Classes: a class with a time slot; a class with none is not on the calendar,
      // nor is one whose time slot was cancelled or that was archived.
      const classes = await fresh("Classes");
      const classId = await addClass(classes, owner);
      expect(await done(classes)).toEqual(NOTHING_DONE);
      const slotId = await addTimeSlot(classes, owner, classId);
      expect(await done(classes)).toEqual(only("classes"));
      expect((await del(`/v1/orgs/${classes}/class-repeats/${slotId}`, owner.cookies)).statusCode).toBe(200);
      expect(await done(classes)).toEqual(NOTHING_DONE);
      const archived = await fresh("Archived Class");
      const goneId = await addClass(archived, owner, "Spin");
      await addTimeSlot(archived, owner, goneId);
      expect(await done(archived)).toEqual(only("classes"));
      // Archived alone, its time slot left running: the tick's own condition, not the
      // route's (which cancels the time slots as well).
      await sql`UPDATE gym_class_types SET archived_at = now() WHERE gym_id = ${archived} AND id = ${goneId}`;
      expect(await done(archived)).toEqual(NOTHING_DONE);
      await sql`UPDATE gym_class_types SET archived_at = NULL WHERE gym_id = ${archived} AND id = ${goneId}`;
      expect(await done(archived)).toEqual(only("classes"));
      expect((await del(`/v1/orgs/${archived}/classes/${goneId}`, owner.cookies)).statusCode).toBe(200);
      expect(await done(archived)).toEqual(NOTHING_DONE);
      // A time slot with a last day: on the calendar through that day, over after it.
      const dated = await fresh("Dated Class");
      const datedSlot = await addTimeSlot(dated, owner, await addClass(dated, owner, "Pilates"));
      await sql`
        UPDATE gym_class_schedules
        SET starts_on = (now() AT TIME ZONE 'Europe/London')::date - 30, ends_on = (now() AT TIME ZONE 'Europe/London')::date
        WHERE gym_id = ${dated} AND id = ${datedSlot}`;
      expect(await done(dated)).toEqual(only("classes"));
      await sql`
        UPDATE gym_class_schedules SET ends_on = (now() AT TIME ZONE 'Europe/London')::date - 1
        WHERE gym_id = ${dated} AND id = ${datedSlot}`;
      expect(await done(dated)).toEqual(NOTHING_DONE);

      // Opening hours: a week, always open, or closed every day. A gym that has not said
      // is the fresh gym each block above starts from.
      const hours = await fresh("Hours");
      expect(await done(hours)).toEqual(NOTHING_DONE);
      await setHours(hours, owner, A_WEEK);
      expect(await done(hours)).toEqual(only("hours"));
      const always = await fresh("Always Open");
      await setHours(always, owner, { mode: "open_24h" });
      expect(await done(always)).toEqual(only("hours"));
      const closed = await fresh("Closed");
      await setHours(closed, owner, { mode: "scheduled", week: [] });
      expect(await done(closed)).toEqual(only("hours"));

      // How members reach the gym: a phone number or an email address, and neither once
      // both are cleared.
      const reach = await fresh("Reach");
      await setContact(reach, owner, { contactEmail: "hello@sthreach.com" });
      expect(await done(reach)).toEqual(only("contact"));
      await setContact(reach, owner, { contactPhone: "+44 20 7946 0958", contactEmail: null });
      expect(await done(reach)).toEqual(only("contact"));
      await setContact(reach, owner, { contactPhone: "" });
      expect(await done(reach)).toEqual(NOTHING_DONE);

      // The front desk: a device whose link was opened on the tablet; one only added, or
      // switched off, checks nobody in.
      const desk = await fresh("Desk");
      const device = await addDevice(desk, owner);
      expect(await done(desk)).toEqual(NOTHING_DONE);
      await openLink(device.token);
      expect(await done(desk)).toEqual(only("frontDesk"));
      expect((await post(`/v1/orgs/${desk}/checkin-devices/${device.deviceId}/off`, {}, owner.cookies)).statusCode).toBe(200);
      expect(await done(desk)).toEqual(NOTHING_DONE);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "each member of staff is sent the steps their own ticks let them do, with the same ticks as everybody else",
    async () => {
      const owner = await makeUser("who-owner");
      const gymId = await makeGym(owner, "Sth Who Gym");
      await addMembership(gymId, owner);
      await setHours(gymId, owner, A_WEEK);

      const people: { who: string; role: "manager" | "trainer"; ticks: string[]; steps: StartHereStep[]; canHide: boolean }[] = [
        {
          who: "manager",
          role: "manager",
          ticks: ["members.read", "members.confirm", "members.remove", "schedule.manage", "memberships.manage", "attendance.read"],
          steps: ["memberships", "members", "classes"],
          canHide: false,
        },
        { who: "desk", role: "trainer", ticks: ["members.read", "members.confirm"], steps: ["members"], canHide: false },
        { who: "details", role: "manager", ticks: ["org.manage"], steps: ["hours", "contact", "frontDesk"], canHide: true },
        { who: "prices", role: "trainer", ticks: ["memberships.manage"], steps: ["memberships"], canHide: false },
        { who: "none", role: "trainer", ticks: [], steps: [], canHide: false },
      ];
      for (const person of people) {
        const user = await makeUser(`who-${person.who}`);
        await makeStaff(gymId, user, person.role, person.ticks);
        const answer = await read(gymId, user);
        expect(answer.steps.map((s) => s.step), person.who).toEqual(person.steps);
        expect(answer.canHide, person.who).toBe(person.canHide);
        // Progress is the gym's: whoever reads it, a step is done or not for everybody.
        for (const step of answer.steps) expect(step.done, `${person.who} ${step.step}`).toBe(step.step === "memberships" || step.step === "hours");
      }
      const ownerSees = await read(gymId, owner);
      expect(ownerSees.steps.map((s) => s.step)).toEqual([...START_HERE_STEPS]);
      expect(ownerSees.canHide).toBe(true);
      // The owner counts the other staff: five people beside them here.
      expect(doneOf(ownerSees)).toEqual(only("memberships", "hours", "staff"));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Hide is kept for the whole gym and Show brings it back; the same answer twice changes nothing; a bad request and a gym with no plan write nothing",
    async () => {
      const owner = await makeUser("hide-owner");
      const details = await makeUser("hide-details");
      const desk = await makeUser("hide-desk");
      const gymId = await makeGym(owner, "Sth Hide Gym");
      await makeStaff(gymId, details, "manager", ["org.manage"]);
      await makeStaff(gymId, desk, "trainer", ["members.read", "members.confirm"]);
      await addPerson(gymId, owner);

      const hide = (who: User, body: unknown) => put(startHereUrl(gymId), body, who.cookies);
      const hidden = await hide(owner, { hidden: true });
      expect(hidden.statusCode, hidden.body).toBe(200);
      const answer = startHereResponseSchema.parse(JSON.parse(hidden.body)).startHere;
      expect(answer.hidden).toBe(true);
      // The steps are still sent: hiding is not forgetting.
      expect(doneOf(answer)).toEqual(only("members", "staff"));
      // Hidden for everybody on the staff, not only whoever pressed it.
      for (const who of [owner, details, desk]) expect((await read(gymId, who)).hidden).toBe(true);
      expect(await stored(gymId)).toEqual({ startHereHidden: true });
      expect((await audits(gymId)).map((a) => a.action)).toEqual(["org.start_here_hidden"]);

      // The same answer again: 200, and nothing new is written.
      expect((await hide(owner, { hidden: true })).statusCode).toBe(200);
      expect((await audits(gymId)).map((a) => a.action)).toEqual(["org.start_here_hidden"]);

      // Somebody else holding the gym's details shows it again.
      expect((await hide(details, { hidden: false })).statusCode).toBe(200);
      for (const who of [owner, details, desk]) expect((await read(gymId, who)).hidden).toBe(false);
      expect(await stored(gymId)).toEqual({ startHereHidden: false });
      expect((await audits(gymId)).map((a) => a.action)).toEqual(["org.start_here_hidden", "org.start_here_shown"]);

      // Staff without the tick cannot.
      expect((await hide(desk, { hidden: true })).statusCode).toBe(403);
      // A request that is not hidden true or false.
      for (const bad of [{}, { hidden: "true" }, { hidden: 1 }, { hidden: true, steps: [] }, { hide: true }]) {
        const res = await hide(owner, bad);
        expect(res.statusCode, JSON.stringify(bad)).toBe(400);
        expect((JSON.parse(res.body) as { error: string }).error).toBe("validation_error");
      }
      expect((await get("/v1/orgs/not-a-gym/start-here", owner.cookies)).statusCode).toBe(400);
      expect(await stored(gymId)).toEqual({ startHereHidden: false });

      // Whatever else the column holds is kept beside the mark, and a mark that is not
      // true or false reads as not hidden.
      await sql`UPDATE gyms SET activation = ${sql.json({ somethingElse: "kept", startHereHidden: "yes" })}::jsonb WHERE id = ${gymId}`;
      expect((await read(gymId, owner)).hidden).toBe(false);
      expect((await hide(owner, { hidden: true })).statusCode).toBe(200);
      expect(await stored(gymId)).toEqual({ somethingElse: "kept", startHereHidden: true });

      // A gym with no live plan reads its list and cannot change it.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
      expect((await read(gymId, owner)).hidden).toBe(true);
      const refused = await hide(owner, { hidden: false });
      expect(refused.statusCode).toBe(409);
      expect((JSON.parse(refused.body) as { error: string }).error).toBe("gym_not_on_plan");
      expect(await stored(gymId)).toEqual({ somethingElse: "kept", startHereHidden: true });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "each person has their own allowance at one address: one using theirs up stops nobody else",
    async () => {
      const owner = await makeUser("limit-owner");
      const manager = await makeUser("limit-manager");
      const gymId = await makeGym(owner, "Sth Limit Gym");
      await makeStaff(gymId, manager, "manager", ["members.read", "members.confirm"]);
      const desk = "203.0.113.23";
      const from = (cookies: Cookies) => api().inject({ method: "GET", url: startHereUrl(gymId), remoteAddress: desk, cookies });

      let first429 = 0;
      for (let i = 1; i <= 305 && first429 === 0; i++) {
        const res = await from(owner.cookies);
        if (res.statusCode === 429) first429 = i;
        else expect(res.statusCode).toBe(200);
      }
      expect(first429).toBe(301);
      expect((await from(manager.cookies)).statusCode).toBe(200);
      expect((await from({})).statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );
});
