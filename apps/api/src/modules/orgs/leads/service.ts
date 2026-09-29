// A GYM'S LEADS — spec Part 3 §16.3; ROADMAP Stage 2 item 20c-i.
//
// The worst thing this could do to a real person: show one gym's leads (names, emails,
// phone numbers) to another gym's staff, or to staff without the tick; and "Joined"
// putting a lead on the list as somebody else. Every read and write below starts on
// the same gate as the member list (`members.confirm`); a write also needs a live plan.
// Gates in CLAUDE.md §4's order: privilege, then the rate limit, then the handler.
import {
  GYM_ENQUIRIES_KEPT_PER_LEAD,
  LEAD_JOIN_CHOOSE_ERROR,
  LEAD_JOIN_MAX_CANDIDATES,
  LEAD_JOIN_STALE_ERROR,
  LEAD_EMAIL_NOT_SENT,
  LEAD_EMAILS_PER_MONTH,
  LEAD_FOLLOW_UPS,
  LEAD_WORDS,
  LEADS_MAX_PER_GYM,
  LEADS_PAGE,
  leadSourceSchema,
  leadStatusSchema,
  type CreateLeadRequest,
  type JoinLeadRequest,
  type JoinLeadResponse,
  type Lead,
  type LeadFollowUpSentRequest,
  type LeadEmailNotSent,
  type LeadEnquiry,
  type LeadJoinCandidate,
  type LeadStatus,
  type LeadsQuery,
  type LeadsResponse,
  type UpdateLeadRequest,
} from "@app/shared";
import type { Sql } from "postgres";
import { z } from "zod";
import { dayInTz } from "../../gamification/streak.js";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { applyTyped, EMPTY_VALUES, holdsCard } from "../memberList/byHand.js";
import { placeLeadInTx } from "../memberList/byHandService.js";
import { entryFor, lockGym } from "../memberList/repo.js";
import { readCountry } from "../memberList/phone.js";
import { emailHmac } from "../invites/address.js";
import { heldAddresses } from "../invites/repo.js";
import { gymNameForEmail } from "../invites/gymText.js";
import * as emailsRepo from "./emailsRepo.js";
import { followUpDueOn } from "./followUp.js";
import { leadJoinDecision, sharesContact, type ListRecord } from "./joinRule.js";
import * as repo from "./repo.js";

export interface LeadsDeps {
  sql: Sql;
  now: () => Date;
  /** The key addresses are kept under (the invitations'), to find who asked a gym to
   *  stop emailing them; null while invitations are off. */
  addressKey: Buffer | null;
  /** Whether emails through the app can go at all, by the invitations' settings: "paused"
   *  by the operator's kill switch, "off" when sending is not set up. The worker sends
   *  leads' follow-ups only when it is "on", so only then are they the app's. */
  sending: "on" | "paused" | "off";
}

type Limit = () => Promise<boolean>;

const notFound = (): OrgsError => new OrgsError(404, "lead_not_found", LEAD_WORDS.lead_not_found);

/** Who sends a lead's next follow-up (20c-v), when the app sends it, why the app did not,
 *  and when the person asked the gym to stop emailing them. */
export interface LeadSendingView {
  by: "app" | "you" | null;
  appWhen: "today" | "tomorrow" | "waiting" | null;
  notSent: LeadEmailNotSent | null;
  optedOutAt: Date | null;
}

const NOBODY_SENDING: LeadSendingView = { by: null, appWhen: null, notSent: null, optedOutAt: null };

const notSentSchema = z.enum(LEAD_EMAIL_NOT_SENT);

/** Who sends a due follow-up. With the switch on (`app.on`: the gym able to send, and
 *  emails through the app going), the app takes a lead it has already emailed under
 *  this tick, or any lead while the month has room, unless its try at this very email
 *  ended without sending; staff send the rest. The list's "Email due" asks the same in
 *  SQL (`staffDueCondition`). */
