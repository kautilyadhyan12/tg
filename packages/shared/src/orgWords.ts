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
  person: "member",
  personCap: "Member",
  people: "members",
  peopleCap: "Members",
  coach: "trainer",
  coachCap: "Trainer",
  nameLabel: "Gym name",
  placeholder: "Iron House",
};

const STUDIO: OrgWords = {
  it: "studio",
  itCap: "Studio",
  itToMembers: "studio",
  itToMembersCap: "Studio",
  person: "client",
  personCap: "Client",
  people: "clients",
  peopleCap: "Clients",
  coach: "coach",
  coachCap: "Coach",
  nameLabel: "Studio name",
  placeholder: "Flow Studio",
};

const PERSONAL_TRAINER: OrgWords = {
  it: "business",
  itCap: "Business",
  itToMembers: "trainer",
  itToMembersCap: "Trainer",
  person: "client",
  personCap: "Client",
  people: "clients",
  peopleCap: "Clients",
  coach: "coach",
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
  person: "client",
  personCap: "Client",
  people: "clients",
  peopleCap: "Clients",
  coach: "clinician",
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

/** WHAT TO SAY WHEN THERE IS NO ORGANISATION TO NAME — the front door, the join
 *  screen, and the refusal for a code that matched nothing.
 *
 *  Those three places cannot look a type up: two of them run before anybody has
 *  typed a code, and the third is the answer to a code that belongs to nobody.
 *  Kept here so the three read the same, and so adding a fourth type is one
 *  edit. `personal_trainer` is "trainer" here, matching what a member joined. */
export const ORG_TYPES_PHRASE = "gym, studio or trainer";
