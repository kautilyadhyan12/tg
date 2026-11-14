// ASK MEMBERS TO ADD THEIR CARD (ROADMAP 18d-vii; spec Part 3 §14.3). Saved cards do not move from
// a gym's old software, so staff tick members and the box names who will be asked to add their card
// in the app and who won't, with the reason. `cardRequestPlan` is the ONE rule of who is asked: a
// current member, nobody else paying for them, no card on file in the gym's Square account, paying
// for a membership that renews by itself, with one live app account of their own, and not asked in
// the last 7 days. Each is sent one message in their inbox, which the phone also shows as a
// notification; it is a payment notice, so it cannot be switched off.
//
// Gates in CLAUDE.md §4's order: privilege (both "Keep the member list and invite" and "Record
// members' payments", and a live plan for the press), then the gym taking cards in the app, then
// the rate limit, then the handler.
import {
  authEmailSchema,
  CARD_REQUEST_AGAIN_DAYS,
  CARD_REQUEST_BOX_NAMES_MAX,
  CARD_REQUEST_MESSAGE_KIND,
  CARD_REQUEST_WORDS,
  GYM_MESSAGE_KEPT_DAYS,
  cardRequestMessage,
  type CardRequestDone,
  type CardRequestKeptReason,
  type CardRequestPerson,
  type CardRequestPreview,
  type CardRequestPreviewRequest,
  type CardRequestSendRequest,
} from "@app/shared";
import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { lockGym } from "../memberList/repo.js";
import { selectedIds } from "../memberList/selection.js";
import type { MemberListDeps } from "../memberList/service.js";
import { emailHmac } from "../invites/address.js";
import { gymNow, insertMessages } from "../messages/repo.js";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as requests from "./cardRequestsRepo.js";
import type { SquareEnvironment } from "./square.js";

export type CardRequestDeps = MemberListDeps & { cardsEnvironment: SquareEnvironment | null };

const BILLING = "billing.members";
const NO_BILLING = "Recording payments isn't part of your role. Ask the owner to turn on \"Record members' payments\" for you.";
const DAY_MS = 86_400_000;

/** Who is asked, each with the one account the message goes to, and who is not, with why. */
export interface CardRequestPlan {
  ask: (CardRequestPerson & { userId: string; body: { own: string[]; others: boolean }; email: string | null })[];
  kept: { reason: CardRequestKeptReason; people: CardRequestPerson[]; count: number }[];
}

/** THE RULE OF WHO IS ASKED. `rows` are the selected records still on this gym's list; `selected`
 *  is how many were selected; a record asked at or after `againSince` is not asked again. The first
 *  four reasons are the Members list's "No card on file" (`needsCardIds`), in the same terms. */
export function cardRequestPlan(rows: readonly requests.RequestStateRow[], selected: number, againSince: Date): CardRequestPlan {
  const ask: CardRequestPlan["ask"] = [];
  const groups = new Map<CardRequestKeptReason, CardRequestPerson[]>();
  const keep = (reason: CardRequestKeptReason, person: CardRequestPerson): void => {
    groups.set(reason, [...(groups.get(reason) ?? []), person]);
  };
  const taken = new Set<string>();
  for (const row of rows) {
    const person: CardRequestPerson = { entryId: row.entryId, name: row.name, payerName: null, askedOn: null };
    const [userId, ...others] = row.userIds;
    if (row.former) keep("former", person);
    else if (row.payerName !== null) keep("paid_by", { ...person, payerName: row.payerName });
    else if (row.hasCard) keep("has_card", person);
    else if (!row.renews) keep("nothing_renews", person);
    else if (userId === undefined) keep("not_in_app", person);
    else if (others.length > 0 || taken.has(userId)) keep("shared", person);
    else if (row.askedAt !== null && row.askedAt.getTime() >= againSince.getTime()) keep("asked_recently", { ...person, askedOn: row.askedOn });
    else {
      taken.add(userId);
      ask.push({ ...person, userId, body: { own: row.ownTypes, others: row.paysForOthers }, email: row.email });
    }
  }
  const order: readonly CardRequestKeptReason[] = ["has_card", "paid_by", "nothing_renews", "not_in_app", "shared", "asked_recently", "former"];
  const kept = order.flatMap((reason) => {
    const people = groups.get(reason);
    return people === undefined ? [] : [{ reason, people, count: people.length }];
  });
  const gone = selected - rows.length;
  if (gone > 0) kept.push({ reason: "gone", people: [], count: gone });
  return { ask, kept };
}

