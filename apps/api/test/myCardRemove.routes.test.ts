// Remove card, in the member's app (Stage 5 item 20e; Kd 2026-11-11, `rulings/2026-11-10-20d.md`): a member removes
// their own saved card only while nothing can be charged to it — it pays for nobody else, no membership renews on it
// and no payment is still to make. Against real Postgres (DATABASE_URL-gated), with Square answered by the fake in
// `fakeSquareTerminal.ts`.
//
// The first test is the worst thing this job could do to a real person: Priya pays for Aarav, removes her card from
// the app, and Aarav's renewal finds no card.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  myCardResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type GymMembershipTypesResponse,
  type MyCardView,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "my-card-remove-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-MYCARDREMOVEAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-MYCARDREMOVESECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 300_000;
const LIVE_PLAN = "zz_my_card_remove";

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  userId: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  name: string;
  owner: Person;
  acct: Account;
}
interface Card {
  cardId: string;
  last4: string;
  savedAt: string;
}

let ipCounter = 0;
const nextIp = () => `10.67.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const weekly = {
  name: "Gold Weekly",
  description: null,
  kind: "recurring",
  priceMinor: 2500,
  termCount: 1,
  termUnit: "week",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};

d("Remove card in the member's app: only while nothing can be charged to it (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mcr-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'mcr-t-%@example.com'`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_disables WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mineSql})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gyms WHERE id IN (${mineSql})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'mcr-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const signedIn = async (name: string): Promise<Person> => {
    const email = `mcr-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to its own Square account. */
  const makeGym = async (label: string): Promise<Gym> => {
    const owner = await signedIn(`${label} Owner`);
    const name = `${label} ${uniq()}`;
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const acct = account(`MCR${uniq()}`);
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    return { id, name, owner, acct };
  };
  const typeOf = async (gym: Gym): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, weekly);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === weekly.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const person = async (gym: Gym, fullName: string): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `mcr-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** The person, signed in to the app and linked to their record. */
  const member = async (gym: Gym, entryId: string, who?: Person): Promise<Person> => {
    const p = who ?? (await signedIn("Member"));
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${p.userId}, ${entryId})`;
    return p;
  };
  const todayOf = async (gym: Gym, entryId: string): Promise<string> =>
    heldMembershipsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies)).body)).today;
  /** Gold Weekly from `startsOn` (today), paid at the desk or not: it renews until it is cancelled. */
  const give = async (gym: Gym, typeId: string, entryId: string, o: { paid?: boolean; startsOn?: string } = {}): Promise<string> => {
    const startsOn = o.startsOn ?? (await todayOf(gym, entryId));
    const paid = o.paid ?? true;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), ...(paid ? { method: "cash" } : {}), typeId, startsOn, paid });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    return m.id;
  };
  /** A card on file for the record, in the gym's connected account, known to Square. */
  const cardFor = async (gym: Gym, entryId: string, last4: string): Promise<Card> => {
    const cardId = `ccof:${randomUUID()}`;
    const customerId = `CUST${uniq()}`;
    square.card(cardId, gym.acct.merchantId, customerId);
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'app', NULL, 'VISA', ${last4}, now())
      RETURNING id`;
    const [row] = await sql<{ saved_at: Date }[]>`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${gym.acct.merchantId}, ${customerId}, ${cardId}, 'VISA', ${last4}, 12, 2031, 'app', NULL, ${agreed?.id ?? null}, now(), now())
      RETURNING saved_at`;
    return { cardId, last4, savedAt: (row?.saved_at ?? new Date()).toISOString() };
  };
  const myCard = async (gym: Gym, who: Person): Promise<MyCardView> => {
    const res = await send("GET", `/v1/orgs/${gym.id}/my-card`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myCardResponseSchema.parse(JSON.parse(res.body)).myCard;
  };
  const remove = (gym: Gym, who: Person, card: { last4: string; savedAt: string }) => send("POST", `/v1/orgs/${gym.id}/my-card/remove`, who.cookies, { last4: card.last4, savedAt: card.savedAt });
  const cardOn = async (gymId: string, entryId: string): Promise<string | null> =>
    (await sql<{ card_id: string }[]>`SELECT card_id FROM gym_member_cards WHERE gym_id = ${gymId} AND entry_id = ${entryId}`)[0]?.card_id ?? null;
  const stopsOwed = (gymId: string) => sql<{ card_id: string; tries: number }[]>`SELECT card_id, tries FROM gym_card_disables WHERE gym_id = ${gymId}`;
  const errorOf = (res: { body: string }) => { const e = JSON.parse(res.body) as { error: string; message: string }; return { error: { code: e.error, message: e.message } }; };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    square.state.disables = true;
    app = await buildApp(config(), {
      squareApi: square.api,
      orgs: { gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
    });
    await api().ready();
  }, T);
  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("never removes a card that pays for somebody else: Priya pays for Aarav, and Aarav's renewal keeps her card", async () => {
    const gym = await makeGym("Payer Gym");
    const typeId = await typeOf(gym);
    const priya = await person(gym, "Priya Sharma");
    const aarav = await person(gym, "Aarav Sharma");
    await give(gym, typeId, aarav);
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${aarav}, ${priya})`;
    const card = await cardFor(gym, priya, "4242");
    const priyaApp = await member(gym, priya);
    const aaravApp = await member(gym, aarav);

    const shown = await myCard(gym, priyaApp);
    expect(shown.card?.last4).toBe("4242");
    expect(shown.canRemove).toBe(false);
    expect(shown.stays).toBe("pays_for");
    expect(shown.paysFor).toEqual({ names: ["Aarav Sharma"], more: 0 });

    const refused = await remove(gym, priyaApp, card);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(errorOf(refused).error.code).toBe("card_stays");
    expect(errorOf(refused).error.message).toBe("This card also pays for Aarav Sharma, so it stays on file. Use Update card to change it, or ask the front desk.");

    // Aarav sees who pays, and naming Priya's card from his app removes nothing.
    const his = await myCard(gym, aaravApp);
    expect(his.paidBy).toBe("Priya Sharma");
    expect(his.card).toBeNull();
    expect(his.canRemove).toBe(false);
    expect((await remove(gym, aaravApp, card)).statusCode).toBe(200);

    expect(await cardOn(gym.id, priya)).toBe(card.cardId);
    expect(square.stopped).not.toContain(card.cardId);
    expect(await stopsOwed(gym.id)).toEqual([]);
  });

  it("removes only the member's own card at the gym they press it in, and refuses strangers and a bad request", async () => {
    const iron = await makeGym("Iron");
    const lotus = await makeGym("Lotus");
    const ironId = await person(iron, "Tara Two Gyms");
    const lotusId = await person(lotus, "Tara Two Gyms");
    const tara = await member(iron, ironId);
    await member(lotus, lotusId, tara);
    const ironCard = await cardFor(iron, ironId, "1111");
    const lotusCard = await cardFor(lotus, lotusId, "2222");
    const other = await person(lotus, "Owen Other");
    const otherCard = await cardFor(lotus, other, "3333");
    const stranger = await signedIn("Stranger");

    // A stranger to Lotus gets 404, and so does Lotus's owner pressing a member's own route without a record.
    expect((await remove(lotus, stranger, lotusCard)).statusCode).toBe(404);
    expect((await send("GET", `/v1/orgs/${lotus.id}/my-card`, stranger.cookies)).statusCode).toBe(404);
    // A request that names no card is refused before anything is read.
    const bad = await send("POST", `/v1/orgs/${lotus.id}/my-card/remove`, tara.cookies, { last4: "22", savedAt: "yesterday" });
    expect(bad.statusCode).toBe(400);
    // Owen's card, named from Tara's app: hers is not that one, nothing changes.
    const wrong = await remove(lotus, tara, otherCard);
    expect(wrong.statusCode, wrong.body).toBe(409);
    expect(errorOf(wrong).error.code).toBe("card_changed");
    expect(await cardOn(lotus.id, lotusId)).toBe(lotusCard.cardId);

    expect((await myCard(lotus, tara)).canRemove).toBe(true);
    const done = await remove(lotus, tara, lotusCard);
    expect(done.statusCode, done.body).toBe(200);
    const after = myCardResponseSchema.parse(JSON.parse(done.body)).myCard;
    expect(after.card).toBeNull();
    expect(after.canRemove).toBe(false);

    expect(await cardOn(lotus.id, lotusId)).toBeNull();
    expect(await cardOn(iron.id, ironId)).toBe(ironCard.cardId);
    expect(await cardOn(lotus.id, other)).toBe(otherCard.cardId);
    expect(square.stopped.filter((id) => [ironCard.cardId, lotusCard.cardId, otherCard.cardId].includes(id))).toEqual([lotusCard.cardId]);
    // Told to Square at once: nothing is left owed.
    expect(await stopsOwed(lotus.id)).toEqual([]);
    const [audit] = await sql<{ actor_user_id: string; action: string; meta: { last4: string } }[]>`
      SELECT actor_user_id, action, meta FROM audit_log WHERE gym_id = ${lotus.id} AND action = 'member.card_removed'`;
    expect(audit).toMatchObject({ actor_user_id: tara.userId, meta: { last4: "2222" } });

    // Pressed twice: removed once, and the second press answers as it is now.
    const again = await remove(lotus, tara, lotusCard);
    expect(again.statusCode, again.body).toBe(200);
    expect(myCardResponseSchema.parse(JSON.parse(again.body)).myCard.card).toBeNull();
    expect(square.stopped.filter((id) => id === lotusCard.cardId)).toHaveLength(1);
  });

  it("keeps a card that was replaced since the screen read it", async () => {
    const gym = await makeGym("Replaced Gym");
    const entry = await person(gym, "Rhea Replaced");
    const rhea = await member(gym, entry);
    // The screen showed Visa 1111, saved an hour ago; the card on file now is 5555.
    const old = { last4: "1111", savedAt: new Date(Date.now() - 3_600_000).toISOString() };
    const now = await cardFor(gym, entry, "5555");
    const res = await remove(gym, rhea, old);
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res).error.code).toBe("card_changed");
    expect(await cardOn(gym.id, entry)).toBe(now.cardId);
    // The same last four, saved later: still not the card the screen showed.
    expect((await remove(gym, rhea, { last4: "5555", savedAt: old.savedAt })).statusCode).toBe(409);
    expect(await cardOn(gym.id, entry)).toBe(now.cardId);
  });

  it("removes the card here when Square does not answer, and owes Square its stop for the worker", async () => {
    const gym = await makeGym("Quiet Square Gym");
    const entry = await person(gym, "Sam Silent");
    const sam = await member(gym, entry);
    const card = await cardFor(gym, entry, "7777");
    square.state.disables = false;
    try {
      const res = await remove(gym, sam, card);
      expect(res.statusCode, res.body).toBe(200);
    } finally {
      square.state.disables = true;
    }
    expect(await cardOn(gym.id, entry)).toBeNull();
    expect(await stopsOwed(gym.id)).toEqual([{ card_id: card.cardId, tries: 1 }]);
  });

  it("says, for each kind of member, whether the card can go and why not, and the press agrees with the screen", async () => {
    const gym = await makeGym("Table Gym");
    const typeId = await typeOf(gym);
    const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    type Want = { canRemove: true } | { stays: "pays_for" | "renews" | "owed"; paysFor?: { names: string[]; more: number } };
    const cases: { name: string; set: (entryId: string) => Promise<void>; want: Want }[] = [
      { name: "Nina Nothing Held", set: () => Promise.resolve(), want: { canRemove: true } },
      { name: "Ren Renews", set: async (e) => void (await give(gym, typeId, e)), want: { stays: "renews" } },
      {
        name: "Fred Frozen",
        set: async (e) => {
          const m = await give(gym, typeId, e);
          await sql`UPDATE gym_held_memberships SET status = 'frozen', frozen_on = starts_on WHERE id = ${m}`;
        },
        want: { stays: "renews" },
      },
      {
        name: "Stan Stops Paid",
        set: async (e) => {
          const m = await give(gym, typeId, e);
          await sql`UPDATE gym_held_memberships SET renews = false WHERE id = ${m}`;
        },
        want: { canRemove: true },
      },
      {
        name: "Carl Cancelled",
        set: async (e) => {
          const m = await give(gym, typeId, e);
          await sql`UPDATE gym_held_memberships SET status = 'cancelled', cancelled_on = starts_on WHERE id = ${m}`;
        },
        want: { canRemove: true },
      },
      {
        name: "Pam Past Member",
        set: async (e) => {
          await give(gym, typeId, e);
          await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${e}`;
        },
        want: { canRemove: true },
      },
      {
        name: "Una Unpaid Stopping",
        set: async (e) => {
          const m = await give(gym, typeId, e, { paid: false });
          await sql`UPDATE gym_held_memberships SET renews = false WHERE id = ${m}`;
        },
        want: { stays: "owed" },
      },
      {
        name: "Lou Later Unpaid",
        set: async (e) => {
          const m = await give(gym, typeId, e, { paid: false, startsOn: future });
          await sql`UPDATE gym_held_memberships SET renews = false WHERE id = ${m}`;
        },
        want: { stays: "owed" },
      },
      {
        name: "Cass Cancelled Unpaid",
        set: async (e) => {
          const m = await give(gym, typeId, e, { paid: false });
          await sql`UPDATE gym_held_memberships SET status = 'cancelled', cancelled_on = starts_on WHERE id = ${m}`;
        },
        want: { stays: "owed" },
      },
      {
        name: "Pat Pays For Ended",
        set: async (e) => {
          const kid = await person(gym, "Kit Ended");
          const m = await give(gym, typeId, kid);
          await sql`UPDATE gym_held_memberships SET status = 'cancelled', cancelled_on = starts_on WHERE id = ${m}`;
          await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${kid}, ${e})`;
        },
        want: { stays: "pays_for", paysFor: { names: ["Kit Ended"], more: 0 } },
      },
      {
        name: "Max Pays For Three",
        set: async (e) => {
          for (const kid of ["Ada One", "Ben Two", "Cy Three"]) {
            const k = await person(gym, kid);
            await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${k}, ${e})`;
          }
        },
        want: { stays: "pays_for", paysFor: { names: ["Ada One", "Ben Two"], more: 1 } },
      },
      {
        name: "Rae Renews And Pays",
        set: async (e) => {
          await give(gym, typeId, e);
          const k = await person(gym, "Dot Paid For");
          await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${k}, ${e})`;
        },
        want: { stays: "pays_for", paysFor: { names: ["Dot Paid For"], more: 0 } },
      },
      {
        name: "Ola Renews And Owes",
        set: async (e) => void (await give(gym, typeId, e, { paid: false })),
        want: { stays: "renews" },
      },
    ];
    for (const c of cases) {
      const entry = await person(gym, c.name);
      await c.set(entry);
      const card = await cardFor(gym, entry, "4242");
      const who = await member(gym, entry);
      const shown = await myCard(gym, who);
      const res = await remove(gym, who, card);
      if ("canRemove" in c.want) {
        expect({ name: c.name, canRemove: shown.canRemove, stays: shown.stays, status: res.statusCode }).toEqual({ name: c.name, canRemove: true, stays: null, status: 200 });
        expect(await cardOn(gym.id, entry), c.name).toBeNull();
      } else {
        expect({ name: c.name, canRemove: shown.canRemove, stays: shown.stays, paysFor: shown.paysFor, status: res.statusCode, code: errorOf(res).error.code }).toEqual({
          name: c.name,
          canRemove: false,
          stays: c.want.stays,
          paysFor: c.want.paysFor ?? null,
          status: 409,
          code: "card_stays",
        });
        expect(await cardOn(gym.id, entry), c.name).toBe(card.cardId);
      }
    }
  });
});
