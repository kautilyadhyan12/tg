// A GYM'S OWN PAGE, ITS PHOTOS AND ITS ENQUIRY FORM — spec Part 3 §16.3; ROADMAP
// 20c-iv-a, 20c-iv-b.
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
import { randomUUID } from "node:crypto";
import {
  ENQUIRY_WORDS,
  GYM_ENQUIRIES_KEPT_PER_LEAD,
  GYM_FACILITIES,
  GYM_PAGE_MAX_PHOTOS,
  GYM_PAGE_PHOTO_WORDS,
  type GymPagePhoto,
  type GymPageStaffPhoto,
  LEADS_MAX_PER_GYM,
  orgTypeSchema,
  typedFacility,
  type GymEnquiryRequest,
  type GymFacility,
  type GymPage,
  type PublicGymPage,
  type SetGymPageRequest,
} from "@app/shared";
import type { Sql } from "postgres";
import { dayInTz } from "../../gamification/streak.js";
import { getGymHours, gymHasLivePlan, insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege, toGymHours } from "../service.js";
import { holdsCard } from "../memberList/byHand.js";
import { lockGym } from "../memberList/repo.js";
import * as leadsRepo from "../leads/repo.js";
import { cleanContact, followUpValues } from "../leads/service.js";
import { cleanPhoto, type PhotoProblem } from "./photoBytes.js";
import { photoKey, type PhotoStore } from "./photoStore.js";
import * as repo from "./repo.js";
import type { RobotCheck } from "./robotCheck.js";

export interface GymPageDeps {
  sql: Sql;
  now: () => Date;
  robotCheck: RobotCheck;
  photos: PhotoStore;
  /** A file left behind after its row went is said here, never thrown at the person. */
  log: { warn: (obj: object, msg: string) => void };
  /** The key a lead's address is kept under, for the Leads list's email problems (20c-v-b). */
  addressKey: Buffer | null;
}

type Limit = () => Promise<boolean>;

const notFound = (): OrgsError => new OrgsError(404, "page_not_found", ENQUIRY_WORDS.not_found);

/** The form stops taking new people once the gym holds this many leads its page made that
 *  are still New: a tenth of the gym's 10,000, so staff always have room. */
export const PAGE_NEW_LEADS_MAX = 1000;

/** Messages a gym's page turned away in the last hour (it was busy), for its Leads page. */
export const pageTurnedAwayKey = (slug: string): string => `rl:gym_enquiry_turned_away:${slug}`;

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
    photos: shownPhotos(await repo.photosFor(deps.sql, gymId)),
    slug: org.slug,
    mayChange: privileges.includes("org.manage"),
  };
}

/** The photos as staff see them, with each one's upload key. */
const shownPhotos = (rows: readonly repo.PhotoRow[]): GymPageStaffPhoto[] =>
  rows.map((r) => ({ id: r.id, width: r.width, height: r.height, uploadKey: r.uploadKey }));
/** The photos as anybody sees them: the picture and its size, nothing else. */
const publicPhotos = (rows: readonly repo.PhotoRow[]): GymPagePhoto[] => rows.map((r) => ({ id: r.id, width: r.width, height: r.height }));

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
  return { ...page, facilities: known(page.facilities), photos: shownPhotos(await repo.photosFor(deps.sql, gymId)), slug: org.slug, mayChange: true };
}

// ── PHOTOS (20c-iv-b) ─────────────────────────────────────────────────────────
//
// Only the owner's `org.manage` adds, removes or moves one; staff with the Leads gate
// see them. A photo is cleaned (`photoBytes.ts`) before anything is stored: what is
// kept is the picture, never where it was taken.

const PHOTO_PROBLEM_STATUS: Record<PhotoProblem, { code: string; message: string }> = {
  too_big: { code: "photo_too_big", message: GYM_PAGE_PHOTO_WORDS.too_big },
  not_a_photo: { code: "photo_not_a_photo", message: GYM_PAGE_PHOTO_WORDS.not_a_photo },
  damaged: { code: "photo_damaged", message: GYM_PAGE_PHOTO_WORDS.damaged },
  too_many_pixels: { code: "photo_too_large", message: GYM_PAGE_PHOTO_WORDS.too_many_pixels },
};

/** Removes files whose rows are gone. A file that will not go is left and said in the
 *  log: nothing points at it, so nobody can be shown it. */
async function removeFiles(deps: Pick<GymPageDeps, "photos" | "log">, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await deps.photos.remove(key);
    } catch (err) {
      deps.log.warn({ event: "gym_page.photo_left_behind", err }, "a removed photo's file could not be deleted");
    }
  }
}

