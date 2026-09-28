// A GYM'S OWN PAGE AND ITS ENQUIRY FORM — spec Part 3 §16.3; ROADMAP 20c-iv-a.
//
// The worst thing this could do to a real person: put somebody's enquiry on another
// gym's leads, or tell a stranger who a gym already has. So a message is written only
// to the gym whose page it came from, found by the page's own address, and the form
// answers the same `received` whether the person was new, already a lead, or a robot
// filling the hidden field.
//
// Staff read the page with the Leads gate (`members.confirm`); only the owner's
// `org.manage` changes it. The public page shows only when switched on, for an open gym
// on a trial or a paid plan; anything else is the same 404.
import {
  ENQUIRY_WORDS,
  GYM_ENQUIRIES_KEPT_PER_LEAD,
  GYM_FACILITIES,
  LEADS_MAX_PER_GYM,
  leadSourceSchema,
  leadStatusSchema,
  orgTypeSchema,
  typedFacility,
  type GymEnquiryRequest,
  type GymFacility,
  type GymPage,
  type PublicGymPage,
  type SetGymPageRequest,
} from "@app/shared";
import type { Sql } from "postgres";
import { getGymHours, gymHasLivePlan, insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege, toGymHours } from "../service.js";
import { holdsCard } from "../memberList/byHand.js";
import { lockGym } from "../memberList/repo.js";
import * as leadsRepo from "../leads/repo.js";
import { cleanContact, followUpValues } from "../leads/service.js";
import * as repo from "./repo.js";
import type { RobotCheck } from "./robotCheck.js";

export interface GymPageDeps {
  sql: Sql;
  now: () => Date;
  robotCheck: RobotCheck;
}

type Limit = () => Promise<boolean>;

const notFound = (): OrgsError => new OrgsError(404, "page_not_found", ENQUIRY_WORDS.not_found);

/** The facilities the app knows, in the page's order: a word dropped from the list
 *  later is never shown. */
const known = (stored: readonly string[]): GymFacility[] => GYM_FACILITIES.filter((facility) => stored.includes(facility));

/** The ticks and the gym's own facilities as they are kept: one of its own that is the
 *  list's words becomes that tick, and one it typed twice is kept once. */
function facilitiesFrom(body: SetGymPageRequest): { facilities: GymFacility[]; ownFacilities: string[] } {
  const ticked = new Set<string>(body.facilities);
  const own: string[] = [];
  for (const typed of body.ownFacilities) {
    const read = typedFacility(typed);
    if (read === null) continue;
    if (read.kind === "listed") ticked.add(read.facility);
    else if (!own.some((name) => name.toLowerCase() === read.name.toLowerCase())) own.push(read.name);
  }
  return { facilities: known([...ticked]), ownFacilities: own };
}

export async function getGymPage(deps: Pick<GymPageDeps, "sql">, userId: string, gymId: string, limit: Limit): Promise<GymPage | null> {
  const { org, privileges } = await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const page = (await repo.pageFor(deps.sql, gymId)) ?? repo.EMPTY_PAGE;
  return {
    shown: page.shown,
    about: page.about,
    facilities: known(page.facilities),
    ownFacilities: page.ownFacilities,
    slug: org.slug,
    mayChange: privileges.includes("org.manage"),
  };
}

export async function setGymPage(
  deps: Pick<GymPageDeps, "sql" | "now">,
  userId: string,
  gymId: string,
  body: SetGymPageRequest,
  limit: Limit,
): Promise<GymPage | null> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  const page: repo.PageRow = { shown: body.shown, about: body.about.trim(), ...facilitiesFrom(body) };
  await deps.sql.begin(async (tx) => {
    await repo.writePage(tx, gymId, page, deps.now());
    await insertAudit(tx, {
      actorUserId: userId,
      gymId,
      action: "org.page_changed",
      targetType: "gym",
      targetId: gymId,
      meta: { shown: String(page.shown) },
    });
  });
  return { ...page, facilities: known(page.facilities), slug: org.slug, mayChange: true };
}

/** A page switched on, of an open gym on a trial or a paid plan; null otherwise. */
async function livePage(sql: Sql, slug: string): Promise<repo.ShownPageRow | null> {
  const page = await repo.shownPageBySlug(sql, slug);
  if (page === null || !(await gymHasLivePlan(sql, page.gymId))) return null;
  return page;
}

export async function publicPage(deps: Pick<GymPageDeps, "sql" | "robotCheck">, slug: string): Promise<PublicGymPage> {
  const page = await livePage(deps.sql, slug);
  if (page === null) throw notFound();
  const hours = await getGymHours(deps.sql, page.gymId);
  if (hours === null) throw notFound();
  return {
    name: page.name,
    city: page.city,
    orgType: orgTypeSchema.parse(page.orgType),
    about: page.about,
    facilities: known(page.facilities),
    ownFacilities: page.ownFacilities,
    // The week as the gym's members see it; the week a gym open all day keeps
    // aside for later is the console's alone.
    hours: { ...toGymHours(hours), savedWeek: [] },
    robotCheckKey: deps.robotCheck.siteKey,
  };
}

