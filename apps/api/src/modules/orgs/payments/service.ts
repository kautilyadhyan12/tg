// A gym connects its own Square account (ROADMAP 18d-i; spec Part 3 §14.5).
//
// Only the gym's own owner connects, picks the location and disconnects (Kd, 2026-10-19):
// whoever connects decides whose bank account members' card money goes into, so it is on no
// tick a manager can be given, and a co-owner does not do it either. Every member of staff
// reads the box.
//
// The worst thing here is one gym's members paying into somebody else's Square account. So a
// press of Connect Square is a one-time value, kept as its SHA-256, for one owner at one gym
// for ten minutes; Square's answer is taken only with it, by that same person, once, and the
// gym comes from the press, never from the request. The owner is checked again when the
// answer comes back.
//
// Tokens a connection does not keep (Disconnect, a Square account refused, a second Allow)
// are written as owed revokes in the same step that lets them go, and sent to Square at once
// and by the worker until Square says so.
//
// A gym connected before a permission was added (18d-ii-b-i: the Square Terminal's) connects
// again, on the account already connected and no other: its members' cards are saved there.
// The new tokens replace the old on that connection, and the old token is let go.
import { createHash, randomBytes } from "node:crypto";
import {
  GYM_PAYMENTS_WORDS,
  SQUARE_CONNECT_MINUTES,
  SQUARE_TERMINAL_COUNTRIES,
  gymPaymentsAvailability,
  gymPaymentsResponseSchema,
  memberCurrencyForCountry,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type GymPaymentsResponse,
  type SquareConnectResponse,
  type SquareConnection,
  type SquareFinishRequest,
  type SquareFinishResponse,
  type SquareRefusal,
  type SquareTerminals,
  TERMINAL_PAYMENT_WORDS,
  CARD_CHARGE_WORDS,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requireStaff, requireWritableGym } from "../service.js";
import * as repo from "./repo.js";
import type { SquareSettings } from "./settings.js";
import { SQUARE_SCOPES } from "./square.js";
import { anyWaitingIn } from "./terminalPaymentsRepo.js";
import { anyChargingIn } from "./cardChargesRepo.js";
import * as terminalsRepo from "./terminalsRepo.js";
import type { TokenContext } from "./tokenBox.js";