export async function addPhoto(
  deps: GymPageDeps,
  userId: string,
  gymId: string,
  bytes: Uint8Array,
  uploadKey: string,
  limit: Limit,
): Promise<GymPageStaffPhoto | null> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  // Sent before (its reply lost on the way back): the photo already kept, nothing more.
  const kept = await repo.photoByUploadKey(deps.sql, gymId, uploadKey);
  if (kept !== null) return shownPhotos([kept])[0] ?? null;
  const read = cleanPhoto(bytes);
  if (!read.ok) {
    const problem = PHOTO_PROBLEM_STATUS[read.problem];
    throw new OrgsError(400, problem.code, problem.message);
  }
  // A quick answer for a full page before the file is written; the count under the lock
  // below is the one that decides.
  if ((await repo.photosFor(deps.sql, gymId)).length >= GYM_PAGE_MAX_PHOTOS) {
    throw new OrgsError(409, "photos_full", GYM_PAGE_PHOTO_WORDS.full);
  }
  const id = randomUUID();
  const key = photoKey(gymId, id, read.type);
  await deps.photos.put(key, read.bytes);
  let photo: GymPageStaffPhoto;
  try {
    photo = await deps.sql.begin(async (tx) => {
      await lockGym(tx, gymId);
      // The same key sent twice at once: the second waits here and finds the first.
      const first = await repo.photoByUploadKey(tx, gymId, uploadKey);
      if (first !== null) {
        await removeFiles(deps, [key]);
        return { id: first.id, width: first.width, height: first.height, uploadKey };
      }
      const count = (await repo.photosFor(tx, gymId)).length;
      if (count >= GYM_PAGE_MAX_PHOTOS) throw new OrgsError(409, "photos_full", GYM_PAGE_PHOTO_WORDS.full);
      await repo.insertPhoto(
        tx,
        gymId,
        { id, storageKey: key, contentType: read.type, byteSize: read.bytes.length, width: read.width, height: read.height, position: count, uploadKey },
        userId,
        deps.now(),
      );
      await insertAudit(tx, { actorUserId: userId, gymId, action: "org.page_photo_added", targetType: "gym", targetId: gymId, meta: { photo: id } });
      return { id, width: read.width, height: read.height, uploadKey };
    });
  } catch (err) {
    await removeFiles(deps, [key]);
    throw err;
  }
  return photo;
}

export async function removePhoto(deps: GymPageDeps, userId: string, gymId: string, photoId: string, limit: Limit): Promise<GymPageStaffPhoto[] | null> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  const { key, photos } = await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const removed = await repo.deletePhoto(tx, gymId, photoId);
    if (removed === null) throw new OrgsError(404, "photo_not_found", GYM_PAGE_PHOTO_WORDS.not_found);
    const left = await repo.photosFor(tx, gymId);
    await repo.setPhotoOrder(
      tx,
      gymId,
      left.map((p) => p.id),
    );
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.page_photo_removed", targetType: "gym", targetId: gymId, meta: { photo: photoId } });
    return { key: removed, photos: left };
  });
  await removeFiles(deps, [key]);
  return shownPhotos(photos);
}

/** The page's photos in a new order. The list must be exactly the photos the page has
 *  now: one added or removed elsewhere in the meantime is refused, never guessed at. */
export async function orderPhotos(deps: GymPageDeps, userId: string, gymId: string, photoIds: readonly string[], limit: Limit): Promise<GymPageStaffPhoto[] | null> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");
  if (!(await limit())) return null;
  const photos = await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const now = await repo.photosFor(tx, gymId);
    // Every photo named, and (the request's schema refuses an id twice) no other.
    const same = now.length === photoIds.length && now.every((p) => photoIds.includes(p.id));
    if (!same) throw new OrgsError(409, "photos_changed", GYM_PAGE_PHOTO_WORDS.changed);
    await repo.setPhotoOrder(tx, gymId, photoIds);
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.page_photos_ordered", targetType: "gym", targetId: gymId, meta: {} });
    return await repo.photosFor(tx, gymId);
  });
  return shownPhotos(photos);
}

export interface PhotoFile {
  contentType: string;
  bytes: Uint8Array;
}

async function fileFor(deps: Pick<GymPageDeps, "sql" | "photos">, gymId: string, photoId: string): Promise<PhotoFile | null> {
  const photo = await repo.photoOf(deps.sql, gymId, photoId);
  if (photo === null) return null;
  const bytes = await deps.photos.get(photo.storageKey);
  return bytes === null ? null : { contentType: photo.contentType, bytes };
}

/** A photo for staff, whether the page is on or off. */
export async function staffPhoto(deps: GymPageDeps, userId: string, gymId: string, photoId: string, limit: Limit): Promise<PhotoFile | null> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");
  if (!(await limit())) return null;
  const file = await fileFor(deps, gymId, photoId);
  if (file === null) throw new OrgsError(404, "photo_not_found", GYM_PAGE_PHOTO_WORDS.not_found);
  return file;
}

