// A GYM'S LEADS — spec Part 3 §16.3; ROADMAP Stage 2 item 20c-i.
//
// The worst thing this could do to a real person: show one gym's leads (names, emails,
// phone numbers) to another gym's staff, or to staff without the tick; and "Joined"
// putting a lead on the list as somebody else. Every read and write below starts on
// the same gate as the member list (`members.confirm`); a write also needs a live plan.
// Gates in CLAUDE.md §4's order: privilege, then the rate limit, then the handler.
import {
  LEAD_JOIN_CHOOSE_ERROR,
  LEAD_JOIN_MAX_CANDIDATES,
  LEAD_JOIN_STALE_ERROR,
  LEAD_WORDS,
  LEADS_MAX_PER_GYM,
  LEADS_PAGE,
  leadSourceSchema,
  leadStatusSchema,
  type CreateLeadRequest,
  type JoinLeadRequest,
  type JoinLeadResponse,
  type Lead,
  type LeadJoinCandidate,
  type LeadsQuery,
  type LeadsResponse,
  type UpdateLeadRequest,
} from "@app/shared";
import type { Sql } from "postgres";
import { z } from "zod";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { applyTyped, EMPTY_VALUES, holdsCard } from "../memberList/byHand.js";
import { placeLeadInTx } from "../memberList/byHandService.js";
import { lockGym } from "../memberList/repo.js";
import { readCountry } from "../memberList/phone.js";
import { leadJoinDecision, sharesContact, type ListRecord } from "./joinRule.js";
import * as repo from "./repo.js";

export interface LeadsDeps {
  sql: Sql;
  now: () => Date;
}

type Limit = () => Promise<boolean>;

const notFound = (): OrgsError => new OrgsError(404, "lead_not_found", LEAD_WORDS.lead_not_found);

function toLead(row: repo.LeadRow): Lead {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    // Parsed, not cast: the columns' CHECKs hold the same lists.
    source: leadSourceSchema.parse(row.source),
    status: leadStatusSchema.parse(row.status),
    notes: row.notes,
    entryId: row.entryId,
    createdAt: row.createdAt.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
  };
}

/** A lead's name, email and phone, cleaned by the member list's own rules, so a
 *  lead and the record made from it hold the same address and the same number. */
function cleanContact(
  typed: { fullName: string; email: string | null; phone: string | null },
  country: string | null,
): { fullName: string; email: string | null; phone: string | null } {
  const input: { fullName: string; email?: string; phone?: string } = { fullName: typed.fullName };
  if (typed.email !== null) input.email = typed.email;
  if (typed.phone !== null) input.phone = typed.phone;
  const applied = applyTyped(EMPTY_VALUES, input, { country: readCountry(country), fields: new Map() });
  if (!applied.ok) throw new OrgsError(400, applied.refusal.code, applied.refusal.message);
  const { fullName, email, phone } = applied.values;
  if (fullName === "") throw new OrgsError(400, "needs_name", LEAD_WORDS.needs_name);
  if (email === null && phone === null) throw new OrgsError(400, "needs_contact", LEAD_WORDS.needs_contact);
  return { fullName, email, phone };
}

function cleanNotes(notes: string): string {
  const text = notes.trim();
  if (holdsCard(text)) throw new OrgsError(400, "notes_card", LEAD_WORDS.notes_card);
  return text;
}

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

const cursorSchema = z.object({ at: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict();

function encodeCursor(cursor: repo.LeadCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** Null for anything that is not one of ours; the caller answers 400. */
function decodeCursor(raw: string): repo.LeadCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const cursor = cursorSchema.safeParse(parsed);
  return cursor.success ? cursor.data : null;
}

export async function listLeads(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  query: LeadsQuery,
  limit: Limit,
): Promise<LeadsResponse | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  let cursor: repo.LeadCursor | null = null;
  if (query.cursor !== undefined) {
    cursor = decodeCursor(query.cursor);
    if (cursor === null) throw new OrgsError(400, "validation_error", "cursor: not a cursor");
  }
  const typed = (query.q ?? "").trim();
  const [page, counts] = await Promise.all([
    repo.leadsPage(deps.sql, {
      gymId,
      status: query.status ?? null,
      like: typed === "" ? null : `%${escapeLike(typed)}%`,
      cursor,
      limit: LEADS_PAGE + 1,
    }),
    repo.leadCounts(deps.sql, gymId),
  ]);
  const shown = page.rows.slice(0, LEADS_PAGE);
  const last = page.rows.length > LEADS_PAGE ? shown[shown.length - 1] : undefined;
  return {
    leads: shown.map(toLead),
    total: page.total,
    cursor: last === undefined ? null : encodeCursor({ at: last.createdAt.toISOString(), id: last.id }),
    counts,
  };
}

export async function getLead(deps: LeadsDeps, userId: string, gymId: string, leadId: string, limit: Limit): Promise<Lead | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const row = await repo.leadFor(deps.sql, gymId, leadId);
  if (row === null) throw notFound();
  return toLead(row);
}

async function refuseHeld(
  tx: Parameters<typeof repo.leadHolding>[0],
  gymId: string,
  contact: { email: string | null; phone: string | null },
  exceptId: string | null,
): Promise<void> {
  if ((await repo.leadHolding(tx, gymId, contact, exceptId)) !== null) {
    throw new OrgsError(409, "lead_exists", LEAD_WORDS.lead_exists);
  }
}