export function whoSends(
  dueOn: string | null,
  app: { on: boolean; roomLeft: boolean },
  state: emailsRepo.LeadSendState | undefined,
): { by: "app" | "you" | null; notSent: LeadEmailNotSent | null } {
  if (dueOn === null) return { by: null, notSent: null };
  const next = state?.next ?? null;
  const ended = next !== null && (next.state === "skipped" || (next.state === "failed" && next.reason !== "send_unknown"));
  let notSent: LeadEmailNotSent | null = null;
  if (ended) {
    const word = notSentSchema.safeParse(next.reason);
    notSent = next.state === "skipped" && word.success ? word.data : "could_not_send";
  }
  const takes = app.on && !ended && (app.roomLeft || state?.continuing === true);
  return { by: takes ? "app" : "you", notSent };
}

/** When the app sends a due follow-up it takes: later today; tomorrow morning, after its
 *  sending hours; or it is waiting — held for another try, or its day passed in the
 *  sending hours without it going. Null when it is not due yet (its day is said). */
export function appWhen(
  dueOn: string | null,
  today: string,
  localHour: number,
  state: emailsRepo.LeadSendState | undefined,
): "today" | "tomorrow" | "waiting" | null {
  if (dueOn === null || dueOn > today) return null;
  if (state?.next?.state === "queued") return "waiting";
  if (localHour >= emailsRepo.SENDING_HOURS.until) return "tomorrow";
  if (dueOn < today && localHour >= emailsRepo.SENDING_HOURS.from) return "waiting";
  return "today";
}

/** Whether the app is sending this gym's follow-ups now, whether its month has room, and
 *  the gym's hour. */
export interface AppSending {
  on: boolean;
  roomLeft: boolean;
  localHour: number;
}

export function appSending(gym: emailsRepo.GymSendingFacts | null, sending: LeadsDeps["sending"]): AppSending {
  if (gym === null) return { on: false, roomLeft: false, localHour: 0 };
  const on =
    sending === "on" &&
    gym.sendForMe &&
    gym.replyTo !== null &&
    gym.hasPostalAddress &&
    !gym.stopped &&
    gym.active &&
    gym.onPlan &&
    gymNameForEmail(gym.name) !== "";
  return { on, roomLeft: gym.usedThisMonth < LEAD_EMAILS_PER_MONTH, localHour: gym.localHour };
}

/** The sending view of each of these leads, read in four statements whatever their number. */
async function sendingViews(
  deps: LeadsDeps,
  gymId: string,
  rows: readonly repo.LeadRow[],
  app: AppSending,
  today: string,
): Promise<Map<string, LeadSendingView>> {
  const due = rows.filter((row) => row.followUpDueOn !== null);
  const states = await emailsRepo.leadSendStates(
    deps.sql,
    gymId,
    due.map((row) => row.id),
  );
  const members = await heldAddresses(
    deps.sql,
    gymId,
    due.flatMap((row) => (row.email === null ? [] : [row.email])),
  );
  const key = deps.addressKey;
  const hmacs = new Map<string, string>();
  if (key !== null) for (const row of rows) if (row.email !== null) hmacs.set(row.id, emailHmac(key, row.email));
  const stops = await emailsRepo.addressStops(deps.sql, gymId, [...new Set(hmacs.values())]);
  return new Map(
    rows.map((row) => {
      const hmac = hmacs.get(row.id);
      const stop = hmac === undefined ? undefined : stops.get(hmac);
      const state = states.get(row.id);
      let { by, notSent } = whoSends(row.followUpDueOn, app, state);
      // An address the app's own check refuses (stopped, bounced, or on the member list)
      // is staff's from now, not from the worker's next try, and the panel says why.
      if (by === "app" && stop !== undefined) {
        by = "you";
        notSent = stop.reason;
      } else if (by === "app" && row.email !== null && members.has(row.email.toLowerCase())) {
        by = "you";
        notSent = "on_member_list";
      }
      const view: LeadSendingView = {
        by,
        appWhen: by === "app" ? appWhen(row.followUpDueOn, today, app.localHour, state) : null,
        notSent,
        optedOutAt: stop?.optedOutAt ?? null,
      };
      return [row.id, view];
    }),
  );
}

/** One lead as a reply shows it, with who sends its next follow-up. */
async function leadWithSending(deps: LeadsDeps, gymId: string, row: repo.LeadRow, today: string): Promise<Lead> {
  const app = appSending(await emailsRepo.gymSendingFacts(deps.sql, gymId, deps.now()), deps.sending);
  const views = await sendingViews(deps, gymId, [row], app, today);
  return toLead(row, today, views.get(row.id));
}

