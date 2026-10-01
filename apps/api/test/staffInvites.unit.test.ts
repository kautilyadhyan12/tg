// decideStaffSend — may a staff invitation email go now? (ROADMAP 4a-i.) Every class of
// case, one fact changed from an email that may go.
import { describe, expect, it } from "vitest";
import { STAFF_INVITE_EMAIL_REASON_WORDS, staffInviteEmailReasonSchema } from "@app/shared";
import { decideStaffSend, type StaffSendFacts } from "../src/modules/orgs/staffInvites/decide.js";

const openGym = { active: true, onPlan: true, stopped: false, named: true };
const allows: StaffSendFacts = {
  inviteOpen: true,
  gym: openGym,
  suppression: null,
  addressValid: true,
  mail: "accepts",
};

describe("decideStaffSend — every class of case", () => {
  const cases: [string, Partial<StaffSendFacts>, ReturnType<typeof decideStaffSend>][] = [
    ["the gym is gone", { gym: null }, { kind: "skip", reason: "gym_not_active" }],
    ["the gym is closed", { gym: { ...openGym, active: false } }, { kind: "skip", reason: "gym_not_active" }],
    ["the gym has no plan", { gym: { ...openGym, onPlan: false } }, { kind: "skip", reason: "gym_not_active" }],
    ["the gym's sending is stopped", { gym: { ...openGym, stopped: true } }, { kind: "skip", reason: "sending_stopped" }],
    ["the gym's name cannot go in an email", { gym: { ...openGym, named: false } }, { kind: "skip", reason: "gym_name" }],
    ["cancelled, answered or ended", { inviteOpen: false }, { kind: "skip", reason: "invitation_closed" }],
    ["the address bounces", { suppression: "bounced" }, { kind: "skip", reason: "bounced" }],
    ["the provider refuses the address", { suppression: "refused" }, { kind: "skip", reason: "refused" }],
    ["they marked this gym's email as spam", { suppression: "complained" }, { kind: "skip", reason: "complained" }],
    ["they unsubscribed from this gym", { suppression: "unsubscribed" }, { kind: "skip", reason: "unsubscribed" }],
    ["the address is not one", { addressValid: false }, { kind: "skip", reason: "bad_address" }],
    ["its domain takes no email", { mail: "no_mail" }, { kind: "skip", reason: "no_mail_domain" }],
    ["its domain could not be asked", { mail: "unknown" }, { kind: "retry", reason: "dns_unavailable" }],
    ["its domain has not been asked yet", { mail: null }, { kind: "check_mail" }],
    ["everything allows it", {}, { kind: "send" }],
  ];
  for (const [name, change, expected] of cases) {
    it(name, () => {
      expect(decideStaffSend({ ...allows, ...change })).toEqual(expected);
    });
  }

  it("a closed invitation is never sent, whatever else is true", () => {
    for (const mail of ["accepts", "no_mail", "unknown", null] as const) {
      expect(decideStaffSend({ ...allows, inviteOpen: false, mail }).kind).toBe("skip");
    }
  });

  it("every reason it gives has a sentence for the owner", () => {
    for (const reason of staffInviteEmailReasonSchema.options) {
      expect(STAFF_INVITE_EMAIL_REASON_WORDS[reason].length).toBeGreaterThan(10);
    }
  });
});
