// THE WORDS AN ORGANISATION IS SPOKEN OF IN — one table, read by the API and by
// every screen, so a studio is never called a gym on one page and a studio on
// the next.
//
// Part 3 §2.2 ("Vocabulary overrides … applied by org_type through the same
// message-key system as the member app — zero forked screens") and Kd's ruling
// of 2026-09-07 (organisation types are gym, studio and personal trainer; *"a
// trainer's clients join by code like members"*).
//
// **IT LIVES IN `@app/shared` BECAUSE THE SERVER SPEAKS TOO.** The join door's
// refusals — "Ask the gym for a current one" — are written by the API and
// printed verbatim by the client (`JoinGymPanel`'s own comment records that).
// A second table on the web would be a second answer to "what is this place
// called", and the two would drift the first time either side gained a type.
//
// **THE WORDS ARE NOT A SCHEMA AND PARSE NOTHING.** `orgWords` takes whatever
// it is handed and always answers: an org type this build has never heard of
// gets the gym's words rather than a blank, because a missing noun would put
// "Loading your …" on screen, and the gym is the type every other one was
// written as a variation of.
import type { OrgType } from "./orgs.js";

/** One organisation's vocabulary.
 *
 *  **`it` AND `itToMembers` ARE TWO WORDS FOR ONE THING AND THE SPLIT IS
 *  LOAD-BEARING.** A personal trainer runs a *business* — that is what the
 *  create screen has called it since 2026-09-08 — but nobody joins a business:
 *  their client joined a *trainer*. So the console says "your business" and the
 *  member's screens say "the trainer", and a single noun would be wrong on one
 *  side or the other. For a gym and a studio the two are the same word, which
 *  is why the difference is easy to miss when adding a type. */
export interface OrgWords {
  /** What its owner runs, lower case: *"Loading your gym…"*. */
  readonly it: string;
  /** The same word starting a heading: *"Gym console"*, *"Gym details"*. */
  readonly itCap: string;
  /** What a member joined, lower case: *"Ask the studio for a current one."*. */
  readonly itToMembers: string;
  /** The same word starting a sentence: *"Your trainer is closed today."*. */
  readonly itToMembersCap: string;
  /** More than one, for a member's list of places: *"My boxes"*. */
  readonly itToMembersPlural: string;
  readonly itToMembersPluralCap: string;
  /** One of the people: *"They stay a client of your studio."* */
  readonly person: string;
  /** Starting a sentence or heading: *"Client"*. */
  readonly personCap: string;
  /** All of them: *"Give this code to your clients."* */
  readonly people: string;
  /** The roster's heading: *"Clients"*. */
  readonly peopleCap: string;
  /** The staff role that is not the owner or a manager (§2.2: gym Trainer,
   *  studio Coach). Lower case, inside a sentence. */
  readonly coach: string;
  /** The role as a label on a button or a badge: *"Coach"*. */
  readonly coachCap: string;
  /** The third role, more than one: "trainers", "instructors". */
  readonly coaches: string;
  /** The same, as a heading: *"Instructors"*. */
  readonly coachesCap: string;
  /** What the create screen calls the name box. */
  readonly nameLabel: string;
  /** An example name, shown greyed in that box. */
  readonly placeholder: string;
}

const GYM: OrgWords = {
  it: "gym",
  itCap: "Gym",
  itToMembers: "gym",
  itToMembersCap: "Gym",
  itToMembersPlural: "gyms",
  itToMembersPluralCap: "Gyms",
  person: "member",
  personCap: "Member",
  people: "members",
  peopleCap: "Members",
  coach: "trainer",
  coaches: "trainers",
  coachesCap: "Trainers",
  coachCap: "Trainer",
  nameLabel: "Gym name",
  placeholder: "Iron House",
};

const STUDIO: OrgWords = {
  it: "studio",
  itCap: "Studio",
  itToMembers: "studio",
  itToMembersCap: "Studio",
  itToMembersPlural: "studios",
  itToMembersPluralCap: "Studios",
  person: "client",
  personCap: "Client",
  people: "clients",
  peopleCap: "Clients",
  coach: "coach",
  coaches: "coaches",
  coachesCap: "Coaches",
  coachCap: "Coach",
  nameLabel: "Studio name",
  placeholder: "Flow Studio",
};

/** Kd's five kinds of business (2026-10-16, ROADMAP 5f): a CrossFit's members and
 *  coaches (members, as Wodify calls them: Kd, 5f-ii), a Pilates studio's clients and
 *  instructors. A yoga studio has members and
 *  trainers, as a gym does (Kd: "it is not a school"). Each is called by its own name,
 *  never "box" or a bare "studio" (Kd, 5f-iv): "CrossFit gym" inside a sentence. */
const CROSSFIT_BOX: OrgWords = {
  it: "CrossFit gym",
  itCap: "CrossFit gym",
  itToMembers: "CrossFit gym",
  itToMembersCap: "CrossFit gym",
  itToMembersPlural: "CrossFit gyms",
  itToMembersPluralCap: "CrossFit gyms",
  person: "member",
  personCap: "Member",
  people: "members",
  peopleCap: "Members",
  coach: "coach",
  coaches: "coaches",
  coachesCap: "Coaches",
  coachCap: "Coach",
  nameLabel: "Gym name",
  placeholder: "Steel City CrossFit",
};