export interface PaymentsLog {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface PaymentsDeps {
  sql: Sql;
  /** Null when Square is not set up on this server. */
  square: SquareSettings | null;
  log: PaymentsLog;
  now: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Square asks for a renewal every 7 days or less ("Refresh, Revoke, and Limit the Scope of
 *  OAuth Tokens", read 2026-10-19); six leaves a day to try again. */
export const SQUARE_REFRESH_EVERY_MS = 6 * DAY_MS;
/** A revoke Square did not answer is tried again on the worker's next minute. */
export const REVOKE_RETRY_MS = 60_000;

export const accessContext = (gymId: string): TokenContext => ({ gymId, provider: "square", kind: "access" });
export const refreshContext = (gymId: string): TokenContext => ({ gymId, provider: "square", kind: "refresh" });

export function hashConnectState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function squareOrThrow(deps: PaymentsDeps): SquareSettings {
  if (deps.square === null) throw new OrgsError(503, "square_not_ready", GYM_PAYMENTS_WORDS.not_ready);
  return deps.square;
}

/** The gym's own owner, or 404 for anybody not on its staff and 403 for staff. */
export async function requireGymOwner(deps: PaymentsDeps, gymId: string, userId: string, words: string = GYM_PAYMENTS_WORDS.owner_only) {
  const { org } = await requireStaff(deps, gymId, userId);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  if (gym.ownerUserId !== userId) throw new OrgsError(403, "owner_only", words);
  return { org, gym };
}

/** What Square Terminals and the card on file need: every permission asked for before 18d-iii-b-i. */
const TERMINAL_SCOPES: readonly string[] = SQUARE_SCOPES.filter((scope) => scope !== "ORDERS_READ");

/** The connection allows less than Square Terminals need: the owner connects Square again. */
export const missingScopes = (row: repo.ConnectionRow): boolean => TERMINAL_SCOPES.some((scope) => !row.scopes.includes(scope));

/** The connection allows less than anything we now ask Square for: Connect Square is offered again. */
export const allowsLess = (row: repo.ConnectionRow): boolean => SQUARE_SCOPES.some((scope) => !row.scopes.includes(scope));

/** What was sold with a payment taken in Square's own app can be read (18d-iii-b-i). */
export const readsOrders = (row: repo.ConnectionRow): boolean => row.scopes.includes("ORDERS_READ");

/** Connected, with its location, where Square saves cards on a Terminal. */
export const terminalsOffered = (row: repo.ConnectionRow | null): row is repo.ConnectionRow & { locationId: string } =>
  row?.state === "connected" && row.locationId !== null && SQUARE_TERMINAL_COUNTRIES.includes(row.country);

/** The connected box's Terminals: those paired in the Square account the gym is connected to
 *  now, never another's; the code waiting, for the owner alone. */
async function terminalsView(deps: PaymentsDeps, square: SquareSettings, row: repo.ConnectionRow | null, isOwner: boolean): Promise<SquareTerminals | null> {
  if (!terminalsOffered(row)) return null;
  const rows = await terminalsRepo.readTerminals(deps.sql, row.gymId, square.environment, row.accountId);
  const pairing = isOwner ? rows.find((t) => t.state === "pairing") : undefined;
  return {
    needsAllow: missingScopes(row),
    list: rows.flatMap((t) =>
      t.state === "paired" && t.pairedAt !== null
        ? [{ id: t.id, serial: t.practice === null ? t.deviceId : null, practice: t.practice, pairedAt: t.pairedAt.toISOString() }]
        : [],
    ),
    pairing: pairing?.pairBy == null ? null : { id: pairing.id, pairBy: pairing.pairBy.toISOString() },
  };
}

function connectionView(row: repo.ConnectionRow | null, isOwner: boolean): SquareConnection | null {
  if (row === null) return null;
  const choosing = row.state === "connected" && row.locationId === null;
  return {
    state: row.state === "removed" ? "removed" : choosing ? "choose_location" : "connected",
    businessName: row.businessName,
    locationName: row.locationName,
    locations: choosing && isOwner ? (row.locationChoices ?? []) : [],
    connectedAt: row.connectedAt.toISOString(),
    removedAt: row.removedAt?.toISOString() ?? null,
  };
}

/** The Payments box, for anybody on the gym's staff. */
export async function readPayments(deps: PaymentsDeps, userId: string, gymId: string): Promise<GymPaymentsResponse> {
  await requireStaff(deps, gymId, userId);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  const isOwner = gym.ownerUserId === userId;
  const row = deps.square === null ? null : await repo.readConnection(deps.sql, gymId, deps.square.environment);
  return gymPaymentsResponseSchema.parse({
    payments: {
      availability: gymPaymentsAvailability(gym.country),
      country: gym.country,
      canConnect: isOwner,
      squareReady: deps.square !== null,
      square: connectionView(row, isOwner),
      terminals: deps.square === null ? null : await terminalsView(deps, deps.square, row, isOwner),
      squareApp: row?.state === "connected" && row.locationId !== null ? { needsAllow: !readsOrders(row) } : null,
    },
  });
}

/** Connect Square: a one-time press, and the address of Square's own page. */
export async function startSquareConnect(deps: PaymentsDeps, userId: string, gymId: string): Promise<SquareConnectResponse> {
  const { org, gym } = await requireGymOwner(deps, gymId, userId);
  await requireWritableGym(deps, org);
  const square = squareOrThrow(deps);
  if (gymPaymentsAvailability(gym.country) !== "square") throw new OrgsError(409, "square_not_offered", GYM_PAYMENTS_WORDS.not_offered);
  const existing = await repo.readConnection(deps.sql, gymId, square.environment);
  // Connected and allowing everything asked for: nothing to connect again for.
  if (existing?.state === "connected" && !allowsLess(existing)) throw new OrgsError(409, "square_already_connected", GYM_PAYMENTS_WORDS.already_connected);
  const state = randomBytes(32).toString("base64url");
  await repo.insertStart(deps.sql, {
    stateHash: hashConnectState(state),
    gymId,
    userId,
    environment: square.environment,
    expiresAt: new Date(deps.now().getTime() + SQUARE_CONNECT_MINUTES * 60_000),
  });
  return squareConnectResponseSchema.parse({ url: square.api.authorizeUrl(state) });
}

/** Write a token Square is to be told to stop, in the transaction that lets it go. The whole
 *  account's access is ended only when no gym here still holds that account. */
async function owe(
  tx: TransactionSql,
  square: SquareSettings,
  gymId: string,
  accountId: string,
  lockedAccess: string,
  now: Date,
): Promise<string> {
  await repo.lockAccount(tx, square.environment, accountId);
  const holders = await repo.holders(tx, square.environment, accountId);
  return await repo.insertRevoke(tx, {
    gymId,
    environment: square.environment,
    accountId,
    accessToken: lockedAccess,
    wholeAccount: holders === 0,
    notBefore: now,
  });
}

/** About a day of tries, doubling from a minute. */
export const REVOKE_MAX_TRIES = 12;

/** Send these owed revokes now; whatever Square does not answer, the worker sends later. */
export async function sendOwedRevokes(
  deps: PaymentsDeps,
  square: SquareSettings,
  ids: readonly string[] | null,
  limit = 50,
  gymIds: readonly string[] | null = null,
): Promise<{ sent: number; deferred: number; givenUp: number }> {
  const run = { sent: 0, deferred: 0, givenUp: 0 };
  const now = deps.now();
  const owed = await repo.claimDueRevokes(deps.sql, square.environment, now, 5 * 60_000, limit, ids, gymIds);
  for (const revoke of owed) {
    const token = square.tokens.open(revoke.accessToken, accessContext(revoke.gymId));
    if (token === null) {
      // Locked under a key this server no longer has: nothing can be sent with it.
      await repo.finishRevoke(deps.sql, revoke.id);
      deps.log.error({ event: "square.revoke_unreadable", revokeId: revoke.id }, "an owed Square revoke could not be opened");
      run.givenUp += 1;
      continue;
    }
    // From the count to Square's answer under the account's lock: a gym connecting this account
    // meanwhile waits for it, so the whole account is stopped only while no gym here holds it,
    // however long ago the stop was owed. The lock is held over one call of at most
    // SQUARE_TIMEOUT_MS; a connection's own write takes the same lock.
    const result = await deps.sql.begin(async (tx) => {
      await repo.lockAccount(tx, square.environment, revoke.accountId);
      const whole = revoke.wholeAccount && (await repo.holders(tx, square.environment, revoke.accountId)) === 0;
      return await square.api.revoke(token, whole);
    });
    // Done when Square stopped it, or says the token is already dead. Square's own refusal of
    // US (a wrong secret answers 401 `service.not_authorized`, measured 2026-10-20) is not.
    if (result.kind === "ok" || (result.kind === "refused" && result.status === 401 && result.code === "UNAUTHORIZED")) {
      await repo.finishRevoke(deps.sql, revoke.id);
      run.sent += 1;
      continue;
    }
    if (result.kind === "refused") {
      deps.log.error({ event: "square.revoke_refused", revokeId: revoke.id, status: result.status, code: result.code }, "Square refused a revoke");
    }
    if (revoke.tries + 1 >= REVOKE_MAX_TRIES) {
      await repo.finishRevoke(deps.sql, revoke.id);
      deps.log.error({ event: "square.revoke_given_up", revokeId: revoke.id }, "Square did not stop a token; given up");
      run.givenUp += 1;
      continue;
    }
    await repo.deferRevoke(deps.sql, revoke.id, new Date(now.getTime() + REVOKE_RETRY_MS * 2 ** Math.min(revoke.tries, 6)));
    run.deferred += 1;
  }
  return run;
}

const USABLE_LOCATION_STATUS = "ACTIVE";
const CARD_CAPABILITY = "CREDIT_CARD_PROCESSING";

/** Square's answer, brought back by the return page. */
export async function finishSquareConnect(deps: PaymentsDeps, userId: string, body: SquareFinishRequest): Promise<SquareFinishResponse> {
  const square = squareOrThrow(deps);
  const gymId = await repo.takeStart(deps.sql, hashConnectState(body.state), userId, square.environment, deps.now());
  if (gymId === null) throw new OrgsError(404, "square_connect_expired", GYM_PAYMENTS_WORDS.connect_expired);
  // Still this gym's owner, and the gym still open to changes, ten minutes on.
  const { org, gym } = await requireGymOwner(deps, gymId, userId);
  await requireWritableGym(deps, org);
  if (gymPaymentsAvailability(gym.country) !== "square") throw new OrgsError(409, "square_not_offered", GYM_PAYMENTS_WORDS.not_offered);

  const answer = (outcome: SquareFinishResponse["outcome"], refusal: SquareFinishResponse["refusal"] = null): SquareFinishResponse =>
    squareFinishResponseSchema.parse({ gymSlug: gym.slug, outcome, refusal });
  const refused = (reason: SquareRefusal, squareCountry: string | null = null, squareCurrency: string | null = null) =>
    answer("refused", { reason, squareCountry, squareCurrency });

  if ("error" in body) return answer("cancelled");

  const token = await square.api.exchangeCode(body.code);
  if (token.kind === "refused") {
    deps.log.warn({ event: "square.code_refused", status: token.status, code: token.code }, "Square refused a sign-in code");
    return refused("square_said_no");
  }
  if (token.kind === "unavailable") return refused("square_unavailable");
  const accountId = token.value.merchant_id;
  const lockedAccess = square.tokens.lock(token.value.access_token, accessContext(gymId));
  const lockedRefresh = square.tokens.lock(token.value.refresh_token, refreshContext(gymId));

  // From here the tokens are ours to let go if the gym does not end up connected with them.
  const letGo = async (reason: SquareRefusal, squareCountry: string | null = null, squareCurrency: string | null = null) => {
    const id = await deps.sql.begin((tx) => owe(tx, square, gymId, accountId, lockedAccess, deps.now()));
    await sendOwedRevokes(deps, square, [id]);
    return refused(reason, squareCountry, squareCurrency);
  };

  const merchant = await square.api.merchant(token.value.access_token);
  if (merchant.kind !== "ok") return await letGo(merchant.kind === "unavailable" ? "square_unavailable" : "square_said_no");
  if (merchant.value.id !== accountId) return await letGo("square_said_no");
  const country = gym.country ?? "";
  if (merchant.value.country !== country) return await letGo("wrong_country", merchant.value.country, merchant.value.currency);
  if (merchant.value.currency !== memberCurrencyForCountry(country)) return await letGo("wrong_currency", merchant.value.country, merchant.value.currency);

  const locations = await square.api.locations(token.value.access_token);
  if (locations.kind !== "ok") return await letGo(locations.kind === "unavailable" ? "square_unavailable" : "square_said_no");
  const usable = locations.value
    .filter((l) => l.status === USABLE_LOCATION_STATUS && (l.capabilities ?? []).includes(CARD_CAPABILITY) && (l.currency ?? merchant.value.currency) === merchant.value.currency)
    .map((l) => ({ id: l.id, name: l.name ?? "Unnamed location" }));
  if (usable.length === 0) return await letGo("no_card_location");
  const only = usable.length === 1 ? (usable[0] ?? null) : null;

  const now = deps.now();
  const result = await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    // The country again, under the gym's lock: one changed while Square was being asked is
    // seen here, as a country change waits for this lock (`orgs/repo.ts` updateOrg).
    const current = await repo.readGym(tx, gymId);
    if (current?.country !== merchant.value.country || memberCurrencyForCountry(current.country) !== merchant.value.currency) {
      return { outcome: "refused" as const, revokeId: await owe(tx, square, gymId, accountId, lockedAccess, now) };
    }
    // The owner again: a gym handed over while Square was being asked is not connected to the
    // old owner's account after the hand-over let it go (4b-v).
    if (current.ownerUserId !== userId) {
      return { outcome: "not_owner" as const, revokeId: await owe(tx, square, gymId, accountId, lockedAccess, now) };
    }
    const existing = await repo.readConnection(tx, gymId, square.environment, true);
    if (existing?.state === "connected" && allowsLess(existing) && existing.accessToken !== null) {
      // Connect Square again, to allow what the connection did not: only on the account it is
      // connected to, where its members' cards are saved. The old token is let go; the gym
      // still holds the account, so only that token.
      if (existing.accountId !== accountId) {
        return { outcome: "other_account" as const, revokeId: await owe(tx, square, gymId, accountId, lockedAccess, now) };
      }
      await repo.lockAccount(tx, square.environment, accountId);
      const allowed = await repo.allowAgain(tx, {
        gymId,
        environment: square.environment,
        accountId,
        wasConnectedAt: existing.connectedAt,
        accessToken: lockedAccess,
        refreshToken: lockedRefresh,
        accessExpiresAt: new Date(token.value.expires_at),
        refreshDueAt: new Date(now.getTime() + SQUARE_REFRESH_EVERY_MS),
        connectedBy: userId,
        connectedAt: now,
        scopes: SQUARE_SCOPES,
      });
      if (!allowed) return { outcome: "already_connected" as const, revokeId: await owe(tx, square, gymId, accountId, lockedAccess, now) };
      await insertAudit(tx, {
        actorUserId: userId,
        gymId,
        action: "org.payments_square_connected_again",
        targetType: "gym",
        targetId: gymId,
        meta: { business: merchant.value.business_name ?? "" },
      });
      return { outcome: "connected_again" as const, revokeId: await owe(tx, square, gymId, accountId, existing.accessToken, now) };
    }
    if (existing?.state === "connected") {
      // Two Allows for one gym: the first stays, and this one's token is let go.
      return { outcome: "already_connected" as const, revokeId: await owe(tx, square, gymId, accountId, lockedAccess, now) };
    }
    await repo.lockAccount(tx, square.environment, accountId);
    // A stop of this whole account still owed (a Disconnect while Square was down) now ends
    // only its own token: this gym holds the account again. A stop Square was already sent
    // before this write may have ended the token just issued; Square's own message then says
    // so, and the worker marks the gym taken off once Square's token check agrees.
    await repo.keepAccountWhole(tx, square.environment, accountId);
    await repo.writeConnection(tx, {
      gymId,
      environment: square.environment,
      accountId,
      businessName: merchant.value.business_name ?? "",
      country: merchant.value.country,
      currency: merchant.value.currency,
      location: only,
      locationChoices: only === null ? usable : null,
      accessToken: lockedAccess,
      refreshToken: lockedRefresh,
      accessExpiresAt: new Date(token.value.expires_at),
      refreshDueAt: new Date(now.getTime() + SQUARE_REFRESH_EVERY_MS),
      connectedBy: userId,
      connectedAt: now,
      scopes: SQUARE_SCOPES,
    });
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.payments_square_connected",
      targetType: "gym",
      targetId: gymId,
      meta: { business: merchant.value.business_name ?? "", location: only?.name ?? "" },
    });
    return { outcome: only === null ? ("choose_location" as const) : ("connected" as const), revokeId: null };
  });
  if (result.revokeId !== null) await sendOwedRevokes(deps, square, [result.revokeId]);
  if (result.outcome === "refused") return refused("wrong_country", merchant.value.country, merchant.value.currency);
  if (result.outcome === "not_owner") throw new OrgsError(403, "owner_only", GYM_PAYMENTS_WORDS.owner_only);
  if (result.outcome === "other_account") return refused("other_account");
  return answer(result.outcome);
}