export async function createLead(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  body: CreateLeadRequest,
  limit: Limit,
): Promise<Lead | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const contact = cleanContact({ fullName: body.fullName, email: body.email ?? null, phone: body.phone ?? null }, org.country);
  const notes = cleanNotes(body.notes ?? "");
  const row = await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    if ((await repo.countLeads(tx, gymId)) >= LEADS_MAX_PER_GYM) {
      throw new OrgsError(409, "leads_full", LEAD_WORDS.leads_full);
    }
    await refuseHeld(tx, gymId, contact, null);
    const inserted = await repo.insertLead(tx, gymId, { ...contact, source: body.source, notes }, userId);
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.lead_added",
      targetType: "lead",
      targetId: inserted.id,
      meta: { source: body.source },
    });
    return inserted;
  });
  return toLead(row);
}

export async function updateLead(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  leadId: string,
  body: UpdateLeadRequest,
  limit: Limit,
): Promise<Lead | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const at = deps.now();
  const row = await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const stored = await repo.lockLead(tx, gymId, leadId);
    if (stored === null) throw notFound();
    const contact = cleanContact(
      {
        fullName: body.fullName ?? stored.fullName,
        email: body.email === undefined ? stored.email : body.email,
        phone: body.phone === undefined ? stored.phone : body.phone,
      },
      org.country,
    );
    if (contact.email !== stored.email || contact.phone !== stored.phone) await refuseHeld(tx, gymId, contact, leadId);
    const status = body.status ?? leadStatusSchema.parse(stored.status);
    const written = await repo.writeLead(
      tx,
      gymId,
      leadId,
      {
        ...contact,
        source: body.source ?? leadSourceSchema.parse(stored.source),
        notes: body.notes === undefined ? stored.notes : cleanNotes(body.notes),
        status,
        // A lead moved off "joined" is no longer anybody on the list.
        entryId: status === "joined" ? stored.entryId : null,
      },
      at,
    );
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.lead_changed",
      targetType: "lead",
      targetId: leadId,
      meta: { fields: Object.keys(body).sort(), status },
    });
    return written;
  });
  return toLead(row);
}

export async function deleteLead(deps: LeadsDeps, userId: string, gymId: string, leadId: string, limit: Limit): Promise<boolean | null> {
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    if (!(await repo.deleteLead(tx, gymId, leadId))) throw notFound();
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.lead_deleted",
      targetType: "lead",
      targetId: leadId,
      meta: {},
    });
  });
  return true;
}

export type JoinAnswer =
  | { kind: "joined"; body: JoinLeadResponse }
  | { kind: "choose" | "stale"; error: typeof LEAD_JOIN_CHOOSE_ERROR | typeof LEAD_JOIN_STALE_ERROR; message: string; candidates: LeadJoinCandidate[] }
  | { kind: "rate_limited" };

/** How many records the rule reads. More than the screen lists, so a record with the
 *  lead's own name is never cut off by the ones that only share the contact. */
const RECORDS_READ = 50;

const toCandidate = (record: ListRecord): LeadJoinCandidate => ({
  entryId: record.entryId,
  fullName: record.fullName,
  email: record.email,
  phone: record.phone,
  former: record.former,
});

/** Joined: the lead is put on the member list as the record that is this person, or
 *  as a new one, in one transaction under the gym's lock (the lock every list write
 *  takes), and marked joined. */
export async function joinLead(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  leadId: string,
  body: JoinLeadRequest,
  limit: Limit,
): Promise<JoinAnswer> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return { kind: "rate_limited" };
  const at = deps.now();
  return await deps.sql.begin(async (tx): Promise<JoinAnswer> => {
    await lockGym(tx, gymId);
    const stored = await repo.lockLead(tx, gymId, leadId);
    if (stored === null) throw notFound();
    if (stored.status === "joined" && stored.entryId !== null) {
      return { kind: "joined", body: { lead: toLead(stored), outcome: "already_joined" } };
    }
    const lead = { fullName: stored.fullName, email: stored.email, phone: stored.phone };
    const records = await repo.recordsSharingContact(tx, gymId, lead, RECORDS_READ);
    const decision = leadJoinDecision(lead, records);
    const shared = records.filter((record) => sharesContact(lead, record));
    const candidates = shared.slice(0, LEAD_JOIN_MAX_CANDIDATES).map(toCandidate);

    let entryId: string | null;
    if (body.entryId !== undefined) {
      // Only a record the screen could have shown: one of this gym's that shares the
      // lead's email or phone now.
      if (!shared.some((record) => record.entryId === body.entryId)) {
        return { kind: "stale", error: LEAD_JOIN_STALE_ERROR, message: LEAD_WORDS.join_stale, candidates };
      }
      entryId = body.entryId;
    } else if (body.asNew === true || decision.kind === "add") {
      entryId = null;
    } else if (decision.kind === "link") {
      entryId = decision.entryId;
    } else {
      return { kind: "choose", error: LEAD_JOIN_CHOOSE_ERROR, message: LEAD_WORDS.join_choose, candidates };
    }

    const placed = await placeLeadInTx(tx, { gymId, userId, at, country: org.country, entryId, lead });
    const written = await repo.writeLead(
      tx,
      gymId,
      leadId,
      {
        ...lead,
        source: leadSourceSchema.parse(stored.source),
        notes: stored.notes,
        status: "joined",
        entryId: placed.entryId,
      },
      at,
    );
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.lead_joined",
      targetType: "lead",
      targetId: leadId,
      meta: { outcome: placed.outcome, entryId: placed.entryId },
    });
    return { kind: "joined", body: { lead: toLead(written), outcome: placed.outcome } };
  });
}
