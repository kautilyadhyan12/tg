// UNLINK ON A PERSON'S PAGE (ROADMAP 18d-iii-b-ii-c-ii; spec Part 3 §14.8): a customer in the gym's Square customer list that
// Match linked to the person who paid (18d-iii-b-ii-c-i), taken back from them by staff who match payments: the box first, which
// says what will change before anything does, then the press.
//
// THE WORST THING here: Pat, a parent not on the list, paid for her son Sam, and staff linked her Square customer to Sam by
// mistake. After Unlink her payments must not land on Sam's page any more, Sam's card must not stay on her Square profile, where
// staff can charge it at the till, and nothing may link her customer to Sam again by itself. So, in one step under the gym's
// lock: the link goes; Sam's card on file saved on her customer goes and Square is told to stop it (a card cannot be moved to
// another customer in Square: staff save it again, which makes Sam a customer of his own); her payments still waiting on Sam's
// page are nobody's again, waiting in Payments to match; and it is remembered that staff unlinked them, which Members in
// Square's rule, its own link step, Match's tick and a card being saved all read. Payments already on bills stay where staff
// put them (Not this bill takes one off).
import {
  SQUARE_UNLINK_WORDS,
  squareLinksResponseSchema,
  squareUnlinkBoxSchema,
  squareUnlinkResponseSchema,
  type SquareLink,
  type SquareLinksResponse,
  type SquareUnlinkBox,
  type SquareUnlinkRequest,
  type SquareUnlinkResponse,
} from "@app/shared";
import { lockGym } from "../memberList/repo.js";
import { insertAudit } from "../repo.js";
import { OrgsError } from "../service.js";
import { readyOrThrow, sendOwedCardDisables, type Ready } from "./cards.js";
import { allowed } from "./paymentsToMatch.js";
import type * as repo from "./repo.js";
import type { PaymentsDeps } from "./service.js";
import type { SquareEnvironment } from "./square.js";
import { customerSeen } from "./squareAppPayments.js";
import { peopleHeldWith, readLinkPerson } from "./squareMatchRepo.js";
import * as unlinks from "./squareUnlinkRepo.js";

const W = SQUARE_UNLINK_WORDS;
const gone = (): OrgsError => new OrgsError(409, "square_link_gone", W.gone);
const notFound = (): OrgsError => new OrgsError(404, "entry_not_found", "That person was not found on your list.");

const shown = (l: unlinks.MatchedLinkRow): SquareLink => ({
  customerId: l.customerId,
  also: l.also,
  linkedAt: l.linkedAt.toISOString(),
  from: l.from === null ? null : { amountMinor: l.from.amountMinor, currency: l.from.currency, takenAt: l.from.takenAt.toISOString() },
});

/** The person is this gym's, and the server's Square environment, or null where Square is not set up here. */
async function personHere(deps: PaymentsDeps, gymId: string, entryId: string): Promise<SquareEnvironment | null> {
  if ((await readLinkPerson(deps.sql, gymId, entryId)) === null) throw notFound();
  return deps.square?.environment ?? null;
}

async function linksOf(deps: PaymentsDeps, gymId: string, entryId: string, environment: SquareEnvironment | null): Promise<SquareLink[]> {
  return environment === null ? [] : (await unlinks.matchedLinks(deps.sql, gymId, entryId, environment)).map(shown);
}

/** The customers Match linked to the person, for their page. */
export async function readSquareLinks(deps: PaymentsDeps, userId: string, gymId: string, entryId: string): Promise<SquareLinksResponse> {
  await allowed(deps, gymId, userId, false);
  const environment = await personHere(deps, gymId, entryId);
  return squareLinksResponseSchema.parse({ links: await linksOf(deps, gymId, entryId, environment) });
}

/** The gym's own connection, where it is to the account the link is in; null otherwise (Square is then not asked). */
async function readyFor(deps: PaymentsDeps, gymId: string, gym: repo.GymForPayments, accountId: string): Promise<Ready | null> {
  try {
    const ready = await readyOrThrow(deps, gymId, gym);
    return ready.row.accountId === accountId ? ready : null;
  } catch (err) {
    if (err instanceof OrgsError) return null;
    throw err;
  }
}

/** What Square has of the customer now: its name for the box, and what the payments going back keep so staff can tell who it
 *  is. Null where Square does not say, or answers with another customer (merged since). */
async function customerNow(
  deps: PaymentsDeps,
  gymId: string,
  ready: Ready | null,
  customerId: string,
): Promise<{ name: string | null; email: string | null; phone: string | null } | null> {
  if (ready === null) return null;
  const read = await ready.square.api.retrieveCustomer(ready.token, customerId);
  if (read.kind !== "ok") {
    deps.log.warn({ event: "square.unlink_customer_unread", gymId, status: read.status }, "Square did not show the customer being unlinked");
    return null;
  }
  if (read.value.id !== customerId) return null;
  return customerSeen(read.value);
}