/** The owner says which of the Square account's locations this gym is. */
export async function chooseSquareLocation(deps: PaymentsDeps, userId: string, gymId: string, locationId: string): Promise<GymPaymentsResponse> {
  const { org } = await requireGymOwner(deps, gymId, userId);
  await requireWritableGym(deps, org);
  const square = squareOrThrow(deps);
  await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const row = await repo.readConnection(tx, gymId, square.environment, true);
    if (row?.state !== "connected" || row.locationId !== null) throw new OrgsError(409, "square_not_connected", GYM_PAYMENTS_WORDS.not_connected);
    const choice = (row.locationChoices ?? []).find((c) => c.id === locationId);
    if (choice === undefined) throw new OrgsError(409, "square_no_such_location", GYM_PAYMENTS_WORDS.no_such_location);
    if (!(await repo.setLocation(tx, gymId, square.environment, choice))) throw new OrgsError(409, "square_not_connected", GYM_PAYMENTS_WORDS.not_connected);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.payments_square_location_set",
      targetType: "gym",
      targetId: gymId,
      meta: { location: choice.name },
    });
  });
  return await readPayments(deps, userId, gymId);
}

/** Disconnect Square, whatever the gym's plan: a gym may always take its account back. The
 *  same press twice changes nothing the second time. */