/** `today` is the gym's day, which says whether a follow-up is due now. */
export function toLead(row: repo.LeadRow, today: string, sending: LeadSendingView = NOBODY_SENDING): Lead {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    // Parsed, not cast: the columns' CHECKs hold the same lists.
    source: leadSourceSchema.parse(row.source),
    status: leadStatusSchema.parse(row.status),
    notes: row.notes,
    mayEmail: row.emailOkAt !== null,
    entryId: row.entryId,
    onList: row.onList,
    createdAt: row.createdAt.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
    followUp: {
      sent: row.followUpsSent,
      dueOn: row.followUpDueOn,
      dueNow: row.followUpDueOn !== null && row.followUpDueOn <= today,
      overdue: row.followUpDueOn !== null && row.followUpDueOn < today,
      lastSentAt: row.followUpLastAt === null ? null : row.followUpLastAt.toISOString(),
      by: sending.by,
      appWhen: sending.appWhen,
      notSent: sending.notSent,
      optedOutAt: sending.optedOutAt === null ? null : sending.optedOutAt.toISOString(),
    },
    enquiredAt: row.enquiredAt === null ? null : row.enquiredAt.toISOString(),
  };
}

/** A lead's follow-up columns after a write: the count and the last one as given,
 *  and the next due day worked out again from the status and the tick. */
export function followUpValues(
  input: { status: LeadStatus; emailOkAt: Date | null; sent: number; lastAt: Date | null },
  timeZone: string,
): { followUpsSent: number; followUpLastAt: Date | null; followUpDueOn: string | null } {
  return {
    followUpsSent: input.sent,
    followUpLastAt: input.lastAt,
    followUpDueOn: followUpDueOn({
      status: input.status,
      ticked: input.emailOkAt !== null,
      sent: input.sent,
      tickDay: input.emailOkAt === null ? null : dayInTz(input.emailOkAt, timeZone),
      lastSentDay: input.lastAt === null ? null : dayInTz(input.lastAt, timeZone),
    }),
  };
}

const sameAddress = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

/** A lead's name, email and phone, cleaned by the member list's own rules, so a
 *  lead and the record made from it hold the same address and the same number. */
export function cleanContact(
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

/** When "Happy to hear from us" was ticked, or null. The tick is a yes to one
 *  address: refused without an email, kept while the email stays, cleared when it
 *  changes. `wanted` undefined leaves it as it was. */
function emailOkAt(
  wanted: boolean | undefined,
  email: string | null,
  stored: { email: string | null; emailOkAt: Date | null } | null,
  at: Date,
): Date | null {
  const sameEmail = stored !== null && email !== null && stored.email !== null && stored.email.toLowerCase() === email.toLowerCase();
  if (wanted === true) {
    if (email === null) throw new OrgsError(400, "needs_email", LEAD_WORDS.needs_email);
    return sameEmail && stored.emailOkAt !== null ? stored.emailOkAt : at;
  }
  if (wanted === false || !sameEmail) return null;
  return stored.emailOkAt;
}

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

const cursorSchema = z
  .object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/), id: z.string().uuid() })
  .strict();

/** The digits of a search that could be a phone number (at least four), with a
 *  leading 0 or 00 dropped so "07700 900456" and "+44 7700 900456" both reach
 *  +447700900456. Null for anything else. */
function phoneDigits(typed: string): string | null {
  const digits = typed.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 4 ? digits : null;
}

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
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const today = dayInTz(deps.now(), org.timezone);
  let cursor: repo.LeadCursor | null = null;
  if (query.cursor !== undefined) {
    cursor = decodeCursor(query.cursor);
    if (cursor === null) throw new OrgsError(400, "validation_error", "cursor: not a cursor");
  }
  const typed = (query.q ?? "").trim();
  const app = appSending(await emailsRepo.gymSendingFacts(deps.sql, gymId, deps.now()), deps.sending);
  const [page, counts] = await Promise.all([
    repo.leadsPage(deps.sql, {
      gymId,
      status: query.status ?? null,
      like: typed === "" ? null : `%${escapeLike(typed)}%`,
      digits: phoneDigits(typed),
      dueBy: query.followUp === "due" ? today : null,
      app,
      cursor,
      limit: LEADS_PAGE + 1,
    }),
    repo.leadCounts(deps.sql, gymId, today, app),
  ]);
  const shown = page.rows.slice(0, LEADS_PAGE);
  const last = page.rows.length > LEADS_PAGE ? shown[shown.length - 1] : undefined;
  const views = await sendingViews(deps, gymId, shown, app, today);
  return {
    leads: shown.map((row) => toLead(row, today, views.get(row.id))),
    total: page.total,
    cursor: last === undefined ? null : encodeCursor({ at: last.cursorAt, id: last.id }),
    counts,
  };
}