/** A photo on a page that is on: the same 404 as the page for anything else. */
export async function publicPhoto(deps: GymPageDeps, slug: string, photoId: string): Promise<PhotoFile> {
  const page = await livePage(deps.sql, slug);
  if (page === null) throw notFound();
  const file = await fileFor(deps, page.gymId, photoId);
  if (file === null) throw notFound();
  return file;
}

/** A page switched on, of an open gym on a trial or a paid plan; null otherwise. */
async function livePage(sql: Sql, slug: string): Promise<repo.ShownPageRow | null> {
  const page = await repo.shownPageBySlug(sql, slug);
  if (page === null || !(await gymHasLivePlan(sql, page.gymId))) return null;
  return page;
}

export async function publicPage(deps: Pick<GymPageDeps, "sql" | "robotCheck" | "now">, slug: string): Promise<PublicGymPage> {
  const page = await livePage(deps.sql, slug);
  if (page === null) throw notFound();
  const hours = await getGymHours(deps.sql, page.gymId);
  if (hours === null) throw notFound();
  const gymHours = toGymHours(hours);
  const today = dayInTz(deps.now(), page.timezone);
  return {
    name: page.name,
    city: page.city,
    orgType: orgTypeSchema.parse(page.orgType),
    about: page.about,
    facilities: known(page.facilities),
    ownFacilities: page.ownFacilities,
    photos: publicPhotos(await repo.photosFor(deps.sql, page.gymId)),
    // The week as the gym's members see it; the week a gym open all day keeps
    // aside for later is the console's alone.
    // Only today's closure: the notes further ahead were written for members.
    hours: { ...gymHours, savedWeek: [], closures: gymHours.closures.filter((closure) => closure.day === today) },
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

/** A message from the form. A lead with its email (else its phone) keeps it, and is
 *  left exactly as staff keep it: a stranger can type anybody's email, so the form never
 *  changes a lead's name, contact, status or "Happy to hear from us" — the person's tick
 *  is kept on the message, for staff to act on. Nobody else is a lead yet: they become
 *  one, New, as the form's own, ticked by their own tick. Answered `received` in every
 *  case, and a full gym refuses everybody alike, so the reply never says who a gym has.
 *
 *  Order: this address's failed robot checks at this page (too many, and it is refused
 *  before the check is asked again), the hidden field, the robot check (a failure counted
 *  apart), then the address's allowance and the page's own, the write. Only a send that
 *  passed the robot check spends either allowance, so robots cannot use them up for the
 *  people who come after them (the security pass over 20c, 2026-09-30). */
export async function sendEnquiry(
  deps: GymPageDeps,
  slug: string,
  body: GymEnquiryRequest,
  limits: { robotRoom: Limit; robotFailed: () => Promise<void>; address: Limit; page: () => Promise<boolean> },
): Promise<"received" | null> {
  if (!(await limits.robotRoom())) return null;
  // The field no person sees: filled, it was a robot, and nothing is kept.
  if ((body.trap ?? "").trim() !== "") {
    await limits.robotFailed();
    return "received";
  }
  const checked = await deps.robotCheck.verify(body.robotToken, "enquiry");
  if (checked === "unavailable") throw new OrgsError(503, "robot_check_unavailable", ENQUIRY_WORDS.robot_unavailable);
  if (checked === "failed") {
    await limits.robotFailed();
    throw new OrgsError(400, "robot_check_failed", ENQUIRY_WORDS.robot);
  }
  if (!(await limits.address())) return null;

  const page = await livePage(deps.sql, slug);
  if (page === null) throw notFound();
  const contact = visitorContact(body, page.country);
  const message = (body.message ?? "").trim();
  if (holdsCard(message)) throw new OrgsError(400, "card_number", ENQUIRY_WORDS.card_number);
  const mayEmail = body.mayEmail === true;
  if (mayEmail && contact.email === null) throw new OrgsError(400, "needs_email", ENQUIRY_WORDS.needs_email);
  if (!(await limits.page())) throw new OrgsError(429, "page_busy", ENQUIRY_WORDS.page_busy);
  const source = body.source ?? null;
  const at = deps.now();

  await deps.sql.begin(async (tx) => {
    await lockGym(tx, page.gymId);
    // Before anybody is looked up: a full gym answers everybody the same. The form has a
    // ceiling of its own, far under the gym's, so a flood of it can never leave staff
    // unable to add a walk-in (the security pass over 20c, 2026-09-30).
    if (
      (await leadsRepo.countLeads(tx, page.gymId)) >= LEADS_MAX_PER_GYM ||
      (await leadsRepo.countPageNewLeads(tx, page.gymId)) >= PAGE_NEW_LEADS_MAX
    ) {
      throw new OrgsError(409, "enquiries_full", ENQUIRY_WORDS.full);
    }
    const lead = await leadsRepo.lockLeadForContact(tx, page.gymId, contact);
    let leadId: string;
    if (lead !== null) {
      leadId = lead.id;
    } else {
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
        deps.addressKey,
        at,
        true,
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
