// A MEMBER'S INBOX FROM THEIR GYM (spec Part 3 §16.1; ROADMAP 20a).
//
// A message is read only by the person it was sent to, and only while they are a live
// member of that gym: everybody else is answered 404, as for a gym that is not there.
import type { Sql } from "postgres";
import {
  GYM_INBOX_MAX,
  gymInboxResponseSchema,
  markGymInboxReadResponseSchema,
  type GymInboxResponse,
  type MarkGymInboxReadRequest,
  type MarkGymInboxReadResponse,
} from "@app/shared";
import { OrgsError } from "../service.js";
import * as repo from "./repo.js";

export interface MessagesDeps {
  sql: Sql;
  now: () => Date;
}

/** The route's rate limit, asked after who is asking: false when it has already answered 429. */
export type Limit = () => Promise<boolean>;

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");

interface Reader {
  name: string;
  now: Date;
  since: Date;
  /** The gym is closed or on no plan: its members are shown no messages. */
  paused: boolean;
}

async function forMember(deps: MessagesDeps, gymId: string, userId: string): Promise<Reader> {
  const now = deps.now();
  const gate = await repo.memberGate(deps.sql, gymId, userId);
  if (gate === null || !gate.member || gate.joinedAt === null) throw notFound();
  return { name: gate.name, now, since: gate.joinedAt, paused: !(gate.open && gate.live) };
}

/** The member's inbox from this gym, newest first. Reading it marks nothing. */
export async function getInbox(deps: MessagesDeps, userId: string, gymId: string, limit: Limit): Promise<GymInboxResponse | null> {
  const reader = await forMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const head = { gymId, gymName: reader.name, asOf: reader.now.toISOString() };
  if (reader.paused) return gymInboxResponseSchema.parse({ ...head, status: "paused", messages: [], unread: 0 });
  const [rows, unread] = await Promise.all([
    repo.inboxRows(deps.sql, gymId, userId, reader.since, reader.now, GYM_INBOX_MAX),
    repo.unreadCount(deps.sql, gymId, userId, reader.since, reader.now),
  ]);
  return gymInboxResponseSchema.parse({
    ...head,
    status: "shown",
    messages: rows.map((row) => ({ id: row.id, kind: row.kind, body: row.body, sentAt: row.sentAt.toISOString(), read: row.read })),
    unread,
  });
}

/** Marks the member's own messages as read, up to the read they were shown. Asked twice
 *  it is done once. Answers how many are still new. */
export async function markRead(deps: MessagesDeps, userId: string, gymId: string, body: MarkGymInboxReadRequest, limit: Limit): Promise<MarkGymInboxReadResponse | null> {
  const reader = await forMember(deps, gymId, userId);
  if (!(await limit())) return null;
  if (reader.paused) return markGymInboxReadResponseSchema.parse({ unread: 0 });
  // Never past now: an instant in the future would mark what has not been shown.
  const upTo = new Date(Math.min(Date.parse(body.upTo), reader.now.getTime()));
  await repo.markRead(deps.sql, gymId, userId, upTo, reader.now);
  return markGymInboxReadResponseSchema.parse({ unread: await repo.unreadCount(deps.sql, gymId, userId, reader.since, reader.now) });
}