/** Who exactly the box will ask: the gym, and each record with the app account it goes to. */
function askDigestOf(gymId: string, ask: readonly { entryId: string; userId: string }[]): string {
  return createHash("sha256")
    .update([gymId, "card-request", ...ask.map((person) => `${person.entryId}:${person.userId}`).sort()].join("\n"), "utf8")
    .digest("hex");
}

const strip = ({ entryId, name, payerName, askedOn }: CardRequestPerson): CardRequestPerson => ({ entryId, name, payerName, askedOn });

function previewOf(gymId: string, plan: CardRequestPlan, selected: number, emails: ReadonlyMap<string, string> | null): CardRequestPreview {
  return {
    selected,
    askCount: plan.ask.length,
    ask: plan.ask.slice(0, CARD_REQUEST_BOX_NAMES_MAX).map(strip),
    kept: plan.kept.map((group) => ({ ...group, people: group.people.slice(0, CARD_REQUEST_BOX_NAMES_MAX).map(strip) })),
    askDigest: askDigestOf(gymId, plan.ask),
    emailed: emails !== null,
    noEmail: emails === null ? 0 : plan.ask.length - emails.size,
  };
}

/** THE EMAILS THAT GO WITH THE MESSAGES (Kd, 2026-11-14): each person asked whose record has an address that
 *  can be emailed (one that never bounced or was refused). Null where this server sends no member emails. */
async function emailsFor(sql: Sql | TransactionSql, deps: CardRequestDeps, ask: CardRequestPlan["ask"]): Promise<Map<string, string> | null> {
  const settings = deps.invites ?? null;
  if (settings === null || settings.sender === null) return null;
  const typed = ask.flatMap((person) =>
    person.email !== null && authEmailSchema.safeParse(person.email).success ? [{ entryId: person.entryId, email: person.email, hmac: emailHmac(settings.hmacKey, person.email) }] : [],
  );
  const blocked = await requests.blockedOf(
    sql,
    typed.map((t) => t.hmac),
  );
  return new Map(typed.filter((t) => !blocked.has(t.hmac)).map((t) => [t.entryId, t.email]));
}

const gymNotFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const notOffered = (): OrgsError => new OrgsError(409, "card_request_not_offered", CARD_REQUEST_WORDS.not_offered);
const againSinceOf = (now: Date): Date => new Date(now.getTime() - CARD_REQUEST_AGAIN_DAYS * DAY_MS);

/** Both privileges, as the person's page it opens needs; and the account the gym takes cards through. */
async function allowed(deps: CardRequestDeps, gymId: string, userId: string, write: boolean): Promise<requests.CardsAccount> {
  const { privileges } = await (write ? requireWritablePrivilege : requirePrivilege)(deps, gymId, userId, "members.confirm");
  if (!privileges.includes(BILLING)) throw new OrgsError(403, "forbidden", NO_BILLING);
  const account = await requests.cardsAccountOf(deps.sql, deps.cardsEnvironment, gymId);
  if (account === null) throw notOffered();
  return account;
}

/** The box before the press. Null when the rate limit has answered. */
export async function previewCardRequest(
  deps: CardRequestDeps,
  userId: string,
  gymId: string,
  request: CardRequestPreviewRequest,
  limit: () => Promise<boolean>,
): Promise<CardRequestPreview | null> {
  const account = await allowed(deps, gymId, userId, false);
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection, userId);
  const now = deps.now();
  const rows = await requests.requestStateOf(deps.sql, gymId, ids, account, now);
  const plan = cardRequestPlan(rows, ids.length, againSinceOf(now));
  return previewOf(gymId, plan, ids.length, await emailsFor(deps.sql, deps, plan.ask));
}

/** The people who would be asked are not the ones the box named: nobody was asked, and this is
 *  the box as it now stands. */
export class CardRequestPeopleChanged extends Error {
  constructor(readonly preview: CardRequestPreview) {
    super("card_request_people_changed");
  }
}

