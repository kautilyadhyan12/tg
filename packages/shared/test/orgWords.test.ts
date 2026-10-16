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
      expect(ptWords(type).time_off_too_many, label).toBe(`${a.charAt(0).toUpperCase()}${a.slice(1)} can have up to 50 times off coming. Remove one first.`);
      expect(ptMemberWords(type).trainer_not_offering, label).toBe(`This ${coach} isn't taking personal training sessions right now.`);
    }
    // The person list is the kind's own: a Pilates studio's clients.
    expect(ptWords("pilates_studio").person_not_found).toBe("That person isn't on your client list.");
    expect(ptWords("crossfit_box").person_not_found).toBe("That person isn't on your member list.");
  });

  /** Kd's five kinds of business (2026-10-16), each in the words its own software uses. */
  it("speaks for a CrossFit box, a yoga studio and a Pilates studio in their own words", () => {
    // A yoga studio has members and trainers, as a gym does (Kd: "it is not a school"); a
    // CrossFit box has members and coaches (Kd, 5f-ii: members, as Wodify says).
    const rows: [string, string, string, string, string, string][] = [
      ["crossfit_box", "box", "members", "Coach", "coaches", "Box name"],
      ["yoga_studio", "studio", "members", "Trainer", "trainers", "Studio name"],
      ["pilates_studio", "studio", "clients", "Instructor", "instructors", "Studio name"],
    ];
    for (const [type, it, people, coachCap, coaches, nameLabel] of rows) {
      const words = orgWords(type);
      expect(words.it, type).toBe(it);
      expect(words.itToMembers, type).toBe(it);
      expect(words.itToMembersPlural, type).toBe(type === "crossfit_box" ? "boxes" : "studios");
      expect(words.people, type).toBe(people);
      expect(words.peopleCap, type).toBe(people.charAt(0).toUpperCase() + people.slice(1));
      expect(words.coachCap, type).toBe(coachCap);
      expect(words.coaches, type).toBe(coaches);
      expect(words.nameLabel, type).toBe(nameLabel);
    }
  });

  it("names a gym or studio where there is no org to name", () => {
    // The front door, the join screen and the refusal for a code that matched
    // nothing. A CrossFit box is a gym; a trainer working alone can no longer be made.
    expect(ORG_TYPES_PHRASE).toBe("gym or studio");
  });
});