/** The member list's own rules for a name, email and phone, answered in the words a
 *  person filling the form reads. */
function visitorContact(
  body: GymEnquiryRequest,
  country: string | null,
): { fullName: string; email: string | null; phone: string | null } {
  try {
    return cleanContact({ fullName: body.fullName, email: body.email ?? null, phone: body.phone ?? null }, country);
  } catch (err) {
    if (!(err instanceof OrgsError)) throw err;
    const words: Record<string, string> = {
      needs_name: ENQUIRY_WORDS.needs_name,
      needs_contact: ENQUIRY_WORDS.needs_contact,
      bad_email: ENQUIRY_WORDS.bad_email,
      bad_phone: ENQUIRY_WORDS.bad_phone,
      card_number: ENQUIRY_WORDS.card_number,
    };
    throw new OrgsError(400, err.code, words[err.code] ?? ENQUIRY_WORDS.needs_contact);
  }
}

const sameAddress = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

/** A message from the form. A lead with its email (else its phone) keeps it, and is
 *  otherwise left as staff keep it: a stranger can type anybody's email, so the form
 *  never changes a lead's name, contact or status. Its "Happy to hear from us" is taken
 *  only for the email that lead already has. Nobody else is a lead yet: they become
 *  one, New, as the form's own. Answered `received` in every case. */
export async function sendEnquiry(deps: GymPageDeps, slug: string, body: GymEnquiryRequest, limit: Limit): Promise<"received" | null> {
  if (!(await limit())) return null;
  // The field no person sees: filled, it was a robot, and nothing is kept.
  if ((body.fax ?? "").trim() !== "") return "received";
  const checked = await deps.robotCheck.verify(body.robotToken);
  if (checked === "unavailable") throw new OrgsError(503, "robot_check_unavailable", ENQUIRY_WORDS.robot_unavailable);
  if (checked === "failed") throw new OrgsError(400, "robot_check_failed", ENQUIRY_WORDS.robot);

  const page = await livePage(deps.sql, slug);
  if (page === null) throw notFound();
  const contact = visitorContact(body, page.country);
  const message = (body.message ?? "").trim();
  if (holdsCard(message)) throw new OrgsError(400, "card_number", ENQUIRY_WORDS.card_number);
  const mayEmail = body.mayEmail === true;
  if (mayEmail && contact.email === null) throw new OrgsError(400, "needs_email", ENQUIRY_WORDS.needs_email);
  const source = body.source ?? null;
  const at = deps.now();

  await deps.sql.begin(async (tx) => {
    await lockGym(tx, page.gymId);
    const lead = await leadsRepo.lockLeadForContact(tx, page.gymId, contact);
    let leadId: string;
    if (lead !== null) {
      leadId = lead.id;
      if (mayEmail && lead.emailOkAt === null && sameAddress(contact.email, lead.email)) {
        const status = leadStatusSchema.parse(lead.status);
        await leadsRepo.writeLead(
          tx,
          page.gymId,
          lead.id,
          {
            fullName: lead.fullName,
            email: lead.email,
            phone: lead.phone,
            source: leadSourceSchema.parse(lead.source),
            notes: lead.notes,
            emailOkAt: at,
            status,
            entryId: lead.entryId,
            ...followUpValues({ status, emailOkAt: at, sent: lead.followUpsSent, lastAt: lead.followUpLastAt }, page.timezone),
          },
          at,
        );
      }
    } else {
      if ((await leadsRepo.countLeads(tx, page.gymId)) >= LEADS_MAX_PER_GYM) {
        throw new OrgsError(409, "enquiries_full", ENQUIRY_WORDS.full);
      }
      const okAt = mayEmail ? at : null;
      const inserted = await leadsRepo.insertLead(
        tx,
        page.gymId,
        {
          ...contact,
          source: source ?? "other",
          notes: "",
          emailOkAt: okAt,
          ...followUpValues({ status: "new", emailOkAt: okAt, sent: 0, lastAt: null }, page.timezone),
        },
        null,
        at,
      );
      leadId = inserted.id;
    }
    await leadsRepo.addEnquiry(tx, page.gymId, leadId, { ...contact, source, message, mayEmail }, at, GYM_ENQUIRIES_KEPT_PER_LEAD);
    await insertAudit(tx, {
      actorUserId: null,
      gymId: page.gymId,
      action: "org.lead_enquiry",
      targetType: "lead",
      targetId: leadId,
      meta: { lead: lead === null ? "new" : "existing", mayEmail: String(mayEmail) },
    });
  });
  return "received";
}