/** Unlink's box, before anything changes: who the customer is in Square, what goes back to Payments to match, the card that is
 *  stopped, and whether Members in Square adds the person by itself. */
export async function readUnlinkBox(deps: PaymentsDeps, userId: string, gymId: string, entryId: string, customerId: string): Promise<SquareUnlinkBox> {
  const gym = await allowed(deps, gymId, userId, false);
  const environment = await personHere(deps, gymId, entryId);
  const link = environment === null ? undefined : (await unlinks.matchedLinks(deps.sql, gymId, entryId, environment)).find((l) => l.customerId === customerId);
  if (link === undefined) throw gone();
  const at = { gymId, entryId, environment: link.environment, accountId: link.accountId, customerId, also: link.also };
  const [facts, seen] = await Promise.all([unlinks.unlinkFacts(deps.sql, at), customerNow(deps, gymId, await readyFor(deps, gymId, gym, link.accountId), customerId)]);
  return squareUnlinkBoxSchema.parse({ customerName: seen?.name ?? null, also: link.also, ...facts });
}

/** Unlink. The same press sent twice is answered the same; a card saved since the box was read is never stopped unseen. */
export async function unlinkSquareCustomer(
  deps: PaymentsDeps,
  userId: string,
  gymId: string,
  entryId: string,
  customerId: string,
  body: SquareUnlinkRequest,
): Promise<{ answer: SquareUnlinkResponse; entryIds: string[] }> {
  const gym = await allowed(deps, gymId, userId, true);
  const environment = await personHere(deps, gymId, entryId);
  if (environment === null) throw gone();
  const key = { gymId, entryId, environment, customerId, requestKey: body.requestKey };
  const answered = async (before: { moved: number; card: { brand: string; last4: string } | null }): Promise<{ answer: SquareUnlinkResponse; entryIds: string[] }> => ({
    answer: squareUnlinkResponseSchema.parse({ unlinked: { customerName: null, moved: before.moved, card: before.card, added: false }, links: await linksOf(deps, gymId, entryId, environment) }),
    entryIds: [],
  });
  const before = await unlinks.unlinkedBefore(deps.sql, key);
  if (before !== null) return await answered(before);
  const link = (await unlinks.matchedLinks(deps.sql, gymId, entryId, environment)).find((l) => l.customerId === customerId);
  if (link === undefined) throw gone();
  // Square is asked about the customer outside every lock: the payments going back keep its name, email and phone, as a payment
  // of a customer linked to nobody does. Square not answering leaves them as "Unknown"; it never stops the press.
  const seen = await customerNow(deps, gymId, await readyFor(deps, gymId, gym, link.accountId), customerId);

  const now = deps.now();
  const done = await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const again = await unlinks.unlinkedBefore(tx, key);
    if (again !== null) return { kind: "again" as const, again };
    // A card being saved on the Terminal goes on the customer it began with: the save ends first.
    const [saving] = await tx<{ id: string }[]>`
      SELECT id FROM gym_terminal_card_saves WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND state IN ('agreeing', 'saving') LIMIT 1`;
    if (saving !== undefined) throw new OrgsError(409, "square_unlink_terminal", W.terminal);
    const step = await unlinks.unlinkInStep(tx, { gymId, entryId, environment, customerId, card: body.card, seen, userId, requestKey: body.requestKey, now });
    if (step.kind === "gone") throw gone();
    if (step.kind === "changed") throw new OrgsError(409, "square_unlink_changed", W.changed);
    if (step.kind === "busy") throw new OrgsError(409, "square_unlink_busy", W.busy);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.square_customer_unlinked",
      targetType: "member_list_entry",
      targetId: entryId,
      meta: { also: step.also ? "yes" : "no", card: step.card === null ? "no" : "yes", moved: String(step.moved) },
    });
    return { kind: "done" as const, step, told: await peopleHeldWith(tx, gymId, entryId) };
  });
  if (done.kind === "again") return await answered(done.again);
  const { step } = done;
  if (step.disableId !== null && deps.square !== null) await sendOwedCardDisables(deps, deps.square, [step.disableId]);
  const answer = squareUnlinkResponseSchema.parse({
    unlinked: { customerName: seen?.name ?? null, moved: step.moved, card: step.card, added: step.added },
    links: await linksOf(deps, gymId, entryId, environment),
  });
  return { answer, entryIds: done.told };
}
