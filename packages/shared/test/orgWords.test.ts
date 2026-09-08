// THE VOCABULARY EVERY SCREEN AND THE API READ (roadmap 2b, Part 3 §2.2).
//
// These are not style assertions. Each one pins a sentence somebody reads: a
// studio owner opening their console, a personal trainer's client at the join
// door, and — for the fallback — anybody at all during the seconds before an
// org row has arrived.
import { describe, expect, it } from "vitest";
import { ORG_TYPES_PHRASE, orgTypeSchema, orgWords } from "../src/index.js";

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
      expect(orgWords(type).itToMembers, type).not.toBe("");
    }
    // Not merely non-empty: `personal_trainer` must not have quietly become the
    // gym's row, which is what an unlisted type gets.
    expect(orgWords("studio").it).not.toBe(orgWords("gym").it);
    expect(orgWords("personal_trainer").it).not.toBe(orgWords("gym").it);
  });

  it("names all three creatable types where there is no org to name", () => {
    // The front door, the join screen and the refusal for a code that matched
    // nothing. `clinic` is absent because none can be created.
    expect(ORG_TYPES_PHRASE).toBe("gym, studio or trainer");
  });
});