export async function getLead(deps: LeadsDeps, userId: string, gymId: string, leadId: string, limit: Limit): Promise<Lead | null> {
  const { org } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const row = await repo.leadFor(deps.sql, gymId, leadId);
  if (row === null) throw notFound();
  return await leadWithSending(deps, gymId, row, dayInTz(deps.now(), org.timezone));
}

/** The messages a lead sent through the gym page's form, newest first (20c-iv-a). */
export async function listEnquiries(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  leadId: string,
  limit: Limit,
): Promise<LeadEnquiry[] | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  if ((await repo.leadFor(deps.sql, gymId, leadId)) === null) throw notFound();
  const rows = await repo.enquiriesFor(deps.sql, gymId, leadId, GYM_ENQUIRIES_KEPT_PER_LEAD);
  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    source: row.source === null ? null : leadSourceSchema.parse(row.source),
    message: row.message,
    mayEmail: row.mayEmail,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Two requests past the check at once (two servers): the database's UNIQUE answers,
 *  and the caller hears the same 409 as the check gives. */
async function clashIsExists<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (err) {
    if (repo.isLeadClash(err)) throw new OrgsError(409, "lead_exists", LEAD_WORDS.lead_exists);
    throw err;
  }
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
  const at = deps.now();
  const okAt = emailOkAt(body.mayEmail, contact.email, null, at);
  const row = await clashIsExists(deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    if ((await repo.countLeads(tx, gymId)) >= LEADS_MAX_PER_GYM) {
      throw new OrgsError(409, "leads_full", LEAD_WORDS.leads_full);
    }
    await refuseHeld(tx, gymId, contact, null);
    const inserted = await repo.insertLead(
      tx,
      gymId,
      {
        ...contact,
        source: body.source,
        notes,
        emailOkAt: okAt,
        ...followUpValues({ status: "new", emailOkAt: okAt, sent: 0, lastAt: null }, org.timezone),
      },
      userId,
    );
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.lead_added",
      targetType: "lead",
      targetId: inserted.id,
      meta: { source: body.source, mayEmail: okAt === null ? "false" : "true" },
    });
    return inserted;
  }));
  return await leadWithSending(deps, gymId, row, dayInTz(at, org.timezone));
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
  const row = await clashIsExists(deps.sql.begin(async (tx) => {
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
    const okAt = emailOkAt(body.mayEmail, contact.email, stored, at);
    // The follow-ups are to one address: a new one starts them again from the first.
    const kept = sameAddress(contact.email, stored.email);
    const written = await repo.writeLead(
      tx,
      gymId,
      leadId,
      {
        ...contact,
        source: body.source ?? leadSourceSchema.parse(stored.source),
        notes: body.notes === undefined ? stored.notes : cleanNotes(body.notes),
        emailOkAt: okAt,
        status,
        // A lead moved off "joined" is no longer anybody on the list.
        entryId: status === "joined" ? stored.entryId : null,
        ...followUpValues(
          { status, emailOkAt: okAt, sent: kept ? stored.followUpsSent : 0, lastAt: kept ? stored.followUpLastAt : null },
          org.timezone,
        ),
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
  }));
  return await leadWithSending(deps, gymId, row, dayInTz(at, org.timezone));
}

/** Staff sent follow-up `step` from the gym's own mailbox to `email`. Counted only as
 *  the next one, on or after its day, to the lead's current address; the same request
 *  again answers the lead unchanged. */
export async function markFollowUpSent(
  deps: LeadsDeps,
  userId: string,
  gymId: string,
  leadId: string,
  body: LeadFollowUpSentRequest,
  limit: Limit,
): Promise<Lead | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const at = deps.now();
  const today = dayInTz(at, org.timezone);
  const row = await deps.sql.begin(async (tx) => {
    const stored = await repo.lockLead(tx, gymId, leadId);
    if (stored === null) throw notFound();
    if (stored.followUpsSent >= body.step) return stored;
    // The app is sending this very email (20c-v): marking it too would mean two.
    if (await emailsRepo.appHasStep(tx, gymId, leadId, body.step)) {
      throw new OrgsError(409, "follow_up_sent_for_you", LEAD_WORDS.follow_up_sent_for_you);
    }
    const status = leadStatusSchema.parse(stored.status);
    const due = followUpValues(
      { status, emailOkAt: stored.emailOkAt, sent: stored.followUpsSent, lastAt: stored.followUpLastAt },
      org.timezone,
    ).followUpDueOn;
    // Only the next one, on or after its day, and to the address the lead has now: a
    // panel opened before the address changed emailed somebody else.
    if (
      due === null ||
      due > today ||
      !sameAddress(body.email, stored.email) ||
      body.step !== stored.followUpsSent + 1 ||
      body.step > LEAD_FOLLOW_UPS
    ) {
      throw new OrgsError(409, "follow_up_not_due", LEAD_WORDS.follow_up_not_due);
    }
    const written = await repo.writeLead(
      tx,
      gymId,
      leadId,
      {
        fullName: stored.fullName,
        email: stored.email,
        phone: stored.phone,
        source: leadSourceSchema.parse(stored.source),
        notes: stored.notes,
        emailOkAt: stored.emailOkAt,
        status,
        entryId: stored.entryId,
        ...followUpValues({ status, emailOkAt: stored.emailOkAt, sent: body.step, lastAt: at }, org.timezone),
      },
      at,
    );
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.lead_follow_up_sent",
      targetType: "lead",
      targetId: leadId,
      meta: { step: String(body.step) },
    });
    return written;
  });
  return await leadWithSending(deps, gymId, row, today);
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