const YOGA_STUDIO: OrgWords = {
  it: "yoga studio",
  itCap: "Yoga studio",
  itToMembers: "yoga studio",
  itToMembersCap: "Yoga studio",
  itToMembersPlural: "yoga studios",
  itToMembersPluralCap: "Yoga studios",
  person: "member",
  personCap: "Member",
  people: "members",
  peopleCap: "Members",
  coach: "trainer",
  coaches: "trainers",
  coachesCap: "Trainers",
  coachCap: "Trainer",
  nameLabel: "Studio name",
  placeholder: "Lotus Yoga",
};

const PILATES_STUDIO: OrgWords = {
  it: "Pilates studio",
  itCap: "Pilates studio",
  itToMembers: "Pilates studio",
  itToMembersCap: "Pilates studio",
  itToMembersPlural: "Pilates studios",
  itToMembersPluralCap: "Pilates studios",
  person: "client",
  personCap: "Client",
  people: "clients",
  peopleCap: "Clients",
  coach: "instructor",
  coaches: "instructors",
  coachesCap: "Instructors",
  coachCap: "Instructor",
  nameLabel: "Studio name",
  placeholder: "Core Pilates",
};

/** Closed at sign-up on 2026-10-16 (Kd: a trainer working alone is not a kind of
 *  business any more); its words stay for a business already made. */
const PERSONAL_TRAINER: OrgWords = {
  it: "business",
  itCap: "Business",
  itToMembers: "trainer",
  itToMembersCap: "Trainer",
  itToMembersPlural: "trainers",
  itToMembersPluralCap: "Trainers",
  person: "client",
  personCap: "Client",
  people: "clients",
  peopleCap: "Clients",
  coach: "coach",
  coaches: "coaches",
  coachesCap: "Coaches",
  coachCap: "Coach",
  nameLabel: "Your business name",
  placeholder: "Coach Priya",
};

/** Kd's ruling of 2026-08-18 shut the door on NEW clinics (`createOrgTypeSchema`
 *  refuses one), and `orgTypeSchema` still reads the value because a row could
 *  exist. Its words exist for the same reason the parse does: a row that can be
 *  read has to be shown in words somebody understands. §2.2's clinic column is
 *  Clients / Sessions / Clinician. */
const CLINIC: OrgWords = {
  it: "clinic",
  itCap: "Clinic",
  itToMembers: "clinic",
  itToMembersCap: "Clinic",
  itToMembersPlural: "clinics",
  itToMembersPluralCap: "Clinics",
  person: "client",
  personCap: "Client",
  people: "clients",
  peopleCap: "Clients",
  coach: "clinician",
  coaches: "clinicians",
  coachesCap: "Clinicians",
  coachCap: "Clinician",
  nameLabel: "Clinic name",
  placeholder: "Green Lane Practice",
};

/** **TYPED BY `OrgType`, so a type added to the schema without words is a
 *  COMPILE ERROR rather than a screen quietly saying "gym" to a studio.** That
 *  is the whole reason this is a `Record` over the union and not a loose map. */
const BY_TYPE: Readonly<Record<OrgType, OrgWords>> = {
  gym: GYM,
  studio: STUDIO,
  crossfit_box: CROSSFIT_BOX,
  yoga_studio: YOGA_STUDIO,
  pilates_studio: PILATES_STUDIO,
  personal_trainer: PERSONAL_TRAINER,
  clinic: CLINIC,
};

function known(orgType: unknown): orgType is OrgType {
  return typeof orgType === "string" && Object.hasOwn(BY_TYPE, orgType);
}

/** The words for this org type — the gym's for anything unreadable.
 *
 *  Takes `unknown` on purpose: the web calls it with whatever came off the wire
 *  (`org?.orgType`, which is `undefined` while a read is in flight), and a
 *  screen mid-load must draw a sentence rather than throw. */
export function orgWords(orgType: unknown): OrgWords {
  return known(orgType) ? BY_TYPE[orgType] : GYM;
}

/** "a trainer", "an instructor": one of the staff role, inside a sentence. */
export function aCoach(orgType: unknown): string {
  const { coach } = orgWords(orgType);
  return /^[aeiou]/.test(coach) ? `an ${coach}` : `a ${coach}`;
}

/** WHAT TO SAY WHEN THERE IS NO ORGANISATION TO NAME — the front door, the join
 *  screen, and the refusal for a code that matched nothing.
 *
 *  Those three places cannot look a type up: two of them run before anybody has
 *  typed a code, and the third is the answer to a code that belongs to nobody.
 *  Kept here so the three read the same. The five kinds of business (2026-10-16) are a
 *  gym or a studio to somebody who has not joined one yet: a CrossFit box is a gym. */
export const ORG_TYPES_PHRASE = "gym or studio";
