// A GYM'S SQUARE TERMINAL (ROADMAP 18d-ii-b-i; rulings/2026-10-21-18d-ii-b.md).
//
// Square's own way, and GymMaster's: the owner presses Pair a Terminal, Square makes a code for
// the gym's Square location, the owner types it on the Terminal's sign-in screen within five
// minutes, and the console asks every few seconds whether a Terminal signed in with it; Square
// then names that Terminal ("Connect a Square Terminal to a POS Application", read 2026-10-21).
//
// THE WORST THING here is a Terminal used for the wrong Square account or gym: a gym handed
// over, or connected to another account since, still offered the old account's Terminal, or one
// gym's Terminal shown or removed by another. So every row is read with its gym and environment,
// only rows of the account the gym is connected to NOW are shown, and a Terminal is paired only
// into the account whose token made its code, while the gym is still connected to it. Two gyms
// holding one Square account (a chain) never both list a Terminal: it stands at one desk, so the
// gym it last signed in for has it, and the other's Staff activity says where it went. Only the
// gym's own owner pairs and removes, as only the owner connects Square. The code is shown once
// and never kept.
//
// Square's sandbox makes and reads codes but no real Terminal can sign in there; a tester adds one
// of its simulated Terminals with `tools/square-simulated-terminal.ts`, never from a screen.
import { randomUUID } from "node:crypto";
import {
  GYM_PAYMENTS_WORDS,
  MEMBER_CARD_WORDS,
  SQUARE_PAIRING_MINUTES,
  SQUARE_TERMINALS_MAX,
  gymPaymentsResponseSchema,
  squarePairResponseSchema,
  squarePairingCheckResponseSchema,
  type GymPaymentsResponse,
  type SquarePairResponse,
  type SquarePairingCheckResponse,
  type SquarePracticeTerminal,
} from "@app/shared";
import type { TransactionSql } from "postgres";
import { insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requireWritableGym } from "../service.js";
import * as repo from "./repo.js";
import { accessContext, missingScopes, readPayments, requireGymOwner, squareOrThrow, terminalsOffered, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import * as terminals from "./terminalsRepo.js";

/** Square's simulated Terminals ("Sandbox testing", Terminal actions, read 2026-10-21). */
export const SQUARE_PRACTICE_DEVICES: Record<SquarePracticeTerminal, string> = {
  saves: "jg260ny-11t2-4xy2-kg21-tl949bp350ca",
  declines: "fgw34tg-qwe1-fod2-e03e-e0fk0qiabcfk",
  cancels: "aafea9fa-350c-4ab2-b033-b2fbb672e712",
  times_out: "e371fb66-29a2-45a6-a928-f8de0e864242",
  offline: "7647344e-aea2-4cff-ac53-513644de434d",
};

/** Square's code read again this long after its time: a Terminal that signed in at the last
 *  second is still found. */
export const PAIRING_GRACE_MS = 60_000;

const ownerOnly = GYM_PAYMENTS_WORDS.terminal_owner_only;
const notConnected = (): OrgsError => new OrgsError(409, "square_not_connected", GYM_PAYMENTS_WORDS.not_connected);
const unavailable = (): OrgsError => new OrgsError(503, "square_unavailable", GYM_PAYMENTS_WORDS.square_unavailable);
const connectionRefused = (): OrgsError => new OrgsError(409, "card_connection_refused", MEMBER_CARD_WORDS.connection_refused);
const needsAllow = (): OrgsError => new OrgsError(409, "terminals_need_allow", GYM_PAYMENTS_WORDS.terminals_need_allow);
const pairingGone = (): OrgsError => new OrgsError(404, "pairing_gone", GYM_PAYMENTS_WORDS.pairing_gone);
const full = (): OrgsError => new OrgsError(409, "terminals_full", GYM_PAYMENTS_WORDS.terminals_full);

/** In each gym that listed the Terminal until it signed in here: where it went. The person is
 *  named there only when they are on that gym's staff (one owner of both, as in most chains);
 *  otherwise the line names nobody, and Staff activity, which shows what a gym's own people did,
 *  leaves it out rather than show another business's person. */
async function auditMoves(tx: TransactionSql, userId: string, toName: string, movedFrom: readonly terminals.MovedFrom[], deviceId: string): Promise<void> {
  for (const from of movedFrom) {
    await insertAudit(tx, {
      actorUserId: (await terminals.isStaffOf(tx, from.gymId, userId)) ? userId : null,
      gymId: from.gymId,
      action: "org.payments_square_terminal_moved",
      targetType: "gym",
      targetId: from.gymId,
      meta: from.practice === null ? { serial: deviceId, to: toName } : { practice: from.practice, to: toName },
    });
  }
}

interface Ready {
  square: SquareSettings;
  row: repo.ConnectionRow & { locationId: string };
  token: string;
}

/** Connected, with a location, where Square saves cards on a Terminal, allowing the Terminal's
 *  permissions: or 409. */
async function readyOrThrow(deps: PaymentsDeps, gymId: string): Promise<Ready> {
  const square = squareOrThrow(deps);
  const row = await repo.readConnection(deps.sql, gymId, square.environment);
  if (row?.state !== "connected") throw notConnected();
  if (!terminalsOffered(row)) throw new OrgsError(409, "terminals_not_offered", GYM_PAYMENTS_WORDS.terminals_not_offered);
  if (missingScopes(row)) throw needsAllow();
  const token = row.accessToken === null ? null : square.tokens.open(row.accessToken, accessContext(gymId));
  if (token === null) {
    deps.log.error({ event: "square.token_unreadable", gymId }, "a gym's Square token could not be opened");
    throw connectionRefused();
  }
  return { square, row, token };
}

/** Under the gym's lock: still connected to the account the step began with. */
async function stillConnected(tx: TransactionSql, square: SquareSettings, gymId: string, accountId: string): Promise<void> {
  await lockOrgRow(tx, gymId);
  const now = await repo.readConnection(tx, gymId, square.environment, true);
  if (now?.state !== "connected" || now.accountId !== accountId) throw notConnected();
}

const paymentsOf = async (deps: PaymentsDeps, userId: string, gymId: string) => (await readPayments(deps, userId, gymId)).payments;

/** Pair a Terminal: Square's code for the gym's location, shown once. */
export async function pairTerminal(deps: PaymentsDeps, userId: string, gymId: string): Promise<SquarePairResponse> {
  const { org, gym } = await requireGymOwner(deps, gymId, userId, ownerOnly);
  await requireWritableGym(deps, org);
  const { square, row, token } = await readyOrThrow(deps, gymId);
  // Counted again when a Terminal signs in, under the locks (finishPairing); this spares Square a
  // code that could pair nothing.
  if ((await terminals.countPaired(deps.sql, gymId, square.environment, row.accountId)) >= SQUARE_TERMINALS_MAX) throw full();
  // The name the gym's Square Dashboard lists the code under: the gym's own.
  const made = await square.api.createDeviceCode(token, { idempotencyKey: randomUUID(), name: gym.name.slice(0, 128), locationId: row.locationId });
  if (made.kind === "unavailable") throw unavailable();
  if (made.kind === "refused") {
    if (made.status === 401) throw connectionRefused();
    if (made.status === 403) throw needsAllow();
    deps.log.error({ event: "square.device_code_refused", gymId, status: made.status, code: made.code }, "Square refused to make a Terminal code");
    throw new OrgsError(409, "pairing_refused", GYM_PAYMENTS_WORDS.pairing_refused);
  }
  const code = made.value.code;
  if (code === undefined || code === "") throw new OrgsError(409, "pairing_refused", GYM_PAYMENTS_WORDS.pairing_refused);
  const now = deps.now();
  // Square's own time, held to what its page promises.
  const said = made.value.pair_by === undefined ? Number.NaN : Date.parse(made.value.pair_by);
  const latest = now.getTime() + SQUARE_PAIRING_MINUTES * 60_000;
  const pairBy = new Date(Number.isNaN(said) || said <= now.getTime() || said > latest + PAIRING_GRACE_MS ? latest : said);
  await deps.sql.begin(async (tx) => {
    await stillConnected(tx, square, gymId, row.accountId);
    await terminals.startPairing(tx, { gymId, environment: square.environment, accountId: row.accountId, deviceCodeId: made.value.id, pairBy, createdBy: userId });
  });
  return squarePairResponseSchema.parse({ code, pairBy: pairBy.toISOString(), payments: await paymentsOf(deps, userId, gymId) });
}

/** Whether a Terminal signed in with the code: paired, still waiting, or the code ran out. */
export async function checkPairing(deps: PaymentsDeps, userId: string, gymId: string, pairingId: string): Promise<SquarePairingCheckResponse> {
  const { gym } = await requireGymOwner(deps, gymId, userId, ownerOnly);
  const square = squareOrThrow(deps);
  const answer = async (outcome: SquarePairingCheckResponse["outcome"]) =>
    squarePairingCheckResponseSchema.parse({ outcome, payments: await paymentsOf(deps, userId, gymId) });
  const waiting = await terminals.readTerminal(deps.sql, gymId, square.environment, pairingId);
  if (waiting === null) throw pairingGone();
  if (waiting.state === "paired") return await answer("paired");
  const { row, token } = await readyOrThrow(deps, gymId);
  // A code made for an account the gym is no longer connected to pairs nothing here.
  if (waiting.accountId !== row.accountId || waiting.deviceCodeId === null || waiting.pairBy === null) {
    await terminals.dropPairing(deps.sql, gymId, square.environment, waiting.id);
    throw pairingGone();
  }
  const read = await square.api.retrieveDeviceCode(token, waiting.deviceCodeId);
  const now = deps.now();
  if (read.kind === "ok" && read.value.id === waiting.deviceCodeId && read.value.status === "PAIRED" && read.value.device_id !== undefined) {
    const deviceId = read.value.device_id;
    const paired = await deps.sql.begin(async (tx) => {
      await stillConnected(tx, square, gymId, waiting.accountId);
      const locked = await terminals.readTerminal(tx, gymId, square.environment, waiting.id, true);
      if (locked === null) return "gone" as const;
      if (locked.state === "paired") return "paired" as const;
      const finished = await terminals.finishPairing(tx, gymId, square.environment, locked, deviceId, now);
      if (finished.outcome === "full") return "full" as const;
      if (finished.outcome === "paired") {
        await insertAudit(tx, {
          actorUserId: userId,
          gymId,
          action: "org.payments_square_terminal_paired",
          targetType: "gym",
          targetId: gymId,
          meta: { serial: deviceId },
        });
        await auditMoves(tx, userId, gym.name, finished.movedFrom, deviceId);
      }
      return "paired" as const;
    });
    if (paired === "gone") throw pairingGone();
    if (paired === "full") throw full();
    return await answer("paired");
  }
  if (read.kind === "refused" && read.status === 401) throw connectionRefused();
  if (read.kind === "refused" && read.status === 403) throw needsAllow();
  // Run out: Square says EXPIRED (measured in its sandbox), no longer returns the code (its page
  // says so; a 404 asks only for a new code), or it is still unpaired past its time. With no clear
  // answer it waits: a Terminal may have signed in.
  const ranOut =
    (read.kind === "ok" && read.value.status === "EXPIRED") ||
    (read.kind === "refused" && read.status === 404) ||
    (read.kind === "ok" && now.getTime() > waiting.pairBy.getTime() + PAIRING_GRACE_MS);
  if (ranOut) {
    await terminals.dropPairing(deps.sql, gymId, square.environment, waiting.id);
    return await answer("expired");
  }
  if (read.kind === "refused") {
    deps.log.error({ event: "square.device_code_read_refused", gymId, status: read.status, code: read.code }, "Square refused to read a Terminal code");
    throw new OrgsError(409, "pairing_refused", GYM_PAYMENTS_WORDS.pairing_refused);
  }
  return await answer("waiting");
}

/** Square's sandbox only: one of its simulated Terminals on a test gym, in place of a real one
 *  signing in, for `tools/square-simulated-terminal.ts`. The gym is as Pair a Terminal needs it:
 *  connected, with its location, where Square saves cards on a Terminal, allowing the Terminal.
 *  Once a gym and account: false when it has it already. */
export async function addSimulatedTerminal(deps: PaymentsDeps, gymId: string, practice: SquarePracticeTerminal): Promise<boolean> {
  if (squareOrThrow(deps).environment !== "sandbox") throw new Error("simulated Terminals are for Square's sandbox only");
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  const { square, row } = await readyOrThrow(deps, gymId);
  const deviceId = SQUARE_PRACTICE_DEVICES[practice];
  const added = await deps.sql.begin(async (tx) => {
    await stillConnected(tx, square, gymId, row.accountId);
    const done = await terminals.addPractice(tx, { gymId, accountId: row.accountId, practice, deviceId, createdBy: gym.ownerUserId, now: deps.now() });
    if (done.outcome === "paired") await auditMoves(tx, gym.ownerUserId, gym.name, done.movedFrom, deviceId);
    return done.outcome;
  });
  if (added === "full") throw full();
  return added === "paired";
}

/** Remove a Terminal, or a code still waiting, whatever the gym's plan: a gym may always stop
 *  using one. The Terminal stays signed in to the gym's Square account. Pressed twice, removed
 *  once. */
export async function removeTerminal(deps: PaymentsDeps, userId: string, gymId: string, terminalId: string): Promise<GymPaymentsResponse> {
  await requireGymOwner(deps, gymId, userId, ownerOnly);
  const square = squareOrThrow(deps);
  await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const gone = await terminals.deleteTerminal(tx, gymId, square.environment, terminalId);
    if (gone?.state !== "paired") return;
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.payments_square_terminal_removed",
      targetType: "gym",
      targetId: gymId,
      meta: gone.practice === null ? { serial: gone.deviceId ?? "" } : { practice: gone.practice },
    });
  });
  return gymPaymentsResponseSchema.parse({ payments: await paymentsOf(deps, userId, gymId) });
}