/** The record holding a lead's exact details, read on its own. */
async function heldRecord(tx: Parameters<typeof entryFor>[0], gymId: string, entryId: string): Promise<ListRecord> {
  const stored = await entryFor(tx, gymId, entryId);
  if (stored === null) throw new Error(`member-list entry ${entryId} vanished under the gym's lock`);
  return {
    entryId: stored.id,
    fullName: stored.values.fullName,
    email: stored.values.email,
    phone: stored.values.phone,
    former: stored.formerAt !== null,
  };
}

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
    if (stored.status === "joined" && stored.entryId !== null && stored.onList) {
      return { kind: "joined", body: { lead: toLead(stored, dayInTz(at, org.timezone)), outcome: "already_joined" } };
    }
    const lead = { fullName: stored.fullName, email: stored.email, phone: stored.phone };
    const records = await repo.recordsSharingContact(tx, gymId, lead, RECORDS_READ);
    const decision = leadJoinDecision(lead, records);
    const shared = records.filter((record) => sharesContact(lead, record));
    const candidates = shared.slice(0, LEAD_JOIN_MAX_CANDIDATES).map(toCandidate);

    let entryId: string | null;
    if (stored.status === "joined" && stored.entryId !== null) {
      // Joined before, and that record was taken off the list since: it is put back.
      entryId = stored.entryId;
    } else if (body.entryId !== undefined) {
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
    if (placed.outcome === "held") {
      // "Someone new", and a record holds exactly these details: shown, never taken.
      // Among the records read, or past them when more than RECORDS_READ share the contact.
      const held = shared.find((record) => record.entryId === placed.entryId) ?? (await heldRecord(tx, gymId, placed.entryId));
      return { kind: "choose", error: LEAD_JOIN_CHOOSE_ERROR, message: LEAD_WORDS.join_exact, candidates: [toCandidate(held)] };
    }
    const written = await repo.writeLead(
      tx,
      gymId,
      leadId,
      {
        ...lead,
        source: leadSourceSchema.parse(stored.source),
        notes: stored.notes,
        emailOkAt: stored.emailOkAt,
        status: "joined",
        entryId: placed.entryId,
        ...followUpValues(
          { status: "joined", emailOkAt: stored.emailOkAt, sent: stored.followUpsSent, lastAt: stored.followUpLastAt },
          org.timezone,
        ),
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
    return { kind: "joined", body: { lead: toLead(written, dayInTz(at, org.timezone)), outcome: placed.outcome } };
  });
}
