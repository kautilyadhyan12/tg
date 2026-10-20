// THE VOCABULARY EVERY SCREEN AND THE API READ (roadmap 2b, Part 3 §2.2).
//
// These are not style assertions. Each one pins a sentence somebody reads: a
// studio owner opening their console, a personal trainer's client at the join
// door, and — for the fallback — anybody at all during the seconds before an
// org row has arrived.
import { describe, expect, it } from "vitest";
import { ORG_TYPES_PHRASE, aCoach, orgTypeSchema, orgWords, ptMemberWords, ptTimeOffOverMessage, ptWords } from "../src/index.js";

describe("orgWords", () => {
  it("gives a gym its own words, unchanged from before this card", () => {
    const words = orgWords("gym");
    expect(words.it).toBe("gym");
    expect(words.itCap).toBe("Gym");
    expect(words.itToMembers).toBe("gym");
    expect(words.person).toBe("member");
    expect(words.people).toBe("members");
    expect(words.peopleCap).toBe("Members");
    expect(words.coachCap).toBe("Trainer");
    expect(words.nameLabel).toBe("Gym name");
  });

  it("gives a studio clients and a coach — §2.2's vocabulary row", () => {
    const words = orgWords("studio");
    expect(words.it).toBe("studio");
    expect(words.itCap).toBe("Studio");
    expect(words.itToMembers).toBe("studio");
    expect(words.person).toBe("client");
    expect(words.people).toBe("clients");
    expect(words.peopleCap).toBe("Clients");
    expect(words.coachCap).toBe("Coach");
    expect(words.nameLabel).toBe("Studio name");
  });

  /** **THE ONE TYPE WITH TWO NOUNS, and this is the test that would catch
   *  either half being dropped.** A personal trainer runs a *business* and
   *  their client joined a *trainer*; one word in both places is wrong on one
   *  side. Nobody joins a business, and no owner calls their console "Trainer
   *  console". */
  it("calls a personal trainer's org a business to its owner and a trainer to its clients", () => {
    const words = orgWords("personal_trainer");
    expect(words.it).toBe("business");
    expect(words.itCap).toBe("Business");
    expect(words.itToMembers).toBe("trainer");
    expect(words.itToMembersCap).toBe("Trainer");
    expect(words.person).toBe("client");
    expect(words.coachCap).toBe("Coach");
    expect(words.nameLabel).toBe("Your business name");
  });

  /** A clinic cannot be CREATED (`createOrgTypeSchema` refuses one) and can
   *  still be READ, so it must have words rather than fall through to the gym's
   *  — a clinic's people are clients, and §2.2 calls its third role a
   *  clinician. */
  it("still speaks for a clinic, which can exist as a row even though none can be made", () => {
    expect(orgWords("clinic").person).toBe("client");
    expect(orgWords("clinic").coachCap).toBe("Clinician");
  });

  /** THE FALLBACK IS THE GYM'S WORDS AND IT IS LOAD-BEARING: every screen calls
   *  this while the org row is still in flight (`org?.orgType` is `undefined`
   *  then), and a blank noun would put "Loading your …" on screen. */
  it("answers with the gym's words for anything it cannot read", () => {
    for (const value of [undefined, null, "", "franchise", 7, {}]) {
      expect(orgWords(value).it).toBe("gym");
      expect(orgWords(value).people).toBe("members");
    }
  });

  /** **EVERY TYPE THE PARSER ACCEPTS HAS WORDS.** The table is typed by
   *  `OrgType`, so this cannot fail without somebody having deleted the typing
   *  — which is exactly the edit that would silently give a new type the gym's
   *  vocabulary. */
  it("has a distinct entry for every org type the schema parses", () => {
    for (const type of orgTypeSchema.options) {
      expect(orgWords(type).it, type).not.toBe("");
      expect(orgWords(type).coaches, type).toBe(`${orgWords(type).coach}${orgWords(type).coach.endsWith("h") ? "es" : "s"}`);
      expect(orgWords(type).itToMembers, type).not.toBe("");
    }
    // Not merely non-empty: `personal_trainer` must not have quietly become the
    // gym's row, which is what an unlisted type gets.
    expect(orgWords("studio").it).not.toBe(orgWords("gym").it);
    expect(orgWords("personal_trainer").it).not.toBe(orgWords("gym").it);
  });

  /** The worst 5f-ii could do: a refusal or a heading that reads "undefined", "a instructor"
   *  or a gym's word for one of the other kinds. Every kind a row can hold, and one this
   *  build has never heard of. */
  it("says every personal training refusal whole, in each kind's word for its staff", () => {
    const rows: [unknown, string, string, string][] = [
      ["gym", "trainer", "a trainer", "Trainers"],
      ["studio", "coach", "a coach", "Coaches"],
      ["crossfit_box", "coach", "a coach", "Coaches"],
      ["yoga_studio", "trainer", "a trainer", "Trainers"],
      ["pilates_studio", "instructor", "an instructor", "Instructors"],
      ["personal_trainer", "coach", "a coach", "Coaches"],
      ["clinic", "clinician", "a clinician", "Clinicians"],
      ["climbing_wall", "trainer", "a trainer", "Trainers"],
      [undefined, "trainer", "a trainer", "Trainers"],
    ];
    for (const [type, coach, a, heading] of rows) {
      const label = String(type);
      expect(orgWords(type).coach, label).toBe(coach);
      expect(aCoach(type), label).toBe(a);
      expect(orgWords(type).coachesCap, label).toBe(heading);
      const said = [...Object.values(ptWords(type)), ...Object.values(ptMemberWords(type)), ptTimeOffOverMessage(type)];
      for (const line of said) {
        expect(line, label).not.toMatch(/undefined|null|\ba [aeiou]/u);
        expect(line, label).toMatch(/^[A-Z].*[.]$/u);
      }
      const others = ["trainer", "coach", "instructor", "clinician"].filter((w) => w !== coach);
      for (const line of said) for (const w of others) expect(line, label).not.toMatch(new RegExp(`\\b${w}s?\\b`, "u"));
      expect(ptWords(type).trainer_off, label).toBe(`This ${coach} has time off at that time.`);
      expect(ptWords(type).trainer_in_class, label).toBe(`This ${coach} has a class at that time.`);
      expect(ptWords(type).time_off_too_many, label).toBe(`${a.charAt(0).toUpperCase()}${a.slice(1)} can have up to 50 times off coming. Remove one first.`);
      expect(ptMemberWords(type).trainer_not_offering, label).toBe(`This ${coach} isn't taking personal training sessions right now.`);
    }
    // The person list is the kind's own: a Pilates studio's clients.
    expect(ptWords("pilates_studio").person_not_found).toBe("That person isn't on your client list.");
    expect(ptWords("crossfit_box").person_not_found).toBe("That person isn't on your member list.");
  });

  /** The worst 5f-iv could do: a yoga or Pilates studio's people told "the studio", or a
   *  CrossFit's told "the box" (Kd, 2026-10-19: each kind is called by its own name). Every
   *  word of every kind's set, read whole, for each kind a row can hold. */
  it("calls each kind by its own name, never a box or a bare studio", () => {
    const rows: [string, string, string, string, string, string][] = [
      ["gym", "gym", "Gym", "gyms", "members", "Gym name"],
      ["studio", "studio", "Studio", "studios", "clients", "Studio name"],
      ["crossfit_box", "CrossFit gym", "CrossFit gym", "CrossFit gyms", "members", "Gym name"],
      ["yoga_studio", "yoga studio", "Yoga studio", "yoga studios", "members", "Studio name"],
      ["pilates_studio", "Pilates studio", "Pilates studio", "Pilates studios", "clients", "Studio name"],
    ];
    for (const [type, it, itCap, plural, people, nameLabel] of rows) {
      const words = orgWords(type);
      expect(words.it, type).toBe(it);
      expect(words.itCap, type).toBe(itCap);
      expect(words.itToMembers, type).toBe(it);
      expect(words.itToMembersCap, type).toBe(itCap);
      expect(words.itToMembersPlural, type).toBe(plural);
      expect(words.itToMembersPluralCap, type).toBe(itCap.replace(/$/u, "s"));
      expect(words.people, type).toBe(people);
      expect(words.nameLabel, type).toBe(nameLabel);
    }
    for (const type of orgTypeSchema.options) {
      for (const word of Object.values(orgWords(type))) {
        expect(word, type).not.toMatch(/box(es)?/iu);
        expect(word, type).not.toMatch(/pilates/u);
        if (type === "yoga_studio" || type === "pilates_studio") expect(word, type).not.toMatch(/^studios?$/iu);
      }
    }
    // Their staff words are unchanged: a CrossFit's coaches, a yoga studio's trainers.
    expect(orgWords("crossfit_box").coaches).toBe("coaches");
    expect(orgWords("yoga_studio").coaches).toBe("trainers");
    expect(orgWords("pilates_studio").coaches).toBe("instructors");
  });

  it("names a gym or studio where there is no org to name", () => {
    // The front door, the join screen and the refusal for a code that matched
    // nothing. A CrossFit is a gym; a trainer working alone can no longer be made.
    expect(ORG_TYPES_PHRASE).toBe("gym or studio");
  });
});