/** Ask the people selected. Who is asked is worked out again with the gym held, and they are asked
 *  only if they are exactly the people the box named. The same box pressed twice asks once. Null
 *  when the rate limit has answered. */
export async function sendCardRequest(
  deps: CardRequestDeps,
  userId: string,
  gymId: string,
  request: CardRequestSendRequest,
  limit: () => Promise<boolean>,
): Promise<CardRequestDone | null> {
  const account = await allowed(deps, gymId, userId, true);
  if (!(await limit())) return null;
  const ids = await selectedIds(deps, gymId, request.selection, userId);
  // Lower-cased as the table's check spells a key (round one, L1): a key typed in capitals is the same press.
  const occasion = `card:${request.key.toLowerCase()}`;
  return await deps.sql.begin(async (tx): Promise<CardRequestDone> => {
    // The gym's row: a join, a removal, a payer set and another press wait, so the people are read
    // once and are who is written.
    await lockGym(tx, gymId);
    const now = deps.now();
    const gym = await gymNow(tx, gymId, now);
    if (gym === null) throw gymNotFound();
    const before = await sentWithKey(tx, gymId, occasion);
    if (before.asked > 0) return { ...before, kept: [] };
    const plan = cardRequestPlan(await requests.requestStateOf(tx, gymId, ids, account, now), ids.length, againSinceOf(now));
    if (plan.ask.length !== request.askCount || askDigestOf(gymId, plan.ask) !== request.askDigest) {
      throw new CardRequestPeopleChanged(previewOf(gymId, plan, ids.length, await emailsFor(tx, deps, plan.ask)));
    }
    if (plan.ask.length === 0) throw new OrgsError(409, "card_request_nobody", CARD_REQUEST_WORDS.nobody);
    const asked = await insertMessages(
      tx,
      plan.ask.map((person) => ({
        gymId,
        userId: person.userId,
        kind: CARD_REQUEST_MESSAGE_KIND,
        occasion,
        body: cardRequestMessage(gym.name, person.body),
        link: null,
        gymDay: gym.today,
      })),
      now,
      GYM_MESSAGE_KEPT_DAYS,
    );
    // The email with each message, written in the same transaction and sent by the worker.
    const emails = await emailsFor(tx, deps, plan.ask);
    const emailed = emails === null ? 0 : await requests.queueEmails(tx, gymId, occasion, [...emails].map(([entryId, email]) => ({ entryId, email })), now);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.card_request_sent",
      targetType: "org",
      targetId: gymId,
      meta: { people: String(asked), emailed: String(emailed) },
    });
    return { asked, emailed, kept: plan.kept.map(({ reason, count }) => ({ reason, count })) };
  });
}

/** How many were asked, and emailed, by the press with this key. */
async function sentWithKey(tx: TransactionSql, gymId: string, occasion: string): Promise<{ asked: number; emailed: number }> {
  const [row] = await tx<{ asked: number; emailed: number }[]>`
    SELECT (SELECT count(*)::int FROM gym_member_messages WHERE gym_id = ${gymId} AND kind = ${CARD_REQUEST_MESSAGE_KIND} AND occasion = ${occasion}) AS asked,
           (SELECT count(*)::int FROM gym_card_request_emails WHERE gym_id = ${gymId} AND occasion = ${occasion}) AS emailed`;
  return { asked: row?.asked ?? 0, emailed: row?.emailed ?? 0 };
}

/** For one person's page: the gym's day they were last asked, and whether Ask to add card would ask
 *  them now (the one rule, for them alone). */
export async function askOfRecord(sql: Sql | TransactionSql, gymId: string, entryId: string, account: requests.CardsAccount | null, now: Date): Promise<{ cardAskedOn: string | null; canAsk: boolean }> {
  if (account === null) return { cardAskedOn: null, canAsk: false };
  const [row] = await requests.requestStateOf(sql, gymId, [entryId], account, now);
  if (row === undefined || row.hasCard) return { cardAskedOn: null, canAsk: false };
  return { cardAskedOn: row.askedOn, canAsk: cardRequestPlan([row], 1, againSinceOf(now)).ask.length === 1 };
}
