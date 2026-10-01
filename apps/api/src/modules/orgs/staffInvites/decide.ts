// May this staff invitation email go now? (Part 3 §10.3; ROADMAP 4a-i.) The one rule,
// pure, asked by the worker just before every send with facts read that moment. An
// invitation cancelled, answered or ended since the owner pressed Send stops here, and
// so does everything that stops a member invitation (§9.12) except the list: this email
// is to one person the owner typed, so no list, age, postal-address or shared-mailbox
// check applies (a front desk's shared address is a fair place to invite a front desk).
import type { StaffInviteEmailReason } from "@app/shared";
import type { MailCheck } from "../invites/decide.js";
import type { SuppressionReason } from "../invites/repo.js";

export interface StaffSendFacts {
  /** The invitation is pending, not cleared and not ended, and is to this address. */
  inviteOpen: boolean;
  /** `named`: the gym's name can be shown in an email; `stopped`: its sending was
   *  stopped for bounces or a complaint. */
  gym: { active: boolean; onPlan: boolean; stopped: boolean; named: boolean } | null;
  suppression: SuppressionReason | null;
  /** The address passes sign-in's own email rule. */
  addressValid: boolean;
  /** Whether the address's domain takes email; null until it has been asked. */
  mail: MailCheck | null;
}

export type StaffSendDecision =
  | { kind: "send" }
  | { kind: "skip"; reason: StaffInviteEmailReason }
  /** Everything else allows it: ask the domain, then decide again. */
  | { kind: "check_mail" }
  /** The domain could not be asked; try again later. */
  | { kind: "retry"; reason: StaffInviteEmailReason };

export function decideStaffSend(facts: StaffSendFacts): StaffSendDecision {
  if (facts.gym === null || !facts.gym.active || !facts.gym.onPlan) return { kind: "skip", reason: "gym_not_active" };
  if (facts.gym.stopped) return { kind: "skip", reason: "sending_stopped" };
  if (!facts.gym.named) return { kind: "skip", reason: "gym_name" };
  if (!facts.inviteOpen) return { kind: "skip", reason: "invitation_closed" };
  if (facts.suppression !== null) return { kind: "skip", reason: facts.suppression };
  if (!facts.addressValid) return { kind: "skip", reason: "bad_address" };
  switch (facts.mail) {
    case null:
      return { kind: "check_mail" };
    case "no_mail":
      return { kind: "skip", reason: "no_mail_domain" };
    case "unknown":
      return { kind: "retry", reason: "dns_unavailable" };
    case "accepts":
      return { kind: "send" };
  }
}