export async function disconnectSquare(deps: PaymentsDeps, userId: string, gymId: string): Promise<GymPaymentsResponse> {
  await requireGymOwner(deps, gymId, userId);
  const square = squareOrThrow(deps);
  const now = deps.now();
  const revokeId = await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const row = await repo.readConnection(tx, gymId, square.environment, true);
    if (row === null) return null;
    // The amount would stay on the Terminal with nothing here to record it (review round one, Low 2).
    if (await anyWaitingIn(tx, gymId, square.environment)) throw new OrgsError(409, "terminal_payment_waiting", TERMINAL_PAYMENT_WORDS.disconnect_waiting);
    if (await anyChargingIn(tx, gymId, square.environment)) throw new OrgsError(409, "card_charge_waiting", CARD_CHARGE_WORDS.disconnect_charging);
    await repo.deleteConnection(tx, gymId, square.environment);
    if (row.state !== "connected" || row.accessToken === null) return null;
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.payments_square_disconnected",
      targetType: "gym",
      targetId: gymId,
      meta: { business: row.businessName },
    });
    return await owe(tx, square, gymId, row.accountId, row.accessToken, now);
  });
  if (revokeId !== null) await sendOwedRevokes(deps, square, [revokeId]);
  return await readPayments(deps, userId, gymId);
}
